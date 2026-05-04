/**
 * Offline-cache client — talks to /sw-player.js. Used by the player to:
 *   - Register the SW on first run
 *   - Push playlist + emergency asset lists for pre-caching
 *   - Read cache status for the info overlay
 *
 * Safe to call from any environment: if Service Worker isn't available
 * (older browser, SSR, missing API) the helpers no-op gracefully so
 * browser testing keeps working unchanged.
 */

export type CacheStatus = {
  supported: boolean;
  playlist: { count: number; bytes: number };
  emergency: { count: number; bytes: number; floorBytes: number };
};

const SW_PATH = '/sw-player.js';
const SW_SCOPE = '/player';

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function isSwSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'caches' in window;
}

export function registerOfflineCache(): Promise<ServiceWorkerRegistration | null> {
  if (!isSwSupported()) return Promise.resolve(null);
  if (!registrationPromise) {
    registrationPromise = navigator.serviceWorker
      .register(SW_PATH, { scope: SW_SCOPE })
      .catch((e) => {
        console.warn('[Player] SW registration failed:', e);
        return null;
      });
  }
  return registrationPromise;
}

async function activeWorker(): Promise<ServiceWorker | null> {
  if (!isSwSupported()) return null;
  const reg = await registerOfflineCache();
  if (!reg) return null;
  return reg.active || reg.waiting || reg.installing || null;
}

/** Push the active playlist's asset URLs to the SW for pre-caching. */
export async function precachePlaylist(
  assets: Array<{ url: string; sha256?: string; size?: number }>,
  softCapBytes?: number,
): Promise<void> {
  const sw = await activeWorker();
  if (!sw || !assets?.length) return;
  sw.postMessage({ type: 'PRECACHE_PLAYLIST', assets, softCapBytes });
}

/**
 * Push every emergency-tier asset URL — never evicted by the SW.
 *
 * FIX (player-014): now waits for a MessageChannel ack from the SW so
 * callers can know whether the precache actually completed. The SW
 * acks `{ ok: true }` only when every asset is verified in cache.
 * Caller uses this to decide whether to commit a "last pushed" ref —
 * if `ok: false`, the next periodic sync should retry the full push.
 *
 * Resolves with `{ ok: false }` if SW is unsupported / inactive so
 * callers fall through the same retry path as a real partial.
 */
export async function precacheEmergency(
  assets: Array<{ url: string; sha256?: string; size?: number }>,
  setHash?: string,
): Promise<{ ok: boolean; failures?: number; count?: number }> {
  const sw = await activeWorker();
  if (!sw || !assets) return { ok: false };
  return new Promise((resolve) => {
    let settled = false;
    const channel = new MessageChannel();
    const finish = (result: { ok: boolean; failures?: number; count?: number }) => {
      if (settled) return;
      settled = true;
      try { channel.port1.close(); } catch { /* noop */ }
      resolve(result);
    };
    channel.port1.onmessage = (ev: MessageEvent) => {
      const data = ev?.data;
      if (data && typeof data === 'object' && typeof data.ok === 'boolean') {
        finish({ ok: data.ok, failures: data.failures, count: data.count });
      } else {
        finish({ ok: false });
      }
    };
    try {
      sw.postMessage({ type: 'PRECACHE_EMERGENCY', assets, setHash }, [channel.port2]);
    } catch (e) {
      finish({ ok: false });
      return;
    }
    // Watchdog: emergency precache for very large sets shouldn't hang
    // the page-side commit logic. 60 s is generous; if the SW is still
    // running it'll continue downloading and the next 5-min sync retries.
    setTimeout(() => finish({ ok: false }), 60_000);
  });
}

/** Ask the SW for its current cache utilisation. Resolves with null if SW absent. */
export async function getCacheStatus(): Promise<CacheStatus | null> {
  const sw = await activeWorker();
  if (!sw) return { supported: false, playlist: { count: 0, bytes: 0 }, emergency: { count: 0, bytes: 0, floorBytes: 0 } };
  return new Promise((resolve) => {
    let settled = false;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'STATUS_REPLY') {
        settled = true;
        navigator.serviceWorker.removeEventListener('message', onMsg);
        resolve({
          supported: true,
          playlist: e.data.playlist,
          emergency: e.data.emergency,
        });
      }
    };
    navigator.serviceWorker.addEventListener('message', onMsg);
    sw.postMessage({ type: 'STATUS_REQUEST' });
    setTimeout(() => {
      if (!settled) {
        navigator.serviceWorker.removeEventListener('message', onMsg);
        resolve({ supported: true, playlist: { count: 0, bytes: 0 }, emergency: { count: 0, bytes: 0, floorBytes: 0 } });
      }
    }, 2_000);
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
