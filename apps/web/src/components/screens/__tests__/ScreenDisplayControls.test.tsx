/**
 * Render-level proof of the capability-truth contract.
 *
 * The resolver test next door proves the LOGIC; this one proves the PANEL
 * actually obeys it — that a `reboot: none` screen really has no reboot
 * button in the DOM, not merely a `false` in a resolver object. That gap
 * is exactly where "green CI, nothing changed in the operator's UI" bugs
 * live in this repo (CLAUDE.md §9), so it gets its own assertions.
 */

import * as React from 'react';
import { render, screen as rtl } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScreenDisplayControls } from '../ScreenDisplayControls';

function renderPanel(displayCapabilities: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ScreenDisplayControls
        screen={{ id: 's1', name: 'Lobby', displayCapabilities }}
        onOpenSchedule={() => {}}
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

describe('ScreenDisplayControls — what actually reaches the DOM', () => {
  it('renders NO controls at all before the screen has reported', () => {
    renderPanel(null);
    expect(rtl.queryByRole('slider')).toBeNull();
    expect(rtl.queryByRole('button')).toBeNull();
    expect(rtl.getByText(/hasn’t reported what it can control/i)).toBeTruthy();
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

  it('never offers a brightness below the safe floor', () => {
    renderPanel(CAPABLE);
    const brightness = rtl.getByLabelText('Brightness') as HTMLInputElement;
    expect(Number(brightness.min)).toBeGreaterThanOrEqual(5);
  });

  it('promises the blank auto-wakes rather than claiming an observed screen state', () => {
    renderPanel(CAPABLE);
    expect(rtl.getByText(/Wakes itself after 10 min/i)).toBeTruthy();
  });

  it('renders every control inert for a read-only viewer', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ScreenDisplayControls
          screen={{ id: 's1', name: 'Lobby', displayCapabilities: CAPABLE }}
          readOnly
          onOpenSchedule={() => {}}
        />
      </QueryClientProvider>,
    );
    rtl.getAllByRole('slider').forEach((s) => expect(s).toBeDisabled());
    expect(rtl.getByRole('button', { name: /^Blank$/ })).toBeDisabled();
    expect(rtl.getByRole('button', { name: /Restart device/ })).toBeDisabled();
  });
});
