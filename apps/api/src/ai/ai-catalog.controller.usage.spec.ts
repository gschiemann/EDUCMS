/**
 * GET /api/v1/super/ai/usage — the AI board margin (2026-09-23): pack revenue, boards sold and
 * used, what AI cost us, gross margin, our trailing cost per board. SUPER_ADMIN only, read-only.
 */
import 'reflect-metadata';
import { AppRole } from '@cms/database';
import { ROLES_KEY } from '../auth/roles.decorator';
import { AiCatalogController } from './ai-catalog.controller';

type Ev = { orgTenantId: string; source: string; provider: string; feature: string; costMicros: number };

function build(events: Ev[], packs: Array<{ orgTenantId: string; usdMicros: number; boards: number }>) {
  const groupBy = (rows: any[], by: string[], sum: string[]) => {
    const out = new Map<string, any>();
    for (const r of rows) {
      const k = by.map((b) => r[b]).join('|');
      const g = out.get(k) || { ...Object.fromEntries(by.map((b) => [b, r[b]])), _sum: Object.fromEntries(sum.map((s) => [s, 0])), _count: { _all: 0 } };
      for (const s of sum) g._sum[s] += r[s];
      g._count._all += 1;
      out.set(k, g);
    }
    return [...out.values()];
  };
  const prisma: any = {
    client: {
      aiUsageEvent: {
        groupBy: jest.fn(async ({ by, where }: any) => {
          let rows = events;
          if (where.source) rows = rows.filter((e) => e.source === where.source);
          if (where.feature?.in) rows = rows.filter((e) => where.feature.in.includes(e.feature));
          return groupBy(rows, by, ['costMicros']);
        }),
      },
      aiCreditPurchase: { groupBy: jest.fn(async ({ by }: any) => groupBy(packs, by, ['usdMicros', 'boards'])) },
      tenant: { findMany: jest.fn(async ({ where }: any) => where.id.in.map((id: string) => ({ id, name: `Name of ${id}` }))) },
    },
  };
  const allowance: any = {
    snapshot: jest.fn(async (org: string) => ({ screens: org === 'org_A' ? 4 : 0, includedMicros: org === 'org_A' ? 8_000_000 : 5_000_000 })),
    boardCostTrailing: jest.fn(async () => new Map([
      ['org_A', { cogsMicros: 1_120_000, boards: 5, usdPerBoard: 0.22 }],
      ['org_B', { cogsMicros: 300_000, boards: 1, usdPerBoard: 0.3 }],
    ])),
  };
  return new AiCatalogController({} as any, {} as any, allowance, prisma);
}

describe('GET /super/ai/usage — the AI board margin', () => {
  it('per organisation and in total: pack revenue, boards sold/used, COGS, gross margin, trailing cost per board', async () => {
    const e = (orgTenantId: string, feature: string, costMicros: number, source = 'platform', provider = 'openai'): Ev => ({ orgTenantId, source, provider, feature, costMicros });
    const controller = build(
      [
        e('org_A', 'designer', 170_000), e('org_A', 'designer', 170_000), e('org_A', 'designer-revise', 170_000),
        e('org_A', 'designer-review', 30_000), e('org_A', 'designer-review-revise', 170_000), e('org_A', 'designer-brief', 10_000, 'platform', 'anthropic'),
        e('org_A', 'concierge', 50_000, 'platform', 'anthropic'),
        e('org_A', 'designer', 400_000, 'tenant'), // their own key: shown, never our cost
      ],
      [
        { orgTenantId: 'org_A', usdMicros: 19_000_000, boards: 30 },
        { orgTenantId: 'org_B', usdMicros: 9_000_000, boards: 10 }, // bought, nothing drawn yet — still listed
      ],
    );
    const out = await controller.usage();
    const a = out.orgs.find((o: any) => o.orgTenantId === 'org_A')!;
    expect(a).toMatchObject({
      name: 'Name of org_A',
      platformUsd: 0.77,
      ownKeyUsd: 0.4,
      packRevenueUsd: 19,
      boardsSold: 30,
      boardsUsed: 3, // two candidates + one refine; the critique, the review's revise and the brief are never credits
      cogsUsd: 0.77,
      boardCogsUsd: 0.72,
      grossMarginUsd: 18.23,
      boardCostUsdTrailing: 0.22,
    });
    const b = out.orgs.find((o: any) => o.orgTenantId === 'org_B')!;
    expect(b).toMatchObject({ packRevenueUsd: 9, boardsSold: 10, boardsUsed: 0, cogsUsd: 0, grossMarginUsd: 9, boardCostUsdTrailing: 0.3 });
    expect(out).toMatchObject({
      totalPackRevenueUsd: 28,
      totalBoardsSold: 40,
      totalBoardsUsed: 3,
      totalCogsUsd: 0.77,
      totalGrossMarginUsd: 27.23,
      boardCostUsdTrailing: 0.24, // fleet: $1.42 over 6 boards
    });
  });

  it('stays a SUPER_ADMIN-only controller', () => {
    expect(Reflect.getMetadata(ROLES_KEY, AiCatalogController)).toEqual([AppRole.SUPER_ADMIN]);
  });
});
