export type WebCacheFailure = {
  phase: 'chunk' | 'verify' | 'assemble';
  reason: string;
  offset: number;
  total: number | null;
};

/** Upload the native log through the page's current, screen-bound credential.
 * Older APKs pass a fingerprint as the upload path; the API correctly refuses
 * to attribute that path to the device JWT's screen subject. No auth bypass.
 */
export function createDeviceDiagnosticsUploader(deps: {
  screenId: string;
  token(): string | null;
  apiRoot(): string;
  readLogs(): Promise<unknown>;
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
      let log: unknown;
      try { log = await deps.readLogs(); } catch { /* The web observation remains available. */ }
      // Legacy bridges may refuse native log reads. Preserve the worker's
      // actual reply separately, explicitly attributed to the web player.
      const observation = failure
        ? `${new Date(deps.now()).toISOString()} PLAYER_PLAYBACK_FAILURE [web-player] content cache failed ${JSON.stringify({ ...failure, reason: failure.reason.replace(/https?:\/\/\S+/g, '[media-url]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[credential]').slice(0, 160) })}`
        : '';
      const nativeLog = typeof log === 'string' ? log.trim() : '';
      if (!nativeLog && !observation) return;
      // <= 768 KiB UTF-8 even with three-byte characters, below API's 1 MiB cap.
      const body = [nativeLog.slice(-255 * 1024), observation].filter(Boolean).join('\n');
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
