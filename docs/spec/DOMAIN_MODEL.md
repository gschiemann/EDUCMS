# Domain Model

## Core Boundaries

### 1. Identity & Access Domain (IAM)
- **Entities:** `Users`, `Roles`, `Memberships`
- **Responsibilities:** Define "Who" is doing "What" and in "Which Boundary" (School vs District). Enforces least-privilege operations securely. Validates token rotations and handles RBAC mapping logic.
- **Rules:** Users do not own data. They gain contexts via Memberships. All domain handlers must inject the caller's context to verify cross-tenant data requests.

### 2. Organizational Hierarchy Domain
- **Entities:** `Districts`, `Schools`, `Screen Groups`
- **Responsibilities:** Logical partitioning of the entire platform. Defines where assets live, who can interact with them, and scope containment. District admins manage global settings; School admins manage local groups.

### 3. Media & Content Management Domain
- **Entities:** `Assets`, `Playlists`, `Playlist Items`
- **Responsibilities:** Handling file ingestion, hashing (for offline sync cache validation), metadata extraction, and playlist curation. Represents the "Staging Area" of content before it is committed to production signage.

### 4. Scheduling & Coordination Domain
- **Entities:** `Schedules`
- **Responsibilities:** Time-based linking of Content (Playlists) to Destinations (Screen Groups). Conflict resolution rules for overlapping schedules.

### 5. Publishing & Sync Domain
- **Entities:** `Content Versions (Manifests)`, `Failed Sync Events`
- **Responsibilities:** Generating an immutable, deterministic mapping of exactly what a specific `Screen` should be playing at any given time. Uses idempotent version hashes to ensure devices know whether they are running outdated content.

### 6. Device Operations & Telemetry Domain
- **Entities:** `Screens (Devices)`, `Device Tokens`, `Player Heartbeats`
- **Responsibilities:** Maintaining authorized connection state, token rotations, health monitoring, and tracking offline/online fleet status.

### 7. Emergency Response Domain
- **Entities:** `Emergency Override State`
- **Responsibilities:** Extreme prioritization state. Overrides any local, scheduled, or cached context immediately. Integrates with push-notification (WebSockets/SSE) to devices. No configuration dependencies; acts as an absolute highest-order state machine.

### 8. Auditing Domain
- **Entities:** `Audit Log`
- **Responsibilities:** Append-only log to trace the lifecycle and changes across all domains, meeting legal/compliance standards. Must log every mutation of state.
