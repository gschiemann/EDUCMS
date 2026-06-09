/* eslint-disable */
/**
 * 2026-06-08 — Dashboard service worker DISABLED (self-unregistering).
 *
 * The dashboard SW (HTML/asset caching for PWA installability) caused a
 * recurring class of production bugs:
 *   • stale bundles after every deploy ("we can't ask people to clear cache"), and
 *   • today, an UNRESPONSIVE worker that wedged Next.js client-side navigation —
 *     clicks (sidebar nav, "Control Game", tenant switcher, sign-out) did
 *     nothing, while only a hard refresh worked. `getRegistrations()` hung for
 *     45s on the live origin, the signature of a stuck worker intercepting and
 *     stalling the RSC/navigation fetches the router depends on.
 *
 * For an operator dashboard that already bypasses /api/, offline support was
 * never useful, so the worker's risk vastly outweighs its benefit. This file
 * now UNREGISTERS the worker and purges its caches on every client, returning
 * the dashboard to plain network: reliable navigation, always-fresh code, and
 * no stale-bundle problem. The kiosk player keeps its own sw-player.js
 * (separate file, different scope) — untouched. ServiceWorkerRegistrar no
 * longer registers this file; existing installs pick up THIS version on their
 * next update check (it's served no-store) and self-remove.
 */
self.addEventListener('install', () => {
  // Activate immediately so we can tear ourselves down on the next load.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Purge the dashboard's own caches (never the kiosk player's).
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys.filter((k) => k.startsWith('edu-shell-')).map((k) => caches.delete(k)),
        );
      } catch (e) { /* best effort */ }
      // Take control so the unregister applies to current clients, then remove
      // ourselves. Clients drop SW control on their next navigation/reload and
      // run pure-network from then on.
      try { await self.clients.claim(); } catch (e) {}
      try { await self.registration.unregister(); } catch (e) {}
    })(),
  );
});

// NO fetch handler on purpose: every request goes straight to the network with
// no service-worker interception while this shim is briefly still in control.
