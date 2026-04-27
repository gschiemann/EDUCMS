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
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
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
            status: true,
            lastPingAt: true,
          },
        },
      },
    });
    return plans;
  }

  // ─── Single (with screens + zones) ─────────────────────────────

  @Get(':id')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
    AppRole.RESTRICTED_VIEWER,
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
            status: true,
            lastPingAt: true,
            screenGroupId: true,
            location: true,
          },
        },
      },
    });
    if (!plan) {
      throw new HttpException('Floor plan not found', HttpStatus.NOT_FOUND);
    }
    return plan;
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
    const widthPx = Number(body.widthPx);
    const heightPx = Number(body.heightPx);
    if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
      throw new HttpException(
        'widthPx and heightPx are required and must be positive numbers (the image dimensions).',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (widthPx > 10000 || heightPx > 10000) {
      throw new HttpException(
        'Floor plan image must be ≤ 10000px in each dimension.',
        HttpStatus.BAD_REQUEST,
      );
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
