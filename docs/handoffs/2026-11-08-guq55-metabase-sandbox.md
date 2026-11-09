# GUQ55 / Metabase 0.64: sandbox check of the legacy-engine layer (2026-11-08)

**Author:** Claude Opus 5.5 (Claude Code, worktree agent). This was a check only. No product code was changed, nothing was pushed, and no production system was touched.

## Situation

The Goodview GUQ55 runs Android 11 with system WebView 95.0.4638.74. On that panel, a Metabase 0.64 dashboard login fails. PR #258 (in Player 1.1.66-field.1) adds `apps/player/app/src/main/assets/legacy-engine-polyfills.js`, which `LegacyEngineCompat.kt` registers with `WebViewCompat.addDocumentStartJavaScript(wv, LegacyEnginePolicy.scriptFor(asset, skipOrigins), setOf("*"))`. The goal was to prove on an emulator that the layer fixes a real Metabase 0.64 login and dashboard, and that the login fails without it.

## What actually ran: this is not WebView 95

- **The plan to use a Chromium 95 WebView did not work.** The snapshot archive has no `Android_Arm64/` build at M95; the earliest is 1061375, around Chrome 107. The M95 build is `Android/920003/chrome-android.zip`, and it is armeabi-v7a (32-bit) only. It contains `SystemWebViewShell.apk`, `ContentShell.apk` and `ChromePublic.apk`, and no `SystemWebView.apk`.
- **The emulator cannot run 32-bit ARM code.** The API 30 arm64 image reports `ro.product.cpu.abilist=arm64-v8a` and an empty `abilist32`, and the Apple M5 host has no AArch32. `adb install ContentShell.apk` failed with `INSTALL_FAILED_NO_MATCHING_ABIS`. As a result, neither the system WebView provider nor a Chromium-95 content shell could be replaced.
- **The host I used was `SystemWebViewShell.apk` (M95, Java only, so it installs).** It runs on the image's stock provider, `dumpsys webviewupdate` → `(com.google.android.webview, 91.0.4472.114)`. The DevTools user agent was `... Android 11; sdk_gphone_arm64 ... Chrome/91.0.4472.114 ...` and V8 was 9.1.269.36.
- **How I brought 91 closer to 95.** The engine is older than the GUQ's. Metabase 0.64's `app-main` uses class static blocks (`class i extends o.Component{static{this.displayName=...}}`), which shipped in Chrome 94. On stock 91 both runs (with and without the layer) die at parse time with `SyntaxError: Unexpected token '{'` at app-main line 42, col 18877. To get past that, I enabled V8's own implementation with `/data/local/tmp/webview-command-line` = `_ --js-flags=--harmony-class-static-blocks` (userdebug image), then removed the flag afterwards.
- **The "95-surface" negative control.** It adds, before page scripts run, only the builtins that Chrome 92–95 ship natively and 91 lacks: `.at` (92) and `Object.hasOwn` (93). It contains nothing from our layer. The script is in `cdp-run.cjs`, mode `neg95`.
- **Injection method.** Every run used a fresh profile (`pm clear`). Over Chrome DevTools, the exact asset with the placeholder replaced by `[]` (the same as `scriptFor(asset, [])`) was registered with `Page.addScriptToEvaluateOnNewDocument` before navigation. That is the DevTools equivalent of `addDocumentStartJavaScript`. Metabase was the official `metabase/metabase:v0.64.x` image (it reported `v0.64.5.5`) at `http://10.0.2.2:3000`, with a throwaway local admin and one dashboard (a native SQL line chart on the sample database).

## Evidence

Raw logs and screenshots are in `docs/research/2026-11-08-guq55-metabase-sandbox/`, which is gitignored and exists on the lead's machine only.

| Run | Engine state | Result |
|---|---|---|
| `neg.json` / `pos91.json` | stock 91 | Both fail: `SyntaxError: Unexpected token '{'`, blank page. The layer cannot help with syntax. |
| `neg-sb.json`, `neg91-staticflag-after-login.png` | 91 + static blocks, no layer | Blank page: `TypeError: Object.hasOwn is not a function` (vendor bundle). |
| **`neg95.json`, `neg95-*.png`** | 91 + static blocks + 92–95 builtins (Chrome 95's builtin surface), **no layer** | The login form renders. Sign-in fails, and the form shows **`i?.throwIfAborted is not a function`** (`AbortSignal.prototype.throwIfAborted`, Chrome 100). The URL stays on `/auth/login`. This matches the field symptom. |
| **`pos-sb2.json`, `pos-1/2/3*.png`** | 91 + static blocks + **our layer** | Login → `/` ("How's it going, Sandbox?"). `/dashboard/2` renders 1 dashcard with the line chart (59 SVG paths) and no exceptions. |
| `sweep.json` | same, with layer | Nine routes all loaded with no `Runtime.exceptionThrown` and no "There was a problem": dashboard, saved question, collection, browse databases, ad-hoc table query, x-ray, admin settings, search, profile. |

Before page scripts ran, the layer reported every probed builtin as `function`: findLast, structuredClone, Object.groupBy, toSorted, Set#union, Promise.withResolvers, AbortSignal.any, .at and Object.hasOwn.

**Problem I caused and fixed:** the first positive dashboard showed "There was a problem displaying this chart." The cause was my own card SQL (`date_trunc`, while the 0.64 sample database is SQLite; the server returned 400). I fixed the card and reran. It was not a layer issue.

## Still broken or worth noting

- **Syntax cannot be polyfilled.** Metabase 0.64 needs class static blocks (Chrome 94+). Any panel whose WebView is below 94 cannot run it even with the layer, and the layer is installed for every major below 120. The GUQ's 95 is above this line. The regex `v` flag (Chrome 112) is absent on this engine (`Invalid flags supplied to RegExp constructor 'v'`), but no route I visited hit it. Lazy chunks I did not visit could.
- **Remaining warnings with the layer, none from the layer:**
  - `<svg> attribute height: Expected length, "max(375px, …"` — CSS `max()` in an SVG attribute, cosmetic.
  - `Failed to hash search term … reading 'digest'` — `crypto.subtle` does not exist on plain http, so this would not happen on an https Metabase.
  - x-ray `map.colors … toLowerCase` — modern Chromium 147 with no layer shows the same warning, so it is Metabase's own.
- **No gap in the polyfill was found for this flow.**

## What this does NOT prove

- It was not WebView 95.0.4638.74. The engine was 91 with static blocks switched on through a flag, plus a hand-added 92–95 builtin surface. Any 95-only engine behaviour other than those builtins and static blocks was not exercised.
- It was not the GUQ's firmware or hardware, and it was not our APK. The host was Chromium's WebView shell with DevTools injection, not `LegacyEngineCompat`'s real `addDocumentStartJavaScript` path. That path has its own gates: the version read, the `DOCUMENT_START_SCRIPT` feature check, the skip origins, and a website zone inside the player iframe. Those were not exercised here.
- Metabase was served on http, not https, so the secure-context APIs differ.
- **The field proof** is still Player 1.1.66-field.1 on the GUQ55 itself: the `PLAYER_LEGACY_POLYFILL installed webview=95 …` log line, followed by a real login on the glass.

## How to reproduce

The scripts are in the evidence folder: `cdp-run.cjs` (modes `neg`, `neg95`, `pos`), `cdp-sweep.cjs` and `modern-xray.cjs`. The AVD `venueos-a11-wv95` is kept. Its image lives under the Homebrew SDK root (`/opt/homebrew/share/android-commandlinetools`), symlinked into `~/Library/Android/sdk/system-images/android-30`. Approved downloads are in `/private/tmp/claude-501/guq55-sandbox-dl/`. The `metabase/metabase:v0.64.x` image is still in Docker; the container was removed.

**Next step for a true 95 engine on this Mac:** a Chromium 95 desktop build would be needed (for example the `Mac_Arm/` snapshot near 920003, if one exists, or `Mac/` under Rosetta), driven by Playwright `addInitScript`. That download was not approved, so it was not fetched.
