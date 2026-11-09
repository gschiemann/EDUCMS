# STREAMING widget — flagship audit (2026-11-07)

**Author:** Claude Opus 5.5 (Claude Code, worktree agent) · **Branch:** `claude/streaming-widget-flagship` · **Bar:** the owner's flagship bar — tvOS / Google TV class, real design, plays on every screen.

## Situation

The STREAMING widget (`apps/web/src/components/widgets/StreamingWidget.tsx`) is the zone that shows a live stream or video link on a board. It is in the builder palette (`variants-register.ts` `streaming-basic`) and in the Apps library (YouTube / Vimeo / Twitch build STREAMING zones). Before this change, the only way to point it at an HLS link was a saved channel in Settings → Live video. It guessed "HLS" for any link it did not recognise. It had no reconnect: one fatal error left a red chip over a black frame for ever. It could not prove that frames were playing.

## Reachability (module graph, not grep)

I walked the module graph from the Next route entry points (`page|layout|route…` under `src/app`, following `import` / `export from` / `import()` through `@/*`), with negative controls:

| Route | Target | Result |
|---|---|---|
| `app/player/` | `StreamingWidget.tsx` | REACHABLE: `player/page.tsx → lazyRenderer.ts → rendererBundle.tsx → WidgetRenderer.tsx → variants-register.ts → widget-families.tsx → StreamingWidget.tsx` |
| `app/player/` | `WidgetRenderer.tsx` (positive control) | REACHABLE |
| `app/player/` | `AddSidebar.tsx` (negative control) | UNREACHABLE |
| `templates/builder/[id]` | `StreamingWidget.tsx` | REACHABLE via `BuilderShell → VariantPicker → variants-register → widget-families` |
| `templates/builder/[id]` | `PropertiesPanel.tsx` (the STREAMING editor case) | REACHABLE via `BuilderShell` |
| `templates/builder/[id]` | `AddSidebar.tsx`, `BottomToolbar.tsx` (negative controls) | UNREACHABLE |

`WidgetRenderer.tsx` dispatches `case 'STREAMING'` to `<StreamingWidget config={cfg} live={live} />`. The new `StreamingSourceField.tsx` is imported by `PropertiesPanel.tsx`, so it is reachable through the same chain.

## Grades (before → after this PR)

| # | Item | Before | After | Notes |
|---|---|---|---|---|
| 1 | Source types + the editor saying what will work | D | A− | see §1 |
| 2a | Android WebView 95 / modern / Taurus Chromium 83 | C | B+ | needs an on-glass check on GUQ and Taurus (unverified) |
| 2b | Muted autoplay; reconnect and backoff | D | A | |
| 2c | Honest "stream offline" state | F | A | |
| 2d | Stays out of the rule-17 cache path, no precache of a live stream | A | A | already true; now written down |
| 2e | Emergency takeover pauses and restores it | A− | A− | it unmounts and remounts; banner alerts leave it running |
| 2f | CPU / memory on low-end boxes, several streams per board | C | B+ | buffers bounded; not measured on hardware |
| 3 | Native path (ExoPlayer / MediaCodec) | n/a | n/a (reported) | does not exist for streams; see §3 |
| 4 | Editor UX | D | A− | see §4 |
| 5 | Design of the loading / offline / LIVE states | D | A− | the owner reviews the look before merge |
| 6 | Proof of play / render proof | F | B | counted on the device; not yet sent to the dashboard — see §6 |

### 1. Source types

| Kind | Before | After | What the editor says |
|---|---|---|---|
| HLS `.m3u8` | hls.js, or native whenever `canPlayType` was non-empty (on Android WebView that can send it to the legacy MediaPlayer path) | `pickHlsEngine`: Apple WebKit → native AVFoundation; anything with MSE (Chromium, Android WebView, Taurus, Firefox) → hls.js; if native fails it hands over to hls.js once | "HLS stream · Plays on every screen" |
| A link with no extension | tried as HLS, failed silently | tried as HLS | "We'll try it as HLS — press Test stream" |
| MP4 / WebM | sent to hls.js, black box | plain `<video src>` played in a loop | It works, but it streams from its host every time; for a file you own, use Media + the Video widget (rule 17: it downloads to the screen and plays offline) |
| DASH `.mpd` | honest card | honest card (no dash.js on the player) | "Not supported — use the HLS link" |
| YouTube / Vimeo / Twitch / Kick | sandboxed embed on the allowlist (INJ-006) | unchanged; the unsupported-host card is redesigned and localized | "Uses the provider's official player" |
| RTSP / RTMP / SRT / UDP | an English card (RTMP/RTSP only; an `rtsp://` URL without `playbackType` was sent to hls.js) | detected from the URL scheme; a "needs a gateway" card | "Needs an HLS gateway: republish as .m3u8 (the camera's cloud service, or MediaMTX)". A browser cannot play RTSP; nothing in this PR changes that. |
| MJPEG webcam | sent to hls.js, black box | `<img>` on the multipart feed, retried with backoff | "MJPEG camera — its frames can't be counted for proof of play" |
| JPEG snapshot webcam | sent to hls.js | `<img>` refreshed on a timer (2–60 s), double-buffered so it never flashes | refresh selector appears |
| `http://` or private-network address | sent to the player anyway (the API refuses it on save in production) | flagged up front | "Will be blocked" with the reason (mixed content; `zone-url-guard.ts` refuses private IPs) |

### 2. Playback on the player

- **WebView 95 (GUQ, Android 11) and Taurus Chromium 83.** hls.js 1.6.16 `dist/hls.mjs` contains no `??=`, `||=`, `&&=`, static blocks or private fields; it has two `?.`, which Chromium 80+ supports. `requestVideoFrameCallback` exists from Chromium 83. If the API is missing, the frame counter falls back to `currentTime` progress. The new code has no `inset`, no flex `gap` and no `backdrop-filter`: `check-taurus-safety` and `check-inset-serialization` are clean. The ad lower-third's `backdrop-filter: blur(4px)` was removed. **Not verified on glass.**
- **Autoplay muted** is the default. If unmuted autoplay is refused (`NotAllowedError`), it plays muted rather than not at all, and the editor says so.
- **Reconnect.** A watchdog runs once a second. No first frame within 15 s, or no new frame for 8 s while playing, tears the session down. It reconnects at 1 → 2 → 4 → 8 → 16 → 30 s (capped), with ±20 % jitter so a venue's screens do not hit the origin together. hls.js `MEDIA_ERROR` gets one `recoverMediaError()` first. The `online` event retries at once. Under 2.5 s without frames, a calm "Reconnecting" pill shows over the dimmed last frame. It keeps retrying for ever.
- **Offline state.** After two failed sessions, a full card says "Stream offline · The screen keeps trying on its own · Next try in Ns", over the poster image if one is set.
- **Rule 17.** Stream URLs live in template zone config. The player's precache pushes only `manifest.playlists[].items[].url` to `PRECACHE_PLAYLIST` (`player/page.tsx`, the "Push every asset URL" block), so a stream never enters the readiness gate or the cache drive. `sw-player.js` sends uncached cross-origin GETs (`.m3u8` and segments) straight to the network and never writes them to a cache tier. One cost remains: every segment request still crosses the service worker (two `cache.match` calls, then `fetch`). That is cheap, but it is not zero.
- **Emergency.** On a takeover alert, `player/page.tsx` returns a different tree (`decideEmergencySurface` → `takeover`/`hold`). The template unmounts, `LiveVideoStream` tears down (`hls.destroy()`, src released), and the screen remounts from the live edge on all-clear. A banner alert overlays it and leaves it running. Nothing in the emergency path changed.
- **Low-end budget.** hls.js settings: `capLevelToPlayerSize` (a half-screen zone never decodes the 1080p rendition), `backBufferLength: 10` (the default is unbounded), `maxBufferSize` 30 MB, `maxBufferLength` 20 s, the transmuxer in a worker, and `lowLatencyMode: false` (LL-HLS doubles the request rate). The frame counter lives in a ref and a DOM attribute, never React state. On teardown the src is removed and `load()` frees the hardware decoder. **Two streams on one board are tested in the e2e. CPU and memory are not measured on a GUQ.**

### 3. Native path — what exists

The APK's native video engine (`apps/player/app/src/main/java/com/educms/player/media/` — `SharedVideoRenderer`, `SoloVideoLayer`, `FaceVideoRenderer`) is `MediaExtractor` + `MediaCodec` on a **local, digest-verified H.264 file** (`extractor.setDataSource(file.absolutePath)`). The APK has no ExoPlayer / Media3 dependency (`app/build.gradle.kts`) and no HLS, network-source or live-edge logic. So every stream today plays in the WebView. **Recommendation (not built here):** a Media3 ExoPlayer HLS surface for a *solo, full-screen* stream on capable boxes, behind the same rules as native video:

- engine auto-detect per device;
- one seamless takeover, never flipping web ↔ native;
- a lead kill switch;
- the emergency hold;
- hardware qualification per class.

The web-side frame counter added here is the evidence such a handover would need.

### 4. Editor UX — the 30-second happy path

1. Drop **Live Stream** from the palette. 2. Paste the link into **Stream link**. The paste applies immediately, and the canvas zone *is* the live preview. A chip names the kind and the verdict, with one sentence of explanation. 3. Press **Test stream**. A second player in the panel shows "Playing live · 1280×720 · 143 frames · hls.js". 4. Optional settings:

- Poster / fallback image (from the Media Library);
- Muted (on by default), and a Volume slider that appears only when unmuted;
- Fit (Fill / Fit);
- Show LIVE badge;
- the ad overlay toggle;
- or pick a saved channel instead.

Every new string ships in en / es / zh (`streamingWidget.*`, 82 keys; `check-i18n-parity` OK). Controls reuse the app's components: `ui/button` `Button`, `ui/status-pill` `StatusPill`, and the panel's own `ToggleField` / `SelectField` / `AssetPickerField`. The API's zone URL guard now also validates `posterUrl` (`apps/api/src/templates/zone-url-guard.ts`).

### 5. Design

- **Connecting:** the poster (if any) with a thin spinner.
- **Offline / unsupported / gateway / blocked:** a calm card. A deep slate radial gradient, a 1 px-ringed line icon (SVG, no emoji), a 600-weight title, a muted hint and an uppercase retry line, over a dimmed poster.
- **LIVE badge:** a frosted-look solid pill (no backdrop-filter) with a softly pulsing red dot. It shows only when hls.js or the media clock says the stream is live **and** frames are advancing; a VOD never wears it.

Type scales with the zone, from a ResizeObserver rather than container units, because Taurus lacks them. Screenshots are in `docs/research/2026-11-07-streaming-widget/` (gitignored, on the lead's machine).

### 6. Proof of play

- Each stream counts presented frames with `requestVideoFrameCallback`, falling back to `currentTime`.
- It publishes them as `data-stream-frames` / `data-stream-state` on the element and `window.__eduStreams[id] = { url, phase, frames, lastFrameAt, engine, isLive }`.
- The editor's Test reads the same counter.
- The e2e asserts frames advance.

**Gap:** this is not yet sent to the dashboard. The player's render proof treats a template as "rendering" whether or not its stream plays (`player/page.tsx`, `playingContent … || template`).

I deliberately did **not** feed it into `setActiveMediaStalled`. That flag drives `stall|pl:` proof hashes and the wedge evidence, and a third-party stream going down must never reload a screen.

**Follow-up:** add an informational `streams: [{ phase, frames, lastFrameAgeMs }]` block to the render-proof POST and a dashboard chip ("Stream offline on 3 screens"). It must never feed the wedge or recovery logic. That needs a player-page change, an API DTO change and a fleet UI change, so it gets its own PR.

## Gaps not fixed here

- On-glass verification on a GUQ (WebView 95) and a Taurus (Chromium 83) — **unverified**.
- Render-proof wiring to the dashboard (§6).
- A native ExoPlayer HLS path (§3).
- `FitnessLiveTVWidget` still has its own HLS wiring: native-first `canPlayType`, no reconnect, no frame counter. It should adopt `LiveVideoStream`.
- DASH stays unsupported; the player does not bundle dash.js.
- Palette descriptions in `variants-register.ts` are English-only across all widgets (a pre-existing gap).
- The dashboard's report-only CSP `connect-src` is an enumerated list. If it is ever enforced, HLS previews in the builder will break unless it allows `https:` (the player policy already does).
- The e2e depends on public third-party test streams. When they are unreachable those tests **skip** with the reason, and a skip is not a pass. The offline and RTSP tests need no network.

## Validation

Run locally on 2026-11-07 against a fresh prebuilt server: `E2E_REBUILD=1 E2E_PORT=3100 npx playwright test tests/e2e/streaming-widget.spec.ts`.

- **Playwright `streaming-widget.spec.ts`: 12/12 passed, Chromium and WebKit.** It covers:
  - a live HLS stream whose frames advance across a 3 s window, with `isLive` true and the LIVE badge visible;
  - Mux VOD and Apple bipbop playing side by side on one board, both advancing, with no LIVE badge;
  - a dead host showing the offline card with its retry line;
  - RTSP showing the gateway card;
  - in the editor: paste, the "HLS stream · Plays on every screen" chip, then Test stream reaching "Playing live · W×H · N frames";
  - RTSP in the editor showing "Needs an HLS gateway".
- **The brief's Akamai live stream was broken upstream today.** `master.m3u8` answers 200, but its only level, `mastermaster_video10000k.m3u8`, answers **404**. The widget reported "Didn't play (levelLoadError)", which was the honest outcome. The spec now picks the first live candidate whose master *and* first variant answer: Akamai, then `demo.unified-streaming.com/k8s/live/stable/live.isml/.m3u8`.
- **Lesson, which cost one cycle:** a plain `<style>` block in a widget loses every padding and margin to the flattened Tailwind preflight. Route it through `sceneCss()` (`widgets/scene-css.ts`; `check-scene-css` enforces this). The first screenshots showed an off-centre icon and an unpadded LIVE pill. The second run did not pick up the fix because `next start` served a stale `.next`; use `E2E_REBUILD=1` after app edits.
- **Jest:** `widgets/__tests__/stream-source.test.ts` (new, 30+ cases); all of `src/components/widgets` and `src/components/template-builder` pass (142 suites, 1,867 tests); `apps/api` `zone-url-guard.spec.ts` passes 47/47.
- **Guards:** `check-taurus-safety`, `check-inset-serialization`, `check-scene-css`, `check-widget-truth`, `check-pill-rules`, `check-variant-registry`, `check-mobile-perf`, `check-i18n-parity` and web `tsc --noEmit` are all clean.
- **Screenshots** at 1325×758 and 390×844 (player live / offline / RTSP / two streams; editor test / RTSP / phone): `docs/research/2026-11-07-streaming-widget/`.
- **Not verified:** on-glass on any physical screen; CI.

## Rollback

Revert the PR. No schema change and no migration. The config fields are additive (`posterUrl`, `volume`, `showLiveBadge`, `refreshSeconds`); an older build ignores them.
