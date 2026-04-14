# Automated Regression Suite Plan

## Core Philosophy
Maintain strict safety and feature preservation across deployments by utilizing lightweight localized tests on every PR, comprehensive API/UI scenarios on standard merge events, and deep device state-machine validations operating on full nightly schedule intervals.

## 1. CI Execution Strategy
- **Per-PR Checks (Unit/Linters)**: Enforce typescript schema strictness, RBAC payload unit verifications, rendering consistency testing context (`vitest` / `jest`), and frontend linting.
- **Merge Window Checks**:
  - Run integration APIs mapping endpoints via Jest against an ephemeral PostgreSQL Docker container. 
  - Execute 40% prioritized Playwright automated core happy-paths.
- **Nightly Suite**: 100% full-volume Playwright cross-browser runs, active Appium testing hitting target WebView instances to probe device degradation.

## 2. Audit Log Verification
- **Scenario Outline**: Ensure that any structural or platform changes forcibly emit strictly formatted, persistent event logs for compliance reporting.
- **Test Methodology**:
  1. Trigger dynamic chain: Send an Emergency Alert -> Revoke an Active Device -> Delete a User Admin.
  2. Perform `GET /api/audit-logs` query loop.
  3. **Assertion Checklist**:
     - System securely returns 3 exact events.
     - Timestamp structures correctly monotonically increase.
     - Deep validation maps the correct source `actor_id`, `ip_address`, and internal `entity_targets` identically for every trace context.

## 3. Duplicate Event & Idempotency Tests
- **Scenario Outline**: Prove database logic holds solid when bad networking causes duplicate payload broadcasts (e.g. users furiously repeatedly clicking "Publish").
- **Test Methodology**:
  1. Establish `Idempotency-Key` hash from frontend payload layout.
  2. Immediately fire 4 concurrent `POST /api/playlists/publish` requests exactly simultaneously.
  3. **Assertion Checklist**:
     - The first server thread acquires mutual locks and executes returning standard `200/201`.
     - The remaining 3 subsequent threads securely recognize duplication caching structure and return idempotent success `200` without data mutation or `409 Conflict`.
     - Query underlying SQL DB confirming explicitly only ONE timeline map entity transaction was written effectively.

## 4. Player Sync & Time-State Regression
- **Scenario Outline**: Verify Android players cleanly auto-transition logic configurations over time blocks securely without direct gateway access or interference.
- **Test Methodology**:
  1. Create "Day Setup" mapping (08:00 to 18:00) and "Night Mode Config" (18:00 to 08:00).
  2. Implement system clock drift manipulation (`Freezing` OS level chronometry scripts).
  3. **Assertion Checklist**:
     - Device software reliably calculates exact block time rotation using edge device OS time parameters independent from server ping requirements.
     - Logs securely capture local transitions without errors or cache tearing artifacts.
