import { uploadAssetDirect, UPLOAD_IDLE_TIMEOUT_MS } from '../direct-upload';

class StorageXhr {
  static requests: StorageXhr[] = [];
  upload = { onprogress: undefined as any };
  onprogress: any;
  onload: any;
  onerror: any;
  ontimeout: any;
  onabort: any;
  status = 200;
  responseText = '';
  abort = jest.fn(() => this.onabort?.());
  open() {}
  setRequestHeader() {}
  getResponseHeader() { return null; }
  send() { StorageXhr.requests.push(this); }
}

const originalXhr = global.XMLHttpRequest;
const postJson = jest.fn(async (path: string) => path.endsWith('/presign') ? {
  uploadUrl: 'https://storage.example.test/upload', storagePath: 'test/video.mp4', mimeType: 'video/mp4',
} : { id: 'test-asset', status: 'PUBLISHED' });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

beforeEach(() => {
  jest.useFakeTimers();
  StorageXhr.requests = [];
  postJson.mockClear();
  global.XMLHttpRequest = StorageXhr as any;
});
afterEach(() => { global.XMLHttpRequest = originalXhr; jest.useRealTimers(); });

it('allows a slow, progressing video and clears its watchdog after success', async () => {
  const upload = uploadAssetDirect(new File(['video'], 'test.mp4', { type: 'video/mp4' }), { deps: { postJson: postJson as any } });
  await flush();
  const xhr = StorageXhr.requests[0];
  for (let i = 0; i < 4; i++) {
    jest.advanceTimersByTime(UPLOAD_IDLE_TIMEOUT_MS - 1);
    xhr.upload.onprogress({ loaded: i + 1, lengthComputable: true });
  }
  expect(xhr.abort).not.toHaveBeenCalled();
  xhr.onload();
  await expect(upload).resolves.toMatchObject({ id: 'test-asset' });
  jest.advanceTimersByTime(UPLOAD_IDLE_TIMEOUT_MS * 2);
  expect(xhr.abort).not.toHaveBeenCalled();
});

it('retries an idle connection and completes instead of leaving the queue stuck', async () => {
  const phases: string[] = [];
  const upload = uploadAssetDirect(new File(['video'], 'test.mp4', { type: 'video/mp4' }), {
    onPhase: (phase) => phases.push(phase), deps: { postJson: postJson as any },
  });
  await flush();
  jest.advanceTimersByTime(UPLOAD_IDLE_TIMEOUT_MS);
  await flush();
  expect(StorageXhr.requests[0].abort).toHaveBeenCalledTimes(1);
  expect(phases).toContain('reconnecting');
  jest.advanceTimersByTime(2_000);
  await flush();
  expect(StorageXhr.requests).toHaveLength(2);
  StorageXhr.requests[1].onload();
  await expect(upload).resolves.toMatchObject({ id: 'test-asset' });
  expect(postJson.mock.calls.filter(([path]) => path.endsWith('/complete-upload'))).toHaveLength(1);
});

it('a user abort stops immediately without retrying or registering an asset', async () => {
  const controller = new AbortController();
  const upload = uploadAssetDirect(new File(['video'], 'test.mp4', { type: 'video/mp4' }), {
    signal: controller.signal, deps: { postJson: postJson as any },
  });
  const rejected = expect(upload).rejects.toMatchObject({ code: 'aborted' });
  await flush();
  controller.abort();
  await rejected;
  jest.advanceTimersByTime(UPLOAD_IDLE_TIMEOUT_MS * 2);
  expect(StorageXhr.requests).toHaveLength(1);
  expect(postJson).toHaveBeenCalledTimes(1);
});
