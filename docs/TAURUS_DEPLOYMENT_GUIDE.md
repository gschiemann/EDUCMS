# NovaStar Taurus Deployment Guide (Synthesized)

Single source of truth for deploying VenueOS Player to NovaStar Taurus
TB30/TB40/TB50/TB60 controllers. Synthesizes 3 research reports:

- `research/NOVA_STAR_DEEP_DIVE.md` — Hardware + TaurusOS internals
- `research/COMPETITOR_NOVASTAR_PLAYBOOKS.md` — How OnSign / Xibo / Navori do it
- `research/ANDROID_KIOSK_BEST_PRACTICES.md` — Android-side hardening

## TL;DR — The single canonical install flow

Every signage CMS that ships on Taurus uses the same recipe. There is no
ADB-only path. There is no USB-stick path. There is one path:

1. Connect Taurus controller and your laptop to the same LAN.
2. Open **NovaStar ViPlex Express** on the laptop.
3. Click anywhere in the home screen, then **type `novasoft`** blind
   (no input field, no Enter — just the 8 letters). A hidden "User
   Software" menu appears.
4. Log in as **`admin` / `SN2008@+`** (V4.6.0+ ViPlex; older builds
   used `123456`).
5. **First**: System Update — make sure the Taurus is on the latest
   firmware. Outdated firmware = old WebView = TLS handshake failures
   that look like "white page won't load anything".
6. **Then**: in Process List, find `PlayService` and **toggle it OFF**.
   Do NOT replace NovaLauncher; that breaks ViPlex itself.
7. Sideload the APK:
   - **Pick the right ABI**. Modern (2024+) TB30/TB40 are
     Cortex-A55 64-bit → use `arm64-v8a`. Older RK3288 TB30 → use
     `armeabi-v7a`. When in doubt: `universal`.
   - Tick BOTH **Auto-launch on startup** AND **Automatically run
     after installation**.
8. Click Install, then Restart Now.

The kiosk should boot directly into VenueOS Player and show its pairing
code splash. Pair from the dashboard.

## Why each step matters

### Step 5 (firmware update)
Pre-2025 Taurus firmware ships System WebView 75-95. Modern Vercel and
Railway negotiate TLS 1.3 + SNI extensions that older Chromium can't
handle, leading to truncated handshakes that surface in the React app
as "Registration HTTP failed" with no useful error. **This is the most
common cause of "the app won't connect" on a TB40.**

### Step 6 (disable PlayService)
PlayService is NovaStar's native CMS. It owns the foreground / framebuffer
and respawns itself on a timer if you just kill it. Without disabling it
properly, your APK installs but PlayService keeps stealing focus. Symptom:
"black screen with cursor" or "splash flashes briefly then disappears".

### Step 7 (correct ABI)
Wrong-ABI APKs install successfully but Android falls back to
software-rendered emulation, which on a 1GB-RAM A55 system results in
sluggish WebView that often crashes during TLS handshakes. Looks
indistinguishable from "won't connect."

### Step 8 (auto-launch checkboxes)
Without these, the APK installs but never launches on boot. The Taurus
boots into a black screen because PlayService is disabled and nothing
else has the HOME intent registered.

## Hardware identity matrix

| Controller | SoC | Cores | RAM | Storage | Android | ABI | WebView |
|---|---|---|---|---|---|---|---|
| TB30 (pre-2024) | Rockchip RK3288 | 4× A17 32-bit | 1GB | 8-16GB | 7-9 | armeabi-v7a | 75-95 |
| TB30 (2024+) | Cortex-A55 | 4× 64-bit | 1GB | 16GB | 11 | arm64-v8a | 100+ |
| TB40 (current) | Cortex-A55 @ 1.8GHz | 4× 64-bit | 1GB | 16-32GB | 11 | arm64-v8a | 100+ |
| TB50 | RK3399 | 6× 64-bit | 2GB | 16GB | 9-11 | arm64-v8a | 95+ |
| TB60 | RK3588 | 8× 64-bit | 4GB | 32GB | 11 | arm64-v8a | 110+ |
| MCTRL/NovaPro (sync) | None | — | — | — | — | — | not supported |

When in doubt about a specific unit: ViPlex → device → System Info shows
SoC, OS version, and architecture.

## Network requirements

- Outbound HTTPS to your Vercel domain (default: `venue-os.app`)
- Outbound HTTPS to your Railway API domain
- Outbound to `connectivitycheck.gstatic.com` (captive portal detection)
- Outbound DNS — many TaurusOS boxes lock DNS to NovaStar's CDN; if
  your school's DNS doesn't resolve external hosts, override with
  Google/Cloudflare DNS in NovaLCT before pairing.

**TaurusOS has no captive portal UI.** A school WiFi that requires
acknowledging an "agree to terms" page leaves the kiosk silently stuck
with no way to authenticate. Either:
- Use ethernet
- Have IT add the kiosk's MAC to the captive-portal-bypass list
- Use a SIM-card-equipped 4G dongle

## OTA after first install

After first sideload, Player + Manager OTA themselves on a 6h schedule.
The first OTA tap-to-install is unavoidable on standard installs (Android
security policy). Two paths to silent OTAs from there:

### Easy path: Manager as installer-of-record
On first manual Player update via Manager, Android remembers Manager as
the installer. Subsequent OTAs to that version chain are silent
(`USER_ACTION_NOT_REQUIRED` honored).

### Hard path: Device Owner provisioning
One-time per kiosk over ADB:
```bash
adb shell dpm set-device-owner com.educms.manager/.AdminReceiver
```
After this Manager has DEVICE_OWNER privileges. ALL future OTAs install
silently with no prompts. Same model Esper/Yodeck/OnSign use for their
"managed" tiers.

**Caveat**: must be done before any user account is provisioned on the
device. Factory-fresh Taurus is fine. Already-paired-to-other-CMS Taurus
needs a factory reset first (NovaLCT → Restore Default).

## What we're going to add to the app (priority queue)

1. **Provisioner CLI** — desktop tool that runs the DPM command for an
   operator over `adb` (Esper-style). One click per kiosk = silent OTA
   forever after. (Sprint candidate)
2. **First-boot device beacon** — log Build.MODEL + ABIs + SDK + WebView
   version on every cold start. Stops the guesswork on which Taurus
   variant we're dealing with.
3. **Captive portal probe** — hit `connectivitycheck.gstatic.com/generate_204`,
   if it doesn't return 204 surface a 64pt on-screen diagnostic ("School
   WiFi requires login — connect a phone, browse to ___ on this network")
   plus the kiosk's MAC for IT.
4. **`setRequestUpdateOwnership(true)`** on Player install (API 34+) —
   locks Play Store out of silent-updating Player from under us.
5. **HeartbeatService FGS migration** `dataSync` → `specialUse` — Android
   15 enforces a 6-hour cap on `dataSync` foreground services, will brick
   our always-on heartbeat when Taurus eventually upgrades.
6. **Kronos-Android NTP** — TaurusOS strips GMS NTP, so JWT validation
   fails when the device clock drifts. Pull time from Cloudflare/NTP pool
   directly.
7. **OkHttp DnsOverHttps** for the API host — bypasses vendor DNS lock-in
   on locked AOSP boards.
8. **Optional `kiosk` Gradle flavour** — re-enables `CATEGORY_HOME` for
   greenfield (non-OEM-CMS) deployments. Stays off by default so we
   don't displace ViPlex on Taurus.

## What NOT to do

- **Don't replace NovaLauncher.** Breaks ViPlex, breaks System Update,
  breaks the Taurus's own LED-config tool. Co-exist by disabling
  PlayService instead.
- **Don't ADB-only sideload without ViPlex.** The APK installs but
  PlayService respawns over the top. Black screen forever.
- **Don't bundle our own Chromium.** 1GB RAM A55 will choke and the
  APK doubles in size. Update the Taurus firmware so System WebView
  is current.
- **Don't add `CATEGORY_HOME` to the default APK.** Already learned the
  hard way on Goodview — it triggers the "pick your launcher" dialog
  and risks displacing the OEM CMS.
- **Don't skip firmware update.** It's the #1 root cause of "the app
  won't connect" complaints from the field.

## Troubleshooting checklist

When a customer reports a Taurus issue, walk through this in order:

1. **What does the System Info screen in ViPlex say?**
   - SoC, Android version, ABI — confirms which APK to ship
   - Firmware version — if older than 2024, update first
2. **Has PlayService been disabled?**
   - In ViPlex User Software panel → Process List → PlayService should
     show "Disabled"
3. **Does the kiosk reach the internet?**
   - From ViPlex shell: `curl -I https://venue-os.app/`
   - Should return 200. If timeout, school network or captive portal.
4. **Is the right ABI installed?**
   - `pm list packages | grep educms` then `dumpsys package com.educms.player`
   - Compare reported architecture to the device's `Build.SUPPORTED_ABIS`
5. **Is the kiosk's clock correct?**
   - JWT validation breaks if clock is >5 minutes off real time. Set
     time via NovaLCT or wait for first NTP sync (can take 60s post-boot).
6. **Did "Auto-launch on startup" stick?**
   - In ViPlex User Software → Installed apps → VenueOS Player should
     show ⚙ Auto-launch enabled. If not, re-tick and reboot.

## References

- `docs/research/NOVA_STAR_DEEP_DIVE.md`
- `docs/research/COMPETITOR_NOVASTAR_PLAYBOOKS.md`
- `docs/research/ANDROID_KIOSK_BEST_PRACTICES.md`
- `docs/PLAYER_APK_NOVA_TAURUS.md` (legacy — superseded by this doc)

Last updated: 2026-05-07
