# Automatic per-screen time zones + the Goodview conflict audit (2026-10-24)

Internal engineering document. Owner words (Greg, 2026-10-24): "I set time zone
today in Goodview app and it's always set to China to start… auto time zone
would be amazing but maybe setting from dashboard as well… also we need to make
sure our settings don't conflict with the Goodview app." Lead's scope change
the same day: **no operator-facing Goodview warnings or detection UI** — the
owner disables the basic Goodview features himself; what VenueOS must do is
simply **never fight the Goodview CMS**: write a device-level value only when it
actually changes on our side, read before writing, respect an external change
(record it, never re-assert), no retry loops.

Nothing in this document is proven on a real panel. Every firmware fact below
comes from a static read of the GUQ burn image and the Goodview APKs (jadx,
never run), in the private evidence folder `scratch/guq-firmware/` and the
session scratchpad; see §7 for what was read.

## 1. What shipped (one PR, unmerged)

### 1.1 One effective time zone per screen

Precedence, in one shared pure function (`packages/api-types/src/time-zone.ts`
`resolveEffectiveTimeZone`):

1. **screen override** — `Screen.timezone`, set in the screen drawer;
2. **location setting** — `Tenant.timezone`, set on the Organization page;
3. **automatic** — derived at read time from the nearest saved coordinates,
   screen pin > group address > location address, through an offline
   coordinate→IANA lookup (`apps/api/src/screens/screen-time-zone.ts`);
4. **device** — nothing resolves; the player keeps using the zone the box is
   set to, exactly as before this change.

The automatic step uses `@photostructure/tz-lookup` 11.7.0: 88 KB, zero
dependencies, CC0, updated with each tzdata release (11.7.0 is September
2026), pure JS, microseconds per call. `geo-tz` was rejected (74 MB of polygon
data plus four dependencies for sub-kilometre accuracy a building address never
needs); the original `tz-lookup` is unmaintained since 2022. Grid resolution is
about 4 km, so an address right on a zone border can land on the wrong side —
that is what the dashboard override is for. Ocean / generic answers
(`Etc/GMT±N`, `UTC`), out-of-range coordinates and anything the runtime's own
`Intl` data cannot format are treated as **unresolved** (fall through), never
as a zone.

**No backfill is needed and none runs.** The automatic zone is computed from
coordinates that already exist, every time it is read; nothing derived is
persisted, so an address edit can never leave a stale zone behind. Production
on 2026-10-24: 49 live locations, 43 with coordinates, 0 with an address but no
coordinates, 6 with no address at all; 42 live screens, 38 of which resolve a
zone through their own pin, their group or their location. The 4 remaining
screens (locations with no address) keep the device zone until someone adds an
address or picks a zone.

### 1.2 Data (additive, idempotent)

Migration `20261024120000_screen_time_zones` — `SET lock_timeout = '5s'`,
`ADD COLUMN IF NOT EXISTS`, nullable, no defaults:

- `tenants.timezone` — the location's setting (NULL = automatic);
- `screens.timezone` — the per-screen override (NULL = inherit);
- `screens.device_time_zone` — telemetry: the zone the device reports itself set
  to (`Intl.DateTimeFormat().resolvedOptions().timeZone`) on every register,
  including the bare credential-recovery paths. In
  `SCREEN_TELEMETRY_ONLY_FIELDS`, so a boot-wave re-register cannot bust the
  fleet's manifest cache; never read by any manifest branch.

Proven on a scratch local Postgres 16: applied twice, both exit 0, three
nullable `text` columns. `prisma migrate diff` from the previous schema produces
the same DDL minus the `IF NOT EXISTS` guards.

### 1.3 Manifest

`timeZone` rides the hashed payload on the full, scoreboard and
"no content scheduled" bodies. Every input is a stable column (`Screen.timezone`,
`Tenant.timezone`, the three coordinate pairs), and Screen, ScreenGroup and
Tenant are manifest-fed models, so a zone or address edit busts the ETag and
reaches the screen on its next poll; no clock value rides (sync rule 4). The key
is **always present** on those bodies: `null` means "no zone from the server,
use the device's"; an **absent** key — an older API, and every **emergency**
manifest, which is untouched — means "keep the last known zone". The tenant
projection the manifest preamble caches gained `timezone`, `latitude`,
`longitude`.

### 1.4 Player (web)

`apps/web/src/app/player/screenTimeZone.ts` (pure, tested):

- reads the manifest field (zone / null / absent), folds it (absent keeps the
  previous value), persists it (`edu_screenTimeZone`) so a boot straight into an
  alert or offline still formats clocks right;
- `withDefaultTimeZone` fills a widget config with the screen's zone under the
  three spellings the widget catalog reads (`timezone`, `clockTimeZone`,
  `timeZone`) **only when the widget has no zone of its own** — an explicit
  widget zone always wins. Applied at the one zone-render site in `page.tsx`
  and in both touch overlays. The marker `_timeZoneDefaulted` keeps the CLOCK
  widget from suddenly showing an abbreviation it never showed before;
- the off-hours update window now resolves schedule row → **screen** → device
  → UTC (`offHoursUpdate.ts`; the telemetry `zoneSource` enum on both sides
  gained `screen`).

### 1.5 Dashboard

- **Screen drawer → Actions → Configuration**, under Location: a "Time zone"
  row with the effective zone ("America/Los_Angeles · PDT (UTC−7) · 12:00 PM
  there now"), its source in plain words, and — when the device's own clock
  setting disagrees — "The screen itself is set to Asia/Shanghai. Clocks, dates
  and overnight updates on it follow America/Los_Angeles anyway." Two ids for
  the same rules (America/Los_Angeles vs US/Pacific) never read as a
  disagreement. A picker whose first option is "Automatic (America/Los_Angeles)";
  choosing a zone writes `PUT /screens/:id { timezone }`, choosing Automatic
  clears it. Rendered only when the API answered the field.
- **Settings → Organization → Identity**, under Address: a "Time zone" field,
  default "Automatic (X, from the address)", with the local time there as proof.
  Saved through the existing `PATCH /tenants/me`. No Settings navigation was
  touched (a separate session is restructuring Settings).
- **Settings → Locations**: each location row shows "zone · automatic, from the
  address" or "zone · set for this location".
- Strings in en / es / zh; parity gate green (5,952 keys × 3).

### 1.6 Device-level values — "never fight the vendor app" (APK)

The only device-level setting path VenueOS has is the device-settings
framework (`apps/player/.../settings/`). It was already identity-based (a value
is written once per operator change, bounded, persisted before the write) with
one exception: after a reboot, an applied setting whose read-back had drifted
was **set again** ("some signage firmware resets brightness, volume or the
timeout at boot"). On a Goodview panel that is two apps taking turns on one
value. Changed (`DeviceSettingsPolicy` rules 2 and 3, JVM-tested):

- after a reboot an applied identity stays applied; a drifted read-back is
  **recorded** as `changed-elsewhere` — never re-applied;
- within a boot, an applied identity whose read-back drifts is marked the same
  way, once (the mark never flips back by itself, so a value two apps touch
  cannot flap the report); Wi-Fi is never marked ("not on that network right
  now" is not "changed elsewhere");
- nothing else changed: read-before-write (`already-set`) stays, the attempt
  budget stays, a NEW identity from the dashboard is still written once.

The dashboard says "Set, then changed by something on the screen — VenueOS
leaves it alone" next to the observed value (`changed-elsewhere` added to the
shared why-code vocabulary; the Kotlin↔TypeScript drift spec holds).

### 1.7 GUQ device time zone — the outcome

**No vendor command sets the time zone, so the player-level zone is the whole
answer on the GUQ.** The complete 210-command table of the Seewo OpenSDK
service this firmware handles (`com.seewo.mcuservice` `SDKService`, read from
the decompiled `UdiServer`) contains no time-zone, locale, date or NTP setter.
The only time-related commands are `timer.CmdSyncSystemTimeToRTC`,
`timer.CmdSyncRtcTimeToSystem` (copy the clock between RTC and system — not a
zone) and `timer.CmdSetStartUpAlarm`. `system.CmdExecShellCommand` exists and is
in the deliberately-unused class; it was not and will not be used. GvSettings
(`com.goodview.settings`) exposes no zone broadcast either — its declared
actions are orientation, `SET_VALUE(usb_port)`, launcher, clear-storage,
install-APK and server-connected. Android itself refuses
`AlarmManager.setTimeZone` to a normal app (`SET_TIME_ZONE` is
signature|privileged). The device's own zone is therefore only **reported**
(`device_time_zone`) and never written — which is also exactly what the owner's
rule asks for.

## 2. Why a GUQ "is always set to China to start"

From the decompiled GvSettings V2.10.1 (`UpgradeService.onCreate`, the service
every boot starts):

```java
String id = TimeZone.getDefault().getID();
if ("GMT".equals(id) || "GMT+08:00".equals(id)) {
    alarmManager.setTimeZone("Asia/Shanghai");
}
if (TextUtils.isEmpty(Settings.System.getString(cr, "time_12_24"))) {
    Settings.System.putString(cr, "time_12_24", "24");
}
```

So at every boot, a panel whose zone is still the factory `GMT+08:00` is moved
to `Asia/Shanghai`, and the 24-hour clock format is forced if unset. Once a real
zone is set (the Goodview Date & Time dialog — `ItemDialog` writes
`AlarmManager.setTimeZone(App.mTimeZoneID[i])`), this branch no longer matches
and the setting survives reboots. `CommonUtils.clearAllData()` (the vendor's
"clear data" / reset path) puts the zone back to the build's
`persist.sys.timezone` default. Nothing in CloudSign 2.8.7 sets the zone; its
`getServerTimestamp()` sets the system **time** from its server only on
RK3288 / RK3328 / V352 boxes and only while `auto_time` is on — not on the T982.

Consequence for VenueOS: whatever the panel's zone, every clock and date widget
and the update window now follow the screen's effective zone from the manifest.
The device zone is shown on the drawer so an installer can still fix the panel
in the Goodview dialog if they want the Android status bar right too.

## 3. Conflict audit — every setting both sides can touch

Legend: **VenueOS mechanism** is what our player does today; **Goodview side**
is what the vendor stack (CloudSign `com.wuhan.goodview.gtv_master`,
GvSettings `com.goodview.settings`, OSSettings `com.ifpdos.vsettings`, the Seewo
services) can do on the same unit, per the firmware read; **who wins today**
describes the behaviour after this PR.

| Setting | VenueOS mechanism | Goodview side (GUQ T982 / RK3288 kiosk) | Who wins today / risk | Fix / status |
|---|---|---|---|---|
| **Time zone** | Player-level effective zone in the manifest; never writes the device zone (no API; no vendor command). Device zone reported only. | GvSettings forces `Asia/Shanghai` at boot while the zone is the factory `GMT+08:00`; the Goodview Date & Time dialog sets any zone; `clearAllData` resets it. | No fight possible: VenueOS never touches the device zone; clocks follow the manifest zone regardless. | **Shipped** (this PR). |
| **Auto time / NTP server** (`Settings.Global.AUTO_TIME`, `ntp_server`) | Device-settings framework: written once per operator change, read-before-write, `WRITE_SECURE_SETTINGS` needed (`no-secure-settings` otherwise). | GvSettings Date & Time dialog toggles `auto_time`; CloudSign reads `auto_time` and sets the system time from its server on RK3288/3328/V352 when it is on. | Both write only on a person's action. Before this PR a drift at boot was re-applied; now recorded as `changed-elsewhere`. | **Shipped** (rule 3). |
| **Brightness** | Device-settings framework (settings / sysfs mechanisms only), identity-based; emergency brightness raise during an alert (life safety, exempt). | CloudSign t982 path: Seewo `CmdSetPictureProperty(BACK_LIGHT)` on its own schedule (`time_light_status`, `default_light`); RK3288: `com.assist.set.light`. | Each writes on its own trigger; VenueOS never re-asserts after an external change (rule 3 change). Risk: CloudSign's timed brightness overrides an operator's VenueOS value until the operator sets a new one. | **Shipped**; the owner turns the Goodview brightness schedule off. |
| **Volume** | Device-settings framework via `AudioManager` (identity-based). | CloudSign `AudioManager.setStreamVolume` on its schedule (`time_volume_status`, `default_volume`); RK3288 `com.assist.set.volume`. | As brightness. | **Shipped**; owner disables Goodview's volume schedule. |
| **Screen-off timeout / attentive timeout** | Device-settings framework; the screen-off blank sets its own 15 s and restores the baseline. | OSSettings "Auto Standby" / "no-signal standby" (`configure.CmdSetNoSignalTime`); GvSettings may hold its own screensaver. | A Goodview auto-standby darkens Android itself → the web page sleeps → the standby-alert hole (known, 1.1.22 native watch). VenueOS no longer re-writes the timeout after a drift. | **Shipped** (no re-assert). Owner turns Goodview Auto Standby off (the native alert watch still covers a slept page). |
| **On/off schedule (panel power)** | `DisplayScheduler`: state-driven, compares the schedule's desired state with **our own** blank record and acts only when they differ; vendor backlight (`CmdSetScreenStatus`) on the GUQ; alarms at window edges, re-evaluated on boot / manifest change / the 15-min watchdog. | CloudSign's own schedule (server-driven `TimerSwitch` → `Settings.Global.time_switch` → GvSettings observer → MCU power tasks); OSSettings "Timer Switch" (`CmdPowerControlTask`); RK3288 `com.assist.sleep.timeonoff` (an MCU power-off only a reboot undoes). | No loop: if Goodview turns the panel on while our window says off, our record still says "blanked" so the scheduler reads "already satisfied" and writes nothing; and vice-versa. Risk: two schedules acting at their own edges, and the RK3288 MCU-off that needs a reboot. | No code change needed for the loop; owner disables the Goodview timer (OSSettings → Startup & Shutdown → Timer Switch; CloudSign server schedule). |
| **Orientation** | `setRequestedOrientation` on our own Activity only (app-level); rotation **lock** via the device-settings framework (identity-based). | GvSettings `com.goodview.SET_SCREEN_ORIENTATION` sets `persist.sys.cvte.orientation` + `user_rotation` and **reboots** the unit (t982); RK3288 Signway `SetScreenRotation`. | Different layers: ours rotates our window; theirs rotates the system and reboots. A Goodview rotation while our lock is set is recorded (`changed-elsewhere`), not undone. | **Shipped** (rule 3); orientation itself never fought. |
| **Home app / boot auto-start** | Not set (no device owner; `installer-of-record` / `tap` update path only). | GvSettings `boot_pkg_name` auto-starts the configured app at boot (defaults to CloudSign after `clearAllData`). | Installer sets the boot app to VenueOS once in GvSettings; VenueOS never changes it. | No change; documented in the installer notes. |
| **Wi-Fi / network** | Device-settings framework: only networks VenueOS added are added or removed; never one the panel or Goodview saved (`wifi-exists`), never turns the radio on; one proof-gated switch, never retried on its own. | Seewo network commands are read-only on the GUQ; GvSettings has its own Wi-Fi dialog; RK3288 Signway can set Ethernet/static IP (unused by us). | No overlap by construction. | Unchanged (existing rule kept). |
| **Vendor OTA / app updates** | Our APK OTA installs only our own package (tap on ≤ Android 11). | SeewoOTA / GvSettings "Network Upgrade" update the firmware and Goodview apps; `com.goodview.action.INSTALL_APK` installs arbitrary APKs. | Independent; never touched. | No change. |
| **Clock format (12/24 h)** | Widgets format their own time; `time_12_24` is not read. | GvSettings forces `time_12_24=24` at boot if unset. | Only the Android status bar is affected. | No change. |

Deliberately unused, as before: the vendor shell / install / uninstall /
factory-reset hooks (`CmdExecShellCommand`, `CmdInstallAPK`, `CmdResetSystem`,
`com.goodview.action.INSTALL_APK`, the `SmdtManager` AIDL).

## 4. What was deliberately NOT built

- No operator-facing "Goodview's timer is on" warnings and no detection code
  that reads Goodview's `Settings.Global` keys (`time_switch`,
  `reboot_time_switch`, `time_light_status`, …) — removed from scope by the lead
  on 2026-10-24; the owner disables those features himself. The keys are listed
  here so a later decision can pick them up: they are world-readable
  `Settings.Global` / `Settings.System` values on the GUQ.
- No device-zone write of any kind (no API exists for a normal app; no vendor
  command exists).
- No persisted "auto zone" column and no backfill job (computed from existing
  coordinates at read time).
- No Settings navigation change.

## 5. Tests and gates run

| Gate | Result |
|---|---|
| `@cms/api-types` — `time-zone.spec.ts` | 9 passed |
| API — `screen-time-zone.spec.ts`, `screens.time-zone-manifest.spec.ts`, `screens.time-zone-routes.spec.ts`, `tenants.time-zone.spec.ts` | 30 passed |
| API — full Jest suite (repo rule) | 587 suites / 11,193 tests passed, 3 suites skipped (pre-existing) |
| API — `tsc --noEmit -p tsconfig.build.json` | clean |
| Web — `screenTimeZone.test.ts`, `time-zone-label.test.ts`, `ScreenDetailDrawer.timeZone.test.tsx` + regression suites for every touched component (drawer, settings pages, device settings, screenOps, offHoursUpdate) | 11 suites / 283 tests passed |
| Web — `tsc --noEmit` | clean |
| i18n parity (`check-i18n-parity.cjs`) | OK — 5,952 keys × 3, ICU shapes, non-empty |
| Mobile-perf guard | OK |
| Android — `./gradlew :app:testDebugUnitTest :app:lintDebug` (JDK 17) | 128 suites, 0 failures (DeviceSettingsPolicyTest 23/23); lint report, 0 errors |
| Migration — scratch Postgres 16, applied twice | exit 0 / exit 0; `prisma migrate diff` DDL matches |
| `scripts/check-schema-has-migration.cjs` | OK (migration dir present for the schema change) |

Not verified: anything on a physical panel (the manifest zone reaching a GUQ,
clocks on the glass, the register telemetry from a real APK WebView), and the
Prisma Studio / raw-SQL caveat of the manifest content cache (an edit through
Prisma busts it; a raw edit shows after the TTL). Dashboard rows were verified
by the component tests, not eyeballed in a browser.

## 6. Owner decisions still open

1. Whether the GUQ's own zone should be fixed in the Goodview Date & Time dialog
   during install (it only affects the Android status bar now) — optional.
2. Which Goodview features to disable per unit (the owner said he will): the
   OSSettings Timer Switch and Auto Standby, CloudSign's schedule / timed
   brightness / timed volume, GvSettings scheduled reboot (`reboot_time_switch`,
   default 02:00 after a reset).

## 7. Evidence read (never copied into the repo)

- `scratch/guq-firmware/03-firmware-capabilities-FULL-private.md` §1, §2.1,
  §2.3 (the Seewo command table excerpt; the full 210-command list was
  re-derived from the decompiled `UdiServer` `SDKService.java`, 211 unique
  `Cmd*` names, and `udi_commands.txt`).
- Decompiled GvSettings V2.10.1: `UpgradeService.java` (boot zone force,
  `time_12_24`, `time_switch` / `reboot_time_switch` observers),
  `CommonUtils.java` (constants, `clearAllData`, `persist.sys.timezone` read),
  `ItemDialog.java` / `DateSettingActivity.java` (the zone picker, `auto_time`).
- CloudSign-V2.8.7 (decompiled for this audit from the burn image's
  `vendor/media` copy): `Application/App.java` (`getServerTimestamp`,
  `auto_time`), `goodview/RequestCallBack.java` (`updateTimerSwitch`),
  `utils/APITools.java` (`time_switch`, brightness/volume/orientation paths).
- Production counts (read-only SQL, 2026-10-24): 49 live tenants / 43 with
  coordinates / 0 address-without-coordinates / 6 without address; 42 live
  screens / 38 resolve a zone.
