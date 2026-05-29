# Contract Gap Report
**Status: BLOCKING IMPLEMENTATION**

Analysis reveals critical gaps and omissions between established specifications. Resolution is required from the Architecture Board prior to allocating dev resources.

## 1. Protocol Drift: Device Sync Endpoint
*   **Conflict:** 
    *   `OPENAPI_SPEC.yaml` defines the sync endpoint as `/api/v1/device/sync` using implicit header-based `DeviceAuth` to identify the device.
    *   `CACHE_AND_SYNC_STRATEGY.md` expects `/api/v1/devices/{id}/manifest` with URI parameter injection. 
*   **Risk:** 404 Routing errors immediately upon device provisioning.
*   **Remediation Required:** Decide whether the URI identifies exactly who the device is, or if the `Bearer` token implicitly drives it. (Recommendation: Keep OpenAPI structure, implicit is safer than REST parameter injection for hardware context).

## 2. Capability Omission: Cache Purging
*   **Conflict:**
    *   Android Cache Strategy dictates relying on a `PURGE_CACHE` socket command to clear out disk space remotely on demand.
    *   `WEBSOCKET_CONTRACTS.md` has no such event mapping.
*   **Risk:** Android players in the field fill their eMMC/SD cards over time with orphaned assets due to sync failures or Edge cases, leading to full-disk crashes.
*   **Remediation Required:** Inject `PURGE_CACHE` into WebSocket contracts and add an explicit `Asset ID` array payload or `PURGE_ALL` boolean.

## 3. Workflow Omission: Emergency Clearance
*   **Conflict:** 
    *   `WEBSOCKET_CONTRACTS.md` supports sending an `ALL_CLEAR` event indicating an emergency is over.
    *   `RBAC_MATRIX.md` allows District/School admins to "Clear Emergency Override".
    *   `OPENAPI_SPEC.yaml` has exactly one `POST /api/v1/emergency/override` route but lacks an API trigger to orchestrate the resolution. 
*   **Risk:** School is locked in an Evacuation screen loop because the frontend has no API hook to tell the backend to issue the `ALL_CLEAR` socket manifest.
*   **Remediation Required:** Expand OpenAPI specific for `DELETE /api/v1/emergency/override/{id}`.

## 4. Omission: The Contributor "Approval" Flow
*   **Conflict:** 
    *   `RBAC_MATRIX.md` says Contributor uploads require Admin Approval.
    *   `PUBLISHING_MODEL.md` says Staging Adjustments apply immediately to the Staging Database.
*   **Risk:** If a Contributor modifies a playlist, does it go to Staging immediately (risking next Admin publish accidentally including unapproved content context), or does it exist in a `DRAFT` state outside staging?
*   **Remediation Required:** Clarify the domain model around `MediaAsset.status` (Needs to include `PENDING_REVIEW` explicitly within the API definitions).
