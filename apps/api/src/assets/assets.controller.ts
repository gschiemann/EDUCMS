import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request,
  UseInterceptors, UploadedFile, HttpException, HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { extname } from 'path';
import { randomUUID, createHash } from 'crypto';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import {
  MediaOptimizationService,
  VIDEO_WARN_SIZE_BYTES,
} from '../storage/media-optimization.service';
import { EmailService } from '../email/email.service';
import { Logger } from '@nestjs/common';
import { AiAltTextService, AiAltTextQuotaError } from '../ai/ai-alt-text.service';
import { isEligibleNow } from '../common/schedule-eligibility';

// Browser-playable formats only. Cross-browser support is non-negotiable
// for digital signage (CLAUDE.md "Cross-browser support" section): every
// asset has to render on Mac Safari + Windows Edge + Android WebView with
// the same source file. That excludes:
//
//   * `video/quicktime` (.mov) — Apple-only container. Many .mov files
//     are TRUE QuickTime (`ftyp=qt  `) which Chromium/WebKit refuse to
//     decode regardless of the MIME header. Even iPhone-style .mov
//     (`ftyp=mp42`) plays inconsistently. 2026-05-13: a customer's
//     IMG_*.mov from an iPhone shipped to a Taurus controller, the
//     Android WebView refused it, splash screen forever.
//   * `video/x-msvideo` (.avi) — Chromium dropped support in 2014, no
//     mainstream browser plays AVI today.
//
// If an operator hits this list with a .mov or .avi, the assertUploadIntent
// error message tells them to export as MP4 (H.264) — universal.
// image/svg+xml is intentionally NOT allowed in the media library. Two
// reasons, in order of importance:
//   1) The main upload path is presign → direct browser→Supabase, so the
//      server never sees the bytes and CANNOT sanitize an SVG before it
//      lands in storage. Asset SVGs are rendered raw elsewhere, so an
//      unsanitized one is a stored-XSS vector (<script>, on* handlers,
//      <foreignObject>, javascript: xlink:href).
//   2) Logos — the one place SVG fidelity matters — already have a safe,
//      server-sanitized path: the Brand Kit flow (BrandingController.adopt
//      + sanitizeLogoSvg / DOMPurify). Operators who want an SVG logo go
//      there. assertUploadIntent() below returns a friendly message that
//      points them at it instead of a generic "unsupported format."
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/x-icon', 'image/bmp',
  'video/mp4', 'video/webm', 'video/x-m4v',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4',
  'application/pdf',
];

// Filename extensions we explicitly REJECT before normalization, so the
// operator gets a clear actionable error ("export as MP4") instead of a
// silently-failing "file type is not supported" — same gate also applied
// in the web client's pre-upload check.
const REJECTED_EXTENSIONS: Record<string, string> = {
  '.mov': "QuickTime .mov files aren't supported by all browsers (they fail to play on Android signage players and Windows Edge). Please export as MP4 (H.264) — in QuickTime Player: File → Export As → 1080p, then upload the .mp4.",
  '.avi': "AVI files aren't supported by browsers. Please convert to MP4 (H.264) before uploading.",
};
const REJECTED_MIMES: Record<string, string> = {
  'video/quicktime': REJECTED_EXTENSIONS['.mov'],
  'video/x-msvideo': REJECTED_EXTENSIONS['.avi'],
};

const MAX_ASSET_FILE_SIZE = 500 * 1024 * 1024;
// Per-type caps (Supabase egress hardening 2026-05-23). Signage content
// has a sweet spot — 1080p H.264 at 5 Mbps is broadcast-tier on a wall
// and 30-50 MB for a typical 60-second loop. A raw 200 MB phone export
// is 4× more than the screen can resolve and serves as a CDN-miss
// egress bomb. Cap matched to "best content on the display + zero
// egress overage" tradeoff. Audio is rare here and small; PDFs are
// usually logos/branding.
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;        // 50 MB — 60s 1080p @ 5Mbps
const MAX_IMAGE_SIZE_RAW = 25 * 1024 * 1024;    // 25 MB raw — optimizer brings to ~0.5 MB WebP
const MAX_AUDIO_SIZE = 25 * 1024 * 1024;        // 25 MB
const MAX_PDF_SIZE = 25 * 1024 * 1024;          // 25 MB

/**
 * Single source of truth for the per-type size caps. Returns an
 * `HttpException` (PAYLOAD_TOO_LARGE) carrying the friendly, actionable
 * per-type message when `size` (in bytes) exceeds the cap for `mimeType`,
 * or `null` when the size is within the cap (or unknown/non-positive).
 *
 * Deliberately factored out of `assertUploadIntent` so the EXACT same
 * caps + messages can be enforced against REAL bytes, not just the
 * client-CLAIMED size:
 *   - #7 (legacy multipart POST /assets/upload): the real buffer length
 *     is in-process, so we enforce here BEFORE storing.
 *   - #6 (presigned finalize POST /assets/complete-upload): the presign
 *     step can only see the client-CLAIMED size (inherent to presigning);
 *     the real stored size only becomes known at finalize via
 *     `storage.getObjectInfo()`. We re-run this check against that real
 *     size and delete the orphaned object if it's over cap.
 *
 * Pure function (no `this`) so it is trivially unit-testable and can't
 * drift from the claimed-size check inside `assertUploadIntent`.
 */
export function perTypeSizeCapError(mimeType: string, size: number): HttpException | null {
  const numSize = Number(size);
  if (!Number.isFinite(numSize) || numSize <= 0) return null;
  const mt = (mimeType || '').toLowerCase();
  if (mt.startsWith('video/') && numSize > MAX_VIDEO_SIZE) {
    return new HttpException({ code: 'ASSET_VIDEO_TOO_LARGE', message: `Video is too large for signage (${Math.round(numSize / (1024 * 1024))} MB). ` +
        `Max is ${Math.round(MAX_VIDEO_SIZE / (1024 * 1024))} MB — plenty for a clean 1080p loop ` +
        `at signage-tier quality. Compress with HandBrake (free, handbrake.fr), iMovie's ` +
        `"Share → File → 1080p", or your phone's built-in "Save as smaller file" option, then try again.` }, HttpStatus.PAYLOAD_TOO_LARGE);
  }
  if (mt.startsWith('image/') && numSize > MAX_IMAGE_SIZE_RAW) {
    return new HttpException({ code: 'ASSET_IMAGE_TOO_LARGE', message: `Image is too large (${Math.round(numSize / (1024 * 1024))} MB). ` +
        `Max is ${Math.round(MAX_IMAGE_SIZE_RAW / (1024 * 1024))} MB. ` +
        `Our optimizer can shrink most raw photos to under 0.5 MB without visible loss — ` +
        `but at this size your phone may be uploading an uncompressed RAW or HEIC original. ` +
        `Export as JPG/PNG/WebP first.` }, HttpStatus.PAYLOAD_TOO_LARGE);
  }
  if (mt.startsWith('audio/') && numSize > MAX_AUDIO_SIZE) {
    return new HttpException({ code: 'ASSET_AUDIO_TOO_LARGE', message: `Audio is too large (${Math.round(numSize / (1024 * 1024))} MB). ` +
        `Max is ${Math.round(MAX_AUDIO_SIZE / (1024 * 1024))} MB.` }, HttpStatus.PAYLOAD_TOO_LARGE);
  }
  if (mt === 'application/pdf' && numSize > MAX_PDF_SIZE) {
    return new HttpException({ code: 'ASSET_PDF_TOO_LARGE', message: `PDF is too large (${Math.round(numSize / (1024 * 1024))} MB). ` +
        `Max is ${Math.round(MAX_PDF_SIZE / (1024 * 1024))} MB.` }, HttpStatus.PAYLOAD_TOO_LARGE);
  }
  return null;
}
const EXTENSION_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  // '.svg': 'image/svg+xml',  // Lane-1 P1: temporarily disabled — see ALLOWED_TYPES comment.
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf',
};

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  // 'image/svg+xml': '.svg',  // Lane-1 P1: temporarily disabled.
  'image/x-icon': '.ico',
  'image/bmp': '.bmp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/x-m4v': '.m4v',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/mp4': '.m4a',
  'application/pdf': '.pdf',
};

const SCREEN_EMERGENCY_ASSET_FIELDS = [
  'emergencyLockdownAssetUrl',
  'emergencyEvacuateAssetUrl',
  'emergencyWeatherAssetUrl',
  'emergencyHoldAssetUrl',
  'emergencySecureAssetUrl',
  'emergencyMedicalAssetUrl',
  'emergencyLockdownPortraitAssetUrl',
  'emergencyEvacuatePortraitAssetUrl',
  'emergencyWeatherPortraitAssetUrl',
  'emergencyHoldPortraitAssetUrl',
  'emergencySecurePortraitAssetUrl',
  'emergencyMedicalPortraitAssetUrl',
] as const;

const SCREEN_EMERGENCY_ASSET_SELECT = SCREEN_EMERGENCY_ASSET_FIELDS.reduce<Record<string, true>>((acc, field) => {
  acc[field] = true;
  return acc;
}, {});

@Controller('api/v1/assets')
@UseGuards(JwtAuthGuard, RbacGuard)
export class AssetsController {
  private readonly logger = new Logger(AssetsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
    private readonly email: EmailService,
    private readonly mediaOpt: MediaOptimizationService,
    private readonly aiAltText: AiAltTextService,
  ) {}

  /**
   * Audit P1-2 (2026-05-28) — fire-and-forget alt-text generation.
   * Latency budget for an upload is 0ms added; we kick off the AI
   * call in the background and persist the result on success.
   *
   * Internal helper rather than an inline `void this.ai...` so the
   * shape can be unit-tested and the failure-mode logging is in one
   * place (instead of every call site). Buffer is the OPTIMIZED buffer
   * — smaller payload = faster + cheaper provider call.
   *
   * `imageBuffer` and the surrounding lookups happen lazily: the
   * upload caller passes the post-optimization bytes in directly so
   * we don't make a second round trip to storage.
   */
  private kickOffAltTextGeneration(args: {
    assetId: string;
    tenantId: string;
    userId: string;
    imageBuffer: Buffer;
    mimeType: string;
    originalName: string | null;
  }): void {
    // Skip non-images at the boundary so the AiAltTextService isn't
    // queried for video / audio / pdf uploads. Saves a Prisma read
    // (provider key lookup) on every non-image upload.
    if (!(args.mimeType || '').toLowerCase().startsWith('image/')) return;

    // Animated GIFs are uploaded as-is (the optimizer skips them);
    // alt-text still makes sense for the first frame, so don't gate.

    void this.aiAltText
      .generateImageAltText({
        tenantId: args.tenantId,
        assetId: args.assetId,
        userId: args.userId,
        imageBuffer: args.imageBuffer,
        mimeType: args.mimeType,
        contextHint: args.originalName || undefined,
      })
      .then(async (res) => {
        if (!res) return; // service handled audit logging + skip reason
        try {
          await this.prisma.client.asset.update({
            where: { id: args.assetId },
            data: { altText: res.altText } as any,
          });
        } catch (e: any) {
          this.logger.warn(
            `[assets] alt-text persist failed for ${args.assetId}: ${e?.message ?? e}`,
          );
        }
      })
      .catch((err) => {
        // Quota errors are normal background outcome (operator
        // ran out of credit) — don't crash; service already logged
        // an audit row.
        if (err instanceof AiAltTextQuotaError) return;
        this.logger.warn(
          `[assets] alt-text generation threw for ${args.assetId}: ${err?.message ?? err}`,
        );
      });
  }

  private appPublicUrl(): string {
    return process.env.APP_PUBLIC_URL || 'http://localhost:3000';
  }

  /**
   * Role-gated initial asset status. CONTRIBUTOR uploads must pass
   * through the review queue before content can be scheduled; admins
   * are trusted and auto-publish.
   */
  private initialAssetStatus(role: string | undefined): 'PUBLISHED' | 'PENDING_APPROVAL' {
    if (
      role === AppRole.SUPER_ADMIN ||
      role === AppRole.DISTRICT_ADMIN ||
      role === AppRole.SCHOOL_ADMIN
    ) return 'PUBLISHED';
    return 'PENDING_APPROVAL';
  }

  private normalizeMimeType(filename: string | undefined, contentType: string | undefined): string {
    const explicit = (contentType || '').split(';')[0].trim().toLowerCase();
    if (ALLOWED_TYPES.includes(explicit)) return explicit;

    const ext = extname(filename || '').toLowerCase();
    if (EXTENSION_MIME_TYPES[ext]) return EXTENSION_MIME_TYPES[ext];

    return explicit;
  }

  private assertUploadIntent(filename: string | undefined, contentType: string | undefined, size: number | undefined): string {
    // Surface friendly per-format guidance BEFORE the generic "not
    // supported" fall-through. .mov / .avi are the common foot-guns
    // (operators export from iMovie / QuickTime / Camtasia and don't
    // realize Android WebView refuses to play them) — telling them
    // "export as MP4" is the actionable next step, not "file type
    // not supported, sorry."
    const ext = extname(filename || '').toLowerCase();
    const explicit = (contentType || '').split(';')[0].trim().toLowerCase();
    const rejectReason = REJECTED_EXTENSIONS[ext] || REJECTED_MIMES[explicit];
    if (rejectReason) {
      throw new HttpException({ code: 'ASSET_FILE_TYPE_REJECTED', message: rejectReason }, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }

    // SVG gets its own friendly, actionable message — see the ALLOWED_TYPES
    // comment for why it isn't a media-library format. Point the operator at
    // the place SVG DOES work (Brand Kit logos) instead of a generic
    // "unsupported." Mirrors getUnsupportedReason() in the web assets page.
    if (ext === '.svg' || explicit === 'image/svg+xml') {
      throw new HttpException({ code: 'ASSET_SVG_NOT_SUPPORTED', message: "SVG isn't supported in the media library (an SVG can carry hidden scripts, so we don't store raw SVGs as content). For a logo, use Settings → Branding — that path accepts SVG safely. Otherwise export this as a PNG and upload that." }, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }

    const mimeType = this.normalizeMimeType(filename, contentType);
    if (!ALLOWED_TYPES.includes(mimeType)) {
      throw new HttpException({ code: 'ASSET_FILE_TYPE_UNSUPPORTED', message: 'File type is not supported. Allowed: images (JPG/PNG/WebP/GIF), MP4/WebM video, audio (MP3/OGG/WAV/M4A), PDF.' }, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }

    if (!Number.isFinite(size) || Number(size) <= 0) {
      throw new HttpException({ code: 'ASSET_FILE_SIZE_REQUIRED', message: 'File size is required.' }, HttpStatus.BAD_REQUEST);
    }

    if (Number(size) > MAX_ASSET_FILE_SIZE) {
      throw new HttpException({ code: 'ASSET_FILE_TOO_LARGE', message: `File is too large. Max size is ${Math.round(MAX_ASSET_FILE_SIZE / (1024 * 1024))} MB.` }, HttpStatus.PAYLOAD_TOO_LARGE);
    }

    // Per-type caps (Supabase egress hardening 2026-05-23). The 500 MB
    // outer cap is the absolute ceiling; these tighter per-type caps
    // are what actually keep egress bounded. NOTE: at this point `size`
    // is the client-CLAIMED size (this runs pre-upload on the presign
    // path and on the completeUpload re-validation). The claimed-size
    // check is a fast-fail UX nicety — the AUTHORITATIVE per-type
    // enforcement against REAL bytes happens in `upload()` (legacy
    // multipart, buffer in-process) and `completeUpload()` (presigned,
    // real size from storage.getObjectInfo) via `perTypeSizeCapError`.
    const capError = perTypeSizeCapError(mimeType, Number(size));
    if (capError) throw capError;

    return mimeType;
  }

  private storageExtension(filename: string | undefined, mimeType: string): string {
    return extname(filename || '') || MIME_EXTENSIONS[mimeType] || '';
  }

  private async resolveFolderId(tenantId: string, folderId?: string | null): Promise<string | null> {
    const bodyFolderId = (folderId || '').trim();
    if (!bodyFolderId) return null;

    const folder = await this.prisma.client.assetFolder.findFirst({
      where: { id: bodyFolderId, tenantId },
    });
    if (!folder) throw new HttpException({ code: 'ASSET_FOLDER_NOT_FOUND', message: 'Folder not found' }, HttpStatus.NOT_FOUND);
    return folder.id;
  }

  private async listScreenEmergencyAssetUrls(tenantId: string): Promise<string[]> {
    const screens = await (this.prisma.client.screen as any).findMany({
      where: { tenantId },
      select: SCREEN_EMERGENCY_ASSET_SELECT,
    }) as Array<Record<string, string | null>>;
    const urls = new Set<string>();
    for (const screen of screens) {
      for (const field of SCREEN_EMERGENCY_ASSET_FIELDS) {
        const url = screen[field];
        if (typeof url === 'string' && url.trim()) urls.add(url);
      }
    }
    return [...urls];
  }

  private screenEmergencyAssetOr(fileUrl: string) {
    return SCREEN_EMERGENCY_ASSET_FIELDS.map((field) => ({ [field]: fileUrl }));
  }

  /**
   * Notify every tenant admin that a new asset is awaiting review.
   * Uses the Notification table so the bell icon lights up immediately;
   * a follow-up sprint can bridge the same rows to email/Slack when a
   * transactional provider is wired.
   */
  private async notifyAdminsOfPendingReview(
    tenantId: string,
    asset: { id: string; originalName: string | null; uploadedByUserId: string },
  ): Promise<void> {
    try {
      const admins = await this.prisma.client.user.findMany({
        where: {
          tenantId,
          role: { in: [AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN] },
          status: 'ACTIVE',
        },
        select: { id: true, email: true },
      });
      const uploader = await this.prisma.client.user.findUnique({
        where: { id: asset.uploadedByUserId },
        select: { email: true },
      });
      const title = 'New asset pending review';
      const assetName = asset.originalName || 'an asset';
      const uploaderEmail = uploader?.email || 'A contributor';
      const body = `${uploaderEmail} uploaded "${assetName}" — review needed before it can be scheduled.`;
      if (admins.length > 0) {
        await this.prisma.client.notification.createMany({
          data: admins.map((a) => ({
            tenantId,
            userId: a.id,
            kind: 'ASSET_PENDING_REVIEW',
            title,
            body,
            link: `/assets/review`,
          })),
        }).catch(() => { /* notification table may be missing in dev */ });

        // Fan out the same event over email too. Looks up the tenant
        // slug so the review link points at the right schoolId segment.
        // Failures are swallowed per admin — one bad inbox can't block
        // the others, and the durable email_logs row is what ops relies
        // on for replay.
        const tenant = await this.prisma.client.tenant.findUnique({
          where: { id: tenantId },
          select: { slug: true },
        });
        const reviewLink = `${this.appPublicUrl()}/${tenant?.slug || tenantId}/assets/review`;
        await Promise.all(admins.map(async (a) => {
          if (!a.email) return;
          try {
            await this.email.sendAssetPendingReview({
              to: a.email,
              uploaderEmail,
              assetName,
              reviewLink,
            });
          } catch { /* per-admin failures are fine — others still get mail */ }
        }));
      }
    } catch {
      /* non-fatal — upload still succeeds */
    }
  }

  private async notifyUploaderOfDecision(
    tenantId: string,
    uploaderId: string,
    assetName: string,
    decision: 'APPROVED' | 'REJECTED',
    reviewerEmail: string,
    reason?: string,
  ): Promise<void> {
    try {
      const title = decision === 'APPROVED' ? 'Your asset was approved' : 'Your asset was rejected';
      const body = decision === 'APPROVED'
        ? `"${assetName}" is now published and can be added to playlists.`
        : `"${assetName}" was rejected by ${reviewerEmail}${reason ? ` — "${reason}"` : ''}.`;
      await this.prisma.client.notification.create({
        data: {
          tenantId,
          userId: uploaderId,
          kind: decision === 'APPROVED' ? 'ASSET_APPROVED' : 'ASSET_REJECTED',
          title,
          body,
          link: `/assets`,
        },
      }).catch(() => {});

      // Also email the uploader. Grab their address + the tenant slug
      // for the asset-page link. Missing email (edge case — user
      // deleted, service account, etc.) silently skips the send — the
      // in-app notification is still posted.
      const uploader = await this.prisma.client.user.findUnique({
        where: { id: uploaderId },
        select: { email: true },
      });
      if (uploader?.email) {
        const tenant = await this.prisma.client.tenant.findUnique({
          where: { id: tenantId },
          select: { slug: true },
        });
        const assetsLink = `${this.appPublicUrl()}/${tenant?.slug || tenantId}/assets`;
        try {
          await this.email.sendAssetDecision({
            to: uploader.email,
            decision,
            assetName,
            reviewerEmail,
            reason,
            assetsLink,
          });
        } catch { /* non-fatal */ }
      }
    } catch { /* non-fatal */ }
  }

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async list(
    @Request() req: any,
    // Lane-4 P1 — opt-in pagination. Existing callers (no query params) still
    // get the full list to preserve the asset-library contract; new callers
    // can pass `?take=N&skip=M` to page. Default cap at 500 prevents a stray
    // huge-list request from streaming 5K rows × 500 B each = 2.5 MB on a
    // single nav. The dashboard already does client-side virtualization;
    // server-side paging is the next leg.
    @Query('take') takeRaw?: string,
    @Query('skip') skipRaw?: string,
    @Query('q') qRaw?: string,
  ) {
    const tenantId = req.user.tenantId;
    const emergencyAssetUrls = await this.listScreenEmergencyAssetUrls(tenantId);
    const where: any = {
      tenantId,
      NOT: {
        playlistItems: {
          some: { playlist: { isProtected: true } },
        },
      },
    };
    if (emergencyAssetUrls.length > 0) {
      where.fileUrl = { notIn: emergencyAssetUrls };
    }
    // Hide emergency content from the main asset library. Any asset
    // that participates in a PROTECTED playlist (lockdown, evacuate,
    // weather, all-clear) is filtered out here — teachers and
    // contributors shouldn't see the alert imagery at all while they
    // manage day-to-day content, and admins manage those assets from
    // the dedicated Settings → Emergency Content surface. The server
    // still enforces the DELETE guard below as defense-in-depth
    // against stale caches.
    const take = (() => {
      const n = takeRaw ? parseInt(takeRaw, 10) : NaN;
      if (!Number.isFinite(n) || n <= 0) return 500;  // default cap
      return Math.min(n, 1000);                       // hard ceiling
    })();
    const skip = (() => {
      const n = skipRaw ? parseInt(skipRaw, 10) : NaN;
      return Number.isFinite(n) && n > 0 ? n : 0;
    })();
    // Media Library v1 (2026-08-31): server-side search across the fields the
    // operator actually thinks in — filename, alt text, uploader, folder.
    // Case-insensitive contains; composed with the emergency-content filter
    // above so protected assets stay invisible to search too.
    const q = (qRaw ?? '').trim();
    if (q) {
      where.OR = [
        { originalName: { contains: q, mode: 'insensitive' } },
        // The stored filename lives in the URL tail (no separate column).
        { fileUrl: { contains: q, mode: 'insensitive' } },
        { altText: { contains: q, mode: 'insensitive' } },
        { uploadedBy: { email: { contains: q, mode: 'insensitive' } } },
        { folder: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const rows = await this.prisma.client.asset.findMany({
      where,
      include: {
        uploadedBy: { select: { id: true, email: true } },
        folder: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
    });

    // PAGINATED-OBJECT MODE only when the caller opted in (take/skip/q
    // present): the response becomes { assets, total, take, skip }. A bare
    // GET keeps returning the plain array — the pre-v1 Media Library (and
    // any other consumer) parses that shape today, and both must keep
    // working while the new UI rolls out.
    if (takeRaw !== undefined || skipRaw !== undefined || q) {
      const total = await this.prisma.client.asset.count({ where });
      return { assets: rows, total, take, skip };
    }
    return rows;
  }

  @Post('emergency-upload')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_TYPES.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
  }))
  async uploadEmergencyAsset(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new HttpException({ code: 'ASSET_FILE_TYPE_UNSUPPORTED', message: 'No file uploaded, or file type is not supported. Allowed: images (JPG/PNG/WebP/GIF), MP4/WebM video, audio, PDF. QuickTime .mov and AVI are not supported — export as MP4 first. For an SVG logo, use Settings → Branding.' }, HttpStatus.BAD_REQUEST);
    }

    const safeBuffer = this.storage.toSafeBuffer(file.buffer);

    // UPLD-01 (2026-08-04) — enforce the SAME per-type size caps the media
    // library enforces. This handler had none: its only bounds were multer's
    // blunt 500 MB ceiling and the ALLOWED_TYPES mimetype filter, so a 400 MB
    // "lockdown video" that `/assets/upload` rejects with ASSET_VIDEO_TOO_LARGE
    // sailed through here.
    //
    // Why it matters on THIS path specifically: emergency media is precached
    // onto every screen in the fleet, so one oversized asset is 400 MB × N
    // screens of Supabase egress and WAN time off a single config change —
    // precisely the egress class the 50 MB cap was introduced for. And the
    // failure is silent and late: the upload succeeds at config time and the
    // shortfall only shows up at incident time.
    //
    // Checked against the REAL in-process bytes (not a claimed size), exactly
    // as the legacy /assets/upload path does. Caps are deliberately shared, so
    // there is no second policy to drift out of sync.
    const capError = perTypeSizeCapError(file.mimetype, safeBuffer.length);
    if (capError) throw capError;

    // Derive the stored extension from the VALIDATED mimetype rather than the
    // client's filename, falling back to the filename only if the map somehow
    // misses (it cannot today — every ALLOWED_TYPES entry has a MIME_EXTENSIONS
    // entry, and the fileFilter exact-matches the same string).
    //
    // The extension is load-bearing: `screens.controller.ts` derives the
    // manifest's mime from the URL's extension, and an extension-less URL
    // yields a null mime, at which point the player's own fallback classifies
    // an `https://` URL with no image extension as `text/html` — handing a
    // lockdown video to the web/iframe render path instead of the video one.
    //
    // Note this makes the asserted MIME win over a DISAGREEING filename (a
    // `flyer.pdf` sent as `image/png` now stores `.png`). Both fields are
    // client-controlled and neither is sniffed today, so this changes which
    // client claim wins, not whether we trust the client. Through a browser
    // the two always agree, since File.type is derived from the extension.
    const ext = MIME_EXTENSIONS[file.mimetype] || extname(file.originalname) || '';
    const storagePath = `${req.user.tenantId}/emergency/${randomUUID()}${ext}`;
    let fileUrl: string;
    try {
      fileUrl = await this.storage.upload(storagePath, safeBuffer, file.mimetype);
    } catch (err: any) {
      throw new HttpException({ code: 'ASSET_EMERGENCY_UPLOAD_FAILED', message: `Emergency upload failed: ${err.message}` }, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const fileHash = createHash('sha256').update(safeBuffer).digest('hex');
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: req.user.tenantId,
        userId: req.user.id,
        action: 'UPLOAD_SCREEN_EMERGENCY_ASSET',
        targetType: 'screen_emergency_asset',
        details: JSON.stringify({
          fileUrl,
          mimeType: file.mimetype,
          fileSize: file.size,
          originalName: file.originalname,
          fileHash,
        }),
      },
    }).catch(() => {});

    return {
      fileUrl,
      url: fileUrl,
      mimeType: file.mimetype,
      fileSize: file.size,
      fileHash,
      originalName: file.originalname,
      protected: true,
      protectedKind: 'screen-emergency',
    };
  }

  @Post('presign')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async presignUpload(
    @Request() req: any,
    @Body() body: { filename?: string; contentType?: string; size?: number; folderId?: string | null } = {},
  ) {
    const mimeType = this.assertUploadIntent(body.filename, body.contentType, Number(body.size));
    await this.resolveFolderId(req.user.tenantId, body.folderId);

    const ext = this.storageExtension(body.filename, mimeType);
    const storagePath = `${req.user.tenantId}/${randomUUID()}${ext}`;
    let signed: Awaited<ReturnType<SupabaseStorageService['createSignedUploadUrl']>>;
    try {
      signed = await this.storage.createSignedUploadUrl(storagePath);
    } catch (err: any) {
      throw new HttpException({ code: 'ASSET_PRESIGN_FAILED', message: `Unable to prepare upload: ${err.message}` }, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    return {
      uploadUrl: signed.signedUrl,
      signedUrl: signed.signedUrl,
      token: signed.token,
      storagePath: signed.path,
      fileUrl: signed.publicUrl,
      mimeType,
      maxFileSize: MAX_ASSET_FILE_SIZE,
    };
  }

  @Post('complete-upload')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async completeUpload(
    @Request() req: any,
    @Body() body: {
      storagePath?: string;
      filename?: string;
      contentType?: string;
      size?: number;
      folderId?: string | null;
      fileHash?: string | null;
    } = {},
  ) {
    const mimeType = this.assertUploadIntent(body.filename, body.contentType, Number(body.size));
    const storagePath = (body.storagePath || '').trim();
    if (
      !storagePath ||
      storagePath.includes('..') ||
      storagePath.includes('\\') ||
      !storagePath.startsWith(`${req.user.tenantId}/`) ||
      storagePath.includes('/emergency/')
    ) {
      throw new HttpException({ code: 'ASSET_UPLOAD_PATH_INVALID', message: 'Invalid upload path.' }, HttpStatus.BAD_REQUEST);
    }

    const folderId = await this.resolveFolderId(req.user.tenantId, body.folderId);
    try {
      await this.storage.assertObjectExists(storagePath);
    } catch (err: any) {
      throw new HttpException({ code: 'ASSET_UPLOAD_INCOMPLETE', message: `Upload did not finish in storage: ${err.message}` }, HttpStatus.BAD_REQUEST);
    }

    // INTEG-01 (2026-08-04) — do NOT persist the client's claimed hash.
    //
    // This previously stored `body.fileHash` after checking only that it was 64
    // hex characters. Nothing ever compared it to the bytes that landed in
    // storage, so it was an integrity value supplied by the party it is meant
    // to hold accountable — which is not an integrity value at all. Two things
    // consume it and both were undermined:
    //   - the player integrity-verifies emergency / offline media against it,
    //     so a wrong hash either rejects legitimate lockdown media or blesses
    //     tampered media, depending on which side the attacker controls;
    //   - playlist distribution used to find child-tenant assets BY this hash,
    //     which let a CONTRIBUTOR substitute content on a district push
    //     (INTEG-02, fixed in playlist-distribution.service.ts).
    //
    // Recording nothing is strictly better than recording a lie. `null` is a
    // first-class supported state on this column: `backfillManagedAssetHashes`
    // (main.ts) computes the REAL sha256 from storage in the background, and
    // the USB export path already self-heals a null hash rather than dropping
    // the asset (usb-export.controller.ts:378-430, covered by S12). So the
    // hash still arrives — it just arrives computed by us instead of asserted
    // by the uploader.
    //
    // Deliberately NOT hashing inline here: this is the direct-to-storage
    // presign path, and the object can be up to 500 MB. Downloading every
    // upload back through the API to hash it would add egress and latency to
    // the one flow that exists specifically to avoid both. The same reasoning
    // as the size/mime handling directly below — trust storage, not the client.
    const fileHash = null;

    // Don't trust the client's claimed size/mime — read the REAL values that
    // landed in storage (cheap metadata call, no download). A client could
    // otherwise record a false size/mime that then drives the player's
    // rendering + the dashboard's cache-status math. Falls back to the
    // claimed values only if the info endpoint is unavailable.
    const info = await this.storage.getObjectInfo(storagePath);
    const realMime = info?.contentType || mimeType;
    const realSize = info?.size ?? Number(body.size);

    // BUG #6 FIX — per-type size cap enforcement against the REAL stored
    // bytes. The presign step (`assertUploadIntent`) can only validate the
    // client-CLAIMED size, which is trivially spoofable — a client can claim
    // "5 MB" at presign, get a signed URL, then PUT a 400 MB video straight
    // to Supabase. The egress/quality caps are meaningless if only the claim
    // is checked. `getObjectInfo` gives us the object's ACTUAL size after the
    // direct-to-storage PUT; enforce the per-type cap here (using the real
    // mime when storage reports it). Over-cap → delete the orphaned object so
    // it can't be served / eat egress, then reject with the same error
    // envelope the claimed-size path uses.
    //
    // HONEST LIMITATION: if `getObjectInfo` returns null (info endpoint
    // unavailable), `realSize` falls back to the claimed size — which was
    // already validated at presign. We do NOT reject on a claimed-only size
    // here (it was already accepted), so a storage-info outage degrades to
    // the pre-fix behavior rather than blocking legitimate uploads. This is
    // the tightest enforcement available without downloading every object.
    if (info && typeof info.size === 'number') {
      const realCapError = perTypeSizeCapError(realMime, info.size);
      if (realCapError) {
        // Remove the over-cap object we just confirmed exists — otherwise it
        // stays in the bucket, world-readable + egress-billable, with no
        // Asset row pointing at it (an orphan).
        await this.storage.delete(storagePath).catch(() => undefined);
        throw realCapError;
      }
    }

    const asset = await this.prisma.client.asset.create({
      data: {
        tenantId: req.user.tenantId,
        uploadedByUserId: req.user.id,
        fileUrl: this.storage.publicUrlForPath(storagePath),
        mimeType: realMime,
        fileSize: realSize,
        fileHash,
        originalName: body.filename || null,
        status: this.initialAssetStatus(req.user.role),
        folderId,
      },
    });

    // SUPABASE EGRESS / QUALITY FIX (2026-05-23, tightened 2026-05-27 P0-5).
    // The legacy /assets/upload chain optimizes images inline via sharp;
    // the presign chain shipped without that step, so iPhone JPGs landed
    // at 8 MB and served raw forever. We close the gap by downloading the
    // just-PUT object, running it through MediaOptimizationService's
    // 1920px / q=85 upload profile, and re-uploading to a new content-
    // addressed path with the correct mime + Cache-Control header
    // (immutable, set inside supabase-storage.service.ts).
    //
    // Sync (not background) so the response carries the FINAL size/url
    // and the operator's "uploaded" toast tells the truth.
    //
    // Defensive: on ANY failure we keep the original. Never break the
    // upload over a best-effort compression step.
    //
    // Audit P1-2 (2026-05-28) — `altTextBuffer` captures the bytes we
    // want to send to the AI vision model. The optimized buffer is
    // preferred (smaller payload = cheaper + faster call); falls back
    // to the original raw buffer if optimization didn't happen / had
    // no gain.
    let altTextBuffer: Buffer | null = null;
    let altTextMime: string = realMime;
    if (this.mediaOpt.isUploadOptimizableImage(realMime)) {
      try {
        const original = await this.storage.download(storagePath);
        if (original) {
          altTextBuffer = original; // fallback if optimization skipped
          const origExt = extname(storagePath) || '';
          const opt = await this.mediaOpt.optimizeImageForUpload(original, realMime, origExt);
          const baseMeta: Record<string, unknown> = {
            originalSize: opt.originalBytes,
            processedSize: opt.finalBytes,
            originalDimensions: opt.originalDimensions ?? null,
            processedDimensions: opt.processedDimensions ?? null,
            transcodedAt: new Date().toISOString(),
          };
          if (opt.optimized && opt.finalBytes < original.length) {
            // sharp output → re-upload to a NEW path so the URL extension
            // matches the new mime (e.g. .webp). Old path is deleted to
            // avoid orphaned blobs eating storage quota.
            const newPath = `${req.user.tenantId}/${randomUUID()}${opt.ext}`;
            try {
              await this.storage.upload(newPath, opt.buffer, opt.mimeType);
              await this.storage.delete(storagePath);
              const newUrl = this.storage.publicUrlForPath(newPath);
              const updated = await this.prisma.client.asset.update({
                where: { id: asset.id },
                data: {
                  fileUrl: newUrl,
                  mimeType: opt.mimeType,
                  fileSize: opt.finalBytes,
                  processingMeta: baseMeta as any,
                },
              });
              asset.fileUrl = updated.fileUrl;
              asset.mimeType = updated.mimeType;
              asset.fileSize = updated.fileSize;
              // Prefer the optimized buffer for alt-text — smaller +
              // mime now matches what the model will receive.
              altTextBuffer = opt.buffer;
              altTextMime = opt.mimeType;
            } catch (innerErr: any) {
              // If the re-upload failed, the original is still in place
              // and the Asset row points at it. We're back to "raw served
              // forever" but at least the upload succeeded.
              // Roll back the new-path object if it partially landed.
              await this.storage.delete(newPath).catch(() => undefined);
              console.warn(
                `[assets] optimize re-upload failed for ${asset.id}: ${innerErr?.message ?? innerErr}. ` +
                  `Keeping original at ${storagePath}.`,
              );
              await this.prisma.client.asset.update({
                where: { id: asset.id },
                data: {
                  processingMeta: { ...baseMeta, skippedReason: `re-upload-failed: ${innerErr?.message ?? innerErr}` } as any,
                },
              }).catch(() => undefined);
            }
          } else {
            // No optimization gain — record the metadata anyway so the
            // forensic trail is complete (we tried; nothing to save).
            await this.prisma.client.asset.update({
              where: { id: asset.id },
              data: {
                processingMeta: { ...baseMeta, skippedReason: 'no-gain-or-passthrough' } as any,
              },
            }).catch(() => undefined);
          }
        }
      } catch (err: any) {
        // Optimization is best-effort. Log and continue with the original.
        console.warn(
          `[assets] post-upload optimize failed for ${asset.id}: ${err?.message ?? err}`,
        );
      }
    } else if ((realMime || '').startsWith('video/')) {
      // Heavy ffmpeg transcode is deferred. Warn so the candidate is
      // visible to ops without trawling every upload.
      if (typeof realSize === 'number' && realSize > VIDEO_WARN_SIZE_BYTES) {
        this.logger.warn(
          `[assets] large video upload (${Math.round(realSize / (1024 * 1024))} MB, ` +
            `${realMime}, ${body.filename || asset.id}) — transcode pipeline deferred to next sprint.`,
        );
      }
    }

    // Audit P1-2 (2026-05-28) — fire-and-forget alt-text generation.
    // For images we MAY already have the buffer from the optimizer
    // path above; for non-optimizable images (GIF, animated) we'd need
    // a fresh download — gated below by `altTextBuffer != null`.
    // Animated GIFs fall through here; downloading them just to feed
    // the model their first frame is cheap and worth the visibility.
    if ((realMime || '').toLowerCase().startsWith('image/')) {
      if (!altTextBuffer) {
        // Animated GIF / format not routed through the optimizer.
        // Best-effort fetch — we don't care if it fails, alt-text is
        // never blocking.
        try {
          altTextBuffer = await this.storage.download(storagePath);
        } catch { /* swallow — skip alt-text */ }
      }
      if (altTextBuffer) {
        this.kickOffAltTextGeneration({
          assetId: asset.id,
          tenantId: req.user.tenantId,
          userId: req.user.id,
          imageBuffer: altTextBuffer,
          mimeType: altTextMime,
          originalName: asset.originalName,
        });
      }
    }

    if (asset.status === 'PENDING_APPROVAL') {
      this.notifyAdminsOfPendingReview(req.user.tenantId, asset);
    }

    return {
      id: asset.id,
      fileUrl: asset.fileUrl,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      fileHash: asset.fileHash,
      originalName: asset.originalName,
      status: asset.status,
      altText: (asset as any).altText ?? null,
    };
  }

  /**
   * File upload endpoint.
   * Receives file via multer (memory storage), uploads to Supabase Storage.
   */
  @Post('upload')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    // 500MB. Bumped from 50MB after partner reported "tried to upload
    // an 86mb video and it said file too large." Multer reads the
    // file into memory (we use memoryStorage), so very large videos
    // can pressure the Railway pod's RAM during simultaneous uploads
    // — but a 500MB cap is still safe for 1-2 concurrent uploads on
    // a typical Railway-Standard plan, and most signage video clips
    // are under 200MB. For the 1GB+ video case we'll move to direct
    // browser→Supabase presigned uploads in a follow-up.
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_TYPES.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(null, false);
      }
    },
  }))
  async upload(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { folderId?: string } = {},
  ) {
    if (!file) {
      throw new HttpException({ code: 'ASSET_FILE_TYPE_UNSUPPORTED', message: 'No file uploaded, or file type is not supported. Allowed: images (JPG/PNG/WebP/GIF), MP4/WebM video, audio, PDF. QuickTime .mov and AVI are not supported — export as MP4 first. For an SVG logo, use Settings → Branding.' }, HttpStatus.BAD_REQUEST);
    }

    // Validate the optional folderId — must belong to the caller's tenant.
    // Prevents multipart-form field tampering from dropping a file into
    // another tenant's folder. Ignored if absent; asset lands at root.
    let folderId: string | null = null;
    const bodyFolderId = (body?.folderId || '').trim();
    if (bodyFolderId) {
      const folder = await this.prisma.client.assetFolder.findFirst({
        where: { id: bodyFolderId, tenantId: req.user.tenantId },
      });
      if (!folder) throw new HttpException({ code: 'ASSET_FOLDER_NOT_FOUND', message: 'Folder not found' }, HttpStatus.NOT_FOUND);
      folderId = folder.id;
    }

    // Normalize the multer payload to a real Buffer ONCE. Multer sometimes
    // delivers a serialized `{type:'Buffer',data:[...]}` instead of a
    // native Buffer (depends on the IPC/proxy boundary). Reuse the same
    // normalized bytes for both the upload AND the SHA-256 hash so we
    // never crash with ERR_INVALID_ARG_TYPE on createHash.
    const safeBuffer = this.storage.toSafeBuffer(file.buffer);

    // BUG #7 FIX — per-type size cap enforcement on the legacy multipart
    // path. Multer's `limits.fileSize` (500 MB) is the ONLY size gate this
    // handler had; the tighter per-type egress caps (video 50 MB, image/
    // audio/pdf 25 MB) were never applied here, so a 300 MB video sailed
    // straight into storage. Unlike the presigned path, the REAL bytes are
    // in-process (`safeBuffer.length` — the actual uploaded size, before any
    // optimization), so we can enforce the exact cap authoritatively against
    // the real mime here and reject with the shared error envelope.
    const legacyCapError = perTypeSizeCapError(file.mimetype, safeBuffer.length);
    if (legacyCapError) throw legacyCapError;

    // Audit P0-5 (2026-05-27) — sharp-based resize inline before storing.
    //   * Images (JPEG / PNG / WebP): re-encode at 1920px longest side,
    //     q=85 for JPEG/WebP, PNG lossless. Strips EXIF.
    //   * Animated GIFs: passthrough (sharp would flatten them to one frame).
    //   * Video: NOT transcoded tonight — heavy ffmpeg deferred to a
    //     separate sprint. Just warn if the upload size exceeds the
    //     50 MB warn threshold (the controller already hard-rejects above
    //     this, but we log defensively so the warn line is unambiguous
    //     when the cap is raised).
    //
    // On ANY failure the service returns the original buffer, so an upload
    // never breaks. Format may change (jpeg/jpg stays jpeg), so the path
    // extension + stored mimeType + fileSize all come from the optimizer
    // result. `processingMeta` records the before/after for forensics.
    let uploadBuf = safeBuffer;
    let uploadMime = file.mimetype;
    let uploadExt = extname(file.originalname) || '';
    let processingMeta: Record<string, unknown> | null = null;
    if (this.mediaOpt.isUploadOptimizableImage(file.mimetype)) {
      const opt = await this.mediaOpt.optimizeImageForUpload(safeBuffer, file.mimetype, uploadExt);
      if (opt.optimized) {
        uploadBuf = opt.buffer;
        uploadMime = opt.mimeType;
        uploadExt = opt.ext;
      }
      processingMeta = {
        originalSize: opt.originalBytes,
        processedSize: opt.finalBytes,
        originalDimensions: opt.originalDimensions ?? null,
        processedDimensions: opt.processedDimensions ?? null,
        transcodedAt: new Date().toISOString(),
        ...(opt.optimized ? {} : { skippedReason: 'no-gain-or-passthrough' }),
      };
    } else if ((file.mimetype || '').startsWith('video/')) {
      // Heavy ffmpeg transcode is deferred — see the comment above. We do
      // however want a single warn line for ops so the candidate-for-
      // shrinking is visible in logs without trawling every upload.
      if (safeBuffer.length > VIDEO_WARN_SIZE_BYTES) {
        this.logger.warn(
          `[assets] large video upload (${Math.round(safeBuffer.length / (1024 * 1024))} MB, ` +
            `${file.mimetype}, ${file.originalname}) — transcode pipeline deferred to next sprint.`,
        );
      }
    }

    // Upload to Supabase Storage: tenant/<tenantId>/<uuid>.<ext>
    const storagePath = `${req.user.tenantId}/${randomUUID()}${uploadExt}`;

    let fileUrl: string;
    try {
      fileUrl = await this.storage.upload(storagePath, uploadBuf, uploadMime);
    } catch (err: any) {
      throw new HttpException({ code: 'ASSET_UPLOAD_FAILED', message: `Upload failed: ${err.message}` }, HttpStatus.INTERNAL_SERVER_ERROR);
    }

    // SHA-256 hash so the offline-cache Service Worker can detect when an
    // asset has been replaced server-side without the URL changing, and
    // re-download exactly the diff. Computed in-memory from the SAME bytes
    // we stored (post-optimization) — no extra read.
    const fileHash = createHash('sha256').update(uploadBuf).digest('hex');

    const asset = await this.prisma.client.asset.create({
      data: {
        tenantId: req.user.tenantId,
        uploadedByUserId: req.user.id,
        fileUrl,
        mimeType: uploadMime,
        fileSize: uploadBuf.length,
        fileHash,
        originalName: file.originalname,
        // Role-gated publish: CONTRIBUTOR uploads land in the review
        // queue (PENDING_APPROVAL); admins auto-publish. Player's
        // manifest filters out non-PUBLISHED assets so unapproved
        // content never reaches a screen.
        status: this.initialAssetStatus(req.user.role),
        folderId,
        // Audit P0-5 (2026-05-27): forensic + ops trail for the upload-
        // time optimizer. NULL for video / GIF / URL-asset paths that
        // don't go through sharp. Cast to any because Prisma's
        // NullableJsonNullValueInput type forbids a plain object literal
        // (it wants either Prisma.JsonNull or the value-typed shape) —
        // the actual JSONB value is a plain Record<string,unknown>.
        ...(processingMeta ? { processingMeta: processingMeta as any } : {}),
      },
    });

    if (asset.status === 'PENDING_APPROVAL') {
      // Fire-and-forget — don't block the upload response on
      // notification fan-out.
      this.notifyAdminsOfPendingReview(req.user.tenantId, asset);
    }

    // Audit P1-2 (2026-05-28) — fire-and-forget alt-text generation.
    // We're feeding the OPTIMIZED bytes (`uploadBuf`) so the vision
    // call is cheap + fast. Non-image uploads no-op inside the helper.
    this.kickOffAltTextGeneration({
      assetId: asset.id,
      tenantId: req.user.tenantId,
      userId: req.user.id,
      imageBuffer: uploadBuf,
      mimeType: uploadMime,
      originalName: file.originalname || null,
    });

    return {
      id: asset.id,
      fileUrl: asset.fileUrl,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
      fileHash: asset.fileHash,
      originalName: asset.originalName,
      status: asset.status,
      altText: (asset as any).altText ?? null,
    };
  }

  /**
   * Audit P1-2 (2026-05-28) — operator-triggered alt-text (re)generation.
   * Re-fetches the asset's bytes from storage, runs the AI vision call,
   * and persists the result on success. Surfaces structured errors so
   * the FE can show "out of credit" vs "no AI configured" distinctly.
   *
   * Used by the asset detail panel's "Generate alt text" button. Also
   * by the upload flow whenever the background job failed and the
   * operator wants to retry without re-uploading.
   *
   * RBAC: CONTRIBUTOR+ — same as upload; below that role can't run AI
   * to begin with.
   */
  @Post(':id/generate-alt-text')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async generateAltText(@Request() req: any, @Param('id') id: string) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!asset) throw new HttpException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' }, HttpStatus.NOT_FOUND);
    if (!(asset.mimeType || '').toLowerCase().startsWith('image/')) {
      throw new HttpException({ code: 'ASSET_ALT_TEXT_NOT_IMAGE', message: 'Alt-text generation is only available for image assets.' }, HttpStatus.BAD_REQUEST);
    }
    const storagePath = this.storage.extractPath(asset.fileUrl);
    if (!storagePath) {
      throw new HttpException({ code: 'ASSET_ALT_TEXT_EXTERNAL_URL', message: 'Cannot regenerate alt-text for external URL assets.' }, HttpStatus.BAD_REQUEST);
    }
    const buffer = await this.storage.download(storagePath);
    if (!buffer) {
      throw new HttpException({ code: 'ASSET_FILE_RETRIEVAL_FAILED', message: 'Asset file could not be retrieved from storage.' }, HttpStatus.NOT_FOUND);
    }
    try {
      const result = await this.aiAltText.generateImageAltText({
        tenantId: req.user.tenantId,
        assetId: asset.id,
        userId: req.user.id,
        imageBuffer: buffer,
        mimeType: asset.mimeType,
        contextHint: asset.originalName || undefined,
      });
      if (!result) {
        throw new HttpException(
          {
            code: 'AI_ALT_TEXT_UNAVAILABLE',
            message:
              'Alt-text generation could not run. Make sure your AI provider key is configured in Settings → AI provider.',
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      const updated = await this.prisma.client.asset.update({
        where: { id: asset.id },
        data: { altText: result.altText } as any,
      });
      return {
        id: asset.id,
        altText: result.altText,
        provider: result.provider,
        model: result.model,
        estCostUsd: result.estCostUsd,
        asset: updated,
      };
    } catch (e: any) {
      if (e instanceof AiAltTextQuotaError) {
        throw new HttpException(
          {
            code: 'AI_QUOTA_EXHAUSTED',
            provider: e.provider,
            message: e.message,
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      if (e instanceof HttpException) throw e;
      throw new HttpException({ code: 'ASSET_ALT_TEXT_GENERATION_FAILED', message: `Alt-text generation failed: ${e?.message ?? 'unknown error'}` }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  /**
   * Audit P1-2 (2026-05-28) — operator can manually edit / clear
   * alt-text. Keeps the column under operator control even when the
   * AI generated value is wrong or culturally insensitive.
   *
   * Empty string or null clears the field. Anything longer than 160
   * chars is rejected (matches the Prisma column cap); the FE should
   * surface a character count so the operator doesn't lose work.
   */
  @Put(':id/alt-text')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async updateAltText(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { altText?: string | null } = {},
  ) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!asset) throw new HttpException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' }, HttpStatus.NOT_FOUND);
    const raw = body.altText;
    let next: string | null;
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      next = null;
    } else {
      const trimmed = String(raw).trim();
      if (trimmed.length > 160) {
        throw new HttpException({ code: 'ASSET_ALT_TEXT_TOO_LONG', message: 'Alt-text is too long. Keep it under 160 characters (screen-reader best practice is ≤125).' }, HttpStatus.BAD_REQUEST);
      }
      next = trimmed;
    }
    const updated = await this.prisma.client.asset.update({
      where: { id: asset.id },
      data: { altText: next } as any,
    });
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: req.user.tenantId,
        userId: req.user.id,
        action: 'ASSET_ALT_TEXT_EDITED',
        targetType: 'asset',
        targetId: asset.id,
        details: JSON.stringify({ length: next?.length ?? 0, cleared: next === null }),
      },
    }).catch(() => {});
    return updated;
  }

  /**
   * Delete an asset (and its file from Supabase Storage).
   */
  /**
   * Where does this asset actually reach? (Media Library v1, 2026-08-31.)
   *
   * The library's deletion-safety design ("This asset is currently in use —
   * it appears in 3 playlists reaching 8 screens") needs REAL references,
   * never inference: playlists from PlaylistItem rows, reach from the
   * schedules that target those playlists (screen-pinned plus group
   * members), locations from the reached screens' own tenants.
   *
   * Honesty limits, stated rather than papered over:
   *   - `scheduled`  = the playlist has ≥1 active schedule row whose date
   *     range covers now. This answers "is it on the calendar", not "is it
   *     on glass this minute".
   *   - `activeNow` additionally requires day-of-week (UTC) AND, when the
   *     schedule sets an hour-level window, defers to
   *     `evaluateScheduleEligibility` — which fails CLOSED on that window
   *     rather than comparing it to the server's UTC clock (2026-09-01,
   *     Codex truth audit: that comparison used to be able to read an
   *     8–10am template as LIVE at 10pm — see schedule-eligibility.ts).
   * The UI copy is written against exactly these semantics.
   */
  private async buildAssetUsage(tenantId: string, assetId: string, fileUrl: string) {
    const items = await this.prisma.client.playlistItem.findMany({
      where: { assetId },
      select: { playlistId: true },
    });
    const counts = new Map<string, number>();
    for (const it of items) counts.set(it.playlistId, (counts.get(it.playlistId) ?? 0) + 1);
    const playlistIds = [...counts.keys()];

    const playlists = playlistIds.length
      ? await this.prisma.client.playlist.findMany({
          where: { id: { in: playlistIds } },
          select: { id: true, name: true, isProtected: true },
        })
      : [];

    const now = new Date();
    const schedules = playlistIds.length
      ? await this.prisma.client.schedule.findMany({
          where: {
            playlistId: { in: playlistIds },
            isActive: true,
            startTime: { lte: now },
            OR: [{ endTime: null }, { endTime: { gte: now } }],
          },
          select: {
            playlistId: true, screenId: true, screenGroupId: true, daysOfWeek: true,
            timeStart: true, timeEnd: true, startTime: true, endTime: true,
          },
        })
      : [];

    const groupIds = [...new Set(schedules.map((s) => s.screenGroupId).filter(Boolean))] as string[];
    const groupScreens = groupIds.length
      ? await this.prisma.client.screen.findMany({
          where: { screenGroupId: { in: groupIds } },
          select: { id: true, tenantId: true, screenGroupId: true },
        })
      : [];
    const screensByGroup = new Map<string, Array<{ id: string; tenantId: string | null }>>();
    for (const s of groupScreens) {
      const list = screensByGroup.get(s.screenGroupId as string) ?? [];
      list.push({ id: s.id, tenantId: s.tenantId });
      screensByGroup.set(s.screenGroupId as string, list);
    }
    const pinnedIds = [...new Set(schedules.map((s) => s.screenId).filter(Boolean))] as string[];
    const pinnedScreens = pinnedIds.length
      ? await this.prisma.client.screen.findMany({
          where: { id: { in: pinnedIds } },
          select: { id: true, tenantId: true },
        })
      : [];
    const pinnedById = new Map(pinnedScreens.map((s) => [s.id, s]));

    const perPlaylist = new Map<string, { screens: Set<string>; tenants: Set<string>; activeNow: boolean }>();
    for (const sc of schedules) {
      const slot = perPlaylist.get(sc.playlistId) ?? { screens: new Set(), tenants: new Set(), activeNow: false };
      const reached: Array<{ id: string; tenantId: string | null }> = [];
      if (sc.screenId && pinnedById.has(sc.screenId)) reached.push(pinnedById.get(sc.screenId)!);
      if (sc.screenGroupId) reached.push(...(screensByGroup.get(sc.screenGroupId) ?? []));
      for (const r of reached) {
        slot.screens.add(r.id);
        if (r.tenantId) slot.tenants.add(r.tenantId);
      }
      // 2026-09-01 (Codex truth audit) — an hour-level window fails CLOSED:
      // see schedule-eligibility.ts for why the server can't evaluate it.
      if (isEligibleNow(sc, now)) slot.activeNow = true;
      perPlaylist.set(sc.playlistId, slot);
    }

    const allScreens = new Set<string>();
    const allTenants = new Set<string>();
    for (const slot of perPlaylist.values()) {
      for (const s of slot.screens) allScreens.add(s);
      for (const t of slot.tenants) allTenants.add(t);
    }

    const emergencyScreen = await this.prisma.client.screen.findFirst({
      where: { tenantId, OR: this.screenEmergencyAssetOr(fileUrl) } as any,
      select: { id: true },
    });

    return {
      playlists: playlists.map((p) => {
        const slot = perPlaylist.get(p.id);
        return {
          id: p.id,
          name: p.name,
          itemCount: counts.get(p.id) ?? 0,
          scheduled: !!slot,
          activeNow: slot?.activeNow ?? false,
          screensReached: slot?.screens.size ?? 0,
        };
      }),
      totals: {
        playlists: playlists.length,
        screensReached: allScreens.size,
        locations: allTenants.size,
      },
      protectedEmergency: !!emergencyScreen || playlists.some((p) => p.isProtected),
    };
  }

  @Get(':id/usage')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async usage(@Request() req: any, @Param('id') id: string) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: { id: true, fileUrl: true },
    });
    if (!asset) throw new HttpException({ code: 'ASSET_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    return this.buildAssetUsage(req.user.tenantId, id, asset.fileUrl);
  }

  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!asset) throw new HttpException({ code: 'ASSET_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    const emergencyScreen = await this.prisma.client.screen.findFirst({
      where: {
        tenantId: req.user.tenantId,
        OR: this.screenEmergencyAssetOr(asset.fileUrl),
      } as any,
      select: { id: true, name: true },
    });
    if (emergencyScreen) {
      throw new HttpException(
        {
          code: 'ASSET_IN_SCREEN_EMERGENCY_CONTENT',
          error: 'Asset is assigned as protected screen emergency content. Clear it from emergency settings first.',
          screen: emergencyScreen,
        },
        HttpStatus.CONFLICT,
      );
    }

    // Protected-playlist guard: deleting an asset cascades to playlistItem
    // rows, which could silently empty an emergency (protected) playlist.
    // Block the delete and make the operator remove from the playlist
    // explicitly first — same spirit as the playlist delete guard.
    const affectedItems = await this.prisma.client.playlistItem.findMany({
      where: { assetId: id },
      select: { playlistId: true },
    });
    const affectedPlaylistIds = Array.from(new Set(affectedItems.map((i) => i.playlistId)));
    if (affectedPlaylistIds.length > 0) {
      const protectedPlaylists = await this.prisma.client.playlist.findMany({
        where: { id: { in: affectedPlaylistIds }, isProtected: true },
        select: { id: true, name: true, protectedKind: true },
      });
      if (protectedPlaylists.length > 0) {
        throw new HttpException(
          {
            code: 'ASSET_IN_PROTECTED_PLAYLIST',
            error: 'Asset is in a protected emergency playlist. Remove from the playlist first.',
            playlists: protectedPlaylists.map((p) => ({ id: p.id, name: p.name, kind: p.protectedKind })),
          },
          HttpStatus.CONFLICT,
        );
      }
    }

    // Media Library v1 deletion safety (2026-08-31): an asset with LIVE
    // references never deletes silently — the old behavior stripped the
    // playlist items on the way out, which for signage means a board loses
    // a slide with nobody choosing that. The operator removes or replaces
    // the references first; the 409 carries the real usage so the UI can
    // show exactly what stands in the way. (Protected/emergency guards
    // above are stricter still and fire first.)
    if (affectedPlaylistIds.length > 0) {
      throw new HttpException(
        {
          code: 'ASSET_IN_USE',
          error: 'Asset is used by playlists. Remove or replace those references first.',
          usage: await this.buildAssetUsage(req.user.tenantId, id, asset.fileUrl),
        },
        HttpStatus.CONFLICT,
      );
    }

    // No references — proceed. (deleteMany kept for belt-and-braces against
    // a reference added between the check above and the transaction below.)
    const removedItems = await this.prisma.client.playlistItem.deleteMany({ where: { assetId: id } });

    // Delete from Supabase Storage if it's a Supabase URL
    const storagePath = this.storage.extractPath(asset.fileUrl);
    if (storagePath) {
      await this.storage.delete(storagePath);
    }

    // 2026-05-23 launch audit P1: forensic trail for asset deletes.
    // Records the original mime / size / hash so an asset deleted in
    // error can be diagnosed (was it the right file? when was it
    // uploaded? who removed it?).
    await this.prisma.client.$transaction(async (tx) => {
      await tx.asset.delete({ where: { id } });
      await tx.auditLog.create({
        data: {
          tenantId: req.user.tenantId,
          userId: req.user.id,
          action: 'ASSET_DELETED',
          targetType: 'Asset',
          targetId: id,
          details: JSON.stringify({
            mimeType: asset.mimeType,
            fileSize: (asset as any).fileSize ?? null,
            fileHash: (asset as any).fileHash ?? null,
            originalName: (asset as any).originalName ?? null,
            removedPlaylistItems: removedItems.count,
          }),
        },
      });
    });
    return { deleted: true };
  }

  /**
   * Add a web URL as an asset.
   */
  @Post('url')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async addUrl(
    @Request() req: any,
    @Body() body: { url: string; name?: string; folderId?: string | null },
  ) {
    if (!body.url?.trim()) {
      throw new HttpException({ code: 'ASSET_URL_REQUIRED', message: 'URL is required' }, HttpStatus.BAD_REQUEST);
    }

    // Auto-prefix https:// if no protocol is provided
    let url = body.url.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }

    let hostname = url;
    try { hostname = new URL(url).hostname; } catch { /* use raw url as fallback name */ }

    // Validate folderId if provided — same tenant-isolation check the
    // upload endpoint runs. Without this the URL always landed at
    // root, so an operator inside a folder would "add a URL" and the
    // asset would vanish (it was at root, not where they were
    // standing). Reported verbatim by the Integration Lead.
    let folderId: string | null = null;
    const bodyFolderId = (body.folderId || '').toString().trim();
    if (bodyFolderId) {
      const folder = await this.prisma.client.assetFolder.findFirst({
        where: { id: bodyFolderId, tenantId: req.user.tenantId },
      });
      if (!folder) throw new HttpException({ code: 'ASSET_FOLDER_NOT_FOUND', message: 'Folder not found' }, HttpStatus.NOT_FOUND);
      folderId = folder.id;
    }

    const asset = await this.prisma.client.asset.create({
      data: {
        tenantId: req.user.tenantId,
        uploadedByUserId: req.user.id,
        fileUrl: url,
        mimeType: 'text/html',
        originalName: body.name || hostname,
        status: this.initialAssetStatus(req.user.role),
        folderId,
      },
    });

    if (asset.status === 'PENDING_APPROVAL') {
      this.notifyAdminsOfPendingReview(req.user.tenantId, asset);
    }

    return { id: asset.id, fileUrl: url, folderId: asset.folderId, status: asset.status };
  }

  /**
   * 2026-05-14 — Player-facing single-asset fetch for `play-video`
   * and `show-overlay` touch actions. The controller has no
   * GET /:id endpoint at all (just /list, /pending, /folders) — the
   * builder + dashboard never needed one because they always work
   * off cached list data. The PLAYER does need one: the TouchOverlay
   * resolves play-video / show-overlay targets that are stored as
   * asset UUIDs in the manifest's touchAction blob, and without an
   * endpoint to hit, those resolutions 404'd → operator saw
   * "webpage unavailable" with an Android WebView error page.
   *
   * Auth follows the same pattern as /templates/:id/playback:
   *   - kind:'device' → look up the bound screen, scope by tenant
   *   - SUPER_ADMIN → cross-tenant by design
   *   - user JWT → scope by tenantId
   * No @RequireRoles because device JWTs have no role; auth is
   * enforced via the where-clause filter on the lookup.
   *
   * Returns only the playback-needed fields (id, fileUrl, mimeType,
   * fileSize) — never the full Asset row. Status must be PUBLISHED;
   * draft + pending-approval assets never reach a player.
   */
  @Get(':id/playback')
  async getForPlayback(@Request() req: any, @Param('id') id: string) {
    const u = req.user || {};
    let scopeTenantId: string | null = null;
    if (u.kind === 'device') {
      const screen = await this.prisma.client.screen.findUnique({
        where: { id: u.sub },
        select: { tenantId: true, status: true },
      });
      if (!screen || screen.status === 'REVOKED') {
        throw new HttpException({ code: 'ASSET_DEVICE_INVALID', message: 'Device invalid' }, HttpStatus.FORBIDDEN);
      }
      scopeTenantId = screen.tenantId ?? null;
    } else if (u.role === AppRole.SUPER_ADMIN) {
      scopeTenantId = null;
    } else {
      scopeTenantId = u.schoolId || u.tenantId || u.districtId || null;
      if (!scopeTenantId) {
        throw new HttpException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' }, HttpStatus.NOT_FOUND);
      }
    }
    const asset = await this.prisma.client.asset.findFirst({
      where: {
        id,
        status: 'PUBLISHED',
        ...(scopeTenantId ? { tenantId: scopeTenantId } : {}),
      },
      select: {
        id: true,
        fileUrl: true,
        mimeType: true,
        fileSize: true,
      },
    });
    if (!asset) {
      throw new HttpException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' }, HttpStatus.NOT_FOUND);
    }
    return asset;
  }

  // ─── Review queue listing ──────────────────────────────────────
  @Get('pending')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async listPending(@Request() req: any) {
    return this.prisma.client.asset.findMany({
      where: { tenantId: req.user.tenantId, status: 'PENDING_APPROVAL' },
      include: {
        uploadedBy: { select: { id: true, email: true, role: true } },
        folder: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Put(':id/approve')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async approve(@Request() req: any, @Param('id') id: string) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!asset) throw new HttpException({ code: 'ASSET_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    // Idempotent approve: target the transition only, so a concurrent
    // second call is a 0-row no-op instead of re-writing a duplicate
    // status transition (and any downstream audit/webhook side effects).
    const result = await this.prisma.client.asset.updateMany({
      where: { id, tenantId: req.user.tenantId, status: 'PENDING_APPROVAL' },
      data: { status: 'PUBLISHED' },
    });
    if (result.count === 0) {
      throw new HttpException(
        { code: 'ASSET_NOT_PENDING', message: 'Already approved or not pending.' },
        HttpStatus.CONFLICT,
      );
    }
    // Audit + notify the uploader so they know their content is live
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: req.user.tenantId, userId: req.user.id,
        action: 'ASSET_APPROVED', targetType: 'Asset', targetId: id,
        details: JSON.stringify({ name: asset.originalName }),
      },
    }).catch(() => {});
    this.notifyUploaderOfDecision(
      req.user.tenantId, asset.uploadedByUserId,
      asset.originalName || 'your asset',
      'APPROVED', req.user.email || 'a reviewer',
    );
    return this.prisma.client.asset.findUnique({ where: { id } });
  }

  @Put(':id/reject')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async reject(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { reason?: string } = {},
  ) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!asset) throw new HttpException({ code: 'ASSET_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);
    const updated = await this.prisma.client.asset.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
    await this.prisma.client.auditLog.create({
      data: {
        tenantId: req.user.tenantId, userId: req.user.id,
        action: 'ASSET_REJECTED', targetType: 'Asset', targetId: id,
        details: JSON.stringify({ name: asset.originalName, reason: body.reason || '' }),
      },
    }).catch(() => {});
    this.notifyUploaderOfDecision(
      req.user.tenantId, asset.uploadedByUserId,
      asset.originalName || 'your asset',
      'REJECTED', req.user.email || 'a reviewer',
      body.reason,
    );
    return updated;
  }

  /**
   * Move an asset to a folder (or root if folderId is null).
   */
  @Put(':id/move')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async moveAsset(@Request() req: any, @Param('id') id: string, @Body() body: { folderId: string | null }) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!asset) throw new HttpException({ code: 'ASSET_NOT_FOUND', message: 'Not found' }, HttpStatus.NOT_FOUND);

    if (body.folderId) {
      const folder = await this.prisma.client.assetFolder.findFirst({
        where: { id: body.folderId, tenantId: req.user.tenantId },
      });
      if (!folder) throw new HttpException({ code: 'ASSET_FOLDER_NOT_FOUND', message: 'Folder not found' }, HttpStatus.NOT_FOUND);
    }

    return this.prisma.client.asset.update({
      where: { id },
      data: { folderId: body.folderId },
    });
  }

  // ─── Folder CRUD ───────────────────────────────────────

  @Get('folders')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async listFolders(@Request() req: any) {
    return this.prisma.client.assetFolder.findMany({
      where: { tenantId: req.user.tenantId },
      include: {
        _count: { select: { assets: true, children: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  @Post('folders')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async createFolder(@Request() req: any, @Body() body: { name: string; parentId?: string }) {
    if (!body.name?.trim()) {
      throw new HttpException({ code: 'ASSET_FOLDER_NAME_REQUIRED', message: 'Folder name is required' }, HttpStatus.BAD_REQUEST);
    }
    // Validate parentId belongs to THIS tenant — without this a caller
    // could nest a folder under another tenant's folder id (the rename
    // / move / resolveFolderId paths all do this check; create did not).
    if (body.parentId) {
      const parent = await this.prisma.client.assetFolder.findFirst({
        where: { id: body.parentId, tenantId: req.user.tenantId },
        select: { id: true },
      });
      if (!parent) {
        throw new HttpException({ code: 'ASSET_FOLDER_PARENT_NOT_FOUND', message: 'Parent folder not found' }, HttpStatus.BAD_REQUEST);
      }
    }
    return this.prisma.client.assetFolder.create({
      data: {
        tenantId: req.user.tenantId,
        name: body.name.trim(),
        parentId: body.parentId || null,
      },
    });
  }

  @Put('folders/:folderId')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async renameFolder(@Request() req: any, @Param('folderId') folderId: string, @Body() body: { name: string }) {
    const folder = await this.prisma.client.assetFolder.findFirst({
      where: { id: folderId, tenantId: req.user.tenantId },
    });
    if (!folder) throw new HttpException({ code: 'ASSET_FOLDER_NOT_FOUND', message: 'Folder not found' }, HttpStatus.NOT_FOUND);
    return this.prisma.client.assetFolder.update({
      where: { id: folderId },
      data: { name: body.name.trim() },
    });
  }

  @Delete('folders/:folderId')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async deleteFolder(@Request() req: any, @Param('folderId') folderId: string) {
    const folder = await this.prisma.client.assetFolder.findFirst({
      where: { id: folderId, tenantId: req.user.tenantId },
    });
    if (!folder) throw new HttpException({ code: 'ASSET_FOLDER_NOT_FOUND', message: 'Folder not found' }, HttpStatus.NOT_FOUND);

    // Move all assets in this folder to root
    await this.prisma.client.asset.updateMany({
      where: { folderId },
      data: { folderId: null },
    });

    // Move child folders to parent
    await this.prisma.client.assetFolder.updateMany({
      where: { parentId: folderId },
      data: { parentId: folder.parentId },
    });

    await this.prisma.client.assetFolder.delete({ where: { id: folderId } });
    return { deleted: true };
  }
}
