# HQ fleet management + monitoring — best-practice research + verdict (2026-06-02)

Web research (general-purpose agent). Question: is the operator's model right —
*"at the top level I see + control every location's screens (one list + one
map), local managers are optional not required, I get fleet-wide offline
alerts, and I can drill into a location"*? Does it help or hurt?

## VERDICT: the model is the industry-standard default. Build it.

Every leading platform converges on exactly this "single pane of glass":
aggregated org-level view of all screens, drill-down by filter/group/tag/map-pin,
**optional** (never required) local admins, and fleet-wide offline alerting.
The operator isn't inventing anything — it's the category convention.

| Platform | Org-level all-screens view | Drill-down | Local admins optional | Offline alert channel |
|---|---|---|---|---|
| OptiSigns | Yes ("Default Team" sees all) | folders + perms | Optional | Email, per-rule scope + recipient, daily digest |
| Yodeck | Yes ("All" across workspaces) | workspace dropdown | Optional | Email, 30min–48h wait, back-online notice |
| ScreenCloud | Yes ("Screens Manager", whole org) | filter status/space/platform/tag | Optional | Email; red/orange/blue severity |
| Rise Vision | Yes (thousands, one dashboard) | locations | Optional | Email on offline |
| Skykit | Yes (corporate-level) | filter by location | Optional (both) | Automated device alerts |
| AppSpace | Yes ("Device Insights") | location/status/type | Optional | Email (immediate + digest), 15min |
| Navori QL | Yes (Monitoring window) | selections + location | Optional | Email, configurable disconnect delay (30min) |
| BrightSign BSN.cloud | Yes (Network tab) | groups + tags | Optional | Health monitoring + reports |
| Screenly | Yes (**map dashboard** w/ health pins) | labels/tags/groups | Optional | Email + **PagerDuty** (true escalation) |
| Esper / SOTI (MDM) | Yes (fleet telemetry) | group by location/type/tag | Optional | Custom alerts by event/group |

## The dominant pattern (matches the operator 1:1)
1. **Aggregated org view is the default**, not per-location silos. Sub-accounts exist for delegation, but the top always rolls up.
2. **Drill-down = filter + group/tag + map-pin click.** ScreenCloud's status/space/platform/tag filter is the gold standard.
3. **Local admins are optional everywhere** — HQ does it all; delegation is opt-in. (Directly answers "I shouldn't HAVE to set up local managers.")
4. **Offline = heartbeat/last-seen; alert = email by default.** Offline marked after 10-15min; alert after a wait window.
5. **Scale handled via grouping/tagging + status filters** (+ a clustered/pin map). At 150+ you filter to "offline", never scroll a flat list.

## Where the BEST go beyond the operator's description (copy these — skipping them HURTS)

**Alert-fatigue controls (the #1 thing to get right):**
- **Down-for-N-minutes threshold** before firing (anti-flap — screens reboot/blip). Every leader gates the alert (Yodeck 30min–48h, Navori 30min, AppSpace 15min, OptiSigns 10min-offline).
- **Off-hours / planned-downtime suppression** (a gym screen off nights/weekends shouldn't page anyone).
- **Back-online resolution notices** (close the loop).
- **Daily-digest default, real-time opt-in** (OptiSigns: hourly "clutters your inbox if you're not acting within the hour").
- **Multiple scoped rules, recipients independent of admin rights** (OptiSigns: "Location A down → email Location A's manager" — notify someone without granting them management).

**Guardrail against fat-finger cross-location changes:**
- Governance consensus: centralized standards + **scoped publishing** + **confirm-before-bulk-apply**. Even when HQ *can* touch everything, separate "action rights" from "where it lands" so a bulk push requires deliberately selecting the target scope. Prevents "I pushed the wrong creative / broke all 150 stores from the top." Pair with audit-log trails.

**A real escalation channel beyond email** — webhook / Slack / PagerDuty — for the high-stakes fleet (a down board can mean a missed emergency alert). Screenly's PagerDuty is the differentiator; aligns with VenueOS Standard Audit Surface §9.

## The 3-5 things to do to match the best
1. Ship the aggregated fleet view + map as the landing surface (all screens/locations, one list + map) with **filter by location/group/tag/status** + **click-pin → location** drill-down. *(ties to tasks #219 fleet-map overhaul, #62 lat/lng fallback.)*
2. Make local admins strictly optional — HQ does everything by default; per-location delegation opt-in. (Tenant hierarchy + RBAC already supports it; just span children in the HQ view.)
3. Build offline alerting **with fatigue controls from day one**: heartbeat → **N-minute threshold** → fire; off-hours suppression; back-online notices; **daily-digest default**; multiple scoped rules w/ independent recipients. (Building blocks exist: `offline-screen-scanner` + Resend email.)
4. Add ≥1 escalation channel beyond email (webhook/Slack/PagerDuty).
5. Guard bulk/top-level actions — scope to an explicit target group + **confirm-before-bulk-apply** + audit trail.

## Sources
OptiSigns (multi-location user mgmt, remote management, Monitoring Alert setup, offline doc); Yodeck (workspace hierarchies, screen email notifications); ScreenCloud (Screens Manager whole-org, custom roles); Rise Vision (manage thousands, offline notifications); Skykit (platform); AppSpace (Device Insights, location notifications); Mvix; Navori QL (alert profiles, monitoring window, player status); BrightSign BSN.cloud; Screenly (map dashboard + PagerDuty); Esper/SOTI (fleet telemetry, custom alerts); governance: Pickcel / SignageTube / AcumenCMS. (URLs in session transcript; a few vendor alert-channel specifics medium-confidence.)
