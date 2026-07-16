import { EfficiencyMetricsService } from './efficiency-metrics.service';
import { EfficiencyAlertingService } from './efficiency-alerting.service';

/**
 * Efficiency alerting — regression locks for the 2026-07-16 incident:
 * an "Egress anomaly: 4.68x baseline — This hour: 0 GB" email landed in the
 * operator's WORK inbox.
 *
 * Two defects, two locks:
 *  1. shouldAlertAnomaly() had NO magnitude floor — on an idle/test fleet the
 *     non-zero-hours baseline is a few hundred KB, so any dashboard session is
 *     "4-5x baseline" while moving less than a megabyte (printed as "0 GB").
 *     Now the current hour must move ≥ EGRESS_ANOMALY_MIN_GB (default 1 GB)
 *     before the ratio may alert.
 *  2. Alerts were mailed to EVERY SUPER_ADMIN row — including throwaway test
 *     users. PLATFORM_ALERT_EMAILS now routes platform-ops mail exclusively;
 *     the SUPER_ADMIN sweep survives only as the unset-env fallback.
 */

function makeMetrics(): EfficiencyMetricsService {
  // RedisService is only used for best-effort cross-replica counters; a null
  // publisher takes every early-return path.
  return new EfficiencyMetricsService({ publisher: null } as any);
}

/** Seed the private hourly ring: 3 baseline hours + a current hour. */
function seedRing(svc: EfficiencyMetricsService, baselineBytes: number, currentBytes: number) {
  const anySvc = svc as any;
  anySvc.hourlyEgressBytes.fill(0);
  anySvc.hourlyEgressBytes[0] = baselineBytes;
  anySvc.hourlyEgressBytes[1] = baselineBytes;
  anySvc.hourlyEgressBytes[2] = baselineBytes;
  anySvc.currentHourIndex = 3;
  anySvc.hourlyEgressBytes[3] = currentBytes;
  anySvc.lastAnomalyHour = -1;
}

describe('EfficiencyMetricsService.shouldAlertAnomaly — magnitude floor', () => {
  afterEach(() => {
    delete process.env.EGRESS_ANOMALY_MIN_GB;
  });

  it('does NOT fire on an idle fleet: huge ratio, trivial bytes (the "0 GB" email)', () => {
    const svc = makeMetrics();
    // Baseline 100 KB/hr; current hour 468 KB → ratio 4.68x, volume ~nothing.
    seedRing(svc, 100_000, 468_000);
    expect(svc.shouldAlertAnomaly()).toBeNull();
  });

  it('fires on a real cache-miss storm: ratio > 3 AND volume over the floor', () => {
    const svc = makeMetrics();
    // Baseline 1 GB/hr; current hour 5 GB (the 2026-05-23 incident shape).
    seedRing(svc, 1e9, 5e9);
    const res = svc.shouldAlertAnomaly();
    expect(res).not.toBeNull();
    expect(res!.ratio).toBe(5);
    expect(res!.currentHourGb).toBe(5);
  });

  it('still respects the ratio gate above the floor (high volume, normal ratio → no alert)', () => {
    const svc = makeMetrics();
    // 2 GB vs a 1 GB baseline = 2x — above the floor but under the 3x ratio.
    seedRing(svc, 1e9, 2e9);
    expect(svc.shouldAlertAnomaly()).toBeNull();
  });

  it('EGRESS_ANOMALY_MIN_GB=0 restores ratio-only behavior (explicit opt-in)', () => {
    process.env.EGRESS_ANOMALY_MIN_GB = '0';
    const svc = makeMetrics();
    seedRing(svc, 100_000, 468_000);
    const res = svc.shouldAlertAnomaly();
    expect(res).not.toBeNull();
    expect(res!.ratio).toBeCloseTo(4.68, 2);
  });
});

describe('EfficiencyAlertingService — platform alert recipients', () => {
  const findMany = jest.fn();
  const emailLogCreate = jest.fn(async (args: any) => ({ id: 'log-1', ...args.data }));
  const emailLogUpdate = jest.fn(async () => ({}));

  function makeAlerting(): EfficiencyAlertingService {
    const prisma = {
      client: {
        user: { findMany },
        emailLog: { create: emailLogCreate, update: emailLogUpdate },
      },
    } as any;
    return new EfficiencyAlertingService(makeMetrics() as any, prisma);
  }

  beforeEach(() => {
    findMany.mockReset();
    emailLogCreate.mockClear();
    delete process.env.PLATFORM_ALERT_EMAILS;
    delete process.env.RESEND_API_KEY; // no real sends in tests — logs only
  });

  it('PLATFORM_ALERT_EMAILS routes alerts ONLY to the configured owner inbox(es)', async () => {
    process.env.PLATFORM_ALERT_EMAILS = 'owner@personal.test, ops@personal.test';
    const svc = makeAlerting();

    const recipients = await (svc as any).resolveAlertRecipients();
    expect(recipients).toEqual(['owner@personal.test', 'ops@personal.test']);
    // The SUPER_ADMIN sweep must not even be queried — a test user holding
    // SUPER_ADMIN (the 2026-07-16 work-inbox leak) can never receive one.
    expect(findMany).not.toHaveBeenCalled();
  });

  it('falls back to the SUPER_ADMIN sweep when the env is unset (no silent alert loss)', async () => {
    findMany.mockResolvedValue([{ email: 'admin-a@x.test' }, { email: 'work-test-user@corp.test' }]);
    const svc = makeAlerting();

    const recipients = await (svc as any).resolveAlertRecipients();
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(recipients).toEqual(['admin-a@x.test', 'work-test-user@corp.test']);
  });

  it('sendAlertEmail logs one email per configured recipient (and never queries users)', async () => {
    process.env.PLATFORM_ALERT_EMAILS = 'owner@personal.test';
    const svc = makeAlerting();

    await (svc as any).sendAlertEmail('[VenueOS] test subject', 'body', 'EFFICIENCY_ANOMALY_ALERT');

    expect(findMany).not.toHaveBeenCalled();
    expect(emailLogCreate).toHaveBeenCalledTimes(1);
    expect(emailLogCreate.mock.calls[0][0].data.toEmail).toBe('owner@personal.test');
  });

  it('junk env values (no @) are ignored → fallback still works', async () => {
    process.env.PLATFORM_ALERT_EMAILS = 'not-an-email, ,';
    findMany.mockResolvedValue([{ email: 'admin-a@x.test' }]);
    const svc = makeAlerting();

    const recipients = await (svc as any).resolveAlertRecipients();
    expect(recipients).toEqual(['admin-a@x.test']);
  });
});
