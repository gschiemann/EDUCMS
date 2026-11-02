/**
 * Broadcast banner options (2026-11-01) - colour, static / scrolling, speed,
 * auto-clear, and a preview that is the real banner component.
 */
import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

const SLUG = 'springfield-elementary';
const TENANT_UUID = '7a7f3e4e-0000-4000-8000-000000000001';

jest.mock('next/navigation', () => ({
  useParams: () => ({ schoolId: SLUG }),
  usePathname: () => `/${SLUG}/emergency/broadcast`,
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: (namespace?: string) => (key: string, vars?: Record<string, unknown>) => {
    const fullKey = namespace ? `${namespace}.${key}` : key;
    return vars ? `${fullKey} ${JSON.stringify(vars)}` : fullKey;
  },
}));
const storeState = {
  token: 'tok',
  user: { id: 'u1', email: 'admin@school.test', role: 'SCHOOL_ADMIN', tenantId: TENANT_UUID, canTriggerPanic: false },
};
jest.mock('@/store/ui-store', () => ({
  useUIStore: (selector?: (s: unknown) => unknown) => (selector ? selector(storeState) : storeState),
}));
jest.mock('@/components/emergency/EmergencyLiveRegion', () => ({
  useEmergencyAnnouncer: () => ({ announce: jest.fn(), region: null }),
}));
jest.mock('@/components/assets/AssetPicker', () => ({ AssetPicker: () => null }));
const fetchWithTimeout = jest.fn();
jest.mock('@/lib/fetch-timeout', () => ({
  fetchWithTimeout: (...args: unknown[]) => fetchWithTimeout(...args),
}));
import BroadcastPage from '../page';

const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

beforeEach(() => {
  jest.useFakeTimers();
  fetchWithTimeout.mockReset();
  fetchWithTimeout.mockImplementation(async (url: string) =>
    url.includes('/branding/me') ? jsonResponse({ palette: { primary: '#0a6cff', accent: '#e11d48' } })
      : url.includes('/emergency/targets') ? jsonResponse({ tenantId: TENANT_UUID, tenantName: 'School', allScreensCount: 2, groups: [], screens: [] })
      : url.includes('/emergency/status') ? jsonResponse({ active: [] })
      : jsonResponse({ success: true, messageId: 'bcast_1' }, 201),
  );
});
afterEach(() => { jest.useRealTimers(); });

const sendCalls = () => fetchWithTimeout.mock.calls.filter((c) => /\/emergency\/(broadcast|media-alert)$/.test(String(c[0])));
const write = (value = 'Early dismissal at 1 pm') =>
  fireEvent.change(screen.getByPlaceholderText('emergency.broadcast.messagePlaceholder'), { target: { value } });
async function holdSend() {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'emergency.broadcast.sendAria' }));
  await act(async () => { jest.advanceTimersByTime(3_100); });
  await waitFor(() => expect(sendCalls()).toHaveLength(1));
  return JSON.parse(String((sendCalls()[0][1] as RequestInit).body));
}
const bar = () => screen.getByTestId('broadcast-preview-bar');
async function mount() {
  await act(async () => { render(<BroadcastPage />); });
  await act(async () => { await Promise.resolve(); });
}

describe('Broadcast banner colour', () => {
  it('previews the standard severity colour by default and sends static text', async () => {
    await mount();
    write();
    expect(bar().style.backgroundColor).toBe('rgb(249, 115, 22)'); // WARN orange
    expect(bar().querySelector('[data-banner-text="static"]')).toBeTruthy();
    const body = await holdSend();
    expect(body.banner).toEqual({ mode: 'static', speed: 'normal' });
  });

  it('a curated colour paints the real preview with an automatic readable text colour and is sent', async () => {
    await mount();
    write();
    fireEvent.click(screen.getByTestId('banner-color-preset-green'));
    expect(bar().style.backgroundColor).toBe('rgb(21, 128, 61)');
    expect(bar().style.color).toBe('rgb(255, 255, 255)');
    const body = await holdSend();
    expect(body.banner.color).toBe('#15803d');
  });

  it('light colours get dark text', async () => {
    await mount();
    write();
    fireEvent.click(screen.getByTestId('banner-color-preset-amber'));
    expect(bar().style.color).toBe('rgb(15, 23, 42)');
  });

  it('offers the brand primary and accent when the workspace has them', async () => {
    await mount();
    await waitFor(() => expect(screen.getByTestId('banner-color-brand-primary')).toBeTruthy());
    fireEvent.click(screen.getByTestId('banner-color-brand-accent'));
    expect(bar().style.backgroundColor).toBe('rgb(225, 29, 72)');
  });

  it('a custom colour that cannot reach AA shows a warning; a good one does not', async () => {
    await mount();
    fireEvent.click(screen.getByTestId('banner-color-custom'));
    fireEvent.change(document.getElementById('banner-custom-hex') as HTMLInputElement, { target: { value: '#777777' } });
    expect(screen.getByTestId('banner-contrast').textContent).toContain('emergency.broadcast.contrastWarn');
    fireEvent.change(document.getElementById('banner-custom-hex') as HTMLInputElement, { target: { value: '#1d4ed8' } });
    expect(screen.getByTestId('banner-contrast').textContent).toContain('emergency.broadcast.contrastAuto');
  });

  it('an invalid custom hex blocks the send with a message', async () => {
    await mount();
    write();
    fireEvent.click(screen.getByTestId('banner-color-custom'));
    fireEvent.change(document.getElementById('banner-custom-hex') as HTMLInputElement, { target: { value: '#12' } });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'emergency.broadcast.sendAria' }));
    await act(async () => { jest.advanceTimersByTime(3_100); });
    expect(screen.getByRole('alert').textContent).toContain('emergency.broadcast.errBannerColor');
    expect(sendCalls()).toHaveLength(0);
  });

  it('Critical hides the style options and sends none', async () => {
    await mount();
    write();
    fireEvent.click(screen.getByLabelText('emergency.broadcast.sevCritical'));
    expect(screen.queryByTestId('banner-style')).toBeNull();
    const body = await holdSend();
    expect(body.banner).toBeUndefined();
  });
});

describe('Broadcast scrolling or static', () => {
  it('scrolling previews a marquee and sends mode + speed', async () => {
    await mount();
    write();
    expect(screen.queryByTestId('banner-speed-fast')).toBeNull();
    fireEvent.click(screen.getByTestId('banner-mode-scroll'));
    expect(bar().querySelector('[data-banner-text="scroll"]')).toBeTruthy();
    fireEvent.click(screen.getByTestId('banner-speed-fast'));
    expect(bar().querySelector('[data-banner-speed="fast"]')).toBeTruthy();
    const body = await holdSend();
    expect(body.banner).toEqual({ mode: 'scroll', speed: 'fast' });
  });
});

describe('Broadcast auto-clear', () => {
  it.each([
    ['15m', 15 * 60_000],
    ['1h', 60 * 60_000],
    ['4h', 4 * 60 * 60_000],
    ['manual', 24 * 60 * 60_000],
  ])('%s sends %d ms', async (preset, ms) => {
    await mount();
    write();
    fireEvent.click(screen.getByTestId(`duration-${preset}`));
    const body = await holdSend();
    expect(body.durationMs).toBe(ms);
  });

  it('end of day sends the time left until local midnight', async () => {
    await mount();
    write();
    fireEvent.click(screen.getByTestId('duration-eod'));
    const body = await holdSend();
    expect(body.durationMs).toBeGreaterThan(0);
    expect(body.durationMs).toBeLessThanOrEqual(24 * 60 * 60_000);
    expect(body.durationMs % 60_000).toBe(0);
  });
});
