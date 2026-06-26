# Wave B5 — Kiosk scene runtime

**Surface tested:** Touch-kiosk + multi-scene runtime — the architecture the AI template-gen produced live (home scene + GOTO-SCENE-wired destination scenes). Both the **React-zone scene runtime** (TemplateScene + per-zone `sceneId` + `goto-scene` action) AND the **EXTERNAL_HTML kiosk** path (`public/templates/kiosk/*` + `_edit-shim.js`).
**Scale tier:** read-only code-trace + live-prod curl (web `venue-os.app`, API `api-production-39a1.up.railway.app`). No app run, no Playwright (would dirty the tree).
**Standard Audit Surface §§ covered:** §4 (AI feature surfaces — touch-template generation, the multi-scene synthesis path), §19 (Template + Widget Editability — kiosk click-to-edit + scene authoring), §20 (Design/UX/Functionality lenses), §15 (Cross-browser — Taurus-83 guards on the scene runtime, spot-checked).

## Verdict up front

**The player scene runtime is REAL, not a stub.** The full chain is wired and ships through the manifest: `goto-scene` action → `edu:touch-scene-change` CustomEvent → `setCurrentSceneId` → zone-render filter by `activeSceneId`. The v2 builder Scenes tab (New scene / star-default / Shared zones / per-zone assignment) round-trips to the DB and into the manifest. EXTERNAL_HTML kiosks self-navigate inside their sandboxed iframe and bridge wired buttons out to the player via `educms-action` → the same security-gated dispatcher. All kiosks pass the click-to-edit sweep; `educms-edit-mode` is correctly sent ONLY from the builder, never the player.

**BUT** the AI multi-scene template-gen path — the exact thing the lead verified live for the *home* scene — produces **destination scenes that are empty by construction**, and the player has **no empty-scene fallback** in its main render path. So an AI-built kiosk's "Check In / Wayfinding / Directory" buttons navigate to a **blank screen** with no Back affordance until the 60s idle timer fires. The home scene works; the places it sends you do not. That's the headline.

## Step-by-step what I did

1. Read `apps/web/src/components/player/TouchOverlay.tsx` — found `TouchOverlay` (overlay layer) + `TouchNavOverlay` (cross-template nav with a Back chip + a "Nothing to show here" empty fallback). Note its own comment: goto-scene is handled by the *host player*, not this overlay.
2. Grepped `apps/web/src/app/player/page.tsx` (384 KB) for scene logic. Traced the `goto-scene` dispatcher (line 303-314), the `edu:touch-scene-change` listener (line 4720-4726), the `currentSceneId` state (line 2265), and the scene-aware zone filter in the main template render (line 5306-5311). All real.
3. Traced the zone tap → action wiring (line 5411-5471): `zoneTouchAction = zone.touchAction` → `dispatchTouchAction(...)`. Confirmed `sceneTick` remounts widgets on idle-reset (line 4415-4435) and `currentSceneId` resets on template swap (line 4491-4493).
4. Verified the **API serialization** — the field-by-field bug class that bit this team repeatedly. The manifest endpoint (`screens.controller.ts` line 3097-3121) serializes per-zone `touchAction` + `sceneId`, plus template `isTouchEnabled`, `idleResetMs`, and `scenes[]`. The `:id/playback` endpoint (`templates.controller.ts` line 517-561) uses full `include` (zones + scenes). Both paths carry everything the runtime reads.
5. Read `ScenesPanel.tsx` (full CRUD), confirmed it mounts in `BuilderShell.tsx` (line 700, `panel === 'scenes'`), and that PropertiesPanel hosts the `goto-scene` action picker (line 1542-1607, 1706) + the per-zone `ZoneScenePicker` (line 1722-1755).
6. Checked the **EXTERNAL_HTML kiosk** path: read `kiosk/_edit-shim.js` (wraps `Kiosk._render` to re-apply overrides after every internal screen swap; freeze-mode for gallery thumbs). Confirmed the player bridges kiosk buttons via `educms-action` → `dispatchTouchAction` (page.tsx line 4470-4483).
7. **Live prod curl:** `school.html` 200, `_edit-shim.js` 200, HTML references the shim + has `data-action` + `data-field` hooks + an internal `Kiosk.go`/`_render` engine. API `/health` 200.
8. Ran the CLAUDE.md kiosk click-to-edit sweep over `public/templates/kiosk/*` → **0 un-editable boards**.
9. Searched schema + web + api for an **idle/attract template setting** → none exists (only "attract loop" *inside* the EXTERNAL_HTML kiosk JS, self-contained).
10. Traced the **AI multi-scene create path** (`templates.controller.ts createTemplateWithScenes` line 969-1071 + `ai.service.ts` sanitizer line 2387-2538) — found the empty-destination-scene defect.

## Findings table

| # | Sev | area | what | repro | evidence (file:line) |
|---|-----|------|------|-------|----------------------|
| 1 | **P1** | AI multi-scene gen | AI-emitted **per-zone scene assignment is silently dropped**; every zone is force-assigned to the **default scene**, so all non-default scenes the AI creates are **empty**. The builder shows N scenes (correct) but only scene 1 has content. | Generate a multi-scene kiosk via AI (home + Check-In + Wayfinding). Open builder Scenes tab → scene 2/3 show "0 zones". | `ai.service.ts:2514-2526` (sanitizer never copies `z.sceneId` into `zonesOut`, despite the shape declaring `sceneId?` at :2396 and the comment at :2523-2525 promising "the controller will resolve sceneId after scenes are created"); `templates.controller.ts:1060` hardcodes `sceneId: defaultSceneId` for **every** zone and never reads `z.sceneId`. Confirmed: the only `sceneId` in that loop is the hardcoded default. |
| 2 | **P1** | Player runtime | **No empty-scene fallback in the main player render.** When `goto-scene` navigates to a scene with zero zones, `zones.map()` renders nothing → blank background, **no Back chip**, visitor is stranded until the idle timer (default 60s) resets to the default scene. `TouchNavOverlay` has a "Nothing to show here" fallback for *cross-template* nav, but the *in-template scene switch* (the common case) has none. | Wire a button → goto-scene → an empty scene; tap it on the player. | `apps/web/src/app/player/page.tsx:5411` (`zones.map(...)` with no empty guard); contrast `TouchOverlay.tsx:399-412` (the fallback that exists only in the cross-template overlay). Grep: `grep -c "Nothing to show here" page.tsx` = **0**. Compounds with #1 — together they make the AI happy-path's destination buttons land on blank screens. |
| 3 | P2 | Idle/attract setting | **No platform-level idle/attract (screensaver) template setting** exists — neither on `Screen` nor `Template`. Idle behavior is "reset to default scene / dismiss overlay," not "switch to an attract template after N seconds." Task #243 ("Phase 4 — Player scene runtime + idle/attract template setting") is still `pending`; the scene-runtime half shipped, the attract-setting half did not. | Look for an attract/idle-template selector in screen or template settings. | `schema.prisma` Screen/Template/Tenant models — no `attractTemplateId`/idle-template field (only `idleResetMs` on Template, `isTouchEnabled`). Grep for `attract|idleTemplate|screensaver` across web+api+schema returns only EXTERNAL_HTML preset *descriptions* ("attract loop") which is internal kiosk JS, not a platform setting. |
| 4 | P2 | Manifest hygiene | Manifest ships the **raw Prisma scene rows** (`scenes: template.scenes`) rather than a `.map()` of safe fields, unlike zones which are explicitly mapped. Harmless today (TemplateScene has no sensitive columns), but it's the un-trimmed-payload pattern that caused the 2026-05-09 1-3 MB gallery perf bug, and it sidesteps the deliberate field-select discipline used everywhere else. | — | `screens.controller.ts:3119-3121` (`scenes: Array.isArray(...) ? template.scenes : []`, no field projection). |

## What I could NOT reach + why

- **End-to-end live player render of a scene tap.** I could not pair a device + drive the kiosk on real glass without running the app/Playwright (out of scope per ground rules, would dirty the tree). I traced every link of the chain in code + confirmed the serialization curl-side, but the final "finger-tap navigates pixels" was verified by code-path, not by eyeball. Findings #1/#2 are derived from the create-path + render-path code, which is unambiguous.
- **The live "Dodgers" tenant / any real game** — explicitly off-limits.
- **AI generation of a fresh multi-scene template against a real key** — the lead already verified the *home-scene* happy path live this session; I did not re-run it. Finding #1 is about the *destination* scenes that the live test's home scene did not exercise.

## Coverage summary

| Area | Status |
|---|---|
| `goto-scene` action handler (player) | **covered** — real, wired |
| Scene-change listener + zone filter | **covered** — real |
| Manifest serializes touchAction/sceneId/scenes/isTouchEnabled/idleResetMs | **covered** — all present |
| `:id/playback` (goto-template device fetch) serializes scenes | **covered** |
| Builder Scenes tab (New/star/Shared/per-zone assign) round-trip | **covered** — real CRUD, mounted |
| EXTERNAL_HTML kiosk edit-shim (apply + click + engine-render hook) | **covered** — wraps `Kiosk._render`, sweep clean |
| Kiosk wired-button → player bridge (`educms-action`) | **covered** — same dispatcher |
| `educms-edit-mode` never sent on live player | **covered** — only PropertiesPanel sends it |
| Empty destination scene renders gracefully | **GAP (P2 finding #2)** — blank, no Back |
| AI multi-scene zone→scene assignment | **GAP (P1 finding #1)** — all zones → default scene |
| Idle/attract template setting | **N-A / not built (P2 finding #3)** — Phase-4 task still pending |

## Grade (Greg's 3 lenses)

- **Design: A−** — `TouchNavOverlay` is well-considered (kiosk-distance Back chip, translate+scale centering, structured bg to defeat CSS injection, Taurus-83 `gap` avoidance). The empty-scene state is the one ungraceful surface.
- **UX: C+** — for hand-authored multi-scene templates the flow is solid. But the AI happy-path (the lead's north-star "AI almost makes the template itself") sends visitors to blank dead-ends, and the idle-attract loop a kiosk operator expects isn't a setting. A non-IT operator who AI-generates a kiosk gets buttons that visibly break.
- **Functionality: B−** — the runtime itself works end-to-end and the serialization is correct (no costume). Knocked down by the two P1s that converge specifically on the AI-generated multi-scene case, which is the case most likely to ship at beta.
