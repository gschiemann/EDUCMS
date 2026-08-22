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

export type HolidayStyleToggle =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'hidden';

/**
 * Read both the canonical boolean controls and their first-generation CSS
 * aliases. The builder briefly saved `fontWeight` / `fontStyle` /
 * `textDecoration` directly; without this normalization its toolbar showed
 * those styles as inactive even while the iframe rendered them.
 */
export function isHolidayStyleToggleActive(
  style: HolidayTextStyle | undefined,
  toggle: HolidayStyleToggle,
): boolean {
  const current = style || {};
  if (toggle === 'bold') {
    if (typeof current.bold === 'boolean') return current.bold;
    return typeof current.fontWeight === 'number' && current.fontWeight >= 600;
  }
  if (toggle === 'italic') {
    if (typeof current.italic === 'boolean') return current.italic;
    return current.fontStyle === 'italic';
  }
  if (toggle === 'underline') {
    if (typeof current.underline === 'boolean') return current.underline;
    return typeof current.textDecoration === 'string' && current.textDecoration.includes('underline');
  }
  if (toggle === 'strikethrough') {
    if (typeof current.strikethrough === 'boolean') return current.strikethrough;
    return typeof current.textDecoration === 'string' && current.textDecoration.includes('line-through');
  }
  if (typeof current.hidden === 'boolean') return current.hidden;
  return current.visibility === 'hidden';
}

/**
 * Write a canonical toolbar toggle while removing the legacy property that
 * would otherwise win in the iframe bridge. Decoration toggles preserve the
 * other half of an old combined `underline line-through` value.
 */
export function updateHolidayStyleToggle(
  style: HolidayTextStyle | undefined,
  toggle: HolidayStyleToggle,
  enabled: boolean,
): HolidayTextStyle {
  const next: HolidayTextStyle = { ...(style || {}) };

  if (toggle === 'bold') delete next.fontWeight;
  if (toggle === 'italic') delete next.fontStyle;
  if (toggle === 'hidden') delete next.visibility;

  if (toggle === 'underline' || toggle === 'strikethrough') {
    const decoration = next.textDecoration || '';
    const hadUnderline = decoration.includes('underline');
    const hadStrike = decoration.includes('line-through');
    delete next.textDecoration;
    if (hadUnderline && toggle !== 'underline' && next.underline == null) next.underline = true;
    if (hadStrike && toggle !== 'strikethrough' && next.strikethrough == null) next.strikethrough = true;
  }

  if (enabled) next[toggle] = true;
  else delete next[toggle];
  return next;
}

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
    // Canonical boolean aliases deliberately supersede the first-generation
    // CSS-shaped keys, including an explicit `false` imported by older data.
    // Leaving both in the map makes the bridge's numeric/string key win and
    // produces a toolbar state that cannot actually turn the style off.
    if (Object.prototype.hasOwnProperty.call(newStyle, 'bold')) delete style.fontWeight;
    if (Object.prototype.hasOwnProperty.call(newStyle, 'italic')) delete style.fontStyle;
    if (
      Object.prototype.hasOwnProperty.call(newStyle, 'underline') ||
      Object.prototype.hasOwnProperty.call(newStyle, 'strikethrough')
    ) delete style.textDecoration;
    if (Object.prototype.hasOwnProperty.call(newStyle, 'hidden')) delete style.visibility;
    if (Object.keys(style).length > 0) merged[key] = style;
  });

  return merged;
}
