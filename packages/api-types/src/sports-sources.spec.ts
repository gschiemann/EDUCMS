/**
 * K12-F33 / F32 — the score sources say what they are, in step with the §21
 * capability registry, and a console is decoded only with its game's sport.
 */
import { CAPABILITY_REGISTRY, CLAIMABLE_STATES } from './capability-registry';
import { SPORTS } from './sports';
import { SCORE_SOURCES, consoleDecoderFor, consoleSource, scoreSource, scoreSourceDrives } from './sports-sources';

const cap = (id: string) => CAPABILITY_REGISTRY.find((c) => c.id === id);

describe('score sources ↔ capability registry (K12-F33)', () => {
  it('every source names a registered capability whose state matches its kind', () => {
    for (const s of SCORE_SOURCES) {
      const c = cap(s.capability);
      expect({ source: s.id, registered: !!c }).toEqual({ source: s.id, registered: true });
      if (s.kind === 'unavailable') expect(c!.state).toBe('NOT_BUILT');
      if (s.kind === 'experimental-hardware') expect(c!.state).toBe('EXPERIMENTAL');
      if (s.kind === 'manual' || s.kind === 'generic-feed') expect(CLAIMABLE_STATES.has(c!.state)).toBe(true);
      // Nothing this list names carries a public claim it has not earned.
      if (!CLAIMABLE_STATES.has(c!.state)) expect(c!.publicClaim).toBeNull();
    }
  });

  it('an unavailable source drives no sport; manual and the feed drive every sport', () => {
    for (const s of SCORE_SOURCES.filter((x) => x.kind === 'unavailable')) {
      expect(SPORTS.some((sp) => scoreSourceDrives(s, sp.key))).toBe(false);
    }
    for (const sp of SPORTS) {
      expect(scoreSourceDrives(scoreSource('manual')!, sp.key)).toBe(true);
      expect(scoreSourceDrives(scoreSource('generic-feed')!, sp.key)).toBe(true);
    }
  });

  it('every hardware source only claims sports the engine has', () => {
    const keys = new Set(SPORTS.map((s) => s.key));
    for (const s of SCORE_SOURCES.filter((x) => x.kind === 'experimental-hardware')) {
      for (const sp of s.sports === 'all' ? [] : s.sports) expect(keys.has(sp)).toBe(true);
      expect(Object.keys(s.decoderSports ?? {}).sort()).toEqual([...(s.sports as string[])].sort());
    }
  });
});

describe('a console is decoded only with its game’s own sport (K12-F32)', () => {
  it('Daktronics: football / basketball / baseball get their own table; softball reads the baseball insert', () => {
    expect(consoleDecoderFor('daktronics-allsport', 'basketball')).toEqual({
      ok: true,
      sourceId: 'daktronics-allsport',
      decoder: 'daktronics',
      decoderSport: 'basketball',
    });
    expect(consoleDecoderFor('daktronics-allsport', 'baseball')).toMatchObject({ ok: true, decoderSport: 'baseball' });
    expect(consoleDecoderFor('daktronics-allsport', 'softball')).toMatchObject({ ok: true, decoderSport: 'baseball' });
  });

  it('a sport with no table is refused — never decoded as football', () => {
    for (const sport of ['volleyball', 'soccer', 'wrestling', 'water_polo', 'hockey']) {
      expect(consoleDecoderFor('daktronics-allsport', sport)).toEqual({
        ok: false,
        code: 'CONSOLE_SPORT_UNSUPPORTED',
        supportedSports: ['football', 'basketball', 'baseball', 'softball'],
      });
    }
    expect(consoleDecoderFor('cts-gen6', 'basketball')).toMatchObject({ ok: false, supportedSports: ['water_polo'] });
    expect(consoleDecoderFor('cts-wttc', 'water_polo')).toMatchObject({ ok: true, decoder: 'cts' });
  });

  it('an unknown console, or no sport, is refused', () => {
    expect(consoleDecoderFor('oes-isc9000', 'football')).toMatchObject({ ok: false, code: 'CONSOLE_UNKNOWN' });
    expect(consoleDecoderFor('daktronics-allsport', null)).toMatchObject({ ok: false, code: 'CONSOLE_SPORT_UNSUPPORTED' });
    expect(consoleSource('cts-gen7')?.id).toBe('cts-console');
  });
});
