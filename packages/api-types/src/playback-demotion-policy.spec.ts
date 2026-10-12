/**
 * Video guarantee steps 5–8 (2026-10-12) — the pure policy: the visible-stutter
 * rule, the demotion decision and the publish-gate reading. Owner decisions
 * A/B/C and the 2026-10-12 threshold rule are pinned here at their boundaries.
 */
import {
  VISIBLE_STUTTER_DEFAULTS,
  classifyVisibleStutterSample,
  decideStutterAction,
  gateFinding,
  nextVisibleBadStreak,
  playbackDemotionMode,
  playbackGateMode,
  visibleStutterThresholds,
  type PlaybackSampleInput,
  type StutterActionInput,
} from './playback-capability';

const sample = (over: Partial<PlaybackSampleInput> = {}): PlaybackSampleInput => ({
  totalFrames: 1800,
  droppedFrames: 0,
  stalls: 0,
  stalledMs: 0,
  cached: true,
  first: false,
  concurrent: 1,
  ...over,
});

describe('visibleStutterThresholds', () => {
  it('defaults: 5 % dropped or a 250 ms freeze, 3 in a row', () => {
    expect(visibleStutterThresholds({})).toEqual({ badPct: 5, stallMs: 250, streak: 3 });
    expect(VISIBLE_STUTTER_DEFAULTS).toEqual({ badPct: 5, stallMs: 250, streak: 3 });
  });
  it('env-tunable within safe bounds; junk and out-of-range keep the default', () => {
    expect(visibleStutterThresholds({ VIDEO_DEMOTION_BAD_PCT: '8', VIDEO_DEMOTION_STALL_MS: '500', VIDEO_DEMOTION_STREAK: '5' }))
      .toEqual({ badPct: 8, stallMs: 500, streak: 5 });
    expect(visibleStutterThresholds({ VIDEO_DEMOTION_BAD_PCT: 'abc', VIDEO_DEMOTION_STALL_MS: '5', VIDEO_DEMOTION_STREAK: '1' }))
      .toEqual({ badPct: 5, stallMs: 250, streak: 3 });
    expect(visibleStutterThresholds({ VIDEO_DEMOTION_BAD_PCT: '0.1' }).badPct).toBe(5);
  });
});

describe('classifyVisibleStutterSample (only what a viewer would see)', () => {
  it('4.9 % dropped is GOOD, 5.0 % is BAD (unrounded)', () => {
    expect(classifyVisibleStutterSample(sample({ totalFrames: 2000, droppedFrames: 98 }))).toBe('good');
    expect(classifyVisibleStutterSample(sample({ totalFrames: 1800, droppedFrames: 89 }))).toBe('good'); // 4.94 %
    expect(classifyVisibleStutterSample(sample({ totalFrames: 2000, droppedFrames: 100 }))).toBe('bad');
  });
  it('healthy 4K fleet numbers (0–0.7 %) are GOOD; the two-sided rk3288 numbers (38–55 %) are BAD', () => {
    expect(classifyVisibleStutterSample(sample({ droppedFrames: 12 }))).toBe('good'); // 0.66 %
    expect(classifyVisibleStutterSample(sample({ totalFrames: 1800, droppedFrames: 980 }))).toBe('bad');
  });
  it('a freeze of 250 ms is BAD, 249 ms is not', () => {
    expect(classifyVisibleStutterSample(sample({ stalls: 1, stalledMs: 249 }))).toBe('good');
    expect(classifyVisibleStutterSample(sample({ stalls: 1, stalledMs: 250 }))).toBe('bad');
    // waiting time with no stall behind it is incoherent and ignored
    expect(classifyVisibleStutterSample(sample({ stalls: 0, stalledMs: 9000 }))).toBe('good');
  });
  it('startup, short, uncached and unknown-cache samples are IGNORED', () => {
    expect(classifyVisibleStutterSample(sample({ first: true, droppedFrames: 900 }))).toBe('ignored');
    expect(classifyVisibleStutterSample(sample({ totalFrames: 1499, droppedFrames: 900 }))).toBe('ignored');
    expect(classifyVisibleStutterSample(sample({ cached: false, droppedFrames: 900 }))).toBe('ignored');
    expect(classifyVisibleStutterSample(sample({ cached: null, droppedFrames: 900 }))).toBe('ignored');
    expect(classifyVisibleStutterSample(sample({ cached: undefined, droppedFrames: 900 }))).toBe('ignored');
  });
  it('honours tuned thresholds', () => {
    const th = { badPct: 10, stallMs: 1000, streak: 3 };
    expect(classifyVisibleStutterSample(sample({ droppedFrames: 120 }), th)).toBe('good'); // 6.7 %
    expect(classifyVisibleStutterSample(sample({ droppedFrames: 180 }), th)).toBe('bad');
  });
});

describe('nextVisibleBadStreak', () => {
  it('BAD extends, GOOD resets, ignored leaves it', () => {
    expect(nextVisibleBadStreak(0, 'bad')).toBe(1);
    expect(nextVisibleBadStreak(2, 'bad')).toBe(3);
    expect(nextVisibleBadStreak(2, 'good')).toBe(0);
    expect(nextVisibleBadStreak(2, 'ignored')).toBe(2);
    expect(nextVisibleBadStreak(NaN, 'bad')).toBe(1);
  });
  it('bad, bad, good, bad, bad never reaches 3; bad ×3 does', () => {
    const run = (seq: Array<'bad' | 'good' | 'ignored'>) => seq.reduce((s, c) => nextVisibleBadStreak(s, c), 0);
    expect(run(['bad', 'bad', 'good', 'bad', 'bad'])).toBe(2);
    expect(run(['bad', 'ignored', 'bad', 'ignored', 'bad'])).toBe(3);
  });
});

describe('modes', () => {
  it('VIDEO_PLAYBACK_DEMOTION defaults ON', () => {
    expect(playbackDemotionMode({})).toBe('on');
    expect(playbackDemotionMode({ VIDEO_PLAYBACK_DEMOTION: 'typo' })).toBe('on');
    expect(playbackDemotionMode({ VIDEO_PLAYBACK_DEMOTION: 'OFF' })).toBe('off');
    expect(playbackDemotionMode({ VIDEO_PLAYBACK_DEMOTION: '0' })).toBe('off');
    expect(playbackDemotionMode({ VIDEO_PLAYBACK_DEMOTION: 'observe' })).toBe('observe');
  });
  it('VIDEO_PLAYBACK_GATE defaults warn; only the exact word enforces', () => {
    expect(playbackGateMode({})).toBe('warn');
    expect(playbackGateMode({ VIDEO_PLAYBACK_GATE: 'enforced' })).toBe('warn');
    expect(playbackGateMode({ VIDEO_PLAYBACK_GATE: 'enforce' })).toBe('enforce');
    expect(playbackGateMode({ VIDEO_PLAYBACK_GATE: 'off' })).toBe('off');
  });
});

describe('decideStutterAction (owner decisions A/B/C)', () => {
  const base: StutterActionInput = {
    streak: 3, threshold: 3, mode: 'on', emergency: false, twoSided: false,
    unitConcurrent: 1, served: 'original', hasLighterCopy: true, alreadyDemoted: false,
  };
  it('2 BAD samples never demote; 3 do (A)', () => {
    expect(decideStutterAction({ ...base, streak: 2 })).toEqual({ kind: 'none', why: 'below-threshold' });
    expect(decideStutterAction(base)).toEqual({ kind: 'demote' });
  });
  it('emergency content is never touched, even before anything else', () => {
    expect(decideStutterAction({ ...base, emergency: true, twoSided: true })).toEqual({ kind: 'none', why: 'emergency' });
  });
  it('a two-sided unit is recorded, never demoted (B)', () => {
    expect(decideStutterAction({ ...base, twoSided: true })).toEqual({ kind: 'record-two-sided' });
  });
  it('several videos at once → alert, no demotion (a lighter copy does not fix concurrency)', () => {
    expect(decideStutterAction({ ...base, unitConcurrent: 2 })).toEqual({ kind: 'alert', reason: 'concurrency' });
  });
  it('no lighter copy, or already on the 1080p copy → keep playing + alert (C)', () => {
    expect(decideStutterAction({ ...base, hasLighterCopy: false })).toEqual({ kind: 'alert', reason: 'no-lighter-copy' });
    expect(decideStutterAction({ ...base, served: '1080p' })).toEqual({ kind: 'alert', reason: 'already-lighter' });
    expect(decideStutterAction({ ...base, served: 'unknown' })).toEqual({ kind: 'alert', reason: 'no-lighter-copy' });
  });
  it('sticky: an active demotion is not repeated; observe and off never demote', () => {
    expect(decideStutterAction({ ...base, alreadyDemoted: true })).toEqual({ kind: 'none', why: 'already-demoted' });
    expect(decideStutterAction({ ...base, mode: 'observe' })).toEqual({ kind: 'observe' });
    expect(decideStutterAction({ ...base, mode: 'off' })).toEqual({ kind: 'none', why: 'demotion-off' });
  });
});

describe('gateFinding', () => {
  const ctx = { panelShortEdge: 2160, twoSided: false, demoted: false, has1080p: true };
  it('unknown / native never warn', () => {
    expect(gateFinding({ kind: 'unverified' }, ctx)).toEqual({ kind: 'ok' });
    expect(gateFinding({ kind: 'play-native' }, ctx)).toEqual({ kind: 'ok' });
  });
  it('1080p on a 1080p panel is today\'s rule; on a 4K panel it is a warning unless already demoted', () => {
    expect(gateFinding({ kind: 'play-1080p', needsCopy: false }, { ...ctx, panelShortEdge: 1080 })).toEqual({ kind: 'ok' });
    expect(gateFinding({ kind: 'play-1080p', needsCopy: false }, ctx)).toEqual({ kind: 'may-stutter', hasLighterCopy: true });
    expect(gateFinding({ kind: 'play-1080p', needsCopy: false }, { ...ctx, demoted: true })).toEqual({ kind: 'ok' });
  });
  it('cannot-play carries the reason and whether the unit is two-sided', () => {
    expect(gateFinding({ kind: 'cannot-play', reason: 'concurrency', detail: { max: 1, demand: 2 } }, { ...ctx, twoSided: true }))
      .toEqual({ kind: 'cannot-play', reason: 'concurrency', twoSided: true, detail: { max: 1, demand: 2 } });
  });
});
