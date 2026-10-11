# Commencement Guest Guide — scope, source and verification report

Date: 2026-10-11. Agent: hospitality_flagships. Worktree: `/Users/gschiemann/.codex/worktrees/hospitality-flagship-refresh/EDU CMS`. Branch: `codex/commencement-gap`, base `327b5621`. No push or deployment performed by this agent.

This is one new public guest programme template, selected from the bounded hospitality / education / holiday / venue guest-services gap assessment. It is **not an entire-app audit**. The earlier inventory report and matching offered-preset evidence are preserved at `docs/research/2026-10-11-template-gap-expansion/hospitality-education-events.md` and Desktop `template-flagship-audit/template-gaps/`. The lead already registered K12 UNIVERSAL landscape and portrait presets (`preset-school-commencement-guide`, `preset-school-commencement-guide-portrait`). Shared registries, React editor, injectors, posters, manifests and AI source hashes are outside this agent's assignment.

## Standard Audit Surface — explicit D / UX / Functionality coverage

"Covered" below is limited to the named new source. Deferred means the domain exists or may exist elsewhere but was outside this source task; it does not imply app-wide health or absence. No N-A claim is made merely because a domain was not inspected.

| # | Surface | Design | UX | Functionality | Bound / reason |
|---|---|---|---|---|---|
| 1 | Real-time / signed pub-sub | Deferred | Deferred | Deferred | Emergency and player transport untouched. |
| 2 | Storage / content pipeline | Covered, source media | Covered, two slots | Covered, source overrides | Asset upload/CDN/offline tiers deferred; lead verifies builder upload/save. |
| 3 | AI providers | Deferred | Deferred | Deferred | No provider or key mutation. |
| 4 | AI feature surfaces | Deferred | Deferred | Deferred | Lead owns generation hashes; no AI workflow changes. |
| 5 | AI competitive scan | Deferred | Deferred | Deferred | Ceremony programme gap established from offered catalog, no general AI comparison. |
| 6 | Streaming integrations | Deferred | Deferred | Deferred | This board uses a still class image, no streaming workflow. |
| 7 | Sports scores / feeds | Deferred | Deferred | Deferred | No sports data or widgets. |
| 8 | POS / commerce | Deferred | Deferred | Deferred | No menu, inventory or POS feature. |
| 9 | Communications | Deferred | Deferred | Deferred | Editable welcome-desk guidance; no outbound message. |
| 10 | Auth / identity | Deferred | Deferred | Deferred | No auth or tenancy code. |
| 11 | Billing / commerce | Deferred | Deferred | Deferred | No billing changes. |
| 12 | Design import | Deferred | Deferred | Deferred | Existing still-image slot protocol used, no import integration. |
| 13 | Public alerts | Deferred | Deferred | Deferred | No alert-system changes. |
| 14 | Multi-vertical surface | Covered, one school workflow | Covered, guest programme | Covered, new source | Lead owns offered K12 registration; hotel second candidate deferred this wave. |
| 15 | Cross-browser / Chromium83 | Covered | Covered | Covered, target checks | Chromium/WebKit source runs; legacy syntax/inset checks, no Taurus hardware qualification claimed. |
| 16 | Forensic / audit | Deferred | Deferred | Deferred | Static source adds no privileged mutation. |
| 17 | Operational / DX | Covered, recoverable source | Covered, evidence | Covered, targeted verification | Production CI/deploy/health checks remain lead-owned. |
| 18 | Accessibility | Covered, readable type / contrast | Covered, visible text | Covered, overflow checks | No interaction required by viewer; app-wide axe/keyboard audit deferred. |
| 19 | Template / widget editability | Covered, all source copy/media/theme | Covered, hot zones | Covered, override protocol | Actual builder happy path/reload owned by lead. |
| 20 | D / UX / F lenses | Covered, three studies | Covered, readable guest task | Covered, target validation | This source only; not app-wide letter grades. |
| 21 | Verification before claim | Covered, source screenshots | Covered, edit screenshots | Covered, browser assertions | Not claiming live or shipped. |

## Missing workflow and nearest alternatives

Offered graduation countdowns, school calendars, school lobby boards, hospitality event lists and campus wayfinders were found. The missing workflow was a prepared ceremony visitor programme combining identity, date, doors/start times, four programme steps, guest parking, step-free entrance, programme URL/help and a replaceable class photo. The new source combines those on one guest-facing board. A Public Guest Essentials hotel/venue template remains the second-ranked candidate; it was not authorized for this wave.

## Design studies and self-review

Three independent compositions are preserved in `scratch/design/commencement-gap/` and Desktop `template-flagship-audit/commencement-after/authoring/`:

1. **The Invitation** — cream/burgundy formal serif invitation, separate headline/photo at left, tall programme at right; portrait moves programme below the photo and stacks the programme help beneath two arrival panels. Selected by self-review; no user approval is claimed.
2. **Academic Blueprint** — cobalt/lime, Space Grotesk / DM Sans, upper-right photo, four horizontal programme columns; portrait uses a two-column programme. Rejected because long programme descriptions required more room at the 60px floor.
3. **Honours Evening** — forest/gold, Fraunces / Manrope, tall photograph with a two-column lower programme; portrait switches to a single programme list. Rejected because the landscape copy regions offered less space for ordinary saved edits.

The Invitation deliberately reserves room for body copy instead of relying on a large headline to disguise small text. Its loaded pairing is **DM Serif Display / Outfit / IBM Plex Mono**. All three faces are exposed as canonical font fields, and the current shared font companion loads toolbar font replacements inside the sandboxed iframe.

## Delivered source and edit contract

Assigned source: `apps/web/public/templates/school/commencement-guest-guide.html`.

- One 3840×2160 / 2160×3840 source; `?o=portrait` / `?o=landscape` and viewport auto-detection.
- Every visible word has a field and fit role; actual CSS defaults retain the hierarchy in `freeze=1` gallery renders. Body floors are 60px; supporting labels 50px. Manual numeric font size is absolute pixels; global scale affects authored and automatically fit typography.
- Canonical 12 fields: `theme.bg`, `theme.ink`, `theme.brand`, `theme.brand2`, `theme.accent`, `theme.accent2`, `theme.pos`, `theme.neg`, `theme.fDisplay`, `theme.fBody`, `theme.fMono`, `theme.scale`. All authored colors and fonts consume these variables.
- **`ceremony.photo`** is the visible class-photo media slot. **`brand.logo`** is the replaceable mark. Neither contains copy; Fit/Rotate changes apply only to the media. Empty-slot fallbacks hide when media is present.
- Independently editable photo caption `ceremony.photo.caption`, venue `ceremony.venue`, ceremony title/kicker/lede, date/doors/start labels and values, four programme numbers/times/titles/details, parking/access/help fields and local-time label/value.
- Programme link is **`guide.value`**, initially reserved example domain `school.example/commencement`; help is `guide.detail`. It is plain visible editable text. No decorative or externally generated QR is included.
- Current exact generated **EDUCMS-SHIM-V15** and **EDUCMS-MEDIA-CONTROLS-V2** adapters are embedded. The shim generator was run for this single file. The shared V2 companion was copied byte-identically from the same-base existing source; no shared generator was edited or broad injector run.

## Live time and date behavior

`clock.mode` defaults `live`; `clock.timezone` defaults `local` and accepts an Intl timezone; `clock.format` accepts 12 or 24. Clock value is real wall-clock time, never a fixed sample time. A saved `clock.hhmm` override pins it across ticks; clearing resumes it. Countdown reads the explicitly editable ceremony date, supports ISO and full/abbreviated English month with year, uses validated calendar components and timezone-aware calendar-day arithmetic, clamps past events to zero and shows an em dash for invalid dates. A saved `countdown.value` override pins it independently; clearing resumes calculation. The four programme times are explicitly labelled planned, with no unsupported current-event/live-feed claim.

## Final source verification

**12 / 12 primary rendered cases pass**: actual Chromium and WebKit × landscape / portrait × default / `freeze=1` gallery / saved state. These use real null-origin `sandbox="allow-scripts"` iframes and 3840×2160 or 2160×3840 native screenshots, not browser screenshots of a different scratch-only design.

The primary cases assert:

- Zero field overflow, zero text/text collisions, no copy outside the stage, zero unkeyed visible copy and zero page errors.
- All **44 visible fields** stay at their authored role floor: body 60px, supporting 50px. Default and gallery renders both hold those floors. The board also carries 12 canonical theme fields and 3 clock configuration fields (59 actual DOM field nodes total).
- Longer saved ceremony copy, a 40-character two-line photo caption, a longer venue and programme descriptions fit in both orientations with their floors intact. The explicitly selected 72px Manrope introduction remains 72px; it was given a 200px copy row rather than silently shrunk.
- Saved custom palette, body family, primary/accent text styles, weight, alignment, line height, italic and underline are applied. Both authored and replacement fonts load inside the iframe.
- Both replaced image slots hide their fallback, respect contain / rotation, and keep their copy in separate sibling regions. The photo now has a clipping window so its rotation cannot paint over adjacent facts or its caption.
- Saved time/countdown pins survive an additional minute of ticks. Default time is the actual configured wall clock and the default countdown is calculated from the actual ceremony date.

**128 target edge assertions: 126 pass with the inherited base companion; 2 expose the same shared crop restoration issue in Chromium.** All 128 results, including the two failures, are preserved without masking. The lead confirmed the shared fix centrally: authored source/style defaults snapshot immediately after body parsing before URL/message painters, and untouched media is no longer restyled. The lead will reinject the current companion and verify integrated Undo and URL reload. This agent did not change a shared script or claim the two inherited failures had passed locally.

The passed edge coverage includes every visible text field's hot zone and override (44 / 44 in each engine/orientation), both typed media hot zones/readiness, all 12 canonical theme tokens, actual loaded Fraunces/Manrope/DM Mono replacement families, scale affecting automatic text, raw numeric 72px remaining absolute at scale 1.2, host brand surviving a later copy mutation, explicit primary/accent toolbar colors, Replace / Fill / Rotate with stable caption geometry, empty-image fallback, message pins and clearing-to-resume, timezone and 24-hour format, invalid timezone fallback, and the calendar cases below. Global scale was verified on authored automatic typography at 0.95 and separately against an absolute operator choice at 1.2; this is not an assertion that every arbitrarily long paragraph or large manual setting fits a fixed signage layout.

Calendar cases, each tested in both browsers and orientations:

1. ISO target tomorrow.
2. Full English month target tomorrow.
3. Abbreviated month with explicit year.
4. Spring-forward: two calendar days across the 23-hour day.
5. Fall-back: two calendar days across the 25-hour day.
6. Valid leap day.
7. Invalid non-leap February 29 → em dash.
8. Invalid April 31 → em dash.
9. Missing year → em dash.
10. Same event day → zero.
11. Past event day → zero.
12. Tokyo's next calendar date → correct zero while Los Angeles remains the previous day.

## Source cleanup and remaining integration responsibility

- Widened the independent caption region, then reserved two-line height so a saved caption does not cross a rule. Venue is a separate editable field, not text baked into the photo.
- Moved the default image from a CSS background to its authored slot declaration: clearing it removes the actual photo and shows the editable fallback; a CSS image can no longer silently reappear below the fallback.
- Cropped the default image upward so all class faces stay visible in the panoramic region.
- Wrapped only the media in its own clipping window; saved rotation no longer paints over ceremony facts or copy.
- Refitting includes actual text range bounds and never drops below the role floor to hide overflow.
- Idle clocks no longer refit all 44 fields every second. Only changed text, fonts, themes or viewport size schedule a fit; a clock's actual minute change is observed normally.
- No `inset` shorthand/utilities were found. Authored runtime is ES5 syntax; the embedded current companion is generated for Chrome83/Safari12. Actual Taurus hardware was not exercised by this agent.
- No new database, provider, external live feed, telemetry or publication behavior is introduced. No fake QR or fixed live-count number is included. The example programme domain is deliberately editable sample copy.

The lead owns current shared-companion reinjection, preset registration (already prepared), poster/manifest/AI-hash regeneration, the real builder Replace/Fit/Rotate/Undo/Save/reload happy path, final typecheck/CI, integration and deployment. Operator happy path: choose the offered guide, click the visible date/time/venue to change them, click the class photo to Replace, and Save. The source-level clicks and media protocol are proven; the lead's real builder test provides the under-30-second integration proof. No live-deployment claim is made here.

## Evidence and recovery

All native evidence and source authoring live in `/Users/gschiemann/Desktop/template-flagship-audit/commencement-after/`:

- `chromium-landscape-default.png`, `chromium-portrait-default.png`, equivalent WebKit default files.
- `chromium-landscape-freeze.png`, `chromium-portrait-freeze.png`, equivalent WebKit gallery files.
- `chromium-landscape-saved.png`, `chromium-portrait-saved.png`, equivalent WebKit saved files (long copy, colors, fonts, styles, images and pins).
- `invitation-*.png`, `blueprint-*.png`, `honours-*.png` — six study captures and `study-review.json`, with rejected-study tight copy regions explicitly retained.
- `browser-validation.json` — 12 native source cases and each field's actual dimensions, type size, color and font.
- `edge-validation.json` — all 128 assertions including the inherited Chromium crop failure.
- `authoring/` — all three standalone study sources, builder/runtime, review/verification helpers and index.
- `commencement-guest-guide.html` — preserved final source.
- `REPORT.md` — this complete report; `review.html` — native screenshot comparison.

No agent worktree was reset or discarded. Earlier hospitality/holiday branches and reports remain preserved. The lead owns worktree archival after integration and evidence preservation.
