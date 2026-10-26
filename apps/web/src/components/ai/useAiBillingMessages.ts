"use client";

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DEFAULT_AI_ADDON_CENTS, formatCents } from '@/lib/ai-plan';

/**
 * The two billing sentences every AI surface can answer a refused request
 * with, in the reader's language (2026-10-24 — these were the English-only
 * `AI_PLAN_REQUIRED_EN` and a hard-coded "included AI is used up" line on
 * inline rewrite, board translate and the signage concierge):
 *
 *   planRequired — the 402 `AI_PLAN_REQUIRED` (AI is not on this plan)
 *   capReached   — the 402 `AI_CAP_REACHED` (this month's included AI is used up)
 *
 * Same wording as `AiPlanUpsell` (`aiPlan.upsell.body`), so a refusal reads
 * the same everywhere.
 */
export function useAiBillingMessages(addonCents?: number | null) {
  const t = useTranslations('aiPlan');
  const locale = useLocale();
  return useMemo(
    () => ({
      planRequired: t('upsell.body', {
        price: formatCents(typeof addonCents === 'number' && addonCents > 0 ? addonCents : DEFAULT_AI_ADDON_CENTS, locale),
      }),
      capReached: t('limit.month'),
    }),
    [t, locale, addonCents],
  );
}

export type AiBillingMessages = ReturnType<typeof useAiBillingMessages>;
