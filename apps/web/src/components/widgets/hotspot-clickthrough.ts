/**
 * Hotspot click-through — lets the builder's per-field text editor be reached
 * on scene widgets that cover their own text with click hotspots.
 *
 * ── WHY (2026-08-09) ─────────────────────────────────────────────────
 * Scene widgets paint transparent "hotspot" overlays at `z-index: 50` over
 * regions of the canvas. Clicking one fires `aw-edit-section` so the
 * PropertiesPanel scrolls to the matching section. Useful — but the overlay
 * also sits ON TOP of the `[data-field]` text it covers.
 *
 * BuilderZone resolves the one-click text editor with
 * `e.target.closest('[data-field]')`. The hotspot has no `[data-field]`
 * ancestor, so that returned null on every click and the handler fell through
 * to a plain zone-select. Net effect: the PER-FIELD style controls (font size,
 * colour, weight — the bottom bar's "click any text on the canvas to edit its
 * style") were unreachable on these widgets. The only size control an operator
 * could find was the zone-wide one, which writes
 * `font-size: Npx !important` onto EVERY text node in the scene and so
 * flattens the whole type hierarchy to a single size. That is why the operator
 * reported "I can't edit text size" on a template that has a font-size field.
 *
 * ── WHAT THIS DOES ───────────────────────────────────────────────────
 * On click, look at what sits beneath the pointer. If it is a real field,
 * swallow the hotspot's own click (so the zone does not also process it as a
 * bare select) and replay the click on the field, so BuilderZone's delegated
 * handler sees the field as the target and opens per-field editing.
 *
 * The section dispatch stays on `onPointerDown` in each widget and is
 * untouched, so panel-scrolling behaves exactly as before. Non-text parts of a
 * hotspot (a sun, a balloon cluster) resolve to no field and are left alone.
 *
 * Hotspots only render in the builder (`!isLive`), so this never runs on a
 * paired screen or the published player.
 */
import type { MouseEvent as ReactMouseEvent } from 'react';

export function replayHotspotClickOnField(e: ReactMouseEvent<HTMLElement>): void {
  const el = e.currentTarget;
  if (!el || typeof document === 'undefined') return;

  // Momentarily make the overlay transparent to hit-testing so we can see what
  // it is covering, then restore it before anything can repaint.
  const prev = el.style.pointerEvents;
  el.style.pointerEvents = 'none';
  const under = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
  el.style.pointerEvents = prev;

  const fieldEl = under?.closest?.('[data-field]') as HTMLElement | null;
  if (!fieldEl) return; // not over text — leave the hotspot's normal behavior alone

  // The field is a SIBLING subtree, never a descendant of this hotspot, so the
  // replayed event cannot re-enter this handler.
  e.stopPropagation();
  fieldEl.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY }),
  );
}
