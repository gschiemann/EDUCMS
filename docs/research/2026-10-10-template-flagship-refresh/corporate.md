# Corporate flagship template refresh

## Scope and authorization

Rebuilt eight active corporate boards from source base `25cb9af4` in isolated managed worktree `/Users/gschiemann/.codex/worktrees/corporate-flagship-refresh/EDU CMS`, branch `codex/corporate-flagship-refresh`. The user's instruction to find bad templates and update them authorized implementation. Three independent HTML concepts were produced and browser reviewed for each board; selection was agent review, not claimed user approval.

Assigned production files: corporate 01, 02, 03, 04, 05, 06, 08, 09, four new local portrait photographs and their provenance README. Corporate 07 cafeteria quarantine, 10 emergency information, approved 11/12 Signal boards, homebuilder, shared injectors, API exemplars, gallery metadata and posters remain outside this commit.

## Result by board

| Board | Selected composition | Changes and purpose |
|---|---|---|
| 01 Lobby welcome | Arrival Index | Cream and cobalt editorial welcome, oversized guest heading, three arrival details, a directional arrow panel, occupancy statistics and concierge footer. Portrait rearranges the arrow and statistics instead of stretching a landscape screen. |
| 02 Conference room | Room Placard | Large forest availability placard with a cut corner, ruled room amenities, booking guidance and now/next/after schedule. Replaces the previous portrait black letterbox with a complete 2160×3840 design. |
| 03 KPI dashboard | Financial Journal | Large revenue/NPS/uptime, six ruled metrics and annual-goal progress, with explicit sample-data copy. Progress is calculated from the current and target currency fields, including K/M/B units; existing optional fill override stays available. |
| 04 New hires | People Team | Four real swappable portraits, numbered contact-sheet frames, larger readable names, roles, reporting details and conversation prompts. Portrait uses a two-by-two staff spread. Initials remain a readable fallback when an image is cleared. |
| 05 Floor directory | Brass Wayfinding | Large floor numerals, department labels, consistent elevator directions and highlighted visitor floor. Full-height portrait directory replaces the former landscape letterbox. |
| 06 All hands | Town Hall Broadcast | Plum announcement placard, large countdown strip, three live agenda periods and a real speaker portrait. Before the configured time it counts down; during the session it invites attendees to join; after the configured duration it thanks them. |
| 08 Shuttle | Terminal Navy | Transit-style route list, prominent departure times, pickup instructions and route dots. Editable 24-hour departures replace fabricated “3 min / 8 min” live ETAs. Portrait uses five full-width departure rows. |
| 09 Events week | Culture Broadsheet | Five weekday editorial columns and large date tabs, with calendar/RSVP/volunteer guidance. Portrait becomes five agenda rows; week dates and today highlighting follow the local calendar. |

## Editing, brand and source compatibility

All original text and image slot keys are retained. Source-contract verification strips script content before counting keys, avoiding query-selector strings being counted as fields. Field counts before → after are 26→39, 11→32, 32→45, 25→42, 22→37, 28→43, 19→38, 23→44. Image slot counts are 1→1, 0→1, 1→1, 5→5, 0→1, 2→2, 0→1, 0→1. Added fields cover canonical brand controls, supporting labels and truthful sample content; no existing operator override key was removed.

Every board exposes the twelve canonical theme fields (brand, brand2, accent, accent2, ink, bg, pos, neg, fDisplay, fBody, fMono, scale), has actual authored CSS font defaults and scales both maximum and minimum auto-fit sizes while retaining the absolute 50px floor. Main body copy is authored at 60px or greater; small labels use 50–58px. All visible editable blocks fit again after fonts load and after text edits. The image-clear fallback refits visible initials while skipping hidden text.

The eight baked V14 apply/click shims and media-controls V1 blocks remain byte-for-byte identical to their originals. Scoped corporate injector rerun reports 0 injections, 0 replacements, 26 up-to-date. Added logos on room/directory/shuttle/events boards use normal image slots. Image replacement, clear, fit and rotation remain routed through the shared companion and editor toolbar.

## Truthful defaults and runtime corrections

Removed unsupported BI/HRIS/feed markers and misleading “updated now” claims from KPI/new-hire defaults. KPI numbers and profile portraits are explicitly sample content. Shuttle rows are sample departures and operator pickup notes, not a simulated live transit feed. Existing configurable values and edit hooks remain supported.

All-hands adds hidden `countdown.targetDatetime` (empty defaults to today at editable event start) and `countdown.durationMinutes` (75). Countdown and badge updates honor data-pin and operator overrides. Shuttle departure windows are derived from edited visible times. Live clocks retain operator pins and query/message overrides.

A concrete schedule engine bug was found while testing: its observer watched class attributes, and its own remove/add of active/done classes triggered itself indefinitely, consuming a browser core and preventing page load. On the two corporate scheduled boards, the standard engine retains its period/highlight logic but ignores mutations containing only class changes. This is a narrow runtime repair, not a claim that the engine was copied unmodified. Lead has the finding for a shared engine follow-up.

Four default photographs are local Unsplash stock portraits, 1000×1200 JPEG. `corporate/assets/README.md` records source image URLs, license link and fictional profile status. No runtime photo API or hotlink is required. All-hands uses contain for the default headshot to keep the face visible; operator fit remains available.

## Verification and evidence

Evidence root: `/Users/gschiemann/Desktop/template-flagship-audit/corporate/`.

- Three concept variations × eight boards × two orientations × Chromium/WebKit = 96 concept captures, followed by fixes and final captures.
- 32 original before images and 32 final after images, named by board, orientation and browser. The two `corporate-before-after-*.jpg` sheets compare all eight boards and both orientations for Chromium and WebKit.
- Null-origin `sandbox="allow-scripts"` iframe verification: 32 browser/orientation scenarios, each with baseline and realistic long-copy edits. Real clicks emit the expected text/image field keys; text and primary-brand postMessage edits apply. Final small-font, editable-block scroll clipping and off-stage text checks are empty in both baseline and edited states. Long-copy screenshots are retained beside the final captures.
- Focused Chromium/WebKit behavior checks pass: countdown arithmetic, schedule edits, operator countdown/clock pins, K/M currency ratio calculation, freeze-mode readable typography, photo clear/replacement, and explicit portrait/landscape query handling. `live-behavior-verification.json` records two passing engine entries and no page errors.
- Every baked script in the eight changed files passes `node --check`; original V14 and media block equality is checked, and every legacy text/image key survives. `source-contract-verification.json` contains the detailed counts.

The range-box overlap diagnostic can report adjacent large display lines whose font metric rectangles intersect (for example Hello/Acme and All-/Hands). These are not asserted as zero; their actual glyphs and spacing were inspected in the screenshots. Editable-block clipping and off-stage metrics are the objective gates. This is finite-template content verification, not a promise that arbitrary unlimited text can fit a fixed screen.

## Lead integration steps

This commit contains source/assets and this report only. Lead must integrate central V15 changes, rebuild affected API exemplars, regenerate corporate gallery posters/provenance and run centralized browser checks. No source commit is represented as published, live or deployed. Worktree remains attached for the separately assigned bar/QSR wave; archive only after its commits and report have been integrated and preserved.
