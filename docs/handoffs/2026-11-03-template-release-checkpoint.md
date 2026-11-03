# Template checkpoint — November 3, 2026

Owner approved all three Guest Essentials directions and business adaptations, then requested repairs to unfinished templates. On November 3 the owner expanded the active priority: “get all PR's publlished that have been tried to be pushed”. Preserve this template branch while handling that release queue; it is not published or ready to merge yet.

## Implemented

- Three approved compositions × hospitality/corporate/gym/healthcare = 12 HTML sources, 24 landscape/portrait presets. API and builder registrations, explicit business verticals, native photo carousels, editable copy/images/logo/theme/fonts.
- Real-estate Availability, Museum Today, and Bar Hours redesigned. Both orientations are composed and their three missing portrait presets registered.
- Canonical V16 editing shim + V2 media companion. New Essentials sources mark native carousel ownership and defer the shared adapter so it captures authored defaults correctly.
- Museum photograph generated for this design; Cormorant Garamond and Fraunces assets include OFL licenses. Complete provenance writeup remains required.
- Gallery posters regenerated for all 15 sources, both orientations, with source hashes; poster version 20261103essentials. Derived catalog: 564 presets, 342 canonical board files.

## Evidence

- Essentials: 48 default geometry renders (12 sources × two orientations × Chromium/WebKit), zero recorded errors/overflow/intersections; current native-marker version.
- Essentials: 24 real production-app builder checks passed (mocked API), covering text/font and image replacement, Fit/Rotate, Undo/Redo, save/reopen for three hospitality designs × orientations × browsers.
- Essentials: 24 bridge cases passed across all 12 business sources and both engines, including restore/remove distinction, URL state, theme edits and auto-orientation. Representative carousel rotation/pause verified.
- Legacy repairs: 12 default geometry renders passed (three sources × orientations × engines), no recorded errors/overflow/intersections. Parent visually inspected full-board renders.
- Focused catalog tests: 8 passing across Essentials and existing gap-presets specs.
- Editability, rulebook, Taurus safety and inset guards pass. Designer exemplar freshness check passes without changing exemplars. Standard production web build succeeded before the final catalog/poster metadata updates.

## Remaining defect and required work

Legacy repair builder verification is NOT green. The photo test's center click hits overlaid text on museum/real-estate; initial click now targets the photo's clear upper area, but saved-click targeting still needs verification. More importantly, Bar Hours saves the correct imageOverrides array and reopens with that array in the iframe URL, yet its hidden media.venue.photo.slides returns to the authored photo. Direct standalone URL load succeeds; investigate the real sandboxed builder's message/load ordering. Do not claim legacy save/reopen or publish these repairs until fixed. Interrupted legacy run is not a pass. Temporary diagnostic console output was removed.

Other remaining steps: parent-container bounds and plausible-longer-copy checks; persistent portable regression scripts; provenance; refreshed production build; final review package; scoped PR/CI and deployment verification. Source-only audit reports are preserved under 2026-11-02-essentials-reports; those are not visual certification of the rest of the catalog.

## Older work investigation

See older-template-publication-audit.md. Some older branches contain upstream equivalents despite non-ancestor commits. Bottle Service is still explicitly unaccepted with geometry defects; Christmas/hospitality/QSR hiring refinements and dedicated JLL/Meridian work remain branch-only. Never merge their entire old branches blindly.

No production database, account, fleet, emergency operation or deployment was performed for this template chunk. Rollback is omission/revert of this branch; preserve the working evidence.
