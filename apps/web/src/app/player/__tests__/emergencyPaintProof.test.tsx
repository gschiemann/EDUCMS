import { render, cleanup } from '@testing-library/react';
import { EmergencyOverlay, type EmergencyMessageView } from '@/components/player/EmergencyOverlay';
import { EmergencyPaintWatcher, emergencyPaintIdentity, visibleEmergencyRoot, type EmergencyPaintProof } from '../emergencyPaintProof';

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
  let challenge: string | undefined;
  let sequence = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const proofs: EmergencyPaintProof[] = [];
  const order: string[] = [];
  const watcher = new EmergencyPaintWatcher({
    document, documentId: 'test-document', expectedIdentity: () => identity,
    raiseHold: () => { order.push('hold'); },
    readChallenge: async () => { order.push('challenge'); return challenge; },
    report: proof => { order.push(proof.painted ? 'painted' : 'pending'); proofs.push(proof); },
    requestFrame: callback => { sequence += 1; frames.set(sequence, callback); return sequence; },
    cancelFrame: id => { frames.delete(id); },
  });
  const frame = () => {
    const next = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!next) throw new Error('No animation frame scheduled');
    frames.delete(next[0]); next[1](sequence * 16);
  };
  return { watcher, proofs, order, frame, setIdentity: (next: string | null) => { identity = next; }, setChallenge: (next: string) => { challenge = next; } };
}

function mountMessage() {
  render(<EmergencyOverlay message={alert} />);
  const root = document.querySelector<HTMLElement>('[data-edu-emergency-root]')!;
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
