/**
 * Heal background-pattern CSS saved before 2026-09-13.
 *
 * The Background panel's six SVG patterns were double-encoded ('%23' in the
 * source, encoded again to '%2523'), so the browser decoded a fill of
 * '%23cbd5e1' — not a colour — and the pattern painted only its plain
 * background. New selections are encoded once (Codex T06); templates that
 * still carry the old string get it repaired wherever the CSS is applied
 * (builder canvas, gallery thumbnail, player). A '%2523' can only come from
 * that bug — no valid data-URL SVG needs a literal '%23' inside its markup.
 */
export function healPatternCss(css: string | null | undefined): string | null | undefined {
  if (!css || css.indexOf('%2523') === -1) return css;
  return css.replace(/%2523/g, '%23');
}
