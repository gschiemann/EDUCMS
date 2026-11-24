/**
 * Alert times as the screen's clock shows them (2026-11-23).
 *
 * The owner, after a live demo: "My alert email give me utc time but I want
 * local time of the screen". These pin the label (every language, DST, the
 * half-hour and 45-minute zones, a bad or missing zone) and the zone each
 * email uses — which must be exactly the zone the screen's glass shows.
 */
import {
  alertTimeLabel,
  alertZoneForLocation,
  alertZoneForScreen,
  locationClockZone,
  type ClockTenant,
  type ScreenClockRow,
} from './alert-time';
import { manifestTimeZone } from '../../screens/screen-time-zone';

const AT = Date.parse('2026-11-23T20:41:00Z'); // Monday, CST in Chicago
const JUL = Date.parse('2026-07-23T20:41:00Z'); // Thursday, CDT in Chicago
const LOCALES = ['en', 'es', 'zh'] as const;

const CHICAGO = { latitude: 41.8781, longitude: -87.6298 };
const DENVER = { latitude: 39.7392, longitude: -104.9903 };
const NEW_YORK = { latitude: 40.7128, longitude: -74.006 };
const PHOENIX = { latitude: 33.4484, longitude: -112.074 };

describe('alertTimeLabel — the moment, the date and the zone, in the reader’s language', () => {
  it('Chicago in November is CST, in July CDT — en / es / zh', () => {
    expect(alertTimeLabel('en', AT, 'America/Chicago')).toBe('Mon, Nov 23, 2026, 2:41 PM CST');
    expect(alertTimeLabel('es', AT, 'America/Chicago')).toBe('lun, 23 nov 2026, 14:41 hora estándar central');
    expect(alertTimeLabel('zh', AT, 'America/Chicago')).toBe('2026年11月23日周一 北美中部标准时间下午2:41');
    expect(alertTimeLabel('en', JUL, 'America/Chicago')).toBe('Thu, Jul 23, 2026, 3:41 PM CDT');
    expect(alertTimeLabel('es', JUL, 'America/Chicago')).toBe('jue, 23 jul 2026, 15:41 hora de verano central');
    expect(alertTimeLabel('zh', JUL, 'America/Chicago')).toBe('2026年7月23日周四 北美中部夏令时间下午3:41');
  });

  it('across the spring-forward boundary the clock jumps an hour and the label says which', () => {
    expect(alertTimeLabel('en', Date.parse('2026-03-08T07:59:00Z'), 'America/Chicago')).toBe('Sun, Mar 8, 2026, 1:59 AM CST');
    expect(alertTimeLabel('en', Date.parse('2026-03-08T08:00:00Z'), 'America/Chicago')).toBe('Sun, Mar 8, 2026, 3:00 AM CDT');
  });

  it('the repeated fall-back hour is told apart only by the zone name — which is why it is always printed', () => {
    const before = alertTimeLabel('en', Date.parse('2026-11-01T06:30:00Z'), 'America/Chicago');
    const after = alertTimeLabel('en', Date.parse('2026-11-01T07:30:00Z'), 'America/Chicago');
    expect(before).toBe('Sun, Nov 1, 2026, 1:30 AM CDT');
    expect(after).toBe('Sun, Nov 1, 2026, 1:30 AM CST');
    expect(alertTimeLabel('es', Date.parse('2026-11-01T06:30:00Z'), 'America/Chicago')).toContain('hora de verano central');
    expect(alertTimeLabel('es', Date.parse('2026-11-01T07:30:00Z'), 'America/Chicago')).toContain('hora estándar central');
    expect(alertTimeLabel('zh', Date.parse('2026-11-01T06:30:00Z'), 'America/Chicago')).toContain('北美中部夏令时间');
    expect(alertTimeLabel('zh', Date.parse('2026-11-01T07:30:00Z'), 'America/Chicago')).toContain('北美中部标准时间');
  });

  it('half-hour and 45-minute offsets keep their minutes and name the zone', () => {
    expect(alertTimeLabel('en', AT, 'Asia/Kolkata')).toBe('Tue, Nov 24, 2026, 2:11 AM GMT+5:30');
    expect(alertTimeLabel('es', AT, 'Asia/Kolkata')).toBe('mar, 24 nov 2026, 2:11 hora estándar de la India');
    expect(alertTimeLabel('zh', AT, 'Asia/Kolkata')).toBe('2026年11月24日周二 印度时间上午2:11');
    expect(alertTimeLabel('en', AT, 'America/St_Johns')).toBe('Mon, Nov 23, 2026, 5:11 PM GMT-3:30');
    expect(alertTimeLabel('en', JUL, 'America/St_Johns')).toBe('Thu, Jul 23, 2026, 6:11 PM GMT-2:30');
    expect(alertTimeLabel('es', AT, 'America/St_Johns')).toBe('lun, 23 nov 2026, 17:11 hora estándar de Terranova');
    expect(alertTimeLabel('en', AT, 'Asia/Kathmandu')).toBe('Tue, Nov 24, 2026, 2:26 AM GMT+5:45');
    // Adelaide: half-hour offset AND daylight saving (southern summer in November).
    expect(alertTimeLabel('en', AT, 'Australia/Adelaide')).toBe('Tue, Nov 24, 2026, 7:11 AM GMT+10:30');
    expect(alertTimeLabel('en', JUL, 'Australia/Adelaide')).toBe('Fri, Jul 24, 2026, 6:11 AM GMT+9:30');
  });

  it('the date rolls over with the zone (it is printed every time)', () => {
    expect(alertTimeLabel('en', AT, 'Asia/Shanghai')).toBe('Tue, Nov 24, 2026, 4:41 AM GMT+8');
    expect(alertTimeLabel('en', AT, 'Pacific/Honolulu')).toBe('Mon, Nov 23, 2026, 10:41 AM HST');
  });

  it('a missing, empty, unknown or malformed zone is UTC and SAYS so — never a bare time, never a throw', () => {
    for (const zone of [null, undefined, '', 'Not/AZone', 'America/Chicag0', ' America/Chicago', 'x'.repeat(80)]) {
      expect(alertTimeLabel('en', AT, zone)).toBe('Mon, Nov 23, 2026, 8:41 PM UTC');
      expect(alertTimeLabel('es', AT, zone)).toBe('lun, 23 nov 2026, 20:41 tiempo universal coordinado');
      expect(alertTimeLabel('zh', AT, zone)).toBe('2026年11月23日周一 协调世界时下午8:41');
    }
  });

  it('a moment that is not a number is a dash, not 1970 and not a throw', () => {
    expect(alertTimeLabel('en', Number.NaN, 'America/Chicago')).toBe('—');
    expect(alertTimeLabel('en', Number.POSITIVE_INFINITY, 'America/Chicago')).toBe('—');
  });

  it('no narrow or non-breaking space survives, whatever the runtime’s ICU puts before AM/PM', () => {
    for (const l of LOCALES)
      for (const zone of ['America/Chicago', 'Asia/Kolkata', 'UTC', null])
        for (const at of [AT, JUL]) expect(alertTimeLabel(l, at, zone)).not.toMatch(/[\u202f\u00a0]/);
  });
});

describe('which zone an email uses — exactly the zone the glass shows', () => {
  const tenants = new Map<string, ClockTenant>([
    ['district', { parentId: null, timezone: 'America/Chicago' }],
    ['lincoln', { parentId: 'district', timezone: null, ...CHICAGO }],
    ['mesa', { parentId: 'district', timezone: 'America/Denver' }],
    ['blank', { parentId: 'district', timezone: null }],
    ['addressed-district', { parentId: null, timezone: null, ...PHOENIX }],
    ['blank-under-address', { parentId: 'addressed-district', timezone: null }],
    ['alone', { parentId: null, timezone: null }],
    ['bad', { parentId: 'alone', timezone: 'Mars/Olympus_Mons', ...NEW_YORK }],
  ]);
  const scr = (over: Partial<ScreenClockRow>): ScreenClockRow => ({ id: 's', tenantId: 'lincoln', timezone: null, latitude: null, longitude: null, screenGroup: null, ...over });

  it('Screen.timezone beats the location setting, which beats the zone at the address', () => {
    expect(alertZoneForScreen(scr({ tenantId: 'mesa', timezone: 'America/New_York' }), tenants)).toBe('America/New_York');
    expect(alertZoneForScreen(scr({ tenantId: 'mesa', ...CHICAGO }), tenants)).toBe('America/Denver');
    expect(alertZoneForScreen(scr({ tenantId: 'lincoln' }), tenants)).toBe('America/Chicago');
  });

  it('with no setting, the screen’s own coordinates, then its group’s, then the location’s', () => {
    expect(alertZoneForScreen(scr({ ...DENVER, screenGroup: NEW_YORK }), tenants)).toBe('America/Denver');
    expect(alertZoneForScreen(scr({ screenGroup: NEW_YORK }), tenants)).toBe('America/New_York');
    expect(alertZoneForScreen(scr({ screenGroup: { latitude: null, longitude: null } }), tenants)).toBe('America/Chicago');
  });

  it('an invalid stored zone is skipped, never passed on', () => {
    expect(alertZoneForScreen(scr({ tenantId: 'mesa', timezone: 'Not/AZone' }), tenants)).toBe('America/Denver');
    // The location's own bad setting is skipped; its address answers.
    expect(alertZoneForLocation('bad', tenants)).toBe('America/New_York');
  });

  it('a location with nothing set uses its organisation’s setting, then its organisation’s address, then nothing (UTC)', () => {
    expect(alertZoneForLocation('blank', tenants)).toBe('America/Chicago');
    expect(alertZoneForScreen(scr({ tenantId: 'blank' }), tenants)).toBe('America/Chicago');
    expect(alertZoneForLocation('blank-under-address', tenants)).toBe('America/Phoenix');
    expect(alertZoneForLocation('alone', tenants)).toBeNull();
    expect(alertZoneForScreen(scr({ tenantId: 'alone' }), tenants)).toBeNull();
    expect(alertZoneForLocation('unknown-id', tenants)).toBeNull();
    expect(alertZoneForLocation(null, tenants)).toBeNull();
  });

  it('a location’s own zone is its setting, else its address — the dashboard’s location view', () => {
    expect(locationClockZone(tenants.get('mesa'))).toBe('America/Denver');
    expect(locationClockZone(tenants.get('lincoln'))).toBe('America/Chicago');
    expect(locationClockZone(tenants.get('blank'))).toBeNull();
    expect(locationClockZone(undefined)).toBeNull();
  });

  it('the device’s own zone is never used (Goodview panels ship set to Asia/Shanghai)', () => {
    const row = { ...scr({ tenantId: 'alone' }), deviceTimeZone: 'Asia/Shanghai' } as ScreenClockRow;
    expect(alertZoneForScreen(row, tenants)).toBeNull();
    expect(alertZoneForScreen({ ...row, tenantId: 'lincoln' } as ScreenClockRow, tenants)).toBe('America/Chicago');
  });

  it('a parent loop cannot hang the walk', () => {
    const loop = new Map<string, ClockTenant>([
      ['a', { parentId: 'b', timezone: null }],
      ['b', { parentId: 'a', timezone: null }],
    ]);
    expect(alertZoneForLocation('a', loop)).toBeNull();
  });

  it('PARITY: whenever the manifest names a zone, the email names the same one', () => {
    const fixtures: ScreenClockRow[] = [];
    const overrides = [null, 'America/New_York', 'Not/AZone'];
    const points = [{ latitude: null, longitude: null }, CHICAGO, DENVER, PHOENIX];
    for (const tenantId of ['district', 'lincoln', 'mesa', 'blank', 'alone', 'bad'])
      for (const timezone of overrides)
        for (const own of points)
          for (const group of [null, ...points])
            fixtures.push({ id: 'x', tenantId, timezone, ...own, screenGroup: group });
    let named = 0;
    for (const row of fixtures) {
      const glass = manifestTimeZone(row, row.screenGroup ?? null, tenants.get(row.tenantId!) ?? null);
      if (glass === null) continue;
      named++;
      expect([row, alertZoneForScreen(row, tenants)]).toEqual([row, glass]);
    }
    expect(named).toBeGreaterThan(fixtures.length / 2);
  });
});
