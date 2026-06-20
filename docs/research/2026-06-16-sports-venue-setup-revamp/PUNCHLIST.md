# Sports-Venue Player + Setup Menu — REVAMP punch list (best-in-world)

> **Source:** Greg, 2026-06-16 (voice note), captured verbatim-in-intent. **Do this AFTER the touch/template
> editor flagship work** (`docs/research/2026-06-16-touch-editor-flagship/00-BUILD-LOG.md`). Directive: full
> revamp, **use as many agents as needed, make it perfect — best in the world**. The whole Setup menu reads as
> confusing, ugly, unintuitive, "no thought put into it." North-star: a non-IT operator sets up a game-day venue
> in minutes, every control self-explains, and the output auto-fits ANY screen resolution beautifully.
>
> Files (grounding): game console + setup = `apps/web/src/app/[schoolId]/sports/[gameId]/page.tsx` (RunMode +
> the Setup sections: `PregameIntroPanel`, `PresentationSettingsSection`, `SponsorSchedulingSection`,
> `LayoutsPanel`, `ScreenPushPanel`, ribbon content). Surfaces render via `apps/web/src/app/board|ribbon` routes
> + `RunRibbonPreview`/scoreboard widgets. **TRAP (memory):** the operator tests the standalone `/board` `/ribbon`
> routes + a real 4K TV, NOT just the in-app previews — verify on the real surface + real resolution.

## A. Game state stepper is in the WRONG place
- "Scheduled / Pregame / Live / Halftime / Final" lives in **Setup**. Setup is *always* Scheduled — game STATE is
  driven from **Run game**, not Setup. **Remove the state stepper from Setup** (Setup = pre-game config only);
  state transitions belong in the Run console (where T1-5 status cinematics already live).

## B. "Pregame Intro" is unexplained
- Big buttons, zero explanation of what it is or what to do. Says it "takes over the scoreboard" but there's no
  photo/content authoring visible — "where's the photo and everything?" **Fix:** explain it in-panel (what it is,
  when it fires), let the operator author the content (team photo / roster / sponsor), and show a preview of the
  takeover. Tie to the existing starting-lineup choreography (T2-4) if that's the same thing.

## C. "Displays & Layouts" / "templates per surface" not intuitive
- "Default per surface" / "templates per surface" — operator doesn't know what a per-surface template is. **Explain
  it** ("the design each screen shows: Scoreboard, Ribbon, Stream").
- Surface options are cryptic: Scoreboard = "default built-in layout"; others = "Presenting sponsor / Concourse
  sponsor / Sponsor rotator" with no explanation. Ribbon only offers "CTS water polo / cinematic celebrations /
  default"; Scoreboard offers many (the variety is GOOD — keep). **Fix:** name + 1-line describe each option;
  thumbnail each; group sensibly.
- The CTA mutates into a big blue **"Use CTS ribbon cinematic celebrations"** button — confusing label/placement.
  **Fix:** consistent "Apply to [surface]" affordance, not a context-shifting blue button.

## D. Live preview — add real-screen/resolution preview
- Live preview exists (good). **Add:** preview a surface on a SPECIFIC target screen + its real resolution, so the
  operator sees exactly what that screen will show at its pixel size (ties to E.scroll-speed + L.auto-sizing).

## E. Ribbon "content & scroll speed" — multiple problems
- Mislabeled: it's content *scheduling* (score / time remaining / crowd messages). "Crowd messages" unexplained.
- **Scroll speed (Slow/Normal/Fast/Very Fast) does NOT actually apply when changed — BUG. Fix + verify on /ribbon.**
- Custom/crowd messages: **can't control timing — they "kick off whenever."** No save, no schedule, no launch
  control. **Fix:** custom messages must SAVE, be timeable/schedulable, and be **launchable by whoever runs the
  game** — surface them in the role menus (Show-Caller/PA) like other live cues, not a fire-and-forget textbox.
- "Score multiple times" option = fine.

## F. "Add images to the ribbon" — no model/explanation
- "Add images / add media" with no explanation: how does it enter screen? how long does it stay? slide L→R? roll?
  scroll? **Fix:** explicit per-image behavior — entrance (slide/cut/scroll), dwell seconds, exit — with a preview.
- **Separate paid vs unpaid:** SPONSORS (paid, with terms) vs TEAM/LOGO/non-paid images. Don't mix sponsor
  messaging with team images. The "add images" area = team/logos/non-paid; sponsor images live under Sponsors (G).

## G. Sponsors — needs real control + clearer UI (currently ugly + jargon-y)
- Sponsors all scroll together / rotate on and sit ~10–20s with **no operator control** over appearance, duration,
  or the **text that goes with each sponsor**. **Fix:** per-sponsor display control (duration, entrance, the
  accompanying copy), and a clear rotation model.
- "Rotation weight 5 / 2 / 10" — meaningless to a normal person. **Replace/explain** (e.g., "show this one
  more/less often" with relative sizing, or plain "priority: high/med/low").
- "Max per hour: uncapped" — just a raw text edit, no dropdown; ugly (huge box, one tiny number). **Fix:** a real
  control (preset chips + custom) and a clean layout.
- "Flight start / Flight end" — ad-industry jargon. **Rename** to plain language ("Show from … to …" date range).
- The whole Sponsors UI is ugly — redesign to match the rest of the app.

## H. "Show settings: Classic / Stadium v2" — unclear + too few
- Operator doesn't know what these mean. Only two. **Explain them; add more show presets** (this is a "pick your
  game-presentation style" feature — make it real with several quality options + previews).

## I. Celebration settings (Sound + URL) — allow file upload
- Currently URL-only for the horn/sounds. **Let the operator UPLOAD an MP3** (and other sounds) for the horn /
  celebration audio, not just paste a URL.

## J. Shot clock (20s / 30s) — allow custom + verify per-sport
- Only 20/30 presets, no proper custom edit. **Add a custom time.** Confirm 20/30 defaults are right across
  HS / college / pro (and per sport) — don't assume identical.

## K. CTS scoreboard console — show only when relevant + explain
- CTS panel appears (apparently because water polo was selected). **Gate CTS to the sports/consoles it actually
  serves** (water polo / swimming / etc.), not every sport. Confirm whether it's currently sport-gated or always-on.
- "Copy feed URL" — unexplained. **Explain what it's for + what to do with it** (and what it enables).

## L. AUTO-SIZING / RESOLUTION — functional bug (HIGH PRIORITY)
- On a standard **4K landscape TV**, **team names get CUT OFF** — not properly auto-resolution.
- The **score ticker on the ribbon** resolution "doesn't look right."
- **Fix + verify:** the scoreboard + ribbon must auto-fit ANY customer pixel resolution — fill the screen
  top-to-bottom as large as it fits, names never clipped, looks great at 1080p / 4K / ribbon / portrait. Audit the
  auto-size path (the `useScaleToFit` / measure logic) on the **real `/board` + `/ribbon` routes at real
  resolutions**, not just the in-app preview.

## M. Overall
- Full UX revamp of the Setup menu: every control self-explains (inline help / "what is this?"), consistent clean
  UI (kill the ugly raw-number boxes + jargon), sensible grouping, 30-second-happy-path for a non-IT operator.
- **Approach:** multi-agent — research best-in-class sports game-presentation control (Daktronics Show Control,
  ChyronHego, Ross, ScoreVision, Pixellot) for the setup/show-build UX + per-area redesign + the auto-size fix.
  Best in the world. Verify on real surfaces (the /board /ribbon routes + a real 4K TV), per the testing trap above.
