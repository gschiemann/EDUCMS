import { getServiceWorkerContainer, isServiceWorkerAvailable } from '../../lib/safe-service-worker';
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
  /** App-shell tier (/_next/static build assets) — bundle-split step 1. */
  shell: { count: number; bytes: number };
};

export type PlaylistCacheResult = { ok: boolean; failures?: number; count?: number; aborted?: boolean };

export type PlaylistCacheAsset = { url: string; sha256?: string | null; size?: number | null };

export type PlaylistCacheProgress = { url: string; bytesLoaded: number; bytesTotal: number | null };

export type PlaylistCacheOptions = {
  /** Abort the page-driven part (a new manifest superseded this asset set). */
  signal?: AbortSignal;
  /** Fires as each large file lands in the cache — verified and assembled. */
  onAssetCached?: (url: string) => void;
  /** Bytes staged so far for the large file being fetched right now. */
  onProgress?: (progress: PlaylistCacheProgress) => void;
};

// ── Large-asset staging, page side (2026-09-26, 4K cache-fill incident) ─────
// The worker refuses to download a big file inside PRECACHE_PLAYLIST (Chromium
// stops a service worker whose event runs past five minutes, and a whole-body
// digest of a 141 MB clip is an OOM on a signage box). It answers `pending` and
// the page drives each such file through short, separately-timed events:
// PRECACHE_CHUNK (one Range fetch, resumable) until `complete`, then
// PRECACHE_VERIFY (streamed SHA-256), then PRECACHE_ASSEMBLE. Every step is
// its own message event with its own budget; a kill mid-way costs one chunk.
const CHUNK_BYTES_START = 8 * 1024 * 1024;
const CHUNK_BYTES_FLOOR = 1024 * 1024;
/** Above the worker's own 240 s fetch abort, so its reason arrives first. */
const CHUNK_ACK_TIMEOUT_MS = 270_000;
/** Verify / assemble are disk passes; generous for a 2 GB file on slow eMMC. */
const STEP_ACK_TIMEOUT_MS = 270_000;
const LOOKUP_ACK_TIMEOUT_MS = 5_000;
const MAX_CONSECUTIVE_CHUNK_FAILURES = 4;
/** 8192 × the 1 MiB floor = 8 GiB, past any upload cap: a hard stop, never a spin. */
const MAX_CHUNK_STEPS = 8192;
const RETRY_PAUSE_MS = 3_000;
/** Reasons the worker reports when the SOURCE is wrong; retrying the same range cannot help. */
const FATAL_CHUNK_REASONS = new Set([
  'bad-request', 'size-mismatch', 'source-changed', 'range-unsupported',
  'range-not-satisfiable', 'range-mismatch', 'sha256-mismatch', 'not-verified',
]);

type WorkerReply = Record<string, unknown> | null;

/**
 * One request/reply round trip over a MessageChannel. `null` = no usable reply
 * (timeout, a worker that does not know the message, a reload mid-flight).
 * `onStarted` lets a worker that acked `{ started: true }` extend the wait.
 */
function askWorker(
  sw: ServiceWorker,
  message: Record<string, unknown>,
  timeoutMs: number,
  onStarted?: () => number,
): Promise<WorkerReply> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (reply: WorkerReply) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { channel.port1.close(); } catch { /* noop */ }
      resolve(reply);
    };
    timer = setTimeout(() => finish(null), timeoutMs);
    channel.port1.onmessage = (event: MessageEvent) => {
      const data = event.data;
      if (data && typeof data === 'object' && (data as { started?: unknown }).started === true && onStarted) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => finish(null), onStarted());
        return;
      }
      finish(data && typeof data === 'object' ? (data as Record<string, unknown>) : null);
    };
    try {
      sw.postMessage(message, [channel.port2]);
    } catch {
      finish(null);
    }
  });
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

function isFatalChunkReason(reason: unknown): boolean {
  if (typeof reason !== 'string') return false;
  if (FATAL_CHUNK_REASONS.has(reason)) return true;
  // A 4xx names a wrong URL or a revoked object; 408/429 are worth another try.
  return /^http-4(?!08$|29$)\d\d$/.test(reason);
}

/**
 * Drive one large file into the cache. Resolves true when it is assembled and
 * verified, false when this attempt gave up (the page's retry policy owns the
 * next one — staged chunks are kept, so the next attempt resumes), or
 * 'aborted' when the caller's signal fired.
 */
async function downloadLargeAsset(
  sw: ServiceWorker,
  asset: PlaylistCacheAsset,
  opts?: PlaylistCacheOptions,
): Promise<boolean | 'aborted'> {
  const size = Number.isSafeInteger(asset.size) && (asset.size as number) > 0 ? asset.size as number : null;
  const sha256 = typeof asset.sha256 === 'string' && asset.sha256 ? asset.sha256 : null;
  let offset = 0;
  let chunkBytes = CHUNK_BYTES_START;
  let consecutiveFailures = 0;
  let total: number | null = size;

  const failStep = async (): Promise<boolean> => {
    consecutiveFailures += 1;
    if (consecutiveFailures >= MAX_CONSECUTIVE_CHUNK_FAILURES) return false;
    // A slower link gets smaller chunks: each one must finish inside the
    // worker's per-event budget, and a resumed download loses at most one.
    if (chunkBytes > CHUNK_BYTES_FLOOR) chunkBytes = Math.max(CHUNK_BYTES_FLOOR, Math.floor(chunkBytes / 2));
    await pause(RETRY_PAUSE_MS, opts?.signal);
    return true;
  };

  for (let step = 0; step < MAX_CHUNK_STEPS; step++) {
    if (opts?.signal?.aborted) return 'aborted';
    const reply = await askWorker(sw, {
      type: 'PRECACHE_CHUNK', url: asset.url, sha256, size, offset, chunkBytes,
    }, CHUNK_ACK_TIMEOUT_MS);
    if (!reply || reply.ok !== true) {
      if (isFatalChunkReason(reply?.reason)) return false;
      if (!(await failStep())) return false;
      continue;
    }
    consecutiveFailures = 0;
    if (typeof reply.total === 'number') total = reply.total;
    const next = typeof reply.nextOffset === 'number' ? reply.nextOffset : offset;
    if (next <= offset && reply.complete !== true) {
      // No forward progress is a failure, whatever the worker called it.
      if (!(await failStep())) return false;
      continue;
    }
    offset = next;
    opts?.onProgress?.({ url: asset.url, bytesLoaded: offset, bytesTotal: total });
    if (reply.complete !== true) continue;

    if (opts?.signal?.aborted) return 'aborted';
    const verified = await askWorker(sw, { type: 'PRECACHE_VERIFY', url: asset.url, sha256 }, STEP_ACK_TIMEOUT_MS);
    if (!verified || verified.ok !== true) {
      if (verified?.reason === 'incomplete' && typeof verified.nextOffset === 'number') {
        offset = verified.nextOffset;
        if (!(await failStep())) return false;
        continue;
      }
      return false;
    }
    if (opts?.signal?.aborted) return 'aborted';
    const assembled = await askWorker(sw, { type: 'PRECACHE_ASSEMBLE', url: asset.url, sha256 }, STEP_ACK_TIMEOUT_MS);
    if (!assembled || assembled.ok !== true) {
      if (assembled?.reason === 'incomplete' && typeof assembled.nextOffset === 'number') {
        offset = assembled.nextOffset;
        if (!(await failStep())) return false;
        continue;
      }
      return false;
    }
    return true;
  }
  return false;
}

const SW_PATH = '/sw-player.js';
const SW_SCOPE = '/player';

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function isSwSupported(): boolean {
  // isServiceWorkerAvailable() actually READS the property (inside a try) —
// `'serviceWorker' in navigator` only proves it exists and still throws on read.
  return isServiceWorkerAvailable() && typeof window !== 'undefined' && 'caches' in window;
}

export function registerOfflineCache(): Promise<ServiceWorkerRegistration | null> {
  if (!isSwSupported()) return Promise.resolve(null);
  if (!registrationPromise) {
    registrationPromise = (getServiceWorkerContainer() as ServiceWorkerContainer)
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

/**
 * Bring the active playlist's assets into the cache. Resolves `ok: true` only
 * when EVERY asset is cached and current — the small ones the worker fetched
 * inside PRECACHE_PLAYLIST and the large ones this page then drove chunk by
 * chunk. Anything less is `ok: false` and the caller's retry policy owns the
 * next attempt; staged chunks survive, so that attempt resumes, not restarts.
 */
export async function precachePlaylist(
  assets: PlaylistCacheAsset[],
  softCapBytes?: number,
  opts?: PlaylistCacheOptions,
): Promise<PlaylistCacheResult> {
  const sw = await activeWorker();
  if (!sw || !assets?.length) return { ok: false };
  // The worker acks `{ started: true }` first, then the result. An older worker
  // that never acks is given 15 s; a current one gets five minutes for its
  // small-asset pass (large files are not fetched inside this event).
  const first = await askWorker(
    sw, { type: 'PRECACHE_PLAYLIST', assets, softCapBytes }, 15_000, () => 5 * 60_000,
  );
  if (!first || typeof first.ok !== 'boolean') return { ok: false };
  const count = typeof first.count === 'number' ? first.count : assets.length;
  let failures = typeof first.failures === 'number' ? first.failures : 0;
  const pending: PlaylistCacheAsset[] = Array.isArray(first.pending)
    ? (first.pending as unknown[]).filter(
        (p): p is PlaylistCacheAsset => !!p && typeof (p as PlaylistCacheAsset).url === 'string',
      )
    : [];
  if (pending.length === 0) return { ok: first.ok && failures === 0, failures, count };
  for (const asset of pending) {
    if (opts?.signal?.aborted) return { ok: false, failures, count, aborted: true };
    const outcome = await downloadLargeAsset(sw, asset, opts);
    if (outcome === 'aborted') return { ok: false, failures, count, aborted: true };
    if (outcome) opts?.onAssetCached?.(asset.url);
    else failures += 1;
  }
  return { ok: failures === 0, failures, count };
}

/**
 * Which of these URLs are in the playlist cache right now (and, when a digest
 * is given, verified against it). `null` when the worker cannot answer — the
 * caller must treat that as unknown, never as "not cached".
 */
export async function lookupCached(assets: PlaylistCacheAsset[]): Promise<Record<string, boolean> | null> {
  const sw = await activeWorker();
  if (!sw || !assets?.length) return null;
  const reply = await askWorker(sw, {
    type: 'CACHE_LOOKUP',
    urls: assets.map((a) => ({ url: a.url, sha256: a.sha256 ?? null })),
  }, LOOKUP_ACK_TIMEOUT_MS);
  if (!reply || reply.ok !== true || !reply.cached || typeof reply.cached !== 'object') return null;
  const out: Record<string, boolean> = {};
  for (const [url, value] of Object.entries(reply.cached as Record<string, unknown>)) out[url] = value === true;
  return out;
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

/**
 * Ask the SW to refresh the app-shell cache (parse the player route's HTML,
 * pull any new /_next/static chunks, prune stale ones). Fire-and-forget —
 * called idle after boot so a deploy that changed chunk names without
 * changing sw-player.js itself still gets a fresh offline shell.
 */
export async function precacheAppShell(): Promise<void> {
  const sw = await activeWorker();
  if (!sw) return;
  sw.postMessage({ type: 'PRECACHE_SHELL', extra: loadedShellScripts() });
}

/**
 * The `/_next/static` scripts THIS document is currently running on (P0-3).
 *
 * The SW's shell refresh enumerates the build by parsing the route HTML —
 * which by definition cannot see a chunk that arrived from a dynamic
 * `import()`. Since /player now lazy-loads its renderer, the page has to
 * tell the SW what it actually loaded, or the very first boot (the one where
 * the SW had not claimed the client yet, so runtime capture missed it) would
 * leave the renderer chunk out of the offline shell.
 *
 * Same-origin `/_next/static` only — never a way to make the SW fetch an
 * arbitrary URL. Returns [] outside the browser and never throws.
 */
function loadedShellScripts(): string[] {
  if (typeof document === 'undefined') return [];
  try {
    const out: string[] = [];
    const seen = new Set<string>();
    document.querySelectorAll('script[src]').forEach((el) => {
      const raw = (el as HTMLScriptElement).src;
      if (!raw) return;
      let u: URL;
      try {
        u = new URL(raw, window.location.origin);
      } catch {
        return;
      }
      if (u.origin !== window.location.origin) return;
      if (!u.pathname.startsWith('/_next/static/')) return;
      if (seen.has(u.pathname)) return;
      seen.add(u.pathname);
      out.push(u.pathname);
    });
    return out;
  } catch {
    return [];
  }
}

const EMPTY_SHELL = { count: 0, bytes: 0 };

/** Ask the SW for its current cache utilisation. Resolves with null if SW absent. */
export async function getCacheStatus(): Promise<CacheStatus | null> {
  const sw = await activeWorker();
  if (!sw) return { supported: false, playlist: { count: 0, bytes: 0 }, emergency: { count: 0, bytes: 0, floorBytes: 0 }, shell: EMPTY_SHELL };
  return new Promise((resolve) => {
    let settled = false;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === 'STATUS_REPLY') {
        settled = true;
        getServiceWorkerContainer()?.removeEventListener('message', onMsg);
        resolve({
          supported: true,
          playlist: e.data.playlist,
          emergency: e.data.emergency,
          // Defensive default: an in-flight OLD SW (pre-shell) replies
          // without the field during the upgrade window.
          shell: e.data.shell ?? EMPTY_SHELL,
        });
      }
    };
    getServiceWorkerContainer()?.addEventListener('message', onMsg);
    try {
      sw.postMessage({ type: 'STATUS_REQUEST' });
    } catch {
      getServiceWorkerContainer()?.removeEventListener('message', onMsg);
      resolve(null);
      return;
    }
    setTimeout(() => {
      if (!settled) {
        getServiceWorkerContainer()?.removeEventListener('message', onMsg);
        // No reply is not evidence of an empty cache. Do not send invented
        // zeroes to the dashboard as if the device measured them.
        resolve(null);
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
