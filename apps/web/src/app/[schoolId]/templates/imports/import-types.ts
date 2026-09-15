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

/** What each mode promises, in the words we are willing to defend. */
export const MODE_COPY: Record<PageMode, { label: string; blurb: string }> = {
  preserve: {
    label: 'Keep the look',
    blurb: 'The page exactly as it is, as a picture. Text inside it is part of the picture.',
  },
  editable: {
    label: 'Editable layers',
    blurb: 'Text and pictures become elements you can retype, restyle and make live.',
  },
};

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
