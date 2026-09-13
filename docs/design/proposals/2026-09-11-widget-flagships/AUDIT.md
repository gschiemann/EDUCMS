# Widget re-audit and flagship roadmap

Date: 2026-09-11 · Reviewed checkout: `8d53ed24d290548650382cbaa9284c32837fad9a`.

## Coverage and limits — read first

This is a **widget product/code audit and implementation design**, not a penetration test, production certification, or a claim that 720 variants have each passed browser testing. I executed the registry and two static quality guards, enumerated every registered variant, and traced the important picker, editor, renderer, feed, POS, and kiosk paths. No application code, deployment, live account, or school data was changed. No live app, real device, provider account, or end-to-end test was exercised this pass.

Use the Standard Audit Surface checklist in CLAUDE.md as the domain map. `S` below means source/requirements reviewed within the widget scope, **not** an end-to-end pass; `D` means deferred. No N/A implies a feature is absent.

| # | Domain | Design | UX | Functionality | Coverage / deferred reason |
|---|---|---|---|---|---|
| 1 | Realtime / signed pubsub | D | D | D | Preserve existing emergency path; delivery testing out of scope |
| 2 | Storage / content | S | S | D | Photo/asset requirements; upload/offline pipeline not exercised |
| 3 | AI providers | D | D | D | Not needed to implement proposed widgets |
| 4 | AI feature surfaces | S | S | D | Optional draft assist only; provider execution deferred |
| 5 | Competitive AI scan | D | D | D | Current capability gaps, not whole-market AI audit |
| 6 | Streaming | D | S | S | Newly exposed Live Stream identified; playback/rights not tested |
| 7 | Sports feeds | S | S | S | Existing sports engine recognized; hardware/feed parity deferred |
| 8 | POS integrations | S | S | S | Existing providers, device menu hook and empty-result handling |
| 9 | Communications | D | D | D | Outside widget scope |
| 10 | Identity | D | S | S | Dashboard/device auth mismatch traced; general auth deferred |
| 11 | Billing | D | D | D | Outside widget scope |
| 12 | Design imports | D | D | D | No import changes proposed |
| 13 | Public alerts | D | D | D | Explicitly excluded; no second emergency widget system |
| 14 | Multi-vertical | S | S | S | Catalog defaults and reusable industry presets |
| 15 | Cross-browser / Taurus | S | S | S | Static guards executed; browser/hardware qualification deferred |
| 16 | Audit / tenant controls | D | S | S | Data-source audit failure handling inspected; full isolation test deferred |
| 17 | Operations / DX | S | S | S | Registry + typography tooling, rollout/test plan |
| 18 | Accessibility | S | S | D | Design requirements specified; no axe or assistive-tech test |
| 19 | Widget editability | S | S | S | Complete registration inventory; sampled editor/renderer traces, not every field |
| 20 | Design / UX / functionality | S | S | S | Evidence below; visual taste not graded without rendered review |
| 21 | Verification | S | S | S | Exact checks recorded; unverified work explicitly retained |

## Bottom line

**The catalog is large enough. The next investment should be trustworthy, easy-to-configure flagship experiences.** Build one new moderated community capability and upgrade seven existing capability families. Do not commission another large collection of cosmetic variants.

The current registry contains **720 variants across 92 widget types**, with **zero ID collisions and zero missing renderer functions**. These are styles/registrations, not 720 independent functional products. Full-screen HTML boards and composed presets are separate catalogs; they must not be counted as missing simply because they are outside the React registry.

Start with Schedule, Announcement Stories, and Recognition for schools. Fix the common editor/data defects first. Queue, Departures, Data Board, Directory and Community can then reuse the same foundations. A “School Today” screen should be a composition of widgets, not another monolithic renderer.

Deliverables:

- [DESIGNS.md](DESIGNS.md): eight detailed functional/visual specifications, plus School Today composition.
- [IMPLEMENTATION.md](IMPLEMENTATION.md): shared contracts, exact integration points, migration, test and rollout instructions.
- [INVENTORY.md](INVENTORY.md): every registered variant, default config keys, category, and audit disposition.

## What is now fixed or already exists

| Earlier concern | Current evidence | Current verdict |
|---|---|---|
| Huge filter-chip wall / raw enum names | `VariantPicker.tsx:332`, `widget-catalog.ts:1` | Code now uses named rows, one filter control, friendly labels and a curated section. Do not repeat the old screenshot as current evidence. Live deployment not checked. |
| Add versus replace ambiguity | `VariantPicker.tsx:309`, `:463` | Separate add and change-look paths now present. Preserve them. |
| No real general QR / guest Wi-Fi | `QrCodeWidget.tsx`, `qr-payload.ts`, `__tests__/qr-scannable.test.tsx` | Implemented with local QR generation and decoding tests in source; do not rebuild. Existing loyalty variant still needs consolidation. |
| Working widgets absent from picker | `variants-register.ts:440–505`, commit `1b1a9c09` | Sixteen additional types exposed: RSS, quote, birthdays, attendance, honor roll, stat row, schedule grid, menu item, stream, playlist, map, room finder, poll, touch menu/button/keyboard. Registration does not prove full runtime behavior. |
| Silent variant-ID collision | `variants.ts:116`, registration remap near `variants-register.ts:1169` | Current guard executed: 720 variants, no collisions. Keep existing IDs stable. |
| No calendar / RSS integration | `use-live-feed.ts`, API `feeds/` | Hooks and parser/backend infrastructure exist. Individual visual variants do not automatically inherit those bindings. |
| No POS integration | API `pos/providers/`; `lib/menu/use-pos-menu-items.ts` | Square, Clover, Shopify and Lightspeed adapters exist; device-scoped menu fetch is real code. Provider-account qualification still needed. |
| No custom data capability | API `data-source/`; `lib/data/use-custom-data.ts`; ticker binding | JSON/CSV proxy and mapping path exist. Auth, state/freshness and broader renderer binding need work. |
| No directory / room / pickup designs | Generic map/room widgets; `public/templates/kiosk/` | Existing presentations and interactions should be reused. Some kiosk operations are local simulations, not evidence of provider-backed transactions. |
| No legibility work | Latest commit + `widget-legibility/measure.mjs` | Substantial recent remediation exists. Do not translate a commit's “402 clean” into a current all-catalog pass. |

## Remaining findings

Priorities: **P1** before affected widget is promoted or used operationally; **P2** next polish/reliability milestone. These are product priorities, not CVSS ratings. Source-confirmed means the branch/logic exists; runtime impact still requires the specified reproduction.

### W01 — P1: structured rows can be corrupted by the generic editor

`PropertiesPanel.tsx:6515–6566` derives controls from registry defaults. Non-image arrays use `join(', ')` and save with `split(',')`. Defaults for Meeting Room Schedule and Wait Times Board are arrays of objects (`v2/registry.ts:425`, `:441`). This branch cannot preserve those objects: editing yields strings instead of `{start,title,...}` / `{dept,wait,...}`. Optional renderer fields omitted from defaults also have no guaranteed content control.

**Fix:** explicit schema-driven fields and typed repeaters; reuse `ListItemsEditor`. Never derive an object's schema from a sample value. Add/remove/reorder, undo/redo and save/reopen must preserve stable row IDs and nested properties. Initial source editability grade **F for these structured lists**; other variants remain unverified, not automatically F.

**Acceptance:** add a room event, change its end time, reorder it, save/reopen and render player; do the same with a wait-time row. Assert stored JSON retains objects, not strings or `[object Object]`.

### W02 — P1: “now,” availability and freshness are not always truthful

- Legacy `WidgetRenderer.tsx:2754–2790`: bell “NOW” uses hour-minus-eight/index, not configured start/end times. This finding is scoped to that renderer; V2 bell variants have separate logic.
- `v2/CorporateWidgets.tsx:21–45`: room status is configured; accompanying “Free for 32 min” / “Until 2:30 PM” strings are constants.
- `v2/HealthcareWidgets.tsx:67–82`: wait values come from configuration, but “Updated” uses the current render time.
- `v2/TransitWidgets.tsx:285`: literal “Updated 30s ago.”

**Fix:** Schedule spec + a shared snapshot state. Manual content is legitimate; label it as manual and use actual saved time. Only label a value live when an authorized source has confirmed it. Never compute “last updated” from render time.

**Acceptance:** fake-clock tests with an irregular schedule, timezone mismatch, DST, stale feed, feed restart, and explicit empty data. No fake current slot, fabricated wait estimate, or green availability on unknown data.

### W03 — P1: legacy loyalty QR remains decorative

`retail/RetailLoyaltyQRWidget.tsx:49`, `:182–186` still render a deterministic SVG pattern when copy exists but `qrImageUrl` is absent. The new general QR widget does not automatically repair this older saved variant.

**Fix:** reuse the actual QR payload/generation implementation. Add a real destination field; preserve valid existing image URLs. With neither destination nor image, show an honest setup state instead of a QR-shaped pattern. Keep the saved variant ID.

**Acceptance:** decode the rendered legacy widget's pixels and assert destination bytes; test offline, long URLs, brand palettes, Wi-Fi escaping separately, and a real phone at intended distance.

### W04 — P1: custom data is still tied to dashboard authentication

`lib/data/use-custom-data.ts:68` calls `apiFetch`. `lib/api-client.ts:185–222` obtains the dashboard UI-store token. `data-source.controller.ts:57–74` requires JWT plus operator RBAC. `use-live-feed.ts:10–17` explicitly documents this dashboard/player distinction. A paired player without an operator session has no equivalent device data-source read path in this hook.

**Fix:** resolve authorized source bindings server-side and deliver normalized, device-scoped snapshots. Reuse the device-menu authorization pattern, not its menu schema. Do not make the arbitrary-URL proxy public or put an operator JWT on a display.

**Acceptance:** paired player with no dashboard storage reads its assigned source; a revoked device and another tenant's source are refused. Authoring preview continues working. This impact is source-traced, not reproduced against a live device this pass.

### W05 — P1: “empty menu” is treated like a failed fetch

`lib/menu/use-pos-menu-items.ts:89–100` only accepts `next.length > 0`. After a successful nonempty menu, a legitimate `[]` retains old items; on first load it becomes null and invokes static fallback. That can show items after every item in a category has been removed/unavailable.

**Fix:** distinguish successful empty, transport error and not-configured. An empty success must clear the old list and render the configured empty-category message. Last-known-good is appropriate for a transient failure, not a valid empty result. Keep location/availability enforcement server-side.

**Acceptance:** populated → empty → populated, first-load empty, 503 with prior data, location switch, all-sold-out category. Customer prices must never silently revert to gallery sample prices.

### W06 — P1: some “interactive” presentations are not functional products

`v2/TouchEngageWidgets.tsx` contains presentation controls without `onClick` handlers; the photo booth, for example, draws a camera panel and a fixed countdown. That is not camera capture. Separately, `kiosk/office-room-panel.html:1419` mutates a local schedule; `:1430` produces a booked toast for another room; `:1438` advances simulated time. A visual interaction is not proof of persistent room booking.

**Fix:** annotate capabilities as display / interactive / demonstration. Keep demos out of production-ready recommendations; refuse successful-looking transactional feedback until the authoritative backend acknowledges it. Trace existing configurable kiosk actions before replacing any engine. Do not infer every kiosk is broken from one example.

**Acceptance:** repeat the action on two devices, reload, disconnect network and force a conflict. A success message appears only after persisted success; demonstration mode is visibly marked and cannot publish as operational content.

### W07 — P2: flagship selection is first-in-registry, not quality-qualified

`widget-catalog.ts:421–463` picks the first visible variant for each type. That cannot distinguish connected, manual, demo, unqualified-device or broken-editor variants. Sixteen registered variants currently fall into “More widgets,” including both new QR tiles, Schedule Grid, Live Stream and Room Finder (derived during this audit).

**Fix:** add explicit preferred IDs with a tested fallback, readiness and supported-surface metadata; category mappings for newly exposed types. Keep curated 8–12 choices. Show industry choices first without duplicating engines by vertical. QR should be considered for the universal starter row.

**Acceptance:** each supported vertical has stable useful defaults; no demos; all filter options change the result set; search can recover every eligible widget; add/replace remain distinct.

### W08 — P1 for promotion: “legible” currently means two different thresholds

`widget-legibility/measure.mjs:21` imports Playwright from an absolute personal-machine path. Its default floor is about **24px at 2160px height**. `FLAGSHIP-TEMPLATE-STANDARDS.md:78` requires **50px supporting text and 60px body** on the 4K flagship stage. Passing the default sweep does not establish flagship legibility. The font-ceiling guard also permits existing baseline debt.

**Fix:** make the measurement tool use workspace dependencies; add explicit signage profiles and role-aware floors. Run full-screen and actual composed-zone sizes, portrait, long copy and non-Latin fonts. Never grow text blindly until it overlaps.

**Acceptance:** reproducible clean-clone invocation, no new baseline exemptions, visual evidence at the actual display sizes. A scaled thumbnail is not a viewing-distance test.

### W09 — P2: recognition still needs a real photo-capable shared design

`v2/HealthcareWidgets.tsx:109–137` Provider Spotlight has name/bio/stat fields but no photo configuration; its portrait area is a gradient. This violates the project's photo-slot requirement for person features. Other staff/photo widgets already have useful implementations.

**Fix:** Recognition spec. Reuse asset selection/cropping and existing staff variants; omit unverifiable ratings/patient counts rather than displaying sample claims. Do not invent portraits or personal achievements.

### W10 — P1 for new connections: audit behavior and URL handling need hardening

`data-source.controller.ts:131–156` writes the operator URL into audit details and catches failed audit writes without surfacing failure. Signed/private feed URLs can contain secrets in their query strings; do not encourage those until credential handling is explicit. Best-effort audit behavior conflicts with the repository's audit-write requirement.

**Fix:** store a source identifier + redacted origin/path, not query credentials. Credential-aware setup must keep secrets server-side. Source create/change/revoke and privileged writes require a durable audit strategy; pure periodic reads can use operational telemetry. Do not blanket-rotate secrets without evidence of exposure.

**Acceptance:** canary credential absent from player manifests, logs, analytics and audit JSON; source writes cannot report success without durable mutation/audit evidence. Full security validation remains a separate gate.

### W11 — P1 for promotion: new QR needs narrow-zone and quiet-zone qualification

`QrCodeWidget.tsx:129–135` derives code size and padding from **height alone**, despite a comment describing the shorter edge. At the default scale on a 2160×3840 portrait zone, the code itself is about 2196px wide before its white padding, already wider than the zone; the outer container uses `overflow: hidden`. This is a source-level geometry finding, not a freshly captured browser screenshot.

Generation uses `margin: 2` plus external white padding equal to about 4.5% of code width (`:100–105`, `:134`). That does not guarantee a four-module quiet zone for low-version codes. DENSO specifies a four-module clear margin on every side; verify the combined rendered margin, not only that a decoder accepts one pristine PNG. [DENSO QR code area guidance](https://www.qrcode.com/en/howto/code.html).

**Fix:** measure both dimensions; budget title/caption/network fields before allocating a square QR area; preserve a four-module margin independent of payload length. Changing a payload should not leave the old QR next to the new caption while generation is pending. Keep local QR generation and the existing decoder tests.

**Acceptance:** portrait, square, narrow column, maximum title/SSID and long payload; decode the full rendered screenshot at actual size, assert no clipping, verify quiet-zone modules and use a real phone. The new implementation is a valuable foundation, not yet an all-size scan guarantee.

## Additional flagship scope

| Order | Capability | Build classification | Main customers | Why it earns a place |
|---|---|---|---|---|
| 1 | Schedule — Now / Next | Upgrade existing calendars, bells, rooms, classes | Schools, workplaces, gyms, venues | Answers what is happening and where, correctly |
| 2 | Announcement Stories | Reusable upgraded announcement + photo + CTA composition | All | Makes a useful branded notice in seconds |
| 3 | Recognition Spotlight | Consolidate staff/celebration/provider features | Schools, workplaces, healthcare, worship | Photo-first recognition with real editable content |
| 4 | Directory & Wayfinding | Upgrade existing maps/room finder/kiosk designs | Schools, hotels, hospitals, campuses | Helps a visitor reach the right place |
| 5 | Queue & Pickup | Connect existing queue/pickup presentations | Food service, front desks, service counters | Clear, authoritative ready/now-serving state |
| 6 | Departures & Dismissal | Upgrade existing bus/transit boards | Schools, campuses, hotels, venues | Operational route/gate/status with honest freshness |
| 7 | Data Board | Extend existing JSON/CSV + KPI/chart widgets | Workplaces, schools, retail, gyms | Useful numbers without custom coding |
| 8 | Moderated Community Wall | New publish/moderation capability; reuse media rendering | Schools, venues, workplaces, worship | Approved community content; external social connectors later |

Do not add: another generic clock, more stock/crypto skins, another QR implementation, another emergency trigger widget, an unmoderated school social feed, fake room booking, facial recognition, or a second POS connector framework. Finish menu empty/stale behavior before marketing “live menus.” Social remains excluded from the picker until it does more than “Coming soon” (`WidgetRenderer.tsx:4791`).

## Checks actually executed

| Check | Result | What it does not prove |
|---|---|---|
| Registry integrity + derived inventory | PASS: 720 variants / 92 types / 0 collisions / 0 missing renderer functions | Rendering, editability, data or hardware readiness |
| Font-ceiling guard | PASS against baseline: 287 files, **152 existing capped ceilings** | No typography debt; threshold is not flagship acceptance |
| Inset serialization guard | PASS: 346 files, 0 confirmed landmines; **5 conservative manual-review flags** | Full Taurus safety or actual hardware qualification |
| Git status before audit | Clean | Deployed version or CI status |

No tests were represented as passing merely because test files exist. The companion inventory uses **U (unverified)** rather than invented A–F scores where no full edit/render evaluation occurred. Closing §19 requires the implementation test matrix, not a larger spreadsheet of guessed grades.
