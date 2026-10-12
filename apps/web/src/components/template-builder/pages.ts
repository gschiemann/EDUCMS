/**
 * Pages — the operator-facing name for the template's SCENES (2026-10-12).
 *
 * Owner: "SCENES → 'Pages' (rename everywhere user-facing): build it like
 * Canva / PowerPoint / Intuiface." The data model is unchanged — a page IS a
 * `TemplateScene` row, a zone's `sceneId` says which page it is on (null =
 * the shared layer, shown on every page) and a "Go to page" tap is the
 * existing `goto-scene` touch action. Only the words and the surfaces moved.
 *
 * Pages only make sense on an interactive (touch) screen, so the Pages tab
 * and the page strip are hidden unless the template is interactive — touch
 * mode on, a tap action somewhere, or more than one page already (existing
 * multi-page data must never become unreachable).
 */
import type { TemplateScene, Zone } from './types';

export function isInteractiveTemplate(s: {
  isTouchEnabled: boolean;
  scenes: TemplateScene[];
  zones: Pick<Zone, 'touchAction'>[];
}): boolean {
  if (s.isTouchEnabled) return true;
  if ((s.scenes?.length ?? 0) >= 2) return true;
  return s.zones.some((z) => !!z.touchAction);
}

/** Pages in strip order: sortOrder, then the default first, then name. */
export function sortPages(scenes: TemplateScene[]): TemplateScene[] {
  return scenes.slice().sort((a, b) =>
    (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    || Number(b.isDefault) - Number(a.isDefault)
    || a.name.localeCompare(b.name));
}

/** The first "Page N" name not already taken. `label(n)` localises it. */
export function nextPageName(scenes: TemplateScene[], label: (n: number) => string): string {
  const taken = new Set(scenes.map((s) => s.name.trim().toLowerCase()));
  for (let n = scenes.length + 1; n < scenes.length + 500; n++) {
    const name = label(n);
    if (!taken.has(name.trim().toLowerCase())) return name;
  }
  return label(scenes.length + 1);
}

/**
 * The sortOrder writes that move page `id` one step left (-1) or right (+1).
 * Renumbers 0..n-1 in the new order and returns only the rows that change,
 * so legacy pages that all share sortOrder 0 get a real order on first move.
 */
export function reorderPages(scenes: TemplateScene[], id: string, dir: -1 | 1): Array<{ sceneId: string; sortOrder: number }> {
  const list = sortPages(scenes);
  const i = list.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return [];
  [list[i], list[j]] = [list[j], list[i]];
  const out: Array<{ sceneId: string; sortOrder: number }> = [];
  list.forEach((s, idx) => { if (s.sortOrder !== idx) out.push({ sceneId: s.id, sortOrder: idx }); });
  return out;
}

/** Zones a page shows on its own (not counting the shared layer). */
export function zonesOnPage(zones: Zone[], sceneId: string | null): Zone[] {
  return zones.filter((z) => (z.sceneId ?? null) === sceneId);
}

/** Widget types an operator reads as "a button" — they get the
 *  "When tapped → Go to page" control at the top of Properties. Any other
 *  zone can still be given a tap action further down. */
export function isTapTargetZone(z: Pick<Zone, 'widgetType' | 'touchAction'>): boolean {
  const t = String(z.widgetType || '').toUpperCase();
  return t === 'TOUCH_POINT' || t.startsWith('TOUCH_') || t.includes('BUTTON') || !!z.touchAction;
}
