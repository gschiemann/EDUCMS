# The 4K cache-fill incident (2026-09-26)

**Date:** 2026-09-26

## What happened

(2026-09-26, the 4K cache-fill incident). The customer's 4K screen reported 0 cached files for hours and dropped 121 of 264 frames streaming its 141 MB clip from origin.

## Root cause

Two limits in `sw-player.js` explained the empty cache, and both scale with file size: `fetchAndStore` verified SHA-256 with `res.clone().arrayBuffer()` (the whole body in worker memory — an OOM on a 1–2 GB WebView), and the whole playlist downloaded under ONE `PRECACHE_PLAYLIST` `waitUntil`, which Chromium kills after five minutes (`kRequestTimeout`, KILL_ON_TIMEOUT).

## The first fix, and the owner's rejection of it

The first fix (`bdb3f59a`) also played the 1080p rendition as a stand-in until the 4K file cached; **Greg rejected the stand-in the same day** ("a screen never plays a lower-resolution stand-in and then switches up — it downloads the whole native file, THEN plays it"), `93fa9ef7` removed `fallback_url/hash/size` from the manifest and the player's fallback path was deleted.

## Why our system let it reach a customer

Both limits in `sw-player.js` scale with file size (a whole-body SHA-256 in worker memory and one `PRECACHE_PLAYLIST` `waitUntil` that Chromium kills after five minutes), so small test files never reached them. The first fix also shipped a stand-in the owner rejected the same day; the record names no review that would have caught that beforehand.

## What pins it

- `apps/web/src/app/player/__tests__/sw-large-asset-cache.test.ts`
- `apps/web/src/app/player/__tests__/sw-emergency-large-assets.test.ts`

## What worked

The customer's 4K screen reported 0 cached files for hours and dropped 121 of 264 frames, and that report and frame count exposed it. The owner's same-day rejection of the stand-in led to `93fa9ef7`.

## The rule it produced

`apps/web/src/app/player/CLAUDE.md` → rule 17: a big file downloads WHOLE, in short verified resumable steps, and only then plays — never streamed from origin, never a lower-resolution stand-in; part (f), the emergency tier, lives in `apps/api/src/emergency/CLAUDE.md`.

## Evidence

- Commits `bdb3f59a` (the first fix, with the stand-in) and `93fa9ef7` (removed the stand-in).
- Regression gates: `apps/web/src/app/player/__tests__/sw-large-asset-cache.test.ts` and `apps/web/src/app/player/__tests__/sw-emergency-large-assets.test.ts`.
