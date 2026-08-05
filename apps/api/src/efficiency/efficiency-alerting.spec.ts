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

describe('EfficiencyAlertingService — delegates alert mail to PlatformAlertMailer', () => {
  // Recipient routing (PLATFORM_ALERT_EMAILS vs SUPER_ADMIN sweep) is the
  // mailer's contract now — locked in platform-alert-mailer.spec.ts. Here we
  // only verify the alerting service hands the mailer the right alert and
  // still raises the in-app banner.

  it('threshold crossing → one mailer.sendAlert with the egress kind + banner set', async () => {
    const metrics = makeMetrics();
    // Force a threshold alert regardless of ring internals.
    jest.spyOn(metrics, 'shouldAlert').mockReturnValue({
      threshold: 90,
      label: 'CRITICAL',
      egressGb: 225,
    } as any);
    jest.spyOn(metrics, 'shouldAlertAnomaly').mockReturnValue(null);

    const sendAlert = jest.fn(async (_subject: string, _body: string, _kind: string) => undefined);
    const svc = new EfficiencyAlertingService(metrics as any, { sendAlert } as any);

    await svc.runChecks();

    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert.mock.calls[0][2]).toBe('EFFICIENCY_EGRESS_ALERT');
    expect(svc.bannerActive).toBe(true);
    expect(svc.bannerMessage).toContain('225');
  });

  it('quiet metrics → no mail, no banner', async () => {
    const metrics = makeMetrics();
    jest.spyOn(metrics, 'shouldAlert').mockReturnValue(null);
    jest.spyOn(metrics, 'shouldAlertAnomaly').mockReturnValue(null);

    const sendAlert = jest.fn(async (_subject: string, _body: string, _kind: string) => undefined);
    const svc = new EfficiencyAlertingService(metrics as any, { sendAlert } as any);

    await svc.runChecks();

    expect(sendAlert).not.toHaveBeenCalled();
    expect(svc.bannerActive).toBe(false);
  });
});
