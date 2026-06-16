# Publishing & Offline Synchronization Model

## Philosophy
To ensure screens in a school continue functioning despite internet outages, the system operates on an **Offline-First, Idempotent Manifest** model. Devices operate autonomously once loaded and never stream content in real-time.

## The Idempotent Publishing Workflow
1. **Staging Adjustments (Drafting):** Contributors add Assets (which initially receive a `PENDING_REVIEW` status). Admins must explicitly flag them as `APPROVED` before they become eligible for play. Playlists and Schedules are built against these assets.
2. **Commit / Publish Trigger:** A privileged user (Admin) triggers a publish at the School or Screen Group level.
3. **Manifest Generation:** 
   - The backend system scans the active schedules and relevant playlists for that target boundary.
   - It deterministically generates a JSON "Manifest" that maps precisely what assets need to be locally cached by the devices, and exactly when they should run.
   - A cryptographic hash (e.g., SHA-256) is derived from this manifest JSON document.
4. **Immutable Snapshot:** The manifest and its hash are saved immutably to the `content_versions` table.

## The Player Sync Lifecycle
1. Devices hit the `/api/v1/device/sync` endpoint frequently (e.g., polling every 60 seconds) passing their current Manifest Hash in an `If-None-Match` header.
2. **Unchanged State:** If the latest mapped `content_versions` hash matches the device's header, the API returns `304 Not Modified`. The player continues functioning offline.
3. **New Content Detected:** If the hash differs, the API returns the new JSON Manifest and a `200 OK`.
4. **Pre-Fetching:** The device parses the Manifest, compares the required asset hashes against its local physical disk cache (downloading any missing assets via CDN/S3).
5. **Atomic Swap:** Only when 100% of the required assets are verified on disk does the device update its active schedule parser and swap its in-memory state to the new Manifest Hash.
6. **Acknowledgement:** The device's next `/api/v1/device/heartbeat` transmits its successful jump to the new Manifest Hash. Any missing files trigger entries in `failed_sync_events`.

## Emergency Overrides
Emergency overrides **skip** the standard publishing workflow.
- When an emergency state is activated (e.g., Lockdown or Evacuation), the `emergency_override_state` table is updated.
- The next polling request instantly returns a custom Emergency Payload alongside a high-priority HTTP status.
- Optionally, WebSockets or Server-Sent Events (SSE) immediately push a trigger sequence to connected sockets to negate the polling latency, guaranteeing sub-second response times for active emergencies. 
- Overrides dictate an immediate screen takeover; normal playlist loops are suspended until the override is flagged `inactive`.
