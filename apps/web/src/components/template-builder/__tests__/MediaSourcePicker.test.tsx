/**
 * The in-editor media connect flow.
 *
 * The operator is looking at a board that reads SOURCE NOT CONFIGURED.
 * The fix has to be reachable from where they are standing — which is
 * the claim these tests hold to: the picker lists their sources, the
 * connect form is right here (not a link to Settings), a source that
 * cannot lawfully play is shown WITH ITS REASON rather than silently
 * missing, and connecting binds the board.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MediaSourcePicker } from '../MediaSourcePicker';

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
    blurb: 'Licensed business TV.', auth: 'none', commercialUseLegal: true,
    tierReason: 'Atmosphere uses its own managed player.' },
  { id: 'rockbot', name: 'Rockbot', category: 'music', integrationTier: 'PARTNER',
    blurb: 'Gym music.', auth: 'oauth2', commercialUseLegal: true },
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

it('shows blocked sources WITH their reason instead of hiding them', async () => {
  mountPicker();
  await waitFor(() => expect(screen.getAllByText('Connect a source').length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByText('Connect a source')[0]);
  await waitFor(() => expect(screen.getByText('Connect a media source')).toBeInTheDocument());

  // YouTube (terms), Atmosphere (no adapter), Rockbot (OAuth not built).
  expect(screen.getByText(/3 sources we can’t connect/)).toBeInTheDocument();
  expect(screen.getByText(/A consumer subscription is not a venue license/)).toBeInTheDocument();
  expect(screen.getByText(/Atmosphere uses its own managed player/)).toBeInTheDocument();
  expect(screen.getByText(/sign-in flow for it is not finished/)).toBeInTheDocument();

  // …and they are not selectable.
  expect(screen.queryByRole('button', { name: /^YouTube/ })).not.toBeInTheDocument();
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
