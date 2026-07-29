# 01 — Codebase Recon: Player / Realtime / Manifest Architecture Map

**Date:** 2026-07-28 · **Produced by:** Explore agent (read-only recon) · **Commissioned for:** frame-locked multi-screen sync design

---

I have everything needed. Here is the architecture map.

---

# Synchronized Multi-Screen Playback — Architecture Recon

**Repo:** `/Users/gschiemann/Desktop/EDU CMS` (Turborepo: `apps/api` NestJS, `apps/web` Next.js, `apps/player` Android/Kotlin, `apps/edge` Cloudflare Worker, `packages/*`)

**Key file sizes:** `apps/web/src/app/player/page.tsx` = **8617 lines** (the entire player is one file), `apps/api/src/screens/screens.controller.ts` = 3807 lines.

---

## 1. PLAYLIST ROTATION ENGINE (the core)

### Where it lives
There is **no separate player component tree**. The rotation engine is a single `useEffect` inside `PlayerPage()` in `apps/web/src/app/player/page.tsx`. The `apps/web/src/components/player/*` files are overlays only (`KioskSplash.tsx`, `EmergencyOverlay.tsx`, `TouchOverlay.tsx`, `CtsBridge.tsx`) — none touch playlist advancement.

### The advance mechanism: a 500 ms self-correcting `setInterval` heartbeat
`apps/web/src/app/player/page.tsx:4782-4884`. Explicitly *replaced* a per-item `setTimeout` (rationale block at `:4680-4718`):

```js
// page.tsx:4806, :4854-4856, :4878-4880
const heartbeat = setInterval(() => {
  const sorted = sortedItemsRef.current;
  const idx = currentIndexRef.current % sorted.length;
  ...
  const duration = item.durationMs || 10000;
  const elapsed = Date.now() - slideStartedAtRef.current;
  if (elapsed >= duration) { ... setCurrentIndex((prev) => prev + 1); }
}, 500);
```

Effect deps: `[phase, playlistItemsSig]` (`:4884`) — the interval is *not* recreated on index change.

### State ownership
- `const [currentIndex, setCurrentIndex] = useState(0)` — `page.tsx:2052`. It is a **monotonically increasing counter**, never reset on wrap; every read is `currentIndex % sorted.length` (`:5347`, `:5829`, `:6551`).
- `currentIndexRef` (`:4729`), `sortedItemsRef` (`:4728`), `slideStartedAtRef` (`:4727`, initialized `useRef<number>(Date.now())`).
- Refs are mirrored on **every render** by a dep-less effect at `:4733-4738`.
- `slideStartedAtRef.current = Date.now()` is reset by `useEffect(..., [currentIndex, playlistItemsSig])` at `:4744-4746`. **This is the single anchor point a shared clock must replace.**
- `playlistItemsSig` (`:4719-4724`) — `${sequenceOrder}|${durationMs}|${manifestKey||id}` joined; the stability trick that stops the interval churning.

### Durations
`item.durationMs` with a **10000 ms fallback** (`:4854`). Populated in the manifest→player transform at `:3558` (`durationMs: item.duration_ms`), from API field `duration_ms` (`screens.controller.ts:3167`), from `PlaylistItem.durationMs` (`packages/database/prisma/schema.prisma:1055`).

### PlaylistItem-level dayparting — **DEAD CODE at runtime**
Two copies of `isItemValid` exist:
- `page.tsx:4785-4801` (inside the heartbeat effect) — skip-forward loop at `:4815-4829`.
- `page.tsx:5286-5297` (`useCallback`, used for the native URL-overlay gate at `:5348`).

Both read `item.daysOfWeek / item.timeStart / item.timeEnd`.

**The manifest never emits those fields.** The API item serializer at `screens.controller.ts:3162-3187` emits only `item_id, asset_id, asset_hash, url, duration_ms, sequence, mime_type, transition_type, muted`. The player transform at `page.tsx:3553-3586` likewise never sets them. The columns *do* exist (`schema.prisma:1057-1059`). Net effect: `isItemValid()` always returns `true` today, and the daypart skip-forward branch is unreachable. Good news for a deterministic scheduler — no per-item filtering to model — but do not assume it stays that way.

### Preloading
- **Video:** the *next* item is mounted at opacity 0 with `preload="auto"`. `page.tsx:6589-6593` (`isNext` computation + `if (isVid && !isActive && !isNext) return null;`), `preload="auto"` at `:868`. Play/pause is imperative on `isActive` change (`PlayerVideoSlide`, `:769-814`) — `autoPlay` was deliberately abandoned (`:617-628`).
- **Images:** all images in the playlist are **always mounted** (only videos and iframes are conditionally returned `null`) — `:6593-6596`. So images are decoded by the browser as a side-effect of being in the DOM at `opacity: 0`. There is **no explicit `img.decode()` anywhere**.
- **Iframes/web/PDF:** active-only, never preloaded (`:6594-6596`, comment: "preloading an inactive iframe runs JS and burns CPU even invisible").
- **Service-Worker precache** (separate tier): `page.tsx:3424-3434` → `precachePlaylist()` in `apps/web/src/app/player/offline-cache.ts:50-57` → `public/sw-player.js`.

### Transitions
`page.tsx:6599-6606`. Purely CSS classes, 1000 ms hardcoded:

```js
const trans = item.transitionType || 'FADE';
let classes = "... transition-all duration-[1000ms] ease-in-out ";
if (trans === 'FADE')            classes += isActive ? "opacity-100 z-10" : "opacity-0 z-0";
else if (trans === 'SLIDE_LEFT') ... 'SLIDE_RIGHT' ... 'SLIDE_UP' ... 'SLIDE_DOWN'
else                             classes += isActive ? "opacity-100 z-10 duration-0" : "opacity-0 z-0 duration-0";
```

Images additionally get an inline `transition: trans === 'NONE' ? 'none' : 'opacity 1000ms ease-in-out'` (`:6784`). **The 1000 ms transition is NOT subtracted from `durationMs`** — items overlap-crossfade into their successor's dwell time.

### Guards that will bite a scheduler
- **Single-distinct-item guard:** `:4851-4852` — `if (distinctIds.size <= 1) return;` never advances (never even bumps the counter).
- **Video items are skipped by the heartbeat entirely:** `:4831-4833` — `if (item.asset?.mimeType?.startsWith('video/')) return;`. Videos advance via `<video onEnded>` at `:6644`, i.e. **item duration is ignored for video; the file's natural length rules**.
- **Solo-video playlists** use the native `loop` attribute and never fire `onEnded` (`:6627-6628`, `:885-886`).
- **Bundle-reload at loop boundary:** `:4857-4877` — on the last item, if a new web bundle is pending, the player calls `hardCacheBustingReload()` instead of advancing.

---

## 2. VIDEO PLAYBACK

- Component: `PlayerVideoSlide`, `apps/web/src/app/player/page.tsx:729-899`. Renders a raw `<video>` (`:863-898`).
- Mount site: `:6629-6652`, `key={item.id}`.
- **Muted:** `const isMuted = muted !== false;` (`:767`) — defaults to muted. Set as both JSX prop (`:883`) and IDL property (`:783`). Manifest field `muted` resolved server-side as `schedule.mutedOverride > item.muted > true` (`screens.controller.ts:3184-3186`).
- **Autoplay:** imperative `v.play()` at `:798`; on rejection for unmuted video it falls back to `v.muted = true; v.play()` (`:800-809`). Document-wide `pointerdown/keydown/touchstart` listeners retry unmute (`:822-843`).
- **Loop:** `loop={isSoloPlaylist}` (`:885`); `onEnded` is `undefined` for solo playlists (`:886`).
- **Video shorter than item duration:** irrelevant — heartbeat skips video items (`:4833`), so `onEnded` is authoritative. Video longer than `durationMs`: also plays to completion. **`durationMs` is effectively ignored for video items.**
- **`currentTime`:** used in exactly one place — `try { v.currentTime = 0; }` when a video becomes active (`:776`). 
- **`playbackRate`:** never used anywhere in `apps/web/src`.
- **`requestVideoFrameCallback`:** never used anywhere in the repo.
- `requestAnimationFrame` is used only for the render-proof paint counter (`:2861-2872`) and a canvas-pin re-apply loop (`:1767-1769`).
- `.mov` MIME coercion: `:861`, `:890-897` (renders `<source type="video/mp4">` children).

---

## 3. MANIFEST

**Endpoint:** `GET /api/v1/screens/:id/manifest` — `apps/api/src/screens/screens.controller.ts:2475-3288`, guarded by `@UseGuards(JwtAuthGuard)` (`:2474`). Auth accepts device JWT (`u.kind === 'device' && u.sub === screen.id`), SUPER_ADMIN, or same-tenant user JWT (`:2523-2537`).

### Three response branches
1. **Emergency** (`:2891-2939`) — returns early. Flat fields: `screenId, generatedAt, isEmergency: true, emergencyType, emergencySeverity, emergencyScopeNote, emergencyScope, emergencyExpiresAt` (UNIX **seconds**, `:2916-2918`), `orientation` (lowercase `'portrait'|'landscape'` here — differs from the normal branch!), `canvasW, canvasH, repeats, gpio, playlists`. **No ETag on this branch.**
2. **Scoreboard** (`:2956-2999`) — synthetic board manifest.
3. **Normal** (`:3191-3287`) — the interesting one.

### Normal manifest payload shape (`screens.controller.ts:3191-3265`)
```
version: "1.0", screenId, tenantId, tenantName,
generatedAt: ISO string,          // ← the ONLY server-time field; excluded from the hash
isEmergency: false,
orientation: 'LANDSCAPE'|'PORTRAIT'|'AUTO',
canvasW: number|null, canvasH: number|null,
repeats: 1..12,
gpio: { out1, out2 }, wiring, consoleProfile, hardwareModel,
playlists: [ { id, name, schedule:{daysOfWeek,timeStart,timeEnd,mutedOverride},
               totalBytes, template?, items:[ ... ] } ],
hash: <sha256>
```

**There is NO `serverNow` / `serverTime` / epoch-ms field on the manifest.** `generatedAt` is an ISO string and is *deliberately stripped before hashing* (`:3277`) so it doesn't break the ETag. The player **never parses `generatedAt`** (grep confirms zero reads). This is the natural place to add a monotonic server epoch, but note the hash-exclusion pattern you must mirror.

### Items: **nested on the wire, FLAT in the player**
API emits `playlists[].items[]` (nested). The player flattens *all* playlists into one array at `page.tsx:3544-3588`:
```js
const combinedItems: any[] = [];
manifest.playlists.forEach((mp) => { mp.items.forEach((item, itemIndex) => {
  combinedItems.push({ id: `${mp.id||mp.name||'pl'}:${item.sequence??itemIndex}:${itemIdentity}`,
                       manifestKey, durationMs, sequenceOrder, transitionType, muted, asset:{fileUrl,mimeType} });
});});
```
Then `setPlaylist({ name, items: combinedItems })` (`:3637-3640`). So the memory that "items are FLAT" is correct **for the player's internal model** (`playlist.items`), not for the HTTP payload.

### Polling cadence (three concurrent timers, all calling `fetchContent()`)
| Timer | Cadence | Location |
|---|---|---|
| Emergency/content poll | 5 s if emergency active or `wsFailCount>=2`, else **10 s** | `page.tsx:4666-4677` |
| Missed-event reconcile | **30 s**, phase-independent | `page.tsx:3922-3929` |
| WS-down HTTP fallback | 5 s | `page.tsx:4220-4224` |
| WS `SYNC`/`OVERRIDE`/`ALL_CLEAR` | event-driven | `page.tsx:4411-4413` |
| SSE `SYNC`/`OVERRIDE`/`ALL_CLEAR` | event-driven | `page.tsx:4142-4144` |

### ETag / content-hash
- Server: `sha256(JSON.stringify(payloadMinusGeneratedAt) + id)` → `res.setHeader('ETag', versionHash)`; `304` if `If-None-Match` matches (`:3277-3286`). Board branch does the same (`:2989-2999`).
- Client: `manifestEtagRef` (`page.tsx:2168`), sent as `If-None-Match` (`:3692`), 304 short-circuits (`:3697`), and the stored ETag is **replaced-or-cleared** on every 200 (`:3726`) because the emergency branch returns 200 with no ETag.
- Separate client-side change detection: `currentPlaylistSigRef` (`:3618-3629`) — `${sequenceOrder}|${durationMs}|${stable}` joined. If unchanged, `applyManifest` returns early and **does not touch `currentIndex`** (`:3627-3629`). If changed, it clamps rather than resets: `setCurrentIndex(prev => oldHasItems ? prev % combinedItems.length : 0)` (`:3644-3647`).
- Empty-manifest debounce: 3 consecutive empties required before clearing (`:3659-3676`).

---

## 4. WEBSOCKET LAYER

### Server
- Gateway: `apps/api/src/realtime/realtime.gateway.ts`, `@WebSocketGateway({ path: '/realtime' })` (`:26`), native `ws` (not socket.io).
- Redis fanout: `apps/api/src/realtime/redis.service.ts`.
- SSE mirror: `apps/api/src/realtime/sse.controller.ts` + `sse.service.ts`.
- Shared enum: `packages/ws-events/src/index.ts` — **this package is stale/aspirational.** It declares `HELLO, AUTH_OK, AUTH_FAIL, HEARTBEAT, PUBLISH_AVAILABLE, OVERRIDE, ALL_CLEAR, ACK, STATE_RESYNC_REQUIRED, DEVICE_REVOKED, PURGE_CACHE, ORIENTATION_CHANGE`. It is **not imported by the gateway or the player** — everything is stringly-typed at the call sites. Don't trust it as the type registry.

### All message types the API actually emits (`signMessage(...)` call sites)
| Type | Emitter | Channel |
|---|---|---|
| `SYNC` | `playlists.controller.ts:34`, `schedules.controller.ts:36`, `screens.controller.ts:166` | `tenant:<id>` |
| `OVERRIDE` | `emergency.controller.ts:580`, `screen-emergency.controller.ts:342`, `gpio.service.ts:412` | `tenant:`/`device:` |
| `ALL_CLEAR` | `emergency.controller.ts:676`, `screen-emergency.controller.ts:468` | `tenant:`/`device:` |
| `SOS` / `TEXT_BROADCAST` / `MEDIA_ALERT` / `ALL_CLEAR_MESSAGE` | `emergency.controller.ts:922/1004/1090/1173` | scope channel |
| `TENANT_CHANGED` | `screens.controller.ts:1247` | `tenant:<prev>` |
| `ORIENTATION_CHANGE` | `screens.controller.ts:1552, 1742` | `device:<id>` |
| `CANVAS_CHANGE` | `screens.controller.ts:1649` | `device:<id>` |
| `GAME_STATE` | `screens.controller.ts:1818` | `device:<id>` |
| `CTS_MANUAL_CUE` | `screens.controller.ts:1886` | `device:<id>` |
| `CHECK_FOR_UPDATES` | `screens.controller.ts:2191, 2258` | `tenant:<id>` |
| `REFRESH_WEB` | `screens.controller.ts:2316, 2350`, `screen-wedge-detector.cron.ts:319` | `tenant:<id>` |
| `GPIO_SET` | `gpio.service.ts:498` | `device:<id>` |
| `STICK_COMMAND` | `fitness/stick-control.controller.ts:257` | `tenant:<id>` |
| `health.probe` | `health.controller.ts:181` | — |

### All message types the PLAYER handles (`page.tsx`, exhaustive)
`AUTH_OK` (`:4301`), `TENANT_CHANGED` (`:4395`), `SYNC`/`OVERRIDE`/`ALL_CLEAR` (`:4411`), `SOS`/`TEXT_BROADCAST`/`MEDIA_ALERT` (`:4421`), `ALL_CLEAR_MESSAGE` (`:4443`), `GAME_STATE` (`:4454`), `CTS_MANUAL_CUE` (`:4477`), `REFRESH_WEB` (`:4507`), `CHECK_FOR_UPDATES` (`:4560`).

**Not handled by the player: `CANVAS_CHANGE`, `ORIENTATION_CHANGE`, `GPIO_SET`, `STICK_COMMAND`, `PURGE_CACHE`, `DEVICE_REVOKED`, `ACK`.** The comment at `page.tsx:3286` claiming canvas propagates "~150ms via CANVAS_CHANGE WS broadcast" is **false** — it only converges on the next manifest poll. Precedent worth noting: adding a new WS type means adding a branch in `ws.onmessage` **and** a `handle('TYPE', fn)` in the SSE block (`:4142-4204`), or it silently no-ops on one transport.

### What `SYNC` does — exactly
Nothing more than **"re-fetch the manifest."** Server: `signMessage('SYNC', { source: 'playlist_update' | 'schedule_update' | 'screen_update' })`, published to `tenant:<tenantId>`. Client: `if (msg.type === 'SYNC' || ...) fetchContent();` (`page.tsx:4411-4413`). **`SYNC` is NOT in `SENSITIVE_TYPES`** (`:4340-4347`), so it bypasses the client-side signature + freshness + replay gates. It carries no timing payload. It is a pure cache-invalidation nudge — free to extend, but note that any *new* type you add is *also* ungated unless you add it to `SENSITIVE_TYPES`.

### Client connect + auth
`page.tsx:4226-4277`:
```js
const wsUrl = getApiRoot().replace(/^http/, 'ws') + '/realtime';
const ws = new WebSocket(wsUrl);
ws.onopen = () => { ... ws.send(JSON.stringify({ event: 'HELLO', data: { token: tok } })); ... }
```
- Token: `getDeviceToken()` → `localStorage['edu_device_token']` (`LS_TOKEN`, `page.tsx:55`, getter `:474-480`). Dev fallback `dev_${screenId}_${tenantId}` (`:4255`), which the server rejects unless `DEV_WS_ALLOW=true` and non-prod (`realtime.gateway.ts:114-121`). A banner is shown when unsigned (`page.tsx:4257-4259`).
- Server `processHello` (`realtime.gateway.ts:100-220`): `jwt.verify(token, DEVICE_JWT_SECRET)` → Redis `jwt_revoked_list` check (`:135`) → live `screen.findUnique` for tenant + `screenGroupId` (`:149-171`) → `ctx.deviceId/tenantId/groupId` → replies **`AUTH_OK` with `serverTime: Date.now()`** (`:193-204`). 10 s auth timeout at `:46-52`.

### Heartbeat / ping-pong
- **Client → server:** `setInterval(15_000)` sending `{ event: 'HEARTBEAT' }` with **no payload** (`page.tsx:4266-4276`). Same interval also force-closes the socket if `Date.now() - lastWsMessageAtRef.current > 60_000` (`:4271-4273`).
- **Server:** `processHeartbeat` (`realtime.gateway.ts:223-239`) writes `device:<id>:status` hash fields `lastSeen` + `metrics` into Redis. **It sends no reply** — there is no pong. So the player's own 60 s silence detector is only fed by *broadcast* traffic, and on a quiet tenant it can force-reconnect. (`ws-events` declares a `HeartbeatEvent` with `payload.metrics{cpu,mem,temp}`; the player sends none.)
- **SSE keepalive:** `: keepalive <ts>\n\n` comment every 25 s (`sse.service.ts:72`, `:190`).
- No `ws.ping()` / `pong` frames anywhere.

### Direct reply to one socket — YES, and it bypasses the HMAC gate
`RealtimeGateway.send()` is `private` (`realtime.gateway.ts:314-336`) but is called directly for `AUTH_OK` (`:193`) and `AUTH_FAIL` (`:217`). Those frames go straight out over the socket and **never traverse Redis**, therefore **never pass through `verifyWsHmac`**.

The signed-HMAC gate applies **only to the Redis `pmessage`/`message` fanout path**: `redis.service.ts:191-198`
```js
const verdict = verifyWsHmac(parsed, this.deviceSecret);
if (!verdict.ok) { this.logger.warn(`[WS] DROPPED unverified message on ${channel} ...`); return; }
if (this.gateway) this.gateway.broadcastToScope(type, id, parsed);
if (this.sse) this.sse.broadcastToScope(type, id, parsed);
```
`verifyWsHmac` (`apps/api/src/security/ws-signature.ts:51-92`) has a **±120 s freshness window** (`maxAgeMs = 120_000`), stateless, no nonce (rationale `:39-50`).

`broadcastToScope` (`realtime.gateway.ts:262-297`) matches `type==='tenant'|'group'|'device'` against `ctx.tenantId/groupId/deviceId` and forwards `message.signature`, `message.eventId`, and — critically — **`message.timestamp` unchanged** (`:284-292`; the comment at `:276-283` documents the seconds-vs-ms bug that this fixed).

**Design implication for a shared clock:** a per-socket `send()` (e.g. a `TIME_SYNC` reply carrying `t1/t2` for NTP-style round-trip estimation) is already possible today with zero Redis involvement and zero HMAC signing — exactly like `AUTH_OK`. You would need to make `send()` public or add a public method. There is currently **no inbound message type other than `HELLO`, `HEARTBEAT`, `ACK`** (`realtime.gateway.ts:71-83`, `default:` just debug-logs) — so adding a `TIME_SYNC` request case is a one-line switch addition.

### Client-side gates on inbound messages (`page.tsx:4340-4374`)
```js
const SENSITIVE_TYPES = new Set(['OVERRIDE','TENANT_CHANGED','SOS','TEXT_BROADCAST','MEDIA_ALERT','ALL_CLEAR_MESSAGE']);
if (SENSITIVE_TYPES.has(msg.type)) {
  if (!msg.signature) return;                                   // :4349
  const adjustedNow = Date.now() + serverClockOffsetRef.current; // :4355
  if (typeof msg.timestamp !== 'number' || Math.abs(adjustedNow - msg.timestamp) > 30_000) return; // :4356
  ... eventId replay dedup, bounded to 500 / 5 min (:4360-4373)
}
```

### Transport ladder
WS → (3 consecutive close failures, `:4633`) SSE at `GET /api/v1/realtime/sse?token=<deviceJwt>` (`page.tsx:4105`, server `sse.controller.ts:39-80`) → (2 SSE failures, `:4212`) 5 s HTTP poll (`:4220-4224`). WS reconnect uses `backoffMs(failCount, 1000, 30_000)` full-jitter exponential (`:4619`).

---

## 5. EXISTING CLOCK-SKEW COMPENSATION (the seed)

**Commit `5124dda7`** — "fix(player): clock-skew compensation never engaged — emergency pushes dropped" (2026-07-25, +12/-2, only `apps/web/src/app/player/page.tsx`).

### The whole mechanism, in three places

**(a) Storage** — `apps/web/src/app/player/page.tsx:2245`
```js
const serverClockOffsetRef = useRef<number>(0);
```
Comment at `:2244`: *"by ADDING to local Date.now() before comparing."*

**(b) Computation** — `page.tsx:4299-4307`, only on `AUTH_OK`, only over WebSocket:
```js
const authServerTime =
  (msg?.payload as any)?.serverTime ?? (msg as any)?.data?.serverTime;   // :4299-4300
if (msg.type === 'AUTH_OK' && typeof authServerTime === 'number') {
  const srv = authServerTime as number;
  serverClockOffsetRef.current = srv - Date.now();                        // :4303
  if (Math.abs(serverClockOffsetRef.current) > 5000) {
    console.warn('[Player WS] Large clock skew detected — offset=', serverClockOffsetRef.current, 'ms');
  }
}
```

**(c) Sole consumer** — `page.tsx:4355-4358`, the ±30 s freshness gate for `SENSITIVE_TYPES` only.

### What feeds it
Exactly one source: `serverTime: Date.now()` in the `AUTH_OK` payload from `apps/api/src/realtime/realtime.gateway.ts:203` (rationale comment `:196-202`). **Not** the manifest, **not** message timestamps, **not** HTTP `Date` headers.

### Everything wrong with it as a shared-clock seed
1. **One-shot.** Captured once per WS connection; never re-sampled, never smoothed, never re-estimated. A reconnect re-samples; a 12-hour-stable socket never does.
2. **No round-trip compensation.** `srv - Date.now()` includes the full server→client network latency as offset error. There is no `t0`/`t3` client-send/receive pair anywhere — no Cristian's/NTP algorithm. Typical error = one-way latency (tens of ms on LAN, 100 ms+ over WAN).
3. **Not persisted.** Pure `useRef`, lost on any reload — and the player reloads aggressively (see gotchas).
4. **Never applied to playback.** `slideStartedAtRef` (`:4727`, `:4745`) and `elapsed` (`:4855`) use raw `Date.now()`. The offset touches only the emergency freshness gate.
5. **Zero on SSE and HTTP-fallback tiers.** SSE has no `AUTH_OK` (`page.tsx:4127-4130` explicitly notes SSE has no signed-replay protection); on those transports the offset stays 0 forever.
6. **Silently-failing-optional-chaining is the exact bug class this commit fixed** — the `?? (msg as any)?.data?.serverTime` fallback at `:4300` is a defensive leftover; keep or drop deliberately.

The related emergency-cache TTL anchoring (server-issued absolute expiry preferred over device wall clock) is at `page.tsx:558-587` and `screens.controller.ts:2916-2918` — same philosophy, different mechanism, worth reading before you design.

---

## 6. HEARTBEAT / TELEMETRY

### Channel A — status ping (proves TCP + JS event loop)
- Endpoint: `GET /api/v1/screens/status/:deviceFingerprint` — `screens.controller.ts:546-...`, query params `?v=` (versionName), `?vc=` (versionCode), `?mv=` (managerVersion). No auth guard.
- Server writes `lastPingAt: new Date()`, `status: 'ONLINE'|'PENDING'` (`:585-588`), plus version fields.
- **Write debounce:** `shouldSkipLastPingWrite(screen.id)` / `markLastPingWritten(screen.id)` — 25 s per screen, `apps/api/src/screens/manifest-hot-cache.ts:34` (`LAST_PING_DEBOUNCE_MS = 25_000`).
- Player callers: **two** — a `phase==='playing'`-scoped 45 s interval (`page.tsx:4077-4085`) and an always-on 30 s interval (`page.tsx:3878-3899`). Both hit `buildHeartbeatUrl(getApiRoot(), fp)`.
- Also touched by the manifest endpoint itself (`screens.controller.ts:2509-2514`).
- Android also runs `HeartbeatService.kt` (`apps/player/app/src/main/java/com/educms/player/heartbeat/HeartbeatService.kt`).

### Channel B — render-proof / proof-of-display (commit `22fd9ff4`)
- **Endpoint:** `POST /api/v1/screens/:id/render-proof` — `screens.controller.ts:3382-3433`.
- **Auth:** `verifyDeviceForScreen(req, id)` — device JWT bound to the screen id (`:3401-3404`).
- **Throttle:** `@Throttle({ default: { limit: 600, ttl: 60_000 } })` (`:3395`). Was 10/min; commit `22fd9ff4` raised it because *the throttler tracker keys on public IP and a venue's whole fleet NATs to one address* (`:3383-3394`). **Read this comment before adding any new per-screen POST route — every `@Throttle` in the app is per-SITE, not per-device.**
- **Body:** `{ frames?: number; hash?: string; contentKind?: string }` (`:3399`). `frames` clamped non-negative int, `hash` sliced to 128 chars (`:3415-3419`).
- **Write debounce:** `shouldSkipRenderProofWrite(id)` → ≤1 write per 40 s (`:3409`, comment `:3405-3408`).
- **Columns:** `Screen.lastRenderedAt / lastRenderedFrames / lastRenderedHash` — `schema.prisma:769-771`.
- **Player side:** `page.tsx:2874-2908` — 30 s `setInterval`, gated on `renderStateRef.current.rendering`, and **skips the POST entirely if the rAF frame counter hasn't advanced** (`:2884-2889`) so a wedge goes stale rather than being masked. Payload built at `:2897-2901`. Frame counter loop: `:2861-2872`. Content signature: `:2837-2854`.
- **Verdict helper:** `apps/api/src/screens/render-proof.ts` — pure `deriveRenderHealth()` (`:84-112`), `RENDER_PROOF_STALE_MS = 90 * 1000` (`:38`). Consumed in the fleet list at `screens.controller.ts:1043-1047`.
- Test: `apps/api/src/screens/screens.render-proof.spec.ts`.

**This is the right channel to piggyback per-screen sync-error telemetry**: it's device-authed, already 30 s, already best-effort/swallowed, already sanitizes its body, and adding an optional numeric field is precedent-matched by `frames`/`hash`/`contentKind`. Adding a nullable `lastSyncErrorMs` column follows the `20260529000001_add_screen_render_proof` migration pattern exactly.

### Channel C — cache status
`POST /api/v1/screens/:id/cache-status`, 30 s, device JWT — `page.tsx:2767-2790`.

### Channel D — touch analytics (batching pattern worth copying)
`POST /api/v1/analytics/touch-events`, 5 s flush, `keepalive: true`, requeue-on-5xx with a 4-minute freshness filter — `page.tsx:5060-5100`, queue push at `:5107-5117`.

### Not a player channel
`PlaybackSample` / `playback_samples` (`schema.prisma:1424-1440`) is written by a **server-side** `ProofOfPlaySampler` cron every ~10 min, not by the player.

---

## 7. SCHEDULE RESOLUTION

**100% server-side, inside the manifest handler.** The player does no schedule resolution.

`screens.controller.ts:3003-3059`:
```js
const now = new Date();
const scheduleTargetOr: any[] = [{ screenId: screen.id }];
if (screen.screenGroupId) { scheduleTargetOr.push({ screenGroupId: screen.screenGroupId }); }
const schedules = await this.prisma.client.schedule.findMany({
  where: { AND: [
    ...(screen.tenantId ? [{ tenantId: screen.tenantId }] : []),
    { OR: scheduleTargetOr },
    { startTime: { lte: now } },
    { OR: [{ endTime: { gte: now } }, { endTime: null }] },
    { isActive: true },
  ]},
  include: { playlist: { include: { items: { where: { asset: { status: 'PUBLISHED' } }, orderBy: { sequenceOrder: 'asc' }, include: { asset: true } }, template: {...} } } }
});
```

### Exact resolution order (and its surprises)
1. **Per-screen emergency override** (`ScreenEmergencyOverride`) beats everything — `:2551-2565`, `:2613-2615`.
2. **Tenant-wide emergency** — `:2567-2617`. Returns early.
3. **Active scoreboard game** (`screen.activeBoardGameId`) — `:2950-3000`. Returns early.
4. **Scheduled content** — the query above.

**Then: `priority` is NOT applied. There is no `orderBy` on this query at all.** `Schedule.priority` exists (`schema.prisma:1091`) and is used only by `apps/api/src/schedules/go-dark-fallback.ts:70` (`orderBy: [{ priority: 'desc' }, { startTime: 'desc' }]`). In the manifest path, **every matching schedule is returned**, mapped 1:1 to `dynamicPlaylists` (`:3088-3189`), and the player **concatenates all of their items into one flat rotation** (`page.tsx:3544-3588`, playlist named `'Scheduled Content (Combined)'` when `length > 1`, `:3638`).

**Schedule-level dayparting (`daysOfWeek`/`timeStart`/`timeEnd`) is NOT enforced anywhere.** The query has no filter for them; they are emitted as display-only metadata under `pl.schedule` (`:3103-3108`) and consumed by the player *only* for the Stopped-splash info card (`page.tsx:3527-3529`). Combined with §1's dead `isItemValid`, **the effective runtime schedule model today is: "concatenate every active, in-date-range schedule's items and loop them."**

Multi-tenant safety note worth preserving: the `{ screenGroupId: null }` Prisma pitfall is documented at `:3004-3014` — do not add a group clause when the screen has no group.

---

## 8. SCREEN GROUPS

### Schema
`packages/database/prisma/schema.prisma:658-669`:
```prisma
model ScreenGroup {
  id String @id @default(uuid())
  tenantId String @map("tenant_id")
  name String
  description String?
  createdAt DateTime @default(now()) @map("created_at")
  schedules Schedule[]
  tenant Tenant @relation(...)
  screens Screen[]
  @@map("screen_groups")
}
```
`Screen.screenGroupId String? @map("screen_group_id")` — `:674`. `Schedule.screenGroupId String?` — `:1084`.

**Note: `ScreenGroup` has no `orientation`, `canvas`, or any playback-config fields.** It is a pure grouping label. A sync-group concept would either reuse it or need new columns/table.

### API
`apps/api/src/screen-groups/screen-groups.controller.ts` — `@Controller('api/v1/screen-groups')` (`:23`), `@Get()` (`:28`), `@Post()` (`:121`), `@Delete(':id')` (`:167`). Screen assignment happens via `PUT /screens/:id` body `screenGroupId` (`screens.controller.ts:1382`, `:1477`) and at pair time (`:1169`, `:1214`).

### Dashboard UI
`apps/web/src/app/[schoolId]/screens/page.tsx` (2380 lines) — hooks imported at `:5`: `useScreenGroups, useCreateScreenGroup, useDeleteScreenGroup, useUpdateScreenGroup`. Group list/render at `:1371`, `:1395-1397`, `:1452` (`ungroupedScreens` filter), create form `:1776-1792`, inline rename `:1837-1856`, pair-to-group `:1534`, `:1873-1877`. There is **no dedicated `/screen-groups` route** — everything is inside this one page.

### Group-scoped WS channels — **wired but never published to**
- Redis subscribes the pattern: `psubscribe('tenant:*', 'group:*', 'device:*')` — `redis.service.ts:142`.
- Gateway resolves `ctx.groupId` from the **live** `Screen.screenGroupId` row (deliberately *not* from the JWT — rationale at `realtime.gateway.ts:162-171`), and matches `if (type === 'group' && ctx.groupId === id) match = true;` (`:271`). SSE mirrors at `sse.service.ts:154`.
- Devices are registered into `group:<id>:devices` Redis sets at `realtime.gateway.ts:210-212`.
- **But grep across `apps/api/src` finds ZERO `redis.publish('group:...')` call sites.** The only group-aware emitter is the emergency scope resolver (`emergency.controller.ts:280-288`, `:334-341`), which builds `channel = \`${scopeType}:${scopeId}\`` at `:590` — so a `scopeType: 'group'` emergency trigger *would* publish to `group:<id>`, but nothing else does.

**Bottom line: `group:<id>` fanout is fully functional infrastructure with essentially no traffic on it.** It is the natural, zero-new-plumbing channel for a group-wide "sync epoch" broadcast.

---

## 9. ANDROID / TAURUS PLAYER

**Yes — the APK is a WebView shell that loads the web `/player` URL.** There is no native playback engine.

- `apps/player/app/src/main/java/com/educms/player/MainActivity.kt` — "Fullscreen WebView player. Loads the EduCMS web player URL with the device's..." (`:41`).
- URL construction: `loadPlayer(token)` at `MainActivity.kt:1389-1452`:
  ```kotlin
  val base = BuildConfig.PLAYER_BASE_URL.trimEnd('/')
  val (wPx, hPx) = getRealDisplaySize()
  val builder = Uri.parse(base).buildUpon()
    .appendQueryParameter("client","android").appendQueryParameter("v", VERSION_NAME)
    .appendQueryParameter("vc", ...).appendQueryParameter("w", wPx).appendQueryParameter("h", hPx)
    .appendQueryParameter("dpr", density).appendQueryParameter("mv", managerVersion ?: "")
    .appendQueryParameter("fp", "android-$androidId")   // Settings.Secure.ANDROID_ID
  if (token.isNotBlank()) builder.appendQueryParameter("token", token)
  webView.setInitialScale(100); webView.loadUrl(url)
  ```
- `PLAYER_BASE_URL` from `apps/player/app/build.gradle.kts:71-73`.
- Native bridge: `WebAppBridge.kt`, exposed as `window.EduCmsNative` — player calls `setOrientation` (`page.tsx:3266`), `reload` (`:4533`), `checkForUpdates` (`:4585`), `showUrlOverlay`/`hideUrlOverlay` (`:5328-5334`, `:6675`), `unpair` (`:4406`). `mediaPlaybackRequiresUserGesture=false` is set so unmuted autoplay works on kiosk (`page.tsx:790-791`).
- Second top-level WebView for URL assets: `configureUrlOverlay` (`MainActivity.kt:1261`), `showUrlOverlay` (`:1333`).
- Other Kotlin of note: `NetworkRecoveryController.kt`, `DeviceStore.kt`, `bootstrap/ManagerBootstrap.kt`, `heartbeat/HeartbeatService.kt`, `usb/UsbIngester.kt`, `crash/CrashUploader.kt`.

### Persisted per-device settings pattern to follow
**Web side — `localStorage`**, keys defined at `page.tsx:55-57` and used ad hoc:
| Key | Written | Read |
|---|---|---|
| `edu_device_token` (`LS_TOKEN`) | `:476`, `:3040` | `:479` |
| `edu_manifest_cache_v1` | `:490` | `:494` |
| `edu_emergency_cache_v1` | `:565` | `:575` |
| `edu_api_root` | `:600` | `:603` |
| `edu_device_fp` | `:929`, `:941` | `:938`, `:1167` |
| `edu_canvasW` / `edu_canvasH` / `edu_repeats` | `:3347-3349`, `:8393-8394` | `:683`, `:8323-8324` |
| `edu_fitMode` | `:8395` | `:8330` |
| `edu.ota.lastInstalledAt` | `:2355` | `:2151` |

**Canonical precedence chain for a per-device calibration value** (copy this for a sync-offset trim) — `ScaledWebFrame` at `page.tsx:677-696`: `URL param → localStorage → CSS var`, each `parseInt`-validated and `> 0`-checked, wrapped in try/catch. The rationale at `:669-675` matters: *a React root regeneration after a hydration mismatch wipes `documentElement` inline styles, so URL params and localStorage are the durable sources.* The boot-time pin script lives in `apps/web/src/app/player/layout.tsx:53-80+`.

**Android side — SharedPreferences** named `edu_player` (`MainActivity.kt:121` `PREFS_NAME`, used at `:652`, `:732`, `:790`).

---

## 10. PATTERNS TO FOLLOW

### (a) Additive Prisma migrations
`packages/database/prisma/migrations/`. Recent nullable-column additions:
- **`20260529000001_add_screen_render_proof/migration.sql`** — the best template. Three nullable columns, `ADD COLUMN IF NOT EXISTS`, and a ~30-line comment block explaining what null means semantically ("A NULL `last_rendered_at` reads as UNKNOWN, never RED"):
  ```sql
  ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "last_rendered_at" TIMESTAMP(3);
  ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "last_rendered_frames" INTEGER;
  ALTER TABLE "screens" ADD COLUMN IF NOT EXISTS "last_rendered_hash" TEXT;
  ```
- **`20260725060000_tenant_emergency_type/migration.sql`** — one nullable TEXT column, 5-line rationale.
- **`20260723140000_tenant_archived_at/migration.sql`** — nullable timestamp + `CREATE INDEX IF NOT EXISTS`.

House style: `IF NOT EXISTS` on every statement, a dated comment header, an explicit "additive + nullable → no backfill, older replicas unaffected" claim. Directory naming: `YYYYMMDDHHMMSS_snake_case_description`.

### (b) Feature flags / gradual rollout
Two independent systems:
1. **OpenFeature + GrowthBook** — `apps/api/src/feature-flags/feature-flags.service.ts`. `FLAGS` const map at `:5-11` (`EMERGENCY_NEW_UI`, `TEMPLATE_BUILDER_V2`, `SIS_INTEGRATION`, `SPORTS_PLAYER_STATS`, `SPORTS_RECORDS_MILESTONES`). Falls back to `FF_<FLAG>=true` env vars when `GROWTHBOOK_API_HOST`/`GROWTHBOOK_CLIENT_KEY` are unset (`:41-49`). `isEnabled()` is **synchronous and always uses the env fallback** (`:64-73`) — only `isEnabledAsync()` actually consults GrowthBook. Controller: `apps/api/src/feature-flags/feature-flags.controller.ts`, auth-gated. Web side uses `NEXT_PUBLIC_GROWTHBOOK_*` directly.
2. **Canary fleet rollout** — `GET/PUT /api/v1/tenants/me/canary-rollout` (`apps/api/src/tenants/tenants.controller.ts:850`, `:871`); `Tenant.canaryFleetPercent` read at `apps/api/src/license/super-license.controller.ts:116` (`canaryPercent: t.canaryFleetPercent ?? 100`). Hooks `useCanaryRollout` / `useUpdateCanaryRollout` at `apps/web/src/hooks/use-api.ts:2432-2445`. This is the *fleet-percentage* rollout precedent — the right one for a risky playback change.

Also relevant: the player already gates itself on manifest-field presence with `?? null` / allow-list validation (`page.tsx:3336-3341` `cpAllowed`, `:3315` `allowed` set) — the established "older APK ignores unknown manifest keys" contract (stated at `screens.controller.ts:3204-3206`, `:3261-3262`).

### (c) Per-screen settings UI (where to add a "sync offset trim" input)
**`apps/web/src/app/[schoolId]/screens/page.tsx`, `ScreenDiagnostics` component, `:366-...`** — a gear-popover drawer per screen row. Existing controls to pattern-match:
- Orientation `<select>` — `:427-444`, `setOrientation.mutate({ id, orientation })`.
- LED canvas panel-count buttons — `:451-520`, `setCanvas.mutate({ id, canvasW, canvasH })`. Note the two defensive patterns documented at `:458-471`: `e.stopPropagation()` (the popover's document-mouseup handler closes the menu mid-click otherwise) and **deliberately not using `disabled={mutation.isPending}`** (relies on React Query queueing).
- Hooks: `useSetScreenOrientation` (`use-api.ts:182`), `useSetScreenCanvas` (`:235`), `useUpdateScreen` (`:442`).
- Server route template: `PUT /screens/:id/canvas` — `screens.controller.ts:1585-1663`. It shows the full house pattern: range-validate → `findFirst` tenant-scoped → `$transaction([update, auditLog.create])` with `action: 'SCREEN_CANVAS_CHANGED'` and a `{from, to}` details JSON → `signMessage(...)` → `redis.publish(\`device:${id}\`, signed)` → return updated row. Sibling routes: `PUT :id/orientation` (`:1503`), device-authed variant `PUT :id/orientation/device` (`:1684`), `PUT :id/location` (`:1927`), `PUT :id/emergency-content` (`:2010`).

### (d) Tests

**Jest — player-side pure functions.** The exemplar is `apps/web/src/app/player/emergencyReconcile.ts` + `apps/web/src/app/player/__tests__/emergencyReconcile.test.ts`. The pattern is explicit in the module docstring (`emergencyReconcile.ts:14-16`): *"This pure function encodes the DECISION so it can be exhaustively unit-tested without mounting the 7k-line player page."* **Extract your scheduler's `whichItemAt(epochMs, items)` / offset-estimator into a sibling pure module and do exactly this.**
- Config: `apps/web/jest.config.js` — `testEnvironment: 'jsdom'`, `roots: ['<rootDir>/src']`, `testMatch: ['**/__tests__/**/*.test.(ts|tsx)']`, `ts-jest`, `@/` → `src/`.
- Other player test: `apps/web/src/app/player/__tests__/touch-dispatch.test.tsx`.
- API-side pure-function precedent: `apps/api/src/screens/render-proof.ts` + `screens.render-proof.spec.ts` (docstring at `render-proof.ts:16-18`: *"pure function so it can be unit-tested without a Prisma client — same discipline as `ScreenWedgeDetectorCron.decide`"*).

**Playwright — two configs, use the web-scoped one.**
- `apps/web/playwright.config.ts`: `testDir: './tests/e2e'`, `baseURL: http://localhost:3000`, **chromium AND webkit projects** (non-negotiable per the config comment `:20-22`), `serviceWorkers: 'block'`, `timeout: 20_000`, and `webServer.env.NEXT_PUBLIC_API_URL = 'http://api.invalid/api/v1'` **so any unmocked API call blows up with DNS NXDOMAIN**. Every API call is intercepted with `page.route()`; no API server is booted.
- **The harness to clone: `apps/web/tests/e2e/emergency-path.spec.ts`** — it already mocks the manifest, injects WS messages, and asserts on console output (checks for zero `"stale/future event"` drops). Its header (`:1-60`) documents the exact P0-1 ms-vs-seconds timestamp bug and the FLAT-vs-nested manifest contract — both directly relevant to a clock scheduler. It uses `page.context()` (`:767`), so extending it to a second page/context for a two-screen sync harness is a small step.
- Sibling specs in `apps/web/tests/e2e/`: `url-asset-ledfit.spec.ts`, `widget-render.spec.ts`, `inset-serialization-regression.spec.ts`, `holiday-hotzone.spec.ts`, `scoreboard-shot.spec.ts`.
- Root `tests/e2e/` (needs a live API + DB): `player-manifest.spec.ts` — 2 live smoke tests, 2 `test.skip`'d ("requires seeded screen paired to a tenant with an active schedule"). Root `tests/e2e-android/player-sync.spec.ts` is a **WebdriverIO/Appium** suite (not Playwright) with a `~override_alert_container` <1000 ms SLA assertion — the closest existing "sync latency" test in the repo.
- Security specs worth reading: `tests/security/red-team.ws-replay.spec.ts`.

---

## Surprises / gotchas for a deterministic shared-clock scheduler

1. **`Date.now()` is used raw in the playback hot path — 63 occurrences in `page.tsx`.** The load-bearing three: `slideStartedAtRef` init (`:4727`), reset (`:4745`), and `const elapsed = Date.now() - slideStartedAtRef.current` (`:4855`). The existing `serverClockOffsetRef` is **never** applied to any of them.

2. **`currentIndex` is a monotonic counter, not a position.** Every consumer does `% sorted.length` (`:5347`, `:5829`, `:6551`, `:6589`, `:7287`). A shared-clock scheduler that computes an *absolute* index must either set `currentIndex` to a value congruent mod N, or accept discontinuities in `(currentIndex + 1) % N` next-video preloading.

3. **Videos are outside the timer entirely** (`:4833`). Frame-locking a mixed playlist means the *duration of every video file* becomes part of the shared schedule — the server does not know video durations (no duration column on `Asset`; the manifest has only `duration_ms` from `PlaylistItem`). Two screens playing the same video will diverge by their individual decode start times, and `onEnded` (`:6644`) fires per-device.

4. **Solo-item playlists NEVER advance and never fire the counter** — `distinctIds.size <= 1 → return` (`:4851-4852`) and `loop={isSoloPlaylist}` (`:885`). A shared clock has nothing to hook.

5. **The 1000 ms CSS transition is not budgeted** (`:6600`, `:6784`). Two screens crossfading at exactly the same wall-clock instant still look mismatched if their compositors are out of phase; and the effective dwell is `durationMs`, with the fade *overlapping* the next item's dwell.

6. **React re-mount on manifest refresh is mostly avoided — but by two fragile signatures.** `currentPlaylistSigRef` early-returns identical content (`:3627-3629`) and clamps rather than resets otherwise (`:3644-3647`). Item React `key` is `${mp.id}:${item.sequence}:${itemIdentity}` (`:3556`), stable across polls. Historically this broke twice (the "1↔2 alternating every poll" bug, documented `:3590-3617`, and the Goodview stuck-slide bug, `:4680-4702`). **`slideStartedAtRef` resets on any `playlistItemsSig` change** (`:4744-4746`) — so any manifest edit re-anchors the clock on each screen independently, at slightly different times.

7. **The player reloads itself aggressively, wiping all in-memory clock state.** `hardCacheBustingReload()` fires from: loop-boundary bundle drift (`:4873-4875`), the 5-min stale-bundle watcher (`:3961-4057`), `REFRESH_WEB` WS/SSE (`:4544`, `:4166`), and the fetch-failure cascade (`:3843`). `REFRESH_WEB` applies **random jitter 0..8000 ms by default** (`:4511`, `:4519`) precisely so fleets don't reload in lockstep — which means screens in the same group deliberately restart at *different* times.

8. **Three concurrent manifest polls run simultaneously during playback** — 10 s (`:4670`), 30 s (`:3925`), plus 5 s when WS is down (`:4223`). All call the same `fetchContent`. There is no in-flight dedup visible. Any per-poll clock sampling will be triple-sampled at unpredictable phases.

9. **Clock offset is zero on SSE and HTTP-poll tiers.** `AUTH_OK` only exists on WebSocket (`realtime.gateway.ts:193`); SSE has no equivalent (`page.tsx:4127-4130`). Screens behind a WS-blocking proxy (the documented Squid/ZScaler/iboss/GoGuardian case, `:4169-4178`) will have `serverClockOffsetRef === 0` forever.

10. **The manifest has no server epoch.** `generatedAt` is an ISO string, is stripped before hashing (`:3277`), and is never read by the player. If you add a `serverNow` field, it **must** be excluded from `hashablePayload` or you break the 304 path for every screen on every poll.

11. **`@Throttle` is IP-keyed, i.e. per-SITE not per-device** — the exact bug commit `22fd9ff4` fixed. Comment at `screens.controller.ts:3391-3394` flags it as a known systemic issue. A new sync endpoint POSTing more often than render-proof will 429 a large venue.

12. **The `packages/ws-events` enum is dead.** It's not imported by the gateway or the player, and it's missing 9 of the 15 types actually in use. Adding a type there does nothing; add it at the string call sites in `realtime.gateway.ts`, `page.tsx` (**both** the `ws.onmessage` switch at `:4395-4603` and the SSE `handle()` block at `:4142-4204`), and `sse.service.ts`.

13. **`AUTH_OK`/`AUTH_FAIL` bypass the HMAC gate by construction** (`realtime.gateway.ts:193`, `:217` call `send()` directly, never touching Redis). Any direct per-socket time-sync reply inherits that — free of signing cost, but also free of authentication beyond the initial `HELLO`. `send()` is currently `private`.

14. **`CANVAS_CHANGE` and `ORIENTATION_CHANGE` are broadcast by the server but silently ignored by the player.** The comment at `page.tsx:3286` asserting ~150 ms canvas propagation is factually wrong. Don't assume a new WS type "just works" because the server publishes it.

15. **`Schedule.priority` and all dayparting fields are inert.** Every active schedule's items are concatenated into one rotation. If you build a scheduler assuming "one playlist is active at time T," reality is "the union of N playlists is active." And `PlaylistItem.daysOfWeek/timeStart/timeEnd` are never serialized into the manifest at all (`screens.controller.ts:3162-3187`), so `isItemValid()` (`page.tsx:4785`, `:5286`) is unreachable dead code today.