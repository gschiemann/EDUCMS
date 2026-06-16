# Artifact & Deliverable Matrix

| Artifact Name | Owning Agent | Downstream Consumers | Approval Required? | Blocker Status |
|---|---|---|---|---|
| `SCHEMA.md` | @DataModeler | @BackendDev, @FrontendDev, @AndroidDev | Yes | **BLOCKER** |
| `API_OPENAPI.yaml` | @DataModeler | @BackendDev, @FrontendDev, @AndroidDev | Yes | **BLOCKER** |
| `RBAC_SPEC.md` | @SecOps | @BackendDev, @FrontendDev | Yes | **BLOCKER** |
| `AUDIT_EVENT_STANDARD.md` | @SecOps | @BackendDev | Yes | **BLOCKER** |
| `SYNC_PROTOCOL.md` | @Orchestrator | @BackendDev, @AndroidDev | Yes | **BLOCKER** |
| `backend_auth_module` | @BackendDev | @FrontendDev, @AndroidDev | Yes | Non-Blocker |
| `backend_sync_endpoints` | @BackendDev | @AndroidDev | Yes | Non-Blocker |
| `admin_ui_dashboard` | @FrontendDev | End Users, QA | No | Non-Blocker |
| `android_sync_worker` | @AndroidDev | QA, @Orchestrator | Yes | Non-Blocker |
| `security_audit_report` | @SecOps | @Orchestrator | Yes | **RELEASE BLOCKER** |
| `e2e_integration_tests` | @Orchestrator | - | Yes | **RELEASE BLOCKER** |
