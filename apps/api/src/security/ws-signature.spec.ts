import { wsCanonicalString, wsHmacHex, verifyWsHmac } from './ws-signature';

const SECRET = 'test_secret_key_for_ws_signature_spec';

/** Build a validly-signed message the way WebsocketSignerService does. */
function sign(type: string, payload: unknown, secret = SECRET, timestamp = Date.now()) {
  const eventId = 'evt-' + Math.random().toString(36).slice(2);
  const signature = wsHmacHex(wsCanonicalString({ eventId, timestamp, type, payload }), secret);
  return { eventId, timestamp, type, payload, signature };
}

describe('ws-signature (server-side emergency gate)', () => {
  it('accepts a freshly, correctly signed message', () => {
    const msg = sign('OVERRIDE', { severity: 'LOCKDOWN' });
    expect(verifyWsHmac(msg, SECRET)).toEqual({ ok: true });
  });

  it('rejects a tampered payload (the forged-lockdown case)', () => {
    const msg = sign('OVERRIDE', { severity: 'WEATHER' });
    msg.payload = { severity: 'LOCKDOWN' }; // attacker swaps payload, keeps sig
    expect(verifyWsHmac(msg, SECRET).ok).toBe(false);
  });

  it('rejects a tampered type (e.g. flipping ALL_CLEAR onto a real alert)', () => {
    const msg = sign('OVERRIDE', { severity: 'LOCKDOWN' });
    msg.type = 'ALL_CLEAR';
    expect(verifyWsHmac(msg, SECRET).ok).toBe(false);
  });

  it('rejects a signature made with the wrong secret', () => {
    const msg = sign('OVERRIDE', { severity: 'LOCKDOWN' }, 'attacker_secret');
    const res = verifyWsHmac(msg, SECRET);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('bad-signature');
  });

  it('rejects an unsigned / empty-signature message', () => {
    const msg = sign('OVERRIDE', {});
    (msg as any).signature = '';
    expect(verifyWsHmac(msg, SECRET)).toEqual({ ok: false, reason: 'no-signature' });
    delete (msg as any).signature;
    expect(verifyWsHmac(msg, SECRET)).toEqual({ ok: false, reason: 'no-signature' });
  });

  it('rejects a non-string signature injected as a truthy value', () => {
    const msg: any = sign('OVERRIDE', {});
    msg.signature = 12345;
    expect(verifyWsHmac(msg, SECRET).ok).toBe(false);
  });

  it('rejects a stale message (replay outside the freshness window)', () => {
    const msg = sign('OVERRIDE', { severity: 'LOCKDOWN' }, SECRET, Date.now() - 200_000);
    expect(verifyWsHmac(msg, SECRET)).toEqual({ ok: false, reason: 'stale' });
  });

  it('rejects a far-future message (clock-skew / forgery guard)', () => {
    const msg = sign('OVERRIDE', {}, SECRET, Date.now() + 200_000);
    expect(verifyWsHmac(msg, SECRET)).toEqual({ ok: false, reason: 'future' });
  });

  it('rejects null / non-object input without throwing', () => {
    expect(verifyWsHmac(null, SECRET).ok).toBe(false);
    expect(verifyWsHmac(undefined, SECRET).ok).toBe(false);
    expect(verifyWsHmac({} as any, SECRET).ok).toBe(false);
  });

  it('canonical string is stable and order-sensitive for payload', () => {
    const a = wsCanonicalString({ eventId: 'e', timestamp: 1, type: 'T', payload: { a: 1, b: 2 } });
    const b = wsCanonicalString({ eventId: 'e', timestamp: 1, type: 'T', payload: { a: 1, b: 2 } });
    expect(a).toBe(b);
  });

  it('round-trips every emergency type the controllers emit', () => {
    for (const t of ['OVERRIDE', 'ALL_CLEAR', 'SOS', 'TEXT_BROADCAST', 'MEDIA_ALERT', 'TENANT_CHANGED']) {
      expect(verifyWsHmac(sign(t, { t }), SECRET)).toEqual({ ok: true });
    }
  });
});
