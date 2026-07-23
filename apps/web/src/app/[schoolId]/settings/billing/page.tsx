'use client';

/**
 * /[schoolId]/settings/billing — the admin billing dashboard.
 *
 * Screens metered, current plan + status, monthly cost, billing
 * period, invoice history, and one-click "Manage billing" into the
 * Stripe Customer Portal. "Choose a plan" hands off to Stripe-hosted
 * Checkout — a card number never touches our UI (PCI-SAQ-A).
 *
 * Degrades gracefully when Stripe isn't configured on the deploy: the
 * page still shows usage + plan from the License, and the pay actions
 * explain that online payments aren't set up yet.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';
import {
  ArrowLeft,
  CreditCard,
  CheckCircle2,
  Loader2,
  Star,
  ExternalLink,
  FileText,
  Monitor,
  AlertCircle,
} from 'lucide-react';
import { appAlert } from '@/components/ui/app-dialog';

interface CurrentLicense {
  tier: string;
  tierName?: string;
  seatLimit: number | null;
  seatsUsed?: number;
  currentSeats?: number;
  status: string;
  monthlyPriceCents?: number | null;
  currentPeriodEnd?: string | null;
  expiresAt?: string | null;
  isPilot?: boolean;
}
interface TierCard {
  id: string;
  name: string;
  blurb: string;
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
  features: string[];
  recommended: boolean;
}
interface Invoice {
  id: string;
  number: string | null;
  status: string | null;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  created: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

const fmtCents = (c: number | null | undefined) =>
  c == null
    ? '—'
    : `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtWhole = (c: number | null) =>
  c == null ? "Custom" : c === 0 ? "Free" : `$${Math.round(c / 100)}`;
const fmtDate = (d: string | number | null | undefined) => {
  if (d == null) return '—';
  const date = typeof d === 'number' ? new Date(d * 1000) : new Date(d);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

export default function BillingPage() {
  const t = useTranslations();
  const params = useParams();
  const schoolId = params?.schoolId as string;
  // Post-Checkout return flag — read client-side so the page needs no
  // useSearchParams Suspense boundary.
  const [checkoutResult, setCheckoutResult] = useState<string | null>(null);
  useEffect(() => {
    setCheckoutResult(new URLSearchParams(window.location.search).get('checkout'));
  }, []);

  const license = useQuery<CurrentLicense | null>({
    queryKey: ['license', 'current'],
    queryFn: () => apiFetch<CurrentLicense | null>('/license/current').catch(() => null),
  });
  const tiers = useQuery<TierCard[]>({
    queryKey: ['license', 'tiers'],
    queryFn: () => apiFetch<TierCard[]>('/license/tiers').catch(() => []),
  });
  const invoices = useQuery<{ stripeEnabled: boolean; invoices: Invoice[] }>({
    queryKey: ['billing', 'invoices'],
    queryFn: () =>
      apiFetch<{ stripeEnabled: boolean; invoices: Invoice[] }>('/billing/invoices').catch(() => ({
        stripeEnabled: false,
        invoices: [],
      })),
  });

  const [busy, setBusy] = useState<string | null>(null);

  const startCheckout = async (period: 'monthly' | 'annual') => {
    setBusy(period);
    try {
      const res: any = await apiFetch('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ billingPeriod: period }),
      });
      if (res?.url) {
        window.location.href = res.url;
        return;
      }
      if (res?.enabled === false) {
        await appAlert({
          title: t('billingCommerce.onlinePaymentsNotSetUpTitle'),
          message:
            res.message ||
            t('billingCommerce.cardBillingNotConfigured'),
          tone: 'info',
          confirmLabel: t('billingCommerce.ok'),
        });
      }
    } catch (e) {
      await appAlert({
        title: t('billingCommerce.couldntStartCheckout'),
        message: e instanceof Error ? e.message : String(e),
        tone: 'danger',
        confirmLabel: t('billingCommerce.ok'),
      });
    } finally {
      setBusy(null);
    }
  };

  const manageBilling = async () => {
    setBusy('portal');
    try {
      const res: any = await apiFetch('/billing/portal', { method: 'POST' });
      if (res?.url) {
        window.location.href = res.url;
        return;
      }
      if (res?.noSubscription) {
        await appAlert({
          title: t('billingCommerce.noSubscriptionYet'),
          message: t('billingCommerce.choosePlanToStart'),
          tone: 'info',
          confirmLabel: t('billingCommerce.ok'),
        });
      } else if (res?.enabled === false) {
        await appAlert({
          title: t('billingCommerce.onlinePaymentsNotSetUpTitle'),
          message: res.message || t('billingCommerce.contactSalesManageBilling'),
          tone: 'info',
          confirmLabel: t('billingCommerce.ok'),
        });
      }
    } catch (e) {
      await appAlert({
        title: t('billingCommerce.couldntOpenBilling'),
        message: e instanceof Error ? e.message : String(e),
        tone: 'danger',
        confirmLabel: t('billingCommerce.ok'),
      });
    } finally {
      setBusy(null);
    }
  };

  const lic = license.data;
  const screens = lic?.seatsUsed ?? lic?.currentSeats ?? 0;
  const hasPaidPlan = !!lic && !lic.isPilot && lic.tier !== 'PILOT';

  // 2026-05-25 — header swapped from a fat green-→-sky gradient
  // hero to the clean max-w / contained header pattern that every
  // other settings sub-page uses. Operator: "update the colors to
  // match our purple gradient that we have not blue." Brand
  // consistency: indigo / violet across all chrome, not the
  // teal/emerald/sky palette this page was the only holdout for.
  return (
    <div className="space-y-6 max-w-5xl mx-auto px-4 py-6">
      <header>
        <Link
          href={`/${schoolId}/settings`}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-indigo-600 mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> {t('billingCommerce.settings')}
        </Link>
        <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
          <CreditCard className="w-6 h-6 text-indigo-500" /> {t('billingCommerce.billingUsageTitle')}
        </h1>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          {t('billingCommerce.billingUsageSubtitle')}
        </p>
      </header>

      {checkoutResult === 'success' && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>
            <strong>{t('billingCommerce.subscriptionStarted')}</strong> {t('billingCommerce.subscriptionStartedDetail')}
          </span>
        </div>
      )}
      {checkoutResult === 'cancelled' && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{t('billingCommerce.checkoutCancelled')}</span>
        </div>
      )}

      {/* Current plan + usage */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
          {t('billingCommerce.currentPlanUsage')}
        </h2>
        {license.isLoading ? (
          <CardSpinner />
        ) : (
          <CurrentPlanCard
            license={lic}
            screens={screens}
            onManage={manageBilling}
            managing={busy === 'portal'}
            hasPaidPlan={hasPaidPlan}
          />
        )}
      </section>

      {/* Invoices */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
          {t('billingCommerce.invoices')}
        </h2>
        {invoices.isLoading ? (
          <CardSpinner />
        ) : (
          <InvoicesCard data={invoices.data} />
        )}
      </section>

      {/* Plans */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
          {hasPaidPlan ? t('billingCommerce.changePlan') : t('billingCommerce.plans')}
        </h2>
        {tiers.isLoading ? (
          <CardSpinner />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(tiers.data || []).map((tier) => (
              <TierTile
                key={tier.id}
                tier={tier}
                currentTier={lic?.tier}
                busy={busy}
                onChoose={startCheckout}
              />
            ))}
          </div>
        )}
      </section>

      <div className="text-[11px] text-slate-400 leading-relaxed pt-4 border-t border-slate-100">
        {t('billingCommerce.pricingFooter')} <a href="mailto:sales@venueos.app" className="text-indigo-600 hover:underline">sales@venueos.app</a>.
      </div>
    </div>
  );
}

function CardSpinner() {
  return (
    <div className="flex justify-center py-6">
      <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
    </div>
  );
}

function CurrentPlanCard({
  license,
  screens,
  onManage,
  managing,
  hasPaidPlan,
}: {
  license: CurrentLicense | null | undefined;
  screens: number;
  onManage: () => void;
  managing: boolean;
  hasPaidPlan: boolean;
}) {
  const t = useTranslations();
  const status = license?.status || 'ACTIVE';
  const statusColor =
    status === 'ACTIVE'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : status === 'PAST_DUE'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-rose-50 text-rose-700 border-rose-200';
  const perScreen = license?.monthlyPriceCents ?? null;
  const monthlyCost = perScreen != null ? screens * perScreen : null;
  const seatLimit = license?.seatLimit ?? null;
  const seatPct =
    seatLimit && seatLimit > 0 ? Math.min(100, (screens / seatLimit) * 100) : null;
  const renews = license?.currentPeriodEnd || license?.expiresAt || null;

  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg font-bold text-slate-800">
              {license?.tierName || license?.tier || t('billingCommerce.freePilot')}
            </span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider ${statusColor}`}
            >
              {status}
            </span>
          </div>
          <div className="text-sm text-slate-500">
            {monthlyCost != null ? (
              <>
                <strong className="text-slate-700">{fmtCents(monthlyCost)}</strong> {t('billingCommerce.perMonth')}
                <span className="text-slate-400">
                  {' '}
                  {t('billingCommerce.screensTimesPrice', { count: screens, price: fmtCents(perScreen) })}
                </span>
              </>
            ) : (
              <>{t('billingCommerce.noChargeFreePilot')}</>
            )}
          </div>
        </div>
        {hasPaidPlan && (
          <button
            onClick={onManage}
            disabled={managing}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-bold rounded-lg bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {managing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
            {t('billingCommerce.manageBilling')}
          </button>
        )}
      </div>

      {/* metrics strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 border-t border-slate-100 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
        <Metric
          icon={<Monitor className="w-4 h-4 text-indigo-500" />}
          label={t('billingCommerce.screensInUse')}
          value={
            seatLimit ? (
              <>
                {screens} <span className="text-slate-400 font-medium">/ {seatLimit}</span>
              </>
            ) : (
              <>{screens}</>
            )
          }
          sub={
            seatPct != null ? (
              <div className="w-full h-1.5 bg-slate-100 rounded-full mt-1.5 overflow-hidden">
                {/* 2026-05-25 — usage-bar color flipped from emerald to
                    indigo/violet gradient so the page reads as one
                    brand palette. */}
                <div className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full" style={{ width: `${seatPct}%` }} />
              </div>
            ) : (
              <span className="text-[11px] text-slate-400">{t('billingCommerce.pairedDisplays')}</span>
            )
          }
        />
        <Metric
          icon={<CreditCard className="w-4 h-4 text-indigo-500" />}
          label={t('billingCommerce.thisMonth')}
          value={monthlyCost != null ? fmtCents(monthlyCost) : t('billingCommerce.free')}
          sub={<span className="text-[11px] text-slate-400">{t('billingCommerce.billedPerScreen')}</span>}
        />
        <Metric
          icon={<Star className="w-4 h-4 text-amber-500" />}
          label={status === 'ACTIVE' ? t('billingCommerce.renews') : t('billingCommerce.periodEnds')}
          value={<span className="text-base">{fmtDate(renews)}</span>}
          sub={<span className="text-[11px] text-slate-400">{hasPaidPlan ? t('billingCommerce.autoRenews') : t('billingCommerce.noBillingDate')}</span>}
        />
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  sub,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  sub: ReactNode;
}) {
  return (
    <div className="p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className="text-xl font-extrabold text-slate-800 mt-1 tabular-nums">{value}</div>
      {sub}
    </div>
  );
}

function InvoicesCard({ data }: { data?: { stripeEnabled: boolean; invoices: Invoice[] } }) {
  const t = useTranslations();
  const list = data?.invoices || [];
  if (list.length === 0) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 p-6 text-center">
        <FileText className="w-6 h-6 text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-500">
          {t('billingCommerce.noInvoicesYet')}
          <span className="text-slate-400">
            {' '}
            {t('billingCommerce.invoicesAppearAutomatically')}
          </span>
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
            <th className="text-left px-4 py-2.5">{t('billingCommerce.date')}</th>
            <th className="text-left px-4 py-2.5">{t('billingCommerce.invoice')}</th>
            <th className="text-right px-4 py-2.5">{t('billingCommerce.amount')}</th>
            <th className="text-left px-4 py-2.5">{t('billingCommerce.status')}</th>
            <th className="text-right px-4 py-2.5">{t('billingCommerce.download')}</th>
          </tr>
        </thead>
        <tbody>
          {list.map((inv) => {
            const amount = inv.amountPaidCents || inv.amountDueCents;
            const paid = (inv.status || '').toLowerCase() === 'paid';
            return (
              <tr key={inv.id} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-2.5 text-slate-600">{fmtDate(inv.created)}</td>
                <td className="px-4 py-2.5 font-medium text-slate-700">{inv.number || inv.id}</td>
                <td className="px-4 py-2.5 text-right font-bold text-slate-800 tabular-nums">
                  {fmtCents(amount)}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider ${
                      paid
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border-amber-200'
                    }`}
                  >
                    {inv.status || 'open'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {inv.hostedInvoiceUrl && (
                    <a
                      href={inv.hostedInvoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:underline font-semibold mr-3"
                    >
                      {t('billingCommerce.view')}
                    </a>
                  )}
                  {inv.invoicePdf && (
                    <a
                      href={inv.invoicePdf}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:underline font-semibold"
                    >
                      PDF
                    </a>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TierTile({
  tier,
  currentTier,
  busy,
  onChoose,
}: {
  tier: TierCard;
  currentTier?: string;
  busy: string | null;
  onChoose: (period: 'monthly' | 'annual') => void;
}) {
  const t = useTranslations();
  const isCurrent = currentTier === tier.id;
  const isPaid = tier.id === 'MONTHLY' || tier.id === 'ANNUAL';
  const period: 'monthly' | 'annual' = tier.id === 'ANNUAL' ? 'annual' : 'monthly';
  const price =
    tier.id === 'ANNUAL' ? fmtWhole(tier.annualPriceCents) : fmtWhole(tier.monthlyPriceCents);
  const cadence =
    tier.id === 'FREE_TRIAL'
      ? t('billingCommerce.fourteenDays')
      : tier.id === 'ANNUAL'
        ? t('billingCommerce.perScreenPerYear')
        : t('billingCommerce.perScreenPerMonth');

  return (
    <div
      className={`relative rounded-2xl border-2 p-5 transition-all flex flex-col ${
        isCurrent
          ? 'border-emerald-400 bg-emerald-50/50 shadow-lg'
          : tier.recommended
            ? 'border-indigo-400 bg-white shadow-md'
            : 'border-slate-200 bg-white'
      }`}
    >
      {tier.recommended && !isCurrent && (
        <div className="absolute -top-2.5 left-4 px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-full inline-flex items-center gap-1">
          <Star className="w-2.5 h-2.5" /> {t('billingCommerce.bestValue')}
        </div>
      )}
      {isCurrent && (
        <div className="absolute -top-2.5 left-4 px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-full inline-flex items-center gap-1">
          <CheckCircle2 className="w-2.5 h-2.5" /> {t('billingCommerce.yourPlan')}
        </div>
      )}
      <div className="font-bold text-slate-800 text-lg">{tier.name}</div>
      <p className="text-xs text-slate-500 leading-snug mt-0.5 mb-4">{tier.blurb}</p>
      <div className="mb-4">
        <span className="text-3xl font-extrabold text-slate-800">{price}</span>
        <span className="text-xs text-slate-400 ml-1">{cadence}</span>
      </div>
      <ul className="space-y-1.5 mb-5 flex-1">
        {tier.features.map((f) => (
          <li key={f} className="text-xs text-slate-600 flex items-start gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" /> {f}
          </li>
        ))}
      </ul>
      {isCurrent ? (
        <div className="w-full py-2 text-sm font-bold rounded-lg bg-emerald-100 text-emerald-700 text-center">
          {t('billingCommerce.currentPlan')}
        </div>
      ) : isPaid ? (
        <button
          onClick={() => onChoose(period)}
          disabled={busy !== null}
          className={`w-full py-2 text-sm font-bold rounded-lg transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50 ${
            tier.recommended
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : 'bg-slate-800 text-white hover:bg-slate-900'
          }`}
        >
          {busy === period && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {t('billingCommerce.chooseTier', { name: tier.name })}
        </button>
      ) : (
        <div className="w-full py-2 text-xs font-medium rounded-lg bg-slate-50 text-slate-400 text-center">
          {t('billingCommerce.defaultNoCard')}
        </div>
      )}
    </div>
  );
}
