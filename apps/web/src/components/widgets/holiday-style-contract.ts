/**
 * Text-style contract shared by the HOLIDAY editor and iframe renderer.
 *
 * `_styles` is the canonical map used by the builder. `__styles` was briefly
 * shipped by the first holiday editor and remains readable so existing saved
 * templates do not lose their formatting. Canonical values win property by
 * property, which lets a newly edited field inherit untouched legacy values
 * until BuilderShell migrates the complete map to `_styles`.
 */
export interface HolidayTextStyle {
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  fontWeight?: number;
  fontStyle?: 'italic' | 'normal';
  textDecoration?: 'underline' | 'line-through' | 'underline line-through' | 'none';
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  lineHeight?: number;
  backgroundColor?: string;
  visibility?: 'visible' | 'hidden';
  hidden?: boolean;
  /** Canonical BuilderBottomBar aliases. */
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

export type HolidayTextStyleMap = Record<string, HolidayTextStyle>;

function asStyleMap(value: unknown): HolidayTextStyleMap {
  return value && typeof value === 'object'
    ? value as HolidayTextStyleMap
    : {};
}

/** Merge legacy `__styles` with canonical `_styles` without mutating either. */
export function mergeHolidayTextStyleMaps(
  legacy: unknown,
  canonical: unknown,
): HolidayTextStyleMap {
  const legacyMap = asStyleMap(legacy);
  const canonicalMap = asStyleMap(canonical);
  const keys = new Set([...Object.keys(legacyMap), ...Object.keys(canonicalMap)]);
  const merged: HolidayTextStyleMap = {};

  keys.forEach((key) => {
    const oldStyle = legacyMap[key] && typeof legacyMap[key] === 'object'
      ? legacyMap[key]
      : {};
    const newStyle = canonicalMap[key] && typeof canonicalMap[key] === 'object'
      ? canonicalMap[key]
      : {};
    const style = { ...oldStyle, ...newStyle };
    if (Object.keys(style).length > 0) merged[key] = style;
  });

  return merged;
}

