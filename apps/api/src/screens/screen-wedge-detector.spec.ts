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
