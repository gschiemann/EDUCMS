/**
 * designer-review.ts — how the AI Designer judges a RENDERED board, asks a
 * critic, and decides whether a revision earned its place (2026-09-23, Codex
 * finding 3: "never looks at its drafts").
 *
 *   objectiveReading   the renderer's measurements → one 0–100 score + the
 *                      defects they prove (blockers first). Deterministic.
 *   critique prompt    the same design model, shown the screenshot + the
 *                      measurements + what is already known, returns strict
 *                      JSON {verdict, score, defects}. Unparseable ⇒ pass:
 *                      a critic that cannot answer never blocks a board.
 *   reviseInstruction  ≤ 8 defects, blockers first, as the one instruction of
 *                      the existing surgical revise contract.
 *   keepRevision       the better-MEASURING board ships; a revision that scores
 *                      lower, adds a blocker, or could not be measured loses.
 *
 * Pure: no I/O, no Nest. AiService owns the calls; designer-review.spec.ts
 * pins every threshold against real renderer output.
 */
import { buildDesignerRevisePrompt, designerSizeFloor } from './designer-prompt';
import type { BoardDefect, DefectSeverity } from './designer-board-defects';
import type { RenderMetrics } from './renderer-contract';

export type ObjectiveDefectCode =
  | 'below-floor'
  | 'clipped-text'
  | 'overflow-text'
  | 'overlap'
  | 'broken-image'
  | 'blocked-image'
  | 'blurry-image'
  | 'font-fallback'
  | 'overcrowded'
  | 'fit-repairs'
  | 'empty-space';

export interface ReviewDefect extends BoardDefect {
  /** A data-field key, a selector, or a region — where the fix goes. */
  where?: string;
  /** The smallest change that fixes it. */
  fix?: string;
  /** Who found it. */
  source: 'measured' | 'static' | 'critic';
}

/** The numbers a person (or a query) reads to compare two renders. Bounded. */
export interface MetricsSummary {
  minFontPx: number | null;
  floorPx: number;
  belowFloor: number;
  largestPx: number | null;
  topTwoRatio: number | null;
  overflow: number;
  clipped: number;
  overlaps: number;
  images: number;
  brokenImages: number;
  blockedImages: number;
  blurryImages: number;
  fontFallbacks: number;
  textScaled: number;
  columnsScaled: number;
  decorationsGuarded: number;
  overcrowded: boolean;
  emptyRatio: number;
  largestVoidPct: number;
  contrastMin: number | null;
  belowAA: number;
  menuItems: number;
  menuItemsComplete: number;
  dataFields: number;
  imageSlots: number;
}

export interface ObjectiveReading {
  score: number;
  defects: ReviewDefect[];
  blockers: number;
  summary: MetricsSummary;
}

export interface ObjectiveContext {
  canvasWidth: number;
  canvasHeight: number;
  /** Trusted images the client could not inline — not the board's fault, never a defect. */
  skippedImageUrls?: readonly string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const where = (t: { field: string | null; selector: string }) => t.field || t.selector;
/** One flat void larger than this share of the canvas is dead space (the rubric's ~12 %). */
const VOID_SHARE = 0.12;

/** The renderer's blocked IMAGE requests that are the board's own doing. */
function blockedImages(m: RenderMetrics, skipped: readonly string[]): string[] {
  const ours = skipped.map((u) => u.slice(0, 200));
  return m.blockedRequests
    .filter((b) => b.reason === 'network' && b.type === 'image')
    .map((b) => b.url)
    .filter((u) => !ours.some((s) => s === u || s.startsWith(u) || u.startsWith(s)));
}

export function summarizeMetrics(m: RenderMetrics, ctx: ObjectiveContext): MetricsSummary {
  const floor = designerSizeFloor(ctx.canvasWidth, ctx.canvasHeight).caption;
  return {
    minFontPx: m.text.minFont ? round1(m.text.minFont.fontPx) : null,
    floorPx: floor,
    belowFloor: m.text.belowFloorCount,
    largestPx: m.text.largestPx,
    topTwoRatio: m.text.topTwoRatio,
    overflow: m.overflow.count,
    clipped: m.clipped.count,
    overlaps: m.overlaps.items.filter((o) => !o.identicalText).length,
    images: m.images.count,
    brokenImages: m.images.broken,
    blockedImages: blockedImages(m, ctx.skippedImageUrls ?? []).length,
    blurryImages: m.images.blurry,
    fontFallbacks: m.fontFallbacks.filter((f) => f.usedInText).length,
    textScaled: m.fitRepairs.textScaled.count,
    columnsScaled: m.fitRepairs.columns.count,
    decorationsGuarded: m.fitRepairs.decorations.count,
    overcrowded: m.fitRepairs.overcrowded,
    emptyRatio: m.emptySpace.ratio,
    largestVoidPct: m.emptySpace.largestVoidPct,
    contrastMin: m.contrast.min,
    belowAA: m.contrast.belowAA,
    menuItems: m.menu.items,
    menuItemsComplete: m.menu.itemsWithNameAndPrice,
    dataFields: m.counts.dataField,
    imageSlots: m.counts.dataImgslot,
  };
}

/**
 * THE OBJECTIVE SCORE — 100 minus what the measurements prove, clamped to 0–100.
 *
 *   legibility   ≤25  smallest readable text under the floor (designerSizeFloor):
 *                     10 + 30 × shortfall/floor (≤20), + 1 per other element
 *                     under it (≤5)
 *   clipping     ≤30  6 per clipped or spilling (overflow) readable text
 *   overlaps     ≤15  5 per overlapping pair of readable text (identical-text
 *                     pairs are deliberate layers — not counted)
 *   images       ≤20  8 per broken image, 6 per blocked image the board was
 *                     not given, 3 per blurry (upscaled > 1.3×) image
 *   fonts        ≤10  5 per font family that fell back in visible text
 *   fit repairs  ≤10  6 when a repair scaled anything below 0.9 (overcrowded),
 *                     + 1 per repair (≤4)
 *   empty space  ≤10  10 × (ratio − 0.35) / 0.35 when over the renderer's
 *                     target (≤6), + 4 when one void is over 12 % of the canvas
 *
 * Blockers (a revise is due whatever the critic says): clipped or spilling
 * readable text, and the smallest text under 75 % of the floor.
 */
export function objectiveReading(m: RenderMetrics, ctx: ObjectiveContext): ObjectiveReading {
  const s = summarizeMetrics(m, ctx);
  const defects: ReviewDefect[] = [];
  const add = (code: ObjectiveDefectCode, severity: DefectSeverity, detail: string, at?: string, fix?: string) =>
    defects.push({ code, severity, detail, source: 'measured', ...(at ? { where: at } : {}), ...(fix ? { fix } : {}) });
  let penalty = 0;

  // Legibility.
  const floor = s.floorPx;
  const min = m.text.minFont;
  if (min && min.fontPx < floor - 0.5) {
    const shortfall = (floor - min.fontPx) / floor;
    penalty += Math.min(20, 10 + 30 * shortfall) + Math.min(5, Math.max(0, m.text.belowFloorCount - 1));
    add(
      'below-floor',
      min.fontPx < floor * 0.75 ? 'blocker' : 'major',
      `smallest text is ${round1(min.fontPx)} px (floor ${floor} px)${m.text.belowFloorCount > 1 ? `; ${m.text.belowFloorCount} elements under the floor` : ''}`,
      where(min),
      `raise it to at least ${floor} px`,
    );
  }

  // Clipping and spill.
  const clipped = m.clipped.items.filter((c) => !c.decorative);
  const spilled = m.overflow.items.filter((o) => !o.decorative);
  penalty += Math.min(30, 6 * (clipped.length + spilled.length));
  for (const c of clipped.slice(0, 3)) {
    add('clipped-text', 'blocker', `"${c.text}" is cut off by ${c.clipSelector} (${Math.round(c.hiddenFraction * 100)}% hidden)`, where(c), 'let it wrap or give its box room; never hide text');
  }
  for (const o of spilled.slice(0, 3)) {
    add(
      'overflow-text',
      'blocker',
      `"${o.text}" runs ${round1(o.overflowPx)} px past ${o.kind === 'stage' ? 'the canvas edge' : `its box (${o.boxSelector || 'parent'})`} on the ${o.sides.join('/')}`,
      where(o),
      'keep it inside its band: let it wrap, or make its box larger',
    );
  }

  // Overlaps (deliberate layered duplicates excluded).
  const overlaps = m.overlaps.items.filter((o) => !o.identicalText);
  penalty += Math.min(15, 5 * overlaps.length);
  for (const o of overlaps.slice(0, 3)) {
    add('overlap', 'major', `"${o.a.text}" and "${o.b.text}" overlap by ${round1(o.overlapW)}×${round1(o.overlapH)} px`, `${where(o.a)} × ${where(o.b)}`, 'give each its own space in the layout');
  }

  // Images.
  const blocked = blockedImages(m, ctx.skippedImageUrls ?? []);
  penalty += Math.min(20, 8 * m.images.broken + 6 * blocked.length + 3 * m.images.blurry);
  for (const im of m.images.items.filter((i) => i.broken).slice(0, 2)) {
    add('broken-image', 'major', `image ${im.src} does not load`, im.slot || im.selector, 'use only the supplied logo/photo URLs, or a designed on-palette panel');
  }
  for (const url of blocked.slice(0, 2)) {
    add('blocked-image', 'major', `image ${url} was not supplied to this board`, undefined, 'use only the supplied logo/photo URLs, or a designed on-palette panel');
  }
  for (const im of m.images.items.filter((i) => i.blurry).slice(0, 2)) {
    add('blurry-image', 'minor', `image drawn ${im.upscale}× its real size — soft on screen`, im.slot || im.selector, 'show it smaller, or crop tighter');
  }

  // Fonts.
  const fallbacks = m.fontFallbacks.filter((f) => f.usedInText);
  penalty += Math.min(10, 5 * fallbacks.length);
  for (const f of fallbacks.slice(0, 2)) {
    add('font-fallback', 'major', `"${f.family}" did not load (${f.reason}) — the screen draws a fallback`, undefined, 'use only the listed fonts, loaded by the <link>');
  }

  // Fit-engine repairs.
  const repairs = m.fitRepairs.textScaled.count + m.fitRepairs.columns.count + m.fitRepairs.dataFit.count + m.fitRepairs.decorations.count;
  penalty += (m.fitRepairs.overcrowded ? 6 : 0) + Math.min(4, repairs);
  if (m.fitRepairs.overcrowded) {
    add('overcrowded', 'major', `the fit engine had to shrink content below 90% to make it fit (${repairs} repair${repairs === 1 ? '' : 's'})`, undefined, 'give the crowded region more room or less copy');
  } else if (repairs > 0) {
    add('fit-repairs', 'minor', `the fit engine adjusted ${repairs} element${repairs === 1 ? '' : 's'}`);
  }

  // Empty space. (`largestVoidPct` is a SHARE, 0–1, despite its name — the
  // renderer's own suite asserts `> 0.12`.)
  const es = m.emptySpace;
  if (es.overTarget) penalty += Math.min(6, (10 * (es.ratio - es.target)) / es.target);
  if (es.largestVoidPct > VOID_SHARE) penalty += 4;
  if (es.overTarget || es.largestVoidPct > VOID_SHARE) {
    add(
      'empty-space',
      es.ratio > 0.5 || es.largestVoidPct > 0.2 ? 'major' : 'minor',
      `${Math.round(es.ratio * 100)}% of the canvas is flat and empty; the largest void is ${Math.round(es.largestVoidPct * 100)}% of it`,
      undefined,
      'fill the empty region with content, a brand field or a framed photo',
    );
  }

  const rank: Record<DefectSeverity, number> = { blocker: 0, major: 1, minor: 2 };
  defects.sort((a, b) => rank[a.severity] - rank[b.severity]);
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  return { score, defects, blockers: defects.filter((d) => d.severity === 'blocker').length, summary: s };
}

// ─────────────────────────────────────────────────────────────────────────
// The critic
// ─────────────────────────────────────────────────────────────────────────

/** Output budget for the critique (visible tokens; reasoning headroom is added by the dispatcher). */
export const CRITIQUE_MAX_TOKENS = 600;
/** The critique call's own ceiling. */
export const CRITIQUE_TIMEOUT_MS = 90_000;
/** Defects handed to the reviser. */
export const MAX_REVISE_DEFECTS = 8;

/**
 * The critic's instructions — the rubric is distilled from
 * docs/design/FLAGSHIP-TEMPLATE-STANDARDS.md and the Designer system prompt's
 * contract (legibility, one hierarchy, real items once, brand as fields, a
 * finished photo panel, nothing clipped, everything editable).
 */
export const DESIGNER_CRITIQUE_SYSTEM_PROMPT = [
  'You review ONE rendered digital-signage board: the screenshot attached, plus the renderer\'s measurements. It hangs on a 43–98 inch screen and is read from about 15 feet away in a few seconds.',
  '',
  'RUBRIC',
  '- Legible from 15 ft: nothing under the size floor; item names and prices well above it; the headline or venue name far larger.',
  '- One clear hierarchy: one focal point, then the items, then the details; no two roles at the same size.',
  '- Real items, once: every supplied item shows exactly once with its name and price as supplied; no placeholder or filler text.',
  '- Brand as fields: the brand palette carries whole regions (a header, rail or footer band), not just thin accents; the logo sits in the header.',
  '- A finished photo panel: a photo slot shows the photo or a designed on-palette panel — never an empty box or a stretched, blurry image.',
  '- Nothing clipped, overlapping or spilling out of its band, its card or the canvas; no dead, empty regions.',
  '- Editable: every word carries data-field and every image data-imgslot.',
  '',
  'Return ONLY this JSON (no markdown fences, no commentary):',
  '{"verdict":"pass"|"revise","score":0-100,"defects":[{"severity":"blocker"|"major"|"minor","where":"<data-field key or region>","what":"<what is wrong>","fix":"<the smallest change that fixes it>"}]}',
  '- "pass" when nothing is worse than minor. At most 8 defects, blockers first.',
  '- Every fix is a surgical change to THIS board — never a redesign, never a new layout.',
  '- Judge only what the screenshot shows or the measurements prove. Never invent an item, a price or a fact.',
].join('\n');

export function buildCritiqueUserPrompt(opts: {
  width: number;
  height: number;
  summary: MetricsSummary;
  imageWidth?: number;
  imageHeight?: number;
  known: readonly ReviewDefect[];
  skippedImages?: ReadonlyArray<{ url: string }>;
  purpose?: string;
  layout?: string;
}): string {
  const orient = opts.height > opts.width ? 'portrait' : 'landscape';
  const lines: string[] = [
    `Board: ${opts.purpose ? `${opts.purpose} board` : 'signage board'}${opts.layout ? ` · layout "${opts.layout}"` : ''} · canvas ${opts.width} × ${opts.height} px (${orient}) · size floor ${opts.summary.floorPx} px.`,
  ];
  if (opts.imageWidth && opts.imageHeight) {
    lines.push(`The attached screenshot is the whole board at ${opts.imageWidth} × ${opts.imageHeight} px; the measurements below are in canvas px.`);
  }
  lines.push('', `MEASUREMENTS: ${JSON.stringify(opts.summary)}`);
  if (opts.known.length) {
    lines.push('', 'ALREADY FOUND (confirm or drop each; add what the screenshot shows):');
    for (const d of opts.known.slice(0, MAX_REVISE_DEFECTS)) lines.push(`- [${d.severity}] ${d.where ? `${d.where}: ` : ''}${d.detail}`);
  }
  if (opts.skippedImages?.length) {
    lines.push('', 'NOT DRAWN IN THIS PREVIEW (they load on a real screen — do not report them as missing):');
    for (const s of opts.skippedImages.slice(0, 6)) lines.push(`- ${s.url.slice(0, 160)}`);
  }
  lines.push('', 'Return only the JSON.');
  return lines.join('\n');
}

export interface Critique {
  verdict: 'pass' | 'revise';
  score: number | null;
  defects: ReviewDefect[];
  /** False when the reply could not be read — it is then a pass. */
  parsed: boolean;
}

const SEVERITIES = new Set<DefectSeverity>(['blocker', 'major', 'minor']);
const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** The critic's reply → a Critique. Fenced, unfenced or wrapped in prose; anything unreadable is a pass. */
export function parseCritique(raw: unknown): Critique {
  const pass: Critique = { verdict: 'pass', score: null, defects: [], parsed: false };
  if (typeof raw !== 'string') return pass;
  const text = raw.replace(/```(?:json)?/gi, '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return pass;
  let obj: any;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return pass;
  }
  if (!obj || typeof obj !== 'object') return pass;
  const verdict = obj.verdict === 'revise' ? 'revise' : obj.verdict === 'pass' ? 'pass' : null;
  if (!verdict) return pass;
  const n = Number(obj.score);
  const score = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
  const defects: ReviewDefect[] = (Array.isArray(obj.defects) ? obj.defects : [])
    .filter((d: any) => d && typeof d === 'object' && clip(d.what, 200))
    .map((d: any): ReviewDefect => {
      const severity: DefectSeverity = SEVERITIES.has(d.severity) ? d.severity : 'major';
      const at = clip(d.where, 120);
      const fix = clip(d.fix, 200);
      return { code: 'critic', severity, detail: clip(d.what, 200), source: 'critic', ...(at ? { where: at } : {}), ...(fix ? { fix } : {}) };
    });
  const rank: Record<DefectSeverity, number> = { blocker: 0, major: 1, minor: 2 };
  defects.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { verdict, score, defects: defects.slice(0, MAX_REVISE_DEFECTS), parsed: true };
}

/** What the reviser is asked to fix: ≤ 8, blockers first, measured before critic before static. */
export function defectsForRevision(lists: ReadonlyArray<readonly ReviewDefect[]>): ReviewDefect[] {
  const all = lists.flat().filter((d) => d.severity !== 'minor');
  const seen = new Set<string>();
  const out: ReviewDefect[] = [];
  const rank: Record<DefectSeverity, number> = { blocker: 0, major: 1, minor: 2 };
  for (const d of [...all].sort((a, b) => rank[a.severity] - rank[b.severity])) {
    const key = `${d.where || ''}|${d.detail}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
    if (out.length >= MAX_REVISE_DEFECTS) break;
  }
  return out;
}

/**
 * The review's revise message: the batch's shared prefix (reference boards,
 * brief, canvas, venue — byte-identical to every draw, so it is served from the
 * vendor's prompt cache) and then the existing surgical revise contract.
 */
export function buildReviewRevisePrompt(sharedPrefix: string, revise: Parameters<typeof buildDesignerRevisePrompt>[0]): string {
  const body = buildDesignerRevisePrompt(revise);
  return sharedPrefix ? `${sharedPrefix}\n\n${body}` : body;
}

/** The one instruction the surgical revise contract (buildDesignerRevisePrompt) carries. */
export function reviseInstruction(defects: readonly ReviewDefect[]): string {
  const lines = [
    'Design review of the rendered board (its screenshot is attached) found these defects. Fix exactly these and change nothing else:',
  ];
  defects.forEach((d, i) => {
    lines.push(`${i + 1}. [${d.severity}] ${d.where ? `${d.where}: ` : ''}${d.detail}${d.fix ? ` — fix: ${d.fix}` : ''}`);
  });
  return lines.join('\n');
}

/**
 * KEEP THE BETTER-MEASURING BOARD. The revision ships only when it was
 * measured, added no blocker, and scores higher — or the same, when the critic
 * asked for the change (its point may be one the numbers cannot see).
 */
export function keepRevision(
  before: { score: number; blockers: number },
  after: { score: number; blockers: number } | null,
  criticAskedToRevise: boolean,
): boolean {
  if (!after) return false;
  if (after.blockers > before.blockers) return false;
  if (after.score > before.score) return true;
  return after.score === before.score && criticAskedToRevise;
}
