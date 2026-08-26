/**
 * The in-editor media connect flow.
 *
 * The operator is looking at a board that reads SOURCE NOT CONFIGURED.
 * The fix has to be reachable from where they are standing — which is
 * the claim these tests hold to: the picker lists their sources, the
 * connect form is right here (not a link to Settings), and connecting
 * binds the board.
 *
 * They also hold the 2026-08-25 ruling on everything we CAN'T connect.
 * The old disclosure ("11 sources we can't connect — and why") explained
 * our own missing plumbing to a customer, one paragraph per provider.
 * Operator: *"wtf are we doing saying why we dont have something."* The
 * replacement is a three-way split — a permanent no is not shown at all,
 * and everything else is "coming soon", grouped by WHY it is coming
 * rather than by what we lack. The connectable set is unchanged, and one
 * test below pins it to the API's own accept rules so it cannot drift.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MediaSourcePicker, dispositionOf } from '../MediaSourcePicker';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const PROVIDERS = [
  { id: 'custom-hls', name: 'My own video stream', category: 'custom', integrationTier: 'DIRECT',
    blurb: 'Your own licensed HLS feed.', auth: 'customHls', commercialUseLegal: true },
  { id: 'soundtrack', name: 'Soundtrack', category: 'music', integrationTier: 'PARTNER',
    blurb: 'Licensed business audio.', auth: 'apiKey', commercialUseLegal: true },
  { id: 'youtube', name: 'YouTube', category: 'live-platform', integrationTier: 'CLOSED',
    blurb: 'Blocked.', auth: 'iframeOnly', commercialUseLegal: false },
  { id: 'atmosphere', name: 'Atmosphere TV', category: 'venue-fast', integrationTier: 'CLOSED',
    blurb: 'Licensed business TV.', auth: 'none', commercialUseLegal: true, runsOnProviderDevice: true,
    tierReason: 'Atmosphere uses its own managed player.' },
  { id: 'rockbot', name: 'Rockbot', category: 'music', integrationTier: 'PARTNER',
    blurb: 'Gym music.', auth: 'oauth2', commercialUseLegal: true },
  { id: 'iptv-m3u', name: 'IPTV M3U Playlist', category: 'custom', integrationTier: 'CLOSED',
    blurb: 'Multi-channel playlist upload.', auth: 'customHls', commercialUseLegal: true },
];

const CONNECTIONS = [
  { id: 'c-video', providerId: 'custom-hls', providerName: 'My own video stream',
    displayName: 'Cardio floor feed', status: 'ACTIVE', mediaRole: 'RENDERS', isMusic: false },
  { id: 'c-music', providerId: 'soundtrack', providerName: 'Soundtrack',
    status: 'PENDING', mediaRole: 'PENDING_ADAPTER', isMusic: true },
];

function mountPicker(cfg: Record<string, unknown> = {}) {
  const setField = jest.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MediaSourcePicker cfg={cfg} setField={setField} />
    </QueryClientProvider>,
  );
  return { setField };
}

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string) => {
    if (path === '/streaming/providers') return Promise.resolve(PROVIDERS);
    if (path === '/streaming/connections') return Promise.resolve(CONNECTIONS);
    return Promise.resolve({});
  });
});

it('separates the video slot from the music slot by what the source IS', async () => {
  mountPicker();
  await waitFor(() => expect(screen.getByText('Program video')).toBeInTheDocument());
  expect(screen.getByText('Business music')).toBeInTheDocument();

  const selects = screen.getAllByRole('combobox');
  // The video slot offers the video feed and NOT the music service.
  expect(selects[0].textContent).toContain('Cardio floor feed');
  expect(selects[0].textContent).not.toContain('Soundtrack');
  expect(selects[1].textContent).toContain('Soundtrack');
});

it('tells the operator what an unconnected board will actually show', async () => {
  mountPicker();
  await waitFor(() => expect(screen.getByText('Program video')).toBeInTheDocument());
  expect(screen.getByText(/SOURCE NOT CONFIGURED/)).toBeInTheDocument();
});

it('a bound verified feed says a live claim is possible; a pending adapter says it is not', async () => {
  mountPicker({ mediaSource: { programConnectionId: 'c-video', musicConnectionId: 'c-music' } });
  await waitFor(() => expect(screen.getByText('Verified')).toBeInTheDocument());
  expect(screen.getByText(/shows LIVE once the screen reports it playing/)).toBeInTheDocument();

  expect(screen.getByText('Adapter pending')).toBeInTheDocument();
  expect(screen.getByText(/cannot drive the screen yet/)).toBeInTheDocument();
});

it('offers the connect form inline — not a link to Settings', async () => {
  mountPicker();
  await waitFor(() => expect(screen.getAllByText('Connect a source').length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByText('Connect a source')[0]);

  await waitFor(() => expect(screen.getByText('Connect a media source')).toBeInTheDocument());
  // The one source that actually plays today is offered.
  expect(screen.getByText('My own video stream')).toBeInTheDocument();
  // No navigation away from the board.
  expect(document.querySelectorAll('a[href*="settings"]')).toHaveLength(0);
});

async function openConnectSheet() {
  await waitFor(() => expect(screen.getAllByText('Connect a source').length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByText('Connect a source')[0]);
  await waitFor(() => expect(screen.getByText('Connect a media source')).toBeInTheDocument());
}

it('a source their terms will never allow is not in the picker at all', async () => {
  mountPicker();
  await openConnectSheet();

  // YouTube's consumer terms forbid business playback. That never becomes
  // connectable, so advertising it — with or without a reason — helps nobody.
  expect(screen.queryByText('YouTube')).not.toBeInTheDocument();
  // And the old shame list is gone with it.
  expect(screen.queryByText(/sources we can’t connect/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/A consumer subscription is not a venue license/)).not.toBeInTheDocument();
});

it('a real service we have not finished wiring reads “coming soon”, not “blocked”', async () => {
  mountPicker();
  await openConnectSheet();

  expect(screen.getByText('Coming soon')).toBeInTheDocument();
  // Rockbot (OAuth unfinished) and IPTV M3U (no playlist parser yet).
  expect(screen.getByText('Rockbot')).toBeInTheDocument();
  expect(screen.getByText('IPTV M3U Playlist')).toBeInTheDocument();
  expect(screen.getByText(/They’ll move up to the list above when they’re ready/)).toBeInTheDocument();
  // Listed, not offered — no Connect affordance for them.
  expect(screen.queryByRole('button', { name: /^Rockbot/ })).not.toBeInTheDocument();
});

it('a provider that ships its own player is framed as one — and does not claim a switch we cannot do', async () => {
  mountPicker();
  await openConnectSheet();

  expect(screen.getByText('Runs on its own box')).toBeInTheDocument();
  expect(screen.getByText('Atmosphere TV')).toBeInTheDocument();
  // Forward-looking about the input switch, explicit that it is not ready.
  expect(screen.getByText(/hands the screen over to it on a schedule/)).toBeInTheDocument();
  expect(screen.getByText(/isn’t ready yet, so nothing here connects today/)).toBeInTheDocument();
  // No paragraph about our missing adapter.
  expect(screen.queryByText(/Atmosphere uses its own managed player/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Atmosphere TV/ })).not.toBeInTheDocument();
});

it('the connectable set still matches exactly what the API will accept', () => {
  // StreamingService.createConnection throws on !commercialUseLegal (403),
  // on integrationTier CLOSED (403) and on auth oauth2 (400). Offering
  // anything else would be a save that fails — the presentation changed,
  // the enforcement did not.
  for (const p of PROVIDERS) {
    const apiWouldAccept =
      p.commercialUseLegal && p.integrationTier !== 'CLOSED' && p.auth !== 'oauth2';
    expect(dispositionOf(p as never) === 'connectable').toBe(apiWouldAccept);
  }
  // And the buckets partition the catalog with nothing left over.
  const seen = PROVIDERS.map((p) => dispositionOf(p as never));
  expect(seen.filter((d) => d === 'connectable')).toHaveLength(2);   // custom-hls, soundtrack
  expect(seen.filter((d) => d === 'not-offered')).toHaveLength(1);   // youtube
  expect(seen.filter((d) => d === 'own-box')).toHaveLength(1);       // atmosphere
  expect(seen.filter((d) => d === 'coming-soon')).toHaveLength(2);   // rockbot, iptv-m3u
});

it('connecting binds the board, and a music service binds to the music slot even from the video slot', async () => {
  apiFetch.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/streaming/providers') return Promise.resolve(PROVIDERS);
    if (path === '/streaming/connections' && !init?.method) {
      return Promise.resolve([...CONNECTIONS,
        { id: 'c-new', providerId: 'soundtrack', providerName: 'Soundtrack',
          status: 'PENDING', mediaRole: 'PENDING_ADAPTER', isMusic: true }]);
    }
    if (path === '/streaming/connections') return Promise.resolve({ id: 'c-new' });
    return Promise.resolve({});
  });
  const { setField } = mountPicker();
  await waitFor(() => expect(screen.getAllByText('Connect a source').length).toBeGreaterThan(0));
  // Open from the VIDEO slot deliberately.
  fireEvent.click(screen.getAllByText('Connect a source')[0]);
  await waitFor(() => expect(screen.getByText('Soundtrack')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Soundtrack'));

  fireEvent.change(screen.getByPlaceholderText(/API key/), { target: { value: 'k' } });
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

  await waitFor(() => expect(setField).toHaveBeenCalled());
  // Bound as MUSIC, because that is what the source is.
  expect(setField).toHaveBeenCalledWith({ mediaSource: { musicConnectionId: 'c-new' } });
});
