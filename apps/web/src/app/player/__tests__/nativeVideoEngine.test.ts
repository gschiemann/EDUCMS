/**
 * Protocol 2 — the per-face native video engine (2026-10-12).
 * API: apps/api/src/screens/native-video.ts · APK: media/FaceVideoPolicy.kt.
 */
import {
  blockNativeVideo,
  nativeVideoBlocked,
  NATIVE_VIDEO_BLOCK_MS,
  NATIVE_VIDEO_TRANSIENT_REASONS,
  pickNativeVideo,
  readNativeVideoDescriptor,
  readNativeVideoProtocol,
  readNativeSharedVideoDescriptor,
  SharedVideoController,
  sharedVideoEligible,
  sharedVideoIdentity,
  type NativeSharedVideoDescriptor,
  type NativeVideoDescriptor,
} from "../nativeSharedVideo";
import { nativeVideoNext } from "../NativeDualVideo";

const screen = "40864836-9367-47a3-b349-ba1c3378f814";
const tenant = "28d09f9d-0a6c-4828-b46d-38712eb69f1f";
const assetId = "9c0eb1c6-2486-484a-863d-e74c2dde5e93";
const digest = "d".repeat(64);
const session = "11111111-1111-1111-1111-111111111111";
const v2: NativeVideoDescriptor = {
  version: 2,
  screenId: screen,
  tenantId: tenant,
  faceIndex: 0,
  revision: "rev2",
  asset: {
    id: assetId,
    url: "https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/tenant/file.mp4",
    sha256: digest,
    size: 84_040_105,
    width: 1920,
    height: 1080,
    fps: 30,
  },
  transform: { orientation: "LANDSCAPE", fit: "cover" },
};
const v1: NativeSharedVideoDescriptor = {
  version: 1,
  screenId: screen,
  tenantId: tenant,
  primaryScreenId: screen,
  peerScreenId: "80bf9b8d-1271-4b21-bb5b-0626ce6a8092",
  faceIndex: 0,
  revision: "rev1",
  asset: v2.asset,
  transform: { orientation: "LANDSCAPE", rotation: 0, fit: "fill" },
};
const state = (kind = "preparing", frames = 0, extra: Record<string, unknown> = {}) => ({
  version: 1,
  state: kind,
  sessionId: session,
  revision: "rev2",
  sha256: digest,
  faceIndex: 0,
  output: {
    attached: true, visible: true, hardwareAccelerated: true,
    viewUpdates: frames, uniqueFrames: frames, sourcePtsUs: 1,
    width: 1920, height: 1080, ageMs: 0, lastUpdateElapsedMs: 1,
  },
  ...extra,
});
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};

describe("protocol 2 descriptor", () => {
  it("is per screen: no peer needed, either face, every fit", () => {
    expect(readNativeVideoDescriptor(v2)).toEqual(v2);
    expect(readNativeVideoDescriptor({ ...v2, faceIndex: 1 })?.faceIndex).toBe(1);
    for (const fit of ["cover", "contain", "fill"])
      expect(readNativeVideoDescriptor({ ...v2, transform: { ...v2.transform, fit } })?.transform.fit).toBe(fit);
  });
  it("refuses anything outside the contract, and the two versions never cross", () => {
    for (const bad of [
      { ...v2, version: 1 },
      { ...v2, faceIndex: 2 },
      { ...v2, screenId: "nope" },
      { ...v2, transform: { ...v2.transform, fit: "stretch" } },
      { ...v2, asset: { ...v2.asset, fps: 60 } },
      { ...v2, asset: { ...v2.asset, url: "https://evil.example/storage/v1/object/public/assets/x.mp4" } },
      { ...v2, asset: { ...v2.asset, url: v2.asset.url.replace("assets/", "assets/%2e%2e/") } },
    ])
      expect(readNativeVideoDescriptor(bad)).toBeNull();
    expect(readNativeSharedVideoDescriptor(v2)).toBeNull();
    expect(readNativeVideoDescriptor(v1)).toBeNull();
  });
  it("identity differs between engines for the same file", () => {
    expect(sharedVideoIdentity(v2)).not.toBe(sharedVideoIdentity(v1));
  });
});

describe("which engine a document uses", () => {
  it("reads the APK protocol from one state reply", () => {
    expect(readNativeVideoProtocol(JSON.stringify({ version: 1, state: "idle", protocol: 2 }))).toBe(2);
    expect(readNativeVideoProtocol({ version: 1, state: "idle" })).toBe(1);
    // A refused bridge / garbage is NOT a protocol.
    expect(readNativeVideoProtocol({ version: 1, state: "failed", reason: "bridge-refused" })).toBeNull();
    expect(readNativeVideoProtocol("not json")).toBeNull();
    expect(readNativeVideoProtocol(null)).toBeNull();
  });
  it("protocol 2 only on an APK that proved it; the field pair keeps protocol 1", () => {
    expect(pickNativeVideo({ v2, v1, protocol: 2, v2Blocked: false })).toBe(v2);
    expect(pickNativeVideo({ v2, v1, protocol: 1, v2Blocked: false })).toBe(v1);
    expect(pickNativeVideo({ v2, v1: null, protocol: 1, v2Blocked: false })).toBeNull();
    expect(pickNativeVideo({ v2, v1, protocol: 2, v2Blocked: true })).toBe(v1);
    // Unknown protocol: web until the APK answers (no bridge = web forever).
    expect(pickNativeVideo({ v2, v1, protocol: null, v2Blocked: false })).toBeNull();
  });
  it("eligibility keeps every web-only case on the web for protocol 2 too", () => {
    const ctx = {
      screenId: screen, tenantId: tenant, assetId, sha256: digest,
      solo: true, muted: true, active: true, emergency: false, sync: false, preview: false,
    };
    expect(sharedVideoEligible(v2, ctx)).toBe(true);
    for (const k of ["emergency", "sync", "preview"] as const)
      expect(sharedVideoEligible(v2, { ...ctx, [k]: true })).toBe(false);
    for (const k of ["solo", "muted", "active"] as const)
      expect(sharedVideoEligible(v2, { ...ctx, [k]: false })).toBe(false);
    expect(sharedVideoEligible(v2, { ...ctx, sha256: "e".repeat(64) })).toBe(false);
    expect(sharedVideoEligible(v2, { ...ctx, screenId: v1.peerScreenId })).toBe(false);
  });
});

describe("protocol 2 controller", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("asks for the face's own selection by identity only — never a URL", () => {
    const fire = jest.fn((_m: string, _a: string) => true);
    const c = new SharedVideoController(v2, { has: () => true, fire, state: async () => state() },
      { ready: jest.fn(), update: jest.fn(), fallback: jest.fn() });
    c.start();
    const [method, arg] = fire.mock.calls[0];
    expect(method).toBe("sharedVideoPrepare");
    expect(JSON.parse(arg)).toEqual({ version: 2, screenId: screen, revision: "rev2", sha256: digest, assetId });
    expect(arg).not.toContain("http");
    c.stop();
  });

  it("while native downloads + verifies (`caching`) the web keeps playing past the normal window", async () => {
    const fallback = jest.fn();
    let clock = 0;
    let reason: string | undefined = "caching";
    const c = new SharedVideoController(v2, { has: () => true, fire: () => true, state: async () => state("preparing", 0, { reason }) },
      { ready: jest.fn(), update: jest.fn(), fallback }, () => clock);
    c.start();
    clock = 20 * 60 * 1000;
    await jest.advanceTimersByTimeAsync(1000);
    expect(fallback).not.toHaveBeenCalled();
    clock = 3 * 60 * 60 * 1000 + 1;
    await jest.advanceTimersByTimeAsync(1000);
    expect(fallback).toHaveBeenCalledTimes(1);
    // Without `caching`, the normal 330 s window applies.
    const f2 = jest.fn();
    clock = 0; reason = undefined;
    const c2 = new SharedVideoController(v2, { has: () => true, fire: () => true, state: async () => state("preparing", 0, { reason }) },
      { ready: jest.fn(), update: jest.fn(), fallback: f2 }, () => clock);
    c2.start();
    clock = 331_000;
    await jest.advanceTimersByTimeAsync(1000);
    expect(f2).toHaveBeenCalledTimes(1);
    c.stop(); c2.stop();
  });

  it("hands the native end code to the page", async () => {
    const fallback = jest.fn();
    const c = new SharedVideoController(v2, { has: () => true, fire: () => true, state: async () => state("failed", 0, { reason: "codec-stalled" }) },
      { ready: jest.fn(), update: jest.fn(), fallback });
    c.start();
    await settle();
    expect(fallback).toHaveBeenCalledWith("codec-stalled");
  });
});

describe("what a native end means next", () => {
  it("transient ends retry (bounded); a native fault blocks the file; protocol 1 is unchanged", () => {
    expect(nativeVideoNext(2, "activity-paused", 0)).toBe("retry");
    expect(nativeVideoNext(2, undefined, 0)).toBe("retry");
    expect(nativeVideoNext(2, "activity-paused", 19)).toBe("stay");
    expect(nativeVideoNext(2, "codec-failed", 0)).toBe("block");
    expect(nativeVideoNext(2, "hardware-codec-unavailable", 0)).toBe("block");
    expect(nativeVideoNext(1, "codec-failed", 0)).toBe("stay");
    expect(NATIVE_VIDEO_TRANSIENT_REASONS.has("emergency-held")).toBe(true);
  });
  it("a block is per file per face, expires after a day, and survives a broken store", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(nativeVideoBlocked(store, digest, 0, 1000)).toBe(false);
    blockNativeVideo(store, digest, 0, 1000);
    expect(nativeVideoBlocked(store, digest, 0, 2000)).toBe(true);
    expect(nativeVideoBlocked(store, digest, 1, 2000)).toBe(false);
    expect(nativeVideoBlocked(store, digest, 0, 1000 + NATIVE_VIDEO_BLOCK_MS + 1)).toBe(false);
    mem.set("edu.nativeVideo.block.v1", "{corrupt");
    expect(nativeVideoBlocked(store, digest, 0, 2000)).toBe(false);
    blockNativeVideo(store, digest, 0, 1000);
    expect(nativeVideoBlocked(store, digest, 0, 2000)).toBe(true);
    expect(nativeVideoBlocked(null, digest, 0, 2000)).toBe(false);
  });
});
