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
 * Rules (pure, deterministic, unit-tested in designer-exemplars.spec.ts):
 *   - only boards tagged for the request's purpose;
 *   - never the target brand's own board (a Super Taco request must not be
 *     shown Super Taco's wall — the model would copy it);
 *   - the candidate's own structure first, then a different structure, so the
 *     three candidates of a batch are each anchored on a different layout;
 *   - the request's orientation, else the other one;
 *   - at most two per request (~3k tokens each).
 */
import { DESIGNER_EXEMPLARS } from './designer-exemplars.generated';
import { findDesignerStructure, type DesignerPurpose } from './designer-structures';

export type { DesignerPurpose };

export interface DesignerExemplar {
  id: string;
  title: string;
  /** The approved source board, relative to the repo root. */
  source: string;
  /** First 16 hex chars of the source file's SHA-256 at build time. */
  sourceSha256: string;
  /** Where the approval is recorded. */
  approval: string;
  /** The business the board was made for — never shown for that business. */
  brand: string;
  /** Lower-case strings that identify that business in a request. */
  brandTokens: string[];
  vertical: string;
  purposes: DesignerPurpose[];
  /** Layout family — matches a DesignerStructure id in designer-prompt.ts. */
  structure: string;
  orientation: 'landscape' | 'portrait';
  width: number;
  height: number;
  /** Menu/offer items the board shows (item.N groups). */
  itemCount: number;
  /** The injected runtimes the builder stripped (proof the markup is hand-written). */
  strippedRuntimes: string[];
  /** The board: CSS + markup only, no script. */
  html: string;
}

export { DESIGNER_EXEMPLARS };

/** Lower-case, alphanumerics only, single spaces — for brand matching. */
function norm(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Is this exemplar's business the one the request is for? Checks every brand
 * token against the request's own words (venue name, website reference, brief).
 * Both the spaced and the joined form match: "Super Taco" and supertacomex.com.
 */
export function exemplarIsTargetBrand(ex: Pick<DesignerExemplar, 'brandTokens'>, brandText: Array<string | null | undefined>): boolean {
  const hay = brandText.map(norm).filter(Boolean).join(' | ');
  if (!hay) return false;
  const joined = hay.replace(/ /g, '');
  return ex.brandTokens.some((t) => {
    const nt = norm(t);
    if (!nt) return false;
    return (` ${hay} `).includes(` ${nt} `) || joined.includes(nt.replace(/ /g, ''));
  });
}

export interface SelectDesignerExemplarsInput {
  purpose: DesignerPurpose;
  orientation: 'landscape' | 'portrait';
  /** How many items the board carries (menu rows / offers); 0 when unknown. */
  itemCount?: number;
  /** This candidate's structure — its matching reference goes first. */
  structureId?: string;
  /** The request's own words, for the never-the-target-brand rule. */
  brandText?: Array<string | null | undefined>;
  max?: number;
  /** Test seam: the pool to choose from (defaults to the compiled set). */
  pool?: readonly DesignerExemplar[];
}

/** Choose up to `max` (default 2) reference boards for one candidate. */
export function selectDesignerExemplars(input: SelectDesignerExemplarsInput): DesignerExemplar[] {
  const pool = input.pool ?? DESIGNER_EXEMPLARS;
  const max = Math.max(0, Math.min(input.max ?? 2, 3));
  const items = Math.max(0, input.itemCount ?? 0);
  const eligible = pool.filter(
    (e) => e.purposes.includes(input.purpose) && !exemplarIsTargetBrand(e, input.brandText ?? []),
  );
  if (!eligible.length || !max) return [];

  // One board per structure: the request's orientation if the structure has
  // it, else the other orientation — a portrait request still learns from a
  // landscape board rather than from nothing.
  const byStructure = new Map<string, DesignerExemplar>();
  for (const e of eligible) {
    const cur = byStructure.get(e.structure);
    if (!cur || (cur.orientation !== input.orientation && e.orientation === input.orientation)) {
      byStructure.set(e.structure, e);
    }
  }
  const one = [...byStructure.values()];

  // Primary: this candidate's own structure. Then the rest, preferring a board
  // whose purpose list LEADS with this purpose (a true menu board before an
  // offer board that also shows a menu item), then the closest item count, then
  // id for determinism.
  const lead = (e: DesignerExemplar) => (e.purposes[0] === input.purpose ? 0 : 1);
  one.sort(
    (a, b) =>
      Number(b.structure === input.structureId) - Number(a.structure === input.structureId) ||
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
 * The block the Designer's user message opens with. Each board is labelled
 * with whose it is, so the model borrows the craft and never the content.
 */
export function formatExemplarsForPrompt(exemplars: readonly DesignerExemplar[]): string {
  if (!exemplars.length) return '';
  const lines: string[] = [
    'REFERENCE BOARDS — approved boards from our own production library, made for these same screens. Match this craft. Their text, dishes, prices, colors and logo belong to the business named on each one; none of it goes on this board.',
  ];
  exemplars.forEach((e, i) => {
    lines.push(
      '',
      `Reference ${i + 1} — ${e.title} (${e.brand}). ${e.width}×${e.height} ${e.orientation}, ${structureLabelFromId(e.structure)} layout${e.itemCount ? `, ${e.itemCount} item${e.itemCount === 1 ? '' : 's'}` : ''}.`,
      e.html,
    );
  });
  return lines.join('\n');
}
