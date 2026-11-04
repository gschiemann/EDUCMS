# Template final catalog review

**Scope:** read-only review of `codex/hospitality-guest-essentials` at `b274874bc`, merged with `origin/master` at `3525dd3e8`. No worktree edits, app run, or tests run.

## Catalog and asset findings

- The Essentials API generator expands 12 source designs into 24 presets, and the new focused spec checks each ID appears once in `ALL_PRESETS`, is not quarantined, matches the marked web picker block, has the expected vertical, dimensions, orientation URL, and an existing source. The web picker block has 24 entries.
- API and picker registrations match for the three legacy portrait additions (`museum/01-today-flagship`, `real-estate/01-availability-flagship`, `bar/09-hours-location`). `REVIEWED_BOARD_PORTRAITS` now includes their IDs. The 12 Essentials source URLs and the legacy URL/font/photo references inspected resolve to tracked files.
- New font assets are covered by SIL OFL notices: Cormorant Garamond and Fraunces under `signage/refresh-assets`; Manrope, Newsreader, Space Mono, and Syne under the existing commercial-touch asset pack. New Essentials HTML points to those existing licensed font files. No missing font/license reference found.
- `essentials-catalog.json` is a 12-entry build manifest (one per business/source), not an orientation catalog; its URLs resolve. Preset orientation variants are declared in API and picker registries.

## Concrete release blockers

1. **Legacy builder save/reopen remains unverified and has a recorded failure.** The November 3 checkpoint says Bar Hours reopens with the saved `imageOverrides` in the iframe URL while hidden `media.venue.photo.slides` reverts to the authored image; it also says museum/real-estate saved-click targeting is not yet verified. The same handoff explicitly says not to publish the legacy repairs until resolved. This blocks release of the legacy repair portion of this batch; default geometry captures do not clear it.
2. **Asset provenance is incomplete.** The checkpoint explicitly requires a complete provenance writeup. The proposal README says the hospitality photos are byte-for-byte reuses and instructs confirming their provenance before publication; the museum image is described as generated, but the inspected release records do not contain a complete provenance record for it. Font licenses are present, so the gap is photographic asset provenance rather than font licensing.

## Release packet cleanup

`docs/design/proposals/2026-11-01-guest-essentials/README.md` still says approval is pending, not registered, and scope is one hospitality-only selection. That conflicts with the approved four-vertical, 24-preset release reflected in the November 3 checkpoint and source catalogs. Refresh this README before using it as release documentation; it is not a catalog-code defect.

**Recommendation:** catalog registrations and font/license paths are internally consistent. Do not mark the combined template batch ready for release until the legacy builder persistence issue is fixed and photographic provenance is documented. Essentials-only readiness is a separate decision; this review did not independently rerun its recorded browser evidence.
