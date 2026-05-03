/**
 * AdsService — ad-network connections + impression logging + earnings.
 *
 * Sprint 8d (2026-05-03). Same per-tenant CRUD + envelope-encryption
 * pattern as streaming and POS. Plus earnings aggregation read paths.
 *
 * Per-network creative-fetch handlers live in
 * `apps/api/src/ads/networks/<id>.ts` and run server-side at impression
 * time (separate commit). This service handles connect / disconnect /
 * earnings / content-controls.
 */
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AD_NETWORKS, getAdNetwork, type AdNetworkConnectionDto, type AdEarningsSummary } from '@cms/api-types';
import { sealCredentials, openCredentials } from '../streaming/creds-cipher';

@Injectable()
export class AdsService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Catalog ──────────────────────────────────────────────────────
  listNetworks() {
    return AD_NETWORKS.map((n) => ({
      id: n.id,
      name: n.name,
      category: n.category,
      blurb: n.blurb,
      iconEmoji: n.iconEmoji,
      iconUrl: n.iconUrl,
      auth: n.auth,
      pricingModel: n.pricingModel,
      typicalCpmCents: n.typicalCpmCents,
      takeRateBps: n.takeRateBps,
      docsUrl: n.docsUrl,
      websiteUrl: n.websiteUrl,
      pricingNote: n.pricingNote,
      bestFor: n.bestFor,
      capabilities: n.capabilities,
      salesLedOnly: n.salesLedOnly,
      k12Forbidden: n.k12Forbidden,
    }));
  }

  // ─── Connections ──────────────────────────────────────────────────
  async listConnections(tenantId: string): Promise<AdNetworkConnectionDto[]> {
    const rows = await (this.prisma.client as any).adNetworkConnection.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r: any) => ({
      id: r.id,
      networkId: r.networkId,
      networkName: getAdNetwork(r.networkId)?.name || r.networkId,
      status: r.status,
      statusReason: r.statusReason || undefined,
      impressionsTotal: r.impressionsTotal ?? 0,
      grossRevenueCents: r.grossRevenueCents ?? 0,
      feeCents: r.feeCents ?? 0,
      createdAt: r.createdAt.toISOString(),
      contentControls: safeJsonParse(r.contentControls, {
        blockedCategories: [],
        dayparts: [],
        pauseDuringEmergency: true,
      }),
    }));
  }

  async createConnection(opts: {
    tenantId: string;
    userId: string;
    tenantVertical: string;
    networkId: string;
    credentials: Record<string, unknown>;
    contentControls?: {
      blockedCategories?: string[];
      dayparts?: Array<{ daysOfWeek: number[]; start: string; end: string }>;
      pauseDuringEmergency?: boolean;
    };
  }) {
    const network = getAdNetwork(opts.networkId);
    if (!network) throw new BadRequestException(`Unknown ad network: ${opts.networkId}`);
    if (network.k12Forbidden && opts.tenantVertical === 'K12') {
      throw new ForbiddenException(
        `${network.name} is not available for K-12 tenants. Schools cannot run third-party advertising.`,
      );
    }
    if (network.salesLedOnly) {
      throw new ForbiddenException(
        `${network.name} requires sales-led onboarding. Contact sales@venueos.app.`,
      );
    }
    const sealed = sealCredentials(opts.credentials || {});
    const controls = {
      blockedCategories: opts.contentControls?.blockedCategories || [],
      dayparts: opts.contentControls?.dayparts || [],
      pauseDuringEmergency: opts.contentControls?.pauseDuringEmergency !== false,
    };
    return (this.prisma.client as any).adNetworkConnection.create({
      data: {
        tenantId: opts.tenantId,
        networkId: opts.networkId,
        encryptedCreds: sealed.encryptedCreds,
        encryptedDataKey: sealed.encryptedDataKey,
        contentControls: JSON.stringify(controls),
        status: 'PENDING',
        createdByUserId: opts.userId,
      },
    });
  }

  async deleteConnection(tenantId: string, id: string) {
    const conn = await (this.prisma.client as any).adNetworkConnection.findFirst({
      where: { id, tenantId },
    });
    if (!conn) throw new NotFoundException('Ad network connection not found.');
    await (this.prisma.client as any).adNetworkConnection.delete({ where: { id: conn.id } });
  }

  async setStatus(tenantId: string, id: string, status: 'ACTIVE' | 'PAUSED') {
    const conn = await (this.prisma.client as any).adNetworkConnection.findFirst({
      where: { id, tenantId },
    });
    if (!conn) throw new NotFoundException('Ad network connection not found.');
    return (this.prisma.client as any).adNetworkConnection.update({
      where: { id: conn.id },
      data: { status },
    });
  }

  async updateContentControls(tenantId: string, id: string, controls: any) {
    const conn = await (this.prisma.client as any).adNetworkConnection.findFirst({
      where: { id, tenantId },
    });
    if (!conn) throw new NotFoundException('Ad network connection not found.');
    return (this.prisma.client as any).adNetworkConnection.update({
      where: { id: conn.id },
      data: { contentControls: JSON.stringify(controls) },
    });
  }

  // ─── Earnings ─────────────────────────────────────────────────────

  /** Dashboard summary card — today / this month / this year. */
  async earningsSummary(tenantId: string): Promise<AdEarningsSummary> {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    // Aggregate from the daily rollup for fast reads (the impression
    // table can have millions of rows for an active venue).
    const rows = await (this.prisma.client as any).adRevenueDaily.findMany({
      where: { tenantId, date: { gte: startOfYear } },
      include: { connection: { select: { networkId: true } } },
    });

    let todayImpressions = 0, todayRevenueCents = 0;
    let monthImpressions = 0, monthRevenueCents = 0;
    let yearImpressions = 0, yearRevenueCents = 0;
    const byNetwork = new Map<string, number>();

    for (const r of rows as any[]) {
      yearImpressions += r.impressions;
      yearRevenueCents += r.grossRevenueCents - r.feeCents;
      if (r.date >= startOfMonth) {
        monthImpressions += r.impressions;
        monthRevenueCents += r.grossRevenueCents - r.feeCents;
      }
      if (r.date >= startOfToday) {
        todayImpressions += r.impressions;
        todayRevenueCents += r.grossRevenueCents - r.feeCents;
      }
      const netId = r.connection?.networkId;
      if (netId) {
        byNetwork.set(netId, (byNetwork.get(netId) || 0) + (r.grossRevenueCents - r.feeCents));
      }
    }

    let topNetwork: { id: string; name: string; revenueCents: number } | undefined;
    for (const [id, rev] of byNetwork.entries()) {
      if (!topNetwork || rev > topNetwork.revenueCents) {
        topNetwork = { id, name: getAdNetwork(id)?.name || id, revenueCents: rev };
      }
    }

    return {
      todayImpressions,
      todayRevenueCents,
      monthImpressions,
      monthRevenueCents,
      yearImpressions,
      yearRevenueCents,
      topNetwork,
    };
  }

  /** Internal helper called by per-network impression handlers (server-side
   *  only). Records one impression and updates running tallies + the
   *  daily aggregate row. */
  async recordImpression(opts: {
    tenantId: string;
    connectionId: string;
    screenId: string;
    externalCreativeId: string;
    externalCampaignId?: string;
    cpmCents: number;
  }) {
    const revenueCents = Math.floor(opts.cpmCents / 1000);
    const conn = await (this.prisma.client as any).adNetworkConnection.findUnique({
      where: { id: opts.connectionId },
    });
    if (!conn) return;
    const takeRateBps = conn.takeRateBps ?? getAdNetwork(conn.networkId)?.takeRateBps ?? 1500;
    const feeCents = Math.floor((revenueCents * takeRateBps) / 10000);

    await (this.prisma.client as any).$transaction([
      (this.prisma.client as any).adImpression.create({
        data: {
          tenantId: opts.tenantId,
          connectionId: opts.connectionId,
          screenId: opts.screenId,
          externalCreativeId: opts.externalCreativeId,
          externalCampaignId: opts.externalCampaignId,
          cpmCents: opts.cpmCents,
          revenueCents,
        },
      }),
      (this.prisma.client as any).adNetworkConnection.update({
        where: { id: opts.connectionId },
        data: {
          impressionsTotal: { increment: 1 },
          grossRevenueCents: { increment: revenueCents },
          feeCents: { increment: feeCents },
        },
      }),
    ]);
  }
}

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
