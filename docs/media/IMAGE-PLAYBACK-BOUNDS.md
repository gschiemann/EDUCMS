# LED image publication regression — October 1, 2026

The September 24 screen-sized media publication change (`12d65e8d`) introduced an inconsistency between the image publication check and the shared upload optimizer. An already compressed image could prevent a playlist from being added to a legacy LED player. The failure occurred in the API before delivery, not inside Player 1.1.20.

## Evidence and failure

Four production schedule requests failed with HTTP 503 / `IMAGE_PLAYBACK_COPY_FAILED`. The selected playlist contained a PNG with decoded dimensions 1182 × 1330 and 629,421 bytes. The connected poster canvas was 960 × 1080; its dimensions are valid and are preserved.

`MediaPublicationService.ensureImageCopy()` required a playback image with longest side ≤ 1920 and shortest side ≤ 1080. It called `optimizeImageForUpload(..., 1920)`, whose resize boundary was a 1920 × 1920 square. Neither original dimension exceeded that square, so the optimizer did not resize. Re-encoding an already compressed PNG produced a larger file, causing its normal passthrough path to return `optimized: false`. Publication rejected that result and never created a schedule. The previous output check also checked only the longest side, which could accept a re-encoded image whose short side remained too large.

## Implementation

- `apps/api/src/storage/media-optimization.service.ts`: `optimizeImageForUpload` accepts a fifth `maxShortDimension` argument, defaulting to `maxDimension`. Normal uploads retain their existing square cap and passthrough behavior. Playback requests resize when either decoded axis exceeds its respective limit. EXIF rotation is accounted for when choosing portrait or landscape bounds; aspect ratio is preserved, without enlargement.
- `apps/api/src/schedules/media-publication.service.ts`: playback preparation passes 1920 and 1080, then checks **both** output axes before uploading the rendition. Existing tenant ownership checks, transaction, audit write and failure cleanup remain in place.
- Renditions remain separate from the original asset. No canvas dimensions, physical poster wiring, playback orientation, schema, APK, or emergency workflow changes are needed.

On the actual incident image, the previous square request returned passthrough; the corrected playback request produced 1080 × 1215, 571,396 bytes. This is a decoder-compatible, aspect-preserving copy; it is not a replacement for the 960 × 1080 display canvas. Existing rendering fits it to that canvas.

## Verification

Eighteen API tests pass across publication and image bounds: already compressed portrait and landscape PNGs, EXIF orientations 6 and 8, unchanged ordinary upload sizing, original URL preservation, retained 960 × 1080 canvas, tenant ownership and audit behavior. The actual production source file was downloaded read-only and processed locally to verify the output bytes and dimensions. Production investigation used read-only queries/logs; no schedules or screen commands were issued.

After the updated API deploys, retry adding the LED Poster to its playlist. Physical display verification is still separate from the successful local reproduction. Release, CI and production receipts are retained in the task completion checklist.
