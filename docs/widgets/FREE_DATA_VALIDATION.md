# Free widget connection validation

Scope: five new automatic source connections, native controls/discovery compatibility, and Newsroom edge-spacing repair. This is not a certification of all 728 registered visual variants. The existing widget-truth backlog remains 136 findings / 106 baseline entries; no baseline was expanded.

## Evidence before release

- Real source calls returned current AirNow observations for ZIP 94583, FAA airport notices, MBTA predictions for South Station, LADOT meter states in Hollywood, and CHP incidents near San Ramon. These are provider responses, not generated fixtures. Coverage is explicitly regional where appropriate.
- 66 Chromium/WebKit render checks exercised 4K landscape and portrait, 960×244, 360×640, 1600×240 banners and builder previews with their normal animation `live=false` flag. Current data still loads in the builder. Picker thumbnails do not initiate these source connections.
- Checks measured full-zone dimensions, balanced safe margins, no body overflow, source credits and no page exceptions. Newsroom ribbon/banner and portrait checks used actual national/world news responses through a local CORS bridge to the existing production API. The new provider widgets used a local read-only service harness with actual upstream data. This is separate from later deployed-API verification.
- Backend tests cover AQI timezone/category validity and freshness, no forecast/yesterday values presented as observations, FAA restriction semantics, cancelled/skipped transit predictions, parking stale/unknown readings, regional refusal, public incident summaries, selector validation, shared-cache coalescing/expiry, failed-parse retry and unchanged global rate budgets.
- Native editor tests cover the existing appearance/field controls, real layout config writes, preservation of entered garage counts, one text-formatting workflow, hidden discovery with saved renderers intact, and transparent backgrounds / per-field styles.
- Newsroom root padding is set from widget geometry, independently of typography, so canvas resets and font changes cannot remove its safe margin. Compact masthead and headline blocks are centered within their columns.

The raw live captures, screenshots and 66-case JSON report are saved in the task's `outputs/FREE_WIDGET_CONNECTIONS_2026-10-29` artifact directory. They are time-stamped evidence, not permanently current feeds. Tests use deterministic fixtures in the repository as well as actual source/browser verification.

Local focused suites: **142 frontend tests** and **33 backend tests** passed. Registry, widget-truth, integration-truth, mobile-performance and inset-serialization guards passed. The first production preflight passed; the normal pre-push hook repeats it for the final commit.

## Release safeguards

Release remains subject to production preflight, exact-commit CI, normal protected merge and deployed API/web checks. No forced refresh, screen assignment, APK update or G24/FUH compatibility experiment is part of this change. Existing legacy player activation remains idle-or-operator. Data availability cannot guarantee parking vacancies, flight status, clear roads or an arrival time; the UI keeps source scope and qualifications visible.
