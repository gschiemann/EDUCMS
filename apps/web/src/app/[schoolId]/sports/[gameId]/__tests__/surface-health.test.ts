/**
 * surface-health — render-proof pill-status unit tests (audit P1, 2026-06-13).
 *
 * The bug: SurfaceHealthPills read ONLY the raw device `Screen.status`
 * (ONLINE/OFFLINE from lastPingAt), so a CRASHED/FROZEN board — still
 * TCP-reachable, still ONLINE — stayed GREEN for 5-7 minutes after it
 * stopped painting. These tests pin the fix: a screen showing the game
 * goes GREEN only with positive render proof, and drops to a distinct
 * `frozen` (RED) status the moment render-proof goes stale — NOT minutes
 * later off the ping-derived status.
 */
import { toPillStatus } from '../surface-health';

const SHOWING = { status: 'ONLINE', showing: true, showingOther: false };

describe('toPillStatus — render-proof health', () => {
  it('THE BUG: ONLINE + showing but render STALE → frozen (was: stayed green)', () => {
    // The exact dead-board case: device answers the heartbeat (ONLINE) but
    // the renderer has wedged. renderStale === true is the load-bearing flag.
    expect(
      toPillStatus(SHOWING, {
        renderHealth: 'STALE',
        renderStale: true,
        renderStaleSeconds: 120,
      }),
    ).toBe('frozen');
  });

  it('renderHealth STALE alone (no renderStale bool) still → frozen', () => {
    expect(
      toPillStatus(SHOWING, { renderHealth: 'STALE', renderStaleSeconds: 99 }),
    ).toBe('frozen');
  });

  it('ONLINE + showing + render OK → online-showing (GREEN earned by proof)', () => {
    expect(
      toPillStatus(SHOWING, {
        renderHealth: 'OK',
        renderStale: false,
        renderStaleSeconds: 12,
      }),
    ).toBe('online-showing');
  });

  it('ONLINE + showing + render UNKNOWN → live-unverified (no proof, no false-alarm)', () => {
    expect(
      toPillStatus(SHOWING, {
        renderHealth: 'UNKNOWN',
        renderStale: false,
        renderStaleSeconds: null,
      }),
    ).toBe('live-unverified');
  });

  it('ONLINE + showing + NO render-proof signal at all → live-unverified', () => {
    // Screen not in the fleet list yet / older build → never claim green.
    expect(toPillStatus(SHOWING, null)).toBe('live-unverified');
    expect(toPillStatus(SHOWING, undefined)).toBe('live-unverified');
  });

  it('a fresh ping ALONE never makes a showing screen "online-showing"', () => {
    // The whole point: ONLINE (fresh ping) without an OK render-proof must
    // NOT read as the proof-backed green state.
    const statuses = [null, { renderHealth: 'UNKNOWN' as const }, {}];
    for (const proof of statuses) {
      expect(toPillStatus(SHOWING, proof)).not.toBe('online-showing');
    }
  });

  it('OFFLINE wins regardless of render-proof', () => {
    expect(
      toPillStatus(
        { status: 'OFFLINE', showing: true, showingOther: false },
        { renderHealth: 'OK', renderStale: false },
      ),
    ).toBe('offline');
    // Even a stale-render verdict on an unreachable box reads as offline,
    // not frozen — render-proof only speaks for reachable screens.
    expect(
      toPillStatus(
        { status: 'OFFLINE', showing: true, showingOther: false },
        { renderHealth: 'STALE', renderStale: true },
      ),
    ).toBe('offline');
  });

  it('PENDING / REVOKED (not ONLINE) → offline bucket', () => {
    expect(
      toPillStatus({ status: 'PENDING', showing: false, showingOther: false }, null),
    ).toBe('offline');
    expect(
      toPillStatus({ status: 'REVOKED', showing: true, showingOther: false }, null),
    ).toBe('offline');
  });

  it('showing a DIFFERENT game → showing-other (render-proof irrelevant)', () => {
    expect(
      toPillStatus(
        { status: 'ONLINE', showing: false, showingOther: true },
        { renderHealth: 'OK', renderStale: false },
      ),
    ).toBe('showing-other');
  });

  it('ONLINE but not showing this game → online-off (render-proof irrelevant)', () => {
    // A screen that isn't assigned this game gets no frozen verdict even if
    // its render-proof happens to be stale (it's showing something else).
    expect(
      toPillStatus(
        { status: 'ONLINE', showing: false, showingOther: false },
        { renderHealth: 'STALE', renderStale: true },
      ),
    ).toBe('online-off');
  });
});
