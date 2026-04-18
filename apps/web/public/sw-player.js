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

const VERSION = 'v1';
const PLAYLIST_CACHE = `edu-player-playlist-${VERSION}`;
const EMERGENCY_CACHE = `edu-player-emergency-${VERSION}`;
const META_CACHE = `edu-player-meta-${VERSION}`; // stores sha hashes per URL
const ALL_CACHES = [PLAYLIST_CACHE, EMERGENCY_CACHE, META_CACHE];

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
    // Clear stale versioned caches.
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('edu-player-') && !ALL_CACHES.includes(k))
        .map((k) => caches.delete(k))
    );
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
    // Try emergency cache first (highest priority for life-safety).
    const emCache = await caches.open(EMERGENCY_CACHE);
    const emHit = await emCache.match(req, { ignoreSearch: true });
    if (emHit) return emHit;

    // Then playlist cache.
    const plCache = await caches.open(PLAYLIST_CACHE);
    const plHit = await plCache.match(req, { ignoreSearch: true });
    if (plHit) return plHit;

    // Fall through to network. If the response is OK and looks cacheable,
    // store it in the playlist tier opportunistically (covers assets the
    // page asked for but didn't pre-cache).
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
    event.waitUntil(precacheEmergency(msg.assets || [], msg.setHash || ''));
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
    }
  }

  // 2. Pre-fetch missing assets, respecting hash changes.
  for (const asset of assets) {
    await fetchAndStore(asset, cache, meta);
  }

  // 3. Honor soft cap by evicting oldest. We don't track real LRU, so we
  // approximate: iterate in insertion order and drop until under cap.
  let total = await sumCacheBytes(cache);
  if (total > softCapBytes) {
    const keys = await cache.keys();
    for (const req of keys) {
      if (total <= softCapBytes) break;
      const res = await cache.match(req);
      const sz = res ? Number(res.headers.get('content-length') || 0) : 0;
      await cache.delete(req);
      await meta.delete(metaKey(req.url));
      total -= sz;
    }
  }

  await broadcast({ type: 'PRECACHE_PLAYLIST_DONE', count: assets.length, totalBytes: total });
}

// ─── Pre-cache emergency assets — never evicted, hash-versioned ───
async function precacheEmergency(assets, setHash) {
  const cache = await caches.open(EMERGENCY_CACHE);
  const meta = await caches.open(META_CACHE);

  // Store the set hash so the page can short-circuit when nothing changed.
  await meta.put(
    new Request('/__edu_emergency_set_hash__'),
    new Response(setHash || '', { headers: { 'content-type': 'text/plain' } })
  );

  // Evict assets no longer in the set (admin removed an emergency asset).
  const liveUrls = new Set(assets.map((a) => normalizeUrl(a.url)));
  const existing = await cache.keys();
  for (const req of existing) {
    if (!liveUrls.has(normalizeUrl(req.url))) {
      await cache.delete(req);
      await meta.delete(metaKey(req.url));
    }
  }

  // Fetch + store. Force re-download if our stored hash doesn't match the
  // expected hash.
  for (const asset of assets) {
    await fetchAndStore(asset, cache, meta);
  }

  const total = await sumCacheBytes(cache);
  await broadcast({ type: 'PRECACHE_EMERGENCY_DONE', count: assets.length, totalBytes: total });
}

async function fetchAndStore(asset, cache, meta) {
  if (!asset?.url) return;
  const req = new Request(asset.url, { mode: 'cors', credentials: 'omit' });

  // If we already have it AND the hash matches, skip.
  const storedHashRes = await meta.match(metaKey(asset.url));
  const storedHash = storedHashRes ? await storedHashRes.text() : '';
  const cached = await cache.match(req);
  if (cached && asset.sha256 && storedHash === asset.sha256) {
    return; // up to date
  }

  try {
    const res = await fetch(req);
    if (!res.ok) return;
    await cache.put(req, res.clone());
    if (asset.sha256) {
      await meta.put(
        metaKey(asset.url),
        new Response(asset.sha256, { headers: { 'content-type': 'text/plain' } })
      );
    }
  } catch (e) {
    // Best-effort — leave any prior cached version in place.
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

async function sumCacheBytes(cache) {
  const keys = await cache.keys();
  let total = 0;
  for (const req of keys) {
    const res = await cache.match(req);
    if (res) {
      const cl = Number(res.headers.get('content-length') || 0);
      total += cl;
    }
  }
  return total;
}

async function broadcast(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const c of clients) c.postMessage(msg);
}

function metaKey(url) {
  return new Request(`/__edu_meta__/${encodeURIComponent(url)}`);
}

function normalizeUrl(u) {
  try { return new URL(u, self.location.origin).toString().split('#')[0]; }
  catch { return u; }
}
