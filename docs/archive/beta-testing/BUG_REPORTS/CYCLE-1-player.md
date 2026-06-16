# Cycle 1 — Player + APK + Offline cache + USB

Static review of player area. Findings ranked P0/P1/P2/GREEN.

## P0 — fix before pilot demo

### P0-1. SW stores emergency `setHash` before assets are downloaded
File: `apps/web/public/sw-player.js:187-190` (then assets fetched at 205-215).

`precacheEmergency()` writes `__edu_emergency_set_hash__` synchronously
**before** any `fetchAndStore` call runs. If a network drop, CORS error,
or the for-loop is killed mid-download, the meta key still claims the
new hash. The player-side short-circuit in
`page.tsx:1241-1257` (`refreshEmergencyCache`) then sees
`data.setHash === lastEmergencySetHashRef.current` and **skips re-push**
on subsequent intervals, leaving emergency assets permanently absent
on disk. The "🛡️ NEVER evicted" promise is silently broken because
the cache was never populated. Fix: only write the hash AFTER all
assets succeed, or write per-asset hashes only.

### P0-2. SW soft-cap eviction is a no-op for cross-origin assets
File: `apps/web/public/sw-player.js:267-278` (`sumCacheBytes`).

`sumCacheBytes` reads `content-length` from each cached `Response`. For
cross-origin Supabase Storage URLs (the entire asset library), the
fetch at line 234 uses `mode: 'cors'`; opaque or CORS-without-
content-length responses return `Number(null) = 0`. Total accumulates
to 0, so the `total > softCapBytes` guard at line 166 never fires. The
PLAYLIST tier grows unbounded — in practice this is fine on Android
storage budgets but the documented 5GB cap is not enforced. Same
flaw makes the dashboard "playlist cache MB" line in CacheStatusRow
read 0 bytes despite 50+ assets cached (operator-visible).

### P0-3. USB export silently auto-enables `usbIngestEnabled`
File: `apps/api/src/usb-export/usb-export.controller.ts:171-187`.

CLAUDE.md Sprint 7 spec: *"Per-tenant feature flag: usbIngestEnabled
(default false for new tenants; admins must opt in)."* The bundle
endpoint silently flips the flag to true and mints an HMAC key on
the first call. Any DISTRICT_ADMIN/SCHOOL_ADMIN can bypass the
opt-in by clicking the Download button. There is no audit trail
explicitly for "feature enabled by export" — the audit log line
353 records `USB_BUNDLE_EXPORTED` but not the silent provisioning.
Also: pilot tenants who never asked for USB now have a long-lived
HMAC key minted without their knowledge.

## P1 — visible bugs

### P1-1. Capability data collected but never sent or stored
Files: `apps/web/src/app/player/page.tsx:343-411` (collects), API:
`apps/api/src/screens/screens.controller.ts:121-132` (register body),
`packages/database/prisma/schema.prisma` (no `capabilities`/
`chromiumVersion` columns).

`getDeviceInfo()` builds a rich `capabilities` object plus
`chromiumVersion`, **spreads it into the register POST body**, but
the `register` controller's typed `body` only declares
`{deviceFingerprint, resolution, osInfo, browserInfo, userAgent,
priorDeviceToken}`. Extra fields are dropped on the server. There
are no schema columns for `capabilities` or `chromiumVersion`. The
heartbeat URL builder at page.tsx:312-335 also does not include
caps. Net effect: every "modernChromium / containerQueries / H.265"
flag is collected, console.log'd, then discarded. Sprint 8d goal
("ops sees per-screen capability at a glance") cannot work today.

### P1-2. SW `precachePlaylist` evicts every entry not in the latest URL set
File: `apps/web/public/sw-player.js:138-145`.

The doc comment says "LRU within the new manifest scope" but the loop
is unconditional: any cached entry whose URL is not in the incoming
manifest is deleted. Real LRU shouldn't evict non-orphaned entries
that are still under the soft cap. More importantly, with a flapping
manifest (e.g., URLs differ by signed token but the comment chain
mentions stable keys), a different signed URL on the same asset will
**evict and re-download** despite the same hash. `stableManifestUrlKey`
in page.tsx is used for the dedup `setHash`, but the SW receives
the raw URL via `precachePlaylist`'s `assets[].url` (page.tsx:1573
prepends `getApiRoot()` but does not strip signed tokens), so the
SW uses raw URLs as cache keys. Net: a Supabase signed URL that
expires every hour evicts the entire playlist tier hourly.

### P1-3. WebSocket emergency events: ALL_CLEAR can be DROPPED on first run
File: `apps/web/src/app/player/page.tsx:1940-1967`, `1971-1974`.

`ALL_CLEAR` is in `SENSITIVE_TYPES`, so the message must carry a
`signature` AND a `timestamp` within ±30s of `Date.now() +
serverClockOffsetRef.current`. The offset is set ONLY at AUTH_OK
(line 1919). If `ALL_CLEAR` arrives before AUTH_OK on a wrong-clock
kiosk (offset still 0), the timestamp check at line 1949 drops it
silently. The cached emergency therefore stays on screen until
manifest poll at 1968 catches the change. On a kiosk with a
multi-minute clock skew, this is a real issue — the screen continues
showing LOCKDOWN while staff are doing all-clear walkthroughs. Fix:
allow ALL_CLEAR with looser staleness, or process it before the
sensitive-events gate.

### P1-4. WS HELLO falls back to a `dev_<screenId>_unknown` token
File: `apps/web/src/app/player/page.tsx:1891`.

`const tok = getDeviceToken() || (tenantId ? \`dev_${screenId}_${tenantId}\` : \`dev_${screenId}_unknown\`);`

If `getDeviceToken()` returns null (LS wiped, private mode, etc.),
the WebSocket sends a `dev_` token. Per CLAUDE.md, `DEV_WS_ALLOW`
controls whether unsigned `dev_` tokens are accepted. **In production
we want this OFF — but the player UNCONDITIONALLY emits these
tokens.** The WS handshake will fail server-side and the device
falls back to HTTP polling (5s). Functional, but the fallback
silently degrades real-time emergency delivery.

### P1-5. `apkUrl` is fetched and `latestApkVersion` rendered on the splash but no auth
File: `apps/web/src/app/player/page.tsx:1090-1099` calls
`/api/v1/player/latest-version`. The endpoint
(`player-ota.controller.ts:404-429`) has NO `@Throttle` and NO
`@RequireRoles`. Public — anyone can hit it.

Lower stakes (it returns the GH release tag, public info), but
combined with the public `/apk/latest` redirect this lets an
attacker discover the active player APK URL and SHA in one
unauthenticated GET. Tag this for CSRF/rate-limit hardening.

### P1-6. Pairing code alphabet excludes I/O/0/1, length 6 = 32^6 ≈ 1B — but 10-attempt collision retry
File: `apps/api/src/screens/screens.controller.ts:24-34, 336-340`.

The code generation tries to find a unique 6-char code with up to
**10 attempts** before giving up. With the alphabet of 32 chars and
1B possibilities the collision rate is fine today, but the controller
returns the LAST attempted code without checking it's actually
unique on the 11th miss — the subsequent `prisma.create` will throw
on the unique index. There's no friendly fallback message; the
operator sees a 500. Bump to 30 attempts or lock with a transactional
upsert.

## P2 — minor / nice-to-have

### P2-1. `getCacheStatus` falls back to fake "supported: false"
`apps/web/src/app/player/offline-cache.ts:69-70`. When SW is unsupported
the helper returns `{supported: false}` only when `activeWorker()`
returns null. But the post-helper at page.tsx:1217 silently drops
the report on `!status?.supported` — admins never see a "this kiosk
has no SW" signal in the dashboard.

### P2-2. `connect()` reuses the closure's `wsUrl` from `getApiRoot()` at first attempt only
`apps/web/src/app/player/page.tsx:1881`. If the API URL changes
mid-session (operator switched API root via `?api=` param after
WS connected), reconnects keep using the original URL until phase
flips.

### P2-3. `releaseAssetsCache` referenced but undefined
`apps/api/src/player-ota/player-ota.controller.ts:322`.
Code reads `releaseAssetsCache` to decide a log message, but the
identifier resolves at runtime — verify export. (Likely defined
later in file; couldn't locate in 300-line slice. Flag for grep.)

### P2-4. Splash quotes Auto-Play but it's a placeholder
`apps/web/src/app/player/page.tsx:3595-3604`. The "Auto-Play" button
opens an `appAlert("Nothing to play yet")`. It does NOT trigger
playback — operator-confusing label.

## GREEN — verified working

- Pairing code generation uses CSPRNG (`crypto.randomInt`) — sec-fix
  applied (screens.controller.ts:30).
- Per-fingerprint cooldown (15min, unpaired only) defends against
  enumeration (screens.controller.ts:159-184).
- `/cache-status` POST and `/emergency-assets` GET both gated by
  device JWT, sub must equal screenId (sec-fix wave1 #4/#5).
- USB export ZIP signs `manifest.json` with HMAC-SHA256 of tenant
  HMAC key; manifest schema versioned `version: 1`.
- WebSocket replay protection via `recentEventIdsRef` Map with
  500-entry hard cap and 5-min eviction (page.tsx:953-965).
- `Tenant.autoUpdatePlayerEnabled` defaults `false` per spec
  (schema.prisma:82).
- OTA: GH SHA-256 fail-closed if hash unresolvable
  (player-ota.controller.ts:367-374).
- Manifest endpoint scopes screen reads by tenantId for non-SUPER
  callers, returns 404 instead of 403 to avoid existence leaks.
- Per-screen emergency override precedence over tenant-wide is
  correctly implemented in `getManifest`.
- Heartbeat / ping intervals exponential-backoff with jitter via
  `backoffMs`; never gives up (matches "self-heal forever" spec).

## Notes
- Confirmed 51+ `console.*` in `player/page.tsx` — kiosk diagnostic
  surface, intentional. No new ones flagged.
- No `console.log` found in `sw-player.js` — clean.
- `apps/api/src/screens/screens.controller.ts` has 5 `console.log`
  calls (lines 454, 570, 638, 1107, 1136) — intentional Railway
  forensic logs per CLAUDE.md "make sure we have logs."
