# ECBox3576 Phase 2 — bring-up checklist

The moment the ECBox arrives, work through this list. Every step
should take < 15 minutes — total time is ~1.5 hours plus shipping
wait for the cable batch.

## Pre-arrival (do this NOW so it parallels the box shipment)

### 1. Order the cable batch — 5× CTS 1/4" mono → 2-pin Phoenix plug

**Cable build spec:**

| Part | Quantity per cable | Notes |
|---|---|---|
| 1/4" mono (TS) jack, gold, panel-mount or molded plug | 1 | Console end. Standard 6.35mm |
| 2-pin Phoenix MC 1,5/2-ST-3,81 plug | 1 | Box end. Phoenix Contact 1803578, Mouser 651-1803578 |
| 6ft shielded 2-conductor cable, 22 AWG | 1 | Mogami W2549 or equivalent — shielding REQUIRED for RS232 noise immunity in stadium AV environments |
| Heat shrink, 1/4" | 2 in | Strain relief at both ends |

**Pinout (verify with continuity meter before plugging in):**
- **Console end (1/4" mono plug):** tip = data, sleeve = ground/shield
- **Box end (Phoenix plug):** Pin 3 = tip wire (RS232 RX into box), Pin 5 = sleeve wire (GND)
- Other Phoenix pins (1, 2, 4, 6) — leave open

**Vendors (any will do, prices Q2 2026):**
- Sescom (custom-built sports AV cables): https://www.sescom.com — $35/cable, 1-week lead time
- Markertek custom shop: https://www.markertek.com/products/custom-cable — $25/cable, 2-week lead time
- Local AV cable shop: typically $20-30 with 1-3 day lead time

**Order 5 cables.** One for the customer install, one spare on-site, three in your van for emergency replacement. Cables are the #1 install failure point — never deploy without spares.

### 2. Confirm Goodview reseller email contact

Ask whoever sold you the ECBox: "Can you provide an OEM image with `/dev/ttyS1` and `/dev/ttyS2` set to mode 0666 in the init.d?" Most Goodview AV-integrator partners offer this in 1-2 days. If they say no, you fall back to Device Owner provisioning (path A in the setup doc).

### 3. (Optional) Source a Sportzcast Scorebird or Daktronics simulator

Useful for office testing if you don't want to lug a real CTS console into the office. Otherwise borrow the customer's console for a week.

## On-arrival (the moment the box lands)

### Step 1 — Unbox + boot

1. Connect power supply (DC 12V barrel, inner 2.0mm — ships with the box)
2. Connect HDMI to a monitor
3. Connect Ethernet (kiosk WiFi can come later; Ethernet for setup)
4. Power on — Android setup wizard appears on HDMI output
5. Skip Google account setup if prompted (sideload-only kiosk)

### Step 2 — Run the verification script

```bash
# From your laptop:
adb connect <ECBox IP>:5555
adb push scripts/ecbox-verify.sh /data/local/tmp/
adb shell sh /data/local/tmp/ecbox-verify.sh > ecbox-report-$(date +%Y%m%d).txt
cat ecbox-report-$(date +%Y%m%d).txt
```

Expected output covers 6 sections (device id, tooling, tty enumeration, read-access probe, byte-sniff, APK presence). **Save the report** — it's the baseline + the troubleshooting starting point for every later issue.

### Step 3 — Flash the Player APK

```bash
# Build the APK locally
./apps/player/release-apk.sh
# (or download from the latest player-v* GitHub release)

# Sideload
adb install -r apps/player/app/build/outputs/apk/release/app-release.apk
adb install -r apps/player/manager/build/outputs/apk/release/manager-release.apk

# Set device owner — this is what makes OTA self-install work + lets
# the Manager chmod /dev/ttyS* on every boot
adb shell dpm set-device-owner com.educms.manager/.DeviceAdminReceiver
```

If `dpm set-device-owner` fails ("Not allowed to set the device owner because there are already several users"), factory-reset the box first: Settings → System → Reset options → Erase all data.

### Step 4 — Pair to a tenant + screen

1. Open dashboard → /screens → Add screen → grab the 6-character pair code
2. On the box, launch the Player APK
3. Enter the pair code
4. Confirm the screen shows as "Online" in /screens

### Step 5 — Identify the CTS tty

Plug your custom cable into the box's **Phoenix Terminal 1** (the one closest to the front panel — Goodview's convention).

Then with the CTS console powered and emitting (any state — clock running, displaying scores, etc.):

```bash
adb shell sh /data/local/tmp/ecbox-verify.sh
```

Look at section **[5/6]**. The tty that shows hex bytes is your CTS port. Typically `/dev/ttyS1`. If a different one (`/dev/ttyS2`, `/dev/ttyS3`) shows the bytes, that means Goodview wired the Phoenix Terminal 1 to that tty — note the mapping.

### Step 6 — Bind the Player to that tty

The Player APK defaults to `/dev/ttyS1`. If your ECBox uses a different tty, override per-screen by appending `?ctsTty=/dev/ttyS2` (or whichever) to the ribbon URL the player loads. Phase 3 will add a Settings UI for this; for v1 the URL query is the override.

### Step 7 — End-to-end smoke test

1. In the dashboard, create a Game (water polo, any two teams)
2. Setup → Layouts → RIBBON → **click the blue "Use 'CTS Water Polo Ribbon' →" button** (or pick from the filtered dropdown)
3. Push the ribbon to the ECBox screen (Setup → Screen push)
4. Verify:
   - ✓ Scoreboard zone shows live CTS clock + score from the console
   - ✓ Sponsor reel rotates (pulled from your tenant's Sponsor table)
   - ✓ Announcements rotate (pulled from this game's Roster if populated)
   - ✓ Fire GOAL from the Celebrations panel → cinematic plays full-coverage on the ribbon for 6s
   - ✓ Bridge panel in the corner shows green dot + "CTS Bridge · ECBox · Native serial (Phoenix terminal)"

If ANY of these fail, capture a fresh report from step 2 + the CtsBridge corner panel screenshot + post to the install ticket. Most failures are permission-denied on the tty (apply Device Owner OR Goodview image patch).

### Step 8 — Record the install profile

Add a one-line entry to `docs/ECBOX3576_INSTALL_PROFILES.md` (create the file if needed):

```
2026-XX-XX · Box serial AABB1234 · Goodview build <buildid> · tty=/dev/ttyS<N> · perms=0666 (via <Device Owner|Goodview patch>)
```

So when the next box arrives and behaves differently, you have a per-box profile to diff against.

## What can go wrong + how to recover

| Symptom | Most likely cause | Fix |
|---|---|---|
| No bytes on any ttyS in section [5/6] | Cable wired wrong (TX/RX swap is common with 1/4" mono) | Continuity-check the cable: Phoenix pin 3 → tip; pin 5 → sleeve |
| Bytes on a ttyS but `permission denied` in [4/6] | App uid can't open root:dialout 0660 | Device Owner via Step 3 OR ask Goodview for 0666 image |
| Bytes look right but parser shows wrong scores | Baud / parity mismatch | Try `?ctsBaud=19200` or `?ctsParity=odd` or `?ctsDataBits=7` |
| Cinematic doesn't play despite "Use CTS Water Polo Ribbon" | Screen not bound to the game's ribbon push | Setup → Screen push → make sure ECBox shows green "Showing" on the ribbon column |
| Whole ribbon goes black mid-game | ECBox power blip or HDMI re-handshake | Power → HDMI handshake; UPS recommended for game-day |
| Cable yanked mid-game | Operator sees grey dot for 2s then green again | Auto-reconnects after 2s; no manual recovery needed |

## Phase 3 ahead (after this list is green)

- Settings UI in the APK for tty / baud / parity (so no URL query needed)
- Kiosk info overlay shows "Serial: connected · N bytes/sec"
- Exponential backoff on the auto-reconnect (currently flat 2s)
- Telemetry: parser dropped-byte counter to PlayerLogger
