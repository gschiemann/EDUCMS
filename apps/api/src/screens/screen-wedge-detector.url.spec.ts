/**
 * Not a wedge (2026-10-17, player rock-solid §4B — the interruption gate):
 *
 *   1. A screen showing a WEB PAGE. The APK's overlay WebView (or an iframe)
 *      draws it; the player page underneath has nothing to repaint and no file
 *      to cache, so its render proof stalls and it never posts a cache report.
 *      The detector reloaded TC32 7× and G75 7× in seven days
 *      (`AUTO_REFRESH_WEB`, "cache-report stale 7651min").
 *   2. A screen whose own telemetry proves its media is advancing: a fresh
 *      render proof, a fresh video sample that presented frames, or the
 *      hardware engine presenting on the glass.
 *
 * Cache-report staleness alone never qualifies. A genuine wedge — nothing
 * fresh, no web page — is still recovered exactly as before.
 */
import { ScreenWedgeDetectorCron } from './screen-wedge-detector.cron';

const NOW = 1_792_244_536_000; // 2026-10-17T13:42:16Z — the TC32 fire
const MIN = 60_000;

function makeCron(candidates: any[], schedules: any[] | Error = []) {
  const prisma: any = {
    client: {
      screen: {
        findMany: jest.fn(async () => candidates),
        update: jest.fn(async () => ({ id: 'x' })),
      },
      auditLog: { findMany: jest.fn(async () => []), create: jest.fn(async () => ({})) },
      notification: { create: jest.fn(async () => ({})) },
      screenEvent: { create: jest.fn(async () => ({})), deleteMany: jest.fn(async () => ({ count: 0 })) },
      deployment: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      schedule: {
        findMany: jest.fn(async () => {
          if (schedules instanceof Error) throw schedules;
          return schedules;
        }),
      },
    },
  };
  const redis: any = { publish: jest.fn(async () => undefined) };
  const signer: any = { signMessage: jest.fn(() => ({ type: 'REFRESH_WEB', signature: 'sig' })) };
  return { cron: new ScreenWedgeDetectorCron(prisma, signer, redis), prisma, redis };
}

/** TC32 at 13:42:16 on 2026-10-17, as the Stage-1 select returns it. */
const tc32 = (over: Record<string, any> = {}) => ({
  id: 'screen-tc32',
  name: 'TC32',
  tenantId: 'tenant-brookfield',
  screenGroupId: 'group-touch',
  faceOfScreenId: null,
  lastPingAt: new Date(NOW - 32_000), // "ping fresh 32s ago"
  lastCacheReportAt: new Date(NOW - 7651 * MIN), // "cache-report stale 7651min"
  lastRenderedAt: new Date(NOW - 12 * MIN),
  pairedAt: new Date(NOW - 30 * 24 * 60 * MIN),
  lastPushConnectedAt: new Date(NOW - 20_000),
  nativeRuntimeReport: null,
  nativeRuntimeReportAt: null,
  lastVideoReport: null,
  lastVideoReportAt: null,
  ...over,
});

const urlSchedule = { tenantId: 'tenant-brookfield', screenId: 'screen-tc32', screenGroupId: null };

beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
afterEach(() => jest.useRealTimers());

const expectNoFire = (prisma: any, redis: any, out: any) => {
  expect(out.recovered).toBe(0);
  expect(redis.publish).not.toHaveBeenCalled();
  expect(prisma.client.screen.update).not.toHaveBeenCalled();
  expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
};

describe('a screen showing a web page is never a wedge', () => {
  it('the task shape: fresh ping, fresh render proof, cache report days old, URL content → no fire', async () => {
    const { cron, prisma, redis } = makeCron([tc32({ lastRenderedAt: new Date(NOW - 40_000) })], [urlSchedule]);
    expectNoFire(prisma, redis, await cron.sweep());
  });

  it('the TC32 fire as it really was — render proof stale too — is still no fire', async () => {
    const { cron, prisma, redis } = makeCron([tc32()], [urlSchedule]);
    expectNoFire(prisma, redis, await cron.sweep());
  });

  it('a web page reached through the screen\'s group, or the primary a face mirrors, counts too', async () => {
    const byGroup = makeCron([tc32()], [{ tenantId: 'tenant-brookfield', screenId: null, screenGroupId: 'group-touch' }]);
    expectNoFire(byGroup.prisma, byGroup.redis, await byGroup.cron.sweep());
    const face = makeCron([tc32({ id: 'screen-back', faceOfScreenId: 'screen-tc32' })], [urlSchedule]);
    expectNoFire(face.prisma, face.redis, await face.cron.sweep());
  });

  it('the lookup is one tenant-scoped query over active, in-window schedules with a URL item or a web-page zone', async () => {
    const { cron, prisma } = makeCron([tc32(), tc32({ id: 'screen-g75', screenGroupId: null })], [urlSchedule]);
    await cron.sweep();
    expect(prisma.client.schedule.findMany).toHaveBeenCalledTimes(1);
    const where = prisma.client.schedule.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toEqual({ in: ['tenant-brookfield'] });
    expect(where.isActive).toBe(true);
    expect(where.startTime).toEqual({ lte: new Date(NOW) });
    expect(where.AND[0]).toEqual({ OR: [{ endTime: null }, { endTime: { gte: new Date(NOW) } }] });
    expect(where.AND[1]).toEqual({ OR: [{ screenId: { in: ['screen-tc32', 'screen-g75'] } }, { screenGroupId: { in: ['group-touch'] } }] });
    expect(where.AND[2].playlist.OR).toEqual([
      { items: { some: { asset: { mimeType: 'text/html' } } } },
      { template: { zones: { some: { widgetType: { in: ['WEBPAGE', 'WEBSITE_TABS'] } } } } },
    ]);
  });

  it('a web page in ANOTHER tenant\'s same-named group never exempts this screen', async () => {
    const { cron, redis } = makeCron([tc32()], [{ tenantId: 'tenant-other', screenId: null, screenGroupId: 'group-touch' }]);
    expect((await cron.sweep()).recovered).toBe(1);
    expect(redis.publish).toHaveBeenCalledTimes(1);
  });

  it('control: the same stale shape with NO web page is still recovered', async () => {
    const { cron, prisma, redis } = makeCron([tc32()], []);
    const out = await cron.sweep();
    expect(out.recovered).toBe(1);
    expect(redis.publish).toHaveBeenCalledTimes(1);
    expect(prisma.client.auditLog.create.mock.calls[0][0].data.action).toBe('AUTO_REFRESH_WEB');
  });

  it('a lookup that fails exempts nobody (today\'s behaviour)', async () => {
    const { cron } = makeCron([tc32()], new Error('db down'));
    expect((await cron.sweep()).recovered).toBe(1);
  });
});

describe('fresh playback telemetry is never a wedge', () => {
  it('a video sample from the last 2 minutes that presented frames → no fire (G75 playing, cache report 7 min old)', async () => {
    const { cron, prisma, redis } = makeCron([tc32({
      name: 'G75',
      lastCacheReportAt: new Date(NOW - 7 * MIN),
      lastVideoReportAt: new Date(NOW - 50_000),
      lastVideoReport: { url: 'u', totalFrames: 1816, droppedFrames: 2, at: new Date(NOW - 50_000).toISOString() },
    })]);
    expectNoFire(prisma, redis, await cron.sweep());
    expect(prisma.client.schedule.findMany).not.toHaveBeenCalled(); // decided before the lookup
  });

  it('the hardware engine presenting on the glass, reported in the last 2 minutes → no fire', async () => {
    const { cron, prisma, redis } = makeCron([tc32({
      lastVideoReport: { native: { state: 'presenting', output: { visible: true }, at: new Date(NOW - 30_000).toISOString() } },
    })]);
    expectNoFire(prisma, redis, await cron.sweep());
  });

  it('a sample that only DROPPED frames, an old one, or a native engine not on the glass proves nothing', async () => {
    for (const over of [
      { lastVideoReportAt: new Date(NOW - 50_000), lastVideoReport: { totalFrames: 1800, droppedFrames: 1800 } },
      { lastVideoReportAt: new Date(NOW - 3 * MIN), lastVideoReport: { totalFrames: 1800, droppedFrames: 0 } },
      { lastVideoReport: { native: { state: 'preparing', output: { visible: false }, at: new Date(NOW - 30_000).toISOString() } } },
      { lastVideoReport: { native: { state: 'presenting', output: { visible: true }, at: new Date(NOW - 5 * MIN).toISOString() } } },
    ]) {
      const { cron } = makeCron([tc32(over)]);
      expect((await cron.sweep()).recovered).toBe(1);
    }
  });

  it('hasFreshPlaybackTelemetry: a render proof inside the window counts; a future stamp does not', () => {
    expect(ScreenWedgeDetectorCron.hasFreshPlaybackTelemetry({ lastRenderedAt: new Date(NOW - 119_000) }, NOW)).toBe(true);
    expect(ScreenWedgeDetectorCron.hasFreshPlaybackTelemetry({ lastRenderedAt: new Date(NOW - 121_000) }, NOW)).toBe(false);
    expect(ScreenWedgeDetectorCron.hasFreshPlaybackTelemetry({ lastRenderedAt: new Date(NOW + 10 * MIN) }, NOW)).toBe(false);
    expect(ScreenWedgeDetectorCron.hasFreshPlaybackTelemetry({ lastVideoReport: 'garbage', lastVideoReportAt: new Date(NOW) }, NOW)).toBe(false);
  });
});
