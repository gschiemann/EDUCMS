/**
 * pos-bound-coverage.ts — which of a POS-bound board's rows are live, sold out,
 * or gone from the menu, as the BUILDER shows it (POS-A, 2026-09-23).
 *
 * It grades each bound row with `bindingStateOf` — the SAME rule the screen
 * uses when it paints the row (resolve-menu-bindings.ts) — against the menu the
 * API reads for this location (GET /templates/concierge/pos-bound-menu: sold-out
 * items included, every section whatever the hour). So "2 sold out right now"
 * in the builder and "Sold out" on the glass come from one rule.
 *
 * PURE — unit-tested in __tests__/pos-bound-coverage.test.ts.
 */
import { bindingStateOf, rowNumberOfSlot, type BindingState } from './resolve-menu-bindings';

/** One item of the bound connection's menu (ConciergePosBoundItem, structurally). */
export interface BoundMenuItem {
  externalId: string;
  name: string;
  price: string;
  available: boolean;
}

export interface CoverageRow {
  slot: string;
  /** `data-menu-row` number for an `item.N` slot. */
  row: string | null;
  externalId: string;
  state: BindingState;
  /** The menu's item, when it is on the menu. */
  item?: BoundMenuItem;
}

export interface PosBoundCoverage {
  rows: CoverageRow[];
  live: CoverageRow[];
  soldOut: CoverageRow[];
  missing: CoverageRow[];
}

export function posBoundCoverage(slots: Record<string, string>, items: readonly BoundMenuItem[]): PosBoundCoverage {
  const byId = new Map<string, BoundMenuItem>();
  for (const it of items) {
    if (!it || typeof it.externalId !== 'string' || !it.externalId) continue;
    const prev = byId.get(it.externalId);
    if (!prev || (prev.available === false && it.available !== false)) byId.set(it.externalId, it);
  }
  const rows: CoverageRow[] = Object.keys(slots)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((slot) => {
      const externalId = slots[slot];
      const item = byId.get(externalId);
      return { slot, row: rowNumberOfSlot(slot), externalId, state: bindingStateOf(item), ...(item ? { item } : {}) };
    });
  return {
    rows,
    live: rows.filter((r) => r.state === 'live'),
    soldOut: rows.filter((r) => r.state === 'soldout'),
    missing: rows.filter((r) => r.state === 'missing'),
  };
}

/**
 * The words each bound row shows in the board as saved — what a missing row
 * keeps on screens, and what the builder calls it. Read from the board's own
 * `item.N.name` fields (first text node, as every shim writes them).
 */
export function boardRowNames(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof html !== 'string' || !html || typeof DOMParser === 'undefined') return out;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('[data-field$=".name"]').forEach((el) => {
      const key = el.getAttribute('data-field') || '';
      const slot = key.slice(0, -'.name'.length);
      if (!slot || slot in out) return;
      let text = '';
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType === 3 && (n.textContent || '').trim()) { text = (n.textContent || '').trim(); break; }
      }
      out[slot] = text || (el.textContent || '').trim();
    });
  } catch {
    /* a board we cannot parse names no rows */
  }
  return out;
}
