import {
  readNativeSharedVideoDescriptor,
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
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
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
