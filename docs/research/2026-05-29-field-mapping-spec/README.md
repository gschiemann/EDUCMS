# Field-to-system mapping — build spec (research workflow, 2026-05-29)

Operator ask: *"the editor should allow you to map the fields that are
mappable to the correct system — for sports it would be the integrations we
have like CTS; for a menu you should be able to select the field then select
the POS system's corresponding field that you want mapped to it. Do some deep
research and find out how the best in the world offer this mapping workflow
and lets build it."*

Produced by a 6-agent Workflow (4 best-in-class web lanes: iPaaS / signage /
sports-broadcast / POS-menu + 1 VenueOS codebase lane → 1 synthesis).
**Full spec + raw research: `raw-workflow-output.json` (110 KB) + `SPEC.md`.**

## Headline recommendation
Reject Boomi-style two-column drag-line canvas (lowest conversion for non-IT
operators). Copy **Zapier/Workato dropdown-of-fields + inline pill + live
sample value in the picker**, **Singular's click-a-property-to-bind**, **vMix
auto-match-by-name**, **Segment required-first + live-output preview +
coalesce fallback**. VenueOS edge: the editor already renders widgets live
(free "test event") and already owns signed pub/sub (competitors poll).

## ⭐ OPERATOR'S REFINED MODEL (2026-05-29 — this is the primary flow, supersedes per-field-first)
Greg: *"the home/away drop down makes no sense ... the mapping should be very
clear: i should be able to pick the MAIN integration for the entire template,
then we default to the standard mapping fields that we think are correct, but
the user can go update it if they want it mapped to a different field in the
system we're integrating with."*

So the flow is **template-level first, defaults auto-applied, per-field override**:
1. **One template-level picker** at the top of the editor: **"Driven by: [ CTS · Score feed ▾ / POS — Toast / None ]."** Pick the integration for the WHOLE template once.
2. On pick, **auto-apply the standard field mappings** we ship per widget (`bindableFields[].defaultSource`) — homeScore→home_score, clock→clock, homeName→home team, etc. The board is live immediately, zero per-field work.
3. **Per-field override (optional):** each mapped field shows what it's bound to with a small "↪ home_score" chip; click it to repoint to a different field in that system. This is the "user can update it if they want a different field" path.
4. **The home/away dropdown is REMOVED** — "which side" is decided by the standard mapping (the home-score element maps to the feed's home score). No manual side-picking.

The per-field ⚡ affordance below is the OVERRIDE surface (step 3), not the primary entry. Primary entry = the one template-level integration picker.

## UX (fits the existing left Properties panel)
- A per-field **⚡ data-plug icon** on the existing `StyleableField` (only on
  fields a widget declares **bindable** — a font-color field never shows it).
- Three states: **Unmapped** (static input) · **Mapped+live** (green pill,
  live sample inline) · **Mapped+offline** (amber pill, shows the fallback
  the screen renders — never blank).
- **Binding popover**: pick system (CTS / POS-Toast / POS-Square / Sheet /
  Webhook — each with a health dot) → pick that system's field (each row
  shows its **current live/sample value**) → required **fallback** value →
  (advanced, collapsed) format chip (Currency / Uppercase / Round / Date).
- **Auto-map moment**: drop a sports template with CTS connected (or a menu
  board with POS connected) → auto-bind every name-matched field; one banner
  "Auto-filled 5 of 6 — 1 needs input." = the sub-30-second happy path.
- **Publish gate**: a required bound field with no fallback + no live value
  blocks publish ("2 fields would show blank on screen").

## Data model (NO schema migration for Phase 1)
- Binding lives in the zone's existing `cfg` JSON under `cfg._bindings[fieldKey]`:
  `{ system, sourceId?, sourceField, dataType, fallback, format?, formatArg? }`.
- Each widget declares `bindableFields[]` in `variants-register.ts`
  (key/label/type + a `defaultSource` for auto-map + a `sample`).
- A static `source-schemas.ts` seeds each source's field list + sample values
  so the picker is never empty before a real feed connects (cold-start fix).
- Resolve at render: `cfg._bindings[k]` → read live value from the source
  (sports: GameStateContext/`edu:cts-game-state`; menu: POS `listMenuItems`),
  coalesce to `fallback` when offline. Reuses the **existing signed pub/sub** —
  no new transport.

## Phased plan
- **Phase 1 (smallest shippable):** bind **sports scoreboard element fields →
  CTS feed fields** (homeScore→home_score, clock→clock, …). Reuses
  GameStateContext + the CTS bridge.
- **Phase 2:** **menu item fields → POS fields** (name / price / availability /
  86-status) via the POS connectors.
- **Phase 3:** generic data-source mapping (Sheet / REST / webhook) for any
  widget.

## Files to touch (from the codebase lane)
- `apps/web/src/components/template-builder/PropertiesPanel.tsx` (StyleableField ⚡ + popover)
- `apps/web/src/components/widgets/variants-register.ts` (`bindableFields`)
- `apps/web/src/components/widgets/source-schemas.ts` (NEW)
- `packages/api-types/src/index.ts` (`FieldBinding` types)
- sports: `widgets/sports/GameStateContext.tsx`; menu: POS connector read path
- render-time resolver shared by widgets

> Status: SPEC ONLY — not built yet. Awaiting operator go to build Phase 1.
