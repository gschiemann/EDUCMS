/**
 * EMG-03 (2026-11-21) — `/api/v1/health/emergency-path` reports a lost push
 * channel as DEGRADED with a plain reason, and keeps its HTTP contract
 * (docs/DEPLOY.md): 503 only for a database or signer failure.
 *
 * Before the fix it read only `publisher.status`: a dead subscriber (no screen
 * receiving pushes) answered `redis: "ok"`, and a publisher that had given up
 * answered `redis: "fallback"` with `status: "ok"`.
 */
import { HttpException } from '@nestjs/common';
import { HealthController } from './health.controller';

function build(opts: {
  publisher: { status: string; ping: jest.Mock } | null;
  push?: { configured: boolean; live: boolean; reason: string | null };
  dbOk?: boolean;
}) {
  const prisma = {
    client: {
      $queryRaw:
        opts.dbOk === false
          ? jest.fn().mockRejectedValue(new Error('down'))
          : jest.fn().mockResolvedValue([1]),
    },
  };
  const redis = {
    publisher: opts.publisher,
    pushChannelState: jest.fn(() => ({
      publisher: opts.publisher?.status ?? 'none',
      subscriber: 'ready',
      subscribed: !!opts.push?.live,
      downSince: null,
      ...(opts.push ?? { configured: false, live: false, reason: null }),
    })),
  };
  const signer = { signMessage: jest.fn(() => ({ signature: 'sig' })) };
  return new HealthController(
    prisma as never,
    redis as never,
    signer as never,
    {} as never,
    {} as never,
  );
}

const ready = () => ({
  status: 'ready',
  ping: jest.fn().mockResolvedValue('PONG'),
});
const REASON =
  'Instant push to screens is down: the API lost its Redis connection for receiving pushes, 12 s ago. ' +
  'The API reconnects by itself; meanwhile it delivers alerts to the screens connected to it, and every screen still polls for alerts.';

describe('GET /api/v1/health/emergency-path — push channel (EMG-03)', () => {
  it('push live → ok, checks.push ok, no reason', async () => {
    const out = await build({
      publisher: ready(),
      push: { configured: true, live: true, reason: null },
    }).emergencyPath();
    expect(out.status).toBe('ok');
    expect(out.checks.push).toBe('ok');
    expect(out.checks.redis).toBe('ok');
    expect(out.push_reason).toBeUndefined();
  });

  it('PING answers but the subscriber is gone → degraded with the plain reason, still 200', async () => {
    const out = await build({
      publisher: ready(),
      push: { configured: true, live: false, reason: REASON },
    }).emergencyPath();
    expect(out.status).toBe('degraded');
    expect(out.checks.push).toBe('degraded');
    expect(out.checks.redis).toBe('ok');
    expect(out.push_reason).toBe(REASON);
  });

  it('publisher reconnecting → degraded (not a quiet "fallback" with status ok), still 200', async () => {
    const out = await build({
      publisher: { status: 'reconnecting', ping: jest.fn() },
      push: { configured: true, live: false, reason: REASON },
    }).emergencyPath();
    expect(out.status).toBe('degraded');
    expect(out.checks.push).toBe('degraded');
    expect(out.checks.redis).toBe('fallback');
  });

  it('Redis not configured → push "off", status unchanged (the designed polling mode)', async () => {
    const out = await build({ publisher: null }).emergencyPath();
    expect(out.status).toBe('ok');
    expect(out.checks.push).toBe('off');
    expect(out.push_reason).toBeUndefined();
  });

  it('the 503 contract is unchanged: a database failure still throws 503 (with the push reason in the body)', async () => {
    const err = await build({
      publisher: ready(),
      push: { configured: true, live: false, reason: REASON },
      dbOk: false,
    })
      .emergencyPath()
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    const http = err as HttpException;
    expect(http.getStatus()).toBe(503);
    expect(http.getResponse()).toMatchObject({
      status: 'degraded',
      push_reason: REASON,
    });
  });

  it('a RedisService without pushChannelState (older test doubles) changes nothing', async () => {
    const prisma = { client: { $queryRaw: jest.fn().mockResolvedValue([1]) } };
    const signer = { signMessage: jest.fn(() => ({ signature: 'sig' })) };
    const ctl = new HealthController(
      prisma as never,
      { publisher: ready() } as never,
      signer as never,
      {} as never,
      {} as never,
    );
    const out = await ctl.emergencyPath();
    expect(out.status).toBe('ok');
    expect(out.checks.push).toBeUndefined();
  });
});
