/**
 * POS-A (2026-09-23) — the Super Taco walls, with their REAL runtime.
 *
 * Codex's wall resolves its own row slots (`menu.bindings['item.N']`): a slot
 * bound to a POS item shows that item even when its name changes. The renderer
 * must leave those slots to the wall (resolving them from outside would
 * overwrite its own formatting — the combos board strips a "#1" prefix), while
 * a single field bound in the builder still wins over whatever the wall chose.
 *
 * Captured from the real WidgetPreview, replayed into the real board's scripts
 * (see pos-bound-real-board-order.test.tsx for the harness rationale).
 */
import * as fs from 'fs';
import * as path from 'path';
import { render, waitFor, act, cleanup } from '@testing-library/react';
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
if (typeof window.requestAnimationFrame !== 'function') {
  (window as unknown as { requestAnimationFrame: (cb: () => void) => number }).requestAnimationFrame = (cb) => window.setTimeout(cb, 0);
}

const BOARD_URL = '/templates/signage/qsr/26-super-taco-burritos.html';
const BOARD_FILE = path.resolve(__dirname, '../../../../public', BOARD_URL.slice(1));

const MENU_ROWS = [
  { externalId: 'asada', name: 'Asada Super Burrito', priceCents: 1750, category: 'Burritos', available: true },
  { externalId: 'chicken', name: 'Grilled Chicken Super Burrito', priceCents: 1550, category: 'Burritos', available: true },
  { externalId: 'special', name: 'Birria Special Burrito', priceCents: 2100, category: 'Burritos', available: true },
];

async function captureMessages(config: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
  (apiFetch as unknown as jest.Mock).mockImplementation(async (p: string) => (String(p).startsWith('/pos/items') ? MENU_ROWS : []));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <WidgetPreview widgetType="EXTERNAL_HTML" config={config} width={100} height={100} />
    </QueryClientProvider>,
  );
  const frame = container.querySelector('iframe') as HTMLIFrameElement;
  const messages: Array<Record<string, unknown>> = [];
  (frame.contentWindow as unknown as { postMessage: (d: unknown) => void }).postMessage = (d) => {
    messages.push(d as Record<string, unknown>);
  };
  await waitFor(() => expect(messages.some((m) => m.menu)).toBe(true));
  messages.length = 0;
  act(() => { frame.dispatchEvent(new Event('load')); });
  const out = messages.slice();
  cleanup();
  return out;
}

function loadRealBoard(): void {
  const html = fs.readFileSync(BOARD_FILE, 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const scripts = Array.from(doc.querySelectorAll('script')).map((s) => s.textContent || '');
  doc.querySelectorAll('script').forEach((s) => s.remove());
  document.head.innerHTML = doc.head.innerHTML;
  document.body.innerHTML = doc.body.innerHTML;
  for (const code of scripts) (0, eval)(code);
}

const field = (key: string) => (document.querySelector(`[data-field="${key}"]`)?.textContent || '').trim();

describe('a Super Taco wall: its slots are its own, a bound field still wins', () => {
  let captured: Array<Record<string, unknown>>;

  beforeAll(async () => {
    captured = await captureMessages({
      url: BOARD_URL,
      posProvider: 'toast',
      posSync: true,
      // Codex's slot: card 0 shows the special, whatever it is called.
      // A builder field binding: card 1's PRICE follows the asada burrito.
      posItemBindings: { 'item.0': 'special', 'item.1.price': { externalId: 'asada', field: 'price' } },
    });
    loadRealBoard();
    for (const data of captured) window.dispatchEvent(new MessageEvent('message', { data }));
  });

  it('the renderer hands the wall its slot map and resolves only the field binding', () => {
    expect(captured.map((m) => (m.menu ? 'menu' : m.text ? 'text' : 'other'))).toEqual(['menu', 'text']);
    expect((captured[0].menu as { bindings: unknown }).bindings).toEqual({ 'item.0': 'special' });
    expect(captured[1].text).toEqual({ 'item.1.price': '$17.50' });
  });

  it('the wall’s own slot binding picked the bound item for card 0', () => {
    expect(field('item.0.name')).toBe('Birria Special Burrito');
    expect(field('item.0.price')).toBe('$21.00');
  });

  it('card 1 keeps the wall’s own pick by name — but its price is the BOUND item’s', () => {
    expect(field('item.1.name')).toBe('Grilled Chicken Super Burrito');
    expect(field('item.1.price')).toBe('$17.50');
  });
});
