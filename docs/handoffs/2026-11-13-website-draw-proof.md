# Website slide draw proof — build record (2026-11-13)

Status: **code written and committed on a work branch; not merged, not released, never run on a device.** The Android app was not built by Gradle in the session that wrote it (no Android SDK there) — the pull request's Kotlin check is the first compile proof.

## Why

2026-11-11, a customer's free-standing screen (rk3288, Android 7.1.2, WebView 116, player 1.1.55-field.1) whose only content is an external website went white. Fleet data said healthy: on the Android app a website item is shown by a second native WebView (`urlOverlayView` in `MainActivity.kt`), and the web player marked the slide ready the moment it handed the URL over. The app recovered from load errors and renderer crashes, but not from a page that loaded and drew nothing.

## What was built

- **Native decision** (`UrlOverlayDrawProofPolicy.kt`, pure, tested): one constant read-only script is evaluated in the website view at 1 s, 3 s, 8 s and 20 s after the main frame finishes, then every 60 s. `DRAWN` on any visible content (text, sized media, a full-screen video / canvas / image / frame). `BLANK` only after two consecutive empty probes, both ≥ 8 s after finish and ≥ 10 s apart — never before 20 s. `UNKNOWN` when the probe cannot run, returns garbage, or the page is custom elements / shadow DOM it cannot see into; nothing reloads on `UNKNOWN`.
- **Self-recovery:** on `BLANK`, at most six reloads of the saved address on the existing recovery back-off (2 / 4 / 8 / 16 / 32 / 60 s), then it stops reloading and keeps reporting blank. Cleared on `DRAWN`, an address change or hide.
- **Never during an alert:** no probe and no reload while an emergency hold is up; an unreadable hold counts as held.
- **Report to the page:** event `edu-url-overlay-state` `{ url, state: loading | drawn | blank | failed | unknown, attempts }` into the main player view only. New bridge method `urlOverlayReport(url)` both advertises the capability and arms the proof for that address; an older web bundle on a new app behaves as before.
- **Web player** (`nativeWebsiteProof.ts`, pure, tested): on a reporting app the slide is ready only on `drawn` (or `unknown`); new render-proof signatures `idle:website-blank` and `idle:website-failed`.
- **Dashboard and API:** grades `website-blank` ("Website loaded · nothing drawn") and `website-failed` ("Website did not load") in en + es + zh, mirrored in the API's grade port.
- **Kill switch** `PLAYER_WEBSITE_PROOF=off` (rides the manifest as `playback.websiteProof: 'off'`, absent unless set).
- **TLS:** the website view now overrides `onReceivedSslError` — still cancels, never proceeds, but logs, and on an armed main frame takes the failed-load path. Before this a refused certificate left no trace.
- **Second faces** of a double-sided unit, which cannot show a website slide at all, now report `failed` instead of a false "playing".

## A security boundary moved, deliberately

`WebTabsWiringTest` used to pin that NO script is evaluated in the website view. One constant, read-only script now runs in third-party page context; its reply is treated as hostile (size-bounded, exact shape or dropped, numbers clamped) and the view still has no bridge of any kind. A reviewer should look at exactly this.

## Against the six questions (owner rule, 2026-11-13)

1. **When it fails:** the view reloads itself up to six times, then stays on the page it has and reports blank.
2. **Who is told:** the dashboard grade only. **GAP — no notification to an admin and no email** for the new grades.
3. **What the dashboard shows:** "Website loaded · nothing drawn" / "Website did not load"; it can lag a recovery by up to five minutes (the idle report lane).
4. **Recovery without a person:** yes, bounded; it clears itself when the page draws.
5. **Attacker / bad input:** a hostile page can lie to the probe (claim content) — that reads as today's behaviour, never worse; it cannot reach native code. A page could also make itself look blank to trigger reloads: bounded at six.
6. **Proven:** web and API unit tests, the pure Kotlin policy and wiring tests (92, run with a standalone compiler), i18n / tenant / env / rulebook guards. **Not proven:** the Gradle build, `MainActivity.kt` as a whole, three test files that could not compile standalone, and everything on a device.

## Known limits

- A main frame that never finishes stays `loading`; there is still no timeout on the first load.
- A site's own error text counts as drawn.
- A site that needs more than about 22 s to draw is reloaded up to six times in its first ~4.5 minutes, then left alone.
- The bridge method has no minimum-version entry yet: the app release that carries it has no number. Add it in the release change.
- `apps/player/versions.properties` says 1.1.29 while field units report 1.1.55 and method floors go to 1.1.66 — unexplained; resolve before any release.

## Most likely cause of the white screen (unproven)

A refused TLS certificate on the page or one of its script hosts — an Android 7 trust store, or a box with a wrong clock (this unit's clock zone was Asia/Shanghai) — cancelled silently, leaving a 200-then-blank page. The website view's background is white and it is made visible before anything loads.

## Before this reaches a screen

A player release: version bump, hardware qualification on the rk3288 class at least, and the owner's go. Arming a field build is a release.

Models: Claude Fable 5.2 (Anthropic, Claude Code on the web) — built by a sub-agent in an isolated worktree; this record written by the lead session from its report.
