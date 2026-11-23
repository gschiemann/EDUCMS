import { getServiceWorkerContainer } from '../../lib/safe-service-worker';

/**
 * 2026-06-08 — Reload that ACTUALLY clears the stale shell.
 *
 * The old code just called window.location.reload(), which — when a
 * stale dashboard service worker was still controlling the page — got
 * served the SAME stale app shell straight back out of CacheStorage.
 * That's why operators reported "reloading doesn't help, I have to
 * clear my cache." This version, before reloading:
 *   1. pulls the freshly-deployed service worker (registration.update)
 *      and tells any waiting worker to take over immediately, and
 *   2. deletes the dashboard's own CacheStorage entries (edu-shell-*),
 *      so the post-reload fetch can't be answered from the stale cache.
 * Scoped to edu-shell-* so the kiosk player's offline store (same
 * origin) is never wiped. Best-effort: any failure still reloads.
 *
 * Moved verbatim out of StaleBundleWatcher.tsx (2026-11-23) so the
 * watcher's reload decisions can be tested without a real navigation.
 */
export async function freshReload() {
  try {
    const swc = getServiceWorkerContainer();
    if (swc) {
      const reg = await swc.getRegistration();
      if (reg) {
        try { await reg.update(); } catch { /* non-fatal */ }
        try { reg.waiting?.postMessage({ type: 'SKIP_WAITING' }); } catch { /* non-fatal */ }
      }
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('edu-shell-')).map((k) => caches.delete(k)),
      );
    }
  } catch {
    // Best-effort — reload regardless so the operator is never stuck.
  }
  window.location.reload();
}
