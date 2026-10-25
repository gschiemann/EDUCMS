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
  isTimeLimited,
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
// THE RULE, in Greg's words (2026-09-16):
//
//   "you cant have a screen active in two playlist at the same time unless its
//    scheduled...example, i could have a playlist for breakfast, another for
//    lunch, and another for dinner with different schedules but they cant be on
//    at the same time"
//
// Sharing a screen is NOT the conflict. Sharing a screen AT THE SAME TIME is.
// The first cut of this helper ignored windows entirely, which would have
// warned on breakfast-vs-lunch — the same false-positive class as the May
// "take 1", reached from the other direction. These are the cases that prove
// the difference; without them the window check could be deleted and every
// other test here would still pass.
// ─────────────────────────────────────────────────────────────────────
describe('windows — the breakfast/lunch/dinner rule', () => {
  const win = (daysOfWeek: string | null, timeStart: string | null, timeEnd: string | null) =>
    ({ daysOfWeek, timeStart, timeEnd });

  /** Other playlist p2 holds screen s3 in the given window. */
  const otherAt = (daysOfWeek: string | null, timeStart: string | null, timeEnd: string | null) =>
    [sched({ id: 'other', playlistId: 'p2', screenId: 's3', ...win(daysOfWeek, timeStart, timeEnd) })];

  const findW = (windows: Array<Record<string, unknown>>, schedules: OpsScheduleRef[]) =>
    findScreenConflicts({
      targetScreenIds: ['s3'],
      windows: windows as never,
      excludePlaylistId: 'p1',
      playlists: PLAYLISTS,
      schedules,
      screens: SCREENS,
      groups: GROUPS,
    });

  it('breakfast beside lunch on one screen is ALLOWED — no warning', () => {
    // 06:00-10:00 vs 11:00-14:00, same days, same screen. This is the setup
    // Greg described as correct, and warning about it would make the feature
    // an obstacle instead of a guard.
    const out = findW([win('Mon,Tue,Wed,Thu,Fri', '06:00', '10:00')], otherAt('Mon,Tue,Wed,Thu,Fri', '11:00', '14:00'));
    expect(out).toEqual([]);
  });

  it('breakfast and dinner never meet either', () => {
    const out = findW([win(null, '06:00', '10:00')], otherAt(null, '17:00', '21:00'));
    expect(out).toEqual([]);
  });

  it('but an OVERLAP is a conflict — breakfast vs brunch', () => {
    // 06:00-10:00 vs 09:00-12:00 share 09:00-10:00.
    const out = findW([win(null, '06:00', '10:00')], otherAt(null, '09:00', '12:00'));
    expect(out).toHaveLength(1);
    expect(out[0].playlistName).toBe('Kings Portrait');
  });

  it('touching edges do not overlap — 08:00-12:00 then 12:00-17:00', () => {
    const out = findW([win(null, '08:00', '12:00')], otherAt(null, '12:00', '17:00'));
    expect(out).toEqual([]);
  });

  it('different DAYS never collide, even at identical hours', () => {
    const out = findW([win('Sat,Sun', '09:00', '17:00')], otherAt('Mon,Tue,Wed,Thu,Fri', '09:00', '17:00'));
    expect(out).toEqual([]);
  });

  it('two ALWAYS-ON playlists cannot share a screen', () => {
    // The case that matters most: no window on either side means all day,
    // every day. Treating a missing field as "no overlap" would let exactly
    // the bug Greg reported slip through.
    const out = findW([{}], otherAt(null, null, null));
    expect(out).toHaveLength(1);
  });

  it('ALWAYS collides with a windowed rule — it is on during that window too', () => {
    expect(findW([{}], otherAt(null, '06:00', '10:00'))).toHaveLength(1);
    expect(findW([win(null, '06:00', '10:00')], otherAt(null, null, null))).toHaveLength(1);
  });

  it('SEVERAL incoming windows — a clash on any one of them is a conflict', () => {
    // Turning a playlist on activates every rule it owns; its breakfast rule
    // may be clear while its dinner rule is not.
    const out = findW(
      [win(null, '06:00', '10:00'), win(null, '17:00', '21:00')],
      otherAt(null, '18:00', '20:00'),
    );
    expect(out).toHaveLength(1);
  });

  it('no windows supplied at all is treated as ALWAYS, never as "no overlap"', () => {
    // Fail-safe direction: a caller that forgets to pass windows must
    // over-warn, not go silent.
    const out = findScreenConflicts({
      targetScreenIds: ['s3'],
      excludePlaylistId: 'p1',
      playlists: PLAYLISTS,
      schedules: otherAt(null, '06:00', '10:00'),
      screens: SCREENS,
      groups: GROUPS,
    });
    expect(out).toHaveLength(1);
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

// ─────────────────────────────────────────────────────────────────────
// Launch QA U15 (2026-10-24) — a TIME-LIMITED publish onto a screen that runs
// an ALWAYS-ON playlist KEEPS that one for the other hours (the server's
// `keepAlwaysOnAsFallback`). The prompt must say exactly that.
describe('a time-limited publish keeps an always-on playlist (U15)', () => {
  const findLimited = (targets: string[], schedules: OpsScheduleRef[]) =>
    findScreenConflicts({
      targetScreenIds: targets,
      excludePlaylistId: 'p1',
      windows: [{ daysOfWeek: 'Mon,Tue,Wed,Thu,Fri', timeStart: '08:00', timeEnd: '15:00' }],
      limited: true,
      playlists: PLAYLISTS,
      schedules,
      screens: SCREENS,
      groups: GROUPS,
    });

  it('an always-on competitor is reported as KEPT (fallbackScheduleIds), not just replaced', () => {
    const out = findLimited(['s3'], [sched({ id: 'a', playlistId: 'p2', screenId: 's3' })]);
    expect(out).toHaveLength(1);
    expect(out[0].scheduleIds).toEqual(['a']);
    expect(out[0].fallbackScheduleIds).toEqual(['a']);
    expect(out[0].fallbackScreenNames).toEqual(['Cafeteria']);
  });

  it('without `limited` nothing is kept — the old prompt, exactly', () => {
    const out = find(['s3'], [sched({ id: 'a', playlistId: 'p2', screenId: 's3' })]);
    expect(out[0].fallbackScheduleIds).toEqual([]);
    expect(describeScreenConflicts(out, 'Fall Assembly')!.alternateLabel).toBeUndefined();
  });

  it('an overlapping WINDOWED competitor is still a plain replacement', () => {
    const out = findLimited(['s3'], [sched({ id: 'a', playlistId: 'p2', screenId: 's3', timeStart: '11:00', timeEnd: '13:00' })]);
    expect(out[0].fallbackScheduleIds).toEqual([]);
    const p = describeScreenConflicts(out, 'School hours', 'add-screens')!;
    expect(p.title).toBe('Replace on 1 screen?');
    expect(p.alternateLabel).toBeUndefined();
  });

  it('an append-mode always-on rule is not kept (the server stands it down)', () => {
    const out = findLimited(['s3'], [sched({ id: 'a', playlistId: 'p2', screenId: 's3', mode: 'append' })]);
    expect(out[0].fallbackScheduleIds).toEqual([]);
  });

  it('the fallback tier itself is never a conflict — the server never stands it down', () => {
    const out = findLimited(['s3'], [sched({ id: 'a', playlistId: 'p2', screenId: 's3', priority: -1 })]);
    expect(out).toEqual([]);
    // ...even for an always-on publish
    expect(find(['s3'], [sched({ id: 'a', playlistId: 'p2', screenId: 's3', priority: -1 })])).toEqual([]);
  });

  it('the prompt: "Keep both" (default) / "Replace everything", saying what happens outside the hours', () => {
    const out = findLimited(['s3'], [sched({ id: 'a', playlistId: 'p2', screenId: 's3' })]);
    const p = describeScreenConflicts(out, 'School hours', 'add-screens')!;
    expect(p.title).toBe('Keep “Kings Portrait” playing the rest of the time?');
    expect(p.message).toContain('“School hours” plays only at its scheduled times.');
    expect(p.message).toContain('The rest of the time, “Kings Portrait” keeps playing on Cafeteria, so that screen is never blank.');
    expect(p.message).toContain('Replace everything stops “Kings Portrait” on Cafeteria instead.');
    expect(p.message).toContain('that screen would then have nothing to play');
    expect(p.confirmLabel).toBe('Keep both');
    expect(p.alternateLabel).toBe('Replace everything');
    expect(p.screenCount).toBe(1);
  });

  it('several kept playlists are listed; a windowed one beside them is named as replaced', () => {
    const out = findLimited(['s3', 's4'], [
      sched({ id: 'a', playlistId: 'p2', screenId: 's3' }),
      sched({ id: 'b', playlistId: 'p3', screenId: 's4' }),
    ]);
    const p = describeScreenConflicts(out, 'School hours', 'add-screens')!;
    expect(p.title).toBe('Keep the other playlists playing the rest of the time?');
    expect(p.message).toContain('• “Kings Portrait” on Cafeteria');
    expect(p.message).toContain('• “New URL” on The Den');
    expect(p.confirmLabel).toBe('Keep them all');

    const mixed = findLimited(['s3', 's4'], [
      sched({ id: 'a', playlistId: 'p2', screenId: 's3' }),
      sched({ id: 'b', playlistId: 'p3', screenId: 's4', timeStart: '09:00', timeEnd: '10:00' }),
    ]);
    const m = describeScreenConflicts(mixed, 'School hours', 'add-screens')!;
    expect(m.title).toBe('Keep “Kings Portrait” playing the rest of the time?');
    expect(m.message).toContain('“New URL” on The Den overlaps those times and will be replaced there.');
  });

  it('reads its words through the translator it is handed (en/es/zh catalogs)', () => {
    const out = findLimited(['s3'], [sched({ id: 'a', playlistId: 'p2', screenId: 's3' })]);
    const seen: string[] = [];
    const t = (key: string) => { seen.push(key); return `[${key}]`; };
    const p = describeScreenConflicts(out, 'School hours', 'add-screens', { t })!;
    expect(p.title).toBe('[keepTitleOne]');
    expect(p.confirmLabel).toBe('[confirmKeepOne]');
    expect(p.alternateLabel).toBe('[replaceEverything]');
    expect(seen).toEqual(expect.arrayContaining(['keepOneScreen', 'hintOneScreen']));
  });
});

describe('isTimeLimited — the web port of the server rule (U15)', () => {
  const NOW = Date.parse('2026-10-24T12:00:00Z');
  it('mirrors apps/api schedule-window-overlap.ts case for case', () => {
    expect(isTimeLimited({ daysOfWeek: 'Mon,Tue,Wed,Thu,Fri', timeStart: '08:00', timeEnd: '15:00' }, NOW)).toBe(true);
    expect(isTimeLimited({ endTime: '2026-12-31T23:59:59Z' }, NOW)).toBe(true);
    expect(isTimeLimited({ startTime: new Date(NOW + 120_000).toISOString() }, NOW)).toBe(true);
    expect(isTimeLimited({ startTime: new Date(NOW + 30_000).toISOString() }, NOW)).toBe(false);
    expect(isTimeLimited({ startTime: '2026-01-01T00:00:00Z', endTime: null }, NOW)).toBe(false);
    expect(isTimeLimited({}, NOW)).toBe(false);
    expect(isTimeLimited({ startTime: 'not a date' }, NOW)).toBe(false);
  });
});
