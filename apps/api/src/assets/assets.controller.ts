import {
  Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Request,
  UseInterceptors, UploadedFile, Res, HttpException, HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { existsSync, mkdirSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Ensure upload directory exists
if (!existsSync(UPLOAD_DIR)) {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/bmp',
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4',
  'application/pdf',
];

const storage = diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${randomUUID()}${extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

@Controller('api/v1/assets')
@UseGuards(JwtAuthGuard, RbacGuard)
export class AssetsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  async list(@Request() req: any) {
    const tenantId = req.user.tenantId;
    return this.prisma.client.asset.findMany({
      where: { tenantId },
      include: {
        uploadedBy: { select: { id: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * File upload endpoint.
   * Stores file on disk, creates asset record with full metadata.
   */
  @Post('upload')
  @RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR)
  @UseInterceptors(FileInterceptor('file', {
    storage,
    limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_TYPES.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(null, false); // Reject without throwing — we handle it below
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

    const asset = await this.prisma.client.asset.create({
      data: {
        tenantId: req.user.tenantId,
        uploadedByUserId: req.user.id,
        fileUrl: `/api/v1/assets/file/${file.filename}`,
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
   * Delete an asset (and its file from disk).
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

    // Delete from disk if it's a local file
    if (asset.fileUrl.startsWith('/api/v1/assets/file/')) {
      const filename = asset.fileUrl.split('/').pop();
      if (filename) {
        const filePath = join(process.cwd(), UPLOAD_DIR, filename);
        if (existsSync(filePath)) {
          try { unlinkSync(filePath); } catch { /* ignore */ }
        }
      }
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
}
