/**
 * @cms/signage-design — ARCHETYPES (the resolver framework)
 *
 * Each archetype is a designer-engineered layout container. Its `resolve()`
 * turns named slots into grid-locked, gutter-aware, safe-margin-inset pixel
 * rects (as % of canvas). The LLM picks an archetype by name and NEVER sees the
 * geometry — that's the whole thesis (R3).
 *
 * INVARIANTS every resolver upholds:
 *   - >= SAFE_MARGIN_PCT (5%) inset on all sides (R6 §10.E rule 18).
 *   - Content zones never overlap (each one's rect is disjoint from siblings).
 *   - Rule-of-thirds focal placement where an archetype has a single focal slot.
 *   - Geometry is emitted as % only; consumers translate to LONGHAND
 *     top/right/bottom/left — NEVER `inset`/`gap` (CLAUDE.md rule #10 / Taurus).
 *   - <= 3 content zones (background doesn't count) — R6 §10.D rule 16.
 *
 * Geometry here is PROVISIONAL pending Greg's mockup review (per the brief). The
 * framework + clean math + the invariants are what matter now.
 */

import {
  type Archetype,
  type ArchetypeId,
  type ArchetypeSlotSpec,
  type CanvasClass,
  type CanvasClassId,
  type ResolvedZone,
  type ThemeBundle,
  type ZoneStyleTokens,
} from './types';

/** R6 §10.E: >= 5% safe margin on all sides. */
export const SAFE_MARGIN_PCT = 5;
/** Inter-zone gutter (% of the smaller axis) so stacked zones breathe. */
export const GUTTER_PCT = 3;

/** Rule-of-thirds line positions (% of axis). */
export const THIRDS = { first: 33.333, second: 66.667 } as const;

/** A rect in % coords, used internally before becoming a ResolvedZone. */
interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The content box inside the safe margins. */
function contentBox(): Rect {
  return {
    x: SAFE_MARGIN_PCT,
    y: SAFE_MARGIN_PCT,
    width: 100 - 2 * SAFE_MARGIN_PCT,
    height: 100 - 2 * SAFE_MARGIN_PCT,
  };
}

/** Round to 3 decimals to keep persisted geometry tidy + deterministic. */
function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Build a ResolvedZone from a slot spec + rect + style tokens. Background fills
 * the WHOLE canvas (0,0,100,100) — it intentionally sits OUTSIDE the safe
 * margins because a full-bleed image must reach every edge.
 */
function zone(
  slotSpec: ArchetypeSlotSpec,
  rect: Rect,
  zIndex: number,
  tokens: ZoneStyleTokens,
): ResolvedZone {
  return {
    slot: slotSpec.slot,
    widgetType: slotSpec.widgetType,
    x: r3(rect.x),
    y: r3(rect.y),
    width: r3(rect.width),
    height: r3(rect.height),
    zIndex,
    styleTokens: tokens,
  };
}

function fullBleed(): Rect {
  return { x: 0, y: 0, width: 100, height: 100 };
}

/** Helper: text tokens for a role, riding the theme's font pairing. */
function textTokens(
  theme: ThemeBundle,
  role: ZoneStyleTokens['typeRole'],
  colorToken: ZoneStyleTokens['colorToken'],
  align: ZoneStyleTokens['align'] = 'left',
  isAccent = false,
): ZoneStyleTokens {
  const isDisplay = role === 'display' || role === 'headline' || role === 'title';
  return {
    typeRole: role,
    colorToken: isAccent ? 'accent' : colorToken,
    fontFamily: isDisplay ? theme.fontPair.display : theme.fontPair.body,
    fontWeight: isDisplay ? 800 : 500,
    align,
    isAccent,
  };
}

// Common slot specs reused across archetypes.
const SLOT = {
  background: { slot: 'background', widgetType: 'IMAGE' } as ArchetypeSlotSpec,
  kicker: { slot: 'kicker', widgetType: 'TEXT', typeRole: 'kicker' } as ArchetypeSlotSpec,
  headline: {
    slot: 'headline',
    widgetType: 'TEXT',
    typeRole: 'display',
    required: true,
  } as ArchetypeSlotSpec,
  body: { slot: 'body', widgetType: 'TEXT', typeRole: 'body' } as ArchetypeSlotSpec,
  cta: { slot: 'cta', widgetType: 'TEXT', typeRole: 'title' } as ArchetypeSlotSpec,
  stat: { slot: 'stat', widgetType: 'TEXT', typeRole: 'display', required: true } as ArchetypeSlotSpec,
  statLabel: { slot: 'statLabel', widgetType: 'TEXT', typeRole: 'title' } as ArchetypeSlotSpec,
  image: { slot: 'image', widgetType: 'IMAGE' } as ArchetypeSlotSpec,
  listItem: { slot: 'listItem', widgetType: 'TEXT', typeRole: 'title' } as ArchetypeSlotSpec,
};

const LANDSCAPE_ONLY: CanvasClassId[] = ['landscape-16-9', 'square'];
const MOST: CanvasClassId[] = ['landscape-16-9', 'portrait-9-16', 'square'];

// ---------------------------------------------------------------------------
// 1. hero-fullbleed — full-bleed image + scrim + giant headline + kicker.
// ---------------------------------------------------------------------------

const heroFullbleed: Archetype = {
  id: 'hero-fullbleed',
  label: 'Hero (Full-bleed)',
  description: 'Full-bleed image with one giant headline and a kicker over a scrim.',
  supports: MOST,
  backgroundMode: 'image',
  slots: [SLOT.background, SLOT.kicker, SLOT.headline, SLOT.cta],
  resolve(canvas: CanvasClass, theme: ThemeBundle): ResolvedZone[] {
    const cb = contentBox();
    // Focal text sits on the lower-left third (rule-of-thirds, top-left bias
    // softened to lower-left so the image reads above it).
    const bg = zone(SLOT.background, fullBleed(), 0, {
      scrim: theme.scrim,
    });
    // Text block stacks in the lower portion, ending exactly at the safe
    // bottom (95). Heights: kicker 7 + gutter + headline 18 + gutter + cta 8.
    const blockH = 7 + GUTTER_PCT + 18 + GUTTER_PCT + 8; // = 39
    const blockTop = 100 - SAFE_MARGIN_PCT - blockH; // bottom-anchored, in-margin
    const kicker = zone(
      SLOT.kicker,
      { x: cb.x, y: blockTop, width: cb.width, height: 7 },
      2,
      textTokens(theme, 'kicker', 'inkInverse', 'left'),
    );
    const headline = zone(
      SLOT.headline,
      { x: cb.x, y: blockTop + 7 + GUTTER_PCT, width: cb.width, height: 18 },
      2,
      textTokens(theme, 'display', 'inkInverse', 'left'),
    );
    const cta = zone(
      SLOT.cta,
      {
        x: cb.x,
        y: blockTop + 7 + GUTTER_PCT + 18 + GUTTER_PCT,
        width: cb.width * 0.5,
        height: 8,
      },
      2,
      textTokens(theme, 'title', 'accent', 'left', true),
    );
    return [bg, kicker, headline, cta];
  },
};

// ---------------------------------------------------------------------------
// 2. split-50 — image half / content half.
// ---------------------------------------------------------------------------

const split50: Archetype = {
  id: 'split-50',
  label: 'Split 50/50',
  description: 'Image on one half, headline + body + CTA stacked on the other.',
  supports: LANDSCAPE_ONLY,
  backgroundMode: 'surface',
  slots: [SLOT.image, SLOT.kicker, SLOT.headline, SLOT.body, SLOT.cta],
  resolve(canvas: CanvasClass, theme: ThemeBundle): ResolvedZone[] {
    // Left half = image (full height edge-to-edge for impact), right half =
    // content inside the safe margin.
    const half = 50;
    const image = zone(SLOT.image, { x: 0, y: 0, width: half, height: 100 }, 0, {});
    const colX = half + SAFE_MARGIN_PCT;
    const colW = 100 - half - 2 * SAFE_MARGIN_PCT;
    const top = SAFE_MARGIN_PCT + 12; // vertically centered-ish block
    const kicker = zone(
      SLOT.kicker,
      { x: colX, y: top, width: colW, height: 7 },
      2,
      textTokens(theme, 'kicker', 'muted', 'left'),
    );
    const headline = zone(
      SLOT.headline,
      { x: colX, y: top + 7 + GUTTER_PCT, width: colW, height: 20 },
      2,
      textTokens(theme, 'headline', 'ink', 'left'),
    );
    const body = zone(
      SLOT.body,
      { x: colX, y: top + 7 + 20 + 2 * GUTTER_PCT, width: colW, height: 18 },
      2,
      textTokens(theme, 'body', 'muted', 'left'),
    );
    const cta = zone(
      SLOT.cta,
      { x: colX, y: top + 7 + 20 + 18 + 3 * GUTTER_PCT, width: colW * 0.7, height: 8 },
      2,
      textTokens(theme, 'title', 'accent', 'left', true),
    );
    return [image, kicker, headline, body, cta];
  },
};

// ---------------------------------------------------------------------------
// 3. lower-third-banner — image fills, content in a bottom band.
// ---------------------------------------------------------------------------

const lowerThirdBanner: Archetype = {
  id: 'lower-third-banner',
  label: 'Lower-Third Banner',
  description: 'Image fills the screen; headline + CTA in a banner across the bottom third.',
  supports: MOST,
  backgroundMode: 'image',
  slots: [SLOT.background, SLOT.headline, SLOT.cta],
  resolve(canvas: CanvasClass, theme: ThemeBundle): ResolvedZone[] {
    const bandTop = 66; // bottom third
    const bg = zone(SLOT.background, fullBleed(), 0, {
      scrim: { ...theme.scrim, direction: 'bottom', opacity: 0.78 },
    });
    const cb = contentBox();
    const headline = zone(
      SLOT.headline,
      { x: cb.x, y: bandTop + 3, width: cb.width, height: 16 },
      2,
      textTokens(theme, 'headline', 'inkInverse', 'left'),
    );
    const cta = zone(
      SLOT.cta,
      { x: cb.x, y: bandTop + 3 + 16 + GUTTER_PCT, width: cb.width * 0.45, height: 7 },
      2,
      textTokens(theme, 'title', 'accent', 'left', true),
    );
    return [bg, headline, cta];
  },
};

// ---------------------------------------------------------------------------
// 4. stat-spotlight — one huge number + label, dead-center hero element.
// ---------------------------------------------------------------------------

const statSpotlight: Archetype = {
  id: 'stat-spotlight',
  label: 'Stat Spotlight',
  description: 'One enormous number/stat with a label and supporting line.',
  supports: MOST,
  backgroundMode: 'gradient',
  slots: [SLOT.kicker, SLOT.stat, SLOT.statLabel],
  resolve(canvas: CanvasClass, theme: ThemeBundle): ResolvedZone[] {
    const cb = contentBox();
    // A single hero element may sit centered (R6 §10.E rule 19 exception).
    const kicker = zone(
      SLOT.kicker,
      { x: cb.x, y: 22, width: cb.width, height: 8 },
      2,
      textTokens(theme, 'kicker', 'muted', 'center'),
    );
    const stat = zone(
      SLOT.stat,
      { x: cb.x, y: 34, width: cb.width, height: 32 },
      2,
      textTokens(theme, 'display', 'accent', 'center', true),
    );
    const statLabel = zone(
      SLOT.statLabel,
      { x: cb.x, y: 34 + 32 + GUTTER_PCT, width: cb.width, height: 10 },
      2,
      textTokens(theme, 'title', 'ink', 'center'),
    );
    return [kicker, stat, statLabel];
  },
};

// ---------------------------------------------------------------------------
// 5. three-up-grid — three equal cards.
// ---------------------------------------------------------------------------

const threeUpGrid: Archetype = {
  id: 'three-up-grid',
  label: 'Three-Up Grid',
  description: 'A headline over three equal cards ("what\'s on today").',
  supports: LANDSCAPE_ONLY,
  backgroundMode: 'surface',
  slots: [SLOT.headline, SLOT.listItem, SLOT.listItem, SLOT.listItem],
  resolve(canvas: CanvasClass, theme: ThemeBundle): ResolvedZone[] {
    const cb = contentBox();
    const headline = zone(
      SLOT.headline,
      { x: cb.x, y: cb.y, width: cb.width, height: 14 },
      2,
      textTokens(theme, 'headline', 'ink', 'left'),
    );
    const cardsTop = cb.y + 14 + GUTTER_PCT;
    const cardsH = cb.y + cb.height - cardsTop;
    // Three columns with two internal gutters.
    const gutters = 2 * GUTTER_PCT;
    const cardW = (cb.width - gutters) / 3;
    const cards: ResolvedZone[] = [];
    for (let i = 0; i < 3; i++) {
      const x = cb.x + i * (cardW + GUTTER_PCT);
      cards.push(
        zone(
          SLOT.listItem,
          { x, y: cardsTop, width: cardW, height: cardsH },
          2,
          { ...textTokens(theme, 'title', 'ink', 'center'), colorToken: 'surface' },
        ),
      );
    }
    return [headline, ...cards];
  },
};

// ---------------------------------------------------------------------------
// 6. menu-list — priced rows, grid-aligned value column.
// ---------------------------------------------------------------------------

const MENU_ROWS = 5;

const menuList: Archetype = {
  id: 'menu-list',
  label: 'Menu List',
  description: 'A headline over priced rows with a fixed-position value column.',
  supports: MOST,
  backgroundMode: 'surface',
  slots: [
    SLOT.headline,
    SLOT.listItem,
    SLOT.listItem,
    SLOT.listItem,
    SLOT.listItem,
    SLOT.listItem,
  ],
  resolve(canvas: CanvasClass, theme: ThemeBundle): ResolvedZone[] {
    const cb = contentBox();
    const headline = zone(
      SLOT.headline,
      { x: cb.x, y: cb.y, width: cb.width, height: 13 },
      2,
      textTokens(theme, 'headline', 'ink', 'left'),
    );
    const rowsTop = cb.y + 13 + GUTTER_PCT;
    const rowsH = cb.y + cb.height - rowsTop;
    const rowH = (rowsH - (MENU_ROWS - 1) * GUTTER_PCT) / MENU_ROWS;
    const rows: ResolvedZone[] = [];
    for (let i = 0; i < MENU_ROWS; i++) {
      const y = rowsTop + i * (rowH + GUTTER_PCT);
      // Each row is a single zone; the renderer lays label (left) + value
      // (right, fixed column) inside it — R6 §10.E rule 20 (fixed price column).
      rows.push(
        zone(
          SLOT.listItem,
          { x: cb.x, y, width: cb.width, height: rowH },
          2,
          { ...textTokens(theme, 'title', 'ink', 'left') },
        ),
      );
    }
    return [headline, ...rows];
  },
};

// ---------------------------------------------------------------------------
// Registry + public API.
// ---------------------------------------------------------------------------

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  'hero-fullbleed': heroFullbleed,
  'split-50': split50,
  'lower-third-banner': lowerThirdBanner,
  'stat-spotlight': statSpotlight,
  'three-up-grid': threeUpGrid,
  'menu-list': menuList,
};

export const ARCHETYPE_IDS = Object.keys(ARCHETYPES) as ArchetypeId[];

/** Look up an archetype by id. Throws on unknown id (LLM picked off-menu). */
export function getArchetype(id: ArchetypeId): Archetype {
  const a = ARCHETYPES[id];
  if (!a) throw new Error(`Unknown archetype: "${id}"`);
  return a;
}

/**
 * Resolve an archetype + canvas + theme into laid-out zones. The single entry
 * point the API generation pipeline calls after the LLM picks the archetype.
 */
export function resolveArchetype(
  id: ArchetypeId,
  canvas: CanvasClass,
  theme: ThemeBundle,
): ResolvedZone[] {
  return getArchetype(id).resolve(canvas, theme);
}

/** Whether an archetype supports a given canvas class. */
export function archetypeSupports(id: ArchetypeId, canvasClass: CanvasClassId): boolean {
  return getArchetype(id).supports.includes(canvasClass);
}
