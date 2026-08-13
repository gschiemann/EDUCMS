/**
 * Render-level proof of the capability-truth contract.
 *
 * The resolver test next door proves the LOGIC; this one proves the PANEL
 * actually obeys it — that a `reboot: none` screen really has no reboot
 * button in the DOM, not merely a `false` in a resolver object. That gap
 * is exactly where "green CI, nothing changed in the operator's UI" bugs
 * live in this repo (CLAUDE.md §9), so it gets its own assertions.
 *
 * 2026-08-13 additions:
 *  - the WIRE SHAPE is asserted here too. The panel used to post
 *    `{action:'blank'}` against an API that only accepts
 *    `z.enum(['SET_VOLUME','SET_BRIGHTNESS','BLANK','WAKE','REBOOT'])`, so
 *    every control 400'd — a 100%-failure-rate defect that no render
 *    assertion could see. Casing is now pinned by a test that reads the
 *    actual fetch body.
 *  - the NO-DEVICE-OWNER layout (reboot absent) is a first-class case, not
 *    an afterthought: it is what the entire real fleet renders.
 */

import * as React from 'react';
import { render, screen as rtl, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DISPLAY_ACTIONS } from '@cms/api-types';
import { ScreenDisplayControls } from '../ScreenDisplayControls';

const apiFetchMock = jest.fn().mockResolvedValue({ success: true });
jest.mock('@/lib/api-client', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

function renderPanel(displayCapabilities: unknown, props: { readOnly?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ScreenDisplayControls
        screen={{ id: 's1', name: 'Lobby', displayCapabilities }}
        onOpenSchedule={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
}

const CAPABLE = {
  volume: 'audiomanager',
  brightness: 'sysfs',
  screenBlank: 'device-owner',
  reboot: 'device-owner',
  deviceOwnerPath: 'held',
};

/**
 * What the ENTIRE real fleet looks like after the 2026-08-13 product
 * decision not to provision as Android device owner: no reboot, and the
 * blank path is whatever device-admin/software floor the box has.
 */
const NO_DEVICE_OWNER = {
  volume: 'audiomanager',
  brightness: 'settings',
  screenBlank: 'none',
  reboot: 'none',
  deviceOwnerPath: 'provisionable-after-factory-reset',
};

beforeEach(() => apiFetchMock.mockClear());

describe('ScreenDisplayControls — what actually reaches the DOM', () => {
  it('renders no sliders and no reboot before the screen has reported', () => {
    renderPanel(null);
    expect(rtl.queryByRole('slider')).toBeNull();
    expect(rtl.queryByRole('button', { name: /Restart device/ })).toBeNull();
    expect(rtl.getByText(/hasn’t reported what it can control/i)).toBeTruthy();
  });

  // Contract C3/C4. This REPLACES the previous "renders NO controls at all"
  // assertion, which encoded the pre-remediation reading. Blank/Wake ride an
  // unconditional software floor, and Wake is the one control that can only
  // ever make a dark screen visible — so it is never withheld pending a
  // probe. An unrecoverable dark screen is the worst outcome in this feature.
  it('still offers Blank/Wake (and the schedule) on a screen that never reported', () => {
    renderPanel(null);
    expect(rtl.getByRole('button', { name: /^Blank$/ })).toBeTruthy();
    expect(rtl.getByRole('button', { name: /^Wake$/ })).toBeTruthy();
    expect(rtl.getByRole('button', { name: /On\/off schedule/ })).toBeTruthy();
    expect(rtl.getByText(/hasn’t reported yet whether it can truly power its panel off/i))
      .toBeTruthy();
  });

  it('renders both sliders, blank/wake and reboot on a fully-capable device', () => {
    renderPanel(CAPABLE);
    expect(rtl.getAllByRole('slider')).toHaveLength(2);
    expect(rtl.getByRole('button', { name: /^Blank$/ })).toBeTruthy();
    expect(rtl.getByRole('button', { name: /^Wake$/ })).toBeTruthy();
    expect(rtl.getByRole('button', { name: /Restart device/ })).toBeTruthy();
  });

  it('omits the reboot BUTTON entirely when the probe says reboot:none, and explains why', () => {
    renderPanel({ ...CAPABLE, reboot: 'none', deviceOwnerPath: 'blocked-other-owner' });
    expect(rtl.queryByRole('button', { name: /Restart device/ })).toBeNull();
    expect(rtl.getByText(/another management app already owns this device/i)).toBeTruthy();
  });

  // The no-device-owner fleet shape, rendered end to end. Nothing may be
  // left dangling where the reboot control used to be: the explainer row
  // owns its own divider, and every other section still renders.
  it('renders cleanly with reboot absent — the whole real fleet’s layout', () => {
    const { container } = renderPanel(NO_DEVICE_OWNER);
    expect(rtl.queryByRole('button', { name: /Restart device/ })).toBeNull();
    // The reboot section is a single explanatory row, not an empty block.
    expect(rtl.getByText(/needs device-owner setup/i)).toBeTruthy();
    // Everything else survives.
    expect(rtl.getAllByRole('slider')).toHaveLength(2);
    expect(rtl.getByRole('button', { name: /^Blank$/ })).toBeTruthy();
    expect(rtl.getByRole('button', { name: /^Wake$/ })).toBeTruthy();
    expect(rtl.getByRole('button', { name: /On\/off schedule/ })).toBeTruthy();
    // No empty section: every direct child of the panel has content.
    const panel = container.firstElementChild as HTMLElement;
    Array.from(panel.children).forEach((child) => {
      expect((child.textContent ?? '').trim().length).toBeGreaterThan(0);
    });
  });

  it('omits the volume SLIDER when the device exposes no volume interface', () => {
    renderPanel({ ...CAPABLE, volume: 'none' });
    // Brightness slider survives; volume does not.
    expect(rtl.getAllByRole('slider')).toHaveLength(1);
    expect(rtl.getByText(/exposes no volume interface/i)).toBeTruthy();
  });

  it('keeps the brightness slider on a software-dim box but says it dims the image only', () => {
    renderPanel({ ...CAPABLE, brightness: 'software-dim' });
    expect(rtl.getByLabelText(/Brightness \(image only\)/)).toBeTruthy();
    expect(
      rtl.getByText(/Dims the image only — this box exposes no backlight control/i),
    ).toBeTruthy();
  });

  it('says the backlight stays lit when the device cannot truly power the panel off', () => {
    renderPanel({ ...CAPABLE, screenBlank: 'none' });
    expect(rtl.getByRole('button', { name: /^Blank$/ })).toBeTruthy();
    expect(rtl.getByText(/backlight stays lit/i)).toBeTruthy();
  });

  it('hedges the device-admin blank claim instead of promising a hardware off', () => {
    renderPanel({ ...CAPABLE, screenBlank: 'device-admin' });
    expect(rtl.getByText(/if that admin isn’t our player/i)).toBeTruthy();
    expect(rtl.queryByText(/^Truly turns the screen off\./)).toBeNull();
  });

  it('never offers a brightness below the safe floor', () => {
    renderPanel(CAPABLE);
    const brightness = rtl.getByLabelText('Brightness') as HTMLInputElement;
    expect(Number(brightness.min)).toBeGreaterThanOrEqual(5);
  });

  it('promises the blank auto-wakes rather than claiming an observed screen state', () => {
    renderPanel(CAPABLE);
    expect(rtl.getByText(/Wakes itself after 10 min/i)).toBeTruthy();
  });

  // With no device-echoed level the thumb used to park at 50% on a screen
  // that might be at 100%; a "small trim" then sent an absolute 49%.
  it('parks an unknown level where a blind nudge is recoverable, and says so', () => {
    renderPanel(CAPABLE);
    const brightness = rtl.getByLabelText('Brightness') as HTMLInputElement;
    const volume = rtl.getByLabelText('Volume') as HTMLInputElement;
    // Darkness is not recoverable; silence is.
    expect(Number(brightness.value)).toBe(100);
    expect(Number(volume.value)).toBe(0);
    expect(rtl.getAllByText(/doesn’t report its current level/i).length).toBeGreaterThan(0);
  });

  it('renders every control inert for a role that cannot drive display control', () => {
    renderPanel(CAPABLE, { readOnly: true });
    rtl.getAllByRole('slider').forEach((s) => expect(s).toBeDisabled());
    expect(rtl.getByRole('button', { name: /^Blank$/ })).toBeDisabled();
    expect(rtl.getByRole('button', { name: /^Wake$/ })).toBeDisabled();
    expect(rtl.getByRole('button', { name: /Restart device/ })).toBeDisabled();
  });
});

describe('ScreenDisplayControls — the wire shape (contract C1)', () => {
  it('posts SCREAMING_CASE actions the API’s z.enum actually accepts', async () => {
    renderPanel(CAPABLE);
    await act(async () => {
      fireEvent.click(rtl.getByRole('button', { name: /^Blank$/ }));
    });
    expect(apiFetchMock).toHaveBeenCalled();

    const [path, init] = apiFetchMock.mock.calls[0];
    expect(path).toBe('/screens/s1/display-control');
    const body = JSON.parse(init.body);
    expect(body.action).toBe('BLANK');
    expect(DISPLAY_ACTIONS).toContain(body.action);
    // Operator-initiated blank always carries a dead-man revert.
    expect(body.revertAfterMs).toBe(10 * 60_000);
  });

  it('posts WAKE, not "wake"', async () => {
    renderPanel(CAPABLE);
    await act(async () => {
      fireEvent.click(rtl.getByRole('button', { name: /^Wake$/ }));
    });
    const body = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    expect(body.action).toBe('WAKE');
    expect(DISPLAY_ACTIONS).toContain(body.action);
  });

  it('posts SET_BRIGHTNESS with the clamped percent', async () => {
    renderPanel(CAPABLE);
    const brightness = rtl.getByLabelText('Brightness') as HTMLInputElement;
    fireEvent.change(brightness, { target: { value: '1' } });
    await act(async () => {
      fireEvent.blur(brightness);
    });
    const body = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    expect(body.action).toBe('SET_BRIGHTNESS');
    expect(DISPLAY_ACTIONS).toContain(body.action);
    // A remote 0-ish % on a screen nobody can reach is a truck roll.
    expect(body.percent).toBe(5);
  });

  it('posts SET_VOLUME, not "volume"', async () => {
    renderPanel(CAPABLE);
    const volume = rtl.getByLabelText('Volume') as HTMLInputElement;
    fireEvent.change(volume, { target: { value: '30' } });
    await act(async () => {
      fireEvent.blur(volume);
    });
    const body = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    expect(body.action).toBe('SET_VOLUME');
    expect(body.percent).toBe(30);
  });

  // Wake is the recovery control for Blank. Gating it on the action it
  // recovers from is how a wedged API leaves a dark screen dark.
  it('leaves Wake enabled while a Blank is still in flight', async () => {
    let release: (v: unknown) => void = () => {};
    apiFetchMock.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    renderPanel(CAPABLE);
    await act(async () => {
      fireEvent.click(rtl.getByRole('button', { name: /^Blank$/ }));
    });
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(rtl.getByRole('button', { name: /^Blank$/ })).toBeDisabled();
    expect(rtl.getByRole('button', { name: /^Wake$/ })).not.toBeDisabled();
    await act(async () => {
      release({ success: true });
    });
  });
});
