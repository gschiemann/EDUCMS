export type WebCacheFailure = {
  phase: 'chunk' | 'verify' | 'assemble';
  reason: string;
  offset: number;
  total: number | null;
};

/** No URLs, credentials, document identities or arbitrary native log text. */
export function nativeStorageDiagnostic(raw: unknown): Record<string, unknown> | null {
  try {
    if (typeof raw === 'string') {
      if (raw.length > 65_536) return null;
      raw = JSON.parse(raw);
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const state = raw as Record<string, unknown>;
    const obj = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
    const number = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
    const boolean = (v: unknown) => typeof v === 'boolean' ? v : null;
    const code = (v: unknown) => typeof v === 'string' && /^[a-z0-9-]{1,64}$/.test(v) ? v : null;
    const store = obj(state.store);
    const accounting = obj(store.accounting);
    return {
      protocol: number(state.protocol), protocolMax: number(state.protocolMax),
      state: code(state.state), reason: code(state.reason),
      nativeFirst: boolean(obj(state.nativeFirst).enabled),
      store: {
        mode: code(store.mode), reason: code(store.reason), serve: boolean(store.serve),
        generation: number(store.generation),
        readyCount: Array.isArray(store.ready) ? Math.min(64, store.ready.length) : null,
        pendingCount: Array.isArray(store.pending) ? Math.min(64, store.pending.length) : null,
        usedBytes: number(accounting.usedBytes), freeBytes: number(accounting.freeBytes),
        budgetBytes: number(accounting.budgetBytes), storeFull: boolean(accounting.storeFull),
      },
    };
  } catch { return null; }
}

/** A refused or wedged bridge must not prevent the independent web evidence. */
function boundedDiagnostic<T>(read: (() => Promise<T>) | undefined): Promise<T | undefined> {
  if (!read) return Promise.resolve(undefined);
  return new Promise(resolve => {
    let done = false;
    const finish = (value?: T) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(), 2000);
    Promise.resolve().then(read).then(finish, () => finish());
  });
}

/** Upload the native log through the page's current, screen-bound credential.
 * Older APKs pass a fingerprint as the upload path; the API correctly refuses
 * to attribute that path to the device JWT's screen subject. No auth bypass.
 */
export function createDeviceDiagnosticsUploader(deps: {
  screenId: string;
  token(): string | null;
  apiRoot(): string;
  readLogs(): Promise<unknown>;
  readNativeState?(): Promise<unknown>;
  readStorage?(): Promise<{ usage: number; quota: number } | null>;
  post(url: string, init: RequestInit): Promise<unknown>;
  now(): number;
}): (failure?: WebCacheFailure) => Promise<void> {
  let lastAt = -Infinity;
  let busy = false;
  return async (failure) => {
    const token = deps.token();
    if (!token || busy || deps.now() - lastAt < 60_000 ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(deps.screenId)) return;
    lastAt = deps.now(); busy = true;
    try {
      const [log, native, estimate] = await Promise.all([
        boundedDiagnostic(deps.readLogs), boundedDiagnostic(deps.readNativeState), boundedDiagnostic(deps.readStorage),
      ]);
      const nativeState = nativeStorageDiagnostic(native);
      const storage = estimate && Number.isFinite(estimate.usage) && estimate.usage >= 0 &&
        Number.isFinite(estimate.quota) && estimate.quota > 0
        ? { usage: estimate.usage, quota: estimate.quota } : null;
      const stateObservation = nativeState || storage
        ? `${new Date(deps.now()).toISOString()} PLAYER_PLAYBACK_FAILURE [web-player] storage snapshot ${JSON.stringify({ native: nativeState, browser: storage })}`
        : '';
      // Legacy bridges may refuse native log reads. Preserve the worker's
      // actual reply separately, explicitly attributed to the web player.
      const observation = failure
        ? `${new Date(deps.now()).toISOString()} PLAYER_PLAYBACK_FAILURE [web-player] content cache failed ${JSON.stringify({ ...failure, reason: failure.reason.replace(/https?:\/\/\S+/g, '[media-url]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[credential]').slice(0, 160) })}`
        : '';
      const nativeLog = typeof log === 'string' ? log.trim() : '';
      if (!nativeLog && !observation && !stateObservation) return;
      // <= 768 KiB UTF-8 even with three-byte characters, below API's 1 MiB cap.
      const body = [nativeLog.slice(-255 * 1024), observation, stateObservation].filter(Boolean).join('\n');
      await deps.post(`${deps.apiRoot()}/api/v1/player-logs/${deps.screenId}`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${token}` }, body,
      });
    } catch { /* Diagnostics never hold playback or trigger credential recovery. */ }
    finally { busy = false; }
  };
}

let uploader: ((failure?: WebCacheFailure) => Promise<void>) | null = null;
export function installDeviceDiagnosticsUploader(next: (failure?: WebCacheFailure) => Promise<void>): () => void {
  uploader = next;
  return () => { if (uploader === next) uploader = null; };
}
export function requestDeviceDiagnosticsUpload(failure?: WebCacheFailure): boolean {
  if (!uploader) return false;
  void uploader(failure).catch(() => undefined);
  return true;
}
