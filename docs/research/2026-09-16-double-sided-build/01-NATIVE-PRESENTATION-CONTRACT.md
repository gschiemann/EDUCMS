# The native contract this build did NOT implement

**Status: NOT BUILT. Deliberately out of scope for the 2026-09-16 server+web pass.**

The server and the dashboard can now model, schedule and alert two sides of one display. The
Android player still hosts exactly ONE WebView and never presents onto a secondary display — the
only `DisplayManager` use in the APK is the capability probe. So on the DH43 today, Android
OS-mirrors the built-in screen onto HDMI and **both sides show side A regardless of what the
server says side B should play.**

This document is the contract the native work must honour. It exists so the next agent implements
against a spec instead of re-deriving one.

## What the hardware is

From the read-only production evidence in
`docs/research/2026-09-15-double-sided-display/README.md`:

- ONE rk3288 board, Android 7.1.2 (SDK 25), player 1.1.17.
- **Display 0** — "Built-in Screen", 1080×1920, `isPresentation: false`.
- **Display 1** — "HDMI Screen", 1920×1080, `isPresentation: true`, `isPrivate: false`, state ON.

`isPresentation && !isPrivate` is the distinction the 2026-09-02 probe was added to make: a real
second output, not a mirror and not a virtual/overlay surface. **That exact predicate is already
implemented server-side** (`reportsSecondDisplay()` in `apps/api/src/screens/screen-faces.ts`)
and is what gates the dashboard's "Add the back side" button. The native side must use the same
predicate, so the two never disagree about whether a panel exists.

## The contract

### 1. Face → display mapping must be deterministic

`Screen.faceIndex` is an ordinal: the primary is 0, the first added side is 1.

**Map face N to the Nth eligible presentation display, ordered by `Display.getDisplayId()`
ascending.** Eligible = `FLAG_PRESENTATION` set and `FLAG_PRIVATE` clear.

Deterministic ordering is the whole point: display ids are not stable across reboots on every
OEM, but their *relative order* is, and an operator who assigns "Back = the street-facing menu"
must not have that swap after a power cut. If the count of eligible displays is smaller than the
highest `faceIndex`, host the faces you can and report the shortfall (see §6) — never silently
reassign a face to a different panel.

### 2. Each face is a SEPARATE player with its own credential

Do not share a credential, a token store, or a manifest chain between faces.

- Side B loads the same web player, pointed at its own `Screen` row.
- Its device fingerprint is `<primary fingerprint>::face<N>` (`faceDeviceFingerprint()` — the
  native side can compute this without being told it).
- **Knowing that string grants nothing.** It is a naming convention, never an authentication
  input. DEVAUTH-01 stands: fingerprint knowledge must never upgrade a credential. Side B
  registers and earns its own credential exactly like any other screen.
- **One token store per side** (player rule 3). Side B's store must be namespaced by face; a
  second writer into the primary's store re-creates the downgrade loop that the 1.1.6 program
  fixed.

### 3. A crash on one face must never take down the other — and never the alert path

Each face gets its own watchdog, its own `manifestGate`, its own `LoadOutcomeTracker` and its own
recovery ladder. Player rules 1–15 apply to each face **independently**.

The emergency path is the hard constraint: a wedged side B must not be able to delay, suppress or
queue side A's lockdown. Side B's reconcile chain must not share a lock with side A's.

### 4. The emergency overlay renders on BOTH faces

Non-negotiable, and it is the one place the "independent faces" rule is deliberately broken:

- The alert decision is evaluated per face (each face polls its own manifest and gets its own
  `isEmergency`), **but an alert on either face's tenant or group takes BOTH faces.** Life-safety
  wins over "different content".
- Emergency logic runs FIRST in `applyManifest` on each face (rule 11).
- Protective caches never clear on absence, per face.
- A cached manifest may RAISE an alert but never RELEASE one, per face — including the overlay,
  not just the native hold (deep audit F8).

The server already does its half: a device-scoped alert on either pane fans out to every pane
(`deviceScopeScreenIds`), and tenant/group alerts reach each face as an ordinary screen.

### 5. Orientation and canvas are per face

The HDMI face reports 1920×1080 while the built-in panel is 1080×1920. A panel **cannot report
how it is mounted** (the 2026-08-24 orientation limit), so each face applies its own
`Screen.orientation` and its own `canvasW`/`canvasH` from its own manifest. Never propagate the
primary's orientation onto a face — a new face is created `AUTO` precisely so the operator sets
it.

### 6. Report what is actually hosted

The dashboard currently infers "this display has two sides" from the probe inventory plus the
existence of a face row. Once the native host exists, it must report the truth: which faces it is
actually presenting, and on which display id.

Follow the existing evidence discipline (player rule 5 — never equate signals):

- A `Presentation` object existing ≠ the face is rendering. Each face reports its own render
  proof, via its own `Screen` row's `POST /screens/:id/render-proof`.
- Boot-proof, cache-status and heartbeat are **per face**, because each face is a `Screen`.
- A shortfall (a face row with no display to host it) must surface as a named, honest state —
  "no second display detected" — not as an offline screen and not as silence.

### 7. Bridge methods are a three-file atomic contract

Any new bridge method for face hosting follows the existing rule: Kotlin `METHODS` + dispatch
arm, web `NATIVE_VOID/VALUE_METHODS`, canary count in `nativeBridge.test.ts`. **A new method
stays out of `KNOWN_METHODS` until the fleet floor includes the APK that implements it**, or
manifest-less channel devices lose the call silently.

### 8. Release + qualification gates

- `android-player-apk.yml` runs `testDebugUnitTest` + `lintDebug` before any assemble.
- `apps/player/HARDWARE-QUALIFICATION.md` has **no row for this board class** (rk3288 /
  Android 7.1). Add one. Every REQUIRED check — cold install, pairing, reboot, offline recovery,
  content update, **emergency drill**, remote-only nav, OTA push, boot-proof — must PASS **per
  face**, on the DH43 itself. Never invent a PASS row; untested is `UNQUALIFIED`.
- Player release is ONE atomic push: `git push origin master player-vX.Y.Z`, via
  `scripts/release-apk.sh`.

## What the server already gives the native side

- `GET /screens/:id/manifest` on a face carries a `face` block:
  `{ index, label, contentMode, mirroredFrom }`. `mirroredFrom` is the primary's id when this
  face is showing the front's content.
- The face's manifest already resolves the right content — a MIRROR face is served the front's
  playlists by the server, so **the native side never has to implement mirroring itself.** It
  hosts a player per face and each face fetches its own manifest. That is the whole reason
  mirroring was built server-side.
- `GET /screens/:id/faces` lists the sides of a unit for any operator surface.

## Deliberately left open for Greg

- Should a face appear as its own row in the Screens list, or only nested under its display?
  (The dashboard currently nests it in the wizard and in the Sides panel, but `GET /screens`
  returns it flat, so it is visible in other lists.)
- When both sides mirror and side A is portrait, should side B follow side A's orientation or
  keep its own? **This build keeps its own** — a panel cannot report its mounting, and the two
  panels genuinely differ (1080×1920 vs 1920×1080).
- Seat/licence treatment of a second face.
