'use client';

/**
 * Settings → AI: the AI boards card (2026-09-23).
 *
 * The same boards-left line the AI dialog shows (GET /ai/allowance, via `AiBoardsLeft`), "Buy more"
 * when a pack can be bought (the `BuyBoardsSheet` → Stripe Checkout), and the packs this
 * organisation bought — GET /billing/ai-packs → `purchases`, newest first, each with what is left of
 * it and until when. The purchase list shows when there is something in it, or when buying is
 * possible (so "No boards bought yet." sits next to a real Buy more); a tenant on its own key with
 * nothing bought sees just the one line.
 *
 * Admin-only by placement (the page's RoleGate) — the same roles the ai-packs endpoints allow.
 */
import { useState } from 'react';
import { Layers } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useAiAllowance, useAiBoardPacks } from '@/hooks/use-api';
import { packPurchaseLines } from '@/lib/ai-boards';
import { AiBoardsLeft } from '@/components/ai/AiBoardsLeft';
import { BuyBoardsSheet } from '@/components/ai/BuyBoardsSheet';

export function AiBoardsCard() {
  const t = useTranslations('aiBoards');
  const locale = useLocale();
  const allowance = useAiAllowance();
  const packs = useAiBoardPacks();
  const [buying, setBuying] = useState(false);
  const purchases = packs.data?.purchases ?? [];
  const showPurchases = purchases.length > 0 || allowance.data?.purchaseEnabled === true;

  return (
    <section data-testid="ai-boards-card" className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-violet-500" aria-hidden />
        <h2 className="font-bold text-slate-800">{t('credits.card.title')}</h2>
      </div>
      <p className="text-sm text-slate-500">{t('credits.card.description')}</p>
      <AiBoardsLeft onBuy={() => setBuying(true)} className="text-[13px]" />
      {showPurchases && (
        <div className="border-t border-slate-100 pt-3">
          <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{t('credits.card.purchases')}</h3>
          {purchases.length === 0 ? (
            <p className="mt-1.5 text-xs text-slate-500">{t('credits.card.noPurchases')}</p>
          ) : (
            <ul className="mt-1 divide-y divide-slate-100">
              {purchases.map((p) => {
                const line = packPurchaseLines(t, locale, p);
                return (
                  <li key={p.id} data-testid="ai-pack-purchase" className="py-2">
                    <p className={`text-sm font-semibold ${p.expired || p.remaining <= 0 ? 'text-slate-500' : 'text-slate-800'}`}>
                      {line.title}
                    </p>
                    <p className="text-xs text-slate-500">{line.detail}</p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {buying && <BuyBoardsSheet onClose={() => setBuying(false)} />}
    </section>
  );
}
