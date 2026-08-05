import { PlatformHealthMonitorService } from './platform-health-monitor.service';

/**
 * PlatformHealthMonitor — state-machine + classification locks.
 *
 * The DB re-probe pause is 10s of real time; these tests stub the private
 * dbOnce() (classification tests) or probe() (state-machine tests) so the
 * suite stays instant. The state machine mirrors StorageWatchdogService:
 * alert on transition into unhealthy, re-alert at most every 6h, alert
 * immediately on worsening, all-clear on recovery.
 */

type ProbeStatus = 'ok' | 'degraded' | 'critical';

function makeMonitor(opts?: {
  dbOk?: boolean;
  redisConfigured?: boolean;
  redisPublisher?: any;
  signerThrows?: boolean;
}) {
  const prisma = {
    client: {
      $queryRaw: opts?.dbOk === false ? jest.fn().mockRejectedValue(new Error('down')) : jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    },
  } as any;
  const redis = { publisher: opts?.redisPublisher ?? null } as any;
  const wsSigner = {
    signMessage: opts?.signerThrows
      ? jest.fn(() => {
          throw new Error('no secret');
        })
      : jest.fn(() => ({ signature: 'sig' })),
  } as any;
  const sendAlert = jest.fn(async (_s: string, _b: string, _k: string) => undefined);
  const mailer = { sendAlert } as any;

  if (opts?.redisConfigured) process.env.REDIS_URL = 'redis://localhost:6379';
  else delete process.env.REDIS_URL;

  const svc = new PlatformHealthMonitorService(prisma, redis, wsSigner, mailer);
  return { svc, sendAlert, prisma, wsSigner };
}

afterEach(() => {
  delete process.env.REDIS_URL;
  jest.restoreAllMocks();
});

describe('probe() classification', () => {
  it('all green → ok (unconfigured Redis is the designed polling fallback, not a failure)', async () => {
    const { svc } = makeMonitor({ dbOk: true, redisConfigured: false });
    const res = await svc.probe();
    expect(res).toEqual({ status: 'ok', db: 'ok', redis: 'off', wsSigner: 'ok' });
  });

  it('Redis configured + ready + PONG → ok', async () => {
    const publisher = { status: 'ready', ping: jest.fn().mockResolvedValue('PONG') };
    const { svc } = makeMonitor({ dbOk: true, redisConfigured: true, redisPublisher: publisher });
    const res = await svc.probe();
    expect(res.redis).toBe('ok');
    expect(res.status).toBe('ok');
  });

  it('Redis configured but not connected → degraded (realtime on polling fallback)', async () => {
    const { svc } = makeMonitor({ dbOk: true, redisConfigured: true, redisPublisher: null });
    const res = await svc.probe();
    expect(res.redis).toBe('fail');
    expect(res.status).toBe('degraded');
  });

  it('DB down (after in-tick re-probe) → critical', async () => {
    const { svc } = makeMonitor({ dbOk: false });
    // Stub the 10s retry pause so the test is instant; both probes still run.
    jest.spyOn(svc as any, 'pause').mockResolvedValue(undefined);
    const dbOnce = jest.spyOn(svc as any, 'dbOnce');
    const res = await svc.probe();
    expect(dbOnce).toHaveBeenCalledTimes(2); // re-probe before it counts
    expect(res.db).toBe('fail');
    expect(res.status).toBe('critical');
  });

  it('one transient DB blip → second probe passes → ok (no page for a pooler hiccup)', async () => {
    const { svc, prisma } = makeMonitor({ dbOk: true });
    jest.spyOn(svc as any, 'pause').mockResolvedValue(undefined);
    prisma.client.$queryRaw
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await svc.probe();
    expect(res.db).toBe('ok');
    expect(res.status).toBe('ok');
  });

  it('WS signer broken → critical (emergency chain)', async () => {
    const { svc } = makeMonitor({ dbOk: true, signerThrows: true });
    const res = await svc.probe();
    expect(res.wsSigner).toBe('fail');
    expect(res.status).toBe('critical');
  });
});

describe('tick() state machine', () => {
  function stubProbe(svc: PlatformHealthMonitorService, statuses: ProbeStatus[]) {
    const seq = [...statuses];
    jest.spyOn(svc, 'probe').mockImplementation(async () => {
      const status = seq.length > 1 ? seq.shift()! : seq[0];
      return {
        status,
        db: status === 'critical' ? 'fail' : 'ok',
        redis: status === 'degraded' ? 'fail' : 'ok',
        wsSigner: 'ok',
      } as any;
    });
  }

  it('ok → critical: one alert; staying critical inside 6h: no re-alert', async () => {
    const { svc, sendAlert } = makeMonitor();
    stubProbe(svc, ['critical']);

    await svc.tick();
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert.mock.calls[0][2]).toBe('PLATFORM_HEALTH_ALERT');
    expect(sendAlert.mock.calls[0][0]).toContain('CRITICAL');

    await svc.tick(); // still critical, minutes later
    expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  it('still unhealthy past the 6h window → re-alerts', async () => {
    const { svc, sendAlert } = makeMonitor();
    stubProbe(svc, ['critical']);

    await svc.tick();
    (svc as any).lastAlertAt = Date.now() - 7 * 3600_000;
    await svc.tick();
    expect(sendAlert).toHaveBeenCalledTimes(2);
  });

  it('degraded → critical worsening alerts immediately (no 6h wait)', async () => {
    const { svc, sendAlert } = makeMonitor();
    stubProbe(svc, ['degraded', 'critical']);

    await svc.tick(); // degraded → alert 1
    await svc.tick(); // critical → alert 2, despite recent lastAlertAt
    expect(sendAlert).toHaveBeenCalledTimes(2);
    expect(sendAlert.mock.calls[1][0]).toContain('CRITICAL');
  });

  it('critical → ok sends the all-clear', async () => {
    const { svc, sendAlert } = makeMonitor();
    stubProbe(svc, ['critical', 'ok']);

    await svc.tick();
    await svc.tick();
    expect(sendAlert).toHaveBeenCalledTimes(2);
    expect(sendAlert.mock.calls[1][2]).toBe('PLATFORM_HEALTH_RECOVERED');
  });

  it('healthy steady-state sends nothing', async () => {
    const { svc, sendAlert } = makeMonitor();
    stubProbe(svc, ['ok']);

    await svc.tick();
    await svc.tick();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('degraded body names the polling fallback, not a customer outage', async () => {
    const { svc, sendAlert } = makeMonitor();
    stubProbe(svc, ['degraded']);

    await svc.tick();
    expect(sendAlert.mock.calls[0][0]).toContain('DEGRADED');
    expect(sendAlert.mock.calls[0][1]).toContain('polling fallback');
  });
});
