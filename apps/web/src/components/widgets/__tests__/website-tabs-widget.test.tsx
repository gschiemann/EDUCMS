/**
 * Website Tabs — the widget, mounted through the real `WidgetPreview` path
 * (2026-09-28).
 *
 * Three surfaces, each asserted:
 *   • BUILDER — the preview card, the honest status line, "Paste your first
 *     website" when empty, and NEVER a live iframe on the canvas.
 *   • BROWSER PLAYER — one sandboxed iframe per site with no way to leave the
 *     kiosk (no `allow-top-navigation`, no `allow-popups`), the honest card
 *     for a site that blocks framing, a tap switches tabs, Home reloads the
 *     first site, and the idle warning → return runs on the configured clock.
 *   • OUR APP — with an APK that advertises `webTabsShow`, the widget hands
 *     the native side the URL, the measured device-pixel bounds and the
 *     default-deny allowlist, and takes it down (signing out when incognito)
 *     on unmount. Nothing is posted to an APK that does not advertise it.
 *
 * Remote-operable (rule 15): focus parks on the active tab and Left/Right
 * move it.
 */
import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { WidgetPreview } from '../WidgetRenderer';

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

const TABS = {
  tabs: [
    { id: 'a', name: 'District', url: 'https://www.district.example/', embed: 'ok' },
    { id: 'b', name: 'Lunch', url: 'https://lunch.example/menu', embed: 'ok' },
    { id: 'c', name: 'Google', url: 'https://www.google.com/', embed: 'blocked' },
  ],
  barPosition: 'top',
  showHome: true,
  idleReturnSec: 3,
  idleWarnSec: 1,
  incognito: true,
};

function mount(config: Record<string, unknown>, live: boolean) {
  return render(
    <div style={{ position: 'relative', width: 800, height: 600 }}>
      <WidgetPreview widgetType="WEBSITE_TABS" config={config} width={100} height={100} live={live} {...(live ? { renderSurface: 'player' as const } : {})} />
    </div>,
  );
}

const w = () => window as unknown as Record<string, unknown>;

afterEach(() => {
  cleanup();
  delete w().EduCmsNativeChannel;
  delete w().__eduCmsNativeChannelMethods;
  jest.useRealTimers();
});

describe('builder surface', () => {
  it('names the next action when there are no tabs, and mounts no iframe', () => {
    mount({ tabs: [] }, false);
    expect(screen.getByText('Paste your first website')).toBeInTheDocument();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('shows a preview card with the honest status, never a live frame', () => {
    mount(TABS, false);
    expect(screen.getByTestId('website-tabs-preview')).toBeInTheDocument();
    expect(screen.getByTestId('website-tabs-status')).toHaveAttribute('data-embed', 'ok');
    expect(document.querySelector('iframe')).toBeNull();
    fireEvent.click(screen.getByTestId('website-tab-c'));
    expect(screen.getByTestId('website-tabs-status')).toHaveTextContent(/Can.t preview here/);
  });
});

describe('browser player (no native bridge)', () => {
  it('renders the first site in a sandboxed frame that cannot leave the kiosk', () => {
    mount(TABS, true);
    const frame = screen.getByTestId('website-tabs-frame') as HTMLIFrameElement;
    expect(frame.getAttribute('src')).toBe('https://www.district.example/');
    const sandbox = frame.getAttribute('sandbox') || '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).toContain('allow-same-origin');
    expect(sandbox).toContain('allow-forms');
    expect(sandbox).not.toContain('allow-top-navigation');
    expect(sandbox).not.toContain('allow-popups');
    expect(sandbox).not.toContain('allow-downloads');
  });

  it('a tap switches the frame; a site that blocks framing gets the honest card', () => {
    mount(TABS, true);
    fireEvent.click(screen.getByTestId('website-tab-b'));
    expect((screen.getByTestId('website-tabs-frame') as HTMLIFrameElement).getAttribute('src')).toBe('https://lunch.example/menu');
    expect(screen.getByTestId('website-tab-b')).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByTestId('website-tab-c'));
    expect(screen.queryByTestId('website-tabs-frame')).toBeNull();
    expect(screen.getByTestId('website-tabs-blocked')).toHaveTextContent('This site can only be shown on screens running the VenueOS app');
  });

  it('Home returns to the first site', () => {
    mount(TABS, true);
    fireEvent.click(screen.getByTestId('website-tab-c'));
    fireEvent.click(screen.getByTestId('website-tabs-home'));
    expect(screen.getByTestId('website-tab-a')).toHaveAttribute('aria-selected', 'true');
    expect((screen.getByTestId('website-tabs-frame') as HTMLIFrameElement).getAttribute('src')).toBe('https://www.district.example/');
  });

  it('warns "Still there?" then returns to the first site on the configured clock', () => {
    jest.useFakeTimers();
    mount(TABS, true);
    fireEvent.click(screen.getByTestId('website-tab-b')); // activity + away from home
    act(() => {
      jest.advanceTimersByTime(2_000);
    });
    expect(screen.getByTestId('website-tabs-idle-warning')).toBeInTheDocument();
    expect(screen.getByText('Still there?')).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(screen.queryByTestId('website-tabs-idle-warning')).toBeNull();
    expect(screen.getByTestId('website-tab-a')).toHaveAttribute('aria-selected', 'true');
  });

  it('"Yes, I\'m here" cancels the return and keeps the current site', () => {
    jest.useFakeTimers();
    mount(TABS, true);
    fireEvent.click(screen.getByTestId('website-tab-b'));
    act(() => {
      jest.advanceTimersByTime(2_000);
    });
    fireEvent.click(screen.getByTestId('website-tabs-still-here'));
    expect(screen.queryByTestId('website-tabs-idle-warning')).toBeNull();
    act(() => {
      jest.advanceTimersByTime(1_500);
    });
    expect(screen.getByTestId('website-tab-b')).toHaveAttribute('aria-selected', 'true');
  });

  it('focus left inside the site frame does not keep a walked-away kiosk from going back', () => {
    jest.useFakeTimers();
    // Longer than the old 5 s "focus is still in the frame" tick, which kept
    // an abandoned kiosk on its site (and its sign-in) forever.
    mount({ ...TABS, idleReturnSec: 12 }, true);
    fireEvent.click(screen.getByTestId('website-tab-b'));
    // The visitor tapped into the site (focus moved to the frame), then left.
    const frame = screen.getByTestId('website-tabs-frame') as HTMLIFrameElement;
    frame.focus();
    act(() => {
      window.dispatchEvent(new Event('blur'));
      jest.advanceTimersByTime(12_500);
    });
    expect(screen.getByTestId('website-tab-a')).toHaveAttribute('aria-selected', 'true');
  });

  it('the "needs the app" card in a plain browser says install, not update', () => {
    mount(TABS, true);
    fireEvent.click(screen.getByTestId('website-tab-c'));
    expect(screen.getByTestId('website-tabs-blocked').querySelector('[data-reason]')).toHaveAttribute('data-reason', 'needs-app');
  });

  it('an untouched kiosk on Home never flashes the warning', () => {
    jest.useFakeTimers();
    mount(TABS, true);
    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(screen.queryByTestId('website-tabs-idle-warning')).toBeNull();
  });

  it('parks focus on the active tab and Left/Right move it (remote-operable)', () => {
    mount(TABS, true);
    const a = screen.getByTestId('website-tab-a');
    expect(document.activeElement).toBe(a);
    fireEvent.keyDown(a, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByTestId('website-tab-b'));
    fireEvent.keyDown(screen.getByTestId('website-tab-b'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(a);
    // …and wraps from Home leftwards onto the last tab.
    fireEvent.keyDown(a, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByTestId('website-tabs-home'));
    fireEvent.keyDown(screen.getByTestId('website-tabs-home'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByTestId('website-tab-c'));
  });

  it('a live screen with no tabs holds its zone and says nothing', () => {
    mount({ tabs: [] }, true);
    expect(screen.getByTestId('website-tabs')).toHaveAttribute('data-empty', '1');
    expect(screen.queryByText('Paste your first website')).toBeNull();
  });

  it('renders the Spanish glass copy when the config pins es', () => {
    mount({ ...TABS, lang: 'es' }, true);
    fireEvent.click(screen.getByTestId('website-tab-c'));
    expect(screen.getByTestId('website-tabs-blocked')).toHaveTextContent('Este sitio solo puede mostrarse');
    expect(screen.getByTestId('website-tabs-home')).toHaveTextContent('Inicio');
  });
});

describe('our app (native channel advertising the methods)', () => {
  let posted: string[];
  const install = (methods: string[]) => {
    posted = [];
    w().EduCmsNativeChannel = { postMessage: (m: string) => posted.push(m) };
    w().__eduCmsNativeChannelMethods = methods;
  };
  const originalRect = Element.prototype.getBoundingClientRect;
  beforeEach(() => {
    Element.prototype.getBoundingClientRect = function () {
      return { left: 0, top: 80, width: 800, height: 520, right: 800, bottom: 600, x: 0, y: 80, toJSON() {} } as DOMRect;
    };
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
  });
  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalRect;
  });

  const calls = (method: string) =>
    posted.map((p) => JSON.parse(p) as { method: string; args: unknown[] }).filter((m) => m.method === method);

  it('posts webTabsShow with the URL, device-pixel bounds and the default-deny allowlist; no iframe', () => {
    install(['webTabsShow', 'webTabsHide', 'heartbeat']);
    mount(TABS, true);
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.getByTestId('website-tabs-content')).toHaveAttribute('data-native', '1');
    const shows = calls('webTabsShow');
    expect(shows.length).toBeGreaterThanOrEqual(1);
    const payload = JSON.parse(String(shows[shows.length - 1].args[0]));
    expect(payload).toMatchObject({
      v: 1,
      url: 'https://www.district.example/',
      bounds: { left: 0, top: 160, width: 1600, height: 1040 },
      allowHosts: ['district.example', 'lunch.example', 'google.com'],
      incognito: true,
      focus: false,
    });
    expect(payload.copy.title).toBe('This kiosk only shows these sites');
  });

  it('a tap re-shows with the new URL; unmount hides and signs out (incognito)', () => {
    install(['webTabsShow', 'webTabsHide']);
    const r = mount(TABS, true);
    fireEvent.click(screen.getByTestId('website-tab-b'));
    const last = JSON.parse(String(calls('webTabsShow').slice(-1)[0].args[0]));
    expect(last.url).toBe('https://lunch.example/menu');
    r.unmount();
    const hides = calls('webTabsHide');
    expect(hides).toHaveLength(1);
    expect(JSON.parse(String(hides[0].args[0]))).toEqual({ v: 1, wipe: true });
  });

  it('a blocked-embed tab is still shown natively (the WebView is not subject to X-Frame-Options)', () => {
    install(['webTabsShow', 'webTabsHide']);
    mount(TABS, true);
    fireEvent.click(screen.getByTestId('website-tab-c'));
    expect(screen.queryByTestId('website-tabs-blocked')).toBeNull();
    expect(JSON.parse(String(calls('webTabsShow').slice(-1)[0].args[0])).url).toBe('https://www.google.com/');
  });

  it('Down from a top tab bar hands the site Android focus', () => {
    install(['webTabsShow', 'webTabsHide']);
    mount(TABS, true);
    fireEvent.keyDown(screen.getByTestId('website-tab-a'), { key: 'ArrowDown' });
    expect(JSON.parse(String(calls('webTabsShow').slice(-1)[0].args[0])).focus).toBe(true);
  });

  it('an older APK (our app, no native site view) says UPDATE the app, not install it', () => {
    install(['heartbeat', 'showUrlOverlay']);
    mount(TABS, true);
    fireEvent.click(screen.getByTestId('website-tab-c'));
    const card = screen.getByTestId('website-tabs-blocked');
    expect(card.querySelector('[data-reason]')).toHaveAttribute('data-reason', 'app-update');
    expect(card).toHaveTextContent('This site needs the newest VenueOS app');
  });

  it('the "Still there?" warning rides over the tab bar, where the native site view cannot cover it', () => {
    jest.useFakeTimers();
    install(['webTabsShow', 'webTabsHide']);
    mount(TABS, true);
    fireEvent.click(screen.getByTestId('website-tab-b'));
    act(() => {
      jest.advanceTimersByTime(2_000);
    });
    const warning = screen.getByTestId('website-tabs-idle-warning');
    expect(warning).toHaveAttribute('data-placement', 'bar');
    expect(screen.getByTestId('website-tabs-content').contains(warning)).toBe(false);
  });

  it('a touch inside the native site (relayed by the APK) keeps the visitor on their site', () => {
    jest.useFakeTimers();
    install(['webTabsShow', 'webTabsHide']);
    mount(TABS, true);
    fireEvent.click(screen.getByTestId('website-tab-b'));
    for (let i = 0; i < 4; i++) {
      act(() => {
        jest.advanceTimersByTime(1_500);
        window.dispatchEvent(new CustomEvent('edu:webtabs-activity'));
      });
    }
    expect(screen.queryByTestId('website-tabs-idle-warning')).toBeNull();
    expect(screen.getByTestId('website-tab-b')).toHaveAttribute('aria-selected', 'true');
  });

  it('an APK that does not advertise the methods gets the iframe fallback and no webTabs post', () => {
    install(['heartbeat', 'showUrlOverlay']);
    mount(TABS, true);
    expect(screen.getByTestId('website-tabs-frame')).toBeInTheDocument();
    expect(calls('webTabsShow')).toHaveLength(0);
  });
});
