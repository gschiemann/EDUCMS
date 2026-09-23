/**
 * POS-A (2026-09-23) — what an EXTERNAL_HTML board is actually sent about its
 * POS bindings, through the REAL WidgetPreview (the path BuilderZone and the
 * player both render through — CLAUDE.md #9).
 *
 *   1. A `{{pos.item:…}}` token never reaches a board: not in the `?text=` URL,
 *      not in any postMessage. (Before: it rode both, verbatim.)
 *   2. The menu feed starts for exactly the boards that can use it.
 *   3. THE ORDER: the resolved-bindings message is the LAST message of every
 *      burst — after the menu, after the operator's overrides — and it carries
 *      the bound item's value. (`pos-bound-real-board-order.test.tsx` replays
 *      the captured order into the real packaged boards.)
 */
import { render, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WidgetPreview } from '../WidgetRenderer';
import { apiFetch } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(),
}));

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

const apiFetchMock = apiFetch as unknown as jest.Mock;

/** `/pos/items` rows, as the session (builder-preview) path returns them. */
const MENU_ROWS = [
  { externalId: 'oysters', name: 'Carolina oysters', priceCents: 2400, category: 'Starters', available: true },
  { externalId: 'special', name: "Chef's special", priceCents: 3100, category: 'Mains', available: true },
];

function menuCalls(): string[] {
  return apiFetchMock.mock.calls.map((c) => String(c[0])).filter((p) => p.startsWith('/pos/items'));
}

function decodeParam(src: string, name: string): Record<string, unknown> | null {
  const raw = new URL(src, 'http://localhost').searchParams.get(name);
  if (!raw) return null;
  return JSON.parse(Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

/**
 * Render a board and capture every message posted to its frame from the moment
 * it "loads" — exactly what a real board receives (anything posted before its
 * document exists goes to about:blank and is lost, in a browser as here).
 */
async function renderAndLoad(config: Record<string, unknown>, opts: { freeze?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <WidgetPreview widgetType="EXTERNAL_HTML" config={config} width={100} height={100} freeze={opts.freeze} />
    </QueryClientProvider>,
  );
  const frame = utils.container.querySelector('iframe') as HTMLIFrameElement;
  expect(frame).toBeTruthy();
  const messages: Array<Record<string, unknown>> = [];
  const win = frame.contentWindow as Window;
  (win as unknown as { postMessage: (d: unknown) => void }).postMessage = (d: unknown) => {
    messages.push(d as Record<string, unknown>);
  };
  return { ...utils, frame, messages, load: () => act(() => { frame.dispatchEvent(new Event('load')); }) };
}

beforeEach(() => {
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async (path: string) => (String(path).startsWith('/pos/items') ? MENU_ROWS : []));
});

describe('a binding token never reaches a board', () => {
  const TOKEN_CONFIG = {
    url: '/templates/signage/menus-pos/01-fullservice-menu.html',
    textOverrides: {
      'board.title': 'Tonight',
      'i.0.0.p': '{{pos.item:special.price}}',
    },
  };

  it('is stripped from the ?text= the packaged board reads at first paint', async () => {
    const { frame } = await renderAndLoad(TOKEN_CONFIG);
    const src = frame.getAttribute('src') || '';
    expect(decodeParam(src, 'text')).toEqual({ 'board.title': 'Tonight' });
    expect(decodeURIComponent(src)).not.toContain('pos.item');
  });

  it('is in no message the board receives — the token is resolved into the live price instead', async () => {
    const { messages, load } = await renderAndLoad(TOKEN_CONFIG);
    await waitFor(() => expect(menuCalls().length).toBeGreaterThan(0));
    load();
    await waitFor(() => expect(messages.some((m) => m.text)).toBe(true));
    expect(JSON.stringify(messages)).not.toContain('{{pos.item');
    expect(messages.filter((m) => m.text).pop()!.text).toEqual({ 'i.0.0.p': '$31.00' });
  });

  it('an AI board’s overrides message carries no token either', async () => {
    const { messages, load } = await renderAndLoad({
      html: '<!doctype html><html lang="en"><head></head><body><div data-field="hero.price">$9</div></body></html>',
      posSync: true,
      textOverrides: { 'hero.title': 'Hi', 'hero.price': '{{pos.item:special.price}}' },
    });
    load();
    await waitFor(() => expect(messages.some((m) => m.text)).toBe(true));
    const overrides = messages.find((m) => m.text)!;
    expect(overrides.text).toEqual({ 'hero.title': 'Hi' });
    expect(JSON.stringify(messages)).not.toContain('{{pos.item');
  });
});

describe('the menu feed runs for exactly the boards that can use it', () => {
  it('a board with an explicit binding starts it, even with no menu runtime of its own', async () => {
    await renderAndLoad({ url: '/templates/hs/achievement.html', posItemBindings: { 'hero.price': { externalId: 'special', field: 'price' } } });
    await waitFor(() => expect(menuCalls().length).toBe(1));
  });

  it('a kept POS-bound AI board starts it', async () => {
    await renderAndLoad({ html: '<html><body></body></html>', posSync: true, dataSource: 'POS', posProvider: 'toast', posConnectionId: 'conn-1', posItemBindings: { 'item.0': 'special' } });
    await waitFor(() => expect(menuCalls()).toEqual(['/pos/items?connectionId=conn-1']));
  });

  it('a packaged board with its own menu runtime starts it (unchanged)', async () => {
    await renderAndLoad({ url: '/templates/signage/qsr/02-counter-menu.html' });
    await waitFor(() => expect(menuCalls().length).toBe(1));
  });

  it('a "Driven by POS" flag on a board that cannot read a menu no longer polls for nothing', async () => {
    await renderAndLoad({ url: '/templates/signage/qsr/redesign-counter-v1-the-pass.html', posSync: true, dataSource: 'POS' });
    await renderAndLoad({ html: '<html><body></body></html>', posSync: true, dataSource: 'POS' });
    await new Promise((r) => setTimeout(r, 30));
    expect(menuCalls()).toEqual([]);
  });

  it('a frozen gallery thumbnail never polls', async () => {
    await renderAndLoad({ url: '/templates/signage/qsr/02-counter-menu.html', posItemBindings: { 'i.0.price': { externalId: 'special', field: 'price' } } }, { freeze: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(menuCalls()).toEqual([]);
  });

  it('with a binding, the feed is fetched whole and the category applied to the board’s own copy', async () => {
    const { messages, load } = await renderAndLoad({
      url: '/templates/signage/menus-pos/01-fullservice-menu.html',
      posCategory: 'Starters',
      posItemBindings: { 'i.0.0.p': { externalId: 'special', field: 'price' } },
    });
    await waitFor(() => expect(menuCalls()).toEqual(['/pos/items']));
    load();
    await waitFor(() => expect(messages.some((m) => m.menu)).toBe(true));
    const menu = messages.find((m) => m.menu)!.menu as { items: Array<{ name: string }> };
    // The board's name-join sees only its section…
    expect(menu.items.map((i) => i.name)).toEqual(['Carolina oysters']);
    // …while the binding still resolves to an item in another section.
    expect(messages.filter((m) => m.text).pop()!.text).toEqual({ 'i.0.0.p': '$31.00' });
  });
});

describe('THE ORDER — the bindings message is always last', () => {
  it('a packaged board: the menu, THEN the bound value (so it beats the board’s name guess)', async () => {
    const { messages, load } = await renderAndLoad({
      url: '/templates/signage/menus-pos/01-fullservice-menu.html',
      posItemBindings: { 'i.0.0.p': { externalId: 'special', field: 'price' } },
    });
    await waitFor(() => expect(messages.some((m) => m.menu)).toBe(true));
    messages.length = 0;
    load();
    expect(messages.map((m) => (m.menu ? 'menu' : m.text ? 'text' : 'other'))).toEqual(['menu', 'text']);
    expect(messages[1].text).toEqual({ 'i.0.0.p': '$31.00' });
  });

  it('a packaged board with no binding gets the menu alone (nothing extra)', async () => {
    const { messages, load } = await renderAndLoad({ url: '/templates/signage/menus-pos/01-fullservice-menu.html' });
    await waitFor(() => expect(messages.some((m) => m.menu)).toBe(true));
    messages.length = 0;
    load();
    expect(messages.map((m) => Object.keys(m).filter((k) => k !== 'type').join('+'))).toEqual(['menu']);
  });

  it('a Super Taco wall resolves its own row slots — only single-field bindings are resolved for it', async () => {
    const { messages, load } = await renderAndLoad({
      url: '/templates/signage/qsr/27-super-taco-combos.html',
      posItemBindings: { 'combo.0': 'special', 'combo.1.price': { externalId: 'oysters', field: 'price' } },
    });
    await waitFor(() => expect(messages.some((m) => m.menu)).toBe(true));
    messages.length = 0;
    load();
    const [menuMsg, textMsg] = messages;
    // The board is handed its slot map exactly as Codex's runtime reads it…
    expect((menuMsg.menu as { bindings: unknown }).bindings).toEqual({ 'combo.0': 'special' });
    // …and never has its combo name overwritten from here (it strips the "#1").
    expect(textMsg.text).toEqual({ 'combo.1.price': '$24.00' });
  });

  it('an AI board: its overrides, then the resolved rows — last, on load and on every change', async () => {
    const config = {
      html: '<!doctype html><html lang="es"><head></head><body><div data-menu-row="0"><b data-field="item.0.name">Ostras</b><i data-field="item.0.price">$20.00</i></div></body></html>',
      posSync: true, dataSource: 'POS', posProvider: 'toast', posConnectionId: 'conn-1',
      posItemBindings: { 'item.0': 'special', 'item.1': 'gone' },
      textOverrides: { 'item.0.name': 'typed long ago' },
    };
    const { messages, load, rerender } = await renderAndLoad(config);
    await waitFor(() => expect(menuCalls().length).toBe(1));
    await waitFor(() => expect(messages.some((m) => m.pos && (m.pos as { rows: unknown[] }).rows.length)).toBe(true));
    messages.length = 0;
    load();
    const kinds = messages.map((m) => (m.pos ? 'pos' : m.text ? 'overrides' : 'other'));
    expect(kinds[0]).toBe('overrides');
    expect(kinds[kinds.length - 1]).toBe('pos');
    expect(messages.some((m) => m.menu)).toBe(false); // an AI board has no menu runtime to hand it to
    expect(messages[messages.length - 1].pos).toEqual({
      v: 1,
      rows: [
        { slot: 'item.0', row: '0', s: 'live', t: { name: "Chef's special", price: '$31.00' } },
        // The board is Spanish, so its words are too.
        { slot: 'item.1', row: '1', s: 'missing', t: { price: 'No disponible' } },
      ],
      fields: [],
    });

    // An operator edit re-posts the overrides — and the rows again, after them.
    messages.length = 0;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <WidgetPreview widgetType="EXTERNAL_HTML" config={{ ...config, brand: { primary: '#ff0000' } }} width={100} height={100} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(messages.length).toBeGreaterThan(0));
    expect(messages[messages.length - 1].pos).toBeTruthy();
  });

  it('no menu yet → a bound AI board is sent an empty state (it keeps its own words)', async () => {
    apiFetchMock.mockImplementation(() => new Promise(() => undefined)); // the menu never arrives
    const { messages, load } = await renderAndLoad({ html: '<html><body></body></html>', posItemBindings: { 'item.0': 'special' } });
    load();
    expect(messages[messages.length - 1].pos).toEqual({ v: 1, rows: [], fields: [] });
  });
});
