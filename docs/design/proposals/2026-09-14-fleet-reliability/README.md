# Fleet reliability — redesigned in the context of the whole dashboard

> **SUPERSEDED SCOPE — operator correction:** The dashboard-wide design below was rejected. Do not implement its layout, navigation, other-card changes, or rename Uptime to Reliability. Only redesign the existing Uptime card, keeping its current dashboard position and allocated footprint. The current card-only preview is `uptime-card-only.html` in the task visualization directory. It retains the Uptime title, adds local location/device filters, an affected-device-count timeline, precise time inspection, current status counts and handoffs to the existing Screens list/drawer. Everything outside this card stays visually unchanged. Earlier source findings about scope/data accuracy remain relevant only to the minimal data wiring needed by this card. Per-device historical drilldown requires real per-device history; the interactive preview uses synthetic data and is not a shipped integration.

September 14, 2026. Design proposal, not a shipped application change. Initial source baseline: `efe151de`. Other development continued during this review; unrelated edits were not changed.

## Decision

Replace the narrow **Uptime** card with **Reliability**, retaining its position beside **Needs attention** and **Today’s Schedule**. Do not add another fleet-health page, incident queue, or device drawer.

The existing dashboard already has the right major pieces. Make them agree about scope, evidence and actions:

| Existing area | Responsibility after this change |
|---|---|
| Header | One authorized fleet/location scope, optional device type/group/search; existing Push content and status refresh |
| Five assurance checks | Independent current evidence: app version, connectivity, instant channel, emergency setup, playback |
| Active deployment strip | Only a real in-progress/recently completed push; retain its proof/delivery flow |
| Needs attention | The one action queue; health-count clicks focus its relevant device subset |
| Today’s Schedule | What is intended to play, for explicitly identified targets and time zones |
| Reliability | What should be on, unexpected unavailability, observation coverage and historical impact |
| Locations / Network Atlas | Geographic/organizational drill-down over the same authorized scope; retain both views |
| Recent activity | Real events and command outcomes, not a second incident inbox |
| Existing Screens drawer | The only detailed device investigation/control surface |
| Global emergency UI | Remains visible and authoritative; ordinary device filters never conceal an active emergency |

The interactive concept uses fictional devices and sample numbers. Application navigation is contextual chrome; source handoffs are explained rather than executed. The inline device-detail example represents a visit to the existing Screens drawer, **not permission to build another drawer**. No live commands or notifications are sent. Map and deployment layouts are retained, not redesigned by this concept; the sample has no active deployment or emergency.

## What the current implementation actually provides

- [FleetCommandCenter](</Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/dashboard/district/FleetCommandCenter.tsx:1040>) already composes the five checks, attention list, conditional deployment strip, schedule, Uptime, Locations/Atlas and activity.
- Its [location scope](</Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/dashboard/district/FleetCommandCenter.tsx:494>) prefilters the current fleet/readiness/approval inputs. Reuse this approach rather than applying cosmetic output filters independently in each card.
- The [Uptime calculation](</Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/dashboard/district/FleetCommandCenter.tsx:999>) still combines whole-fleet pulse/device inputs with live counts derived from scoped `fc`. A chosen location can therefore be mixed with whole-fleet history. Fix this before adding more filters.
- [FleetPulseResponse](</Users/gschiemann/Desktop/EDU CMS/apps/web/src/hooks/use-api.ts:2905>) contains fleet history plus **limited per-location online/total series**. Reuse that per-location data for honestly labeled connectivity history. It does not supply per-device history, per-location historical paint counts, or historical effective schedules.
- [uptime.ts](</Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/dashboard/district/uptime.ts:1>) acknowledges that child-location schedules are not available from the HQ session. Its aggregate subtraction of scheduled sleepers from not-painting counts cannot establish that the sleeping devices are the same devices with stale playback evidence.
- [Today’s Schedule](</Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/dashboard/district/FleetCommandCenter.tsx:985>) uses prederived incoming rows, not the selected location’s scope. Its [page-level derivation](</Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/dashboard/page.tsx:425>) needs explicit target/tenant metadata before claiming cross-location filtering. Preserve an honest “this location only” label until the data supports broader scope.
- Device Open already [switches to the owning tenant and deep-links `screens?screen=<id>`](</Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/dashboard/district/FleetCommandCenter.tsx:781>). Preserve that route and the existing Screens drawer.
- The dashboard’s [RowPushButton](</Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/dashboard/district/FleetCommandCenter.tsx:343>) sets its sent state immediately after starting a mutation. It should distinguish sending, server acceptance, failure, device acknowledgement and recovery. Reuse [deriveRecovery](</Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/screens/v3/screenOps.ts:772>) rather than adding a second recovery-state model.
- The [desktop page](</Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/dashboard/page.tsx:524>) returns a separate MobileDashboard on phones. A desktop-only patch will not update the actual mobile experience. [MobileFleetCommand](</Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/dashboard/mobile/MobileFleetCommand.tsx:73>) already uses the shared fleet derivation and puts urgent attention first.

This was a targeted source/layout review, not an authenticated full-dashboard browser audit or security certification.

## The replacement card

Title: **Reliability**. Do not call all its metrics “uptime.”

1. **Expected on now:** eligible devices after effective display schedules and explicitly recorded maintenance/exclusions. Show the managed total and scheduled-off total beside it.
2. Compact, clickable rows: **Offline unexpectedly**, **Playback unconfirmed**, **Status unknown**, **Scheduled off**. Clicking focuses the existing device/attention view, with a visible filter and clear/reset action.
3. **Last 24h: expected-on connectivity**, only if the data supports that denominator. Otherwise use **Observed connectivity**, or an explicit unavailable state. Connectivity must never be renamed playback success.
4. **Observation coverage**, with missing time explicitly excluded from success/failure claims.
5. **Estimated device-time offline**, not an unexplained “hours lost.” Ten devices offline for one hour is ten device-hours, not a ten-hour outage.
6. Collapsed history/coverage details. Use proportional connected/offline/no-observation bands, not a whole-fleet red strip because one device was offline. A fleet shortage episode is not a count of device-specific outages.

Keep current counts visible while historical samples are building or unavailable. The existing `hasPulse` guard must not suppress current actionable device information just because history is sparse.

Avoid permanent 7-day/30-day selectors until retention, source resolution and endpoints support those windows. V1 can be last 24 hours.

## Shared filtering contract

- Start at **all devices the operator may access**, across all permitted child locations and supported player/controller/kiosk types. Reconcile this inventory with the Screens page; do not silently use only the current tenant or recently online devices.
- One dashboard location scope. Add type and search progressively; group filtering can live under More filters if needed. Search name, ID and group. Typing a specific-device search should search all statuses, not hide healthy devices behind a stale Needs-attention filter.
- Distinguish **scope** (location/type/group/device) from **status view** (offline/etc.). Status-view changes focus the list without making fleet totals collapse to the failing subset. Scope changes recompute applicable totals.
- Persist scope and drill-down intent in URL state using existing app conventions. Returning from the standard Screens drawer restores the originating view.
- Clear explicit multi-selection on scope change, or show and reconfirm preserved targets. Never retain invisible selected devices and silently act on them.
- For every card, either apply the scope or visibly explain why the source is broader/unavailable. Never show fleet totals under a selected-device heading.
- Emergency/readiness and approval items can be location-level, not device-level. Keep active emergencies outside ordinary filtering, preserve non-device items in the existing attention queue, and label their scope rather than dropping them.
- “All devices” is an inventory drill-down within the existing device workflow, not a replacement for the operational exception queue.
- If only one location is available, keep current single-location simplification: no pointless one-option location picker or one-pin map.

## Evidence and metric definitions

Keep connectivity, app currency, transport, playback confirmation and physical-panel verification separate. Do not assign all five from `status === ONLINE`.

Classify at the **individual device** level before counting:

- Expected-on + stale/absent heartbeat beyond the platform’s established threshold → unexpected offline, unless evidence itself is unavailable.
- Fresh heartbeat + insufficient fresh playback evidence → playback unconfirmed; do not assert the physical screen is black.
- Effective schedule says off → scheduled off, without implying that the controller itself disconnected.
- Incomplete/error/stale telemetry or unresolved schedule → explicit unknown/not verified, not zero issues.
- Retired, unpaired, commissioned-later and maintenance devices require explicit eligibility rules, not automatic healthy/offline status.

For history, sum **known connected expected-on device-minutes / known expected-on device-minutes**. Report coverage independently. Do not compute schedule-adjusted history using today’s membership/schedule as if it were true yesterday. Do not subtract a fleet sleeper count from an unrelated fleet stale-render count.

Use the existing 15-minute resolution honestly: estimated durations, gaps retained, no millisecond precision. Use absolute timestamps + relative ages. Respect each schedule’s IANA time zone, overnight windows, DST and precedence; show the viewer’s zone for the chart axis and the device-local zone for the next-on time.

### Data work genuinely needed

- For V1 location connectivity, select the correct existing `pulse.locations[tenantId]` series and label its limitations. For missing data, show unavailable; no fabricated history.
- For true device/type/group historical filters, record per-device observations or transition intervals with tenantId, deviceId, observedAt, connection evidence, playback evidence timestamps, effective expected-on state, eligibility/schedule version and source freshness.
- Add server-side aggregation by authorized scope/window. Return covered/eligible/unknown device-minutes and metric provenance, not only a percentage.
- Supply effective child-location schedules/eligibility to the authorized fleet aggregate; do not broaden tenant access just to populate the card.
- Schedule and activity records need stable target IDs/tenant IDs, not only display strings, to filter correctly.
- No screenshot contents, student names or displayed content payloads are needed for telemetry or filter analytics.

## Action contract

| User intent | Reuse / implement | Safeguard |
|---|---|---|
| Investigate device | Existing owning-tenant Screens drawer | No duplicate detail UI; retain back-to-overview context |
| Resync content | Existing refresh-web path and recovery state machine | Reachability, role, tenancy, capability and emergency checks; not a hardware reboot |
| Inspect offline device | Existing activity/connection guidance | Explain local power/network checks; no fake successful remote recovery |
| Review scheduled-off device | Existing display schedule controls | Do not automatically wake or override schedule |
| Multi-device action | Explicit selected IDs + preview of eligible/skipped targets | Server revalidation, request deduplication, bounded fan-out, per-target results and audit records |
| Assign follow-up | Add only if no existing incident ownership workflow satisfies it | Owner, note, state, audit; clearly new work, not an integration presumed to exist |
| Export current view | Scoped export using existing export conventions where available | Same permissions and filters; protect CSV formula-leading values; no unrelated tenant data |
| Refresh status | Existing dashboard query refresh | Read-only refresh, not proof the device performed a diagnostic |
| Push content | Existing playlist publishing wizard | Retain scope as proposed targets; user confirms there; never turn into reload-all |

Command states: **sending → accepted → device acknowledged → fresh evidence observed**, with independent failure/timeout states. A 2xx response is not recovery. Resync should not claim to restore physical power. No new all-fleet reboot, firmware rollout or emergency override belongs in this compact card.

## Integration and delivery plan

1. Unify scope derivation and evidence semantics. Fix the scoped-current/whole-fleet-history mix and misleading command feedback first.
2. Swap UptimeCard presentation for the compact Reliability card, retaining the existing three-card row and brand token system. Wire count clicks to the existing attention/device workflow.
3. Reuse the standard Screens drawer and preserve the deployment proof flow, Locations list/Atlas, Recent activity, non-device incidents and global emergency UI.
4. Add missing history/data capabilities separately. Until qualified, say unavailable. No new parallel telemetry polling loops; reuse query cadence and freshness states.
5. Update the real mobile path using the shared selector/model: scope → urgent attention → current evidence → compact reliability → schedules/locations/activity. Preserve capability-filtered quick actions and offscreen polling behavior. Do not merely shrink the desktop three-column layout.
6. Preserve existing classic-view fallback and product rollback mechanisms. No redesign of unrelated Assets, Templates, Playlists or emergency controls in this change.

## Acceptance tests

- Whole fleet, one location, device type, group and a specific healthy/offline device: list IDs, counts, history scope, map/list and applicable schedule/activity records agree.
- A missing/failed history source does not hide current exceptions or manufacture 100% availability.
- One offline device is visible without painting the whole fleet as offline; observation gaps and scheduled darkness are distinct.
- A sleeping device does not cancel a different device’s stale playback signal.
- Child location schedules, group overrides, overnight windows, DST, maintenance and inventory changes yield explicit, tested eligibility.
- App-current, push, connectivity and playback counts can differ; no shared-boolean shortcut.
- Open reaches the existing device drawer in the correct tenant; Back restores scope. Test parent-to-child permissions and a forbidden device ID server-side.
- Action failure never displays Sent/Recovered. Simulate accepted-without-ack, ack-without-playback, timeout, partial bulk success, duplicate click, revocation and active emergency.
- Scope changes clear or explicitly reconfirm selection; no hidden-target actions.
- Active emergencies and non-device queue items survive ordinary device filtering. Emergency readiness is never inferred from a connectivity percentage.
- Desktop, actual MobileFleetCommand, keyboard operation, narrow layout, and existing classic fallback all remain functional.

## Prototype verification

The local concept was browser-tested for status/location/device search, coherent list/location scoping, withheld subset history, resync waiting for evidence, bulk eligibility, selection clearing, empty-state recovery and overflow at 1060/768/390/320px. Light, dark and mobile captures were inspected. No script errors were reported. This validates the simulated interface only—not production data, device command delivery or API authorization.

The concept and its test harness are in the current task’s durable visualization directory, named `fleet-health-actions.html` and `check-fleet-concept.cjs`. No production application source was edited, committed, pushed or deployed.
