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
  type ResolveArchetypeOpts,
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
  // TYPOGRAPHY DETAIL TOKENS (2026-06-28): read the per-typeface weight from the
  // theme's FontPair (Playfair 900 vs Oswald/Anton 400-600 vs sans 700-800)
  // instead of a uniform 800/500. Falls back to the legacy 800/500 so a FontPair
  // without the tokens is unchanged.
  const displayWeight = theme.fontPair.displayWeight ?? 800;
  const bodyWeight = theme.fontPair.bodyWeight ?? 500;
  return {
    typeRole: role,
    colorToken: isAccent ? 'accent' : colorToken,
    fontFamily: isDisplay ? theme.fontPair.display : theme.fontPair.body,
    fontWeight: isDisplay ? displayWeight : bodyWeight,
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

// ---------------------------------------------------------------------------
// ORIENTATION (Wave 3 — "any screen size").
//
// Each resolver branches on the canvas SHAPE (not the class id, so a real LED
// panel that reports its own w/h still re-stacks correctly). Three shapes:
//   - portrait : tall (h notably > w)        -> stack vertically, full-width.
//   - ribbon   : a thin horizontal strip      -> one horizontal line, no stacks.
//   - (default): landscape / square           -> the original balanced layout.
// Square is treated as the default branch but centered/balanced where it helps.
// ---------------------------------------------------------------------------

/** Tall canvas: stack zones vertically, full-width. */
function isPortrait(canvas: CanvasClass): boolean {
  return canvas.h > canvas.w * 1.2;
}
/** Thin horizontal strip (ribbon / daisy-chained LED): one line, no stacks. */
function isRibbon(canvas: CanvasClass): boolean {
  return canvas.w >= canvas.h * 2.4;
}
/** Square-ish tile: balanced/centered variant of the landscape layout. */
function isSquare(canvas: CanvasClass): boolean {
  const ratio = canvas.w / canvas.h;
  return ratio >= 0.9 && ratio <= 1.1;
}

// Honest per-archetype canvas support. The five SINGLE-MESSAGE archetypes
// (one headline / one stat / one CTA) re-stack down to a ribbon strip; the
// multi-zone ones (split / grid / menu / quote) do NOT — a thin strip can't
// carry them legibly, so they leave 'ultrawide-ribbon' out of `supports`.
const ALL_FOUR: CanvasClassId[] = [
  'landscape-16-9',
  'portrait-9-16',
  'ultrawide-ribbon',
  'square',
];
const NO_RIBBON: CanvasClassId[] = ['landscape-16-9', 'portrait-9-16', 'square'];

// ---------------------------------------------------------------------------
// 1. hero-fullbleed — full-bleed image + scrim + giant headline + kicker.
// ---------------------------------------------------------------------------

const heroFullbleed: Archetype = {
  id: 'hero-fullbleed',
  label: 'Hero (Full-bleed)',
  description: 'Full-bleed image with one giant headline and a kicker over a scrim.',
  supports: ALL_FOUR,
  backgroundMode: 'image',
  slots: [SLOT.background, SLOT.kicker, SLOT.headline, SLOT.cta],
  resolve(canvas: CanvasClass, theme: ThemeBundle): ResolvedZone[] {
    const cb = contentBox();

    // RIBBON — one horizontal line: kicker+headline fill the strip height, CTA
    // inline at the right. No stacks (a 1920x360 strip can't carry them).
    if (isRibbon(canvas)) {
      const bg = zone(SLOT.background, fullBleed(), 0, { scrim: theme.scrim });
      const kicker = zone(
        SLOT.kicker,
        { x: cb.x, y: cb.y, width: 20, height: cb.height },
        2,
        textTokens(theme, 'kicker', 'inkInverse', 'left'),
      );
      const headline = zone(
        SLOT.headline,
        { x: cb.x + 22, y: cb.y, width: cb.width - 22 - 22, height: cb.height },
        2,
        textTokens(theme, 'display', 'inkInverse', 'left'),
      );
      const cta = zone(
        SLOT.cta,
        { x: 100 - SAFE_MARGIN_PCT - 18, y: cb.y, width: 18, height: cb.height },
        2,
        textTokens(theme, 'title', 'accent', 'right', true),
      );
      return [bg, kicker, headline, cta];
    }

    const bg = zone(SLOT.background, fullBleed(), 0, { scrim: theme.scrim });

    // PORTRAIT — full-width content band anchored to the lower portion so the
    // image reads above it. Generous heights for a tall canvas.
    if (isPortrait(canvas)) {
      const kH = 6;
      const hH = 24;
      const cH = 9;
      const blockH = kH + GUTTER_PCT + hH + GUTTER_PCT + cH;
      const blockTop = 100 - SAFE_MARGIN_PCT - blockH;
      const kicker = zone(
        SLOT.kicker,
        { x: cb.x, y: blockTop, width: cb.width, height: kH },
        2,
        textTokens(theme, 'kicker', 'inkInverse', 'left'),
      );
      const headline = zone(
        SLOT.headline,
        { x: cb.x, y: blockTop + kH + GUTTER_PCT, width: cb.width, height: hH },
        2,
        textTokens(theme, 'display', 'inkInverse', 'left'),
      );
      const cta = zone(
        SLOT.cta,
        { x: cb.x, y: blockTop + kH + GUTTER_PCT + hH + GUTTER_PCT, width: cb.width * 0.7, height: cH },
        2,
        textTokens(theme, 'title', 'accent', 'left', true),
      );
      return [bg, kicker, headline, cta];
    }

    // LANDSCAPE / SQUARE — focal text in the lower portion (rule-of-thirds).
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
  supports: NO_RIBBON,
  backgroundMode: 'surface',
  slots: [SLOT.image, SLOT.kicker, SLOT.headline, SLOT.body, SLOT.cta],
  resolve(canvas: CanvasClass, theme: ThemeBundle): ResolvedZone[] {
    // PORTRAIT — image TOP / content BOTTOM (not left/right). The image takes
    // the upper ~42% so the four-zone content stack clears the safe bottom.
    if (isPortrait(canvas)) {
      const imageH = 42;
      const image = zone(SLOT.image, { x: 0, y: 0, width: 100, height: imageH }, 0, {});
      const colX = SAFE_MARGIN_PCT;
      const colW = 100 - 2 * SAFE_MARGIN_PCT;
      const top = imageH + GUTTER_PCT; // content band begins below the image
      const kH = 6;
      const hH = 14;
      const bH = 12;
      const cH = 8;
      const kicker = zone(
        SLOT.kicker,
        { x: colX, y: top, width: colW, height: kH },
        2,
        textTokens(theme, 'kicker', 'muted', 'left'),
      );
      const headline = zone(
        SLOT.headline,
        { x: colX, y: top + kH + GUTTER_PCT, width: colW, height: hH },
        2,
        textTokens(theme, 'headline', 'ink', 'left'),
      );
      const body = zone(
        SLOT.body,
        { x: colX, y: top + kH + hH + 2 * GUTTER_PCT, width: colW, height: bH },
        2,
        textTokens(theme, 'body', 'muted', 'left'),
      );
      const cta = zone(
        SLOT.cta,
        { x: colX, y: top + kH + hH + bH + 3 * GUTTER_PCT, width: colW * 0.7, height: cH },
        2,
        textTokens(theme, 'title', 'accent', 'left', true),
      );
      return [image, kicker, headline, body, cta];
    }

    // LANDSCAPE / SQUARE — left half = image (full height edge-to-edge for
    // impact), right half = content inside the safe margin.
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
  supports: ALL_FOUR,
  backgroundMode: 'image',
  slots: [SLOT.background, SLOT.headline, SLOT.cta],
  resolve(canvas: CanvasClass, theme: ThemeBundle): ResolvedZone[] {
    const cb = contentBox();

    // RIBBON — image fills; headline fills the strip with an inline CTA right.
    if (isRibbon(canvas)) {
      const bg = zone(SLOT.background, fullBleed(), 0, {
        scrim: { ...theme.scrim, direction: 'full', opacity: 0.78 },
      });
      const headline = zone(
        SLOT.headline,
        { x: cb.x, y: cb.y, width: cb.width - 22, height: cb.height },
        2,
        textTokens(theme, 'headline', 'inkInverse', 'left'),
      );
      const cta = zone(
        SLOT.cta,
        { x: 100 - SAFE_MARGIN_PCT - 18, y: cb.y, width: 18, height: cb.height },
        2,
        textTokens(theme, 'title', 'accent', 'right', true),
      );
      return [bg, headline, cta];
    }

    // PORTRAIT — full-bleed image with a taller bottom band (the bottom ~third
    // of a tall canvas is a bigger absolute area; widen it for legibility).
    if (isPortrait(canvas)) {
      const bg = zone(SLOT.background, fullBleed(), 0, {
        scrim: { ...theme.scrim, direction: 'bottom', opacity: 0.78 },
      });
      const hH = 18;
      const cH = 8;
      const blockH = hH + GUTTER_PCT + cH;
      const blockTop = 100 - SAFE_MARGIN_PCT - blockH;
      const headline = zone(
        SLOT.headline,
        { x: cb.x, y: blockTop, width: cb.width, height: hH },
        2,
        textTokens(theme, 'headline', 'inkInverse', 'left'),
      );
      const cta = zone(
        SLOT.cta,
        { x: cb.x, y: blockTop + hH + GUTTER_PCT, width: cb.width * 0.6, height: cH },
        2,
        textTokens(theme, 'title', 'accent', 'left', true),
      );
      return [bg, headline, cta];
    }

    // LANDSCAPE / SQUARE — banner across the bottom third.
    const bandTop = 66; // bottom third
    const bg = zone(SLOT.background, fullBleed(), 0, {
      scrim: { ...theme.scrim, direction: 'bottom', opacity: 0.78 },
    });
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
  supports: ALL_FOUR,
  backgroundMode: 'gradient',
  slots: [SLOT.kicker, SLOT.stat, SLOT.statLabel],
  resolve(canvas: CanvasClass, theme: ThemeBundle): ResolvedZone[] {
    const cb = contentBox();

    // RIBBON — one horizontal line: kicker | giant stat | label, side by side.
    if (isRibbon(canvas)) {
      const kicker = zone(
        SLOT.kicker,
        { x: cb.x, y: cb.y, width: 22, height: cb.height },
        2,
        textTokens(theme, 'kicker', 'muted', 'left'),
      );
      const stat = zone(
        SLOT.stat,
        { x: cb.x + 24, y: cb.y, width: 36, height: cb.height },
        2,
        textTokens(theme, 'display', 'accent', 'center', true),
      );
      const statLabel = zone(
        SLOT.statLabel,
        { x: cb.x + 62, y: cb.y, width: cb.width - 62, height: cb.height },
        2,
        textTokens(theme, 'title', 'ink', 'left'),
      );
      return [kicker, stat, statLabel];
    }

    // PORTRAIT — vertically centered, taller stat block for a tall canvas.
    if (isPortrait(canvas)) {
      const kH = 7;
      const sH = 26;
      const lH = 9;
      const blockH = kH + GUTTER_PCT + sH + GUTTER_PCT + lH;
      let y = (100 - blockH) / 2;
      const kicker = zone(
        SLOT.kicker,
        { x: cb.x, y, width: cb.width, height: kH },
        2,
        textTokens(theme, 'kicker', 'muted', 'center'),
      );
      y += kH + GUTTER_PCT;
      const stat = zone(
        SLOT.stat,
        { x: cb.x, y, width: cb.width, height: sH },
        2,
        textTokens(theme, 'display', 'accent', 'center', true),
      );
      y += sH + GUTTER_PCT;
      const statLabel = zone(
        SLOT.statLabel,
        { x: cb.x, y, width: cb.width, height: lH },
        2,
        textTokens(theme, 'title', 'ink', 'center'),
      );
      return [kicker, stat, statLabel];
    }

    // LANDSCAPE / SQUARE — a single hero element sits centered
    // (R6 §10.E rule 19 exception).
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
  supports: NO_RIBBON,
  backgroundMode: 'surface',
  slots: [SLOT.headline, SLOT.listItem, SLOT.listItem, SLOT.listItem],
  resolve(canvas: CanvasClass, theme: ThemeBundle): ResolvedZone[] {
    const cb = contentBox();

    // PORTRAIT — three STACKED rows (not columns), full-width.
    if (isPortrait(canvas)) {
      const headline = zone(
        SLOT.headline,
        { x: cb.x, y: cb.y, width: cb.width, height: 12 },
        2,
        textTokens(theme, 'headline', 'ink', 'left'),
      );
      const rowsTop = cb.y + 12 + GUTTER_PCT;
      const rowsH = cb.y + cb.height - rowsTop;
      const rowH = (rowsH - 2 * GUTTER_PCT) / 3;
      const cards: ResolvedZone[] = [];
      for (let i = 0; i < 3; i++) {
        const y = rowsTop + i * (rowH + GUTTER_PCT);
        cards.push(
          zone(
            SLOT.listItem,
            { x: cb.x, y, width: cb.width, height: rowH },
            2,
            { ...textTokens(theme, 'title', 'ink', 'center'), colorToken: 'surface' },
          ),
        );
      }
      return [headline, ...cards];
    }

    // LANDSCAPE / SQUARE — three columns under the headline.
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
//
// CONTENT-AWARE FILL (2026-06-28 — operator-verified gap): the menu must show
// the WHOLE menu and FILL the canvas, never a fixed 5 rows packed into the left
// 40%. The geometry adapts to the item count + canvas SHAPE:
//   - PORTRAIT, or LANDSCAPE with <= 6 items → ONE full-width column, rows tall,
//     the block centered vertically so a short menu doesn't strand the bottom.
//     A short LANDSCAPE menu also reserves a negative-space PHOTO panel on the
//     right ~42% (the mapper drops the resolved stock photo there, or a tasteful
//     themed panel when there's no photo) so the empty side never reads as a bug.
//   - LANDSCAPE/wide with >= 7 items → TWO equal columns under a full-width
//     headline, rows split left/right, each ~46% wide with a center gutter — the
//     canvas fills and the full menu is visible at a glance.
// The row COUNT equals the (clamped) item count so unused rows never exist, and
// the geometry is decided HERE (so enforce sizes fonts to the real row height).
// ---------------------------------------------------------------------------

/** Default rows when the mapper supplies no item count (legacy/preview path). */
const MENU_DEFAULT_ROWS = 5;
/** Hard ceiling on menu rows the geometry will lay out (matches the parser cap). */
export const MENU_MAX_ROWS = 12;
/** Min rows so a 1-item menu still reads as a designed list, not a lone line. */
const MENU_MIN_ROWS = 3;
/** Item-count threshold at/below which a landscape menu stays single-column. */
const MENU_SINGLE_COL_MAX = 6;

/** Clamp the requested item count into the row band the geometry supports. */
function menuRowCount(itemCount: number | undefined): number {
  const n = typeof itemCount === 'number' && itemCount > 0 ? Math.floor(itemCount) : MENU_DEFAULT_ROWS;
  return Math.max(MENU_MIN_ROWS, Math.min(MENU_MAX_ROWS, n));
}

const menuList: Archetype = {
  id: 'menu-list',
  label: 'Menu List',
  description: 'A headline over priced rows with a fixed-position value column.',
  supports: NO_RIBBON,
  backgroundMode: 'surface',
  // Slots are advisory (the resolver emits the EXACT row count it needs from the
  // item count); list MENU_MAX_ROWS listItem specs so any static consumer of
  // `slots` sees the full capacity. `image` is the optional negative-space
  // photo/panel slot a short landscape menu lays on its empty side — an IMAGE
  // HALF (NOT a full-bleed `background`, so the menu TEXT never gets a scrim).
  slots: [
    SLOT.headline,
    SLOT.image,
    ...Array.from({ length: MENU_MAX_ROWS }, () => SLOT.listItem),
  ],
  resolve(canvas: CanvasClass, theme: ThemeBundle, opts?: ResolveArchetypeOpts): ResolvedZone[] {
    const cb = contentBox();
    const rowTokens = (): ZoneStyleTokens => ({ ...textTokens(theme, 'title', 'ink', 'left') });

    const n = menuRowCount(opts?.itemCount);
    const portrait = isPortrait(canvas);
    // Two columns only on a wide/landscape canvas with a genuinely long menu.
    const twoColumn = !portrait && n > MENU_SINGLE_COL_MAX;

    // ── TWO-COLUMN (long landscape menu) ──────────────────────────────────
    // Full-width headline on top, then items split into a left + right column
    // (left gets the first ceil(n/2), right the rest) with a center gutter. Each
    // column's rows fill the vertical space so the whole canvas is used.
    if (twoColumn) {
      const headlineH = 13;
      const headline = zone(
        SLOT.headline,
        { x: cb.x, y: cb.y, width: cb.width, height: headlineH },
        2,
        textTokens(theme, 'headline', 'ink', 'left'),
      );
      const rowsTop = cb.y + headlineH + GUTTER_PCT;
      const rowsH = cb.y + cb.height - rowsTop;

      const leftCount = Math.ceil(n / 2);
      const rightCount = n - leftCount;
      // Both columns are sized to the SAME (taller) column's row height so the
      // two columns visually align row-for-row.
      const rowsPerCol = Math.max(leftCount, rightCount);
      const rowH = (rowsH - (rowsPerCol - 1) * GUTTER_PCT) / rowsPerCol;

      const colGutter = GUTTER_PCT + 1; // a touch wider than stacked gutters
      const colW = (cb.width - colGutter) / 2;
      const leftX = cb.x;
      const rightX = cb.x + colW + colGutter;

      const rows: ResolvedZone[] = [];
      for (let i = 0; i < n; i++) {
        const inLeft = i < leftCount;
        const colIdx = inLeft ? i : i - leftCount;
        const x = inLeft ? leftX : rightX;
        const y = rowsTop + colIdx * (rowH + GUTTER_PCT);
        rows.push(zone(SLOT.listItem, { x, y, width: colW, height: rowH }, 2, rowTokens()));
      }
      return [headline, ...rows];
    }

    // ── SINGLE-COLUMN (portrait, or short landscape menu) ────────────────
    // Portrait gets a shorter headline band so each priced row is taller and
    // reads from across a hallway pillar.
    const headlineH = portrait ? 10 : 13;

    // A SHORT landscape menu reserves the right ~42% for a negative-space photo
    // (or themed panel). The text column then uses the LEFT ~54% so the price
    // value still hits the right edge of its (narrower) column, not mid-canvas.
    const usePhoto = !portrait && n <= MENU_SINGLE_COL_MAX;
    const PHOTO_W = 42;
    const PHOTO_GUTTER = 4;
    const textW = usePhoto ? cb.width - PHOTO_W - PHOTO_GUTTER : cb.width;

    const headline = zone(
      SLOT.headline,
      { x: cb.x, y: cb.y, width: textW, height: headlineH },
      2,
      textTokens(theme, 'headline', 'ink', 'left'),
    );

    const rowsTop = cb.y + headlineH + GUTTER_PCT;
    const rowsAvail = cb.y + cb.height - rowsTop;
    // Tall rows even when few: cap each row's height so a 3-item menu doesn't get
    // absurdly tall rows, and CENTER the block vertically when it doesn't fill.
    const fullRowH = (rowsAvail - (n - 1) * GUTTER_PCT) / n;
    const maxRowH = 16; // a comfortable upper bound for a priced row
    const rowH = Math.min(fullRowH, maxRowH);
    const blockH = n * rowH + (n - 1) * GUTTER_PCT;
    const blockTop = rowsTop + Math.max(0, (rowsAvail - blockH) / 2);

    const rows: ResolvedZone[] = [];
    for (let i = 0; i < n; i++) {
      const y = blockTop + i * (rowH + GUTTER_PCT);
      // Each row is a single zone; the renderer lays label (left) + value
      // (right, fixed column) inside it — R6 §10.E rule 20 (fixed price column).
      rows.push(zone(SLOT.listItem, { x: cb.x, y, width: textW, height: rowH }, 2, rowTokens()));
    }

    if (usePhoto) {
      // The negative-space side panel — an IMAGE HALF (slot 'image', not the
      // full-bleed 'background' that would scrim the menu text). The mapper paints
      // the resolved stock photo here when one is available, else a tasteful
      // accent→surface themed panel (imageHalfGradient) — NEVER empty. Spans the
      // full content height so the right half is filled, not stranded.
      const photo = zone(
        SLOT.image,
        { x: cb.x + textW + PHOTO_GUTTER, y: cb.y, width: PHOTO_W, height: cb.height },
        1,
        {},
      );
      return [headline, ...rows, photo];
    }

    return [headline, ...rows];
  },
};

// ---------------------------------------------------------------------------
// 7. poster-promo — full-bleed image + scrim, centered punchy offer + CTA.
// ---------------------------------------------------------------------------

const posterPromo: Archetype = {
  id: 'poster-promo',
  label: 'Poster / Promo',
  description: 'Full-bleed photo + scrim with a centered punchy offer headline and a prominent CTA. Retail/QSR promos, "today only".',
  supports: ALL_FOUR,
  backgroundMode: 'image',
  slots: [SLOT.background, SLOT.kicker, SLOT.headline, SLOT.cta],
  resolve(canvas: CanvasClass, theme: ThemeBundle): ResolvedZone[] {
    const cb = contentBox();

    // RIBBON — full-bleed photo + scrim, one horizontal line: kicker + offer,
    // CTA inline at the right.
    if (isRibbon(canvas)) {
      const bg = zone(SLOT.background, fullBleed(), 0, {
        scrim: { ...theme.scrim, direction: 'full', opacity: 0.62 },
      });
      const kicker = zone(
        SLOT.kicker,
        { x: cb.x, y: cb.y, width: 20, height: cb.height },
        2,
        textTokens(theme, 'kicker', 'inkInverse', 'left'),
      );
      const headline = zone(
        SLOT.headline,
        { x: cb.x + 22, y: cb.y, width: cb.width - 22 - 22, height: cb.height },
        2,
        textTokens(theme, 'display', 'inkInverse', 'left'),
      );
      const cta = zone(
        SLOT.cta,
        { x: 100 - SAFE_MARGIN_PCT - 18, y: cb.y, width: 18, height: cb.height },
        2,
        textTokens(theme, 'title', 'accent', 'right', true),
      );
      return [bg, kicker, headline, cta];
    }

    const bg = zone(SLOT.background, fullBleed(), 0, {
      scrim: { ...theme.scrim, direction: 'full', opacity: 0.62 },
    });

    // PORTRAIT — centered offer stack, taller headline for a tall canvas.
    if (isPortrait(canvas)) {
      const kH = 7;
      const hH = 26;
      const cH = 9;
      const blockH = kH + GUTTER_PCT + hH + GUTTER_PCT + cH;
      let y = (100 - blockH) / 2;
      const kicker = zone(SLOT.kicker, { x: cb.x, y, width: cb.width, height: kH }, 2, textTokens(theme, 'kicker', 'inkInverse', 'center'));
      y += kH + GUTTER_PCT;
      const headline = zone(SLOT.headline, { x: cb.x, y, width: cb.width, height: hH }, 2, textTokens(theme, 'display', 'inkInverse', 'center'));
      y += hH + GUTTER_PCT;
      const cta = zone(SLOT.cta, { x: 22, y, width: 56, height: cH }, 2, textTokens(theme, 'title', 'accent', 'center', true));
      return [bg, kicker, headline, cta];
    }

    // LANDSCAPE / SQUARE — centered stack: kicker 8 + g + headline 30 + g + cta 10 = 59.
    const blockH = 8 + GUTTER_PCT + 30 + GUTTER_PCT + 10;
    let y = (100 - blockH) / 2;
    const kicker = zone(SLOT.kicker, { x: cb.x, y, width: cb.width, height: 8 }, 2, textTokens(theme, 'kicker', 'inkInverse', 'center'));
    y += 8 + GUTTER_PCT;
    const headline = zone(SLOT.headline, { x: cb.x, y, width: cb.width, height: 30 }, 2, textTokens(theme, 'display', 'inkInverse', 'center'));
    y += 30 + GUTTER_PCT;
    const cta = zone(SLOT.cta, { x: 30, y, width: 40, height: 10 }, 2, textTokens(theme, 'title', 'accent', 'center', true));
    return [bg, kicker, headline, cta];
  },
};

// ---------------------------------------------------------------------------
// 8. quote-spotlight — a large centered quote + attribution.
// ---------------------------------------------------------------------------

const quoteSpotlight: Archetype = {
  id: 'quote-spotlight',
  label: 'Quote Spotlight',
  description: 'A large centered quote with attribution. Testimonials, worship verses, corporate values, quote-of-the-day.',
  supports: NO_RIBBON,
  backgroundMode: 'gradient',
  slots: [SLOT.kicker, SLOT.headline, SLOT.body],
  resolve(canvas: CanvasClass, theme: ThemeBundle): ResolvedZone[] {
    const cb = contentBox();

    // PORTRAIT — taller centered quote block for a tall canvas.
    if (isPortrait(canvas)) {
      const kH = 6;
      const qH = 40;
      const aH = 8;
      const blockH = kH + GUTTER_PCT + qH + GUTTER_PCT + aH;
      let y = (100 - blockH) / 2;
      const kicker = zone(SLOT.kicker, { x: cb.x, y, width: cb.width, height: kH }, 2, textTokens(theme, 'kicker', 'accent', 'center'));
      y += kH + GUTTER_PCT;
      const headline = zone(SLOT.headline, { x: cb.x, y, width: cb.width, height: qH }, 2, textTokens(theme, 'headline', 'ink', 'center'));
      y += qH + GUTTER_PCT;
      const body = zone(SLOT.body, { x: cb.x + 6, y, width: cb.width - 12, height: aH }, 2, textTokens(theme, 'title', 'muted', 'center'));
      return [kicker, headline, body];
    }

    // LANDSCAPE / SQUARE — kicker 7 + g + quote 34 + g + attribution 8 = 55, centered.
    const blockH = 7 + GUTTER_PCT + 34 + GUTTER_PCT + 8;
    let y = (100 - blockH) / 2;
    const kicker = zone(SLOT.kicker, { x: cb.x, y, width: cb.width, height: 7 }, 2, textTokens(theme, 'kicker', 'accent', 'center'));
    y += 7 + GUTTER_PCT;
    const headline = zone(SLOT.headline, { x: cb.x, y, width: cb.width, height: 34 }, 2, textTokens(theme, 'headline', 'ink', 'center'));
    y += 34 + GUTTER_PCT;
    const body = zone(SLOT.body, { x: cb.x + 10, y, width: cb.width - 20, height: 8 }, 2, textTokens(theme, 'title', 'muted', 'center'));
    return [kicker, headline, body];
  },
};

// ---------------------------------------------------------------------------
// 9. title-cta — centered eyebrow + headline + body + one CTA (announcement).
// ---------------------------------------------------------------------------

const titleCta: Archetype = {
  id: 'title-cta',
  label: 'Title + CTA',
  description: 'A centered announcement: eyebrow, headline, a supporting line, and one call-to-action. All-purpose welcome/announcement/event.',
  supports: ALL_FOUR,
  backgroundMode: 'gradient',
  slots: [SLOT.kicker, SLOT.headline, SLOT.body, SLOT.cta],
  resolve(canvas: CanvasClass, theme: ThemeBundle): ResolvedZone[] {
    const cb = contentBox();

    // RIBBON — one horizontal line: kicker | headline | CTA. Body is dropped
    // (a thin strip is single-message; the supporting line doesn't fit).
    if (isRibbon(canvas)) {
      const kicker = zone(
        SLOT.kicker,
        { x: cb.x, y: cb.y, width: 18, height: cb.height },
        2,
        textTokens(theme, 'kicker', 'accent', 'left'),
      );
      const headline = zone(
        SLOT.headline,
        { x: cb.x + 20, y: cb.y, width: cb.width - 20 - 22, height: cb.height },
        2,
        textTokens(theme, 'display', 'ink', 'left'),
      );
      const cta = zone(
        SLOT.cta,
        { x: 100 - SAFE_MARGIN_PCT - 18, y: cb.y, width: 18, height: cb.height },
        2,
        textTokens(theme, 'title', 'accent', 'right', true),
      );
      return [kicker, headline, cta];
    }

    // PORTRAIT — taller centered announcement stack for a tall canvas.
    if (isPortrait(canvas)) {
      const kH = 6;
      const hH = 22;
      const bH = 14;
      const cH = 9;
      const blockH = kH + GUTTER_PCT + hH + GUTTER_PCT + bH + GUTTER_PCT + cH;
      let y = (100 - blockH) / 2;
      const kicker = zone(SLOT.kicker, { x: cb.x, y, width: cb.width, height: kH }, 2, textTokens(theme, 'kicker', 'accent', 'center'));
      y += kH + GUTTER_PCT;
      const headline = zone(SLOT.headline, { x: cb.x, y, width: cb.width, height: hH }, 2, textTokens(theme, 'display', 'ink', 'center'));
      y += hH + GUTTER_PCT;
      const body = zone(SLOT.body, { x: cb.x, y, width: cb.width, height: bH }, 2, textTokens(theme, 'body', 'muted', 'center'));
      y += bH + GUTTER_PCT;
      const cta = zone(SLOT.cta, { x: 22, y, width: 56, height: cH }, 2, textTokens(theme, 'title', 'accent', 'center', true));
      return [kicker, headline, body, cta];
    }

    // LANDSCAPE / SQUARE — kicker 7 + g + headline 26 + g + body 12 + g + cta 9 = 63, centered.
    const blockH = 7 + GUTTER_PCT + 26 + GUTTER_PCT + 12 + GUTTER_PCT + 9;
    let y = (100 - blockH) / 2;
    const kicker = zone(SLOT.kicker, { x: cb.x, y, width: cb.width, height: 7 }, 2, textTokens(theme, 'kicker', 'accent', 'center'));
    y += 7 + GUTTER_PCT;
    const headline = zone(SLOT.headline, { x: cb.x, y, width: cb.width, height: 26 }, 2, textTokens(theme, 'display', 'ink', 'center'));
    y += 26 + GUTTER_PCT;
    const body = zone(SLOT.body, { x: cb.x + 8, y, width: cb.width - 16, height: 12 }, 2, textTokens(theme, 'body', 'muted', 'center'));
    y += 12 + GUTTER_PCT;
    const cta = zone(SLOT.cta, { x: 32, y, width: 36, height: 9 }, 2, textTokens(theme, 'title', 'accent', 'center', true));
    return [kicker, headline, body, cta];
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
  'poster-promo': posterPromo,
  'quote-spotlight': quoteSpotlight,
  'title-cta': titleCta,
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
  opts?: ResolveArchetypeOpts,
): ResolvedZone[] {
  return getArchetype(id).resolve(canvas, theme, opts);
}

/** Whether an archetype supports a given canvas class. */
export function archetypeSupports(id: ArchetypeId, canvasClass: CanvasClassId): boolean {
  return getArchetype(id).supports.includes(canvasClass);
}
