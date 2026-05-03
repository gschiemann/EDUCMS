'use client';

/**
 * /[schoolId]/settings/billing — Tenant-facing billing summary.
 *
 * Sprint 8c (2026-05-03). Read-only for now: shows current plan +
 * seat usage + upgrade options. Stripe Checkout is wired up to
 * /billing/checkout once the API has STRIPE_SECRET_KEY in env.
 *
 * Until Stripe is configured, the upgrade buttons fall back to a
 * "Contact sales" intent (mailto). Operators can still see exactly
 * what tier they're on + what their next-tier options cost.
 */
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { useUIStore } from '@/store/ui-store';
import { CreditCard, CheckCircle2, Loader2, ShieldAlert, Star } from 'lucide-react';

interface CurrentLicense {
  id: string;
  tier: string;
  tierName?: string;
  seatLimit: number | null;
  currentSeats?: number;
  status: string;
  monthlyPriceCents?: number | null;
  currentPeriodEnd?: string;
  expiresAt?: string;
  billingMode: 'CARD' | 'INVOICE' | 'PURCHASE_ORDER' | 'COMP';
}

interface TierCard {
  id: string;
  name: string;
  blurb: string;
  monthlyPriceCents: number | null;
  annualPriceCents: number | null;
  seatLimit: number | null;
  features: string[];
  selfServe: boolean;
  isAddon: boolean;
  recommended: boolean;
}

export default function BillingPage() {
  const tenantCopy = useTenantCopy();
  const user = useUIStore((s) => s.user);
  const license = useQuery<CurrentLicense | null>({
    queryKey: ['license', 'current'],
    queryFn: () => apiFetch<CurrentLicense | null>('/license/current').catch(() => null),
  });
  const tiers = useQuery<TierCard[]>({
    queryKey: ['license', 'tiers', tenantCopy.vertical],
    queryFn: () => apiFetch<TierCard[]>(`/license/tiers?vertical=${tenantCopy.vertical}`).catch(() => []),
  });

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-sky-600 p-6 text-white">
        <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
          <CreditCard className="w-6 h-6" /> Billing & plan
        </h1>
        <p className="text-emerald-50 mt-1.5 text-sm max-w-xl">
          Pick the right plan for your {tenantCopy.orgSingular.toLowerCase()}. Self-serve via Stripe; or contact sales for multi-location.
        </p>
      </div>

      {/* Current license */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Current plan</h2>
        {license.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : license.data ? (
          <CurrentPlanCard license={license.data} />
        ) : (
          <div className="rounded-xl border-2 border-dashed border-amber-200 bg-amber-50 p-4 text-sm text-amber-700 inline-flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
            No active license on file. Pick a plan below to activate billing.
          </div>
        )}
      </section>

      {/* Available tiers */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Available plans</h2>
        {tiers.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {(tiers.data || []).filter(t => !t.isAddon).map((tier) => (
              <TierTile key={tier.id} tier={tier} currentTier={license.data?.tier} />
            ))}
          </div>
        )}
      </section>

      {/* Add-ons */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Add-ons</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {(tiers.data || []).filter(t => t.isAddon).map((tier) => (
            <TierTile key={tier.id} tier={tier} currentTier={license.data?.tier} />
          ))}
        </div>
      </section>

      {/* Footnote */}
      <div className="text-[11px] text-slate-400 leading-relaxed pt-4 border-t border-slate-100">
        Self-serve checkout is processed by Stripe. Multi-location and enterprise plans are sales-led —
        <a href="mailto:sales@venueos.app" className="text-indigo-600 hover:underline ml-1">contact sales</a>.
        Pricing is per-{tenantCopy.orgSingular.toLowerCase()}-per-month unless noted. Annual = 2 months free.
      </div>
    </div>
  );
}

function CurrentPlanCard({ license }: { license: CurrentLicense }) {
  const monthly = license.monthlyPriceCents != null ? `$${(license.monthlyPriceCents / 100).toFixed(0)}/mo` : 'Custom';
  const seatPct = license.seatLimit && license.currentSeats != null
    ? Math.min(100, (license.currentSeats / license.seatLimit) * 100)
    : null;
  const statusColor =
    license.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
    license.status === 'PAST_DUE' ? 'bg-amber-50 text-amber-700 border-amber-200' :
    'bg-rose-50 text-rose-700 border-rose-200';
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg font-bold text-slate-800">{license.tierName || license.tier}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider ${statusColor}`}>
              {license.status}
            </span>
          </div>
          <div className="text-sm text-slate-500">{monthly}</div>
        </div>
        <div className="text-right">
          {license.seatLimit ? (
            <>
              <div className="text-xs font-bold text-slate-700">
                {license.currentSeats ?? 0} / {license.seatLimit} screens
              </div>
              {seatPct != null && (
                <div className="w-32 h-1.5 bg-slate-100 rounded-full mt-1.5 overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${seatPct}%` }} />
                </div>
              )}
            </>
          ) : (
            <div className="text-xs font-bold text-slate-700">Unlimited screens</div>
          )}
        </div>
      </div>
      {license.currentPeriodEnd && (
        <div className="text-[11px] text-slate-400 mt-3 pt-3 border-t border-slate-100">
          Renews {new Date(license.currentPeriodEnd).toLocaleDateString()}.
          {license.billingMode === 'INVOICE' && ' Billed by invoice.'}
          {license.billingMode === 'COMP' && ' Comp / partner.'}
        </div>
      )}
    </div>
  );
}

function TierTile({ tier, currentTier }: { tier: TierCard; currentTier?: string }) {
  const isCurrent = currentTier === tier.id;
  const monthly = tier.monthlyPriceCents != null ? `$${(tier.monthlyPriceCents / 100).toFixed(0)}` : 'Quote';
  const annual = tier.annualPriceCents != null ? `$${(tier.annualPriceCents / 100).toFixed(0)}` : null;

  const onUpgrade = () => {
    if (tier.selfServe) {
      // Future: POST /billing/checkout returns a Stripe Checkout URL.
      // Until Stripe is wired, the API responds 501 and we surface a
      // friendly mailto so the user isn't stuck.
      apiFetch<{ checkoutUrl: string }>('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ tier: tier.id, billingPeriod: 'monthly' }),
      }).then((res) => {
        if (res?.checkoutUrl) window.location.href = res.checkoutUrl;
        else window.location.href = `mailto:sales@venueos.app?subject=Upgrade%20to%20${encodeURIComponent(tier.name)}`;
      }).catch(() => {
        window.location.href = `mailto:sales@venueos.app?subject=Upgrade%20to%20${encodeURIComponent(tier.name)}`;
      });
    } else {
      window.location.href = `mailto:sales@venueos.app?subject=Inquiry%20${encodeURIComponent(tier.name)}`;
    }
  };

  return (
    <div className={`relative rounded-2xl border-2 p-5 transition-all ${
      isCurrent ? 'border-emerald-400 bg-emerald-50/50 shadow-lg'
                : tier.recommended ? 'border-indigo-300 bg-white shadow-md hover:shadow-lg'
                : 'border-slate-200 bg-white hover:border-indigo-200 hover:shadow-md'
    }`}>
      {tier.recommended && !isCurrent && (
        <div className="absolute -top-2.5 left-4 px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-full inline-flex items-center gap-1">
          <Star className="w-2.5 h-2.5" /> Recommended
        </div>
      )}
      {isCurrent && (
        <div className="absolute -top-2.5 left-4 px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-full inline-flex items-center gap-1">
          <CheckCircle2 className="w-2.5 h-2.5" /> Your plan
        </div>
      )}
      <div className="font-bold text-slate-800 text-lg">{tier.name}</div>
      <p className="text-xs text-slate-500 leading-snug mt-0.5">{tier.blurb}</p>
      <div className="my-4">
        <span className="text-3xl font-extrabold text-slate-800">{monthly}</span>
        {tier.monthlyPriceCents != null && <span className="text-xs text-slate-400 ml-1">/ month</span>}
        {annual && (
          <div className="text-[11px] text-slate-500 mt-1">or {annual}/year</div>
        )}
      </div>
      <ul className="space-y-1.5 mb-5">
        {tier.features.map((f) => (
          <li key={f} className="text-xs text-slate-600 flex items-start gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 flex-shrink-0" />
            {f}
          </li>
        ))}
      </ul>
      {!isCurrent && (
        <button
          onClick={onUpgrade}
          className={`w-full py-2 text-sm font-bold rounded-lg transition-colors ${
            tier.selfServe
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : 'bg-white border-2 border-slate-300 text-slate-700 hover:border-slate-400'
          }`}
        >
          {tier.selfServe ? 'Upgrade' : 'Contact sales'}
        </button>
      )}
    </div>
  );
}
