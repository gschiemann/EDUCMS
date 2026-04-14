# Integration Sequence

## Phase 1: Shared Contracts & Foundation
- **Goal:** Establish a single absolute source of truth for database schemas, API specs, security protocols, and business rules to prevent cross-agent drift.
- **Deliverables:** `SCHEMA.md`, `API_OPENAPI.yaml`, `RBAC_SPEC.md`, `SYNC_PROTOCOL.md`.
- **Exit Criteria:** Orchestrator explicitly approves all phase 1 documents. **No structural code** is written before this phase concludes.

## Phase 2: Backend/Platform
- **Goal:** Bring the core API, Auth boundaries, and underlying data structure to life.
- **Deliverables:** Working backend logic, Postgres configurations, S3 asset adapters.
- **Exit Criteria:** Local API tests operate seamlessly against mock data. OpenAPI spec strictly matching output payloads.

## Phase 3: Frontend/Admin
- **Goal:** Implement the complex, stateful administrative application for user-facing management.
- **Deliverables:** Web Admin console, Asset Library manager, Fleet Status Dashboard, Scheduler.
- **Exit Criteria:** The React application is seamlessly performing CRUD operations against the Phase 2 backend (or robustly mocked local backend equivalent). 

## Phase 4: Android Player
- **Goal:** Build a highly resilient playback client built perfectly to handle worst-case hardware logic.
- **Deliverables:** Kotlin ExoPlayer application, hardware device-registration protocols, local filesystem SQLite cache manager.
- **Exit Criteria:** Test Android device accurately queries backend, parses JSON layout manifest, securely retrieves assets from URLs, and displays playback cleanly without WiFi.

## Phase 5: Security Review
- **Goal:** Hardened verification of infrastructure and threat-prevention systems.
- **Deliverables:** Penetration tests, endpoint validation, JWT validation.
- **Exit Criteria:** @SecOps provides a clean bill of health. Verification that cross-tenant access is definitively impossible. Audit trails verified intact on sensitive actions (User Deletes, Video changes, etc).

## Phase 6: Integration and QA
- **Goal:** Final end-to-end holistic verification of the CMS swarm.
- **Deliverables:** Staging Environment deployment, full QA pass.
- **Exit Criteria:** A "Go/No-go" confirmation. Admin signs in -> uploads a video -> assigns it to a School specific display -> backend generates a signed manifest -> Android pulls the manifest -> video plays indefinitely -> device unplugs from network but survives playback.
