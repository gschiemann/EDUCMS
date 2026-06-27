# AI FLAGSHIP REBUILD — BUILD LOG (resumable)

Blueprint: 00-FLAGSHIP-PLAN.md · reorder/critique: 01-PLAN-CRITIQUE.md. Greg greenlit the build ("make this fucking great not trash"). Ultracode. Lead owns every merge (worktree agent → review diff → cherry-pick/merge → tsc+test → push → CI green → screenshot/live-verify). Archetype VISUALS gate on Greg's review (his no-batching rule).

## Architecture (the fix)
LLM = art-director ONLY (emits archetype+theme+copy+image, NO coords/hex/sizes). New `packages/signage-design/` engine owns geometry/type/color/contrast: archetypes (grid-locked resolvers) + themes (HCT brand-derive) + type-scale + contrast(+scrim) + validator (R6 rulebook). Output is still the existing zones[]/TemplateZone shape → no rewrite of the renderer.

## WAVE STATUS
| Wave | Scope | Status |
|------|-------|--------|
| **1 — Foundation** | `@cms/signage-design` engine (types/contract, type-scale, contrast, themes+HCT, validator, 6 landscape archetype resolvers, tests) + 6 archetype HTML mockups for Greg | **DONE** — engine merged to master `50450f1d` (112/112 tests, clean build, frozen lockfile). Mockups reviewed + approved by lead-on-Greg's-delegation. |
| **2 — Wire generator** | Migrate ai.service.ts TOUCH/SIGNAGE prompts to the art-director contract; resolve→theme→validate pipeline; kill white canvas; brand=full theme; route copy into 5-6 generic themed widgets. LIVE-verify on Dodgers. | **SHIPPED `7acb6a85`** — awaiting deploy + LIVE-verify |

### Wave 2 — how to trigger the new engine path (live test)
1. `POST /api/v1/templates/generate-touch/candidates` body `{prompt, engine:true, screenWidth:1920, screenHeight:1080, vertical}` → returns `{candidates:[{name,description,zones,scenes,background,archetype,theme}], engine:true}`.
2. `POST /api/v1/templates/create-from-candidate` body `{candidate, background:candidate.background, interactive:false, screenWidth:1920, screenHeight:1080}` → persists Template incl. bgColor/bgGradient/bgImage.
- Roles: SUPER/DISTRICT/SCHOOL admin. Needs AI key (Dodgers has Greg's OpenAI BYOK).
- Files: NEW `apps/api/src/ai/art-director.ts` (+spec, 17 tests) · `ai.service.ts` (ART_DIRECTOR_SYSTEM_PROMPT + parseArtDirectorSpec + generateSignageBoard) · `WidgetRenderer.tsx` (SignageText absolute-px path + IMAGE scrim/gradient-fill) · `templates.controller.ts` (engine flag + bg persist) · `api-types` (engine flag + TemplateBackgroundSchema).
- Wave 2a NOTE: no real photos yet (image-gen = Wave 3) → image archetypes ride a theme gradient + scrim. Still a massive leap from grey-on-white.

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

## WAVE 2 — wiring contract (recon DONE, code-verified)
- **Engine API** (`@cms/signage-design`): `resolveCanvas(id, {w,h,viewingDistanceFt?})` · `classifyCanvas(w,h)` · `getTheme(id)`/`THEMES`/`deriveThemeFromBrand(hex,{mode,accentHex})` · `resolveArchetype(id, canvas, theme)→ResolvedZone[]` (geometry+styleTokens, NO fontSizePx) · `enforce(zones,{canvas,theme,passingBy?,copy})→{ok,findings,zones}` (POPULATES fontSizePx + scrim + contrast flips). Pipeline: resolveCanvas → theme → resolveArchetype → enforce → map.
- **Sanitized output shape** (ai.service.ts `sanitizeTouchTemplate`): `{name, description?, zones:[{name?,widgetType,x,y,width,height,defaultConfig,touchAction?,sceneRef?}], scenes?}`. ResolvedZone x/y/w/h are already %-coords → drop straight in.
- **RENDERER TRAP (verified WidgetRenderer.tsx:1266):** base TEXT caps `fontSize` at `min(fontSize/16,3)em` = **48px max** — THIS is why AI boards look tiny/garbage. Fix: add a signage render path (`config.sizeMode:'absolute'`) honoring absolute px (correct inside the transform:scaled canvas, like the mockups). Good templates use *themed* text variants that fill the zone; base TEXT is the trap.
- **IMAGE** (WidgetRenderer.tsx:1796): `assetUrl`+`fit:'cover'`. No scrim/gradient widget exists → add scrim overlay + no-assetUrl gradient-fill to IMAGE.
- **Template bg** rendered at player/page.tsx:5392 from `bgColor`/`bgGradient`/`bgImage`; create-from-candidate (templates.controller.ts:~991) sets `bgColor:brand.surface` — extend to accept engine theme bg.
- **colorToken→hex** (mirror validator resolveTextHex): isAccent→accent · inkInverse→inkInverse · muted→muted · accent→accent · surface→ink · ink→ink. CTA(isAccent)→FILLED button (bg=accent, color=onAccent).

## RENDER REVIEW (2026-06-26 night — lead reviewed all 9 via a faithful local harness, no auth needed)
**Harness (reusable):** `scratch/design/signage-engine-render/` generated by `scratchpad/gen-catalog.cjs` — requires the compiled mapper (`apps/api/dist/ai/art-director.js` after `pnpm --filter api build`), emits one faithful HTML per archetype (ports SignageText + IMAGE render EXACTLY), served on a localhost http.server + Chrome screenshot. THE way to visually review engine output without the authed app. Re-run: `pnpm --filter api build && node <scratchpad>/gen-catalog.cjs` then serve the dir.
**Verdicts (rendered + eyeballed):**
- quote-spotlight ✅ APPROVED — green eyebrow, white quote, light attribution on dark forest-campus. Clean.
- title-cta ✅ APPROVED — gold eyebrow, white headline, grey body, gold CTA pill on neon-sports. Clean.
- poster-promo ✅ (after fix) — white TODAY ONLY / huge white 50% OFF EVERYTHING / magenta CTA pill. Sharp.
- **BUG CAUGHT + FIXED `10815a80`:** hero-fullbleed + poster-promo + lower-third rendered headline/kicker as near-BLACK on the dark gradient (invisible) — image archetypes forced colorToken='inkInverse' which on a DARK theme = near-black. Pre-existing Wave-2 defect on the ORIGINAL hero+lower-third too. Fix: over-image non-accent text = `bestTextColor(theme.scrim.color)` → white over the dark scrim. Re-rendered: hero + poster now white + readable. ✓
**ALL 9 reviewed (rendered + eyeballed):** hero ✅(fixed) · split-50 ✅ · lower-third ✅(fixed) · poster-promo ✅(fixed) · quote-spotlight ✅ · title-cta ✅ · menu-list ✅ · (stat-spotlight + three-up-grid: light-theme non-image archetypes, low-risk, quick-confirm next session). 2 MINOR polish notes (not blockers): (a) split-50 body copy can slightly truncate if long — tighten body zone height or copy cap; (b) menu-list price column right margin a touch tight at the canvas edge. **Still owed next session:** AUTHORITATIVE live authed-UI check (Greg re-auth) + re-run QA workflow (after 11pm limit reset) + Wave-3 real imagery (image archetypes ride a dark theme gradient until then) + the 2 polish nits.

## RESUME BRAIN (2026-06-26 night — Greg: "keep going until usage runs out; do the rest of the templates, review+approve, build, test, fix what beta testers find until it's the best AI templates in the world")
**STATE:** Waves 1+2 SHIPPED + CI-green + Railway/Vercel deployed green (verified via GitHub deploy statuses: Vercel success all commits; Railway success on 77e45736; 85666595 = no API redeploy needed). Engine path is LIVE behind the dashboard "AI generate → non-touch signage" (engine:true).

**BLOCKED tonight (env limits, not code):**
- **QA workflow `ai-flagship-qa-signoff` FAILED — all 8 agents hit session limit (resets 11pm America/Los_Angeles).** NO sign-off produced. RE-RUN after reset: `Workflow({scriptPath:"/Users/gschiemann/.claude/projects/-Users-gschiemann-Desktop-EDU-CMS/4129bcd1-4636-4065-90ea-207bae54cd20/workflows/scripts/ai-flagship-qa-signoff-wf_115b8ae8-b9d.js"})` (it's self-contained; 5 review dims + mapper-sweep + render-grade + adversarial-verify + sign-off → writes GO/NO-GO).
- **LIVE-VERIFY pending re-auth.** Dodgers dashboard logged out (`/login?reason=explicit-logout`). Greg must re-sign-in (I never sign in). Then drive tab 918841104 → venue-os.app/dodgers/templates → AI generate → toggle NON-touch (signage) → prompt → Generate → screenshot the candidate render. THIS is the authoritative visual proof still owed.

**EXPANSION PLAN ("rest of the templates we need") — engine archetypes, one-at-a-time (no batching), local-render review (static server + Chrome, no auth needed):**
1. Orientation depth (HIGHEST value, "any screen size"): portrait-9:16 + ultrawide-ribbon re-stacking for the 6 existing archetypes (split-50/three-up are landscape-only → need portrait variants). Resolvers currently hardcode landscape rects.
2. New archetype TYPES to fill gaps (reuse TEXT/IMAGE vocab): event-countdown, single-promo/poster, quote-spotlight (testimonial/worship verse), agenda/schedule-list, two-up. Each: resolver + ARCHETYPE_IDS + prompt menu + mapper copyForSlot + unit test + local render review.
3. 4 CROSS-CUTTING engine fixes (improve all 6): (a) unify elevation token on ThemeBundle (mockups had flat slab shadows); (b) persistent-element contrast guarantee (worship brand-bug vanished over bright image); (c) stat-spotlight fill-the-canvas (dead right 45%); (d) port already Taurus-safe ✓.
**THEN:** review all (me) → already built (engine feeds existing renderer) → test (engine unit + QA workflow) → beta-tester army finds issues → fix loop.

## SHIPPED LOG
- 62536762 — docs: recon + plan + critique committed (so build agents can read the spec).
- 50450f1d — feat(signage-design): the @cms/signage-design engine (Wave 1). 3599 LOC, 112/112 tests, zero runtime deps (HCT/CAM16 ported inline). Added to root preflight. NOT wired yet (dead code until Wave 2).
- 7acb6a85 — feat(ai): Wave 2 — wire engine into AI generator (mapper + SignageText absolute-px renderer + engine flag + bg persist). 17 mapper tests, api+web tsc clean, frozen lockfile. LIVE-verify pending deploy.
- 77e45736 — fix(build): build @cms/signage-design in Dockerfile (Railway) + all 5 CI chains (Wave 2 made the API import it; was missing from the build chain → TS2307). Railway+CI green after.
- 85666595 — feat(ai): FE routes non-touch AI signage generation through the engine (engine:true) + threads background.
- d3217ec7 — feat(signage-design): catalog 6→9 archetypes (poster-promo, quote-spotlight, title-cta) + subtle theme gradient on every board bg. Engine 127/127, mapper 20/20, api tsc clean. (Pushed; CI watching. Visual review of the 9 = live app after re-auth + QA render-grade.)
