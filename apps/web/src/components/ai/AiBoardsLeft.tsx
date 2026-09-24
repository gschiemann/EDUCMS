'use client';

/**
 * How many AI boards are left — ONE line, the same everywhere (2026-09-23).
 *
 * Greg: "we must cap it and display how many credits they have left". On our AI key the Designer is
 * sold in BOARDS (apps/api/src/ai/ai-board-credits.ts), so the AI dialog (right under Generate),
 * Settings → AI and the Stripe return all show this line, from GET /ai/allowance:
 *
 *   our key    "14 of 20 boards left this month · resets Oct 1"   [Buy more]
 *   their key  "Using your own AI key — no board limit"
 *   no key     "AI runs on your own key — add it in Settings → AI provider."
 *
 * "Buy more" is offered only when the API says a pack can be bought (`purchaseEnabled`) and the
 * surface can open the pack sheet (`onBuy`); when a pack cannot be bought the line says why
 * instead. Nothing renders until the answer is in, or when it fails: this line informs, it must
 * never stand between the operator and Generate.
 *
 * `AiCapActions` is what a refused generation (the 402 `AI_CAP_REACHED`) offers under the dialog's
 * inline error: Buy more boards (when a pack can be bought) and Add your own AI key.
 *
 * No timers, no polling, no blur — the allowance hook refetches only on mount, on return to the
 * tab, and when something that spends boards finishes (mobile-perf standard).
 */
import Link from 'next/link';
import { KeyRound, ShoppingCart } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useAiAllowance } from '@/hooks/use-api';
import { boardsLine } from '@/lib/ai-boards';

export interface AiBoardsLeftProps {
  /** Opens the pack sheet. Without it the line never offers "Buy more". */
  onBuy?: () => void;
  className?: string;
}

export function AiBoardsLeft({ onBuy, className = '' }: AiBoardsLeftProps) {
  const t = useTranslations('aiBoards');
  const locale = useLocale();
  const { data } = useAiAllowance();
  const line = boardsLine(t, locale, data);
  if (!line) return null;
  return (
    <div
      data-testid="ai-boards-left"
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${
        line.out ? 'font-semibold text-amber-700' : 'text-slate-500'
      } ${className}`}
    >
      <span>{line.text}</span>
      {line.note && <span className="font-normal text-slate-400">{line.note}</span>}
      {line.canBuy && onBuy && (
        <button
          type="button"
          onClick={onBuy}
          className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs font-bold text-violet-700 underline-offset-2 transition-colors hover:bg-violet-50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-8 motion-reduce:transition-none"
        >
          <ShoppingCart className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('credits.buyMore')}
        </button>
      )}
    </div>
  );
}

export interface AiCapActionsProps {
  /** A pack can be bought right now (the allowance's `purchaseEnabled` on our key). */
  canBuy: boolean;
  onBuy: () => void;
  /** Settings → AI provider for this school. */
  keyHref: string;
}

export function AiCapActions({ canBuy, onBuy, keyHref }: AiCapActionsProps) {
  const t = useTranslations('aiBoards');
  return (
    <div data-testid="ai-cap-actions" className="flex flex-wrap items-center gap-2">
      {canBuy && (
        <button
          type="button"
          onClick={onBuy}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 sm:min-h-9 motion-reduce:transition-none"
        >
          <ShoppingCart className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('credits.capBuyMore')}
        </button>
      )}
      <Link
        href={keyHref}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-9 motion-reduce:transition-none"
      >
        <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {t('credits.capAddKey')}
      </Link>
    </div>
  );
}
