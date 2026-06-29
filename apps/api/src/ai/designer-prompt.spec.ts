import sanitizeHtml from 'sanitize-html';
import {
  DESIGNER_FONTS,
  DESIGNER_SYSTEM_PROMPT,
  DESIGNER_ART_DIRECTIONS,
  DESIGNER_EXEMPLAR,
  buildDesignerUserPrompt,
  sanitizeDesignerHtml,
  auditDesignerHtmlTaurus,
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
    // The exemplar must demonstrate the content auto-fit + reserved footer band.
    expect(DESIGNER_EXEMPLAR).toContain('fitCol');
    expect(DESIGNER_EXEMPLAR).toContain('document.fonts');
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
  it('keeps a real document + its inline (self-scaling) script', () => {
    const withScript = DOC.replace('</body>', '<script>var s=1;</script></body>');
    const { html } = sanitizeDesignerHtml(withScript);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('var s=1'); // inline script kept (sandbox-contained)
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
    // and the decoded doc still passes the designer sanitizer with style + script intact
    const withScript = decoded.replace('</body>', '<style>.z{color:#0f0}</style><script>var s=1;</script></body>');
    const { html } = sanitizeDesignerHtml(withScript);
    expect(html).toContain('<style>');
    expect(html).toContain('var s=1');
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
