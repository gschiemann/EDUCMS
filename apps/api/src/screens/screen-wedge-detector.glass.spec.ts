/**
 * "PAGE DOWN, GLASS PLAYING" (native-first design §4.4, CLAUDE.md player rule
 * 10 — copy states what the evidence proves). On a native-first face the
 * app's session survives a dead page, so a stale render proof no longer means
 * a frozen screen. The detector still recovers the PAGE (a reload no longer
 * touches a native-first session) and says exactly what the native heartbeat
 * proves; without that evidence nothing changes.
 */
import { ScreenWedgeDetectorCron } from './screen-wedge-detector.cron';

const NOW = Date.parse('2026-10-19T12:00:00.000Z');
const MIN = 60_000;

function makeCron(candidates: any[]) {
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
      schedule: { findMany: jest.fn(async () => []) },
    },
  };
  const redis: any = { publish: jest.fn(async () => undefined) };
  const signer: any = { signMessage: jest.fn(() => ({ type: 'REFRESH_WEB', signature: 'sig' })) };
  return { cron: new ScreenWedgeDetectorCron(prisma, signer, redis), prisma, redis };
}

const runtime = {
  schema: 1, interactive: true, foreground: true, standbySinceMs: null, elapsedRealtimeMs: 1_000_000, powerOnAck: null,
};
const screen = (over: Record<string, any> = {}) => ({
  id: 'screen-a',
  name: 'Lobby',
  tenantId: 'tenant-a',
  screenGroupId: null,
  faceOfScreenId: null,
  lastPingAt: new Date(NOW - 30_000),
  lastCacheReportAt: new Date(NOW - 20 * MIN),
  lastRenderedAt: new Date(NOW - 20 * MIN),
  pairedAt: new Date(NOW - 30 * 24 * 60 * MIN),
  lastPushConnectedAt: new Date(NOW - 20_000),
  nativeRuntimeReport: null,
  nativeRuntimeReportAt: null,
  lastVideoReport: null,
  lastVideoReportAt: null,
  ...over,
});

beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
afterEach(() => jest.useRealTimers());

const details = (prisma: any) => JSON.parse(prisma.client.auditLog.create.mock.calls[0][0].data.details);

it('a stale page with the app\'s native frames fresh on the glass: recovered, graded "page down, glass playing"', async () => {
  const { cron, prisma, redis } = makeCron([screen({
    nativeRuntimeReport: { ...runtime, nativePresenting: { sha8: 'abcdef01', uniqueFrames: 9000, ageMs: 33 } },
    nativeRuntimeReportAt: new Date(NOW - 20_000),
  })]);
  const out = await cron.sweep();
  expect(out.recovered).toBe(1);
  expect(redis.publish).toHaveBeenCalledTimes(1);
  const d = details(prisma);
  expect(d.reason).toMatch(/^page down, glass playing \(native frames 33ms old, sha abcdef01\) — cache-report stale 20min/);
  expect(d.glass).toBe('page-down-glass-playing');
  expect(d.reason).not.toMatch(/frozen/i);
});

it('control: no native evidence, a stale heartbeat or an old frame → today\'s wording, unchanged', async () => {
  for (const over of [
    {},
    { nativeRuntimeReport: { ...runtime, nativePresenting: { sha8: 'abcdef01', uniqueFrames: 9000, ageMs: 33 } }, nativeRuntimeReportAt: new Date(NOW - 10 * MIN) },
    { nativeRuntimeReport: { ...runtime, nativePresenting: { sha8: 'abcdef01', uniqueFrames: 9000, ageMs: 60_000 } }, nativeRuntimeReportAt: new Date(NOW - 20_000) },
  ]) {
    const { cron, prisma } = makeCron([screen(over)]);
    expect((await cron.sweep()).recovered).toBe(1);
    const d = details(prisma);
    expect(d.reason).toMatch(/^cache-report stale 20min/);
    expect(d.glass).toBeUndefined();
  }
});
