# Library deletion, saved template previews and startup status

Implementation: October 1, 2026. This follow-up changes the CMS and API. It does not require a new APK, change screen canvases, or change the emergency workflow.

## Asset deletion

Previously the bulk action called the single-file mutation in a loop. Each file invalidated asset, playlist, schedule and screen queries. The UI visibly removed one card at a time and waited through repeated reads. Folder deletion only kept files, and selection only covered loaded cards.

The library now has Select all. It reads existing paginated asset data in pages of 1,000, applies the current folder/media/search scope, and selects matching IDs beyond the initially loaded cards. A request generation guard prevents an old selection response from replacing a selection after navigation or filter changes.

One confirmation explains playlist usage and protected content before deletion. The mutation removes all selected cards together, clears the selection, and shows a small progress message while browsing remains available. Only files confirmed deleted stay removed; protected or unconfirmed files return to the list. Query invalidation happens once after the operation rather than after every file.

The client sends sequential chunks of at most 20 IDs:

```http
POST /api/v1/assets/bulk-delete?confirm=in-use
Content-Type: application/json

{"ids":["asset-one","asset-two"]}
```

```json
{
  "results": [
    {"id":"asset-one","deleted":true},
    {"id":"asset-two","deleted":false,"code":"ASSET_IN_EMERGENCY_CONTENT","message":"Protected content was kept."}
  ]
}
```

`apps/api/src/assets/asset-delete-batch.ts` limits execution to two active deletions across overlapping batches in each API instance. A batch delegates each ID to the original `AssetsController.remove(req, id, confirm)`. Its tenant check, emergency refusals, in-use confirmation, serializable transaction, fallback/unpublish behavior, awaited audit and shared-storage checks remain intact. Invalid batches fail before any deletion starts. The endpoint retains the existing admin role requirements.

`apps/web/src/lib/asset-bulk-delete.ts` does not retry a mutation after losing its response. Such IDs are explicitly unconfirmed, remaining chunks are not started, and a final refresh establishes actual state. This is not a durable background job or an all-or-nothing transaction across the entire selection. Already completed file deletions remain completed.

## Folder confirmation

`GET /api/v1/assets/folders/:folderId/deletion-summary` scopes folders and asset IDs to the current tenant and returns the subtree's current file count. The first confirmation offers:

- Delete folder, keep files: the existing behavior, with direct files moved to All files and child folders moved up a level.
- Delete folder and contents: checked explicitly by the user; every confirmed subtree asset goes through the same guarded bulk deletion.

After all selected files report success, the client calls `DELETE /assets/folders/:folderId?mode=empty-tree`. A serializable transaction checks that the subtree is still empty, deletes tenant-scoped empty folders, and awaits `ASSET_FOLDER_DELETED` audit creation. Any protected file, failed deletion or intervening upload keeps the folder. The default keep-files operation also runs atomically with its audit. Neither choice permits emergency content deletion.

Files: `FolderDeleteDialog.tsx`, `assets/page.tsx`, `use-api.ts`, `AssetsController.folderDeletionSummary/deleteFolder`.

## Template preview parity

The dashboard previously searched only image assets. A playlist consisting entirely of a template therefore showed a generic icon. The playlist library also depended on the gallery query finding the template, and screen previews lacked geometry for custom/zone templates.

Playlist list/detail responses now carry the template's dimensions, background and saved zone geometry/configuration, plus its first scene ID. No per-row template query is needed. `template-preview.ts` normalizes string configurations, preserves saved edits and selects first-scene/global zones. `PlaylistPreviewThumb` prefers this data over a gallery lookup.

Both dashboard schedule views, screen rows and screen details share `ExpectedThumb`. Its `TemplateContentThumb` fits the existing scaled template renderer inside the available frame. Pristine boards use cached poster images; customized boards and zone templates use the existing frozen, visibility-gated renderer. Existing opaque iframe sandboxing remains in force. Screen details label the result as saved artwork, not a physical capture. Video/image preview behavior is retained.

The API does not generate or persist new preview files in this change. Posters that fail load fall back through the existing scaled renderer. Dynamic data in a preview remains a preview; it does not prove that a device received the playlist.

## Startup versus actionable failure

`playlistOps.ts` previously classified connecting, loading the first item and waiting states as a playback issue. Those proofs describe a player that has not started the content yet. The playlist workspace could consequently show an amber failure before the new playlist arrived.

These states now remain neutral while waiting for a playback report. A fresh update whose older proof predates the request also remains neutral during the existing two-minute delivery grace. The comparison determines report freshness only; acknowledgement still uses exact value identity. Requests still unreceived after that grace remain actionable. A new explicit unavailable-content report, stalled media, stale proof, credential fault or offline target is still visible. A problem on another screen is not hidden by a screen that is starting. A future scheduled playlist does not inherit the current screen's playback fault.

The rollup's Sending update state is neutral and creates no exception banner. Both the workspace header and Screens delivery panel use that policy. Missing status data never becomes a healthy confirmation.

## Map heading and playlist toolbar

Several groups saved at the same physical address share a location pin. `storeLocationName` uses a stable group name with an additional-groups suffix instead of making the street the location's name. The detail panel keeps the address separate and names every group below it. Saved addresses, coordinates and physical grouping are unchanged.

Playlist selection actions now occupy the top header toolbar. Remove has its full count and no trailing ellipsis; it does not depend on a separate selection strip. The existing deletion confirmation and role restrictions remain.

## Dependency patch

The October 1 production dependency scan caught [GHSA-c475-qrg2-pj4r](https://github.com/advisories/GHSA-c475-qrg2-pj4r) in the transitive `basic-ftp` dependency. The root override now pins affected versions to patched 6.2.1, and the lockfile was regenerated. The Puppeteer proxy/get-uri chain loads the patched CommonJS module and its required Client methods successfully. No scanner exclusions or raised security baselines were added.

## Verification

Tests cover batch limits across concurrent requests, partial outcomes, tenant scoping, audit failure, new/protected files keeping a folder, optimistic cache recovery, selection beyond the loaded page, folder choices, real saved preview rendering, shared-location names and startup/failure boundaries. Chrome and WebKit browser cases exercise the production build with isolated API fixtures; no production customer assets are deleted by verification.

Local verification: all 436 web unit suites / 6,648 tests pass; 54 targeted API tests and all 34 Chrome/WebKit production-build browser cases pass without retries. TypeScript, tenant isolation, i18n, mobile-performance and inset checks pass. The production dependency audit reports zero vulnerabilities.

Release-specific test counts, CI results, deployment receipts and remaining physical checks are tracked in the local cumulative follow-up checklist. A browser preview is not hardware qualification. The earlier LED publishing fix and continuous-video playback changes remain separate from this CMS follow-up.
