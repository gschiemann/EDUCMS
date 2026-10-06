import { createDeviceDiagnosticsUploader, installDeviceDiagnosticsUploader, requestDeviceDiagnosticsUpload } from '../deviceDiagnostics';
import { requestDiagnosticsUpload } from '../playbackSafety';

const screenId = '12345678-abcd-1234-abcd-123456789abc';
function harness() {
  let now = 100_000;
  const deps = {
    screenId, token: jest.fn((): string | null => 'current-device-credential'),
    apiRoot: () => 'https://api.example',
    readLogs: jest.fn(async (): Promise<unknown> => 'PLAYER_PLAYBACK_FAILURE phase=read'),
    post: jest.fn(async (_url: string, _init: RequestInit) => undefined), now: () => now,
  };
  return { deps, upload: createDeviceDiagnosticsUploader(deps), advance: () => { now += 60_000; } };
}

test('the upload path is the bound screen ID and uses the current credential, never the fingerprint', async () => {
  const h = harness();
  await h.upload();
  expect(h.deps.post).toHaveBeenCalledWith(`https://api.example/api/v1/player-logs/${screenId}`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain', Authorization: 'Bearer current-device-credential' },
    body: 'PLAYER_PLAYBACK_FAILURE phase=read',
  });
  h.advance(); h.deps.token.mockReturnValue('renewed-device-credential');
  await h.upload();
  expect(h.deps.post.mock.calls[1][1].headers).toHaveProperty('Authorization', 'Bearer renewed-device-credential');
});

test('missing credentials, invalid IDs and bridge failures do not send anonymous logs or break playback', async () => {
  const h = harness(); h.deps.token.mockReturnValue(null);
  await h.upload(); expect(h.deps.readLogs).not.toHaveBeenCalled();
  h.deps.token.mockReturnValue('credential'); h.deps.screenId = 'hardware-fingerprint';
  await h.upload(); expect(h.deps.post).not.toHaveBeenCalled();
  h.deps.screenId = screenId; h.deps.readLogs.mockRejectedValueOnce(new Error('bridge unavailable'));
  await expect(h.upload()).resolves.toBeUndefined();
  expect(h.deps.post).not.toHaveBeenCalled();
});

test('concurrent requests coalesce, a cooldown bounds repeats, and the newest tail fits the API byte limit', async () => {
  const h = harness();
  h.deps.readLogs.mockResolvedValue('漢'.repeat(400_000) + 'last-failure');
  await Promise.all([h.upload(), h.upload(), h.upload()]);
  expect(h.deps.post).toHaveBeenCalledTimes(1);
  const body = h.deps.post.mock.calls[0][1].body as string;
  expect(Buffer.byteLength(body, 'utf8')).toBeLessThan(1_048_576);
  expect(body.endsWith('last-failure')).toBe(true);
  await h.upload(); expect(h.deps.post).toHaveBeenCalledTimes(1);
  h.advance(); await h.upload(); expect(h.deps.post).toHaveBeenCalledTimes(2);
});

test('all playback recovery callers use the authenticated upload when installed, and cleanup restores the native fallback', async () => {
  const upload = jest.fn(async () => undefined);
  const native = jest.fn(async () => undefined);
  const uninstall = installDeviceDiagnosticsUploader(upload);
  expect(requestDiagnosticsUpload({ has: () => true, call: native })).toBe(true);
  expect(upload).toHaveBeenCalledTimes(1); expect(native).not.toHaveBeenCalled();
  uninstall(); expect(requestDeviceDiagnosticsUpload()).toBe(false);
  requestDiagnosticsUpload({ has: () => true, call: native });
  expect(native).toHaveBeenCalledWith('uploadDiagnostics');
});

test('a worker failure reaches authenticated diagnostics even when the legacy bridge refuses or fails to read logs', async () => {
  const h = harness();
  const failure = { phase: 'assemble' as const, reason: 'Cache write failed https://cdn.example/private?token=secret', offset: 16_000_000, total: 16_000_000 };
  h.deps.readLogs.mockResolvedValue('(refused: bridge-nonce — this frame may not read device logs)');
  await h.upload(failure);
  const body = h.deps.post.mock.calls[0][1].body as string;
  expect(body).toContain('PLAYER_PLAYBACK_FAILURE [web-player] content cache failed');
  expect(body).toContain('"phase":"assemble"');
  expect(body).toContain('Cache write failed [media-url]');
  expect(body).not.toContain('token=secret');
  h.advance(); h.deps.readLogs.mockRejectedValueOnce(new Error('bridge unavailable'));
  await h.upload(failure);
  expect(h.deps.post).toHaveBeenCalledTimes(2);
});
