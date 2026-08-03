# Recon: Screens + online status

## Summary
Screen is a plain-string-status Prisma model (no PG enum): stored values written anywhere are only 'PENDING' (default), 'ONLINE', and a defensively-checked 'REVOKED' that no current code writes; 'OFFLINE' is NEVER stored — it is derived at read time in three list endpoints via STALE_MS = 35*1000 ms on lastPingAt (heartbeat cadence 30s + 5s grace). The offline-screen-scanner is a notifications-only background loop (60s interval, 5-min lastPingAt threshold) that creates Notification rows and never mutates Screen.status. Screens are created ONLY by the device-driven POST /api/v1/screens/register (the sole prisma screen.create in the API; seed.ts creates none) and claimed via POST /api/v1/screens/pair; there is no admin create endpoint (useCreateScreen hook is dead code). A script can insert Screen rows directly with a fake unique deviceFingerprint and the dashboard renders them without crashes (every field render is null-guarded), but they read ONLINE only while lastPingAt is <35s old and tenantId is set — otherwise they show OFFLINE. The manifest hot cache is populated only inside GET /screens/:id/manifest, so demo screens that never poll never touch it, and dashboard list endpoints read live DB with Cache-Control no-store, so raw-Prisma-script inserts are harmless and appear immediately.

## Key files
- `/Users/gschiemann/Desktop/EDU CMS/packages/database/prisma/schema.prisma` — Screen model lines 679-963 (all fields, defaults, indexes); ScreenGroup 658-677 incl syncMode
- `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/screens/screens.controller.ts` — GET /screens list() live-status derivation STALE_MS=35s (960-1068); GET /screens/fleet HQ rollup + stats (1121-1198); register (232-546); heartbeat GET status/:fp (549-608); pair (1209-1312); delete (2486); manifest lastPingAt touch (2611-2625)
- `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/notifications/offline-screen-scanner.ts` — Background scanner: 60s interval, 5-min threshold, env overrides, disabled in test
- `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/notifications/notifications.service.ts` — scanOfflineScreens (165-330): SCREEN_OFFLINE/INFRA_EVENT notification rows, cohort-outage math, dedupe keys — never writes Screen.status
- `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/screen-groups/screen-groups.controller.ts` — The screens page's actual data source (grouped view): duplicate STALE_MS=35s derivation (16-23, 119-131) + exact field select list (61-104)
- `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/screens/manifest-hot-cache.ts` — Manifest content cache: per-screen Map keyed by screenId, TTL 30min armed / 20s unarmed, SCREEN_TELEMETRY_ONLY_FIELDS, LAST_PING_DEBOUNCE_MS=25s, bumpManifestContentRev clears whole cache
- `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/screens/render-proof.ts` — renderHealth OK/STALE/UNKNOWN derivation, RENDER_PROOF_STALE_MS = 90*1000
- `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/prisma/prisma.service.ts` — $use mutation hook (30-66) that bumps manifest rev — in-process only, does not fire for external scripts
- `/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/screens/page.tsx` — FleetSummaryStrip tiles (268-308), per-screen card null-guarded renders of resolution/osInfo/browserInfo (2034-2044), OsIcon null-safe (137-140)
- `/Users/gschiemann/Desktop/EDU CMS/apps/web/src/hooks/use-api.ts` — useScreens refetchInterval 10s (155-179); useFleet GET /screens/fleet refetchInterval 30s + FleetResponse type (2152-2185); dead useCreateScreen (181)
- `/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/dashboard/page.tsx` — Dashboard fleet stats memo (123-140: online/offline/pending/stale), site rollup by screenGroup (157-186), HQ FleetRollup mount (isHQ && fleetRollup)
- `/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/screens/FleetRollup.tsx` — District/HQ rollup UI — counts status === 'ONLINE' client-side from GET /screens/fleet payload
- `/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/player/page.tsx` — getDeviceInfo (1463-1530): exact osInfo/browserInfo/resolution formats the register endpoint receives
- `/Users/gschiemann/Desktop/EDU CMS/packages/database/prisma/seed.ts` — Seed deletes screens (line 50) and creates NONE — no screen seed examples exist

## Details
## Q1 — Screen Prisma model (packages/database/prisma/schema.prisma lines 679-963, table `screens`)

Status is a PLAIN STRING column, NOT a Postgres enum: `status String @default("PENDING")` (line 687). Observed values across the codebase: 'PENDING', 'ONLINE', 'OFFLINE' (derived-only, see Q2), 'REVOKED' (checked at lines 979/1160/2607 of screens.controller.ts but NO write site exists — verified by two independent greps across apps/ + scripts/ for `status: 'REVOKED'` / `SET status`; treat 'REVOKED' as a manually-settable kill switch).

Fields (name → type, @map column):
- id String @id uuid; tenantId String? (tenant_id) — NULLABLE (unpaired screens have none); screenGroupId String? (screen_group_id)
- name String (required); location String?
- deviceFingerprint String @unique (device_fingerprint) — required + unique
- pairingCode String? @unique (pairing_code) — nulled after pairing
- status String @default("PENDING"); lastPingAt DateTime? (last_ping_at); pairedAt DateTime?
- resolution String? (free text, real format "1920×1080" — Unicode ×, see Q4)
- orientation String @default("LANDSCAPE") — 'LANDSCAPE'|'PORTRAIT'|'AUTO'
- canvasW Int? / canvasH Int? (canvas_w/canvas_h — LED visible-canvas dims); repeats Int @default(1)
- osInfo String? (os_info); browserInfo String? (browser_info); ipAddress String?; userAgent String?
- Geo: address String?; latitude Float?; longitude Float?; photoUrl String?
- Indoor: floorPlanId String?; floorX Float?; floorY Float?
- posLocationId String? (FK PosLocation, onDelete: SetNull)
- Telemetry: lastCacheReport Json?; lastCacheReportAt DateTime?; lastRenderedAt DateTime?; lastRenderedFrames Int?; lastRenderedHash String?; syncOffsetMs Int?; lastSyncReport Json?; lastSyncReportAt DateTime?
- OTA/versions: playerVersion String?; playerVersionCode Int?; playerVersionAt DateTime?; forceApkUpdatePendingAt DateTime?; forceApkUpdateOverrideWindow Boolean @default(false); lastOtaState String? (CHECKING|DOWNLOADING|VERIFYING|INSTALLING|INSTALLED|ERROR); lastOtaProgress Int?; lastOtaMessage String?; lastOtaAt DateTime?; managerVersion String?; managerVersionAt DateTime?
- Crash: lastCrashAt DateTime?; lastCrashVersion String?; lastCrashSource String? ("player"|"manager"); lastCrashMessage String?; lastCrashStack String? (~8KB cap)
- Emergency per-screen overrides (all String?): emergency{Lockdown,Evacuate,Weather,Hold,Secure,Medical}PlaylistId + ...AssetUrl + portrait variants emergency*PortraitPlaylistId / emergency*PortraitAssetUrl (24 columns total)
- hardwareModel String? — 'goodview-ep6n'|'goodview-ecbox3576'|'novastar-taurus'|'pi5'|'generic-android'|'web'|'unknown' (plain string, catalog in packages/api-types/src/hardware-models.ts)
- Sports: activeBoardGameId String? (no FK); activeBoardSurface String? (BOARD|RIBBON|SCOREBUG, null=BOARD)
- config Json? (wiring/gpioState for EP6N)
- Indexes: @@index([tenantId, status]), @@index([tenantId, lastPingAt]), @@index([screenGroupId])
- NOTE: model has NO createdAt/updatedAt columns.

## Q2 — Online/offline computation

STORED status only flips forward: register paired-branch → 'ONLINE' (screens.controller.ts:444); register new/unpaired → 'PENDING' (:476, :528); heartbeat GET /api/v1/screens/status/:deviceFingerprint → `status: screen.tenantId ? 'ONLINE' : 'PENDING'` (:590); admin POST /screens/pair → 'ONLINE' (:1259); device unpair → 'PENDING'. NOTHING ever writes 'OFFLINE' to the DB (verified two greps). 

DERIVED at read time in THREE places, all with the identical rule and `STALE_MS = 35 * 1000` (35 seconds):
1. GET /api/v1/screens list() — screens.controller.ts:971-984
2. GET /api/v1/screens/fleet — screens.controller.ts:1156-1165
3. GET /api/v1/screen-groups — screen-groups.controller.ts:23, 119-131 (deliberate duplicate; comment says keep in sync)

Exact rule (per screen): `if (status !== 'REVOKED') { isAlive = lastPingAt && (now - lastPingAt) < 35_000; if (isAlive && tenantId) status='ONLINE'; else if (storedStatus==='ONLINE' || tenantId) status='OFFLINE'; /* else keep stored (PENDING) */ }`. Heartbeat cadence is 30s (Kotlin HeartbeatService + comments at :963-971); 35s = 30s + 5s grace. Stale code comments elsewhere still say "2min"/"45s" (:2613, manifest-hot-cache.ts:80) — the real number is 35s.

lastPingAt writers: GET /screens/status/:fp heartbeat (every hit, :589); GET /screens/:id/manifest — debounced to at most once per 25s per screen (LAST_PING_DEBOUNCE_MS = 25_000, manifest-hot-cache.ts:35; controller :2620-2625); register (:443, :475, :534). 'preview-' prefixed fingerprints NEVER write lastPingAt or create rows (:253-262, :559-561).

offline-screen-scanner (apps/api/src/notifications/offline-screen-scanner.ts): process-internal setInterval, default OFFLINE_SCAN_INTERVAL_MS=60_000 (60s), threshold OFFLINE_SCAN_THRESHOLD_MIN=5 (screens silent >5 min), disabled when OFFLINE_SCAN_DISABLED='1' or NODE_ENV==='test'. It calls NotificationsService.scanOfflineScreens(5) (notifications.service.ts:165-330) which queries `{ tenantId: {not: null}, status: {not:'REVOKED'}, lastPingAt: { lt: now - 5min } }` and creates Notification rows ONLY — kind 'SCREEN_OFFLINE' (dedupeKey `screen-offline:${screenId}:${hourBucket}` where hourBucket = floor(lastPingAt/3600000)), an HQ-parent copy `screen-offline-hq:${screenId}:${hourBucket}`, and cohort 'INFRA_EVENT' (dedupeKey `infra-event:${tenantId}:${fiveMinBucket}`) when ≥ COHORT_OUTAGE_PCT=0.5 (50%) of a fleet of ≥ COHORT_OUTAGE_MIN_FLEET=3 dropped within COHORT_OUTAGE_WINDOW_S=90s; per-screen notifications suppressed for infra-event tenants. It never touches Screen.status.

Additional signal: renderHealth ('OK'|'STALE'|'UNKNOWN') from deriveRenderHealth (render-proof.ts), RENDER_PROOF_STALE_MS = 90*1000; STALE only when live-ONLINE and lastRenderedAt ≥90s old; null lastRenderedAt → UNKNOWN (never alarms). Returned by GET /screens list as renderHealth/renderStale/renderStaleSeconds. Dashboard also computes "stale" = status ONLINE but lastPingAt >5 min (dashboard/page.tsx:130-137).

## Q3 — Dashboard reads

- Screens page (apps/web/src/app/[schoolId]/screens/page.tsx): renders the GROUPED view from GET /api/v1/screen-groups (useScreenGroups) and ungrouped/summary from GET /api/v1/screens (useScreens, refetchInterval 10_000, refetchIntervalInBackground:false, refetchOnWindowFocus:true, staleTime:0 — use-api.ts:155-179). FleetSummaryStrip (page.tsx:268-308): online = screens.filter(s => s.status === 'ONLINE').length; offline = total - online; emergency tile from s.emergencyStatus==='ACTIVE' || s.tenant?.emergencyStatus==='ACTIVE'. Per-group header count at :1901. Status pill: ONLINE → emerald, PENDING → its own label, else OFFLINE (:2092-2096).
- Dashboard page (dashboard/page.tsx:123-140): from useScreens — online (status==='ONLINE'), pending, stale (ONLINE + ping >5min), offline = total - online - pending, onlinePct; site rollup grouped by screenGroup (:157-186) sorted worst-health-first.
- District/HQ rollup: GET /api/v1/screens/fleet (screens.controller.ts:1121-1198, roles SUPER_ADMIN|DISTRICT_ADMIN) — self + direct non-archived children; returns `stats: { total, online, offline, locationCount }` where online/offline are counted SERVER-side from the same 35s-derived per-screen status (:1190-1191). Consumed by useFleet (use-api.ts:2176-2185, refetchInterval 30_000) → FleetRollup.tsx (re-counts client-side: status === 'ONLINE'). DistrictSchoolsCard shows no screen counts. Both /screens and /screens/fleet and /screen-groups set `Cache-Control: no-store, no-cache, must-revalidate`.

## Q4 — Creation flow + direct insertion

Normal flow: (1) device POSTs /api/v1/screens/register `{ deviceFingerprint (required), resolution?, osInfo?, browserInfo?, userAgent?, priorDeviceToken? }` → the ONLY `screen.create` in the API (screens.controller.ts:523-537): name = `Screen-${pairingCode}`, 6-char pairingCode (32-char alphabet, unique-retry loop), status 'PENDING', tenantId null, lastPingAt now, hardwareModel auto-inferred from UA. Unpaired fingerprints have a register cooldown (REGISTER_FP_COOLDOWN 15 min). (2) Admin POSTs /api/v1/screens/pair `{ pairingCode, name?, screenGroupId? }` → SERIALIZABLE tx with seat-limit check → sets tenantId, status 'ONLINE', pairedAt now, pairingCode null (:1246-1279). There is NO admin bare-create endpoint — `useCreateScreen()` in use-api.ts:181 POSTs /screens which has no matching @Post() route (route list verified: only 'register', 'pair', etc.) and the hook is not imported anywhere; dead code.

Direct script insertion: WORKS. Only hard requirements are `name` (non-null) and `deviceFingerprint` (non-null + UNIQUE); everything else nullable or defaulted. Rules for good rendering:
- Set tenantId to the target tenant or the row is invisible (all list endpoints filter `tenantId: req.user.tenantId`).
- ONLINE display requires lastPingAt within 35s of the read AND tenantId set; a tenantId-set row with stale lastPingAt shows OFFLINE (not PENDING). To keep demo screens green, a refresher must bump lastPingAt at least every ~35s. status stored value is almost irrelevant (derived), but avoid 'REVOKED'.
- Do NOT use a fingerprint starting with 'preview-' (special-cased inert at register/status endpoints).
- Field formats from the real player (player/page.tsx getDeviceInfo :1463-1530): resolution = `${w}×${h}` with UNICODE × e.g. "1920×1080" (parsers accept x or × — buildScoreboardManifest regex `/^(\d+)\s*[x×]\s*(\d+)$/i`); osInfo ∈ 'Android'|'iOS'|'Windows'|'macOS'|'Linux'|'Chrome OS'|'Unknown' (osInfo==='Android' → dashboard shows "Android APK player" chip); browserInfo = `${browser} ${navigator.language}` e.g. "Chrome en-US" (browser ∈ Edge|Chrome|Firefox|Safari|Unknown). Suggested nice-looking extras: pairedAt, ipAddress, userAgent (a Chrome UA makes chromiumMajor/cssCompat populate), location, playerVersion e.g. "1.0.8".
- No null crashes: every field render is conditional — page.tsx :2034-2044 (`screen.resolution && …`, `screen.osInfo && …`), OsIcon defaults `(screen?.osInfo || '')` (:137-140), diagnostics `row('OS', screen?.osInfo)` (:438-439); fleet map drops screens with null effective coords (geoSource 'none'). seed.ts contains ZERO screen creation (only `prisma.screen.deleteMany()` at :50) so there are no seed example rows to copy — use the player formats above.

## Q5 — Manifest-hot-cache trap: demo screens are harmless

- The per-screen manifest content cache (manifest-hot-cache.ts:262-343) is an in-process Map keyed by screenId, populated ONLY inside GET /api/v1/screens/:id/manifest. A demo screen with no live player never polls → never gets an entry → zero cache interaction. TTLs: MANIFEST_CACHE_TTL_ARMED_MS = 30*60_000 (30 min) when the Prisma $use hook armed, MANIFEST_CACHE_TTL_UNARMED_MS = 20_000 (20s) otherwise; MANIFEST_CACHE_MAX_ENTRIES = 1_000.
- Dashboard list endpoints (/screens, /screen-groups, /screens/fleet) never consult this cache, read Prisma live, and send Cache-Control no-store — script-inserted rows appear on the next 10s poll.
- Raw/external Prisma script inserts: the content-rev bump hook lives in the API process's PrismaService ($use middleware, prisma.service.ts:41-66), so an external script's writes DON'T bump the rev. For NEW Screen rows this is moot (no cached entry exists for a screen that has never polled; other screens' manifests don't include foreign Screen rows). The only cross-effect to know: if a script mutates CONTENT models (Playlist/PlaylistItem/Schedule/Asset/Template/TemplateZone/TemplateScene/Tenant/ScreenGroup/ScreenEmergencyOverride — MANIFEST_FED_MODELS :185-197) the LIVE players see it only after the TTL backstop (≤30 min armed) — the documented CLAUDE.md rule. Emergency + scoreboard branches return before the cache and are never cached.
- If a keep-alive refresher updates demo rows, an update whose data keys are all within SCREEN_TELEMETRY_ONLY_FIELDS (:221-241 — lastPingAt, status, playerVersion*, forceApkUpdatePendingAt, lastOta*, managerVersion*, lastCacheReport*, lastRendered*, lastSyncReport*) is telemetry-only and never busts the cache even in-process; from an external script it can't bust anything anyway. Conversely a Screen `create`/`delete` executed IN the API process busts the ENTIRE cache once (bumpManifestContentRev clears the whole Map) — harmless one-time rebuild; external scripts don't even do that.
- One scanner interaction to expect: demo screens with stale lastPingAt (>5 min) and non-null tenantId WILL generate SCREEN_OFFLINE Notification rows every hour-bucket from the 60s scanner, and ≥3 demo screens dropping together within 90s can fire an INFRA_EVENT for that tenant. Keep-alive refreshing lastPingAt avoids this; or park demo rows with tenantId set only when wanted.
