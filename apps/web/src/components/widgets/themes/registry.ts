/**
 * Theme Registry — the heart of EDU CMS's "scene-aware" widget system.
 *
 * Each theme is a self-contained pack of:
 *   - a `background` (CSS value or image URL) painting the scene,
 *   - per-widget renderers that draw widgets AS scene elements
 *     (e.g., a CLOCK becomes an analog wall clock; TEXT becomes chalk
 *     handwriting on a chalkboard; ANNOUNCEMENT becomes a sticky note
 *     pinned to a bulletin board),
 *   - optional `defaultZones` so duplicating the template gives users
 *     widgets pre-positioned on the scene's matching elements.
 *
 * Adding a new theme is a single folder + one `registerTheme()` call.
 * The registry is the *selling point*: every preset can have its own
 * visual language, and the platform learns new themes as schools/staff
 * publish them.
 */

import type { ComponentType } from 'react';

export type WidgetType =
  | 'CLOCK' | 'WEATHER' | 'COUNTDOWN' | 'TEXT' | 'RICH_TEXT'
  | 'ANNOUNCEMENT' | 'TICKER' | 'BELL_SCHEDULE' | 'LUNCH_MENU' | 'CALENDAR'
  | 'STAFF_SPOTLIGHT' | 'IMAGE' | 'IMAGE_CAROUSEL' | 'VIDEO' | 'LOGO'
  | 'WEBPAGE' | 'RSS_FEED' | 'SOCIAL_FEED' | 'PLAYLIST'
  // Touch (Sprint 4)
  | 'TOUCH_BUTTON' | 'TOUCH_MENU' | 'ROOM_FINDER' | 'ON_SCREEN_KEYBOARD'
  | 'WAYFINDING_MAP' | 'QUICK_POLL';

export interface ThemeWidgetProps {
  config: any;
  compact?: boolean;
  live?: boolean;
  // Optional inline-edit hook from the template builder (BuilderZone).
  // Variant renderers need this so EditableText nodes inside them can
  // commit operator edits back to the zone's defaultConfig. Without it
  // EditableText.canEdit is false and click-to-edit silently no-ops.
  onConfigChange?: (patch: Record<string, any>) => void;
}

export type ThemeWidgetRenderer = ComponentType<ThemeWidgetProps>;

export interface ThemeDefaultZone {
  name: string;
  widgetType: WidgetType | string;
  x: number; y: number; width: number; height: number;
  zIndex?: number;
  sortOrder?: number;
  defaultConfig?: Record<string, any>;
}

export interface Theme {
  /** Unique theme id, also stored in zone.defaultConfig.theme */
  id: string;
  /** Human-readable label shown in the theme picker */
  name: string;
  /** One-sentence pitch shown beside the swatch */
  description?: string;
  /** CSS `background` value applied to the template root (gradient + URL etc) */
  background: string;
  /** Optional fallback solid color (used when background fails to load) */
  bgColor?: string;
  /** Per-widget-type renderers. If a widget type isn't here, the default falls through. */
  widgets: Partial<Record<WidgetType, ThemeWidgetRenderer>>;
  /** Optional pre-built zone layout matched to scene elements */
  defaultZones?: ThemeDefaultZone[];
  /** Optional small swatch URL for the theme picker */
  thumbnailUrl?: string;
}

const themes = new Map<string, Theme>();

export function registerTheme(theme: Theme): void {
  if (themes.has(theme.id)) {
    // Allow re-registration in dev (HMR) — last write wins
    themes.set(theme.id, theme);
    return;
  }
  themes.set(theme.id, theme);
}

export function getTheme(id: string | undefined): Theme | undefined {
  if (!id) return undefined;
  return themes.get(id);
}

export function listThemes(): Theme[] {
  return Array.from(themes.values());
}

/**
 * Resolve the renderer for a (themeId, widgetType) pair.
 * Returns undefined if no theme is set or the theme doesn't override that widget.
 * Callers should fall back to their default renderer in that case.
 */
export function resolveWidget(
  themeId: string | undefined,
  widgetType: string,
): ThemeWidgetRenderer | undefined {
  if (!themeId) return undefined;
  const theme = themes.get(themeId);
  if (!theme) return undefined;
  return theme.widgets[widgetType as WidgetType];
}
