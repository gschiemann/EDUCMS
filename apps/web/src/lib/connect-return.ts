/**
 * Where an OAuth hop that leaves the app should bring the operator back to.
 *
 * The social apps (Instagram, Facebook Page) are connected from inside the
 * template builder; the provider's consent screen is a full-page navigation,
 * and the API always lands on /connect/:provider/done. Before leaving we park
 * the current path here; the done page sends the operator back to it.
 *
 * Only a same-workspace path is ever honoured — a stored value is never a
 * redirect to anywhere else (no open redirect through storage). Reading is
 * pure (safe to call during render, twice under StrictMode); clearing is a
 * separate call made when the page actually leaves.
 */
const KEY = 'venueos.connectReturn';

export function rememberConnectReturn(path: string): void {
  try { sessionStorage.setItem(KEY, path); } catch { /* storage blocked — the done page falls back */ }
}

export function readConnectReturn(tenantSlug: string): string | null {
  let raw: string | null = null;
  try { raw = sessionStorage.getItem(KEY); } catch { return null; }
  if (!raw) return null;
  // A path inside this workspace only: "/<slug>/…", never "//host" or a scheme.
  if (!raw.startsWith(`/${tenantSlug}/`) || raw.startsWith('//') || raw.includes('\\')) return null;
  return raw;
}

export function clearConnectReturn(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}
