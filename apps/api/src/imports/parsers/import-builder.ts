/**
 * import-builder — turns a ParsedDocument (from the PPTX / PDF parsers)
 * into ready-to-persist Template specs whose zones are real, editable
 * builder zones. Pure + side-effect-free (no DB, no network) so it's
 * unit-testable; the controller supplies a `resolveMedia` callback that
 * maps an ExtractedMedia.id → an uploaded Asset URL, and (for PDFs) an
 * optional `backgroundUrl` to lay the original page under the text.
 *
 * ── The 2026-09-15 change: pages stop being dropped on the floor ─────
 *
 * This file used to `return` out of the per-page loop whenever a page
 * yielded no zones, and to silently discard an IMAGE zone whose media
 * failed to upload. A 3-page PDF whose middle page is artwork became two
 * templates, and the controller — which only ever saw the survivors —
 * reported "2 editable templates (one per page)". The audit reproduced
 * exactly that, and its own test blessed it.
 *
 * `buildImport()` now returns a `BuiltPage` for EVERY accounted source
 * page, carrying its disposition and warnings. A page with nothing
 * renderable is `{ template: null }` — a FACT the caller can show,
 * refuse, or rasterize. What to do about it is the caller's decision,
 * not this file's.
 *
 * `buildTemplates()` survives as a thin, DEPRECATED view over
 * `buildImport()` for the pre-existing caller. It is lossy by
 * construction; new code takes `buildImport`.
 */

import {
  type ImportWarning,
  type PageDisposition,
  type ParsedDocument,
  type ParsedPage,
  type ParsedZone,
  WarningSink,
  gradeDisposition,
} from './types';

/** Per-page zone cap — a pathological file can't create thousands. */
export const MAX_ZONES_PER_TEMPLATE = 80;

/** A persist-ready zone (defaultConfig is the final object, not a ref). */
export interface BuiltZone {
  name: string;
  widgetType: 'TEXT' | 'IMAGE';
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  sortOrder: number;
  defaultConfig: Record<string, unknown>;
}

/** A persist-ready template spec (one per convertible page/slide). */
export interface BuiltTemplate {
  /** 1-based source page/slide this template came from. */
  sourcePage: number;
  label: string;
  screenWidth: number;
  screenHeight: number;
  orientation: 'PORTRAIT' | 'LANDSCAPE';
  bgColor?: string;
  zones: BuiltZone[];
}

/**
 * One accounted source page and what became of it. `template` is null
 * when nothing renderable survived — never omit the page for it.
 */
export interface BuiltPage {
  /** 1-based source page/slide number, stable across the pipeline. */
  sourcePage: number;
  label: string;
  disposition: PageDisposition;
  /** Parser warnings for this page plus anything the build itself lost. */
  warnings: ImportWarning[];
  template: BuiltTemplate | null;
}

/** The full, accounted result of building an import. */
export interface BuildResult {
  /** One entry per accounted source page, in source order. */
  pages: BuiltPage[];
  /** Only the pages that produced a template, in source order. */
  templates: BuiltTemplate[];
  /** True source page/slide count, independent of what converted. */
  sourcePageCount: number;
  /** Document-scoped warnings (the parser's, plus any the build adds). */
  warnings: ImportWarning[];
}

export interface BuildOptions {
  /** Resolve a parsed media id → uploaded Asset URL (or null to drop). */
  resolveMedia: (mediaId: string) => string | null;
  /**
   * Optional per-page full-bleed background image URL (the original PDF
   * page rendered to an image, or the source file itself). When given,
   * a zIndex-0 IMAGE zone covering 0–100% is prepended so the visual is
   * preserved UNDER the editable text.
   *
   * Called with BOTH the array index and the 1-based source page number.
   * Prefer `sourcePage` — array index and page number diverge the moment
   * a page is excluded by a cap, which is precisely when a caller is
   * most likely to mis-address a background.
   */
  pageBackgroundUrl?: (pageIndex: number, sourcePage: number) => string | null;
}

/**
 * Build one `BuiltPage` per accounted source page. Nothing is dropped:
 * a page with no renderable zone comes back with `template: null` and a
 * disposition saying why.
 */
export function buildImport(
  doc: ParsedDocument,
  opts: BuildOptions,
): BuildResult {
  const docWarn = new WarningSink();
  for (const w of doc.warnings ?? [])
    docWarn.add(w.code, w.detail, w.sourcePage);

  const pages: BuiltPage[] = [];

  (doc.pages ?? []).forEach((page, pageIndex) => {
    pages.push(buildPage(page, pageIndex, opts));
  });

  const templates = pages
    .map((p) => p.template)
    .filter((t): t is BuiltTemplate => t !== null);

  return {
    pages,
    templates,
    // Fall back to the page count only when a parser predates the
    // contract; the parsers in this folder always set it.
    sourcePageCount:
      typeof doc.sourcePageCount === 'number' && doc.sourcePageCount >= 0
        ? doc.sourcePageCount
        : (doc.pages ?? []).length,
    warnings: docWarn.list(),
  };
}

function buildPage(
  page: ParsedPage,
  pageIndex: number,
  opts: BuildOptions,
): BuiltPage {
  const sourcePage = page.sourcePage ?? pageIndex + 1;
  const label = page.label ?? `Page ${sourcePage}`;
  const warn = new WarningSink(60);
  for (const w of page.warnings ?? []) warn.add(w.code, w.detail, w.sourcePage);

  // A page the parser never read cannot gain zones here.
  if (page.disposition === 'excluded-by-limit') {
    return {
      sourcePage,
      label,
      disposition: 'excluded-by-limit',
      warnings: warn.list(),
      template: null,
    };
  }

  const zones: BuiltZone[] = [];

  // 1. Optional full-bleed background (PDF visual fidelity layer).
  const bgUrl = opts.pageBackgroundUrl?.(pageIndex, sourcePage) ?? null;
  if (bgUrl) {
    zones.push({
      name: 'Page background',
      widgetType: 'IMAGE',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      zIndex: 0,
      sortOrder: 0,
      // 'contain' keeps the page's native aspect un-cropped.
      defaultConfig: { assetUrl: bgUrl, fit: 'contain' },
    });
  }

  // 2. Content zones from the parse. IMAGE zones resolve their media URL
  //    here; unresolved media still drops the ZONE (a broken <img> helps
  //    nobody) but it no longer drops the PAGE, and it is now recorded.
  let truncated = false;
  for (const z of page.zones ?? []) {
    if (zones.length >= MAX_ZONES_PER_TEMPLATE) {
      truncated = true;
      break;
    }
    const built = buildZone(z, zones.length, opts.resolveMedia);
    if (built) {
      zones.push(built);
    } else if (z.widgetType === 'IMAGE') {
      warn.add(
        'MEDIA_UNRESOLVED',
        `A picture on ${label.toLowerCase()} could not be stored and was left out.`,
        sourcePage,
      );
    }
  }
  if (truncated) {
    warn.add(
      'ZONES_TRUNCATED',
      `${label} has more than ${MAX_ZONES_PER_TEMPLATE} elements; the rest were left out.`,
      sourcePage,
    );
  }

  if (zones.length === 0) {
    warn.add(
      'PAGE_EMPTY',
      `${label} produced nothing that can be displayed.`,
      sourcePage,
    );
    return {
      sourcePage,
      label,
      disposition: 'empty',
      warnings: warn.list(),
      template: null,
    };
  }

  const warnings = warn.list();
  return {
    sourcePage,
    label,
    disposition: gradeDisposition(zones.length, warnings),
    warnings,
    template: {
      sourcePage,
      label,
      screenWidth: page.screenWidth,
      screenHeight: page.screenHeight,
      orientation:
        page.screenHeight > page.screenWidth ? 'PORTRAIT' : 'LANDSCAPE',
      bgColor: page.bgColor,
      zones,
    },
  };
}

/**
 * The templates that a document produced, dropping every page that
 * produced none.
 *
 * @deprecated Lossy by construction — it cannot tell a caller that a
 * page existed and converted to nothing, which is the whole defect the
 * accounting contract exists to fix. Use {@link buildImport} and read
 * `pages` (dispositions) alongside `templates`.
 */
export function buildTemplates(
  doc: ParsedDocument,
  opts: BuildOptions,
): BuiltTemplate[] {
  return buildImport(doc, opts).templates;
}

function buildZone(
  z: ParsedZone,
  sortOrder: number,
  resolveMedia: (id: string) => string | null,
): BuiltZone | null {
  if (z.widgetType === 'IMAGE' && z.mediaRef) {
    const url = resolveMedia(z.mediaRef);
    if (!url) return null; // upload failed or unserveable → drop the zone
    return {
      name: z.name,
      widgetType: 'IMAGE',
      x: z.x,
      y: z.y,
      width: z.width,
      height: z.height,
      // Keep parser z-order but offset by sortOrder so backgrounds
      // (zIndex 0) always sit beneath content (≥1).
      zIndex: Math.max(1, z.zIndex),
      sortOrder,
      defaultConfig: { ...z.defaultConfig, assetUrl: url },
    };
  }

  if (z.widgetType === 'TEXT') {
    return {
      name: z.name || 'Text',
      widgetType: 'TEXT',
      x: z.x,
      y: z.y,
      width: z.width,
      height: z.height,
      zIndex: Math.max(1, z.zIndex),
      sortOrder,
      defaultConfig: { ...z.defaultConfig },
    };
  }

  // IMAGE without a mediaRef but with an assetUrl already set.
  if (
    z.widgetType === 'IMAGE' &&
    typeof z.defaultConfig.assetUrl === 'string'
  ) {
    return {
      name: z.name,
      widgetType: 'IMAGE',
      x: z.x,
      y: z.y,
      width: z.width,
      height: z.height,
      zIndex: Math.max(1, z.zIndex),
      sortOrder,
      defaultConfig: { ...z.defaultConfig },
    };
  }

  return null;
}

/** Re-export the page type for callers that map over pages. */
export type { ParsedPage };
