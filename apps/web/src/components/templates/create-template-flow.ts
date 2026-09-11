/**
 * create-template-flow — the pure decisions behind "New template".
 *
 * WHY THIS FILE EXISTS SEPARATELY: the rules below (what shape did the
 * operator ask for, which presets match it, what do we show when we don't
 * know the industry) are the part that can be wrong in a way nobody sees
 * until a demo. They are pure functions so they can be tested without
 * mounting a 5.9k-line page — and the component that consumes them is
 * mounted in its own test, because a green predicate test is not proof of
 * a wiring (CLAUDE.md rule #9).
 *
 * THE ONE QUESTION. Research across Canva / Yodeck / ScreenCloud /
 * OptiSigns / Rise Vision / Figma / Adobe Express / Google Slides / Wix
 * converges on a single up-front decision: CANVAS SHAPE. It is the only
 * one that cannot be deferred, because it filters everything after it.
 * Exact resolution is a refinement of that answer, not a separate
 * question — hence `DEFAULT_CANVAS` plus an "exact size" disclosure,
 * rather than a 16-tile grid as step one.
 */

export type CreateOrientation = 'LANDSCAPE' | 'PORTRAIT';

/**
 * What the operator has decided by the time we create anything. Carried
 * through every door (preset / blank / describe-it) so the answer to the
 * one question is never asked twice.
 */
export interface CreateDraft {
  name: string;
  description: string;
  category: string;
  width: number;
  height: number;
  orientation: CreateOrientation;
}

/**
 * Sensible default canvas per shape. These are byte-identical to the
 * first two entries of the existing RESOLUTION_PRESETS grid and to the
 * page's previous default state (3840×2160), so picking "Landscape" and
 * nothing else produces exactly the template the old modal produced.
 */
export const DEFAULT_CANVAS: Record<CreateOrientation, { w: number; h: number }> = {
  LANDSCAPE: { w: 3840, h: 2160 },
  PORTRAIT: { w: 2160, h: 3840 },
};

/** Square-ish means "works either way" — see matchesOrientation. */
const SQUARE_TOLERANCE = 0.08;

export function orientationOfSize(w: number, h: number): CreateOrientation {
  return h > w ? 'PORTRAIT' : 'LANDSCAPE';
}

/** The minimum a preset has to look like for this module to reason about it. */
export interface PresetLike {
  id: string;
  name: string;
  description?: string;
  category?: string;
  isSystem?: boolean;
  screenWidth: number;
  screenHeight: number;
  orientation?: string;
}

/**
 * A preset's real shape. Dimensions win over the `orientation` column:
 * the column is free text on some rows and the canvas is what actually
 * renders.
 */
export function presetOrientation(t: PresetLike): CreateOrientation {
  if (t.screenWidth > 0 && t.screenHeight > 0) return orientationOfSize(t.screenWidth, t.screenHeight);
  return (t.orientation || '').toUpperCase() === 'PORTRAIT' ? 'PORTRAIT' : 'LANDSCAPE';
}

/**
 * Does this preset belong in the gallery for the chosen shape? A
 * square-ish board (1:1 totem, 1080×1080 social panel) qualifies for
 * BOTH — it adapts either way, and excluding it would hand a portrait
 * operator a thinner gallery for no reason.
 */
export function matchesOrientation(t: PresetLike, want: CreateOrientation): boolean {
  const w = t.screenWidth || 0;
  const h = t.screenHeight || 0;
  if (w > 0 && h > 0 && Math.abs(w / h - 1) <= SQUARE_TOLERANCE) return true;
  return presetOrientation(t) === want;
}

/**
 * Interleave one item per category, round-robin, until everything is
 * placed. Used when we do NOT know the tenant's industry: it guarantees
 * the first screenful spans categories instead of leading with a dozen
 * boards from whichever one happens to sort first.
 */
function roundRobinByCategory<T extends PresetLike>(items: T[]): T[] {
  const buckets = new Map<string, T[]>();
  for (const t of items) {
    const key = (t.category || 'OTHER').toUpperCase();
    const b = buckets.get(key);
    if (b) b.push(t);
    else buckets.set(key, [t]);
  }
  const queues = [...buckets.values()];
  const out: T[] = [];
  let placed = true;
  for (let i = 0; placed; i++) {
    placed = false;
    for (const q of queues) {
      if (i < q.length) {
        out.push(q[i]);
        placed = true;
      }
    }
  }
  return out;
}

/** Stable sort by the tenant's own category order; unknown categories last. */
function orderByCategoryPreference<T extends PresetLike>(items: T[], order: readonly string[]): T[] {
  const rank = new Map<string, number>();
  order.forEach((k, i) => {
    if (k) rank.set(k.toUpperCase(), i);
  });
  return items
    .map((t, i) => ({ t, i, r: rank.get((t.category || '').toUpperCase()) ?? Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => (a.r - b.r) || (a.i - b.i))
    .map((x) => x.t);
}

export interface SelectCreatePresetsArgs<T extends PresetLike> {
  /** Everything the list endpoint returned (already vertical-filtered server-side). */
  templates: readonly T[];
  orientation: CreateOrientation;
  /**
   * Whether the tenant's industry is actually KNOWN (useTenantCopy's
   * `verticalKnown`), NOT the K12 value `normalizeVertical()` invents for
   * a missing one. An inferred vertical must never drive industry chrome
   * or industry ordering — a CORPORATE operator was shown school-grade
   * filters exactly this way (2026-09-11).
   */
  verticalKnown: boolean;
  /** The tenant's own category order, used ONLY when the vertical is known. */
  categoryOrder?: readonly string[];
  /** Optional free-text filter over name / description / category. */
  query?: string;
}

/**
 * The gallery an operator lands on after answering the one question.
 *
 * Vertical handling is the load-bearing part. The API already filters
 * system presets to the tenant's vertical, so this function never has to
 * manufacture relevance — but when the CLIENT cannot prove the industry
 * it must not pretend either: no industry-affinity ordering, just an
 * even cross-category spread. Never K-12 by default.
 */
export function selectCreatePresets<T extends PresetLike>(args: SelectCreatePresetsArgs<T>): T[] {
  const { templates, orientation, verticalKnown, categoryOrder, query } = args;
  const q = (query || '').trim().toLowerCase();
  const pool = (templates || []).filter((t) => {
    if (!t || t.isSystem !== true) return false;
    if (!matchesOrientation(t, orientation)) return false;
    if (!q) return true;
    const hay = `${t.name || ''} ${t.description || ''} ${t.category || ''}`.toLowerCase();
    return hay.includes(q);
  });
  return verticalKnown && categoryOrder && categoryOrder.length > 0
    ? orderByCategoryPreference(pool, categoryOrder)
    : roundRobinByCategory(pool);
}

/** "3840 × 2160" — one place, so the label never drifts between surfaces. */
export function canvasLabel(w: number, h: number): string {
  return `${w} × ${h}`;
}

/**
 * Does the operator's chosen canvas actually differ from what the preset
 * was authored at? Drives whether we resize the created copy at all — a
 * no-op resize is a pointless extra write on the create path.
 */
export function needsResize(preset: PresetLike, draft: Pick<CreateDraft, 'width' | 'height'>): boolean {
  return preset.screenWidth !== draft.width || preset.screenHeight !== draft.height;
}
