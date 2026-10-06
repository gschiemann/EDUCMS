import { readUploadChunk, UPLOAD_IDLE_TIMEOUT_MS } from '../direct-upload';

it('reads the actual file bytes into a standalone buffer before XHR can send them', async () => {
  const bytes = await readUploadChunk(new Blob([new Uint8Array([1, 17, 255])]));
  expect(Array.from(new Uint8Array(bytes))).toEqual([1, 17, 255]);
});

it('cancels a pending file-provider read when the operator clears the job', async () => {
  const controller = new AbortController();
  const read = readUploadChunk(new Blob(['test']), controller.signal);
  const rejected = expect(read).rejects.toMatchObject({ code: 'aborted' });
  controller.abort();
  await rejected;
});

it('a hung file-provider read fails within the watchdog instead of occupying the queue forever', async () => {
  jest.useFakeTimers();
  const spy = jest.spyOn(FileReader.prototype, 'readAsArrayBuffer').mockImplementation(() => {});
  try {
    const read = readUploadChunk(new Blob(['test']));
    const rejected = expect(read).rejects.toMatchObject({ code: 'storage' });
    jest.advanceTimersByTime(UPLOAD_IDLE_TIMEOUT_MS);
    await rejected;
  } finally { spy.mockRestore(); jest.useRealTimers(); }
});
