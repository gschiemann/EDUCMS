# 00 — THE FLAGSHIP REBUILD PLAN: AI Template + Image Generation

**Date:** 2026-06-26 · **Author:** lead product+design architect
**Inputs:** R1 (OptiSigns teardown), R2 (competitive landscape), R3 (how SOTA tools get beautiful output), R4 (AI image-gen), R5 (code-verified teardown of OUR generator), R6 (signage design rulebook).
**Goal:** Make AI template + image generation **the single best feature in the app** — 10x OptiSigns, the reason a customer pays. Output must be *screen-ready beautiful*, on-brand, correct for every screen + every industry, and editable in our own click-to-edit editor with zero tool-switching.

> **The one-sentence thesis (proven by R3 + R5):** Our AI looks like trash because we ask the LLM to be a *typesetter and layout engine* — it emits free-floating %-positioned boxes of grey 600-weight text on a white canvas. Every world-class tool (Canva Magic Design, Gamma, Beautiful.ai, Framer, Durable) does the opposite: the LLM is **only a content + art-director** that fills **designer-engineered, grid-locked layout archetypes** styled by **swappable theme tokens**, while a **rules engine** (not the model) owns geometry, type scale, spacing, and contrast. We rebuild around that architecture.

---

## 1. The core architectural shift — from free-form placement to ARCHETYPE + TOKEN + RULES

### 1.1 What's wrong today (R5, code-verified)
- The model emits raw `{x,y,width,height}` percentages per zone (`ai.service.ts:2009–2012`), applied verbatim as CSS (`BuilderZone.tsx:360–363`). **No grid → no rhythm → ragged "almost-aligned" amateur output.** The only overlap guard is a *prose sentence* (`ai.service.ts:2047`) that nothing enforces; `sanitizeTouchTemplate` (`ai.service.ts:2491`) does security scrubbing + edge-clamping but **zero collision/alignment/contrast checks**.
- **No design system.** Generated templates carry no `theme`, no palette object, no type scale, no font pairing. The allowlist (`TOUCH_GEN_ALLOWED_WIDGETS`, `ai.service.ts:1975`) is the *generic* primitives only — the AI is **architecturally locked out** of the 30+ designed themed widgets (`WidgetRenderer.tsx:1208–1239`) that are the only things in the app that look like a product.
- **White-canvas default** hard-coded at `BuilderCanvas.tsx:483`; fallback `TextWidget` renders **#1e293b 600-weight, browser-default font, transparent bg** (`WidgetRenderer.tsx:1240–1245`). Structurally a Word document with floating text boxes.
- **Brand is three property pokes** (`applyBrandToZoneConfig`, `templates.controller.ts:164–235`), fill-blank only, most of it dead `HS_*`-specific code the AI never triggers.
- **No per-vertical design intelligence** (only a one-sentence voice clause, `ai.service.ts:137–162`), **no orientation reflow** (percentages stretched onto portrait/ribbon, `ai.service.ts:2073`), **image-gen unconnected to templates** (`generateImage`, `ai.service.ts:1545`, never wired to a background).

### 1.2 The new architecture — four layers (R3 §4b, mapped to our files)

```
                       ┌──────────────────────────────────────────────┐
   operator prompt ──▶ │ LLM = ART DIRECTOR ONLY (structured JSON out) │
   + vertical + canvas │  picks: archetype · theme · copy · image plan │
   + brand kit         └───────────────────┬──────────────────────────┘
                                           │  { archetype, theme, copy{}, image{}, accentSlot }
                                           ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │ LAYER 1  ARCHETYPE RESOLVER  — named layout → pixel-perfect grid rects  │
   │          (NEW: packages/signage-design/archetypes.ts)                   │
   │ LAYER 2  THEME-TOKEN SYSTEM  — palette/type-pair/scale/scrim/motion     │
   │          (NEW: packages/signage-design/themes.ts + tokens→CSS vars)     │
   │ LAYER 3  RULES ENGINE / VALIDATOR — type scale, 8pt grid, safe margins, │
   │          WCAG contrast + auto-scrim, auto-fit ≥50px, 3×5 copy cap       │
   │          (NEW: packages/signage-design/validator.ts, runs after LLM)    │
   │ LAYER 4  IMAGERY  — generate(set)→brand→stock, text-safe zones, scrim   │
   │          (extend ai.service.ts generateImage + new SET path)            │
   └───────────────────────────────────────────────────────────────────────┘
                                           ▼
                            sanitizeTouchTemplate (security) → persist (templates.controller)
                                           ▼
                            WidgetRenderer routes copy into THEMED widgets
```

**The contract change — the LLM's ONLY output (R3 §4b "Layer 4"):**
```jsonc
{
  "archetype": "hero-fullbleed",          // from a curated enum, NEVER coordinates
  "theme": "warm-school",                 // a token bundle id (or "brand" = derive from kit)
  "copy": { "kicker": "...", "headline": "...", "body": "...", "cta": "..." },
  "image": { "mode": "generate|brand|stock|none", "prompt": "...", "query": "..." },
  "accentSlot": "cta",                    // the ONE element that gets the accent color
  "scenes": [ /* for multi-scene kiosk: each scene = its own archetype+copy+image */ ]
}
```
No `x/y/width/height`, no `fontSize`, no hex — **ever**. Geometry, sizing, color, and contrast are *derived* by Layers 1–3. This is the entire fix for "garbage output," and it is exactly how Beautiful.ai bans free editing to keep quality (R3 §1).

### 1.3 Why this is *easier* for signage than for slides/web (R3 §4 opening)
Signage has harder constraints (8–30 ft viewing, glanceable in 1–3 s, often 4K/portrait/LED) — which means **fewer valid layouts**, which means a small curated archetype set covers the space *better* here than anywhere. The constraints are our friend.

### 1.4 New shared package: `packages/signage-design/`
A single source of truth, consumable by the API (generation), the web builder (live preview/edit), and the renderer:
- `archetypes.ts` — ~12–16 archetypes, each a function `resolve(canvas, slots) → zoneRects[]` (grid-locked, gutter-aware, safe-margin inset, per-orientation variants).
- `themes.ts` — ~12–16 curated token bundles + `deriveThemeFromBrand(brandKit)` (Material-3-style tonal ramp from the brand primary, with guaranteed-contrast text tokens).
- `type-scale.ts` — modular scale (Perfect Fourth 1.333 default) + viewing-distance → cap-height %-of-canvas (R6 §10.A).
- `contrast.ts` — WCAG ratio calc + auto-scrim / text-flip (R6 §10.C, R3 §"automatic contrast").
- `validator.ts` — the machine-checkable R6 rulebook (§10) run on every generated board.
- `verticals.ts` — per-vertical design profiles (palette mood, type personality, density, preferred archetypes, widget allowlist) — R5 GAP 6, R6 §9.

---

## 2. Beautiful, on-brand backgrounds via AI image-gen (R4)

The single biggest visual upgrade is **a real full-bleed background image with an auto-scrim**, never text-on-flat-white (R3 §"real imagery", R5 GAP 3). Build:

- **Provider-by-job routing** (R4 §5): **Imagen 4 Fast** for live preview ($0.02, ~2.7s, native 16:9 / 9:16) → **Imagen 4 Ultra** for the chosen final (2K, $0.06); **Ideogram 3.0** when text is baked into the graphic (promo/poster/menu hero); **Recraft V3/V4** for on-brand vector/icon/badge + the **SET tool**; **Firefly** as the indemnified "commercially-safe" tier toggle for districts and brand-sensitive pilots (Domino's-class).
- **Coherent SETS for multi-scene** (R4 §3, the "now it's the prize" feature): a kiosk attract loop / multi-scene template generates **4–6 backgrounds in ONE consistent style** (Recraft Set or FLUX.2 10-reference), so every scene obviously belongs together instead of 6 random stock images. Maps to our multi-scene kiosk architecture (task #241).
- **Brand-locked generation** (R4 §"features to build" #2): auto-inject the tenant BrandKit (primary/accent hex, logo, fonts) into every prompt/style-ref so output is *their* board, not a stock template; hex-exact via FLUX.2 / Brand Kit via Recraft. Replaces today's prose-hex hint that the model ignores (R5 secondary findings).
- **Text-safe zones** (R4 §"features to build" #3 — our differentiator, no model does it natively): mark where live widgets (clock, price, score) will sit; constrain the generator (prompt + mask) to keep those regions clean/low-contrast so dynamic text stays legible over the AI background.
- **Aspect-correct + Reframe** (R4 §6): generate at the board's REAL ratio (Imagen 4's 16:9/9:16) and offer Reframe/outpaint (Ideogram) to retarget one design across landscape board → portrait poster → ribbon strip. Upscale to native 2K/4K (Topaz/Recraft) — a scaled square crop is the #1 "looks cheap" tell (R4 §4).
- **Wire image-gen → template background** (R5 GAP 3, "the link doesn't exist today"): when Layer 4 returns `image.mode = "generate"`, the generated image becomes the template-level `bgImage`, paired with the contrast-guaranteed scrim from Layer 3.

---

## 3. Every screen — canvas, orientation, reflow, touch + non-touch

R5 GAP 7 is brutal: percentages get *stretched* onto portrait/ribbon, no reflow, LED ribbon gets zero handling. The archetype system fixes this by design — archetypes resolve **per-orientation** (R6 §10.G):

- **Canvas classes** the resolver knows: **landscape 16:9** (1920×1080 / 3840×2160), **portrait 9:16** (hallway pillars, menu, wayfinding), **ultrawide / LED ribbon** (e.g. 320×1080 ×N, 960×1080 posters), **square-ish LED**. Each archetype declares which canvas classes it supports and provides a **re-stacked grid per orientation** — a portrait board is a vertical stack authored for portrait, NOT a squashed landscape (R5 GAP 7, R6 §8).
- **Auto-layout reflow:** because the LLM picks an *archetype* (semantic) not coordinates, the SAME generated board re-resolves cleanly to any canvas — this is the **magic-resize** capability OptiSigns/most competitors lack (R1 #4, R2 white-space #1). Generate once, deploy to landscape lobby + portrait hallway + ribbon, each correct.
- **LED/coarse-pitch awareness** (R6 §10.G #26): heavier strokes, larger min type, no hairline rules, bumped contrast/weight; and the archetype resolver emits **Taurus-safe geometry** (longhand `top/right/bottom/left`, no `inset`/`gap` — CLAUDE.md rule #10) so generated boards never hit the Chromium-83 collapse-to-0×0 bug.
- **Touch (kiosk, multi-scene)** vs **non-touch (passive boards)**: keep the two existing prompts (`TOUCH_TEMPLATE_SYSTEM_PROMPT`, `SIGNAGE_TEMPLATE_SYSTEM_PROMPT`) but both emit the new archetype contract. Touch archetypes carry interactive slots (`touchAction` nav, scene routing — already supported) + the **per-scene archetype+theme+image** so every destination scene is a *designed* screen (fixes the recent "empty destination scene" class, commits `f3deced6`/`eb05d070`). Non-touch archetypes are single-screen, dwell-mode-aware (passing-by 1 zone / waiting ≤2 / lounging ≤3 — R6 §7).

---

## 4. Every industry — per-vertical design language (R5 GAP 6, R6 §9, R1 #7)

Today vertical only flavors copy tone. The new `verticals.ts` profile drives **layout, palette, type, density, motion, and widget set** per vertical. The AI selects *within* the profile (it can't pick a luxury-minimal archetype for a hype sports board). Concrete profiles from R6 §9/§10.H:

| Vertical | Palette mood | Type personality | Density | Preferred archetypes | Motion |
|---|---|---|---|---|---|
| **QSR / restaurant** | warm saturated (red/orange/yellow), big food imagery | bold sans, fixed price column | medium | `menu-list`, `lower-third-banner`, `hero-fullbleed` | slow, predictable; breakfast/lunch/dinner dayparts |
| **Luxury retail** | monochrome/muted, max negative space | refined sans, small logo, few words | very low | `quote-centered`, `hero-fullbleed` (minimal) | slow elegant fades |
| **Healthcare** | cool calm (light blue/teal/soft green/white), no harsh red/yellow | calm sans, one message | very low | `stat-spotlight`, `announcement-stack` | minimal |
| **Stadium / sports** | bold team-color, dominant numerals | heavy display, big numbers | medium-high | `score-strip`, `hero-fullbleed`, ribbon archetypes | fast energetic, broadcast title-safe |
| **Worship** | warm welcoming, dim-room high-contrast | clean readable, scrim lower-thirds | low | `lower-third-banner`, `quote-centered` | gentle; seasonal dayparts |
| **Corporate / K-12 / fitness / …** | per-profile | per-profile | per-profile | per-profile | per-profile |

Each profile also seeds **per-vertical AI prompt tuning**, **per-vertical default themes**, and **vertical-tuned image prompts** (appetite food vs calm clinic vs stadium hype) — the per-vertical intelligence layer R1 calls a "beat-them lane" (#7) and R2 names as white space (#2).

---

## 5. The signage design rulebook — enforced in code, not prose (R6 §10)

Every numeric law from R6 §10 lives in `validator.ts` (Layer 3) and runs on every generated board, regardless of what the LLM emits:

- **Type sizing (R6 §10.A):** headline cap-height ≥ 6.5% of canvas height (15-ft default), body ≥ 3.5%, scaled by `viewingDistance/15`; headline = 2–3× body (reject otherwise); derived from a **modular scale (1.333)** off canvas height — never model-chosen. Honors our existing **auto-fit ≥50px floor**.
- **Typeface (R6 §10.B):** sans-serif allow-list only (Inter/Roboto/Helvetica/Open Sans/Lato + brand sans); max 2 families; headline 700–800 / body 400–500; sentence case for phrases, ALL-CAPS only ≤2-word labels.
- **Contrast (R6 §10.C):** hard floor **7:1 body / 4.5:1 large**; auto-reject + auto-correct (flip text token white↔dark OR drop a scrim) for any pairing below floor; **text over image → mandatory scrim** (the Beautiful.ai / worship lower-third move). 3–5 colors, ONE accent reserved for `accentSlot`.
- **Density / hierarchy (R6 §10.D):** 3×5 copy cap; 80/20 weight; zone count capped by dwell mode; exactly one focal element.
- **Layout / margins (R6 §10.E):** ≥5% safe margin all sides + title-safe 90% for broadcast surfaces; rule-of-thirds focal placement; golden-ratio zone proportioning; grid-aligned price/value columns.
- **Motion (R6 §10.F):** transitions 300–500ms, `ease-out` in / `ease-in` out, never `linear`; ONE animated element, on the periphery; never >3 flashes/sec (seizure safety). Generalize our celebration-cinematics engine into a restrained signage-motion layer (R1 #5 — the engine competitors don't have).
- **Daypart awareness (R6 §10.I):** for dynamic boards, *offer* breakfast/lunch/dinner (or seasonal) variants rather than one static skin.

A board that fails a rule is **auto-corrected** (scrim/flip/resize) where possible, and **flagged** otherwise — so "garbage" is structurally impossible to ship.

---

## 6. Concrete codebase mapping — what changes, what's new

| Area | File / symbol | Change |
|---|---|---|
| **NEW shared package** | `packages/signage-design/` (archetypes, themes, type-scale, contrast, validator, verticals) | Source of truth for Layers 1–3, used by API + web. Needs `tsconfig.json` + `dist/index.js` main (CLAUDE.md CommonJS rule). |
| **LLM contract** | `ai.service.ts` `TOUCH_TEMPLATE_SYSTEM_PROMPT` (1993), `SIGNAGE_TEMPLATE_SYSTEM_PROMPT` (2113), `TOUCH_CANDIDATE_DIRECTIVES` (2106) | Replace free-form `{x,y,w,h}` schema with the archetype+theme+copy+image contract; directives become archetype/theme *variety* seeds (different archetype per candidate). |
| **Resolve + validate** | `ai.service.ts` `generateTouchTemplateInner` (792), `generateTouchTemplateCandidatesInner` (1385), `generateSignageTemplate` | After parse: `resolveArchetype()` → `applyTheme()` → `validator.enforce()` → only THEN sanitize. Geometry produced server-side. |
| **Sanitizer** | `ai.service.ts` `sanitizeTouchTemplate` (2491) | Keep security scrubbing; add collision/alignment/contrast/min-font as a *design* validation pass (or call validator before it). |
| **Allowlist** | `ai.service.ts` `TOUCH_GEN_ALLOWED_WIDGETS` (1975) | Expand to include themed/variant widgets + `DECORATION`/`ANIMATED_BACKGROUND`; teach the prompt that `theme`/`variant` exist so copy routes into designed renderers (R5 GAP 5, "biggest leverage/effort ratio"). |
| **Brand application** | `templates.controller.ts` `applyBrandToZoneConfig` (164) | Replace 3-poke fill-blank with **full resolved theme** at template root (CSS vars: `--ink/--surface/--accent/--display/--body`); brand can WIN, not just fill. |
| **Background persist** | `templates.controller.ts` create path (~801) | Accept `bgImage`/`bgGradient`/`bgColor` from generation; never default to `#ffffff`. |
| **Canvas default** | `BuilderCanvas.tsx:483` | Tasteful neutral surface fallback, never literal white. |
| **Renderer** | `WidgetRenderer.tsx` TextWidget (1240) + theme switch (1208) + variant dispatch (399) | Polished token-driven default (display font, surface card, radius/shadow); route AI copy into themed variants. |
| **Image-gen** | `ai.service.ts` `generateImage` (1545), `buildImageBrandHint` (1755) | Provider-by-job routing (Imagen4/Ideogram/Recraft/Firefly); aspect-to-canvas coupling; SET path; brand style-ref injection; **wire output → template `bgImage`**. |
| **Web builder UX** | touch-template / generate modals | 3 candidates at true canvas; click-any-slot edit (existing hot-zone); "Reshuffle theme" / "Try another layout" / "Regenerate background" (Gamma one-click restyle, R3 §4c). |
| **Env / config** | CLAUDE.md env table | Add `GOOGLE_IMAGEN_API_KEY` / `IDEOGRAM_API_KEY` / `RECRAFT_API_KEY` / `FIREFLY_*` (graceful-degrade when unset, per existing `ANTHROPIC_API_KEY` pattern). |

---

## 7. Phased, ranked roadmap (highest-leverage first)

### Phase 1 — QUICK WINS: visibly kill "garbage" fast (~1 sprint)
*These need NO new image provider and NO new package scaffolding to start showing results; they reroute the existing pipeline into the designed renderers and kill the white canvas.* (R5 priority order #1–#3.)

| # | Scope | Files | Effort | Visible result |
|---|---|---|---|---|
| **1A** | **Route AI copy into existing THEMED widgets.** Expand allowlist + teach prompt `theme`/`variant` exist; pick a theme per vertical/prompt. | `ai.service.ts` 1975/1993/2113; `WidgetRenderer.tsx` 399/1208 | M | Text stops being grey 600-weight blobs → renders in Rainbow Ribbon / HS Varsity / Storybook-class designed widgets. **The single biggest before/after.** |
| **1B** | **Kill the white canvas + require a background decision.** Default gradient (brand-tinted) or token surface; no `#ffffff`. | `BuilderCanvas.tsx:483`; `templates.controller.ts:801`; prompt schema | S | Every board has a real backdrop instead of floating boxes on white. |
| **1C** | **Curated theme tokens + brand-derived palette (v1).** ~12 token bundles + `deriveThemeFromBrand` (contrast-checked); apply at template root as CSS vars. | NEW `themes.ts`+`contrast.ts`; `applyBrandToZoneConfig` (164) | M | Coherent palette + font pairing; brand actually *feels* applied (not one accent line). |
| **1D** | **Contrast guard + auto-scrim + min-font floor in sanitize.** WCAG 7:1/4.5:1, auto-scrim over images, enforce ≥50px / safe-margins. | NEW `validator.ts`; `sanitizeTouchTemplate` (2491) | M | No illegible/clipped text ever ships; text over any bg stays readable. |
| **1E** | **First 4–6 archetypes (landscape) + resolver, behind a flag.** `hero-fullbleed`, `split-50`, `lower-third-banner`, `stat-spotlight`, `three-up-grid`; LLM picks archetype, server resolves rects. | NEW `archetypes.ts`; resolve step in `generateTouchTemplateInner` (792) | L | Grid-locked alignment, real hierarchy — overlap + ragged edges gone. Proves the architecture on the highest-traffic path. |

**Phase 1 success demo:** same one-sentence prompt that today yields grey-on-white → now yields a gradient/branded hero board with a themed headline, correct contrast, and clean alignment, in <30s, 3 candidates. Screenshot before/after side-by-side.

### Phase 2 — IMAGERY + full archetype/orientation system (~1–2 sprints)
- Full archetype library (12–16) + **per-orientation reflow** (portrait + ribbon variants) + LED/Taurus-safe geometry. (R5 GAP 7, R6 §10.G.)
- **AI background generation wired into templates** — Imagen 4 (preview Fast / final Ultra), aspect-to-canvas, scrim pairing. (R4, R5 GAP 3.)
- **Modular type scale derived from viewing distance** (validator computes sizes; model never picks). (R6 §10.A.)
- **Per-vertical design profiles** v1 (palette/type/density/archetype/widget set). (R5 GAP 6, R6 §9.)

**Phase 2 success demo:** "Tuesday taco special" → branded hero with a *generated* appetizing food background + readable headline; resize to portrait hallway + ribbon, each reflows correctly.

### Phase 3 — THE PRIZE: SETS, on-brand image engines, magic-resize, motion (~2 sprints)
- **Coherent SET generation** for multi-scene kiosks (Recraft Set / FLUX.2 multi-ref) — 4–6 matched scene backgrounds. (R4 §3 — the "now it's the prize" upgrade; task #241.)
- **On-brand image engines** (Recraft Brand Kit + SVG logos/badges; FLUX.2 hex-exact) + **text-safe zones** + **upscale to 2K/4K** + **Reframe** across aspect ratios. (R4 §5.)
- **Magic-resize as a product feature** — one generated design → all canvases, one click. (R1 #4, R2 white-space #1.)
- **Restrained signage-motion layer** generalized from celebration cinematics (one element, periphery, 300–500ms, ≤3 flashes/s). (R1 #5, R6 §10.F.)
- **Daypart variant proposals** + **commercially-safe (Firefly) tier toggle**. (R6 §10.I, R4 §5.)

### Phase 4 — FRONTIER moats (post-flagship)
- **Data-bound-from-birth generation** — "Tuesday lunch board pulling today's Toast prices" generates a board already wired to the live source (R2 white-space #4) via our POS connector registry.
- **Prompt → data-driven app / live widgets** (OptiDev parity) (R1 #8, R2 differentiated #1).
- **AI for sports + life-safety** — prompt → scoreboard/ribbon/scorebug for a sport; AI-assisted CAP/emergency content — *uncontested in AI* (R2 white-space #2). Reuses our existing sports widget sets.
- **Performance-history-aware suggestions** (Poppulo's loop) + **AI Smart Scheduling** (Revel) (R2 differentiated #2/#3).

---

## 8. Success bar — what "10x OptiSign / best the world has seen" looks like

OptiSigns' "amazing" = speed + multiple polished candidates + zero tool-switching + immediately editable, on a deep industry library (R1 §"what amazing means"). We must clear that floor AND beat it on the four lanes nobody has solved (R2 white-space):

1. **Screen-physics-correct generation** — the only AI that generates *correctly* for 4K LED, portrait pillars, daisy-chained ribbon (320×1080×N), and Chromium-83 Taurus controllers, with auto-reflow across all of them. **No competitor can credibly claim this.**
2. **Generation that is on-brand + data-bound + life-safety/sports-aware** — their board, their prices/scores wired live, for verticals (sports, emergency) where AI is uncontested.
3. **Generate → refine in OUR click-to-edit editor with zero handoff** — directly attacks OptiSigns' #1 review complaint ("templates difficult to edit, users restart from scratch," R1 §7).
4. **Beautiful by construction** — every output passes the R6 rulebook automatically; the operator *cannot* produce an ugly board.

**The demo that wins the room:** one operator, one phone, one sentence — "make a welcome board for our taco Tuesday" → **3 finished, branded, beautiful candidates in <30s** with a generated food background and correct contrast → tap a headline, edit a word, swap the image → **one tap reflows it to the portrait hallway screen and the ribbon board** → push live to 150 screens instantly → and (the kill shot OptiSigns structurally can't answer) trigger the emergency overlay on the same screens. Speed + beauty + every-screen + on-brand + the safety moat, in one flow, in one product.

---

## 9. Risks / guardrails
- **Curated, not generated, archetypes + themes.** The whole thesis (R3) is that *humans/engineers design the slots*; resist letting the LLM invent geometry "just this once."
- **One template at a time when hand-building archetypes** (CLAUDE.md Template Design Workflow — batch-building regresses to "rounded rectangle with shadow"). HTML mockup → approve → React port → screenshot-verify each archetype.
- **Taurus-safe output** — archetype resolver must emit longhand sides, no `inset`/`gap` (CLAUDE.md rule #10); add to the `taurus-safety` CI gate.
- **Cost control** — Imagen 4 Fast for preview, Ultra only on the chosen final; respect the Tier-1/BYOK economic model (platform setup AI vs customer creative AI, CLAUDE.md). Cache generated backgrounds per tenant.
- **Verify before claim** (CLAUDE.md #21) — every phase ships with a real rendered screenshot, not "done."
```