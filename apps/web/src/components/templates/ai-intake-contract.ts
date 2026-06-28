// ─────────────────────────────────────────────────────────────────────────
// AI Intake Contract — the guided-question → request-body bridge.
//
// Greg's call (2026-06-28): the AI generate flow gets a guided 6-question
// wizard (default) + an advanced one-screen view. Both collect the SAME
// directives and hand them to the EXISTING generate-candidates flow
// (useGenerateTouchCandidates → POST /templates/generate-touch/candidates).
//
// Every field is OPTIONAL on the wire. When omitted / "auto" the engine keeps
// TODAY's derive-from-prompt + vertical-affinity behavior — nothing regresses.
// The backend Zod schema (TemplateGenerateTouchCandidatesSchema) is
// `.passthrough()`, so these extra fields ride through even before the backend
// lane wires them in; the lead reconciles any rename at merge.
//
// This module owns the FRIENDLY-LABEL → REAL-ID mappings so the wizard, the
// advanced view, and the request builder can never drift apart. The real ids
// come straight from:
//   - packages/signage-design/src/archetypes.ts (the 9 archetype ids)
//   - packages/signage-design/src/themes.ts      (the 12 theme ids)
//   - packages/signage-design/src/surface-css.ts (SurfaceStyle: spotlight/duotone/wash + textured)
//   - apps/web/src/components/widgets/WidgetRenderer.tsx (the supported widgetTypes)
// ─────────────────────────────────────────────────────────────────────────

// ── PURPOSE ───────────────────────────────────────────────────────────────
// The 7 operator-facing "what's this screen for?" choices. Maps to a real
// archetype id per archetypes.ts (the engine sets the archetype explicitly).
export type IntakePurpose =
  | 'welcome'
  | 'menu'
  | 'promo'
  | 'event'
  | 'announcement'
  | 'feature'
  | 'photo-hero'
  | 'auto';

/** purpose → real archetype id (archetypes.ts). 'auto' → engine derives. */
export const PURPOSE_TO_ARCHETYPE: Record<Exclude<IntakePurpose, 'auto'>, string> = {
  // big welcome over a hero image / scrim
  welcome: 'hero-fullbleed',
  // priced rows, fixed value column
  menu: 'menu-list',
  // full-bleed photo + punchy offer + CTA ("today only")
  promo: 'poster-promo',
  // there is no dedicated countdown archetype; title-cta is the all-purpose
  // event/announcement layout (eyebrow + headline + body + CTA) and the
  // countdown lands as a zone via `widgets:['countdown']`.
  event: 'title-cta',
  // large centered statement / verse / value — quote-spotlight
  announcement: 'quote-spotlight',
  // image half / content half
  feature: 'split-50',
  // a photo-led hero (same container as welcome, image background mode)
  'photo-hero': 'hero-fullbleed',
};

export const PURPOSE_OPTIONS: ReadonlyArray<{
  key: IntakePurpose;
  label: string;
  hint: string;
  /** lucide icon name — resolved in the component (keeps this file dep-free). */
  icon: string;
}> = [
  { key: 'welcome', label: 'Welcome', hint: 'Greet visitors with a big headline', icon: 'Hand' },
  { key: 'menu', label: 'Menu / Pricing', hint: 'Priced items in clean rows', icon: 'ListOrdered' },
  { key: 'promo', label: 'Promo / Sale', hint: 'A punchy offer + call-to-action', icon: 'Tag' },
  { key: 'event', label: 'Event countdown', hint: 'Hype an upcoming date', icon: 'CalendarClock' },
  { key: 'announcement', label: 'Announcement', hint: 'One clear statement, front & center', icon: 'Megaphone' },
  { key: 'feature', label: 'Feature / Split', hint: 'Photo on one side, words on the other', icon: 'Columns2' },
  { key: 'photo-hero', label: 'Photo hero', hint: 'A full-screen image leads', icon: 'Image' },
];

// ── THEME ─────────────────────────────────────────────────────────────────
// 7 operator-facing mood labels → nearest real theme id (themes.ts has 12).
export type IntakeThemeKey =
  | 'Modern'
  | 'Bold'
  | 'Elegant'
  | 'Warm'
  | 'Neon'
  | 'Minimal'
  | 'Playful';

/** friendly mood → real theme id (themes.ts). */
export const THEME_TO_ID: Record<IntakeThemeKey, string> = {
  Modern: 'clean-corporate',
  Bold: 'bold-retail',
  Elegant: 'minimal-luxury',
  Warm: 'warm-school',
  Neon: 'neon-sports',
  Minimal: 'sky-civic',
  Playful: 'forest-campus',
};

export const THEME_OPTIONS: ReadonlyArray<{
  key: IntakeThemeKey;
  /** a tiny swatch pair (display only) so the chip reads at a glance. */
  swatch: [string, string];
}> = [
  { key: 'Modern', swatch: ['#0f172a', '#38bdf8'] },
  { key: 'Bold', swatch: ['#18181b', '#be185d'] },
  { key: 'Elegant', swatch: ['#0c0c0c', '#b8a06a'] },
  { key: 'Warm', swatch: ['#fffaf0', '#c2410c'] },
  { key: 'Neon', swatch: ['#0a0a0a', '#facc15'] },
  { key: 'Minimal', swatch: ['#f8fafc', '#1d4ed8'] },
  { key: 'Playful', swatch: ['#0b1a12', '#84cc16'] },
];

// ── COLORS / PALETTE ────────────────────────────────────────────────────────
export type IntakePaletteMode = 'brand' | 'custom' | 'auto';

/** A few ready-made swatch sets for the "pick a palette" option. */
export const PALETTE_PRESETS: ReadonlyArray<{ key: string; label: string; colors: string[] }> = [
  { key: 'ocean', label: 'Ocean', colors: ['#0ea5e9', '#0f172a', '#f0f9ff'] },
  { key: 'sunset', label: 'Sunset', colors: ['#f59e0b', '#be123c', '#1a0a0a'] },
  { key: 'forest', label: 'Forest', colors: ['#16a34a', '#0b1a12', '#f0fdf4'] },
  { key: 'grape', label: 'Grape', colors: ['#7c3aed', '#0a0a14', '#f5f5ff'] },
  { key: 'mono', label: 'Mono', colors: ['#111827', '#6b7280', '#f9fafb'] },
];

// The on-wire palette value, mirrored from the SHARED CONTRACT.
export type PaletteDirective = 'brand' | 'auto' | { colors: string[] };

// ── BACKGROUND ──────────────────────────────────────────────────────────────
// Maps to SurfaceStyle (surface-css.ts: spotlight/duotone/wash + textured) and
// the image plan. 'photo' = AI-generated background (metered / BYOK). 'auto' =
// engine decides.
export type IntakeBackground = 'solid' | 'gradient' | 'textured' | 'photo' | 'auto';

export const BACKGROUND_OPTIONS: ReadonlyArray<{
  key: IntakeBackground;
  label: string;
  hint: string;
}> = [
  { key: 'solid', label: 'Solid', hint: 'One clean color' },
  { key: 'gradient', label: 'Gradient', hint: 'Smooth color blend' },
  { key: 'textured', label: 'Textured', hint: 'Subtle depth & glow' },
  { key: 'photo', label: 'AI photo', hint: 'Generate a background image' },
  { key: 'auto', label: 'Let AI choose', hint: 'Best fit for the look' },
];

// ── WIDGETS / CONTENT ELEMENTS ──────────────────────────────────────────────
// Operator-facing content chips → the canonical content-element key sent on the
// wire (the engine maps each to a real widgetType the WidgetRenderer supports).
export type IntakeWidgetKey =
  | 'headline'
  | 'subtext'
  | 'logo'
  | 'image'
  | 'clock'
  | 'date'
  | 'weather'
  | 'countdown'
  | 'menu'
  | 'ticker'
  | 'qr'
  | 'cta';

/**
 * content-element key → real widgetType (WidgetRenderer). Documented here so the
 * backend lane can adopt the SAME mapping; the engine includes these as zones.
 * (headline/subtext/date/cta all render as TEXT — the engine names/positions the
 * zone; date also has DATE-aware config; qr → WEBPAGE-style QR; etc.)
 */
export const WIDGET_TO_TYPE: Record<IntakeWidgetKey, string> = {
  headline: 'TEXT',
  subtext: 'TEXT',
  logo: 'LOGO',
  image: 'IMAGE',
  clock: 'CLOCK',
  date: 'CLOCK', // CLOCK widget renders date too (showDate config)
  weather: 'WEATHER',
  countdown: 'COUNTDOWN',
  menu: 'LUNCH_MENU',
  ticker: 'TICKER',
  // No dedicated QR widgetType exists in WidgetRenderer; a QR renders honestly
  // as an IMAGE (the engine supplies the QR image URL).
  qr: 'IMAGE',
  cta: 'TEXT',
};

export const WIDGET_OPTIONS: ReadonlyArray<{ key: IntakeWidgetKey; label: string; icon: string }> = [
  { key: 'headline', label: 'Headline', icon: 'Type' },
  { key: 'subtext', label: 'Subtext', icon: 'Text' },
  { key: 'logo', label: 'Logo', icon: 'BadgeCheck' },
  { key: 'image', label: 'Photo', icon: 'Image' },
  { key: 'clock', label: 'Clock', icon: 'Clock' },
  { key: 'date', label: 'Date', icon: 'Calendar' },
  { key: 'weather', label: 'Weather', icon: 'CloudSun' },
  { key: 'countdown', label: 'Countdown', icon: 'Timer' },
  { key: 'menu', label: 'Menu / prices', icon: 'ListOrdered' },
  { key: 'ticker', label: 'Ticker', icon: 'AlignJustify' },
  { key: 'qr', label: 'QR code', icon: 'QrCode' },
  { key: 'cta', label: 'Button / CTA', icon: 'MousePointerClick' },
];

// Sensible default content per purpose so the wizard pre-checks the obvious
// elements — the operator can complete the whole step in zero clicks.
export const DEFAULT_WIDGETS_BY_PURPOSE: Record<Exclude<IntakePurpose, 'auto'>, IntakeWidgetKey[]> = {
  welcome: ['headline', 'subtext', 'logo'],
  menu: ['headline', 'menu'],
  promo: ['headline', 'subtext', 'cta'],
  event: ['headline', 'countdown', 'cta'],
  announcement: ['headline', 'subtext'],
  feature: ['headline', 'subtext', 'image'],
  'photo-hero': ['headline', 'image'],
};

// ── THE COLLECTED ANSWERS (UI state shape) ─────────────────────────────────
export interface AiIntakeAnswers {
  purpose: IntakePurpose;
  theme: IntakeThemeKey | 'auto';
  paletteMode: IntakePaletteMode;
  /** chosen swatch colors when paletteMode === 'custom'. */
  paletteColors: string[];
  background: IntakeBackground;
  widgets: IntakeWidgetKey[];
}

export const DEFAULT_INTAKE_ANSWERS: AiIntakeAnswers = {
  purpose: 'auto',
  theme: 'auto',
  paletteMode: 'auto',
  paletteColors: [],
  background: 'auto',
  widgets: [],
};

// ── THE REQUEST-BODY FIELDS (on the wire) ──────────────────────────────────
// Exactly the SHARED CONTRACT field names. Every one optional; omitted ⇒
// today's behavior. The page spreads this onto the existing generate body.
export interface AiIntakeRequestFields {
  purpose?: IntakePurpose;
  theme?: string;
  palette?: PaletteDirective;
  background?: IntakeBackground;
  widgets?: string[];
}

/**
 * Turn the operator's answers into the optional contract fields. Anything left
 * on 'auto' / empty is OMITTED entirely so the engine falls back to its
 * derive-from-prompt + vertical-affinity behavior (no regression).
 *
 * NOTE: we send the FRIENDLY purpose key + the FRIENDLY theme label-or-'auto'
 * resolved to the real theme id. The mappings above (PURPOSE_TO_ARCHETYPE,
 * THEME_TO_ID) are the documented contract the backend lane mirrors; sending
 * `purpose` as the semantic key (not the archetype id) keeps the wire
 * human-readable and lets the backend own the final archetype resolution.
 */
export function buildIntakeRequestFields(a: AiIntakeAnswers): AiIntakeRequestFields {
  const out: AiIntakeRequestFields = {};

  if (a.purpose && a.purpose !== 'auto') {
    out.purpose = a.purpose;
  }

  if (a.theme && a.theme !== 'auto') {
    // Resolve the friendly mood to its real theme id (themes.ts). The engine
    // treats it as a STRONG directive (set the theme explicitly).
    out.theme = THEME_TO_ID[a.theme];
  }

  if (a.paletteMode === 'brand') {
    out.palette = 'brand';
  } else if (a.paletteMode === 'custom' && a.paletteColors.length > 0) {
    out.palette = { colors: a.paletteColors };
  } // 'auto' → omit (engine uses the theme palette)

  if (a.background && a.background !== 'auto') {
    out.background = a.background;
  }

  if (a.widgets && a.widgets.length > 0) {
    out.widgets = [...a.widgets];
  }

  return out;
}
