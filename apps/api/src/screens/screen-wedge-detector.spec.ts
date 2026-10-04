import { ScreenWedgeDetectorCron } from './screen-wedge-detector.cron';

/**
 * decide() is the pure policy core of the wedge detector — these tests
 * pin the fire/cooldown/escalate/backoff ladder AND the 2026-07-31
 * push-dead branch (a wedged screen with no live WS/SSE channel must be
 * flagged once, never spammed with REFRESH_WEB it cannot receive).
 */
describe('ScreenWedgeDetectorCron.decide', () => {
  const cron = new ScreenWedgeDetectorCron(null as any, null as any, null as any);
  const now = 1_800_000_000_000; // fixed epoch ms — decide() is pure
  const minAgo = (m: number) => new Date(now - m * 60_000);

  it('fires with no history', () => {
    expect(cron.decide(now, []).action).toBe('fire');
  });

  it('cooldown after a recent fire', () => {
    const d = cron.decide(now, [{ action: 'AUTO_REFRESH_WEB', createdAt: minAgo(5) }]);
    expect(d.action).toBe('cooldown');
  });

  it('escalates after 3 fires in the window once past cooldown', () => {
    const d = cron.decide(now, [
      { action: 'AUTO_REFRESH_WEB', createdAt: minAgo(16) },
      { action: 'AUTO_REFRESH_WEB', createdAt: minAgo(22) },
      { action: 'AUTO_REFRESH_WEB', createdAt: minAgo(28) },
    ]);
    expect(d.action).toBe('escalate');
    expect(d.fireCountInWindow).toBe(3);
  });

  it('backs off after a recent give-up', () => {
    const d = cron.decide(now, [{ action: 'AUTO_RECOVERY_GAVE_UP', createdAt: minAgo(30) }]);
    expect(d.action).toBe('backoff');
  });

  it('AUDIT P0-6: escalation is reachable under REAL scheduler timestamps (15-min cooldown + sweep jitter)', () => {
    // The live cadence the 30-min window could never satisfy. Fires spaced
    // by the 15-min cooldown + sweep jitter land at ~t-46.5 / t-31.2 /
    // t-15.5; the escalation evaluation happens on the first sweep after
    // the third fire's cooldown expires — by which point the FIRST fire was
    // 46+ minutes old and had left the old 30-min window, so the count
    // froze at 2 forever. 230 AUTO_REFRESH_WEB rows and ZERO
    // AUTO_RECOVERY_GAVE_UP in the 7 days before 2026-08-30 proved that
    // out in production. With the 50-min window all three count.
    const d = cron.decide(now, [
      { action: 'AUTO_REFRESH_WEB', createdAt: new Date(now - 46.5 * 60_000) },
      { action: 'AUTO_REFRESH_WEB', createdAt: new Date(now - 31.2 * 60_000) },
      { action: 'AUTO_REFRESH_WEB', createdAt: new Date(now - 15.5 * 60_000) },
    ]);
    expect(d.action).toBe('escalate');
    expect(d.fireCountInWindow).toBe(3);
  });

  it('push-dead: flags when no live push channel and no prior flag', () => {
    expect(cron.decide(now, [], true).action).toBe('push-dead');
  });

  it('push-dead: stays quiet when flagged within the reflag window', () => {
    const d = cron.decide(now, [{ action: 'AUTO_RECOVERY_PUSH_DEAD', createdAt: minAgo(60) }], true);
    expect(d.action).toBe('push-dead-flagged');
  });

  it('push-dead: re-flags once the previous flag ages out (>24h)', () => {
    const d = cron.decide(now, [{ action: 'AUTO_RECOVERY_PUSH_DEAD', createdAt: minAgo(25 * 60) }], true);
    expect(d.action).toBe('push-dead');
  });

  it('push-dead trumps cooldown — never burns fire cycles on an unreachable screen', () => {
    const d = cron.decide(now, [{ action: 'AUTO_REFRESH_WEB', createdAt: minAgo(5) }], true);
    expect(d.action).toBe('push-dead');
  });

  it('pushDead=false leaves the classic ladder untouched', () => {
    const d = cron.decide(now, [{ action: 'AUTO_RECOVERY_PUSH_DEAD', createdAt: minAgo(60) }], false);
    expect(d.action).toBe('fire');
  });
});

/**
 * POST-BOOT GRACE (2026-10-03). The candidate query excludes a screen that
 * re-registered within the grace: its staleness predates the boot it just
 * finished. A screen that never rotated its credential is still a candidate.
 */
describe('ScreenWedgeDetectorCron.bootGraceWhere', () => {
  const now = 1_800_000_000_000;
  const where = ScreenWedgeDetectorCron.bootGraceWhere(now);
  const isCandidate = (rotatedAt: Date | null) =>
    rotatedAt === null ? where.OR.some((c) => c.credentialEpochRotatedAt === null) : rotatedAt < where.OR[1].credentialEpochRotatedAt.lt;

  it('leaves a screen alone for three minutes after it boots (the 39-second reload)', () => {
    expect(isCandidate(new Date(now - 39_000))).toBe(false);
    expect(isCandidate(new Date(now - ScreenWedgeDetectorCron.BOOT_GRACE_MS + 1))).toBe(false);
  });

  it('still grades a screen that booted longer ago, and one that never rotated', () => {
    expect(isCandidate(new Date(now - ScreenWedgeDetectorCron.BOOT_GRACE_MS - 1))).toBe(true);
    expect(isCandidate(new Date(now - 29 * 60_000))).toBe(true);
    expect(isCandidate(null)).toBe(true);
  });

  it('the grace is shorter than the cache-stale threshold, so a real wedge is still caught on the next sweep', () => {
    expect(ScreenWedgeDetectorCron.BOOT_GRACE_MS).toBeLessThan(5 * 60_000);
  });
});

/**
 * A PAINTING SCREEN IS NOT WEDGED (2026-10-04). The telemetry tick omits the
 * cache report whenever the service worker is slow or absent, so a stale or
 * missing cache report alone reloaded screens that had painted seconds ago —
 * all night, on seven Brookfield screens. Fresh render proof now excludes a
 * screen; stale or missing render proof still qualifies it.
 */
describe('ScreenWedgeDetectorCron.renderNotFreshWhere', () => {
  const now = 1_800_000_000_000;
  const where = ScreenWedgeDetectorCron.renderNotFreshWhere(now);
  const isCandidate = (renderedAt: Date | null) =>
    renderedAt === null
      ? where.OR.some((c) => c.lastRenderedAt === null)
      : renderedAt < where.OR[1].lastRenderedAt.lt;

  it('leaves alone a screen that painted recently, whatever its cache report says (the overnight loop)', () => {
    expect(isCandidate(new Date(now - 9_000))).toBe(false); // FUH43-R: painted 9 s ago, cache report never
    expect(isCandidate(new Date(now - 3 * 60_000))).toBe(false); // LED Poster 2: painted 3 min ago
    expect(isCandidate(new Date(now - ScreenWedgeDetectorCron.RENDER_STALE_MS + 1))).toBe(false);
  });

  it('still grades a screen whose render proof is stale or has never arrived', () => {
    expect(isCandidate(new Date(now - ScreenWedgeDetectorCron.RENDER_STALE_MS - 1))).toBe(true);
    expect(isCandidate(new Date(now - 37 * 60 * 60_000))).toBe(true); // the 1.1.6 G43 shape
    expect(isCandidate(null)).toBe(true);
  });
});

describe('ScreenWedgeDetectorCron.sweep candidate query', () => {
  it('ANDs the boot grace and the render-freshness guard into the Stage-1 query', async () => {
    const findMany = jest.fn(async () => []);
    const prisma = {
      client: {
        screen: { findMany },
        screenEvent: { deleteMany: jest.fn(async () => ({ count: 0 })) },
        deployment: { deleteMany: jest.fn(async () => ({ count: 0 })) },
      },
    };
    const cron = new ScreenWedgeDetectorCron(prisma as any, {} as any, {} as any);
    await cron.sweep();
    const where = (findMany.mock.calls[0] as any)[0].where;
    expect(where.AND).toHaveLength(2);
    expect(where.AND[1].OR).toEqual([
      { lastRenderedAt: null },
      { lastRenderedAt: { lt: expect.any(Date) } },
    ]);
  });
});
