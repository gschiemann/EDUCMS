/**
 * import-builder — turns a ParsedDocument (from the PPTX / PDF parsers)
 * into ready-to-persist Template specs whose zones are real, editable
 * builder zones. Pure + side-effect-free (no DB, no network) so it's
 * unit-testable; the controller supplies a `resolveMedia` callback that
 * maps an ExtractedMedia.id → an uploaded Asset URL, and (for PDFs) an
 * optional `backgroundUrl` to lay the original page under the text.
 */

import type { ParsedDocument, ParsedPage, ParsedZone } from './types';

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

/** A persist-ready template spec (one per page/slide). */
export interface BuiltTemplate {
  label: string;
  screenWidth: number;
  screenHeight: number;
  orientation: 'PORTRAIT' | 'LANDSCAPE';
  bgColor?: string;
  zones: BuiltZone[];
}

export interface BuildOptions {
  /** Resolve a parsed media id → uploaded Asset URL (or null to drop). */
  resolveMedia: (mediaId: string) => string | null;
  /**
   * Optional per-page full-bleed background image URL (the original PDF
   * page rendered to an image, or the source file itself). When given,
   * a zIndex-0 IMAGE zone covering 0–100% is prepended so the visual is
   * preserved UNDER the editable text. Index matches `pages[i]`.
   */
  pageBackgroundUrl?: (pageIndex: number) => string | null;
}

/**
 * Build the per-page template specs. Pages that end up with ZERO zones
 * (and no background) are dropped so we never persist an empty
 * template. Returns an empty array if nothing usable survives — the
 * caller then falls back to the legacy single-image template.
 */
export function buildTemplates(
  doc: ParsedDocument,
  opts: BuildOptions,
): BuiltTemplate[] {
  const out: BuiltTemplate[] = [];

  doc.pages.forEach((page, pageIndex) => {
    const zones: BuiltZone[] = [];

    // 1. Optional full-bleed background (PDF visual fidelity layer).
    const bgUrl = opts.pageBackgroundUrl?.(pageIndex) ?? null;
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

    // 2. Content zones from the parse. IMAGE zones resolve their media
    //    URL here; unresolved media (upload failed / unserveable) drops
    //    the zone rather than persisting a broken <img>.
    for (const z of page.zones) {
      if (zones.length >= MAX_ZONES_PER_TEMPLATE) break;
      const built = buildZone(z, zones.length, opts.resolveMedia);
      if (built) zones.push(built);
    }

    // Drop a page that yielded nothing renderable.
    if (zones.length === 0) return;

    out.push({
      label: page.label,
      screenWidth: page.screenWidth,
      screenHeight: page.screenHeight,
      orientation:
        page.screenHeight > page.screenWidth ? 'PORTRAIT' : 'LANDSCAPE',
      bgColor: page.bgColor,
      zones,
    });
  });

  return out;
}

function buildZone(
  z: ParsedZone,
  sortOrder: number,
  resolveMedia: (id: string) => string | null,
): BuiltZone | null {
  if (z.widgetType === 'IMAGE' && z.mediaRef) {
    const url = resolveMedia(z.mediaRef);
    if (!url) return null; // upload failed or unserveable → drop
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

  // IMAGE without a mediaRef and no assetUrl already set → nothing to show.
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
