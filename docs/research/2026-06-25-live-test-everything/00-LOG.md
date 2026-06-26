# Live Test-Everything Campaign — 2026-06-25

Operator: "open to test everything, go until we run out of usage, use as many resources and agents as you want." Ultracode ON. Testing the LIVE prod server (venue-os.app / api-production-39a1.up.railway.app). No real customers yet → aggressive testing authorized. Guardrails: emergency/destructive flows ONLY on isolated throwaway tenants (never the operator's water-polo LED wall); no password entry; no finalizing the live game.

## Harnesses built (apps/web/scripts/beta/)
- `persona-runner.mjs` — public black-box (signup/login) ×3 browsers. Pre-existing.
- `authed-runner.mjs` — NEW. Self-provisions an isolated tenant via `POST /signup` (no email gate), seeds web auth (`edu_cms_token` in local+sessionStorage per ui-store.ts) + API session cookie, navigates straight to dashboard, walks every logged-in surface, screenshots + console + 5xx capture. Usage: `node scripts/beta/authed-runner.mjs <all|surface,list> <chromium|webkit|firefox>`. (`_rsc` prefetch-abort noise filtered; error-regex no longer false-matches "500 MB".)
- `flows-runner.mjs` — NEW. Deep/destructive backend flows on an isolated tenant. `emergency` flow = trigger(lockdown)→all-clear via API.

## Auth contract (for seeding)
- Login `POST /api/v1/auth/login` `{email,password,rememberMe}` → `{access_token, user:{tenantSlug,tenantId,role,...}}`.
- Web stores `edu_cms_token`+`edu_cms_user` (sessionStorage; +localStorage & `edu_cms_remember='1'` if remember). use-api attaches `Authorization: Bearer` + `credentials:'include'`. CSRF skipped when Bearer present; login/signup CSRF-exempt.
- Signup `POST /api/v1/signup` `{districtName, slug?, adminEmail, password, vertical?, firstName?, lastName?, phone?}` → same `{access_token,user}`. First user role = DISTRICT_ADMIN. No email gate.
- Dashboard route `/{tenantSlug}/dashboard`. Verticals incl. SPORTS (enables Sports menu).
- Emergency `POST /api/v1/emergency/trigger` `{scopeType:'tenant', scopeId:<tenantId>, overridePayload:{type, severity?, textBlob?, expiresAt?}}`; type enum is LOWERCASE `lockdown|weather|evacuate|hold|secure|medical`; severity `LOW|MODERATE|HIGH|CRITICAL` (default CRITICAL). all-clear `POST /api/v1/emergency/:overrideId/all-clear` `{scopeType,scopeId}`.

## VERIFIED so far (main loop)
- **Authed full-app render (chromium):** fresh-tenant walk PASSED — dashboard, screens, assets (Media Library + upload/drag-drop/empty-state), playlists, templates, sports (SPORTS vertical), settings, settings/ai (real provider picker: Anthropic/OpenAI/Google + models + prices). Zero console errors. Screenshot-confirmed assets page.
- **Emergency end-to-end (isolated tenant a50960d5…):** trigger 201 → overrideId; all-clear 201. DB: `audit_logs` has TENANT_SIGNUP + TRIGGER_EMERGENCY(LOCKDOWN/CRITICAL/overrideId) + CLEAR_EMERGENCY(same overrideId); tenant `emergency_status` LOCKDOWN→INACTIVE. Signup itself is audited too.
- **Physical LED (earlier today, webcam):** push→verify→revert proven; LED-fit fixed on 960×1080 glass. See [[project_player_verification_webcam_2026_06_25]].

## Findings so far
- **P2 — generic emergency 400 envelope:** `POST /emergency/trigger` with an invalid field returns `{error:true, code:"ValidationError", message:"Bad Request Exception"}` — no field-level detail. Load-bearing endpoint; an integrator/operator can't tell WHAT was wrong. Ties to task #57 (error-envelope discipline). ZodValidationPipe should surface the failing path.
- **WATCH — console score-tap latency:** earlier, the run-console score digit didn't visibly update within ~1s of a tap (both taps registered). Screenshot timing vs optimistic-update lag — re-check.

## VERIFIED — Wave 2a (cross-engine authed render) — CLEAN
All 8 logged-in surfaces (dashboard, screens, assets, playlists, templates, sports, settings, ai) render correctly + completely on **chromium, webkit, AND firefox** — zero console errors, zero net failures, **crossEngineBugs:[] universalBugs:[]**. Agents screenshot-confirmed: New Playlist wizard opens centered with NO React #310 / NO PDF-toolbar bleed; scoreboard template thumbnails render LIVE countdowns in WebKit (the classic blank-tile spot) — all previously-fixed bugs stay fixed. Fresh-tenant empty states are correct everywhere.

## VERIFIED — content pipeline (flows-runner `content`, isolated tenant 27fb2753…)
asset URL add (201) → playlist create (201) → screen-group create (201) → **schedule create with `screenGroupId` SET (201)**. The backend FULLY SUPPORTS group-scoped scheduling.
- **Diagnostic for the 1-of-3-posters bug:** since a group schedule persists fine via API, the bug is in the PUBLISH UI flow (it creates per-SCREEN schedules, never a group one) — a UI-layer fix, backend already supports it. Confirms the earlier diagnosis in [[project_led_fit_and_multiscreen_2026_06_24]].

## Waves in flight (background)
- Wave 1 `wg8dz7kt1` — ~16-surface reality audit (code path + live API + DB + costume detection, D/UX/F lenses) + signup black-box ×3 browsers → ranked P0/P1/P2.
- Wave 2a `w6lzz9vn2` — authed full-app walk ×3 engines with per-screenshot QA → cross-engine bug list.

## FIXES SHIPPED (test→fix→re-test, all CI-watched)
- **`63904cc` content-delivery cluster (CI GREEN, all 10):** (1) New Playlist wizard creates ONE group-scoped schedule per picked group (manifest fans out to all members) — Greg's 1-of-3-posters bug; (2) windowed schedules now `isActive:true` (were saved inactive → never played); (3) cross-location child assets `status:PUBLISHED` (was orphan `APPROVED` → never served). Forward-only; existing schedules/board untouched. Files: PlaylistCreateWizard.tsx + playlist-distribution.service.ts.
- **`ca687d1` mobile Sports header wrap (CI watch):** Game Day header stacks below sm so "+ New game" never clips at the 390px edge (mobile audit P1). sports/page.tsx.
- **`eea2493` emergency message-clear (CI watch):** `POST /emergency/messages/:id/all-clear` now signs `ALL_CLEAR_MESSAGE` (player's pushed-overlay clear handler) instead of bare `ALL_CLEAR` (manifest-refetch-only). OVERRIDE/lockdown clears untouched. Life-safety P0. emergency.controller.ts.

## REMAINING (code) — careful batch next
- **Rate-limit P0:** `@Throttle` decorators are correct; the real gap is in-memory throttler storage across multiple Railway replicas (audit P1). Needs Redis-backed `ThrottlerStorage` (dependency add + wiring) to truly enforce. Not a quick decorator tweak.
- **Stripe webhook P0:** global `express.json()` (main.ts:80-81) shadows Nest rawBody → webhook 400s. Body-parser surgery (exempt the webhook path); medium risk, verify other endpoints unaffected.
- **Emergency backstop (P0 #2):** even with the WS fix, a missed clear has no reconciliation — manifest doesn't carry pushed-message state + EmergencyOverlay self-poll disabled while message present. Follow-on to the WS fix.
- **P1s:** logout doesn't revoke JWT; SAML/POS/Clever costumes (503 on click — flip to COMING_SOON or wire creds); Firefox signup spinner; player React #418 hydration; emergency manifest drops LED canvas; sports auto-leaders stat-key mismatch; Report-bug FAB occlusion (mobile polish).

## CONFIG (only Greg — not code)
- **Rotate `JWT_SECRET`/`SESSION_SECRET`** on Railway to 64-char hex (URGENT — guessable secret = forge any session incl. SUPER_ADMIN).
- **Stripe live keys** (prod on `sk_test_…` → no real money).
- **Platform `ANTHROPIC_API_KEY`** in prod (every AI feature dark until set).

## Next
- Triage Wave 1 + 2a when they land → fix P0s → re-run affected personas.
- Wave 2b: extend harness with create-flows (add-URL asset, create playlist via wizard, create sports game, branding scrape) + run on 3 engines.
- Multi-screen publish bug (1-of-3 posters): testable live via webcam once operator OKs changing the posters.
