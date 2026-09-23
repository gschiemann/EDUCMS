/**
 * Prepare the BACKPLATE frame: every element that directly holds text gets
 * `-webkit-text-fill-color: transparent !important`, so a second screenshot
 * shows exactly what is behind each glyph (see src/metrics/contrast.ts).
 *
 * Only the glyph FILL goes. `color` is left alone on purpose: borders, SVG
 * icons and decorations that use currentColor must stay in the backplate, or
 * the "background" would lose pieces of the design. Shadows and strokes stay
 * too — they are part of what a glyph is read against.
 *
 * ⚠️ Serialised into the page (page.evaluate): self-contained, no imports.
 * Inline-style writes through the CSSOM are not subject to the board's CSP.
 */
export function hideTextInk(): number {
  const root = document.body || document.documentElement;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE', 'TEXTAREA', 'OPTION', 'HEAD']);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const done = new Set<Element>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n as Text;
    const el = text.parentElement;
    if (!el || done.has(el) || SKIP.has(el.tagName) || !/\S/.test(text.data)) continue;
    done.add(el);
    const style = (el as HTMLElement).style;
    if (!style) continue;
    style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
    if (el instanceof SVGElement) style.setProperty('fill', 'transparent', 'important');
    // background-clip:text paints a background THROUGH the glyphs — with the
    // glyphs gone, that background is text too.
    const cs = getComputedStyle(el);
    const clip = (cs as unknown as { webkitBackgroundClip?: string }).webkitBackgroundClip || cs.backgroundClip;
    if (clip === 'text') {
      style.setProperty('background-image', 'none', 'important');
      style.setProperty('background-color', 'transparent', 'important');
    }
  }
  return done.size;
}
