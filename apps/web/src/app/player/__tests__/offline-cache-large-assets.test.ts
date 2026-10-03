/* eslint-disable @typescript-eslint/no-explicit-any -- vm / fake-worker harness: replies are untyped by design */
import { getServiceWorkerContainer } from '@/lib/safe-service-worker';
import { lookupCached, precacheEmergency, precachePlaylist, quarantinedDigestCount } from '../offline-cache';
import { __resetDigestQuarantineForTests, quarantineKey } from '../digestQuarantine';
import { __resetPlaybackSafetyForTests } from '../playbackSafety';

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
    try { window.localStorage.clear(); } catch { /* jsdom */ }
    __resetDigestQuarantineForTests();
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

  it('an adoptable pending file is hashed in place first — adopted: no chunk is ever requested', async () => {
    const url = 'https://cdn.example.com/legacy-4k.mp4';
    const cached: string[] = [];
    answerWith((m) => {
      switch (m.type) {
        case 'PRECACHE_PLAYLIST': return { ok: false, failures: 0, count: 1, pending: [{ url, sha256: 'ab'.repeat(32), size: 141_245_550, adoptable: true }] };
        case 'PRECACHE_ADOPT': return { ok: true, adopted: true, total: 141_245_550 };
        default: return { ok: false, reason: 'unexpected' };
      }
    });
    const result = await precachePlaylist([{ url, sha256: 'ab'.repeat(32), size: 141_245_550 }], undefined, { onAssetCached: (u) => cached.push(u) });
    expect(result).toEqual({ ok: true, failures: 0, count: 1 });
    expect(sent.map((m) => m.type)).toEqual(['PRECACHE_PLAYLIST', 'PRECACHE_ADOPT']);
    expect(sent[1]).toEqual({ type: 'PRECACHE_ADOPT', url, sha256: 'ab'.repeat(32) });
    expect(cached).toEqual([url]);
  });

  it('an adoptable file whose bytes do not match falls through to the verified download', async () => {
    const url = 'https://cdn.example.com/legacy-4k.mp4';
    const size = 8 * MiB;
    answerWith((m) => {
      switch (m.type) {
        case 'PRECACHE_PLAYLIST': return { ok: false, failures: 0, count: 1, pending: [{ url, sha256: 'ab'.repeat(32), size, adoptable: true }] };
        case 'PRECACHE_ADOPT': return { ok: false, reason: 'sha256-mismatch' };
        case 'PRECACHE_CHUNK': return { ok: true, offset: 0, nextOffset: size, total: size, complete: true };
        case 'PRECACHE_VERIFY': return { ok: true, total: size, verified: true };
        case 'PRECACHE_ASSEMBLE': return { ok: true, total: size };
        default: return { ok: false, reason: 'unexpected' };
      }
    });
    await expect(precachePlaylist([{ url, sha256: 'ab'.repeat(32), size }])).resolves.toEqual({ ok: true, failures: 0, count: 1 });
    expect(sent.map((m) => m.type)).toEqual(['PRECACHE_PLAYLIST', 'PRECACHE_ADOPT', 'PRECACHE_CHUNK', 'PRECACHE_VERIFY', 'PRECACHE_ASSEMBLE']);
  });

  it('a pending file that is NOT adoptable (nothing on disk, or no digest) never asks for an adopt', async () => {
    const url = 'https://cdn.example.com/4k.mp4';
    const size = 8 * MiB;
    answerWith((m) => {
      switch (m.type) {
        case 'PRECACHE_PLAYLIST': return { ok: false, failures: 0, count: 1, pending: [{ url, sha256: null, size, adoptable: true }] };
        case 'PRECACHE_CHUNK': return { ok: true, offset: 0, nextOffset: size, total: size, complete: true };
        case 'PRECACHE_VERIFY': return { ok: true, total: size, verified: false };
        case 'PRECACHE_ASSEMBLE': return { ok: true, total: size };
        default: return { ok: false, reason: 'unexpected' };
      }
    });
    await expect(precachePlaylist([{ url, size }])).resolves.toEqual({ ok: true, failures: 0, count: 1 });
    expect(sent.some((m) => m.type === 'PRECACHE_ADOPT')).toBe(false);
  });

  it('a complete download that fails verification is quarantined: the next attempts fetch nothing, a new digest fetches again', async () => {
    const url = 'https://cdn.example.com/4k.mp4?token=one';
    const size = 8 * MiB;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      answerWith((m) => {
        switch (m.type) {
          case 'PRECACHE_PLAYLIST': return { ok: false, failures: 0, count: 1, pending: [{ url: m.assets[0].url, sha256: m.assets[0].sha256, size, adoptable: false }] };
          case 'PRECACHE_CHUNK': return { ok: true, offset: 0, nextOffset: size, total: size, complete: true };
          case 'PRECACHE_VERIFY': return { ok: false, reason: 'sha256-mismatch' };
          default: return { ok: false, reason: 'unexpected' };
        }
      });
      // First attempt: downloaded whole, failed verification, purged — one failure.
      await expect(precachePlaylist([{ url, sha256: 'ab'.repeat(32), size }])).resolves.toEqual({ ok: false, failures: 1, count: 1 });
      expect(sent.filter((m) => m.type === 'PRECACHE_CHUNK')).toHaveLength(1);
      expect(quarantinedDigestCount()).toBe(1);

      // Retry ticks (same pair, even under a rotated token): still a failure,
      // still not ready — but NOT a single byte requested, and one log line.
      sent.length = 0;
      await expect(precachePlaylist([{ url: url.replace('one', 'two'), sha256: 'ab'.repeat(32), size }])).resolves.toEqual({ ok: false, failures: 1, count: 1 });
      await expect(precachePlaylist([{ url, sha256: 'ab'.repeat(32), size }])).resolves.toEqual({ ok: false, failures: 1, count: 1 });
      expect(sent.map((m) => m.type)).toEqual(['PRECACHE_PLAYLIST', 'PRECACHE_PLAYLIST']);
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('not downloading it again'))).toHaveLength(1);

      // The row was fixed: a new digest for the URL is a new pair and downloads.
      sent.length = 0;
      await precachePlaylist([{ url, sha256: 'cd'.repeat(32), size }]);
      expect(sent.map((m) => m.type)).toEqual(['PRECACHE_PLAYLIST', 'PRECACHE_CHUNK', 'PRECACHE_VERIFY']);
    } finally {
      warn.mockRestore();
    }
  });

  it('an INCOMPLETE attempt is never quarantined — only a complete download that hashed wrong is', async () => {
    const url = 'https://cdn.example.com/4k.mp4';
    const size = 16 * MiB;
    answerWith((m) => {
      switch (m.type) {
        case 'PRECACHE_PLAYLIST': return { ok: false, failures: 0, count: 1, pending: [{ url, sha256: 'ab'.repeat(32), size, adoptable: false }] };
        case 'PRECACHE_CHUNK': return { ok: false, reason: 'source-changed', offset: 0 };
        default: return { ok: false, reason: 'unexpected' };
      }
    });
    await expect(precachePlaylist([{ url, sha256: 'ab'.repeat(32), size }])).resolves.toEqual({ ok: false, failures: 1, count: 1 });
    expect(quarantinedDigestCount()).toBe(0);
    sent.length = 0;
    await precachePlaylist([{ url, sha256: 'ab'.repeat(32), size }]);
    expect(sent.some((m) => m.type === 'PRECACHE_CHUNK')).toBe(true); // it tried again
  });

  // ── Emergency tier, large files (2026-09-26, Greg signed off) ─────────
  // `ok: true` means FULL success and nothing less: every pending large file
  // driven (with tier 'emergency' on every step) AND the worker's confirm pass
  // found the whole set cached. The page commits lastEmergencySetHashRef on
  // exactly that `ok` (player-014), so a large file that did not land leaves
  // the set uncommitted and the next sync resumes it.
  describe('precacheEmergency', () => {
    const EM = 'https://cdn.example.com/lockdown-4k.mp4';
    const size = 9 * MiB;
    const assets = [{ url: 'https://cdn.example.com/lockdown.png', sha256: 'aa'.repeat(32), size: 1000 }, { url: EM, sha256: 'bb'.repeat(32), size }];

    it('drives a pending large file with tier emergency on every step, then re-pushes; ok only from the confirm pass', async () => {
      let pushes = 0;
      answerWith((m) => {
        switch (m.type) {
          case 'PRECACHE_EMERGENCY':
            pushes += 1;
            return pushes === 1
              ? { ok: false, failures: 0, count: 2, pending: [{ url: EM, sha256: 'bb'.repeat(32), size, adoptable: false }] }
              : { ok: true, failures: 0, count: 2, pending: [] };
          case 'PRECACHE_CHUNK': return { ok: true, offset: m.offset, nextOffset: Math.min(size, m.offset + m.chunkBytes), total: size, complete: m.offset + m.chunkBytes >= size };
          case 'PRECACHE_VERIFY': return { ok: true, total: size, verified: true };
          case 'PRECACHE_ASSEMBLE': return { ok: true, total: size };
          default: return { ok: false, reason: 'unexpected' };
        }
      });
      await expect(precacheEmergency(assets, 'set-1')).resolves.toEqual({ ok: true, failures: 0, count: 2, pending: 0 });
      expect(sent.map((m) => m.type)).toEqual([
        'PRECACHE_EMERGENCY', 'PRECACHE_CHUNK', 'PRECACHE_CHUNK', 'PRECACHE_VERIFY', 'PRECACHE_ASSEMBLE', 'PRECACHE_EMERGENCY',
      ]);
      // Every staging step names the emergency tier — never the playlist default.
      for (const m of sent.filter((x) => x.type !== 'PRECACHE_EMERGENCY')) expect(m.tier).toBe('emergency');
      expect(sent[0]).toEqual({ type: 'PRECACHE_EMERGENCY', assets, setHash: 'set-1' });
      expect(sent[5]).toEqual({ type: 'PRECACHE_EMERGENCY', assets, setHash: 'set-1' });
    });

    it('a large file that did not land: ok false, NO confirm pass — the set stays uncommitted for the next sync to resume', async () => {
      answerWith((m) => {
        switch (m.type) {
          case 'PRECACHE_EMERGENCY': return { ok: false, failures: 0, count: 2, pending: [{ url: EM, sha256: 'bb'.repeat(32), size, adoptable: false }] };
          case 'PRECACHE_CHUNK': return { ok: false, reason: 'source-changed', offset: 0 };
          default: return { ok: false, reason: 'unexpected' };
        }
      });
      await expect(precacheEmergency(assets, 'set-1')).resolves.toEqual({ ok: false, failures: 1, count: 2, pending: 1 });
      expect(sent.filter((m) => m.type === 'PRECACHE_EMERGENCY')).toHaveLength(1);
    });

    it('a confirm pass that still says not-ok is not-ok (a small file failed meanwhile): never a false full success', async () => {
      let pushes = 0;
      answerWith((m) => {
        switch (m.type) {
          case 'PRECACHE_EMERGENCY':
            pushes += 1;
            return pushes === 1
              ? { ok: false, failures: 0, count: 2, pending: [{ url: EM, sha256: 'bb'.repeat(32), size, adoptable: true }] }
              : { ok: false, failures: 1, count: 2, pending: [] };
          case 'PRECACHE_ADOPT': return { ok: true, adopted: true, total: size };
          default: return { ok: false, reason: 'unexpected' };
        }
      });
      await expect(precacheEmergency(assets, 'set-1')).resolves.toEqual({ ok: false, failures: 1, count: 2, pending: 0 });
      expect(sent.map((m) => m.type)).toEqual(['PRECACHE_EMERGENCY', 'PRECACHE_ADOPT', 'PRECACHE_EMERGENCY']);
      expect(sent[1]).toEqual({ type: 'PRECACHE_ADOPT', url: EM, sha256: 'bb'.repeat(32), tier: 'emergency' });
    });

    it('nothing pending (small files only, or an older worker with no pending field): one pass, the ack as-is', async () => {
      answerWith((m) => (m.type === 'PRECACHE_EMERGENCY' ? { ok: true, failures: 0, count: 1 } : undefined));
      await expect(precacheEmergency([assets[0]], 'set-2')).resolves.toEqual({ ok: true, failures: 0, count: 1 });
      expect(sent).toHaveLength(1);
      answerWith((m) => (m.type === 'PRECACHE_EMERGENCY' ? { ok: false, failures: 1, count: 1, pending: [] } : undefined));
      await expect(precacheEmergency([assets[0]], 'set-2')).resolves.toEqual({ ok: false, failures: 1, count: 1 });
      expect(sent).toHaveLength(2);
    });
  });

  // ── A set-aside file keeps its bytes (2026-10-03 review) ──────────────────
  // playbackSafety sets a file aside for six hours after it interrupted the
  // screen twice. The worker prunes every cached entry and every staged partial
  // download that is not in the list it is sent — so leaving the file out of that
  // list deleted its cache entry and its resume point. It must ride keepUrls.
  describe('a file set aside by the playback circuit breaker', () => {
    const aside = { url: 'https://cdn.example.com/aside.mp4?token=t1', sha256: 'cd'.repeat(32), size: 64 * MiB };
    const fine = { url: 'https://cdn.example.com/fine.mp4', sha256: 'ef'.repeat(32), size: 9 * MiB };
    const setAside = (asset: { url: string; sha256: string }) => {
      window.localStorage.setItem('edu_normal_playback_safety_v1', JSON.stringify({
        safeUntil: 0, pending: [],
        failures: [{ key: `${quarantineKey(asset.url)}#${asset.sha256}`, count: 2, until: Date.now() + 60 * 60_000 }],
      }));
      __resetPlaybackSafetyForTests();
    };
    afterEach(() => { window.localStorage.clear(); __resetPlaybackSafetyForTests(); });

    it('is not downloaded, and is named in keepUrls so the worker prunes neither its cache entry nor its partial download', async () => {
      setAside(aside);
      answerWith((m) => (m.type === 'PRECACHE_PLAYLIST' ? { ok: true, failures: 0, count: 1, pending: [] } : undefined));
      const result = await precachePlaylist([aside, fine], undefined, { keepUrls: ['https://cdn.example.com/on-glass.mp4'] });
      expect(sent).toHaveLength(1);
      expect(sent[0].assets).toEqual([fine]);
      expect(sent[0].keepUrls).toEqual(['https://cdn.example.com/on-glass.mp4', aside.url]);
      // Still honest: the playlist is not fully cached while a file is set aside.
      expect(result).toEqual({ ok: false, failures: 1, count: 1 });
    });

    it('leaves keepUrls exactly as the caller gave them when nothing is set aside (control)', async () => {
      answerWith((m) => (m.type === 'PRECACHE_PLAYLIST' ? { ok: true, failures: 0, count: 2, pending: [] } : undefined));
      await precachePlaylist([aside, fine], undefined, { keepUrls: ['https://cdn.example.com/on-glass.mp4'] });
      expect(sent[0].assets).toEqual([aside, fine]);
      expect(sent[0].keepUrls).toEqual(['https://cdn.example.com/on-glass.mp4']);
    });

    it('sends the worker nothing at all when every file is set aside — nothing is pruned', async () => {
      setAside(aside);
      answerWith(() => ({ ok: true, failures: 0, count: 0, pending: [] }));
      await expect(precachePlaylist([aside])).resolves.toEqual({ ok: false, failures: 1, count: 1 });
      expect(sent).toHaveLength(0);
    });
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

  it('lookupCached maps the worker answer (present vs current) and treats no reply as unknown', async () => {
    answerWith((m) => (m.type === 'CACHE_LOOKUP'
      ? {
          ok: true,
          cached: { 'https://a/x.mp4': true, 'https://a/y.mp4': false, 'https://a/legacy.mp4': false },
          present: { 'https://a/x.mp4': true, 'https://a/y.mp4': false, 'https://a/legacy.mp4': true },
        }
      : undefined));
    await expect(lookupCached([{ url: 'https://a/x.mp4', sha256: 'ab'.repeat(32) }, { url: 'https://a/y.mp4' }, { url: 'https://a/legacy.mp4', sha256: 'cd'.repeat(32) }]))
      .resolves.toEqual({
        'https://a/x.mp4': { present: true, current: true },
        'https://a/y.mp4': { present: false, current: false },
        // On disk but never digest-verified: playable now, adopted by the drive.
        'https://a/legacy.mp4': { present: true, current: false },
      });
    expect(sent[0]).toEqual({ type: 'CACHE_LOOKUP', urls: [{ url: 'https://a/x.mp4', sha256: 'ab'.repeat(32) }, { url: 'https://a/y.mp4', sha256: null }, { url: 'https://a/legacy.mp4', sha256: 'cd'.repeat(32) }] });
    // An older worker answers `cached` only: present is read as current.
    answerWith((m) => (m.type === 'CACHE_LOOKUP' ? { ok: true, cached: { 'https://a/x.mp4': true } } : undefined));
    await expect(lookupCached([{ url: 'https://a/x.mp4' }])).resolves.toEqual({ 'https://a/x.mp4': { present: true, current: true } });
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
