# Water Polo Celebration Cues — Fix + Verification (2026-06-04)

## What the customer reported
> "check the water polo celebration cues we have live — they have player names and
> some don't even work right; we had good ones I thought worked. Have the team test
> and fix them up. And if we're going to have a player's name popup, that means we
> need to change our workflow: click the cue → it pops a player list → click the
> player → it all happens almost instantly."

## Root cause (code-verified — see 01-cue-logic-audit.md)
The live cinematics (board `/board/[gameId]` + ribbon v2) render from **static HTML
`<iframe>`s** (`/celebrations/v2/launcher.html?cue=…`). `celebrationSrc()` only ever
passed `team` + `format` — there was **structurally no channel** for the live score or
the operator's chosen player. So every water polo cue showed the **design-time
placeholder names baked into the cue files**: GOAL → "#7 RIVERA · 4TH PERIOD · 1:24
LEFT", SAVE → "#1 OKONKWO · GK", etc. — regardless of the real game or who actually
scored. (Verified visually: see `scratch/wp-cues/before-v2-*.png`.)

The plumbing to *carry* a scorer (`scorerName`/`scorerNumber` on the cue mutation +
GameEvent) already existed, but it only reached the ribbon's v1 text strip — never the
board or the v2 launcher.

## The fix (5 files)

### Half A — live data reaches the cinematic (kills the fake names)
1. **`apps/web/public/celebrations/v2/launcher.html`** — decode a new base64url-JSON
   `d` URL param and **patch each cue's config** (`player`, `score`, `context`) before
   it paints, exactly like the existing `team` patch. An empty/absent player → the
   engine's `if(opts.player)` guard hides the name line, so firing without a pick shows
   **no placeholder name**. When `d` is absent (design gallery / legacy), cues keep
   their demo data — zero regression. ES5-only JS (`var` + function expressions) →
   Chromium-83 / Taurus safe.
2. **`apps/web/src/lib/celebration-assets.ts`** — new `CelebrationLiveData` type, a
   UTF-8-safe `encodeLive()` (TextEncoder→base64url, round-trips the launcher decode),
   a shared `celebrationLiveDataFromCue()` helper (snapshot + scorer → payload), and a
   `data` param on `celebrationSrc()` that appends `&d=` **only** for the v2 launcher.
3. **`apps/web/src/app/board/[gameId]/page.tsx`** — added `scorerName`/`scorerNumber`
   to the `Cue` type; pass `celebrationLiveDataFromCue(cue)` into `celebrationSrc`.
4. **`apps/web/src/app/ribbon/[gameId]/page.tsx`** — same wiring on the v2 ribbon path.

### Half B — the cue → player-picker → fire workflow
5. **`apps/web/src/app/[schoolId]/sports/[gameId]/page.tsx`** — `RunInlineCuesBar` now
   routes a **name cue** (goal / save / exclusion — `cueWantsScorer()`) through a new
   **`CueScorerPicker`** popup: tap the cue → a fast mobile roster sheet pops (home +
   away sections, big number tiles, the spotlit player pre-highlighted, a prominent
   "⚡ Fire now — no player" escape) → tap the player → the cue **fires instantly** with
   that name baked into the cinematic. Team / situational cues (power play, horn) fire
   immediately. No roster → fires immediately. The old "spotlight-first, then fire"
   two-step is replaced by this one-flow.

## Verification (all green)
- **Live render, with scorer:** GOAL + SAVE now show **"#7 GREG SCHIEMANN · 4TH ·
  2:14"** (the injected scorer + live context) instead of RIVERA / OKONKWO.
  `scratch/wp-cues/after-v2-goal-t3200.png`, `after-v2-save-t3200.png`.
- **No-player case:** clean GOAL with **no name line** (no placeholder).
  `scratch/wp-cues/after-v2-goal-NOPLAYER.png`.
- **Picker UI on a phone:** `scratch/wp-cues/picker-phone.png`.
- `pnpm --filter web exec tsc --noEmit` → clean.
- `eslint` on the 4 changed TS files → clean (celebration-assets).
- `pnpm --filter web run test:celebrations` → **32 pass / 0 fail** (WebKit; waterpolo-goal incl.).

## Known follow-ups (secondary — not shipped this pass)
- **`CueLaunchpad`** (the full cues grid behind the "Cues" button) still fires generic
  (now shows no fake name, which is correct). The picker lives on the always-visible
  Run-mode inline bar — the during-game surface. Adding picker parity to the launchpad
  is a fast follow.
- **AUTO-fire** (goal-delta / CTS) fires without a scorer — it can't know who scored.
  With the fix it now shows a clean cinematic (no fake name) rather than a wrong one.
- **Board `horn`** has no themed cinematic → generic confetti + 📯 (acceptable; noted).
- **v2 `drawScorebug`** is defined but never called — the live score is now *injected*
  via `d` but the cinematic doesn't draw a scorebug yet (the persistent board shows the
  score around the ~4s takeover). Wiring it in is an enhancement.
- **React `CelebrationDeckScene`** dropped the water-polo save's `save:'x'` X-slam +
  projectile `deflect` — **dormant** (that component isn't rendered on either live
  surface today; the live board uses the correct v2 static save).
