import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { PdfRasterService } from './raster/pdf-raster.service';
import { parsePptx } from './parsers/pptx-parser';
import { parsePdf } from './parsers/pdf-parser';
import { buildImport, type BuiltPage } from './parsers/import-builder';
import { collectWarnings, type ImportWarning } from './parsers/types';
import { sniffImportFormat, EXT_FOR_FORMAT, type ImportFormat } from './file-signature';
import type { ImportManifest, ManifestPage, PageMode } from './import-manifest';

/** How long a staged job lives before the sweep clears it. */
const JOB_TTL_MS = 24 * 60 * 60_000;

/**
 * PREPARE — everything that happens before the operator decides anything.
 *
 * The old endpoint converted and committed in one call, which is why it could
 * tell an operator "2 editable templates (one per page)" about a three-page
 * document: nothing ever showed them the conversion, so nothing could contradict
 * it. Prepare stages the original privately, converts it, records what happened
 * to every single source page, and stops. Commit is a separate, explicit act.
 *
 * Nothing here writes a Template, an Asset or a Playlist. The only durable
 * effects are objects in the PRIVATE staging bucket and one ImportJob row, both
 * disposable, both swept on a clock.
 */
@Injectable()
export class ImportPrepareService {
  private readonly logger = new Logger(ImportPrepareService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
    private readonly raster: PdfRasterService,
  ) {}

  /**
   * Convert an upload and record what happened to it.
   *
   * Throws `PrepareRejection` for a file we will not accept — with a message
   * that names the fix, because "unsupported file" is not something an operator
   * can act on.
   */
  async prepare(input: {
    tenantId: string;
    userId: string;
    originalName: string;
    bytes: Buffer;
  }): Promise<{ jobId: string; manifest: ImportManifest }> {
    const { tenantId, userId, bytes } = input;

    // 1. What IS this? Decided from the bytes; the filename only shapes the
    //    error message. A legacy .ppt stops here with the one-click fix rather
    //    than failing to parse three steps later and being called a success.
    const sniff = sniffImportFormat(bytes, input.originalName);
    if (!sniff.ok) throw new PrepareRejection(sniff.code, sniff.message);

    const jobId = randomUUID();
    const prefix = `${tenantId}/${jobId}`;
    const sourceObject = `${prefix}/source${sniff.ext}`;

    // 2. Stage the original PRIVATELY. It is the operator's document, not
    //    signage, and it may carry notes and hidden slides never meant for a
    //    screen.
    await this.storage.uploadImportStaging(sourceObject, bytes, sniff.mime);

    // 3. Convert. Storage writes happen here, before any transaction — a DB
    //    transaction held open across a network upload is how you get a pool
    //    stall that outlives the request.
    let built: { pages: BuiltPage[]; sourcePageCount: number; warnings: ImportWarning[] };
    let manifestPages: ManifestPage[];
    let preserveUnavailableReason: string | undefined;

    if (sniff.format === 'pdf') {
      ({ built, manifestPages } = await this.preparePdf(bytes, prefix));
    } else if (sniff.format === 'pptx') {
      ({ built, manifestPages, preserveUnavailableReason } = await this.preparePptx(bytes));
    } else {
      ({ built, manifestPages } = await this.prepareImage(bytes, sniff, prefix));
    }

    const manifest: ImportManifest = {
      version: 1,
      format: sniff.format === 'pdf' ? 'pdf' : sniff.format === 'pptx' ? 'pptx' : 'image',
      sourcePageCount: built.sourcePageCount,
      pages: manifestPages,
      warnings: built.warnings,
      preserveUnavailableReason,
    };

    await this.prisma.client.importJob.create({
      data: {
        id: jobId,
        tenantId,
        createdByUserId: userId,
        status: 'PREPARED',
        sourceName: input.originalName.slice(0, 200),
        sourceMime: sniff.mime,
        sourceBytes: bytes.length,
        sourceSha256: createHash('sha256').update(bytes).digest('hex'),
        sourceObject,
        sourcePageCount: built.sourcePageCount,
        manifest: JSON.stringify(manifest),
        warnings: JSON.stringify(built.warnings),
        converterVersion: CONVERTER_VERSION,
        expiresAt: new Date(Date.now() + JOB_TTL_MS),
      },
    });

    this.logger.log(
      `[import] prepared job=${jobId} tenant=${tenantId} format=${sniff.format} ` +
        `sourcePages=${built.sourcePageCount} accounted=${manifestPages.length} ` +
        `warnings=${built.warnings.length}`,
    );
    return { jobId, manifest };
  }

  /**
   * PDF: both modes are real. Every page rasterizes (that is what makes
   * `preserve` honest), and the text extraction on top is what makes `editable`
   * possible. A page with artwork and no text still has a raster, so it is
   * offered as `preserve` instead of disappearing — which is exactly the bug
   * the audit reproduced.
   */
  private async preparePdf(bytes: Buffer, prefix: string) {
    const rastered = await this.raster.rasterizePdf(bytes);
    const parsed = await parsePdf(bytes);
    const built = buildImport(parsed, { resolveMedia: () => null });

    const rasterByPage = new Map<number, { key: string; thumbKey: string; w: number; h: number }>();
    if (rastered.ok) {
      for (const page of rastered.pages) {
        const key = `${prefix}/p${page.sourcePage}.webp`;
        const thumbKey = `${prefix}/p${page.sourcePage}.thumb.webp`;
        await this.storage.uploadImportStaging(key, page.webp, 'image/webp');
        await this.storage.uploadImportStaging(thumbKey, page.thumbWebp, 'image/webp');
        rasterByPage.set(page.sourcePage, {
          key, thumbKey, w: page.widthPx, h: page.heightPx,
        });
      }
    }

    const warnings = [...built.warnings, ...rasterWarnings(rastered)];

    const manifestPages = built.pages.map((page) => {
      const r = rasterByPage.get(page.sourcePage);
      const editable = countZones(page);
      const modes: PageMode[] = [];
      if (r) modes.push('preserve');
      if (page.template) modes.push('editable');
      return {
        sourcePage: page.sourcePage,
        label: page.label,
        disposition: page.disposition,
        availableModes: modes,
        // A rendered page is the safer default for a PDF: it always looks like
        // the source. Editable is one click away and the counts say what it
        // would give you.
        defaultMode: modes.includes('preserve') ? 'preserve' : modes[0] ?? null,
        editableTextCount: editable.text,
        editableImageCount: editable.image,
        rasterObjectKey: r?.key,
        thumbObjectKey: r?.thumbKey,
        widthPx: r?.w,
        heightPx: r?.h,
        warnings: page.warnings,
      } satisfies ManifestPage;
    });

    return {
      built: { pages: built.pages, sourcePageCount: built.sourcePageCount, warnings },
      manifestPages,
    };
  }

  /**
   * PPTX: editable layers only, and we say so.
   *
   * Rendering a deck faithfully needs a PowerPoint-compatible renderer, which
   * this image does not carry — and adding one is a separate decision with its
   * own size and licence cost. Rather than silently offering one mode, the
   * manifest carries the reason and the fix, because every authoring tool
   * exports a PDF in one click and that path is excellent.
   */
  private async preparePptx(bytes: Buffer) {
    const parsed = await parsePptx(bytes);
    // Media is resolved at COMMIT, not here: nothing durable should be created
    // for a job the operator may never commit. Zones that need an image are
    // counted now and wired then.
    const built = buildImport(parsed, { resolveMedia: (id) => `pending:${id}` });

    const manifestPages = built.pages.map((page) => {
      const editable = countZones(page);
      const modes: PageMode[] = page.template ? ['editable'] : [];
      return {
        sourcePage: page.sourcePage,
        label: page.label,
        disposition: page.disposition,
        availableModes: modes,
        defaultMode: modes[0] ?? null,
        editableTextCount: editable.text,
        editableImageCount: editable.image,
        warnings: page.warnings,
      } satisfies ManifestPage;
    });

    return {
      built: { pages: built.pages, sourcePageCount: built.sourcePageCount, warnings: built.warnings },
      manifestPages,
      preserveUnavailableReason:
        'We can pull a PowerPoint apart into editable text and pictures, but we cannot yet render a slide exactly as PowerPoint draws it. ' +
        'For a pixel-faithful import, export the deck to PDF and import that.',
    };
  }

  /** An image is one page, and the picture IS the highest-fidelity result. */
  private async prepareImage(bytes: Buffer, sniff: { mime: string; ext: string }, prefix: string) {
    const key = `${prefix}/p1${sniff.ext}`;
    await this.storage.uploadImportStaging(key, bytes, sniff.mime);
    const manifestPages: ManifestPage[] = [
      {
        sourcePage: 1,
        label: 'Image',
        disposition: 'converted',
        availableModes: ['preserve'],
        defaultMode: 'preserve',
        editableTextCount: 0,
        editableImageCount: 1,
        rasterObjectKey: key,
        thumbObjectKey: key,
        warnings: [],
      },
    ];
    return {
      built: { pages: [], sourcePageCount: 1, warnings: [] as ImportWarning[] },
      manifestPages,
    };
  }
}

/** Bumped when conversion output changes in a way a stale job cannot be trusted across. */
export const CONVERTER_VERSION = '2026-09-15.1';

/** A file we will not accept, with a message that names the fix. */
export class PrepareRejection extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PrepareRejection';
  }
}

/**
 * The rasterizer speaks in sentences; the manifest speaks in codes.
 *
 * That boundary is deliberate rather than an oversight to tidy away. The
 * rasterizer's result crosses an IPC boundary into a process that is kept free
 * of the API's module graph on purpose (SEC-006), so it must not import the
 * parser's types. Here — on the API side, where both are already in scope — is
 * the right place to give its output the one vocabulary the review UI branches
 * on, keeping its own sentence as the detail an operator reads.
 */
function rasterWarnings(result: Awaited<ReturnType<PdfRasterService['rasterizePdf']>>): ImportWarning[] {
  if (!result.ok) {
    return [
      {
        code: 'PAGE_UNREADABLE',
        detail:
          'This PDF could not be rendered to images, so its pages can only be imported as editable layers.',
      },
    ];
  }
  const out: ImportWarning[] = [];
  if (result.truncated) {
    out.push({
      code: 'PAGES_TRUNCATED',
      detail:
        `Only the first ${result.pages.length} of ${result.sourcePageCount} pages were rendered. ` +
        'Import those, then import the rest as a second file.',
    });
  }
  // Anything else the renderer said, kept as-is: losing a sentence we do not
  // have a code for would be a silent loss, which is the habit this program
  // exists to end.
  for (const w of result.warnings) {
    if (result.truncated && /page/i.test(w)) continue; // already said, better
    out.push({ code: 'PAGE_UNREADABLE', detail: w });
  }
  return out;
}

function countZones(page: BuiltPage): { text: number; image: number } {
  const zones = page.template?.zones ?? [];
  return {
    text: zones.filter((z) => z.widgetType === 'TEXT').length,
    image: zones.filter((z) => z.widgetType === 'IMAGE').length,
  };
}

export { collectWarnings };
