import {
  computeBlastRadius,
  blastRadiusLine,
  reachWarnings,
  isReachBlocked,
} from '../blast-radius';

// A small fleet the three publish surfaces could plausibly hand us.
const SCREENS = [
  { id: 's1', name: 'Lobby North' },
  { id: 's2', name: 'Lobby South' },
  { id: 's3', name: 'Cafeteria' },
  { id: 's4', name: 'Gym Ribbon' },
  { id: 's5', name: '' }, // unnamed on purpose
];

const GROUPS = [
  {
    id: 'g1',
    name: 'Lobby',
    screens: [{ id: 's1', name: 'Lobby North' }, { id: 's2', name: 'Lobby South' }, { id: 's3', name: 'Cafeteria' }],
  },
  { id: 'g2', name: 'Gym', screens: [{ id: 's4', name: 'Gym Ribbon' }] },
  { id: 'g3', name: 'Annex (new build)', screens: [] },
];

describe('computeBlastRadius', () => {
  it('resolves a picked group of 3 into 3 screens across 1 group', () => {
    const r = computeBlastRadius({
      screens: SCREENS,
      groups: GROUPS,
      // The wizard selects the members AND records the group itself.
      selectedScreenIds: ['s1', 's2', 's3'],
      selectedGroupIds: ['g1'],
    });
    expect(r.screenCount).toBe(3);
    expect(r.groupCount).toBe(1);
    expect(r.groups[0]).toMatchObject({ id: 'g1', name: 'Lobby', screenCount: 3, picked: true, empty: false });
    expect(r.screenNames).toEqual(['Lobby North', 'Lobby South', 'Cafeteria']);
    // Group members are never ALSO counted as loose screens.
    expect(r.ungroupedScreenNames).toEqual([]);
    expect(blastRadiusLine(r)).toBe('Publishes to 3 screens across 1 group');
  });

  it('never double-counts a screen picked both directly and via its group', () => {
    const r = computeBlastRadius({
      screens: SCREENS,
      groups: GROUPS,
      selectedScreenIds: ['s1', 's2', 's3', 's4'],
      selectedGroupIds: ['g1'],
    });
    expect(r.screenCount).toBe(4);
    expect(r.groupCount).toBe(1);
    // s4 isn't covered by the picked group, so it stays loose.
    expect(r.ungroupedScreenNames).toEqual(['Gym Ribbon']);
    // The breakdown always adds up to the headline.
    const summed = r.groups.reduce((a, g) => a + g.screenCount, 0) + r.ungroupedScreenNames.length;
    expect(summed).toBe(r.screenCount);
  });

  it('flags a picked group that holds no screens', () => {
    const r = computeBlastRadius({
      screens: SCREENS,
      groups: GROUPS,
      selectedGroupIds: ['g3'],
    });
    expect(r.screenCount).toBe(0);
    expect(r.groupCount).toBe(1);
    expect(r.emptyGroupNames).toEqual(['Annex (new build)']);
    expect(blastRadiusLine(r)).toBe('Publishes to 0 screens across 1 group');
    const w = reachWarnings(r);
    expect(w.map((x) => x.kind)).toEqual(['empty-groups', 'no-screens']);
    expect(isReachBlocked(w)).toBe(false);
  });

  it('handles hand-picked screens with no group at all', () => {
    const r = computeBlastRadius({ screens: SCREENS, groups: GROUPS, selectedScreenIds: ['s5'] });
    expect(r.screenCount).toBe(1);
    expect(r.groupCount).toBe(0);
    expect(r.screenNames).toEqual(['Untitled screen']);
    expect(blastRadiusLine(r)).toBe('Publishes to 1 screen');
  });

  it('counts an unknown selected id (it is still going to be published)', () => {
    const r = computeBlastRadius({ screens: SCREENS, groups: GROUPS, selectedScreenIds: ['ghost'] });
    expect(r.screenCount).toBe(1);
    expect(r.screenNames).toEqual(['ghost']);
  });

  it('groupMode "containing" derives locations from picked screens (HQ fleet)', () => {
    const stores = [
      { id: 'loc1', name: 'Store 1', screens: [{ id: 's1', name: 'Lobby North' }, { id: 's2', name: 'Lobby South' }] },
      { id: 'loc2', name: 'Store 2', screens: [{ id: 's3', name: 'Cafeteria' }] },
      { id: 'loc3', name: 'Store 3', screens: [{ id: 's4', name: 'Gym Ribbon' }] },
    ];
    const r = computeBlastRadius({
      screens: SCREENS,
      groups: stores,
      selectedScreenIds: ['s1', 's3'],
      groupMode: 'containing',
    });
    expect(r.screenCount).toBe(2);
    // Only the two locations that actually hold a picked screen.
    expect(r.groupCount).toBe(2);
    expect(r.groups.map((g) => g.name)).toEqual(['Store 1', 'Store 2']);
    expect(r.groups[0].screenCount).toBe(1);
    expect(blastRadiusLine(r, { groupNoun: 'location' })).toBe('Publishes to 2 screens across 2 locations');
  });

  it('is empty-safe', () => {
    const r = computeBlastRadius({});
    expect(r).toMatchObject({ screenCount: 0, groupCount: 0, screenNames: [], groups: [] });
    expect(blastRadiusLine(r)).toBe('Publishes to 0 screens');
  });
});

describe('reachWarnings — P7, the zero-day schedule', () => {
  const reach = computeBlastRadius({
    screens: SCREENS,
    groups: GROUPS,
    selectedScreenIds: ['s1', 's2', 's3'],
    selectedGroupIds: ['g1'],
  });

  it('BLOCKS a windowed schedule with no days picked', () => {
    const w = reachWarnings(reach, { windowed: true, days: [], alwaysLabel: '“Activate immediately”' });
    expect(w).toHaveLength(1);
    expect(w[0].kind).toBe('no-days');
    expect(w[0].blocking).toBe(true);
    expect(w[0].message).toContain('no days selected');
    expect(w[0].message).toContain('“Activate immediately”');
    expect(isReachBlocked(w)).toBe(true);
  });

  it('stays silent for a windowed schedule that has days', () => {
    const w = reachWarnings(reach, { windowed: true, days: ['Mon'] });
    expect(w).toEqual([]);
  });

  it('never blocks an always-on publish, days or not', () => {
    expect(reachWarnings(reach, { windowed: false, days: [] })).toEqual([]);
    expect(isReachBlocked(reachWarnings(reach))).toBe(false);
  });

  it('reports every problem at once, blocking one first', () => {
    const zero = computeBlastRadius({ screens: SCREENS, groups: GROUPS, selectedGroupIds: ['g3'] });
    const w = reachWarnings(zero, { windowed: true, days: [] });
    expect(w.map((x) => x.kind)).toEqual(['no-days', 'empty-groups', 'no-screens']);
    expect(isReachBlocked(w)).toBe(true);
  });
});
