# APK Testing — verifying the player on older Android WebViews

## Web changes vs APK changes

The APK is a thin Android wrapper around a system WebView. On boot it loads
`BuildConfig.PLAYER_BASE_URL`, which defaults to `https://venue-os.app/player`
(`apps/player/app/build.gradle.kts:200-204`, overridable with
`-PplayerBaseUrl=` or the `PLAYER_BASE_URL` env var).

So **anything that lives in the Next.js bundle ships without an APK rebuild.**
Deploy to Vercel, and the fleet picks it up on the next page load; the service
worker then caches the new assets. The capability-detection layer (commit
`3efd74f4`, "feat(player): Android 7→14 capability detection + auto-fallback
layer") is part of that bundle, not the wrapper.

**The APK itself must change when:**

- A new Android-side native bridge method is added. That is a three-file atomic
  contract (Kotlin `METHODS` + dispatch arm, web `NATIVE_VOID`/`VALUE_METHODS`,
  canary count in `nativeBridge.test.ts`), and a new method must stay out of
  `KNOWN_METHODS` until the fleet floor includes the APK that implements it —
  see CLAUDE.md "Player Reliability", rule 9.
- The splash screen, app icon, package signature, or manifest changes.
- A security fix lands in the wrapper.

## Testing an older WebView without rebuilding the APK

### 1. UA override in desktop Chrome — layout only

Setting the User-Agent to an old Android WebView string changes the string, not
the engine, so `detectCapabilities()` still reports *your* Chrome's real feature
support. Useful for checking how the player lays out at 1920×1080. It does not
test old-engine compatibility. Do not treat a pass here as evidence.

### 2. BrowserStack / Sauce Labs — real older Android devices

Pick an Android 7 or 8 device, open `https://venue-os.app/player`, and read the
console for the `[Player] capabilities` line
(`apps/web/src/app/player/page.tsx:2074`).

The player needs to be paired before it will show assigned content, so an
unpaired remote device will sit on the pairing/connecting surface. That is still
enough to read the capability snapshot, which is what this path is for.

### 3. Real hardware — the qualification path

This is the only path that produces production confidence, and for a release it
is mandatory, not optional (see "Releasing an APK" below).

```bash
adb shell am start -n com.educms.player/.MainActivity \
  -d "https://venue-os.app/player?devmode=1"
adb logcat | grep '\[Player\]'
```

The `applicationId` is `com.educms.player`
(`apps/player/app/build.gradle.kts:13`); debug builds append `.debug`
(`:334`), so a debug install is `com.educms.player.debug/.MainActivity`.

Expected logcat output:

```
I/Console: [Player] capabilities { chromium: 78, modern: false,
            containerQueries: false, backdropFilter: true,
            h265: false, av1: false }
```

`modern` is `chromiumMajor >= 95` (`apps/web/src/lib/capabilities.ts:297`).

## What falls back to what

Thresholds are declared in `apps/web/src/lib/capabilities.ts`:

- Container queries (`container-type: inline-size`) — Chromium 105+ (`:75-76`).
  Below that, widgets fall back to width-based grid layouts.
- `backdrop-filter: blur()` — Chromium 76+ (`:79-80`). Below that, glass cards
  render as solid translucent panels.
- `IntersectionObserver` — Chromium 51+ (`:93`); `ResizeObserver` — Chromium 64+
  (`:95`). Both are lazily polyfilled by `ensurePolyfill()` (`:379`, registry at
  `:333-337`).
- Video codec selection — `pickBestVideo()` (`:413`) picks the best supported
  candidate from a list of `{ url, codec }` variants.

Full feature matrix in `docs/ANDROID_COMPATIBILITY.md`.

## Which widgets actually use the capability layer

| Widget | Uses capabilities? | Evidence |
|---|---|---|
| `StreamingWidget` | Yes — imports `detectCapabilities` + `pickBestVideo` (`StreamingWidget.tsx:58,103`); hls.js is dynamically imported only when `canPlayType('application/vnd.apple.mpegurl')` is empty, i.e. non-Safari (`:205-216`) | verified |
| Glass / backdrop themes | No — CSS `@supports`, auto-fallback | pure CSS path |
| Container-query layouts | Mostly CSS `@supports` | not audited widget-by-widget |
| Video widget (asset playback) | No | would need `pickBestVideo` once a transcode pipeline exists |
| Everything else | No | the capability layer is only needed past the universal baseline |

Embeds are restricted to an allowlist — `youtube.com`, `youtube-nocookie.com`,
`youtu.be`, `twitch.tv`, `vimeo.com`, `kick.com`
(`apps/web/src/components/widgets/streaming-hosts.ts:24-31`). For HLS testing,
the integrations page lists Mux's public test-stream bucket
(`apps/web/src/app/[schoolId]/settings/test-integrations/page.tsx:554`).

## Building an APK

The Gradle project is `apps/player/` (there is no `android-player/` directory).

**The wrapper is not committed.** Only `apps/player/gradle/wrapper/gradle-wrapper.properties`
is tracked — there is no `apps/player/gradlew` and no `gradle-wrapper.jar` in the
repo, so `./gradlew` fails on a fresh clone. Generate it once with a system
Gradle 8.7 (the version pinned in `gradle-wrapper.properties`), exactly as CI
does (`android-player-apk.yml:106-120`):

```bash
cd apps/player
gradle wrapper --gradle-version 8.7   # once, only if ./gradlew is missing
chmod +x gradlew
./gradlew assembleDebug
# → apps/player/app/build/outputs/apk/debug/*universal*.apk
#   (the CI workflow locates it with exactly that glob — android-player-apk.yml:350)
```

There is no `assembleUniversalDebug` task — "universal" is an ABI *split*
output, not a product flavor. `apps/player/app/build.gradle.kts:220-227` enables
`splits { abi { ... } }` for `armeabi-v7a`, `arm64-v8a`, `x86_64` with
`isUniversalApk = true`, so one `assembleDebug` produces the three per-ABI APKs
plus a universal one. Note the ABI list does **not** include 32-bit `x86`.

`minSdk = 24` (`:15`), so the APK installs on Android 7.0 and up.

## Releasing an APK — tested AND hardware-qualified

Green CI is a unit-test claim, never a fleet claim. Do not hand-tag a release.

```bash
scripts/release-apk.sh player 1.1.18
git push origin master player-v1.1.18   # ONE atomic push — see CLAUDE.md rule 13
```

`scripts/release-apk.sh` bumps `versionCode`/`versionName` in
`build.gradle.kts`, commits, and tags in one step, and **refuses to tag a
version that has not been qualified on real hardware** — it runs
`scripts/check-hardware-qual.cjs` against `apps/player/HARDWARE-QUALIFICATION.md`
(`release-apk.sh:12-22`). Run the checklist in
`docs/player/HARDWARE-QUAL-CHECKLIST.md` on the glass first. Never invent a PASS
row; untested is `UNQUALIFIED`, and `--unqualified-override` is logged hotfix
debt.

The workflow is **`.github/workflows/android-player-apk.yml`** ("Android Player
APK"). It does **not** build on every push to master — that was removed
2026-08-04 because it burned the Actions budget for zero signal. It runs on:

- push of a `player-v*` or `manager-v*` tag (`:25-34`);
- `workflow_dispatch`, with an optional `playerBaseUrl` input for staging builds
  (`:35-40`) — `gh workflow run android-player-apk.yml --ref <branch>`.

Gates that run **before** any assemble, in order:

1. **Hardware qualification** (release tags only) — `check-hardware-qual.cjs`
   (`:175-176`). The same gate `release-apk.sh` runs locally, so tagging an
   unqualified version only fails later and louder.
2. **`testDebugUnitTest` + `lintDebug`** (`:209-214`).
3. **`check-player-test-execution.cjs`** (`:234-236`) — proves the gating tests
   actually ran rather than being skipped.

After the build: a non-debuggable guard on release tags (`:463-465`), the
GitHub Release attach (`:474-479`), and a non-blocking publish to the private
`apks` storage bucket (`:542-543`).

Artifacts are downloadable from the run: `edu-cms-player-apk` (`:383-386`) and
`edu-cms-manager-apk` (`:429-432`). The build uses `assembleRelease` when the
signing secrets are present and falls back to `assembleDebug` when they are not
(`:273-277`).

## Known APK-side gaps

These need wrapper changes, not bundle changes. None are implemented:

- System WebView version probe at boot, so the APK can refuse to run on a
  too-old Chromium with an upgrade prompt.
- Native PiP for the streaming widget.
- Hardware codec detection injected into the web layer — some Android devices
  decode H.265 in hardware but report it unsupported via `canPlayType`; the APK
  could probe `MediaCodec` directly.
- Battery / power-save hints to throttle the manifest poll cadence.
