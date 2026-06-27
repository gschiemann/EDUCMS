/**
 * SampleDataService — programmatic sample-data seeder.
 *
 * Extracted from SampleDataController so the same seeding logic can be
 * invoked by OnboardingService at signup time (auto-seed for new tenants)
 * AND by the manual ADMIN endpoint in SampleDataController.
 *
 * Key design decisions:
 *   - Idempotent: checks whether any POS/streaming connections already
 *     exist for the tenant before inserting; skip silently if found.
 *   - Vertical-aware: seeds the data that makes sense for the tenant's
 *     industry (restaurant menus for QSR/RESTAURANT/BAR, retail SKUs for
 *     RETAIL/FASHION, public broadcaster streams for GYM/SPORTS/K12/etc.).
 *   - Non-blocking: errors are swallowed + logged so a seeder failure
 *     never prevents a new signup from completing.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StreamingService } from '../streaming/streaming.service';
import { PosService } from '../pos/pos.service';
import { AdsService } from '../ads/ads.service';
import { PUBLIC_BROADCASTER_CHANNELS, presetEmbedUrl } from '@cms/api-types';

const SAMPLE_TAG = '[Sample]';

/** Verticals that benefit from a pre-seeded restaurant/bar menu catalog. */
const MENU_VERTICALS = new Set(['QSR', 'RESTAURANT', 'BAR']);

/** Verticals that benefit from a pre-seeded retail SKU catalog. */
const RETAIL_VERTICALS = new Set(['RETAIL', 'FASHION']);

/**
 * Verticals that benefit from live public-broadcaster streams (news /
 * weather feeds for lobbies, waiting rooms, fellowship halls, etc.).
 * 2026-06-27 — added WORSHIP (was absent per the per-vertical beta
 * finding): a church lobby / welcome-center screen benefits from the
 * same passive news/weather feed as a corporate lobby or clinic waiting
 * room, so a fresh worship tenant now seeds these channels too.
 */
const STREAM_VERTICALS = new Set(['GYM', 'K12', 'SPORTS', 'CORPORATE', 'HEALTHCARE', 'HOSPITALITY', 'WORSHIP']);

@Injectable()
export class SampleDataService {
  private readonly logger = new Logger(SampleDataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly streaming: StreamingService,
    private readonly pos: PosService,
    private readonly ads: AdsService,
  ) {}

  /**
   * Auto-seed vertical-appropriate sample data for a brand-new tenant.
   *
   * Called by OnboardingService.signup() immediately after the tenant row
   * is committed. The idempotency guard (count of existing connections)
   * means re-running has no effect — but in practice signup() never runs
   * twice for the same tenant (the slug+email uniqueness check fires first).
   *
   * @param tenantId  Newly created tenant id.
   * @param userId    DISTRICT_ADMIN user id (for audit log on connections).
   * @param vertical  Tenant vertical string (K12 | QSR | RETAIL | FASHION…).
   */
  async seedForNewTenant(tenantId: string, userId: string, vertical: string): Promise<void> {
    try {
      // Belt-and-suspenders idempotency guard: if ANY pos or streaming
      // connection already exists for this tenant, skip entirely.
      // This prevents double-seeding if the method is ever called twice
      // (e.g. a retry after a transient error).
      const [posCount, streamCount] = await Promise.all([
        (this.prisma.client as any).posProviderConnection
          .count({ where: { tenantId } })
          .catch(() => 0),
        (this.prisma.client as any).streamProviderConnection
          .count({ where: { tenantId } })
          .catch(() => 0),
      ]);
      if (posCount > 0 || streamCount > 0) {
        this.logger.log(`seedForNewTenant(${tenantId}): connections already exist — skipping.`);
        return;
      }

      const v = (vertical || 'K12').toUpperCase();
      const tasks: Promise<void>[] = [];

      if (MENU_VERTICALS.has(v)) {
        tasks.push(this._seedRestaurantPos(tenantId, userId));
      }
      if (RETAIL_VERTICALS.has(v)) {
        tasks.push(this._seedRetailPos(tenantId, userId));
      }
      if (STREAM_VERTICALS.has(v)) {
        tasks.push(this._seedPublicBroadcasters(tenantId, userId));
      }
      // House-only ads for every vertical — no OAuth required, zero-config.
      tasks.push(this._seedHouseAds(tenantId, userId, v));

      await Promise.allSettled(tasks);
      this.logger.log(`seedForNewTenant(${tenantId}, ${v}): done.`);
    } catch (err: any) {
      // Non-fatal — signup already succeeded; log and move on.
      this.logger.warn(`seedForNewTenant(${tenantId}) failed (non-fatal): ${err?.message}`);
    }
  }

  // ─── Private helpers — one per data type ────────────────────────────

  private async _seedRestaurantPos(tenantId: string, userId: string): Promise<void> {
    const displayName = `${SAMPLE_TAG} Restaurant Webhook`;
    let conn = await (this.prisma.client as any).posProviderConnection.findFirst({
      where: { tenantId, displayName },
    });
    if (!conn) {
      try {
        conn = await this.pos.createConnection({
          tenantId,
          userId,
          providerId: 'custom-webhook',
          displayName,
          credentials: { webhookSecret: 'sample-' + Math.random().toString(36).slice(2) },
        });
      } catch {
        return; // unique-constraint race or table-absent — skip silently
      }
    }
    const items = [
      { externalId: 'b1', name: 'Classic Burger',     priceCents: 1295, category: 'Burgers', description: 'Lettuce, tomato, onion, house sauce' },
      { externalId: 'b2', name: 'Bacon Cheddar',      priceCents: 1495, category: 'Burgers', description: 'Smoked bacon + sharp cheddar' },
      { externalId: 'b3', name: 'Mushroom Swiss',     priceCents: 1395, category: 'Burgers', description: 'Sautéed cremini + Swiss' },
      { externalId: 'b4', name: 'Western',            priceCents: 1495, category: 'Burgers', description: 'Onion ring + BBQ + cheddar' },
      { externalId: 'b5', name: 'Veggie Burger',      priceCents: 1295, category: 'Burgers', description: 'Black bean patty', badges: ['V'] },
      { externalId: 'b6', name: 'Double Stack',       priceCents: 1695, category: 'Burgers', description: 'Two patties, two cheeses' },
      { externalId: 's1', name: 'Fries',              priceCents: 495,  category: 'Sides',   description: 'Hand-cut, sea salt' },
      { externalId: 's2', name: 'Sweet Potato Fries', priceCents: 595,  category: 'Sides',   description: 'Cinnamon-sugar option' },
      { externalId: 's3', name: 'Onion Rings',        priceCents: 595,  category: 'Sides',   description: 'Beer-battered' },
      { externalId: 's4', name: 'Side Salad',         priceCents: 495,  category: 'Sides',   description: 'Mixed greens', badges: ['V', 'GF'] },
      { externalId: 'd1', name: 'Soda',               priceCents: 295,  category: 'Drinks',  description: 'Free refills' },
      { externalId: 'd2', name: 'Iced Tea',           priceCents: 295,  category: 'Drinks',  description: 'Sweet or unsweet' },
      { externalId: 'd3', name: 'Lemonade',           priceCents: 395,  category: 'Drinks',  description: 'House-squeezed' },
      { externalId: 'd4', name: 'Milkshake',          priceCents: 595,  category: 'Drinks',  description: 'Vanilla / chocolate / strawberry' },
      { externalId: 'des1', name: 'Brownie Sundae',   priceCents: 695, category: 'Desserts', description: 'Hot fudge, vanilla bean' },
      { externalId: 'des2', name: 'Apple Pie',        priceCents: 595, category: 'Desserts', description: 'House-baked, à la mode' },
    ];
    let added = 0;
    for (const it of items) {
      try {
        await (this.prisma.client as any).posMenuItem.create({
          data: {
            tenantId,
            connectionId: conn.id,
            externalId: it.externalId,
            name: it.name,
            description: it.description,
            priceCents: it.priceCents,
            category: it.category,
            badges: (it as any).badges || [],
            available: true,
            externalUpdatedAt: new Date(),
          },
        });
        added += 1;
      } catch { /* duplicate or missing table — skip */ }
    }
    if (added > 0) {
      await (this.prisma.client as any).posProviderConnection.update({
        where: { id: conn.id },
        data: { status: 'ACTIVE', lastSyncedAt: new Date(), lastSyncItemCount: added },
      }).catch(() => {});
    }
    this.logger.log(`seedRestaurantPos(${tenantId}): ${added} items.`);
  }

  private async _seedRetailPos(tenantId: string, userId: string): Promise<void> {
    const displayName = `${SAMPLE_TAG} Retail Webhook`;
    let conn = await (this.prisma.client as any).posProviderConnection.findFirst({
      where: { tenantId, displayName },
    });
    if (!conn) {
      try {
        conn = await this.pos.createConnection({
          tenantId,
          userId,
          providerId: 'custom-webhook',
          displayName,
          credentials: { webhookSecret: 'sample-' + Math.random().toString(36).slice(2) },
        });
      } catch {
        return;
      }
    }
    const items = [
      { externalId: 'r1',  name: 'Classic Tee',       priceCents: 2495, salePriceCents: 1495, category: 'Apparel' },
      { externalId: 'r2',  name: 'Oversized Hoodie',  priceCents: 5995, category: 'Apparel' },
      { externalId: 'r3',  name: 'Denim Jacket',      priceCents: 8995, category: 'Apparel' },
      { externalId: 'r4',  name: 'Linen Shirt',       priceCents: 4995, salePriceCents: 2995, category: 'Apparel' },
      { externalId: 'r5',  name: 'Wool Sweater',      priceCents: 7995, category: 'Apparel' },
      { externalId: 'r6',  name: 'Track Pants',       priceCents: 4495, category: 'Apparel' },
      { externalId: 'r7',  name: 'Court Sneakers',    priceCents: 9995, category: 'Footwear' },
      { externalId: 'r8',  name: 'Hiking Boots',      priceCents: 14995, category: 'Footwear' },
      { externalId: 'r9',  name: 'Sandals',           priceCents: 5995, salePriceCents: 3995, category: 'Footwear' },
      { externalId: 'r10', name: 'Running Shoes',     priceCents: 12995, category: 'Footwear' },
      { externalId: 'r13', name: 'Leather Belt',      priceCents: 4995, category: 'Accessories' },
      { externalId: 'r14', name: 'Wool Scarf',        priceCents: 3495, category: 'Accessories' },
      { externalId: 'r15', name: 'Canvas Tote',       priceCents: 2995, category: 'Accessories' },
      { externalId: 'r16', name: 'Sunglasses',        priceCents: 6995, salePriceCents: 4995, category: 'Accessories' },
      { externalId: 'r17', name: 'Knit Beanie',       priceCents: 1995, category: 'Accessories' },
    ];
    let added = 0;
    for (const it of items) {
      try {
        await (this.prisma.client as any).posMenuItem.create({
          data: {
            tenantId,
            connectionId: conn.id,
            externalId: it.externalId,
            name: it.name,
            priceCents: it.priceCents,
            salePriceCents: (it as any).salePriceCents || null,
            category: it.category,
            badges: [],
            available: true,
            externalUpdatedAt: new Date(),
          },
        });
        added += 1;
      } catch { /* duplicate or missing table — skip */ }
    }
    if (added > 0) {
      await (this.prisma.client as any).posProviderConnection.update({
        where: { id: conn.id },
        data: { status: 'ACTIVE', lastSyncedAt: new Date(), lastSyncItemCount: added },
      }).catch(() => {});
    }
    this.logger.log(`seedRetailPos(${tenantId}): ${added} items.`);
  }

  private async _seedPublicBroadcasters(tenantId: string, userId: string): Promise<void> {
    let conn = await (this.prisma.client as any).streamProviderConnection.findFirst({
      where: { tenantId, providerId: 'public-broadcasters' },
    });
    if (!conn) {
      try {
        conn = await this.streaming.createConnection({
          tenantId,
          userId,
          providerId: 'public-broadcasters',
          displayName: `${SAMPLE_TAG} Public Broadcasters`,
          credentials: {},
        });
      } catch {
        return;
      }
    }
    let added = 0;
    for (const ch of PUBLIC_BROADCASTER_CHANNELS) {
      try {
        await this.streaming.addChannel({
          tenantId,
          connectionId: conn.id,
          externalId: ch.id,
          title: ch.title,
          description: ch.description,
          category: ch.category,
          playbackUrl: ch.hlsUrl || presetEmbedUrl(ch, { muted: true, autoplay: true }),
          playbackType: ch.hlsUrl ? 'hls' : 'iframe',
          kind: 'LIVE',
          allowAdOverlay: ch.allowAdOverlay,
        });
        added += 1;
      } catch { /* already added or table absent — skip */ }
    }
    this.logger.log(`seedPublicBroadcasters(${tenantId}): ${added} channels.`);
  }

  private async _seedHouseAds(tenantId: string, userId: string, vertical: string): Promise<void> {
    try {
      const existing = await (this.prisma.client as any).adNetworkConnection.findFirst({
        where: { tenantId, networkId: 'house-only' },
      });
      if (!existing) {
        await this.ads.createConnection({
          tenantId,
          userId,
          tenantVertical: vertical,
          networkId: 'house-only',
          credentials: {},
          contentControls: { blockedCategories: [], dayparts: [], pauseDuringEmergency: true },
        });
        this.logger.log(`seedHouseAds(${tenantId}): house-only ad network connected.`);
      }
    } catch { /* table absent or already exists — skip */ }
  }
}
