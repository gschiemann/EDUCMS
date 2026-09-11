# Template builder — the program

Owner: Claude (lead). Standing expectation set 2026-09-11: the operator should not have
to commission audits and hand them over; continuous review is the lead's job.

Evidence behind every claim here:
- `docs/research/2026-09-11-mfa-optional/` — unrelated, listed only to avoid confusion
- Verification of audit #1 (discovery): 18 TRUE / 6 PARTIAL / 8 FALSE
- Research: Canva, Yodeck, ScreenCloud, OptiSigns, Rise Vision, Figma, Adobe Express,
  Google Slides, Wix Studio — all fetched live, cited in the workflow journals

---

## The reframe: most of this is already built, in the wrong door

Before scoping new work, what already exists and is simply not in the path:

| Already built | Where | Reachable from "New template"? |
|---|---|---|
| A 6-step guided wizard asking "What's this screen for?" | `AiIntakeWizard.tsx:368-408` | **No** |
| Six Quick Layouts with real SVG diagrams | `VariantPicker.tsx:545-626` | Buried under 28 chips |
| ~114 seeded system presets (459 preset rows) | `ensure-system-presets.ts` | Not offered at create |
| AI designer producing 3 candidate boards | `@cms/signage-design` | Separate surface |
| Brand palette auto-seeded into every new template | API create path | Invisible |

**So the dominant task is wiring and curation, not invention.** That sets the pace.

---

## The single worst line in the builder

`templates/page.tsx:1553` seeds every new template with one full-screen `EMPTY` zone.
That makes `zones.length === 1`. The only onboarding copy in the entire builder — the
"Drag a widget onto the canvas to start" card — is gated on `zones.length === 0`
(`BuilderCanvas.tsx:1000`). **It is dead on arrival for exactly the user it was written
for.** A first-time operator sees a white canvas, one unexplained rectangle, eight tiny
uppercase tabs, and ~600 live-rendered widget tiles behind 28 filter chips.

---

## What the market actually does (all four researched sources converge)

1. **Nobody opens on a blank canvas plus the full element library.** Canva opens on
   templates filtered to the chosen design type. Yodeck/ScreenCloud/OptiSigns/Rise Vision
   all open a filtered template gallery. Even Wix's "Blank Canvas" ships with a header,
   footer and one section.
2. **Exactly one question up front: canvas shape.** ScreenCloud asks name +
   landscape/portrait, nothing else. It is the only decision that cannot be deferred,
   because it filters everything after it.
3. **Background is NOT step one.** Canva hides the Background tab by default; Magic
   Background refuses to run until the design already has an element. Google Slides'
   theme → layout → placeholder model is the real expression of "background then content".
4. **28 chips is not how anyone ships a large catalog.** Canva: one search field, ~10
   named category rows each with "See all", and ONE filter button with four axes. Yodeck
   ships ~90 apps behind 10 categories. Nobody uses a chip wall.
5. **Add and Replace are never the same gesture.** Panel click always ADDS. Replace is a
   drop onto a frame, or an explicit labelled choice.

---

## Phases, in build order

### Phase 0 — correctness (in flight)
Not polish; these are wrong-content-on-a-screen bugs.
- A lost/renamed variant silently renders a DIFFERENT widget and stamps its id onto the
  zone; one path renders a blank zone on a live screen.
- Duplicate variant ids clobber silently (`retail-loyalty-qr` today), with no guard.
- The editability sweep covers 191 of 250 boards and runs in NO CI; the e2e covers 9.2%.
- CLAUDE.md is wrong by an order of magnitude (said 17 presets / ~107 boards; real 459 / 250).
- `AddSidebar` is dead code whose comment claims it is mounted and whose test passes.

### Phase 1 — the create flow (mostly wiring)
- Fix the `EMPTY` seed so the onboarding path is reachable at all.
- "New template" asks **one** question — name + orientation — then lands on a **gallery of
  real rendered presets filtered to that shape and the tenant's vertical**, with "Start
  blank" as a secondary action, not the default.
- Put the existing `AiIntakeWizard` behind "Describe it instead".
- **Vertical fallback bug:** `normalizeVertical()` defaults unknown → K12, and
  `ProfileHydrator` (the self-heal) never mounts on the builder route. Result: school
  grade-chips on a CORPORATE account. Unknown must mean unknown, not "school".

### Phase 2 — discovery (the picker)
- ~~28 chips → one search + ~8-10 named category rows with "See all" + ONE filter button.~~
  **SHIPPED 2026-09-11.** `widget-catalog.ts` holds the labels, the named categories (one is
  a catch-all so a newly-registered widget type can never go invisible) and the derived
  filter axes; `VariantPicker.tsx` renders search + a curated row + category rows + ONE
  Filters popover of at most four dropdowns. No chip rail, and no raw `SCREAMING_SNAKE` type
  can reach the screen — `friendlyTypeLabel` DERIVES a human name for anything unmapped, and
  the test asserts that over all 74 registered types.
- ~~Split **Add** from **Replace**; never overload one gesture. Kill "click to swap".~~
  **SHIPPED 2026-09-11.** Click = ADD, or FILL the seeded `EMPTY` placeholder
  (`setZoneWidget` keeps the zone's geometry; one undo step). Replace is an explicit
  labelled mode plus a labelled "Restyle" row. The "click to swap, drag to add" tooltip —
  backwards *and* false, since both gestures added — is gone. Drag still works and is never
  the only route to anything.
- ~~Curated default: 8-12 flagship cards for the tenant's vertical~~ **SHIPPED 2026-09-11.**
  `curatedFlagships()` resolves flagship widget TYPES (not brittle variant ids) against what
  the tenant can actually see, capped at 12. Per-row "See all" is the drill-down.
- **Also fixed, and it was the severity-1 the operator lost a demo to:** a brand-new
  template opened on PROPERTIES with a widgets panel showing ZERO tiles. Four links — the
  `EMPTY` seed, the sole-zone auto-select, the panel flip on any selection, and the picker's
  type-lock onto a type with no registered variants. A blank board now opens on WIDGETS with
  ~12 curated widgets, and no filter state can render an empty grid without a one-click way
  out.
- **STILL OPEN:** replace the 409 hand-drawn tile cartoons with **real renders** via the
  existing poster pipeline (`gen-template-posters.cjs` + `check-poster-freshness.cjs`). Real
  empty states, no fabricated sample content. The panel's SHAPE is now right; the tile
  artwork is still hand-drawn.

### Phase 3 — Live Data Connection model
The enabling primitive both audits converge on. Source → field mapping → preview →
refresh interval → health → last-good → stale behaviour → manual fallback →
tenant-scoped credentials → audited changes. Build this BEFORE more data widgets.

### Phase 4 — three flagship composites, not sixty
Audit #2 proposed ~60. That is the wrong scale for a product whose builder is not yet
usable, and a flagship nobody can find is worth nothing. Pick three by what RIOT actually
needs, and decide **widget vs template** per case — "School Today Board" is a composite of
six things, which in this architecture is a TEMPLATE, and `📺 Morning News` and
`🍴 Cafeteria — Today + Tomorrow` already exist.

Gates before anything is called flagship: real data source, editor exposing every
meaningful field, loading/stale/error states, offline behaviour, accessibility, and
Chromium + WebKit verification.

---

## Explicitly NOT doing
- More clock / headline / celebration / background variants. Seven types already hold half
  the catalog (SCOREBOARD 80, CELEBRATION 76, TEXT 41) while **46 of 74 types have exactly
  one variant**.
- Any flagship that depends on a connector marked "coming soon" — the integration-truth
  gate exists precisely for that.
- Shipping a widget that renders a promise it cannot keep: the Loyalty QR is a
  non-scannable placeholder, and Social Feed is a "Coming soon" card.

## Open decision for the operator
K-12 student-data widgets (attendance, honor roll, birthdays, visitor check-in) carry
FERPA exposure. Audit #2 treats "privacy-safe" as an adjective. Before any of those are
designed, that needs to be a gate with a real answer.
