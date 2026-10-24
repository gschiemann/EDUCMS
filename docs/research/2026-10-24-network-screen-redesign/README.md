# Network screen redesign — screenshots (2026-10-24, player 1.1.54 field candidate)

Captured with `adb exec-out screencap -p` on the `educms-test` AVD (Android 14, arm64), headless,
`-skin 1920x1080`, density 320, the debug APK of this branch (`before-*` = the 1.1.53 build from
`master` at `068d331d`, same emulator and density).

## How the states were produced

- `after-01` … `after-37` use the **debug-only demo** (`adb shell settings put global
  venueos_network_demo <name>`; `src/debug/.../NetworkScreenDemo.kt`, the release twin returns
  null). The demo replaces the scan, the connection read, the VenueOS probe and the engine's
  answers with a script; everything on screen still goes through the real presentation code.
  Network names are invented.
- `after-40` … `after-45` are the **real engine, no demo**: Wi-Fi switched off on the emulator →
  the real boot "cannot reach the server" card → its Network button → "Turn on Wi-Fi" opens
  Android's own Wi-Fi panel; then a real join of the emulator's open `AndroidWifi` (Android's
  "Allow suggested Wi-Fi networks?" prompt, then the success after approval).
- `after-36` / `after-37`: the demo's "alert" closes the screen through the real alert close path
  (`NetworkScreen.REASON_ALERT`); reopening within five minutes resumes the step with an empty
  password field.
- Sizes: `after-50` 3840×2160 (density 320 — the 1.1.53 screen was tiny there, `before-04`),
  `after-51/52` 1440×1080, `after-53/54` portrait 1080×1920 (the player's own orientation
  switch), `after-55/56` the LED poster column (debug `venueos_force_poster`, cropped to the
  leftmost 330 px; `before-05` shows 1.1.53 centring its card in the 1920 px frame buffer, off
  the LED).

## Not shown / not verified

- No physical panel: Android 7 / 9 GPUs, OEM WebViews and real remotes were not exercised.
- A real wrong password, a real Ethernet cable and a real legacy (Android ≤ 9) switch-and-prove
  were not available on the emulator; those states are the demo's.
- A real emergency hold was not raised; the alert gating code is unchanged and unit-tested.
