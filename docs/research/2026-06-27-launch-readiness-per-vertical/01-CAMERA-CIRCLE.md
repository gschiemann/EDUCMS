# Live Camera-Circle Test — AI board → physical LED (2026-06-27)

The "complete test circle": Greg's webcam (ScreenConnect "Video Preview") points at the
physical Brookfield LED video wall; the Venue OS dashboard drives it. This is the
main-loop lead driving the real authed dashboard + watching the physical screen — the
breadth (every vertical) is the agent Workflow (`00-BETA-FINDINGS.md`); the camera circle
can only be driven from the main loop (subagents can't see the webcam or the authed browser).

## What was proven (end-to-end, then reverted)

Drove the **real flagship pipeline** against prod from the authed page context:

1. `POST /templates/generate-touch/candidates` `{engine:true}` → AI board "Dodgers vs Giants" (4 zones, dark-navy gradient). **201**
2. `POST /templates/create-from-candidate` → Template `e9f082f7`. **201**
3. `POST /playlists` `{templateId}` → board-only playlist `9bdc376d`. **201**
4. `POST /schedules` `{screenId: LED, isActive:true, priority:100, startTime}` → schedule `b4f4427f`. **201**
5. `GET /screens/LED/manifest` → resolved to the new board. ✅
6. **Webcam confirmed the physical LED** rendered: "WELCOME TO DODGER STADIUM / Dodgers vs Giants / First pitch 7:10 PM / Enjoy the game" — clean condensed Oswald, no overflow (the FitScaler + engine-font fixes holding on real glass).
7. Reverted: deleted schedule + playlist + template; re-activated Brooky. Webcam confirmed return to "BROOKFIELD / COMMUNITIES MADE FOR LIVING."

**This directly answers "I didn't see one AI screen pushed to the live screen" — it now has, verified on the physical wall.** The LED Score Board screen = `7b072185-3399-433e-8151-12fe70c6dcdd`; Brooky playlist = `d0542f2c-…`; Brooky's schedule = `b727950d-…` (priority 0).

## Findings the camera circle caught (neither shows in unit tests)

### CC-1 [P1] AI generator defaults to 1920×1080; this LED is 960×1080 → board clipped on the right
The "Display (no touch)" modal generates at **1920×1080 landscape**, but the LED's real canvas
(`manifest.canvasW/H`) is **960×1080 (portrait)**. The player scales-to-fit by height, so the
right half of the wide board runs off the screen — on camera, "Dodgers vs Giants" showed only
"Dodgers", "WELCOME TO DODGER STADIUM" was cut, the CTA was half-off.
**Fix options (pick one):** (a) the generate modal defaults to the **target screen's actual
canvas** (let the operator pick the screen, prefill W/H from it); (b) add an orientation/size
picker (Landscape 1920×1080 / Portrait 1080×1920 / **Custom from screen**); (c) the player's
TemplateScaler should **contain-fit** (letterbox) a mismatched board instead of clipping. (a)+(c)
together is the right answer — the operator should never have to think about it, and a mismatch
should never clip. Note: the screen's `resolution` field said `1920×1080` but the manifest
`canvasW/H` is `960×1080` — those two sources of truth disagree, which is the root confusion.

### CC-2 [P1] Publishing a schedule deactivates the prior one; deleting the new one leaves the screen BLANK
Creating an active schedule on a screen silently flips the previously-active schedule
`isActive:false` (one-active-per-screen). **Deleting the new schedule does NOT reactivate the
prior one** → the screen's manifest goes empty (`playlists:[]`) → the physical screen goes dark.
Observed live: after deleting my temp schedule, Brooky's schedule stayed `isActive:false` and the
LED would have gone blank; had to re-activate Brooky via `PUT /schedules/:id/toggle`.
Also: `PUT /schedules/:id` **ignores `isActive`** (not in `ScheduleUpdateSchema`) — only the
`/toggle` endpoint flips it, which is a surprising inconsistency.
**Fix:** when a schedule is deleted/deactivated, the manifest resolver (or the delete handler)
should fall back to the next-highest-priority schedule automatically — a screen should never be
left with zero active schedules if any schedule exists for it. At minimum, warn the operator
"this will leave the screen with no content."

## Reusable recipe (for future camera tests, from the authed page console)
- API base `https://api-production-39a1.up.railway.app/api/v1`; auth `Bearer ${localStorage.edu_cms_token}`.
- Push: generate → create-from-candidate → playlist{templateId} → schedule{screenId,isActive:true,priority:100,startTime}. `startTime` is REQUIRED.
- Verify: webcam screenshot (computer-use), or `GET /screens/:id/manifest`.
- Revert: DELETE schedule + playlist + template, then **re-activate the original schedule via `PUT /schedules/:id/toggle`** (delete alone leaves the screen blank — see CC-2).
