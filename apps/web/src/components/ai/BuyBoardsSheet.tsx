'use client';

/**
 * Buy more AI boards — a small sheet (2026-09-23).
 *
 * Greg: "allow them to buy more generations". The packs come from GET /ai/allowance (boards + price,
 * nothing else to choose); one tap asks the API for a Stripe Checkout session
 * (POST /billing/ai-packs/checkout) and sends the browser there in the SAME tab — exactly how the
 * subscription checkout on Settings → Billing works. Card entry happens on Stripe's page only; the
 * boards are credited by Stripe's verified webhook, and GET /ai/allowance is read again when the
 * operator comes back (Stripe returns them to Settings → Billing).
 *
 * When the API says no pack can be bought right now (`{ enabled: false, reason }` — no platform key,
 * their own key, or Stripe not set up) the sheet says why, in the operator's language. The surfaces
 * that open it only offer "Buy more" when `purchaseEnabled` is true, so that answer means the state
 * changed underneath them.
 *
 * Mobile: a bottom sheet with the house behaviour (`useBottomSheet`: overlay lock, focus trap,
 * Escape, focus restored), rendered into <body> so it sits outside the app root it makes inert.
 * No timers, no polling, no blur.
 */
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useAiAllowance, useBuyAiBoardPack } from '@/hooks/use-api';
import { useBottomSheet } from '@/hooks/use-bottom-sheet';
import { boardsReason, formatUsd } from '@/lib/ai-boards';
import { goToCheckout } from '@/lib/checkout-redirect';

export interface BuyBoardsSheetProps {
  onClose: () => void;
}

export function BuyBoardsSheet({ onClose }: BuyBoardsSheetProps) {
  const t = useTranslations('aiBoards');
  const locale = useLocale();
  const { data: allowance } = useAiAllowance();
  const buy = useBuyAiBoardPack();
  // The pack whose checkout is being opened. It stays set once the browser is on its way to Stripe:
  // the page is leaving, and a second tap must not open a second session.
  const [opening, setOpening] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  useBottomSheet({ open: true, onClose, sheetRef });

  const packs = allowance?.packs ?? [];

  const choose = async (pack: string) => {
    if (opening) return;
    setNotice(null);
    setOpening(pack);
    try {
      const res = await buy.mutateAsync({ pack });
      if (res && 'url' in res && typeof res.url === 'string' && goToCheckout(res.url)) return;
      const why = res && 'enabled' in res ? boardsReason(t, { code: res.reason, text: res.message }) : null;
      setNotice(why ?? t('credits.sheet.failed'));
    } catch {
      setNotice(t('credits.sheet.failed'));
    }
    setOpening(null);
  };

  return createPortal(
    <div className="fixed top-0 right-0 bottom-0 left-0 z-[70] flex items-end justify-center md:items-center md:p-4">
      {/* The scrim closes the sheet (the MobileNavV1 pattern) — outside the focus trap, so the
          keyboard's way out is the Close button or Escape. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('credits.sheet.close')}
        onClick={onClose}
        className="absolute top-0 right-0 bottom-0 left-0 bg-black/50"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="buy-boards-title"
        data-testid="buy-boards-sheet"
        className="relative w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))] md:rounded-2xl md:pb-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="buy-boards-title" className="text-base font-bold text-slate-800">
              {t('credits.sheet.title')}
            </h2>
            <p className="mt-1 text-xs leading-snug text-slate-500">{t('credits.sheet.body')}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('credits.sheet.close')}
            className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <ul className="mt-4 flex flex-col gap-2">
          {packs.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  void choose(p.id);
                }}
                disabled={opening !== null}
                aria-busy={opening === p.id || undefined}
                className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left text-sm font-semibold text-slate-800 transition-colors hover:border-violet-300 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-60 motion-reduce:transition-none"
              >
                <span className="inline-flex items-center gap-2">
                  {opening === p.id && <Loader2 className="h-4 w-4 animate-spin text-violet-600 motion-reduce:animate-none" aria-hidden />}
                  {opening === p.id ? t('credits.sheet.opening') : t('credits.sheet.pack', { count: p.boards })}
                </span>
                <span className="tabular-nums text-slate-600">{formatUsd(p.usd, locale)}</span>
              </button>
            </li>
          ))}
        </ul>
        {notice && (
          <p role="alert" className="mt-3 text-xs font-semibold text-rose-700">
            {notice}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
