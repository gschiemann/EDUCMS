"use client";

import { CreditCard, Loader2, AlertTriangle, MonitorPlay, Calendar, ArrowUpCircle } from 'lucide-react';
import { useLicense } from '@/hooks/use-api';

const TIER_META: Record<string, { label: string; color: string; description: string }> = {
  PILOT: { label: 'Pilot', color: 'bg-slate-100 text-slate-700 border-slate-200', description: 'Free — up to 3 screens' },
  STANDARD: { label: 'Standard', color: 'bg-indigo-50 text-indigo-700 border-indigo-200', description: 'Per-screen monthly' },
  ENTERPRISE: { label: 'Enterprise', color: 'bg-violet-50 text-violet-700 border-violet-200', description: 'Custom annual contract' },
  EDU_DISTRICT: { label: 'EDU District', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', description: 'Annual district-wide license' },
  RESTAURANT_CHAIN: { label: 'Restaurant Chain', color: 'bg-amber-50 text-amber-800 border-amber-200', description: 'Multi-location chain' },
};

export function LicenseCard() {
  const { data, isLoading } = useLicense();

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100">
        <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-indigo-500" /> License & Billing
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Each paired screen consumes one seat. Unpair a screen to free a seat.
        </p>
      </div>

      <div className="p-6">
        {isLoading || !data ? (
          <Loader2 className="w-5 h-5 animate-spin text-slate-400 mx-auto" />
        ) : (
          <div className="space-y-5">
            {/* Tier + status */}
            <div className="flex items-center gap-3">
              <span className={`text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg border ${TIER_META[data.tier]?.color ?? 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                {TIER_META[data.tier]?.label ?? data.tier}
              </span>
              {data.status !== 'ACTIVE' && (
                <span className="text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {data.status}
                </span>
              )}
              {data.expiresAt && (
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" /> Expires {new Date(data.expiresAt).toLocaleDateString()}
                </span>
              )}
            </div>

            {/* Seats meter */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                  <MonitorPlay className="w-4 h-4 text-slate-500" /> Screens used
                </div>
                <div className="text-sm font-mono">
                  <span className={data.atLimit ? 'text-rose-600 font-bold' : 'text-slate-700 font-bold'}>{data.seatsUsed}</span>
                  <span className="text-slate-400"> / {data.seatLimit}</span>
                </div>
              </div>
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    data.atLimit
                      ? 'bg-rose-500'
                      : data.seatsUsed / data.seatLimit > 0.8
                        ? 'bg-amber-500'
                        : 'bg-indigo-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.round((data.seatsUsed / data.seatLimit) * 100))}%` }}
                />
              </div>
              {data.atLimit && (
                <p className="text-xs text-rose-700 font-medium mt-2 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  At seat limit — new pair attempts will be rejected. Upgrade to add more screens.
                </p>
              )}
            </div>

            {/* Upgrade CTA — Pilot tier only */}
            {data.isPilot && (
              <a
                href="/pricing"
                className="block w-full text-center py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-500/20 transition-all"
              >
                <ArrowUpCircle className="w-4 h-4 inline -mt-0.5 mr-1" />
                Upgrade for unlimited screens
              </a>
            )}

            <p className="text-[11px] text-slate-400 text-center">
              {TIER_META[data.tier]?.description ?? 'Custom plan'}
              {data.isPilot && <span> · No card required.</span>}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
