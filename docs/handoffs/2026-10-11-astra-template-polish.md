# Astra review and template follow-up — 2026-10-11

Astra independently reviewed the delivered refresh: 57 rebuilt sources, 24 sports variants in both capture orientations, the three new workflows in both orientations, and saved editor evidence. Its verdict is substantial improvement with professional exemplars, but not a consistently world-class library. The exact covered scope and the 21-section Design/UX/Functionality matrix are in [the full review](../research/2026-10-11-astra-template-review/01-astra-review.md). This is a bounded corrective follow-up, not a claim that all 453 offered presets were redesigned.

## What changed

- Elementary Schedule V1/V3: landscape subject and room/teacher copy now have separate aligned columns instead of oversized stacked boxes crossing row rules. All six rows and every key remain. Portrait retains stacked subject/metadata, with room information explicitly visible. Live Now badges have adequate room.
- V1 weather/attendance captions wrap inside their cards at the original 60px floor. The main heading has an explicit height so it can use its intended large display size instead of dropping to its minimum. Existing bright Nunito/Fredoka identity remains.
- V3 portrait clock has enough width for time plus AM/PM on one line. Existing Poppins/Space Grotesk identity remains.
- Care Services and Booking Guide: portrait photograph uses authored 27% vertical position rather than 20%, showing the complete face above its caption. Landscape and editable image slot/source stay intact. Clearing media overrides restores the authored orientation-specific crop.
- Poster generation accepts optional validated relative source paths, enabling genuine scoped captures without refreshing unrelated boards. Three source posters/provenance refreshed, including the registered care-guide portrait; POSTER_VERSION is 20261011c.

URLs, text/image keys, saved override contracts and live schedule logic remain. Preservation check covers 164 unique keys across the three documents. Both baked generic and media scripts are byte-identical to the pre-patch sources; scoped injectors confirm no runtime regeneration was necessary. Approved exemplar generation and --check pass without changes to the generated catalog.

## Verification

- 32/32 targeted Playwright tests passed in Chromium and WebKit: schedule field visibility/font floor, rendered text bounds versus containing rows, field collisions, tile caption containment, saved text reload, live Now, click-to-edit, photo source/crop/rotation restoration after first edit and saved reload, independent video poster restoration, repeat-row restoration.
- Before/after measurement found 24 landscape metadata boundary violations across both browsers before the patch and zero in the 12 final renders. This catches the bug that individual-node scroll checks missed.
- Lead inspected final renders; Astra individually inspected all 12 and accepted both concrete findings as resolved with no visible regressions. [Independent acceptance](../research/2026-10-11-astra-template-review/02-fix-verification.md).
- Web TypeScript check passed. Real poster capture completed three boards with zero failures; poster-freshness and approved exemplar --check passed. Full pnpm preflight passed after replacing out-of-root dependency links with an isolated frozen-lockfile installation. Post-push CI/deployment results are recorded separately in the durable release checkpoint; pending/cancelled runs are not treated as green.
- Evidence: [capture/measurement/preservation files](2026-10-11-astra-template-polish/). Additional logs and authoring scripts: /Users/gschiemann/Desktop/template-flagship-audit/astra-polish/.

## Open follow-up work — do not mark complete

1. Shared Crop/Reposition next to Fit for standalone and embedded media: drag focal point, zoom, Reset/Done/Cancel, Escape/arrow keyboard controls, one Undo step, normalized saved focal coordinates and authored reset. Astra identified current patchBoardMedia fit/rotation/hidden as insufficient. Design the shared contract before editing all baked companions.
2. Field-capacity feedback and repeat limits: explain when copy needs more room and show capacity before adding rows. Classify the earlier 250 repeat diagnostics; they are not all established release regressions.
3. Bottle Service and Hospitality Events: deliberate hierarchy/density improvements, preserving all media slots and POS adapters. Start with studies and verify both orientations instead of another library-wide theme.
4. One flagship sports study per sport (Touchdown, Three Pointer, Home Run), then propagate only proven typography/contrast changes. Determine whether the earlier portrait letterboxing is a harness artifact before treating it as production geometry failure. Motion/live triggers were not reviewed.
5. Optional Care Services table/booking hierarchy polish and later photo improvements for Commencement/new hires/QSR hiring. The specific care-guide face crop is fixed; the whole optional composition recommendation is not closed.

No emergency, auth, billing, live-data triggers or customer-specific source data changed. Player hardware qualification is outside this static template patch.

## Prior release CI correction

The original corrected full run 38175871146 was superseded/cancelled by later app pushes. Build/Lint/Test passed (9,673 API tests); Chromium passed (788 passed, four skipped); WebKit was cancelled. The older release handoff's pending status is historical, not a full-green claim. Monitor the current master run after this follow-up push and report its actual outcome.
