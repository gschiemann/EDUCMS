/**
 * Build the upstream URL for a proxied request so it can only ever point at
 * ORIGIN_URL's origin.
 *
 * `new URL(path, base)` treats a path beginning with `//` (or `/\`, which
 * URL parsers fold to `//`) as protocol-relative and takes its host from the
 * path. So the target is constructed from the origin explicitly, such paths
 * are refused outright, and the result is checked against the origin.
 *
 * Returns null when the request must be refused (the caller answers 400).
 */
export function buildOriginTarget(pathname: string, search: string, originUrl: string): URL | null {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return null;
  if (pathname[1] === '/' || pathname[1] === '\\') return null;
  // Control characters are stripped or mishandled by URL parsers; refuse.
  for (let i = 0; i < pathname.length; i++) {
    const c = pathname.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return null;
  }
  let origin: string;
  try {
    origin = new URL(originUrl).origin;
  } catch {
    return null;
  }
  if (!origin || origin === 'null') return null;
  let target: URL;
  try {
    target = new URL(origin + pathname + (search || ''));
  } catch {
    return null;
  }
  return target.origin === origin ? target : null;
}
