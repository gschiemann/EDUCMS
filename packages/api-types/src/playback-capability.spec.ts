import {
  CLASS_EVIDENCE_MIN_SCREENS,
  EMPTY_FILE_PLAYBACK,
  computePlaybackCapability,
  decidePlayback,
  declaredMaxShortEdge,
  faceConcurrentVideos,
  filePlaybackVerdict,
  foldPlaybackSample,
  gradePlaybackSample,
  isSettledSample,
  playbackClassDefault,
  playbackDeviceClass,
  summarizeScreenPlayback,
  unitConcurrentVideos,
  type CapabilityRecordInput,
  type FilePlaybackRecord,
  type PlaybackCapability,
  type PlaybackDemand,
  type PlaybackSampleInput,
} from './playback-capability';

const settled = (over: Partial<PlaybackSampleInput> = {}): PlaybackSampleInput => ({
  totalFrames: 1800,
  droppedFrames: 0,
  stalls: 0,
  stalledMs: 0,
  cached: true,
  concurrent: 1,
  width: 3840,
  height: 2160,
  ...over,
});

const foldAll = (samples: PlaybackSampleInput[], unitConcurrent?: number): FilePlaybackRecord =>
  samples.reduce<FilePlaybackRecord>((r, s) => foldPlaybackSample(r, s, { unitConcurrent }), { ...EMPTY_FILE_PLAYBACK });

describe('gradePlaybackSample (the one definition, moved from screenOps)', () => {
  it.each([
    [{ totalFrames: 100, droppedFrames: 0 }, 'short'],
    [{ totalFrames: 1800, droppedFrames: 0 }, 'smooth'],
    [{ totalFrames: 1800, droppedFrames: 17 }, 'smooth'], // 0.9 %
    [{ totalFrames: 1800, droppedFrames: 18 }, 'hitching'], // 1.0 %
    [{ totalFrames: 1800, droppedFrames: 90 }, 'stuttering'], // 5.0 %
    [{ totalFrames: 1466, droppedFrames: 800 }, 'stuttering'], // DH43 front
    [{ totalFrames: 1800, droppedFrames: 0, stalls: 3, stalledMs: 100 }, 'stuttering'],
    [{ totalFrames: 1800, droppedFrames: 0, stalls: 1, stalledMs: 5000 }, 'stuttering'],
    [{ totalFrames: 1800, droppedFrames: 0, stalls: 1, stalledMs: 1000 }, 'hitching'],
    [{ totalFrames: 100, droppedFrames: 0, stalls: 1, stalledMs: 1200 }, 'hitching'],
    [{ totalFrames: 1800, droppedFrames: 0, stalls: 0, stalledMs: 9000 }, 'smooth'], // waiting with no pause is ignored
  ])('%j → %s', (s, grade) => {
    expect(gradePlaybackSample(s)).toBe(grade);
  });
});

describe('isSettledSample — only decode evidence counts', () => {
  it('a full cached minute is settled', () => expect(isSettledSample(settled())).toBe(true));
  it('fewer than 840 frames is not', () => expect(isSettledSample(settled({ totalFrames: 839 }))).toBe(false));
  it('a full minute of 24 fps (1,440 frames) and of 15 fps (900) is', () => {
    expect(isSettledSample(settled({ totalFrames: 1440 }))).toBe(true);
    expect(isSettledSample(settled({ totalFrames: 900 }))).toBe(true);
  });
  it('the first stretch after activation is not', () => expect(isSettledSample(settled({ first: true }))).toBe(false));
  it('an uncached sample never is — whatever happened was delivery', () => {
    expect(isSettledSample(settled({ cached: false, stalls: 0 }))).toBe(false);
    expect(isSettledSample(settled({ cached: false, droppedFrames: 900 }))).toBe(false);
  });
  it('unknown cache state counts only with no pause to buffer', () => {
    expect(isSettledSample(settled({ cached: undefined }))).toBe(true);
    expect(isSettledSample(settled({ cached: null, stalls: 1, stalledMs: 50 }))).toBe(false);
  });
});

describe('foldPlaybackSample — one record per (screen, file)', () => {
  it('three smooth settled samples make a smooth verdict', () => {
    const r = foldAll([settled(), settled({ droppedFrames: 2 }), settled({ droppedFrames: 1 })]);
    expect(r).toMatchObject({ samples: 3, settledSamples: 3, frames: 5400, dropped: 3, consecutiveGood: 3, verdict: 'smooth' });
  });

  it('three stuttering settled samples make a stuttering verdict (DH43 shape)', () => {
    const r = foldAll([1, 2, 3].map(() => settled({ totalFrames: 1500, droppedFrames: 780, width: 1080, height: 1668 })), 2);
    expect(r).toMatchObject({ consecutiveBad: 3, verdict: 'stuttering', unitConcurrentMax: 2 });
    expect(r.worstPct).toBe(52);
  });

  it('uncached / first / short samples count as samples but never move the decode counters or the verdict', () => {
    const r = foldAll([
      settled({ first: true, droppedFrames: 900 }),
      settled({ cached: false, droppedFrames: 900, stalls: 9, stalledMs: 20000 }),
      settled({ totalFrames: 400, droppedFrames: 300 }),
    ]);
    expect(r).toMatchObject({ samples: 3, settledSamples: 0, frames: 0, dropped: 0, stalls: 0, verdict: 'insufficient', consecutiveBad: 0 });
    expect(r.lastPct).toBe(75);
    expect(r.lastSettled).toBe(false);
  });

  it('a mixed history is graded on its aggregate, so one hitch after clean minutes does not flip it', () => {
    const r = foldAll([settled(), settled(), settled(), settled(), settled({ droppedFrames: 25 })]);
    expect(r.consecutiveGood).toBe(0);
    expect(r.verdict).toBe('smooth'); // 25 / 9000 = 0.3 %
  });

  it('fewer than three settled samples is insufficient', () => {
    expect(foldAll([settled(), settled()]).verdict).toBe('insufficient');
    expect(filePlaybackVerdict({ settledSamples: 2, frames: 3600, dropped: 0, consecutiveGood: 2, consecutiveBad: 0 })).toBe('insufficient');
  });

  it('a hitching sample breaks both streaks', () => {
    const r = foldAll([settled({ droppedFrames: 900 }), settled({ droppedFrames: 900 }), settled({ droppedFrames: 30 })]);
    expect(r.consecutiveBad).toBe(0);
    expect(r.consecutiveGood).toBe(0);
  });

  it('concurrency: max of the face count and the unit count, clamped 1..16', () => {
    const r = foldPlaybackSample(null, settled({ concurrent: 3 }), { unitConcurrent: 1 });
    expect(r.concurrentMax).toBe(3);
    expect(r.unitConcurrentMax).toBe(3);
    expect(foldPlaybackSample(null, settled({ concurrent: 99 })).concurrentMax).toBe(16);
    expect(foldPlaybackSample(null, settled({ concurrent: null })).concurrentMax).toBe(1);
  });

  it('garbage counters never throw and never invent frames', () => {
    const r = foldPlaybackSample(null, { totalFrames: NaN, droppedFrames: -4 } as PlaybackSampleInput);
    expect(r).toMatchObject({ samples: 1, settledSamples: 0, frames: 0, lastPct: null });
  });

  it('does not mutate its input', () => {
    const prev = foldAll([settled()]);
    const copy = { ...prev };
    foldPlaybackSample(prev, settled());
    expect(prev).toEqual(copy);
  });
});

describe('device class', () => {
  it('normalises the Build identity', () => {
    expect(playbackDeviceClass({ manufacturer: 'Goodview', model: 'M65GUQ-BOP382D-C', device: 'T982', sdk: 30 }))
      .toBe('goodview/m65guq-bop382d-c/t982/sdk30');
    expect(playbackDeviceClass({ manufacturer: 'rockchip', model: 'rk3288', sdk: 25 })).toBe('rockchip/rk3288/unknown/sdk25');
    expect(playbackDeviceClass({ manufacturer: 'x' })).toBeNull();
    expect(playbackDeviceClass(null)).toBeNull();
  });

  it('trims edge dashes and bounds a hostile model string in linear time (CodeQL polynomial-redos)', () => {
    expect(playbackDeviceClass({ manufacturer: '--Acme--', model: ' Box!! ', device: '-x-', sdk: 30 }))
      .toBe('acme/box/x/sdk30');
    expect(playbackDeviceClass({ manufacturer: 'a', model: '-'.repeat(100) + 'z', sdk: 30 })).toBe('a/z/unknown/sdk30');
    // A 200k-dash model is cut to 256 chars BEFORE any regex runs, so the
    // quadratic `-+$` case can no longer be reached; it answers at once.
    const t0 = Date.now();
    playbackDeviceClass({ manufacturer: 'a', model: '-'.repeat(200_000) + 'z', sdk: 30 });
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it('class defaults: GUQ 4K, rk3288 1080p with one video per unit, M75 deliberately absent', () => {
    expect(playbackClassDefault('goodview/m55guq-cs1382d-c/x/sdk30')).toMatchObject({ maxShortEdge: 2160, maxUnitConcurrentVideos: 1 });
    expect(playbackClassDefault('rockchip/rk3288/rk3288/sdk25')).toMatchObject({ maxShortEdge: 1080, maxUnitConcurrentVideos: 1 });
    expect(playbackClassDefault('amlogic/t982_ar301/x/sdk33')).toMatchObject({ maxShortEdge: 2160 });
    expect(playbackClassDefault('goodview/m75guq-x/x/sdk30')).toBeNull();
    expect(playbackClassDefault('acme/unknown-box/x/sdk30')).toBeNull();
    expect(playbackClassDefault(null)).toBeNull();
  });
});

describe('declaredMaxShortEdge', () => {
  it('largest config declared supported AND smooth', () => {
    expect(declaredMaxShortEdge({ configs: [
      { id: '1080p30-landscape', supported: true, smooth: true, powerEfficient: true },
      { id: '2160p30-landscape', supported: true, smooth: false, powerEfficient: false },
    ] })).toBe(1080);
    expect(declaredMaxShortEdge({ configs: [{ id: '2160p30-portrait', supported: true, smooth: true, powerEfficient: true }] })).toBe(2160);
    expect(declaredMaxShortEdge({ configs: [{ id: '1080p30-portrait', supported: false, smooth: true, powerEfficient: true }] })).toBeNull();
    expect(declaredMaxShortEdge(null)).toBeNull();
  });
});

const rec = (over: Partial<CapabilityRecordInput> = {}): CapabilityRecordInput => ({
  screenId: 's1',
  width: 3840,
  height: 2160,
  verdict: 'smooth',
  unitConcurrentMax: 1,
  lastAt: '2026-10-11T19:35:00.000Z',
  playerVersionCode: 27,
  webviewMajor: 120,
  ...over,
});

const GUQ = 'goodview/m65guq-bop382d-c/t982/sdk30';
const RK = 'rockchip/rk3288/rk3288/sdk25';

describe('computePlaybackCapability — precedence', () => {
  it('unknown device, nothing reported → unknown, never a claim', () => {
    const cap = computePlaybackCapability({ deviceClass: null, screenRecords: [] });
    expect(cap).toMatchObject({ maxShortEdge: null, evidence: 'unknown', maxUnitConcurrentVideos: null, concurrencyEvidence: 'unknown', maxFps: null });
  });

  it('class default alone', () => {
    expect(computePlaybackCapability({ deviceClass: GUQ, screenRecords: [] }))
      .toMatchObject({ maxShortEdge: 2160, evidence: 'class-default', maxUnitConcurrentVideos: 1, concurrencyEvidence: 'class-default', maxFps: 30 });
  });

  it('declared beats the class default', () => {
    const cap = computePlaybackCapability({
      deviceClass: GUQ,
      screenRecords: [],
      declared: { configs: [{ id: '1080p30-landscape', supported: true, smooth: true, powerEfficient: true }] },
    });
    expect(cap).toMatchObject({ maxShortEdge: 1080, evidence: 'declared' });
  });

  it('measured on the class (≥ 2 other screens) beats declared', () => {
    const classRecords = [rec({ screenId: 'a' }), rec({ screenId: 'b' })];
    const cap = computePlaybackCapability({
      deviceClass: GUQ,
      screenRecords: [],
      classRecords,
      declared: { configs: [{ id: '1080p30-landscape', supported: true, smooth: true, powerEfficient: true }] },
    });
    expect(cap).toMatchObject({ maxShortEdge: 2160, evidence: 'measured-class', classScreens: 2 });
  });

  it(`class evidence needs ${CLASS_EVIDENCE_MIN_SCREENS} distinct screens`, () => {
    const cap = computePlaybackCapability({ deviceClass: null, screenRecords: [], classRecords: [rec({ screenId: 'a' }), rec({ screenId: 'a', width: 1920, height: 1080 })] });
    expect(cap).toMatchObject({ evidence: 'unknown', classScreens: 0 });
  });

  it('pre-aggregated class rows carry their own distinct-screen count', () => {
    const agg = [rec({ screenId: 'class-0' })];
    expect(computePlaybackCapability({ deviceClass: null, screenRecords: [], classRecords: agg, classScreenCount: 4 }))
      .toMatchObject({ evidence: 'measured-class', classScreens: 4 });
    expect(computePlaybackCapability({ deviceClass: null, screenRecords: [], classRecords: agg, classScreenCount: 1 }))
      .toMatchObject({ evidence: 'unknown', classScreens: 0 });
  });

  it('measured on this screen beats everything, and a 2160 proof covers 1080', () => {
    const cap = computePlaybackCapability({ deviceClass: RK, screenRecords: [rec()] });
    expect(cap).toMatchObject({ maxShortEdge: 2160, evidence: 'measured-screen', evidenceAt: '2026-10-11T19:35:00.000Z' });
  });

  it('measured smooth is a floor: a 4K model that only ever played its 1080p copy is still a 4K box', () => {
    const cap = computePlaybackCapability({ deviceClass: GUQ, screenRecords: [rec({ width: 1080, height: 1920 })] });
    expect(cap).toMatchObject({ maxShortEdge: 2160, evidence: 'class-default', stuttersAtShortEdge: null });
    // …and a tie goes to the more authoritative source.
    expect(computePlaybackCapability({ deviceClass: GUQ, screenRecords: [rec()] }).evidence).toBe('measured-screen');
  });

  it('stutters at 4K but smooth on the 1080p copy → 1080, measured here, with the 4K stutter named', () => {
    const cap = computePlaybackCapability({
      deviceClass: GUQ,
      screenRecords: [rec({ verdict: 'stuttering' }), rec({ width: 1080, height: 1920 })],
    });
    expect(cap).toMatchObject({ maxShortEdge: 1080, stuttersAtShortEdge: 2160, evidence: 'measured-screen' });
  });

  it('insufficient / hitching records are not evidence', () => {
    const cap = computePlaybackCapability({ deviceClass: null, screenRecords: [rec({ verdict: 'insufficient' }), rec({ verdict: 'hitching' })] });
    expect(cap.evidence).toBe('unknown');
  });

  it('measured stutter at 4K on this screen caps a declared/default 4K claim to 1080', () => {
    const cap = computePlaybackCapability({ deviceClass: GUQ, screenRecords: [rec({ verdict: 'stuttering' })] });
    expect(cap).toMatchObject({ maxShortEdge: 1080, stuttersAtShortEdge: 2160, evidence: 'measured-screen' });
  });

  it('measured stutter at 1080 leaves no smooth size', () => {
    const cap = computePlaybackCapability({ deviceClass: RK, screenRecords: [rec({ verdict: 'stuttering', width: 1920, height: 1080 })] });
    expect(cap).toMatchObject({ maxShortEdge: null, stuttersAtShortEdge: 1080 });
  });

  it("this screen's own smooth result is not overruled by its model stuttering elsewhere", () => {
    const cap = computePlaybackCapability({
      deviceClass: GUQ,
      screenRecords: [rec()],
      classRecords: [rec({ screenId: 'a', verdict: 'stuttering' }), rec({ screenId: 'b', verdict: 'stuttering' })],
    });
    expect(cap).toMatchObject({ maxShortEdge: 2160, stuttersAtShortEdge: null, evidence: 'measured-screen' });
  });

  it('the model stuttering elsewhere caps a merely declared claim', () => {
    const cap = computePlaybackCapability({
      deviceClass: null,
      screenRecords: [],
      classRecords: [rec({ screenId: 'a', verdict: 'stuttering' }), rec({ screenId: 'b', verdict: 'stuttering' })],
      declared: { configs: [{ id: '2160p30-landscape', supported: true, smooth: true, powerEfficient: true }] },
    });
    expect(cap).toMatchObject({ maxShortEdge: 1080, stuttersAtShortEdge: 2160, evidence: 'measured-class' });
  });

  it('concurrency: a stutter with two videos at once on the unit → 1, measured (DH43)', () => {
    const cap = computePlaybackCapability({
      deviceClass: RK,
      screenRecords: [rec({ verdict: 'stuttering', unitConcurrentMax: 2, width: 1080, height: 1668 })],
    });
    expect(cap).toMatchObject({ maxUnitConcurrentVideos: 1, concurrencyEvidence: 'measured-screen' });
    // A multi-video stutter says nothing about single-video size.
    expect(cap.stuttersAtShortEdge).toBeNull();
    expect(cap).toMatchObject({ maxShortEdge: 1080, evidence: 'class-default' });
  });

  it('concurrency: smooth with two at once proves 2; declared never establishes concurrency', () => {
    const cap = computePlaybackCapability({ deviceClass: null, screenRecords: [rec({ unitConcurrentMax: 2 })] });
    expect(cap).toMatchObject({ maxUnitConcurrentVideos: 2, concurrencyEvidence: 'measured-screen', maxShortEdge: 2160 });
    const declaredOnly = computePlaybackCapability({ deviceClass: null, screenRecords: [], declared: { configs: [{ id: '2160p30-landscape', supported: true, smooth: true, powerEfficient: true }] } });
    expect(declaredOnly).toMatchObject({ maxUnitConcurrentVideos: null, concurrencyEvidence: 'unknown' });
  });

  it('stale evidence (new player or WebView) still decides, and says so', () => {
    const cap = computePlaybackCapability({ deviceClass: null, screenRecords: [rec()], current: { playerVersionCode: 28, webviewMajor: 120 } });
    expect(cap).toMatchObject({ maxShortEdge: 2160, evidence: 'measured-screen', stale: true });
    expect(computePlaybackCapability({ deviceClass: null, screenRecords: [rec()], current: { playerVersionCode: 27, webviewMajor: 120 } }).stale).toBe(false);
  });
});

describe('concurrency math', () => {
  it('per face: template video zones + the playlist video + the hidden next-up', () => {
    expect(faceConcurrentVideos({ videoZones: 0, playlistVideo: true, adjacentVideoItems: false })).toBe(1);
    expect(faceConcurrentVideos({ videoZones: 1, playlistVideo: true, adjacentVideoItems: true })).toBe(3);
    expect(faceConcurrentVideos({ videoZones: 0, playlistVideo: false, adjacentVideoItems: true })).toBe(0);
  });
  it('a MIRROR face carries the primary demand, so a mirrored video is two decodes on the unit', () => {
    const primary = { videoZones: 0, playlistVideo: true, adjacentVideoItems: false };
    expect(unitConcurrentVideos([primary, primary])).toBe(2);
    expect(unitConcurrentVideos([primary, { videoZones: 0, playlistVideo: false, adjacentVideoItems: false }])).toBe(1);
  });
});

const capOf = (over: Partial<PlaybackCapability>): PlaybackCapability => ({
  deviceClass: null,
  maxShortEdge: null,
  stuttersAtShortEdge: null,
  maxFps: null,
  maxUnitConcurrentVideos: null,
  evidence: 'unknown',
  concurrencyEvidence: 'unknown',
  evidenceAt: null,
  classScreens: 0,
  stale: false,
  ...over,
});
const demand = (over: Partial<PlaybackDemand> = {}): PlaybackDemand => ({
  shortEdge: 2160,
  longEdge: 3840,
  fps: 30,
  panelShortEdge: 2160,
  unitConcurrentVideos: 1,
  ...over,
});

describe('decidePlayback (pure; not wired to any publish path yet)', () => {
  it('GUQ 4K panel, 4K file → native', () => {
    expect(decidePlayback(capOf({ maxShortEdge: 2160, maxFps: 30, maxUnitConcurrentVideos: 1 }), demand(), { has1080p: true })).toEqual({ kind: 'play-native' });
  });
  it('1080-capable screen, 4K file → 1080p copy (queued when missing)', () => {
    const cap = capOf({ maxShortEdge: 1080, maxFps: 30 });
    expect(decidePlayback(cap, demand(), { has1080p: true })).toEqual({ kind: 'play-1080p', needsCopy: false });
    expect(decidePlayback(cap, demand(), { has1080p: false })).toEqual({ kind: 'play-1080p', needsCopy: true });
    expect(decidePlayback(cap, demand({ shortEdge: 1080, longEdge: 1920 }), { has1080p: false })).toEqual({ kind: 'play-native' });
  });
  it('DH43: two videos on a one-video unit → cannot play (concurrency), a lighter copy is not offered', () => {
    const d = decidePlayback(capOf({ maxShortEdge: 1080, maxUnitConcurrentVideos: 1 }), demand({ shortEdge: 1080, unitConcurrentVideos: 2 }), { has1080p: true });
    expect(d).toEqual({ kind: 'cannot-play', reason: 'concurrency', detail: { max: 1, demand: 2 } });
  });
  it('measured stutter at 4K → lighter copy; at 1080 → cannot play (measured)', () => {
    expect(decidePlayback(capOf({ maxShortEdge: 1080, stuttersAtShortEdge: 2160 }), demand(), { has1080p: true })).toEqual({ kind: 'play-1080p', needsCopy: false });
    expect(decidePlayback(capOf({ stuttersAtShortEdge: 1080 }), demand({ shortEdge: 1080 }), { has1080p: true }))
      .toEqual({ kind: 'cannot-play', reason: 'measured-stutter', detail: { demand: 1080 } });
  });
  it('over the frame-rate capability', () => {
    expect(decidePlayback(capOf({ maxShortEdge: 2160, maxFps: 30 }), demand({ fps: 60 }), { has1080p: false }).kind).toBe('cannot-play');
  });
  it('unknown NEVER blocks: ≤ 1080 panel follows today\'s 1080p rule, anything else is unverified', () => {
    const unknown = capOf({});
    expect(decidePlayback(unknown, demand({ panelShortEdge: 1080 }), { has1080p: true })).toEqual({ kind: 'play-1080p', needsCopy: false });
    expect(decidePlayback(unknown, demand(), { has1080p: true })).toEqual({ kind: 'unverified' });
    expect(decidePlayback(unknown, demand({ unitConcurrentVideos: 4 }), { has1080p: true })).toEqual({ kind: 'unverified' });
  });
});

describe('summarizeScreenPlayback', () => {
  it.each([
    [[], 'unknown'],
    [['insufficient'], 'unknown'],
    [['smooth', 'insufficient'], 'smooth'],
    [['smooth', 'hitching'], 'hitches'],
    [['smooth', 'stuttering', 'hitching'], 'stutters'],
  ] as const)('%j → %s', (v, out) => expect(summarizeScreenPlayback(v)).toBe(out));
});
