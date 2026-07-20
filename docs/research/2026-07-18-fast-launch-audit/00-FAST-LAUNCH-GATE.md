# Fast Launch-Readiness Gate — 2026-07-18

**Verdict: GO for controlled launch. 0 code blockers.** All CI gates green on HEAD, production API + web are running exactly HEAD, emergency path verified live. Remaining items are **configuration decisions**, listed below in priority order.

## Scope (page-1 statement, per Standard Audit Surface rule)

This is a **fast launch-gate verification pass**, not a full 21-section audit. Full-depth coverage rides on the 2026-07-16 12-domain adversarial re-audit (READY FOR CONTROLLED LAUNCH, 0 surviving blockers, HEAD `ed8a66f0`) — this pass verifies **nothing regressed in the 4 commits since** (`cf3a1d8c`…`20aaf2b2`, all hardening: WCAG-AA palette, BYOK no-silent-spend, TEN-001 tenant-isolation gate, Capability Registry gate, audit-log TRUNCATE block) and **re-checks the live environment against reality** (curls, CI conclusions, env inspection — no assumptions). No agent fleets used (usage-wall rule); single-session inline verification.

| Surface section | This pass | Evidence |
|---|---|---|
| §1 Realtime + emergency | **Re-verified live** | `/health/emergency-path` → db ok, redis ok, ws_signer ok; Emergency Path CI workflow green |
| §10 Auth + identity | **Config-checked** | Boot secrets present; JWT/SESSION secret quality flagged (see below) |
| §11 Billing | **Config-checked** | Stripe fully wired, **test-mode keys** (go-live switch pending) |
| §3/§4 AI providers/surfaces | **Config-checked + retirement gate run** | No dead models shipped; Tier-1 key absent (graceful); imagen deadline 29 days |
| §15 Cross-browser/Taurus | **CI-verified** | Taurus Safety + Cross-Browser workflows green on HEAD |
| §16 Forensic/audit | **CI-verified + new gate** | Tenant Isolation gate green; audit_logs TRUNCATE now blocked (`20aaf2b2`) |
| §17 Operational/DX | **Fully re-verified** | Health endpoints, CI matrix, worktree hygiene 0, deploy=HEAD |
| §18 A11y | **CI-verified** | axe-core workflow green (authed-depth still deferred, known) |
| All other sections | **Riding on 2026-07-16 audit** | No code changes in those domains since |

## Verified green today (evidence)

1. **Repo**: `master`, clean, synced with origin, 0 leftover agent worktrees.
2. **CI on HEAD `20aaf2b2`** — all 12 workflows **success**: Deploy Reliability, CI & Security, Taurus Safety, Prod Smoke, Capability Registry, Android Player APK, OTA Wiring Integrity, Accessibility (axe-core), Cross-Browser, Mobile Perf, Tenant Isolation, Emergency Path.
3. **Live API = HEAD**: `/health` 200 with `commit: 20aaf2b2…`, db ok, redis ok. `/health/ready` 200. `/health/emergency-path` 200 with **ws_signer ok** — the life-safety chain is live-verified on the running deploy.
4. **Web**: `https://venue-os.app` 200 in 0.67s with correct title; `/login` 200; `NEXT_PUBLIC_API_URL` set in all Vercel envs; latest Vercel Production deploy **Ready** (same push as HEAD).
5. **Env config confirmed correct** (names only — no values in this doc): `ALLOWED_ORIGINS` (4 origins incl. venue-os.app), `DATABASE_URL` with `connection_limit=25&pool_timeout=20`, `DIRECT_URL`, `NODE_ENV=production`, `EMAIL_FROM` on the **custom verified domain** (the "Resend only delivers to account owner" trap is resolved), `RESEND_API_KEY`, `REDIS_URL`, `SENTRY_DSN` (observability live), device secrets are real 64-char hex, CSRF **enforced** (no override set), `DEV_WS_ALLOW` correctly absent, `STRICT_REPAIR_AUTH=true`, `GH_TOKEN` set (player OTA), APK pinned v1.0.63, `GOOGLE_MAPS_API_KEY` set.
6. **Model-retirement gate**: "no dead models shipped." gemini-2.5-flash/pro 89 days out (tracked).
7. **Code defaults confirmed** for absent env vars: `EGRESS_ANOMALY_MIN_GB` defaults 1 GB; `PILOT_SEAT_LIMIT` defaults 1000 (fine for controlled launch).

## Open items (all config — priority order)

| # | Item | Severity | Detail |
|---|---|---|---|
| 1 | **Rotate `JWT_SECRET` + `SESSION_SECRET`** | HIGH (do before external users) | Both are human-written "beta"-era phrases, not crypto-random 64-hex. Standing to-do from multiple audits. Rotating invalidates all sessions — cheap now, disruptive after customers onboard. `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` per secret, set in Railway, redeploy. |
| 2 | **Set `PLATFORM_ALERT_EMAILS`** | MED | Unset → platform-ops alerts fall back to mailing **every SUPER_ADMIN** (incl. the work-email test user — the exact 2026-07-16 noise problem returns the next time an alert fires). One comma-separated env var. |
| 3 | **Stripe live keys** | MED (go-live switch) | `STRIPE_SECRET_KEY` is `sk_test_…`; prices + webhook all wired and healthy in test mode. Swap key + webhook secret + price ids when real billing should start. Intentional for controlled beta — no action needed until first paying customer. |
| 4 | **`ANTHROPIC_API_KEY` absent (Tier-1 platform AI)** | MED | Concierge / platform-tier AI features degrade to "AI not configured" for tenants without BYOK. Graceful, but the flagship AI experience is dark on platform tier. |
| 5 | **`PEXELS_API_KEY` absent** | LOW (free, 2-min) | Photo-forward AI boards ship on gradient fallback instead of real stock photos. Free key at pexels.com/api. |
| 6 | **imagen-4.0-generate-001 shutdown 2026-08-17 (29 days)** | DATED ENG ITEM | The one code change on a clock: replacement `gemini-3.1-flash-image` uses `generateContent`, not `:predict` — real change in `callGoogleImage` (`apps/api/src/ai/ai.service.ts`), not an id swap. Known-deferred from 7-16 audit; now inside 30 days. |

Deferred-with-reason (unchanged from 2026-07-16, accepted): authed-page axe depth, E2E depth beyond the ≥30-test floor.
