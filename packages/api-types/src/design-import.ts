/**
 * The design-import contract, shared by the API that writes it and the screen
 * that renders it.
 *
 * It lives here rather than in either app because both sides were carrying
 * their own hand-written copy, which is a contract that drifts: a field added
 * on the server, a disposition renamed, and the screen keeps compiling while
 * quietly rendering the wrong thing. Anything an operator is shown about their
 * import is defined once, here.
 *
 * Everything is plain and serialisable — no classes, no Dates, no Maps —
 * because these values are persisted as JSON on an import job, crossed over
 * HTTP, and read back days later.
 */

/** How a page becomes a template, if the operator selects it. */
export type ImportPageMode =
  /**
   * The page as it looks: a rendered image, full bleed. Text inside it is part
   * of the picture. This is what every other signage CMS gives you for a whole
   * import, and it is the right answer for a dense or scanned page.
   */
  | 'preserve'
  /**
   * The page's text and pictures as real builder zones the operator can retype,
   * restyle and promote into live widgets. Higher value, lower fidelity: a
   * reconstruction always differs from the source somewhere.
   */
  | 'editable';

/** What happened to one source page. Every page gets one; none are omitted. */
export type ImportPageDisposition =
  /** Zones were produced and nothing was lost. */
  | 'converted'
  /** Zones were produced, but something did not survive — see its warnings. */
  | 'converted-with-warnings'
  /**
   * The page was read and held nothing we can turn into an editable zone —
   * artwork only, a scan, an empty slide. NOT an error, and never a reason to
   * make the page disappear.
   */
  | 'empty'
  /** The page exists in the source but a protective cap was reached first. */
  | 'excluded-by-limit';

/**
 * A typed loss or approximation. Callers branch on `code`; operators read
 * `detail`. Add codes, never repurpose one — the review screen and the import
 * report both key off these strings.
 */
export interface ImportWarningLike {
  code: string;
  detail: string;
  /** 1-based source page, when the warning belongs to one. */
  sourcePage?: number;
}

export interface ImportManifestPage {
  /** 1-based page/slide number in the SOURCE document. Never renumbered. */
  sourcePage: number;
  /** "Page 3" / "Slide 3" — what to call it on screen. */
  label: string;
  disposition: ImportPageDisposition;
  /** Modes we can actually produce for THIS page. Never offer an empty one. */
  availableModes: ImportPageMode[];
  /** Preselected mode. `null` when the page cannot be converted at all. */
  defaultMode: ImportPageMode | null;
  editableTextCount: number;
  editableImageCount: number;
  /**
   * Staged artifact KEYS. Keys, never URLs: a stored signature has expired by
   * the time anyone follows it, and a key is inert if the row ever leaks.
   * Absent on the client, which receives freshly minted links instead.
   */
  rasterObjectKey?: string;
  thumbObjectKey?: string;
  /** Rendered pixel size, when this page has a raster. */
  widthPx?: number;
  heightPx?: number;
  /** Short-lived signed links, minted per read. Server-side these are absent. */
  previewUrl?: string;
  thumbUrl?: string;
  /** Everything this page lost or approximated. Shown per page at review. */
  warnings: ImportWarningLike[];
}

export interface ImportManifestLike {
  /** Bumped when the shape changes incompatibly; a stale job is then refused. */
  version: 1;
  format: 'pdf' | 'pptx' | 'image';
  /** TRUE page count from the document, independent of what converted. */
  sourcePageCount: number;
  pages: ImportManifestPage[];
  /** Document-scoped warnings. Page-scoped ones live on their page. */
  warnings: ImportWarningLike[];
  /**
   * Why `preserve` is missing from every page, when it is. PowerPoint has no
   * server-side renderer here, so a deck can only be offered as editable
   * layers — and the operator deserves the reason and the one-click fix rather
   * than a mode that is silently absent.
   */
  preserveUnavailableReason?: string;
}

/** One page the operator chose, and how. */
export interface ImportPageSelection {
  sourcePage: number;
  mode: ImportPageMode;
}

export interface ImportCommitResultLike {
  templates: Array<{ id: string; name: string; sourcePage: number; mode: ImportPageMode }>;
  /** Convertible pages the operator left unselected. Reported, never silent. */
  skippedPages: number[];
}
