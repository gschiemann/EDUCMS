/**
 * Credential lifecycle decisions (2026-08-30 player reliability program).
 * These encode the audit's P0-1 acceptance criteria at the pure-logic layer.
 */
import {
  decodeDeviceToken,
  renewalDecision,
  mayAttemptRecovery,
  PROVEN_RENEW_UNDER_MS,
  RECOVERY_ATTEMPT_COOLDOWN_MS,
} from '../deviceCredential';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Build an unsigned JWT-shaped token with the given payload. */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64url = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;
}

describe('decodeDeviceToken', () => {
  it('reads exp/iat/unproven/ep/sub from a device JWT', () => {
    const now = 1_800_000_000; // seconds
    const tok = fakeJwt({ sub: 'scr-1', kind: 'device', exp: now + 3600, iat: now, unproven: true, ep: 4 });
    const d = decodeDeviceToken(tok)!;
    expect(d.expMs).toBe((now + 3600) * 1000);
    expect(d.iatMs).toBe(now * 1000);
    expect(d.unproven).toBe(true);
    expect(d.epoch).toBe(4);
    expect(d.screenId).toBe('scr-1');
  });

  it('returns null for legacy dev_ tokens and junk', () => {
    expect(decodeDeviceToken('dev_screen1_tenant1')).toBeNull();
    expect(decodeDeviceToken('')).toBeNull();
    expect(decodeDeviceToken(null)).toBeNull();
    expect(decodeDeviceToken('a.b')).toBeNull();
    expect(decodeDeviceToken('x.%%%%.y')).toBeNull();
  });

  it('treats a missing unproven claim as proven (grandfathered fleet tokens)', () => {
    const d = decodeDeviceToken(fakeJwt({ sub: 's', exp: 2_000_000_000 }))!;
    expect(d.unproven).toBe(false);
  });
});

describe('renewalDecision', () => {
  const nowMs = 1_800_000_000_000;
  const sec = (ms: number) => Math.floor(ms / 1000);

  it('healthy 180d token far from expiry → no renewal', () => {
    const tok = fakeJwt({ exp: sec(nowMs + 170 * DAY_MS), iat: sec(nowMs - 10 * DAY_MS) });
    const d = renewalDecision(nowMs, tok);
    expect(d.renew).toBe(false);
    expect(d.reason).toBe('healthy');
  });

  it('180d token inside the 14-day window → renew (the proactive rotation)', () => {
    const tok = fakeJwt({ exp: sec(nowMs + 10 * DAY_MS), iat: sec(nowMs - 170 * DAY_MS) });
    const d = renewalDecision(nowMs, tok);
    expect(d.renew).toBe(true);
    expect(d.reason).toBe('inside-window');
  });

  it('1h unproven token renews inside its final quarter (keeps last-known-good alive)', () => {
    const HOUR = 3600_000;
    const fresh = fakeJwt({ exp: sec(nowMs + HOUR * 0.9), iat: sec(nowMs - HOUR * 0.1), unproven: true });
    expect(renewalDecision(nowMs, fresh).renew).toBe(false);
    const aging = fakeJwt({ exp: sec(nowMs + HOUR * 0.2), iat: sec(nowMs - HOUR * 0.8), unproven: true });
    expect(renewalDecision(nowMs, aging).renew).toBe(true);
  });

  it('expired token → renew ("expired"): one controlled re-register, not a silent death', () => {
    const tok = fakeJwt({ exp: sec(nowMs - 60_000), iat: sec(nowMs - DAY_MS) });
    const d = renewalDecision(nowMs, tok);
    expect(d.renew).toBe(true);
    expect(d.reason).toBe('expired');
  });

  it('no token / dev token / no exp → lifecycle not applicable', () => {
    expect(renewalDecision(nowMs, null).reason).toBe('no-token');
    expect(renewalDecision(nowMs, 'dev_s_t').reason).toBe('not-a-jwt');
    expect(renewalDecision(nowMs, fakeJwt({ sub: 's' })).reason).toBe('no-exp');
  });

  it('token without iat falls back to the 14-day threshold', () => {
    const inside = fakeJwt({ exp: sec(nowMs + PROVEN_RENEW_UNDER_MS / 2) });
    expect(renewalDecision(nowMs, inside).renew).toBe(true);
    const outside = fakeJwt({ exp: sec(nowMs + PROVEN_RENEW_UNDER_MS * 2) });
    expect(renewalDecision(nowMs, outside).renew).toBe(false);
  });
});

describe('mayAttemptRecovery (401-path cooldown)', () => {
  it('first attempt always allowed; repeats gated by the cooldown', () => {
    const t0 = 10_000_000;
    expect(mayAttemptRecovery(t0, 0)).toBe(true);
    expect(mayAttemptRecovery(t0 + 1_000, t0)).toBe(false);
    expect(mayAttemptRecovery(t0 + RECOVERY_ATTEMPT_COOLDOWN_MS, t0)).toBe(true);
  });
});
