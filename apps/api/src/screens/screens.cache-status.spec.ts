/**
 * Legacy `POST /screens/:id/cache-status` — what it stores (2026-09-27).
 *
 * Bundles from before the unified telemetry POST (2026-09-02) still report
 * here. The route used to write its request body AS SENT into
 * `Screen.lastCacheReport` — a column the fleet list hands to every dashboard
 * poll, and one the dashboard now reads a download snapshot (and prints a file
 * name) out of. It now stores the same field-by-field rebuild the telemetry
 * route does (`telemetry/cache-report.ts`).
 */
import { ScreensController } from './screens.controller';
import { resetManifestCacheForTests } from './manifest-hot-cache';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

let seq = 0;

function setup(authOk = true) {
  const screenId = `legacy-cache-${++seq}`;
  const update = jest.fn(async () => ({ id: screenId }));
  const findUnique = jest.fn(async () => ({ id: screenId }));
  const prisma = { client: { screen: { findUnique, update } } } as any;
  const controller = new ScreensController(
    prisma,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  jest
    .spyOn(
      controller as unknown as { deviceAuth: () => Promise<unknown> },
      'deviceAuth',
    )
    .mockResolvedValue(
      authOk ? { ok: true, sub: screenId } : { ok: false, reason: 'no_auth' },
    );
  const req = { headers: { authorization: 'Bearer fake' } } as any;
  return { controller, screenId, update, req };
}

describe('POST /screens/:id/cache-status (legacy) — stores a rebuilt report, never the raw body', () => {
  beforeEach(() => resetManifestCacheForTests());

  it('keeps the two tiers as ints and drops every key it does not know', async () => {
    const { controller, screenId, update, req } = setup();
    await controller.reportCacheStatus(screenId, req, {
      playlist: { count: 3, bytes: 1_000 },
      emergency: { count: 1, bytes: 50, floorBytes: 9 },
      shell: { count: 9, bytes: 9 },
      whatever: 'x'.repeat(10_000),
    } as any);
    const data = (update.mock.calls[0] as any[])[0].data;
    expect(data.lastCacheReport).toEqual({
      playlist: { count: 3, bytes: 1_000 },
      emergency: { count: 1, bytes: 50 },
    });
    expect(JSON.stringify(data.lastCacheReport)).not.toContain('whatever');
    expect(data.lastCacheReportAt).toBeInstanceOf(Date);
  });

  it('a download snapshot is validated like the telemetry route validates it', async () => {
    const { controller, screenId, update, req } = setup();
    await controller.reportCacheStatus(screenId, req, {
      playlist: { count: 0, bytes: 0 },
      downloading: {
        file: '\u001bclip.mp4',
        bytesLoaded: 900,
        bytesTotal: 100,
        deferredCommit: 'yes',
        eta: 5,
      },
    } as any);
    const report = (update.mock.calls[0] as any[])[0].data.lastCacheReport;
    expect(report.downloading).toEqual({
      file: 'clip.mp4',
      bytesLoaded: 100,
      bytesTotal: 100,
      deferredCommit: false,
    });
  });

  it('an unusable snapshot is dropped, and a non-object body stores an empty report', async () => {
    const a = setup();
    await a.controller.reportCacheStatus(a.screenId, a.req, {
      downloading: { file: 'a.mp4', bytesLoaded: 'lots' },
    } as any);
    expect(
      (a.update.mock.calls[0] as any[])[0].data.lastCacheReport,
    ).not.toHaveProperty('downloading');

    const b = setup();
    await b.controller.reportCacheStatus(b.screenId, b.req, 'garbage' as any);
    expect(
      JSON.stringify((b.update.mock.calls[0] as any[])[0].data.lastCacheReport),
    ).toBe('{}');
  });

  it('still coalesces an identical report — the DB-efficiency debounce is keyed on the stored shape', async () => {
    const { controller, screenId, update, req } = setup();
    const body = {
      playlist: { count: 3, bytes: 1_000 },
      emergency: { count: 1, bytes: 50, floorBytes: 9 },
    } as any;
    await controller.reportCacheStatus(screenId, req, body);
    await controller.reportCacheStatus(screenId, req, body);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('still refuses a caller that cannot prove it is this screen, with no write', async () => {
    const { controller, screenId, update, req } = setup(false);
    await expect(
      controller.reportCacheStatus(screenId, req, {
        playlist: { count: 1, bytes: 1 },
      }),
    ).rejects.toMatchObject({
      status: 401,
    });
    expect(update).not.toHaveBeenCalled();
  });
});
