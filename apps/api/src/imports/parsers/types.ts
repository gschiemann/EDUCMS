/**
 * Shared types for the Import 2.0 structured-parsing pipeline.
 *
 * A parser turns an uploaded document (PPTX / PDF) into one `ParsedPage`
 * per SOURCE page, each carrying real, editable builder zones. The
 * controller then persists each convertible page as a Template whose
 * TemplateZones map 1:1 to `ParsedZone`s — TEXT widgets for text, IMAGE
 * widgets for pictures — so the result opens editable in the V2 builder
 * exactly like any other template (NOT a flattened picture).
 *
 * Coordinates are ALWAYS percentages (0–100) of the page canvas, the
 * same contract every TemplateZone uses. The parsers convert from the
 * document's native units (EMU for PPTX, PDF user-space points for
 * PDF) into those percentages so nothing downstream needs to know
 * about the source format.
 *
 * ─────────────────────────────────────────────────────────────────────
 * THE PAGE-ACCOUNTING CONTRACT (2026-09-15)
 * ─────────────────────────────────────────────────────────────────────
 *
 * The audit at `docs/design/proposals/2026-09-15-template-import-audit/`
 * proved a 3-page PDF producing 2 templates while the UI said "one per
 * page": the middle page was artwork-only, yielded no text zones, and
 * was deleted on the floor. A 41-page PDF silently became 40. Nothing
 * anywhere recorded that it had happened.
 *
 * So the contract is now: **every source page is accounted for, and a
 * page that produces nothing renderable is a FACT, never a deletion.**
 *
 *   - `ParsedDocument.sourcePageCount` is the TRUE page/slide count read
 *     from the document, independent of how many pages produced zones
 *     and independent of any cap we apply.
 *   - `ParsedDocument.pages` carries one entry per ACCOUNTED source page
 *     (see `MAX_ACCOUNTED_PAGES`), in source order, each with its stable
 *     1-based `sourcePage` number and a `disposition` saying what
 *     happened to it.
 *   - Warnings are TYPED: a stable `code` a caller can branch on plus a
 *     `detail` sentence already safe to show an operator. Page-scoped
 *     warnings live on the page; document-scoped ones on the document.
 *     `collectWarnings()` flattens both in source order.
 *
 * Everything here is a plain, serialisable object — no class instances,
 * no functions, no Dates, no Maps — because these values cross a job
 * boundary (a review step persists them and a UI renders them) and must
 * survive `JSON.stringify` unchanged. The one exception is
 * `ExtractedMedia.data`, which is raw bytes and never leaves the API.
 */

/**
 * The hard ceiling on how many per-page records a `ParsedDocument` will
 * carry, INCLUDING `excluded-by-limit` placeholders.
 *
 * A 5,000-page PDF must not turn into 5,000 accounting records just to
 * say "we converted the first 40". Beyond this bound the page list stops
 * and the truthful total lives in `sourcePageCount` plus the
 * `PAGES_TRUNCATED` warning, which always names the real number.
 */
export const MAX_ACCOUNTED_PAGES = 500;

/** What happened to one source page. */
export type PageDisposition =
  /** Zones were produced and nothing was lost. */
  | 'converted'
  /** Zones were produced, but something did not survive — see `warnings`. */
  | 'converted-with-warnings'
  /**
   * The page was read and there was nothing we can turn into an editable
   * zone (artwork-only, a scan, an empty slide). NOT an error, and NOT a
   * reason to make the page disappear.
   */
  | 'empty'
  /**
   * The page exists in the source but was never converted because a
   * protective cap was reached first (page/slide limit).
   */
  | 'excluded-by-limit';

/**
 * Stable machine codes for everything a conversion can lose or
 * approximate. Callers branch on `code`; operators read `detail`.
 *
 * Add codes, never repurpose one — the review UI and the import report
 * both key off these strings.
 */
export type ImportWarningCode =
  // ── Accounting / protective limits ────────────────────────────────
  /** The document has more pages/slides than the converter will read. */
  | 'PAGES_TRUNCATED'
  /** A page had more shapes than the per-page zone cap allows. */
  | 'ZONES_TRUNCATED'
  /** A text run was longer than the per-zone character cap. */
  | 'TEXT_TRUNCATED'
  // ── Whole pages ───────────────────────────────────────────────────
  /** The page was read and yielded nothing extractable. */
  | 'PAGE_EMPTY'
  /** The page part exists but could not be parsed (corrupt/unknown XML). */
  | 'PAGE_UNREADABLE'
  // ── Media ─────────────────────────────────────────────────────────
  /** An image zone lost its picture (upload failed / unserveable URL). */
  | 'MEDIA_UNRESOLVED'
  /** An embedded part is not a browser-serveable image (emf/wmf/tiff/svg). */
  | 'MEDIA_UNSUPPORTED'
  // ── Shapes we cannot reconstruct as an editable zone ──────────────
  /** A table, chart, SmartArt, video, connector or decorative shape. */
  | 'SHAPE_UNSUPPORTED'
  /** A shape carries a rotation the zone model cannot express. */
  | 'SHAPE_ROTATION_IGNORED'
  /** A PDF text run is not axis-aligned; its box is an approximation. */
  | 'TEXT_ROTATED'
  /** A picture / pattern / unsupported page background was dropped. */
  | 'BACKGROUND_UNSUPPORTED'
  // ── Styling approximations ────────────────────────────────────────
  /** A colour was resolved, but only approximately (e.g. gradient → base). */
  | 'COLOR_APPROXIMATED'
  /** A theme/scheme colour could not be resolved; the widget default applies. */
  | 'COLOR_UNRESOLVED'
  /** A theme font reference could not be resolved; the default face applies. */
  | 'FONT_SUBSTITUTED';

/** One typed, operator-readable thing the conversion lost or approximated. */
export interface ImportWarning {
  /** Stable machine code — branch on this. */
  code: ImportWarningCode;
  /**
   * One sentence, already safe to show an operator. Never a stack trace,
   * never a file path, never raw document text beyond a short quoted
   * label.
   */
  detail: string;
  /**
   * 1-based source page/slide this concerns. Omitted for warnings that
   * are about the document as a whole (e.g. `PAGES_TRUNCATED`).
   */
  sourcePage?: number;
}

/** A picture extracted from a document, to be uploaded as an Asset. */
export interface ExtractedMedia {
  /** Stable per-document id the zone references (e.g. 'media-0'). */
  id: string;
  /** Raw bytes of the image. */
  data: Buffer;
  /** MIME type derived from the embedded part's extension / signature. */
  mimeType: string;
  /** Original filename inside the archive (sanitized), for the asset name. */
  name: string;
}

/** A single editable zone on a page — maps to one TemplateZone. */
export interface ParsedZone {
  /** Display name shown in the builder layer list. */
  name: string;
  /** Builder widget type. Import 2.0 emits only TEXT and IMAGE. */
  widgetType: 'TEXT' | 'IMAGE';
  /** %-of-canvas geometry (0–100), clamped to the canvas. */
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  /**
   * Widget defaultConfig. For TEXT this carries `content`, `fontSize`
   * (px), `fontFamily`, `color`, `alignment`, `bold`, `lineHeight` —
   * the exact keys TextWidget reads. For IMAGE it carries either a
   * resolved `assetUrl` (set by the controller after upload) or a
   * `mediaRef` placeholder the controller resolves.
   */
  defaultConfig: Record<string, unknown>;
  /**
   * When set, this IMAGE zone references an `ExtractedMedia.id`; the
   * controller uploads that media and rewrites defaultConfig.assetUrl
   * to the resulting Asset URL before persisting.
   */
  mediaRef?: string;
}

/** One SOURCE page/slide — whether or not it produced anything. */
export interface ParsedPage {
  /**
   * 1-based source page/slide number. STABLE: it is the position in the
   * original document and is never renumbered to close a gap, so "Slide
   * 7" still means the seventh slide even when slides 3–6 were empty.
   */
  sourcePage: number;
  /** Suggested template name suffix, e.g. 'Slide 1' or 'Page 3'. */
  label: string;
  /** Canvas width in px (rounded). */
  screenWidth: number;
  /** Canvas height in px (rounded). */
  screenHeight: number;
  /** Optional page background color (hex), if the document declares one. */
  bgColor?: string;
  /** The editable zones, in paint order. Empty is a legitimate answer. */
  zones: ParsedZone[];
  /** What happened to this page. */
  disposition: PageDisposition;
  /** Everything this page lost or approximated. Empty when nothing did. */
  warnings: ImportWarning[];
}

/** The full result of parsing a document. */
export interface ParsedDocument {
  /**
   * One entry per ACCOUNTED source page, in source order, including
   * pages that produced nothing (`empty`) and pages a cap excluded
   * (`excluded-by-limit`). Bounded by `MAX_ACCOUNTED_PAGES`.
   */
  pages: ParsedPage[];
  /** All pictures referenced by any page's zones (mediaRef). */
  media: ExtractedMedia[];
  /**
   * The TRUE number of pages/slides in the source document, read before
   * any cap is applied. `pages.length` may be smaller (a cap, or
   * `MAX_ACCOUNTED_PAGES`); this number never is.
   */
  sourcePageCount: number;
  /**
   * Document-scoped warnings only (truncation, unsupported embedded
   * media). Page-scoped warnings live on their page — use
   * `collectWarnings()` for the flattened list.
   */
  warnings: ImportWarning[];
}

/**
 * Flatten document + page warnings into one list in source order,
 * document-scoped first. Pure; safe to call on any ParsedDocument.
 */
export function collectWarnings(doc: {
  warnings?: ImportWarning[];
  pages?: Array<{ warnings?: ImportWarning[] }>;
}): ImportWarning[] {
  const out: ImportWarning[] = [...(doc.warnings ?? [])];
  for (const page of doc.pages ?? []) out.push(...(page.warnings ?? []));
  return out;
}

/**
 * A bounded, de-duplicating warning collector. Pure aside from its own
 * internal array, and never throws.
 *
 * De-duplication matters: a 60-slide deck with a shape type we cannot
 * convert would otherwise emit 600 identical warnings and drown the one
 * that mattered. Identity is `code + detail + sourcePage`.
 */
export class WarningSink {
  private readonly seen = new Set<string>();
  private readonly items: ImportWarning[] = [];
  private dropped = 0;

  constructor(private readonly max = 200) {}

  add(code: ImportWarningCode, detail: string, sourcePage?: number): void {
    const key = `${code}|${sourcePage ?? ''}|${detail}`;
    if (this.seen.has(key)) return;
    if (this.items.length >= this.max) {
      this.dropped++;
      return;
    }
    this.seen.add(key);
    this.items.push(
      sourcePage === undefined
        ? { code, detail }
        : { code, detail, sourcePage },
    );
  }

  /** The collected warnings (a copy — the sink keeps its own array). */
  list(): ImportWarning[] {
    return [...this.items];
  }

  /** How many distinct warnings were discarded because the cap was hit. */
  droppedCount(): number {
    return this.dropped;
  }

  get length(): number {
    return this.items.length;
  }
}

/**
 * The disposition a page with these zones and warnings deserves. Keeps
 * both parsers and the builder grading identically.
 */
export function gradeDisposition(
  zoneCount: number,
  warnings: ReadonlyArray<ImportWarning>,
): Exclude<PageDisposition, 'excluded-by-limit'> {
  if (zoneCount <= 0) return 'empty';
  return warnings.length > 0 ? 'converted-with-warnings' : 'converted';
}
