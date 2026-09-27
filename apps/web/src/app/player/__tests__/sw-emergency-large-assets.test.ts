/**
 * @jest-environment node
 *
 * The emergency tier's large-file lane (2026-09-26, Greg signed off): a file
 * at or above LARGE_ASSET_BYTES is never fetched inside PRECACHE_EMERGENCY's
 * own event — it is handed back as `pending` and the page drives it through
 * the chunk protocol with tier 'emergency' into EMERGENCY_CACHE (never-evict),
 * under its own staging namespace. Everything below the line stays
 * byte-for-byte on the inline path. Every guarantee the brief names has a
 * case here, against the REAL worker (swHarness.ts vm-loads it).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- vm / fake-worker harness: replies are untyped by design */
import { randomBytes } from 'node:crypto';
import { drive, loadWorker, rangeFetch, sha256Hex, MiB, ORIGIN, type RangeServer } from './swHarness';

const EM_URL = 'https://cdn.example.com/storage/v1/object/public/assets/t1/lockdown-4k.mp4?token=em';
const SMALL_URL = 'https://cdn.example.com/storage/v1/object/public/assets/t1/lockdown.png';
const SET_HASH_KEY = `${ORIGIN}/__edu_emergency_set_hash__`;
const EM_STAGE = '/__edu_stage_em__/';
const PL_STAGE = '/__edu_stage__/';

function stagedKeys(w: ReturnType<typeof loadWorker>) {
  return [...w.cacheNamed(w.hooks.STAGING_CACHE).entries.keys()].map((k) => new URL(k).pathname);
}

function metaSetHash(w: ReturnType<typeof loadWorker>): string | null {
  const e = w.cacheNamed(w.hooks.META_CACHE).entries.get(SET_HASH_KEY);
  return e ? Buffer.from(e.bytes).toString('utf8') : null;
}

describe('sw-player emergency tier — large files through the chunk protocol', () => {
  it('an EMPTY list is "no data", never a wipe: the tier, its meta and its staging are untouched', async () => {
    const w = loadWorker();
    const file = randomBytes(64 * 1024);
    w.setFetch(rangeFetch({ file, calls: [] }));
    // A populated tier with a committed set-hash, plus a half-downloaded large file.
    const small = { url: SMALL_URL, sha256: sha256Hex(file), size: file.length };
    expect(await w.send({ type: 'PRECACHE_EMERGENCY', assets: [small], setHash: 'set-1' })).toMatchObject({ ok: true, failures: 0, count: 1, pending: [] });
    expect(metaSetHash(w)).toBe('set-1');
    const big = randomBytes(w.hooks.LARGE_ASSET_BYTES + 3);
    w.setFetch(rangeFetch({ file: big, calls: [] }));
    await w.send({ type: 'PRECACHE_CHUNK', url: EM_URL, sha256: sha256Hex(big), size: big.length, offset: 0, chunkBytes: MiB, tier: 'emergency' });
    const emBefore = w.cacheNamed(w.hooks.EMERGENCY_CACHE).entries.size;
    const stagedBefore = stagedKeys(w).filter((k) => k.startsWith(EM_STAGE)).length;
    expect(emBefore).toBe(1);
    expect(stagedBefore).toBeGreaterThan(0);

    for (const assets of [[], null, undefined]) {
      const reply = await w.send({ type: 'PRECACHE_EMERGENCY', assets, setHash: 'set-2' });
      expect(reply).toEqual({ ok: false, emptyPayload: true, failures: 0, count: 0 });
    }
    expect(w.cacheNamed(w.hooks.EMERGENCY_CACHE).entries.size).toBe(emBefore);
    expect(metaSetHash(w)).toBe('set-1'); // the old commit stands; nothing latched
    expect(stagedKeys(w).filter((k) => k.startsWith(EM_STAGE)).length).toBe(stagedBefore);
  });

  it('below 8 MiB stays on the inline path byte-for-byte: one plain GET per file, cached, set-hash committed, ack ok', async () => {
    const w = loadWorker();
    const file = randomBytes(w.hooks.LARGE_ASSET_BYTES - 1);
    const server: RangeServer = { file, calls: [] };
    w.setFetch(rangeFetch(server));
    const asset = { url: SMALL_URL, sha256: sha256Hex(file), size: file.length };
    const reply = await w.send({ type: 'PRECACHE_EMERGENCY', assets: [asset], setHash: 'set-small' });
    expect(reply).toEqual({ ok: true, failures: 0, count: 1, pending: [] });
    expect(server.calls).toEqual([{ range: null, url: SMALL_URL }]); // whole body, no Range, inside the event
    expect(w.cacheNamed(w.hooks.EMERGENCY_CACHE).entries.has(SMALL_URL)).toBe(true);
    expect(metaSetHash(w)).toBe('set-small');
    expect(stagedKeys(w)).toEqual([]); // nothing staged for a small file
  });

  it('a large file is never fetched inside the event: pending, no set-hash; driven with tier emergency it lands in EMERGENCY_CACHE only; the re-push commits', async () => {
    const w = loadWorker();
    const big = randomBytes(w.hooks.LARGE_ASSET_BYTES + 5);
    const small = randomBytes(1000);
    const server: RangeServer = { file: big, calls: [] };
    // The small file is served from a separate fetch so the call log stays readable.
    w.setFetch(async (input: Request | string, init?: { signal?: AbortSignal }) => {
      const req = typeof input === 'string' ? new Request(input, init) : input;
      if (req.url.startsWith(SMALL_URL)) {
        server.calls.push({ range: req.headers.get('range'), url: req.url });
        return new Response(small.slice(), { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(small.length) } });
      }
      return rangeFetch(server)(input, init);
    });
    const assets = [
      { url: SMALL_URL, sha256: sha256Hex(small), size: small.length },
      { url: EM_URL, sha256: sha256Hex(big), size: big.length },
    ];
    const first = await w.send({ type: 'PRECACHE_EMERGENCY', assets, setHash: 'set-big' });
    expect(first).toEqual({
      ok: false, failures: 0, count: 2,
      pending: [{ url: EM_URL, sha256: sha256Hex(big), size: big.length, adoptable: false }],
    });
    // Only the small file was fetched, as one plain GET. No set-hash yet.
    expect(server.calls).toEqual([{ range: null, url: SMALL_URL }]);
    expect(metaSetHash(w)).toBeNull();
    expect(w.cacheNamed(w.hooks.EMERGENCY_CACHE).entries.has(EM_URL)).toBe(false);

    const { steps, verify, assemble } = await drive(w, { url: EM_URL, sha256: sha256Hex(big), size: big.length }, 4 * MiB, 'emergency');
    expect(steps.every((s: any) => s.ok)).toBe(true);
    expect(verify).toMatchObject({ ok: true, verified: true });
    expect(assemble).toMatchObject({ ok: true, total: big.length });
    // Every Range went to the file; the staged chunks lived in the EMERGENCY namespace.
    expect(server.calls.slice(1).every((c) => c.range !== null && c.url === EM_URL)).toBe(true);
    const em = w.cacheNamed(w.hooks.EMERGENCY_CACHE).entries.get(EM_URL)!;
    expect(em).toBeDefined();
    expect(Buffer.from(em.bytes).equals(Buffer.from(big))).toBe(true);
    expect(w.cacheNamed(w.hooks.PLAYLIST_CACHE).entries.has(EM_URL)).toBe(false); // never the playlist tier
    expect(stagedKeys(w)).toEqual([]); // staging cleared after assemble
    // The lookup sees it (either tier counts as present) and it is current.
    expect(await w.send({ type: 'CACHE_LOOKUP', urls: [{ url: EM_URL, sha256: sha256Hex(big) }] }))
      .toMatchObject({ present: { [EM_URL]: true } });

    // The confirm pass: everything cached, nothing fetched again, set-hash committed.
    const callsBefore = server.calls.length;
    const confirm = await w.send({ type: 'PRECACHE_EMERGENCY', assets, setHash: 'set-big' });
    expect(confirm).toEqual({ ok: true, failures: 0, count: 2, pending: [] });
    expect(server.calls.length).toBe(callsBefore);
    expect(metaSetHash(w)).toBe('set-big');
  });

  it('a null-hash LARGE emergency file already in the tier is current — never revalidated, never pending (rule 11)', async () => {
    const w = loadWorker();
    const big = randomBytes(w.hooks.LARGE_ASSET_BYTES + 1);
    const server: RangeServer = { file: big, calls: [] };
    w.setFetch(rangeFetch(server));
    await w.seedLegacyEntry(w.hooks.EMERGENCY_CACHE, EM_URL, big);
    const reply = await w.send({ type: 'PRECACHE_EMERGENCY', assets: [{ url: EM_URL, sha256: null, size: big.length }], setHash: 'set-null' });
    expect(reply).toEqual({ ok: true, failures: 0, count: 1, pending: [] });
    expect(server.calls).toEqual([]);
    expect(metaSetHash(w)).toBe('set-null');
    // And a null-hash large file NOT in the tier is pending, driven unverified into the emergency cache.
    const w2 = loadWorker();
    const server2: RangeServer = { file: big, calls: [] };
    w2.setFetch(rangeFetch(server2));
    const first = await w2.send({ type: 'PRECACHE_EMERGENCY', assets: [{ url: EM_URL, sha256: null, size: big.length }], setHash: 'set-null' });
    expect(first).toMatchObject({ ok: false, pending: [{ url: EM_URL, sha256: null, size: big.length, adoptable: false }] });
    const { verify, assemble } = await drive(w2, { url: EM_URL, sha256: null, size: big.length }, 4 * MiB, 'emergency');
    expect(verify).toMatchObject({ ok: true, verified: false });
    expect(assemble.ok).toBe(true);
    expect(w2.cacheNamed(w2.hooks.EMERGENCY_CACHE).entries.has(EM_URL)).toBe(true);
  });

  it('a null-hash SMALL emergency file cached more than 24 h ago is not refetched (F4 — the tier opts out of revalidation)', async () => {
    const w = loadWorker();
    const file = randomBytes(2048);
    const server: RangeServer = { file, calls: [] };
    w.setFetch(rangeFetch(server));
    await w.seedLegacyEntry(w.hooks.EMERGENCY_CACHE, SMALL_URL, file);
    // A stored-at stamp two days old — the playlist tier would refetch this.
    const meta = w.cacheNamed(w.hooks.META_CACHE);
    const stampKey = `${ORIGIN}/__edu_meta_stored_at__/${encodeURIComponent(SMALL_URL)}`;
    await meta.put(stampKey, new Response(String(Date.now() - 48 * 60 * 60 * 1000), { headers: { 'content-type': 'text/plain' } }));
    const reply = await w.send({ type: 'PRECACHE_EMERGENCY', assets: [{ url: SMALL_URL, sha256: null, size: file.length }], setHash: 'set-f4' });
    expect(reply).toEqual({ ok: true, failures: 0, count: 1, pending: [] });
    expect(server.calls).toEqual([]);
  });

  it('emergency staging is never purged by PRECACHE_PLAYLIST, and playlist staging is never purged by PRECACHE_EMERGENCY', async () => {
    const w = loadWorker();
    const big = randomBytes(w.hooks.LARGE_ASSET_BYTES + 7);
    w.setFetch(rangeFetch({ file: big, calls: [] }));
    const plUrl = 'https://cdn.example.com/storage/v1/object/public/assets/t1/promo-4k.mp4';
    // One chunk staged in each namespace.
    expect((await w.send({ type: 'PRECACHE_CHUNK', url: EM_URL, sha256: sha256Hex(big), size: big.length, offset: 0, chunkBytes: MiB, tier: 'emergency' })).ok).toBe(true);
    expect((await w.send({ type: 'PRECACHE_CHUNK', url: plUrl, sha256: sha256Hex(big), size: big.length, offset: 0, chunkBytes: MiB })).ok).toBe(true);
    const emStaged = () => stagedKeys(w).filter((k) => k.startsWith(EM_STAGE) || k.startsWith('/__edu_stage_em_')).length;
    const plStaged = () => stagedKeys(w).filter((k) => k.startsWith(PL_STAGE) || k.startsWith('/__edu_stage_info__/') || k.startsWith('/__edu_stage_ok__/')).length;
    expect(emStaged()).toBeGreaterThan(0);
    expect(plStaged()).toBeGreaterThan(0);

    // A playlist push that names NEITHER URL prunes only the playlist namespace.
    await w.send({ type: 'PRECACHE_PLAYLIST', assets: [{ url: 'https://cdn.example.com/other.jpg', size: 10 }] });
    expect(plStaged()).toBe(0);
    expect(emStaged()).toBeGreaterThan(0);

    // Re-stage the playlist chunk; an emergency push that names neither URL prunes only the emergency namespace.
    expect((await w.send({ type: 'PRECACHE_CHUNK', url: plUrl, sha256: sha256Hex(big), size: big.length, offset: 0, chunkBytes: MiB })).ok).toBe(true);
    await w.send({ type: 'PRECACHE_EMERGENCY', assets: [{ url: 'https://cdn.example.com/other-alert.png', sha256: null, size: 10 }], setHash: 'x' });
    expect(emStaged()).toBe(0);
    expect(plStaged()).toBeGreaterThan(0);
  });

  it('assembleStaged takes an explicit target tier: chunks staged for one tier cannot be assembled into the other; unknown tier refused; absent = playlist', async () => {
    const w = loadWorker();
    const big = randomBytes(w.hooks.LARGE_ASSET_BYTES + 9);
    w.setFetch(rangeFetch({ file: big, calls: [] }));
    const asset = { url: EM_URL, sha256: sha256Hex(big), size: big.length };
    // Stage + verify under the EMERGENCY tier only.
    let offset = 0;
    for (;;) {
      const r = await w.send({ type: 'PRECACHE_CHUNK', ...asset, offset, chunkBytes: 4 * MiB, tier: 'emergency' });
      expect(r.ok).toBe(true);
      offset = r.nextOffset;
      if (r.complete) break;
    }
    expect(await w.send({ type: 'PRECACHE_VERIFY', url: EM_URL, sha256: asset.sha256, tier: 'emergency' })).toMatchObject({ ok: true });
    // The playlist tier sees NOTHING staged for this URL — it cannot assemble it.
    expect(await w.send({ type: 'PRECACHE_ASSEMBLE', url: EM_URL, sha256: asset.sha256 })).toEqual({ ok: false, reason: 'not-verified' });
    expect(await w.send({ type: 'PRECACHE_ASSEMBLE', url: EM_URL, sha256: asset.sha256, tier: 'playlist' })).toEqual({ ok: false, reason: 'not-verified' });
    expect(await w.send({ type: 'PRECACHE_VERIFY', url: EM_URL, sha256: asset.sha256 })).toMatchObject({ ok: false, reason: 'incomplete', nextOffset: 0 });
    // An unknown tier is refused outright on every step.
    for (const type of ['PRECACHE_CHUNK', 'PRECACHE_VERIFY', 'PRECACHE_ASSEMBLE', 'PRECACHE_ADOPT']) {
      expect(await w.send({ type, ...asset, offset: 0, chunkBytes: MiB, tier: 'shell' })).toEqual({ ok: false, reason: 'bad-request' });
    }
    // The emergency tier assembles it — into EMERGENCY_CACHE, never PLAYLIST_CACHE.
    expect(await w.send({ type: 'PRECACHE_ASSEMBLE', url: EM_URL, sha256: asset.sha256, tier: 'emergency' })).toMatchObject({ ok: true, total: big.length });
    expect(w.cacheNamed(w.hooks.EMERGENCY_CACHE).entries.has(EM_URL)).toBe(true);
    expect(w.cacheNamed(w.hooks.PLAYLIST_CACHE).entries.has(EM_URL)).toBe(false);
  });

  it('a legacy LARGE emergency entry with a manifest digest is adoptable in its own tier — hashed on disk, no fetch', async () => {
    const w = loadWorker();
    const big = randomBytes(w.hooks.LARGE_ASSET_BYTES + 2);
    const server: RangeServer = { file: big, calls: [] };
    w.setFetch(rangeFetch(server));
    await w.seedLegacyEntry(w.hooks.EMERGENCY_CACHE, EM_URL, big);
    const asset = { url: EM_URL, sha256: sha256Hex(big), size: big.length };
    const first = await w.send({ type: 'PRECACHE_EMERGENCY', assets: [asset], setHash: 'set-adopt' });
    expect(first).toMatchObject({ ok: false, pending: [{ ...asset, adoptable: true }] });
    expect(metaSetHash(w)).toBeNull();
    // Adopting in the PLAYLIST tier finds nothing; the emergency tier adopts it.
    expect(await w.send({ type: 'PRECACHE_ADOPT', url: EM_URL, sha256: asset.sha256 })).toEqual({ ok: false, reason: 'not-cached' });
    expect(await w.send({ type: 'PRECACHE_ADOPT', url: EM_URL, sha256: asset.sha256, tier: 'emergency' })).toEqual({ ok: true, adopted: true, total: big.length });
    expect(server.calls).toEqual([]);
    const confirm = await w.send({ type: 'PRECACHE_EMERGENCY', assets: [asset], setHash: 'set-adopt' });
    expect(confirm).toEqual({ ok: true, failures: 0, count: 1, pending: [] });
    expect(metaSetHash(w)).toBe('set-adopt');
  });
});
