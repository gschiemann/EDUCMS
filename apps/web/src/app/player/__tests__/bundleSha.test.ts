/**
 * bundleSha — the player's answer to "which page bundle am I running?"
 * (2026-08-25)
 *
 * This value travels: player env → render-proof POST → Screen.lastBundleSha
 * → the Screens-list chip. Both ends of that trip normalize with the SAME
 * rules (`components/screens/bundleSkew.ts::normalizeSha` mirrors this
 * file), because a width or case difference between the two would show a
 * healthy panel as permanently "out of date" — a fresh version of the lie
 * this whole feature exists to kill. These pin the contract.
 *
 * Also pinned: the drift detector and the telemetry read the SAME function.
 * If they ever diverged, the chip could say "out of date" about a panel that
 * had already decided it was current (or vice versa), which is worse than no
 * chip at all.
 */
import {
  readOwnBundleSha,
  normalizeBundleSha,
  BUNDLE_SHA_LENGTH,
} from '../bundleSha';

const ENV = process.env as Record<string, string | undefined>;

describe('normalizeBundleSha', () => {
  it('lowercases and truncates to the 12-char comparison width', () => {
    expect(BUNDLE_SHA_LENGTH).toBe(12);
    // /api/build-info already slices to 12; a full 40-char SHA from any
    // other build path must land on the identical value.
    expect(normalizeBundleSha('ABC123DEF456789012345678901234567890AAAA')).toBe(
      'abc123def456',
    );
  });

  it('passes a value that is already in the short form through unchanged', () => {
    expect(normalizeBundleSha('94b94ac8aaaa')).toBe('94b94ac8aaaa');
  });

  it('returns null for anything unreadable, unbounded, or not a bare token', () => {
    // null is the "can't determine" signal every consumer treats as silence:
    // the drift detector skips its comparison, the dashboard chip renders
    // nothing. Never a verdict off a malformed value.
    for (const bad of [
      null,
      undefined,
      42,
      {},
      [],
      '',
      '   ',
      'a'.repeat(65), // unbounded — would bloat a DB row
      'not a sha', // whitespace inside
      '<script>alert(1)</script>', // markup into a dashboard chip
      '../../etc/passwd', // path separators
    ]) {
      expect(normalizeBundleSha(bad as any)).toBeNull();
    }
  });

  it('ACCEPTS non-hex build identifiers — narrowing this would kill auto-reload', () => {
    // This function also gates the player's bundle-drift auto-reload. A
    // hex-only rule would silently switch that off for any self-hosted
    // deploy that stamps NEXT_PUBLIC_BUILD_SHA with a tag or build number —
    // trading a working self-healing mechanism for a tidier telemetry field.
    expect(normalizeBundleSha('1234')).toBe('1234');
    expect(normalizeBundleSha('v1.2.3')).toBe('v1.2.3');
    expect(normalizeBundleSha('release-9')).toBe('release-9');
  });

  it('tolerates whitespace around a hand-set env var', () => {
    expect(normalizeBundleSha('  abc123def456\n')).toBe('abc123def456');
  });
});

describe('readOwnBundleSha', () => {
  const saved = {
    vercel: ENV.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    build: ENV.NEXT_PUBLIC_BUILD_SHA,
  };

  afterEach(() => {
    ENV.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = saved.vercel;
    ENV.NEXT_PUBLIC_BUILD_SHA = saved.build;
  });

  it('reads the Vercel commit SHA, normalized', () => {
    ENV.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA =
      'ABC123DEF456789012345678901234567890AAAA';
    delete ENV.NEXT_PUBLIC_BUILD_SHA;
    expect(readOwnBundleSha()).toBe('abc123def456');
  });

  it('falls back to the in-repo NEXT_PUBLIC_BUILD_SHA convention', () => {
    delete ENV.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
    ENV.NEXT_PUBLIC_BUILD_SHA = '94b94ac8aaaa';
    expect(readOwnBundleSha()).toBe('94b94ac8aaaa');
  });

  it('prefers the Vercel var when both are set', () => {
    ENV.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = 'abc123def456';
    ENV.NEXT_PUBLIC_BUILD_SHA = '94b94ac8aaaa';
    expect(readOwnBundleSha()).toBe('abc123def456');
  });

  it('returns null on a build that stamped no SHA (local dev / self-hosted)', () => {
    // The player then OMITS bundleSha from the render-proof body entirely,
    // the server stores nothing, and the chip stays silent. No false
    // "out of date" for anyone running outside Vercel.
    delete ENV.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;
    delete ENV.NEXT_PUBLIC_BUILD_SHA;
    expect(readOwnBundleSha()).toBeNull();
  });
});

describe('cross-file contract: the player and the dashboard normalize alike', () => {
  it('agrees with components/screens/bundleSkew.ts on every shape', () => {
    // Two copies of a rule are two chances to drift, and this particular
    // drift would show a healthy panel as permanently out of date. Assert
    // them equal rather than trusting a comment.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { normalizeSha, BUNDLE_SHA_COMPARE_LENGTH } =
      require('../../../components/screens/bundleSkew') as typeof import('../../../components/screens/bundleSkew');

    expect(BUNDLE_SHA_COMPARE_LENGTH).toBe(BUNDLE_SHA_LENGTH);
    for (const v of [
      'ABC123DEF456789012345678901234567890AAAA',
      '94b94ac8aaaa',
      '  abc123def456 ',
      'v1.2.3',
      'release-9',
      '1234',
      '',
      '   ',
      'not a sha',
      '<script>',
      '../../etc/passwd',
      'a'.repeat(65),
      null,
      undefined,
      42,
    ]) {
      expect(normalizeSha(v as any)).toBe(normalizeBundleSha(v as any));
    }
  });
});
