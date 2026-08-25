/**
 * Anti-costume proof for the gym media source picker (CLAUDE.md rule #9).
 *
 * A component that works perfectly in isolation and is never rendered
 * ships nothing. This mounts the REAL `ContentFields` switch — the same
 * one `PropertiesPanel` dispatches — and asserts the picker appears for a
 * gym media board and stays out of the way everywhere else.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentFields } from '../PropertiesPanel';

jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  // Keep every probe pending: this suite asserts the picker MOUNTS, not
  // what it loads. A pending query renders its own loading state.
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

// The EXTERNAL_HTML editor fetches the board's HTML to discover its
// fields/slots; jsdom has no fetch. Never resolves — irrelevant here.
beforeAll(() => { (global as unknown as { fetch: unknown }).fetch = jest.fn(() => new Promise(() => undefined)); });

const zone = (url: string) => ({ id: 'z', widgetType: 'EXTERNAL_HTML', defaultConfig: { url } });

function mount(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ContentFields zone={zone(url)} updateZone={jest.fn()} />
    </QueryClientProvider>,
  );
}

it('a gym media board offers its media source in the editor', async () => {
  mount('/templates/fitness/gym-media-pulsecast.html');
  await waitFor(() => expect(screen.getByText('Media source')).toBeInTheDocument());
  expect(screen.getByText(/Loading your media sources/)).toBeInTheDocument();
});

it('the portrait board offers it too', async () => {
  mount('/templates/fitness/gym-media-soundfloor-portrait.html');
  await waitFor(() => expect(screen.getByText('Media source')).toBeInTheDocument());
});

it('an unrelated board does not', async () => {
  mount('/templates/hs/varsity.html');
  await waitFor(() => expect(screen.queryByText('Media source')).not.toBeInTheDocument());
});

it('a menu board keeps its POS picker and gains no media picker', async () => {
  mount('/templates/signage/qsr/redesign-sushi-ramen-after-dark.html');
  await waitFor(() => expect(screen.getByText('Live menu')).toBeInTheDocument());
  expect(screen.queryByText('Media source')).not.toBeInTheDocument();
});
