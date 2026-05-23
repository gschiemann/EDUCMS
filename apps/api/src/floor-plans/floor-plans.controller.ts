/**
 * FloorPlansController — Sprint 8b Phase 1.
 *
 * Endpoints (all under /api/v1/floor-plans, all tenant-scoped, RBAC-gated):
 *   POST   /                      — upload image + create plan (multipart)
 *   GET    /                      — list all plans for caller's tenant
 *   GET    /:id                   — single plan with placed screens
 *   PUT    /:id                   — rename / relabel
 *   DELETE /:id                   — delete plan; placed screens are
 *                                    detached (floorPlanId set null)
 *   PUT    /:id/screens/:screenId — place a screen on this plan at
 *                                    (floorX, floorY) px coords
 *   DELETE /:id/screens/:screenId — detach a screen from this plan
 *
 * Why these endpoints:
 *   - Operator uploads PNG/JPG of their floor plan (no PDF-to-PNG
 *     conversion in Phase 1; defer to Sprint 10's pipeline).
 *   - Operator drags a Screen pin onto the plan in the dashboard.
 *     Save-on-drop posts to PUT /:id/screens/:screenId with px coords.
 *   - Detach removes Screen.floorPlanId/floorX/floorY so the screen
 *     reverts to "unplaced" status.
 *
 * Security:
 *   - All endpoints require an authed user with role SUPER_ADMIN /
 *     DISTRICT_ADMIN / SCHOOL_ADMIN. CONTRIBUTORs and viewers cannot
 *     place screens (operational security per CLAUDE.md Sprint 8b spec).
 *   - tenantId is taken from req.user, never the request body. Every
 *     mutation re-checks the target's tenant matches the caller.
 *   - Image uploads go through SupabaseStorageService.upload (same
 *     pipeline as assets) so the existing 500MB cap, MIME allow-list,
 *     and bucket policies apply.
 */

import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Request,
  HttpException,
  HttpStatus,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';

import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

const ALLOWED_FLOOR_PLAN_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/**
 * 2026-05-03 BUG FIX (cycle 4 emergency-BUG-008) — server-side image
 * dimension probe. Previously widthPx + heightPx came from the client's
 * form data with zero verification. A malicious client could submit
 * dimensions that didn't match the actual image, breaking the
 * screen-position calibration math (Screen.floorX/floorY are clamped
 * against plan.widthPx/heightPx — a lie there means a screen pin can
 * be placed off-image or refused entry to a legitimate location).
 *
 * We don't have an image-size dependency in apps/api/package.json, so
 * we parse the header bytes ourselves. ALLOWED_FLOOR_PLAN_MIMES is
 * exactly { png, jpeg, webp } so we only need to handle those three.
 *
 * Returns null when we cannot confidently determine dimensions — the
 * caller logs a warning rather than rejecting (we don't want to block
 * a legitimate upload over an exotic-but-valid PNG variant).
 */
function probeImageDimensions(buf: Buffer): { width: number; height: number } | null {
  if (!buf || buf.length < 24) return null;

  // PNG: 8-byte signature, then IHDR chunk where bytes 16..19 = width,
  // 20..23 = height (big-endian).
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    if (width > 0 && height > 0) return { width, height };
    return null;
  }

  // JPEG: starts with FF D8. Walk the marker segments looking for an
  // SOF marker (C0..CF except C4/C8/CC which aren't frame markers) —
  // the next 5 bytes are precision (1) + height (2) + width (2), big-
  // endian. Bound the walk so a malformed file can't loop forever.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    const max = Math.min(buf.length, 1024 * 1024); // 1MB header window is plenty
    while (offset < max - 9) {
      if (buf[offset] !== 0xff) return null; // misaligned
      // Skip padding 0xFF bytes.
      while (offset < max && buf[offset] === 0xff) offset++;
      const marker = buf[offset];
      offset++;
      // SOI/EOI/RST markers have no length payload.
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (marker >= 0xd0 && marker <= 0xd7) continue;
      if (offset + 2 > max) return null;
      const segLen = buf.readUInt16BE(offset);
      // SOF markers (Start of Frame) carry the dimensions we want.
      const isSof =
        (marker >= 0xc0 && marker <= 0xcf) &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        if (offset + 2 + 5 > max) return null;
        const height = buf.readUInt16BE(offset + 3);
        const width = buf.readUInt16BE(offset + 5);
        if (width > 0 && height > 0) return { width, height };
        return null;
      }
      if (segLen < 2) return null;
      offset += segLen;
    }
    return null;
  }

  // WEBP: 'RIFF' .... 'WEBP' then VP8/VP8L/VP8X chunk.
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    // Chunk header at offset 12: 4-byte type, 4-byte size, then payload.
    if (buf.length < 30) return null;
    const chunk = buf.slice(12, 16).toString('ascii');
    if (chunk === 'VP8 ') {
      // Lossy: payload starts at 20. Spec: skip 6 bytes, then 2 bytes
      // width LE (lower 14 bits), 2 bytes height LE (lower 14 bits).
      if (buf.length < 30) return null;
      const width = buf.readUInt16LE(26) & 0x3fff;
      const height = buf.readUInt16LE(28) & 0x3fff;
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    if (chunk === 'VP8L') {
      // Lossless: payload starts at 20. First byte is signature 0x2f,
      // then 4 bytes carry (width-1) low 14 bits and (height-1) next
      // 14 bits, little-endian.
      if (buf[20] !== 0x2f || buf.length < 25) return null;
      const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    if (chunk === 'VP8X') {
      // Extended: at offset 24, 3 bytes (width-1) LE, 3 bytes
      // (height-1) LE.
      if (buf.length < 30) return null;
      const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      if (width > 0 && height > 0) return { width, height };
      return null;
    }
    return null;
  }

  return null;
}

const SCREEN_ONLINE_STALE_MS = 35 * 1000;

type FloorPlanScreenStatusRow = {
  status: string;
  tenantId?: string | null;
  lastPingAt?: Date | string | null;
  [key: string]: unknown;
};

function deriveLiveScreenStatus(screen: FloorPlanScreenStatusRow, now: number): string {
  let liveStatus = screen.status;
  if (screen.status !== 'REVOKED') {
    const last = screen.lastPingAt ? new Date(screen.lastPingAt).getTime() : 0;
    const isAlive = !!last && now - last < SCREEN_ONLINE_STALE_MS;
    if (isAlive && screen.tenantId) liveStatus = 'ONLINE';
    else if (screen.status === 'ONLINE' || screen.tenantId) liveStatus = 'OFFLINE';
  }
  return liveStatus;
}

function withLiveFloorPlanScreenStatus<T extends { screens?: FloorPlanScreenStatusRow[] }>(plan: T, now = Date.now()): T {
  if (!plan || !Array.isArray(plan.screens)) return plan;
  return {
    ...plan,
    screens: plan.screens.map((screen) => ({
      ...screen,
      status: deriveLiveScreenStatus(screen, now),
    })),
  };
}

@Controller('api/v1/floor-plans')
@UseGuards(JwtAuthGuard, RbacGuard)
export class FloorPlansController {
  private readonly logger = new Logger(FloorPlansController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
  ) {}

  // ─── List ──────────────────────────────────────────────────────

  @Get()
  // Lane-2 P1: RESTRICTED_VIEWER removed — floor plans are operational
  // security (building layout, per-screen emergency content config) per
  // Sprint 8b spec. ADMIN-only read.
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async list(@Request() req: any) {
    const tenantId = req.user.tenantId;
    const plans = await (this.prisma.client as any).floorPlan.findMany({
      where: { tenantId },
      orderBy: [{ buildingLabel: 'asc' }, { floorLabel: 'asc' }, { name: 'asc' }],
      include: {
        zones: { select: { id: true, name: true, color: true } },
        screens: {
          select: {
            id: true,
            name: true,
            floorX: true,
            floorY: true,
            tenantId: true,
            status: true,
            lastPingAt: true,
          },
        },
      },
    });
    const now = Date.now();
    return plans.map((plan: any) => withLiveFloorPlanScreenStatus(plan, now));
  }

  // ─── Single (with screens + zones) ─────────────────────────────

  @Get(':id')
  // Lane-2 P1: RESTRICTED_VIEWER removed — getOne returns the full
  // building layout + per-screen emergency content. ADMIN/CONTRIBUTOR only.
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  async getOne(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user.tenantId;
    const plan = await (this.prisma.client as any).floorPlan.findFirst({
      where: { id, tenantId },
      include: {
        zones: true,
        screens: {
          select: {
            id: true,
            name: true,
            floorX: true,
            floorY: true,
            tenantId: true,
            status: true,
            lastPingAt: true,
            screenGroupId: true,
            location: true,
            // Sprint 8b — per-screen emergency content config so the
            // drawer's 6-row picker can render the current selection
            // without an extra round-trip.
            emergencyLockdownPlaylistId: true,
            emergencyEvacuatePlaylistId: true,
            emergencyWeatherPlaylistId: true,
            emergencyHoldPlaylistId: true,
            emergencySecurePlaylistId: true,
            emergencyMedicalPlaylistId: true,
            emergencyLockdownAssetUrl: true,
            emergencyEvacuateAssetUrl: true,
            emergencyWeatherAssetUrl: true,
            emergencyHoldAssetUrl: true,
            emergencySecureAssetUrl: true,
            emergencyMedicalAssetUrl: true,
            emergencyLockdownPortraitPlaylistId: true,
            emergencyEvacuatePortraitPlaylistId: true,
            emergencyWeatherPortraitPlaylistId: true,
            emergencyHoldPortraitPlaylistId: true,
            emergencySecurePortraitPlaylistId: true,
            emergencyMedicalPortraitPlaylistId: true,
            emergencyLockdownPortraitAssetUrl: true,
            emergencyEvacuatePortraitAssetUrl: true,
            emergencyWeatherPortraitAssetUrl: true,
            emergencyHoldPortraitAssetUrl: true,
            emergencySecurePortraitAssetUrl: true,
            emergencyMedicalPortraitAssetUrl: true,
          },
        },
      },
    });
    if (!plan) {
      throw new HttpException('Floor plan not found', HttpStatus.NOT_FOUND);
    }
    return withLiveFloorPlanScreenStatus(plan);
  }

  // ─── Create / upload ──────────────────────────────────────────

  @Post()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      // Floor plans are typically tens of MB at most. 25MB cap matches
      // architectural-PNG sizes from major CAD exports.
      limits: { fileSize: 25 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_FLOOR_PLAN_MIMES.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(null, false);
        }
      },
    }),
  )
  async create(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: {
      name?: string;
      buildingLabel?: string;
      floorLabel?: string;
      widthPx?: string | number;
      heightPx?: string | number;
    },
  ) {
    if (!file) {
      throw new HttpException(
        'No file uploaded, or file type not supported. Allowed: PNG, JPG, WEBP.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const tenantId = req.user.tenantId;
    const userId = req.user.id;
    const name = (body.name || 'Untitled floor').trim().slice(0, 200);
    let widthPx = Number(body.widthPx);
    let heightPx = Number(body.heightPx);
    if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
      throw new HttpException(
        'widthPx and heightPx are required and must be positive numbers (the image dimensions).',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (widthPx > 10000 || heightPx > 10000) {
      throw new HttpException(
        'Floor plan image must be 10000px or less in each dimension.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // 2026-05-03 BUG FIX (cycle 4 emergency-BUG-008) — probe the actual
    // image dimensions from the file header bytes and reject when the
    // client-supplied numbers don't match. Without this, a malicious
    // client could submit dimensions that don't match the real image,
    // breaking the screen-position calibration math (Screen.floorX/Y
    // are clamped against plan.widthPx/heightPx — a lie there means
    // pins land off-image or get refused at legitimate locations).
    //
    // Tolerance: 5%. The client may legitimately downscale/upscale by
    // a hair due to floating-point rounding when reading natural
    // dimensions in JS. Anything past 5% is either a bug in the
    // client or hostile.
    const probed = probeImageDimensions(file.buffer);
    if (probed) {
      const wDiff = Math.abs(widthPx - probed.width) / probed.width;
      const hDiff = Math.abs(heightPx - probed.height) / probed.height;
      if (wDiff > 0.05 || hDiff > 0.05) {
        this.logger.warn(
          `[FloorPlan] Client widthPx/heightPx (${widthPx}x${heightPx}) ` +
          `differ from probed dimensions (${probed.width}x${probed.height}) ` +
          `by more than 5%. Overriding with probed values.`,
        );
        widthPx = probed.width;
        heightPx = probed.height;
      }
    } else {
      // Couldn't determine dimensions from header — log so we know if
      // a customer hits an exotic-but-valid format the parser missed.
      // We don't reject the upload; the client value is the best we
      // have. Implausible client values (negative, zero, above the
      // 10000 cap) were already rejected above.
      if (widthPx < 16 || heightPx < 16 || widthPx > 16384 || heightPx > 16384) {
        this.logger.warn(
          `[FloorPlan] Could not probe image dimensions and client ` +
          `widthPx/heightPx (${widthPx}x${heightPx}) look implausible.`,
        );
      } else {
        this.logger.log(
          `[FloorPlan] Could not probe image dimensions; trusting ` +
          `client values (${widthPx}x${heightPx}).`,
        );
      }
    }

    // Upload to Supabase storage. Path is tenant-scoped so a stray URL
    // can't leak across tenants if it ever escapes the public bucket.
    const ext = (file.originalname.split('.').pop() || 'png').toLowerCase().slice(0, 6);
    const filePath = `${tenantId}/floor-plans/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    let publicUrl: string;
    try {
      publicUrl = await this.storage.upload(filePath, file.buffer, file.mimetype);
    } catch (err: any) {
      this.logger.error(`Floor plan upload failed: ${err?.message || err}`);
      throw new HttpException(
        'Failed to upload floor plan image. Check storage configuration.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const plan = await (this.prisma.client as any).floorPlan.create({
      data: {
        tenantId,
        name,
        buildingLabel: body.buildingLabel?.trim().slice(0, 200) || null,
        floorLabel: body.floorLabel?.trim().slice(0, 100) || null,
        imageUrl: publicUrl,
        widthPx: Math.round(widthPx),
        heightPx: Math.round(heightPx),
      },
    });

    // Audit. Floor plans are sensitive operational data — log who
    // uploaded what so a compromise is forensically traceable.
    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'CREATE_FLOOR_PLAN',
          targetType: 'floor_plan',
          targetId: plan.id,
          details: JSON.stringify({ name, buildingLabel: body.buildingLabel, floorLabel: body.floorLabel, widthPx, heightPx }),
        },
      });
    } catch { /* swallow — audit failure shouldn't fail the request */ }

    return plan;
  }

  // ─── Rename / relabel ─────────────────────────────────────────

  @Put(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { name?: string; buildingLabel?: string; floorLabel?: string },
  ) {
    const tenantId = req.user.tenantId;
    const existing = await (this.prisma.client as any).floorPlan.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      throw new HttpException('Floor plan not found', HttpStatus.NOT_FOUND);
    }
    const data: any = {};
    if (typeof body.name === 'string') data.name = body.name.trim().slice(0, 200);
    if (typeof body.buildingLabel === 'string') data.buildingLabel = body.buildingLabel.trim().slice(0, 200) || null;
    if (typeof body.floorLabel === 'string') data.floorLabel = body.floorLabel.trim().slice(0, 100) || null;
    const updated = await (this.prisma.client as any).floorPlan.update({ where: { id }, data });
    return updated;
  }

  // ─── Delete ───────────────────────────────────────────────────

  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    const tenantId = req.user.tenantId;
    const existing = await (this.prisma.client as any).floorPlan.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      throw new HttpException('Floor plan not found', HttpStatus.NOT_FOUND);
    }

    // Detach all screens before delete — Screen.floorPlanId is nullable
    // and we want the screens to revert to "unplaced" status, not error
    // out on a foreign-key cascade. Single transaction so the audit log
    // matches reality.
    await this.prisma.client.$transaction([
      this.prisma.client.screen.updateMany({
        where: { tenantId, floorPlanId: id },
        data: { floorPlanId: null, floorX: null, floorY: null },
      }),
      (this.prisma.client as any).floorPlan.delete({ where: { id } }),
    ]);

    try {
      await this.prisma.client.auditLog.create({
        data: {
          tenantId,
          userId: req.user.id,
          action: 'DELETE_FLOOR_PLAN',
          targetType: 'floor_plan',
          targetId: id,
          details: JSON.stringify({ name: existing.name }),
        },
      });
    } catch { /* swallow */ }

    return { ok: true };
  }

  // ─── Place / move a screen on the plan ────────────────────────

  @Put(':id/screens/:screenId')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async placeScreen(
    @Request() req: any,
    @Param('id') id: string,
    @Param('screenId') screenId: string,
    @Body() body: { floorX: number; floorY: number },
  ) {
    const tenantId = req.user.tenantId;
    const plan = await (this.prisma.client as any).floorPlan.findFirst({
      where: { id, tenantId },
    });
    if (!plan) {
      throw new HttpException('Floor plan not found', HttpStatus.NOT_FOUND);
    }
    const screen = await this.prisma.client.screen.findFirst({
      where: { id: screenId, tenantId },
    });
    if (!screen) {
      throw new HttpException('Screen not found', HttpStatus.NOT_FOUND);
    }

    const fx = Number(body.floorX);
    const fy = Number(body.floorY);
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) {
      throw new HttpException('floorX and floorY must be numbers', HttpStatus.BAD_REQUEST);
    }
    if (fx < 0 || fy < 0 || fx > plan.widthPx || fy > plan.heightPx) {
      throw new HttpException('Coordinates out of plan bounds', HttpStatus.BAD_REQUEST);
    }

    const updated = await this.prisma.client.screen.update({
      where: { id: screenId },
      data: { floorPlanId: id, floorX: fx, floorY: fy } as any,
    });
    return updated;
  }

  // ─── Detach a screen from the plan ────────────────────────────

  @Delete(':id/screens/:screenId')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async detachScreen(
    @Request() req: any,
    @Param('id') id: string,
    @Param('screenId') screenId: string,
  ) {
    const tenantId = req.user.tenantId;
    const screen = await this.prisma.client.screen.findFirst({
      where: { id: screenId, tenantId, floorPlanId: id } as any,
    });
    if (!screen) {
      throw new HttpException('Screen not on this plan', HttpStatus.NOT_FOUND);
    }
    const updated = await this.prisma.client.screen.update({
      where: { id: screenId },
      data: { floorPlanId: null, floorX: null, floorY: null } as any,
    });
    return updated;
  }
}
