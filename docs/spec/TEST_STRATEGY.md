# Test Strategy — VenueOS (EDU CMS)

**Status:** Current / living. **Last verified against repo:** 2026-05-29.
**Supersedes:** `docs/archive/2026-04-original-design/TEST_STRATEGY.md` (a
2026-04-13 fossil that described Socket.io+Redis-adapter realtime, Testcontainers,
Appium device farms, and `< 500ms` fleet-ack SLAs we never measured. None of
that shipped).

**Rule for this file:** describe the tests + gates that **actually run today**,
cite where they live, and state coverage **targets** as targets (not as
achieved facts). Where a gate is advisory-only, say so — overstating CI
enforcement is the same theater pattern that burned us elsewhere.

---

## 1. Tooling (shipped)

| Layer | Tool | Where |
|---|---|---|
| Backend unit / integration | **Jest** (49 `*.spec.ts` co-located in `apps/api/src`) | `apps/api/package.json`; `apps/api/test/jest-e2e.json` |
| Frontend E2E | **Playwright** (Chromium) | `apps/web/playwright.config.ts` |
| Cross-browser canary | Node scripts run under **WebKit** | `apps/web/tests/cross-browser/{holiday-bridge,celebrations-bridge,prod-smoke}.cjs` |
| Accessibility | **axe-core** baseline | `.github/workflows/a11y.yml` |
| Secret scanning | **gitleaks** (pre-commit + CI) | `.husky/pre-commit`; `.github/workflows/ci.yml:142` |
| Local preflight | `pnpm preflight` (lockfile + workspace builds + api + web) | root `package.json` |

Convention: tests live next to source as `*.spec.ts` (CLAUDE.md Conventions).
No production PII / real school data in any test — fixtures are synthetic.

## 2. CI gates (what runs on push to master + every PR)

| Workflow | What it proves | Blocking? |
|---|---|---|
| `ci.yml` | Lint, build, **API Jest suite** | Build/lint block; **API tests are `continue-on-error:true` → run but do NOT block merge** (`ci.yml:36-38`). **This is a known coverage-gating gap — see §5.** |
| `deploy-reliability.yml` | `docker-build`, `api-build`, `web-build`, `lockfile-check` (the exact Railway/Vercel build failure modes) | **Yes** — blocks merge |
| `cross-browser.yml` | Holiday + celebration bridge protocol checks in WebKit (the 2026-05-09 Safari regression class) | **Yes** |
| `taurus-safety.yml` | Scans player/widget paths for Chromium-83 landmines (`inset:0`/`inset-*`, flex `gap`, etc. — CLAUDE.md rule #10) | **Yes** |
| `emergency-path.yml` | DB + WS-signer chain reachable before a drill (`/health/emergency-path`) | **Yes** |
| `prod-smoke.yml` | Post-deploy smoke against the live URL | **Yes** |
| `a11y.yml` | axe-core baseline ratchet (down only, never up) | **Yes** (ratchet) |
| `lighthouse.yml` | Perf budget | **Advisory** (`continue-on-error`) |
| Trivy CVE scan (`ci.yml:176-177`) | Container CVEs | **Advisory** (`continue-on-error:true`, action pinned `@master`) — see §5 |
| `android-player-apk.yml`, `ota-wiring.yml`, `keep-warm.yml` | APK build / OTA tag sync / Vercel keepwarm | varies |

Pre-push: `.husky/pre-commit` blocks lockfile drift + `inset:0`; preflight runs
on push.

## 3. Mocked vs real boundaries (as the suite actually does it)

**Real:**
- **PostgreSQL via Prisma** — service specs exercise real Prisma calls against
  a test DB; tenant-scoping and constraints are verified end-to-end.
- **HMAC signing chain** — `ws-signature` signer/verifier tested directly so
  signer and gate can never drift (`security/ws-signature.ts` + spec).
- **SSRF guard** — `webhooks/webhook-dispatch.ssrf.spec.ts` asserts private-IP
  / rebind rejection.

**Mocked / stubbed:**
- **Stripe** — `billing/stripe.service.spec.ts` mocks the SDK; no live API.
- **External providers** (Resend email, AI providers, Clever, Square) — stubbed.
- **Redis** — pub/sub falls back to an in-process gateway when Redis is absent
  (`redis.service.ts:159-163`), so unit tests don't need a live Redis.

*(There is NO Testcontainers/Minio/Appium/WireMock setup — the fossil's claim
was aspirational.)*

## 4. Coverage TARGETS for load-bearing paths (goals, not yet enforced)

These are the paths where a regression is most expensive. The **target** is a
per-area coverage floor enforced in CI; today coverage is spec-by-spec, not
floor-gated. Treat this table as the roadmap for §5 item 1.

| Load-bearing area | Why | Target |
|---|---|---|
| **Emergency trigger / all-clear / per-screen** | Life-safety; forged-message + replay + fail-open are the catastrophic failures | ≥ 90% line + an E2E that proves trigger→signed-publish→gate-accept and a forged message is dropped |
| **Auth (login, JWT verify, revocation, RBAC, MFA)** | ATO + cross-tenant blast radius | ≥ 90% on `auth/*`; revocation fail-closed + per-user-epoch must have explicit tests |
| **Billing (webhook, seat enforcement, License reconcile)** | Money + over-provisioning | ≥ 85%; webhook idempotency + SERIALIZABLE seat-race + reconcile-drift covered |
| **Tenant isolation** | The whole multi-tenant promise | A cross-tenant IDOR test per resource family (assets/playlists/schedules/screens) asserting a foreign `tenantId` 403s/404s |
| **SSRF guard** | Branding scraper + outbound webhooks reach internal services if it breaks | Keep the rebind + private-range + redirect-revalidation specs green |

## 5. Known gaps in the test/CI posture (the honest list)

1. **API Jest suite does not block merge** (`ci.yml:36-38`,
   `continue-on-error:true`). The gap between "we have 49 specs" and "the specs
   protect master." Highest-ROI fix: remove that one line once flakes are
   triaged. *(Flagged by the 2026-05-29 governance review as the #1 safety fix.)*
2. **Trivy CVE scan is advisory + pinned `@master`** (`ci.yml:176-177`) — an
   unpinned third-party action in the security job that also can't block.
   Fix: pin a version, make HIGH/CRITICAL blocking.
3. **No enforced coverage floor** for the load-bearing paths in §4 — the
   targets above are not yet wired into CI.
4. **WebKit coverage is narrow** — the cross-browser canary checks the holiday
   + celebration bridges, not the ~250 React widgets or the sports pack (audit
   P1-12). Broaden with a widget-render WebKit smoke spec.
5. **No load/fan-out test** — the fossil's "10,000 connections < 3 s" SLA was
   never measured; we have no load harness. If we make fan-out latency a real
   SLO (see `INCIDENT_RESPONSE.md` / observability backlog), build the harness.
6. **Performance numbers are unmeasured** — do not cite `< 500ms` ack or
   `< 3000ms` cold-boot as facts; they were fossil aspirations.

## 6. Discipline (carry-over rules)

- **Clean non-incremental `tsc` before every API push** —
  `rm apps/api/tsconfig.build.tsbuildinfo && pnpm --filter api exec tsc --noEmit
  --project tsconfig.build.json`. Incremental builds have hidden TS errors that
  failed Railway's clean build twice (memory: `feedback_audits_must_be_exhaustive`).
- **Verify before claiming a fix** — load the rendered page / curl the deployed
  asset / confirm CI green + Vercel "Ready" before saying "done"
  (CLAUDE.md Standard Audit Surface §21).
- **Green CI ≠ correct** — CI checks syntax + types + the gates above, not
  "is this component actually mounted" (CLAUDE.md rule #9).
