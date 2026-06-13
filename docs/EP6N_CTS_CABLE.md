# EP6N → CTS Gen 6 cable — single-sheet install spec

> One page. Build the cable. Plug it in. CTS is talking to the player.

The Goodview EP6N has TWO native RS232 ports + RS485 + GPIO on a single
Phoenix-terminal block. CTS Gen 6 outputs RS232 on a 1/4" mono jack.
The cable below is the bridge — total parts cost ~$20, total build time
~10 minutes per cable.

This is the canonical CTS install path for new sports-vertical deploys.
For the legacy ECBox3576 install path (single RS232, different pin
mapping), see `docs/ECBOX3576_CTS_SETUP.md`.

---

## What you need

### Tools
- Wire strippers
- Soldering iron + solder (or a quality crimp tool)
- Continuity meter / multimeter
- Small flathead screwdriver (for the Phoenix plug cage clamp)

### Parts (per cable — order 3-4 cables for one install)

| Part | Source | Approx cost | Notes |
|---|---|---|---|
| 1/4" mono (TS) to bare wire, 6 ft, shielded | Any AV cable shop / Amazon / Monoprice | $15–20 | Search "1/4 inch TS to bare wire" |
| Phoenix terminal plug | **Ships in the EP6N box** — 1 plug × 1 unit | $0 (included) | Reference: see "Phoenix plug" below for replacements/spares |
| (optional) Cable strain-relief boot | Any AV shop | $2 | Nice-to-have for permanent installs |

**For spares**, order 4 Phoenix Contact replacement plugs in the model
the EP6N ships with. Confirm the exact model number with Goodview
support before quantity ordering — the EP6N's terminal block is a
**12-pin 2×6 layout** that uses a larger plug than the ECBox3576's
2-pin MC 1,5/2-ST-3,81. The most likely SKU is the **Phoenix Contact
MC 1,5/12-ST-3,81** (12-pin, 3.81 mm pitch, screw-clamp). Order via
Digi-Key / Mouser / your usual distributor.

---

## Pin map (from the Goodview EP6N V1.0 spec sheet)

The Phoenix terminal is **two rows of six pins each**. Looking at the
rear of the unit:

```
 ┌─────────┬─────────┬───────┬───────┬───────┬───────┐
 │   B-    │   A+    │  RX   │  TX   │  RX   │  TX   │   ← TOP ROW
 │ RS485 ──┴── RS485 │ RS232-1 ─┴─ RS232-1 │ RS232-2 ─┴─ RS232-2
 ├─────────┼─────────┼───────┼───────┼───────┼───────┤
 │  OUT1   │  OUT2   │  IN1  │  IN2  │  GND  │  12V  │   ← BOTTOM ROW
 │   GPIO outputs    │   GPIO inputs   │ shared│  aux  │
 └─────────┴─────────┴───────┴───────┴───────┴───────┘
```

Pin numbers (counting left-to-right on each row, top row first):

| # | Label    | Row | Use |
|---|---|---|---|
| 1 | B-       | top | RS485 (Daktronics All Sport, future) |
| 2 | A+       | top | RS485 |
| 3 | **RX**   | top | **RS232-1 receive (data INTO the player)** |
| 4 | TX       | top | RS232-1 transmit (unused for CTS) |
| 5 | RX       | top | RS232-2 receive (unused — leave for future) |
| 6 | TX       | top | RS232-2 transmit (unused) |
| 7 | OUT1     | bot | GPIO output (status lamp, etc.) |
| 8 | OUT2     | bot | GPIO output |
| 9 | IN1      | bot | GPIO input (fire-alarm dry-contact, etc.) |
| 10| IN2      | bot | GPIO input |
| 11| **GND**  | bot | **Shared ground for all RS232 / RS485 / GPIO** |
| 12| 12V      | bot | 12 V aux power output |

---

## The cable — exactly two wires

```
       CTS Gen 6 console                  EP6N Phoenix Terminal
       (1/4" mono TS jack)                 (12-pin block above)
       ──────────────────                 ──────────────────────

         ┌──────┐                              ┌─────────────┐
         │ TIP  │  ────data────────────────►   │ Pin 3 (RX)  │
         │      │                              │  RS232-1    │
         │SLEEVE│  ────ground──────────────►   │ Pin 11 (GND)│
         └──────┘                              └─────────────┘
```

**That's it.** All other pins remain empty.

### Build steps

1. **Strip + tin the 1/4" mono cable's two conductors** (tip + sleeve)
   to ~6 mm of bare wire.
2. **Identify tip vs. sleeve with the meter.** Plug the 1/4" end into
   the cable, touch one probe to the tip of the jack and one to a
   stripped wire. The wire that beeps is your tip. Mark it (Sharpie /
   heat-shrink).
3. **Open the Phoenix plug.** Slot the screw-clamp gates by inserting a
   small flathead and pressing toward the rear of the plug.
4. **Insert the tip wire into Pin 3 (RS232-1 RX)** — top row, third
   from left. Tighten the screw-clamp.
5. **Insert the sleeve wire into Pin 11 (GND)** — bottom row, fifth
   from left. Tighten.
6. **Verify with the meter** — continuity from the tip of the 1/4" jack
   to Pin 3, and from the sleeve to Pin 11. Should both beep. Verify
   NO continuity between Pin 3 and Pin 11 (that would short the data
   line to ground and silence CTS).
7. **Optional: heat-shrink + boot** the wire entry on the Phoenix plug
   for strain relief if this cable will live in a permanent rack.

### Plug it in

- Plug the 1/4" end into the **DATA OUT** jack on the back of the CTS
  Gen 6 console.
- Plug the Phoenix end into the EP6N's terminal block. The plug only
  fits one way (the cage has a polarity bump).
- Power on both. Watch the EP6N's WK (work) LED — it should be solid
  once Android 14 finishes booting.

### Verify data is flowing

On the operator dashboard:
1. Go to **Sports** → **Game Day** → pick the active game.
2. Open the **Setup** tab → scroll to **CTS scoreboard console**.
3. The status pill should flip from "CTS not connected" → "CTS
   connected — receiving" within ~5 seconds of starting any clock or
   score event on the console.
4. The Run-mode board mirror should start showing the live clock /
   score numbers within ~1 second.

If the pill stays "CTS not connected" after 30 seconds:

- Double-check pin assignments (Pin 3 + Pin 11 — easy to land on
  Pin 5 by miscount).
- Verify the 1/4" cable isn't a TRS (3-conductor) being used in a
  TS (2-conductor) socket — a TRS plug shorts the ring to the tip when
  inserted into a TS jack, killing RS232 levels.
- Verify the console's DATA OUT switch is enabled (some CTS consoles
  have an output-disable switch hidden on the side).
- Test with a USB-RS232 sniffer (FTDI adapter + screen / minicom @
  9600 8E1) to confirm bytes are coming out of the console at all.

---

## Spares-to-order checklist (per install)

- [ ] 1 working cable + **2 spares** (cables are the #1 install
  failure point — never ship without spares)
- [ ] 4 spare Phoenix Contact plugs (confirm SKU with Goodview)
- [ ] 1 USB-RS232 sniffer adapter (FTDI FT232R or equivalent) — for
  on-site troubleshooting if data isn't flowing
- [ ] 1 spare 1/4" mono cable (in case the customer's existing CTS
  cable is bad and they need a swap)
- [ ] Heat-shrink + cable ties for tidy install
- [ ] **WTTC sites only:** 2× Conxall 3280-4PG-315 plug + 2× FTDI
  USB-RS485-WE-1800-BT (long-lead — order ahead; see the WTTC variant
  section below)

---

## Why not Stream Deck on RS232 #2?

Earlier docs / UI suggested wiring an Elgato Stream Deck into RS232 #2
on the EP6N as a "physical cue panel." **That was wrong** — Stream
Deck is a USB HID device that plugs into the operator's laptop or
tablet, not into the player. The 'streamdeck' option has been removed
from the wiring picker. RS232 #2 stays free for a future serial-cue
device that genuinely speaks RS232 (none currently shipping).

If the operator wants physical buttons for the dashboard's Run-mode
cues:
- Buy an Elgato Stream Deck ($150).
- Plug it into the operator's laptop / tablet (USB-A or USB-C).
- Install Elgato's "Stream Deck" software.
- Map each Stream Deck key to the dashboard keyboard shortcut for that
  cue (the Run-mode buttons are all keyboard-accessible).
- Done. No serial cable involved.

---

## When the operator needs to get to Goodview / Android settings

After v1.0.66+ (commit landing 2026-05-27), the player's "Exit to
launcher" button correctly disables the kiosk-home alias before firing
the HOME intent, so Android resolves HOME to the Goodview launcher
instead of looping back to the syncing splash. PlayerApp re-enables
the alias on next launch, so once the operator manually relaunches our
app from the Goodview launcher, kiosk-home behavior resumes
automatically.

If the operator gets stuck (rare):
- Settings → Apps → Default apps → Home app → pick "Goodview" (or the
  OEM launcher).
- Or: Settings → Apps → VenueOS Player → Force stop.

---

## Variant: CTS **Wireless Tabletop Controller (WTTC)** — Gen7/WA-2 RS-485 (updated 2026-06-11)

The page above is the **Gen 6 / System 6** path (wired RS-232 1/4" jack →
native UART → `/dev/ttyS1`). The **WTTC-1** is a different unit on a
different wire: its **SCBD scoreboard ports speak Gen7/WA-2 over RS-485**
(115200 / 8 / **NO** parity / 1 stop — NOT the legacy 9600/8/EVEN/1),
reached through an FTDI USB-RS485 adapter into the EP6N's USB host port.
In the dashboard pick the **"CTS Wireless Tabletop (WTTC) — Gen7/WA-2
RS-485"** console (Screen → Diagnostics → Hardware → **Scoreboard
console**); that selects the `gen7wa2` decoder + `/dev/ttyUSB0`.

```
WTTC SCBD port (Conxall 3280 socket)
   → [Conxall 3280-4PG-315 male plug, hand-wired to the FTDI flying leads]
   → [FTDI USB-RS485-WE-1800-BT  (RS-485 ↔ USB, wire-ended)]
   → EP6N USB host port  →  /dev/ttyUSB0
   → Player APK → CtsWireParser('gen7wa2') → ChannelGrid → ribbon
```

### Order-ahead hardware (order BEFORE the install date — long-lead parts)

| Part | Exact SKU | Source | Notes |
|---|---|---|---|
| Mating plug for the WTTC SCBD port | **Conxall / Switchcraft 3280-4PG-315** (4-pin male cable plug) | Digi-Key / Mouser | Mates the WTTC's SCBD socket. Order 2 (1 spare). |
| USB ↔ RS-485 adapter, wire-ended | **FTDI USB-RS485-WE-1800-BT** | Digi-Key / Mouser / FTDI | "-WE" = wire-ended, so you land Data+/Data−/GND directly. 1.8 m lead. Order 2. |
| (optional) 3-position screw terminal block | any | — | Tidier than solder for field swaps |

### Pinout — WTTC SCBD plug ↔ FTDI leads

SCBD socket (Conxall 3280), viewed from the **back of the console**:

| SCBD pin | Signal | Wire colour (typical) | FTDI USB-RS485-WE lead |
|---|---|---|---|
| Pin 2 | **Data +** | orange | **A / Data+** (orange on the FTDI) |
| Pin 3 | **Data −** | yellow | **B / Data−** (yellow on the FTDI) |
| Pin 4 | **GND** | black | **GND** (black) |
| Pin 1 | unused | — | insulate the FTDI's unused leads (VCC etc.) |

> ⚠ These pin/colour assignments are **reference-derived (MIT
> coloradoScoreboard + CTS field notes) and PROVISIONAL until the venue
> bring-up capture confirms them.** Meter continuity before powering. If no
> bytes flow, **try swapping Data+/Data−** — an RS-485 A/B reversal is the
> #1 first-try miswire and is harmless (just inverted signalling).

> Landing RS-485 on the **EP6N's native RS-485 terminal** (Phoenix block)
> instead of the FTDI USB path: Pin 1 = B−, Pin 2 = A+, Pin 11 = GND (see
> the pin map above). The profile defaults to the FTDI `/dev/ttyUSB0` USB
> path; override to the native tty with `?ctsTty=`.

### On arrival — bring-up steps

1. Wire the Conxall plug to the FTDI leads per the table; meter continuity;
   insulate unused FTDI leads.
2. Plug the FTDI into an EP6N USB host port; plug the Conxall plug into the
   WTTC SCBD port. Power both.
3. In the dashboard pick the **WTTC — Gen7/WA-2 RS-485** console.
4. **Run Capture mode FIRST** (append `?ctsCapture=1` to the player/CtsBridge
   URL → "● Capture bytes" → exercise every control on the WTTC → "↓ Save
   .bin"). Keep that `.bin` — it is the fixture that promotes the `gen7wa2`
   decoder from `provisional` to `stable` and reconciles any venue
   Define-Module channel deviations.
5. Confirm the Setup-tab CTS pill flips to "receiving" and the Run-mode board
   mirror shows live numbers within ~5 s of a clock/score change.

- **The APK needs no rebuild** — `SerialPortBridge.connect()` accepts any
  `/dev/tty*`; the profile's `defaultTty` (`/dev/ttyUSB0`) + serial settings
  (115200/8/N/1) drive it. Permissions: same Device Owner `chmod 0666
  /dev/ttyUSB*` model as the native ports.
- **Safety net unchanged:** the operator phone console + auto-celebration runs
  with ZERO serial connection, so game night is never gated on the auto-decode.

Full protocol extraction + build notes:
`docs/research/2026-06-11-wttc-gen7-buildout/00-VERIFIED-STATE.md`.
