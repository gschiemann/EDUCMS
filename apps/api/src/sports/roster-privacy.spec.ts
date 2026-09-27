/**
 * K-12 launch audit F38 — public roster visibility.
 *
 * Acceptance from the register: "Disabling a student photo/name removes it
 * from board responses, rendered views and applicable caches." The board
 * response is the public `GET /sports/board/:id` payload (memoised ~1 s and
 * ETag'd), so the redaction is proven against `SportsService.getBoardWithMeta`
 * itself, with the in-memory Prisma double the board ETag spec uses.
 */
import { NotFoundException } from '@nestjs/common';
import { SportsService } from './sports.service';
import { SportsRosterPrivacyService } from './sports-roster-privacy.service';
import {
  DEFAULT_ROSTER_PRIVACY,
  ROSTER_PRIVACY_EVENT,
  parseRosterPrivacy,
  redactCuePayload,
  redactPublicRoster,
  redactRosterEntry,
} from './roster-privacy';

/* ── pure policy ─────────────────────────────────────────────────── */

const JORDAN = {
  id: 'p1',
  team: 'home',
  name: 'Jordan Lee',
  number: '3',
  position: 'G',
  photoUrl: 'https://cdn.example/jl.png',
  stats: { PTS: '14' },
};

describe('parseRosterPrivacy', () => {
  it("defaults to today's behaviour (everything shown) and sanitises junk", () => {
    expect(parseRosterPrivacy(undefined)).toEqual(DEFAULT_ROSTER_PRIVACY);
    expect(
      parseRosterPrivacy({ names: 'nicknames', photos: 'no', numbers: false }),
    ).toEqual({ ...DEFAULT_ROSTER_PRIVACY, numbers: false });
  });
});

describe('redactRosterEntry', () => {
  it('last-name mode keeps only the last name', () => {
    expect(
      redactRosterEntry(JORDAN, { ...DEFAULT_ROSTER_PRIVACY, names: 'last' })
        .name,
    ).toBe('Lee');
  });
  it('hidden names, numbers, photos, positions and stats each disappear on their own switch', () => {
    const r = redactRosterEntry(JORDAN, {
      names: 'hidden',
      numbers: false,
      photos: false,
      positions: false,
      stats: false,
    });
    expect(r).toMatchObject({
      id: 'p1',
      team: 'home',
      name: '',
      number: null,
      photoUrl: null,
      position: null,
      stats: {},
    });
  });
  it('the default policy returns the entry untouched and never mutates input', () => {
    expect(redactRosterEntry(JORDAN, DEFAULT_ROSTER_PRIVACY)).toBe(JORDAN);
    const copy = { ...JORDAN };
    redactRosterEntry(copy, { ...DEFAULT_ROSTER_PRIVACY, photos: false });
    expect(copy.photoUrl).toBe(JORDAN.photoUrl);
  });
  it('redactPublicRoster tolerates a missing roster', () => {
    expect(redactPublicRoster(null, DEFAULT_ROSTER_PRIVACY)).toEqual([]);
  });
});

describe('redactCuePayload (the pre-game intro lineup)', () => {
  it("redacts every lineup entry and keeps the intro widget's empty-string shape", () => {
    const cue = { key: 'pregame-intro', lineup: [{ ...JORDAN }] };
    const out = redactCuePayload(cue, {
      ...DEFAULT_ROSTER_PRIVACY,
      names: 'hidden',
      photos: false,
    });
    expect((out.lineup as any[])[0]).toMatchObject({
      name: '',
      photoUrl: '',
      number: '3',
    });
  });
  it('leaves cues without a lineup alone', () => {
    const cue = { key: 'touchdown' };
    expect(
      redactCuePayload(cue, { ...DEFAULT_ROSTER_PRIVACY, names: 'hidden' }),
    ).toBe(cue);
  });
});

/* ── in-memory Prisma double (trimmed from sports-board-etag.spec.ts) ── */

function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([k, v]: any) => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return v.in.includes(row[k]);
      if ('gte' in v)
        return new Date(row[k]).getTime() >= new Date(v.gte).getTime();
      return false;
    }
    return row[k] === v;
  });
}

function makeTable(defaults: Record<string, any> = {}) {
  const rows: any[] = [];
  let seq = 0;
  let clock = Date.now();
  const sortRows = (out: any[], orderBy: any) => {
    const clauses = Array.isArray(orderBy) ? orderBy : [orderBy];
    return out.slice().sort((a, b) => {
      for (const clause of clauses) {
        for (const [k, dir] of Object.entries(clause)) {
          const av = a[k] instanceof Date ? a[k].getTime() : a[k];
          const bv = b[k] instanceof Date ? b[k].getTime() : b[k];
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          if (cmp !== 0) return dir === 'desc' ? -cmp : cmp;
        }
      }
      return 0;
    });
  };
  return {
    rows,
    findFirst: async ({ where, orderBy }: any = {}) => {
      let out = rows.filter((r) => matches(r, where));
      if (orderBy) out = sortRows(out, orderBy);
      return out[0] ?? null;
    },
    findUnique: async ({ where }: any = {}) =>
      rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where, orderBy }: any = {}) => {
      const out = rows.filter((r) => matches(r, where || {}));
      return orderBy ? sortRows(out, orderBy) : out;
    },
    count: async ({ where }: any = {}) =>
      rows.filter((r) => matches(r, where || {})).length,
    create: async ({ data }: any) => {
      // Strictly increasing timestamps so "latest wins" is deterministic.
      const row = {
        id: `id-${++seq}`,
        createdAt: new Date((clock += 1000)),
        updatedAt: new Date(clock),
        ...defaults,
        ...data,
      };
      rows.push(row);
      return row;
    },
    createMany: async ({ data }: any) => {
      for (const d of Array.isArray(data) ? data : [data])
        rows.push({
          id: `id-${++seq}`,
          createdAt: new Date((clock += 1000)),
          ...defaults,
          ...d,
        });
      return { count: 1 };
    },
    update: async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error('Row not found');
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    delete: async () => ({}),
  };
}

const TENANT = 'tenant-a';
const OTHER = 'tenant-b';

function setup() {
  const tables = {
    game: makeTable({ homeScore: 0, awayScore: 0 }),
    gameEvent: makeTable(),
    screen: makeTable(),
    sponsor: makeTable(),
    rosterPlayer: makeTable(),
    customCue: makeTable(),
    auditLog: makeTable(),
    template: makeTable(),
  };
  const client: any = { ...tables };
  // Inserts made inside a transaction that throws are rolled back, so
  // "the event and its audit row commit together or not at all" is testable.
  client.$transaction = async (fn: (tx: unknown) => unknown) => {
    const sizes = Object.entries(tables).map(
      ([k, t]) => [k, t.rows.length] as const,
    );
    try {
      return await fn(client);
    } catch (err) {
      for (const [k, n] of sizes) (tables as any)[k].rows.length = n;
      throw err;
    }
  };
  const prisma = { client };
  const sports = new SportsService(
    prisma as any,
    { publish: jest.fn().mockResolvedValue(undefined) } as any,
    { signMessage: jest.fn(() => ({ eventId: 'e', signature: 's' })) } as any,
    { listActive: jest.fn().mockResolvedValue([]) } as any,
    { isEnabledAsync: jest.fn().mockResolvedValue(false) } as any,
  );
  const privacy = new SportsRosterPrivacyService(prisma as any, sports);
  return { tables, sports, privacy };
}

async function gameWithRoster(s: ReturnType<typeof setup>, tenant = TENANT) {
  const g = await s.sports.createGame(tenant, {
    sport: 'basketball',
    homeTeam: 'Lincoln',
    awayTeam: 'Roosevelt',
  });
  await s.tables.rosterPlayer.create({
    data: {
      tenantId: tenant,
      gameId: g.id,
      team: 'home',
      sortOrder: 0,
      ...JORDAN,
      id: undefined,
    },
  });
  return g;
}

/** Bypass the 1 s memo so a read reflects the latest write. */
function fresh(s: ReturnType<typeof setup>, gameId: string) {
  (s.sports as any).boardCache.delete(gameId);
  return s.sports.getBoardWithMeta(gameId);
}

describe("F38 — the public board payload honours the school's roster visibility", () => {
  it('default: the roster is exactly what it was before this feature', async () => {
    const s = setup();
    const g = await gameWithRoster(s);
    const { payload } = await fresh(s, g.id);
    expect(payload.roster[0]).toMatchObject({
      name: 'Jordan Lee',
      number: '3',
      photoUrl: JORDAN.photoUrl,
    });
  });

  it('hiding names and photos removes them from the board response and changes its ETag', async () => {
    const s = setup();
    const g = await gameWithRoster(s);
    const before = await fresh(s, g.id);
    await s.privacy.set(TENANT, g.id, 'user-1', {
      names: 'hidden',
      photos: false,
    });
    const after = await fresh(s, g.id);
    expect(after.payload.roster[0]).toMatchObject({
      name: '',
      photoUrl: null,
      number: '3',
    });
    expect(JSON.stringify(after.payload)).not.toContain('Jordan');
    expect(JSON.stringify(after.payload)).not.toContain('jl.png');
    expect(after.etag).not.toBe(before.etag);
  });

  it("the pre-game intro cue's lineup is redacted too", async () => {
    const s = setup();
    const g = await gameWithRoster(s);
    await s.sports.firePregameIntro(TENANT, g.id, { team: 'home' }, 'user-1');
    await s.privacy.set(TENANT, g.id, 'user-1', {
      names: 'last',
      photos: false,
    });
    const { payload } = await fresh(s, g.id);
    const intro = payload.cues.find((c: any) => c.key === 'pregame-intro');
    expect(intro).toBeTruthy();
    expect(intro.lineup[0]).toMatchObject({ name: 'Lee', photoUrl: '' });
  });

  it('latest setting wins, and turning it back on restores the roster', async () => {
    const s = setup();
    const g = await gameWithRoster(s);
    await s.privacy.set(TENANT, g.id, 'user-1', { names: 'hidden' });
    await s.privacy.set(TENANT, g.id, 'user-1', {});
    const { payload } = await fresh(s, g.id);
    expect(payload.roster[0].name).toBe('Jordan Lee');
    expect(await s.privacy.get(TENANT, g.id)).toEqual(DEFAULT_ROSTER_PRIVACY);
  });
});

describe('F38 — the setting is tenant-scoped, sanitised and audited', () => {
  it('writes the sanitised policy as a ROSTER_PRIVACY event and an immutable audit row naming the actor', async () => {
    const s = setup();
    const g = await gameWithRoster(s);
    const policy = await s.privacy.set(TENANT, g.id, 'user-9', {
      names: 'last',
      numbers: 'nope',
      photos: false,
      extra: 'x',
    });
    expect(policy).toEqual({
      ...DEFAULT_ROSTER_PRIVACY,
      names: 'last',
      photos: false,
    });
    const ev = s.tables.gameEvent.rows.find(
      (r) => r.type === ROSTER_PRIVACY_EVENT,
    );
    expect(ev.payload).toEqual(policy);
    // K12-F34: the event names who produced it.
    expect(ev).toMatchObject({ actorType: 'user', actorUserId: 'user-9' });
    const audit = s.tables.auditLog.rows.find(
      (r) => r.action === 'SPORTS_ROSTER_PRIVACY_SET',
    );
    expect(audit).toMatchObject({
      tenantId: TENANT,
      userId: 'user-9',
      targetType: 'Game',
      targetId: g.id,
    });
    expect(JSON.parse(audit.details)).toMatchObject({
      ...policy,
      eventId: ev.id,
      actor: { type: 'user', ref: null },
    });
  });

  it('an API-key call is attributed to the key as well as the user', async () => {
    const s = setup();
    const g = await gameWithRoster(s);
    await s.privacy.set(
      TENANT,
      g.id,
      { actor: { kind: 'user', userId: 'user-9', ref: 'api-key:k1' } },
      { photos: false },
    );
    const audit = s.tables.auditLog.rows.find(
      (r) => r.action === 'SPORTS_ROSTER_PRIVACY_SET',
    );
    expect(JSON.parse(audit.details).actor).toEqual({
      type: 'user',
      ref: 'api-key:k1',
    });
  });

  it('if the audit row cannot be written, the setting does not change (one transaction)', async () => {
    const s = setup();
    const g = await gameWithRoster(s);
    const create = s.tables.auditLog.create;
    s.tables.auditLog.create = async () => {
      throw new Error('audit storage down');
    };
    await expect(
      s.privacy.set(TENANT, g.id, 'user-9', { names: 'hidden' }),
    ).rejects.toThrow('audit storage down');
    s.tables.auditLog.create = create;
    expect(
      s.tables.gameEvent.rows.some((r) => r.type === ROSTER_PRIVACY_EVENT),
    ).toBe(false);
    const { payload } = await fresh(s, g.id);
    expect(payload.roster[0].name).toBe('Jordan Lee');
  });

  it('another tenant can neither read nor change it (404, nothing written)', async () => {
    const s = setup();
    const g = await gameWithRoster(s, TENANT);
    await expect(
      s.privacy.set(OTHER, g.id, 'intruder', { names: 'hidden' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(s.privacy.get(OTHER, g.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(
      s.tables.gameEvent.rows.some((r) => r.type === ROSTER_PRIVACY_EVENT),
    ).toBe(false);
    expect(
      s.tables.auditLog.rows.some(
        (r) => r.action === 'SPORTS_ROSTER_PRIVACY_SET',
      ),
    ).toBe(false);
    const { payload } = await fresh(s, g.id);
    expect(payload.roster[0].name).toBe('Jordan Lee');
  });
});
