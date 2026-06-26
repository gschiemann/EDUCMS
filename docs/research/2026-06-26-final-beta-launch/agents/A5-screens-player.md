# A5 — Screens Management + Player Render (S1)

**Agent:** Wave A / A5
**Date:** 2026-06-26
**Surface:** `/[schoolId]/screens` (dashboard management) + `/player` (kiosk render route) + the screen lifecycle API (`/screens/register`, `/screens/pair`, `/screens/:id`, `/screens/:id/manifest`, `/screens/:id/orientation`, `/screens/:id/canvas`, `/screens/:id/force-update`, `/screens/:id/refresh-web`, `/player/latest-version`, `/screen-groups`).
**Scale tier:** Desktop 1440×900 (primary) + a real-browser pairing/preview kiosk at 1280×720; mobile 390px smoke via authed-runner. Tested on **Chromium AND WebKit/Safari** (CLAUDE.md cross-browser rule).
**Target:** LIVE PROD — web `https://venue-os.app`, API `https://api-production-39a1.up.railway.app/api/v1`.
**Isolation:** Self-provisioned throwaway tenant `beta-a5-668614719` (K12 vertical, admin `beta+a5-668614719@venue-os.app`). Greg's Dodgers tenant + physical LED never touched. All pairing/settings/schedule mutations on my own tenant only.

---

## What I did (step by step, all on the isolated tenant)

1. **Health check** — `GET /health` → 200, `db:ok redis:ok`, commit `cfc44bff`.
2. **Provisioned** my own tenant via `POST /signup` (auto-login JWT, DISTRICT_ADMIN).
3. **Device register** — simulated a kiosk: `POST /screens/register {deviceFingerprint, resolution:1920x1080, osInfo:Android 11, browserInfo:Chrome/87}` → 200, returned 6-char **pairing code `STPL4P`** + a device JWT (15-min TTL for unpaired).
4. **Pair** — `POST /screens/pair {pairingCode:STPL4P, name:"Lobby LED"}` → 200; screen flipped to `status: ONLINE`, `pairedAt` set, name persisted.
5. **Settings persistence** — exercised every per-screen setting and re-fetched to confirm it stuck:
   - Orientation → `PUT /:id/orientation {PORTRAIT}` → 200, persisted.
   - LED canvas → `PUT /:id/canvas {canvasW:960,canvasH:1080}` (3-panel) → 200, persisted.
   - Rename → `PUT /:id {name:"Main Lobby Wall"}` → 200, persisted.
   - Hardware model → `PUT /:id {hardwareModel:"novastar-taurus"}` → 200, persisted (invalid value `taurus-tb60` correctly **400'd with a clean error envelope** listing valid SKUs).
   - Console profile → `PUT /:id {config:{consoleProfile:"cts-gen6"}}` (nested, matching the real hook) → 200, persisted.
   - Group create + assign → `POST /screen-groups` then `PUT /:id {screenGroupId}` → 200, persisted.
6. **OTA / refresh** — `POST /:id/force-update` → 201 `{ok:true,corrId}`; `POST /:id/refresh-web` → 201 `{ok:true,corrId}`; `GET /player/latest-version` → 200 `{versionName:"1.0.74",versionCode:10074,source:"github"}`.
7. **Manifest (the player's source of truth)** — fetched with BOTH the device JWT and the operator JWT (both 200). Compared empty vs populated paths.
8. **Player render (real browser, Chromium + WebKit):**
   - Preview mode (`/player?deviceId=<fp>&preview=1&orientation=landscape#t=<jwt>`) → rendered "**Screen Paired Successfully — Waiting for a schedule**", correct screen name, PREVIEW MODE chip, full info card (storage/cache/activity/web-build/Chromium ver), control row (Unpair/Sync/Exit/Auto-Play). Token hash **wiped from URL** (`hashWiped:true`). No hang, no refresh loop.
   - Fresh device (`/player?deviceId=<new-fp>`) → rendered the full **pairing/activation splash** with a readable code (`T2ZWXG` chromium / `B4AN5B` webkit), QR-to-pair, orientation picker, "Waiting for pairing", diagnostic footer.
9. **Dashboard UX captures** — empty-state Screens page (3-step connect wizard + prefilled player URL + Copy URL), populated list, per-screen gear settings menu, Pair-a-Screen modal. Desktop + mobile (390px) authed-runner: both 0 console errors / 0 net failures.
10. **Created a playlist + active schedule** on the screen, re-fetched the manifest to prove the populated path differs from the empty path (the LED-fit finding).

Evidence (screenshots) in scratchpad `…/scratchpad/a5shots/` and `/tmp/beta-authed-screens-chromium-*/`.

---

## Findings

| # | Sev | Area | What | Repro | Evidence |
|---|-----|------|------|-------|----------|
| 1 | **P2** | Player / manifest (LED) | **Empty manifest (NO_SCHEDULE) omits `canvasW/canvasH/orientation/repeats/hardwareModel`.** The emergency, scoreboard, and normal-playlist branches all carry these; the empty branch does not. A paired LED poster (e.g. 960×1080 water-polo wall) with no scheduled playlist yet — or one that loses its schedule — won't get its LED canvas at runtime via the manifest, so the "waiting for playlist" splash renders at device resolution instead of the LED canvas. Same class the team explicitly fixed for the emergency branch ("an alert that doesn't fit is unseen", 2026-06-25). Mitigated by a localStorage canvas fallback from a *prior* populated manifest, so it mainly bites a never-scheduled fresh LED. | Empty: `GET /screens/:id/manifest` on a paired screen with no schedule → keys `screenId,tenantId,tenantName,playlists,isEmergency,emergencyStatus,emptyReason,message,hash` (no canvas/orientation). Populated (after scheduling): keys include `orientation,canvasW:960,canvasH:1080,repeats,hardwareModel,consoleProfile`. | `screens.controller.ts:3030-3043` (empty return) vs `:2886-2895` (emergency) / `:2929-2939` (scoreboard) / `:3050+` (normal). Live: `a5-api-suite.mjs` output + the playlist/schedule re-fetch. |
| 2 | **P2** | Player (preview UX) | In **preview mode** the honest "Real-time disabled — kiosk needs re-pairing / no signed device token" toast (bottom-right) **overlaps the control-bar buttons**, clipping "Auto-Play" to "Auto-Pla". The message itself is correct & honest for preview (admin JWT, no device token); only the layout overlap is the issue. Preview-only, not on a real kiosk. | Open `/player?deviceId=<fp>&preview=1#t=<jwt>` at 1440×900 → toast sits over the Unpair/Sync/Exit/Auto-Play row. | Screenshot `a5shots/chromium-04-player-preview-initial.png` (toast over buttons). |
| 3 | **P2** | Player (cross-browser console) | A **React #418 hydration error** (`Minified React error #418 …args[]=text`) fires once on the player route in BOTH Chromium and WebKit. Render is **not broken** (full content shows in both engines) — it's an SSR/CSR text mismatch, almost certainly the live "Last sync HH:MM:SS" / clock text in the paired-info card. Benign but it's console noise on a customer-facing surface and a potential Sentry false-alarm on the player. | Load `/player?deviceId=<fp>&preview=1` → `pageerror: React error #418` in console; page renders fine. Reproduced in chromium + webkit. | `a5shots/report-chromium.json` & `report-webkit.json` `consoleErrors[0]`. |
| 4 | **P3** | Player (auth noise) | Player route's global layout fires `GET /branding/me` **unauthenticated** in preview → **401** + `[api] Request failed … Unauthorized`. Branding falls back to defaults so nothing breaks visually, but it's a guaranteed-failing request on every player load. | Load any `/player?...` → Network shows `401 /api/v1/branding/me`. | `a5shots/report-*.json` `consoleErrors` (401 branding/me). |
| 5 | **P3** | Screens settings menu (honesty) | Gear menu footer reads "**More coming soon — restart, orientation, cache clear**" even though **orientation is already implemented and present** in the same menu (the LED-canvas + orientation pickers are right above it). Stale placeholder copy promising a shipped feature as "coming soon". | Open any screen's gear → scroll to footer. | `a5shots/desktop-02-gear-menu.png` + `screens/page.tsx:1287`. |

No P0/P1 found. Pairing, settings persistence, OTA push, manifest, and player render all work end-to-end on live prod.

---

## Things that work well (verified live)

- **Pairing lifecycle** register → code → pair → ONLINE is solid; pairing-code collision guard + unpaired-token 15-min TTL are real.
- **Every screen setting persists** (orientation, LED canvas 1-6 panels, rename, hardware model, console profile, group) and the gear menu **reflects server state** (showed PORTRAIT + 3-panel selected after my API writes).
- **Player preview** is the documented "keeps refreshing" fix working: hash-token handoff, hash wiped after read, no loop, PREVIEW MODE chip.
- **Pairing splash** is polished and operator-friendly (big code tiles, QR, orientation picker, diagnostics).
- **Empty-state Screens page** is genuinely best-in-class onboarding (3-step connect wizard + prefilled player URL + Copy URL).
- **NOT the "million buttons" Greg dislikes** — the header is 4 controls (List/Map/Floor toggle + Pair + New Group). The gear menu is dense but cleanly sectioned (Player Version → Push → Refresh → Preview → Fingerprint → Diagnostics → Hardware), fits on-screen (610px in a 900px viewport, scrolls internally), portal-anchored so it can't be clipped.
- **Error envelopes** are clean (invalid hardwareModel → 400 with `code` + valid-values list).
- **Cross-browser:** player preview + pairing splash render correctly in WebKit/Safari, not just Chromium.

---

## Coverage gaps + why

- **Real Taurus LED hardware** — could not test the actual 960×1080 LED glass (Greg's physical wall is off-limits per rules). The LED-fit finding (#1) is verified at the manifest/API layer + the player's canvas-apply code path, not on real hardware.
- **Real Android APK OTA install** — `force-update`/`refresh-web` were verified to enqueue (201 + corrId + signed-WS path) but no physical kiosk consumed them, so the install-completion + version-bump loop wasn't observed end-to-end (no device in my isolated tenant).
- **WS realtime convergence timing** — verified the API accepts orientation/canvas changes and the manifest carries them; the ~150ms WS / ~10s poll convergence to a live device wasn't measured (no live device).
- **Floor-plan + Map views** of the Screens page — out of A5 scope (focus was list + settings + player); only the List view was driven.
- **`gear menu → open` interaction in Playwright via authed-runner** redirected to /login on my hand-written script (auth-seed timing); I worked around it by navigating dashboard-first (matching the proven runner) in `_a5-settings-menu.mjs`, which then captured the menu successfully.

---

## Grades

- **Design: A−** — Clean, modern, branded. Empty-state onboarding, pairing splash, and pair modal are excellent. Minor: preview toast overlaps controls (#2).
- **UX: A−** — Non-IT operator can pair a screen in well under 30s via the 3-step wizard + modal. Gear menu is dense but organized and on-screen. Minor: stale "coming soon" copy for a shipped feature (#5).
- **Functionality: A−** — Full pairing lifecycle, every setting persists and round-trips to the manifest, OTA/refresh enqueue, player renders all states (pairing/connecting/paired-waiting) in both engines with no hang or loop. Held back from A by the empty-manifest LED-canvas omission (#1) and the player #418 hydration noise (#3).

**Overall: A−.** This is a launch-ready surface. The one finding worth fixing before relying on it for a fresh LED install is #1 (carry canvas/orientation on the empty manifest, matching the emergency/scoreboard branches).
