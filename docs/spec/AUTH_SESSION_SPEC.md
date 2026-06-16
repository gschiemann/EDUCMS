# Authentication & Session Specification

## 1. Web Portal Authentication (Staff & Admins)

### 1.1 Password Management
*   **Algorithm**: Argon2id.
*   **Parameters**: Target minimum 45ms verification time (e.g., `m=65536` (64MB), `t=3`, `p=4`, but benchmarked per production constraints).
*   **Salt**: 16 bytes minimum, randomly generated per password using a CSPRNG.

### 1.2 Session Mechanics
*   **Login Flow**: 
    1. User submits credentials.
    2. Server verifies against rate limits.
    3. Server verifies Argon2id hash.
    4. Upon success, previously unauthenticated session ID is destroyed and a new session ID is issued (Session Rotation).
*   **Cookie Attributes**:
    *   `HttpOnly`: true (Not accessible via JavaScript).
    *   `Secure`: true (Sent only over HTTPS).
    *   `SameSite`: Strict.
    *   `Domain`: Explicitly scoped to the API/Portal domain.
*   **Tokens (JWT)**:
    *   **Access Token**: Short-lived (15 mins). Contains tenant ID, user ID, role, and a `jti` (JWT ID).
    *   **Refresh Token**: Long-lived (7 days). Stored in the database to allow revocation. Stored client-side in an `HttpOnly` cookie. Must be rotated on every use.

### 1.3 Rate Limiting & Blocking
*   **Global Login Limits**: 100 requests per IP per minute.
*   **Targeted Login Limits**: 5 failed requests per username per 15 minutes.
*   **Lockout**: Temporary lockout (exponential backoff) applied automatically upon repeated failures.

## 2. Android Player Authentication

### 2.1 Device Provisioning
*   **Pairing Code**: Admin generates a short-lived (10 min) PIN in the portal.
*   **Claiming**: Device submits PIN. API responds with a long-lived Device JWT and a Refresh Token.

### 2.2 Player Sessions
*   **Device Tokens**: Bound to a specific `hardware_id` and `tenant_id`. No user permissions. Scoped explicitly to `player:read` and `telemetry:write`.
*   **Rotation**: Player uses its Refresh Token every 24 hours to acquire a new Access Token.
*   **Revocation**: Unpairing a device in the administrative portal immediately revokes the Refresh Token and adds the current Access Token to an in-memory/Redis blocklist until expiry.

## 3. WebSocket Handshake
*   **Authentication**: Players/Web clients pass their short-lived Access Token during the WS handshake (e.g., via a query parameter `?token=...` or standard HTTP headers depending on the WS protocol implementation, transitioning to subprotocols or first-message auth if headers are not viable).
*   **Re-Auth**: The WebSocket connection monitors the underlying token expiration. Connection must be dropped by the server when the token expires unless a token refresh message is sent over the wire.
