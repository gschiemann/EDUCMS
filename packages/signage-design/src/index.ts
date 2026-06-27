/**
 * @cms/signage-design
 *
 * The signage design engine. Turns the LLM into an ART DIRECTOR (it emits only
 * archetype + theme + copy + image intent) while THIS package owns geometry,
 * type scale, color, and contrast — the architecture every world-class AI
 * design tool uses (Canva / Gamma / Beautiful.ai), per
 * docs/research/2026-06-26-ai-flagship-rebuild.
 *
 * Layer map:
 *   types.ts       — the art-director contract + engine vocabulary.
 *   type-scale.ts  — modular scale; sizes derived from canvas + viewing distance.
 *   contrast.ts    — WCAG math + auto-scrim + text-token flip.
 *   themes.ts      — curated ThemeBundles + deriveThemeFromBrand (real HCT).
 *   archetypes.ts  — the resolver framework: archetype -> grid-locked rects.
 *   validator.ts   — the R6 numeric rulebook; auto-corrects, else flags.
 *
 * Precedence when layers disagree:  archetype > theme > validator.
 */

export * from './types';
export * from './type-scale';
export * from './contrast';
export * from './themes';
export * from './surface-css';
export * from './archetypes';
export * from './validator';

// HCT primitives (used by themes; exported for advanced callers / tests).
export { Hct, TonalPalette, argbFromHex, hexFromArgb } from './hct';
