/**
 * designer-board-defects — the checks every AI Designer draft gets before anyone
 * renders it. The boards are real model output: the Super Taco wall GPT-6 Sol
 * wrote for Codex (__fixtures__/super-taco-burritos.board.html, provenance in its
 * header), cut the way a vendor that hits its output ceiling cuts it — mid-tag.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  designerBoardDefects,
  documentIncompleteness,
  hasBlocker,
  staticRedrawNudge,
  textEditability,
} from './designer-board-defects';

const BOARD = fs.readFileSync(path.join(__dirname, '__fixtures__', 'super-taco-burritos.board.html'), 'utf8');
/** What a reasoning model's finish_reason=length leaves: the board up to a point, mid-tag. */
const CUT = BOARD.slice(0, Math.floor(BOARD.length * 0.6));

describe('documentIncompleteness', () => {
  it('a whole document is complete', () => {
    expect(documentIncompleteness(BOARD)).toBeNull();
  });
  it('a document cut off mid-board is not — it never closes </html>', () => {
    expect(documentIncompleteness(CUT)).toMatch(/never closes <\/html>/);
  });
  it('<html> with no doctype, cut: still judged', () => {
    expect(documentIncompleteness('<html><body><div>x</div>')).toMatch(/<\/html>/);
  });
  it('closes </html> but never closes its <body>: incomplete', () => {
    expect(documentIncompleteness('<!doctype html><html><body><div>x</div></html>')).toMatch(/<body>/);
  });
  it('a bare fragment is not judged here', () => {
    expect(documentIncompleteness('<div class="stage"><h1>Hi</h1></div>')).toBeNull();
  });
});

describe('textEditability', () => {
  it('the Super Taco wall: almost every word is a data-field; the card numbers are not', () => {
    const t = textEditability(BOARD);
    expect(t.chars).toBeGreaterThan(300);
    expect(t.editableChars).toBeLessThan(t.chars);
    expect(t.samples).toEqual(expect.arrayContaining(['01', '02']));
    // Its logo's typeset fallback (inside the image slot) and the ✹ glyphs are not copy.
    expect(t.samples.join(' ')).not.toMatch(/SUPER TACO|✹/);
    expect((t.chars - t.editableChars) / t.chars).toBeLessThan(0.05);
  });
  it('aria-hidden ornament is not counted', () => {
    const t = textEditability('<body><div aria-hidden="true">BIG S</div><h1 data-field="h">Hello</h1></body>');
    expect(t).toEqual({ chars: 5, editableChars: 5, samples: [] });
  });
});

describe('designerBoardDefects', () => {
  it('a clean, whole board has no blocker (only the card numbers, as a minor)', () => {
    const d = designerBoardDefects(BOARD, {});
    expect(hasBlocker(d)).toBe(false);
    expect(d).toEqual([expect.objectContaining({ code: 'no-editable-text', severity: 'minor' })]);
  });

  it('TRUNCATED — the vendor flag alone is a blocker, with the token count', () => {
    const d = designerBoardDefects(BOARD, { truncated: true, outputTokens: 40_000 });
    expect(d[0]).toEqual({ code: 'truncated', severity: 'blocker', detail: 'the answer was cut off at the output ceiling after 40000 output tokens' });
  });

  it('INCOMPLETE — half a board is a blocker, and nothing else is judged on it', () => {
    const d = designerBoardDefects(CUT, { truncated: true, outputTokens: 12_000, logoUrl: 'https://x.example/logo.png' });
    expect(d.map((x) => [x.code, x.severity])).toEqual([
      ['truncated', 'blocker'],
      ['incomplete-document', 'blocker'],
    ]);
  });

  it('NO EDITABLE TEXT — a board with no data-field anywhere is a blocker', () => {
    const noKeys = BOARD.replace(/ data-field="[^"]*"/g, '');
    const d = designerBoardDefects(noKeys, {});
    expect(d).toEqual([expect.objectContaining({ code: 'no-editable-text', severity: 'blocker' })]);
  });

  it('a quarter or more of the copy uneditable is a major, never a blocker', () => {
    const html = '<!doctype html><html><body><div class="stage"><h1 data-field="headline">Lunch, Handled</h1><div class="badge"><div>DEAL</div><div>2 for 6</div><div>All Day</div></div></div></body></html>';
    const d = designerBoardDefects(html, {});
    expect(d).toEqual([expect.objectContaining({ code: 'no-editable-text', severity: 'major' })]);
    expect(hasBlocker(d)).toBe(false);
  });

  it('NO IMAGE SLOT — a supplied logo / photo the board does not use is a major', () => {
    const logo = 'https://abc.supabase.co/storage/v1/object/public/assets/ai-designer/t1/logo-1.png';
    const hero = 'https://abc.supabase.co/storage/v1/object/public/assets/ai-designer/t1/photo-2.jpg?w=1&h=2';
    const d = designerBoardDefects(BOARD, { logoUrl: logo, heroImageUrl: hero });
    expect(d.filter((x) => x.code === 'no-image-slot').map((x) => x.severity)).toEqual(['major', 'major']);
    // Used (attribute-escaped `&amp;` counts) → no defect.
    const withBoth = BOARD.replace('<body>', `<body><img data-imgslot="logo" src="${logo}"><img data-imgslot="hero" src="${hero.replace(/&/g, '&amp;')}">`);
    expect(designerBoardDefects(withBoth, { logoUrl: logo, heroImageUrl: hero }).filter((x) => x.code === 'no-image-slot')).toEqual([]);
  });

  it('BINDING — the POS binder\'s verdict rides along as a blocker naming the rows', () => {
    const d = designerBoardDefects(BOARD, { binding: { ok: false, missing: [2, 5] } });
    expect(d[0]).toEqual({ code: 'binding-incomplete', severity: 'blocker', detail: 'planned POS rows missing: [item.2], [item.5]' });
    expect(designerBoardDefects(BOARD, { binding: { ok: true, missing: [] } }).some((x) => x.code === 'binding-incomplete')).toBe(false);
  });
});

describe('staticRedrawNudge', () => {
  it('a cut-off draft is told it was cut off, after how many tokens, and what to do', () => {
    const n = staticRedrawNudge(designerBoardDefects(CUT, { truncated: true, outputTokens: 12_000 }), 12_000);
    expect(n).toBe(
      '\n\nIMPORTANT — your previous answer was cut off after 12000 tokens before the document ended — return the COMPLETE document this time, ending with </html>: tighter CSS, no comments, nothing after </html>.',
    );
  });
  it('an uneditable draft is told every text element needs data-field', () => {
    const n = staticRedrawNudge(designerBoardDefects(BOARD.replace(/ data-field="[^"]*"/g, ''), {}));
    expect(n).toContain('every text element needs data-field="<key>"');
  });
  it('nothing to say for a board with only majors/minors (no redraw)', () => {
    expect(staticRedrawNudge(designerBoardDefects(BOARD, { logoUrl: 'https://x/l.png' }))).toBe('');
  });
});
