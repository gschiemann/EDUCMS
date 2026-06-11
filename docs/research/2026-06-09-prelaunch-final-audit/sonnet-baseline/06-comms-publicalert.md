# VenueOS Pre-Launch Final Audit — Section 9 + 13: Communications & Public Alert Integrations

**Date:** 2026-06-10  
**Auditor:** Sonnet 4.6 (parallel agent)  
**Sections:** 9 (Communications integrations) + 13 (Public alert integrations)  
**Evidence method:** Source code traces to real callers, live health endpoint verification, no assumptions from intentions

---

## Coverage Table

| Domain | Coverage | Design | UX | Functionality |
|--------|----------|--------|----|---------------|
| Email (Resend) — all send paths | covered | B | B | B |
| isConfigured gating + "not configured" UX | covered | A | A | A |
| EMAIL_FROM spam trap | covered | N/A | C | C |
| Twilio SMS/voice | covered | N/A | A | N/A (COMING_SOON — honest) |
| Slack/Teams outbound webhook | covered | N/A | A | N/A (COMING_SOON — honest) |
| PagerDuty / OpsGenie | covered | N/A | N/A | N/A (not mentioned in code) |
| Outbound webhook retry queue | covered | A | A | A |
| Push notifications (APNs/FCM) | covered | N/A | A | N/A (COMING_SOON — honest) |
| CAP inbound | covered | N/A | N/A | N/A (not built, not promised) |
| IPAWS inbound/outbound | covered | N/A | N/A | N/A (not built, not promised) |
| Raptor SOS | covered | N/A | N/A | N/A (not built, not promised) |
| RapidSOS | covered | N/A | N/A | N/A (not built, not promised) |
| PA / IP-speaker | covered | N/A | N/A | N/A (not built, not promised) |

---

## Section 9: Communications Integrations

### 9.1 Email (Resend) — All Send Paths

**File:** `apps/api/src/email/email.service.ts`

The EmailService implements 8 outbound message types:

1. `sendWelcome` — new tenant signup
2. `sendPasswordReset` — forgot password flow
3. `sendUserInvite` — admin adds team member
4. `sendAssetPendingReview` — contributor uploads asset (ASSET_PENDING_REVIEW)
5. `sendAssetDecision` — approved/rejected notification to uploader
6. `sendBugFiled` — confirmation to reporter
7. `sendBugFiledOwnerAlert` — inbound bug notification to SUPER_ADMIN owners
8. `sendBugFixProposed` / `sendBugFixShipped` — lifecycle notifications

All paths share one `#enqueue()` → `#dispatch()` chain. `#dispatch()` is the real Resend caller — it POSTs to `https://api.resend.com/emails` with `Authorization: Bearer $RESEND_API_KEY`.

**isConfigured gating:** `isConfigured()` returns `!!process.env.RESEND_API_KEY`. This is used correctly in:
- Password-reset request: `onboarding.service.ts:202` — returns `{ ok: true, emailConfigured: false }` when unset; frontend (`reset-password/request/page.tsx:32`) reads the flag and shows "Email is not configured on this deployment — contact your administrator" instead of the false "check your inbox" message. **This flow is correct.**
- Invite flow: `onboarding.service.ts:415` returns `emailDelivered: !!process.env.EMAIL_PROVIDER` and `acceptUrl` so admins can copy-paste the link when email is unconfigured. **Frontend correctly shows a copy-link fallback panel** (`settings/page.tsx:106`).
- Integration health dashboard: `integrations-health.controller.ts:689–699` surfaces `NOT_CONFIGURED` vs `READY` status for email. **Correct.**

**EMAIL_FROM spam trap (CLAUDE.md documented):**  
Both `email.service.ts:412` and `efficiency-alerting.service.ts:146` default to `'VenueOS <onboarding@resend.dev>'`. CLAUDE.md documents this trap clearly (Resend only delivers from `onboarding@resend.dev` to the account owner's inbox; every other recipient is silently dropped or spam-filtered). The `.env.example` and CLAUDE.md both warn about this. **The risk is documented, the fix is known, but it requires an operator action (verify custom domain in Resend) — this is operational, not a code gap.**

**Efficiency alerting email** (`efficiency-alerting.service.ts`): This service has its **own** inline Resend call (not routed through `EmailService`) but applies the same `RESEND_API_KEY` check and falls back to logging when unset. Consistent behavior, minor duplication — not a bug, but a slight maintenance risk if the email provider changes.

### 9.1.1 FINDING: sendWelcome and sendUserInvite block the calling request on RESEND failure in production

**Severity: P1**

In production (`NODE_ENV=production`), `#dispatch()` throws when `RESEND_API_KEY` is unset:

```
// apps/api/src/email/email.service.ts:397-404
const isProd = process.env.NODE_ENV === 'production';
if (isProd) {
  throw new Error('Outbound email is not configured...');
}
```

`#enqueue()` propagates this throw. The callers in question:

- `onboarding.service.ts:180` — `await this.emailService.sendWelcome(...)` — **no try/catch**. If email is unconfigured in prod, a new-tenant signup throws a 500 to the user who just created their account. The account IS created (the DB transaction committed at line 178), but the caller gets an error response. The user can still log in, but the signup UX surface is broken.

- `onboarding.service.ts:389` — `await this.emailService.sendUserInvite(...)` — **no try/catch**. Same class of bug. Invite is created in DB, but the admin receives a 500 instead of the `{ acceptUrl, emailDelivered }` response. The invited user's account exists but the admin sees a broken invite flow.

**The password-reset path is correctly handled** — it only calls `sendPasswordReset` after checking `isConfigured()`, and the password-reset UX degrades gracefully.

**Bug reporter paths** (`bugs.controller.ts:409,460`) are correctly wrapped in `.catch()` — best-effort, never block.

**Asset review paths** (`assets.controller.ts:398-404`) are correctly wrapped in try/catch per-admin.

**Fix:** Wrap `sendWelcome` and `sendUserInvite` calls in `onboarding.service.ts` with try/catch. A failed welcome email should be logged as WARN but not block signup. A failed invite email should fall through to the `acceptUrl` copy-link path already implemented downstream.

### 9.2 Offline-Screen Notifications

The `OfflineScreenScanner` (`notifications/offline-screen-scanner.ts`) runs on a 60-second interval via `setInterval`, is overlap-guarded, and calls `NotificationsService.scanOfflineScreens()`. Cohort-outage detection (50%+ fleet drops in 90s window) suppresses per-screen spam and fires one `INFRA_EVENT` notification instead. HQ roll-up alerts parent tenants when a child screen goes offline.

**This is in-app notification only — no email is sent for offline screens.** There is no `sendOfflineAlert()` method in `EmailService`. Districts expecting email alerts when screens go offline will receive only the in-app bell notification. This is acceptable scope for V1 but worth documenting as a gap for V2 (covered by the outbound webhook path which can carry `screen.offline` events in a future extension).

**Webhook retry queue** (`webhooks/webhook-retry.worker.ts`): Implemented as a process-internal 5-second interval. Uses `FOR UPDATE SKIP LOCKED` for multi-replica safety, full exponential backoff, and permanent failure after exhaustion. Currently emits only `emergency.triggered` and `emergency.cleared` events. The retry worker is wired into `webhooks.module.ts` and starts on `OnModuleInit`. **This is solid.**

### 9.3 Twilio SMS/Voice — COMING_SOON (AUDIT-P0-2 VERIFIED FIXED)

`integrations-health.controller.ts:700–710` reports status `COMING_SOON` with message:
> "Coming in V2 — SMS + voice fan-out on an emergency trigger. No send code exists yet, so setting TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN does NOT enable SMS."

**Verified:** `grep -rn "twilio" apps/api/src` returns zero actual implementation files (only the health controller description). **AUDIT-P0-2 is confirmed fixed** — no Twilio code exists anywhere, and the health dashboard is honest about this.

There is **no UI** anywhere in `apps/web/src` that presents a Twilio connect form or suggests SMS capability is live. The only frontend reference to "Twilio" is the health dashboard's `COMING_SOON` row which is hidden from operators by default (requires `?admin=1` to see).

### 9.4 Slack/Teams Outbound Webhook — COMING_SOON (AUDIT-P0-2 VERIFIED FIXED)

`integrations-health.controller.ts:712–720` reports status `COMING_SOON` with message:
> "Coming in V2 — outbound emergency / status notifications to ops channels. No send code exists yet, so setting SLACK_WEBHOOK_URL does NOT enable notifications."

**Verified:** No Slack dispatch code exists in `apps/api/src`. The developer webhook page (`settings/developer/page.tsx`) shows a placeholder field labeled "e.g. PagerDuty bridge" but this is the tenant's own outbound webhook configuration (which IS implemented) — it is not a Slack/Teams connector.

### 9.5 Push Notifications (APNs/FCM) — COMING_SOON

`integrations-health.controller.ts:724–730` correctly reports `COMING_SOON`. No FCM/APNs SDK is in `package.json`, no device token registration endpoint exists, no push dispatch code exists. **Honest and accurate.**

### 9.6 PagerDuty / OpsGenie

Not mentioned in the codebase at all (the "PagerDuty bridge" label in the developer webhook form is just a suggested use case for the generic outbound webhook). No health row, no integration listing. Correct omission — these are V2 roadmap items.

### 9.7 SendGrid

`email.service.ts:9` mentions it as a future swap-in target in a comment. No SendGrid SDK installed, no code paths. The comment is honest about the stub nature of the old email service.

---

## Section 13: Public Alert Integrations

### 13.1 Overall Status: All N/A — Not Built, Correctly Disclosed

None of the V2 public-alert integrations (CAP, IPAWS, Raptor, RapidSOS, PA/IP-speaker) are implemented. This is the correct and expected state for V1.

**Critical check performed:** Does any customer-facing surface (landing page, settings UI, onboarding flow, marketing copy) promise these capabilities?

- **Landing page (`apps/web/src/app/page.tsx`):** Claims "emergency alerts in a tap" and describes "lockdown, evacuation, weather alerts" — all real, shipped features. No mention of CAP/IPAWS/Raptor/RapidSOS/PA systems.
- **EULA (`apps/web/src/app/terms/eula/page.tsx:113`):** Explicitly disclaims: "IPAWS, CAP, Wireless Emergency Alerts (WEA), Emergency Alert System (EAS), or any government-authorized public alerting channel" — VenueOS screens are NOT a substitute for these. This disclaimer is strong and appropriate.
- **Settings pages:** No Raptor connect button, no RapidSOS integration form, no CAP feed configuration UI.
- **Integration health dashboard:** No CAP/IPAWS/Raptor rows at all (not even COMING_SOON).
- **CLAUDE.md / AGENTS.md:** These reference the V2 plans but are internal documents, not customer-facing.
- **CUSTOMER_PILOT_GUIDE.md:** Lists "Phone / SMS: [TODO: contact info]" as a support channel — this is a placeholder for VenueOS support contact, not a product feature promise.

**Conclusion: Section 13 is cleanly N/A. No false promises anywhere customer-visible.**

### 13.2 Life-Safety Positioning Risk (P2 — Advisory)

The landing page markets VenueOS as "Built for safety" with "hold-to-trigger panic button" and "private signed alert channel." This is accurate for what the system does. However, K-12 districts frequently procure Raptor, RapidSOS, or InformaCast separately, and a district buyer may ask "does this replace/integrate with our existing safety systems?"

The EULA disclaimer handles the legal/liability side. The missing piece is a public FAQ or marketing page answer to "does VenueOS integrate with Raptor/RapidSOS/PA systems?" — currently there is no such content. When a district IT director asks, the salesperson needs a clear answer. This is a sales-enablement gap, not a code gap.

---

## Summary of Findings

### P1 — Fix before GA

**F1: sendWelcome and sendUserInvite block with 500 when RESEND_API_KEY unset in prod**  
File: `apps/api/src/onboarding/onboarding.service.ts:180,389`  
The DB write succeeds but the caller gets a 500. Signup and invite flows are broken on a prod deploy without email configured.  
Fix: Wrap both calls in try/catch; log WARN; return success anyway (the invite path already has the copy-link fallback).

### P2 — Sprint backlog

**F2: No email for offline-screen alerts**  
Currently only in-app notification. No email dispatch for `SCREEN_OFFLINE` / `INFRA_EVENT`. For districts with weak connectivity (exactly the scenario where screens go offline), the in-app bell is useless if no one is watching the dashboard. Add email digest option (daily summary or immediate per-screen) as a V1.1 item.

**F3: Efficiency alerting email path is duplicated inline, not using EmailService**  
File: `apps/api/src/efficiency/efficiency-alerting.service.ts:146`  
Has its own inline Resend fetch call. If the email provider changes, two files need updating. Refactor to route through `EmailService.#dispatch()` or a shared helper.

**F4: EMAIL_FROM default is a silent deliverability trap (operational, not code)**  
Default `onboarding@resend.dev` sender delivers only to the Resend account owner. All other recipients are silently dropped or spam-filtered. CLAUDE.md documents this but there is no runtime warning in API logs or the integration health dashboard. Add a boot-time WARN log when `RESEND_API_KEY` is set but `EMAIL_FROM` is still the default `onboarding@resend.dev` value. This prevents a "we set the key but no one gets emails" support spiral.

### Verified Solid (already fixed)

- **AUDIT-P0-2 CONFIRMED FIXED:** Twilio and Slack correctly report `COMING_SOON` with explicit "no send code exists" messaging. Setting the env vars does not silently imply these features work.
- **Password-reset emailConfigured UX:** Correctly degrades to "contact your admin" instead of "check your inbox" when email is unconfigured.
- **Invite copy-link fallback:** Correctly exposes `acceptUrl` for manual share when email is unconfigured.
- **Outbound webhook retry queue:** Solid implementation with `FOR UPDATE SKIP LOCKED`, exponential backoff, multi-replica safety.
- **Push/Twilio/Slack/PA/CAP/IPAWS/Raptor/RapidSOS:** All N/A, all honest, no false promises to customers anywhere.
- **Bug reporter emails:** All correctly wrapped as best-effort, never block the bug pipeline.
- **Asset review emails:** Per-admin try/catch so one bad address doesn't kill the entire batch.
- **EULA disclaimer:** Strong, explicit disclaimer covering IPAWS/CAP/WEA/EAS and certified life-safety systems.
