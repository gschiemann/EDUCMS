# Touch Kiosks — batch-17 rollout (2026-06-05)

Library now **19 fully-editable, button-wired Touch Kiosks** (was 9). Batch-17
(`kiosk-new-9`) added 10 NEW companion variants — **no duplicates** of the
existing 9 (distinct filenames + preset ids; collision-checked before writing).

| Preset | File | data-field | data-img | data-action |
|---|---|---|---|---|
| 🥡 Order Pickup & Curbside | qsr-pickup | 40 | 1 | 1 (arrival.notify) |
| 🚪 Meeting Room Panel | office-room-panel | 36 | 1 | 4 (book/extend/end) |
| 🏠 Model Homes Gallery | real-estate-models | 143 | 12 | 2 (model.tour/confirm) |
| 🏢 Resident Concierge | real-estate-resident | 72 | 7 | 4 (amenity/maint/pkg/rsvp) |
| 🥗 Nutrition & Allergens | food-nutrition | 135 | 12 | 1 (nutrition.email) |
| 🧭 Explorer Quest | museum-quest | 83 | 7 | 1 (reward.claim) |
| 🏋️ Guided Training | gym-workout | 94 | 1 | 1 (results.email) |
| 🎵 Jukebox | bar-jukebox | 113 | 32 | 2 (song.queue/bump) |
| 🏫 Front Office Check-In | school-front-office | 53 | 1 | 2 (visitor/student checkin) |
| 🐾 Veterinary Check-In (NEW vertical) | vet | 57 | 7 | 4 (checkin/refill/help) |

## Commits
- `d32157de` — intake 10 (inlined EXTERNAL_HTML + 10 KIOSK presets, vertical ALL). API tsc clean.
- `690169e8` — markers + manifests (10 worktree agents: 847db188 92e5c74b 1ca60290 af68f22c 01069a08 928e9308 a043ae08 51ce1bd0 89e30c0f be578c15), cherry-picked + re-verified + worktrees removed.

## Verification
- **No duplicates:** all 10 output filenames pre-checked against the existing 9 (script refuses to overwrite); 10 distinct data globals (PICKUP/ROOM/MODELS/RESIDENT/NUTRI/QUEST/TRAIN/JUKE/FRONT/VET).
- **DB (prod):** 19 KIOSK presets, all vertical=ALL.
- **Headless (scratch/verify-all-kiosks.mjs):** all 19 pass discovery (field/img/action all >0) + render + brand `--accent`, 0 init errors.
- Each new kiosk's apply+action loop agent-verified (text/brand/image override + educms-action tap), lead re-verified from master. API tsc clean.
- gym-workout: agent caught + fixed a quote artifact it introduced (Kiosk.app SyntaxError); renders clean from master.

## Feedback for Claude design (next batch)
- The nested `<vertical>/<variant>/` folder layout is great — keeps companion screens grouped. Keep the per-kiosk index.html + data/app/styles split; the inliner maps `<vertical>/<variant>` → `<vertical>-<variant>.html`.
- Watch for backslash-escaped quotes (`\'hiit\'`) in app.js from any python post-processing — one slipped into gym-workout and broke Kiosk.app() until fixed.
- Self-host the Google Fonts (offline panels) remains the one open polish item.
