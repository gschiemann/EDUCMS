# Template deletion and location logos

September 30, 2026. These follow-ups retain the emergency workflow, deletion safeguards, auth, tenant isolation and audit writes.

## One template deletion confirmation

Before this change, the gallery opened a generic confirmation, tried DELETE, then opened a second confirmation when the server reported `TEMPLATE_IN_USE`. The new first dialog immediately checks current usage and shows the affected playlists before enabling Delete. A template already known to be in use needs one final **Delete anyway** click.

`GET /api/v1/templates/:id/usage` is admin-only and read-only. Both the template and its referencing playlists are constrained to the caller's tenant. It returns:

```ts
{
  playlists: Array<{ id: string; name: string }>; // first six names
  total: number;                                // all referencing playlists
  screensReached: number;                       // union, not summed twice
  locations: number;
  protectedEmergency: boolean;
}
```

The existing emergency-use reader supplies a boolean only; guard identifiers and errors never leave the endpoint. Protected content, or a guard that cannot complete, disables Delete. The existing DELETE endpoint independently checks protection again and retains its audit writes. Its implementation is unchanged.

The gallery disables Delete while the read is pending or has failed. A failed read offers **Check again** inside the same dialog. Cancel invalidates the pending response so it cannot reopen the dialog. Deletion errors also remain inline. If a previously unused template acquires a playlist after the read, the server's conflict updates the existing warning and requires the newly disclosed impact to be acknowledged; the client never silently forces that unexpected impact.

Code:
- `apps/api/src/templates/templates.controller.ts`: `deletionUsage`.
- `apps/web/src/app/[schoolId]/templates/page.tsx`: `loadDeleteUsage`, `confirmTemplateDelete`, `TemplateUsageImpactDialog`.

## Why Brookfield had no map logo

The saved Brookfield brand logo was present and its storage URL returned HTTP 200 with `image/png`. RIOT Corporate's Network Atlas supplies branded location pins to `ScreenMap`; the single-account Screens page previously supplied only device coordinates. That page never handed the account logo to the renderer.

The Screens page now reads the active `BrandingProvider` and supplies one logo pin per physical location. Screens sharing an address share a pin. A single named group uses its group name; an address shared by several groups uses the street name. Pinned empty groups are also drawn. A missing or failed logo shows initials.

`LocationMapSurface` and `LocationMapFilters` are used by both Screens and RIOT Corporate's dashboard. Map height, fit padding, filter chip appearance, zoom controls and location pins share the same implementation. Screens adds the floating location navigation, exception inbox and selected-location panel; selecting equipment opens the existing screen details drawer. Locations without map coordinates remain visible in the missing-address notice. Filtering to zero matches keeps the map mounted. Mobile panels stay inside the viewport and below the filters.

Health rings reuse the Screens page's existing operational classification, rather than trusting a saved ONLINE flag. Corporate retains its existing readiness filters and calculations; no emergency data or workflow is changed.

Code:
- `apps/web/src/app/[schoolId]/screens/page.tsx`: active brand wiring.
- `apps/web/src/components/screens/LocationMapSurface.tsx`: shared map and filters.
- `apps/web/src/components/screens/ScreenLocationAtlas.tsx`: location navigation and equipment details.
- `apps/web/src/components/screens/mapLocationPins.ts`: physical location grouping and branding.

## Standard controls on the new homebuilder templates

All 28 newly installed boards use the same adapter and image-slot metadata. Photo and floor-plan galleries now use `AssetListPickerField`, the existing sortable thumbnail list and multi-select Media Library used by IMAGE_CAROUSEL. Timing and transitions use the same `PhotoPlaybackFields` component as IMAGE_CAROUSEL. Gallery fit uses the same Fill (crop) / Fit (no crop) choices. Logos use the standard single-image picker. Focus and alternative text are in an optional Advanced image settings disclosure. Generated QR codes expose their destination URL, rather than offering an image replacement the board immediately regenerated.

The duplicate Slide 1/2/3 arrow list, Then show rows, separate remove controls and raw carousel settings are removed from these native boards. Existing legacy EXTERNAL_HTML editors retain their storage and controls.

Two functional defects are corrected: the final-photo removal now persists an explicit empty gallery, and the adapter removes its stale image root and background. Previously, deleting the override restored the template defaults. A saved native `media.*.slides` override is now also read by the editor. Rotation waits for the incoming image to load and decode before replacing the current frame. Failed images are skipped; pending loads retain the current photo. The HTML adapter retains its background until the first native image is loaded. These media fixes use the shared native carousel renderer.

Photo lists remain compatible with existing `imageOverrides` string/list configs. Native boards also receive an explicit `media.<slot>.slides` override, including an empty list; no schema migration or template record replacement is needed.

## Verification

Targeted API tests cover tenant ownership, accurate totals, reach union, unused templates and the protection boolean. The existing forced-deletion protection tests run unchanged. Unit tests cover the dialog states, branded location grouping and page wiring. Production-build Playwright tests exercise one confirmed DELETE, Review navigation, cancellation with a late reply, read retry, protected use, concurrent usage, inline failure, loaded map logos, location drill-down and failed-image fallback in Chromium and WebKit. No production content is deleted by these tests.

Deployment and final CI evidence are recorded in the task's completion checklist. Earlier playback, ZIP and screen-setting fixes are documented in `docs/player/PLAYLIST-VIDEO-HANDOFF.md` and `docs/media/MEDIA-DOWNLOADS-AND-SCREEN-SETTINGS.md`.
