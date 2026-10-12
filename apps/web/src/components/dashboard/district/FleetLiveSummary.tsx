'use client';

/**
 * Fleet map — live summary (2026-10-12, replaces the static "Status guide").
 *
 * Answers the question an operator opens the map with — "is everything
 * playing, and if not, what do I do first?" — for EVERY place in scope (the
 * chips filter the pins, never this card: with "Content drift" on, the old
 * card could not mention a second location at all).
 *
 * Shared by the organisation map (a pin per location) and the Screens map a
 * standard account sees (a pin per address): both build the summary with
 * `summarizeMapAlerts` from screens graded by `gradeMapScreen`, so the two can
 * never word the same fleet differently.
 *
 * Every alert row is a door: it selects its place, which zooms the map to it
 * and opens the selected card on the fix. Never a dead click.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import type { LiveSummary, MapAlertKind, MapFilterKey } from '@/components/fleet-map/mapAlerts';

export type { LiveSummary } from '@/components/fleet-map/mapAlerts';

/** Places listed under the alert before "+N more" (which filters the map). */
const ALERT_PLACES_SHOWN = 4;

/** "3 hours" style age for the "since" note, localized. Null when undatable. */
function useAgo() {
  const t = useTranslations('dashboard.liveSummary');
  return (atMs: number | null, now: number): string | null => {
    if (atMs == null) return null;
    const min = Math.floor((now - atMs) / 60_000);
    if (min < 0) return null;
    if (min < 60) return t('minutes', { count: Math.max(1, min) });
    const hr = Math.floor(min / 60);
    if (hr < 24) return t('hours', { count: hr });
    return t('days', { count: Math.floor(hr / 24) });
  };
}

const ALERT_KEY: Record<MapAlertKind, string> = {
  offline: 'actionOffline',
  dark: 'actionDark',
  drift: 'actionDrift',
  emergency: 'actionEmergency',
};

export function FleetLiveSummary({
  summary,
  filter,
  onFilter,
  onAlert,
  className,
  now,
}: {
  summary: LiveSummary;
  filter: string;
  onFilter: (key: MapFilterKey) => void;
  /** Select the place, zoom to it and open its card on the problem. */
  onAlert: (kind: MapAlertKind, placeId: string) => void;
  className?: string;
  /** Fixed clock for tests; live it is read when the summary changes. */
  now?: number;
}) {
  const t = useTranslations('dashboard.liveSummary');
  const ago = useAgo();
  // The clock is read when the data changes (the fleet poll), never on a
  // timer of its own — no new background work on the dashboard.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (now != null) return;
    const id = requestAnimationFrame(() => setClock(Date.now()));
    return () => cancelAnimationFrame(id);
  }, [summary, now]);
  const since = summary.offline > 0 ? ago(summary.offlineSinceMs, now ?? clock) : null;

  const chips: Array<{ key: MapFilterKey; n: number; label: string; dot: string }> = [
    { key: 'offline', n: summary.offline, label: since ? t('offlineSince', { count: summary.offline, since }) : t('offline', { count: summary.offline }), dot: '#f43f5e' },
    { key: 'dark', n: summary.noPicture, label: t('noPicture', { count: summary.noPicture }), dot: '#f97316' },
    { key: 'drift', n: summary.behind, label: t('needsUpdate', { count: summary.behind }), dot: '#f59e0b' },
  ];

  const a = summary.action;
  const shown = a ? a.places.slice(0, ALERT_PLACES_SHOWN) : [];
  const hidden = a ? a.places.length - shown.length : 0;

  return (
    <div className={className} role="group" aria-label={t('aria')} data-testid="fleet-live-summary">
      <p className="text-[12.5px] font-black text-slate-900">
        {t('screens', { count: summary.total })}
        <span className="mx-1.5 text-slate-300" aria-hidden>·</span>
        <span className="inline-flex items-center gap-1 text-emerald-700">
          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
          {t('playing', { count: summary.playing })}
        </span>
      </p>
      {chips.some((c) => c.n > 0) && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {chips.filter((c) => c.n > 0).map((c) => {
            const on = filter === c.key;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => onFilter(on ? 'all' : c.key)}
                title={on ? t('showAll') : t('filterHint')}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-bold transition-colors ${
                  on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.dot }} aria-hidden />
                {c.label}
              </button>
            );
          })}
        </div>
      )}
      {/* Calm facts — states that heal themselves are visible, never an ask. */}
      {(summary.syncing > 0 || summary.appUpdating > 0) && (
        <ul className="mt-1.5 space-y-0.5 text-[11px] font-semibold text-slate-500">
          {summary.syncing > 0 && <li>{t('syncing', { count: summary.syncing })}</li>}
          {summary.appUpdating > 0 && <li>{t('appUpdating', { count: summary.appUpdating })}</li>}
        </ul>
      )}
      <div className="mt-2 pt-2 border-t border-slate-100">
        {a ? (
          <>
            <p className="text-[12px] font-bold text-slate-800">
              {a.kind === 'emergency'
                ? t('actionEmergency', { count: a.count })
                : t(ALERT_KEY[a.kind], { count: a.count })}
            </p>
            <ul className="mt-1 space-y-0.5" aria-label={t('placesAria')}>
              {shown.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onAlert(a.kind, p.id)}
                    className="w-full flex items-center gap-1.5 rounded-lg px-1.5 py-1 -mx-1.5 text-left text-[12px] font-bold text-slate-800 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    data-testid="fleet-live-summary-place"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {a.kind === 'emergency' ? p.name : t('placeLine', { location: p.name, count: p.count })}
                    </span>
                    <span className="shrink-0 text-[11.5px] font-black" style={{ color: 'var(--brand-primary, #4f46e5)' }}>
                      {t('fix')}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-primary, #4f46e5)' }} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            {hidden > 0 && (
              <button
                type="button"
                onClick={() => onFilter(a.kind === 'emergency' ? 'emergency' : a.kind)}
                className="mt-0.5 text-[11.5px] font-black hover:underline underline-offset-2"
                style={{ color: 'var(--brand-primary, #4f46e5)' }}
              >
                {t('morePlaces', { count: hidden })}
              </button>
            )}
          </>
        ) : (
          <p className="text-[12px] font-semibold text-emerald-700">{summary.total > 0 ? t('allGood') : t('noScreens')}</p>
        )}
      </div>
    </div>
  );
}
