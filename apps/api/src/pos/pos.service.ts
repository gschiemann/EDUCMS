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
 *
 * 2026-05-25 — Square wired end-to-end (OAuth + catalog poll +
 * webhook + idempotency + audit). See providers/square.ts.
 */
import { Injectable, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { POS_PROVIDERS, getPosProvider, type PosConnectionDto } from '@cms/api-types';
import { sealCredentials, openCredentials } from '../streaming/creds-cipher';
import {
  squareFetchCatalog,
  squareRefreshAccessToken,
  type CatalogSnapshot,
} from './providers/square';

@Injectable()
export class PosService {
  private readonly logger = new Logger(PosService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Catalog ──────────────────────────────────────────────────────
  listProviders() {
    return POS_PROVIDERS.map((p) => ({
      id: p.id,
      name: p.name,
      scope: p.scope,
      integrationTier: p.integrationTier,
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
      tierReason: p.tierReason,
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
    if (provider.integrationTier === 'CLOSED') {
      throw new ForbiddenException(
        `${provider.name} does not have a public API for third-party CMS integration. ${provider.tierReason || ''}`,
      );
    }
    // 2026-05-28 audit P1-6: reject PARTNER-tier connect attempts at the
    // API boundary. No PARTNER POS provider has a live sync handler yet
    // (Toast / Clover / Lightspeed / Shopify / Stripe-catalog / MINDBODY)
    // — `triggerSync` would return "not yet implemented" forever. The UI
    // already shows an honest "connector in development" panel with no
    // Connect button, but double-check here so a curl/Postman call can't
    // create a dead PENDING row that pollutes the connections list and
    // looks ready-but-never-syncs. Drop a provider to DIRECT (and ship
    // its `providers/<id>.ts` handler) to re-enable self-serve connect.
    if (provider.integrationTier === 'PARTNER') {
      throw new ForbiddenException(
        `${provider.name} is a partner integration that isn't live yet. ${provider.tierReason || 'Contact sales for activation.'}`,
      );
    }
    // Per-provider auth-shape validation (minimal — handlers do deeper validation).
    const creds = opts.credentials || {};
    // Cycle-2 BUG-003 fix (2026-05-03) — reject oauth2 connect attempts
    // server-side. Frontend already disables the Connect button, but
    // double-check at the API boundary so a curl/Postman call cannot
    // create empty PENDING rows that pollute the connections list.
    //
    // 2026-05-25: Square OAuth is now wired (see pos-oauth.controller.ts).
    // Square connections are created via the OAuth callback path, not via
    // this generic credential-bag endpoint — so the oauth2 guard stays.
    if (provider.auth === 'oauth2') {
      throw new BadRequestException(
        opts.providerId === 'square'
          ? 'Use the Connect-with-Square button — Square uses OAuth, not direct credentials.'
          : 'OAuth flow not yet implemented for this provider. Contact sales for activation.',
      );
    }
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

  async deleteConnection(tenantId: string, id: string, actorUserId?: string | null) {
    const conn = await (this.prisma.client as any).posProviderConnection.findFirst({
      where: { id, tenantId },
    });
    if (!conn) throw new NotFoundException('POS connection not found.');
    // 2026-05-23 launch audit P1: same secret-purge class as streaming
    // connections — encrypted POS OAuth credentials. Audit-log the
    // delete in the same transaction so partial state is impossible.
    await this.prisma.client.$transaction(async (tx: any) => {
      await tx.posProviderConnection.delete({ where: { id: conn.id } });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: actorUserId ?? null,
          action: 'POS_CONNECTION_DELETED',
          targetType: 'PosProviderConnection',
          targetId: id,
          details: JSON.stringify({
            providerId: conn.providerId,
            displayName: conn.displayName,
          }),
        },
      });
    });
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

  /** Distinct categories with item counts — drives the PosCategoryPicker
   *  in the template editor so an admin can scope a menu board to e.g.
   *  "Burgers" or "On Tap" instead of dumping every item from every
   *  category onto a single screen.
   *
   *  Sprint 8d follow-up (2026-05-03). Built when the picker landed in
   *  PropertiesPanel — without this endpoint the picker silently fell
   *  back to the "no categories" empty state. */
  async listCategories(tenantId: string) {
    const rows = await (this.prisma.client as any).posMenuItem.groupBy({
      by: ['category'],
      where: { tenantId, available: true },
      _count: { _all: true },
    });
    return rows
      .filter((r: any) => r.category)
      .map((r: any) => ({
        // Use the category name as both id + name — POS providers don't
        // expose stable category ids consistently, and operators pick by
        // human-readable name in the picker anyway.
        id: r.category as string,
        name: r.category as string,
        itemCount: r._count?._all ?? 0,
      }))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
  }

  /** Provider-aware sync runner. Square has a real handler (2026-05-25);
   *  every other provider still returns the friendly "not yet
   *  implemented" status until its handler lands. */
  async triggerSync(tenantId: string, id: string, actorUserId?: string | null) {
    const conn = await (this.prisma.client as any).posProviderConnection.findFirst({
      where: { id, tenantId },
    });
    if (!conn) throw new NotFoundException('POS connection not found.');

    if (conn.providerId === 'square') {
      return this.syncSquare(tenantId, conn, actorUserId ?? null);
    }

    return {
      status: 'pending',
      message: `Sync handler for ${getPosProvider(conn.providerId)?.name || conn.providerId} is not yet implemented. Catalog auto-syncs run nightly once the per-provider handler ships.`,
    };
  }

  /**
   * Persist a Square OAuth result as a PosProviderConnection. Called by
   * PosOAuthController after the callback succeeds. Bypasses the
   * `auth === 'oauth2'` guard in `createConnection` because we control
   * the credential shape end-to-end — this is the trusted server-side
   * path, not a user-supplied creds blob.
   */
  async upsertSquareConnection(opts: {
    tenantId: string;
    userId: string;
    displayName?: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
    merchantId: string;
    scope: string[];
  }) {
    const provider = getPosProvider('square');
    if (!provider) throw new BadRequestException('Square provider missing from catalog');
    const creds = {
      accessToken: opts.accessToken,
      refreshToken: opts.refreshToken,
      merchantId: opts.merchantId,
    };
    const sealed = sealCredentials(creds);
    const expiresAt = opts.expiresAt ? new Date(opts.expiresAt) : null;
    const scope = opts.scope?.join(' ') || null;

    // Same row per (tenant, square) so re-authorize updates in place.
    const existing = await (this.prisma.client as any).posProviderConnection.findFirst({
      where: { tenantId: opts.tenantId, providerId: 'square' },
    });
    if (existing) {
      const updated = await (this.prisma.client as any).posProviderConnection.update({
        where: { id: existing.id },
        data: {
          displayName: opts.displayName ?? existing.displayName,
          encryptedCreds: sealed.encryptedCreds,
          encryptedDataKey: sealed.encryptedDataKey,
          status: 'ACTIVE',
          statusReason: null,
          expiresAt,
          scope,
        },
      });
      await this.audit(opts.tenantId, opts.userId, 'POS_CONNECTION_REAUTH', updated.id, {
        providerId: 'square',
        merchantId: opts.merchantId,
      });
      return updated;
    }

    const created = await (this.prisma.client as any).posProviderConnection.create({
      data: {
        tenantId: opts.tenantId,
        providerId: 'square',
        displayName: opts.displayName,
        encryptedCreds: sealed.encryptedCreds,
        encryptedDataKey: sealed.encryptedDataKey,
        status: 'ACTIVE',
        expiresAt,
        scope,
        createdByUserId: opts.userId,
      },
    });
    await this.audit(opts.tenantId, opts.userId, 'POS_CONNECTION_CREATED', created.id, {
      providerId: 'square',
      merchantId: opts.merchantId,
    });
    return created;
  }

  /**
   * Fetch the merchant's Square catalog and upsert into PosMenuItem /
   * PosCategory rows. Called by the sync cron + the manual "Sync now"
   * button + the webhook receiver (when a catalog event arrives).
   *
   * Refreshes the OAuth token transparently if it's within 1h of
   * expiry. Persists the refreshed token back to the connection.
   */
  async syncSquare(
    tenantId: string,
    conn: any,
    actorUserId: string | null,
  ): Promise<{ status: 'ok' | 'error'; itemCount: number; categoryCount: number; message: string }> {
    let creds: Record<string, any>;
    try {
      creds = openCredentials({
        encryptedCreds: conn.encryptedCreds,
        encryptedDataKey: conn.encryptedDataKey,
      });
    } catch (err: any) {
      const msg = `Decrypt failed: ${err?.message || err}`;
      await this.markConnectionError(conn.id, msg);
      return { status: 'error', itemCount: 0, categoryCount: 0, message: msg };
    }

    let accessToken = String(creds.accessToken || '');
    let refreshToken = String(creds.refreshToken || '');

    // Refresh proactively if we're within 1h of expiry. Square access
    // tokens currently last 30 days, refresh tokens 90 days.
    const expiresAtMs = conn.expiresAt ? new Date(conn.expiresAt).getTime() : 0;
    const refreshWindowMs = 60 * 60 * 1000;
    if (expiresAtMs && expiresAtMs - Date.now() < refreshWindowMs && refreshToken) {
      try {
        const refreshed = await squareRefreshAccessToken(refreshToken);
        accessToken = refreshed.accessToken;
        refreshToken = refreshed.refreshToken;
        const newCreds = {
          accessToken,
          refreshToken,
          merchantId: refreshed.merchantId || creds.merchantId,
        };
        const sealed = sealCredentials(newCreds);
        await (this.prisma.client as any).posProviderConnection.update({
          where: { id: conn.id },
          data: {
            encryptedCreds: sealed.encryptedCreds,
            encryptedDataKey: sealed.encryptedDataKey,
            expiresAt: refreshed.expiresAt ? new Date(refreshed.expiresAt) : null,
          },
        });
      } catch (err: any) {
        this.logger.warn(`Square token refresh failed for conn=${conn.id}: ${err?.message || err}`);
        // Continue with the old token — it might still be valid.
      }
    }

    let snapshot: CatalogSnapshot;
    try {
      snapshot = await squareFetchCatalog(accessToken);
    } catch (err: any) {
      const msg = `Square catalog fetch failed: ${err?.message || err}`;
      await this.markConnectionError(conn.id, msg);
      return { status: 'error', itemCount: 0, categoryCount: 0, message: msg };
    }

    // Upsert categories first so items can resolve category names cleanly.
    for (const cat of snapshot.categories) {
      await (this.prisma.client as any).posCategory.upsert({
        where: { connectionId_externalId: { connectionId: conn.id, externalId: cat.externalId } },
        update: { name: cat.name, sortOrder: cat.sortOrder, syncedAt: new Date() },
        create: {
          tenantId,
          connectionId: conn.id,
          externalId: cat.externalId,
          name: cat.name,
          sortOrder: cat.sortOrder,
        },
      });
    }

    for (const item of snapshot.items) {
      await (this.prisma.client as any).posMenuItem.upsert({
        where: { connectionId_externalId: { connectionId: conn.id, externalId: item.externalId } },
        update: {
          name: item.name,
          description: item.description ?? null,
          priceCents: item.priceCents,
          category: (item as any).category ?? null,
          available: item.available,
          externalUpdatedAt: item.externalUpdatedAt ?? null,
          syncedAt: new Date(),
        },
        create: {
          tenantId,
          connectionId: conn.id,
          externalId: item.externalId,
          name: item.name,
          description: item.description ?? null,
          priceCents: item.priceCents,
          category: (item as any).category ?? null,
          available: item.available,
          externalUpdatedAt: item.externalUpdatedAt ?? null,
        },
      });
    }

    await (this.prisma.client as any).posProviderConnection.update({
      where: { id: conn.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncItemCount: snapshot.items.length,
        status: 'ACTIVE',
        statusReason: null,
      },
    });

    await this.audit(tenantId, actorUserId, 'POS_SYNC_COMPLETED', conn.id, {
      providerId: 'square',
      itemCount: snapshot.items.length,
      categoryCount: snapshot.categories.length,
    });

    return {
      status: 'ok',
      itemCount: snapshot.items.length,
      categoryCount: snapshot.categories.length,
      message: `Square sync complete: ${snapshot.items.length} items, ${snapshot.categories.length} categories.`,
    };
  }

  /** Persist a sync-failure on the connection so the UI shows a useful
   *  badge instead of silently going stale. */
  private async markConnectionError(id: string, message: string) {
    try {
      await (this.prisma.client as any).posProviderConnection.update({
        where: { id },
        data: { status: 'ERROR', statusReason: message.slice(0, 250) },
      });
    } catch (err: any) {
      this.logger.warn(`markConnectionError failed for ${id}: ${err?.message || err}`);
    }
  }

  /** Lookup helper for the webhook path: Square webhooks arrive with a
   *  merchant id but no tenant context. We walk Square connections and
   *  decrypt — small set (one row per tenant), acceptable overhead. */
  async findConnectionByMerchantId(merchantId: string) {
    const rows = await (this.prisma.client as any).posProviderConnection.findMany({
      where: { providerId: 'square' },
    });
    for (const r of rows) {
      try {
        const creds = openCredentials({
          encryptedCreds: r.encryptedCreds,
          encryptedDataKey: r.encryptedDataKey,
        });
        if (creds.merchantId === merchantId) return r;
      } catch {
        /* skip — corrupt row */
      }
    }
    return null;
  }

  /**
   * Custom-webhook receiver lookup. The `custom-webhook` provider is the
   * "bring your own POS" escape hatch — the operator POSTs their catalog
   * to `/api/v1/pos/webhook/custom-webhook` with the shared
   * `X-Webhook-Secret` they set when they connected. The inbound request
   * carries NO tenant context (and we never trust a client-supplied
   * tenantId), so we resolve the connection — and therefore the tenant —
   * purely from the secret.
   *
   * We walk every `custom-webhook` connection, decrypt its stored
   * `webhookSecret`, and compare in constant time (mirrors how
   * `findConnectionByMerchantId` walks Square rows + how
   * `verifySquareSignature` uses `timingSafeEqual`). The candidate set is
   * tiny — one row per tenant via `@@unique([tenantId, providerId])` — so
   * the linear scan + per-row decrypt is acceptable, and matters less than
   * keeping the compare timing-safe.
   *
   * Returns the matching connection row, or null if no secret matches.
   * A missing/empty secret never matches.
   */
  async findCustomWebhookConnectionBySecret(secret: string | undefined | null) {
    if (!secret) return null;
    const provided = Buffer.from(String(secret), 'utf8');
    const rows = await (this.prisma.client as any).posProviderConnection.findMany({
      where: { providerId: 'custom-webhook' },
    });
    let match: any = null;
    for (const r of rows) {
      let stored: string;
      try {
        const creds = openCredentials({
          encryptedCreds: r.encryptedCreds,
          encryptedDataKey: r.encryptedDataKey,
        });
        stored = String((creds as any).webhookSecret || '');
      } catch {
        continue; // corrupt row — skip
      }
      if (!stored) continue;
      const expected = Buffer.from(stored, 'utf8');
      // timingSafeEqual throws on length mismatch — guard it. We don't
      // early-`return` on the first match so the loop cost is independent
      // of which row matched (defence-in-depth against timing leaks).
      if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
        match = r;
      }
    }
    return match;
  }

  /**
   * Upsert a catalog pushed to the custom-webhook endpoint. The connection
   * (already resolved from the secret) determines the tenant — the caller
   * NEVER passes a client-supplied tenantId. Reuses the same
   * `posMenuItem.upsert` keyed on `connectionId_externalId` that
   * `syncSquare` uses, so pushed items reach the MenuBoardWidget the same
   * way Square's do.
   *
   * Documented payload shape (matches the UI's published spec):
   *   { items: [ { id|externalId, name, priceCents|price, description?,
   *                category?, available?, imageUrl?, salePriceCents?,
   *                badges? }, ... ] }
   *
   * Price may be given as integer cents (`priceCents`) or a major-unit
   * number (`price`, e.g. 7.99 → 799). Items missing a name or id are
   * skipped (counted in `skipped`). High-write hot path during service —
   * no heavy joins, no per-item audit (mirrors the existing POS sync
   * pattern, which audits the sync as a whole, not each row).
   */
  async ingestCustomWebhookCatalog(
    conn: any,
    payload: { items?: unknown },
  ): Promise<{ upserted: number; skipped: number }> {
    const rawItems = Array.isArray((payload as any)?.items) ? (payload as any).items : null;
    if (!rawItems) {
      throw new BadRequestException('Body must be { "items": [ ... ] }.');
    }
    if (rawItems.length > 2000) {
      throw new BadRequestException('Too many items in one push (max 2000). Split into batches.');
    }

    let upserted = 0;
    let skipped = 0;
    for (const raw of rawItems) {
      const item = this.normalizeWebhookItem(raw);
      if (!item) {
        skipped++;
        continue;
      }
      await (this.prisma.client as any).posMenuItem.upsert({
        where: { connectionId_externalId: { connectionId: conn.id, externalId: item.externalId } },
        update: {
          name: item.name,
          description: item.description,
          priceCents: item.priceCents,
          salePriceCents: item.salePriceCents,
          category: item.category,
          imageUrl: item.imageUrl,
          badges: item.badges,
          available: item.available,
          syncedAt: new Date(),
        },
        create: {
          tenantId: conn.tenantId,
          connectionId: conn.id,
          externalId: item.externalId,
          name: item.name,
          description: item.description,
          priceCents: item.priceCents,
          salePriceCents: item.salePriceCents,
          category: item.category,
          imageUrl: item.imageUrl,
          badges: item.badges,
          available: item.available,
        },
      });
      upserted++;
    }

    await (this.prisma.client as any).posProviderConnection.update({
      where: { id: conn.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncItemCount: upserted,
        status: 'ACTIVE',
        statusReason: null,
      },
    });

    return { upserted, skipped };
  }

  /** Coerce one inbound webhook item into our PosMenuItem shape, or null
   *  if it lacks the minimum (a stable id + a name). Tolerant of both
   *  `priceCents` (int) and `price` (major-unit number). */
  private normalizeWebhookItem(raw: any): {
    externalId: string;
    name: string;
    description: string | null;
    priceCents: number;
    salePriceCents: number | null;
    category: string | null;
    imageUrl: string | null;
    badges: string[];
    available: boolean;
  } | null {
    if (!raw || typeof raw !== 'object') return null;
    const externalId = String(raw.externalId ?? raw.id ?? '').trim();
    const name = String(raw.name ?? '').trim();
    if (!externalId || !name) return null;

    const priceCents = this.coercePriceCents(raw.priceCents, raw.price);
    const salePriceCents =
      raw.salePriceCents != null || raw.salePrice != null
        ? this.coercePriceCents(raw.salePriceCents, raw.salePrice)
        : null;

    const badges = Array.isArray(raw.badges)
      ? raw.badges.map((b: unknown) => String(b)).filter(Boolean).slice(0, 12)
      : [];

    return {
      externalId,
      name,
      description: raw.description != null ? String(raw.description) : null,
      priceCents,
      salePriceCents,
      category: raw.category != null ? String(raw.category) : null,
      imageUrl: raw.imageUrl != null ? String(raw.imageUrl) : null,
      badges,
      // Default to available unless explicitly false.
      available: raw.available === false ? false : true,
    };
  }

  /** Accept either integer cents or a major-unit number/string; return a
   *  non-negative integer cent count (0 on anything unparseable). */
  private coercePriceCents(cents: unknown, major: unknown): number {
    if (typeof cents === 'number' && Number.isFinite(cents)) {
      return Math.max(0, Math.round(cents));
    }
    if (typeof cents === 'string' && cents.trim() !== '' && Number.isFinite(Number(cents))) {
      return Math.max(0, Math.round(Number(cents)));
    }
    const m = typeof major === 'string' ? Number(major) : major;
    if (typeof m === 'number' && Number.isFinite(m)) {
      return Math.max(0, Math.round(m * 100));
    }
    return 0;
  }

  /** Webhook idempotency — INSERT into ProcessedPosEvent. Returns true
   *  if this is the first time we've seen the (provider, eventId);
   *  false if it's a duplicate replay. */
  async claimWebhookEvent(providerId: string, eventId: string, eventType: string): Promise<boolean> {
    try {
      await (this.prisma.client as any).processedPosEvent.create({
        data: {
          id: `${providerId}:${eventId}`,
          providerId,
          eventType,
        },
      });
      return true;
    } catch (err: any) {
      // P2002 = unique constraint violation = already processed.
      if (err?.code === 'P2002') return false;
      throw err;
    }
  }

  /** Common audit-log helper for POS lifecycle actions. */
  private async audit(
    tenantId: string,
    userId: string | null,
    action: string,
    targetId: string,
    details: Record<string, unknown>,
  ) {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId,
          action,
          targetType: 'PosProviderConnection',
          targetId,
          details: JSON.stringify(details),
        },
      });
    } catch (err: any) {
      this.logger.warn(`audit ${action} failed: ${err?.message || err}`);
    }
  }
}
