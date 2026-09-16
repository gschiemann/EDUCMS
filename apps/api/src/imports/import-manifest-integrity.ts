/**
 * The manifest invariant `preserve` depends on, checked rather than assumed.
 *
 * A page offered as `preserve` IS its render: the operator selects it, commit
 * reads `rasterObjectKey` back out of the staging bucket and publishes those
 * bytes as the template's only zone. So a page that offers `preserve` with no
 * raster key — or with no pixel size to build a canvas from — is an offer the
 * system cannot keep. Before 2026-09-16 nothing looked: prepare happened to
 * always set the key, and if it ever stopped, the page would have sat on the
 * review screen preselected, been counted in "Add 6 templates", and then either
 * refused the whole commit (since R4) or, before that, silently produced
 * nothing (re-audit R6).
 *
 * "Happens to be true" is not an invariant, so this module states it, and
 * prepare enforces it BEFORE the manifest is persisted: a page with a gap is
 * demoted to unselectable and says why, which is the loud failure. The same
 * pure functions are the detector — run `findRasterGaps` over a stored manifest
 * and a non-empty answer is the condition, named per page.
 */
import type { ImportManifest, ManifestPage } from './import-manifest';
import type { ImportWarning } from './parsers/types';

/** Why one page's `preserve` offer cannot be kept. */
export type RasterGapReason =
  /** Offered as `preserve`, but no staged render was ever recorded. */
  | 'no-raster-key'
  /** A render exists, but no pixel size — there is no canvas to build. */
  | 'no-dimensions';

export interface RasterGap {
  sourcePage: number;
  reason: RasterGapReason;
}

/**
 * Pages whose `preserve` offer is not backed by a usable render.
 *
 * Pure and manifest-shaped rather than job-shaped, so it runs against a live
 * manifest inside prepare, against a persisted one in a test, and against a
 * row read out of the database in a reconciliation script — same answer, no
 * database and no storage call.
 */
export function findRasterGaps(manifest: Pick<ImportManifest, 'pages'>): RasterGap[] {
  const gaps: RasterGap[] = [];
  for (const page of manifest.pages ?? []) {
    if (!offersPreserve(page)) continue;
    if (!page.rasterObjectKey) {
      gaps.push({ sourcePage: page.sourcePage, reason: 'no-raster-key' });
      continue;
    }
    if (!isPositive(page.widthPx) || !isPositive(page.heightPx)) {
      gaps.push({ sourcePage: page.sourcePage, reason: 'no-dimensions' });
    }
  }
  return gaps;
}

/**
 * Take the unkeepable offer away, and say so on the page.
 *
 * Returns NEW page objects — the caller's array is not mutated — with the
 * affected pages carrying no mode at all. `defaultMode: null` is the manifest's
 * existing word for "this page cannot be converted", which the review screen
 * already renders as unselectable and which `selectedTemplateCount` already
 * excludes from the button. So the correction needs no new UI: an operator sees
 * a page they cannot add, with a sentence saying the render is missing, instead
 * of a page they can add that would produce nothing.
 *
 * Deliberately NOT a deletion. Every source page keeps its row — that is the
 * manifest's first rule, and a page that vanished is exactly the failure the
 * whole import program exists to end.
 */
export function demoteRasterGaps(pages: ManifestPage[]): {
  pages: ManifestPage[];
  gaps: RasterGap[];
} {
  const gaps = findRasterGaps({ pages });
  if (gaps.length === 0) return { pages, gaps };
  const byPage = new Map(gaps.map((g) => [g.sourcePage, g]));
  return {
    gaps,
    pages: pages.map((page) => {
      const gap = byPage.get(page.sourcePage);
      if (!gap) return page;
      return {
        ...page,
        availableModes: [],
        defaultMode: null,
        warnings: [...page.warnings, gapWarning(gap)],
      };
    }),
  };
}

/** The sentence a demoted page carries. Operator-readable, no internals. */
export function gapWarning(gap: RasterGap): ImportWarning {
  return {
    code: 'PAGE_UNREADABLE',
    sourcePage: gap.sourcePage,
    detail:
      gap.reason === 'no-raster-key'
        ? 'This page could not be rendered, so it cannot be added. Import the file again, or export just this page and import that.'
        : 'This page rendered at an unknown size, so it cannot be added. Import the file again, or export just this page and import that.',
  };
}

/**
 * One line for the log when a gap is found. Page numbers and a reason —
 * never a filename, never anything off the operator's page.
 */
export function describeRasterGaps(gaps: RasterGap[]): string {
  return gaps.map((g) => `p${g.sourcePage}:${g.reason}`).join(',');
}

function offersPreserve(page: ManifestPage): boolean {
  return (page.availableModes ?? []).includes('preserve');
}

function isPositive(n: number | undefined): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}
