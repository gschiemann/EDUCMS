import {
  Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request,
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
import { MediaOptimizationService } from '../storage/media-optimization.service';
import { EmailService } from '../email/email.service';

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
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/bmp',
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
const EXTENSION_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
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
  'image/svg+xml': '.svg',
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
    private readonly email: EmailService,
    private readonly mediaOpt: MediaOptimizationService,
  ) {}

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
      throw new HttpException(rejectReason, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }

    const mimeType = this.normalizeMimeType(filename, contentType);
    if (!ALLOWED_TYPES.includes(mimeType)) {
      throw new HttpException(
        'File type is not supported. Allowed: images (JPG/PNG/WebP/GIF/SVG), MP4/WebM video, audio (MP3/OGG/WAV/M4A), PDF.',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }

    if (!Number.isFinite(size) || Number(size) <= 0) {
      throw new HttpException('File size is required.', HttpStatus.BAD_REQUEST);
    }

    if (Number(size) > MAX_ASSET_FILE_SIZE) {
      throw new HttpException(
        `File is too large. Max size is ${Math.round(MAX_ASSET_FILE_SIZE / (1024 * 1024))} MB.`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

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
    if (!folder) throw new HttpException('Folder not found', HttpStatus.NOT_FOUND);
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
  async list(@Request() req: any) {
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
    return this.prisma.client.asset.findMany({
      where,
      include: {
        uploadedBy: { select: { id: true, email: true } },
        folder: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
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
      throw new HttpException(
        'No file uploaded, or file type is not supported. Allowed: images (JPG/PNG/WebP/GIF/SVG), MP4/WebM video, audio, PDF. QuickTime .mov and AVI are not supported — export as MP4 first.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const ext = extname(file.originalname) || '';
    const storagePath = `${req.user.tenantId}/emergency/${randomUUID()}${ext}`;
    const safeBuffer = this.storage.toSafeBuffer(file.buffer);
    let fileUrl: string;
    try {
      fileUrl = await this.storage.upload(storagePath, safeBuffer, file.mimetype);
    } catch (err: any) {
      throw new HttpException(
        `Emergency upload failed: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
      throw new HttpException(
        `Unable to prepare upload: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
      throw new HttpException('Invalid upload path.', HttpStatus.BAD_REQUEST);
    }

    const folderId = await this.resolveFolderId(req.user.tenantId, body.folderId);
    try {
      await this.storage.assertObjectExists(storagePath);
    } catch (err: any) {
      throw new HttpException(
        `Upload did not finish in storage: ${err.message}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const fileHash = typeof body.fileHash === 'string' && /^[a-f0-9]{64}$/i.test(body.fileHash)
      ? body.fileHash.toLowerCase()
      : null;
    const asset = await this.prisma.client.asset.create({
      data: {
        tenantId: req.user.tenantId,
        uploadedByUserId: req.user.id,
        fileUrl: this.storage.publicUrlForPath(storagePath),
        mimeType,
        fileSize: Number(body.size),
        fileHash,
        originalName: body.filename || null,
        status: this.initialAssetStatus(req.user.role),
        folderId,
      },
    });

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
      throw new HttpException(
        'No file uploaded, or file type is not supported. Allowed: images (JPG/PNG/WebP/GIF/SVG), MP4/WebM video, audio, PDF. QuickTime .mov and AVI are not supported — export as MP4 first.',
        HttpStatus.BAD_REQUEST,
      );
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
      if (!folder) throw new HttpException('Folder not found', HttpStatus.NOT_FOUND);
      folderId = folder.id;
    }

    // Normalize the multer payload to a real Buffer ONCE. Multer sometimes
    // delivers a serialized `{type:'Buffer',data:[...]}` instead of a
    // native Buffer (depends on the IPC/proxy boundary). Reuse the same
    // normalized bytes for both the upload AND the SHA-256 hash so we
    // never crash with ERR_INVALID_ARG_TYPE on createHash.
    const safeBuffer = this.storage.toSafeBuffer(file.buffer);

    // Optimize IMAGES inline before storing — a 4000px PNG saved as 8MB
    // becomes a ~0.5MB WebP that's visually identical on a screen, so every
    // screen/preview/CI fetch is of the small version forever. This is the
    // permanent fix for storage egress. Images are sub-second; VIDEO is left
    // to the background optimizer (transcode is too slow to block the
    // request and would risk an upload timeout). On ANY failure the service
    // returns the original buffer, so an upload never breaks. Format may
    // change (png/jpeg → webp), so the path extension + stored mimeType +
    // fileSize all come from the optimizer result.
    let uploadBuf = safeBuffer;
    let uploadMime = file.mimetype;
    let uploadExt = extname(file.originalname) || '';
    if (this.mediaOpt.isOptimizableImage(file.mimetype)) {
      const opt = await this.mediaOpt.optimize(safeBuffer, file.mimetype, uploadExt);
      if (opt.optimized) {
        uploadBuf = opt.buffer;
        uploadMime = opt.mimeType;
        uploadExt = opt.ext;
      }
    }

    // Upload to Supabase Storage: tenant/<tenantId>/<uuid>.<ext>
    const storagePath = `${req.user.tenantId}/${randomUUID()}${uploadExt}`;

    let fileUrl: string;
    try {
      fileUrl = await this.storage.upload(storagePath, uploadBuf, uploadMime);
    } catch (err: any) {
      throw new HttpException(
        `Upload failed: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
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
      },
    });

    if (asset.status === 'PENDING_APPROVAL') {
      // Fire-and-forget — don't block the upload response on
      // notification fan-out.
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
    };
  }

  /**
   * Delete an asset (and its file from Supabase Storage).
   */
  @Delete(':id')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async remove(@Request() req: any, @Param('id') id: string) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!asset) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

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

    // Delete playlist items referencing this asset
    await this.prisma.client.playlistItem.deleteMany({ where: { assetId: id } });

    // Delete from Supabase Storage if it's a Supabase URL
    const storagePath = this.storage.extractPath(asset.fileUrl);
    if (storagePath) {
      await this.storage.delete(storagePath);
    }

    await this.prisma.client.asset.delete({ where: { id } });
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
      throw new HttpException('URL is required', HttpStatus.BAD_REQUEST);
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
      if (!folder) throw new HttpException('Folder not found', HttpStatus.NOT_FOUND);
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
        throw new HttpException('Device invalid', HttpStatus.FORBIDDEN);
      }
      scopeTenantId = screen.tenantId ?? null;
    } else if (u.role === AppRole.SUPER_ADMIN) {
      scopeTenantId = null;
    } else {
      scopeTenantId = u.schoolId || u.tenantId || u.districtId || null;
      if (!scopeTenantId) {
        throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);
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
      throw new HttpException('Asset not found', HttpStatus.NOT_FOUND);
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
    if (!asset) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
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
    if (!asset) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
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
    if (!asset) throw new HttpException('Not found', HttpStatus.NOT_FOUND);

    if (body.folderId) {
      const folder = await this.prisma.client.assetFolder.findFirst({
        where: { id: body.folderId, tenantId: req.user.tenantId },
      });
      if (!folder) throw new HttpException('Folder not found', HttpStatus.NOT_FOUND);
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
      throw new HttpException('Folder name is required', HttpStatus.BAD_REQUEST);
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
        throw new HttpException('Parent folder not found', HttpStatus.BAD_REQUEST);
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
    if (!folder) throw new HttpException('Folder not found', HttpStatus.NOT_FOUND);
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
    if (!folder) throw new HttpException('Folder not found', HttpStatus.NOT_FOUND);

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
