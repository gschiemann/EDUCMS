/**
 * Wedge cron — timeline rows + retention (2026-08-31, Fleet Command Ph.2).
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The cron already writes an AuditLog row for every recovery it attempts.
 * What it could not say is what a SCREEN's own history looks like, which is
 * the question an operator staring at one dark panel actually asks. These
 * pin the two additions and, more importantly, that they changed nothing:
 *
 *   1. Both branches that stamp `pendingRefreshAt` also write an
 *      'auto-refresh-requested' row — the dual-path FIRE branch and the
 *      PUSH-DEAD branch, where the manifest ride is the only delivery left.
 *   2. A failing timeline write cannot alter a recovery outcome. Recovery is
 *      load-bearing; bookkeeping is not, and the two must never be coupled.
 *   3. Retention runs BEFORE the zero-candidate early return. A healthy
 *      fleet has no wedge candidates — which is precisely the fleet whose
 *      tables would otherwise grow forever — and it is throttled to hourly
 *      so a 60-second sweep does not turn into a delete storm.
 */
import { ScreenWedgeDetectorCron } from './screen-wedge-detector.cron';

const NOW = 1_700_000_000_000;

function makeCron(candidates: any[]) {
  const prisma: any = {
    client: {
      screen: {
        findMany: jest.fn(async () => candidates),
        update: jest.fn(async () => ({ id: 'x' })),
      },
      auditLog: { findMany: jest.fn(async () => []), create: jest.fn(async () => ({})) },
      notification: { create: jest.fn(async () => ({})) },
      screenEvent: {
        create: jest.fn(async () => ({})),
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      deployment: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    },
  };
  const redis: any = { publish: jest.fn(async () => undefined) };
  const signer: any = { signMessage: jest.fn(() => ({ type: 'REFRESH_WEB', signature: 'sig' })) };
  return { cron: new ScreenWedgeDetectorCron(prisma, signer, redis), prisma, redis };
}

/** A wedge candidate shaped the way sweep()'s Stage-1 select returns it. */
const candidate = (over: Record<string, any> = {}) => ({
  id: 'screen-1',
  name: 'Lobby',
  tenantId: 'tenant-a',
  lastPingAt: new Date(NOW - 10_000), // fresh ping → "alive"
  lastCacheReportAt: new Date(NOW - 30 * 60_000), // stale → wedged
  lastRenderedAt: new Date(NOW - 30 * 60_000),
  pairedAt: new Date(NOW - 48 * 60 * 60_000),
  lastPushConnectedAt: new Date(NOW - 10_000), // fresh → push channel alive
  ...over,
});

beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
afterEach(() => jest.useRealTimers());

describe('auto-refresh-requested timeline rows', () => {
  it('the FIRE branch records the durable ride it just stamped', async () => {
    const { cron, prisma, redis } = makeCron([candidate()]);

    const out = await cron.sweep();
    expect(out.recovered).toBe(1);

    // Existing behavior untouched: durable stamp + signed publish + audit.
    expect(prisma.client.screen.update).toHaveBeenCalledTimes(1);
    expect(redis.publish).toHaveBeenCalledTimes(1);
    expect(prisma.client.auditLog.create.mock.calls[0][0].data.action).toBe('AUTO_REFRESH_WEB');

    const ev = prisma.client.screenEvent.create.mock.calls[0][0].data;
    expect(ev).toMatchObject({
      screenId: 'screen-1',
      tenantId: 'tenant-a',
      kind: 'auto-refresh-requested',
    });
    expect(ev.detail.reason).toBe('wedge');
    expect(ev.detail.corrId).toEqual(expect.any(String));
  });

  it('the PUSH-DEAD branch records it too — that ride is the ONLY delivery left', async () => {
    const { cron, prisma, redis } = makeCron([
      // No live WS/SSE channel: a pushed REFRESH_WEB cannot arrive, so the
      // manifest flag is the whole delivery mechanism.
      candidate({ lastPushConnectedAt: new Date(NOW - 60 * 60_000) }),
    ]);

    const out = await cron.sweep();
    expect(out.recovered).toBe(0); // still not a "fire" — unchanged
    expect(redis.publish).not.toHaveBeenCalled(); // still no pointless push
    expect(prisma.client.auditLog.create.mock.calls[0][0].data.action).toBe(
      'AUTO_RECOVERY_PUSH_DEAD',
    );

    const ev = prisma.client.screenEvent.create.mock.calls[0][0].data;
    expect(ev.kind).toBe('auto-refresh-requested');
    expect(ev.detail.reason).toBe('push-dead');
  });

  it('a THROWING timeline write leaves the recovery outcome untouched', async () => {
    const { cron, prisma, redis } = makeCron([candidate()]);
    prisma.client.screenEvent.create.mockRejectedValue(new Error('db down'));

    const out = await cron.sweep();
    // Recovery is load-bearing; bookkeeping is not. The screen still gets
    // its durable stamp, its push, and its audit row.
    expect(out.recovered).toBe(1);
    expect(prisma.client.screen.update).toHaveBeenCalledTimes(1);
    expect(redis.publish).toHaveBeenCalledTimes(1);
    expect(prisma.client.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

describe('retention sweep', () => {
  it('prunes on a HEALTHY fleet — the zero-candidate path still runs it', async () => {
    // The load-bearing ordering: hanging retention off the end of sweep()
    // would skip every fleet with nothing wedged, i.e. almost all of them.
    const { cron, prisma } = makeCron([]);

    const out = await cron.sweep();
    expect(out.scanned).toBe(0);
    expect(prisma.client.screenEvent.deleteMany).toHaveBeenCalledTimes(1);
    expect(prisma.client.deployment.deleteMany).toHaveBeenCalledTimes(1);

    // 30 d events / 90 d deployments.
    const evCutoff: Date = prisma.client.screenEvent.deleteMany.mock.calls[0][0].where.createdAt.lt;
    const depCutoff: Date = prisma.client.deployment.deleteMany.mock.calls[0][0].where.createdAt.lt;
    expect(NOW - evCutoff.getTime()).toBe(30 * 24 * 60 * 60_000);
    expect(NOW - depCutoff.getTime()).toBe(90 * 24 * 60 * 60_000);
  });

  it('throttles to hourly — a 60s sweep cadence must not become a delete storm', async () => {
    const { cron, prisma } = makeCron([]);

    await cron.sweep();
    jest.setSystemTime(NOW + 59 * 60_000);
    await cron.sweep();
    expect(prisma.client.screenEvent.deleteMany).toHaveBeenCalledTimes(1);

    jest.setSystemTime(NOW + 61 * 60_000);
    await cron.sweep();
    expect(prisma.client.screenEvent.deleteMany).toHaveBeenCalledTimes(2);
  });

  it('a failing prune never fails the sweep', async () => {
    const { cron, prisma } = makeCron([candidate()]);
    prisma.client.screenEvent.deleteMany.mockRejectedValue(new Error('db down'));

    await expect(cron.sweep()).resolves.toMatchObject({ recovered: 1 });
  });
});
