/**
 * OfflineScreenScanner — proof of life (2026-10-24).
 *
 * On the customer alert emails' first day in production nothing qualified,
 * and both workers on this tick log only when something HAPPENS — so the
 * pipeline could not be told apart from a dead one. Worse, the one line that
 * said "running" is written in the boot log burst that Railway's 500-lines/s
 * limit drops (it was missing from the deployment that was searched). These
 * lock the two lines that now prove the tick runs: one "alive" line on the
 * first scan (60 s after boot, after the burst) and a counts-only summary
 * every 15 minutes.
 */
import { OfflineScreenScanner, PIPELINE_SUMMARY_INTERVAL_MS } from './offline-screen-scanner';

const MIN = 60_000;
const BOOT = Date.parse('2026-10-24T17:14:54Z');

function build(opts: { leader?: boolean; alertEmails?: 'wired' | 'none'; scanThrows?: boolean; alertThrows?: boolean } = {}) {
  const scanResult = { found: 4, notified: 0, infraEvents: 0, crossings: 0, recovered: 0, seeded: false, offline: [] };
  const notifications = {
    scanOfflineScreens: jest.fn(async () => {
      if (opts.scanThrows) throw new Error('db down');
      return scanResult;
    }),
  };
  const lease = { tryAcquire: jest.fn(async () => ({ leader: opts.leader ?? true })) };
  // What the alert worker returned for G24 on 2026-10-24: due by age, held
  // back by its own on/off schedule; three screens in the long-dead tail.
  const alertTick = {
    mode: 'shadow',
    offlineDue: 1,
    offlineTooOld: 3,
    offlineCandidates: 1,
    noContentCandidates: 0,
    deferred: { 'display-schedule-off': 1 },
    opened: 0,
    silenced: 0,
    held: 0,
    recovered: 0,
    sends: 0,
    platformIncident: false,
  };
  const alertEmails =
    opts.alertEmails === 'none'
      ? undefined
      : {
          onOfflineScan: jest.fn(async () => {
            if (opts.alertThrows) throw new Error('boom');
            return alertTick;
          }),
          wiring: () => ({ customerMailer: true, ownerMailer: true }),
        };
  const scanner = new OfflineScreenScanner(notifications as any, lease as any, alertEmails as any);
  const clock = { now: BOOT };
  scanner.now = () => clock.now;
  const logs: string[] = [];
  (scanner as any).logger = {
    log: jest.fn((m: string) => logs.push(m)),
    warn: jest.fn((m: string) => logs.push(`WARN ${m}`)),
  };
  /** One scan, then one minute passes (the production cadence). */
  const tick = async () => {
    await (scanner as any).tick(5);
    clock.now += MIN;
  };
  return { scanner, notifications, alertEmails, clock, logs, tick };
}

const ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ENV, PLATFORM_ALERT_EMAILS: 'owner@example.org' };
  delete process.env.CUSTOMER_ALERT_EMAILS_MODE;
  delete process.env.CUSTOMER_ALERT_EMAILS_DISABLED;
});
afterAll(() => {
  process.env = ENV;
});

const alive = (logs: string[]) => logs.filter((l) => l.startsWith('OfflineScreenScanner alive'));
const summaries = (logs: string[]) => logs.filter((l) => l.startsWith('[alert-email] pipeline summary'));

describe('the first scan says the pipeline is alive — once, after the boot burst', () => {
  it('leader: names the role, the alert-email mode and the wiring; never repeated', async () => {
    const { logs, tick } = build();
    await tick();
    await tick();
    expect(alive(logs)).toEqual([
      'OfflineScreenScanner alive — first scan ran as leader (offline=4); [alert-email] mode=shadow, owner mailer wired, ' +
        'PLATFORM_ALERT_EMAILS set; pipeline summary every 15 min',
    ]);
  });

  it('a follower replica says it follows (and does not scan)', async () => {
    const { logs, tick, notifications } = build({ leader: false });
    await tick();
    expect(alive(logs)).toHaveLength(1);
    expect(alive(logs)[0]).toMatch(/^OfflineScreenScanner alive — another replica holds the scan lease/);
    expect(notifications.scanOfflineScreens).not.toHaveBeenCalled();
  });

  it('says so when the alert worker is not wired at all', async () => {
    const { logs, tick } = build({ alertEmails: 'none' });
    await tick();
    expect(alive(logs)[0]).toContain('[alert-email] NOT WIRED');
  });
});

describe('every 15 minutes: ONE counts-only summary of what the pipeline saw and decided', () => {
  it('nothing before 15 min; then the line — sends, what the last scan saw, why it held back — and a fresh window', async () => {
    const { logs, tick } = build();
    for (let i = 0; i < 15; i++) await tick(); // BOOT … BOOT+14 min
    expect(summaries(logs)).toHaveLength(0);
    await tick(); // BOOT+15 min
    expect(summaries(logs)).toEqual([
      '[alert-email] pipeline summary (15 min): mode=shadow scans=16 leader=16 follower=0 skipped=0 ' +
        'scanFailed=0 alertFailed=0 | sends=0 opened=0 held=0 silenced=0 recovered=0 platformIncidents=0 gated={} | ' +
        'last scan: offline=4 due=1 tooOld=3 confirmed=1 noContent=0 gate=open deferred={"display-schedule-off":1}',
    ]);
    for (let i = 0; i < 15; i++) await tick(); // BOOT+16 … BOOT+30 min
    expect(summaries(logs)).toHaveLength(2);
    expect(summaries(logs)[1]).toContain('scans=15 leader=15');
    expect(PIPELINE_SUMMARY_INTERVAL_MS).toBe(15 * MIN);
  });

  it('counts only — no screen name, id or address ever reaches the line', async () => {
    const { logs, tick } = build();
    for (let i = 0; i < 16; i++) await tick();
    expect(summaries(logs)[0]).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('a failing scan and a failing alert worker are counted — and the summary still comes', async () => {
    const failingScan = build({ scanThrows: true });
    for (let i = 0; i < 16; i++) await failingScan.tick();
    expect(summaries(failingScan.logs)[0]).toContain('scanFailed=16');
    expect(summaries(failingScan.logs)[0]).toContain('last scan: offline=n/a (alert worker did not run)');

    const failingAlerts = build({ alertThrows: true });
    for (let i = 0; i < 16; i++) await failingAlerts.tick();
    expect(summaries(failingAlerts.logs)[0]).toContain('scanFailed=0 alertFailed=16');
  });

  it('a follower counts its ticks as followed, not led', async () => {
    const { logs, tick } = build({ leader: false });
    for (let i = 0; i < 16; i++) await tick();
    expect(summaries(logs)[0]).toContain('scans=16 leader=0 follower=16');
  });
});
