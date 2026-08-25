/**
 * external-chat-fields — the packaged-board chat inventory parser
 * (B11 dead-end fix, 2026-08-24). Mirrors ExternalHtmlTextEditor's
 * discovery rules; these tests pin them so the two can't drift silently.
 */
import { parseExternalChatFields } from '../external-chat-fields';

const BOARD_HTML = `
<!doctype html><html><body>
  <h1 data-field="hero.title">WELCOME BACK<small>est. 1922</small></h1>
  <p data-field="hero.sub">Home of the Eagles</p>
  <p data-field="hero.sub">duplicate key — must be ignored</p>
  <span data-field="clock.mode">live</span>
  <span data-field="carousel.interval">8</span>
  <span data-field="theme.bg">#0b1220</span>
  <span data-field="theme.brand">#4f46e5</span>
  <div data-field="menu.item1">Cheeseburger</div>
  <div data-field=""></div>
</body></html>`;

describe('parseExternalChatFields', () => {
  it('discovers copy fields with first-text-node defaults and humanized labels', () => {
    const out = parseExternalChatFields(BOARD_HTML, {});
    const keys = out.map((f) => f.key);
    expect(keys).toEqual(['hero.title', 'hero.sub', 'menu.item1']);
    const title = out.find((f) => f.key === 'hero.title')!;
    // First text node only — the nested <small> is not flattened in.
    expect(title.value).toBe('WELCOME BACK');
    expect(title.label).toBe('Hero title');
  });

  it('filters config spans (clock./carousel./theme./…) — settings and palette tokens are not chat copy', () => {
    const out = parseExternalChatFields(BOARD_HTML, {});
    expect(out.some((f) => f.key.startsWith('clock.'))).toBe(false);
    expect(out.some((f) => f.key.startsWith('carousel.'))).toBe(false);
    // theme.* are hex palette tokens (live-verified on hs/yearbook.html) —
    // style config the validator refuses anyway; never offer them as copy.
    expect(out.some((f) => f.key.startsWith('theme.'))).toBe(false);
  });

  it('operator overrides win as the EFFECTIVE value', () => {
    const out = parseExternalChatFields(BOARD_HTML, { 'hero.sub': 'Go Eagles!' });
    expect(out.find((f) => f.key === 'hero.sub')!.value).toBe('Go Eagles!');
    // Un-overridden fields keep the board default.
    expect(out.find((f) => f.key === 'hero.title')!.value).toBe('WELCOME BACK');
  });

  it('dedupes keys (first occurrence wins) and handles empty/garbage input', () => {
    const out = parseExternalChatFields(BOARD_HTML, {});
    expect(out.filter((f) => f.key === 'hero.sub')).toHaveLength(1);
    expect(out.find((f) => f.key === 'hero.sub')!.value).toBe('Home of the Eagles');
    expect(parseExternalChatFields('', {})).toEqual([]);
  });

  it('caps the inventory at 48 fields', () => {
    const many = Array.from({ length: 60 }, (_, i) => `<p data-field="f${i}">v${i}</p>`).join('');
    const out = parseExternalChatFields(`<html><body>${many}</body></html>`, {});
    expect(out).toHaveLength(48);
  });
});
