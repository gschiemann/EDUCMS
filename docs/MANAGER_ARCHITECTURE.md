# Manager APK — Architecture Decision

> **Status:** Planning / not deployed. Branch + code scaffolded but
> nothing pushed to master yet. Awaiting operator green-light on the
> recommended scope before any of this ships.

## TL;DR — recommendation

**Two apps, not three.** Build `EduCMS Manager` as a small (~3-5 MB)
companion to the existing Player APK. Manager handles watchdog,
updater, and device-admin roles in one package. Skip Yodeck's
three-way split — it's overkill for our scale and adds maintenance
surface for no benefit at our deployment size.

The work is genuinely worth doing because **three of Yodeck's
guarantees are hard gaps in our current setup that real customers
will hit**. The fourth, fifth, and sixth Yodeck tactics aren't
worth copying.

---

## What Yodeck does, evaluated honestly

| # | Yodeck pattern | Why they do it | Is it a real gap for us? |
|---|---|---|---|
| 1 | Separate Updater APK | "An app can't replace itself while running" | **Partially**. We use `PackageInstaller.Session` which does handle replacement at the OS level — the Player dies during install, Android replaces the APK, the new Player boots fresh. We don't NEED a separate updater for the install mechanic. But unattended kiosks have a different problem (#2 below) where Updater + DEVICE_OWNER together solve it. |
| 2 | DEVICE_OWNER privileges | Silent install, lock-task mode, prevent uninstall | **YES — biggest real gap.** Without DEVICE_OWNER, Android shows a system "Install" prompt every OTA. On unattended hallway kiosks, nobody taps it. So our current OTA flow stalls indefinitely on the prompt screen. This is the single biggest production-readiness issue. |
| 3 | Crash isolation (Manager separate process) | Player segfault / OOM / ANR — Manager restarts it | **YES.** Our current `Watchdog` runs inside the same APK. If Player dies hard (native crash, low-memory kill, ANR-triggered system kill), Watchdog dies with it. WorkManager restarts on the 6-hour periodic tick, which means a dead overnight kiosk stays black until morning. Not acceptable. |
| 4 | Updater with rollback | If new version crashes on boot, revert to previous | **YES — safety net we don't have.** Right now if v1.0.13 ships a bug that crashes MainActivity on launch, every kiosk in the field is bricked until manual sideload. Manager keeps last-known-good APK on disk and reverts if Player crashes N times in M minutes after install. |
| 5 | Bundled Chromium / CEF (~70MB) | Consistent rendering across Android 5/6/7/8 | **NO — skip.** System WebView on Android 7+ is fine for our use case. Bundling adds 70MB + a security-patch treadmill we don't have headcount for. Defer until a customer reports a rendering bug we can't fix in CSS. |
| 6 | FFmpeg + native codec shims (~10-15MB) | H.265/AV1 fallback on chips without HW decode | **NO — skip.** WebView's built-in video stack handles everything we serve today. Add ExoPlayer fallback in the existing Player if we ever hit an edge case; not a multi-APK concern. |

---

## What's actually broken without Manager today

Re-stating the three real gaps in plain terms because these are the
only reasons to build it:

### Gap 1 — Unattended OTA install
Current flow: dashboard "Push update" → Player worker downloads APK
→ `PackageInstaller.Session.commit()` → **Android shows system
"Install / Cancel" prompt** → kiosk waits forever for a tap.

What customers expect: "Push update" → kiosk reboots into new
version. No human at the screen. No extra steps.

What's required: Manager APK provisioned as DEVICE_OWNER, which
grants `INSTALL_PACKAGES` permission silently. Manager installs
Player updates without prompting.

### Gap 2 — Native crash recovery
Current flow: Player segfaults → process dies → Watchdog (in same
process) is dead too → AlarmManager re-launches Player on next
scheduled tick (~6h max gap).

What customers expect: kiosk goes black → recovers within seconds.

What's required: Manager runs as a separate Android process. Pings
Player every 30 s via a content provider or local socket. If three
consecutive pings fail, kills any zombie Player process and re-launches
MainActivity.

### Gap 3 — Bad-release rollback
Current flow: v1.0.13 ships, kiosk installs it via OTA, crashes on
boot. No recovery. Operator must sideload v1.0.12 manually.

What customers expect: bad release self-reverts; we get a Sentry
alert; we ship v1.0.14 with the fix.

What's required: Manager stages the new APK to disk before install,
keeps the previous APK on disk too. After install, watches for
healthy first boot (Player heartbeat with new versionName within 90 s).
If healthy → success, delete old APK. If not → uninstall the new
APK, reinstall the old one from disk, mark the version as quarantined
so the same bad APK isn't pulled again.

---

## Why two apps, not three (departing from Yodeck)

Yodeck's three-app split (Player + Manager + Updater) likely exists
for organizational reasons (different teams own different APKs) or
historical evolution (the Updater was bolted on after the fact).

For our size:

- **Three apps = three signing keys, three release pipelines, three
  app icons in Settings, three things to provision.** Each adds
  drag.
- **Yodeck's claim that the Updater being separate is a security
  boundary** is real but minor for our threat model. If our Manager
  has a vulnerability, an attacker could already own the device-owner
  privileges; they don't need to also compromise an Updater.
- **Crash isolation** is satisfied by Manager being a separate
  process from Player. The Updater being a third process doesn't add
  meaningful isolation beyond what Manager-as-separate-process already
  gives us.

Two apps = same operational model with less surface area. If a
customer ever asks for the third-app split (eg for a procurement
checklist) we can extract Updater later.

---

## Proposed architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Android device (Goodview / Taurus / generic Android 7+)     │
│                                                              │
│  ┌──────────────────────┐      ┌────────────────────────┐  │
│  │ EduCMS Player        │◄────►│ EduCMS Manager         │  │
│  │ com.educms.player    │ IPC  │ com.educms.manager     │  │
│  │ (existing APK)       │      │ (NEW, ~3-5 MB)         │  │
│  │                      │      │                         │  │
│  │ • WebView + UI       │      │ • Foreground service    │  │
│  │ • Heartbeat to API   │      │ • DEVICE_OWNER          │  │
│  │ • Content rendering  │      │ • Watchdog ping/restart │  │
│  │ • Pairing flow       │      │ • OTA install + rollbk  │  │
│  │ • Emergency overlay  │      │ • Boot launcher         │  │
│  └──────────────────────┘      └────────────────────────┘  │
│           ▲                            ▲                     │
│           │                            │                     │
│           │ HTTPS heartbeat            │ HTTPS update-check  │
│           │ /screens/status            │ /player/update-check│
│           │ /screens/:fp/ota-state     │ /screens/:fp/ota-st │
│           └────────────────┬───────────┘                     │
│                            │                                  │
└────────────────────────────┼──────────────────────────────────┘
                             ▼
                    EduCMS Backend (Railway)
```

**IPC between Player and Manager:**
- Manager exposes a ContentProvider (`com.educms.manager.health`)
  with a single read-only `last_check_in` row. Player writes to it
  every 30 s via a small HeartbeatPublisher.
- Manager polls the provider every 30 s. If the column is null or
  older than 90 s for three consecutive checks, it concludes Player
  is dead and force-stops + relaunches it.
- ContentProvider works across UID boundaries on Android, no socket
  layer to maintain.

**OTA flow with Manager:**
1. Dashboard "Push update" → existing API force-flag set.
2. Player's WebSocket receives `CHECK_FOR_UPDATES` and forwards to
   Manager via ContentProvider write to a `pending_check` row.
   (Could also have Manager poll the API directly on its own 6h
   schedule. Both is belt-and-suspenders.)
3. Manager's update worker hits `/player/update-check`, downloads
   APK, verifies SHA256, writes to disk.
4. Manager installs via `PackageInstaller.Session` — silent because
   it's DEVICE_OWNER.
5. Manager monitors first boot. Healthy heartbeat in 90 s → OK,
   delete old APK. No heartbeat in 90 s → rollback (uninstall new,
   reinstall old from disk).
6. Manager reports per-phase state to existing
   `/screens/:fp/ota-state` endpoint (already shipped in v1.0.12).

**Provisioning flow:**
1. Operator factory-resets the kiosk (or buys a fresh device).
2. At first boot, before any other setup: ADB or QR-code-driven
   provisioning sets Manager as device owner. ADB:
   `adb shell dpm set-device-owner com.educms.manager/.AdminReceiver`
3. Manager is now device owner. It can:
   - Install Player APK silently
   - Lock-task mode keeps users in Player (kids can't escape)
   - Prevent uninstall of either APK
4. Manager downloads + installs Player on first boot from a baked-in
   default URL (overrideable via QR provisioning JSON).
5. Player launches, shows pairing code, operator pairs in dashboard.

QR-code provisioning can be added in a Phase 2 — for v1, ADB-only
provisioning is fine since fleets are small and we control the
hardware-prep workflow.

---

## Build phases — what ships when

### Phase 1 — minimum viable Manager (this branch)
**Goal:** unattended OTA install works.

- Manager APK module (Gradle)
- AndroidManifest with `BIND_DEVICE_ADMIN` permission, AdminReceiver
- DeviceAdminReceiver implementation
- ContentProvider for Player ↔ Manager IPC
- HeartbeatPublisher in Player (writes to provider every 30 s)
- Manager foreground service that polls heartbeat + restarts Player
- OTA install flow (download, verify, install via PackageInstaller)
- ADB provisioning instructions in `docs/MANAGER_PROVISIONING.md`
- CI workflow: build Manager APK alongside Player

### Phase 2 — rollback + visibility (next session)
- Stage previous APK on disk before install
- Watch first-boot health, auto-revert on failure
- Quarantine list to skip known-bad versions
- Sentry NDK in Player (independent of Manager)
- Manager reports its own crashes via the same channel

### Phase 3 — provisioning UX (after Phase 2 stabilizes)
- QR-code provisioning protocol design
- Dashboard QR generator
- First-boot setup wizard activity
- Lock-task mode toggle in Settings

### Phase 4 — defer until customer-driven
- Bundled WebView (only if rendering bug we can't CSS around)
- ExoPlayer fallback (only if MediaCodec edge case in field)
- Three-way app split (only if procurement asks)

---

## Open questions (need operator input before Phase 1 ships)

1. **Provisioning model.** Are we shipping pre-provisioned hardware
   (we ADB-set-device-owner in our office before shipping to
   customers), OR will customers self-provision via QR?
   Answer affects whether Phase 3 is critical-path or deferrable.

2. **Existing pairing migration.** When kiosks already in the field
   (M43, The Den) get the Manager APK installed, do we:
     a) Ship Manager via Player's existing OTA (works once Player
        has DEVICE_OWNER, but doesn't on bare kiosks)
     b) Sideload Manager once, same as the v1.0.11 → v1.0.12
        keystore transition was sideloaded
     c) Bundle both into a single multi-APK install bundle
   Recommended: b. One last sideload trip to install Manager.

3. **Naming.** "EduCMS Manager" or something else? It shows up in
   Android Settings → Apps as a separate entry; the name affects
   what end users see if they ever open Settings.

4. **Rollout order.** Two test kiosks (M43 + The Den) for ~1 week
   in Phase 1, then expand. Acceptable?

5. **Crash threshold for rollback.** Three crashes in 60 s seems
   conservative; could be tuned per fleet. Hardcode for v1, make
   configurable later.

---

## Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Manager itself has a bug that bricks the kiosk | Critical — DEVICE_OWNER can't be uninstalled by user | Sentry NDK in Manager from day 1; phased rollout (M43 first); never auto-update Manager — Manager updates always sideloaded |
| Player ↔ Manager protocol drift | High — kiosks lose recovery loop | Versioned provider contract; Manager treats unknown protocol versions as "Player is dead" → restart Player (graceful degradation) |
| DEVICE_OWNER provisioning fails on a particular OEM (Goodview / Taurus / TCL) | Medium — kiosk falls back to "tap to install" UX | Manifest device-admin policies are standard AOSP; tested on Goodview kiosk before broad rollout. Have a manual install fallback in Manager's UI. |
| Two APKs go out of sync (Player v1.0.13, Manager v1.0.5) | Medium — cross-version IPC fails | Provider contract pinned to integer protocol-version constant; both sides log incompatibility loudly. Backwards-compat one major version. |
| Customer factory-resets a paired kiosk and loses provisioning | Low — by design, factory reset clears DEVICE_OWNER | Provisioning is a one-step ADB / QR re-do; documented |

---

## What this gets us

When Phase 1 ships:

- **Push update from dashboard → kiosk silently installs and reboots**
  with no human at the screen. The single biggest unattended-OTA
  gap is closed.
- **If Player crashes hard, kiosk recovers within ~90 s** instead
  of waiting 6h for the next periodic worker tick.

When Phase 2 ships:

- **Bad releases self-revert.** A v1.0.X that crashes on boot
  doesn't brick the fleet; we get a Sentry alert, ship v1.0.X+1,
  done.

When Phase 3 ships:

- **Zero-touch provisioning.** Customer plugs in screen, scans QR,
  walks away. New school can deploy 50 kiosks without ADB cables.

That's the spec. Building the Phase 1 scaffolding next so the
operator can review concrete code, not just docs.
