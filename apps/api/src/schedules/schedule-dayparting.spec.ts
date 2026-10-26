/**
 * DAYPARTING — breakfast, lunch and dinner must survive on ONE screen.
 *
 * Greg stated the rule during a live test (2026-09-16):
 *
 *   "you cant have a screen active in two playlist at the same time unless its
 *    scheduled...example, i could have a playlist for breakfast, another for
 *    lunch, and another for dinner with different schedules but they cant be on
 *    at the same time"
 *
 * THE BUG THIS PINS. `displaceCompetingActiveSchedules` and the (playlist,
 * target) upsert-cleanup were TIME-BLIND: every competing active row on the
 * target was stood down regardless of hours. So publishing breakfast, then
 * lunch, then dinner produced three clean publishes, ZERO warnings — the client
 * guard shipped in a2f19eee correctly stays silent because the windows do not
 * overlap — and ONE surviving rule. The UI promised "these do not collide" and
 * the server broke that promise seconds later. Silent wrong is worse than
 * over-warning, which is why this file exists.
 *
 * AND THE FALLBACK TIER, which is what makes dayparting usable at 3pm. Greg:
 * "It's almost like every playlist needs and always active schedule and if
 * nothing assigned it goes to our splash screen". An always-on rule at a
 * NEGATIVE priority is the base playlist: `orderSchedulesForManifest` sorts
 * priority desc so it rides last, and the player picks the first WINDOW-OPEN
 * replace row — so a daypart wins while its window is open and the fallback
 * fills every gap. It is exempt from displacement in BOTH directions: a daypart
 * publish must never remove the safety net, and publishing the net must never
 * remove the content it backs up.
 */

import 'reflect-metadata';
import { AppRole } from '@cms/database';
import { SchedulesController } from './schedules.controller';
import { FALLBACK_PRIORITY } from './schedule-window-overlap';

type Row = {
  id: string;
  tenantId: string;
  playlistId: string;
  screenId: string | null;
  screenGroupId: string | null;
  isActive: boolean;
  priority: number;
  startTime: Date;
  daysOfWeek: string | null;
  timeStart: string | null;
  timeEnd: string | null;
  mode?: string;
};

function rowMatches(r: Row, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (k === 'OR') {
      if (!(v as any[]).some((c) => rowMatches(r, c))) return false;
      continue;
    }
    const rv = (r as any)[k];
    if (v && typeof v === 'object' && 'in' in (v as any)) {
      if (!(v as any).in.includes(rv)) return false;
      continue;
    }
    if (v && typeof v === 'object' && 'not' in (v as any)) {
      if (rv === (v as any).not) return false;
      continue;
    }
    if (v === null) {
      if (rv !== null && rv !== undefined) return false;
      continue;
    }
    if (rv !== v) return false;
  }
  return true;
}

let idSeq = 0;

function makeController(rows: Row[]) {
  const scheduleClient = {
    findMany: jest.fn(async ({ where, select }: any) => {
      const matched = rows.filter((r) => rowMatches(r, where));
      if (!select) return matched.map((r) => ({ ...r }));
      return matched.map((r) => {
        const out: any = {};
        for (const k of Object.keys(select)) if (select[k]) out[k] = (r as any)[k];
        return out;
      });
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const r of rows) if (rowMatches(r, where)) { Object.assign(r, data); count++; }
      return { count };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rowMatches(rows[i], where)) { rows.splice(i, 1); count++; }
      }
      return { count };
    }),
    create: jest.fn(async ({ data }: any) => {
      const r: Row = {
        id: 'new-' + ++idSeq,
        tenantId: data.tenantId,
        playlistId: data.playlistId,
        screenId: data.screenId ?? null,
        screenGroupId: data.screenGroupId ?? null,
        isActive: data.isActive,
        priority: data.priority ?? 0,
        startTime: data.startTime,
        daysOfWeek: data.daysOfWeek ?? null,
        timeStart: data.timeStart ?? null,
        timeEnd: data.timeEnd ?? null,
        mode: data.mode ?? 'replace',
      };
      rows.push(r);
      return { ...r, playlist: { id: r.playlistId, name: 'pl' }, screenGroup: null, screen: null };
    }),
  };

  const prisma: any = {
    client: {
      schedule: scheduleClient,
      screen: {
        findFirst: jest.fn().mockResolvedValue({ id: 'scr1' }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      screenGroup: { findFirst: jest.fn().mockResolvedValue({ id: 'grp' }) },
      playlist: { findFirst: jest.fn().mockResolvedValue({ id: 'pl' }) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ requireContentApproval: false }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
      submission: { create: jest.fn().mockResolvedValue({ id: 'sub1' }) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    },
  };

  const controller = new SchedulesController(
    prisma,
    { publish: jest.fn().mockResolvedValue(undefined) } as any,
    { signMessage: jest.fn().mockReturnValue('signed') } as any,
    { notify: jest.fn().mockResolvedValue({}) } as any,
  );
  return { controller, rows, scheduleClient };
}

const adminReq = { user: { id: 'a1', userId: 'a1', role: AppRole.SCHOOL_ADMIN, tenantId: 't1' } };
const SCREEN = 'scr1';

const publish = (controller: any, over: Record<string, unknown>) =>
  controller.create(adminReq as any, {
    playlistId: 'pl-x',
    screenId: SCREEN,
    startTime: new Date('2026-09-16T00:00:00Z').toISOString(),
    mode: 'replace',
    isActive: true,
    ...over,
  } as any);

const activeOnScreen = (rows: Row[]) =>
  rows.filter((r) => r.isActive && r.screenId === SCREEN);

beforeEach(() => { idSeq = 0; });

describe('breakfast / lunch / dinner on one screen', () => {
  it('all THREE survive — non-overlapping windows are not a conflict', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);

    await publish(controller, { playlistId: 'breakfast', daysOfWeek: 'Mon,Tue,Wed,Thu,Fri', timeStart: '06:00', timeEnd: '10:00' });
    await publish(controller, { playlistId: 'lunch',     daysOfWeek: 'Mon,Tue,Wed,Thu,Fri', timeStart: '11:00', timeEnd: '14:00' });
    await publish(controller, { playlistId: 'dinner',    daysOfWeek: 'Mon,Tue,Wed,Thu,Fri', timeStart: '17:00', timeEnd: '21:00' });

    const live = activeOnScreen(rows);
    expect(live).toHaveLength(3);
    expect(live.map((r) => r.playlistId).sort()).toEqual(['breakfast', 'dinner', 'lunch']);
  });

  it('but an OVERLAPPING publish still displaces — brunch takes breakfast', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);

    await publish(controller, { playlistId: 'breakfast', timeStart: '06:00', timeEnd: '10:00' });
    await publish(controller, { playlistId: 'brunch',    timeStart: '09:00', timeEnd: '12:00' });

    const live = activeOnScreen(rows);
    expect(live).toHaveLength(1);
    expect(live[0].playlistId).toBe('brunch');
  });

  it('an always-on publish still displaces everything — it IS on at every hour', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);

    await publish(controller, { playlistId: 'breakfast', timeStart: '06:00', timeEnd: '10:00' });
    await publish(controller, { playlistId: 'lunch',     timeStart: '11:00', timeEnd: '14:00' });
    await publish(controller, { playlistId: 'allday' });   // no window at all

    const live = activeOnScreen(rows);
    expect(live).toHaveLength(1);
    expect(live[0].playlistId).toBe('allday');
  });

  it('different DAYS never collide — weekend menu beside the weekday one', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);

    await publish(controller, { playlistId: 'weekday', daysOfWeek: 'Mon,Tue,Wed,Thu,Fri', timeStart: '09:00', timeEnd: '17:00' });
    await publish(controller, { playlistId: 'weekend', daysOfWeek: 'Sat,Sun',             timeStart: '09:00', timeEnd: '17:00' });

    expect(activeOnScreen(rows)).toHaveLength(2);
  });
});

describe('the fallback tier — the base playlist that fills every gap', () => {
  it('a daypart publish never removes the fallback', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);

    await publish(controller, { playlistId: 'base', priority: FALLBACK_PRIORITY });  // always-on, priority -1
    await publish(controller, { playlistId: 'breakfast', timeStart: '06:00', timeEnd: '10:00' });
    await publish(controller, { playlistId: 'dinner',    timeStart: '17:00', timeEnd: '21:00' });

    const live = activeOnScreen(rows);
    expect(live.map((r) => r.playlistId).sort()).toEqual(['base', 'breakfast', 'dinner']);
    // And it still sorts last, so the player only reaches it when no daypart
    // window is open.
    expect(live.find((r) => r.playlistId === 'base')!.priority).toBe(FALLBACK_PRIORITY);
  });

  it('publishing the fallback never removes the content it backs up', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);

    await publish(controller, { playlistId: 'breakfast', timeStart: '06:00', timeEnd: '10:00' });
    await publish(controller, { playlistId: 'base', priority: FALLBACK_PRIORITY });

    expect(activeOnScreen(rows).map((r) => r.playlistId).sort()).toEqual(['base', 'breakfast']);
  });

  it('an ordinary always-on publish is NOT a fallback and still displaces', async () => {
    // priority 0 + always-on is the normal "play this all the time" publish —
    // only a NEGATIVE priority marks the safety net.
    const rows: Row[] = [];
    const { controller } = makeController(rows);

    await publish(controller, { playlistId: 'breakfast', timeStart: '06:00', timeEnd: '10:00' });
    await publish(controller, { playlistId: 'ordinary' });

    expect(activeOnScreen(rows)).toHaveLength(1);
    expect(activeOnScreen(rows)[0].playlistId).toBe('ordinary');
  });
});

describe('one playlist, several windows (the Schedule dialog feature)', () => {
  it('the upsert-cleanup no longer collapses a non-overlapping sibling window', async () => {
    // Greg: "i should be able to have multiple schedules but not overlapping
    // each other on the same playlist". The (playlist, target) cleanup used to
    // hard-delete every prior row for that pair, so the second window replaced
    // the first instead of joining it.
    const rows: Row[] = [];
    const { controller } = makeController(rows);

    await publish(controller, { playlistId: 'menu', timeStart: '06:00', timeEnd: '10:00' });
    await publish(controller, { playlistId: 'menu', timeStart: '17:00', timeEnd: '21:00' });

    const live = activeOnScreen(rows);
    expect(live).toHaveLength(2);
    expect(live.map((r) => r.timeStart).sort()).toEqual(['06:00', '17:00']);
  });

  it('but re-publishing the SAME window still replaces it (idempotent republish)', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);

    await publish(controller, { playlistId: 'menu', timeStart: '06:00', timeEnd: '10:00' });
    await publish(controller, { playlistId: 'menu', timeStart: '06:00', timeEnd: '10:00' });

    expect(activeOnScreen(rows)).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Launch QA U15 (2026-10-24) — the owner's rule: "Replace" for a TIME-LIMITED
// playlist (school hours, Mon–Fri 08:00–15:00) must NOT switch off the
// screen's ALWAYS-ON playlist. It stays, as the fallback outside the new
// playlist's hours, so the screen is never blank evenings and weekends. Only
// an explicit "Replace everything" (`replaceAlwaysOn: true`) removes it.
describe('a time-limited publish keeps the always-on playlist as the fallback (U15)', () => {
  const SCHOOL_HOURS = { daysOfWeek: 'Mon,Tue,Wed,Thu,Fri', timeStart: '08:00', timeEnd: '15:00' };

  it('school hours onto an always-on lobby loop: BOTH stay live, the loop becomes the fallback tier', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);

    await publish(controller, { playlistId: 'lobby' }); // always-on, priority 0
    await publish(controller, { playlistId: 'school', ...SCHOOL_HOURS });

    const live = activeOnScreen(rows);
    expect(live.map((r) => r.playlistId).sort()).toEqual(['lobby', 'school']);
    expect(live.find((r) => r.playlistId === 'lobby')!.priority).toBe(FALLBACK_PRIORITY);
    expect(live.find((r) => r.playlistId === 'school')!.priority).toBe(0);
  });

  it('the publish audit row names the rule it kept', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);
    await publish(controller, { playlistId: 'lobby' });
    const lobbyId = rows[0].id;
    const prisma = (controller as any).prisma;
    prisma.client.auditLog.create.mockClear();

    await publish(controller, { playlistId: 'school', ...SCHOOL_HOURS });

    const created = prisma.client.auditLog.create.mock.calls
      .map((c: any[]) => c[0].data)
      .find((d: any) => d.action === 'SCHEDULE_CREATED');
    expect(JSON.parse(created.details).keptAlwaysOnAsFallback).toEqual([lobbyId]);
  });

  it('"Replace everything" (replaceAlwaysOn: true) switches the always-on one off, exactly as before', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);

    await publish(controller, { playlistId: 'lobby' });
    await publish(controller, { playlistId: 'school', ...SCHOOL_HOURS, replaceAlwaysOn: true });

    const live = activeOnScreen(rows);
    expect(live.map((r) => r.playlistId)).toEqual(['school']);
    expect(rows.find((r) => r.playlistId === 'lobby')!.priority).toBe(0);
  });

  it('an END DATE alone is time-limited — an event that stops by itself keeps the loop', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);

    await publish(controller, { playlistId: 'lobby' });
    await publish(controller, { playlistId: 'assembly', endTime: new Date('2026-12-31T23:59:59Z').toISOString() });

    expect(activeOnScreen(rows).map((r) => r.playlistId).sort()).toEqual(['assembly', 'lobby']);
  });

  it('a start still AHEAD is time-limited — the loop keeps playing until it begins', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);

    await publish(controller, { playlistId: 'lobby' });
    await publish(controller, {
      playlistId: 'winter',
      startTime: new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString(),
    });

    expect(activeOnScreen(rows).map((r) => r.playlistId).sort()).toEqual(['lobby', 'winter']);
  });

  it('a start of "now" is NOT time-limited — two always-on playlists still cannot share a screen', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);

    await publish(controller, { playlistId: 'lobby' });
    await publish(controller, { playlistId: 'hall', startTime: new Date().toISOString() });

    expect(activeOnScreen(rows).map((r) => r.playlistId)).toEqual(['hall']);
  });

  it('an overlapping WINDOWED rule is still replaced — only an always-on one is kept', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);

    await publish(controller, { playlistId: 'lunch', daysOfWeek: 'Mon,Tue,Wed,Thu,Fri', timeStart: '11:00', timeEnd: '13:00' });
    await publish(controller, { playlistId: 'school', ...SCHOOL_HOURS });

    expect(activeOnScreen(rows).map((r) => r.playlistId)).toEqual(['school']);
  });

  it("the playlist's OWN all-day rule is narrowed, never kept as a fallback for itself", async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);

    await publish(controller, { playlistId: 'menu' });
    await publish(controller, { playlistId: 'menu', ...SCHOOL_HOURS });

    const live = activeOnScreen(rows);
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ playlistId: 'menu', timeStart: '08:00', priority: 0 });
  });

  it('an APPEND-mode always-on rule is not kept (it would append its items inside the window)', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);

    await publish(controller, { playlistId: 'ticker', mode: 'append' });
    await publish(controller, { playlistId: 'school', ...SCHOOL_HOURS });

    expect(activeOnScreen(rows).map((r) => r.playlistId)).toEqual(['school']);
  });

  it('a GROUP-wide school-hours publish keeps a member screen’s always-on pin as the fallback', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);
    (controller as any).prisma.client.screen.findMany.mockResolvedValue([{ id: SCREEN }]);

    await publish(controller, { playlistId: 'lobby' }); // pinned to the member screen
    await controller.create(adminReq as any, {
      playlistId: 'school',
      screenGroupId: 'grp',
      startTime: new Date('2026-09-16T00:00:00Z').toISOString(),
      mode: 'replace',
      isActive: true,
      ...SCHOOL_HOURS,
    } as any);

    const lobby = rows.find((r) => r.playlistId === 'lobby')!;
    expect(lobby.isActive).toBe(true);
    expect(lobby.priority).toBe(FALLBACK_PRIORITY);
    expect(rows.find((r) => r.playlistId === 'school')!.isActive).toBe(true);
  });

  it('a publish HELD for a playback copy decides now: the loop is kept and stays on glass meanwhile', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);
    await publish(controller, { playlistId: 'lobby' });
    (controller as any).mediaPublication = { prepare: jest.fn().mockResolvedValue(true) };

    await publish(controller, { playlistId: 'school', ...SCHOOL_HOURS });

    const lobby = rows.find((r) => r.playlistId === 'lobby')!;
    const school = rows.find((r) => r.playlistId === 'school')!;
    expect(lobby).toMatchObject({ isActive: true, priority: FALLBACK_PRIORITY });
    // Held: not live yet. When the sweep activates it, the fallback tier is
    // exempt from its displacement.
    expect(school.isActive).toBe(false);
  });

  it('an Editor’s draft decides nothing at publish time', async () => {
    const rows: Row[] = [];
    const { controller } = makeController(rows);
    await publish(controller, { playlistId: 'lobby' });

    await controller.create(
      { user: { id: 'e1', userId: 'e1', role: AppRole.CONTRIBUTOR, tenantId: 't1' } } as any,
      { playlistId: 'school', screenId: SCREEN, startTime: new Date('2026-09-16T00:00:00Z').toISOString(), mode: 'replace', isActive: true, ...SCHOOL_HOURS } as any,
    );

    expect(rows.find((r) => r.playlistId === 'lobby')).toMatchObject({ isActive: true, priority: 0 });
  });
});
