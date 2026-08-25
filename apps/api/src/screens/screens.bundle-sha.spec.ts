/**
 * Page-bundle provenance — the telemetry round trip (2026-08-25).
 *
 * ── The gap this closes ──────────────────────────────────────────────
 * A player fix ships in the WEB bundle, and each panel picks it up on its
 * OWN schedule: the bundle-drift detector polls /api/build-info every 5 min
 * and then DEFERS the reload while content is playing, up to a ~12 min
 * staleness cap. So for up to ~20 minutes after a deploy, a freshly-fixed
 * button is indistinguishable from a dead one — and NOTHING in telemetry
 * recorded which bundle a panel was actually running. `lastCacheReport`
 * carries playlist/emergency byte counts and nothing else, so the only way
 * to reason about panel state was to infer it from deploy timestamps. That
 * inference is what turned a one-line player bug into an hour of the
 * operator believing his whole fleet was broken.
 *
 * The SHA now rides the render-proof POST the player already makes every
 * ~30s — device-authed, additive, no new endpoint, and (per the manifest
 * cache rule) NOT a manifest field, since a manifest that varied per
 * reporting device would kill 304s fleet-wide.
 *
 * What these pin:
 *   1. ROUND TRIP — a reported SHA lands on Screen.lastBundleSha/-At and
 *      survives into the fleet list the dashboard chip reads.
 *   2. SANITIZATION — the value comes from a device, so it is shape-checked,
 *      lowercased and truncated before it can reach a dashboard chip or
 *      bloat the row. Anything unparseable becomes null = "unknown" = the
 *      chip renders NOTHING (never a false alarm).
 *   3. DEBOUNCE — an UNCHANGED SHA still coalesces to one write per 40s (the
 *      DB-efficiency win stays), but a CHANGED SHA writes through at once, so
 *      a panel that just reloaded onto the fix stops reading "out of date"
 *      immediately instead of up to 40s later.
 *   4. HOT-CACHE SAFETY — the load-bearing one. The render-proof write fires
 *      ~every 40s per screen fleet-wide; if the two new columns were not in
 *      SCREEN_TELEMETRY_ONLY_FIELDS, every one of those writes would clear
 *      every cached manifest process-wide and re-create the 25 GB/mo
 *      Supabase egress the cache exists to prevent.
 */
import { ScreensController } from './screens.controller';
import { shouldBumpManifestRev } from './manifest-hot-cache';

const SHA_A = 'abc123def456';
const SHA_B = '94b94ac8aaaa';

describe('render-proof bundleSha — player → telemetry → row', () => {
  let controller: ScreensController;
  let mockPrisma: any;
  let screenSeq = 0;

  /** A fresh screen id per case: the debounce map is module-level state. */
  const nextScreenId = () => `screen-bundle-${++screenSeq}`;

  const post = (id: string, body: Record<string, unknown>) =>
    (controller as any).reportRenderProof(id, {} as any, body);

  /** `data` of the Nth screen.update call (default: the first). */
  const updateData = (n = 0) =>
    mockPrisma.client.screen.update.mock.calls[n][0].data;

  beforeEach(() => {
    mockPrisma = {
      client: {
        screen: {
          findUnique: jest.fn(async () => ({ id: 'x' })),
          update: jest.fn(async () => ({ id: 'x' })),
          findMany: jest.fn(),
        },
        tenant: {
          findUnique: jest.fn(async () => ({
            latitude: null,
            longitude: null,
            address: null,
          })),
        },
      },
    };
    controller = new ScreensController(
      mockPrisma,
      { publish: jest.fn() } as any,
      { signMessage: jest.fn() } as any,
      { assertSeatAvailable: jest.fn() } as any,
      { syncSubscriptionQuantity: jest.fn() } as any,
    );
    // Device auth is exercised by its own suites; this one is about the
    // payload. Stub it authenticated so the body path is reachable.
    (controller as any).deviceAuth = jest.fn(async () => ({ ok: true }));
  });

  it('persists a reported SHA to lastBundleSha + lastBundleShaAt', async () => {
    const id = nextScreenId();
    await post(id, { frames: 120, hash: 'pl:abc', bundleSha: SHA_A });

    const data = updateData();
    expect(data.lastBundleSha).toBe(SHA_A);
    expect(data.lastBundleShaAt).toBeInstanceOf(Date);
    // Additive only: the existing render-proof columns are untouched.
    expect(data.lastRenderedAt).toBeInstanceOf(Date);
    expect(data.lastRenderedFrames).toBe(120);
  });

  it('an older player that reports NO SHA writes neither column', async () => {
    // The whole fleet is on such a build the moment this ships. Writing a
    // null would be worse than writing nothing: it would look like a probe
    // that RAN and found nothing, rather than a build that never reports.
    const id = nextScreenId();
    await post(id, { frames: 7 });

    const data = updateData();
    expect('lastBundleSha' in data).toBe(false);
    expect('lastBundleShaAt' in data).toBe(false);
    expect(data.lastRenderedAt).toBeInstanceOf(Date);
  });

  it('truncates to the 12-char short form and lowercases it', async () => {
    // /api/build-info and the drift detector both compare on the first 12
    // chars; a full 40-char SHA from some other build path must land on the
    // same value or the chip would false-positive forever.
    const id = nextScreenId();
    await post(id, { bundleSha: 'ABC123DEF456789012345678901234567890AAAA' });
    expect(updateData().lastBundleSha).toBe(SHA_A);
  });

  it('drops a hostile / unreadable SHA to "unknown" rather than storing it', async () => {
    // The value is device-supplied and ends up inside a dashboard chip.
    for (const evil of [
      '<script>alert(1)</script>', // markup
      'a'.repeat(500), // row bloat
      'not a sha', // whitespace inside
      '../../etc/passwd', // path separators
      '',
      '   ',
      12345, // wrong type
      { sha: 'x' },
    ]) {
      const id = nextScreenId();
      mockPrisma.client.screen.update.mockClear();
      await post(id, { frames: 1, bundleSha: evil as any });
      const data = updateData();
      expect('lastBundleSha' in data).toBe(false);
    }
  });

  it('accepts a non-hex build identifier — the rule is bounded, not hex-only', async () => {
    // Mirrors the player-side rule, which also gates the bundle-drift
    // auto-reload; narrowing either copy to "looks like a git SHA" would
    // switch that off for self-hosted builds stamping a tag or build number.
    const id = nextScreenId();
    await post(id, { frames: 1, bundleSha: 'v1.2.3' });
    expect(updateData().lastBundleSha).toBe('v1.2.3');
  });

  describe('write debounce', () => {
    it('coalesces an UNCHANGED SHA — the DB-efficiency win survives', async () => {
      const id = nextScreenId();
      await post(id, { frames: 1, bundleSha: SHA_A });
      await post(id, { frames: 2, bundleSha: SHA_A });
      await post(id, { frames: 3, bundleSha: SHA_A });
      expect(mockPrisma.client.screen.update).toHaveBeenCalledTimes(1);
    });

    it('writes through IMMEDIATELY when the SHA changes — the panel just reloaded', async () => {
      // Without this the chip would keep saying "out of date" for up to 40s
      // after the panel already picked up the fix — a fresh version of the
      // same lie this whole feature exists to kill.
      const id = nextScreenId();
      await post(id, { frames: 1, bundleSha: SHA_A });
      await post(id, { frames: 2, bundleSha: SHA_B });
      expect(mockPrisma.client.screen.update).toHaveBeenCalledTimes(2);
      expect(updateData(1).lastBundleSha).toBe(SHA_B);
    });

    it('a build that reports no SHA still debounces exactly as before', async () => {
      const id = nextScreenId();
      await post(id, { frames: 1 });
      await post(id, { frames: 2 });
      expect(mockPrisma.client.screen.update).toHaveBeenCalledTimes(1);
    });
  });

  it('surfaces the SHA on the fleet list the dashboard chip reads', async () => {
    // list() strips heavyweight columns; these two must survive that pass or
    // the chip has nothing to compare against.
    mockPrisma.client.screen.findMany.mockResolvedValue([
      {
        id: 'screen-1',
        tenantId: 'tenant-xyz',
        name: 'Lobby',
        status: 'ONLINE',
        lastPingAt: new Date(),
        latitude: null,
        longitude: null,
        lastBundleSha: SHA_A,
        lastBundleShaAt: new Date(),
        lastCrashStack: 'x'.repeat(100),
        screenGroup: null,
      },
    ]);
    const rows = await (controller as any).list(
      { user: { id: 'u', tenantId: 'tenant-xyz', role: 'SCHOOL_ADMIN' } },
      { setHeader: jest.fn() },
    );
    expect(rows[0].lastBundleSha).toBe(SHA_A);
    expect(rows[0].lastBundleShaAt).toBeInstanceOf(Date);
    // …and the strip pass still does its job.
    expect(rows[0].lastCrashStack).toBeUndefined();
  });
});

describe('manifest hot cache — the new columns are TELEMETRY, not content', () => {
  it('a render-proof write carrying the SHA does NOT bust the cache', () => {
    // THE 25 GB/mo RULE. This write fires ~every 40s per screen, fleet-wide.
    expect(
      shouldBumpManifestRev('Screen', 'update', [
        'lastRenderedAt',
        'lastRenderedFrames',
        'lastRenderedHash',
        'lastBundleSha',
        'lastBundleShaAt',
      ]),
    ).toBe(false);
  });

  it('each new column is telemetry-only on its own', () => {
    expect(shouldBumpManifestRev('Screen', 'update', ['lastBundleSha'])).toBe(false);
    expect(shouldBumpManifestRev('Screen', 'update', ['lastBundleShaAt'])).toBe(false);
  });

  it('a REAL content column alongside them still busts (polarity intact)', () => {
    // The guard must not have been widened into "any Screen update is free".
    expect(
      shouldBumpManifestRev('Screen', 'update', ['lastBundleSha', 'orientation']),
    ).toBe(true);
  });
});
