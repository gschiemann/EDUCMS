/**
 * Manifest content cache — unit tests (Supabase egress diet, 2026-07-30).
 *
 * Pins the invariants the 25 GB/mo fix rests on:
 *   1. Any content mutation (Prisma model in MANIFEST_FED_MODELS) busts the
 *      cache — an operator edit is visible on the very next poll.
 *   2. High-frequency Screen TELEMETRY writes (heartbeat lastPingAt,
 *      cache/render-proof reports) do NOT bust — otherwise the fleet's own
 *      telemetry would thrash the cache into uselessness and the egress
 *      saving silently evaporates with green CI.
 *   3. Unknown columns/actions default to BUSTING (correctness-safe
 *      polarity — new manifest-relevant Screen fields can't go stale).
 *   4. A cached entry never outlives its next schedule boundary (go-lives
 *      land on time) nor its TTL, and a rev captured before a build makes
 *      mid-build mutations impossible to serve twice (torn-read guard).
 */
import {
  bumpManifestContentRev,
  currentManifestContentRev,
  getManifestCache,
  markManifestRevHookArmed,
  resetManifestCacheForTests,
  setManifestCache,
  shouldBumpManifestRev,
} from './manifest-hot-cache';

describe('shouldBumpManifestRev (Prisma mutation hook decision)', () => {
  it('busts on content-model mutations', () => {
    expect(shouldBumpManifestRev('Playlist', 'update', ['name'])).toBe(true);
    expect(shouldBumpManifestRev('PlaylistItem', 'createMany', null)).toBe(true);
    expect(shouldBumpManifestRev('Schedule', 'delete', null)).toBe(true);
    expect(shouldBumpManifestRev('TemplateZone', 'updateMany', ['x'])).toBe(true);
    expect(shouldBumpManifestRev('Tenant', 'update', ['emergencyStatus'])).toBe(true);
  });

  it('ignores non-manifest models and read actions', () => {
    expect(shouldBumpManifestRev('AuditLog', 'create', null)).toBe(false);
    expect(shouldBumpManifestRev('GameEvent', 'create', null)).toBe(false);
    expect(shouldBumpManifestRev('Playlist', 'findMany', null)).toBe(false);
    expect(shouldBumpManifestRev(undefined, 'update', null)).toBe(false);
    expect(shouldBumpManifestRev('Screen', undefined, null)).toBe(false);
  });

  it('skips Screen updates that touch ONLY telemetry columns', () => {
    // The manifest endpoint's own lastPingAt touch — the write that would
    // otherwise bust the cache every 25s and zero out the saving.
    expect(shouldBumpManifestRev('Screen', 'update', ['lastPingAt'])).toBe(false);
    // Heartbeat shape: lastPingAt + status (ONLINE/PENDING).
    expect(shouldBumpManifestRev('Screen', 'update', ['lastPingAt', 'status'])).toBe(false);
    // Render-proof shape incl. sync telemetry.
    expect(
      shouldBumpManifestRev('Screen', 'update', [
        'lastRenderedAt',
        'lastRenderedFrames',
        'lastRenderedHash',
        'lastSyncReport',
        'lastSyncReportAt',
      ]),
    ).toBe(false);
    // Cache-status report shape.
    expect(shouldBumpManifestRev('Screen', 'update', ['lastCacheReport', 'lastCacheReportAt'])).toBe(false);
  });

  // ── 2026-08-03: two paths that silently undid the egress diet ───────────
  // Both wrote Screen columns that were absent from SCREEN_TELEMETRY_ONLY_
  // FIELDS, so each cleared the ENTIRE manifest cache fleet-wide. A morning
  // power-on wave (every screen re-registers) or ONE crash-looping kiosk
  // (10 crash reports/min, forever) re-created the 25 GB/mo Supabase bill.
  it('skips the device RE-REGISTER write shape (morning power-on wave)', () => {
    // POST /screens/register, paired branch — screens.controller.
    expect(
      shouldBumpManifestRev('Screen', 'update', [
        'resolution',
        'osInfo',
        'browserInfo',
        'userAgent',
        'ipAddress',
        'lastPingAt',
        'status',
      ]),
    ).toBe(false);
    // Unpaired branch writes the same set (status: 'PENDING').
    expect(
      shouldBumpManifestRev('Screen', 'update', [
        'resolution',
        'osInfo',
        'browserInfo',
        'userAgent',
        'ipAddress',
        'lastPingAt',
        'status',
      ]),
    ).toBe(false);
  });

  it('skips the APK CRASH-REPORT write shape (one crash-looping kiosk)', () => {
    expect(
      shouldBumpManifestRev('Screen', 'update', [
        'lastCrashAt',
        'lastCrashSource',
        'lastCrashVersion',
        'lastCrashMessage',
        'lastCrashStack',
      ]),
    ).toBe(false);
  });

  it('STILL busts when the re-register back-fills hardwareModel (a real manifest field)', () => {
    // `inferIfUnknown` only returns a value when the column is null, so this
    // shape is the rare genuine back-fill — and hardwareModel IS serialized
    // into the manifest payload, so it must invalidate. This is the guard
    // that keeps the register-path additions from over-reaching.
    expect(
      shouldBumpManifestRev('Screen', 'update', [
        'resolution',
        'osInfo',
        'browserInfo',
        'userAgent',
        'ipAddress',
        'lastPingAt',
        'status',
        'hardwareModel',
      ]),
    ).toBe(true);
  });

  it('busts on Screen updates that touch any manifest-relevant column', () => {
    expect(shouldBumpManifestRev('Screen', 'update', ['canvasW', 'canvasH'])).toBe(true);
    expect(shouldBumpManifestRev('Screen', 'update', ['syncOffsetMs'])).toBe(true);
    expect(shouldBumpManifestRev('Screen', 'update', ['screenGroupId'])).toBe(true);
    expect(shouldBumpManifestRev('Screen', 'update', ['activeBoardGameId', 'activeBoardSurface'])).toBe(true);
    // Every scalar the cached payload actually serializes must keep busting.
    expect(shouldBumpManifestRev('Screen', 'update', ['hardwareModel'])).toBe(true);
    expect(shouldBumpManifestRev('Screen', 'update', ['repeats'])).toBe(true);
    expect(shouldBumpManifestRev('Screen', 'update', ['config'])).toBe(true);
    expect(shouldBumpManifestRev('Screen', 'update', ['tenantId'])).toBe(true);
    // Mixed telemetry + real column → bust (any real column wins).
    expect(shouldBumpManifestRev('Screen', 'update', ['lastPingAt', 'orientation'])).toBe(true);
    // Unknown/new column → bust (correctness-safe default polarity).
    expect(shouldBumpManifestRev('Screen', 'update', ['someFutureColumn'])).toBe(true);
  });

  it('cannot prove telemetry-only → busts (empty/unknown key sets, non-update actions)', () => {
    expect(shouldBumpManifestRev('Screen', 'update', [])).toBe(true);
    expect(shouldBumpManifestRev('Screen', 'update', null)).toBe(true);
    expect(shouldBumpManifestRev('Screen', 'createMany', null)).toBe(true);
    expect(shouldBumpManifestRev('Screen', 'upsert', ['lastPingAt'])).toBe(true);
    expect(shouldBumpManifestRev('Screen', 'delete', null)).toBe(true);
  });
});

describe('manifest content cache lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetManifestCacheForTests();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const fullEntry = (etag = 'abc') => ({
    kind: 'full' as const,
    hashablePayload: { version: '1.0', playlists: [{ id: 'p1' }] },
    etag,
    boundaryAt: null as number | null,
  });

  it('serves a stored full entry until a content mutation busts it', () => {
    setManifestCache('s1', fullEntry(), currentManifestContentRev());
    const hit = getManifestCache('s1');
    expect(hit?.kind).toBe('full');
    expect(hit && hit.kind === 'full' ? hit.etag : null).toBe('abc');

    bumpManifestContentRev(); // e.g. operator saved a playlist
    expect(getManifestCache('s1')).toBeUndefined();
  });

  it('replays a stored empty entry', () => {
    setManifestCache(
      's2',
      { kind: 'empty', body: { hash: 'empty', playlists: [] }, boundaryAt: null },
      currentManifestContentRev(),
    );
    const hit = getManifestCache('s2');
    expect(hit?.kind).toBe('empty');
    expect(hit && hit.kind === 'empty' ? hit.body.hash : null).toBe('empty');
  });

  it('rejects an entry stored with a pre-mutation rev (torn-build guard)', () => {
    const revAtBuildStart = currentManifestContentRev();
    bumpManifestContentRev(); // mutation lands while the build is in flight
    setManifestCache('s3', fullEntry(), revAtBuildStart); // build finishes late
    expect(getManifestCache('s3')).toBeUndefined();
  });

  it('expires at the next schedule boundary (go-lives land on time)', () => {
    const boundaryAt = Date.now() + 5_000;
    setManifestCache('s4', { ...fullEntry(), boundaryAt }, currentManifestContentRev());
    expect(getManifestCache('s4')).toBeDefined();
    jest.advanceTimersByTime(5_001);
    expect(getManifestCache('s4')).toBeUndefined();
  });

  it('uses the short TTL when the mutation hook is NOT armed', () => {
    setManifestCache('s5', fullEntry(), currentManifestContentRev());
    jest.advanceTimersByTime(19_000);
    expect(getManifestCache('s5')).toBeDefined();
    jest.advanceTimersByTime(2_000); // past the 20s unarmed TTL
    expect(getManifestCache('s5')).toBeUndefined();
  });

  it('uses the long TTL backstop when the hook IS armed', () => {
    markManifestRevHookArmed();
    setManifestCache('s6', fullEntry(), currentManifestContentRev());
    jest.advanceTimersByTime(29 * 60_000);
    expect(getManifestCache('s6')).toBeDefined();
    jest.advanceTimersByTime(2 * 60_000); // past the 30min armed TTL
    expect(getManifestCache('s6')).toBeUndefined();
  });

  it('caps entries (evicts rather than growing forever)', () => {
    markManifestRevHookArmed();
    for (let i = 0; i < 1_050; i++) {
      setManifestCache(`bulk-${i}`, fullEntry(`etag-${i}`), currentManifestContentRev());
    }
    // Oldest entries evicted; recent ones survive.
    expect(getManifestCache('bulk-0')).toBeUndefined();
    expect(getManifestCache('bulk-1049')).toBeDefined();
  });
});
