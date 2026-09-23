/**
 * POS-A (2026-09-23) — the builder's "Bind to a live menu item" no longer
 * writes a `{{pos.item:…}}` token.
 *
 * It used to store the binding AND mirror it as a token in textOverrides "for
 * the server to resolve". Nothing ever resolved it, and with no menu the token
 * reached the glass literally. The binding is now stored once, as
 * `posItemBindings[field] = { externalId, field }`, and each screen resolves it
 * (WidgetRenderer). A token saved by an older builder still shows as a bound
 * chip — never as a text box holding `{{pos.item:…}}` — and goes away the next
 * time the field is bound or unbound.
 *
 * Mounts the REAL ContentFields switch PropertiesPanel dispatches (rule #9).
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContentFields } from '../PropertiesPanel';
import { apiFetch } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(),
}));

const BOARD_HTML =
  '<!doctype html><html><body>' +
  '<div data-field="hero.title">Taco Tuesday</div>' +
  '<div data-field="hero.price">$9.00</div>' +
  '</body></html>';

const POS_ITEMS = [
  { id: 'p1', externalId: 'birria', name: 'Birria Tacos', priceCents: 1525, category: 'Tacos' },
  { id: 'p2', externalId: 'asada', name: 'Asada Burrito', priceCents: 1750, category: 'Burritos' },
];

beforeEach(() => {
  (apiFetch as unknown as jest.Mock).mockReset();
  (apiFetch as unknown as jest.Mock).mockImplementation(async (p: string) => {
    if (String(p).startsWith('/pos/items')) return POS_ITEMS;
    return new Promise(() => undefined);
  });
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: true, text: async () => BOARD_HTML }));
});

function mount(defaultConfig: Record<string, unknown>) {
  const updateZone = jest.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ContentFields zone={{ id: 'z', widgetType: 'EXTERNAL_HTML', defaultConfig }} updateZone={updateZone} />
    </QueryClientProvider>,
  );
  const lastConfig = () => updateZone.mock.calls[updateZone.mock.calls.length - 1][1].defaultConfig as Record<string, unknown>;
  return { updateZone, lastConfig };
}

const BOARD = { url: '/templates/hs/some-board.html', posSync: true, dataSource: 'POS' };

it('binding a field stores the binding ONCE — no token in textOverrides', async () => {
  const { updateZone, lastConfig } = mount({ ...BOARD, textOverrides: { 'hero.title': 'Taco Night' } });
  // The price row (a short field) offers the bind control once POS is on.
  const links = await screen.findAllByRole('button', { name: /Bind to a live menu item/ });
  fireEvent.click(links[links.length - 1]);
  const option = await screen.findByText('— pick a menu item —');
  const select = option.closest('select') as HTMLSelectElement;
  fireEvent.change(select, { target: { value: 'birria' } });
  fireEvent.click(screen.getByRole('button', { name: 'Bind this field' }));

  await waitFor(() => expect(updateZone).toHaveBeenCalled());
  const cfg = lastConfig();
  expect(cfg.posItemBindings).toEqual({ 'hero.price': { externalId: 'birria', field: 'price' } });
  // The operator's own text is untouched, and no token was written anywhere.
  expect(cfg.textOverrides).toEqual({ 'hero.title': 'Taco Night' });
  expect(JSON.stringify(cfg)).not.toContain('{{pos.item');
});

it('a token saved by an older builder renders as a bound chip, never as a text box holding it', async () => {
  mount({ ...BOARD, textOverrides: { 'hero.price': '{{pos.item:asada.price}}' } });
  // The chip names the item the token points at…
  await waitFor(() => expect(screen.getByText('Asada Burrito')).toBeInTheDocument());
  expect(screen.getByText(/Live price from/)).toBeInTheDocument();
  // …and no input anywhere shows the raw token.
  for (const el of Array.from(document.querySelectorAll('input, textarea'))) {
    expect((el as HTMLInputElement).value).not.toContain('{{pos.item');
  }
});

it('unbinding a legacy token removes it — the field goes back to the board’s own copy', async () => {
  const { updateZone, lastConfig } = mount({
    ...BOARD,
    textOverrides: { 'hero.title': 'Taco Night', 'hero.price': '{{pos.item:asada.price}}' },
  });
  const unbind = await screen.findByRole('button', { name: 'Unbind from POS item' });
  fireEvent.click(unbind);
  await waitFor(() => expect(updateZone).toHaveBeenCalled());
  const cfg = lastConfig();
  expect(cfg.textOverrides).toEqual({ 'hero.title': 'Taco Night' });
  expect(cfg.posItemBindings).toBeUndefined();
});

it('unbinding one field keeps every other binding on the board (a row slot included)', async () => {
  const { lastConfig } = mount({
    ...BOARD,
    posItemBindings: { 'item.0': 'birria', 'hero.price': { externalId: 'asada', field: 'price' } },
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Unbind from POS item' }));
  await waitFor(() => expect(lastConfig().posItemBindings).toEqual({ 'item.0': 'birria' }));
});
