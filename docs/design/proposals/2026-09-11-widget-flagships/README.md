# VenueOS widget audit + flagship implementation brief

2026-09-11 · Checkout `8d53ed24` · Documents only; no application changes or deployment.

**Recommendation: improve the core experiences, not the raw widget count.** The current registry has 720 variants across 92 types. The picker redesign, real QR/Wi-Fi widgets and additional discoverable types are in code. The remaining work is trustworthy data, correct editing, legibility, target qualification and focused flagship design.

## Read in this order

1. [Audit — fixed, remaining and evidence](AUDIT.md). Eleven actionable findings; exact executed checks and explicit coverage limits.
2. [Eight flagship design specifications](DESIGNS.md). Wireframes, exact layout geometry, portrait/compact behavior, fields, source requirements, state behavior and per-widget acceptance criteria; also School Today as a composed preset.
3. [AI developer implementation instructions](IMPLEMENTATION.md). Shared contracts, integration files, security boundaries, migration, phased PRs, test gates and a scoped starter prompt.
4. [Complete registry inventory](INVENTORY.md). All 720 registrations. Unverified fields/rendering are marked U, not given invented passing grades.

## Fix before expanding

- Structured-list editing can convert room events and wait rows into strings.
- Some room, bell, wait-time and transit status/freshness text is hard-coded or computed incorrectly.
- Legacy loyalty QR still has a decorative fallback; the new QR needs tall/narrow layout and quiet-zone qualification.
- Custom data uses dashboard authentication rather than a device-scoped snapshot read.
- A valid empty POS menu can retain old items.
- Some touch presentations simulate operations; they need a truthful readiness distinction.
- Flagship selection needs qualification metadata; baseline-passing typography is not universal legibility.
- Provider spotlight needs a real photo slot; source configuration needs durable audit and credential-safe handling.

## Design scope

| School-first | Shared operational capabilities | Later, gated addition |
|---|---|---|
| Schedule: Now / Next | Directory & Wayfinding | Moderated Community Wall |
| Announcement Stories | Queue & Pickup | External social providers only after qualification |
| Recognition Spotlight | Departures & Dismissal | Private-calendar and vendor-specific feed adapters |
| School Today composed template | Data Board | No speculative connector promises |

The eight capability specifications mostly upgrade existing work. **They are detailed proposed designs, not approved visual mockups or finished widgets.** The next implementation step is milestone 0 fixes, then the project's one-widget-at-a-time visual approval loop for Schedule. Do not skip that loop and claim the full set is shipped.

## Evidence boundary

Executed: real registry load/inventory, font-ceiling guard, inset-serialization guard. Reviewed: active picker/editor/render paths, selected widget implementations, custom/ICS/RSS/POS data paths and example kiosk simulations. Not executed: live-browser tests, all 720 individual editability tests, real hardware qualification, provider-account tests or penetration testing. The report explicitly distinguishes code findings from those unverified outcomes.
