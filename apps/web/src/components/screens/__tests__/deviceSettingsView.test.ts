import type { DeviceSettingsView } from '@cms/api-types';
import {
  buildSection,
  formatMemory,
  patchFor,
  selectValue,
  thermalLevel,
  timeoutParts,
} from '../deviceSettingsView';
import { deviceSettingsInFlight } from '@/hooks/use-device-settings';

const base = (over: Partial<DeviceSettingsView> = {}): DeviceSettingsView => ({
  screenId: 's1',
  faceOfScreenId: null,
  revision: 3,
  desired: {},
  report: null,
  reportChangedAt: null,
  reportedAt: null,
  ...over,
});

describe('buildSection — the honesty rules', () => {
  it('no report → no controls at all (never "not possible")', () => {
    const m = buildSection(base({ desired: { brightness: { value: 80, id: 'r3', changedAt: 'x' } } }));
    expect(m.kind).toBe('not-reported');
  });

  it('an Android 12 unit collapses to one sentence instead of eight identical rows', () => {
    const cap = Object.fromEntries(
      ['brightness', 'volume', 'screenOffTimeoutMs', 'attentiveTimeoutMs', 'rotationLock', 'autoTime', 'autoTimeZone', 'ntpServer', 'wifi'].map((k) => [k, 'api-level']),
    );
    const m = buildSection(base({ report: { schema: 1, rev: 0, sdk: 31, cap } }));
    expect(m).toEqual({ kind: 'old-android', sdk: 31 });
  });

  it('a setting the unit cannot set and nobody stored has no control; a stored one keeps its control', () => {
    const m = buildSection(
      base({
        desired: { autoTimeZone: { value: true, id: 'r2', changedAt: 'x' } },
        report: {
          schema: 1,
          rev: 3,
          cap: { brightness: 'ok', autoTime: 'no-secure-settings', autoTimeZone: 'no-secure-settings' },
          ack: { autoTimeZone: { id: 'r2', st: 'unsupported', n: 0, why: 'no-secure-settings' } },
          obs: { brightness: 70 },
        },
      }),
    );
    if (m.kind !== 'ready') throw new Error(m.kind);
    const row = (k: string) => m.rows.find((r) => r.key === k)!;
    expect(row('autoTime')).toMatchObject({ editable: false, state: { kind: 'not-possible', why: 'no-secure-settings' } });
    expect(row('autoTimeZone')).toMatchObject({ editable: true, state: { kind: 'not-possible-now', why: 'no-secure-settings' } });
    expect(row('brightness')).toMatchObject({ editable: true, state: { kind: 'not-managed' }, observed: 70 });
  });

  it('a stored value the unit has not acknowledged by identity is still "sending"', () => {
    const m = buildSection(
      base({
        desired: { volume: { value: 30, id: 'r4', changedAt: 'x' } },
        report: { schema: 1, rev: 3, cap: { volume: 'ok' }, ack: { volume: { id: 'r3', st: 'applied', n: 1 } } },
      }),
    );
    if (m.kind !== 'ready') throw new Error(m.kind);
    expect(m.rows.find((r) => r.key === 'volume')!.state).toEqual({ kind: 'sending' });
  });
});

describe('controls ↔ PUT body', () => {
  it('maps a select value to the typed patch, "" to stop managing', () => {
    expect(patchFor('brightness', '80')).toEqual({ brightness: 80 });
    expect(patchFor('screenOffTimeoutMs', '2147483647')).toEqual({ screenOffTimeoutMs: 2_147_483_647 });
    expect(patchFor('rotationLock', 'true')).toEqual({ rotationLock: true });
    expect(patchFor('autoTime', 'false')).toEqual({ autoTime: false });
    expect(patchFor('volume', '')).toEqual({ volume: null });
    expect(patchFor('attentiveTimeoutMs', '-1')).toEqual({ attentiveTimeoutMs: -1 });
  });

  it('shows the stored value in the select, "" when not managed', () => {
    const row = { key: 'autoTime' as const, state: { kind: 'not-managed' as const }, editable: true, observed: undefined };
    expect(selectValue({ ...row, desired: undefined })).toBe('');
    expect(selectValue({ ...row, desired: { value: false, id: 'r1', changedAt: 'x' } })).toBe('false');
  });
});

describe('formatting helpers', () => {
  it('reads a timeout in its natural unit', () => {
    expect(timeoutParts(2_147_483_647)).toEqual({ never: true });
    expect(timeoutParts(-1)).toEqual({ never: true });
    expect(timeoutParts(14_400_000)).toEqual({ unit: 'hours', n: 4 });
    expect(timeoutParts(3_600_000)).toEqual({ unit: 'hours', n: 1 });
    expect(timeoutParts(1_800_000)).toEqual({ unit: 'minutes', n: 30 });
    expect(timeoutParts(60_000)).toEqual({ unit: 'minutes', n: 1 });
  });

  it('names Android thermal levels and refuses out-of-range ones', () => {
    expect(thermalLevel(0)).toBe('none');
    expect(thermalLevel(3)).toBe('severe');
    expect(thermalLevel(6)).toBe('shutdown');
    expect(thermalLevel(7)).toBeNull();
    expect(thermalLevel(undefined)).toBeNull();
  });

  it('prints memory as MB or GB', () => {
    expect(formatMemory(812, 'en')).toBe('812 MB');
    expect(formatMemory(2048, 'en')).toBe('2.0 GB');
  });
});

describe('refresh only while something is in flight', () => {
  it('is true for a sending or waiting row and false otherwise', () => {
    expect(deviceSettingsInFlight(undefined)).toBe(false);
    expect(deviceSettingsInFlight(base())).toBe(false);
    expect(deviceSettingsInFlight(base({ desired: { volume: { value: 30, id: 'r4', changedAt: 'x' } } }))).toBe(true);
    const settled = base({
      desired: { volume: { value: 30, id: 'r4', changedAt: 'x' } },
      report: { schema: 1, rev: 4, ack: { volume: { id: 'r4', st: 'applied', n: 1 } } },
    });
    expect(deviceSettingsInFlight(settled)).toBe(false);
    const waiting = base({
      desired: { volume: { value: 30, id: 'r4', changedAt: 'x' } },
      report: { schema: 1, rev: 4, ack: { volume: { id: 'r4', st: 'waiting', n: 0, why: 'screen-off' } } },
    });
    expect(deviceSettingsInFlight(waiting)).toBe(true);
  });
});
