# WebSocket JSON Message Contracts

All messages exchanged over the WebSocket connection must adhere to the following JSON structure: `{"type": "EVENT_NAME", "payload": {}, "idempotencyKey": "uuid-v4", "timestamp": 1712345678}`

---

## 1. HELLO
*   **Sender**: Player (Client)
*   **Recipient**: WebSocket Server
*   **Auth Requirements**: Unauthenticated initially; provides authentication material.
*   **JSON Payload Schema**: 
    ```json
    {
      "token": "eyJhbGciOiJIUzI1NiIsInR5c...",
      "stateHash": "a1b2c3d4e5f6...",
      "activeOverrideId": null,
      "sdkVersion": "1.0.4"
    }
    ```
*   **Retry Behavior**: If dropped or timed out, retry with exponential backoff up to 30s.
*   **Idempotency Key Strategy**: A new UUID per TCP connection attempt.
*   **Audit Log Implications**: Generates an actionable login/connection audit event.

## 2. AUTH_OK / AUTH_FAIL
*   **Sender**: WebSocket Server
*   **Recipient**: Player (Client)
*   **Auth Requirements**: Response to HELLO.
*   **JSON Payload Schema**:
    ```json
    // AUTH_OK
    { "deviceId": "dev_123abc", "expiresAt": 1713000000 }
    
    // AUTH_FAIL
    { "code": 401, "reason": "TOKEN_EXPIRED" }
    ```
*   **Retry Behavior**: Unidirectional. On FAIL, the server immediately drops the connection.
*   **Idempotency Key Strategy**: Matches the `idempotencyKey` of the triggering `HELLO`.
*   **Audit Log Implications**: `AUTH_FAIL` events are heavily logged and monitored for brute-force threats.

## 3. HEARTBEAT
*   **Sender**: Player (Client)
*   **Recipient**: WebSocket Server
*   **Auth Requirements**: Must be authenticated.
*   **JSON Payload Schema**:
    ```json
    { "metrics": { "cpu": 45, "mem": 1024, "temp": 42.1 } }
    ```
*   **Retry Behavior**: Emitted every 30 seconds. No hard retries for individual missed beats.
*   **Idempotency Key Strategy**: Standard UUID.
*   **Audit Log Implications**: Not audited individually; aggregated into telemetry time-series databases.

## 4. PUBLISH_AVAILABLE
*   **Sender**: WebSocket Server (via Fanout)
*   **Recipient**: Player (Client)
*   **Auth Requirements**: Requires active valid session.
*   **JSON Payload Schema**:
    ```json
    { "publishId": "pub_999xyz", "playlistVersion": 42, "critical": false }
    ```
*   **Retry Behavior**: If a client misses this, they discover they are out of sync via the next HTTP polling cycle or `HELLO` stateHash mismatch.
*   **Idempotency Key Strategy**: Sourced from the backend publish transaction ID.
*   **Audit Log Implications**: Delivery to the broker is audited. Client ACK is logged.

## 5. OVERRIDE
*   **Sender**: WebSocket Server (via Fanout)
*   **Recipient**: Player (Client)
*   **Auth Requirements**: Triggered by high-privileged admin; device must be authenticated to receive.
*   **JSON Payload Schema**:
    ```json
    {
      "overrideId": "ovr_alert_1",
      "severity": "CRITICAL",
      "mediaUrl": "https://assets.educms.link/evac.mp4",
      "textBlob": "EVACUATE BUILDING IMMEDIATELY",
      "expiresAt": 1712400000
    }
    ```
*   **Retry Behavior**: Server broker guarantees at-least-once delivery to active sockets. 
*   **Idempotency Key Strategy**: Tied strictly to `overrideId`. Players casually discard duplicates of active `overrideId`s.
*   **Audit Log Implications**: CRITICAL AUDIT. The initial deployment of the override is logged immutably, and all player ACKs are tracked to calculate compliance %.

## 6. ALL_CLEAR
*   **Sender**: WebSocket Server (via Fanout)
*   **Recipient**: Player (Client)
*   **Auth Requirements**: Validated session.
*   **JSON Payload Schema**:
    ```json
    { "overrideId": "ovr_alert_1", "clearedBy": "usr_999" }
    ```
*   **Retry Behavior**: Same as Override.
*   **Idempotency Key Strategy**: Deduplicated by referencing `overrideId`. Cannot clear an override that isn't active.
*   **Audit Log Implications**: CRITICAL AUDIT. Logs when the emergency state was officially concluded.

## 7. ACK
*   **Sender**: Player (Client)
*   **Recipient**: WebSocket Server 
*   **Auth Requirements**: Verified session.
*   **JSON Payload Schema**:
    ```json
    { "receivedEventId": "event_uuid_123", "status": "APPLIED" }
    ```
*   **Retry Behavior**: Resent on reconnection if the client hasn't successfully communicated readiness.
*   **Idempotency Key Strategy**: None needed, stateless ingestion server-side.
*   **Audit Log Implications**: Fulfills the loop for compliance reporting.

## 8. STATE_RESYNC_REQUIRED
*   **Sender**: WebSocket Server
*   **Recipient**: Player (Client)
*   **Auth Requirements**: Validated connection.
*   **JSON Payload Schema**:
    ```json
    { "reason": "HASH_MISMATCH", "expectedHash": "e5f6g7h8..." }
    ```
*   **Retry Behavior**: Client acts immediately by firing a REST payload to sync.
*   **Idempotency Key Strategy**: Matches the UUID of the triggering event or `HELLO`.
*   **Audit Log Implications**: Logged as a diagnostic warning. High frequency indicates network instability.

## 9. DEVICE_REVOKED
*   **Sender**: WebSocket Server
*   **Recipient**: Player (Client)
*   **Auth Requirements**: Server authoritative.
*   **JSON Payload Schema**:
    ```json
    { "reason": "ADMIN_ACTION" }
    ```
*   **Retry Behavior**: Terminal. Forces the client to wipe local hardware keys/cache, display an error screen, and halt.
*   **Idempotency Key Strategy**: Triggered from revocation API event ID.
*   **Audit Log Implications**: High severity audit log mapping to the administrator who clicked "Revoke".

## 10. PURGE_CACHE
*   **Sender**: WebSocket Server
*   **Recipient**: Player (Client)
*   **Auth Requirements**: Validated connection; triggered by Administrator.
*   **JSON Payload Schema**:
    ```json
    { "purgeAll": true, "assetIds": [] }
    ```
*   **Retry Behavior**: Fire and forget. Unreachable devices will resolve orphaned files during the next standard `/api/v1/device/sync` cleanup phase.
*   **Idempotency Key Strategy**: Standard UUID linked to trigger.
*   **Audit Log Implications**: Audit logged as manual backend disk operations were initiated, affecting local storage parity.
