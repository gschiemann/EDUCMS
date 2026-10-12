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
  nativeVideoBuildScope,
  nativeVideoFallbackLine,
  nativeVideoBlockedLine,
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

/**
 * FIELD 2026-10-12 — M43 (c4945182…) and L55VEC (882706a8…), both Amlogic
 * T982 / Android 13, solo muted 2160×3338 H.264 30 fps, 186,954,348 bytes.
 * Railway HTTP logs: under APK 1.1.29 each box made a `Dalvik/2.1.0` manifest
 * GET (FaceVideoBox.select) ~0.6 s after the page's own manifest at 06:04Z, a
 * second one 41–60 s later (the re-select after the 186 MB download), and
 * then NEVER again — through the 1.1.30-field.1 install at 11:17/11:32Z.
 * Native was asked and downloaded; then the page wrote a 24 h block that
 * (a) was keyed by file + face only, so it outlived the APK upgrade, and
 * (b) could be written by a PAGE-side hiccup while native said `caching`.
 */
describe("field 2026-10-12: why native never engaged on the T982 pair", () => {
  const field: NativeVideoDescriptor = {
    version: 2,
    screenId: "c4945182-435e-4260-8765-8091243828cc",
    tenantId: "28d09f9d-0a6c-4828-b46d-38712eb69f1f",
    faceIndex: 0,
    revision: "f".repeat(64),
    asset: {
      id: "9c0eb1c6-2486-484a-863d-e74c2dde5e93",
      url: "https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/28d09f9d-0a6c-4828-b46d-38712eb69f1f/6bd9a41f-131e-4a96-a8e8-1b24f3ac2956.mp4",
      sha256: "d4d05533719e94ccc8d0a280149b1971a87a31f8641366b53e1fa97a071438dd",
      size: 186_954_348,
      width: 2160,
      height: 3338,
      fps: 30,
    },
    transform: { orientation: "AUTO", fit: "cover" },
  };
  const fieldState = (extra: Record<string, unknown> = {}) => ({
    ...state("preparing", 0),
    revision: field.revision,
    sha256: field.asset.sha256,
    ...extra,
  });
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("every web gate passes for these exact facts (descriptor, protocol-3 reply, eligibility)", () => {
    expect(readNativeVideoDescriptor(field)).toEqual(field);
    const reply = JSON.stringify({ version: 1, state: "idle", sessionId: null, protocol: 2, protocolMax: 3, sessions: [] });
    expect(readNativeVideoProtocol(reply)).toBe(3);
    expect(pickNativeVideo({ v2: field, v1: null, protocol: 3, v2Blocked: false })).toBe(field);
    expect(sharedVideoEligible(field, {
      screenId: field.screenId, tenantId: field.tenantId, assetId: field.asset.id, sha256: field.asset.sha256,
      solo: true, muted: true, active: true, emergency: false, sync: false, preview: false,
    })).toBe(true);
  });

  it("state replies that stop coming back while native is `caching` are a page hiccup: retry, never a 24 h block", async () => {
    const fallback = jest.fn();
    let replies = 0;
    const c = new SharedVideoController(field, {
      has: () => true,
      fire: () => true,
      // Native answered `caching` (downloading 186 MB), then the channel
      // reply stalled past the 2 s poll bound on a box busy decoding 4K.
      state: () => (++replies <= 2 ? Promise.resolve(fieldState({ reason: "caching" })) : new Promise(() => {})),
    }, { ready: jest.fn(), update: jest.fn(), fallback });
    c.start();
    await jest.advanceTimersByTimeAsync(60_000);
    expect(fallback).toHaveBeenCalledTimes(1);
    const reason = fallback.mock.calls[0][0] as string | undefined;
    expect(reason).toBeUndefined();
    expect(nativeVideoNext(2, reason, 0)).toBe("retry");
    c.stop();
  });

  it("one late reply before commit is tolerated (the download keeps going)", async () => {
    const fallback = jest.fn();
    let n = 0;
    const c = new SharedVideoController(field, {
      has: () => true,
      fire: () => true,
      state: () => (++n === 2 ? new Promise(() => {}) : Promise.resolve(fieldState({ reason: "caching" }))),
    }, { ready: jest.fn(), update: jest.fn(), fallback });
    c.start();
    await jest.advanceTimersByTimeAsync(20_000);
    expect(fallback).not.toHaveBeenCalled();
    expect(n).toBeGreaterThan(5);
    c.stop();
  });

  it("a block written under one APK build does not hold the file off native under the next build", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const sha = field.asset.sha256;
    blockNativeVideo(store, sha, 0, 1000, "1.1.29");
    expect(nativeVideoBlocked(store, sha, 0, 2000, "1.1.29")).toBe(true);
    expect(nativeVideoBlocked(store, sha, 0, 2000, "1.1.30-field.1")).toBe(false);
    // The pre-fix key shape (file:face, no build) no longer blocks an APK build.
    mem.set("edu.nativeVideo.block.v1", JSON.stringify({ [`${sha}:0`]: 1000 + NATIVE_VIDEO_BLOCK_MS }));
    expect(nativeVideoBlocked(store, sha, 0, 2000, "1.1.30-field.1")).toBe(false);
    expect(nativeVideoBuildScope("Mozilla/5.0 (Linux; Android 13; wv) Chrome/101 Safari/537.36 EduCmsPlayer/1.1.30-field.1 (Android 13)")).toBe("1.1.30-field.1");
    expect(nativeVideoBuildScope("Mozilla/5.0 Chrome/120")).toBe("");
  });

  it("every fallback leaves one diagnosable line the APK persists and the API keeps", () => {
    const line = nativeVideoFallbackLine({ reason: undefined, next: "retry", attempt: 0, protocol: 2, faceIndex: 0, sha256: field.asset.sha256 });
    // MainActivity.onConsoleMessage persists a warn that starts `[Player]` and matches /fallback/i.
    expect(line.startsWith("[Player] PLAYER_NATIVE_VIDEO_FALLBACK ")).toBe(true);
    expect(/stalled|failed|fallback|checksum/i.test(line)).toBe(true);
    expect(line).toContain("reason=none");
    expect(line).toContain("next=retry");
    expect(line).toContain("sha=d4d05533");
    expect(line).not.toMatch(/https?:/);
    const blocked = nativeVideoBlockedLine({ faceIndex: 0, sha256: field.asset.sha256, build: "1.1.30-field.1" });
    expect(blocked.startsWith("[Player] PLAYER_NATIVE_VIDEO_BLOCKED ")).toBe(true);
    expect(/fallback/i.test(blocked)).toBe(true);
  });
});
