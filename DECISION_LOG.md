# Decision Log

## Canonical Contracts & Decisions

This log serves as the absolute source of truth for overarching architectural direction and technical contracts. Any conflict or drift in implementation must be resolved by referring back to this log. New proposals must be added here and approved by @Orchestrator before enactment.

| ID | Decision Area | Proposal/Details | Selected Option | Owner | Status |
|---|---|---|---|---|---|
| DEC-01 | **API Communication standard** | We require strict typing, standard edge caching, and wide client support. Evaluate REST vs GraphQL. | **REST + OpenAPI spec** | @DataModeler | Approved |
| DEC-02 | **Offline Sync Protocol** | Android devices must survive long-term network drops. Full daily file sync vs incremental manifest polling. | **Incremental Manifest Polling** | @Orchestrator | Pending Review |
| DEC-03 | **Authentication Methodology** | Need to securely authenticate varying agents (Browsers, automated Android hardware). | **JWT with short expirations and strict Refresh Tokens** | @SecOps | Pending Review |
| DEC-04 | **Role-Based Access (RBAC) Structure** | Must handle isolated hierarchy: SuperAdmin -> District Admin -> School Principal -> Content Creator. | **Hierarchical Strict Multi-Tenant RBAC** | @SecOps | Pending Review |
| DEC-05 | **Android Player Stack** | Requires reliable deep hardware decoding, memory management, and automatic startup on failure. | **Native Kotlin (ExoPlayer)** | @AndroidDev | Approved |
| DEC-06 | **Asset Storage System** | Needs robust scalable blob storage handling massive 4K district video uploads without clogging application bandwidth. | **Pre-signed URLs to Cloud Blob Storage (e.g., S3/GCS)** | @BackendDev | Approved |
| DEC-07 | **Frontend Framework** | Needs dynamic loading, server-side data fetching for SEO-independent admin routes, and component reliability. | **React (Next.js Framework)** | @FrontendDev | Approved |

*Note: Ambiguous requirements discovered during implementation must be raised as a decision proposal to this document to solicit review. Never make assumptions.*
