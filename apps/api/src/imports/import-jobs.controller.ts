import {
  Body, Controller, Get, HttpException, HttpStatus, Param, Post,
  Request, UploadedFile, UseGuards, UseInterceptors, Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { AppRole } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { ImportPrepareService, PrepareRejection } from './import-prepare.service';
import { ImportCommitService, CommitRejection, type PageSelection } from './import-commit.service';
import type { ImportManifest, ManifestPageView } from './import-manifest';

/** Matches the upload cap the converter and the staging bucket both enforce. */
const MAX_BYTES = 50 * 1024 * 1024;
/** How long a preview link lives. Long enough to review, short enough to rot. */
const PREVIEW_TTL_SECONDS = 15 * 60;

/**
 * Import, as two deliberate steps.
 *
 * `prepare` converts and reports; `commit` creates. Between them the operator
 * sees what the conversion ACTUALLY produced, page by page, and chooses. That
 * gap is the entire point: the endpoint this replaces converted and committed
 * in one call, which is why it could tell someone "2 editable templates (one
 * per page)" about a three-page document and never be contradicted.
 *
 * Every route is tenant-scoped on the job row itself, not on a client-supplied
 * tenant, and preview links are minted per read — the manifest stores object
 * keys, never URLs, because a stored signature is a signature that expires.
 */
@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/imports')
export class ImportJobsController {
  private readonly logger = new Logger(ImportJobsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
    private readonly prepareSvc: ImportPrepareService,
    private readonly commitSvc: ImportCommitService,
  ) {}

  /**
   * Stage, convert, and report. Creates nothing an operator can see.
   *
   * Conversion is CPU- and memory-heavy and this API runs one replica that also
   * publishes lockdown alerts, so the route is throttled and the parser carries
   * its own byte ceilings.
   */
  @Post('prepare')
  @RequireRoles(
    AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR,
  )
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_BYTES },
      // No filter here on purpose. The browser's Content-Type and the filename
      // are both client-supplied; `sniffImportFormat` decides from the bytes
      // and returns a rejection that names the fix.
    }),
  )
  async prepare(@Request() req: any, @UploadedFile() file: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new HttpException(
        { code: 'IMPORTS_FILE_REQUIRED', message: 'Choose a file to import.' },
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      const { jobId, manifest } = await this.prepareSvc.prepare({
        tenantId: req.user.tenantId,
        userId: req.user.id,
        originalName: String(file.originalname || 'Imported design'),
        bytes: file.buffer,
      });
      return { ok: true, jobId, manifest: await this.withPreviewUrls(manifest) };
    } catch (err: unknown) {
      throw this.toHttp(err, 'prepare');
    }
  }

  /** Re-read a job, with freshly minted preview links. Survives a refresh. */
  @Get('jobs/:id')
  @RequireRoles(
    AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR,
  )
  async getJob(@Request() req: any, @Param('id') id: string) {
    const job = await this.prisma.client.importJob.findFirst({
      where: { id, tenantId: req.user.tenantId },
      select: {
        id: true, status: true, sourceName: true, sourcePageCount: true,
        manifest: true, result: true, failureCode: true, failureDetail: true, expiresAt: true,
      },
    });
    if (!job) {
      throw new HttpException(
        { code: 'IMPORT_JOB_NOT_FOUND', message: 'That import has expired or does not exist.' },
        HttpStatus.NOT_FOUND,
      );
    }
    const manifest = job.manifest ? (JSON.parse(job.manifest) as ImportManifest) : null;
    return {
      ok: true,
      job: {
        id: job.id,
        status: job.status,
        sourceName: job.sourceName,
        sourcePageCount: job.sourcePageCount,
        expiresAt: job.expiresAt,
        failureCode: job.failureCode,
        failureDetail: job.failureDetail,
        result: job.result ? JSON.parse(job.result) : null,
      },
      manifest: manifest ? await this.withPreviewUrls(manifest) : null,
    };
  }

  /** Create exactly the pages the operator selected, in the modes they chose. */
  @Post('jobs/:id/commit')
  @RequireRoles(
    AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN, AppRole.SCHOOL_ADMIN, AppRole.CONTRIBUTOR,
  )
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async commit(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { selections?: PageSelection[] } = {},
  ) {
    try {
      const result = await this.commitSvc.commit({
        tenantId: req.user.tenantId,
        userId: req.user.id,
        userRole: String(req.user.role || ''),
        jobId: id,
        selections: Array.isArray(body?.selections) ? body.selections : [],
      });
      return { ok: true, ...result };
    } catch (err: unknown) {
      throw this.toHttp(err, 'commit');
    }
  }

  /**
   * Swap staged object keys for short-lived signed links.
   *
   * Done on every read rather than at prepare time because a link minted once
   * and stored is a link that is expired by the time anyone follows it — and
   * because a key in the database is inert if the row leaks, while a signature
   * is not.
   */
  private async withPreviewUrls(manifest: ImportManifest): Promise<ImportManifest> {
    const bucket = this.storage.importStagingBucketName();
    const pages: ManifestPageView[] = await Promise.all(
      manifest.pages.map(async (p) => ({
        ...p,
        previewUrl: p.rasterObjectKey
          ? (await this.storage.createSignedUrl(p.rasterObjectKey, PREVIEW_TTL_SECONDS, bucket)) ?? undefined
          : undefined,
        thumbUrl: p.thumbObjectKey
          ? (await this.storage.createSignedUrl(p.thumbObjectKey, PREVIEW_TTL_SECONDS, bucket)) ?? undefined
          : undefined,
      })),
    );
    return { ...manifest, pages };
  }

  /**
   * A rejection we authored carries a code and a sentence the operator can act
   * on, so it goes back as-is. Anything else is ours to explain and log, not
   * theirs to read — an internal message can carry a bucket name or a stack.
   */
  private toHttp(err: unknown, stage: string): HttpException {
    if (err instanceof PrepareRejection || err instanceof CommitRejection) {
      // A prepare refusal carries its own status: 503 for a renderer that is
      // busy or down (the review page offers the same file again), 413/422 for
      // a file that is itself the problem. Its `reason` stays on the job row.
      //
      // A COMMIT refusal carries one too, for the same reason: "this import is
      // already being added" is a 409 the screen can recognise and leave alone,
      // not a 400 that reads as "your request was malformed" (re-audit R5).
      const status =
        err.code === 'IMPORT_JOB_NOT_FOUND'
          ? HttpStatus.NOT_FOUND
          : err.status ?? HttpStatus.BAD_REQUEST;
      return new HttpException({ code: err.code, message: err.message }, status);
    }
    if (err instanceof HttpException) return err;
    const detail = err instanceof Error ? err.message : String(err);
    this.logger.error(`[import] ${stage} failed: ${detail}`, err instanceof Error ? err.stack : undefined);
    return new HttpException(
      { code: 'IMPORT_FAILED', message: 'That import could not be completed. Try again, or try a different file.' },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
