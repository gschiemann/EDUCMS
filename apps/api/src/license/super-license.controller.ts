import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';

// HIGH-2 audit fix: enums for the License columns. Whitelisting these
// catches malformed admin payloads (`{ status: "PIZZA" }` would have
// silently persisted before) and locks the surface so future schema
// changes are obvious.
const ALLOWED_TIERS = new Set(['PILOT', 'STANDARD', 'ENTERPRISE', 'EDU_DISTRICT', 'RESTAURANT_CHAIN']);
const ALLOWED_BILLING_MODES = new Set(['CARD', 'INVOICE', 'PURCHASE_ORDER', 'COMP']);
const ALLOWED_STATUSES = new Set(['ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED']);
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { LicenseService } from './license.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

/**
 * Owner-only management endpoints. Used by the /super page in the web app
 * for the operator (= you, gschiemann@sbcglobal.net) to apply licenses,
 * comp seats, and view billing health across every tenant.
 */
@Controller('api/v1/super')
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN)
export class SuperLicenseController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly license: LicenseService,
    private readonly storage: SupabaseStorageService,
  ) {}

  /** List every tenant with its license summary + paired-screen count.
   *
   *  Phase B closeout — also surfaces fleet-health rollups so the
   *  SUPER_ADMIN sees, at a glance, which tenants are healthy vs in
   *  trouble without having to dive into each tenant's /screens page:
   *
   *    - screensOnline   live count (last ping within 2 min)
   *    - emergencyActive 1/0 — is the tenant in an active alert
   *    - canaryPercent   100 = full rollout, else mid-canary
   *    - openIncidents24h count of INFRA_EVENT notifications in last 24h
   *
   *  Computed in ONE round trip via concurrent Prisma queries so the
   *  endpoint stays under ~300 ms for fleets up to a few thousand
   *  screens. The screen.lastPingAt threshold matches the dashboard's
   *  per-row ONLINE/OFFLINE chip threshold.
   */
  @Get('tenants')
  async listTenants() {
    const tenants = await this.prisma.client.tenant.findMany({
      select: {
        id: true, name: true, slug: true, vertical: true, parentId: true, createdAt: true,
        emergencyStatus: true,
        canaryFleetPercent: true,
        license: true,
        _count: { select: { screens: { where: { pairedAt: { not: null } } } } },
      } as any,
      orderBy: [{ vertical: 'asc' }, { name: 'asc' }],
    });

    const onlineCutoff = new Date(Date.now() - 2 * 60_000);
    const since24h = new Date(Date.now() - 24 * 60 * 60_000);

    // Parallel: per-tenant ONLINE counts + per-tenant INFRA_EVENT count.
    // groupBy is one query each, scales linearly with tenant count.
    const [onlineByTenant, incidentsByTenant] = await Promise.all([
      this.prisma.client.screen.groupBy({
        by: ['tenantId'],
        where: {
          tenantId: { not: null },
          status: { not: 'REVOKED' },
          lastPingAt: { gte: onlineCutoff },
        },
        _count: { _all: true },
      }),
      this.prisma.client.notification.groupBy({
        by: ['tenantId'],
        where: {
          kind: 'INFRA_EVENT' as any,
          createdAt: { gte: since24h },
        },
        _count: { _all: true },
      }).catch(() => []),
    ]);

    const onlineMap = new Map<string, number>();
    for (const row of onlineByTenant as any[]) {
      if (row.tenantId) onlineMap.set(row.tenantId, row._count?._all ?? 0);
    }
    const incidentMap = new Map<string, number>();
    for (const row of incidentsByTenant as any[]) {
      if (row.tenantId) incidentMap.set(row.tenantId, row._count?._all ?? 0);
    }

    return tenants.map((t: any) => {
      const seatLimit = t.license?.seatLimit ?? LicenseService.PILOT_SEAT_LIMIT;
      const seatsUsed = t._count.screens;
      return {
        id: t.id, name: t.name, slug: t.slug, vertical: t.vertical, parentId: t.parentId, createdAt: t.createdAt,
        tier: t.license?.tier ?? 'PILOT',
        status: t.license?.status ?? 'ACTIVE',
        billingMode: t.license?.billingMode ?? 'COMP',
        seatLimit, seatsUsed, atLimit: seatsUsed >= seatLimit,
        monthlyPriceCents: t.license?.monthlyPriceCents ?? null,
        expiresAt: t.license?.expiresAt ?? t.license?.currentPeriodEnd ?? null,
        notes: t.license?.notes ?? null,
        // Phase B closeout rollups
        screensOnline: onlineMap.get(t.id) ?? 0,
        emergencyActive: !!(t.emergencyStatus && t.emergencyStatus !== 'NONE' && t.emergencyStatus !== 'CLEARED'),
        canaryPercent: t.canaryFleetPercent ?? 100,
        openIncidents24h: incidentMap.get(t.id) ?? 0,
      };
    });
  }

  /** Create OR update the License row for a tenant. Idempotent upsert.
   *  Each mutation is wrapped with an immutable AuditLog row inside the same
   *  $transaction (Lane-1 P0 fix — license mutations were previously silent). */
  @Post('tenants/:tenantId/license')
  async upsertLicense(
    @Param('tenantId') tenantId: string,
    @Body() body: {
      tier: string;
      seatLimit: number;
      billingMode?: string;
      status?: string;
      monthlyPriceCents?: number | null;
      currentPeriodStart?: string | null;
      currentPeriodEnd?: string | null;
      expiresAt?: string | null;
      notes?: string | null;
    },
    @Req() req: any,
  ) {
    if (!body.tier || typeof body.seatLimit !== 'number' || body.seatLimit < 1) {
      throw new HttpException('tier and seatLimit (>=1) required', HttpStatus.BAD_REQUEST);
    }
    // Enum guards. Reject silently-malformed payloads at the boundary.
    if (!ALLOWED_TIERS.has(body.tier)) {
      throw new HttpException(`tier must be one of: ${[...ALLOWED_TIERS].join(', ')}`, HttpStatus.BAD_REQUEST);
    }
    if (body.billingMode && !ALLOWED_BILLING_MODES.has(body.billingMode)) {
      throw new HttpException(`billingMode must be one of: ${[...ALLOWED_BILLING_MODES].join(', ')}`, HttpStatus.BAD_REQUEST);
    }
    if (body.status && !ALLOWED_STATUSES.has(body.status)) {
      throw new HttpException(`status must be one of: ${[...ALLOWED_STATUSES].join(', ')}`, HttpStatus.BAD_REQUEST);
    }
    if (body.seatLimit > 100_000) {
      throw new HttpException('seatLimit unreasonable; cap is 100k', HttpStatus.BAD_REQUEST);
    }
    const exists = await this.prisma.client.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!exists) throw new HttpException('Tenant not found', HttpStatus.NOT_FOUND);

    const data: any = {
      tier: body.tier,
      seatLimit: body.seatLimit,
      billingMode: body.billingMode ?? 'COMP',
      status: body.status ?? 'ACTIVE',
      monthlyPriceCents: body.monthlyPriceCents ?? null,
      currentPeriodStart: body.currentPeriodStart ? new Date(body.currentPeriodStart) : null,
      currentPeriodEnd: body.currentPeriodEnd ? new Date(body.currentPeriodEnd) : null,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      notes: body.notes ?? null,
    };

    return this.prisma.client.$transaction(async (tx) => {
      const license = await tx.license.upsert({
        where: { tenantId },
        create: { tenantId, ...data },
        update: data,
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: req?.user?.userId ?? null,
          action: 'LICENSE_UPSERT',
          targetType: 'License',
          targetId: tenantId,
          details: JSON.stringify(data),
        },
      });
      return license;
    });
  }

  /** Convenience: comp N seats indefinitely (most common SUPER_ADMIN action). */
  @Post('tenants/:tenantId/comp')
  async comp(
    @Param('tenantId') tenantId: string,
    @Body() body: { seatLimit: number; tier?: string; notes?: string | null },
    @Req() req: any,
  ) {
    return this.upsertLicense(
      tenantId,
      {
        tier: body.tier ?? 'PILOT',
        seatLimit: body.seatLimit,
        billingMode: 'COMP',
        status: 'ACTIVE',
        monthlyPriceCents: 0,
        notes: body.notes ?? `Comp'd by SUPER_ADMIN at ${new Date().toISOString()}`,
      },
      req,
    );
  }

  /** Suspend a license (e.g. payment failure). Players still play; new
   *  pairs are blocked. */
  @Put('tenants/:tenantId/license/status')
  async setStatus(
    @Param('tenantId') tenantId: string,
    @Body() body: { status: 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' },
    @Req() req: any,
  ) {
    if (!body.status || !ALLOWED_STATUSES.has(body.status)) {
      throw new HttpException(`status must be one of: ${[...ALLOWED_STATUSES].join(', ')}`, HttpStatus.BAD_REQUEST);
    }
    return this.prisma.client.$transaction(async (tx) => {
      const updated = await tx.license.update({
        where: { tenantId },
        data: { status: body.status },
      });
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: req?.user?.userId ?? null,
          action: 'LICENSE_STATUS_CHANGED',
          targetType: 'License',
          targetId: tenantId,
          details: JSON.stringify({ status: body.status }),
        },
      });
      return updated;
    });
  }

  /**
   * SUPABASE EGRESS BACKFILL (2026-05-23) — POST /super/storage/backfill-cache-control
   *
   * Idempotent one-shot. The presign upload chain shipped without
   * Cache-Control on the client PUT (fixed today on master), so every
   * object uploaded between the presign rollout and this fix is sitting
   * in Supabase Storage with the default `cache-control: no-cache`
   * metadata. That is the exact root cause of the 11.7GB-from-273MB-
   * stored egress incident — Cloudflare never cached the object, so
   * every player/preview/CI fetch hit the origin.
   *
   * This endpoint walks `storage.objects` in the same Postgres database
   * (Supabase storage lives in the `storage` schema alongside our
   * `public` schema) and patches the `metadata.cacheControl` JSONB
   * field on any object missing the immutable header. Zero re-upload,
   * zero egress, single SQL statement — much cheaper than re-uploading
   * the bytes through `update()`.
   *
   * After this runs, every NEXT GET from Cloudflare's edge will populate
   * the CDN cache with the new immutable header, and from then on the
   * fetch pattern is one origin pull per asset per edge PoP per year.
   *
   * Safe to re-run; the WHERE clause skips rows already marked immutable.
   */
  @Post('storage/backfill-cache-control')
  async backfillStorageCacheControl(
    @Req() req: any,
    @Query('probe') probe?: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    // 2026-05-30 REWRITE — the original backfill patched the
    // `storage.objects.metadata` JSONB column, which Supabase Storage does
    // NOT serve the Cache-Control header from. Verified: every object's DB
    // metadata read `immutable` while the LIVE served header was `no-cache`
    // (curl), so Cloudflare `MISS`'d every request and the full file was
    // re-pulled from origin on every load — the 98 MB-stored → 5.79 GB-egress
    // incident. The ONLY way to change the SERVED header is to re-write the
    // object through the Storage API (resetCacheControl downloads + re-POSTs
    // with `cache-control: max-age=31536000`).
    //
    // This endpoint is self-verifying: it HEADs each object before AND after
    // the re-set and returns the served Cache-Control, so we can PROVE the
    // wire header flipped instead of trusting the DB again.
    //   ?probe=1            → re-set only the first object (fast sanity check)
    //   ?limit=N&offset=M   → batch (avoids request timeouts on large catalogs)
    //   (no params)         → re-set every object in the assets bucket
    const rows: Array<{ name: string }> = await this.prisma.client.$queryRawUnsafe(
      `SELECT name FROM storage.objects WHERE bucket_id = 'assets' ORDER BY created_at DESC NULLS LAST`,
    );
    const allPaths = rows.map((r) => r.name).filter(Boolean);

    const isProbe = probe === '1' || probe === 'true';
    const offset = offsetStr ? Math.max(0, parseInt(offsetStr, 10) || 0) : 0;
    const limit = isProbe ? 1 : (limitStr ? Math.max(0, parseInt(limitStr, 10) || 0) : allPaths.length);
    const paths = allPaths.slice(offset, offset + limit);

    let reset = 0;
    let skipped = 0;
    let failed = 0;
    const samples: Array<{ path: string; before: string | null; after: string | null; ok: boolean; error?: string }> = [];
    const failures: Array<{ path: string; error?: string }> = [];

    for (const p of paths) {
      const before = await this.storage.servedCacheControl(p);
      const beforeCC = before.cacheControl || '';
      const alreadyCacheable = beforeCC.includes('max-age=') && !beforeCC.includes('no-cache');
      if (alreadyCacheable && !isProbe) {
        skipped++;
        continue;
      }
      const r = await this.storage.resetCacheControl(p);
      if (r.ok) {
        reset++;
        const after = await this.storage.servedCacheControl(p);
        if (samples.length < 5) samples.push({ path: p, before: before.cacheControl, after: after.cacheControl, ok: true });
      } else {
        failed++;
        if (failures.length < 10) failures.push({ path: p, error: r.error });
        if (samples.length < 5) samples.push({ path: p, before: before.cacheControl, after: null, ok: false, error: r.error });
      }
    }

    await this.prisma.client.auditLog.create({
      data: {
        tenantId: null as any,
        userId: req?.user?.userId ?? null,
        action: 'STORAGE_CACHE_CONTROL_RESET',
        targetType: 'Storage',
        targetId: 'assets',
        details: JSON.stringify({ totalObjects: allPaths.length, attempted: paths.length, reset, skipped, failed, probe: isProbe, offset, limit }),
      },
    });

    return {
      ok: true,
      totalObjects: allPaths.length,
      attempted: paths.length,
      reset,
      skipped,
      failed,
      samples,
      failures,
      note: isProbe
        ? 'PROBE: re-set 1 object. If samples[0].after shows "max-age=31536000" the fix works — re-run with no params (or ?limit=&offset= batches) to re-set the whole catalog.'
        : 'Re-set complete. samples[].after should read "max-age=31536000"; Cloudflare will return cf-cache-status: HIT on the next repeat fetch, collapsing egress.',
    };
  }

  /**
   * SUPABASE STORAGE WIPE (2026-05-23) — POST /super/storage/wipe-all-assets
   *
   * Nuclear option. Deletes EVERY Asset row, the PlaylistItems that
   * reference them, AND every object in the Supabase Storage `assets`
   * bucket. Then the platform is on a clean slate where every future
   * upload (per fixes shipped 2026-05-23) is cached immutably and image
   * content is server-side optimized to WebP. No backfill drama.
   *
   * Confirmation: must POST `{ confirm: 'YES_WIPE_ALL_ASSETS' }` in the
   * body. Without this string we 400 — guarding against an accidental
   * curl or fat-finger from the dashboard console.
   *
   * The DB delete is wrapped in a transaction (PlaylistItem → Asset)
   * so a partial wipe can't orphan one side. Storage delete happens
   * AFTER the DB commit; if storage delete partially fails, the DB is
   * already clean and the bucket's leftover objects become orphaned
   * (still cheap to clean up via the storage console).
   *
   * Audit: writes an AuditLog row with the pre-wipe counts so the
   * forensic trail captures "what was here before."
   */
  @Post('storage/wipe-all-assets')
  async wipeAllAssets(
    @Body() body: { confirm?: string },
    @Req() req: any,
  ) {
    if (body?.confirm !== 'YES_WIPE_ALL_ASSETS') {
      throw new HttpException(
        'wipe-all-assets requires { confirm: "YES_WIPE_ALL_ASSETS" } in the body.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Snapshot counts + storage paths BEFORE the delete so we can audit
    // what was there and have a list of objects to remove from Supabase.
    const [assetCount, playlistItemCount, totalBytes, allAssets] = await Promise.all([
      this.prisma.client.asset.count(),
      this.prisma.client.playlistItem.count(),
      this.prisma.client.asset.aggregate({ _sum: { fileSize: true } }),
      this.prisma.client.asset.findMany({ select: { fileUrl: true } }),
    ]);

    // Map each Asset.fileUrl to its Supabase storage path. Skip any
    // URL that doesn't parse (legacy local-disk fileUrls, etc).
    const storagePaths = allAssets
      .map((a) => this.storage.extractPath(a.fileUrl))
      .filter((p): p is string => typeof p === 'string' && p.length > 0);

    // Wipe DB in a transaction. playlist_items reference assets via
    // assetId WITHOUT onDelete:Cascade in the schema, so we delete
    // playlist_items first to avoid an FK violation. Note: this leaves
    // Playlist rows intact — operators get to keep their playlist
    // structure, just empty.
    const dbResult = await this.prisma.client.$transaction(async (tx) => {
      const removedItems = await tx.playlistItem.deleteMany({});
      const removedAssets = await tx.asset.deleteMany({});
      return {
        playlistItemsDeleted: removedItems.count,
        assetsDeleted: removedAssets.count,
      };
    });

    // Now nuke the Supabase storage bucket contents. The DB rows are
    // already gone so a partial failure here only leaves orphan blobs
    // (which Supabase's "Unlinked Objects" report can sweep later).
    const storageRemoved = await this.storage.deleteMany(storagePaths);

    // Forensic trail. tenantId is null because this is a fleet-wide
    // owner action that touches every tenant.
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: null as any,
        userId: req?.user?.userId ?? null,
        action: 'STORAGE_WIPE_ALL_ASSETS',
        targetType: 'Storage',
        targetId: this.storage.bucketName(),
        details: JSON.stringify({
          before: {
            assetCount,
            playlistItemCount,
            totalBytes: Number(totalBytes._sum.fileSize || 0),
          },
          deleted: {
            ...dbResult,
            storageObjectsRemoved: storageRemoved,
            storagePathsRequested: storagePaths.length,
          },
        }),
      },
    });

    return {
      ok: true,
      before: {
        assetCount,
        playlistItemCount,
        totalBytes: Number(totalBytes._sum.fileSize || 0),
      },
      deleted: {
        ...dbResult,
        storageObjectsRemoved: storageRemoved,
        storagePathsRequested: storagePaths.length,
      },
      note:
        'Clean slate complete. All future uploads will be optimized server-side (images → WebP, ' +
        'video size-capped at 50MB) and served with immutable Cache-Control. Re-run ' +
        'POST /super/storage/wipe-all-assets to wipe again — safe to call on an already-empty bucket.',
    };
  }

  /**
   * SUPABASE EGRESS AUDIT — GET /super/storage/cache-control-audit
   *
   * Operator visibility: sample N random objects from the assets bucket
   * and report each one's stored Cache-Control. Detects drift before it
   * becomes a billing event.
   */
  @Get('storage/cache-control-audit')
  async auditStorageCacheControl() {
    const rows = await this.prisma.client.$queryRawUnsafe<
      Array<{ name: string; cache_control: string | null; size: number | null }>
    >(
      `
      SELECT
        name,
        metadata->>'cacheControl' AS cache_control,
        (metadata->>'size')::bigint AS size
      FROM storage.objects
      WHERE bucket_id = 'assets'
      ORDER BY random()
      LIMIT 50
      `,
    );

    const missing = rows.filter(
      (r) => !r.cache_control || !r.cache_control.includes('immutable'),
    );
    return {
      sampledCount: rows.length,
      missingImmutableCount: missing.length,
      sample: rows.map((r) => ({
        name: r.name,
        cacheControl: r.cache_control,
        size: Number(r.size || 0),
      })),
      verdict:
        missing.length === 0
          ? 'OK — every sampled object carries immutable Cache-Control.'
          : `WARNING — ${missing.length}/${rows.length} sampled objects are missing immutable. Run POST /super/storage/backfill-cache-control.`,
    };
  }
}
