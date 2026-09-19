/**
 * One screen in a playlist: on, off, or out — including screens that are only
 * there through a GROUP rule.
 *
 * Greg, 2026-09-19: "we add the group when creating the playlist so that its
 * easy to add them all at once but after its created its up to the user if the
 * want to disable a screen from a playlist".
 *
 * These drive the REAL controller over an in-memory schedules table whose
 * `where` has real filter semantics. That is deliberate: this repo has already
 * shipped a displacement bug behind fakes that "can't express the predicate".
 *
 * THE CENTREPIECE is `glass()`: for every screen and a spread of instants, which
 * playlist the player would actually show — computed with the manifest's own
 * `orderSchedulesForManifest` and the real `windowsCollide`. The invariant is
 * that pressing a button on ONE screen leaves every OTHER screen's glass
 * byte-identical. Asserting rows would have let the shadowing bug through;
 * asserting the glass cannot.
 */
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { PlaylistsController } from './playlists.controller';
import { orderSchedulesForManifest } from '../screens/effective-schedule';
import { windowsCollide } from '../schedules/schedule-window-overlap';

const T = 't1';
const req = { user: { id: 'u1', tenantId: T } };

type Row = Record<string, any>;

/** Prisma-shaped filter: equality, {not}, {in}, {contains}, and OR. */
function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('not' in v) return row[k] !== v.not;
      if ('in' in v) return (v.in as any[]).includes(row[k]);
      if ('contains' in v) return String(row[k] ?? '').includes(v.contains);
    }
    return (row[k] ?? null) === (v ?? null);
  });
}

let seq = 0;
const rule = (over: Row): Row => ({
  id: `r${++seq}`,
  tenantId: T,
  playlistId: 'P',
  screenId: null,
  screenGroupId: null,
  startTime: new Date('2026-09-01T00:00:00Z'),
  endTime: null,
  daysOfWeek: null,
  timeStart: null,
  timeEnd: null,
  priority: 0,
  mode: 'replace',
  mutedOverride: null,
  isActive: true,
  ...over,
});

function makeHarness(opts: {
  schedules: Row[];
  submissions?: Row[];
  playlistOver?: Row;
}) {
  const screens: Row[] = [
    ...['A', 'B', 'C', 'D'].map((id) => ({
      id,
      tenantId: T,
      name: `Screen ${id}`,
      screenGroupId: 'G1',
    })),
    { id: 'E', tenantId: T, name: 'Screen E', screenGroupId: null },
    { id: 'X', tenantId: 'other-tenant', name: 'Foreign', screenGroupId: null },
  ];
  const table: Row[] = opts.schedules.map((s) => ({ ...s }));
  const audit: Row[] = [];
  const playlist = {
    id: 'P',
    tenantId: T,
    name: 'Frog 1920',
    isProtected: false,
    protectedKind: null,
    ...opts.playlistOver,
  };

  const client: any = {
    playlist: {
      findFirst: jest.fn(async ({ where }: any) =>
        matches(playlist, where) ? playlist : null,
      ),
    },
    screen: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          screens.find((s) => matches(s, where)) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        screens.filter((s) => matches(s, where)),
      ),
    },
    submission: {
      findFirst: jest.fn(
        async ({ where }: any) =>
          (opts.submissions ?? []).find((s) => matches(s, where)) ?? null,
      ),
    },
    schedule: {
      findMany: jest.fn(async ({ where }: any) =>
        table.filter((r) => matches(r, where)).map((r) => ({ ...r })),
      ),
      findFirst: jest.fn(async ({ where, orderBy }: any) => {
        const hits = table.filter((r) => matches(r, where));
        if (orderBy) {
          hits.sort(
            (a, b) =>
              b.priority - a.priority ||
              +new Date(b.startTime) - +new Date(a.startTime),
          );
        }
        return hits[0] ? { ...hits[0] } : null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const r = table.find((x) => matches(x, where));
        if (!r) throw new Error('update: row not found');
        Object.assign(r, data);
        return { ...r };
      }),
      delete: jest.fn(async ({ where }: any) => {
        const i = table.findIndex((x) => matches(x, where));
        if (i < 0) throw new Error('delete: row not found');
        return table.splice(i, 1)[0];
      }),
      deleteMany: jest.fn(async ({ where }: any) => {
        const before = table.length;
        for (let i = table.length - 1; i >= 0; i--)
          if (matches(table[i], where)) table.splice(i, 1);
        return { count: before - table.length };
      }),
      createMany: jest.fn(async ({ data }: any) => {
        for (const d of data)
          table.push({ id: `new${++seq}`, screenGroupId: null, ...d });
        return { count: data.length };
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        audit.push(data);
        return data;
      }),
    },
  };
  client.$transaction = jest.fn(async (fn: any) => fn(client));

  const prisma = {
    client,
    ensurePlaylistMetadataColumns: jest.fn(async () => undefined),
  } as any;
  const controller = new PlaylistsController(
    prisma,
    {} as any,
    {} as any,
    {} as any,
  );
  const notifySync = jest.fn();
  (controller as any).notifySync = notifySync;
  return { controller, table, audit, notifySync, screens };
}

/** Instants the player could be asked "what plays now?" — every day, five times. */
const PROBES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].flatMap((d) =>
  ['06:30', '09:00', '12:30', '18:30', '23:00'].map((t) => ({
    daysOfWeek: d,
    timeStart: t,
    timeEnd: t.replace(
      /:(\d\d)$/,
      (_, m) => `:${String(Number(m) + 1).padStart(2, '0')}`,
    ),
  })),
);

/** What each screen SHOWS, instant by instant — the manifest's own ranking. */
function glass(table: Row[], screens: Row[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of screens.filter((x) => x.tenantId === T)) {
    const covering = table.filter(
      (r) =>
        r.isActive &&
        r.mode !== 'append' &&
        (r.screenId === s.id ||
          (!r.screenId &&
            r.screenGroupId &&
            r.screenGroupId === s.screenGroupId)),
    );
    out[s.id] = PROBES.map((p) => {
      const open = covering.filter((r) => windowsCollide(r as any, p));
      return open.length
        ? orderSchedulesForManifest(open as any)[0].playlistId
        : '-';
    }).join('');
  }
  return out;
}

const others = (g: Record<string, string>, pressed: string) =>
  Object.fromEntries(Object.entries(g).filter(([k]) => k !== pressed));

const activeOn = (table: Row[], screenId: string, playlistId = 'P') =>
  table.filter(
    (r) => r.playlistId === playlistId && r.screenId === screenId && r.isActive,
  ).length;

beforeEach(() => {
  seq = 0;
});

describe('a screen that is only on the playlist THROUGH A GROUP', () => {
  it('switching ONE off splits the group rule — that screen goes off, the rest keep playing', async () => {
    const h = makeHarness({
      schedules: [rule({ id: 'g', screenGroupId: 'G1' })],
    });
    const before = glass(h.table, h.screens);

    const res = await h.controller.setScreenActive(req as any, 'P', 'B', {
      active: false,
    } as any);

    expect(res).toMatchObject({
      screenId: 'B',
      active: false,
      groupRulesSplit: 1,
    });
    expect(h.table.find((r) => r.id === 'g')).toBeUndefined(); // group rule gone
    expect(h.table.filter((r) => r.screenGroupId)).toHaveLength(0); // nothing group-targeted left
    expect(['A', 'C', 'D'].map((s) => activeOn(h.table, s))).toEqual([1, 1, 1]);
    expect(activeOn(h.table, 'B')).toBe(0);
    expect(h.table.filter((r) => r.screenId === 'B')).toHaveLength(1); // an OFF rule, not no rule
    // THE INVARIANT.
    expect(others(glass(h.table, h.screens), 'B')).toEqual(others(before, 'B'));
    expect(glass(h.table, h.screens).B).toBe('-'.repeat(PROBES.length));
  });

  it('REMOVING one leaves it no rule at all, and everyone else untouched', async () => {
    const h = makeHarness({
      schedules: [rule({ id: 'g', screenGroupId: 'G1' })],
    });
    const before = glass(h.table, h.screens);
    const res = await h.controller.removeScreen(req as any, 'P', 'C');
    expect(res).toMatchObject({ removed: true, groupRulesSplit: 1 });
    expect(h.table.filter((r) => r.screenId === 'C')).toHaveLength(0);
    expect(others(glass(h.table, h.screens), 'C')).toEqual(others(before, 'C'));
  });

  it('copies the WINDOW, priority, mode and mute onto every per-screen rule', async () => {
    const h = makeHarness({
      schedules: [
        rule({
          id: 'g',
          screenGroupId: 'G1',
          daysOfWeek: 'Mon,Tue',
          timeStart: '06:00',
          timeEnd: '10:00',
          priority: 3,
          mutedOverride: true,
        }),
      ],
    });
    await h.controller.setScreenActive(req as any, 'P', 'A', {
      active: false,
    } as any);
    for (const r of h.table) {
      expect(r).toMatchObject({
        daysOfWeek: 'Mon,Tue',
        timeStart: '06:00',
        timeEnd: '10:00',
        priority: 3,
        mode: 'replace',
        mutedOverride: true,
        tenantId: T,
      });
    }
  });

  it('switching one ON in a paused group publish turns on ONLY that screen', async () => {
    const h = makeHarness({
      schedules: [rule({ id: 'g', screenGroupId: 'G1', isActive: false })],
    });
    await h.controller.setScreenActive(req as any, 'P', 'D', {
      active: true,
    } as any);
    expect(['A', 'B', 'C', 'D'].map((s) => activeOn(h.table, s))).toEqual([
      0, 0, 0, 1,
    ]);
  });

  it('a breakfast group rule AND a dinner group rule are both split', async () => {
    const h = makeHarness({
      schedules: [
        rule({
          id: 'gb',
          screenGroupId: 'G1',
          timeStart: '06:00',
          timeEnd: '10:00',
        }),
        rule({
          id: 'gd',
          screenGroupId: 'G1',
          timeStart: '17:00',
          timeEnd: '21:00',
        }),
      ],
    });
    const before = glass(h.table, h.screens);
    const res = await h.controller.setScreenActive(req as any, 'P', 'A', {
      active: false,
    } as any);
    expect(res.groupRulesSplit).toBe(2);
    expect(activeOn(h.table, 'A')).toBe(0);
    expect(activeOn(h.table, 'B')).toBe(2);
    expect(others(glass(h.table, h.screens), 'A')).toEqual(others(before, 'A'));
  });
});

describe('THE INVARIANT — no other screen changes what it shows', () => {
  it("a member showing ANOTHER playlist's pin keeps showing it (its new rule lands OFF)", async () => {
    // C is overridden: Q was pinned to it AFTER the group publish. A pin outranks
    // a group rule, so C shows Q. Split naively and P's new pin — newer startTime
    // here — would take C over because someone pressed a button on screen A.
    const h = makeHarness({
      schedules: [
        rule({
          id: 'g',
          screenGroupId: 'G1',
          startTime: new Date('2026-09-10T00:00:00Z'),
        }),
        rule({
          id: 'q',
          playlistId: 'Q',
          screenId: 'C',
          startTime: new Date('2026-09-05T00:00:00Z'),
        }),
      ],
    });
    const before = glass(h.table, h.screens);
    expect(before.C).toBe('Q'.repeat(PROBES.length));

    await h.controller.setScreenActive(req as any, 'P', 'A', {
      active: false,
    } as any);

    expect(glass(h.table, h.screens).C).toBe(before.C);
    expect(activeOn(h.table, 'C')).toBe(0);
    expect(others(glass(h.table, h.screens), 'A')).toEqual(others(before, 'A'));
    const split = JSON.parse(
      h.audit.find((a) => a.action === 'PLAYLIST_SCREEN_TOGGLED')!.details,
    ).groupRulesSplit[0];
    expect(split.shadowedScreenIds).toEqual(['C']);
  });

  it('a pin in a DIFFERENT window shadows nothing — breakfast and dinner coexist', async () => {
    const h = makeHarness({
      schedules: [
        rule({
          id: 'g',
          screenGroupId: 'G1',
          timeStart: '06:00',
          timeEnd: '10:00',
        }),
        rule({
          id: 'q',
          playlistId: 'Q',
          screenId: 'C',
          timeStart: '17:00',
          timeEnd: '21:00',
        }),
      ],
    });
    const before = glass(h.table, h.screens);
    await h.controller.setScreenActive(req as any, 'P', 'A', {
      active: false,
    } as any);
    expect(activeOn(h.table, 'C')).toBe(1);
    expect(others(glass(h.table, h.screens), 'A')).toEqual(others(before, 'A'));
  });

  it('a member whose OWN rule is off but who is still playing via the group KEEPS playing', async () => {
    // Reachable today: screen B is on the playlist, gets switched off, then the
    // group is added. B's row says "off"; B's glass says P. Deleting the group
    // rule must not silently stop it.
    const h = makeHarness({
      schedules: [
        rule({ id: 'ownB', screenId: 'B', isActive: false }),
        rule({ id: 'g', screenGroupId: 'G1' }),
      ],
    });
    const before = glass(h.table, h.screens);
    expect(before.B).toBe('P'.repeat(PROBES.length));

    await h.controller.setScreenActive(req as any, 'P', 'A', {
      active: false,
    } as any);

    expect(others(glass(h.table, h.screens), 'A')).toEqual(others(before, 'A'));
    expect(h.table.filter((r) => r.screenId === 'B')).toHaveLength(1); // no duplicate
    expect(h.table.find((r) => r.id === 'ownB')!.isActive).toBe(true);
  });

  it('a member already playing through its own rule gets no second rule', async () => {
    const h = makeHarness({
      schedules: [
        rule({ id: 'ownB', screenId: 'B' }),
        rule({ id: 'g', screenGroupId: 'G1' }),
      ],
    });
    const before = glass(h.table, h.screens);
    await h.controller.setScreenActive(req as any, 'P', 'A', {
      active: false,
    } as any);
    expect(h.table.filter((r) => r.screenId === 'B')).toHaveLength(1);
    expect(others(glass(h.table, h.screens), 'A')).toEqual(others(before, 'A'));
  });

  it('holds across a mixed fleet: windows, pins, an ungrouped screen, a second group rule from Q', async () => {
    const build = () => [
      rule({
        id: 'gb',
        screenGroupId: 'G1',
        timeStart: '06:00',
        timeEnd: '10:00',
        startTime: new Date('2026-09-12T00:00:00Z'),
      }),
      rule({
        id: 'gd',
        screenGroupId: 'G1',
        timeStart: '17:00',
        timeEnd: '21:00',
      }),
      rule({ id: 'ownE', screenId: 'E' }),
      rule({
        id: 'qA',
        playlistId: 'Q',
        screenId: 'A',
        timeStart: '08:00',
        timeEnd: '09:30',
        startTime: new Date('2026-09-02T00:00:00Z'),
      }),
      rule({ id: 'qD', playlistId: 'Q', screenId: 'D', priority: 5 }),
      rule({
        id: 'qG',
        playlistId: 'Q',
        screenGroupId: 'G1',
        timeStart: '11:00',
        timeEnd: '14:00',
      }),
    ];
    for (const pressed of ['A', 'B', 'C', 'D']) {
      for (const action of ['off', 'remove'] as const) {
        seq = 100;
        const h = makeHarness({ schedules: build() });
        const before = glass(h.table, h.screens);
        if (action === 'off')
          await h.controller.setScreenActive(req as any, 'P', pressed, {
            active: false,
          } as any);
        else await h.controller.removeScreen(req as any, 'P', pressed);
        expect({
          pressed,
          action,
          glass: others(glass(h.table, h.screens), pressed),
        }).toEqual({ pressed, action, glass: others(before, pressed) });
        // And the pressed screen really did stop showing P.
        expect(glass(h.table, h.screens)[pressed]).not.toContain('P');
      }
    }
  });
});

describe('a screen with its OWN rules', () => {
  it('OFF switches off EVERY window — not just one of them', async () => {
    // The latent bug: the old button flipped a single Schedule id, so a
    // breakfast + dinner playlist read "off" while dinner kept playing.
    const h = makeHarness({
      schedules: [
        rule({ id: 'b', screenId: 'E', timeStart: '06:00', timeEnd: '10:00' }),
        rule({ id: 'd', screenId: 'E', timeStart: '17:00', timeEnd: '21:00' }),
      ],
    });
    await h.controller.setScreenActive(req as any, 'P', 'E', {
      active: false,
    } as any);
    expect(activeOn(h.table, 'E')).toBe(0);
    expect(h.table).toHaveLength(2);
  });

  it('"never go dark" does NOT switch this playlist\'s other window straight back on', async () => {
    const h = makeHarness({
      schedules: [
        rule({ id: 'b', screenId: 'E', timeStart: '06:00', timeEnd: '10:00' }),
        rule({ id: 'd', screenId: 'E', timeStart: '17:00', timeEnd: '21:00' }),
        rule({ id: 'old', playlistId: 'Q', screenId: 'E', isActive: false }),
      ],
    });
    await h.controller.setScreenActive(req as any, 'P', 'E', {
      active: false,
    } as any);
    expect(activeOn(h.table, 'E', 'P')).toBe(0);
    // …but the screen is not left dark: the OTHER playlist's parked rule returns.
    expect(h.table.find((r) => r.id === 'old')!.isActive).toBe(true);
    expect(h.audit.some((a) => a.action === 'SCHEDULE_AUTO_REACTIVATED')).toBe(
      true,
    );
  });

  it("a screen still covered by another playlist's GROUP rule is not dark — no stale pin is promoted", async () => {
    const h = makeHarness({
      schedules: [
        rule({ id: 'ownA', screenId: 'A' }),
        rule({ id: 'qG', playlistId: 'Q', screenGroupId: 'G1' }),
        rule({ id: 'stale', playlistId: 'Z', screenId: 'A', isActive: false }),
      ],
    });
    await h.controller.setScreenActive(req as any, 'P', 'A', {
      active: false,
    } as any);
    expect(h.table.find((r) => r.id === 'stale')!.isActive).toBe(false);
    expect(glass(h.table, h.screens).A).toBe('Q'.repeat(PROBES.length));
  });

  it('ON switches every window back on', async () => {
    const h = makeHarness({
      schedules: [
        rule({ id: 'b', screenId: 'E', isActive: false }),
        rule({
          id: 'd',
          screenId: 'E',
          isActive: false,
          timeStart: '17:00',
          timeEnd: '21:00',
        }),
      ],
    });
    await h.controller.setScreenActive(req as any, 'P', 'E', {
      active: true,
    } as any);
    expect(activeOn(h.table, 'E')).toBe(2);
  });
});

describe('refusals and the paper trail', () => {
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'NO THROW';
    } catch (e) {
      return ((e as HttpException).getResponse() as any).code;
    }
  };

  it('REFUSES to split a group rule an Editor has waiting for review — and writes nothing', async () => {
    // Approval activates rows by id and silently drops a missing one, so
    // splitting this rule would make the Editor's approved publish vanish.
    const h = makeHarness({
      schedules: [
        rule({ id: 'g-staged', screenGroupId: 'G1', isActive: false }),
      ],
      submissions: [
        {
          id: 'sub1',
          tenantId: T,
          status: 'PENDING',
          scheduleIds: 'zzz,g-staged',
        },
      ],
    });
    const snapshot = JSON.stringify(h.table);
    expect(
      await code(
        h.controller.setScreenActive(req as any, 'P', 'A', {
          active: true,
        } as any),
      ),
    ).toBe('SCHEDULE_PENDING_REVIEW');
    expect(JSON.stringify(h.table)).toBe(snapshot);
    expect(h.audit).toHaveLength(0);
  });

  it('a DECIDED review does not block', async () => {
    const h = makeHarness({
      schedules: [rule({ id: 'g', screenGroupId: 'G1' })],
      submissions: [
        { id: 'sub1', tenantId: T, status: 'APPROVED', scheduleIds: 'g' },
      ],
    });
    expect(
      await code(
        h.controller.setScreenActive(req as any, 'P', 'A', {
          active: false,
        } as any),
      ),
    ).toBe('NO THROW');
  });

  it('refuses a protected (panic) playlist, a foreign screen, and a screen that is not on the playlist', async () => {
    const prot = makeHarness({
      schedules: [rule({ screenId: 'E' })],
      playlistOver: { isProtected: true, protectedKind: 'lockdown' },
    });
    expect(
      await code(
        prot.controller.setScreenActive(req as any, 'P', 'E', {
          active: false,
        } as any),
      ),
    ).toBe('PLAYLIST_PROTECTED');
    const h = makeHarness({ schedules: [rule({ screenId: 'A' })] });
    expect(
      await code(
        h.controller.setScreenActive(req as any, 'P', 'X', {
          active: false,
        } as any),
      ),
    ).toBe('SCREEN_NOT_FOUND');
    expect(await code(h.controller.removeScreen(req as any, 'P', 'E'))).toBe(
      'SCREEN_NOT_IN_PLAYLIST',
    );
    expect(await code(h.controller.removeScreen(req as any, 'NOPE', 'A'))).toBe(
      'PLAYLIST_NOT_FOUND',
    );
  });

  it('writes ONE audit row that says what was split, and nudges the fleet', async () => {
    const h = makeHarness({
      schedules: [rule({ id: 'g', screenGroupId: 'G1' })],
    });
    await h.controller.removeScreen(req as any, 'P', 'B');
    const rows = h.audit.filter((a) => a.action === 'PLAYLIST_SCREEN_REMOVED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: T,
      userId: 'u1',
      targetType: 'Playlist',
      targetId: 'P',
    });
    expect(JSON.parse(rows[0].details)).toMatchObject({
      name: 'Frog 1920',
      screenId: 'B',
      screenName: 'Screen B',
      groupRulesSplit: [
        { groupRuleId: 'g', screenGroupId: 'G1', rulesCreated: 3 },
      ],
    });
    expect(h.notifySync).toHaveBeenCalledWith(T);
  });
});
