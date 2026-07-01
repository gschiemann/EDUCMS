# App Library — Backend Services Spec (§20)

> Build-ready engineering spec for the six backend services the Apps Library needs.
> Companion to `docs/research/2026-06-30-app-library/00-SYNTHESIS.md`. Each section
> is grounded in **existing** NestJS infra so a mid-level dev (Sonnet) can implement
> without guessing. Cite the modules named here before extending them.
>
> **Framing (from §5 of the synthesis):** ~90% of "apps" are just an App-Registry
> `build(config)` that emits a **standard zone config for an existing widget**
> (`WEBPAGE`, `RSS_FEED`, `LIVE_DATA`, `CALENDAR`, `STREAMING`, `IMAGE_CAROUSEL`,
> `EXTERNAL_HTML`). Those need **no backend** — the frontend/registry writes the zone.
> This document specs ONLY the apps that genuinely require a server-side service.

## What already exists (reuse, do not rebuild)

| Capability | File | Notes |
|---|---|---|
| **Headless Chromium renderer** | `apps/api/src/proxy/renderer.service.ts` (`RendererService`) | Shared `puppeteer-core` browser, cache-first (10-min TTL), concurrency cap 3, browser recycle, `--no-sandbox` container args, SSRF-guarded `page.goto`. `puppeteer-core@^22` already in `apps/api/package.json`. **This is the backbone of services 1 & 2.** Currently returns HTML only; we add a screenshot path. |
| **SSRF-safe fetch/goto** | `apps/api/src/branding/safe-fetch.ts` | `safeFetch` (GET), `safeFetchPost` (POST, no-redirect, anti-exfil), `assertPublicUrl` (DNS-resolving, for `page.goto`), `validatePublicUrl` (sync). Connect-time DNS-rebind pin. **Every outbound URL in this spec MUST route through these.** |
| **Supabase object storage** | `apps/api/src/storage/supabase-storage.service.ts` (`SupabaseStorageService`) | Public `assets` bucket (CDN + `cache-control: max-age=31536000`), private `floor-plans` bucket (signed URLs). `uploadToBucket(bucket, path, buf, contentType)`, `download`, `delete`, `createSignedUrl`, `toSafeBuffer`. **Snapshot output lands here.** |
| **Outbound webhook engine** | `apps/api/src/webhooks/` (`WebhookDispatchService`, `WebhookRetryWorker`) | Durable `WebhookDelivery` rows, HMAC-SHA256 signing, backoff `[5s,30s,120s]`, multi-replica `FOR UPDATE SKIP LOCKED` claim, SSRF-guarded delivery. **The inbound webhook (service 4) mirrors this envelope.** |
| **Generic data fetch+normalize** | `apps/api/src/data-source/` (`DataSourceService`, `DataSourceController`, `DataSourceRateLimiter`) | Stateless one-shot: `POST /api/v1/data-source/fetch {url,format}` → `{rows,columns,totalRows,format}`. JSON+CSV, caps `MAX_ROWS=500 / MAX_COLS=40`. **Service 3 promotes this from stateless to persisted+refreshed.** |
| **BYOK key envelope encryption** | `apps/api/src/ai/ai-key-cipher.ts` (`sealAiKey`/`openAiKey`, single-string) and `apps/api/src/streaming/creds-cipher.ts` (two-column structured JSON) | AES-256-GCM envelope, master = `DEVICE_SECRET_KEY`. **Reuse for services 2 & 6.** Structured creds (username+password, or key+account) → two-column pattern like `StreamProviderConnection.encryptedCreds/encryptedDataKey`. |
| **3-tier AI economic model** | `apps/api/src/ai/ai.service.ts` (`resolveProviderKey`) | Tier-1 platform key (`ANTHROPIC_API_KEY`), Tier-2 BYOK (`Tenant.aiKeyEncrypted`), Tier-3 managed (future). **Service 6 follows the SAME resolution order + "never spend Tier-1 on Tier-2 work" rule.** |
| **Redis (caps/idempotency/pub-sub)** | `apps/api/src/realtime/redis.service.ts` + `apps/api/src/ai/ai-hourly-cap.ts` (`aiWindowCount`/`aiRecordEvent` sliding-window helpers) | Multi-replica-safe sliding-window rate limit + `publish(channel, payload)` for the emergency/broadcast bus. Degrade-open on Redis blip. |
| **Cron/worker pattern** | `apps/api/src/pos/pos-sync.cron.ts`, `apps/api/src/webhooks/webhook-retry.worker.ts`, `apps/api/src/notifications/offline-screen-scanner.ts` | Standing house style: `OnModuleInit`+`setInterval`, `.unref()`, overlap guard (`this.running`), hour-bucket dedup, env-disable flag, **no `@nestjs/schedule` dependency**. Every new worker below copies this exactly. |
| **Manifest poll backstop** | `apps/api/src/screens/screens.controller.ts` (`/api/v1/screens/:id/manifest`) | Device-authed; carries live zone config + `emergency` field. Chromium-83 players poll this. Snapshot URLs must reach the player through the zone config it already serves. |

---

## Service 1 — SNAPSHOT-TO-ASSET (offline / Taurus resilience)

**Goal.** Publish-to-web apps (Google Slides, Sheets, Canva, Power BI public, any
`WEBPAGE`/`EXTERNAL_HTML` zone) run *live JS in an iframe*. On a **Chromium-83
NovaStar Taurus** LED controller or an offline kiosk, that live embed may not run.
Periodically render each such zone server-side to a **static image** in the public
`assets` bucket, so the player can show the **latest captured frame** even when the
live embed can't. This is §4.5 of the synthesis and the single biggest "we beat
OptiSigns" resilience win.

### Extend / add
- **Extend** `RendererService` (`apps/api/src/proxy/renderer.service.ts`) with a
  `screenshot()` method (see below) — reuse its shared browser, SSRF guard,
  container launch args, concurrency cap, and recycle logic. Do **not** stand up a
  second Puppeteer instance.
- **New module** `apps/api/src/snapshots/` (`SnapshotService`, `SnapshotCron`,
  `SnapshotsController`). Register in `apps/api/src/app.module.ts` alongside
  `ProxyModule`/`StorageModule` (both already imported).
- **New Prisma model** `AppSnapshot` (below).

### `RendererService.screenshot()` — the one new render primitive
```ts
// apps/api/src/proxy/renderer.service.ts
interface ScreenshotOpts {
  width: number;          // canvas px, default 1920 (zone renders at native)
  height: number;         // default 1080
  fullPage?: boolean;     // default false (viewport-clip; signage is fixed-size)
  waitMs?: number;        // extra settle after networkidle2, default 2500
  type?: 'jpeg' | 'png';  // default 'jpeg' q80 — smaller egress, Taurus-safe
}
async screenshot(url: string, opts: ScreenshotOpts): Promise<Buffer | null>;
// Impl mirrors renderOnce(): assertPublicUrl(url) FIRST (SSRF, DNS-resolving),
// getBrowser(), newPage(), setViewport(opts.width/height, deviceScaleFactor:1),
// setRequestInterception + per-subrequest validatePublicUrl (already there),
// page.goto(url,{waitUntil:'networkidle2',timeout:RENDER_TIMEOUT_MS}),
// await settle(opts.waitMs), page.screenshot({type,quality:80,fullPage}),
// return the Buffer. Returns null on any failure (caller keeps last snapshot).
// Respects the SAME inFlight/MAX_CONCURRENT gate as render().
```

### Prisma model
```prisma
model AppSnapshot {
  id            String    @id @default(uuid())
  tenantId      String    @map("tenant_id")
  // What we snapshot. sourceUrl is the publish-to-web URL from the app config.
  sourceUrl     String    @map("source_url")
  // Which app produced it (for the picker + refresh cadence defaults).
  appId         String    @map("app_id")        // 'google-slides' | 'canva' | ...
  width         Int       @default(1920)
  height        Int       @default(1080)
  // Public assets-bucket URL of the latest captured frame. Stable path
  // (upsert same key) so the zone config never needs rewriting on refresh.
  latestUrl     String?   @map("latest_url")
  // Minutes between refreshes; per-app default, operator-overridable.
  refreshMins   Int       @default(15) @map("refresh_mins")
  status        String    @default("PENDING")   // PENDING|OK|ERROR
  lastError     String?   @map("last_error")
  lastRenderAt  DateTime? @map("last_render_at")
  nextRenderAt  DateTime? @map("next_render_at")
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")
  tenant        Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  // dedup identical source across tenants is NOT desired (per-tenant brand grade)
  @@unique([tenantId, sourceUrl, width, height])
  @@index([status, nextRenderAt])   // the cron's due-query hot path
  @@map("app_snapshots")
}
```

### Storage path
`uploadToBucket(BUCKET, `snapshots/${tenantId}/${snapshotId}.jpg`, buf, 'image/jpeg')`.
**Upsert the SAME path every refresh** (the service already sends `x-upsert:true`).
Because the `assets` bucket serves `cache-control: max-age=31536000`, append a
cache-buster on the zone-consumed URL: store `latestUrl = publicUrl + '?v=' + Date.now()`
so the CDN/Cloudflare and the player pick up the new frame while the object itself
stays edge-cached between refreshes. (This is the established egress pattern — see
`supabase-storage.service.ts` immutable Cache-Control note.)

### Trigger — cron (copy `PosSyncCron` verbatim in shape)
```ts
// apps/api/src/snapshots/snapshot.cron.ts
@Injectable() export class SnapshotCron implements OnModuleInit, OnModuleDestroy {
  onModuleInit() {
    if (process.env.NODE_ENV==='test' || process.env.SNAPSHOT_CRON_DISABLED==='1') return;
    this.timer = setInterval(() => void this.tick(), 60_000); // 1-min tick
    this.timer.unref?.();
  }
  // tick(): overlap-guard; claim due rows atomically (multi-replica), like
  // WebhookRetryWorker: UPDATE app_snapshots SET next_render_at = next_render_at +
  // refresh_mins*interval, updated_at=NOW() WHERE id IN (SELECT id ... WHERE
  // status<>'ERROR-permanent' AND next_render_at <= NOW() ORDER BY next_render_at
  // LIMIT $batch FOR UPDATE SKIP LOCKED) RETURNING ...;
  // then for each: renderer.screenshot() → storage.uploadToBucket → set
  // latestUrl/status/lastRenderAt. On null: status=ERROR, keep old latestUrl.
}
```
- **Default cadence 15 min** (slides/canva change rarely). Sheets/Power BI dashboards
  may want 5 min — expose `refreshMins` per app; floor at 5 to bound Chromium cost.
- **Only render snapshots referenced by an active zone** (join through Template/
  Playlist → publishing screens) so we don't render abandoned configs. MVP: render
  all rows; add the "in-use" filter in a follow-up (matches the POS-cron "safety net"
  posture).

### How the widget falls back to the snapshot
The App-Registry `build(config)` for a snapshot-capable app writes a `WEBPAGE`
(or `IMAGE`) zone with **both** the live URL and the snapshot URL:
```jsonc
{ "widgetType": "WEBPAGE",
  "defaultConfig": {
    "url": "https://docs.google.com/.../embed",
    "snapshotUrl": "https://<supabase>/.../snapshots/<tenant>/<id>.jpg?v=...",
    "snapshotMode": "auto"   // 'auto' | 'live' | 'snapshot'
  }}
```
Player behavior (frontend, out of scope here but the contract):
`WebpageWidget` (`apps/web/src/components/widgets/WebpageWidget.tsx`) — when
`snapshotMode==='snapshot'` OR (`'auto'` AND the iframe fails to load within N s / the
device is flagged Taurus in its manifest), render `<img src={snapshotUrl}>` instead
of the iframe. A **per-app Taurus/LED compatibility badge** (synthesis §4.5) in the
picker sets `snapshotMode:'snapshot'` by default when the target screen is an LED
controller. The manifest already carries per-screen canvas + device info, so the
player can self-select without a server round-trip.

### Effort
**M–L.** `screenshot()` on the renderer = ~half a day (the browser plumbing exists).
Model + cron + controller + storage wiring = ~1.5 days. Frontend fallback = separate.

### Security / rate-limit / cost caveat
- **Chromium cost is the constraint.** Each render is a real headless page load
  (2–15s, ~150 MB RSS on Railway). Reuse the renderer's `MAX_CONCURRENT=3` and the
  hour-bucket batch cap; **never** let the cron exceed the live-proxy's concurrency
  budget or `/proxy/web` starves. Cap total snapshots/tenant (e.g. 25) at create time.
- **SSRF:** `screenshot()` MUST call `assertPublicUrl(url)` before `page.goto`
  exactly like `renderOnce` (a `?url=http://169.254.169.254/...` snapshot would
  otherwise exfil cloud-metadata into a public bucket image). Sub-request
  interception already guards nested fetches.
- **Public-exposure warning** (synthesis §4.6): a snapshot bakes the current
  publish-to-web content into a world-readable `assets` object. Same "this becomes
  internet-public" warning the picker shows for publish-to-web apps applies double.
- **`ANTHROPIC_API_KEY` etc. never touched** — this service is pure headless render,
  no LLM.

---

## Service 2 — HEADLESS AUTHENTICATED-RENDER (secure dashboards)

**Goal.** Power BI / Tableau / Looker / Grafana behind a login. Log in server-side,
then stream/screenshot the auth-gated page into the `assets` bucket (or serve a
short-TTL image). Synthesis §3 "Secure Dashboards" — ScreenCloud's flagship, high
corporate value, hard for rivals. **This is Service 1's engine + stored credentials.**

### Extend / add
- **New module** `apps/api/src/dashboards/` (`DashboardCredService`,
  `DashboardRenderService`, `DashboardsController`). Reuse `RendererService.screenshot()`.
- **Store credentials with the two-column structured cipher** — copy
  `apps/api/src/streaming/creds-cipher.ts` (`sealCreds`/`openCreds`) exactly; do NOT
  invent a new one. New model `DashboardConnection` (below) carries
  `encryptedCreds`+`encryptedDataKey` like `StreamProviderConnection`.

### Prisma model
```prisma
model DashboardConnection {
  id               String   @id @default(uuid())
  tenantId         String   @map("tenant_id")
  provider         String   // 'powerbi' | 'tableau' | 'looker' | 'grafana'
  displayName      String?  @map("display_name")
  dashboardUrl     String   @map("dashboard_url")   // the auth-gated page to render
  // Envelope-encrypted JSON. Shape per provider:
  //   {type:'form', usernameField, passwordField, username, password}
  //   {type:'grafana-apikey', apiKey}          (header injection, no form)
  //   {type:'looker-embed', embedSecret, ...}  (signed embed URL, preferred)
  encryptedCreds   String   @map("encrypted_creds")
  encryptedDataKey String   @map("encrypted_data_key")
  width            Int      @default(1920)
  height           Int      @default(1080)
  refreshMins      Int      @default(10) @map("refresh_mins")
  latestUrl        String?  @map("latest_url")       // last rendered frame (assets bucket)
  status           String   @default("PENDING")      // PENDING|OK|AUTH_FAILED|ERROR
  lastError        String?  @map("last_error")
  lastRenderAt     DateTime? @map("last_render_at")
  nextRenderAt     DateTime? @map("next_render_at")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")
  createdByUserId  String   @map("created_by_user_id")
  tenant           Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@unique([tenantId, provider, dashboardUrl])
  @@index([status, nextRenderAt])
  @@map("dashboard_connections")
}
```

### API shape
```
POST   /api/v1/dashboards            {provider, dashboardUrl, credentials, width?, height?, refreshMins?}
                                     → seals creds, verifies once, returns {id, status, latestUrl?}
GET    /api/v1/dashboards            → list (creds NEVER returned; masked provider + status only)
POST   /api/v1/dashboards/:id/render → force a render now (returns {status, latestUrl})
DELETE /api/v1/dashboards/:id
```
RBAC: `SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN` only (credential-bearing —
tighter than the Concierge's CONTRIBUTOR access). Guards: `JwtAuthGuard, RbacGuard`.

### Render approach (the auth flow)
`DashboardRenderService.renderAuthed(conn)`:
1. `assertPublicUrl(conn.dashboardUrl)` — SSRF, before any navigation.
2. `openCreds(conn.encryptedCreds, conn.encryptedDataKey)` → plaintext creds
   **held only in local scope, never logged, discarded after render**.
3. Get a **dedicated page from the renderer's browser** (add
   `RendererService.newAuthedPage()` that returns a raw `Page` + closes it for you;
   the shared browser is fine, but auth pages MUST NOT be cached like `render()`).
4. Provider strategy:
   - **`grafana-apikey`** → `page.setExtraHTTPHeaders({Authorization:'Bearer '+apiKey})`,
     goto the panel `&kiosk` URL. Cleanest — no form.
   - **`looker-embed`** → build a signed SSO embed URL server-side (Looker's HMAC
     embed spec) and goto it. Preferred over scraping a login form.
   - **`form`** (Power BI org login, Tableau Server) → `page.goto(loginUrl)`,
     `page.type(usernameField, username)`, `page.type(passwordField, password)`,
     submit, `waitForNavigation`, then goto `dashboardUrl`. Fragile — see caveats.
5. `page.screenshot()` (reuse Service 1 storage path under `dashboards/<tenant>/<id>.jpg`).
6. `nextRenderAt = now + refreshMins`; status `OK`/`AUTH_FAILED`.
Runs on the **same `SnapshotCron` tick** (or a sibling `DashboardCron` — copy the
pattern) so there's one Chromium concurrency budget across both services.

### Player consumption
Identical to Service 1: the app writes an `IMAGE`/`WEBPAGE` zone pointing at
`latestUrl` (+ cache-buster). The player NEVER receives credentials or the
auth-gated URL — only the rendered frame in our bucket. This is a hard security
boundary: **the LED player is untrusted; it only ever sees a public image.**

### Effort
**L.** Grafana/Looker paths ~2 days (header/embed, no scraping). Form-login
Power BI/Tableau ~3–4 days and inherently brittle (MFA, SSO redirects, captcha).
Ship Grafana + Looker + Power BI **public/publish-to-web** first (those fold into
Service 1); gate org-login form-scrape behind a "Beta — may break on MFA" badge.

### Security / rate-limit / cost caveat
- **Credential storage** = the streaming two-column cipher, master `DEVICE_SECRET_KEY`.
  Never return creds on GET; mask like `maskAiKey`. Audit-log every create/rotate/
  delete (AuditLog, per Standard Audit Surface §16 — "every key change").
- **MFA / SSO kills form-scrape.** Document this loudly: enterprise Power BI/Tableau
  behind Azure AD MFA cannot be headless-form-logged. The *supported* path is the
  provider's own embed token (Power BI Embedded, Tableau Connected Apps, Looker SSO
  embed). Form-scrape is best-effort for simple username/password dashboards only.
- **SSRF is critical here** — a stored `dashboardUrl` pointing at an internal IP
  would let an operator turn our authed renderer into an internal-network scraper.
  `assertPublicUrl` on both the login URL and dashboard URL, every render.
- **Cost:** authed pages can't be cache-shared across tenants (each is
  credential-specific), so they're more expensive than Service 1's shared snapshots.
  Cap dashboards/tenant low (e.g. 10) and floor `refreshMins` at 5.

---

## Service 3 — GENERIC DATA-SOURCE app (Xibo DataSet parity)

**Goal.** Connect a CSV / Google-Sheet / JSON-API **once**, name it, and bind **many
templates** to it (menu, table, ticker, directory, leaderboard). Decouples "connect
data" from "design" (synthesis §3). Today's `DataSourceService` is **stateless
one-shot** — this promotes it to a **persisted, named, refreshed** source.

### Extend / add
- **Extend** `apps/api/src/data-source/`:
  - Keep `DataSourceService.fetchNormalized()` as the fetch+normalize core (reuse
    its `safeFetch`, `MAX_ROWS=500`, `MAX_COLS=40`, cell-len caps verbatim).
  - **New model** `DataSet` + **new endpoints** on `DataSourceController` (or a
    sibling `DataSetController` in the same module).
  - **New** `DataSetRefreshCron` (copy `PosSyncCron`).
- No new module registration needed — `DataSourceModule` is already in `app.module.ts`.

### Prisma model
```prisma
model DataSet {
  id            String   @id @default(uuid())
  tenantId      String   @map("tenant_id")
  name          String                                   // operator-facing, e.g. "Cafeteria Menu"
  sourceType    String   @map("source_type")             // 'json' | 'csv' | 'gsheet'
  sourceUrl     String   @map("source_url")              // published CSV / API / sheet URL
  // Optional: for JSON APIs, a dot-path to the array (e.g. "data.items").
  jsonPath      String?  @map("json_path")
  refreshMins   Int      @default(30) @map("refresh_mins")
  // Cached normalized snapshot so the player/builder read instantly and a
  // source outage doesn't blank the board. Shape: {rows,columns,totalRows,fetchedAt}.
  cachedData    Json?    @map("cached_data")
  columns       Json?                                     // string[] discovered columns (for the bind UI)
  status        String   @default("PENDING")             // PENDING|OK|ERROR
  lastError     String?  @map("last_error")
  lastFetchAt   DateTime? @map("last_fetch_at")
  nextFetchAt   DateTime? @map("next_fetch_at")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")
  tenant        Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@index([tenantId])
  @@index([status, nextFetchAt])
  @@map("data_sets")
}
```

### API shape
```
POST   /api/v1/data-sets           {name, sourceType, sourceUrl, jsonPath?, refreshMins?}
                                   → fetchNormalized() once → persist + return {id, columns, sampleRows}
GET    /api/v1/data-sets           → list {id,name,columns,status,lastFetchAt,rowCount}
GET    /api/v1/data-sets/:id       → {…meta, data: cachedData}   (the player/builder read path)
POST   /api/v1/data-sets/:id/refresh → force refresh now
PATCH  /api/v1/data-sets/:id       {name?, sourceUrl?, refreshMins?}
DELETE /api/v1/data-sets/:id
```
Reuse the existing `DataSourceRateLimiter` (per-tenant + global egress) + the per-IP
`@Throttle` already on the module. RBAC = same as `/data-source/fetch`
(`SUPER/DISTRICT/SCHOOL_ADMIN + CONTRIBUTOR`).

### Refresh
`DataSetRefreshCron` (1-min tick, overlap-guard, atomic due-claim) calls
`fetchNormalized(sourceUrl, sourceType)`, writes `cachedData`/`columns`/`status`,
sets `nextFetchAt = now + refreshMins`. On failure: `status=ERROR`, **keep old
`cachedData`** (a source hiccup must not blank a menu board mid-service — same
"last-good wins" posture as the snapshot service).

### How widgets consume it
A **bind reference**, not a URL. A zone config gains:
```jsonc
{ "widgetType": "LIVE_DATA",         // or MENU / TICKER / TABLE
  "defaultConfig": {
    "dataSetId": "ds_abc",
    "columnMap": { "label": "item_name", "value": "price" },  // widget field → dataset column
    "limit": 20
  }}
```
The player resolves `dataSetId` → `GET /api/v1/data-sets/:id` (device-authed, served
from `cachedData` — instant, no live fetch on the player). One source, N templates:
change the source once, every bound board updates on the next refresh. **This is the
Xibo DataSet win** — and it also feeds the menu-management platform (task #208) since
a per-location POS feed is just a DataSet.

### Effort
**M.** Fetch/normalize core exists. Model + CRUD + cron + the `dataSetId` resolver
on the player + a "bind a column" builder UI = ~2 days backend, frontend separate.

### Security / rate-limit / cost caveat
- **SSRF already handled** by `safeFetch` in `fetchNormalized` — do not bypass it.
- **Caps already exist** (`MAX_ROWS/COLS`, byte cap, timeout, `DataSourceRateLimiter`).
  Add a per-tenant `DataSet` count cap (e.g. 50) so refresh load stays bounded.
- **Google Sheets** = the "publish to web → CSV" URL (`.../pub?output=csv`); no OAuth,
  free, but the sheet becomes internet-public — same public-exposure warning.
- **Cost:** all free (operator-hosted URLs). The only cost is our egress/CPU, bounded
  by the row/byte caps + refresh floor.

---

## Service 4 — WEBHOOK-IN (external POST → screen content)

**Goal.** External systems POST to VenueOS to drive a screen: POS order-ready status,
our own sports engine, a CI result, an alarm panel (synthesis §3). We already own the
**outbound** direction (`WebhookDispatchService` + retry queue); this is the
**inbound** mirror. There's precedent: the custom-webhook POS receiver
(`apps/api/src/pos/pos-oauth.controller.ts`, task #170) and the Stripe webhook
(`apps/api/src/billing/billing-webhook.controller.ts`).

### Extend / add
- **New module** `apps/api/src/inbound-webhooks/` (`InboundWebhookController`,
  `InboundWebhookService`). Register in `app.module.ts`.
- **New model** `InboundWebhook` (the endpoint definition + shared secret + how its
  payload maps to a zone). Reuse `WebhookDispatchService`'s HMAC verify convention in
  reverse (verify the *incoming* signature).

### Prisma model
```prisma
model InboundWebhook {
  id            String   @id @default(uuid())
  tenantId      String   @map("tenant_id")
  name          String
  // Opaque, unguessable path segment: the public URL is
  //   POST /api/v1/hooks/in/:slug   (slug = randomBytes hex, NOT the id)
  slug          String   @unique
  // HMAC secret the sender signs with (X-VenueOS-Signature: sha256=...),
  // mirroring our OUTBOUND contract. Stored encrypted (single-string cipher).
  signingSecret String   @map("signing_secret")
  // Where the content goes: a specific screen or group, and which zone/field.
  targetType    String   @map("target_type")    // 'screen' | 'group'
  targetId      String   @map("target_id")
  // Simple field mapping: {textField:"$.order.status", imageField:"$.photo"} — dot-paths
  // into the posted JSON → zone config fields (or an emergency trigger flag).
  mapping       Json
  isActive      Boolean  @default(true) @map("is_active")
  lastPostAt    DateTime? @map("last_post_at")
  lastStatus    Int?     @map("last_status")
  createdAt     DateTime @default(now()) @map("created_at")
  createdByUserId String @map("created_by_user_id")
  tenant        Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  @@index([tenantId, isActive])
  @@map("inbound_webhooks")
}
```

### API shape
```
# Management (authed, JwtAuthGuard+RbacGuard, ADMIN roles):
POST   /api/v1/inbound-webhooks         {name, targetType, targetId, mapping}
                                        → mints slug + signingSecret, returns the public URL + secret ONCE
GET    /api/v1/inbound-webhooks         → list (secret masked)
DELETE /api/v1/inbound-webhooks/:id

# The public receiver (NO JwtAuthGuard — authenticated by HMAC + slug):
POST   /api/v1/hooks/in/:slug
   Headers: X-VenueOS-Signature: sha256=<hex over `${timestamp}.${rawBody}`>
            X-VenueOS-Timestamp: <unix-ms>
   Body:    arbitrary JSON (mapped via `mapping` dot-paths)
   → 202 Accepted (fast ack), content update dispatched async
```

### Flow (`InboundWebhookService.receive(slug, rawBody, sig, ts)`)
1. Look up `InboundWebhook` by slug; 404 (generic) if missing/inactive.
2. **Verify HMAC in constant time** — recompute `createHmac('sha256', secret)
   .update(`${ts}.${rawBody}`)` and `crypto.timingSafeEqual` against the header.
   Reject stale timestamps (>5 min skew) → replay defense.
3. Parse JSON, apply `mapping` dot-paths to build a content patch.
4. Update the target zone config (or, if `mapping` flags an emergency, route through
   the emergency controller — **that path keeps all existing safeguards; webhook-in
   must NOT bypass `@AllowPanicBypass`/AuditLog**) and **publish to the realtime bus**
   via `RedisService.publish('screen:'+id, patch)` so the change reaches the player
   instantly (WS) with the manifest poll as backstop — exactly the emergency fan-out
   path, minus the signing gate which is server-internal here.
5. Stamp `lastPostAt/lastStatus`; return 202. Never reflect internal state in the body.

### Effort
**M.** HMAC verify + slug routing + the mapping applier + the realtime publish ~2 days.
The publish + manifest plumbing already exists; the new code is the receiver + mapping.

### Security / rate-limit / cost caveat
- **Unauthenticated public endpoint** — HMAC + timestamp is the ONLY gate. Constant-time
  compare, 5-min replay window, per-slug `@Throttle` (e.g. 120/min) so a leaked slug
  can't be a DoS. Slug must be `randomBytes(16).hex` (unguessable), never the row id.
- **This is an emergency-adjacent surface.** If `mapping` can trigger an alert, that
  path MUST create an AuditLog row and honor the emergency safeguards (CLAUDE.md
  "Emergency System Changes" requires review). Prefer: webhook-in updates *content*
  only; emergency triggers stay on the authed emergency controller.
- **No SSRF here** (we receive, we don't fetch), but sanitize mapped values before they
  reach a zone config (they render on screens): strip HTML, cap length.
- **Cost:** negligible (inbound). Bound stored payload size (e.g. 64 KB body cap).

---

## Service 5 — EMBEDDABILITY PRE-FLIGHT

**Goal.** Before an operator adds a URL to a `WEBPAGE`/`WEB` app, HEAD/GET-check
whether the site blocks framing (`X-Frame-Options`, CSP `frame-ancestors`) and warn
"this site can't be embedded" **before** they publish a blank board (synthesis §4.6).
This is a guardrail competitors lack.

> Note: our `/api/v1/proxy/web` **strips** `X-Frame-Options`/CSP so the iframe renders
> anyway on the player path. But pre-flight is still valuable: (a) it warns when a site
> *also* uses JS frame-busting or won't proxy cleanly, (b) it sets `snapshotMode` /
> Taurus expectations, (c) it surfaces the "publish to web = internet-public" warning
> at add-time, and (d) many operators add URLs meant for **direct** (non-proxied)
> iframe embedding.

### Extend / add
- **Add a method to `DataSourceService`** (or a tiny new `EmbedPreflightService` in
  the same `data-source` module — it's the natural home, already SSRF-wired):
  `preflight(url): Promise<PreflightResult>`.
- **New endpoint** `GET /api/v1/apps/preflight?url=...` (authed, ADMIN+CONTRIBUTOR,
  `@Throttle 60/min`).

### Data shape
```ts
interface PreflightResult {
  url: string;
  reachable: boolean;           // did we get any 2xx/3xx?
  status: number | null;
  embeddable: boolean;          // true unless a hard frame-block is present
  frameBlock: null              // no block detected
    | 'x-frame-deny'            // X-Frame-Options: DENY
    | 'x-frame-sameorigin'      // X-Frame-Options: SAMEORIGIN
    | 'csp-frame-ancestors';    // CSP frame-ancestors excludes '*'/us
  contentType: string | null;
  isHtml: boolean;
  // Advisory flags for the picker:
  publishToWebPublic: boolean;  // heuristic: docs.google/canva/powerbi publish URL
  taurusRisk: 'low'|'med'|'high'; // heavy-JS SPA → suggest snapshotMode
  message: string;              // operator-facing plain-English summary
}
```

### Implementation
`preflight(url)`:
1. `validatePublicUrl(url)` (sync SSRF gate) — reject internal/loopback immediately.
2. `safeFetch(url, {timeoutMs:6000, maxBytes:256*1024, accept:'text/html,*/*'})` —
   we only need headers + a small HTML head. (Node's `safeFetch` is GET; a real HEAD
   is unreliable across sites, and we want the `<head>` to catch **`<meta
   http-equiv="content-security-policy">`** framing directives too — same tags the
   proxy controller strips.)
3. Inspect `res` headers for `x-frame-options` and `content-security-policy`
   (parse `frame-ancestors`), AND scan the returned HTML head for the equivalent
   `<meta http-equiv>` CSP/XFO tags (proxy.controller.ts already documents both live
   in the wild).
4. Set `embeddable=false` + the specific `frameBlock` when a hard block is present.
5. Heuristic `publishToWebPublic` / `taurusRisk` from the host + payload size.
Return the structured result; the picker renders a yellow "May not embed" chip and
offers "Use snapshot mode instead" (ties into Service 1).

### Effort
**S.** ~half a day — one method + one thin controller endpoint, all plumbing exists.

### Security / rate-limit / cost caveat
- **SSRF:** `safeFetch`/`validatePublicUrl` mandatory (this is user-supplied URL input,
  the exact class the proxy controller's threat model covers). Never echo the response
  body — headers + boolean verdict only.
- **Rate-limit** 60/min per tenant (`@Throttle`) so it can't become an SSRF probe or a
  scraping amplifier (same reasoning as the `/proxy/web` throttle).
- **Cost:** one small capped GET per check — negligible.

---

## Service 6 — AGGREGATOR / managed-social tier (key placement)

**Goal.** Social walls (Instagram/FB/X/TikTok combined) are dead/paywalled as native
embeds in 2026 (synthesis §1). The honest solve is **one aggregator** (Walls.io /
EmbedSocial / Taggbox / Curator). The engineering question this section answers is
**where the aggregator key lives**, per our 3-tier economic model (CLAUDE.md "AI
Integration Concierge — Economic Model").

### Two deployment modes (both supported, operator-chosen)
1. **BYOK (Tier-2 analog).** The operator holds their own Walls.io/EmbedSocial account
   and pastes their **embed key / wall id**. We store it and render their wall. They pay
   the aggregator. This mirrors AI BYOK exactly.
2. **Platform-managed (Tier-3).** VenueOS holds **one enterprise aggregator account**;
   the operator never wires a token — social "just works", billed as a VenueOS line item
   (synthesis §4.7). One platform key, many tenants, quota-metered.

**Rule (from CLAUDE.md, load-bearing):** the platform must **NEVER silently spend a
Tier-3/platform aggregator quota for a tenant who hasn't opted into the managed tier**.
Free/BYOK tenants with no key see "Add your social wall key — Settings → Apps" or "Upgrade
to Managed Social", never a silent fallback to the platform account.

### Where the key lives (concrete)
- **BYOK key:** a new column on `Tenant` — `socialWallKeyEncrypted String? @map(...)`
  and `socialWallProvider String?` — **sealed with `sealAiKey()`/`openAiKey()`**
  (`apps/api/src/ai/ai-key-cipher.ts`, single-string envelope, master `DEVICE_SECRET_KEY`).
  It's a single opaque string, so the single-string cipher (not the two-column one) fits.
  If the aggregator needs `{accountId, apiKey}` (structured), use the two-column
  streaming cipher instead.
- **Platform-managed key:** env var `SOCIAL_AGGREGATOR_KEY` (like `ANTHROPIC_API_KEY`
  / `PEXELS_API_KEY`), read server-side only, **gated behind a per-tenant "managed
  social" entitlement flag** (`Tenant.managedSocialEnabled Boolean @default(false)`).

### Resolution order (copy `AiService.resolveProviderKey` shape exactly)
```ts
// apps/api/src/social/social.service.ts
resolveAggregatorKey(tenantId): { source:'tenant'|'platform', key, provider } | null {
  // 1) Tenant BYOK — socialWallKeyEncrypted → openAiKey() decrypt.
  // 2) Platform-managed — ONLY if tenant.managedSocialEnabled === true
  //    AND process.env.SOCIAL_AGGREGATOR_KEY set. (NO silent Tier-1 spend.)
  // 3) null → the picker shows "configure a key / upgrade to managed".
}
```

### API shape + render path
```
POST /api/v1/social/wall     {provider, key}      → seals BYOK key, verifies, returns {status}
GET  /api/v1/social/wall     → {source, provider, status, managedAvailable:boolean}
GET  /api/v1/social/wall/embed → returns the aggregator embed URL/snippet for the
                                 zone config (server injects the key; the PLAYER never
                                 sees the aggregator key — it gets a ready embed URL)
DELETE /api/v1/social/wall
```
The App-Registry `build()` for the Social Wall app writes a `WEBPAGE`/`EXTERNAL_HTML`
zone pointing at the aggregator's embed URL (key already baked server-side, or a wall
id that's non-secret). **Pair with Service 1 snapshot-to-asset** for Taurus/offline so
the wall degrades to a captured frame.

### Effort
**M** (BYOK render) → **L** (managed tier + entitlement + metered billing line item).
Ship BYOK first (reuses AI-key cipher + resolver pattern wholesale, ~1.5 days);
managed tier waits on the Tier-3 billing plumbing (synthesis §7, future).

### Security / rate-limit / cost caveat
- **The aggregator key is a paid credential** — encrypt at rest (AI-key cipher), mask on
  GET (`maskAiKey`), **never send it to the player** (server injects it into the embed
  URL or the player gets a non-secret wall id). Audit-log create/rotate/delete.
- **Cost governance is the whole point of the tier split.** Managed-tier calls draw a
  metered platform quota — track per-tenant usage like `Tenant.aiPlatformUsage*`
  (monthly counter) so a runaway wall can't burn the platform aggregator plan. Enforce
  a per-tenant managed cap; overage → "upgrade / add your own key."
- **Attribution/ToS** (synthesis §7): reviews (Google/Yelp/Tripadvisor) and some social
  aggregators require visible attribution — bake it into the render, don't strip it.
- **Never ship dead native embeds as tiles** (synthesis §1/§7): IG/X/TikTok/LinkedIn are
  covered ONLY through this aggregator path, never as standalone "apps" that silently break.

---

## Cross-cutting build notes

1. **Every new worker copies `PosSyncCron`/`WebhookRetryWorker`:** `OnModuleInit` +
   `setInterval` + `.unref()` + overlap guard + env-disable flag + atomic
   `FOR UPDATE SKIP LOCKED` claim for multi-replica safety. **No `@nestjs/schedule`.**
2. **Every outbound URL** (snapshot render, dashboard render, data-set fetch,
   preflight, aggregator verify) routes through `safe-fetch.ts`
   (`assertPublicUrl` for `page.goto`, `safeFetch` for GET). This is non-negotiable —
   it's the standing SSRF threat model for user-supplied URLs.
3. **Every credential** (dashboard creds, aggregator keys) uses the existing envelope
   ciphers, master `DEVICE_SECRET_KEY`. No new secret to manage. **Never** return a
   credential on a GET; mask it. **Audit-log every key create/rotate/delete**
   (Standard Audit Surface §16).
4. **Taurus/offline resilience is a first-class output, not an afterthought:** any app
   that renders a live embed (Services 1, 2, 6) MUST have a snapshot-to-asset fallback
   path and a per-app compatibility badge. The player self-selects live-vs-snapshot from
   its manifest device info.
5. **Player is untrusted:** it only ever receives a public asset URL, a non-secret embed
   URL, or a device-authed manifest/dataset read — never a credential, never an
   auth-gated URL, never a platform key.
6. **Migrations:** all new models are additive (new tables + additive `Tenant` columns);
   `pnpm db:migrate` then `pnpm db:generate`. No changes to existing rows.
