/**
 * What the operator is shown before they commit an import — and the same
 * record afterwards, so "what happened to my deck?" has an answer a week later.
 *
 * This is the one contract the review UI, the commit call and the import report
 * all read, so it is deliberately plain: no classes, no Dates, no Maps, nothing
 * that does not survive `JSON.stringify` unchanged. It is persisted as JSON on
 * `ImportJob.manifest`.
 *
 * TWO RULES SHAPE IT.
 *
 * Every source page appears exactly once, in source order, whatever happened to
 * it. The audit proved a three-page PDF producing two templates while the
 * success screen said "one per page"; the page that vanished was artwork-only.
 * So a page that produced nothing is a row that says so, never an absence.
 *
 * And it holds no source text. Geometry, counts, dispositions and warning codes
 * are enough to tell an operator what happened. The words on their slides are
 * not ours to persist in a job record or write to a log.
 */

import type {
  ImportManifestLike,
  ImportManifestPage,
  ImportPageMode,
} from '@cms/api-types';

/**
 * The shapes now live in `@cms/api-types` (2026-09-15) so the screen and this
 * service cannot drift apart. These aliases keep the local names the rest of
 * this module reads with.
 */
export type PageMode = ImportPageMode;
export type ManifestPage = ImportManifestPage;
export type ImportManifest = ImportManifestLike;

/**
 * What a read returns: the same page, with freshly minted links in place of the
 * stored keys. Kept as a distinct name because the DISTINCTION matters at the
 * call site even though the shape is now shared.
 */
export type ManifestPageView = ManifestPage;

/**
 * Is this page worth preselecting?
 *
 * A page we could not convert at all is never preselected — committing it
 * would create nothing. Everything else starts selected, because the common
 * case is "import my deck", not "import three pages of my deck".
 */
export function isSelectableByDefault(page: ManifestPage): boolean {
  return page.defaultMode !== null;
}

/**
 * The count the primary button shows. Nothing else is allowed to compute this:
 * a button that says "Add 6 templates" and creates 5 is the class of bug this
 * whole program exists to remove.
 */
export function selectedTemplateCount(
  manifest: ImportManifest,
  selectedPages: number[],
): number {
  const wanted = new Set(selectedPages);
  return manifest.pages.filter(
    (p) => wanted.has(p.sourcePage) && p.defaultMode !== null,
  ).length;
}

/**
 * Pages the operator has NOT accounted for: convertible, but left unselected.
 *
 * Not an error — deselecting a page is a legitimate choice — but the review
 * footer says how many, so "6 of 8 pages" is never a silent 2-page loss.
 */
export function unselectedConvertiblePages(
  manifest: ImportManifest,
  selectedPages: number[],
): number[] {
  const wanted = new Set(selectedPages);
  return manifest.pages
    .filter((p) => p.defaultMode !== null && !wanted.has(p.sourcePage))
    .map((p) => p.sourcePage);
}
