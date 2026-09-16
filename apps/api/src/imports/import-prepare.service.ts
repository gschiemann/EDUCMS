import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { PdfRasterService, type RasterizeResult } from './raster/pdf-raster.service';
import { DEFAULT_RASTERIZE_LIMITS } from '../proxy/pdf-raster-pipeline';
import { parsePptx } from './parsers/pptx-parser';
import { buildImport, type BuiltPage } from './parsers/import-builder';
import { collectWarnings, MAX_ACCOUNTED_PAGES, type ImportWarning } from './parsers/types';
import { sniffImportFormat, EXT_FOR_FORMAT, type ImportFormat } from './file-signature';
import { probeImageHeader } from '../storage/image-header';
import { demoteRasterGaps, describeRasterGaps } from './import-manifest-integrity';
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

    // 3. Record the job BEFORE converting, so the objects just written are
    //    already owned by a row.
    //
    //    The sweep can only delete what a job names. If the row were written
    //    last — after conversion, which is the part that can throw, time out or
    //    die with the process — then every failed conversion would leave the
    //    original, and any page rasters written before the failure, in the
    //    bucket with nothing referencing them. Unreachable and permanent.
    //    Writing the row first costs one insert and makes a crash mid-convert
    //    indistinguishable from any other expired job.
    const expiresAt = new Date(Date.now() + JOB_TTL_MS);
    await this.prisma.client.importJob.create({
      data: {
        id: jobId,
        tenantId,
        createdByUserId: userId,
        status: 'CONVERTING',
        sourceName: input.originalName.slice(0, 200),
        sourceMime: sniff.mime,
        sourceBytes: bytes.length,
        sourceSha256: createHash('sha256').update(bytes).digest('hex'),
        sourceObject,
        converterVersion: CONVERTER_VERSION,
        expiresAt,
      },
    });

    // 3. Convert. Storage writes happen here, before any transaction — a DB
    //    transaction held open across a network upload is how you get a pool
    //    stall that outlives the request.
    let built: { pages: BuiltPage[]; sourcePageCount: number; warnings: ImportWarning[] };
    let manifestPages: ManifestPage[];
    let preserveUnavailableReason: string | undefined;

    try {
      if (sniff.format === 'pdf') {
        ({ built, manifestPages } = await this.preparePdf(bytes, prefix));
      } else if (sniff.format === 'pptx') {
        ({ built, manifestPages, preserveUnavailableReason } = await this.preparePptx(bytes));
      } else {
        ({ built, manifestPages } = await this.prepareImage(bytes, sniff, prefix));
      }
    } catch (err: unknown) {
      // The row stays, carrying what was staged, so the sweep still owns it.
      // The operator gets the failure; the bucket does not get a permanent
      // orphan.
      //
      // A refusal we authored (a PDF that would not render, and why) goes back
      // exactly as written, with its own code and status. Anything else is
      // ours to log, and the operator gets the general sentence.
      const refusal = err instanceof PrepareRejection ? err : null;
      const detail = refusal?.reason ?? (err instanceof Error ? err.message : String(err));
      await this.prisma.client.importJob.updateMany({
        where: { id: jobId, tenantId },
        data: {
          status: 'FAILED',
          failureCode: refusal?.code ?? 'CONVERSION_FAILED',
          failureDetail: detail.slice(0, 500),
          // A failed job can never be committed, so what it staged has no
          // reason to wait out the rest of its day: the next sweep takes it.
          expiresAt: new Date(),
        },
      });
      this.logger.warn(`[import] conversion failed job=${jobId} tenant=${tenantId}: ${detail}`);
      throw (
        refusal ??
        new PrepareRejection(
          'IMPORTS_CONVERSION_FAILED',
          'We could not convert that file. It may be damaged, or protected with a password.',
        )
      );
    }

    // 4. A page offered as `preserve` IS its render, so the offer has to be
    //    backed by one. Nothing checked until 2026-09-16: prepare happened to
    //    always set `rasterObjectKey`, and "happens to be true" is not an
    //    invariant (re-audit R6). A page with a gap loses its mode here —
    //    before the manifest is persisted, so the review screen shows a page
    //    that cannot be added and says why, rather than a preselected page
    //    that would produce nothing.
    const { pages: checkedPages, gaps } = demoteRasterGaps(manifestPages);
    if (gaps.length > 0) {
      // Loud, and countable. This should be unreachable; if it ever fires, the
      // converter changed and the log names the pages without naming the file.
      this.logger.error(
        `[import] RASTER GAP job=${jobId} tenant=${tenantId} format=${sniff.format} ${describeRasterGaps(gaps)}`,
      );
    }

    const manifest: ImportManifest = {
      version: 1,
      format: sniff.format === 'pdf' ? 'pdf' : sniff.format === 'pptx' ? 'pptx' : 'image',
      sourcePageCount: built.sourcePageCount,
      pages: checkedPages,
      warnings: built.warnings,
      preserveUnavailableReason,
    };

    await this.prisma.client.importJob.updateMany({
      where: { id: jobId, tenantId },
      data: {
        status: 'PREPARED',
        sourcePageCount: built.sourcePageCount,
        manifest: JSON.stringify(manifest),
        warnings: JSON.stringify(built.warnings),
      },
    });

    this.logger.log(
      `[import] prepared job=${jobId} tenant=${tenantId} format=${sniff.format} ` +
        `sourcePages=${built.sourcePageCount} accounted=${checkedPages.length} ` +
        `warnings=${built.warnings.length}`,
    );
    return { jobId, manifest };
  }

  /**
   * PDF: the page as it looks, and nothing else.
   *
   * Every page is rendered, and the render IS the import — `preserve` is the
   * only mode a PDF offers. Text extraction used to sit beside it as "Editable
   * layers", and it could not keep that promise: a PDF yields runs of text with
   * no pictures, no shapes, no colour, weight or face, and every source line
   * became its own box that clipped when drawn (re-audit R1, 2026-09-15). So the
   * text parser does not run here at all. Nothing would read its output, and it
   * was one more pass of a stranger's PDF through the process that also
   * publishes emergency alerts.
   *
   * The page accounting comes from the render instead: one row per source page
   * up to MAX_ACCOUNTED_PAGES, rendered pages offered as `preserve`, and pages
   * past the render cap listed as `excluded-by-limit` rather than dropped.
   */
  private async preparePdf(bytes: Buffer, prefix: string) {
    const rastered = await this.raster.rasterizePdf(bytes);
    if (!rastered.ok) {
      // There is no other way to bring a PDF in any more, and quietly offering
      // one when rendering fails is the substitution the re-audit found (R3).
      throw rasterRefusal(rastered.reason);
    }

    const rendered = new Map(rastered.pages.map((page) => [page.sourcePage, page]));
    const accounted = Math.min(rastered.sourcePageCount, MAX_ACCOUNTED_PAGES);
    const manifestPages: ManifestPage[] = [];
    for (let n = 1; n <= accounted; n += 1) {
      const page = rendered.get(n);
      if (!page) {
        manifestPages.push({
          sourcePage: n,
          label: `Page ${n}`,
          disposition: 'excluded-by-limit',
          availableModes: [],
          defaultMode: null,
          editableTextCount: 0,
          editableImageCount: 0,
          warnings: [],
        });
        continue;
      }
      const key = `${prefix}/p${n}.webp`;
      const thumbKey = `${prefix}/p${n}.thumb.webp`;
      await this.storage.uploadImportStaging(key, page.webp, 'image/webp');
      await this.storage.uploadImportStaging(thumbKey, page.thumbWebp, 'image/webp');
      manifestPages.push({
        sourcePage: n,
        label: `Page ${n}`,
        disposition: 'converted',
        availableModes: ['preserve'],
        defaultMode: 'preserve',
        editableTextCount: 0,
        editableImageCount: 0,
        rasterObjectKey: key,
        thumbObjectKey: thumbKey,
        // A PDF page really is WebP — the rasterizer encodes it. Stated rather
        // than assumed, because an uploaded image is NOT (re-audit R7).
        rasterMimeType: 'image/webp',
        widthPx: page.widthPx,
        heightPx: page.heightPx,
        warnings: [],
      });
    }

    return {
      built: {
        pages: [] as BuiltPage[],
        sourcePageCount: rastered.sourcePageCount,
        warnings: rasterWarnings(rastered),
      },
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

  /**
   * An image is one page, and the picture IS the highest-fidelity result.
   *
   * IT IS ALSO ITSELF (re-audit R7, 2026-09-16). This used to stage the bytes
   * and record nothing else, so commit published every one of them as
   * `image/webp` under a `.webp` name and gave the template a 1920×1080 canvas.
   * A 1×1 PNG therefore reached the public assets bucket as PNG bytes labelled
   * WebP, in a landscape HD template. Browsers sniff content and drew it
   * anyway, which is exactly why nobody noticed — the metadata was wrong
   * everywhere it was read: the asset row, the file name, the canvas, the
   * orientation.
   *
   * So the header is read once, from the BYTES, before anything is staged:
   *
   *   • the true format, recorded on the page so commit publishes a PNG as a
   *     PNG. Nothing is transcoded — the file the operator uploaded is the
   *     highest fidelity there is, and re-encoding it could only lose;
   *   • the true pixel size, with EXIF orientation applied, so a portrait phone
   *     photo gets a portrait canvas instead of a landscape one;
   *   • a pixel ceiling, because the 50 MB upload cap bounds COMPRESSED bytes
   *     and says nothing about what they expand to. A few megabytes of PNG can
   *     be a gigapixel, and commit publishes these bytes straight to a screen.
   *
   * Nothing is decoded to learn any of it. The size sits uncompressed in the
   * first few dozen bytes, and decoding a stranger's image in the process that
   * also publishes lockdown alerts is the mistake SEC-006 already fixed once.
   */
  private async prepareImage(bytes: Buffer, sniff: { mime: string; ext: string }, prefix: string) {
    const header = probeImageHeader(bytes);
    if (!header) {
      // The signature said PNG/JPEG/WebP and the header does not parse, so the
      // file is damaged or truncated. Refusing beats staging something whose
      // shape we would then have to invent.
      throw new PrepareRejection(
        'IMPORTS_IMAGE_UNREADABLE',
        "We couldn't read that image — it may be damaged or incomplete. Open it, export it again, then import that.",
        422,
        'image-header-unreadable',
      );
    }
    const pixels = header.widthPx * header.heightPx;
    if (pixels > MAX_IMAGE_PIXELS) {
      throw new PrepareRejection(
        'IMPORTS_IMAGE_TOO_LARGE',
        `That image is ${header.widthPx}×${header.heightPx}, which is larger than we can put on a screen. ` +
          `Export it at ${MAX_IMAGE_LONG_EDGE_HINT}px or smaller and import that.`,
        413,
        `image-pixels:${pixels}`,
      );
    }

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
        // The full-size object doubles as the thumbnail. One upload, one
        // object, and the review screen scales it down — an image import has
        // no separate render to make a thumbnail from.
        thumbObjectKey: key,
        rasterMimeType: sniff.mime,
        widthPx: header.widthPx,
        heightPx: header.heightPx,
        warnings: [],
      },
    ];
    return {
      built: { pages: [], sourcePageCount: 1, warnings: [] as ImportWarning[] },
      manifestPages,
    };
  }
}

/**
 * The most pixels an imported image may carry.
 *
 * 50 MP is about six times a 4K panel and comfortably above any poster or
 * photograph an operator would put on a screen, while staying well inside what
 * a browser can decode: at 4 bytes per pixel this is a 200 MB decode, and the
 * player is an Android box with a fixed budget. Past it the screen is the thing
 * that fails, silently, hours later — so the import says no now instead.
 *
 * This is a bound on DECODED pixels, which is the bound the 50 MB upload cap
 * does not give: compression ratio is attacker-chosen (re-audit R7).
 */
const MAX_IMAGE_PIXELS = 50_000_000;
/** Roughly the long edge of a 16:9 image at the cap — for the refusal sentence. */
const MAX_IMAGE_LONG_EDGE_HINT = 9400;

/**
 * Bumped when conversion output changes in a way a stale job cannot be trusted
 * across.
 *
 * `.2`: a PDF is offered as `preserve` only. A job prepared by `.1` may carry
 * "Editable layers" on its PDF pages, and commit refuses it as stale rather
 * than honouring an offer this build no longer makes.
 */
export const CONVERTER_VERSION = '2026-09-15.2';

/**
 * A file we will not accept, with a message that names the fix.
 *
 * `status` is what the route answers with. A refusal caused by the file stays
 * in the 4xx range; a refusal that is OURS and temporary — the renderer is busy
 * or unavailable — is 503, the one status the review page treats as "send the
 * same file again" (re-audit R3).
 */
export class PrepareRejection extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 400,
    /** What the converter itself said. Kept on the job row and in the log; never sent. */
    readonly reason?: string,
  ) {
    super(message);
    this.name = 'PrepareRejection';
  }
}

/**
 * Why a PDF could not be rendered, in the words and the status the review page
 * acts on.
 *
 * The renderer speaks in stable reason strings. An operator needs to know which
 * of three things to do: try again, fix the file, or tell us. Busy and
 * unavailable are ours and temporary, so they answer 503 and the page offers
 * the same file again. Everything else is about the file, and the sentence says
 * what to do with it. Nothing here falls back to a different kind of import: a
 * render that fails is an import that stops.
 */
function rasterRefusal(reason: string): PrepareRejection {
  const refuse = (code: string, message: string, status: number) =>
    new PrepareRejection(code, message, status, reason);
  const limitMb = Math.round(DEFAULT_RASTERIZE_LIMITS.maxPdfBytes / (1024 * 1024));
  switch (reason) {
    case 'raster-busy':
    case 'worker-busy':
      return refuse(
        'IMPORTS_RENDER_BUSY',
        "We're busy converting another file right now. Try again in a moment.",
        503,
      );
    case 'pdf-too-large':
      return refuse(
        'IMPORTS_PDF_TOO_LARGE',
        `That PDF is too large to convert — the limit is ${limitMb} MB. ` +
          'Export it again with smaller images, or split it into two files.',
        413,
      );
    case 'pdf-password-protected':
      return refuse(
        'IMPORTS_PDF_PASSWORD_PROTECTED',
        'That PDF is protected with a password. Save a copy without the password, then import that.',
        422,
      );
    case 'pdf-empty':
      return refuse('IMPORTS_PDF_EMPTY', 'That PDF has no pages to import.', 422);
    case 'pdf-unreadable':
      return refuse(
        'IMPORTS_PDF_UNREADABLE',
        "We couldn't read that PDF — it may be damaged. Open it, save or export it as a new PDF, then import that.",
        422,
      );
    case 'page-render-failed':
    case 'encode-failed':
      return refuse(
        'IMPORTS_PDF_DAMAGED',
        'A page in that PDF could not be drawn, so part of the file may be damaged. ' +
          'Save or export it as a new PDF, then import that.',
        422,
      );
    case 'raster-budget-exceeded':
      return refuse(
        'IMPORTS_PDF_TOO_COMPLEX',
        'That PDF took too long to convert. Export it with smaller images, or split it into shorter files.',
        422,
      );
    default:
      // Our side: a scratch directory, the worker, the browser. Retrying the
      // same file is the operator's only move, so it is the one we offer.
      return refuse(
        'IMPORTS_RENDER_UNAVAILABLE',
        "We couldn't convert that PDF just now. Try again in a moment — if it keeps happening, let us know.",
        503,
      );
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
function rasterWarnings(result: Extract<RasterizeResult, { ok: true }>): ImportWarning[] {
  const out: ImportWarning[] = [];
  // `truncated` is the renderer's own flag; the count comparison is the
  // belt-and-braces reading of the same fact, so a short result can never be
  // presented as a whole one even if the flag and the pages ever disagree.
  const short = result.truncated || result.pages.length < result.sourcePageCount;
  if (short) {
    out.push({
      code: 'PAGES_TRUNCATED',
      detail:
        `Only the first ${result.pages.length} of ${result.sourcePageCount} pages were rendered. ` +
        'Import those, then import the rest as a second file.',
    });
  }
  if (result.sourcePageCount > MAX_ACCOUNTED_PAGES) {
    out.push({
      code: 'PAGES_TRUNCATED',
      detail: `Only the first ${MAX_ACCOUNTED_PAGES} pages are listed individually.`,
    });
  }
  // Anything else the renderer said, kept as-is: losing a sentence we do not
  // have a code for would be a silent loss, which is the habit this program
  // exists to end.
  for (const w of result.warnings) {
    if (short && /page/i.test(w)) continue; // already said, better
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
