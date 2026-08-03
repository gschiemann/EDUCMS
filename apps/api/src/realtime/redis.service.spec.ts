/**
 * The Redis fan-out gate — the server-side chokepoint every emergency
 * message passes through before it can reach a screen.
 *
 * R-02: the HMAC did not cover the delivery channel, and the routing scope
 * (`tenant` / `group` / `device` + id) is read straight off the UNTRUSTED
 * channel name. So anything holding Redis PUBLISH could capture district A's
 * signed lockdown and replay the identical bytes onto `tenant:<B>` — the
 * exact "compromised Redis" threat the gate documents. These tests pin the
 * binding, the rolling-deploy compat window, the strict channel parse, and
 * the R-07 log-flood fix.
 */
import { RedisService } from './redis.service';
import { wsCanonicalString, wsHmacHex } from '../security/ws-signature';

const DEVICE_SECRET = 'test_device_secret_key_at_least_16_chars';

/** LEGACY (pre-R-02) envelope: signature does not cover the channel. */
function signLegacy(type: string, payload: unknown) {
  const eventId = 'evt-' + Math.random().toString(36).slice(2);
  const timestamp = Date.now();
  return {
    eventId,
    timestamp,
    type,
    payload,
    signature: wsHmacHex(
      wsCanonicalString({ eventId, timestamp, type, payload }),
      DEVICE_SECRET,
    ),
  };
}

function makeService() {
  const svc = new RedisService();
  const gateway = { broadcastToScope: jest.fn() };
  const sse = { broadcastToScope: jest.fn() };
  svc.setGateway(gateway);
  svc.setSseService(sse);
  return { svc, gateway, sse };
}

/** Put the service in the "Redis is up" state with a capturing publisher. */
function withLivePublisher(svc: RedisService) {
  const publish = jest.fn().mockResolvedValue(1);
  (svc as any).publisher = { publish };
  (svc as any).connected = true;
  return publish;
}

const prevSecret = process.env.DEVICE_SECRET_KEY;
const prevRedisUrl = process.env.REDIS_URL;

beforeAll(() => {
  process.env.DEVICE_SECRET_KEY = DEVICE_SECRET;
  delete process.env.REDIS_URL; // constructor must not try to dial Redis
});
afterAll(() => {
  if (prevSecret === undefined) delete process.env.DEVICE_SECRET_KEY;
  else process.env.DEVICE_SECRET_KEY = prevSecret;
  if (prevRedisUrl !== undefined) process.env.REDIS_URL = prevRedisUrl;
});

describe('RedisService fan-out gate — channel binding (R-02)', () => {
  it('publish() binds the signature to the channel it sends on', async () => {
    const { svc } = makeService();
    const publish = withLivePublisher(svc);

    const envelope = signLegacy('OVERRIDE', { severity: 'LOCKDOWN' });
    await svc.publish('tenant:district-a', envelope);

    expect(publish).toHaveBeenCalledTimes(1);
    const [channel, body] = publish.mock.calls[0];
    expect(channel).toBe('tenant:district-a');
    const framed = JSON.parse(body);

    // Signature was rewritten to cover the channel…
    expect(framed.signature).not.toBe(envelope.signature);
    expect(framed.signature).toBe(
      wsHmacHex(
        wsCanonicalString({
          eventId: envelope.eventId,
          timestamp: envelope.timestamp,
          type: 'OVERRIDE',
          payload: { severity: 'LOCKDOWN' },
          channel: 'tenant:district-a',
        }),
        DEVICE_SECRET,
      ),
    );
    // …and the caller's object was NOT mutated.
    expect(envelope.signature).not.toBe(framed.signature);
  });

  it('delivers a channel-bound message on its own channel', () => {
    const { svc, gateway, sse } = makeService();
    const publish = withLivePublisher(svc);
    return svc.publish('tenant:district-a', signLegacy('OVERRIDE', { severity: 'LOCKDOWN' })).then(() => {
      const [, body] = publish.mock.calls[0];
      (svc as any).handleRedisMessage('tenant:district-a', body);
      expect(gateway.broadcastToScope).toHaveBeenCalledWith(
        'tenant',
        'district-a',
        expect.objectContaining({ type: 'OVERRIDE' }),
      );
      expect(sse.broadcastToScope).toHaveBeenCalled();
    });
  });

  it('DROPS a cross-tenant replay of a captured, validly-signed message', async () => {
    const { svc, gateway, sse } = makeService();
    const publish = withLivePublisher(svc);
    await svc.publish('tenant:district-a', signLegacy('OVERRIDE', { severity: 'LOCKDOWN' }));
    const capturedWireBytes = publish.mock.calls[0][1];

    // Attacker with Redis PUBLISH replays district A's exact bytes on B.
    (svc as any).handleRedisMessage('tenant:district-b', capturedWireBytes);
    expect(gateway.broadcastToScope).not.toHaveBeenCalled();
    expect(sse.broadcastToScope).not.toHaveBeenCalled();

    // Also blocked when re-scoped to a group or a single device.
    (svc as any).handleRedisMessage('group:hallway-1', capturedWireBytes);
    (svc as any).handleRedisMessage('device:scr_9', capturedWireBytes);
    expect(gateway.broadcastToScope).not.toHaveBeenCalled();
  });

  it('DROPS a LEGACY unbound signature now that the compat window is closed', () => {
    // Anything with PUBLISH on Redis could previously replay a captured
    // unbound envelope onto ANY tenant channel inside the freshness window,
    // because an unbound signature is not channel-scoped. That was the
    // residual R-02 hole; ACCEPT_LEGACY_UNBOUND_WS_SIG=false closes it.
    //
    // This only became safe because there is no live fleet — see the flag's
    // doc block. With screens in the field this must be a two-deploy flip.
    const { svc, gateway } = makeService();
    const legacy = signLegacy('ALL_CLEAR', { overrideId: 'ovr_1' });
    (svc as any).handleRedisMessage('tenant:district-a', JSON.stringify(legacy));
    expect(gateway.broadcastToScope).not.toHaveBeenCalled();
  });

  it('still drops an unsigned / forged message (gate unchanged)', () => {
    const { svc, gateway } = makeService();
    (svc as any).handleRedisMessage(
      'tenant:district-a',
      JSON.stringify({ eventId: 'e', timestamp: Date.now(), type: 'OVERRIDE', payload: {}, signature: 'nope' }),
    );
    (svc as any).handleRedisMessage(
      'tenant:district-a',
      JSON.stringify({ type: 'OVERRIDE', payload: { severity: 'LOCKDOWN' } }),
    );
    expect(gateway.broadcastToScope).not.toHaveBeenCalled();
  });
});

describe('RedisService fan-out gate — channel parsing', () => {
  it('rejects a 3-segment channel instead of routing it by its first two parts', async () => {
    const { svc, gateway } = makeService();
    const publish = withLivePublisher(svc);
    // Sign FOR the 3-segment channel, so only the parse guard can stop it.
    await svc.publish('tenant:district-a:devices', signLegacy('OVERRIDE', { severity: 'LOCKDOWN' }));
    (svc as any).handleRedisMessage('tenant:district-a:devices', publish.mock.calls[0][1]);
    expect(gateway.broadcastToScope).not.toHaveBeenCalled();
  });

  it('rejects a channel with no scope id', () => {
    const { svc, gateway } = makeService();
    (svc as any).handleRedisMessage('tenant', JSON.stringify(signLegacy('OVERRIDE', {})));
    expect(gateway.broadcastToScope).not.toHaveBeenCalled();
  });

  it('drops a non-scope channel at DEBUG, not WARN (R-07 ACK log flood)', () => {
    const { svc, gateway } = makeService();
    const logger = (svc as any).logger;
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const debug = jest.spyOn(logger, 'debug').mockImplementation(() => {});

    // Redis-down fallback loops the unsigned metrics channel back through
    // the gate. Before the fix this logged one WARN per ACK per kiosk.
    (svc as any).handleRedisMessage(
      'metrics:ack',
      JSON.stringify({ deviceId: 'scr_1', eventId: 'e1', status: 'ok', timestamp: Date.now() }),
    );

    expect(gateway.broadcastToScope).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalled();
    warn.mockRestore();
    debug.mockRestore();
  });
});
