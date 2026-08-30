/**
 * WS failure accounting (2026-08-30 player reliability program).
 * Encodes the audit's P0-1 acceptance criterion: "repeated WS AUTH_FAIL
 * reaches credential recovery and the documented fallback path; TCP open
 * alone is never considered a successful realtime connection."
 */
import { createWsAuthPolicy } from '../wsAuthPolicy';

describe('createWsAuthPolicy', () => {
  it('THE 1.1.6 BUG: open→AUTH_FAIL→close ×3 reaches the fallback threshold', () => {
    const p = createWsAuthPolicy();
    for (let i = 0; i < 3; i++) {
      p.onTcpOpen();               // old code reset the counter here
      p.onAuthFail();
      p.onConnectionFailure();     // server close(4001) after AUTH_FAIL
    }
    expect(p.failCount()).toBe(3); // AUTH_FAIL + close = ONE failure per connect
    expect(p.shouldEscalateFallback()).toBe(true);
    expect(p.lastFailureWasAuth()).toBe(true);
  });

  it('AUTH_OK is the only reset', () => {
    const p = createWsAuthPolicy();
    p.onTcpOpen();
    p.onConnectionFailure();
    p.onTcpOpen();
    p.onConnectionFailure();
    expect(p.failCount()).toBe(2);
    p.onTcpOpen();
    p.onAuthOk();
    expect(p.failCount()).toBe(0);
    expect(p.shouldEscalateFallback()).toBe(false);
  });

  it('a drop AFTER a healthy AUTH_OK starts a new streak at 1 (not part of the old one)', () => {
    const p = createWsAuthPolicy();
    p.onTcpOpen(); p.onAuthFail(); p.onConnectionFailure();
    p.onTcpOpen(); p.onAuthOk();
    p.onConnectionFailure();
    expect(p.failCount()).toBe(1);
    expect(p.lastFailureWasAuth()).toBe(false);
  });

  it('transport-only failures (no TCP open at all) count too', () => {
    const p = createWsAuthPolicy();
    p.onConnectionFailure();
    p.onConnectionFailure();
    p.onConnectionFailure();
    expect(p.shouldEscalateFallback()).toBe(true);
    expect(p.lastFailureWasAuth()).toBe(false);
  });
});
