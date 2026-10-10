'use client';

/**
 * /super/customers — CUSTOMER MANAGEMENT CONSOLE (2026-10-10), the roster.
 *
 * Every top-level customer organization, searched / filtered / sorted / paged ON THE SERVER
 * (GET /super/customers), so the page stays fast with hundreds of rows. No polling: the list is
 * read on mount and when a filter changes. SUPER_ADMIN only — denied here by default and enforced
 * by the API (@RequireRoles(SUPER_ADMIN) on the controller).
 */
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { AlertCircle, Loader2, Plus, Search, Users } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { useCustomerList } from '@/hooks/use-customer-console';
import {
  BILLING_MODES,
  CUSTOMER_STATUSES,
  DEFAULT_FILTERS,
  PLANS,
  TONE_CLASSES,
  formatCents,
  formatDate,
  monthlyBillCents,
  seatTone,
  statusTone,
  VERTICAL_IDS,
  type ListFilters,
} from '@/lib/customer-console';

const SELECT = 'min-h-10 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-700';

export default function CustomersPage() {
  const t = useTranslations('customerConsole');
  const locale = useLocale();
  const user = useAppStore((s) => s.user);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [filters, setFilters] = useState<ListFilters>(DEFAULT_FILTERS);
  const [search, setSearch] = useState('');
  // Debounce the search box so typing is one request, not one per keystroke.
  useEffect(() => {
    const id = window.setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search, page: 1 })), 300);
    return () => window.clearTimeout(id);
  }, [search]);

  const isOwner = mounted && user?.role === 'SUPER_ADMIN';
  const list = useCustomerList(filters, isOwner);
  const set = (patch: Partial<ListFilters>) => setFilters((f) => ({ ...f, ...patch, page: patch.page ?? 1 }));
  const filtered = useMemo(
    () => Object.entries(filters).some(([k, v]) => k !== 'page' && k !== 'pageSize' && k !== 'sort' && k !== 'dir' && v !== (DEFAULT_FILTERS as any)[k]),
    [filters],
  );

  if (!mounted) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="w-6 h-6 animate-spin text-slate-400" aria-hidden /></div>;
  }
  if (!isOwner) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center max-w-sm">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" aria-hidden />
          <h1 className="text-lg font-bold text-slate-900">{t('ownerOnlyTitle')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('ownerOnlyBody')}</p>
        </div>
      </div>
    );
  }

  const data = list.data;
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-6 h-6 text-indigo-600" aria-hidden /> {t('title')}
            </h1>
            <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
          </div>
          <Link
            href="/super/customers/new"
            className="inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800"
          >
            <Plus className="w-4 h-4" aria-hidden /> {t('newCustomer')}
          </Link>
        </header>

        <section className="bg-white rounded-2xl border border-slate-200 p-3 space-y-3" aria-label={t('title')}>
          <label className="relative block">
            <span className="sr-only">{t('searchPlaceholder')}</span>
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" aria-hidden />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-full min-h-10 rounded-lg border border-slate-200 pl-9 pr-3 text-sm"
            />
          </label>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-8">
            <select aria-label={t('colIndustry')} className={SELECT} value={filters.vertical} onChange={(e) => set({ vertical: e.target.value })}>
              <option value="">{t('allIndustries')}</option>
              {VERTICAL_IDS.map((v) => <option key={v} value={v}>{t(`vertical.${v}`)}</option>)}
            </select>
            <select aria-label={t('colBilling')} className={SELECT} value={filters.billingMode} onChange={(e) => set({ billingMode: e.target.value })}>
              <option value="">{t('allBillingMethods')}</option>
              {[...BILLING_MODES, 'NONE'].map((m) => <option key={m} value={m}>{t(`billing.${m}`)}</option>)}
            </select>
            <select aria-label={t('colStatus')} className={SELECT} value={filters.status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">{t('allStatuses')}</option>
              {CUSTOMER_STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
            </select>
            <select aria-label={t('colPlan')} className={SELECT} value={filters.plan} onChange={(e) => set({ plan: e.target.value })}>
              <option value="">{t('allPlans')}</option>
              {PLANS.map((p) => <option key={p} value={p}>{t(`plan.${p}`)}</option>)}
            </select>
            <select aria-label={t('colScreens')} className={SELECT} value={filters.seats} onChange={(e) => set({ seats: e.target.value })}>
              <option value="">{t('anySeats')}</option>
              <option value="over">{t('seatsOver')}</option>
              <option value="full">{t('seatsFull')}</option>
            </select>
            <select aria-label={t('colRenewal')} className={SELECT} value={filters.renewal} onChange={(e) => set({ renewal: e.target.value })}>
              <option value="">{t('anyRenewal')}</option>
              <option value="due30">{t('renewalDue30')}</option>
              <option value="overdue">{t('renewalOverdue')}</option>
            </select>
            <select aria-label={t('sortBy')} className={SELECT} value={filters.sort} onChange={(e) => set({ sort: e.target.value })}>
              {(['name', 'renewal', 'seats', 'lastActivity', 'created'] as const).map((s) => <option key={s} value={s}>{t('sortBy')}: {t(`sort.${s}`)}</option>)}
            </select>
            <select aria-label={t('sortDirection')} className={SELECT} value={filters.dir} onChange={(e) => set({ dir: e.target.value as 'asc' | 'desc' })}>
              <option value="asc">{t('ascending')}</option>
              <option value="desc">{t('descending')}</option>
            </select>
          </div>
          {filtered && (
            <button type="button" onClick={() => { setSearch(''); setFilters(DEFAULT_FILTERS); }} className="text-sm font-semibold text-indigo-700 min-h-10">
              {t('clearFilters')}
            </button>
          )}
        </section>

        {list.isError ? (
          <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-4">{t('loadFailed')}</p>
        ) : !data ? (
          <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-slate-400" aria-hidden /></div>
        ) : (
          <>
            <p className="text-sm text-slate-500" aria-live="polite">{t('results', { count: data.total })}</p>
            {data.rows.length === 0 ? (
              <p className="text-sm text-slate-500 bg-white border border-slate-200 rounded-xl p-6 text-center">{t('empty')}</p>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
                <table className="w-full text-sm min-w-[960px]">
                  <thead>
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-100">
                      <th className="px-4 py-3">{t('colName')}</th>
                      <th className="px-4 py-3">{t('colScreens')}</th>
                      <th className="px-4 py-3">{t('colPlan')}</th>
                      <th className="px-4 py-3">{t('colBilling')}</th>
                      <th className="px-4 py-3">{t('colStatus')}</th>
                      <th className="px-4 py-3">{t('colMonthly')}</th>
                      <th className="px-4 py-3">{t('colRenewal')}</th>
                      <th className="px-4 py-3">{t('colActivity')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60" data-testid="customer-row">
                        <td className="px-4 py-3">
                          <Link href={`/super/customers/${r.id}`} className="font-semibold text-slate-900 hover:text-indigo-700">{r.name}</Link>
                          <div className="text-xs text-slate-500">
                            {t(`vertical.${VERTICAL_IDS.includes(r.vertical) ? r.vertical : 'K12'}`)} · /{r.slug}
                            {r.locations > 0 && <> · {t('locations', { count: r.locations })}</>}
                          </div>
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE_CLASSES[seatTone(r.seatsUsed, r.seatLimit)]}`}>
                            {r.seatsUsed} / {r.seatLimit ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3">{r.plan === 'MONTHLY' || r.plan === 'ANNUAL' ? t(`plan.${r.plan}`) : r.plan ?? '—'}</td>
                        <td className="px-4 py-3">{t(`billing.${r.billingMode ?? 'NONE'}`)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${TONE_CLASSES[statusTone(r.status)]}`}>{t(`status.${r.status}`)}</span>
                          {r.overdueInvoices > 0 && <div className="text-xs text-amber-700 mt-1">{t('overdueInvoices', { count: r.overdueInvoices })}</div>}
                        </td>
                        <td className="px-4 py-3 tabular-nums">{formatCents(monthlyBillCents(r), locale)}</td>
                        <td className="px-4 py-3">{formatDate(r.renewalDate, locale)}</td>
                        <td className="px-4 py-3 text-slate-500">{r.lastActivityAt ? formatDate(r.lastActivityAt, locale) : t('never')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.pages > 1 && (
              <nav className="flex items-center justify-between gap-2" aria-label={t('pageOf', { page: data.page, pages: data.pages })}>
                <button type="button" disabled={data.page <= 1} onClick={() => set({ page: data.page - 1 })} className="min-h-10 px-4 rounded-lg border border-slate-200 bg-white text-sm disabled:opacity-40">
                  {t('prev')}
                </button>
                <span className="text-sm text-slate-500">{t('pageOf', { page: data.page, pages: data.pages })}</span>
                <button type="button" disabled={data.page >= data.pages} onClick={() => set({ page: data.page + 1 })} className="min-h-10 px-4 rounded-lg border border-slate-200 bg-white text-sm disabled:opacity-40">
                  {t('next')}
                </button>
              </nav>
            )}
          </>
        )}
      </div>
    </div>
  );
}
