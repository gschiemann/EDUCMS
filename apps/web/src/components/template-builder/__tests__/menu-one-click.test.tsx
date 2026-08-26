/**
 * "make it dead simple for a user."
 *
 * Reporting a mismatch still asked the operator to understand that the
 * join is a string and to go rename rows by hand. This is the fix in one
 * press: the rows showing a typed price start showing the real one.
 *
 * It writes text overrides only, so each row's Reset undoes it — which is
 * what makes a one-click bulk edit safe to offer at all.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentFields } from '../PropertiesPanel';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const BOARD = `<!doctype html><html><body><main id="stage">
  <div data-field="item.0.name">Burgers</div><div data-field="item.0.price">$8</div>
  <div data-field="item.1.name">French Fries</div><div data-field="item.1.price">$3</div>
  <div data-field="item.2.name">Espresso</div><div data-field="item.2.price">$4</div>
</main></body></html>`;

function mount(catalog: string[], cfg: Record<string, unknown> = {}) {
  apiFetch.mockImplementation((path: string) =>
    path === '/menu/catalog'
      ? Promise.resolve(catalog.map((name) => ({ name })))
      : new Promise(() => undefined));
  (global as unknown as { fetch: unknown }).fetch = jest.fn(() =>
    Promise.resolve({ ok: true, text: () => Promise.resolve(BOARD) }));
  const updateZone = jest.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ContentFields
        zone={{
          id: 'z', widgetType: 'EXTERNAL_HTML',
          defaultConfig: { url: '/templates/signage/qsr/02-counter-menu.html', posSync: true, ...cfg },
        }}
        updateZone={updateZone}
      />
    </QueryClientProvider>,
  );
  return { updateZone };
}
const lastCfg = (m: jest.Mock) => m.mock.calls[m.mock.calls.length - 1][1].defaultConfig as Record<string, unknown>;

it('offers to fix the rows, naming exactly what it will change', async () => {
  mount(['Burger', 'Fries']);
  await waitFor(() => expect(screen.getByText(/Use my price book for 2 rows/i)).toBeInTheDocument());
  // The operator sees the change before making it. Scoped to the preview,
  // since the same names also appear in the warning line above it.
  const preview = screen.getByRole('button', { name: /Use my price book/i })
    .parentElement!.querySelector('ul')!;
  expect(preview.textContent).toMatch(/Burgers.*→.*Burger/);
  expect(preview.textContent).toMatch(/French Fries.*→.*Fries/);
});

it('one press repoints the rows at the real items', async () => {
  const { updateZone } = mount(['Burger', 'Fries']);
  await waitFor(() => expect(screen.getByText(/Use my price book for 2 rows/i)).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /Use my price book/i }));

  const overrides = lastCfg(updateZone).textOverrides as Record<string, string>;
  expect(overrides['item.0.name']).toBe('Burger');
  expect(overrides['item.1.name']).toBe('Fries');
  // Espresso had nothing to pair with and is left alone.
  expect('item.2.name' in overrides).toBe(false);
});

it('does not offer the button when every row already matches', async () => {
  mount(['Burgers', 'French Fries', 'Espresso']);
  await waitFor(() => expect(screen.getByText(/3 of 3 rows pull a live price/i)).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /Use my price book/i })).not.toBeInTheDocument();
});

it('says the price book is empty rather than offering a fix that does nothing', async () => {
  mount([]);
  await waitFor(() => expect(screen.getByText(/price book is empty/i)).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /Use my price book/i })).not.toBeInTheDocument();
});

it('stays quiet on a board that is not POS-driven', async () => {
  mount(['Burger'], { posSync: false, url: '/templates/hs/varsity.html' });
  await waitFor(() => expect(screen.queryByText(/pull a live price/i)).not.toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /Use my price book/i })).not.toBeInTheDocument();
});
