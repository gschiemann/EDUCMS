# Guest Essentials — first owner approval chunk

Date: November 1, 2026 (America/Los_Angeles). Builder: Codex, GPT-6, Codex desktop. Branch: `codex/hospitality-guest-essentials`, based on fetched `origin/master` at `d24392a7d`.

## Situation and owner instruction

The owner requested new flagship templates in small chunks, with approval followed by publication. Start with one missing workflow: Hospitality Guest Essentials. Prepare three visual directions for that one workflow; the owner selects before production integration. The existing publication freeze is respected. No approval of a particular design or release is inferred.

## Reviewable result

`docs/design/proposals/2026-11-01-guest-essentials/index.html` compares A / The Guest Edit, B / Easy Days and C / City Guide. Each source supports landscape (3840×2160) and portrait (2160×3840) via `?o=` with a separately composed layout. Sample content covers Wi-Fi, breakfast, checkout, pool/fitness, airport shuttle, reception help and step-free entry. Hotel identity and policies are fictional placeholders.

All visible words have `data-field` attributes, every logo/photo has a `data-imgslot`, and the 12 canonical theme tokens are present. Fonts and existing hotel photos are packaged for offline review. Font license notices are retained. This is HTML design authoring, not flattened images.

## Validation

Twelve default renders pass: three directions × two orientations × Chromium/WebKit. Zero page errors, zero measured field overflow or text boundary violations, zero detected text intersections, zero text outside the stage, and all visible text at its declared 50px supporting / 60px body minimum or larger. The fit routine checks rendered text bounds after fonts load. Source screenshots were inspected during iteration; initial overflow failures were corrected before delivery.

These claims are bounded to authored defaults and these desktop browser engines. They do not establish arbitrary text capacity, live CMS editing, save/reopen, media replacement, legacy player or hardware qualification. No production tests or deployments were performed. The earlier session ops sweep could not reach services from the sandbox; this is not a confirmed outage.

## Recommendation and decision

Recommend A as the first hotel template for its calm reading order and broad hospitality fit. B is the more colorful resort option. C prioritizes contrast and a numbered city-guide layout. Owner can choose one, request a combination or changes, or approve more than one for subsequent small releases.

## Next stage after direction approval

1. Finish the chosen source in the existing template contract; inject the current official generic and media companions (current fetched source uses generic V16).
2. Verify actual builder click-to-edit, text/theme/image edits, Fit/Rotate/reset, saved reopen and both orientations in Chromium/WebKit. Check plausible longer copy and all repeated-content capacity. Maintain original authored composition.
3. Confirm inherited photo provenance or replace it with a documented licensed/generated asset. Keep all image and brand slots replaceable.
4. Add only the selected new Hospitality preset in landscape/portrait, picker registrations and real preview/source-hash records. Follow current localization rules for any new app UI/catalog strings. Do not claim a user-approved AI exemplar until the owner has explicitly approved the final visual result.
5. Prepare a scoped PR with evidence and rollback, observe required CI, and obtain release approval under the owner's requested workflow. The designated lead handles merge; publication verification follows it.

## Risk, blast radius and rollback

This chunk writes proposal docs and local review files only. It changes no production assets, presets, application runtime, database, accounts, player, fleet actions or emergency path. There is no deployment in this chunk. The proposed source remains isolated in its worktree. Rollback before integration is simply omitting the proposal from a release; preserve its artifacts.

## Scoped standard audit surface

Partial: 2 (source assets only), 14 (one hospitality workflow), 15 (Chromium/WebKit only), 18 (visual readability only), 19 (authoring attributes only), 20 (design/guest task), 21 (render evidence). Deferred: 1, 3–13, 16–17, and the untested portions of the partial surfaces. This is not a full application audit or security review.

## Durable artifacts

- Proposal sources/assets and authoring script under `docs/design/proposals/2026-11-01-guest-essentials/`.
- `validation.json` records all 12 final cases; `capture.cjs` reproduces the browser evidence (uses the original checkout's installed Playwright dependency).
- User-facing review package: `/Users/gschiemann/Documents/Codex/2026-11-01/i-n/outputs/guest-essentials-review/`.
- Initial/intermediate browser failures remain in this chat's tool records; final evidence does not call those earlier runs passes.

Status: **designs ready for owner review; not published; final CMS integration unverified.**
