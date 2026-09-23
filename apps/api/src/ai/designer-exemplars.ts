/**
 * designer-exemplars.ts — which reference boards the AI Designer shows the model
 * (2026-09-22, AI Designer rework).
 *
 * GPT-6 Sol made boards Greg praised when Codex drove it with our real boards in
 * front of it, and sparse posters when our Designer gave it ONE 1080p cafe poster
 * (docs/research/2026-09-22-ai-designer-rework/01-*.md, cause #5). The boards
 * themselves are compiled from apps/web/public/templates by
 * apps/api/scripts/build-designer-exemplars.cjs into the committed
 * designer-exemplars.generated.ts (the API image does not ship apps/web/public).
 * This module only CHOOSES among them.
 *
 * The compiled boards carry no business's content: every word, price and photo
 * is a neutral placeholder (VENUE NAME, Menu Item One, $0.00, empty frames), so
 * the model learns layout, type scale and structure and has nothing to copy —
 * and every venue, including the one a board was first made for, gets them.
 *
 * Rules (pure, deterministic, unit-tested in designer-exemplars.spec.ts):
 *   - only boards tagged for the request's purpose;
 *   - the request's own venue type first (2026-09-23): a board made for this
 *     venue's family (designerVerticalFamily — food / school / fitness / retail),
 *     then one made for another family, and a board kept to its own family
 *     (`verticalOnly` — the K-12 boards) only when the purpose has nothing else.
 *     A taqueria's menu never gets a school lunch board; with no vertical passed
 *     every board is "another family's", which is exactly the old selection;
 *   - the candidate's own structure first, then a different structure, so the
 *     three candidates of a batch are each anchored on a different layout;
 *   - the request's orientation, else the other one;
 *   - at most two per request by default (~3k tokens each), three at most.
 */
import { DESIGNER_EXEMPLARS } from './designer-exemplars.generated';
import { findDesignerStructure, type DesignerPurpose } from './designer-structures';
// A call-time use only (inside selectDesignerExemplars), so the cycle with
// designer-prompt.ts — which imports formatExemplarsForPrompt from here — is
// safe in either load order (pinned in designer-exemplars.spec.ts). Both stay
// free of runtime packages (designer-prompt-purity.spec.ts).
import { designerVerticalFamily } from './designer-prompt';

export type { DesignerPurpose };

export interface DesignerExemplar {
  /** Neutral id; which board it was compiled from is SOURCES in the builder. */
  id: string;
  title: string;
  /** First 16 hex chars of the source board's SHA-256 at build time. */
  sourceSha256: string;
  /** Where the approval is recorded. */
  approval: string;
  vertical: string;
  /**
   * The venue families (designerVerticalFamily: 'food', 'school', 'fitness',
   * 'retail' …) the board was made for. Optional: an untagged board is for any venue.
   */
  verticals?: string[];
  /** Shown to another venue type only when its purpose has no other board (the K-12 boards). */
  verticalOnly?: boolean;
  purposes: DesignerPurpose[];
  /** Layout family — matches a DesignerStructure id in designer-prompt.ts. */
  structure: string;
  orientation: 'landscape' | 'portrait';
  width: number;
  height: number;
  /** Menu/offer items the board shows (item.N groups). */
  itemCount: number;
  /** Every item carries a price field (item.N.price) — the boards the POS binder and price guard are tested on. */
  priced?: boolean;
  /** The injected runtimes the builder stripped (proof the markup is hand-written). */
  strippedRuntimes: string[];
  /** The board: CSS + markup only, no script. */
  html: string;
}

export { DESIGNER_EXEMPLARS };

export interface SelectDesignerExemplarsInput {
  purpose: DesignerPurpose;
  orientation: 'landscape' | 'portrait';
  /** How many items the board carries (menu rows / offers); 0 when unknown. */
  itemCount?: number;
  /** This candidate's structure — its matching reference goes first. */
  structureId?: string;
  /**
   * The BOARD's venue type (inferDesignerVertical — 'QSR', 'K12', 'GYM', …).
   * Absent: no preference, and nothing a venue type would change.
   */
  vertical?: string | null;
  max?: number;
  /** Test seam: the pool to choose from (defaults to the compiled set). */
  pool?: readonly DesignerExemplar[];
}

/**
 * The family a request's venue type belongs to, in the spelling the boards'
 * `verticals` use ('food', 'school', 'fitness', 'retail'; any other type is its
 * own family). '' when no vertical was passed.
 */
export function exemplarFamilyFor(vertical?: string | null): string {
  return typeof vertical === 'string' && vertical.trim() ? designerVerticalFamily(vertical).toLowerCase() : '';
}

/**
 * 0 — made for this family, or for any venue (no `verticals`);
 * 1 — made for another family, open to every venue;
 * 2 — made for another family and kept to it (`verticalOnly`).
 */
export function exemplarTier(e: DesignerExemplar, family: string): 0 | 1 | 2 {
  if (!e.verticals || e.verticals.length === 0) return 0;
  if (family && e.verticals.includes(family)) return 0;
  return e.verticalOnly ? 2 : 1;
}

/** Choose up to `max` (default 2) reference boards for one candidate. */
export function selectDesignerExemplars(input: SelectDesignerExemplarsInput): DesignerExemplar[] {
  const pool = input.pool ?? DESIGNER_EXEMPLARS;
  const max = Math.max(0, Math.min(input.max ?? 2, 3));
  const items = Math.max(0, input.itemCount ?? 0);
  const family = exemplarFamilyFor(input.vertical);
  const tier = (e: DesignerExemplar) => exemplarTier(e, family);
  let eligible = pool.filter((e) => e.purposes.includes(input.purpose));
  // A board kept to its own venue type reaches another type only when the
  // purpose has nothing else to show.
  if (eligible.some((e) => tier(e) < 2)) eligible = eligible.filter((e) => tier(e) < 2);
  if (!eligible.length || !max) return [];

  // One board per structure: the one made for this venue first, then the
  // request's orientation if the structure has it, else the other orientation —
  // a portrait request still learns from a landscape board rather than from
  // nothing.
  const byStructure = new Map<string, DesignerExemplar>();
  for (const e of eligible) {
    const cur = byStructure.get(e.structure);
    if (
      !cur ||
      tier(e) < tier(cur) ||
      (tier(e) === tier(cur) && cur.orientation !== input.orientation && e.orientation === input.orientation)
    ) {
      byStructure.set(e.structure, e);
    }
  }
  const one = [...byStructure.values()];

  // Primary: this candidate's own structure. Then the rest: made for this
  // venue first, then a board whose purpose list LEADS with this purpose (a
  // true menu board before an offer board that also shows a menu item), then
  // the closest item count, then id for determinism.
  const lead = (e: DesignerExemplar) => (e.purposes[0] === input.purpose ? 0 : 1);
  one.sort(
    (a, b) =>
      Number(b.structure === input.structureId) - Number(a.structure === input.structureId) ||
      tier(a) - tier(b) ||
      lead(a) - lead(b) ||
      Math.abs(a.itemCount - items) - Math.abs(b.itemCount - items) ||
      a.id.localeCompare(b.id),
  );
  return one.slice(0, max);
}

/** Human label for a structure id ("rail-cards" → "rail + cards"). */
export function structureLabelFromId(id: string): string {
  return (findDesignerStructure(id)?.label ?? String(id || '').replace(/-/g, ' ')).toLowerCase();
}

/**
 * The block the Designer's user message opens with. The boards carry
 * placeholders, and the header says so: the model borrows the craft, and every
 * word, price, photo and color on this board comes from THIS BOARD below.
 */
export function formatExemplarsForPrompt(exemplars: readonly DesignerExemplar[]): string {
  if (!exemplars.length) return '';
  const lines: string[] = [
    'REFERENCE BOARDS — approved boards from our own production library, made for these same screens. Match this craft: layout, type scale, spacing, structure. Every word, price and photo on them is a placeholder (VENUE NAME, Menu Item One, $0.00, empty photo frames) and their colors are only tokens — none of it goes on this board; its words, prices, photos and colors come from THIS BOARD below.',
  ];
  exemplars.forEach((e, i) => {
    lines.push(
      '',
      `Reference ${i + 1} — ${e.title}. ${e.width}×${e.height} ${e.orientation}, ${structureLabelFromId(e.structure)} layout${e.itemCount ? `, ${e.itemCount} item${e.itemCount === 1 ? '' : 's'}` : ''}.`,
      e.html,
    );
  });
  return lines.join('\n');
}
