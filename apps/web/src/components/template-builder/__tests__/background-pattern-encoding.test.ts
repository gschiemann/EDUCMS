/**
 * Background patterns must reach the browser with real colours (Codex T06,
 * 2026-09-13). The sources carried pre-escaped '%23' and were encoded again,
 * so every pattern's fill decoded to '%23cbd5e1' — not a colour. Mutation
 * check: put '%23' back in a source (or re-add the '%23'→'#' replace) and the
 * first test fails.
 */
import { SVG_PATTERNS, patternToCss } from '../BackgroundPanel';

const payload = (css: string) => {
  const m = /url\("data:image\/svg\+xml;utf8,([^"]+)"\)/.exec(css);
  if (!m) throw new Error('no data url in ' + css);
  return m[1];
};

describe('patternToCss', () => {
  it.each(SVG_PATTERNS.map((p) => [p.name, p] as const))('%s decodes to literal # colours, never %%23', (_name, p) => {
    const css = patternToCss(p);
    const raw = payload(css);
    expect(raw).not.toContain('#');                 // a raw # would start a URL fragment
    const decoded = decodeURIComponent(raw);
    expect(decoded).not.toContain('%23');
    expect(decoded).toMatch(/(fill|stroke)='#[0-9a-f]{6}'/);
    expect(css.startsWith(p.bg)).toBe(true);
  });
  it('encodes exactly once (decoding once yields the source svg)', () => {
    const p = SVG_PATTERNS[0];
    expect(decodeURIComponent(payload(patternToCss(p)))).toBe(p.svg);
  });
});
