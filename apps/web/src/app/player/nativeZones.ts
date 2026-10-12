/**
 * nativeZones — PROTOCOL 3 of the per-face native video engine (2026-10-12).
 * API: apps/api/src/screens/native-video-items.ts · APK: media/FaceVideoBox.kt
 * (`FaceZoneMessage`) · design + hardware matrix:
 * docs/research/2026-10-12-native-video/02-protocol-3.md.
 *
 * Protocol 2 (nativeSharedVideo.ts) hands native ONE solo, muted video per
 * face. Protocol 3 adds two more shapes, each as a SLOT with its own native
 * session, surface and decoder:
 *
 *   • `item:<playlist item id>` — a video inside a MIXED playlist. The page
 *     pre-rolls the next native item while the current web slide is on glass
 *     (`commit` renders the first frame and HOLDS it behind the opaque page),
 *     then, when the slot becomes active, opens the hole and sends `play`.
 *     The clip plays ONCE; native reports `ended` and keeps its last frame on
 *     the surface until the next slide has painted over it.
 *   • `zone:<template zone id>` — a VIDEO widget inside a template. The page
 *     measures the zone's rendered rect (TemplateScaler scale, body rotation,
 *     zone rotation) and sends it on the bridge; native positions the surface
 *     there, BELOW the WebView, and the page punches a transparent hole in
 *     its backdrop so widgets stacked above the zone still draw above it.
 *
 * Transport (CLAUDE.md player rule 9): NO new bridge method. A `version: 3`
 * JSON on `sharedVideoPrepare` selects this engine (`op`: prepare / layout /
 * play); `sharedVideoCommit` / `sharedVideoStop` take the session id as they
 * always did; `sharedVideoState` keeps its protocol-2 top level (an older
 * web bundle sees exactly what it saw) and adds `protocolMax: 3` plus a
 * bounded `sessions[]` list, one entry per live slot.
 *
 * Everything here is pure (no React, no DOM, no network) except the
 * controller's bridge calls, which are injected — so `nativeZones.test.ts`
 * can drive every state transition with a fake bridge.
 */

import {
  NATIVE_VIDEO_MAX_ATTEMPTS,
  NATIVE_VIDEO_TRANSIENT_REASONS,
  type NativeSharedVideoState,
} from "./nativeSharedVideo";

export type NativeZoneFit = "cover" | "contain" | "fill";
export type NativeZoneDegrees = 0 | 90 | 180 | 270;

export interface NativeVideoItem {
  slot: string;
  asset: {
    id: string;
    url: string;
    sha256: string;
    size: number;
    width: number;
    height: number;
    fps: number;
  };
  loop: boolean;
}

export interface NativeVideoItemsDescriptor {
  version: 3;
  screenId: string;
  tenantId: string;
  faceIndex: number;
  revision: string;
  orientation: "PORTRAIT" | "LANDSCAPE" | "AUTO";
  items: NativeVideoItem[];
}

/** What the APK positions: CSS px of the page viewport the APK scales to its own size. */
export interface ZoneLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The page's layout viewport (window.innerWidth/innerHeight) the rect is measured in. */
  vw: number;
  vh: number;
  degrees: NativeZoneDegrees;
  fit: NativeZoneFit;
}

export interface NativeZoneState {
  slot: string;
  state: "preparing" | "ready" | "presenting" | "failed";
  sessionId: string;
  revision: string;
  sha256: string;
  reason?: string;
  held: boolean;
  ended: boolean;
  codecName?: string;
  loops?: number;
  drops?: number;
  elapsedMs?: number;
  output?: NativeSharedVideoState["output"];
}

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 128): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max;
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

const STORAGE_HOST = "bhdaxzfalaycfopvcopm.supabase.co";
export const NATIVE_ZONE_SLOT_RE = /^(item|zone):[A-Za-z0-9_-]{1,64}$/;
/** Decoder reality on the fleet: two positioned surfaces per face, no more. */
export const NATIVE_ZONE_MAX_ZONES = 2;

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

function readItem(value: unknown): NativeVideoItem | null {
  if (!record(value) || !text(value.slot, 80) || !NATIVE_ZONE_SLOT_RE.test(value.slot)) return null;
  if (typeof value.loop !== "boolean") return null;
  const a = value.asset;
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
    !safeMediaUrl(a.url)
  )
    return null;
  return {
    slot: value.slot,
    loop: value.loop,
    asset: {
      id: a.id,
      url: a.url,
      sha256: String(a.sha256).toLowerCase(),
      size: a.size,
      width: a.width,
      height: a.height,
      fps: a.fps,
    },
  };
}

/** The manifest's `nativeVideoItems`, or null (web). Every item must be well-formed. */
export function readNativeVideoItems(value: unknown): NativeVideoItemsDescriptor | null {
  if (
    !record(value) ||
    value.version !== 3 ||
    !uuid(value.screenId) ||
    !uuid(value.tenantId) ||
    !count(value.faceIndex) ||
    value.faceIndex > 1 ||
    !text(value.revision) ||
    !["PORTRAIT", "LANDSCAPE", "AUTO"].includes(String(value.orientation)) ||
    !Array.isArray(value.items) ||
    value.items.length === 0 ||
    value.items.length > 64
  )
    return null;
  const items: NativeVideoItem[] = [];
  const slots = new Set<string>();
  for (const raw of value.items) {
    const it = readItem(raw);
    if (!it || slots.has(it.slot)) return null;
    slots.add(it.slot);
    items.push(it);
  }
  return {
    version: 3,
    screenId: value.screenId,
    tenantId: value.tenantId,
    faceIndex: value.faceIndex,
    revision: value.revision,
    orientation: value.orientation as NativeVideoItemsDescriptor["orientation"],
    items,
  };
}

export function nativeZoneItemFor(
  d: NativeVideoItemsDescriptor | null,
  slot: string,
): NativeVideoItem | null {
  if (!d) return null;
  return d.items.find((i) => i.slot === slot) ?? null;
}

/**
 * May THIS document hand this slot to native? Same gate shape as
 * `sharedVideoEligible` (protocol 2): identity must match the manifest this
 * page applied, and every web-only case stays web — emergency content, a
 * frame-locked playlist, the preview, a file whose hash the page does not
 * recognise, an unknown or blocked protocol.
 */
export function nativeZoneEligible(
  d: NativeVideoItemsDescriptor | null,
  item: NativeVideoItem | null,
  context: {
    screenId: string | null;
    tenantId: string | null;
    protocol: 1 | 2 | 3 | null;
    sha256: string | null;
    emergency: boolean;
    sync: boolean;
    preview: boolean;
    blocked: boolean;
  },
): item is NativeVideoItem {
  return (
    !!d &&
    !!item &&
    context.protocol === 3 &&
    d.screenId === context.screenId &&
    d.tenantId === context.tenantId &&
    (context.sha256 === null || item.asset.sha256 === context.sha256.toLowerCase()) &&
    !context.emergency &&
    !context.sync &&
    !context.preview &&
    !context.blocked
  );
}

/**
 * The VIDEO zone config facts the hole can honour (mirror of the API's
 * `templateVideoZoneConfigEligible`; the page checks again because the
 * geometry it renders is the geometry that must be true).
 */
export function templateZoneConfigEligible(cfg: unknown): cfg is Record<string, unknown> {
  if (!record(cfg)) return false;
  if (typeof cfg.assetUrl !== "string" || !cfg.assetUrl) return false;
  if (cfg.muted === false || cfg.autoplay === false || cfg.hidden === true) return false;
  if (cfg.opacity !== undefined && cfg.opacity !== 1) return false;
  if (cfg._zoneOpacity !== undefined && cfg._zoneOpacity !== 1) return false;
  if (cfg.borderRadius !== undefined && cfg.borderRadius !== 0) return false;
  const rot = cfg._zoneRotation ?? 0;
  if (typeof rot !== "number" || !Number.isFinite(rot) || ((rot % 90) + 90) % 90 !== 0) return false;
  const fit = cfg.fit ?? cfg.fitMode ?? "cover";
  if (!["cover", "contain", "fill"].includes(String(fit))) return false;
  const bg = typeof cfg.bgColor === "string" ? cfg.bgColor.trim() : "";
  if (bg && bg !== "transparent" && bg !== "inherit") return false;
  return true;
}

export function templateZoneFit(cfg: Record<string, unknown>): NativeZoneFit {
  const fit = cfg.fit ?? cfg.fitMode ?? "cover";
  return fit === "contain" || fit === "fill" ? fit : "cover";
}

/**
 * The clockwise rotation native must apply so the picture lands upright on
 * the physical panel: the body-rotation fallback (the page rotates `body` 90°
 * when a ROM ignored the PORTRAIT request — the same case the protocol-2 APK
 * derives from orientation vs. panel shape) plus the zone's own rotation.
 * Anything that is not a right angle is not a native zone (null = web).
 */
export function zoneDegrees(bodyRotated: boolean, zoneRotation: number | null | undefined): NativeZoneDegrees | null {
  const z = typeof zoneRotation === "number" && Number.isFinite(zoneRotation) ? zoneRotation : 0;
  if (((z % 90) + 90) % 90 !== 0) return null;
  const total = ((((bodyRotated ? 90 : 0) + z) % 360) + 360) % 360;
  return total as NativeZoneDegrees;
}

export interface Rect { x: number; y: number; w: number; h: number }

/**
 * A measured viewport rect (getBoundingClientRect: scale, body rotation and
 * zone rotation already applied) → the integer layout the APK positions,
 * clamped to the viewport. Null when nothing visible is left (off-screen,
 * collapsed, a zero viewport): web keeps the slot.
 */
export function zoneLayout(
  rect: { left: number; top: number; width: number; height: number },
  viewport: { w: number; h: number },
  degrees: NativeZoneDegrees,
  fit: NativeZoneFit,
): ZoneLayout | null {
  if (!(viewport.w > 0) || !(viewport.h > 0)) return null;
  if (![rect.left, rect.top, rect.width, rect.height].every((n) => Number.isFinite(n))) return null;
  const x0 = Math.max(0, Math.round(rect.left));
  const y0 = Math.max(0, Math.round(rect.top));
  const x1 = Math.min(Math.round(viewport.w), Math.round(rect.left + rect.width));
  const y1 = Math.min(Math.round(viewport.h), Math.round(rect.top + rect.height));
  if (x1 - x0 < 2 || y1 - y0 < 2) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, vw: Math.round(viewport.w), vh: Math.round(viewport.h), degrees, fit };
}

export function sameLayout(a: ZoneLayout | null, b: ZoneLayout | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.vw === b.vw && a.vh === b.vh && a.degrees === b.degrees && a.fit === b.fit;
}

/**
 * Where a template zone sits inside the template ROOT (the element that
 * paints the template background), in the root's own, unrotated px — the
 * hole the backdrop clip-path must cut. Mirrors TemplateScaler exactly: the
 * design frame is laid out designW×designH centred (or left-anchored for
 * poster shapes) in the root and scaled about its centre (or left-centre);
 * a zone is a %-box of the design, rotated about its own centre.
 */
export function templateZoneLocalRect(
  root: { w: number; h: number },
  design: { w: number; h: number },
  scale: number,
  align: "center" | "left",
  zone: { x: number; y: number; width: number; height: number; rotation?: number },
): Rect | null {
  if (!(root.w > 0) || !(root.h > 0) || !(design.w > 0) || !(design.h > 0) || !(scale > 0)) return null;
  const ox = align === "left" ? 0 : (root.w - design.w) / 2;
  const oy = (root.h - design.h) / 2;
  const originX = align === "left" ? ox : ox + design.w / 2;
  const originY = oy + design.h / 2;
  // Zone box in design px, then its centre; a right-angle rotation about the
  // centre swaps width and height for 90 / 270.
  const zw = (zone.width / 100) * design.w;
  const zh = (zone.height / 100) * design.h;
  const cx = (zone.x / 100) * design.w + zw / 2;
  const cy = (zone.y / 100) * design.h + zh / 2;
  const rot = ((((zone.rotation ?? 0) % 360) + 360) % 360) % 180;
  const bw = rot === 90 ? zh : zw;
  const bh = rot === 90 ? zw : zh;
  // Frame px → root px through the scale about the transform origin.
  const map = (px: number, py: number): [number, number] => [
    originX + (ox + px - originX) * scale,
    originY + (oy + py - originY) * scale,
  ];
  const [l, t] = map(cx - bw / 2, cy - bh / 2);
  const [r, b] = map(cx + bw / 2, cy + bh / 2);
  const x0 = Math.max(0, l), y0 = Math.max(0, t), x1 = Math.min(root.w, r), y1 = Math.min(root.h, b);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * `clip-path` for an opaque backdrop with rectangular holes: the outer box
 * once, then each hole as its own closed sub-path, under the even-odd rule.
 * Chromium ≥ 55 and WebKit accept the `<fill-rule>` in `polygon()`; no
 * `inset` shorthand is involved (CLAUDE.md rule 10). Values are rounded to
 * whole px so the edge of the hole sits on a device pixel.
 */
export function holeClipPath(holes: Rect[]): string | undefined {
  const hs = holes.filter((h) => h.w > 0 && h.h > 0);
  if (hs.length === 0) return undefined;
  const px = (n: number) => `${Math.round(n)}px`;
  const parts = ["0 0", "100% 0", "100% 100%", "0 100%", "0 0"];
  for (const h of hs) {
    const x0 = px(h.x), y0 = px(h.y), x1 = px(h.x + h.w), y1 = px(h.y + h.h);
    parts.push(`${x0} ${y0}`, `${x0} ${y1}`, `${x1} ${y1}`, `${x1} ${y0}`, `${x0} ${y0}`);
  }
  return `polygon(evenodd, ${parts.join(", ")})`;
}

// ── Bridge messages (version 3 on sharedVideoPrepare) ────────────────────

export function prepareMessage(
  d: NativeVideoItemsDescriptor,
  item: NativeVideoItem,
  layout: ZoneLayout,
): string {
  return JSON.stringify({
    version: 3,
    op: "prepare",
    screenId: d.screenId,
    revision: d.revision,
    slot: item.slot,
    sha256: item.asset.sha256,
    assetId: item.asset.id,
    loop: item.loop,
    layout,
  });
}
export function layoutMessage(sessionId: string, layout: ZoneLayout): string {
  return JSON.stringify({ version: 3, op: "layout", sessionId, layout });
}
export function playMessage(sessionId: string): string {
  return JSON.stringify({ version: 3, op: "play", sessionId });
}

/** One `sharedVideoState` reply → the protocol the APK answers and its live slots. */
export function readNativeZoneStates(raw: unknown): { protocol: 1 | 2 | 3 | null; sessions: NativeZoneState[] } {
  let v: unknown = raw;
  try {
    if (typeof raw === "string") {
      if (raw.length > 16384) return { protocol: null, sessions: [] };
      v = JSON.parse(raw);
    }
  } catch {
    return { protocol: null, sessions: [] };
  }
  if (!record(v) || v.version !== 1) return { protocol: null, sessions: [] };
  const protocol: 1 | 2 | 3 | null =
    v.protocolMax === 3 ? 3 : v.protocol === 2 ? 2 : typeof v.state === "string" ? 1 : null;
  const sessions: NativeZoneState[] = [];
  if (Array.isArray(v.sessions)) {
    for (const s of v.sessions.slice(0, 8)) {
      const z = readZoneState(s);
      if (z) sessions.push(z);
    }
  }
  return { protocol, sessions };
}

function readZoneState(v: unknown): NativeZoneState | null {
  if (
    !record(v) ||
    !text(v.slot, 80) ||
    !NATIVE_ZONE_SLOT_RE.test(v.slot) ||
    !["preparing", "ready", "presenting", "failed"].includes(String(v.state)) ||
    !uuid(v.sessionId) ||
    !text(v.revision) ||
    !/^[a-f0-9]{64}$/i.test(String(v.sha256))
  )
    return null;
  const s: NativeZoneState = {
    slot: v.slot,
    state: v.state as NativeZoneState["state"],
    sessionId: v.sessionId,
    revision: v.revision,
    sha256: String(v.sha256).toLowerCase(),
    held: v.held === true,
    ended: v.ended === true,
  };
  if (typeof v.reason === "string" && /^[a-z0-9-]{1,64}$/i.test(v.reason)) s.reason = v.reason;
  if (typeof v.codecName === "string" && /^[a-z0-9_.-]{1,128}$/i.test(v.codecName)) s.codecName = v.codecName;
  for (const k of ["loops", "drops", "elapsedMs"] as const) if (count(v[k])) s[k] = v[k];
  const o = v.output;
  if (
    record(o) &&
    typeof o.attached === "boolean" &&
    typeof o.visible === "boolean" &&
    typeof o.hardwareAccelerated === "boolean" &&
    ["viewUpdates", "uniqueFrames", "sourcePtsUs", "width", "height", "lastUpdateElapsedMs", "ageMs"].every((k) => count(o[k]))
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
  return s;
}

/** The protocol-2 shape the telemetry body carries for a slot (what the API's `nativeVideoSchema` accepts). */
export function zoneStateAsSharedState(s: NativeZoneState, faceIndex: number): NativeSharedVideoState {
  const out: NativeSharedVideoState = {
    version: 1,
    state: s.state,
    sessionId: s.sessionId,
    revision: s.revision,
    sha256: s.sha256,
    faceIndex,
  };
  if (s.reason) out.reason = s.reason;
  if (s.codecName) out.codecName = s.codecName;
  if (s.loops !== undefined) out.loops = s.loops;
  if (s.elapsedMs !== undefined) out.elapsedMs = s.elapsedMs;
  if (s.output) out.output = s.output;
  return out;
}

// ── Fallback discipline ──────────────────────────────────────────────────

/**
 * Protocol 3 adds the budget refusals to the transient set: a slot refused
 * because the box already runs its decoders is not a fault of the file —
 * the next showing may well get one. (`NATIVE_VIDEO_TRANSIENT_REASONS` is
 * protocol 2's list and must stay exactly what the 1.1.29 APK sends.)
 */
export const NATIVE_ZONE_TRANSIENT_REASONS: ReadonlySet<string> = new Set([
  ...NATIVE_VIDEO_TRANSIENT_REASONS,
  "decoder-budget",
  "decoder-unavailable",
  "output-unavailable",
  "hold-expired",
  "skipped",
  // Native removed this on-glass session because the next slot's `play`
  // took its place (the expected native→native hand-off), never a fault.
  "superseded",
]);

export function nativeZoneNext(reason: string | undefined, attempt: number, wasOnGlass = false): "retry" | "block" | "stay" {
  // Owner rule 2026-10-12: never flip web ↔ native on the glass. Once a slot was
  // presenting and ended, it stays web until the content changes / page reloads.
  if (wasOnGlass && (!reason || NATIVE_ZONE_TRANSIENT_REASONS.has(reason))) return "stay";
  if (!reason || NATIVE_ZONE_TRANSIENT_REASONS.has(reason))
    return attempt + 1 < NATIVE_VIDEO_MAX_ATTEMPTS ? "retry" : "stay";
  return "block";
}

// ── Controller ───────────────────────────────────────────────────────────

export interface NativeZoneBridge {
  has(method: string): boolean;
  fire(method: string, arg: string): boolean;
  state(): Promise<unknown>;
}
export const NATIVE_ZONE_METHODS = [
  "sharedVideoPrepare",
  "sharedVideoCommit",
  "sharedVideoStop",
  "sharedVideoState",
] as const;

/** Native must show fresh frames within this of `play`, and keep advancing. */
export const NATIVE_ZONE_PLAY_STALL_MS = 5000;
/** How long a download may take before the web keeps the slot (3 h, as protocol 2). */
export const NATIVE_ZONE_CACHING_BUDGET_MS = 3 * 60 * 60 * 1000;
export const NATIVE_ZONE_PREPARE_BUDGET_MS = 330_000;

export type NativeZoneStage = "preparing" | "ready" | "held" | "playing" | "ended" | "failed";

/**
 * One slot's native session, driven by polls (500 ms, single-flight; every
 * poll renews native's 10 s lease). Stages:
 *   preparing → ready (file verified, decoder chosen, nothing allocated)
 *   → [commit] → held (first frame rendered on the surface, held)
 *   → [play]   → playing (frames advancing) → ended (non-loop, last frame kept)
 * Any failure → `fallback(reason)`; the owner remounts the web element.
 */
export class NativeZoneController {
  private cancelled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private session = "";
  private committed = false;
  private played = false;
  private playAt = 0;
  private stage: NativeZoneStage = "preparing";
  private startedAt: number;
  private lastFrames = 0;
  private lastAdvance = 0;
  private layoutSent: ZoneLayout;
  constructor(
    private descriptor: NativeVideoItemsDescriptor,
    private item: NativeVideoItem,
    layout: ZoneLayout,
    private bridge: NativeZoneBridge,
    private callbacks: {
      ready(): void;
      held(): void;
      update(state: NativeZoneState, fresh: boolean): void;
      ended(): void;
      fallback(reason?: string): void;
      /** Native replaced this played session with the next slot's (no fallback). */
      superseded?(): void;
    },
    private now: () => number = () => performance.now(),
  ) {
    this.startedAt = now();
    this.layoutSent = layout;
  }

  currentStage(): NativeZoneStage {
    return this.stage;
  }
  sessionId(): string {
    return this.session;
  }

  start(): void {
    if (!NATIVE_ZONE_METHODS.every((m) => this.bridge.has(m))) {
      this.fail("bridge-missing");
      return;
    }
    if (!this.bridge.fire("sharedVideoPrepare", prepareMessage(this.descriptor, this.item, this.layoutSent))) {
      this.fail("bridge-refused");
      return;
    }
    void this.poll();
  }
  /** Allocate the decoder and render + hold the first frame (needs `ready`). */
  commit(): void {
    if (this.cancelled || this.stage !== "ready" || this.committed || !this.session) return;
    this.committed = true;
    if (!this.bridge.fire("sharedVideoCommit", this.session)) this.fail("bridge-refused");
  }
  /** Release the held first frame into playback (needs `held`). */
  play(): void {
    if (this.cancelled || this.stage !== "held" || this.played || !this.session) return;
    this.played = true;
    this.playAt = this.now();
    this.lastAdvance = this.playAt;
    if (!this.bridge.fire("sharedVideoPrepare", playMessage(this.session))) this.fail("bridge-refused");
  }
  /** The zone moved or resized: re-position the surface without restarting. */
  layout(l: ZoneLayout): void {
    if (this.cancelled || sameLayout(l, this.layoutSent)) return;
    this.layoutSent = l;
    if (this.session) this.bridge.fire("sharedVideoPrepare", layoutMessage(this.session, l));
  }
  stop(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.session) this.bridge.fire("sharedVideoStop", this.session);
  }
  private fail(reason?: string): void {
    if (this.cancelled) return;
    this.stage = "failed";
    this.stop();
    // Only an explicit end code (native's, or a named page verdict). The last
    // REPORTED reason is a progress code while native downloads (`caching`)
    // and must never turn a page-side end into a 24 h block (field 2026-10-12).
    this.callbacks.fallback(reason);
  }
  private async poll(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const response = Promise.resolve()
      .then(() => this.bridge.state())
      .then((raw) => {
        const all = readNativeZoneStates(raw);
        const mine = all.sessions.find((s) => s.slot === this.item.slot && this.matches(s)) ?? null;
        // A late reply after stop is used only to stop its own old session.
        if (this.cancelled && mine && this.session && mine.sessionId === this.session)
          this.bridge.fire("sharedVideoStop", mine.sessionId);
        return { protocol: all.protocol, mine };
      });
    let r: { protocol: 1 | 2 | 3 | null; mine: NativeZoneState | null } | null;
    try {
      r = await Promise.race([
        response,
        new Promise<null>((resolve) => {
          timeout = setTimeout(() => resolve(null), 2000);
        }),
      ]);
    } catch {
      r = null;
    }
    if (timeout !== undefined) clearTimeout(timeout);
    if (this.cancelled) return;
    // A reply that never came is the page's / channel's hiccup — no reason,
    // so the owner retries. Only an ANSWER without protocol 3 is a verdict.
    if (!r) {
      this.fail();
      return;
    }
    if (r.protocol !== 3) {
      this.fail("protocol");
      return;
    }
    const s = r.mine;
    const now = this.now();
    if (!s) {
      // No session for this slot: either native has not registered it yet
      // (first poll after prepare) or it is gone. Give it the prepare budget.
      if (this.session || now - this.startedAt > 5000) {
        this.fail(this.session ? "session-lost" : "no-session");
        return;
      }
      this.schedule();
      return;
    }
    if (this.session && s.sessionId !== this.session) {
      this.fail("session-replaced");
      return;
    }
    this.session = s.sessionId;
    if (s.state === "failed") {
      this.callbacks.update(s, false);
      // The next slot took this one's place after it had played: a clean
      // end for the owner (its last frame was already covered), not a fault.
      if (s.reason === "superseded" && this.played && this.callbacks.superseded) {
        this.stage = "ended";
        this.stop();
        this.callbacks.superseded();
        return;
      }
      this.fail(s.reason ?? "failed");
      return;
    }
    if (s.state === "ready" && this.stage === "preparing") {
      this.stage = "ready";
      this.callbacks.ready();
    }
    if (s.state === "presenting" && !this.committed) {
      this.fail("uncommitted-output");
      return;
    }
    if (s.state === "presenting" && s.held && !this.played && this.stage !== "held") {
      this.stage = "held";
      this.callbacks.held();
    }
    let fresh = false;
    if (s.state === "presenting" && this.played) {
      const o = s.output;
      if (o && o.attached && o.visible && o.ageMs <= 2500 && o.uniqueFrames > this.lastFrames && o.viewUpdates > 0) {
        this.lastFrames = o.uniqueFrames;
        this.lastAdvance = now;
      }
      fresh = !!o && o.attached && o.visible && o.ageMs <= 2500 && this.lastFrames > 0 && now - this.lastAdvance <= 2500;
      if (fresh && this.stage === "held") this.stage = "playing";
      if (s.ended && this.stage !== "ended") {
        this.stage = "ended";
        this.callbacks.ended();
      }
    }
    this.callbacks.update(s, fresh);
    const prepareBudget = s.reason === "caching" ? NATIVE_ZONE_CACHING_BUDGET_MS : NATIVE_ZONE_PREPARE_BUDGET_MS;
    if (!this.committed && now - this.startedAt > prepareBudget) {
      this.fail("prepare-timeout");
      return;
    }
    // After play: frames must advance (unless the clip ended and native keeps its last frame).
    if (this.played && this.stage !== "ended" && !fresh && now - Math.max(this.playAt, this.lastAdvance) > NATIVE_ZONE_PLAY_STALL_MS) {
      this.fail("output-stalled");
      return;
    }
    this.schedule();
  }
  private schedule(): void {
    this.timer = setTimeout(() => {
      void this.poll();
    }, 500);
  }
  private matches(s: NativeZoneState): boolean {
    return s.revision === this.descriptor.revision && s.sha256 === this.item.asset.sha256;
  }
}
