# Metabase 0.64 with the legacy-engine layer injected LATE (2026-11-09)

**Author:** Claude Sonnet 5.5 (Claude Code, worktree agent). Check only: no product code changed, nothing pushed, no production system touched, nothing downloaded.

## Question
The GUQ's WebView 95 has no `DOCUMENT_START_SCRIPT`, so the fix evaluates `legacy-engine-polyfills.js` with `evaluateJavascript` at onPageStarted / onPageCommitVisible / onPageFinished. Does a Metabase 0.64 login and dashboard work when the layer arrives after the page's own scripts may have started?

## Setup (same as the 2026-11-08 sandbox)
AVD `venueos-a11-wv95` (WebView 91.0.4472.114 + `--harmony-class-static-blocks`), fresh Metabase `v0.64.x` container with a new throwaway local admin and the sample DB, one native-SQL line-chart dashboard (/dashboard/2, card 40). `pm clear` before every run. The asset (placeholder replaced by `[]`) is never registered at document start: it is `Runtime.evaluate`d late. The 92-95 builtin shim (`.at`, `Object.hasOwn`) stays at document start in every run. Script: `cdp-late.cjs` (modes `neg95`, `late-commit`, `late-dcl`, `late-load`). Each run: login, dashboard, `Page.reload`, then the 9-route sweep (each route is a hard `Page.navigate`, so the layer is re-injected each time).

Injection points: `late-commit` = main-frame `Page.frameNavigated` + `domContentEventFired` + `loadEventFired`; `late-dcl` = `domContentEventFired` + `loadEventFired` (added to split the two); `late-load` = `loadEventFired` only. Evaluating 2-3 times per navigation was harmless (0 failed evaluations).

## Results
| Run | Login | Dashboard (dashcard / chart svg paths) | After `Page.reload` | 9-route sweep | `Runtime.exceptionThrown` |
|---|---|---|---|---|---|
| `neg95` control, no layer | FAILS: `i?.throwIfAborted is not a function`, stays on /auth/login | 0 / 0 (redirected to login) | 0 / 0 | not run | 0 |
| `late-commit` | OK, lands on `/` | 1 / 59 | 1 / 59 | 9 of 9 load, no error text | 0 |
| `late-dcl` | OK | 1 / 59 | 1 / 59 | 9 of 9 load, no error text | 0 |
| `late-load` (worst case) | OK (SPA, layer present by the time of the click) | **FAILS: 0 / 0, lands on /auth/login?redirect=...** | **FAILS**, same | **9 of 9 redirected to /auth/login** | 0 |

Warnings seen in the passing runs are the same non-layer ones as 2026-11-08 (svg `max()` height, `crypto.subtle` digest on plain http, x-ray `map.colors`).

## The important finding: late-load is NOT enough
In `late-load` (layer only after the load event), logging in through the form works, but **every hard navigation or reload of an authenticated route boots the app without the layer and sends the user back to the login page.** Reproduced three times (plus a network-traced diagnostic run, `late-load-diag.json`):
- Right after login `/api/user/current` returns 200 in-page, so the session is valid.
- On a hard navigation to `/dashboard/2` the app made **no `/api/user/current` request at all** and went to `/auth/login?redirect=...` (inferred: its boot-time session load throws on the missing `throwIfAborted`, caught, treated as logged out; no uncaught exception was reported).
- After the redirect the layer is present (`typeof AbortSignal.prototype.throwIfAborted` = function); signing in again lands on `/dashboard/2` with the chart (1 / 59), and an SPA route change (`/collection/root`) also works. So the failure is the boot window only.
- Both runs where the layer arrived before DOMContentLoaded (`late-commit`) or at DOMContentLoaded (`late-dcl`) booted normally, including after reload and across all 9 hard navigations.

**Conclusion:** late injection works if it lands by DOMContentLoaded (in the Android callbacks: onPageStarted or onPageCommitVisible must really run the script in the new document before the app bundle boots). If only onPageFinished delivers it, a Metabase login works once but every reload / new page load will bounce to the login (and a kiosk that reloads on a timer would sit on the login page). The `late-dcl` run shows the onPageCommitVisible-equivalent point is sufficient in this sandbox.

## What this does NOT prove
- Still engine 91 + static-blocks flag + shimmed 92-95 builtins, not the GUQ's WebView 95.0.4638.74, and not our APK / `LegacyEngineCompat` code.
- CDP events are not the Android callbacks. The key unknown is whether `onPageStarted` / `onPageCommitVisible` + `evaluateJavascript` runs in the NEW document's context before its scripts (on Android, onPageStarted often fires before the new context exists, so the script can run against the OLD document and be lost). The sandbox cannot answer that; the first field/real-WebView log must show `throwIfAborted` is a function in the new page at commit time, and a reload test must be done on the glass.
- Timing here is lenient: `loadEventFired` handling used a 12-20 s settle before interaction. Race margins on a slow panel are not measured.
- http, not https; one dashboard and 9 routes; lazy chunks not visited.

## Evidence
`docs/research/2026-11-09-metabase-late-injection/` in the main checkout (gitignored): `cdp-late.cjs`, `cdp-late-diag.cjs`, `{neg95,late-commit,late-dcl,late-load}.json` and `.out.txt`, `late-load-attempt1-session-lost.json`, `late-load-diag.json`, `summ.cjs`, and screenshots `<mode>-{1..5}-*.png` (e.g. `late-commit-3-dashboard.png` shows the rendered line chart). Emulator stopped, `webview-command-line` flag removed, container `mb-sandbox` removed.
