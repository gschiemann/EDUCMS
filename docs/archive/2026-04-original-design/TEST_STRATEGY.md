# QA Architecture & Test Strategy

## Objective
Establish a comprehensive test and automation strategy to prove the multi-tenant digital signage CMS is safe, correct, resilient, and ready for school deployment.

## Test Data Strategy
- **Isolated Tenant Data**: Every test suite execution runs within a uniquely generated tenant namespace to ensure clean state and prevent cross-tenant parameter leakage.
- **Data Fixtures**: Golden datasets for assets, screen groups, and schedules are seeded via pure SQL or API commands pre-test.
- **Dynamic Provisioning**: Devices, user roles, and API keys are dynamically generated via admin endpoints during setup and securely destroyed during teardown.
- **Anonymization**: No production PII or actual school data is ever used in testing environments. All names, emails, hardware IDs, and media assets are synthetically generated.

## Mocked vs Real Integration Boundaries
### 1. Mocked Boundaries
- **External Identity Providers (SSO)**: OIDC/SAML login flows are mocked via structural stubs (e.g., WireMock) to fiercely test the core app's RBAC matrix without relying on external IdP connectivity or uptime.
- **Cloud Storage (S3/R2)**: Network partitioning or slow asset uploads are tested using an S3-compatible mock server (e.g., Minio locally). This forces storage timeout, failover, and retry conditions safely without incurring cloud costs.
- **External SMS/Email Notifications**: Mocked entirely to ensure assertions can inspect content without sending genuine payloads.

### 2. Real Integration Boundaries
- **Database (PostgreSQL)**: Fully real. Uses isolated schemas per parallel test runner or isolated Testcontainers to ensure true end-to-end API transactional correctness and constraints verification.
- **Realtime Gateway (WebSockets/Redis)**: Real execution using Socket.io and a Redis adapter. This validates true message fanout, actual network latency, idempotent message delivery, and real connection drop management.
- **Android Kiosk (Headless)**: Uses real Android instances driven via Appium or simulated via headless Chromium mimicking target Android System WebView version constraints.

## Performance Thresholds
To certify the platform for production school environment deployment, the following thresholds **MUST** be strictly met and monitored throughout continuous integration tests:
- **Emergency Override Delivery Latency**: `< 500ms` from API trigger to acknowledgment payload received from 95% of active fleet.
- **Player Recovery (Network Partition)**: `< 2000ms` to identify and securely reconcile missed state changes upon WebSocket client reconnection.
- **Offline Boot Time**: `< 3000ms` for seamless media rendering from the local SQLite store and local cache upon a cold boot event lacking WAN.
- **Asset Upload Sanitization**: `< 1500ms` overhead for backend file magic number validation and active virus scanning workflows.
- **Publish Flow Fanout Time**: 10,000 active mock connections must receive general playlist synchronization configuration under `< 3 seconds`.
