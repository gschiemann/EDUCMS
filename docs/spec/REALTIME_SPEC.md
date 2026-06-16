# Realtime Architecture Specification

## 1. Overview
This specification outlines the ultra-low-latency event system for the EDU CMS platform. The primary goal is to ensure that life-safety and critical information (such as Emergency Overrides) are delivered to digital signage players in near real-time, while maintaining robust, deterministic state management for standard content playback.

## 2. WebSocket Architecture
- **Protocol**: Secure WebSockets (WSS).
- **Topology**: Load-balanced cluster of stateless WebSocket server nodes.
- **State Management**: WebSocket nodes hold NO durable state. They only maintain active connection maps (`connectionId -> deviceId`) in memory. All authoritative state resides in the primary database and is cached in Redis.
- **Connection Lifecycle**:
  - Connections are initiated by the device (Player).
  - Devices must authenticate immediately upon establishing the TCP/WSS connection.
  - Unauthenticated connections are forcefully closed after a 5-second grace period.

## 3. Fanout Model
- **Broker**: Redis Pub/Sub (or similar lightweight memory broker, e.g., NATS).
- **Strategy**: 
  - Each WebSocket node subscribes to specific Redis patterns or channels upon startup.
  - When a message (e.g., `OVERRIDE`) is triggered via the API, the backend publishes the message to the relevant Redis channel.
  - Redis fans out the message to all joined WebSocket nodes.
  - Each node looks up local connections matching the target (device, group, or broadcast) and pushes the WebSocket frame down the wire.
- **Routing Channels**:
  - `tenant:{tenant_id}`: Global messages for the entire tenant.
  - `group:{group_id}`: Messages for a specific organizational unit or screen group.
  - `device:{device_id}`: Unicast messages for a specific player.

## 4. Connection Auth and Re-auth
- **Authentication**: Devices authenticate using short-lived JWTs provisioned via a robust device enrollment flow. The JWT is transmitted in the initial `HELLO` message, NOT in the connection URL, to prevent token logging in access logs.
- **Re-authentication**: 
  - Connection tokens expire periodically (e.g., every 4 hours).
  - Devices proactively request new tokens via a standard REST endpoint using their persistent refresh token or secure enclave certificate.
  - Upon receiving a new token, the device sends a new `HELLO` payload to the open WebSocket connection to extend its session smoothly without dropping the physical connection.

## 5. Player Subscription Channels
Devices do not "choose" what they subscribe to. The WebSocket server independently maps the authenticated `deviceId` to its respective `groupId` and `tenantId` by reading the claims inside the JWT. The server then pushes relevant events down the socket.

## 6. Override Precedence and Expiry
- **Absolute Precedence**: `OVERRIDE` events immediately interrupt any currently playing standard scheduling. Players must halt normal cache cycles and forcibly render the override media/layout.
- **Client-Side Expiry**: Every `OVERRIDE` event contains an `expiresAt` timestamp. If the player loses connection and the time passes `expiresAt`, the player automatically clears the override and resumes standard scheduling.
- **Pessimistic Locking**: Normal publishing operations cannot alter an active override. An `ALL_CLEAR` must be issued, or the override must expire, before normal content loops are expected to reflect newly published items on screen.

## 7. Reconnection and Missed-Event Recovery
WebSockets are inherently lossy; an active ping does not guarantee an event was received if a temporary network blip occurred exactly during transit.
- **Sync Hashes / Timestamps**: During the `HELLO` handshake, the player provides a `stateHash` or `lastUpdate` timestamp representing its current local SQLite/cache state.
- **State Reconciliation**: The server compares the device's state hash. If the application detects a mismatch (e.g., an override was triggered while the device was disconnected), the server issues a `STATE_RESYNC_REQUIRED` event.
- **Failsafe Retrieval**: Upon receiving an invalidation or out-of-sync notification, the player uses standard REST endpoints to perform a heavy payload pull (fetching the current explicit state) rather than attempting to catch up via WebSocket events.
