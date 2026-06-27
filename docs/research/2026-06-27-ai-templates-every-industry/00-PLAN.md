# AI Templates for EVERY Industry + Full-Template-from-Prompts — Plan (2026-06-27)

Operator mandate: AI templates must be AMAZING for every industry, and the
generator should build the ENTIRE template from one OR multiple prompts — best in
the industry, cutting-edge.

Recon workflow `wf_863ea41b-794` (7 agents, 870K tokens). Full findings:
`/private/tmp/.../tasks/wh3sytv6o.output`.

## Diagnosis (graded reality, not intent)
- **Architecture/quality: A-** — the art-director engine (LLM emits ArtDirectorSpec only; `@cms/signage-design` owns geometry/type/color/WCAG) is ahead of every dedicated signage competitor on per-board layout quality.
- **Per-vertical correctness: D — luck, not design.** The vertical steers ONLY copy tone (`VERTICAL_VOICE`); it NEVER biases archetype or theme. A gym promo, a worship verse, and a corporate KPI board all roll the same dice and routinely fall back to cold `clean-corporate` navy. Suggestion chips ARE vertical-aware (good), but the generation engine behind them is vertical-blind on layout/theme.
- **Multi-prompt / full-template: unbuilt.** One prompt → exactly ONE board; the "3 candidates" are Balanced/Bold/Detailed variants of the SAME board (pick-a-winner), not a coordinated set. Scenes exist but only advance on touch (no passive auto-advance); PlaylistItem is asset-only (no template rotation container).
- **Voice coverage: 12/12 verticals** have differentiated clauses with the right guardrails (BAR 21+, HEALTHCARE never-alarmist, WORSHIP never-commercial, SPORTS no-trash-talk). Holes: the `venue` no-vertical fallback has NO clause (lands on new/unconfigured tenants); legacy `FITNESS` alias isn't normalized; RETAIL/CORPORATE clauses are the two thinnest.

## Per-vertical affinity (the deterministic spine to add)
| Vertical | Ideal archetypes | Ideal theme(s) |
|---|---|---|
| GYM (alias FITNESS) | stat-spotlight, hero-fullbleed, title-cta, split-50 | fresh-fitness, neon-sports |
| RETAIL | poster-promo, hero-fullbleed, three-up-grid | bold-retail, minimal-luxury |
| CORPORATE | split-50, stat-spotlight, title-cta | clean-corporate, minimal-luxury |
| QSR | menu-list, poster-promo, title-cta | qsr-appetite, bold-retail |
| FASHION | poster-promo, hero-fullbleed, quote-spotlight | minimal-luxury, bold-retail |
| BAR | poster-promo, lower-third-banner, title-cta | bold-retail, neon-sports (add nightlife theme later) |
| HEALTHCARE | three-up-grid, title-cta, split-50 | calm-clinic, sky-civic |
| HOSPITALITY | hero-fullbleed, split-50, title-cta | minimal-luxury, worship-warm |
| RESTAURANT | menu-list, hero-fullbleed, split-50 | minimal-luxury, qsr-appetite (add warm full-service later) |
| SPORTS | stat-spotlight, hero-fullbleed, lower-third-banner | neon-sports |
| WORSHIP | quote-spotlight, title-cta, three-up-grid | worship-warm |
| EDU/K-12 | title-cta, three-up-grid, stat-spotlight | warm-school, sky-civic |
| VENUE (fallback) | title-cta, hero-fullbleed | clean-corporate |

## Multi-prompt full-template (Stage A — smallest clean change, NO schema migration)
`generateSignageTemplateSet(promptOrPrompts, count)`: one planner LLM call → a `SetPlan` = `{ sharedThemeId, briefs[] }` (multi-line/multi-chip input skips planning, one brief per line); fan out N `buildSignageBoardCore` calls with a `forcedTheme` so every board shares one theme + the tenant brand; persist as ONE template with N **scenes** (the mapper already tags `sceneRef`; `persistGeneratedTemplate` already creates `template_scenes`). The only new render code: a passive scene-advance timer in the player gated on `!isTouch && scenes.length>1`. One editable template that plays itself, reusing the entire existing render path. FE: a third "Build a set" mode + a "Starter set for your {vertical}" one-click + a filmstrip with "Create the set". (Stage B later: additive `PlaylistItem.templateId` → true prompt-to-playlist.)

## Build order
**Phase 1 — per-vertical excellence (additive, low-risk):**
1. (S) VENUE voice clause + `normalizeVertical()` in `prependVoices` + RETAIL/CORPORATE voice rewrites.
2. (M) `VERTICAL_DESIGN_AFFINITY` map in `verticals.ts`.
3. (M) Inject affinity as a prompt hint in `buildSignageBoardCore` AND change the garbage-fallback from `hero-fullbleed`/`clean-corporate` to the vertical's first affinity archetype+theme (failure mode = on-brand, never cold navy).
4. (S) Inline theme-mood descriptions in `ART_DIRECTOR_SYSTEM_PROMPT`.
5. (S) FE: non-destructive multi-select chips + per-vertical Touch/Display default.
6. (M) Vertical-aware `SIGNAGE_CANDIDATE_DIRECTIVES` (derive 3 takes from affinity).

**Phase 2 — full-template-from-prompts (Stage A):** 7. `generateSignageTemplateSet` + passive scene auto-advance + endpoint + FE "Build a set" mode. 8. "Starter set for your {vertical}" + filmstrip.

**Phase 3 — parity stretch (ranked):** chat-to-edit (delta-prompt refine), auto-translate, live-data slot (clock/weather/countdown archetypes), variable-length menu-list + N-up grid, vertical-native archetypes (lookbook/now-serving/giving-thermometer), brand-from-URL into the AI modal, magic-resize as a product action, AI product imagery, AI→POS/score binding, Stage B prompt-to-playlist.

Files: `apps/api/src/ai/ai.service.ts`, `apps/api/src/ai/art-director.ts`, `packages/api-types/src/verticals.ts`, `packages/signage-design/src/{archetypes,themes,types}.ts`, `apps/api/src/templates/templates.controller.ts`, `apps/web/src/app/[schoolId]/templates/page.tsx`, `apps/web/src/app/player/page.tsx`.
