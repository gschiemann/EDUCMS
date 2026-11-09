# Security Gap Register — VenueOS (EDU CMS)

**Status:** Current / living. **Last verified against code:** 2026-11-09.
**Audience:** the VenueOS team, security reviewers, district IT due-diligence.
**Companion to:** `SECURITY_BASELINE.md` (the SHIPPED controls) and
`THREAT_MODEL.md` (the attack surface). This file is the **single honest list
of what we have NOT built, have deliberately deferred, or have accepted as a
risk** — so the baseline can point here instead of overstating coverage.

> **Why this file exists.** On 2026-05-21 the lead found that our security docs
> *lied* — they asserted controls (mandatory malware scanning, refresh-token
> rotation, `SameSite=Strict`) that were never built. A doc that claims a
> safeguard we don't have is worse than no doc. The rule: a control is either a
> **SHIPPED** line in `SECURITY_BASELINE.md` with a cite, or a **GAP** in this
> register. Nothing in between, no aspirational language written as fact.

**How to read the Status column:**
- **OPEN** — not built; a reviewer will ask about it; mitigation noted.
- **ACCEPTED** — known, deliberately not addressed yet; risk understood.
- **PENDING** — on the roadmap, partially scaffolded or scheduled.
- **DECISION-NEEDED** — a policy/ownership call the team must make.
- **CLOSED** — built since an earlier revision; kept one revision so a stale
  questionnaire answer can be corrected, then deleted.

Paths are relative to `apps/api/src/` unless they start with `apps/`,
`packages/`, `docs/`, `scripts/` or `.github/`.

---

## 1. Gap register (the whole truth, in one table)

| # | Gap | Status | Mitigation in place today | Tracking / next step |
|---|-----|--------|---------------------------|----------------------|
| G1 | **Upload malware scanning** — no ClamAV / AV engine. Search: `grep -rni "clam\|virus\|malware" apps/api/src` → only a comment in `customers/customer-invoice-storage.service.ts` ("not an antivirus claim"). | OPEN | Resolved-format allowlist + SVG block (upload **and** bucket) + post-upload content check (decode / probe) + per-type size caps (`AssetsController.assertUploadIntent`, `UploadContentCheckService`, `ASSETS_BUCKET_MIME_TYPES`). Files are served as static media, not executed server-side — but ffmpeg / sharp / libheif **parse** them inside the API container (`runTool`, SIGKILL timeout only). | Async scan step before an asset becomes publishable; run media tools in a sandboxed worker. A district security review **will** ask. |
| G2 | ~~Refresh-token rotation~~ | **CLOSED (2026-09-05, SEC-010)** | Access JWT ≤ 1 h always; remember-me is a hashed, single-use, rotating refresh secret in an HttpOnly cookie with family-wide reuse revocation. See `SECURITY_BASELINE.md` §2 (`SessionRefreshService.rotate`, `auth/session-refresh.service.ts`). | Delete this row at the next revision. |
| G3 | ~~WebAuthn / passkeys~~ | **CLOSED (2026-09-21)** | Passkeys shipped (`PasskeyController`, `auth/passkey.controller.ts`); MFA is **required** for admins and panic-capable users since 2026-10-04 (`evaluateMfaPolicy`, `auth/mfa-policy.ts`). See `SECURITY_BASELINE.md` §2. | Delete this row at the next revision. |
| G4 | **Repo is PUBLIC on GitHub.** Every commit, PR and issue is world-visible — including tracked files under the gitignored `docs/research/` (G16). | DECISION-NEEDED | gitleaks in CI (`ci.yml`); GitHub secret scanning + push protection (repository setting, per `docs/governance/MECHANISMS.md` row 12); `.env` gitignored; boot refuses missing secrets. The tracked-research review below found **no live secret**. | Owner decision (memory: stays public until CI minutes allow private). Until then G16 must be resolved by hand. |
| G5 | **Some abuse counters are in-process.** The throttler, login limiter and AI hourly caps are now Redis-backed; the **MFA attempt limiter** (`MfaRateLimiter`, `auth/mfa-rate-limiter.ts`) and the **branding-scrape limiter** (`BrandingRateLimiter`, `branding/branding-rate-limiter.ts`) are still `Map`s. *(narrowed 2026-11-09)* | ACCEPTED (single replica) | `railway.json` `numReplicas: 1`, so the counters are correct as deployed. | Move both to Redis before scaling the API horizontally. |
| G6 | **No anomaly / impossible-travel detection.** `AnomalyMiddleware` (`security/anomaly.middleware.ts`) only logs a request with no User-Agent and calls itself a mock. *(corrected 2026-11-09 — the baseline used to list it as a shipped control)* | ACCEPTED | Per-IP throttle + per-account lock + Argon2id + audit rows on every login success/failure/lock. | Backlog; replace or delete the mock so it is not cited as a control. |
| G7 | **No dedicated staging environment.** Push-to-master = production (Railway API + Vercel web). | ACCEPTED | Ruleset requires a PR and **nine** status checks (lockfile, API build, web build, Docker boot smoke, schema migration, chromium + webkit emergency path, two-tenant isolation matrix, Build/Lint/Test); nightly encrypted backup with a weekly restore drill (`.github/workflows/db-backup.yml`, `db-restore-drill.yml`); rollback per `docs/BACKUP_AND_ROLLBACK.md`. | Stand up staging when budget/scale warrants. |
| G8 | **Player-side emergency verification is a presence check**, not asymmetric verify. | ACCEPTED (server gate is primary) | Channel-bound server HMAC gate (`RedisService.handleRedisMessage`, `verifyWsHmac`); player freshness + replay on every transport (`checkSensitivePush`, `apps/web/src/app/player/pushGate.ts`); emergency-rev raise confirmed by the database (`descriptorMatchesConfirmed`). Weakness: G12. | Asymmetric, KMS-held signing (CLAUDE.md §5 "the next design"). |
| G9 | **Tenant containment is partial.** Organisation suspend now exists (blocks people + API keys + new pairings; `OrgSuspensionGate`, `customers/org-suspension.interceptor.ts`) but it is a **billing** control: it fails open, never stops screens, and there is no one-call "revoke every credential of this tenant" for a compromised tenant. *(narrowed 2026-11-09)* | OPEN | Per-screen credential revoke (`screens.credential-revoke.spec.ts`), per-user invalid-before epoch, API-key revoke. | A security-grade tenant freeze (fail-closed, revokes device credentials) — see `docs/spec/INCIDENT_RESPONSE.md`. |
| G10 | **DSAR / deletion has no formal SLA.** | PENDING | Path documented (`docs/spec/DATA_RETENTION.md` §4); Clever disconnect purges tokens (`CleverService.disconnect`, `integrations/clever/clever.service.ts`). | Formalize a DSAR SLA + self-serve export. |
| G11 | **Signed DPA template is not a repo artifact.** | PENDING | `docs/spec/COMPLIANCE.md` + `DATA_RETENTION.md` + this file are the engineering inputs. | Required before any student-roster ingest. |
| G12 | **One trust domain for every secret; symmetric life-safety signing.** *(new 2026-11-09)* All keys are plain Railway environment variables; a reader of that environment (it happened — the 2026-10-21 leak) can forge a channel-bound emergency fan-out (`DEVICE_SECRET_KEY`), mint device tokens (`DEVICE_JWT_SECRET`) and user tokens of any role (`JWT_SECRET`), unseal stored credentials, and write Redis / the database directly. | OPEN | Windowed device-key rotation + re-wrap + finish guard + fleet refusal alarms (`security/key-ring.ts`, `security/key-rotation-rewrap.service.ts`, `scripts/railway-rotation.mjs`, `docs/SECRET-ROTATION.md`); emergency-rev no longer signs what only Redis asserts (`screens/emergency-rev.ts`). | KMS-held asymmetric signing for the emergency path; split secrets by consumer. |
| G13 | **No rotation window for `JWT_SECRET`, `SESSION_SECRET`, `CLEVER_ENCRYPTION_KEY`.** *(new 2026-11-09)* A rotation of the first two is a straight swap that signs every operator out; Clever tokens are sealed under a key outside the ring and outside the re-wrap job (`deriveKey`, `integrations/clever/clever-crypto.ts`). | OPEN | `docs/SECRET-ROTATION.md` names the consequence per secret. | Extend the key ring to these three. |
| G14 | **USB package key is per-tenant and held by every screen.** *(new 2026-11-09)* `GET /screens/:id/usb-key` hands the tenant's HMAC key to every paired screen, so one extracted device key forges signed packages for the tenant's whole fleet; the old "operator PIN" was never built (import is automatic since 2026-10-22). | OPEN | HMAC-SHA256 manifest signature + tenant match + per-file SHA-256 (`UsbPackage`, `UsbSelection.verifyAll` in `apps/player/.../usb/`); `ensureUsbSigningKey` (`usb-export/usb-signing-key.ts`). | Asymmetric package signing (server-held private key, screens hold only the public key). |
| G15 | **Support-access exempt prefixes are a prose promise.** *(new 2026-11-09)* `/api/v1/super`, `/bugs`, `/billing`, `/license`, `/player-ota` bypass the grant check by design ("metadata only"); nothing enforces that a `/super/*` route returns no customer content; reads under a grant are attributed, not individually logged. | DECISION-NEEDED | Grant gate on everything else, fails closed (`SupportAccessInterceptor`, `isSupportAccessExemptPath`); destructive cross-tenant ops gated by env + typed confirmation + audit (`POST /super/storage/wipe-all-assets`, `PLATFORM_ASSET_WIPE_ENABLED`). | Inventory `/super/*` responses; decide on read logging and on the Bug Reporter. |
| G16 | **Tracked research files in a public repo name customers.** *(new 2026-11-09)* See the review below. | PARTLY CLOSED | No live secret found. The one High file (the support-access report naming customers) was removed from the tree on 2026-11-09; the Low items stay for now. | Owner decision: rewrite history to purge the removed file (or go private first), and whether to remove the Low items. Never re-add `docs/research/` files to git. |
| G17 | **Renderer has no request authentication.** *(new 2026-11-09)* `apps/renderer` relies on Railway private networking (`apps/renderer/README.md`: "do NOT generate a public domain"). | ACCEPTED | Chromium itself has no network (`apps/renderer/src/network.ts`); body size, timeout and queue caps (`apps/renderer/src/config.ts`). | Add a shared-secret header if the service ever gains a public route. |

---

## 2. What is NOT a gap (so reviewers don't double-count)

Cited to code in `SECURITY_BASELINE.md`; listed here only to prevent re-flagging:

- **TOTP MFA, email-code fallback, WebAuthn passkeys, required MFA for privileged users.**
- **Rotating refresh tokens with reuse detection; 1 h access tokens.**
- **SSO (SAML + OIDC)** with a per-tenant enabled-gate.
- **JWT revocation** — every environment, fails closed, durable Postgres mirror.
- **AuditLog DB-level immutability** — UPDATE / DELETE / TRUNCATE blocked.
- **Tenant-isolation static gate + required two-tenant matrix check.**
- **Customer-approved support access** for VenueOS staff.
- **Windowed rotation of the two device secrets.**
- **PCI-SAQ-A** — Stripe-hosted checkout/portal; no PAN anywhere.
- **SSRF defense** on every user-supplied URL fetch; renderer has no network.
- **Webhook delivery retry** (`webhooks/webhook-retry.worker.ts`) and
  **License↔Stripe reconcile cron** (`billing/license-reconcile.cron.ts`).
- **Supply-chain scans** — prod advisory audit (push + hourly), Trivy, gitleaks,
  Node runtime watch; OSV (APK) and action-pin drift are report-only.

---

## 3. Discipline (how to keep this file honest)

1. **Closing a gap = move it to `SECURITY_BASELINE.md` with a cite** and mark it
   CLOSED here for one revision, then delete it.
2. **Opening a gap = add a row here with a real mitigation + tracking note.**
3. **Re-verify on every security pass, and at least every 120 days** —
   `scripts/check-threat-model-age.cjs` reports when this header is older
   (report-only step in `.github/workflows/security-watch.yml`).
4. When a district security questionnaire arrives, answer **from this file plus
   `SECURITY_BASELINE.md`** — not from memory, and not from `docs/archive/`.

---

## Tracked research files — review 2026-11-09

`docs/research/` is gitignored, but 235 files under it are **tracked** (`git
ls-files docs/research`): 50 `.md`, 5 `.json`, 1 `.patch`, 165 `.png`, 14 `.jpg`.
No file was changed or removed by this review.

**Method.** All 56 text files were scanned line by line for: `postgres(ql)://`,
`redis(s)://`, `Bearer <token>`, `sk-…`, `sk_/pk_/rk_(live|test)_`, `whsec_`,
JWTs (`eyJ….…`), AWS `AKIA…`, GitHub / Slack / Google key prefixes, PEM private
keys, Resend `re_…`, `vos_` API keys, `password|secret|token|api_key = <value>`,
64-hex strings, e-mail addresses, US phone numbers, Supabase project hosts,
Railway hosts, private IPs, MAC addresses, serial / IMEI / android_id
assignments, UUIDs and cuid-style ids, and organisation names taken from the
repository itself (the support-access report's own tenant table) and from the
owner's tenant notes. Images: 3 of 179 were opened (a seeded-demo people page, a
display-control comparison, an activity list); **the other 176 were not
reviewed** — that is an open item, not a pass.

**Live secrets: none found.**

| File | Where | What | Severity |
|---|---|---|---|
| `docs/research/2026-10-11-support-access/01-agent-report.md` | tenant table and "NOT marked" paragraph (§3) and decisions (§4) | Real customer organisation slugs and names (school districts and their schools, a multi-location franchise, a church, other orgs), which orgs are internal vs. paying, and the owner's personal work e-mail; also an inventory of routes deliberately left outside the support-access gate | **High** — customer list + personal e-mail in a public repo; removed from the tree 2026-11-09 (this review), still in git history until the owner decides on a purge |
| `docs/research/2026-10-13-android-field/02-astra-white-screen.md` | "Fresh evidence received from lead" section | Two screen UUIDs with hardware model and firmware, tied to a named organisation (the owner's bench/home org, which carries a real company's name) | Low — a screen id is an identifier, not a credential |
| `docs/research/2026-10-13-android-field/` (01, 02, 04, 05, 12) and `docs/research/2026-10-23-guq-enhancements/01-report.md` | title / scope lines | The same organisation name in deployment context | Low |
| `docs/research/2026-10-22-billing-golive/01-report.md` | production API host mentions | The production Railway API hostname | Low — the web client already exposes it |
| `docs/research/2026-10-23-codeql-prelaunch/01-report.md` | "Hand-off to the player engineer", "Static boards" | Detail of open CodeQL alerts, including one rated "real but low" in the player at the time | Low — check it is fixed; public vulnerability detail |
| `docs/research/2026-10-22-billing-golive/01-report.md` | test-mode setup paragraph | A truncated `sk_test_` placeholder explicitly labelled fake | None |
| `docs/research/2026-10-11-greg-decisions/02-legal-api-docs.md`, `2026-10-11-billing-simple/01-agent-report.md`, `2026-10-24-settings-simplification/phase1-screens/walk-results.json` | various | Role addresses on the product domain, the e-mail provider's shared onboarding sender, a seeded demo admin address | None |
| `docs/research/2026-10-13-android-field/07-goodview-fit-research.md` | header | SHA-256 digests of a third-party vendor APK | None |
