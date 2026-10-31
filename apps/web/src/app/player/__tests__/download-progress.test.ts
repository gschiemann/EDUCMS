/* eslint-disable @typescript-eslint/no-explicit-any -- fake-worker harness */
import { getServiceWorkerContainer } from '@/lib/safe-service-worker';
import { precachePlaylist, type PlaylistCacheProgress } from '../offline-cache';
import { __resetDigestQuarantineForTests } from '../digestQuarantine';
import { downloadBarPercent, downloadProgressLabel } from '../downloadProgress';

// Own file: offline-cache.ts memoises the worker registration per module.
jest.mock('@/lib/safe-service-worker', () => ({
  getServiceWorkerContainer: jest.fn(),
  isServiceWorkerAvailable: () => true,
}));

class TestMessageChannel {
  port1 = { onmessage: null as ((event: { data: unknown }) => void) | null, close: jest.fn() };
  port2 = { postMessage: (data: unknown) => this.port1.onmessage?.({ data }) };
}

const MiB = 1024 * 1024;
const fmt = (n: number) => `${Math.round(n / MiB)} MiB`;

describe('download progress label / bar', () => {
  it('shows bytes while downloading, named phases afterwards', () => {
    const base = { name: 'a.mp4', bytesTotal: 100 * MiB };
    expect(downloadProgressLabel({ ...base, bytesLoaded: 29 * MiB, phase: 'downloading' }, fmt)).toBe(
      'a.mp4 — 29% (29 MiB of 100 MiB)',
    );
    expect(downloadProgressLabel({ ...base, bytesLoaded: 50 * MiB, phase: 'verifying' }, fmt)).toBe(
      'a.mp4 — verifying… 50%',
    );
    expect(downloadProgressLabel({ ...base, bytesLoaded: 0, phase: 'verifying' }, fmt)).toBe('a.mp4 — verifying…');
    expect(downloadProgressLabel({ ...base, bytesLoaded: 100 * MiB, phase: 'finishing' }, fmt)).toBe(
      'a.mp4 — finishing…',
    );
    expect(downloadProgressLabel({ name: 'a.mp4', bytesLoaded: 3 * MiB, bytesTotal: null }, fmt)).toBe(
      'a.mp4 — 3 MiB so far',
    );
  });

  it('bar never exceeds 100 and is full while finishing', () => {
    expect(downloadBarPercent({ name: 'a', bytesLoaded: 200, bytesTotal: 100 })).toBe(100);
    expect(downloadBarPercent({ name: 'a', bytesLoaded: 1, bytesTotal: 100, phase: 'finishing' })).toBe(100);
    expect(downloadBarPercent({ name: 'a', bytesLoaded: 1, bytesTotal: null })).toBeNull();
  });
});

describe('precachePlaylist progress inside a step', () => {
  const worker = { postMessage: jest.fn() };
  const container = {
    register: jest.fn(async () => ({ active: worker })),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  };

  beforeAll(() => {
    Object.defineProperty(window, 'caches', { configurable: true, value: {} });
    Object.defineProperty(globalThis, 'MessageChannel', { configurable: true, value: TestMessageChannel });
    jest.mocked(getServiceWorkerContainer).mockReturnValue(container as unknown as ServiceWorkerContainer);
  });
  beforeEach(() => {
    __resetDigestQuarantineForTests();
    try { window.localStorage.clear(); } catch { /* jsdom */ }
  });

  it('reports live bytes mid-chunk, then verifying, then finishing, in order', async () => {
    const url = 'https://cdn.example.com/4k.mp4';
    const size = 16 * MiB;
    worker.postMessage.mockImplementation((m: Record<string, any>, ports: Array<{ postMessage: (d: unknown) => void }>) => {
      const port = ports[0];
      switch (m.type) {
        case 'PRECACHE_PLAYLIST':
          port.postMessage({ ok: false, pending: [{ url, size }] });
          break;
        case 'PRECACHE_CHUNK':
          // Progress frames never settle the step; only the final reply does.
          port.postMessage({ progress: true, phase: 'chunk', done: 2 * MiB, total: size });
          port.postMessage({ progress: true, phase: 'chunk', done: 9 * MiB, total: size });
          port.postMessage({ ok: true, nextOffset: size, total: size, complete: true });
          break;
        case 'PRECACHE_VERIFY':
          port.postMessage({ progress: true, phase: 'verify', done: 8 * MiB, total: size });
          port.postMessage({ ok: true, verified: true });
          break;
        case 'PRECACHE_ASSEMBLE':
          port.postMessage({ ok: true });
          break;
        default:
          port.postMessage({ ok: false });
      }
    });
    const seen: PlaylistCacheProgress[] = [];
    const result = await precachePlaylist([{ url, size }], undefined, { onProgress: (p) => seen.push(p) });
    expect(result.ok).toBe(true);
    const trace = seen.map((p) => `${p.phase}:${Math.round(p.bytesLoaded / MiB)}`);
    expect(trace).toEqual([
      'downloading:2',
      'downloading:9',
      'downloading:16',
      'verifying:0',
      'verifying:8',
      'finishing:16',
    ]);
  });
});
