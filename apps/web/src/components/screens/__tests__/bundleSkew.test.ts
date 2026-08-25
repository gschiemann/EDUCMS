/**
 * bundleSkew — page-bundle skew derivation unit tests (2026-08-25).
 *
 * Pins the current/stale/unknown/offline matrix for the Screens-list bundle
 * chip. The load-bearing rules, in order of how much damage getting them
 * wrong would do:
 *
 *   1. NEVER accuse on missing evidence. An older player build that doesn't
 *      report a SHA, a screen that just paired, or a deploy with no
 *      build-info env var must ALL stay silent. A chip that reads "out of
 *      date" across a whole healthy fleet because the reference is null
 *      would be a louder version of the exact lie this feature exists to
 *      kill.
 *   2. NEVER nag on the common case. 'current' renders nothing.
 *   3. Normalize both sides identically, so a width/case difference between
 *      build paths can't fake drift forever.
 */
import {
  deriveBundleSkew,
  normalizeSha,
  BUNDLE_SHA_COMPARE_LENGTH,
} from '../bundleSkew';

const ONLINE = { status: 'ONLINE' };
const SHA_A = 'abc123def456';
const SHA_B = '94b94ac8aaaa';

describe('deriveBundleSkew', () => {
  it('THE MONEY STATE: online + a different SHA than deployed → stale', () => {
    expect(
      deriveBundleSkew({ ...ONLINE, reportedSha: SHA_A, deployedSha: SHA_B }),
    ).toBe('stale');
  });

  it('online + matching SHA → current (renders nothing — no nagging)', () => {
    expect(
      deriveBundleSkew({ ...ONLINE, reportedSha: SHA_A, deployedSha: SHA_A }),
    ).toBe('current');
  });

  it('NEVER accuses when the panel has not reported a SHA', () => {
    // The entire fleet is in this state the moment the feature ships.
    for (const reported of [null, undefined, '']) {
      expect(
        deriveBundleSkew({ ...ONLINE, reportedSha: reported, deployedSha: SHA_B }),
      ).toBe('unknown');
    }
  });

  it('NEVER accuses when there is no deployed SHA to compare against', () => {
    // Local dev / self-hosted: /api/build-info returns sha:null. Without
    // this rule the chip would fire on EVERY row of a perfectly healthy
    // fleet — the loudest possible false alarm.
    for (const deployed of [null, undefined, '']) {
      expect(
        deriveBundleSkew({ ...ONLINE, reportedSha: SHA_A, deployedSha: deployed }),
      ).toBe('unknown');
    }
  });

  it('a malformed SHA on either side reads unknown, never stale', () => {
    expect(
      deriveBundleSkew({ ...ONLINE, reportedSha: 'not a sha', deployedSha: SHA_B }),
    ).toBe('unknown');
    expect(
      deriveBundleSkew({ ...ONLINE, reportedSha: SHA_A, deployedSha: '<script>' }),
    ).toBe('unknown');
  });

  it('defers entirely to the offline treatment for a screen that is not ONLINE', () => {
    // No double-messaging next to the OFFLINE badge, and a screen that
    // isn't running can't usefully be told to refresh.
    for (const status of ['OFFLINE', 'PENDING', 'REVOKED', null, undefined]) {
      expect(
        deriveBundleSkew({ status, reportedSha: SHA_A, deployedSha: SHA_B }),
      ).toBe('offline');
    }
  });

  it('compares on the normalized form — case and width can never fake drift', () => {
    expect(
      deriveBundleSkew({
        ...ONLINE,
        reportedSha: SHA_A,
        // Same commit, full 40-char uppercase form from a different build path.
        deployedSha: 'ABC123DEF456789012345678901234567890AAAA',
      }),
    ).toBe('current');
  });
});

describe('normalizeSha', () => {
  it('lowercases and truncates to the comparison width', () => {
    expect(BUNDLE_SHA_COMPARE_LENGTH).toBe(12);
    expect(normalizeSha('ABC123DEF456789')).toBe(SHA_A);
  });

  it('rejects anything unreadable, unbounded, or not a bare token', () => {
    for (const bad of [
      null,
      undefined,
      42,
      {},
      '',
      '   ',
      'a'.repeat(65), // unbounded
      'not a sha', // whitespace inside
      '<script>alert(1)</script>', // markup into a chip
      '../../etc/passwd', // path separators
    ]) {
      expect(normalizeSha(bad as any)).toBeNull();
    }
  });

  it('accepts non-hex build identifiers, matching the player-side rule', () => {
    // The player's copy of this rule also gates its auto-reload, so it is
    // bounded rather than hex-only. This copy must not be narrower, or the
    // chip would read 'unknown' for a fleet the player is grading fine.
    expect(normalizeSha('v1.2.3')).toBe('v1.2.3');
    expect(normalizeSha('1234')).toBe('1234');
  });

  it('tolerates surrounding whitespace from a hand-set env var', () => {
    expect(normalizeSha('  abc123def456  ')).toBe(SHA_A);
  });
});
