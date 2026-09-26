/* eslint-disable @typescript-eslint/no-explicit-any -- vm / fake-worker harness: replies are untyped by design */
import { getServiceWorkerContainer } from '@/lib/safe-service-worker';
import { lookupCached, precachePlaylist } from '../offline-cache';

// Its own file on purpose: offline-cache.ts memoises the service-worker
// registration at module level, so a second describe in the same file would
// keep talking to the first describe's fake worker.
jest.mock('@/lib/safe-service-worker', () => ({
  getServiceWorkerContainer: jest.fn(),
  isServiceWorkerAvailable: () => true,
}));

class TestMessageChannel {
  port1 = { onmessage: null as ((event: { data: unknown }) => void) | null, close: jest.fn() };
  port2 = { postMessage: (data: unknown) => this.port1.onmessage?.({ data }) };
}

// ── Large-asset orchestration (2026-09-26) ──────────────────────────────────
// The worker answers PRECACHE_PLAYLIST with `pending` for files it will not
// download inside its own event; the page must then drive each of them
// through PRECACHE_CHUNK → PRECACHE_VERIFY → PRECACHE_ASSEMBLE and only call
// the playlist cached when that finished.
describe('player offline-cache large-asset orchestration', () => {
  const MiB = 1024 * 1024;
  const worker = { postMessage: jest.fn() };
  const container = {
    register: jest.fn(async () => ({ active: worker })),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };
  type Port = { postMessage: (data: unknown) => void };
  const sent: Array<Record<string, unknown>> = [];

  beforeAll(() => {
    Object.defineProperty(window, 'caches', { configurable: true, value: {} });
    Object.defineProperty(globalThis, 'MessageChannel', { configurable: true, value: TestMessageChannel });
    jest.mocked(getServiceWorkerContainer).mockReturnValue(container as unknown as ServiceWorkerContainer);
  });

  beforeEach(() => {
    sent.length = 0;
    worker.postMessage.mockReset();
  });

  /** A worker whose replies are computed per message type. */
  function answerWith(fn: (message: Record<string, any>) => unknown) {
    worker.postMessage.mockImplementation((message: Record<string, any>, ports: Port[]) => {
      sent.push(message);
      const reply = fn(message);
      if (reply !== undefined) ports[0].postMessage(reply);
    });
  }

  it('drives a pending large file chunk → verify → assemble and only then reports ok', async () => {
    const url = 'https://cdn.example.com/4k.mp4';
    const size = 3 * 8 * MiB;
    const cached: string[] = [];
    const progress: number[] = [];
    answerWith((m) => {
      switch (m.type) {
        case 'PRECACHE_PLAYLIST': return { ok: false, failures: 0, count: 2, pending: [{ url, sha256: 'ab'.repeat(32), size }] };
        case 'PRECACHE_CHUNK': {
          const next = Math.min(size, m.offset + m.chunkBytes);
          return { ok: true, offset: m.offset, nextOffset: next, total: size, complete: next >= size };
        }
        case 'PRECACHE_VERIFY': return { ok: true, total: size, verified: true };
        case 'PRECACHE_ASSEMBLE': return { ok: true, total: size };
        default: return { ok: false, reason: 'unexpected' };
      }
    });
    const result = await precachePlaylist(
      [{ url: 'https://cdn.example.com/small.jpg', size: 1000 }, { url, sha256: 'ab'.repeat(32), size }],
      undefined,
      { onAssetCached: (u) => cached.push(u), onProgress: (p) => progress.push(p.bytesLoaded) },
    );
    expect(result).toEqual({ ok: true, failures: 0, count: 2 });
    expect(sent.map((m) => m.type)).toEqual([
      'PRECACHE_PLAYLIST', 'PRECACHE_CHUNK', 'PRECACHE_CHUNK', 'PRECACHE_CHUNK', 'PRECACHE_VERIFY', 'PRECACHE_ASSEMBLE',
    ]);
    expect(sent.filter((m) => m.type === 'PRECACHE_CHUNK').map((m) => m.offset)).toEqual([0, 8 * MiB, 16 * MiB]);
    expect(sent[1]).toMatchObject({ url, sha256: 'ab'.repeat(32), size, chunkBytes: 8 * MiB });
    expect(progress).toEqual([8 * MiB, 16 * MiB, size]);
    expect(cached).toEqual([url]);
  });

  it('a worker with nothing pending settles on its own answer', async () => {
    answerWith((m) => (m.type === 'PRECACHE_PLAYLIST' ? { ok: false, failures: 2, count: 3, pending: [] } : undefined));
    await expect(precachePlaylist([{ url: 'https://cdn.example.com/a.jpg' }])).resolves.toEqual({ ok: false, failures: 2, count: 3 });
    expect(sent).toHaveLength(1);
  });

  it('halves the chunk after each failed range and gives up after four in a row, keeping the failure honest', async () => {
    jest.useFakeTimers();
    try {
      answerWith((m) => {
        if (m.type === 'PRECACHE_PLAYLIST') return { ok: false, failures: 0, count: 1, pending: [{ url: 'https://cdn.example.com/4k.mp4', sha256: null, size: 50 * MiB }] };
        if (m.type === 'PRECACHE_CHUNK') return { ok: false, reason: 'fetch-timeout', offset: m.offset };
        return undefined;
      });
      const result = precachePlaylist([{ url: 'https://cdn.example.com/4k.mp4', size: 50 * MiB }]);
      for (let i = 0; i < 8; i++) await jest.advanceTimersByTimeAsync(3_000);
      await expect(result).resolves.toEqual({ ok: false, failures: 1, count: 1 });
      expect(sent.filter((m) => m.type === 'PRECACHE_CHUNK').map((m) => m.chunkBytes)).toEqual([8 * MiB, 4 * MiB, 2 * MiB, MiB]);
      expect(sent.some((m) => m.type === 'PRECACHE_VERIFY')).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops an asset at once on a reason that says the source itself is wrong', async () => {
    answerWith((m) => {
      if (m.type === 'PRECACHE_PLAYLIST') return { ok: false, failures: 0, count: 1, pending: [{ url: 'https://cdn.example.com/4k.mp4', sha256: null, size: 50 * MiB }] };
      if (m.type === 'PRECACHE_CHUNK') return { ok: false, reason: 'source-changed', offset: 0 };
      return undefined;
    });
    await expect(precachePlaylist([{ url: 'https://cdn.example.com/4k.mp4', size: 50 * MiB }])).resolves.toEqual({ ok: false, failures: 1, count: 1 });
    expect(sent.filter((m) => m.type === 'PRECACHE_CHUNK')).toHaveLength(1);
  });

  it('resumes from where PRECACHE_VERIFY says the staged run stops', async () => {
    const url = 'https://cdn.example.com/4k.mp4';
    const size = 16 * MiB;
    let verifies = 0;
    answerWith((m) => {
      switch (m.type) {
        case 'PRECACHE_PLAYLIST': return { ok: false, failures: 0, count: 1, pending: [{ url, sha256: null, size }] };
        case 'PRECACHE_CHUNK': {
          const next = Math.min(size, m.offset + m.chunkBytes);
          return { ok: true, offset: m.offset, nextOffset: next, total: size, complete: next >= size };
        }
        case 'PRECACHE_VERIFY':
          verifies += 1;
          return verifies === 1 ? { ok: false, reason: 'incomplete', nextOffset: 8 * MiB, total: size } : { ok: true, total: size, verified: false };
        case 'PRECACHE_ASSEMBLE': return { ok: true, total: size };
        default: return undefined;
      }
    });
    jest.useFakeTimers();
    try {
      const result = precachePlaylist([{ url, size }]);
      for (let i = 0; i < 4; i++) await jest.advanceTimersByTimeAsync(3_000);
      await expect(result).resolves.toEqual({ ok: true, failures: 0, count: 1 });
    } finally {
      jest.useRealTimers();
    }
    // 0, 8 MiB, then verify said "you are missing from 8 MiB" → 8 MiB again (halved chunk), 12 MiB
    expect(sent.filter((m) => m.type === 'PRECACHE_CHUNK').map((m) => [m.offset, m.chunkBytes])).toEqual([
      [0, 8 * MiB], [8 * MiB, 8 * MiB], [8 * MiB, 4 * MiB], [12 * MiB, 4 * MiB],
    ]);
    expect(verifies).toBe(2);
  });

  it('an abort between steps ends the attempt and says so', async () => {
    const controller = new AbortController();
    answerWith((m) => {
      if (m.type === 'PRECACHE_PLAYLIST') return { ok: false, failures: 0, count: 1, pending: [{ url: 'https://cdn.example.com/4k.mp4', sha256: null, size: 40 * MiB }] };
      if (m.type === 'PRECACHE_CHUNK') { controller.abort(); return { ok: true, offset: 0, nextOffset: 8 * MiB, total: 40 * MiB, complete: false }; }
      return undefined;
    });
    await expect(precachePlaylist([{ url: 'https://cdn.example.com/4k.mp4', size: 40 * MiB }], undefined, { signal: controller.signal }))
      .resolves.toEqual({ ok: false, failures: 0, count: 1, aborted: true });
    expect(sent.filter((m) => m.type === 'PRECACHE_CHUNK')).toHaveLength(1);
  });

  it('lookupCached maps the worker answer and treats no reply as unknown', async () => {
    answerWith((m) => (m.type === 'CACHE_LOOKUP' ? { ok: true, cached: { 'https://a/x.mp4': true, 'https://a/y.mp4': false } } : undefined));
    await expect(lookupCached([{ url: 'https://a/x.mp4', sha256: 'ab'.repeat(32) }, { url: 'https://a/y.mp4' }]))
      .resolves.toEqual({ 'https://a/x.mp4': true, 'https://a/y.mp4': false });
    expect(sent[0]).toEqual({ type: 'CACHE_LOOKUP', urls: [{ url: 'https://a/x.mp4', sha256: 'ab'.repeat(32) }, { url: 'https://a/y.mp4', sha256: null }] });
    jest.useFakeTimers();
    try {
      answerWith(() => undefined);
      const pending = lookupCached([{ url: 'https://a/x.mp4' }]);
      await jest.advanceTimersByTimeAsync(5_000);
      await expect(pending).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
