import { useUIStore } from '@/store/ui-store';
import { ensureCsrfToken, invalidateCsrfToken } from './csrf';
import { API_URL, warnIfMisconfigured } from './api-url';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type ApiFetchOptions = RequestInit & { _csrfRetry?: boolean };

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

  const res = await fetch(`${API_URL}${path}`, {
    cache: 'no-store',
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...csrfHeader,
      ...options.headers,
    },
  });

  if (res.status === 401) {
    useUIStore.getState().logout();
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

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `API error: ${res.status}`);
  }

  return res.json();
}
