/**
 * PosService — provider connections + catalog sync.
 *
 * Sprint 8d (2026-05-03). Tenant-scoped CRUD for POS integrations.
 * Provider-specific catalog sync lives in
 * `apps/api/src/pos/providers/<id>.ts` and is invoked from the
 * cron job (separate file). This service handles connect / disconnect
 * / status, plus exposing the synced PosMenuItem catalog to widgets.
 *
 * MIRRORS streaming.service.ts — same envelope-encryption helper,
 * same per-row data key pattern, same provider-catalog validation.
 */
import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { POS_PROVIDERS, getPosProvider, type PosConnectionDto } from '@cms/api-types';
import { sealCredentials, openCredentials } from '../streaming/creds-cipher';

@Injectable()
export class PosService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Catalog ──────────────────────────────────────────────────────
  listProviders() {
    return POS_PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      scope: p.scope,
      blurb: p.blurb,
      iconEmoji: p.iconEmoji,
      iconUrl: p.iconUrl,
      auth: p.auth,
      docsUrl: p.docsUrl,
      websiteUrl: p.websiteUrl,
      pricingNote: p.pricingNote,
      bestFor: p.bestFor,
      capabilities: p.capabilities,
      salesLedOnly: p.salesLedOnly,
    }));
  }

  // ─── Connections ──────────────────────────────────────────────────
  async listConnections(tenantId: string): Promise<PosConnectionDto[]> {
    const rows = await (this.prisma.client as any).posProviderConnection.findMany({
      where: { tenantId },
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r: any) => ({
      id: r.id,
      providerId: r.providerId,
      providerName: getPosProvider(r.providerId)?.name || r.providerId,
      displayName: r.displayName || undefined,
      status: r.status,
      statusReason: r.statusReason || undefined,
      lastSyncedAt: r.lastSyncedAt?.toISOString(),
      itemCount: r._count?.items ?? 0,
      locationCount: 0, // populated when locationsSync runs
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async createConnection(opts: {
    tenantId: string;
    userId: string;
    providerId: string;
    displayName?: string;
    credentials: Record<string, unknown>;
  }) {
    const provider = getPosProvider(opts.providerId);
    if (!provider) throw new BadRequestException(`Unknown POS provider: ${opts.providerId}`);
    if (provider.salesLedOnly) {
      throw new ForbiddenException(
        `${provider.name} requires sales-led onboarding. Contact sales@venueos.app.`,
      );
    }
    // Per-provider auth-shape validation (minimal — handlers do deeper validation).
    const creds = opts.credentials || {};
    if (provider.auth === 'apiKey' && !(creds as any).apiKey) {
      throw new BadRequestException('apiKey required for this provider.');
    }
    if (provider.auth === 'partnerKey' && !(creds as any).partnerKey) {
      throw new BadRequestException('partnerKey required for this provider.');
    }
    if (provider.auth === 'webhook' && !(creds as any).webhookSecret) {
      throw new BadRequestException('webhookSecret required for custom webhook provider.');
    }
    const sealed = sealCredentials(creds);
    return (this.prisma.client as any).posProviderConnection.create({
      data: {
        tenantId: opts.tenantId,
        providerId: opts.providerId,
        displayName: opts.displayName,
        encryptedCreds: sealed.encryptedCreds,
        encryptedDataKey: sealed.encryptedDataKey,
        status: 'PENDING',  // becomes ACTIVE after first successful sync
        createdByUserId: opts.userId,
      },
    });
  }

  async deleteConnection(tenantId: string, id: string) {
    const conn = await (this.prisma.client as any).posProviderConnection.findFirst({
      where: { id, tenantId },
    });
    if (!conn) throw new NotFoundException('POS connection not found.');
    await (this.prisma.client as any).posProviderConnection.delete({ where: { id: conn.id } });
  }

  async decryptCredentials(tenantId: string, id: string): Promise<Record<string, unknown>> {
    const conn = await (this.prisma.client as any).posProviderConnection.findFirst({
      where: { id, tenantId },
    });
    if (!conn) throw new NotFoundException('POS connection not found.');
    return openCredentials({
      encryptedCreds: conn.encryptedCreds,
      encryptedDataKey: conn.encryptedDataKey,
    });
  }

  // ─── Catalog read ─────────────────────────────────────────────────

  /** Live menu items for a tenant — used by the menu-board widget. */
  async listMenuItems(tenantId: string, opts?: { connectionId?: string; category?: string; locationId?: string }) {
    const where: any = { tenantId, available: true };
    if (opts?.connectionId) where.connectionId = opts.connectionId;
    if (opts?.category) where.category = opts.category;
    if (opts?.locationId) where.locationId = opts.locationId;
    const rows = await (this.prisma.client as any).posMenuItem.findMany({
      where,
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      take: 200,
    });
    return rows.map((r: any) => ({
      id: r.id,
      externalId: r.externalId,
      name: r.name,
      description: r.description || undefined,
      priceCents: r.priceCents,
      salePriceCents: r.salePriceCents || undefined,
      category: r.category || undefined,
      imageUrl: r.imageUrl || undefined,
      badges: r.badges || [],
      available: r.available,
      updatedAt: r.syncedAt.toISOString(),
    }));
  }

  /** Stub for the per-provider sync runner. Wired-up handlers land
   *  in a future commit (one file per provider in
   *  `apps/api/src/pos/providers/`). For now this returns a pending
   *  status so the UI can show "Sync queued — provider integration
   *  not yet implemented." */
  async triggerSync(tenantId: string, id: string) {
    const conn = await (this.prisma.client as any).posProviderConnection.findFirst({
      where: { id, tenantId },
    });
    if (!conn) throw new NotFoundException('POS connection not found.');
    return {
      status: 'pending',
      message: `Sync handler for ${getPosProvider(conn.providerId)?.name || conn.providerId} is not yet implemented. Catalog auto-syncs run nightly once the per-provider handler ships.`,
    };
  }
}
