/**
 * Included AI allowance — $ per paired screen, pooled per organisation (2026-09-22).
 */
import { AiAllowanceService, includedMicrosFor, utcMonthWindow } from './ai-allowance.service';
import { AiUsageMeterService } from './ai-usage-meter.service';

type Row = { id: string; parentId: string | null; archivedAt?: Date | null };

function makePrisma(tenants: Row[], screens: Array<{ tenantId: string; pairedAt: Date | null }>) {
  const events: any[] = [];
  const prisma: any = {
    client: {
      tenant: {
        findUnique: jest.fn(async ({ where }: any) => {
          const t = tenants.find((x) => x.id === where.id);
          return t ? { parentId: t.parentId } : null;
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
          _sum: {
            costMicros: events
              .filter((e) => e.orgTenantId === where.orgTenantId && e.source === where.source && e.createdAt >= where.createdAt.gte)
              .reduce((s, e) => s + e.costMicros, 0),
          },
        })),
      },
    },
  };
  return { prisma, events };
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

describe('AiAllowanceService', () => {
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
      tenantId: 'school-b', provider: 'anthropic', model: 'claude-sonnet-5', source: 'platform', feature: 'designer',
      usage: { inputTokens: 10_000, outputTokens: 8_000 },
    });
    // the same work on a tenant's own key — recorded, not counted
    await meter.record({
      tenantId: 'school-a', provider: 'anthropic', model: 'claude-sonnet-5', source: 'tenant', feature: 'designer',
      usage: { inputTokens: 10_000, outputTokens: 8_000 },
    });
    const snap = await allowance.snapshot('school-a');
    expect(snap.usedMicros).toBe(100_000);
    expect(snap.usedCredits).toBe(10);
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
