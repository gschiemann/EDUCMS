import {
  deviceTimeZoneDiffers,
  isOceanOrGenericZone,
  isValidIanaTimeZone,
  normalizeTimeZoneInput,
  offsetMinutes,
  resolveEffectiveTimeZone,
} from './time-zone';

describe('time zones — what counts as a zone', () => {
  it('accepts IANA ids the runtime knows and refuses everything else', () => {
    expect(isValidIanaTimeZone('America/Los_Angeles')).toBe(true);
    expect(isValidIanaTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isValidIanaTimeZone('Asia/Shanghai')).toBe(true);
    expect(isValidIanaTimeZone('UTC')).toBe(true);
    expect(isValidIanaTimeZone('Not/AZone')).toBe(false);
    expect(isValidIanaTimeZone('')).toBe(false);
    expect(isValidIanaTimeZone(' America/Chicago')).toBe(false); // untrimmed is not stored as-is
    expect(isValidIanaTimeZone('America/Chicago; drop table')).toBe(false);
    expect(isValidIanaTimeZone('x'.repeat(65))).toBe(false);
    expect(isValidIanaTimeZone(null)).toBe(false);
    expect(isValidIanaTimeZone(42)).toBe(false);
  });

  it('knows the ocean / generic answers an offline lookup gives', () => {
    for (const z of ['Etc/GMT+8', 'Etc/GMT', 'Etc/UTC', 'GMT', 'GMT-3', 'UTC']) {
      expect(isOceanOrGenericZone(z)).toBe(true);
    }
    for (const z of ['America/Los_Angeles', 'Pacific/Honolulu', 'Europe/London']) {
      expect(isOceanOrGenericZone(z)).toBe(false);
    }
  });

  it('normalises an operator input: clear, keep or refuse', () => {
    expect(normalizeTimeZoneInput(null)).toEqual({ ok: true, zone: null });
    expect(normalizeTimeZoneInput(undefined)).toEqual({ ok: true, zone: null });
    expect(normalizeTimeZoneInput('')).toEqual({ ok: true, zone: null });
    expect(normalizeTimeZoneInput('   ')).toEqual({ ok: true, zone: null });
    expect(normalizeTimeZoneInput(' America/Denver ')).toEqual({ ok: true, zone: 'America/Denver' });
    expect(normalizeTimeZoneInput('Mars/Olympus')).toEqual({ ok: false, reason: 'unknown-zone' });
    expect(normalizeTimeZoneInput(7)).toEqual({ ok: false, reason: 'not-a-string' });
    expect(normalizeTimeZoneInput('A/' + 'b'.repeat(70))).toEqual({ ok: false, reason: 'too-long' });
  });
});

describe('time zones — the precedence', () => {
  const auto = { zone: 'America/Los_Angeles', from: 'location' as const };

  it('screen override > location setting > automatic > device', () => {
    expect(resolveEffectiveTimeZone({ screenOverride: 'America/Denver', locationSetting: 'America/Chicago', auto }))
      .toEqual({ zone: 'America/Denver', source: 'screen', auto });
    expect(resolveEffectiveTimeZone({ locationSetting: 'America/Chicago', auto }))
      .toEqual({ zone: 'America/Chicago', source: 'location', auto });
    expect(resolveEffectiveTimeZone({ auto })).toEqual({ zone: 'America/Los_Angeles', source: 'auto', auto });
    expect(resolveEffectiveTimeZone({})).toEqual({ zone: null, source: 'device', auto: null });
  });

  it('skips an invalid stored value instead of passing it on', () => {
    expect(resolveEffectiveTimeZone({ screenOverride: 'Garbage/Zone', locationSetting: 'America/Chicago', auto }))
      .toEqual({ zone: 'America/Chicago', source: 'location', auto });
    expect(resolveEffectiveTimeZone({ screenOverride: '', locationSetting: null, auto }))
      .toEqual({ zone: 'America/Los_Angeles', source: 'auto', auto });
    expect(resolveEffectiveTimeZone({ auto: { zone: 'Nope/Nope', from: 'screen' } }))
      .toEqual({ zone: null, source: 'device', auto: null });
  });

  it('keeps the automatic answer visible even when a setting wins', () => {
    const r = resolveEffectiveTimeZone({ locationSetting: 'America/New_York', auto });
    expect(r.auto).toEqual(auto);
  });
});

describe('time zones — does the device disagree?', () => {
  it('is false when either side is unknown or they match', () => {
    expect(deviceTimeZoneDiffers(null, 'Asia/Shanghai')).toBe(false);
    expect(deviceTimeZoneDiffers('America/Los_Angeles', null)).toBe(false);
    expect(deviceTimeZoneDiffers('America/Los_Angeles', 'America/Los_Angeles')).toBe(false);
    expect(deviceTimeZoneDiffers('America/Los_Angeles', 'Not/AZone')).toBe(false);
  });

  it('is true for a GUQ set to Shanghai in Los Angeles, false for two names of the same rules', () => {
    expect(deviceTimeZoneDiffers('America/Los_Angeles', 'Asia/Shanghai')).toBe(true);
    expect(deviceTimeZoneDiffers('America/Los_Angeles', 'US/Pacific')).toBe(false);
    expect(deviceTimeZoneDiffers('America/Phoenix', 'America/Denver')).toBe(true); // differs in summer
  });

  it('computes offsets in minutes east of UTC', () => {
    const jan = Date.UTC(2026, 0, 15, 12);
    const jul = Date.UTC(2026, 6, 15, 12);
    expect(offsetMinutes('Asia/Shanghai', jan)).toBe(480);
    expect(offsetMinutes('America/Los_Angeles', jan)).toBe(-480);
    expect(offsetMinutes('America/Los_Angeles', jul)).toBe(-420);
    expect(offsetMinutes('Asia/Kolkata', jan)).toBe(330);
    expect(offsetMinutes('Nope/Nope', jan)).toBeNull();
  });
});
