/**
 * selectVectorLogo — pure decision for the "preserve a scraped vector logo"
 * fix (task #223, the Domino's bug). No I/O, no NestJS, no DOMPurify — just
 * the selection logic, so the bug-prone part is unit-testable in isolation.
 *
 * The controller does the actual rehost on whatever this returns. Why a
 * vector matters: a rasterized wordmark renders pixelated on a 4K signage
 * wall — the single most visible "this looks cheap" failure on the product.
 * Adopt used to fall straight from a rejected/unpinned SVG to the raster
 * og:image; this scans EVERY candidate for a vector first.
 */

export interface VectorLogoCandidate {
  url?: string;
  isSvg?: boolean;
  svgInline?: string;
}

export type VectorLogoChoice =
  | { kind: 'inline'; svgInline: string }
  | { kind: 'url'; url: string };

/** Favicons (.ico/.icns) are 16–32px browser-tab icons, never a logo. */
function isFavicon(url: string): boolean {
  return /\.(ico|icns)(\?|#|$)/i.test(url);
}

/**
 * Pick a vector logo from the scraped candidate list, scanning ALL of them
 * (not just position #1). Precedence:
 *   1) an inline SVG that passes the caller's shape-primitive gate (isRealSvg)
 *      — highest fidelity, no extra fetch.
 *   2) a candidate whose URL is a `.svg` (or carries the isSvg flag).
 * Returns null when no vector exists — the caller then uses its raster
 * fallback chain unchanged.
 */
export function selectVectorLogo(
  logos: VectorLogoCandidate[] | undefined | null,
  isRealSvg: (s: string | null) => boolean,
): VectorLogoChoice | null {
  if (!Array.isArray(logos)) return null;

  // (1) Inline-SVG vector.
  for (const cand of logos) {
    const svg = cand?.svgInline;
    if (svg && isRealSvg(svg)) return { kind: 'inline', svgInline: svg };
  }

  // (2) URL-referenced SVG vector.
  for (const cand of logos) {
    const url = cand?.url;
    if (!url || isFavicon(url)) continue;
    const looksVector = cand?.isSvg === true || /\.svg(\?|#|$)/i.test(url);
    if (looksVector) return { kind: 'url', url };
  }

  return null;
}
