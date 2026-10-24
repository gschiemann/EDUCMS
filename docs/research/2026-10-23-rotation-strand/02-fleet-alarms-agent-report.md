# Owner fleet outage alarms — agent report (2026-10-23)

PR https://github.com/gschiemann/EDUCMS/pull/150 (branch `feat/owner-fleet-alarms`, head `5c88966e`, built on #149). All 43 checks green; no schema change. The lead reviewed the sign-in-path hooks: both are wrapped in try/catch and their Redis writes are fire-and-forget. Persisted by the lead per CLAUDE.md agent rule 8.

## Why `screen_alert_incidents` stayed empty
- Not the offline scanner: `scanOfflineScreens` passes every screen silent for more than 5 minutes on every tick, the cold-start tick included.
- The cause is a stale-history cut-off: `ALERT_RULES.OFFLINE_MAX_AGE_MS = 6 h`. `onOfflineScan` only considers screens silent for between 15 minutes and 6 hours, and the platform-incident cluster uses the same limit.
- The 14 screens went silent at 05:43Z. #146 went live at about 18:05Z, so on its first scan they were already about 12.5 hours silent and never became candidates. Shadow mode is not a factor: it writes rows exactly as `on` does.
- Had the alerts been live at 05:42Z, the owner alert would have fired at about +17 minutes, unless night on/off schedules excused enough screens or a second restart re-armed the quiet (fixed in item 3).

## 1. Post-restart fleet check (`notifications/fleet-alarms/`)
- **Cohort:** at boot + 30 s, record the paired, non-revoked screens whose player checked in during the 15 minutes before the boot.
- **Check:** at +10 and +20 minutes, the leader (`LEASE.POST_RESTART_FLEET_CHECK`) counts cohort screens that are:
  - missing: no check-in since boot + 5 minutes (allows for the old container serving during Railway's hand-over);
  - downgraded: fell to re-pair required on a 1-hour credential after the boot.
- **Trigger:** at least 3 screens not back (2 when 20 or fewer are expected back).
- **Exclusions:** screens meant to be off are excused through the customer alerts' `loadFacts` + `intendedDowntime` (on/off schedule, update window, remote power-off, standby, maintenance, newly installed). Version timestamps only label "the unit itself is up"; they never count as back, because the Manager bumps them every 30 minutes.
- **Frequency and safety:** one alert per boot, using a Redis claim on `RAILWAY_DEPLOYMENT_ID`. The check skips rather than guesses when the DB or signer is down, or when schedule facts are unreadable.
- **Against the incident:** it would have alerted at about 05:52Z.

## 2. Device-credential refusal alarm
- **Recording:** hooks on the WS HELLO refusal and the register 401 store the screen id only (never the token) in a Redis set of distinct screens per minute, with a 20-minute TTL and an in-process fallback.
- **Evaluation:** the leader checks every 60 s and alerts when at least 3 real paired screens, with no push channel in the last 3 minutes, have been refused every minute (one gap allowed) for 10 minutes.
- **Frequency:** at most one email an hour, plus a recovery note after 5 clear minutes; state is kept in Redis.
- **What counts:** invalid-signature, expired and superseded refusals, plus the register 401. Bootstrap credentials, operator revokes, infrastructure faults and garbage tokens do not.
- **Since #149:** retired-key screens recover onto 1-hour credentials, so this alarm stays quiet for that exact incident; the fleet check covers it instead.

## 3. Restart quiet
When the restart is the only thing holding the gate, the scan still runs platform-incident detection owner-only (owner email plus SILENT rows). Customer emails keep their quiet and still need two scans. The "second restart inside the quiet" test fails on the old code and passes on the new.

## Tests and switches
- New tests: 52 policy, 16 fleet check, 16 refusal alarm, 6 gateway, 2 register, 4 customer-alert. They include the replayed incident (14 screens, 5 organisations → one email at +10 minutes, a reminder at +70, a recovery note).
- Full API Jest: 583 suites, 11,163 tests, 0 failed. API tsc clean.
- Kill switches: `POST_RESTART_FLEET_CHECK_DISABLED=1` and `DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED=1`. CLAUDE.md env row added.

## Not verified / known gaps
- Not run against production data, live Redis or Resend.
- `RAILWAY_DEPLOYMENT_ID` at runtime is unconfirmed; without it the claim is per process.
- The 5-minute hand-over grace is unconfirmed.
- A screen scheduled "off" around a restart is excused even if its silence is really a credential problem.
- A crash-looping API that never lives 10 minutes gets no fleet check.
