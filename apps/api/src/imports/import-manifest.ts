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
import type { ImportWarning, PageDisposition } from './parsers/types';

/** How a page will be turned into a template, if the operator selects it. */
export type PageMode =
  /**
   * The page as it looks: a rendered image, full bleed. Text inside is part of
   * the picture and is not individually editable. This is what every other
   * signage CMS gives you for a whole import, and it is the right answer for a
   * dense or scanned page.
   */
  | 'preserve'
  /**
   * The page's text and pictures as real builder zones the operator can retype,
   * restyle and promote into live widgets. Higher value, lower fidelity: a
   * reconstruction always differs from the source somewhere.
   */
  | 'editable';

export interface ManifestPage {
  /** 1-based page/slide number in the SOURCE document. Never renumbered. */
  sourcePage: number;
  /** "Page 3" / "Slide 3" — what to call it in the UI. */
  label: string;
  disposition: PageDisposition;
  /** Modes we can actually produce for THIS page. Never offer an empty one. */
  availableModes: PageMode[];
  /** Preselected mode. `null` when the page cannot be converted at all. */
  defaultMode: PageMode | null;
  /** How many editable objects the editable mode would produce. */
  editableTextCount: number;
  editableImageCount: number;
  /** Staged artifact keys — keys, never URLs, which expire (see the sweep). */
  rasterObjectKey?: string;
  thumbObjectKey?: string;
  /** Rendered pixel size, when this page has a raster. */
  widthPx?: number;
  heightPx?: number;
  /** Everything this page lost or approximated. Shown per page in review. */
  warnings: ImportWarning[];
}

export interface ImportManifest {
  /** Bumped when the shape changes incompatibly; a stale job is then refused. */
  version: 1;
  format: 'pdf' | 'pptx' | 'image';
  /** TRUE page count from the document, independent of what converted. */
  sourcePageCount: number;
  pages: ManifestPage[];
  /** Document-scoped warnings. Page-scoped ones live on their page. */
  warnings: ImportWarning[];
  /**
   * Why `preserve` is missing from every page, when it is. PowerPoint has no
   * server-side renderer here, so a deck can only be offered as editable
   * layers — and the operator deserves the reason, plus the one-click fix,
   * rather than a mode that is silently absent.
   */
  preserveUnavailableReason?: string;
}

/** What the review UI needs that the manifest deliberately does not persist. */
export interface ManifestPageView extends ManifestPage {
  /** Short-lived signed URL for the page raster. Minted per read. */
  previewUrl?: string;
  thumbUrl?: string;
}

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
