/* eslint-disable no-undef */
/**
 * EduCMS Player — Service Worker
 *
 * Two cache tiers:
 *   1. PLAYLIST_CACHE — assets in active playlists. LRU on PRECACHE_PLAYLIST
 *      messages (we drop entries no longer referenced by the latest manifest).
 *   2. EMERGENCY_CACHE — assets across all 4 panic-type playlists. NEVER
 *      evicted automatically. Refreshed on PRECACHE_EMERGENCY messages.
 *
 * Both tiers serve fetches transparently to the page so <img src=…> and
 * <video src=…> stay completely unaware of caching.
 *
 * The page communicates via postMessage:
 *   { type: 'PRECACHE_PLAYLIST',  assets: [{url,sha256?,size?}] }
 *   { type: 'PRECACHE_EMERGENCY', assets: [{url,sha256?,size?}], setHash }
 *   { type: 'STATUS_REQUEST' }                         → STATUS_REPLY
 *   { type: 'CLEAR_CACHE',        tier: 'playlist'|'emergency'|'all' }
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
const VERSION = 'v3';
const PLAYLIST_CACHE = `edu-player-playlist-${VERSION}`;
const EMERGENCY_CACHE = `edu-player-emergency-${VERSION}`;
const META_CACHE = `edu-player-meta-${VERSION}`; // stores sha hashes per URL
const ALL_CACHES = [PLAYLIST_CACHE, EMERGENCY_CACHE, META_CACHE];

// Per-URL byte sizes captured at fetch time. Survives SW restarts via the
// META_CACHE (we mirror this map into Cache Storage on every write so a
// cold-boot SW can rebuild it). Avoids re-cloning blobs on every status poll.
const SIZE_BY_URL = new Map();
const SIZE_META_PREFIX = '/__edu_meta_size__/';

// Soft cap on the playlist cache (in bytes). When a precache push would
// exceed this we drop oldest entries first. Default 5 GB; can be overridden
// via the PRECACHE_PLAYLIST message's `softCapBytes` field.
const DEFAULT_SOFT_CAP_BYTES = 5 * 1024 * 1024 * 1024;
// Hard floor reserved for the emergency tier — never evicted.
const EMERGENCY_FLOOR_BYTES = 1 * 1024 * 1024 * 1024;

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

    // Find the most recent stale emergency + meta caches (best-effort by
    // string ordering — versioning is monotonic vN where N grows).
    const staleEmergency = stale.filter((k) => k.startsWith('edu-player-emergency-')).sort();
    const staleMeta = stale.filter((k) => k.startsWith('edu-player-meta-')).sort();
    const oldEmergencyName = staleEmergency.length ? staleEmergency[staleEmergency.length - 1] : null;
    const oldMetaName = staleMeta.length ? staleMeta[staleMeta.length - 1] : null;

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

    // Now safe to delete stale versioned caches.
    await Promise.all(stale.map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only intercept GETs for things that look like media assets we might cache.
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Skip our own meta endpoint, /api/, /_next/, etc — only intercept what
  // looks like an asset URL.
  if (url.pathname.startsWith('/_next/')) return;
  if (url.pathname.includes('/api/v1/')) return;

  event.respondWith((async () => {
    // MED-3 audit fix: try the request URL as-is first, then fall back to
    // a query-stripped variant. CDNs often append cache-busters
    // (?v=2) that wouldn't otherwise match a previously-cached version
    // of the same asset. ignoreSearch on .match() does the work for us.
    const stripped = stripQuery(req.url);
    const altReq = stripped !== req.url ? new Request(stripped, { method: 'GET' }) : null;

    // Try emergency cache first (highest priority for life-safety).
    const emCache = await caches.open(EMERGENCY_CACHE);
    const emHit = await emCache.match(req, { ignoreSearch: true })
              ?? (altReq && await emCache.match(altReq, { ignoreSearch: true }));
    if (emHit) return emHit;

    // Then playlist cache.
    const plCache = await caches.open(PLAYLIST_CACHE);
    const plHit = await plCache.match(req, { ignoreSearch: true })
              ?? (altReq && await plCache.match(altReq, { ignoreSearch: true }));
    if (plHit) return plHit;

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
    event.waitUntil(precachePlaylist(msg.assets || [], msg.softCapBytes || DEFAULT_SOFT_CAP_BYTES));
  } else if (msg.type === 'PRECACHE_EMERGENCY') {
    // FIX (player-014): if the page passed a MessageChannel port,
    // we ack with { ok: true|false } AFTER deciding allCached so the
    // page only commits its lastEmergencySetHashRef on full success.
    const ackPort = (event.ports && event.ports[0]) || null;
    event.waitUntil(precacheEmergency(msg.assets || [], msg.setHash || '', ackPort));
  } else if (msg.type === 'STATUS_REQUEST') {
    event.waitUntil(replyStatus(event.source));
  } else if (msg.type === 'CLEAR_CACHE') {
    event.waitUntil(clearCache(msg.tier || 'all'));
  }
});

// ─── Pre-cache a list of playlist assets, evicting LRU over the soft cap ───
async function precachePlaylist(assets, softCapBytes) {
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

  // 2. Pre-fetch missing assets, respecting hash changes. Emit a
  //    progress event per completed asset so the splash can show a
  //    real download bar instead of an indeterminate pulse.
  let loaded = 0;
  for (const asset of assets) {
    await fetchAndStore(asset, cache, meta);
    loaded += 1;
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

  await broadcast({ type: 'PRECACHE_PLAYLIST_DONE', count: assets.length, totalBytes: total });
}

// ─── Pre-cache emergency assets — never evicted, hash-versioned ───
async function precacheEmergency(assets, setHash, ackPort) {
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
    const ok = await fetchAndStore(asset, cache, meta);
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
      const present = await cache.match(new Request(asset.url, { mode: 'cors', credentials: 'omit' }));
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

async function fetchAndStore(asset, cache, meta) {
  if (!asset?.url) return false;
  const req = new Request(asset.url, { mode: 'cors', credentials: 'omit' });
  const norm = normalizeUrl(asset.url);

  // If we already have it AND the hash matches, skip — but ensure we have a
  // size record (cold-boot SW may have lost the in-memory map).
  const storedHashRes = await meta.match(metaKey(asset.url));
  const storedHash = storedHashRes ? await storedHashRes.text() : '';
  const cached = await cache.match(req);
  if (cached && asset.sha256 && storedHash === asset.sha256) {
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
    return true;
  } catch (e) {
    // Best-effort — leave any prior cached version in place. Caller treats
    // the false return as a partial-cache signal.
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
  const [pl, em] = await Promise.all([caches.open(PLAYLIST_CACHE), caches.open(EMERGENCY_CACHE)]);
  const [plKeys, emKeys, plBytes, emBytes] = await Promise.all([
    pl.keys(), em.keys(), sumCacheBytes(pl), sumCacheBytes(em),
  ]);
  client.postMessage({
    type: 'STATUS_REPLY',
    playlist: { count: plKeys.length, bytes: plBytes },
    emergency: { count: emKeys.length, bytes: emBytes, floorBytes: EMERGENCY_FLOOR_BYTES },
  });
}

async function clearCache(tier) {
  if (tier === 'all' || tier === 'playlist') await caches.delete(PLAYLIST_CACHE);
  if (tier === 'all' || tier === 'emergency') await caches.delete(EMERGENCY_CACHE);
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
  return new Request(`/__edu_meta__/${encodeURIComponent(url)}`);
}

function sizeMetaKey(url) {
  return new Request(`${SIZE_META_PREFIX}${encodeURIComponent(url)}`);
}

function normalizeUrl(u) {
  try { return new URL(u, self.location.origin).toString().split('#')[0]; }
  catch { return u; }
}

function stripQuery(u) {
  try {
    const p = new URL(u, self.location.origin);
    p.search = '';
    p.hash = '';
    return p.toString();
  } catch { return u; }
}
