/**
 * The double-sided ECHO LOOP (2026-11-02): a native video stopped
 * `emergency-held` is NEVER a bridge raise of the display hold.
 *
 * A double-sided unit has ONE native hold with per-face membership, and the
 * APK stops EITHER face's native video `emergency-held` while ANY face holds.
 * When the page turned that stop into `displayEmergencyHold(true)`, a face
 * that had just released on the all-clear re-raised itself because the other
 * face had not released yet — and back again — so the hold never emptied,
 * and the never-painted episodes drove the paint ladder to reload/relaunch
 * both pages for ~4 minutes.
 *
 * Pinned here:
 *  (a) a native `emergency-held` stop (fallback, update, or a native-first
 *      intent suspension) sends NO bridge raise, and still suppresses regular
 *      web media on the page (the goal of c0b8c8d49);
 *  (b) the suppression clears on a LIVE no-alert manifest, and when native
 *      no longer reports held;
 *  (c) the incident order replayed against a fake two-face unit: clear A →
 *      A's video restarts → clear B → the hold set stays EMPTY;
 *  (d) a real alert (manifest / signed push) still raises the native hold
 *      and still produces the protective surface.
 */
import React from "react";
import { act, render } from "@testing-library/react";
import type { NativeVideoDescriptor } from "../nativeSharedVideo";

// ── A fake double-sided unit: one hold, per-face membership ────────────────
const unit = {
  holding: new Set<number>(),
  /** The face whose page is running right now (each face is its own WebView). */
  activeFace: 0,
  raises: [] as number[],
};
const bridge = {
  has: jest.fn(() => true),
  fire: jest.fn((_m: string, ..._args: unknown[]) => true),
  call: jest.fn(async (_m: string): Promise<unknown> => reply),
};
jest.mock("../nativeBridge", () => ({
  nativeHas: () => bridge.has(),
  nativeFire: (m: string, ...args: unknown[]) => bridge.fire(m, ...args),
  nativeCall: (m: string) => bridge.call(m),
  nativeFireChecked: (m: string, ...args: unknown[]) => {
    if (m === "displayEmergencyHold") {
      if (args[0] === true) { unit.holding.add(unit.activeFace); unit.raises.push(unit.activeFace); }
      else unit.holding.delete(unit.activeFace);
    }
    return { transport: "channel", delivered: true };
  },
}));

import { NativeDualVideo, isNativeEmergencyHeldReason } from "../NativeDualVideo";
import {
  __resetDisplayEmergencyHoldForTests,
  displayEmergencyHoldRaised,
  displayEmergencyPlaybackHeld,
  nativeEmergencyHeldSuppressed,
  signalDisplayEmergencyHold,
} from "../emergencyHold";
import { NativeFirstFace } from "../nativeFirstFace";
import { decideEmergencySurface } from "../emergencySurface";

const descriptor: NativeVideoDescriptor = {
  version: 2, screenId: "40864836-9367-47a3-b349-ba1c3378f814", tenantId: "28d09f9d-0a6c-4828-b46d-38712eb69f1f", faceIndex: 0, revision: "rev2",
  asset: { id: "9c0eb1c6-2486-484a-863d-e74c2dde5e93", url: "https://example.com/file.mp4", sha256: "d".repeat(64), size: 10000, width: 1080, height: 1668, fps: 30 },
  transform: { orientation: "PORTRAIT", fit: "fill" },
};
const state = (kind = "idle", epoch = 1, extra = {}) => ({
  version: 1, protocol: 2, state: kind, sessionId: "11111111-1111-1111-1111-111111111111", revision: "rev2", sha256: descriptor.asset.sha256, faceIndex: 0,
  availability: { version: 1, foreground: true, interactive: true, focused: true, focusRequired: true, uiClear: true, ready: true, epoch },
  output: { attached: true, visible: true, hardwareAccelerated: true, viewUpdates: 20, uniqueFrames: 20, sourcePtsUs: 1, width: 1080, height: 1920, ageMs: 0, lastUpdateElapsedMs: 1 }, ...extra,
});
let reply: unknown;
const flush = async (ms = 0) => { await act(async () => { await jest.advanceTimersByTimeAsync(ms); for (let i = 0; i < 20; i++) await Promise.resolve(); }); };
const holdCalls = () => bridge.fire.mock.calls.filter(([m]) => m === "displayEmergencyHold");

beforeEach(() => {
  __resetDisplayEmergencyHoldForTests();
  unit.holding.clear(); unit.raises = []; unit.activeFace = 0;
  bridge.fire.mockClear(); bridge.call.mockClear();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

describe("NativeDualVideo: an emergency-held stop suppresses, never raises", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    reply = state();
    bridge.call.mockImplementation(async () => reply);
    bridge.fire.mockImplementation((m: string) => {
      if (m === "sharedVideoPrepare") reply = state("preparing", (reply as ReturnType<typeof state>).availability.epoch);
      return true;
    });
  });

  it("a native emergency-held fallback with no live alert sends no bridge raise, and suppresses web media", async () => {
    const r = render(<NativeDualVideo descriptor={descriptor} classes="player" onPlaying={() => undefined}><div data-testid="web" /></NativeDualVideo>);
    await flush();
    reply = state("ready"); await flush(500); await flush();
    reply = state("presenting"); await flush(500);
    expect(displayEmergencyPlaybackHeld()).toBe(false);
    // The OTHER face of the unit holds: native stops this face `emergency-held`.
    reply = state("failed", 1, { reason: "emergency-held" });
    await flush(500); await flush();
    expect(unit.raises).toEqual([]);
    expect(holdCalls()).toEqual([]);
    expect(unit.holding.size).toBe(0);
    // …and the page still must not fall back to regular web media (c0b8c8d49).
    expect(nativeEmergencyHeldSuppressed()).toBe(true);
    expect(displayEmergencyPlaybackHeld()).toBe(true);
    expect(displayEmergencyHoldRaised()).toBe(true);
    // The live no-alert manifest ends the suppression.
    signalDisplayEmergencyHold(false);
    expect(nativeEmergencyHeldSuppressed()).toBe(false);
    expect(displayEmergencyPlaybackHeld()).toBe(false);
    expect(unit.raises).toEqual([]);
    r.unmount();
  });

  it("the newer APK's emergency-held-other-face reason is the same suppression, never a raise", async () => {
    expect(isNativeEmergencyHeldReason("emergency-held")).toBe(true);
    expect(isNativeEmergencyHeldReason("emergency-held-other-face")).toBe(true);
    expect(isNativeEmergencyHeldReason("activity-paused")).toBe(false);
    expect(isNativeEmergencyHeldReason(undefined)).toBe(false);
    const r = render(<NativeDualVideo descriptor={descriptor} classes="player" onPlaying={() => undefined}><div /></NativeDualVideo>);
    await flush();
    reply = state("ready"); await flush(500); await flush();
    reply = state("presenting"); await flush(500);
    reply = state("failed", 1, { reason: "emergency-held-other-face" });
    await flush(500); await flush();
    expect(unit.raises).toEqual([]);
    expect(nativeEmergencyHeldSuppressed()).toBe(true);
    r.unmount();
  });
});

const X = { screenId: "40864836-9367-47a3-b349-ba1c3378f814", revision: "r".repeat(64), sha256: "a".repeat(64), assetId: "9c0eb1c6-2486-484a-863d-e74c2dde5e93" };
const facts = (suspended: string | null) => ({
  version: 1, protocol: 2, protocolMax: 4, state: "idle",
  device: { class: "rockchip/android-11", soc: "rockchip", sdk: 30, webviewMajor: 120, nativeSolo: true, protocol3: true, silentUpdate: "tap", nativeFirst: true },
  intent: { ...X, suspended, status: suspended ? "suspended-by-hold" : "ended", lastEnd: "emergency-held", settled: false },
});

describe("NativeFirstFace: a suspended-by-hold intent suppresses, never raises", () => {
  const rig = (face: number, held: () => boolean) => new NativeFirstFace(
    { has: () => true, fire: () => true, state: async () => { unit.activeFace = face; return facts(held() ? "hold" : null); } },
    { lease: "lease-abcdefgh", timers: { set: () => 0, clear: () => undefined } },
  );

  it("an intent suspended by the hold sets the page-local suppression and clears it when native no longer holds", async () => {
    let held = true;
    const face = rig(0, () => held);
    await face.read();
    expect(unit.raises).toEqual([]);
    expect(nativeEmergencyHeldSuppressed()).toBe(true);
    held = false;
    await face.read();
    expect(nativeEmergencyHeldSuppressed()).toBe(false);
    expect(unit.raises).toEqual([]);
  });

  it("replays the incident order: clear A → A's video restarts → clear B → the hold stays empty", async () => {
    // Each face is its own WebView document with its own module state.
    let pageA!: typeof import("../emergencyHold");
    let pageB!: typeof import("../emergencyHold");
    let FaceA!: typeof NativeFirstFace;
    jest.isolateModules(() => { pageA = require("../emergencyHold"); FaceA = require("../nativeFirstFace").NativeFirstFace; });
    jest.isolateModules(() => { pageB = require("../emergencyHold"); });
    // A drill is up on both faces: each page raised from its manifest.
    unit.activeFace = 0; pageA.signalDisplayEmergencyHold(true, true);
    unit.activeFace = 1; pageB.signalDisplayEmergencyHold(true, true);
    expect([...unit.holding].sort()).toEqual([0, 1]);
    unit.raises = [];
    // 1) Face A's live manifest clears first. B still holds.
    unit.activeFace = 0; pageA.signalDisplayEmergencyHold(false);
    expect([...unit.holding]).toEqual([1]);
    // 2) A's native video restarts and the APK stops it `emergency-held`
    //    (the hold is held GLOBALLY, by B). A's page reads that.
    const faceA = new FaceA(
      { has: () => true, fire: () => true, state: async () => { unit.activeFace = 0; return facts(unit.holding.size > 0 ? "hold" : null); } },
      { lease: "lease-abcdefgh", timers: { set: () => 0, clear: () => undefined } },
    );
    await faceA.read();
    expect(pageA.nativeEmergencyHeldSuppressed()).toBe(true);
    expect([...unit.holding]).toEqual([1]); // A did NOT re-join the hold
    // 3) Face B's live manifest clears.
    unit.activeFace = 1; pageB.signalDisplayEmergencyHold(false);
    // The hold is empty, and nothing re-seeds it.
    expect(unit.holding.size).toBe(0);
    await faceA.read();
    expect(unit.holding.size).toBe(0);
    expect(unit.raises).toEqual([]); // no raise after the clear = no new paint episode
    expect(pageA.nativeEmergencyHeldSuppressed()).toBe(false);
  });
});

describe("a real alert still raises and paints", () => {
  it("a manifest / push raise reaches the native hold even while the native-held suppression is on", () => {
    // Native (e.g. its alert watch) stopped the video first; the page suppresses.
    const face = new NativeFirstFace(
      { has: () => true, fire: () => true, state: async () => facts("hold") },
      { lease: "lease-abcdefgh", timers: { set: () => 0, clear: () => undefined } },
    );
    return face.read().then(() => {
      expect(nativeEmergencyHeldSuppressed()).toBe(true);
      expect(unit.raises).toEqual([]);
      // Unattributed: the protective black hold surface, never web media.
      expect(decideEmergencySurface({
        activeEmergency: false, pushed: null, polledActive: false, polledTakeover: false,
        renderHold: displayEmergencyHoldRaised(), playbackHeld: displayEmergencyPlaybackHeld(),
        pendingOverrideConfirm: false, playlistIsEmergency: false,
      })).toBe("hold");
      // The page's manifest then shows the alert: the raise is NOT deduped away.
      unit.activeFace = 0;
      expect(signalDisplayEmergencyHold(true)).toBe("applied");
      expect(unit.raises).toEqual([0]);
      expect(unit.holding.has(0)).toBe(true);
      expect(decideEmergencySurface({
        activeEmergency: true, pushed: null, polledActive: false, polledTakeover: false,
        renderHold: displayEmergencyHoldRaised(), playbackHeld: displayEmergencyPlaybackHeld(),
        pendingOverrideConfirm: false, playlistIsEmergency: false,
      })).toBe("takeover");
    });
  });
});
