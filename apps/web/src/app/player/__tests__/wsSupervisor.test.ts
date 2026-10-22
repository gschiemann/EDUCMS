/**
 * Realtime supervisor (player 1.1.51 — field finding 2026-10-22: the fleet's
 * `last_push_connected_at` froze for 6–18 h because every WS re-arm hung off
 * `ws.onclose`, and a socket stuck in CONNECTING / CLOSING / OPEN-unauthed
 * never fires it). The decision is pure; the wiring facts at the end pin
 * that `page.tsx` actually runs it outside the per-attempt timers.
 */
import * as fs from 'fs';
import * as path from 'path';

import {
  AUTH_MAX_MS,
  CLOSING_MAX_MS,
  CONNECTING_MAX_MS,
  SILENT_MAX_MS,
  TICK_MS,
  WS_CLOSED,
  WS_CLOSING,
  WS_CONNECTING,
  WS_OPEN,
  superviseWs,
} from '../wsSupervisor';

const facts = (over: Partial<Parameters<typeof superviseWs>[0]> = {}) => ({
  readyState: WS_OPEN,
  authOk: true,
  sinceStateChangeMs: 0,
  sinceLastMessageMs: 0,
  reconnectArmed: false,
  ...over,
});

describe('superviseWs', () => {
  it('a healthy authenticated socket is left alone', () => {
    expect(superviseWs(facts())).toEqual({ action: 'none' });
    expect(superviseWs(facts({ sinceStateChangeMs: 10 * 60_000, sinceLastMessageMs: SILENT_MAX_MS - 1 }))).toEqual({ action: 'none' });
  });

  it('THE FIELD HOLE: a socket stuck in CONNECTING (no onclose ever) is abandoned after the budget', () => {
    expect(superviseWs(facts({ readyState: WS_CONNECTING, authOk: false, sinceStateChangeMs: CONNECTING_MAX_MS - 1 }))).toEqual({ action: 'none' });
    expect(superviseWs(facts({ readyState: WS_CONNECTING, authOk: false, sinceStateChangeMs: CONNECTING_MAX_MS })))
      .toEqual({ action: 'abandon', reason: 'connecting-stuck' });
  });

  it('a socket stuck in CLOSING after our own close() is abandoned too', () => {
    expect(superviseWs(facts({ readyState: WS_CLOSING, sinceStateChangeMs: CLOSING_MAX_MS - 1 }))).toEqual({ action: 'none' });
    expect(superviseWs(facts({ readyState: WS_CLOSING, sinceStateChangeMs: CLOSING_MAX_MS }))).toEqual({ action: 'abandon', reason: 'closing-stuck' });
  });

  it('rule 5: OPEN without AUTH_OK is not connected — abandoned after the auth budget', () => {
    expect(superviseWs(facts({ authOk: false, sinceStateChangeMs: AUTH_MAX_MS - 1 }))).toEqual({ action: 'none' });
    expect(superviseWs(facts({ authOk: false, sinceStateChangeMs: AUTH_MAX_MS }))).toEqual({ action: 'abandon', reason: 'auth-stuck' });
  });

  it('an authenticated socket that has gone silent is abandoned even if the heartbeat interval was lost', () => {
    expect(superviseWs(facts({ sinceLastMessageMs: SILENT_MAX_MS }))).toEqual({ action: 'abandon', reason: 'silent' });
  });

  it('no socket and no reconnect armed → dial now; a reconnect already armed is respected', () => {
    expect(superviseWs(facts({ readyState: null, authOk: false, reconnectArmed: false }))).toEqual({ action: 'dial', reason: 'idle' });
    expect(superviseWs(facts({ readyState: WS_CLOSED, authOk: false, reconnectArmed: false }))).toEqual({ action: 'dial', reason: 'idle' });
    expect(superviseWs(facts({ readyState: null, authOk: false, reconnectArmed: true }))).toEqual({ action: 'none' });
    expect(superviseWs(facts({ readyState: WS_CLOSED, authOk: false, reconnectArmed: true }))).toEqual({ action: 'none' });
  });

  it('the budgets are bounded and the tick is faster than every budget', () => {
    expect(TICK_MS).toBeLessThanOrEqual(CLOSING_MAX_MS);
    expect(CONNECTING_MAX_MS).toBeLessThanOrEqual(30_000);
    expect(AUTH_MAX_MS).toBeLessThanOrEqual(60_000);
    expect(SILENT_MAX_MS).toBeGreaterThan(60_000); // the heartbeat's own 60 s detector fires first when it is alive
  });
});

describe('page.tsx wiring (the class of bug this feature exists for)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'page.tsx'), 'utf8');
  const effectStart = src.indexOf('// ─── Realtime WebSocket Connection ───');
  const effect = src.slice(effectStart, src.indexOf('// ─── CRITICAL: Emergency polling fallback ───', effectStart));

  it('the supervisor tick is armed in the realtime effect, outside clearTimers(), and never gives up', () => {
    expect(effect).toContain('wsSupervisorRef.current = setInterval(supervise, WS_SUPERVISOR_TICK_MS)');
    const clearTimers = effect.slice(effect.indexOf('const clearTimers = () => {'), effect.indexOf('};', effect.indexOf('const clearTimers = () => {')));
    expect(clearTimers).not.toContain('wsSupervisorRef');
    expect(effect).not.toMatch(/maxReconnect|giveUp|abandonForever/);
  });

  it('an abandon detaches the dead socket, counts a failure, redials with backoff and can escalate to SSE', () => {
    const abandon = effect.slice(effect.indexOf('const abandonAndRedial ='), effect.indexOf('const supervise ='));
    expect(abandon).toContain('ws.onclose = null');
    expect(abandon).toContain('wsPolicyRef.current.onConnectionFailure()');
    expect(abandon).toContain('wsReconnectRef.current = setTimeout(connect, delay)');
    expect(abandon).toContain('void tryOpenSse()');
  });

  it('AUTH_OK is the only thing that marks the socket authenticated, and a new socket resets it', () => {
    expect(effect).toContain("if (msg.type === 'AUTH_OK') {\n              wsPolicyRef.current.onAuthOk();\n              wsAuthOkRef.current = true;");
    expect(effect.match(/wsAuthOkRef\.current = true/g)?.length).toBe(1);
    expect(effect).toContain('wsRef.current = ws;\n        wsAuthOkRef.current = false;');
  });

  it("coming back online looks at once, and the cleanup stops the tick", () => {
    expect(effect).toContain("window.addEventListener('online', onOnlineKick)");
    expect(effect).toContain("window.removeEventListener('online', onOnlineKick)");
    expect(effect).toContain('clearInterval(wsSupervisorRef.current)');
  });
});
