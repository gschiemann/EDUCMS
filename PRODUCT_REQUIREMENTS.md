# Product Requirements Document (PRD) - V1

## Objective
A secure, production-grade, multi-tenant digital signage CMS for schools. V1 is focused on admin-triggered emergency override, managed messaging, secure playback, and hardened operations.

## Core Scope
- **Tenancy:** Districts -> Schools -> Users, Screen Groups, Screens
- **Content:** Playlists, Assets, Schedules
- **Security & Ops:** Role-based access control (RBAC), emergency overrides, approval workflows, player provisioning and heartbeat, audit logs, offline playback, and reconciliation.

## Conceptual Semantics
### Screen Grouping Semantics
- **Screens** belong to exactly one **School**.
- **Screens** can be assigned to one or multiple **Screen Groups** within that School (e.g., "Hallways", "Cafeteria", "All Screens").
- Playlists and Schedules are targeted at the **Screen Group** level (or individual screens, but grouping is the primary vehicle).
- Emergency overrides can target entire Schools or specific Screen Groups.

### Asset Lifecycle
1. **Upload:** User uploads media (image/video). Asset is marked "Draft" / "Pending Approval" (if user lacks auto-publish rights).
2. **Review:** Authorized role (School/District Admin) reviews and approves standard content.
3. **Publish:** Asset becomes available for scheduling in Playlists.
4. **Schedule:** Playlist containing the asset is assigned to a Screen Group.
5. **Sync:** Active Player fetches the playlist payload and downloads the asset to local encrypted or secured storage.

### Emergency Behaviors
- **Super / District Admin:** Can trigger platform-wide or multi-district emergency overrides. Can clear any active emergency.
- **School Admin:** Can trigger school-wide overrides. Can clear school-wide overrides. Cannot override other schools.
- **Restricted Users (Teachers/Contributors):** Cannot trigger overrides. In an emergency, their scheduled content is fully preempted.

## System State Behaviors

### Player Offline
- **Behavior:** The player continues to loop the most recently cached, locally stored playlist data.
- **Reporting:** Heartbeat fails. CMS marks player as "Offline" after missing N consecutive heartbeats (e.g., 2 minutes).

### Player Reconnect
- **Behavior:** Player successfully hits the heartbeat endpoint. 
- **Reconciliation:** Player transmits cached proof-of-play (playback logs) securely to the CMS. It then pulls any updated playlists, schedules, or emergency states that occurred while offline.

### Emergency Override Triggered
- **Behavior:** CMS broadcasts a high-priority websocket/SSE signal to relevant players (and standard heartbeat mechanism for fallback). 
- **Playback:** Standard schedule is immediately suspended. Player downloads (or retrieves from protected local cache) the pre-staged emergency asset (e.g., "LOCKDOWN") and forces it fullscreen, bypassing all transitions.
- **Audit:** Action logged with user ID, timestamp, and target scope.

### All Clear (Override Revoked)
- **Behavior:** Admin cancels user emergency override. CMS signals players.
- **Playback:** Players immediately resume their regularly scheduled playlists based on current clock time.

### Revoked User Access
- **Behavior:** User is disabled or deleted. Active UI sessions are immediately invalidated (force logout). Assets previously created remain, but ownership is assigned to standard admin or marked orphaned. Submitted drafts may be purged or kept based on policy.

### Deleted Asset in Live Playlist
- **Behavior:** System soft-deletes the asset or prevents hard deletion until removed from live playlists. Alternatively, if forced, the CMS removes the asset from active payload, triggers a sync to players. If the player attempts to play a deleted or unavailable asset, it skips gracefully to the next item in the playlist without crashing.

## Non-Goals (Strictly V1 Boundaries)
- NO autonomous threat detection (e.g., gunshot detection AI, acoustic tracking).
- NO tactical routing (e.g., personalized dynamic exit paths based on active shooter location).
- NO law-enforcement integrations or automatic dispatching.
