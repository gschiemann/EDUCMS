# Canonical Christmas flagship refresh — Claude handoff

Date: 2026-10-11. Owner: hospitality_flagships, isolated worktree `codex/hospitality-flagship-refresh`. Worktree: `/Users/gschiemann/.codex/worktrees/hospitality-flagship-refresh/EDU CMS`.

The canonical Christmas files offered by HOLIDAY were rebuilt: `apps/web/public/holiday-templates/es-christmas.html`, `ms-christmas.html`, and `hs-christmas.html`. This changes the actual standard templates; it does not rely on selecting their `-v2` or `-flagship` siblings. The earlier four hospitality boards are already integrated by the lead; their first-wave report is `hospitality.md` and commit was `2c3115df2f89f309cb26d0ea89263085c0ef6faf`.

## The three designs

| Grade | Concept | Loaded, editable typography | Composition |
|---|---|---|---|
| ES | North Pole Post | Fredoka / Nunito / JetBrains Mono | Cream, pink, forest green and candy accents; illustrated winter village, rainbow, candy-cane trail and elf; generous hunt feature, sing-along feature and five-day agenda. Chunky borders and hard shadows suit elementary school. |
| MS | Winter Signals | Space Grotesk / DM Sans / JetBrains Mono | Navy and alpine blue with an orange sun; an original mountain illustration and fine grid; strong winter headline, modest calendar counter, winter social/giving-tree features, and a five-day programme. |
| HS | Midnight Conservatory | Fraunces / Manrope / JetBrains Mono | Forest, cream, muted blush and gold; an engraved conservatory/window and winter forest; formal invitation, ticket information, giving-drive feature, modest date counter, and a five-day programme. |

Each file has a purpose-built 3840×2160 landscape and 2160×3840 portrait layout. Portrait redistributes features, artwork, counters and the five event rows rather than scaling a landscape thumbnail. New visible defaults are seasonal/activities copy; no cafeteria panel was added. Artwork is inline SVG inside replaceable image slots; no external image service is required. ES's rainbow/background is also a replaceable slot.

## Editability and existing-template compatibility

All original keys were retained, verified by parsing actual HTML attributes rather than matching strings inside scripts:

| File | Old / new text keys | Preserved slots | Added slots |
|---|---|---|---|
| es-christmas | 47 / 60 | school.logo, feast.photo | scene.art, scene.background |
| ms-christmas | 45 / 61 | school.logo, spotlight.photo, spotlight2.photo | scene.art |
| hs-christmas | 46 / 59 | school.logo | formal.art |

All 12 canonical theme fields exist in each file: bg, ink, brand, brand2, accent, accent2, pos, neg, fDisplay, fBody, fMono and scale. Every visible word has a data-field; every designed mark/illustration has a data-imgslot. There are no static visible labels outside the editable contract. Every font and palette color used by the composition is exposed through the theme, including art colors. Theme font edits reapply live; all default font families were actually loaded in Chromium and WebKit.

The original inline `holiday-bridge` is byte-identical. The shared `_style-bridge.js?v=20260821-style-3` include remains. Original saved event, feature, ticker and metadata strings were applied through the existing HOLIDAY protocol and checked in both engines/orientations. Uploaded images live on separate art elements rather than wrapping the associated text; Fit/Rotate therefore leave the text's geometry intact. Clearing images restores their placeholders. No shared widget, bridge, injector, API, schema or template-registry file was edited here.

Authored Christmas colors remain the default `--brand` / `--accent` canonical tokens. The host's generic indigo/pink transport does not repaint the whole design automatically. Editing `theme.brand` / `theme.accent` deliberately rebrands the board. Explicit toolbar text styles using `var(--brand-primary)` and `var(--brand-accent)` use the host's actual colors. These paths were tested separately; no color-value heuristics were introduced.

Explicit numeric operator font choices use absolute pixels. A chosen 72px remains 72px when theme.scale becomes 1.1, and timer/text/theme mutations preserve it. Authored defaults and auto-fit sizes consume global scale. All editable text blocks carry auto-fit metadata; body fields have a 60px floor and supporting fields a 50px floor. Frozen gallery previews have actual CSS font defaults, so bypassing auto-fit does not flatten the hierarchy or expose tiny fallback typography.

## Real dates and timer-safe edits

The fake default `05` counter is removed. Initial markup is `—`; the board calculates against visible, editable `countdown.target` (default Dec 18). Supported target forms are ISO YYYY-MM-DD, recurring MM-DD, and month/day with an optional explicit year.

Explicit dates validate actual calendar components: February 30 is invalid and shows `—`; a past explicit date shows 0. Recurring dates roll forward to their next valid occurrence, including Feb 29 in the next leap year. Counts compare local calendar days using UTC midnight arithmetic, so a daylight-saving transition does not produce an extra/missing day.

Manual countdown, clock and week-range edits stay pinned through timer updates. Clearing an override resumes their calculated value. The weekday highlight uses the real local weekday; there is no permanently selected demo Wednesday. The week range reflects the current local Monday–Friday rather than a hardcoded sample date. Neither a sample event's name nor its time claims a fabricated live data feed.

Short ticker defaults alternate every 14 seconds. Existing long saved ticker strings receive a bounded scrolling fallback at readable type size; the entire original string/key stays editable. The scroll stays inside an opaque message pane and tag, and rotation waits for that string's reading interval. Intentional scrolling is distinguished from clipped body copy in QA. No ellipsis or invisible paragraph truncation was added.

## Verification and evidence

Evidence folder: `/Users/gschiemann/Desktop/template-flagship-audit/christmas-after/`.

- `before-after.html`: orientation switch and original canonical screenshots beside final rebuilt 4K screenshots.
- `final-three-grades-native-review.png`: all three compositions, both orientations.
- Canonical `*-chromium-freeze-native.png` / `*-webkit-freeze-native.png`: native 3840×2160 or 2160×3840 frozen preview renders.
- Canonical `*-chromium.png` / `*-webkit.png`: normal live/auto-fit renders.
- `editability-results.json`: saved-edit/calendar/font/brand/media test matrix.
- `legacy-editability-results.json`: original saved text restored through the existing protocol.
- `key-coverage.json`: old/new key and image-slot coverage; byte-identical holiday bridge proof.
- `authoring-checkpoint/`: preserved generator, selected HTML, original HTML and browser harnesses.

The principal matrix is 3 grades × 2 orientations × 2 engines × four modes = 48 cases (normal, native frozen, saved edits, restored old copy), with targeted rechecks after the last middle-school label-height adjustment. All completed cases have zero script errors, font-floor failures, unexpected clipping, clipped ancestor boundaries, editable-field overlaps or fields outside the stage. Canonical rendered pages also have zero visible unkeyed text nodes. Both native and smaller previews were visually inspected; source pixel floors were measured, not inferred from a large headline.

Saved-edit checks cover manual 99 countdown surviving a changed target and 31 seconds of timers; clearing it to the calculated value; invalid/past dates; explicit and recurring leap day; a spring DST boundary; annual rollover; manual clock/week-range persistence and reset; longer paragraphs; editable loaded font families; canonical versus host branding; a fixed 72px manual font under scale 1.1; text/image click messages; null-origin sandbox isolation; image fit/rotation and preserved text geometry. Final media tests apply the shared companion protocol to every slot, hide every placeholder, and restore empty slots afterward.

The local null-origin sandbox harness inlines the same shared style bridge with HTML-safe closing-script escaping to avoid Chromium's loopback-address-space restriction on fetching localhost scripts from an opaque origin. The production shared source was not modified for this harness. The static canonical render checks load the normal external shared script. This is local browser verification, not a production-release claim or hardware qualification.

## Lead-owned integration

The starting HOLIDAY widget transported text and styles but did not expose discovered image slots as uploaded-image overrides/media styles. Findings were sent to the lead. The lead owns HolidayWidget/schema/Replace–Fit–Rotate controls and the new V2 shared media/font companion across the library. This branch intentionally does not alter those files; the lead will regenerate the companions after integrating this HTML commit. Media compatibility here is checked against the existing shared companion protocol in a browser fixture; final V2 integration checks belong to the lead. The lead also owns the HOLIDAY source-content version bump so a cached standard template refreshes.

No push, merge or deployment was performed by this subagent. Source, full report and evidence are recoverable on disk. Final commit SHA is recorded below once created.
