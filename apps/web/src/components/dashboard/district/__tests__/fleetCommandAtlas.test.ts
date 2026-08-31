/**
 * fleetCommand — the Network Atlas derivation (2026-08-31).
 *
 * The Atlas draws THREE pictures of one derivation: the pin rings, the
 * grouped exception inbox, and the selected-location panel. These tests pin
 * the contract that keeps those three from ever disagreeing — and the
 * honesty rules (a category count is the real count; a city line is only
 * printed when the address actually carries one).
 */
import {
  atlasRowLines,
  buildLocationPanel,
  donutSegments,
  groupInbox,
  parseCityState,
  INBOX_GROUP_LABEL,
  type ExceptionRow,
  type LocationRow,
} from '../fleetCommand';

function row(over: Partial<ExceptionRow> = {}): ExceptionRow {
  return {
    kind: 'content-behind',
    tenantId: 't1',
    tenantName: 'RIOT Sacramento',
    slug: 'sac',
    headline: 'G43 · Behind on content',
    detail: 'Content update published 18 minutes ago.',
    path: 'screens',
    count: 1,
    ...over,
  };
}

function loc(over: Partial<LocationRow> = {}): LocationRow {
  return {
    tenantId: 't1',
    name: 'RIOT Sacramento',
    slug: 'sac',
    isSelf: false,
    screensTotal: 3,
    screensOnline: 3,
    screensOffline: 0,
    notPainting: 0,
    readiness: 'READY',
    missingTypes: [],
    lockdownWired: true,
    pendingApprovals: 0,
    needsAttention: false,
    contentBehind: 0,
    pushStale: 0,
    emergencyCached: 3,
    hasScreens: true,
    ...over,
  } as LocationRow;
}

describe('groupInbox — the mock’s collapsible categories', () => {
  it('buckets worst-first and reports the TRUE count per category', () => {
    const groups = groupInbox([
      row({ kind: 'push-stale', screenId: 'a', screenName: 'G09' }),
      row({ kind: 'content-behind', screenId: 'b', screenName: 'G43' }),
      row({ kind: 'content-behind', screenId: 'c', screenName: 'G17' }),
      row({ kind: 'not-painting', screenId: 'd', screenName: 'G02' }),
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['not-painting', 'content-behind', 'push-stale']);
    expect(groups.map((g) => g.count)).toEqual([1, 2, 1]);
    // Category headings are the operator's words, never the wire's.
    expect(groups.map((g) => g.label)).toEqual([
      'No picture confirmed', 'Behind on content', 'Push disconnected',
    ]);
  });

  it('never labels a category with the wire word for render proof', () => {
    expect(Object.values(INBOX_GROUP_LABEL).join(' ')).not.toMatch(/paint/i);
  });

  it('a capped category still reports its real total, and says what it hid', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ kind: 'offline', screenId: `s${i}`, screenName: `G${i}` }));
    const [g] = groupInbox(rows, 2);
    expect(g.rows).toHaveLength(2);
    expect(g.count).toBe(5);
    expect(g.hidden).toBe(3);
  });

  it('an empty inbox produces no groups at all — never seven empty headings', () => {
    expect(groupInbox([])).toEqual([]);
  });

  it('preserves within-category order (the derivation already ranked it)', () => {
    const groups = groupInbox([
      row({ kind: 'offline', screenId: 'old', screenName: 'Oldest', age: '3h' }),
      row({ kind: 'offline', screenId: 'new', screenName: 'Newest', age: '2m' }),
    ]);
    expect(groups[0].rows.map((r) => r.screenName)).toEqual(['Oldest', 'Newest']);
  });
});

describe('atlasRowLines — LOCATION on top, screen underneath', () => {
  it('a screen row leads with the location and names the screen below it', () => {
    expect(atlasRowLines(row({ screenId: 'x', screenName: 'G43', age: '18m' }))).toEqual({
      title: 'RIOT Sacramento',
      sub: 'G43 · Behind on content',
      age: '18m',
    });
  });

  it('a location-level row falls back to its own detail sentence', () => {
    expect(atlasRowLines(row({
      kind: 'emergency',
      headline: 'RIOT Sacramento can’t display an emergency alert',
      detail: 'No alert content wired.',
    }))).toEqual({ title: 'RIOT Sacramento', sub: 'No alert content wired.', age: undefined });
  });

  it('an aggregate row leads with its own "+N more" headline', () => {
    expect(atlasRowLines(row({
      aggregate: true, count: 2, headline: '+2 more at RIOT Sacramento', detail: 'Also behind on content.',
    })).title).toBe('+2 more at RIOT Sacramento');
  });
});

describe('donutSegments — the pin ring is the screen mix', () => {
  it('an all-healthy location is one full green arc', () => {
    expect(donutSegments(loc())).toEqual([{ tone: 'ok', count: 3 }]);
  });

  it('splits healthy / warn / bad in ring order', () => {
    expect(donutSegments(loc({ screensTotal: 6, screensOnline: 5, screensOffline: 1, notPainting: 2, contentBehind: 1 })))
      .toEqual([{ tone: 'ok', count: 2 }, { tone: 'warn', count: 2 }, { tone: 'bad', count: 2 }]);
  });

  it('counts the polling backstop as warn — a warn pin must not render all-green', () => {
    // locationTone() grades this location amber for pushStale alone. If the
    // ring's segments ignored it, the pin would draw a full emerald donut
    // under an amber verdict — the map contradicting itself.
    expect(donutSegments(loc({ screensTotal: 2, screensOnline: 2, pushStale: 1 })))
      .toEqual([{ tone: 'ok', count: 1 }, { tone: 'warn', count: 1 }]);
  });

  it('never draws more arc than there are screens (behind AND blind is one screen)', () => {
    const segs = donutSegments(loc({ screensTotal: 2, screensOnline: 2, notPainting: 2, contentBehind: 2 }));
    expect(segs.reduce((n, s) => n + s.count, 0)).toBe(2);
    expect(segs).toEqual([{ tone: 'bad', count: 2 }]);
  });

  it('a screenless location draws NO ring — a full grey one would read as fine', () => {
    expect(donutSegments(loc({ screensTotal: 0, screensOnline: 0, hasScreens: false, emergencyCached: 0 }))).toEqual([]);
  });
});

describe('buildLocationPanel — the selected-location numbers', () => {
  it('splits current vs behind out of the ONLINE screens', () => {
    const p = buildLocationPanel(loc({ screensTotal: 3, screensOnline: 3, contentBehind: 1 }), 'warn');
    expect(p.screensCurrent).toBe(2);
    expect(p.screensBehind).toBe(1);
    expect(p.statusLabel).toBe('Needs a look');
  });

  it('grades push off the location’s own stale count', () => {
    expect(buildLocationPanel(loc(), 'ok').push).toBe('live');
    expect(buildLocationPanel(loc({ pushStale: 1 }), 'warn').push).toBe('slow');
  });

  it('a location with nothing online cannot grade push at all', () => {
    expect(buildLocationPanel(loc({ screensOnline: 0, screensOffline: 3 }), 'bad').push).toBe('unknown');
  });

  it('takes its status word from the tone the RING was drawn with', () => {
    expect(buildLocationPanel(loc(), 'bad').statusLabel).toBe('Needs attention');
    expect(buildLocationPanel(loc(), 'ok').statusLabel).toBe('Healthy');
  });
});

describe('parseCityState — best-effort, silent when unsure', () => {
  it('reads the city + state off a US address', () => {
    expect(parseCityState('1200 K St, Sacramento, CA 95814')).toBe('Sacramento, CA');
    expect(parseCityState('55 Main St, Henderson, NV')).toBe('Henderson, NV');
  });

  it('ignores a trailing country segment', () => {
    expect(parseCityState('1 Peak Way, Walnut Creek, CA 94596, USA')).toBe('Walnut Creek, CA');
  });

  it('returns null rather than guessing', () => {
    expect(parseCityState(null)).toBeNull();
    expect(parseCityState('')).toBeNull();
    expect(parseCityState('1200 K St')).toBeNull();
    expect(parseCityState('Sacramento')).toBeNull();
    // No state token — a street line is not a city.
    expect(parseCityState('1200 K St, Sacramento')).toBeNull();
    // International shapes we cannot parse stay silent.
    expect(parseCityState('221B Baker Street, London NW1 6XE, United Kingdom')).toBeNull();
  });
});
