# Double-sided displays — the build (2026-09-16)

Greg, verbatim: *"i just added our first double sided display and i need to be able to show
individual content on each side, sometimes the same but at times different so i need that
option."* And: *"when creating the playlist for double sided it should be very easy to say you
want individual content and then assign the content to each side of the display or say you want
them combined."*

Prior research (read first): `docs/research/2026-09-15-double-sided-display/README.md` and
`01-PLAYLIST-MODEL-MAP.md`. This folder is what was BUILT against it.

**Scope of this pass: data model, API, and web UX. The native Android `Presentation` host was
deliberately NOT built** — it needs hardware qualification on the DH43 itself. The contract it
must honour is written down in `01-NATIVE-PRESENTATION-CONTRACT.md` so the next agent implements
against a spec rather than a guess.

---

## The model: one face = one `Screen` row

This was already the standing decision (`docs/roadmap/ROADMAP.md`: *"one face = one `Screen`
row, always"*) and the 2026-09-15 research recommended it independently. The build follows it.

Side B is a `Screen` row linked to the primary:

| Column | Meaning |
|---|---|
| `faceOfScreenId` | The PRIMARY this row is a side of. Null on ordinary screens — which is why the whole feature is invisible to a fleet that has none. |
| `faceIndex` | Ordinal among the unit's sides. The primary is 0 (stored null); the first added side is 1. This is the number the native side maps onto presentation displays. |
| `faceContentMode` | `MIRROR` (default) or `OWN`. Null on a primary. |

**Why not one Screen with two content slots** (the alternative): every existing capability would
have to be taught about slots — schedules, playlists, emergency delivery, proof of play, render
proof, fleet grading, remote refresh, the offline cache tiers. As a `Screen` row, side B gets all
of them for free. The load-bearing consequence is life-safety: a tenant- or group-scoped lockdown
reaches side B **with no new code at all**, because it is simply another screen in the tenant.

### MIRROR vs OWN — the whole feature in one field

- **MIRROR** (the default for a newly created side) — the side resolves the **primary's**
  schedules. A side added today shows what the front shows with zero operator action. This is
  "sometimes the same", and it is the only safe default: a brand-new side with no schedules of
  its own would otherwise be black.
- **OWN** — the side resolves its own schedules. This is "at times different".

**MIRROR borrows exactly one thing: which schedules feed the content.** It does not borrow
identity. The side keeps its own orientation, canvas, device credential, render proof, proof of
play, and its own emergency resolution.

---

## Life-safety: how an alert reaches both sides

Stated explicitly because the task required proof, not assertion.

| Alert scope | How side B is reached |
|---|---|
| **Tenant** | Side B is an ordinary `Screen` row in the tenant. Already reached; no new code. |
| **Group** | Side B is created into the **primary's group**, so a group-scoped alert reaches it from the first second the row exists. Already reached; no new code. |
| **Device** | **This was the gap, and it is now closed.** `scopeId` names one `Screen` row, which on a double-sided unit is one PANE. `deviceScopeScreenIds()` expands the scope to the primary and every side (and, if the operator named a side, to its primary and siblings). Both the per-screen `ScreenEmergencyOverride` rows — what the HTTP polling backstop reads — and the signed WS fan-out now cover every pane. |

Three further guarantees, each with a test:

1. **Mirroring cannot suppress an alert.** The emergency branch of `getManifest` returns *far
   above* the mirror resolution. A mirroring side in an active emergency gets the emergency
   manifest, and the primary row is **never even read** — proven in
   `screens.face-manifest.spec.ts` ("the emergency branch returns before any mirror resolution
   happens") by asserting zero reads of the primary and zero calls to the schedule fan-out.
2. **All-clear is symmetric with trigger.** The set that goes into an alert is the set that comes
   out of it. An asymmetry here is exactly how a screen gets stranded on a lockdown nobody can
   clear (the emergency-003 bug class).
3. **No emergency safeguard was weakened.** `@AllowPanicBypass`, the audit rows, the signer, the
   scope-ownership check and the media-URL guard are untouched. The device branch gained rows and
   channels; it lost nothing.

---

## Manifest + hot cache

- The mirror resolution sits **after** the emergency branch, the sports branch, and the
  per-screen cache read — so it runs only on a cache MISS.
- `needsPrimaryForContent()` is false for every ordinary screen, so **the single-sided fleet pays
  zero extra queries**. A mirroring side costs exactly one 4-column primary-key lookup per
  rebuild.
- `faceContentMode` is **content, not telemetry** — deliberately NOT added to
  `SCREEN_TELEMETRY_ONLY_FIELDS`. `Screen` is already in `MANIFEST_FED_MODELS`, so the Prisma
  mutation hook busts the manifest hot cache and a mode flip lands on the side's very next poll.
  (Adding it to the telemetry set would have silently frozen the feature for up to 30 minutes.)
- The new `face` block is emitted **only on a face's own manifest**, so every ordinary screen's
  payload — and therefore its ETag — is byte-for-byte what it was before. **No fleet-wide 304
  bust when this ships.**
- Every field in the `face` block is a stable column value: no clock, nothing per-request. The
  "no volatile fields in the hashed payload" invariant holds.

---

## API surface

| Route | Purpose |
|---|---|
| `GET /api/v1/screens/:id/faces` | The sides of a display, plus `hardwareReportsSecondDisplay` (from the device's own probe inventory) and `canAddFace`. Accepts either the primary's or a side's id. |
| `POST /api/v1/screens/:id/faces` | Add a side. Creates a full `Screen` row: same tenant, same group, `orientation: AUTO`, `status: PENDING`, `faceContentMode: MIRROR`. Audited; syncs the Stripe seat count. |
| `PUT /api/v1/screens/:id/face-content` | `{ mode: 'MIRROR' \| 'OWN' }` on a SIDE. Audited with from/to. 400s on the primary rather than silently no-op'ing, so a UI can never believe it switched something it did not. |

Two details worth keeping:

- **A side starts `PENDING`, not `ONLINE`.** A row the server invented has proved nothing; it
  flips ONLINE when a player actually registers against it. Inventing an ONLINE screen is exactly
  the "looks healthy, shows nothing" lie the player-reliability program exists to kill.
- **`canAddFace` is false for any device that has never reported a probe inventory** — the whole
  browser fleet and every pre-probe APK. "We do not know" must never render as "this display has
  two sides". A presentation display that is `isPrivate` is a virtual surface, not a panel, and is
  refused.
- **Deleting a primary** now also deletes its sides' schedules and drops their cached device
  credentials. The face rows themselves cascade via the self-relation.

---

## The operator UX

### In the playlist wizard (Step 3) — the 30-second path

The two `Screen` rows of one display render as **ONE card**, because the operator installed one
display. On the card, one question:

```
  Entrance Display
  Double-sided · 2 sides
  [ Same on both sides ] [ Different per side ]
  [        Play this on both sides            ]
```

- **Same on both sides** (default) → one tap on "Play this on both sides". Done. The wizard
  publishes **one** schedule, to the front, because the back mirrors it.
- **Different per side** → the card opens into **Front** and **Back**, each its own tap target.
  Picking one publishes a schedule to that side only.

Two honesty rules the card enforces:

- Switching to "Different per side" changes the **display**, not just this playlist, and the card
  says so.
- A side left out is stated out loud — *"The side you didn't pick keeps whatever is already
  scheduled for it."* — rather than discovered later as a blank panel.

### Blast radius

`computeBlastRadius` now counts a mirroring side when its primary is reached. Publishing to the
front of a double-sided display reads **"Publishes to 2 screens"**, because two panes of glass
change. An `OWN` side is an ordinary screen and is counted only when picked. This lands in all
three publish surfaces at once (wizard review, publish sheet, HQ fleet modal).

### Never schedule onto a mirror

A mirroring side has no schedules of its own and none can ever be written for it, so the wizard
filters mirroring sides out of the schedule rows it creates. This matters because a picked GROUP
fans out to every member, and a mirroring back panel is a member of its front's group — without
the filter, every group publish would write a row that is stored and ignored forever (the
"editable field that reaches nothing" trap).

### On the Screens page

`ScreenSettingsSections` gained a **Sides** section. It renders nothing unless the display has a
second side or its own probe says the hardware has one — the same self-gating rule every other
section there follows. It offers "Add the back side" when the hardware reports one, and a
per-side `Same as front` / `Its own content` control.

---

## Files

| File | Change |
|---|---|
| `packages/database/prisma/schema.prisma` | +3 nullable columns, +1 self-relation, +cascade. Additive only. |
| `apps/api/src/screens/screen-faces.ts` | NEW — every rule and refusal, pure and Prisma-free. |
| `apps/api/src/screens/screen-faces.spec.ts` | NEW — 30 tests. |
| `apps/api/src/screens/screens.controller.ts` | Manifest mirror resolution; `face` block; 3 routes; delete cleanup. |
| `apps/api/src/screens/screens.face-manifest.spec.ts` | NEW — which face gets which playlist, end to end. |
| `apps/api/src/emergency/emergency.controller.ts` | Device-scope trigger + all-clear reach every pane. |
| `apps/api/src/emergency/emergency.faces.spec.ts` | NEW — an alert reaches both sides. |
| `packages/api-types/src/index.ts` | Face schemas. |
| `apps/web/src/lib/screen-faces.ts` | NEW — fold Screen rows into displays, pure. |
| `apps/web/src/lib/blast-radius.ts` | Count mirroring sides. |
| `apps/web/src/hooks/use-api.ts` | `useScreenFaces`, `useCreateScreenFace`, `useSetScreenFaceMode`. |
| `apps/web/src/components/playlists/PlaylistCreateWizard.tsx` | The one-card, one-question Step 3. |
| `apps/web/src/components/screens/ScreenSettingsMenu.tsx` | The Sides section. |

---

## Deploying it

`prisma db push` (or a migration) is required — three nullable columns and an index. **Additive
only**: every existing row reads `faceOfScreenId = null`, which is an ordinary screen, so the
deployed fleet behaves identically until an operator adds a side.

**No backfill. No migration was run against production by this work.**

## What is NOT done

1. **The native `Presentation` host** — see `01-NATIVE-PRESENTATION-CONTRACT.md`. Until it ships,
   side B is a server-and-dashboard concept: you can create it, schedule it and drill it, but the
   DH43 will keep OS-mirroring the front onto the HDMI output.
2. **Hardware qualification** — `apps/player/HARDWARE-QUALIFICATION.md` has no row for this board
   class (rk3288 / Android 7.1). Every REQUIRED check must PASS **per face** on the DH43 itself,
   including an emergency drill on both sides.
3. **Seat enforcement** — adding a side syncs the Stripe quantity but does not enforce a seat
   limit. Refusing to create a side because of seats would be a new failure mode; that is a
   product decision for Greg.
