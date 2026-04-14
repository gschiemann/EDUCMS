# Integration Checklist ("Gate" Controls)

Before implementation branches can be merged into staging or deployed to active testing hardware, the following integration gates must be crossed. No code moves forward without these verifications.

## Phase 1: API / Schema Standardization
- [ ] Add `PURGE_CACHE` WebSocket message to `WEBSOCKET_CONTRACTS.md`.
- [ ] Align OpenAPI `GET /api/v1/device/sync` with Android expected `GET /api/v1/devices/{id}/manifest` URL structure, or update Android Spec to follow OpenAPI.
- [ ] Explicitly add `/api/v1/emergency/clear` endpoint to OpenAPI specification.
- [ ] Supplement OpenAPI with CRUD for `Users`, `Districts`, `Screen Groups`, and `Audit Logs`.

## Phase 2: Frontend Client Integration
- [ ] **Auth Token Storage:** Verify JWT / Session implementation stores refresh tokens securely (HttpOnly cookies) per `SECURITY_BASELINE.md`.
- [ ] **RBAC Guarding:** Ensure React Router structure implements a layout guard that maps current session role against the `RBAC_MATRIX.md`.
- [ ] **Validation:** Enforce UI input strict validation mimicking backend rules (Sort/Filter enum whitelist parity).
- [ ] **Emergency Form:** UI for triggering overrides must double-confirm payload generation and ensure `expiresAt` is handled accurately for the client timezone vs UTC backend.

## Phase 3: Android Device Integration
- [ ] **Token Rotation:** Player successfully authenticates using `DeviceAuth` and accurately generates `HELLO` packets on Socket connect.
- [ ] **Cache Loop:** Verify ExoPlayer effectively loads `.mp4` chunks from `file://` URIs and doesn't leak memory on atomic swaps.
- [ ] **WorkManager Fallback:** Test the 15-minute polling fallback when the WebSocket is artificially throttled or firewalled.
- [ ] **Recovery Watchdog:** Validate that `WatchdogService` successfully relaunches `PlayerActivity` if memory exhaust causes a main thread crash.

## Phase 4: E2E Contract Enforcement 
- [ ] **Publish Flow Check:** Stage an asset -> Trigger Publish -> Manifest updates -> Socket Broadcasts -> Device downloads via CDN -> Hash compared -> Asset verified -> Display swapped.
- [ ] **Emergency Takeover Check:** Trigger EVACUATE -> All screens bypass polling -> Render custom text/video -> All Clear triggers -> Reverts to cached offline manifest seamlessly.
- [ ] **Audit Compliance:** After running E2E flow, verify immutable database writes reflect Actor, Before/After diffs precisely.
