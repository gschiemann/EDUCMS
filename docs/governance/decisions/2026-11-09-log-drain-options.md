# Decision — a log drain for the API: which destination, what budget (proposal)

Article 22 · Phase 1 item 13 · prepared 2026-11-09 by Claude Sonnet 5.5 for the lead · **a proposal only: no account was created, nothing was configured, no secret was touched.** Anything not marked verified is from public knowledge and must be checked on the vendor's pricing page before the owner commits.

| | |
|---|---|
| **Situation** | The API runs as one Railway replica and logs through Nest's built-in `Logger` to stdout. Railway keeps those logs only for a limited, plan-dependent window and they are searched in its dashboard. Nothing ships them anywhere else. When the container restarts or is redeployed, the running process's context is gone and the only record is whatever Railway still holds. On 2026-10-23 refusals were logged but nothing alarmed: the evidence existed in a buffer nobody was watching, and no rule turned it into a page. Sentry covers exceptions (5xx) but not the 4xx refusals, the request-log breadcrumbs or boot/worker lines. |
| **Evidence** | **Verified here:** the `railway` CLI is installed; its top-level help lists no drain command, and the Railway MCP failed to connect (credentials rejected), so Railway's drain feature was **not** checked against the live product. **Public knowledge, unverified:** Railway can forward service logs to an external destination (an HTTP/webhook or syslog-style drain; availability and plan tier to be confirmed). **In the repo:** every error log line and mutation breadcrumb now carries a request id (`[rid=…]`, `"requestId"`), and the response/`requestId` body field lets a customer quote one, so a drain would be searchable by that id from day one. |
| **Recommendation** | Pick **one** of the three below, start on the free tier with a hard ingest cap and one alert rule (refusal burst, 5xx rate), and revisit at 30 days. Lead choice if the owner has no preference: **Better Stack** (simple HTTP source, built-in alerting that answers the 2026-10-23 gap) with **Axiom** as the alternative for the most generous free ingest. Grafana Cloud Loki is the strongest if the company wants metrics and dashboards later, at more setup. |
| **Risk** | **Cost drift:** log volume grows with fleet size and a chatty line (per-request logging, a retry loop) can exhaust a free tier mid-incident; set an ingest cap and an alert on the cap itself. **PII and secrets:** logs must never carry device tokens, JWTs, session cookies or API keys, and paths already redact the scorekeeper-console token and query strings (SDE-05). The request id is safe (random UUID or a client-chosen opaque string). A drain sends tenant-related identifiers (user ids, IPs in the mutation breadcrumb) to a third party: a data-processor entry and the customer-security-doc wording need a check before it goes on. **Drain failure direction:** a failed drain must lose logs, never block the API; Railway's side is fire-and-forget, to be confirmed. This does not touch the emergency path. |
| **Validation** | After the owner chooses: create the destination, configure the drain on a **staging or bench** service first, send a request with a known `x-request-id`, and find it in the destination within a minute; confirm no `Authorization`, cookie or token string appears (search for `Bearer`, `eyJ`); trigger a handled 4xx burst and confirm the alert fires. Confirm retention and the cap in the vendor console, not from this record. |
| **Rollback** | Remove the drain in the Railway service settings; logs return to Railway only, exactly as today. Delete the destination account/project. No code depends on the drain. |
| **Models involved** | Builder: Claude Sonnet 5.5 (Claude Code subagent). Reviewer: none yet; a different vendor should check the vendor facts below before the owner pays for anything. |
| **Decision requested from the owner** | **Which destination** (Better Stack · Axiom · Grafana Cloud Loki · none for now) **and what monthly budget** (suggested: free tier only, with an agreed ceiling before any paid plan). |
| **Decision** | (owner) · date |

## The three candidates (all unverified: check each pricing page)

| Destination | Free tier (as publicly advertised, unverified) | Fit |
|---|---|---|
| **Axiom** | A free plan with a monthly ingest allowance in the tens of GB range and short retention (about 30 days); HTTP ingest API. | Largest free ingest; query by `requestId` is trivial; alerting exists but is lighter than Better Stack's. |
| **Better Stack (Logtail)** | A free plan with a few GB of ingest and about a week or so of retention; HTTP source; uptime and on-call alerting in the same product. | Closest to the 2026-10-23 need (log pattern becomes a page); smallest setup. |
| **Grafana Cloud (Loki)** | A free plan with roughly 50 GB of logs and about 14 days of retention; ingest over HTTP (Loki push API). | Best if metrics and dashboards come next; most setup and the most ways to misconfigure labels. |

Numbers are recalled, not read from the vendors; treat each as an order of magnitude only.

## What this change already did

The request-id work (the `x-request-id` header, `requestId` in error bodies, the `request_id` Sentry tag, the id in the central error line and mutation breadcrumb) is independent of the choice and ships regardless: it makes Railway's own log search and Sentry findable by one id today.
