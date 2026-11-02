/**
 * Composer-side helpers for the broadcast banner options (2026-11-01).
 * Pure: the colour maths lives in @cms/api-types so the composer, the API and
 * the player can never disagree.
 */
import {
  BANNER_PRESET_COLORS,
  normalizeHex,
  readableTextOn,
  type BannerOptions,
  type BannerSpeed,
  type BannerMode,
} from '@cms/api-types';

export type ColorChoice =
  | { kind: 'default' }
  | { kind: 'brand-primary' }
  | { kind: 'brand-accent' }
  | { kind: 'preset'; id: (typeof BANNER_PRESET_COLORS)[number]['id'] }
  | { kind: 'custom'; hex: string };

export interface BrandColors { primary: string | null; accent: string | null }

/** The hex a choice resolves to, or null (standard severity colour / not yet valid). */
export function resolveColorChoice(choice: ColorChoice, brand: BrandColors): string | null {
  switch (choice.kind) {
    case 'default': return null;
    case 'brand-primary': return normalizeHex(brand.primary);
    case 'brand-accent': return normalizeHex(brand.accent);
    case 'preset': return BANNER_PRESET_COLORS.find((p) => p.id === choice.id)?.hex ?? null;
    case 'custom': return normalizeHex(choice.hex);
  }
}

export interface ContrastReport {
  text: string;
  ratio: number;
  /** false -> the composer warns: neither white nor dark text reaches WCAG AA. */
  passesAA: boolean;
}

/** Automatic text colour + AA verdict for a chosen banner colour (null = standard colours, always fine). */
export function contrastReport(hex: string | null): ContrastReport | null {
  return hex ? readableTextOn(hex) : null;
}

/** What the composer sends as `banner` (INFO / WARN text broadcasts only). */
export function bannerForSend(hex: string | null, mode: BannerMode, speed: BannerSpeed): BannerOptions {
  return { ...(hex ? { color: hex } : {}), mode, speed };
}

export type DurationPreset = 'custom' | '15m' | '1h' | '4h' | 'eod' | 'manual';

/** A whole-minute length for a preset; `custom` uses the typed minutes. */
export function durationMinutesFor(preset: DurationPreset, customMinutes: number, now: Date = new Date()): number {
  switch (preset) {
    case '15m': return 15;
    case '1h': return 60;
    case '4h': return 240;
    case 'manual': return 24 * 60; // the longest the API accepts; "until I clear it"
    case 'eod': {
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
      return Math.min(24 * 60, Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / 60000)));
    }
    case 'custom': return customMinutes;
  }
}
