# Player Hardware Qualification — on-site checklist

**Print this.** One copy per physical unit per release. When you finish, transcribe the
results into `apps/player/HARDWARE-QUALIFICATION.md` and commit; the release gate
(`scripts/check-hardware-qual.cjs`) reads that file, not this one.

```
Release under test:  player v ______________     manager v ______________
Hardware class id:   ______________________________  (from the matrix)
Unit / serial:       ______________________________
Location:            ______________________________
Tester initials:     ______      Date: ____-__-__
```

Record each check as `PASS` / `FAIL` / `NA`. A check you did not perform is
`UNQUALIFIED` — leave it, do not guess. **"It looked fine" is not a PASS.** Every PASS
below names a thing you must actually see on the glass.

---

## 0. Before you start — capture the device identity

Plug in ADB (USB, or `adb connect <ip>:5555` on panels with network ADB) and capture:

```bash
adb shell getprop ro.product.model
adb shell getprop ro.product.board
adb shell getprop ro.build.version.release      # Android version
adb shell dumpsys webviewupdate                 # WebView provider + version  <-- the one that matters
adb shell date                                  # device clock (skew breaks TLS + tokens)
adb shell settings get global http_proxy        # a set proxy explains a lot of "Connecting…"
```

Start a log capture in a second terminal and leave it running for the whole session:

```bash
adb logcat -c
adb logcat -v time PlayerWeb:D Player:D chromium:E AndroidRuntime:E *:S | tee qual-<unit>-<date>.log
```

If the unit is the Android-9 Goodview LCD whose SKU is still unknown, paste
`ro.product.model` + `ro.product.board` into the matrix note for `goodview-lcd-a9`.

**On-device API reachability probe.** Open the device's own browser (or the player's
diagnostics surface) and load:

```
https://api-production-39a1.up.railway.app/api/v1/health
```

Interpret exactly four ways — this single test separates the four failure classes that
all look identical as "Connecting…" on the glass:

| What the device shows | What it means | Next step |
|---|---|---|
| **Certificate / "connection is not private" warning** | The OEM trust store is stale or missing the issuing root; TLS chain problem. | Check the device date first (an out-of-sync clock invalidates every cert), then the OEM CA bundle / a TLS-intercepting middlebox. |
| **"Site can't be reached" / server-not-found / DNS error** | Name resolution failing on the OEM network stack. | Check the DNS servers the unit got from DHCP, try the IP directly, check for a captive portal. |
| **JSON body (`{"status":"ok",…}`)** | The network, DNS and TLS are all fine — the device *can* reach the API. The failure is inside the app: inspect the player's own `fetch`, the CORS preflight, and the device token. | Pull the logcat above and look for the failing request; this is an app-layer bug, escalate with the log. |
| **Hangs, then times out with nothing** | A firewall, transparent proxy, or OEM network policy is silently dropping the connection. | Check `settings get global http_proxy`, the site firewall egress rules, and whether a captive portal is intercepting. |

Write which of the four you got in the `boot-proof` note. It is the single most useful
line in the whole matrix.

---

## 1. `cold-install` — a wiped unit accepts the APK

1. Factory-reset the unit, or uninstall the player and manager completely
   (`adb uninstall com.educms.player`, `adb uninstall com.educms.manager`).
2. Sideload the release APK the way the field does it: USB stick + the on-device file
   manager (not `adb install`) — that path exercises the OEM installer, the "install
   unknown apps" permission, and the ABI match. Do an `adb install -r` pass afterwards
   only as a cross-check.
3. Launch it from the launcher.

**PASS looks like:** the APK installs with no `INSTALL_FAILED_*` dialog, the app appears
in the launcher, and tapping it opens the VenueOS splash — not a blank screen, not a
crash dialog. `adb shell dumpsys package com.educms.player | grep versionName` reports
the version under test.

**Common FAIL:** `INSTALL_FAILED_NO_MATCHING_ABIS` = a per-ABI APK was published instead
of the universal one. `INSTALL_FAILED_UPDATE_INCOMPATIBLE` = signed with a different key
than what's installed; uninstall first.

---

## 2. `pairing` — the code shows and the credential sticks

1. On the freshly installed app, note the pairing code on the glass.
2. Pair it from the dashboard (Screens → add/pair).
3. Confirm the dashboard shows the screen as online with the correct name.
4. Force-stop and relaunch the app.

**PASS looks like:** a legible pairing code on the glass, the dashboard flips the screen
to online within ~30 s, content (or the "no content scheduled" state) appears, and after
the relaunch the unit goes straight to content with **no second pairing code** — the
credential persisted.

**FAIL:** a pairing code re-appears after relaunch (credential not persisted), or the
dashboard shows "re-pair required".

---

## 3. `reboot-recovery` — it comes back with no human touch

1. Let it play content for 5 minutes.
2. Pull mains power (do not use a soft reboot — the field loses power, it does not tap
   Restart). Wait 30 s. Restore power.
3. Do not touch the remote. Start a stopwatch.

**PASS looks like:** the unit boots straight into the player and is showing the assigned
content again, unattended, within 3 minutes. No launcher screen left in front, no
"install unknown apps" prompt, no permission dialog waiting for a tap.

Record the time-to-content in the note.

---

## 4. `offline-recovery` — 10 minutes dark, then back

1. With content playing, pull the network (unplug ethernet or drop the AP — do **not**
   just disable wifi from a settings screen you then can't get back to with a remote).
2. Watch for a full 10 minutes.
3. Restore the network. Do not touch the unit.

**PASS looks like:** during the outage, cached content **keeps playing** (it does not go
black and does not fall back to a splash), and the reconnect/offline panel states the
truth on the glass. Within 2 minutes of the network returning, the unit reconciles on
its own — the reconnect panel clears and content is current. No re-pair, no pairing code.

**FAIL:** black screen, a stuck "Connecting…" with no diagnosis, a pairing code, or a
unit that stays offline after the network returns until you touch it.

---

## 5. `content-update` — a dashboard change reaches this glass

1. In the dashboard, change the playlist assigned to this screen (add a visibly distinct
   asset, or swap the template).
2. Do not touch the unit. Start a stopwatch.

**PASS looks like:** the new content appears on the glass within the expected reconcile
window (note the actual seconds). Then repeat once using the dashboard's "Refresh web"
push and confirm it also lands — that proves the push channel, not just the poll.

---

## 6. `emergency-drill` — lockdown reaches the glass, all-clear releases it

Coordinate first: this fires a real alert. Use a test tenant or announce the drill.

1. Trigger a **lockdown** for this screen's scope from the panic surface.
2. Watch the glass.
3. Fire the **all-clear**.
4. Repeat once with the unit's push channel degraded if you can (e.g. block the realtime
   host but leave the API reachable) — the manifest fallback must still raise the alert.

**PASS looks like:** the alert takes over the whole screen within seconds, is legible from
across the room, and stays up. The all-clear returns the unit to normal content. Nothing
half-applied, no alert that stays stuck after the all-clear.

**This is the load-bearing check.** A FAIL here blocks the release outright — do not
override it.

---

## 7. `remote-nav` — D-pad only, no touch, no mouse

Put the touchscreen out of reach (or use a unit with no touch) and use **only** the IR
remote's D-pad + OK + Back.

Walk every operator surface: the splash/connecting screen, the setup checklist, the
pairing screen, the settings/escape surface, the playback-stopped surface.

**PASS looks like:** on every one of those surfaces, (a) focus is **parked on a real
control** when it appears — not on a focusable container — (b) there is a **visible focus
highlight** on the focused control, and (c) **Back always reaches an actionable escape**;
it never silently toggles state and never traps you. You can get from any surface to the
escape surface and back without touching the glass.

**FAIL:** any surface where pressing D-pad does nothing visible, or where Back appears to
do nothing. That is the install-bricking failure class — write down which surface.

---

## 8. `ota-push` — the fleet update path

1. With the unit on the previous version, push the release from the dashboard (or wait
   out the scheduled OTA window).
2. Do not touch the unit.

**PASS looks like:** the update installs (silently, if the manager holds device-owner),
the unit relaunches on its own, `adb shell dumpsys package com.educms.player | grep
versionName` reports the new version, and content resumes without a re-pair.

**NA is legitimate** for a hardware class with no OTA channel (e.g. an LED controller
provisioned only through the vendor tool) — write the reason in the cell.

---

## 9. `boot-proof` — the screen tells the truth about itself

1. Cold-boot the unit with the network deliberately broken (unplug ethernet before
   power-on).
2. Read the glass. Then restore the network and read it again.

**PASS looks like:** while it cannot reach the server, the unit shows the boot-proof line
and the reconnect panel — a specific, readable statement of what it has and has not
proven (credential, manifest, content), **not** a bare "Connecting…" with no diagnosis.
When the network returns, that panel clears and content plays. Copy the exact text you
saw on the glass into the note, plus which of the four `/health` interpretations from
section 0 you got.

**FAIL:** a bare, indefinite "Connecting…", a blank screen, or copy that claims something
the device cannot know (e.g. asserting content is showing when nothing has rendered).

---

## Wrap-up

```
Checks PASS: ____ / 9      FAIL: ____      NA: ____
Log file:    qual-<unit>-<date>.log        WebView version: ______________
```

1. Transcribe every cell into `apps/player/HARDWARE-QUALIFICATION.md` under
   `## Release: <app> <version>`, in the form
   `PASS 2026-09-03 GS -- time-to-content 74s`.
2. Attach or archive the logcat next to the release notes.
3. Run the gate:

```bash
node scripts/check-hardware-qual.cjs player 1.1.13
```

It must print `QUALIFIED` before the release tag is pushed. If it does not, the release
is not production-ready — that is the entire point of this document.
