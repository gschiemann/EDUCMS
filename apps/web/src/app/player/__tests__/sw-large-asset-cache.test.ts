/**
 * @jest-environment node
 *
 * The REAL service worker (public/sw-player.js) vm-loaded with Node's web
 * primitives (Response / ReadableStream / Blob / crypto) over an in-memory
 * CacheStorage and a fetch that speaks HTTP Range. This drives the large-asset
 * staging protocol exactly the way offline-cache.ts drives it and checks the
 * bytes that end up under the playlist URL against node:crypto.
 *
 * Why a node environment: jsdom has no Response/ReadableStream, and these
 * are the objects whose streaming behaviour the fix depends on.
 */
import { randomBytes } from 'node:crypto';
import { drive, loadWorker, rangeFetch, sha256Hex, MiB, ORIGIN, type RangeServer } from './swHarness';

describe('sw-player large-asset staging', () => {
  const URL_4K = 'https://cdn.example.com/storage/v1/object/public/assets/t1/4k.mp4?token=abc';

  it('PRECACHE_PLAYLIST leaves a large asset undownloaded and reports it as pending', async () => {
    const w = loadWorker();
    const server: RangeServer = { file: randomBytes(64 * 1024), calls: [] };
    w.setFetch(rangeFetch(server));
    const reply = await w.send({ type: 'PRECACHE_PLAYLIST', assets: [
      { url: 'https://cdn.example.com/small.jpg', size: 64 * 1024 },
      { url: URL_4K, size: 141_245_550, sha256: 'a'.repeat(64) },
    ] });
    expect(reply).toMatchObject({ ok: false, failures: 0, count: 2 });
    expect(reply.pending).toEqual([{ url: URL_4K, sha256: 'a'.repeat(64), size: 141_245_550, adoptable: false }]);
    // Only the small image was fetched — one plain request, no Range.
    expect(server.calls.map((c) => c.range)).toEqual([null]);
    expect(w.hooks.isLargeAsset({ url: 'https://x/y.mp4' })).toBe(true); // unknown size, video URL
    expect(w.hooks.isLargeAsset({ url: 'https://x/y.jpg' })).toBe(false);
    expect(w.hooks.isLargeAsset({ url: 'https://x/y.jpg', size: w.hooks.LARGE_ASSET_BYTES })).toBe(true);
  });

  it('chunk → verify → assemble yields a byte-exact, digest-verified playlist entry', async () => {
    const w = loadWorker();
    const file = randomBytes(2 * MiB + 512 * 1024);
    const server: RangeServer = { file, calls: [], lastModified: 'Thu, 25 Sep 2026 12:00:00 GMT' };
    w.setFetch(rangeFetch(server));
    const asset = { url: URL_4K, sha256: sha256Hex(file), size: file.length };
    const { steps, verify, assemble } = await drive(w, asset, MiB);
    expect(server.calls.map((c) => c.range)).toEqual([
      'bytes=0-1048575', 'bytes=1048576-2097151', `bytes=2097152-${file.length - 1}`,
    ]);
    expect(steps.map((s) => [s.ok, s.nextOffset, s.complete])).toEqual([
      [true, MiB, false], [true, 2 * MiB, false], [true, file.length, true],
    ]);
    expect(verify).toMatchObject({ ok: true, total: file.length, verified: true });
    expect(assemble).toMatchObject({ ok: true, total: file.length });

    const playlist = w.cacheNamed(w.hooks.PLAYLIST_CACHE);
    const stored = playlist.entries.get(URL_4K)!;
    expect(stored).toBeDefined();
    expect(Buffer.from(stored.bytes).equals(Buffer.from(file))).toBe(true);
    expect(Object.fromEntries(stored.headers)).toMatchObject({
      'content-type': 'video/mp4', 'content-length': String(file.length), 'accept-ranges': 'bytes',
    });
    // Same meta rows fetchAndStore writes: digest, size, stored-at.
    const meta = w.cacheNamed(w.hooks.META_CACHE);
    const metaKeys = [...meta.entries.keys()];
    expect(metaKeys.some((k) => k.startsWith(`${ORIGIN}/__edu_meta__/`))).toBe(true);
    expect(metaKeys.some((k) => k.startsWith(`${ORIGIN}/__edu_meta_size__/`))).toBe(true);
    expect(metaKeys.some((k) => k.startsWith(`${ORIGIN}/__edu_meta_stored_at__/`))).toBe(true);
    // Staging is gone, the lookup says cached, and a second playlist push is a no-op.
    expect(w.cacheNamed(w.hooks.STAGING_CACHE).entries.size).toBe(0);
    const lookup = await w.send({ type: 'CACHE_LOOKUP', urls: [{ url: URL_4K, sha256: asset.sha256 }, { url: 'https://cdn.example.com/other.mp4' }] });
    expect(lookup.cached).toEqual({ [URL_4K]: true, 'https://cdn.example.com/other.mp4': false });
    const callsBefore = server.calls.length;
    const again = await w.send({ type: 'PRECACHE_PLAYLIST', assets: [asset] });
    expect(again).toMatchObject({ ok: true, failures: 0, count: 1, pending: [] });
    expect(server.calls.length).toBe(callsBefore);
  });

  it('resumes from staged chunks: a restarted driver re-fetches nothing it already has', async () => {
    const w = loadWorker();
    const file = randomBytes(3 * MiB);
    const server: RangeServer = { file, calls: [] };
    w.setFetch(rangeFetch(server));
    const asset = { url: URL_4K, sha256: sha256Hex(file), size: file.length };
    // First "session": two chunks, then the worker is killed / the page reloads.
    const c0 = await w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: 0, chunkBytes: MiB });
    const c1 = await w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: c0.nextOffset, chunkBytes: MiB });
    expect(c1.nextOffset).toBe(2 * MiB);
    expect(server.calls.length).toBe(2);
    // Second session starts from zero again. (It asks for half-MiB chunks; the
    // worker clamps to its 1 MiB floor, so the one missing chunk is one fetch.)
    const { steps, assemble } = await drive(w, asset, MiB / 2);
    expect(steps.slice(0, 2).map((s) => s.staged)).toEqual([true, true]);
    expect(server.calls.length).toBe(3); // only the missing third was fetched
    expect(server.calls[2].range).toBe(`bytes=${2 * MiB}-${3 * MiB - 1}`);
    expect(assemble.ok).toBe(true);
    expect(Buffer.from(w.cacheNamed(w.hooks.PLAYLIST_CACHE).entries.get(URL_4K)!.bytes).equals(Buffer.from(file))).toBe(true);
  });

  it('a digest mismatch is never promoted and the staging is discarded', async () => {
    const w = loadWorker();
    const file = randomBytes(MiB + 10);
    const server: RangeServer = { file, calls: [] };
    w.setFetch(rangeFetch(server));
    const { verify, assemble } = await drive(w, { url: URL_4K, sha256: 'f'.repeat(64), size: file.length }, MiB);
    expect(verify).toEqual({ ok: false, reason: 'sha256-mismatch' });
    expect(assemble).toBeNull();
    expect(w.cacheNamed(w.hooks.PLAYLIST_CACHE).entries.size).toBe(0);
    expect(w.cacheNamed(w.hooks.STAGING_CACHE).entries.size).toBe(0);
    // Assembling without a verification marker is refused too.
    const forced = await w.send({ type: 'PRECACHE_ASSEMBLE', url: URL_4K, sha256: 'f'.repeat(64) });
    expect(forced).toEqual({ ok: false, reason: 'not-verified' });
  });

  it('a server that ignores Range still completes from offset 0 in one body', async () => {
    const w = loadWorker();
    const file = randomBytes(MiB + 3);
    const server: RangeServer = { file, calls: [], ignoreRange: true };
    w.setFetch(rangeFetch(server));
    const asset = { url: URL_4K, sha256: sha256Hex(file), size: file.length };
    const { steps, assemble } = await drive(w, asset, MiB);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ ok: true, nextOffset: file.length, total: file.length, complete: true });
    expect(assemble.ok).toBe(true);
    expect(Buffer.from(w.cacheNamed(w.hooks.PLAYLIST_CACHE).entries.get(URL_4K)!.bytes).equals(Buffer.from(file))).toBe(true);
  });

  it('a full 200 at a non-zero offset is refused and the staging purged', async () => {
    const w = loadWorker();
    const file = randomBytes(2 * MiB);
    const server: RangeServer = { file, calls: [] };
    w.setFetch(rangeFetch(server));
    const asset = { url: URL_4K, sha256: sha256Hex(file), size: file.length };
    const c0 = await w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: 0, chunkBytes: MiB });
    expect(c0.ok).toBe(true);
    server.ignoreRange = true;
    const c1 = await w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: MiB, chunkBytes: MiB });
    expect(c1).toEqual({ ok: false, reason: 'range-unsupported', offset: MiB });
    expect(w.cacheNamed(w.hooks.STAGING_CACHE).entries.size).toBe(0);
  });

  it('finds the end of the file without a total: a short chunk, or a 416 after an exact multiple', async () => {
    // Content-Range hidden (what a CORS response without expose-headers looks like), no manifest size.
    const w = loadWorker();
    const short = randomBytes(MiB + 77);
    const server: RangeServer = { file: short, calls: [], exposeContentRange: false };
    w.setFetch(rangeFetch(server));
    const a1 = { url: URL_4K, sha256: sha256Hex(short), size: null };
    const r1 = await drive(w, a1, MiB);
    expect(r1.steps.map((s) => [s.nextOffset, s.total, s.complete])).toEqual([[MiB, null, false], [short.length, short.length, true]]);
    expect(r1.assemble.ok).toBe(true);

    const w2 = loadWorker();
    const exact = randomBytes(2 * MiB);
    const server2: RangeServer = { file: exact, calls: [], exposeContentRange: false };
    w2.setFetch(rangeFetch(server2));
    const a2 = { url: URL_4K, sha256: sha256Hex(exact), size: null };
    const r2 = await drive(w2, a2, MiB);
    expect(r2.steps).toHaveLength(3);
    expect(r2.steps[2]).toMatchObject({ ok: true, complete: true, total: 2 * MiB, nextOffset: 2 * MiB });
    expect(r2.assemble.ok).toBe(true);
    expect(Buffer.from(w2.cacheNamed(w2.hooks.PLAYLIST_CACHE).entries.get(URL_4K)!.bytes).equals(Buffer.from(exact))).toBe(true);
  });

  it('refuses a manifest size that disagrees with the file, and a source that changed mid-download', async () => {
    const w = loadWorker();
    const file = randomBytes(2 * MiB);
    const server: RangeServer = { file, calls: [], lastModified: 'Thu, 25 Sep 2026 12:00:00 GMT' };
    w.setFetch(rangeFetch(server));
    const wrongSize = await w.send({ type: 'PRECACHE_CHUNK', url: URL_4K, sha256: null, size: 999, offset: 0, chunkBytes: MiB });
    expect(wrongSize).toEqual({ ok: false, reason: 'size-mismatch', offset: 0 });

    const asset = { url: URL_4K, sha256: null, size: file.length };
    const c0 = await w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: 0, chunkBytes: MiB });
    expect(c0.ok).toBe(true);
    server.lastModified = 'Fri, 26 Sep 2026 09:00:00 GMT';
    const c1 = await w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: MiB, chunkBytes: MiB });
    expect(c1).toEqual({ ok: false, reason: 'source-changed', offset: MiB });
    expect(w.cacheNamed(w.hooks.STAGING_CACHE).entries.size).toBe(0);
  });

  it('an asset with no digest is assembled unverified (the null-hash rule) and reported as such', async () => {
    const w = loadWorker();
    const file = randomBytes(MiB + 1);
    w.setFetch(rangeFetch({ file, calls: [] }));
    const { verify, assemble } = await drive(w, { url: URL_4K, sha256: null, size: file.length }, MiB);
    expect(verify).toMatchObject({ ok: true, verified: false });
    expect(assemble.ok).toBe(true);
    const meta = w.cacheNamed(w.hooks.META_CACHE);
    expect([...meta.entries.keys()].some((k) => k.startsWith(`${ORIGIN}/__edu_meta__/`))).toBe(false);
  });

  it('PRECACHE_PLAYLIST drops staged chunks for URLs that left the manifest', async () => {
    const w = loadWorker();
    const file = randomBytes(2 * MiB);
    w.setFetch(rangeFetch({ file, calls: [] }));
    await w.send({ type: 'PRECACHE_CHUNK', url: URL_4K, sha256: null, size: file.length, offset: 0, chunkBytes: MiB });
    expect(w.cacheNamed(w.hooks.STAGING_CACHE).entries.size).toBeGreaterThan(0);
    await w.send({ type: 'PRECACHE_PLAYLIST', assets: [{ url: 'https://cdn.example.com/else.mp4', size: 50 * MiB }] });
    expect(w.cacheNamed(w.hooks.STAGING_CACHE).entries.size).toBe(0);
  });

  // ── Legacy entries are adopted on disk, never re-downloaded (2026-09-26) ──
  // An entry cached before this worker stored digests has no meta hash, so
  // the manifest's new sha256 made `isCachedCurrent` say no and the whole
  // file was fetched again (141 MB on the field 4K screen, for bytes it had).


  it('a legacy LARGE entry is reported adoptable and PRECACHE_ADOPT verifies it on disk — no fetch', async () => {
    const w = loadWorker();
    const file = randomBytes(w.hooks.LARGE_ASSET_BYTES + 11); // large: staged, never fetched inline
    const server: RangeServer = { file, calls: [] };
    w.setFetch(rangeFetch(server));
    await w.seedLegacyEntry(w.hooks.PLAYLIST_CACHE, URL_4K, file);
    const asset = { url: URL_4K, sha256: sha256Hex(file), size: file.length };

    const first = await w.send({ type: 'PRECACHE_PLAYLIST', assets: [asset] });
    expect(first).toMatchObject({ ok: false, failures: 0, count: 1 });
    expect(first.pending).toEqual([{ url: URL_4K, sha256: asset.sha256, size: file.length, adoptable: true }]);
    // The lookup already says "present" (playable now) but not "current".
    const before = await w.send({ type: 'CACHE_LOOKUP', urls: [asset] });
    expect(before).toMatchObject({ cached: { [URL_4K]: false }, present: { [URL_4K]: true } });

    const adopt = await w.send({ type: 'PRECACHE_ADOPT', url: URL_4K, sha256: asset.sha256 });
    expect(adopt).toEqual({ ok: true, adopted: true, total: file.length });
    expect(server.calls).toHaveLength(0);
    const meta = w.cacheNamed(w.hooks.META_CACHE);
    const metaKeys = [...meta.entries.keys()];
    expect(metaKeys.some((k) => k.startsWith(`${ORIGIN}/__edu_meta__/`))).toBe(true);
    expect(metaKeys.some((k) => k.startsWith(`${ORIGIN}/__edu_meta_size__/`))).toBe(true);

    // From now on it is current: the next push loads it, the lookup agrees,
    // and a second adopt does not read the file again (meta answers).
    const again = await w.send({ type: 'PRECACHE_PLAYLIST', assets: [asset] });
    expect(again).toMatchObject({ ok: true, failures: 0, count: 1, pending: [] });
    const after = await w.send({ type: 'CACHE_LOOKUP', urls: [asset] });
    expect(after).toMatchObject({ cached: { [URL_4K]: true }, present: { [URL_4K]: true } });
    expect(await w.send({ type: 'PRECACHE_ADOPT', url: URL_4K, sha256: asset.sha256 })).toEqual({ ok: true, adopted: false });
    expect(server.calls).toHaveLength(0);
    // The served bytes are untouched.
    expect(Buffer.from(w.cacheNamed(w.hooks.PLAYLIST_CACHE).entries.get(URL_4K)!.bytes).equals(Buffer.from(file))).toBe(true);
  });

  it('a legacy entry whose bytes do NOT match is neither adopted nor deleted; the verified download replaces it', async () => {
    const w = loadWorker();
    const stale = randomBytes(w.hooks.LARGE_ASSET_BYTES + 5);
    const fresh = randomBytes(w.hooks.LARGE_ASSET_BYTES + 5);
    const server: RangeServer = { file: fresh, calls: [] };
    w.setFetch(rangeFetch(server));
    await w.seedLegacyEntry(w.hooks.PLAYLIST_CACHE, URL_4K, stale);
    const asset = { url: URL_4K, sha256: sha256Hex(fresh), size: fresh.length };
    // The push hands it back as adoptable — the page tries the on-disk hash first.
    const first = await w.send({ type: 'PRECACHE_PLAYLIST', assets: [asset] });
    expect(first.pending).toEqual([{ ...asset, adoptable: true }]);
    expect(server.calls).toHaveLength(0);

    const adopt = await w.send({ type: 'PRECACHE_ADOPT', url: URL_4K, sha256: asset.sha256 });
    expect(adopt).toEqual({ ok: false, reason: 'sha256-mismatch' });
    // Still serving the old bytes — a screen playing them is not taken off them.
    expect(Buffer.from(w.cacheNamed(w.hooks.PLAYLIST_CACHE).entries.get(URL_4K)!.bytes).equals(Buffer.from(stale))).toBe(true);
    expect([...w.cacheNamed(w.hooks.META_CACHE).entries.keys()].some((k) => k.startsWith(`${ORIGIN}/__edu_meta__/`))).toBe(false);

    const { assemble } = await drive(w, asset, MiB);
    expect(assemble.ok).toBe(true);
    expect(Buffer.from(w.cacheNamed(w.hooks.PLAYLIST_CACHE).entries.get(URL_4K)!.bytes).equals(Buffer.from(fresh))).toBe(true);
    expect(await w.send({ type: 'CACHE_LOOKUP', urls: [asset] })).toMatchObject({ cached: { [URL_4K]: true } });
    // Nothing on disk → honest refusal, not a fetch.
    expect(await w.send({ type: 'PRECACHE_ADOPT', url: 'https://cdn.example.com/none.mp4', sha256: asset.sha256 }))
      .toEqual({ ok: false, reason: 'not-cached' });
    expect(await w.send({ type: 'PRECACHE_ADOPT', url: URL_4K, sha256: 'nope' })).toEqual({ ok: false, reason: 'bad-request' });
  });

  it('a SMALL legacy entry is adopted inside PRECACHE_PLAYLIST with no fetch; a mismatching one is re-fetched and verified', async () => {
    const w = loadWorker();
    const good = randomBytes(64 * 1024);
    const url = 'https://cdn.example.com/small.jpg';
    const server: RangeServer = { file: good, calls: [] };
    w.setFetch(rangeFetch(server));
    await w.seedLegacyEntry(w.hooks.PLAYLIST_CACHE, url, good);
    const reply = await w.send({ type: 'PRECACHE_PLAYLIST', assets: [{ url, sha256: sha256Hex(good), size: good.length }] });
    expect(reply).toMatchObject({ ok: true, failures: 0, count: 1, pending: [] });
    expect(server.calls).toHaveLength(0);
    expect([...w.cacheNamed(w.hooks.META_CACHE).entries.keys()].some((k) => k.startsWith(`${ORIGIN}/__edu_meta__/`))).toBe(true);

    const w2 = loadWorker();
    const stale = randomBytes(64 * 1024);
    const server2: RangeServer = { file: good, calls: [] };
    w2.setFetch(rangeFetch(server2));
    await w2.seedLegacyEntry(w2.hooks.PLAYLIST_CACHE, url, stale);
    const reply2 = await w2.send({ type: 'PRECACHE_PLAYLIST', assets: [{ url, sha256: sha256Hex(good), size: good.length }] });
    expect(reply2).toMatchObject({ ok: true, failures: 0, count: 1, pending: [] });
    expect(server2.calls).toHaveLength(1);
    expect(Buffer.from(w2.cacheNamed(w2.hooks.PLAYLIST_CACHE).entries.get(url)!.bytes).equals(Buffer.from(good))).toBe(true);
  });

  it('two overlapping chunk events for ONE URL at different offsets never cross bodies (per-offset temp key)', async () => {
    const w = loadWorker();
    const file = randomBytes(2 * MiB);
    // A fetch whose bodies we close by hand, so the two events interleave
    // exactly the way a reloaded page racing its predecessor does: chunk B's
    // body lands first, then chunk A's.
    const controllers: Array<{ start: number; ctl: ReadableStreamDefaultController<Uint8Array> }> = [];
    w.setFetch(async (input: Request | string) => {
      const req = typeof input === 'string' ? new Request(input) : input;
      const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.get('range') || '')!;
      const start = Number(m[1]);
      const end = Number(m[2]);
      const body = new ReadableStream<Uint8Array>({ start(ctl) { controllers.push({ start, ctl }); } });
      return new Response(body, { status: 206, headers: {
        'content-type': 'video/mp4', 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${file.length}`,
      } });
    });
    const asset = { url: URL_4K, sha256: sha256Hex(file), size: file.length };
    const a = w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: 0, chunkBytes: MiB });
    const b = w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: MiB, chunkBytes: MiB });
    // Both fetches are in flight before either body has a byte.
    for (let i = 0; i < 20 && controllers.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
    expect(controllers.map((c) => c.start).sort((x, y) => x - y)).toEqual([0, MiB]);
    const finish = (start: number) => {
      const c = controllers.find((x) => x.start === start)!;
      c.ctl.enqueue(file.slice(start, start + MiB));
      c.ctl.close();
    };
    // A's body lands first, B's a moment later — so B's temp write settles
    // between A's temp write and A's read-back. With ONE temp key per URL
    // (the pre-fix code) A then copies B's bytes under A's range.
    finish(0);
    finish(MiB);
    expect((await a).ok && (await b).ok).toBe(true);
    const staging = w.cacheNamed(w.hooks.STAGING_CACHE);
    const chunkA = [...staging.entries.entries()].find(([k]) => k.endsWith(`/0-${MiB}`))![1];
    const chunkB = [...staging.entries.entries()].find(([k]) => k.endsWith(`/${MiB}-${MiB}`))![1];
    expect(Buffer.from(chunkA.bytes).equals(Buffer.from(file.slice(0, MiB)))).toBe(true);
    expect(Buffer.from(chunkB.bytes).equals(Buffer.from(file.slice(MiB, 2 * MiB)))).toBe(true);
    // No temp entry survives, and nothing but the two ranges is counted.
    expect([...staging.entries.keys()].some((k) => k.includes('/tmp'))).toBe(false);
    w.setFetch(rangeFetch({ file, calls: [] }));
    const verify = await w.send({ type: 'PRECACHE_VERIFY', url: URL_4K, sha256: asset.sha256 });
    expect(verify).toMatchObject({ ok: true, verified: true });
  });

  it('the incremental SHA-256 matches node:crypto across update boundaries', () => {
    const w = loadWorker();
    const { Sha256, sha256LengthWords } = w.hooks;
    for (const len of [0, 1, 3, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 4096, MiB + 17]) {
      const data = randomBytes(len);
      const expected = sha256Hex(data);
      const h = new Sha256();
      let i = 0;
      while (i < len) {
        const take = Math.min(len - i, 1 + Math.floor(Math.random() * 300));
        h.update(data.subarray(i, i + take));
        i += take;
      }
      expect(h.digestHex()).toBe(expected);
      expect(h.digestHex()).toBe(expected); // idempotent after finishing
    }
    expect(new Sha256().update(Buffer.from('abc')).digestHex())
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256LengthWords(0)).toEqual([0, 0]);
    expect(sha256LengthWords(64)).toEqual([0, 512]);
    expect(sha256LengthWords(0x20000000 + 1)).toEqual([1, 8]); // 512 MiB + 1 byte needs the high word
  });

  it('parseContentRange and contiguousLayout are strict about shape', () => {
    const { parseContentRange, contiguousLayout } = loadWorker().hooks;
    expect(parseContentRange('bytes 0-1023/4096')).toEqual({ start: 0, end: 1023, total: 4096 });
    expect(parseContentRange('bytes 0-1023/*')).toEqual({ start: 0, end: 1023, total: null });
    expect(parseContentRange('bytes 10-5/100')).toBeNull();
    expect(parseContentRange('bytes 0-100/100')).toBeNull();
    expect(parseContentRange(null)).toBeNull();
    const chunks = [{ start: 0, length: 4 }, { start: 4, length: 4 }, { start: 2, length: 2 }, { start: 8, length: 2 }];
    expect(contiguousLayout(chunks, 10)).toMatchObject({ ok: true, nextOffset: 10 });
    expect(contiguousLayout(chunks, 10).chunks).toEqual([{ start: 0, length: 4 }, { start: 4, length: 4 }, { start: 8, length: 2 }]);
    expect(contiguousLayout([{ start: 0, length: 4 }, { start: 8, length: 2 }], 10)).toMatchObject({ ok: false, nextOffset: 4 });
    expect(contiguousLayout([{ start: 0, length: 4 }], null)).toMatchObject({ ok: false, nextOffset: 4 });
  });
});
