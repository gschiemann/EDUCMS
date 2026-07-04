/**
 * BUG #5 regression — the SW `activate` copy-forward handler must select the
 * NEWEST prior cache by NUMERIC version, not lexically. Under the old
 * `Array.prototype.sort()` (string compare), `edu-player-emergency-v10` sorts
 * BEFORE `...-v9` (because '1' < '9' at the third char), so after the 10th
 * VERSION bump the handler copied the STALE v9 cache forward and lost a whole
 * version's worth of freshly-cached assets on every kiosk.
 *
 * The SW is a plain script under apps/web/public (outside the Jest `src`
 * root), so we load its source, evaluate it against the jsdom `self`, and
 * exercise the pure helpers it exposes on `self.__swTestHooks`.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';

type SwTestHooks = {
  cacheVersionNum: (name: string) => number;
  newestCacheName: (names: string[]) => string | null;
};

function loadSwHooks(): SwTestHooks {
  const swPath = join(__dirname, '../../../../public/sw-player.js');
  const src = readFileSync(swPath, 'utf8');

  // Minimal SW-like global. The SW registers event listeners at load time
  // and references `caches` only INSIDE those (never-fired) callbacks, so a
  // no-op addEventListener + an absent `caches` is enough to evaluate it.
  const fakeSelf: any = {
    addEventListener: () => {},
    location: { origin: 'https://player.example' },
  };
  fakeSelf.self = fakeSelf;

  // Only globals referenced at SW LOAD time are needed. `caches`, `Response`,
  // `Request`, `Headers`, `fetch`, `crypto` are touched only inside the
  // (never-fired here) event/message handlers, so they can be absent.
  const sandbox: any = {
    self: fakeSelf,
    console,
    URL,
    Map,
    Set,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'sw-player.js' });

  const hooks = fakeSelf.__swTestHooks as SwTestHooks | undefined;
  if (!hooks) throw new Error('sw-player.js did not expose self.__swTestHooks');
  return hooks;
}

describe('sw-player cache version selection (BUG #5)', () => {
  const { cacheVersionNum, newestCacheName } = loadSwHooks();

  describe('cacheVersionNum', () => {
    it('parses the trailing -vN integer', () => {
      expect(cacheVersionNum('edu-player-emergency-v9')).toBe(9);
      expect(cacheVersionNum('edu-player-emergency-v10')).toBe(10);
      expect(cacheVersionNum('edu-player-playlist-v100')).toBe(100);
    });

    it('returns -1 for names with no -vN suffix', () => {
      expect(cacheVersionNum('edu-player-emergency-nope')).toBe(-1);
      expect(cacheVersionNum('')).toBe(-1);
      expect(cacheVersionNum(undefined as unknown as string)).toBe(-1);
    });
  });

  describe('newestCacheName — the actual bug', () => {
    it('picks v10 over v9 (the exact 10th-bump regression a lexical sort got WRONG)', () => {
      const names = ['edu-player-emergency-v9', 'edu-player-emergency-v10'];
      // A lexical sort would have chosen v9 here — assert we now get v10.
      expect(newestCacheName(names)).toBe('edu-player-emergency-v10');
      // Order-independent: reversed input must give the same answer.
      expect(newestCacheName([...names].reverse())).toBe('edu-player-emergency-v10');
    });

    it('proves the lexical sort was wrong for this input', () => {
      const names = ['edu-player-emergency-v9', 'edu-player-emergency-v10'];
      const lexicalNewest = [...names].sort()[names.length - 1];
      // The old (buggy) approach picks v9 …
      expect(lexicalNewest).toBe('edu-player-emergency-v9');
      // … while the fix picks v10.
      expect(newestCacheName(names)).not.toBe(lexicalNewest);
    });

    it('still works across many versions (v2 … v100)', () => {
      const names = ['v2', 'v9', 'v10', 'v11', 'v100', 'v99'].map(
        (v) => `edu-player-playlist-${v}`,
      );
      expect(newestCacheName(names)).toBe('edu-player-playlist-v100');
    });

    it('picks the single entry, and null for an empty list', () => {
      expect(newestCacheName(['edu-player-meta-v9'])).toBe('edu-player-meta-v9');
      expect(newestCacheName([])).toBeNull();
    });
  });
});
