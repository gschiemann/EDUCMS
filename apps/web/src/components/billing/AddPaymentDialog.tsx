'use client';

/**
 * "Add payment" — one sheet, one choice, one button (2026-10-11).
 *
 * The customer picks Monthly or Annual (Annual is pre-selected and shows the
 * saving), sees exactly what they will pay for the screens they have, and is
 * told WHEN the first charge happens (a card added during the trial bills on
 * the trial's original end date — no lost days). "Continue to secure checkout"
 * opens Stripe Checkout, where the card is entered (never on our pages —
 * PCI SAQ-A) and the screen count can still be changed. Back from Stripe, the
 * Billing page says "You're all set".
 *
 * Shared by the dashboard trial bar, the Billing page and the pairing dialog.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CreditCard, Loader2, Lock, X } from 'lucide-react';
import { dollars, fmtDay, goTo, SALES_EMAIL, startCheckout, type BillingSummary } from './billing-summary';

export function AddPaymentDialog({
  summary,
  onClose,
}: {
  summary: BillingSummary;
  onClose: () => void;
}) {
  const t = useTranslations('billingTrial');
  // A restart keeps the plan they had; everyone else starts on Annual (the saving).
  const [period, setPeriod] = useState<'monthly' | 'annual'>(
    summary.state === 'cancelled' && summary.period ? summary.period : 'annual',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notSetUp, setNotSetUp] = useState(!summary.billingReady);
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const screens = Math.max(1, summary.seatsUsed ?? 0);
  const m = summary.prices.monthlyCents;
  const y = summary.prices.annualCents;
  const saving = m * 12 - y;
  const inTrial = summary.state === 'trial' && !!summary.trialEndsAt;

  const go = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await startCheckout(period);
      if (r.kind === 'redirect') {
        goTo(r.url);
        return;
      }
      setNotSetUp(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed top-0 right-0 bottom-0 left-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-payment-title"
      data-testid="add-payment-dialog"
    >
      <button type="button" className="absolute top-0 right-0 bottom-0 left-0 cursor-default" aria-label={t('dialog.close')} onClick={onClose} />
      <div className="relative z-10 w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 sm:p-6 max-h-[92dvh] overflow-y-auto pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 id="add-payment-title" className="text-[17px] font-semibold text-slate-900 flex items-center gap-2">
            <CreditCard className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} aria-hidden />
            {notSetUp ? t('dialog.notSetUpTitle') : summary.state === 'cancelled' ? t('restart.title') : t('dialog.title')}
          </h2>
          <button type="button" onClick={onClose} aria-label={t('dialog.close')} className="text-slate-400 hover:text-slate-600 -m-1 p-1">
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>

        {/* 2026-10-11 — restarting after the plan ended (view-only): say what
            happened and the three steps before the plan choice. */}
        {summary.state === 'cancelled' && !notSetUp && (
          <div className="mb-4" data-testid="restart-guide">
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[14px] text-red-900">
              <p className="font-medium">{summary.endedForNonPayment ? t('restart.whatHappenedCard') : t('restart.whatHappened')}</p>
              <p className="mt-1">{t('status.stillWorks')}</p>
            </div>
            <ol className="mt-3 space-y-1.5 text-[13px] text-slate-700">
              {[t('restart.step1'), t('restart.step2'), t('restart.step3')].map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-slate-900 text-white text-[11px] font-semibold flex items-center justify-center" aria-hidden>
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {notSetUp ? (
          <>
            <p className="text-[14px] leading-[21px] text-slate-600">{t('dialog.notSetUpBody')}</p>
            <a
              href={`mailto:${SALES_EMAIL}`}
              className="mt-4 w-full min-h-[44px] inline-flex items-center justify-center rounded-xl bg-slate-900 text-white text-[14px] font-semibold"
            >
              {SALES_EMAIL}
            </a>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t('dialog.planLabel')}>
              {(['annual', 'monthly'] as const).map((p, i) => {
                const on = period === p;
                return (
                  <button
                    key={p}
                    ref={i === 0 ? firstRef : undefined}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setPeriod(p)}
                    className={`relative text-left rounded-xl border p-3 min-h-[76px] ${on ? 'border-slate-900 ring-1 ring-slate-900 bg-slate-50' : 'border-slate-200 bg-white'}`}
                  >
                    <span className="block text-[13px] font-semibold text-slate-900">{p === 'annual' ? t('dialog.annual') : t('dialog.monthly')}</span>
                    <span className="block text-[13px] text-slate-600 mt-0.5 tabular-nums">
                      {p === 'annual' ? t('dialog.perScreenYear', { price: dollars(y) }) : t('dialog.perScreenMonth', { price: dollars(m) })}
                    </span>
                    {p === 'annual' && saving > 0 && (
                      <span className="mt-1 inline-block rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold px-2 py-0.5">
                        {t('dialog.saveBadge', { amount: dollars(saving) })}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 text-[13px] text-slate-700" data-testid="add-payment-total">
              <div className="font-medium tabular-nums">
                {period === 'annual'
                  ? t('dialog.totalAnnual', { count: screens, price: dollars(y), total: dollars(y * screens) })
                  : t('dialog.totalMonthly', { count: screens, price: dollars(m), total: dollars(m * screens) })}
              </div>
              <div className="mt-1 text-slate-500">
                {inTrial ? t('dialog.trialKept', { date: fmtDay(summary.trialEndsAt) }) : t('dialog.chargedToday')}
              </div>
              <div className="mt-1 text-slate-500">{t('dialog.adjustNote')}</div>
            </div>

            {error && (
              <p className="mt-3 text-[13px] text-red-600" role="alert">
                {t('dialog.error')} {error}
              </p>
            )}

            <button
              type="button"
              onClick={go}
              disabled={busy}
              className="mt-4 w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-[var(--brand-primary-ink,#fff)] disabled:opacity-60"
              style={{ background: 'var(--brand-primary, #0f172a)' }}
              data-testid="add-payment-continue"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Lock className="w-4 h-4" aria-hidden />}
              {t('dialog.continue')}
            </button>
            <p className="mt-2 text-center text-[12px] text-slate-500">{t('dialog.secure')}</p>
          </>
        )}
      </div>
    </div>
  );
}
