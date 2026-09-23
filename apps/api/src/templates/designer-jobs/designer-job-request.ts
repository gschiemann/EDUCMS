/**
 * designer-job-request.ts — the persisted, versioned AI Designer request, and the two
 * translations a background job needs (2026-09-23, Codex finding 5).
 *
 * Codex asked for "one normalized, versioned design request, replayed for Regenerate / resume /
 * refine". This is it:
 *
 *   - `buildDesignerJobRequest`  — the validated `DesignerGenerateSchema` output, palette resolved
 *                                  exactly as the sync endpoint resolves it, stamped with
 *                                  `requestVersion`. This is what `ai_designer_jobs.request` holds.
 *   - `designerOptionsFromJobRequest` — that request → the options object the sync endpoint hands
 *                                  `AiService.generateDesignerBoardCandidates`. Field for field the
 *                                  same list, the same coercions (a parity spec pins it).
 *   - `designerJobResult`        — the service's output → the body the sync endpoint returns (fit
 *                                  engine baked into each candidate, `batchId`, `boundTo`). Also
 *                                  pinned by a parity spec, so a change to the sync response that is
 *                                  not mirrored here turns a test red instead of shipping silently.
 *   - `replayableRequest`        — a stored request → the body `POST …/jobs/:id/again` re-validates
 *                                  through `DesignerGenerateSchema` before anything is spent.
 *
 * Pure: no Nest, no Prisma, no network. The schema itself stays in templates.controller.ts (the one
 * place it is defined); this file only borrows its TYPE, so there is no runtime import cycle.
 */
import type { z } from 'zod';
import type { AiService } from '../../ai/ai.service';
import type { DesignerGenerateSchema } from '../templates.controller';
import { injectDesignerLayoutEngine } from '../../ai/designer-edit-shim';

/** Bump when the stored shape changes in a way a replay must understand. */
export const DESIGNER_JOB_REQUEST_VERSION = 1 as const;

/** The validated body of `generate-designer/candidates` (and of `…/jobs`, minus its key). */
export type DesignerGenerateBody = z.infer<typeof DesignerGenerateSchema>;

/** What `ai_designer_jobs.request` holds. */
export type DesignerJobRequest = DesignerGenerateBody & { requestVersion: typeof DESIGNER_JOB_REQUEST_VERSION };

export type DesignerGenerateOptions = Parameters<AiService['generateDesignerBoardCandidates']>[0];
export type DesignerGenerateOutput = Awaited<ReturnType<AiService['generateDesignerBoardCandidates']>>;

/**
 * The request a job persists. `palette` is replaced by the RESOLVED list (the sync endpoint
 * resolves `'brand'` / `{ colors }` to hex before calling the service — the job must run the same
 * thing, and a hex list round-trips `DesignerGenerateSchema` on replay). The job's own transport
 * field (`idempotencyKey`) never reaches the stored request; it is a column.
 */
export function buildDesignerJobRequest(
  body: DesignerGenerateBody & { idempotencyKey?: unknown },
  resolvedPalette: string[] | undefined,
): DesignerJobRequest {
  const { idempotencyKey: _transport, palette: _asSent, ...rest } = body as DesignerGenerateBody & {
    idempotencyKey?: unknown;
  };
  void _transport;
  void _asSent;
  return {
    ...(rest as DesignerGenerateBody),
    ...(resolvedPalette && resolvedPalette.length ? { palette: resolvedPalette } : {}),
    requestVersion: DESIGNER_JOB_REQUEST_VERSION,
  };
}

/**
 * The stored request → `generateDesignerBoardCandidates` options. MIRRORS
 * `TemplatesController.generateDesignerCandidates` field for field (explicit list, not a spread:
 * the schema is `.passthrough()`, so the intake's extra keys ride in the body and must not reach
 * the service unless the sync endpoint would pass them too).
 */
export function designerOptionsFromJobRequest(
  request: DesignerJobRequest,
  ctx: { tenantId: string; userId?: string | null },
): DesignerGenerateOptions {
  const palette = Array.isArray(request.palette)
    ? request.palette.filter((c): c is string => typeof c === 'string')
    : undefined;
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId ?? undefined,
    prompt: request.prompt,
    screenWidth: request.screenWidth,
    screenHeight: request.screenHeight,
    vertical: request.vertical,
    palette: palette && palette.length ? palette : undefined,
    venueName: request.venueName,
    tagline: request.tagline,
    logoUrl: request.logoUrl,
    heroImageUrl: request.heroImageUrl,
    logoSource: request.logoSource,
    heroImageSource: request.heroImageSource,
    content: request.content,
    reference: request.reference,
    siteMenuMissing: request.siteMenuMissing === true,
    menuSource: request.menuSource,
    purpose: request.purpose,
    sampleMenu: request.sampleMenu === true,
    count: request.count,
    interactive: request.interactive,
    brief: request.brief,
    posSelection: request.posSelection,
  };
}

/** The body the sync endpoint returns, built from the service's output — the job's `result`. */
export function designerJobResult(out: DesignerGenerateOutput) {
  const candidates = (out.candidates || []).map((cnd) =>
    cnd && typeof cnd.html === 'string'
      ? { ...cnd, html: injectDesignerLayoutEngine(cnd.html, cnd.screenWidth, cnd.screenHeight) }
      : cnd,
  );
  return {
    candidates,
    designer: true as const,
    batchId: out.batchId,
    ai: { source: out.source, usage: out.usage },
    ...(out.boundTo ? { boundTo: out.boundTo } : {}),
  };
}
export type DesignerJobResult = ReturnType<typeof designerJobResult>;

/**
 * A stored request → the body to re-validate for a replay. Refuses a shape this build does not
 * understand (a missing/unknown `requestVersion`, or not an object) instead of guessing.
 */
export function replayableRequest(
  stored: unknown,
): { ok: true; body: Record<string, unknown> } | { ok: false; reason: string } {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { ok: false, reason: 'The saved request is missing.' };
  }
  const { requestVersion, ...body } = stored as Record<string, unknown>;
  if (requestVersion !== DESIGNER_JOB_REQUEST_VERSION) {
    return { ok: false, reason: `Unknown request version ${JSON.stringify(requestVersion ?? null)}.` };
  }
  return { ok: true, body };
}
