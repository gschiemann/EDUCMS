/**
 * Website Tabs — the ONE panel, through the real `ContentFields` switch
 * (2026-09-28).
 *
 * The 30-second happy path is "paste a URL, press Enter" and the tab fills
 * itself in. This mounts PropertiesPanel's real `case 'WEBSITE_TABS'` with a
 * tiny stateful harness (the store's `updateZone` applies the patch and
 * re-renders, as the builder does) and proves:
 *   • a paste writes a tab at once (host as the name), then the site check
 *     fills in the real name, the icon and the framing verdict;
 *   • a redirect to another host is followed into the stored URL, so what the
 *     panel checked is what the screen loads;
 *   • an operator's own name is never overwritten by a re-check;
 *   • a non-URL is refused in words, never sent to the API;
 *   • the plain-words settings write the config keys the widget reads.
 */
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ContentFields } from '../PropertiesPanel';

const siteCheck = jest.fn();
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  // The panel's AI affordances probe /ai/key on mount; keep those pending
  // (same silencer the orphan suite uses). Only the site check answers.
  apiFetch: jest.fn((path: string, init?: RequestInit) =>
    path === '/proxy/site-check' ? siteCheck(JSON.parse(String(init?.body || '{}'))) : new Promise(() => undefined),
  ),
}));

function Harness({ initial, onConfig }: { initial: Record<string, unknown>; onConfig?: (c: Record<string, unknown>) => void }) {
  const [zone, setZone] = useState({ id: 'z1', widgetType: 'WEBSITE_TABS', defaultConfig: initial });
  const updateZone = (_id: string, patch: { defaultConfig?: Record<string, unknown> }) => {
    setZone((z) => {
      const next = { ...z, defaultConfig: { ...(z.defaultConfig || {}), ...(patch.defaultConfig || {}) } };
      onConfig?.(next.defaultConfig);
      return next;
    });
  };
  return <ContentFields zone={zone} updateZone={updateZone} />;
}

beforeEach(() => {
  siteCheck.mockReset();
});

describe('WEBSITE_TABS — paste a URL, the tab fills itself in', () => {
  it('writes the tab at once, then names + icons it from the site check', async () => {
    siteCheck.mockResolvedValue({
      ok: true,
      url: 'https://district.example/',
      finalUrl: 'https://district.example/',
      name: 'Lincoln High',
      iconUrl: 'https://district.example/apple-touch-icon.png',
      embed: 'blocked',
      reason: 'x-frame-options',
    });
    const configs: Record<string, unknown>[] = [];
    render(<Harness initial={{ tabs: [] }} onConfig={(c) => configs.push(c)} />);

    fireEvent.change(screen.getByTestId('wt-paste'), { target: { value: 'district.example' } });
    fireEvent.keyDown(screen.getByTestId('wt-paste'), { key: 'Enter' });

    // Immediately: one tab named by its host, unchecked.
    const first = configs[0].tabs as Array<Record<string, unknown>>;
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ name: 'district.example', url: 'https://district.example/', embed: 'unknown' });
    expect(siteCheck).toHaveBeenCalledWith({ url: 'https://district.example/' });

    // Then: the check lands.
    await waitFor(() => expect(screen.getByTestId('wt-status')).toHaveAttribute('data-embed', 'blocked'));
    const last = configs[configs.length - 1].tabs as Array<Record<string, unknown>>;
    expect(last[0]).toMatchObject({
      name: 'Lincoln High',
      iconUrl: 'https://district.example/apple-touch-icon.png',
      embed: 'blocked',
    });
    expect(screen.getByDisplayValue('Lincoln High')).toBeInTheDocument();
    expect(screen.getByText(/Can.t preview here/)).toBeInTheDocument();
    expect(screen.getByText(/still show on screens running the VenueOS player app/)).toBeInTheDocument();
  });

  it('a redirect to another host becomes the stored URL, so the check and the screen agree', async () => {
    siteCheck.mockResolvedValue({
      ok: true,
      url: 'https://short.example/',
      finalUrl: 'https://sites.vendor.example/district/home',
      name: 'District Portal',
      iconUrl: null,
      embed: 'ok',
      reason: null,
    });
    const configs: Record<string, unknown>[] = [];
    render(<Harness initial={{ tabs: [] }} onConfig={(c) => configs.push(c)} />);
    fireEvent.change(screen.getByTestId('wt-paste'), { target: { value: 'https://short.example' } });
    fireEvent.click(screen.getByTestId('wt-add'));
    await waitFor(() => expect(screen.getByTestId('wt-status')).toHaveAttribute('data-embed', 'ok'));
    const last = configs[configs.length - 1].tabs as Array<Record<string, unknown>>;
    expect(last[0].url).toBe('https://sites.vendor.example/district/home');
  });

  it('never overwrites a name the operator typed', async () => {
    siteCheck.mockResolvedValue({ ok: true, url: 'https://lunch.example/', finalUrl: 'https://lunch.example/', name: 'Nutrislice', iconUrl: null, embed: 'ok', reason: null });
    const configs: Record<string, unknown>[] = [];
    render(<Harness initial={{ tabs: [{ id: 't1', name: 'Lunch', url: 'https://lunch.example/', embed: 'ok' }] }} onConfig={(c) => configs.push(c)} />);
    fireEvent.click(screen.getByRole('button', { name: /Check again Lunch/ }));
    await waitFor(() => expect(siteCheck).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByDisplayValue('Lunch')).toBeInTheDocument();
    expect(configs.every((c) => (c.tabs as Array<Record<string, unknown>>)[0].name === 'Lunch')).toBe(true);
  });

  it('refuses a non-URL in words and never calls the API', () => {
    render(<Harness initial={{ tabs: [] }} />);
    fireEvent.change(screen.getByTestId('wt-paste'), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByTestId('wt-add'));
    expect(screen.getByRole('alert')).toHaveTextContent("That doesn't look like a website address.");
    expect(siteCheck).not.toHaveBeenCalled();
  });

  it('checks a preset tab that was never checked, once, when the panel opens', async () => {
    siteCheck.mockResolvedValue({ ok: true, url: 'https://www.weather.gov/', finalUrl: 'https://www.weather.gov/', name: 'Weather', iconUrl: null, embed: 'ok', reason: null });
    render(<Harness initial={{ tabs: [{ id: 'w', name: 'Weather', url: 'https://www.weather.gov/', embed: 'unknown' }] }} />);
    await waitFor(() => expect(screen.getByTestId('wt-status')).toHaveAttribute('data-embed', 'ok'));
    expect(siteCheck).toHaveBeenCalledTimes(1);
  });

  it('the plain-words settings write the keys the widget reads', () => {
    const configs: Record<string, unknown>[] = [];
    render(<Harness initial={{ tabs: [{ id: 't1', name: 'A', url: 'https://a.example/', embed: 'ok' }] }} onConfig={(c) => configs.push(c)} />);
    fireEvent.change(screen.getByTestId('wt-bar-position'), { target: { value: 'bottom' } });
    fireEvent.change(screen.getByTestId('wt-idle'), { target: { value: '300' } });
    fireEvent.click(screen.getByTestId('wt-incognito'));
    const last = configs[configs.length - 1];
    expect(last).toMatchObject({ barPosition: 'bottom', idleReturnSec: 300, incognito: false });
    // The switch explains itself in the operator's words, both ways.
    expect(screen.getByTestId('wt-incognito-help')).toHaveTextContent(/OFF — for a dashboard that needs a login/);
    fireEvent.click(screen.getByTestId('wt-incognito'));
    expect(screen.getByTestId('wt-incognito-help')).toHaveTextContent(/ON — the right choice for a public kiosk/);
  });

  it('remove takes the tab out; the per-tab sign-in writes signIn', () => {
    const configs: Record<string, unknown>[] = [];
    render(
      <Harness
        initial={{
          tabs: [
            { id: 't1', name: 'A', url: 'https://a.example/', embed: 'ok' },
            { id: 't2', name: 'B', url: 'https://b.example/', embed: 'ok' },
          ],
        }}
        onConfig={(c) => configs.push(c)}
      />,
    );
    fireEvent.change(screen.getByLabelText('Sign-in — B'), { target: { value: 'once' } });
    expect((configs[configs.length - 1].tabs as Array<Record<string, unknown>>)[1].signIn).toBe('once');
    fireEvent.click(screen.getByRole('button', { name: 'Remove A' }));
    const tabs = configs[configs.length - 1].tabs as Array<Record<string, unknown>>;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe('t2');
  });
});
