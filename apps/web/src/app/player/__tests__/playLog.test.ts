/**
 * playLog — the device play log (2026-11-09, player stability gap 7). See
 * playLog.ts: recording, completion, bounds, persistence, the upload
 * cadence, the emergency gate and the server's stop.
 */
import {
  PLAY_LOG_BATCH,
  PLAY_LOG_DRAIN_INTERVAL_MS,
  PLAY_LOG_FIRST_UPLOAD_MS,
  PLAY_LOG_MAX_QUEUE,
  PLAY_LOG_SEGMENT_MS,
  PLAY_LOG_STORAGE_KEY,
  PLAY_LOG_TICK_MS,
  PLAY_LOG_UPLOAD_INTERVAL_MS,
  PlayLogCore,
  playLogShown,
  startPlayLog,
  type PlayLogShown,
} from '../playLog';

const shown = (itemId: string, plannedMs: number | null = 10_000): PlayLogShown => ({
  playlistId: 'pl-1', itemId, assetId: `a-${itemId}`, plannedMs,
});
const W = 1_800_000_000_000; // wall clock base

describe('playLogShown', () => {
  const item = { id: 'it-1', durationMs: 8000, asset: { id: 'as-1', name: 'Secret Title' } };
  const playlist = { id: 'pl-1', isEmergency: false };
  const gates = { emergency: false, blanked: false, playing: true };

  it('logs ids only, never names or text', () => {
    const s = playLogShown(item, playlist, gates);
    expect(s).toEqual({ playlistId: 'pl-1', itemId: 'it-1', assetId: 'as-1', plannedMs: 8000 });
    expect(JSON.stringify(s)).not.toContain('Secret');
  });

  it('nothing is loggable during an alert, an emergency playlist, a blank or when not playing', () => {
    expect(playLogShown(item, playlist, { ...gates, emergency: true })).toBeNull();
    expect(playLogShown(item, { ...playlist, isEmergency: true }, gates)).toBeNull();
    expect(playLogShown(item, playlist, { ...gates, blanked: true })).toBeNull();
    expect(playLogShown(item, playlist, { ...gates, playing: false })).toBeNull();
    expect(playLogShown(null, playlist, gates)).toBeNull();
  });

  it('refuses ids the server would refuse, and never throws', () => {
    expect(playLogShown({ id: 'a b' }, playlist, gates)).toBeNull();
    expect(playLogShown({ get id() { throw new Error('x'); } }, playlist, gates)).toBeNull();
    expect(playLogShown({ id: 'v', durationMs: 0 }, playlist, gates)?.plannedMs).toBeNull();
  });
});

describe('PlayLogCore recording', () => {
  it('one entry per item shown, start on the wall clock, duration on the monotonic clock', () => {
    const c = new PlayLogCore(0);
    c.observe(shown('a'), false, W, 0);
    c.observe(shown('a'), false, W + 5_000, 5_000); // re-render: no-op
    c.observe(shown('b'), false, W + 3_600_000 /* NTP step */, 10_000);
    expect(c.queue).toEqual([
      { startedAt: W, shownMs: 10_000, completed: true, playlistId: 'pl-1', itemId: 'a', assetId: 'a-a' },
    ]);
  });

  it('completed: cut short by an alert is false; a full item is true; a video with no plan completes on advance', () => {
    const c = new PlayLogCore(0);
    c.observe(shown('a'), false, W, 0);
    c.observe(null, true, W + 4_000, 4_000); // alert takes the glass
    expect(c.queue[0].completed).toBe(false);
    c.observe(shown('v', null), false, W + 10_000, 10_000);
    c.observe(shown('b'), false, W + 40_000, 40_000);
    expect(c.queue[1]).toMatchObject({ itemId: 'v', completed: true, shownMs: 30_000 });
    c.observe(shown('v', null), false, W + 50_000, 50_000);
    c.interrupt(55_000);
    expect(c.queue[3]).toMatchObject({ itemId: 'v', completed: false });
  });

  it('a transition flicker is not a play', () => {
    const c = new PlayLogCore(0);
    c.observe(shown('a'), false, W, 0);
    c.observe(shown('b'), false, W + 100, 100);
    expect(c.queue).toHaveLength(0);
  });

  it('splits a solo item into segments so it still leaves a trail', () => {
    const c = new PlayLogCore(0);
    c.observe(shown('solo', 10_000), false, W, 0);
    c.tick(W + 60_000, 60_000);
    expect(c.queue).toHaveLength(0);
    c.tick(W + PLAY_LOG_SEGMENT_MS, PLAY_LOG_SEGMENT_MS);
    expect(c.queue).toHaveLength(1);
    expect(c.queue[0]).toMatchObject({ itemId: 'solo', shownMs: PLAY_LOG_SEGMENT_MS, completed: true });
    c.observe(shown('next'), false, W + PLAY_LOG_SEGMENT_MS + 5_000, PLAY_LOG_SEGMENT_MS + 5_000);
    expect(c.queue[1]).toMatchObject({ itemId: 'solo', startedAt: W + PLAY_LOG_SEGMENT_MS, shownMs: 5_000 });
  });

  it('bounded: the queue never exceeds its cap, oldest dropped first', () => {
    const c = new PlayLogCore(0);
    for (let i = 0; i < PLAY_LOG_MAX_QUEUE + 50; i++) {
      c.push({ startedAt: i, shownMs: 1000, completed: true, playlistId: 'p', itemId: 'i', assetId: null });
    }
    expect(c.queue).toHaveLength(PLAY_LOG_MAX_QUEUE);
    expect(c.queue[0].startedAt).toBe(50);
  });
});

describe('PlayLogCore upload decisions', () => {
  const fill = (c: PlayLogCore, n: number) => {
    for (let i = 0; i < n; i++) c.push({ startedAt: W + i, shownMs: 1000, completed: true, playlistId: 'p', itemId: `i${i}`, assetId: null });
  };

  it('waits for the first slot, never sends while an alert is on glass, one batch in flight', () => {
    const c = new PlayLogCore(0);
    fill(c, 3);
    expect(c.takeBatch(W, PLAY_LOG_FIRST_UPLOAD_MS - 1)).toBeNull();
    c.observe(null, true, W, PLAY_LOG_FIRST_UPLOAD_MS);
    expect(c.takeBatch(W, PLAY_LOG_FIRST_UPLOAD_MS)).toBeNull();
    c.observe(null, false, W, PLAY_LOG_FIRST_UPLOAD_MS);
    expect(c.takeBatch(W, PLAY_LOG_FIRST_UPLOAD_MS)).toHaveLength(3);
    expect(c.takeBatch(W, PLAY_LOG_FIRST_UPLOAD_MS)).toBeNull();
  });

  it('2xx removes exactly the batch sent; a backlog drains faster, else the slow cadence', () => {
    const c = new PlayLogCore(0, 0);
    fill(c, PLAY_LOG_BATCH * 2 + 1);
    const b = c.takeBatch(W, 0)!;
    expect(b).toHaveLength(PLAY_LOG_BATCH);
    c.settle({ status: 200, json: { stored: PLAY_LOG_BATCH } }, W, 0);
    expect(c.queue).toHaveLength(PLAY_LOG_BATCH + 1);
    expect(c.takeBatch(W, PLAY_LOG_DRAIN_INTERVAL_MS - 1)).toBeNull();
    expect(c.takeBatch(W, PLAY_LOG_DRAIN_INTERVAL_MS)).toHaveLength(PLAY_LOG_BATCH);
    c.settle({ status: 200, json: {} }, W, PLAY_LOG_DRAIN_INTERVAL_MS);
    expect(c.queue).toHaveLength(1);
    expect(c.takeBatch(W, PLAY_LOG_DRAIN_INTERVAL_MS * 2)).toBeNull();
  });

  it('a failure keeps the entries; a 400 / 413 batch is dropped rather than resent forever', () => {
    const c = new PlayLogCore(0, 0);
    fill(c, 5);
    c.takeBatch(W, 0);
    c.settle({ status: null, json: null }, W, 0);
    expect(c.queue).toHaveLength(5);
    c.takeBatch(W, PLAY_LOG_UPLOAD_INTERVAL_MS);
    c.settle({ status: 503, json: null }, W, PLAY_LOG_UPLOAD_INTERVAL_MS);
    expect(c.queue).toHaveLength(5);
    c.takeBatch(W, PLAY_LOG_UPLOAD_INTERVAL_MS * 2);
    c.settle({ status: 400, json: null }, W, PLAY_LOG_UPLOAD_INTERVAL_MS * 2);
    expect(c.queue).toHaveLength(0);
  });

  it('the server stop drops the queue and halts recording until retryAfterMs', () => {
    const c = new PlayLogCore(0, 0);
    fill(c, 5);
    c.takeBatch(W, 0);
    c.settle({ status: 200, json: { stop: true, retryAfterMs: 3_600_000 } }, W, 0);
    expect(c.queue).toHaveLength(0);
    c.observe(shown('a'), false, W + 1000, 1000);
    c.observe(shown('b'), false, W + 20_000, 20_000);
    expect(c.queue).toHaveLength(0);
    c.observe(shown('c'), false, W + 3_600_001, 3_600_001);
    c.observe(shown('d'), false, W + 3_620_000, 3_620_000);
    expect(c.queue).toHaveLength(1);
  });
});

describe('PlayLogCore persistence', () => {
  it('round-trips, and drops another screen\'s queue', () => {
    const c = new PlayLogCore(0);
    c.push({ startedAt: W, shownMs: 1000, completed: false, playlistId: 'p', itemId: 'i', assetId: null });
    c.stopUntil = 42;
    const raw = c.serialize('scr-1');
    const back = new PlayLogCore(0);
    back.load(raw, 'scr-1');
    expect(back.queue).toEqual(c.queue);
    expect(back.stopUntil).toBe(42);
    const other = new PlayLogCore(0);
    other.load(raw, 'scr-2');
    expect(other.queue).toEqual([]);
    const junk = new PlayLogCore(0);
    junk.load('{not json', 'scr-1');
    junk.load(JSON.stringify({ v: 1, s: 'scr-1', q: [[1, 2, 1, 'bad id', 'i', null], 'x'] }), 'scr-1');
    expect(junk.queue).toEqual([]);
  });
});

describe('startPlayLog glue', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function harness(over: { post?: any; storage?: any } = {}) {
    let mono = 0;
    const store = new Map<string, string>();
    const storage = over.storage ?? { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
    const post = over.post ?? jest.fn(async () => ({ status: 200, json: { stored: 1 } }));
    const h = startPlayLog({
      screenId: 'scr-1',
      getToken: () => 'tok',
      apiRoot: () => 'https://api.example',
      clockOffsetMs: () => 500,
      storage,
      post,
      now: () => W + mono,
      mono: () => mono,
    });
    const advance = (ms: number) => { mono += ms; jest.advanceTimersByTime(ms); };
    return { h, post, store, advance, setMono: (m: number) => { mono = m; } };
  }

  it('records with the server offset, persists, and uploads to the device route with the bearer', async () => {
    const t = harness();
    t.h.observe(shown('a'), false);
    t.advance(10_000);
    t.h.observe(shown('b'), false);
    t.advance(PLAY_LOG_FIRST_UPLOAD_MS + 60_000 + PLAY_LOG_TICK_MS);
    await Promise.resolve();
    expect(t.post).toHaveBeenCalledTimes(1);
    const [url, init] = t.post.mock.calls[0];
    expect(url).toBe('https://api.example/api/v1/screens/scr-1/play-log');
    expect(init.headers.Authorization).toBe('Bearer tok');
    const body = JSON.parse(init.body);
    expect(body.entries[0]).toMatchObject({ itemId: 'a', startedAt: W + 500, shownMs: 10_000 });
    expect(t.store.get(PLAY_LOG_STORAGE_KEY)).toBeTruthy();
    t.h.stop();
  });

  it('a throwing network, storage and clock never escape', async () => {
    const t = harness({
      post: jest.fn(() => { throw new Error('boom'); }),
      storage: { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } },
    });
    expect(() => t.h.observe(shown('a'), false)).not.toThrow();
    t.advance(10_000);
    expect(() => t.h.observe(shown('b'), false)).not.toThrow();
    expect(() => t.advance(PLAY_LOG_FIRST_UPLOAD_MS + 120_000)).not.toThrow();
    expect(() => t.h.stop()).not.toThrow();
  });

  it('stop() closes the open entry and stops the timer', () => {
    const t = harness();
    t.h.observe(shown('a'), false);
    t.advance(5_000);
    t.h.stop();
    const saved = JSON.parse(t.store.get(PLAY_LOG_STORAGE_KEY)!);
    expect(saved.q[0]).toEqual([W + 500, 5_000, 0, 'pl-1', 'a', 'a-a']);
    t.advance(PLAY_LOG_FIRST_UPLOAD_MS * 4);
    expect(t.post).not.toHaveBeenCalled();
  });
});
