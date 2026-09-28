import {
  CELEBRATION_PERSON_KEYS,
  hasTypedStudentNames,
  normalizeTypedName,
  redactStudentNameFields,
  studentNameEditorKeys,
  studentNameFieldsFor,
  studentNameKeysFor,
  type StudentNameMatcher,
} from './student-name-fields';

/** A matcher over one hidden student, "Jordan Lee" (full "jordan lee", last "lee"). */
function matcherFor(full: string, last: string): StudentNameMatcher {
  const f = normalizeTypedName(full);
  const l = normalizeTypedName(last);
  const name = (v: string) => {
    const n = normalizeTypedName(v);
    return n === f || n === l;
  };
  return {
    name,
    text: (v) => name(v) || ` ${normalizeTypedName(v)} `.includes(` ${f} `),
  };
}

const LEE = matcherFor('Jordan Lee', 'Lee');

describe('student-name-fields — where a typed student name can live', () => {
  it('knows the relay legs, the CTS announcement lines, the venue name fields and every celebration person key', () => {
    expect(studentNameFieldsFor('SWIM_RELAY_EXCHANGE', {})).toEqual([{ path: 'legs[].swimmer', kind: 'name' }]);
    expect(studentNameFieldsFor('SCOREBOARD', { variant: 'scoreboard-cts-announcement' })).toEqual([
      { path: 'entries[].text', kind: 'text' },
    ]);
    expect(studentNameKeysFor('SCOREBOARD', { variant: 'player-card' })).toEqual(new Set(['player']));
    expect(studentNameKeysFor('SCOREBOARD', { variant: 'starting-lineup' })).toEqual(new Set(['lineup']));
    const cel = studentNameKeysFor('CELEBRATION', { variant: 'cel-football-touchdown' });
    for (const k of CELEBRATION_PERSON_KEYS) expect(cel.has(k)).toBe(true);
    expect(cel.has('players')).toBe(true);
    // A widget with no typed names has no fields — and a team name is not one.
    expect(studentNameFieldsFor('CLOCK', {})).toEqual([]);
    expect(studentNameKeysFor('SCOREBOARD', { variant: 'scoreboard-main' }).size).toBe(0);
  });

  it('names the exact editor keys the builder puts its notice on', () => {
    expect(studentNameEditorKeys('SWIM_RELAY_EXCHANGE', {})).toEqual(new Set(['legs']));
    expect(studentNameEditorKeys('SCOREBOARD', { variant: 'player-card' })).toEqual(new Set(['player.first', 'player.last']));
    expect(studentNameEditorKeys('SCOREBOARD', { variant: 'goal-celebration' })).toEqual(new Set(['player.name']));
    expect(studentNameEditorKeys('SCOREBOARD', { variant: 'starting-lineup' })).toEqual(new Set(['lineup']));
    expect(studentNameEditorKeys('SCOREBOARD', { variant: 'scoreboard-cts-announcement' })).toEqual(new Set(['entries']));
    expect(studentNameEditorKeys('CELEBRATION', { variant: 'cel-baseball-doubleplay' }).has('players')).toBe(true);
  });

  it('normalizes case, width and punctuation, keeping apostrophes and hyphens', () => {
    expect(normalizeTypedName('  LEE. ')).toBe('lee');
    expect(normalizeTypedName('ＬＥＥ')).toBe('lee');
    expect(normalizeTypedName("O’BRIEN")).toBe("o'brien");
    expect(normalizeTypedName('Smith-Jones,  Avery')).toBe('smith-jones avery');
  });
});

describe('redactStudentNameFields', () => {
  it('blanks a relay leg whose swimmer IS a hidden student (full or last name), keeps the others, never mutates', () => {
    const cfg = {
      teamName: 'LEE HIGH', // a team label is not a name field
      legs: [
        { legName: 'LEG 1', swimmer: 'Jordan Lee', split: '27.80' },
        { legName: 'LEG 2', swimmer: 'LEE', split: '31.42' },
        { legName: 'LEG 3', swimmer: 'M. Chen', split: '28.95' },
        { legName: 'LEG 4', swimmer: 'Jordan Leeds', split: '26.60' },
      ],
    };
    const before = JSON.stringify(cfg);
    const { config, blanked } = redactStudentNameFields('SWIM_RELAY_EXCHANGE', cfg, LEE);
    expect(blanked).toBe(2);
    const legs = (config as typeof cfg).legs;
    expect(legs.map((l) => l.swimmer)).toEqual(['', '', 'M. Chen', 'Jordan Leeds']);
    expect(legs[0].split).toBe('27.80'); // only the name goes
    expect((config as typeof cfg).teamName).toBe('LEE HIGH');
    expect(JSON.stringify(cfg)).toBe(before);
  });

  it('returns the SAME object when nothing is hidden', () => {
    const cfg = { legs: [{ swimmer: 'M. Chen' }] };
    expect(redactStudentNameFields('SWIM_RELAY_EXCHANGE', cfg, LEE).config).toBe(cfg);
    const other = { text: 'Jordan Lee' };
    expect(redactStudentNameFields('TEXT', other, LEE).config).toBe(other); // not a declared field
  });

  it('a first / last pair is one name: the pair, or the last name alone, blanks both', () => {
    const full = redactStudentNameFields(
      'SCOREBOARD',
      { variant: 'player-card', player: { first: 'JORDAN', last: 'LEE', number: '3' } },
      LEE,
    ).config as { player: Record<string, string> };
    expect(full.player).toEqual({ first: '', last: '', number: '3' });
    const lastOnly = redactStudentNameFields(
      'SCOREBOARD',
      { variant: 'starting-lineup', lineup: [{ first: 'Sam', last: 'Lee' }, { first: 'Maya', last: 'Patel' }] },
      LEE,
    ).config as { lineup: Array<Record<string, string>> };
    expect(lastOnly.lineup).toEqual([{ first: '', last: '' }, { first: 'Maya', last: 'Patel' }]);
  });

  it('free text: an embedded FULL name blanks the line; a lone last name inside a sentence does not', () => {
    const { config } = redactStudentNameFields(
      'SCOREBOARD',
      {
        variant: 'scoreboard-cts-announcement',
        entries: [
          { text: 'PLAYER OF THE WEEK — JORDAN LEE · 4 GOALS', durationMs: 6000 },
          { text: 'LEE HIGH AT HOME FRIDAY', durationMs: 5000 },
          { text: 'Lee', durationMs: 5000 },
        ],
      },
      LEE,
    );
    expect((config as { entries: Array<{ text: string; durationMs: number }> }).entries).toEqual([
      { text: '', durationMs: 6000 },
      { text: 'LEE HIGH AT HOME FRIDAY', durationMs: 5000 },
      { text: '', durationMs: 5000 },
    ]);
  });

  it('celebrations: single person keys and person lists', () => {
    const { config, blanked } = redactStudentNameFields(
      'CELEBRATION',
      { variant: 'cel-baseball-doubleplay', player: 'JORDAN LEE', players: ['SS', 'Lee', '1B'], distance: '67 YD' },
      LEE,
    );
    expect(blanked).toBe(2);
    expect(config).toEqual({ variant: 'cel-baseball-doubleplay', player: '', players: ['SS', '', '1B'], distance: '67 YD' });
  });

  it('tolerates odd shapes without throwing', () => {
    for (const cfg of [null, undefined, 'x', 42, [], { legs: 'nope' }, { legs: [null, 3, { swimmer: 7 }] }]) {
      expect(() => redactStudentNameFields('SWIM_RELAY_EXCHANGE', cfg, LEE)).not.toThrow();
    }
  });
});

describe('hasTypedStudentNames', () => {
  it('is true only when a declared field carries a value', () => {
    expect(hasTypedStudentNames('SWIM_RELAY_EXCHANGE', { legs: [{ swimmer: '' }] })).toBe(false);
    expect(hasTypedStudentNames('SWIM_RELAY_EXCHANGE', { legs: [{ swimmer: 'x' }] })).toBe(true);
    expect(hasTypedStudentNames('SWIM_SPLITS_PANEL', { swimmerName: 'D. Okafor' })).toBe(true);
    expect(hasTypedStudentNames('CLOCK', { label: 'Jordan Lee' })).toBe(false);
  });
});
