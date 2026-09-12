/**
 * ONE text-style contract for every renderer in the product.
 *
 * THE BUG THIS EXISTS TO KILL (M0-3, 2026-09-12). The builder's text bar
 * writes BOOLEAN flags into the per-field override map — `_styles[field] =
 * { bold: true, italic: true, underline: true, strikethrough: true }`
 * (BuilderShell's `setFieldStyleProp`, PropertiesPanel's `FormatToggles`).
 * The React-zone renderer understands them. Every EXTERNAL_HTML board shim
 * does NOT: the baked shim (`apps/web/scripts/inject-shim-v2.cjs`), the 30
 * hand-crafted menu-board shims, the kiosk `_edit-shim.js` and the AI
 * designer shim (`apps/api/src/ai/designer-edit-shim.ts`) all read CSS
 * props only — `fontWeight` / `fontStyle` / `textDecoration`. The sender
 * (`WidgetRenderer`'s `ExternalHtmlWidget`) forwarded the map VERBATIM, so
 * on all 250 packaged boards the operator pressed Bold, the button lit up,
 * and the headline did not change — in the builder AND on the player.
 *
 * Measured on a real board (`/templates/hs/achievement.html`, chromium)
 * before the fix, posting the map the builder actually writes:
 *
 *   sent {bold,italic,underline,strikethrough,lineHeight,textAlign,backgroundColor}
 *   got  fontWeight 900 (board default) · fontStyle normal · textDecorationLine none
 *        lineHeight 55.1px ✅ · textAlign center ✅ · backgroundColor red ✅
 *
 * i.e. exactly the four boolean controls died and the CSS-shaped ones
 * already worked. Translating the same map to `{fontWeight:800,
 * fontStyle:'italic', textDecoration:'underline line-through', …}` made
 * every one of them land.
 *
 * So this module owns the translation, ONCE, and every renderer derives
 * from it:
 *   - `BuilderZone`   — builder canvas CSS rules (React zones)
 *   - `player/page`   — player CSS rules (React zones)
 *   - `WidgetRenderer`— the `textStyles` payload sent to EXTERNAL_HTML boards
 *
 * PRECEDENCE (identical to the holiday `_style-bridge.js`, which already
 * got this right): an explicit CSS-shaped value always beats the boolean
 * alias — a numeric `fontWeight` wins over `bold`, a `fontStyle` string
 * wins over `italic`, a `textDecoration` string wins over
 * `underline`/`strikethrough`. `underline` + `strikethrough` combine.
 *
 * The per-field style object is `HolidayTextStyle` (the name is historical
 * — it is the app-wide `_styles` shape, not a holiday-only one).
 */
import type { HolidayTextStyle } from './holiday-style-contract';

/** The per-field override object the builder writes into `cfg._styles`. */
export type TextStyleOverride = HolidayTextStyle;

/**
 * The CSS-prop-only shape EVERY board shim already speaks. Deliberately
 * carries no boolean aliases: this is what goes over the wire.
 */
export interface CssTextStyle {
  fontFamily?: string;
  /** px. A string is passed through untouched — the shims accept both. */
  fontSize?: number | string;
  color?: string;
  backgroundColor?: string;
  fontWeight?: number;
  fontStyle?: 'italic' | 'normal';
  textDecoration?: string;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number;
  hidden?: boolean;
}

/** What `bold: true` means in CSS. One number, one place. */
export const BOLD_FONT_WEIGHT = 800;

export const TEXT_ALIGNMENTS = ['left', 'center', 'right', 'justify'] as const;
export type TextAlign = (typeof TEXT_ALIGNMENTS)[number];

/**
 * `cfg._styles[key]` can legitimately hold `null` (the player's copy of the
 * rule builder carried an explicit "never deref null" guard for exactly
 * this). Normalise once, here, so no caller has to remember.
 */
function asStyle(value: unknown): TextStyleOverride {
  return value && typeof value === 'object' ? (value as TextStyleOverride) : {};
}

/** Numeric weight wins; `bold: true` is the alias. */
export function resolveFontWeight(style: unknown): number | undefined {
  const s = asStyle(style);
  if (typeof s.fontWeight === 'number' && Number.isFinite(s.fontWeight)) return s.fontWeight;
  if (s.bold === true) return BOLD_FONT_WEIGHT;
  return undefined;
}

/** An explicit `fontStyle` wins; `italic: true` is the alias. */
export function resolveFontStyle(style: unknown): 'italic' | 'normal' | undefined {
  const s = asStyle(style);
  if (s.fontStyle === 'italic' || s.fontStyle === 'normal') return s.fontStyle;
  if (s.italic === true) return 'italic';
  return undefined;
}

/**
 * An explicit `textDecoration` string wins; otherwise `underline` and
 * `strikethrough` COMBINE (`"underline line-through"`), because the
 * operator can push both buttons at once.
 */
export function resolveTextDecoration(style: unknown): string | undefined {
  const s = asStyle(style);
  if (typeof s.textDecoration === 'string' && s.textDecoration.trim()) return s.textDecoration.trim();
  const decorations: string[] = [];
  if (s.underline === true) decorations.push('underline');
  if (s.strikethrough === true) decorations.push('line-through');
  return decorations.length ? decorations.join(' ') : undefined;
}

/** `hidden` wins; the first-generation `visibility` string is the alias. */
export function resolveHidden(style: unknown): boolean | undefined {
  const s = asStyle(style);
  if (typeof s.hidden === 'boolean') return s.hidden;
  if (s.visibility === 'hidden') return true;
  if (s.visibility === 'visible') return false;
  return undefined;
}

function trimmed(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function align(value: unknown): TextAlign | undefined {
  return typeof value === 'string' && (TEXT_ALIGNMENTS as readonly string[]).includes(value)
    ? (value as TextAlign)
    : undefined;
}

/**
 * Translate ONE per-field override into the CSS-prop contract every board
 * shim understands. Idempotent: a map that is already CSS-shaped comes back
 * unchanged (the explicit values win over the aliases, and there are no
 * aliases to apply).
 *
 * NOTE the trimming: `color` / `fontFamily` / `backgroundColor` are emitted
 * TRIMMED, matching what `buildTextStyleRules` has always written into the
 * builder's CSS, so builder and board resolve the identical value.
 */
export function toCssTextStyle(style: unknown): CssTextStyle {
  const s = asStyle(style);
  const out: CssTextStyle = {};

  const family = trimmed(s.fontFamily);
  if (family) out.fontFamily = family;

  if (typeof s.fontSize === 'number' && Number.isFinite(s.fontSize)) out.fontSize = s.fontSize;
  else {
    // A string size ("56px", "4vw") is not produced by any current control,
    // but the shims have always accepted one and a saved template may hold
    // it. Dropping it here would be a silent regression.
    const size = trimmed(s.fontSize as unknown);
    if (size) out.fontSize = size;
  }

  const color = trimmed(s.color);
  if (color) out.color = color;

  const background = trimmed(s.backgroundColor);
  if (background) out.backgroundColor = background;

  const weight = resolveFontWeight(s);
  if (weight != null) out.fontWeight = weight;

  const fontStyle = resolveFontStyle(s);
  if (fontStyle) out.fontStyle = fontStyle;

  const decoration = resolveTextDecoration(s);
  if (decoration) out.textDecoration = decoration;

  const textAlign = align(s.textAlign);
  if (textAlign) out.textAlign = textAlign;

  if (typeof s.lineHeight === 'number' && Number.isFinite(s.lineHeight)) out.lineHeight = s.lineHeight;

  const hidden = resolveHidden(s);
  if (hidden != null) out.hidden = hidden;

  return out;
}

/**
 * Translate the WHOLE `_styles` map for the wire. Empty results are dropped
 * so a board's own design shows through and the URL stays short (the
 * EXTERNAL_HTML encoder already drops empty objects; this keeps the two in
 * agreement).
 *
 * Returns `undefined` for a non-object input so callers can keep their
 * existing `if (styles)` guards.
 */
export function toCssTextStyleMap(
  styles: unknown,
): Record<string, CssTextStyle> | undefined {
  if (!styles || typeof styles !== 'object') return undefined;
  const out: Record<string, CssTextStyle> = {};
  for (const [key, value] of Object.entries(styles as Record<string, unknown>)) {
    const css = toCssTextStyle(value);
    if (Object.keys(css).length) out[key] = css;
  }
  return out;
}

/**
 * The INHERITABLE half of the contract, as `!important` CSS declarations.
 * Applied to the field AND its descendants by every React-zone renderer.
 *
 * Declaration ORDER is load-bearing only in that it must not churn: this
 * reproduces `BuilderZone.buildRules` byte for byte for every input it
 * already accepted (font-family, font-size, color, line-height, text-align,
 * font-weight, font-style, text-decoration).
 */
export function buildTextStyleRules(style: unknown): string[] {
  const css = toCssTextStyle(style);
  const rules: string[] = [];
  if (css.fontFamily) rules.push(`font-family: ${css.fontFamily} !important`);
  if (typeof css.fontSize === 'number' && css.fontSize) rules.push(`font-size: ${css.fontSize}px !important`);
  if (css.color) rules.push(`color: ${css.color} !important`);
  if (css.lineHeight) rules.push(`line-height: ${css.lineHeight} !important`);
  if (css.textAlign) rules.push(`text-align: ${css.textAlign} !important`);
  if (css.fontWeight != null) rules.push(`font-weight: ${css.fontWeight} !important`);
  if (css.fontStyle) rules.push(`font-style: ${css.fontStyle} !important`);
  if (css.textDecoration) rules.push(`text-decoration: ${css.textDecoration} !important`);
  return rules;
}

/**
 * The ELEMENT-ONLY half: a background highlight paints the field, not every
 * nested span, and hiding a field must not hide unrelated inner structure.
 * Byte-identical to `BuilderZone.buildFieldOnlyRules`.
 */
export function buildFieldOnlyStyleRules(style: unknown): string[] {
  const s = asStyle(style);
  const rules: string[] = [];
  const background = trimmed(s.backgroundColor);
  if (background) rules.push(`background-color: ${background} !important`);
  if (s.hidden === true) rules.push('display: none !important');
  else if (s.visibility === 'hidden' || s.visibility === 'visible') {
    rules.push(`visibility: ${s.visibility} !important`);
  }
  return rules;
}
