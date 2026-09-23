/**
 * A kept POS-bound AI board (2026-09-23) is ONE EXTERNAL_HTML zone holding its
 * board inline (`html`) plus its POS config (posSync, posItemBindings) — it has
 * no board URL. The "Live menu" name-join report fetches the board by URL, so on
 * these boards it sat on "Checking which items this board will pull…" forever.
 * Mounts the REAL ContentFields switch PropertiesPanel dispatches (rule #9).
 */
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentFields } from '../PropertiesPanel';

jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  // Every probe stays pending: a pending report renders its loading state.
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

beforeAll(() => { (global as unknown as { fetch: unknown }).fetch = jest.fn(() => new Promise(() => undefined)); });

function mount(defaultConfig: Record<string, unknown>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ContentFields zone={{ id: 'z', widgetType: 'EXTERNAL_HTML', defaultConfig }} updateZone={jest.fn()} />
    </QueryClientProvider>,
  );
}

it('a kept POS-bound AI board shows its Live menu section without the endless name-join check', async () => {
  mount({
    html: '<!doctype html><html><body><div data-menu-row="0" data-pos-item="toast-birria"><span data-field="item.0.name">Birria Tacos</span><b data-field="item.0.price">$14.50</b></div></body></html>',
    posSync: true,
    dataSource: 'POS',
    posProvider: 'toast',
    posConnectionId: 'conn-toast',
    posItemBindings: { 'item.0': 'toast-birria' },
  });
  await waitFor(() => expect(screen.getByText('Live menu')).toBeInTheDocument());
  expect(screen.queryByText(/Checking which items this board will pull/)).not.toBeInTheDocument();
});

it('a menu board with a board URL still runs the check (negative control)', async () => {
  mount({ url: '/templates/signage/qsr/redesign-sushi-ramen-after-dark.html', posSync: true });
  await waitFor(() => expect(screen.getByText(/Checking which items this board will pull/)).toBeInTheDocument());
});
