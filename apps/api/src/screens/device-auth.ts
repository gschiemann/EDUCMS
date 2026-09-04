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
 * SEC-001 (2026-09-04) — AND A CREDENTIAL MUST BE PROVEN.
 * The list above was the whole gate, and it never asked the one question that
 * matters most: did the caller ever demonstrate possession of this screen?
 * `POST /screens/register` mints a token from a device FINGERPRINT alone and
 * stamps `unproven: true` (DEVAUTH-01, 2026-08-04) — but nothing read the
 * claim, so that token authenticated every route this file protects. Two
 * anonymous requests turned "I have seen this screen's dashboard row" into a
 * bearer credential for a paired, life-safety display: read its manifest and
 * emergency state, mint stream tickets, forge its render proof, and call
 * `POST /screens/unpair/:fingerprint`, which deletes its schedules and cuts it
 * out of its emergency channel. A fingerprint leaks through physical access,
 * support tickets, `GET /screens` and fleet exports; it is an identifier, not
 * a secret.
 *
 * So step 0 is now: an `unproven` (bootstrap-audience) credential is REFUSED,
 * with `reason: 'credential_unproven'`, unless the route passes the explicit
 * `allowUnproven: true`. NO PRODUCTION ROUTE PASSES IT. Both permissive
 * options (`allowUnpaired` too) now default to the safe value, so a device
 * route added later fails closed instead of inheriting a weak credential by
 * saying nothing — which is exactly how `/unpair` came to accept one.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: it does not darken a screen. The
 * guard-protected manifest (`GET /screens/:id/manifest`) is a different code
 * path (`JwtAuthGuard` + `DeviceIdentityInterceptor`) and still serves an
 * unproven credential, because it is the documented HTTP-polling backstop that
 * delivers a lockdown to a screen whose credential has gone unproven. That
 * interceptor refuses every unproven WRITE. The split is: an unproven
 * credential may read what its own screen already displays; it may never write,
 * never mint a secondary credential, and never touch pairing.
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
import {
  stampRepairRequired,
  type RepairStampPrisma,
} from '../security/repair-required-stamp';
import { requireSecret } from '../security/required-secret';
import { invalidateManifestPreamble } from './manifest-hot-cache';

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
 * SEC-001 (2026-09-04) — the BOOTSTRAP audience.
 *
 * A credential minted from a device FINGERPRINT alone is not a device
 * credential. A fingerprint is a stable identifier, not a secret: the
 * dashboard shows one with a copy button, `GET /screens` carries it, and it
 * turns up in support tickets, OTA logs and fleet exports. Anything a
 * fingerprint can mint is therefore reachable by anyone who has ever seen the
 * screen's row.
 *
 * Two independent markers say so on the token itself, because a mint path that
 * forgets one must still be refused by the other:
 *   • `unproven: true` — the DEVAUTH-01 claim (2026-08-04), already deployed;
 *   • `aud` — this value, added by SEC-001 so a POSITIVE identification of the
 *     bootstrap audience exists rather than only the absence of a claim.
 *
 * Deliberately NOT the `purpose` claim: `JwtAuthGuard` rejects any token
 * carrying a truthy `purpose` outright (AUTH-01), which would take the
 * manifest — the life-safety read that keeps an alert reaching a screen whose
 * credential went unproven — down with it. `aud` is inert to every verifier in
 * this repo unless one explicitly asks for it, which is exactly what is wanted:
 * a marker that narrows, never one that widens.
 */
export const DEVICE_TOKEN_AUD_BOOTSTRAP = 'venueos:device-bootstrap';

/** Refusal reason for a bootstrap credential presented on a device route. */
export const DEVICE_AUTH_REASON_UNPROVEN = 'credential_unproven';

/**
 * Does this decoded token carry a BOOTSTRAP credential's markers?
 *
 * Either marker alone is enough. Exported so the interceptor, the register
 * handler and the route-inventory spec all ask the same question of the same
 * function — this predicate is the whole gate, and a second copy of it is how
 * DT-05 happened.
 */
export function isUnprovenDeviceClaim(decoded: unknown): boolean {
  if (!decoded || typeof decoded !== 'object') return false;
  const claims = decoded as { unproven?: unknown; aud?: unknown };
  if (claims.unproven === true) return true;
  const aud = claims.aud;
  if (aud === DEVICE_TOKEN_AUD_BOOTSTRAP) return true;
  return Array.isArray(aud) && aud.includes(DEVICE_TOKEN_AUD_BOOTSTRAP);
}

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

/**
 * Minimal Prisma surface this module needs — keeps it unit-testable.
 *
 * The `screen.updateMany` / `screenEvent` members come from
 * `RepairStampPrisma` and are OPTIONAL there: they exist only so this
 * verifier can record `authState = REPAIR_REQUIRED` when it refuses an
 * unproven credential (2026-09-04). Every existing test double keeps
 * satisfying the interface; a double without them simply records no verdict.
 */
export type DeviceAuthPrisma = {
  client: RepairStampPrisma['client'] & {
    screen: RepairStampPrisma['client']['screen'] & {
      findUnique: (args: any) => Promise<any>;
    };
  };
};

/** Minimal Redis surface — `sismember` against `jwt_revoked_list`. */
export interface DeviceAuthRedis {
  sismember: (key: string, member: string) => Promise<boolean>;
}

/**
 * Shared (cross-replica) credential-snapshot TTL, in seconds.
 *
 * Capped at 30 s deliberately (efficiency program 2026-09-02): this tier
 * exists so the 10 s emergency-revision poll does not become one Postgres
 * read per screen per poll, NOT to lengthen how long a revoked credential
 * survives. Correctness comes from the explicit DEL that every revocation
 * writer already triggers through `invalidateDeviceCredentialCache`; the TTL
 * is only a backstop for a writer whose Redis DEL failed.
 */
export const CREDENTIAL_SHARED_TTL_SECONDS = 30;

/**
 * Credential-snapshot age the global `DeviceIdentityInterceptor` accepts
 * (efficiency L1 — 2026-09-03). NAMED BEHAVIOUR CHANGE, not a silent one:
 * it was the 5 s default, which at the player's 60 s manifest reconcile meant
 * one Postgres read per screen per poll purely to re-derive an identity that
 * had not moved — the largest single remaining read on the fleet's hot path.
 *
 * The guarantee is UNCHANGED, because it never rested on this TTL:
 *   • a revoke / epoch rotation / re-pair / unpair / delete calls
 *     `invalidateDeviceCredentialCache`, which drops the in-process entry AND
 *     DELs the cross-replica copy — so the device is refused on its VERY NEXT
 *     request, with no window beyond one already-in-flight request;
 *   • `shouldInvalidateDeviceCredential` (wired into the Prisma mutation hook)
 *     catches any writer that forgets to;
 *   • Postgres remains the sole authority — a miss at any tier reads it, and
 *     a negative is never published cross-replica.
 * The TTL is only the backstop for a writer whose Redis DEL failed, and it is
 * capped at the shared-store TTL so the two tiers cannot disagree.
 */
export const DEVICE_IDENTITY_CREDENTIAL_MAX_AGE_MS = CREDENTIAL_SHARED_TTL_SECONDS * 1000;

/**
 * Cross-replica store for the credential snapshot. Optional: when unset
 * (unit tests, no Redis) every read falls through to Postgres exactly as it
 * did before this tier existed.
 *
 * FAIL-SAFE CONTRACT (do not weaken): every method resolves, never throws. A
 * `get` that cannot answer returns `null`, which is a MISS (→ Postgres),
 * never a pass. Nothing here may turn a negative — revoked, missing — into a
 * positive.
 */
export interface DeviceCredentialSharedStore {
  get(screenId: string): Promise<string | null>;
  set(screenId: string, value: string, ttlSeconds: number): Promise<boolean>;
  del(screenId: string): Promise<boolean>;
}

let sharedStore: DeviceCredentialSharedStore | null = null;

/**
 * Register (or clear) the cross-replica snapshot store. Called once at boot
 * from `ScreensController`'s constructor, which is where a Redis handle and
 * this module first meet. Registration is deliberately global: the DEL half
 * must fire for EVERY revocation writer, not only the ones that happen to
 * hold a Redis reference.
 */
export function setDeviceCredentialSharedStore(store: DeviceCredentialSharedStore | null): void {
  sharedStore = store;
}

export function encodeCredentialState(state: DeviceCredentialState | null): string {
  if (!state) return 'null';
  return JSON.stringify({
    id: state.id,
    tenantId: state.tenantId,
    screenGroupId: state.screenGroupId,
    status: state.status,
    credentialEpoch: state.credentialEpoch,
    credentialEpochRotatedAt: state.credentialEpochRotatedAt
      ? new Date(state.credentialEpochRotatedAt).getTime()
      : null,
  });
}

/**
 * Tolerant decoder. Anything unrecognised reads as `undefined` = MISS, so a
 * corrupted or forward-version payload can never be mistaken for a valid
 * credential — fail toward the database, never toward a pass.
 */
export function decodeCredentialState(
  raw: string | null,
): DeviceCredentialState | null | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (raw === 'null') return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const row = parsed as Record<string, unknown>;
    if (typeof row.id !== 'string' || typeof row.status !== 'string') return undefined;
    const rotated = row.credentialEpochRotatedAt;
    return {
      id: row.id,
      tenantId: typeof row.tenantId === 'string' ? row.tenantId : null,
      screenGroupId: typeof row.screenGroupId === 'string' ? row.screenGroupId : null,
      status: row.status,
      credentialEpoch: typeof row.credentialEpoch === 'number' ? row.credentialEpoch : 0,
      credentialEpochRotatedAt: typeof rotated === 'number' ? new Date(rotated) : null,
    };
  } catch {
    return undefined;
  }
}

// ── Credential snapshot cache ────────────────────────────────────────────
const credentialCache = new Map<string, { at: number; state: DeviceCredentialState | null }>();

/**
 * Screen columns the credential snapshot is derived from.
 *
 * A write to any of these makes a cached snapshot wrong, so the Prisma
 * mutation hook (`prisma.service.ts`) drops the snapshot whenever one appears
 * in an UPDATE's data keys — see `shouldInvalidateDeviceCredential`.
 *
 * `status` IS in the snapshot but is deliberately NOT in this set: every
 * heartbeat, register and manifest ping writes `status` alongside
 * `lastPingAt`, so listing it here would drop the snapshot on essentially
 * every device request and delete the cache's reason to exist. The only
 * status transition the snapshot must react to is → REVOKED, and that has
 * exactly ONE writer (`revokeScreenCredentials`, device-credentials.ts),
 * which calls the invalidator itself. Verified 2026-09-03: no other
 * `status: 'REVOKED'` write exists in apps/api/src.
 */
export const CREDENTIAL_SNAPSHOT_TRIGGER_FIELDS = new Set([
  'tenantId',
  'screenGroupId',
  'credentialEpoch',
  'credentialEpochRotatedAt',
]);

/**
 * Pure decision fn for the Prisma mutation hook: does this operation make a
 * cached credential snapshot (and therefore also the manifest preamble that
 * shares its invalidation) wrong? Exported for unit tests.
 *
 * This is the SAFETY NET, not the mechanism — every known writer already
 * calls `invalidateDeviceCredentialCache` explicitly. It exists because the
 * writers that did NOT (a group re-assign in `screen-groups.controller.ts`, a
 * group delete's unassign, the admin screen-update route's `screenGroupId`
 * patch) were only discoverable by reading every file that touches `Screen`,
 * and the next one added will not be.
 *
 * @param updateDataKeys Object.keys(args.data) for update/updateMany, else null.
 */
export function shouldInvalidateDeviceCredential(
  model: string | undefined,
  action: string | undefined,
  updateDataKeys: string[] | null,
): boolean {
  if (model !== 'Screen' || !action) return false;
  // Deleting the row IS a complete credential kill (`screen_not_found`), so a
  // stale positive snapshot would keep a dead screen authenticating.
  if (action === 'delete' || action === 'deleteMany') return true;
  if (action === 'update' || action === 'updateMany' || action === 'upsert') {
    // Unknown shape (no plain `data` object — e.g. a nested write) → drop.
    // Fail toward a re-read; the cost is one indexed query.
    if (updateDataKeys === null) return true;
    return updateDataKeys.some((k) => CREDENTIAL_SNAPSHOT_TRIGGER_FIELDS.has(k));
  }
  return false;
}

/**
 * Drop a screen's cached credential snapshot. EVERY writer that changes
 * `credentialEpoch`, `status`, or `tenantId` must call this, or a revoke
 * lingers for up to CREDENTIAL_CACHE_TTL_MS on the replica that performed
 * it — which is the one place we can and therefore must be exact.
 */
export function invalidateDeviceCredentialCache(screenId?: string): void {
  if (screenId) credentialCache.delete(screenId);
  else credentialCache.clear();
  // The manifest identity preamble is a SUPERSET of this snapshot (it holds
  // the whole Screen row), so anything that retires a credential must retire
  // it too — otherwise a re-pair, an unpair or a revoke would drop the
  // credential copy while `getManifest` kept building from the old row's
  // tenantId. One invalidation call, two tiers, no way to update one and
  // forget the other.
  invalidateManifestPreamble(screenId);
  // Drop the cross-replica copy too, so a revoke performed on THIS replica is
  // enforced on every OTHER replica's very next request rather than at the end
  // of its TTL. Fire-and-forget and never awaited: a Redis outage must not be
  // able to fail a revocation (the `credentialEpoch` in Postgres remains the
  // authority and the 30 s TTL bounds the window regardless).
  if (screenId && sharedStore) {
    try {
      void sharedStore.del(screenId)?.catch(() => {
        /* TTL is the backstop */
      });
    } catch {
      /* TTL is the backstop */
    }
  }
}

// ── Request-scoped device context (efficiency L1 — 2026-09-03) ───────────
//
// The tiers above are TIME-scoped (5 s in-process, 30 s cross-replica). This
// one is REQUEST-scoped: within a single HTTP request the same screen row was
// being read more than once — the global `DeviceIdentityInterceptor` reads it
// to re-derive the principal (DT-03), then the handler reads it again for its
// own checks. Two round trips, on a `connection_limit=10` pool, to answer a
// question whose answer cannot change between them.
//
// It carries the max-age it was satisfied at, and a reader that needs a
// STRICTER freshness than the stored entry re-loads. That is what keeps
// `/emergency-rev`'s two-pass design intact: pass 1 may run on the extended
// 30 s window, and pass 2's normal-freshness re-verify is NOT allowed to be
// answered by pass 1's entry.
const DEVICE_REQUEST_CONTEXT = Symbol.for('venueos.deviceRequestContext');

interface DeviceRequestContextEntry {
  screenId: string;
  state: DeviceCredentialState | null;
  /** The freshness bound this entry was loaded under. */
  maxAgeMs: number;
}

/** Test/diagnostic hook — the entry currently attached to a request, if any. */
export function readDeviceRequestContext(
  req: unknown,
  screenId: string,
  maxAgeMs: number,
): { hit: true; state: DeviceCredentialState | null } | { hit: false } {
  if (!req || typeof req !== 'object') return { hit: false };
  const entry = (req as Record<symbol, unknown>)[DEVICE_REQUEST_CONTEXT] as
    | DeviceRequestContextEntry
    | undefined;
  if (!entry || entry.screenId !== screenId) return { hit: false };
  // A stricter requirement than the entry was loaded under must re-read.
  if (entry.maxAgeMs > maxAgeMs) return { hit: false };
  return { hit: true, state: entry.state };
}

function writeDeviceRequestContext(
  req: unknown,
  entry: DeviceRequestContextEntry,
): void {
  if (!req || typeof req !== 'object') return;
  try {
    (req as Record<symbol, unknown>)[DEVICE_REQUEST_CONTEXT] = entry;
  } catch {
    /* frozen/proxied request object — the time-scoped tiers still apply */
  }
}

/**
 * Publish a credential snapshot derived from a row THIS request just read
 * from Postgres, so a later reader in the same request (or the next request
 * inside the memo window) does not pay for it again.
 *
 * Only ever called with a live-row read — never with a cached one — so it
 * cannot launder a stale snapshot into a fresher tier. Negatives are still
 * never published cross-replica; this only touches the in-process tiers.
 */
export function publishDeviceCredentialState(
  req: unknown,
  screenId: string,
  row: {
    id?: unknown;
    tenantId?: unknown;
    screenGroupId?: unknown;
    status?: unknown;
    credentialEpoch?: unknown;
    credentialEpochRotatedAt?: unknown;
  } | null,
): DeviceCredentialState | null {
  const state: DeviceCredentialState | null = row
    ? {
        id: typeof row.id === 'string' ? row.id : screenId,
        tenantId: typeof row.tenantId === 'string' ? row.tenantId : null,
        screenGroupId: typeof row.screenGroupId === 'string' ? row.screenGroupId : null,
        status: String(row.status ?? ''),
        credentialEpoch: Number(row.credentialEpoch ?? 0) || 0,
        credentialEpochRotatedAt: (row.credentialEpochRotatedAt as Date | null) ?? null,
      }
    : null;
  credentialCache.set(screenId, { at: Date.now(), state });
  writeDeviceRequestContext(req, { screenId, state, maxAgeMs: 0 });
  return state;
}

/**
 * Load (and memoise) a screen's credential snapshot. Exported so the
 * global `DeviceIdentityInterceptor` shares this cache rather than adding
 * a second lookup per request.
 *
 * `req`, when supplied, adds the request-scoped tier described above.
 */
export async function loadDeviceCredentialState(
  deps: { prisma: DeviceAuthPrisma },
  screenId: string,
  maxAgeMs: number = CREDENTIAL_CACHE_TTL_MS,
  req?: unknown,
): Promise<DeviceCredentialState | null> {
  const effective = maxAgeMs > CREDENTIAL_CACHE_TTL_MS ? maxAgeMs : CREDENTIAL_CACHE_TTL_MS;
  if (req !== undefined) {
    const scoped = readDeviceRequestContext(req, screenId, effective);
    if (scoped.hit) return scoped.state;
  }
  const state = await loadCredentialState(deps.prisma, screenId, maxAgeMs);
  if (req !== undefined) {
    writeDeviceRequestContext(req, { screenId, state, maxAgeMs: effective });
  }
  return state;
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
  maxAgeMs: number = CREDENTIAL_CACHE_TTL_MS,
): Promise<DeviceCredentialState | null> {
  const hit = credentialCache.get(screenId);
  // An OPT-IN longer window (only `GET /screens/:id/emergency-rev` passes one
  // today). Never shorter than the 5 s default, so no existing caller's
  // freshness changes.
  const age = maxAgeMs > CREDENTIAL_CACHE_TTL_MS ? maxAgeMs : CREDENTIAL_CACHE_TTL_MS;
  if (hit && Date.now() - hit.at < age) return hit.state;

  // Cross-replica tier — consulted ONLY by a caller that asked for the
  // extended window. The default 5 s path is byte-for-byte what it was: in
  // process cache, then Postgres. A miss (absent key, unreachable Redis,
  // unparseable payload) falls through to Postgres exactly as today.
  if (maxAgeMs > CREDENTIAL_CACHE_TTL_MS && sharedStore) {
    let shared: DeviceCredentialState | null | undefined;
    try {
      shared = decodeCredentialState(await sharedStore.get(screenId));
    } catch {
      shared = undefined;
    }
    if (shared !== undefined) {
      credentialCache.set(screenId, { at: Date.now(), state: shared });
      return shared;
    }
  }

  // the DT-03 fix — re-deriving tenantId from the live row instead of trusting
  // the token's 365-day tenantId claim. Adding tenantId to the where-clause
  // would reintroduce exactly the stale-claim trust this removes.
  const row = (await prisma.client.screen.findUnique({ // ten-ok: identity-derived self-lookup — screenId is the verified device JWT sub; this IS the DT-03 fix (derive tenant from the live row)
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
  // Publish to the cross-replica tier (fire-and-forget; a failed write just
  // means the next replica pays a Postgres read). Written on EVERY refresh,
  // not only the extended-window path, so the tier is warm by the time a rev
  // poll asks for it — but still only ever READ by an opt-in caller.
  //
  // NEGATIVES ARE NEVER PUBLISHED to the cross-replica tier. A `null` state
  // means "no such screen row", and while the in-process tier has always
  // memoised that (fail-CLOSED, so it can only ever deny), letting it travel
  // between replicas would put a 30 s "this screen does not exist" answer in
  // shared storage — the same shape as the tombstone bug this spec already
  // caught once. A shared miss costs one indexed read; a shared negative
  // costs a working device up to 30 s of 401s. Only positives are published.
  if (sharedStore && state) {
    // try/catch around the CALL, not just the promise: a store whose method
    // throws synchronously would otherwise escape into every
    // device-authenticated route, not just the one that wanted the tier.
    try {
      void sharedStore.set(screenId, encodeCredentialState(state), CREDENTIAL_SHARED_TTL_SECONDS)
        ?.catch(() => {
          /* best-effort */
        });
    } catch {
      /* best-effort */
    }
  }
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
 * ── SEC-001 realtime (2026-09-04) — ONE ADMISSION PREDICATE, THREE TRANSPORTS ──
 *
 * SEC-001 closed the bootstrap-credential hole for HTTP and stopped there,
 * because HTTP was the only surface that ran this file. The WebSocket gateway
 * and the SSE controller each carried their OWN hand-rolled copy of "is this a
 * valid device token", and neither copy asked the question this module exists
 * to ask:
 *
 *   • `realtime.gateway.ts` `processHello` verified a signature, checked the
 *     exact-token denylist, loaded the screen row for its tenant binding — and
 *     then set `isAuthenticated = true`. It never checked `kind`, never pinned
 *     the algorithm, never looked at `Screen.status`, never looked at
 *     `credentialEpoch`, and never looked at `unproven` / the bootstrap
 *     audience. A fingerprint-minted bootstrap token was therefore a full
 *     realtime principal: it received the screen's tenant-, group- and
 *     device-scoped emergency traffic, could forge delivery ACKs and heartbeat
 *     liveness (making a dark screen look connected), and — because it counted
 *     against `MAX_SOCKETS_PER_DEVICE` — could repeatedly evict the real
 *     kiosk's socket and knock it down to the polling fallback.
 *   • `sse.controller.ts`'s legacy `?token=` leg did check kind, live status
 *     and epoch, but not `unproven` / the bootstrap audience, and it verified
 *     the JWT with no `algorithms` allowlist.
 *
 * A second copy of the predicate is exactly how DT-05 happened (three
 * byte-similar `verifyDeviceForScreen`s that had each drifted). So there is now
 * ONE: `admitDeviceCredential` below. `verifyDeviceForScreen` (HTTP), the WS
 * gateway and the SSE controller all call it, and a check added here is a check
 * every transport gets.
 *
 * WHAT THIS DELIBERATELY DOES NOT TOUCH — read before "tidying" it. The
 * guard-protected manifest read (`GET /screens/:id/manifest`, `JwtAuthGuard` +
 * `DeviceIdentityInterceptor`) STILL accepts a bootstrap credential, on purpose:
 * it is CLAUDE.md emergency safeguard #4, the HTTP-polling backstop that
 * delivers a lockdown to a screen whose credential has gone unproven. Closing
 * the realtime hole must not open a life-safety one. The split is unchanged and
 * is the same capability shape `security/revocation-posture.ts` uses for its
 * one named exception: an unproven credential may READ what its own screen
 * already displays; it may never write, never mint a secondary credential,
 * never open a push channel, and never touch pairing.
 */

/** Refusal reason: the token carries no usable subject claim. */
export const DEVICE_AUTH_REASON_NO_SUBJECT = 'subject_missing';

export interface DeviceCredentialAdmissionOptions {
  /**
   * When set, the token's subject must equal this screen id. HTTP always sets
   * it (the id is in the path); the realtime transports learn the id FROM the
   * token, so they leave it unset at admission and pass the admitted id on
   * re-validation.
   */
  expectedScreenId?: string;
  /** See `verifyDeviceForScreen` — same meaning, same fail-closed default. */
  allowUnpaired?: boolean;
  /** See `verifyDeviceForScreen` — same meaning, same fail-closed default. */
  allowUnproven?: boolean;
  credentialMaxAgeMs?: number;
  /** Express request, when the caller has one (adds the request-scoped tier). */
  req?: unknown;
}

export type DeviceCredentialAdmission =
  | {
      ok: true;
      /** The screen this credential names. Verified against the live row. */
      screenId: string;
      /** The raw bearer string — retained so a caller can re-check the denylist. */
      token: string;
      /** Verified claims. Identity fields below come from the ROW, not from here. */
      decoded: any;
      screen: DeviceCredentialState;
      /** Live tenant. `null` only when `allowUnpaired` was passed. */
      tenantId: string | null;
      /** Live group — never a token claim (a moved screen's claim goes stale). */
      screenGroupId: string | null;
      /** The LIVE row's epoch (what a long-lived connection should carry). */
      credentialEpoch: number;
      /** The epoch the token presented. */
      presentedEpoch: number;
    }
  | { ok: false; reason: string };

/**
 * Refusals that mean the credential has been RETIRED — the set a periodic
 * re-validation of an already-open connection may act on by closing it.
 *
 * Deliberately does NOT include `revocation_check_unavailable` (an
 * infrastructure fault, not a verdict) or `jwt_invalid:*`. Admission fails
 * closed on both; a LIVE connection is different. Dropping every socket in the
 * fleet because Redis and Postgres blinked would take the push channel that
 * carries lockdown alerts down during exactly the incident most likely to
 * coincide with a real emergency — the same reasoning as
 * `REVOCATION_CONTINUITY_GRACE_MS` and `SseService.tickRevocation`'s fail-open
 * sweep. Plain expiry is likewise not a retirement: it is not an operator
 * action, the holder is still the screen the token names, and a bootstrap
 * token can no longer get in at all — so closing on it would only cost a real
 * kiosk its push tier while its renewal is in flight.
 */
export const DEVICE_CREDENTIAL_RETIRED_REASONS: ReadonlySet<string> = new Set([
  'token_revoked',
  'screen_not_found',
  'screen_revoked',
  'screen_unpaired',
  'credential_epoch_stale',
  'wrong_token_kind',
  'subject_mismatch',
  DEVICE_AUTH_REASON_NO_SUBJECT,
  DEVICE_AUTH_REASON_UNPROVEN,
]);

/** Should a re-validation close an already-open connection for this reason? */
export function isRetiredDeviceCredentialReason(reason: string): boolean {
  return DEVICE_CREDENTIAL_RETIRED_REASONS.has(reason);
}

/**
 * THE device-credential admission. Everything that admits a device — HTTP
 * route, WebSocket HELLO, SSE stream — goes through here.
 *
 * Order matters and is the same order `verifyDeviceForScreen` has always used:
 *
 *   1. Cryptography — HS256 only (explicit allowlist, never a library default),
 *      `kind === 'device'`, a subject claim that agrees with itself and with
 *      the caller's expectation.
 *   2. SEC-001 — a BOOTSTRAP (`unproven` / bootstrap-audience) credential is
 *      refused BEFORE any Redis or Postgres work. The signature is already
 *      verified at that point, so the claim is ours, not the caller's; refusing
 *      here also means a fingerprint-scanning attacker cannot spend the
 *      `connection_limit=10` pool on a credential we were always going to
 *      reject — which matters most on the WS gateway, where RT-01 exists
 *      precisely because HELLO is the expensive frame.
 *   3. Token-string revocation — fail CLOSED (`RedisService.sismember` throws
 *      `RevocationIndeterminateError` when neither store can answer; SEC-012's
 *      continuity exception is for safe HTTP READS only and never for a push
 *      channel).
 *   4. Live row — must exist, must not be REVOKED, must be paired unless the
 *      caller opted out, epoch must still be acceptable.
 *   5. Identity comes FROM THE ROW (DT-03). Never from a claim.
 */
export async function admitDeviceCredential(
  deps: { prisma: DeviceAuthPrisma; redis?: DeviceAuthRedis | null },
  rawToken: string | null | undefined,
  opts: DeviceCredentialAdmissionOptions = {},
): Promise<DeviceCredentialAdmission> {
  if (typeof rawToken !== 'string' || rawToken.trim() === '') {
    return { ok: false, reason: 'no_auth' };
  }
  const token = rawToken.trim();

  let decoded: any;
  try {
    const secret = requireSecret('DEVICE_JWT_SECRET', {
      devFallback: 'dev_only_device_jwt_secret_CHANGE_ME',
    });
    // DT-12: explicit algorithm allowlist, not a library default. The SSE leg
    // was verifying with no `algorithms` option at all until SEC-001-realtime.
    decoded = jwt.verify(token, secret, { algorithms: DEVICE_JWT_ALGORITHMS }) as any;
  } catch (e) {
    return { ok: false, reason: `jwt_invalid:${(e as Error).message}` };
  }

  if (decoded?.kind !== 'device') return { ok: false, reason: 'wrong_token_kind' };

  // `mintDeviceJwt` writes the SAME screen id into `sub` and `deviceId`. HTTP
  // has always read `sub`; the WS gateway reads `deviceId || sub`. Refusing a
  // token whose two claims disagree is what makes those two readings provably
  // identical, so no transport can be steered to a different screen than
  // another transport would resolve from the same bytes.
  const sub = typeof decoded?.sub === 'string' && decoded.sub ? decoded.sub : '';
  const deviceIdClaim =
    typeof decoded?.deviceId === 'string' && decoded.deviceId ? decoded.deviceId : '';
  if (sub && deviceIdClaim && sub !== deviceIdClaim) {
    return { ok: false, reason: 'subject_mismatch' };
  }
  const screenId = sub || deviceIdClaim;
  if (!screenId) return { ok: false, reason: DEVICE_AUTH_REASON_NO_SUBJECT };
  if (opts.expectedScreenId !== undefined && screenId !== opts.expectedScreenId) {
    return { ok: false, reason: 'subject_mismatch' };
  }

  // SEC-001 — the unproven refusal. See the ordering note above.
  if (opts.allowUnproven !== true && isUnprovenDeviceClaim(decoded)) {
    return { ok: false, reason: DEVICE_AUTH_REASON_UNPROVEN };
  }

  // Token-string revocation, fail CLOSED. The `typeof` guard distinguishes
  // "no revocation store is wired into this process at all" (dev / unit tests
  // — skip; the credential epoch below lives in Postgres and is still
  // authoritative) from "the store is wired and the lookup FAILED" (deny).
  // Never relax the second branch.
  if (typeof deps.redis?.sismember === 'function') {
    try {
      if (await deps.redis.sismember('jwt_revoked_list', token)) {
        return { ok: false, reason: 'token_revoked' };
      }
    } catch {
      return { ok: false, reason: 'revocation_check_unavailable' };
    }
  }

  const state = await loadDeviceCredentialState(
    { prisma: deps.prisma },
    screenId,
    opts.credentialMaxAgeMs ?? CREDENTIAL_CACHE_TTL_MS,
    opts.req,
  );
  // A deleted screen row is a complete credential kill.
  if (!state) return { ok: false, reason: 'screen_not_found' };
  if (state.status === 'REVOKED') return { ok: false, reason: 'screen_revoked' };
  if (opts.allowUnpaired !== true && !state.tenantId) {
    return { ok: false, reason: 'screen_unpaired' };
  }
  const presentedEpoch = epochFromClaim(decoded);
  if (!isEpochAcceptable(presentedEpoch, state)) {
    return { ok: false, reason: 'credential_epoch_stale' };
  }

  return {
    ok: true,
    screenId,
    token,
    decoded,
    screen: state,
    tenantId: state.tenantId,
    screenGroupId: state.screenGroupId,
    credentialEpoch: state.credentialEpoch,
    presentedEpoch,
  };
}

/**
 * THE device-auth gate. Every device-authenticated route calls this.
 *
 * BOTH permissive flags FAIL CLOSED (SEC-001, 2026-09-04). A route opts INTO
 * a weaker credential; it can no longer inherit one by saying nothing, which
 * is how `/unpair/:fp` — the route that deletes a screen's schedules and cuts
 * it out of its emergency channel — ended up accepting a token minted from a
 * fingerprint. A route added tomorrow gets the strict answer by default.
 *
 * `opts.allowUnpaired` — the screen has no tenant yet. TRUE only on the
 *   pre-claim flows (a screen picks its orientation, heartbeats and takes OTA
 *   updates on the pairing splash before any tenant exists).
 *
 * `opts.allowUnproven` — the CREDENTIAL was minted without proof of
 *   possession: a bare `POST /screens/register {deviceFingerprint}`. There is
 *   no production caller. Do not add one without reading SEC-001: a
 *   fingerprint is not a secret, so anything reachable with `allowUnproven`
 *   is reachable by anyone who has read the screen's dashboard row.
 */
export async function verifyDeviceForScreen(
  deps: { prisma: DeviceAuthPrisma; redis?: DeviceAuthRedis | null },
  req: ExpressReq,
  screenId: string,
  opts: {
    allowUnpaired?: boolean;
    allowUnproven?: boolean;
    credentialMaxAgeMs?: number;
  } = {},
): Promise<DeviceAuthResult> {
  const allowUnpaired = opts.allowUnpaired === true;

  // ── Bearer path — delegated WHOLESALE to `admitDeviceCredential` ────────
  // (SEC-001 realtime, 2026-09-04). This used to be an inline copy of the
  // checks; it is now the same function the WS gateway and the SSE controller
  // call, so the three transports cannot drift apart again. Every reason
  // string below is unchanged, and so is their order.
  const auth = req.headers.authorization;
  const hasBearer =
    typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ');

  if (hasBearer) {
    const admitted = await admitDeviceCredential(deps, auth.slice(7).trim(), {
      expectedScreenId: screenId,
      allowUnpaired,
      allowUnproven: opts.allowUnproven === true,
      credentialMaxAgeMs: opts.credentialMaxAgeMs,
      req,
    });
    if (!admitted.ok) {
      if (admitted.reason === DEVICE_AUTH_REASON_UNPROVEN) {
        // 2026-09-04 — RECORD THE VERDICT, don't just refuse it. This branch
        // fires on the routes a downgraded screen hits constantly (render
        // proof above all), and before this the refusal was invisible to the
        // fleet UI: the screen kept its `lastPingAt` fresh and stopped proving
        // render, so the dashboard reported a RENDER fault for what is really
        // a credential problem with a one-click fix. Deduped to one statement
        // per screen per 10 minutes and conditional on the current verdict, so
        // it is one state transition, not a write per refused request — see
        // security/repair-required-stamp.ts.
        //
        // Deliberately stamped HERE and not inside the shared admission: this
        // is the surface a downgraded screen polls continuously, so the stamp
        // is already covered for it. Doing it from the realtime transports
        // instead would put a database write behind a device-controlled WS
        // frame, which is the exact amplification RT-01 exists to prevent.
        await stampRepairRequired(deps.prisma, screenId, {
          trigger: 'device-auth-unproven',
        });
      }
      return { ok: false, reason: admitted.reason };
    }
    return {
      ok: true,
      sub: screenId,
      screen: admitted.screen,
      tenantId: admitted.tenantId,
      token: admitted.token,
    };
  }

  // ── Legacy short-lived HMAC header ─────────────────────────────────────
  // No token string to denylist and no epoch claim to check (it proves
  // possession of a server-side secret and expires in 2 minutes), but the
  // live-row checks still run — unchanged from before the refactor.
  const hmac = verifyDeviceHmacHeader(req, screenId);
  if (!hmac.ok) return { ok: false, reason: hmac.reason };

  // Request-scoped first (a handler that calls this twice, or a handler
  // behind the global DeviceIdentityInterceptor, pays for ONE load), then the
  // time-scoped tiers exactly as before.
  const state = await loadDeviceCredentialState(
    { prisma: deps.prisma },
    screenId,
    opts.credentialMaxAgeMs ?? CREDENTIAL_CACHE_TTL_MS,
    req,
  );
  // A deleted screen row is a complete credential kill: there is nothing
  // left to authenticate against.
  if (!state) return { ok: false, reason: 'screen_not_found' };
  if (state.status === 'REVOKED') return { ok: false, reason: 'screen_revoked' };
  if (!allowUnpaired && !state.tenantId) return { ok: false, reason: 'screen_unpaired' };

  return { ok: true, sub: screenId, screen: state, tenantId: state.tenantId, token: null };
}
