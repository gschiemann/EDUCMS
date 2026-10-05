/**
 * waitForScreenVersion (2026-10-05) — a picker that keeps a URL BY VALUE waits
 * for a MOV / AVI / …'s converted MP4 instead of keeping the original's URL.
 * The status bodies are cut from the producer: GET /assets/optimization answers
 * the job (VideoTranscodeService.statusForAssets) plus the asset's current
 * `fileUrl` / `mimeType` (AssetsController.optimizationStatus).
 */
import {
  SCREEN_VERSION_MAX_WAIT_MS,
  SCREEN_VERSION_POLL_MS,
  SCREEN_VERSION_QUEUE_GRACE_MS,
  ScreenVersionError,
  waitForScreenVersion,
  type ScreenVersionStatus,
} from '../screen-version';

const MOV = 'https://x.supabase.co/storage/v1/object/public/assets/t/0f6b1c2d.mov';
const MP4 = 'https://x.supabase.co/storage/v1/object/public/assets/t/optimized/9a8b7c6d.mp4';

const st = (over: Partial<ScreenVersionStatus>): ScreenVersionStatus => ({
  status: 'queued',
  reason: null,
  progress: null,
  fileUrl: MOV,
  mimeType: 'video/quicktime',
  ...over,
});

/** A fake clock and a scripted status feed; `sleep` advances the clock. */
function harness(feed: Array<ScreenVersionStatus | null | Error>) {
  let now = 0;
  const reads: number[] = [];
  const deps = {
    getStatus: jest.fn(async () => {
      reads.push(now);
      const next = feed.length > 1 ? feed.shift()! : feed[0];
      if (next instanceof Error) throw next;
      return next;
    }),
    sleep: jest.fn(async (ms: number) => {
      now += ms;
    }),
    now: () => now,
  };
  return { deps, reads, get now() { return now; } };
}

describe('waitForScreenVersion', () => {
  it('queued → running 37 % → done: returns the MP4 URL, reporting progress on the way', async () => {
    const h = harness([
      st({ status: 'queued' }),
      st({ status: 'running', progress: 37 }),
      st({ status: 'done', reason: 'swapped', progress: 100, fileUrl: MP4, mimeType: 'video/mp4' }),
    ]);
    const progress: Array<number | null> = [];
    const r = await waitForScreenVersion('asset-1', { deps: h.deps, onProgress: (p) => progress.push(p) });
    expect(r).toEqual({ fileUrl: MP4, mimeType: 'video/mp4' });
    expect(progress).toEqual([null, 37, 100]);
    expect(h.deps.getStatus).toHaveBeenCalledWith('asset-1');
    expect(h.reads).toEqual([0, SCREEN_VERSION_POLL_MS, 2 * SCREEN_VERSION_POLL_MS]);
  });

  it('a conversion that FAILED is said — the original URL is never handed back', async () => {
    const h = harness([st({ status: 'failed', reason: 'ffmpeg-failed' })]);
    await expect(waitForScreenVersion('asset-1', { deps: h.deps })).rejects.toMatchObject({ code: 'failed' });
  });

  it('NEGATIVE CONTROL: "done" while the asset still serves the QuickTime original is NOT a success', async () => {
    const h = harness([st({ status: 'done', reason: 'rendition-created' })]);
    await expect(waitForScreenVersion('asset-1', { deps: h.deps })).rejects.toBeInstanceOf(ScreenVersionError);
  });

  it('no job yet is waited for (the upload queues it a moment later)…', async () => {
    const h = harness([null, null, st({ status: 'done', fileUrl: MP4, mimeType: 'video/mp4' })]);
    await expect(waitForScreenVersion('asset-1', { deps: h.deps })).resolves.toMatchObject({ fileUrl: MP4 });
  });

  it('…but no job long after the upload means it will never be converted', async () => {
    const h = harness([null]);
    await expect(waitForScreenVersion('asset-1', { deps: h.deps })).rejects.toMatchObject({ code: 'failed' });
    expect(h.now).toBeGreaterThan(SCREEN_VERSION_QUEUE_GRACE_MS);
    expect(h.now).toBeLessThan(SCREEN_VERSION_QUEUE_GRACE_MS + 2 * SCREEN_VERSION_POLL_MS);
  });

  it('a status read that fails (a network blip) is retried, never fatal', async () => {
    const h = harness([new Error('fetch failed'), new Error('fetch failed'), st({ status: 'done', fileUrl: MP4, mimeType: 'video/mp4' })]);
    await expect(waitForScreenVersion('asset-1', { deps: h.deps })).resolves.toMatchObject({ fileUrl: MP4 });
  });

  it('gives up after the bound with "still converting" — the file stays in the library', async () => {
    const h = harness([st({ status: 'running', progress: 1 })]);
    await expect(waitForScreenVersion('asset-1', { deps: h.deps })).rejects.toMatchObject({ code: 'timeout' });
    expect(h.now).toBeGreaterThan(SCREEN_VERSION_MAX_WAIT_MS);
  });

  it('stops when the picker closes (abort)', async () => {
    const ctl = new AbortController();
    const h = harness([st({ status: 'running', progress: 5 })]);
    h.deps.sleep.mockImplementation(async () => {
      ctl.abort();
    });
    await expect(waitForScreenVersion('asset-1', { deps: h.deps, signal: ctl.signal })).rejects.toMatchObject({ code: 'aborted' });
    expect(h.deps.getStatus).toHaveBeenCalledTimes(1);
  });
});
