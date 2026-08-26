/**
 * "what the hell is this entire menu dashboard used for, i added a few
 * menu items but then what no fucking clue."
 *
 * The console was the middle of a pipeline with no visible ends. These
 * tests hold the ends visible: when nothing reads the price book it says
 * so and offers the way out, when something does it names it, and an item
 * that lands nowhere is called out rather than left to look fine.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MenuReachPanel } from '../MenuReachPanel';

const apiFetch = jest.fn();
jest.mock('@/lib/api-client', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const MENU_BOARD_HTML = `<!doctype html><html><body><main id="stage">
  <div data-field="item.0.name">Burger</div><div data-field="item.0.price">$8</div>
  <div data-field="item.1.name">Fries</div><div data-field="item.1.price">$3</div>
  <div data-field="item.2.name">Onion Rings</div><div data-field="item.2.price">$4</div>
</main></body></html>`;

function mount(templates: unknown[], catalogNames: string[], html = MENU_BOARD_HTML) {
  apiFetch.mockImplementation(() => Promise.resolve(templates));
  (global as unknown as { fetch: unknown }).fetch = jest.fn(() =>
    Promise.resolve({ ok: true, text: () => Promise.resolve(html) }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MenuReachPanel schoolId="s1" catalogNames={catalogNames} />
    </QueryClientProvider>,
  );
}

const menuTemplate = {
  id: 'tpl-1', name: 'Counter Menu',
  zones: [{ widgetType: 'EXTERNAL_HTML', defaultConfig: { url: '/templates/signage/qsr/02-counter-menu.html' } }],
};
const nonMenuTemplate = {
  id: 'tpl-2', name: 'Varsity',
  zones: [{ widgetType: 'EXTERNAL_HTML', defaultConfig: { url: '/templates/hs/varsity.html' } }],
};

beforeEach(() => apiFetch.mockReset());

it('with no menu board it says so plainly, and offers the way out', async () => {
  mount([nonMenuTemplate], ['burger', 'fries']);
  await waitFor(() => expect(screen.getByText(/aren.t on any screen yet/i)).toBeInTheDocument());
  // It explains the join, which nothing in the product did.
  expect(screen.getByText(/by name/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Pick a menu template/i })).toHaveAttribute('href', '/s1/templates');
});

it('names the board that reads these prices, and how much of it lands', async () => {
  mount([menuTemplate], ['Burger', 'Fries']);
  await waitFor(() => expect(screen.getByText(/Where these prices show up/i)).toBeInTheDocument());
  expect(screen.getByRole('link', { name: 'Counter Menu' })).toHaveAttribute('href', '/s1/templates/tpl-1');
  // The summary is assembled from several JSX expressions, so match on the
  // rendered text of the row rather than a single text node.
  const row = screen.getByRole('link', { name: 'Counter Menu' }).closest('li')!;
  expect(row.textContent).toMatch(/shows 2 of your items/i);
  // The board's third row has no catalog item — it keeps its typed price.
  expect(row.textContent).toMatch(/1 row keeps a typed price/i);
});

it('an item that reaches no board is called out, not left looking fine', async () => {
  mount([menuTemplate], ['Burger', 'Fries', 'Milkshake']);
  await waitFor(() => expect(screen.getByText(/Not on any board:/i)).toBeInTheDocument());
  expect(screen.getByText(/Milkshake/)).toBeInTheDocument();
  expect(screen.getByText(/changes nothing on screen/i)).toBeInTheDocument();
});

it('a board whose rows match nothing is flagged rather than counted as working', async () => {
  mount([menuTemplate], ['Pad Thai', 'Green Curry']);
  await waitFor(() => expect(screen.getByText(/none of your items match its rows/i)).toBeInTheDocument());
});

it('matching is case- and punctuation-insensitive, exactly as the board is', async () => {
  mount([menuTemplate], ['BURGER', 'fries', 'onion-rings']);
  await waitFor(() => expect(screen.getByText(/shows 3 of your items/i)).toBeInTheDocument());
  expect(screen.queryByText(/Not on any board:/i)).not.toBeInTheDocument();
});
