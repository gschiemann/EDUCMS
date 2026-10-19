import { gradeNativeEnd } from "./nativeEndReasons";

/** Optional, explicitly scoped renderer. Identity goes to native; URLs and tokens never do. */
export interface NativeSharedVideoDescriptor {
  version: 1;
  screenId: string;
  tenantId: string;
  primaryScreenId: string;
  peerScreenId: string;
  faceIndex: number;
  revision: string;
  asset: {
    id: string;
    url: string;
    sha256: string;
    size: number;
    width: number;
    height: number;
    fps: number;
  };
  transform: {
    orientation: "PORTRAIT" | "LANDSCAPE" | "AUTO";
    rotation: 0 | 90 | 180 | 270;
    /** "fill" for every native host shipped so far; "cover" only once both faces run the APK that crops (API: nativeSharedVideoFit). */
    fit: "fill" | "cover";
  };
}

export interface NativeSharedVideoState {
  version: 1;
  state: "idle" | "preparing" | "ready" | "presenting" | "failed";
  sessionId: string;
  revision: string;
  sha256: string;
  faceIndex: number;
  reason?: string;
  /** Actual active session, distinct from the APK's advertised protocol maximum. */
  sessionProtocol?: 2 | 3;
  output?: {
    attached: boolean;
    visible: boolean;
    viewUpdates: number;
    uniqueFrames: number;
    sourcePtsUs: number;
    width: number;
    height: number;
    lastUpdateElapsedMs: number;
    hardwareAccelerated: boolean;
    ageMs: number;
    layerMode?: "under_window" | "queued" | "revealing" | "above_window" | "retired";
    compositionMode?: "under_window" | "dynamic_above" | "static_above";
  };
  codecName?: string;
  elapsedMs?: number;
  stalls?: number;
  loops?: number;
  /** Decoder scheduling diagnostics; submitted frames are not display proof. */
  timing?: NativeVideoTiming;
  /**
   * 1.1.41 — the device class the APK resolved itself into and what that
   * class does (DeviceClassPolicy.kt), bounded; the dashboard shows it.
   */
  device?: NativeDeviceClass;
  /** 1.1.41 — the M43 experiments requested for this session, which were applied, and the fault guard. */
  experiments?: NativeSessionExperiments;
  /** Protocol 3 telemetry (nativeZones.ts): native's late-frame drops, the
   *  protocol the APK answered, and one bounded row per live slot. Sent only
   *  while the API accepts the video extras (same back-off as `video`). */
  drops?: number;
  protocol?: 1 | 2 | 3;
  zones?: Array<{
    slot: string;
    state: "preparing" | "ready" | "presenting" | "failed";
    held?: boolean;
    ended?: boolean;
    reason?: string;
    codecName?: string;
    uniqueFrames?: number;
    drops?: number;
    loops?: number;
    elapsedMs?: number;
    width?: number;
    height?: number;
  }>;
}

/**
 * The native `timing` block. The nine scheduling counters are what every APK
 * since 1.1.30 sends; everything after them is 1.1.41's glass-side
 * measurement (plan 2026-10-17 §4E, Astra STAB-01): the render-callback
 * interval histogram (16 buckets centred on k × P/4 — bucket 4 is the source
 * frame period ± P/8), the display the surface lands on, the decoder's own
 * drops, and the persisted history of recent sessions with its overflow
 * count. Every field optional: an older APK never sends them.
 */
export interface NativeVideoTiming {
  decodedFrames: number; submittedFrames: number; lateFrames: number;
  lastLateUs: number; maxLateUs: number; maxSubmitGapMs: number; leadUs: number;
  sourceWidth: number; sourceHeight: number;
  droppedFrames?: number;
  sourceFps?: number;
  refreshRate?: number;
  /** `modeId:WxH@Hz` of the current Display.Mode. */
  displayMode?: string;
  intervalUnitNs?: number;
  /** Exactly 16 counts. */
  intervalBuckets?: number[];
  intervalCount?: number;
  intervalMinNs?: number;
  intervalMaxNs?: number;
  intervalLastNs?: number;
  intervalMeanNs?: number;
  /** 1.1.42 (plan §4E, pacing) — experiment 4's vsync snap: frames snapped, the snap error (max / mean, µs),
   *  the cumulative SIGNED media-clock slew (the measured drift between the clip's clock and the panel's vsync),
   *  the grid (period µs, samples). */
  snappedFrames?: number;
  snapErrorMaxUs?: number;
  snapErrorMeanUs?: number;
  clockSlewUs?: number;
  vsyncPeriodUs?: number;
  vsyncSamples?: number;
  /** 1.1.43 — the grid-sized release lead (µs) the session ran with: 0.8 P on a 30 Hz grid, 0.5 P on 60 Hz. */
  releaseLeadUs?: number;
  /** 1.1.42 — every mode the panel offers (`modeId:WxH@Hz`, ≤ 16, read when the session attached), and experiment 5's request. */
  supportedModes?: string[];
  preferredModeApplied?: number;
  preferredModeResult?: string;
  /** 1.1.42 — whether the face's window held FLAG_KEEP_SCREEN_ON at the last watch tick. */
  keepScreenOn?: boolean;
  history?: { entries: NativeTimingHistoryEntry[]; overflow: number; capacity?: number };
}

/** One completed (or recovered) session's summary from the APK's persisted ledger. */
export interface NativeTimingHistoryEntry {
  at: number;
  /** 1.1.42: experiments 4 / 5 on that session, and the pacing measurement. */
  vsyncSnap?: boolean;
  prefer60hz?: string;
  snappedFrames?: number;
  snapErrorMaxUs?: number;
  snapErrorMeanUs?: number;
  clockSlewUs?: number;
  vsyncPeriodUs?: number;
  vsyncSamples?: number;
  releaseLeadUs?: number;
  preferredModeApplied?: number;
  keepScreenOn?: boolean;
  uptimeMs?: number;
  face?: number;
  sha8?: string;
  build?: string;
  protocol?: 2 | 3;
  composition?: "dynamic_above" | "static_above";
  layer?: "under_window" | "queued" | "revealing" | "above_window" | "retired";
  reason?: string;
  recovered?: boolean;
  /** Android's BOOT_COUNT when the entry was written: a recovered entry whose count differs from the current boot died with the device, not just the process. */
  bootCount?: number;
  elapsedMs?: number;
  fps?: number;
  refreshRate?: number;
  displayMode?: string;
  decodedFrames?: number;
  submittedFrames?: number;
  lateFrames?: number;
  maxLateUs?: number;
  maxSubmitGapMs?: number;
  droppedFrames?: number;
  loops?: number;
  uniqueFrames?: number;
  codecName?: string;
  webviewInvisible?: boolean;
  surfaceFrameRate?: string;
  intervalUnitNs?: number;
  intervalBuckets?: number[];
  intervalCount?: number;
  intervalMinNs?: number;
  intervalMaxNs?: number;
  intervalLastNs?: number;
  intervalMeanNs?: number;
}

export interface NativeDeviceClass {
  /** `<soc>/android-<N>`, derived by the APK from its Build strings. */
  class: string;
  /** The plan §2 fleet class label, when the box is one we know. */
  fleet?: string;
  soc: "amlogic" | "rockchip" | "novastar" | "other";
  sdk: number;
  webviewMajor: number;
  nativeSolo: boolean;
  composition?: "dynamic_above" | "static_above";
  protocol3: boolean;
  /** Two values only (owner 2026-10-17: the Manager is never device owner). */
  silentUpdate: "installer-of-record" | "tap";
  qualified?: string;
  /** 1.1.42 — what the default display runs and offers, read live on every reply. */
  refreshRate?: number;
  activeMode?: string;
  supportedModes?: string[];
  /** 1.1.43 — what the panel FIRMWARE lists (sysfs, read-only, bounded): the mode in force and the capability table. */
  sysDisplayMode?: string;
  sysDisplayCaps?: string[];
}

export interface NativeExperimentFlags {
  webviewInvisible?: true;
  surfaceFrameRate?: true;
  decoderRotation?: true;
  /** 1.1.42: vsync-snapped release, and the same-resolution ~60 Hz mode request. */
  vsyncSnap?: true;
  prefer60hz?: true;
}

type GuardedExperiment = "webviewInvisible" | "surfaceFrameRate" | "vsyncSnap" | "prefer60hz";
export interface NativeSessionExperiments {
  requested: NativeExperimentFlags;
  applied: { webviewInvisible: boolean; surfaceFrameRate?: string; vsyncSnap?: boolean; prefer60hz?: string };
  guard: { disabled: Partial<Record<GuardedExperiment, string>>; applied: Partial<Record<GuardedExperiment, number>> };
}

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

const NATIVE_TIMING_BASE_KEYS = ["decodedFrames", "submittedFrames", "lateFrames", "lastLateUs", "maxLateUs",
  "maxSubmitGapMs", "leadUs", "sourceWidth", "sourceHeight"] as const;
const NATIVE_TIMING_COUNT_KEYS = ["droppedFrames", "intervalUnitNs", "intervalCount", "intervalMinNs", "intervalMaxNs",
  "intervalLastNs", "intervalMeanNs",
  // 1.1.42
  "snappedFrames", "snapErrorMaxUs", "snapErrorMeanUs", "vsyncPeriodUs", "vsyncSamples", "preferredModeApplied",
  // 1.1.43
  "releaseLeadUs"] as const;
/** 1.1.41's and 1.1.42's timing keys — the ones an older API's strict schema refuses (telemetry.ts holds them back after a 400). */
export const NATIVE_TIMING_EXTRA_KEYS: readonly string[] = [
  ...NATIVE_TIMING_COUNT_KEYS, "sourceFps", "refreshRate", "displayMode", "intervalBuckets", "history",
  "clockSlewUs", "supportedModes", "preferredModeResult", "keepScreenOn",
];
const signedCount = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER;
export const NATIVE_MAX_SUPPORTED_MODES = 16;
function readSupportedModes(v: unknown): string[] | undefined {
  if (!Array.isArray(v) || v.length > NATIVE_MAX_SUPPORTED_MODES || !v.every(m => typeof m === "string" && DISPLAY_MODE_RE.test(m))) return undefined;
  return v.slice() as string[];
}
export const NATIVE_INTERVAL_BUCKETS = 16;
const DISPLAY_MODE_RE = /^[0-9]{1,6}:[0-9]{1,5}x[0-9]{1,5}@[0-9]{1,4}(?:\.[0-9]{1,3})?$/;
const SHA8_RE = /^[a-f0-9]{8}$/;
const BUILD_RE = /^[0-9A-Za-z.+_-]{1,40}$/;
const CODE_RE = /^[a-z0-9-]{1,64}$/i;
const CODEC_RE = /^[a-z0-9_.-]{1,128}$/i;
const COMPOSITIONS = new Set(["dynamic_above", "static_above"]);
const LAYERS = new Set(["under_window", "queued", "revealing", "above_window", "retired"]);
const rate = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1000;

function readIntervalBuckets(v: unknown): number[] | undefined {
  if (!Array.isArray(v) || v.length !== NATIVE_INTERVAL_BUCKETS || !v.every(count)) return undefined;
  return v.slice() as number[];
}

/** Only the known interval/display fields, each bounded; anything else is dropped. */
function readTimingExtras(value: Record<string, unknown>, out: Record<string, unknown>): void {
  for (const k of NATIVE_TIMING_COUNT_KEYS) if (count(value[k])) out[k] = value[k];
  if (rate(value.sourceFps) && (value.sourceFps as number) > 0) out.sourceFps = value.sourceFps;
  if (rate(value.refreshRate)) out.refreshRate = value.refreshRate;
  if (typeof value.displayMode === "string" && DISPLAY_MODE_RE.test(value.displayMode)) out.displayMode = value.displayMode;
  const buckets = readIntervalBuckets(value.intervalBuckets);
  if (buckets) out.intervalBuckets = buckets;
  // 1.1.42: the slew is SIGNED (the drift's direction matters); the rest are bounded like everything else here.
  if (signedCount(value.clockSlewUs)) out.clockSlewUs = value.clockSlewUs;
  const modes = readSupportedModes(value.supportedModes);
  if (modes) out.supportedModes = modes;
  if (typeof value.preferredModeResult === "string" && CODE_RE.test(value.preferredModeResult)) out.preferredModeResult = value.preferredModeResult;
  if (typeof value.keepScreenOn === "boolean") out.keepScreenOn = value.keepScreenOn;
}

function readHistoryEntry(v: unknown): NativeTimingHistoryEntry | null {
  if (!record(v) || !count(v.at)) return null;
  const e: NativeTimingHistoryEntry = { at: v.at };
  for (const k of ["uptimeMs", "elapsedMs", "decodedFrames", "submittedFrames", "lateFrames", "maxLateUs", "maxSubmitGapMs",
    "droppedFrames", "loops", "uniqueFrames", "bootCount",
    "snappedFrames", "snapErrorMaxUs", "snapErrorMeanUs", "vsyncPeriodUs", "vsyncSamples", "preferredModeApplied", "releaseLeadUs"] as const) if (count(v[k])) e[k] = v[k];
  if (signedCount(v.clockSlewUs)) e.clockSlewUs = v.clockSlewUs;
  if (typeof v.vsyncSnap === "boolean") e.vsyncSnap = v.vsyncSnap;
  if (typeof v.prefer60hz === "string" && CODE_RE.test(v.prefer60hz)) e.prefer60hz = v.prefer60hz;
  if (typeof v.keepScreenOn === "boolean") e.keepScreenOn = v.keepScreenOn;
  if (v.face === 0 || v.face === 1) e.face = v.face;
  if (typeof v.sha8 === "string" && SHA8_RE.test(v.sha8)) e.sha8 = v.sha8;
  if (typeof v.build === "string" && BUILD_RE.test(v.build)) e.build = v.build;
  if (v.protocol === 2 || v.protocol === 3) e.protocol = v.protocol;
  if (COMPOSITIONS.has(String(v.composition))) e.composition = v.composition as NativeTimingHistoryEntry["composition"];
  if (LAYERS.has(String(v.layer))) e.layer = v.layer as NativeTimingHistoryEntry["layer"];
  if (typeof v.reason === "string" && CODE_RE.test(v.reason)) e.reason = v.reason;
  if (v.recovered === true) e.recovered = true;
  if (rate(v.fps) && (v.fps as number) > 0) e.fps = v.fps;
  if (rate(v.refreshRate)) e.refreshRate = v.refreshRate;
  if (typeof v.displayMode === "string" && DISPLAY_MODE_RE.test(v.displayMode)) e.displayMode = v.displayMode;
  if (typeof v.codecName === "string" && CODEC_RE.test(v.codecName)) e.codecName = v.codecName;
  if (typeof v.webviewInvisible === "boolean") e.webviewInvisible = v.webviewInvisible;
  if (typeof v.surfaceFrameRate === "string" && CODE_RE.test(v.surfaceFrameRate)) e.surfaceFrameRate = v.surfaceFrameRate;
  const extras: Record<string, unknown> = {};
  readTimingExtras(v, extras);
  for (const k of ["intervalUnitNs", "intervalCount", "intervalMinNs", "intervalMaxNs", "intervalLastNs", "intervalMeanNs"] as const) {
    if (typeof extras[k] === "number") e[k] = extras[k] as number;
  }
  if (Array.isArray(extras.intervalBuckets)) e.intervalBuckets = extras.intervalBuckets as number[];
  return e;
}

export function readNativeVideoTiming(value: unknown): NativeVideoTiming | undefined {
  if (!record(value) || !NATIVE_TIMING_BASE_KEYS.every(k => count(value[k]))) return undefined;
  const width = value.sourceWidth as number, height = value.sourceHeight as number;
  if (width <= 0 || width > 16384 || height <= 0 || height > 16384) return undefined;
  const out = Object.fromEntries(NATIVE_TIMING_BASE_KEYS.map(k => [k, value[k]])) as Record<string, unknown>;
  readTimingExtras(value, out);
  const h = value.history;
  if (record(h) && Array.isArray(h.entries) && count(h.overflow)) {
    const entries: NativeTimingHistoryEntry[] = [];
    for (const raw of h.entries.slice(0, 8)) {
      const e = readHistoryEntry(raw);
      if (e) entries.push(e);
    }
    out.history = { entries, overflow: h.overflow, ...(count(h.capacity) ? { capacity: h.capacity } : {}) };
  }
  return out as unknown as NativeVideoTiming;
}

const SOCS = new Set(["amlogic", "rockchip", "novastar", "other"]);
const SILENT_UPDATES = new Set(["installer-of-record", "tap"]);

/** The APK's resolved device class, bounded; null when the reply carries none (every APK before 1.1.41). */
export function readNativeDeviceClass(v: unknown): NativeDeviceClass | null {
  if (
    !record(v) ||
    typeof v.class !== "string" || !/^[a-z]+\/android-[0-9]{1,2}$/.test(v.class) ||
    !SOCS.has(String(v.soc)) ||
    !count(v.sdk) || v.sdk > 100 ||
    !count(v.webviewMajor) || v.webviewMajor > 10_000 ||
    typeof v.nativeSolo !== "boolean" || typeof v.protocol3 !== "boolean" ||
    !SILENT_UPDATES.has(String(v.silentUpdate))
  )
    return null;
  const d: NativeDeviceClass = {
    class: v.class,
    soc: v.soc as NativeDeviceClass["soc"],
    sdk: v.sdk,
    webviewMajor: v.webviewMajor,
    nativeSolo: v.nativeSolo,
    protocol3: v.protocol3,
    silentUpdate: v.silentUpdate as NativeDeviceClass["silentUpdate"],
  };
  if (typeof v.fleet === "string" && v.fleet.length > 0 && v.fleet.length <= 96) d.fleet = v.fleet;
  if (COMPOSITIONS.has(String(v.composition))) d.composition = v.composition as NativeDeviceClass["composition"];
  if (typeof v.qualified === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(v.qualified)) d.qualified = v.qualified;
  // 1.1.42: the default display's rate and modes; an APK that could not read them sends none (or an empty active mode).
  if (rate(v.refreshRate)) d.refreshRate = v.refreshRate;
  if (typeof v.activeMode === "string" && (v.activeMode === "" || DISPLAY_MODE_RE.test(v.activeMode))) d.activeMode = v.activeMode;
  const modes = readSupportedModes(v.supportedModes);
  if (modes) d.supportedModes = modes;
  // 1.1.43: the firmware's own strings, already stripped by the APK; bounded again here, anything else dropped.
  if (typeof v.sysDisplayMode === "string" && SYS_DISPLAY_MODE_RE.test(v.sysDisplayMode)) d.sysDisplayMode = v.sysDisplayMode;
  if (Array.isArray(v.sysDisplayCaps) && v.sysDisplayCaps.length <= NATIVE_MAX_SYS_DISPLAY_CAPS &&
    v.sysDisplayCaps.every((c) => typeof c === "string" && SYS_DISPLAY_CAP_RE.test(c))) d.sysDisplayCaps = v.sysDisplayCaps.slice() as string[];
  return d;
}
export const NATIVE_MAX_SYS_DISPLAY_CAPS = 16;
const SYS_DISPLAY_MODE_RE = /^[A-Za-z0-9:_.*+/@-]{1,48}$/;
const SYS_DISPLAY_CAP_RE = /^[A-Za-z0-9:_.*+/@-]{1,32}$/;

const EXPERIMENT_NAMES = ["webviewInvisible", "surfaceFrameRate", "decoderRotation", "vsyncSnap", "prefer60hz"] as const;
const GUARDED = ["webviewInvisible", "surfaceFrameRate", "vsyncSnap", "prefer60hz"] as const;

/** Only `true` flags, by their known names; nothing else is an experiment. */
export function readNativeExperimentFlags(v: unknown): NativeExperimentFlags | null {
  if (!record(v)) return null;
  const out: NativeExperimentFlags = {};
  for (const k of EXPERIMENT_NAMES) if (v[k] === true) out[k] = true;
  return Object.keys(out).length ? out : null;
}

export function readNativeSessionExperiments(v: unknown): NativeSessionExperiments | null {
  if (!record(v) || !record(v.applied) || !record(v.guard)) return null;
  const requested = readNativeExperimentFlags(v.requested) ?? {};
  const applied: NativeSessionExperiments["applied"] = { webviewInvisible: v.applied.webviewInvisible === true };
  if (typeof v.applied.surfaceFrameRate === "string" && CODE_RE.test(v.applied.surfaceFrameRate)) applied.surfaceFrameRate = v.applied.surfaceFrameRate;
  if (typeof v.applied.vsyncSnap === "boolean") applied.vsyncSnap = v.applied.vsyncSnap;
  if (typeof v.applied.prefer60hz === "string" && CODE_RE.test(v.applied.prefer60hz)) applied.prefer60hz = v.applied.prefer60hz;
  const guard: NativeSessionExperiments["guard"] = { disabled: {}, applied: {} };
  if (record(v.guard.disabled)) for (const k of GUARDED) {
    const r = v.guard.disabled[k];
    if (typeof r === "string" && CODE_RE.test(r)) guard.disabled[k] = r;
  }
  if (record(v.guard.applied)) for (const k of GUARDED) if (count(v.guard.applied[k])) guard.applied[k] = v.guard.applied[k] as number;
  return { requested, applied, guard };
}

/**
 * Experiment 3 (`decoderRotation`, 1.1.41): the orientation the page asks the
 * APK for. With the flag on, the Activity stays in the panel's NATURAL
 * orientation (`NATURAL` → SCREEN_ORIENTATION_NOSENSOR) and the decoder
 * rotates the picture; the page's existing body-rotation fallback lays the
 * web content out. An APK that does not know `NATURAL` logs and keeps what
 * it had. AUTO is never overridden (a pinned LED canvas, a sensor box).
 */
export function nativeOrientationRequest(
  orientation: "LANDSCAPE" | "PORTRAIT" | "AUTO",
  descriptor: { experiments?: NativeExperimentFlags } | null | undefined,
): "LANDSCAPE" | "PORTRAIT" | "AUTO" | "NATURAL" {
  if (orientation !== "AUTO" && descriptor?.experiments?.decoderRotation === true) return "NATURAL";
  return orientation;
}
const text = (v: unknown, max = 128): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

export function readNativeSharedVideoDescriptor(
  value: unknown,
): NativeSharedVideoDescriptor | null {
  if (
    !record(value) ||
    value.version !== 1 ||
    !uuid(value.screenId) ||
    !uuid(value.tenantId) ||
    !uuid(value.primaryScreenId) ||
    !uuid(value.peerScreenId) ||
    value.screenId === value.peerScreenId ||
    !count(value.faceIndex) ||
    value.faceIndex > 1 ||
    !text(value.revision) ||
    (value.faceIndex === 0
      ? value.screenId !== value.primaryScreenId
      : value.peerScreenId !== value.primaryScreenId)
  )
    return null;
  const a = value.asset,
    t = value.transform;
  if (
    !record(a) ||
    !uuid(a.id) ||
    !text(a.url, 4096) ||
    !/^[a-f0-9]{64}$/i.test(String(a.sha256)) ||
    !count(a.size) ||
    a.size === 0 ||
    a.size > 512 * 1024 * 1024 ||
    !count(a.width) ||
    a.width < 16 ||
    a.width > 4096 ||
    !count(a.height) ||
    a.height < 16 ||
    a.height > 4096 ||
    !positive(a.fps) ||
    a.fps > 30 ||
    !record(t) ||
    !["PORTRAIT", "LANDSCAPE", "AUTO"].includes(String(t.orientation)) ||
    typeof t.rotation !== "number" ||
    ![0, 90, 180, 270].includes(t.rotation) ||
    (t.fit !== "fill" && t.fit !== "cover")
  )
    return null;
  try {
    const u = new URL(a.url);
    if (
      u.protocol !== "https:" ||
      u.hostname !== "bhdaxzfalaycfopvcopm.supabase.co" ||
      u.username ||
      u.password ||
      u.hash ||
      (u.port && u.port !== "443") ||
      !/^\/storage\/v1\/object\/(public|sign)\/assets\//.test(u.pathname) ||
      /[%\\]/.test(u.pathname)
    )
      return null;
  } catch {
    return null;
  }
  return {
    version: 1,
    screenId: value.screenId,
    tenantId: value.tenantId,
    primaryScreenId: value.primaryScreenId,
    peerScreenId: value.peerScreenId,
    faceIndex: value.faceIndex,
    revision: value.revision,
    asset: {
      id: a.id,
      url: a.url,
      sha256: String(a.sha256).toLowerCase(),
      size: a.size,
      width: a.width,
      height: a.height,
      fps: a.fps,
    },
    transform: {
      orientation:
        t.orientation as NativeSharedVideoDescriptor["transform"]["orientation"],
      rotation:
        t.rotation as NativeSharedVideoDescriptor["transform"]["rotation"],
      fit: t.fit === "cover" ? "cover" : "fill",
    },
  };
}

/**
 * PROTOCOL 2 — the per-face native video engine (2026-10-12; API
 * `native-video.ts`, APK `FaceVideoPolicy.kt`). One descriptor per SCREEN
 * (= per face): no peer, no pairing, so a double-sided unit can run any
 * combination — the same file, a different file per face, or video on one
 * face and a template on the other — and a single-sided screen can use it
 * too. It rides the same four bridge methods; the APK proves it has it with
 * `protocol: 2` on `sharedVideoState`, and until it does this is inert.
 */
export interface NativeVideoDescriptor {
  version: 2;
  screenId: string;
  tenantId: string;
  faceIndex: number;
  revision: string;
  asset: NativeSharedVideoDescriptor["asset"];
  transform: {
    orientation: "PORTRAIT" | "LANDSCAPE" | "AUTO";
    fit: "cover" | "contain" | "fill";
  };
  /** 1.1.41 — the M43 experiments the server switched on for this screen; absent = none. Outside the identity. */
  experiments?: NativeExperimentFlags;
  /**
   * Native-first (`PLAYER_NATIVE_FIRST`, design §8.1): `true` named, `false`
   * the lead's kill switch, absent = the app's class default. Outside the
   * identity (a flip never restarts a session; it applies at the next boundary).
   */
  nativeFirst?: boolean;
}

export type AnyNativeVideoDescriptor =
  | NativeSharedVideoDescriptor
  | NativeVideoDescriptor;

const STORAGE_HOST = "bhdaxzfalaycfopvcopm.supabase.co";

function safeMediaUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return !(
      u.protocol !== "https:" ||
      u.hostname !== STORAGE_HOST ||
      u.username ||
      u.password ||
      u.hash ||
      (u.port && u.port !== "443") ||
      !/^\/storage\/v1\/object\/(public|sign)\/assets\//.test(u.pathname) ||
      /[%\\]/.test(u.pathname)
    );
  } catch {
    return false;
  }
}

export function readNativeVideoDescriptor(
  value: unknown,
): NativeVideoDescriptor | null {
  if (
    !record(value) ||
    value.version !== 2 ||
    !uuid(value.screenId) ||
    !uuid(value.tenantId) ||
    !count(value.faceIndex) ||
    value.faceIndex > 1 ||
    !text(value.revision)
  )
    return null;
  const a = value.asset,
    t = value.transform;
  if (
    !record(a) ||
    !uuid(a.id) ||
    !text(a.url, 4096) ||
    !/^[a-f0-9]{64}$/i.test(String(a.sha256)) ||
    !count(a.size) ||
    a.size === 0 ||
    a.size > 512 * 1024 * 1024 ||
    !count(a.width) ||
    a.width < 16 ||
    a.width > 4096 ||
    !count(a.height) ||
    a.height < 16 ||
    a.height > 4096 ||
    !positive(a.fps) ||
    a.fps > 30 ||
    !record(t) ||
    !["PORTRAIT", "LANDSCAPE", "AUTO"].includes(String(t.orientation)) ||
    !["cover", "contain", "fill"].includes(String(t.fit)) ||
    !safeMediaUrl(a.url)
  )
    return null;
  return {
    version: 2,
    screenId: value.screenId,
    tenantId: value.tenantId,
    faceIndex: value.faceIndex,
    revision: value.revision,
    asset: {
      id: a.id,
      url: a.url,
      sha256: String(a.sha256).toLowerCase(),
      size: a.size,
      width: a.width,
      height: a.height,
      fps: a.fps,
    },
    transform: {
      orientation: t.orientation as NativeVideoDescriptor["transform"]["orientation"],
      fit: t.fit as NativeVideoDescriptor["transform"]["fit"],
    },
    ...(readNativeExperimentFlags(value.experiments) ? { experiments: readNativeExperimentFlags(value.experiments)! } : {}),
    ...(typeof value.nativeFirst === "boolean" ? { nativeFirst: value.nativeFirst } : {}),
  };
}

/**
 * Which protocol the APK speaks, from one `sharedVideoState` reply: 2 when it
 * says so, 1 for any other well-formed state (the 1.1.25–1.1.28 field
 * builds), null when there is no usable answer (no bridge, refused, garbage).
 */
export function readNativeVideoProtocol(raw: unknown): 1 | 2 | 3 | null {
  let v: unknown = raw;
  try {
    if (typeof raw === "string") {
      // Protocol 3 replies carry a bounded `sessions[]` list (nativeZones.ts).
      if (raw.length > 16384) return null;
      v = JSON.parse(raw);
    }
  } catch {
    return null;
  }
  if (!record(v) || v.version !== 1) return null;
  // Protocol 3 (2026-10-12) keeps `protocol: 2` on the top level — an older
  // web bundle meeting a newer APK sees exactly what it saw — and proves the
  // positioned-zone engine with `protocolMax: 3`. Native-first (stream B)
  // raises protocolMax to 4 on an enrolled face whatever the class's slot
  // engine is, so there the class's own `device.protocol3` says whether
  // positioned slots run (a v4 face must not lose them, nor gain them).
  if (v.protocol === 2) {
    if (v.protocolMax === 3) return 3;
    if (typeof v.protocolMax === "number" && v.protocolMax >= 4) return record(v.device) && v.device.protocol3 === true ? 3 : 2;
    return 2;
  }
  return readNativeSharedVideoState(v) ? 1 : null;
}

/**
 * The one native path a document may use, or null (web). Protocol 2 needs an
 * APK that proved it; otherwise the protocol-1 pair descriptor (the explicitly
 * enrolled field pair, `PLAYER_NATIVE_DUAL_VIDEO`) keeps working exactly as it
 * did. Unknown protocol = wait (web plays meanwhile).
 */
export function pickNativeVideo(input: {
  v2: NativeVideoDescriptor | null;
  v1: NativeSharedVideoDescriptor | null;
  protocol: 1 | 2 | 3 | null;
  v2Blocked: boolean;
}): AnyNativeVideoDescriptor | null {
  if (input.protocol === null) return null;
  // A protocol-3 APK runs the solo engine exactly as protocol 2 does.
  if (input.v2 && input.protocol >= 2 && !input.v2Blocked) return input.v2;
  return input.v1;
}

/**
 * THE APK'S v2 / v3 TABLE, mirrored: 1.1.43's `NativeEndGrade`
 * (FaceVideoPolicy.kt). A drift test reads the Kotlin and holds these five
 * lists identical to it. Since native-first, the GRADE itself comes from the
 * one closed table (`nativeEndReasons.ts`, generated from stream B's
 * NativeEndReasons.kt), which B reconciled with this one: every code both
 * know grades the same (`nativeEndReasons.test.ts` proves it here), and the
 * closed table also knows the codes this one misses — `host-replaced` on a v2
 * session is TRANSIENT, not a 24 h block.
 */
export const NATIVE_VIDEO_TRANSIENT_REASONS: ReadonlySet<string> = new Set([
  "emergency-held",
  "activity-paused",
  "host-detached",
  "document-retired",
  "content-changed",
  "peer-stopped",
  "page-stopped",
  "engine-switched",
  "page-lease-expired",
  // The device credential rotated while native was preparing (the page
  // renews its token on reload / every few minutes). Native re-reads it on
  // the next attempt — never a verdict on the file (field 2026-10-12: M43 +
  // L55VEC were blocked for 24 h by exactly this, seconds after a reload).
  "credential-changed",
  // 1.1.43 (failure grading, phase 0): the rest of the APK's TRANSIENT set.
  "session-retired",
  "selection-changed",
  "superseded",
  "skipped",
  "hold-expired",
  "decoder-budget",
  "decoder-unavailable",
  "output-detached",
  // The safety net reverted a 60 Hz mode switch nothing proved; native is tried again at the panel's own mode.
  "display-mode-reverted",
  // The face's host WebView was replaced (a renderer crash recreates it): never a verdict on the file.
  "host-replaced",
]);
export const NATIVE_VIDEO_NOT_READY_REASONS: ReadonlySet<string> = new Set([
  "authorization-failed", "credential-missing", "credential-identity", "api-root", "api-origin", "manifest-too-large",
  "manifest-unreachable", "timeout", "source-failed", "media-redirect", "media-incomplete", "media-size", "media-publish",
  "media-cache-unavailable", "media-cache-corrupt", "media-cache-quota", "media-missing", "media-origin", "not-in-store",
  "store-full",
]);
export const NATIVE_VIDEO_NOT_READY_PREFIXES: readonly string[] = ["manifest-http-", "media-http-", "descriptor-"];
export const NATIVE_VIDEO_BOX_REASONS: ReadonlySet<string> = new Set(["composition-unavailable", "protocol3-disabled", "zone-overlap", "protocol"]);
export const NATIVE_VIDEO_FAULT_REASONS: ReadonlySet<string> = new Set([
  "codec-failed", "codec-stalled", "codec-input", "codec-not-prepared", "hardware-codec-unavailable", "output-stalled",
  "output-unavailable", "media-digest", "avc-track", "coded-size", "container-rotation", "empty-lap", "native-prepare",
]);

/**
 * FAILURE GRADING, PHASE 0 (docs/design/NATIVE-FIRST-ONE-STORE.md §3.4, owner
 * decision D7) — the closed table's grade, under the names this page's
 * protocol 2/3 code has always used (`box` = the table's `refused`):
 *  • transient — the box, the page or the content moved on;
 *  • not-ready — the NETWORK, STORAGE, AUTHORIZATION or MANIFEST failed (an
 *    offline boot, a 5xx, a timeout, a short download, a full disk). NEVER a
 *    verdict on the file — before this, an offline boot blocked native for a day;
 *  • box — a verdict about this box or this layout: web, no retry, no block;
 *  • fault — a real fault of a VERIFIED file on this decoder: the 24 h block.
 * A code in no set is a fault: fail closed on the unknown.
 */
export type NativeVideoEndGrade = "transient" | "not-ready" | "box" | "fault";
export function nativeVideoEndGrade(reason: string | undefined | null): NativeVideoEndGrade {
  const grade = gradeNativeEnd(reason);
  return grade === "refused" ? "box" : grade;
}
export const NATIVE_VIDEO_RETRY_MS = 30_000;
export const NATIVE_VIDEO_MAX_ATTEMPTS = 20;
/** A file that faults native on this box stays on the web engine for a day. */
export const NATIVE_VIDEO_BLOCK_MS = 24 * 60 * 60 * 1000;
// v2 (2026-10-12): drops every block written while transient reasons
// (`caching`, `credential-changed`) were mis-graded as file faults.
const BLOCK_KEY = "edu.nativeVideo.block.v3"; // v3: reset after the decoder-check fix (1.1.32)

/**
 * The APK build a block was earned under: `EduCmsPlayer/<version>` from the
 * WebView UA (MainActivity stamps it), '' in a browser. A block is a verdict
 * about THIS file on THIS native build — a new APK is exactly what may fix it,
 * so it gets a fresh chance (field 2026-10-12: a 1.1.29 block, keyed by file +
 * face only, held both T982 screens off native for 24 h after 1.1.30 landed,
 * and localStorage survives an APK update).
 */
export function nativeVideoBuildScope(
  ua: string = typeof navigator !== "undefined" ? navigator.userAgent : "",
): string {
  const m = /EduCmsPlayer\/([0-9A-Za-z.+_-]{1,40})/.exec(ua || "");
  return m ? m[1] : "";
}
const blockKey = (sha256: string, faceIndex: number, build: string) =>
  build ? `${sha256.toLowerCase()}:${faceIndex}:${build}` : `${sha256.toLowerCase()}:${faceIndex}`;

type BlockStore = Pick<Storage, "getItem" | "setItem">;
export function nativeVideoBlocked(
  store: BlockStore | null,
  sha256: string,
  faceIndex: number,
  now: number,
  build: string = nativeVideoBuildScope(),
): boolean {
  return nativeVideoBlockedUntil(store, sha256, faceIndex, now, build) !== null;
}
/** The instant a live block ends, or null when there is none. */
export function nativeVideoBlockedUntil(
  store: BlockStore | null,
  sha256: string,
  faceIndex: number,
  now: number,
  build: string = nativeVideoBuildScope(),
): number | null {
  if (!store) return null;
  try {
    const all = JSON.parse(store.getItem(BLOCK_KEY) || "{}");
    const until = record(all) ? all[blockKey(sha256, faceIndex, build)] : 0;
    return typeof until === "number" && until > now ? until : null;
  } catch {
    return null;
  }
}

/**
 * The one line a native fallback leaves behind (2026-10-12). Native refusals
 * used to be silent end to end: nothing on the page, nothing in the APK log,
 * and telemetry only starts after `ready`. A `console.warn` that starts with
 * `[Player]` and matches /fallback/i is persisted by every shipped APK
 * (MainActivity.onConsoleMessage → `PLAYER_PLAYBACK_FAILURE …`, 1/min) and
 * kept by the API as a PLAYER_RECOVERY_EVENT row — no new APK needed.
 * Codes and a short digest prefix only: never a URL or a credential.
 */
export function nativeVideoFallbackLine(f: {
  reason: string | undefined;
  next: string;
  attempt: number;
  protocol: number;
  faceIndex: number;
  sha256: string;
  stage?: string;
}): string {
  const reason = f.reason && /^[a-z0-9-]{1,64}$/i.test(f.reason) ? f.reason : "none";
  return (
    `[Player] PLAYER_NATIVE_VIDEO_FALLBACK reason=${reason} next=${f.next} attempt=${f.attempt}` +
    ` proto=${f.protocol} face=${f.faceIndex} sha=${f.sha256.slice(0, 8).toLowerCase()}` +
    (f.stage ? ` stage=${f.stage}` : "") + " (web fallback)"
  );
}
/** Logged once per page load when a live block keeps a file on the web engine. */
export function nativeVideoBlockedLine(f: {
  faceIndex: number;
  sha256: string;
  build: string;
  until?: number | null;
}): string {
  return (
    `[Player] PLAYER_NATIVE_VIDEO_BLOCKED face=${f.faceIndex} sha=${f.sha256.slice(0, 8).toLowerCase()}` +
    ` build=${f.build || "browser"}` +
    (typeof f.until === "number" ? ` until=${new Date(f.until).toISOString()}` : "") + " (web fallback)"
  );
}
const blockedLogged = new Set<string>();
/**
 * `nativeVideoBlocked` for the render path: the same answer, plus ONE
 * `PLAYER_NATIVE_VIDEO_BLOCKED` line per file + face + build per page load,
 * so a screen held on the web engine by an earlier verdict says so.
 */
export function nativeVideoBlockedNoted(
  store: BlockStore | null,
  sha256: string,
  faceIndex: number,
  now: number,
  build: string = nativeVideoBuildScope(),
  log: (line: string) => void = (l) => console.warn(l),
): boolean {
  const until = nativeVideoBlockedUntil(store, sha256, faceIndex, now, build);
  if (until === null) return false;
  const key = blockKey(sha256, faceIndex, build);
  if (!blockedLogged.has(key)) {
    blockedLogged.add(key);
    log(nativeVideoBlockedLine({ faceIndex, sha256, build, until }));
  }
  return true;
}
export function blockNativeVideo(
  store: BlockStore | null,
  sha256: string,
  faceIndex: number,
  now: number,
  build: string = nativeVideoBuildScope(),
): void {
  if (!store) return;
  try {
    let all: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(store.getItem(BLOCK_KEY) || "{}");
      if (record(parsed)) all = parsed;
    } catch {
      /* corrupt store: start over */
    }
    const kept: Record<string, number> = {};
    for (const [k, v] of Object.entries(all))
      if (typeof v === "number" && v > now) kept[k] = v;
    kept[blockKey(sha256, faceIndex, build)] = now + NATIVE_VIDEO_BLOCK_MS;
    // Bounded: the newest 32 entries.
    const entries = Object.entries(kept).sort((x, y) => y[1] - x[1]).slice(0, 32);
    store.setItem(BLOCK_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage unavailable: no block, native is simply tried again */
  }
}

/** Copy only bounded native facts; a bridge response cannot inject arbitrary fields into telemetry. */
export function readNativeSharedVideoState(
  raw: unknown,
): NativeSharedVideoState | null {
  let v: unknown = raw;
  try {
    if (typeof raw === "string") {
      // Same bound as readNativeVideoProtocol: a protocol-3 reply carries `sessions[]`.
      if (raw.length > 16384) return null;
      v = JSON.parse(raw);
    }
  } catch {
    return null;
  }
  if (
    !record(v) ||
    v.version !== 1 ||
    !["idle", "preparing", "ready", "presenting", "failed"].includes(
      String(v.state),
    )
  )
    return null;
  if (v.state === "idle")
    return {
      version: 1,
      state: "idle",
      sessionId: "",
      revision: "",
      sha256: "",
      faceIndex: 0,
    };
  if (
    !uuid(v.sessionId) ||
    !text(v.revision) ||
    !/^[a-f0-9]{64}$/i.test(String(v.sha256)) ||
    !count(v.faceIndex) ||
    v.faceIndex > 1
  )
    return null;
  const s: NativeSharedVideoState = {
    version: 1,
    state: v.state as NativeSharedVideoState["state"],
    sessionId: v.sessionId,
    revision: v.revision,
    sha256: String(v.sha256).toLowerCase(),
    faceIndex: v.faceIndex,
  };
  // Diagnostic reasons are codes, not native exception text/URLs/credentials.
  if (typeof v.reason === "string" && /^[a-z0-9-]{1,64}$/i.test(v.reason))
    s.reason = v.reason;
  if (v.sessionProtocol === 2 || v.sessionProtocol === 3) s.sessionProtocol = v.sessionProtocol;
  const o = v.output;
  if (
    record(o) &&
    typeof o.attached === "boolean" &&
    typeof o.visible === "boolean" &&
    typeof o.hardwareAccelerated === "boolean" &&
    [
      "viewUpdates",
      "uniqueFrames",
      "sourcePtsUs",
      "width",
      "height",
      "lastUpdateElapsedMs",
      "ageMs",
    ].every((k) => count(o[k]))
  ) {
    s.output = {
      attached: o.attached,
      visible: o.visible,
      hardwareAccelerated: o.hardwareAccelerated,
      ageMs: o.ageMs as number,
      viewUpdates: o.viewUpdates as number,
      uniqueFrames: o.uniqueFrames as number,
      sourcePtsUs: o.sourcePtsUs as number,
      width: o.width as number,
      height: o.height as number,
      lastUpdateElapsedMs: o.lastUpdateElapsedMs as number,
    };
    if (["under_window", "queued", "revealing", "above_window", "retired"].includes(String(o.layerMode)))
      s.output.layerMode = o.layerMode as NonNullable<NativeSharedVideoState["output"]>["layerMode"];
    if (["under_window", "dynamic_above", "static_above"].includes(String(o.compositionMode)))
      s.output.compositionMode = o.compositionMode as NonNullable<NativeSharedVideoState["output"]>["compositionMode"];
  }
  if (
    typeof v.codecName === "string" &&
    /^[a-z0-9_.-]{1,128}$/i.test(v.codecName)
  )
    s.codecName = v.codecName;
  for (const k of ["elapsedMs", "stalls", "loops", "drops"] as const)
    if (count(v[k])) s[k] = v[k];
  const timing = readNativeVideoTiming(v.timing);
  if (timing) s.timing = timing;
  const device = readNativeDeviceClass(v.device);
  if (device) s.device = device;
  const experiments = readNativeSessionExperiments(v.experiments);
  if (experiments) s.experiments = experiments;
  return s;
}

export function sharedVideoEligible(
  d: AnyNativeVideoDescriptor | null,
  context: {
    screenId: string | null;
    tenantId: string | null;
    assetId: string;
    sha256: string;
    solo: boolean;
    muted: boolean;
    active: boolean;
    emergency: boolean;
    sync: boolean;
    preview: boolean;
  },
): d is AnyNativeVideoDescriptor {
  return (
    !!d &&
    d.screenId === context.screenId &&
    d.tenantId === context.tenantId &&
    d.asset.id === context.assetId &&
    d.asset.sha256 === context.sha256.toLowerCase() &&
    context.solo &&
    context.muted &&
    context.active &&
    !context.emergency &&
    !context.sync &&
    !context.preview
  );
}

export function sharedVideoIdentity(d: AnyNativeVideoDescriptor): string {
  return JSON.stringify([
    d.version,
    d.screenId,
    d.tenantId,
    d.revision,
    d.asset.id,
    d.asset.sha256,
    d.faceIndex,
    d.transform,
  ]);
}

export interface SharedVideoBridge {
  has(method: string): boolean;
  fire(method: string, arg: string): boolean;
  state(): Promise<unknown>;
}
export const SHARED_VIDEO_METHODS = [
  "sharedVideoPrepare",
  "sharedVideoCommit",
  "sharedVideoStop",
  "sharedVideoState",
] as const;

/** One attempt per mounted identity. Polls are single-flight and also renew native's face lease. */
export class SharedVideoController {
  private cancelled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private session = "";
  private committed = false;
  private ready = false;
  private startedAt: number;
  private commitAt = 0;
  private lastFrames = 0;
  private lastAdvance = 0;
  private missed = 0;
  static readonly MAX_MISSED_POLLS = 3;
  constructor(
    private descriptor: AnyNativeVideoDescriptor,
    private bridge: SharedVideoBridge,
    private callbacks: {
      ready(): void;
      update(state: NativeSharedVideoState, fresh: boolean): void;
      /** `reason` is the native end code when there is one (never free text). */
      fallback(reason?: string): void;
    },
    private now: () => number = () => performance.now(),
  ) {
    this.startedAt = now();
  }

  start(): void {
    if (!SHARED_VIDEO_METHODS.every((m) => this.bridge.has(m))) {
      this.fail();
      return;
    }
    const d = this.descriptor;
    if (
      !this.bridge.fire(
        "sharedVideoPrepare",
        JSON.stringify(
          d.version === 2
            ? {
                version: 2,
                screenId: d.screenId,
                revision: d.revision,
                sha256: d.asset.sha256,
                assetId: d.asset.id,
              }
            : {
                version: 1,
                screenId: d.screenId,
                revision: d.revision,
                sha256: d.asset.sha256,
              },
        ),
      )
    ) {
      this.fail();
      return;
    }
    void this.poll();
  }
  commit(): void {
    if (this.cancelled || !this.ready || this.committed || !this.session)
      return;
    this.committed = true;
    this.commitAt = this.now();
    if (!this.bridge.fire("sharedVideoCommit", this.session)) this.fail();
  }
  stop(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.session) this.bridge.fire("sharedVideoStop", this.session);
  }
  /**
   * `reason` is passed ONLY for native's own end code (a `failed` state).
   * Every page-side end — a reply that never came, a budget, a mismatch —
   * carries no reason, which the page treats as transient (retry). It used to
   * fall back to the last reason native REPORTED, and while native downloads
   * that is the progress code `caching`: one late reply during a download
   * turned into a 24 h block of a perfectly good file (field 2026-10-12).
   */
  private fail(reason?: string): void {
    if (this.cancelled) return;
    this.stop();
    this.callbacks.fallback(reason);
  }
  private async poll(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // Keep bounded even when a channel reply never arrives. A late reply is used ONLY to stop its old session.
    const response = Promise.resolve()
      .then(() => this.bridge.state())
      .then((raw) => {
        const s = readNativeSharedVideoState(raw);
        if (
          this.cancelled &&
          s &&
          this.matches(s) &&
          this.session &&
          s.sessionId === this.session
        )
          this.bridge.fire("sharedVideoStop", s.sessionId);
        return s;
      });
    let s: NativeSharedVideoState | null;
    let late = false;
    try {
      s = await Promise.race([
        response,
        new Promise<null>((resolve) => {
          timeout = setTimeout(() => {
            late = true;
            resolve(null);
          }, 2000);
        }),
      ]);
    } catch {
      s = null;
    }
    if (timeout !== undefined) clearTimeout(timeout);
    if (this.cancelled) return;
    // A reply that did not come back in time, BEFORE commit, is the page's or
    // the channel's hiccup (a box busy decoding 4K while native downloads),
    // not native's verdict: nothing native is on glass yet, and the poll that
    // was sent still renewed native's 10 s lease. Up to MAX_MISSED_POLLS in a
    // row are tolerated so a long download is not thrown away.
    if (!s && late && !this.committed && this.missed < SharedVideoController.MAX_MISSED_POLLS) {
      this.missed++;
      this.timer = setTimeout(() => {
        void this.poll();
      }, 500);
      return;
    }
    if (!s || (s.state !== "idle" && !this.matches(s))) {
      this.fail();
      return;
    }
    this.missed = 0;
    if (this.committed && s.sessionId !== this.session) {
      this.fail();
      return;
    }
    if (s.sessionId) this.session = s.sessionId;
    if (s.state === "failed") {
      this.callbacks.update(s, false);
      this.fail(s.reason ?? "failed");
      return;
    }
    const now = this.now();
    if (s.state === "ready" && !this.ready) {
      this.ready = true;
      this.callbacks.ready();
    }
    if (s.state === "presenting") {
      if (!this.committed) {
        this.fail();
        return;
      }
      const o = s.output;
      if (
        o &&
        o.attached &&
        o.visible &&
        o.ageMs <= 2500 &&
        o.uniqueFrames > this.lastFrames &&
        o.viewUpdates > 0
      ) {
        this.lastFrames = o.uniqueFrames;
        this.lastAdvance = now;
      }
    }
    const fresh =
      s.state === "presenting" &&
      !!s.output?.attached &&
      !!s.output?.visible &&
      (s.output?.ageMs ?? Infinity) <= 2500 &&
      this.lastFrames > 0 &&
      now - this.lastAdvance <= 2500;
    this.callbacks.update(s, fresh);
    // Protocol 2 downloads + verifies the file natively first; while it says
    // `caching` the web keeps playing, for up to three hours (a large 4K
    // file on a slow venue link), never forever.
    const prepareBudget =
      this.descriptor.version === 2 && s.reason === "caching"
        ? 3 * 60 * 60 * 1000
        : 330000;
    if (
      (!this.committed && now - this.startedAt > prepareBudget) ||
      (this.committed &&
        !fresh &&
        now - (this.lastAdvance || this.commitAt) > 5000)
    ) {
      this.fail();
      return;
    }
    this.timer = setTimeout(() => {
      void this.poll();
    }, 500);
  }
  private matches(s: NativeSharedVideoState): boolean {
    return (
      s.revision === this.descriptor.revision &&
      s.sha256 === this.descriptor.asset.sha256 &&
      s.faceIndex === this.descriptor.faceIndex
    );
  }
}

/** Document-local evidence, never borrowed from another face or from browser rAF. */
export class SharedVideoEvidence {
  private owner: object | null = null;
  private selected = false;
  private state: NativeSharedVideoState | null = null;
  private receivedAt = 0;
  private advancedAt = 0;
  private frames = 0;
  private reportedSession = "";
  private reportedFrames = 0;
  select(owner: object): void {
    this.owner = owner;
    this.selected = true;
    this.state = null;
    this.frames = 0;
    this.advancedAt = 0;
  }
  update(
    owner: object,
    state: NativeSharedVideoState,
    fresh: boolean,
    now: number,
  ): void {
    if (owner !== this.owner) return;
    this.state = state;
    this.receivedAt = now;
    if (fresh && (state.output?.uniqueFrames ?? 0) > this.frames) {
      this.frames = state.output!.uniqueFrames;
      this.advancedAt = now;
    }
  }
  clear(owner: object): void {
    if (owner === this.owner) {
      this.owner = null;
      this.selected = false;
      this.state = null;
    }
  }
  isSelected(): boolean {
    return this.selected;
  }
  hasFreshFrames(now: number): boolean {
    const s = this.state;
    return (
      this.selected &&
      !!s &&
      s.state === "presenting" &&
      !!s.output?.attached &&
      !!s.output?.visible &&
      s.output.ageMs <= 2500 &&
      this.frames > 0 &&
      now - this.advancedAt <= 2500 &&
      now - this.receivedAt <= 2500
    );
  }
  frameCount(): number {
    return this.frames;
  }
  canProve(now: number): boolean {
    const s = this.state;
    return (
      !!s &&
      s.state === "presenting" &&
      !!s.output?.attached &&
      !!s.output?.visible &&
      (s.output?.ageMs ?? Infinity) <= 2500 &&
      this.frames > 0 &&
      now - this.advancedAt <= 2500 &&
      now - this.receivedAt <= 2500 &&
      (s.sessionId !== this.reportedSession ||
        this.frames > this.reportedFrames)
    );
  }
  commitProof(): void {
    this.reportedSession = this.state?.sessionId ?? "";
    this.reportedFrames = this.frames;
  }
  telemetry(): NativeSharedVideoState | null {
    return this.state?.sessionId ? this.state : null;
  }
}
export const nativeSharedVideoEvidence = new SharedVideoEvidence();
