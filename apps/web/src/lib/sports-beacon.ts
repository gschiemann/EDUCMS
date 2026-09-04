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
 * The device token is READ-ONLY here. `apps/web/src/app/player/trustGuards.ts`
 * is the single writer of that key (player-reliability rule #3, "one token
 * store per side"); this module must never write it, and never adopt one from
 * a URL.
 */

import { API_URL } from '@/lib/api-url';
import { DEVICE_TOKEN_STORAGE_KEY } from '@/app/player/trustGuards';

export type BeaconScope = 'impression' | 'cue';

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
 * How early to re-mint. A capability is 30 minutes; renewing at 25 leaves a
 * comfortable margin on a signage box whose clock can be minutes out of step
 * (the same skew that forced VALUE-identity refresh acks on the player).
 */
const RENEW_MARGIN_MS = 5 * 60_000;

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
    if (!res.ok) return null;
    const caps = (await res.json()) as MintedCapabilities;
    if (!caps || typeof caps.impression !== 'string' || typeof caps.cue !== 'string') return null;
    const expiresAt = Number(caps.expiresAt) || Date.now() + 60_000;
    return {
      caps: { ...caps, expiresAt },
      renewAt: expiresAt - RENEW_MARGIN_MS,
      seq: 0,
    };
  } catch {
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
    'x-venueos-beacon': scope === 'cue' ? lease.caps.cue : lease.caps.impression,
    'x-venueos-beacon-seq': String(lease.seq),
  };
}

/** True once a capability bound to a real screen credential is held. */
export function beaconIsVerified(gameId: string): boolean {
  return settled.get(gameId)?.caps.verified === true;
}

/** Test-only: drop cached leases between cases. */
export function _resetSportsBeaconForTests(): void {
  leases.clear();
  settled.clear();
}
