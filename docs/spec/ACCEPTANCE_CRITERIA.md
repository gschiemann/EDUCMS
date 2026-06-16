# V1 Acceptance Criteria

## 1. Tenancy & RBAC
- **AC-1.1:** A user cannot view or mutate entities (schools, screens, assets) belonging to another district or non-authorized school.
- **AC-1.2:** A Contributor cannot publish an asset without an Admin's explicit approval state.
- **AC-1.3:** Only District, School, or Super Admins can transition the system into an Emergency State.

## 2. Player Synchronization & Offline First
- **AC-2.1:** A player disconnected from the network must continue running its locally cached schedule indefinitely without crashing.
- **AC-2.2:** When a player reconnects, it must automatically flush its stored proof-of-play logs to the CMS for reconciliation before drawing new payloads.
- **AC-2.3:** The CMS must track heartbeat check-ins and accurately mark a player "Offline" in the UI if consecutive heartbeats are missed.

## 3. Playback Resilience & Asset Lifecycle
- **AC-3.1:** If an asset physically fails to download (e.g., bad network), the player must gracefully skip it in the playlist rather than showing a black screen or error dialog.
- **AC-3.2:** If a live asset is deleted from the CMS, the player must remove it from the active rotation upon its next successful sync payload.

## 4. Emergency Override Execution
- **AC-4.1:** Emergency websocket/SSE broadcast to active players must consistently force display takeover rapidly.
- **AC-4.2:** Emergency clear ("All Clear") must immediately restore standard playlist scheduling based on the current system clock.
- **AC-4.3:** Triggering and clearing emergencies must be immutably recorded in the relational Audit Log database table.

## 5. Screen Group Resolution
- **AC-5.1:** If a screen belongs to multiple groups with conflicting schedules, the player must aggregate and sequence the playlists logically based on predefined priority tiers.
