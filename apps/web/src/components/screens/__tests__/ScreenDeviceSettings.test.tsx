/**
 * Render-level proof of the Android settings section (2026-10-18): what
 * actually reaches the DOM for each kind of unit, and what goes on the wire.
 * The view-model rules have their own pure test next door; this one proves
 * the panel obeys them — no control where the unit cannot set the setting,
 * the unit's own reason instead, "Android reports …" from the read-back, and
 * a passphrase that is never shown or pre-filled.
 */

import * as React from 'react';
import { act, fireEvent, render, screen as rtl, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DeviceSettingsView } from '@cms/api-types';
import { ScreenDeviceSettings } from '../ScreenDeviceSettings';

const apiFetchMock = jest.fn();
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

const NOW = Date.parse('2026-10-18T12:00:00.000Z');

const READY: DeviceSettingsView = {
  screenId: 's1',
  faceOfScreenId: null,
  revision: 4,
  desired: {
    volume: { value: 30, id: 'r4', changedAt: '2026-10-18T11:58:00.000Z' },
    screenOffTimeoutMs: { value: 2_147_483_647, id: 'r2', changedAt: '2026-10-18T10:00:00.000Z' },
  },
  report: {
    schema: 1,
    rev: 3,
    sdk: 33,
    cap: {
      brightness: 'ok',
      volume: 'ok',
      screenOffTimeoutMs: 'ok',
      attentiveTimeoutMs: 'no-secure-settings',
      rotationLock: 'ok',
      autoTime: 'no-secure-settings',
      autoTimeZone: 'no-secure-settings',
      ntpServer: 'no-secure-settings',
      wifi: 'ok',
    },
    obs: { brightness: 70, volume: 50, screenOffTimeoutMs: 2_147_483_647, rotationLock: true, ntpServer: '' },
    ack: { screenOffTimeoutMs: { id: 'r2', st: 'applied', n: 1, at: NOW - 3_600_000 } },
    load: { thermal: 2, thermalAt: NOW - 7_200_000, headroom: 0.42, cpu: 12, sysCpu: 34, memAvailMb: 812, memTotalMb: 2048, socC: 61 },
  },
  reportChangedAt: '2026-10-18T11:55:00.000Z',
  reportedAt: '2026-10-18T11:59:00.000Z',
};

function renderSection(view: unknown, props: { readOnly?: boolean } = {}) {
  apiFetchMock.mockImplementation(async (_path: string, init?: { method?: string; body?: string }) => {
    if (init?.method === 'PUT') {
      const patch = JSON.parse(init.body!);
      return { ...(view as DeviceSettingsView), changed: Object.keys(patch) };
    }
    if (view instanceof Error) throw view;
    return view;
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ScreenDeviceSettings screenId="s1" nowMs={NOW} {...props} />
    </QueryClientProvider>,
  );
}

async function open() {
  fireEvent.click(rtl.getByRole('button', { name: /Android settings/ }));
  await waitFor(() => expect(rtl.queryByText('Loading Android settings…')).not.toBeInTheDocument());
}

beforeEach(() => apiFetchMock.mockReset());

describe('ScreenDeviceSettings — what reaches the DOM', () => {
  it('is collapsed until opened, and a closed section makes no request', () => {
    renderSection(READY);
    expect(rtl.getByRole('button', { name: /Android settings/ })).toHaveAttribute('aria-expanded', 'false');
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it('shows a control only where the unit can set it, and the unit’s reason everywhere else', async () => {
    renderSection(READY);
    await open();
    expect(apiFetchMock).toHaveBeenCalledWith('/screens/s1/device-settings');
    expect(rtl.getByLabelText('Brightness')).toBeInTheDocument();
    expect(rtl.getByLabelText('Volume')).toBeInTheDocument();
    expect(rtl.getByLabelText('Screen timeout')).toBeInTheDocument();
    // No control for the three time settings: the install command was never run.
    for (const label of ['Automatic date & time', 'Automatic time zone']) {
      expect(rtl.queryByRole('combobox', { name: label })).not.toBeInTheDocument();
    }
    expect(rtl.queryByRole('textbox', { name: 'Time server' })).not.toBeInTheDocument();
    expect(rtl.getAllByText('Not possible on this unit: needs the one-time install command (adb) on this unit')).toHaveLength(4);
    expect(rtl.queryByRole('combobox', { name: 'Sleep after no remote use' })).not.toBeInTheDocument();
  });

  it('says what Android READ BACK, not what was sent', async () => {
    renderSection(READY);
    await open();
    const volume = rtl.getByTestId('device-setting-volume');
    expect(volume).toHaveTextContent('Android reports 50%');
    // Saved 30 %, not yet acknowledged by identity: honest about it.
    expect(volume).toHaveTextContent('Saved — waiting for the screen to pick it up');
    expect(rtl.getByTestId('device-setting-screenOffTimeoutMs')).toHaveTextContent('Android reports Never');
    expect(rtl.getByTestId('device-setting-screenOffTimeoutMs')).toHaveTextContent('Set on the screen');
    expect(rtl.getByTestId('device-setting-ntpServer')).toHaveTextContent('Android reports Android’s own server');
    expect(rtl.getByTestId('device-setting-autoTime')).toHaveTextContent('Android doesn’t report this value');
  });

  it('a select change stores exactly that setting', async () => {
    renderSection(READY);
    await open();
    await act(async () => {
      fireEvent.change(rtl.getByLabelText('Brightness'), { target: { value: '80' } });
    });
    const put = apiFetchMock.mock.calls.find((c) => c[1]?.method === 'PUT');
    expect(put![0]).toBe('/screens/s1/device-settings');
    expect(JSON.parse(put![1].body)).toEqual({ brightness: 80 });
    await act(async () => {
      fireEvent.change(rtl.getByLabelText('Volume'), { target: { value: '' } });
    });
    const last = apiFetchMock.mock.calls.filter((c) => c[1]?.method === 'PUT').pop();
    expect(JSON.parse(last![1].body)).toEqual({ volume: null });
  });

  it('the Wi-Fi password is write-only: never pre-filled, sent only when typed', async () => {
    const withWifi: DeviceSettingsView = {
      ...READY,
      desired: {
        ...READY.desired,
        wifi: { value: { ssid: 'Lobby', security: 'wpa2', hidden: false, passphraseSaved: true }, id: 'r3', changedAt: 'x' },
      },
    };
    renderSection(withWifi);
    await open();
    const password = rtl.getByLabelText('Password') as HTMLInputElement;
    expect(password.type).toBe('password');
    expect(password.value).toBe('');
    expect(password.placeholder).toBe('Saved — leave empty to keep it');
    // Save with the saved password: no passphrase on the wire.
    await act(async () => {
      fireEvent.click(rtl.getAllByRole('button', { name: 'Save' }).pop()!);
    });
    let put = apiFetchMock.mock.calls.filter((c) => c[1]?.method === 'PUT').pop();
    expect(JSON.parse(put![1].body)).toEqual({ wifi: { ssid: 'Lobby', security: 'wpa2', hidden: false } });
    // A new password is sent once, then the field is cleared again.
    fireEvent.change(password, { target: { value: 'correct horse' } });
    await act(async () => {
      fireEvent.click(rtl.getAllByRole('button', { name: 'Save' }).pop()!);
    });
    put = apiFetchMock.mock.calls.filter((c) => c[1]?.method === 'PUT').pop();
    expect(JSON.parse(put![1].body).wifi.passphrase).toBe('correct horse');
    expect((rtl.getByLabelText('Password') as HTMLInputElement).value).toBe('');
  });

  it('with the install grant, the inactivity sleep offers Never first and says what it is', async () => {
    const granted: DeviceSettingsView = {
      ...READY,
      report: { ...READY.report!, cap: { ...READY.report!.cap, attentiveTimeoutMs: 'ok' }, obs: { ...READY.report!.obs, attentiveTimeoutMs: 14_400_000 } },
    };
    renderSection(granted);
    await open();
    const select = rtl.getByLabelText('Sleep after no remote use') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Not managed', 'Never', '24 hours', '12 hours', '8 hours', '4 hours',
    ]);
    expect(rtl.getByTestId('device-setting-attentiveTimeoutMs')).toHaveTextContent('Android reports 4 hours');
    expect(rtl.getByTestId('device-setting-attentiveTimeoutMs')).toHaveTextContent('whatever VenueOS is showing');
    await act(async () => {
      fireEvent.change(select, { target: { value: '-1' } });
    });
    const put = apiFetchMock.mock.calls.filter((c) => c[1]?.method === 'PUT').pop();
    expect(JSON.parse(put![1].body)).toEqual({ attentiveTimeoutMs: -1 });
  });

  it('read-only roles see every value and can change none', async () => {
    renderSection(READY, { readOnly: true });
    await open();
    expect(rtl.getByLabelText('Brightness')).toBeDisabled();
    expect(rtl.getByLabelText('Volume')).toBeDisabled();
  });

  it('heat and load are facts with no controls', async () => {
    renderSection(READY);
    await open();
    const facts = rtl.getByTestId('device-load-facts');
    expect(facts).toHaveTextContent('Heat: moderate throttling');
    expect(facts).toHaveTextContent('Thermal headroom 0.42');
    expect(facts).toHaveTextContent('Chip 61 °C');
    expect(facts).toHaveTextContent('CPU: player 12% · whole device 34%');
    expect(facts).toHaveTextContent('Memory: 812 MB free of 2.0 GB');
    expect(facts.querySelector('select, input, button')).toBeNull();
  });

  it('a unit that has never reported gets an explanation, not controls', async () => {
    renderSection({ ...READY, report: null });
    await open();
    expect(rtl.getByTestId('device-settings-not-reported')).toHaveTextContent('hasn’t reported its Android settings yet');
    expect(rtl.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('an older Android unit gets one sentence', async () => {
    const cap = Object.fromEntries(Object.keys(READY.report!.cap!).map((k) => [k, 'api-level']));
    renderSection({ ...READY, report: { schema: 1, rev: 0, sdk: 30, cap } });
    await open();
    expect(rtl.getByTestId('device-settings-old-android')).toHaveTextContent('Android API level 30');
  });

  it('a role that cannot read the settings sees nothing, not an error', async () => {
    renderSection(Object.assign(new Error('Forbidden'), { status: 403 }));
    fireEvent.click(rtl.getByRole('button', { name: /Android settings/ }));
    await waitFor(() => expect(rtl.queryByText('Loading Android settings…')).not.toBeInTheDocument());
    expect(rtl.queryByRole('combobox')).not.toBeInTheDocument();
    expect(rtl.queryByRole('alert')).not.toBeInTheDocument();
  });
});
