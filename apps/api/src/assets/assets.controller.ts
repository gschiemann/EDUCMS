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
import { randomUUID } from 'crypto';
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
  async upload(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new HttpException(
        'No file uploaded, or file type is not supported. Allowed: images, video, audio, PDF.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Upload to Supabase Storage: tenant/<tenantId>/<uuid>.<ext>
    const ext = extname(file.originalname) || '';
    const storagePath = `${req.user.tenantId}/${randomUUID()}${ext}`;

    let fileUrl: string;
    try {
      fileUrl = await this.storage.upload(storagePath, file.buffer, file.mimetype);
    } catch (err: any) {
      throw new HttpException(
        `Upload failed: ${err.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    const asset = await this.prisma.client.asset.create({
      data: {
        tenantId: req.user.tenantId,
        uploadedByUserId: req.user.id,
        fileUrl,
        mimeType: file.mimetype,
        fileSize: file.size,
        originalName: file.originalname,
        status: 'PUBLISHED',
      },
    });

    return {
      id: asset.id,
      fileUrl: asset.fileUrl,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize,
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
        status: 'PUBLISHED',
      },
    });

    return { id: asset.id, fileUrl: url };
  }

  @Put(':id/approve')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async approve(@Request() req: any, @Param('id') id: string) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!asset) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return this.prisma.client.asset.update({ where: { id }, data: { status: 'PUBLISHED' } });
  }

  @Put(':id/reject')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN)
  async reject(@Request() req: any, @Param('id') id: string) {
    const asset = await this.prisma.client.asset.findFirst({
      where: { id, tenantId: req.user.tenantId },
    });
    if (!asset) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return this.prisma.client.asset.update({ where: { id }, data: { status: 'ARCHIVED' } });
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
