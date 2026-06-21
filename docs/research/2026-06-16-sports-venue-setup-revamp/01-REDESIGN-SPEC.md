# VenueOS Sports — Setup Menu Redesign Spec

> Source: multi-agent research workflow (6 best-in-class teardowns —
> Daktronics Show Control, ChyronHego, Ross XPression, ScoreVision, Singular/vMix,
> WireSpring — → synthesis → adversarial critique), 2026-06-16. Persisted per the
> Agent Dispatch Protocol (rule #8). Pairs with [PUNCHLIST.md](PUNCHLIST.md) (Greg's
> verbatim A–M list) and [02-ADVERSARIAL-CRITIQUE.md](02-ADVERSARIAL-CRITIQUE.md)
> (the code-verified corrections — READ THAT before implementing; it relocates the
> scroll-speed bug and rescopes item L).

**Target file:** `apps/web/src/app/[schoolId]/sports/[gameId]/page.tsx` (~7,023 lines)
**Surfaces:** `/board/[gameId]` and `/ribbon/[gameId]` (the routes the operator tests on a real 4K TV)
**Auto-fit primitives:** `useScaleToFit(1920,1080)` (scene layer — DUPLICATED in `MainScoreboardWidget.tsx` + `RibbonScorebugWidgets.tsx`) and `FitOneLine`/`FitBox` (per-field layer, `components/widgets/sports/FitOneLine.tsx`).
**Goal (item M):** every control self-explains, one consistent clean UI, a non-IT operator ships a game in <30s.

---

## 0. The North-Star IA — three jobs, not one menu

The teardowns converge on one lesson (Daktronics' 3-app split, Ross's BUILD/RUN wall, ScoreVision's Cloud-vs-Producer, Singular/vMix Designer-vs-Studio): **separate "who's playing" from "what the screen looks like" from "what's playing right now."** Our Setup menu fails because it mixes all three plus live game-state into one scroll.

### New Setup IA — a gated pre-game checklist (ScoreVision Game-Day-Checklist model)

Setup becomes a **vertical checklist of game-ready nouns**, each a collapsible card with a completion state (`✓ done` / `• needs attention`), ending in one big **"Ready — Go Live"** button. No "settings" vocabulary.

| # | Card (noun) | What it holds | Replaces today's |
|---|---|---|---|
| 1 | **Tonight's Game** | Sport, Home/Away name+logo+colors, date. Rules (periods/timeouts/shot-clock defaults) auto-applied by sport, tucked behind "Game rules ▸". | scattered game config |
| 2 | **Screens** | Per-surface named cards (Main Board / Ribbon / Stream bug), each picks a named Layout w/ live thumbnail at the surface's *real* resolution. | LayoutsPanel + ScreenPushPanel + Displays&Layouts |
| 3 | **Pregame & Moments** | Pregame intro (with photo/video authoring), starting-lineups, halftime — the "takeover" cues, each with a content slot. | PregameIntroPanel |
| 4 | **Ribbon** | Reel presets + **Crowd Messages** + **Team/Logo images** (unpaid). Scroll speed lives here and *actually applies*. | RibbonPresetsPanel + RibbonPanel + RibbonImagesPanel |
| 5 | **Sponsors** (paid) | First-class Sponsor objects: plain-language duration/rotation/copy/flight, proof-of-play report. Separated from #4 images. | SponsorPanel + SponsorSchedulingSection |
| 6 | **Look & Sound** | Show-settings presets (gallery, explained), celebration pack, **MP3 horn upload**, custom shot clock, CTS status (gated). | PresentationSettingsSection + show settings |

**Moves OUT of Setup → into Run:** the game-state stepper (item A), all live-launch triggers (spotlight, fire-cue, send-message-now). Setup = prep; Run = trigger. Make **Run the default landing once a game is `Live`**, Setup the default while `Scheduled`.

Implement the card shell as a single `<SetupCard title state onEdit>` component so every card is visually identical (item M).

---

## A. Game-state stepper — REMOVE from Setup *(UX, trivial)*
**Problem:** the Scheduled/Pregame/Live/Halftime/Final stepper sits in Setup but state is driven from Run, so in Setup it's *always* "Scheduled" — a dead control.
**Fix:** delete the stepper from Setup; render a read-only status chip ("● Scheduled — kicks off when you go live"). The bottom **"Ready — Go Live"** button performs the one allowed Setup→state transition, **via the existing single mutation path (T1-1) + durable undo (T1-2)** — not a fresh handler (state-change discipline) — then routes to `?mode=run`.

## B. Pregame Intro — add content authoring *(UX redesign)*
**Problem:** `PregameIntroPanel` has big "takeover" buttons but nowhere to put the photo/video.
**Fix:** each pregame moment = a card with (1) a content slot (asset-picker for image/video, "Use team logo" default so never blank), (2) a plain-English label ("Full-screen takeover of the Main Board for ~8s, then auto-returns to the scoreboard"), (3) a **Preview on Main Board** button. The takeover button shows the thumbnail it will fire. Attach `mediaUrl`/`durationMs`/`returnToLayout:true` to the existing cue (the board/ribbon feed already consumes `next.mediaUrl && next.durationMs`).

## C. Displays & Layouts — decode the cryptic labels *(UX redesign)*
**Problem:** "Presenting/Concourse/Sponsor rotator" unexplained; ribbon only offers "CTS water polo / cinematic / default"; a context-shifting blue "Use CTS ribbon cinematic celebrations" button.
**Fix:** each physical surface = a named card; operator picks one **named Layout from a thumbnail menu**, plain English + one-line subtitle (*Full Scoreboard*, *Score + Sponsor bug*, *Sponsor Takeover* [collapses the three sponsor variants into one Layout whose *source* is a dropdown], *Starting Lineups*, *Halftime*). Ribbon layouts → *Score ticker* / *Cinematic celebrations* / *Sponsor + messages reel*. The floating blue CTS button is removed — picking "Cinematic celebrations" *is* enabling it. CTS layouts appear only on CTS-bound surfaces (item K). Thumbnails are tiny live iframes of `/board` / `/ribbon` with `?layout=<id>&preview=1` so **preview == reality**.

## D. Per-target preview at real resolution *(UX, small)*
**Fix:** on each Screens card a **"Preview this screen"** control with a resolution dropdown (1920×1080 · 3840×2160 · this surface's actual `canvasW×canvasH` · 320×1080 ribbon · portrait), rendered at that exact pixel size scaled-to-fit the card, resolution stamped on it. A **"Open on the real screen"** button deep-links the standalone route. Add a `?w=&h=` query the routes honor to force the scene's natural canvas so the in-app preview clips/sizes **identically** to the TV.

## E. Ribbon content & scroll speed — FUNCTIONAL BUG + redesign
### E1 — Scroll-speed bug *(FUNCTIONAL — see critique for the CORRECTED location)*
**Corrected root cause (critique, verified):** the main ticker crawl (`ribbon/[gameId]/page.tsx:1685`) *already* applies speed (`pxPerSec = (vp.w / NORMAL_CROSS_SEC) * speedMult`). The path that **ignores** speed is the **sponsor-marquee look at line 2234**: `scrollSecs = Math.max(8, (cardW * copies) / 120)` — hardcoded `120`, no `speedMult`. Fix = divide by the speed multiplier there. **Verification gate:** screenshot the *sponsor-marquee* look specifically (the bug is invisible on the default ticker).
### E2 — Relabel + explain. "Content & scroll speed" → **"What rides the reel"** + a separate **"Scroll speed"** Slow↔Fast slider labeled by feel (numeric under Advanced). "Crowd messages" gets a one-liner.
### E3 — Crowd messages: saveable + timed + role-launchable. A message list (reorderable), each with **Dwell seconds** + scroll/fade. Two fire modes: ride the reel (Setup), or **save as a launchable cue** the Run/role operator taps "Send to board now" (register into the `RIBBON` manual-cue feed — same dedup/freq-cap path). *(Sequence after the IA spine — it's a Run-mode trigger surface.)*

## F. Ribbon images — entrance/dwell/exit + separate paid vs unpaid *(UX redesign)*
**Fix:** split into two lists. **Team & Logo images (free, Ribbon card #4):** each slide has Entrance (slide/fade + duration), Dwell (seconds), Exit (slide/fade + duration), with a live preview of real on-screen time; no billing fields. **Sponsors (paid) → Sponsors card #5** (item G) with proof-of-play. Divider copy: *"These are your own graphics. Paid sponsor ads live in the Sponsors section so we can track plays for billing."* Add a `kind` discriminator so sponsor slides route through impression logging and team slides through the plain path.

## G. Sponsors — plain-language model *(UX redesign — flagship)*
Relabel + re-control the existing fields (lines 5836–6015: `flightStartAt`/`flightEndAt`/weight), don't re-architect:

| Operator sees | Plain control | Maps to |
|---|---|---|
| Artwork + caption | image upload + "Tagline" text line | logo + new `caption` |
| Each ad shows for | seconds stepper, default **15s** | per-item duration |
| How it enters | Slide / Fade + duration | new entrance field |
| How often it appears | radio *Every loop / Every other / Every 3rd* (+ "Star sponsor — 2×" toggle) | **replaces "rotation weight 5/2/10"** |
| Don't show more than | *"once every ___ minutes"* dropdown (Off/5/10/15) | **replaces "max per hour" textbox** |
| Runs from → to | date range, *"Auto-starts and auto-stops"* | flight start/end, **de-jargoned** |

Plus a **post-game proof-of-play report** ("Acme Tire: 14 plays, 9:02–10:48pm") from the T2-9 impression log + an **inventory meter** ("3 of 8 spots sold"). Fold `SponsorPanel` + `SponsorSchedulingInner` into **one** `<SetupCard>`. **Critique caveats:** make the radio the single source of truth for frequency (derive the stored weight — don't let radio + star-toggle + integer all write it); cut `creatives[]` from the first increment (it's net-new, not a relabel); **drop "est. impressions"** (T2-9 logs plays, not eyeballs — a fabricated number on a billing surface). Show plays + airtime only.

## H. Show settings presets — more + explained *(UX)*
**Fix:** a gallery of ≥5 named presets, each with a thumbnail (rendered from the same engine as `/board` → preview==reality) + a one-line description: *Classic*, *Stadium* (v2 engine), *Broadcast* (scorebug-forward), *Minimal*, *Retro* (LED-dot). Gate engine-specific presets by sport with a "Falls back to Classic for this sport" note instead of hiding.

## I. Celebration sound — MP3 upload *(UX, small)*
**Fix:** keep the URL field, add **"Upload MP3"** (drag/drop, ≤2MB, mp3/wav) + a **▶ Preview** button + a built-in default horn. Reuse the Supabase upload chain (`toSafeBuffer`). **Critique:** add `audio/mpeg`+`audio/wav` to **all three** mime caps that must agree (a known repeat-bug — one cap out of sync silently fails upload).

## J. Shot clock — custom + verified defaults *(UX, small)*
**Fix:** keep 20/30 quick buttons, add a **Custom** field (full + short, 1–60s). Seed a `SHOTCLOCK_DEFAULTS_BY_SPORT` map (basketball 24/14 college·pro vs 30 HS-varies, water polo 30 with a 20 rebound reset, lacrosse 60, etc.) applied on game create, with the source shown ("NFHS water polo default — change if your league differs"). **Critique:** card #1's "set-and-forget" rests on these defaults being right — tie this into the **P1** increment, not P2.

## K. CTS console — gate to relevant sports + explain "copy feed URL" *(UX)*
**Fix:** render the CTS block only when the sport/install is CTS-capable (`{def.cts?.capable && ...}`); hide it entirely otherwise (no dead console). When shown, add the explainer: *"Your physical scoreboard console (CTS) can feed live score & clock straight to VenueOS. Paste this Feed URL into the console's network settings — then the board updates itself, no typing."* Give "Copy feed URL" a tooltip + "Copied ✓" + a "where does this go?" link.

## L. AUTO-FIT — HIGH-PRIORITY FUNCTIONAL BUG *(fix first)*
**Two independent bugs at two layers** (fixing one won't fix the other):
1. **Element-level clipping** (long team name) → per-field shrink-to-fit, on by default.
2. **Scene-level wrong-resolution** (ribbon ticker mis-sized; 4K not filling) → measure-then-scale the whole scene to the surface's real pixels.

**Critique corrections:** the scene layer (`useScaleToFit`) ALREADY computes `Math.min(w/natW, h/natH)` against `offsetWidth/Height` in BOTH duplicate copies — so L2 is mostly done; **de-dupe the hook into one shared module before threading any `w,h` prop**, or you fix the board and silently leave the ribbon scorebug on the old copy. The real gap is the **per-field text layer** (team/player/sponsor names) on the monolithic widgets (`MainScoreboardWidget`, `RibbonScorebugWidgets`, `SportsScoreboardWidgets`).
- **L1 — per-field shrink-to-fit, ON BY DEFAULT.** Wrap every data-bound name field in a fit primitive that shrinks to fit (FitOneLine already does this for the *granular* `SportElementWidgets`). Ordered fallback: shrink font → condense letter-spacing (~85% min) → stored `shortName`/`abbrev` → logo-only. **Never clip, never ellipsis a team name.** *Defer the schema `shortName`/`abbrev` fields + 3-name UI to a later increment* (it's a migration, not a relabel); ship shrink+condense now. **CJK/unbreakable strings:** condense does nothing → shrink-only branch, allow below the 50px floor with a Setup warning.
- **L2 — scene measures the REAL surface, both axes**, from the manifest / `?w=&h=` query (item D), filling top-to-bottom against true device pixels (not the in-app card).
- **L3 — ribbon ticker sizes from surface pixels:** derive font/row-height from surface HEIGHT and crawl px/sec from surface WIDTH so fill + apparent speed are constant across portrait ribbon vs long-thin horizontal (compute `seqW`/`scrollSecs` from the *measured* width, not a constant).
- **Riskiest steps (critique):** (1) a fit wrapper measuring BEFORE the scene `transform:scale()` settles → ships green, broken on 4K — measure in the same rAF chain + gate on `scale > 0`; (2) threading `w,h` through one hook while a second copy exists; (3) CJK vs the floor.
- **Verification gate (mandatory):** screenshot **standalone** `/board/[gameId]` at 3840×2160 and `/ribbon/[gameId]` at the real ribbon size with a long name ("Academy of the Sacred Heart") AND a CJK name. Verify on the real route, not the in-app preview.

## M. Overall polish *(UX)*
One `<SetupCard>` shell; every control a one-line plain-English helper (no "weight"/"flight"/"px/sec"/"RTD"); sensible defaults (15s sponsor dwell, 4s message dwell, Normal speed, built-in horn) so the **30-second happy path** = *pick sport → confirm two teams (logos auto-pair by tolerant id/slug match, NOT exact filename) → tap "Ready — Go Live."* **Critique:** logo fuzzy-pairing is the actual gate for the happy path — promote it to **P1**, not a one-liner.

---

## BUILD ORDER (functional bugs first; each phase ends with the standalone-route screenshot gate)

- **Phase 1 — FUNCTIONAL BUGS:** L (per-field fit default-on + de-duped scene hook + ribbon sizes from pixels) · E1 (sponsor-marquee line-2234 speed fix).
- **Phase 2 — IA spine:** 0 + A (`<SetupCard>` checklist shell, remove the dead stepper, "Ready — Go Live" via the T1-1 mutation path, Run-as-default-when-Live).
- **Phase 3 — content authoring & clarity:** C + D (named surface cards, plain layout names, kill the floating CTS toggle, per-target real-resolution preview) · B (pregame content slots + auto-revert) · F (split paid/unpaid; entrance/dwell/exit).
- **Phase 4 — sponsor model & polish:** G (plain-language Sponsor card; cut `creatives[]` + "est. impressions" from v1) · E2/E3 · H + I + J + K · M (consistency sweep + 30-second happy-path Playwright proof + logo fuzzy-pair).
