import {
  wsCanonicalString,
  wsHmacHex,
  verifyWsHmac,
  bindWsSignatureToChannel,
  ACCEPT_LEGACY_UNBOUND_WS_SIG,
} from './ws-signature';

const SECRET = 'test_secret_key_for_ws_signature_spec';

/** Build a validly-signed message the way WebsocketSignerService does. */
function sign(type: string, payload: unknown, secret = SECRET, timestamp = Date.now()) {
  const eventId = 'evt-' + Math.random().toString(36).slice(2);
  const signature = wsHmacHex(wsCanonicalString({ eventId, timestamp, type, payload }), secret);
  return { eventId, timestamp, type, payload, signature };
}

/** The CURRENT form — signature covers the Redis delivery channel (R-02). */
function signForChannel(
  channel: string,
  type: string,
  payload: unknown,
  secret = SECRET,
  timestamp = Date.now(),
) {
  const eventId = 'evt-' + Math.random().toString(36).slice(2);
  const signature = wsHmacHex(
    wsCanonicalString({ eventId, timestamp, type, payload, channel }),
    secret,
  );
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

// ───────────────────────────────────────────────────────────────────
// R-02 — the HMAC must cover the DELIVERY CHANNEL.
//
// redis.service.ts takes the routing scope entirely from the (untrusted)
// channel name, so before this fix anyone with Redis PUBLISH could capture a
// signed lockdown from district A and replay it byte-for-byte onto
// `tenant:<B>` — exactly the "compromised Redis" threat the gate documents.
// ───────────────────────────────────────────────────────────────────
describe('ws-signature channel binding (R-02)', () => {
  const CH_A = 'tenant:district-a';
  const CH_B = 'tenant:district-b';

  it('verifies a channel-bound signature on its own channel', () => {
    const msg = signForChannel(CH_A, 'OVERRIDE', { severity: 'LOCKDOWN' });
    expect(verifyWsHmac(msg, SECRET, undefined, CH_A)).toEqual({ ok: true });
  });

  it('REJECTS a cross-channel replay of a channel-bound signature', () => {
    // The attack: capture district A's signed lockdown off the bus, publish
    // the exact same bytes on district B's channel.
    const captured = signForChannel(CH_A, 'OVERRIDE', { severity: 'LOCKDOWN' });
    expect(verifyWsHmac(captured, SECRET, undefined, CH_B)).toEqual({
      ok: false,
      reason: 'bad-signature',
    });
    // Same for a scope-type swap (tenant → device) and a group channel.
    expect(verifyWsHmac(captured, SECRET, undefined, 'device:scr_1').ok).toBe(false);
    expect(verifyWsHmac(captured, SECRET, undefined, 'group:hallway').ok).toBe(false);
  });

  it('the legacy-compat fallback does NOT re-open the replay (bound sig is bound)', () => {
    // ACCEPT_LEGACY_UNBOUND_WS_SIG is true during the rolling-deploy window.
    // It may only ever accept an UNBOUND signature — a bound one that lands
    // on the wrong channel fails the bound check AND the legacy check.
    expect(ACCEPT_LEGACY_UNBOUND_WS_SIG).toBe(true);
    const captured = signForChannel(CH_A, 'ALL_CLEAR', { overrideId: 'ovr_1' });
    expect(verifyWsHmac(captured, SECRET, undefined, CH_B).ok).toBe(false);
  });

  it('still accepts a LEGACY unbound signature while the compat flag is true', () => {
    // Rolling deploy: old replicas keep publishing unbound signatures while
    // new replicas verify. Dropping these would drop real emergencies
    // mid-rollout on a life-safety path.
    const legacy = sign('OVERRIDE', { severity: 'LOCKDOWN' });
    expect(verifyWsHmac(legacy, SECRET, undefined, CH_A)).toEqual({ ok: true });
    expect(verifyWsHmac(legacy, SECRET)).toEqual({ ok: true }); // no channel passed
  });

  it('DOCUMENTS THE FLAG FLIP: with legacy compat off, unbound sigs are rejected and bound ones still pass', () => {
    // The follow-up deploy flips ACCEPT_LEGACY_UNBOUND_WS_SIG to false. This
    // test reproduces that verifier by hand (the module constant is a
    // compile-time `true` today) so the post-flip contract is pinned:
    //   bound sig on its channel  → accept
    //   bound sig on any other    → reject
    //   legacy unbound sig        → reject (no longer tolerated)
    const verifyStrict = (msg: any, channel: string) => {
      const expected = wsHmacHex(
        wsCanonicalString({
          eventId: msg.eventId,
          timestamp: msg.timestamp,
          type: msg.type,
          payload: msg.payload,
          channel,
        }),
        SECRET,
      );
      return msg.signature === expected;
    };

    const bound = signForChannel(CH_A, 'OVERRIDE', { severity: 'LOCKDOWN' });
    const legacy = sign('OVERRIDE', { severity: 'LOCKDOWN' });

    expect(verifyStrict(bound, CH_A)).toBe(true);
    expect(verifyStrict(bound, CH_B)).toBe(false);
    expect(verifyStrict(legacy, CH_A)).toBe(false);

    // Pre-flip, that same legacy message IS accepted — this is the only
    // difference the flip makes, and why it must not happen mid-rollout.
    expect(verifyWsHmac(legacy, SECRET, undefined, CH_A).ok).toBe(true);
  });

  it('bindWsSignatureToChannel upgrades a legacy envelope and pins it to that channel', () => {
    const legacy = sign('OVERRIDE', { severity: 'LOCKDOWN' });
    const bound = bindWsSignatureToChannel(legacy, CH_A, SECRET);

    expect(bound).not.toBe(legacy); // no mutation of the caller's object
    expect(bound.signature).not.toBe(legacy.signature);
    expect(verifyWsHmac(bound, SECRET, undefined, CH_A)).toEqual({ ok: true });
    // …and the upgraded envelope is no longer replayable elsewhere.
    expect(verifyWsHmac(bound, SECRET, undefined, CH_B).ok).toBe(false);
  });

  it('bindWsSignatureToChannel is idempotent for an already-bound envelope', () => {
    const bound = signForChannel(CH_A, 'SOS', { messageId: 'm1' });
    expect(bindWsSignatureToChannel(bound, CH_A, SECRET).signature).toBe(bound.signature);
  });

  it('bindWsSignatureToChannel NEVER mints a signature for unsigned/forged data', () => {
    const unsigned = { eventId: 'e1', timestamp: Date.now(), type: 'OVERRIDE', payload: { severity: 'LOCKDOWN' } };
    expect(bindWsSignatureToChannel(unsigned, CH_A, SECRET)).toBe(unsigned);

    const forged = { ...unsigned, signature: 'deadbeef' };
    expect(bindWsSignatureToChannel(forged, CH_A, SECRET)).toBe(forged);

    // Non-envelope inputs (test doubles, telemetry) pass through untouched.
    expect(bindWsSignatureToChannel('signed' as any, CH_A, SECRET)).toBe('signed');
    expect(bindWsSignatureToChannel(null as any, CH_A, SECRET)).toBeNull();
  });
});
