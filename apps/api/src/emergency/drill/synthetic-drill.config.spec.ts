/**
 * Synthetic emergency drill — configuration. Every variable can only
 * SUBTRACT: unset / empty / malformed / unknown never makes more drills
 * happen, never widens the list, never starts an email.
 */
import { DRILL_MAX_SCREENS, parseDrillSchedule, parseDrillScreens, readDrillConfig, resolveDrillMode } from './synthetic-drill.config';

const A = '1cff5eb0-0000-4000-8000-000000000001';
const B = '69b7bf43-0000-4000-8000-000000000002';
const env = (over: Record<string, string | undefined>): NodeJS.ProcessEnv => ({ NODE_ENV: 'production', ...over }) as NodeJS.ProcessEnv;

describe('nothing set runs nothing', () => {
  it('EMERGENCY_DRILL_SCREENS unset = the job does nothing (whatever else is set)', () => {
    for (const over of [{}, { EMERGENCY_DRILL_MODE: 'on' }, { EMERGENCY_DRILL_SCHEDULE: '09:00' }, { EMERGENCY_DRILL_SCREENS: '' }, { EMERGENCY_DRILL_SCREENS: '  ,, ' }]) {
      const c = readDrillConfig(env(over));
      expect(c.enabled).toBe(false);
      expect(c.screenIds).toEqual([]);
    }
  });

  it('EMERGENCY_DRILL_CRON_DISABLED=1 beats every other setting', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', ' 1 ']) {
      const c = readDrillConfig(env({ EMERGENCY_DRILL_CRON_DISABLED: v, EMERGENCY_DRILL_SCREENS: A, EMERGENCY_DRILL_MODE: 'on' }));
      expect(c.enabled).toBe(false);
      expect(c.disabledReason).toBe('EMERGENCY_DRILL_CRON_DISABLED');
    }
    // Anything else is not the kill switch, but also never turns anything ON by itself.
    expect(readDrillConfig(env({ EMERGENCY_DRILL_CRON_DISABLED: '0', EMERGENCY_DRILL_SCREENS: A })).enabled).toBe(true);
  });

  it('all off under NODE_ENV=test', () => {
    const c = readDrillConfig({ NODE_ENV: 'test', EMERGENCY_DRILL_SCREENS: A, EMERGENCY_DRILL_MODE: 'on' } as NodeJS.ProcessEnv);
    expect(c.enabled).toBe(false);
    expect(c.disabledReason).toBe('NODE_ENV=test');
  });

  it('mode off = nothing', () => {
    expect(readDrillConfig(env({ EMERGENCY_DRILL_SCREENS: A, EMERGENCY_DRILL_MODE: 'off' })).enabled).toBe(false);
  });
});

describe('typos never widen', () => {
  it('a token that is not a screen UUID is ignored and logged — never a wildcard', () => {
    const errors: string[] = [];
    expect(parseDrillScreens(`all, *, ${A}, screen-1, ${A.toUpperCase()},${B}`, errors)).toEqual([A, B]);
    expect(errors).toHaveLength(3);
    expect(readDrillConfig(env({ EMERGENCY_DRILL_SCREENS: 'all' })).enabled).toBe(false);
    expect(readDrillConfig(env({ EMERGENCY_DRILL_SCREENS: '*' })).screenIds).toEqual([]);
  });

  it(`at most ${DRILL_MAX_SCREENS} screens; the rest are dropped (logged), never more`, () => {
    const ids = Array.from({ length: 15 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const errors: string[] = [];
    const out = parseDrillScreens(ids.join(','), errors);
    expect(out).toEqual(ids.slice(0, 12));
    expect(errors.some((e) => e.includes('more than 12'))).toBe(true);
  });

  it('an unknown mode reads as shadow (and says so); empty is shadow', () => {
    const errors: string[] = [];
    expect(resolveDrillMode('ONN', errors)).toBe('shadow');
    expect(errors).toHaveLength(1);
    expect(resolveDrillMode(undefined)).toBe('shadow');
    expect(resolveDrillMode(' Alert ')).toBe('alert');
    expect(resolveDrillMode('on')).toBe('on');
    expect(readDrillConfig(env({ EMERGENCY_DRILL_SCREENS: A })).mode).toBe('shadow');
  });

  it('schedule: default 10:30 local; ≤ 4 strict HH:MM slots; invalid = no drills (the job still runs to report the gap)', () => {
    expect(parseDrillSchedule(undefined)).toEqual([{ label: '10:30', minuteOfDay: 630 }]);
    expect(parseDrillSchedule('14:00, 09:15')).toEqual([
      { label: '09:15', minuteOfDay: 555 },
      { label: '14:00', minuteOfDay: 840 },
    ]);
    for (const bad of ['9:15', '24:00', '10:60', '10.30', 'noon', '01:00,02:00,03:00,04:00,05:00']) {
      expect(parseDrillSchedule(bad)).toBeNull();
    }
    const c = readDrillConfig(env({ EMERGENCY_DRILL_SCREENS: A, EMERGENCY_DRILL_SCHEDULE: '9:15' }));
    expect(c.enabled).toBe(true);
    expect(c.scheduleValid).toBe(false);
    expect(c.slots).toEqual([]);
  });

  it('the config is frozen', () => {
    const c = readDrillConfig(env({ EMERGENCY_DRILL_SCREENS: A }));
    expect(Object.isFrozen(c)).toBe(true);
    expect(Object.isFrozen(c.screenIds)).toBe(true);
    expect(() => (c.screenIds as string[]).push(B)).toThrow();
  });
});
