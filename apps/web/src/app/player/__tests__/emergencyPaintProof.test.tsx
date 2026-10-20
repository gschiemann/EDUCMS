import { render, cleanup } from '@testing-library/react';
import { Component, type ReactNode } from 'react';
import { EmergencyOverlay, type EmergencyMessageView } from '@/components/player/EmergencyOverlay';
import { EmergencyPaintWatcher, emergencyPaintIdentity, emergencyRenderHash, visibleEmergencyRoot, type EmergencyPaintProof, type NativeEmergencyPaintState } from '../emergencyPaintProof';
import { useEmergencyPaintMonitor, type EmergencyPaintMonitorRefs } from '../emergencyPaintMonitor';

jest.mock('../nativeBridge', () => ({ nativeHas: () => false, nativeCall: jest.fn(), nativeFire: jest.fn() }));
jest.mock('../emergencyHold', () => ({ signalDisplayEmergencyHold: jest.fn() }));

const alert: EmergencyMessageView = { id: 'test-alert', type: 'TEXT_BROADCAST', severity: 'CRITICAL', textBlob: 'Move to the designated safe area', mediaUrls: [], audioUrl: null, expiresAt: null, createdAt: '2026-10-01T00:00:00Z' };
const rect = { top: 0, left: 0, right: 1280, bottom: 720, width: 1280, height: 720, x: 0, y: 0, toJSON: () => ({}) };
let hit: Element | null;
beforeEach(() => {
  hit = null;
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => hit });
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
});
afterEach(() => { cleanup(); document.body.innerHTML = ''; jest.restoreAllMocks(); });

function harness(expected: string | null = emergencyPaintIdentity(alert)) {
  let identity = expected;
  let challenge: string | NativeEmergencyPaintState | undefined;
  let sequence = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const proofs: EmergencyPaintProof[] = [];
  const nativeReceipts: EmergencyPaintProof[] = [];
  const order: string[] = [];
  const watcher = new EmergencyPaintWatcher({
    document, documentId: 'test-document', expectedIdentity: () => identity,
    raiseHold: () => { order.push('hold'); },
    readChallenge: async () => { order.push('challenge'); return challenge; },
    report: proof => { order.push(proof.painted ? 'painted' : 'pending'); proofs.push(proof); },
    nativeReport: proof => { nativeReceipts.push(proof); },
    requestFrame: callback => { sequence += 1; frames.set(sequence, callback); return sequence; },
    cancelFrame: id => { frames.delete(id); },
  });
  const frame = () => {
    const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!next) throw new Error('No animation frame scheduled');
    frames.delete(next[0]); next[1](sequence * 16);
  };
  return { watcher, proofs, nativeReceipts, order, frame, setIdentity: (next: string | null) => { identity = next; }, setChallenge: (next: string | NativeEmergencyPaintState) => { challenge = next; } };
}

function mountMessage() {
  render(<EmergencyOverlay message={alert} />);
  const root = document.querySelector<HTMLElement>('[data-edu-emergency-root="full"]')!;
  hit = root.querySelector('h1') || root;
  return root;
}

it('the actual message overlay reports paint only after two visible frame samples', () => {
  const root = mountMessage();
  expect(root.dataset.eduEmergencyIdentity).toBe(emergencyPaintIdentity(alert));
  const h = harness();
  h.watcher.scan();
  expect(h.order.slice(0, 3)).toEqual(['hold', 'pending', 'challenge']);
  expect(h.proofs).toHaveLength(1);
  expect(h.proofs[0].painted).toBe(false);
  h.frame();
  expect(h.proofs).toHaveLength(1);
  h.frame();
  expect(h.proofs[1]).toMatchObject({ painted: true, frames: 2, identity: emergencyPaintIdentity(alert), documentId: 'test-document' });
  h.watcher.stop();
});

it('an alert with no painted frame stays not delivered even though it mounted and its hold raised', () => {
  mountMessage();
  const h = harness();
  h.watcher.scan();
  h.watcher.scan();
  expect(h.watcher.current()?.painted).toBe(false);
  expect(h.proofs.some(proof => proof.painted)).toBe(false);
  h.watcher.stop();
});

it('an alert while native video is presenting raises the hold before any asynchronous work and waits for a web surface', () => {
  const h = harness();
  h.watcher.scan();
  expect(h.order).toEqual(['hold', 'pending', 'challenge']);
  expect(h.watcher.current()?.painted).toBe(false);
  mountMessage(); h.watcher.scan(); h.frame(); h.frame();
  expect(h.watcher.current()?.painted).toBe(true);
  h.watcher.stop();
});

it.each(['hidden', 'occluded', 'backgrounded', 'removed'])('does not prove an alert that becomes %s between the two frames', mode => {
  const root = mountMessage();
  const h = harness(); h.watcher.scan(); h.frame();
  if (mode === 'hidden') root.style.opacity = '0';
  if (mode === 'occluded') hit = document.body;
  if (mode === 'backgrounded') Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  if (mode === 'removed') root.parentElement!.remove();
  h.frame();
  expect(h.proofs.some(proof => proof.painted)).toBe(false);
  h.watcher.stop();
});

it('does not equate a failed emergency image with the alert; a legible fallback qualifies', () => {
  document.body.innerHTML = '<div data-edu-emergency-root="media" data-edu-emergency-identity="test"><img src="/failed.png"></div>';
  hit = document.querySelector('img');
  expect(visibleEmergencyRoot(document, 'test')).toBeNull();
  const fallback = document.createElement('div');
  fallback.dataset.eduEmergencyRoot = 'fallback'; fallback.dataset.eduEmergencyIdentity = 'test'; fallback.textContent = 'LOCKDOWN';
  document.body.append(fallback); hit = fallback;
  expect(visibleEmergencyRoot(document, 'test')).toBe(fallback);
});

it('proves decoded emergency playlist media even when passive media does not participate in hit-testing', () => {
  document.body.innerHTML = '<div data-edu-emergency-root="media" data-edu-emergency-identity="playlist"><img></div>';
  const root = document.querySelector<HTMLElement>('div')!;
  const image = root.querySelector('img')!;
  Object.defineProperties(image, { complete: { value: true }, naturalWidth: { value: 1280 } });
  image.style.pointerEvents = 'none'; hit = root;
  const h = harness('playlist'); h.watcher.scan(); h.frame(); h.frame();
  expect(h.watcher.current()).toMatchObject({ painted: true, identity: 'playlist' });
  document.body.style.visibility = 'hidden';
  expect(h.watcher.current()?.painted).toBe(false);
  document.body.style.visibility = '';
  h.watcher.stop();
});

it('the overlay polling fallback raises and proves a message independently of page push state', async () => {
  const fetchBefore = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ active: [alert], tenantStatus: 'INACTIVE' }) });
  try {
    const mounted = render(<EmergencyOverlay tenantId="test-tenant" apiUrl="https://api.invalid/api/v1" deviceToken="test-device-token" />);
    const root = await mounted.findByRole('alert'); hit = root;
    const h = harness(null); h.watcher.scan(); h.frame(); h.frame();
    expect(h.order[0]).toBe('hold');
    expect(h.watcher.current()).toMatchObject({ painted: true, identity: emergencyPaintIdentity(alert) });
    h.watcher.stop();
  } finally { global.fetch = fetchBefore; }
});

it('proves only the visible polled message when it covers a different tenant alert', () => {
  document.body.innerHTML = '<div data-edu-emergency-root="fallback" data-edu-emergency-identity="tenant-alert">WEATHER</div>';
  const message = mountMessage(); hit = message;
  const h = harness('tenant-alert'); h.watcher.scan(); h.frame(); h.frame();
  expect(h.watcher.current()).toMatchObject({ painted: true, identity: emergencyPaintIdentity(alert) });
  expect(h.proofs.some(proof => proof.identity === 'tenant-alert' && proof.painted)).toBe(false);
  h.watcher.stop();
});

it('the real monitor survives a player crash and proves the error boundary cached alert', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
  let nextFrame = 0;
  const frames = new Map<number, FrameRequestCallback>();
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++nextFrame, callback); return nextFrame; });
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  const refs: EmergencyPaintMonitorRefs = { watcher: { current: null }, expectedIdentity: { current: 'cached-alert' }, screenId: { current: 'test-screen' }, manifestOkAt: { current: 0 } };
  const post = jest.fn().mockResolvedValue(200);
  class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() { return this.state.failed ? <div data-edu-emergency-root="crash" data-edu-emergency-identity="cached-alert">LOCKDOWN</div> : this.props.children; }
  }
  function Page({ crash }: { crash: boolean }) { if (crash) throw new Error('Test player crash'); return <div>Player content</div>; }
  function Wrapper({ crash }: { crash: boolean }) {
    useEmergencyPaintMonitor(refs, { disabled: () => false, post });
    return <Boundary><Page crash={crash} /></Boundary>;
  }
  const mounted = render(<Wrapper crash={false} />);
  const runningMonitor = refs.watcher.current;
  mounted.rerender(<Wrapper crash />);
  const fallback = document.querySelector<HTMLElement>('[data-edu-emergency-root="crash"]')!;
  expect(fallback.textContent).toBe('LOCKDOWN'); hit = fallback;
  expect(refs.watcher.current).toBe(runningMonitor);
  runningMonitor!.scan();
  for (let i = 0; i < 2; i += 1) {
    const [id, callback] = frames.entries().next().value!;
    frames.delete(id); callback(i * 16);
  }
  expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ painted: true, identity: 'cached-alert' }), 'unconfirmed|em:cached-alert');
  mounted.unmount();
  expect(refs.watcher.current).toBeNull();
});

it('keeps no-paint and stale server confirmation as independent signatures', () => {
  const proof: EmergencyPaintProof = { identity: 'test', documentId: 'document', frames: 2, painted: true };
  expect(emergencyRenderHash(proof, 0, 200_000)).toBe('unconfirmed|em:test');
  expect(emergencyRenderHash(proof, 1, 200_000)).toBe('unconfirmed|em:test');
  expect(emergencyRenderHash(proof, 199_000, 200_000)).toBe('em:test');
  expect(emergencyRenderHash({ ...proof, painted: false }, 0, 200_000)).toBe('pending|em:test');
});

it('retries fresh native paint after an initial visibility refusal, stops on exact acknowledgment, and reoffers HTTP once', async () => {
  mountMessage();
  const h = harness();
  h.setChallenge({ challenge: 'current-hold', status: 'pending' }); h.watcher.scan();
  await new Promise(resolve => setTimeout(resolve, 0));
  h.watcher.scan(); h.frame(); h.frame();
  expect(h.nativeReceipts).toHaveLength(1);
  expect(h.proofs).toHaveLength(2);
  await new Promise(resolve => setTimeout(resolve, 0));
  h.watcher.scan(); h.frame(); h.frame();
  expect(h.nativeReceipts).toHaveLength(2);
  expect(h.nativeReceipts[1].frames).toBeGreaterThan(h.nativeReceipts[0].frames);
  expect(h.proofs).toHaveLength(2);
  await new Promise(resolve => setTimeout(resolve, 0));
  h.setChallenge({ challenge: 'current-hold', status: 'painted', identity: 'previous-alert', documentId: 'test-document' });
  h.watcher.scan(); await new Promise(resolve => setTimeout(resolve, 0)); h.frame(); h.frame();
  expect(h.nativeReceipts).toHaveLength(3);
  h.setChallenge({ challenge: 'current-hold', status: 'painted', identity: emergencyPaintIdentity(alert), documentId: 'test-document' });
  h.watcher.scan(); await new Promise(resolve => setTimeout(resolve, 0)); h.frame(); h.frame();
  expect(h.nativeReceipts).toHaveLength(3);
  expect(h.proofs).toHaveLength(3);
  expect(h.proofs[2]).toMatchObject({ painted: true, challenge: 'current-hold' });
  h.watcher.scan(); await new Promise(resolve => setTimeout(resolve, 0)); h.frame(); h.frame();
  expect(h.proofs).toHaveLength(3);
  expect(h.nativeReceipts).toHaveLength(3);
  h.watcher.stop();
});

it('bounds unacknowledged native receipts to forty and ten seconds without flooding HTTP', async () => {
  mountMessage();
  let now = 1000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const h = harness(); h.setChallenge({ challenge: 'current-hold', status: 'pending' }); h.watcher.scan();
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 50; i += 1) {
    h.watcher.scan(); h.frame(); h.frame();
    await new Promise(resolve => setTimeout(resolve, 0));
    now += 250;
  }
  expect(h.nativeReceipts).toHaveLength(40);
  expect(h.proofs).toHaveLength(2);
  h.watcher.stop();
});

it('retries an HTTP 200 whose emergency proof was not yet accepted, with a three-attempt bound', async () => {
  jest.useFakeTimers();
  jest.spyOn(console, 'info').mockImplementation(() => {});
  const refs: EmergencyPaintMonitorRefs = { watcher: { current: null }, expectedIdentity: { current: 'pending-alert' }, screenId: { current: 'test-screen' }, manifestOkAt: { current: 0 } };
  const post = jest.fn().mockResolvedValue({ status: 200, emergencyPaintAccepted: false });
  function Monitor() { useEmergencyPaintMonitor(refs, { disabled: () => false, post }); return null; }
  const mounted = render(<Monitor />);
  await jest.advanceTimersByTimeAsync(3000);
  expect(post).toHaveBeenCalledTimes(3);
  await jest.advanceTimersByTimeAsync(20_000);
  expect(post).toHaveBeenCalledTimes(3);
  mounted.unmount();
  jest.useRealTimers();
});

it('invalidates previous alert and native challenge evidence before accepting new samples', async () => {
  const root = mountMessage();
  const h = harness(); h.setChallenge('challenge-one'); h.watcher.scan();
  await new Promise(resolve => setTimeout(resolve, 0));
  h.watcher.scan(); h.frame(); h.frame();
  expect(h.watcher.current()).toMatchObject({ painted: true, challenge: 'challenge-one' });
  await new Promise(resolve => setTimeout(resolve, 0));
  h.setChallenge('challenge-two'); h.watcher.scan();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(h.watcher.current()).toMatchObject({ painted: false, challenge: 'challenge-two' });
  h.watcher.scan(); h.frame(); h.frame();
  expect(h.watcher.current()).toMatchObject({ painted: true, challenge: 'challenge-two' });
  h.setIdentity('replacement'); root.dataset.eduEmergencyIdentity = 'replacement'; h.watcher.scan();
  expect(h.watcher.current()).toMatchObject({ painted: false, identity: 'replacement' });
  h.watcher.stop();
});
