# Media downloads and screen settings — September 30, 2026

## Result

Selecting multiple uploaded assets prepares one ZIP containing all selected files. One selected asset retains the direct attachment download. A preparation failure leaves the selection intact and starts no partial download. The library displays “Preparing ZIP…” while requesting the archive.

Screen Settings displays the effective location, including the group address, without creating an individual screen override. The group header shows its address and the menu says “Edit group address” when one is set. The drawer retains its bottom Resync and live preview controls; duplicate top controls were removed. A bordered update card has a separate right-side Push update button when the Player or companion Manager needs updating. Current installations have no update button. The asset bulk button says “Delete”; its existing confirmation is retained.

## Download implementation and bounds

- `POST /api/v1/assets/download-archive` uses existing user authentication and role checks. The request contains only asset IDs. The API checks every ID against the authenticated tenant and rejects incomplete selections.
- Preparation checks every object’s actual size and availability, up to four metadata requests at once. Supabase objects must be in the public `assets` bucket, under the current tenant prefix, on the configured storage origin. Legacy local uploads use validated filenames under the upload root. Web links are excluded.
- A 32-byte random, single-use capability expires after 60 seconds. Redis stores only the ticket hash. Atomic Lua checks limit simultaneous archive work to one per tenant and two globally across replicas. Redis unavailability fails closed. Lease ownership and expiry prevent permanent capacity leaks.
- `GET /api/v1/assets/download-archive/:ticket` rechecks ownership and source identity. Both preparation and download start write awaited AuditLog rows with the initiating human or API-key actor.
- JSZip streams each source in order with bounded input buffers and STORE compression. MP4 and JPEG are already compressed; ZIP does not re-encode them. The browser receives a native attachment, without buffering the entire archive in JavaScript.
- The selection limit is 2–50 files and the total input limit is just under 2 GiB. Preparation has a 30-second metadata budget. Transfers have a 20-minute budget, abort on disconnect, and release capacity. Incomplete or oversized source transfers fail the response rather than returning a successful partial archive.
- Entry names are flat, portable and case-insensitively unique. Original bytes and Unicode filenames are preserved where supported.

## Investigation: uploads that appeared stuck optimizing

The three matching VisionCore videos were checked against their earlier copies in the other accounts. Each completed with `skipped / already-optimal`, matching file hashes and no encoder output replacement. They were not encoded twice.

An earlier Brookfield Video Wall source download stalled for 120 seconds and retried, occupying the shared worker for roughly six minutes. The VisionCore files waited behind it and then completed compatibility checks in roughly two seconds each. Existing worker concurrency protects API resources; it was not increased. The library now distinguishes queued work from a running compatibility check and actual encoding progress. A pipeline regression covers an already-optimal 1080p upload and verifies that encoding and source swapping do not occur.

## Verification

- API production TypeScript build and complete `pnpm preflight` passed.
- 53 targeted API assertions passed: archive safety, byte-preserving ZIP output and video pipeline behavior.
- 169 targeted web unit assertions passed: media library, optimization status, screen operations and update controls.
- 14 tests passed against the production Next.js build in Chromium and WebKit: direct attachment downloads, three-file ZIP, preparation failure, visible group addresses and Settings behavior. The rendered Settings screenshot was inspected.
- Real Redis smoke verification passed: global and per-tenant capacity, single-use consumption, ownership checks, lease extension and safe release.
- Tenant-isolation gate passed with no new violations or baseline expansion.
- Targeted API lint passed. Existing web components retain unrelated lint debt; the changed code was reviewed against the existing baseline and React accessibility/performance guidance.

Production deployment and CI evidence are recorded in the task checklist after publication. These changes do not alter emergency workflows, endpoints, audit safeguards or player emergency rendering. Multi-video decoded-frame handoff is a separate follow-up.
