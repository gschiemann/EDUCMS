/**
 * SEC-006 (2026-09-04) — short-lived signed capability that authorises ONE
 * Chromium render.
 *
 * THE FINDING. `GET /api/v1/proxy/web` is PUBLIC and UNAUTHENTICATED — it has
 * to be, because it is loaded as an iframe `src` and an iframe cannot carry an
 * `Authorization` header. In its non-interactive ("static") mode that endpoint
 * pointed `RendererService` — a real Chromium, running
 * `--no-sandbox --disable-setuid-sandbox --single-process` inside the SAME
 * process that owns emergency delivery — at a URL chosen by whoever called it.
 * The SSRF/exposure guards added earlier bound what that browser may reach and
 * how long it may run; they do not change the fact that ANY anonymous caller on
 * the internet could pick the page it renders.
 *
 * The independent audit's pass condition was: "Renderer is moved to a
 * disposable sandboxed worker with deny-by-default egress, OR the
 * unauthenticated arbitrary-page route is disabled / strictly capability-gated
 * for launch." This module is the second option.
 *
 * WHAT THIS IS. A stateless HMAC capability, minted by
 * `POST /api/v1/proxy/render-capability` (which IS behind `JwtAuthGuard`, so it
 * requires either an operator session or a paired screen's device credential),
 * that binds:
 *
 *   the exact target URL · the minting principal's tenant · the principal
 *   itself (user id or screen id) · an expiry
 *
 * It rides in the `cap` query parameter, because that is the only channel an
 * iframe `src` has. That placement is deliberate and safe BECAUSE the
 * capability is not a credential: it confers exactly one power — "this one URL
 * may be rendered" — for a bounded time. It cannot be replayed against a
 * different URL (the URL digest is signed), it grants no read of any tenant
 * data, and possessing it tells an attacker nothing they did not already have
 * (they already had the URL: they were given the iframe). This is why the
 * device token is NOT used here: a device token is a credential, and putting
 * one in a proxied frame's URL is the exact mistake `player/page.tsx` and
 * `WidgetRenderer.tsx` both carry standing comments against.
 *
 * WHAT IT DOES NOT CLAIM. It does not make Chromium safe. A logged-in operator
 * (or a paired screen) can still aim the renderer at a hostile page, and the
 * residual risks the service documents — request interception cannot pin the
 * socket, so a DNS rebind can still put a packet on an internal address before
 * the response is poisoned; `--no-sandbox` is still `--no-sandbox` — are
 * unchanged. What changes is WHO can do it: an authenticated, tenant-attributed,
 * rate-limited principal instead of the open internet. The durable fix remains
 * the disposable sandboxed worker with deny-by-default egress.
 *
 * Secret precedence mirrors `sports/beacon-capability.ts`: a dedicated
 * `PROXY_RENDER_SECRET`, else `DEVICE_SECRET_KEY` (boot-validated in
 * production).
 */

import * as crypto from 'crypto';
import { requireSecret } from '../security/required-secret';

/**
 * How long a minted capability stays valid.
 *
 * Long by design. A capability authorises ONE already-chosen URL and nothing
 * else, and re-minting means changing an iframe's `src`, which RELOADS the
 * frame — on a wall-mounted signage screen that is a visible flash. Six hours
 * means a screen re-mints roughly four times a day instead of every few
 * minutes, and the client renews ahead of expiry (see
 * `apps/web/src/lib/render-capability.ts`) so the reload never lands on a
 * broken frame. Expiry is a bound on drift, not the security control — the
 * control is that an anonymous caller cannot obtain one at all.
 */
export const RENDER_CAPABILITY_TTL_MS = 6 * 60 * 60_000;

const VERSION = 'rc1';

let warnedNoDedicatedSecret = false;

function renderSecret(): string {
  const dedicated = process.env.PROXY_RENDER_SECRET;
  if (dedicated && dedicated.trim().length >= 16) return dedicated;
  if (process.env.NODE_ENV === 'production' && !warnedNoDedicatedSecret) {
    warnedNoDedicatedSecret = true;
    console.error(
      '[proxy-render] PROXY_RENDER_SECRET is not set in production. Render ' +
        'capabilities are deriving from DEVICE_SECRET_KEY (shared blast radius ' +
        'with WS/Redis control traffic and BYOK/MFA wrapping).',
    );
  }
  return requireSecret('DEVICE_SECRET_KEY', {
    devFallback: 'dev_only_render_capability_secret_CHANGE_ME',
  });
}

export type RenderPrincipalKind = 'user' | 'device';

/** Everything the signature covers. Field names are short: this rides a URL. */
export interface RenderCapabilityClaims {
  /** Format version. */
  v: 1;
  /**
   * SHA-256 of the target URL, base64url. The URL itself is already in the
   * query string next to this token; carrying only the digest keeps the
   * capability short and makes tampering with either half detectable.
   */
  u: string;
  /** Tenant of the minting principal. `null` only for a principal with none. */
  t: string | null;
  /** Whether an operator session or a paired screen minted this. */
  k: RenderPrincipalKind;
  /** The minting principal — user id or screen id. Attribution, not authority. */
  s: string;
  /** Expiry, epoch SECONDS. */
  x: number;
}

/**
 * Canonical digest of the render target.
 *
 * The controller hands `verify` the SAME raw `url` string it will hand the
 * renderer, so this is a byte-for-byte binding: no normalisation, no parsing,
 * no chance of a "verified one URL, rendered another" split. (Normalising here
 * would create exactly that gap — two spellings that hash alike but resolve
 * differently.)
 */
export function renderTargetDigest(url: string): string {
  return crypto.createHash('sha256').update(url, 'utf8').digest('base64url');
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', renderSecret()).update(payload).digest('base64url');
}

function safeEq(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(actual, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export interface MintRenderCapabilityInput {
  url: string;
  tenantId: string | null;
  principalKind: RenderPrincipalKind;
  principalId: string;
  /** Test seam. */
  now?: number;
}

export interface MintedRenderCapability {
  capability: string;
  /** Epoch MILLISECONDS, so the browser can compare against `Date.now()`. */
  expiresAt: number;
  ttlMs: number;
}

export function mintRenderCapability(input: MintRenderCapabilityInput): MintedRenderCapability {
  const now = input.now ?? Date.now();
  const expiresAt = now + RENDER_CAPABILITY_TTL_MS;
  const claims: RenderCapabilityClaims = {
    v: 1,
    u: renderTargetDigest(input.url),
    t: input.tenantId ?? null,
    k: input.principalKind,
    s: input.principalId,
    x: Math.floor(expiresAt / 1000),
  };
  const body = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return {
    capability: `${VERSION}.${body}.${sign(`${VERSION}.${body}`)}`,
    expiresAt,
    ttlMs: RENDER_CAPABILITY_TTL_MS,
  };
}

export type VerifyRenderCapabilityResult =
  | { ok: true; claims: RenderCapabilityClaims }
  | { ok: false; reason: string };

/**
 * Verify a capability AGAINST THE URL IT IS BEING PRESENTED FOR.
 *
 * The URL argument is mandatory on purpose: a signature check that does not
 * also bind the target would let one legitimately-minted capability authorise
 * a render of anything, which is the whole hole this closes.
 */
export function verifyRenderCapability(
  capability: unknown,
  url: string,
  opts: { now?: number } = {},
): VerifyRenderCapabilityResult {
  if (typeof capability !== 'string' || !capability) {
    return { ok: false, reason: 'missing' };
  }
  // Bound the work a malformed/oversized value can cost before any parsing.
  if (capability.length > 2048) return { ok: false, reason: 'oversized' };

  const parts = capability.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [version, body, signature] = parts;
  if (version !== VERSION) return { ok: false, reason: 'version' };

  if (!safeEq(sign(`${version}.${body}`), signature)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let claims: RenderCapabilityClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed_claims' };
  }
  if (!claims || claims.v !== 1) return { ok: false, reason: 'claims_version' };
  if (claims.k !== 'user' && claims.k !== 'device') return { ok: false, reason: 'claims_kind' };
  if (typeof claims.s !== 'string' || !claims.s) return { ok: false, reason: 'claims_subject' };
  if (typeof claims.x !== 'number' || !Number.isFinite(claims.x)) {
    return { ok: false, reason: 'claims_expiry' };
  }

  const now = opts.now ?? Date.now();
  if (now >= claims.x * 1000) return { ok: false, reason: 'expired' };

  // The binding. Constant-time so a mismatch cannot be walked byte by byte.
  if (typeof claims.u !== 'string' || !safeEq(claims.u, renderTargetDigest(url))) {
    return { ok: false, reason: 'url_mismatch' };
  }

  return { ok: true, claims };
}
