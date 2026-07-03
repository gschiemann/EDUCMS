/**
 * BugsController — REST surface for the one-click Bug Reporter.
 *
 * The wire contract for every shape on this controller lives in
 * @cms/api-types/bugs.ts. Read that file first.
 *
 *   POST  /api/v1/bugs                  (create + kick off AI)
 *   GET   /api/v1/bugs                  (admin list, filters)
 *   GET   /api/v1/bugs/:id              (admin detail)
 *   POST  /api/v1/bugs/:id/approve      (admin: open PR, mark APPROVED)
 *   POST  /api/v1/bugs/:id/reject       (admin: REJECTED or DUPLICATE)
 *   POST  /api/v1/bugs/:id/iterate      (admin: re-run AI with notes)
 *
 * RBAC for v1: SUPER_ADMIN + DISTRICT_ADMIN + SCHOOL_ADMIN. The
 * floating "Report bug" button on the frontend is shown to everyone
 * authenticated, but for the v1 lockdown we gate POST + GET + actions
 * to admins only. (Once we trust the operator UX we'll widen POST to
 * CONTRIBUTOR.) Tenant isolation: SUPER_ADMIN sees all bugs;
 * DISTRICT/SCHOOL_ADMIN see only their own tenant's bugs.
 *
 * GitHub PR creation: handled in-line via the `gh` CLI when
 * GITHUB_REPO + GH_TOKEN are present. When unset, the bug rows still
 * move to APPROVED but the diff is stored locally — the FE renders
 * a "copy diff" UX so the operator can apply it manually. Both
 * paths share the same APPROVED status; the prUrl field distinguishes.
 */

import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { spawn } from 'child_process';
import { z } from 'zod';

import type {
  ApproveBugRequest,
  ApproveBugResponse,
  BugAiAnalysis,
  BugCapturedContext,
  BugDetail,
  BugListItem,
  BugServerContext,
  BugStatus,
  CreateBugResponse,
  IterateBugRequest,
  RejectBugRequest,
} from '@cms/api-types';
import {
  BUG_CAPTURED_CONTEXT_MAX_BYTES,
  BUG_SCREENSHOT_MAX_BYTES,
  BUG_SUBMIT_RATE_LIMIT_PER_USER_PER_HOUR,
} from '@cms/api-types';
import { AppRole } from '@cms/database';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
import { RequireRoles } from '../auth/roles.decorator';
import { ZodValidationPipe } from '../security/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { BugAnalyzerService } from './bug-analyzer.service';
import { BugEnrichmentService } from './bug-enrichment.service';
import { notifyBugFixProposed } from './bug-notify';
// 2026-05-27 — operator-facing email notifications on file / fix-
// proposed / fix-shipped. Best-effort: every email call is wrapped
// in a try/catch so an email outage NEVER blocks the bug pipeline.
import { EmailService } from '../email/email.service';

// ─── Bucket setup ────────────────────────────────────────────────

const SCREENSHOT_BUCKET = 'bug-screenshots';

// ─── Body schemas (zod — same boundary discipline as ai.controller) ───

/**
 * Most of the validation work happens INSIDE the service for the
 * capturedContext payload (it's deeply nested and we just need it
 * under the byte cap + JSON-parseable). We use a permissive object
 * here and re-check sizes in the handler.
 */
const CreateBugSchema = z
  .object({
    captured: z.record(z.string(), z.unknown()),
    screenshotBase64: z.string().max(BUG_SCREENSHOT_MAX_BYTES * 2).optional(),
  })
  .passthrough();

const ApproveBugSchema = z
  .object({
    notes: z.string().max(20_000).optional(),
  })
  .passthrough();

const RejectBugSchema = z
  .object({
    reason: z.string().min(1).max(5_000),
    duplicateOfBugId: z.string().min(1).max(128).optional(),
  })
  .passthrough();

const IterateBugSchema = z
  .object({
    notes: z.string().min(1).max(5_000),
  })
  .passthrough();

const ListBugsQuerySchema = z
  .object({
    status: z.string().max(64).optional(),
    tenantId: z.string().max(128).optional(),
  })
  .passthrough();

// ─── In-memory rate limiter ──────────────────────────────────────

/**
 * userId → sliding 1h window of submit timestamps. Pruned in-place
 * so the Map can't grow unbounded. Same pattern AiService uses.
 *
 * In a multi-replica deploy this is per-pod (not global); BUG_SUBMIT_
 * RATE_LIMIT_PER_USER_PER_HOUR is intentionally generous (20/hr) so
 * the per-pod-ness doesn't matter in practice — and the threat model
 * here is "stop one user from spam-submitting", not a distributed
 * attacker (the endpoint is authed already).
 */
const recentBugSubmitsByUser = new Map<string, number[]>();

function checkAndRecordSubmit(userId: string): void {
  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000;
  const recent = (recentBugSubmitsByUser.get(userId) || []).filter(
    (t) => t > windowStart,
  );
  if (recent.length >= BUG_SUBMIT_RATE_LIMIT_PER_USER_PER_HOUR) {
    throw new HttpException(
      {
        message: `Submitted too many bugs in the last hour (limit ${BUG_SUBMIT_RATE_LIMIT_PER_USER_PER_HOUR}). Wait a bit before filing more.`,
        code: 'BUG_SUBMIT_RATE_LIMIT',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
  recent.push(now);
  if (recent.length === 0) recentBugSubmitsByUser.delete(userId);
  else recentBugSubmitsByUser.set(userId, recent);
}

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Compute byte length of a JSON serialization of the captured payload.
 * We measure against the JSON form because that's what hits Postgres
 * (jsonb column) — the in-memory object can be bigger (closures,
 * prototype chain) but that's not what we're size-bounding.
 */
function jsonByteSize(v: unknown): number {
  return Buffer.byteLength(JSON.stringify(v ?? null), 'utf8');
}

/**
 * Defense-in-depth: scrub keys that look like secrets from any nested
 * object in the captured payload BEFORE it goes to Prisma. Operator's
 * react-query cache might have an auth token, an API key from a BYOK
 * integration screen, etc. Replace the value with '[redacted]' so the
 * AI never sees it and the row never carries it.
 *
 * Conservative key allow-list of NAMES we redact. We don't redact by
 * content shape (no regex on values) because that'd burn CPU on every
 * leaf for a small benefit; key-name match catches the realistic cases.
 *
 * Note: we deliberately match only on keys that are exact secret-y
 * names (or contain "secret" / "token" / "password"). Things like
 * "useAuth" / "authStore" stay un-redacted because they're identifiers,
 * not credentials. Matches are anchored — only the leaf key needs to
 * look like a secret, not the breadcrumb LABEL.
 */
const SECRET_KEY_RE =
  /^(password|passwd|pwd|token|api[_-]?key|apikey|secret|authorization|cookie|csrf|jwt|x[_-]?api[_-]?key|stripe[_-]?secret|stripe[_-]?key|sk[_-]?ant|sk[_-]?live|sk[_-]?test|access[_-]?token|refresh[_-]?token|client[_-]?secret|bearer|session[_-]?id|session[_-]?token)$/i;
function redactSecretLeaves(value: any, depth = 0): any {
  if (depth > 8) return value; // shouldn't recurse forever even on cycles
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactSecretLeaves(v, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof k === 'string' && SECRET_KEY_RE.test(k)) {
      out[k] = '[redacted]';
      continue;
    }
    out[k] = redactSecretLeaves(v, depth + 1);
  }
  return out;
}

/**
 * Strip script/HTML out of the operator's description so a SUPER_ADMIN
 * loading the review page can't be XSS'd by their own bug report.
 * The review page renders this as text in React (so it's already
 * escaped) but defense in depth + the description also flows into
 * the AI prompt where weird HTML would just noise the model.
 */
function sanitizeDescription(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = typeof raw === 'string' ? raw : String(raw);
  return s
    // Drop entire <script>...</script> blocks
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .trim()
    .slice(0, 5000) || null;
}

/**
 * Decode a base64 data URL OR a plain base64 string into a Buffer +
 * detected content type. Accepts:
 *   - "data:image/png;base64,iVBORw0..." → ['image/png', Buffer]
 *   - "iVBORw0..." → ['image/png', Buffer]  (we sniff PNG/JPG/WEBP)
 *
 * Throws BadRequest if the byte cap is exceeded.
 */
function decodeScreenshotBase64(b64: string): {
  buffer: Buffer;
  contentType: string;
} {
  let payload = b64;
  let contentType = 'image/png';
  const dataUrlMatch = b64.match(/^data:([^;,]+);base64,(.+)$/);
  if (dataUrlMatch) {
    contentType = dataUrlMatch[1] || 'image/png';
    payload = dataUrlMatch[2];
  }
  // Quick coarse-byte check before we burn the decode. Base64 → bytes
  // is 3/4 of the string length; pad-conservatively at 0.75×.
  if (payload.length * 0.75 > BUG_SCREENSHOT_MAX_BYTES * 1.05) {
    throw new HttpException(
      {
        message: 'Screenshot too large. Re-capture at lower DPI.',
        code: 'BUG_SCREENSHOT_TOO_LARGE',
      },
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }
  const buffer = Buffer.from(payload, 'base64');
  if (buffer.length > BUG_SCREENSHOT_MAX_BYTES) {
    throw new HttpException(
      {
        message: 'Screenshot too large. Re-capture at lower DPI.',
        code: 'BUG_SCREENSHOT_TOO_LARGE',
      },
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }
  // Sniff content type from the first bytes when we got no data URL hint.
  if (!dataUrlMatch) {
    if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50) {
      contentType = 'image/png';
    } else if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) {
      contentType = 'image/jpeg';
    } else if (
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP'
    ) {
      contentType = 'image/webp';
    }
  }
  // Tighten the allowed image set — never store anything other than
  // a real raster format. Operator never uploads SVG / PDF as a bug
  // screenshot in practice.
  const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);
  if (!ALLOWED.has(contentType)) {
    throw new HttpException(
      {
        message: 'Unsupported screenshot type. Use PNG, JPEG, or WebP.',
        code: 'BUG_SCREENSHOT_UNSUPPORTED',
      },
      HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    );
  }
  return { buffer, contentType };
}

// ─── Controller ──────────────────────────────────────────────────

const ADMIN_ROLES = [
  AppRole.SUPER_ADMIN,
  AppRole.DISTRICT_ADMIN,
  AppRole.SCHOOL_ADMIN,
] as const;

@UseGuards(JwtAuthGuard, RbacGuard)
@Controller('api/v1/bugs')
export class BugsController {
  private readonly logger = new Logger(BugsController.name);
  /**
   * Idempotent screenshot-bucket setup. First POST that has a
   * screenshot ensures the bucket exists; subsequent calls hit a
   * fast in-memory boolean.
   */
  private screenshotBucketReady: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly enrichment: BugEnrichmentService,
    private readonly analyzer: BugAnalyzerService,
    private readonly email: EmailService,
  ) {}

  // ─── POST /api/v1/bugs ──────────────────────────────────────

  @Post()
  @RequireRoles(...ADMIN_ROLES)
  async create(
    @Request() req: any,
    @Body(new ZodValidationPipe(CreateBugSchema)) body: any,
  ): Promise<CreateBugResponse> {
    // 1. Rate-limit per user.
    if (req.user?.id) checkAndRecordSubmit(req.user.id);

    // 2. Captured-context size cap. Operators can ship a screenshot
    //    OR a fat React Query cache snapshot — we cap at 512KB
    //    serialized.
    const capturedRaw = body?.captured ?? {};
    const capturedBytes = jsonByteSize(capturedRaw);
    if (capturedBytes > BUG_CAPTURED_CONTEXT_MAX_BYTES) {
      throw new HttpException(
        {
          message: `Bug payload too large (${capturedBytes} bytes > cap ${BUG_CAPTURED_CONTEXT_MAX_BYTES}). The frontend should trim breadcrumbs / network failures before retrying.`,
          code: 'BUG_CONTEXT_TOO_LARGE',
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    // 3. Scrub any secret-looking keys that slipped into capturedContext.
    const captured = redactSecretLeaves(capturedRaw) as BugCapturedContext;

    // 4. Sanitize operator description (XSS defense-in-depth + AI prompt cleanliness).
    const description = sanitizeDescription(captured?.description);

    // 5. Upload screenshot if present. Failures here DON'T fail the bug —
    //    operator gets the row without an image and the AI works on
    //    text only. Logging is enough.
    let screenshotUrl: string | null = null;
    if (body?.screenshotBase64) {
      try {
        const decoded = decodeScreenshotBase64(String(body.screenshotBase64));
        screenshotUrl = await this.uploadScreenshot(
          req.user.tenantId,
          decoded.buffer,
          decoded.contentType,
        );
      } catch (e: any) {
        if (e instanceof HttpException) throw e; // size / type errors → caller
        this.logger.warn(
          `screenshot upload failed for bug from user ${req.user?.id}: ${e?.message ?? e}`,
        );
      }
    }

    // 6. Build server-side enrichment BEFORE insert so the row carries
    //    the snapshot the AI will see. This is synchronous and bounded —
    //    every individual lookup has a timeout + try/catch.
    const serverContext: BugServerContext = await this.enrichment.build({
      reporterUserId: req.user?.id ?? null,
      tenantId: req.user?.tenantId ?? null,
    });

    // 7. Insert. status='NEW'; aiAnalysis null. tenantId comes from the
    //    authed user (SUPER_ADMIN still has a tenant id).
    const bug = await this.prisma.client.bug.create({
      data: {
        tenantId: req.user?.tenantId ?? null,
        userId: req.user?.id ?? null,
        status: 'NEW',
        description,
        screenshotUrl,
        capturedContext: captured as unknown as object,
        serverContext: serverContext as unknown as object,
      },
    });

    // 8. FIRE-AND-FORGET analysis. The handler returns immediately
    //    with status='NEW'; FE polls /bugs/:id to see status flip
    //    to ANALYZING → PROPOSED.
    this.analyzer.analyze(bug.id).catch((e) => {
      this.logger.error(
        `analyzer.analyze(${bug.id}) crashed: ${e?.message ?? e}`,
      );
    });

    // 9. FIRE-AND-FORGET email to the reporter. "we got it, here's
    //    the ID + link." Wrapped — an email outage never blocks the
    //    bug pipeline. Operator (2026-05-27): "you should send me an
    //    email with the bug number and then send an email once we
    //    fix it". Reuses the `captured` declared above (line ~345)
    //    after the secret-leaf redactor has run.
    if (req.user?.email) {
      this.email
        .sendBugFiled({
          to: req.user.email,
          bugId: bug.id,
          description: bug.description,
          pathname: captured?.pathname ?? null,
          tenantSlug: captured?.reporter?.tenantSlug ?? null,
        })
        .catch((e) =>
          this.logger.warn(
            `[bug-email] sendBugFiled(${bug.id}) failed: ${e?.message ?? e}`,
          ),
        );
    }

    // 10. FIRE-AND-FORGET owner-alert fan-out — every SUPER_ADMIN
    //     gets notified of every new bug, fleet-wide. Operator
    //     (2026-05-27): "how will you and I get notified though when
    //     new bugs come in? will it auto trigger you to fix it?".
    //     This is the "you" half of that — every platform owner
    //     gets the email instantly. Auto-trigger for Claude itself
    //     requires ANTHROPIC_API_KEY (see bug-analyzer.service.ts)
    //     OR a manual paste-into-chat workflow from the dashboard
    //     review page's "Copy bundle for Claude" button.
    //
    //     Done as a separate promise from the reporter email so a
    //     slow Resend response doesn't add up; both fire in
    //     parallel without blocking the response.
    this.prisma.client.user
      .findMany({
        where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
        select: { email: true },
      })
      .then((admins) => {
        // Normal case: notify every OTHER super-admin (the reporter
        // already gets BUG_FILED, no need to ping them twice).
        //
        // Edge case (2026-05-28 — Greg's complaint "no bug emails
        // getting sent"): if the reporter IS the only active
        // super-admin, excluding them leaves zero recipients and
        // owner-side observability silently goes dark. In that case
        // include the reporter so they still get an owner-flavored
        // copy (with full context — page, tenant slug, vertical).
        // Costs one extra email per reported bug on solo-owner
        // tenants; that's the right trade.
        const allEmails = admins.map((a) => a.email).filter((e): e is string => !!e);
        const otherAdmins = allEmails.filter((e) => e !== req.user?.email);
        const ownerEmails = otherAdmins.length > 0 ? otherAdmins : allEmails;
        if (ownerEmails.length === 0) return;
        return Promise.all(
          ownerEmails.map((to) =>
            this.email
              .sendBugFiledOwnerAlert({
                to,
                bugId: bug.id,
                reporterEmail: req.user?.email ?? '(unknown)',
                reporterRole: req.user?.role ?? null,
                description: bug.description,
                pathname: captured?.pathname ?? null,
                tenantSlug: captured?.reporter?.tenantSlug ?? null,
                tenantVertical: captured?.reporter?.tenantVertical ?? null,
              })
              .catch((e) =>
                this.logger.warn(
                  `[bug-email] sendBugFiledOwnerAlert(${bug.id} → ${to}) failed: ${e?.message ?? e}`,
                ),
              ),
          ),
        );
      })
      .catch((e) =>
        this.logger.warn(
          `[bug-email] owner-alert fan-out(${bug.id}) failed: ${e?.message ?? e}`,
        ),
      );

    return {
      bugId: bug.id,
      status: 'NEW' as BugStatus,
      analysisReady: false,
    };
  }

  // ─── GET /api/v1/bugs ───────────────────────────────────────

  @Get()
  @RequireRoles(...ADMIN_ROLES)
  async list(
    @Request() req: any,
    @Query(new ZodValidationPipe(ListBugsQuerySchema)) q: any,
  ): Promise<BugListItem[]> {
    const isSuperAdmin = req.user?.role === AppRole.SUPER_ADMIN;
    const tenantId = req.user?.tenantId;

    // Status filter: default to NEW + ANALYZING + PROPOSED (the
    // "actionable" bucket). Comma-separated override allowed:
    // ?status=APPROVED,SHIPPED.
    let statusFilter: BugStatus[] = ['NEW', 'ANALYZING', 'PROPOSED'];
    if (q?.status) {
      const parts = String(q.status)
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean) as BugStatus[];
      if (parts.length) statusFilter = parts;
    }

    // Tenant filter: SUPER_ADMIN can scope to any tenant or all;
    // others are forced to their own.
    let tenantFilter: string | undefined;
    if (isSuperAdmin) {
      if (q?.tenantId) tenantFilter = String(q.tenantId);
    } else {
      if (!tenantId) return []; // can't filter to nothing → empty list
      tenantFilter = tenantId;
    }

    const rows = await this.prisma.client.bug.findMany({
      where: {
        status: { in: statusFilter as string[] },
        ...(tenantFilter ? { tenantId: tenantFilter } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: { select: { id: true, email: true } },
        tenant: { select: { slug: true } },
      },
    });

    return rows.map((r) => this.toListItem(r));
  }

  // ─── GET /api/v1/bugs/:id ───────────────────────────────────

  @Get(':id')
  @RequireRoles(...ADMIN_ROLES)
  async detail(
    @Request() req: any,
    @Param('id') id: string,
  ): Promise<BugDetail> {
    const bug = await this.loadBugWithRbac(req, id);
    return this.toDetail(bug);
  }

  // ─── POST /api/v1/bugs/:id/approve ──────────────────────────

  @Post(':id/approve')
  @RequireRoles(...ADMIN_ROLES)
  async approve(
    @Request() req: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ApproveBugSchema)) body: ApproveBugRequest,
  ): Promise<ApproveBugResponse> {
    const bug = await this.loadBugWithRbac(req, id);
    // Don't approve already-approved / shipped / rejected rows.
    if (['APPROVED', 'SHIPPED', 'REJECTED', 'DUPLICATE'].includes(bug.status)) {
      throw new HttpException(
        {
          message: `Bug is already in terminal state '${bug.status}'. Use POST /bugs/:id/iterate to revisit.`,
          code: 'BUG_ALREADY_DECIDED',
        },
        HttpStatus.CONFLICT,
      );
    }
    // Only allow approving rows that have an actual analysis. The FE
    // hides the button when aiAnalysis is null or has an error, but
    // defense-in-depth.
    const analysis = bug.aiAnalysis as unknown as BugAiAnalysis | null;
    if (!analysis || (analysis as any).error) {
      throw new HttpException(
        {
          message:
            'Cannot approve a bug that has no AI analysis (or whose analysis errored). Use /iterate to re-run.',
          code: 'BUG_NO_ANALYSIS',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    let branchName: string | null = null;
    let prUrl: string | null = null;
    let prNumber: number | null = null;

    if (process.env.GITHUB_REPO && process.env.GH_TOKEN) {
      try {
        const result = await this.tryCreatePr({
          bugId: id,
          analysis,
          adminNotes: body?.notes,
        });
        branchName = result.branchName;
        prUrl = result.prUrl;
        prNumber = result.prNumber;
      } catch (e: any) {
        // PR creation failure doesn't block approval — operator can
        // still apply the diff manually. We just record manual.
        this.logger.warn(
          `gh PR creation failed for bug ${id}: ${e?.message ?? e}`,
        );
        branchName = `manual:${id}`;
      }
    } else {
      branchName = `manual:${id}`;
    }

    const updated = await this.prisma.client.bug.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: req.user?.id ?? null,
        approvedAt: new Date(),
        fixBranchName: branchName,
        fixPrNumber: prNumber,
      },
    });

    await this.writeAuditLog(updated.tenantId, 'BUG_APPROVED', id, {
      adminUserId: req.user?.id ?? null,
      branchName,
      prUrl,
      prNumber,
      notesProvided: !!body?.notes,
    });

    // 2026-05-27 — Fire-and-forget "fix is shipping" email to the
    // original reporter. Includes the PR URL when GitHub creation
    // succeeded, otherwise points them at /super/bugs/<id> for the
    // manual-diff path.
    if (updated.userId) {
      this.prisma.client.user
        .findUnique({ where: { id: updated.userId }, select: { email: true } })
        .then((reporter) => {
          if (!reporter?.email) return;
          return this.email.sendBugFixShipped({
            to: reporter.email,
            bugId: id,
            description: updated.description,
            prUrl,
          });
        })
        .catch((e) =>
          this.logger.warn(
            `[bug-email] sendBugFixShipped(${id}) failed: ${e?.message ?? e}`,
          ),
        );
    }

    return {
      bugId: id,
      status: 'APPROVED' as BugStatus,
      prUrl,
      branchName,
    };
  }

  // ─── POST /api/v1/bugs/:id/reject ───────────────────────────

  @Post(':id/reject')
  @RequireRoles(...ADMIN_ROLES)
  async reject(
    @Request() req: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RejectBugSchema)) body: RejectBugRequest,
  ): Promise<BugDetail> {
    const bug = await this.loadBugWithRbac(req, id);
    if (['APPROVED', 'SHIPPED', 'REJECTED', 'DUPLICATE'].includes(bug.status)) {
      throw new HttpException(
        {
          message: `Bug is already in terminal state '${bug.status}'.`,
          code: 'BUG_ALREADY_DECIDED',
        },
        HttpStatus.CONFLICT,
      );
    }

    const isDuplicate = !!body?.duplicateOfBugId;
    let rejectedReason = String(body.reason ?? '').slice(0, 5000);
    if (isDuplicate) {
      rejectedReason = `dup:${body.duplicateOfBugId} — ${rejectedReason}`;
    }
    const newStatus: BugStatus = isDuplicate ? 'DUPLICATE' : 'REJECTED';

    const updated = await this.prisma.client.bug.update({
      where: { id },
      data: {
        status: newStatus,
        rejectedReason,
      },
    });

    await this.writeAuditLog(updated.tenantId, 'BUG_REJECTED', id, {
      adminUserId: req.user?.id ?? null,
      newStatus,
      duplicateOfBugId: body?.duplicateOfBugId ?? null,
      reasonChars: rejectedReason.length,
    });

    return this.toDetail(updated);
  }

  // ─── POST /api/v1/bugs/:id/iterate ──────────────────────────

  @Post(':id/iterate')
  @RequireRoles(...ADMIN_ROLES)
  async iterate(
    @Request() req: any,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(IterateBugSchema)) body: IterateBugRequest,
  ): Promise<BugDetail> {
    const bug = await this.loadBugWithRbac(req, id);
    if (['SHIPPED', 'REJECTED', 'DUPLICATE'].includes(bug.status)) {
      throw new HttpException(
        {
          message: `Cannot iterate on a closed bug (status '${bug.status}').`,
          code: 'BUG_CLOSED',
        },
        HttpStatus.CONFLICT,
      );
    }
    // APPROVED rows CAN be iterated (admin changed their mind before
    // CI shipped). The analyzer's idempotency check excludes APPROVED
    // from auto-skip; flip back to ANALYZING so the analyzer accepts.
    await this.prisma.client.bug.update({
      where: { id },
      data: {
        status: 'ANALYZING',
      },
    });

    // Fire analysis with the notes. We DON'T await — same fire-and-forget
    // pattern as create(). Caller polls /bugs/:id for the new analysis.
    this.analyzer.analyze(id, body.notes).catch((e) => {
      this.logger.error(
        `analyzer.analyze(${id}) crashed during iterate: ${e?.message ?? e}`,
      );
    });

    await this.writeAuditLog(bug.tenantId, 'BUG_AI_RE_ANALYZED', id, {
      adminUserId: req.user?.id ?? null,
      notesChars: body.notes.length,
    });

    const reloaded = await this.prisma.client.bug.findUnique({
      where: { id },
    });
    return this.toDetail(reloaded!);
  }

  // ─── POST /api/v1/bugs/:id/manual-analysis ──────────────────
  //
  // 2026-05-27 — Operator (Greg) raised the deal-killer for the
  // Anthropic-backed analyzer: "claude API wants me to add money so
  // we cant even test....what about just feeding the bug info back
  // into the app somewhere that you have access to so that you can
  // review the bug and all the collected content and we dont need
  // an API?"
  //
  // Pivot: don't pay per-bug for AI analysis. Instead, Claude (this
  // session, via the postgres MCP) reads the bug record directly,
  // proposes a fix in chat, writes the actual code, commits. This
  // endpoint exists so the analysis can be written BACK into the
  // bug record for audit-trail + UI display purposes.
  //
  // The shape of `analysis` matches BugAiAnalysis exactly (same
  // contract as the Anthropic path), so the /super/bugs/[id] page
  // renders it identically regardless of source. aiProvider is set
  // to 'claude-via-chat' to distinguish from 'anthropic'. No model
  // string + zero cost since we never made an API call.
  //
  // Status moves NEW/ANALYZING → PROPOSED so the [Approve & Ship]
  // button activates. The analyzer-was-unconfigured error shape in
  // ai_analysis is overwritten.
  //
  // RBAC: SUPER_ADMIN only — this is for closing the AI loop with
  // platform-owner-level review, not a tenant-admin path.

  @Post(':id/manual-analysis')
  @RequireRoles(AppRole.SUPER_ADMIN)
  async manualAnalysis(
    @Request() req: any,
    @Param('id') id: string,
    @Body() body: { analysis: BugAiAnalysis },
  ): Promise<BugDetail> {
    const bug = await this.loadBugWithRbac(req, id);
    if (['SHIPPED', 'REJECTED', 'DUPLICATE'].includes(bug.status)) {
      throw new HttpException(
        {
          message: `Cannot write analysis to closed bug (status '${bug.status}').`,
          code: 'BUG_CLOSED',
        },
        HttpStatus.CONFLICT,
      );
    }

    // Minimal shape check — the analysis MUST have a rootCause +
    // filesAffected[] + confidence. Reject malformed input cleanly
    // rather than letting the detail page crash on missing fields.
    const a: any = body?.analysis;
    if (!a || typeof a !== 'object') {
      throw new HttpException(
        { message: 'analysis is required', code: 'BUG_BAD_ANALYSIS' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (typeof a.rootCause !== 'string' || !a.rootCause.trim()) {
      throw new HttpException(
        { message: 'analysis.rootCause is required', code: 'BUG_BAD_ANALYSIS' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!Array.isArray(a.filesAffected)) {
      throw new HttpException(
        { message: 'analysis.filesAffected[] is required (use [] if no files)', code: 'BUG_BAD_ANALYSIS' },
        HttpStatus.BAD_REQUEST,
      );
    }
    if (typeof a.confidence !== 'number') {
      throw new HttpException(
        { message: 'analysis.confidence (0-100) is required', code: 'BUG_BAD_ANALYSIS' },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Normalize: stamp analyzedAt + v if missing.
    const normalized: BugAiAnalysis = {
      v: 1,
      rootCause: String(a.rootCause).slice(0, 8000),
      filesAffected: a.filesAffected.slice(0, 50).map((f: any) => ({
        filePath: String(f.filePath ?? '').slice(0, 500),
        reason: String(f.reason ?? '').slice(0, 1000),
        diff: String(f.diff ?? '').slice(0, 20000),
      })),
      confidence: Math.max(0, Math.min(100, Math.round(a.confidence))),
      alternatives: Array.isArray(a.alternatives)
        ? a.alternatives.slice(0, 5).map((alt: any) => ({
            rootCause: String(alt.rootCause ?? '').slice(0, 4000),
            confidence: Math.max(0, Math.min(100, Math.round(alt.confidence ?? 0))),
          }))
        : undefined,
      testPlan: a.testPlan ? String(a.testPlan).slice(0, 4000) : undefined,
      analyzedAt: Date.now(),
    };

    await this.prisma.client.bug.update({
      where: { id },
      data: {
        aiAnalysis: normalized as any,
        aiAnalyzedAt: new Date(),
        aiProvider: 'claude-via-chat',
        aiModel: null,    // no model string — wasn't an API call
        aiCostUsd: 0,     // zero cost path
        status: 'PROPOSED',
      },
    });

    await this.writeAuditLog(bug.tenantId, 'BUG_ANALYZED', id, {
      adminUserId: req.user?.id ?? null,
      provider: 'claude-via-chat',
      confidence: normalized.confidence,
      filesAffected: normalized.filesAffected.length,
    });

    // 2026-05-27 — Fire-and-forget email to the original reporter:
    // "Claude analyzed your bug, fix is proposed, please review."
    // Look up the reporter from the original user row (Bug.userId)
    // so the analysis email goes to the person who filed, not to
    // the admin who clicked the writeback button. Shared with the
    // automatic AI-analysis path (BugAnalyzerService.analyze) via
    // notifyBugFixProposed (email-fix #4, 2026-07-03) so both paths
    // send the identical notification instead of drifting apart.
    notifyBugFixProposed(this.prisma, this.email, this.logger, {
      bugId: id,
      reporterUserId: bug.userId,
      rootCause: normalized.rootCause,
      confidence: normalized.confidence,
      filesAffectedCount: normalized.filesAffected.length,
    });

    const reloaded = await this.prisma.client.bug.findUnique({
      where: { id },
    });
    return this.toDetail(reloaded!);
  }

  // ─── Internals ──────────────────────────────────────────────

  /**
   * Load a bug row, throwing 404 when missing and 403 when the user
   * isn't allowed (DISTRICT/SCHOOL_ADMIN can only see their own
   * tenant; SUPER_ADMIN sees all).
   */
  private async loadBugWithRbac(req: any, id: string) {
    const bug = await this.prisma.client.bug.findUnique({ where: { id } });
    if (!bug) {
      throw new HttpException(
        { message: 'Bug not found', code: 'BUG_NOT_FOUND' },
        HttpStatus.NOT_FOUND,
      );
    }
    const isSuperAdmin = req.user?.role === AppRole.SUPER_ADMIN;
    if (!isSuperAdmin) {
      if (!req.user?.tenantId || bug.tenantId !== req.user.tenantId) {
        throw new HttpException(
          { message: 'Access denied for this bug', code: 'BUG_FORBIDDEN' },
          HttpStatus.FORBIDDEN,
        );
      }
    }
    return bug;
  }

  private toListItem(row: any): BugListItem {
    const captured = row.capturedContext as BugCapturedContext | null;
    const analysis = row.aiAnalysis as BugAiAnalysis | null;
    return {
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      status: row.status as BugStatus,
      description: row.description ?? null,
      screenshotUrl: row.screenshotUrl ?? null,
      reporter: {
        userId: row.userId ?? null,
        email: row.user?.email ?? captured?.reporter?.email ?? null,
        tenantSlug: row.tenant?.slug ?? captured?.reporter?.tenantSlug ?? null,
      },
      pathname: captured?.pathname ?? null,
      aiConfidence:
        analysis && typeof (analysis as any).confidence === 'number'
          ? (analysis as any).confidence
          : null,
    };
  }

  private toDetail(row: any): BugDetail {
    const list = this.toListItem(row);
    return {
      ...list,
      capturedContext: (row.capturedContext ??
        {}) as unknown as BugCapturedContext,
      serverContext: (row.serverContext ?? null) as BugServerContext | null,
      aiAnalysis: (row.aiAnalysis ?? null) as BugAiAnalysis | null,
      aiCostUsd: row.aiCostUsd ?? null,
      approvedById: row.approvedById ?? null,
      approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
      fixBranchName: row.fixBranchName ?? null,
      fixPrNumber: row.fixPrNumber ?? null,
      fixCommitSha: row.fixCommitSha ?? null,
      shippedAt: row.shippedAt ? row.shippedAt.toISOString() : null,
      rejectedReason: row.rejectedReason ?? null,
    };
  }

  /**
   * Write a tenant-scoped AuditLog row. Skipped (with a debug log) when
   * tenantId is null — AuditLog.tenantId is a non-null FK and we'd
   * rather drop a row than fabricate a fake tenant.
   */
  private async writeAuditLog(
    tenantId: string | null,
    action: 'BUG_APPROVED' | 'BUG_REJECTED' | 'BUG_AI_RE_ANALYZED' | 'BUG_ANALYZED',
    bugId: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    if (!tenantId) {
      this.logger.debug(
        `writeAuditLog(${action}, ${bugId}) skipped — bug has no tenant`,
      );
      return;
    }
    try {
      await this.prisma.client.auditLog.create({
        data: {
          action,
          targetType: 'bug',
          targetId: bugId,
          tenantId,
          userId: (details.adminUserId as string | null) ?? null,
          details: JSON.stringify(details),
        },
      });
    } catch (e: any) {
      this.logger.warn(
        `writeAuditLog(${action}, ${bugId}) failed: ${e?.message ?? e}`,
      );
    }
  }

  /**
   * Ensure the bug-screenshots bucket exists. Idempotent + cached so
   * we don't slam Supabase on every POST. Bucket is private (no public
   * URL); we return the public URL for now because the dashboard runs
   * as authed-admin only and short-TTL signed URLs aren't worth the
   * extra complexity for v1.
   */
  private async ensureScreenshotBucket(): Promise<void> {
    if (!this.screenshotBucketReady) {
      this.screenshotBucketReady = (async () => {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !key) {
          // No Supabase configured — caller catches + we just skip the
          // upload. Mark the promise as resolved so we don't re-try
          // every request.
          return;
        }
        try {
          const { createClient } = await import('@supabase/supabase-js');
          const client = createClient(url, key, { auth: { persistSession: false } });
          const { error } = await client.storage.createBucket(SCREENSHOT_BUCKET, {
            public: true,
            fileSizeLimit: BUG_SCREENSHOT_MAX_BYTES,
            allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
          });
          if (error && !error.message?.match(/already exists|duplicate/i)) {
            this.logger.warn(
              `screenshot bucket create failed: ${error.message}`,
            );
          }
        } catch (e: any) {
          this.logger.warn(
            `screenshot bucket setup threw: ${e?.message ?? e}`,
          );
        }
      })();
    }
    return this.screenshotBucketReady;
  }

  /** Upload a screenshot Buffer to bug-screenshots/, return public URL. */
  private async uploadScreenshot(
    tenantId: string | null,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    await this.ensureScreenshotBucket();
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error(
        'Supabase storage not configured — set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY',
      );
    }
    // Per-tenant prefix keeps the bucket browsable / easy to GC if a
    // tenant offboards. UUID filename avoids collision + makes the
    // URL non-guessable.
    const ext = contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/webp' ? 'webp' : 'png';
    const filename = `${cryptoUuid()}.${ext}`;
    const path = tenantId
      ? `${tenantId}/${filename}`
      : `__platform__/${filename}`;
    const endpoint = `${url}/storage/v1/object/${SCREENSHOT_BUCKET}/${path}`;
    // Copy to a guaranteed ArrayBuffer (same approach SupabaseStorageService uses;
    // some fetch implementations choke on a raw Buffer body).
    const ab = new ArrayBuffer(buffer.length);
    new Uint8Array(ab).set(buffer);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        'Content-Type': contentType,
        'Content-Length': String(buffer.length),
        'x-upsert': 'true',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
      body: new Blob([ab]),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`storage upload ${res.status}: ${errBody.slice(0, 200)}`);
    }
    return `${url}/storage/v1/object/public/${SCREENSHOT_BUCKET}/${path}`;
  }

  /**
   * Open a GitHub PR via the `gh` CLI. Returns the PR URL + number.
   *
   * Strategy: write the AI's diffs to a tempdir, run
   *   gh api graphql / gh pr create
   * via spawn (no shell, escaped via argv). GH_TOKEN is passed via env
   * (gh respects it). GITHUB_REPO is "owner/repo".
   *
   * Failure modes are converted to a thrown Error; the caller logs
   * and falls back to "manual" branch naming.
   */
  private async tryCreatePr(args: {
    bugId: string;
    analysis: BugAiAnalysis;
    adminNotes?: string;
  }): Promise<{ branchName: string; prUrl: string | null; prNumber: number | null }> {
    const repo = process.env.GITHUB_REPO!;
    const branchName = `bot/bug-${args.bugId.slice(0, 8)}-${Date.now()}`;

    // Compose the PR body. We don't actually push code via `gh` — the
    // operator-facing UI shows the diff and a separate commit-and-push
    // flow lives outside this controller (out of scope for v1: gh CLI
    // here just opens the PR shell + posts the diff as the body so the
    // operator can apply it via `gh pr checkout` + `git apply`).
    const fenceFiles = args.analysis.filesAffected
      .map((f) => {
        return [
          `### \`${f.filePath}\``,
          `${f.reason}`,
          '',
          '```diff',
          f.diff,
          '```',
          '',
        ].join('\n');
      })
      .join('\n');
    const body = [
      `# Bug fix proposal — \`bug:${args.bugId}\``,
      '',
      `## Root cause`,
      args.analysis.rootCause,
      '',
      `## Files affected`,
      '',
      fenceFiles,
      '',
      args.analysis.testPlan
        ? `## Test plan\n\n${args.analysis.testPlan}\n`
        : '',
      args.adminNotes ? `## Admin notes\n\n${args.adminNotes}\n` : '',
      args.analysis.confidence < 70
        ? `> AI self-rated confidence: **${args.analysis.confidence}/100** — please verify before merging.`
        : `AI self-rated confidence: ${args.analysis.confidence}/100`,
    ]
      .filter(Boolean)
      .join('\n');

    // We open the PR against an existing (empty) branch on the same
    // base as origin's default branch. `gh pr create --draft` keeps it
    // out of the CI mainline until the operator pushes the actual diff.
    //
    // The gh CLI has different semantics depending on whether the cwd
    // is a git workdir. We pass --repo so the call works from any cwd.
    const args1 = [
      'pr',
      'create',
      '--repo',
      repo,
      '--draft',
      '--title',
      `Fix bug ${args.bugId.slice(0, 8)}`,
      '--body',
      body,
      '--head',
      branchName,
      '--base',
      'master',
    ];
    let stdout = '';
    let stderr = '';
    let exitCode = -1;
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('gh', args1, {
          env: {
            ...process.env,
            GH_TOKEN: process.env.GH_TOKEN!,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        child.stdout?.on('data', (d) => {
          stdout += String(d);
        });
        child.stderr?.on('data', (d) => {
          stderr += String(d);
        });
        const killer = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error('gh pr create timed out after 15s'));
        }, 15_000);
        child.on('exit', (code) => {
          clearTimeout(killer);
          exitCode = code ?? -1;
          resolve();
        });
        child.on('error', (e) => {
          clearTimeout(killer);
          reject(e);
        });
      });
    } catch (e: any) {
      throw new Error(`gh CLI invocation failed: ${e?.message ?? e}`);
    }

    if (exitCode !== 0) {
      throw new Error(
        `gh pr create exit ${exitCode}: ${stderr.slice(0, 400)}`,
      );
    }
    const prUrl = stdout.trim().split('\n').find((l) => l.startsWith('http')) ?? null;
    const prNumber = prUrl
      ? Number(prUrl.replace(/.*\/pull\//, '').split('/')[0]) || null
      : null;
    return { branchName, prUrl, prNumber: Number.isFinite(prNumber) ? prNumber : null };
  }
}

/** UUID v4 generator. Avoids importing 'crypto' at module top because Node
 *  18+ has crypto.randomUUID() via globalThis.crypto. */
function cryptoUuid(): string {
  // globalThis.crypto.randomUUID is available in Node 19+ stable + ts-node;
  // fall back to a require-time crypto import otherwise.
  const g: any = globalThis as any;
  if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('crypto').randomUUID();
}
