'use client';

/**
 * Pairing hit a billing limit → one tap fixes it, inline (2026-10-11).
 *
 *   LICENSE_EXHAUSTED + canAddSeat   card plan is full → "Add 1 screen
 *                                    ($25/mo, prorated) and pair" → POST
 *                                    /billing/seats { add: 1 } → retry the pair
 *   LICENSE_EXHAUSTED + canUpgrade   trial's 3 screens used → "Add payment"
 *   TRIAL_ENDED                      trial over → "Add payment"
 *
 * Anything else returns null and the caller shows its usual error text. A
 * person who cannot manage billing is told to ask an admin.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CreditCard, Loader2, Plus } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { AddPaymentDialog } from './AddPaymentDialog';
import { dollars, planPrices, useBillingSummary, useRefreshBillingSummary } from './billing-summary';

export interface PairBillingError {
  code?: string;
  body?: { canAddSeat?: boolean; canUpgrade?: boolean; seatLimit?: number; perScreenMonthlyCents?: number | null };
}

export function isPairBillingError(e: PairBillingError | null | undefined): boolean {
  if (!e) return false;
  if (e.code === 'TRIAL_ENDED') return true;
  return e.code === 'LICENSE_EXHAUSTED' && !!(e.body?.canAddSeat || e.body?.canUpgrade);
}

export function SeatLimitNotice({ error, onRetry }: { error: PairBillingError; onRetry: () => void | Promise<void> }) {
  const t = useTranslations('billingTrial');
  const { data: summary } = useBillingSummary();
  const refresh = useRefreshBillingSummary();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [payOpen, setPayOpen] = useState(false);

  if (!isPairBillingError(error)) return null;
  const canManage = summary?.canManage !== false;
  const addSeat = error.code === 'LICENSE_EXHAUSTED' && !!error.body?.canAddSeat;

  const add = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await apiFetch<{ enabled?: boolean; message?: string }>('/billing/seats', { method: 'POST', body: JSON.stringify({ add: 1 }) });
      if (r?.enabled === false) {
        setMsg(r.message || t('pair.failed'));
        return;
      }
      refresh();
      await onRetry();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const annual = summary?.period === 'annual';
  // 2026-10-12 — a screen costs what the customer's plan costs: VenueOS or VenueOS + AI.
  const prices = summary ? planPrices(summary, !!summary.aiIncluded) : null;
  const price = annual
    ? t('pair.pricePerYear', { price: dollars(prices?.annualCents ?? 20000) })
    : t('pair.pricePerMonth', { price: dollars(error.body?.perScreenMonthlyCents || prices?.monthlyCents || 2000) });

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900" data-testid="seat-limit-notice">
      <p className="font-semibold">
        {addSeat
          ? t('pair.planFullTitle', { count: error.body?.seatLimit ?? 0 })
          : error.code === 'TRIAL_ENDED'
            ? t('pair.trialEndedTitle')
            : t('pair.trialFullTitle', { count: error.body?.seatLimit ?? 3 })}
      </p>
      <p className="mt-1">
        {addSeat ? t('pair.planFullBody', { price }) : error.code === 'TRIAL_ENDED' ? t('pair.trialEndedBody') : t('pair.trialFullBody')}
      </p>
      {!canManage ? (
        <p className="mt-2 font-medium">{t('bar.askAdmin')}</p>
      ) : addSeat ? (
        <button
          type="button"
          onClick={add}
          disabled={busy}
          className="mt-3 w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 text-white font-semibold disabled:opacity-60"
          data-testid="seat-add-and-pair"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Plus className="w-4 h-4" aria-hidden />}
          {t('pair.addAndPair', { price })}
        </button>
      ) : summary ? (
        <button
          type="button"
          onClick={() => setPayOpen(true)}
          className="mt-3 w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 text-white font-semibold"
          data-testid="seat-add-payment"
        >
          <CreditCard className="w-4 h-4" aria-hidden />
          {t('bar.addPayment')}
        </button>
      ) : null}
      {msg && (
        <p className="mt-2 text-red-700" role="alert">
          {msg}
        </p>
      )}
      {payOpen && summary && <AddPaymentDialog summary={summary} onClose={() => setPayOpen(false)} />}
    </div>
  );
}
