/**
 * POS-A (2026-09-23) — an explicit binding beats the board's own name guess,
 * proven on a REAL packaged board with its REAL runtime.
 *
 * `menus-pos/01-fullservice-menu.html` carries the hand-built `applyMenu()`:
 * it joins each row to the live menu BY THE NAME IT DISPLAYS and writes that
 * item's price. The operator bound row 0's price to a different item. The only
 * way the binding wins is ORDER: the resolved-bindings message must land AFTER
 * the menu message (applyMenu runs only on a message that carries `menu`).
 *
 * This test does not assume the order — it CAPTURES it from the real
 * WidgetPreview (the renderer the builder and the player share), then runs the
 * board's own <script>s in jsdom and dispatches exactly that sequence.
 *
 * Negative controls in the same file: the same messages without the bindings
 * message, and in the opposite order, both leave the board's name guess on
 * the glass.
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

const BOARD_URL = '/templates/signage/menus-pos/01-fullservice-menu.html';
const BOARD_FILE = path.resolve(__dirname, '../../../../public', BOARD_URL.slice(1));

const MENU_ROWS = [
  // Row 0 DISPLAYS "Carolina oysters" — the board's own guess lands here.
  { externalId: 'oysters', name: 'Carolina oysters', priceCents: 2400, category: 'Starters', available: true },
  // …but the operator bound row 0's price to this item.
  { externalId: 'special', name: "Chef's special", priceCents: 3100, category: 'Mains', available: true },
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
  // Wait for the live menu to arrive, then deliver exactly what a frame load delivers.
  await waitFor(() => expect(messages.some((m) => m.menu)).toBe(true));
  messages.length = 0;
  act(() => { frame.dispatchEvent(new Event('load')); });
  const out = messages.slice();
  cleanup();
  return out;
}

/** Load the real board into this jsdom document and run its own scripts, in order. */
function loadRealBoard(): void {
  const html = fs.readFileSync(BOARD_FILE, 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const scripts = Array.from(doc.querySelectorAll('script')).map((s) => s.textContent || '');
  doc.querySelectorAll('script').forEach((s) => s.remove());
  document.head.innerHTML = doc.head.innerHTML;
  document.body.innerHTML = doc.body.innerHTML;
  for (const code of scripts) (0, eval)(code);
}

function deliver(messages: Array<Record<string, unknown>>): void {
  for (const data of messages) window.dispatchEvent(new MessageEvent('message', { data }));
}

const priceOfRow0 = () => (document.querySelector('[data-field="i.0.0.p"]')?.textContent || '').trim();

describe('an explicit binding beats the board’s own name guess — on the real board', () => {
  let captured: Array<Record<string, unknown>>;

  beforeAll(async () => {
    captured = await captureMessages({
      url: BOARD_URL,
      posItemBindings: { 'i.0.0.p': { externalId: 'special', field: 'price' } },
    });
    loadRealBoard();
  });

  it('the renderer sends the menu, then the bound value', () => {
    expect(captured.map((m) => (m.menu ? 'menu' : m.text ? 'text' : 'other'))).toEqual(['menu', 'text']);
  });

  it('the board ends up showing the BOUND item’s price', () => {
    expect(priceOfRow0()).toBe('$22'); // the snapshot the board shipped with
    deliver(captured);
    expect(priceOfRow0()).toBe('$31.00');
  });

  it('negative control: without the bindings message, the board’s name guess stays', () => {
    deliver(captured.filter((m) => m.menu));
    expect(priceOfRow0()).toBe('$24.00');
  });

  it('negative control: the same two messages in the OTHER order lose to the name guess', () => {
    deliver([...captured].reverse());
    expect(priceOfRow0()).toBe('$24.00');
  });

  it('and the right order puts it back', () => {
    deliver(captured);
    expect(priceOfRow0()).toBe('$31.00');
  });
});
