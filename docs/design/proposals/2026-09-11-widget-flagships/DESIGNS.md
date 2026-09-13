# Flagship widget design specifications

Status: **proposed design handoff, not approved production artwork**. Read [AUDIT.md](AUDIT.md) and [IMPLEMENTATION.md](IMPLEMENTATION.md) with this file. These specifications define the complete intended behavior and layout; the developer must still produce and obtain approval for the actual rendered designs, one widget at a time, before porting them to production. No new theme, imagery, or mockup in this document is represented as user-approved.

## Design system and interaction contract

### One product, not eight disconnected mini-apps

- Reuse existing approved VenueOS typography, brand tokens, asset picker, inline editing, and widget measurement helpers. Use the current flagship standards and existing approved template references as the visual starting point. Do not batch-generate eight new themes.
- Every widget has **Content · Data · Appearance · Behavior** sections in the editor. Content is open by default. Show only relevant controls; advanced options stay collapsed. Data has Manual / Connected choices, never an obligatory integration wizard for ordinary content.
- Add → choose useful starting layout → type/paste/select content → preview. An already-connected source can be selected in one step. Target **under 30 seconds** for first useful manual content or an existing-source selection; new OAuth/admin consent is a separate flow and cannot honestly be promised in 30 seconds.
- Every visible text field supports content, family, size, weight, color, alignment and line-height. Computed times/status values remain source-controlled; expose their formatting/labels, not a misleading editable number. Manual override is explicit and auditable, not an invisible text edit.
- Every photo/logo supports upload, asset selection, approved URL, fit, focal point and alt text. Arrays support add, remove, reorder and duplicate, with stable item IDs. No comma-separated object editors and no requirement to edit JSON.
- Background: solid, two-stop-or-more gradient or image; separate scrim strength. Brand-linked colors stay linked when the brand changes; a local override is visibly marked and resettable. Meaning never depends on color alone.
- Gallery samples are visibly “Sample.” Preview controls for simulated time/state are authoring-only. Published widgets contain approved content or an honest fallback, never invisible sample substitution.

### Geometry and legibility

The coordinates below use a **1920×1080 landscape design board** and a **1080×1920 portrait design board**. A full-screen 4K render doubles these coordinates. This is design geometry, not permission to use browser `vw` or assume every widget occupies the entire screen.

| Token | Design-board size | Full-screen 4K equivalent |
|---|---:|---:|
| Outer safe margin | 64 px | 128 px |
| Primary gutter | 32 px | 64 px |
| Supporting label minimum | 25 px | 50 px |
| Body minimum | 30 px | 60 px |
| Section heading | 48–64 px | 96–128 px |
| Primary message | 88–144 px | 176–288 px |
| Operational hero number | 180–280 px | 360–560 px |

Use fixed-design-stage + measured-container scaling for an approved composition, with deliberate compact/portrait layouts when the zone changes shape. **Do not shrink a whole dense board into a small zone and call it responsive.** At actual rendered zone size, preserve the selected viewing-distance profile's font floor, reduce row count and paginate, or ask the operator to enlarge the zone. Never ellipsize a route, person, room, price, warning or primary instruction.

Portrait is a reflow, not a letterboxed landscape board. Full landscape has a 1792×952 safe area. Portrait has a 952×1792 safe area. Use the same spacing rhythm; read all hero text at a glance. Ribbon-only formats are separate supported layouts, not arbitrary distorted aspect ratios.

No default marquee, pulsing status lamp, confetti loop or animated background. Brief 180–250ms content transitions are enough. Do not animate operational updates unnecessarily. Respect reduced motion; interactive screens offer pause/stop for relevant auto-updating or moving content. Test the accessibility requirements against [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and its [pause/stop guidance](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html). The 50px signage floor is a VenueOS requirement, not a WCAG rule.

### Shared states

| State | Audience sees | Editor sees |
|---|---|---|
| Manual, configured | Actual authored content; “Manual update” when operational | Last saved by/time; optional expiry |
| Sample | Only in gallery/explicit preview, marked SAMPLE | “Replace sample content” |
| Not configured | Neutral useful fallback; never fake customer data | One primary setup action |
| Loading, no snapshot | Branded loading/fallback message, not invented values | Connection progress |
| Fresh | Real values; source-backed status | Source name, last successful check and data age |
| Successful empty | “No events today,” “No orders waiting,” etc. | Successful connection, zero records |
| Stale with last good data | Policy-specific stale badge or neutral substitute | Reason, actual last confirmation and Retry |
| Expired / revoked | No sensitive old content; neutral message | Reconnect or resolve permission |
| Bad record | Omit invalid row with server-side diagnostic; never crash widget | Field-level validation/record count |

Render timestamps distinguish **data observed**, **source checked**, and **widget rendered**. Only the first two can support freshness claims. A server returning cached old data does not reset the age of the data.

## F01 — Schedule: Now / Next

**Classification:** upgrade. Reuse Calendar, Bell Schedule, Fitness Class Schedule and Meeting Room Schedule. One schedule model with school/room/class/event presets; no four competing time engines.

**Promise:** “Show the right thing happening now and what comes next.”

### Visual design

Use a strong vertical timeline spine with an active interval block, not a stack of generic cards. The status word and event title dominate. A room preset uses a door-sign side stripe; a school preset uses the same spine with period labels. Brand accent denotes selection; textual OPEN / IN SESSION / NEXT provides meaning.

```text
LANDSCAPE
┌──────────────────────────────────────────────────────────────┐
│ [Logo] TODAY AT NORTH CAMPUS                    Fri · 10:22   │
│                                                              │
│ NOW                         │ NEXT                           │
│ Chemistry                   │ 11:10  Advisory · Room 204    │
│ 10:05–10:55 · Room 203       │ 11:35  Lunch · Dining hall    │
│ 33 minutes remaining        │ 12:15  Design lab · Room 105 │
│ ━━━━━━━━━━ current interval │                               │
│ Schedule checked 10:21 · All times America/Los_Angeles        │
└──────────────────────────────────────────────────────────────┘
```

Landscape header `(64,64,1792,96)`; current block `(64,200,1040,700)`; next rail `(1144,200,712,700)`; footer `(64,944,1792,72)`. Current title 104px, period/time 40px, next rows 36px. Show at most three next items; use the remaining time, not a decorative simulated progress percentage.

Portrait: header y64–176; current y224–820; next y892–1712, up to four rows; footer y1776–1856. Compact: current title + times + exactly one next event; drop progress before shrinking text. For a small room sign, show room name and OPEN / IN USE prominently, with next event only if it fits.

### Editable configuration

`heading`, `resourceLabel`, `mode: school|room|classes|events`, `sourceBindingId?`, `timezone`, `hourCycle: 12|24`, `showEndTime`, `showRemaining`, `showLocation`, `emptyMessage`, `privateEventLabel`, `layout`, brand/style overrides.

Manual `events[]`: `{id,title,location?,startsAt,endsAt,allDay?,private?,cancelled?}`. `startsAt/endsAt` are offset-bearing instants. For recurring bell schedules, separately author `weeklyRules[]: {id,weekdays,startLocal,endLocal,title,location?}` and `dateExceptions[]: {date,closed,replacementEvents}` in the venue timezone; normalize into dated intervals server-side. Never infer a recurrence from a display string such as “2:30 PM.”

Limits: 100 events per snapshot; 120 characters/title, 80/location; show limited rows with pagination. End must be after start. Overnight intervals must specify next-day end. All-day events go into an “Also today” area, not the NOW slot. A private event shows only “Reserved” by default; organizers/attendees are not public-screen data.

### Behavior and data

Selection is pure: `startsAt <= syncedNow < endsAt`. Adjacent events hand over exactly at the boundary. Overlap shows “Multiple events” plus deterministic ordered rows rather than arbitrarily claiming a room is free. Holidays/date exceptions outrank weekly rules. A gap says “Next at 11:10”; after final event says “Finished for today.”

MVP: manual + existing ICS. Private Google/Microsoft connection is a separate server adapter milestone. Google Calendar already defines calendars/events/recurrence concepts to reuse; Microsoft Graph has an explicit resource free/busy API. Use least privilege and explicit resource selection, not a tenant-wide calendar dump. See [Google Calendar overview](https://developers.google.com/workspace/calendar/api/guides/overview) and [Graph getSchedule](https://learn.microsoft.com/en-us/graph/api/calendar-getschedule?view=graph-rest-1.0).

Room live-state recommendation: checked within 120s; stale thereafter shows “Availability not confirmed,” never green OPEN. A daily school ICS schedule can tolerate a longer explicitly configured cache, but show its confirmation time. These are proposed product thresholds, not provider promises. No room-booking button in this first read-only release.

**Implementation:** proposed `widgets/flagship/ScheduleWidget.tsx`, pure `lib/widgets/schedule-model.ts`, and schedule editor module; adapt existing source outputs. Keep legacy IDs; introduce an opt-in flagship variant and offer previewed migration. Correct legacy bell NOW independently.

**Acceptance:** arbitrary 37-minute classes; exact boundary; DST spring gap/fall repeat; timezones different from device; overnight; cancelled/overlapping/private/all-day entries; school closed day; no source; valid empty; stale/expired; operator enters next week's schedule and save/reopen preserves it. No content or event count can force unreadable text.

## F02 — Announcement Stories

**Classification:** upgrade/composition of Announcement, Photo, Countdown and existing QR. Not a new emergency system.

**Promise:** “Turn a notice into a polished, scheduled screen in under 30 seconds.”

### Visual design

An editorial poster with one headline and one optional image, not a miniature website. Use three treatments of this same composition during design review: photo-left editorial split; full-bleed photo with directional scrim; text-only oversized statement. Reuse an approved theme; keep structure and content identical for comparison.

```text
┌────────────────────────────┬─────────────────────────────────┐
│                            │ OPEN HOUSE                      │
│    REPLACEABLE PHOTO       │ Come see what                   │
│    with focal point        │ we're creating.                 │
│                            │ Thursday · 6–8 PM · Main hall    │
│                            │ Families and neighbors welcome. │
│                            │ [Real QR]  View the program     │
└────────────────────────────┴─────────────────────────────────┘
```

Landscape photo `(0,0,864,1080)`; copy `(928,80,912,720)`; CTA `(928,840,912,176)`. Headline 104px, date/location 40px, body 36px; QR 160–176px on the design board with quiet zone. Portrait photo y0–720; copy `(64,784,952,800)`; CTA y1648–1856. Text-only removes the empty photo footprint. Compact shows headline + one detail + optional QR only if the scan-size gate passes; never squeeze all fields into it.

### Editable configuration

`stories[]: {id,eyebrow,headline,body?,imageAssetId?,imageAlt?,focalPoint?,detailLine?,ctaLabel?,ctaUrl?,startsAt?,endsAt?,priority,approved}`; `layout`, `rotationSeconds` (default 15, range 10–60), `order: manual|priority`, `timezone`, `emptyMessage`, style.

Headline max 100 characters, body max 240, detail max 120, CTA label max 40. Input lengths are validation caps, not guarantees of fit: preview/overflow testing still applies. Full-screen copy may use two headline lines and up to four body lines; if more is needed, use another story. Do not silently truncate.

### Behavior and data

Only approved, currently eligible stories render. Sort by priority then manual order; never steal emergency priority. Scheduled expiry continues to work offline from cached approved records and shared time. A cached campaign whose end has passed is not allowed to continue because the network is down. A configured evergreen fallback replaces an empty set.

Existing publishing/approval controls remain authoritative. Content changes after approval require reapproval when tenant policy enables it. CTA uses the existing QR implementation after W11 sizing/margin qualification; real destination is shown in authoring preview. QR size is bounded by both available dimensions and includes at least four clear modules on every side. No synthetic scan analytics in MVP.

**Implementation:** proposed `AnnouncementStoriesWidget.tsx`, `story-model.ts`; reuse `QrCodeWidget` rendering primitives, media cache, `StyleableField`, asset controls and existing template scheduling/approval mechanisms. Do not create a second brand or scheduling database just for this widget.

**Acceptance:** one-click logo/brand defaults; replace image and change focal point; edit every line on canvas; story reorder/duplicate/undo; expired story removed offline; no network does not insert demo copy; long title in portrait; CTA pixel-decode; source approvals cannot be bypassed through import or raw config.

## F03 — Recognition Spotlight

**Classification:** consolidate and upgrade Staff Spotlight, Birthdays, Honor Roll and Provider Spotlight. Not a new face-generation feature.

**Promise:** “Make a person or team's contribution the hero.”

### Visual design

Photo-first editorial portrait with a restrained award ribbon crossing the image edge. A team variant uses a real group image. The layout is not a colored empty rectangle beside invented statistics.

```text
┌─────────────────────────────┬────────────────────────────────┐
│ [Replaceable portrait]      │ THIS WEEK'S SPOTLIGHT          │
│                             │ Jordan Lee                     │
│ ── MAKING A DIFFERENCE ──    │ Science department             │
│                             │ “Helping curiosity become      │
│                             │  confidence.”                  │
│                             │ Thank you for leading our lab. │
└─────────────────────────────┴────────────────────────────────┘
```

Landscape image `(64,64,768,952)`; ribbon y768 h112; name/copy `(912,112,944,840)`. Name 104px, role 40px, quote 52px, detail 32px. Portrait image `(64,64,952,880)`; copy y1016–1856; ribbon at image bottom. Compact: photo 40% width, name/role/reason 60%; remove optional quote before shrinking essential fields.

### Editable configuration

`people[]: {id,displayName,role?,photoAssetId?,photoAlt?,focalPoint?,recognitionLabel?,reason?,quote?,startsAt?,endsAt?,approved}`; `rotationSeconds` default 20; `layout: person|team|birthday`; `showLogo`; `emptyMessage`; style.

Name max 80 characters, role 100, reason 240, quote 200. Every person feature exposes the photo slot, even when no photo is supplied. Missing-photo variant is deliberate typographic recognition with initials or a tenant logo, **not a generated likeness**. Birthday data needs only month/day for display; no age or birth year required. Do not add public student rosters to make the widget feel populated.

### Behavior and data

Use explicitly approved CMS records/manual content first. Require organizational confirmation that names/photos may be displayed, and support withdrawal/unpublish. Publish eligibility is server-enforced. Reuse existing asset deletion and content revocation, with bounded player-cache expiry. Do not promise remote deletion while a device is indefinitely offline; document the expiration boundary.

**Implementation:** proposed `RecognitionWidget.tsx` + person repeater; adapt `v2/StaffWidgets.tsx` image/style behavior and healthcare provider variant. Existing provider ratings/patient counts remain optional imported/manual facts, never required placeholders.

**Acceptance:** uploaded image actually appears in editor and player; cover/contain/focal point; missing photo; long names and diacritics; RTL sample; remove consent/unpublish record; birthday leap day rule explicitly chosen; no stale expired spotlight; all fields undo and survive save/reopen.

## F04 — Directory & Wayfinding

**Classification:** upgrade existing Wayfinding Map / Room Finder / kiosk directory surfaces. The gap is coherent data and a trustworthy route, not another static map picture.

**Promise:** “Find the destination and see a clear way to reach it.”

### Visual design

Use large directional signage, floor badges and a restrained plan—not a dense consumer map. Show **You are here** and the destination in both map and text. Explicitly separate passive signage from touch mode.

```text
PASSIVE                              TOUCH
LIBRARY                    ↑         Search rooms or services…
Second floor · East wing             [A–Z] [Services] [Floors]
Elevator E, then turn right           Library · Floor 2
                                      [View route]
[Annotated approved floor plan]      [Map + numbered instructions]
```

Landscape header `(64,64,1792,96)`; directory/directions `(64,208,608,728)`; map `(736,208,1120,728)`; footer y968. Arrow/room number 160px; destination title 64px; directions 36px. Portrait: search/header y64–240; map y304–1088; destination/directions y1152–1760; controls/footer y1792–1856. Non-touch display rotates at most four approved destinations, 12s each; compact becomes an arrow + destination + floor widget without a postage-stamp map.

### Editable configuration

`siteId`, `startNodeId`, `mode: passive|touch`, `defaultDestinationId?`, `directorySourceId?`, `idleResetSeconds` default 60, `locale`, `accessibleRoutePreferred` default true, style.

Shared directory model: `destinations[]: {id,label,aliases[],category,floor,nodeId,publicVisible}`; `floors[]: {id,label,planAssetId}`; `nodes[]: {id,floorId,x,y}`; `edges[]: {id,from,to,cost,accessible,closed}`. Coordinates are normalized to the specific approved plan; no generated physical geography. Directions use approved graph segments, not an LLM guessing from an image.

MVP allows manual directional entries `{destinationLabel,floorLabel,arrow,instruction}` without a route graph, labelled as directions rather than calculated navigation. Search default is rooms/services, not people. Staff lookup is a tenant policy choice; students/patients are not public-directory defaults.

### Behavior and data

Touch selection shows route + text steps; keyboard/search equivalents exist. Closed edges are excluded; accessible mode excludes stairs. If no route can be validated, say “Ask reception for directions” instead of drawing a straight line through walls. Offline may use a versioned approved map for ordinary navigation; closure freshness must be explicit. This is **not evacuation routing** and must yield to the existing emergency overlay.

**Implementation:** proposed directory-model/route solver with unit tests, `DirectoryWayfindingWidget.tsx`; extract reusable rendering from existing map/room widgets and kiosk designs. Existing kiosk action routing must retain origin/source validation. Room booking is outside this widget.

**Acceptance:** two floors, stair-only destination, elevator route, disconnected nodes, closed corridor, keyboard-only search, touch targets at actual physical display size, idle reset clears search, absent map, authorized public subset only, offline/revoked site, no emergency obstruction.

## F05 — Queue & Pickup

**Classification:** upgrade Now Serving / Wait Times and existing QSR pickup designs with an authoritative feed. A menu catalog integration is not automatically an order-status integration.

**Promise:** “Tell people when and where they are being served, without exposing personal details.”

### Visual design

An oversized service-ticket number with a location stub; a distinct ready/pending rail. QSR uses READY / PREPARING; service counters use NOW SERVING / UP NEXT. Do not fill the page with health statistics or fabricated wait estimates.

```text
┌────────────────────────────────────┬────────────────────────┐
│ NOW SERVING                        │ UP NEXT                │
│                                    │ A048                   │
│ A047                               │ A049                   │
│                                    │ A050                   │
│ Please go to Counter 3             │                        │
│ Confirmed 10:22:08                 │                        │
└────────────────────────────────────┴────────────────────────┘
```

Landscape hero `(64,200,1120,704)`; rail `(1248,200,608,704)`; header y64 h96; footer y952 h64. Ticket number 260px; instruction 56px; rail tokens 80px. QSR full-screen alternative divides READY 60% / PREPARING 40% with 4–6 large IDs. Portrait hero y224–1040; next y1120–1712; footer y1776. Compact: current token and station only, no scrolling table.

### Editable configuration

`sourceBindingId`, `queueId`, `mode: serving|pickup`, `heading`, `labels:{ready,preparing,next,empty,unavailable}`, `showWaitEstimate` default false, `maxVisible` 1–8, `soundEnabled` default false, style.

Normalized `entries[]: {id,publicToken,state: waiting|preparing|ready|serving|completed|cancelled,stationLabel?,updatedAt,sequence,estimatedReadyAt?,estimateObservedAt?}`. Never include customer/patient/student names, order contents or visit reasons in the public payload. Tokens max 12 characters. The operator cannot override a connected order state by changing a text field.

### Behavior and data

MVP can use an authenticated staff console that writes real persisted queue changes; a widget does not need an external vendor to be useful. Existing vendor order APIs/webhooks are later adapters, separately qualified. Enforce monotonic sequence/revision and idempotency; stale updates cannot resurrect a collected order. Expire visible ready tokens after an explicit business policy, not an arbitrary component animation.

Proposed policy: poll fallback 10s, stale after 30s, hide current-serving/ready assertions after 120s without confirmation. Say “Please check with the counter.” Sound is optional and rate-limited, never a browser-audio guarantee. Do not derive clinical wait time from queue length; only show a supported, timestamped estimate with permission.

**Implementation:** proposed `QueuePickupWidget.tsx` and normalized queue adapter; staff mutations reuse auth/RBAC/audit infrastructure. Reuse existing Now Serving styling and QSR pickup artwork. Remove local success simulation from any surface promoted to connected mode. Separate public-read capability from staff-write capability.

**Acceptance:** valid empty queue, duplicated/out-of-order events, concurrent staff calls, cancelled order, station change, no names in payload/logs, two devices converge, reload persists state, provider failure does not show success, stale limit, reconnect without replaying every sound.

## F06 — Departures & Dismissal

**Classification:** upgrade existing bus, transit and departure boards. Start with a manual operational source; do not promise fleet tracking without a vendor feed.

**Promise:** “Know your route, gate and status at a glance.”

### Visual design

Station-board typography with a wide destination column, route badge, distinct gate column and explicit status words. Avoid ornamental split-flap animation when status clarity matters.

```text
ROUTES & DISMISSAL                          Confirmed 3:08 PM
ROUTE     DESTINATION             GATE     STATUS
12        North Loop              B2       BOARDING
08        River Road              A1       EXPECTED 3:18
31        West Campus             C1       DELAYED
Please board only your assigned route.
```

Landscape header y64–192, table header y224–288, rows y320–912 (maximum four at 148px), footer y952–1016. Column widths of safe area: 12/43/15/30%. Route 72px, destination 48px, gate 64px, status 40px. Portrait shows up to six 216px stacked rows; each row contains route/destination then gate/status. Compact: one route/gate/status, not six tiny lines. Retain all critical labels when localizing.

### Editable configuration

`sourceBindingId?`, `heading`, `mode: schoolBus|shuttle|transit`, `siteId`, `timezone`, `visibleRouteIds[]`, `sort: scheduled|gate|priority`, `footer`, style.

Manual/normalized `departures[]: {id,routeLabel,destination,gate?,scheduledAt?,expectedAt?,status: scheduled|expected|boarding|departed|delayed|cancelled|unknown,observedAt?,serviceDate,revision}`. Route label max 16, destination 100, gate 16, advisory 160. Never include a student-to-bus assignment list in this public widget.

### Behavior and data

Scheduled time is not an ETA. Without realtime, show SCHEDULED; without a confirmed boarding event, do not display BOARDING. Service date and overnight trips matter. Completed departures leave the active list by configured retention. Manual updates display actual author/time and expire after the operating period unless reconfirmed.

GTFS-Realtime is an optional public-transit adapter, not a universal school-bus API. Missing trip updates mean no realtime data—not on-time service. Proposed freshness for realtime transit: mark stale by 90s and remove active boarding/ETA claims after 180s unless provider semantics require stricter handling. These defaults draw on [GTFS realtime best practices](https://gtfs.org/documentation/realtime/realtime-best-practices/); map timestamp semantics using [the reference](https://gtfs.org/documentation/realtime/reference/).

**Implementation:** proposed `DeparturesWidget.tsx`, departure normalization adapter and typed route repeater; reuse TransitWidgets visuals and existing bus-board copy fields. A staff manual source works first; fleet vendor connector requires credentials, sample contract and qualification before activation.

**Acceptance:** delayed/unknown/cancelled, source empty, yesterday's cache, midnight/DST, missing trip update, old event arriving late, gate change, long route labels, two languages, no student names, disconnected source no longer implies boarding.

## F07 — Data Board: metric, progress and table

**Classification:** upgrade existing JSON/CSV source, KPI Tile, charts and tables. Not a replacement spreadsheet editor or a new connector platform.

**Promise:** “Put a useful number or table on screen without writing code.”

### Visual design

Three layouts over the same data contract: one dominant number with optional honest trend; goal progress with target; readable ranked table. No automatic rainbow dashboard and no decorative chart made from arbitrary sample points.

```text
METRIC                              TABLE
VOLUNTEER HOURS                     TEAM           HOURS
1,248                               North             420
of 1,500 semester goal              East              388
83.2%                              West              440
Source confirmed 10:20              Source confirmed 10:20
```

Landscape metric: label `(64,80,1792,96)`; value `(64,240,1280,320)`; unit/target `(64,608,1280,96)`; optional trend `(1408,240,448,464)`; footer y952. Hero 240px, label 48px, target 44px. Table uses a 128px header and up to five 136px rows, values right-aligned. Portrait uses hero first, then trend or table; no more than six rows. Compact metric retains label/value/unit and data-age state, drops trend.

### Editable configuration

`sourceBindingId?`, `view: metric|goal|table`, `title`, `valueField`, `labelField?`, `timestampField?`, `unit`, `decimals:0..4`, `locale`, `aggregation: none|sum|average|count`, `filters[]`, `sort?`, `target?`, `trendSeriesField?`, `comparisonLabel?`, `goodDirection: up|down|neutral`, `emptyMessage`, style.

Manual table `rows[]: {id,label,value,observedAt?}`. Connected column mapping uses a **sample preview**, type selection and validation: strings are not silently coerced into misleading numbers; locale commas, percentages and currencies need explicit parsing. MVP has an allowlisted filter language `{field,op:eq|neq|gt|lt|contains,value}` and no user JavaScript, SQL or `eval`.

### Behavior and data

Source setup: choose existing source / paste approved public CSV or JSON → inspect columns → select label/value → preview first rows → save. Credentials use protected server-side connections, never query strings on the player. CSV snapshot upload is manual data, not a live link.

Zero is a real value; null is unknown; an empty set is not zero unless the aggregation contract explicitly defines it. A percentage requires a denominator; division by zero gives “Not available.” Trends need at least two valid observed points. Show the actual comparison period and units. Favorable direction is configurable; higher incident count is not automatically green.

Proposed default snapshot check every 60s, stale after 5m, expiry after 1h; make tighter operational policies explicit. School attendance/roster or healthcare data must be aggregated and authorized; do not send underlying identities merely to calculate a count on the display.

**Implementation:** proposed `DataBoardWidget.tsx`, `data-board-model.ts`, column-mapping editor; extend API normalization and device-scoped read contract. Reuse existing KPI/chart drawing where valid. Existing source sample keys are not a content schema.

**Acceptance:** zero/null/empty, currency and locale numbers, invalid column, column renamed, NaN/infinity, negative goals, missing denominator, source swap clears old tenant/location data, row limit/oversized feed, malformed CSV, XSS strings, auth revocation, two widgets share one source subscription.

## F08 — Moderated Community Wall

**Classification:** new moderation/publish capability with existing image/video/text renderers. Native social connectors are later, individually qualified additions—not required to ship the first useful version.

**Promise:** “Show community moments that someone has actually approved.”

### Visual design

Editorial photo wall: one lead story or a deliberate two/three-image montage, each with legible caption and optional attribution. Not an embedded social website with tiny buttons, likes, tracking and navigation chrome.

```text
COMMUNITY MOMENTS
┌────────────────────────────────────┬────────────────────────┐
│                                    │                        │
│ Approved lead image                │ Second approved image  │
│                                    │                        │
│ Robotics showcase                  │ Garden volunteers      │
│ Our teams shared their projects.   │ Thank you for Saturday. │
└────────────────────────────────────┴────────────────────────┘
```

Landscape lead `(64,224,1120,664)` with caption band h160 included; secondary `(1248,224,608,664)` with caption h160; header y64–160, footer y944–1016. Captions 36px, title 56px, attribution at least25px. Portrait shows one full-width photo/story at a time, not two narrow columns. Compact shows one photo and caption. Reserve opaque/scrim-backed text bands; no low-contrast text directly on unknown imagery.

### Editable configuration

`collectionId`, `layout: hero|duo|montage`, `heading`, `showAttribution`, `rotationSeconds` default 15, `maxVisible`, `fallbackStoryId?`, style.

Server-controlled entries: `{id,source: upload|cms|provider,sourceRecordId?,mediaAssetId?,mediaType,caption,attribution?,rightsConfirmed,approvalStatus,approvedBy?,approvedAt?,startsAt?,expiresAt?,revision}`. Editor can select collections and edit authorized drafts; it cannot forge approved status inside the widget JSON.

Draft media/caption → review → approve → publish. Deletion/withdrawal invalidates the collection snapshot; devices purge/expire the record according to the cache policy. External deletion detection has a documented polling/expiry bound. Untrusted provider HTML is never injected into the player.

### Behavior and data

Phase A: approved uploads and existing CMS media only; reuse existing approval workflow where possible. School mode requires approval by default and does not auto-publish student names/photos/comments. No public submission form in MVP. Phase B: connect a named provider via its supported API only after current permissions, content rights, retention and token-revocation behavior are verified. Do not scrape arbitrary profiles or promise Instagram/TikTok/LinkedIn coverage from an embed URL.

Allow only transformed/sanitized media and text in player payloads. Unsupported media is rejected clearly at ingest. Captions are editable before approval; AI captioning/translation may create drafts but cannot publish them. No face recognition, inferred identities, automatic rankings or sentiment scores.

**Implementation:** proposed `CommunityWallWidget.tsx` + collection snapshot adapter. Reuse asset ingestion, moderation/approval and existing video/image lifecycle rather than cloning them. Promote `SOCIAL_FEED` only after its placeholder is replaced and saved legacy configs are explicitly migrated. Could launch as “Community Wall” before any external social adapter exists.

**Acceptance:** unapproved draft never reaches display payload; withdrawal and expiry; malicious captions/URLs; no provider tokens in page; tenant isolation; empty approved collection; one bad video does not blank the wall; portrait caption fit; revoke collection while online and while offline until expiry; accessible pause for interactive mode.

## C01 — School Today, a composition rather than widget number nine

Compose existing primitives and F01–F03. An ordinary school operator should add it from **Templates**, choose the school and schedule, then edit the announcement. Keep each zone independently editable and replaceable.

Landscape normalized zone positions (x/y/w/h in percentages):

| Zone | Geometry | Content |
|---|---|---|
| Brand/date header | 0 / 0 / 100 / 12 | Existing logo, title and clock primitives |
| Main story | 0 / 12 / 62 / 64 | F02 announcement, photo-first |
| Now / Next | 64 / 12 / 36 / 48 | F01 compact schedule |
| Today's lunch | 64 / 62 / 36 / 26 | Existing menu, after W05 fix |
| Recognition/footer | 0 / 78 / 62 / 22 | F03 compact recognition or a single notice |

Portrait: header 10%, story 40%, schedule 24%, lunch/recognition alternating bottom 26%. Use a proper portrait preset, not uniform scale. Do not run the bottom alternate so quickly that a viewer cannot read it; default 20s per module. If the available zone cannot meet font floors, remove secondary content instead of squeezing.

No student-identifying data by default. Empty schedule → current day and next published event; empty lunch → hide menu zone and expand story through an explicit preset layout choice; absent recognition → approved evergreen message. Emergency system remains an independent overlay above this composition. Weather is optional, not mandatory visual clutter.

## Design-review order

1. Fix existing factual/editor problems; do not wait for new artwork.
2. Produce 3 treatments of **F01 only**, using the same actual-size content and an approved VenueOS visual reference. Review landscape, portrait, compact and stale state. Obtain user approval.
3. Port the approved treatment; compare browser render with approved mockup. Complete F01 acceptance tests.
4. Repeat for F02, then F03; assemble School Today. Reuse their approved design language for later capabilities.
5. F04–F08 remain specified but unapproved until their own visual and integration gates pass. “Design brief complete” is not “all designs approved” or “widgets shipped.”
