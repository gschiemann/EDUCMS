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
  type BannerSize,
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

/**
 * What the composer sends as `banner` (INFO / WARN text broadcasts only), in
 * the canonical form the API stores: `size` only for small / large, so a
 * medium send is byte for byte what it was before text sizes existed (and is
 * accepted by an API build from before them).
 */
export function bannerForSend(hex: string | null, mode: BannerMode, speed: BannerSpeed, size: BannerSize = 'medium'): BannerOptions {
  return { ...(hex ? { color: hex } : {}), mode, speed, ...(size === 'small' || size === 'large' ? { size } : {}) };
}

/**
 * Deploy order (2026-11-23): true when a 400 answer is an API build from
 * before text sizes refusing the `size` key - and nothing else. Its strict
 * banner schema answers `{ issues: [{ path: 'banner', code:
 * 'unrecognized_keys', message: 'Unrecognized key: "size"' }] }` from the
 * validation pipe, before the handler runs, so nothing was written or sent
 * and the composer may resend once without `size` (the screens then draw
 * Medium, which is what that API build's players draw anyway). Any other
 * refusal - a bad colour, a bad size value on a current API, a missing
 * field - is not this, and is shown to the sender as before.
 */
export function refusedOnlyBannerSize(body: unknown): boolean {
  const issues = (body as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues) || issues.length === 0) return false;
  return issues.every((i) => {
    const issue = i as { path?: unknown; code?: unknown; message?: unknown } | null;
    if (issue?.path !== 'banner' || issue.code !== 'unrecognized_keys') return false;
    // The keys it names, quoted ("size" today, 'size' in older zod): only `size`.
    const keys = Array.from(String(issue.message ?? '').matchAll(/["']([^"']*)["']/g), (m) => m[1]);
    return keys.length > 0 && keys.every((k) => k === 'size');
  });
}

/** The same banner without its text size (Medium): the one resend `refusedOnlyBannerSize` allows. */
export function bannerWithoutSize<T extends { size?: unknown }>(banner: T): Omit<T, 'size'> {
  const rest: T = { ...banner };
  delete rest.size;
  return rest;
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
