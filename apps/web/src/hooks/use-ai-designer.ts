/**
 * AI Designer — brief-echo confirm chips (2026-07-01, launch-sprint #268
 * item 3, task #277 FE half). Backend already SHIPPED (bb743d48):
 *   POST /templates/generate-designer/brief      → { brief, ai: { source } }
 *   POST /templates/generate-designer/candidates → accepts an optional
 *     `brief` object (re-validated server-side by AiService.
 *     sanitizeClientDesignerBrief — never trust the client shape alone).
 *
 * This hook is the FE mirror of the server's zod shapes in
 * apps/api/src/templates/templates.controller.ts (DesignerBriefSchema /
 * DesignerBriefRequestSchema) and apps/api/src/ai/designer-prompt.ts
 * (DesignerBrief). Field names, optionality, and caps are kept IDENTICAL on
 * purpose so a payload built from this file's types round-trips cleanly.
 *
 * FAIL-OPEN CONTRACT (mirrors the backend): extraction is a best-effort
 * disambiguation pass, never a gate. `useExtractDesignerBrief` can reject
 * (network error, timeout, non-2xx) and the caller MUST treat that exactly
 * like a `{ brief: null }` response — skip the confirm strip and generate
 * immediately. Nothing in this file throws in a way that should ever block
 * the "Generate" action.
 */
import { useMutation } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';

/**
 * The structured reading of an operator's free-text signage brief. Mirrors
 * `DesignerBrief` in apps/api/src/ai/designer-prompt.ts field-for-field.
 */
export interface DesignerBrief {
  /** What the board is for, in a few words ("happy hour promo"). */
  occasion: string;
  /** The single headline the board should carry. */
  headline: string;
  /** Concrete items/offers/features the board should feature. */
  items: string[];
  /** A date/time/schedule string, if the brief implies one. Empty if none. */
  dateTime: string;
  /** One or two words describing the tone ("playful", "premium", "urgent"). */
  tone: string;
  /** A call-to-action phrase, if the brief implies one. Empty if none. */
  callToAction: string;
}

/** An empty, all-fields-blank brief — the safe zero value for chip editing
 *  before extraction has resolved (never itself sent to the server; a fully
 *  empty brief carries no signal, see server-side `sanitizeClientDesignerBrief`). */
export const EMPTY_DESIGNER_BRIEF: DesignerBrief = {
  occasion: '',
  headline: '',
  items: [],
  dateTime: '',
  tone: '',
  callToAction: '',
};

/** Same caps as `DesignerBriefSchema` server-side — kept in sync so a
 *  chip-edit UI can enforce the same limits before the round trip rather
 *  than surprising the operator with a server 400 on save. */
export const DESIGNER_BRIEF_LIMITS = {
  occasion: 400,
  headline: 400,
  item: 200,
  maxItems: 30,
  dateTime: 400,
  tone: 400,
  callToAction: 400,
} as const;

export interface DesignerBriefRequestBody {
  prompt: string;
  vertical?: string;
  content?: string;
}

export interface DesignerBriefResponse {
  brief: DesignerBrief | null;
  ai: { source: 'tenant' | 'platform' | null };
}

/**
 * POST /templates/generate-designer/brief — the cheap pre-flight extraction
 * call. Fires BEFORE the expensive 3× fan-out so the operator gets a
 * 2-second-glance confirm strip instead of spending 3 generations on an
 * unconfirmed reading of their prompt.
 *
 * Callers MUST treat a rejection (network/timeout/5xx) the same as a
 * `{ brief: null }` success — this hook does not retry and does not throw a
 * "friendly" error, because there is no user-facing error state for this
 * call: a failure here is invisible to the operator by design (fail-open).
 */
export function useExtractDesignerBrief() {
  return useMutation<DesignerBriefResponse, Error, DesignerBriefRequestBody>({
    mutationFn: (body) =>
      apiFetch<DesignerBriefResponse>('/templates/generate-designer/brief', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}

/** True when a brief carries at least one non-empty field — mirrors the
 *  server's `parseDesignerBrief` "require at least SOME signal" rule, so the
 *  FE can decide whether showing the confirm strip is worthwhile at all. */
export function designerBriefHasSignal(brief: DesignerBrief | null | undefined): boolean {
  if (!brief) return false;
  return !!(
    brief.occasion?.trim() ||
    brief.headline?.trim() ||
    (brief.items && brief.items.length > 0 && brief.items.some((i) => i.trim())) ||
    brief.dateTime?.trim() ||
    brief.tone?.trim() ||
    brief.callToAction?.trim()
  );
}

/**
 * Apply a single chip edit immutably, enforcing the same length/count caps
 * as `DesignerBriefSchema` server-side. Used by the confirm-strip UI so an
 * operator's inline edit can never build a payload the server would reject.
 */
export function applyDesignerBriefEdit(
  brief: DesignerBrief,
  field: keyof DesignerBrief,
  value: string | string[],
): DesignerBrief {
  if (field === 'items') {
    const items = (Array.isArray(value) ? value : [value])
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => v.slice(0, DESIGNER_BRIEF_LIMITS.item))
      .slice(0, DESIGNER_BRIEF_LIMITS.maxItems);
    return { ...brief, items };
  }
  const cap = DESIGNER_BRIEF_LIMITS[field as Exclude<keyof DesignerBrief, 'items'>] ?? 400;
  const str = Array.isArray(value) ? value.join(', ') : value;
  return { ...brief, [field]: str.slice(0, cap) };
}

/**
 * Build the exact `brief` payload shape the candidates endpoint expects
 * (DesignerGenerateSchema's `brief?: DesignerBriefSchema`). Returns
 * `undefined` when the brief carries no signal (skipped extraction, operator
 * hit "skip", or an all-empty edit) so the server falls back to its own
 * inline extraction exactly as if the confirm step never happened —
 * preserves the fail-open contract end to end.
 */
export function buildDesignerBriefPayload(brief: DesignerBrief | null | undefined): DesignerBrief | undefined {
  if (!designerBriefHasSignal(brief)) return undefined;
  return brief as DesignerBrief;
}
