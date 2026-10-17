/**
 * Samples that are recorded but never graded (2026-10-17, player rock-solid
 * program §4B). A sample inside the three minutes after a page load, an engine
 * change, a hand-off or a player update — or one the browser played while the
 * screen should be on its hardware engine — must never move a verdict or the
 * visible-stutter streak. The M43 shape from 2026-10-17 is pinned verbatim.
 */
import {
  EMPTY_FILE_PLAYBACK,
  PLAYBACK_SAMPLE_EXCLUSION_WINDOW_MS,
  asPlaybackSampleExclusion,
  foldPlaybackSample,
  playbackSampleExclusion,
  type SampleExclusionInput,
} from './playback-capability';

const NOW = Date.UTC(2026, 9, 17, 9, 2, 4, 329);
const MIN = 60_000;
const W = PLAYBACK_SAMPLE_EXCLUSION_WINDOW_MS;

const input = (over: Partial<SampleExclusionInput> = {}): SampleExclusionInput => ({
  nowMs: NOW,
  elapsedMs: 60_000,
  first: false,
  engine: 'continuous',
  playerVersionCode: 10140,
  pageLoadAtMs: NOW - 2 * 60 * MIN,
  previous: { engine: 'continuous', playerVersionCode: 10140, excludedUntilMs: null, excludedReason: null },
  nativeSessionChanged: false,
  expectedEngine: 'web',
  ...over,
});

describe('playbackSampleExclusion', () => {
  it('a settled minute long after every event grades as before', () => {
    expect(playbackSampleExclusion(input())).toEqual({ reason: null, windowUntilMs: null });
  });

  it('M43, 2026-10-17 09:02: the nightly reload at 09:01:02 makes its 11.6 % minute a page-load sample', () => {
    const v = playbackSampleExclusion(input({
      pageLoadAtMs: Date.UTC(2026, 9, 17, 9, 1, 2, 962),
      elapsedMs: 60_377,
      first: false,
    }));
    expect(v.reason).toBe('page-load');
  });

  it('page load: a sample that started inside the three minutes is excluded, one that started after is not', () => {
    const load = NOW - 3.5 * MIN; // the sample began at NOW − 1 min = load + 2.5 min
    expect(playbackSampleExclusion(input({ pageLoadAtMs: load })).reason).toBe('page-load');
    const older = NOW - 4.5 * MIN; // began at load + 3.5 min
    expect(playbackSampleExclusion(input({ pageLoadAtMs: older })).reason).toBeNull();
    // A rotation stamped after the sample ended cannot be its cause.
    expect(playbackSampleExclusion(input({ pageLoadAtMs: NOW + 1_000 })).reason).toBeNull();
  });

  it('engine change opens a window from the new engine\'s first stretch that later samples inherit', () => {
    const v = playbackSampleExclusion(input({ engine: 'native', previous: { engine: 'continuous', playerVersionCode: 10140 } }));
    expect(v.reason).toBe('engine-change');
    expect(v.windowUntilMs).toBe(NOW - 60_000 + W);
    // The next minute: same engine now, but inside the window it opened.
    const next = playbackSampleExclusion(input({
      nowMs: NOW + MIN,
      engine: 'native',
      previous: { engine: 'native', playerVersionCode: 10140, excludedUntilMs: v.windowUntilMs, excludedReason: v.reason },
    }));
    expect(next.reason).toBe('engine-change');
    // Three minutes on, the window has closed and the sample grades.
    const later = playbackSampleExclusion(input({
      nowMs: NOW + 3 * MIN,
      engine: 'native',
      previous: { engine: 'native', playerVersionCode: 10140, excludedUntilMs: v.windowUntilMs, excludedReason: 'engine-change' },
    }));
    expect(later).toEqual({ reason: null, windowUntilMs: null });
  });

  it('a first-on-glass sample is a hand-off, and so is a changed native session', () => {
    expect(playbackSampleExclusion(input({ first: true })).reason).toBe('handoff');
    const s = playbackSampleExclusion(input({ nativeSessionChanged: true }));
    expect(s.reason).toBe('handoff');
    expect(s.windowUntilMs).toBe(NOW + W);
  });

  it('a version change between two samples of the file is a player update', () => {
    const v = playbackSampleExclusion(input({ playerVersionCode: 10141, previous: { engine: 'continuous', playerVersionCode: 10140 } }));
    expect(v.reason).toBe('player-update');
    expect(v.windowUntilMs).toBe(NOW + W);
    // Unknown on either side is not a change.
    expect(playbackSampleExclusion(input({ playerVersionCode: null })).reason).toBeNull();
    expect(playbackSampleExclusion(input({ previous: { engine: 'continuous', playerVersionCode: null } })).reason).toBeNull();
  });

  it('the first sample of a file has nothing to compare against', () => {
    expect(playbackSampleExclusion(input({ previous: null })).reason).toBeNull();
  });

  it('a browser sample on a screen the manifest hands the hardware engine is never evidence', () => {
    expect(playbackSampleExclusion(input({ expectedEngine: 'native' }))).toEqual({ reason: 'fallback-engine', windowUntilMs: null });
  });

  it('names the most specific cause when several apply, and keeps the longest window', () => {
    const v = playbackSampleExclusion(input({
      playerVersionCode: 10141,
      pageLoadAtMs: NOW - 30_000,
      first: true,
      engine: 'native',
      expectedEngine: 'native',
    }));
    expect(v.reason).toBe('player-update');
    expect(v.windowUntilMs).toBe(NOW + W);
    expect(playbackSampleExclusion(input({ pageLoadAtMs: NOW - 30_000, first: true })).reason).toBe('page-load');
  });

  it('a garbage stored reason still excludes inside its window, labelled as a hand-off', () => {
    const v = playbackSampleExclusion(input({
      previous: { engine: 'continuous', playerVersionCode: 10140, excludedUntilMs: NOW + MIN, excludedReason: 'bogus' },
    }));
    expect(v).toEqual({ reason: 'handoff', windowUntilMs: NOW + MIN });
    expect(asPlaybackSampleExclusion('bogus')).toBeNull();
    expect(asPlaybackSampleExclusion('page-load')).toBe('page-load');
  });

  it('an absurd elapsed time cannot reach back past ten minutes', () => {
    const load = NOW - 13 * MIN - 1;
    expect(playbackSampleExclusion(input({ pageLoadAtMs: load, elapsedMs: 86_400_000 })).reason).toBeNull();
  });
});

describe('foldPlaybackSample with an excluded sample', () => {
  it('counts it and shows it as the latest, but never as decode evidence', () => {
    const bad = { totalFrames: 1580, droppedFrames: 184, cached: true, first: false, stalls: 0, stalledMs: 0, engine: 'native' };
    const graded = foldPlaybackSample(EMPTY_FILE_PLAYBACK, bad);
    expect(graded.settledSamples).toBe(1);
    expect(graded.consecutiveBad).toBe(1);
    const kept = foldPlaybackSample(EMPTY_FILE_PLAYBACK, bad, { excluded: true });
    expect(kept).toMatchObject({
      samples: 1,
      settledSamples: 0,
      frames: 0,
      dropped: 0,
      consecutiveBad: 0,
      worstPct: null,
      lastPct: 11.6,
      lastSettled: false,
      engine: 'native',
      verdict: 'insufficient',
    });
  });
});
