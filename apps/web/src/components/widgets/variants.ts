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
  /** Renderer — same shape as theme widget renderers */
  render: ComponentType<ThemeWidgetProps>;
  /** Default config to merge in when this variant is picked */
  defaultConfig?: Record<string, any>;
  /** Optional inline thumbnail SVG (renders inside the picker tile) */
  thumbnailSvg?: string;
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
