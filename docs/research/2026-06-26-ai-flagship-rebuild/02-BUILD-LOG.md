# AI FLAGSHIP REBUILD — BUILD LOG (resumable)

Blueprint: 00-FLAGSHIP-PLAN.md · reorder/critique: 01-PLAN-CRITIQUE.md. Greg greenlit the build ("make this fucking great not trash"). Ultracode. Lead owns every merge (worktree agent → review diff → cherry-pick/merge → tsc+test → push → CI green → screenshot/live-verify). Archetype VISUALS gate on Greg's review (his no-batching rule).

## Architecture (the fix)
LLM = art-director ONLY (emits archetype+theme+copy+image, NO coords/hex/sizes). New `packages/signage-design/` engine owns geometry/type/color/contrast: archetypes (grid-locked resolvers) + themes (HCT brand-derive) + type-scale + contrast(+scrim) + validator (R6 rulebook). Output is still the existing zones[]/TemplateZone shape → no rewrite of the renderer.

## WAVE STATUS
| Wave | Scope | Status |
|------|-------|--------|
| **1 — Foundation** | `@cms/signage-design` engine (types/contract, type-scale, contrast, themes+HCT, validator, 6 landscape archetype resolvers, tests) + 6 archetype HTML mockups for Greg | **DONE** — engine merged to master `50450f1d` (112/112 tests, clean build, frozen lockfile). Mockups reviewed + approved by lead-on-Greg's-delegation. |
| **2 — Wire generator** | Migrate ai.service.ts TOUCH/SIGNAGE prompts to the art-director contract; resolve→theme→validate pipeline; kill white canvas; brand=full theme; route copy into 5-6 generic themed widgets. LIVE-verify on Dodgers. | **IN PROGRESS** (Greg: "wire these 6 first, expand after") |

## GREG'S DECISION (2026-06-26): wire-6-first
Greg delegated the mockup aesthetic review to the lead ("you review the mockups and tell me if they need improvements"). Verdict: **massive leap, architecture validated, approve the 6 landscape archetypes as the foundation** (all render editorial-grade — real imagery+scrim, signage type, font pairing, one accent, CSS shapes, NOT rounded-rect-on-white). Greg chose **"wire these 6 first, expand after"** → wire the generator now, see real AI output live on Dodgers, then expand the library (24-32 archetypes × portrait/ribbon/LED) in parallel.

### 4 CROSS-CUTTING FIXES to fold into the engine during Wave 2 (mockup-loop, verified live)
1. **Unify shadow/elevation language** — mockups used `box-shadow:0 Npx 0` (flat slab) in 3 boards. Add ONE soft elevation token to ThemeBundle, apply everywhere. (ThemeBundle has radiusPx + motion but no elevation token yet.)
2. **Persistent-element contrast guarantee** — the worship board's brand-bug vanished over the sun glow. The contrast guard already supports per-zone `ScrimSpec{direction}`; extend it so brand bug / logo / kicker get a guaranteed-contrast treatment regardless of image brightness at their location (top scrim or auto-chip), not just the headline scrim.
3. **Fill the canvas** — stat-spotlight's geometry left the right ~45% empty (dead space). Tune the resolver (center the hero, or add a supporting slot) so every archetype uses the full frame deliberately.
4. **Taurus-safe port** — engine geometry is %-only (good); the RENDER side must emit longhand top/right/bottom/left, per-child margins (no gap), and a solid-bg fallback for any backdrop-filter (K-12 category tab). Engine types.ts already documents this invariant.

### Per-board polish (apply while tuning rects against live renders)
- hero-fullbleed: top-align the content block so the CTA breathes (was crowding bottom safe-margin).
- split-50: soft elevation on the floating chip (was a 0-blur slab). ✓ designer's final pass made chip fully visible.
- three-up-grid: make the "featured" card unmistakable (thicker ring / badge).
- menu-list: confirm 5 rows clear the bottom at true 1080.
| **3 — Imagery + every screen** | AI bg image-gen wired to template bg (Imagen/Ideogram), per-orientation reflow (portrait/ribbon/LED, Taurus-safe), per-vertical design profiles, conversational refine (wire chat-to-edit) | QUEUED |
| **4 — The prize** | Coherent multi-scene image SETS, magic-resize, motion/video backgrounds, data-bound menu/score boards | QUEUED |

## DECISIONS GREG OWNS
- Archetype LOOK (review the mockups; his no-batching rule). Critic: go DEEP — 24-32 archetypes × orientation, not 12-16; candidates 4-6 not 3.
- Image-provider keys (Imagen/Ideogram/Recraft/Firefly) + image-gen tier = BYOK/metered, not platform-free.

## RESUME: read this table → first non-DONE wave. Engine branch returned by w3h0yscqr; lead merges + verifies. Then show Greg mockups → Wave 2.

## SHIPPED LOG
- 62536762 — docs: recon + plan + critique committed (so build agents can read the spec).
- 50450f1d — feat(signage-design): the @cms/signage-design engine (Wave 1). 3599 LOC, 112/112 tests, zero runtime deps (HCT/CAM16 ported inline). Added to root preflight. NOT wired yet (dead code until Wave 2).
