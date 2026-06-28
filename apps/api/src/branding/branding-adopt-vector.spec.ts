/**
 * selectVectorLogo — vector-logo preservation on adopt (task #223, Domino's).
 *
 * When the operator's pinned SVG is rejected (corrupt-in-transit or a
 * text-only wordmark) OR a raster is pinned while a crisp vector sits
 * elsewhere in the candidate list, adopt used to rasterize and ship a
 * pixelated wordmark to a 4K wall. This guards the pure decision: scan EVERY
 * candidate and keep the vector. (I/O is done by the controller around it.)
 */
import { selectVectorLogo } from './select-vector-logo';

// The same shape-primitive gate the adopt path passes in: a real wordmark has
// at least one shape primitive and is over a 200-char floor.
const isRealSvg = (s: string | null): boolean => {
  if (!s || s.length < 200) return false;
  return /<(path|circle|rect|polygon|polyline|ellipse|image|use)\b/i.test(s);
};

const VALID_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100">' +
  '<path d="M10 10 H 390 V 90 H 10 Z" fill="#e8112d"/>' +
  '<rect x="20" y="20" width="60" height="60" fill="#0b6efd"/>' +
  '</svg>' +
  '<!-- padding so the 200-char minimum-length validator passes -->';

describe('selectVectorLogo (vector preservation)', () => {
  it('keeps an inline SVG vector even when a RASTER is pinned first', () => {
    const choice = selectVectorLogo(
      [
        { url: 'https://site/og-image.png', isSvg: false }, // pinned raster #0
        { url: '', isSvg: true, svgInline: VALID_SVG }, // vector behind it
      ],
      isRealSvg,
    );
    expect(choice).toEqual({ kind: 'inline', svgInline: VALID_SVG });
  });

  it('prefers an inline SVG over a `.svg` URL when both exist', () => {
    const choice = selectVectorLogo(
      [
        { url: 'https://site/logo.svg', isSvg: true },
        { url: '', svgInline: VALID_SVG },
      ],
      isRealSvg,
    );
    expect(choice).toEqual({ kind: 'inline', svgInline: VALID_SVG });
  });

  it('falls back to a `.svg` URL vector when no inline SVG is present', () => {
    const choice = selectVectorLogo(
      [
        { url: 'https://site/og-image.png' },
        { url: 'https://site/logo.svg', isSvg: true },
      ],
      isRealSvg,
    );
    expect(choice).toEqual({ kind: 'url', url: 'https://site/logo.svg' });
  });

  it('detects a vector by `.svg` extension even without the isSvg flag', () => {
    const choice = selectVectorLogo([{ url: 'https://site/brand/wordmark.svg' }], isRealSvg);
    expect(choice).toEqual({ kind: 'url', url: 'https://site/brand/wordmark.svg' });
  });

  it('detects a `.svg?v=2` URL with a query string', () => {
    const choice = selectVectorLogo([{ url: 'https://cdn/logo.svg?v=2' }], isRealSvg);
    expect(choice).toEqual({ kind: 'url', url: 'https://cdn/logo.svg?v=2' });
  });

  it('returns null when only rasters / favicons exist (caller uses raster fallback)', () => {
    const choice = selectVectorLogo(
      [
        { url: 'https://site/favicon.ico' },
        { url: 'https://site/og-image.png' },
      ],
      isRealSvg,
    );
    expect(choice).toBeNull();
  });

  it('ignores a corrupt/too-short inline SVG (the 1-char "®" transit mangle)', () => {
    const choice = selectVectorLogo(
      [
        { url: '', isSvg: true, svgInline: '®' },
        { url: 'https://site/og-image.png' },
      ],
      isRealSvg,
    );
    expect(choice).toBeNull();
  });

  it('ignores a text-only SVG with no shape primitive (the Chardon decorative wordmark)', () => {
    const textOnly =
      '<svg xmlns="http://www.w3.org/2000/svg"><text x="0" y="20">Chardon Footer Logo</text></svg>' +
      '<!-- padded over 200 chars to isolate the no-shape-primitive rejection path here -->';
    const choice = selectVectorLogo([{ url: '', isSvg: true, svgInline: textOnly }], isRealSvg);
    expect(choice).toBeNull();
  });

  it('never treats a `.ico` favicon as a vector even if isSvg is mislabeled', () => {
    const choice = selectVectorLogo([{ url: 'https://site/favicon.ico', isSvg: true }], isRealSvg);
    expect(choice).toBeNull();
  });

  it('returns null for an empty / missing candidate list', () => {
    expect(selectVectorLogo([], isRealSvg)).toBeNull();
    expect(selectVectorLogo(undefined, isRealSvg)).toBeNull();
    expect(selectVectorLogo(null, isRealSvg)).toBeNull();
  });
});
