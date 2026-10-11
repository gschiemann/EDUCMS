import {
  deriveTeamAbbrev,
  isValidTeamAbbrevInput,
  normalizeTeamAbbrev,
  resolveTeamAbbrevs,
} from './team-abbrev';

describe('team abbreviations (S-04 / DEV-028)', () => {
  it('derives a short name', () => {
    expect(deriveTeamAbbrev('Eagles')).toBe('EAG');
    expect(deriveTeamAbbrev('Lincoln High School')).toBe('LIN');
    expect(deriveTeamAbbrev('North Central')).toBe('NC');
    expect(deriveTeamAbbrev('St. Mary’s Academy')).toBe('SM');
    expect(deriveTeamAbbrev('')).toBe('');
  });

  it('the beta collision no longer collides', () => {
    const r = resolveTeamAbbrevs({ homeTeam: 'Muse Sports Test Home', awayTeam: 'Muse Sports Test Away' });
    expect(r.home).toBe('MSTH');
    expect(r.away).toBe('MSTA');
    expect(r.collision).toBe(false);
  });

  it('a derived clash is told apart by the word that differs', () => {
    const r = resolveTeamAbbrevs({ homeTeam: 'Lincoln', awayTeam: 'Lincoln East' });
    expect(r.home).toBe('LIN');
    expect(r.away).not.toBe('LIN');
    expect(r.collision).toBe(false);
  });

  it('operator values win; two identical operator values are flagged', () => {
    expect(resolveTeamAbbrevs({ homeTeam: 'Lions', awayTeam: 'Tigers', homeAbbrev: 'lhs', awayAbbrev: null })).toEqual({
      home: 'LHS', away: 'TIG', collision: false,
    });
    expect(resolveTeamAbbrevs({ homeTeam: 'A', awayTeam: 'B', homeAbbrev: 'CAT', awayAbbrev: 'CAT' }).collision).toBe(true);
  });

  it('validates operator input', () => {
    expect(isValidTeamAbbrevInput('LHS')).toBe(true);
    expect(isValidTeamAbbrevInput('')).toBe(true);
    expect(isValidTeamAbbrevInput(null)).toBe(true);
    expect(isValidTeamAbbrevInput('TOOLONG')).toBe(false);
    expect(isValidTeamAbbrevInput('A-B')).toBe(false);
    expect(normalizeTeamAbbrev(' lhs ')).toBe('LHS');
    expect(normalizeTeamAbbrev('')).toBeNull();
  });
});
