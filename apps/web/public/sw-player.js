/* eslint-disable no-undef */
/**
 * EduCMS Player — Service Worker
 *
 * Three cache tiers:
 *   1. PLAYLIST_CACHE — assets in active playlists. LRU on PRECACHE_PLAYLIST
 *      messages (we drop entries no longer referenced by the latest manifest).
 *   2. EMERGENCY_CACHE — assets across all 4 panic-type playlists. NEVER
 *      evicted automatically. Refreshed on PRECACHE_EMERGENCY messages.
 *   3. SHELL_CACHE (2026-07-20, bundle-split step 1) — the app shell:
 *      /_next/static build assets (js/css/fonts), so a cold-boot-OFFLINE
 *      player can still execute the page, not just show cached media.
 *      Filled three ways: activate-time parse of the player route HTML,
 *      page-triggered PRECACHE_SHELL (idle after boot — covers deploys
 *      that change chunks without changing this SW file), and runtime
 *      capture in the fetch handler (hashed URLs are immutable, so
 *      cache-first is always correct). Pruned to the currently-referenced
 *      set on each refresh — PLUS every runtime-captured entry still in
 *      recent use (see below).
 *
 *      ⚠ STEP-3 GUARD, NOW DISCHARGED (P0-3, 2026-09-02). The guard said:
 *      "today every player chunk is statically referenced in the route
 *      HTML, so prune-to-parsed-set is complete; if PLAYER code ever
 *      starts lazy-importing chunks, the prune MUST change first or it
 *      will evict the lazy chunks it just captured." /player NOW
 *      lazy-imports its renderer (app/player/rendererBundle.tsx), so that
 *      chunk is NOT in the route HTML and prune-to-parsed-set would have
 *      deleted it on the next PRECACHE_SHELL — turning the first offline
 *      boot after any idle refresh into a blank screen.
 *
 *      The prune therefore keeps a second class of entry: anything
 *      `shellFetch` captured at runtime and served/refreshed within
 *      RUNTIME_KEEP_MS. Every cache hit renews that stamp, so a chunk the
 *      player actually loads is kept for as long as it is in use, while a
 *      chunk orphaned by an old deploy ages out and is reclaimed. Hashed
 *      URLs make keeping an extra entry harmless (never stale, only
 *      storage), which is why "keep on doubt" is the safe direction here.
 *
 * All tiers serve fetches transparently to the page so <img src=…> and
 * <video src=…> stay completely unaware of caching.
 *
 * The page communicates via postMessage:
 *   { type: 'PRECACHE_PLAYLIST',  assets: [{url,sha256?,size?}] }
 *   { type: 'PRECACHE_EMERGENCY', assets: [{url,sha256?,size?}], setHash }
 *   { type: 'PRECACHE_SHELL',     routes?: string[], extra?: string[] }
 *                                                     → PRECACHE_SHELL_DONE
 *     `extra` = same-origin /_next/static paths the PAGE is running on but
 *     the route HTML does not name — i.e. dynamically imported chunks.
 *   { type: 'PRECACHE_CHUNK', url, sha256, size, offset, chunkBytes } (port ack)
 *   { type: 'PRECACHE_VERIFY', url, sha256 }            (port ack)
 *   { type: 'PRECACHE_ASSEMBLE', url, sha256 }          (port ack)
 *       — the large-asset staging protocol (2026-09-26); see the block
 *         above precachePlaylist. PRECACHE_PLAYLIST acks `pending` for
 *         files it will not download inside its own event.
 *   { type: 'CACHE_LOOKUP', urls: [{ url, sha256 }] }  (port ack → { cached })
 *   { type: 'STATUS_REQUEST' }                         → STATUS_REPLY
 *   { type: 'CLEAR_CACHE',        tier: 'playlist'|'emergency'|'shell'|'all' }
 */

// Bump VERSION to force existing players to drop stale caches on activate.
// v2 bundles two CYCLE-1 P0 fixes: emergency setHash now happens AFTER all
// downloads succeed (player-001), and sumCacheBytes uses blob().size with a
// per-URL size map instead of trusting the missing content-length header on
// opaque/CORS responses (player-002).
// v3 bundles two CYCLE-3 P0 fixes:
//   - player-014: PRECACHE_EMERGENCY now acks the page via MessageChannel
//     port so the page-side lastEmergencySetHashRef commits ONLY after the
//     SW confirms allCached.
//   - player-015: activate now COPIES emergency entries from the previous
//     versioned emergency cache into the new one BEFORE deleting the old
//     cache, so a SW upgrade never leaves the kiosk with 0 cached
//     emergency assets in the gap before the next refreshEmergencyCache.
// v4 bundles CYCLE-4 P1 fix:
//   - player-005: cache eviction + lookup now use a stable key (origin +
//     pathname, query stripped) so Supabase signed-URL token rotation no
//     longer wipes + re-downloads the entire playlist every hour. The
//     network Request still uses the full signed URL (cache.put preserves
//     the original Request) so authorized fetches still succeed; only
//     the dedupe / eviction / size-tracking maps key on the stable form.
// v5 — 2026-05-04 — bump only to force every paired kiosk to drop its
// stale playlist cache and re-fetch fresh from the network the next
// time activate fires. No code change here; the version bump itself
// is the cache-bust mechanism. Combined with the page-side fix to
// the slide-cycle (Goodview / Chromium 95 stuck-on-slide-1), this
// guarantees old kiosks pick up the new behavior on next reload.
// v6 — 2026-05-04 — second cache-bust same day. Operator reports
// "i didnt see any change" after v5 deploy — the WebView is likely
// still serving the v5 SW from disk cache. Bumping again ensures
// activate runs with the freshest skipWaiting().
// v7 — 2026-05-04 — third cache-bust to ship the @layer flattening
// PostCSS plugin (root cause of Chromium 95 invisible Tailwind
// utilities). Forces every paired kiosk to re-fetch the new CSS
// bundle that doesn't have @layer wrappers.
// v8 — 2026-05-04 — bump again with browserslist + cache-control
// header changes. SW VERSION change isn't load-bearing for these
// fixes (they're build-time + HTTP-header), but bumping lets us
// detect via the deployed /sw-player.js whether v8 deploy landed.
// v9 — 2026-05-04 — VenueOS rebrand release. Bumping again so
// caches force-evict on every paired kiosk after the rebrand
// commit lands.
const VERSION = 'v9';
const PLAYLIST_CACHE = `edu-player-playlist-${VERSION}`;
const EMERGENCY_CACHE = `edu-player-emergency-${VERSION}`;
const META_CACHE = `edu-player-meta-${VERSION}`; // stores sha hashes per URL
const SHELL_CACHE = `edu-player-shell-${VERSION}`; // /_next/static app shell
// Large-asset staging (2026-09-26): one entry per downloaded Range chunk of a
// big playlist file, promoted into PLAYLIST_CACHE only after the whole file
// verified. Same VERSION suffix so a bump discards half-downloads with the rest.
const STAGING_CACHE = `edu-player-staging-${VERSION}`;
const ALL_CACHES = [PLAYLIST_CACHE, EMERGENCY_CACHE, META_CACHE, SHELL_CACHE, STAGING_CACHE];

// Routes whose HTML we parse to enumerate the app shell. The SW is scoped
// to /player, so the player route is the only entry it controls.
const SHELL_ROUTES = ['/player'];

// Per-URL byte sizes captured at fetch time. Survives SW restarts via the
// META_CACHE (we mirror this map into Cache Storage on every write so a
// cold-boot SW can rebuild it). Avoids re-cloning blobs on every status poll.
const SIZE_BY_URL = new Map();
const SIZE_META_PREFIX = '/__edu_meta_size__/';

// ─── Runtime-captured shell entries (P0-3) ───────────────────────────────
// A lazily-imported chunk never appears in the route HTML, so the shell
// prune cannot see it. `shellFetch` stamps every /_next/static entry it
// serves or captures with a "last used" epoch under this prefix, and the
// prune keeps anything stamped within RUNTIME_KEEP_MS. Deliberately
// generous: an over-kept hashed chunk costs storage, an under-kept one
// costs a blank screen on the next offline boot.
const SHELL_USE_PREFIX = '/__edu_shell_used__/';
const RUNTIME_KEEP_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// Re-stamping on literally every asset hit would mean ~30 Cache writes per
// boot. In-memory throttle: only write when our own last write for that URL
// is older than this. SW restarts clear the map, so the first hit after a
// restart always writes — which is exactly when the stamp matters.
const SHELL_USE_WRITE_THROTTLE_MS = 60 * 60 * 1000; // 1 hour
const SHELL_USE_WRITTEN_AT = new Map();

// Soft cap on the playlist cache (in bytes). When a precache push would
// exceed this we drop oldest entries first. Default 5 GB; can be overridden
// via the PRECACHE_PLAYLIST message's `softCapBytes` field.
const DEFAULT_SOFT_CAP_BYTES = 5 * 1024 * 1024 * 1024;
// Hard floor reserved for the emergency tier — never evicted.
const EMERGENCY_FLOOR_BYTES = 1 * 1024 * 1024 * 1024;

// BUG #5 fix — extract the trailing numeric version from a cache name
// (`edu-player-emergency-v10` → 10). Returns -1 when there's no `-vN`
// suffix so unversioned / malformed names always sort oldest. Kept as a
// pure function (no I/O) so it's unit-testable.
function cacheVersionNum(name) {
  var m = /-v(\d+)$/.exec(String(name || ''));
  return m ? parseInt(m[1], 10) : -1;
}

// Pick the newest cache from a list by NUMERIC version, not lexically.
// The old code used Array.prototype.sort() (string compare), under which
// 'edu-player-...-v10' sorts BEFORE '...-v9' ('1' < '9' at the third char),
// so after the 10th VERSION bump it copied the STALE v9 cache forward
// instead of v10 — losing a whole version's worth of freshly-cached
// assets on every kiosk. Comparing the parsed integer fixes the ordering
// for v10, v100, and beyond. Returns null for an empty list.
function newestCacheName(names) {
  var best = null;
  var bestNum = -Infinity;
  for (var i = 0; i < names.length; i++) {
    var n = cacheVersionNum(names[i]);
    if (n > bestNum) { bestNum = n; best = names[i]; }
  }
  return best;
}

// Extract app-shell asset paths from a route's HTML. Pure (no I/O) so the
// CI gate can exercise it. Handles both raw `/_next/static/...` references
// and the JSON-escaped `\/_next\/static\/...` form Next embeds in flight
// data, dedupes, and keeps only real build assets (js/css/fonts/wasm) —
// never the image optimizer or data routes.
function extractShellUrls(html) {
  const out = [];
  const seen = {};
  const text = String(html || '').replace(/\\\//g, '/');
  const re = /\/_next\/static\/[A-Za-z0-9_\-./~%[\]@]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let u = m[0].replace(/[.,]+$/, ''); // trim sentence-ish trailing punctuation
    if (!/\.(js|css|woff2?|wasm)$/.test(u)) continue;
    if (seen[u]) continue;
    seen[u] = true;
    out.push(u);
  }
  return out;
}

// Expose the pure helpers for the CI gate (apps/web/tools/check-sw-shell.cjs
// vm-loads this file and reads self.__swTestHooks). No effect in a real SW.
if (typeof self !== 'undefined') {
  self.__swTestHooks = {
    cacheVersionNum: cacheVersionNum,
    newestCacheName: newestCacheName,
    extractShellUrls: extractShellUrls,
  };
}

self.addEventListener('install', (event) => {
  // Activate immediately so the page's first manifest fetch can already use us.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // FIX (player-015): when bumping VERSION (e.g. v2 -> v3), copy the
    // old versioned EMERGENCY cache and its META entries into the new
    // versioned caches BEFORE deleting the old ones. Hashes still match
    // so no re-download is needed; the kiosk never has 0 cached
    // emergency assets during the SW upgrade window. We do the same for
    // META so the per-URL hash + size records survive — without them,
    // refreshEmergencyCache would re-download unnecessarily.
    const keys = await caches.keys();
    const stale = keys.filter((k) => k.startsWith('edu-player-') && !ALL_CACHES.includes(k));

    // Find the most recent stale emergency + meta caches by NUMERIC version
    // (BUG #5 fix — a lexical .sort() picked v9 over v10 after the 10th bump).
    const staleEmergency = stale.filter((k) => k.startsWith('edu-player-emergency-'));
    const staleMeta = stale.filter((k) => k.startsWith('edu-player-meta-'));
    const oldEmergencyName = newestCacheName(staleEmergency);
    const oldMetaName = newestCacheName(staleMeta);

    if (oldEmergencyName) {
      try {
        const [oldEm, newEm] = await Promise.all([
          caches.open(oldEmergencyName),
          caches.open(EMERGENCY_CACHE),
        ]);
        const oldKeys = await oldEm.keys();
        for (const req of oldKeys) {
          const res = await oldEm.match(req);
          if (res) {
            // Use put() with the original Request so headers + URL are preserved.
            await newEm.put(req, res.clone());
          }
        }
      } catch (e) {
        console.warn('[SW] activate: failed to copy old emergency cache', e);
      }
    }

    if (oldMetaName) {
      try {
        const [oldMeta, newMeta] = await Promise.all([
          caches.open(oldMetaName),
          caches.open(META_CACHE),
        ]);
        const oldKeys = await oldMeta.keys();
        for (const req of oldKeys) {
          const res = await oldMeta.match(req);
          if (res) {
            await newMeta.put(req, res.clone());
          }
        }
      } catch (e) {
        console.warn('[SW] activate: failed to copy old meta cache', e);
      }
    }

    // FIX (audit P1): also copy the PLAYLIST cache forward on a VERSION bump.
    // Previously the playlist cache was dropped here and only refilled by the
    // next PRECACHE_PLAYLIST — so every kiosk re-downloaded its ENTIRE playlist
    // from Supabase on each SW upgrade (a fleet-wide egress spike, made worse
    // by operators bumping VERSION as a "did the deploy land?" probe). Hashes
    // still match, so this is a pure local copy — no network. Mirrors the
    // emergency/meta copy-forward above.
    const stalePlaylist = stale.filter((k) => k.startsWith('edu-player-playlist-'));
    const oldPlaylistName = newestCacheName(stalePlaylist); // BUG #5 fix — numeric, not lexical
    if (oldPlaylistName) {
      try {
        const [oldPl, newPl] = await Promise.all([
          caches.open(oldPlaylistName),
          caches.open(PLAYLIST_CACHE),
        ]);
        const oldKeys = await oldPl.keys();
        for (const req of oldKeys) {
          const res = await oldPl.match(req);
          if (res) await newPl.put(req, res.clone());
        }
      } catch (e) {
        console.warn('[SW] activate: failed to copy old playlist cache', e);
      }
    }

    // Shell copy-forward on VERSION bump: hashed /_next/static URLs are
    // immutable (same URL = same bytes forever), so a pure local copy is
    // always correct and saves a fleet-wide chunk re-download.
    const staleShell = stale.filter((k) => k.startsWith('edu-player-shell-'));
    const oldShellName = newestCacheName(staleShell);
    if (oldShellName) {
      try {
        const [oldSh, newSh] = await Promise.all([
          caches.open(oldShellName),
          caches.open(SHELL_CACHE),
        ]);
        const oldKeys = await oldSh.keys();
        for (const req of oldKeys) {
          const res = await oldSh.match(req);
          if (res) await newSh.put(req, res.clone());
        }
      } catch (e) {
        console.warn('[SW] activate: failed to copy old shell cache', e);
      }
    }

    // Now safe to delete stale versioned caches.
    await Promise.all(stale.map((k) => caches.delete(k)));
    await self.clients.claim();

    // Refresh the app shell for the build we just activated under. Failure
    // is non-fatal (offline activate keeps whatever shell we carried over).
    try { await precacheAppShell(); } catch (e) { /* best-effort */ }
  })());
});

/**
 * Build a 206 Partial Content response by slicing a fully-cached 200 response
 * to the requested byte range. Lets the cache satisfy <video>/<audio> Range
 * requests so media plays from disk (offline-capable) instead of re-streaming
 * from origin. On any parse problem we fall back to the full cached response
 * (never break playback). Cached entries are always full 200s (precached), so
 * slicing the blob is correct.
 */
async function rangeResponseFromCached(cached, rangeHeader) {
  try {
    const m = /^bytes=(\d*)-(\d*)$/.exec((rangeHeader || '').trim());
    if (!m) return cached;
    const blob = await cached.blob();
    const size = blob.size;
    let start = m[1] === '' ? null : parseInt(m[1], 10);
    let end = m[2] === '' ? null : parseInt(m[2], 10);
    if (start === null && end === null) return cached;
    if (start === null) {
      // suffix range: last N bytes
      start = Math.max(0, size - end);
      end = size - 1;
    } else if (end === null || end >= size) {
      end = size - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
      return new Response(null, {
        status: 416,
        statusText: 'Range Not Satisfiable',
        headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' },
      });
    }
    const headers = new Headers(cached.headers);
    headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
    headers.set('Content-Length', String(end - start + 1));
    headers.set('Accept-Ranges', 'bytes');
    return new Response(blob.slice(start, end + 1), {
      status: 206,
      statusText: 'Partial Content',
      headers,
    });
  } catch (e) {
    return cached; // never break playback over a range-slicing error
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only intercept GETs for things that look like media assets we might cache.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // App-shell: the DOCUMENT itself, network-first with cached fallback.
  // Without this, a cold-boot-offline kiosk dies fetching /player HTML
  // before a single cached chunk matters. Network-first keeps deploys
  // instant when online; offline serves the last-good document whose
  // chunks the shell tier below has pinned.
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    event.respondWith(shellNavigate(req));
    return;
  }

  // App-shell tier: cache-first for same-origin /_next/static build assets
  // (immutable hashed URLs — a cache hit is always correct; a network miss
  // while offline is the exact cold-boot failure this tier removes). The
  // REST of /_next/ (image optimizer, data routes) stays browser-native.
  if (url.pathname.startsWith('/_next/')) {
    if (url.origin === self.location.origin && url.pathname.startsWith('/_next/static/')) {
      event.respondWith(shellFetch(req));
    }
    return;
  }
  if (url.pathname.includes('/api/v1/')) return;

  event.respondWith((async () => {
    // MED-3 audit fix: try the request URL as-is first, then fall back to
    // a query-stripped variant. CDNs often append cache-busters
    // (?v=2) that wouldn't otherwise match a previously-cached version
    // of the same asset. ignoreSearch on .match() does the work for us.
    const stripped = stripQuery(req.url);
    const altReq = stripped !== req.url ? new Request(stripped, { method: 'GET' }) : null;

    // A <video>/<audio> element fetches media via HTTP Range requests
    // (e.g. "Range: bytes=0-"). Cache.match() returns the full 200 we cached,
    // which WebKit / older Chromium REJECT for a range request and then
    // re-fetch from origin — so a looping emergency/playlist video re-streams
    // from Supabase every loop (continuous fleet egress) and may not play at
    // all when offline. Synthesize a 206 Partial Content from the cached blob
    // so the cache actually satisfies the range. (FIX — audit P1.)
    const rangeHeader = req.headers.get('range');

    // Try emergency cache first (highest priority for life-safety).
    const emCache = await caches.open(EMERGENCY_CACHE);
    const emHit = await emCache.match(req, { ignoreSearch: true })
              ?? (altReq && await emCache.match(altReq, { ignoreSearch: true }));
    if (emHit) return rangeHeader ? await rangeResponseFromCached(emHit, rangeHeader) : emHit;

    // Then playlist cache.
    const plCache = await caches.open(PLAYLIST_CACHE);
    const plHit = await plCache.match(req, { ignoreSearch: true })
              ?? (altReq && await plCache.match(altReq, { ignoreSearch: true }));
    if (plHit) return rangeHeader ? await rangeResponseFromCached(plHit, rangeHeader) : plHit;

    // Bug fix (Android images): for cross-origin URLs that are NOT in any
    // cache tier, bail out of the SW and let the browser fetch them natively.
    // Inside a Service Worker, fetch() on a cross-origin URL uses CORS rules
    // from the SW origin — this can fail on Android WebView for assets served
    // from a CDN (e.g. Supabase Storage) if CORS headers aren't perfectly
    // configured. Browser-native <img>/<video> fetches don't enforce CORS at
    // all (they use no-cors mode by default), so the asset always loads fine
    // when the SW doesn't intercept. We still intercept to serve FROM cache;
    // we just avoid the SW-level network fetch for uncached cross-origin media.
    const isCrossOrigin = url.origin !== self.location.origin;
    if (isCrossOrigin) {
      // Let the browser handle it natively — no SW network hop.
      return fetch(req.clone());
    }

    // Same-origin fallback to network + opportunistic cache write.
    try {
      const res = await fetch(req);
      if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
        const ct = res.headers.get('content-type') || '';
        if (ct.startsWith('image/') || ct.startsWith('video/') || ct.startsWith('audio/')) {
          plCache.put(req, res.clone()).catch(() => {});
        }
      }
      return res;
    } catch (e) {
      // Offline + nothing cached → return a stub so the player renders an
      // "asset missing" state instead of a network error.
      return new Response('', { status: 504, statusText: 'Offline / not cached' });
    }
  })());
});

// ─── Message handler — pre-cache, status, clear ───
self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'PRECACHE_PLAYLIST') {
    const ackPort = (event.ports && event.ports[0]) || null;
    // Distinguish a current worker doing a long download from an older
    // active worker that does not understand playlist acknowledgements.
    if (ackPort) {
      try { ackPort.postMessage({ started: true }); } catch (_e) { /* page may have reloaded */ }
    }
    event.waitUntil(precachePlaylist(msg.assets || [], msg.softCapBytes || DEFAULT_SOFT_CAP_BYTES, ackPort).catch((error) => {
      console.warn('[sw-player] playlist cache failed', { reason: error && error.name || 'unknown' });
      if (ackPort) {
        try { ackPort.postMessage({ ok: false, failures: (msg.assets || []).length, count: (msg.assets || []).length }); } catch (_e) { /* page may have reloaded */ }
      }
    }));
  } else if (msg.type === 'PRECACHE_EMERGENCY') {
    // FIX (player-014): if the page passed a MessageChannel port,
    // we ack with { ok: true|false } AFTER deciding allCached so the
    // page only commits its lastEmergencySetHashRef on full success.
    const ackPort = (event.ports && event.ports[0]) || null;
    event.waitUntil(precacheEmergency(msg.assets || [], msg.setHash || '', ackPort));
  } else if (msg.type === 'PRECACHE_SHELL') {
    event.waitUntil(precacheAppShell(msg.routes, msg.extra));
  } else if (msg.type === 'PRECACHE_CHUNK') {
    // Large-asset staging (2026-09-26). Each of these is its OWN message
    // event on purpose: Chromium stops a worker whose event runs past five
    // minutes, so a big file is fetched as short, separately-timed steps that
    // the page drives — see the staging block above precachePlaylist.
    event.waitUntil(answerPort(event, () => stageChunk(msg)));
  } else if (msg.type === 'PRECACHE_VERIFY') {
    event.waitUntil(answerPort(event, () => verifyStaged(msg)));
  } else if (msg.type === 'PRECACHE_ASSEMBLE') {
    event.waitUntil(answerPort(event, () => assembleStaged(msg)));
  } else if (msg.type === 'CACHE_LOOKUP') {
    event.waitUntil(answerPort(event, () => cacheLookup(msg)));
  } else if (msg.type === 'STATUS_REQUEST') {
    event.waitUntil(replyStatus(event.source));
  } else if (msg.type === 'CLEAR_CACHE') {
    event.waitUntil(clearCache(msg.tier || 'all'));
  }
});

// ─── App-shell tier (bundle-split step 1) ───

// Navigation requests: network-first (a deploy shows up on the very next
// online load), falling back to the cached document so a cold OFFLINE boot
// still renders. Cache key is the pathname only — /player?screen=X and
// /player?screen=Y are the same shell document.
//
// ⚠ FIELD INCIDENT (2026-07-21, Greg's tablet): the first version of this
// fallback returned HTTP **503**. Android WebView treats ANY non-2xx
// top-level document as a load failure (net::ERR_HTTP_RESPONSE_CODE_FAILURE)
// and shows its dead "Webpage not available" page INSTEAD of our HTML — and
// that native error page never retries, so a kiosk that blipped offline
// stayed stuck AFTER the network returned, unreachable by REFRESH_WEB
// (no page = no WS/poll). The fallback is therefore a **200** (WebView
// renders it) that SELF-HEALS: it probes the network every 5s + listens for
// the `online` event and reloads the real player the moment the route is
// reachable. Do NOT change the status back to an error code.
async function shellNavigate(req) {
  const docKey = new Request(new URL(req.url).pathname, { credentials: 'same-origin' });
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(docKey, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const cached = await cache.match(docKey);
    if (cached) return cached;
    const target = new URL(req.url).pathname || '/player';
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Reconnecting…</title>' +
      '<body style="background:#0b1020;color:#e2e8f0;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">' +
      '<div style="text-align:center"><div style="width:34px;height:34px;margin:0 auto 14px;border:3px solid rgba(226,232,240,.25);border-top-color:#818cf8;border-radius:50%;animation:sp 1s linear infinite"></div>' +
      '<h1 style="font-size:26px;margin:0 0 8px">Waiting for network…</h1>' +
      '<p style="opacity:.7;margin:0">This screen reconnects automatically. Nothing to do.</p></div>' +
      '<style>@keyframes sp{to{transform:rotate(360deg)}}</style>' +
      '<script>(function(){var t="' + target.replace(/"/g, '') + '";function go(){location.replace(t)}\n' +
      'function probe(){fetch(t,{method:"HEAD",cache:"no-store"}).then(function(r){if(r&&(r.ok||r.status===304)){go()}}).catch(function(){})}\n' +
      'addEventListener("online",probe);setInterval(probe,5000);probe();})()</script>',
      { status: 200, headers: { 'content-type': 'text/html', 'cache-control': 'no-store' } },
    );
  }
}

// Cache-first for immutable /_next/static assets + runtime capture of
// anything the page loads that the HTML parse missed.
async function shellFetch(req) {
  try {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match(req);
    if (hit) {
      // Renew the runtime stamp so the prune keeps this entry (P0-3): a
      // lazily-imported chunk lives ONLY in this tier and is invisible to
      // the route-HTML parse.
      touchShellEntry(req.url);
      return hit;
    }
    const res = await fetch(req);
    if (res && res.ok) {
      cache.put(req, res.clone()).catch(() => {});
      touchShellEntry(req.url);
    }
    return res;
  } catch (e) {
    // Offline + not in shell yet → same failure the page would see with no
    // SW. Stub response keeps the error contained to the one asset.
    return new Response('', { status: 504, statusText: 'Offline / shell miss' });
  }
}

// ─── Runtime-shell stamps (P0-3) ─────────────────────────────────────────
// Key by PATHNAME: /_next/static URLs are content-hashed and query-free, and
// the prune compares pathnames, so the two sides always agree.
function shellUseKey(url) {
  let p = url;
  try { p = new URL(url, self.location.origin).pathname; } catch (e) { /* raw */ }
  return new Request(`${SHELL_USE_PREFIX}${encodeURIComponent(p)}`);
}

/** Record that this shell entry was served/captured just now. Never throws. */
function touchShellEntry(url) {
  let p = url;
  try { p = new URL(url, self.location.origin).pathname; } catch (e) { /* raw */ }
  const now = Date.now();
  const last = SHELL_USE_WRITTEN_AT.get(p) || 0;
  if (now - last < SHELL_USE_WRITE_THROTTLE_MS) return;
  SHELL_USE_WRITTEN_AT.set(p, now);
  caches
    .open(META_CACHE)
    .then((meta) =>
      meta.put(shellUseKey(p), new Response(String(now), { headers: { 'content-type': 'text/plain' } })),
    )
    .catch(() => {});
}

/** Forget a stamp for an entry the prune just deleted. Never throws. */
async function dropShellUseStamp(url) {
  try {
    let p = url;
    try { p = new URL(url, self.location.origin).pathname; } catch (e) { /* raw */ }
    SHELL_USE_WRITTEN_AT.delete(p);
    const meta = await caches.open(META_CACHE);
    await meta.delete(shellUseKey(p));
  } catch (e) { /* best-effort */ }
}

/**
 * The set of shell PATHNAMES used within RUNTIME_KEEP_MS — the prune's
 * "keep anyway" list. An unreadable/garbage stamp is treated as RECENT (keep
 * on doubt): losing a lazy chunk costs a blank offline boot, keeping a stale
 * hashed one costs a few KB.
 */
async function recentRuntimeShellPaths() {
  const keep = new Set();
  try {
    const meta = await caches.open(META_CACHE);
    const keys = await meta.keys();
    const cutoff = Date.now() - RUNTIME_KEEP_MS;
    for (const req of keys) {
      let path = '';
      try {
        path = new URL(req.url).pathname;
      } catch (e) {
        continue;
      }
      if (path.indexOf(SHELL_USE_PREFIX) !== 0) continue;
      const target = decodeURIComponent(path.slice(SHELL_USE_PREFIX.length));
      if (!target) continue;
      let stamp = NaN;
      try {
        const res = await meta.match(req);
        stamp = res ? parseInt(await res.text(), 10) : NaN;
      } catch (e) {
        stamp = NaN;
      }
      if (!isFinite(stamp) || stamp >= cutoff) keep.add(target);
    }
  } catch (e) {
    /* No meta cache → keep nothing extra; the parsed set still lands. */
  }
  return keep;
}

// Enumerate the current build's shell by parsing the player route HTML,
// fetch what's missing, prune what's no longer referenced. See the
// header's STEP-3 GUARD before changing the prune rule.
async function precacheAppShell(routes, extra) {
  const cache = await caches.open(SHELL_CACHE);
  const wanted = new Set();
  // Page-declared lazy chunks (P0-3). The HTML parse below cannot see a
  // dynamically imported chunk, and on a FIRST boot the SW may not have
  // claimed the client in time to capture it at runtime either — so the page
  // hands us the list. Same-origin /_next/static only: anything else is
  // ignored rather than trusted.
  if (extra && extra.length) {
    for (const raw of extra) {
      let p = null;
      try { p = new URL(raw, self.location.origin); } catch (e) { continue; }
      if (p.origin !== self.location.origin) continue;
      if (p.pathname.indexOf('/_next/static/') !== 0) continue;
      wanted.add(p.pathname);
      // Stamp it as in-use so LATER prunes — including one triggered by a
      // page that did not declare `extra` — keep it too.
      touchShellEntry(p.pathname);
    }
  }
  const routeList = routes && routes.length ? routes : SHELL_ROUTES;
  for (const route of routeList) {
    try {
      const res = await fetch(new Request(route, { cache: 'no-store', credentials: 'same-origin' }));
      if (!res || !res.ok) continue;
      const resForCache = res.clone();
      const html = await res.text();
      const urls = extractShellUrls(html);
      if (urls.length === 0) continue; // not an app document — don't cache it
      // Pin the DOCUMENT alongside its chunks so a cold offline boot has a
      // complete shell. Route path goes into `wanted` so prune keeps it.
      await cache.put(new Request(route, { credentials: 'same-origin' }), resForCache);
      wanted.add(route);
      for (const u of urls) wanted.add(u);
    } catch (e) {
      // Offline boot — keep whatever shell we already have; the page-side
      // idle retry will refresh once the network returns.
    }
  }
  if (wanted.size === 0) {
    await broadcast({ type: 'PRECACHE_SHELL_DONE', count: 0, added: 0 });
    return;
  }
  let added = 0;
  for (const u of wanted) {
    const req = new Request(u, { credentials: 'same-origin' });
    const existing = await cache.match(req);
    if (existing) continue;
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        await cache.put(req, res.clone());
        added += 1;
      }
    } catch (e) {
      // Partial shell is still strictly better than none — hashed URLs
      // mean whatever DID land stays valid forever.
    }
  }
  // Prune entries the current build no longer references — EXCEPT anything
  // captured at runtime and still in recent use (P0-3; see the STEP-3 GUARD
  // note in the header). Without this exception the very next idle
  // PRECACHE_SHELL would delete the lazily-imported renderer chunk, and the
  // following cold offline boot would render a template-less screen.
  const keepRuntime = await recentRuntimeShellPaths();
  const keys = await cache.keys();
  for (const req of keys) {
    try {
      const p = new URL(req.url).pathname;
      if (wanted.has(p) || keepRuntime.has(p)) continue;
      await cache.delete(req);
      await dropShellUseStamp(req.url);
    } catch (e) { /* keep unparseable entries */ }
  }
  await broadcast({ type: 'PRECACHE_SHELL_DONE', count: wanted.size, added });
}

// ─── Large-asset staging (2026-09-26 — the 4K cache-fill incident) ─────────
//
// WHY. A 3840×2160 clip is 135–145 MB. Two things in the old path could not
// survive that on a signage box:
//   1. fetchAndStore verified the digest with `await res.clone().arrayBuffer()`
//      — the WHOLE body in service-worker memory, next to the tee'd copy the
//      cache write consumes. On a 1–2 GB Android WebView that is an OOM kill.
//   2. The whole playlist downloaded inside ONE PRECACHE_PLAYLIST message
//      event. Chromium stops a service worker whose event runs past five
//      minutes (kRequestTimeout, KILL_ON_TIMEOUT). A 141 MB file on a 3 Mbps
//      venue link takes longer than that: the worker died mid-download, the
//      cache stayed EMPTY, the <video> streamed 4K from origin, and the field
//      4K screen dropped 121 of 264 frames (2026-09-25).
//
// NOW. An asset at or above LARGE_ASSET_BYTES is never fetched inside
// PRECACHE_PLAYLIST. The worker reports it as `pending` and the PAGE drives it
// through short, separately-timed events, one Range request at a time:
//   PRECACHE_CHUNK    { url, sha256, size, offset, chunkBytes }
//                     one Range fetch (≤ CHUNK_BYTES_MAX, aborted at
//                     CHUNK_FETCH_TIMEOUT_MS) → its own STAGING entry keyed by
//                     byte range. A chunk already staged at that offset acks
//                     WITHOUT a fetch, so resume after a kill or reload is free.
//   PRECACHE_VERIFY   { url, sha256 }
//                     streams every staged chunk through an incremental
//                     SHA-256 (bounded memory) and compares to the manifest
//                     digest; a mismatch purges the staging.
//   PRECACHE_ASSEMBLE { url, sha256 }
//                     streams the VERIFIED chunks into one PLAYLIST_CACHE entry
//                     (disk → disk, seconds), writes the same meta rows
//                     fetchAndStore writes, drops the staging.
//   CACHE_LOOKUP      { urls: [{ url, sha256 }] }
//                     which of these URLs are cached and current — the page
//                     uses it to prefer a cached 4K file over a fallback.
// No unverified byte ever lands under the real URL. A kill mid-way costs one
// chunk, never the whole file. Memory stays at one stream buffer.
//
// The emergency tier is deliberately NOT routed through this path — its
// never-evict rules live in precacheEmergency and are a separate sign-off.

const LARGE_ASSET_BYTES = 8 * 1024 * 1024;
const CHUNK_BYTES_DEFAULT = 8 * 1024 * 1024;
const CHUNK_BYTES_MIN = 1024 * 1024;
const CHUNK_BYTES_MAX = 32 * 1024 * 1024;
// Under Chromium's five-minute event budget with room for the cache write.
const CHUNK_FETCH_TIMEOUT_MS = 240 * 1000;
const STAGE_PREFIX = '/__edu_stage__/';
const STAGE_INFO_PREFIX = '/__edu_stage_info__/';
const STAGE_OK_PREFIX = '/__edu_stage_ok__/';
const VIDEO_URL_RE = /\.(mp4|m4v|mov|webm|mkv)(\?|#|$)/i;
// In-flight chunk fetches, so two overlapping requests for the same range
// (a reloaded page racing its predecessor) never write the same entry twice.
const STAGE_IN_FLIGHT = new Set();

/** Big enough that the whole-body digest and the single-event download would hurt. */
function isLargeAsset(asset) {
  if (!asset || !asset.url) return false;
  if (typeof asset.size === 'number' && asset.size > 0) return asset.size >= LARGE_ASSET_BYTES;
  return VIDEO_URL_RE.test(String(asset.url));
}

function stageEncodedKey(url) {
  return encodeURIComponent(stableKey(url));
}
function stagePrefixFor(url) {
  return `${STAGE_PREFIX}${stageEncodedKey(url)}/`;
}
function stageChunkKey(url, start, length) {
  return new Request(`${stagePrefixFor(url)}${start}-${length}`);
}
function stageInfoKey(url) {
  return new Request(`${STAGE_INFO_PREFIX}${stageEncodedKey(url)}`);
}
function stageOkKey(url) {
  return new Request(`${STAGE_OK_PREFIX}${stageEncodedKey(url)}`);
}

/** `bytes a-b/total` (total may be `*`). null when absent, unreadable (CORS) or malformed. */
function parseContentRange(header) {
  const m = /^\s*bytes\s+(\d+)-(\d+)\/(\d+|\*)\s*$/i.exec(String(header || ''));
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  const total = m[3] === '*' ? null : Number(m[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
  if (total !== null && (!Number.isSafeInteger(total) || end >= total)) return null;
  return { start, end, total };
}

/**
 * Walk staged chunks from byte 0. Returns the contiguous run and where it
 * stops; `ok` only when it reaches a known total. Overlapping leftovers (a
 * smaller chunk size after a timeout) are skipped, never double-counted.
 */
function contiguousLayout(chunks, total) {
  const sorted = [...chunks].sort((a, b) => a.start - b.start || b.length - a.length);
  const run = [];
  let pos = 0;
  for (const c of sorted) {
    if (c.start < pos) continue; // overlap — already covered
    if (c.start > pos) break; // gap
    if (c.length <= 0) continue;
    run.push(c);
    pos = c.start + c.length;
    if (total !== null && pos >= total) break;
  }
  const ok = total !== null && pos >= total;
  return { ok, chunks: run, nextOffset: pos, total };
}

function parseStagedChunkPath(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  const m = /^(\d+)-(\d+)$/.exec(pathname.slice(prefix.length));
  if (!m) return null;
  const start = Number(m[1]);
  const length = Number(m[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || length <= 0) return null;
  return { start, length };
}

async function listStagedChunks(staging, url) {
  const prefix = stagePrefixFor(url);
  const keys = await staging.keys();
  const out = [];
  for (const req of keys) {
    let pathname;
    try { pathname = new URL(req.url).pathname; } catch (_e) { continue; }
    const parsed = parseStagedChunkPath(pathname, prefix);
    if (parsed) out.push(parsed);
  }
  return out;
}

async function readStageInfo(staging, url) {
  try {
    const res = await staging.match(stageInfoKey(url));
    if (!res) return null;
    const info = await res.json();
    return info && typeof info === 'object' ? info : null;
  } catch (_e) {
    return null;
  }
}

async function writeStageInfo(staging, url, info) {
  await staging.put(
    stageInfoKey(url),
    new Response(JSON.stringify(info), { headers: { 'content-type': 'application/json' } }),
  );
}

async function purgeStaging(staging, url) {
  const prefix = stagePrefixFor(url);
  const keys = await staging.keys();
  for (const req of keys) {
    let pathname;
    try { pathname = new URL(req.url).pathname; } catch (_e) { continue; }
    if (pathname.startsWith(prefix)) await staging.delete(req);
  }
  await staging.delete(stageInfoKey(url));
  await staging.delete(stageOkKey(url));
}

/** Drop staging for every URL that is not in the live manifest set. */
async function purgeStagingExcept(liveStableUrls) {
  const staging = await caches.open(STAGING_CACHE);
  const keep = new Set();
  for (const u of liveStableUrls) keep.add(encodeURIComponent(u));
  const keys = await staging.keys();
  for (const req of keys) {
    let pathname;
    try { pathname = new URL(req.url).pathname; } catch (_e) { continue; }
    let encoded = null;
    if (pathname.startsWith(STAGE_PREFIX)) encoded = pathname.slice(STAGE_PREFIX.length).split('/')[0];
    else if (pathname.startsWith(STAGE_INFO_PREFIX)) encoded = pathname.slice(STAGE_INFO_PREFIX.length);
    else if (pathname.startsWith(STAGE_OK_PREFIX)) encoded = pathname.slice(STAGE_OK_PREFIX.length);
    if (encoded !== null && !keep.has(encoded)) await staging.delete(req);
  }
}

/** Cached and, when the manifest carries a digest, the digest we verified matches it. */
async function isCachedCurrent(asset, cache, meta) {
  if (!asset || !asset.url) return false;
  const req = new Request(asset.url, { mode: 'cors', credentials: 'omit' });
  const cached = await cache.match(req, { ignoreSearch: true });
  if (!cached) return false;
  if (!asset.sha256) return true;
  const storedHashRes = await meta.match(metaKey(asset.url));
  const storedHash = storedHashRes ? await storedHashRes.text() : '';
  return storedHash.toLowerCase() === String(asset.sha256).toLowerCase();
}

async function cacheLookup(msg) {
  const list = Array.isArray(msg && msg.urls) ? msg.urls : [];
  const [cache, meta] = await Promise.all([caches.open(PLAYLIST_CACHE), caches.open(META_CACHE)]);
  const cached = {};
  for (const entry of list) {
    const asset = typeof entry === 'string' ? { url: entry } : entry;
    if (!asset || !asset.url) continue;
    try {
      cached[asset.url] = await isCachedCurrent(asset, cache, meta);
    } catch (_e) {
      cached[asset.url] = false;
    }
  }
  return { ok: true, cached };
}

/** Reply on the message's port; a thrown error becomes an honest `{ ok: false }`. */
async function answerPort(event, work) {
  const port = (event.ports && event.ports[0]) || null;
  let reply;
  try {
    reply = await work();
  } catch (e) {
    reply = { ok: false, reason: (e && e.message) || 'error' };
  }
  if (port) {
    try { port.postMessage(reply); } catch (_e) { /* page may have reloaded */ }
  }
  return reply;
}

/**
 * Store one chunk body: stream it to a temporary entry, measure what actually
 * landed (a body that ended early must never masquerade as a full chunk), then
 * copy it under its byte-range key. `Response.blob()` on a cache-backed body is
 * a handle in Chromium, not a read, so this is a disk-to-disk copy of a few MB.
 */
async function storeStagedChunk(staging, url, start, res, contentType) {
  const tmpKey = new Request(`${stagePrefixFor(url)}tmp`);
  await staging.put(tmpKey, new Response(res.body, { status: 200, headers: { 'content-type': contentType } }));
  const tmp = await staging.match(tmpKey);
  const blob = tmp ? await tmp.blob() : null;
  const length = blob ? blob.size : 0;
  if (!blob || length <= 0) {
    await staging.delete(tmpKey);
    throw new Error('empty-chunk');
  }
  await staging.put(
    stageChunkKey(url, start, length),
    new Response(blob, { status: 200, headers: { 'content-type': contentType, 'content-length': String(length) } }),
  );
  await staging.delete(tmpKey);
  return length;
}

async function stageChunk(msg) {
  const url = msg && typeof msg.url === 'string' ? msg.url : '';
  if (!url) return { ok: false, reason: 'bad-request' };
  const offset = Number.isSafeInteger(msg.offset) && msg.offset >= 0 ? msg.offset : 0;
  const want = Math.max(CHUNK_BYTES_MIN, Math.min(CHUNK_BYTES_MAX,
    Number.isSafeInteger(msg.chunkBytes) && msg.chunkBytes > 0 ? msg.chunkBytes : CHUNK_BYTES_DEFAULT));
  const knownSize = Number.isSafeInteger(msg.size) && msg.size > 0 ? msg.size : null;
  const staging = await caches.open(STAGING_CACHE);
  const info = await readStageInfo(staging, url);
  if (info && knownSize !== null && info.total && info.total !== knownSize) {
    // The manifest now describes a different file than the one we started.
    await purgeStaging(staging, url);
    return { ok: false, reason: 'size-mismatch', offset };
  }
  let total = info && Number.isSafeInteger(info.total) && info.total > 0 ? info.total : knownSize;

  // Resume: a chunk already staged at this offset needs no network.
  const have = await listStagedChunks(staging, url);
  const existing = have.filter((c) => c.start === offset).sort((a, b) => b.length - a.length)[0];
  if (existing) {
    const next = offset + existing.length;
    return { ok: true, offset, nextOffset: next, total, complete: total !== null && next >= total, staged: true };
  }
  if (total !== null && offset >= total) {
    return { ok: true, offset, nextOffset: offset, total, complete: true, staged: true };
  }

  const lockKey = `${stableKey(url)}@${offset}`;
  if (STAGE_IN_FLIGHT.has(lockKey)) return { ok: false, reason: 'busy', offset };
  STAGE_IN_FLIGHT.add(lockKey);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => { try { if (controller) controller.abort(); } catch (_e) { /* noop */ } }, CHUNK_FETCH_TIMEOUT_MS);
  try {
    const end = total !== null ? Math.min(offset + want, total) - 1 : offset + want - 1;
    const req = new Request(url, { mode: 'cors', credentials: 'omit', headers: { Range: `bytes=${offset}-${end}` } });
    let res;
    try {
      res = await fetch(req, controller ? { signal: controller.signal } : undefined);
    } catch (e) {
      return { ok: false, reason: e && e.name === 'AbortError' ? 'fetch-timeout' : 'network', offset };
    }
    if (res.status === 416) {
      // Past the end. With no total announced yet, a contiguous run up to this
      // offset IS the whole file (an exact multiple of the chunk size).
      if (total === null && offset > 0 && contiguousLayout(have, offset).ok) {
        await writeStageInfo(staging, url, { ...(info || {}), total: offset });
        return { ok: true, offset, nextOffset: offset, total: offset, complete: true, staged: true };
      }
      await purgeStaging(staging, url);
      return { ok: false, reason: 'range-not-satisfiable', offset };
    }
    if (res.status === 200 && offset !== 0) {
      // The server ignored Range. Only a from-zero request can use a full body.
      await purgeStaging(staging, url);
      return { ok: false, reason: 'range-unsupported', offset };
    }
    if (res.status !== 206 && res.status !== 200) {
      return { ok: false, reason: `http-${res.status}`, offset };
    }
    const contentType = res.headers.get('content-type') || (info && info.contentType) || 'application/octet-stream';
    const lastModified = res.headers.get('last-modified') || '';
    if (info && info.lastModified && lastModified && info.lastModified !== lastModified) {
      await purgeStaging(staging, url);
      return { ok: false, reason: 'source-changed', offset };
    }
    let expected = null;
    if (res.status === 206) {
      const cr = parseContentRange(res.headers.get('content-range'));
      if (cr) {
        if (cr.start !== offset) {
          await purgeStaging(staging, url);
          return { ok: false, reason: 'range-mismatch', offset };
        }
        if (cr.total !== null) {
          if (total !== null && cr.total !== total) {
            await purgeStaging(staging, url);
            return { ok: false, reason: 'size-mismatch', offset };
          }
          total = cr.total;
        }
        expected = cr.end - cr.start + 1;
      } else if (total !== null) {
        expected = Math.min(want, total - offset);
      }
    } else {
      // 200 from offset 0: the whole file in one body.
      const cl = Number(res.headers.get('content-length') || 0);
      if (cl > 0) {
        if (total !== null && cl !== total) {
          await purgeStaging(staging, url);
          return { ok: false, reason: 'size-mismatch', offset };
        }
        total = cl;
        expected = cl;
      }
    }
    let stored;
    try {
      stored = await storeStagedChunk(staging, url, offset, res, contentType);
    } catch (e) {
      return { ok: false, reason: e && e.name === 'AbortError' ? 'fetch-timeout' : 'truncated', offset };
    }
    if (expected !== null && stored !== expected) {
      if (res.status === 206 && total === null && stored < expected) {
        total = offset + stored; // short final chunk with no total announced
      } else {
        await staging.delete(stageChunkKey(url, offset, stored));
        return { ok: false, reason: 'truncated', offset };
      }
    }
    if (total === null) {
      if (res.status === 200) total = offset + stored;
      else if (stored < want) total = offset + stored; // short chunk = end of file
    }
    if (total !== null && offset + stored > total) {
      await purgeStaging(staging, url);
      return { ok: false, reason: 'size-mismatch', offset };
    }
    const nextInfo = { total, contentType, lastModified: lastModified || (info && info.lastModified) || '' };
    if (!info || info.total !== nextInfo.total || info.contentType !== nextInfo.contentType || info.lastModified !== nextInfo.lastModified) {
      await writeStageInfo(staging, url, nextInfo);
    }
    const next = offset + stored;
    return { ok: true, offset, nextOffset: next, total, complete: total !== null && next >= total };
  } finally {
    clearTimeout(timer);
    STAGE_IN_FLIGHT.delete(lockKey);
  }
}

async function pumpStream(stream, onBytes) {
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    if (value && value.length) onBytes(value);
  }
}

function isSha256Hex(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value);
}

async function verifyStaged(msg) {
  const url = msg && typeof msg.url === 'string' ? msg.url : '';
  if (!url) return { ok: false, reason: 'bad-request' };
  const expected = isSha256Hex(msg.sha256) ? msg.sha256.toLowerCase() : null;
  const staging = await caches.open(STAGING_CACHE);
  const info = await readStageInfo(staging, url);
  const total = info && Number.isSafeInteger(info.total) && info.total > 0 ? info.total : null;
  const layout = contiguousLayout(await listStagedChunks(staging, url), total);
  if (!layout.ok) return { ok: false, reason: 'incomplete', nextOffset: layout.nextOffset, total };
  if (expected) {
    const hasher = new Sha256();
    for (const c of layout.chunks) {
      const res = await staging.match(stageChunkKey(url, c.start, c.length));
      if (!res || !res.body) return { ok: false, reason: 'incomplete', nextOffset: c.start, total };
      await pumpStream(res.body, (bytes) => hasher.update(bytes));
    }
    if (hasher.digestHex() !== expected) {
      // Wrong bytes must never be promoted, and never be reused either.
      await purgeStaging(staging, url);
      console.warn('[sw-player] staged download failed SHA-256, discarded', { url });
      return { ok: false, reason: 'sha256-mismatch' };
    }
  }
  await staging.put(
    stageOkKey(url),
    new Response(JSON.stringify({ sha256: expected, total: layout.total }), { headers: { 'content-type': 'application/json' } }),
  );
  return { ok: true, total: layout.total, verified: !!expected };
}

async function assembleStaged(msg) {
  const url = msg && typeof msg.url === 'string' ? msg.url : '';
  if (!url) return { ok: false, reason: 'bad-request' };
  const expected = isSha256Hex(msg.sha256) ? msg.sha256.toLowerCase() : null;
  const staging = await caches.open(STAGING_CACHE);
  let marker = null;
  try {
    const okRes = await staging.match(stageOkKey(url));
    marker = okRes ? await okRes.json() : null;
  } catch (_e) { marker = null; }
  // Only bytes PRECACHE_VERIFY passed for THIS digest may become the served file.
  if (!marker || !Number.isSafeInteger(marker.total) || (expected && marker.sha256 !== expected) || (!expected && marker.sha256)) {
    return { ok: false, reason: 'not-verified' };
  }
  const info = await readStageInfo(staging, url);
  const layout = contiguousLayout(await listStagedChunks(staging, url), marker.total);
  if (!layout.ok) return { ok: false, reason: 'incomplete', nextOffset: layout.nextOffset, total: marker.total };
  const [cache, meta] = await Promise.all([caches.open(PLAYLIST_CACHE), caches.open(META_CACHE)]);
  const parts = layout.chunks;
  let index = 0;
  let reader = null;
  const body = new ReadableStream({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          if (index >= parts.length) { controller.close(); return; }
          const part = parts[index];
          index += 1;
          const res = await staging.match(stageChunkKey(url, part.start, part.length));
          if (!res || !res.body) throw new Error('chunk-missing');
          reader = res.body.getReader();
        }
        const { done, value } = await reader.read();
        if (done) { reader = null; continue; }
        controller.enqueue(value);
        return;
      }
    },
    cancel() {
      try { if (reader) reader.cancel(); } catch (_e) { /* noop */ }
    },
  });
  const headers = {
    'content-type': (info && info.contentType) || 'application/octet-stream',
    'content-length': String(layout.total),
    'accept-ranges': 'bytes',
  };
  const req = new Request(url, { mode: 'cors', credentials: 'omit' });
  await cache.put(req, new Response(body, { status: 200, headers }));
  // The same records fetchAndStore writes, so status sums, hash checks and the
  // bounded revalidation treat this entry exactly like a directly fetched one.
  const norm = normalizeUrl(url);
  SIZE_BY_URL.set(norm, layout.total);
  await meta.put(sizeMetaKey(url), new Response(String(layout.total), { headers: { 'content-type': 'text/plain' } }));
  if (expected) {
    await meta.put(metaKey(url), new Response(expected, { headers: { 'content-type': 'text/plain' } }));
  }
  try {
    await meta.put(storedAtMetaKey(url), new Response(String(Date.now()), { headers: { 'content-type': 'text/plain' } }));
  } catch (_e) { /* meta write best-effort */ }
  await purgeStaging(staging, url);
  return { ok: true, total: layout.total };
}

// ─── Incremental SHA-256 (FIPS 180-4) ───────────────────────────────────────
// crypto.subtle.digest needs the whole message in one buffer, which is the
// exact allocation that killed the worker on a 141 MB file. This hashes a
// stream 64 bytes at a time; the unit test checks it against node:crypto.
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** The two 32-bit words of the padded bit length (messages past 512 MiB need the high word). */
function sha256LengthWords(lengthBytes) {
  const hi = Math.floor(lengthBytes / 0x20000000); // bytes / 2^29 = bits / 2^32
  const lo = (lengthBytes % 0x20000000) * 8;
  return [hi >>> 0, lo >>> 0];
}

class Sha256 {
  constructor() {
    this.h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    this.w = new Uint32Array(64);
    this.buffer = new Uint8Array(64);
    this.buffered = 0;
    this.lengthBytes = 0;
    this.finished = false;
  }

  update(input) {
    if (this.finished) throw new Error('sha256-finished');
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let i = 0;
    this.lengthBytes += bytes.length;
    if (this.buffered > 0) {
      const take = Math.min(64 - this.buffered, bytes.length);
      this.buffer.set(bytes.subarray(0, take), this.buffered);
      this.buffered += take;
      i = take;
      if (this.buffered < 64) return this;
      this.block(this.buffer, 0);
      this.buffered = 0;
    }
    for (; i + 64 <= bytes.length; i += 64) this.block(bytes, i);
    if (i < bytes.length) {
      this.buffer.set(bytes.subarray(i));
      this.buffered = bytes.length - i;
    }
    return this;
  }

  block(bytes, offset) {
    const w = this.w;
    for (let t = 0; t < 16; t++) {
      const j = offset + t * 4;
      w[t] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const x = w[t - 15];
      const y = w[t - 2];
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    const h = this.h;
    let a = h[0]; let b = h[1]; let c = h[2]; let d = h[3];
    let e = h[4]; let f = h[5]; let g = h[6]; let hh = h[7];
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }

  digestHex() {
    if (!this.finished) {
      const [hi, lo] = sha256LengthWords(this.lengthBytes);
      const pad = new Uint8Array(this.buffered < 56 ? 64 - this.buffered : 128 - this.buffered);
      pad[0] = 0x80;
      const n = pad.length;
      pad[n - 8] = hi >>> 24; pad[n - 7] = (hi >>> 16) & 0xff; pad[n - 6] = (hi >>> 8) & 0xff; pad[n - 5] = hi & 0xff;
      pad[n - 4] = lo >>> 24; pad[n - 3] = (lo >>> 16) & 0xff; pad[n - 2] = (lo >>> 8) & 0xff; pad[n - 1] = lo & 0xff;
      const savedLength = this.lengthBytes;
      this.update(pad);
      this.lengthBytes = savedLength;
      this.finished = true;
    }
    let out = '';
    for (let i = 0; i < 8; i++) out += this.h[i].toString(16).padStart(8, '0');
    return out;
  }
}

// ─── Pre-cache a list of playlist assets, evicting LRU over the soft cap ───
async function precachePlaylist(assets, softCapBytes, ackPort) {
  const cache = await caches.open(PLAYLIST_CACHE);
  const meta = await caches.open(META_CACHE);
  const liveUrls = new Set(assets.map((a) => normalizeUrl(a.url)));

  // 1. Evict entries no longer referenced by the live manifest (LRU within
  // the new manifest scope).
  const existing = await cache.keys();
  for (const req of existing) {
    if (!liveUrls.has(normalizeUrl(req.url))) {
      await cache.delete(req);
      await meta.delete(metaKey(req.url));
      await meta.delete(sizeMetaKey(req.url));
      SIZE_BY_URL.delete(normalizeUrl(req.url));
    }
  }

  // 1b. Half-downloaded files for URLs that left the manifest are dead weight.
  try { await purgeStagingExcept(liveUrls); } catch (_e) { /* best-effort */ }

  // 2. Pre-fetch missing assets, respecting hash changes. Emit a
  //    progress event per completed asset so the splash can show a
  //    real download bar instead of an indeterminate pulse.
  //
  //    A LARGE asset (2026-09-26) is never downloaded inside this event: the
  //    whole playlist used to fetch under ONE waitUntil, and one 4K clip on a
  //    slow venue link outlived Chromium's five-minute event budget — the
  //    worker was stopped mid-download and the cache stayed empty. Such an
  //    asset is reported back as `pending`; the page then drives it through
  //    PRECACHE_CHUNK / PRECACHE_VERIFY / PRECACHE_ASSEMBLE, each a short,
  //    separately-timed event. An already-cached large asset counts as done.
  let loaded = 0;
  let failures = 0;
  const pending = [];
  for (const asset of assets) {
    if (isLargeAsset(asset)) {
      if (await isCachedCurrent(asset, cache, meta)) {
        loaded += 1;
      } else {
        pending.push({ url: asset.url, sha256: asset.sha256 || null, size: asset.size || null });
      }
    } else {
      if (!(await fetchAndStore(asset, cache, meta))) failures += 1;
      loaded += 1;
    }
    await broadcast({
      type: 'PRECACHE_PROGRESS',
      tier: 'playlist',
      loaded,
      total: assets.length,
      currentItem: asset.url ? asset.url.split('/').pop() : null,
    });
  }

  // 3. Honor soft cap by evicting oldest. We don't track real LRU, so we
  // approximate: iterate in insertion order and drop until under cap.
  let total = await sumCacheBytes(cache);
  if (total > softCapBytes) {
    const keys = await cache.keys();
    for (const req of keys) {
      if (total <= softCapBytes) break;
      const sz = await getCachedEntrySize(req, cache, meta);
      await cache.delete(req);
      await meta.delete(metaKey(req.url));
      await meta.delete(sizeMetaKey(req.url));
      SIZE_BY_URL.delete(normalizeUrl(req.url));
      total -= sz;
    }
  }

  // `ok` means every live asset is in the cache right now. Large files the
  // page still has to drive are `pending` — not failures, not done.
  const result = { ok: failures === 0 && pending.length === 0, failures, count: assets.length, pending };
  if (ackPort) {
    try { ackPort.postMessage(result); } catch (_e) { /* page may have reloaded */ }
  }
  await broadcast({ type: 'PRECACHE_PLAYLIST_DONE', ok: result.ok, failures, count: assets.length, pending: pending.length, totalBytes: total });
}

// ─── Pre-cache emergency assets — never evicted, hash-versioned ───
async function precacheEmergency(assets, setHash, ackPort) {
  // ── 2026-08-30 deep-audit F5 — AN EMPTY LIST IS "NO DATA", NEVER "WIPE". ──
  // The prune loop below deletes every cached entry not in `liveUrls`; with
  // an empty payload that is EVERYTHING in the never-evict emergency tier.
  // Worse, an empty list has zero failures, so the set-hash committed and
  // the page's short-circuit then suppressed retries — a wiped tier that
  // LATCHED. A tenant with no emergency assets configured simply gets no
  // pushes; an intentional clear must ship an explicit signal, not an
  // absence. Refuse the whole operation and tell the page it did not stick.
  if (!Array.isArray(assets) || assets.length === 0) {
    if (ackPort) {
      try { ackPort.postMessage({ ok: false, emptyPayload: true, failures: 0, count: 0 }); } catch (e) { /* best-effort */ }
    }
    return;
  }
  const cache = await caches.open(EMERGENCY_CACHE);
  const meta = await caches.open(META_CACHE);

  // FIX (player-001): do NOT write the set-hash before downloads finish.
  // If we did and a download was interrupted, the next sync would see the
  // matching hash and skip re-pushing forever — emergency cache silently
  // broken until the manifest URL changes. We defer the setHash write
  // until every asset is confirmed in cache.

  // Evict assets no longer in the set (admin removed an emergency asset).
  const liveUrls = new Set(assets.map((a) => normalizeUrl(a.url)));
  const existing = await cache.keys();
  for (const req of existing) {
    if (!liveUrls.has(normalizeUrl(req.url))) {
      await cache.delete(req);
      await meta.delete(metaKey(req.url));
      await meta.delete(sizeMetaKey(req.url));
      SIZE_BY_URL.delete(normalizeUrl(req.url));
    }
  }

  // Fetch + store. Track success per asset so we can decide whether to
  // commit the set-hash. Emit per-asset progress for the splash bar.
  let loaded = 0;
  let failures = 0;
  for (const asset of assets) {
    // F4 (2026-08-30): the EMERGENCY tier opts OUT of the 24h null-hash
    // revalidation — with no hash to verify, a refetch through a captive
    // portal could REPLACE good alert media with a portal page. For this
    // tier "cached means current" stays the rule; server-side rotation of
    // the asset URL is the refresh mechanism.
    const ok = await fetchAndStore(asset, cache, meta, { boundedRevalidation: false });
    if (!ok) failures += 1;
    loaded += 1;
    await broadcast({
      type: 'PRECACHE_PROGRESS',
      tier: 'emergency',
      loaded,
      total: assets.length,
      currentItem: asset.url ? asset.url.split('/').pop() : null,
    });
  }

  // Only commit the set-hash if every asset is verified in cache. Verifying
  // by re-checking cache.match() catches the edge case where fetchAndStore
  // returned true but the entry was evicted between then and now.
  let allCached = failures === 0;
  if (allCached) {
    for (const asset of assets) {
      if (!asset?.url) continue;
      // FIX (player-005): ignoreSearch so token rotation doesn't make a
      // freshly-cached asset look "missing" on the verification pass.
      const present = await cache.match(
        new Request(asset.url, { mode: 'cors', credentials: 'omit' }),
        { ignoreSearch: true },
      );
      if (!present) { allCached = false; break; }
    }
  }

  if (allCached) {
    await meta.put(
      new Request('/__edu_emergency_set_hash__'),
      new Response(setHash || '', { headers: { 'content-type': 'text/plain' } })
    );
  } else {
    // Leave the stored hash unset (or as it was) so the next sync retries
    // the full precache instead of short-circuiting on a hash match.
    console.warn('[SW] emergency cache partial — will retry on next sync');
  }

  const total = await sumCacheBytes(cache);
  await broadcast({
    type: 'PRECACHE_EMERGENCY_DONE',
    count: assets.length,
    totalBytes: total,
    complete: allCached,
    failures,
  });

  // FIX (player-014): ack the page-side caller via the MessageChannel
  // port so the page commits its lastEmergencySetHashRef ONLY when we
  // confirm allCached. Without this ack the page used to optimistically
  // commit the ref before the SW finished, and a partial-download path
  // would short-circuit the next 5-min retry forever.
  if (ackPort) {
    try {
      ackPort.postMessage({ ok: allCached, failures, count: assets.length });
    } catch (e) {
      // Port may have been closed by the page (rare). Best-effort.
    }
  }
}

async function fetchAndStore(asset, cache, meta, opts) {
  if (!asset?.url) return false;
  // F4 (2026-08-30): tiers can opt out of the 24h null-hash revalidation —
  // the emergency tier does, because an unverifiable refetch must never be
  // able to replace known-good alert media (see precacheEmergency).
  const boundedRevalidation = !opts || opts.boundedRevalidation !== false;
  const req = new Request(asset.url, { mode: 'cors', credentials: 'omit' });
  const norm = normalizeUrl(asset.url);

  // If we already have it AND the hash matches, skip — but ensure we have a
  // size record (cold-boot SW may have lost the in-memory map).
  // FIX (player-005): use ignoreSearch so a rotated `?token=...` on the
  // manifest URL still matches the previously-cached entry stored under
  // the old token. Without this, every token rotation looked like a fresh
  // asset and we re-downloaded the whole playlist hourly.
  const storedHashRes = await meta.match(metaKey(asset.url));
  const storedHash = storedHashRes ? await storedHashRes.text() : '';
  const cached = await cache.match(req, { ignoreSearch: true });
  // P0-1 (2026-05-28): a manifest entry may legitimately carry no sha256
  // (server ships `sha256: null` for assets the upload pipeline never hashed
  // — legacy / external-URL rows). For those we have no body hash to compare
  // against, so "already cached" alone means up-to-date. Without this branch a
  // null-hash asset would re-download on every 5-min emergency sync forever
  // (fleet-wide egress). When a real hash IS present we keep requiring an
  // exact storedHash match (unchanged behavior).
  const hasHash = !!asset.sha256;
  // 2026-08-30 (audit P1-8) — BOUNDED revalidation for null-hash assets.
  // With a real hash, freshness is proven by digest equality (unchanged
  // below). With NO hash there is nothing to compare, and the old rule —
  // "cached means current forever" — let a same-path byte replacement
  // (legacy/external rows) serve stale bytes indefinitely. Null-hash
  // entries now expire after 24 h and refetch; if the refetch FAILS the
  // cached copy stays in place (fetch failure below never evicts), so
  // offline resilience is unchanged — this only bounds staleness while the
  // network is up. Entries cached before this shipped have no stored-at
  // stamp and revalidate once, then are stamped.
  let nullHashFresh = true;
  if (cached && !hasHash && boundedRevalidation) {
    try {
      const storedAtRes = await meta.match(storedAtMetaKey(asset.url));
      const storedAtMs = storedAtRes ? Number(await storedAtRes.text()) : NaN;
      nullHashFresh = Number.isFinite(storedAtMs) &&
        Date.now() - storedAtMs < 24 * 60 * 60 * 1000;
    } catch (_e) {
      nullHashFresh = true; // meta unreadable — keep old behavior, never thrash
    }
  }
  const upToDate = cached && (hasHash ? storedHash === asset.sha256 : nullHashFresh);
  if (upToDate) {
    if (!SIZE_BY_URL.has(norm)) {
      const sz = await measureResponseSize(cached, asset);
      if (sz > 0) {
        SIZE_BY_URL.set(norm, sz);
        await meta.put(
          sizeMetaKey(asset.url),
          new Response(String(sz), { headers: { 'content-type': 'text/plain' } })
        );
      }
    }
    return true; // up to date
  }

  try {
    const res = await fetch(req);
    if (!res.ok) return false;
    // Deepest-audit E-P0-04, normal-tier half (2026-08-30): when this is a
    // REPLACEMENT of an existing null-hash entry (the bounded-revalidation
    // path — no digest exists to verify), a captive portal / proxy that
    // answers 200 text/html must not overwrite real media bytes. Media may
    // legitimately change bytes at the same path; it does not legitimately
    // change SPECIES to an HTML document.
    if (cached && !hasHash) {
      const oldType = String(cached.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const newType = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const oldFamily = oldType.split('/')[0];
      const isMediaFamily = oldFamily === 'image' || oldFamily === 'video' || oldFamily === 'audio';
      const looksLikePortal = newType === 'text/html' || newType === 'text/plain';
      if (isMediaFamily && looksLikePortal) {
        // eslint-disable-next-line no-console
        console.warn('[sw-player] revalidation returned an HTML/text document for a media asset — keeping the verified bytes', { url: asset.url, oldType, newType });
        return true; // the cached copy remains the served truth
      }
    }
    // SECURITY (lane-3 P2 fix): actually verify the SHA-256 of the response
    // body before accepting it into cache. The previous logic only compared
    // the manifest's stored hash to itself ("did this round's manifest ship
    // the same hash as last round?"), so a manifest-controlling attacker
    // could swap content silently. Here we recompute the digest from the
    // bytes we just received and refuse to cache on mismatch.
    //
    // P0-1 (2026-05-28): the `asset.sha256` guard is load-bearing. The server
    // now ships `sha256: null` for assets it could not hash (legacy /
    // external-URL rows) — for those we cache the body WITHOUT integrity
    // verification, because we have no trusted hash to check against and
    // computing a digest just to compare it to nothing (or to a fabricated
    // URL-derived value, the old bug) would reject every such asset and break
    // emergency caching. Real-hash assets still get full SHA-256 verification.
    // Do NOT remove this guard or change it to verify when sha256 is null.
    if (asset.sha256 && self.crypto && self.crypto.subtle && self.crypto.subtle.digest) {
      try {
        const probe = res.clone();
        const buf = await probe.arrayBuffer();
        const dig = await self.crypto.subtle.digest('SHA-256', buf);
        const view = new Uint8Array(dig);
        let actual = '';
        for (let i = 0; i < view.length; i++) actual += view[i].toString(16).padStart(2, '0');
        const expected = String(asset.sha256).toLowerCase();
        if (actual !== expected) {
          // Refuse to cache — leave any prior cached version in place.
          // eslint-disable-next-line no-console
          console.warn('[sw-player] SHA-256 mismatch, refusing cache', { url: asset.url });
          return false;
        }
      } catch (_e) {
        // Hash failed (corrupt body / SubtleCrypto unavailable on this WebView).
        // Conservatively refuse — better to miss a cache than accept un-verified bytes.
        return false;
      }
    }
    await cache.put(req, res.clone());
    // FIX (player-002): measure size NOW from the body (or asset.size), not
    // later from a missing content-length header. We clone the response to
    // read the blob without disturbing the cached copy. Cost is one-time
    // per fetch, then memoized in SIZE_BY_URL + META_CACHE.
    const sz = await measureResponseSize(res, asset);
    if (sz > 0) {
      SIZE_BY_URL.set(norm, sz);
      await meta.put(
        sizeMetaKey(asset.url),
        new Response(String(sz), { headers: { 'content-type': 'text/plain' } })
      );
    }
    if (asset.sha256) {
      await meta.put(
        metaKey(asset.url),
        new Response(asset.sha256, { headers: { 'content-type': 'text/plain' } })
      );
    }
    // Stamp fetch time for the null-hash bounded revalidation (P1-8). Written
    // for every asset (cheap, one tiny meta row) so a row whose hash later
    // disappears server-side still has a freshness anchor.
    try {
      await meta.put(
        storedAtMetaKey(asset.url),
        new Response(String(Date.now()), { headers: { 'content-type': 'text/plain' } })
      );
    } catch (_e) { /* meta write best-effort */ }
    return true;
  } catch (e) {
    // Best-effort — leave any prior cached version in place. Caller treats
    // the false return as a partial-cache signal.
    console.warn('[sw-player] asset cache failed', { reason: e && e.name || 'unknown' });
    return false;
  }
}

// Best-effort size measurement. Prefers the asset.size hint from the
// manifest (free, no clone), then a legitimate content-length when present
// (same-origin /_next assets), then a body clone as a last resort. Reading
// .blob() on a cached entry is cheap (no network) — the cost matters only
// for fresh fetches and we already have the response in hand there.
async function measureResponseSize(res, asset) {
  if (asset && typeof asset.size === 'number' && asset.size > 0) return asset.size;
  const cl = Number(res.headers.get('content-length') || 0);
  if (cl > 0) return cl;
  try {
    const blob = await res.clone().blob();
    return blob.size || 0;
  } catch (e) {
    return 0;
  }
}

async function replyStatus(client) {
  if (!client) return;
  const [pl, em, sh] = await Promise.all([
    caches.open(PLAYLIST_CACHE), caches.open(EMERGENCY_CACHE), caches.open(SHELL_CACHE),
  ]);
  const [plKeys, emKeys, shKeys, plBytes, emBytes, shBytes] = await Promise.all([
    pl.keys(), em.keys(), sh.keys(), sumCacheBytes(pl), sumCacheBytes(em), sumCacheBytes(sh),
  ]);
  client.postMessage({
    type: 'STATUS_REPLY',
    playlist: { count: plKeys.length, bytes: plBytes },
    emergency: { count: emKeys.length, bytes: emBytes, floorBytes: EMERGENCY_FLOOR_BYTES },
    shell: { count: shKeys.length, bytes: shBytes },
  });
}

async function clearCache(tier) {
  if (tier === 'all' || tier === 'playlist') await caches.delete(PLAYLIST_CACHE);
  if (tier === 'all' || tier === 'emergency') await caches.delete(EMERGENCY_CACHE);
  if (tier === 'all' || tier === 'shell') await caches.delete(SHELL_CACHE);
  if (tier === 'all') await caches.delete(META_CACHE);
}

// FIX (player-002): content-length is missing on Supabase / opaque / CORS
// responses, so summing it always returned 0 and the soft cap never fired.
// We use SIZE_BY_URL (populated at fetch time from blob().size or the
// manifest's size hint), then fall back to META_CACHE for cold-boot SWs,
// then to a one-time blob clone if nothing else is recorded.
async function sumCacheBytes(cache) {
  const keys = await cache.keys();
  let total = 0;
  // Open META_CACHE once per call so we can hydrate SIZE_BY_URL after a
  // cold boot without paying for it on every entry.
  const meta = await caches.open(META_CACHE);
  for (const req of keys) {
    total += await getCachedEntrySize(req, cache, meta);
  }
  return total;
}

async function getCachedEntrySize(req, cache, meta) {
  const norm = normalizeUrl(req.url);
  const inMemory = SIZE_BY_URL.get(norm);
  if (inMemory && inMemory > 0) return inMemory;

  // Hydrate from META_CACHE if the SW restarted.
  const sizeRes = await meta.match(sizeMetaKey(req.url));
  if (sizeRes) {
    const stored = Number((await sizeRes.text()) || 0);
    if (stored > 0) {
      SIZE_BY_URL.set(norm, stored);
      return stored;
    }
  }

  // Last resort: clone the cached body. One-time cost per URL; we memoize
  // the result so the next sumCacheBytes() call is O(1) per entry.
  const res = await cache.match(req);
  if (!res) return 0;
  const cl = Number(res.headers.get('content-length') || 0);
  if (cl > 0) {
    SIZE_BY_URL.set(norm, cl);
    await meta.put(
      sizeMetaKey(req.url),
      new Response(String(cl), { headers: { 'content-type': 'text/plain' } })
    );
    return cl;
  }
  try {
    const sz = (await res.clone().blob()).size || 0;
    if (sz > 0) {
      SIZE_BY_URL.set(norm, sz);
      await meta.put(
        sizeMetaKey(req.url),
        new Response(String(sz), { headers: { 'content-type': 'text/plain' } })
      );
    }
    return sz;
  } catch (e) {
    return 0;
  }
}

async function broadcast(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of clients) c.postMessage(msg);
}

function metaKey(url) {
  // FIX (player-005): key meta entries by the STABLE form so they survive
  // Supabase signed-URL token rotation. Same asset = same meta record
  // regardless of which `?token=` revision the manifest currently shows.
  return new Request(`/__edu_meta__/${encodeURIComponent(stableKey(url))}`);
}

// 2026-08-30 (reliability program / audit P1-8) — when the asset was last
// fetched from the network. Backs the bounded revalidation of NULL-HASH
// assets: with no trusted digest, "already cached" used to mean "current
// forever", so a legacy/external asset replaced in place at the same path
// could serve stale bytes for the life of the cache.
function storedAtMetaKey(url) {
  return new Request(`/__edu_meta_stored_at__/${encodeURIComponent(stableKey(url))}`);
}

function sizeMetaKey(url) {
  return new Request(`${SIZE_META_PREFIX}${encodeURIComponent(stableKey(url))}`);
}

// FIX (player-005): stableKey is the cache-dedupe identity for an asset.
// Supabase signed URLs append a `?token=...` that rotates ~hourly; if we
// keyed by the full URL, every manifest poll would see "new" URLs for the
// same asset and the playlist precache would wipe + re-download the whole
// fleet's worth of assets every hour. We strip the query (and hash) so
// `https://x/y/foo.mp4?token=abc` and `...?token=def` collapse to the same
// key. The actual fetch + cache.put still uses the full signed URL — only
// the dedupe / eviction / size maps key on this stripped form.
function stableKey(u) {
  try {
    const p = new URL(u, self.location.origin);
    p.search = '';
    p.hash = '';
    return p.toString();
  } catch { return String(u || '').split('?')[0].split('#')[0]; }
}

// normalizeUrl is now an alias for stableKey — kept as a separate name so
// future work can re-introduce a query-preserving normalize if a non-
// Supabase asset class ever needs token-aware dedupe.
function normalizeUrl(u) {
  return stableKey(u);
}

function stripQuery(u) {
  return stableKey(u);
}

// Test hooks for the large-asset staging path (2026-09-26). Class declarations
// are not hoisted, so these are attached at the end of the file rather than in
// the block near the top. No effect in a real service worker.
if (typeof self !== 'undefined') {
  self.__swTestHooks = Object.assign(self.__swTestHooks || {}, {
    Sha256: Sha256,
    sha256LengthWords: sha256LengthWords,
    parseContentRange: parseContentRange,
    contiguousLayout: contiguousLayout,
    isLargeAsset: isLargeAsset,
    LARGE_ASSET_BYTES: LARGE_ASSET_BYTES,
    CHUNK_FETCH_TIMEOUT_MS: CHUNK_FETCH_TIMEOUT_MS,
    STAGING_CACHE: STAGING_CACHE,
    PLAYLIST_CACHE: PLAYLIST_CACHE,
    META_CACHE: META_CACHE,
  });
}
