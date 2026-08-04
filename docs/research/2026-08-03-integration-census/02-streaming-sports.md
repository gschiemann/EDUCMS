# §6 Streaming + §7 Sports — HEAD verification & delta (HEAD = `b9122ea0`, baseline = `4fe245e9`)

> Census agent report, persisted verbatim 2026-08-03 evening. Read-only pass; nothing executed.
> Baseline `docs/research/2026-08-03-deep-audit/05-streaming-sports.md` re-verified per-provider at HEAD;
> only 4 of the 24 new commits touch this domain (`b687372f`, `88e30f1e`, `7982983d`, `39ab65ef`).

---

## 1. Provider census at HEAD

### §6 Streaming

| Provider / capability | Status | Evidence (HEAD) |
|---|---|---|
| HLS / M3U8 playback (StreamingWidget) | **REAL** | Safari native `StreamingWidget.tsx:206-209`; bundled `hls.js` dynamic import `:213`, `loadSource/attachMedia` `:228-229`. Dep `apps/web/package.json:50`. |
| HLS playback (FitnessLiveTVWidget) | **REAL** — now bundled | `FitnessLiveTVWidget.tsx:261` `await import('hls.js')`, `:274-277`. |
| MPEG-DASH | **COSTUME→honestly refused** | Explicit refusal card `StreamingWidget.tsx:153-160`. `dashjs ^5.1.1` (`apps/web/package.json:48`) still has **zero** import sites (grep + `git grep` both empty). Unchanged. |
| RTMP / RTSP | **COMING_SOON (honest)** | Type member `packages/api-types/src/streaming.ts:71` "requires a transcoding gateway"; placeholder `StreamingWidget.tsx:137-147`. No provider declares `playback:'rtsp'`. |
| RTSP camera widget / V2 Responder Bridge | **NOT BUILT** | Two methods: `grep -rn rtsp` over `apps/*/src` + `packages/api-types/src` returns only the 3 lines above; `git grep -i "responder bridge"` hits only `docs/` (`docs/EP6N_HARDWARE_EVAL.md:130`) — spec text, no code. |
| YouTube (watch + `/live/` + channel-live) | **REAL** | `StreamingWidget.tsx:347-365` (watch/`youtube.com/live/`), `:361-366` channel-live embed. Server-side embeddability pre-check `streaming.service.ts:354-519`. |
| YouTube-live resolver (fitness) | **REAL** | `apps/api/src/fitness/youtube-live.controller.ts:56`; output now gated `FitnessLiveTVWidget.tsx:317`. |
| Twitch | **REAL** | Normalise branch `StreamingWidget.tsx:367-374` (`player.twitch.tv?...&parent=`), allowlisted `streaming-hosts.ts:28`. |
| Vimeo | **REAL** (embed) / Vimeo Live OAuth = **COSTUME, labelled PARTNER** | `StreamingWidget.tsx:376-381`; OAuth connect hard-rejects `streaming.service.ts:149-151`. |
| Kick | **PARTIAL** | Allowlisted `streaming-hosts.ts:30` and type-guessed `StreamingWidget.tsx:188`, but **no normalise branch** — falls through to verbatim return `:396-402`. Unchanged from baseline. |
| Facebook Live | **COMING_SOON (honest)** | Single catalog row `status:'COMING'`, `fitnessSourceCatalog.ts:287`. No code path. |
| Webcam URL widget | **NOT BUILT** | Two methods (`grep -rni webcam` over src trees + `git grep -i webcam -- apps/ packages/`) return exactly one code comment, `player/page.tsx:917`. |
| IPTV M3U playlist | **COSTUME, mislabelled `DIRECT`** | `packages/api-types/src/streaming.ts:388-400` — `integrationTier:'DIRECT'`, tierReason "We parse + render channels". Two methods (`git grep -E "EXTINF|EXTM3U|parseM3[uU]"` and `grep -rn --include=*.ts*` over all four src trees) return **zero** parser hits. No upload path. |
| Pluto TV / Xumo (FAST) | **REAL playback, licensing contested** | 52 bundled `hlsUrl` entries `fastChannelCatalogs.ts`; `status:'READY'` `fitnessSourceCatalog.ts:118,134`. |
| Samsung TV+/Tubi/Roku/LG | **COSTUME, honestly PARTNER** | `fitnessSourceCatalog.ts:125-133`; placeholder catalogs deliberately deleted, `fastChannelCatalogs.ts:5-15`. |
| Public broadcasters (NHK/F24/DW/AJ/…) | **REAL** | `streaming.service.ts:80-95`; seeded `sample-data.controller.ts:112-160`. |
| Atmosphere/DIRECTV/DISH/Mood/iHeart (HDMI bridge) | **REAL (bridge), honest** | `packages/api-types/src/streaming.ts:225-230` documents the capture chain. |
| NFHS Network overlay | **COMING_SOON (honest)** | `discovery.service.ts:331-341` incl. `comingSoonReason` `:337`. Real path is HDMI-in on hardware, `packages/api-types/src/hardware.ts:232`. |
| Streaming catalog data files | present | `packages/api-types/src/streaming.ts`, `streaming-presets.ts`, `apps/web/.../fitness/fitnessSourceCatalog.ts`, `fastChannelCatalogs.ts`. |

**The Pluto/Xumo TOS contradiction persists verbatim at HEAD** — both sides quoted:

- `packages/api-types/src/streaming.ts:232-236`: Pluto/Tubi/Plex "were considered here but their consumer TOS explicitly forbids commercial display… Removed from the catalog."
- `apps/web/src/components/widgets/fitness/fitnessSourceCatalog.ts:112-114` header: FAST services are "Legal for commercial display"; row note `:123`: "Pluto TV streams are free and permitted for commercial display."
- The URLs are community-indexed stitch endpoints by the file's own admission (`fastChannelCatalogs.ts:19-24`, sourced from `i.mjh.nz/PlutoTV/us.json`).

### §7 Sports

| Provider / capability | Status | Evidence (HEAD) |
|---|---|---|
| CTS Gen6/Gen7 serial bridge | **REAL** | `packages/scoreboard-cts/src/console-profiles.ts:121,133`; `CtsBridge.tsx`; APK `SerialPortBridge.kt`. |
| CTS WTTC (RS-485) | **REAL but PROVISIONAL** | `console-profiles.ts:151`, `status:'provisional'` `:162`. |
| Daktronics All Sport 5000 | **REAL but PROVISIONAL** — *and mis-badged* | Decoder `packages/scoreboard-cts/src/daktronics/`; profile `console-profiles.ts:165-178`, `status:'provisional'` `:178`, comment `:175-177` "until a captured RTD". **But** the health grid publishes it as `status:'COMING_SOON'` (`integrations-health.controller.ts:848-855`). |
| Sportzcast | **COSTUME (COMING_SOON)** | `integrations-health.controller.ts:857-864`. Only other hits are doc comments. |
| Scorebird | **COSTUME (COMING_SOON)** | Same row `:858`; no dedicated code. |
| Genius Sports / Sportradar | **COSTUME (COMING_SOON)** | `integrations-health.controller.ts:866-873`. |
| MaxPreps | **COSTUME (COMING_SOON)** | `integrations-health.controller.ts:874-882` + `discovery.service.ts:500-509`. |
| GameChanger | **COSTUME (COMING_SOON)** | `integrations-health.controller.ts:883-891`. |
| Generic BYO push feed | **REAL** | `POST board/:id/feed` `sports-board.controller.ts:323-337`; HMAC + `timingSafeEqual` `sports-feed-token.ts:107,116,128`; rate-limit before token check `:338-341`. |
| Game-state console publishing | **REAL** | `POST /screens/:id/game-state` `screens.controller.ts:2223` (+ per-screen rate floor `:149`); persistent `POST board/:id/cts-snapshot` `sports-board.controller.ts:216`. |
| Score-delta auto-celebration | **REAL** | `sports.service.ts:3819-3835` (delta gate `:3834`), per-game cache `:170`, toggle `:3947-3960`. |
| Swim timing | **REAL** | `sports-board.controller.ts:294`. |

**Truth-gate coverage:** all six unbuilt sports vendors carry `status:'COMING_SOON'` with a specific reason string, surfaced and counted in the operator UI (`settings/test-integrations/page.tsx:278,328-329,412`). Coverage is complete for the unbuilt ones — the defect is the opposite direction (Daktronics under-claimed, below).

---

## 2. Delta since the audit — what tonight actually closed

**`b687372f` — CLOSED (widget layer), partial (server layer).**
- New shared module `apps/web/src/components/widgets/streaming-hosts.ts:24-42` (allowlist + `isAllowedStreamingHost`) and `safeEmbedSrc` `:57-69`: requires parse + `https:` + allowlisted host, returns `''` otherwise, **no loopback exemption** (`:53-55`).
- `FitnessLiveTVWidget` now gates **both** iframe sources: raw `c.streamUrl` and resolver `ytResult.embedUrl` → `FitnessLiveTVWidget.tsx:316-317`; refusal path `showBlockedHost` `:322-324`.
- `StreamingWidget` re-exports the list so INJ-006 tests and `normalizeEmbedUrl` are untouched (`StreamingWidget.tsx:59,341`).
- **jsdelivr / `new Function` are GONE.** Two methods: `grep -rn "jsdelivr|new Function" apps/web/src` → 0 hits; `git grep -n jsdelivr -- apps/` → 1 hit = the *negative assertion* in `fitness-livetv-embed-guard.test.ts:123`.
- **NOT closed:** `zone-url-guard` was not touched. `URL_BEARING_ZONE_FIELDS` at `apps/api/src/templates/zone-url-guard.ts:70-74` still lists only `WEBPAGE`, `EXTERNAL_HTML`, `STREAMING`. Two methods confirm no fitness types server-side.
- **`FitnessTrainingVideoWidget` was NOT swept** — absent from `b687372f`'s file list. At HEAD `FitnessTrainingVideoWidget.tsx:137` is still `src={c.videoUrl}` verbatim; the file imports nothing but React (`:34`).

**`88e30f1e` — CLOSED, all three routes.** `<TaurusPolyfills />` mounted at `board/[gameId]/layout.tsx:55`, `ribbon/[gameId]/layout.tsx:51`, `scorebug/[gameId]/layout.tsx:33`; player uses the hoisted hook `player/page.tsx:2274`. Single implementation `components/player/TaurusPolyfills.tsx:51,67`. Resolves baseline open-question #5 for the sports surfaces.

**`7982983d` — regression cover added.** `fitness-livetv-embed-guard.test.ts` (lookalike hosts, non-https, `javascript:`/`data:`/`file:`, loopback, + source assertions the CDN fetch and `new Function` are gone); `taurus-polyfill-mounts.test.ts:34-42` asserts all three layouts mount the component.

**Unchanged by tonight:** HLS recovery, Pluto/Xumo TOS, `iptv-m3u` tier, `kick.com` normalise gap, `dashjs`, the `GET board/:id` rate-limit gap, the CtsBridge URL-binding UX gap, Daktronics/WTTC provisional status.

---

## 3. Open findings, ranked

**[P1 — still open, unchanged] Dropped HLS = permanent black screen.** Two independent methods (`grep -rn "recoverMediaError|startLoad|NETWORK_ERROR|ErrorTypes" apps/web/src` and `git grep -n "recoverMediaError|startLoad()" -- apps/`) both return **zero hits repo-wide**. Per-widget recovery behaviour at HEAD:

| Widget | Fatal-error handler | Recovery |
|---|---|---|
| `StreamingWidget.HlsStream` | `:230-234` → `setErrMsg(...)` only | **None.** Red toast `:258-262` over a dead `<video>`. |
| `FitnessLiveTVWidget` | `:278-280` → `if (data?.fatal) setHasError(true)` | **None.** Also flips `showHls` false (`:295-296`) — video element unmounted; even a self-healing stream can't recover without remount. Strictly worse. |
| `StreamingWidget` Safari native path | `:207-209` | **None** — no `error`/`stalled` listener at all. |
| `FitnessLiveTVWidget` Safari native path | same shape | **None.** |
| `FitnessTrainingVideoWidget` | `:144` `onError={() => setHasError(true)}` | **None** (VOD, honest placeholder `:330`, lower stakes). |
| `MusicPlayerWidget` | `<audio>` `:310` | **None**; audio only. |

Effect and fix unchanged from baseline F-3; the manifest poll will not remount because the manifest didn't change.

**[P1 — new framing] `safeEmbedSrc` is client-side only; the server still accepts hostile fitness URLs.** `assertZoneUrlsSafe` enforced at `templates.controller.ts:1065,2442,2647`, but fitness widget types are absent from `URL_BEARING_ZONE_FIELDS` (`zone-url-guard.ts:70-74`) — a `javascript:`, private-range, or same-origin URL in `FITNESS_LIVE_TV.streamUrl` / `FITNESS_TRAINING_VIDEO.videoUrl` is **stored and served on the manifest**, refused only at paint time by one widget. `FitnessTrainingVideoWidget` has neither layer.

**[P1 — still open] Pluto/Xumo TOS self-contradiction.** Legal call, not a code call.

**[P1 — still open] `iptv-m3u` is a `DIRECT` tile with no parser and no upload.**

**[P2 — new] Daktronics published as COMING_SOON while the decoder ships.** Health grid `integrations-health.controller.ts:850-852` says not-yet-built; `console-profiles.ts:165-178` ships a selectable `daktronics-allsport` profile with a real `DaktronicsParser` reachable via `?consoleProfile=`. Honest-direction error, but the truth-gate grid is wrong about a shipped capability.

**[P2 — still open]** `GET /api/v1/sports/board/:id` public, unthrottled (`sports-board.controller.ts:50-53`). **[P2]** Volunteer scorekeeper must hand-type URL (`player/page.tsx:9063-9068`). **[P2]** `kick.com` allowlisted, no normalise branch. **[P2]** `dashjs` dep unused. **[P2 known]** Daktronics + WTTC offsets unvalidated.

---

## 4. Grades at HEAD

| Subdomain | D | UX | F | Δ vs baseline |
|---|---|---|---|---|
| §6 Streaming (overall) | **B−** | **B** | **B−** | up from C+ (F). Two P1s closed; supply-chain + eval risk eliminated. |
| §6.10 stream-drop/reconnect | **D** | **D** | **D** | unchanged — largest remaining defect in this domain. |
| §6 catalog honesty (tiering/TOS) | C | B | **C−** | unchanged; `iptv-m3u` DIRECT + Pluto contradiction are honesty defects. |
| §6 injection/trust boundary | **A−** | B+ | **A−** | up from C. Widget layer solid + regression-tested; docked for server-guard gap + training-video twin. |
| §7 Sports (overall) | **B** | B− | **B** | unchanged. Real bridge, real feed auth, real celebration engine. |
| §7 console/CTS bridge | B | **C+** | B | unchanged; UX still D for the console-fed start path. |
| §7 vendor honesty / truth-gate | – | B | **B** | slight down-tick: Daktronics mis-badged. |
| §7 Taurus surface parity | B+ | **B+** | A− | up from unverified — polyfills on all three sports routes, test-locked. |

---

## 5. UNVERIFIED

1. Nothing executed — all grades are code-reading. F-3 (black screen) inferred from absence of recovery calls, not reproduced.
2. Whether `safeEmbedSrc`'s refusal path renders correctly on a live Taurus WebView (tests are source/unit assertions).
3. Real-hardware validity of Daktronics/WTTC byte offsets.
4. Pluto/Xumo licensing — legal question; repo contradicts itself.
5. Whether the report-only player CSP reports anywhere (no collector endpoint, `next.config.ts:20-22`).
6. Whether any other fitness widget frames/fetches an operator URL — `<video>` users enumerated (7 files); all 25 fitness widgets not exhaustively audited for iframe sources.
7. Whether Daktronics' COMING_SOON badge is intentional gating rather than staleness.
