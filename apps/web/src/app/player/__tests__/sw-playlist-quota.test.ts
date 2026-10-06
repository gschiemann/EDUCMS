/** @jest-environment node */
import { randomBytes } from 'node:crypto';
import { drive, loadWorker, rangeFetch, sha256Hex, MiB } from './swHarness';

const url = 'https://cdn.example.com/playlist.mp4';
jest.setTimeout(60_000); // Multiple full-file SHA-256 passes through the VM.
const asset = (file: Uint8Array) => ({ url, sha256: sha256Hex(file), size: file.length >= 8 * MiB ? file.length : null });

async function quotaWorker() {
  const w = loadWorker();
  await w.send({ type: 'CACHE_LOOKUP', urls: [url] });
  // The bytes fit on disk; making a second complete copy does not.
  const cache = w.cacheNamed(w.hooks.PLAYLIST_CACHE);
  cache.put = jest.fn(async () => { throw new DOMException('Quota exceeded.', 'QuotaExceededError'); });
  return w;
}

test('quota during assembly preserves verified chunks, plays exact offline ranges, reports one cached file, and needs no repeat download', async () => {
  const w = await quotaWorker();
  const file = randomBytes(9 * MiB + 17);
  const server = { file, calls: [] };
  w.setFetch(rangeFetch(server));
  expect((await drive(w, asset(file), 4 * MiB)).assemble)
    .toMatchObject({ ok: true, total: file.length, storage: 'verified-chunks' });
  w.setFetch(() => { throw new Error('offline'); });
  const start = 4 * MiB - 7, end = 8 * MiB + 7;
  const response = await w.fetchRequest(new Request(url, { headers: { range: `bytes=${start}-${end}` } }));
  expect(response.status).toBe(206);
  expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/${file.length}`);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from(file.slice(start, end + 1)));
  const suffix = await w.fetchRequest(new Request(url, { headers: { range: 'bytes=-23' } }));
  expect(Buffer.from(await suffix.arrayBuffer())).toEqual(Buffer.from(file.slice(-23)));
  expect(await w.status()).toMatchObject({ playlist: { count: 1, bytes: file.length } });
  expect(await w.send({ type: 'CACHE_LOOKUP', urls: [asset(file)] }))
    .toMatchObject({ cached: { [url]: true }, present: { [url]: true } });
  expect(await w.send({ type: 'PRECACHE_PLAYLIST', assets: [asset(file)] }))
    .toMatchObject({ ok: true, pending: [] });
  expect(server.calls).toHaveLength(3);
});

test('an unverified or missing chunk never becomes ready, and a non-quota write error stays a failure', async () => {
  const w = await quotaWorker();
  const file = randomBytes(2 * MiB + 17);
  w.setFetch(rangeFetch({ file, calls: [] }));
  await w.send({ type: 'PRECACHE_CHUNK', ...asset(file), offset: 0, chunkBytes: 16 * MiB });
  expect(await w.send({ type: 'PRECACHE_ASSEMBLE', ...asset(file) }))
    .toMatchObject({ ok: false, reason: 'not-verified' });
  expect(await w.send({ type: 'CACHE_LOOKUP', urls: [asset(file)] }))
    .toMatchObject({ cached: { [url]: false }, present: { [url]: false } });
  await w.send({ type: 'PRECACHE_VERIFY', ...asset(file) });
  w.cacheNamed(w.hooks.PLAYLIST_CACHE).put = jest.fn(async () => { throw new Error('disk read failure'); });
  expect(await w.send({ type: 'PRECACHE_ASSEMBLE', ...asset(file) }))
    .toMatchObject({ ok: false, reason: 'disk read failure' });
  w.cacheNamed(w.hooks.PLAYLIST_CACHE).put = jest.fn(async () => { throw new DOMException('Quota exceeded.', 'QuotaExceededError'); });
  expect(await w.send({ type: 'PRECACHE_ASSEMBLE', ...asset(file) })).toMatchObject({ ok: true });
  const staging = w.cacheNamed(w.hooks.STAGING_CACHE);
  const chunkKey = [...staging.entries.keys()].find(key => /\/0-\d+$/.test(key))!;
  await staging.delete(chunkKey);
  expect(await w.send({ type: 'CACHE_LOOKUP', urls: [asset(file)] }))
    .toMatchObject({ cached: { [url]: false }, present: { [url]: false } });
  expect(await w.status()).toMatchObject({ playlist: { count: 0, bytes: 0 } });
});

test('a changed digest at the same URL preserves the playing generation through failed verification, then replaces it after success', async () => {
  const w = await quotaWorker();
  const old = randomBytes(2 * MiB + 17), next = randomBytes(2 * MiB + 17);
  w.setFetch(rangeFetch({ file: old, calls: [] }));
  await drive(w, asset(old), 4 * MiB);
  w.setFetch(rangeFetch({ file: next, calls: [] }));
  // Stage different bytes under the new digest and deliberately fail it.
  const wrong = { url, sha256: 'a'.repeat(64), size: next.length };
  expect((await drive(w, wrong, 4 * MiB)).verify).toMatchObject({ ok: false, reason: 'sha256-mismatch' });
  expect(Buffer.from(await (await w.fetchRequest(new Request(url))).arrayBuffer())).toEqual(Buffer.from(old));
  expect((await drive(w, asset(next), 4 * MiB)).assemble).toMatchObject({ ok: true, storage: 'verified-chunks' });
  // A manifest prune retains the published generation's marker and chunks.
  expect(await w.send({ type: 'PRECACHE_PLAYLIST', assets: [asset(next)] })).toMatchObject({ ok: true });
  w.setFetch(() => { throw new Error('offline'); });
  expect(Buffer.from(await (await w.fetchRequest(new Request(url))).arrayBuffer())).toEqual(Buffer.from(next));
  expect(await w.status()).toMatchObject({ playlist: { count: 1, bytes: next.length } });
});

test('the keep-on-glass list protects chunked playback, and removing it prunes only playlist bytes', async () => {
  const w = await quotaWorker();
  const file = randomBytes(2 * MiB + 17);
  w.setFetch(rangeFetch({ file, calls: [] }));
  await drive(w, asset(file), 4 * MiB);
  await w.seedLegacyEntry(w.hooks.EMERGENCY_CACHE, 'https://cdn.example.com/alert.mp4', file);
  await w.send({ type: 'PRECACHE_PLAYLIST', assets: [], keepUrls: [url] });
  expect(await w.send({ type: 'CACHE_LOOKUP', urls: [asset(file)] })).toMatchObject({ present: { [url]: true } });
  await w.send({ type: 'PRECACHE_PLAYLIST', assets: [] });
  expect(await w.send({ type: 'CACHE_LOOKUP', urls: [asset(file)] })).toMatchObject({ present: { [url]: false } });
  expect(w.cacheNamed(w.hooks.STAGING_CACHE).entries.size).toBe(0);
  expect(w.cacheNamed(w.hooks.EMERGENCY_CACHE).entries.size).toBe(1);
});
