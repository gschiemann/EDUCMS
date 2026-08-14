/**
 * Display-capability self-report — the once-per-(screen × APK version) rule.
 *
 * THE BUG THIS PINS. The marker used to be keyed on `probe.build.display`,
 * which is `Build.DISPLAY` — the OS build id of the Android image, set by the
 * box vendor and constant for the life of the firmware. So the cache key
 * never moved when the APK was updated: a screen that reported once kept its
 * marker forever and NEVER re-reported, and the dashboard kept gating its
 * per-screen controls on a verdict from an APK that is no longer installed.
 * The key has to be the APP version (`deviceInfo().appVersion`).
 *
 * The other half of the contract is just as load-bearing in the opposite
 * direction: this must not become a per-page-load write. The player reloads
 * on a watchdog, on REFRESH_WEB, on service-worker updates and on network
 * recovery, and a whole school's kiosks share one NAT'd IP against a
 * 30/min-per-IP throttle.
 */

import { reportDisplayCapabilities } from '../displayCapabilityReport';

const callMock = jest.fn();
const callOrMock = jest.fn();
const hasMock = jest.fn();
jest.mock('../nativeBridge', () => ({
  nativeCall: (...args: unknown[]) => callMock(...args),
  nativeCallOr: (...args: unknown[]) => callOrMock(...args),
  nativeHas: (...args: unknown[]) => hasMock(...args),
}));

/** A probe verdict whose OS build id never changes, as on a real box. */
const PROBE = JSON.stringify({
  schema: 1,
  build: {
    manufacturer: 'Goodview',
    model: 'ECBox3576',
    board: 'rk3288',
    display: 'rk3288-userdebug 7.1.2 NHG47K eng.20200612',
  },
  verdict: { brightness: 'software-dim', screenBlank: 'software-dim' },
});

function mockAppVersion(v: string | null) {
  callOrMock.mockImplementation(async (fallback: unknown, method: string) => {
    if (method !== 'deviceInfo') return fallback;
    return v === null ? '' : JSON.stringify({ manufacturer: 'Goodview', appVersion: v });
  });
}

const OPTS = { screenId: 'screen-1', apiRoot: 'https://api.test', token: 'tok' };

beforeEach(() => {
  callMock.mockReset();
  callOrMock.mockReset();
  hasMock.mockReset();
  hasMock.mockReturnValue(true);
  callMock.mockResolvedValue(PROBE);
  mockAppVersion('1.1.1');
  window.localStorage.clear();
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;
});

describe('reportDisplayCapabilities', () => {
  it('POSTs the probe verdict verbatim to the capabilities endpoint', async () => {
    await expect(reportDisplayCapabilities(OPTS)).resolves.toBe('reported');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.test/api/v1/screens/screen-1/display-capabilities');
    expect((init as RequestInit).body).toBe(PROBE);
  });

  it('does not re-report on the next page load — same screen, same APK', async () => {
    await reportDisplayCapabilities(OPTS);
    (global.fetch as jest.Mock).mockClear();
    await expect(reportDisplayCapabilities(OPTS)).resolves.toBe(
      'skipped: already reported this version',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('RE-REPORTS after an APK update, even though Build.DISPLAY did not change', async () => {
    // ⚠️ THE REGRESSION. The probe payload below is byte-identical across
    // both calls — including `build.display`, the old cache key. Only the
    // app version moved. Before the fix this screen was pinned to its first
    // verdict for the life of the firmware.
    await expect(reportDisplayCapabilities(OPTS)).resolves.toBe('reported');
    (global.fetch as jest.Mock).mockClear();

    mockAppVersion('1.2.0');
    await expect(reportDisplayCapabilities(OPTS)).resolves.toBe('reported');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('re-reports for a different screen id on the same box', async () => {
    await reportDisplayCapabilities(OPTS);
    (global.fetch as jest.Mock).mockClear();
    await expect(reportDisplayCapabilities({ ...OPTS, screenId: 'screen-2' })).resolves.toBe(
      'reported',
    );
  });

  it('falls back to a DAY bucket when appVersion is unreadable', async () => {
    // Neither of the two wrong answers: a constant would re-create the
    // never-re-report bug, and no marker at all would POST on every reload.
    mockAppVersion(null);
    await expect(reportDisplayCapabilities(OPTS)).resolves.toBe('reported');
    const marker = window.localStorage.getItem('edu_display_caps_reported');
    expect(marker).toMatch(/^screen-1\|unknown@\d{4}-\d{2}-\d{2}$/);

    (global.fetch as jest.Mock).mockClear();
    await expect(reportDisplayCapabilities(OPTS)).resolves.toBe(
      'skipped: already reported this version',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does NOT latch on a non-2xx, so a fixed server re-reports', async () => {
    // The API's zod enums rejected every real device for a while; when that
    // is fixed the fleet must self-describe without an APK release.
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400 }) as unknown as typeof fetch;
    await expect(reportDisplayCapabilities(OPTS)).resolves.toBe('failed: HTTP 400');
    expect(window.localStorage.getItem('edu_display_caps_reported')).toBeNull();
  });

  it('hands the caller this box Build identity for vendor-recipe matching', async () => {
    const onIdentity = jest.fn();
    await reportDisplayCapabilities({ ...OPTS, onIdentity });
    expect(onIdentity).toHaveBeenCalledWith({
      manufacturer: 'Goodview',
      model: 'ECBox3576',
      board: 'rk3288',
    });
  });

  it('still reports the identity when the screen already reported', async () => {
    // The recipe pick needs it on EVERY load, not only the first one.
    await reportDisplayCapabilities(OPTS);
    const onIdentity = jest.fn();
    await expect(reportDisplayCapabilities({ ...OPTS, onIdentity })).resolves.toBe(
      'skipped: already reported this version',
    );
    expect(onIdentity).toHaveBeenCalledTimes(1);
  });

  it('degrades quietly on every failure path — this is never safety-critical', async () => {
    hasMock.mockReturnValue(false);
    await expect(reportDisplayCapabilities(OPTS)).resolves.toBe('skipped: no native probe');

    hasMock.mockReturnValue(true);
    callMock.mockRejectedValue(new Error('bridge gone'));
    await expect(reportDisplayCapabilities(OPTS)).resolves.toBe('skipped: probe threw');

    callMock.mockResolvedValue('not json at all');
    await expect(reportDisplayCapabilities(OPTS)).resolves.toBe('skipped: probe not json');

    callMock.mockResolvedValue(JSON.stringify({ schema: 1, error: 'probe failed' }));
    await expect(reportDisplayCapabilities(OPTS)).resolves.toBe('skipped: probe has no verdict');
  });
});
