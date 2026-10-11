# Shared runtime review and integration — 2026-10-11

Bounded read-only review by the corporate agent, followed by the lead's shared fix. No app-wide security audit or deployment claim.

## Returned finding, preserved in full

[P2] Poster Undo loses the authored poster in board-media-controls.ts. On morning-news boards, the video carries both data-videoslot="story.video" and data-posterslot="story.poster". keyOf() captures only the video key, so removing story.poster from img expands it to an empty string and clears the original poster.

Capture poster defaults separately from video sources, and add saved-reload/Undo coverage for these dual-key video elements. The new photo-only restoration spec misses this case.

## Lead correction

The companion captures video and poster defaults independently and paints poster overrides without changing the video source. Initial saved image/video keys participate in source-restoration tracking. Authored inline crop, transform and child object-fit are captured before URL/message painters; snapshots do not restyle untouched carousel/media nodes. Regression cases cover photo source/crop restoration and dual-key video poster restoration on first edit and after saved URL reload in Chromium and WebKit.

The new care guide's inherited one-row repeat defect is corrected by caching the original group and distinct authored row blueprints, restoring default rows before saved overrides, retaining reduced-list layout on repeated updates, and rearming new row hot zones. Existing events and the care guide are tested in both orientations/browsers. Each source's repeat capacity still applies; arbitrary extra-row growth is a separate catalog gap.
