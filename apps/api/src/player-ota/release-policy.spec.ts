/**
 * Regression tests for the OTA release gate.
 *
 * OTA-03 — the server-computed SHA-256 proves transport integrity, NOT
 *           provenance; a real pin has to be recorded out-of-band.
 * OTA-04 — the advertised APK URL was never validated for scheme or host.
 * OTA-05 — no anti-rollback floor, no quarantine, no per-build kill switch.
 */

import { isAllowedApkUrl, evaluateReleaseForFleet } from './release-policy';

const GH = 'https://objects.githubusercontent.com/foo/player-arm64-v8a.apk';

afterEach(() => {
  delete process.env.PLAYER_APK_HOST_ALLOWLIST;
  delete process.env.PLAYER_APK_QUARANTINE;
});

describe('isAllowedApkUrl (OTA-04)', () => {
  it('accepts the GitHub release-asset hosts the pipeline actually uses', () => {
    expect(isAllowedApkUrl(GH)).toBe(true);
    expect(isAllowedApkUrl('https://github.com/o/r/releases/download/player-v1.0.1/a.apk')).toBe(true);
  });

  it('refuses plain http — a fleet APK over a downgradable transport', () => {
    expect(isAllowedApkUrl('http://github.com/a.apk')).toBe(false);
  });

  it('refuses a host that merely SUFFIXES an allowlisted one', () => {
    // The classic bypass. Matching is exact-or-dot-boundary, the same rule
    // the player's `?api=` trust guard uses.
    expect(isAllowedApkUrl('https://github.com.evil.example/a.apk')).toBe(false);
    expect(isAllowedApkUrl('https://notgithub.com/a.apk')).toBe(false);
    // A genuine subdomain of an allowlisted host is fine.
    expect(isAllowedApkUrl('https://cdn.objects.githubusercontent.com/a.apk')).toBe(true);
  });

  it('refuses embedded credentials, which would leak into every kiosk log', () => {
    expect(isAllowedApkUrl('https://user:pw@github.com/a.apk')).toBe(false);
  });

  it('refuses non-http schemes and junk', () => {
    for (const u of ['file:///tmp/a.apk', 'javascript:alert(1)', 'ftp://github.com/a.apk', '', null, 42]) {
      expect(isAllowedApkUrl(u as any)).toBe(false);
    }
  });

  it('honours PLAYER_APK_HOST_ALLOWLIST for a staging / on-prem mirror', () => {
    expect(isAllowedApkUrl('https://apk.staging.example/a.apk')).toBe(false);
    process.env.PLAYER_APK_HOST_ALLOWLIST = 'apk.staging.example';
    expect(isAllowedApkUrl('https://apk.staging.example/a.apk')).toBe(true);
  });
});

describe('evaluateReleaseForFleet', () => {
  it('allows a normal release, and reports honestly that it is UNPINNED', () => {
    // OTA-03: an unpinned build still ships — we are not stranding the
    // fleet on an empty pin map — but the verdict does not pretend the
    // digest proves provenance, and the caller logs which it is.
    const v = evaluateReleaseForFleet({ versionName: '1.0.70', apkUrl: GH, computedSha: 'abc' });
    expect(v).toEqual({ allowed: true, pinned: false });
  });

  it('OTA-04: refuses a release whose URL fails the allowlist', () => {
    const v = evaluateReleaseForFleet({
      versionName: '1.0.70',
      apkUrl: 'http://evil.example/a.apk',
      computedSha: 'abc',
    });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.reason).toMatch(/apk-url-rejected/);
  });

  it('OTA-05: refuses a quarantined build — the per-build kill switch', () => {
    // There was previously NO recall: the only lever for a build discovered
    // to be malicious was publishing a higher tag and hoping.
    process.env.PLAYER_APK_QUARANTINE = '1.0.71,1.0.72';
    const bad = evaluateReleaseForFleet({ versionName: '1.0.71', apkUrl: GH, computedSha: 'abc' });
    expect(bad.allowed).toBe(false);
    if (!bad.allowed) expect(bad.reason).toBe('version-quarantined:1.0.71');
    // A neighbouring build is unaffected — this is build-specific, unlike
    // canaryFleetPercent=0 which disables ALL OTA for a tenant.
    expect(evaluateReleaseForFleet({ versionName: '1.0.73', apkUrl: GH, computedSha: 'abc' }).allowed).toBe(true);
  });

  it('OTA-05: the quarantine env hook can only SUBTRACT, so a stale value is safe', () => {
    // A stale env var can never pin the fleet to an old build (the 2026-05-15
    // footgun) — at worst it declines a good one, which is loud.
    process.env.PLAYER_APK_QUARANTINE = '9.9.9';
    expect(evaluateReleaseForFleet({ versionName: '1.0.70', apkUrl: GH, computedSha: 'abc' }).allowed).toBe(true);
  });

  it('OTA-03: a pinned version must match the out-of-band digest exactly', () => {
    // The point of the pin: the digest is recorded INDEPENDENTLY of the
    // artifact. A server-computed hash of the very URL it is about to
    // advertise proves the device gets what the server got — nothing about
    // where the bytes came from.
    const pins = { '1.0.70': 'DEADBEEF' };
    expect(
      evaluateReleaseForFleet({ versionName: '1.0.70', apkUrl: GH, computedSha: 'deadbeef', pins }),
    ).toEqual({ allowed: true, pinned: true });

    const bad = evaluateReleaseForFleet({
      versionName: '1.0.70',
      apkUrl: GH,
      computedSha: 'feedface',
      pins,
    });
    expect(bad.allowed).toBe(false);
    if (!bad.allowed) expect(bad.reason).toBe('sha-pin-mismatch:1.0.70');
  });

  it('OTA-03: a swapped asset cannot satisfy a pin by being re-hashed', () => {
    // The exact scenario the old comment falsely claimed to close: the
    // release asset is replaced, the server obligingly hashes the NEW bytes,
    // and advertises a matching digest. With a pin, that now fails closed.
    const pins = { '1.0.70': 'a'.repeat(64) };
    const swappedBytesDigest = 'b'.repeat(64);
    expect(
      evaluateReleaseForFleet({
        versionName: '1.0.70',
        apkUrl: GH,
        computedSha: swappedBytesDigest,
        pins,
      }).allowed,
    ).toBe(false);
  });

  it('OTA-03: an env-supplied pin is honoured for incident-time recall', () => {
    process.env.PLAYER_APK_SHA_PINS = '1.0.70=cafebabe';
    expect(
      evaluateReleaseForFleet({ versionName: '1.0.70', apkUrl: GH, computedSha: 'cafebabe' }),
    ).toEqual({ allowed: true, pinned: true });
    expect(
      evaluateReleaseForFleet({ versionName: '1.0.70', apkUrl: GH, computedSha: 'nope' }).allowed,
    ).toBe(false);
    delete process.env.PLAYER_APK_SHA_PINS;
  });
});
