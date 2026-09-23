/**
 * designer-job-history.ts — the AI board HISTORY list's contract (2026-09-23).
 *
 * Greg: "keep a history of the generated templates so we aren't just throwing away tokens, so they
 * can go back to them and decide later if they want to continue tweaking them." Every batch the
 * worker finishes is already a DONE `ai_designer_jobs` row holding every candidate's HTML; this is
 * how the operator finds one again: `GET /templates/generate-designer/jobs` lists them (newest
 * first, no HTML), `GET …/jobs/:id` reopens one, `POST …/jobs/:id/again` regenerates it.
 *
 * Pure: the page's types, the SQL PROJECTION that pulls the small fields out of `request` /
 * `result` inside Postgres (so a list page never carries board HTML), the mapper from that
 * projection to the JSON the web reads, and the query parsing. The two reads themselves live in
 * `DesignerJobsService.history`.
 */
import { z } from 'zod';

/** Page size when the web does not say. */
export const DESIGNER_HISTORY_PAGE_DEFAULT = 20;
/** Largest page. A larger `limit` is clamped, never refused. */
export const DESIGNER_HISTORY_PAGE_MAX = 50;
/** How much of the operator's prompt an item carries (the card shows a line or two). */
export const DESIGNER_HISTORY_PROMPT_CHARS = 140;
/** The canvas the pipeline draws on when a request names none (AiService: `screenWidth || 1920`). */
const DEFAULT_CANVAS = { w: 1920, h: 1080 } as const;

/** One board of a batch in the list — never its HTML. */
export interface DesignerHistoryCandidate {
  /** Its position in the job's `result.candidates` (the `candidateIndex` the web sends on keep). */
  index: number;
  name: string;
  structure: string | null;
  artDirection: string | null;
  /** Present only when the look-and-fix loop rendered and measured this board. */
  review?: { score: number | null; revised: boolean };
}

/** One DONE generation in the list. */
export interface DesignerHistoryItem {
  id: string;
  createdAt: string;
  finishedAt: string | null;
  /** The first DESIGNER_HISTORY_PROMPT_CHARS characters of the operator's prompt. */
  prompt: string;
  venueName: string | null;
  /** The canvas the boards were drawn for. */
  canvas: { w: number; h: number };
  candidateCount: number;
  candidates: DesignerHistoryCandidate[];
  /** Set when the boards are bound to a POS menu. */
  boundTo?: { providerId: string; providerName: string; itemCount: number };
  /** The template the operator kept from this batch (the last keep). The template may since have been deleted. */
  keptTemplateId?: string;
  /** Whose AI key paid for it. */
  source: 'tenant' | 'platform' | null;
}

export interface DesignerHistoryPage {
  items: DesignerHistoryItem[];
  /** Pass back as `?before=` for the next, older page. Absent on the last page. */
  nextBefore?: string;
}

/** The scalar columns step 1 (the tenant-scoped Prisma read) selects. */
export const DESIGNER_HISTORY_SELECT = {
  id: true,
  createdAt: true,
  finishedAt: true,
  keptTemplateId: true,
} as const;

export interface DesignerHistoryRow {
  id: string;
  createdAt: Date | string;
  finishedAt: Date | string | null;
  keptTemplateId?: string | null;
}

/** What the projection returns per job (jsonb columns arrive parsed). */
export interface DesignerHistoryMetaRow {
  id: string;
  prompt: string | null;
  venueName: unknown;
  requestWidth: unknown;
  requestHeight: unknown;
  boundTo: unknown;
  source: unknown;
  candidates: unknown;
}

/**
 * Step 2's SQL: for the ids step 1 selected, the small fields only, projected INSIDE Postgres —
 * `result` holds every board's HTML (~120 KB a job), and pulling it to Node to read a name and a
 * score would move ~2.4 MB out of Supabase per 20-item page. Candidates keep their stored order
 * (`WITH ORDINALITY`); a `result.candidates` that is not an array reads as none. Bound to the
 * tenant AND the ids ($1 = tenant, $2… = ids); the placeholders are generated from the id COUNT,
 * values are never interpolated.
 */
export function designerHistoryProjectionSql(idCount: number): string {
  const ids = Array.from({ length: idCount }, (_, i) => `$${i + 2}`).join(', ');
  return `
    SELECT
      j."id",
      LEFT(j."request"->>'prompt', ${DESIGNER_HISTORY_PROMPT_CHARS}) AS "prompt",
      j."request"->'venueName' AS "venueName",
      j."request"->'screenWidth' AS "requestWidth",
      j."request"->'screenHeight' AS "requestHeight",
      j."result"->'boundTo' AS "boundTo",
      j."result"->'ai'->'source' AS "source",
      COALESCE((
        SELECT jsonb_agg(
                 jsonb_build_object(
                   'name', c."value"->'name',
                   'structure', c."value"->'structure',
                   'artDirection', c."value"->'artDirection',
                   'review', c."value"->'review',
                   'screenWidth', c."value"->'screenWidth',
                   'screenHeight', c."value"->'screenHeight'
                 ) ORDER BY c."ordinality")
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(j."result"->'candidates') = 'array'
                      THEN j."result"->'candidates' ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS c("value", "ordinality")
      ), '[]'::jsonb) AS "candidates"
    FROM "ai_designer_jobs" j
    WHERE j."tenant_id" = $1 AND j."id" IN (${ids})
  `;
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const positiveInt = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
const iso = (d: Date | string | null | undefined): string | null =>
  d == null ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString();

/** Step 1's row + step 2's projection → one list item. Tolerant of any stored shape; never throws. */
export function toDesignerHistoryItem(row: DesignerHistoryRow, meta: DesignerHistoryMetaRow): DesignerHistoryItem {
  const stored = Array.isArray(meta.candidates) ? (meta.candidates as Array<Record<string, unknown> | null>) : [];
  const candidates = stored.map((c, index): DesignerHistoryCandidate => {
    const out: DesignerHistoryCandidate = {
      index,
      name: text(c?.name) ?? '',
      structure: text(c?.structure),
      artDirection: text(c?.artDirection),
    };
    const review = c?.review as { reviewed?: unknown; revised?: unknown; score?: unknown } | null | undefined;
    if (review && typeof review === 'object' && review.reviewed === true) {
      out.review = {
        score: typeof review.score === 'number' && Number.isFinite(review.score) ? review.score : null,
        revised: review.revised === true,
      };
    }
    return out;
  });
  // The boards' own canvas first (what was actually drawn), then the request, then the default.
  const first = stored[0] ?? null;
  const w = positiveInt(first?.screenWidth) ?? positiveInt(meta.requestWidth) ?? DEFAULT_CANVAS.w;
  const h = positiveInt(first?.screenHeight) ?? positiveInt(meta.requestHeight) ?? DEFAULT_CANVAS.h;
  const b = meta.boundTo as { providerId?: unknown; providerName?: unknown; itemCount?: unknown } | null;
  const boundTo =
    b && typeof b === 'object' && typeof b.providerId === 'string' && typeof b.providerName === 'string'
      ? {
          providerId: b.providerId,
          providerName: b.providerName,
          itemCount: typeof b.itemCount === 'number' && Number.isFinite(b.itemCount) ? b.itemCount : 0,
        }
      : null;
  const source = meta.source === 'tenant' || meta.source === 'platform' ? meta.source : null;
  return {
    id: row.id,
    createdAt: iso(row.createdAt) as string,
    finishedAt: iso(row.finishedAt),
    prompt: typeof meta.prompt === 'string' ? meta.prompt : '',
    venueName: text(meta.venueName),
    canvas: { w, h },
    candidateCount: candidates.length,
    candidates,
    ...(boundTo ? { boundTo } : {}),
    ...(row.keptTemplateId ? { keptTemplateId: row.keptTemplateId } : {}),
    source,
  };
}

/** `?limit=` → 1…DESIGNER_HISTORY_PAGE_MAX; missing or not a number → the default. */
export function clampDesignerHistoryLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return DESIGNER_HISTORY_PAGE_DEFAULT;
  return Math.min(Math.max(Math.trunc(n), 1), DESIGNER_HISTORY_PAGE_MAX);
}

/**
 * The list's query. `limit` is a preference (clamped, see above). `before` is a POSITION — an ISO
 * timestamp, which is what `nextBefore` hands out — so anything else is a 400: silently ignoring a
 * bad cursor would restart the list at the newest job and the web would page the same items forever.
 */
export const DesignerJobHistoryQuerySchema = z
  .object({
    limit: z.union([z.string().max(12), z.number()]).optional(),
    before: z.string().trim().datetime({ offset: true }).optional(),
  })
  .passthrough();
export type DesignerJobHistoryQuery = z.infer<typeof DesignerJobHistoryQuerySchema>;
