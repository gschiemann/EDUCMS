/** @jest-environment node */
import { randomBytes } from 'node:crypto';
import { drive, loadWorker, rangeFetch, sha256Hex, MiB } from './swHarness';

jest.setTimeout(60_000);
const url = 'https://cdn.example.com/publication.mp4';
const file = randomBytes(MiB);

test.each([true, false])('one-copy staging fits a one-file budget, digest=%s', async (digest) => {
  const w = loadWorker();
  const bytes = randomBytes(9 * MiB + 17);
  await w.send({ type: 'PRECACHE_VERIFY', url });
  const staging = w.cacheNamed(w.hooks.STAGING_CACHE);
  const put = staging.put.bind(staging);
  // Exact old-worker quota state: tmp succeeded, duplicate copy failed.
  const oldTemp = `https://venue-os.app${w.hooks.PLAYLIST_TIER.stagePrefix}${encodeURIComponent(url)}/tmp-0`;
  const emergencyTemp = `https://venue-os.app${w.hooks.EMERGENCY_TIER.stagePrefix}${encodeURIComponent(url)}/tmp-0`;
  await put(oldTemp, new Response(bytes.subarray(0, 8 * MiB)));
  await put(emergencyTemp, new Response(new Uint8Array([1, 2, 3])));
  staging.put = async (key, response) => {
    const keyUrl = typeof key === 'string' ? key : key.url;
    const incoming = await response.arrayBuffer();
    const occupied = [...staging.entries].reduce((sum, [k, v]) => sum + (k === keyUrl ? 0 : v.bytes.length), 0);
    if (occupied + incoming.byteLength > bytes.length + 64 * 1024) throw new DOMException('full', 'QuotaExceededError');
    await put(key, new Response(incoming, { status: response.status, headers: response.headers }));
  };
  w.setFetch(rangeFetch({ file: bytes, calls: [] }));
  const result = await drive(w, { url, size: bytes.length, sha256: digest ? sha256Hex(bytes) : null }, 8 * MiB);
  expect(result.assemble).toMatchObject({ ok: true, total: bytes.length });
  expect(staging.entries.has(oldTemp)).toBe(false);
  expect(staging.entries.has(emergencyTemp)).toBe(true);
  expect(Buffer.from(await (await w.fetchRequest(new Request(url))).arrayBuffer()).equals(Buffer.from(bytes))).toBe(true);
});

describe.each([true, false])('atomic publication, digest=%s', (digest) => {
  const asset = { url, size: file.length, sha256: digest ? sha256Hex(file) : null };
  test.each(['short', 'overlong', 'read-error', 'abort'])('%s never leaves a trusted chunk; fresh worker can resume', async (fault) => {
    const w = loadWorker();
    let cancelled = false;
    w.setFetch(async () => new Response(new ReadableStream({
      start(controller) {
        if (fault === 'short') { controller.enqueue(file.subarray(0, file.length - 1)); controller.close(); }
        else if (fault === 'overlong') { controller.enqueue(file); controller.enqueue(new Uint8Array([1])); }
        else controller.error(fault === 'abort' ? new DOMException('aborted', 'AbortError') : new Error('read failed'));
      },
      cancel() { cancelled = true; },
    }), { status: 206, headers: { 'content-range': `bytes 0-${file.length - 1}/${file.length}` } }));
    expect(await w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: 0, chunkBytes: MiB }))
      .toMatchObject({ ok: false, reason: fault === 'abort' ? 'fetch-timeout' : 'truncated' });
    expect(w.cacheNamed(w.hooks.STAGING_CACHE).entries.size).toBe(0);
    if (fault === 'overlong') expect(cancelled).toBe(true);
    expect(await w.send({ type: 'PRECACHE_VERIFY', ...asset })).toMatchObject({ ok: false, reason: 'incomplete' });
    const restarted = w.restart();
    restarted.setFetch(rangeFetch({ file, calls: [] }));
    expect((await drive(restarted, asset, MiB)).assemble).toMatchObject({ ok: true });
    expect(Buffer.from(await (await restarted.fetchRequest(new Request(url))).arrayBuffer()).equals(Buffer.from(file))).toBe(true);
  });

  test('expected byte count without EOF is neither resumable nor verifiable; commit survives restart', async () => {
    const w = loadWorker();
    let finish!: () => void;
    let reading!: () => void;
    const started = new Promise<void>(resolve => { reading = resolve; });
    const eof = new Promise<void>(resolve => { finish = resolve; });
    w.setFetch(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(file); },
      async pull(controller) { reading(); await eof; controller.close(); },
    }), { status: 206, headers: { 'content-range': `bytes 0-${file.length - 1}/${file.length}` } }));
    const writing = w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: 0, chunkBytes: MiB });
    await started;
    expect(w.cacheNamed(w.hooks.STAGING_CACHE).entries.size).toBe(0);
    expect(await w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: 0, chunkBytes: MiB }))
      .toMatchObject({ ok: false, reason: 'busy' });
    expect(await w.send({ type: 'PRECACHE_VERIFY', ...asset })).toMatchObject({ ok: false, reason: 'incomplete' });
    finish();
    expect(await writing).toMatchObject({ ok: true, complete: true });
    const restarted = w.restart();
    const fetch = jest.fn(() => { throw new Error('must not fetch committed bytes'); });
    restarted.setFetch(fetch);
    expect((await drive(restarted, asset, MiB)).assemble).toMatchObject({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  test('restart after chunk commit before metadata repairs the missing total without downloading again', async () => {
    const w = loadWorker();
    await w.send({ type: 'PRECACHE_VERIFY', ...asset });
    const staging = w.cacheNamed(w.hooks.STAGING_CACHE);
    const put = staging.put.bind(staging);
    staging.put = async (key, response) => {
      await put(key, response);
      const path = typeof key === 'string' ? key : key.url;
      if (/\/0-\d+$/.test(path)) throw new Error('worker stopped after atomic chunk commit');
    };
    w.setFetch(rangeFetch({ file, calls: [] }));
    expect(await w.send({ type: 'PRECACHE_CHUNK', ...asset, offset: 0, chunkBytes: MiB })).toMatchObject({ ok: false });
    expect([...staging.entries.keys()].some(k => /\/0-\d+$/.test(k))).toBe(true);
    // The process dies here, with no info row; the next worker only sees disk.
    staging.put = put;
    const restarted = w.restart();
    const fetch = jest.fn(() => { throw new Error('committed chunk must be reused'); });
    restarted.setFetch(fetch);
    expect((await drive(restarted, asset, MiB)).assemble).toMatchObject({ ok: true, total: file.length });
    expect(fetch).not.toHaveBeenCalled();
  });
});
