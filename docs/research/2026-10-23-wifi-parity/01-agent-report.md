# Wi-Fi setup on every Android class — agent report (2026-10-23)

PR https://github.com/gschiemann/EDUCMS/pull/148, branch `worktree-agent-accdcdffef6f449ff`, head `47eb947b`. Not merged / tagged / registered. Nothing proven on a real panel. CI: 16/17 green; Production Dependency Audit red on a new upstream advisory `zod <4.6.6 GHSA-mrhx-c7xc-m3w5` (HIGH) that will hit master too (fix = `pnpm.overrides` floor). Persisted by the lead per CLAUDE.md agent rule 8.

Owner's ask: "Build WiFi for every machine we possibly can including the new media player… parity across all machines… few exceptions", then "just the settings users would want, wifi and ethernet being number 1".

## Per class (auto by SDK, no setting)
| Class | SDK | Screens | Mechanism | Silent / tap | Exceptions |
|---|---|---|---|---|---|
| rk3288 (DH43, A-Frame) | 25 | 13 | `addNetwork`/`enableNetwork`/`saveConfiguration` | Silent | No WPA3; waits while Wi-Fi off; leaves a same-name network someone else saved; never rewrites the in-use network's password |
| x30a4 (Android-9 Goodview) | 28 | 3 | same | Silent | same |
| GUQ M43/M55/M65/M86 | 30 | 7 | `WifiNetworkSuggestion`; Android's save dialog if "save permanently" ticked or suggestions declined | approval once (notification) or one tap | Android 11 never reports approval; older VenueOS suggestions removed only while Wi-Fi carries no traffic; dialog only where a Settings page answers it |
| rk356x (Taurus), X80 rk3328, OptiSigns | 30 | 4+3+1 | same as GUQ | same | same |
| L55VEC, t982_ar301 | 33 | 1+1 | existing suggestion path + dialog option | approval once (readable) or one tap | — |
| EC3576 (new) | 34 | 1 | same as L55VEC | same | — |

Everywhere: no static IP/DNS/proxy/Ethernet settings (no public API — dashboard and screen point to Android settings); never turns the Wi-Fi radio on; connected network name needs location access + Location on (Android ≤ 9 reads the saved list); Android 10+ hides user-saved networks (the "saved" mark covers VenueOS's only); enterprise/WEP/OWE listed but not joinable.

## Never strand (Android ≤ 9)
Records the network as VenueOS's before adding; saves before any switch; switches only when traffic is on another Wi-Fi network; the way back is on disk first; keeps the new network only if VenueOS's server answers over Wi-Fi within 60 s, else switches back and does not retry on its own (Save in the dashboard retries); an alert during a switch sends it straight back; on 7.1 other networks are re-enabled before saving; only VenueOS's own networks are removed, never the one in use; a process death/reboot mid-switch is finished or undone by the heartbeat loop even without the server.

Outcomes: 14 new reason codes, additive, no new status values. Dashboard says per screen what happens before Save, offers "save permanently" only where the dialog exists, hides WPA3 where unsupported, shows the connection line; en/es/zh. API: saving a network the screen gave up on counts as a new identity (retry).

## Engine + on-screen Network screen
- `settings/`: `WifiScan` (≤ 1 scan / 30 s; "location off" is its own state), `NetworkStatus`, `WifiConnect.connect()` (the single on-screen entry, same engine as a dashboard push).
- `player/network/NetworkScreen.kt`: nearby networks (signal, lock, connected/saved), VenueOS's own D-pad keyboard, hidden network by name, plain-word results ("Could not join X. Still on Y."), Ethernet read-only + "Advanced: Android network settings" (reuses `openNetworkSettings()`). Entry: boot card's Network button (Android settings stays the fallback) and a Network entry in the Back menu. Never opens during an alert hold; closes the moment one starts; the boot card can no longer take focus from it. Strings en / values-es / values-zh.
- New bridge method `openNetworkScreen` (the Back menu is web UI): three-file contract, kept out of `KNOWN_METHODS`, version floor 1.1.53 (`METHOD_FLOORS` in `nativeBridge.ts`); canaries 36 → 37.
- Correction to the brief: NEARBY_WIFI_DEVICES does not unlock `getScanResults` (API-34 docs need ACCESS_FINE_LOCATION + Location on), so location is requested on every version, only when a person presses "Allow" on the Network screen; no location is read.

## Tests
Player `testDebugUnitTest lintDebug`: 1,381 tests, 0 failed, lint no errors. New: `WifiSetupPolicyTest` 17, `LegacyWifiEngineTest` 12, `NetworkPolicyTest` 8, `NetworkScreenModelTest` 6 (+ extended policy/facts/wire/wiring/bridge canaries; new classes added to `scripts/check-player-test-execution.cjs`). api-types 453; API 622 incl. the Kotlin↔TS drift guard; tsc clean. Web tsc 0 errors; 2,136 tests across player + screens; i18n parity 5,931 keys; mobile-perf-guard clean.

## Unverified (needs panels)
Legacy behaviour on real Android 7/9 (connect disabling others on 7.1, saved-list current-network mark, 60 s proof + rollback); the save dialog on each OEM build with a remote; Android's permission/approval prompts (incl. the Android 11 notification) with a remote; the Network screen + keyboard on glass incl. LED poster widths. Emergency rule covered by pure + source-order tests only.

## Rollout
API + dashboard can deploy first; 1.1.42–1.1.52 APKs unaffected; a new APK on an old API drops unknown reason codes and ignores new report blocks.
