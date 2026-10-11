import * as fs from 'fs';
import * as path from 'path';
import { SCREEN_ONLINE_GRACE_MS, isScreenOnline, screenOnlineCutoff } from './online-grace';

/**
 * Muse beta DEV-007 (2026-10-07): one "screen online" rule for every server
 * surface. Readiness said 15/20 while the dashboard said 19/20 because each
 * carried its own window (35 s, 2 min, 100 s).
 */
describe('the one screen-online rule', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');

  it('online = not revoked, has a tenant, pinged within the grace', () => {
    const fresh = new Date(now - (SCREEN_ONLINE_GRACE_MS - 1000));
    const stale = new Date(now - (SCREEN_ONLINE_GRACE_MS + 1000));
    expect(isScreenOnline({ lastPingAt: fresh, tenantId: 't' }, now)).toBe(true);
    expect(isScreenOnline({ lastPingAt: stale, tenantId: 't' }, now)).toBe(false);
    expect(isScreenOnline({ lastPingAt: fresh, tenantId: 't', status: 'REVOKED' }, now)).toBe(false);
    expect(isScreenOnline({ lastPingAt: fresh, tenantId: null }, now)).toBe(false);
    expect(isScreenOnline({ lastPingAt: null, tenantId: 't' }, now)).toBe(false);
    // A 60 s-cadence screen that pinged 50 s ago is online — the old 35 s window said offline.
    expect(isScreenOnline({ lastPingAt: new Date(now - 50_000), tenantId: 't' }, now)).toBe(true);
  });

  it('the cutoff is the same window', () => {
    expect(screenOnlineCutoff(now).getTime()).toBe(now - SCREEN_ONLINE_GRACE_MS);
  });

  it('no server surface keeps a private online window', () => {
    const files = [
      '../emergency/emergency-readiness.service.ts',
      '../floor-plans/floor-plans.controller.ts',
      '../playlists/playlists.controller.ts',
      '../license/super-license.controller.ts',
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
      expect({ f, hit: /35 \* 1000|2 \* 60_000\)/.test(src) }).toEqual({ f, hit: false });
    }
  });
});
