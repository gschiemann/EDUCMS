import {
  Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Post, Request, UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';

/**
 * Panic / emergency content management.
 *
 * Each tenant has up to four panic content buckets — `lockdown`,
 * `weather`, `evacuate`, and a generic `default` (used when
 * Tenant.emergencyStatus fires without a matching panic-type playlist).
 * Under the hood these are stored as Playlist rows with `isProtected = true`
 * and `protectedKind` set, but the UI never has to think about
 * "playlists" for emergencies — operators just drop assets into the
 * lockdown bucket.
 *
 * Why protected playlists instead of a brand-new model? It keeps the
 * existing manifest endpoint, screen sync, and player rendering paths
 * 100% unchanged. The only thing that changes is the management surface.
 *
 * Why a separate controller instead of adding more routes to
 * tenants.controller.ts? Discoverability + a clean RBAC boundary.
 */
@Controller('api/v1/panic-content')
@UseGuards(JwtAuthGuard, RbacGuard)
export class PanicContentController {
  constructor(private readonly prisma: PrismaService) {}

  // SRP-aligned panic kinds + which Tenant.* column tracks each.
  // `default` is a generic fallback used when Tenant.emergencyStatus
  // fires without a specific panic type (legacy /trigger payloads).
  private static readonly KIND_TO_FIELD = {
    lockdown: 'panicLockdownPlaylistId',
    weather:  'panicWeatherPlaylistId',
    evacuate: 'panicEvacuatePlaylistId',
    hold:     'panicHoldPlaylistId',
    secure:   'panicSecurePlaylistId',
    medical:  'panicMedicalPlaylistId',
    default:  'emergencyPlaylistId',
  } as const;

  private static readonly KIND_LABELS: Record<string, string> = {
    lockdown: 'Lockdown',
    weather:  'Shelter (Weather / Hazmat)',
    evacuate: 'Evacuate',
    hold:     'Hold (Hallway / Medical Pass)',
    secure:   'Secure (Outside Threat)',
    medical:  'Medical',
    default:  'Generic Emergency',
  };

  private validateKind(kind: string) {
    if (!(kind in PanicContentController.KIND_TO_FIELD)) {
      throw new HttpException(`Unknown panic content kind: ${kind}`, HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * Resolve (or lazily create) the protected playlist for a given panic
   * type. Idempotent: re-calling returns the existing one.
   */
  private async ensurePlaylist(tenantId: string, kind: keyof typeof PanicContentController.KIND_TO_FIELD): Promise<string> {
    const field = PanicContentController.KIND_TO_FIELD[kind];
    const tenant = await this.prisma.client.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, [field]: true } as any,
    });
    if (!tenant) throw new HttpException('Tenant not found', HttpStatus.NOT_FOUND);

    const existingId = (tenant as any)[field] as string | null;
    if (existingId) {
      // Ensure the row still exists AND is properly marked protected.
      // Self-heal: if an admin somehow deleted the underlying playlist row
      // out-of-band, re-create one so the system never enters a state
      // where the panic-type column points at a missing playlist.
      const existing = await this.prisma.client.playlist.findUnique({ where: { id: existingId } });
      if (existing) {
        if (!existing.isProtected) {
          await this.prisma.client.playlist.update({
            where: { id: existing.id },
            data: { isProtected: true, protectedKind: kind },
          });
        }
        return existing.id;
      }
    }

    // Create.
    const created = await this.prisma.client.playlist.create({
      data: {
        tenantId,
        name: `🚨 ${PanicContentController.KIND_LABELS[kind]} (System)`,
        isProtected: true,
        protectedKind: kind,
      },
    });
    await this.prisma.client.tenant.update({
      where: { id: tenantId },
      data: { [field]: created.id } as any,
    });
    return created.id;
  }

  /** List the assets in this panic bucket (creates the playlist on demand). */
  @Get(':kind/assets')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async listAssets(@Request() req: any, @Param('kind') kind: string) {
    this.validateKind(kind);
    const playlistId = await this.ensurePlaylist(req.user.tenantId, kind as any);
    const items = await this.prisma.client.playlistItem.findMany({
      where: { playlistId },
      orderBy: { sequenceOrder: 'asc' },
      include: { asset: { select: { id: true, fileUrl: true, mimeType: true, originalName: true, fileSize: true } } },
    });
    return {
      kind,
      label: PanicContentController.KIND_LABELS[kind],
      playlistId,
      items: items.map(i => ({
        id: i.id,
        assetId: i.assetId,
        durationMs: i.durationMs,
        sequenceOrder: i.sequenceOrder,
        asset: i.asset,
      })),
    };
  }

  /** Add an existing asset to this panic bucket. The asset must belong
   *  to the caller's tenant — guards against cross-tenant assetId injection. */
  @Post(':kind/assets')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async addAsset(@Request() req: any, @Param('kind') kind: string, @Body() body: { assetId: string; durationMs?: number }) {
    this.validateKind(kind);
    if (!body.assetId) {
      throw new HttpException('assetId required', HttpStatus.BAD_REQUEST);
    }
    const asset = await this.prisma.client.asset.findFirst({
      where: { id: body.assetId, tenantId: req.user.tenantId },
      select: { id: true, mimeType: true },
    });
    if (!asset) {
      throw new HttpException('Asset not found in this tenant', HttpStatus.NOT_FOUND);
    }
    const playlistId = await this.ensurePlaylist(req.user.tenantId, kind as any);
    const last = await this.prisma.client.playlistItem.findFirst({
      where: { playlistId },
      orderBy: { sequenceOrder: 'desc' },
      select: { sequenceOrder: true },
    });
    const next = (last?.sequenceOrder ?? -1) + 1;
    const dur = body.durationMs
      ?? (asset.mimeType?.startsWith('video/') || asset.mimeType?.startsWith('audio/') ? 30_000 : 10_000);
    const created = await this.prisma.client.playlistItem.create({
      data: {
        playlistId,
        assetId: asset.id,
        durationMs: dur,
        sequenceOrder: next,
        transitionType: 'FADE',
      },
      include: { asset: { select: { id: true, fileUrl: true, mimeType: true, originalName: true } } },
    });
    return created;
  }

  /** Remove a single asset entry from this panic bucket. */
  @Delete(':kind/assets/:itemId')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async removeAsset(@Request() req: any, @Param('kind') kind: string, @Param('itemId') itemId: string) {
    this.validateKind(kind);
    const item = await this.prisma.client.playlistItem.findUnique({
      where: { id: itemId },
      include: { playlist: { select: { tenantId: true, isProtected: true, protectedKind: true } } },
    });
    if (!item || item.playlist.tenantId !== req.user.tenantId) {
      throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    }
    if (!item.playlist.isProtected || item.playlist.protectedKind !== kind) {
      throw new HttpException('Item does not belong to this panic content bucket', HttpStatus.BAD_REQUEST);
    }
    await this.prisma.client.playlistItem.delete({ where: { id: itemId } });
    return { ok: true };
  }
}
