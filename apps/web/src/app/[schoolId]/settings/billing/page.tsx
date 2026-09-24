'use client';

/**
 * /[schoolId]/settings/billing — Billing (handoff §7.9), rendered inside the
 * Settings Command Center shell.
 *
 * Every capability the old page had is preserved: plan + seat usage from the
 * License, the tier catalogue, Stripe-hosted Checkout, the Customer Portal
 * and invoice history. What changed is the honesty of the not-configured
 * state and where the page's chrome comes from (the shell owns breadcrumb,
 * H1, purpose line; this file owns the editor body + the context rail).
 *
 * THE ONE RULE THIS PAGE EXISTS TO KEEP: Stripe is dormant unless the deploy
 * configures it (`StripeService.enabled()`), so `GET /billing/status` is the
 * authoritative signal and NOTHING here offers a checkout action until it
 * comes back true. Previously "Choose plan" was always live and only
 * explained itself in an alert AFTER the operator clicked — a dead button
 * wearing a real-button costume (§11, §7.9).
 *
 * A card number never touches this UI. Card entry happens only on
 * Stripe-hosted pages (PCI-SAQ-A).
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';
import {
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
import { useRefreshAiBoards, useTenant } from '@/hooks/use-api';
import { AiBoardsLeft } from '@/components/ai/AiBoardsLeft';
import { SettingsPageFrame } from '@/components/settings/shell/SettingsPageFrame';
import {
  ContextModule,
  EditorHead,
  EditorSection,
  StatusPill,
} from '@/components/settings/shell/primitives';

const SALES_EMAIL = 'sales@venueos.app';
/** How long after the return from a board-pack checkout the allowance is read once more. */
const BOARDS_RECHECK_MS = 5_000;

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
  const { data: tenant } = useTenant();
  const tenantName = (tenant as { name?: string } | undefined)?.name ?? '';

  // Post-Checkout return flag — read client-side so the page needs no
  // useSearchParams Suspense boundary.
  const [checkoutResult, setCheckoutResult] = useState<string | null>(null);
  // 2026-09-23 — the AI board packs' checkout returns here too (`?boards=success|cancelled`;
  // BillingController.aiPackCheckout's success/cancel URLs).
  const [boardsResult, setBoardsResult] = useState<string | null>(null);
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    setCheckoutResult(qs.get('checkout'));
    setBoardsResult(qs.get('boards'));
  }, []);
  // Back from paying for a pack: the boards line below reads the allowance fresh, but Stripe's
  // webhook credits the pack a few seconds after the redirect — so ONE more read shortly after.
  // A single point-in-time check, not a poll; coming back to the tab re-reads it too.
  const refreshAiBoards = useRefreshAiBoards();
  useEffect(() => {
    if (boardsResult !== 'success') return;
    const once = window.setTimeout(refreshAiBoards, BOARDS_RECHECK_MS);
    return () => window.clearTimeout(once);
  }, [boardsResult, refreshAiBoards]);

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
  // The authoritative "is Stripe configured on this deploy" probe —
  // `StripeService.enabled()` straight from the API. `null` while unknown:
  // a checkout action is never rendered on a guess.
  const billingStatus = useQuery<{ stripeEnabled: boolean; message?: string } | null>({
    queryKey: ['billing', 'status'],
    queryFn: () =>
      apiFetch<{ stripeEnabled: boolean; message?: string }>('/billing/status').catch(() => null),
    staleTime: 5 * 60_000,
  });

  const stripeEnabled: boolean | null = billingStatus.data
    ? !!billingStatus.data.stripeEnabled
    : billingStatus.isLoading
      ? null
      : invoices.data
        ? !!invoices.data.stripeEnabled
        : null;

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
  const seatLimit = lic?.seatLimit ?? null;
  const hasPaidPlan = !!lic && !lic.isPilot && lic.tier !== 'PILOT';
  // "Next invoice" is only a real date when a paid subscription is actually
  // being billed by a configured Stripe. Otherwise the rail says so.
  const nextInvoice =
    hasPaidPlan && stripeEnabled === true ? lic?.currentPeriodEnd || lic?.expiresAt || null : null;

  const searchItems = useMemo(
    () => [
      { label: t('settings.cc.billing.searchPlan'), anchor: 'bill-plan', keywords: ['plan', 'tier', 'license', 'subscription'] },
      { label: t('settings.cc.billing.searchSeats'), anchor: 'bill-plan', keywords: ['seats', 'screens', 'usage', 'limit'] },
      { label: t('settings.cc.billing.searchInvoices'), anchor: 'bill-invoices', keywords: ['invoice', 'receipt', 'payment', 'pdf'] },
    ],
    [t],
  );

  const context = (
    <>
      <ContextModule
        label={t('settings.cc.billing.railSeatsLabel')}
        title={seatLimit ? `${screens} / ${seatLimit}` : String(screens)}
      >
        {seatLimit
          ? t('settings.cc.billing.railSeatsUsed', { used: screens, limit: seatLimit })
          : t('settings.cc.billing.railSeatsNoLimit', { used: screens })}
      </ContextModule>
      <ContextModule
        label={t('settings.cc.billing.railNextInvoiceLabel')}
        title={nextInvoice ? fmtDate(nextInvoice) : undefined}
      >
        {nextInvoice ? null : t('settings.cc.billing.railNextInvoiceNone')}
      </ContextModule>
      <ContextModule
        label={t('settings.cc.billing.railServiceLabel')}
        title={
          stripeEnabled === null ? (
            <StatusPill kind="unknown" label={t('settings.cc.billing.railServiceUnknown')} />
          ) : stripeEnabled ? (
            <StatusPill kind="connected" label={t('settings.cc.billing.railServiceOn')} />
          ) : (
            <StatusPill kind="notConfigured" label={t('settings.cc.billing.railServiceOff')} />
          )
        }
      >
        {stripeEnabled === null
          ? null
          : stripeEnabled
            ? t('settings.cc.billing.railServiceOnBody')
            : t('settings.cc.billing.railServiceOffBody')}
      </ContextModule>
    </>
  );

  return (
    <SettingsPageFrame
      section="billing"
      title={t('settings.shell.sections.billing.label')}
      description={t('settings.shell.sections.billing.description')}
      scope={{ kind: 'organization', label: tenantName }}
      searchItems={searchItems}
      context={context}
    >
      <EditorHead
        icon={CreditCard}
        title={t('settings.cc.billing.editorTitle')}
        description={t('settings.cc.billing.editorDesc')}
      />

      {checkoutResult === 'success' && (
        <div className="mb-5 rounded-[11px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800 flex items-start gap-2" role="status">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden />
          <span>
            <strong>{t('billingCommerce.subscriptionStarted')}</strong>{' '}
            {t('billingCommerce.subscriptionStartedDetail')}
          </span>
        </div>
      )}
      {checkoutResult === 'cancelled' && (
        <div className="mb-5 rounded-[11px] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 flex items-start gap-2" role="status">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden />
          <span>{t('billingCommerce.checkoutCancelled')}</span>
        </div>
      )}
      {/* 2026-09-23 — back from buying AI boards: say so, with the boards-left line itself. */}
      {boardsResult === 'success' && (
        <div data-testid="boards-returned" className="mb-5 rounded-[11px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800 flex items-start gap-2" role="status">
          <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden />
          <div className="min-w-0">
            <span>
              <strong>{t('aiBoards.credits.returned.success')}</strong>{' '}
              {t('aiBoards.credits.returned.successDetail')}
            </span>
            <AiBoardsLeft className="mt-1.5" />
          </div>
        </div>
      )}
      {boardsResult === 'cancelled' && (
        <div data-testid="boards-returned" className="mb-5 rounded-[11px] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 flex items-start gap-2" role="status">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden />
          <span>{t('aiBoards.credits.returned.cancelled')}</span>
        </div>
      )}

      {/* Stripe dormant → say so once, at the top, instead of letting the
          operator discover it by clicking a dead action. */}
      {stripeEnabled === false && (
        <div className="mb-5 rounded-[11px] border border-slate-200 bg-slate-50 px-4 py-3.5">
          <strong className="block text-[13px] font-medium text-slate-900">
            {t('settings.cc.billing.notConfiguredTitle')}
          </strong>
          <p className="mt-1 text-[12px] leading-[17px] text-slate-500">
            {t('settings.cc.billing.notConfiguredBody')}
          </p>
          <p className="mt-1.5 text-[12px] leading-[17px] text-slate-500">
            {t('settings.cc.billing.notConfiguredContact', { email: SALES_EMAIL })}
          </p>
        </div>
      )}

      {/* ── Current plan + seat usage ─────────────────────────── */}
      <EditorSection
        id="bill-plan"
        title={t('settings.cc.billing.planTitle')}
        description={t('settings.cc.billing.planDesc')}
      >
        {license.isLoading ? (
          <CardSpinner />
        ) : (
          <CurrentPlanCard
            license={lic}
            screens={screens}
            onManage={manageBilling}
            managing={busy === 'portal'}
            // The Customer Portal is a Stripe-hosted page — offering it with
            // Stripe dormant would be the same dead button in another coat.
            showManage={hasPaidPlan && stripeEnabled === true}
          />
        )}
        <p className="mt-3 text-[12px] leading-[17px] text-slate-500">
          {t('settings.cc.billing.notScreenStatus')}
        </p>
      </EditorSection>

      {/* ── Invoices ──────────────────────────────────────────── */}
      <EditorSection
        id="bill-invoices"
        title={t('settings.cc.billing.invoicesTitle')}
        description={t('settings.cc.billing.invoicesDesc')}
      >
        {invoices.isLoading ? (
          <CardSpinner />
        ) : (
          <InvoicesCard
            data={invoices.data}
            unavailableNote={
              stripeEnabled === false ? t('settings.cc.billing.invoicesUnavailable') : undefined
            }
          />
        )}
      </EditorSection>

      {/* ── Plans ─────────────────────────────────────────────── */}
      <EditorSection
        id="bill-plans"
        title={hasPaidPlan ? t('settings.cc.billing.plansChangeTitle') : t('settings.cc.billing.plansTitle')}
        description={
          stripeEnabled === true ? t('settings.cc.billing.plansDesc') : undefined
        }
      >
        {tiers.isLoading || stripeEnabled === null ? (
          <CardSpinner />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(tiers.data || []).map((tier) => (
                <TierTile
                  key={tier.id}
                  tier={tier}
                  currentTier={lic?.tier}
                  busy={busy}
                  onChoose={startCheckout}
                  checkoutAvailable={stripeEnabled === true}
                />
              ))}
            </div>
            {stripeEnabled === true && (
              <p className="mt-3 text-[12px] leading-[17px] text-slate-500">
                {t('settings.cc.billing.planChangeNote')}
              </p>
            )}
          </>
        )}
      </EditorSection>

      <p className="pt-4 border-t border-slate-200 text-[12px] leading-[17px] text-slate-400">
        {t('billingCommerce.pricingFooter')}{' '}
        <a href={`mailto:${SALES_EMAIL}`} className="underline underline-offset-2" style={{ color: 'var(--brand-primary)' }}>
          {SALES_EMAIL}
        </a>
        .
      </p>
    </SettingsPageFrame>
  );
}

function CardSpinner() {
  return (
    <div className="flex justify-center py-6">
      <Loader2 className="w-5 h-5 animate-spin text-slate-400" aria-hidden />
    </div>
  );
}

function CurrentPlanCard({
  license,
  screens,
  onManage,
  managing,
  showManage,
}: {
  license: CurrentLicense | null | undefined;
  screens: number;
  onManage: () => void;
  managing: boolean;
  showManage: boolean;
}) {
  const t = useTranslations();
  const status = license?.status || 'ACTIVE';
  const statusKind = status === 'ACTIVE' ? 'ready' : status === 'PAST_DUE' ? 'attention' : 'blocked';
  const perScreen = license?.monthlyPriceCents ?? null;
  const monthlyCost = perScreen != null ? screens * perScreen : null;
  const seatLimit = license?.seatLimit ?? null;
  const seatPct = seatLimit && seatLimit > 0 ? Math.min(100, (screens / seatLimit) * 100) : null;
  const renews = license?.currentPeriodEnd || license?.expiresAt || null;

  return (
    <div className="rounded-[13px] bg-white border border-slate-200 overflow-hidden">
      <div className="p-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[17px] font-medium text-slate-900">
              {license?.tierName || license?.tier || t('billingCommerce.freePilot')}
            </span>
            <StatusPill kind={statusKind} label={status} />
          </div>
          <div className="text-[13px] text-slate-500">
            {monthlyCost != null ? (
              <>
                <strong className="font-medium text-slate-700">{fmtCents(monthlyCost)}</strong>{' '}
                {t('billingCommerce.perMonth')}
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
        {showManage && (
          <button
            type="button"
            onClick={onManage}
            disabled={managing}
            className="inline-flex items-center gap-1.5 min-h-[38px] px-3.5 text-[13px] font-medium rounded-[10px] bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {managing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <ExternalLink className="w-4 h-4" aria-hidden />}
            {t('billingCommerce.manageBilling')}
          </button>
        )}
      </div>

      {/* metrics strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 border-t border-slate-100 divide-y sm:divide-y-0 sm:divide-x divide-slate-100">
        <Metric
          icon={<Monitor className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} aria-hidden />}
          label={t('billingCommerce.screensInUse')}
          value={
            seatLimit ? (
              <>
                {screens} <span className="text-slate-400 font-normal">/ {seatLimit}</span>
              </>
            ) : (
              <>{screens}</>
            )
          }
          sub={
            seatPct != null ? (
              <div className="w-full h-1.5 bg-slate-100 rounded-full mt-1.5 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${seatPct}%`, background: 'var(--brand-primary)' }}
                />
              </div>
            ) : (
              <span className="text-[12px] text-slate-400">{t('billingCommerce.pairedDisplays')}</span>
            )
          }
        />
        <Metric
          icon={<CreditCard className="w-4 h-4" style={{ color: 'var(--brand-primary)' }} aria-hidden />}
          label={t('billingCommerce.thisMonth')}
          value={monthlyCost != null ? fmtCents(monthlyCost) : t('billingCommerce.free')}
          sub={<span className="text-[12px] text-slate-400">{t('billingCommerce.billedPerScreen')}</span>}
        />
        <Metric
          icon={<Star className="w-4 h-4 text-amber-500" aria-hidden />}
          label={status === 'ACTIVE' ? t('billingCommerce.renews') : t('billingCommerce.periodEnds')}
          value={<span className="text-[15px]">{fmtDate(renews)}</span>}
          sub={
            <span className="text-[12px] text-slate-400">
              {showManage ? t('billingCommerce.autoRenews') : t('billingCommerce.noBillingDate')}
            </span>
          }
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
      <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-[.08em] uppercase text-slate-500">
        {icon}
        {label}
      </div>
      <div className="text-[19px] font-medium text-slate-900 mt-1 tabular-nums">{value}</div>
      {sub}
    </div>
  );
}

function InvoicesCard({
  data,
  unavailableNote,
}: {
  data?: { stripeEnabled: boolean; invoices: Invoice[] };
  unavailableNote?: string;
}) {
  const t = useTranslations();
  const list = data?.invoices || [];
  if (list.length === 0) {
    return (
      <div className="rounded-[13px] bg-white border border-slate-200 p-6 text-center">
        <FileText className="w-6 h-6 text-slate-300 mx-auto mb-2" aria-hidden />
        <p className="text-[13px] text-slate-500">
          {t('billingCommerce.noInvoicesYet')}
          <span className="text-slate-400">
            {' '}
            {unavailableNote ?? t('billingCommerce.invoicesAppearAutomatically')}
          </span>
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-[13px] bg-white border border-slate-200 overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[11px] font-medium tracking-[.08em] uppercase text-slate-500 border-b border-slate-100">
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
                <td className="px-4 py-2.5 text-right font-medium text-slate-900 tabular-nums">
                  {fmtCents(amount)}
                </td>
                <td className="px-4 py-2.5">
                  <StatusPill kind={paid ? 'ready' : 'attention'} label={inv.status || 'open'} />
                </td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  {inv.hostedInvoiceUrl && (
                    <a
                      href={inv.hostedInvoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium mr-3 underline underline-offset-2"
                      style={{ color: 'var(--brand-primary)' }}
                    >
                      {t('billingCommerce.view')}
                    </a>
                  )}
                  {inv.invoicePdf && (
                    <a
                      href={inv.invoicePdf}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium underline underline-offset-2"
                      style={{ color: 'var(--brand-primary)' }}
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
  checkoutAvailable,
}: {
  tier: TierCard;
  currentTier?: string;
  busy: string | null;
  onChoose: (period: 'monthly' | 'annual') => void;
  checkoutAvailable: boolean;
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
      className={`relative rounded-[13px] border p-5 flex flex-col ${
        isCurrent
          ? 'border-emerald-300 bg-emerald-50/40'
          : tier.recommended
            ? 'border-slate-300 bg-white'
            : 'border-slate-200 bg-white'
      }`}
    >
      {tier.recommended && !isCurrent && (
        <div
          className="absolute -top-2.5 left-4 px-2 py-0.5 text-[11px] font-medium rounded-full inline-flex items-center gap-1 text-[var(--brand-primary-ink)]"
          style={{ background: 'var(--brand-primary)' }}
        >
          <Star className="w-2.5 h-2.5" aria-hidden /> {t('billingCommerce.bestValue')}
        </div>
      )}
      {isCurrent && (
        <div className="absolute -top-2.5 left-4 px-2 py-0.5 bg-emerald-600 text-white text-[11px] font-medium rounded-full inline-flex items-center gap-1">
          <CheckCircle2 className="w-2.5 h-2.5" aria-hidden /> {t('billingCommerce.yourPlan')}
        </div>
      )}
      <div className="font-medium text-slate-900 text-[15px]">{tier.name}</div>
      <p className="text-[12px] text-slate-500 leading-snug mt-0.5 mb-4">{tier.blurb}</p>
      <div className="mb-4">
        <span className="text-[26px] font-medium text-slate-900">{price}</span>
        <span className="text-[12px] text-slate-400 ml-1">{cadence}</span>
      </div>
      <ul className="space-y-1.5 mb-5 flex-1">
        {tier.features.map((f) => (
          <li key={f} className="text-[12px] text-slate-600 flex items-start gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" aria-hidden /> {f}
          </li>
        ))}
      </ul>
      {isCurrent ? (
        <div className="w-full py-2 text-[13px] font-medium rounded-[10px] bg-emerald-100 text-emerald-800 text-center">
          {t('billingCommerce.currentPlan')}
        </div>
      ) : isPaid && checkoutAvailable ? (
        <button
          type="button"
          onClick={() => onChoose(period)}
          disabled={busy !== null}
          className="w-full min-h-[38px] text-[13px] font-medium rounded-[10px] inline-flex items-center justify-center gap-1.5 disabled:opacity-50 bg-slate-800 text-white hover:bg-slate-900"
        >
          {busy === period && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
          {t('billingCommerce.chooseTier', { name: tier.name })}
        </button>
      ) : isPaid ? (
        // Stripe dormant: state the real path instead of a dead button.
        <a
          href={`mailto:${SALES_EMAIL}`}
          className="w-full min-h-[38px] text-[13px] font-medium rounded-[10px] inline-flex items-center justify-center border border-slate-200 text-slate-600 hover:bg-slate-50"
        >
          {t('settings.cc.billing.contactSales')}
        </a>
      ) : (
        <div className="w-full py-2 text-[12px] font-medium rounded-[10px] bg-slate-50 text-slate-400 text-center">
          {t('billingCommerce.defaultNoCard')}
        </div>
      )}
    </div>
  );
}
