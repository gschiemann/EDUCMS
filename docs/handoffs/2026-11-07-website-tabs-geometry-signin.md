# 2026-11-07 — Website Tabs: site view in a corner, sign-in lost (portrait 4K panel)

**Report.** An operator published a "Touch Kiosk — Website Tabs" template (one full-screen
`WEBSITE_TABS` zone, one tab: a BI dashboard that sends `X-Frame-Options: DENY` and
`frame-ancestors 'none'`) to a portrait 2160×3840 Amlogic t982 / Android 11 / WebView 95 panel
(Player 1.1.62-field.1). The page "didn't fill the screen", the login "was in the bottom corner",
and the login failed.

## Evidence (read-only)

- `template_zones`: two tenant templates, `WEBSITE_TABS` at 0/0/100/100. One landscape 1920×1080 copy and
  one portrait 1080×1920. Both were scheduled to the panel a minute apart and then replaced by the normal playlist about 12 minutes later.
  The tab config is `embed: "blocked"` (the panel's site check had already detected the framing refusal),
  `signIn: "once"` and `incognito: true`.
- Mechanism: on our app, `WebsiteTabsWidget` uses the APK's native site view (`webTabsShow`, the
  `urlOverlayView` top-level WebView), not an iframe and not `/api/v1/proxy/web`. That is why a
  frame-refusing site rendered a login at all.
- The device log for this panel records `display=2160x3840 density=3.0`. There are no device-log rows from
  the publish window: the APK uploads logs only with recovery events.

## Root causes

1. **Geometry.** The widget converted its CSS rect with `window.devicePixelRatio`. The player
   pins its layout viewport to the panel's physical size: `layout.tsx` sets the viewport meta to `width=<w>`, and the APK
   loads at `setInitialScale(100)`. So one CSS px is one window px, but the ROM reports dpr 3.0. Every
   rect was 3× too far down and right, and then clamped by `applyWebTabsBounds`. The native-video path
   had already avoided this by scaling by WebView size ÷ layout viewport (`FaceVideoPolicy.rect`).
   A second problem: TemplateScaler starts at `scale(0)` and sets its transform after the widget mounts.
   A transform fires neither ResizeObserver nor resize, so a stale or zero measurement could stick.
2. **Sign-in.** The per-tab "Sign in once" choice was saved by the editor and read by nothing.
   With "Sign out after idle" on, every idle return and every unmount (each reschedule) wiped all cookies.
3. **Old engine (not fixed here).** WebView 95 may lack APIs a modern SPA login uses. The
   legacy-engine polyfill layer (branch `claude/legacy-webview-polyfills`) must also be registered on
   `urlOverlayView` (`configureUrlOverlay`). Today that view deliberately gets no document-start script,
   and `WebTabsWiringTest` pins that. Allowing the bridge-free polyfill asset there is that branch's call.

## Fix (web only, so the shipped APKs need no update)

- `cssToWindowRatio()` derives the ratio from the APK's `w`/`h` URL params ÷ `innerWidth`/`innerHeight`.
  It accepts them only when both axes agree, either as given or swapped. Otherwise it falls back to dpr, which was the old behaviour.
- After mount and after each tab change, the widget re-measures in a bounded burst (16 ms → 2.5 s). Identical payloads are deduplicated.
- `signOutOnLeave()`: no wipe while any tab is "Sign in once". Shipped APKs wipe cookies
  process-wide, so this keeps every site signed in. A per-site wipe needs an APK change. The help copy now says so in en, es and zh.
- `siteSurfaceFor()` is the framing decision in one tested place. Native shows any site top-level.
  Without native, a `blocked` site gets the honest card and never a frame.

## Not covered

- Body-rotation fallback, used when a ROM ignores PORTRAIT: the native view is laid out unrotated, so the site would appear sideways. This needs `View.setRotation` in the APK.
- Third-party cookies for an iframe (`CookieManager.setAcceptThirdPartyCookies`) are irrelevant on this path, because the
  native view is top-level.

## On-glass check

Publish a portrait Website Tabs template with a login-protected tab to the portrait 4K panel. Check three things:
the site fills everything under the tab bar; the login completes; after an idle return with
"Sign in once" set, the site is still signed in. The APK log line `web tabs: showing … in WxH@L,T` should read `2160x(3840−bar)@0,bar`.
