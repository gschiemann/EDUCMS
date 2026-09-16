/**
 * The shapes the import screen and the import API agree on.
 *
 * Kept in their own module so the review logic is testable without mounting a
 * page, and so the copy that describes a warning lives next to the code that
 * branches on it.
 */

import type {
  ImportCommitResultLike,
  ImportManifestLike,
  ImportManifestPage,
  ImportPageDisposition,
  ImportPageMode,
  ImportWarningLike,
} from '@cms/api-types';

/**
 * The shapes come from `@cms/api-types` (2026-09-15). This file used to declare
 * its own copy, which is a contract that drifts silently: a field added on the
 * server or a disposition renamed, and this screen keeps compiling while
 * rendering the wrong thing. The aliases keep the names this module reads with.
 */
export type PageMode = ImportPageMode;
export type PageDisposition = ImportPageDisposition;
export type ImportWarning = ImportWarningLike;
export type ManifestPage = ImportManifestPage;
export type ImportManifest = ImportManifestLike;

export interface PrepareResponse {
  ok: boolean;
  jobId: string;
  manifest: ImportManifest;
}

export type CommitResponse = ImportCommitResultLike & { ok: boolean };

/**
 * What each mode promises, in the words we are willing to defend.
 *
 * `preserve` is the only mode a PDF or a picture offers, so its copy says what
 * that gets you and no more: the design, intact, as one image, with room for
 * live content on top. It never promises editable words — they are part of the
 * image. `editable` is offered for a PowerPoint alone, the one source we
 * rebuild into separate text and pictures (re-audit R1/R2, 2026-09-15).
 */
export const MODE_COPY: Record<PageMode, { label: string; blurb: string }> = {
  preserve: {
    label: 'Keep the look',
    blurb:
      'Your design stays intact, as an image. The words in it are part of that image — ' +
      'you can add new text, QR codes and live widgets on top.',
  },
  editable: {
    label: 'Editable layers',
    blurb:
      "The slide's text and pictures are rebuilt as elements you can retype, restyle and make live. " +
      'A rebuild never matches the slide exactly, so check it once it is added.',
  },
};

/**
 * Is this prepare failure worth sending the SAME file again?
 *
 * The API answers 503 when the converter is busy or briefly unavailable — its
 * problem, not the file's (re-audit R3). Every other refusal is about the file
 * itself, and resending it would only repeat the answer.
 */
export function isRetryablePrepareFailure(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: unknown }).status === 503
  );
}

/** The mode a page will be added in: the operator's choice, else the page's default. */
export function effectiveMode(
  page: ManifestPage,
  selection: Map<number, PageMode>,
): PageMode | null {
  return selection.get(page.sourcePage) ?? page.defaultMode;
}

/**
 * A picture of what this page will BECOME — and never a picture of anything else.
 *
 * The staged render is exactly what `preserve` publishes, so it is shown for
 * `preserve` and for nothing else. An editable rebuild has no picture until it
 * exists, and putting the render beside that choice would present the original
 * as evidence of a conversion it is not — which is what the review screen did
 * until the re-audit (R2).
 */
export function outputPreview(
  page: ManifestPage,
  selection: Map<number, PageMode>,
): { previewUrl?: string; thumbUrl?: string } {
  if (effectiveMode(page, selection) !== 'preserve') return {};
  return { previewUrl: page.previewUrl, thumbUrl: page.thumbUrl };
}

/**
 * Pages that start selected.
 *
 * Everything convertible, because the common case is "import my deck", not
 * "import three pages of my deck". A page we could not convert at all is left
 * out: selecting it would create nothing.
 */
export function defaultSelection(manifest: ImportManifest): Map<number, PageMode> {
  const out = new Map<number, PageMode>();
  for (const p of manifest.pages) {
    if (p.defaultMode) out.set(p.sourcePage, p.defaultMode);
  }
  return out;
}

/**
 * The number on the primary button.
 *
 * Nothing else may compute this. A button that says "Add 6 templates" and
 * creates 5 is the exact class of defect this screen was rebuilt to remove.
 */
export function selectedCount(selection: Map<number, PageMode>): number {
  return selection.size;
}

/** Convertible pages the operator has deselected — reported, never silent. */
export function skippedConvertible(
  manifest: ImportManifest,
  selection: Map<number, PageMode>,
): number[] {
  return manifest.pages
    .filter((p) => p.defaultMode !== null && !selection.has(p.sourcePage))
    .map((p) => p.sourcePage);
}

/** How a commit answer differs from what was asked for. Empty lists mean it matched. */
export interface CommitShortfall {
  /** Selected pages the answer did not create at all. */
  missing: number[];
  /** Selected pages created in a different mode from the one chosen. */
  changed: number[];
  /** Pages the answer created that were not selected, or created twice. */
  unexpected: number[];
}

/**
 * Compare a commit answer with the selection that asked for it.
 *
 * The API creates every selected page or none (re-audit R4), so any difference
 * here means something between the two is wrong — an older server, a proxy, a
 * bug — and the screen must say so instead of reporting an ordinary success.
 */
export function commitShortfall(
  selection: Map<number, PageMode>,
  result: ImportCommitResultLike,
): CommitShortfall {
  const seen = new Set<number>();
  const changed = new Set<number>();
  const unexpected = new Set<number>();
  for (const t of result.templates ?? []) {
    const chosen = selection.get(t.sourcePage);
    if (chosen === undefined || seen.has(t.sourcePage)) unexpected.add(t.sourcePage);
    else if (chosen !== t.mode) changed.add(t.sourcePage);
    seen.add(t.sourcePage);
  }
  const sorted = (pages: Iterable<number>) => [...pages].sort((a, b) => a - b);
  return {
    missing: sorted([...selection.keys()].filter((p) => !seen.has(p))),
    changed: sorted(changed),
    unexpected: sorted(unexpected),
  };
}

export function hasShortfall(shortfall: CommitShortfall | null): shortfall is CommitShortfall {
  return (
    shortfall !== null &&
    shortfall.missing.length + shortfall.changed.length + shortfall.unexpected.length > 0
  );
}

/** The sentences that name what a short or altered commit got wrong. */
export function shortfallSentence(shortfall: CommitShortfall): string {
  const pages = (n: number[]) =>
    n.length === 1 ? `Page ${n[0]}` : `Pages ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
  const was = (n: number[]) => (n.length === 1 ? 'was' : 'were');
  const { missing, changed, unexpected } = shortfall;
  return [
    missing.length > 0 ? `${pages(missing)} ${was(missing)} not added.` : '',
    changed.length > 0 ? `${pages(changed)} ${was(changed)} added a different way than you chose.` : '',
    unexpected.length > 0 ? `${pages(unexpected)} came back without being asked for.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Pages the converter could not turn into anything, whatever the operator picks. */
export function unconvertiblePages(manifest: ImportManifest): ManifestPage[] {
  return manifest.pages.filter((p) => p.defaultMode === null);
}

/**
 * One sentence summarising the whole import, for the review header.
 *
 * It always states the SOURCE page count first, so a short result can never
 * read as a whole one.
 */
export function reviewSummary(
  manifest: ImportManifest,
  selection: Map<number, PageMode>,
): string {
  const total = manifest.sourcePageCount;
  const n = selection.size;
  const noun = total === 1 ? 'page' : 'pages';
  if (n === total) return `All ${total} ${noun} selected.`;
  return `${n} of ${total} ${noun} selected.`;
}

/**
 * Human wording for a disposition, used on the page card. `converted` needs no
 * badge — the absence of a badge is the good case, and labelling every page
 * "converted" is noise that hides the two that are not.
 */
export function dispositionBadge(page: ManifestPage): string | null {
  switch (page.disposition) {
    case 'empty':
      return page.availableModes.includes('preserve')
        ? 'No text to edit'
        : 'Nothing to import';
    case 'excluded-by-limit':
      return 'Past the page limit';
    case 'converted-with-warnings':
      return 'Check this one';
    default:
      return null;
  }
}
