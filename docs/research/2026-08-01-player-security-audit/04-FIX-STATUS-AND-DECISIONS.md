# Fix Status & Decisions Required — 2026-08-01

Branch: **`security/player-fixes-2026-08-01`** (8 commits, local only, **not pushed**).
Audit docs branch: `security/player-audit-2026-08-01` (local only).

---

## What is merged and VERIFIED

| Area | Verification actually run by the lead | Status |
|---|---|---|
| **Web player** (R-01 `?api=`, R-04 SSE parity, R-05 consumer) | `tsc --noEmit` clean; 4 suites / 57 tests pass; inset-serialization + mobile-perf guards clean | ✅ VERIFIED |
| **API realtime** (R-02 channel binding, R-03 frame cap, R-05 server, R-07 caps, R-08 doc) | non-incremental `tsc --noEmit` clean; **full API suite: 132 suites / 1758 tests pass** | ✅ VERIFIED |
| **Build/CI** (release signingConfig, `isDebuggable=false`, debuggable gate, keystore guard) | Ran both guards myself. Debuggable guard exits **1** on the real shipped `edu-cms-player-v1.0.52.apk`, **0** with the documented escape hatch. Keystore guard exits 0 with the dated exception | ✅ VERIFIED |
| **Android Kotlin** (AND-001/003/005/006/007/008) | ⚠️ **NOT COMPILED** — see below | ⛔ BLOCKED |

### Independent confirmation of PLAYER-SIGN-02
The new guard was run against a **real distributed APK** (`~/Downloads/edu-cms-player-v1.0.52.apk`),
not a merged manifest: `android:debuggable=true on <application>`, cross-checked with `aapt2`
(`...android:debuggable(0x0101000f)=true`). All three historical releases tested are debuggable.
This is no longer inference from build output — it is the binary that shipped.

---

## ⛔ BLOCKER 1 — the Kotlin is uncompiled and cannot be compiled on this machine

920 lines changed across 9 Kotlin files, including two new files
(`security/HostAllowlist.kt`, `security/OperatorPinGate.kt`).

There is **no JDK on this machine** (`java -version` → "Unable to locate a Java Runtime"; no
`/Library/Java/JavaVirtualMachines`; Android Studio not installed). The Android SDK is present but
Gradle cannot run without a JDK. Verification done is limited to a comment/string-aware
brace-balance check and careful reading. The agent self-rated `MainActivity.kt` and
`OperatorPinGate.kt` as the lowest-confidence edits.

**Nothing in `apps/player/**` may reach a screen until CI has actually built it.**
`.github/workflows/android-player-apk.yml` triggers on push to `master`/`main` and on tags — it does
NOT build feature branches. Options: `gh workflow run android-player-apk.yml --ref <branch>`
(the workflow has `workflow_dispatch`), or install a JDK 17 locally and run
`cd apps/player && ./gradlew assembleDebug`.

---

## ⛔ BLOCKER 2 — AND-004's PIN gate is on the wrong layer. DO NOT SHIP AS-IS.

**The agent's fix does not stop the attack, and it breaks a working operator feature.**

Verified by the lead in `apps/web/src/app/player/page.tsx:6497-6550`. The operator unpair is a
documented three-layer teardown, and the layers run in this order:

1. `:6527` — **SERVER**: `POST /api/v1/screens/unpair/:fp` with the device token.
2. local storage clear.
3. `:6550` — **NATIVE**: `EduCmsNative.unpair()`.

The new gate sits on step 3. By then step 1 has already run and **the screen is off the emergency
channel** — which is the entire harm AND-004 was raised to prevent. Meanwhile the gate fails closed
when no PIN is configured, and:

- **No PIN provisioning path exists.** `usb/UsbIngestActivity.kt:25-27` says verbatim *"V1 scaffold:
  no PIN prompt yet."* The AndroidManifest comment claiming a PIN prompt is stale. Today a PIN can
  only be seeded by MDM writing `edu_player`/`operator_pin`.
- So on **every currently deployed screen**, the on-device "Exit to device home" escape hatch would
  become permanently unusable.

Net effect as implemented: no security gain, one broken operator escape hatch.

### The correct fix
Gate the unpair **before the server call** — either in the web player's operator UI
(`page.tsx` around `:6497`, require a PIN/confirmation before `POST /screens/unpair`), or
server-side (require operator re-auth on the unpair endpoint rather than accepting the device token
alone). The native gate can stay as defence-in-depth *after* that, but only once a provisioning path
exists.

**Recommendation: drop the AND-004 wiring from this release; keep `OperatorPinGate.kt` on the branch
unwired for the follow-up.** All other AND-* fixes in the same commit are sound and independent.

---

## Decisions only Greg can make

### 1. `NEXT_PUBLIC_API_URL` — two separate things hinge on this
Check **Vercel → Settings → Environment Variables**.
- **Sets INJ-001's severity.** If it points at the app's own origin (relying on the `vercel.json`
  rewrite), the proxy iframe is same-origin and INJ-001 is **CRITICAL** — full player takeover
  including device-token theft. If it points at the Railway host (as `.env.example:71` documents),
  it is **HIGH**. Contradicting evidence: `webpage-spatial-nav.ts:22-26` asserts same-origin and
  `:249-265` calls `iframe.contentWindow.eval`, which throws cross-origin — so either that feature
  is silently broken in production, or the deployment IS same-origin.
- **Fleet-breaking risk for the new Android allowlist.** `HostAllowlist.kt` permits
  `BuildConfig.PLAYER_BASE_URL`'s host plus `venue-os.app`,
  `api-production-39a1.up.railway.app`, `github.com`. `apps/web/vercel.json` confirms the Railway
  host, so this looks correct — **but confirm before the APK ships.** If prod ever uses a different
  API host, native heartbeat and OTA stop fleet-wide.

### 2. The signing-key cutover — bigger than previously described
The shipped package is **`com.educms.player.debug`** (the debug buildType applies
`applicationIdSuffix = ".debug"`). A release build is `com.educms.player` — to Android that is a
**different app**, installed side-by-side, not an update. So the cutover is "install a new app and
remove the old one" on every screen, not "reinstall with a new key." Manager already probes both
package ids (`OtaWorker`, `ManagerApp`, `OtaInstaller`, `RollbackInstaller`), so a mixed fleet
survives. Runbook: `apps/player/RELEASE_SIGNING.md`. Single step to finish: delete the two `env:`
lines from the `Guard — published APK must not be debuggable` step in
`.github/workflows/android-player-apk.yml`.

### 3. Pushing to a PUBLIC repo — a disclosure decision
`github.com/gschiemann/EDUCMS` is public. Both branches carry commit messages and docs that describe
**live, unfixed** vulnerabilities in exploitable detail. Pushing publishes a working roadmap for
attacking every deployed screen before the fixes are on those screens.

Options: (a) keep local until the fleet is patched; (b) rewrite commit messages to terse
non-exploitable wording and push code-only, keeping `docs/research/2026-08-01-player-security-audit/`
local; (c) make the repo private. **The lead did not push anything.**

### 4. `R-02`'s compat flag must be flipped in a SECOND deploy
`ACCEPT_LEGACY_UNBOUND_WS_SIG = true` keeps rolling deploys safe (old replicas still sign unbound;
dropping those mid-rollout would lose emergency messages). While true, a legacy envelope captured
within the 120 s freshness window can still be replayed cross-tenant. **R-02 is not closed until the
follow-up deploy flips it to false.** A test pins the post-flip contract, so it is a one-line change.

### 5. `AND-005` — `showUrlOverlay` was deliberately NOT host-allowlisted
It is the native renderer for `text/html` **playlist items** (`page.tsx:6288-6296` builds the URL
from `current.asset.fileUrl`), and `MainActivity`'s comments cite an operator loading `e-arc.com`.
Pinning it to first-party hosts would silently kill a shipped feature on every APK kiosk. Scheme +
parse + `userInfo` checks were applied instead. If URL items must be first-party, it is a one-line
swap documented in the `WebAppBridge.kt:234` KDoc.

---

## Still open (not fixed, not audited)

- **AND-002** — the JS bridge is reachable from every frame. Plan only; nothing implemented, on
  purpose. The agent verified from this project's own Gradle cache that `androidx.webkit 1.11.0`
  ships `WebViewCompat.addWebMessageListener` with the signature
  `onPostMessage(WebView, WebMessageCompat, Uri sourceOrigin, boolean isMainFrame, JavaScriptReplyProxy)`
  — origin **and** main-frame flag, exactly what is missing. Gated at runtime by
  `WebViewFeature.isFeatureSupported(WEB_MESSAGE_LISTENER)` (WebView M77+, so the Chromium 83-87
  Taurus fleet is covered), **not** `Build.VERSION.SDK_INT`. Scope: 9 fire-and-forget methods migrate
  cleanly; **8 return values synchronously** and must become Promise-based on the web side. Because
  the APK and web bundle deploy independently, both surfaces must coexist for at least one release.
  An interim nonce was evaluated and rejected — it changes all 17 call signatures and would break the
  currently-shipped web player the moment a kiosk took the APK update.
- **INJ-001/002/003** — no fix written yet. Sandbox the WEBPAGE iframe + move the proxy to a
  dedicated origin; add a CSP to the player route; stop CONTRIBUTORs editing live-bound templates
  with zero review (INJ-003 is what makes the chain reachable without an admin).
- **INJ-004/005/006** — designer marker-substring trust, holiday-board `allow-same-origin` +
  `allow-scripts`, STREAMING unallowlisted iframe.
- **Unaudited surfaces:** device tokens, OTA API-side authz, manifest tenant isolation, operator
  account blast radius, and `apps/edge/` (zero coverage).
- **Two more stale Ed25519 claims** survive R-08's fix, outside that agent's domain:
  `docs/spec/THREAT_MODEL.md:74` and
  `docs/research/2026-06-09-prelaunch-final-audit/01-emergency-realtime.md:137`.
- **`proguard-rules.pro` was created but is UNVERIFIED.** The release variant has never been built,
  yet `proguardFiles` referenced a file that did not exist. R8 stripping a `@JavascriptInterface`
  method does not crash — the JS call silently returns `undefined` and the web layer goes dead. This
  must be validated during the release cutover.
- **`bundleManagerApk` still hardcodes `:manager:assembleDebug`** — a required cutover step, left
  alone deliberately rather than changed untested.

---

# RESOLVED + NEW BLOCKERS (2026-08-03, cross-session)

A concurrent launch-readiness session operated on this same branch. Its claims are recorded below
with an explicit note on what THIS session verified independently.

## ✅ RESOLVED — `NEXT_PUBLIC_API_URL` (was Decision #1)

**It is the Railway host.** Two independent sources agree:
- This session: `.env.example:71` documents production as
  `https://<railway-app>.up.railway.app/api/v1`, and `apps/web/vercel.json` rewrites
  `/api/v1/:path*` to `api-production-39a1.up.railway.app`.
- Launch-readiness session: grepped the **deployed** web bundle on `venue-os.app` and found that
  host baked in.

Consequences, both now settled:
1. **`INJ-001` stays HIGH, not CRITICAL.** The WEBPAGE proxy iframe is cross-origin with the player,
   so there is no `parent.localStorage` device-token theft and no DOM access to strip the emergency
   overlay. The lead correction in `03-CONTENT-INJECTION.md` stands. The fix (sandbox + separate
   proxy origin) is unchanged.
2. **`HostAllowlist.kt` matches production — the Android allowlist is fleet-safe.** The
   fleet-breaking risk flagged when that code was written is closed.

## 🔴 NEW LAUNCH BLOCKER — production signing secrets are placeholders

**Reported by the launch-readiness session; NOT independently verified by this session** (no Railway
access from here). Treat as high-confidence-but-unconfirmed until checked in the Railway dashboard.

- `JWT_SECRET` and `SESSION_SECRET` in Railway production are still **human-written beta placeholder
  strings, not 64-hex**. Every user session token and express-session cookie is signed with a guessable
  secret. This is worse than any application-layer finding in this audit: it makes session forgery a
  guessing problem rather than an exploitation problem.
- `DEVICE_SECRET_KEY` / `DEVICE_JWT_SECRET` are proper hex — **the device side is fine.**
- `ANTHROPIC_API_KEY` and `PEXELS_API_KEY` absent; Stripe still on `sk_test`.

**Action: rotate `JWT_SECRET` and `SESSION_SECRET` to 64-hex before launch.** Note this invalidates
every existing operator session (users re-login) — it does NOT affect device tokens or screens.
Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## ⚠️ Pre-push hygiene — live demo credentials in untracked files

`docs/research/2026-07-31-walnut-creek-demo-district/README.md` and
`packages/database/prisma/seed-walnut-creek-demo.mjs` contain live demo credentials
(`districtadmin@wcsd.demo` / `WalnutCreek!2026`).
**Verified by this session: both are UNTRACKED** (`git ls-files` returns 0 matches), so a push of
this branch does not carry them today. They must be scrubbed or excluded if they are ever staged.

## Salvage-commit caveat

`d0e63bda` (Android/AND-002 partial) is **unfinished salvage**, the same class as `e4883887` which
was reverted for breaking 4 ACC-06 tests. It is retained deliberately because an agent is actively
completing it — but note it **does not compile**: `MainActivity.kt:38` imports
`security.LockTaskController`, which was never written. If that completion does not land, this commit
should be reverted rather than shipped.
