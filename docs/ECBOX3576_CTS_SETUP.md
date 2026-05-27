# ECBox3576 + CTS Gen 6 + NovaStar VX400 Pro — install guide

> **2026-05-27 — superseded for new sports-vertical installs.** The
> **Goodview EP6N** is now the canonical sports player — see
> `docs/EP6N_HARDWARE_EVAL.md`. Same RK3576 SoC family + Android 14
> so the APK ships unchanged, but the EP6N adds dual native RS232,
> GPIO IN×2 / OUT×2 (fire-alarm + panic-button hardwiring + status
> lamp output), HDMI IN (broadcast capture), RJ45 in+out passthrough,
> 12 V aux out, 6 TOPS NPU, all-aluminum passive cooling, 24/7 duty
> rating. This guide remains accurate for the ECBox3576 — keep it
> for the existing water polo install, for budget pilots, and for
> legacy deployments.

---

This is the one-box water-polo ribbon stack. Reads CTS Gen 6 RS232
output directly from a Phoenix terminal, renders the ribbon template
in our Player APK, pushes HDMI to a NovaStar VX400 Pro processor
driving the LED ribbon.

Supersedes the previous Beelink + USB-RS232 dongle setup. Same web
app (`/ribbon/<gameId>`), same orchestrator, same celebrations —
only the bytes path changes.

## Bill of materials (single-box install)

| Item | Quantity | Approx cost | Notes |
|---|---|---|---|
| Goodview ECBox3576 | 1 | ~$300-400 | Already in your hardware portfolio |
| HDMI cable, 6ft | 1 | $10 | Ships with the box |
| Custom CTS cable: 1/4" mono → 2-pin Phoenix plug | 1 | $20-30 | See "Cable spec" below |
| 12V/2A power supply (DC barrel 2.0mm) | 1 | $15 | Ships with the box |
| NovaStar VX400 Pro processor | 1 | (existing) | Customer-owned |
| LED ribbon | 1 | (existing) | Customer-owned |

Total *added* BOM vs. existing AV stack: ~$320-450, vs. ~$215 for the
Beelink path. The premium pays for: one box vs. two, native RS232 vs.
USB-serial dongle reliability, industrial chassis, same vendor as
the rest of the AV setup.

## Cable spec — CTS 1/4" mono → Phoenix terminal

The CTS Gen 6 console emits standard RS232 voltages (±12V) on a 1/4"
mono (TS) jack:
- **Tip** — data (TX out of the console, RX into the player)
- **Sleeve** — ground

ECBox3576 Phoenix Terminal 1 pinout (per spec, Chapter 4.2):
- **Pin 3** — `232_R10` (RS232 receive — connect to console's TX)
- **Pin 5** — `GND` (connect to console's sleeve)
- All other pins on Terminal 1 — leave unused for the water-polo install

Cable build:
1. Order from any AV cable shop ("1/4" TS to bare wire, 6ft, shielded")
2. Strip + tin the two conductors
3. Crimp into a 2-pole Phoenix MC 1,5/2-ST-3,81 plug (Phoenix Contact
   1803578 or compatible)
4. Pin 3 → tip wire, Pin 5 → sleeve wire (verify with continuity
   meter before plugging in)

Order 5 cables; one for the customer, four spares (cables are the
single most common AV install failure point — always carry spares).

## APK provisioning

The Player APK ships native serial support starting at version v1.0.73+.

### One-time setup

1. **Flash Player APK** on the ECBox3576 via Manager APK (same OTA
   process as every other VenueOS box).
2. **Pair the box** to a tenant + screen via the dashboard pair-code
   flow.
3. **Pick the ribbon template** for the screen — assign
   `CTS Water Polo Ribbon` as the screen's playlist OR set
   `Game.ribbonTemplateId` to the template and bind the screen to
   that game.
4. **Grant /dev/ttyS* read access** (see "Permissions" below — one of
   three paths).

### Per-game day

The CTS-aware UI is the existing Sports → Game console. No
CTS-specific flows. Operator just:

1. Open `/sports/<gameId>` on a phone
2. **Run game** tab → tap +/- to update score, or let the CTS bridge
   update it automatically as the console emits scores
3. **Celebrations** panel → set FIRE TO Ribbon → tap GOAL when a
   goal scores → cinematic plays on the ribbon

The CTS bridge silently feeds bytes in the background. If the cable
yanks, the bridge auto-reconnects after 2s and the operator-facing
panel never knows.

## Permissions for /dev/ttyS*

The Phoenix terminal RS232 maps to a Linux tty (typically `/dev/ttyS1`
on RK3576, but verify with Goodview's device tree — see Phase 2 task
#136). On stock Android, `/dev/ttyS*` is `root:dialout 0660` — our
APK runs as `u0_aXX` and can't open it.

Three viable paths:

### A. Device Owner provisioning (recommended for production)

The Manager APK is already provisioned as Device Owner for OTA
self-install. Device Owner can `su -c "chmod 0666 /dev/ttyS*"` on
every boot.

**Setup:**
1. Factory-reset the ECBox3576
2. During first-boot setup, scan the QR code for VenueOS Device Owner
   provisioning (Manager APK does this via Phase 3)
3. The Manager APK runs a boot-completed receiver that chmods the
   ttyS devices to 0666
4. Player APK opens `/dev/ttyS1` normally

### B. Goodview kernel image with relaxed permissions (cleanest)

Ask Goodview for an OEM build of their image where `/dev/ttyS1` +
`/dev/ttyS2` ship as 0666 mode. Most signage hardware vendors offer
this for AV-installer customers. One vendor email + one custom OTA
update; done forever.

### C. Goodview RS232 SDK (if/when available)

If Goodview ships an AIDL service like `com.goodview.serial.IPort`
that exposes RS232 to non-root apps, swap `SerialPortBridge.kt` to
call that service instead of doing file IO. Same JS surface either
way — only the Kotlin internals change. Ask Goodview's developer
relations team if they have one.

## Hardware verification (Phase 2 task)

When the box arrives:

```bash
# SSH or `adb shell` into the box (Device Owner provisioning gives
# you adb access; Manager APK ships with a debug-build adb backdoor
# during install + bring-up).

# 1. List all tty devices to verify which Phoenix terminal maps where
ls -la /dev/ttyS*

# 2. Probe each one for activity with the CTS console plugged in.
# stty configures the port to 9600 8-E-1; cat dumps incoming bytes.
stty -F /dev/ttyS1 9600 cs8 parenb -parodd -cstopb raw -echo
cat /dev/ttyS1 | xxd | head -10
# (If bytes appear → you found the right port. If not, try ttyS2,
# ttyS3, etc.)

# 3. Verify pinout end-to-end by sending a known byte FROM the
# console (e.g. fire the "clock reset" button on the CTS), confirm
# the matching module-address byte arrives.
```

Once the port is confirmed, set the ribbon's URL with the override:

```
https://venue-os.app/ribbon/<gameId>?ctsTty=/dev/ttyS1&ctsBaud=9600&ctsParity=even
```

Or persist the choice in the APK SharedPreferences (Phase 3 will
add a Settings UI for this).

## URL query overrides (ad-hoc testing)

The web layer reads these from the player URL — useful for one-off
tests without redeploying:

- `?ctsTty=/dev/ttyS2` — pick a different tty (default `/dev/ttyS1`)
- `?ctsBaud=19200` — change baud rate (default 9600)
- `?ctsDataBits=7` — change data bits (default 8)
- `?ctsStopBits=2` — change stop bits (default 1)
- `?ctsParity=odd` or `?ctsParity=none` — change parity (default even)

## Operator panel — what it shows

The bridge panel in the corner of the player surface:

- **Native mode (ECBox)** — auto-connected, no buttons. Just a green
  dot + live bytes/sec + "Phoenix terminal — /dev/ttyS1".
- **Web Serial mode (Beelink fallback)** — Connect / Disconnect
  buttons. Operator clicks Connect once on install day; Chrome
  remembers the port grant for subsequent boots.

Same panel either way; the operator can tell at a glance which mode
they're in.

## What stays the same vs. the Beelink path

Every layer above the bytes path is unchanged:

```
[ /dev/ttyS1 (ECBox)   ]
              OR        ──→ SerialPortBridge (native)
[ Web Serial (Beelink) ]    OR Web Serial Reader (web)
                              ↓
                       CtsParser (browser-safe, @cms/scoreboard-cts)
                              ↓
                       POST /screens/:id/game-state (signed)
                              ↓
                       API → Redis pub/sub → WS
                              ↓
                       Player → window CustomEvent
                              ↓
                       CtsCelebrationOrchestrator + scoreboard widgets
                              ↓
                       HDMI → NovaStar VX400 Pro → LED ribbon
```

So testing one path tests the other — the bytes path is the only
thing that varies.

## Failure modes + recovery

| Failure | Symptom | Recovery |
|---|---|---|
| CTS cable yanked | Native panel shows `disconnected`; orchestrator stops auto-celebrating | Auto-reconnects after 2s; manual cues from Celebrations panel still work via /sports/board feed |
| CTS console powered off | Same as cable yank | Power CTS on — auto-reconnect kicks in within 5s |
| `/dev/ttyS1` permissions revoked (kernel update?) | Panel shows `permission_denied` with actionable error | Re-apply Device Owner provisioning (path A above) |
| ECBox loses power | Whole ribbon dark | UPS recommended for game-day; HDMI re-handshakes on boot |
| Ribbon template not picked | Ribbon shows generic default | Re-bind `Game.ribbonTemplateId` to `sports-cts-water-polo-ribbon` in /sports/setup |

## Phased rollout

This doc covers Phase 1 (the core capability — shipped today).
Subsequent phases:

- **Phase 2** (`#136`) — hardware bring-up + cable spec verification on real ECBox3576 + Device Owner provisioning runbook
- **Phase 3** (`#137`) — APK settings UI for serial config + status overlay + auto-reconnect polish
- **Phase 4** (`#138`) — production dress rehearsal with a real CTS console + customer go-live runbook
