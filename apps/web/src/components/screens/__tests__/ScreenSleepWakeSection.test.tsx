/**
 * Render-level proof of the Sleep & wake section's honesty rules: what the
 * operator READS for a real screen state, in the real English catalog.
 */
import * as React from 'react';
import { render, screen as rtl } from '@testing-library/react';
import { ScreenSleepWakeSection } from '../ScreenSleepWakeSection';

const NOW = Date.parse('2026-10-11T18:00:00.000Z');

const base = {
  playerVersion: '1.1.24',
  displayCapabilities: { schema: 1, build: { release: '13' }, verdict: { screenBlank: 'device-admin' } },
  nativeRuntimeReport: {
    schema: 1,
    interactive: true,
    foreground: true,
    standbySinceMs: null,
    elapsedRealtimeMs: 1,
    powerOnAck: null,
  },
  nativeRuntimeReportAt: new Date(NOW - 20_000).toISOString(),
  nativePowerOnAt: null,
};

describe('<ScreenSleepWakeSection />', () => {
  it('an Android 13 device-admin screen: real off, every path, on now', () => {
    render(<ScreenSleepWakeSection screen={base} nowMs={NOW} />);
    expect(rtl.getByText('Android 13')).toBeTruthy();
    expect(rtl.getByTestId('sleep-wake-mechanism').textContent).toBe('Turns the panel off for real (Android lock).');
    expect(rtl.getByTestId('sleep-wake-now').textContent).toBe('On now: Android reports the panel on.');
    expect(rtl.getAllByText('Yes')).toHaveLength(3);
  });

  it('a black-only screen never claims off, and says the backlight stays on', () => {
    render(
      <ScreenSleepWakeSection
        screen={{ ...base, displayCapabilities: { schema: 1, build: {}, verdict: { screenBlank: 'software-dim' } } }}
        nowMs={NOW}
      />,
    );
    const text = rtl.getByTestId('sleep-wake-section').textContent ?? '';
    expect(text).toContain('Can only cover the screen with black. The backlight stays on.');
    expect(text).toContain('They never cut power.');
    expect(text).not.toMatch(/turned off \(seen\)/);
  });

  it('an old player is told which version it needs', () => {
    render(<ScreenSleepWakeSection screen={{ ...base, playerVersion: '1.1.20' }} nowMs={NOW} />);
    expect(rtl.getByText('Needs player 1.1.22+')).toBeTruthy();
    expect(rtl.getByText('Needs player 1.1.24+')).toBeTruthy();
    expect(rtl.getByText('Needs player 1.1.23+')).toBeTruthy();
  });

  it('a Turn panel on the player never confirmed is said so, after the wait window', () => {
    render(
      <ScreenSleepWakeSection
        screen={{ ...base, nativePowerOnAt: new Date(NOW - 2 * 86_400_000).toISOString() }}
        nowMs={NOW}
      />,
    );
    expect(rtl.getByTestId('sleep-wake-proof').textContent).toMatch(/not confirmed by the player/);
  });

  it('shows the after-alert restore evidence with its reason', () => {
    render(
      <ScreenSleepWakeSection
        screen={{
          ...base,
          playerVersion: '1.1.25',
          nativeRuntimeReport: {
            ...base.nativeRuntimeReport,
            interactive: false,
            standbySinceMs: NOW - 600_000,
            sleep: {
              blank: 'device-admin',
              last: { m: 'device-admin', o: 'off', at: NOW - 600_000 },
              restore: { d: 'RESTORE', o: 'off', at: NOW - 600_000 },
            },
          },
        }}
        nowMs={NOW}
      />,
    );
    const proof = rtl.getByTestId('sleep-wake-proof').textContent ?? '';
    expect(proof).toMatch(/Last turn-off: turned off \(seen\)/);
    expect(proof).toMatch(/Last all-clear: turned off \(seen\), because it was off before the alert/);
    expect(rtl.getByTestId('sleep-wake-now').textContent).toMatch(/^Asleep now: Android reports the panel off since /);
  });

  it('renders nothing without a screen', () => {
    const { container } = render(<ScreenSleepWakeSection screen={null} nowMs={NOW} />);
    expect(container.textContent).toBe('');
  });
});
