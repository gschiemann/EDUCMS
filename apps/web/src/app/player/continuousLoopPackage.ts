/** Lossless, bounded fragmentation of a VERIFIED, already cached MP4.
 * No origin fetch, re-encode, downscale, or whole-file ArrayBuffer. Original
 * media stays playable while preparation runs. Only a complete package commits.
 */
import type { Sample, Track } from 'mp4box';
import { lookupCached } from './offline-cache';
import { CONTINUOUS_LOOP_REVISION } from './continuousLoopRevision';

export const LOOP_CACHE = 'venueos-continuous-loop-v1';
const READ_BYTES = 1024 * 1024;
export const MAX_FRAGMENT_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 1024 * 1024 * 1024;
const ROOT = `/__venueos_loop__/v${CONTINUOUS_LOOP_REVISION}/`;

export interface LoopFragment { key: string; bytes: number; sha256: string; endTicks: number }
export interface LoopPackage {
  version: typeof CONTINUOUS_LOOP_REVISION; sourceHash: string; mime: string; timescale: number;
  durationTicks: number; firstPts: number; init: LoopFragment;
  fragments: LoopFragment[];
  /** Presentation ticks relative to firstPts, sorted; required for safe eviction. */
  keyframeTicks: number[];
}

export function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
}

/** Bounds a COMPLETE async operation, including body reads. */
export function bounded<T>(signal: AbortSignal, ms: number, work: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    // eslint-disable-next-line prefer-const -- abort may run before timer installation
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (err: unknown, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (err) reject(err); else resolve(value as T);
    };
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new Error('operation-timeout')), ms);
    Promise.resolve().then(work).then(v => finish(null, v), e => finish(e));
  });
}

export async function sha256(data: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Use the source's time-to-sample table. MP4Box derives the final duration
 * from mdhd, which can include encoder delay; that is not the sample's stts
 * duration. Rebuild decode times too so variable-length runs stay exact. */
export function restoreSampleTiming(samples: Pick<Sample, 'dts' | 'cts' | 'duration'>[], counts: number[], deltas: number[]): void {
  if (counts.length !== deltas.length || counts.reduce((a, b) => a + b, 0) !== samples.length) throw new Error('unsupported-stts');
  let index = 0; let dts = 0;
  for (let run = 0; run < counts.length; run++) {
    if (!Number.isSafeInteger(counts[run]) || counts[run] <= 0 || !Number.isSafeInteger(deltas[run]) || deltas[run] <= 0) throw new Error('unsupported-stts');
    for (let n = 0; n < counts[run]; n++) {
      const s = samples[index++];
      s.cts += dts - s.dts; s.dts = dts; s.duration = deltas[run];
      dts += s.duration;
    }
  }
}

/** Source presentation coverage, including B-frame reordering. Integer ticks
 * prevent accumulated duration rounding. A timestamp hole is refused, not hidden.
 */
export function sampleTimeline(samples: Pick<Sample, 'cts' | 'duration' | 'is_sync'>[], timescale: number) {
  if (!Number.isSafeInteger(timescale) || timescale <= 0 || !samples.length || samples.length > 100_000 || !samples[0].is_sync) {
    throw new Error('unsupported-sample-table');
  }
  const sorted = samples.map(s => ({ pts: s.cts, duration: s.duration })).sort((a, b) => a.pts - b.pts);
  const firstPts = sorted[0].pts;
  let end = firstPts;
  for (const s of sorted) {
    if (!Number.isSafeInteger(s.pts) || !Number.isSafeInteger(s.duration) || s.duration <= 0 || s.pts !== end) {
      throw new Error('non-contiguous-samples');
    }
    end += s.duration;
  }
  const durationTicks = end - firstPts;
  if (durationTicks <= 0 || durationTicks / timescale > 600) throw new Error('unsupported-duration');
  return { firstPts, durationTicks };
}

function validFragment(f: LoopFragment, hash: string): boolean {
  return typeof f?.key === 'string' && f.key.startsWith(`${ROOT}${hash}/`) &&
    Number.isSafeInteger(f.bytes) && f.bytes > 0 && f.bytes <= MAX_FRAGMENT_BYTES &&
    /^[a-f0-9]{64}$/.test(f.sha256) && Number.isSafeInteger(f.endTicks) && f.endTicks >= 0;
}

export function validLoopPackage(p: LoopPackage, hash: string): boolean {
  return p?.version === CONTINUOUS_LOOP_REVISION && p.sourceHash === hash && /^video\/mp4; codecs="avc[13]\.[a-fA-F0-9]{6}"$/.test(p.mime) &&
    Number.isSafeInteger(p.timescale) && p.timescale > 0 && Number.isSafeInteger(p.firstPts) &&
    Number.isSafeInteger(p.durationTicks) && p.durationTicks > 0 && p.durationTicks / p.timescale <= 600 &&
    Array.isArray(p.keyframeTicks) && p.keyframeTicks.length > 0 && p.keyframeTicks.length <= 100_000 && p.keyframeTicks[0] === 0 &&
    p.keyframeTicks.every((t, i) => Number.isSafeInteger(t) && t >= 0 && t < p.durationTicks && (i === 0 || t > p.keyframeTicks[i - 1])) &&
    validFragment(p.init, hash) && Array.isArray(p.fragments) && p.fragments.length > 0 && p.fragments.length <= 10_000 &&
    p.fragments.every(f => validFragment(f, hash) && f.endTicks <= p.durationTicks) &&
    Math.max(...p.fragments.map(f => f.endTicks)) === p.durationTicks;
}

export async function readLoopFragment(cache: Cache, f: LoopFragment, signal: AbortSignal): Promise<ArrayBuffer> {
  return bounded(signal, 15_000, async () => {
    const res = await cache.match(f.key);
    if (!res || Number(res.headers.get('content-length')) !== f.bytes) throw new Error('fragment-missing');
    const blob = await res.blob();
    if (blob.size !== f.bytes || blob.size > MAX_FRAGMENT_BYTES) throw new Error('fragment-size');
    const data = await blob.arrayBuffer();
    if (await sha256(data) !== f.sha256) throw new Error('fragment-digest');
    return data;
  });
}

let packagingTail: Promise<unknown> = Promise.resolve();

/** Serialize preparation in THIS document (including React StrictMode).
 * Other display faces have independent queues and share the origin's cache. */
export function prepareLoopPackage(src: string, sourceHash: string, signal: AbortSignal): Promise<LoopPackage> {
  const job = packagingTail.catch(() => undefined).then(() => prepare(src, sourceHash, signal));
  packagingTail = job.catch(() => undefined);
  return job;
}

async function prepare(src: string, sourceHash: string, signal: AbortSignal): Promise<LoopPackage> {
  checkAbort(signal);
  if (!/^[a-f0-9]{64}$/.test(sourceHash) || typeof caches === 'undefined') throw new Error('verified-source-required');
  const deadline = performance.now() + 45_000;
  while (true) {
    const state = await bounded(signal, 15_000, () => lookupCached([{ url: src, sha256: sourceHash }]));
    checkAbort(signal);
    if (state?.[src]?.current) break;
    if (performance.now() >= deadline) throw new Error('verified-source-required');
    await bounded(signal, 1500, () => new Promise<void>(r => setTimeout(r, 500)));
  }
  // Read exactly the ordinary playlist tier; never mutate or package emergency media.
  const names = (await caches.keys()).filter(n => /^edu-player-playlist-v\d+$/.test(n))
    .sort((a, b) => Number(b.split('-v').pop()) - Number(a.split('-v').pop())).slice(0, 1);
  let response: Response | undefined;
  for (const name of names) {
    const c = await caches.open(name);
    response = await c.match(src, { ignoreSearch: true });
    if (response) break;
  }
  if (!response) throw new Error('cached-source-missing');
  const blob = await bounded(signal, 15_000, () => response!.blob());
  if (blob.size <= 0 || blob.size > MAX_SOURCE_BYTES) throw new Error('source-size');
  const cache = await caches.open(LOOP_CACHE);
  const manifestKey = `${ROOT}${sourceHash}/manifest`;
  const existing = await cache.match(manifestKey);
  if (existing) {
    const data = await bounded(signal, 10_000, () => existing.json()) as LoopPackage;
    if (validLoopPackage(data, sourceHash)) return data;
  }
  // CacheStorage is shared by both face WebViews; packagingTail is not. Never
  // evict another face's playing/preparing bytes (even for this same hash).
  // Each attempt owns an immutable nonce namespace. Publish its manifest last;
  // concurrent successful writers may replace that pointer without invalidating
  // either returned package. Quota failure uses the existing native fallback,
  // and the catch below removes ONLY this attempt's unpublished namespace.
  const nonce = Array.from(crypto.getRandomValues(new Uint32Array(2))).join('-');
  const prefix = `${ROOT}${sourceHash}/${nonce}/`;
  const { createFile } = await import('mp4box');
  const file = createFile();
  let track: Track | undefined;
  let timeline: ReturnType<typeof sampleTimeline> | undefined;
  let samples: Sample[] = [];
  let packageData: LoopPackage | undefined;
  let nextSample = 0;
  let parseError: Error | undefined;
  let writes: Promise<void>[] = [];
  const save = async (key: string, buffer: ArrayBuffer, endTicks: number): Promise<LoopFragment> => {
    checkAbort(signal);
    if (buffer.byteLength <= 0 || buffer.byteLength > MAX_FRAGMENT_BYTES) throw new Error('fragment-too-large');
    const digest = await sha256(buffer);
    checkAbort(signal);
    await bounded(signal, 15_000, () => cache.put(key, new Response(buffer, {
      headers: { 'content-type': 'video/mp4', 'content-length': String(buffer.byteLength) },
    })));
    return { key, bytes: buffer.byteLength, sha256: digest, endTicks };
  };
  file.onError = () => { parseError = new Error('mp4-parse'); };
  file.onSegment = (id, _user, data, lastSample) => {
    if (!track || !timeline || !packageData || id !== track.id) { parseError = new Error('segment-state'); return; }
    const first = nextSample;
    nextSample = lastSample;
    const index = packageData.fragments.length;
    const endTicks = Math.max(...samples.slice(first, lastSample).map(s => s.cts + s.duration)) - timeline.firstPts;
    // Reserve order synchronously; writes are drained after EVERY 1 MiB read.
    packageData.fragments.push({ key: '', bytes: 0, sha256: '', endTicks });
    const target = packageData;
    writes.push(save(`${prefix}${index}`, data, endTicks).then(f => { target.fragments[index] = f; }));
    file.releaseUsedSamples(id, lastSample);
  };
  file.onReady = info => {
    try {
      if (info.videoTracks.length !== 1 || info.isFragmented) throw new Error('unsupported-mp4');
      track = info.videoTracks[0];
      if (!/^avc[13]\.[a-fA-F0-9]{6}$/.test(track.codec)) throw new Error('unsupported-codec');
      samples = file.getTrackSamplesInfo(track.id);
      const stts = file.getTrackById(track.id)!.mdia!.minf!.stbl!.stts!;
      restoreSampleTiming(samples, stts.sample_counts, stts.sample_deltas);
      timeline = sampleTimeline(samples, track.timescale);
      if (track.edits?.some(e => e.media_time !== timeline!.firstPts || e.media_rate_integer !== 1 || e.media_rate_fraction !== 0)) {
        throw new Error('unsupported-edit-list');
      }
      if (track.edits && (track.edits.length !== 1 || Math.abs(track.edits[0].segment_duration / track.movie_timescale - timeline.durationTicks / track.timescale) > 1 / track.movie_timescale)) {
        throw new Error('trimmed-edit-list');
      }
      const mime = `video/mp4; codecs="${track.codec}"`;
      if (!MediaSource.isTypeSupported(mime)) throw new Error('mse-codec-unsupported');
      file.setSegmentOptions(track.id, null, { nbSamples: 60, rapAlignement: false });
      // We normalize presentation timestamps ourselves, including standard B-frame
      // encoder delay. Remove the edit list so it is not applied a second time.
      const trak = file.getTrackById(track.id)!;
      trak.boxes = (trak.boxes ?? []).filter(b => b.type !== 'edts');
      delete trak.edts;
      const init = file.initializeSegmentation('per-track')[0].buffer;
      const keyframeTicks = samples.filter(s => s.is_sync).map(s => s.cts - timeline!.firstPts).sort((a, b) => a - b);
      if (keyframeTicks[0] !== 0) throw new Error('unsupported-first-keyframe');
      packageData = { version: CONTINUOUS_LOOP_REVISION, sourceHash, mime, timescale: track.timescale, ...timeline, keyframeTicks,
        init: { key: '', bytes: 0, sha256: '', endTicks: 0 }, fragments: [] };
      const target = packageData;
      writes.push(save(`${prefix}init`, init, 0).then(f => { target.init = f; }));
      file.start();
    } catch (e) { parseError = e instanceof Error ? e : new Error('mp4-profile'); }
  };
  try {
    const started = performance.now();
    for (let offset = 0; offset < blob.size; offset += READ_BYTES) {
      checkAbort(signal);
      if (performance.now() - started > 120_000) throw new Error('package-timeout');
      const data = await bounded(signal, 15_000, () => blob.slice(offset, offset + READ_BYTES).arrayBuffer());
      const input = data as ArrayBuffer & { fileStart: number };
      input.fileStart = offset;
      file.appendBuffer(input);
      if (parseError) throw parseError;
      if (!packageData && offset >= READ_BYTES * 2) throw new Error('faststart-required');
      await Promise.all(writes); writes = [];
      if (file.getAllocatedSampleDataSize() > MAX_FRAGMENT_BYTES * 2) throw new Error('parser-memory-budget');
      // Yield to playback/UI on slow panels rather than parsing the whole file
      // in one main-thread turn. No decode or encode work is done here.
      await bounded(signal, 1000, () => new Promise<void>(r => setTimeout(r, 0)));
    }
    file.flush();
    await Promise.all(writes);
    checkAbort(signal);
    if (parseError) throw parseError;
    if (!packageData || nextSample !== samples.length || !validLoopPackage(packageData, sourceHash)) throw new Error('incomplete-package');
    // Last write is the publication barrier: partial fragments cannot be played.
    await bounded(signal, 10_000, () => cache.put(manifestKey, new Response(JSON.stringify(packageData))));
    return packageData;
  } catch (e) {
    await Promise.allSettled(writes);
    for (const key of await cache.keys()) if (new URL(key.url).pathname.startsWith(prefix)) await cache.delete(key);
    throw e;
  } finally { file.stop(); }
}
