/**
 * SampleDataController — one-click integration test harness.
 *
 * 2026-05-03. Operator wants to demo the streaming / POS / ads
 * integrations WITHOUT registering for sandbox accounts at every
 * vendor. This controller loads pre-baked sample data into the
 * tenant's actual rows so the widgets render real-looking content
 * end-to-end.
 *
 * Endpoints (all ADMIN+):
 *   POST /api/v1/sample-data/streaming/public-broadcasters
 *     → connects the public-broadcasters provider + auto-picks the
 *       9 curated NHK / France 24 / DW / etc. channels.
 *   POST /api/v1/sample-data/streaming/custom-hls
 *     → connects custom-hls + adds a sample Mux test stream channel.
 *   POST /api/v1/sample-data/pos/sample-restaurant
 *     → creates a custom-webhook POS connection + seeds 24 sample
 *       menu items across 4 categories so menu-board widgets render.
 *   POST /api/v1/sample-data/pos/sample-retail
 *     → 18 sample retail SKUs across 3 categories.
 *   POST /api/v1/sample-data/ads/house-only
 *     → connects the house-only ad network so the operator can
 *       schedule their own creatives without external OAuth.
 *   DELETE /api/v1/sample-data/all
 *     → wipes every sample-data row tagged with `sample:true` in
 *       the connection's displayName / metadata. Production rows
 *       are left alone.
 *
 * Every sample row gets a `[Sample]` prefix on its display name so
 * an admin can tell at a glance what's real vs. demo data.
 */
import { Body, Controller, Delete, Post, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { StreamingService } from '../streaming/streaming.service';
import { PosService } from '../pos/pos.service';
import { AdsService } from '../ads/ads.service';
import { PUBLIC_BROADCASTER_CHANNELS, presetEmbedUrl } from '@cms/api-types';

const SAMPLE_TAG = '[Sample]';

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/sample-data')
export class SampleDataController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly streaming: StreamingService,
    private readonly pos: PosService,
    private readonly ads: AdsService,
  ) {}

  // ─── Streaming sample data ────────────────────────────────────────
  @Post('streaming/public-broadcasters')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async loadPublicBroadcasters(@Request() req: any) {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;

    // Connect (or reuse existing) public-broadcasters provider.
    let conn = await (this.prisma.client as any).streamProviderConnection.findFirst({
      where: { tenantId, providerId: 'public-broadcasters' },
    });
    if (!conn) {
      conn = await this.streaming.createConnection({
        tenantId,
        userId,
        providerId: 'public-broadcasters',
        displayName: `${SAMPLE_TAG} Public Broadcasters`,
        credentials: {},
      });
    }
    // Pick all 9 preset channels.
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
      } catch (e) {
        // Already added — skip.
      }
    }
    return {
      ok: true,
      connectionId: conn.id,
      channelsAdded: added,
      message: `Connected Public Broadcasters with ${added} channels. Drop the Live Stream widget on a template to see them.`,
    };
  }

  @Post('streaming/custom-hls')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async loadSampleHls(@Request() req: any) {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    let conn = await (this.prisma.client as any).streamProviderConnection.findFirst({
      where: { tenantId, providerId: 'custom-hls' },
    });
    if (!conn) {
      conn = await this.streaming.createConnection({
        tenantId,
        userId,
        providerId: 'custom-hls',
        displayName: `${SAMPLE_TAG} Custom HLS`,
        credentials: { playbackUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' },
      });
    }
    // Mux's open test HLS streams — free, public, work everywhere.
    const samples = [
      { id: 'mux-bipbop', title: '[Sample] BipBop test stream', url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' },
      { id: 'mux-test-pattern', title: '[Sample] Test pattern', url: 'https://test-streams.mux.dev/test_001/stream.m3u8' },
    ];
    let added = 0;
    for (const s of samples) {
      try {
        await this.streaming.addChannel({
          tenantId,
          connectionId: conn.id,
          externalId: s.id,
          title: s.title,
          playbackUrl: s.url,
          playbackType: 'hls',
          kind: 'LIVE',
          allowAdOverlay: true,
        });
        added += 1;
      } catch { /* already added */ }
    }
    return { ok: true, connectionId: conn.id, channelsAdded: added };
  }

  // ─── POS sample data ─────────────────────────────────────────────
  // ai-imports-004 fix: both restaurant + retail loaders use the same
  // `custom-webhook` providerId, but @@unique([tenantId, providerId])
  // means they collide silently — calling restaurant then retail merges
  // the retail items into the existing restaurant connection (or vice
  // versa). The fix is to look up the connection by displayName prefix
  // instead of providerId. The first loader to run for a given tenant
  // creates a connection tagged "[Sample] Restaurant Webhook" /
  // "[Sample] Retail Webhook"; subsequent calls find that exact tagged
  // row instead of stomping the other loader's connection.
  //
  // We still write providerId='custom-webhook' on create — the unique
  // index is per-tenant-per-providerId, so the SECOND loader will fail
  // its index check with the new tag. We catch that and fall back to
  // looking up the existing same-tag row (idempotency) but do NOT reuse
  // the OTHER loader's connection.
  @Post('pos/sample-restaurant')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async loadSampleRestaurantPos(@Request() req: any) {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;

    const restaurantDisplayName = `${SAMPLE_TAG} Restaurant Webhook`;
    let conn = await (this.prisma.client as any).posProviderConnection.findFirst({
      where: { tenantId, displayName: restaurantDisplayName },
    });
    if (!conn) {
      try {
        conn = await this.pos.createConnection({
          tenantId,
          userId,
          providerId: 'custom-webhook',
          displayName: restaurantDisplayName,
          credentials: { webhookSecret: 'sample-' + Math.random().toString(36).slice(2) },
        });
      } catch (err: any) {
        // The unique([tenantId, providerId]) constraint already holds a
        // 'custom-webhook' row from the OTHER loader. Don't merge into
        // it — surface a clear error so the operator wipes sample data
        // first and re-runs.
        if (String(err?.message || '').includes('Unique')) {
          return {
            ok: false,
            message:
              'Another sample POS connection already exists for this tenant. Run DELETE /api/v1/sample-data/all to wipe sample data, then re-run this loader.',
          };
        }
        throw err;
      }
    }

    // 24-item sample menu across 4 categories.
    const items = [
      // Burgers
      { externalId: 'b1', name: 'Classic Burger',     priceCents: 1295, category: 'Burgers', description: 'Lettuce, tomato, onion, house sauce' },
      { externalId: 'b2', name: 'Bacon Cheddar',      priceCents: 1495, category: 'Burgers', description: 'Smoked bacon + sharp cheddar' },
      { externalId: 'b3', name: 'Mushroom Swiss',     priceCents: 1395, category: 'Burgers', description: 'Sautéed cremini + Swiss' },
      { externalId: 'b4', name: 'Western',            priceCents: 1495, category: 'Burgers', description: 'Onion ring + BBQ + cheddar' },
      { externalId: 'b5', name: 'Veggie Burger',      priceCents: 1295, category: 'Burgers', description: 'Black bean patty', badges: ['V'] },
      { externalId: 'b6', name: 'Double Stack',       priceCents: 1695, category: 'Burgers', description: 'Two patties, two cheeses' },
      // Sides
      { externalId: 's1', name: 'Fries',              priceCents: 495,  category: 'Sides',   description: 'Hand-cut, sea salt' },
      { externalId: 's2', name: 'Sweet Potato Fries', priceCents: 595,  category: 'Sides',   description: 'Cinnamon-sugar option' },
      { externalId: 's3', name: 'Onion Rings',        priceCents: 595,  category: 'Sides',   description: 'Beer-battered' },
      { externalId: 's4', name: 'Side Salad',         priceCents: 495,  category: 'Sides',   description: 'Mixed greens', badges: ['V', 'GF'] },
      { externalId: 's5', name: 'Mac & Cheese',       priceCents: 695,  category: 'Sides',   description: 'Three-cheese baked' },
      { externalId: 's6', name: 'Coleslaw',           priceCents: 395,  category: 'Sides',   description: 'House recipe', badges: ['GF'] },
      // Drinks
      { externalId: 'd1', name: 'Soda',               priceCents: 295,  category: 'Drinks',  description: 'Free refills' },
      { externalId: 'd2', name: 'Iced Tea',           priceCents: 295,  category: 'Drinks',  description: 'Sweet or unsweet' },
      { externalId: 'd3', name: 'Lemonade',           priceCents: 395,  category: 'Drinks',  description: 'House-squeezed' },
      { externalId: 'd4', name: 'Milkshake',          priceCents: 595,  category: 'Drinks',  description: 'Vanilla / chocolate / strawberry' },
      { externalId: 'd5', name: 'Local Lager',        priceCents: 595,  category: 'Drinks',  description: '12oz draft' },
      { externalId: 'd6', name: 'IPA',                priceCents: 695,  category: 'Drinks',  description: 'West-coast style' },
      // Desserts
      { externalId: 'des1', name: 'Brownie Sundae',   priceCents: 695,  category: 'Desserts',description: 'Hot fudge, vanilla bean' },
      { externalId: 'des2', name: 'Apple Pie',        priceCents: 595,  category: 'Desserts',description: 'House-baked, à la mode' },
      { externalId: 'des3', name: 'Cheesecake',       priceCents: 695,  category: 'Desserts',description: 'New York style' },
      { externalId: 'des4', name: 'Ice Cream',        priceCents: 395,  category: 'Desserts',description: 'Two scoops, your choice', badges: ['GF'] },
      { externalId: 'des5', name: 'Cookie Plate',     priceCents: 495,  category: 'Desserts',description: 'Three warm cookies' },
      { externalId: 'des6', name: 'Sorbet',           priceCents: 495,  category: 'Desserts',description: 'Lemon / raspberry', badges: ['V', 'GF'] },
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
      } catch { /* duplicate — skip */ }
    }

    // Mark the connection as ACTIVE so it doesn't sit in PENDING.
    await (this.prisma.client as any).posProviderConnection.update({
      where: { id: conn.id },
      data: { status: 'ACTIVE', lastSyncedAt: new Date(), lastSyncItemCount: added },
    });

    return {
      ok: true,
      connectionId: conn.id,
      itemsAdded: added,
      message: `Loaded ${added} sample menu items. Drop the Restaurant Menu Board widget on a template to see them.`,
    };
  }

  @Post('pos/sample-retail')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async loadSampleRetailPos(@Request() req: any) {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;

    // ai-imports-004 fix: see loadSampleRestaurantPos for context. Look
    // up by tagged displayName, not providerId, so retail does not
    // accidentally merge its catalog into the restaurant connection.
    const retailDisplayName = `${SAMPLE_TAG} Retail Webhook`;
    let conn = await (this.prisma.client as any).posProviderConnection.findFirst({
      where: { tenantId, displayName: retailDisplayName },
    });
    if (!conn) {
      try {
        conn = await this.pos.createConnection({
          tenantId,
          userId,
          providerId: 'custom-webhook',
          displayName: retailDisplayName,
          credentials: { webhookSecret: 'sample-' + Math.random().toString(36).slice(2) },
        });
      } catch (err: any) {
        if (String(err?.message || '').includes('Unique')) {
          return {
            ok: false,
            message:
              'Another sample POS connection already exists for this tenant. Run DELETE /api/v1/sample-data/all to wipe sample data, then re-run this loader.',
          };
        }
        throw err;
      }
    }

    const items = [
      // Apparel
      { externalId: 'r1',  name: 'Classic Tee',         priceCents: 2495, salePriceCents: 1495, category: 'Apparel' },
      { externalId: 'r2',  name: 'Oversized Hoodie',    priceCents: 5995, category: 'Apparel' },
      { externalId: 'r3',  name: 'Denim Jacket',        priceCents: 8995, category: 'Apparel' },
      { externalId: 'r4',  name: 'Linen Shirt',         priceCents: 4995, salePriceCents: 2995, category: 'Apparel' },
      { externalId: 'r5',  name: 'Wool Sweater',        priceCents: 7995, category: 'Apparel' },
      { externalId: 'r6',  name: 'Track Pants',         priceCents: 4495, category: 'Apparel' },
      // Footwear
      { externalId: 'r7',  name: 'Court Sneakers',      priceCents: 9995, category: 'Footwear' },
      { externalId: 'r8',  name: 'Hiking Boots',        priceCents: 14995, category: 'Footwear' },
      { externalId: 'r9',  name: 'Sandals',             priceCents: 5995, salePriceCents: 3995, category: 'Footwear' },
      { externalId: 'r10', name: 'Running Shoes',       priceCents: 12995, category: 'Footwear' },
      { externalId: 'r11', name: 'Ankle Boots',         priceCents: 11995, category: 'Footwear' },
      { externalId: 'r12', name: 'Loafers',             priceCents: 8995, category: 'Footwear' },
      // Accessories
      { externalId: 'r13', name: 'Leather Belt',        priceCents: 4995, category: 'Accessories' },
      { externalId: 'r14', name: 'Wool Scarf',          priceCents: 3495, category: 'Accessories' },
      { externalId: 'r15', name: 'Canvas Tote',         priceCents: 2995, category: 'Accessories' },
      { externalId: 'r16', name: 'Sunglasses',          priceCents: 6995, salePriceCents: 4995, category: 'Accessories' },
      { externalId: 'r17', name: 'Knit Beanie',         priceCents: 1995, category: 'Accessories' },
      { externalId: 'r18', name: 'Watch',               priceCents: 19995, category: 'Accessories' },
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
      } catch { /* duplicate */ }
    }

    await (this.prisma.client as any).posProviderConnection.update({
      where: { id: conn.id },
      data: { status: 'ACTIVE', lastSyncedAt: new Date(), lastSyncItemCount: added },
    });

    return { ok: true, connectionId: conn.id, itemsAdded: added };
  }

  // ─── Ads sample data ─────────────────────────────────────────────
  @Post('ads/house-only')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async loadHouseOnlyAds(@Request() req: any) {
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    const tenant = await (this.prisma.client as any).tenant.findUnique({
      where: { id: tenantId },
      select: { vertical: true },
    });
    let conn = await (this.prisma.client as any).adNetworkConnection.findFirst({
      where: { tenantId, networkId: 'house-only' },
    });
    if (!conn) {
      conn = await this.ads.createConnection({
        tenantId,
        userId,
        tenantVertical: tenant?.vertical || 'K12',
        networkId: 'house-only',
        credentials: {},
        contentControls: { blockedCategories: [], dayparts: [], pauseDuringEmergency: true },
      });
    }
    return {
      ok: true,
      connectionId: conn.id,
      message: 'House-only ad network connected. Upload your own creatives in Assets → Ad Slots.',
    };
  }

  // ─── Wipe ────────────────────────────────────────────────────────
  @Delete('all')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async wipeSampleData(@Request() req: any) {
    const tenantId = req.user.tenantId;
    // Tag check: only delete connections whose displayName starts with SAMPLE_TAG.
    const streamConns = await (this.prisma.client as any).streamProviderConnection.findMany({
      where: { tenantId, displayName: { startsWith: SAMPLE_TAG } },
    });
    for (const c of streamConns) {
      await (this.prisma.client as any).streamProviderConnection.delete({ where: { id: c.id } });
    }
    const posConns = await (this.prisma.client as any).posProviderConnection.findMany({
      where: { tenantId, displayName: { startsWith: SAMPLE_TAG } },
    });
    for (const c of posConns) {
      await (this.prisma.client as any).posProviderConnection.delete({ where: { id: c.id } });
    }
    // Don't auto-delete house-only ad network — operator may have
    // already uploaded real creatives. They can disconnect manually
    // from /settings/monetize if they want.
    return {
      ok: true,
      streamConnectionsRemoved: streamConns.length,
      posConnectionsRemoved: posConns.length,
      message: 'Sample data wiped. Production rows untouched.',
    };
  }
}
