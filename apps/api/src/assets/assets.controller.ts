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

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/bmp',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4',
  'application/pdf',
];

@Controller('api/v1/assets')
@UseGuards(JwtAuthGuard, RbacGuard)
export class AssetsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
  ) {}

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
        select: { id: true },
      });
      const uploader = await this.prisma.client.user.findUnique({
        where: { id: asset.uploadedByUserId },
        select: { email: true },
      });
      const title = 'New asset pending review';
      const body = `${uploader?.email || 'A contributor'} uploaded "${asset.originalName || 'an asset'}" — review needed before it can be scheduled.`;
      if (admins.length > 0) {
        await this.prisma.client.notification.createMany({
          data: admins.map((a: { id: string }) => ({
            tenantId,
            userId: a.id,
            kind: 'ASSET_PENDING_REVIEW',
            title,
            body,
            link: `/assets/review`,
          })),
        }).catch(() => { /* notification table may be missing in dev */ });
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
    } catch { /* non-fatal */ }
  }

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async list(@Request() req: any) {
    const tenantId = req.user.tenantId;
    return this.prisma.client.asset.findMany({
      where: { tenantId },
      include: {
        uploadedBy: { select: { id: true, email: true } },
        folder: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * File upload endpoint.
   * Receives file via multer (memory storage), uploads to Supabase Storage.
   */
  @Post('upload')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB (Matches Supabase free-tier limits)
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
        'No file uploaded, or file type is not supported. Allowed: images, video, audio, PDF.',
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

    // Upload to Supabase Storage: tenant/<tenantId>/<uuid>.<ext>
    const ext = extname(file.originalname) || '';
    const storagePath = `${req.user.tenantId}/${randomUUID()}${ext}`;

    // Normalize the multer payload to a real Buffer ONCE. Multer sometimes
    // delivers a serialized `{type:'Buffer',data:[...]}` instead of a
    // native Buffer (depends on the IPC/proxy boundary). Reuse the same
    // normalized bytes for both the upload AND the SHA-256 hash so we
    // never crash with ERR_INVALID_ARG_TYPE on createHash.
    const safeBuffer = this.storage.toSafeBuffer(file.buffer);

    let fileUrl: string;
    try {
      fileUrl = await this.storage.upload(storagePath, safeBuffer, file.mimetype);
    } catch (err: any) {
      throw new HttpException(
        `Upload failed: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    // SHA-256 hash so the offline-cache Service Worker can detect when an
    // asset has been replaced server-side without the URL changing, and
    // re-download exactly the diff. Computed in-memory from the same
    // normalized buffer — no extra read.
    const fileHash = createHash('sha256').update(safeBuffer).digest('hex');

    const asset = await this.prisma.client.asset.create({
      data: {
        tenantId: req.user.tenantId,
        uploadedByUserId: req.user.id,
        fileUrl,
        mimeType: file.mimetype,
        fileSize: file.size,
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
  async addUrl(@Request() req: any, @Body() body: { url: string; name?: string }) {
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

    const asset = await this.prisma.client.asset.create({
      data: {
        tenantId: req.user.tenantId,
        uploadedByUserId: req.user.id,
        fileUrl: url,
        mimeType: 'text/html',
        originalName: body.name || hostname,
        status: this.initialAssetStatus(req.user.role),
      },
    });

    if (asset.status === 'PENDING_APPROVAL') {
      this.notifyAdminsOfPendingReview(req.user.tenantId, asset);
    }

    return { id: asset.id, fileUrl: url };
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
