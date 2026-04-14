# Cache and Sync Strategy

## 1. Polling & Sync Model
*   **Primary Sync:** The device subscribes to content invalidation events via the persistent WebSocket.
*   **Secondary Fallback (Polling):** A WorkManager periodic task (e.g., every 15 minutes) polls the `/api/v1/device/sync` endpoint using inherited DeviceAuth headers. This guarantees eventual consistency if the WebSocket drops but the HTTP connection is alive.
*   **Manifest Driven:** The device requests a manifest of what *should* be playing. The manifest includes `schedule_id`, `playlist_id`s, `asset_list` (URLs + SHA-256 hashes).

## 2. Asset Downloading & Caching
*   **Download Manager:** WorkManager handles large file downloads (images, HTML/Zip bundles, video files) asynchronously.
*   **Storage Location:** Internal storage (`Context.getFilesDir()`) is preferred to prevent SD Card tampering.

## 3. Asset Integrity Checks
*   **SHA-256 Verification:** As an asset finishes downloading, its SHA-256 hash is computed and compared against the hash provided in the manifest.
*   **Failure Protocol:** If the hash mismatches or the file size is wrong, the file is deleted, marked `INVALID`, and queued for retry with exponential backoff.

## 4. Cache Invalidation
*   **Stale Asset Cleanup:** When a new manifest is successfully processed, the app identifies any cached assets not present in the current or upcoming schedules and schedules them for deletion to prevent disk exhaustion.
*   **Emergency Purge:** A WebSocket command `PURGE_CACHE` can force the deletion of defined or all cached assets instantly.

## 5. Offline Operation Survival
*   **Pre-fetching:** All required assets for the next 48 hours are aggressively pre-fetched.
*   **Offline Mode:** If network connectivity is completely lost, the player strictly follows the local `Schedule` table using only `DOWNLOADED` assets from the room database.
*   **WebView Fallback:** WebView loads local HTML/JS assets (`file://.../cache/...`) and ExoPlayer points to local `file://` URIs.
