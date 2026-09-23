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
import * as fs from 'fs';
import * as path from 'path';
import { buildSafeDesignerSrcdoc } from '../designer-safe-srcdoc';

// The real producer — the same computed-path require tests/fixtures/kept-pos-board.ts
// uses, so API source never joins the web type program.
const API_AI = path.resolve(__dirname, '../../../../api/src/ai');
/* eslint-disable @typescript-eslint/no-require-imports */
const { injectDesignerEditShim } = require(path.join(API_AI, 'designer-edit-shim.ts')) as {
  injectDesignerEditShim: (html: string) => string;
};
/* eslint-enable @typescript-eslint/no-require-imports */

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

/** A board kept today: the API producer bakes the edit shim. */
const KEPT_TODAY = () => injectDesignerEditShim(BOARD);

/** Every EDUCMS-SHIM-V6 body ever baked into a kept board, byte for byte. */
const V6_BODIES = (JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../../tests/fixtures/educms-shim-v6-bodies.json'), 'utf8'),
) as { bodies: Array<{ commit: string; body: string }> }).bodies;
/** A board kept before V7: its saved shim block is one of those V6 bodies. */
const KEPT_WITH = (body: string) => BOARD.replace('</head>', () => `<script>${body}</script></head>`);

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

const OVERRIDES = {
  type: 'educms-overrides',
  brand: { primary: '#123456' },
  text: { headline: 'Weekend Specials' },
  textStyles: { headline: { color: '#123456' } },
  img: { hero: 'https://cdn.example/hero.jpg' },
  actions: { order: { type: 'open-url', target: 'https://example.com/order' } },
};

function looks(doc: Document) {
  const headline = doc.querySelector('[data-field="headline"]') as HTMLElement;
  return {
    headline: headline.textContent,
    color: headline.style.color,
    hero: (doc.querySelector('[data-imgslot="hero"]') as HTMLElement).getAttribute('data-img'),
    brand: doc.documentElement.style.getPropertyValue('--brand-primary'),
    wired: (doc.querySelector('[data-action="order"]') as HTMLElement).getAttribute('data-action-wired'),
  };
}
const PRISTINE = { headline: 'Taco Tuesday', color: '', hero: null, brand: '', wired: '0' };
const APPLIED = {
  headline: 'Weekend Specials',
  color: 'rgb(18, 52, 86)',
  hero: 'https://cdn.example/hero.jpg',
  brand: '#123456',
  wired: '1',
};

/** Click `el` inside the board and collect the `type` messages the board posts to THIS (parent) window. */
async function reportsAfterClick(el: HTMLElement, type: 'educms-field-click' | 'educms-action'): Promise<unknown[]> {
  const got: unknown[] = [];
  const on = (e: MessageEvent) => {
    const d = e.data as { type?: string } | null;
    if (d && d.type === type) got.push(d);
  };
  window.addEventListener('message', on);
  el.click();
  await new Promise((r) => setTimeout(r, 25)); // jsdom delivers postMessage on a 0 ms timer
  window.removeEventListener('message', on);
  return got;
}
const clickReports = (el: HTMLElement) => reportsAfterClick(el, 'educms-field-click');
const WIRED = { type: 'educms-overrides', actions: { order: { type: 'open-url', target: 'https://example.com/order' } } };

const price = (doc: Document) => (doc.querySelector('[data-field="item.0.price"]')?.textContent || '').trim();
const rowFlag = (doc: Document) => doc.querySelector('[data-menu-row="0"]')!.getAttribute('data-vos-lm');
const livePos = (rows: unknown[]) => ({ type: 'educms-overrides', pos: { v: 1, rows, fields: [] } });
const SOLD_OUT_ROW = { slot: 'item.0', row: '0', s: 'soldout', t: { name: '3 Birria Tacos', price: 'Sold out' } };

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the baked edit shim hears its parent only', () => {
  it('both runtimes open their message listener with the same guard, exactly once', () => {
    const srcdoc = buildSafeDesignerSrcdoc(KEPT_TODAY());
    const scripts = Array.from(new DOMParser().parseFromString(srcdoc, 'text/html').querySelectorAll('script'))
      .map((s) => s.textContent || '');
    const listening = scripts.filter((s) => /addEventListener\(["']message["']/.test(s));
    expect(listening.map((s) => s.slice(0, s.indexOf('*/') + 2))).toEqual(['/*EDUCMS-SHIM-V7*/', '/*VOS-LIVE-MENU*/']);
    for (const s of listening) {
      expect(s.split(GUARD).length - 1).toBe(1);
      expect(s).toMatch(/addEventListener\(["']message["'],function\(e\)\{try\{if\(e\.source!==window\.parent\)return;/);
    }
  });

  it('overrides from a SIBLING frame change nothing — words, colour, image, brand, actions', () => {
    const { win, doc } = mount(KEPT_TODAY());
    expect(looks(doc)).toEqual(PRISTINE);
    send(win, OVERRIDES, sibling());
    expect(looks(doc)).toEqual(PRISTINE);
  });

  it('the same overrides from the PARENT all land', () => {
    const { win, doc } = mount(KEPT_TODAY());
    send(win, OVERRIDES, win.parent);
    expect(looks(doc)).toEqual(APPLIED);
  });

  it('a message with NO source (a relay, a port) or from the board ITSELF changes nothing', () => {
    const { win, doc } = mount(KEPT_TODAY());
    send(win, OVERRIDES, null);
    send(win, OVERRIDES, win);
    expect(looks(doc)).toEqual(PRISTINE);
  });

  it('`educms-edit-mode` from a SIBLING does not arm the board — no hover zones, no click reports', async () => {
    const { win, doc } = mount(KEPT_TODAY());
    send(win, { type: 'educms-edit-mode', on: true }, sibling());
    const headline = doc.querySelector('[data-field="headline"]') as HTMLElement;
    expect(headline.style.cursor).toBe('');
    expect(await clickReports(headline)).toEqual([]);
  });

  it('`educms-edit-mode` from the PARENT arms it, and a click reports to the parent', async () => {
    const { win, doc } = mount(KEPT_TODAY());
    send(win, { type: 'educms-edit-mode', on: true }, win.parent);
    const headline = doc.querySelector('[data-field="headline"]') as HTMLElement;
    expect(headline.style.cursor).toBe('pointer');
    expect(await clickReports(headline)).toEqual([{ type: 'educms-field-click', key: 'headline', kind: 'text' }]);
  });

  // What edit mode actually gates is whether a tap on a WIRED hot zone fires
  // its action (`onActionTap` returns early in edit mode). A sibling that can
  // flip it can silence every touch target on a kiosk — or make a tap in the
  // builder fire instead of configure.
  it('a SIBLING cannot switch edit mode ON on a live screen: a wired tap still fires', async () => {
    const { win, doc } = mount(KEPT_TODAY());
    send(win, WIRED, win.parent);
    send(win, { type: 'educms-edit-mode', on: true }, sibling());
    const order = doc.querySelector('[data-action="order"]') as HTMLElement;
    expect(await reportsAfterClick(order, 'educms-action')).toEqual([
      { type: 'educms-action', key: 'order', action: WIRED.actions.order },
    ]);
  });

  it('a SIBLING cannot switch the builder’s edit mode OFF: a tap on a wired zone configures it, never fires it', async () => {
    const { win, doc } = mount(KEPT_TODAY());
    send(win, WIRED, win.parent);
    send(win, { type: 'educms-edit-mode', on: true }, win.parent);
    send(win, { type: 'educms-edit-mode', on: false }, sibling());
    const order = doc.querySelector('[data-action="order"]') as HTMLElement;
    expect(await reportsAfterClick(order, 'educms-action')).toEqual([]);
  });
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

  it('a SIBLING’s words never reach a live field, nor become the words it falls back to', () => {
    const { win, doc } = mount(KEPT_TODAY()); // both runtimes, as on a real kept board
    send(win, livePos([{ slot: 'item.0', row: '0', s: 'live', t: { name: '3 Birria Tacos', price: '$16.50' } }]), win.parent);
    send(win, { type: 'educms-overrides', text: { 'item.0.price': '$0.01' } }, sibling());
    expect(price(doc)).toBe('$16.50');
    send(win, livePos([]), win.parent); // unbound → the board's OWN words, not the sibling's
    expect(price(doc)).toBe('$15.25');
  });
});

describe('a board kept BEFORE V7 is protected too — every V6 body ever baked, swapped at render', () => {
  it.each(V6_BODIES.map((b) => [b.commit, b.body] as const))('V6 from %s: a SIBLING is ignored, the PARENT lands', (_commit, body) => {
    const sib = mount(KEPT_WITH(body));
    send(sib.win, { type: 'educms-overrides', text: { headline: 'SPOOFED' }, img: { hero: 'https://evil.example/x.png' } }, sibling());
    send(sib.win, { type: 'educms-edit-mode', on: true }, sibling());
    const headline = sib.doc.querySelector('[data-field="headline"]') as HTMLElement;
    expect(headline.textContent).toBe('Taco Tuesday');
    expect(headline.style.cursor).toBe('');
    expect((sib.doc.querySelector('[data-imgslot="hero"]') as HTMLElement).getAttribute('data-img')).toBeNull();

    const par = mount(KEPT_WITH(body));
    send(par.win, { type: 'educms-overrides', text: { headline: 'Weekend Specials' } }, par.win.parent);
    send(par.win, { type: 'educms-edit-mode', on: true }, par.win.parent);
    const parHeadline = par.doc.querySelector('[data-field="headline"]') as HTMLElement;
    expect(parHeadline.textContent).toBe('Weekend Specials');
    expect(parHeadline.style.cursor).toBe('pointer');
  });
});

describe('NEGATIVE CONTROL — the same harness with ONLY the guard removed', () => {
  it('the edit shim then applies a SIBLING’s overrides (so the harness really delivers them)', () => {
    const { win, doc } = mount(KEPT_TODAY(), { stripGuard: true });
    send(win, OVERRIDES, sibling());
    expect(looks(doc)).toEqual(APPLIED);
  });

  it('the edit shim then lets a SIBLING arm edit mode', async () => {
    const { win, doc } = mount(KEPT_TODAY(), { stripGuard: true });
    send(win, { type: 'educms-edit-mode', on: true }, sibling());
    const headline = doc.querySelector('[data-field="headline"]') as HTMLElement;
    expect(headline.style.cursor).toBe('pointer');
    expect(await clickReports(headline)).toHaveLength(1);
  });

  it('a saved V6 board, run as it was saved (no guard), takes a SIBLING’s words', () => {
    const { win, doc } = mount(KEPT_WITH(V6_BODIES[V6_BODIES.length - 1].body), { stripGuard: true });
    send(win, { type: 'educms-overrides', text: { headline: 'SPOOFED' } }, sibling());
    expect((doc.querySelector('[data-field="headline"]') as HTMLElement).textContent).toBe('SPOOFED');
  });

  it('VOS-LIVE-MENU then paints a SIBLING’s menu', () => {
    const { win, doc } = mount(BOARD, { stripGuard: true });
    send(win, livePos([{ slot: 'item.0', row: '0', s: 'soldout', t: { name: 'SPOOFED', price: '$0.01' } }]), sibling());
    expect(price(doc)).toBe('$0.01');
    expect(rowFlag(doc)).toBe('soldout');
  });
});
