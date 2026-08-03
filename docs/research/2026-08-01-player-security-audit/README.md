# VenueOS Security Program — 2026-08-01 → 02

**Question:** *"Do a complete audit of our player to ensure it's locked down and no bad actors can
ever take control"* — then *"this has got to be a very secure CMS, from top to bottom."*
Driver: K-12 districts' procurement security review, and a multi-vertical go-to-market.

**Branch:** `security/player-fixes-2026-08-01` — **LOCAL ONLY, NOTHING PUSHED.**
The repo is public and these documents describe live, unpatched vulnerabilities. See "Disclosure".

---

## Read in this order

| File | What it is |
|---|---|
| [`04-FIX-STATUS-AND-DECISIONS.md`](04-FIX-STATUS-AND-DECISIONS.md) | **START HERE.** What is fixed, what is blocked, and every decision that needs the owner. |
| [`RESUME.md`](RESUME.md) | Resume points, workflow run ids, journal paths, standing constraints. |
| [`00-VERIFIED-CRITICAL-APK-SIGNING.md`](00-VERIFIED-CRITICAL-APK-SIGNING.md) | Lead-verified: public signing key + debuggable production APKs. |
| [`01-REALTIME-BUS.md`](01-REALTIME-BUS.md) | Fake-lockdown injection / forged all-clear. Posture ADEQUATE. |
| [`02-ANDROID-WEBVIEW-JS-BRIDGE.md`](02-ANDROID-WEBVIEW-JS-BRIDGE.md) | The JS bridge on every frame. Posture CRITICAL_GAPS. |
| [`03-CONTENT-INJECTION.md`](03-CONTENT-INJECTION.md) | Hostile content onto a school wall. **Carries a lead correction** downgrading INJ-001. |
| [`05-DEVICE-TOKEN-AUTH.md`](05-DEVICE-TOKEN-AUTH.md) | 4 HIGH — tokens are effectively permanent and unrevokable. |
| [`06-OTA-SERVER-AUTHZ.md`](06-OTA-SERVER-AUTHZ.md) | Patch denial + safeguard-theater SHA-256 claim. |
| [`07-TENANT-ISOLATION.md`](07-TENANT-ISOLATION.md) | **0 CRITICAL, 0 HIGH.** The reassuring one. |
| [`08-ACCOUNT-BLAST-RADIUS.md`](08-ACCOUNT-BLAST-RADIUS.md) | **`ACC-01` — the worst finding in the program.** |
| [`09-…`](09-FIX-REPORT-live-content-authz.md) · [`10-…`](10-FIX-REPORT-sandbox-csp-spatialnav.md) | Fix reports (agent-authored, verbatim). |

## Method

Ten attack surfaces, each audited by an independent Opus agent under fixed ground rules: read-only;
evidence with exact `file:line` actually read; **absence claims require two independent methods** or
they are labelled UNVERIFIED; guards traced to real callers (a guard never applied is a
vulnerability, not a mitigation); every finding self-refuted before reporting; zero findings is a
valid answer. Wave 1 added an adversarial refutation round plus two independent deep-verify lenses on
every CRITICAL/HIGH. Wave 2 ran as a **Workflow** so results journal to disk as each agent completes.

**Findings are agent-authored and marked as not independently re-verified unless a lead note says
otherwise.** The lead verified, and in two cases corrected, the highest-severity claims:

- **Corrected:** `INJ-001` was reported CRITICAL on a same-origin premise. `API_BASE` derives from
  `NEXT_PUBLIC_API_URL` (`WidgetRenderer.tsx:292-294`), which production sets to the Railway host —
  cross-origin. Downgraded to HIGH, pending one env check.
- **Corrected:** `AND-004`'s PIN gate was built on the native `unpair()`. `page.tsx:6497-6550` shows
  unpair is **server-first**, so the gate blocks nothing while disabling the operator's on-device
  exit hatch. Recommended dropped.
- **Confirmed by the lead, two methods:** `PLAYER-SIGN-01/02` (against the real shipped
  `edu-cms-player-v1.0.52.apk`, not a merged manifest) and `ACC-01` (`assertCallerCanAssignRole` is
  imported only by `users.controller.ts` and `onboarding.service.ts`; the full import list for every
  file in `apps/api/src/sso/` shows it is never used there).
- **An agent corrected the lead:** the brief cited `FitnessLiveTVWidget.tsx:342` as a precedent for
  sandboxing without `allow-same-origin`. It *has* `allow-same-origin`. Following that instruction
  would have voided the entire sandbox fix.

## Verified state of the fixes

| Area | Verification actually run by the lead | Status |
|---|---|---|
| Web player (`?api=` trust anchor, SSE gate parity, TENANT_CHANGED) | tsc clean; 9 suites / 118 tests | ✅ |
| API realtime (channel-bound HMAC, frame cap, telemetry caps) | tsc clean; **136 suites / 1847 tests** | ✅ |
| Build/CI (release signing path, debuggable gate, keystore guard) | guards run against the real shipped APK: exit 1 | ✅ |
| Content injection (sandbox, CSP report-only, server-side spatial-nav shim) | tsc clean; inset + mobile-perf guards clean | ✅ |
| Live-content authz (CONTRIBUTOR gate + zone URL guard) | full API suite green | ✅ |
| Android Kotlin (bridge/OTA/serial/intent hardening) | **NOT COMPILED — no JDK on the build machine** | ⛔ |

**Remote-control navigation was preserved, not sacrificed.** Sandboxing the WEBPAGE iframe kills
`contentWindow.eval`, so the spatial-nav shim moved server-side into
`apps/api/src/proxy/spatial-nav-shim.ts` and now speaks a hardened `postMessage` protocol
(`vosnav/1` namespace, closed 7-command enum, `event.source` identity — a null-origin frame reports
`origin === "null"`, so origin alone is not a check).

**Two degradations were measured, not assumed, and are documented:** the PDF iframe stays
unsandboxed (every sandbox token blanks the viewer) and `StreamingWidget` keeps `allow-same-origin`
(YouTube renders black without it; safe because `normalizeEmbedUrl` pins a foreign allowlisted host).

## Disclosure

`github.com/gschiemann/EDUCMS` is **public**. These commits and documents describe live, unpatched
vulnerabilities in exploitable detail — pushing publishes an attack roadmap before the fixes are on
the screens. Options: keep local until the fleet is patched; rewrite commit messages to terse
non-exploitable wording and push code only, keeping this folder local; or make the repo private.
**The lead has pushed nothing.** This is the owner's call.

## Not covered

Dashboard-side XSS; the proxy's HTML-rewriting body; the baked in-board runtimes
(`EDUCMS-SHIM-V6`, kiosk `_edit-shim.js`); `RendererService` (Puppeteer) SSRF; live-fleet and
load/DoS behaviour (nothing was executed against production); and any on-device verification —
notably whether the Android JS bridge reaches an opaque-origin sandboxed subframe, which remains
**UNVERIFIED** and needs a 60-second test on a paired unit.
