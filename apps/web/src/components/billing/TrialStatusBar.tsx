'use client';

/**
 * The persistent, friendly trial / billing line under the top toolbar
 * (2026-10-11). Desktop and iPhone. One line, one action:
 *
 *   trial         "12 days left in your free trial · Add payment"   (quiet; hide-for-today)
 *   trial_ended   "Your free trial ended — screens keep playing · Add payment"
 *   locked        "View-only until payment is added — screens and alerts keep working · Add payment"
 *   past_due      "Your last payment didn't go through — Stripe tries again {date} · Update card"
 *                 → UpdateCardDialog: what happened → Update card → Stripe → "You're all set"
 *   cancelled     "Your plan has ended — view-only · Restart plan" (after a card
 *                 failure: "Your card couldn't be charged, so …") → the Add
 *                 payment sheet, which opens with what happened + the 3 steps
 *
 * Nothing renders for a paying customer, an invoice / PO / comp customer, a
 * legacy pilot, or while the summary is unknown. A person who cannot manage
 * billing sees the sentence with "ask an admin" instead of a button.
 *
 * Mobile-perf standard (CLAUDE.md): one cached read (billing-summary.ts, 10 min,
 * never polled), no blur, no animation, no timers.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Clock, X } from 'lucide-react';
import { useBillingSummary, fmtDay } from './billing-summary';
import { AddPaymentDialog } from './AddPaymentDialog';
import { UpdateCardDialog } from './UpdateCardDialog';

const DISMISS_KEY = 'venueos.trialBar.hiddenOn';

function hiddenToday(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === new Date().toDateString();
  } catch {
    return false;
  }
}

export function TrialStatusBar() {
  const t = useTranslations('billingTrial');
  const pathname = usePathname() || '';
  const params = useParams();
  const slug = (params?.schoolId as string) || '';
  const { data } = useBillingSummary();
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => (typeof window === 'undefined' ? false : hiddenToday()));
  const [cardOpen, setCardOpen] = useState(false);

  if (!data) return null;
  // The Billing page has its own, fuller status card.
  if (pathname.endsWith('/settings/billing')) return null;
  const s = data.state;
  if (!['trial', 'trial_ended', 'locked', 'past_due', 'cancelled'].includes(s)) return null;
  const quiet = s === 'trial' && (data.daysLeft ?? 0) > 3;
  if (quiet && dismissed) return null;

  const urgent = s === 'locked' || s === 'past_due' || s === 'cancelled';
  const tone = s === 'trial'
    ? 'bg-white border-slate-200 text-slate-700'
    : urgent
      ? 'bg-red-50 border-red-200 text-red-900'
      : 'bg-amber-50 border-amber-200 text-amber-900';

  const days = data.daysLeft ?? 0;
  const message =
    s === 'trial'
      ? days <= 1
        ? t('bar.trialLastDay', { date: fmtDay(data.trialEndsAt) })
        : t('bar.trialDays', { days })
      : s === 'trial_ended'
        ? data.billingReady
          ? t('bar.trialEnded', { date: fmtDay(data.graceEndsAt) })
          : t('bar.trialEndedNotSetUp')
        : s === 'locked'
          ? t('bar.locked')
          : s === 'past_due'
            ? data.nextPaymentAttemptAt
              ? t('bar.pastDueNext', { date: fmtDay(data.nextPaymentAttemptAt) })
              : t('bar.pastDue')
            : data.endedForNonPayment
              ? t('bar.cancelledNonPayment')
              : t('bar.cancelled');

  let action: React.ReactNode = null;
  if (!data.canManage) {
    action = <span className="text-[12px] opacity-80">{t('bar.askAdmin')}</span>;
  } else if (s === 'past_due') {
    // 2026-10-11 — the guided path: what happened → Update card → Stripe → "You're all set".
    action = (
      <button
        type="button"
        onClick={() => setCardOpen(true)}
        data-testid="trial-bar-update-card"
        className="font-semibold underline underline-offset-2 whitespace-nowrap min-h-[32px]"
      >
        {t('bar.updateCard')}
      </button>
    );
  } else if (data.billingReady) {
    action = (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-semibold underline underline-offset-2 whitespace-nowrap min-h-[32px]"
        data-testid="trial-bar-add-payment"
      >
        {s === 'cancelled' ? t('bar.restartPlan') : t('bar.addPayment')}
      </button>
    );
  } else if (slug) {
    action = (
      <Link href={`/${slug}/settings/billing`} className="font-semibold underline underline-offset-2 whitespace-nowrap">
        {t('bar.details')}
      </Link>
    );
  }

  const hideForToday = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, new Date().toDateString());
    } catch {
      /* per-viewer convenience only */
    }
    setDismissed(true);
  };

  return (
    <>
      <div
        className={`flex items-center gap-2 border-b px-4 sm:px-6 md:px-8 py-2 text-[13px] leading-[18px] ${tone}`}
        role={urgent ? 'alert' : 'status'}
        data-testid="trial-status-bar"
        data-state={s}
      >
        {s === 'trial' ? <Clock className="w-4 h-4 flex-shrink-0 opacity-70" aria-hidden /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden />}
        <p className="min-w-0 flex-1">
          <span>{message}</span>
          {action && <span className="mx-1.5 opacity-50" aria-hidden>·</span>}
          {action}
        </p>
        {quiet && (
          <button type="button" onClick={hideForToday} aria-label={t('bar.hideToday')} className="p-1 -m-1 opacity-60 hover:opacity-100">
            <X className="w-4 h-4" aria-hidden />
          </button>
        )}
      </div>
      {open && <AddPaymentDialog summary={data} onClose={() => setOpen(false)} />}
      {cardOpen && <UpdateCardDialog summary={data} onClose={() => setCardOpen(false)} />}
    </>
  );
}
