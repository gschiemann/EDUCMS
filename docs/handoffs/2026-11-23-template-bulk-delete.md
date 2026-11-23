# 2026-11-23: bulk template delete, and picking templates one by one

Branch `claude/template-bulk-delete`, cut from `origin/master` at 1292fd287. Web only: no API file, no schema, no player code changed.

## What the owner reported

1. "I'm trying to delete all my custom templates, I selected all hit delete and it said 8 were in use and couldn't delete them but it also didn't delete all the other ones, seems like it quit when it found one in use, it should delete all not in uses then pop up for each one in use and ask me if I want to delete anyways...keep it simple and don't make me work to remove shit I want to".
2. Later: "I can't check multiple templates to delete all at once, all I have is a select all but not individual selection...add that just how we have the assets so I can pick multiple templates and delete".

## Why it failed

- **Select all reached one page.** The selectable set was the visible slice of the gallery (`customTemplates.slice(0, SECTION_PAGE_SIZE)`, 12 cards), so templates past "View all" were never selected and never deleted. The box over the tiles and the bar's "Select all N" both used that slice.
- **The bulk delete never forced and called every failure "in use".** `bulkDeleteTpls()` looped the selection one at a time without `force`, counted any error as "skipped (in use)", and told the operator to delete those one at a time.
- **No individual selection in practice.** Every grid tile already rendered its own `SelectionTileCheckbox`, but the tile wrapper had no `group` class, and the box only reveals on hover of a `group` ancestor (`apps/web/src/components/common/SelectionCheckbox.tsx`). On a device that can hover the box never appeared. The list view had no selection at all.

## What changed

All of it is reached from the route `apps/web/src/app/[schoolId]/templates/page.tsx`: the page renders the grid tiles and `TemplateListView` (defined in the same file) and imports `ConnectedTemplateBulkDeleteDialog`.

- **Select all means all.** The box on the heading line selects every one of your templates the current search and filters match, never a system preset, and names the count ("Select all 30 of your templates", en/es/zh). It serves both grid and list view. The selection is pruned against the filter-matched ids (not the view mode), so a filter that hides a template drops it from the selection, and a grid/list toggle keeps the selection.
- **Pick templates one by one, as on Assets.** Grid: the tile wrapper is now a `group`, so hover or keyboard focus reveals the tile's box; a touch screen always shows it (the shared component's no-hover behaviour, unchanged); once anything is selected every tile shows its box; a selected card wears the shared `SELECTED_TILE_CLASS` ring. List: `TemplateListView` takes a `selection` and draws the shared compact box on every row of yours (none on a preset row), with the Assets table's selected-row tint. Both are real focusable checkboxes with the visible focus ring.
- **One dialog before anything is deleted** (`apps/web/src/components/templates/TemplateBulkDeleteDialog.tsx`). "Delete N templates?". Templates the list reports in use get a fresh `GET /templates/:id/usage`, 3 in parallel, and are listed with their playlists and screens reached, each with a checkbox **checked by default**, under a line saying deleting removes them from those playlists, which fall back to their next layout. A template used by an emergency playlist is listed as "Kept: used by an emergency playlist" with no checkbox and is never part of the delete plan. One button deletes the free ones plainly and the checked in-use ones with `force=true`, 3 at a time, with "Deleting X of N…" on the button. Focus starts on that button; Escape cancels; it fits 390px.
- **Usage that changed mid-run is asked about again, never forced silently.** A plain delete that answers `TEMPLATE_IN_USE` goes into one follow-up dialog for just those templates, with a fresh usage read and the same rows. A forced delete the server refuses with `TEMPLATE_EMERGENCY_IN_USE` counts as kept (emergency). Any other error is reported as failed with its own message, never as "in use".
- **An honest toast.** Deleted / kept (emergency playlist) / kept by choice / failed with the first error message. Only templates that were settled leave the selection; failed ones stay selected so a retry is one click.
- **One selected template** keeps the existing single-delete dialog with "Delete anyway".
- The planning (partition into free / in use / emergency, the delete plan, bounded runs, the tally and summary) is a pure module, `apps/web/src/components/templates/template-bulk-delete.ts`, with jest tests.

The server's emergency guard in `apps/api/src/templates/templates.controller.ts` (`TEMPLATE_EMERGENCY_IN_USE`, even with `force`) is unchanged; the diff touches no API file.

## Why one dialog and not one popup per in-use template

The owner asked for a popup for each in-use template asking "delete anyway?". With 8 in use, that is 8 more dialogs and 8 more clicks. The one dialog lists a row per in-use template, each pre-checked, so it is the same choice per template, and the default ("yes, delete it anyway") costs one click for all of them. Unticking a row is the "no" for that one template. That keeps "don't make me work to remove shit I want to". If the owner still wants one popup per template, the rows already hold everything each popup would show.

## Tests

- jest: `apps/web/src/components/templates/__tests__/template-bulk-delete.test.ts` (planning), `apps/web/src/components/templates/__tests__/TemplateBulkDeleteDialog.test.tsx` (the dialog), and the `multi-select` block in `apps/web/src/app/[schoolId]/templates/__tests__/gallery-states-calm-v1.test.tsx` (tile box inside a `group`, selected ring, a box per list row and none on a preset, grid/list/grid keeps the selection, the heading box in list view, no boxes for a restricted viewer).
- Playwright, Chromium, mocked API: `apps/web/tests/e2e/templates-bulk-delete.spec.ts`. 30 templates of yours (more than one page), 8 in use, 1 emergency-protected. One click on the select-all box gives "30 selected"; one dialog lists 8 + 1; confirm deletes 29 with force on exactly the 8; the emergency one is never sent a DELETE; the toast numbers match; peak concurrency is 3 or less. Also: untick keeps one, a template that came into use mid-run is asked about again, one that turned emergency is kept, a real failure says so and stays selected; 390px fit, focus on Delete, Escape cancels; hover reveals a tile's box and 3 picked by their own boxes deletes exactly those 3; in list view 2 rows (one ticked by keyboard) survive grid/list toggles and exactly those 2 are deleted.

### Running the e2e on this box

The repo's pinned Playwright looks for `chromium_headless_shell-1217`; the box has 1243. The launch error that gives is not a test failure. Run with a temporary, uncommitted config that sets `launchOptions.executablePath` to `/opt/pw-browsers/chromium` (as `docs/handoffs/2026-11-13-session-handoff.md` describes), against a prebuilt bundle (`NEXT_PUBLIC_API_URL=http://api.invalid/api/v1 NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter web build`, then `E2E_PREBUILT=1`). Never run `playwright install`.

Two more traps seen on this run:

- Keep the default port. `templates-delete-in-use.spec.ts` and `template-preview-and-startup.spec.ts` hard-code `http://localhost:3000` as the CORS origin of their mocked API, so with `E2E_PORT=3117` every gallery load fails ("Templates couldn't be loaded") and those specs go red for a reason that is not in the product. On :3000 they pass.
- `templates-gallery-perf.spec.ts` sets its own `launchOptions` with `test.use`, which replaces the config's, so the `executablePath` override does not reach it and it fails at launch. It was run from a temporary copy with `executablePath` added to its `test.use` (deleted after the run).

## Gates run on this branch (head before this handoff: 2ecdfeae7)

| Gate | Result |
|---|---|
| pnpm lockfile drift (`install --frozen-lockfile --lockfile-only`, `git diff --exit-code pnpm-lock.yaml`) | pass |
| web `tsc --noEmit` | pass |
| `pnpm --filter web build` (with `NEXT_PUBLIC_API_URL=http://api.invalid/api/v1`) then `check-bundle-budget.cjs` | pass; 2180 chunks, 20.02 MB, within the ceiling |
| web jest, full suite (`--ci --maxWorkers=3`) | pass; 714 suites, 10,496 tests |
| `check-i18n-parity.cjs` | pass; 7,679 keys in en, es, zh |
| `mobile-perf-guard`, `check-pill-rules.cjs`, `check-inset-serialization.cjs`, `check-rulebook.cjs`, `check-request-budget.cjs` | pass |
| `check-schema-has-migration.cjs` | pass; schema unchanged |
| eslint on the changed files | new files clean; `page.tsx` 61 errors, the same 61 as on master, 0 jsx-a11y errors, 0 rules-of-hooks errors |
| Playwright, Chromium: `templates-bulk-delete` (5), `templates-delete-in-use` (11), `template-preview-and-startup` (13) | 29 of 29 pass |
| Playwright, Chromium: `templates-gallery-perf` (from the temporary copy) | pass |
| WebKit | not run |

## Reviews

Two review rounds by Fable 5.2, the same vendor as the builder, under the owner's written waiver "Don't worry about another model review". Round 1 asked for one must-fix (the box over the tiles still selected only the 12 shown) and six should-fixes, all done in aa75b83f4. Round 2 approved, with three nits left as they are:

- A template the list reports with 0 playlists skips the usage read, so an emergency-protected template with a stale 0 count gets one plain (non-forced) DELETE. The server refuses it and it lands in the follow-up as "Kept: used by an emergency playlist". Safe, but "never sent a DELETE" holds only when the list count is current.
- In a follow-up round, a row whose re-read shows it free again is deleted by the confirm button but is not listed. The title and button counts are right.
- With a selection active on desktop, the bar's "Select all 30" sits next to the heading box that does the same thing. That matches the shared selection pattern.

## What is unverified

- **WebKit and Safari.** The e2e and the gallery were run in Chromium only. The code avoids `.remove()` on React nodes and uses no WebKit-sensitive API, but nothing was run in WebKit or on a real Safari or iPad. Run `templates-bulk-delete.spec.ts` in the webkit project (or let cross-browser CI do it) before calling it done there.
- **A real phone.** 390px was checked in Chromium's viewport, not on a device. Touch behaviour (boxes always shown without hover) comes from the shared `SelectionCheckbox` and is not new here.
- **Production.** Not deployed. Done means merged to `master`, CI green, and the deploy serving the merge.

## Rollback

Revert the PR. Web only, no migration, no stored data changes; the previous build runs as before.
