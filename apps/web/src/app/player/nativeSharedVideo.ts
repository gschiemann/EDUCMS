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
  };
  codecName?: string;
  elapsedMs?: number;
  stalls?: number;
  loops?: number;
  /** Decoder scheduling diagnostics; submitted frames are not display proof. */
  timing?: {
    decodedFrames: number; submittedFrames: number; lateFrames: number;
    lastLateUs: number; maxLateUs: number; maxSubmitGapMs: number; leadUs: number;
    sourceWidth: number; sourceHeight: number;
  };
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

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function readNativeVideoTiming(value: unknown): NativeSharedVideoState["timing"] {
  const keys = ["decodedFrames", "submittedFrames", "lateFrames", "lastLateUs", "maxLateUs",
    "maxSubmitGapMs", "leadUs", "sourceWidth", "sourceHeight"] as const;
  if (!record(value) || !keys.every(k => count(value[k]))) return undefined;
  const width = value.sourceWidth as number, height = value.sourceHeight as number;
  if (width <= 0 || width > 16384 || height <= 0 || height > 16384) return undefined;
  return Object.fromEntries(keys.map(k => [k, value[k]])) as NativeSharedVideoState["timing"];
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
  // positioned-zone engine with `protocolMax: 3`.
  if (v.protocol === 2) return v.protocolMax === 3 ? 3 : 2;
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
 * End reasons that say nothing about THIS file on THIS box — the page tries
 * native again later. Must match `FaceVideoPolicy.transient` in the APK.
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
]);
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
