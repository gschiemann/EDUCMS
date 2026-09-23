/**
 * designer-jobs.ts — the page-side helpers for AI Designer background generation (2026-09-23).
 *
 * The hooks live in `@/hooks/use-api` (start / poll / cancel / again). This file holds the pure
 * pieces the templates page needs around them, so they are testable without mounting the page:
 *
 *   - `mapDesignerBoards` — a generate response (sync OR a finished job's `result`, which is the
 *     same body) → the pick grid's candidates. ONE mapping for both paths.
 *   - `designerJobErrorAsApiError` — a failed job's stored envelope → the error object `apiFetch`
 *     throws for the same response, so the page's existing error mapping (`friendlyAiError`:
 *     AI_CAP_REACHED / 402, MENU_BINDING_INCOMPLETE, 429, 503 …) says exactly what it said before.
 *   - `designerJobStageMessage` — the translated "Drawing 3 boards…" line for a job's progress.
 *   - the pending-job cache — while a job runs, `vos:ai:job:<school>` holds its id (and how to
 *     regenerate it), so a reload (iOS discards backgrounded tabs) resumes polling instead of
 *     losing the batch. Kept apart from `vos:ai:lastbatch:<school>`, so a job that fails or is
 *     cancelled never costs the operator their previous batch.
 *   - `designerJobsEndpointMissing` — the deploy-window fallback test (see the page).
 */
import type {
  AiTemplateCandidate,
  DesignerBoardCandidate,
  DesignerJob,
  DesignerJobError,
} from '@/hooks/use-api';

/** A generate response → the one-zone EXTERNAL_HTML candidates the pick grid previews. */
export function mapDesignerBoards(
  res: { candidates?: DesignerBoardCandidate[] | null; batchId?: string } | null | undefined,
): AiTemplateCandidate[] {
  return (res?.candidates || []).map((b) => ({
    name: b.name || 'AI Designer board',
    zones: [{ name: 'board', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, defaultConfig: { html: b.html } }],
    _designerHtml: b.html,
    // #268-1 keep-telemetry — carried through the picker (and the resume-last-batch cache) so the
    // keep can echo them to the server.
    _batchId: res?.batchId,
    _artDirection: b.artDirection,
    _structure: b.structure,
  }));
}

export type ApiLikeError = Error & { status?: number; code?: string; body?: unknown };

/** A failed job's envelope → what `apiFetch` would have thrown for the same answer. */
export function designerJobErrorAsApiError(envelope: DesignerJobError | null | undefined): ApiLikeError {
  const message = envelope?.message || 'Generation failed.';
  const err = new Error(message) as ApiLikeError;
  err.status = typeof envelope?.status === 'number' ? envelope.status : 500;
  err.code = envelope?.code;
  err.body = { error: true, code: envelope?.code, message };
  return err;
}

/**
 * DEPLOY-WINDOW FALLBACK. The web can deploy before the API that serves the jobs endpoints; in
 * that window `POST …/generate-designer/jobs` is an unknown route (Nest answers a plain 404). The
 * page then generates through the sync endpoint exactly as it did before jobs existed. Remove this
 * (and its one call site in templates/page.tsx) once an API with the jobs endpoints is live.
 */
export function designerJobsEndpointMissing(err: unknown): boolean {
  const e = err as { status?: number; code?: string } | null;
  return e?.status === 404 && e?.code !== 'AI_DESIGN_JOB_NOT_FOUND';
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** The translated progress line for a job (namespace: aiBoards). */
export function designerJobStageMessage(
  t: Translate,
  job: Pick<DesignerJob, 'status' | 'progress'> | null | undefined,
): string {
  if (!job || job.status === 'queued') return t('job.queued');
  const p = job.progress;
  const n = typeof p?.candidate === 'number' ? p.candidate : undefined;
  switch (p?.stage) {
    case 'drawing':
      return t('job.drawing', { count: typeof p.of === 'number' ? p.of : 3 });
    case 'binding':
      return t('job.binding');
    case 'rendering':
      return n ? t('job.rendering', { n }) : t('job.renderingAll');
    case 'reviewing':
      return n ? t('job.reviewing', { n }) : t('job.reviewingAll');
    case 'revising':
      return n ? t('job.revising', { n }) : t('job.revisingAll');
    case 'done':
      return t('job.done');
    default:
      // Running with no progress yet, or a stage this build does not know.
      return t('job.working');
  }
}

/** A fresh idempotency key per start (a retried POST with the same key returns the same job). */
export function newDesignerJobKey(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    /* fall through */
  }
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// ── the pending-job cache ──────────────────────────────────────────────────────────────────

/** A job still running when the page went away (and what the page needs to pick it back up). */
export interface PendingDesignerJob<Brief = unknown, Replay = unknown> {
  jobId: string;
  ts: number;
  canvas: { w: number; h: number };
  interactive: boolean;
  brief: Brief | null;
  replay: Replay | null;
}

/** Older than this, a pending job is not resumed on load (the server stops waiting at 30 min too). */
export const PENDING_DESIGNER_JOB_MAX_AGE_MS = 30 * 60_000;

export function pendingDesignerJobKey(schoolId: string | undefined | null): string {
  return `vos:ai:job:${schoolId ?? 'x'}`;
}

export function readPendingDesignerJob<Brief = unknown, Replay = unknown>(
  key: string,
  now: number = Date.now(),
): PendingDesignerJob<Brief, Replay> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PendingDesignerJob<Brief, Replay>>;
    const valid =
      p &&
      typeof p.jobId === 'string' &&
      p.jobId &&
      typeof p.ts === 'number' &&
      p.canvas &&
      typeof p.canvas.w === 'number' &&
      typeof p.canvas.h === 'number';
    if (!valid || now - (p.ts as number) > PENDING_DESIGNER_JOB_MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return {
      jobId: p.jobId as string,
      ts: p.ts as number,
      canvas: p.canvas as { w: number; h: number },
      interactive: !!p.interactive,
      brief: (p.brief ?? null) as Brief | null,
      replay: (p.replay ?? null) as Replay | null,
    };
  } catch {
    return null;
  }
}

export function writePendingDesignerJob(key: string, job: PendingDesignerJob): void {
  try {
    localStorage.setItem(key, JSON.stringify(job));
  } catch {
    /* storage unavailable (private mode / quota) — the job still runs, it just can't be resumed */
  }
}

export function clearPendingDesignerJob(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
