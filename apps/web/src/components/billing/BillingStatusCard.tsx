'use client';

/**
 * The top of Settings → Billing for a self-serve (card) customer (2026-10-11):
 * where they stand and the one button that moves them forward.
 *
 *   back from Stripe   "You're all set" — billing starts {date} (trial kept) /
 *                      plan active. If Stripe's webhook has not landed yet,
 *                      "Finishing up…" and ONE re-read a few seconds later
 *                      (a point-in-time check, never a poll).
 *   trial              days left, screens used, [Add payment]
 *   trial_card         card saved, first charge on {date}
 *   trial_ended/locked what still works, what is paused, [Add payment]
 *   past_due           [Update card] (Stripe Customer Portal)
 *   cancelled          [Restart plan]
 *
 * Renders nothing for invoice / PO / comp (the page shows their own card),
 * legacy pilots and paying customers with nothing to say.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, CheckCircle2, Clock, CreditCard, ExternalLink, Loader2 } from 'lucide-react';
import { AddPaymentDialog } from './AddPaymentDialog';
import { dollars, fmtDay, goTo, openPortal, useBillingSummary, useRefreshBillingSummary } from './billing-summary';

const RECHECK_MS = 4_000;

export function BillingStatusCard({ returnedFromCheckout }: { returnedFromCheckout: boolean }) {
  const t = useTranslations('billingTrial');
  const { data } = useBillingSummary();
  const refresh = useRefreshBillingSummary();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Back from Stripe: the webhook lands a few seconds after the redirect — read once more.
  useEffect(() => {
    if (!returnedFromCheckout) return;
    refresh();
    const once = window.setTimeout(refresh, RECHECK_MS);
    return () => window.clearTimeout(once);
  }, [returnedFromCheckout, refresh]);

  if (!data) return null;
  const s = data.state;

  const portal = async () => {
    setBusy(true);
    try {
      const r = await openPortal();
      if (r.kind === 'redirect') goTo(r.url);
    } finally {
      setBusy(false);
    }
  };

  const primary = (label: string, onClick: () => void, testId: string, icon: React.ReactNode = <CreditCard className="w-4 h-4" aria-hidden />) =>
    data.canManage ? (
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="mt-3 inline-flex items-center justify-center gap-2 min-h-[44px] w-full sm:w-auto px-5 rounded-xl text-[14px] font-semibold text-[var(--brand-primary-ink,#fff)] disabled:opacity-60"
        style={{ background: 'var(--brand-primary, #0f172a)' }}
        data-testid={testId}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : icon}
        {label}
      </button>
    ) : (
      <p className="mt-2 text-[13px] font-medium">{t('bar.askAdmin')}</p>
    );

  let body: React.ReactNode = null;
  let tone = 'border-slate-200 bg-white text-slate-800';

  if (returnedFromCheckout && (s === 'trial_card' || s === 'active')) {
    tone = 'border-emerald-200 bg-emerald-50 text-emerald-900';
    body = (
      <div className="flex items-start gap-3" data-testid="billing-all-set">
        <CheckCircle2 className="w-6 h-6 flex-shrink-0 text-emerald-600" aria-hidden />
        <div>
          <p className="text-[17px] font-semibold">{t('status.allSetTitle')}</p>
          <p className="mt-1 text-[14px]">
            {s === 'trial_card' ? t('status.allSetTrial', { date: fmtDay(data.trialEndsAt) }) : t('status.allSetActive')}
          </p>
        </div>
      </div>
    );
  } else if (returnedFromCheckout && (s === 'trial' || s === 'trial_ended' || s === 'locked' || s === 'none')) {
    body = (
      <div className="flex items-center gap-3" data-testid="billing-finishing">
        <Loader2 className="w-5 h-5 animate-spin text-slate-400" aria-hidden />
        <p className="text-[14px]">{t('status.finishing')}</p>
      </div>
    );
  } else if (s === 'trial') {
    const days = data.daysLeft ?? 0;
    body = (
      <div data-testid="billing-status-trial">
        <div className="flex items-center gap-2 text-[17px] font-semibold">
          <Clock className="w-5 h-5 opacity-70" aria-hidden />
          {days <= 1 ? t('bar.trialLastDay', { date: fmtDay(data.trialEndsAt) }) : t('bar.trialDays', { days })}
        </div>
        <p className="mt-1 text-[14px] text-slate-600">
          {t('status.trialBody', {
            date: fmtDay(data.trialEndsAt),
            used: data.seatsUsed ?? 0,
            limit: data.seatLimit ?? 3,
          })}
        </p>
        <p className="mt-1 text-[13px] text-slate-500">
          {t('status.prices', { monthly: dollars(data.prices.monthlyCents), annual: dollars(data.prices.annualCents) })}
        </p>
        {data.billingReady ? primary(t('bar.addPayment'), () => setOpen(true), 'billing-add-payment') : null}
      </div>
    );
  } else if (s === 'trial_card') {
    body = (
      <div className="flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 flex-shrink-0 text-emerald-600" aria-hidden />
        <p className="text-[14px]">{t('status.allSetTrial', { date: fmtDay(data.trialEndsAt) })}</p>
      </div>
    );
  } else if (s === 'trial_ended' || s === 'locked' || s === 'cancelled') {
    tone = s === 'trial_ended' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-900';
    body = (
      <div data-testid={`billing-status-${s}`}>
        <div className="flex items-center gap-2 text-[16px] font-semibold">
          <AlertTriangle className="w-5 h-5" aria-hidden />
          {s === 'trial_ended' ? t('status.trialEndedTitle') : s === 'locked' ? t('status.lockedTitle') : t('status.cancelledTitle')}
        </div>
        <p className="mt-1 text-[14px]">{t('status.stillWorks')}</p>
        <p className="mt-1 text-[14px]">
          {s === 'trial_ended'
            ? data.billingReady
              ? t('status.trialEndedLimits', { date: fmtDay(data.graceEndsAt) })
              : t('bar.trialEndedNotSetUp')
            : t('status.lockedLimits')}
        </p>
        {data.billingReady
          ? primary(s === 'cancelled' ? t('bar.restartPlan') : t('bar.addPayment'), () => setOpen(true), 'billing-add-payment')
          : null}
      </div>
    );
  } else if (s === 'past_due') {
    tone = 'border-red-200 bg-red-50 text-red-900';
    body = (
      <div data-testid="billing-status-past_due">
        <div className="flex items-center gap-2 text-[16px] font-semibold">
          <AlertTriangle className="w-5 h-5" aria-hidden />
          {t('bar.pastDue')}
        </div>
        <p className="mt-1 text-[14px]">{t('status.pastDueBody')}</p>
        {primary(t('bar.updateCard'), portal, 'billing-update-card', <ExternalLink className="w-4 h-4" aria-hidden />)}
      </div>
    );
  }

  if (!body) return null;
  return (
    <>
      <div className={`mb-5 rounded-[13px] border px-4 py-4 sm:px-5 ${tone}`} role="status" data-testid="billing-status-card" data-state={s}>
        {body}
      </div>
      {open && <AddPaymentDialog summary={data} onClose={() => setOpen(false)} />}
    </>
  );
}
