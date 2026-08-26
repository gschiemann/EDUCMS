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
  await waitFor(() => expect(screen.getByText(/on a screen yet/i)).toBeInTheDocument());
  // With no menu board at all, the useful thing to say is what one IS —
  // not how name-matching works against boards that don't exist.
  expect(screen.getByText(/Driven by your POS/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Open a menu board/i })).toHaveAttribute('href', '/s1/templates');
});

it('does not list every board that shows nothing — that is one number, not a wall', async () => {
  // 15 menu templates, none matching: the first version rendered 15 rows
  // each saying "none of your items match its rows".
  const many = Array.from({ length: 15 }, (_, i) => ({
    id: `t${i}`, name: `Bar · Tap List ${i}`,
    zones: [{ widgetType: 'EXTERNAL_HTML', defaultConfig: { url: '/templates/signage/bar/x.html' } }],
  }));
  // Their rows must genuinely not match, or they'd be boards that DO show
  // your items — a different (and fine) outcome.
  apiFetch.mockImplementation(() => Promise.resolve(many));
  (global as unknown as { fetch: unknown }).fetch = jest.fn(() => Promise.resolve({
    ok: true,
    text: () => Promise.resolve(
      '<!doctype html><html><body><main id="stage"><div data-field="t.0.name">Lager</div><div data-field="t.1.name">Stout</div></main></body></html>'),
  }));
  const qc2 = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc2}>
      <MenuReachPanel schoolId="s1" catalogNames={['burger', 'fries', 'shake']} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText(/on a screen yet/i)).toBeInTheDocument());
  expect(screen.queryAllByText(/none of your items match/i)).toHaveLength(0);
  // Every board is accounted for, as a count.
  expect(screen.getByText(/15 menu boards have/i)).toBeInTheDocument();
});

it('shows only the boards that carry your items, and counts the rest', async () => {
  const matching = {
    id: 'good', name: 'Counter Menu',
    zones: [{ widgetType: 'EXTERNAL_HTML', defaultConfig: { url: '/templates/signage/qsr/02-counter-menu.html' } }],
  };
  const others = Array.from({ length: 9 }, (_, i) => ({
    id: `n${i}`, name: `Bar · Other ${i}`,
    zones: [{ widgetType: 'EXTERNAL_HTML', defaultConfig: { url: `/templates/signage/bar/${i}.html` } }],
  }));
  // Only the qsr board's HTML matches; the bar boards get HTML with no menu rows.
  apiFetch.mockImplementation(() => Promise.resolve([matching, ...others]));
  (global as unknown as { fetch: unknown }).fetch = jest.fn((u: string) =>
    Promise.resolve({
      ok: true,
      text: () => Promise.resolve(String(u).includes('qsr')
        ? MENU_BOARD_HTML
        : '<!doctype html><html><body><main id="stage"><div data-field="x.0.name">Nothing</div></main></body></html>'),
    }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MenuReachPanel schoolId="s1" catalogNames={['Burger', 'Fries']} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText(/On 1 board/i)).toBeInTheDocument());
  expect(screen.getByRole('link', { name: 'Counter Menu' })).toBeInTheDocument();
  expect(screen.getByText(/9 other menu boards show none of them/i)).toBeInTheDocument();
});

it('names the board that reads these prices, and how much of it lands', async () => {
  mount([menuTemplate], ['Burger', 'Fries']);
  await waitFor(() => expect(screen.getByText(/On 1 board/i)).toBeInTheDocument());
  expect(screen.getByRole('link', { name: 'Counter Menu' })).toHaveAttribute('href', '/s1/templates/tpl-1');
  // The summary is assembled from several JSX expressions, so match on the
  // rendered text of the row rather than a single text node.
  const row = screen.getByRole('link', { name: 'Counter Menu' }).closest('li')!;
  expect(row.textContent).toMatch(/2 items/i);
  // The board's third row has no catalog item — it keeps its typed price.
  expect(row.textContent).toMatch(/1 row still on a typed price/i);
});

it('an item that reaches no board is named, not left looking fine', async () => {
  mount([menuTemplate], ['Burger', 'Fries', 'Milkshake']);
  await waitFor(() => expect(screen.getByText(/Not on any board:/i)).toBeInTheDocument());
  expect(screen.getByText(/Milkshake/)).toBeInTheDocument();
});

it('a board whose rows match nothing does not count as working', async () => {
  mount([menuTemplate], ['Pad Thai', 'Green Curry']);
  await waitFor(() => expect(screen.getByText(/on a screen yet/i)).toBeInTheDocument());
  expect(screen.queryByText(/^On \\d+ board/)).not.toBeInTheDocument();
});

it('matching is case- and punctuation-insensitive, exactly as the board is', async () => {
  mount([menuTemplate], ['BURGER', 'fries', 'onion-rings']);
  await waitFor(() => expect(screen.getByText(/On 1 board/i)).toBeInTheDocument());
  expect(screen.queryByText(/Not on any board:/i)).not.toBeInTheDocument();
});
