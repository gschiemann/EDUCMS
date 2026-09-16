/**
 * FloorPlansController — Sprint 8b Phase 1.
 *
 * Endpoints (all under /api/v1/floor-plans, all tenant-scoped, RBAC-gated):
 *   POST   /                      — upload image + create plan (multipart)
 *   GET    /                      — list all plans for caller's tenant
 *   GET    /:id                   — single plan with placed screens
 *   PUT    /:id                   — rename / relabel AND/OR replace the
 *                                    plan image (optional multipart
 *                                    `file`; every screen placement is
 *                                    rescaled, never discarded)
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
// The image-dimension probe this controller introduced (2026-05-03,
// emergency-BUG-008) now lives in `../storage/image-header` unchanged, because
// design import needs the same header read and two copies of a byte parser is
// two places to fix a format bug (re-audit R7, 2026-09-16).
import { probeImageDimensions } from '../storage/image-header';

const ALLOWED_FLOOR_PLAN_MIMES = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/**
 * Multer options shared by the two routes that accept a plan image —
 * `POST /` (new plan) and `PUT /:id` (replace the image on an existing
 * plan). Identical caps and MIME allow-list by construction: a replace
 * that quietly accepted something the create route refuses would be a
 * hole, not a feature.
 */
const FLOOR_PLAN_UPLOAD_OPTIONS = {
  storage: memoryStorage(),
  // Floor plans are typically tens of MB at most. 25MB cap matches
  // architectural-PNG sizes from major CAD exports.
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req: any, file: any, cb: any) => {
    if (ALLOWED_FLOOR_PLAN_MIMES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
};

/**
 * How far two aspect ratios may differ before we call the plan a
 * different SHAPE. 1% absorbs the rounding you get re-exporting the same
 * drawing at a different resolution (e.g. 3000×2000 → 1499×1000) while
 * still catching a genuine reframe (landscape → portrait, a cropped
 * wing) — the case where a rescaled pin keeps its fraction of the plan
 * but no longer sits over the same room.
 */
const ASPECT_TOLERANCE = 0.01;

/** Result of an image swap, returned to the operator's UI and audited. */
type FloorPlanImageReplaceSummary = {
  /** Placements carried across the swap. Never zero-ed out by a replace. */
  placementsKept: number;
  /** True when the new image is a different SHAPE — pins may need a nudge. */
  aspectRatioChanged: boolean;
  previousWidthPx: number;
  previousHeightPx: number;
  widthPx: number;
  heightPx: number;
};

/**
 * Rescaled pin coordinate, clamped into the new plan's bounds.
 * Proportional rescaling can only land inside [0, max] for a coordinate
 * that was already in bounds, but placements predate several revisions of
 * the bounds check — clamp rather than trust, since an out-of-bounds
 * floorX is a pin the operator can no longer see or drag.
 */
function clampCoord(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
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

/** Short TTL for signed floor-plan image URLs. Long enough for the operator
 *  to view/drag the plan in one session; short enough that a leaked URL
 *  (history / referrer / cache) stops resolving quickly. */
const FLOOR_PLAN_SIGNED_URL_TTL_SECONDS = 15 * 60; // 15 min

@Controller('api/v1/floor-plans')
@UseGuards(JwtAuthGuard, RbacGuard)
export class FloorPlansController {
  private readonly logger = new Logger(FloorPlansController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
  ) {}

  /**
   * Replace a plan's permanent public `imageUrl` with a short-TTL SIGNED URL
   * generated at read time (Audit 37-infra F-1 — Sprint-8b "signed short-TTL"
   * requirement for sensitive building layouts). Derives the storage path
   * from the stored URL (no schema change / migration needed) and re-signs.
   * If signing fails for any reason, the stored URL is left as-is so the
   * page never breaks — degrade gracefully, never blank the plan.
   */
  private async withSignedImageUrl<T extends { imageUrl?: string | null }>(plan: T): Promise<T> {
    if (!plan || !plan.imageUrl) return plan;
    // Derive BOTH bucket + path from the stored URL so we sign against the
    // bucket the object actually lives in (launch-readiness P1): old floor
    // plans live in the public `assets` bucket, new ones in the private
    // `floor-plans` bucket. Signing against the wrong bucket would 404.
    const parsed = this.storage.parseObjectUrl(plan.imageUrl);
    if (!parsed) return plan; // unrecognized URL shape — leave untouched
    const signed = await this.storage.createSignedUrl(
      parsed.path,
      FLOOR_PLAN_SIGNED_URL_TTL_SECONDS,
      parsed.bucket,
    );
    return signed ? { ...plan, imageUrl: signed } : plan;
  }

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
    const withStatus = plans.map((plan: any) => withLiveFloorPlanScreenStatus(plan, now));
    // Sign each plan's image URL on read (short-TTL). Parallel — N is small
    // (one row per building/floor).
    return Promise.all(withStatus.map((plan: any) => this.withSignedImageUrl(plan)));
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
      throw new HttpException({ code: 'FLOOR_PLAN_NOT_FOUND', message: 'Floor plan not found' }, HttpStatus.NOT_FOUND);
    }
    return this.withSignedImageUrl(withLiveFloorPlanScreenStatus(plan));
  }

  // ─── Shared image ingest (create + replace) ───────────────────

  /**
   * The ONE path that turns an uploaded file into a stored plan image.
   *
   * Extracted 2026-08-25 when `PUT /:id` learned to replace the image.
   * The server-side dimension probe above is what keeps the pin math
   * honest (a client that lies about widthPx/heightPx corrupts every
   * placement), and a second hand-written copy of this path is exactly
   * how that protection rots. So: one probe, one upload, one error
   * mapping, used by both routes.
   *
   * Returns the stored (private-bucket) URL plus the AUTHORITATIVE
   * dimensions — probed from the header bytes whenever we can read
   * them, client-supplied only when the probe can't parse the format.
   */
  private async ingestPlanImage(
    tenantId: string,
    file: Express.Multer.File,
    claimedWidthPx: string | number | undefined,
    claimedHeightPx: string | number | undefined,
  ): Promise<{ imageUrl: string; widthPx: number; heightPx: number }> {
    let widthPx = Number(claimedWidthPx);
    let heightPx = Number(claimedHeightPx);
    if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
      throw new HttpException(
        { code: 'FLOOR_PLAN_DIMENSIONS_INVALID', message: 'widthPx and heightPx are required and must be positive numbers (the image dimensions).' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (widthPx > 10000 || heightPx > 10000) {
      throw new HttpException(
        { code: 'FLOOR_PLAN_DIMENSIONS_TOO_LARGE', message: 'Floor plan image must be 10000px or less in each dimension.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // 2026-05-25 BUG FIX — on Railway/Docker, multer sometimes hands us
    // `file.buffer` as a raw Uint8Array, NOT a Node Buffer. Buffer-only
    // methods (`.readUInt32BE`, `.readUInt16BE`) used inside
    // probeImageDimensions then throw `TypeError: <fn> is not a function`,
    // which escapes the controller as a plain Error → AllExceptionsFilter
    // returns the generic 500 INTERNAL_ERROR/"Internal server error"
    // envelope instead of an actionable message. Normalize once up front
    // and reuse the safe Buffer everywhere downstream (probe + upload +
    // hashing). Same SupabaseStorageService.toSafeBuffer the assets
    // controller already uses for the same reason.
    const safeBuffer = this.storage.toSafeBuffer(file.buffer);

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
    const probed = probeImageDimensions(safeBuffer);
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

    // Upload to the PRIVATE floor-plan bucket (launch-readiness P1). Floor
    // plans are operational-security data (building layouts + exits); the
    // public `assets` bucket would expose them to anyone with the URL forever.
    // The private bucket's bytes are only retrievable via the short-TTL signed
    // URL minted on read (withSignedImageUrl) from these RBAC-gated endpoints.
    // Path is also tenant-scoped as defense in depth.
    //
    // A REPLACE always writes a NEW path — it never overwrites the old
    // object. The previous object is left in the bucket exactly the way a
    // DELETED plan's is (see remove() below, which also leaves it): one
    // storage-reconciliation sweep covers both classes, and neither path can
    // ever unlink bytes that a live row still points at.
    const rawOriginalName = typeof file.originalname === 'string' ? file.originalname : '';
    const ext = (rawOriginalName.split('.').pop() || 'png').toLowerCase().slice(0, 6) || 'png';
    const filePath = `${tenantId}/floor-plans/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    // Stored URL (private bucket → not world-readable; re-signed on every read).
    let publicUrl: string;
    try {
      publicUrl = await this.storage.uploadToBucket(
        this.storage.floorPlanBucketName(),
        filePath,
        safeBuffer,
        file.mimetype,
      );
    } catch (err: any) {
      const detail = err?.message ? String(err.message).slice(0, 400) : 'storage upload failed';
      this.logger.error(
        `[FloorPlan] Storage upload failed: tenant=${tenantId} size=${safeBuffer.length} ` +
          `mime=${file.mimetype} err=${detail}`,
      );
      // Map Supabase-specific failures to actionable HTTP statuses.
      const status =
        /maximum allowed size|payload too large|exceeded/i.test(detail)
          ? HttpStatus.PAYLOAD_TOO_LARGE
          : /mime|content-type|not allowed/i.test(detail)
            ? HttpStatus.UNSUPPORTED_MEDIA_TYPE
            : HttpStatus.BAD_GATEWAY;
      const storageCode =
        status === HttpStatus.PAYLOAD_TOO_LARGE
          ? 'FLOOR_PLAN_UPLOAD_TOO_LARGE'
          : status === HttpStatus.UNSUPPORTED_MEDIA_TYPE
            ? 'FLOOR_PLAN_UPLOAD_MEDIA_TYPE_INVALID'
            : 'FLOOR_PLAN_UPLOAD_STORAGE_FAILED';
      throw new HttpException(
        { code: storageCode, message: `Could not save the floor plan to storage: ${detail}` },
        status,
      );
    }

    return { imageUrl: publicUrl, widthPx: Math.round(widthPx), heightPx: Math.round(heightPx) };
  }

  // ─── Create / upload ──────────────────────────────────────────

  @Post()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @UseInterceptors(FileInterceptor('file', FLOOR_PLAN_UPLOAD_OPTIONS))
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
        { code: 'FLOOR_PLAN_FILE_MISSING', message: 'No file uploaded, or file type not supported. Allowed: PNG, JPG, WEBP.' },
        HttpStatus.BAD_REQUEST,
      );
    }
    const tenantId = req.user?.tenantId;
    const userId = req.user?.id;
    if (!tenantId) {
      throw new HttpException({ code: 'FLOOR_PLAN_AUTH_REQUIRED', message: 'Authentication required.' }, HttpStatus.UNAUTHORIZED);
    }
    const name = (body.name || 'Untitled floor').trim().slice(0, 200);

    const image = await this.ingestPlanImage(tenantId, file, body.widthPx, body.heightPx);

    let plan: any;
    try {
      plan = await (this.prisma.client as any).floorPlan.create({
        data: {
          tenantId,
          name,
          buildingLabel: body.buildingLabel?.trim().slice(0, 200) || null,
          floorLabel: body.floorLabel?.trim().slice(0, 100) || null,
          imageUrl: image.imageUrl,
          widthPx: image.widthPx,
          heightPx: image.heightPx,
        },
      });
    } catch (err: any) {
      // Prisma errors normally land in AllExceptionsFilter's Prisma
      // branch (DATABASE_ERROR), but if the row creation fails AFTER
      // the storage upload succeeded we want an actionable surface for
      // the operator — and a log line so a stray orphaned upload can
      // be reconciled later.
      this.logger.error(
        `[FloorPlan] DB row creation failed after upload succeeded: tenant=${tenantId} ` +
          `url=${image.imageUrl} err=${err?.message || err}`,
      );
      throw err;
    }

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
          details: JSON.stringify({
            name,
            buildingLabel: body.buildingLabel,
            floorLabel: body.floorLabel,
            widthPx: image.widthPx,
            heightPx: image.heightPx,
          }),
        },
      });
    } catch { /* swallow — audit failure shouldn't fail the request */ }

    // Return a signed short-TTL image URL — never the permanent public one
    // (Audit 37-infra F-1). The path-derived public URL stays in the DB row.
    return this.withSignedImageUrl(plan);
  }

  // ─── Rename / relabel / REPLACE THE IMAGE ─────────────────────
  //
  // 2026-08-25 — operator: "add change so i can swap images and not just
  // delete and add". Until now the only way to put a corrected drawing on
  // an existing plan was: upload a second plan, re-place every pin by hand,
  // delete the first. Placements belong to the plan row
  // (Screen.floorPlanId + floorX + floorY) and DELETE detaches every one of
  // them, so that route destroyed the operator's placement work every time.
  //
  // WHY THIS ROUTE AND NOT A NEW ONE: swapping the drawing IS an update to
  // the plan the operator already has open — they routinely rename/relabel
  // in the same breath ("Floor 1" → "Floor 1, 2026 remodel"). The tenant
  // ownership check, the audit convention and the response shape are all
  // identical, so a second route would only be somewhere for the two to
  // drift apart. multer's middleware is a no-op on a non-multipart request,
  // so existing JSON rename callers keep working untouched.
  //
  // PIN GEOMETRY — the whole risk. floorX/floorY are stored as ABSOLUTE
  // PIXELS in the plan image's own coordinate space, and the UI renders
  // them as a FRACTION of the plan box (left% = floorX / plan.widthPx).
  // A new image with different pixel dimensions would therefore move every
  // pin, so we rescale each placement by (newW/oldW, newH/oldH). That keeps
  // the fraction — and so, on a same-shape plan, the exact physical spot
  // the operator put it. Placements are NEVER discarded.
  //
  // When the ASPECT RATIO differs the fraction is still kept, but the
  // picture underneath it is framed differently, so a pin can land off its
  // room. We do NOT silently decide the screens moved: `aspectRatioChanged`
  // comes back on the response (and lands in the audit row) and the UI warns
  // the operator both before and after the swap.

  @Put(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @UseInterceptors(FileInterceptor('file', FLOOR_PLAN_UPLOAD_OPTIONS))
  async update(
    @Request() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: {
      name?: string;
      buildingLabel?: string;
      floorLabel?: string;
      widthPx?: string | number;
      heightPx?: string | number;
      /** '1' when the caller is swapping the image — see the guard below. */
      replaceImage?: string;
    },
  ) {
    const tenantId = req.user.tenantId;
    const existing = await (this.prisma.client as any).floorPlan.findFirst({
      where: { id, tenantId },
    });
    if (!existing) {
      throw new HttpException({ code: 'FLOOR_PLAN_NOT_FOUND', message: 'Floor plan not found' }, HttpStatus.NOT_FOUND);
    }

    // The operator asked for a swap but multer handed us nothing — the
    // fileFilter rejected the MIME type, or the 25MB limit bit. Say so
    // instead of silently doing a label-only update and letting the
    // operator walk away believing the drawing changed.
    if (!file && String(body.replaceImage ?? '') === '1') {
      throw new HttpException(
        { code: 'FLOOR_PLAN_FILE_MISSING', message: 'No file uploaded, or file type not supported. Allowed: PNG, JPG, WEBP.' },
        HttpStatus.BAD_REQUEST,
      );
    }

    const data: any = {};
    if (typeof body.name === 'string') data.name = body.name.trim().slice(0, 200);
    if (typeof body.buildingLabel === 'string') data.buildingLabel = body.buildingLabel.trim().slice(0, 200) || null;
    if (typeof body.floorLabel === 'string') data.floorLabel = body.floorLabel.trim().slice(0, 100) || null;

    let imageReplace: FloorPlanImageReplaceSummary | null = null;
    let rescaleOps: any[] = [];
    // Snapshot BEFORE the write — the audit row's whole value is naming the
    // object the plan pointed at before the swap, so it must not be read
    // back off a row the update has already touched.
    const previousImageUrl = typeof existing.imageUrl === 'string' ? existing.imageUrl : null;
    const previousName = existing.name;

    if (file) {
      const image = await this.ingestPlanImage(tenantId, file, body.widthPx, body.heightPx);
      const oldW = Number(existing.widthPx);
      const oldH = Number(existing.heightPx);
      const usableOld = Number.isFinite(oldW) && oldW > 0 && Number.isFinite(oldH) && oldH > 0;
      const sx = usableOld ? image.widthPx / oldW : 1;
      const sy = usableOld ? image.heightPx / oldH : 1;
      const aspectRatioChanged = usableOld
        ? Math.abs(image.widthPx / image.heightPx - oldW / oldH) / (oldW / oldH) > ASPECT_TOLERANCE
        : false;

      // Read the placements, then write each one back tenant + plan scoped.
      // Read-then-write rather than a blind atomic multiply so the new
      // coordinates can be clamped into the new bounds and the operator can
      // be told exactly how many pins were carried over.
      const placed = await this.prisma.client.screen.findMany({
        where: { tenantId, floorPlanId: id, floorX: { not: null }, floorY: { not: null } } as any,
        select: { id: true, floorX: true, floorY: true } as any,
      });

      if (sx !== 1 || sy !== 1) {
        rescaleOps = placed.map((s: any) =>
          this.prisma.client.screen.updateMany({
            // Scoped by tenant AND plan — never a bare-id write.
            where: { id: s.id, tenantId, floorPlanId: id } as any,
            data: {
              floorX: clampCoord(Number(s.floorX) * sx, image.widthPx),
              floorY: clampCoord(Number(s.floorY) * sy, image.heightPx),
            } as any,
          }),
        );
      }

      data.imageUrl = image.imageUrl;
      data.widthPx = image.widthPx;
      data.heightPx = image.heightPx;
      imageReplace = {
        placementsKept: placed.length,
        aspectRatioChanged,
        previousWidthPx: usableOld ? oldW : 0,
        previousHeightPx: usableOld ? oldH : 0,
        widthPx: image.widthPx,
        heightPx: image.heightPx,
      };
    }

    // One transaction: the new dimensions and the rescaled pins land
    // together or not at all. A half-applied swap would leave every pin
    // sitting at the wrong fraction of the plan.
    const ops = [
      ...rescaleOps,
      (this.prisma.client as any).floorPlan.update({ where: { id, tenantId }, data }),
    ];
    let updated: any;
    try {
      const results = await this.prisma.client.$transaction(ops);
      updated = results[results.length - 1];
    } catch (err: any) {
      if (imageReplace) {
        // The bytes are already in the bucket but the row still points at
        // the old image — log the orphan so it can be reconciled.
        this.logger.error(
          `[FloorPlan] Image replace transaction failed after upload succeeded: ` +
            `tenant=${tenantId} plan=${id} url=${data.imageUrl} err=${err?.message || err}`,
        );
      }
      throw err;
    }

    if (imageReplace) {
      // Audit — same convention as CREATE/DELETE_FLOOR_PLAN. Carries the
      // previous image URL so a bad swap is reversible by hand, plus the pin
      // count and the aspect verdict so a "my screens moved" report is
      // answerable after the fact.
      try {
        await this.prisma.client.auditLog.create({
          data: {
            tenantId,
            userId: req.user.id,
            action: 'REPLACE_FLOOR_PLAN_IMAGE',
            targetType: 'floor_plan',
            targetId: id,
            details: JSON.stringify({
              name: updated?.name ?? previousName,
              previousImageUrl,
              previousWidthPx: imageReplace.previousWidthPx,
              previousHeightPx: imageReplace.previousHeightPx,
              widthPx: imageReplace.widthPx,
              heightPx: imageReplace.heightPx,
              aspectRatioChanged: imageReplace.aspectRatioChanged,
              placementsKept: imageReplace.placementsKept,
            }),
          },
        });
      } catch { /* swallow — audit failure shouldn't fail the request */ }
    }

    // Sign the image URL on read-back, same as every other route that
    // returns a plan — the stored URL points at the PRIVATE bucket and
    // would not load in the operator's browser.
    const signed = await this.withSignedImageUrl(updated);
    return imageReplace ? { ...signed, imageReplace } : signed;
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
      throw new HttpException({ code: 'FLOOR_PLAN_NOT_FOUND', message: 'Floor plan not found' }, HttpStatus.NOT_FOUND);
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
      (this.prisma.client as any).floorPlan.delete({ where: { id, tenantId } }),
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
      throw new HttpException({ code: 'FLOOR_PLAN_NOT_FOUND', message: 'Floor plan not found' }, HttpStatus.NOT_FOUND);
    }
    const screen = await this.prisma.client.screen.findFirst({
      where: { id: screenId, tenantId },
    });
    if (!screen) {
      throw new HttpException({ code: 'FLOOR_PLAN_SCREEN_NOT_FOUND', message: 'Screen not found' }, HttpStatus.NOT_FOUND);
    }

    const fx = Number(body.floorX);
    const fy = Number(body.floorY);
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) {
      throw new HttpException({ code: 'FLOOR_PLAN_COORDINATES_INVALID', message: 'floorX and floorY must be numbers' }, HttpStatus.BAD_REQUEST);
    }
    if (fx < 0 || fy < 0 || fx > plan.widthPx || fy > plan.heightPx) {
      throw new HttpException({ code: 'FLOOR_PLAN_COORDINATES_OUT_OF_BOUNDS', message: 'Coordinates out of plan bounds' }, HttpStatus.BAD_REQUEST);
    }

    const updated = await this.prisma.client.screen.update({
      where: { id: screenId, tenantId },
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
      throw new HttpException({ code: 'FLOOR_PLAN_SCREEN_NOT_ON_PLAN', message: 'Screen not on this plan' }, HttpStatus.NOT_FOUND);
    }
    const updated = await this.prisma.client.screen.update({
      where: { id: screenId, tenantId },
      data: { floorPlanId: null, floorX: null, floorY: null } as any,
    });
    return updated;
  }
}
