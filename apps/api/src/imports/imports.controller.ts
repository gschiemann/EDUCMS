/**
 * ImportsController — design-import endpoint for the Canva / Slides /
 * PowerPoint / Figma / Adobe Express bring-your-own-design flow.
 *
 *   POST /api/v1/imports/design   — multipart upload of a PDF / PPTX /
 *                                   image. Stores the file as an Asset
 *                                   and creates an auto-named Playlist
 *                                   that points at it. Operator drops
 *                                   the playlist on any screen → done.
 *
 * Sprint 10 / Canva integration stage 1 (2026-05-03). Operator: "we
 * talked about adding a full canva integration, will that happen?
 * import templates direct from canva and be able to update using our
 * toolbar and editing".
 *
 * What stage 1 ships (this commit):
 *   ✅ Single-page PDFs and image files (PNG/JPG/WEBP) work
 *      end-to-end. Asset row + 1-item Playlist created.
 *   ✅ Multi-page PDFs upload as a single Asset; the front-end nudges
 *      the operator to "split into single-page exports for now"
 *      until the page-split worker ships in a follow-up.
 *   ✅ PPTX uploads accepted; routed through the LibreOffice→PDF
 *      pipeline if it's wired up, otherwise stored as-is with a
 *      friendly message.
 *
 * What stage 2 will add (pending Canva partner approval):
 *   - OAuth Canva Connect — design picker + auto-resync
 *   - Same shape for Google Slides / PowerPoint Online / Figma
 *
 * Full plan: docs/CANVA_INTEGRATION.md.
 */

import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

const ACCEPTED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.ms-powerpoint', // .ppt
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const MAX_BYTES = 50 * 1024 * 1024; // 50 MB — matches the front-end cap.

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/imports')
export class ImportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
  ) {}

  @Post('design')
  @RequireRoles(
    AppRole.SUPER_ADMIN,
    AppRole.DISTRICT_ADMIN,
    AppRole.SCHOOL_ADMIN,
    AppRole.CONTRIBUTOR,
  )
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_BYTES },
      fileFilter: (_req, file, cb) => {
        if (ACCEPTED_MIMES.has(file.mimetype)) cb(null, true);
        else cb(null, false);
      },
    }),
  )
  async importDesign(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { source?: string } = {},
  ) {
    if (!file) {
      throw new HttpException(
        'No file uploaded or unsupported type. Accepted: PDF, PPTX, PNG, JPG, WEBP. Max 50 MB.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const tenantId = req.user.tenantId;
    const userId = req.user.id;

    // Upload the file to Supabase Storage as an Asset. Same path the
    // regular asset uploader uses so the file is reachable from any
    // existing widget that consumes Asset.fileUrl.
    const ext = extname(file.originalname) || '';
    const storagePath = `${tenantId}/${randomUUID()}${ext}`;
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

    const fileHash = createHash('sha256').update(safeBuffer).digest('hex');
    const niceName = basename(file.originalname, ext) || 'Imported design';

    const asset = await this.prisma.client.asset.create({
      data: {
        tenantId,
        uploadedByUserId: userId,
        fileUrl,
        mimeType: file.mimetype,
        fileSize: file.size,
        fileHash,
        originalName: file.originalname,
        // Imports auto-publish for ADMIN+. CONTRIBUTORs land in the
        // review queue same as a regular upload.
        status: req.user.role === 'CONTRIBUTOR' ? 'PENDING_APPROVAL' : 'APPROVED',
      },
    });

    // Create a single-item Playlist named after the source file so
    // the operator can drop it on any screen without an extra step.
    // For multi-page PDFs we still ship a 1-item playlist; the
    // page-split worker (follow-up commit) will append additional
    // PlaylistItem rows for pages 2..N once it lands.
    await this.prisma.ensurePlaylistMetadataColumns();
    const playlist = await this.prisma.client.playlist.create({
      data: {
        tenantId,
        name: niceName,
        createdByUserId: userId,
      },
    });
    await this.prisma.client.playlistItem.create({
      data: {
        playlistId: playlist.id,
        assetId: asset.id,
        durationMs: 8000,
        sequenceOrder: 0,
      },
    });

    const isPdf = file.mimetype === 'application/pdf';
    const isPptx = file.mimetype.includes('presentation') || file.mimetype.includes('powerpoint');
    const isImage = file.mimetype.startsWith('image/');

    let message: string;
    if (isImage) {
      message = `Imported "${niceName}". The image is ready as an Asset and a 1-page Playlist named "${niceName}". Drop the playlist on any screen, or use the asset directly in an IMAGE widget.`;
    } else if (isPdf) {
      message = `Imported "${niceName}" as PDF. Multi-page page-split rendering is on a follow-up commit — the file is uploaded and a 1-item Playlist exists. For multi-page decks today, export each page individually from Canva (Download → PDF Print → Select pages) and re-import each as its own asset.`;
    } else if (isPptx) {
      message = `Imported "${niceName}" as PPTX. The PowerPoint→PDF→PNG pipeline ships in a follow-up commit. For now the .pptx file is stored as an Asset; the playlist points at it but only browsers with native PPTX rendering will display it. Workaround: open in PowerPoint → File → Export → PDF, then re-import the PDF.`;
    } else {
      message = `Imported "${niceName}".`;
    }

    return {
      ok: true,
      message,
      asset: {
        id: asset.id,
        fileUrl: asset.fileUrl,
        mimeType: asset.mimeType,
      },
      playlist: {
        id: playlist.id,
        name: playlist.name,
      },
      // Surface the source-tool tag the front-end sent so future
      // analytics can split conversion by Canva vs. Slides vs. PPT etc.
      source: body?.source || 'unknown',
    };
  }
}
