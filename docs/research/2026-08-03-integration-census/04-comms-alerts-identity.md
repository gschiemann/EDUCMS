# §9 COMMS + §13 PUBLIC ALERTS + §10 IDENTITY — re-verification at HEAD `b9122ea0`

> Census agent report, persisted verbatim 2026-08-03 evening. Read-only; no sends, no servers, no writes.

Baseline: `07-comms-public-alerts.md` (tip `a74c7894`), `02-auth-forensics.md` (tip `cec023ec`).

## 1. Provider table

| Channel | Verdict | Evidence (file:line) |
|---|---|---|
| **Resend email** (transactional) | **REAL** | Live POST `email.service.ts:468`; durable row `:106-120`; honesty gate via shared module `:12` |
| **Resend — storage-watchdog alerts** | **REAL** (was PARTIAL) | `storage-watchdog.service.ts:33` imports gate; `:170` POST; `:184-192` writes `resendAcceptedStatus()` not `'SENT'` |
| **Resend — efficiency/egress alerts** | **REAL** (was PARTIAL) | `efficiency-alerting.service.ts:6`, `:170`, `:186-196` |
| **Resend — `auto-close-bug` script (4th sender)** | **PARTIAL — bypasses the gate** | `apps/api/scripts/auto-close-bug.ts:151` hardcodes its own FROM default (*different* from `sender-identity.ts:34`); `:175` POST; writes **no `email_logs` row at all** |
| **Twilio SMS / voice** | **COMING_SOON, honest** | `integrations-health.controller.ts:725-734`; zero transport |
| **SendGrid** | **NEVER CHOSEN** | Single stale doc-comment `email.service.ts:19`; 0 dependency hits |
| **APNs / FCM push** | **COMING_SOON, honest** | `integrations-health.controller.ts:746-754`; `pushManager`/`vapid`/`firebase` = 0 code hits; 0 SDK deps |
| **Slack outbound (native)** | **COMING_SOON** / reachable only via generic webhook | `integrations-health.controller.ts:736-745`; `hooks.slack.com` = 0 |
| **Microsoft Teams outbound** | **COMING_SOON** — shares the Slack row | `webhook.office.com` = 0 |
| **PagerDuty / OpsGenie** | **COSTUME-ADJACENT (UI placeholder only)** | `settings/developer/page.tsx:846`; `events.pagerduty.com` = 0, `opsgenie` = 0 |
| **Generic outbound webhooks** | **REAL** | trio verified below |
| **Emergency → any human** | **NOT BUILT** | `apps/api/src/emergency/` imports neither `NotificationsService` nor `EmailService` (0 hits) |
| §13 **CAP / IPAWS in+out** | **NOT BUILT, honestly disclaimed** | EULA `terms/eula/page.tsx:113` + truth-gate fixture `capability-registry.spec.ts:63-67` |
| §13 **Raptor / RapidSOS** | **NOT BUILT** | 0 code hits both |
| §13 **Valcom / Atlas IED / InformaCast / SingleWire** | **NOT BUILT** | 0 hits (the 66 "atlas" hits are the `MS_ATLAS` subway-map template — unrelated) |

**Absence method (two, independent):** quoted-glob greps over apps/+packages/, AND package.json dependency sweep (`twilio|sendgrid|firebase-admin|node-apn|@slack|botbuilder|pagerduty` → zero), AND route sweep (`cap|ipaws|alert|raptor|rapidsos|speaker` → only the authed internal `POST media-alert`). §13 is refused by *absence of a boundary*, not a rejecting handler — correct, and stronger.

**Webhook trio intact at HEAD** (`git diff --stat a74c7894..HEAD -- apps/api/src/webhooks apps/api/src/branding/safe-fetch.ts` = empty):
- Signing: HMAC-SHA256 over `${timestamp}.${body}` → `X-VenueOS-Signature` — `webhook-dispatch.service.ts:196-198,222`.
- SSRF: every attempt (first AND retries) via `safeFetchPost` with connect-time DNS pin `:213-224`; anti-exfil generic errors `:226-243`.
- Retry worker: `FOR UPDATE SKIP LOCKED` + `attempts++` in claim + lease heartbeat — `webhook-retry.worker.ts:137-169`, reclaim floor `:115-116`.

**`format` switch (audit F7 recommendation): DOES NOT EXIST** (2 methods; `TenantWebhook` has no `format` column, `schema.prisma:284-304`). `ALLOWED_EVENTS` still exactly `emergency.triggered`/`emergency.cleared` (`webhooks.service.ts:30-33`).

## 2. Delta since the audit

- **`ff7705b4` — CLOSES F1.** Gate extracted to `email/sender-identity.ts`; all three services import it; regression spec (158 lines) drives the real private send paths. No service-layer sender bypasses the gate. Remaining bypass = the operator script (P2 below).
- **`118a3b34` — CLOSES ACC-09, all three legs** (`assertExistingUserIsReusable` fail-closed on ACTIVE/soft-deleted/tenant-mismatch/rank; `tenantId` removed from the update patch entirely; `acceptInvite` asserts tenant+email+status with one opaque error — covers pre-fix invites too). Full coverage confirmed.
- **`c24bf55e` — CLOSES ACC-10** (role change + delete + new disable endpoint that burns live sessions; `loadManageableTarget` gate; 405-line lifecycle spec).
- **`185bb50f` — rank-gates `can-trigger-panic`** — the last ungated user endpoint (was a life-safety denial vector).
- **`aa87b767` — `jwt_revoked_list` TTL** extend-only; fail-closed 503 semantics preserved.
- **No §9/§13 regressions from tonight's 24 commits**; district fan-out (`e7bbb7cf`) still dispatches both webhook events and still notifies **no human**.

## 3. Ranked open findings

**[P1] `PLATFORM_ALERT_EMAILS` ABSENT in prod → both platform-alert services fall back to mailing every `SUPER_ADMIN` row** (`efficiency-alerting.service.ts:122-138`, `storage-watchdog.service.ts:133-148`) — the exact behavior the 2026-07-16 fix was written to stop. **Fix is config, not code: set the env var.**

**[P1] Still no retry/replay for failed email** — transient Resend 5xx permanently loses a password-reset/invite (`email.service.ts:141-147` marks FAILED and stops; `emailLog.` = 9 hits, all writes, zero reads; no worker). Asymmetric with webhooks.

**[P1] `EmailLog` has no `tenantId` and no operator-visible surface** (`schema.prisma:665-679`; zero web hits). Sharpened by ff7705b4: `SENT_UNVERIFIED` rows are now written correctly and **no operator can ever see one**.

**[P2] 4th sender (`auto-close-bug.ts`) bypasses gate + durable log, divergent FROM default** (`:151` vs `sender-identity.ts:34`). ~4-line fix.

**[P2] Slack/Teams/PagerDuty escalation still unreachable — `format` switch not built.** Cheapest path from "alerts screens only" to "alerts humans"; transport already signed/SSRF-pinned/retried.

**[P2] `EMERGENCY_TRIGGERED` notification kind still has zero emitters** (`notifications.service.ts:6-8`; bell ships a red ShieldAlert that can never render, `NotificationsBell.tsx:17`). **Worse at HEAD:** district fan-out means one trigger locks down every school with no in-app record for any admin who didn't fire it.

**[P2] Settings still advertises shipped webhooks as unbuilt** (`settings/page.tsx:396,409`) — reverse-costume, ~4 weeks unfixed.

**[P2] Webhook signing secrets stored plaintext-recoverable** (`schema.prisma:290`) while BYOK keys next door are envelope-encrypted.

**[P3]** Clever sync: tenant-scoped predicates correct (no cross-tenant write); `toAdd` bare create on globally-unique email → P2002 aborts whole sync with no SYNC_FAILED notification. **[P3]** `POST /users` duplicate email surfaces as raw Prisma violation.

## 4. Grades at HEAD

| Subdomain | D | UX | F | Was |
|---|---|---|---|---|
| §9 Resend email | **B+** | **B−** | **B** | B− / B / B |
| §9 Outbound webhooks | B | A− | A− | B / B+ / A− |
| §9 Non-email human channels | — | **A−** | — | A / B+ / C+ |
| §13 Public alerts | — | **A** | — | A |
| §10 Identity + integrations | **A−** | **A−** | **A** | A− overall |

Identity F now **A**: ACC-09, ACC-10, panic rank-gate, JWT-TTL — all closed in one night, each with tests, each defense-in-depth. Email UX *fell* to B−: the honesty gate emits a status no operator can read.

**Identity per-integration:** SSO OIDC **REAL** (JIT clamped to tenant ceiling `sso.service.ts:648-670`; tenant-mismatch rejected `:679-683`). SAML **DEFERRED, honest fail-closed** (dep absent; throws when not enabled; arming SUPER_ADMIN-only). Google/Okta/Microsoft **REAL via generic OIDC**. Clever SIS **REAL** (7-file module, encrypted tokens, cron).

## 5. UNVERIFIED

- Whether `EMAIL_FROM`'s custom domain is DNS-verified in the Resend dashboard — the gate proves "not the shared sender", not "verified"; an unverified custom domain records confident `SENT` while Resend rejects at send time.
- No sends fired; no runtime confirmation of any verdict. `.env` not read.
- ACC-11 (TOTP ±1-step) and ACC-12 (sibling reset tokens) carried forward from `02-auth-forensics.md:46-47`, not re-read at HEAD.
- Bug-lifecycle email content checked for wiring only.
- Device-token internals accepted by reference to the player-security audit.
