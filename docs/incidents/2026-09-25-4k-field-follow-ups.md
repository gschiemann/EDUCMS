# A 4K screen kept dropping frames; its cache report said 0 files (2026-09-25)

**Date:** 2026-09-25

## What happened

Field follow-up (2026-09-25, 4K Android screen): an optimized 3840×2160 H.264 file still reported severe drops and buffering while the device cache row said 0 files. The 4K manifest correctly selected the 4K primary; the 1080p rendition is a compatibility copy produced by the upload worker, not evidence that a 4K screen played 1080p.

## Root cause

From the rule that stays in `apps/web/src/app/player/CLAUDE.md` (rule 16, field follow-up):

> The web player's playlist precache previously marked a URL set sent BEFORE the service worker confirmed any bytes, so one failed attempt could leave the screen streaming indefinitely.

## The rule it produced

`apps/web/src/app/player/CLAUDE.md` → rule 16 field follow-up: the precache waits for a worker acknowledgement, retries failures, keys the push by media URL and supplies the known size; a timed-out cache status is UNKNOWN, not "0 files"; do not claim the field device is fixed until its live cache report shows the file and a fresh video sample is smooth.

## Evidence

- Preceded by `docs/incidents/2026-09-24-4k-to-1080p-playback.md`; followed by `docs/incidents/2026-09-26-4k-cache-fill.md`.
