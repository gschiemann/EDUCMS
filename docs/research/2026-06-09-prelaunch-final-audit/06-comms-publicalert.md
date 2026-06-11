# Pre-launch Final Audit — Sections 9 + 13: Communications + Public Alert Integrations

**Auditor:** frontier-model fresh pass (2026-06-10)
**Scope:** Standard Audit Surface §9 (Twilio SMS/voice, Sendgrid/Resend email, APNs/FCM push, Slack, Teams, PagerDuty/OpsGenie, outbound webhooks) + §13 (CAP, IPAWS in/out, Raptor, RapidSOS, PA/IP-speaker).
**Method:** traced every documented safeguard to its real callers; verified against the LIVE deploy (read-only Postgres, Railway env listing, live curl). No live mutations, no emergency triggers.
**Dedup:** verified against `docs/research/2026-06-08-launch-readiness-audit/00-MASTER-SYNTHESIS.md` (§9 graded A/A/A there) and `docs/research/2026-06-09-full-audit/REPORT.md`. Items already known are marked KNOWN-OPEN or listed as verified-solid. Did NOT read the sonnet-baseline folder (blinding honored — one grep for `EMAIL_PROVIDER` matched a filename in that folder; the file was never opened).

---

## Coverage table

| Surface bullet | Coverage | Design | UX | Functionality |
|---|---|---|---|---|
| §9 Email (Resend — all 9 send paths) | **covered** | A− | A− | **A−** (live-verified sending) |
| §9 Twilio SMS / voice | **N-A (honest)** | — | A (honest pill) | N-A |
| §9 Slack / Teams outbound | **N-A (honest)** | — | A | N-A |
| §9 PagerDuty / OpsGenie | **N-A (honest)** | — | — | N-A (generic webhook can bridge) |
| §9 APNs / FCM push | **N-A (honest)** | — | A | N-A |
| §9 Outbound webhooks (custom) | **covered** | A | B+ | **B+** (crash-window stranding) |
| §13 CAP inbound | **N-A (honest)** | — | — | N-A |
| §13 IPAWS inbound / outbound | **N-A (honest + EULA-disclaimed)** | — | — | N-A |
| §13 Raptor SOS | **N-A (honest)** | — | — | N-A |
| §13 RapidSOS | **N-A (honest)** | — | — | N-A |
| §13 PA / IP-speaker (Valcom / InformaCast) | **N-A (honest + EULA-disclaimed)** | — | — | N-A |

**Section 9 overall: D=A− / UX=A− / F=B+.** Email is genuinely production-grade and live-verified; the grade is held below A by the invite-flow "email isn't configured" lie on the live deploy (F-1), the webhook crash-window that contradicts its own doc comment (F-2), and the missing Resend fetch timeout (F-3).

**Section 13 overall: N-A across all three lenses — and that is the CORRECT answer.** Nothing is built, nothing is faked, and the EULA §4 (apps/web/src/app/terms/eula/page.tsx:104-117) explicitly disclaims substitution for IPAWS/CAP/WEA/EAS, PA/intercom/siren systems, 911, and NFPA-72/UL-2572 certified mass-notification. That is exactly the right pre-launch posture for a signage CMS with emergency convenience features.

---

## What was traced (evidence map)

### Email — every send path traced to its real caller

`apps/api/src/email/email.service.ts` (443 lines) is the single dispatcher. All sends funnel through `#enqueue` → durable `email_logs` row (QUEUED → SENT / FAILED with error) → `#dispatch` (Resend REST). Verified callers:

| Send path | Caller | Error posture |
|---|---|---|
| Welcome | `onboarding.service.ts:180` (signup) | awaited; dispatch failure marked FAILED, doesn't block signup |
| Password reset | `onboarding.service.ts:221` + `isConfigured()` gate at :202 | anti-enumeration `{ok:true}` always; `emailConfigured` flag returned |
| User invite | `onboarding.service.ts:389` | always sends; ALSO returns copy-link fallback (see F-1) |
| Asset pending review (per-admin fan-out) | `assets.controller.ts:398` | per-admin try/catch — one bad inbox can't block others |
| Asset approve/reject decision | `assets.controller.ts:451` | swallowed, in-app Notification still posted |
| Bug filed (reporter) | `bugs.controller.ts:409` | `.catch()` logged — email outage never blocks bug pipeline |
| Bug filed (owner alert) | `bugs.controller.ts:460` | recipients resolved from live `SUPER_ADMIN` rows (not hardcoded); solo-owner edge handled |
| Bug fix proposed | `bugs.controller.ts:880` | swallowed |
| Bug fix shipped | `bugs.controller.ts:641` | swallowed |

**Prod fail-closed verified:** `#dispatch` throws in production when `RESEND_API_KEY` unset (email.service.ts:397-404) so the row goes FAILED instead of fake-SENT; dev logs a stub. `isConfigured()` (line 379) is real and called by the password-reset flow + `/api/v1/health/integrations` probe.

**UX when unset verified end-to-end:** `apps/web/src/app/reset-password/request/page.tsx:57-75` renders the amber "Email is not configured on this deployment… contact your administrator" panel keyed off the API's `emailConfigured:false` — no more "check your inbox" lie. A-grade handling.

### Live verification (the EMAIL_FROM trap is DEFUSED)

- **Railway env (read-only listing):** `RESEND_API_KEY` set; **`EMAIL_FROM = VenueOS <noreply@venue-os.app>`** (custom domain, NOT the `onboarding@resend.dev` trap); `APP_PUBLIC_URL=https://venue-os.app` so all email links resolve correctly. `EMAIL_REPLY_TO` unset (fine, optional). (Values redacted here — repo is public.)
- **Live DB `email_logs`:** 14 rows, **ALL status=SENT, zero FAILED/QUEUED**, spanning kinds WELCOME(6), BUG_FILED(3), BUG_FILED_OWNER(3), PASSWORD_RESET(1), INVITE(1). Recipient domains include **e-arc.com ×7 (the pilot customer), gmail.com, live.com, springfield.edu** — Resend rejects sends to non-account-owner recipients at API time when the sender domain is unverified, so 2xx acceptance of external-domain sends is strong evidence the venue-os.app sending domain IS verified in Resend. Latest sends 2026-06-09 (bug lifecycle), i.e., the pipeline worked yesterday.
- **2026-06-08 P1-3 ("verify Resend domain — NEEDS GREG")** → effectively closed by this evidence. Residual nicety: one real end-to-end inbox check for DMARC/spam placement, but the documented "silently dropped" failure mode is not in play.
- Live API on commit `cf5772ae` (current master), health green (`db:ok, redis:ok`).

### Twilio / Slack / Teams / PagerDuty / push — COMING_SOON honesty (AUDIT-P0-2 verification)

- `apps/api/src/health/integrations-health.controller.ts:679-731`: Twilio, Slack/Teams, and Push (APNs/FCM) rows are **pinned `COMING_SOON` regardless of env** with explicit copy: "setting TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN does NOT enable SMS… stays 'coming soon' until the dispatch path ships." Same for `SLACK_WEBHOOK_URL`.
- **No send code exists anywhere:** repo-wide grep for `twilio|pagerduty|opsgenie` finds only the health-probe copy + one harmless UI placeholder ("e.g. PagerDuty bridge" as a webhook *name* example, settings/developer/page.tsx:702 — fair, since the generic signed webhook genuinely can bridge to PagerDuty Events API via middleware). No FCM/APNs code in API, web, or player (only a Kotlin comment).
- **Operator UI is honest by default:** `settings/test-integrations/page.tsx` HIDES COMING_SOON rows unless `?admin=1`, renders a slate "Coming soon" pill, and suppresses the Test button for COMING_SOON rows (line 512). The probe endpoint itself is admin-gated (`/api/v1/health/integrations` → 401 anonymous, live-verified; `@RequireRoles(SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN)` at controller line 157).
- **Marketing surfaces:** signup page's only SMS mention is "We'll never SMS you marketing." No 911/SMS/parent-text promises anywhere in login/signup/landing. **AUDIT-P0-2 fix (task #211) verified REAL.**

### Outbound webhook retry queue (P1-5 / task #177 verification)

`apps/api/src/webhooks/webhook-dispatch.service.ts` + `webhook-retry.worker.ts` + `webhooks.service.ts`:

- HMAC-SHA256 signature over `${timestamp}.${body}` (Stripe/GitHub envelope), `X-VenueOS-*` headers, byte-identical replay via persisted `signedTimestamp` + `body`.
- **SSRF posture excellent:** every attempt (first send AND every retry) goes through `safeFetchPost` with DNS re-resolution + connect-pinning + 8s timeout; SsrfError messages and receiver response bodies are never reflected to the operator (anti-exfil, dispatch.service.ts:226-243).
- **Multi-replica safe:** worker claims with `FOR UPDATE SKIP LOCKED` atomic UPDATE (retry.worker.ts:104-119); overlap-guarded interval; backoff 5s/30s/120s, 4 total attempts; deactivated-webhook rows terminated cleanly.
- **Event catalog honest:** UI offers exactly `emergency.triggered` + `emergency.cleared` (developer page :559-561) and BOTH are genuinely emitted (`emergency.controller.ts:599` and `:773`). `screen.online/offline` is only a "later" comment, not a fake option.
- Live DB: `tenant_webhooks=0`, `webhook_deliveries=0` — feature unused by pilots so far; no stranded rows in the field.

### Offline-screen alerts (assignment bullet)

`notifications.service.ts` (352 lines) + `offline-screen-scanner.ts` (60s interval, overlap-guarded, env-tunable): per-screen SCREEN_OFFLINE rows, cohort INFRA_EVENT collapse (>50% fleet drop in 90s = one alert, per-screen suppressed), HQ parent-tenant roll-up, batched `createMany skipDuplicates` (N+1 fixed). **But these are in-app bell rows ONLY** (`NotificationsBell.tsx` is mounted) — see F-4.

### Section 13 sweep

Repo-wide grep for `ipaws|rapidsos|raptor|common alerting|singlewire|informacast|valcom|CAP`: **zero implementation code, zero UI affordances, zero settings rows.** The only product-surface mention is the EULA §4 critical disclaimer (eula/page.tsx:104-117) which expressly says VenueOS is NOT a substitute for IPAWS/CAP/WEA/EAS, PA/siren systems, or 911. The V2 roadmap items remain roadmap-only. Honest N-A; nothing to flag.

---

## Findings

### F-1 (P1) — Invite flow tells live customers "Email isn't configured yet" while email IS configured and working
- **Evidence:** `onboarding.service.ts` `createInvite` returns `emailDelivered: !!process.env.EMAIL_PROVIDER` (~line 415). `EMAIL_PROVIDER` is an **orphan variable**: not set on Railway (env listing verified), not in `.env.example`, referenced nowhere else in code — the real gate is `EmailService.isConfigured()` (RESEND_API_KEY). The web UI (`settings/page.tsx:106-111`) keys the amber "Invitation created… **Email isn't configured yet — copy this link**" banner off `emailDelivered === false`, which is **always false on the live deploy** — even though the invite email actually goes out (live `email_logs` INVITE row = SENT; Resend configured with custom domain).
- **Impact:** every admin who invites a user on venue-os.app is told the deployment is misconfigured. Looks broken/unpolished to pilot customers ($$$-product lens) and trains operators to distrust status messaging. (Failure direction is at least safe — link is shown, nothing is lost; the inverse misconfiguration — EMAIL_PROVIDER set without RESEND — would claim "sent" while sending nothing.)
- **Fix (one line + cleanup):** return `emailDelivered: this.emailService.isConfigured()` and delete the `EMAIL_PROVIDER` reference + stale comment ("Email dispatch is a stub in most deployments" — no longer true). Consider keeping the copy-link UI as a secondary affordance with honest copy ("Email sent — or copy the link").

### F-2 (P2) — Webhook delivery crash-window strands rows the retry worker can never claim (doc'd safeguard doesn't hold)
- **Evidence:** `webhook-dispatch.service.ts:150-166` creates the durable row as `{status:'PENDING', attempts:0}` with **`nextRetryAt` unset (NULL)** and the comment "a crash between the POST and the status write still leaves a row the worker can retry." But the worker's claim query (`webhook-retry.worker.ts:110-112`) requires `status='PENDING' AND next_retry_at IS NOT NULL` — a NULL-`nextRetryAt` PENDING row is **invisible to it forever**. Same window inside the worker itself: the claim sets `next_retry_at = NULL` during the attempt, so a crash mid-attempt strands the row identically.
- **Impact:** a Railway restart/deploy landing in the wrong ~8s window silently and permanently drops that delivery — including `emergency.triggered`, the exact loss scenario the retry queue (Audit P1-5) was built to kill. Currently zero field impact (0 webhooks configured live), but it's a loaded trap for the first customer who wires one.
- **Fix:** boot-time + periodic janitor: `UPDATE webhook_deliveries SET next_retry_at = NOW() WHERE status='PENDING' AND next_retry_at IS NULL AND updated_at < NOW() - interval '5 minutes'` (re-arms both stranded shapes; attempts count already persisted keeps backoff/exhaustion correct). Also correct the misleading comment.

### F-3 (P2) — Resend dispatch fetch has no timeout; a hung Resend stalls signup/password-reset/invite requests for minutes
- **Evidence:** `email.service.ts:426-433` `fetch('https://api.resend.com/emails', …)` with no `AbortSignal`. The sends are **awaited inline** in `signup` (:180), `requestPasswordReset` (:221), and `createInvite` (:389); a hung (not erroring) Resend holds those requests until undici's default header timeout (~5 min). Class sweep: the webhook path already uses `safeFetchPost(timeoutMs: 8000)`; Resend is the outlier outbound fetch.
- **Fix:** `signal: AbortSignal.timeout(10_000)` on the Resend fetch (the abort error then flows into the existing FAILED-row branch). Optionally stop awaiting the email inline on signup.

### F-4 (P2) — Offline-screen / infra-event alerts never leave the app (no email, no webhook event) — competitive + ops gap
- **Evidence:** SCREEN_OFFLINE / INFRA_EVENT / HQ roll-ups are in-app `Notification` rows only (`notifications.service.ts:263-341`); RESEND powers 9 paths but none of them is screen-offline; webhook event catalog is `emergency.*` only (`webhooks.service.ts:31-32`; `screen.online/offline` is a "later" comment at :18). `assets.controller.ts:349` acknowledges the email/Slack bridge as a follow-up sprint.
- **Impact:** an operator who isn't logged into the dashboard never learns a screen (or a whole location, INFRA_EVENT) went dark. Yodeck / OptiSigns / ScreenCloud all ship offline-player email alerts as table stakes; the "Alerting at scale" demo (tasks #232/#238) proved the in-app half only. Not a costume — the UI promises nothing it doesn't do — but it's the missing last mile of the fleet-reliability story.
- **Fix:** bridge SCREEN_OFFLINE/INFRA_EVENT rows to `EmailService` (digest-friendly: reuse the existing dedupeKey buckets) and/or add `screen.offline` to the webhook catalog + emitter. Per-tenant toggle to avoid noise.

### F-5 (P3) — Password-reset timing oracle for account existence
- **Evidence:** `requestPasswordReset` returns immediately for unknown emails (:209-211) but performs token insert + a synchronous Resend round-trip (:217-221) for known ones — a few hundred ms of measurable difference defeats the deliberate anti-enumeration `{ok:true}` design.
- **Fix:** respond first, dispatch token+email async (`setImmediate`), or equalize with a dummy delay.

### F-6 (P3) — Bug-reporter "we got it" email links every reporter to a SUPER_ADMIN-only page
- **Evidence:** `sendBugFiled` body includes "Review the full bundle here: `${appUrl}/super/bugs/<id>`" (email.service.ts:228-242) and is sent to the reporter, who is typically a SCHOOL_ADMIN/CONTRIBUTOR → clicking yields a 403/redirect. Confusing copy in an otherwise excellent lifecycle.
- **Fix:** only include the review URL in the owner-alert variant, or gate on reporter role.

### F-7 (P3) — `webhook_deliveries` has no retention/cleanup job
- **Evidence:** no `webhookDelivery.deleteMany` anywhere; DELIVERED/FAILED rows (with full bodies) accumulate forever. Zero rows today; trivial janitor (`createdAt < NOW() - 30 days AND status != 'PENDING'`) when the feature gets use.

### KNOWN-OPEN (verified still open, owned by earlier audits — not re-reported as new)
- **B-2: weak human-guessable `JWT_SECRET` / `SESSION_SECRET` still live on Railway** (observed directly in the env listing during the EMAIL_FROM check; values redacted). Still the top config P0 pending Greg.
- **B-3: Stripe still on `sk_test_…` live** (same env listing). Go-live key swap still pending.
- Incidental observation for the secrets-rotation pass: a `GH_TOKEN` (gho_…) also lives in the API service env — include it in the rotation/inventory sweep.

---

## Solid (verified working, fixed, or honestly absent)
1. **Live email pipeline end-to-end:** RESEND_API_KEY + custom-domain EMAIL_FROM on Railway; 14/14 email_logs SENT (0 FAILED) including external pilot-customer domains → 2026-06-08 P1-3 (Resend domain verification) effectively closed by evidence.
2. **Prod fail-closed email + honest reset-password UX:** unset key throws in prod → FAILED row → amber "Email is not configured on this deployment / contact your administrator" panel; dev stays zero-config.
3. **All 9 email send paths trace to real callers with correct error posture** (best-effort swallowing on bug/asset paths; owner alerts resolved from live SUPER_ADMIN rows, solo-owner edge handled).
4. **AUDIT-P0-2 (task #211) is real:** Twilio/Slack-Teams/push pinned COMING_SOON regardless of env, hidden from operators by default, no Test button, no send code anywhere, no marketing promises. Probe endpoint admin-gated (live 401).
5. **Outbound webhooks are a genuinely well-engineered surface:** signed envelope, SSRF re-resolve + pin on every attempt, anti-exfil error redaction, SKIP LOCKED multi-replica claims, byte-identical retries, honest event catalog wired to real emitters (emergency.controller.ts:599/773).
6. **Section 13 is honestly N-A** with an explicit EULA §4 disclaimer covering IPAWS/CAP/WEA/EAS/PA/911 — no sold-but-absent costume anywhere on the public-alert surface.
7. Cohort outage detection + HQ roll-up alerting (in-app) is real, deduped, batched, and scan-wired (HIGH-9 fix verified: scanner actually runs every 60s).

## Missing features (comparative scan, §9/§13 lens)
- Offline-screen **email** alerts + `screen.offline` webhook event (Yodeck/OptiSigns/ScreenCloud table stakes) — F-4.
- Per-user notification preferences / daily digest (every email is fire-per-event today).
- HTML transactional templates (plain-text only; functional but not $$$-polished; code comment acknowledges).
- Webhook delivery log UI + manual "redeliver" button (rows exist; operator sees only lastDelivery* health on the webhook row).
- §13 V2 differentiators (CAP inbound for NWS weather auto-alerts would be the highest-leverage first build; IPAWS origination needs an explicit FEMA-authorization decision) — correctly roadmap-only today.

## Scope notes
- Did not test actual inbox placement (DMARC/SPF rendering) of live mail — recommend the one-real-reset-email smoke to a non-account address as final sign-off.
- Did not exercise a live webhook delivery (none configured on prod; creating one = live mutation, out of bounds). Logic verified by code trace + existing spec files (`webhook-dispatch.service.spec.ts`, `webhook-dispatch.ssrf.spec.ts`).
