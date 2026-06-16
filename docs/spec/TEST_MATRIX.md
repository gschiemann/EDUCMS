# Quality Assurance Test Matrices

## 1. Auth and RBAC Matrix
Verifies least-privilege operations securely across all endpoints against key system roles. CI must assert positive returns for ticks, and strong `HTTP 403 Forbidden` for crosses.

| Role | View Dash | Edit Playlist | Upload Asset | Trigger Emergency | Provision Device | Revoke Device | Config System |
|---|---|---|---|---|---|---|---|
| **Super Admin** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **District Admin**| ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **School Admin** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Contributor** | ✅ | ❌ | ✅* (Restricted) | ❌ | ❌ | ❌ | ❌ |
| **Viewer** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

## 2. Contributor Restriction Rules
- **Upload Restrictions**: *Contributors* can only upload assets strictly to their designated "School Review Queue" folders.
- **Publish Blocking**: *Contributors* cannot execute immediate publish parameters across the school. The workflow requires intermediate District/School Admin approval strings.
- **API Defense**: Any attempt by Contributor/Viewer roles to communicate with `/api/emergency`, `/api/groups`, or `/api/devices` must reject automatically and log security telemetry.

## 3. Web & Accessibility Matrix
### Cross-Browser Admin Tests (Playwright / Cypress)
Runs nightly on core admin functionalities to ensure parity.
- **Chromium (Chrome/Edge)**: Latest 2 versions — Full E2E & Visual Regression.
- **Firefox**: Latest — Core happy-path integration tests.
- **Safari (Webkit)**: Latest — UI formatting anomalies and standard media publish pipelines.

### Accessibility Smoke Tests
- **Execution Method**: Integrated via `axe-core` directly into the CI pipeline build process.
- **Standards Bound**: WCAG 2.1 AA Compliance.
- **Key Assertions**: 
  - Valid ARIA label completeness on complex asset media grids and upload zones.
  - Full keyboard navigation loop in the Playlist Publish Flow.
  - Strict color contrast ratios enforced automatically during high priority Emergency Alerts (e.g. Red, High-Vis Yellow overlay rules).

## 4. Android Device Matrix
Hardware profiles and OS combinations necessary for validating the digital signage Kiosk player application.

| Manufacturer / Hardware | Base OS Version | System WebView Target | CPU Arch | Test Scope Objectives |
|---|---|---|---|---|
| Generic TV Box (Amlogic) | Android 10 (API 29) | v83 (Legacy Floor) | ARMv7 | Memory leak isolation, Offline boot parsing, Heavy video decode limits |
| Standard Signage Panel | Android 12 (API 32) | Latest Stable | ARM64 | Connection latency, WebSockets fanout, E2E Provisioning paths |
| Enterprise Display (Sony/Samsung)| Android 11 (API 30)| Latest Stable | ARM64 | Chaos disruption, Auto-boot stability, Long-running 30-day memory tests |
| Simulator (Headless CI) | Android 13 | Chrome Headless | x86_64 | Nightly CI automated progression, component rendering logic |
