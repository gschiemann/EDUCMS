'use client';

/**
 * "AI isn't on your plan" — ONE upsell, the same on every AI surface (2026-10-12).
 *
 * Owner decision: VenueOS is $20/screen/month, VenueOS + AI $25. AI on VenueOS's own keys needs
 * the AI plan (or a free trial); an organisation without it sees this instead of a dead button:
 *
 *   AI isn't on your plan
 *   Add VenueOS AI for $5/screen/month — or connect your own AI key for free (Settings → AI).
 *   [Add AI to my plan]  [Connect my own AI key (free)]
 *
 * "Add AI" goes to Settings → Billing (the plans, where the AI option lives); "own key" to
 * Settings → AI provider. Static: no fetch of its own beyond the allowance the surface already
 * reads, no timers, no blur (mobile-perf standard).
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { KeyRound, Sparkles } from 'lucide-react';
import { billingPlansHref, formatCents, DEFAULT_AI_ADDON_CENTS } from '@/lib/ai-plan';

export interface AiPlanUpsellProps {
  /** The add-on price in cents (the API's `aiAddonMonthlyCents`); defaults to $5. */
  addonCents?: number | null;
  /** One line + links (inline under a button) instead of the card. */
  compact?: boolean;
  className?: string;
}

export function AiPlanUpsell({ addonCents, compact = false, className = '' }: AiPlanUpsellProps) {
  const t = useTranslations('aiPlan');
  const locale = useLocale();
  const params = useParams<{ schoolId?: string | string[] }>();
  const schoolId = Array.isArray(params?.schoolId) ? params.schoolId[0] : params?.schoolId;
  const price = formatCents(typeof addonCents === 'number' && addonCents > 0 ? addonCents : DEFAULT_AI_ADDON_CENTS, locale);
  const keyHref = schoolId ? `/${schoolId}/settings/ai` : '/settings/ai';

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Link
        href={billingPlansHref(schoolId)}
        data-testid="ai-plan-upsell-add"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-bold text-white shadow-sm transition-colors hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-1 sm:min-h-9 motion-reduce:transition-none"
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {t('upsell.addAi', { price })}
      </Link>
      <Link
        href={keyHref}
        data-testid="ai-plan-upsell-own-key"
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 sm:min-h-9 motion-reduce:transition-none"
      >
        <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {t('upsell.ownKey')}
      </Link>
    </div>
  );

  if (compact) {
    return (
      <div data-testid="ai-plan-upsell" className={`flex flex-col gap-2 ${className}`}>
        <p className="text-xs text-slate-600">{t('upsell.body', { price })}</p>
        {actions}
      </div>
    );
  }
  return (
    <div data-testid="ai-plan-upsell" className={`rounded-xl border border-violet-200 bg-violet-50/60 p-4 ${className}`}>
      <p className="text-sm font-semibold text-slate-900">{t('upsell.title')}</p>
      <p className="mt-1 text-sm text-slate-600">{t('upsell.body', { price })}</p>
      <p className="mt-1 text-xs text-slate-500">{t('upsell.ownKeyNote')}</p>
      <div className="mt-3">{actions}</div>
    </div>
  );
}
