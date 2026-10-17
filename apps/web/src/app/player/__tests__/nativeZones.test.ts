/**
 * Protocol 3 — positioned native video slots (mixed playlists + template
 * VIDEO zones). API: apps/api/src/screens/native-video-items.ts · APK:
 * media/FaceVideoBox.kt. Pure module: nativeZones.ts.
 */
import {
  holeClipPath,
  layoutMessage,
  NATIVE_ZONE_PLAY_STALL_MS,
  NativeZoneController,
  nativeZoneEligible,
  nativeZoneItemFor,
  nativeZoneNext,
  overlappedTemplateZoneIds,
  playMessage,
  prepareMessage,
  readNativeVideoItems,
  readNativeZoneStates,
  sameLayout,
  templateZoneConfigEligible,
  templateZoneLocalRect,
  zoneDegrees,
  zoneLayout,
  zoneStateAsSharedState,
  type NativeVideoItemsDescriptor,
  type NativeZoneState,
  type ZoneLayout,
} from "../nativeZones";
import { pickNativeVideo, readNativeVideoProtocol, type NativeVideoDescriptor } from "../nativeSharedVideo";

const screen = "40864836-9367-47a3-b349-ba1c3378f814";
const tenant = "28d09f9d-0a6c-4828-b46d-38712eb69f1f";
const assetA = "9c0eb1c6-2486-484a-863d-e74c2dde5e93";
const assetB = "7b7d2f90-2d1e-4a56-9a0c-5d6e7f8a9b0c";
const digestA = "a".repeat(64);
const digestB = "b".repeat(64);
const session = "11111111-1111-1111-1111-111111111111";
const url = "https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/tenant/file.mp4";

const descriptor: NativeVideoItemsDescriptor = {
  version: 3,
  screenId: screen,
  tenantId: tenant,
  faceIndex: 0,
  revision: "rev3",
  orientation: "LANDSCAPE",
  items: [
    { slot: "item:v1", loop: false, asset: { id: assetA, url, sha256: digestA, size: 10_000_000, width: 1920, height: 1080, fps: 30 } },
    { slot: "zone:z1", loop: true, asset: { id: assetB, url, sha256: digestB, size: 10_000_000, width: 1920, height: 1080, fps: 25 } },
  ],
};
const layout: ZoneLayout = { x: 0, y: 0, w: 1920, h: 1080, vw: 1920, vh: 1080, degrees: 0, fit: "cover" };

const zoneState = (kind: NativeZoneState["state"] = "preparing", frames = 0, extra: Record<string, unknown> = {}) => ({
  slot: "item:v1",
  state: kind,
  sessionId: session,
  revision: "rev3",
  sha256: digestA,
  output: {
    attached: true, visible: true, hardwareAccelerated: true,
    viewUpdates: frames, uniqueFrames: frames, sourcePtsUs: 1,
    width: 1920, height: 1080, ageMs: 0, lastUpdateElapsedMs: 1,
  },
  ...extra,
});
const reply = (sessions: unknown[] = [], top: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 1, state: "idle", protocol: 2, protocolMax: 3, sessions, ...top });
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe("protocol 3 descriptor", () => {
  it("reads every slot; refuses a duplicate slot, a bad slot name, a foreign origin, audio-free is implicit", () => {
    expect(readNativeVideoItems(descriptor)).toEqual(descriptor);
    expect(readNativeVideoItems({ ...descriptor, items: [descriptor.items[0], descriptor.items[0]] })).toBeNull();
    expect(readNativeVideoItems({ ...descriptor, items: [{ ...descriptor.items[0], slot: "video:1" }] })).toBeNull();
    expect(readNativeVideoItems({ ...descriptor, items: [{ ...descriptor.items[0], asset: { ...descriptor.items[0].asset, url: "https://evil.example/storage/v1/object/public/assets/x.mp4" } }] })).toBeNull();
    expect(readNativeVideoItems({ ...descriptor, items: [] })).toBeNull();
    expect(readNativeVideoItems({ ...descriptor, version: 2 })).toBeNull();
    expect(readNativeVideoItems({ ...descriptor, items: [{ ...descriptor.items[0], loop: "yes" }] })).toBeNull();
    expect(nativeZoneItemFor(descriptor, "zone:z1")?.asset.sha256).toBe(digestB);
    expect(nativeZoneItemFor(descriptor, "zone:zz")).toBeNull();
    expect(nativeZoneItemFor(null, "item:v1")).toBeNull();
  });
  it("eligibility: protocol 3 only, identity + hash must match, every web-only case stays web", () => {
    const item = descriptor.items[0];
    const ctx = { screenId: screen, tenantId: tenant, protocol: 3 as const, sha256: digestA, emergency: false, sync: false, preview: false, blocked: false };
    expect(nativeZoneEligible(descriptor, item, ctx)).toBe(true);
    expect(nativeZoneEligible(descriptor, item, { ...ctx, sha256: null })).toBe(true);
    for (const k of ["emergency", "sync", "preview", "blocked"] as const)
      expect(nativeZoneEligible(descriptor, item, { ...ctx, [k]: true })).toBe(false);
    expect(nativeZoneEligible(descriptor, item, { ...ctx, protocol: 2 })).toBe(false);
    expect(nativeZoneEligible(descriptor, item, { ...ctx, protocol: null })).toBe(false);
    expect(nativeZoneEligible(descriptor, item, { ...ctx, sha256: digestB })).toBe(false);
    expect(nativeZoneEligible(descriptor, item, { ...ctx, screenId: tenant })).toBe(false);
    expect(nativeZoneEligible(descriptor, null, ctx)).toBe(false);
  });
});

describe("old protocols stay inert", () => {
  it("a protocol-2 APK reply reads as 2 and a protocol-1 reply as 1 — protocol 3 needs protocolMax", () => {
    expect(readNativeVideoProtocol(JSON.stringify({ version: 1, state: "idle", protocol: 2 }))).toBe(2);
    expect(readNativeVideoProtocol(JSON.stringify({ version: 1, state: "idle", protocol: 2, protocolMax: 3 }))).toBe(3);
    expect(readNativeVideoProtocol({ version: 1, state: "idle" })).toBe(1);
    // An APK that only claims protocolMax without protocol 2 is not trusted as 3.
    expect(readNativeVideoProtocol({ version: 1, state: "idle", protocolMax: 3 })).toBe(1);
    expect(readNativeZoneStates(reply()).protocol).toBe(3);
    expect(readNativeZoneStates(JSON.stringify({ version: 1, state: "idle", protocol: 2 })).protocol).toBe(2);
    expect(readNativeZoneStates("garbage").protocol).toBeNull();
  });
  it("a protocol-3 APK still takes the solo (protocol 2) descriptor exactly as a protocol-2 APK does", () => {
    const v2: NativeVideoDescriptor = {
      version: 2, screenId: screen, tenantId: tenant, faceIndex: 0, revision: "rev2",
      asset: descriptor.items[0].asset, transform: { orientation: "LANDSCAPE", fit: "cover" },
    };
    expect(pickNativeVideo({ v2, v1: null, protocol: 3, v2Blocked: false })).toBe(v2);
    expect(pickNativeVideo({ v2, v1: null, protocol: 2, v2Blocked: false })).toBe(v2);
    expect(pickNativeVideo({ v2, v1: null, protocol: 1, v2Blocked: false })).toBeNull();
  });
  it("the protocol-3 reply's `sessions` are bounded and typed; the top level is untouched", () => {
    const r = readNativeZoneStates(reply([zoneState("presenting", 12, { held: true, drops: 2, codecName: "OMX.rk.video_decoder.avc" })]));
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]).toMatchObject({ slot: "item:v1", state: "presenting", held: true, ended: false, drops: 2, codecName: "OMX.rk.video_decoder.avc" });
    expect(readNativeZoneStates(reply([{ ...zoneState(), slot: "nope" }])).sessions).toEqual([]);
    expect(readNativeZoneStates(reply([{ ...zoneState(), reason: "javax.net.ssl.SSLException: boom" }])).sessions[0].reason).toBeUndefined();
    expect(readNativeZoneStates(reply(new Array(20).fill(zoneState()))).sessions).toHaveLength(8);
    const shared = zoneStateAsSharedState(r.sessions[0], 1);
    expect(shared).toMatchObject({ version: 1, state: "presenting", faceIndex: 1, sessionId: session, codecName: "OMX.rk.video_decoder.avc" });
    expect(shared).not.toHaveProperty("slot");
    expect(shared).not.toHaveProperty("held");
  });
});

describe("rect computation", () => {
  it("rotation: body fallback + zone rotation compose to a right angle, or the zone is web", () => {
    expect(zoneDegrees(false, 0)).toBe(0);
    expect(zoneDegrees(true, 0)).toBe(90);
    expect(zoneDegrees(true, 90)).toBe(180);
    expect(zoneDegrees(false, 270)).toBe(270);
    expect(zoneDegrees(true, 270)).toBe(0);
    expect(zoneDegrees(false, -90)).toBe(270);
    expect(zoneDegrees(false, 45)).toBeNull();
    expect(zoneDegrees(false, undefined)).toBe(0);
  });
  it("layout: rounds, clamps to the viewport, refuses what is not on glass", () => {
    expect(zoneLayout({ left: 10.4, top: 20.6, width: 100.2, height: 50 }, { w: 1920, h: 1080 }, 0, "cover"))
      .toEqual({ x: 10, y: 21, w: 101, h: 50, vw: 1920, vh: 1080, degrees: 0, fit: "cover" });
    // Partly off the right edge: trimmed to the viewport.
    expect(zoneLayout({ left: 1900, top: 0, width: 100, height: 100 }, { w: 1920, h: 1080 }, 90, "contain"))
      .toMatchObject({ x: 1900, w: 20, degrees: 90, fit: "contain" });
    expect(zoneLayout({ left: -50, top: -50, width: 60, height: 60 }, { w: 1920, h: 1080 }, 0, "fill")).toMatchObject({ x: 0, y: 0, w: 10, h: 10 });
    expect(zoneLayout({ left: 2000, top: 0, width: 100, height: 100 }, { w: 1920, h: 1080 }, 0, "cover")).toBeNull();
    expect(zoneLayout({ left: 0, top: 0, width: 1, height: 100 }, { w: 1920, h: 1080 }, 0, "cover")).toBeNull();
    expect(zoneLayout({ left: 0, top: 0, width: 100, height: 100 }, { w: 0, h: 1080 }, 0, "cover")).toBeNull();
    expect(zoneLayout({ left: NaN, top: 0, width: 100, height: 100 }, { w: 1920, h: 1080 }, 0, "cover")).toBeNull();
    const a = zoneLayout({ left: 0, top: 0, width: 100, height: 100 }, { w: 1920, h: 1080 }, 0, "cover");
    expect(sameLayout(a, { ...a!, x: 1 })).toBe(false);
    expect(sameLayout(a, { ...a! })).toBe(true);
    expect(sameLayout(null, null)).toBe(true);
  });
  it("template zone → root px follows TemplateScaler: centred design frame scaled about its centre", () => {
    // 1920×1080 design on a 3840×2160 root: scale 2, centred.
    const r = templateZoneLocalRect({ w: 3840, h: 2160 }, { w: 1920, h: 1080 }, 2, "center", { x: 25, y: 25, width: 50, height: 50 });
    expect(r).toEqual({ x: 960, y: 540, w: 1920, h: 1080 });
    // Same design on a 960×1080 root under contain: scale 0.5, letterboxed vertically.
    const c = templateZoneLocalRect({ w: 960, h: 1080 }, { w: 1920, h: 1080 }, 0.5, "center", { x: 0, y: 0, width: 100, height: 100 });
    expect(c).toEqual({ x: 0, y: 270, w: 960, h: 540 });
    // A zone box: 10% from the left, 10% wide → 96px wide at scale 0.5, offset inside the frame.
    const z = templateZoneLocalRect({ w: 960, h: 1080 }, { w: 1920, h: 1080 }, 0.5, "center", { x: 10, y: 10, width: 10, height: 20 });
    expect(z).toEqual({ x: 96, y: 324, w: 96, h: 108 });
  });
  it("template zone rotation about its own centre swaps the box for 90/270; poster shapes anchor left", () => {
    const base = { x: 10, y: 10, width: 40, height: 20 };
    const plain = templateZoneLocalRect({ w: 1920, h: 1080 }, { w: 1920, h: 1080 }, 1, "center", base)!;
    expect(plain).toEqual({ x: 192, y: 108, w: 768, h: 216 });
    const rot = templateZoneLocalRect({ w: 1920, h: 1080 }, { w: 1920, h: 1080 }, 1, "center", { ...base, rotation: 90 })!;
    // Centre (576, 216) unchanged; 768×216 becomes 216×768.
    expect(rot).toEqual({ x: 468, y: 0, w: 216, h: 600 }); // top edge clipped at the root (216 - 384 < 0)
    const rot270 = templateZoneLocalRect({ w: 1920, h: 1080 }, { w: 1920, h: 1080 }, 1, "center", { ...base, y: 40, rotation: 270 })!;
    expect(rot270.w).toBe(216);
    expect(rot270.h).toBe(768);
    // LED poster: a 320×1080 design on a 1920×1080 frame at native size, left-anchored.
    const poster = templateZoneLocalRect({ w: 1920, h: 1080 }, { w: 320, h: 1080 }, 1, "left", { x: 0, y: 0, width: 100, height: 50 });
    expect(poster).toEqual({ x: 0, y: 0, w: 320, h: 540 });
    expect(templateZoneLocalRect({ w: 1920, h: 1080 }, { w: 1920, h: 1080 }, 0, "center", base)).toBeNull();
  });
  it("the backdrop hole is an even-odd polygon: outer box + one closed sub-path per hole, whole px", () => {
    expect(holeClipPath([])).toBeUndefined();
    expect(holeClipPath([{ x: 10.4, y: 20, w: 100, h: 50.6 }]))
      .toBe("polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, 10px 20px, 10px 71px, 110px 71px, 110px 20px, 10px 20px)");
    expect(holeClipPath([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 0, h: 10 }])!.split("px").length).toBe(11);
    expect(holeClipPath([{ x: 0, y: 0, w: 10, h: 10 }])).not.toMatch(/inset/);
  });
  it("zone config the hole cannot honour stays web", () => {
    expect(templateZoneConfigEligible({ assetUrl: url })).toBe(true);
    for (const bad of [{ opacity: 0.5 }, { _zoneOpacity: 0.5 }, { borderRadius: 8 }, { _zoneRotation: 30 }, { bgColor: "#000" }, { muted: false }, { autoplay: false }, { fit: "none" }])
      expect(templateZoneConfigEligible({ assetUrl: url, ...bad })).toBe(false);
    expect(templateZoneConfigEligible({})).toBe(false);
  });
});

describe("bridge messages", () => {
  it("prepare carries identity + layout, never a URL or a token; layout/play address the session", () => {
    const p = JSON.parse(prepareMessage(descriptor, descriptor.items[0], layout));
    expect(p).toEqual({ version: 3, op: "prepare", screenId: screen, revision: "rev3", slot: "item:v1", sha256: digestA, assetId: assetA, loop: false, layout });
    expect(JSON.stringify(p)).not.toMatch(/https?:/);
    expect(JSON.parse(layoutMessage(session, { ...layout, x: 5 }))).toEqual({ version: 3, op: "layout", sessionId: session, layout: { ...layout, x: 5 } });
    expect(JSON.parse(playMessage(session))).toEqual({ version: 3, op: "play", sessionId: session });
  });
});

describe("fallback discipline", () => {
  it("transient ends retry (incl. a decoder-budget refusal); a native fault blocks the file; attempts are bounded", () => {
    expect(nativeZoneNext("decoder-budget", 0)).toBe("retry");
    expect(nativeZoneNext("page-stopped", 0)).toBe("retry");
    expect(nativeZoneNext(undefined, 0)).toBe("retry");
    expect(nativeZoneNext("codec-failed", 0)).toBe("block");
    expect(nativeZoneNext("media-digest", 0)).toBe("block");
    expect(nativeZoneNext("activity-paused", 19)).toBe("stay");
  });

  it("1.1.41: a verdict about the box or the layout is a web decision for the document — no retry storm, no 24 h block", () => {
    for (const reason of ["protocol", "zone-overlap"]) {
      for (const attempt of [0, 5, 19]) for (const onGlass of [false, true]) {
        expect({ reason, attempt, onGlass, next: nativeZoneNext(reason, attempt, onGlass) }).toEqual({ reason, attempt, onGlass, next: "stay" });
      }
    }
    // An APK without protocol 3 (1.1.29, or a Taurus-class table) answers protocolMax 2: every zone is web.
    const ctx = { screenId: screen, tenantId: tenant, protocol: readNativeVideoProtocol(JSON.stringify({ version: 1, state: "idle", protocol: 2, sessions: [] })), sha256: null, emergency: false, sync: false, preview: false, blocked: false };
    expect(ctx.protocol).toBe(2);
    expect(nativeZoneEligible(descriptor, descriptor.items[0], ctx)).toBe(false);
    expect(nativeZoneEligible(descriptor, descriptor.items[1], ctx)).toBe(false);
  });

  it("1.1.41: a template zone that ANY other zone overlaps stays web (a native slot is above the window)", () => {
    const z = (id: string, x: number, y: number, width: number, height: number) => ({ id, x, y, width, height });
    expect(overlappedTemplateZoneIds([z("v", 10, 10, 50, 50), z("logo", 50, 50, 20, 20)])).toEqual(new Set(["v", "logo"]));
    expect(overlappedTemplateZoneIds([z("v", 10, 10, 50, 50), z("logo", 60, 60, 20, 20)])).toEqual(new Set());
    // Touching edges do not overlap; a zone with no geometry, no id or a zero size is ignored.
    expect(overlappedTemplateZoneIds([z("v", 0, 0, 50, 100), z("side", 50, 0, 50, 100)])).toEqual(new Set());
    expect(overlappedTemplateZoneIds([z("v", 0, 0, 50, 100), { id: "ghost" }, { x: 0, y: 0, width: 100, height: 100 }, z("flat", 0, 0, 0, 100), null, 7])).toEqual(new Set());
    expect(overlappedTemplateZoneIds([])).toEqual(new Set());
  });
});

describe("protocol 3 controller — hand-off sequencing", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function harness(states: () => unknown) {
    const fire = jest.fn((_m: string, _a: string) => true);
    const cb = { ready: jest.fn(), held: jest.fn(), update: jest.fn(), ended: jest.fn(), fallback: jest.fn(), revealed: jest.fn() };
    const c = new NativeZoneController(descriptor, descriptor.items[0], layout, { has: () => true, fire, state: async () => states() }, cb, () => Date.now());
    return { c, fire, cb };
  }
  const tick = async (ms = 500) => {
    await settle();
    jest.advanceTimersByTime(ms);
    await settle();
  };

  it("prepare → ready → commit → held → play → presenting → ended, in that order and never skipping a gate", async () => {
    let s: unknown = zoneState("preparing", 0, { reason: "caching" });
    const { c, fire, cb } = harness(() => reply([s]));
    c.start();
    expect(JSON.parse(fire.mock.calls[0][1]).op).toBe("prepare");
    await tick();
    expect(cb.ready).not.toHaveBeenCalled();
    // play / commit before ready do nothing.
    c.commit();
    c.play();
    expect(fire.mock.calls.filter(([m]) => m === "sharedVideoCommit")).toHaveLength(0);
    s = zoneState("ready");
    await tick();
    expect(cb.ready).toHaveBeenCalledTimes(1);
    expect(c.currentStage()).toBe("ready");
    c.commit();
    expect(fire).toHaveBeenLastCalledWith("sharedVideoCommit", session);
    // Native renders the first frame and holds it: one unique frame, held.
    s = zoneState("presenting", 1, { held: true });
    await tick();
    expect(cb.held).toHaveBeenCalledTimes(1);
    expect(c.currentStage()).toBe("held");
    // Held for a long time is NOT a stall: the page decides when to play.
    for (let i = 0; i < 40; i++) await tick();
    expect(cb.fallback).not.toHaveBeenCalled();
    c.play();
    expect(JSON.parse(fire.mock.calls[fire.mock.calls.length - 1][1])).toEqual({ version: 3, op: "play", sessionId: session });
    expect(cb.revealed).not.toHaveBeenCalled();
    // Still held on the next poll (native has not moved the box yet): no reveal.
    s = zoneState("presenting", 1, { held: true });
    await tick();
    expect(cb.revealed).not.toHaveBeenCalled();
    let frames = 1;
    s = zoneState("presenting", (frames += 15), { held: false });
    await tick();
    // 1.1.41: the slot is on its rect above the page — the web element may go. Once.
    expect(cb.revealed).toHaveBeenCalledTimes(1);
    s = zoneState("presenting", (frames += 15), { held: false });
    await tick();
    expect(cb.revealed).toHaveBeenCalledTimes(1);
    expect(c.currentStage()).toBe("playing");
    expect(cb.update).toHaveBeenLastCalledWith(expect.objectContaining({ state: "presenting" }), true);
    s = zoneState("presenting", frames, { held: false, ended: true });
    await tick();
    expect(cb.ended).toHaveBeenCalledTimes(1);
    expect(c.currentStage()).toBe("ended");
    // An ended clip keeps its last frame: no advancing frames is NOT a stall.
    for (let i = 0; i < 20; i++) await tick();
    expect(cb.fallback).not.toHaveBeenCalled();
    c.stop();
    expect(fire).toHaveBeenLastCalledWith("sharedVideoStop", session);
  });

  it("after play, frames that stop advancing fail the session within the stall budget (web takes over)", async () => {
    let s: unknown = zoneState("ready");
    const { c, cb } = harness(() => reply([s]));
    c.start();
    await tick();
    c.commit();
    s = zoneState("presenting", 1, { held: true });
    await tick();
    c.play();
    s = zoneState("presenting", 1, { held: false });
    for (let i = 0; i < NATIVE_ZONE_PLAY_STALL_MS / 500 + 2; i++) await tick();
    expect(cb.fallback).toHaveBeenCalledWith("output-stalled");
  });

  it("a native failure reports its reason code; a presenting session the page never committed is refused", async () => {
    let s: unknown = zoneState("failed", 0, { reason: "codec-failed" });
    const a = harness(() => reply([s]));
    a.c.start();
    await tick();
    expect(a.cb.fallback).toHaveBeenCalledWith("codec-failed");
    s = zoneState("presenting", 5);
    const b = harness(() => reply([s]));
    b.c.start();
    await tick();
    expect(b.cb.fallback).toHaveBeenCalledWith("uncommitted-output");
  });

  it("a reply that never comes back while native is `caching` ends the attempt with NO reason: retry, never a 24 h block (field 2026-10-12)", async () => {
    let n = 0;
    const a = harness(() => (++n === 1 ? reply([zoneState("preparing", 0, { reason: "caching" })]) : new Promise(() => {})));
    a.c.start();
    await tick();
    await tick(2500);
    expect(a.cb.fallback).toHaveBeenCalledTimes(1);
    expect(a.cb.fallback.mock.calls[0][0]).toBeUndefined();
    expect(nativeZoneNext(a.cb.fallback.mock.calls[0][0], 0)).toBe("retry");
  });

  it("an APK that does not answer protocol 3, or loses the slot, ends the attempt; a late reply only stops its own session", async () => {
    const a = harness(() => JSON.stringify({ version: 1, state: "idle", protocol: 2 }));
    a.c.start();
    await tick();
    expect(a.cb.fallback).toHaveBeenCalledWith("protocol");
    expect(nativeZoneNext(a.cb.fallback.mock.calls[0][0], 0)).toBe("stay");
    let s: unknown[] = [zoneState("ready")];
    const b = harness(() => reply(s));
    b.c.start();
    await tick();
    s = [];
    await tick();
    expect(b.cb.fallback).toHaveBeenCalledWith("session-lost");
    expect(b.fire).toHaveBeenLastCalledWith("sharedVideoStop", session);
  });

  it("a layout change re-positions the live surface without restarting; an identical layout sends nothing", async () => {
    const s: unknown = zoneState("ready");
    const { c, fire } = harness(() => reply([s]));
    c.start();
    await tick();
    const before = fire.mock.calls.length;
    c.layout({ ...layout });
    expect(fire.mock.calls.length).toBe(before);
    c.layout({ ...layout, x: 100, w: 800 });
    expect(JSON.parse(fire.mock.calls[fire.mock.calls.length - 1][1])).toMatchObject({ op: "layout", sessionId: session, layout: { x: 100, w: 800 } });
  });

  it("`superseded` after play is a clean end (the next slot took the glass), never a fallback; before play it is a transient failure", async () => {
    let s: unknown = zoneState("ready");
    const cb = { ready: jest.fn(), held: jest.fn(), update: jest.fn(), ended: jest.fn(), fallback: jest.fn(), superseded: jest.fn() };
    const fire = jest.fn(() => true);
    const c = new NativeZoneController(descriptor, descriptor.items[0], layout, { has: () => true, fire, state: async () => reply([s]) }, cb, () => Date.now());
    c.start();
    await tick();
    c.commit();
    s = zoneState("presenting", 1, { held: true });
    await tick();
    c.play();
    s = zoneState("presenting", 30);
    await tick();
    s = zoneState("failed", 30, { reason: "superseded" });
    await tick();
    expect(cb.superseded).toHaveBeenCalledTimes(1);
    expect(cb.fallback).not.toHaveBeenCalled();
    expect(c.currentStage()).toBe("ended");
    // Before play (never on glass) the same code is just a transient end.
    const early = harness(() => reply([zoneState("failed", 0, { reason: "superseded" })]));
    early.c.start();
    await tick();
    expect(early.cb.fallback).toHaveBeenCalledWith("superseded");
    expect(nativeZoneNext("superseded", 0)).toBe("retry");
    expect(nativeZoneNext("decoder-unavailable", 0)).toBe("retry");
  });

  it("without the four bridge methods nothing is sent and the owner keeps the web element", () => {
    const cb = { ready: jest.fn(), held: jest.fn(), update: jest.fn(), ended: jest.fn(), fallback: jest.fn(), revealed: jest.fn() };
    const fire = jest.fn(() => true);
    const c = new NativeZoneController(descriptor, descriptor.items[0], layout, { has: (m) => m !== "sharedVideoCommit", fire, state: async () => reply() }, cb);
    c.start();
    expect(fire).not.toHaveBeenCalled();
    expect(cb.fallback).toHaveBeenCalledWith("bridge-missing");
  });
});
