import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerRequest } from '@nestjs/throttler';
import { clientIpFromRequest } from './client-ip';
import { DEVICE_ROUTE_LIMIT, deviceThrottleTracker } from './device-throttle-key';

/**
 * Custom ThrottlerGuard that derives a STABLE per-client tracker behind
 * Railway's reverse-proxy chain (security P1, 2026-07-07).
 *
 * THE BUG: the stock guard's tracker resolves to `req.ip`. Under
 * `trust proxy: 1` behind Railway's multi-hop internal mesh, `req.ip` can
 * rotate across requests from the SAME client — the trusted-hop count doesn't
 * match the real chain, so `req.ip` lands on a *varying* internal proxy
 * address. The per-IP throttle key (`throttle:<name>:<tracker>`) then changes
 * per request, the SHARED Redis counter never accumulates to the limit, and
 * the brute-force caps never fire 429.
 *
 * PROVEN LIVE (2026-07-07): 16 rapid failed logins from a single, verified-
 * stable client IP (`99.65.178.111`) returned zero 429; `x-ratelimit-remaining`
 * partially accumulated then RESET (e.g. …6,5,4,then 9 again). Crucially the
 * storage's fail-open `warn` NEVER fired and `/health` reported `redis:"ok"` on
 * every replica — so Redis was healthy and the eval succeeded every time. The
 * only remaining variable that explains a resetting shared counter is the
 * tracker KEY moving between requests.
 *
 * THE FIX: derive the tracker from `clientIpFromRequest`, which selects the
 * `X-Forwarded-For` entry at the trusted-proxy hop position counted FROM THE
 * RIGHT. That entry stays stable no matter how many varying internal hops
 * Railway appends downstream. For a normal chain this equals `req.ip` in the
 * common single-hop case, so behavior is unchanged there; it only diverges
 * (correctly) when extra hops are present.
 *
 * SPOOFING (ACC-08, 2026-08-01 — the note below used to say the opposite):
 * the earlier version of this fix keyed on the LEFTMOST XFF entry, which is
 * the ONE position a client fully controls (proxies append, so client-supplied
 * values arrive as a prefix). Sending a fresh `X-Forwarded-For` per request
 * therefore rotated the throttle key at will and reinstated the very bug this
 * guard exists to fix — every per-IP brute-force cap was one header away from
 * never firing. Counting from the right by hop count fixes that: injected
 * entries only lengthen the ignored prefix, and a client cannot move its own
 * position in the chain. The key is now both STABLE and UNSPOOFABLE. See
 * `client-ip.ts` for the full derivation + the `TRUSTED_PROXY_HOPS` env var.
 *
 * SAFETY: this override ONLY changes the throttle key derivation — it does not
 * touch authentication. It is fully defensive: it never throws (try/catch +
 * fallbacks to `req.ip` then `'unknown'`), so the guard can never 500 a login.
 * The `[tracker-diag]` log below reveals the real values so a live re-test can
 * confirm stability rather than guess.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  private readonly ipLogger = new Logger(ClientIpThrottlerGuard.name);

  /**
   * One-shot diagnostic budget per process. The first few requests log the raw
   * proxy fields so a live re-test can PROVE the chosen tracker is stable across
   * requests (grep the logs for `[tracker-diag]`). Self-limiting so it never
   * spams and never leaks meaningful volumes of client IPs.
   */
  private diagLogged = 0;
  private static readonly DIAG_BUDGET = 3;

  /**
   * PER-DEVICE KEYING ON THE FLEET'S OWN ROUTES (P0-7, 2026-09-05).
   *
   * MEASURED: a venue is one NAT address, so the 600/min/IP cap made the
   * platform's real limit "≈75 screens per building" — 0 % throttled at 75
   * screens behind one address, 8.7 % at 100, and ≈31 screens when the push
   * channel is degraded (which is the permanent state behind a WebSocket-
   * blocking school firewall and the whole fleet's state during a Redis
   * outage). A throttled screen also does not go quiet: `emergencyRev.ts`
   * turns three 429s into a FULL manifest fetch, so the limiter pushed back
   * on the cheap request and rewarded the expensive one.
   *
   * On the explicitly-listed device routes (`device-throttle-key.ts`) the key
   * therefore becomes the SCREEN ID out of a fully verified device JWT, with
   * the per-device ceiling clamped so it can never be LOOSER than the per-IP
   * number that route already had. Everything else — every anonymous route,
   * every brute-force cap, every operator route — keeps `getTracker` below
   * verbatim, which is the whole of the change's blast radius.
   *
   * FALL-BACK IS THE SAFE DIRECTION: a missing, malformed, expired, forged or
   * non-device token yields no key, and the request drops through to the
   * per-IP tracker. Presenting garbage credentials cannot buy an escape from
   * the IP cap; it just leaves you in it.
   */
  protected async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    let deviceKey: string | null = null;
    try {
      const { req } = this.getRequestResponse(props.context);
      deviceKey = deviceThrottleTracker(req as Record<string, any>, props.context);
    } catch {
      deviceKey = null; // never let key derivation break a request
    }
    if (!deviceKey) return super.handleRequest(props);
    return super.handleRequest({
      ...props,
      // `min` so a route with a TIGHTER per-IP cap (stream-ticket 60/min,
      // gpio-event 30/min) does not get loosened by being keyed per device.
      limit: Math.min(props.limit, DEVICE_ROUTE_LIMIT),
      getTracker: async () => deviceKey as string,
    });
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    // Shared hop-count XFF resolution (also used by AuditLog/RequestLog so the
    // throttle key and the forensic IP agree). A tracker key must be a
    // non-null string, so coalesce the helper's null to 'unknown'.
    const tracker = clientIpFromRequest(req) ?? 'unknown';

    if (this.diagLogged < ClientIpThrottlerGuard.DIAG_BUDGET) {
      this.diagLogged += 1;
      // Unique, grep-able token so this is findable amid unrelated WARN spam.
      this.ipLogger.warn(
        `[tracker-diag] chosen=${tracker} req.ip=${String(
          req?.ip,
        )} req.ips=${JSON.stringify(req?.ips)} xff=${JSON.stringify(
          req?.headers?.['x-forwarded-for'],
        )}`,
      );
    }

    return tracker;
  }
}
