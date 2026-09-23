/**
 * Included AI allowance — pooled per organisation (2026-09-22); in BOARDS for the Designer and
 * DOLLARS for everything else (2026-09-23).
 *
 * The fake applies EXACTLY the `where` it is given — a filter the service forgets to send is a
 * filter the fake does not apply — so a dropped organisation filter shows up here as another
 * organisation's rows leaking in, not as a silently-passing count.
 */
import { AiAllowanceService, includedMicrosFor, utcMonthWindow } from './ai-allowance.service';
import { AiUsageMeterService } from './ai-usage-meter.service';
import { addMonthsUtc, monthKey } from './ai-board-credits';
import { setCatalogState } from './ai-model-catalog';

type Row = { id: string; parentId: string | null; archivedAt?: Date | null; aiKeyEncrypted?: string | null; aiProvider?: string | null };
type Event = { tenantId?: string; orgTenantId: string; source: string; feature: string; costMicros: number; createdAt: Date };
type Purchase = { id: string; orgTenantId: string; stripeSessionId: string; pack: string; boards: number; usdMicros: number; createdAt: Date; expiresAt: Date };
type MonthRow = { orgTenantId: string; month: string; includedBoards: number };

/** Does `value` satisfy a Prisma scalar filter (only the operators the service uses)? */
function matches(value: any, filter: any): boolean {
  if (filter === undefined) return true;
  if (filter === null || typeof filter !== 'object' || filter instanceof Date) return value === filter;
  if ('in' in filter && !filter.in.includes(value)) return false;
  if ('notIn' in filter && filter.notIn.includes(value)) return false;
  if ('gte' in filter && !(value >= filter.gte)) return false;
  if ('gt' in filter && !(value > filter.gt)) return false;
  if ('not' in filter && value === filter.not) return false;
  return true;
}
const whereOk = (row: any, where: any = {}) => Object.entries(where).every(([k, f]) => matches(row[k], f));

function makePrisma(tenants: Row[], screens: Array<{ tenantId: string; pairedAt: Date | null }>) {
  const events: Event[] = [];
  const purchases: Purchase[] = [];
  const months: MonthRow[] = [];
  const raised: Array<{ orgTenantId: string; month: string; included: number }> = [];
  const prisma: any = {
    client: {
      tenant: {
        findUnique: jest.fn(async ({ where }: any) => {
          const t = tenants.find((x) => x.id === where.id);
          return t ? { parentId: t.parentId, aiKeyEncrypted: t.aiKeyEncrypted ?? null, aiProvider: t.aiProvider ?? null, aiModel: null } : null;
        }),
        findMany: jest.fn(async ({ where }: any) =>
          tenants.filter((t) => where.parentId.in.includes(t.parentId) && !t.archivedAt).map((t) => ({ id: t.id })),
        ),
      },
      screen: {
        count: jest.fn(async ({ where }: any) =>
          screens.filter((s) => where.tenantId.in.includes(s.tenantId) && s.pairedAt !== null).length,
        ),
      },
      aiUsageEvent: {
        create: jest.fn(async ({ data }: any) => {
          events.push({ ...data, createdAt: new Date() });
          return data;
        }),
        aggregate: jest.fn(async ({ where }: any) => ({
          _sum: { costMicros: events.filter((e) => whereOk(e, where)).reduce((s, e) => s + e.costMicros, 0) },
        })),
        count: jest.fn(async ({ where }: any) => events.filter((e) => whereOk(e, where)).length),
        groupBy: jest.fn(async ({ by, where }: any) => {
          const groups = new Map<string, any>();
          for (const e of events.filter((x) => whereOk(x, where))) {
            const key = by.map((k: string) => (e as any)[k]).join('|');
            const g = groups.get(key) || { ...Object.fromEntries(by.map((k: string) => [k, (e as any)[k]])), _sum: { costMicros: 0 }, _count: { _all: 0 } };
            g._sum.costMicros += e.costMicros;
            g._count._all += 1;
            groups.set(key, g);
          }
          return [...groups.values()];
        }),
      },
      aiCreditPurchase: {
        findMany: jest.fn(async ({ where, orderBy, take }: any) => {
          const out = purchases.filter((p) => whereOk(p, where));
          if (orderBy?.createdAt === 'asc') out.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          return out.slice(0, take ?? out.length);
        }),
      },
      aiBoardMonth: {
        findMany: jest.fn(async ({ where }: any) => months.filter((m) => whereOk(m, where)).map((m) => ({ month: m.month, includedBoards: m.includedBoards }))),
      },
      // The monthly board count (only reached when the organisation has packs): the SQL's own
      // filter, applied to the fake ledger — org = $1, platform, the credit features, created_at >= $2.
      $queryRawUnsafe: jest.fn(async (sql: string, org: string, since: string) => {
        expect(sql).toContain('"org_tenant_id" = $1');
        expect(sql).toContain(`"feature" IN ('designer', 'designer-revise')`);
        const from = new Date(`${since.replace(' ', 'T')}Z`);
        const byMonth = new Map<string, number>();
        for (const e of events) {
          if (e.orgTenantId !== org || e.source !== 'platform' || !['designer', 'designer-revise'].includes(e.feature) || e.createdAt < from) continue;
          byMonth.set(monthKey(e.createdAt), (byMonth.get(monthKey(e.createdAt)) ?? 0) + 1);
        }
        return [...byMonth.entries()].map(([month, boards]) => ({ month, boards }));
      }),
      // The month high-water mark: GREATEST semantics, as the real statement.
      $executeRawUnsafe: jest.fn(async (_sql: string, org: string, month: string, included: number) => {
        raised.push({ orgTenantId: org, month, included });
        const cur = months.find((m) => m.orgTenantId === org && m.month === month);
        if (!cur) months.push({ orgTenantId: org, month, includedBoards: included });
        else cur.includedBoards = Math.max(cur.includedBoards, included);
        return 1;
      }),
    },
  };
  return { prisma, events, purchases, months, raised };
}

const TREE: Row[] = [
  { id: 'district', parentId: null },
  { id: 'school-a', parentId: 'district' },
  { id: 'school-b', parentId: 'district' },
  { id: 'closed', parentId: 'district', archivedAt: new Date() },
  { id: 'solo', parentId: null },
];
const SCREENS = [
  ...Array.from({ length: 6 }, () => ({ tenantId: 'school-a', pairedAt: new Date() })),
  ...Array.from({ length: 4 }, () => ({ tenantId: 'school-b', pairedAt: new Date() })),
  { tenantId: 'school-b', pairedAt: null }, // pending pairing — not a paid screen
  ...Array.from({ length: 9 }, () => ({ tenantId: 'closed', pairedAt: new Date() })), // archived school
];

const ev = (orgTenantId: string, feature: string, createdAt = new Date(), source = 'platform', costMicros = 170_000): Event => ({
  orgTenantId,
  tenantId: orgTenantId,
  source,
  feature,
  costMicros,
  createdAt,
});

describe('AiAllowanceService — dollars (every AI feature outside the Designer)', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('pure math: $ per screen, never below the floor', () => {
    expect(includedMicrosFor(0, 2, 5)).toBe(5_000_000);
    expect(includedMicrosFor(1, 2, 5)).toBe(5_000_000);
    expect(includedMicrosFor(10, 2, 5)).toBe(20_000_000);
    expect(includedMicrosFor(40, 2, 5)).toBe(80_000_000);
  });

  it('pools at the ORGANISATION: a school draws on every paired screen its district owns', async () => {
    const { prisma } = makePrisma(TREE, SCREENS);
    const svc = new AiAllowanceService(prisma);
    const snap = await svc.snapshot('school-a');
    expect(snap.orgTenantId).toBe('district');
    expect(snap.screens).toBe(10); // 6 + 4 paired; pending + archived school excluded
    expect(snap.includedMicros).toBe(20_000_000);
    expect(snap.includedCredits).toBe(2_000);
    expect(snap.usedCredits).toBe(0);
    expect(snap.resetAt).toBe(utcMonthWindow().next.toISOString());
  });

  it('a tenant with no screens gets the floor', async () => {
    const { prisma } = makePrisma(TREE, SCREENS);
    const snap = await new AiAllowanceService(prisma).snapshot('solo');
    expect(snap.screens).toBe(0);
    expect(snap.includedMicros).toBe(5_000_000);
  });

  it('env knobs move the allowance with no deploy', async () => {
    process.env.AI_INCLUDED_USD_PER_SCREEN = '1';
    process.env.AI_INCLUDED_USD_FLOOR = '3';
    const { prisma } = makePrisma(TREE, SCREENS);
    const snap = await new AiAllowanceService(prisma).snapshot('school-b');
    expect(snap.includedMicros).toBe(10_000_000);
    expect(snap.perScreenUsd).toBe(1);
    process.env.AI_INCLUDED_USD_PER_SCREEN = 'nonsense';
    expect(new AiAllowanceService(prisma).perScreenUsd).toBe(2);
  });

  it('spend recorded anywhere in the organisation counts against the shared pool; BYOK spend never does', async () => {
    const { prisma } = makePrisma(TREE, SCREENS);
    const allowance = new AiAllowanceService(prisma);
    const meter = new AiUsageMeterService(prisma, allowance);
    // Sonnet 5, 10k in + 8k out = $0.10 = 10 credits, spent at school-b on OUR key
    await meter.record({
      tenantId: 'school-b', provider: 'anthropic', model: 'claude-sonnet-5', source: 'platform', feature: 'concierge',
      usage: { inputTokens: 10_000, outputTokens: 8_000 },
    });
    // the same work on a tenant's own key — recorded, not counted
    await meter.record({
      tenantId: 'school-a', provider: 'anthropic', model: 'claude-sonnet-5', source: 'tenant', feature: 'concierge',
      usage: { inputTokens: 10_000, outputTokens: 8_000 },
    });
    const snap = await allowance.snapshot('school-a');
    expect(snap.usedMicros).toBe(100_000);
    expect(snap.usedCredits).toBe(10);
  });

  it('the Designer\'s board pipeline is NOT summed in dollars — the board cap governs it (designing bought boards never runs Sparkle dry)', async () => {
    const { prisma, events } = makePrisma(TREE, SCREENS);
    for (const f of ['designer', 'designer-redraw', 'designer-revise', 'designer-review', 'designer-review-revise']) events.push(ev('district', f));
    events.push(ev('district', 'concierge', new Date(), 'platform', 30_000));
    events.push(ev('district', 'designer-brief', new Date(), 'platform', 2_000)); // a fast-tier call: stays in dollars
    const snap = await new AiAllowanceService(prisma).snapshot('school-a');
    expect(snap.usedMicros).toBe(32_000);
  });

  it('a read failure falls back to the floor with nothing used — never unlimited, never a thrown 500', async () => {
    const { prisma } = makePrisma(TREE, SCREENS);
    prisma.client.aiUsageEvent.aggregate = jest.fn(async () => {
      throw new Error('db down');
    });
    const snap = await new AiAllowanceService(prisma).snapshot('school-a');
    expect(snap.includedMicros).toBe(5_000_000);
    expect(snap.usedMicros).toBe(0);
  });

  it('a parent cycle in bad data cannot loop the org walk', async () => {
    const { prisma } = makePrisma(
      [
        { id: 'a', parentId: 'b' },
        { id: 'b', parentId: 'a' },
      ],
      [],
    );
    const org = await new AiAllowanceService(prisma).orgTenantIdFor('a');
    expect(['a', 'b']).toContain(org);
  });
});

describe('AiAllowanceService — BOARDS (the AI Designer on our key)', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'sk-openai-platform';
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
    setCatalogState({});
  });
  afterAll(() => {
    process.env = saved;
    setCatalogState({});
  });

  it('included = max(10, 5 × paired screens) across the organisation; used = board credits on OUR key only', async () => {
    const { prisma, events } = makePrisma(TREE, SCREENS);
    events.push(ev('district', 'designer'), ev('district', 'designer'), ev('district', 'designer-revise'));
    events.push(ev('district', 'designer-redraw'), ev('district', 'designer-review'), ev('district', 'designer-review-revise'), ev('district', 'designer-brief'));
    events.push(ev('district', 'designer', new Date(), 'tenant')); // own key: never a credit
    const b = await new AiAllowanceService(prisma).boards('school-b');
    expect(b).toMatchObject({ orgTenantId: 'district', screens: 10, included: 50, used: 3, purchasedRemaining: 0, left: 47, packs: [] });
    expect(b.resetAt).toBe(utcMonthWindow().next.toISOString());
  });

  it('TENANT SCOPE: another organisation\'s boards and packs never count here', async () => {
    const { prisma, events, purchases } = makePrisma(TREE, SCREENS);
    for (let i = 0; i < 40; i++) events.push(ev('solo', 'designer'));
    purchases.push({ id: 'solo-pack', orgTenantId: 'solo', stripeSessionId: 'cs_solo', pack: 'bulk', boards: 100, usdMicros: 49_000_000, createdAt: new Date(), expiresAt: addMonthsUtc(new Date(), 12) });
    const b = await new AiAllowanceService(prisma).boards('school-a');
    expect(b.used).toBe(0);
    expect(b.purchasedRemaining).toBe(0);
    expect(b.packs).toEqual([]);
  });

  it('the month\'s included boards are a HIGH-WATER MARK: pairing adds at once (recorded), unpairing never takes boards back mid-month', async () => {
    const { prisma, raised, months } = makePrisma(TREE, SCREENS);
    const svc = new AiAllowanceService(prisma);
    await svc.boards('school-a');
    expect(raised).toEqual([{ orgTenantId: 'district', month: monthKey(new Date()), included: 50 }]);
    // six screens unpaired mid-month: the stored 50 stands, and nothing is re-written
    prisma.client.screen.count = jest.fn(async () => 4);
    const after = await svc.boards('school-a');
    expect(after.included).toBe(50);
    expect(raised).toHaveLength(1);
    expect(months).toEqual([{ orgTenantId: 'district', month: monthKey(new Date()), includedBoards: 50 }]);
  });

  it('packs: bought boards are drawn after the included ones, month by month, from the LEDGER — and expired packs lapse', async () => {
    const now = new Date();
    const { prisma, events, purchases, months } = makePrisma(TREE, []);
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
    // last month: 14 boards drawn against 10 included → 4 from the pack; this month: 12 of 10 → 2 more
    for (let i = 0; i < 14; i++) events.push(ev('solo', 'designer', lastMonth));
    for (let i = 0; i < 12; i++) events.push(ev('solo', i % 2 ? 'designer' : 'designer-revise'));
    months.push({ orgTenantId: 'solo', month: monthKey(lastMonth), includedBoards: 10 });
    purchases.push(
      { id: 'live', orgTenantId: 'solo', stripeSessionId: 'cs_live', pack: 'standard', boards: 30, usdMicros: 19_000_000, createdAt: new Date(lastMonth.getTime() - 86_400_000), expiresAt: addMonthsUtc(lastMonth, 12) },
      { id: 'lapsed', orgTenantId: 'solo', stripeSessionId: 'cs_old', pack: 'starter', boards: 10, usdMicros: 9_000_000, createdAt: addMonthsUtc(now, -14), expiresAt: addMonthsUtc(now, -2) },
    );
    const b = await new AiAllowanceService(prisma).boards('solo');
    expect(b).toMatchObject({ included: 10, used: 12, purchasedRemaining: 24, left: 24 });
    expect(b.packs.map((p) => [p.id, p.remaining, p.expired, p.usd])).toEqual([
      ['live', 24, false, 19],
      ['lapsed', 0, true, 9],
    ]);
  });

  it('a read failure → the floor, nothing used, no packs, degraded — never unlimited, never a thrown 500', async () => {
    const { prisma } = makePrisma(TREE, SCREENS);
    prisma.client.aiCreditPurchase.findMany = jest.fn(async () => {
      throw new Error('db down');
    });
    const b = await new AiAllowanceService(prisma).boards('school-a');
    expect(b).toMatchObject({ included: 10, used: 0, purchasedRemaining: 0, left: 10, packs: [], degraded: true });
  });

  it('assertBoardsAvailable: the WHOLE request must fit — refused with the numbers, allowed when it fits', async () => {
    const { prisma, events } = makePrisma(TREE, []);
    for (let i = 0; i < 9; i++) events.push(ev('solo', 'designer'));
    const svc = new AiAllowanceService(prisma);
    await expect(svc.assertBoardsAvailable('solo', 1)).resolves.toMatchObject({ left: 1 });
    const err = await svc.assertBoardsAvailable('solo', 2).catch((e) => e);
    expect(err.getStatus()).toBe(402);
    expect(err.getResponse()).toMatchObject({
      code: 'AI_CAP_REACHED', unit: 'boards', boardsNeeded: 2, boardsLeft: 1, used: 9, cap: 10, purchaseEnabled: true,
      resetAt: utcMonthWindow().next.toISOString(),
    });
    expect(err.getResponse().message).toContain('This batch needs 2 boards; you have 1 left this month');
    expect(err.getResponse().message).toContain('Buy more boards in Settings → Billing');
  });

  it('…and never offers "buy more" when a pack cannot be bought (Stripe off)', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { prisma, events } = makePrisma(TREE, []);
    for (let i = 0; i < 10; i++) events.push(ev('solo', 'designer'));
    const err = await new AiAllowanceService(prisma).assertBoardsAvailable('solo', 1, 'refine').catch((e) => e);
    expect(err.getResponse()).toMatchObject({ purchaseEnabled: false, boardsLeft: 0 });
    expect(err.getResponse().message).not.toContain('Buy more');
  });

  it('whose key draws the boards: its own or its organisation\'s → tenant; ours with a design route → platform; neither → none', async () => {
    const tree: Row[] = [
      { id: 'chain', parentId: null, aiKeyEncrypted: 'enc', aiProvider: 'openai' },
      { id: 'store', parentId: 'chain' },
      { id: 'indie', parentId: null },
    ];
    const { prisma } = makePrisma(tree, []);
    const svc = new AiAllowanceService(prisma);
    expect(await svc.boardSourceFor('store')).toBe('tenant');
    expect(await svc.boardSourceFor('indie')).toBe('platform');
    delete process.env.OPENAI_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'sk-ant'; // a fast key only — design never runs on Claude
    expect(await svc.boardSourceFor('indie')).toBe('none');
  });

  it('operatorView: platform → exact counts + packs + purchaseEnabled; no COGS unless asked (SUPER_ADMIN)', async () => {
    const { prisma, events } = makePrisma(TREE, SCREENS);
    events.push(ev('district', 'designer'), ev('district', 'designer'));
    const svc = new AiAllowanceService(prisma);
    const view = await svc.operatorView('school-a');
    expect(view).toEqual({
      source: 'platform',
      unlimited: false,
      boardsIncluded: 50,
      boardsUsed: 2,
      boardsPurchasedRemaining: 0,
      boardsLeft: 48,
      resetAt: utcMonthWindow().next.toISOString(),
      screens: 10,
      packs: [
        { id: 'starter', boards: 10, usd: 9 },
        { id: 'standard', boards: 30, usd: 19 },
        { id: 'bulk', boards: 100, usd: 49 },
      ],
      purchaseEnabled: true,
    });
    expect(view).not.toHaveProperty('boardCostUsdTrailing');
    const su = await svc.operatorView('school-a', { includeCost: true });
    expect(su.boardCostUsdTrailing).toBe(0.17); // two boards at $0.17 each in the fake ledger
  });

  it('operatorView: own key → unlimited, no counts; no platform key → source none, a reason to show, nothing to buy', async () => {
    const tree: Row[] = [{ id: 'mine', parentId: null, aiKeyEncrypted: 'enc', aiProvider: 'openai' }, { id: 'bare', parentId: null }];
    const { prisma } = makePrisma(tree, []);
    const svc = new AiAllowanceService(prisma);
    expect(await svc.operatorView('mine')).toMatchObject({
      source: 'tenant', unlimited: true, boardsLeft: null, boardsIncluded: null, purchaseEnabled: false, reasonCode: 'OWN_KEY',
    });
    delete process.env.OPENAI_API_KEY;
    expect(await svc.operatorView('bare')).toMatchObject({
      source: 'none', unlimited: false, boardsLeft: null, purchaseEnabled: false, reasonCode: 'NO_PLATFORM_KEY',
      reason: 'AI runs on your own key — add it in Settings → AI provider.',
    });
  });

  it('boardCostTrailing: every pipeline dollar ÷ the boards it produced, per organisation (null with none drawn)', async () => {
    const { prisma, events } = makePrisma(TREE, SCREENS);
    events.push(ev('district', 'designer', new Date(), 'platform', 170_000), ev('district', 'designer', new Date(), 'platform', 170_000));
    events.push(ev('district', 'designer-review', new Date(), 'platform', 30_000), ev('district', 'designer-review-revise', new Date(), 'platform', 170_000));
    events.push(ev('district', 'designer-brief', new Date(), 'platform', 10_000));
    events.push(ev('solo', 'designer-review', new Date(), 'platform', 30_000)); // a critique, no board: no per-board cost
    const cost = await new AiAllowanceService(prisma).boardCostTrailing();
    expect(cost.get('district')).toEqual({ cogsMicros: 550_000, boards: 2, usdPerBoard: 0.28 });
    expect(cost.get('solo')).toEqual({ cogsMicros: 30_000, boards: 0, usdPerBoard: null });
  });
});

describe('AiUsageMeterService', () => {
  it('writes one row with the dollar cost at the serving model, stamped with the org', async () => {
    const { prisma, events } = makePrisma(TREE, SCREENS);
    const meter = new AiUsageMeterService(prisma, new AiAllowanceService(prisma));
    const micros = await meter.record({
      tenantId: 'school-a', provider: 'openai', model: 'gpt-5.6-luna', source: 'tenant', feature: 'concierge',
      usage: { inputTokens: 3_000, outputTokens: 500 }, durationMs: 1234,
    });
    expect(micros).toBe(3_000 * 0.2 + 500 * 1.2);
    expect(events[0]).toMatchObject({
      tenantId: 'school-a', orgTenantId: 'district', provider: 'openai', model: 'gpt-5.6-luna', source: 'tenant',
      feature: 'concierge', inputTokens: 3_000, outputTokens: 500, costMicros: 1_200, durationMs: 1234,
    });
  });

  it('no usage reported → no row (nothing billable)', async () => {
    const { prisma, events } = makePrisma(TREE, SCREENS);
    const meter = new AiUsageMeterService(prisma, new AiAllowanceService(prisma));
    expect(await meter.record({ tenantId: 'solo', provider: 'anthropic', model: 'claude-haiku-4-5', source: 'platform', feature: 'x', usage: undefined })).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('a ledger write failure is swallowed — never fails a generation the provider already billed', async () => {
    const { prisma } = makePrisma(TREE, SCREENS);
    prisma.client.aiUsageEvent.create = jest.fn(async () => {
      throw new Error('db down');
    });
    const meter = new AiUsageMeterService(prisma, new AiAllowanceService(prisma));
    await expect(
      meter.record({ tenantId: 'solo', provider: 'anthropic', model: 'claude-haiku-4-5', source: 'platform', feature: 'x', usage: { inputTokens: 1, outputTokens: 1 } }),
    ).resolves.toBe(0);
  });
});
