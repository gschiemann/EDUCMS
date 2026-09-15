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

// ─── Legibility: text you can actually read on the wall ───────────────
//
// Two conversions produced provably invisible text, and neither said so.
//
//   1. A DARK slide whose text colour we never resolved. PowerPoint puts
//      placeholder text colour in the LAYOUT/MASTER list styles, not on
//      the run, so a themed deck's `readTextBody` finds no
//      `a:solidFill`, the zone gets no colour, and `TextWidget` falls
//      back to `#1e293b`. On a resolved `#111827` slide that is 1.21:1.
//      It does not even warn: `colorUnresolved` is raised only when a
//      fill node EXISTS and fails to resolve, never when the run simply
//      inherits.
//   2. A picture or pattern slide background, which we drop with a
//      `BACKGROUND_UNSUPPORTED` warning. The deck's authored `#ffffff`
//      text is preserved faithfully — onto the white the template then
//      falls back to. 1:1. The warning tells the operator the picture is
//      gone; nothing tells them the words went with it.
//
// Three surfaces also disagree about what "no background" looks like,
// so an import must never leave it to them to decide:
//
//   BuilderCanvas.tsx        : `meta.bgColor || '#ffffff'`  → WHITE
//   player/page.tsx          : `tpl.bgColor  || '#000000'`  → BLACK
//   import-commit.service.ts : `args.bgColor || '#ffffff'`  → WHITE
//
// (The commit service's fallback is what has kept the persisted row
// white, which is why case 2 is white-on-white rather than black-on-
// white. It is a fallback in the wrong layer: the builder is where the
// contrast is measured, so the builder is where the colour must be
// known.)
//
// Two rules, deliberately different in strength:
//
//   1. An import STATES its background. Both formats define a page that
//      declares none as white paper, so that is what we write — and the
//      contrast check below then measures against the colour that will
//      really ship.
//   2. No text zone is left at a contrast a viewer cannot read. Where
//      the SOURCE left the colour to us we owe the operator a legible
//      one (AA-large, 3:1 — every imported signage zone is large text).
//      Where the source DID choose a colour, that is the design, and we
//      overrule it only once it is effectively invisible, which can only
//      happen because our own conversion dropped what it was chosen
//      against.
//
// Both always warn. A recolour the operator disagrees with is one click
// to undo; text they cannot see is a board that shipped blank.

/** Paper white — what a page that declares no background actually is. */
export const IMPORT_DEFAULT_BG = '#ffffff';
/** What the PLAYER paints behind a template with no bgColor. */
export const PLAYER_DEFAULT_BG = '#000000';
/** What TextWidget renders for a zone with no colour. */
export const TEXT_WIDGET_DEFAULT_COLOR = '#1e293b';

/** WCAG AA floor for large text. Every imported signage zone is large. */
const MIN_CONTRAST_OURS = 3;
/** Only this far gone do we overrule a colour the source chose itself. */
const MIN_CONTRAST_AUTHORED = 1.8;
/** Share of a text zone an image must cover before we stop guessing. */
const BACKDROP_COVER = 0.5;

const LIGHT_INK = '#ffffff';
const DARK_INK = '#0f172a';

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb` / `#rrggbb` (with or without the hash). Anything else — a
 *  named colour, `transparent`, a gradient, a number — is not a colour we
 *  can reason about, and returns null rather than a guess. */
function parseHex(value: unknown): Rgb | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  if (hex.length === 3) {
    const [r, g, b] = hex.split('');
    return {
      r: parseInt(r + r, 16),
      g: parseInt(g + g, 16),
      b: parseInt(b + b, 16),
    };
  }
  if (hex.length === 6) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return null;
}

/** WCAG 2.x relative luminance. */
function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG contrast ratio between two colours, 1–21. Returns 1 ("assume the
 * worst") when either side is not a colour we can parse, so an unknown
 * never reads as safe.
 */
export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return 1;
  const la = luminance(ca);
  const lb = luminance(cb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The more readable of near-black and white on this background. */
function legibleOn(background: string): string {
  return contrastRatio(LIGHT_INK, background) >=
    contrastRatio(DARK_INK, background)
    ? LIGHT_INK
    : DARK_INK;
}

/**
 * Does `under` paint beneath `over`? Lower zIndex wins; on a tie the
 * earlier zone does, because equal-zIndex siblings fall back to document
 * order and `sortOrder` is the order they are emitted in. The tie is not
 * hypothetical: `buildZone` clamps every zIndex to ≥1, so a parser's
 * background-at-0 and the text above it both arrive as 1.
 */
function paintsUnder(under: BuiltZone, over: BuiltZone): boolean {
  if (under.zIndex !== over.zIndex) return under.zIndex < over.zIndex;
  return under.sortOrder < over.sortOrder;
}

/** Fraction of `zone` covered by `other`, 0–1. */
function coverage(zone: BuiltZone, other: BuiltZone): number {
  const w =
    Math.min(zone.x + zone.width, other.x + other.width) -
    Math.max(zone.x, other.x);
  const h =
    Math.min(zone.y + zone.height, other.y + other.height) -
    Math.max(zone.y, other.y);
  if (w <= 0 || h <= 0) return 0;
  const area = zone.width * zone.height;
  return area > 0 ? (w * h) / area : 0;
}

/**
 * Recolour any text zone that would be unreadable on the background this
 * import produced. Mutates `zones` in place and returns how many it
 * changed. Pure aside from that (no I/O, no clock).
 *
 * A text zone sitting on top of an imported picture is SKIPPED: the
 * backdrop is pixels we cannot inspect, and repainting from the page
 * colour would be a guess that can make it worse — white text over a
 * dark photo on a white page is the common, correct shape.
 */
export function enforceLegibleText(
  zones: BuiltZone[],
  pageBackground: string,
): number {
  let adjusted = 0;
  for (const zone of zones) {
    if (zone.widgetType !== 'TEXT') continue;
    const overPicture = zones.some(
      (other) =>
        other !== zone &&
        other.widgetType === 'IMAGE' &&
        paintsUnder(other, zone) &&
        coverage(zone, other) >= BACKDROP_COVER,
    );
    if (overPicture) continue;

    const own = parseHex(zone.defaultConfig.bgColor);
    const backdrop = own ? String(zone.defaultConfig.bgColor) : pageBackground;
    const authored = parseHex(zone.defaultConfig.color);
    const ink = authored
      ? String(zone.defaultConfig.color)
      : TEXT_WIDGET_DEFAULT_COLOR;
    const floor = authored ? MIN_CONTRAST_AUTHORED : MIN_CONTRAST_OURS;
    if (contrastRatio(ink, backdrop) >= floor) continue;

    const replacement = legibleOn(backdrop);
    // Never "fix" a colour into one that is no better than what it had.
    if (contrastRatio(replacement, backdrop) <= contrastRatio(ink, backdrop))
      continue;
    zone.defaultConfig = { ...zone.defaultConfig, color: replacement };
    adjusted++;
  }
  return adjusted;
}

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
  /**
   * ALWAYS set. An import states its own background rather than leaving
   * it to a platform default, because the builder resolves an unset one
   * to white and the player resolves it to black.
   */
  bgColor: string;
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

  // 3. State the background, then guarantee the text can be read on it.
  //    Order matters: the guarantee is measured against the background
  //    that will actually ship, not against a platform default that the
  //    builder and the player resolve differently.
  const bgColor = parseHex(page.bgColor)
    ? String(page.bgColor)
    : IMPORT_DEFAULT_BG;
  const recoloured = enforceLegibleText(zones, bgColor);
  if (recoloured > 0) {
    warn.add(
      'CONTRAST_ADJUSTED',
      recoloured === 1
        ? `One text element on ${label.toLowerCase()} would not have been readable on its background and was recoloured.`
        : `${recoloured} text elements on ${label.toLowerCase()} would not have been readable on their background and were recoloured.`,
      sourcePage,
    );
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
      bgColor,
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
