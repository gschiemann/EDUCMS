/**
 * SEC-007 re-audit (2026-09-04) — the live screen re-check for proof-of-play
 * beacons.
 *
 * THE GAP THIS CLOSES. Minting a beacon capability runs the real
 * `verifyDeviceForScreen`, so a revoked or stale-epoch screen can never mint
 * one. But the capability then lives for up to 30 minutes and beacon-time
 * verification was PURE CRYPTO: signature, game, scope, expiry, replay. So a
 * capability captured off the wire — or simply held by a screen the operator
 * revoked ninety seconds after it minted — kept producing rows graded as
 * evidence for the rest of its lifetime. "Revoking the screen kills its
 * beacons too" was true at mint and false everywhere else.
 *
 * WHAT IT COSTS. One indexed point-read per beacon, behind the same 5-second
 * per-process credential cache every device-authenticated route already shares
 * (`loadDeviceCredentialState`). A board fires roughly one impression per
 * sponsor look, seconds apart, so in practice a screen's row is read a handful
 * of times a minute per replica, not once per beacon.
 *
 * THE THREE ANSWERS ARE NOT TWO. `revoked` is a DEFINITE negative and refuses
 * the beacon. `unknown` — the row could not be read at all — is indeterminate
 * and DOWNGRADES the row to unverified instead of refusing it: losing the
 * count entirely during a database blip is strictly worse than recording it
 * honestly as "not proof" (the same do-no-harm rule the beacon client
 * follows). Neither one is ever allowed to answer `live` by omission.
 */

import {
  isEpochAcceptable,
  loadDeviceCredentialState,
  type DeviceAuthPrisma,
} from '../screens/device-auth';
import type { BeaconScreenCheck, BeaconScreenLiveness } from './beacon-capability';

/**
 * Build the checker `resolveBeaconAttestation` calls. Curried over Prisma so
 * the pure capability module never imports the database layer.
 */
export function makeBeaconScreenCheck(prisma: DeviceAuthPrisma): BeaconScreenCheck {
  return async (screenId: string, credentialEpoch: number): Promise<BeaconScreenLiveness> => {
    if (!screenId) return 'revoked';
    let state;
    try {
      state = await loadDeviceCredentialState({ prisma }, screenId);
    } catch {
      // Pool exhausted, Postgres unreachable, query timeout. We do not know,
      // and "we do not know" is never evidence.
      return 'unknown';
    }
    // A `null` state is a real, cached answer: no such screen row. That is a
    // complete credential kill, exactly as `verifyDeviceForScreen` treats it.
    if (!state) return 'revoked';
    if (state.status === 'REVOKED') return 'revoked';
    // Same epoch rule the device auth path uses, including the rotation grace
    // window — a screen mid-rotation must not have its beacons refused.
    if (!isEpochAcceptable(credentialEpoch, state)) return 'revoked';
    return 'live';
  };
}
