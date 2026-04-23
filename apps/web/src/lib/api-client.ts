import { useUIStore } from '@/store/ui-store';
import { ensureCsrfToken, invalidateCsrfToken } from './csrf';
import { API_URL, warnIfMisconfigured } from './api-url';
import { clog } from './client-logger';
import { emitAuthEvent, subscribeAuthEvents } from './auth-events';

// Re-export subscribeAuthEvents so existing callers that import from
// '@/lib/api-client' don't need to change. (Previously defined here.)
export { subscribeAuthEvents };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Backoff schedule for network / 5xx retries. 1s, 3s, 7s. */
const RETRY_DELAYS_MS = [1000, 3000, 7000];
const RETRYABLE_STATUS = new Set([502, 503, 504]);

type ApiFetchOptions = RequestInit & { _csrfRetry?: boolean; _noRetry?: boolean };

/**
 * Lightweight event bus so UI shells (login page, toasts) can react
 * to transient API outages with a "reconnecting…" banner instead of
 * a hard error. Fires on every retry attempt and on eventual success.
 */
type ApiStatus = 'ok' | 'retrying' | 'unreachable';
type Listener = (s: { status: ApiStatus; attempt: number; lastUrl: string; message?: string }) => void;
const listeners = new Set<Listener>();
export function subscribeApiStatus(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(status: ApiStatus, attempt: number, lastUrl: string, message?: string) {
  listeners.forEach((l) => {
    try {
      l({ status, attempt, lastUrl, message });
    } catch {
      /* ignore listener errors */
    }
  });
}

// Event bus for session-expired (401) / explicit-logout lives in
// ./auth-events to avoid a circular import with ui-store.

export function getApiUrl(): string {
  return API_URL;
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export async function apiFetch<T = any>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  warnIfMisconfigured();
  const token = useUIStore.getState().token;
  const method = (options.method ?? 'GET').toUpperCase();
  const isMutation = !SAFE_METHODS.has(method);

  const csrfHeader: Record<string, string> = {};
  if (isMutation) {
    try {
      csrfHeader['X-CSRF-Token'] = await ensureCsrfToken();
    } catch {
      // Server warn-mode will still allow the request through; leave empty.
    }
  }

  const fullUrl = `${API_URL}${path}`;
  // Don't force `cache: 'no-store'`. React Query is already the source of
  // truth for client caching + invalidation; forcing no-store on top of it
  // disables every layer of HTTP cache (browser memory cache, disk cache,
  // Cloudflare/Vercel edge) even for endpoints that returned Cache-Control.
  // Mutations still never hit any cache because POST/PUT/DELETE are never
  // cached by spec. GETs now respect any Cache-Control the API sends. Per
  // 2026-04-19 perf audit — one of the three root causes of the Vercel
  // "click-to-click feels slow" report.
  const init: RequestInit = {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...csrfHeader,
      ...options.headers,
    },
  };

  // Mutations are only retried on pure network failures, never on 5xx
  // (could double-submit). Safe methods + login are retried on 5xx too.
  const retryOn5xx = !isMutation || path.startsWith('/auth/login');
  const maxRetries = options._noRetry ? 0 : RETRY_DELAYS_MS.length;

  let lastErr: unknown = new Error('unknown');

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(fullUrl, init);

      if (res.status === 401) {
        clog.warn('api', 'Session expired (401) — logging out + redirect', { url: fullUrl, method });
        useUIStore.getState().logout();
        emit('ok', attempt, fullUrl);
        // Notify the AuthExpirationGuard (mounted in DashboardLayout) so
        // it can router.push('/login'). apiFetch runs outside React so
        // can't call useRouter() directly — event bus is the bridge.
        emitAuthEvent({ reason: 'session-expired', url: fullUrl });
        throw new Error('Session expired. Please log in again.');
      }

      if (res.status === 403 && !options._csrfRetry && isMutation) {
        const clone = res.clone();
        const body = await clone.json().catch(() => null);
        if (body?.error === 'CsrfError') {
          invalidateCsrfToken();
          return apiFetch<T>(path, { ...options, _csrfRetry: true });
        }
      }

      if (retryOn5xx && RETRYABLE_STATUS.has(res.status) && attempt < maxRetries) {
        clog.warn('api', `Retrying after ${res.status}`, { url: fullUrl, attempt: attempt + 1 });
        emit('retrying', attempt + 1, fullUrl, `API returned ${res.status}`);
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        clog.error('api', `API error ${res.status}`, { url: fullUrl, method, message: body?.message });
        emit('ok', attempt, fullUrl);
        throw new Error(body.message || `API error: ${res.status}`);
      }

      emit('ok', attempt, fullUrl);
      return res.json();
    } catch (err) {
      lastErr = err;
      // TypeError from fetch = network error (DNS fail, connection refused,
      // CORS error, offline). These are the Railway-cold-start failures we
      // want to paper over for the user.
      const isNetwork = err instanceof TypeError;
      if (isNetwork && attempt < maxRetries) {
        clog.warn('api', 'Network error — retrying', { url: fullUrl, attempt: attempt + 1 });
        emit('retrying', attempt + 1, fullUrl, 'Network error — API may be starting up');
        await sleep(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      if (isNetwork) {
        clog.error('api', 'API unreachable after retries', { url: fullUrl, attempts: attempt });
        emit('unreachable', attempt, fullUrl, 'API unreachable after retries');
        throw new Error(
          `Can't reach the server at ${API_URL}. The API may be restarting — please try again in a moment.`,
        );
      }
      clog.error('api', 'Request failed (non-network)', { url: fullUrl, err: String(err) });
      throw err;
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('API request failed');
}
