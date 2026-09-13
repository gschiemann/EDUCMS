# AI developer implementation handoff

Implement the proposed specifications in [DESIGNS.md](DESIGNS.md), closing [AUDIT.md](AUDIT.md) findings first. This is an implementation plan, **not changes already applied**. Names under `flagship/` and the contracts below are proposed; do not assume those modules or endpoints exist today.

## 1. Read first and preserve

Read current `CLAUDE.md`, `docs/design/FLAGSHIP-TEMPLATE-STANDARDS.md`, `docs/design/BRAND-TOKEN-SCHEMA.md` and relevant existing code. Recheck HEAD against `8d53ed24`: another developer may already have closed a finding. Inspect current dirty changes and preserve them. Code/app execution uses an isolated worktree under repository policy. Do not commit/push/deploy without the lead's normal review and authorization.

Preserve existing saved variant IDs, template zones, content fields, brand overrides and editor history. Never delete an old widget just because the picker stops recommending it. Keep existing device credentials, emergency HMAC verification, polling fallback, tenant isolation, immutable audit requirements and player recovery behavior. None of this program authorizes changes to emergency semantics or a new parallel emergency widget.

## 2. Integration map

All paths in this section are relative to the repository root. Resolve the actual mount/call site before editing. Symbols and paths may move after this audit.

| Existing point | Required work |
|---|---|
| `apps/web/src/components/template-builder/BuilderShell.tsx:1309` | Actual picker mount; verify end-to-end here, not an unmounted old sidebar |
| `.../template-builder/VariantPicker.tsx` | Keep new categorized/search/add/replace UI; consume explicit readiness/preference metadata |
| `.../template-builder/widget-catalog.ts` | Add categories for 16 “More” fallbacks; upgrade curation without losing searchability |
| `.../widgets/variants.ts` | Add backward-compatible optional metadata; retain nonthrowing registry behavior on player |
| `.../widgets/variants-register.ts` | Register real lazy renderers; don't create import cycles with WidgetRenderer |
| `.../widgets/v2/registry.ts` | Map existing definitions to explicit schemas; keep durable IDs/remaps |
| `.../template-builder/PropertiesPanel.tsx` | Replace generic object-array serialization; route flagship forms to small modules |
| `.../widgets/WidgetRenderer.tsx` | Real runtime dispatch and legacy bell logic; integrate normalized data without copying dashboard auth |
| `.../template-builder/PropertiesPanel.tsx:7154` (`StyleableField`) / existing style helpers | Reuse the actual text editing contract; extract the helper if needed rather than inventing a second protocol |
| `.../widgets/QrCodeWidget.tsx`, `qr-payload.ts` | Reuse generated QR payload/image behavior across all scan CTAs |
| `.../widgets/retail/RetailLoyaltyQRWidget.tsx` | Replace decorative QR fallback; preserve saved image URLs and layout |
| `apps/web/src/lib/data/use-custom-data.ts` | Device-safe source subscription; error/empty/stale/source-switch state |
| `apps/web/src/lib/menu/use-pos-menu-items.ts`, `device-menu.ts` | Preserve device-scoped location binding; fix empty success; evolve snapshot metadata |
| `.../widgets/use-live-feed.ts`, `feed-types.ts` | Adapt existing RSS/ICS outputs; no private feed secrets in public URLs |
| `apps/api/src/data-source/` | Extend existing normalization/protection rather than replacing it |
| `apps/api/src/feeds/` | Reuse tested parsing; add normalized timestamps and resource scoping as needed |
| `apps/api/src/pos/` | Keep provider/catalog/location logic; order-status adapter is a separate capability |
| `apps/api/src/branding/apply-brand-to-zone.ts` | Map new fields/styles and prove brand changes reach all new widgets |
| `apps/api/src/templates/*presets.ts`, `ensure-system-presets.ts` | Correct vertical preset file, `ALL_PRESETS` union and `PRESET_VERTICALS`; do not put every preset in system-presets.ts |
| `apps/web/public/templates/kiosk/` | Reuse artwork/actions where appropriate; do not confuse local simulations with persistent operations |
| `apps/web/src/app/dev/widget-lab/`, `apps/web/tools/widget-legibility/measure.mjs` | Actual render testing; portable dependency resolution and explicit typography profile |

Before choosing a new canonical widget type, trace it through `themes/registry`, shared types, API zone validation/sanitization, imports, preset generation, brand application, save/save-as, manifests and player dispatch. Prefer a versioned **variant under a compatible existing type** when semantics fit. Do not force an incompatible new capability into a type just to avoid validation work.

## 3. Foundation A — explicit widget metadata and content schemas

### Metadata

Add optional metadata without breaking old registrations. Proposed shape:

```ts
type WidgetCapability = {
  family: string;                       // e.g. 'schedule'; not its visual theme
  readiness: 'ready' | 'beta' | 'demo' | 'legacy';
  editorSchemaId: string;
  configVersion: number;
  sourceModes: ('manual' | 'ics' | 'json' | 'csv' | 'pos' | 'managed')[];
  surfaces: ('signage' | 'touch')[];
  layouts: ('landscape' | 'portrait' | 'compact' | 'ribbon')[];
  supportedTargets: ('lcd' | 'taurus')[]; // only after qualification
  preferredFor: string[];               // vertical IDs from existing types
  curationRank?: number;
  minimumZoneProfile: string;
};
```

Do not initialize every existing variant as `ready`. Missing metadata means **unqualified**, not unusable and not automatically hidden from saved documents. Demo/unsupported widgets cannot be promoted as production-ready. Builder warns on incompatible display targets; player never throws because a metadata field is absent.

Curation: explicit preferred IDs per vertical/capability → filter by actual availability and target → quality-qualified fallback in the same family → maintain 8–12 useful results. Registry ordering is not a quality score. Tests must fail on dangling preferred IDs so fallback does not conceal a removed flagship. Manual widgets can be ready; readiness is not synonymous with a paid connector.

New categories: QR/Wi-Fi under a useful “Connect & engage” group; schedule grid under Time & schedules; streaming under Photos & video; maps/room finder/touch controls under Touch & directions; birthdays/honor roll under People & recognition; menu item under Food & menus. Attendance/stat row may be under Data, clearly privacy-safe. Keep category membership single-valued and industry labels human.

### Schema registry

Proposed `apps/web/src/components/template-builder/widget-fields/` with one editor per flagship family and shared typed primitives. Shared validation types belong in `packages/api-types/src/` or the existing runtime validation package, not dashboard-only code. Choose the project's existing validation library; do not add a second one without need.

Each field declares path, label, type, constraints, default, visibility rule and editability/source ownership. Types include text, rich text subset, number, boolean, enum, asset, URL, instant, timezone, array and object. Array schemas declare an item schema and stable ID; never infer them from `defaults[0]`. Use explicit dot paths for inline editing and a typed patch merger that rejects prototype-pollution paths.

Suggested per-field contract:

```ts
type FieldOwnership = 'authored' | 'source' | 'computed';
// Sketch: implement using the repo's real validation/types.
type FieldSpec = {
  path: string;
  label: string;
  kind: string;
  ownership: FieldOwnership;
  required?: boolean;
  maxLength?: number;
  itemSchemaId?: string;
};
```

Schema validation runs on create/update/import/clone and on adapter input. Invalid legacy content should yield an actionable diagnostic while preserving the original, not a fleet-wide exception. Preserve unrelated unknown legacy keys during compatible edits; do not silently drop all fields not yet in the new schema. Unsafe unknown fields are rejected at API boundaries under existing policy.

One editor transaction covers one action for undo/redo. Async image uploads cannot overwrite later text edits. Test switching variants: same-family compatible values carry; incompatible values remain recoverable via undo and are not coerced into the new schema. A source-controlled value opens Data settings rather than appearing editable and later snapping back.

## 4. Foundation B — one source snapshot contract

The existing custom data proxy and POS/feeds modules are starting points. Add a typed snapshot layer, not eight independent polling loops.

```ts
type Snapshot<T> = {
  schemaVersion: 1;
  bindingId: string;
  revision: string;
  mode: 'manual' | 'connected';
  state: 'fresh' | 'stale' | 'empty' | 'unavailable' | 'revoked';
  data: T | null;
  sourceObservedAt: string | null;  // source event/data timestamp, not invented
  lastConfirmedAt: string | null; // successful check of relevant source state
  fetchedAt: string;               // transport time, never relabel as data update
  validUntil: string | null;
  issueCode?: string;              // safe code, not provider body/token
};
```

This is a proposed public payload; internal tenant/provider/credential metadata stays server-side. Cache entries must include full tenant, location, binding and authorization scope, not a naked URL or widget ID.

### Proposed backend flow

1. Author chooses/creates a tenant-owned source through existing integration setup. Store a binding with permitted resources and typed field mapping. Credentials are server-only references through existing secret storage—not fields in template JSON.
2. Source adapter fetches through current SSRF-safe egress machinery, with bounded size, timeouts, redirect/DNS validation, rate limits and schema validation. Reuse tested safe-fetch code. SSRF exists precisely because server-side fetching can reach resources a client should not control; see [OWASP's overview](https://community.owasp.org/attacks/Server_Side_Request_Forgery).
3. Normalize once per scope and cadence, not once per widget per screen. Use existing multi-replica coordination patterns; add shared-cache single-flight and a bounded degraded mode. Provider outages must not create a thundering herd.
4. An operator preview read uses operator authorization. A proposed **device snapshot read** uses existing device verification, live revocation/epoch checks and screen assignment. Accept only a binding assigned to that screen's published template. Never accept arbitrary external URLs or a caller-supplied tenant ID from devices.
5. Polling fallback always works; realtime notifications may announce a newer snapshot revision but do not replace authorized reads. Widget data cannot introduce new emergency control messages.
6. Authorization/source permission changes invalidate the relevant cache; revoked sensitive content must not be served as stale fallback. A sensitive cache policy has bounded expiry so an offline screen does not retain it indefinitely.

Suggested route shape **for review, not existing endpoints**: operator `GET /widget-sources/:bindingId/snapshot`; device `GET /screens/:screenId/widget-sources/:bindingId/snapshot`. Prefer existing controllers/services if equivalent routes already exist when implementation starts. New routes require API docs, RBAC tests, tenant isolation tests and gateway review; don't broaden the gateway to arbitrary admin paths.

Creation/updates/revocations of sources require a durable audit row with actor, scope, changed resource and outcome. Keep credentials/query secrets out. Use a transaction/outbox or existing durable audit pattern as appropriate; simply swallowing audit errors is not completion. Avoid creating an immutable audit record on every poll if that would turn basic screen refresh into unbounded audit growth; privileged configuration changes and security events are distinct from routine operational read telemetry.

### Client subscription and state transitions

Proposed `apps/web/src/lib/widgets/use-widget-snapshot.ts`: one shared subscription keyed by `(screen-or-preview scope, bindingId, mappingVersion)`. Reset old data immediately when scope changes. Subscribe once when several widgets use the same feed. Abort obsolete requests; don't allow a late response from source A to replace B. Poll with self-scheduling timeouts, visibility handling appropriate to editor/player, retry backoff/jitter and no overlapping requests.

```text
No config → setup/fallback
Config → loading → success(data) → fresh
                 → success([]) → empty             [not error]
                 → failure + no data → unavailable
Fresh → temporary error → stale → validUntil passed → unavailable
Any → revocation/scope switch → erase old scoped data → no stale fallback
```

Snapshot validity is independent of animation ticks. Use the established synced clock when available. Never replace sourceObservedAt with Date.now() just because the backend fetched cached data successfully. For immutable/manual content, label saved time; for operational state, confirmed time and freshness policy determine validity.

Keep the source poll cadence separate from UI clock updates. A countdown can tick locally without fetching every second. In a frame-synchronized context, time-based rendering must derive from the shared timeline, not random intervals.

### Data model decisions

Before proposing new database models, inspect current source/connection, queue, asset approval and template schemas. Extend a compatible existing model. Only add missing models for durable queue events or content collections after this check. Migrations must be additive with backfill and rollback; no `db:reset`, destructive schema push or unilateral production SQL. Maintain tenant ownership and composite uniqueness where needed. Query/data-store implementation gets a separate security/performance review.

## 5. Deliver per-family modules

Proposed directory map (all paths below under `apps/web/src/`):

```text
components/widgets/flagship/
  ScheduleWidget.tsx
  AnnouncementStoriesWidget.tsx
  RecognitionWidget.tsx
  DirectoryWayfindingWidget.tsx
  QueuePickupWidget.tsx
  DeparturesWidget.tsx
  DataBoardWidget.tsx
  CommunityWallWidget.tsx
components/template-builder/widget-fields/
  ScheduleFields.tsx ... one focused editor per family
lib/widgets/
  schedule-model.ts
  story-model.ts
  directory-model.ts
  queue-model.ts
  departures-model.ts
  data-board-model.ts
  snapshot-policy.ts
  use-widget-snapshot.ts
```

These are responsibilities, not a mandate to duplicate equivalent existing modules. Pure selection/formatting/state code stays outside React and is independently testable. Components receive normalized data and do not authenticate to providers. Type-specific asset/QR rendering stays shared. Keep lazy chunks bounded and avoid loading every family merely to show the picker.

### Registration and persistence checklist — every family

1. Define versioned config, explicit content schema, defaults with no unmarked sample identities, and migration/adapter for old fields.
2. Implement pure model, fixture tests and all state variants before wiring a connector.
3. Create the approved HTML design through the project's one-design-at-a-time review loop. This handoff does not waive that approval.
4. Port exact approved geometry to measured React rendering; register a stable ID, correct vertical metadata and actual live renderer. `previewOnly` is true only when the real runtime dispatch is separately wired.
5. Mount editor through the active PropertiesPanel; keep inline field selection and array controls coherent. Add real upload controls, not URL-only text boxes for photos.
6. Verify create → edit → undo → redo → save → reload → duplicate/save-as → playlist → manifest → device render. Inspect every sanitizer so binding/configVersion/variant are not lost.
7. Update server brand application, preset generation and AI/import allowlists only where required. AI may emit only supported schemas; it cannot create arbitrary provider credentials or approved content.
8. Add the preferred catalog entry only after tests and actual target qualification. Connected mode remains unavailable until a provider/account is truly configured.

### HTML template lane

If a deliverable is an EXTERNAL_HTML board rather than a React widget, do **not** copy the React registration process blindly. All text needs `data-field`; image areas need `data-imgslot`; brand tokens follow the canonical schema. Current shim authority is `apps/web/scripts/inject-shim-v2.cjs`, marker **EDUCMS-SHIM-V13** at audit time; old design documentation may say V5. Menu boards use the additive menu-compatible shim and must preserve `applyMenu`; kiosks use their dedicated shim/action protocol. Keep null-origin iframe sandbox restrictions and source-window/message validation. Do not add `allow-same-origin` to make an integration work.

Browser bridge tests must prove edits and brand changes affect the actual iframe and survive save/reopen. Preview simulation attributes/timers cannot run in production. No user-generated HTML/JavaScript execution is introduced by this widget program.

## 6. Migration and retirement

- **Fix in place where semantic correction is clear:** loyalty QR placeholder, structured-array editor, legacy bell NOW, misleading fixed freshness strings and valid empty-menu handling.
- **Version where semantics/layout change materially:** new Schedule/Queue/Community designs get new stable variant IDs until an operator previews and accepts the change. Keep old renderers for old saves.
- **No mass delete/rename:** zero registry collisions now; preserve both distinct retail QR IDs. Do not resurrect a collision or remap all old users to an unintended renderer.
- **Offer a migration preview:** old → new snapshot side by side, enumerate changed fields, verify data binding and record acceptance. If a legacy array was already saved as strings, preserve the original and flag repair; do not guess object fields from comma splitting.
- **Retire from recommendations first:** demo-only interactions, nonworking social placeholder and unqualified live-data visuals. Still load old documents and show a useful authoring warning. Player fallback must be deliberate, not a silent wrong-variant substitution.
- **Rollback:** a flag removes the new picker recommendation/new create flow; it must not make already-saved new widgets unreadable. Keep schema readers backward-compatible and deploy adapters before activating new configs. No runtime registry throw as a gate.

## 7. Test plan and definition of done

### Editability grade for each production candidate

Grade A: every applicable standard passes including inline editing, content/style/assets/list operations, persistence, target legibility and operational states. B: usable with only documented nonessential gaps. C/D: substantial operator workarounds or missing functionality. F: misleading/nonfunctional core behavior or destructive editing. U: not tested. The project disallows below-B widgets at launch; **flagship promotion should require A**. Do not assign A from a unit test or a screenshot alone.

| Layer | Required evidence |
|---|---|
| Registry | Unique durable IDs, callable renderer, valid schema ID, valid defaults, supported vertical/category, no dangling preferred IDs |
| Model | Fake clock, timezone/DST, ordering, expiry, zero/null/empty, invalid input, overflow policy, deterministic output |
| Editor | Every schema field reachable; structured arrays stay typed; photo replacement/crop; brand link/reset; inline selection; undo/redo |
| Persistence | Saved values exact after reopen, duplicate/save-as, publish and manifest serialization; version migration preserves original |
| Source | First load, genuine empty, stale, timeout, 401/403/429/5xx, revoked credential, source switch, duplicates/out-of-order data |
| Security | Cross-tenant and cross-location denial; revoked device denied; no secrets/PII leakage; SSRF redirect/DNS/cap controls; stored XSS; audit durability |
| Visual | Real browser at landscape/portrait/compact dimensions, long copy, missing image, different fonts, 200% text scale in editor, low-contrast tenant brand |
| Touch | Keyboard/screen reader, visible focus, no success until acknowledged, idle reset, actual physical target size and reach |
| Player | No dashboard session; offline boot/cache/expiry; reconnect; authorized source only; no demo fallback; no new runtime crash |
| Compatibility | Chrome + WebKit dashboard/preview; qualified physical Taurus for its advertised variants; modern LCD visual fidelity retained |
| Performance | Shared polling, bounded rows/media, source dedup, timer cleanup, no hidden-tab editor polling, no unbounded memory over a soak |
| Emergency | Existing drill/trigger/all-clear test on a nonproduction controlled screen; new widgets never cover or intercept emergency overlay |

Do not trigger a live school's emergency system as part of an ordinary widget test. Use isolated test tenants/screens and explicit authorization for any operational drill.

Specific required regression tests:

1. `room-schedule` and `wait-times-board`: nested record edit round-trip; no object → string conversion.
2. Legacy bell: current period selected by actual configured interval at a non-hour boundary.
3. Room schedule: no “32 min” constant; stale never OPEN; private event title removed from public payload.
4. Wait/transit: last-confirmed time remains unchanged across unrelated renders.
5. Loyalty/general QR: actual pixel decode from both modern and legacy variants, no decorative code after entering copy only, four-module minimum quiet zone, and no clipping in tall/narrow zones.
6. Menu: `[]` clears previous results; error preserves permitted stale data; sample prices never replace connected content.
7. Source: paired player without dashboard auth succeeds only for its assigned binding; revoke and cross-tenant fail.
8. Community: pending/rejected/expired entries never appear in published snapshots.
9. Directory: no route through closed/stair-only edge under accessible mode; noninteractive mode offers no pretend buttons.
10. Queue: two clients, conflicting revisions, reload and network failure; no fictional success toast.

### Tooling and commands

Run in the isolated implementation worktree with dependencies installed. Verify current script names first; these existed at the audited commit. Do not run broad lint commands that auto-fix unrelated code during a read-only audit.

```sh
node apps/web/tools/check-variant-registry.cjs
node apps/web/tools/check-font-ceilings.cjs
node apps/web/tools/check-inset-serialization.cjs
node apps/web/tools/check-taurus-safety.cjs
pnpm mobile-perf-guard
pnpm --filter web exec jest --runInBand --runTestsByPath <actual-new-test-paths>
pnpm --filter api exec jest --runInBand --runTestsByPath <actual-new-api-test-paths>
pnpm --filter web run test:e2e:widget-render
pnpm preflight
```

Placeholder test paths above must be replaced with real newly-added files; they are not runnable literally. The new test suite must exercise the active builder route, not just isolated components.

For visual measurement, first fix the tool's absolute Playwright import to resolve the workspace-installed dependency. Start the app only in the worktree and run the lab against that local port. Example **after** the portability fix, with a real report directory:

```sh
LAB_BASE=http://localhost:3100 LAB_W=3840 LAB_H=2160 LEGIBILITY_FLOOR=50 OUT=/tmp/widget-flagships-landscape.json node apps/web/tools/widget-legibility/measure.mjs
LAB_BASE=http://localhost:3100 LAB_W=2160 LAB_H=3840 LEGIBILITY_FLOOR=50 OUT=/tmp/widget-flagships-portrait.json node apps/web/tools/widget-legibility/measure.mjs
```

A single floor does not check the separate 60px body requirement; extend role-aware measurements and inspect screenshots. Rerun at the actual composed zones and kiosk profile. Blank-background media widgets require appropriate content fixtures; a textless shape is not a failure. Save screenshots and machine-readable results with commit, browser/OS, dimensions, content fixtures, source mode and failures. The developer's result must include counts attempted/passed/failed/skipped; crashed or unexecuted cases are not passes.

After authorized push, watch actual CI to completion and verify deployed build identity and page behavior. Preflight alone is insufficient. This design handoff itself made no push and has no claim of green deployed CI.

## 8. Delivery sequence and gates

| PR / milestone | Scope | Exit gate |
|---|---|---|
| 0 — Corrections | W01/W02/W03/W05/W11: lists, truthful labels, QR reuse/geometry, empty menu | Targeted regression tests + preview of affected saved variants |
| 1 — Catalog/schema foundation | Explicit content schemas, readiness, categories, preferred IDs | Full catalog coverage test; old saves unaffected |
| 2 — Source foundation | W04/W10: device snapshot read, scope, credentials, durable privileged audit | Tenant/device/security contract suite; empty/stale/revoke tests |
| 3 — Schedule | F01 manual + ICS, upgraded time model, approved design | Actual builder→player test; irregular schedules + real dimensions |
| 4 — Stories and recognition | F02, then F03, one design approval at a time | Assets, all text editing, scheduling and privacy tests |
| 5 — School Today pilot | Composed preset using qualified existing menu and new widgets | Teacher completes named happy path; real approved display test |
| 6 — Operational expansions | F04 Directory, F05 Queue, F06 Departures | Each has real source/authority, empty/offline policies and named owner |
| 7 — Data Board | F07 shared source mapping + metrics/tables | No dashboard auth dependency; truthful math/freshness |
| 8 — Community | F08 approved CMS media first | Moderation, rights, deletion and cache-expiry review |
| Later — Vendor connections | Private calendars, queue/order providers, school fleets, external social | Named provider contract, current permissions/rights and sandbox qualification |

Do not batch all eight into one giant PR. No calendar write scopes, POS order writes, visitor identity collection or public uploads should be added as incidental requirements of these display widgets. Each expands the threat model and needs explicit product review.

## 9. School privacy and operational boundaries

“A teacher uploaded it” is still content the system must protect. Terms and conditions are not a substitute for access controls, minimization, approvals, retention, deletion, tenant isolation and safe display defaults. This document does not establish compliance with any particular law; involve the organization's privacy/legal reviewers for nationwide school deployment.

Default to no individual attendance data, student-to-route mappings, student directories, patient details, visitor contact details or birth years in a public-screen snapshot. For explicitly authorized photos/names, provide approval and removal workflows. Prevent confidential calendar subjects and provider tokens reaching the browser at all. Shared displays should receive only the minimum public presentation data—not full records hidden with CSS.

Operational widgets are not certified life-safety systems, clinical triage tools, evacuation planners or authoritative attendance systems. Keep those boundaries in product copy and sales claims. Marketing must not call a local demo “live,” an imported spreadsheet “real-time,” or a mockup “connected.”

## 10. What the implementing developer must return

- Commit(s), exact files changed and migration/rollback notes.
- Before/after images of the **same saved template**, plus approved design comparison.
- For every flagship: fields tested, supported dimensions/targets, source modes, state tests and unresolved gaps.
- Registry and runtime totals; test commands, actual outcomes and skipped reasons.
- A short video or browser trace of a non-IT operator's intended add/edit/save/publish flow.
- Device-only auth proof and privacy/security tests for new source capabilities.
- No “done” if source bindings, portrait, save/reopen, real QR decoding or actual target qualification remain untested.

Suggested implementation prompt:

> Read CLAUDE.md and the 2026-09-11 widget-flagships handoff. Revalidate the listed findings against current HEAD. Work in an isolated worktree and implement milestone 0 only: structured-list preservation, accurate schedule/freshness behavior, reuse real QR generation in the legacy loyalty widget, and distinguish empty POS data from failure. Preserve all saved variant IDs and user content. Add targeted regression tests and verify affected templates in the actual builder/player render path. Return the diff, test results, screenshots and remaining gaps for review; do not deploy or expand to all eight flagships.
