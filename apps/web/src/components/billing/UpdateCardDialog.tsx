'use client';

/**
 * "Update card" — the guided path when a card payment fails (2026-10-11,
 * Greg's decision: card failure ends in view-only, WITH HELP).
 *
 *   1  what happened   "Your card was declined on Oct 9. Stripe tries again
 *                       Oct 12." + screens and emergency alerts keep working
 *   2  tap Update card  Stripe's Customer Portal opens straight on "update
 *                       payment method" (card entry is Stripe's page only —
 *                       PCI SAQ-A)
 *   3  back here        the Billing page charges the open invoice with the new
 *                       card and says "You're all set" (BillingStatusCard,
 *                       `?card=updated`)
 *
 * Bottom sheet on a phone, modal on desktop. No polling, no blur.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CreditCard, ExternalLink, Loader2, X } from 'lucide-react';
import { fmtDay, goTo, openPortal, type BillingSummary } from './billing-summary';

export function UpdateCardDialog({ summary, onClose }: { summary: BillingSummary; onClose: () => void }) {
  const t = useTranslations('billingTrial');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const goRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    goRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const go = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await openPortal('update-card');
      if (r.kind === 'redirect') {
        goTo(r.url);
        return;
      }
      setError(t('card.error'));
    } catch {
      setError(t('card.error'));
    } finally {
      setBusy(false);
    }
  };

  const failed = fmtDay(summary.paymentFailedAt);
  const next = fmtDay(summary.nextPaymentAttemptAt);

  return (
    <div
      className="fixed top-0 right-0 bottom-0 left-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-card-title"
      data-testid="update-card-dialog"
    >
      <button type="button" className="absolute top-0 right-0 bottom-0 left-0 cursor-default" aria-label={t('dialog.close')} onClick={onClose} />
      <div className="relative z-10 w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 sm:p-6 max-h-[92dvh] overflow-y-auto pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2 id="update-card-title" className="text-[17px] font-semibold text-slate-900 flex items-center gap-2">
            <CreditCard className="w-5 h-5" style={{ color: 'var(--brand-primary)' }} aria-hidden />
            {t('card.title')}
          </h2>
          <button type="button" onClick={onClose} aria-label={t('dialog.close')} className="text-slate-400 hover:text-slate-600 -m-1 p-1">
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>

        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[14px] text-red-900" data-testid="update-card-what-happened">
          <p className="font-medium">{failed ? t('card.whatHappened', { date: failed }) : t('bar.pastDue')}</p>
          <p className="mt-1">{next ? t('card.nextTry', { date: next }) : t('card.lastTry')}</p>
        </div>
        <p className="mt-3 text-[13px] text-slate-600">{t('status.stillWorks')}</p>

        <ol className="mt-4 space-y-2 text-[14px] text-slate-800" data-testid="update-card-steps">
          {[t('card.step1'), t('card.step2'), t('card.step3')].map((s, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-900 text-white text-[12px] font-semibold flex items-center justify-center" aria-hidden>
                {i + 1}
              </span>
              <span className="pt-0.5">{s}</span>
            </li>
          ))}
        </ol>

        {error && (
          <p className="mt-3 text-[13px] text-red-600" role="alert">
            {error}
          </p>
        )}

        <button
          ref={goRef}
          type="button"
          onClick={go}
          disabled={busy}
          className="mt-5 w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-[var(--brand-primary-ink,#fff)] disabled:opacity-60"
          style={{ background: 'var(--brand-primary, #0f172a)' }}
          data-testid="update-card-continue"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <ExternalLink className="w-4 h-4" aria-hidden />}
          {t('bar.updateCard')}
        </button>
        <p className="mt-2 text-center text-[12px] text-slate-500">{t('dialog.secure')}</p>
      </div>
    </div>
  );
}
