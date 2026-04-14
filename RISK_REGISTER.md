# Risk Register

## High Priority / Release Blockers

| Risk ID | Risk Description | Impact | Mitigation Strategy | Owner |
|---|---|---|---|---|
| RSK-01 | **Security Data Leakage / Tenant Bleed** | A school principal views, edits, or deletes screen playlists belonging to a different school or district. | *RELEASE BLOCKER.* Implement rigid Row-Level Security (RLS) in DB structure. Strict multi-tenant RBAC unit tests required before PR merges. | @SecOps |
| RSK-02 | **Offline Reliability Failure** | Network drops cause the digital signage to go blank, show error modals, or crash. Cannot manually restart all screens in a district. | *RELEASE BLOCKER.* App must catch exceptions natively, fail gracefully, and infinitely loop the most recent localized cache manifest. Enforce strict logic: Never wipe the local cache until new cache downloaded is 100% structurally sound. | @AndroidDev |
| RSK-03 | **Auditability Deficit** | Inappropriate or mistaken content is pushed to school displays with no clear trail of who uploaded or assigned it. | *RELEASE BLOCKER.* Every state mutation must invoke an immutable, cryptographically verifiable append to the system Audit Log. UI must expose this directly to District Admins. | @BackendDev |
| RSK-04 | **Component/Agent Drift** | Frontend/Android builds against imaginary APIs causing an explosive failure at Phase 6 integration. | Utilize strict API contract-first development. CI pipelines will fail if the code diverges from `API_OPENAPI.yaml`. | @Orchestrator |
| RSK-05 | **Hardware Memory Leak** | Android SoC runs out of physical local storage space after continuously downloading numerous new 4k videos. | Android manifest parser must proactively track usage footprint and meticulously prune orphaned/unreferenced assets from local storage continuously. | @AndroidDev |
