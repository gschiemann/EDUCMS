/**
 * NativeSoloSlot — the face a native-first decision mounts: NO web <video>,
 * the §4.3 intent (adopt / now), confirm-by-render, and the closed-table end
 * policy (transient → native again, fault → block, refused → web).
 */
import React from 'react';
import { act, render } from '@testing-library/react';
import { NativeSoloSlot, NATIVE_FIRST_START_BUDGET_MS } from '../NativeSoloSlot';
import { NativeFirstFace } from '../nativeFirstFace';
import type { FaceEngineDecision } from '../decideFaceEngine';
import { nativeVideoBlocked } from '../nativeSharedVideo';

const SCREEN = '11111111-1111-4111-8111-111111111111';
const ASSET = '44444444-4444-4444-8444-444444444444';
const SHA = 'cd'.repeat(32);
const LEASE = 'f'.repeat(32);
const identity = { screenId: SCREEN, revision: 'r1', sha256: SHA, assetId: ASSET };
const NATIVE: FaceEngineDecision = { engine: 'native', reason: 'store-verified', yieldTo: null };

let reply: Record<string, unknown>;
const base = () => ({
  version: 1, protocol: 2, protocolMax: 4, state: 'idle',
  device: { class: 'amlogic/android-13', soc: 'amlogic', sdk: 33, webviewMajor: 120, nativeSolo: true, protocol3: true, silentUpdate: 'tap', nativeFirst: true },
});
const session = (state: string, frames: number, extra: Record<string, unknown> = {}) => ({
  ...base(), state, sessionId: '66666666-6666-4666-8666-666666666666', revision: 'r1', sha256: SHA, faceIndex: 0,
  output: { attached: true, visible: true, viewUpdates: 3, uniqueFrames: frames, sourcePtsUs: 0, width: 1920, height: 1080, lastUpdateElapsedMs: 1, hardwareAccelerated: true, ageMs: 50 },
  ...extra,
});
const fired: string[] = [];
const bridge = {
  has: () => true,
  fire: (m: string, a: string) => { if (m === 'sharedVideoPrepare') fired.push(a); return true; },
  state: async () => reply,
};
const intents = () => fired.map((m) => JSON.parse(m)).filter((m) => m.op === 'intend');
const flush = async (ms = 0) => {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms); for (let i = 0; i < 20; i++) await Promise.resolve(); });
};
function mount(decision: FaceEngineDecision = NATIVE, extra: Partial<React.ComponentProps<typeof NativeSoloSlot>> = {}) {
  const face = new NativeFirstFace(bridge, { lease: LEASE });
  const onPlaying = jest.fn();
  const onEngineChange = jest.fn();
  const r = render(
    <NativeSoloSlot face={face} identity={identity} decision={decision} faceIndex={0} classes="slot"
      onPlaying={onPlaying} onEngineChange={onEngineChange} holdRaised={() => false} log={() => undefined} {...extra} />,
  );
  return { face, onPlaying, onEngineChange, r };
}

beforeEach(() => {
  jest.useFakeTimers();
  fired.length = 0;
  reply = base();
  window.localStorage.clear();
});
afterEach(() => { jest.useRealTimers(); });

it('creates NO web <video> — the picture is the app surface above the window', async () => {
  const { r } = mount();
  await flush();
  expect(r.container.querySelector('video')).toBeNull();
  expect(r.container.querySelector('[data-native-first]')).not.toBeNull();
  reply = session('presenting', 5);
  await flush(500);
  expect(r.container.querySelector('video')).toBeNull();
  r.unmount();
});

it('idle app → intend now (frame 0); the first FRESH frame of this identity confirms (onPlaying once)', async () => {
  const { r, onPlaying } = mount();
  await flush();
  expect(intents()).toEqual([expect.objectContaining({ op: 'intend', start: 'now', sha256: SHA, lease: LEASE })]);
  reply = session('preparing', 0);
  await flush(500);
  expect(onPlaying).not.toHaveBeenCalled();
  reply = session('presenting', 3);
  await flush(500);
  await flush(500);
  expect(onPlaying).toHaveBeenCalledTimes(1);
  expect(r.container.querySelector('[data-native-first]')?.getAttribute('data-native-first')).toBe('presenting');
  r.unmount();
});

it('a reload while native presents the same identity → adopt at the boundary: nothing on glass changes', async () => {
  reply = session('presenting', 40);
  const { r, onPlaying } = mount();
  await flush();
  expect(intents()).toEqual([expect.objectContaining({ op: 'intend', start: 'boundary', sha256: SHA })]);
  expect(onPlaying).toHaveBeenCalledTimes(1);
  r.unmount();
});

it('wait (file not verified) and a yield send nothing', async () => {
  const w = mount({ engine: 'wait', reason: 'store-pending', yieldTo: null });
  await flush(1_000);
  w.r.unmount();
  const y = mount({ engine: 'native', reason: 'store-verified', yieldTo: 'update-prompt' });
  await flush(1_000);
  y.r.unmount();
  expect(fired).toEqual([]);
});

it('a FAULT of the verified file blocks it for 24 h (file + face + build) and asks the page to re-decide', async () => {
  const { r, onEngineChange } = mount();
  await flush();
  reply = session('failed', 0, { reason: 'codec-failed' });
  await flush(500);
  expect(onEngineChange).toHaveBeenCalledTimes(1);
  expect(nativeVideoBlocked(window.localStorage, SHA, 0, Date.now())).toBe(true);
  r.unmount();
});

it('an offline boot (not-ready) is never a block: it waits and tries again', async () => {
  const { r, onEngineChange } = mount();
  await flush();
  reply = session('failed', 0, { reason: 'manifest-http-503' });
  await flush(500);
  expect(onEngineChange).not.toHaveBeenCalled();
  expect(nativeVideoBlocked(window.localStorage, SHA, 0, Date.now())).toBe(false);
  fired.length = 0;
  reply = base();
  await flush(30_000);
  await flush(500);
  expect(intents()).toHaveLength(1);
  r.unmount();
});

it('a transient end → native again; the 6th in 10 min settles the content on web', async () => {
  const { r, onEngineChange } = mount();
  await flush();
  for (let i = 0; i < 5; i++) {
    reply = session('failed', 0, { reason: 'activity-paused', sessionId: `66666666-6666-4666-8666-66666666666${i}` });
    await flush(500);
    reply = base();
    await flush(1_000);
    await flush(500);
  }
  expect(onEngineChange).not.toHaveBeenCalled();
  expect(intents().length).toBeGreaterThanOrEqual(6);
  reply = session('failed', 0, { reason: 'operator-ui', sessionId: '66666666-6666-4666-8666-666666666669' });
  await flush(500);
  expect(onEngineChange).toHaveBeenCalledTimes(1);
  r.unmount();
});

it('never asks for a picture while the page holds an alert; asks once it clears (§7)', async () => {
  let hold = true;
  const { r } = mount(NATIVE, { holdRaised: () => hold });
  await flush(2_000);
  expect(intents()).toEqual([]);
  hold = false;
  await flush(500);
  expect(intents()).toHaveLength(1);
  r.unmount();
});

it('an end the app restores itself (operator UI / the hold) with the intent kept is NOT re-asked — no settle behind a long Back menu', async () => {
  const { r, onEngineChange, onPlaying } = mount();
  await flush();
  reply = session('presenting', 3);
  await flush(500);
  expect(onPlaying).toHaveBeenCalledTimes(1);
  fired.length = 0;
  // The app ended it for its own UI and keeps the intent, suspended.
  reply = { ...session('failed', 0, { reason: 'operator-ui', sessionId: '77777777-7777-4777-8777-777777777777' }), intent: { ...identity, suspended: 'operator-ui' } };
  for (let i = 0; i < 30; i++) await flush(1_000);
  expect(intents()).toEqual([]);
  expect(onEngineChange).not.toHaveBeenCalled();
  // The UI closes: the app restores the same identity — picked up, no second onPlaying.
  reply = session('presenting', 9, { sessionId: '88888888-8888-4888-8888-888888888888' });
  await flush(500);
  expect(intents()).toEqual([]);
  expect(onPlaying).toHaveBeenCalledTimes(1);
  expect(r.container.querySelector('[data-native-first]')?.getAttribute('data-native-first')).toBe('presenting');
  r.unmount();
});

it('a refused end is web for this content (no block)', async () => {
  const { r, onEngineChange } = mount();
  await flush();
  reply = session('failed', 0, { reason: 'composition-unavailable' });
  await flush(500);
  expect(onEngineChange).toHaveBeenCalledTimes(1);
  expect(nativeVideoBlocked(window.localStorage, SHA, 0, Date.now())).toBe(false);
  r.unmount();
});

it('no first frame within the start budget is a transient end (native again), never a block', async () => {
  const { r, onEngineChange } = mount();
  await flush();
  reply = session('preparing', 0);
  fired.length = 0;
  await flush(NATIVE_FIRST_START_BUDGET_MS + 1_000);
  await flush(1_500);
  expect(onEngineChange).not.toHaveBeenCalled();
  expect(intents().length).toBeGreaterThanOrEqual(1);
  r.unmount();
});
