/* eslint-disable */
/**
 * Dashboard PWA service worker. Distinct from sw-player.js (which
 * caches playlist + emergency assets for the kiosk surface). This SW
 * only manages the *app shell* for the operator dashboard:
 *
 *   • Network-first for HTML navigations (always serve the latest UI;
 *     fall back to a cached copy when offline).
 *   • Network-first for static assets (JS bundles, CSS, fonts, images)
 *     — see the 2026-06-08 note below for why this changed from
 *     cache-first.
 *   • Bypasses API requests entirely — those need real server data.
 *
 * 2026-05-14 — Phase 1 of MOBILE_APP_ROADMAP.md. The minimum needed
 * for browsers to recognize this as an installable PWA (Lighthouse's
 * "installable" check requires a fetch handler). Service-worker
 * registration happens in ServiceWorkerRegistrar.
 *
 * ─────────────────────────────────────────────────────────────────
 * 2026-06-08 — THE "must clear cache after every update" FIX.
 *
 * Symptom (beta operator, Safari + Chrome): after a deploy the
 * dashboard needed two clicks per button / the tenant switcher went
 * dead, and ONLY clearing site data fixed it — a plain reload did not.
 *
 * Root cause: the previous static handler was CACHE-FIRST. Combined
 * with a service worker that the browser was holding stale (the
 * dashboard /sw.js was missing the `no-store` header that the kiosk
 * /sw-player.js had — now fixed in next.config.ts), an old app shell
 * + old Next chunks were served from CacheStorage indefinitely. The
 * recurring manual CACHE_VERSION bumps (v1→v2→v3) were all band-aids
 * for this same class of bug.
 *
 * The fix here removes the bug class instead of bumping past it:
 *   1. Static assets are now NETWORK-FIRST (fall back to cache only
 *      when the network genuinely fails). For immutable, content-
 *      hashed `/_next/static/*` assets a `fetch()` is served straight
 *      from the browser's own HTTP cache (Vercel sets them
 *      `immutable`), so this is just as fast — but it can NEVER serve
 *      a stale shell from CacheStorage after a deploy.
 *   2. Bumping CACHE_VERSION to v4 makes the activate handler purge
 *      every pre-v4 cache on the next activation — a one-time cleanup
 *      that frees already-stuck clients.
 *   3. A `message` handler lets an open page tell a waiting SW to
 *      skipWaiting immediately (used by ServiceWorkerRegistrar +
 *      StaleBundleWatcher) so a freshly-deployed SW takes over without
 *      the user closing every tab.
 *
 * Going forward there should be no reason to hand-bump CACHE_VERSION
 * for stale-chunk reasons — network-first means caches can't go stale.
 * Only bump it if the SHAPE of what's cached changes destructively.
 */
const CACHE_VERSION = 'edu-shell-v4';
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
      // Only touch the dashboard's own caches (edu-shell-*) so we never
      // wipe the kiosk player's offline store, which shares this origin.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('edu-shell-') && !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      );
      // Take control of any clients without requiring a reload.
      await self.clients.claim();
    })()
  );
});

// Let an open page force a waiting SW to activate immediately. The
// page posts { type: 'SKIP_WAITING' } when it detects a new version
// (ServiceWorkerRegistrar on updatefound, StaleBundleWatcher on SHA
// drift) so the fresh SW takes over on the next reload instead of
// lingering in the "waiting" state behind still-open tabs.
self.addEventListener('message', (event) => {
  if (event && event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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
  //   • The service worker scripts themselves (must always hit network
  //     so the browser can detect a new version)
  //   • Hot-reload websocket / RSC traffic
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/_next/data/') ||
    url.pathname.startsWith('/player') ||
    url.pathname.startsWith('/__nextjs') ||
    url.pathname === '/sw.js' ||
    url.pathname === '/sw-player.js' ||
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
            '<!doctype html><meta charset="utf-8"><title>Offline</title><div style="font-family:system-ui;padding:24px;color:#0f172a"><h1>You\'re offline</h1><p>Reconnect to the network to use VenueOS. The kiosk player you\'re managing keeps running on its own cached content.</p></div>',
            { headers: { 'content-type': 'text/html; charset=utf-8' }, status: 200 }
          );
        }
      })()
    );
    return;
  }

  // Static assets (JS / CSS / fonts / images) → NETWORK-FIRST.
  //
  // Content-hashed `/_next/static/*` URLs are immutable, so the
  // `fetch()` below is served instantly from the browser's HTTP cache
  // (Vercel marks them `immutable`) on a warm load — same speed as the
  // old cache-first path. The win: after a deploy we NEVER replay a
  // stale shell out of CacheStorage. The SW cache is now only a
  // last-resort offline fallback, not the primary source of truth.
  if (
    url.pathname.startsWith('/_next/static/') ||
    /\.(?:js|css|woff2?|ttf|eot|svg|png|jpg|jpeg|webp|gif|ico)$/i.test(url.pathname)
  ) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        try {
          const fresh = await fetch(req);
          if (fresh.ok) cache.put(req, fresh.clone());
          return fresh;
        } catch {
          // Offline (or network error) → fall back to the cached copy
          // if we happen to have one. No cached copy → let it fail so
          // the page degrades gracefully rather than serving a wrong
          // asset.
          const cached = await cache.match(req);
          if (cached) return cached;
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
  try { payload = event.data.json(); } catch { payload = { title: 'VenueOS', body: event.data.text() }; }
  const title = payload.title || 'VenueOS';
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
