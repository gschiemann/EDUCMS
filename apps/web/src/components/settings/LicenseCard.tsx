"use client";

/**
 * License & Billing row on /settings — slim status card matching
 * the Industry / Emergency / Brand / AI rows.
 *
 * 2026-05-25 — operator: "this should be slimed down to one row
 * like the rest and then update the colors to match our purple
 * gradient that we have not blue...make sure this is the most
 * useful settings page and makes it so easy for a customer to
 * see how many screens they are paying for and allow them to add
 * more licneses easily or upgrade plans, just make it dummy
 * prooof becasue we weant that money."
 *
 * Renders one row:
 *   [💳 indigo icon] Plan & screens · [TIER pill] · "4 of 1000 screens used" · [Upgrade →]
 *
 * Tier display labels are vertical-neutral now (no more "EDU
 * District" — the operator's tenant might not be a school
 * district).
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CreditCard, Loader2, AlertTriangle, ArrowUpCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useLicense } from '@/hooks/use-api';

// 2026-05-25 — tier display labels generalized. Operator: "i see
// you referencing school disctrics and thats not right anymore."
// The DB enum values stay (PILOT / STANDARD / ENTERPRISE /
// EDU_DISTRICT / RESTAURANT_CHAIN); these are just human labels.
// Removed K-12-specific wording; an EDU_DISTRICT tier still exists
// for SUPER_ADMIN-comped accounts but reads as "Education" in the
// UI so the rest of the customer base doesn't see schools-only
// terminology.
// i18n: the map holds catalog keys, resolved via t() at render time.
const TIER_LABEL_KEY: Record<string, string> = {
  PILOT: 'settings.license.tierPilot',
  STANDARD: 'settings.license.tierStandard',
  ENTERPRISE: 'settings.license.tierEnterprise',
  EDU_DISTRICT: 'settings.license.tierEducation',
  RESTAURANT_CHAIN: 'settings.license.tierChain',
};

export function LicenseCard() {
  const t = useTranslations();
  const { data, isLoading } = useLicense();
  const pathname = usePathname() || '';
  const billingHref = pathname ? `${pathname}/billing` : '/billing';

  // ── LOADING ──
  if (isLoading || !data) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center shrink-0">
            <CreditCard className="w-4 h-4 text-indigo-600" />
          </div>
          <span className="text-sm font-bold text-slate-800">{t('settings.license.title')}</span>
          <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
        </div>
      </div>
    );
  }

  const tierLabel = TIER_LABEL_KEY[data.tier] ? t(TIER_LABEL_KEY[data.tier]) : data.tier;
  // Stripe sometimes returns a tier with no seatLimit (truly unlimited
  // enterprise plans). Show "Unlimited" instead of NaN.
  const hasLimit = typeof data.seatLimit === 'number' && data.seatLimit > 0;
  const seatLimit = hasLimit ? data.seatLimit : 0;
  const pct = hasLimit ? Math.min(100, Math.round((data.seatsUsed / seatLimit) * 100)) : 0;
  const isWarning = hasLimit && pct >= 80 && !data.atLimit;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-9 h-9 rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center shrink-0">
          <CreditCard className="w-4 h-4 text-indigo-600" />
        </div>
        <div className="min-w-0 flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold text-slate-800 shrink-0">{t('settings.license.title')}</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-[11px] font-bold text-indigo-700">
            {tierLabel}
          </span>
          {data.status !== 'ACTIVE' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-[11px] font-bold text-rose-700">
              <AlertTriangle className="w-3 h-3" /> {data.status}
            </span>
          )}
          <span className={`text-[11px] truncate ${data.atLimit ? 'text-rose-700 font-bold' : isWarning ? 'text-amber-700 font-semibold' : 'text-slate-500'}`}>
            <span className="font-bold">{data.seatsUsed}</span>
            {hasLimit ? <> {t('settings.license.ofLimit', { limit: seatLimit })}</> : ''}
            {' '}{t('settings.license.screensWord')}
            {data.atLimit && <> {t('settings.license.limitReached')}</>}
          </span>
          {/* Inline usage bar — tucked under the title row when there's
              space, otherwise wraps. Color tracks state: indigo by
              default, amber at 80%+, rose at 100%. Brand consistency:
              every accent in this row reads as indigo/violet (the
              house gradient), not the teal/sky/emerald the old
              billing hero used. */}
          {hasLimit && (
            <span className="hidden md:inline-block w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden shrink-0">
              <span
                className={`block h-full rounded-full transition-all ${
                  data.atLimit
                    ? 'bg-rose-500'
                    : isWarning
                      ? 'bg-amber-500'
                      : 'bg-gradient-to-r from-indigo-500 to-violet-500'
                }`}
                style={{ width: `${pct}%` }}
              />
            </span>
          )}
        </div>
      </div>
      <Link
        href={billingHref}
        // Same Configure-button signature as Brand / AI / Emergency
        // so all settings rows are visually flush. Pilot tier gets
        // a slightly stronger CTA ("Upgrade") since that's the
        // money path; paid plans get "Manage."
        className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors"
      >
        {data.isPilot ? (
          <>
            <ArrowUpCircle className="w-3.5 h-3.5" /> {t('settings.license.upgrade')}
          </>
        ) : (
          t('settings.common.manage')
        )}
      </Link>
    </div>
  );
}
