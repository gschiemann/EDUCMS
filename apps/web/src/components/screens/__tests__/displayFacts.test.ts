/**
 * displayFacts — the Overview's "Panel and playback pacing" facts, as the
 * native report states them (2026-10-18, player 1.1.42 field candidate).
 *
 * Every fixture is made up. The first block is shaped like the first real
 * reading from a 4K panel whose only display mode is 30 Hz.
 */
import en from '../../../i18n/messages/en.json';
import es from '../../../i18n/messages/es.json';
import zh from '../../../i18n/messages/zh.json';
import { createTestTranslator } from '../../../../test-mocks/next-intl';
import {
  EXPERIMENT_ORDER,
  GUARD_REASONS,
  PREFERRED_MODE_RESULTS,
  SURFACE_FRAME_RATE_CODES,
  VSYNC_LOCK_SAMPLES,
  buildDisplayView,
  cadenceShare,
  formatPercent,
  groupModes,
  parseMode,
  readDisplayFacts,
  relativeAgo,
  renderMessage,
  renderParts,
  sixtyHzAvailability,
  type DisplayFacts,
  type DisplayMode,
  type Msg,
  type Translate,
} from '../displayFacts';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const TWO_MIN_AGO = new Date(NOW - 120_000).toISOString();
const t = createTestTranslator('screens.displayFacts') as unknown as Translate;

// ── fixtures ─────────────────────────────────────────────────────────

/** Sixteen interval buckets with `onCadence` in bucket 4 (the source period) and the rest where `rest` says. */
const buckets = (onCadence: number, rest: Record<number, number> = {}): number[] => {
  const b = new Array<number>(16).fill(0);
  b[4] = onCadence;
  for (const [k, v] of Object.entries(rest)) b[Number(k)] = v;
  return b;
};

/** The nine scheduling counters every native APK sends, plus the 1.1.41/1.1.42 measurement. */
const timing = (over: Record<string, unknown> = {}) => ({
  decodedFrames: 41_210, submittedFrames: 41_203, lateFrames: 143, lastLateUs: 120, maxLateUs: 4_100,
  maxSubmitGapMs: 96, leadUs: 66_666, sourceWidth: 3840, sourceHeight: 2160,
  droppedFrames: 0, sourceFps: 30, refreshRate: 30, displayMode: '1:3840x2160@30.00',
  intervalUnitNs: 8_333_333, intervalBuckets: buckets(41_191, { 2: 4, 5: 5, 8: 3 }), intervalCount: 41_203,
  supportedModes: ['1:3840x2160@30.00'],
  keepScreenOn: false,
  ...over,
});

/** Only what an APK before 1.1.41 sent. */
const nineCounters = () => ({
  decodedFrames: 900, submittedFrames: 880, lateFrames: 143, lastLateUs: 0, maxLateUs: 4_100,
  maxSubmitGapMs: 96, leadUs: 66_666, sourceWidth: 1920, sourceHeight: 1080,
});

/** The 1.1.42 vsync-snap measurement of a snapping session. */
const snapping = { vsyncSamples: 1_204, snappedFrames: 41_000, snapErrorMeanUs: 9, snapErrorMaxUs: 120, vsyncPeriodUs: 16_666, clockSlewUs: -3_200 };

const device = (over: Record<string, unknown> = {}) => ({
  class: 'amlogic/android-13', soc: 'amlogic', sdk: 33, webviewMajor: 120, nativeSolo: true, protocol3: false,
  silentUpdate: 'tap', refreshRate: 30, activeMode: '1:3840x2160@30.00', supportedModes: ['1:3840x2160@30.00'],
  ...over,
});

const experiments = (
  requested: Record<string, true> = {},
  applied: Record<string, unknown> = {},
  disabled: Record<string, string> = {},
) => ({
  requested,
  applied: { webviewInvisible: false, ...applied },
  guard: { disabled, applied: {} },
});

/** A `Screen.lastVideoReport`: the HTML sample the API keeps beside `native`. */
const report = (native: Record<string, unknown>) => ({
  url: 'https://example.test/media/clip.mp4',
  totalFrames: 1830,
  droppedFrames: 12,
  native: { version: 1, state: 'presenting', at: TWO_MIN_AGO, evidence: 'surface-render-callback', ...native },
});

const facts = (native: Record<string, unknown>, locale = 'en'): DisplayFacts | null =>
  readDisplayFacts(report(native), { nowMs: NOW, locale });

const rowLines = (f: DisplayFacts | null, id: string): string[] =>
  f?.rows.find((r) => r.id === id)?.lines.map((l) => renderParts(t, l.parts)) ?? [];

const experimentLines = (native: Record<string, unknown>): string[] => rowLines(facts(native), 'experiments');

// ── the field reading ────────────────────────────────────────────────

describe('the 4K / 30 Hz reading, shaped like the first real report', () => {
  const f = facts({
    timing: timing({ ...snapping }),
    device: device(),
    experiments: experiments(
      { vsyncSnap: true, webviewInvisible: true, prefer60hz: true },
      { vsyncSnap: true, webviewInvisible: true, prefer60hz: 'no-60hz-mode' },
    ),
  });

  it('titles itself and says where the facts are from and how old they are', () => {
    expect(renderMessage(t, f!.title)).toBe('Panel and playback pacing');
    expect(renderMessage(t, f!.provenance)).toBe('From the player’s last native video report, 2 minutes ago.');
    expect(f!.session).toBeNull();
  });

  it('the panel row: the active mode, no 60 Hz mode offered (not "cannot"), the modes it lists', () => {
    expect(rowLines(f, 'panel')).toEqual([
      '3840×2160 at 30 Hz',
      'No 60 Hz mode offered at 3840×2160.',
      'Modes offered: 3840×2160 at 30 Hz',
    ]);
    expect(JSON.stringify(rowLines(f, 'panel'))).not.toMatch(/cannot|can’t|unable/i);
  });

  it('the cadence row: share on cadence, late, dropped, max gap — and what each number is', () => {
    expect(rowLines(f, 'cadence')).toEqual([
      '99.97 % on cadence · 143 late · 0 dropped · max gap 96 ms',
      'Share of 41,203 intervals between render callbacks in this video session that fell within ±4 ms of the 33.3 ms source frame period.',
      'Late: released to the display after its due time. Dropped: skipped for being more than one frame late.',
    ]);
  });

  it('the experiments row: each experiment in plain words', () => {
    expect(rowLines(f, 'experiments')).toEqual([
      'Vsync snap: on, locked to a 16.67 ms vsync grid (error 9 µs mean, 120 µs max)',
      '60 Hz mode: requested, no 60 Hz mode offered',
      'WebView hidden: requested, applied',
    ]);
  });

  it('keep-screen-on: said as of the last report, in both directions', () => {
    expect(rowLines(f, 'keepScreenOn')).toEqual(['The player window did not hold keep-screen-on at the last report.']);
    expect(rowLines(facts({ timing: timing({ keepScreenOn: true }) }), 'keepScreenOn'))
      .toEqual(['The player window held keep-screen-on at the last report.']);
  });

  it('rows come in a fixed order', () => {
    expect(f!.rows.map((r) => r.id)).toEqual(['panel', 'cadence', 'experiments', 'keepScreenOn']);
  });
});

// ── the guarded view the component prints ────────────────────────────

describe('buildDisplayView — everything the card prints, as plain strings, in one guarded step', () => {
  const FIELD = { timing: timing({ ...snapping }), device: device(), experiments: experiments({ vsyncSnap: true }, { vsyncSnap: true }) };

  it('is the same words as the view model, resolved', () => {
    const view = buildDisplayView(report(FIELD), { nowMs: NOW, locale: 'en' }, t)!;
    expect(view.title).toBe('Panel and playback pacing');
    expect(view.provenance).toBe('From the player’s last native video report, 2 minutes ago.');
    expect(view.session).toBeNull();
    expect(view.rows.map((r) => r.id)).toEqual(['panel', 'cadence', 'experiments', 'keepScreenOn']);
    expect(view.rows[1].lines[0]).toEqual({
      tone: 'strong',
      parts: ['99.97 % on cadence', '143 late', '0 dropped', 'max gap 96 ms'],
    });
    expect(view.rows[2].lines[0].parts).toEqual(['Vsync snap: on, locked to a 16.67 ms vsync grid (error 9 µs mean, 120 µs max)']);
  });

  it('is null when there is nothing to show', () => {
    expect(buildDisplayView(undefined, { nowMs: NOW }, t)).toBeNull();
    expect(buildDisplayView({ native: {} }, { nowMs: NOW }, t)).toBeNull();
  });

  it('never throws: a report that blows up when read, or a translator that does, makes the card vanish', () => {
    const hostile = { get native(): never { throw new Error('boom'); } };
    expect(() => buildDisplayView(hostile, { nowMs: NOW }, t)).not.toThrow();
    expect(buildDisplayView(hostile, { nowMs: NOW }, t)).toBeNull();
    const brokenCatalogue: Translate = () => { throw new Error('missing message'); };
    expect(() => buildDisplayView(report(FIELD), { nowMs: NOW }, brokenCatalogue)).not.toThrow();
    expect(buildDisplayView(report(FIELD), { nowMs: NOW }, brokenCatalogue)).toBeNull();
  });

  it('the readers themselves survive garbage in every field (the guard is the last line of defence, not the first)', () => {
    // Asserted on the UNGUARDED path: a try/catch must not be what makes this pass.
    const junk = [null, undefined, 0, -1, NaN, Infinity, '', 'x', [], {}, [1, 2, 3], { a: { b: { c: 1 } } }, () => 1, Symbol('s')];
    for (const j of junk) {
      for (const key of ['timing', 'device', 'experiments', 'state', 'reason', 'at', 'drops', 'faceIndex']) {
        expect(() => readDisplayFacts(report({ ...FIELD, [key]: j }), { nowMs: NOW })).not.toThrow();
      }
      expect(() => readDisplayFacts(report({ timing: timing({ history: j }) }), { nowMs: NOW })).not.toThrow();
      expect(() => readDisplayFacts(report({ timing: timing({ history: { entries: [j, entry0(j)], overflow: j } }) }), { nowMs: NOW })).not.toThrow();
      for (const field of ['intervalBuckets', 'intervalUnitNs', 'sourceFps', 'supportedModes', 'displayMode', 'refreshRate', 'keepScreenOn', 'vsyncSamples', 'snapErrorMeanUs', 'preferredModeResult', 'lateFrames']) {
        expect(() => readDisplayFacts(report({ timing: timing({ [field]: j }), device: device({ activeMode: j, supportedModes: j, refreshRate: j }) }), { nowMs: NOW })).not.toThrow();
      }
    }
  });
});

/** A history entry with one hostile field. */
const entry0 = (v: unknown) => ({ at: v, face: v, elapsedMs: v, fps: v, vsyncSnap: v, prefer60hz: v, intervalUnitNs: v, intervalBuckets: v });

// ── absent data ──────────────────────────────────────────────────────

describe('absent data: no report, no section', () => {
  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'native'],
    ['a number', 42],
    ['an array', []],
    ['an empty object', {}],
    ['native: null', { native: null }],
    ['native: an array', { native: [] }],
    ['native: a string', { native: 'x' }],
    ['native: {}', { native: {} }],
    ['an HTML-only sample', { url: 'https://example.test/a.mp4', totalFrames: 1830, droppedFrames: 12, stalls: 0 }],
    ['native with state and age only', { native: { version: 1, state: 'presenting', at: TWO_MIN_AGO } }],
    ['native with unreadable timing', { native: { timing: { decodedFrames: 'lots' }, device: 'x', experiments: 5 } }],
  ])('%s → null', (_name, value) => {
    expect(readDisplayFacts(value, { nowMs: NOW })).toBeNull();
  });

  it('an experiments block with nothing requested and nothing to explain adds nothing', () => {
    expect(facts({ experiments: experiments() })).toBeNull();
    expect(facts({ timing: nineCounters(), experiments: experiments() })!.rows.map((r) => r.id)).toEqual(['cadence']);
  });

  it('an older player (the nine counters only) earns the late / gap figures and nothing it cannot support', () => {
    const f = facts({ timing: nineCounters() });
    expect(f!.rows.map((r) => r.id)).toEqual(['cadence']);
    expect(rowLines(f, 'cadence')[0]).toBe('143 late · max gap 96 ms');
    // No histogram → no "on cadence" claim, no basis sentence, no dropped figure.
    expect(JSON.stringify(rowLines(f, 'cadence'))).not.toMatch(/on cadence|Share of|dropped \d|\d+ dropped/);
  });

  it('a protocol-3 native `drops` fills in for an APK that sent no droppedFrames', () => {
    expect(rowLines(facts({ timing: nineCounters(), drops: 7 }), 'cadence')[0]).toBe('143 late · 7 dropped · max gap 96 ms');
  });

  it('an empty histogram makes no cadence claim but keeps the counters', () => {
    const f = facts({ timing: timing({ intervalBuckets: buckets(0) }) });
    expect(rowLines(f, 'cadence')[0]).toBe('143 late · 0 dropped · max gap 96 ms');
    expect(rowLines(f, 'cadence').join(' ')).not.toContain('on cadence');
  });

  it('a field the report lacks is simply not a row: no panel facts → no panel row', () => {
    expect(facts({ timing: nineCounters() })!.rows.map((r) => r.id)).toEqual(['cadence']);
  });

  it('keep-screen-on absent (the APK could not read the window) is no row, never "off"', () => {
    const f = facts({ timing: timing({ keepScreenOn: undefined }) });
    expect(f!.rows.map((r) => r.id)).not.toContain('keepScreenOn');
  });

  it('an unreadable stamp drops the age, not the section', () => {
    const f = facts({ at: 'yesterday-ish', timing: timing() });
    expect(renderMessage(t, f!.provenance)).toBe('From the player’s last native video report.');
  });
});

// ── session state ────────────────────────────────────────────────────

describe('the native session at that report', () => {
  const state = (native: Record<string, unknown>) => {
    const f = facts({ timing: timing(), ...native });
    return f!.session ? renderMessage(t, f!.session) : null;
  };
  it('presenting says nothing extra', () => expect(state({ state: 'presenting' })).toBeNull());
  it('preparing', () => expect(state({ state: 'preparing' })).toBe('The native video session was still preparing at that report.'));
  it('ready', () => expect(state({ state: 'ready' })).toBe('The native video session was ready but not yet presenting at that report.'));
  it('stopped, with its reason code', () =>
    expect(state({ state: 'failed', reason: 'output-stalled' })).toBe('The native video session had stopped at that report (output-stalled).'));
  it('stopped, with no reason', () => expect(state({ state: 'failed' })).toBe('The native video session had stopped at that report.'));
  it('a reason that is not a code is not shown', () =>
    expect(state({ state: 'failed', reason: '<script>alert(1)</script>' })).toBe('The native video session had stopped at that report.'));
});

// ── cadence ──────────────────────────────────────────────────────────

describe('cadenceShare', () => {
  const base = { intervalUnitNs: 8_333_333, sourceFps: 30 };

  it('is the share of intervals in bucket 4 — 99.97 % of 41,203', () => {
    expect(cadenceShare({ ...base, intervalBuckets: buckets(41_191, { 2: 4, 5: 5, 8: 3 }) })).toEqual({
      percent: 99.97,
      onCadence: 41_191,
      total: 41_203,
      toleranceMs: 4,
      periodMs: (8_333_333 * 4) / 1e6,
    });
  });

  it('truncates, never rounds a miss up: 99,999 of 100,000 is 99.99, and only a perfect run is 100', () => {
    expect(cadenceShare({ ...base, intervalBuckets: buckets(99_999, { 5: 1 }) })!.percent).toBe(99.99);
    expect(cadenceShare({ ...base, intervalBuckets: buckets(100_000) })!.percent).toBe(100);
    expect(formatPercent(99.99, 'en')).toBe('99.99');
    expect(formatPercent(100, 'en')).toBe('100');
    expect(formatPercent(99.9, 'en')).toBe('99.90');
  });

  it('is exact integer arithmetic: 9,997 of 10,000 is 99.97 (a float quotient lands on 99.96…)', () => {
    expect(cadenceShare({ ...base, intervalBuckets: buckets(9_997, { 6: 3 }) })!.percent).toBe(99.97);
    expect(cadenceShare({ ...base, intervalBuckets: buckets(1, { 6: 2 }) })!.percent).toBe(33.33);
    expect(cadenceShare({ ...base, intervalBuckets: buckets(2, { 6: 1 }) })!.percent).toBe(66.66);
  });

  it('a session that never sat on cadence is 0, not absent', () => {
    expect(cadenceShare({ ...base, intervalBuckets: buckets(0, { 2: 10 }) })!.percent).toBe(0);
  });

  it('the tolerance and period follow the clip: 60 fps ±2 ms of 16.7 ms, 24 fps ±5 ms of 41.7 ms', () => {
    const at60 = cadenceShare({ intervalUnitNs: 4_166_666, sourceFps: 60, intervalBuckets: buckets(10) })!;
    expect(at60.toleranceMs).toBe(2);
    expect(at60.periodMs).toBeCloseTo(16.67, 2);
    const at24 = cadenceShare({ intervalUnitNs: 10_416_666, sourceFps: 24, intervalBuckets: buckets(10) })!;
    expect(at24.toleranceMs).toBe(5);
    expect(at24.periodMs).toBeCloseTo(41.67, 2);
  });

  it('the unit alone, or the fps alone, is enough to name the period', () => {
    expect(cadenceShare({ intervalUnitNs: 8_333_333, intervalBuckets: buckets(10) })!.toleranceMs).toBe(4);
    expect(cadenceShare({ sourceFps: 30, intervalBuckets: buckets(10) })!.toleranceMs).toBe(4);
  });

  it('refuses to claim when the reported unit disagrees with the reported fps (bucket 4 is then not the source period)', () => {
    expect(cadenceShare({ intervalUnitNs: 4_166_666, sourceFps: 30, intervalBuckets: buckets(10) })).toBeNull();
    // …but a 1 % rounding wobble is fine.
    expect(cadenceShare({ intervalUnitNs: 8_400_000, sourceFps: 30, intervalBuckets: buckets(10) })).not.toBeNull();
  });

  it.each([
    ['no timing', undefined],
    ['no histogram', { intervalUnitNs: 8_333_333, sourceFps: 30 }],
    ['fifteen buckets', { intervalUnitNs: 8_333_333, intervalBuckets: new Array(15).fill(1) }],
    ['seventeen buckets', { intervalUnitNs: 8_333_333, intervalBuckets: new Array(17).fill(1) }],
    ['all zero', { intervalUnitNs: 8_333_333, intervalBuckets: buckets(0) }],
    ['a negative count', { intervalUnitNs: 8_333_333, intervalBuckets: buckets(5, { 2: -1 }) }],
    ['a fractional count', { intervalUnitNs: 8_333_333, intervalBuckets: buckets(5, { 2: 0.5 }) }],
    ['NaN', { intervalUnitNs: 8_333_333, intervalBuckets: buckets(Number.NaN) }],
    ['neither unit nor fps', { intervalBuckets: buckets(10) }],
    ['a zero unit and no fps', { intervalUnitNs: 0, intervalBuckets: buckets(10) }],
  ])('%s → null', (_name, input) => {
    expect(cadenceShare(input as never)).toBeNull();
  });
});

// ── modes ────────────────────────────────────────────────────────────

const mode = (label: string): DisplayMode => parseMode(label)!;

describe('parseMode', () => {
  it('reads modeId:WxH@Hz', () => {
    expect(parseMode('1:3840x2160@30.00')).toEqual({ id: 1, width: 3840, height: 2160, hz: 30 });
    expect(parseMode('12:1920x1080@59.94')).toEqual({ id: 12, width: 1920, height: 1080, hz: 59.94 });
  });
  it.each(['', '3840x2160@30', '1:3840x2160', '1:3840x2160@', '1:0x2160@30', '1:3840x2160@0', 'x', '1:3840x2160@30.00; drop table'])(
    'refuses %j', (label) => expect(parseMode(label)).toBeNull(),
  );
  it('refuses a non-string', () => {
    expect(parseMode(undefined)).toBeNull();
    expect(parseMode(30)).toBeNull();
    expect(parseMode(null)).toBeNull();
  });
});

describe('groupModes', () => {
  it('groups by resolution in the order listed, rates ascending and de-duplicated', () => {
    const modes = ['1:3840x2160@30.00', '2:3840x2160@25.00', '3:1920x1080@60.00', '4:1920x1080@30.00', '5:1920x1080@30.001', '6:1920x1080@24.00'].map(mode);
    expect(groupModes(modes)).toEqual([
      { width: 3840, height: 2160, rates: [25, 30] },
      { width: 1920, height: 1080, rates: [24, 30, 60] },
    ]);
  });
  it('is empty for no modes', () => expect(groupModes([])).toEqual([]));
});

describe('sixtyHzAvailability', () => {
  const m = (labels: string[]) => labels.map(mode);
  const FOUR_K_30 = mode('1:3840x2160@30.00');

  it('the real reading: a 4K panel whose only mode is 30 Hz offers no 60 Hz mode', () => {
    expect(sixtyHzAvailability(FOUR_K_30, m(['1:3840x2160@30.00']))).toEqual({ state: 'none' });
  });

  it('a same-resolution 60 Hz mode is offered, with its id', () => {
    expect(sixtyHzAvailability(FOUR_K_30, m(['1:3840x2160@30.00', '2:3840x2160@60.00']))).toEqual({ state: 'offered', hz: 60, modeId: 2 });
  });

  it('picks the mode closest to 60.00, then the lowest id', () => {
    expect(sixtyHzAvailability(FOUR_K_30, m(['1:3840x2160@30.00', '2:3840x2160@59.94', '3:3840x2160@60.00']))).toMatchObject({ modeId: 3 });
    expect(sixtyHzAvailability(FOUR_K_30, m(['1:3840x2160@30.00', '9:3840x2160@60.00', '4:3840x2160@60.00']))).toMatchObject({ modeId: 4 });
  });

  it('"about 60" is 59–61 Hz, both ends inclusive (the APK’s own window)', () => {
    const at = (hz: string) => sixtyHzAvailability(FOUR_K_30, m([`1:3840x2160@30.00`, `2:3840x2160@${hz}`])).state;
    expect(at('58.99')).toBe('none');
    expect(at('59.00')).toBe('offered');
    expect(at('61.00')).toBe('offered');
    expect(at('61.01')).toBe('none');
    expect(at('120.00')).toBe('none');
  });

  it('only the active resolution counts: 60 Hz at 1080p is not a same-resolution mode (the APK never changes resolution)', () => {
    expect(sixtyHzAvailability(FOUR_K_30, m(['1:3840x2160@30.00', '2:1920x1080@60.00']))).toEqual({ state: 'none' });
  });

  it('the mode must be faster than the active one', () => {
    expect(sixtyHzAvailability(mode('1:3840x2160@58.00'), m(['1:3840x2160@58.00']))).toEqual({ state: 'none' });
    expect(sixtyHzAvailability(mode('1:3840x2160@50.00'), m(['1:3840x2160@50.00', '2:3840x2160@59.94']))).toMatchObject({ state: 'offered', modeId: 2 });
  });

  it.each([['59.00'], ['59.94'], ['60.00'], ['120.00']])('a panel already at %s Hz is already there', (hz) => {
    const active = mode(`1:3840x2160@${hz}`);
    expect(sixtyHzAvailability(active, [active, mode('2:3840x2160@30.00')])).toEqual({ state: 'already', hz: Number(hz) });
  });

  it('unknown without an active mode or without a list (an empty list is "could not read it", not "none")', () => {
    expect(sixtyHzAvailability(null, m(['1:3840x2160@30.00']))).toEqual({ state: 'unknown' });
    expect(sixtyHzAvailability(FOUR_K_30, [])).toEqual({ state: 'unknown' });
  });

  it('a list cut at the APK’s 16-mode bound is unknown when it is nothing but the active resolution (a 60 Hz mode could be past the cut)', () => {
    const sixteen = Array.from({ length: 16 }, (_, i) => mode(`${i + 1}:3840x2160@${30 + i}.00`));
    expect(sixtyHzAvailability(FOUR_K_30, sixteen, true)).toEqual({ state: 'unknown' });
    expect(sixtyHzAvailability(FOUR_K_30, sixteen, false)).toEqual({ state: 'none' });
  });

  it('…but the APK lists the active resolution first, so a cut list that reaches another resolution has seen all of this one', () => {
    const cut = [mode('1:3840x2160@30.00'), mode('2:1920x1080@60.00')];
    expect(sixtyHzAvailability(FOUR_K_30, cut, true)).toEqual({ state: 'none' });
  });
});

describe('the panel row from the report', () => {
  const panel = (native: Record<string, unknown>) => rowLines(facts(native), 'panel');

  it('offers: a 60 Hz mode at the same resolution, and lists the modes grouped by resolution', () => {
    expect(panel({
      timing: timing({ supportedModes: ['1:3840x2160@30.00', '2:3840x2160@60.00', '3:1920x1080@24.00', '4:1920x1080@30.00', '5:1920x1080@60.00'] }),
    })).toEqual([
      '3840×2160 at 30 Hz',
      'A ~60 Hz mode is offered at 3840×2160 (60 Hz).',
      'Modes offered: 3840×2160 at 30, 60 Hz · 1920×1080 at 24, 30, 60 Hz',
    ]);
  });

  it('already at 60 Hz', () => {
    expect(panel({ timing: timing({ displayMode: '2:3840x2160@60.00', refreshRate: 60, supportedModes: ['1:3840x2160@30.00', '2:3840x2160@60.00'] }) })[1])
      .toBe('The panel already runs at 59 Hz or faster.');
  });

  it('keeps fractional rates', () => {
    expect(panel({ timing: timing({ displayMode: '3:1920x1080@59.94', refreshRate: 59.94, supportedModes: ['3:1920x1080@59.94'] }) })[0])
      .toBe('1920×1080 at 59.94 Hz');
  });

  it('a rate with no mode label is just the rate', () => {
    expect(panel({ timing: timing({ displayMode: undefined, supportedModes: undefined, refreshRate: 30 }) })).toEqual(['30 Hz']);
  });

  it('says when the list was cut at the APK’s bound', () => {
    const modes = [
      '1:3840x2160@30.00', '2:3840x2160@25.00', '3:3840x2160@24.00', '4:3840x2160@23.98', '5:3840x2160@29.97', '6:3840x2160@50.00',
      '7:1920x1080@60.00', '8:1920x1080@50.00', '9:1920x1080@30.00', '10:1920x1080@25.00', '11:1920x1080@24.00',
      '12:1280x720@60.00', '13:1280x720@50.00', '14:1280x720@30.00', '15:1280x720@25.00', '16:1280x720@24.00',
    ];
    const lines = panel({ timing: timing({ supportedModes: modes }) });
    expect(lines[2]).toMatch(/^First 16 modes offered: /);
  });

  it('reads the default display’s facts when the report has no timing block', () => {
    expect(panel({ device: device() })).toEqual([
      '3840×2160 at 30 Hz',
      'No 60 Hz mode offered at 3840×2160.',
      'Modes offered: 3840×2160 at 30 Hz',
    ]);
  });

  it('an empty active mode (the APK could not read the display) falls back to the rate alone', () => {
    expect(panel({ device: device({ activeMode: '', supportedModes: undefined }) })).toEqual(['30 Hz']);
  });

  it('the display the video is on (timing) wins over the default display (device): they are different panels on a double-sided unit', () => {
    const lines = panel({
      timing: timing({ displayMode: '7:1920x1080@60.00', refreshRate: 60, supportedModes: ['7:1920x1080@60.00'] }),
      device: device(),
    });
    expect(lines[0]).toBe('1920×1080 at 60 Hz');
    expect(lines.join(' ')).not.toContain('3840×2160');
  });

  it('never mixes one display’s active mode with another display’s list', () => {
    // timing has an active mode but no list → no list is borrowed from `device`.
    const lines = panel({ timing: timing({ supportedModes: undefined }), device: device({ supportedModes: ['1:3840x2160@30.00', '2:3840x2160@60.00'] }) });
    expect(lines).toEqual(['3840×2160 at 30 Hz']);
  });

  it('1.1.43: the panel firmware’s own tables, verbatim, as the last muted line — and only on the default display’s face', () => {
    // As SysDisplayFacts sends them: the Amlogic mode in force + `disp_cap` (`*` marks the current), already stripped.
    const firmware = { sysDisplayMode: '2160p30hz', sysDisplayCaps: ['1080p60hz', '2160p30hz*', '2160p60hz'] };
    const f = facts({ faceIndex: 0, timing: timing(), device: device(firmware) });
    expect(rowLines(f, 'panel').at(-1)).toBe('Panel firmware lists: 2160p30hz now; 1080p60hz · 2160p30hz* · 2160p60hz');
    expect(f!.rows.find((r) => r.id === 'panel')!.lines.at(-1)!.tone).toBe('muted');
    // One of the two alone (a Rockchip box has only `fb0/modes`), and neither → no line at all.
    expect(panel({ device: device({ sysDisplayMode: '2160p30hz' }) }).at(-1)).toBe('Panel firmware lists: 2160p30hz now');
    expect(panel({ device: device({ sysDisplayCaps: ['U:1920x1080p-60', 'U:1280x720p-60'] }) }).at(-1)).toBe('Panel firmware lists: U:1920x1080p-60 · U:1280x720p-60');
    expect(panel({ device: device() }).join(' ')).not.toContain('firmware');
    // The tables are the DEFAULT display's (sysfs knows one HDMI output): the back face of a double-sided unit is
    // another panel, so its row never borrows them — the same rule as the mode list above.
    expect(rowLines(facts({ faceIndex: 1, timing: timing(), device: device(firmware) }), 'panel').join(' ')).not.toContain('firmware');
    // A string the readers do not accept is dropped, never shown.
    expect(panel({ device: device({ sysDisplayMode: '<b>2160p</b>', sysDisplayCaps: ['ok', 'not ok'] }) }).join(' ')).not.toContain('firmware');
  });
});

// ── experiments ──────────────────────────────────────────────────────

describe('experiments: what is requested, and what each did', () => {
  it('nothing requested → no experiments row', () => {
    expect(experimentLines({ timing: timing(), experiments: experiments() })).toEqual([]);
    expect(experimentLines({ timing: timing() })).toEqual([]);
  });

  it('the newest experiments come first, whatever order the flags are in', () => {
    const lines = experimentLines({
      timing: timing(),
      experiments: experiments({ decoderRotation: true, surfaceFrameRate: true, webviewInvisible: true, prefer60hz: true, vsyncSnap: true }),
    });
    expect(lines.map((l) => l.split(':')[0])).toEqual(['Vsync snap', '60 Hz mode', 'WebView hidden', 'Frame-rate hint', 'Decoder rotation']);
    expect(EXPERIMENT_ORDER).toEqual(['vsyncSnap', 'prefer60hz', 'webviewInvisible', 'surfaceFrameRate', 'decoderRotation']);
  });

  it('an experiment that is not requested is not listed, even if its applied flag is set', () => {
    expect(experimentLines({ timing: timing(), experiments: experiments({ webviewInvisible: true }, { vsyncSnap: true }) }))
      .toEqual(['WebView hidden: requested, not applied at the last report']);
  });

  describe('WebView hidden', () => {
    it('applied / not applied at the last report', () => {
      expect(experimentLines({ experiments: experiments({ webviewInvisible: true }, { webviewInvisible: true }) })).toEqual(['WebView hidden: requested, applied']);
      expect(experimentLines({ experiments: experiments({ webviewInvisible: true }) })).toEqual(['WebView hidden: requested, not applied at the last report']);
    });
  });

  describe('Vsync snap', () => {
    const snap = (t0: Record<string, unknown>, applied = true) =>
      experimentLines({ timing: timing(t0), experiments: experiments({ vsyncSnap: true }, { vsyncSnap: applied }) });

    it('on and locked: the grid, and the error it left', () => {
      expect(snap({ ...snapping })).toEqual(['Vsync snap: on, locked to a 16.67 ms vsync grid (error 9 µs mean, 120 µs max)']);
    });
    it('locks at the APK’s own sample count, not before', () => {
      expect(VSYNC_LOCK_SAMPLES).toBe(8);
      expect(snap({ ...snapping, vsyncSamples: 8 })[0]).toContain('locked');
      expect(snap({ ...snapping, vsyncSamples: 7 })).toEqual(['Vsync snap: on, not snapping yet (7 of 8 grid samples)']);
    });
    it('a trusted grid that has snapped nothing yet is not locked — and claims nothing it has not measured', () => {
      expect(snap({ ...snapping, snappedFrames: 0 })).toEqual(['Vsync snap: on, no snap measurements reported yet']);
    });
    it('on, but no snap measurement in the report', () => {
      expect(snap({})).toEqual(['Vsync snap: on, no snap measurements reported yet']);
    });
    it('requested but not applied at the last report', () => {
      expect(snap({ ...snapping }, false)).toEqual(['Vsync snap: requested, not applied at the last report']);
    });
    it('a missing error figure is not a lock', () => {
      expect(snap({ ...snapping, snapErrorMeanUs: undefined })).toEqual(['Vsync snap: on, no snap measurements reported yet']);
      expect(snap({ ...snapping, vsyncPeriodUs: undefined })).toEqual(['Vsync snap: on, no snap measurements reported yet']);
    });
  });

  describe('Frame-rate hint (Surface.setFrameRate)', () => {
    const hint = (applied: Record<string, unknown>, dev?: Record<string, unknown>) =>
      experimentLines({ timing: timing(), device: dev, experiments: experiments({ surfaceFrameRate: true }, applied) });

    it('has a line for every code the APK can answer', () => {
      expect(SURFACE_FRAME_RATE_CODES).toEqual(['only-if-seamless', 'refused']);
      expect(hint({ surfaceFrameRate: 'only-if-seamless' })).toEqual(['Frame-rate hint: requested, sent to Android (acts only if the change is seamless)']);
      expect(hint({ surfaceFrameRate: 'refused' })).toEqual(['Frame-rate hint: requested, the request could not be made']);
    });
    it('"sent" is not "the panel moved": the copy says Android was asked', () => {
      expect(hint({ surfaceFrameRate: 'only-if-seamless' })[0]).not.toMatch(/switched|changed the|now runs/i);
    });
    it('a code this build does not know is shown as reported, not interpreted', () => {
      expect(hint({ surfaceFrameRate: 'some-new-code' })).toEqual(['Frame-rate hint: requested, reported “some-new-code”']);
    });
    it('no answer on a pre-Android-11 box says why it cannot have run', () => {
      expect(hint({}, device({ sdk: 28 }))).toEqual(['Frame-rate hint: requested, not applied (needs Android 11 or newer)']);
    });
    it('no answer on Android 11+, or with no device block, is just "not applied at the last report"', () => {
      expect(hint({}, device({ sdk: 30 }))).toEqual(['Frame-rate hint: requested, not applied at the last report']);
      expect(hint({})).toEqual(['Frame-rate hint: requested, not applied at the last report']);
    });
  });

  describe('Decoder rotation', () => {
    it('is requested, and the APK reports no applied flag for it — the copy says so', () => {
      expect(experimentLines({ experiments: experiments({ decoderRotation: true }) })).toEqual(['Decoder rotation: requested, no applied report']);
    });
  });

  describe('60 Hz mode: wording for every result code', () => {
    const sixty = (code: string | undefined, t0: Record<string, unknown> = {}, requested = true) =>
      experimentLines({
        timing: timing({
          supportedModes: ['1:3840x2160@30.00', '2:3840x2160@60.00'],
          ...t0,
        }),
        experiments: experiments(requested ? { prefer60hz: true } : {}, code ? { prefer60hz: code } : {}),
      });

    /** What each code reads like, with the report a real APK would have sent for it. */
    const CASES: Record<(typeof PREFERRED_MODE_RESULTS)[number], { text: string; requested?: boolean; timing?: Record<string, unknown> }> = {
      'applied': { text: '60 Hz mode: requested, asked Android for 3840×2160 at 60 Hz', timing: { preferredModeApplied: 2 } },
      'kept': { text: '60 Hz mode: requested, still asking Android for 3840×2160 at 60 Hz', timing: { preferredModeApplied: 2 } },
      'already-60hz': { text: '60 Hz mode: requested, the panel already runs at 60 Hz', timing: { displayMode: '2:3840x2160@60.00', refreshRate: 60 } },
      'no-60hz-mode': { text: '60 Hz mode: requested, no 60 Hz mode offered' },
      'no-window': { text: '60 Hz mode: requested, no window to ask on' },
      'other-session': { text: '60 Hz mode: requested, another video session was already on this side' },
      'failed': { text: '60 Hz mode: requested, the request could not be made' },
      // `reverted` only ever follows a withdrawn flag.
      'reverted': { text: '60 Hz mode: no longer requested, Android’s own choice restored', requested: false },
      // 1.1.43, as FaceVideoBox reports them: the boundary wanted the mode (`requested` true) but a standing 24 h
      // block refused it, nothing asked …
      'blocked': { text: '60 Hz mode: automatic, paused for 24 h after an earlier switch was undone', timing: { preferredModeApplied: 0 } },
      // … the safety net undid a switch it could not prove (applied back to 0, the panel back on its own mode) …
      'reverted-no-switch': {
        text: '60 Hz mode: asked Android for a 60 Hz mode, the panel did not switch within 10 s, undone (automatic requests paused for 24 h)',
        timing: { preferredModeApplied: 0, displayMode: '1:3840x2160@30.00' },
      },
      'reverted-no-frames': {
        text: '60 Hz mode: asked Android for a 60 Hz mode, no frames followed within 10 s, undone (automatic requests paused for 24 h)',
        timing: { preferredModeApplied: 0, displayMode: '1:3840x2160@30.00' },
      },
      // … and an emergency hold stood at the boundary: the hold is checked BEFORE the panel's modes, so the session
      // never marks the request wanted (`requested.prefer60hz` false) — the line is shown anyway.
      'emergency-held': { text: '60 Hz mode: not asked: an emergency alert was held at that session boundary', requested: false },
    };

    it('the code list is the APK’s (PreferredDisplayMode.RESULT_*)', () => {
      expect([...PREFERRED_MODE_RESULTS].sort()).toEqual(Object.keys(CASES).sort());
    });

    it.each(PREFERRED_MODE_RESULTS)('%s has its own wording', (code) => {
      const c = CASES[code];
      expect(sixty(code, c.timing, c.requested ?? true)).toEqual([c.text]);
    });

    it('every code reads differently', () => {
      const texts = PREFERRED_MODE_RESULTS.map((code) => sixty(code, CASES[code].timing, CASES[code].requested ?? true)[0]);
      expect(new Set(texts).size).toBe(PREFERRED_MODE_RESULTS.length);
    });

    it('applied with a mode id this list does not hold still says Android was asked', () => {
      expect(sixty('applied', { preferredModeApplied: 99 })).toEqual(['60 Hz mode: requested, asked Android for a ~60 Hz mode']);
      expect(sixty('applied', { preferredModeApplied: undefined })).toEqual(['60 Hz mode: requested, asked Android for a ~60 Hz mode']);
      expect(sixty('kept', { preferredModeApplied: 99 })).toEqual(['60 Hz mode: requested, still asking Android for a ~60 Hz mode']);
    });

    it('already-60hz without an active mode does not invent a rate', () => {
      expect(sixty('already-60hz', { displayMode: undefined, supportedModes: undefined, refreshRate: undefined })).toEqual([
        '60 Hz mode: requested, the panel already runs at 59 Hz or faster',
      ]);
    });

    it('requested, no result yet', () => {
      expect(sixty(undefined)).toEqual(['60 Hz mode: requested, no result reported yet']);
    });

    it('a code this build does not know is shown as reported', () => {
      expect(sixty('mode-switched')).toEqual(['60 Hz mode: requested, reported “mode-switched”']);
    });

    it('the result comes from the timing block when the experiments block has none', () => {
      expect(experimentLines({
        timing: timing({ preferredModeResult: 'no-60hz-mode' }),
        experiments: experiments({ prefer60hz: true }),
      })).toEqual(['60 Hz mode: requested, no 60 Hz mode offered']);
    });

    it('after the flag is withdrawn: the revert is still explained, and a revert that failed says so', () => {
      expect(sixty('reverted', {}, false)).toEqual(['60 Hz mode: no longer requested, Android’s own choice restored']);
      expect(sixty('failed', {}, false)).toEqual(['60 Hz mode: no longer requested, restoring Android’s own choice failed']);
    });

    it('…and a stale result for a flag that is off is not shown', () => {
      for (const code of ['applied', 'kept', 'already-60hz', 'no-60hz-mode', 'no-window', 'other-session', 'mystery']) {
        expect(sixty(code, {}, false)).toEqual([]);
      }
      expect(sixty(undefined, {}, false)).toEqual([]);
    });

    it('a withdrawn flag with no other experiment on still gets its row (the experiments block is absent then)', () => {
      expect(rowLines(facts({ timing: timing({ preferredModeResult: 'reverted' }) }), 'experiments'))
        .toEqual(['60 Hz mode: no longer requested, Android’s own choice restored']);
    });
  });

  describe('the player’s guard', () => {
    const guarded = (disabled: Record<string, string>, requested: Record<string, true>) =>
      rowLines(facts({ timing: timing(), experiments: experiments(requested, {}, disabled) }), 'experiments');

    it.each(GUARD_REASONS)('says what switched an experiment off: %s', (why) => {
      const lines = guarded({ webviewInvisible: why }, { webviewInvisible: true });
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe('WebView hidden: requested, not applied at the last report');
      expect(lines[1]).toMatch(/^The player’s guard switched WebView hidden off after /);
    });

    it('has distinct words for every reason', () => {
      const notes = GUARD_REASONS.map((w) => guarded({ vsyncSnap: w }, { vsyncSnap: true })[1]);
      expect(new Set(notes).size).toBe(GUARD_REASONS.length);
      expect(notes).toEqual([
        'The player’s guard switched Vsync snap off after the player page stopped checking in.',
        'The player’s guard switched Vsync snap off after the video output stalled.',
        'The player’s guard switched Vsync snap off after the video output became unavailable.',
        'The player’s guard switched Vsync snap off after the decoder stalled.',
      ]);
    });

    it('a reason this build does not know is shown as reported', () => {
      expect(guarded({ surfaceFrameRate: 'new-fault' }, { surfaceFrameRate: true })[1])
        .toBe('The player’s guard switched Frame-rate hint off after a session ended with “new-fault”.');
    });

    it('it is a separate fact from "applied": an experiment still applied on another face keeps its own line', () => {
      const f = facts({
        timing: timing(),
        experiments: experiments({ webviewInvisible: true }, { webviewInvisible: true }, { webviewInvisible: 'output-stalled' }),
      });
      expect(rowLines(f, 'experiments')).toEqual([
        'WebView hidden: requested, applied',
        'The player’s guard switched WebView hidden off after the video output stalled.',
      ]);
    });

    it('a guard trip on an experiment this screen did not request is not this screen’s news', () => {
      expect(guarded({ vsyncSnap: 'output-stalled' }, { webviewInvisible: true })).toEqual(['WebView hidden: requested, not applied at the last report']);
    });

    it('the notes are muted lines after the experiments', () => {
      const f = facts({ timing: timing(), experiments: experiments({ vsyncSnap: true }, {}, { vsyncSnap: 'codec-stalled' }) });
      expect(f!.rows.find((r) => r.id === 'experiments')!.lines.map((l) => l.tone)).toEqual(['normal', 'muted']);
    });
  });
});

// ── time and locale ──────────────────────────────────────────────────

describe('relativeAgo', () => {
  it('speaks the reader’s language and rounds to the nearest unit', () => {
    expect(relativeAgo('en', NOW - 5_000, NOW)).toBe('5 seconds ago');
    expect(relativeAgo('en', NOW - 120_000, NOW)).toBe('2 minutes ago');
    expect(relativeAgo('en', NOW - 3 * 3_600_000, NOW)).toBe('3 hours ago');
    expect(relativeAgo('en', NOW - 3 * 86_400_000, NOW)).toBe('3 days ago');
  });
  it('a stamp from the future (clock skew) reads as now', () => {
    expect(relativeAgo('en', NOW + 30_000, NOW)).toBe('now');
  });
  it('a locale this runtime does not know falls back to English', () => {
    expect(relativeAgo('xx-INVALID-LOCALE-!!', NOW - 120_000, NOW)).toBe('2 minutes ago');
  });
});

describe('previous sessions (timing.history)', () => {
  const HOUR = 3_600_000;
  /** One finished session as the APK's ledger writes it (NativeTimingLedger). */
  const entry = (over: Record<string, unknown> = {}) => ({
    at: NOW - 3 * HOUR, face: 0, elapsedMs: 12 * 60_000, fps: 30,
    vsyncSnap: true, prefer60hz: 'no-60hz-mode',
    intervalUnitNs: 8_333_333, intervalBuckets: buckets(41_191, { 2: 4, 5: 5, 8: 3 }), intervalCount: 41_203,
    ...over,
  });
  const past = (entries: unknown[], extra: Record<string, unknown> = {}, native: Record<string, unknown> = {}, locale = 'en') =>
    rowLines(facts({ ...native, timing: timing({ history: { entries, overflow: 0, capacity: 6, ...extra } }) }, locale), 'history');

  it('one line per finished session, newest first: when, how long, snap, the 60 Hz answer, the cadence share', () => {
    const lines = past([
      // the ledger appends as sessions end, so the array is oldest → newest
      entry({ at: NOW - 26 * HOUR, vsyncSnap: false, prefer60hz: undefined, elapsedMs: 3.5 * HOUR, intervalBuckets: buckets(980, { 5: 20 }) }),
      entry({ at: NOW - 9 * HOUR, recovered: true }),
      entry(),
    ]);
    expect(lines).toEqual([
      '3 hours ago · ran 12 min · snap on · 60 Hz mode: no 60 Hz mode offered · 99.97 % on cadence',
      '9 hours ago · recovered after a restart · ran 12 min · snap on · 60 Hz mode: no 60 Hz mode offered · 99.97 % on cadence',
      'yesterday · ran 3.5 hr · snap off · 98 % on cadence',
    ]);
  });

  it('is the last row, and only exists when there is a session to list', () => {
    const withIt = facts({ timing: timing({ history: { entries: [entry()], overflow: 0 } }) });
    expect(withIt!.rows.map((r) => r.id)).toEqual(['panel', 'cadence', 'keepScreenOn', 'history']);
    expect(withIt!.rows.at(-1)!.label).toEqual({ key: 'history.label' });
    expect(facts({ timing: timing() })!.rows.map((r) => r.id)).not.toContain('history');
  });

  it('lists only this screen’s face: the ledger is the player PROCESS’s, so it holds both faces of a double-sided unit', () => {
    const entries = [entry({ face: 1, at: NOW - 2 * HOUR }), entry({ face: 0 }), entry({ face: undefined, at: NOW - 5 * HOUR })];
    expect(past(entries, {}, { faceIndex: 0 })).toHaveLength(2); // face 0 + the faceless one
    expect(past(entries, {}, { faceIndex: 1 })).toHaveLength(2); // face 1 + the faceless one
    expect(past(entries)).toHaveLength(3); // a report that names no face filters nothing
  });

  it('leaves out what an entry does not carry — an APK before 1.1.42 never reads "snap off"', () => {
    expect(past([entry({ vsyncSnap: undefined, prefer60hz: undefined })])).toEqual(['3 hours ago · ran 12 min · 99.97 % on cadence']);
    // no histogram, but a snap flag: still a session worth a line, without a cadence figure
    expect(past([entry({ intervalBuckets: undefined, intervalUnitNs: undefined, prefer60hz: undefined })])).toEqual(['3 hours ago · ran 12 min · snap on']);
  });

  it('skips a session with none of the three measurements, and shows no row when all are skipped', () => {
    expect(past([{ at: NOW - HOUR, elapsedMs: 5000, face: 0 }])).toEqual([]);
    expect(past([])).toEqual([]);
    expect(rowLines(facts({ timing: timing({ history: { entries: [], overflow: 4 } }) }), 'history')).toEqual([]);
  });

  it('a session shorter than a second says no duration (0 is not a length)', () => {
    expect(past([entry({ elapsedMs: 0 })])[0]).not.toContain('ran');
    expect(past([entry({ elapsedMs: 999 })])[0]).not.toContain('ran');
    expect(past([entry({ elapsedMs: 45_000 })])[0]).toContain('ran 45 sec');
  });

  it('a stamp that cannot be right is "time unknown", not "20,000 days ago"; a few minutes of clock skew is just "now"', () => {
    expect(past([entry({ at: 0 })])[0]).toMatch(/^time unknown · ran 12 min · /);
    expect(past([entry({ at: NOW + 3 * 86_400_000 })])[0]).toMatch(/^time unknown · /);
    expect(past([entry({ at: NOW + 60_000 })])[0]).toMatch(/^now · /);
  });

  it('says how many older sessions fell off the player’s ledger — only beside sessions that are listed', () => {
    const lines = past([entry()], { overflow: 3 });
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('3 older sessions are no longer listed — the player keeps only its most recent ones.');
    expect(past([entry()], { overflow: 0 })).toHaveLength(1);
    expect(past([{ at: NOW - HOUR }], { overflow: 3 })).toEqual([]);
    expect(facts({ timing: timing({ history: { entries: [entry()], overflow: 3 } }) })!.rows.at(-1)!.lines.map((l) => l.tone)).toEqual(['normal', 'muted']);
  });

  it.each(PREFERRED_MODE_RESULTS)('the 60 Hz answer "%s" has its own words', (code) => {
    const line = past([entry({ prefer60hz: code, vsyncSnap: undefined, intervalBuckets: undefined })])[0];
    expect(line).toMatch(/60 Hz mode: .+$/);
    expect(line).not.toContain('reported “');
  });

  it('…all different, and an answer this build does not know is shown as reported', () => {
    const texts = PREFERRED_MODE_RESULTS.map((c) => past([entry({ prefer60hz: c, vsyncSnap: undefined, intervalBuckets: undefined })])[0]);
    expect(new Set(texts).size).toBe(PREFERRED_MODE_RESULTS.length);
    expect(past([entry({ prefer60hz: 'brand-new-code', vsyncSnap: undefined, intervalBuckets: undefined })])[0]).toContain('60 Hz mode: reported “brand-new-code”');
  });

  it('claims nothing about whether the 60 Hz mode was requested — a history entry only knows the answer', () => {
    for (const c of ['failed', 'reverted']) {
      expect(past([entry({ prefer60hz: c })])[0]).not.toMatch(/\brequested\b/);
    }
  });

  it('the share is the same truncated, cross-checked one as the headline: a session whose histogram does not match its fps makes no claim', () => {
    expect(past([entry({ fps: 60 })])[0]).not.toContain('on cadence'); // unit says 30 fps, entry says 60
    expect(past([entry({ intervalBuckets: buckets(99_999, { 5: 1 }) })])[0]).toContain('99.99 % on cadence');
  });

  it('speaks the reader’s language (numbers, time and duration come from Intl; the words from the catalogue)', () => {
    const parts = (locale: string) => facts({ timing: timing({ history: { entries: [entry()], overflow: 0 } }) }, locale)!.rows.at(-1)!.lines[0].parts;
    expect(parts('zh')[0]).toEqual({ key: 'history.when', values: { ago: '3小时前' } });
    expect(parts('zh')[1].values).toEqual({ duration: '12分钟' });
    expect(parts('es')[0]).toEqual({ key: 'history.when', values: { ago: 'hace 3 horas' } });
    expect(parts('es').at(-1)!.values).toEqual({ percent: '99,97' });
  });
});

describe('lists of rates read as lists in every language', () => {
  // CLDR's Chinese *unit* list has no separator at all ("243060"); the mode list must use a conjunction list instead.
  const groups = (locale: string) => {
    const f = facts({ timing: timing({ supportedModes: ['1:3840x2160@30.00', '2:3840x2160@60.00', '3:1920x1080@24.00', '4:1920x1080@30.00', '5:1920x1080@60.00'] }) }, locale);
    const line = f!.rows.find((r) => r.id === 'panel')!.lines.at(-1)!.parts[0];
    return (line.values!.list as Msg[]).map((g) => g.values!.rates as string);
  };
  it.each([
    ['en', ['30, 60', '24, 30, 60']],
    ['es', ['30 y 60', '24, 30 y 60']],
    ['zh', ['30、60', '24、30、60']],
  ])('%s', (locale, expected) => {
    expect(groups(locale)).toEqual(expected);
  });
  it('a single rate is just the rate', () => {
    const f = facts({ timing: timing() }, 'zh');
    const line = f!.rows.find((r) => r.id === 'panel')!.lines.at(-1)!.parts[0];
    expect((line.values!.list as Msg[])[0].values!.rates).toBe('30');
  });
});

describe('numbers follow the locale; the words come from the catalogue', () => {
  it('Spanish uses the decimal comma and the dot group', () => {
    const f = facts({ timing: timing() }, 'es');
    const cadence = f!.rows.find((r) => r.id === 'cadence')!;
    expect(cadence.lines[0].parts[0]).toEqual({ key: 'cadence.onCadence', values: { percent: '99,97' } });
    expect(cadence.lines[1].parts[0].values).toMatchObject({ count: '41.203', tolerance: 4, period: '33,3' });
  });
});

// ── the catalogue ────────────────────────────────────────────────────

type Seen = Map<string, Set<string>>;
function collect(m: Msg, seen: Seen): void {
  const names = seen.get(m.key) ?? new Set<string>();
  seen.set(m.key, names);
  for (const [name, v] of Object.entries(m.values ?? {})) {
    names.add(name);
    if (Array.isArray(v)) v.forEach((x) => collect(x, seen));
    else if (typeof v === 'object') collect(v, seen);
  }
}
function collectFacts(f: DisplayFacts | null, seen: Seen): void {
  if (!f) return;
  collect(f.title, seen);
  collect(f.provenance, seen);
  if (f.session) collect(f.session, seen);
  for (const row of f.rows) {
    collect(row.label, seen);
    for (const line of row.lines) line.parts.forEach((p) => collect(p, seen));
  }
}
const flatten = (obj: unknown, prefix = '', out: Record<string, string> = {}): Record<string, string> => {
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
};

describe('the catalogue and the code agree', () => {
  /** A battery that reaches every message the module can emit. */
  const battery = (): Seen => {
    const seen: Seen = new Map();
    const allFlags = { vsyncSnap: true, prefer60hz: true, webviewInvisible: true, surfaceFrameRate: true, decoderRotation: true } as const;
    const natives: Array<Record<string, unknown>> = [
      // The field reading, every experiment on and snapping.
      { timing: timing({ ...snapping, preferredModeApplied: 2, supportedModes: ['1:3840x2160@30.00', '2:3840x2160@60.00', '3:1920x1080@60.00'] }), device: device({ sdk: 28 }),
        experiments: experiments(allFlags, { vsyncSnap: true, webviewInvisible: true, prefer60hz: 'applied' }) },
      // Each way vsync snap can read.
      { timing: timing(), experiments: experiments(allFlags, { vsyncSnap: true, prefer60hz: 'kept', surfaceFrameRate: 'only-if-seamless' }) },
      { timing: timing({ ...snapping, vsyncSamples: 3 }), experiments: experiments({ vsyncSnap: true }, { vsyncSnap: true }) },
      { timing: timing(), experiments: experiments({ vsyncSnap: true, surfaceFrameRate: true }, { surfaceFrameRate: 'refused' }) },
      { timing: timing(), device: device({ sdk: 33 }), experiments: experiments({ surfaceFrameRate: true }, { surfaceFrameRate: 'mystery' }) },
      { timing: timing({ preferredModeApplied: 2, supportedModes: ['1:3840x2160@30.00', '2:3840x2160@60.00'] }), experiments: experiments({ prefer60hz: true }, { prefer60hz: 'kept' }) },
      // Every experiment-5 result.
      ...PREFERRED_MODE_RESULTS.map((code) => ({ timing: timing(), experiments: experiments({ prefer60hz: true }, { prefer60hz: code }) })),
      { timing: timing({ displayMode: '2:3840x2160@60.00', refreshRate: 60 }), experiments: experiments({ prefer60hz: true }, { prefer60hz: 'already-60hz' }) },
      { timing: timing({ displayMode: undefined, supportedModes: undefined, refreshRate: undefined }), experiments: experiments({ prefer60hz: true }, { prefer60hz: 'already-60hz' }) },
      { timing: timing(), experiments: experiments({ prefer60hz: true }, { prefer60hz: 'brand-new-code' }) },
      { timing: timing(), experiments: experiments({ prefer60hz: true }) },
      { timing: timing(), experiments: experiments({}, { prefer60hz: 'failed' }) },
      { timing: timing({ preferredModeResult: 'reverted' }) },
      // The guard, every reason and one unknown.
      ...[...GUARD_REASONS, 'something-else'].map((why) => ({
        timing: timing(), experiments: experiments({ webviewInvisible: true }, {}, { webviewInvisible: why }),
      })),
      // Panel variants: 60 Hz offered, already there, rate only, a cut list, the device block alone.
      { timing: timing({ supportedModes: ['1:3840x2160@30.00', '2:3840x2160@60.00'] }) },
      { timing: timing({ displayMode: '2:3840x2160@60.00', refreshRate: 60, supportedModes: ['2:3840x2160@60.00'] }) },
      { timing: timing({ displayMode: undefined, supportedModes: undefined }) },
      { timing: timing({ supportedModes: Array.from({ length: 16 }, (_, i) => `${i + 1}:${i < 8 ? '3840x2160' : '1920x1080'}@${30 + i}.00`) }) },
      { device: device() },
      // 1.1.43: the panel firmware's own tables — both, the mode alone, the capability table alone.
      { device: device({ sysDisplayMode: '2160p30hz', sysDisplayCaps: ['1080p60hz', '2160p30hz*'] }) },
      { device: device({ sysDisplayMode: '2160p30hz' }) },
      { device: device({ sysDisplayCaps: ['U:1920x1080p-60'] }) },
      // Session states, keep-screen-on both ways, no stamp.
      { state: 'preparing', timing: timing() },
      { state: 'ready', timing: timing() },
      { state: 'failed', reason: 'output-stalled', timing: timing({ keepScreenOn: true }) },
      { state: 'failed', timing: timing() },
      { at: 'not a date', timing: timing() },
      // Previous sessions: an impossible stamp, snap off, a restart-recovered session, every 60 Hz answer, one this build does not know, the overflow.
      { faceIndex: 0, timing: timing({ history: { overflow: 2, capacity: 6, entries: [
        { at: 0, face: 0, elapsedMs: 90_000, fps: 30, vsyncSnap: false, prefer60hz: 'brand-new-code', intervalUnitNs: 8_333_333, intervalBuckets: buckets(10) },
        { at: NOW - 3_600_000, face: 0, vsyncSnap: true, prefer60hz: 'applied' },
        { at: NOW - 3_600_000, face: 0, recovered: true, prefer60hz: 'kept', elapsedMs: 7_200_000 },
        { at: NOW - 3_600_000, face: 0, prefer60hz: 'already-60hz' },
        { at: NOW - 3_600_000, face: 0, prefer60hz: 'no-60hz-mode' },
        { at: NOW - 3_600_000, face: 0, prefer60hz: 'no-window' },
        { at: NOW - 3_600_000, face: 0, prefer60hz: 'other-session' },
      ] } }) },
      { faceIndex: 0, timing: timing({ history: { overflow: 0, entries: [
        { at: NOW - 3_600_000, face: 0, prefer60hz: 'failed' },
        { at: NOW - 3_600_000, face: 0, prefer60hz: 'reverted' },
        // 1.1.43: the automatic request's own answers and the safety net's verdicts, per finished session.
        { at: NOW - 3_600_000, face: 0, prefer60hz: 'blocked' },
        { at: NOW - 3_600_000, face: 0, prefer60hz: 'reverted-no-switch' },
        { at: NOW - 3_600_000, face: 0, prefer60hz: 'reverted-no-frames' },
        { at: NOW - 3_600_000, face: 0, prefer60hz: 'emergency-held' },
      ] } }) },
      // An older player.
      { timing: nineCounters() },
    ];
    for (const n of natives) collectFacts(facts(n), seen);
    return seen;
  };

  const catalogue = flatten((en as unknown as { screens: { displayFacts: unknown } }).screens.displayFacts);
  const seen = battery();

  it('every key the code emits is in the English catalogue, with exactly the placeholders it passes', () => {
    const problems: string[] = [];
    for (const [key, names] of seen) {
      const text = catalogue[key];
      if (typeof text !== 'string') { problems.push(`MISSING in en: ${key}`); continue; }
      const placeholders = new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
      const passed = [...names].sort().join(',');
      if ([...placeholders].sort().join(',') !== passed) problems.push(`${key}: catalogue has {${[...placeholders].sort().join(',')}} but the code passes {${passed}}`);
    }
    expect(problems).toEqual([]);
  });

  it('every message in the catalogue is used (no dead copy), and the battery reached it', () => {
    const unused = Object.keys(catalogue).filter((k) => !seen.has(k));
    expect(unused).toEqual([]);
  });

  it.each([['es', es], ['zh', zh]])('%s has every key, translated (not a copy of the English)', (_lang, catalog) => {
    const tr = flatten((catalog as unknown as { screens: { displayFacts: unknown } }).screens.displayFacts);
    expect(Object.keys(tr).sort()).toEqual(Object.keys(catalogue).sort());
    // Strings made only of placeholders, punctuation and units ("{hz} Hz", "{name}: {state}") are legitimately the same everywhere.
    const wordless = (text: string) => !/\p{L}/u.test(text.replace(/\{\w+\}/g, '').replace(/Hz|ms|µs/g, ''));
    for (const [key, text] of Object.entries(tr)) {
      expect(text.trim().length).toBeGreaterThan(0);
      if (!wordless(catalogue[key])) expect(`${key}: ${text}`).not.toBe(`${key}: ${catalogue[key]}`);
    }
  });

  it('no message uses a character the i18n rich-text pass would swallow', () => {
    for (const [key, text] of Object.entries(catalogue)) expect(`${key}: ${text}`).not.toMatch(/[<>]/);
  });

  it('renders every message to a string with nothing left unsubstituted', () => {
    for (const n of [{ timing: timing({ ...snapping }), device: device(), experiments: experiments({ vsyncSnap: true, prefer60hz: true }, { vsyncSnap: true, prefer60hz: 'no-60hz-mode' }) }]) {
      const f = facts(n);
      const all = [renderMessage(t, f!.title), renderMessage(t, f!.provenance), ...f!.rows.flatMap((r) => [renderMessage(t, r.label), ...r.lines.map((l) => renderParts(t, l.parts))])];
      for (const s of all) expect(s).not.toMatch(/\{\w+\}|screens\.displayFacts/);
    }
  });
});
