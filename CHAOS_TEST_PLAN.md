# Chaos Testing & Hardware Resilience Plan

## Objective
Aggressively validate platform stability parameters within extremely volatile, hostile network ecosystems. Real-world school scenarios involve extreme bandwidth degradation, massive simultaneous connection drops, and unpredictable gateway hardware shutdowns.

## 1. Override Latency Tests (Under Extreme Load)
- **Scenario Framework**: Proving mission-critical platform safety guarantees when the server structure is currently thrashing inside a "stampede" traffic peak.
- **Execution Workflow**:
  1. Fire up a load testing module (e.g. `k6` or `Artillery`) to blindly spam the `/api/media/upload` and DB polling endpoint matrices to strictly max out instance disk queues and CPU vectors.
  2. While the server is dying, an external mechanism triggers authentic `POST /api/emergency/override` payload mapping.
- **Strict Verification Limits**:
  - Event transmission out of Gateway structure mapping MUST successfully propagate through the core message queues.
  - Test scripts asserting connection on mocked WebSockets **MUST** register the payload transmission inside the `< 500ms` compliance loop, despite overwhelming DB overhead mappings.

## 2. Reconnect Reconciliation Tests
- **Scenario Framework**: A 5-minute full school network loss scenario that recovers precisely when 5,000 devices instantly re-establish long polling parameters.
- **Execution Workflow**:
  1. 5,000 parallel mock Socket.io processes are actively maintained.
  2. Kill software proxy routing mimicking total WAN routing block.
  3. During active server partition loop, backend Admin triggers minor UI timeline layout modifications.
  4. Restore WAN connectivity mapping.
- **Verification Parameters**:
  - Devices **MUST NOT** immediately all HTTP bomb the root backend file structures to reconcile parameters ("Thundering Herd Protocol").
  - Devices must initiate safely staggered geometric random delay loop vectors.
  - System must seamlessly compare local cache ETags against centralized config state and repair logic discrepancies cleanly.

## 3. All-Clear Restoration Tests
- **Scenario Framework**: Safely proving system behavior resolving emergencies during actively horrible network packets loops.
- **Execution Workflow**:
  1. Device fleets are correctly displaying high visibility `EMERGENCY` modal structures.
  2. The network injects high ping latency and severe 25% packet drop frameworks.
  3. Admin manually executes "All Clear / Revert Emergency" sequence mapping.
- **Verification Parameters**:
  - The Event payload assures exactly at-least-once message transit delivery guarantees by auto-reissuing failed checks.
  - Devices receiving payload carefully destroy the uncloseable UI emergency boundary.
  - **Fallback Recovery Verification**: Simulated devices that strictly dropped the WebSocket payload update map successfully discover the event via the secondary HTTP auto-polling cycle parameter.
  - Fleet absolutely registers 100% full recovery resolution mapping into standardized loop layouts within a strict maximum window of `< 10 seconds`.

## 4. Subsystem Redis/WebSocket Failover Chaos
- **Scenario Framework**: Hard crashing architecture nodes to guarantee smooth hardware routing adjustments.
- **Execution Workflow**:
  - Command environment explicitly sends standard `SIGKILL -9` targeting active Primary Gateway Cache execution block.
- **Verification Parameters**:
  - Internal Sentinel/Election patterns forcibly identify missing gateway parameter sets and rebuild new cache instances in under `< 5 seconds`.
  - Android connected nodes smoothly execute sub-second connection break recognition maps and actively auto-reroute to the established replication node frameworks maintaining UI layer without tearing or failing.
