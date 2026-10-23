/**
 * PARITY — the alert worker must read a screen exactly the way the dashboard
 * and the player do (2026-10-23). Two server-side ports, each run against the
 * web module it was ported from over the same fixtures:
 *
 *   render-trust-grade.ts  ⇄  apps/web/src/components/screens/renderTrust.ts
 *   schedule-windows.ts    ⇄  apps/web/src/app/player/softSchedule.ts
 *                             + apps/web/src/components/dashboard/district/uptime.ts
 *
 * If either web module changes its rule, this fails until the port follows.
 */
import { deriveRenderTrustGrade as apiGrade } from './render-trust-grade';
import { covers, desiredOnAt, parseOnWindow, windowsForScreen } from './schedule-windows';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const web = require('../../../../web/src/components/screens/renderTrust');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const soft = require('../../../../web/src/app/player/softSchedule');

const NOW = Date.parse('2026-10-23T15:00:00Z');
const MIN = 60_000;

describe('render-trust grade — API port ⇄ web chip', () => {
  const statuses = ['ONLINE', 'OFFLINE', null];
  const healths = ['OK', 'STALE', 'UNKNOWN', null];
  const stales = [true, false, null];
  const ages = [null, 30_000, 3 * MIN, 25 * MIN, 49 * 3600_000];
  const hashes = [
    null,
    'abc123',
    'idle:playing',
    'idle:content-unavailable',
    'idle:content-downloading',
    'idle:content-loading',
    'idle:connecting',
    'paused:x',
    'stall|abc',
    'unconfirmed|em:1',
    'pending|em:1',
  ];
  const auths = [null, 'PROVEN', 'REPAIR_REQUIRED'];

  it('agrees on every combination', () => {
    let n = 0;
    for (const status of statuses)
      for (const renderHealth of healths)
        for (const renderStale of stales)
          for (const age of ages)
            for (const lastRenderedHash of hashes)
              for (const authState of auths) {
                const input = {
                  status,
                  renderHealth,
                  renderStale,
                  lastRenderedAtMs: age === null ? null : NOW - age,
                  nowMs: NOW,
                  lastRenderedHash,
                  authState,
                } as any;
                expect([apiGrade(input), input]).toEqual([web.deriveRenderTrustGrade(input), input]);
                n++;
              }
    expect(n).toBe(3 * 4 * 3 * 5 * 11 * 3);
  });
});

describe('on/off windows — API port ⇄ player', () => {
  const rows = [
    { id: 'a', daysOfWeek: [1, 2, 3, 4, 5], onTime: '07:00', offTime: '18:00', timezone: 'America/Chicago' },
    { id: 'b', daysOfWeek: [5], onTime: '22:00', offTime: '02:00', timezone: 'America/New_York' },
    { id: 'c', daysOfWeek: [0, 6], onTime: '09:30', offTime: '09:30', timezone: 'UTC' }, // typo row → dropped
    { id: 'd', daysOfWeek: [0, 1, 2, 3, 4, 5, 6], onTime: '06:00', offTime: '23:00', timezone: 'Not/AZone' },
    { id: 'e', daysOfWeek: [3], onTime: '00:00', offTime: '23:59', timezone: 'Asia/Shanghai' },
  ];

  it('parses the same rows and covers the same instants for a whole week', () => {
    for (const row of rows) {
      const a = parseOnWindow(row);
      const b = soft.parseSoftWindow(row);
      expect(a === null).toBe(b === null);
      if (!a) continue;
      for (let t = NOW - 7 * 24 * 60 * MIN; t <= NOW + 7 * 24 * 60 * MIN; t += 17 * MIN) {
        expect([row.id, t, covers(a, t)]).toEqual([row.id, t, soft.covers(b, t)]);
      }
    }
  });

  it('desiredOnAt agrees, including "no windows" = no opinion', () => {
    const a = rows.map(parseOnWindow).filter(Boolean) as any[];
    const b = rows.map(soft.parseSoftWindow).filter(Boolean);
    for (let t = NOW; t <= NOW + 3 * 24 * 60 * MIN; t += 23 * MIN) {
      expect(desiredOnAt(a, t)).toBe(soft.desiredOnAt(b, t));
    }
    expect(desiredOnAt([], NOW)).toBeNull();
    expect(soft.desiredOnAt([], NOW)).toBeNull();
  });

  it('screen rows beat group rows beat tenant-wide rows (the dashboard uptime precedence)', () => {
    const scheduleRows = [
      { id: 's', screenId: 'scr', screenGroupId: null, daysOfWeek: [1], onTime: '08:00', offTime: '09:00', timezone: 'UTC' },
      { id: 'g', screenId: null, screenGroupId: 'grp', daysOfWeek: [2], onTime: '08:00', offTime: '09:00', timezone: 'UTC' },
      { id: 't', screenId: null, screenGroupId: null, daysOfWeek: [3], onTime: '08:00', offTime: '09:00', timezone: 'UTC' },
    ];
    expect(windowsForScreen({ id: 'scr', screenGroupId: 'grp' }, scheduleRows).map((w) => w.id)).toEqual(['s']);
    expect(windowsForScreen({ id: 'other', screenGroupId: 'grp' }, scheduleRows).map((w) => w.id)).toEqual(['g']);
    expect(windowsForScreen({ id: 'other', screenGroupId: null }, scheduleRows).map((w) => w.id)).toEqual(['t']);
  });
});
