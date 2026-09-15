import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { parsePptx } from './parsers/pptx-parser';
import { parsePdf } from './parsers/pdf-parser';
import { buildImport, type BuiltTemplate } from './parsers/import-builder';
import { CONVERTER_VERSION } from './import-prepare.service';
import type { ImportManifest, PageMode } from './import-manifest';

/** One page the operator chose, and how they chose to bring it in. */
export interface PageSelection {
  sourcePage: number;
  mode: PageMode;
}

export interface CommitResult {
  templates: Array<{ id: string; name: string; sourcePage: number; mode: PageMode }>;
  skippedPages: number[];
}

/**
 * COMMIT — the only place this feature creates anything durable.
 *
 * Four properties, each of which the old single-call endpoint failed:
 *
 *   1. It creates exactly what was selected. No playlist appears as a side
 *      effect of importing templates.
 *   2. Every row lands in ONE transaction together with the audit record. The
 *      old path wrote an original, a playlist and some templates, then wrote
 *      the audit best-effort and returned success even when that failed.
 *   3. Nothing is converted or uploaded inside that transaction. All the slow,
 *      fallible work — re-parsing, reading rasters back, publishing assets —
 *      finishes first, so the transaction is a short burst of inserts.
 *   4. Moderation follows the derivative. An asset extracted from a
 *      contributor's upload inherits the contributor's review state instead of
 *      being written APPROVED because it came out of a document.
 *
 * Re-converting rather than replaying stored zones is deliberate. The staged
 * original is already private and parsing it again is cheap — the expensive
 * half was rasterizing, which is not repeated — and it means the manifest never
 * has to hold the words on someone's slides just so commit can read them back.
 */
@Injectable()
export class ImportCommitService {
  private readonly logger = new Logger(ImportCommitService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
  ) {}

  async commit(input: {
    tenantId: string;
    userId: string;
    userRole: string;
    jobId: string;
    selections: PageSelection[];
    namePrefix?: string;
  }): Promise<CommitResult> {
    const { tenantId, userId, jobId } = input;

    const job = await this.prisma.client.importJob.findFirst({
      where: { id: jobId, tenantId },
    });
    if (!job) throw new CommitRejection('IMPORT_JOB_NOT_FOUND', 'That import has expired or does not exist.');
    if (job.status === 'COMMITTED') {
      // Idempotent enough for the one case that matters: the operator pressed
      // Add twice, or a retry arrived after a timeout. Hand back what the first
      // call made rather than making it again.
      const prior = job.result ? (JSON.parse(job.result) as CommitResult) : { templates: [], skippedPages: [] };
      return prior;
    }
    if (job.status !== 'PREPARED') {
      throw new CommitRejection('IMPORT_JOB_NOT_READY', 'That import is no longer ready to add.');
    }

    const manifest = JSON.parse(job.manifest ?? '{}') as ImportManifest;
    if (manifest.version !== 1) {
      throw new CommitRejection('IMPORT_JOB_STALE', 'That import was prepared by an older version. Import the file again.');
    }
    if (job.converterVersion !== CONVERTER_VERSION) {
      // A deploy landed between prepare and commit. The operator reviewed
      // output this build may no longer produce, and quietly giving them
      // something else is exactly the substitution this program exists to stop.
      throw new CommitRejection(
        'IMPORT_JOB_STALE',
        'This import was prepared before a recent update. Import the file again so you can review what the current version produces.',
      );
    }

    const wanted = this.validateSelections(manifest, input.selections);
    if (wanted.length === 0) {
      throw new CommitRejection('IMPORT_NOTHING_SELECTED', 'Choose at least one page to add.');
    }

    // ── Everything slow and fallible, BEFORE the transaction ──────────
    const source = await this.storage.downloadFromBucket(
      this.storage.importStagingBucketName(),
      job.sourceObject,
    );
    if (!source) {
      throw new CommitRejection('IMPORT_SOURCE_GONE', 'The uploaded file is no longer available. Import it again.');
    }
    if (createHash('sha256').update(source).digest('hex') !== job.sourceSha256) {
      throw new CommitRejection('IMPORT_SOURCE_CHANGED', 'The staged file does not match what was reviewed. Import it again.');
    }

    const assetStatus = input.userRole === 'CONTRIBUTOR' ? 'PENDING_APPROVAL' : 'APPROVED';
    const { plans, mediaRows } = await this.buildPlans({
      job, manifest, wanted, source, tenantId, userId, assetStatus,
    });

    // ── One short transaction: the rows, and the record that they happened ──
    const created = await this.prisma.client.$transaction(async (tx) => {
      const out: CommitResult['templates'] = [];
      // Embedded pictures first: their bytes are already in storage, and their
      // rows belong to the same all-or-nothing as the templates that use them.
      for (const row of mediaRows) await tx.asset.create({ data: row });
      for (const plan of plans) {
        if (plan.assetData) await tx.asset.create({ data: plan.assetData });
        const tpl = await tx.template.create({
          data: plan.templateData,
          select: { id: true, name: true },
        });
        out.push({ id: tpl.id, name: tpl.name, sourcePage: plan.sourcePage, mode: plan.mode });
      }
      await tx.auditLog.create({
        data: {
          tenantId,
          userId,
          action: 'IMPORT_DESIGN',
          targetType: 'ImportJob',
          targetId: jobId,
          details: JSON.stringify({
            format: manifest.format,
            sourcePageCount: manifest.sourcePageCount,
            selected: wanted.length,
            created: out.length,
            modes: wanted.map((w) => w.mode),
            converterVersion: job.converterVersion,
            warningCodes: [...new Set(manifest.warnings.map((w) => w.code))],
          }),
        },
      });
      return out;
    });

    const result: CommitResult = {
      templates: created,
      skippedPages: manifest.pages
        .filter((p) => p.defaultMode !== null && !wanted.some((w) => w.sourcePage === p.sourcePage))
        .map((p) => p.sourcePage),
    };
    await this.prisma.client.importJob.updateMany({
      where: { id: jobId, tenantId },
      data: { status: 'COMMITTED', committedAt: new Date(), result: JSON.stringify(result) },
    });

    this.logger.log(
      `[import] committed job=${jobId} tenant=${tenantId} templates=${created.length} skipped=${result.skippedPages.length}`,
    );
    return result;
  }

  /**
   * A selection has to name a page this job actually has, in a mode that page
   * actually offers. Anything else is a client bug or a tampered request, and
   * both deserve a refusal rather than a best guess.
   */
  private validateSelections(manifest: ImportManifest, selections: PageSelection[]): PageSelection[] {
    const byPage = new Map(manifest.pages.map((p) => [p.sourcePage, p]));
    const seen = new Set<number>();
    const out: PageSelection[] = [];
    for (const sel of selections ?? []) {
      const page = byPage.get(sel.sourcePage);
      if (!page || seen.has(sel.sourcePage)) continue;
      if (!page.availableModes.includes(sel.mode)) {
        throw new CommitRejection(
          'IMPORT_MODE_UNAVAILABLE',
          `Page ${sel.sourcePage} cannot be added that way. Review the import again.`,
        );
      }
      seen.add(sel.sourcePage);
      out.push(sel);
    }
    return out.sort((a, b) => a.sourcePage - b.sourcePage);
  }

  /**
   * Turn each selection into the exact rows it will become. Storage writes
   * happen here; the caller's transaction only inserts.
   */
  private async buildPlans(ctx: {
    job: { id: string; sourceName: string; sourceObject: string };
    manifest: ImportManifest;
    wanted: PageSelection[];
    source: Buffer;
    tenantId: string;
    userId: string;
    assetStatus: string;
  }): Promise<{ plans: CommitPlan[]; mediaRows: Prisma.AssetUncheckedCreateInput[] }> {
    const { manifest, wanted, tenantId, userId, assetStatus } = ctx;
    const mediaRows: Prisma.AssetUncheckedCreateInput[] = [];
    const baseName = ctx.job.sourceName.replace(/\.[^.]+$/, '').slice(0, 80) || 'Imported design';
    const multi = wanted.length > 1;

    // Re-convert once, only if any page was chosen as editable.
    let editableByPage = new Map<number, BuiltTemplate>();
    if (wanted.some((w) => w.mode === 'editable')) {
      editableByPage = await this.reconvertEditable(
        ctx.source, manifest, tenantId, userId, assetStatus, mediaRows,
      );
    }

    const plans: CommitPlan[] = [];
    for (const sel of wanted) {
      const page = manifest.pages.find((p) => p.sourcePage === sel.sourcePage)!;
      const name = multi ? `${baseName} — ${page.label}` : baseName;

      if (sel.mode === 'preserve') {
        const key = page.rasterObjectKey;
        if (!key) continue;
        const bytes = await this.storage.downloadFromBucket(this.storage.importStagingBucketName(), key);
        if (!bytes) continue;
        // Published to the PUBLIC assets bucket on purpose: a screen must never
        // depend on a signed URL that expires.
        const publicPath = `${tenantId}/${randomUUID()}.webp`;
        const fileUrl = await this.storage.upload(publicPath, bytes, 'image/webp');
        plans.push({
          sourcePage: sel.sourcePage,
          mode: sel.mode,
          assetData: {
            tenantId,
            uploadedByUserId: userId,
            fileUrl,
            mimeType: 'image/webp',
            fileSize: bytes.length,
            fileHash: createHash('sha256').update(bytes).digest('hex'),
            originalName: `${name}.webp`,
            status: assetStatus,
          },
          templateData: this.templateRow({
            tenantId, userId, name,
            widthPx: page.widthPx ?? 1920,
            heightPx: page.heightPx ?? 1080,
            zones: [
              {
                name: page.label,
                widgetType: 'IMAGE',
                x: 0, y: 0, width: 100, height: 100, zIndex: 0, sortOrder: 0,
                defaultConfig: JSON.stringify({ assetUrl: fileUrl, fit: 'contain' }),
              },
            ],
          }),
        });
        continue;
      }

      const built = editableByPage.get(sel.sourcePage);
      if (!built) continue;
      plans.push({
        sourcePage: sel.sourcePage,
        mode: sel.mode,
        templateData: this.templateRow({
          tenantId, userId, name,
          widthPx: built.screenWidth,
          heightPx: built.screenHeight,
          bgColor: built.bgColor,
          zones: built.zones.map((z) => ({
            name: z.name,
            widgetType: z.widgetType,
            x: z.x, y: z.y, width: z.width, height: z.height,
            zIndex: z.zIndex, sortOrder: z.sortOrder,
            defaultConfig: JSON.stringify(z.defaultConfig),
          })),
        }),
      });
    }
    return { plans, mediaRows };
  }

  /**
   * Parse the staged original again and publish whatever media the zones need.
   *
   * The BYTES go to storage here, because a network round trip must never
   * happen inside a transaction. The Asset ROWS come back for the caller to
   * insert alongside the templates: created here they would survive a failed
   * commit, leaving approved pictures in the library belonging to a template
   * that was never made.
   */
  private async reconvertEditable(
    source: Buffer,
    manifest: ImportManifest,
    tenantId: string,
    userId: string,
    assetStatus: string,
    mediaRows: Prisma.AssetUncheckedCreateInput[],
  ): Promise<Map<number, BuiltTemplate>> {
    const parsed = manifest.format === 'pptx' ? await parsePptx(source) : await parsePdf(source);

    // Publish embedded pictures FIRST, so zones resolve to durable URLs. Each
    // one inherits the importer's review state — an image does not become
    // approved just because it arrived inside a document.
    const mediaUrls = new Map<string, string>();
    for (const m of parsed.media ?? []) {
      try {
        const safe = this.storage.toSafeBuffer(m.data);
        const path = `${tenantId}/${randomUUID()}${extFor(m.mimeType)}`;
        const fileUrl = await this.storage.upload(path, safe, m.mimeType);
        mediaRows.push({
          tenantId,
          uploadedByUserId: userId,
          fileUrl,
          mimeType: m.mimeType,
          fileSize: safe.length,
          fileHash: createHash('sha256').update(safe).digest('hex'),
          originalName: (m.name || 'Imported image').slice(0, 200),
          status: assetStatus,
        });
        mediaUrls.set(m.id, fileUrl);
      } catch (e: any) {
        this.logger.warn(`[import] embedded media failed (${m.id}): ${e?.message ?? e}`);
      } finally {
        (m as { data: Buffer }).data = Buffer.alloc(0);
      }
    }

    const built = buildImport(parsed, { resolveMedia: (id) => mediaUrls.get(id) ?? null });
    const out = new Map<number, BuiltTemplate>();
    for (const page of built.pages) if (page.template) out.set(page.sourcePage, page.template);
    return out;
  }

  private templateRow(args: {
    tenantId: string; userId: string; name: string;
    widthPx: number; heightPx: number; bgColor?: string;
    zones: Prisma.TemplateZoneCreateWithoutTemplateInput[];
  }): Prisma.TemplateUncheckedCreateInput {
    return {
      tenantId: args.tenantId,
      name: args.name,
      description: `Imported on ${new Date().toISOString().slice(0, 10)}`,
      category: 'CUSTOM',
      orientation: args.heightPx > args.widthPx ? 'PORTRAIT' : 'LANDSCAPE',
      screenWidth: args.widthPx,
      screenHeight: args.heightPx,
      bgColor: args.bgColor || '#ffffff',
      isSystem: false,
      status: 'ACTIVE',
      createdById: args.userId,
      zones: { create: args.zones },
    } satisfies Prisma.TemplateUncheckedCreateInput;
  }
}

interface CommitPlan {
  sourcePage: number;
  mode: PageMode;
  /**
   * Prisma's generated create inputs are structurally exact, and these rows are
   * assembled a few lines apart from where they are inserted. `any` here would
   * hide a field name typo until runtime, so the plan carries the real types.
   */
  assetData?: Prisma.AssetUncheckedCreateInput;
  templateData: Prisma.TemplateUncheckedCreateInput;
}

/** A commit we will not perform, with a message that names what to do. */
export class CommitRejection extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CommitRejection';
  }
}

function extFor(mime: string): string {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '';
}
