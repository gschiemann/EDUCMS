import { useUIStore } from '@/store/ui-store';
import { ensureCsrfToken, invalidateCsrfToken } from './csrf';
import { API_URL, warnIfMisconfigured } from './api-url';
import { clog } from './client-logger';
import { emitAuthEvent, subscribeAuthEvents } from './auth-events';
import { hasRememberMarker, refreshRememberedSession } from './session-client';

// Re-export subscribeAuthEvents so existing callers that import from
// '@/lib/api-client' don't need to change. (Previously defined here.)
export { subscribeAuthEvents };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Backoff schedule for network / 5xx retries. 1s, 3s, 7s. */
const RETRY_DELAYS_MS = [1000, 3000, 7000];
const RETRYABLE_STATUS = new Set([502, 503, 504]);

type ApiFetchOptions = RequestInit & {
  _csrfRetry?: boolean;
  _noRetry?: boolean;
  /** SEC-010 — set once a 401 has already been answered with a cookie
   *  refresh + retry for this call, so a second 401 tears the session down
   *  instead of looping. */
  _sessionRetry?: boolean;
};

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

// 2026-05-27 — Module-scope flag to prevent a 401-storm during the
// redirect window from firing the session-expired flow N times across
// every in-flight request. Set true the moment the first authentic-
// token 401 triggers logout; reset to false when a successful 200
// proves we're authenticated again (e.g. after re-login). Mirrors the
// "once per page lifecycle" semantics of the previous interceptor
// without coupling to React.
let sessionLogoutFired = false;
export function __resetSessionLogoutFired() { sessionLogoutFired = false; }

// ── Proactive silent refresh (Trust-wave D, 2026-08-06) ──────────────────
// A scorekeeper who logs in during warm-ups holds a 1h JWT; without refresh
// the console 401s mid-third-quarter and the session-expired path kicks
// them to /login. After any SUCCESSFUL authed response we peek at the
// stored token's `exp`; inside the last 15 minutes we trade the still-valid
// token for a fresh one at POST /auth/refresh (the server enforces
// sliding-with-cap — plain sessions stop sliding 12h after login).
// Failure is SILENT by design: the existing 401 session-expired path stays
// the fallback, and the refresh response never schedules another refresh,
// so this can't loop.
const REFRESH_WHEN_REMAINING_SEC = 15 * 60;
let tokenRefreshInFlight: Promise<void> | null = null;
// Only an EXPLICIT refresh-policy refusal is a DECISION the server will
// repeat for this token forever (past the sliding cap, dead session,
// switched-workspace scope, wrong principal kind) — those memoize the token
// and stand down until re-login. Every OTHER failure is treated as transient
// and stays retryable on a later response, exactly like a 5xx. Crucially,
// JwtAuthGuard also emits a CODE-LESS 401 ("Auth check unavailable; please
// retry") when its Redis revocation check fails closed — memoizing that
// permanently disabled silent refresh for a still-valid token over one Redis
// blip (refuter P2, 2026-08-09). A truly revoked token cannot loop here:
// every normal request 401s too, the session-expired path logs out, and the
// stored token is gone.
const PERMANENT_REFRESH_REFUSAL_CODES = new Set([
  'AUTH_REFRESH_WINDOW_EXCEEDED',
  'AUTH_REFRESH_INVALID_SESSION',
  'AUTH_REFRESH_SCOPE_CHANGED',
  'AUTH_REFRESH_NOT_APPLICABLE',
  'AUTH_NO_BEARER_TOKEN',
]);
let lastRefusedRefreshToken: string | null = null;
export function __resetTokenRefreshState() {
  tokenRefreshInFlight = null;
  lastRefusedRefreshToken = null;
}

/** `exp` (epoch seconds) from a JWT — plain base64 payload parse, no
 *  verification (the server re-verifies; we only need the clock).
 *  null = unreadable/absent. */
function decodeJwtExpSec(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    // base64url → base64 (atob rejects '-'/'_'; padding is optional).
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = JSON.parse(json)?.exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

function maybeScheduleTokenRefresh(sentToken: string | null, path: string): void {
  if (!sentToken) return; // unauthenticated request — zero behavior change
  if (path.startsWith('/auth/refresh')) return; // never chain off our own refresh
  if (tokenRefreshInFlight) return; // module-level dedup: at most one in flight
  const stored = useUIStore.getState().token;
  if (!stored) return; // logged out while the request was in flight
  if (stored === lastRefusedRefreshToken) return; // server already said no for THIS token
  const expSec = decodeJwtExpSec(stored);
  if (expSec === null) return;
  const remaining = expSec - Date.now() / 1000;
  // Already expired → the normal 401 path owns it; >15min left → nothing.
  if (remaining <= 0 || remaining >= REFRESH_WHEN_REMAINING_SEC) return;
  tokenRefreshInFlight = refreshSessionToken(stored)
    .catch(() => { /* network failure — silent; the 401 fallback stands */ })
    .finally(() => { tokenRefreshInFlight = null; });
}

/** Background body of the silent refresh. Raw fetch on purpose: apiFetch's
 *  401 handler tears down the session, but a REFUSED refresh must change
 *  nothing — the current token is still live until its natural expiry. */
async function refreshSessionToken(stored: string): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${stored}`,
  };
  // Same header every authed mutation sends. (The API skips CSRF matching
  // for Bearer requests, but keep the client's mutation shape uniform.)
  try { headers['X-CSRF-Token'] = await ensureCsrfToken(); } catch { /* warn-mode ok */ }
  const res = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
    headers,
  });
  if (!res.ok) {
    // Memoize ONLY an explicit refresh-policy refusal (see the code set
    // above). A code-less 401/403 — notably the guard's transient
    // Redis-fail-closed 401 — stays retryable on a later response, same as
    // 5xx/429; the natural-expiry 401 path still owns the session's end.
    if (res.status === 401 || res.status === 403) {
      const body = await res.json().catch(() => null);
      if (PERMANENT_REFRESH_REFUSAL_CODES.has(String(body?.code))) {
        lastRefusedRefreshToken = stored;
      }
    }
    return;
  }
  const body = await res.json().catch(() => null);
  const next: unknown = body?.access_token;
  // Swap via the store's setter (keeps session/localStorage placement
  // coherent with the operator's rememberMe choice) — but only if the token
  // we refreshed is STILL the live one (not logged out / re-logged mid-flight).
  if (typeof next === 'string' && next && useUIStore.getState().token === stored) {
    useUIStore.getState().setToken(next);
  }
}
// Subscribe to auth events so a successful re-login (auth-events emits
// reason:'login-success') clears the flag for the next session.
if (typeof window !== 'undefined') {
  subscribeAuthEvents((e: any) => {
    if (e?.reason === 'login-success') sessionLogoutFired = false;
  });
}

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
  // 2026-05-03 BUG FIX (cycle 1 ai-imports BUG-001) — when the body is
  // a FormData (multipart upload), DO NOT force Content-Type. The
  // browser will auto-set `multipart/form-data; boundary=...` based on
  // the FormData boundary. Forcing application/json here was killing
  // every PDF / PPTX / image upload from /settings/imports — multer
  // received an unparseable JSON-typed body and dropped the file.
  const isMultipart = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const baseHeaders: Record<string, string> = isMultipart
    ? {} // browser sets Content-Type with boundary
    : { 'Content-Type': 'application/json' };
  const init: RequestInit = {
    credentials: 'include',
    ...options,
    headers: {
      ...baseHeaders,
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
        // 2026-05-27 — Operator hit "New Playlist" → modal mounted →
        // some hook re-fetched a branding endpoint → 401 → logged out.
        // Root cause: this interceptor nuked the session for ANY 401,
        // including from endpoints that 401 by design when called
        // without a token (e.g. /branding/me on the login/marketing
        // page, or transient races where the token isn't yet in store).
        // It also fanned out — every parallel request in flight at the
        // moment fired its own logout call, which can race with the
        // login form's own login dispatch.
        //
        // Fix:
        //   1. Only auto-logout when we actually SENT a token. A 401
        //      with no Authorization header means "you're not logged
        //      in" — that's expected for marketing / login surfaces;
        //      callers can handle it. No reason to clear state we
        //      don't have.
        //   2. Once logout has fired in this process, suppress further
        //      logout dispatches for the rest of the page lifecycle.
        //      The first 401 is the authoritative signal; subsequent
        //      parallel-request 401s during the redirect window are
        //      noise.
        //
        // Both cases still THROW so callers see the failure — they
        // just don't tear down the whole session.
        // ── SEC-010: ONE on-demand recovery before we tear anything down ──
        // The access token is <= 1h now (it used to be 30 days for a
        // remembered session, which was the finding). So a 401 on a
        // remembered session is the NORMAL end of an hour, not a dead
        // session. Trade the HttpOnly cookie for a fresh token and replay the
        // request exactly ONCE.
        //
        // Bounded by construction, which is what keeps this out of the
        // failure modes the player rules name:
        //   • single-flight in session-client — a dashboard's dozen parallel
        //     401s produce ONE refresh, never a dozen replays (which the
        //     server would correctly grade as token reuse and answer by
        //     revoking the family);
        //   • `_sessionRetry` means each call gets at most one retry, so a
        //     genuinely dead session still reaches the logout below;
        //   • no timer anywhere — this only ever runs in response to a real
        //     401 on a real request (CLAUDE.md mobile-perf standard).
        if (token && !options._sessionRetry && !sessionLogoutFired && hasRememberMarker()) {
          const restored = await refreshRememberedSession();
          if (restored?.access_token) {
            useUIStore.getState().setToken(restored.access_token);
            if (restored.user) useUIStore.getState().setUser(restored.user);
            clog.info('api', 'Session refreshed from cookie after 401 — retrying once', {
              url: fullUrl,
            });
            return apiFetch<T>(path, { ...options, _sessionRetry: true });
          }
        }

        if (token && !sessionLogoutFired) {
          sessionLogoutFired = true;
          clog.warn('api', 'Session expired (401, token in request) — logging out + redirect', { url: fullUrl, method });
          useUIStore.getState().logout();
          emit('ok', attempt, fullUrl);
          // Notify the AuthExpirationGuard (mounted in DashboardLayout) so
          // it can router.push('/login'). apiFetch runs outside React so
          // can't call useRouter() directly — event bus is the bridge.
          emitAuthEvent({ reason: 'session-expired', url: fullUrl });
          throw new Error('Session expired. Please log in again.');
        }
        // No-token 401, or follow-on 401 in the redirect window.
        // Throw so the caller can react, but DON'T nuke the session.
        emit('ok', attempt, fullUrl);
        const err: any = new Error('Unauthorized');
        err.status = 401;
        throw err;
      }

      if (res.status === 403 && !options._csrfRetry && isMutation) {
        const clone = res.clone();
        const body = await clone.json().catch(() => null);
        // The global exception filter normalizes every error to
        // `{ error: true, code, message }`, so the CsrfError marker lands
        // in `code` (not `error`, which is the boolean presence flag). The
        // legacy `body?.error === 'CsrfError'` check could NEVER match
        // (`true === 'CsrfError'`), so this transparent re-mint-and-retry —
        // the recovery path for a dropped third-party CSRF cookie on the
        // Vercel→Railway cross-origin deploy — silently never fired. Read
        // `code` (the real field); keep the `error` form as a belt-and-
        // suspenders fallback in case the envelope ever changes.
        if (body?.code === 'CsrfError' || body?.error === 'CsrfError') {
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
        // FIRST-LOGIN CREDENTIAL SETUP (2026-09-03) — self-heal a stale cached
        // session. The dashboard decides whether to render the setup gate from
        // `user.mustSetupCredentials` in the store, which is hydrated from the
        // login response; a session blob written by an OLDER bundle (or before
        // provisioning set the flag) doesn't carry it, so the app would render
        // normally while every request 403s. The server is the authority: when
        // it says SETUP_REQUIRED, patch the flag on and let the layout swap to
        // the gate. Costs nothing — the body is already parsed here.
        if (res.status === 403 && body?.code === 'SETUP_REQUIRED') {
          const cur = useUIStore.getState().user;
          if (cur && !cur.mustSetupCredentials) {
            clog.warn('api', 'Server requires first-login credential setup — showing the setup gate', { url: fullUrl });
            useUIStore.getState().setUser({ ...cur, mustSetupCredentials: true });
          }
        }
        // 2026-05-25 (audit-W8) — attach status + code + body to the
        // thrown error so callers can branch on a STRUCTURED field
        // instead of regex-matching the message. Was a real defect
        // for the AI cap-reached UX, but applies broadly: any
        // controller that throws `HttpException({code,...}, status)`
        // now exposes that code as `err.code` on the FE.
        const err: any = new Error(body.message || `API error: ${res.status}`);
        err.status = res.status;
        if (body && typeof body === 'object') {
          err.code = body.code;
          err.body = body;
        }
        throw err;
      }

      emit('ok', attempt, fullUrl);
      // 2026-05-27 — A 2xx response proves the session is alive again.
      // Reset the logout-storm flag so the NEXT genuine session-expired
      // 401 can fire a fresh logout. Pairs with the early-return at
      // line ~106.
      sessionLogoutFired = false;
      // Trust-wave D — fire-and-forget: if the stored token is inside its
      // last 15 minutes, silently trade it for a fresh one (see the
      // maybeScheduleTokenRefresh block above for the full contract).
      maybeScheduleTokenRefresh(token, path);
      // 2026-05-26 — Some NestJS controllers return JS null on "not
      // found" (e.g. /branding/me when a tenant has no branding row).
      // NestJS serializes that as a 200 with EMPTY body, not the
      // string "null", so res.json() throws `SyntaxError: Unexpected
      // end of JSON input`. Was spamming pageerror across every
      // dashboard load. Read text first, treat empty as null.
      const text = await res.text();
      if (!text) return null as unknown as T;
      try {
        return JSON.parse(text) as T;
      } catch (parseErr) {
        clog.error('api', 'Failed to parse JSON response', { url: fullUrl, textSample: text.slice(0, 200) });
        throw parseErr;
      }
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
