import React from "react";
import { act, render } from "@testing-library/react";
import type { NativeVideoDescriptor } from "../nativeSharedVideo";

const bridge = { has: jest.fn(() => true), fire: jest.fn((_m: string, ..._args: unknown[]) => true), call: jest.fn(async (_m: string): Promise<unknown> => reply) };
jest.mock("../nativeBridge", () => ({
  nativeHas: () => bridge.has(), nativeFire: (m: string, ...args: unknown[]) => bridge.fire(m, ...args), nativeCall: (m: string) => bridge.call(m),
}));
import { NativeDualVideo } from "../NativeDualVideo";

const descriptor: NativeVideoDescriptor = {
  version: 2, screenId: "40864836-9367-47a3-b349-ba1c3378f814", tenantId: "28d09f9d-0a6c-4828-b46d-38712eb69f1f", faceIndex: 0, revision: "rev2",
  asset: { id: "9c0eb1c6-2486-484a-863d-e74c2dde5e93", url: "https://example.com/file.mp4", sha256: "d".repeat(64), size: 10000, width: 1080, height: 1668, fps: 30 },
  transform: { orientation: "PORTRAIT", fit: "fill" },
};
const state = (kind = "idle", epoch = 1, available = true, extra = {}) => ({
  version: 1, protocol: 2, state: kind, sessionId: "11111111-1111-1111-1111-111111111111", revision: "rev2", sha256: descriptor.asset.sha256, faceIndex: 0,
  availability: { version: 1, foreground: available, interactive: true, focused: true, focusRequired: true, uiClear: true, ready: available, epoch },
  output: { attached: true, visible: true, hardwareAccelerated: true, viewUpdates: 20, uniqueFrames: 20, sourcePtsUs: 1, width: 1080, height: 1920, ageMs: 0, lastUpdateElapsedMs: 1 }, ...extra,
});
let reply: unknown;
const flush = async (ms = 0) => { await act(async () => { await jest.advanceTimersByTimeAsync(ms); for (let i = 0; i < 20; i++) await Promise.resolve(); }); };
const prepares = () => bridge.fire.mock.calls.filter(([m]) => m === "sharedVideoPrepare");
const commits = () => bridge.fire.mock.calls.filter(([m]) => m === "sharedVideoCommit");
const mount = (child = <div data-testid="web" />) => render(<NativeDualVideo descriptor={descriptor} classes="player" onPlaying={() => undefined}>{child}</NativeDualVideo>);

beforeEach(() => {
  jest.useFakeTimers(); reply = state(); bridge.fire.mockClear(); bridge.call.mockClear();
  bridge.call.mockImplementation(async () => reply);
  bridge.fire.mockImplementation((m: string) => {
    if (m === "sharedVideoPrepare") reply = state("preparing", (reply as ReturnType<typeof state>).availability.epoch);
    return true;
  });
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

it("does not downgrade an initial unknown reply into legacy playback", async () => {
  bridge.call.mockResolvedValueOnce("{}");
  const r = mount(); await flush();
  expect(prepares()).toHaveLength(0);
  await flush(500); expect(prepares()).toHaveLength(1);
  reply = state("ready"); await flush(500); await flush();
  expect(commits()).toHaveLength(1);
  r.unmount();
});

it("rechecks one unknown handoff read at the same epoch without preparing twice", async () => {
  const r = mount(); await flush();
  reply = state("ready");
  let unknown = true;
  let sawReady = false;
  bridge.call.mockImplementation(async () => {
    // Controller sees ready; its handoff query is the next read.
    if (unknown && sawReady) { unknown = false; return "{}"; }
    sawReady = true;
    return reply;
  });
  await flush(500); await flush(500); await flush();
  expect(prepares()).toHaveLength(1);
  expect(commits()).toHaveLength(1);
  expect(r.queryByTestId("web")).toBeNull();
  r.unmount();
});

it("returns to native after a real pause, including resume before fallback is polled", async () => {
  const r = mount(); await flush();
  reply = state("ready"); await flush(500); await flush();
  reply = state("presenting"); await flush(500);
  expect(commits()).toHaveLength(1);
  reply = state("failed", 2, true, { reason: "activity-paused" });
  await flush(500); await flush();
  expect(prepares()).toHaveLength(2);
  reply = state("ready", 2); await flush(500); await flush();
  expect(commits()).toHaveLength(2);
  await flush(3000);
  expect(prepares()).toHaveLength(2);
  r.unmount();
});

it("keeps the browser while native UI is blocked and cancels the pending ticket on unmount", async () => {
  reply = state("idle", 0, false);
  const r = mount(); await flush(); await flush(1500);
  expect(prepares()).toHaveLength(0); expect(r.queryByTestId("web")).not.toBeNull();
  r.unmount(); reply = state("idle", 1, true); await flush(5000);
  expect(prepares()).toHaveLength(0);
});

it("a retired boundary listener cannot hand over the browser behind UI", async () => {
  const r = mount(<video data-testid="web" />); await flush();
  const v = r.getByTestId("web") as HTMLVideoElement;
  Object.defineProperties(v, { paused: { value: false }, readyState: { value: 2 }, currentTime: { value: 10, writable: true } });
  reply = state("ready"); await flush(500);
  expect(commits()).toHaveLength(0);
  reply = state("failed", 1, false, { reason: "activity-paused" }); await flush(500);
  v.dispatchEvent(new Event("ended")); await flush();
  expect(commits()).toHaveLength(0); expect(prepares()).toHaveLength(1);
  expect(r.queryByTestId("web")).not.toBeNull(); r.unmount();
});
