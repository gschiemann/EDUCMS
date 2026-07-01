// template-relevance.ts — shared "is this template relevant to what the
// operator is picking for right now" predicate.
//
// Operator complaint (2026-07-01, verbatim): "the drop down list of
// templates to choose from is stupid and includes our touch menu's....we
// should only show options that really work for the sport and for the
// screen we are selecting it for, not just the entire template list."
//
// Every template-picking dropdown in the app (touch-action "Go to
// template", the New Game Scoreboard/Ribbon/Scorebug pickers, the
// PlaylistCreateWizard "From Template" step) was rendering the FULL,
// unfiltered `useTemplates()` result — every vertical, every category,
// touch kiosks mixed in with passive display boards. This module centralizes
// the filtering logic so every picker applies the same rules, and so a
// future picker can opt in with one import instead of re-deriving the
// heuristic.
//
// IMPORTANT — `GET /templates` (the endpoint `useTemplates()` calls) does
// NOT return `Template.isTouchEnabled` (see apps/api/src/templates/
// templates.controller.ts "Payload trim" comment — it's deliberately
// excluded from the list payload as a builder-only field to keep the
// gallery response small). So touch detection here can NOT read
// `t.isTouchEnabled` — it will always be `undefined` on data from
// `useTemplates()`. Instead we use `category === 'KIOSK'`, which IS in the
// trimmed payload and is the same signal the /templates gallery already
// uses to gate touch kiosks to their own tab (see CATEGORY_TABS /
// `t.category === 'KIOSK'` in app/[schoolId]/templates/page.tsx).
// TODO(lead): confirm KIOSK-category is a complete proxy for "touch" — a
// custom (non-system) tenant template built with isTouchEnabled=true but
// left on a non-KIOSK category (e.g. a touch-enabled LOBBY board) would
// slip through this heuristic undetected on the client. The authoritative
// per-template isTouchEnabled flag exists in the DB and on GET
// /templates/:id — if this turns out to matter, the cheapest fix is
// adding `isTouchEnabled` back to the list SELECT (small boolean column,
// unlikely to meaningfully change the payload-trim math) rather than
// guessing harder client-side.
//
// Sports category tagging mirrors the existing, already-shipped filter in
// app/[schoolId]/sports/[gameId]/page.tsx `aspectMatches` (2026-06-16 fix,
// "the operator saw Touch Kiosk — Veterinary Check-In in the scoreboard
// dropdown"). That fix was never applied to the sibling "New Game" wizard
// at app/[schoolId]/sports/page.tsx — this module extracts it so both
// surfaces (and any future one) share the same rule.

/** Minimal shape every picker needs — matches the trimmed GET /templates payload. */
export interface RelevanceTemplate {
  id: string;
  name?: string;
  category?: string | null;
  vertical?: string | null;
  orientation?: string | null;
  screenWidth?: number | null;
  screenHeight?: number | null;
  isSystem?: boolean;
  /** Only present on the single-template GET /templates/:id payload —
   *  absent (undefined) on the trimmed list payload. Read opportunistically:
   *  if a future list-payload change starts including it, this predicate
   *  picks it up for free instead of relying solely on the category proxy. */
  isTouchEnabled?: boolean;
}

/** Category values that mean "this is a touch/interactive kiosk experience,
 *  not a passive display board." Kept as a Set so a second touch-ish
 *  category can be added without touching call sites. */
const TOUCH_CATEGORIES = new Set(['KIOSK']);

/** True if the template is a touch/interactive kiosk experience rather than
 *  a passive display board. See file header for why this can't just read
 *  `isTouchEnabled` off the list payload. */
export function isTouchTemplate(t: RelevanceTemplate): boolean {
  if (typeof t.isTouchEnabled === 'boolean') return t.isTouchEnabled;
  return TOUCH_CATEGORIES.has((t.category || '').toUpperCase());
}

/** Sports-board categories — mirrors `SCOREBOARD_CATS` in
 *  app/[schoolId]/sports/[gameId]/page.tsx (2026-06-16). A template tagged
 *  with one of these is a sports scoreboard-family layout, not a generic
 *  vertical board that happens to be landscape. */
export const SPORTS_BOARD_CATEGORIES = new Set(['SCOREBOARD', 'SPORTS', 'GAMEDAY', 'ATHLETICS', 'EVENTS']);

export type SportsSurface = 'scoreboard' | 'ribbon' | 'scorebug';

/** True if the template's category matches the given sports surface.
 *  Identical rule to `aspectMatches` in sports/[gameId]/page.tsx — kept
 *  here too so the "New Game" wizard (sports/page.tsx) and the in-game
 *  Layouts panel apply the exact same filter instead of drifting apart. */
export function matchesSportsSurface(t: RelevanceTemplate, surface: SportsSurface): boolean {
  const cat = (t.category || '').toUpperCase();
  if (surface === 'ribbon') return cat === 'RIBBON';
  if (surface === 'scorebug') return cat === 'SCOREBUG' || cat === 'SPONSOR';
  return SPORTS_BOARD_CATEGORIES.has(cat);
}

/** Orientation of a target screen/canvas, derived from its pixel size.
 *  Square-ish canvases (w === h) count as landscape — there's no third
 *  bucket in Template.orientation. */
export function orientationFromSize(w?: number | null, h?: number | null): 'LANDSCAPE' | 'PORTRAIT' | null {
  if (!w || !h) return null;
  return h > w ? 'PORTRAIT' : 'LANDSCAPE';
}

export interface RelevanceContext {
  /** Set when the target is (or will be) a touch/interactive surface — a
   *  kiosk template's "Go to template" action, a touch-enabled screen,
   *  etc. `false` = the target is a passive display and touch kiosks
   *  should be excluded. `undefined` = unknown, don't filter on touch. */
  wantsTouch?: boolean;
  /** Restrict to templates tagged for this vertical (plus UNIVERSAL /
   *  untagged, which always match). `undefined` = don't filter by vertical
   *  — e.g. the touch-action "Go to template" picker already gets a
   *  vertical-scoped list from the API, so re-filtering client-side would
   *  be redundant, not wrong, but skippable. */
  vertical?: string | null;
  /** Restrict to one sports surface's category family (scoreboard / ribbon
   *  / scorebug). `undefined` = not a sports-surface picker. */
  sportsSurface?: SportsSurface;
  /** Restrict to the given orientation (LANDSCAPE/PORTRAIT), matched
   *  against `Template.orientation` when present, else derived from
   *  `screenWidth`/`screenHeight`. `undefined` = don't filter. */
  orientation?: 'LANDSCAPE' | 'PORTRAIT' | null;
  /** Exclude this template id — the usual "don't let a template link to
   *  itself" guard. */
  excludeId?: string | null;
}

/**
 * The single relevance predicate every picker should filter through.
 * Returns true when `t` should be OFFERED given the current picking
 * context. Filters are independent — pass only the ones that apply to
 * your surface (e.g. a non-sports picker should never set
 * `sportsSurface`, so sports categories aren't touched for it).
 */
export function isTemplateRelevant(t: RelevanceTemplate, ctx: RelevanceContext): boolean {
  if (ctx.excludeId && t.id === ctx.excludeId) return false;

  if (ctx.wantsTouch === true && !isTouchTemplate(t)) return false;
  if (ctx.wantsTouch === false && isTouchTemplate(t)) return false;

  if (ctx.sportsSurface && !matchesSportsSurface(t, ctx.sportsSurface)) return false;

  if (ctx.vertical) {
    const tv = (t.vertical || '').toUpperCase();
    const want = ctx.vertical.toUpperCase();
    // Untagged / UNIVERSAL templates are cross-vertical by convention
    // (mirrors Template.vertical defaulting to K12 only for legacy rows —
    // an explicit 'UNIVERSAL' tag, where used, always passes). Support the
    // pipe-delimited dual-tag convention used elsewhere (verticalMatchOr on
    // the API side, e.g. "QSR|RESTAURANT") so a template built for two
    // verticals matches either.
    if (tv && tv !== 'UNIVERSAL' && !tv.split('|').includes(want)) return false;
  }

  if (ctx.orientation) {
    const to = (t.orientation || '').toUpperCase();
    const resolved = to === 'LANDSCAPE' || to === 'PORTRAIT'
      ? to
      : orientationFromSize(t.screenWidth, t.screenHeight);
    if (resolved && resolved !== ctx.orientation) return false;
  }

  return true;
}

/** Convenience wrapper — filters a list, and if the filtered result would
 *  be EMPTY (an overly-strict combination hiding everything), falls back
 *  to the unfiltered list so the operator is never left with a dead
 *  dropdown. Callers that want a "Show all templates" escape hatch should
 *  still offer one explicitly (see PropertiesPanel / sports pickers) —
 *  this fallback only covers the "filter matched nothing" edge case, not
 *  the "operator wants to override" case. */
export function filterRelevantTemplates<T extends RelevanceTemplate>(
  list: T[],
  ctx: RelevanceContext,
): T[] {
  const filtered = list.filter((t) => isTemplateRelevant(t, ctx));
  if (filtered.length === 0 && list.length > 0) return list;
  return filtered;
}
