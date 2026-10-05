# Library deletion, saved template previews and startup status

Implementation: October 1, 2026. This follow-up changes the CMS and API. It does not require a new APK, change screen canvases, or change the emergency workflow.

## Website screenshots and hover previews

Three operator requests: a website shows its real screenshot wherever a
thumbnail appears; hovering a playlist's thumbnail steps through its images;
hovering a template's thumbnail runs the template. This is what the code does.

### The rules every hover preview follows

`apps/web/src/lib/use-hover-preview.ts` is the one definition, used by both
hover previews.

- Mouse or pen only. A tap (`pointerType: 'touch'`) is ignored.
- One at a time, page-wide. A second preview starting stops the first, even if
  the first never received its `pointerleave`.
- It stops on leaving, when the tab is hidden, and when the thumbnail scrolls out
  of view under a parked cursor.
- Nothing runs at rest. No timer, observer or document listener exists until a
  hover begins.
- Images are shown whole (`object-contain`, letterboxed), never cropped.

### Websites

`previewOf` returns kind `website` with the address exactly as stored.
`WebsitePreviewThumb` draws it in the Media Library grid and list, playlist
thumbnails, dashboard schedules (both layouts), the fleet map's screen tiles,
screen rows and the screen's content card. The Media Library, the playlist
editor, the new-playlist wizard and `PlaylistPreviewThumb` all build the URL
with `websitePreviewUrl` (`apps/web/src/lib/website-preview.ts`).

The screenshot still comes from the existing WordPress mshots service, so the
operator's URL is sent to that third party. The URL is the stored string,
unchanged, so a site already warm in the Media Library stays warm everywhere.
It is **not** sent, and the tile shows a labelled globe instead, for:

- anything that is not an absolute `http(s)` URL;
- a URL with a username or password;
- `localhost`, loopback, `10.x`, `172.16-31.x`, `192.168.x`, `169.254.x`,
  CGNAT (`100.64/10`), multicast/reserved, any IPv6 literal, `*.local`,
  `*.internal`, `*.lan`, `*.localdomain`, `*.home.arpa`, `*.intranet`, `*.corp`,
  `*.home`, and single-label names such as `http://intranet/`.

It cannot catch a public hostname that merely resolves to a private address
(for example `127.0.0.1.nip.io`); a browser has no DNS to ask.

A screenshot the service is still taking fails to load. The thumbnail retries
three times, 1.5 s, 3 s and 4.5 s apart, then shows the labelled globe. Timers
are cleared on unmount and when the website changes. The page address is never
written into a `title` or other attribute.

### Images

**Slow at rest, quick under the pointer.** Pointing at a thumbnail is asking to
see what is in it, so the one thumbnail a mouse or pen has rested on moves at a
pace a person can follow. Many thumbnails moving by themselves gave the owner a
headache (2026-09-16), so whatever moves at rest stays slow. The quick numbers are
`IMAGE_PREVIEW_*` in `ImageSequenceThumb.tsx`, and both thumbnails below use them:
the first step comes 350 ms after the pointer lands (a pointer merely crossing the
tile never flips it), then each picture is held 1.2 s with a 250 ms cross-fade. Under
`prefers-reduced-motion` it still steps, with no fade. Only one thumbnail on the
page can be under the pointer, so quick never becomes a wall of motion. A walk
never steps to a picture that has not loaded: it never fades to a blank or
half-drawn frame. Touch never starts it. If it ever needs to be faster or slower,
those three constants are the only numbers to change.

- **Playlist library grid** (`PlaylistPreviewThumb`). At rest, unchanged: an image
  playlist with two or more images rotates, 7 s a frame with a 900 ms
  cross-fade, over at most five images with a "+N" count. It runs only while at
  least a quarter visible and not at all under `prefers-reduced-motion`. This is
  the only preview that moves at rest. Once a pointer has rested on it for 350 ms
  (`useHoverPreview`'s hover intent), that one slideshow steps at once and runs the
  quick cadence over the same five pictures, and the slow rotation pauses while the
  pointer is there. Leaving settles on the picture being shown (it does not jump
  back to the first) and the slow rotation carries on from there. A pointer that
  only crosses the tile changes nothing, not even the slow rotation's clock. The
  quick walk passes over a picture that is still loading or broken, and waits
  when none other has arrived. A slow fade still in progress when the pointer
  rests is allowed to finish before the first quick step.
- **Dashboard, screen rows, screen content card, fleet schedule rows.** The
  first image at rest, in play order (`sequenceOrder`, then position). On hover
  (`ImageSequenceThumb`) the first step comes after 350 ms, then each image is held
  1.2 s and cross-fades for 250 ms; under reduced motion it still steps, with no
  fade. At most two `<img>` exist at once: the one on show and the next,
  preloaded invisibly the moment the pointer lands. A picture that fails to load
  is skipped for the rest of that mount and never retried in a loop. Leaving
  returns to the first picture. One image is a plain still with no listeners.

### Templates

`TemplateContentThumb` shows the saved artwork at rest (a poster, or the frozen
frame of a customised board). After the pointer has rested 250 ms on it, the
template is mounted live as a separate layer on top of the artwork. The saved
artwork is never replaced or reloaded, so there is no blank frame while the live
frame loads, and leaving simply removes the layer. A board's own carousel runs at
its saved interval while hovered. A list with many thumbnails therefore has at
most one live render. `ScaledTemplateThumbnail` itself is unchanged.

The playlist library keeps its framed 180 px tile and 40 px strip look; the
dashboard and screens fit the artwork to their frame.

A live render of a menu board reads the POS menu once and then every
30 seconds while hovered (the widget's own feed); it stops on leaving.

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
