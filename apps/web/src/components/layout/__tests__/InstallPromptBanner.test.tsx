/**
 * The install prompt is the app's only "before you're logged in and working"
 * marketing surface, and on a life-safety product what it PROMISES matters as
 * much as when it appears.
 *
 * §M03 / §2.2 (mobile design package): Web Push and background delivery do
 * not exist. Until they do, this banner must not mention them — an operator
 * who installs believing their phone will wake them for a lockdown has been
 * told something false about a safety system.
 */
import { render, screen, act } from '@testing-library/react';

jest.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }));

import { InstallPromptBanner } from '../InstallPromptBanner';
import { useUIStore } from '@/store/ui-store';

/** Put the component in the one state where it actually renders: iOS Safari,
 *  not installed, not dismissed, past its 12s warm-up. */
function renderReady() {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    configurable: true,
  });
  const r = render(<InstallPromptBanner />);
  act(() => { jest.advanceTimersByTime(13_000); });
  return r;
}

beforeEach(() => {
  jest.useFakeTimers();
  window.localStorage.clear();
  // jsdom has no matchMedia; the component asks it whether we're already
  // running standalone (installed), which must answer "no" here.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }),
  });
  act(() => { useUIStore.setState({ overlayOpenCount: 0 }); });
});
afterEach(() => { jest.useRealTimers(); });

describe('install prompt copy', () => {
  it('never promises push notifications or background delivery', () => {
    renderReady();
    const text = screen.getByRole('status').textContent || '';
    expect(text).not.toMatch(/push/i);
    expect(text).not.toMatch(/notification/i);
    expect(text).not.toMatch(/background/i);
    expect(text).not.toMatch(/offline/i);
  });

  it('uses the M03 copy', () => {
    renderReady();
    expect(screen.getByText('Install VenueOS')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      /Open VenueOS from your Home Screen for faster access and a full-screen workspace/,
    );
  });

  it('offers M03’s three actions, not one ambiguous X', () => {
    renderReady();
    expect(screen.getByRole('button', { name: /Not now/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Don.t show again/i })).toBeInTheDocument();
  });

  it('"Don’t show again" survives the 14-day snooze expiring', () => {
    const { unmount } = renderReady();
    act(() => { screen.getByRole('button', { name: /Don.t show again/i }).click(); });
    unmount();
    // A snooze written long ago would otherwise have lapsed by now.
    window.localStorage.setItem('edu_install_prompt_dismissed_at', String(Date.now() - 60 * 24 * 3600_000));
    renderReady();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('overlay lock', () => {
  /**
   * The banner sits at z-[70] — ABOVE the More sheet (z-[61]) and above every
   * bottom-anchored modal. Without this it floated over the operator's own
   * navigation. §6.2: the sheet must clear "the global tab bar and any
   * install banner".
   */
  it('gets out of the way while an overlay owns the screen', () => {
    renderReady();
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { useUIStore.setState({ overlayOpenCount: 1 }); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    act(() => { useUIStore.setState({ overlayOpenCount: 0 }); });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
