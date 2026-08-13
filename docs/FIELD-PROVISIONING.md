# Field provisioning runbook — display control on Goodview panels

**Audience:** whoever is physically standing at the screen with a laptop
and a USB cable. Read steps 1–9 in order. Do not improvise.

**Why this trip matters:** device owner is a **one-way door**. It can only
be taken while the panel has no accounts and no extra users. Miss it and
the only way back is a **factory reset**, which on a Goodview panel also
**wipes the vendor CMS configuration** — network profile, panel timers,
input mapping, everything the installer set in the vendor UI. There is no
"retrofit it later over the network" path. This trip is the window.

**What device owner buys us:** remote **reboot**. That is the only
capability with zero fallback. Everything else (volume, brightness,
blank/wake) works without it, in some degraded form. See §7 for the exact
loss table.

---

## 0. What you need before you leave

- [ ] Laptop with `adb` on PATH (`adb version` prints something)
- [ ] `gh` CLI logged in (`gh auth status`) — or the two APKs on disk
- [ ] USB-A→USB-B / USB-C cable that actually carries data
- [ ] This repo checked out (the scripts live in `scripts/`)
- [ ] A pen. You will be writing down vendor CMS settings.
- [ ] The dashboard open, logged in, on the Screens page

Sanity check on the laptop before you drive:

```bash
adb version
bash scripts/provision-kiosk.sh --help
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

## 2. BEFORE YOU TOUCH ANYTHING — photograph the vendor CMS config

Do this on **every** unit, even the ones you expect to be factory-fresh.

Open the vendor's own settings app and photograph, screen by screen:

- Network / Wi-Fi profile (SSID, static IP, DNS, proxy)
- Panel power timers / scheduled on-off already configured in the vendor UI
- Input source mapping, orientation, resolution
- Any vendor account / license key on the box

If a factory reset ever becomes the right call (§5), these photos are the
only thing standing between you and a second truck roll.

---

## 3. Probe all three units at once, before provisioning any of them

Plug in all three (a powered USB hub is fine), then:

```bash
bash scripts/fleet-display-probe.sh
```

This is **strictly read-only**. It writes nothing, installs nothing,
reboots nothing. Safe on a live screen mid-day.

You get one table, one column per unit, with `<< DIFF` on every row where
the units disagree. Three panels off the same pallet are routinely NOT
identical — different firmware date, one already carrying the vendor CMS
as device owner, one with a world-writable backlight node.

Read the **VERDICT** block and the **ACTION PER UNIT** block. Keep a copy:

```bash
bash scripts/fleet-display-probe.sh --out ~/Desktop/venue-fleet.md
```

Attach that file to the install ticket.

---

## 4. THE DECISION TREE

Look at `deviceOwnerPath` for each unit.

```
deviceOwnerPath = held
    └─ Device owner is already ours. Nothing to decide.
       → go to §6, run provision-kiosk.sh normally (it is idempotent
         and will skip the device-owner step).

deviceOwnerPath = provisionable-now
    └─ THE WINDOW IS OPEN. No accounts, no extra users, no other owner.
       → go to §6 and provision it NOW, on this trip, before anyone
         signs into anything on this panel.
       Do NOT let anyone add a Google account "just to get the store"
       between now and provisioning. That closes the window.

deviceOwnerPath = blocked-other-owner
    └─ The VENDOR'S OWN app already holds device owner (the probe prints
       which package). We cannot take it. Full stop.
       → Remote reboot is OFF THE TABLE on this unit unless you factory
         reset — see §5 before you even consider that.
       → go to §6 and run with --no-device-owner. You still get volume,
         brightness and blank/wake.

deviceOwnerPath = provisionable-after-factory-reset
    └─ No other owner, but accounts and/or extra users are already on the
       box, so Android will refuse `dpm set-device-owner`.
       → Decide on site using §5.
       → If you decide NOT to reset: §6 with --no-device-owner.
```

---

## 5. The factory-reset decision (read this twice)

A factory reset is **not a brick**. The panel comes back. But it **wipes
the vendor CMS configuration** you photographed in §2, and if you did not
photograph it you are rebuilding it from memory on a ladder.

Reset only if **all** of these are true:

- [ ] Remote reboot genuinely matters for this screen (unreachable
      mounting, no local staff, a history of hangs)
- [ ] You have §2's photos, complete, on this laptop
- [ ] `deviceOwnerPath` is `provisionable-after-factory-reset`
      (accounts in the way), **not** `blocked-other-owner`
- [ ] You have time on site to re-enter the vendor config afterwards

**`blocked-other-owner` is different and worse.** A reset removes the
vendor's device-owner app too, and on some vendor images that app is what
provisions the panel's network profile and firmware update channel. Do not
reset a `blocked-other-owner` unit without the vendor's own instructions.

**The scripts will never factory reset for you.** There is no flag for it.
It is a human decision, made by hand, in the panel's own recovery UI.

If you do reset:

1. Reset from the panel's Settings → System → Reset.
2. Walk the setup wizard. **Skip every account prompt.** No Google
   account, no vendor account, no Wi-Fi login that creates an account.
3. Re-enable USB debugging (§1).
4. Re-run `scripts/vendor-display-probe.sh` — it must now say
   `provisionable-now`.
5. Provision (§6) **before** re-entering the vendor CMS config, so nothing
   re-adds an account behind your back.
6. Re-enter the vendor config from your §2 photos.

---

## 6. Provision the unit

Dry run first. It changes nothing and prints the exact plan:

```bash
bash scripts/provision-kiosk.sh --serial <SERIAL> --dry-run
```

Read the plan. Steps marked `[WRITES]` change the device. Then, for real:

```bash
# window open — take device owner
bash scripts/provision-kiosk.sh --serial <SERIAL>

# vendor holds device owner, or you chose not to reset — limited mode
bash scripts/provision-kiosk.sh --serial <SERIAL> --no-device-owner
```

The script will:

1. Run the read-only preflight and print what this unit will and will not
   be able to do.
2. Print the plan.
3. **Ask you to type a confirmation word.** It is `DEVICE-OWNER` when the
   one-way-door step is in the plan, and `PROVISION` when it is not. This
   is deliberate: typing `DEVICE-OWNER` means you read §4 and §5.
4. Install Manager, then Player (`install -r` — never uninstalls, so the
   screen keeps its pairing).
5. Set device owner, if the plan says so.
6. Grant the `WRITE_SETTINGS` appop to the Player, which the brightness
   provider needs for the `Settings.System` path.
7. Re-run the capability probe and print the final verdict.

**It is idempotent.** Re-running is safe and is the correct response to
almost any hiccup. It never uninstalls, never resets, never reboots.

If you are scripting a bench run and there is no terminal to type into,
pass `--yes`. Without a terminal and without `--yes` the script refuses to
run rather than guessing.

---

## 7. What is LOST if device owner cannot be taken

This is the whole cost, stated plainly. It is one row.

| Capability | With device owner | WITHOUT device owner |
|---|---|---|
| **Volume** | works (AudioManager) | **works — identical.** No loss. |
| **Brightness** | works | **works — identical.** Real backlight when the panel exposes a writable sysfs node, otherwise `Settings.System`, otherwise software dim. Device owner changes none of this. |
| **Blank / wake** | real screen-off via device policy | **works, degraded.** Plain device admin (`lockNow`) still blanks the panel for real. With no admin at all it falls back to a full-screen black overlay — the image goes black but the LCD backlight stays lit, so there is **no power saving**. |
| **Scheduled on/off** | runs on device via AlarmManager | **works — identical.** The schedule is local; it survives a network outage either way. |
| **Reboot** | works | **GONE. No fallback exists.** A hung unit needs a human with a power cord. |
| **Silent OTA** | silent, hands-free | **degraded.** Updates raise the Android "Install?" prompt, which nobody is standing there to tap. |

So: losing device owner costs you **remote reboot** and **hands-free OTA**.
Everything the operator sees on the display-control panel still functions.

**The dashboard will tell the truth about this.** Controls are gated on
what the screen actually reported. A panel that only does software dim
says so on the slider ("dims the image only — this box exposes no
backlight control"). A panel with no device owner does not render a reboot
button at all. Nothing is a costume.

---

## 8. Verify before you leave the site

Do not pack up until all of these are true, per screen:

- [ ] `bash scripts/vendor-display-probe.sh --serial <SERIAL>` verdict
      matches what you expected from §4
- [ ] The screen appears **online** on the dashboard Screens page
- [ ] Dashboard → Screens → this screen → Display: move the **volume**
      slider, hear/see it change
- [ ] Move the **brightness** slider; confirm the panel responds, and that
      the UI label matches reality (real backlight vs software dim)
- [ ] Hit **Blank**, watch the screen go dark, hit **Wake**, watch it come
      back. Do not leave a screen blanked.
- [ ] If device owner was taken: press **Reboot** once, watch it come back
      on its own, and confirm it re-pairs without help. This is the single
      most valuable test of the whole trip — it is the thing you cannot
      re-test remotely.
- [ ] Set the on/off schedule, then **pull the network cable** and confirm
      the schedule still fires. Schedules run on-device by design; a screen
      that only blanks when the internet is up is a broken screen.

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

**`dpm set-device-owner failed`**
Something added an account or a second user between the preflight and the
attempt. Re-run the script — the preflight will now report it. Do not
factory reset without §5.

### Signing mismatch (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`)

A differently-signed build of the same package is already on the box —
usually a debug build, or the pre-2026-08 keystore. The fix is to
uninstall, and **uninstalling loses the screen's pairing**; if Manager is
device owner, Android refuses the uninstall outright.

The script will **not** do this for you. On site:

1. Confirm which build is installed:
   `adb -s <SERIAL> shell dumpsys package com.educms.player | grep versionName`
2. If the box carries a `.debug` package, that is a bench unit that
   should never have gone to a site. Note it on the ticket.
3. Uninstalling is a decision, not a step. If you do it, the screen must be
   re-paired from the dashboard afterwards, and any device owner held by
   Manager blocks the Manager uninstall entirely (factory reset territory
   — back to §5).

**Brightness slider does nothing after provisioning**
Check the probe's `writeSettingsAppop`. If it is not `allow`, the vendor
image is blocking appops over adb. The player falls back to software dim,
which is safe. Note it on the ticket; it is a vendor-image issue, not a
site issue.

**The panel is blanked and I cannot wake it**
Blank is not a one-way state. Wake is a separate provider, and the player
is specified to carry a dead-man revert: an operator-initiated **test**
action snapshots the prior state, and the pending revert is persisted to
disk *before* the action is applied, so it replays on next boot even after
a process death. **The guaranteed fallback is still physical: power-cycle
the panel.** Verify the revert behaviour yourself during §8 rather than
taking this paragraph's word for it — the first time you trust it should
not be on a screen you cannot reach.

---

## Appendix — the three scripts

| Script | Writes to the device? | What it is for |
|---|---|---|
| `scripts/vendor-display-probe.sh` | **no** | one unit, full capability verdict, `--json` / `--kv` for tickets and tooling |
| `scripts/fleet-display-probe.sh` | **no** | every connected unit, one comparison table, `<< DIFF` markers, per-unit action list |
| `scripts/provision-kiosk.sh` | **yes**, gated | install + device owner + `WRITE_SETTINGS` appop, with preflight, typed confirm, and a closing probe |

### Note on `deviceOwnerPath` values

The in-app probe's spec enumerates three values: `held`,
`blocked-other-owner`, `provisionable-after-factory-reset`. The field
scripts also emit a fourth, **`provisionable-now`**, for a box with no
owner and no accounts. Collapsing that case into
`provisionable-after-factory-reset` would tell a tech to wipe the vendor
CMS config on a unit that needs no reset at all — the exact mistake this
runbook exists to prevent. If the in-app probe is ever made the sole
source of this field, it needs the same fourth value.
