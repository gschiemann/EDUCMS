# Player State Machine & Precedence Rules

## 1. State Machine Definitions
The player engine operates as a deterministic state machine determining what is visually rendered at any given microsecond.

*   `STATE_UNPROVISIONED`: Waiting for registration.
*   `STATE_SYNCING`: Downloading initial or delta manifest/assets. Displaying generic loading or current valid cache.
*   `STATE_PLAYING_SCHEDULE`: Rendering the standard local schedule.
*   `STATE_PLAYING_OVERRIDE`: WebSocket-triggered or locally-triggered emergency override.
*   `STATE_OFFLINE_FALLBACK`: Rendering locally cached content during network outages.
*   `STATE_DOWN`: Hardware failure, tampering detected, or infinite crash loop mitigated.

## 2. Scheduler Precedence Rules
When evaluating the active schedule, precedence is resolved locally every 1-5 seconds tick:
1.  **Strict Time Overlaps:** If two playlists are scheduled, the one with the narrower time window (e.g., a specific assembly time) overrides the broader one (e.g., all-day default).
2.  **Priority Flag:** `Priority Level` integer dictates tie-breakers. Higher numbers override lower numbers.

## 3. Override Precedence Rules
Overrides represent immediate interruptions to standard routing:
1.  **Global Emergency (Fire/Lockdown/Weather):** Absolute highest precedence. Skips all local scheduling. Sourced from WebSocket.
2.  **Local Principal Override:** Admin sends a temporary ad-hoc message targeting a specific screen or group. Overrides the schedule but yields to Global Emergency.

## 4. Reconnect Behavior
*   **WebSocket Drops:** OkHttp reconnects immediately using exponential backoff (1s, 2s, 4s, 8s, up to 60s).
*   **Reconnection Sync:** Upon successful WebSocket re-establishment, the client immediately requests the latest connection state `SYNC` frame to verify if it missed any emergency overrides or manifest updates during the downtime.

## 5. Local Fallback when WebSocket / Network is Down
*   The system detects network loss via `ConnectivityManager`.
*   If WebSocket disconnects, the scheduled local loops continue uninterrupted unless an asset was not successfully cached.
*   If an asset meant for the current schedule is missing, the player gracefully skips to the next valid, cached asset in the playlist to prevent black screens.
