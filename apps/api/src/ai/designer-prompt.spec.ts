import {
  DESIGNER_FONTS,
  DESIGNER_SYSTEM_PROMPT,
  DESIGNER_ART_DIRECTIONS,
  buildDesignerUserPrompt,
  sanitizeDesignerHtml,
  auditDesignerHtmlTaurus,
} from './designer-prompt';

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
