/**
 * Panel and playback pacing — the pure half of the Overview's display-facts
 * section (2026-10-18, player 1.1.42 field candidate).
 *
 * Owner: show what the glass-side measurement says, on the phone, without a
 * log. Everything here is read from `Screen.lastVideoReport.native` — the
 * native video report the page relays from the APK — and nothing else: the
 * panel's active mode and offered modes, the render-callback interval
 * histogram, the experiments requested for this screen and what each did, and
 * whether the player window held keep-screen-on. The report is validated again
 * on the way in by the same readers the player page uses
 * (`readNativeVideoTiming` / `readNativeDeviceClass` /
 * `readNativeSessionExperiments`), so a field this build does not know never
 * reaches the screen.
 *
 * ── HONESTY RULES (player rule 10 — copy states what the evidence proves) ──
 *  • Facts, no verdicts and no controls. A cadence share is a share; there is
 *    no green/amber threshold because no threshold has been qualified.
 *  • "No 60 Hz mode offered" is what the panel's own list says — never "cannot
 *    do 60 Hz". A list that may have been cut at the APK's 16-mode bound says
 *    so, and when the cut could be hiding the answer the answer is unknown.
 *  • "Requested" is the flag on this screen; "applied" is the APK's own flag
 *    or result code at the LAST report. The `surfaceFrameRate` code
 *    `only-if-seamless` and the `prefer60hz` code `applied` mean Android was
 *    ASKED — the panel's mode in the row above is what shows whether it moved.
 *  • An absent field is absent: no row, no zero, no guess. A screen with no
 *    native report renders nothing at all.
 *
 * Pure: no React, no network, no wall clock (`nowMs` is injected), and no
 * English — every sentence is a catalogue reference (`Msg`, keys relative to
 * `screens.displayFacts`) the component translates. A test holds the code and
 * the en/es/zh catalogues together.
 */

import {
  NATIVE_INTERVAL_BUCKETS,
  NATIVE_MAX_SUPPORTED_MODES,
  readNativeDeviceClass,
  readNativeSessionExperiments,
  readNativeVideoTiming,
  type NativeSessionExperiments,
  type NativeVideoTiming,
} from '@/app/player/nativeSharedVideo';

// ═══════════════════════════════════════════════════════════════════
// The APK's own constants, mirrored (each names where it lives)
// ═══════════════════════════════════════════════════════════════════

/** `RenderIntervalHistogram.PERIOD_BUCKET` (NativeVideoTiming.kt): the bucket centred on exactly one source frame period. */
export const PERIOD_BUCKET = 4;
/** `DisplayModePolicy.MIN_HZ` / `MAX_HZ` (DisplayModePolicy.kt): what the APK calls a "~60 Hz" mode. */
export const SIXTY_HZ_MIN = 59;
export const SIXTY_HZ_MAX = 61;
/** `VsyncEstimator.MIN_SAMPLES` (VsyncClock.kt): the vsync grid is trusted from this many samples. */
export const VSYNC_LOCK_SAMPLES = 8;
/** `Surface.setFrameRate` needs API 30 (Android 11). */
const SURFACE_FRAME_RATE_MIN_SDK = 30;

/** Experiment 5's result codes (`PreferredDisplayMode.RESULT_*`). */
export const PREFERRED_MODE_RESULTS = [
  'applied', 'kept', 'already-60hz', 'no-60hz-mode', 'no-window', 'other-session', 'failed', 'reverted',
] as const;
/** `Api30SurfaceFrameRate.request` answers one of these. */
export const SURFACE_FRAME_RATE_CODES = ['only-if-seamless', 'refused'] as const;
/** `NativeExperimentGuard.FAULTS`: the only reasons the guard switches an experiment off. */
export const GUARD_REASONS = ['page-lease-expired', 'output-stalled', 'output-unavailable', 'codec-stalled'] as const;
/** Newest first: the 1.1.42 pair are the ones in the field. */
export const EXPERIMENT_ORDER = ['vsyncSnap', 'prefer60hz', 'webviewInvisible', 'surfaceFrameRate', 'decoderRotation'] as const;
export type ExperimentName = (typeof EXPERIMENT_ORDER)[number];

// ═══════════════════════════════════════════════════════════════════
// Messages — catalogue references, rendered by the component
// ═══════════════════════════════════════════════════════════════════

/** A value in a message: text, a number, a nested message, or a list of messages joined with {@link LIST_SEPARATOR}. */
export type MsgValue = string | number | Msg | Msg[];
/** A line of copy by catalogue key (relative to `screens.displayFacts`) plus its values. */
export interface Msg {
  key: string;
  values?: Record<string, MsgValue>;
}
export type Translate = (key: string, values?: Record<string, string | number>) => string;

export const LIST_SEPARATOR = ' · ';

const msg = (key: string, values?: Record<string, MsgValue>): Msg => (values ? { key, values } : { key });

/** Resolve a message and any messages nested in its values, bottom-up. */
export function renderMessage(t: Translate, m: Msg): string {
  if (!m.values) return t(m.key);
  const out: Record<string, string | number> = {};
  for (const [name, v] of Object.entries(m.values)) {
    out[name] = Array.isArray(v) ? renderParts(t, v) : typeof v === 'object' ? renderMessage(t, v) : v;
  }
  return t(m.key, out);
}

/** Several messages on one line, joined by a middle dot. */
export function renderParts(t: Translate, parts: Msg[]): string {
  return parts.map((p) => renderMessage(t, p)).join(LIST_SEPARATOR);
}

// ═══════════════════════════════════════════════════════════════════
// Number and time formatting (locale only changes digits and words)
// ═══════════════════════════════════════════════════════════════════

function numberFormat(locale: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, options);
  } catch {
    return new Intl.NumberFormat('en', options);
  }
}

export const formatCount = (n: number, locale: string): string => numberFormat(locale).format(n);

/** "30", "59.94", "23.98" — at most two decimals, none when whole. */
export const formatRate = (hz: number, locale: string): string =>
  numberFormat(locale, { maximumFractionDigits: 2 }).format(Math.round(hz * 100) / 100);

/** Two decimals, except a whole 100 which is just "100". */
export function formatPercent(percent: number, locale: string): string {
  const whole = Number.isInteger(percent);
  return numberFormat(locale, { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(percent);
}

/** "2 minutes ago". A stamp from the future (clock skew) reads as "now", never "in 5 seconds". */
export function relativeAgo(locale: string, atMs: number, nowMs: number): string {
  const diffSec = Math.min(0, Math.round((atMs - nowMs) / 1000));
  const abs = -diffSec;
  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  } catch {
    rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  }
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86_400), 'day');
}

/**
 * "24, 30, 60" in the reader's language ("24, 30 y 60", "24、30、60"); a plain comma list where `Intl.ListFormat` is
 * missing. NOT `type: 'unit'`: CLDR's Chinese unit lists have no separator at all ("243060").
 */
function joinRates(rates: string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { style: 'narrow', type: 'conjunction' }).format(rates);
  } catch {
    return rates.join(', ');
  }
}

// ═══════════════════════════════════════════════════════════════════
// Display modes
// ═══════════════════════════════════════════════════════════════════

export interface DisplayMode {
  id: number;
  width: number;
  height: number;
  hz: number;
}

const MODE_RE = /^(\d{1,6}):(\d{1,5})x(\d{1,5})@(\d{1,4}(?:\.\d{1,3})?)$/;

/** `modeId:WxH@Hz` — the shape every display-mode field uses — or null. */
export function parseMode(label: unknown): DisplayMode | null {
  if (typeof label !== 'string') return null;
  const m = MODE_RE.exec(label);
  if (!m) return null;
  const mode = { id: Number(m[1]), width: Number(m[2]), height: Number(m[3]), hz: Number(m[4]) };
  return mode.width > 0 && mode.height > 0 && mode.hz > 0 ? mode : null;
}

/** "3840×2160". */
export const sizeLabel = (m: { width: number; height: number }): string => `${m.width}×${m.height}`;

export interface ModeGroup {
  width: number;
  height: number;
  /** Ascending, whole-to-two-decimals, no duplicates. */
  rates: number[];
}

/** One group per resolution, in the order the panel listed them (the APK puts the active resolution first). */
export function groupModes(modes: DisplayMode[]): ModeGroup[] {
  const groups: ModeGroup[] = [];
  for (const m of modes) {
    let g = groups.find((x) => x.width === m.width && x.height === m.height);
    if (!g) {
      g = { width: m.width, height: m.height, rates: [] };
      groups.push(g);
    }
    const rate = Math.round(m.hz * 100) / 100;
    if (!g.rates.includes(rate)) g.rates.push(rate);
  }
  for (const g of groups) g.rates.sort((a, b) => a - b);
  return groups;
}

export type SixtyHz =
  /** No active mode, or no mode list, or a cut list that could be hiding the answer. */
  | { state: 'unknown' }
  /** The panel already runs at 59 Hz or faster. */
  | { state: 'already'; hz: number }
  /** A mode of the active resolution within 59–61 Hz and faster than the active one is listed. */
  | { state: 'offered'; hz: number; modeId: number }
  /** The list has none at the active resolution. */
  | { state: 'none' };

/**
 * Is a same-resolution ~60 Hz mode offered? The APK's own rule
 * (`DisplayModePolicy.choosePreferred60`): same width and height, 59–61 Hz,
 * faster than the active rate, closest to 60.00 first; nothing to ask when the
 * panel already runs at 59 Hz or more. `truncated` = the list reached the APK's
 * 16-mode bound. The APK sorts the active resolution first, so a cut cannot hide
 * a same-resolution mode unless the list is nothing BUT that resolution.
 */
export function sixtyHzAvailability(active: DisplayMode | null, modes: DisplayMode[], truncated = false): SixtyHz {
  if (!active || modes.length === 0) return { state: 'unknown' };
  if (active.hz >= SIXTY_HZ_MIN) return { state: 'already', hz: active.hz };
  const sameSize = modes.filter((m) => m.width === active.width && m.height === active.height);
  const pick = sameSize
    .filter((m) => m.hz >= SIXTY_HZ_MIN && m.hz <= SIXTY_HZ_MAX && m.hz > active.hz)
    .sort((a, b) => Math.abs(a.hz - 60) - Math.abs(b.hz - 60) || a.id - b.id)[0];
  if (pick) return { state: 'offered', hz: pick.hz, modeId: pick.id };
  if (truncated && sameSize.length === modes.length) return { state: 'unknown' };
  return { state: 'none' };
}

// ═══════════════════════════════════════════════════════════════════
// Cadence
// ═══════════════════════════════════════════════════════════════════

export interface Cadence {
  /** The share of render-callback intervals within half a bucket of the source period, in percent, TRUNCATED to two decimals — never rounded up to 100. */
  percent: number;
  onCadence: number;
  total: number;
  /** Half a bucket in ms (rounded, at least 1): the "±N ms" of the claim. */
  toleranceMs: number;
  /** The source frame period the histogram was built for, in ms. */
  periodMs: number;
}

/** floor(a / b) in exact integer arithmetic (a plain `Math.floor(a / b)` can land one under on a float quotient like 9996.999…). */
function floorDiv(a: number, b: number): number {
  let q = Math.floor(a / b);
  if (!Number.isSafeInteger((q + 2) * b)) return q;
  while ((q + 1) * b <= a) q += 1;
  while (q * b > a) q -= 1;
  return q;
}

/**
 * The share of the native render-callback intervals that sat in the bucket
 * centred on the source frame period (bucket 4 of 16: the histogram's unit is
 * P/4, bucket k holds [(k − ½)·P/4, (k + ½)·P/4), so bucket 4 is P ± P/8 —
 * ±4.2 ms at 30 fps). `sourceFps` is the cross-check: when both it and the
 * reported unit are present they must agree within 2 %, otherwise bucket 4 is
 * not the source period and no claim is made.
 */
export function cadenceShare(
  timing: Pick<NativeVideoTiming, 'intervalBuckets' | 'intervalUnitNs' | 'sourceFps'> | null | undefined,
): Cadence | null {
  const buckets = timing?.intervalBuckets;
  if (!Array.isArray(buckets) || buckets.length !== NATIVE_INTERVAL_BUCKETS) return null;
  if (!buckets.every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
  const total = buckets.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(total) || total <= 0) return null;

  const unitReported = typeof timing?.intervalUnitNs === 'number' && Number.isFinite(timing.intervalUnitNs) && timing.intervalUnitNs > 0
    ? timing.intervalUnitNs : null;
  const fps = typeof timing?.sourceFps === 'number' && Number.isFinite(timing.sourceFps) && timing.sourceFps > 0 ? timing.sourceFps : null;
  // RenderIntervalHistogram.forFps: frameNs = (1e9 / fps clamped to 1..240).toLong(); unit = frameNs / 4.
  const unitFromFps = fps === null ? null : Math.max(1, Math.floor(Math.floor(1e9 / Math.min(240, Math.max(1, fps))) / 4));
  const unit = unitReported ?? unitFromFps;
  if (unit === null) return null;
  if (unitReported !== null && unitFromFps !== null && Math.abs(unitReported - unitFromFps) / unitFromFps > 0.02) return null;

  const onCadence = buckets[PERIOD_BUCKET];
  const scaled = onCadence * 10_000;
  const hundredths = Number.isSafeInteger(scaled) ? floorDiv(scaled, total) : Math.floor((onCadence / total) * 10_000);
  return {
    percent: hundredths / 100,
    onCadence,
    total,
    toleranceMs: Math.max(1, Math.round(unit / 2 / 1e6)),
    periodMs: (unit * 4) / 1e6,
  };
}

// ═══════════════════════════════════════════════════════════════════
// The view model
// ═══════════════════════════════════════════════════════════════════

export interface FactLine {
  /** One line; several parts are joined by a middle dot. */
  parts: Msg[];
  tone: 'strong' | 'normal' | 'muted';
}

export interface FactRow {
  id: 'panel' | 'cadence' | 'experiments' | 'keepScreenOn';
  label: Msg;
  lines: FactLine[];
}

export interface DisplayFacts {
  title: Msg;
  /** Where the facts come from and how old they are. */
  provenance: Msg;
  /** Set when the native session was not presenting at that report. */
  session: Msg | null;
  rows: FactRow[];
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const CODE_RE = /^[a-z0-9-]{1,64}$/i;

const modeAt = (m: DisplayMode, locale: string): Msg =>
  msg('panel.modeAt', { size: sizeLabel(m), hz: formatRate(m.hz, locale) });

interface Panel {
  active: DisplayMode | null;
  hz: number | null;
  modes: DisplayMode[];
  truncated: boolean;
}

/**
 * The display the VIDEO is on (`timing.*`, read from the face's own display)
 * wins over the default display's `device.*`: on a double-sided unit they are
 * different panels. Active mode and mode list always come from the same source.
 */
function resolvePanel(timing: NativeVideoTiming | null, device: ReturnType<typeof readNativeDeviceClass>): Panel {
  const timingActive = parseMode(timing?.displayMode);
  const timingModes = (timing?.supportedModes ?? []).map(parseMode).filter((m): m is DisplayMode => m !== null);
  const timingHz = positive(timing?.refreshRate);
  if (timingActive || timingModes.length > 0 || timingHz !== null) {
    return {
      active: timingActive,
      hz: timingActive?.hz ?? timingHz,
      modes: timingModes,
      truncated: (timing?.supportedModes?.length ?? 0) >= NATIVE_MAX_SUPPORTED_MODES,
    };
  }
  const deviceActive = parseMode(device?.activeMode);
  return {
    active: deviceActive,
    hz: deviceActive?.hz ?? positive(device?.refreshRate),
    modes: (device?.supportedModes ?? []).map(parseMode).filter((m): m is DisplayMode => m !== null),
    truncated: (device?.supportedModes?.length ?? 0) >= NATIVE_MAX_SUPPORTED_MODES,
  };
}

function panelRow(panel: Panel, locale: string): FactRow | null {
  const lines: FactLine[] = [];
  if (panel.active) lines.push({ parts: [modeAt(panel.active, locale)], tone: 'strong' });
  else if (panel.hz !== null) lines.push({ parts: [msg('panel.rateOnly', { hz: formatRate(panel.hz, locale) })], tone: 'strong' });

  const sixty = sixtyHzAvailability(panel.active, panel.modes, panel.truncated);
  if (panel.active && sixty.state === 'already') {
    lines.push({ parts: [msg('panel.sixty.already')], tone: 'normal' });
  } else if (panel.active && sixty.state === 'offered') {
    lines.push({ parts: [msg('panel.sixty.offered', { size: sizeLabel(panel.active), hz: formatRate(sixty.hz, locale) })], tone: 'normal' });
  } else if (panel.active && sixty.state === 'none') {
    lines.push({ parts: [msg('panel.sixty.none', { size: sizeLabel(panel.active) })], tone: 'normal' });
  }

  if (panel.modes.length > 0) {
    const list = groupModes(panel.modes).map((g) =>
      msg('panel.modeGroup', { size: sizeLabel(g), rates: joinRates(g.rates.map((r) => formatRate(r, locale)), locale) }));
    lines.push({
      parts: [panel.truncated
        ? msg('panel.modes.first', { count: panel.modes.length, list })
        : msg('panel.modes.all', { list })],
      tone: 'muted',
    });
  }
  return lines.length > 0 ? { id: 'panel', label: msg('panel.label'), lines } : null;
}

function cadenceRow(timing: NativeVideoTiming | null, nativeDrops: unknown, locale: string): FactRow | null {
  if (!timing) return null;
  const cadence = cadenceShare(timing);
  const late = isCount(timing.lateFrames) ? timing.lateFrames : null;
  const dropped = isCount(timing.droppedFrames) ? timing.droppedFrames : isCount(nativeDrops) ? nativeDrops : null;
  const gap = isCount(timing.maxSubmitGapMs) ? timing.maxSubmitGapMs : null;

  const parts: Msg[] = [];
  if (cadence) parts.push(msg('cadence.onCadence', { percent: formatPercent(cadence.percent, locale) }));
  if (late !== null) parts.push(msg('cadence.late', { count: formatCount(late, locale) }));
  if (dropped !== null) parts.push(msg('cadence.dropped', { count: formatCount(dropped, locale) }));
  if (gap !== null) parts.push(msg('cadence.maxGap', { ms: formatCount(gap, locale) }));
  if (parts.length === 0) return null;

  const lines: FactLine[] = [{ parts, tone: 'strong' }];
  if (cadence) {
    lines.push({
      parts: [msg('cadence.basis', {
        count: formatCount(cadence.total, locale),
        tolerance: cadence.toleranceMs,
        period: numberFormat(locale, { maximumFractionDigits: 1 }).format(cadence.periodMs),
      })],
      tone: 'muted',
    });
  }
  if (late !== null || dropped !== null) lines.push({ parts: [msg('cadence.terms')], tone: 'muted' });
  return { id: 'cadence', label: msg('cadence.label'), lines };
}

// ── Experiments ─────────────────────────────────────────────────────

const guardReason = (code: string): Msg =>
  (GUARD_REASONS as readonly string[]).includes(code)
    ? msg(`experiments.guardReason.${code}`)
    : msg('experiments.guardReason.other', { code });

const state = (key: string, values?: Record<string, MsgValue>): Msg => msg(`experiments.state.${key}`, values);
const line = (name: ExperimentName, s: Msg): Msg => msg('experiments.line', { name: msg(`experiments.name.${name}`), state: s });

interface ExperimentInput {
  experiments: NativeSessionExperiments | null;
  timing: NativeVideoTiming | null;
  /** `device.sdk`, when the report carries it. */
  sdk: number | null;
  panel: Panel;
  locale: string;
}

/**
 * One line per experiment that is requested for this screen — plus experiment
 * 5 when it has a result to explain after the flag was withdrawn — in plain
 * words, and one note for each the process-wide guard switched off. The wording
 * for every result code is here, in one place, so the test can walk them all.
 */
export function experimentMessages(input: ExperimentInput): { lines: Msg[]; guards: Msg[] } {
  const { experiments, timing, sdk, panel, locale } = input;
  const requested = experiments?.requested ?? {};
  const applied = experiments?.applied;
  const lines: Msg[] = [];
  const guards: Msg[] = [];

  for (const name of EXPERIMENT_ORDER) {
    switch (name) {
      case 'vsyncSnap': {
        if (!requested.vsyncSnap) break;
        if (!applied?.vsyncSnap) { lines.push(line(name, state('requestedNotApplied'))); break; }
        const samples = timing?.vsyncSamples;
        const snapped = timing?.snappedFrames;
        const mean = timing?.snapErrorMeanUs;
        const max = timing?.snapErrorMaxUs;
        const period = timing?.vsyncPeriodUs;
        // "Locked" is the APK's own bar: a grid it trusts (VsyncEstimator.ready) and frames actually snapped to it.
        if ((samples ?? 0) >= VSYNC_LOCK_SAMPLES && (snapped ?? 0) > 0 && mean !== undefined && max !== undefined && period !== undefined && period > 0) {
          lines.push(line(name, state('vsyncLocked', {
            period: numberFormat(locale, { maximumFractionDigits: 2 }).format(period / 1000),
            mean: formatCount(mean, locale),
            max: formatCount(max, locale),
          })));
        } else if (samples !== undefined && samples < VSYNC_LOCK_SAMPLES) {
          lines.push(line(name, state('vsyncWaiting', { samples: formatCount(samples, locale), needed: VSYNC_LOCK_SAMPLES })));
        } else {
          // No measurement at all, or a trusted grid with nothing snapped / no error figure yet.
          lines.push(line(name, state('vsyncNoReport')));
        }
        break;
      }
      case 'prefer60hz': {
        const code = applied?.prefer60hz ?? timing?.preferredModeResult;
        // A result after the flag was withdrawn is still worth a line when it is the revert, or when it failed.
        if (!requested.prefer60hz && code !== 'reverted' && code !== 'failed') break;
        lines.push(line(name, preferredModeState(code, !!requested.prefer60hz, timing, panel, locale)));
        break;
      }
      case 'webviewInvisible': {
        if (!requested.webviewInvisible) break;
        lines.push(line(name, state(applied?.webviewInvisible ? 'requestedApplied' : 'requestedNotApplied')));
        break;
      }
      case 'surfaceFrameRate': {
        if (!requested.surfaceFrameRate) break;
        const code = applied?.surfaceFrameRate;
        if (code === 'only-if-seamless') lines.push(line(name, state('frameRateSent')));
        else if (code === 'refused') lines.push(line(name, state('frameRateRefused')));
        else if (code) lines.push(line(name, state('requestedReported', { code })));
        else if (sdk !== null && sdk < SURFACE_FRAME_RATE_MIN_SDK) lines.push(line(name, state('frameRateNeedsApi')));
        else lines.push(line(name, state('requestedNotApplied')));
        break;
      }
      case 'decoderRotation': {
        // The APK reports no applied flag for it: the page asks for the NATURAL orientation, nothing comes back.
        if (requested.decoderRotation) lines.push(line(name, state('rotationRequested')));
        break;
      }
    }
    if (name !== 'decoderRotation' && requested[name]) {
      const why = experiments?.guard.disabled[name];
      if (why) guards.push(msg('experiments.guardNote', { name: msg(`experiments.name.${name}`), reason: guardReason(why) }));
    }
  }
  return { lines, guards };
}

/** Experiment 5's wording for one result code (`PreferredDisplayMode.RESULT_*`). */
function preferredModeState(
  code: string | undefined,
  requested: boolean,
  timing: NativeVideoTiming | null,
  panel: Panel,
  locale: string,
): Msg {
  if (!code) return state('sixtyPending');
  // The mode id the window was asked for, looked up in the list the panel offered.
  const asked = typeof timing?.preferredModeApplied === 'number' && timing.preferredModeApplied > 0
    ? panel.modes.find((m) => m.id === timing.preferredModeApplied) ?? null
    : null;
  switch (code) {
    case 'applied':
      return asked ? state('sixtyAsked', { mode: modeAt(asked, locale) }) : state('sixtyAskedAny');
    case 'kept':
      return asked ? state('sixtyKept', { mode: modeAt(asked, locale) }) : state('sixtyKeptAny');
    case 'already-60hz':
      return panel.active ? state('sixtyAlreadyAt', { hz: formatRate(panel.active.hz, locale) }) : state('sixtyAlready');
    case 'no-60hz-mode':
      return state('sixtyNoMode');
    case 'no-window':
      return state('sixtyNoWindow');
    case 'other-session':
      return state('sixtyOtherSession');
    case 'failed':
      // `failed` after the flag was withdrawn is the revert that did not take.
      return requested ? state('sixtyFailed') : state('sixtyRevertFailed');
    case 'reverted':
      return state('sixtyReverted');
    default:
      return CODE_RE.test(code) ? state('requestedReported', { code }) : state('sixtyPending');
  }
}

// ── Entry point ─────────────────────────────────────────────────────

/**
 * `Screen.lastVideoReport` → the facts to show, or null when there is nothing
 * to show: no native report, or a native report with none of the fields this
 * section reads (an older player sends the nine scheduling counters only — and
 * those alone still earn the cadence row's late / gap figures).
 */
export function readDisplayFacts(report: unknown, opts: { nowMs: number; locale?: string }): DisplayFacts | null {
  const locale = opts.locale ?? 'en';
  const native = record(report) && record(report.native) ? report.native : null;
  if (!native) return null;

  const timing = readNativeVideoTiming(native.timing) ?? null;
  const device = readNativeDeviceClass(native.device);
  const experiments = readNativeSessionExperiments(native.experiments);

  const panel = resolvePanel(timing, device);
  const rows: FactRow[] = [];
  const panelFacts = panelRow(panel, locale);
  if (panelFacts) rows.push(panelFacts);
  const cadence = cadenceRow(timing, native.drops, locale);
  if (cadence) rows.push(cadence);

  const { lines, guards } = experimentMessages({ experiments, timing, sdk: device?.sdk ?? null, panel, locale });
  if (lines.length > 0) {
    rows.push({
      id: 'experiments',
      label: msg('experiments.label'),
      lines: [
        ...lines.map((l): FactLine => ({ parts: [l], tone: 'normal' })),
        ...guards.map((g): FactLine => ({ parts: [g], tone: 'muted' })),
      ],
    });
  }
  if (typeof timing?.keepScreenOn === 'boolean') {
    rows.push({
      id: 'keepScreenOn',
      label: msg('keepScreenOn.label'),
      lines: [{ parts: [msg(timing.keepScreenOn ? 'keepScreenOn.yes' : 'keepScreenOn.no')], tone: 'normal' }],
    });
  }
  if (rows.length === 0) return null;

  const atMs = typeof native.at === 'string' ? Date.parse(native.at) : NaN;
  const provenance = Number.isFinite(atMs)
    ? msg('provenance.at', { ago: relativeAgo(locale, atMs, opts.nowMs) })
    : msg('provenance.undated');

  const reason = typeof native.reason === 'string' && CODE_RE.test(native.reason) ? native.reason : null;
  const session: Msg | null =
    native.state === 'preparing' ? msg('session.preparing')
    : native.state === 'ready' ? msg('session.ready')
    : native.state === 'failed' ? (reason ? msg('session.stoppedWhy', { reason }) : msg('session.stopped'))
    : null;

  return { title: msg('title'), provenance, session, rows };
}
