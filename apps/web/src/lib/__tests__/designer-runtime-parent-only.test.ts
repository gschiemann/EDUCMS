/**
 * AI-board runtimes hear their PARENT only (2026-09-23).
 *
 * An AI board renders in a sandboxed, null-origin srcdoc iframe, and two
 * runtimes inside it take `postMessage({ type: 'educms-overrides', … })`:
 *   • the baked edit shim — EDUCMS-SHIM-V7 (a board kept before V7 carries V6,
 *     swapped to V7 at render): text, text styles, images, brand, actions and
 *     `educms-edit-mode`;
 *   • VOS-LIVE-MENU, injected at render: live POS names / prices, and the words
 *     a field falls back to.
 * Neither used to look at `e.source`, so ANY frame on the same player page — a
 * WEBPAGE zone showing a third-party site reaches the board as
 * `parent.frames[i]` — could put its own words and prices on the glass. The one
 * legitimate sender is `window.parent`: ExternalHtmlWidget (player, builder,
 * previews) posts from the window that contains the iframe, and PropertiesPanel
 * arms edit mode from that same builder window.
 *
 * HARNESS. The jsdom test window is the PARENT (the player page). The srcdoc
 * the renderer really builds (buildSafeDesignerSrcdoc) is mounted in a child
 * iframe and its scripts run in the CHILD's realm; a second iframe is the
 * SIBLING. jsdom's own postMessage never sets `event.source`, so every message
 * here is a MessageEvent with an explicit `source` — the field the runtimes read.
 *
 * NEGATIVE CONTROL (bottom of this file): the same harness with ONLY the guard
 * removed from the runtimes DOES apply the sibling's messages — so every
 * "ignored" below is the guard's doing, never a message that was not delivered.
 */
import { buildSafeDesignerSrcdoc } from '../designer-safe-srcdoc';

/** The one statement both runtimes open their `message` listener with. */
const GUARD = 'if(e.source!==window.parent)return;';

const BOARD = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><style>.stage{width:1920px;height:1080px}</style></head>',
  '<body><div class="stage">',
  '<h1 data-field="headline">Taco Tuesday</h1>',
  '<div data-menu-row="0"><span data-field="item.0.name">3 Birria Tacos</span> <span data-field="item.0.price">$15.25</span></div>',
  '<div data-imgslot="hero"></div>',
  '<a data-action="order">Order now</a>',
  '</div></body></html>',
].join('');

type BoardWin = Window & typeof globalThis;

/** Mount a board the way every surface does: the renderer's srcdoc, in a child frame of THIS window. */
function mount(boardHtml: string, opts: { stripGuard?: boolean } = {}): { win: BoardWin; doc: Document } {
  const srcdoc = buildSafeDesignerSrcdoc(boardHtml);
  const frame = document.createElement('iframe');
  frame.title = 'AI-designed signage board';
  document.body.appendChild(frame);
  const win = frame.contentWindow as BoardWin;
  const parsed = new DOMParser().parseFromString(srcdoc, 'text/html');
  const scripts = Array.from(parsed.querySelectorAll('script')).map((s) => s.textContent || '');
  parsed.querySelectorAll('script').forEach((s) => s.remove());
  win.document.head.innerHTML = parsed.head.innerHTML;
  win.document.body.innerHTML = parsed.body.innerHTML;
  const run = (win as unknown as { eval: (code: string) => unknown }).eval;
  for (const code of scripts) run(opts.stripGuard ? code.split(GUARD).join('') : code);
  return { win, doc: win.document };
}

/** Another frame of the same page — a WEBPAGE zone's third-party document. */
function sibling(): Window {
  const frame = document.createElement('iframe');
  frame.title = 'third-party page';
  document.body.appendChild(frame);
  return frame.contentWindow as Window;
}

function send(win: BoardWin, data: unknown, source: Window | null): void {
  const init: MessageEventInit = { data };
  if (source) init.source = source;
  win.dispatchEvent(new win.MessageEvent('message', init));
}

const price = (doc: Document) => (doc.querySelector('[data-field="item.0.price"]')?.textContent || '').trim();
const rowFlag = (doc: Document) => doc.querySelector('[data-menu-row="0"]')!.getAttribute('data-vos-lm');
const livePos = (rows: unknown[]) => ({ type: 'educms-overrides', pos: { v: 1, rows, fields: [] } });
const SOLD_OUT_ROW = { slot: 'item.0', row: '0', s: 'soldout', t: { name: '3 Birria Tacos', price: 'Sold out' } };

afterEach(() => {
  document.body.innerHTML = '';
});

describe('VOS-LIVE-MENU hears its parent only', () => {
  // No edit shim on this board: the live-menu runtime alone.
  it('a live menu from a SIBLING paints nothing', () => {
    const { win, doc } = mount(BOARD);
    expect((win as unknown as { __vosLiveMenu?: number }).__vosLiveMenu).toBe(1);
    send(win, livePos([{ slot: 'item.0', row: '0', s: 'soldout', t: { name: 'SPOOFED', price: '$0.01' } }]), sibling());
    expect(price(doc)).toBe('$15.25');
    expect(rowFlag(doc)).toBeNull();
    expect(doc.getElementById('vos-live-menu-css')).toBeNull();
  });

  it('the live menu from the PARENT paints — and greys a sold-out row', () => {
    const { win, doc } = mount(BOARD);
    send(win, livePos([SOLD_OUT_ROW]), win.parent);
    expect(price(doc)).toBe('Sold out');
    expect(rowFlag(doc)).toBe('soldout');
  });

  it('a message with NO source (a relay, a port) or from the board ITSELF paints nothing', () => {
    const { win, doc } = mount(BOARD);
    send(win, livePos([SOLD_OUT_ROW]), null);
    send(win, livePos([SOLD_OUT_ROW]), win);
    expect(price(doc)).toBe('$15.25');
    expect(rowFlag(doc)).toBeNull();
  });

  it('a SIBLING cannot unbind a live row (an empty menu is a real instruction from the parent)', () => {
    const { win, doc } = mount(BOARD);
    send(win, livePos([{ slot: 'item.0', row: '0', s: 'live', t: { name: '3 Birria Tacos', price: '$16.50' } }]), win.parent);
    expect(price(doc)).toBe('$16.50');
    send(win, livePos([]), sibling());
    expect(price(doc)).toBe('$16.50');
    send(win, livePos([]), win.parent);
    expect(price(doc)).toBe('$15.25');
  });
});

describe('NEGATIVE CONTROL — the same harness with ONLY the guard removed', () => {
  it('VOS-LIVE-MENU then paints a SIBLING’s menu', () => {
    const { win, doc } = mount(BOARD, { stripGuard: true });
    send(win, livePos([{ slot: 'item.0', row: '0', s: 'soldout', t: { name: 'SPOOFED', price: '$0.01' } }]), sibling());
    expect(price(doc)).toBe('$0.01');
    expect(rowFlag(doc)).toBe('soldout');
  });
});
