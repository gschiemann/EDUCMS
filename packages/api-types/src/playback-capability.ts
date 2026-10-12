/**
 * Playback capability — what a SCREEN can play smoothly, learned from what it
 * actually played (2026-10-11, video guarantee steps 1–4;
 * docs/research/2026-10-11-launch-readiness/02-video-guarantee.md).
 *
 * Owner rule (Greg, 2026-10-11): "If a video is going to stutter, we better
 * keep them from putting that video on the screen. We only want to put what's
 * capable for the device itself." This module is the evidence half of that
 * rule. It is PURE and shared by the API (which folds samples and computes the
 * profile) and the dashboard (which shows it), so the two can never disagree
 * about what "stutters" means — same pattern as `video-encode.ts` and
 * `screen-readiness.ts`.
 *
 * ── What is here, and what is NOT ────────────────────────────────────────
 *   • `gradePlaybackSample` — the ONE definition of smooth / hitching /
 *     stuttering for a single ~60 s player sample (moved here from the
 *     dashboard's screenOps.ts, which now re-imports it).
 *   • `isSettledSample` + `foldPlaybackSample` — turning a stream of samples
 *     into one per-(screen, file) record with a verdict. Only SETTLED samples
 *     (a full minute of frames, played from the verified cache, not the first
 *     stretch after activation) are decode evidence. An uncached sample that
 *     paused to buffer is a DELIVERY problem and never counts as stutter.
 *   • `playbackDeviceClass` + `PLAYBACK_CLASS_DEFAULTS` — the device-class key
 *     and the small reviewed table seeded from the 2026-10-11 fleet evidence.
 *   • `computePlaybackCapability` — the profile, by precedence:
 *       measured on this screen → measured on the same model → declared by the
 *       WebView → class default → unknown.
 *   • `decidePlayback` + `unitConcurrentVideos` — the per-screen decision a
 *     future publish gate will use. NOTHING CALLS `decidePlayback` TO CHANGE
 *     BEHAVIOUR YET: steps 5–8 (gate, demotion) ship deliberately, behind a
 *     flag, with the owner's sign-off (Player Reliability rule 12).
 *
 * ── Emergency content is never evaluated here ─────────────────────────────
 * No emergency code path may import this module; an alert is never refused,
 * delayed or rewritten on a telemetry inference (CLAUDE.md, Emergency WARNING;
 * Player Reliability rules 11 and 16). An API spec enforces the import rule.
 *
 * ── Copy states what the evidence proves (Player Reliability rule 10) ─────
 * Every verdict here is "what the player measured", never "what the glass
 * looked like" — no camera sees the panel.
 */

// ── Per-sample grading (moved from apps/web screenOps.ts, unchanged) ───────

/** Below this many frames a sample says nothing reliable (5 s at 30 fps). */
export const PLAYBACK_SAMPLE_MIN_FRAMES = 150;
/** Dropped-frame share thresholds. Under 1% is invisible; over 5% is what an operator calls choppy. */
export const PLAYBACK_HITCHING_PCT = 1;
export const PLAYBACK_STUTTERING_PCT = 5;
/**
 * Rebuffer thresholds. A pause to buffer is a FREEZE on the glass, which no
 * dropped-frame share can express. Pauses adding up to a second or more are at
 * least a hitch; three pauses, or five seconds spent waiting, are a stutter.
 */
export const PLAYBACK_STALL_HITCHING_MS = 1_000;
export const PLAYBACK_STALL_STUTTERING_COUNT = 3;
export const PLAYBACK_STALL_STUTTERING_MS = 5_000;

export type PlaybackSampleGrade = 'smooth' | 'hitching' | 'stuttering' | 'short';

export interface PlaybackSampleCounters {
  totalFrames: number;
  droppedFrames: number;
  /** Rebuffer pauses; absent/null = "not counted" (never "none"). */
  stalls?: number | null;
  stalledMs?: number | null;
}

const nonNegInt = (n: unknown): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;

/** Dropped share, one decimal, 0 for an empty sample. */
export function droppedPercent(total: number, dropped: number): number {
  if (!(total > 0)) return 0;
  return Math.round((Math.min(dropped, total) / total) * 1000) / 10;
}

/**
 * One sample → one grade. Pauses grade the sample whatever its dropped-frame
 * share; a pause needs no frame floor to be believed, so it lifts "too short
 * to judge" as well. Waiting time with no pause behind it is incoherent (the
 * player never sends it) and is ignored.
 */
export function gradePlaybackSample(s: PlaybackSampleCounters): PlaybackSampleGrade {
  const total = nonNegInt(s.totalFrames) ?? 0;
  const dropped = Math.min(total, nonNegInt(s.droppedFrames) ?? 0);
  const pct = droppedPercent(total, dropped);
  let grade: PlaybackSampleGrade;
  if (total < PLAYBACK_SAMPLE_MIN_FRAMES) grade = 'short';
  else if (pct >= PLAYBACK_STUTTERING_PCT) grade = 'stuttering';
  else if (pct >= PLAYBACK_HITCHING_PCT) grade = 'hitching';
  else grade = 'smooth';
  const stalls = nonNegInt(s.stalls) ?? 0;
  const waitedMs = stalls > 0 ? nonNegInt(s.stalledMs) ?? 0 : 0;
  if (stalls >= PLAYBACK_STALL_STUTTERING_COUNT || waitedMs >= PLAYBACK_STALL_STUTTERING_MS) {
    grade = 'stuttering';
  } else if (stalls >= 1 && waitedMs >= PLAYBACK_STALL_HITCHING_MS && (grade === 'smooth' || grade === 'short')) {
    grade = 'hitching';
  }
  return grade;
}

// ── Settled samples + the per-(screen, file) record ────────────────────────

/** A sample must cover at least this many frames to be decode evidence (~50 s at 30 fps). */
export const SETTLED_MIN_FRAMES = 1_500;
/** Consecutive settled samples that make a verdict. */
export const VERDICT_STREAK = 3;

/** Playback engines the web player reports (`videoQuality.ts`). */
export const PLAYBACK_ENGINES = ['native', 'continuous', 'twodeck', 'deck'] as const;
export type PlaybackEngine = (typeof PLAYBACK_ENGINES)[number];

/** One sample as the API stores it — the telemetry `video` block, sanitized. */
export interface PlaybackSampleInput extends PlaybackSampleCounters {
  width?: number | null;
  height?: number | null;
  /** Played from the verified offline cache. Absent = the player could not say. */
  cached?: boolean | null;
  /** The first report after the clip went on glass (time-to-first-frame, warm-up). */
  first?: boolean | null;
  /** Videos decoding at once in the reporting document at report time. */
  concurrent?: number | null;
  engine?: string | null;
}

/**
 * Is this sample decode evidence? A full minute of frames, not the first
 * stretch after activation, and played from the cache — or, when the player
 * could not say whether it was cached, a sample with no pause to buffer at all
 * (a stall on an unknown-cache sample may be the network, so it never counts).
 * `cached === false` never counts: whatever happened was delivery.
 */
export function isSettledSample(s: PlaybackSampleInput): boolean {
  const total = nonNegInt(s.totalFrames) ?? 0;
  if (total < SETTLED_MIN_FRAMES) return false;
  if (s.first === true) return false;
  if (s.cached === true) return true;
  if (s.cached === false) return false;
  return (nonNegInt(s.stalls) ?? 0) === 0;
}

export type FilePlaybackVerdict = 'smooth' | 'hitching' | 'stuttering' | 'insufficient';

/** The per-(screen, file) record. Mirrors `screen_file_playback`; counts are plain numbers. */
export interface FilePlaybackRecord {
  samples: number;
  settledSamples: number;
  /** Settled samples only. */
  frames: number;
  dropped: number;
  stalls: number;
  stalledMs: number;
  consecutiveGood: number;
  consecutiveBad: number;
  /** Worst settled dropped share, %. */
  worstPct: number | null;
  /** The most recent sample's dropped share, settled or not. */
  lastPct: number | null;
  lastGrade: PlaybackSampleGrade | null;
  lastSettled: boolean;
  width: number | null;
  height: number | null;
  engine: string | null;
  concurrentMax: number;
  unitConcurrentMax: number;
  verdict: FilePlaybackVerdict;
}

export const EMPTY_FILE_PLAYBACK: Readonly<FilePlaybackRecord> = Object.freeze({
  samples: 0,
  settledSamples: 0,
  frames: 0,
  dropped: 0,
  stalls: 0,
  stalledMs: 0,
  consecutiveGood: 0,
  consecutiveBad: 0,
  worstPct: null,
  lastPct: null,
  lastGrade: null,
  lastSettled: false,
  width: null,
  height: null,
  engine: null,
  concurrentMax: 1,
  unitConcurrentMax: 1,
  verdict: 'insufficient',
});

/**
 * The verdict from a record's counters:
 *   ≥ 3 stuttering settled samples in a row → stuttering
 *   ≥ 3 smooth settled samples in a row     → smooth
 *   fewer than 3 settled samples            → insufficient
 *   otherwise, the settled aggregate's share (a mixed history is graded on
 *   the whole, so one 1.2 % minute after fifty clean ones does not flip it).
 */
export function filePlaybackVerdict(r: Pick<FilePlaybackRecord,
  'settledSamples' | 'frames' | 'dropped' | 'consecutiveGood' | 'consecutiveBad'>): FilePlaybackVerdict {
  if (r.consecutiveBad >= VERDICT_STREAK) return 'stuttering';
  if (r.consecutiveGood >= VERDICT_STREAK) return 'smooth';
  if (r.settledSamples < VERDICT_STREAK) return 'insufficient';
  const pct = droppedPercent(r.frames, r.dropped);
  if (pct >= PLAYBACK_STUTTERING_PCT) return 'stuttering';
  if (pct >= PLAYBACK_HITCHING_PCT) return 'hitching';
  return 'smooth';
}

const clampConcurrent = (n: unknown): number | null => {
  const v = nonNegInt(n);
  return v === null ? null : Math.min(Math.max(v, 1), 16);
};

/**
 * Fold one sample into the record. Pure: returns a new record. `unitConcurrent`
 * is the server's count of videos decoding across the faces of the physical
 * unit at that moment (this face's own count plus siblings that reported video
 * in the last few minutes) — never less than the face's own count.
 */
export function foldPlaybackSample(
  prev: Readonly<FilePlaybackRecord> | null,
  sample: PlaybackSampleInput,
  opts: { unitConcurrent?: number | null } = {},
): FilePlaybackRecord {
  const p = prev ?? EMPTY_FILE_PLAYBACK;
  const total = nonNegInt(sample.totalFrames) ?? 0;
  const dropped = Math.min(total, nonNegInt(sample.droppedFrames) ?? 0);
  const pct = droppedPercent(total, dropped);
  const grade = gradePlaybackSample(sample);
  const settled = isSettledSample(sample);
  const concurrent = clampConcurrent(sample.concurrent);
  const unit = Math.max(clampConcurrent(opts.unitConcurrent) ?? 1, concurrent ?? 1);
  const w = nonNegInt(sample.width);
  const h = nonNegInt(sample.height);
  const next: FilePlaybackRecord = {
    ...p,
    samples: p.samples + 1,
    lastPct: total > 0 ? pct : p.lastPct,
    lastGrade: grade,
    lastSettled: settled,
    width: w && h ? w : p.width,
    height: w && h ? h : p.height,
    engine: typeof sample.engine === 'string' && sample.engine ? sample.engine : p.engine,
    concurrentMax: Math.max(p.concurrentMax, concurrent ?? 1),
    unitConcurrentMax: Math.max(p.unitConcurrentMax, unit),
  };
  if (settled) {
    next.settledSamples = p.settledSamples + 1;
    next.frames = p.frames + total;
    next.dropped = p.dropped + dropped;
    next.stalls = p.stalls + (nonNegInt(sample.stalls) ?? 0);
    next.stalledMs = p.stalledMs + (nonNegInt(sample.stalledMs) ?? 0);
    next.worstPct = p.worstPct === null ? pct : Math.max(p.worstPct, pct);
    next.consecutiveGood = grade === 'smooth' ? p.consecutiveGood + 1 : 0;
    next.consecutiveBad = grade === 'stuttering' ? p.consecutiveBad + 1 : 0;
  }
  next.verdict = filePlaybackVerdict(next);
  return next;
}

// ── Device class ───────────────────────────────────────────────────────────

/** The `build` block of `Screen.displayCapabilities` (DisplayCapabilityProbe). */
export interface PlaybackBuildInfo {
  manufacturer?: unknown;
  model?: unknown;
  device?: unknown;
  board?: unknown;
  sdk?: unknown;
}

const classPart = (v: unknown): string =>
  typeof v === 'string' ? v.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) : '';

/**
 * `${manufacturer}/${model}/${device}/sdk${sdk}`, normalised, or null when the
 * screen never reported a model. The model is the reliable key in this fleet
 * (`hardwareModel` reads `generic-android` for nearly every unit).
 */
export function playbackDeviceClass(build: PlaybackBuildInfo | null | undefined): string | null {
  if (!build || typeof build !== 'object') return null;
  const model = classPart(build.model);
  if (!model) return null;
  const sdkN = typeof build.sdk === 'number' && Number.isFinite(build.sdk) ? Math.floor(build.sdk) : null;
  return [classPart(build.manufacturer) || 'unknown', model, classPart(build.device) || 'unknown', sdkN !== null ? `sdk${sdkN}` : 'sdk?']
    .join('/')
    .slice(0, 160);
}

export interface PlaybackClassDefault {
  /** Human name for the table row (never shown as a claim). */
  label: string;
  /** Matched against the normalised `model` (and `device`) segments. */
  match: RegExp;
  maxShortEdge: 1080 | 2160;
  maxUnitConcurrentVideos: number | null;
}

/**
 * The reviewed class table, seeded from the 2026-10-11 fleet evidence (design
 * §2.2 / §4.2 item 4). Measured evidence always outranks it. GUQ M75 is NOT
 * here on purpose: it has never reported, and inherits the GUQ row only after
 * its on-glass check (design §6 Step 9).
 */
export const PLAYBACK_CLASS_DEFAULTS: readonly PlaybackClassDefault[] = Object.freeze([
  // Goodview GUQ M43/M55/M65/M86 (Droidlogic T982, Android 11): 4K30 single video measured smooth.
  { label: 'Goodview GUQ (M43/M55/M65/M86)', match: /(^|\/)m(43|55|65|86)guq/, maxShortEdge: 2160, maxUnitConcurrentVideos: 1 },
  { label: 'MAXHUB L55VEC', match: /(^|\/)l55vec/, maxShortEdge: 2160, maxUnitConcurrentVideos: null },
  { label: 'Amlogic T982 (t982_ar301)', match: /(^|\/)t982_ar301/, maxShortEdge: 2160, maxUnitConcurrentVideos: null },
  // rk3288 (Android 7.1.2): 1080p30 single video smooth; two at once (double-sided) 38–55 % dropped.
  { label: 'Rockchip rk3288', match: /(^|\/)rk3288/, maxShortEdge: 1080, maxUnitConcurrentVideos: 1 },
  { label: 'Goodview X80', match: /(^|\/)x80($|\/)/, maxShortEdge: 1080, maxUnitConcurrentVideos: null },
  // NovaStar Taurus (rk356x_box): no video evidence yet; 1080p panels only.
  { label: 'NovaStar Taurus (rk356x_box)', match: /(^|\/)rk356x_box/, maxShortEdge: 1080, maxUnitConcurrentVideos: null },
]);

/** The class-default row for a device class, or null. Matches model or device segment. */
export function playbackClassDefault(deviceClass: string | null | undefined): PlaybackClassDefault | null {
  if (!deviceClass) return null;
  const [, model = '', device = ''] = deviceClass.split('/');
  for (const row of PLAYBACK_CLASS_DEFAULTS) {
    if (row.match.test(model) || row.match.test(device)) return row;
  }
  return null;
}

// ── Declared capability (WebView MediaCapabilities) ─────────────────────────

/** The four canonical configs the web player asks `decodingInfo` about. */
export const MEDIA_CAPS_CONFIGS = ['1080p30-landscape', '1080p30-portrait', '2160p30-landscape', '2160p30-portrait'] as const;
export type MediaCapsConfigId = (typeof MEDIA_CAPS_CONFIGS)[number];

export interface MediaCapsEntry {
  id: MediaCapsConfigId;
  supported: boolean;
  smooth: boolean;
  powerEfficient: boolean;
}

export interface MediaCapsReport {
  webviewMajor?: number | null;
  configs: MediaCapsEntry[];
}

/**
 * The largest short edge the WebView declares SMOOTH, or null. Declared facts
 * are optimistic (Android says `maxSupportedInstances` 16–32 on SoCs that
 * cannot run two 1080p decodes through WebView), so they can raise an unknown
 * screen, never override measurement, and never speak to concurrency.
 */
export function declaredMaxShortEdge(report: MediaCapsReport | null | undefined): 1080 | 2160 | null {
  if (!report || !Array.isArray(report.configs)) return null;
  const ok = (prefix: string) => report.configs.some((c) => c && typeof c.id === 'string' && c.id.startsWith(prefix) && c.supported === true && c.smooth === true);
  if (ok('2160p30')) return 2160;
  if (ok('1080p30')) return 1080;
  return null;
}

// ── The capability profile ─────────────────────────────────────────────────

export type PlaybackEvidence = 'measured-screen' | 'measured-class' | 'declared' | 'class-default' | 'unknown';

const EVIDENCE_RANK: Record<PlaybackEvidence, number> = {
  'measured-screen': 0,
  'measured-class': 1,
  declared: 2,
  'class-default': 3,
  unknown: 4,
};

/** Class evidence counts only when this many distinct OTHER screens contribute. */
export const CLASS_EVIDENCE_MIN_SCREENS = 2;

/** One stored record, as the profile reads it. */
export interface CapabilityRecordInput {
  screenId: string;
  width: number | null;
  height: number | null;
  verdict: FilePlaybackVerdict;
  unitConcurrentMax: number;
  lastAt: string | Date;
  playerVersionCode?: number | null;
  webviewMajor?: number | null;
}

export interface PlaybackCapability {
  deviceClass: string | null;
  /** Largest short edge proven/declared smooth (1080 or 2160), or null when nothing says. */
  maxShortEdge: 1080 | 2160 | null;
  /** Smallest short edge MEASURED stuttering with a single video, or null. */
  stuttersAtShortEdge: number | null;
  /** 30 for every class today (delivered video is ≤ 30 fps); null when unknown. */
  maxFps: number | null;
  /** Videos the physical unit plays smoothly at once, or null when unknown. */
  maxUnitConcurrentVideos: number | null;
  /** Where `maxShortEdge` / `stuttersAtShortEdge` came from. */
  evidence: PlaybackEvidence;
  /** Where `maxUnitConcurrentVideos` came from. */
  concurrencyEvidence: PlaybackEvidence;
  /** Newest evidence behind the headline, ISO, or null. */
  evidenceAt: string | null;
  /** Distinct other screens of the same model behind measured-class evidence. */
  classScreens: number;
  /**
   * The screen's own measurement predates its current player / WebView. Stale
   * evidence STILL decides (never reset to unknown — that would flap a working
   * fleet on every OTA); a later step re-verifies it.
   */
  stale: boolean;
}

/** 1080 or 2160 rung for a short edge. */
export function shortEdgeTier(shortEdge: number): 1080 | 2160 {
  return shortEdge > 1080 ? 2160 : 1080;
}

const shortEdgeOf = (r: { width: number | null; height: number | null }): number | null =>
  r.width && r.height && r.width > 0 && r.height > 0 ? Math.min(r.width, r.height) : null;

const iso = (v: string | Date): string | null => {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
};

interface Measured {
  smoothShortEdge: number | null;
  stuttersAt: number | null;
  maxUnit: number | null;
  at: string | null;
}

/** What a set of records proves. Proof of a shape covers every smaller shape at the same concurrency. */
function measure(records: readonly CapabilityRecordInput[]): Measured {
  let smoothShortEdge: number | null = null;
  let stuttersAt: number | null = null;
  let smoothMulti: number | null = null;
  let badMulti = false;
  let at: string | null = null;
  for (const r of records) {
    if (r.verdict !== 'smooth' && r.verdict !== 'stuttering') continue;
    const se = shortEdgeOf(r);
    const unit = Math.max(1, Math.floor(r.unitConcurrentMax || 1));
    const t = iso(r.lastAt);
    if (t && (!at || t > at)) at = t;
    if (r.verdict === 'smooth') {
      if (unit <= 1) {
        if (se !== null) smoothShortEdge = Math.max(smoothShortEdge ?? 0, se);
      } else {
        smoothMulti = Math.max(smoothMulti ?? 0, unit);
        // Smooth with company proves smooth alone too.
        if (se !== null) smoothShortEdge = Math.max(smoothShortEdge ?? 0, se);
      }
    } else if (unit <= 1) {
      if (se !== null) stuttersAt = Math.min(stuttersAt ?? Infinity, se);
    } else {
      badMulti = true;
    }
  }
  return {
    smoothShortEdge,
    stuttersAt,
    maxUnit: smoothMulti ?? (badMulti ? 1 : null),
    at,
  };
}

export interface CapabilityInput {
  deviceClass: string | null;
  /** This screen's own records. */
  screenRecords: readonly CapabilityRecordInput[];
  /** Records from OTHER screens of the same device class (any tenant; only aggregates leave). */
  classRecords?: readonly CapabilityRecordInput[];
  declared?: MediaCapsReport | null;
  /** The screen's current player identity, to mark its own evidence stale. */
  current?: { playerVersionCode?: number | null; webviewMajor?: number | null };
}

/**
 * The profile. Each fact is taken from the most authoritative source that has
 * it: measured on this screen → measured on its model (≥ 2 other screens) →
 * declared by its WebView (size only) → the class table → unknown. A measured
 * stutter caps anything a LESS authoritative source claims; a smooth result on
 * this very screen is not overruled by its model's stutter elsewhere.
 */
export function computePlaybackCapability(input: CapabilityInput): PlaybackCapability {
  const own = measure(input.screenRecords);
  const classRecs = (input.classRecords ?? []).filter((r) => r.verdict === 'smooth' || r.verdict === 'stuttering');
  const classScreens = new Set(classRecs.map((r) => r.screenId)).size;
  const cls: Measured = classScreens >= CLASS_EVIDENCE_MIN_SCREENS ? measure(classRecs) : { smoothShortEdge: null, stuttersAt: null, maxUnit: null, at: null };
  const declared = declaredMaxShortEdge(input.declared ?? null);
  const def = playbackClassDefault(input.deviceClass);

  // Size: first source that has a smooth answer.
  const sizeCandidates: Array<{ value: 1080 | 2160; source: PlaybackEvidence; at: string | null }> = [];
  if (own.smoothShortEdge !== null) sizeCandidates.push({ value: shortEdgeTier(own.smoothShortEdge), source: 'measured-screen', at: own.at });
  if (cls.smoothShortEdge !== null) sizeCandidates.push({ value: shortEdgeTier(cls.smoothShortEdge), source: 'measured-class', at: cls.at });
  if (declared !== null) sizeCandidates.push({ value: declared, source: 'declared', at: null });
  if (def) sizeCandidates.push({ value: def.maxShortEdge, source: 'class-default', at: null });
  const pick = sizeCandidates[0] ?? null;

  // A measured stutter (this screen first, then its model).
  const stutter =
    own.stuttersAt !== null ? { value: own.stuttersAt, source: 'measured-screen' as const, at: own.at }
    : cls.stuttersAt !== null ? { value: cls.stuttersAt, source: 'measured-class' as const, at: cls.at }
    : null;

  let maxShortEdge: 1080 | 2160 | null = pick?.value ?? null;
  let evidence: PlaybackEvidence = pick?.source ?? 'unknown';
  let evidenceAt: string | null = pick?.at ?? null;
  let stuttersAtShortEdge: number | null = null;
  if (stutter) {
    const outranks = !pick || EVIDENCE_RANK[stutter.source] <= EVIDENCE_RANK[pick.source];
    if (outranks) {
      stuttersAtShortEdge = stutter.value;
      if (maxShortEdge === null || stutter.value <= maxShortEdge) {
        // Smooth only BELOW the stutter: 2160 bad → 1080 (if anything said ≥ 1080), 1080 bad → nothing.
        maxShortEdge = stutter.value > 1080 && pick ? 1080 : null;
        evidence = stutter.source;
        evidenceAt = stutter.at;
      }
    }
  }

  // Concurrency: measured only (declared never establishes it), then the table.
  let maxUnitConcurrentVideos: number | null = null;
  let concurrencyEvidence: PlaybackEvidence = 'unknown';
  if (own.maxUnit !== null) {
    maxUnitConcurrentVideos = own.maxUnit;
    concurrencyEvidence = 'measured-screen';
  } else if (cls.maxUnit !== null) {
    maxUnitConcurrentVideos = cls.maxUnit;
    concurrencyEvidence = 'measured-class';
  } else if (def && def.maxUnitConcurrentVideos !== null) {
    maxUnitConcurrentVideos = def.maxUnitConcurrentVideos;
    concurrencyEvidence = 'class-default';
  }

  const cur = input.current ?? {};
  const stale = input.screenRecords.some((r) =>
    (r.verdict === 'smooth' || r.verdict === 'stuttering') && (
      (cur.playerVersionCode != null && r.playerVersionCode != null && r.playerVersionCode !== cur.playerVersionCode) ||
      (cur.webviewMajor != null && r.webviewMajor != null && r.webviewMajor !== cur.webviewMajor)
    ));

  return {
    deviceClass: input.deviceClass,
    maxShortEdge,
    stuttersAtShortEdge,
    maxFps: maxShortEdge !== null || def ? 30 : null,
    maxUnitConcurrentVideos,
    evidence,
    concurrencyEvidence,
    evidenceAt,
    classScreens: cls.at !== null ? classScreens : 0,
    stale: stale && (evidence === 'measured-screen' || concurrencyEvidence === 'measured-screen'),
  };
}

// ── Demand + decision (pure; NOT wired to any publish path yet) ────────────

/** One face of a physical unit, as the publish/manifest path will describe it. */
export interface FaceVideoDemand {
  /** VIDEO zones in the face's template. */
  videoZones: number;
  /** The face's playlist plays a video. */
  playlistVideo: boolean;
  /** Two video items sit next to each other (the hidden next-up pre-mount decodes too). */
  adjacentVideoItems: boolean;
}

/** Videos one face decodes at once. */
export function faceConcurrentVideos(f: FaceVideoDemand): number {
  const zones = Math.max(0, Math.floor(f.videoZones || 0));
  const playlist = f.playlistVideo ? 1 + (f.adjacentVideoItems ? 1 : 0) : 0;
  return zones + playlist;
}

/**
 * Videos the physical unit decodes at once: the sum over its faces. A MIRROR
 * face plays the primary's content, so it is passed in with the primary's
 * demand — on a double-sided unit a mirrored video is TWO decodes, which is
 * exactly the DH43 failure (38–55 % dropped with video on both faces).
 */
export function unitConcurrentVideos(faces: readonly FaceVideoDemand[]): number {
  return faces.reduce((n, f) => n + faceConcurrentVideos(f), 0);
}

export interface PlaybackDemand {
  shortEdge: number;
  longEdge: number;
  fps: number | null;
  /** The panel's short edge (a ≤ 1080 panel follows today's 1080p-copy rule when nothing is known). */
  panelShortEdge: number | null;
  unitConcurrentVideos: number;
}

export type PlaybackDecision =
  | { kind: 'play-native' }
  | { kind: 'play-1080p'; needsCopy: boolean }
  | { kind: 'cannot-play'; reason: 'concurrency' | 'measured-stutter' | 'over-capability'; detail: { max?: number; demand?: number } }
  | { kind: 'unverified' };

/**
 * What one screen should get for one video. Unknown NEVER blocks: an unknown
 * ≤ 1080 panel follows today's rule (1080p copy), anything else plays the file
 * with the closed loop watching (`unverified`). Two rungs only — native and the
 * existing 1080p copy; encode variants were proven not to fix concurrency.
 */
export function decidePlayback(
  cap: PlaybackCapability,
  demand: PlaybackDemand,
  file: { has1080p: boolean },
): PlaybackDecision {
  const unit = Math.max(1, Math.floor(demand.unitConcurrentVideos || 1));
  if (cap.maxUnitConcurrentVideos !== null && unit > cap.maxUnitConcurrentVideos) {
    // A lighter copy does not fix this (field trials 2026-10-08/09).
    return { kind: 'cannot-play', reason: 'concurrency', detail: { max: cap.maxUnitConcurrentVideos, demand: unit } };
  }
  if (cap.maxFps !== null && demand.fps !== null && demand.fps > cap.maxFps + 0.5) {
    return { kind: 'cannot-play', reason: 'over-capability', detail: { max: cap.maxFps, demand: demand.fps } };
  }
  const se = demand.shortEdge;
  const lighter = (): PlaybackDecision => ({ kind: 'play-1080p', needsCopy: !file.has1080p });
  if (cap.stuttersAtShortEdge !== null && se >= cap.stuttersAtShortEdge) {
    if (se > 1080 && cap.stuttersAtShortEdge > 1080) return lighter();
    return { kind: 'cannot-play', reason: 'measured-stutter', detail: { demand: se } };
  }
  if (cap.maxShortEdge === null) {
    if (demand.panelShortEdge !== null && demand.panelShortEdge <= 1080 && se > 1080) return lighter();
    return { kind: 'unverified' };
  }
  if (se <= cap.maxShortEdge) return { kind: 'play-native' };
  return lighter();
}

// ── Dashboard summary ──────────────────────────────────────────────────────

export type ScreenPlaybackSummary = 'smooth' | 'hitches' | 'stutters' | 'unknown';

/**
 * The one-word answer for a screen across the files it has played: "stutters"
 * when any file's verdict is stuttering, "hitches" when the worst is a mixed
 * 1–5 % history, "smooth" when every settled file is smooth, else "unknown"
 * (nothing settled yet).
 */
export function summarizeScreenPlayback(verdicts: readonly FilePlaybackVerdict[]): ScreenPlaybackSummary {
  if (verdicts.includes('stuttering')) return 'stutters';
  if (verdicts.includes('hitching')) return 'hitches';
  if (verdicts.includes('smooth')) return 'smooth';
  return 'unknown';
}
