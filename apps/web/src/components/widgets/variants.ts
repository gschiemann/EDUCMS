/**
 * Widget Variant Registry — the Canva-style picker for EDU CMS.
 *
 * Each widget type (CLOCK, TEXT, ANNOUNCEMENT, ...) can have many *variants*:
 *   - "Analog Wood Wall Clock"  → classroom rendering
 *   - "Digital LED Clock"        → modern rendering
 *   - "Flip Clock"               → retro
 *   - "Sundial"                  → outdoor scene
 *
 * The variant picker UI lists variants for the currently-selected zone with
 * a small live thumbnail. Clicking a variant swaps the renderer in-place
 * (writes `variant` into the zone's defaultConfig).
 *
 * To add a variant:
 *   import { registerVariant } from '@/components/widgets/variants';
 *   registerVariant({
 *     id: 'clock-analog-wood',
 *     widgetType: 'CLOCK',
 *     name: 'Wood Wall Clock',
 *     render: BackToSchoolClock,
 *   });
 *
 * The variant id is also the value stored in `config.variant` on the zone.
 */

import type { ComponentType } from 'react';
import type { WidgetType, ThemeWidgetProps } from './themes/registry';

export interface WidgetVariant {
  /** Unique id, also the value persisted in config.variant */
  id: string;
  /** The widget type this variant belongs to */
  widgetType: WidgetType;
  /** Display name in the picker */
  name: string;
  /** Optional one-line description */
  description?: string;
  /** Style category for the secondary filter (e.g. 'CLASSROOM', 'MODERN', 'PLAYFUL', 'MINIMAL') */
  category?: string;
  /** Business-line scope — when set, this variant appears only in that
   *  vertical's builder palette (e.g. 'SPORTS', 'HEALTHCARE'). Unset =
   *  universal — shown to every vertical. */
  vertical?: string;
  /** Multi-vertical scope — when set, this variant appears in EACH of
   *  the listed verticals' palettes and nowhere else. Use for cross-
   *  over widgets that belong to several business lines but not all
   *  (e.g. a Lunch Menu in K12 + QSR + Hospitality, a Staff Spotlight
   *  in K12 + Corporate + Healthcare + Worship). Takes precedence over
   *  `vertical` when both are set. Unset = fall through to `vertical`
   *  / category logic. */
  verticals?: string[];
  /** Renderer — used as the picker thumbnail AND, by default, as the
   *  canvas render when this variant is selected. For variants whose
   *  `render` is a thumbnail-only preview (no real widget logic, no
   *  asset URLs honored, etc.), set `previewOnly: true` so the canvas
   *  falls through to the standard WidgetRenderer dispatch. */
  render: ComponentType<ThemeWidgetProps>;
  /** Default config to merge in when this variant is picked */
  defaultConfig?: Record<string, any>;
  /** Optional inline thumbnail SVG (renders inside the picker tile) */
  thumbnailSvg?: string;
  /**
   * When true: `render` is ONLY used for the picker tile thumbnail.
   * The canvas renders the widget via the standard WidgetRenderer
   * dispatch (e.g. IMAGE_CAROUSEL → ImageCarouselWidget) so config
   * like `urls`, `transition`, `intervalSec` actually applies.
   *
   * 2026-05-10 — added because the basic content variants
   * (image-basic, image-carousel-basic, video-basic, video-carousel-basic,
   * webpage-basic) used their tile components as canvas renders, which
   * showed the picker thumbnail forever (operator: "show the images
   * in the widget once we add them"). Marking them previewOnly: true
   * routes the canvas to the actual ImageCarouselWidget / ImageWidget /
   * VideoWidget / VideoCarouselWidget / WebpageWidget renderers.
   */
  previewOnly?: boolean;
}

const variants = new Map<string, WidgetVariant>();

export function registerVariant(v: WidgetVariant): void {
  variants.set(v.id, v);
}

export function getVariant(id: string | undefined): WidgetVariant | undefined {
  if (!id) return undefined;
  return variants.get(id);
}

/** List variants, optionally filtered by widget type and/or style category. */
export function listVariants(filter?: { widgetType?: WidgetType | string; category?: string }): WidgetVariant[] {
  const all = Array.from(variants.values());
  return all.filter(v => {
    if (filter?.widgetType && v.widgetType !== filter.widgetType) return false;
    if (filter?.category && v.category !== filter.category) return false;
    return true;
  });
}

/** Distinct widget types currently registered (used for the type filter chips). */
export function listVariantTypes(): WidgetType[] {
  const set = new Set<WidgetType>();
  variants.forEach(v => set.add(v.widgetType));
  return Array.from(set);
}

/** Distinct categories across all registered variants. */
export function listVariantCategories(): string[] {
  const set = new Set<string>();
  variants.forEach(v => v.category && set.add(v.category));
  return Array.from(set).sort();
}
