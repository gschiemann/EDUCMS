/**
 * Resolve the REAL client IP from a request behind Railway's multi-hop proxy.
 *
 * THE BUG (2026-07-07): under `app.set('trust proxy', 1)` (main.ts) behind
 * Railway's multi-hop internal mesh, Express's `req.ip` lands on a *rotating
 * internal proxy hop*, NOT the real client. This silently defeated the per-IP
 * rate limiter (fixed in `ClientIpThrottlerGuard`) and — the reason this helper
 * exists — makes AuditLog / RequestLog / Screen `ipAddress` record a
 * meaningless internal address instead of the operator's (or device's) real IP.
 * For a life-safety product that is a real forensic-accuracy gap: "who
 * triggered an emergency, from what IP" must be trustworthy.
 *
 * Proven live: a request arrived with
 *   x-forwarded-for: "216.241.83.102, 152.233.76.9"
 *   req.ip = 152.233.76.9   (the internal hop — rotates per request)
 * while the true client was the leftmost `216.241.83.102`. See
 * `docs/research/2026-07-07-ratelimit-tracker-fix/00-FINDINGS.md`.
 *
 * THE FIX: prefer the leftmost `X-Forwarded-For` entry (the original client),
 * which stays stable no matter how many internal hops Railway appends. Fall
 * back to `req.ip`, then the raw socket address. Fully defensive — never throws.
 *
 * We deliberately do NOT raise `trust proxy` globally: Railway's hop count
 * appears to vary, so a fixed hop number would still resolve `req.ip` to a
 * rotating entry, whereas the leftmost-XFF approach is robust to a variable
 * chain.
 *
 * SPOOFING NOTE: the leftmost XFF is client-settable, so this value is
 * attacker-influenceable and must be treated as an *identifier for
 * forensics/telemetry*, not as an authenticated fact. That is already true of
 * any client IP behind a proxy; this helper does not make it worse, and it
 * strictly improves the honest-client case (which previously logged the
 * internal hop).
 *
 * @returns the resolved client IP, or `null` if nothing is resolvable (callers
 *   that need a non-null string, e.g. a throttle key, should coalesce).
 */
export function clientIpFromRequest(req: unknown): string | null {
  const r = req as
    | {
        headers?: Record<string, unknown>;
        ip?: unknown;
        socket?: { remoteAddress?: unknown };
      }
    | undefined;
  try {
    const xff = r?.headers?.['x-forwarded-for'];
    const raw = Array.isArray(xff) ? xff[0] : xff;
    if (typeof raw === 'string' && raw.length) {
      const first = raw.split(',')[0]?.trim();
      if (first) return first;
    }
  } catch {
    /* fall through to req.ip / socket below */
  }
  const ip = r?.ip;
  if (typeof ip === 'string' && ip.length) return ip;
  const sock = r?.socket?.remoteAddress;
  if (typeof sock === 'string' && sock.length) return sock;
  return null;
}
