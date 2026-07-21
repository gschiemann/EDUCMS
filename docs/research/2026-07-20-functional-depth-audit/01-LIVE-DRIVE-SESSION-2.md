# Functional Depth Audit — Live-Drive Session 2 (Greg's Chrome, SUPER_ADMIN, Dodgers tenant)

**Method: rode Greg's real signed-in Chrome session on the live product (his Dodgers
sports tenant). Care protocol held throughout: no Emergency interaction, nothing published
to screens, nothing saved to the tenant — the builder run used a STARTER template's
unsaved local state and exited via Close; the workspace was left byte-identical.**

## Closed from session 1

- **Preview modal forensics → POSITIVE proof.** In a real visible browser the same
  preset preview renders completely (Record Chase Board: live race clock, heat results,
  DQ strikethrough, record-chase progress). Confirms the session-1 blank was the
  hidden-document IO-deferral artifact of the embedded pane. No product bug.

## Witnessed — grades (D / UX / F)

1. **Multi-vertical truth (§14) — A.** The SAME Templates surface on the sports tenant
   shows Scoreboards / Ribbon boards / Celebrations / Sponsors / Game day categories with
   live swim-meet boards (Record Chase, Dual-Meet Duel, Broadcast Meet) — versus the K12
   tenant's Welcome/Hallway/Cafeteria + age filters. Vertical awareness is real, not copy.
2. **Builder (v2) shell — A / A / A-.** Full panel set (Widgets/Apps/Background/Layers/
   Scenes/Properties/Brand/Review), honest starter-copy banner, canvas size + orientation
   controls, keyboard-shortcuts affordance, undo/redo toolbar.
3. **Engine-board field editing — A (the standout).** The STADIUM_MEET_BOARD properties
   panel addresses EVERYTHING (lane count, per-lane DQ reasons, record label/time/holder,
   off-the-pace note, sponsor eyebrow + name). Typing Record time 50.84→49.99 updated the
   canvas instantly INCLUDING DERIVED MATH — "+1.06 off the record" recomputed to "+1.91".
   Live data model, not string templating. Honest microcopy: unbound zones "never
   invented scores."

## THE finding — "Edit with words" (flagship chat-to-edit), P1

Repro'd end-to-end on the Record Chase starter, all screenshots captured:

1. **Compound instruction rejected wholesale.** "make the race clock gold and the event
   title bigger" → "I couldn't turn that into an edit. Try naming the change — e.g.
   'make the title bigger'…". Operators speak in compound sentences; half my request was
   the error's own example.
2. **The feature's OWN example phrase wrecks the board.** "make the title bigger" →
   proposal card "✓ Size → 72px" (does NOT say WHICH element) → Apply → the ENTIRE
   zone's typography exploded: LIVE pill became a giant blob, headers overflowed and
   wrapped, race clock + record card pushed off-canvas. Violates the standing
   typography-first rule and the auto-fit floor discipline.
3. **Recovery works.** One undo restored the board perfectly (earlier field edit
   preserved). Discard/Apply confirm loop exists. Severity therefore P1 (flagship UX),
   not data loss.

**Fix direction:** proposals must NAME the target element (and ideally preview the
delta); parser must return multiple ops for compound asks (or split client-side);
size changes must clamp through the existing auto-fit ≥floor system instead of raw
absolute px on the zone scale.

## Paper-cuts

- Canvas status hint says "Click any text on the canvas to edit its style," but on this
  engine board a canvas title click produced no visible reaction (fields are the designed
  path). Make the hint zone-type-aware or wire canvas clicks to jump to the matching
  panel field (the GALLERY hot-zones already do exactly that jump).

## Still queued (carried forward)

Settings → AI view + POS/streaming/social integration surfaces (admin access now
available), imports drive (note: file_upload tool restricted to session-shared files),
mobile-viewport pass, player pairing, screens-module isolation tranche (27 sites),
final 21×D/UX/F coverage table.
