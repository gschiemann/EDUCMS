# Swarm Execution Plan: School Digital Signage CMS

## Project Goal
To build a highly reliable, secure, offline-first, multi-tenant digital signage Content Management System (CMS) for schools. The system must feature robust Role-Based Access Control (RBAC), immutable system auditing, an intuitive scalable backend administration console, and a highly resilient Android playback application capable of seamless offline execution.

## Major Subsystems
1. **API & Core Backend**: Authentication, Authorization (RBAC), Audit Logging, Device Management, Configuration Delivery, and Offline Sync APIs.
2. **Web Frontend (Admin Console)**: School administrator dashboard, media asset library, playlist/content scheduling, fleet health monitoring, and system metrics.
3. **Android Player Application**: Android TV/SoC offline-first content player, recursive file syncing loop, player telemetry, and health heartbeat reporter.
4. **Data & Storage**: Real-time relational database for metadata, securely signed blob storage for digital assets (videos, images).
5. **Infrastructure & Security**: CI/CD pipelines, staging environments, logging, threat prevention, network security, and backup infrastructure.

## Agent Roster
- **@Orchestrator** (TPM): Program Manager, unblocker, dependency manager. Owns schedule, contract publication, conflict resolution, and final integration readiness.
- **@DataModeler**: Designs database schemas, types, and the openAPI data contracts.
- **@BackendDev**: Implements the Node/TypeScript API interface, Database mutations, Storage integrations, and Audit logic.
- **@FrontendDev**: Implements the React/Web interface, UI/UX workflows, and Admin state management.
- **@AndroidDev**: Implements the Kotlin/Android hardware app, SQLite offline DB, and the fault-tolerant media sync loop.
- **@SecOps**: Handles RBAC permissions logic, audit logging specifications, data isolation, and system security reviews.

## Dependencies Between Agents
- **@DataModeler** -> **All Agents**: Shared API/Schema contracts must be written and approved before any logic coding begins.
- **@SecOps** -> **@BackendDev & @FrontendDev**: Security isolation and RBAC rules must be defined before endpoints are built.
- **@BackendDev** -> **@FrontendDev & @AndroidDev**: Core APIs must exist or mock/stub counterparts must be deployed.

## Parallel Execution Plan
1. **Agent @DataModeler** drafts the API OpenAPI specifications and database schemas.
2. **Agent @SecOps** defines the structured RBAC hierarchy and Audit Event logging standard.
3. **[GATE 1] CONTRACT APPROVAL**
4. **Agent @BackendDev** stands up initial application structure, routes, and creates mock API endpoints based strictly on the approved OpenAPI spec.
5. **Agent @FrontendDev** initiates UI/UX implementation connecting to the mock APIs.
6. **Agent @AndroidDev** initiates local UI layout and ExoPlayer logic independent of external connections.
7. **[GATE 2] IMPLEMENTATION SYNC**

## Approval Gates
- **Gate 1: Contract Sign-Off**: Zero code is committed until `API_SPEC.md` and `SCHEMA.md` are rigorously reviewed and approved by the Orchestrator. 
- **Gate 2: Architecture & Security Review**: Both offline sync & RBAC multi-tenant isolation models must be approved.
- **Gate 3: Feature Freeze & QA Deployment**: Pre-flight audit verification, deployment to a secure Staging environment.
- **Gate 4: Integration Sign-Off**: Successful end-to-end flow run manually from Web Upload -> Server Sync -> Android Playback.

## Definition of Done (DoD) per Stream
- **Backend:** 90%+ unit and integration test coverage. Immutable audit logs cover 100% of data mutations. Endpoints strictly enforce multi-tenant JWT RBAC boundaries.
- **Frontend:** Completely responsive Web UI. Gracefully handles network errors. Accessibility compliant (WCAG). All inputs are rigorously sanitized to prevent CSRF/XSS.
- **Android:** Can play designated complex media content completely disconnected from Wi-Fi for at least 72 hours. Detects bad files proactively and refuses to cache corrupt assets. Resumes playback gracefully from crashes or power cycles.
- **Security:** Zero high/critical vulnerabilities identified. Verified separation of district-to-district data.
