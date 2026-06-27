# @cms/signage-design

The signage design engine. It turns the LLM into an **art-director** (it emits
only `archetype + theme + copy + image` intent — never coordinates, hex, or font
sizes) while this package owns **geometry, type scale, color, and contrast** —
the architecture every world-class AI design tool uses (Canva Magic Design,
Gamma, Beautiful.ai).

Full background:
`docs/research/2026-06-26-ai-flagship-rebuild/00-FLAGSHIP-PLAN.md`.

## Why this exists

Our AI signage looked like trash because we asked the model to be a *typesetter
and layout engine* — it emitted free-floating %-positioned boxes of grey text on
white. Every SOTA tool does the opposite: the model is an art-director that fills
**designer-engineered, grid-locked archetypes** styled by **swappable theme
tokens**, while a **rules engine** (not the model) owns geometry, type, color and
contrast. This package is that engine.

## Layers

| Module | Owns |
|---|---|
| `types.ts` | The art-director contract (`ArtDirectorSpec`) + canvas classes + engine vocabulary. |
| `type-scale.ts` | Modular scale (Perfect Fourth 1.333). Sizes derived from canvas height + viewing distance; honors the ≥50px auto-fit floor. |
| `contrast.ts` | WCAG ratio math, auto-scrim generator, white↔dark text-token flip. Signage floors: 7:1 body / 4.5:1 large. |
| `themes.ts` | 12 curated `ThemeBundle`s + `deriveThemeFromBrand()` using a real HCT / Material-3 tonal algorithm (`hct.ts`) with guaranteed-contrast text tokens. |
| `archetypes.ts` | The resolver framework: each archetype `resolve(canvas, theme) → ResolvedZone[]` (grid-locked, ≥5% safe-margin, longhand-only / Taurus-safe). 6 landscape archetypes. |
| `validator.ts` | The R6 numeric rulebook as code. Auto-corrects (scrim / flip / resize / margin-clamp) or flags. |
| `hct.ts` | Self-contained, correct HCT/CAM16 port (zero runtime deps). |

## Precedence

When layers disagree: **archetype > theme > validator**. The validator never
invents a third look — it only makes the chosen archetype+theme legal.

## Build & test

```bash
pnpm --filter @cms/signage-design build   # tsc -> dist (CommonJS, require()-able)
pnpm --filter @cms/signage-design test    # jest
```

## Wave-2 (wiring into `ai.service.ts`)

This package is the engine; it is not yet wired into generation. Wave-2:
1. Replace the free-form `{x,y,w,h}` LLM schema with `ArtDirectorSpec`.
2. After the LLM returns: `resolveArchetype()` → apply theme tokens →
   `enforce()` → only then `sanitizeTouchTemplate()`.
3. Translate `ResolvedZone[]` into `TemplateZone` rows (already the same
   %-coord shape) and the theme into template-root CSS vars.
4. Consumers MUST emit longhand `top/right/bottom/left` (never `inset`/`gap`)
   from the % geometry — Taurus-safe (CLAUDE.md rule #10).
