# Contract Alignment Report

## Executive Summary
This report analyzes the structural alignment between the approved API/WebSocket backend contracts and the consuming boundaries (Frontend Client and Android Signage Player). The analysis uses the established source artifacts (`OPENAPI_SPEC.yaml`, `WEBSOCKET_CONTRACTS.md`, `PUBLISHING_MODEL.md`, `RBAC_MATRIX.md`, etc.) as the absolute source of truth. 

## 1. OpenAPI vs. Frontend Needs
**Alignment Level: Low / Drifting**
The current `OPENAPI_SPEC.yaml` defines basic routing for CMS and device operations, but fails to provide a significant portion of the CRUD surface area required by the frontend application as dictated by the `RBAC_MATRIX.md`.
*   **Aligned:** Auth login, Basic CMS Asset Creation, Schedules, Publishing, and Outbound Emergency Triggering.
*   **Misaligned/Missing:** The frontend must manage users, districts, screen groups, approve assets, and view audit logs. The OpenAPI specification entirely lacks these routes (`/api/v1/admin/users`, `/api/v1/admin/districts`, `/api/v1/cms/groups`, `/api/v1/cms/assets/approve`, `/api/v1/admin/audit`). 

## 2. WebSocket Contract vs. Android Player Behavior
**Alignment Level: Moderate / Resolvable**
The event-driven flow mostly aligns with the required offline-first behavior of the Android kiosk specifications. Both agree on the fundamental `PUBLISH_AVAILABLE` and `OVERRIDE` push mechanisms.
*   **Aligned:** Heartbeats are transmitted accurately (Payload schemas map to Android's Exoplayer/Device hardware metrics). The Emergency Override JSON structure is robust enough for the WebView rendering.
*   **Misaligned/Missing:** 
    *   `CACHE_AND_SYNC_STRATEGY.md` expects a `PURGE_CACHE` WebSocket command triggered from the admin panel to immediately clear disk assets. This event type is **missing** from `WEBSOCKET_CONTRACTS.md`.
    *   Android expects to poll `/api/v1/devices/{id}/manifest` as a fallback, whereas OpenAPI defines the sync endpoint globally as `/api/v1/device/sync` relying strictly on Device Auth Headers.

## 3. RBAC Matrix vs. Backend/Frontend Enforcement
**Alignment Level: Moderate**
*   **Aligned:** The Super Admin, District Admin, and School Admin hierarchies are well documented, and constraints around "Local vs Global" emergency capabilities are consistent.
*   **Misaligned/Missing:** The "Clear Emergency Override" capability requires explicit tracking. The OpenAPI provides a trigger (`POST /api/v1/emergency/override`), but misses a dedicated clear endpoint (e.g., `POST /api/v1/emergency/override/clear` or `DELETE`), despite `ALL_CLEAR` being a documented WebSocket message. Asset Approval workflow (Contributor to Admin) has no defined REST interface transition state.

## 4. Publishing Model vs. Offline Cache Logic
**Alignment Level: High**
*   **Aligned:** Both specifications rely heavily on strict ETag (`If-None-Match`), SHA-256 asset hash comparison, and the concept of an Atomic swap once 100% of required assets are aggressively pre-fetched to disk.
*   **Misaligned/Missing:** No contradiction in logic, but standard HTTP status codes must be heavily audited. The `304 Not Modified` is heavily relied upon; the backend must ensure weak ETags are not accidentally used, preventing player cache starvation.

## 5. Audit Requirements vs. Privileged Flows
**Alignment Level: Moderate**
*   **Aligned:** `ARCHITECTURE.md` specifically calls out the logging of Actor ID, IP, Before/After states. 
*   **Misaligned/Missing:** The `OPENAPI_SPEC.yaml` lacks `X-Forwarded-For` or IP tracking documentation, and fails to expose the `GET /api/v1/admin/audit` trace necessary for School/District administrators to pull local compliance reports.
