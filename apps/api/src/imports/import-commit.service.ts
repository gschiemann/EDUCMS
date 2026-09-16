import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@cms/database';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { parsePptx } from './parsers/pptx-parser';
import { buildImport, type BuiltTemplate } from './parsers/import-builder';
import type { ParsedDocument } from './parsers/types';
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
    if (!job) {
      throw new CommitRejection('IMPORT_JOB_NOT_FOUND', 'That import has expired or does not exist.', 404);
    }
    // Already done: hand back what the first call made rather than making it
    // again. This is the cheap half of exactly-once and it always mattered.
    if (job.status === 'COMMITTED') return priorResult(job.result);
    // COMMITTING is a claim, not a failure — a crashed commit leaves one behind
    // and the operator has to be able to retry. `claim()` below decides whether
    // this one is stale enough to take over.
    if (job.status !== 'PREPARED' && job.status !== 'COMMITTING') {
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

    // ── CLAIM THE JOB, BEFORE ANY WORK (re-audit R5) ───────────────────
    //
    // Everything above is a read and a pure check, so two simultaneous calls
    // both used to reach the work below, both convert, both insert, and the
    // operator gets two copies of every page. The old COMMITTED check could not
    // stop that: it ran outside the transaction and the status was written
    // AFTER the rows, so the whole window between them was duplicable — by a
    // double-click, by an HTTP retry after a timeout, by two tabs.
    //
    // One UPDATE decides it. `PREPARED -> COMMITTING` matches at most one
    // caller, because the loser's identical UPDATE blocks on the row lock and
    // then re-evaluates its predicate against the committed row. The claim is
    // taken HERE rather than inside the transaction so the loser stops before
    // it uploads anything: a loser that got as far as publishing page images
    // would leave them orphaned in the public bucket even though its rows
    // rolled back.
    if (!(await this.claim(jobId, tenantId))) return await this.settledResult(jobId, tenantId);

    try {
      return await this.performCommit({
        job, manifest, wanted, tenantId, userId, jobId, userRole: input.userRole,
      });
    } catch (err: unknown) {
      // Someone else finished this job while we worked: our transaction rolled
      // back and theirs is the answer.
      if (err instanceof ClaimLost) return await this.settledResult(jobId, tenantId);
      // Anything else failed with the claim still ours. Hand it back, so the
      // operator's retry is a retry rather than a ten-minute wait for the claim
      // to go stale.
      await this.releaseClaim(jobId, tenantId);
      throw err;
    }
  }

  /**
   * The work, once this call owns the job.
   *
   * Split out from `commit` so the claim can wrap it: every exit from here
   * either finalizes the job inside the transaction or gives the claim back.
   */
  private async performCommit(ctx: {
    job: { id: string; sourceName: string; sourceObject: string; sourceSha256: string };
    manifest: ImportManifest;
    wanted: PageSelection[];
    tenantId: string;
    userId: string;
    userRole: string;
    jobId: string;
  }): Promise<CommitResult> {
    const { job, manifest, wanted, tenantId, userId, jobId } = ctx;

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

    const assetStatus = ctx.userRole === 'CONTRIBUTOR' ? 'PENDING_APPROVAL' : 'APPROVED';
    const { plans, mediaRows } = await this.buildPlans({
      job, manifest, wanted, source, tenantId, userId, assetStatus,
    });
    // One plan per selected page, stated where the transaction starts.
    // `buildPlans` already refuses a gap; this is what stops a future edit to it
    // from quietly skipping a page again (re-audit R4).
    const planned = new Set(plans.map((p) => p.sourcePage));
    const unplanned = wanted.filter((w) => !planned.has(w.sourcePage)).map((w) => w.sourcePage);
    if (plans.length !== wanted.length || unplanned.length > 0) {
      throw pagesUnavailable(unplanned.length > 0 ? unplanned : wanted.map((w) => w.sourcePage));
    }

    // ── One short transaction: the rows, the record that they happened,
    //    and the job's own COMMITTED state with the ids it created ──────
    //
    // The finalize is INSIDE, and that is the durable half of exactly-once
    // (re-audit R5). It used to be an `updateMany` after the transaction
    // returned, so a process that died in between left the rows committed and
    // the job still PREPARED — and the next retry made every template a second
    // time. Now the rows, the audit, COMMITTED and the result either all exist
    // or none of them do, which is also what makes a retry able to hand back
    // the same template ids instead of an empty success.
    const result = await this.prisma.client.$transaction(async (tx) => {
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
            converterVersion: CONVERTER_VERSION,
            warningCodes: [...new Set(manifest.warnings.map((w) => w.code))],
          }),
        },
      });

      const committed: CommitResult = {
        templates: out,
        skippedPages: manifest.pages
          .filter((p) => p.defaultMode !== null && !wanted.some((w) => w.sourcePage === p.sourcePage))
          .map((p) => p.sourcePage),
      };
      // Still ours? The claim is re-asserted here so a stale-claim takeover
      // that raced us cannot end with two winners: whichever transaction
      // commits second finds the status already COMMITTED, matches no row, and
      // takes its own inserts down with it.
      const finalized = await tx.importJob.updateMany({
        where: { id: jobId, tenantId, status: 'COMMITTING' },
        data: {
          status: 'COMMITTED',
          committedAt: new Date(),
          result: JSON.stringify(committed),
        },
      });
      if (finalized.count !== 1) throw new ClaimLost();
      return committed;
    });

    this.logger.log(
      `[import] committed job=${jobId} tenant=${tenantId} templates=${result.templates.length} skipped=${result.skippedPages.length}`,
    );
    return result;
  }

  /**
   * Take ownership of this job, or answer false.
   *
   * Also the expiry check the audit asked for: an expired-but-still-PREPARED
   * job used to commit happily until the sweep got round to it, which meant
   * committing against staged objects the sweep may already have deleted.
   *
   * The second arm is crash recovery. A process that dies mid-commit leaves
   * COMMITTING behind, and without this the operator could never retry — so a
   * claim older than `CLAIM_STALE_MS` can be taken over. That is safe even if
   * the original is somehow still alive: both end in the transaction above,
   * whose `status: 'COMMITTING'` predicate lets exactly one of them commit.
   */
  private async claim(jobId: string, tenantId: string): Promise<boolean> {
    const now = new Date();
    const { count } = await this.prisma.client.importJob.updateMany({
      where: {
        id: jobId,
        tenantId,
        expiresAt: { gt: now },
        OR: [
          { status: 'PREPARED' },
          { status: 'COMMITTING', updatedAt: { lt: new Date(now.getTime() - CLAIM_STALE_MS) } },
        ],
      },
      data: { status: 'COMMITTING' },
    });
    return count === 1;
  }

  /** Give the claim back after a failure, so the next attempt is not a wait. */
  private async releaseClaim(jobId: string, tenantId: string): Promise<void> {
    try {
      await this.prisma.client.importJob.updateMany({
        where: { id: jobId, tenantId, status: 'COMMITTING' },
        data: { status: 'PREPARED' },
      });
    } catch (e: any) {
      // Never mask the failure that brought us here. The claim goes stale on
      // its own, so the cost of this is a delay, not a stuck job.
      this.logger.warn(`[import] could not release claim job=${jobId}: ${e?.message ?? e}`);
    }
  }

  /**
   * What to tell a caller that did not get the claim.
   *
   * Three different things, and they are not interchangeable: the work is
   * FINISHED (hand back the same templates — this is what makes a retry safe),
   * the work is IN FLIGHT (409, so a double-click does not read as an error the
   * operator should act on), or the job is gone/expired.
   */
  private async settledResult(jobId: string, tenantId: string): Promise<CommitResult> {
    const job = await this.prisma.client.importJob.findFirst({
      where: { id: jobId, tenantId },
      select: { status: true, result: true, expiresAt: true },
    });
    if (!job) {
      throw new CommitRejection('IMPORT_JOB_NOT_FOUND', 'That import has expired or does not exist.', 404);
    }
    if (job.status === 'COMMITTED') return priorResult(job.result);
    if (job.status === 'COMMITTING') {
      throw new CommitRejection(
        'IMPORT_COMMIT_IN_PROGRESS',
        'This import is already being added. Give it a moment, then reopen it to see what landed.',
        409,
      );
    }
    if (job.status === 'EXPIRED' || job.expiresAt.getTime() <= Date.now()) {
      throw new CommitRejection('IMPORT_JOB_EXPIRED', 'That import has expired. Import the file again.', 410);
    }
    throw new CommitRejection('IMPORT_JOB_NOT_READY', 'That import is no longer ready to add.');
  }

  /**
   * A selection has to name a page this job actually has, in a mode that page
   * actually offers. Anything else is a client bug or a tampered request, and
   * both deserve a refusal rather than a best guess.
   *
   * Editable layers exist only for a PowerPoint. The manifest already says so
   * for anything this build prepared; the format check is here as well so that
   * no manifest — stale, hand-edited or otherwise — can walk a PDF back into the
   * text reconstruction the re-audit withdrew (R1).
   */
  private validateSelections(manifest: ImportManifest, selections: PageSelection[]): PageSelection[] {
    const byPage = new Map(manifest.pages.map((p) => [p.sourcePage, p]));
    const seen = new Set<number>();
    const out: PageSelection[] = [];
    for (const sel of selections ?? []) {
      const page = byPage.get(sel.sourcePage);
      if (!page || seen.has(sel.sourcePage)) continue;
      const offered =
        page.availableModes.includes(sel.mode) &&
        (sel.mode !== 'editable' || manifest.format === 'pptx');
      if (!offered) {
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
   *
   * Every selected page, or none (re-audit R4). This loop used to `continue`
   * past a page whose render or rebuilt slide was missing and report success
   * for the rest, so an "Add 2" could create one. Now everything each selected
   * page needs is gathered FIRST — every render read back, every slide rebuilt
   * — and a single gap refuses the whole commit, naming the pages, before any
   * object is published.
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
    const editable = wanted.filter((w) => w.mode === 'editable');

    // ── 1. Gather. Nothing is published until every selected page is here ──
    const renders = new Map<number, Buffer>();
    const missing: number[] = [];
    for (const sel of wanted) {
      if (sel.mode !== 'preserve') continue;
      const key = manifest.pages.find((p) => p.sourcePage === sel.sourcePage)?.rasterObjectKey;
      const bytes = key
        ? await this.storage.downloadFromBucket(this.storage.importStagingBucketName(), key)
        : null;
      if (bytes && bytes.length > 0) renders.set(sel.sourcePage, bytes);
      else missing.push(sel.sourcePage);
    }
    // Parsed once, and only if a slide was chosen as editable — which
    // `validateSelections` allows for a PowerPoint and nothing else.
    const deck = editable.length > 0 ? await parsePptx(ctx.source) : null;
    if (deck) {
      // A rehearsal with placeholder links answers "does each selected slide
      // still become a template?" before a single picture goes to storage.
      const rehearsal = buildImport(deck, { resolveMedia: (id) => `pending:${id}` });
      const buildable = new Set(rehearsal.pages.filter((p) => p.template).map((p) => p.sourcePage));
      for (const sel of editable) if (!buildable.has(sel.sourcePage)) missing.push(sel.sourcePage);
    }
    if (missing.length > 0) throw pagesUnavailable(missing);

    // ── 2. Publish ─────────────────────────────────────────────────────
    const editableByPage = deck
      ? await this.publishDeck(deck, tenantId, userId, assetStatus, mediaRows)
      : new Map<number, BuiltTemplate>();
    // A slide that rehearsed fine and still came back empty lost every picture
    // it had to a failed upload, with nothing else on it. That is a missing
    // page too, and it is refused before any page render is published.
    const lost = editable.filter((sel) => !editableByPage.has(sel.sourcePage)).map((sel) => sel.sourcePage);
    if (lost.length > 0) throw pagesUnavailable(lost);

    const plans: CommitPlan[] = [];
    for (const sel of wanted) {
      const page = manifest.pages.find((p) => p.sourcePage === sel.sourcePage)!;
      const name = multi ? `${baseName} — ${page.label}` : baseName;

      if (sel.mode === 'preserve') {
        const bytes = renders.get(sel.sourcePage);
        if (!bytes) throw pagesUnavailable([sel.sourcePage]); // gathered above; kept honest
        // Published to the PUBLIC assets bucket on purpose: a screen must never
        // depend on a signed URL that expires.
        //
        // As what it ACTUALLY is (re-audit R7). This published every page as
        // `image/webp` under a `.webp` name, which is true of a rendered PDF
        // page and false of an uploaded PNG or JPEG — those are staged as
        // themselves. The type is resolved through an allowlist rather than
        // taken from the manifest string, because a manifest is persisted JSON
        // and only as trustworthy as the row it came out of.
        const media = rasterMedia(page.rasterMimeType);
        const publicPath = `${tenantId}/${randomUUID()}${media.ext}`;
        const fileUrl = await this.storage.upload(publicPath, bytes, media.mime);
        plans.push({
          sourcePage: sel.sourcePage,
          mode: sel.mode,
          assetData: {
            tenantId,
            uploadedByUserId: userId,
            fileUrl,
            mimeType: media.mime,
            fileSize: bytes.length,
            fileHash: createHash('sha256').update(bytes).digest('hex'),
            originalName: `${name}${media.ext}`,
            status: assetStatus,
          },
          templateData: this.templateRow({
            tenantId, userId, name,
            // Prepare guarantees these for any page it offers as `preserve`
            // (`demoteRasterGaps`), and an uploaded image now records the size
            // a screen actually DRAWS it at — EXIF orientation included, so a
            // portrait photo stops arriving on a landscape canvas (R6/R7). The
            // fallback is for a job prepared before either fix.
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
      if (!built) throw pagesUnavailable([sel.sourcePage]); // checked above; kept honest
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
   * Publish a re-parsed PowerPoint's pictures and build its slides against them.
   *
   * PowerPoint only. A PDF has no editable route any more (R1), so there is no
   * PDF branch here to reach by accident.
   *
   * The BYTES go to storage here, because a network round trip must never
   * happen inside a transaction. The Asset ROWS come back for the caller to
   * insert alongside the templates: created here they would survive a failed
   * commit, leaving approved pictures in the library belonging to a template
   * that was never made.
   */
  private async publishDeck(
    deck: ParsedDocument,
    tenantId: string,
    userId: string,
    assetStatus: string,
    mediaRows: Prisma.AssetUncheckedCreateInput[],
  ): Promise<Map<number, BuiltTemplate>> {
    const parsed = deck;

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

/**
 * A commit we will not perform, with a message that names what to do.
 *
 * `status` is what the route answers with, the same way `PrepareRejection`
 * already worked. Most refusals are the request's fault and stay 400, but
 * "someone is already adding this import" is a 409 the screen can recognise and
 * leave alone, and an expired job is a 410 — neither is a malformed request
 * (re-audit R5).
 */
export class CommitRejection extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = 'CommitRejection';
  }
}

/**
 * Thrown when the finalize inside the transaction matches no row: another
 * caller owns this job now, so our inserts must not stand. Internal — it never
 * reaches a route, because `commit` turns it into that caller's result.
 */
class ClaimLost extends Error {
  constructor() {
    super('import commit claim lost');
    this.name = 'ClaimLost';
  }
}

/**
 * How long a claim may sit before another attempt may take it over.
 *
 * Well above a normal commit — the rasterize budget is 45 s and a commit only
 * reads objects back and inserts — and short enough that an operator whose
 * request died with the process is not locked out for the rest of the day.
 */
const CLAIM_STALE_MS = 10 * 60_000;

/**
 * The result a finished job recorded, read back for a retry.
 *
 * Defensive about its own column: a row written by an older build, or a result
 * truncated by anything, must not throw a 500 at an operator whose import
 * actually succeeded.
 */
function priorResult(raw: string | null): CommitResult {
  if (!raw) return { templates: [], skippedPages: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<CommitResult>;
    return {
      templates: Array.isArray(parsed.templates) ? parsed.templates : [],
      skippedPages: Array.isArray(parsed.skippedPages) ? parsed.skippedPages : [],
    };
  } catch {
    return { templates: [], skippedPages: [] };
  }
}

/**
 * The media type a staged page render is published under.
 *
 * An allowlist, deliberately: the input is a string off a persisted manifest,
 * and the output becomes a file extension in an object path. Anything
 * unrecognised falls back to WebP, which is what every job prepared before
 * `rasterMimeType` existed actually staged.
 */
const RASTER_MEDIA: Record<string, string> = {
  'image/webp': '.webp',
  'image/png': '.png',
  'image/jpeg': '.jpg',
};

function rasterMedia(mimeType: string | undefined): { mime: string; ext: string } {
  const mime = mimeType && RASTER_MEDIA[mimeType] ? mimeType : 'image/webp';
  return { mime, ext: RASTER_MEDIA[mime] };
}

/**
 * The refusal for a commit that cannot bring every selected page: which pages,
 * and that nothing was added — so an operator never has to wonder whether a
 * partial set landed.
 */
function pagesUnavailable(pages: number[]): CommitRejection {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const named =
    sorted.length === 1
      ? `Page ${sorted[0]} is`
      : `Pages ${sorted.slice(0, -1).join(', ')} and ${sorted[sorted.length - 1]} are`;
  return new CommitRejection(
    'IMPORT_PAGES_UNAVAILABLE',
    `${named} no longer available to add, so nothing was added. Import the file again.`,
  );
}

function extFor(mime: string): string {
  if (mime === 'image/png') return '.png';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '';
}
