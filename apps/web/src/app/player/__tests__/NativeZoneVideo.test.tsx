/**
 * Protocol 3 hand-off sequencing at the React layer (NativeZoneVideo.tsx):
 * the web element stays until native HOLDS the first frame AND the slot is
 * on glass; then, in one commit, the children unmount, the hole opens and
 * `play` goes out. Any native end remounts the web element. An APK that does
 * not answer protocol 3 leaves everything exactly as it is.
 */
import { act, render } from "@testing-library/react";
import React from "react";

const bridge = {
  has: jest.fn((_m: string) => true),
  fire: jest.fn((_m: string, ..._a: unknown[]) => true),
  call: jest.fn(async (_m: string) => "{}"),
};
jest.mock("../nativeBridge", () => ({
  nativeHas: (m: string) => bridge.has(m),
  nativeFire: (m: string, ...a: unknown[]) => bridge.fire(m, ...a),
  nativeCall: (m: string) => bridge.call(m),
}));

import { HANDOFF_OVERLAP_MS, NativeZoneVideo, nativeZoneTelemetry } from "../NativeZoneVideo";
import type { NativeVideoItemsDescriptor, ZoneLayout } from "../nativeZones";

const screen = "40864836-9367-47a3-b349-ba1c3378f814";
const tenant = "28d09f9d-0a6c-4828-b46d-38712eb69f1f";
const assetA = "9c0eb1c6-2486-484a-863d-e74c2dde5e93";
const digestA = "a".repeat(64);
const session = "11111111-1111-1111-1111-111111111111";
const url = "https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/tenant/file.mp4";
const descriptor: NativeVideoItemsDescriptor = {
  version: 3, screenId: screen, tenantId: tenant, faceIndex: 0, revision: "rev3", orientation: "LANDSCAPE",
  items: [{ slot: "item:v1", loop: false, asset: { id: assetA, url, sha256: digestA, size: 10_000_000, width: 1920, height: 1080, fps: 30 } }],
};
const layout: ZoneLayout = { x: 0, y: 0, w: 1920, h: 1080, vw: 1920, vh: 1080, degrees: 0, fit: "cover" };
const zoneState = (kind = "preparing", frames = 0, extra: Record<string, unknown> = {}) => ({
  slot: "item:v1", state: kind, sessionId: session, revision: "rev3", sha256: digestA,
  output: { attached: true, visible: true, hardwareAccelerated: true, viewUpdates: frames, uniqueFrames: frames, sourcePtsUs: 1, width: 1920, height: 1080, ageMs: 0, lastUpdateElapsedMs: 1 },
  ...extra,
});
let reply: unknown = { version: 1, state: "idle", protocol: 2, protocolMax: 3, sessions: [] };
const setSessions = (sessions: unknown[]) => { reply = { version: 1, state: "idle", protocol: 2, protocolMax: 3, sessions }; };

const flush = async (ms = 500) => {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
    jest.advanceTimersByTime(ms);
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
};
const ops = () => bridge.fire.mock.calls.map(([m, a]) => (m === "sharedVideoPrepare" ? JSON.parse(String(a)).op : m));

function mount(active: boolean, extra: Partial<React.ComponentProps<typeof NativeZoneVideo>> = {}) {
  const onHole = jest.fn();
  const onLinger = jest.fn();
  const onPlaying = jest.fn();
  const onEnded = jest.fn();
  const onAttempt = jest.fn();
  const props = (a: boolean) => ({
    descriptor, item: descriptor.items[0], active: a, prerollOnly: true,
    measure: () => layout, onHole, onLinger, onPlaying, onEnded, evidence: true, attempt: 0, onAttempt, ...extra,
  });
  const r = render(<NativeZoneVideo {...props(active)}><video data-testid="web" /></NativeZoneVideo>);
  return { ...r, onHole, onLinger, onPlaying, onEnded, onAttempt, setActive: (a: boolean) => r.rerender(<NativeZoneVideo {...props(a)}><video data-testid="web" /></NativeZoneVideo>) };
}

beforeEach(() => {
  jest.useFakeTimers();
  bridge.has.mockClear(); bridge.fire.mockClear(); bridge.call.mockClear();
  bridge.call.mockImplementation(async () => JSON.stringify(reply));
  setSessions([]);
  nativeZoneTelemetry.clear();
});
afterEach(() => jest.useRealTimers());

describe("NativeZoneVideo — mixed-playlist slide", () => {
  it("pre-rolls while hidden, keeps the web element, and hands off only when active: unmount + hole + play in one commit", async () => {
    const m = mount(false);
    expect(m.queryByTestId("web")).not.toBeNull();
    expect(ops()).toEqual(["prepare"]);
    setSessions([zoneState("ready")]);
    await flush();
    expect(ops()).toEqual(["prepare", "sharedVideoCommit"]);
    setSessions([zoneState("presenting", 1, { held: true })]);
    await flush();
    // Held but hidden: the web element is still there, no hole, no play.
    expect(m.queryByTestId("web")).not.toBeNull();
    expect(m.onHole).not.toHaveBeenCalled();
    expect(ops()).not.toContain("play");
    await act(async () => { m.setActive(true); });
    expect(m.queryByTestId("web")).toBeNull();
    expect(m.onHole).toHaveBeenLastCalledWith("item:v1", true, null);
    expect(ops()).toContain("play");
    expect(m.container.firstElementChild?.getAttribute("data-native-zone")).toBe("presenting");
    setSessions([zoneState("presenting", 20)]);
    await flush();
    setSessions([zoneState("presenting", 40)]);
    await flush();
    expect(m.onPlaying).toHaveBeenCalledTimes(1);
    expect(nativeZoneTelemetry.get("item:v1")?.state).toBe("presenting");
    setSessions([zoneState("presenting", 40, { ended: true })]);
    await flush();
    expect(m.onEnded).toHaveBeenCalledTimes(1);
    // The slide leaves the glass: the frame lingers behind the next slide's fade, then the session stops.
    await act(async () => { m.setActive(false); });
    expect(m.onLinger).toHaveBeenLastCalledWith("item:v1", true);
    expect(ops()).not.toContain("sharedVideoStop");
    await flush(HANDOFF_OVERLAP_MS + 10);
    expect(ops()).toContain("sharedVideoStop");
    expect(m.onHole).toHaveBeenLastCalledWith("item:v1", false, null);
    expect(m.onLinger).toHaveBeenLastCalledWith("item:v1", false);
  });

  it("a slide already on glass with the web playing is NOT switched mid-clip; native is released and retried next showing", async () => {
    const m = mount(true);
    setSessions([zoneState("ready")]);
    await flush();
    expect(ops()).toContain("sharedVideoStop");
    expect(ops()).not.toContain("sharedVideoCommit");
    expect(ops()).not.toContain("play");
    expect(m.queryByTestId("web")).not.toBeNull();
    expect(m.onHole).not.toHaveBeenCalledWith("item:v1", true, expect.anything());
    await flush(31_000);
    expect(m.onAttempt).not.toHaveBeenCalled(); // this showing stays web; a new mount retries
  });

  it("a native fault after the hand-off remounts the web element and closes the hole; a transient end retries in 30 s", async () => {
    const m = mount(false);
    setSessions([zoneState("ready")]);
    await flush();
    setSessions([zoneState("presenting", 1, { held: true })]);
    await flush();
    await act(async () => { m.setActive(true); });
    expect(m.queryByTestId("web")).toBeNull();
    setSessions([zoneState("failed", 1, { reason: "codec-failed" })]);
    await flush();
    expect(m.queryByTestId("web")).not.toBeNull();
    expect(m.onHole).toHaveBeenLastCalledWith("item:v1", false, null);
    expect(JSON.parse(window.localStorage.getItem("edu.nativeVideo.block.v2") || "{}")).toHaveProperty(`${digestA}:0`);
    window.localStorage.clear();
    const t = mount(false);
    setSessions([zoneState("failed", 0, { reason: "decoder-budget" })]);
    await flush();
    expect(t.onAttempt).not.toHaveBeenCalled();
    await flush(30_000);
    expect(t.onAttempt).toHaveBeenCalledWith("item:v1", 1);
  });

  it("an APK that answers protocol 2 (1.1.29) or protocol 1 leaves the web element exactly as it is", async () => {
    for (const old of [{ version: 1, state: "idle", protocol: 2 }, { version: 1, state: "idle" }]) {
      reply = old;
      bridge.fire.mockClear();
      const m = mount(false);
      await flush();
      expect(m.queryByTestId("web")).not.toBeNull();
      expect(m.onHole).not.toHaveBeenCalledWith("item:v1", true, expect.anything());
      expect(ops()).not.toContain("play");
      expect(ops()).not.toContain("sharedVideoCommit");
      m.unmount();
    }
  });

  it("without the bridge (a browser, a Taurus) nothing is sent at all", async () => {
    bridge.has.mockImplementation(() => false);
    const m = mount(true);
    await flush();
    expect(bridge.fire).not.toHaveBeenCalled();
    expect(bridge.call).not.toHaveBeenCalled();
    expect(m.queryByTestId("web")).not.toBeNull();
    bridge.has.mockImplementation(() => true);
  });

  it("unmounting while native plays stops the session and closes the hole", async () => {
    const m = mount(false);
    setSessions([zoneState("ready")]);
    await flush();
    setSessions([zoneState("presenting", 1, { held: true })]);
    await flush();
    await act(async () => { m.setActive(true); });
    m.unmount();
    expect(ops()).toContain("sharedVideoStop");
    expect(m.onHole).toHaveBeenLastCalledWith("item:v1", false, null);
    expect(nativeZoneTelemetry.has("item:v1")).toBe(false);
  });
});

describe("NativeZoneVideo — template zone", () => {
  it("hands off at the web loop's boundary when the web is mid-clip, with the zone's local rect for the backdrop hole", async () => {
    const localRect = jest.fn(() => ({ x: 10, y: 20, w: 300, h: 200 }));
    const m = mount(true, { prerollOnly: false, localRect });
    const video = m.getByTestId("web") as HTMLVideoElement;
    Object.defineProperty(video, "paused", { value: false, configurable: true });
    Object.defineProperty(video, "readyState", { value: 4, configurable: true });
    Object.defineProperty(video, "ended", { value: false, configurable: true });
    let t = 3.2;
    Object.defineProperty(video, "currentTime", { get: () => t, configurable: true });
    setSessions([zoneState("ready")]);
    await flush();
    expect(ops()).toContain("sharedVideoCommit"); // a zone commits even while the web plays
    setSessions([zoneState("presenting", 1, { held: true })]);
    await flush();
    // Held, but the web clip is mid-way: wait for its loop boundary.
    expect(m.queryByTestId("web")).not.toBeNull();
    expect(ops()).not.toContain("play");
    await act(async () => { t = 3.9; video.dispatchEvent(new Event("timeupdate")); });
    expect(ops()).not.toContain("play");
    await act(async () => { t = 0.1; video.dispatchEvent(new Event("timeupdate")); });
    expect(m.queryByTestId("web")).toBeNull();
    expect(ops()).toContain("play");
    expect(m.onHole).toHaveBeenLastCalledWith("item:v1", true, { x: 10, y: 20, w: 300, h: 200 });
  });
});
