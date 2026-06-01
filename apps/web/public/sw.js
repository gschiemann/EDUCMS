/* eslint-disable */
/**
 * Dashboard PWA service worker. Distinct from sw-player.js (which
 * caches playlist + emergency assets for the kiosk surface). This SW
 * only manages the *app shell* for the operator dashboard:
 *
 *   • Network-first for HTML navigations (always serve the latest UI;
 *     fall back to a cached copy when offline).
 *   • Cache-first for static assets (JS bundles, CSS, fonts, images)
 *     since they're content-hashed and never change.
 *   • Bypasses API requests entirely — those need real server data.
 *
 * 2026-05-14 — Phase 1 of MOBILE_APP_ROADMAP.md. The minimum needed
 * for browsers to recognize this as an installable PWA (Lighthouse's
 * "installable" check requires a fetch handler). Service-worker
 * registration happens in the InstallPromptBanner mount effect.
 *
 * On every deploy the bundle hash changes → cache key changes →
 * old entries get evicted. Keep CACHE_VERSION bumped when adding
 * destructive changes to this file.
 */
// 2026-05-27 — bumped from v1 → v2. The activate handler deletes any
// cache that doesn't start with CACHE_VERSION, so bumping this string
// purges every entry from the v1-era cache (which had been hoarding
// stale Next chunks since the SW first shipped). Bump again any time
// a deploy needs to force a clean cache for already-installed clients
// — the dashboard SW will purge on its next activate.
// 2026-06-01 — v2 → v3. Operators hit "This page couldn't load" opening
// the builder after a deploy: the cache-first static handler had hoarded
// old Next chunks, and the route boundary's "Try again" only did a React
// reset() (re-rendered the same stale module), so it never recovered.
// Fixes shipped alongside: error boundary now does a full reload, and a
// global ChunkLoadError handler auto-reloads once. Bumping the version
// purges any stale chunk cache on the next activate.
const CACHE_VERSION = 'edu-shell-v3';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const HTML_CACHE = `${CACHE_VERSION}-html`;

self.addEventListener('install', (event) => {
  // Skip waiting so a new SW takes over on the next page load
  // instead of waiting for every tab to close. Pairs with the
  // operator-side StaleBundleWatcher that already prompts to reload
  // when a new web build is deployed.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Clean up old cache versions from previous SW generations.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      );
      // Take control of any clients without requiring a reload.
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle GETs. POST/PUT/DELETE go straight to the network.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // BYPASS — never cache:
  //   • API calls (need fresh data, JWT-bound)
  //   • Authentication endpoints
  //   • The player route (has its own SW + offline strategy)
  //   • Any cross-origin request (Supabase, FCM, analytics)
  //   • Hot-reload websocket / RSC traffic
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_next/data/') ||
    url.pathname.startsWith('/player') ||
    url.pathname.startsWith('/__nextjs') ||
    url.pathname.includes('hot-update')
  ) {
    return;
  }

  // HTML navigations → network-first, fall back to cache, fall back
  // to a minimal offline shell.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(HTML_CACHE);
          // Only cache successful responses
          if (fresh.ok) cache.put(req, fresh.clone());
          return fresh;
        } catch {
          const cache = await caches.open(HTML_CACHE);
          const cached = await cache.match(req);
          if (cached) return cached;
          // Last-resort: any cached HTML at all
          const any = await cache.match('/');
          if (any) return any;
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>Offline</title><div style="font-family:system-ui;padding:24px;color:#0f172a"><h1>You\'re offline</h1><p>Reconnect to the network to use EduCMS. The kiosk player you\'re managing keeps running on its own cached content.</p></div>',
            { headers: { 'content-type': 'text/html; charset=utf-8' }, status: 200 }
          );
        }
      })()
    );
    return;
  }

  // Static assets (JS / CSS / fonts / images) → cache-first.
  // Hashed filenames mean an immutable cache is safe.
  if (
    url.pathname.startsWith('/_next/static/') ||
    /\.(?:js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|webp|gif|ico)$/i.test(url.pathname)
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const fresh = await fetch(req);
          if (fresh.ok) cache.put(req, fresh.clone());
          return fresh;
        } catch {
          // No fallback for missing static assets — page will degrade
          // gracefully (broken image, missing font). Better than
          // serving a wrong asset.
          return new Response('', { status: 504 });
        }
      })()
    );
    return;
  }
});

// 2026-05-14 — Web push handler stub. Wired in but no-op until the
// server starts sending notifications via FCM (Phase 1 step 5 of
// MOBILE_APP_ROADMAP.md). Once FCM is on, this displays the
// notification + routes the click to the appropriate dashboard
// route via the data.url payload.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: 'EduCMS', body: event.data.text() }; }
  const title = payload.title || 'EduCMS';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/panic-icon.png',
    badge: payload.badge || '/panic-icon.png',
    tag: payload.tag,
    data: { url: payload.url || '/' },
    requireInteraction: !!payload.requireInteraction,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Focus an existing window if one's open.
      for (const c of all) {
        if (c.url.includes(target) && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })()
  );
});
