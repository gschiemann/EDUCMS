'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Activity, AlertTriangle, ArrowUpRight, Check, CircleDollarSign, Loader2, Plus, RefreshCw, Save, X } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { centsToDollarInput, dollarsToCents, formatUsd, optionalDate, type PlatformCost } from '@/lib/business-profit';
import { useBusinessProfit, useSavePlatformCost, useUpdatePlatformCost } from '@/hooks/use-business-profit';
import { CapacityCard } from '../efficiency/CapacityCard';

const PROVIDERS = ['Supabase', 'Railway', 'Vercel', 'Redis', 'Email', 'AI', 'Other'];
const FIELD = 'mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100';
const LABEL = 'block text-xs font-semibold text-slate-700';

type FormValues = {
  provider: string; service: string; planName: string; monthlyCost: string;
  budget: string; nextBillAt: string; notes: string;
};
const EMPTY_FORM: FormValues = { provider: 'Supabase', service: '', planName: '', monthlyCost: '', budget: '', nextBillAt: '', notes: '' };

function formFromCost(cost: PlatformCost): FormValues {
  return {
    provider: PROVIDERS.includes(cost.provider) ? cost.provider : 'Other',
    service: cost.provider === 'Other' || !PROVIDERS.includes(cost.provider) ? `${cost.provider} · ${cost.service}` : cost.service,
    planName: cost.planName ?? '', monthlyCost: centsToDollarInput(cost.monthlyCostCents),
    budget: centsToDollarInput(cost.budgetCents), nextBillAt: cost.nextBillAt?.slice(0, 10) ?? '', notes: cost.notes ?? '',
  };
}

export default function BusinessProfitPage() {
  const t = useTranslations('businessProfit');
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const [mounted, setMounted] = useState(false);
  const [editing, setEditing] = useState<PlatformCost | null>(null);
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const query = useBusinessProfit(mounted && user?.role === 'SUPER_ADMIN');
  const createCost = useSavePlatformCost();
  const updateCost = useUpdatePlatformCost();
  const isSaving = createCost.isPending || updateCost.isPending;

  // The auth store reads browser storage; wait until after hydration before trusting it.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) return <div className="min-h-screen flex items-center justify-center bg-slate-50"><Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-label={t('loading')} /></div>;
  if (!user || user.role !== 'SUPER_ADMIN') return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-rose-500" aria-hidden />
        <h1 className="text-lg font-extrabold text-slate-900">{t('ownerOnlyTitle')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('ownerOnlyBody')}</p>
        <button onClick={() => router.back()} className="mt-4 min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-bold text-white">{t('goBack')}</button>
      </div>
    </div>
  );

  const beginCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setNotice(''); };
  const beginEdit = (cost: PlatformCost) => { setEditing(cost); setForm(formFromCost(cost)); setFormError(''); setNotice(''); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(''); setNotice('');
    const monthlyCostCents = dollarsToCents(form.monthlyCost);
    const budgetCents = form.budget.trim() ? dollarsToCents(form.budget) : null;
    if (!form.service.trim()) return setFormError(t('serviceRequired'));
    if (monthlyCostCents === null) return setFormError(t('invalidAmount'));
    if (form.budget.trim() && budgetCents === null) return setFormError(t('invalidBudget'));
    const body = {
      provider: form.provider === 'Other' ? (form.service.trim().split(' · ')[0] || 'Other') : form.provider,
      service: form.provider === 'Other' && form.service.includes(' · ') ? form.service.slice(form.service.indexOf(' · ') + 3).trim() : form.service.trim(),
      planName: form.planName.trim() || undefined,
      monthlyCostCents,
      budgetCents: budgetCents ?? undefined,
      nextBillAt: optionalDate(form.nextBillAt),
      notes: form.notes.trim() || undefined,
    };
    try {
      if (editing) await updateCost.mutateAsync({ id: editing.id, ...body });
      else await createCost.mutateAsync(body);
      setNotice(editing ? t('updated') : t('saved'));
      setEditing(null); setForm(EMPTY_FORM);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('saveError'));
    }
  };

  const archiveToggle = async (cost: PlatformCost) => {
    try {
      await updateCost.mutateAsync({ id: cost.id, active: !cost.active });
      setNotice(cost.active ? t('archived') : t('restored'));
    } catch (error) { setFormError(error instanceof Error ? error.message : t('saveError')); }
  };

  const data = query.data;
  const activeCosts = data?.costs.filter((cost) => cost.active) ?? [];
  const archivedCosts = data?.costs.filter((cost) => !cost.active) ?? [];
  const money = (cents: number) => formatUsd(cents);
  const loadError = query.error instanceof Error ? query.error.message : t('loadError');

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5 sm:space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-extrabold text-slate-950 sm:text-3xl"><CircleDollarSign className="h-7 w-7 text-indigo-600" aria-hidden />{t('title')}</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">{t('subtitle')}</p>
            {data && <p className="mt-1 text-xs text-slate-400">{t('asOf', { date: new Date(data.asOf).toLocaleString() })}</p>}
          </div>
          <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-bold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-60">
            {query.isFetching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}{t('refresh')}
          </button>
        </header>

        {query.isError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><span>{loadError}</span><button type="button" onClick={() => void query.refetch()} className="min-h-10 rounded-lg border border-rose-300 bg-white px-3 font-bold">{t('retry')}</button></div>}
        {query.isLoading && !data && <div className="flex min-h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white"><Loader2 className="h-7 w-7 animate-spin text-indigo-600" aria-label={t('loading')} /></div>}

        {data && <>
          <section aria-label={t('summary')} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label={t('monthlyRevenue')} value={money(data.revenue.committedMonthlyCents)} note={t('revenueNote', { customers: data.revenue.activeCustomers, screens: data.revenue.paidScreens })} tone="indigo" />
            <MetricCard label={t('recordedCosts')} value={money(data.profit.monthlyCostCents)} note={data.profit.coverage === 'complete' ? t('coverageComplete') : t('coveragePartial')} tone="slate" />
            <MetricCard label={t('estimatedProfit')} value={money(data.profit.estimatedMonthlyProfitCents)} note={t('profitNote')} tone={data.profit.estimatedMonthlyProfitCents < 0 ? 'rose' : 'emerald'} />
            <MetricCard label={t('estimatedMargin')} value={data.profit.marginPercent === null ? t('notAvailable') : `${data.profit.marginPercent.toFixed(1)}%`} note={t('marginNote')} tone="violet" />
          </section>

          <section className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
              <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden /><div>
                <h2 className="text-sm font-extrabold text-amber-950">{t('estimateDisclosureTitle')}</h2>
                <p className="mt-1 text-sm leading-6 text-amber-900">{t('estimateDisclosure')}</p>
                {(data.revenue.unpricedCustomers > 0 || data.profit.coverage === 'partial') && <p className="mt-2 text-sm font-semibold text-amber-950">{t('missingData', { unpriced: data.revenue.unpricedCustomers, coverage: data.profit.coverage === 'partial' ? t('partialCoverage') : t('completeCoverage') })}</p>}
              </div></div>
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-amber-200 pt-3 text-sm">
                <div><p className="text-xs text-amber-800">{t('openReceivables')}</p><p className="font-bold text-amber-950">{money(data.receivables.openCents)}</p></div>
                <div><p className="text-xs text-amber-800">{t('overdueReceivables')}</p><p className="font-bold text-amber-950">{money(data.receivables.overdueCents)}</p></div>
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-center gap-2"><Activity className="h-5 w-5 text-indigo-600" aria-hidden /><h2 className="text-base font-extrabold text-slate-900">{t('headroomTitle')}</h2></div>
              <p className="mt-2 text-sm leading-6 text-slate-600">{t('headroomBody')}</p>
              <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">{t('noAutoUpgrade')}</p>
            </div>
          </section>

          {data.recommendations.length > 0 && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="text-base font-extrabold text-slate-900">{t('recommendations')}</h2>
            <ul className="mt-3 grid gap-2 md:grid-cols-2">
              {data.recommendations.map((item) => <li key={item.id} className={`rounded-xl border p-3 ${item.tone === 'critical' ? 'border-rose-200 bg-rose-50' : item.tone === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-indigo-100 bg-indigo-50/60'}`}>
                <p className="text-sm font-bold text-slate-900">{item.title}</p><p className="mt-1 text-sm text-slate-700">{item.detail}</p>
                {item.href && <Link href={item.href} className="mt-2 inline-flex min-h-9 items-center gap-1 text-sm font-bold text-indigo-700 underline underline-offset-2">{t('reviewRecommendation')} <ArrowUpRight className="h-4 w-4" aria-hidden /></Link>}
              </li>)}
            </ul>
          </section>}

          <section className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(19rem,.85fr)]">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-extrabold text-slate-900">{t('costRegister')}</h2><p className="mt-1 text-sm text-slate-500">{t('costRegisterNote')}</p></div>
                <button type="button" onClick={beginCreate} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-sm font-bold text-indigo-800 hover:bg-indigo-100"><Plus className="h-4 w-4" aria-hidden />{t('addCost')}</button>
              </div>
              {activeCosts.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center"><p className="font-semibold text-slate-800">{t('emptyTitle')}</p><p className="mt-1 text-sm text-slate-500">{t('emptyBody')}</p></div> : <ul className="mt-4 divide-y divide-slate-100">
                {activeCosts.map((cost) => <CostRow key={cost.id} cost={cost} money={money} t={t} onEdit={() => beginEdit(cost)} onToggle={() => void archiveToggle(cost)} busy={isSaving} />)}
              </ul>}
              {archivedCosts.length > 0 && <details className="mt-4 border-t border-slate-100 pt-3"><summary className="min-h-10 cursor-pointer py-2 text-sm font-semibold text-slate-600">{t('archivedCosts', { count: archivedCosts.length })}</summary><ul className="divide-y divide-slate-100">{archivedCosts.map((cost) => <CostRow key={cost.id} cost={cost} money={money} t={t} onEdit={() => beginEdit(cost)} onToggle={() => void archiveToggle(cost)} busy={isSaving} />)}</ul></details>}
            </div>

            <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5" aria-label={editing ? t('editCost') : t('newCost')}>
              <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-extrabold text-slate-900">{editing ? t('editCost') : t('newCost')}</h2><p className="mt-1 text-sm text-slate-500">{t('manualEntryNote')}</p></div>
                {editing && <button type="button" onClick={beginCreate} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"><X className="h-4 w-4" aria-hidden />{t('cancel')}</button>}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-1"><span className={LABEL}>{t('provider')}</span><select className={FIELD} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>{PROVIDERS.map((provider) => <option key={provider}>{provider}</option>)}</select></label>
                <label className="sm:col-span-1"><span className={LABEL}>{t('service')}</span><input required maxLength={100} className={FIELD} value={form.service} onChange={(e) => setForm({ ...form, service: e.target.value })} placeholder={t('servicePlaceholder')} /></label>
                <label><span className={LABEL}>{t('planName')}</span><input maxLength={100} className={FIELD} value={form.planName} onChange={(e) => setForm({ ...form, planName: e.target.value })} placeholder={t('optional')} /></label>
                <label><span className={LABEL}>{t('monthlyAmount')}</span><div className="relative mt-1"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">$</span><input aria-label={t('monthlyAmount')} required inputMode="decimal" className={`${FIELD} mt-0 pl-7`} value={form.monthlyCost} onChange={(e) => setForm({ ...form, monthlyCost: e.target.value })} placeholder="0.00" aria-describedby="amount-hint" /></div><span id="amount-hint" className="mt-1 block text-[11px] text-slate-500">{t('monthlyAmountHint')}</span></label>
                <label><span className={LABEL}>{t('monthlyBudget')}</span><div className="relative mt-1"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-slate-500">$</span><input aria-label={t('monthlyBudget')} inputMode="decimal" className={`${FIELD} mt-0 pl-7`} value={form.budget} onChange={(e) => setForm({ ...form, budget: e.target.value })} placeholder={t('optional')} /></div></label>
                <label><span className={LABEL}>{t('nextBill')}</span><input type="date" className={FIELD} value={form.nextBillAt} onChange={(e) => setForm({ ...form, nextBillAt: e.target.value })} /></label>
                <label className="sm:col-span-2"><span className={LABEL}>{t('notes')}</span><textarea maxLength={1000} rows={3} className={`${FIELD} min-h-20 py-2`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={t('notesPlaceholder')} /></label>
              </div>
              {formError && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-2 text-sm text-rose-700">{formError}</p>}
              {notice && <p role="status" className="mt-3 flex items-center gap-1 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800"><Check className="h-4 w-4" aria-hidden />{notice}</p>}
              <button type="submit" disabled={isSaving} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"><Save className="h-4 w-4" aria-hidden />{isSaving ? t('saving') : editing ? t('saveChanges') : t('saveCost')}</button>
            </form>
          </section>

          <CapacityCard />
        </>}
      </div>
    </main>
  );
}

function MetricCard({ label, value, note, tone }: { label: string; value: string; note: string; tone: 'indigo' | 'slate' | 'rose' | 'emerald' | 'violet' }) {
  const style = { indigo: 'border-indigo-100 bg-indigo-50/80 text-indigo-700', slate: 'border-slate-200 bg-white text-slate-700', rose: 'border-rose-100 bg-rose-50 text-rose-700', emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700', violet: 'border-violet-100 bg-violet-50 text-violet-700' }[tone];
  return <div className={`min-w-0 rounded-2xl border p-4 shadow-sm sm:p-5 ${style}`}><p className="text-xs font-bold uppercase tracking-wide opacity-80">{label}</p><p className="mt-2 break-words text-2xl font-extrabold text-slate-950 sm:text-3xl">{value}</p><p className="mt-1 text-xs leading-5 text-slate-600">{note}</p></div>;
}

function CostRow({ cost, money, t, onEdit, onToggle, busy }: { cost: PlatformCost; money: (cents: number) => string; t: (key: string, values?: Record<string, string | number>) => string; onEdit: () => void; onToggle: () => void; busy: boolean }) {
  const currency = money(cost.monthlyCostCents);
  return <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="font-bold text-slate-900">{cost.provider} <span className="font-medium text-slate-600">· {cost.service}</span></p><span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{t('manualSource')}</span>{!cost.active && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{t('archived')}</span>}</div>
      <p className="mt-1 text-xs text-slate-500">{cost.planName && <>{cost.planName} · </>}{t('observedAt', { date: new Date(cost.observedAt).toLocaleDateString() })}{cost.nextBillAt && ` · ${t('nextBillAt', { date: new Date(cost.nextBillAt).toLocaleDateString() })}`}</p>
      {cost.notes && <p className="mt-1 text-xs text-slate-600">{cost.notes}</p>}
      {cost.budgetCents != null && <p className="mt-1 text-xs text-slate-500">{t('budgetLabel', { amount: money(cost.budgetCents) })}</p>}
    </div>
    <div className="flex items-center justify-between gap-3 sm:justify-end"><p className="text-lg font-extrabold tabular-nums text-slate-900">{currency}<span className="ml-1 text-xs font-medium text-slate-500">{t('perMonth')}</span></p><div className="flex gap-1"><button type="button" disabled={busy} onClick={onEdit} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{t('edit')}</button><button type="button" disabled={busy} onClick={onToggle} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{cost.active ? t('archive') : t('restore')}</button></div></div>
  </li>;
}
