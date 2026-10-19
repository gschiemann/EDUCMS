import {
  nativeOrientationRequest,
  readNativeDeviceClass,
  readNativeSharedVideoDescriptor,
  readNativeSharedVideoState,
  readNativeVideoDescriptor,
  readNativeVideoTiming,
  sharedVideoIdentity,
  SharedVideoController,
  SharedVideoEvidence,
  type NativeSharedVideoDescriptor,
} from "../nativeSharedVideo";
const primary = "40864836-9367-47a3-b349-ba1c3378f814";
const peer = "80bf9b8d-1271-4b21-bb5b-0626ce6a8092";
const digest = "d".repeat(64),
  session = "11111111-1111-1111-1111-111111111111";
const descriptor: NativeSharedVideoDescriptor = {
  version: 1,
  screenId: primary,
  tenantId: "28d09f9d-0a6c-4828-b46d-38712eb69f1f",
  primaryScreenId: primary,
  peerScreenId: peer,
  faceIndex: 0,
  revision: "rev",
  asset: {
    id: "9c0eb1c6-2486-484a-863d-e74c2dde5e93",
    url: "https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/tenant/file.mp4",
    sha256: digest,
    size: 84_040_105,
    width: 1080,
    height: 1668,
    fps: 30,
  },
  transform: { orientation: "PORTRAIT", rotation: 0, fit: "fill" },
};
const state = (kind = "preparing", frames = 0, sid = session) => ({
  version: 1,
  state: kind,
  sessionId: sid,
  revision: "rev",
  sha256: digest,
  faceIndex: 0,
  output: {
    attached: true,
    visible: true,
    hardwareAccelerated: true,
    viewUpdates: frames,
    uniqueFrames: frames,
    sourcePtsUs: 1,
    width: 1080,
    height: 1920,
    ageMs: 0,
    lastUpdateElapsedMs: 1,
  },
});
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
describe("optional native output handoff", () => {
  it("preserves actual composition and session facts without promoting capability to presentation proof", () => {
    const base = state("ready");
    const parsed = readNativeSharedVideoState({ ...base, sessionProtocol: 2,
      output: { ...base.output, layerMode: "revealing", compositionMode: "static_above" } });
    expect(parsed?.sessionProtocol).toBe(2);
    expect(parsed?.output).toMatchObject({ layerMode: "revealing", compositionMode: "static_above", uniqueFrames: 0 });
    const unknown = readNativeSharedVideoState({ ...base, sessionProtocol: 99,
      output: { ...base.output, layerMode: "invented", compositionMode: "secret-url" } });
    expect(unknown?.sessionProtocol).toBeUndefined();
    expect(unknown?.output?.layerMode).toBeUndefined();
    expect(unknown?.output?.compositionMode).toBeUndefined();
  });
  it("carries bounded scheduling diagnostics separately from rendered-frame evidence", () => {
    const timing = { decodedFrames: 90, submittedFrames: 88, lateFrames: 2, lastLateUs: 0,
      maxLateUs: 120000, maxSubmitGapMs: 150, leadUs: 33333, sourceWidth: 2160, sourceHeight: 3338 };
    const parsed = readNativeSharedVideoState({ ...state("ready"), timing });
    expect(parsed?.timing).toEqual(timing);
    expect(parsed?.output?.uniqueFrames).toBe(0);
    expect(readNativeSharedVideoState({ ...state(), timing: { ...timing, maxLateUs: -1 } })?.timing).toBeUndefined();
    expect(readNativeSharedVideoState(state())?.timing).toBeUndefined();
  });
  it("1.1.41: copies the glass-side measurement, bounded, and drops what it does not know", () => {
    const nine = { decodedFrames: 90, submittedFrames: 88, lateFrames: 2, lastLateUs: 0,
      maxLateUs: 120000, maxSubmitGapMs: 150, leadUs: 33333, sourceWidth: 2160, sourceHeight: 3338 };
    const buckets = Array.from({ length: 16 }, (_, i) => (i === 4 ? 1700 : 0));
    const entry = { at: 1760700000000, face: 0, sha8: "d4d05533", build: "1.1.41-field.1", protocol: 2, composition: "static_above",
      layer: "retired", reason: "device-rebooted", recovered: true, bootCount: 41, elapsedMs: 10, fps: 30, refreshRate: 60, displayMode: "1:1920x1080@60.00",
      decodedFrames: 5, droppedFrames: 1, codecName: "OMX.rk.video_decoder.avc", webviewInvisible: true, surfaceFrameRate: "only-if-seamless",
      intervalUnitNs: 8333333, intervalBuckets: buckets, intervalCount: 1700, url: "https://evil.example" };
    const full = { ...nine, droppedFrames: 3, sourceFps: 30, refreshRate: 60, displayMode: "2:3840x2160@59.94", intervalUnitNs: 8333333,
      intervalBuckets: buckets, intervalCount: 1700, intervalMinNs: 31000000, intervalMaxNs: 36000000, intervalLastNs: 33300000, intervalMeanNs: 33333333,
      history: { entries: [entry, { at: "soon" }, { at: 1, protocol: 7, composition: "under_window", displayMode: "x" }], overflow: 2, capacity: 6 },
      somethingNew: 1 };
    const t = readNativeVideoTiming(full)!;
    expect(t).toMatchObject({ ...nine, droppedFrames: 3, sourceFps: 30, refreshRate: 60, displayMode: "2:3840x2160@59.94", intervalBuckets: buckets, intervalCount: 1700 });
    expect(t).not.toHaveProperty("somethingNew");
    expect(t.history?.overflow).toBe(2);
    expect(t.history?.capacity).toBe(6);
    expect(t.history?.entries).toHaveLength(2);
    expect(t.history?.entries[0]).toMatchObject({ at: 1760700000000, sha8: "d4d05533", build: "1.1.41-field.1", composition: "static_above", reason: "device-rebooted", recovered: true, bootCount: 41, intervalBuckets: buckets, webviewInvisible: true, surfaceFrameRate: "only-if-seamless" });
    expect(t.history?.entries[0]).not.toHaveProperty("url");
    expect(t.history?.entries[1]).toEqual({ at: 1 });
    // Malformed measurement fields are dropped one by one; the nine counters survive.
    const junk = readNativeVideoTiming({ ...nine, intervalBuckets: buckets.slice(0, 15), displayMode: "free text", refreshRate: -1, droppedFrames: 1.5, history: { entries: "no", overflow: 0 } })!;
    expect(junk).toEqual(nine);
    // An old APK's nine counters are exactly what they were.
    expect(readNativeVideoTiming(nine)).toEqual(nine);
    expect(readNativeVideoTiming({ ...nine, decodedFrames: -1 })).toBeUndefined();
  });

  it("1.1.41: the device class and the session experiments ride on the state, bounded", () => {
    const device = { class: "rockchip/android-7", fleet: "Rockchip rk3288 / Android 7.1 (DH43)", soc: "rockchip", sdk: 25, webviewMajor: 87,
      nativeSolo: true, composition: "static_above", protocol3: false, silentUpdate: "tap", qualified: null, serial: "nope" };
    const experiments = { requested: { webviewInvisible: true, decoderRotation: "yes" }, applied: { webviewInvisible: true, surfaceFrameRate: "refused" },
      guard: { disabled: { webviewInvisible: "page-lease-expired", other: "x" }, applied: { webviewInvisible: 2 } } };
    const parsed = readNativeSharedVideoState({ ...state("presenting", 10), device, experiments })!;
    expect(parsed.device).toEqual({ class: "rockchip/android-7", fleet: "Rockchip rk3288 / Android 7.1 (DH43)", soc: "rockchip", sdk: 25, webviewMajor: 87, nativeSolo: true, composition: "static_above", protocol3: false, silentUpdate: "tap" });
    expect(parsed.experiments).toEqual({ requested: { webviewInvisible: true }, applied: { webviewInvisible: true, surfaceFrameRate: "refused" }, guard: { disabled: { webviewInvisible: "page-lease-expired" }, applied: { webviewInvisible: 2 } } });
    expect(readNativeSharedVideoState({ ...state(), device: { ...device, class: "M43 Goodview" } })?.device).toBeUndefined();
    expect(readNativeSharedVideoState({ ...state(), device: { ...device, silentUpdate: "magic" } })?.device).toBeUndefined();
    expect(readNativeSharedVideoState(state())?.device).toBeUndefined();
    expect(readNativeSharedVideoState({ ...state(), experiments: { requested: {} } })?.experiments).toBeUndefined();
    expect(readNativeDeviceClass({ class: "novastar/android-11", soc: "novastar", sdk: 30, webviewMajor: 83, nativeSolo: false, protocol3: false, silentUpdate: "tap", qualified: "2026-10-21" }))
      .toEqual({ class: "novastar/android-11", soc: "novastar", sdk: 30, webviewMajor: 83, nativeSolo: false, protocol3: false, silentUpdate: "tap", qualified: "2026-10-21" });
    // Owner 2026-10-17: the Manager is never device owner, so that path is not a value a state may carry.
    expect(readNativeDeviceClass({ class: "rockchip/android-7", soc: "rockchip", sdk: 25, webviewMajor: 87, nativeSolo: true, protocol3: true, silentUpdate: "device-owner" })).toBeNull();
  });

  it("1.1.41: the experiment flags ride on the protocol-2 descriptor outside its identity, and only decoderRotation changes the orientation request", () => {
    const v2 = { version: 2, screenId: primary, tenantId: "28d09f9d-0a6c-4828-b46d-38712eb69f1f", faceIndex: 0, revision: "rev",
      asset: descriptor.asset, transform: { orientation: "PORTRAIT", fit: "fill" } };
    const plain = readNativeVideoDescriptor(v2)!;
    expect(plain).not.toHaveProperty("experiments");
    const flagged = readNativeVideoDescriptor({ ...v2, experiments: { webviewInvisible: true, decoderRotation: true, surfaceFrameRate: "true", bogus: true } })!;
    expect(flagged.experiments).toEqual({ webviewInvisible: true, decoderRotation: true });
    expect(readNativeVideoDescriptor({ ...v2, experiments: { surfaceFrameRate: false } })).not.toHaveProperty("experiments");
    expect(sharedVideoIdentity(flagged)).toBe(sharedVideoIdentity(plain));
    expect(nativeOrientationRequest("PORTRAIT", flagged)).toBe("NATURAL");
    expect(nativeOrientationRequest("LANDSCAPE", flagged)).toBe("NATURAL");
    expect(nativeOrientationRequest("AUTO", flagged)).toBe("AUTO");
    expect(nativeOrientationRequest("PORTRAIT", plain)).toBe("PORTRAIT");
    expect(nativeOrientationRequest("PORTRAIT", readNativeVideoDescriptor({ ...v2, experiments: { webviewInvisible: true } }))).toBe("PORTRAIT");
    expect(nativeOrientationRequest("PORTRAIT", null)).toBe("PORTRAIT");
  });
  it("1.1.42: the pacing measurement, the panel's modes, the window flag and the two new experiments ride bounded, and nothing unknown gets through", () => {
    const nine = { decodedFrames: 90, submittedFrames: 88, lateFrames: 2, lastLateUs: 0,
      maxLateUs: 120000, maxSubmitGapMs: 150, leadUs: 33333, sourceWidth: 2160, sourceHeight: 3338 };
    const modes = ["1:3840x2160@30.00", "2:3840x2160@60.00", "3:1920x1080@60.00"];
    const t = readNativeVideoTiming({ ...nine, snappedFrames: 1800, snapErrorMaxUs: 9, snapErrorMeanUs: 2, clockSlewUs: -12345, vsyncPeriodUs: 16666, vsyncSamples: 3600,
      supportedModes: modes, preferredModeApplied: 2, preferredModeResult: "applied", keepScreenOn: true,
      history: { entries: [{ at: 5, vsyncSnap: true, prefer60hz: "kept", preferredModeApplied: 2, keepScreenOn: false, snappedFrames: 7, clockSlewUs: 42, vsyncPeriodUs: 33333, vsyncSamples: 9, snapErrorMaxUs: 1, snapErrorMeanUs: 0, supportedModes: modes }], overflow: 0 } })!;
    expect(t).toMatchObject({ ...nine, snappedFrames: 1800, snapErrorMaxUs: 9, snapErrorMeanUs: 2, clockSlewUs: -12345, vsyncPeriodUs: 16666, vsyncSamples: 3600,
      supportedModes: modes, preferredModeApplied: 2, preferredModeResult: "applied", keepScreenOn: true });
    expect(t.history?.entries[0]).toEqual({ at: 5, vsyncSnap: true, prefer60hz: "kept", preferredModeApplied: 2, keepScreenOn: false, snappedFrames: 7, clockSlewUs: 42, vsyncPeriodUs: 33333, vsyncSamples: 9, snapErrorMaxUs: 1, snapErrorMeanUs: 0 });
    // Malformed shapes drop one by one: 17 modes, a free-text mode, a fractional slew, a string flag, a free-text result.
    const junk = readNativeVideoTiming({ ...nine, supportedModes: Array(17).fill(modes[0]), preferredModeResult: "mode 2 please", clockSlewUs: 1.5, keepScreenOn: "yes", snappedFrames: -1 })!;
    expect(junk).toEqual(nine);
    expect(readNativeVideoTiming({ ...nine, supportedModes: ["4K sixty"] })).toEqual(nine);
    // The device class carries what the panel runs and offers; an unreadable display is the 1.1.41 shape.
    const base = { class: "amlogic/android-13", soc: "amlogic", sdk: 33, webviewMajor: 101, nativeSolo: true, protocol3: true, silentUpdate: "tap" };
    expect(readNativeDeviceClass({ ...base, refreshRate: 30, activeMode: "1:3840x2160@30.00", supportedModes: modes })).toEqual({ ...base, refreshRate: 30, activeMode: "1:3840x2160@30.00", supportedModes: modes });
    expect(readNativeDeviceClass({ ...base, activeMode: "", supportedModes: [] })).toEqual({ ...base, activeMode: "", supportedModes: [] });
    expect(readNativeDeviceClass({ ...base, refreshRate: -1, activeMode: "4K", supportedModes: Array(17).fill(modes[0]) })).toEqual(base);
    // The two new experiments: flags on the descriptor and the state, applied values and guard entries by their names only.
    const v2 = { version: 2, screenId: primary, tenantId: "28d09f9d-0a6c-4828-b46d-38712eb69f1f", faceIndex: 0, revision: "rev",
      asset: descriptor.asset, transform: { orientation: "PORTRAIT", fit: "fill" } };
    const flagged = readNativeVideoDescriptor({ ...v2, experiments: { vsyncSnap: true, prefer60hz: true, "vsync-snap": true, sixtyHertz: true } })!;
    expect(flagged.experiments).toEqual({ vsyncSnap: true, prefer60hz: true });
    expect(sharedVideoIdentity(flagged)).toBe(sharedVideoIdentity(readNativeVideoDescriptor(v2)!));
    expect(nativeOrientationRequest("PORTRAIT", flagged)).toBe("PORTRAIT");
    const experiments = { requested: { vsyncSnap: true, prefer60hz: true }, applied: { webviewInvisible: false, vsyncSnap: true, prefer60hz: "applied", bogus: 1 },
      guard: { disabled: { vsyncSnap: "output-stalled", other: "x" }, applied: { vsyncSnap: 1, prefer60hz: 1 } } };
    expect(readNativeSharedVideoState({ ...state("presenting", 10), experiments })?.experiments)
      .toEqual({ requested: { vsyncSnap: true, prefer60hz: true }, applied: { webviewInvisible: false, vsyncSnap: true, prefer60hz: "applied" }, guard: { disabled: { vsyncSnap: "output-stalled" }, applied: { vsyncSnap: 1, prefer60hz: 1 } } });
    expect(readNativeSharedVideoState({ ...state("presenting", 10), experiments: { ...experiments, applied: { webviewInvisible: false, vsyncSnap: "yes", prefer60hz: "http://x" } } })?.experiments?.applied)
      .toEqual({ webviewInvisible: false });
  });
  it("1.1.43: the grid-sized lead rides with the snap figures, and the always-present `requested` block reaches the API as `true` keys only", () => {
    const nine = { decodedFrames: 90, submittedFrames: 88, lateFrames: 2, lastLateUs: 0,
      maxLateUs: 120000, maxSubmitGapMs: 150, leadUs: 33333, sourceWidth: 2160, sourceHeight: 3338 };
    const t = readNativeVideoTiming({ ...nine, snappedFrames: 1800, vsyncPeriodUs: 16666, vsyncSamples: 3600, releaseLeadUs: 8333,
      history: { entries: [{ at: 5, vsyncSnap: true, prefer60hz: "blocked", snappedFrames: 7, vsyncPeriodUs: 33333, vsyncSamples: 9, releaseLeadUs: 26666 }], overflow: 0 } })!;
    expect(t.releaseLeadUs).toBe(8333);
    expect(t.history?.entries[0]).toMatchObject({ prefer60hz: "blocked", releaseLeadUs: 26666 });
    expect(readNativeVideoTiming({ ...nine, releaseLeadUs: -1 })).toEqual(nine);
    // Since 1.1.43 every session report carries `requested` with EVERY key — `false` for whatever is not in effect
    // (FaceVideoBox.sessionJson). The API's strict schema accepts only `true`; the page passes exactly those on.
    const requested = { webviewInvisible: false, surfaceFrameRate: false, decoderRotation: false, vsyncSnap: true, prefer60hz: false };
    const experiments = { requested, applied: { webviewInvisible: false, surfaceFrameRate: null, vsyncSnap: true, prefer60hz: "no-60hz-mode" },
      guard: { disabled: {}, applied: {} } };
    expect(readNativeSharedVideoState({ ...state("presenting", 10), experiments })?.experiments?.requested).toEqual({ vsyncSnap: true });
  });
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it("accepts fill and cover (2026-10-11 crop-to-fill), refuses any other fit", () => {
    expect(readNativeSharedVideoDescriptor(descriptor)?.transform.fit).toBe("fill");
    const cover = { ...descriptor, transform: { ...descriptor.transform, fit: "cover" } };
    expect(readNativeSharedVideoDescriptor(cover)?.transform.fit).toBe("cover");
    for (const fit of ["contain", "stretch", "", null])
      expect(
        readNativeSharedVideoDescriptor({ ...descriptor, transform: { ...descriptor.transform, fit } }),
      ).toBeNull();
  });
  it("accepts both reciprocal face identities, rejects invented parent/peer and unsafe media", () => {
    expect(readNativeSharedVideoDescriptor(descriptor)).not.toBeNull();
    const rear = {
      ...descriptor,
      screenId: peer,
      peerScreenId: primary,
      faceIndex: 1,
    };
    expect(readNativeSharedVideoDescriptor(rear)).not.toBeNull();
    expect(
      readNativeSharedVideoDescriptor({ ...rear, peerScreenId: peer }),
    ).toBeNull();
    expect(
      readNativeSharedVideoDescriptor({ ...descriptor, screenId: peer }),
    ).toBeNull();
    for (const change of [
      { width: 720.5 },
      { height: 5000 },
      { size: 0 },
      { fps: 60 },
      {
        url: "http://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/x",
      },
      {
        url: "https://bhdaxzfalaycfopvcopm.supabase.co.evil.com/storage/v1/object/public/assets/x",
      },
    ])
      expect(
        readNativeSharedVideoDescriptor({
          ...descriptor,
          asset: { ...descriptor.asset, ...change },
        }),
      ).toBeNull();
  });
  it("old APK capabilities fall back without preparing or acquiring a decoder", () => {
    const fire = jest.fn(),
      fallback = jest.fn();
    new SharedVideoController(
      descriptor,
      { has: () => false, fire, state: async () => state() },
      { ready: jest.fn(), update: jest.fn(), fallback },
    ).start();
    expect(fire).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
  });
  it("cannot commit before native readiness and cannot prove a frame from ready alone", async () => {
    const fire = jest.fn((_method: string, _arg: string) => true),
      ready = jest.fn(),
      update = jest.fn(),
      fallback = jest.fn();
    let next = state();
    const c = new SharedVideoController(
      descriptor,
      { has: () => true, fire, state: async () => next },
      { ready, update, fallback },
      () => jest.now(),
    );
    c.start();
    c.commit();
    await settle();
    expect(fire.mock.calls.map((x) => x[0])).toEqual(["sharedVideoPrepare"]);
    next = state("ready");
    await jest.advanceTimersByTimeAsync(500);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(update.mock.calls.at(-1)?.[1]).toBe(false);
    c.commit();
    expect(fire.mock.calls.at(-1)?.[0]).toBe("sharedVideoCommit");
    next = state("presenting", 4);
    await jest.advanceTimersByTimeAsync(500);
    expect(update.mock.calls.at(-1)?.[1]).toBe(true);
    await jest.advanceTimersByTimeAsync(6000);
    expect(fallback).toHaveBeenCalledTimes(1);
    c.stop();
  });
  it("late state cannot stop a new session with the same content identity", async () => {
    const fire = jest.fn((_method: string, _arg: string) => true),
      fallback = jest.fn();
    let answer!: (v: unknown) => void;
    const c = new SharedVideoController(
      descriptor,
      {
        has: () => true,
        fire,
        state: () =>
          new Promise((resolve) => {
            answer = resolve;
          }),
      },
      { ready: jest.fn(), update: jest.fn(), fallback },
    );
    c.start();
    await settle();
    c.stop();
    answer(state("ready", 0, "22222222-2222-2222-2222-222222222222"));
    await settle();
    expect(fire.mock.calls.map((x) => x[0])).toEqual(["sharedVideoPrepare"]);
    expect(fallback).not.toHaveBeenCalled();
  });
  it("a synchronous bridge exception follows the bounded fallback", async () => {
    const fallback = jest.fn();
    const c = new SharedVideoController(
      descriptor,
      {
        has: () => true,
        fire: () => true,
        state: () => {
          throw Error("unavailable");
        },
      },
      { ready: jest.fn(), update: jest.fn(), fallback },
    );
    c.start();
    await settle();
    expect(fallback).toHaveBeenCalledTimes(1);
  });
  it("evidence requires this document owner, advancing output, visibility and freshness", () => {
    const e = new SharedVideoEvidence(),
      owner = {},
      other = {};
    e.select(owner);
    e.update(other, state("presenting", 20) as any, true, 1000);
    expect(e.canProve(1001)).toBe(false);
    e.update(owner, state("ready", 20) as any, false, 1000);
    expect(e.canProve(1001)).toBe(false);
    e.update(owner, state("presenting", 20) as any, true, 1000);
    expect(e.canProve(1001)).toBe(true);
    e.commitProof();
    expect(e.canProve(1001)).toBe(false);
    e.update(owner, state("presenting", 21) as any, true, 1100);
    expect(e.canProve(4000)).toBe(false);
    e.clear(owner);
    expect(e.isSelected()).toBe(false);
  });
});
