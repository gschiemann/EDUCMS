/**
 * SEC-007 (2026-09-04) — short-lived signed capability for the PUBLIC
 * proof-of-play beacons.
 *
 * THE FINDING. `POST /sports/sponsors/:sponsorId/impression` and
 * `POST /sports/board/:id/cts-cue-fired` are deliberately unauthenticated: a
 * stadium board / ribbon / OBS overlay renders with no dashboard session, so it
 * sends no bearer token. Both endpoints check that the sponsor and the game
 * belong to the same tenant, but nothing checks WHO is reporting. Per-replica
 * in-memory rate limits and a short exact-value dedup bound VOLUME; they say
 * nothing about AUTHENTICITY. Those rows are then presented as proof-of-play in
 * sponsor, renewal and contractual reporting.
 *
 * WHAT THIS MODULE IS. A stateless HMAC capability, minted by
 * `POST /sports/board/:id/beacon-capability` and presented on every beacon in
 * the `x-venueos-beacon` header, that binds:
 *
 *   game · scope (impression vs cue) · screen · that screen's credential
 *   epoch · a per-capability nonce · an expiry
 *
 * plus a per-beacon `seq`, claimed once in SHARED state (Redis), so a captured
 * beacon cannot be replayed — on this replica or any other.
 *
 * TWO GRADES, DELIBERATELY. A capability minted against a valid DEVICE
 * CREDENTIAL is `verified`: the beacon is attributable to a specific paired
 * screen at a specific credential epoch, so revoking the screen kills its
 * beacons too. A capability minted with no credential is `unverified` — it
 * still gets replay protection, expiry and a rate-limit identity, but it proves
 * only "some client that could reach the mint endpoint", which is not evidence.
 *
 * WHY UNVERIFIED EXISTS AT ALL. The surfaces that report are not all devices:
 * `/scorebug` runs as an OBS browser source on a producer's laptop, and
 * `/board/:id` is routinely opened in a plain browser driving an LED wall over
 * HDMI. Neither has a device credential and neither can get one. Refusing them
 * would silently zero the proof-of-play report — which is exactly the failure
 * this endpoint was un-guarded to fix in the first place (see the header of
 * `sponsors.controller.ts`). So they keep reporting, and the report SAYS which
 * rows are evidence and which are not, rather than presenting all of it as
 * proof. `SPORTS_BEACON_REQUIRE_VERIFIED=1` turns the strict mode on for a
 * venue that wants contractual-grade counts and runs only paired screens.
 *
 * Secret precedence mirrors `sports-feed-token.ts`: a dedicated
 * `SPORTS_BEACON_SECRET`, else `SPORTS_FEED_SECRET`, else `DEVICE_SECRET_KEY`
 * (boot-validated in production).
 */

import * as crypto from 'crypto';
import { requireSecret } from '../security/required-secret';

export type BeaconScope = 'impression' | 'cue';

/** How long a minted capability stays valid. */
export const BEACON_CAPABILITY_TTL_MS = 30 * 60_000;

/**
 * Max beacons one capability may emit. A board fires roughly one impression
 * per sponsor look (a few seconds apart), so ~600 covers a 30-minute
 * capability with generous headroom; past this the client must re-mint, which
 * re-proves its credential.
 */
export const BEACON_MAX_SEQUENCE = 1200;

const VERSION = 'bc1';

let warnedNoDedicatedSecret = false;

function beaconSecret(): string {
  const dedicated = process.env.SPORTS_BEACON_SECRET || process.env.SPORTS_FEED_SECRET;
  if (dedicated && dedicated.trim().length >= 16) return dedicated;
  if (process.env.NODE_ENV === 'production' && !warnedNoDedicatedSecret) {
    warnedNoDedicatedSecret = true;
    console.error(
      '[sports-beacon] ACTION REQUIRED: neither SPORTS_BEACON_SECRET nor SPORTS_FEED_SECRET is ' +
        'set in production. Beacon capabilities are deriving from DEVICE_SECRET_KEY (shared ' +
        'blast radius with WS/Redis control traffic and BYOK/MFA wrapping).',
    );
  }
  return requireSecret('DEVICE_SECRET_KEY', {
    devFallback: 'dev_only_beacon_secret_CHANGE_ME',
  });
}

/** Everything the signature covers. Field names are short: this rides a header. */
export interface BeaconCapabilityClaims {
  /** Format version. */
  v: 1;
  /** Game the capability is scoped to. */
  g: string;
  /** Which beacon endpoint may accept it. */
  k: BeaconScope;
  /** Screen the beacon is attributable to — null for an unverified capability. */
  s: string | null;
  /** The screen's `credentialEpoch` at mint time (0 when unverified). */
  e: number;
  /**
   * TENANT the capability was minted under — the game's tenant, which the mint
   * endpoint has already proved the screen belonged to. SEC-007 residual #2.
   *
   * OPTIONAL, and absent on every capability minted before 2026-09-05. A
   * capability without it is checked exactly as it was before (screen liveness
   * + epoch), never refused for the missing field: in-flight capabilities live
   * 30 minutes, so a rolling deploy must not invalidate the ones already on
   * the wire.
   */
  t?: string | null;
  /** Per-capability nonce; the replay namespace for its sequence numbers. */
  n: string;
  /** Expiry, epoch SECONDS. */
  x: number;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', beaconSecret()).update(payload).digest('base64url');
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

export interface MintBeaconCapabilityInput {
  gameId: string;
  scope: BeaconScope;
  /** Paired screen this capability speaks for, or null for an unverified one. */
  screenId?: string | null;
  /** The screen's live `credentialEpoch`. Ignored when `screenId` is null. */
  credentialEpoch?: number;
  /**
   * The game's tenant, which the caller has already proved the screen belongs
   * to. Bound into the capability so a screen RE-PAIRED TO ANOTHER TENANT
   * inside the 24 h epoch-rotation grace cannot keep attesting for this one
   * (SEC-007 residual #2). Ignored when `screenId` is null — an anonymous
   * capability attributes nothing, so there is nothing to bind.
   */
  tenantId?: string | null;
  ttlMs?: number;
}

export interface MintedBeaconCapability {
  capability: string;
  /** True when the capability is bound to a proven device credential. */
  verified: boolean;
  expiresAt: number;
  maxSequence: number;
}

export function mintBeaconCapability(input: MintBeaconCapabilityInput): MintedBeaconCapability {
  const ttl =
    typeof input.ttlMs === 'number' && Number.isFinite(input.ttlMs) && input.ttlMs > 0
      ? Math.min(input.ttlMs, BEACON_CAPABILITY_TTL_MS)
      : BEACON_CAPABILITY_TTL_MS;
  const expiresAt = Date.now() + ttl;
  const screenId = input.screenId ? String(input.screenId) : null;
  const tenantId = screenId && input.tenantId ? String(input.tenantId) : null;
  const claims: BeaconCapabilityClaims = {
    v: 1,
    g: input.gameId,
    k: input.scope,
    s: screenId,
    e: screenId ? Math.max(0, Math.floor(Number(input.credentialEpoch) || 0)) : 0,
    n: crypto.randomBytes(12).toString('base64url'),
    x: Math.floor(expiresAt / 1000),
  };
  // Only ever ADD the field — a capability with no tenant binding stays the
  // exact shape older replicas and older boards already sign and verify.
  if (tenantId) claims.t = tenantId;
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return {
    capability: `${VERSION}.${payload}.${sign(payload)}`,
    verified: screenId !== null,
    expiresAt,
    maxSequence: BEACON_MAX_SEQUENCE,
  };
}

export type VerifyBeaconResult =
  | { ok: true; claims: BeaconCapabilityClaims; verified: boolean }
  | { ok: false; reason: string };

/**
 * Verify a presented capability against the game and endpoint it is being used
 * on. Pure crypto — no Redis, no DB. Replay is a SEPARATE, stateful step
 * (`claimBeaconSequence`); a caller that skips it has authenticity without
 * replay protection.
 */
export function verifyBeaconCapability(
  raw: unknown,
  expect: { gameId: string; scope: BeaconScope; now?: number },
): VerifyBeaconResult {
  if (typeof raw !== 'string' || !raw) return { ok: false, reason: 'missing' };
  // Bound the input before any parsing work.
  if (raw.length > 512) return { ok: false, reason: 'malformed' };
  const parts = raw.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [version, payload, mac] = parts;
  if (version !== VERSION) return { ok: false, reason: 'bad_version' };
  if (!safeEq(sign(payload), mac)) return { ok: false, reason: 'bad_signature' };

  let claims: BeaconCapabilityClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!claims || claims.v !== 1) return { ok: false, reason: 'bad_version' };
  if (typeof claims.n !== 'string' || !claims.n) return { ok: false, reason: 'malformed' };
  if (claims.g !== expect.gameId) return { ok: false, reason: 'game_mismatch' };
  if (claims.k !== expect.scope) return { ok: false, reason: 'scope_mismatch' };

  const now = expect.now ?? Date.now();
  if (!Number.isFinite(claims.x) || now > claims.x * 1000) return { ok: false, reason: 'expired' };

  const verified = typeof claims.s === 'string' && claims.s.length > 0;
  return { ok: true, claims, verified };
}

/** Minimal ioredis surface — mirrors `security/ingest-rate-limit.ts`. */
export interface BeaconReplayRedis {
  status?: string;
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttlMs: number,
    condition: 'NX',
  ): Promise<unknown>;
}

/**
 * Per-replica fallback for the replay claim. Bounded and self-pruning.
 *
 * This is NOT equivalent to the Redis path and must not be described as such:
 * with several replicas it only catches a replay that lands on the SAME pod.
 * It exists so a Redis outage degrades to today's behaviour rather than
 * disabling replay protection entirely (and so unit tests need no Redis).
 */
const memoryClaims = new Map<string, number>();
const MEMORY_CLAIM_LIMIT = 20_000;

function claimInMemory(key: string, ttlMs: number, now: number): boolean {
  if (memoryClaims.size > MEMORY_CLAIM_LIMIT) {
    for (const [k, exp] of memoryClaims) {
      if (exp <= now) memoryClaims.delete(k);
    }
    // Still oversized after pruning expired entries — drop the oldest half
    // rather than growing without bound.
    if (memoryClaims.size > MEMORY_CLAIM_LIMIT) {
      let drop = Math.floor(memoryClaims.size / 2);
      for (const k of memoryClaims.keys()) {
        memoryClaims.delete(k);
        if (--drop <= 0) break;
      }
    }
  }
  const existing = memoryClaims.get(key);
  if (existing !== undefined && existing > now) return false;
  memoryClaims.set(key, now + ttlMs);
  return true;
}

export interface BeaconSequenceClaim {
  /** True when this (capability, seq) pair had never been used before. */
  fresh: boolean;
  /** True when the claim was settled in SHARED state (survives replicas). */
  shared: boolean;
}

/**
 * Claim one (capability nonce, sequence) pair exactly once.
 *
 * Redis `SET key 1 PX <ttl> NX` is atomic and cross-replica: the first caller
 * gets `OK`, every replay gets `null`. TTL is the capability's remaining life,
 * so the claim namespace expires with the credential that created it and the
 * key space stays bounded by (issued capabilities × sequence numbers actually
 * used), not by traffic.
 */
export async function claimBeaconSequence(
  redis: BeaconReplayRedis | null | undefined,
  claims: BeaconCapabilityClaims,
  seq: number,
  now: number = Date.now(),
): Promise<BeaconSequenceClaim> {
  const remainingMs = Math.max(1_000, claims.x * 1000 - now);
  const key = `vos:beacon:${claims.n}:${seq}`;
  if (!redis || redis.status !== 'ready') {
    return { fresh: claimInMemory(key, remainingMs, now), shared: false };
  }
  try {
    const res = await redis.set(key, '1', 'PX', remainingMs, 'NX');
    return { fresh: res !== null && res !== undefined, shared: true };
  } catch {
    // Redis errored mid-flight — fall back rather than accepting a beacon we
    // could not check at all.
    return { fresh: claimInMemory(key, remainingMs, now), shared: false };
  }
}

/** Parse a client-supplied sequence number. Out-of-range values are rejected. */
export function parseBeaconSequence(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  if (i < 1 || i > BEACON_MAX_SEQUENCE) return null;
  return i;
}

/** True when the deploy refuses to record an unverified beacon at all. */
export function requireVerifiedBeacons(): boolean {
  const v = String(process.env.SPORTS_BEACON_REQUIRE_VERIFIED || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * WHY a beacon graded the way it did.
 *
 * `verified` stays the single boolean the `SponsorImpression.verified` column
 * is written from; this says which of four situations produced it, so a server
 * log (and the beacon's own response) can explain a collapsed verified count
 * instead of leaving an operator staring at a zero.
 *
 * Only `device-verified` is evidence. The two DOWNGRADE values are the
 * SEC-007 re-audit fixes: a capability can be cryptographically perfect and
 * still not prove what a sponsor invoice needs it to prove.
 */
export type BeaconProvenance =
  /** Device-bound, screen confirmed live at beacon time, replay claimed in shared state. */
  | 'device-verified'
  /** No capability, or one deliberately minted without a screen binding (OBS / HDMI). */
  | 'anonymous'
  /**
   * Device-bound, but the replay claim could only be settled in THIS PROCESS's
   * memory. With more than one replica a captured beacon can be re-fired
   * against another pod, so the count is not provably single-use. Downgraded,
   * because "we could not check" is not "we checked".
   */
  | 'replay-memory-only'
  /**
   * Device-bound, but the live screen row could not be read, so revocation and
   * credential epoch could not be re-checked at beacon time. Uncertainty is
   * not evidence.
   */
  | 'screen-state-unknown';

/**
 * What a recorded beacon can honestly claim about itself. This is what gets
 * persisted alongside the row, and what the proof-of-play report grades on.
 */
export interface BeaconAttestation {
  /**
   * Bound to a proven device credential for a screen in the game's tenant,
   * that screen still live at beacon time, replay claimed in SHARED state.
   * True only when `provenance === 'device-verified'`.
   */
  verified: boolean;
  /** The attributable screen, when verified. */
  screenId: string | null;
  /** Capability nonce + sequence — the replay identity, useful in forensics. */
  nonce: string | null;
  seq: number | null;
  /** True when the replay claim was settled in Redis (survives replicas). */
  replayCheckedShared: boolean;
  /** Why this beacon graded the way it did. */
  provenance: BeaconProvenance;
}

/** An anonymous, legacy-shaped beacon: recorded, but never counted as proof. */
export const UNATTESTED: BeaconAttestation = Object.freeze({
  verified: false,
  screenId: null,
  nonce: null,
  seq: null,
  replayCheckedShared: false,
  provenance: 'anonymous' as const,
});

/**
 * SEC-007 re-audit (d) — the LIVE screen re-check at beacon time.
 *
 * `verifyBeaconCapability` is pure crypto: it proves the capability was minted
 * against a real credential some time in the last 30 minutes. It cannot see
 * that the operator revoked that screen ninety seconds later. Until this
 * existed, a captured or post-revocation capability kept producing
 * evidence-grade rows for the rest of its lifetime — the one window the
 * mint-time `verifyDeviceForScreen` check does not cover.
 *
 *   `live`    — row present, not REVOKED, credential epoch still acceptable.
 *   `revoked` — a DEFINITE negative (row deleted, status REVOKED, or the epoch
 *               has moved past the capability's). The beacon is REFUSED, which
 *               is what makes "revoking a screen kills its beacons" true.
 *   `unknown` — the row could not be read (pool exhausted, Postgres down).
 *               Indeterminate, so not evidence: DOWNGRADED, not refused —
 *               except in strict mode, which accepts nothing unverified.
 */
export type BeaconScreenLiveness = 'live' | 'revoked' | 'unknown';

/**
 * Injected, so this module stays free of Prisma and unit-testable with no
 * database. The real one is `beacon-screen-liveness.ts`.
 */
export interface BeaconScreenCheckInput {
  screenId: string;
  credentialEpoch: number;
  /**
   * Tenant the capability was minted under, when it carries one. A checker
   * that receives `null`/`undefined` here MUST NOT invent a tenant rule — an
   * older capability simply predates the binding.
   */
  tenantId?: string | null;
}

export type BeaconScreenCheck = (
  input: BeaconScreenCheckInput,
) => Promise<BeaconScreenLiveness>;

export type ResolveBeaconResult =
  | { ok: true; attestation: BeaconAttestation }
  | { ok: false; status: number; code: string; reason: string };

/**
 * The one gate both beacon endpoints run.
 *
 * An ABSENT capability is the legacy shape (a deployed board that predates
 * this change, or an OBS overlay with no credential to offer): accepted,
 * recorded, and permanently marked unverified — unless the deploy sets
 * `SPORTS_BEACON_REQUIRE_VERIFIED`.
 *
 * A PRESENT capability is held to the full contract — signature, game, scope,
 * expiry, a LIVE screen re-check, and a one-shot sequence claim. A forged or
 * replayed capability is refused outright rather than being quietly downgraded
 * to "unverified": a client that presents credentials is not a legacy client,
 * and silently accepting its bad ones would make the capability worthless.
 *
 * SEC-007 re-audit — two situations produce a cryptographically VALID
 * capability that still cannot be graded as evidence. Both DOWNGRADE the row
 * to unverified (and refuse outright in strict mode) rather than claim a
 * verification that was never established:
 *
 *   • the live screen row could not be read (`screen-state-unknown`);
 *   • the replay claim only reached this process's memory, so the beacon is
 *     not provably single-use across replicas (`replay-memory-only`).
 *
 * A screen that is DEFINITELY gone — deleted, REVOKED, past its credential
 * epoch, or (residual #2) now owned by a DIFFERENT TENANT — is a different
 * thing from an unreadable one, and is refused.
 */
export async function resolveBeaconAttestation(
  redis: BeaconReplayRedis | null | undefined,
  presented: { capability?: unknown; seq?: unknown },
  expect: { gameId: string; scope: BeaconScope; now?: number },
  deps: { screenCheck?: BeaconScreenCheck } = {},
): Promise<ResolveBeaconResult> {
  const strict = requireVerifiedBeacons();
  const raw = typeof presented.capability === 'string' ? presented.capability.trim() : '';

  if (!raw) {
    if (strict) {
      return {
        ok: false,
        status: 401,
        code: 'BEACON_CAPABILITY_REQUIRED',
        reason: 'no capability presented and SPORTS_BEACON_REQUIRE_VERIFIED is set',
      };
    }
    return { ok: true, attestation: UNATTESTED };
  }

  const verdict = verifyBeaconCapability(raw, expect);
  if (!verdict.ok) {
    return {
      ok: false,
      status: 401,
      code: 'BEACON_CAPABILITY_INVALID',
      reason: verdict.reason,
    };
  }
  if (strict && !verdict.verified) {
    return {
      ok: false,
      status: 401,
      code: 'BEACON_CAPABILITY_UNVERIFIED',
      reason: 'capability is not bound to a device credential',
    };
  }

  const seq = parseBeaconSequence(presented.seq);
  if (seq === null) {
    return {
      ok: false,
      status: 400,
      code: 'BEACON_SEQUENCE_REQUIRED',
      reason: `seq must be an integer in 1..${BEACON_MAX_SEQUENCE}`,
    };
  }

  // (d) LIVE screen re-check — BEFORE the replay claim, so a beacon from a
  // revoked screen is refused without consuming a sequence number. Only runs
  // for a device-bound capability: an anonymous one has no screen to check.
  let provenance: BeaconProvenance = verdict.verified ? 'device-verified' : 'anonymous';
  if (verdict.verified && deps.screenCheck) {
    let liveness: BeaconScreenLiveness;
    try {
      liveness = await deps.screenCheck({
        screenId: String(verdict.claims.s),
        credentialEpoch: verdict.claims.e,
        tenantId: verdict.claims.t ?? null,
      });
    } catch {
      // The checker itself failed. Indeterminate, never "fine".
      liveness = 'unknown';
    }
    if (liveness === 'revoked') {
      return {
        ok: false,
        status: 401,
        code: 'BEACON_SCREEN_REVOKED',
        reason: 'the screen this capability was minted for is revoked, deleted or past its credential epoch',
      };
    }
    if (liveness === 'unknown') {
      if (strict) {
        return {
          ok: false,
          status: 503,
          code: 'BEACON_SCREEN_STATE_UNKNOWN',
          reason: 'could not re-check the screen credential and SPORTS_BEACON_REQUIRE_VERIFIED is set',
        };
      }
      provenance = 'screen-state-unknown';
    }
  }

  const claim = await claimBeaconSequence(redis, verdict.claims, seq, expect.now);
  if (!claim.fresh) {
    return {
      ok: false,
      status: 409,
      code: 'BEACON_REPLAY_REJECTED',
      reason: `sequence ${seq} already claimed for this capability`,
    };
  }

  // (c) The replay claim landed in per-process memory only. It still stopped a
  // same-pod replay, so the beacon is ACCEPTED — but "single-use" is exactly
  // the property that makes a count proof, and across replicas it was not
  // established. Downgrade rather than claim it.
  if (provenance === 'device-verified' && !claim.shared) {
    if (strict) {
      return {
        ok: false,
        status: 503,
        code: 'BEACON_REPLAY_STATE_UNSHARED',
        reason:
          'replay could only be claimed in process memory and SPORTS_BEACON_REQUIRE_VERIFIED is set',
      };
    }
    provenance = 'replay-memory-only';
  }

  const verified = provenance === 'device-verified';
  return {
    ok: true,
    attestation: {
      verified,
      screenId: verified ? verdict.claims.s : null,
      nonce: verdict.claims.n,
      seq,
      replayCheckedShared: claim.shared,
      provenance,
    },
  };
}

/** Test-only: clear the in-memory replay fallback between cases. */
export function _resetBeaconReplayMemoryForTests(): void {
  memoryClaims.clear();
}
