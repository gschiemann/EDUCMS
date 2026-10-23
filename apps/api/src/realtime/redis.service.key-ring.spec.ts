/**
 * The Redis fan-out gate during a DEVICE_SECRET_KEY rotation window
 * (2026-10-22, security/key-ring.ts).
 *
 * The emergency path: a replica still running the OLD key (rolling deploy,
 * or the operator's `_PREVIOUS` step) signs a lockdown; every replica —
 * including the ones already on the NEW key — must still fan it out. And a
 * forged envelope must still be dropped, window or not.
 *
 * `RedisService` reads the ring at CONSTRUCTION, so each case builds its own
 * service after setting the env — this is why it is not folded into
 * `redis.service.spec.ts`, whose `beforeAll` fixes a single secret.
 */
import { RedisService } from './redis.service';
import { wsCanonicalString, wsHmacHex } from '../security/ws-signature';

const NEW_KEY = 'redis_gate_new_key_0123456789abcdef0123456789abcdef';
const OLD_KEY = 'redis_gate_old_key_0123456789abcdef0123456789abcdef';
const UNRELATED = 'redis_gate_unrelated_0123456789abcdef0123456789abc';

const VARS = ['DEVICE_SECRET_KEY', 'DEVICE_SECRET_KEY_PREVIOUS', 'REDIS_URL', 'NODE_ENV'] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of VARS) saved[k] = process.env[k];
  delete process.env.REDIS_URL; // constructor must not try to dial Redis
  process.env.NODE_ENV = 'test';
});
afterAll(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function signedBy(key: string, channel: string, type = 'OVERRIDE', payload: unknown = { severity: 'LOCKDOWN' }) {
  const eventId = 'evt-' + Math.random().toString(36).slice(2);
  const timestamp = Date.now();
  return {
    eventId,
    timestamp,
    type,
    payload,
    signature: wsHmacHex(wsCanonicalString({ eventId, timestamp, type, payload, channel }), key),
  };
}

function makeService(primary: string, previous?: string) {
  process.env.DEVICE_SECRET_KEY = primary;
  if (previous === undefined) delete process.env.DEVICE_SECRET_KEY_PREVIOUS;
  else process.env.DEVICE_SECRET_KEY_PREVIOUS = previous;
  const svc = new RedisService();
  const gateway = { broadcastToScope: jest.fn() };
  const sse = { broadcastToScope: jest.fn() };
  svc.setGateway(gateway);
  svc.setSseService(sse);
  const publish = jest.fn().mockResolvedValue(1);
  (svc as any).publisher = { publish };
  (svc as any).connected = true;
  return { svc, gateway, sse, publish };
}

const CH = 'tenant:district-a';

describe('RedisService fan-out gate — DEVICE_SECRET_KEY ring', () => {
  it('(a) previous unset: an envelope signed with another key is DROPPED (unchanged behaviour)', () => {
    const { svc, gateway, sse } = makeService(NEW_KEY);
    (svc as any).handleRedisMessage(CH, JSON.stringify(signedBy(NEW_KEY, CH)));
    expect(gateway.broadcastToScope).toHaveBeenCalledTimes(1);
    (svc as any).handleRedisMessage(CH, JSON.stringify(signedBy(OLD_KEY, CH)));
    expect(gateway.broadcastToScope).toHaveBeenCalledTimes(1);
    expect(sse.broadcastToScope).toHaveBeenCalledTimes(1);
  });

  it('(b) during the window: a lockdown signed by a replica on the OLD key is fanned out', () => {
    const { svc, gateway, sse } = makeService(NEW_KEY, OLD_KEY);
    (svc as any).handleRedisMessage(CH, JSON.stringify(signedBy(OLD_KEY, CH)));
    (svc as any).handleRedisMessage(CH, JSON.stringify(signedBy(NEW_KEY, CH)));
    expect(gateway.broadcastToScope).toHaveBeenCalledTimes(2);
    expect(sse.broadcastToScope).toHaveBeenCalledTimes(2);
    expect(gateway.broadcastToScope.mock.calls[0][0]).toBe('tenant');
    expect(gateway.broadcastToScope.mock.calls[0][1]).toBe('district-a');
  });

  it('(d) during the window: a forged envelope (unrelated key) is still dropped, and so is a cross-channel replay', () => {
    const { svc, gateway } = makeService(NEW_KEY, OLD_KEY);
    (svc as any).handleRedisMessage(CH, JSON.stringify(signedBy(UNRELATED, CH)));
    // An old-key envelope bound to tenant A, replayed onto tenant B.
    (svc as any).handleRedisMessage('tenant:district-b', JSON.stringify(signedBy(OLD_KEY, CH)));
    expect(gateway.broadcastToScope).not.toHaveBeenCalled();
  });

  it('(c) publish() re-signs with the PRIMARY: what leaves this process verifies on a replica that has closed the window', async () => {
    const { svc, publish } = makeService(NEW_KEY, OLD_KEY);
    // An envelope signed (unbound) under the previous key — e.g. by a signer
    // instance built before the env flipped.
    const eventId = 'evt-prev';
    const timestamp = Date.now();
    const payload = { severity: 'LOCKDOWN' };
    const underOld = {
      eventId,
      timestamp,
      type: 'OVERRIDE',
      payload,
      signature: wsHmacHex(wsCanonicalString({ eventId, timestamp, type: 'OVERRIDE', payload }), OLD_KEY),
    };
    await svc.publish(CH, underOld);
    const wire = JSON.parse(publish.mock.calls[0][1]);

    const closed = makeService(NEW_KEY); // a replica with NO previous configured
    (closed.svc as any).handleRedisMessage(CH, JSON.stringify(wire));
    expect(closed.gateway.broadcastToScope).toHaveBeenCalledTimes(1);

    // …and a replica that only ever knew the OLD key does NOT accept it: the
    // bytes on the wire carry the new key, proving the re-sign used the primary.
    const oldOnly = makeService(OLD_KEY);
    (oldOnly.svc as any).handleRedisMessage(CH, JSON.stringify(wire));
    expect(oldOnly.gateway.broadcastToScope).not.toHaveBeenCalled();
  });
});
