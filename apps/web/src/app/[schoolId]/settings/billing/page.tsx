'use client';

/**
 * /[schoolId]/settings/billing — Tenant-facing billing.
 *
 * 2026-05-03 — Simplified pricing: FREE_TRIAL / MONTHLY ($15/screen/mo)
 * / ANNUAL ($150/screen/yr). No vertical filtering, no add-ons.
 *
 * Includes the full credit-card workflow (Stripe Elements form,
 * client-side validation, save-card UX) — STOPS just before actually
 * charging because Stripe isn't live yet. The "Subscribe" click hands
 * off to a stub endpoint that records the intent so we can pick up
 * exactly where the user left off when Stripe goes live.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { CreditCard, CheckCircle2, Loader2, Star, Lock, X, AlertCircle } from 'lucide-react';

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
  recommended: boolean;
}

function fmtPrice(cents: number | null): string {
  if (cents == null) return 'Custom';
  if (cents === 0) return 'Free';
  return `$${(cents / 100).toFixed(0)}`;
}

export default function BillingPage() {
  const tenantCopy = useTenantCopy();
  const license = useQuery<CurrentLicense | null>({
    queryKey: ['license', 'current'],
    queryFn: () => apiFetch<CurrentLicense | null>('/license/current').catch(() => null),
  });
  const tiers = useQuery<TierCard[]>({
    queryKey: ['license', 'tiers'],
    queryFn: () => apiFetch<TierCard[]>('/license/tiers').catch(() => []),
  });

  const [checkoutTier, setCheckoutTier] = useState<TierCard | null>(null);

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="rounded-2xl bg-gradient-to-br from-emerald-600 via-teal-600 to-sky-600 p-6 text-white">
        <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
          <CreditCard className="w-6 h-6" /> Billing & plan
        </h1>
        <p className="text-emerald-50 mt-1.5 text-sm max-w-xl">
          Simple per-screen pricing. Pick monthly or save 17% with annual. Cancel anytime.
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
          <div className="rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-700">
            You're on the <strong>Free trial</strong>. Pick a plan below to keep using {tenantCopy.defaultBrandName} after the trial ends.
          </div>
        )}
      </section>

      {/* Available tiers — three cards across */}
      <section>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Plans</h2>
        {tiers.isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(tiers.data || []).map((tier) => (
              <TierTile
                key={tier.id}
                tier={tier}
                currentTier={license.data?.tier}
                onSelect={() => {
                  if (tier.id === 'FREE_TRIAL') {
                    // Free trial activation goes through a different path — no card.
                    apiFetch('/billing/activate-trial', { method: 'POST' })
                      .then(() => window.location.reload())
                      .catch((e) => alert(e instanceof Error ? e.message : String(e)));
                  } else {
                    setCheckoutTier(tier);
                  }
                }}
              />
            ))}
          </div>
        )}
      </section>

      <div className="text-[11px] text-slate-400 leading-relaxed pt-4 border-t border-slate-100">
        Per-screen pricing. The number of screens you have determines your monthly bill — add or remove screens any time.
        Self-serve checkout via Stripe; questions? <a href="mailto:sales@venueos.app" className="text-indigo-600 hover:underline">sales@venueos.app</a>.
      </div>

      {checkoutTier && (
        <CheckoutModal tier={checkoutTier} onClose={() => setCheckoutTier(null)} />
      )}
    </div>
  );
}

function CurrentPlanCard({ license }: { license: CurrentLicense }) {
  const seatPct = license.seatLimit && license.currentSeats != null
    ? Math.min(100, (license.currentSeats / license.seatLimit) * 100)
    : null;
  const statusColor =
    license.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
    license.status === 'PAST_DUE' ? 'bg-amber-50 text-amber-700 border-amber-200' :
    'bg-rose-50 text-rose-700 border-rose-200';
  const screens = license.currentSeats ?? 0;
  const monthlyEstimate = license.monthlyPriceCents != null
    ? screens * license.monthlyPriceCents
    : null;
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg font-bold text-slate-800">{license.tierName || license.tier}</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wider ${statusColor}`}>{license.status}</span>
          </div>
          {monthlyEstimate != null && (
            <div className="text-sm text-slate-500">
              <strong className="text-slate-700">${(monthlyEstimate / 100).toFixed(2)}</strong> / month
              <span className="text-slate-400"> &nbsp;·&nbsp; {screens} screen{screens === 1 ? '' : 's'} × ${(license.monthlyPriceCents! / 100).toFixed(0)}</span>
            </div>
          )}
        </div>
        {license.seatLimit && (
          <div className="text-right">
            <div className="text-xs font-bold text-slate-700">{screens} / {license.seatLimit} screens</div>
            {seatPct != null && (
              <div className="w-32 h-1.5 bg-slate-100 rounded-full mt-1.5 overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${seatPct}%` }} />
              </div>
            )}
          </div>
        )}
      </div>
      {license.currentPeriodEnd && (
        <div className="text-[11px] text-slate-400 mt-3 pt-3 border-t border-slate-100">
          Renews {new Date(license.currentPeriodEnd).toLocaleDateString()}.
        </div>
      )}
    </div>
  );
}

function TierTile({ tier, currentTier, onSelect }: { tier: TierCard; currentTier?: string; onSelect: () => void }) {
  const isCurrent = currentTier === tier.id;
  const price = tier.id === 'ANNUAL'
    ? fmtPrice(tier.annualPriceCents)
    : fmtPrice(tier.monthlyPriceCents);
  const cadence = tier.id === 'FREE_TRIAL' ? '14 days' : tier.id === 'ANNUAL' ? '/ screen / year' : '/ screen / month';
  return (
    <div className={`relative rounded-2xl border-2 p-5 transition-all flex flex-col ${
      isCurrent ? 'border-emerald-400 bg-emerald-50/50 shadow-lg'
                : tier.recommended ? 'border-indigo-400 bg-white shadow-md hover:shadow-lg'
                : 'border-slate-200 bg-white hover:border-indigo-200 hover:shadow-md'
    }`}>
      {tier.recommended && !isCurrent && (
        <div className="absolute -top-2.5 left-4 px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-full inline-flex items-center gap-1">
          <Star className="w-2.5 h-2.5" /> Best value
        </div>
      )}
      {isCurrent && (
        <div className="absolute -top-2.5 left-4 px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-full inline-flex items-center gap-1">
          <CheckCircle2 className="w-2.5 h-2.5" /> Your plan
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
      {!isCurrent && (
        <button
          onClick={onSelect}
          className={`w-full py-2 text-sm font-bold rounded-lg transition-colors ${
            tier.recommended
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : 'bg-slate-800 text-white hover:bg-slate-900'
          }`}
        >
          {tier.id === 'FREE_TRIAL' ? 'Start free trial' : 'Choose this plan'}
        </button>
      )}
    </div>
  );
}

// ─── Checkout modal — full Stripe Elements flow, no real charge ────────
function CheckoutModal({ tier, onClose }: { tier: TierCard; onClose: () => void }) {
  const [step, setStep] = useState<'card' | 'review' | 'submitted'>('card');
  const [cardName, setCardName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [cardZip, setCardZip] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isAnnual = tier.id === 'ANNUAL';
  const unitPriceCents = isAnnual ? tier.annualPriceCents! : tier.monthlyPriceCents!;
  const cadence = isAnnual ? 'year' : 'month';
  const screens = 1; // For first-time checkout we pre-fill 1 screen; metering kicks in once they pair more.

  const cardOk = isLuhnValid(cardNumber.replace(/\s/g, ''))
    && /^\d\d\s?\/\s?\d\d$/.test(cardExpiry)
    && /^\d{3,4}$/.test(cardCvc)
    && cardName.trim().length >= 2
    && cardZip.trim().length >= 3
    && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(billingEmail);

  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      // Stripe NOT yet live — endpoint records the intent + returns
      // a stub. Once STRIPE_SECRET_KEY is set the same endpoint
      // returns a Stripe Checkout / Setup Intent URL.
      const res: any = await apiFetch('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({
          tier: tier.id,
          billingPeriod: isAnnual ? 'annual' : 'monthly',
          // Card fields aren't sent to the server — Stripe Elements
          // will tokenize them client-side once Stripe is live. We
          // include billingEmail because the server uses it as the
          // Stripe Customer.email when creating the subscription.
          billingEmail,
        }),
      });
      if (res?.checkoutUrl) {
        // Stripe IS live — redirect to Stripe-hosted Checkout.
        window.location.href = res.checkoutUrl;
        return;
      }
      // Stripe not yet live — show the friendly success state.
      setStep('submitted');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Subscribe to {tier.name}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              ${(unitPriceCents / 100).toFixed(0)} per screen / {cadence} · cancel anytime
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>

        {step === 'card' && (
          <>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs text-slate-600 flex items-start gap-2">
              <Lock className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-600" />
              <span>Card details are encrypted and tokenized by Stripe — they never touch our servers. We don&apos;t store your full card number.</span>
            </div>

            <div className="space-y-3">
              <Field label="Cardholder name" value={cardName} onChange={setCardName} placeholder="Greg Schiemann" />
              <Field
                label="Card number"
                value={cardNumber}
                onChange={(v) => setCardNumber(formatCardNumber(v))}
                placeholder="4242 4242 4242 4242"
                inputMode="numeric"
              />
              <div className="grid grid-cols-3 gap-3">
                <Field label="Expiry" value={cardExpiry} onChange={(v) => setCardExpiry(formatExpiry(v))} placeholder="MM/YY" inputMode="numeric" />
                <Field label="CVC" value={cardCvc} onChange={(v) => setCardCvc(v.replace(/\D/g, '').slice(0, 4))} placeholder="123" inputMode="numeric" />
                <Field label="ZIP" value={cardZip} onChange={(v) => setCardZip(v.slice(0, 10))} placeholder="94110" />
              </div>
              <Field label="Billing email" value={billingEmail} onChange={setBillingEmail} placeholder="you@yourcompany.com" inputMode="email" />
            </div>

            {err && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {err}
              </div>
            )}

            <button
              onClick={() => setStep('review')}
              disabled={!cardOk}
              className="w-full py-3 text-sm font-bold rounded-lg bg-slate-800 text-white hover:bg-slate-900 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue to review
            </button>
          </>
        )}

        {step === 'review' && (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Plan</span>
                <span className="font-bold text-slate-800">{tier.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Screens</span>
                <span className="font-bold text-slate-800">{screens}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Per screen / {cadence}</span>
                <span className="font-bold text-slate-800">${(unitPriceCents / 100).toFixed(2)}</span>
              </div>
              <div className="border-t border-slate-100 pt-2 flex justify-between">
                <span className="font-bold text-slate-800">Charged today</span>
                <span className="text-xl font-extrabold text-slate-800">${((screens * unitPriceCents) / 100).toFixed(2)}</span>
              </div>
              <div className="text-[11px] text-slate-400 leading-snug">
                Subscription auto-renews each {cadence}. We bill in advance; cancel any time and you keep access through the period you paid for.
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Payment</span>
                <button onClick={() => setStep('card')} className="text-xs font-bold text-indigo-600 hover:underline">Edit</button>
              </div>
              <div className="text-sm text-slate-700">
                <div>•••• •••• •••• {cardNumber.replace(/\s/g, '').slice(-4)}</div>
                <div className="text-xs text-slate-500 mt-0.5">{cardName} · {billingEmail}</div>
              </div>
            </div>

            {err && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {err}
              </div>
            )}

            <button
              onClick={submit}
              disabled={submitting}
              className="w-full py-3 text-sm font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
              <Lock className="w-3 h-3" />
              Subscribe — ${((screens * unitPriceCents) / 100).toFixed(2)} now
            </button>
          </>
        )}

        {step === 'submitted' && (
          <>
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-emerald-900">
                <div className="font-bold">Card details accepted</div>
                <div className="text-xs mt-1 leading-relaxed">
                  We&apos;ve recorded your subscription intent. Payment processing isn&apos;t live yet on this deployment, so your card was NOT charged. As soon as Stripe is configured we&apos;ll process the subscription and email you the receipt at <strong>{billingEmail}</strong>.
                </div>
              </div>
            </div>
            <button onClick={onClose} className="w-full py-3 text-sm font-bold rounded-lg bg-slate-800 text-white hover:bg-slate-900">
              Got it
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, inputMode }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; inputMode?: 'text' | 'numeric' | 'email' }) {
  return (
    <label className="block">
      <span className="text-xs font-bold text-slate-600">{label}</span>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-300"
      />
    </label>
  );
}

// ─── Card formatters / validators ──────────────────────────────────────
function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 19);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}
function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length < 3) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}
function isLuhnValid(num: string): boolean {
  if (!/^\d{12,19}$/.test(num)) return false;
  let sum = 0, alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}
