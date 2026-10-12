/**
 * Glass continuity (2026-10-11, launch W4): a paired screen that has shown
 * content never shows our chrome. Every decision is pure and tested here,
 * shape by shape; the first-paint inline script is run against the SAME
 * fixtures as its TypeScript twin so the two cannot drift.
 */
import {
  decideItemFailure,
  hasShownContentBefore,
  IdentityVerdictGate,
  LAST_GOOD_RETRY_MAX_MS,
  lastGoodRetryDelayMs,
  markContentShown,
  quietGlass,
  reconcileCachedKeys,
  tokenScreenId,
  UNPAIR_CONFIRM_MS,
} from '../glassContinuity';
import { QUIET_BOOT_ATTR, QUIET_BOOT_INLINE_JS, clearQuietBoot } from '../quietBootInline';
import {
  clearOfflineManifests,
  GLASS_SHOWN_PREFIX,
  LEGACY_MANIFEST_KEY,
  recordManifestPairing,
  saveManifest,
} from '../offlineBoot';

const screenId = '11111111-1111-4111-8111-111111111111';
const tenantId = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const fp = 'fp-glass';
const jwt = (extra: Record<string, unknown> = {}) =>
  'header.' + Buffer.from(JSON.stringify({ kind: 'device', sub: screenId, tenantId, exp: 1, ...extra })).toString('base64url') + '.sig';
const withContent = { screenId, tenantId, playlists: [{ name: 'Lobby', items: [{ id: 'a' }] }] };
const empty = { screenId, tenantId, playlists: [] };

/** Run the ES5 first-paint script against the current localStorage; did it mark <html>? */
function inlineSaysQuiet(token: string | null): boolean {
  if (token) localStorage.setItem('edu_device_token', token);
  else localStorage.removeItem('edu_device_token');
  document.documentElement.removeAttribute(QUIET_BOOT_ATTR);
  // eslint-disable-next-line no-new-func
  new Function(QUIET_BOOT_INLINE_JS)();
  return document.documentElement.getAttribute(QUIET_BOOT_ATTR) === '1';
}

/** Both halves must agree on every fixture. */
function expectBoth(token: string | null, expected: boolean) {
  expect(hasShownContentBefore(localStorage, token)).toBe(expected);
  expect(inlineSaysQuiet(token)).toBe(expected);
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute(QUIET_BOOT_ATTR);
});

describe('has this screen shown content? (TS rule + ES5 first-paint twin)', () => {
  it('the inline script is valid ES5-era JavaScript (no arrows / template literals / optional chaining)', () => {
    // eslint-disable-next-line no-new-func
    expect(() => new Function(QUIET_BOOT_INLINE_JS)).not.toThrow();
    expect(QUIET_BOOT_INLINE_JS).not.toMatch(/=>|`|\?\.|\blet\b|\bconst\b/);
  });

  it('unpaired / no token: never quiet — the splash and pairing code stay', () => {
    expectBoth(null, false);
    expectBoth('not-a-jwt', false);
    expectBoth(jwt({ kind: 'user' }), false);
  });

  it('paired but first run (no content ever, an EMPTY playable snapshot): not quiet — "Screen paired" card stays', () => {
    saveManifest(localStorage, empty, screenId, fp, true);
    expectBoth(jwt(), false);
  });

  it('the persisted flag makes it quiet', () => {
    markContentShown(localStorage, screenId);
    expect(localStorage.getItem(GLASS_SHOWN_PREFIX + screenId)).toBe('1');
    expectBoth(jwt(), true);
  });

  it('a field screen with no flag yet but a playable snapshot carrying playlists is quiet (first reload after this ships)', () => {
    saveManifest(localStorage, withContent, screenId, fp, true);
    expectBoth(jwt(), true);
  });

  it('the legacy v1 snapshot for THIS screen counts; for another screen it does not', () => {
    localStorage.setItem(LEGACY_MANIFEST_KEY, JSON.stringify({ at: 1, m: withContent }));
    expectBoth(jwt(), true);
    localStorage.setItem(LEGACY_MANIFEST_KEY, JSON.stringify({ at: 1, m: { ...withContent, screenId: other } }));
    expectBoth(jwt(), false);
  });

  it('a flag for a DIFFERENT screen does not make this one quiet', () => {
    markContentShown(localStorage, other);
    expectBoth(jwt(), false);
  });

  it('the server retired the screen (unpaired verdict): never quiet, even with the flag', () => {
    markContentShown(localStorage, screenId);
    recordManifestPairing(localStorage, screenId, false);
    expectBoth(jwt(), false);
  });

  it('?preview=1 never marks the document (the dashboard preview keeps its diagnostics)', () => {
    markContentShown(localStorage, screenId);
    window.history.replaceState(null, '', '/player?preview=1');
    try {
      expect(inlineSaysQuiet(jwt())).toBe(false);
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('an authenticated unpair (clearOfflineManifests) wipes the flag', () => {
    markContentShown(localStorage, screenId);
    clearOfflineManifests(localStorage);
    expectBoth(jwt(), false);
  });

  it('clearQuietBoot takes the mark down', () => {
    markContentShown(localStorage, screenId);
    expect(inlineSaysQuiet(jwt())).toBe(true);
    clearQuietBoot(document);
    expect(document.documentElement.hasAttribute(QUIET_BOOT_ATTR)).toBe(false);
  });

  it('tokenScreenId reads only device tokens with a uuid subject', () => {
    expect(tokenScreenId(jwt())).toBe(screenId);
    expect(tokenScreenId(jwt({ sub: 'nope' }))).toBeNull();
    expect(tokenScreenId(null)).toBeNull();
  });
});

describe('quietGlass — where our chrome may paint', () => {
  const base = { everShown: true, phase: 'playing', playbackStopped: false, emergency: false, preview: false };

  it('a paired screen that has shown content is quiet in every non-pairing phase', () => {
    for (const phase of ['registering', 'connecting', 'playing']) {
      expect(quietGlass({ ...base, phase })).toBe(true);
    }
  });

  it('first run / unpaired keeps its surfaces', () => {
    expect(quietGlass({ ...base, everShown: false })).toBe(false);
  });

  it('the pairing code is never hidden', () => {
    expect(quietGlass({ ...base, phase: 'pairing' })).toBe(false);
  });

  it('a person pressing Back gets the Screen options surface', () => {
    expect(quietGlass({ ...base, playbackStopped: true })).toBe(false);
  });

  it('dashboard preview keeps its diagnostics', () => {
    expect(quietGlass({ ...base, preview: true })).toBe(false);
  });

  it('EMERGENCY: never quiet, in any state — the alert keeps exactly the surfaces it had', () => {
    for (const phase of ['registering', 'connecting', 'playing', 'emergency', 'pairing']) {
      for (const playbackStopped of [false, true]) {
        for (const everShown of [false, true]) {
          expect(quietGlass({ everShown, phase, playbackStopped, emergency: true, preview: false })).toBe(false);
        }
      }
    }
  });
});

describe('decideItemFailure — keep the last good file', () => {
  const base = { isEmergency: false, syncLocked: false, provenGood: true, othersPlayable: 0 };

  it('single-video playlist: a file that played here before is retried in place, never set aside', () => {
    expect(decideItemFailure(base)).toBe('retry-in-place');
  });

  it('something else can play → set aside as before (the rotation steps over it)', () => {
    expect(decideItemFailure({ ...base, othersPlayable: 1 })).toBe('set-aside');
  });

  it('a file that never played on this page is set aside as before', () => {
    expect(decideItemFailure({ ...base, provenGood: false })).toBe('set-aside');
  });

  it('frame-locked sync keeps the old rule (the timeline owns the slot)', () => {
    expect(decideItemFailure({ ...base, syncLocked: true })).toBe('set-aside');
  });

  it('EMERGENCY playlists are untouched', () => {
    expect(decideItemFailure({ ...base, isEmergency: true })).toBe('set-aside');
  });

  it('backoff grows and caps at a minute', () => {
    const d = [1, 2, 3, 4, 5, 50].map(lastGoodRetryDelayMs);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1]);
    expect(d[0]).toBeLessThanOrEqual(5_000);
    expect(d[d.length - 1]).toBe(LAST_GOOD_RETRY_MAX_MS);
    expect(lastGoodRetryDelayMs(0)).toBe(d[0]);
  });
});

describe('reconcileCachedKeys — an empty cache report is a question, not a fact', () => {
  const keyOf = (u: string) => `k:${u}`;
  const prev: ReadonlySet<string> = new Set(['k:a', 'k:b', 'k:c']);

  it('worker cannot answer → nothing forgotten', () => {
    expect(reconcileCachedKeys(prev, null, keyOf, new Set())).toBe(prev);
  });

  it('the file ON GLASS is never forgotten, even when the worker says it is gone', () => {
    const out = reconcileCachedKeys(prev, { a: { present: false } }, keyOf, new Set(['k:a']));
    expect(out).toBe(prev);
  });

  it('only files the worker confirms absent are forgotten', () => {
    const out = reconcileCachedKeys(prev, { a: { present: true }, b: { present: false } }, keyOf, new Set(['k:c']));
    expect([...out].sort()).toEqual(['k:a', 'k:c']);
  });

  it('nothing changes → the same set (no re-render)', () => {
    expect(reconcileCachedKeys(prev, { a: { present: true } }, keyOf, new Set())).toBe(prev);
  });
});

describe('IdentityVerdictGate — one server answer never takes a playing screen to pairing', () => {
  const unpaired = { paired: false, screenId, knownScreenId: screenId };
  const moved = { paired: true, screenId: other, knownScreenId: screenId };
  const fine = { paired: true, screenId, knownScreenId: screenId };

  it('a benign answer is accepted', () => {
    expect(new IdentityVerdictGate().decide(fine, true, 0)).toBe('accept');
  });

  it('no content on the glass (boot / setup): applied at once, as before', () => {
    expect(new IdentityVerdictGate().decide(unpaired, false, 0)).toBe('apply');
  });

  it('content on the glass: the first "unpaired" is held; an identical answer ≥ 60 s later applies', () => {
    const g = new IdentityVerdictGate();
    expect(g.decide(unpaired, true, 1_000)).toBe('hold');
    expect(g.confirmDueAt()).toBe(1_000 + UNPAIR_CONFIRM_MS);
    expect(g.decide(unpaired, true, 30_000)).toBe('hold'); // too soon — does not restart the clock
    expect(g.confirmDueAt()).toBe(1_000 + UNPAIR_CONFIRM_MS);
    expect(g.decide(unpaired, true, 1_000 + UNPAIR_CONFIRM_MS)).toBe('apply');
    expect(g.isPending).toBe(false);
  });

  it('a blip: a paired answer in between clears the pending verdict', () => {
    const g = new IdentityVerdictGate();
    expect(g.decide(unpaired, true, 0)).toBe('hold');
    expect(g.decide(fine, true, 10_000)).toBe('accept');
    expect(g.isPending).toBe(false);
    expect(g.decide(unpaired, true, 70_000)).toBe('hold'); // starts over
  });

  it('a DIFFERENT answer restarts confirmation (unpaired, then a new screen id)', () => {
    const g = new IdentityVerdictGate();
    expect(g.decide(unpaired, true, 0)).toBe('hold');
    expect(g.decide(moved, true, 61_000)).toBe('hold');
    expect(g.decide(moved, true, 61_000 + UNPAIR_CONFIRM_MS)).toBe('apply');
  });
});
