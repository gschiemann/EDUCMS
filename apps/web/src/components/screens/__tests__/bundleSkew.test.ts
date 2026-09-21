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

/**
 * ── THE 2026-09-21 BUG ───────────────────────────────────────────────────
 * Greg: "why does every screen say resync on it…our app needs to self heal."
 *
 * Since 2026-09-02 the player reloads on `bundleId` (a hash of the
 * client-bundle build inputs), NOT the commit SHA — so an API-only, docs,
 * APK or test commit correctly reloads nobody. But this module graded skew
 * on SHA equality, and every commit moves the SHA. Result: after any such
 * deploy the deployed SHA moved, no player reloaded (correct), and EVERY
 * online screen graded 'stale' forever. "App current 5/18" on a healthy
 * fleet — and Resync could not clear it, because the screen reloads the
 * identical bundle and reports the identical SHA.
 *
 * These pin the fix: when both sides know the identity the reload is
 * actually made on, that is what decides the verdict.
 */
describe('deriveBundleSkew — graded on the identity the player RELOADS on', () => {
  const BUNDLE_A = '1f2e3d4c5b6a';
  const BUNDLE_B = '9988776655ff';

  it('THE BUG: matching bundleIds + DIFFERENT SHAs → current, not stale', () => {
    // The exact shape of every screen in the fleet after an API-only, docs,
    // APK or test-only commit. The player will not reload — there is nothing
    // newer for it to pick up — so the dashboard must not say it is behind.
    expect(
      deriveBundleSkew({
        ...ONLINE,
        reportedSha: SHA_A,
        deployedSha: SHA_B,
        reportedBundleId: BUNDLE_A,
        deployedBundleId: BUNDLE_A,
      }),
    ).toBe('current');
  });

  it('a genuinely different bundleId is still stale — the signal is not lost', () => {
    // The other half of the bug would be worse: a screen stuck on old code
    // reading green (the 2026-06-27 launch blocker).
    expect(
      deriveBundleSkew({
        ...ONLINE,
        reportedSha: SHA_A,
        deployedSha: SHA_A, // SHAs AGREE — only the bundle moved
        reportedBundleId: BUNDLE_A,
        deployedBundleId: BUNDLE_B,
      }),
    ).toBe('stale');
  });

  it('bundleId OUTRANKS the SHA in both directions', () => {
    // Not merely "used when the SHAs are silent" — it is the preferred
    // authority, because it is the one the device acts on.
    expect(
      deriveBundleSkew({
        ...ONLINE,
        reportedSha: SHA_A, deployedSha: SHA_A,
        reportedBundleId: BUNDLE_A, deployedBundleId: BUNDLE_B,
      }),
    ).toBe('stale');
    expect(
      deriveBundleSkew({
        ...ONLINE,
        reportedSha: SHA_A, deployedSha: SHA_B,
        reportedBundleId: BUNDLE_A, deployedBundleId: BUNDLE_A,
      }),
    ).toBe('current');
  });

  it('a ONE-SIDED bundleId is not evidence — falls back to the SHA, both ways', () => {
    // Screen reports one, deploy stamped none (a bare `next build`):
    for (const deployedBundleId of [null, undefined, '']) {
      expect(
        deriveBundleSkew({
          ...ONLINE,
          reportedSha: SHA_A, deployedSha: SHA_A,
          reportedBundleId: BUNDLE_A, deployedBundleId,
        }),
      ).toBe('current'); // SHA lane
      expect(
        deriveBundleSkew({
          ...ONLINE,
          reportedSha: SHA_A, deployedSha: SHA_B,
          reportedBundleId: BUNDLE_A, deployedBundleId,
        }),
      ).toBe('stale'); // SHA lane
    }
    // Deploy stamped one, screen has not reported since this shipped:
    for (const reportedBundleId of [null, undefined, '']) {
      expect(
        deriveBundleSkew({
          ...ONLINE,
          reportedSha: SHA_A, deployedSha: SHA_A,
          reportedBundleId, deployedBundleId: BUNDLE_A,
        }),
      ).toBe('current');
      expect(
        deriveBundleSkew({
          ...ONLINE,
          reportedSha: SHA_A, deployedSha: SHA_B,
          reportedBundleId, deployedBundleId: BUNDLE_A,
        }),
      ).toBe('stale');
    }
  });

  it('a malformed bundleId does not poison the verdict — it falls back', () => {
    // Device-supplied. Unreadable is silence, never an accusation and never
    // an accidental match.
    expect(
      deriveBundleSkew({
        ...ONLINE,
        reportedSha: SHA_A, deployedSha: SHA_A,
        reportedBundleId: '<script>', deployedBundleId: BUNDLE_A,
      }),
    ).toBe('current'); // SHA lane says current; the junk id changed nothing
  });

  it('TRANSITIONAL: right after this ships, no screen has reported one yet', () => {
    // Every row falls back to the SHA and grades 'stale' — which is TRUE:
    // this change edits apps/web/src, so it moves the bundleId, so those
    // screens really are on an older bundle and really will reload onto this
    // one on their own. They start reporting a bundleId when they do. From
    // the NEXT bundle-neutral deploy onward they stay 'current' (case 1).
    expect(
      deriveBundleSkew({
        ...ONLINE,
        reportedSha: SHA_A,
        deployedSha: SHA_B,
        reportedBundleId: null,
        deployedBundleId: '1f2e3d4c5b6a',
      }),
    ).toBe('stale');
  });

  it('offline still outranks everything, even two matching bundleIds', () => {
    for (const status of ['OFFLINE', 'PENDING', 'REVOKED', null, undefined]) {
      expect(
        deriveBundleSkew({
          status,
          reportedSha: SHA_A, deployedSha: SHA_A,
          reportedBundleId: BUNDLE_A, deployedBundleId: BUNDLE_A,
        }),
      ).toBe('offline');
    }
  });

  it('unknown is still reachable — neither identity comparable on both sides', () => {
    expect(
      deriveBundleSkew({
        ...ONLINE,
        reportedSha: null, deployedSha: SHA_A,
        reportedBundleId: null, deployedBundleId: BUNDLE_A,
      }),
    ).toBe('unknown');
  });

  it('normalizes both bundleIds identically — width/case cannot fake drift', () => {
    expect(
      deriveBundleSkew({
        ...ONLINE,
        reportedSha: SHA_A, deployedSha: SHA_B,
        reportedBundleId: BUNDLE_A,
        deployedBundleId: '1F2E3D4C5B6A9999',
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
