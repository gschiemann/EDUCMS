# Realtime Failure Modes & Resiliency Strategy

To guarantee the reliability of the life-safety and emergency override infrastructure, the architecture dictates specific fallback patterns for partial and complete subsystem failures.

## 1. WebSocket Node Failure
*   **Scenario**: A WebSocket Node (running e.g., Node.js or Go) crashes, runs out of memory, or the underlying compute instance is terminated.
*   **Immediate Impact**: Hundreds or thousands of devices connected to that specific instance will experience a socket drop.
*   **Mitigation & Recovery**:
    *   Players detect the TCP connection drop immediately or via a missed `HEARTBEAT`/ping interval (max 30 seconds).
    *   Players wait a random jitter duration (100ms - 5s) to avoid thundering herd.
    *   Players resolve DNS and reconnect to the Load Balancer.
    *   The Load Balancer routes them to a healthy node.
    *   Upon successful `HELLO`, state hashes are compared, ensuring no messages were missed during the downtime.

## 2. Redis/Broker Cluster Failure
*   **Scenario**: The Redis Pub/Sub cluster becomes partitioned, or the primary node faults out causing an election period where writes/publishes fail.
*   **Immediate Impact**: The system cannot perform ultra-low-latency fanout. New overrides triggered in the CMS will not instantly transit WSS to players.
*   **Mitigation & Recovery**:
    *   **Fallback to Polling**: The robust Player system always maintains a fallback HTTP polling interval (e.g., every 60-120 seconds) for its `/state` manifest.
    *   During the broker outage, overrides are written securely to the Postgres DB. Players will eventually pull the new state during their next standard poll interval.
    *   Emergency Overrides will face an expected degradation to ~1-2 minute latency instead of sub-second latency. Data integrity remains 100% accurate.

## 3. Database Outage (PostgreSQL Primary Down)
*   **Scenario**: Authoritative database crashes and a failover to a replica takes 30-60 seconds.
*   **Immediate Impact**: Admins cannot inject new overrides. New devices cannot authenticate.
*   **Mitigation & Recovery**:
    *   Already connected devices with valid JWTs remain connected and functional, as WSS node routing is fully in memory and JWT verification logic (signature check) does not require a DB hit.
    *   Players caching content locally on SQLite will continue to loop their scheduled content uninterrupted.
    *   Attempting to publish an override will return a 503 from the Backend API until DB routing is restored. No partial or corrupt states will be broadcast.

## 4. Severe Network Partitions (Client Isolation)
*   **Scenario**: A player at a remote school site loses all internet connectivity for 4 hours. Meanwhile, an `OVERRIDE` and subsequent `ALL_CLEAR` are sent.
*   **Immediate Impact**: The player will not receive the override.
*   **Mitigation & Recovery**:
    *   The player continues playing cached scheduled content based on its internal hardware clock.
    *   When the network returns 4 hours later, the device reconnects (`HELLO` -> `AUTH_OK`).
    *   Because the `ALL_CLEAR` was also missed but the overall state hash aligns with standard scheduling, the active override will correctly bypass the device, ensuring the player doesn't render an expired emergency message upon coming back online.
    *   Logs will show the device was completely unreachable during the incident radius.

## 5. Token Authority Compromise
*   **Scenario**: Device JWT secret is assumed compromised.
*   **Mitigation & Recovery**:
    *   Admin initiates a global "Revoke All Device Tokens" operation.
    *   API updates JWT verification secret.
    *   WSS nodes are rebooted, instantly severing all TCP connections.
    *   Devices attempt to reconnect with old JWT, get `AUTH_FAIL`, and must attempt standard hardware-rooted re-enrollment flows to recover.
