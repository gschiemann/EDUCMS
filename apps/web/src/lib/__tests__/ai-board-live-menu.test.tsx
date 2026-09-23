/**
 * POS-A (2026-09-23) — a KEPT POS-bound AI board repaints from the live menu.
 *
 * Everything here is the real thing, end to end, except the network:
 *   • the board is cut from the PRODUCER (tests/fixtures/kept-pos-board.ts): the
 *     Super Taco fixture through the API's own sanitizeDesignerHtml → bindMenuRows
 *     (generate, then keep's re-bind) → injectDesignerEditShim →
 *     injectDesignerLayoutEngine — byte-for-byte what `create-designer` saves;
 *   • the zone config is exactly what keep saves
 *     ({ html, posSync, dataSource, posProvider, posConnectionId,
 *        posItemBindings: { 'item.N': externalId } });
 *   • it renders through the real WidgetPreview on the PLAYER path — a device
 *     token and a screen id, so the menu comes from
 *     GET /screens/:id/menu?includeUnavailable=1 (the one path that can say
 *     "sold out");
 *   • the srcdoc the renderer builds (buildSafeDesignerSrcdoc — CSP, the baked
 *     edit shim, the fit engine, VOS-STAGE-SCALE, VOS-LIVE-MENU) is loaded into
 *     this jsdom document with its own scripts, and the messages the renderer
 *     actually posted are delivered to it in order.
 *
 * Nothing in the saved board changed — so a board kept yesterday is this board.
 * Layout is not measurable in jsdom; the real-browser half (fit, computed
 * opacity, both engines) is tests/e2e/pos-bound-board.spec.ts.
 */
import { render, waitFor, act, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WidgetPreview } from '@/components/widgets/WidgetRenderer';
import { keptPosZoneConfig } from '../../../tests/fixtures/kept-pos-board';

jest.mock('@/lib/api-client', () => ({
  ...jest.requireActual('@/lib/api-client'),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

class FakeResizeObserver { observe() {} unobserve() {} disconnect() {} }
(global as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (global as unknown as { ResizeObserver?: unknown }).ResizeObserver ?? FakeResizeObserver;

/** The board + zone exactly as create-designer saves them (tests/fixtures/kept-pos-board.ts). */
const KEPT_ZONE = keptPosZoneConfig();

/** What GET /screens/:id/menu answers (the device endpoint's item shape). */
type DeviceItem = { externalId: string; name: string; description?: string; priceCents: number; category?: string; available: boolean };
let DEVICE_MENU: { items: DeviceItem[]; sourceConfigured: boolean } | 'fail' = 'fail';
const menuUrls: string[] = [];

beforeAll(() => {
  // The player path: a screen id + a device token → the device endpoint.
  window.history.pushState({}, '', '/player?screenId=scr-1');
  localStorage.setItem('edu_device_token', 'fake.device.token.not.real');
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
    menuUrls.push(String(url));
    if (DEVICE_MENU === 'fail') throw new Error('network down');
    const body = DEVICE_MENU;
    return { ok: true, status: 200, json: async () => body };
  });
});

/** Render through the real WidgetPreview, wait for the live menu, capture a frame load's messages. */
async function renderOnPlayer(config: Record<string, unknown>, waitForRows: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={client}>
      <WidgetPreview widgetType="EXTERNAL_HTML" config={config} width={100} height={100} />
    </QueryClientProvider>,
  );
  const frame = container.querySelector('iframe') as HTMLIFrameElement;
  const srcdoc = frame.getAttribute('srcdoc') || '';
  const messages: Array<Record<string, unknown>> = [];
  (frame.contentWindow as unknown as { postMessage: (d: unknown) => void }).postMessage = (d) => {
    messages.push(d as Record<string, unknown>);
  };
  if (waitForRows) {
    await waitFor(() => expect(messages.some((m) => m.pos && (m.pos as { rows: unknown[] }).rows.length > 0)).toBe(true));
  } else {
    await waitFor(() => expect(menuUrls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
  }
  messages.length = 0;
  act(() => { frame.dispatchEvent(new Event('load')); });
  const out = messages.slice();
  cleanup();
  return { srcdoc, messages: out };
}

/** Load the srcdoc into THIS document and run its scripts, in document order. */
function loadBoard(srcdoc: string): void {
  const doc = new DOMParser().parseFromString(srcdoc, 'text/html');
  const scripts = Array.from(doc.querySelectorAll('script')).map((s) => s.textContent || '');
  doc.querySelectorAll('script').forEach((s) => s.remove());
  document.documentElement.setAttribute('lang', doc.documentElement.getAttribute('lang') || 'en');
  document.head.innerHTML = doc.head.innerHTML;
  document.body.innerHTML = doc.body.innerHTML;
  for (const code of scripts) (0, eval)(code);
}

// The board's runtimes hear their PARENT only (2026-09-23): a message's
// `source` must be `window.parent`. The board runs in this top-level document,
// whose parent is itself — so that is what a real parent post looks like here.
// (designer-runtime-parent-only.test.ts proves a sibling frame is ignored.)
const deliver = (messages: Array<Record<string, unknown>>) => {
  for (const data of messages) window.dispatchEvent(new MessageEvent('message', { data, source: window.parent }));
};
const text = (key: string) => (document.querySelector(`[data-field="${key}"]`)?.textContent || '').trim();
const row = (n: number) => document.querySelector(`[data-menu-row="${n}"]`) as HTMLElement;
let resizes = 0;
window.addEventListener('resize', () => { resizes += 1; });

describe('a kept POS-bound AI board on a screen', () => {
  let rendered = '';
  beforeAll(async () => {
    DEVICE_MENU = {
      sourceConfigured: true,
      items: [
        // Toast renamed it and changed the price.
        { externalId: 'birria', name: '3 Birria Tacos w/ Consomé', priceCents: 1650, category: 'Tacos', available: true },
        // Sold out at this location right now.
        { externalId: 'horchata', name: 'Horchata', priceCents: 325, category: 'Drinks', available: false },
        // 'asada' is gone from the menu.
      ],
    };
    const { srcdoc, messages } = await renderOnPlayer(KEPT_ZONE, true);
    rendered = srcdoc;
    loadBoard(srcdoc);
    // The saved snapshot, before any live message.
    expect(text('item.0.price')).toBe('$15.25');
    deliver(messages);
  });

  it('asked the device endpoint for THIS screen, with sold-out items included', () => {
    expect(menuUrls[0]).toContain('/api/v1/screens/scr-1/menu?');
    expect(menuUrls[0]).toContain('connectionId=conn-toast');
    expect(menuUrls[0]).toContain('includeUnavailable=1');
  });

  it('the srcdoc carries the live runtime next to the baked ones — and it ran', () => {
    for (const marker of ['EDUCMS-SHIM-V7', 'VOS-STAGE-SCALE', 'VOS-LIVE-MENU', 'VOS-CANVAS', 'VOS-FIT-ENGINE']) {
      expect(rendered).toMatch(new RegExp('<script nonce="[a-f0-9]+">/\\*' + marker + '\\*/'));
    }
    expect((window as unknown as { __vosLiveMenu?: number }).__vosLiveMenu).toBe(1);
  });

  it('repaints a renamed item’s name AND its new price', () => {
    expect(text('item.0.name')).toBe('3 Birria Tacos w/ Consomé');
    expect(text('item.0.price')).toBe('$16.50');
    expect(row(0).hasAttribute('data-vos-lm')).toBe(false);
  });

  it('a sold-out item says so in its price and its row is greyed', () => {
    expect(text('item.2.name')).toBe('Horchata');
    expect(text('item.2.price')).toBe('Sold out');
    expect(row(2).getAttribute('data-vos-lm')).toBe('soldout');
    expect(document.querySelector('[data-field="item.2.price"]')!.getAttribute('data-vos-lm-flag')).toBe('1');
    expect(document.getElementById('vos-live-menu-css')).toBeTruthy();
  });

  it('an item gone from the menu is "Not available" — its name stays the board’s', () => {
    expect(text('item.1.name')).toBe('Asada Super Burrito');
    expect(text('item.1.price')).toBe('Not available');
    expect(row(1).getAttribute('data-vos-lm')).toBe('missing');
  });

  it('never a literal token, anywhere on the glass', () => {
    expect(document.body.innerHTML).not.toContain('{{pos.item');
  });

  it('re-fits when words change, and only then', () => {
    const before = resizes;
    deliver([{ type: 'educms-overrides', pos: { v: 1, rows: [
      { slot: 'item.0', row: '0', s: 'live', t: { name: '3 Birria Tacos w/ Consomé', price: '$16.50' } },
      { slot: 'item.1', row: '1', s: 'missing', t: { price: 'Not available' } },
      { slot: 'item.2', row: '2', s: 'soldout', t: { name: 'Horchata', price: 'Sold out' } },
    ], fields: [] } }]);
    expect(resizes).toBe(before); // same state → nothing re-laid out
  });

  it('back in stock and back on the menu: the grey comes off and the prices come back', async () => {
    DEVICE_MENU = {
      sourceConfigured: true,
      items: [
        { externalId: 'birria', name: '3 Birria Tacos', priceCents: 1525, category: 'Tacos', available: true },
        { externalId: 'asada', name: 'Asada Super Burrito', priceCents: 1799, category: 'Burritos', available: true },
        { externalId: 'horchata', name: 'Horchata', priceCents: 350, category: 'Drinks', available: true },
      ],
    };
    const before = resizes;
    const { messages } = await renderOnPlayer(KEPT_ZONE, true);
    deliver(messages);
    expect(resizes).toBeGreaterThan(before);
    expect([text('item.0.name'), text('item.0.price')]).toEqual(['3 Birria Tacos', '$15.25']);
    expect(text('item.1.price')).toBe('$17.99');
    expect(text('item.2.price')).toBe('$3.50');
    for (const n of [0, 1, 2]) expect(row(n).hasAttribute('data-vos-lm')).toBe(false);
    expect(document.querySelectorAll('[data-vos-lm-flag]').length).toBe(0);
  });

  it('a stale typed override never covers a live price (the operator’s words become the fallback)', () => {
    deliver([{ type: 'educms-overrides', text: { 'item.1.price': '$99.00' } }]);
    expect(text('item.1.price')).toBe('$17.99');
  });

  it('unbound (or no menu any more) → the board’s own words come back', () => {
    deliver([{ type: 'educms-overrides', pos: { v: 1, rows: [], fields: [] } }]);
    expect(text('item.0.name')).toBe('3 Birria Tacos');
    // item.1's own words are now the operator's typed override from the step above.
    expect(text('item.1.price')).toBe('$99.00');
    expect(text('item.2.price')).toBe('$3.25');
  });

  it('a screen whose first menu fetch fails is sent nothing to paint — the snapshot stays', async () => {
    DEVICE_MENU = 'fail';
    menuUrls.length = 0;
    const { messages } = await renderOnPlayer(KEPT_ZONE, false);
    expect(messages[messages.length - 1].pos).toEqual({ v: 1, rows: [], fields: [] });
    deliver(messages);
    expect(text('item.0.price')).toBe('$15.25');
    expect(document.body.innerHTML).not.toContain('{{pos.item');
  });
});
