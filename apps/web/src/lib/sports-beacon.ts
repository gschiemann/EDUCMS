/**
 * SEC-007 (2026-09-04) — client side of the proof-of-play beacon capability.
 *
 * The sponsor-impression and CTS-cue beacons are posted from PUBLIC surfaces
 * (`/board/:id`, `/ribbon/:id`, the scorebug overlay) that carry no dashboard
 * session, so the endpoints accept anonymous POSTs. That made every count they
 * produced an unauthenticated browser beacon — and those counts are what a
 * sponsor renewal is argued from.
 *
 * This module fetches a short-lived signed capability from
 * `POST /sports/board/:gameId/beacon-capability` and attaches it, with a
 * per-beacon sequence number, to each beacon. When the surface is running on a
 * PAIRED SCREEN, the mint request carries that screen's device token, so the
 * capability — and every beacon under it — is attributable to the screen and
 * dies with its credential. When it is not (an OBS browser source, a laptop
 * driving an LED wall over HDMI), the capability still expires and is still
 * replay-protected, but the server records those rows as unverified.
 *
 * DO NO HARM. Every failure path returns NO headers, which lands the beacon on
 * the legacy anonymous route the server still accepts. A minting outage must
 * never stop a board reporting — losing counts entirely is strictly worse than
 * recording them as unverified.
 *
 * SEC-007 residual #1 (2026-09-05) — REACTING TO THE SERVER'S VERDICT.
 * Until now nothing on this side read a beacon's response. The server-side
 * re-audit added a LIVE screen re-check at beacon time, so a screen revoked or
 * unpaired mid-lease starts getting `401 BEACON_SCREEN_REVOKED` — and this
 * client kept presenting the same dead capability for the rest of the lease
 * (up to ~25 minutes), so every one of those impressions was REFUSED and
 * therefore LOST, not downgraded. `postBeacon()` closes that: a 401 on a
 * capability-carrying beacon drops the lease immediately, re-posts THAT beacon
 * once with no capability so it is recorded unverified rather than lost, and
 * blocks re-minting for a cooldown so a board firing every few seconds cannot
 * turn a revocation into a mint storm. Do-no-harm, restated: a beacon may be
 * DOWNGRADED, never dropped on the floor.
 *
 * The device token is READ-ONLY here. `apps/web/src/app/player/trustGuards.ts`
 * is the single writer of that key (player-reliability rule #3, "one token
 * store per side"); this module must never write it, and never adopt one from
 * a URL.
 */

import { API_URL } from '@/lib/api-url';
import { DEVICE_TOKEN_STORAGE_KEY } from '@/app/player/trustGuards';

export type BeaconScope = 'impression' | 'cue';

/** The header a capability rides in. Exported so tests assert on one constant. */
export const BEACON_HEADER = 'x-venueos-beacon';
export const BEACON_SEQ_HEADER = 'x-venueos-beacon-seq';

interface MintedCapabilities {
  verified: boolean;
  expiresAt: number;
  maxSequence: number;
  impression: string;
  cue: string;
}

interface CapabilityLease {
  caps: MintedCapabilities;
  /** Re-mint at this point rather than riding a capability to its expiry. */
  renewAt: number;
  seq: number;
}

/** In-flight or settled lease per game. Single-flight: one mint per game. */
const leases = new Map<string, Promise<CapabilityLease | null>>();
const settled = new Map<string, CapabilityLease>();

/**
 * Per-game "do not mint before" timestamp. Set when a mint fails, and (much
 * longer) when the server refuses a capability we presented.
 *
 * Without this, a board that fires an impression every few seconds attempts a
 * FRESH MINT on every one of them as soon as it has no usable lease — which is
 * exactly the state a revoked screen is in. That is the retry storm this
 * cooldown exists to prevent; it is also why the recovery is time-based rather
 * than attempt-based.
 */
const mintBlockedUntil = new Map<string, number>();

/**
 * Games where the server refused an ANONYMOUS beacon (a deploy running
 * `SPORTS_BEACON_REQUIRE_VERIFIED`). Learned, never assumed: we only stop
 * offering the unverified fallback once the server has actually rejected it,
 * because on every normal deploy that fallback is what keeps the count.
 */
const anonymousRefused = new Set<string>();

/**
 * How early to re-mint. A capability is 30 minutes; renewing at 25 leaves a
 * comfortable margin on a signage box whose clock can be minutes out of step
 * (the same skew that forced VALUE-identity refresh acks on the player).
 */
const RENEW_MARGIN_MS = 5 * 60_000;

/**
 * Cooldown after a mint that FAILED (endpoint down, network blip, game not
 * found). Short: the next beacon should get a capability again as soon as the
 * outage clears, and one mint attempt a minute is not a storm.
 */
const MINT_RETRY_COOLDOWN_MS = 60_000;

/**
 * Cooldown after the server REFUSED a capability we presented (401).
 *
 * Longer, because the cause is a state change rather than a blip: the screen
 * was revoked, unpaired, or rotated its credential. Re-minting immediately
 * would be refused too (the mint endpoint runs the same `verifyDeviceForScreen`
 * this beacon just failed), so it would burn a request per beacon for nothing.
 * Five minutes bounds how long a screen that RE-PAIRS mid-game stays in the
 * unverified lane — the old behaviour was up to ~25 minutes, the full lease.
 */
const REFUSED_COOLDOWN_MS = 5 * 60_000;

/** Read the paired screen's device token, if this surface is on one. */
function deviceToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage?.getItem(DEVICE_TOKEN_STORAGE_KEY);
    return raw && raw.trim() ? raw.trim() : null;
  } catch {
    // Sandboxed / partitioned storage — no credential to offer, which is a
    // legitimate state, not an error.
    return null;
  }
}

function mintUrl(gameId: string, apiRoot: string): string {
  const root = apiRoot.replace(/\/+$/, '');
  const base = root.endsWith('/api/v1') ? root : `${root}/api/v1`;
  return `${base}/sports/board/${encodeURIComponent(gameId)}/beacon-capability`;
}

async function mint(gameId: string, apiRoot: string): Promise<CapabilityLease | null> {
  const token = deviceToken();
  try {
    const res = await fetch(mintUrl(gameId, apiRoot), {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      // A refused mint is a real signal (revoked credential, rate limit,
      // unknown game) — back off rather than re-asking on the next beacon.
      mintBlockedUntil.set(gameId, Date.now() + MINT_RETRY_COOLDOWN_MS);
      return null;
    }
    const caps = (await res.json()) as MintedCapabilities;
    if (!caps || typeof caps.impression !== 'string' || typeof caps.cue !== 'string') {
      mintBlockedUntil.set(gameId, Date.now() + MINT_RETRY_COOLDOWN_MS);
      return null;
    }
    const expiresAt = Number(caps.expiresAt) || Date.now() + 60_000;
    mintBlockedUntil.delete(gameId);
    return {
      caps: { ...caps, expiresAt },
      renewAt: expiresAt - RENEW_MARGIN_MS,
      seq: 0,
    };
  } catch {
    mintBlockedUntil.set(gameId, Date.now() + MINT_RETRY_COOLDOWN_MS);
    return null;
  }
}

function leaseIsUsable(lease: CapabilityLease | null | undefined, now: number): lease is CapabilityLease {
  if (!lease) return false;
  if (now >= lease.renewAt) return false;
  // Exhausting the sequence space forces a re-mint, which re-proves the
  // device credential — that is the point of the ceiling, not a failure.
  return lease.seq < lease.caps.maxSequence;
}

/**
 * Headers for ONE beacon. Returns `{}` when no capability could be obtained —
 * the caller posts anonymously and the server records the row as unverified.
 *
 * `apiRoot` defaults to the compiled API origin; the ribbon widget resolves its
 * own root (it can be running through the same-origin gateway), so it passes
 * that in and the mint follows the same path as the beacon it authorises.
 */
export async function beaconHeaders(
  gameId: string,
  scope: BeaconScope,
  apiRoot: string = API_URL,
): Promise<Record<string, string>> {
  if (!gameId || typeof window === 'undefined') return {};
  const now = Date.now();

  let lease = settled.get(gameId);
  if (!leaseIsUsable(lease, now)) {
    // A dead lease is dropped here as well as at the 401, so a stale one can
    // never be handed out after its cooldown decision was made.
    if (lease) settled.delete(gameId);
    const blockedUntil = mintBlockedUntil.get(gameId) || 0;
    if (now < blockedUntil) return {};
    let inflight = leases.get(gameId);
    if (!inflight) {
      inflight = mint(gameId, apiRoot).finally(() => {
        leases.delete(gameId);
      });
      leases.set(gameId, inflight);
    }
    const minted = await inflight;
    if (!minted) return {};
    settled.set(gameId, minted);
    lease = minted;
  }
  if (!lease) return {};

  lease.seq += 1;
  return {
    [BEACON_HEADER]: scope === 'cue' ? lease.caps.cue : lease.caps.impression,
    [BEACON_SEQ_HEADER]: String(lease.seq),
  };
}

/**
 * The server refused a capability we presented. Drop it NOW so no further
 * beacon rides a credential the server has already rejected, and hold off
 * minting for a while — the mint endpoint runs the same credential check that
 * just failed, so an immediate re-mint is a wasted request per beacon.
 */
function dropLease(gameId: string): void {
  settled.delete(gameId);
  mintBlockedUntil.set(gameId, Date.now() + REFUSED_COOLDOWN_MS);
}

/** Best-effort read of the server's error `code`. Diagnostics only. */
async function readCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { code?: unknown };
    return typeof body?.code === 'string' ? body.code : '';
  } catch {
    return '';
  }
}

export interface PostBeaconInput {
  gameId: string;
  scope: BeaconScope;
  /** Fully-resolved beacon endpoint. */
  url: string;
  /** JSON body. Serialised here so the retry re-sends exactly the same bytes. */
  body: unknown;
  /** API root the capability is minted from. Defaults to the compiled origin. */
  apiRoot?: string;
  /** Survive a tab-close mid-POST (the cue beacon uses this). */
  keepalive?: boolean;
}

/**
 * Post ONE beacon with a capability when one can be had, and act on the
 * server's verdict. This is the only place a beacon response is interpreted;
 * every caller should use it rather than composing `beaconHeaders` + `fetch`,
 * so the recovery below exists on every surface rather than one of them.
 *
 * Never throws and never rejects — a reporting beacon must not be able to
 * break a board.
 *
 * The verdict handling, and why each branch is what it is:
 *
 *   • **401 while carrying a capability** — every 401 the beacon gate emits
 *     for a presented capability (`BEACON_SCREEN_REVOKED`,
 *     `BEACON_CAPABILITY_INVALID`, `BEACON_CAPABILITY_UNVERIFIED`) means the
 *     lease is unusable from here on, so the decision keys off the STATUS, not
 *     the code — a new refusal code can never be silently ignored. The lease is
 *     dropped and this beacon is RE-POSTED ONCE with no capability, so the
 *     airing is recorded as unverified instead of vanishing. That is the whole
 *     point: the operator's report should read "the screen stopped proving
 *     itself", not "the boards stopped reporting".
 *   • **401 while carrying NO capability** — only possible under
 *     `SPORTS_BEACON_REQUIRE_VERIFIED`, where the server accepts nothing
 *     unverified. Remember it and stop offering the anonymous fallback for this
 *     game; retrying it would be a guaranteed-refused second request per
 *     beacon.
 *   • **anything else** (2xx, 409 replay, 429, 5xx, a network throw) — nothing
 *     to learn and nothing safe to retry. A blind retry on a 5xx would double
 *     the load on an already-struggling server, and a 409 means the row is
 *     already there.
 */
export async function postBeacon(input: PostBeaconInput): Promise<void> {
  const { gameId, scope, url, body, apiRoot, keepalive } = input;
  if (typeof window === 'undefined') return;
  const payload = (() => {
    try {
      return JSON.stringify(body);
    } catch {
      return null;
    }
  })();
  if (payload === null) return;

  const send = (beacon: Record<string, string>) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...beacon },
      body: payload,
      ...(keepalive ? { keepalive: true } : {}),
    });

  let beacon: Record<string, string> = {};
  let res: Response | null = null;
  try {
    beacon = await beaconHeaders(gameId, scope, apiRoot);
    res = await send(beacon);
  } catch {
    return; // network — best-effort, never fail the board
  }
  if (!res || res.status !== 401) return;

  const carriedCapability = Boolean(beacon[BEACON_HEADER]);
  const code = await readCode(res);

  if (!carriedCapability) {
    // Strict-mode deploy: unverified beacons are refused outright. Nothing the
    // client can do about it, so stop paying for a retry that cannot succeed.
    anonymousRefused.add(gameId);
    return;
  }

  dropLease(gameId);
  if (process.env.NODE_ENV !== 'production') {
    // Named cause in dev, so a support engineer reading a console does not
    // have to open a HAR to see why a verified count collapsed.
    console.warn(`[beacon] capability refused (${code || '401'}) — lease dropped, retrying unverified`);
  }
  if (anonymousRefused.has(gameId)) return;

  try {
    const retry = await send({});
    // The unverified lane is refused too — remember, so the next refused
    // beacon does not pay for a second request either.
    if (retry && retry.status === 401) anonymousRefused.add(gameId);
  } catch {
    /* best-effort */
  }
}

/** True once a capability bound to a real screen credential is held. */
export function beaconIsVerified(gameId: string): boolean {
  return settled.get(gameId)?.caps.verified === true;
}

/** Test-only: drop cached leases between cases. */
export function _resetSportsBeaconForTests(): void {
  leases.clear();
  settled.clear();
  mintBlockedUntil.clear();
  anonymousRefused.clear();
}
