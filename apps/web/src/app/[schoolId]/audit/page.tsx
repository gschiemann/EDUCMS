"use client";

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileClock, Download, ChevronDown, ChevronLeft, ChevronRight, Loader2, History, ShieldCheck, RefreshCw, SlidersHorizontal } from 'lucide-react';
import type { ActivityCategory, ActivityItem } from '@cms/api-types';
import { RoleGate } from '@/components/RoleGate';
import { useAuditLog, useUsers } from '@/hooks/use-api';
import { API_URL } from '@/lib/api-url';
import { useUIStore } from '@/store/ui-store';
import { useAppStore } from '@/lib/store';
import { appAlert } from '@/components/ui/app-dialog';
import { DateTimeField } from '@/components/ui/date-time-field';
import { activityLines, type ActivityTranslate } from '@/lib/activity/activityFeed';
import { ActivityIconChip } from '@/components/activity/ActivityIcon';
import { useActivityTime } from '@/components/activity/RecentActivityCard';
import { useLocaleSwitch } from '@/i18n/I18nProvider';
import { LOCALE_HTML_LANG } from '@/i18n/config';

const PAGE_SIZE = 50;

/**
 * Activity (2026-10-24). Customers read what people did, in sentences — the
 * same allowlist and wording as Home's "Recent activity" — grouped by day and
 * filterable by kind and person. The raw audit trail (every machine row, raw
 * action codes, details) is the owner's: a SUPER_ADMIN gets an "All events"
 * switch, and the API refuses that view to everyone else.
 */
const CATEGORIES: Array<'all' | ActivityCategory> = ['all', 'content', 'screens', 'emergency', 'team', 'security', 'settings'];

/** The owner's raw view keeps its action picker (action codes are an owner tool). */
const ACTION_OPTIONS = [
  '',
  'TRIGGER_EMERGENCY',
  'CLEAR_EMERGENCY',
  'TRIGGER_EMERGENCY_DRILL',
  'CLEAR_EMERGENCY_DRILL',
  'DRILL_ENDED_BY_LIVE_ALERT',
  'AUTH_LOGIN_SUCCESS',
  'AUTH_LOGIN_FAILED',
  'USER_INVITED',
  'USER_ROLE_CHANGED',
  'ASSET_UPLOADED',
  'ASSET_DELETED',
];

export default function AuditPage() {
  const t = useTranslations();
  return (
    <RoleGate
      allowedRoles={['admin', 'SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}
      fallback={
        <div className="text-center py-24 text-sm text-slate-500">
          {t('opsPages.noAuditPermission')}
        </div>
      }
    >
      <AuditViewer />
    </RoleGate>
  );
}

function AuditViewer() {
  const t = useTranslations();
  const tp = useTranslations('activityPage');
  const tCategory = useTranslations('activityFeed.category') as unknown as (key: string) => string;
  const userRole = useUIStore((s) => s.user?.role);
  const isOwner = userRole === 'SUPER_ADMIN';
  const isViewer = userRole === 'RESTRICTED_VIEWER';
  const [view, setView] = useState<'activity' | 'all'>('activity');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [actorId, setActorId] = useState('');
  const [category, setCategory] = useState<'all' | ActivityCategory>('all');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersActive = !!(from || to || actorId || (view === 'all' && action));
  // Coarse pointer (phone / tablet) keeps the NATIVE date input — the OS
  // wheel is the right control there. Read once, lazily.
  const [coarsePointer] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches,
  );

  const { data: users } = useUsers();
  const params = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      actorId: actorId || undefined,
      action: view === 'all' ? action || undefined : undefined,
      category: view === 'activity' && category !== 'all' ? category : undefined,
      view,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [from, to, actorId, action, category, view, page],
  );
  const query = useAuditLog(params);
  const { data, isLoading, isFetching, isError, refetch } = query;
  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const resetPage = () => setPage(0);

  const downloadCsv = async () => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    if (actorId) qs.set('actorId', actorId);
    if (params.action) qs.set('action', params.action);
    if (params.category) qs.set('category', params.category);
    qs.set('view', view);
    const token = useUIStore.getState().token;
    const res = await fetch(`${API_URL}/audit/export?${qs.toString()}`, {
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) {
      await appAlert({
        title: t('opsPages.exportErrorTitle'),
        message: t('opsPages.exportErrorMessage', { status: res.status }),
        tone: 'danger',
      });
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5 pb-10">
      <header className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl shrink-0" style={{ background: 'color-mix(in srgb, var(--brand-primary, #6366f1) 12%, white)', color: 'var(--brand-primary, #4f46e5)' }}>
          <History className="w-5 h-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-[24px] leading-[30px] font-black text-slate-900">{tp('title')}</h1>
          <p className="mt-0.5 text-[13px] leading-snug text-slate-500">{tp('subtitle')}</p>
        </div>
        <button
          onClick={downloadCsv}
          disabled={isViewer}
          title={isViewer ? t('opsPages.readOnlyViewerRole') : undefined}
          className="shrink-0 inline-flex items-center gap-2 min-h-[44px] px-3 sm:px-4 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-sm font-semibold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-4 h-4" aria-hidden /> <span className="hidden sm:inline">{t('opsPages.exportCsv')}</span>
        </button>
      </header>

      {isOwner && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <ShieldCheck className="w-4 h-4 text-amber-700 shrink-0" aria-hidden />
          <div role="radiogroup" aria-label={tp('ownerToggle')} className="inline-flex rounded-lg bg-white border border-amber-200 p-0.5">
            {(['activity', 'all'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={view === v}
                onClick={() => { setView(v); resetPage(); }}
                className={`min-h-[36px] px-3 rounded-md text-[12px] font-bold ${view === v ? 'bg-amber-600 text-white' : 'text-amber-800'}`}
              >
                {v === 'activity' ? tp('customerView') : tp('ownerToggle')}
              </button>
            ))}
          </div>
          <span className="text-[12px] text-amber-900">{tp('ownerNote')}</span>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-3">
        {view === 'activity' && (
          <div role="tablist" aria-label={tp('kind')} className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {CATEGORIES.map((c) => {
              const active = c === category;
              return (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => { setCategory(c); resetPage(); }}
                  className={`shrink-0 inline-flex items-center min-h-[40px] px-3.5 rounded-xl border text-[13px] font-bold transition-colors ${
                    active ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {tCategory(c)}
                </button>
              );
            })}
          </div>
        )}
        {/* Phones: the list comes first; person and dates sit behind one
            button (with a dot while any is set). sm+: always shown. */}
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          aria-controls="activity-filters"
          className="sm:hidden inline-flex items-center gap-2 min-h-[44px] px-3.5 rounded-xl border border-slate-200 bg-white text-[13px] font-bold text-slate-700"
        >
          <SlidersHorizontal className="w-4 h-4" aria-hidden />
          {filtersActive ? tp('filtersOn') : tp('filters')}
          {filtersActive && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" aria-hidden />}
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        <div
          id="activity-filters"
          className={`${filtersOpen ? 'grid' : 'hidden'} sm:grid bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 grid-cols-1 sm:grid-cols-3 gap-3`}
        >
          <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            {tp('person')}
            <select
              value={actorId}
              onChange={(e) => { setActorId(e.target.value); resetPage(); }}
              className="min-h-[44px] border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">{tp('everyone')}</option>
              {Array.isArray(users) && (users as Array<{ id: string; email: string; firstName?: string | null; lastName?: string | null }>).map((u) => (
                <option key={u.id} value={u.id}>
                  {[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            <label htmlFor="audit-from">{t('opsPages.from')}</label>
            {coarsePointer ? (
              <input id="audit-from" type="datetime-local" value={from} onChange={(e) => { setFrom(e.target.value); resetPage(); }} className="min-h-[44px] border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            ) : (
              <DateTimeField id="audit-from" value={from} onChange={(v) => { setFrom(v); resetPage(); }} ariaLabel={t('opsPages.from')} />
            )}
          </div>
          <div className="flex flex-col gap-1 text-xs font-semibold text-slate-600">
            <label htmlFor="audit-to">{t('opsPages.to')}</label>
            {coarsePointer ? (
              <input id="audit-to" type="datetime-local" value={to} onChange={(e) => { setTo(e.target.value); resetPage(); }} className="min-h-[44px] border border-slate-200 rounded-lg px-3 py-2 text-sm" />
            ) : (
              <DateTimeField id="audit-to" value={to} onChange={(v) => { setTo(v); resetPage(); }} ariaLabel={t('opsPages.to')} />
            )}
          </div>
          {view === 'all' && (
            <label className="flex flex-col gap-1 text-xs font-semibold text-slate-600 sm:col-span-3">
              {t('opsPages.action')}
              <select value={action} onChange={(e) => { setAction(e.target.value); resetPage(); }} className="min-h-[44px] border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                {ACTION_OPTIONS.map((a) => (
                  <option key={a} value={a}>{a || t('opsPages.allActions')}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {isError && !data ? (
        <div className="rounded-2xl bg-white border border-amber-200 px-5 py-8 text-center">
          <p className="text-[14px] font-semibold text-slate-800">{tp('loadError')}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-4 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-[13px] font-bold"
          >
            <RefreshCw className="w-4 h-4" aria-hidden /> {tp('retry')}
          </button>
        </div>
      ) : view === 'activity' ? (
        <ActivityList items={items as ActivityItem[]} isLoading={isLoading} filtered={!!(from || to || actorId || category !== 'all')} />
      ) : (
        <RawAuditTable items={items as RawAuditRow[]} isLoading={isLoading} />
      )}

      {/* Pagination */}
      {total > 0 && (
        <div className="flex items-center justify-between gap-3 px-1 text-xs text-slate-600">
          <div>
            {t('opsPages.showingRange', { start: page * PAGE_SIZE + 1, end: Math.min((page + 1) * PAGE_SIZE, total), total })}
            {isFetching && <span className="ml-2 text-slate-400">{t('opsPages.refreshing')}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              aria-label={tp('previous')}
              className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden />
            </button>
            <span className="font-semibold tabular-nums">{page + 1} / {pages}</span>
            <button
              onClick={() => setPage((p) => (p + 1 < pages ? p + 1 : p))}
              disabled={page + 1 >= pages}
              aria-label={tp('next')}
              className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Sentences, grouped by day ("Today", "Yesterday", "Mon, Oct 20"). */
function ActivityList({ items, isLoading, filtered }: { items: ActivityItem[]; isLoading: boolean; filtered: boolean }) {
  const tFeed = useTranslations('activityFeed');
  const tp = useTranslations('activityPage');
  const time = useActivityTime();
  const { locale } = useLocaleSwitch();
  const lang = LOCALE_HTML_LANG[locale] ?? 'en';
  const viewerId = useAppStore((s) => (s.user as { id?: string } | null)?.id ?? null);
  const lines = useMemo(
    () => activityLines(items, { t: tFeed as unknown as ActivityTranslate, viewerId }),
    [items, tFeed, viewerId],
  );

  const days = useMemo(() => {
    const out: Array<{ key: string; label: string; rows: typeof lines }> = [];
    const now = new Date();
    const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const today = dayKey(now);
    const yest = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    for (const line of lines) {
      const d = new Date(line.at);
      const key = Number.isFinite(d.getTime()) ? dayKey(d) : 'unknown';
      let label: string;
      if (key === today) label = tFeed('day.today');
      else if (key === yest) label = tFeed('day.yesterday');
      else {
        try {
          label = d.toLocaleDateString(lang, { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
        } catch {
          label = d.toDateString();
        }
      }
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(line);
      else out.push({ key, label, rows: [line] });
    }
    return out;
  }, [lines, tFeed, lang]);

  if (isLoading) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100 animate-pulse" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="px-4 py-3.5 flex items-start gap-3">
            <span className="w-8 h-8 rounded-full bg-slate-100 shrink-0" />
            <span className="flex-1 space-y-2 pt-1">
              <span className="block h-3 w-3/4 rounded bg-slate-100" />
              <span className="block h-2.5 w-1/5 rounded bg-slate-100" />
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (lines.length === 0) {
    return (
      <div className="rounded-2xl bg-white border border-slate-200 px-5 py-12 text-center" data-testid="activity-empty">
        <History className="w-7 h-7 text-slate-300 mx-auto" aria-hidden />
        <p className="mt-3 text-[14px] font-semibold text-slate-700">{filtered ? tp('empty') : tp('emptyAll')}</p>
      </div>
    );
  }
  return (
    <div className="space-y-5" data-testid="activity-list">
      {days.map((day) => (
        <section key={day.key} aria-label={day.label}>
          <h2 className="px-1 mb-2 text-[11px] font-black uppercase tracking-wider text-slate-400">{day.label}</h2>
          <ul className="rounded-2xl bg-white border border-slate-200 overflow-hidden divide-y divide-slate-100">
            {day.rows.map((line) => {
              const when = time(line.at);
              let clock = '';
              try {
                clock = new Date(line.at).toLocaleTimeString(lang, { hour: 'numeric', minute: '2-digit' });
              } catch {
                clock = when.short;
              }
              return (
                <li key={line.key} className="px-4 py-3 flex items-start gap-3" data-category={line.category}>
                  <ActivityIconChip icon={line.icon} tone={line.tone} />
                  <span className="flex-1 min-w-0 text-[13.5px] leading-snug font-semibold text-slate-800">{line.text}</span>
                  <time dateTime={line.at} title={when.full} className="shrink-0 pt-0.5 text-[11.5px] tabular-nums text-slate-400">
                    {clock}
                  </time>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The owner's raw trail: every row, raw action codes, details. */
interface RawAuditRow {
  id: string;
  createdAt: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: string | null;
  user?: { email?: string | null; role?: string | null } | null;
}

function RawAuditTable({ items, isLoading }: { items: RawAuditRow[]; isLoading: boolean }) {
  const t = useTranslations();
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden" data-testid="audit-raw">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 font-bold">
            <tr>
              <th className="text-left px-4 py-3">{t('opsPages.timestamp')}</th>
              <th className="text-left px-4 py-3">{t('opsPages.actor')}</th>
              <th className="text-left px-4 py-3">{t('opsPages.action')}</th>
              <th className="text-left px-4 py-3">{t('opsPages.target')}</th>
              <th className="text-left px-4 py-3">{t('opsPages.details')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin inline" /> {t('opsPages.loading')}
              </td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">{t('opsPages.noEntriesMatch')}</td></tr>
            ) : (
              items.map((row) => (
                <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                  <td className="px-4 py-3 text-xs text-slate-600 font-mono whitespace-nowrap">{new Date(row.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs">
                    <div className="font-semibold text-slate-800">{row.user?.email ?? '—'}</div>
                    <div className="text-[10px] text-slate-400">{row.user?.role ?? ''}</div>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-indigo-700">{row.action}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    <div>{row.targetType}</div>
                    <div className="text-[10px] text-slate-400 font-mono truncate max-w-[220px]">{row.targetId ?? ''}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 max-w-[360px] truncate" title={row.details ?? ''}>{row.details ?? ''}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400 flex items-center gap-1.5">
        <FileClock className="w-3.5 h-3.5" aria-hidden /> {t('opsPages.auditLogTitle')}
      </div>
    </div>
  );
}
