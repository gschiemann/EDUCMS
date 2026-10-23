/**
 * The install outcomes a screen reports and the needs-a-tap rule
 * (ota-install-state.ts, 2026-10-17). The field case: an Android 9 panel
 * downloaded v1.1.29 48 times in 24 h because every check was answered
 * `install` while Android waited for a person to tap Install.
 */
import { FAILED_STATE, TAP_EXPIRED, holdFromOtaReport, isFailureState, pushWaitsForTap } from './ota-install-state';

const PUSH = new Date('2026-10-16T10:00:00Z');
const after = (min: number) => new Date(PUSH.getTime() + min * 60_000);

describe('pushWaitsForTap', () => {
  it('a NEEDS_TAP reported after the push holds it', () => {
    expect(pushWaitsForTap({ pendingAt: PUSH, lastOtaState: 'NEEDS_TAP', lastOtaAt: after(3) })).toBe(true);
    // ISO strings (as Prisma rows serialise in some paths) read the same.
    expect(pushWaitsForTap({ pendingAt: PUSH.toISOString(), lastOtaState: 'NEEDS_TAP', lastOtaAt: after(3).toISOString() })).toBe(true);
  });

  it('a NEEDS_TAP from BEFORE the push is about an earlier attempt — a new push is offered once', () => {
    expect(pushWaitsForTap({ pendingAt: PUSH, lastOtaState: 'NEEDS_TAP', lastOtaAt: after(-1) })).toBe(false);
  });

  it('any other state, no push, or unreadable times → not waiting', () => {
    for (const state of ['INSTALLING', 'CHECKING', 'UP_TO_DATE', 'ERROR', 'FAILED_ABORTED', null]) {
      expect(pushWaitsForTap({ pendingAt: PUSH, lastOtaState: state, lastOtaAt: after(3) })).toBe(false);
    }
    expect(pushWaitsForTap({ pendingAt: null, lastOtaState: 'NEEDS_TAP', lastOtaAt: after(3) })).toBe(false);
    expect(pushWaitsForTap({ pendingAt: PUSH, lastOtaState: 'NEEDS_TAP', lastOtaAt: null })).toBe(false);
    expect(pushWaitsForTap({ pendingAt: 'not a date', lastOtaState: 'NEEDS_TAP', lastOtaAt: after(3) })).toBe(false);
  });
});

describe('FAILED_<CODE>', () => {
  it('accepts the Player\'s PackageInstaller codes and nothing looser', () => {
    for (const ok of ['FAILED_ABORTED', 'FAILED_INCOMPATIBLE', 'FAILED_STORAGE', 'FAILED_UNKNOWN', 'FAILED_STATUS_M999']) {
      expect(FAILED_STATE.test(ok)).toBe(true);
    }
    for (const bad of ['FAILED', 'FAILED_', 'failed_aborted', 'FAILED_X;DROP', 'XFAILED_A', 'FAILED_' + 'A'.repeat(41)]) {
      expect(FAILED_STATE.test(bad)).toBe(false);
    }
  });

  it('is a failure for the sticky stamp, like ERROR; NEEDS_TAP is not', () => {
    expect(isFailureState('ERROR')).toBe(true);
    expect(isFailureState('FAILED_ABORTED')).toBe(true);
    expect(isFailureState('NEEDS_TAP')).toBe(false);
    expect(isFailureState('INSTALLING')).toBe(false);
  });
});

describe('holdFromOtaReport (player 1.1.51 — a tap-expiry moves a NEEDS_TAP hold to EXPIRED)', () => {
  const base = { deviceAuthenticated: true, pendingAt: PUSH, currentHold: null as string | null };

  it('an unheld push: NEEDS_TAP holds NEEDS_TAP, FAILED_<CODE> holds FAILED, progress holds nothing', () => {
    expect(holdFromOtaReport({ ...base, state: 'NEEDS_TAP' })).toBe('NEEDS_TAP');
    expect(holdFromOtaReport({ ...base, state: 'FAILED_ABORTED' })).toBe('FAILED');
    for (const state of ['CHECKING', 'DOWNLOADING', 'INSTALLING', 'UP_TO_DATE', 'ERROR']) {
      expect(holdFromOtaReport({ ...base, state })).toBeNull();
    }
  });

  it('THE 1.1.51 CASE: FAILED_TAP_EXPIRED on a push held NEEDS_TAP → EXPIRED (it used to change nothing)', () => {
    expect(holdFromOtaReport({ ...base, currentHold: 'NEEDS_TAP', state: TAP_EXPIRED })).toBe('EXPIRED');
    expect(holdFromOtaReport({ ...base, currentHold: null, state: TAP_EXPIRED })).toBe('EXPIRED');
  });

  it('a tap-expiry never rewrites a STALLED / FAILED / EXPIRED hold, and other reports never touch an existing hold', () => {
    for (const hold of ['STALLED', 'FAILED', 'EXPIRED']) {
      expect(holdFromOtaReport({ ...base, currentHold: hold, state: TAP_EXPIRED })).toBeNull();
    }
    expect(holdFromOtaReport({ ...base, currentHold: 'NEEDS_TAP', state: 'FAILED_STORAGE' })).toBeNull();
    expect(holdFromOtaReport({ ...base, currentHold: 'STALLED', state: 'NEEDS_TAP' })).toBeNull();
  });

  it('anonymous reports and screens with no push hold nothing', () => {
    expect(holdFromOtaReport({ ...base, deviceAuthenticated: false, currentHold: 'NEEDS_TAP', state: TAP_EXPIRED })).toBeNull();
    expect(holdFromOtaReport({ ...base, pendingAt: null, state: 'NEEDS_TAP' })).toBeNull();
  });
});
