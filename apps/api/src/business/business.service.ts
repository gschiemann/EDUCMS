import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PlatformCost } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { CapacityWatchService } from '../capacity/capacity-watch.service';
import { invoiceIsOverdue } from '../customers/customer-console.policy';
import {
  contractRevenue,
  organisationRoots,
  parseCostInput,
} from './business.policy';

export interface BusinessActor {
  userId: string;
  tenantId: string;
}
export interface BusinessRecommendation {
  id: string;
  tone: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  href?: string;
  /** Stable keys let the dashboard translate recommendations without trusting server prose. */
  kind:
    | 'costs'
    | 'pricing'
    | 'collections'
    | 'budget'
    | 'stale_cost'
    | 'capacity'
    | 'capacity_unavailable';
  values?: Record<string, string | number>;
}

const costView = (cost: PlatformCost) => ({
  ...cost,
  nextBillAt: cost.nextBillAt?.toISOString() ?? null,
  observedAt: cost.observedAt.toISOString(),
  createdAt: cost.createdAt.toISOString(),
  updatedAt: cost.updatedAt.toISOString(),
});

@Injectable()
export class BusinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capacity: CapacityWatchService,
  ) {}

  async report(now = new Date()) {
    const [tenants, invoices, costs, capacity] = await Promise.all([
      this.prisma.client.tenant.findMany({
        select: {
          id: true,
          parentId: true,
          slug: true,
          archivedAt: true,
          license: {
            select: {
              tier: true,
              status: true,
              billingMode: true,
              seatLimit: true,
              monthlyPriceCents: true,
              packagePriceCents: true,
              pooledSeats: true,
              trialEndsAt: true,
            },
          },
        },
      }),
      this.prisma.client.customerInvoice.findMany({
        where: { status: { in: ['SENT', 'PAST_DUE'] }, currency: 'usd' },
        select: {
          tenantId: true,
          amountCents: true,
          status: true,
          dueAt: true,
        },
      }),
      this.prisma.client.platformCost.findMany({
        orderBy: [{ active: 'desc' }, { provider: 'asc' }, { service: 'asc' }],
      }),
      this.capacity.getReport().catch(() => null),
    ]);
    const revenue = contractRevenue(tenants, now);
    const roots = organisationRoots(tenants);
    let openCents = 0;
    let overdueCents = 0;
    for (const invoice of invoices) {
      if (!roots.get(invoice.tenantId)) continue;
      openCents += invoice.amountCents;
      if (invoiceIsOverdue(invoice, now)) overdueCents += invoice.amountCents;
    }
    const activeCosts = costs.filter((cost) => cost.active);
    const monthlyCostCents = activeCosts.reduce(
      (sum, cost) => sum + cost.monthlyCostCents,
      0,
    );
    const estimatedMonthlyProfitCents =
      revenue.committedMonthlyCents - monthlyCostCents;
    const recommendations: BusinessRecommendation[] = [];
    if (!activeCosts.length)
      recommendations.push({
        id: 'record-costs',
        kind: 'costs',
        tone: 'warning',
        title: 'Record your infrastructure costs',
        detail:
          'Add provider bills and other recurring costs before relying on the profit estimate.',
      });
    if (revenue.unpricedCustomers)
      recommendations.push({
        id: 'unpriced-contracts',
        kind: 'pricing',
        tone: 'warning',
        title: 'Complete customer pricing',
        detail: `${revenue.unpricedCustomers} active contract(s) have no recorded price and are excluded from revenue.`,
        href: '/super/customers',
        values: { count: revenue.unpricedCustomers },
      });
    if (overdueCents)
      recommendations.push({
        id: 'collect-invoices',
        kind: 'collections',
        tone: 'warning',
        title: 'Follow up on overdue invoices',
        detail:
          'Outstanding invoices affect cash flow. Review due dates and record payments.',
        href: '/super/invoices',
      });
    for (const cost of activeCosts) {
      if (cost.budgetCents !== null && cost.monthlyCostCents > cost.budgetCents)
        recommendations.push({
          id: `budget-${cost.id}`,
          kind: 'budget',
          tone: 'warning',
          title: `${cost.provider}: over recorded budget`,
          detail:
            'Compare the provider bill with usage before changing the plan.',
          values: { provider: cost.provider, service: cost.service },
        });
      if (now.getTime() - cost.observedAt.getTime() > 35 * 86400_000)
        recommendations.push({
          id: `stale-${cost.id}`,
          kind: 'stale_cost',
          tone: 'info',
          title: `${cost.provider}: refresh the cost`,
          detail: 'This cost has not been confirmed in more than 35 days.',
          values: { provider: cost.provider, service: cost.service },
        });
    }
    if (!capacity || !capacity.metrics.length)
      recommendations.push({
        id: 'capacity-unavailable',
        kind: 'capacity_unavailable',
        tone: 'warning',
        title: 'Capacity evidence unavailable',
        detail: 'Check platform health before making infrastructure decisions.',
        href: '/super/efficiency',
      });
    else
      for (const metric of capacity.metrics) {
        if (
          metric.level !== 'ok' ||
          (metric.daysToLimit !== null && metric.daysToLimit <= 30)
        )
          recommendations.push({
            id: `capacity-${metric.key}`,
            kind: 'capacity',
            tone: metric.level === 'critical' ? 'critical' : 'warning',
            title: metric.label,
            detail: metric.action,
            href: '/super/efficiency',
            values: { metric: metric.key },
          });
      }
    return {
      asOf: now.toISOString(),
      revenue,
      receivables: { openCents, overdueCents },
      costs: costs.map(costView),
      profit: {
        monthlyCostCents,
        estimatedMonthlyProfitCents,
        marginPercent:
          revenue.committedMonthlyCents > 0
            ? Math.round(
                (estimatedMonthlyProfitCents / revenue.committedMonthlyCents) *
                  1000,
              ) / 10
            : null,
        coverage: 'partial' as const,
      },
      recommendations,
    };
  }

  async createCost(body: unknown, actor: BusinessActor, now = new Date()) {
    const input = parseCostInput(body);
    return this.prisma.client.$transaction(async (tx) => {
      const cost = await tx.platformCost.create({
        data: {
          provider: input.provider!,
          service: input.service!,
          monthlyCostCents: input.monthlyCostCents!,
          planName: input.planName,
          budgetCents: input.budgetCents,
          nextBillAt: input.nextBillAt,
          notes: input.notes,
          observedAt: now,
        },
      });
      await this.audit(tx, actor, 'BUSINESS_COST_CREATED', cost.id, null, cost);
      return costView(cost);
    });
  }

  async updateCost(
    id: string,
    body: unknown,
    actor: BusinessActor,
    now = new Date(),
  ) {
    const input = parseCostInput(body, true);
    return this.prisma.client.$transaction(async (tx) => {
      const before = await tx.platformCost.findUnique({ where: { id } });
      if (!before)
        throw new NotFoundException({
          code: 'BUSINESS_COST_NOT_FOUND',
          message: 'Cost record not found.',
        });
      const cost = await tx.platformCost.update({
        where: { id },
        data: { ...input, observedAt: now, source: 'MANUAL' },
      });
      await this.audit(
        tx,
        actor,
        'BUSINESS_COST_UPDATED',
        cost.id,
        before,
        cost,
      );
      return costView(cost);
    });
  }

  private async audit(
    tx: Prisma.TransactionClient,
    actor: BusinessActor,
    action: string,
    id: string,
    before: PlatformCost | null,
    after: PlatformCost,
  ) {
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        action,
        targetType: 'PlatformCost',
        targetId: id,
        details: JSON.stringify({ before, after }),
      },
    });
  }
}
