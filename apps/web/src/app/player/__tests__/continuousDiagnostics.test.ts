import { ContinuousPlaybackDiagnostics, ContinuousPumpDiagnostics } from '../continuousDiagnostics';

const counters = (totalFrames = 0, droppedFrames = 0) => ({ totalFrames, droppedFrames });
const pump = () => ({ ...new ContinuousPumpDiagnostics().snapshot(), aheadMs: 19000, minAheadMs: 17000 });
const record = (line: string | null) => JSON.parse(line!.slice(line!.indexOf('{')));
function started() {
  const d = new ContinuousPlaybackDiagnostics();
  d.reset(0, counters()); d.playing(0);
  return d;
}

test('latencies include successful and failed operations without changing their outcomes; startup buffer is excluded', async () => {
  let clock = 0;
  const d = new ContinuousPumpDiagnostics(() => clock);
  d.observeAhead(0);
  expect(d.snapshot().minAheadMs).toBeNull();
  const result = await d.measure('read', async () => { clock += 7; return 'verified bytes'; });
  expect(result).toBe('verified bytes');
  const error = new Error('append failed');
  await expect(d.measure('append', async () => { clock += 23; throw error; })).rejects.toBe(error);
  await d.measure('prune', async () => { clock += 11; });
  await d.measure('read', async () => { clock += 5; });
  d.start(); d.observeAhead(19); d.observeAhead(8.125); d.observeAhead(20);
  expect(d.snapshot()).toEqual({ aheadMs: 20000, minAheadMs: 8125, latency: {
    read: { count: 2, totalMs: 12, maxMs: 7 }, append: { count: 1, totalMs: 23, maxMs: 23 },
    prune: { count: 1, totalMs: 11, maxMs: 11 },
  } });
  d.snapshot().latency.read.maxMs = 999;
  expect(d.snapshot().latency.read.maxMs).toBe(7);
});

test('healthy playback and initial load remain quiet; windows require a minute and 150 frames', () => {
  const d = started();
  expect(d.sample(59999, counters(1000, 500), pump())).toBeNull();
  expect(d.sample(60000, counters(149, 100), pump())).toBeNull();
  expect(d.sample(60000, counters(1000, 0), pump())).toBeNull();
  expect(d.sample(120000, counters(2000, 100), pump())).toBeNull();
  const cold = new ContinuousPlaybackDiagnostics(); cold.reset(0, counters());
  cold.waiting(0, 0);
  expect(cold.sample(60000, counters(1000, 500), pump())).toBeNull();
});

test.each([0, 18.75])('waiting records real headroom %s separately from decoder timing and frame drops', ahead => {
  const d = started();
  d.frame(0.012); d.frame(0.036); d.frame(undefined); d.frame(NaN);
  d.waiting(1000, ahead); d.waiting(1100, 999); d.playing(2500);
  const line = d.sample(60000, counters(1000, 550), pump());
  expect(line).toMatch(/^\[Player\] stalled playback sample /);
  expect(record(line)).toMatchObject({ f: 1000, d: 550, w: 1, waitMs: 1500,
    waitAheadMs: [ahead * 1000, ahead * 1000], decodeMs: [2, 24, 36], aheadMs: 19000 });
  expect(line!.length).toBeLessThanOrEqual(450);
  expect(line).not.toMatch(/https?:|token|url|source|content/i);
  expect(d.sample(120000, counters(2000, 550), pump())).toBeNull();
});

test('frequent short waits qualify without dropped frames; a brief isolated wait does not', () => {
  const d = started();
  for (let i = 0; i < 3; i++) { d.waiting(i * 100, 20); d.playing(i * 100 + 10); }
  expect(record(d.sample(60000, counters(1000), pump()))).toMatchObject({ w: 3, waitMs: 30 });
  d.waiting(61000, 20); d.playing(61010);
  expect(d.sample(120000, counters(2000), pump())).toBeNull();
});

test('drops-only label is truthful; counter reset cannot invent a delta or disable future evidence', () => {
  const d = started();
  expect(d.sample(60000, counters(1000, 500), pump())).toMatch(/^\[Player\] failed frame budget /);
  expect(d.sample(120000, counters(10, 1), pump())).toBeNull();
  expect(record(d.sample(180000, counters(1010, 501), pump()))).toMatchObject({ f: 1000, d: 500, w: 0 });
});

test('an open wait carries its duration and original headroom across windows; source reset clears it', () => {
  const d = started(); d.waiting(59000, 17);
  expect(record(d.sample(60000, counters(1000), pump()))).toMatchObject({ w: 1, waitMs: 1000, waitAheadMs: [17000, 17000] });
  expect(record(d.sample(120000, counters(2000), pump()))).toMatchObject({ w: 1, waitMs: 60000, waitAheadMs: [17000, 17000] });
  d.reset(120000, counters(2000)); d.playing(120000);
  expect(d.sample(180000, counters(3000), pump())).toBeNull();
});
