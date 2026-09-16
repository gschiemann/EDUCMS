/**
 * One screen, two playlists — the conflict rule, tested at the level it lives.
 *
 * This logic already shipped once, in the classic page's playlist toggle, and
 * it took THREE takes because both failure directions are easy and neither is
 * visible without a case for it:
 *
 *   take 1 — false POSITIVES: warned about playlists that shared no screen.
 *   take 2 — false NEGATIVES + over-replacement: "it turned off the new url
 *            playlist as well for a screen that isnt included".
 *
 * So the cases below are mostly refusals. A rule that warns about everything is
 * as useless as one that warns about nothing, and the operator has already paid
 * for both mistakes once.
 *
 * The server half is apps/api/src/schedules/schedule-displacement.ts, which
 * resolves the same target set: a per-screen rule covers that screenId, a group
 * rule covers that group AND the per-screen pins on its members. These tests
 * pin the client to that same shape so the warning cannot promise a
 * displacement the server will not perform, or stay silent about one it will.
 */

import {
  conflictScreenCount,
  describeScreenConflicts,
  findScreenConflicts,
  type OpsGroupRef,
  type OpsPlaylistRef,
  type OpsScheduleRef,
  type OpsScreenRef,
} from '../playlistOps';

const SCREENS: OpsScreenRef[] = [
  { id: 's1', name: 'Lobby North', screenGroupId: 'g1' },
  { id: 's2', name: 'Lobby South', screenGroupId: 'g1' },
  { id: 's3', name: 'Cafeteria', screenGroupId: null },
  { id: 's4', name: 'The Den', screenGroupId: null },
];

const GROUPS: OpsGroupRef[] = [
  { id: 'g1', name: 'Lobby Wall', screens: [{ id: 's1' }, { id: 's2' }] },
];

const PLAYLISTS: OpsPlaylistRef[] = [
  { id: 'p1', name: 'Fall Assembly' },
  { id: 'p2', name: 'Kings Portrait' },
  { id: 'p3', name: 'New URL' },
];

const sched = (over: Partial<OpsScheduleRef> & { id: string; playlistId: string }): OpsScheduleRef => ({
  isActive: true,
  screenId: null,
  screenGroupId: null,
  ...over,
});

const find = (targets: string[], schedules: OpsScheduleRef[], excludePlaylistId = 'p1') =>
  findScreenConflicts({
    targetScreenIds: targets,
    excludePlaylistId,
    playlists: PLAYLISTS,
    schedules,
    screens: SCREENS,
    groups: GROUPS,
  });

// ─────────────────────────────────────────────────────────────────────
describe('findScreenConflicts — the refusals', () => {
  it('a playlist never conflicts with itself', () => {
    const out = find(['s3'], [sched({ id: 'a', playlistId: 'p1', screenId: 's3' })]);
    expect(out).toEqual([]);
  });

  it('no overlap → no warning (take-1 false positive)', () => {
    // p2 is playing, but on a screen we are not touching.
    const out = find(['s3'], [sched({ id: 'a', playlistId: 'p2', screenId: 's4' })]);
    expect(out).toEqual([]);
  });

  it('a PAUSED rule is a plan, not an occupant — never warns', () => {
    const out = find(['s3'], [sched({ id: 'a', playlistId: 'p2', screenId: 's3', isActive: false })]);
    expect(out).toEqual([]);
  });

  it('an empty target set warns about nothing', () => {
    const out = find([], [sched({ id: 'a', playlistId: 'p2', screenId: 's3' })]);
    expect(out).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('findScreenConflicts — the catches', () => {
  it('a per-screen rule on a screen we want is a conflict, named', () => {
    const out = find(['s3'], [sched({ id: 'a', playlistId: 'p2', screenId: 's3' })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      playlistId: 'p2',
      playlistName: 'Kings Portrait',
      scheduleIds: ['a'],
      screenNames: ['Cafeteria'],
    });
  });

  it('a GROUP rule expands to its members — the server displaces member pins too', () => {
    // p2 holds the whole Lobby Wall; we want just one of its screens.
    const out = find(['s1'], [sched({ id: 'a', playlistId: 'p2', screenGroupId: 'g1' })]);
    expect(out).toHaveLength(1);
    expect(out[0].scheduleIds).toEqual(['a']);
    expect(out[0].screenNames).toEqual(['Lobby North']);
  });

  it('only the OVERLAPPING rules of a playlist are listed (the take-2 regression)', () => {
    // p2 plays on s3 AND s4. We are taking only s3. Its s4 rule must be
    // untouched — that is the exact bug Greg reported: "it turned off the new
    // url playlist as well for a screen that isnt included".
    const out = find(['s3'], [
      sched({ id: 'keep', playlistId: 'p2', screenId: 's4' }),
      sched({ id: 'hit', playlistId: 'p2', screenId: 's3' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].scheduleIds).toEqual(['hit']);
    expect(out[0].screenNames).toEqual(['Cafeteria']);
  });

  it('two different playlists overlapping are reported separately', () => {
    const out = find(['s3', 's4'], [
      sched({ id: 'a', playlistId: 'p2', screenId: 's3' }),
      sched({ id: 'b', playlistId: 'p3', screenId: 's4' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.playlistName).sort()).toEqual(['Kings Portrait', 'New URL']);
  });

  it('one screen reached twice is counted once', () => {
    const out = find(['s1', 's2'], [
      sched({ id: 'grp', playlistId: 'p2', screenGroupId: 'g1' }),
      sched({ id: 'pin', playlistId: 'p2', screenId: 's1' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].scheduleIds.sort()).toEqual(['grp', 'pin']);
    expect(conflictScreenCount(out)).toBe(2);
  });

  it('falls back to the embedded screen when the live list has not loaded', () => {
    const out = findScreenConflicts({
      targetScreenIds: ['s9'],
      excludePlaylistId: 'p1',
      playlists: PLAYLISTS,
      schedules: [
        sched({ id: 'a', playlistId: 'p2', screenId: 's9', screen: { id: 's9', name: 'Gym Ribbon' } }),
      ],
      screens: [],
      groups: [],
    });
    expect(out).toHaveLength(1);
    expect(out[0].screenNames).toEqual(['Gym Ribbon']);
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('describeScreenConflicts — what the operator reads', () => {
  it('no conflicts → no prompt at all', () => {
    expect(describeScreenConflicts([], 'Fall Assembly')).toBeNull();
  });

  it('one playlist, one screen — says which, and that the rest stay put', () => {
    const out = find(['s3'], [sched({ id: 'a', playlistId: 'p2', screenId: 's3' })]);
    const p = describeScreenConflicts(out, 'Fall Assembly')!;
    expect(p.title).toBe('Replace on 1 screen?');
    expect(p.message).toContain('“Kings Portrait” is currently playing on Cafeteria');
    expect(p.message).toContain('that screen');
    expect(p.message).toContain('its other screens stay untouched');
    expect(p.confirmLabel).toBe('Replace');
    expect(p.screenCount).toBe(1);
  });

  it('pluralises the title on the real screen count', () => {
    const out = find(['s1', 's2'], [sched({ id: 'a', playlistId: 'p2', screenGroupId: 'g1' })]);
    expect(describeScreenConflicts(out, 'Fall Assembly')!.title).toBe('Replace on 2 screens?');
  });

  it('several playlists are listed by name and screen', () => {
    const out = find(['s3', 's4'], [
      sched({ id: 'a', playlistId: 'p2', screenId: 's3' }),
      sched({ id: 'b', playlistId: 'p3', screenId: 's4' }),
    ]);
    const p = describeScreenConflicts(out, 'Fall Assembly')!;
    expect(p.message).toContain('• “Kings Portrait” on Cafeteria');
    expect(p.message).toContain('• “New URL” on The Den');
    expect(p.title).toBe('Replace on 2 screens?');
  });

  it('the add-screens entry point reads as adding, not as switching on', () => {
    const out = find(['s3'], [sched({ id: 'a', playlistId: 'p2', screenId: 's3' })]);
    const p = describeScreenConflicts(out, 'Fall Assembly', 'add-screens')!;
    expect(p.message).toContain('Adding that screen to “Fall Assembly”');
    expect(p.message).not.toContain('Switching');
  });

  // §4.3 — this copy reaches an operator, so it is swept like every other
  // string in this module. "playing" is a claim about a SCHEDULE being active,
  // which the platform does store; the banned words are claims it cannot prove.
  it('the copy carries no prohibited vocabulary', () => {
    const out = find(['s1', 's2', 's3'], [
      sched({ id: 'a', playlistId: 'p2', screenGroupId: 'g1' }),
      sched({ id: 'b', playlistId: 'p3', screenId: 's3' }),
    ]);
    const strings = [
      describeScreenConflicts(out, 'Fall Assembly')!,
      describeScreenConflicts(out, 'Fall Assembly', 'add-screens')!,
    ].flatMap((p) => [p.title, p.message, p.confirmLabel]);

    for (const s of strings) {
      expect(s).not.toMatch(/\bLIVE\b/i);
      expect(s).not.toMatch(/\bconfirmed\b/i);
      expect(s).not.toMatch(/\bdelivered\b/i);
      expect(s).not.toMatch(/\bready\b/i);
      expect(s).not.toMatch(/manifest|painting|render/i);
    }
  });
});
