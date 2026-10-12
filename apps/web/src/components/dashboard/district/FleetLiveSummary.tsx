'use client';

/**
 * Fleet map — live summary (2026-10-12, replaces the static "Status guide").
 *
 * Owner: the old box ("Device online · App current · Push live · Picture
 * proof", labelled "not live status") was a legend with no data in it. This
 * card answers the question an operator opens the map with — "is everything
 * playing, and if not, what do I do first?" — for exactly the locations the
 * map is currently showing (the chip filter applies).
 *
 * Every number is read from data the page already holds: the per-location
 * rollup rows (the same ones the chips, pin rings and table grade) and the
 * per-screen render-trust grade the "Need attention" card uses. Nothing is
 * fetched and nothing is guessed: a count we cannot back is simply absent.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import type { LocationRow } from './fleetCommand';

export type LiveSummaryFilter = 'offline' | 'dark' | 'drift';

export interface LiveSummaryScreen {
  tenantId: string | null;
  status: string;
  lastPingAt?: string | null;
  /** The page's own "needs someone" predicate, already evaluated. */
  needsAttention: boolean;
}

export interface LiveSummary {
  total: number;
  playing: number;
  offline: number;
  /** Oldest last-heartbeat among the offline screens (ms), when any is dated. */
  offlineSinceMs: number | null;
  noPicture: number;
  needsUpdate: number;
  /** The single most important thing to do, or null when nothing needs anyone. */
  action:
    | { kind: 'offline' | 'dark' | 'drift'; count: number; tenantId: string; location: string }
    | { kind: 'emergency'; tenantId: string; location: string }
    | null;
}

/** Pure: the summary for the locations currently shown. */
export function summarizeLiveFleet(rows: LocationRow[], screens: LiveSummaryScreen[]): LiveSummary {
  const shown = new Set(rows.map((r) => r.tenantId));
  const mine = screens.filter((s) => s.tenantId != null && shown.has(s.tenantId));
  let offlineSinceMs: number | null = null;
  for (const s of mine) {
    if (s.status !== 'OFFLINE' || !s.lastPingAt) continue;
    const at = Date.parse(s.lastPingAt);
    if (!Number.isFinite(at)) continue;
    if (offlineSinceMs == null || at < offlineSinceMs) offlineSinceMs = at;
  }
  const sum = (pick: (r: LocationRow) => number) => rows.reduce((n, r) => n + pick(r), 0);
  // The location with the most of one problem — ties keep the rollup's own
  // worst-first order, so the card and the table never disagree.
  const worst = (pick: (r: LocationRow) => number) => {
    let best: LocationRow | null = null;
    for (const r of rows) if (pick(r) > 0 && (!best || pick(r) > pick(best))) best = r;
    return best;
  };

  let action: LiveSummary['action'] = null;
  const off = worst((r) => r.screensOffline);
  const dark = worst((r) => r.notPainting);
  const gap = rows.find(
    (r) => r.hasScreens && (r.readiness === 'NEEDS_ATTENTION' || r.readiness === 'NOT_CONFIGURED'),
  );
  const drift = worst((r) => r.contentBehind);
  if (off) action = { kind: 'offline', count: off.screensOffline, tenantId: off.tenantId, location: off.name };
  else if (dark) action = { kind: 'dark', count: dark.notPainting, tenantId: dark.tenantId, location: dark.name };
  else if (gap) action = { kind: 'emergency', tenantId: gap.tenantId, location: gap.name };
  else if (drift) action = { kind: 'drift', count: drift.contentBehind, tenantId: drift.tenantId, location: drift.name };

  return {
    total: mine.length,
    playing: mine.filter((s) => !s.needsAttention).length,
    offline: sum((r) => r.screensOffline),
    offlineSinceMs,
    noPicture: sum((r) => r.notPainting),
    needsUpdate: sum((r) => r.contentBehind),
    action,
  };
}

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

export function FleetLiveSummary({
  summary,
  filter,
  onFilter,
  onSelectLocation,
  className,
  now,
}: {
  summary: LiveSummary;
  filter: string;
  onFilter: (key: LiveSummaryFilter | 'all') => void;
  onSelectLocation: (tenantId: string) => void;
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

  const chips: Array<{ key: LiveSummaryFilter; n: number; label: string; dot: string }> = [
    { key: 'offline', n: summary.offline, label: since ? t('offlineSince', { count: summary.offline, since }) : t('offline', { count: summary.offline }), dot: '#f43f5e' },
    { key: 'dark', n: summary.noPicture, label: t('noPicture', { count: summary.noPicture }), dot: '#f97316' },
    { key: 'drift', n: summary.needsUpdate, label: t('needsUpdate', { count: summary.needsUpdate }), dot: '#f59e0b' },
  ];

  const a = summary.action;
  const actionText = !a
    ? null
    : a.kind === 'emergency'
      ? t('actionEmergency', { location: a.location })
      : t(a.kind === 'offline' ? 'actionOffline' : a.kind === 'dark' ? 'actionDark' : 'actionDrift', { count: a.count, location: a.location });

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
      <div className="mt-2 pt-2 border-t border-slate-100">
        {actionText && a ? (
          <button
            type="button"
            onClick={() => onSelectLocation(a.tenantId)}
            className="w-full text-left inline-flex items-start gap-1.5 text-[12px] font-bold text-slate-800 hover:underline underline-offset-2"
          >
            <span className="min-w-0">{actionText}</span>
            <ArrowRight className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: 'var(--brand-primary, #4f46e5)' }} aria-hidden />
          </button>
        ) : (
          <p className="text-[12px] font-semibold text-emerald-700">{summary.total > 0 ? t('allGood') : t('noScreens')}</p>
        )}
      </div>
    </div>
  );
}
