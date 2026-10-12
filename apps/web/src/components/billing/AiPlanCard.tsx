'use client';

/**
 * Settings → Billing → AI (2026-10-12) — is AI on this plan, how much is left, and the ONE button
 * that changes it.
 *
 *   VenueOS + AI (card)    "AI is on your plan"  · boards / images left · [Turn off AI]
 *   VenueOS (card)         "AI isn't on your plan" · $5/screen/month · [Add AI]
 *   free trial             "AI is included in your free trial" · what is left
 *   invoice / PO / comp    on or off as VenueOS set it — "contact your account manager"
 *   AI plan not sold here  nothing to switch (the card says so only when AI is not on)
 *
 * Whatever the plan, your own AI key works (Settings → AI provider) — the card says so.
 * Switching calls POST /billing/ai-plan (Stripe prorates the change onto the next invoice), after
 * a confirm that names the price. One read of the billing summary (shared, cached 10 min) and the
 * allowance the lines already read — no polling (mobile-perf standard).
 */
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2, Sparkles } from 'lucide-react';
import { appAlert, appConfirm } from '@/components/ui/app-dialog';
import { AiBoardsLeft, AiImagesLeft } from '@/components/ai/AiBoardsLeft';
import { useRefreshAiBoards } from '@/hooks/use-api';
import { dollars, setAiPlan, useBillingSummary, useRefreshBillingSummary } from './billing-summary';

export function AiPlanCard() {
  const t = useTranslations('billingAi');
  const params = useParams<{ schoolId?: string | string[] }>();
  const schoolId = Array.isArray(params?.schoolId) ? params.schoolId[0] : params?.schoolId;
  const { data } = useBillingSummary();
  const refreshSummary = useRefreshBillingSummary();
  const refreshAi = useRefreshAiBoards();
  const [busy, setBusy] = useState(false);
  if (!data || (data.state === 'none' && !data.aiPrices)) return null;

  const addon = data.aiAddonMonthlyCents ?? (data.aiPrices ? data.aiPrices.monthlyCents - data.prices.monthlyCents : 500);
  const price = dollars(addon);
  const plan = data.aiPlan ?? (data.aiIncluded ? 'ai' : 'none');
  const offline = data.state === 'offline';
  const liveCard = !!data.cardOnFile && (data.state === 'active' || data.state === 'trial_card' || data.state === 'past_due');
  const canSwitch = data.canManage && data.billingReady && liveCard && !!data.aiPrices;
  const keyHref = schoolId ? `/${schoolId}/settings/ai` : '/settings/ai';

  const toggle = async (on: boolean) => {
    const ok = await appConfirm({
      title: on ? t('confirmOnTitle') : t('confirmOffTitle'),
      message: on ? t('confirmOnBody', { price }) : t('confirmOffBody'),
      confirmLabel: on ? t('addAi', { price }) : t('turnOff'),
      cancelLabel: t('cancel'),
      tone: on ? 'default' : 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await setAiPlan(on);
      if (r?.enabled === false) {
        await appAlert({ title: t('failedTitle'), message: r.message || t('failedBody'), tone: 'info', confirmLabel: t('ok') });
      } else {
        await appAlert({ title: on ? t('doneOnTitle') : t('doneOffTitle'), message: on ? t('doneOnBody') : t('doneOffBody'), tone: 'info', confirmLabel: t('ok') });
      }
    } catch (e) {
      await appAlert({ title: t('failedTitle'), message: e instanceof Error ? e.message : String(e), tone: 'danger', confirmLabel: t('ok') });
    } finally {
      setBusy(false);
      refreshSummary();
      refreshAi();
    }
  };

  const title =
    plan === 'trial' ? t('trialTitle') : plan === 'ai' ? t('onTitle') : t('offTitle');
  const body =
    plan === 'trial'
      ? t('trialBody', { price })
      : plan === 'ai'
        ? t('onBody')
        : offline
          ? t('offOfflineBody')
          : data.aiPrices
            ? t('offBody', { price })
            : t('offNotSoldBody');

  return (
    <div className="rounded-[13px] bg-white border border-slate-200 p-5" data-testid="ai-plan-card" data-plan={plan}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[15px] font-medium text-slate-900">
            <Sparkles className="w-4 h-4 text-violet-600" aria-hidden />
            {title}
          </div>
          <p className="mt-1 text-[13px] leading-[19px] text-slate-600">{body}</p>
          {plan !== 'none' && (
            <div className="mt-2 space-y-1">
              <AiBoardsLeft className="text-[12px]" />
              <AiImagesLeft className="text-[12px]" />
            </div>
          )}
          <p className="mt-2 text-[12px] text-slate-500">
            {t('ownKeyNote')}{' '}
            <Link href={keyHref} className="underline underline-offset-2" style={{ color: 'var(--brand-primary)' }}>
              {t('ownKeyLink')}
            </Link>
          </p>
        </div>
        {canSwitch && plan !== 'trial' && (
          <button
            type="button"
            onClick={() => toggle(plan !== 'ai')}
            disabled={busy}
            data-testid={plan === 'ai' ? 'ai-plan-turn-off' : 'ai-plan-add'}
            className={`inline-flex items-center gap-1.5 min-h-[38px] px-3.5 text-[13px] font-medium rounded-[10px] disabled:opacity-50 ${
              plan === 'ai' ? 'border border-slate-200 text-slate-700 hover:bg-slate-50' : 'bg-violet-600 text-white hover:bg-violet-700'
            }`}
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
            {plan === 'ai' ? t('turnOff') : t('addAi', { price })}
          </button>
        )}
      </div>
    </div>
  );
}
