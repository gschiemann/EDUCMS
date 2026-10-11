import {
  createInfoOverlayEvidence, infoInputTarget, infoOpenDecision, infoShortcutAllowed, INFO_OPEN_PHASES, type InfoOpenState,
} from '../infoOverlayEvidence';

afterEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

const PLAYING: InfoOpenState = { phase: 'playing', blank: false, stopped: false, open: false };

test('canvas input is intentional access; child controls, prompts, typing and modified shortcuts are separate actions', () => {
  document.body.innerHTML = '<div data-edu-player-root="media" role="button"><button>Retry</button><div data-edu-update-prompt><span>Update</span></div><input><div data-edu-reconnect-toast><span>Reconnecting</span></div><div data-edu-player-control-surface role="alert"><span>Re-pair required</span></div><div data-edu-player-info-panel role="dialog"><p>Playlist</p></div><h1>Connecting to your CMS</h1></div>';
  const root = document.querySelector('[data-edu-player-root]')!;
  expect(infoInputTarget(root)).toBe('canvas');
  expect(infoInputTarget(document.querySelector('h1'))).toBe('content');
  expect(infoInputTarget(document.querySelector('[data-edu-player-info-panel] p'))).toBe('information');
  expect(infoInputTarget(document.querySelector('[role="alert"] span'))).toBe('control');
  expect(infoShortcutAllowed({ isTrusted: true, target: root })).toBe(true);
  expect(infoShortcutAllowed({ isTrusted: true, target: root, ctrlKey: true })).toBe(false);
  for (const selector of ['button', 'input', '[data-edu-update-prompt] span', '[data-edu-reconnect-toast] span', '[role="alert"] span', '[data-edu-player-info-panel] p']) {
    expect(infoShortcutAllowed({ isTrusted: true, target: document.querySelector(selector) })).toBe(false);
  }
});

test('ONE open policy: content on the glass, not blank, not stopped, not open, unmodified, not from a contained surface', () => {
  document.body.innerHTML = '<div data-edu-player-root="media" role="button"><button>Not now</button><input><h1>Connecting to your CMS</h1></div>';
  const root = document.querySelector('[data-edu-player-root]')!;
  const key = { isTrusted: true, type: 'keydown', key: 'i', target: root };
  expect(infoOpenDecision(PLAYING, key)).toBe('open');
  expect(infoOpenDecision({ ...PLAYING, phase: 'offline' }, key)).toBe('open');
  expect(INFO_OPEN_PHASES).toEqual(['playing', 'offline']);
  // The connecting hero / registering / pairing splashes are not content.
  for (const phase of ['connecting', 'registering', 'pairing', 'other']) {
    expect(infoOpenDecision({ ...PLAYING, phase }, key)).toBe('phase');
  }
  // A click on the hero's own text (content inside the root) is refused by phase too.
  expect(infoOpenDecision({ ...PLAYING, phase: 'connecting' }, { isTrusted: true, type: 'click', target: document.querySelector('h1') })).toBe('phase');
  expect(infoOpenDecision({ ...PLAYING, blank: true }, key)).toBe('blank');
  expect(infoOpenDecision({ ...PLAYING, stopped: true }, key)).toBe('stopped');
  expect(infoOpenDecision({ ...PLAYING, open: true }, key)).toBe('already-open');
  expect(infoOpenDecision(PLAYING, { ...key, target: document.querySelector('button') })).toBe('target');
  expect(infoOpenDecision(PLAYING, { ...key, target: document.querySelector('input') })).toBe('target');
  for (const mod of ['ctrlKey', 'altKey', 'metaKey'] as const) {
    expect(infoOpenDecision(PLAYING, { ...key, [mod]: true })).toBe('modified');
  }
  // Shift alone is not a shortcut modifier (a capital I is a plain key); synthetic
  // and keyboard activations are NOT refused on provenance — honesty limit.
  expect(infoOpenDecision(PLAYING, { ...key, shiftKey: true })).toBe('open');
  expect(infoOpenDecision(PLAYING, { ...key, isTrusted: false })).toBe('open');
  expect(infoOpenDecision(PLAYING, { isTrusted: true, type: 'click', detail: 0, target: root })).toBe('open');
});

test('only openings persist; recent input and refusals remain private, bounded, and openings survive a new document', () => {
  let at = 1000;
  const journal = createInfoOverlayEvidence(localStorage, 'own-face', 'abc123', () => at);
  const pointer = { type: 'pointerdown', isTrusted: true, target: document.body };
  journal.input({ ...pointer, type: 'keydown', key: 'customer-private-text' });
  journal.refused('phase', 'media-click', { ...pointer, type: 'click' }, 'connecting');
  journal.refused('phase', 'media-key', { ...pointer, type: 'keydown', key: 'Enter' }, 'connecting');
  expect(localStorage.getItem('own-face')).toBeNull();
  expect(journal.snapshot(false)).toMatchObject({ refused: { phase: 2 }, lastRefused: { reason: 'phase', source: 'media-key', key: 'Enter', phase: 'connecting' } });
  journal.input(pointer); at += 30;
  journal.opened('media-click', { ...pointer, type: 'click', detail: 1 });
  const snapshot = journal.snapshot(true);
  expect(snapshot.events[0]).toMatchObject({ source: 'media-click', trusted: true, detail: 1, uptimeMs: 30, bundle: 'abc123' });
  expect(snapshot.events[0].recent[0].key).toBeNull();
  expect(JSON.stringify(snapshot)).not.toContain('customer-private-text');
  // A new document restores the openings WITH their original provenance; refusals do not persist.
  const reloaded = createInfoOverlayEvidence(localStorage, 'own-face', 'new123', () => at);
  expect(reloaded.snapshot(false)).toMatchObject({ open: false, bundle: 'new123', events: snapshot.events, refused: {}, lastRefused: null });
  expect(reloaded.snapshot(false).events[0]).toMatchObject({ bundle: 'abc123', document: snapshot.document });
  expect(createInfoOverlayEvidence(localStorage, 'other-face', 'abc123', () => at).snapshot(false).events).toEqual([]);
  // Last events are retained on each heartbeat, rather than cleared after send.
  expect(journal.snapshot(false).events).toEqual(snapshot.events);
  for (let i = 0; i < 20; i++) {
    at++;
    journal.input({ ...pointer, type: 'keydown', key: 'Home' });
    journal.opened('remote-key', { ...pointer, type: 'keydown', key: 'Home' });
  }
  for (let i = 0; i < 2000; i++) journal.refused('target', 'remote-key', { ...pointer, type: 'keydown', key: 'i' }, 'playing');
  expect(journal.snapshot(false).events).toHaveLength(2);
  expect(journal.snapshot(false).refused.target).toBe(999);
  expect(Buffer.byteLength(JSON.stringify(journal.snapshot(false)))).toBeLessThan(2048);
});

test('stored input is revalidated rather than forwarding arbitrary fields or old tenant data', () => {
  const at = 1_000_000_000;
  localStorage.setItem('own-face', JSON.stringify([{ source: 'remote-key', at,
    type: 'keydown', key: 'private', target: 'private', focused: 'private', pointer: 'private', bundle: 'https://private', document: 'PRIVATE!',
    credentials: 'secret-token', modifiers: 'private', recent: [{ type: 'private', key: 'private', url: 'secret-url' }] }]));
  const snapshot = createInfoOverlayEvidence(localStorage, 'own-face', 'abc123', () => at).snapshot(false);
  expect(snapshot.events).toHaveLength(1);
  expect(snapshot.events[0]).toMatchObject({ bundle: 'unknown', document: 'unknown', key: null, target: 'other' });
  expect(JSON.stringify(snapshot)).not.toMatch(/private|secret/i);
  expect(createInfoOverlayEvidence(localStorage, 'own-face', 'abc123', () => at + 86_400_001).snapshot(false).events).toEqual([]);
  const broken = createInfoOverlayEvidence({ getItem: () => { throw new Error('disabled'); },
    setItem: () => { throw new Error('full'); } }, '', 'abc123', () => at);
  expect(() => broken.opened('remote-key', { key: 'i', isTrusted: false })).not.toThrow();
  expect(() => broken.refused('blank', 'remote-key', { key: 'i', isTrusted: false }, 'playing')).not.toThrow();
  expect(broken.snapshot(true)).toMatchObject({ open: true, refused: { blank: 1 } });
});
