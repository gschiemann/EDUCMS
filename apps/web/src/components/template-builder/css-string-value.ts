/**
 * Escape a value for use INSIDE a double-quoted CSS string — an attribute
 * selector like `[data-field="…"]` in a `<style>` the builder writes.
 *
 * `CSS.escape` is for identifiers, not strings, and the old
 * `replace(/"/g, '\\"')` left the backslash itself unescaped: a key ending
 * `\"` became `\\"` — an escaped backslash followed by a LIVE quote — and
 * closed the string early, so the rest of the key landed in the stylesheet
 * as rules (CodeQL js/incomplete-sanitization, 2026-10-22). Field keys come
 * from a template's `textStyles` config, so a shared or imported template
 * could carry one.
 *
 * Per CSS Syntax §4.3.7 a string may not contain an unescaped `"`, `\` or a
 * newline; each of those is written as a backslash escape (`\` + the
 * code point in hex + a space, so a following hex digit cannot be consumed).
 */
export function cssStringValue(value: string): string {
  return String(value).replace(/["\\\n\r\f]/g, (ch) => `\\${ch.charCodeAt(0).toString(16)} `);
}
