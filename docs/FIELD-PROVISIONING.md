# Field provisioning runbook — display control on Goodview panels

**Audience:** whoever is physically standing at the screen with a laptop
and a USB cable. Read steps 0–9 in order. Do not improvise.

---

## THE HEADLINE: this trip is no longer a one-way door

An earlier version of this runbook was built around taking Android
**device owner** on the install trip, because device owner is the only
thing that unlocks remote **reboot** — and it can only ever be taken
while a panel has no accounts and no extra users. Miss that window and
the only way back is a **factory reset**, which on a Goodview panel also
wipes the vendor CMS configuration.

**We are not doing that any more.** Product decision, 2026-08-13.

The plan instead is a **manufacturer preinstall**: once the product is
proven, the panel vendor ships our app inside the system image,
platform-signed. That is strictly *more* capable than device owner — it
gets signature-level permissions device owner never has — and it costs
the field tech nothing at all.

So on this trip:

- **Nothing you do is irreversible.** No factory reset. No
  `dpm set-device-owner`. Every step can be undone.
- **There is no window to miss.** If a panel gets an account added next
  week, nothing we rely on breaks.
- **You get everything except remote reboot.** See §7 for the exact,
  honest table.

`provision-kiosk.sh --take-device-owner` still exists, and it is loud
about what it does. It is for a specific unit the lead has explicitly
decided about. **It is not part of the normal trip and you should not
need it.**

---

## 0. What you need before you leave

- [ ] Laptop with `adb` on PATH (`adb version` prints something)
- [ ] `gh` CLI logged in (`gh auth status`) — or the two APKs on disk
- [ ] USB-A→USB-B / USB-C cable that actually carries data
- [ ] This repo checked out (the scripts live in `scripts/`)
- [ ] A pen, and a phone camera (§2)
- [ ] The dashboard open, logged in, on the Screens page

Sanity check on the laptop before you drive:

```bash
adb version
bash scripts/provision-kiosk.sh --help
bash scripts/display-capability-probe.sh --help
```

---

## 1. Wake the panel and enable USB debugging

1. Power the panel on. Let it reach the vendor home screen.
2. Settings → About → tap **Build number** 7 times → Developer options.
3. Developer options → **USB debugging** ON.
4. Plug the laptop in. Accept the "Allow USB debugging?" dialog **on the
   panel** and tick "always allow from this computer".
5. On the laptop:

```bash
adb devices
```

You must see the serial with state `device`. `unauthorized` means step 4
was not accepted. `no permissions` on Linux means a udev rule is missing.

---

## 2. Photograph the vendor CMS config anyway

We are not going to reset anything, so this is no longer load-bearing —
but it is five minutes of insurance against someone *else* resetting the
panel later, and against a firmware update wiping settings on its own.

Open the vendor's own settings app and photograph, screen by screen:

- Network / Wi-Fi profile (SSID, static IP, DNS, proxy)
- Panel power timers / scheduled on-off already configured in the vendor UI
- Input source mapping, orientation, resolution
- Any vendor account / license key on the box
- **The auto-start / startup manager screen** (see §6a) — you will be
  coming back to this one.

While you are in there: if the vendor UI already has its own scheduled
on/off timers configured, note them. Ours run independently, and two
schedules fighting over the same panel is a confusing site visit.

---

## 3. Probe every unit before provisioning any of them

Plug in all of them (a powered USB hub is fine), then:

```bash
bash scripts/fleet-display-probe.sh
```

This is **strictly read-only**. It writes nothing, installs nothing,
reboots nothing. Safe on a live screen mid-day.

You get one table, one column per unit, with `<< DIFF` on every row where
the units disagree. Panels off the same pallet are routinely NOT
identical — different firmware date, one with a world-writable backlight
node and two without.

Read the **VERDICT** block and the **ACTION PER UNIT** block. Keep a copy:

```bash
bash scripts/fleet-display-probe.sh --out ~/Desktop/venue-fleet.md
```

Attach that file to the install ticket.

---

## 4. Reading the verdict

There is no decision tree any more, because there is no irreversible
decision left on this trip. Every unit gets the same command (§6). What
the verdict tells you is **what that unit will be able to do afterwards**,
so you can set expectations before you leave.

| Row | What it means for the operator |
|---|---|
| `volume: audiomanager` | Real volume control. Needs no privilege. Expect this on every box. |
| `brightness: sysfs` | Real backlight. Dimming actually saves power and extends panel life. |
| `brightness: settings` | Real backlight via `Settings.System`. Needs the `WRITE_SETTINGS` appop, which §6 grants. |
| `brightness: software-dim` | The image darkens; the LCD backlight stays lit. **No power saving.** The dashboard slider says so in words. |
| `screenBlank: device-owner` / `device-admin` | Real screen-off. |
| `screenBlank: none` | Software overlay only — black screen, backlight still lit. **Blank and wake still work.** `none` names the *mechanism*, not the availability; the software floor cannot fail. §6 offers to upgrade this to `device-admin`. |
| `reboot: none` | Expected on every unit. We do not take device owner. See §7. |
| `deviceOwnerPath` | Informational. It does **not** change what you do. |
| `deviceOwnerWindowOpen` | Field-only fact: would this box accept device owner today? Recorded for the preinstall conversation with the vendor. Never sent to the dashboard. |

`<< DIFF` rows are not a bug. Different panels genuinely have different
hardware, and the dashboard exposes different controls per screen as a
result. Confirm it is expected before you leave the site.

---

## 5. About factory resets: don't

Someone will suggest it. The answer is no.

A factory reset **wipes the vendor CMS configuration** — network profile,
panel timers, input mapping — and buys us exactly one thing: remote
reboot. We have decided that trade is not worth it, and the preinstall
path (§7) gets us more than device owner ever could without touching a
single panel.

**The scripts will never factory reset for you.** There is no flag for
it. If a reset happens for an unrelated reason (RMA, vendor firmware
recovery), just re-run §6 afterwards — nothing is lost.

The one exception, and it is not yours to make on site: the lead may
decide a specific unreachable screen genuinely needs remote reboot, and
pass `--take-device-owner`. That flag prints a full-width warning and
demands you type `DEVICE-OWNER` before it does anything.

---

## 6. Provision the unit

Dry run first. It changes nothing and prints the exact plan:

```bash
bash scripts/provision-kiosk.sh --serial <SERIAL> --dry-run
```

Read the plan. Steps marked `[WRITES]` change the device. Then, for real:

```bash
bash scripts/provision-kiosk.sh --serial <SERIAL>
```

That is the whole command. There is no `--no-device-owner` to remember —
not taking device owner is the default. (The flag is still accepted and
does nothing, so old muscle memory and old tickets don't break.)

The script will:

1. Run the read-only preflight and print what this unit will and will not
   be able to do.
2. Print the plan.
3. **Ask you to type `PROVISION`.** (`DEVICE-OWNER` is demanded only when
   the one-way step is genuinely in the plan, i.e. you passed
   `--take-device-owner`. On a normal run — including a re-run of a unit
   that already holds device owner from an older trip — the word is
   `PROVISION`.)
4. Install Manager, then Player (`install -r` — never uninstalls, so the
   screen keeps its pairing). Player is installed with `-i
   com.educms.manager` so Manager is the **installer of record**.
5. Grant the `WRITE_SETTINGS` appop to the Player, so brightness can use
   the real `Settings.System` path instead of software dim.
6. Add the Player to the **battery-optimisation whitelist**, so on-device
   on/off schedules are not delayed by doze.
7. Offer to activate **device ADMIN** — see below.
8. Re-run the capability probe and print the final verdict.

**Device admin is not device owner.** It is activated with one adb
command (or one tap on the panel if the vendor image blocks that), it is
reversible, it has no accounts constraint, and it needs no factory reset.
All it grants is `USES_POLICY_FORCE_LOCK`, which is exactly what
`lockNow()` needs — a real screen-off instead of a black overlay. If the
adb command is refused, the script pops Android's own "Activate device
admin app?" screen on the panel and waits for you to tap **Activate**.

If no device-admin receiver exists on the box, the script says so and
moves on. Blank and wake still work; they just run on the software
overlay.

**It is idempotent.** Re-running is safe and is the correct response to
almost any hiccup. It never uninstalls, never resets, never reboots, and
skips every step that is already done.

If you are scripting a bench run and there is no terminal to type into,
pass `--yes`. Without a terminal and without `--yes` the script refuses to
run rather than guessing. Note that `--yes` also skips *waiting* for the
device-admin tap, so an unattended run may leave blank/wake on the
software overlay — re-run interactively to finish that step.

---

## 6a. The vendor auto-start manager — Goodview / Chinese ROMs

⚠️ **UNVERIFIED ON THESE UNITS. Confirm on real hardware and correct this
section afterwards.**

Chinese commercial-display ROMs almost always ship a **proprietary
auto-start / startup manager**, separate from Android's own settings and
separate from anything adb can see. It is usually inside the vendor's own
settings app, under a name like "启动管理", "Auto start", "Startup
management" or "Self-starting apps".

**Why it matters:** an app that is not ticked there gets killed shortly
after boot, no matter what our `BootReceiver` does and no matter what
Android's own battery settings say. The symptom is the worst kind: the
panel boots, shows our player for 10–60 seconds, and then falls back to
the vendor home screen — and it only happens after a power cut, so nobody
sees it during the install.

**Do this before you leave, on every unit:**

1. Open the vendor's own settings app (not Android Settings).
2. Find auto-start / startup management.
3. Enable **EduCMS Player** and **EduCMS Manager**.
4. Photograph the screen for the ticket.
5. **Power-cycle the panel at the wall** — not a soft reboot — and watch
   it come back to the player on its own, unattended, for two full
   minutes.

`fleet-display-probe.sh` and `provision-kiosk.sh` print a
`vendorAutoStartHint` line listing system packages whose names look like
an auto-start manager. That is a **name-match heuristic only**. It can
miss the setting entirely (many vendors bury it in a generically-named
settings app), and it can list packages that have nothing to do with it.
Treat it as a pointer, never as a verdict, and never as "the box has no
auto-start manager".

When someone confirms the real location on a Goodview unit, replace this
section with the actual menu path and delete this warning.

---

## 7. What we get, what we don't, and what comes next

This is the whole cost of not taking device owner, stated plainly.

| Capability | Today, without ownership | With a manufacturer preinstall |
|---|---|---|
| **Volume** | works — AudioManager, no privilege needed | works |
| **Brightness** | works — real backlight when the panel exposes a writable sysfs node, otherwise `Settings.System` via the appop, otherwise software dim | works, and the platform signature reaches nodes an ordinary uid cannot |
| **Blank / wake** | **always available.** Real screen-off via device admin `lockNow()`; below that a full-screen black overlay with window brightness at 0 — image goes black, backlight stays lit, so no power saving | real screen-off, plus panel-level backlight off |
| **Scheduled on/off** | works — on-device AlarmManager, survives a network outage | works |
| **Auto-launch on boot** | works — `BootReceiver`. We do **not** take over HOME | works, and survives the vendor launcher |
| **Reboot** | **NOT AVAILABLE. No fallback exists at any privilege level.** A hung unit needs a human with a power cord | works |
| **Silent OTA** | **not silent.** Manager is set as installer of record, which is the prerequisite; but silent update needs Android 12+ (`UPDATE_PACKAGES_WITHOUT_USER_ACTION`) or a system build. On the Android 11 fleet the install prompt still appears | fully silent |

So the entire cost of the decision is **remote reboot**, plus OTA still
needing a tap on Android 11. Everything the operator sees on the
display-control panel functions.

**The dashboard tells the truth about all of this.** Controls are gated on
what each screen actually reported. A panel that only does software dim
says so on the slider. A panel with no device owner **does not render a
reboot button at all** — not a greyed-out one, not a "coming soon" one.
Nothing is a costume.

**Why preinstall beats device owner.** A platform-signed system app gets
signature-level permissions that device owner cannot grant — the panel's
real backlight and power rails, vendor services, silent install on any
Android version. It also needs no field trip, no window, and no reset. It
is a vendor conversation, not a truck roll, which is why we are waiting
for it rather than burning factory resets now.

---

## 8. Verify before you leave the site

Do not pack up until all of these are true, per screen:

- [ ] `bash scripts/display-capability-probe.sh --serial <SERIAL>` verdict
      matches what you expected from §4
- [ ] The screen appears **online** on the dashboard Screens page
- [ ] Dashboard → Screens → this screen → Display: move the **volume**
      slider, hear/see it change
- [ ] Move the **brightness** slider; confirm the panel responds, and that
      the UI label matches reality (real backlight vs software dim)
- [ ] Hit **Blank**, watch the screen go dark, hit **Wake**, watch it come
      back. Do not leave a screen blanked.
- [ ] Confirm there is **no reboot control** rendered for this screen.
      That is correct: we do not hold device owner. If you *do* see one,
      something is wrong — note it on the ticket.
- [ ] §6a: vendor auto-start ticked, panel power-cycled at the wall, and
      the player came back on its own
- [ ] Set the on/off schedule, then **pull the network cable** and confirm
      the schedule still fires. Schedules run on-device by design; a screen
      that only blanks when the internet is up is a broken screen.
- [ ] Trigger a test **emergency alert** from the dashboard while the
      screen is dimmed, and confirm it comes to full brightness and shows
      the alert. This is a life-safety product; a dimmed screen must never
      hide a lockdown or evacuation message. If it does not recover, stop
      and escalate — do not sign the ticket off.

Finally, re-run the fleet table and save it to the ticket:

```bash
bash scripts/fleet-display-probe.sh --out ~/Desktop/venue-fleet-final.md
```

---

## 9. Troubleshooting

**`need exactly ONE device connected (found 2)`**
Pass `--serial`. Get serials from `adb devices`.

**`adb devices` shows `unauthorized`**
The panel never showed, or you dismissed, the RSA prompt. Unplug, replug,
watch the panel. If it never appears: `adb kill-server && adb start-server`.

**Re-running on a screen that is already provisioned**
That is supported and expected. The script re-installs over the top,
skips device admin when it is already active, and skips device owner
when it is already held. You should see `✓ … skipped (idempotent)` lines
and the confirmation word should be `PROVISION`. If you ever see a red
`✗ dpm set-device-owner failed` on a correctly-provisioned screen, that
is a bug in the script, not a problem with the panel — do not act on any
factory-reset advice it prints.

**Device admin would not activate**
`dpm set-active-admin` is blocked on some vendor images. The script falls
back to launching Android's own "Activate device admin app?" screen on
the panel; tap **Activate**, then press Enter on the laptop. If the
screen never appears, the box may have no device-admin receiver at all —
the script says so. Blank/wake then runs on the software overlay, which
always works. Note it on the ticket; it is a vendor-image finding.

**Brightness slider does nothing after provisioning**
Check the probe's `writeSettingsAppop`. If it is not `allow`, the vendor
image is blocking appops over adb. Grant it by hand on the panel:
Settings → Apps → EduCMS Player → **Modify system settings** → allow.
That path needs no adb and no ownership. If that is also blocked, the
player falls back to software dim, which is safe. Note it on the ticket.

**The schedule fires minutes late**
Check `batteryOptExempt`. If it is `no`, the doze whitelist call was
refused. Operator fallback with no adb: Settings → Apps → EduCMS Player →
Battery → **Unrestricted**.

**The panel boots, shows the player briefly, then goes back to the vendor
home screen**
Almost always the vendor auto-start manager — §6a. Not a pairing problem,
not a network problem.

### Signing mismatch (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`)

A differently-signed build of the same package is already on the box —
usually a debug build, or the pre-2026-08 keystore. The fix is to
uninstall, and **uninstalling loses the screen's pairing**.

The script will **not** do this for you. On site:

1. Confirm which build is installed:
   `adb -s <SERIAL> shell dumpsys package com.educms.player | grep versionName`
2. If the box carries a `.debug` package, that is a bench unit that
   should never have gone to a site. Note it on the ticket.
3. Uninstalling is a decision, not a step. If you do it, the screen must be
   re-paired from the dashboard afterwards.

**The panel is blanked and I cannot wake it**
Blank is not a one-way state. Wake is a separate provider, and the player
carries a dead-man revert: an operator-initiated **test** action snapshots
the prior state and persists the pending revert to disk *before* the
action is applied, so it replays on next boot even after a process death.
An active emergency alert also force-releases any blank or dim. **The
guaranteed fallback is still physical: power-cycle the panel.** Verify the
revert behaviour yourself during §8 rather than taking this paragraph's
word for it — the first time you trust it should not be on a screen you
cannot reach.

---

## Appendix — the four scripts

| Script | Writes to the device? | What it is for |
|---|---|---|
| `scripts/display-capability-probe.sh` | **no** | one unit, the narrow capability verdict, `--human` / `--kv` / `--json`. The contract the other two consume. |
| `scripts/fleet-display-probe.sh` | **no** | every connected unit, one comparison table, `<< DIFF` markers, per-unit action list |
| `scripts/vendor-display-probe.sh` | **no** | deep recon dump for a **new hardware model**: binder services, vendor manifests, settings namespaces, optional APK pull. Not part of a routine install. |
| `scripts/provision-kiosk.sh` | **yes**, gated | install + appop + doze whitelist + device admin, with preflight, typed confirm, and a closing probe |

The two probes are different tools with different CLIs. `provision-kiosk.sh`
and `fleet-display-probe.sh` both call **`display-capability-probe.sh`**,
because it is the only one that emits `--kv`.

### Note on `deviceOwnerPath`

The field scripts emit exactly the three values the rest of the stack
knows — `held`, `blocked-other-owner`,
`provisionable-after-factory-reset` — matching
`packages/api-types/src/display-control.ts` and the in-app
`DisplayCapabilityProbe.kt`.

An earlier version of these scripts invented a fourth value,
`provisionable-now`, for a box with no owner and no accounts. Nothing
else in the stack knew it, so the dashboard and the field table said
different things about the same serial. That fact now rides its own
field-only key, **`deviceOwnerWindowOpen`**, which is never sent to the
dashboard. **If you add a value to `deviceOwnerPath`, you must add it to
the Kotlin probe, the API allowlist and the web allowlist in the same
change — or don't add it.**

### Known divergence: `screenBlank`

The field probe reports `screenBlank: device-admin` only when an active
device admin belongs to **our** package. The in-app Kotlin probe currently
reports it whenever *any* active admin exists. On a panel where the vendor
CMS holds an admin and we do not, the dashboard can therefore claim
`device-admin` where the field table honestly says `none` — and the
player's own `DeviceAdminBlankProvider` agrees with the field table
(`DevicePolicyManager` scopes `lockNow()` to the calling package, so
another app's admin grants us nothing). Blank/wake works either way, via
the software overlay; only the label differs. Read the field table as the
truth here until the Kotlin probe is tightened.
