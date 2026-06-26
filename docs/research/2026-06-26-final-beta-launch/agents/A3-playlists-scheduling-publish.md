# A3 — Playlists + Scheduling + Publish (S1 core "get content on a screen" path)

**Date:** 2026-06-26
**Agent:** Wave A / A3
**Surface:** The core content-delivery path — New Playlist wizard (`PlaylistCreateWizard.tsx`), `POST /playlists`, `PUT /playlists/:id/items`, `PUT /playlists/:id/active`, `POST /schedules`, `PUT /schedules/:id/toggle`, the org-wide content-approval gate (`PUT /tenants/me/content-approval` + `schedules.controller` routing), and screen reachability via `GET /screens/:id/manifest`.
**Scale tier:** S1 — single operator, one tenant, one screen, one screen-group. Self-provisioned throwaway tenant on LIVE prod.
**Target:** https://venue-os.app · API https://api-production-39a1.up.railway.app/api/v1

## Method / what I did (live, on my own tenant — never touched Greg's Dodgers tenant)

Playwright browsers were not used; I drove the **real production API** end-to-end with self-provisioned auth (signup auto-logs-in) and read the repo for the "should" spec. All findings have a live repro or a source `file:line`.

Tenant: `A3 Publish Test ba85f59d` / slug `a3pub-ba85f59d` / admin `a3pub+ba85f59d@example.com` (DISTRICT_ADMIN). Scripts + raw JSON evidence in the session scratchpad: `run_publish.py`, `run_window.py`, `run_approval.py`, `run_log.json`, `window_log.json`, `approval_log.json`.

Step-by-step (all live, all 2xx unless noted):

1. **Signup** → tenant + JWT (`access_token`). Note: `vertical` must be a canonical value (`K12`, not `EDU`) — `EDU` returns `400 Invalid vertical.`
2. **Register a device** (`POST /screens/register`) → pairing code `7NPZKL` + device JWT.
3. **Create a screen group** (`POST /screen-groups`) → "Lobby Group".
4. **Pair the screen into the group** (`POST /screens/pair`) → "Lobby TV" `ONLINE`, seat consumed. 201.
5. **Create 2 URL assets** (`POST /assets/url`) → both land `status: PUBLISHED` (admin role) — confirms the per-asset approval gate: admin content is immediately live, a CONTRIBUTOR's would land `PENDING_APPROVAL` (`assets.controller.ts:1279` `initialAssetStatus(role)`).
6. **Create playlist** (`POST /playlists`) "Lobby Loop A3". 201.
7. **Add items with reorder + per-item durations** (`PUT /playlists/:id/items`): Banner Two (8000ms, seq 0) then Banner One (5000ms, seq 1). 200, 2 items.
8. **Schedule to the screen, windowed** (`POST /schedules` with `daysOfWeek=Mon-Fri`, `timeStart=08:00`, `timeEnd=15:00`, `isActive=true`). 201.
9. **Schedule to the group, all-day** (`POST /schedules` `screenGroupId`, `isActive=true`). 201.
10. **List schedules** → the group schedule correctly **superseded** the per-screen pin (per-screen flipped `isActive=false`). ✅ This is the 2026-06-26 "publish reaches only 1 of N posters" fix — verified working live (`schedules.controller.ts:124-154`).
11. **Manifest as the device** (`GET /screens/:id/manifest`, device JWT) → returns the playlist with both items. ✅ Content reaches the screen.
12. **Windowed-metadata check** (`run_window.py`): toggled the group schedule off, re-created a per-screen windowed schedule → manifest returned `schedule: {daysOfWeek: "Mon,Tue,Wed,Thu,Fri", timeStart: "08:00", timeEnd: "15:00"}`. ✅ Window metadata flows through.
13. **Approval gate** (`run_approval.py`): created a CONTRIBUTOR, logged in as them.
    - Gate **OFF**: contributor `POST /schedules` → `isActive=false`, **no** `pendingReview` (saved draft only; no submission auto-created). ✅
    - Admin flips gate **ON** (`PUT /tenants/me/content-approval {enabled:true}`) → `{ok:true, enabled:true}`. ✅
    - Gate **ON**: contributor `POST /schedules` → `isActive=false`, **`pendingReview:true`**, and a Submission was auto-created (`GET /submissions` count=1). ✅ Forced-review enforcement works end-to-end.
    - Manifest after → 0 playlists (contributor draft never reaches the screen). ✅ correct that drafts don't publish — BUT see P1 below for the side effect.

## Findings

| Sev | Area | What | Repro | Evidence |
|-----|------|------|-------|----------|
| **P1** | schedules / multi-tenant safety | A CONTRIBUTOR staging a **draft** schedule for the same `(playlistId, screenId)` an admin already has **live** silently **hard-deletes the admin's active schedule**, taking the screen dark — directly violating the code's own stated intent. The `willBeActive` guard protects the replace-displacement block (`:124`) but the separate upsert `deleteMany` (`:181-194`) runs **unconditionally** for any matching `(playlist, target)`, draft or not. No AuditLog records this delete. | Admin schedules playlist P live on screen S (`run_window.py` left `749d57c9` active). Contributor (any role-permitted user) `POST /schedules {playlistId:P, screenId:S}` → admin's live `749d57c9` is gone; only the contributor's inactive draft remains. Screen → dark. | `apps/api/src/schedules/schedules.controller.ts:181-194` (no `willBeActive`/draft guard) vs the documented intent at `:121-123`; live: `run_approval.py` step 3 + `scratchpad` schedule-list before/after |
| **P2** | manifest / scheduling precedence | The manifest returns the **same playlist twice** when two active schedules target one screen (e.g. a group schedule + a per-screen schedule for the same playlist). `dynamicPlaylists = schedules.map(...)` has **no dedup by playlistId and no `priority`-winner selection** — the stored `Schedule.priority` is never used to pick one. The player then concatenates both into "Scheduled Content (Combined)" and loops the items twice. If the two schedules pointed at *different* playlists, the screen would alternate with no defined precedence. | Re-activate via `PUT /playlists/:id/active {active:true}` (flips **all** of a playlist's schedules on at once, re-creating group+screen overlap), then `GET /screens/:id/manifest` → `playlists` array has the same id `eb0fed26` **twice**. | live: manifest returned 2 identical entries (`scratchpad`); `apps/api/src/screens/screens.controller.ts:3050` (`schedules.map`, no dedup/priority); player combine at `apps/web/src/app/player/page.tsx:3241` + `:3100` (maps every entry, no dedup) |
| **P2** | scheduling / server-side enforcement | The windowed schedule's `daysOfWeek` / `timeStart` / `timeEnd` are **not enforced server-side** — the manifest query only filters on `startTime/endTime/isActive` (`:2986-2988`) and ships the day/time window to the player as **metadata only**. The player enforces it client-side off its own local clock (`player/page.tsx:4303-4311`), so a screen with a wrong timezone/clock plays content outside its intended window. Acceptable architecturally, but worth a note: there is no server gate and no per-screen timezone on the schedule. | `run_window.py`: manifest at 19:5x UTC still returned the playlist with an `08:00-15:00 Mon-Fri` window — server does not gate; player decides. | `apps/api/src/screens/screens.controller.ts:2981-2990`, `apps/web/src/app/player/page.tsx:4303-4311` |
| **P2 (UX)** | publish friction | Getting "one item on one screen" still walks the full 5-step wizard (Name → Type → Media → Screens → Publish → Create). Mitigated by good defaults (activate-now = on, weekdays 08:00–15:00 pre-filled, steps 3/4 "always advanceable"), so the realistic click count is ~7 clicks. There is **no "publish this asset to this screen now" one-shot** outside the wizard. The playlist-card on/off `/active` toggle is a nice fast re-enable, but initial publish has no express lane. | Read `PlaylistCreateWizard.tsx:342-411, 597-617, 783-920`; defaults at `:379-385`. | `apps/web/src/components/playlists/PlaylistCreateWizard.tsx` |
| **Note (positive)** | publish correctness | The "1-of-N posters" fix **works live**: publishing to a group supersedes per-screen pins on member screens (`schedules.controller.ts:124-154`); group schedule won, per-screen flipped inactive. | step 10 above | live `run_log.json` `6_schedules_list` |
| **Note (false-positive cleared)** | audit logging | `schedules.controller` uses `req.user.id` in SCHEDULE_TOGGLED/DELETED audit rows; `jwt.strategy.ts:21` returns only `{userId,...}`. **Not a bug** — the active guard `jwt-auth.guard.ts:146-155` populates **both** `id` and `userId` on `req.user`. Verified before reporting. | — | `apps/api/src/auth/jwt-auth.guard.ts:146-155` |

## Coverage — what I covered vs. gaps

**Covered (live + source-verified):** playlist create; item add/reorder/per-item duration; per-screen schedule; per-group schedule; windowed (days/times) schedule + metadata passthrough; group-supersedes-per-screen ("1-of-N") fix; manifest reachability (device-authed); per-asset approval gate (admin→PUBLISHED, contributor→PENDING_APPROVAL); org-wide require-approval toggle (read + flip + audit) and its CONTRIBUTOR forced-review routing (draft + auto-Submission + `pendingReview`); the `/active` quick on/off toggle; playlist list decoration (`_count.schedules`).

**Gaps / not exercised, with reason:**
- **UI click-through not screenshotted** — Playwright browsers unavailable in this run; I drove the real API instead and read the wizard source for the click model. The publish *logic* is fully exercised against prod; the *pixel* UX (drag-reorder handles, PDF tiles, mobile 390px wizard) was not. The mobile/visual layer is A1/A2's lane; A3's mandate is the publish path, which I hit at the API/manifest level.
- **fleet `publish-to-fleet`** (cross-location parent→child distribution, `playlists.controller.ts:40`) — N/A at S1 (no child tenants on a fresh throwaway tenant). Logic read, not run.
- **Submission approve → schedule goes live** — I confirmed the submission is *created* and the draft is staged; I did not run the admin `POST /submissions/:id/approve` to watch `isActive` flip to true (that flip is the existing submit-for-review module, task #68 "P0-4 — Submit-for-Review must actually schedule the playlist," already shipped/tested). Confirmed the wiring exists (`submissions.controller.ts`), did not re-verify the flip live.
- **Real player render on glass** — out of scope for A3 (player/LED is A5 + the webcam rig); I verified the manifest *payload* the player consumes, and read the player's consumption path to gauge the P2 dedup severity.

## Grades

- **Design: A−** — Clean 5-step wizard, sensible defaults, the on/off card toggle, honest "sent for review" messaging. Loses a hair only because there's no express "publish now" lane for the dead-simple single-screen case.
- **UX: B+** — A non-IT operator can publish in ~7 clicks with everything pre-filled; the approval-gate language is clear; the group/screen dedup in the wizard is genuinely thoughtful. Held back by the P1 (a contributor draft can silently dark a live screen — the operator gets no warning) and the lack of a one-shot publish.
- **Functionality: B+** — The happy path works end-to-end live, the "1-of-N posters" fix and the brand-new require-approval gate both verified working. Two real correctness gaps keep it off an A: the unconditional `(playlist,target)` delete (P1) and the manifest's no-dedup/no-priority overlap (P2). Both are narrow, well-localized, and fixable in a few lines each.
