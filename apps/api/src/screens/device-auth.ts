/**
 * device-auth.ts — THE single device-credential verification path.
 *
 * Why this file exists (2026-08-03 security wave, findings DT-01/02/03/05):
 *
 * There used to be THREE byte-similar copies of `verifyDeviceForScreen`
 * (screens.controller.ts, gpio.controller.ts, player-logs.controller.ts),
 * and all three checked only `signature + kind + sub`. They did NOT check
 * the revocation list, did NOT check `Screen.status === 'REVOKED'`, and
 * did NOT re-read the live Screen row — three checks the `JwtAuthGuard`
 * path DID enforce. That inconsistency covered nine routes, including the
 * two that matter most: `/gpio-event` (fabricate a LOCKDOWN) and
 * `/unpair/:fp` (delete every schedule on the screen).
 *
 * Everything device-authenticated now goes through `verifyDeviceForScreen`
 * below, which enforces, in order:
 *
 *   1. Cryptography — HS256 only (explicit `algorithms` allowlist rather
 *      than relying on a jsonwebtoken library default that a major bump
 *      could remove), `kind === 'device'`, `sub === screenId`.
 *   2. Token-string revocation — `jwt_revoked_list`, fail-CLOSED, exactly
 *      as `JwtAuthGuard` does.
 *   3. Live Screen row — the row must still exist (deleting a screen is
 *      therefore a complete credential kill), must not be `REVOKED`, and
 *      its `credentialEpoch` must match the token's `ep` claim.
 *   4. Identity is returned FROM THE LIVE ROW (tenantId, screenGroupId),
 *      never from the token's claims — the DT-03 defence the WS gateway
 *      and `/emergency/messages` already implemented and the rest of the
 *      device surface had missed.
 *
 * GRANDFATHERING (live fleet, read this before changing anything):
 * a device token minted before 2026-08-03 carries no `ep` claim. That is
 * read as epoch 0, which is `Screen.credentialEpoch`'s column default, so
 * every already-deployed screen keeps authenticating with the token it
 * already holds. Nothing in this file invalidates the installed base.
 *
 * PERFORMANCE: step 3 is a live DB read on routes that previously did
 * none (`/game-state` runs at up to 16 Hz per screen, and the Supabase
 * pool is `connection_limit=10`). The credential snapshot is therefore
 * memoised per screen for CREDENTIAL_CACHE_TTL_MS, and every revocation
 * writer calls `invalidateDeviceCredentialCache()` so a revoke on THIS
 * replica takes effect immediately. Worst case on another replica is one
 * TTL window (5 s) — well inside the player's own poll cadence, and the
 * DB remains the sole authority.
 */

import type { Request as ExpressReq } from 'express';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { requireSecret } from '../security/required-secret';

/** Device JWTs are HMAC-signed. Never accept an asymmetric or `none` alg. */
export const DEVICE_JWT_ALGORITHMS: jwt.Algorithm[] = ['HS256'];

/**
 * Bounded lifetime for a paired screen's device credential (DT-02).
 *
 * Was 365 d, which — combined with unbounded self-renewal — meant expiry
 * was decorative. 180 d is a real ceiling that still clears the longest
 * legitimate offline stretch in the K-12 calendar (a screen powered down
 * for an entire ~100-day summer break comes back and re-registers on its
 * own token, no operator action). Do NOT shorten this below ~120 d
 * without a plan for summer break: a fleet that has to be re-paired by
 * hand every September is an outage, not a security control.
 */
export const DEVICE_TOKEN_TTL_PAIRED = '180d';
/** Pre-claim (unpaired) tokens stay short-lived — unchanged behaviour. */
export const DEVICE_TOKEN_TTL_UNPAIRED = '15m';
/** Downgraded credential handed to a caller that could not prove possession. */
export const DEVICE_TOKEN_TTL_UNPROVEN = '1h';

/**
 * How long the immediately-previous credential epoch stays acceptable
 * after a rotation (DT-02). This window is what makes rotation SAFE on a
 * live fleet: if the register response carrying the new token is lost, or
 * two register calls race on boot, the kiosk re-presents the old token
 * and is still accepted — it just rotates again. Only a fork that
 * persists beyond this window is treated as one.
 */
export const CREDENTIAL_EPOCH_GRACE_MS = 24 * 60 * 60 * 1000;

/** Live-row credential snapshot TTL. See PERFORMANCE note above. */
export const CREDENTIAL_CACHE_TTL_MS = 5_000;

/** The columns every device-authenticated route needs from the live row. */
export interface DeviceCredentialState {
  id: string;
  tenantId: string | null;
  screenGroupId: string | null;
  status: string;
  credentialEpoch: number;
  credentialEpochRotatedAt: Date | null;
}

export type DeviceAuthResult =
  | {
      ok: true;
      /** Always the token's `sub`, re-checked against the path param. */
      sub: string;
      /** Live-row identity. NEVER sourced from a JWT claim. */
      screen: DeviceCredentialState;
      /** Live tenant. `null` for an unpaired screen. */
      tenantId: string | null;
      /** The raw bearer token, when one was presented (HMAC path → null). */
      token: string | null;
    }
  | { ok: false; reason: string };

/** Minimal Prisma surface this module needs — keeps it unit-testable. */
export interface DeviceAuthPrisma {
  client: {
    screen: {
      findUnique: (args: any) => Promise<any>;
    };
  };
}

/** Minimal Redis surface — `sismember` against `jwt_revoked_list`. */
export interface DeviceAuthRedis {
  sismember: (key: string, member: string) => Promise<boolean>;
}

// ── Credential snapshot cache ────────────────────────────────────────────
const credentialCache = new Map<string, { at: number; state: DeviceCredentialState | null }>();

/**
 * Drop a screen's cached credential snapshot. EVERY writer that changes
 * `credentialEpoch`, `status`, or `tenantId` must call this, or a revoke
 * lingers for up to CREDENTIAL_CACHE_TTL_MS on the replica that performed
 * it — which is the one place we can and therefore must be exact.
 */
export function invalidateDeviceCredentialCache(screenId?: string): void {
  if (screenId) credentialCache.delete(screenId);
  else credentialCache.clear();
}

/**
 * Load (and memoise) a screen's credential snapshot. Exported so the
 * global `DeviceIdentityInterceptor` shares this cache rather than adding
 * a second lookup per request.
 */
export async function loadDeviceCredentialState(
  deps: { prisma: DeviceAuthPrisma },
  screenId: string,
): Promise<DeviceCredentialState | null> {
  return loadCredentialState(deps.prisma, screenId);
}

/**
 * Decode a device bearer token WITHOUT verifying it.
 *
 * ⚠️ Only ever call this where the signature has ALREADY been verified by
 * something else (the `JwtAuthGuard`) and you just need a claim the guard
 * did not copy onto `req.user`. Never use it to make an auth decision on
 * its own — an unverified payload is attacker-controlled.
 */
export function decodeDeviceTokenUnsafe(authHeader: string): any {
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) return null;
  try {
    return jwt.decode(authHeader.slice(7).trim());
  } catch {
    return null;
  }
}

async function loadCredentialState(
  prisma: DeviceAuthPrisma,
  screenId: string,
): Promise<DeviceCredentialState | null> {
  const hit = credentialCache.get(screenId);
  if (hit && Date.now() - hit.at < CREDENTIAL_CACHE_TTL_MS) return hit.state;

  const row = (await prisma.client.screen.findUnique({
    where: { id: screenId },
    select: {
      id: true,
      tenantId: true,
      screenGroupId: true,
      status: true,
      credentialEpoch: true,
      credentialEpochRotatedAt: true,
    } as any,
  })) as any;

  const state: DeviceCredentialState | null = row
    ? {
        id: row.id,
        tenantId: row.tenantId ?? null,
        screenGroupId: row.screenGroupId ?? null,
        status: String(row.status ?? ''),
        credentialEpoch: Number(row.credentialEpoch ?? 0) || 0,
        credentialEpochRotatedAt: row.credentialEpochRotatedAt ?? null,
      }
    : null;

  // Cap the map so a fingerprint-scanning attacker can't grow it without
  // bound. Screens are long-lived; 5_000 entries covers any real fleet.
  if (credentialCache.size > 5_000) credentialCache.clear();
  credentialCache.set(screenId, { at: Date.now(), state });
  return state;
}

/**
 * Read the `ep` (credential epoch) claim. A token minted before the
 * revocation store existed has no claim → epoch 0, which matches the
 * column default. This is the grandfathering hinge; do not "tighten" it
 * to reject absent claims without first confirming the whole fleet has
 * re-registered (every screen rotates on its next /screens/register).
 */
export function epochFromClaim(decoded: any): number {
  const raw = decoded?.ep;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.floor(raw));
  return 0;
}

/**
 * Is `presented` an acceptable epoch for this screen right now?
 * Current epoch always passes; the immediately-previous one passes while
 * inside the rotation grace window (see CREDENTIAL_EPOCH_GRACE_MS).
 */
export function isEpochAcceptable(
  presented: number,
  state: Pick<DeviceCredentialState, 'credentialEpoch' | 'credentialEpochRotatedAt'>,
  now: number = Date.now(),
): boolean {
  const current = Number(state.credentialEpoch ?? 0) || 0;
  if (presented === current) return true;
  if (presented === current - 1 && state.credentialEpochRotatedAt) {
    return now - new Date(state.credentialEpochRotatedAt).getTime() < CREDENTIAL_EPOCH_GRACE_MS;
  }
  return false;
}

/** Verify signature + kind + subject. No DB, no Redis — pure crypto. */
export function decodeDeviceBearer(
  req: ExpressReq,
  screenId: string,
): { ok: true; token: string; decoded: any } | { ok: false; reason: string } {
  const auth = req.headers.authorization;
  if (!auth || typeof auth !== 'string' || !auth.toLowerCase().startsWith('bearer ')) {
    return { ok: false, reason: 'no_auth' };
  }
  const token = auth.slice(7).trim();
  try {
    const secret = requireSecret('DEVICE_JWT_SECRET', {
      devFallback: 'dev_only_device_jwt_secret_CHANGE_ME',
    });
    // DT-12: explicit algorithm allowlist. jsonwebtoken currently refuses
    // `alg:none` and pins HS* for string secrets by default, but that is a
    // library default, not our guarantee. Say it out loud.
    const decoded = jwt.verify(token, secret, { algorithms: DEVICE_JWT_ALGORITHMS }) as any;
    if (decoded?.kind !== 'device') return { ok: false, reason: 'wrong_token_kind' };
    if (decoded?.sub !== screenId) return { ok: false, reason: 'subject_mismatch' };
    return { ok: true, token, decoded };
  } catch (e) {
    return { ok: false, reason: `jwt_invalid:${(e as Error).message}` };
  }
}

/**
 * Legacy short-lived HMAC header, kept verbatim so already-shipped player
 * binaries that predate the JWT path keep working:
 *   X-Device-Auth: `${timestampMs}.${hex(hmac_sha256(DEVICE_SECRET_KEY, screenId + ':' + ts))}`
 * Valid for 2 minutes. It proves possession of a server-side secret and is
 * inherently short-lived, so there is no epoch to check — but the caller
 * still runs it through the live-row checks below.
 */
function verifyDeviceHmacHeader(
  req: ExpressReq,
  screenId: string,
): { ok: true } | { ok: false; reason: string } {
  const hmacHeader = req.headers['x-device-auth'];
  if (typeof hmacHeader !== 'string' || !hmacHeader.includes('.')) {
    return { ok: false, reason: 'no_auth' };
  }
  const [tsStr, sig] = hmacHeader.split('.');
  const ts = Number(tsStr);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'hmac_ts_bad' };
  if (Math.abs(Date.now() - ts) > 2 * 60 * 1000) return { ok: false, reason: 'hmac_expired' };
  const secret = requireSecret('DEVICE_SECRET_KEY', {
    devFallback: 'dev_only_device_secret_CHANGE_ME',
  });
  const expected = crypto.createHmac('sha256', secret).update(`${screenId}:${ts}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return { ok: false, reason: 'hmac_sig_bad' };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'hmac_sig_bad' };
  return { ok: true };
}

/**
 * THE device-auth gate. Every device-authenticated route calls this.
 *
 * `opts.allowUnpaired` (default true) keeps the pre-claim flows working —
 * a screen picks its orientation on the pairing splash before any tenant
 * exists. Routes that touch tenant data pass `false`.
 */
export async function verifyDeviceForScreen(
  deps: { prisma: DeviceAuthPrisma; redis?: DeviceAuthRedis | null },
  req: ExpressReq,
  screenId: string,
  opts: { allowUnpaired?: boolean } = {},
): Promise<DeviceAuthResult> {
  const allowUnpaired = opts.allowUnpaired !== false;

  const bearer = decodeDeviceBearer(req, screenId);
  let token: string | null = null;
  let presentedEpoch = 0;
  let epochChecked = false;

  if (bearer.ok) {
    token = bearer.token;
    presentedEpoch = epochFromClaim(bearer.decoded);
    epochChecked = true;
  } else if (bearer.reason === 'no_auth') {
    const hmac = verifyDeviceHmacHeader(req, screenId);
    if (!hmac.ok) return { ok: false, reason: hmac.reason };
  } else {
    return { ok: false, reason: bearer.reason };
  }

  // Token-string revocation. Fail CLOSED exactly like JwtAuthGuard: if we
  // cannot confirm the token is not revoked, we deny. RedisService already
  // falls back to the Postgres `revoked_credentials` mirror when Redis is
  // down, and the mirror's expiry is derived from the JWT's own `exp` —
  // so a 180-day device token's revocation row lives 180 days, not 30.
  //
  // The `typeof` guard distinguishes two different situations that must
  // NOT be conflated: "no revocation store is wired into this process at
  // all" (dev / unit tests — skip; the credential epoch below is still
  // authoritative and lives in Postgres), versus "the store is wired and
  // the lookup FAILED" (an infrastructure fault — deny, fail closed,
  // exactly as JwtAuthGuard does). Never relax the second branch.
  if (token && typeof deps.redis?.sismember === 'function') {
    try {
      if (await deps.redis.sismember('jwt_revoked_list', token)) {
        return { ok: false, reason: 'token_revoked' };
      }
    } catch {
      return { ok: false, reason: 'revocation_check_unavailable' };
    }
  }

  const state = await loadCredentialState(deps.prisma, screenId);
  // A deleted screen row is a complete credential kill: there is nothing
  // left to authenticate against.
  if (!state) return { ok: false, reason: 'screen_not_found' };
  if (state.status === 'REVOKED') return { ok: false, reason: 'screen_revoked' };
  if (!allowUnpaired && !state.tenantId) return { ok: false, reason: 'screen_unpaired' };
  if (epochChecked && !isEpochAcceptable(presentedEpoch, state)) {
    return { ok: false, reason: 'credential_epoch_stale' };
  }

  return { ok: true, sub: screenId, screen: state, tenantId: state.tenantId, token };
}
