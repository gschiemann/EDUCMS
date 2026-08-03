# §17 Operational + DX audit — 2026-08-03

Scope: §17 only. All 8 checklist bullets **covered**, none deferred. `origin/master` moved twice during the audit (`a74c7894` → `cec023ec` → `91702ef7` → `ffddbdc4`) from a concurrent session; findings are pinned to specific SHAs.

## Coverage table

| Bullet | Status | D | UX | F | Note |
|---|---|---|---|---|---|
| Health endpoints (liveness / readiness / emergency-path / storage) | covered | B | B | A− | Liveness provably cannot return non-200; all 3 CLAUDE.md "never do" invariants intact |
| Pre-deploy CI gates | covered | B | C+ | **D** | 17 workflows / 25 jobs, but master is RED and has been for 8+ commits |
| Pre-push hooks (lockfile drift, secret scan) | covered | B | B | C | Lockfile + inset guard real; **secret scan does not exist in any hook** |
| Rollback procedure (tag + tarball discipline) | covered | C | D | C | Runbook's primary command targets a **deleted tag**; no restore path for the backups we actually take |
| Multi-replica safety | covered | – | – | C | Correct at `numReplicas:1`; ~14 per-replica limiters + a 30-min per-replica manifest cache make N>1 a cliff |
| Cron / background services | covered | – | – | B− | 17 jobs; 3 exemplary distributed locks; several instance-field "daily" dedupes; failure surfacing is log-only |
| Connection pool sizing | covered | – | – | A− | Real boot assertion (`main.ts:218-240`), not docs-only; one bypass condition |
| Boot-time required-secret enforcement | covered | – | – | B+ | 4 secrets, prod-only; `minLength` too weak for the AES key |
| *(extra)* Observability / Sentry / logging | covered | C | C | **D** | Code is well-written; no evidence it is switched on in prod; no request-id correlation |
| *(extra)* Keep-warm + prod-smoke | covered | B | B | A− | Works; CLAUDE.md describes a Vercel cron that does not exist |
| *(extra)* DX: preflight vs CI, doc freshness | covered | C | C | C | preflight covers 2 of 17 workflows; two concrete CLAUDE.md drifts |

## CI gate inventory

| Workflow | Job | Blocking? | What it actually asserts | False-green risk |
|---|---|---|---|---|
| CI & Security | Build, Lint & Test | **YES** | AI model-retirement gate; workspace builds; **API Jest (blocking, full install → argon2 present)**; `pnpm build` | No timeout |
| CI & Security | Accessibility Lint (jsx-a11y) | **YES** | eslint count ≤ `.a11y-baseline` (221) + hooks ≤ `.hooks-baseline` (10) | Baseline can be raised in the same commit; no timeout |
| CI & Security | Production Dependency Audit | **YES** | `scripts/npm-advisory-audit.cjs` — prod closure vs npm **live** bulk advisory endpoint | **Non-deterministic** (F2); no timeout |
| CI & Security | Secret Leak Scan (gitleaks) | **YES** | Full history on master push. Log confirms real scan + SARIF artifact | No timeout |
| CI & Security | Container Security Scanning | **NO** — `continue-on-error: true` (`ci.yml:304`) | Trivy image scan; deliberately advisory | Decorative by design, documented |
| CI & Security | E2E (Playwright / Chromium) | **YES** | ≥30-test collection floor, then specs vs ephemeral Postgres | **Currently the red job** (F1); newly capped at 30 min |
| Deploy Reliability | apk-version-tag-sync / lockfile-check / api-build / web-build / docker-build | **YES** | Lockfile drift, workspace+API build, web typecheck+build, Docker boot smoke | — |
| Deploy Reliability | api-build → "Run API tests" | **NO** — `continue-on-error: true` (`deploy-reliability.yml:139`) | Redundant: `ci.yml` runs the same suite **blocking** | Stale comment claims the suite is ungated (F8/F15) |
| Deploy Reliability | web-jest | **YES** | Web unit suite (added `e9ec45d0` after 22 suites silently failed to load for 12 days) | Not in `pnpm preflight` |
| Taurus Safety | taurus-safety | **YES** | Chromium-83 pattern scan vs `taurus-safety-baseline.json` **+** `check-inset-serialization.cjs` AST guard | Baseline rewritable (F7) |
| Tenant Isolation | tenant-isolation | **YES** | Fingerprint-based; 180 baselined sites; new fingerprint = red | Baseline rewritable (F7) |
| Capability Registry | capability-registry | **YES** | §21 truth-gate | — |
| Mobile Perf | mobile-perf | **YES** | `check-mobile-perf.cjs` | `perf-allow` escape hatch by design |
| Poster Freshness | poster-freshness | **YES** | `check-poster-freshness.cjs` | — |
| Cross-Browser | webkit-holiday-bridge / webkit-widget-render | **YES** | holiday-bridge + celebrations + kiosk-shim CJS; `widget-render.spec.ts` on **both** projects | Only WebKit Playwright coverage left after F3 |
| Emergency Path | emergency-path (matrix chromium, webkit) | **YES** | `emergency-path.spec.ts` only | — |
| Accessibility (axe-core) | axe | **YES** | `a11y:ci` | Unauthenticated surfaces only (known) |
| OTA Wiring Integrity | check | **YES** | `ota-wiring-check.sh` | **No timeout** |
| Signing Secrets | signing-secrets | **YES** | `check-tracked-keystores.cjs`, `check-apk-debuggable.cjs` | — |
| Android Player APK | build-apk | **YES** | Release-signed build; tag publish | — |
| Prod Smoke | prod-smoke / webkit-nav | **YES** (post-deploy) | Live-login smoke + favicon-crash canary; push + daily 06:00Z | Post-deploy — catches after ship |
| DB Backup | dump | **YES** (scheduled) | `pg_dump -Fc` → AES-256 → 30-day artifact. 5/6 recent runs green | No restore drill (F4) |
| Keep API warm | ping | scheduled */5 | `curl /api/v1/health` | — |
| Lighthouse CI | lighthouse | **NO** — PR-only + `continue-on-error` (`lighthouse.yml:44`) | Perf/a11y budget | Effectively decorative |

Every script referenced by a workflow exists on disk; **no dead gates found**. All 9 `apps/web/tools/check-*.cjs` and `apps/api/tools/check-*.cjs` are wired.

## Findings

**[P0] F1 — `CI & Security` has been red on master for 8 consecutive commits; the "12/12 green" claim is false — NEW**

`docs/research/2026-08-03-launch-readiness/00-LAUNCH-READINESS.md` claims all 12 workflows green on `a74c7894`. Actual (`gh run list --workflow=ci.yml`): failure on `f1705782, 79c7e069, e3fa95b6, e9ec45d0, e956aed4, 25717588, 5844466a, a74c7894`. Last green was `cca5aa78` (2026-08-01T14:29Z). The e2e job specifically: green through 08-01, then `failure` on 6 of 7 runs starting at `f1705782` — the player-security merge.

Root cause, two layers:
- **Trigger:** `f1705782` (INJ-005) moved the holiday-board iframe to a real null-origin sandbox. Reading `navigator.serviceWorker` *invokes a getter that throws* in that context, and none of the existing guards (`!navigator.serviceWorker`, `?.`, even `'serviceWorker' in navigator` followed by a read) prevented it.
- **Amplifier:** the e2e job had no `timeout-minutes`, and `pnpm test:e2e` = `playwright test` with no `--project`, so despite the job name it ran **both** projects (`apps/web/playwright.config.ts:51-59`) at `workers: 1`. The hang ran 19:25→20:14Z and died by runner reclaim. GitHub annotation on job `91793387644`: *"The hosted runner lost communication with the server… starves it for CPU/Memory…"* — no failing step recorded, which is why it read as opaque.

The one green e2e in that window (`5844466a`) proves it is resource/timing-dependent, not a deterministic assertion failure.

**Does the pending fix address it?** The fix is no longer pending — committed as `91702ef7`; `origin/master` is now `ffddbdc4`. Assessment: `safe-service-worker.ts` addresses the **real** cause; `--project=chromium` roughly halves runtime and materially reduces the starvation window; `timeout-minutes: 30` only makes a future hang *legible*, it fixes nothing. **Outcome UNRESOLVED at agent close** — run `30851631766` still `in_progress` at 20:59Z. Do not claim green until that job reports.

**[P0] F2 — the dependency-audit gate is non-deterministic and is red on master right now — NEW**

Run `30851631766` (`ffddbdc4`): *Production Dependency Audit* → `failure` at step "Audit production dependencies (fail on HIGH/CRITICAL)", exit 1. It was **green** on `a74c7894` 110 minutes earlier, and `git diff --stat a74c7894..ffddbdc4 -- pnpm-lock.yaml '**/package.json' package.json` is **empty** — zero dependency changes.

`scripts/npm-advisory-audit.cjs` queries npm's live bulk advisory endpoint at run time (`ci.yml:178-217`). A newly-published HIGH/CRITICAL advisory therefore reds master with no code change, and re-running the same SHA can flip its result. Consequence: **"CI was green at commit X" has no durability** — a claim that matters on launch day. Fix sketch: keep the gate, but (a) pin a reviewed advisory-snapshot file and diff against it so new advisories surface as an explicit *review* rather than a spontaneous master-red, or (b) split into a blocking job over the pinned snapshot plus a scheduled advisory job that opens an issue. Either way, first triage which advisory landed in the last ~2 hours.

**[P1] F3 — the E2E fix silently drops WebKit from 11 specs, two of which CLAUDE.md names as chromium+webkit must-stay-green — NEW**

`91702ef7` pins e2e to `--project=chromium`, justified as "webkit coverage is owned by cross-browser.yml and emergency-path.yml." Verified — only partly true. Remaining WebKit Playwright coverage is exactly two specs: `emergency-path.spec.ts` (matrix, `emergency-path.yml:40`) and `widget-render.spec.ts` (`test:e2e:widget-render`, no `--project`). Losing WebKit: `multiscreen-sync`, `external-html-clickedit`, `external-html-hide-field`, `holiday-hotzone`, `inset-serialization-regression`, `scoreboard-shot`, three `stadium-meet-board-*`, `templates-gallery-perf`, `url-asset-ledfit`.

Two are named in CLAUDE.md as binding invariants — sync rule #5 ("`multiscreen-sync.spec.ts` … chromium+webkit") and the template section ("`external-html-clickedit.spec.ts` # boards (chromium+webkit)"). This is exactly the class cross-browser rule #1 exists to prevent. Partial mitigation: the holiday bridge is still WebKit-covered by `holiday-bridge.cjs`. Fix sketch: keep the chromium pin in `ci.yml`, and add the 3 invariant specs to `cross-browser.yml`'s existing WebKit job (they are short) rather than restoring a full second engine pass.

**[P1] F4 — the rollback runbook's primary command targets a tag that does not exist; automated backups have no documented restore path — NEW**

`docs/BACKUP_AND_ROLLBACK.md:55` — `git reset --hard backup/pre-sprint-0-20260416-170111`. That tag is gone (`git tag -l | grep -c pre-sprint-0` → `0`). Only 3 backup tags survive, newest `backup/pre-signage-fit-20260627` — **37 days stale**, and none was taken before the 2026-08-01→03 security wave, the riskiest change set in the repo's history.

Separately, `db-backup.yml` (daily, `pg_dump -Fc` → `openssl enc -aes-256-cbc -pbkdf2` → 30-day GitHub artifact) is the real backup, green 5/6 recent runs. But the runbook never mentions it: grep for `db-backup|BACKUP_ENC_KEY|openssl|artifact` returns one hypothetical line (`:170`). So there is **no written procedure to decrypt and restore the backups we actually take**, and no evidence a restore drill has ever run. 30-day retention also means corruption older than a month is unrecoverable.

**[P1] F5 — no secret scan in any git hook, contrary to the §17 checklist — NEW**

Checklist reads "Pre-push hooks (lockfile drift, secret scan)". Actual: `.husky/pre-commit` = lockfile drift + `inset: 0` guard; `.husky/pre-push` = non-blocking hygiene warn + `pnpm preflight`. Two methods confirm absence: `grep -rniE "gitleaks|secret|trufflehog|detect-secret" .husky/` → empty, and full read of both hook files. gitleaks exists **only** in CI (`ci.yml:219-248`, blocking, genuinely scanning — "✅ No leaks detected" + SARIF artifact). Impact: a leaked key reaches GitHub and must be rotated, rather than being stopped locally. Fix sketch: add a staged-diff gitleaks pass to pre-commit (sub-second on a diff).

**[P1] F6 — Sentry is wired well but there is no evidence it is switched on in production — NEW**

Four inits: `apps/api/src/sentry.ts:42-62`, `apps/web/sentry.server.config.ts:29-49`, `sentry.client.config.ts:29-52`, `sentry.edge.config.ts:8-13`. All no-op when the DSN is unset (`sentry.ts:39-40`). `SENTRY_DSN` appears **only as an empty placeholder** in `.env.example:186-187` and `apps/api/.env.example:3`, and in zero of the Dockerfile, `railway.json`, or 17 workflows. The 2026-08-03 CI logs corroborate: `[sentry] SENTRY_DSN not set — error tracking disabled.` If the dashboards do not set it, there is **no error tracking at all**, and `all-exceptions.filter.ts:140` returns no `traceId`.

Compounding: **no request-id correlation anywhere** (`x-request-id`/`correlationId` grep across `apps/api/src` → zero middleware), no logging library (stock NestJS `Logger` → Railway's ephemeral buffer), and structured JSON emitted for **mutations only** (`request-log.interceptor.ts:51-75`, GETs early-return). And `apps/player` has no Sentry dependency at all — the kiosk fleet is unmonitored. The edge config has no `beforeSend`, so it is the one surface with no PII scrubbing. UNVERIFIED whether the dashboards set the DSN.

**[P1] F7 — every ratchet baseline can drift UP silently; nothing in CI compares a baseline against its previous value — NEW**

Six ratchets: `.a11y-baseline` (221), `.hooks-baseline` (10), `apps/api/tools/tenant-isolation-baseline.json` (180 fingerprints), `apps/web/tools/taurus-safety-baseline.json`, `bundle-budget-baseline.json`, poster `POSTER_VERSION`. Every one is "ratchets DOWN only" **by comment convention** — `taurus-safety-baseline.json` is rewritten by `check-taurus-safety.cjs baseline` (`:201-207`), bundle budget by `UPDATE_BASELINE=1`, the two text baselines by `echo N > file`. A commit that introduces a violation *and* raises its baseline goes green. Fix sketch: one job step that fails when a baseline file's committed value exceeds the value at the merge-base — cheap, closes all six.

**[P1] F8 — six CI jobs still have no `timeout-minutes`, the exact class that produced F1 — NEW**

AST-verified across all 17 workflows: `ci.yml` → `build-and-test`, `accessibility`, `dependency-audit`, `secret-scan`, `security-scan`; `ota-wiring.yml` → `check`. All default to GitHub's 360-minute cap. The `91702ef7` fix capped only the job that happened to bite. Fix: add `timeout-minutes` to all six (10–15 is generous).

**[P2] F9 — bug-reporter telemetry scrubbing is key-name-exact-match only; screenshots are unredacted — NEW**

`bugs.controller.ts:187` anchors its redaction regex `^…$` on key names, so `stripeSecretKey`, `userToken`, `authHeader` all survive, and **secrets in string values are never touched**. Client buffers capture full URLs including query strings (`bug-ringbuffers.ts:341`), 500-char response-body snippets (`:339`), and verbatim console output (`:294`). Unlike the web Sentry configs (`sentry.server.config.ts:5` includes `email|firstName|lastName|phone|ssn`), the bug redactor has **no PII keys at all**. Full-page screenshots up to 2 MB stored unredacted (`:1014-1077`). This bundle is persisted, **emailed to every `SUPER_ADMIN` fleet-wide**, and shipped to Anthropic's API by `bug-analyzer.service.ts`. In a K-12 tenant that is a student-data path. Good boundary: React Query `dataPresent` is a boolean, so cached rows are not shipped.

**[P2] F10 — `numReplicas:1` is load-bearing in ~14 places and nothing enforces it — NEW**

`railway.json:26` declares `numReplicas: 1` (live Railway value UNVERIFIED). At N>1 these silently break: `manifest-hot-cache.ts:290` (30-min per-replica cache with a **process-local** invalidation rev — an operator edit stays invisible on non-writing replicas for up to 30 min); `gpio.service.ts:107` (per-replica anti-flap on **fire-alarm / panic-button** contacts → N× emergency broadcasts); `mfa-rate-limiter.ts:35` (lockout N×-bypassable); `branding-rate-limiter.ts:38`, `data-source-rate-limiter.ts:33`, `feeds-rate-limiter.ts:44`, `screens.controller.ts:125/149`, `sports-board.controller.ts:41`, `sponsors.controller.ts:65`; `device-auth.ts:124` (credential revoke only clears the acting replica); `sports.service.ts:170`; `fitness/stick-control.controller.ts:71`. Redis-backed and correct: the global throttler (`redis-throttler-storage.ts:51`, fails **open** on a 250 ms Redis timeout), all AI caps, POS webhook idempotency, notification dedup. Fix: no code change needed today — comment in `railway.json` that scaling replicas is a code change, not a config change, and cite the list.

**[P2] F11 — cron failure surfacing is log-only for 16 of 17 background jobs — NEW**

No `@nestjs/schedule` anywhere; all 17 are hand-rolled `setInterval` in `onModuleInit`. Only `storage-watchdog.service.ts:103/148` escalates (email + Sentry). Everything else is `logger.warn` into Railway's ephemeral buffer — including `canary-auto-promote.ts:312`, whose audit insert is `.catch(() => {})`, **silently swallowed**. Three jobs are the pattern to copy: `proof-of-play.sampler.ts:117/226` (`pg_try_advisory_xact_lock`, pgBouncer-safe), `webhook-retry.worker.ts:166` (`FOR UPDATE SKIP LOCKED` + lease heartbeat — matters because it carries `emergency.triggered`), `time-sync.service.ts` (Redis-master clock). Two jobs have **no overlap guard at all**: `screen-wedge-detector.cron.ts:144` and `clever-sync.cron.ts:25` (the latter also `void`-calls `tick()` with no outer try/catch).

**[P2] F12 — secret-length enforcement is 16 chars but AES-256 needs 64 hex — NEW**

`required-secret.ts:24` defaults `minLength = 16`; `assertRequiredSecretsAtBoot()` (`:75-81`, called from `main.ts:44`) passes no override. But `ai-key-cipher.ts:30-38`, `mfa-secret-cipher.ts:30-38` and `creds-cipher.ts:34` each throw in prod when `DEVICE_SECRET_KEY.length < 64`. A 20-char key **boots clean, passes the Railway healthcheck**, then 500s every AI-key / MFA / streaming-credential decrypt — the exact lazy-validation failure the boot assertion was written to eliminate. One-line fix: `minLength: 64` for that key.

**[P2] F13 — the pool assertion is skipped unless the URL says `pgbouncer=true` — NEW**

The assertion is **real code**, not docs — `main.ts:218-240`, prod-gated, throws unless `connection_limit >= 10` and `pool_timeout >= 20`. Gap: `:223-224` gates on `/[?&]pgbouncer=true\b/`, so a pooler URL missing that flag with `connection_limit=1` boots clean — reintroducing the documented "silent killer." Note `packages/database/.env:1` currently holds exactly that shape; gitignored and untracked, so a local-dev observation, not a leak.

**[P2] F14 — CLAUDE.md doc drift, two confirmed items — NEW**

(a) `CLAUDE.md:1105` and `:1107` state the repo is **PUBLIC**; `gh repo view --json visibility` returns `PRIVATE` (made private 2026-08-03). Agents reading CLAUDE.md will apply the wrong disclosure model in both directions. (b) `CLAUDE.md:451` instructs verifying a deploy via "Vercel cron `/api/cron/keepwarm` logs a 200 every 5 minutes." `apps/web/vercel.json` is the only vercel.json and has **no `crons` key**; `keep-warm.yml:5-7` states it *replaces* the Vercel cron because Hobby allows daily only. The route exists but nothing schedules it.

**[P2] F15 — smaller items**

`deploy-reliability.yml:130-139` — the "API Jest is non-blocking, tracked as §17 G2" comment is **stale/misleading**: `ci.yml:52-58` runs the same suite **blocking** with a full (non-`--ignore-scripts`) install, so argon2 builds and the gate is real. The deploy-reliability copy is redundant, not a hole. · `redis.service.ts:103-106` — `retryStrategy` returns `null` after 4 attempts, so a Redis blip at boot puts the process in HTTP-polling fallback **permanently** until redeploy; liveness reports `redis:'fallback'` forever with no self-heal and no alert. · `pnpm preflight` covers 2 of 17 workflows; the eight sub-10-second node guards (taurus, inset-serialization, mobile-perf, tenant-isolation, capability-registry, poster, brand-contrast, model-retirements) and web-jest are all "green locally, red in CI" candidates. · `.git` has 4,275 loose objects, tripping the repo's own hygiene rule. · Every workflow emits the Node-20 deprecation warning for `actions/checkout@v4`, `setup-node@v4`, `pnpm/action-setup@v4`.

**Confirmed intact** (CLAUDE.md "Never do" list, all three): `railway.json:29` `restartPolicyMaxRetries: 10`; `healthcheckPath: /api/v1/health` pointing at a liveness endpoint with **no** DB dependency — both awaits are `Promise.race`-bounded (400 ms DB, 200 ms Redis) inside bare `catch` blocks, worst case ~600 ms, `health.controller.ts:119-120` `// Always 200`; and the 7 s Redis hard cap at `redis.service.ts:139/160`. `/health/ready` 503s on DB fail (`:142-144`); `/health/emergency-path` asserts DB + WS-signer and 503s on either (`:190-192`); `/health/storage` exists with a single-flight 30 s cache guarding against unauthenticated storage-write amplification.

## Unverified / open questions

1. **Did `91702ef7` actually fix E2E?** Unresolved at agent close — run `30851631766` was `in_progress`. *(Lead followed up — see `12-lead-verification.md`.)*
2. **Which advisory reds F2?** Requires the completed job log or a local `node scripts/npm-advisory-audit.cjs`.
3. **Is `SENTRY_DSN` set in the Railway/Vercel dashboards?** Not determinable read-only. If unset, F6 is P1; if set, F6 reduces to missing request-id correlation and the unmonitored player.
4. **Live Railway `numReplicas`.** Repo declares 1; the dashboard can override. UNVERIFIED.
5. **Has a backup restore ever been drilled?** No artifact, log, or doc found.
6. **`holiday-hotzone.spec.ts`** — `91702ef7`'s own commit body records it failing locally on unmodified master, yet e2e was green in CI through 08-01. The e2e job runs `pnpm db:push` but **not** `db:seed`. Worth confirming it is not silently skipping.
