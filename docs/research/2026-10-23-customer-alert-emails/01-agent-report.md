# Customer alert emails — agent report (2026-10-23)

PR: https://github.com/gschiemann/EDUCMS/pull/146 — branch `feat/customer-alert-emails`, head `2feb074c`, CI 43/43 green at report time. Saved verbatim-in-substance by the lead per CLAUDE.md agent rule 8.

## Owner constraint
"Our alerting is not throwing false positives all over — blasting customers with issues that aren't real would ruin us." So: ships in SHADOW mode.

## Modes
- Default = shadow: no customer email until `CUSTOMER_ALERT_EMAILS_MODE=on`. In shadow the would-be email goes only to `PLATFORM_ALERT_EMAILS`, subject `[shadow] would have sent to N admins at <org>: <subject>`.
- `CUSTOMER_ALERT_EMAILS_DISABLED=1` turns everything off, emergency record copies included.

## Who / language
- `DISTRICT_ADMIN` / `SCHOOL_ADMIN` at the screen's location or any ancestor org; active accounts with a real, proven mailbox and the switch on. Placeholder, unverified, deleted and `.invalid` accounts excluded.
- en/es/zh: the person's choice → the org's signup language → English.

## Triggers
- Offline ≥ 15 min: the existing offline scanner passes the rows it already read (no second detector). Two consecutive scans required. One email per location per scan (a site-wide drop = one email listing screens). "Back online" only for screens we emailed about, after recovery held 5 min.
- Online but not showing content ≥ 20 min: same render-trust grade as the dashboard chip; only red "not painting" and "Content unavailable" count. Also requires two scans, a player that posts render proof, content assigned, no web-page content, no fresh video/native playback proof. "Showing content again" after 5 min of good proof.
- Emergency trigger / all-clear: a record copy queued AFTER the action's audit rows and dispatch. `recordEmergency` is synchronous, returns void, starts work on a later event-loop turn and swallows every error. Tests: trigger and all-clear still complete when the mailer throws, rejects or never answers.

## Rails
- Runs inside the offline scanner's leader-leased tick. Incident state in Postgres (restart neither re-sends nor forgets).
- ≤ 6 emails per org per rolling hour, then one digest. ≤ 1 problem email per screen per 6 h (flap protection).
- "Manage alert emails" link → `/<slug>/account#alert-emails`. Only counts recorded (`customer_alert_sends`): no addresses, no bodies.
- Platform rails: nothing for 15 min after an API restart, or while the storage/platform watchdog reports degraded.
- Platform incident: problems starting within ±5 min at ≥ 3 orgs, or ≥ 2 orgs and ≥ 30 % of recently-active screens → those screens never emailed, customer email pauses 30 min, the owner gets one alert. Intended downtime is checked BEFORE this cluster rule (fix `28e360ca`: an on/off schedule switching several orgs off at the same minute would otherwise read as a nightly platform incident).
- Intended downtime (never alerted): remote power-off/blank, Android-reported standby, inside an on/off schedule's OFF window or within 30 min after it, the tenant's update window, a reboot or player update in the last 30 min, unused > 24 h, paired < 2 h before the problem, unpaired or revoked.

## Settings
Account → Notifications → "Alert emails" switch + language (admins only), `GET/PUT /api/v1/notifications/alert-emails`, en/es/zh. CLAUDE.md env row + stamp added.

## Migration
`packages/database/prisma/migrations/20261023120000_customer_alert_emails/migration.sql` — additive, idempotent: `users.alert_emails_enabled` (default true), `users.alert_email_locale`; tables `screen_alert_incidents`, `customer_alert_sends` (no FKs). Proven on scratch Postgres 16: full-history `migrate deploy`, then two more `psql -v ON_ERROR_STOP=1` applies, both exit 0. `check-schema-has-migration.cjs` passes.

## Tests
Full API Jest before master merge: 573 suites, 11,001 passed, 30 skipped. After the master merge + last fixes, notifications + emergency suites: 97 passed. New: policy 28, service 25, copy 7, web-grade/window parity 4, endpoints + scanner 6, emergency fire-and-forget 5. Web `AlertEmailSettings.test.tsx` 5/5. API + web tsc clean; mobile-perf guard passes. Tenant Isolation fix: incident updates carry `tenantId`; the two own-user-row routes marked `ten-ok`.

## Sample (en, offline site-wide)
```
Subject: VenueOS: 3 screens offline at Lincoln Elementary

These screens at Lincoln Elementary have stopped checking in:
  • Lobby TV — offline for 17 minutes
  • Gym Board — offline for 16 minutes
  • Front Office — offline for 15 minutes

They all dropped at about the same time, which usually means the internet or power at the site is down.
We will email you again when they are back online.
```
Other samples: back online, not showing content ("Restarting the screen from the Screens page usually fixes this."), emergency record copy ("This is a record copy for your files."), all clear.

## Not done / not verified (agent)
- Nothing checked against production data — shadow mode is how the owner judges accuracy before `on`.
- Settings card unit-tested only, not seen in a browser.
- Detection uses the screen's own telemetry; a screen posting fresh render proof while showing the wrong content is not caught.

## Key files
`apps/api/src/notifications/customer-alerts/` (policy, copy, service, render-trust-grade, schedule-windows + specs), `apps/api/src/health/platform-degradation.ts`, `notifications.service.ts` / `offline-screen-scanner.ts` / `notifications.controller.ts` / `notifications.module.ts`, `apps/api/src/emergency/emergency.controller.ts` + `emergency.alert-emails.spec.ts`, `apps/api/src/email/email.service.ts` (`sendCustomerAlert`), `apps/web/src/components/notifications/AlertEmailSettings.tsx`, `apps/web/src/app/[schoolId]/account/page.tsx`, `apps/web/src/hooks/use-api.ts`, i18n en/es/zh, `schema.prisma`, `CLAUDE.md`.
