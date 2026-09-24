/**
 * ai-boards.ts — the AI Designer's board CREDITS and board HISTORY, as the dashboard words them
 * (2026-09-23).
 *
 * Greg: "we must cap it and display how many credits they have left … or allow them to buy more
 * generations", and "keep a history of the generated templates so we aren't just throwing away
 * tokens". The hooks live in `@/hooks/use-api`; this file turns their answers into the lines the
 * AI dialog, Settings → AI and the Stripe return show — so every surface says the same thing, and
 * it is testable without mounting any of them (same split as `designer-jobs.ts`).
 *
 *   our key    "14 of 20 boards left this month · resets Oct 1"      (+ Buy more when a pack can be bought)
 *   their key  "Using your own AI key — no board limit"
 *   no key     "AI runs on your own key — add it in Settings → AI provider."
 *
 * "of 20" is everything the month could draw — the boards used plus the boards left — which is the
 * same number the API's 402 calls `cap` (`used + left`), so the line and the refusal never disagree.
 * The reasons are translated from the API's `reasonCode`; the API's own English line is only the
 * fallback for a code this build does not know.
 */
import type {
  AiAllowance,
  AiBoardPackPurchase,
  AiBoardsReasonCode,
  DesignerHistoryItem,
} from '@/hooks/use-api';

type Translate = (key: string, values?: Record<string, string | number>) => string;

const REASON_CODES: readonly AiBoardsReasonCode[] = ['NO_PLATFORM_KEY', 'OWN_KEY', 'STRIPE_NOT_CONFIGURED'];

/**
 * Why boards cannot be bought, in the operator's language (namespace: aiBoards). The allowance
 * carries `{ reasonCode, reason }`; `/billing/ai-packs` carries the same pair as `{ reason, message }`.
 */
export function boardsReason(
  t: Translate,
  why: { code?: string | null; text?: string | null } | null | undefined,
): string | null {
  const code = why?.code;
  if (code && (REASON_CODES as readonly string[]).includes(code)) return t(`credits.reasons.${code}`);
  const text = typeof why?.text === 'string' ? why.text.trim() : '';
  return text || null;
}

/**
 * "Oct 1" — when the month's included boards come back. `resetAt` is the first instant of the next
 * UTC month, so it is named in UTC: in any zone west of Greenwich its local date is the day before.
 */
export function boardsResetDay(resetAt: string, locale: string): string {
  const d = new Date(resetAt);
  if (!resetAt || Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export interface BoardsLine {
  /** The one line. */
  text: string;
  /** On our key with no pack for sale: why not ("Buying more boards isn't set up…"). */
  note: string | null;
  /** A pack can be bought — "Buy more" may be offered. */
  canBuy: boolean;
  /** Our key and no board left: the line reads as a warning. */
  out: boolean;
}

/** GET /ai/allowance → the one line every surface shows (null: nothing to show yet). */
export function boardsLine(t: Translate, locale: string, a: AiAllowance | null | undefined): BoardsLine | null {
  if (!a) return null;
  if (a.source === 'tenant') return { text: t('credits.ownKey'), note: null, canBuy: false, out: false };
  if (a.source === 'none') {
    return {
      text: boardsReason(t, { code: a.reasonCode, text: a.reason }) ?? t('credits.reasons.NO_PLATFORM_KEY'),
      note: null,
      canBuy: false,
      out: false,
    };
  }
  if (a.source !== 'platform' || typeof a.boardsLeft !== 'number' || !Number.isFinite(a.boardsLeft)) return null;
  const left = Math.max(0, Math.floor(a.boardsLeft));
  const used = typeof a.boardsUsed === 'number' && Number.isFinite(a.boardsUsed) ? Math.max(0, Math.floor(a.boardsUsed)) : 0;
  const total = used + left;
  const bought =
    typeof a.boardsPurchasedRemaining === 'number' && Number.isFinite(a.boardsPurchasedRemaining)
      ? Math.max(0, Math.floor(a.boardsPurchasedRemaining))
      : 0;
  const date = boardsResetDay(a.resetAt, locale);
  const text =
    bought > 0
      ? t('credits.leftWithBought', { left, total, bought, date })
      : t('credits.left', { left, total, date });
  const canBuy = a.purchaseEnabled === true;
  return {
    text,
    note: canBuy ? null : boardsReason(t, { code: a.reasonCode, text: a.reason }),
    canBuy,
    out: left === 0,
  };
}

/** "$19" — a pack's price (whole dollars show no cents). */
export function formatUsd(usd: number, locale: string): string {
  const whole = Number.isInteger(usd);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(usd);
  } catch {
    return `$${whole ? usd : usd.toFixed(2)}`;
  }
}

/** "Sep 23, 2026" in the viewer's zone. */
export function formatDay(iso: string, locale: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** One bought pack, for Settings → AI: "30 boards · $19" / "Bought Sep 23, 2026 · 24 left · good until Sep 23, 2027". */
export function packPurchaseLines(
  t: Translate,
  locale: string,
  p: AiBoardPackPurchase,
): { title: string; detail: string } {
  const title = t('credits.card.purchaseTitle', { count: p.boards, price: formatUsd(p.usd, locale) });
  const date = formatDay(p.purchasedAt, locale);
  const until = formatDay(p.expiresAt, locale);
  const detail = p.expired
    ? t('credits.card.purchaseExpired', { date, until })
    : p.remaining > 0
      ? t('credits.card.purchaseActive', { date, left: p.remaining, until })
      : t('credits.card.purchaseUsedUp', { date });
  return { title, detail };
}

// ── the board history ─────────────────────────────────────────────────────────────────────

/**
 * The first line of the batch's brief. The API keeps the first 140 characters of the prompt; a
 * Concierge prompt appends the operator's own chat words after a blank line, so the first line is
 * the brief itself. No prompt at all → the venue's name → '' (the list says "Untitled batch").
 */
export function historyBrief(item: Pick<DesignerHistoryItem, 'prompt' | 'venueName'>): string {
  const first = (item.prompt || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return first || item.venueName?.trim() || '';
}

/** "Sep 20, 12:03 PM" — when the batch was made, in the viewer's zone. */
export function historyWhen(iso: string, locale: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/**
 * A generation refused because there is nothing left to draw it with: the ONE 402 every AI surface
 * uses (`AI_CAP_REACHED` — boards for the Designer, the included AI for everything else).
 */
export function isAiCapError(e: unknown): boolean {
  const x = e as { code?: unknown; status?: unknown } | null | undefined;
  return x?.code === 'AI_CAP_REACHED' || x?.status === 402;
}
