# NovaStar Taurus Deployment Guide (Synthesized)

**Verification pending:** the NovaStar-side procedure (ViPlex Express, the `novasoft` unlock, PlayService, firmware/WebView table, hardware identity matrix, network behaviour of TaurusOS) comes from vendor research and cannot be verified from this repository; it needs a Taurus controller on the bench. The VenueOS-side statements (package ids, APK variants, OTA, the work queue) were re-checked against code on 2026-11-09 and corrected below. The research files named here live in the gitignored `docs/research/` and exist on the lead's machine only.

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
4. Log in with the controller's vendor default credentials (they differ
   by ViPlex version; take them from NovaStar's documentation, not from
   this repository).
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

- Outbound HTTPS to your Vercel domain (the production web domain; this repository does not pin it, unverified)
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

The updater is the Player's own (`apps/player/app/src/main/java/com/educms/player/ota/`), fed by the API's `player-ota` controller (`apps/api/src/player-ota/player-ota.controller.ts`: `update-check`, `apk/latest`, `apk/v/:vc`, `field-apk/:sha`). The APK catalogue comes from `player-v*` GitHub Releases (`PLAYER_APK_GITHUB_REPO` in `docs/ENVIRONMENT.md`). Rules that bind a Taurus fleet:

- **The Manager is no longer a separate OTA.** The companion Manager APK rides inside the Player APK and is installed by the Player when its versionCode is newer (`apps/player/CLAUDE.md`, Rule 13, "One release unit"); `manager-v*` tags are retired. The earlier text about "Player + Manager OTA themselves on a 6h schedule" and about Manager as installer-of-record is superseded.
- **No Device Owner provisioning, ever** (owner rule 2026-10-17, `docs/governance/OWNER-RULES.md`). The `dpm set-device-owner` path and the "Provisioner CLI" idea this guide used to describe are withdrawn. On Android 11 and older an update is one Install tap per update; capability work targets Android 13 and newer.
- Pushes go through the update rings (lab, field window on bench screens, canary, fleet), one hardware class at a time and off-hours; never mass-force during playback (`CLAUDE.md` section 7).

## Status of the old "what we're going to add" queue (checked 2026-11-09)

1. Provisioner CLI (Device Owner over ADB): **withdrawn**, see above.
2. First-boot device beacon (model, ABIs, SDK, WebView version): not re-checked in this pass; `unverified`.
3. Captive-portal probe: **partly present**: `NetworkRecoveryController.kt` probes `connectivitycheck.gstatic.com/generate_204` and reports a filtered or captive network. The 64pt on-screen diagnostic with the MAC for IT was not confirmed: unverified.
4. `setRequestUpdateOwnership` on API 34+: **present** (`ota/Api34UpdateOwnership.kt` in the Player, and in the Manager).
5. HeartbeatService foreground-service type `dataSync` to `specialUse`: **not done**; `AndroidManifest.xml` still declares `foregroundServiceType="dataSync"`.
6. Kronos NTP and 7. DnsOverHttps: no occurrence in `apps/player` (symbol search): **not present**.
8. Optional `kiosk` Gradle flavour: no product flavour found in `apps/player/app/build.gradle.kts`; instead the Player has a `kioskHomeOptIn` preference that keeps an alias enabled. The default APK still does not claim `CATEGORY_HOME` without the opt-in (see the comment near `kioskHomeOptIn` in that file); treat as `unverified` beyond that.

## What NOT to do

- **Don't replace NovaLauncher.** Breaks ViPlex, breaks System Update,
  breaks the Taurus's own LED-config tool. Co-exist by disabling
  PlayService instead.
- **Don't ADB-only sideload without ViPlex.** The APK installs but
  PlayService respawns over the top. Black screen forever.
- **Don't bundle our own Chromium.** 1GB RAM A55 will choke and the
  APK doubles in size. Update the Taurus firmware so System WebView
  is current.
- **Don't add `CATEGORY_HOME` to the default APK** (the Player ships an opt-in alias instead, see queue item 8). Already learned the
  hard way on a vendor CMS panel — it triggers the "pick your launcher" dialog
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
   - From ViPlex shell: `curl -I https://<your-web-domain>/`
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
- `docs/archive/PLAYER_APK_NOVA_TAURUS.md` (archived; superseded by this doc)
- `apps/player/CLAUDE.md`, `docs/player/HARDWARE-QUAL-CHECKLIST.md` (release, OTA and hardware qualification)
