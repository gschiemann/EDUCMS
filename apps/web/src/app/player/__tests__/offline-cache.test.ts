import { getServiceWorkerContainer } from '@/lib/safe-service-worker';
import { getCacheStatus, precachePlaylist } from '../offline-cache';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';

jest.mock('@/lib/safe-service-worker', () => ({
  getServiceWorkerContainer: jest.fn(),
  isServiceWorkerAvailable: () => true,
}));

class TestMessageChannel {
  port1 = { onmessage: null as ((event: { data: unknown }) => void) | null, close: jest.fn() };
  port2 = { postMessage: (data: unknown) => this.port1.onmessage?.({ data }) };
}

describe('player offline-cache acknowledgements', () => {
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
    worker.postMessage.mockReset();
    container.addEventListener.mockClear();
    container.removeEventListener.mockClear();
  });

  it('does not call a playlist cached until the worker confirms it', async () => {
    worker.postMessage.mockImplementation((_message, ports: TestMessageChannel['port2'][]) => {
      ports[0].postMessage({ ok: false, failures: 1, count: 1 });
    });
    await expect(precachePlaylist([{ url: 'https://cdn.example.com/video.mp4', size: 141_245_550 }]))
      .resolves.toEqual({ ok: false, failures: 1, count: 1 });
    expect(worker.postMessage).toHaveBeenCalledWith(
      { type: 'PRECACHE_PLAYLIST', assets: [{ url: 'https://cdn.example.com/video.mp4', size: 141_245_550 }], softCapBytes: undefined },
      [expect.objectContaining({ postMessage: expect.any(Function) })],
    );
  });

  it('retries promptly when an older worker never acknowledges the request', async () => {
    jest.useFakeTimers();
    try {
      const result = precachePlaylist([{ url: 'https://cdn.example.com/video.mp4' }]);
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(15_000);
      await expect(result).resolves.toEqual({ ok: false });
    } finally {
      jest.useRealTimers();
    }
  });

  it('allows a current worker time to finish a large download after it starts', async () => {
    jest.useFakeTimers();
    try {
      let reply: TestMessageChannel['port2'] | undefined;
      worker.postMessage.mockImplementation((_message, ports: TestMessageChannel['port2'][]) => {
        reply = ports[0];
        reply.postMessage({ started: true });
      });
      const result = precachePlaylist([{ url: 'https://cdn.example.com/video.mp4' }]);
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(15_000);
      reply!.postMessage({ ok: true, failures: 0, count: 1 });
      await expect(result).resolves.toEqual({ ok: true, failures: 0, count: 1 });
    } finally {
      jest.useRealTimers();
    }
  });

  it('treats a missing cache-status reply as unknown, never as zero files', async () => {
    jest.useFakeTimers();
    try {
      const status = getCacheStatus();
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(2_000);
      await expect(status).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('the real service worker reports failed and successful playlist writes separately', async () => {
    const source = readFileSync(resolve(__dirname, '../../../../public/sw-player.js'), 'utf8');
    const cache = { keys: async () => [], delete: async () => true, match: async () => undefined };
    const handlers: Record<string, (event: { data: unknown; ports: unknown[]; waitUntil: (promise: Promise<unknown>) => void }) => void> = {};
    const context = createContext({
      self: { location: { origin: 'https://venue-os.app' }, addEventListener: (type: string, handler: typeof handlers[string]) => { handlers[type] = handler; }, clients: { matchAll: async () => [] } },
      caches: { open: async () => cache }, URL, console, setTimeout, clearTimeout, Map, Set, Date,
    });
    runInContext(source, context);
    const reports: Array<{ ok: boolean; failures: number; count: number }> = [];
    (context as Record<string, unknown>).ack = { postMessage: (value: { ok: boolean; failures: number; count: number }) => reports.push(value) };
    runInContext('fetchAndStore = async () => false', context);
    await runInContext("precachePlaylist([{url:'https://cdn.example.com/video.mp4'}], 5000000000, ack)", context);
    expect(reports.pop()).toEqual({ ok: false, failures: 1, count: 1 });
    runInContext('fetchAndStore = async () => true', context);
    await runInContext("precachePlaylist([{url:'https://cdn.example.com/video.mp4'}], 5000000000, ack)", context);
    expect(reports.pop()).toEqual({ ok: true, failures: 0, count: 1 });

    const messages: Array<{ started?: boolean; ok?: boolean }> = [];
    let pending: Promise<unknown> = Promise.resolve();
    handlers.message({
      data: { type: 'PRECACHE_PLAYLIST', assets: [{ url: 'https://cdn.example.com/video.mp4' }] },
      ports: [{ postMessage: (value: { started?: boolean; ok?: boolean }) => messages.push(value) }],
      waitUntil: (promise) => { pending = promise; },
    });
    expect(messages[0]).toEqual({ started: true });
    await pending;
    expect(messages.at(-1)).toMatchObject({ ok: true });
  });
});
