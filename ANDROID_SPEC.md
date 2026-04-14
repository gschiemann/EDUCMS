# Android Application Specification: Digital Signage Player

## 1. Overview
This document outlines the core architecture and technical specifications for the hardened Android signage player, designed to run on Android TV OS and dedicated Android media boxes. 

## 2. Technology Stack
*   **Language:** Kotlin
*   **Local Persistence:** Room Database
*   **Background Jobs / Sync:** WorkManager
*   **Realtime Communication:** OkHttp WebSocket
*   **Web Rendering:** WebView
*   **Media Playback:** ExoPlayer

## 3. Application Lifecycle
*   **Boot & Initialization:** Application is launched automatically by a `BOOT_COMPLETED` broadcast receiver. Initializes standard configuration (Room DB, Cache stores, WorkManager).
*   **Provisioning Check:** Checks if the device holds a valid pairing token or certificate. If not, enters provisioning mode.
*   **Foreground Operation:** Activities run exclusively in pinned Kiosk Mode (`startLockTask()`).
*   **Background Operation:** Persistent foreground service ensures OS does not kill the app. Heartbeat and metrics dispatched via WorkManager/WebSocket.

## 4. Boot Receiver Behavior
*   Listens for `android.intent.action.BOOT_COMPLETED`.
*   Requires `RECEIVE_BOOT_COMPLETED` permission.
*   Spawns `PlayerActivity` directly.
*   If `PlayerActivity` fails to launch, a fallback `WatchdogService` forcibly restarts the activity.

## 5. Local Database Schema (Room)

### 5.1 Entities
*   **`DeviceConfig`**: Key-value pairs for local device configuration (heartbeat interval, sync frequency, terminal ID).
*   **`Schedule`**: Defines active and upcoming playlists with start/end timestamps and priority levels.
*   **`Playlist`**: Groupings of display assets.
*   **`MediaAsset`**: Metadata for cached assets including `local_path`, `remote_url`, `hash` (SHA-256), `size`, and `status` (PENDING, DOWNLOADED, INVALID).
*   **`PlaybackLog`**: Telemetry and audit logs recording what played and when.

## 6. Remote Health Reporting
*   **Mechanism:** Periodic heartbeat messages dispatched over the persistent WebSocket connection. Fallback via WorkManager REST POST if WebSocket is dead.
*   **Payload:** Includes device temperature, available storage, RAM usage, current active display state/playlist, WebSocket connection status, and App version.

## 7. Crash Recovery Behavior
*   **Default Uncaught Exception Handler:** Captures the stack trace and stores it in Room DB.
*   **Watchdog / AlarmManager:** A periodic AlarmManager or foreground service checks if `PlayerActivity` is in the foreground every X seconds. If not, it relaunches the intent.
*   **Restart Loop Mitigation:** If the app crashes more than 3 times within a 5-minute window, it falls back to a safe "Emergency Error / Out of Order" static local view rather than cyclically rebooting to prevent infinite loops.
