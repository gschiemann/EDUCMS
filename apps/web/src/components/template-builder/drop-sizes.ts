/**
 * Smart drop sizes for palette adds — Wave B / editor-crush B6a (2026-07-02).
 *
 * Audit finding (05-EDITOR-CRUSH-LENSES.md elements-assets P2): drop-at-
 * cursor physics shipped, but the Widgets palette never passes a size, so a
 * LOGO, a TICKER, and a full-bleed IMAGE all land as the same generic
 * 40×30% box. The App Library already solved this with a widgetType-keyed
 * size map (AppConfigForm.tsx WIDGET_TYPE_DEFAULT_SIZE) — this module is
 * the palette-side equivalent, threaded through BOTH add gestures
 * (VariantPicker.handlePick click-adds and BuilderShell.handleDragEnd
 * drops) as the `size` arg useBuilderStore.addZone already accepts.
 *
 * Sizes are canvas percentages (0–100). Unlisted types return undefined →
 * addZone's existing 40×30 default applies, so nothing regresses for the
 * long tail. Variant-id overrides come first — a divider line and a filled
 * rectangle are both widgetType SHAPE but want opposite footprints.
 */

export interface DropSize {
  w: number;
  h: number;
}

/** Per-variant overrides — checked before the widgetType map. */
const VARIANT_DROP_SIZE: Record<string, DropSize> = {
  // SHAPE primitives (B2): wide-short strips for line/arrow, compact
  // blocks for the filled shapes.
  'shape-line': { w: 40, h: 4 },
  'shape-arrow': { w: 30, h: 8 },
  'shape-rectangle': { w: 30, h: 22 },
  'shape-pill': { w: 26, h: 12 },
  'shape-circle': { w: 18, h: 30 },
  'shape-triangle': { w: 18, h: 28 },
  'shape-star': { w: 18, h: 30 },
  // DECORATION (B3): full-width bands for the banner-ish variants,
  // generous ambient fields for the particle variants.
  'decoration-rainbow-ribbon': { w: 100, h: 22 },
  'decoration-ticker': { w: 100, h: 12 },
  'decoration-neon-buzz': { w: 40, h: 20 },
  'decoration-pulse-glow': { w: 40, h: 45 },
  'decoration-confetti': { w: 60, h: 55 },
  'decoration-sparkles': { w: 60, h: 55 },
  'decoration-balloons': { w: 50, h: 60 },
  'decoration-clouds': { w: 60, h: 40 },
};

/** widgetType-keyed defaults. Values chosen to read sanely on a 16:9
 *  canvas; CLOCK/WEATHER/COUNTDOWN/WEBPAGE/STREAMING mirror the App
 *  Library's map (AppConfigForm.tsx) so the two add paths agree. */
const WIDGET_TYPE_DROP_SIZE: Record<string, DropSize> = {
  LOGO: { w: 15, h: 18 },
  CLOCK: { w: 28, h: 22 },
  WEATHER: { w: 28, h: 22 },
  COUNTDOWN: { w: 28, h: 22 },
  TEXT: { w: 50, h: 14 },
  RICH_TEXT: { w: 50, h: 25 },
  TICKER: { w: 100, h: 10 },
  ANNOUNCEMENT: { w: 55, h: 28 },
  WEBPAGE: { w: 60, h: 55 },
  STREAMING: { w: 60, h: 45 },
  IMAGE: { w: 45, h: 50 },
  VIDEO: { w: 55, h: 55 },
  HOUSE_AD_BANNER: { w: 60, h: 14 },
  ICON: { w: 10, h: 16 },
  SHAPE: { w: 25, h: 25 },
  DECORATION: { w: 60, h: 55 },
};

/**
 * Resolve the natural drop footprint for a palette add. Returns undefined
 * for unmapped types so addZone's default sizing keeps applying.
 */
export function resolveDropSize(
  widgetType: string | undefined,
  variantId?: string,
): DropSize | undefined {
  if (variantId && VARIANT_DROP_SIZE[variantId]) return VARIANT_DROP_SIZE[variantId];
  if (widgetType && WIDGET_TYPE_DROP_SIZE[widgetType]) return WIDGET_TYPE_DROP_SIZE[widgetType];
  return undefined;
}
