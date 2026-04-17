# UptimeRobot Free Tier Monitoring Setup

## Why UptimeRobot

UptimeRobot's free tier provides everything we need today: 50 monitors at 5-minute check intervals, HTTP(S) keyword matching, email and SMS alerts (via email-to-SMS gateways), and a free public status page. It won't scale infinitely, but it's zero cost, has no rate limits that affect us, and requires no infrastructure beyond a Slack webhook if we want team notifications. Later, we can migrate to a paid monitoring service if needed, but for now this covers uptime detection and incident alerting without vendor lock-in.

---

## Monitors to Configure

Configure these four monitors in UptimeRobot. Replace `<api-host>` and `<web-host>` with your actual deployed hostnames.

| Name | URL | Expected Response | Monitor Type | Alert Threshold | Purpose |
|------|-----|-------------------|--------------|-----------------|---------|
| API Liveness | `https://<api-host>/api/v1/health` | HTTP 200 | HTTP(S) | 2 failures in a row | Is the process running? |
| API Readiness | `https://<api-host>/api/v1/health/ready` | HTTP 200, keyword: `"status":"ok"` | Keyword | 1 failure | Is the database reachable? |
| Emergency Path | `https://<api-host>/api/v1/health/emergency-path` | HTTP 200, keyword: `"status":"ok"` | Keyword | 1 failure | **CRITICAL:** Is the emergency broadcast chain ready? |
| Web App Home | `https://<web-host>/` | HTTP 200 | HTTP(S) | 2 failures in a row | Does the dashboard load? |

---

## Keyword Monitor Setup

For **API Readiness** and **Emergency Path**, set the monitor type to **Keyword** and configure:
- **Keyword to find:** `"status":"ok"`
- **Search type:** Contains

This catches partial-health scenarios. Both endpoints return HTTP 200 for some failure modes; keyword matching ensures we alert only if the specific health check passes. Do not use plain HTTP(S) type for these—use Keyword.

---

## Alert Contacts

### Email Alerts
Add your email address in **Alert Contacts**. Email alerts are instant and free. Test immediately after setup to verify delivery.

### SMS via Email-to-SMS Gateway
Email-to-SMS is free for major US carriers via these gateways:

| Carrier | Gateway |
|---------|---------|
| Verizon | `{number}@vzwpix.com` |
| AT&T | `{number}@txt.att.net` |
| T-Mobile | `{number}@tmomail.net` |
| Cricket | `{number}@mms.cricketwireless.net` |
| Sprint | `{number}@messaging.sprintpcs.com` |
| Virgin Mobile | `{number}@vmobl.com` |

Create an alert contact of type **Email** with the carrier gateway address (e.g., `5551234567@txt.att.net`). UptimeRobot will send alerts to that address; the carrier's email-to-SMS bridge delivers them as texts.

### Slack Webhook (Optional)
If your team has a Slack workspace, use UptimeRobot's built-in Slack integration. Visit your UptimeRobot integrations, connect Slack, and select a channel for alerts. This is free and requires no additional setup.

---

## Public Status Page

UptimeRobot's free tier includes one public status page. After creating your monitors:
1. Go to **Status Page** in the UptimeRobot dashboard
2. Create a new page
3. Add your four monitors to the page
4. Publish at a custom subdomain (e.g., `status.educms.example`)

Share this link with stakeholders. It updates every 60 seconds and requires no authentication.

---

## CRITICAL: Emergency Path Monitor

> **The Emergency Path monitor (`/api/v1/health/emergency-path`) validates that the emergency broadcast pipeline is operational. This is your kill switch for outages.**
>
> If this monitor turns red during school hours, page the on-call engineer **immediately**. Any panic trigger sent during an outage where this endpoint is unreachable will not reach student screens via WebSocket (it will fall back to HTTP polling, but that's slower and unreliable).
>
> Set alerts for this monitor to the fastest channel: SMS first, then email. Do not snooze this alert.

---

## What We're NOT Doing Yet (Deferred)

- **Synthetic emergency drills:** No actual broadcast will be triggered during monitoring. A feature-flagged "drill mode" for the emergency path is planned for Sprint 5.
- **On-call paging:** PagerDuty and Opsgenie have free tiers, but they're overkill at this stage. Email + SMS suffices.
- **Auto-incident creation:** Status-page auto-incidents from monitor failures—defer to when we have a formal incident management process.

---

## Quick-Start Checklist

Once you have a deployed API hostname and web host:

1. **Create UptimeRobot account** — Go to [uptimerobot.com](https://uptimerobot.com), sign up (free), verify email.
2. **Add four monitors** — Use the table above. Set monitor interval to 5 minutes (UptimeRobot free default). Test each URL in your browser first to confirm it's reachable.
3. **Add alert contacts** — Email address + SMS gateway (if you want SMS). Test by triggering a monitor alert (manually pause a monitor to verify the alert fires).
4. **Set keyword monitors** — For Readiness and Emergency Path, switch from HTTP(S) type to Keyword type and add `"status":"ok"` as the search term.
5. **Create status page** — Go to Status Page, add all four monitors, publish at a custom subdomain.
6. **Document endpoint contracts** — Pin the health endpoint URLs and response schemas (from your API docs) in your runbook or wiki. Alert routing is useless if on-call doesn't know what each endpoint measures.

---

## Endpoint Reference

For setup validation, confirm your health endpoints return this shape:

```
GET /api/v1/health
→ 200 OK
{"status":"ok"}

GET /api/v1/health/ready
→ 200 OK if DB is reachable, 503 otherwise
{"status":"ok","db":"ok"}

GET /api/v1/health/emergency-path
→ 200 OK if DB and WS signer reachable, 503 otherwise
{"status":"ok","db":"ok","ws_signer":"ok"}
```

All endpoints return JSON and no actual broadcasts or state changes occur during health checks.
