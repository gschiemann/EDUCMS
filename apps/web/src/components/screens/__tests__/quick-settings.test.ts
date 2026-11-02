/**
 * The visibility rules of the simplified screen Settings tab (2026-11-01):
 * unsupported controls are HIDDEN, never greyed; the schedule is one line;
 * the setup summary counts only required steps that still need doing.
 */

import { resolveDisplayControls } from '../display-capabilities';
import { formatClock, resolveQuickControls, summarizeScheduleLine } from '../quick-settings';
import { parseSetupTelemetry, summarizeSetup } from '../screen-setup';

const doc = (verdict: Record<string, unknown>) => ({ schema: 1, reportedAt: 1, build: {}, verdict });

describe('resolveQuickControls', () => {
  it('hides volume and restart when the unit cannot do them', () => {
    const caps = resolveDisplayControls(
      doc({ volume: 'none', brightness: 'sysfs-backlight', screenBlank: 'none', reboot: 'none', deviceOwnerPath: 'none' }),
    );
    expect(resolveQuickControls(caps)).toEqual({
      sleepAwake: true,
      volume: false,
      brightness: true,
      restart: false,
      schedule: true,
    });
  });

  it('shows volume and restart only where reported as supported', () => {
    const caps = resolveDisplayControls(
      doc({ volume: 'audiomanager', brightness: 'sysfs-backlight', screenBlank: 'none', reboot: 'device-owner', deviceOwnerPath: 'held' }),
    );
    const q = resolveQuickControls(caps);
    expect(q.volume).toBe(true);
    expect(q.restart).toBe(true);
  });

  it('an unreported Android screen gets Sleep/Awake, a brightness raise and the schedule only', () => {
    const q = resolveQuickControls(resolveDisplayControls(null));
    expect(q).toEqual({ sleepAwake: true, volume: false, brightness: true, restart: false, schedule: true });
  });

  it('a browser player with nothing reported keeps only Sleep / Awake', () => {
    const q = resolveQuickControls(resolveDisplayControls(null), { browserPlayer: true });
    expect(q).toEqual({ sleepAwake: true, volume: false, brightness: false, restart: false, schedule: false });
  });
});

describe('summarizeScheduleLine', () => {
  it('reads "off at / on at" from the saved window', () => {
    const line = summarizeScheduleLine([{ onTime: '07:00', offTime: '18:00', isActive: true }], 'en');
    expect(line).toEqual({ kind: 'window', offAt: '6 PM', onAt: '7 AM', more: 0 });
  });

  it('counts further active windows, ignores paused ones', () => {
    const line = summarizeScheduleLine(
      [
        { onTime: '07:00', offTime: '18:00' },
        { onTime: '08:30', offTime: '12:00' },
        { onTime: '09:00', offTime: '10:00', isActive: false },
      ],
      'en',
    );
    expect(line).toMatchObject({ kind: 'window', more: 1 });
  });

  it('distinguishes none from all-paused', () => {
    expect(summarizeScheduleLine([], 'en')).toEqual({ kind: 'none' });
    expect(summarizeScheduleLine(undefined, 'en')).toEqual({ kind: 'none' });
    expect(summarizeScheduleLine([{ onTime: '07:00', offTime: '18:00', isActive: false }], 'en')).toEqual({ kind: 'paused' });
  });

  it('formats half hours and rejects junk', () => {
    expect(formatClock('07:30', 'en')).toBe('7:30 AM');
    expect(formatClock('25:00', 'en')).toBeNull();
    expect(formatClock(null, 'en')).toBeNull();
  });
});

describe('summarizeSetup', () => {
  const step = (key: string, o: Partial<Record<string, unknown>> = {}) => ({
    key, name: key, applies: true, held: false, offered: false, optional: false, launch: null, ...o,
  });
  const parse = (steps: unknown[]) => parseSetupTelemetry({ setup: { steps } })!;

  it('counts required steps that are not held', () => {
    const s = summarizeSetup(parse([step('a'), step('b'), step('c', { held: true }), step('d')]));
    expect(s).toEqual({ needed: 3, complete: false });
  });

  it('ignores optional steps, steps that do not apply, and the unreadable Manager appop', () => {
    const s = summarizeSetup(
      parse([
        step('a', { held: true }),
        step('b', { optional: true }),
        step('c', { applies: false }),
        step('managerInstallPromptShown'),
      ]),
    );
    expect(s).toEqual({ needed: 0, complete: true });
  });
});
