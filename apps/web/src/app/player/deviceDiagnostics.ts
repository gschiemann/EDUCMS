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
}): () => Promise<void> {
  let lastAt = -Infinity;
  let busy = false;
  return async () => {
    const token = deps.token();
    if (!token || busy || deps.now() - lastAt < 60_000 ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(deps.screenId)) return;
    lastAt = deps.now(); busy = true;
    try {
      const log = await deps.readLogs();
      if (typeof log !== 'string' || !log.trim()) return;
      // <= 768 KiB UTF-8 even with three-byte characters, below API's 1 MiB cap.
      const body = log.slice(-256 * 1024);
      await deps.post(`${deps.apiRoot()}/api/v1/player-logs/${deps.screenId}`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: `Bearer ${token}` }, body,
      });
    } catch { /* Diagnostics never hold playback or trigger credential recovery. */ }
    finally { busy = false; }
  };
}

let uploader: (() => Promise<void>) | null = null;
export function installDeviceDiagnosticsUploader(next: () => Promise<void>): () => void {
  uploader = next;
  return () => { if (uploader === next) uploader = null; };
}
export function requestDeviceDiagnosticsUpload(): boolean {
  if (!uploader) return false;
  void uploader().catch(() => undefined);
  return true;
}
