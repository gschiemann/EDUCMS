import { createDeviceDiagnosticsUploader, installDeviceDiagnosticsUploader, requestDeviceDiagnosticsUpload, nativeStorageDiagnostic } from '../deviceDiagnostics';
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

test('native storage evidence excludes credentials, URLs, lease identities and asset lists', () => {
  const snapshot = nativeStorageDiagnostic(JSON.stringify({
    protocol: 2, protocolMax: 4, state: 'idle', token: 'private-credential',
    nativeFirst: { enabled: true }, lease: { id: 'private-document' },
    store: { mode: 'active', serve: false, generation: 3, ready: ['private-asset'], pending: [],
      url: 'https://private.example/file?token=credential',
      accounting: { usedBytes: 100, freeBytes: 6000, budgetBytes: 5000, storeFull: false, secret: 'private' } },
  }));
  expect(snapshot).toMatchObject({ protocolMax: 4, nativeFirst: true, store: {
    mode: 'active', readyCount: 1, pendingCount: 0, freeBytes: 6000, budgetBytes: 5000,
  } });
  expect(JSON.stringify(snapshot)).not.toMatch(/private|credential|token|lease|https/);
  expect(nativeStorageDiagnostic('{}')).toMatchObject({ nativeFirst: null, store: { mode: null, freeBytes: null } });
  expect(nativeStorageDiagnostic('malformed')).toBeNull();
  expect(nativeStorageDiagnostic(' '.repeat(65_537))).toBeNull();
});

test('a hung native log read cannot hide the independent native-store and browser-quota evidence', async () => {
  jest.useFakeTimers();
  try {
    const h = harness();
    h.deps.readLogs.mockImplementation(() => new Promise(() => undefined));
    const upload = createDeviceDiagnosticsUploader({ ...h.deps,
      readNativeState: async () => ({ protocolMax: 2, store: { mode: 'off', reason: 'not-enrolled' } }),
      readStorage: async () => ({ usage: 159_000_000, quota: 159_000_000 }),
    });
    const pending = upload({ phase: 'chunk', reason: 'storage-quota', offset: 42_000_000, total: 128_108_229 });
    await jest.advanceTimersByTimeAsync(2001);
    await pending;
    expect(h.deps.post).toHaveBeenCalledTimes(1);
    const body = h.deps.post.mock.calls[0][1].body as string;
    expect(body).toContain('"reason":"storage-quota"');
    expect(body).toContain('"protocolMax":2');
    expect(body).toContain('"mode":"off"');
    expect(body).toContain('"browser":{"usage":159000000,"quota":159000000}');
    expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
