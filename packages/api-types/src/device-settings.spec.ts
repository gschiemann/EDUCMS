import {
  DEVICE_SETTINGS_MAX_HEADER_CHARS,
  DEVICE_SETTINGS_TIMEOUT_NEVER,
  DeviceSettingsPatchSchema,
  deviceSettingState,
  isValidNtpServer,
  isValidSsid,
  isValidWifiPassphrase,
  parseDeviceSettingsReport,
  type DeviceSettingsReport,
} from './device-settings';

describe('device settings — value rules (the same ones the unit applies)', () => {
  it('accepts a host name, an IPv4 address or empty for the time server', () => {
    for (const ok of ['', 'time.google.com', 'pool.ntp.org', '10.0.0.1', 'time']) {
      expect(isValidNtpServer(ok)).toBe(true);
    }
    for (const bad of ['http://time.google.com', 'time.google.com:123', 'a b', '999.1.1.1', '12345', 'x'.repeat(254), 'a..b', 'pool.ntp.org;reboot']) {
      expect(isValidNtpServer(bad)).toBe(false);
    }
  });

  it('bounds an SSID by bytes and a passphrase by WPA personal rules', () => {
    expect(isValidSsid('Café ☕')).toBe(true);
    expect(isValidSsid('')).toBe(false);
    expect(isValidSsid('x'.repeat(33))).toBe(false);
    expect(isValidSsid('bad\u0007')).toBe(false);
    expect(isValidWifiPassphrase('12345678')).toBe(true);
    expect(isValidWifiPassphrase('short')).toBe(false);
    expect(isValidWifiPassphrase('x'.repeat(64))).toBe(false);
    expect(isValidWifiPassphrase('tab\there!')).toBe(false);
  });
});

describe('device settings — PUT body', () => {
  const parse = (v: unknown) => DeviceSettingsPatchSchema.safeParse(v);

  it('takes a partial update, null to stop managing a setting', () => {
    expect(parse({ brightness: 80 }).success).toBe(true);
    expect(parse({ brightness: null, autoTime: true }).success).toBe(true);
    expect(parse({ screenOffTimeoutMs: DEVICE_SETTINGS_TIMEOUT_NEVER }).success).toBe(true);
    expect(parse({ attentiveTimeoutMs: -1 }).success).toBe(true);
    expect(parse({ attentiveTimeoutMs: 28_800_000 }).success).toBe(true);
    const ntp = parse({ ntpServer: '  Time.Google.com ' });
    expect(ntp.success && ntp.data.ntpServer).toBe('time.google.com');
  });

  it('refuses an empty body, unknown keys and every out-of-range value', () => {
    for (const bad of [
      {},
      { reboot: true },
      { brightness: 4 },
      { brightness: 50.5 },
      { volume: 101 },
      { screenOffTimeoutMs: 15_000 },
      { attentiveTimeoutMs: 0 },
      { attentiveTimeoutMs: 600_000 },
      { rotationLock: 'yes' },
      { ntpServer: 'evil host' },
      { wifi: { ssid: 'Lobby', security: 'wep' } },
      { wifi: { ssid: 'Lobby', security: 'wpa2', passphrase: 'short' } },
      { wifi: { ssid: 'Guest', security: 'open', passphrase: '12345678' } },
      { wifi: { ssid: 'Lobby', security: 'wpa2', extra: 1 } },
    ]) {
      expect(parse(bad).success).toBe(false);
    }
  });

  it('lets the passphrase be left out (keep the saved one) and accepts an open network without one', () => {
    expect(parse({ wifi: { ssid: 'Lobby', security: 'wpa2' } }).success).toBe(true);
    expect(parse({ wifi: { ssid: 'Guest', security: 'open', hidden: true } }).success).toBe(true);
  });
});

describe('device settings — the unit report header', () => {
  const report = {
    schema: 1,
    rev: 7,
    need: false,
    sdk: 33,
    cap: { brightness: 'ok', autoTime: 'no-secure-settings' },
    obs: { brightness: 80, wifi: { ssid: 'Lobby', approval: 'pending' } },
    ack: { brightness: { id: 'r7', st: 'applied', n: 1, at: 1_760_000_000_000 } },
    load: { thermal: 2, headroom: 0.42, cpu: 12, memAvailMb: 812, memTotalMb: 2048, memLow: false, socC: 61, zones: 4 },
  };

  it('parses a well-formed report', () => {
    const r = parseDeviceSettingsReport(JSON.stringify(report));
    expect(r?.rev).toBe(7);
    expect(r?.cap?.autoTime).toBe('no-secure-settings');
    expect(r?.load?.thermal).toBe(2);
  });

  it('refuses anything absent, oversized or malformed — never a partial read', () => {
    expect(parseDeviceSettingsReport(undefined)).toBeNull();
    expect(parseDeviceSettingsReport('')).toBeNull();
    expect(parseDeviceSettingsReport('{')).toBeNull();
    expect(parseDeviceSettingsReport(JSON.stringify({ ...report, schema: 2 }))).toBeNull();
    expect(parseDeviceSettingsReport(JSON.stringify({ ...report, rev: -1 }))).toBeNull();
    expect(parseDeviceSettingsReport(JSON.stringify({ ...report, load: { thermal: 9 } }))).toBeNull();
    expect(parseDeviceSettingsReport(JSON.stringify({ ...report, load: { socC: 'hot' } }))).toBeNull();
    expect(parseDeviceSettingsReport(JSON.stringify({ ...report, ack: { brightness: { id: 'r7', st: 'done', n: 1 } } }))).toBeNull();
    expect(parseDeviceSettingsReport('x'.repeat(DEVICE_SETTINGS_MAX_HEADER_CHARS + 1))).toBeNull();
  });

  it('reads a capability or reason a newer player knows as "unsupported" / dropped, not as a broken report', () => {
    const r = parseDeviceSettingsReport(
      JSON.stringify({ ...report, cap: { brightness: 'needs-a-new-thing' }, ack: { brightness: { id: 'r7', st: 'failed', n: 3, why: 'brand-new' } } }),
    );
    expect(r?.cap?.brightness).toBe('unsupported');
    expect(r?.ack?.brightness?.why).toBeUndefined();
  });

  it('drops keys it does not know instead of storing them', () => {
    const r = parseDeviceSettingsReport(JSON.stringify({ ...report, secret: 'x', obs: { ...report.obs, model: 'X' } }));
    expect(r && 'secret' in r).toBe(false);
    expect(r && r.obs && 'model' in r.obs).toBe(false);
  });
});

describe('deviceSettingState — one rule for the API and the dashboard', () => {
  const desired = { value: 80, id: 'r7', changedAt: '2026-10-18T12:00:00.000Z' };
  const base: DeviceSettingsReport = { schema: 1, rev: 7, cap: { brightness: 'ok' } };

  it('never calls an unreported unit "not possible"', () => {
    expect(deviceSettingState('brightness', undefined, null)).toEqual({ kind: 'unknown' });
    expect(deviceSettingState('brightness', desired, null)).toEqual({ kind: 'sending' });
  });

  it('says not possible with the unit reason only for a setting nobody stored', () => {
    const r = { ...base, cap: { autoTime: 'no-secure-settings' as const } };
    expect(deviceSettingState('autoTime', undefined, r)).toEqual({ kind: 'not-possible', why: 'no-secure-settings' });
    expect(deviceSettingState('brightness', undefined, base)).toEqual({ kind: 'not-managed' });
  });

  it('acknowledges by identity equality only', () => {
    const older = { ...base, ack: { brightness: { id: 'r6', st: 'applied' as const, n: 1 } } };
    expect(deviceSettingState('brightness', desired, older)).toEqual({ kind: 'sending' });
    const current = { ...base, ack: { brightness: { id: 'r7', st: 'applied' as const, n: 1 } } };
    expect(deviceSettingState('brightness', desired, current)).toEqual({ kind: 'applied', why: undefined });
    const failed = { ...base, ack: { brightness: { id: 'r7', st: 'failed' as const, n: 3, why: 'not-taken' as const } } };
    expect(deviceSettingState('brightness', desired, failed)).toEqual({ kind: 'failed', why: 'not-taken' });
    const waiting = { ...base, ack: { brightness: { id: 'r7', st: 'waiting' as const, n: 0, why: 'emergency' as const } } };
    expect(deviceSettingState('brightness', desired, waiting)).toEqual({ kind: 'waiting', why: 'emergency' });
    const unsupported = { ...base, ack: { brightness: { id: 'r7', st: 'unsupported' as const, n: 0, why: 'no-write-settings' as const } } };
    expect(deviceSettingState('brightness', desired, unsupported)).toEqual({ kind: 'not-possible-now', why: 'no-write-settings' });
  });
});
