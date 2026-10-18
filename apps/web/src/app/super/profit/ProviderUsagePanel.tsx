'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ArrowUpRight, Loader2, RefreshCw } from 'lucide-react';
import { useProviderUsage } from '@/hooks/use-business-profit';
import { formatUsd, type ProviderUsageSource } from '@/lib/business-profit';

const PROVIDERS: ProviderUsageSource['provider'][] = ['vercel', 'railway', 'supabase'];

export function ProviderUsagePanel() {
  const t = useTranslations('businessProfit');
  const locale = useLocale();
  const localeTag = locale === 'es' ? 'es-ES' : locale === 'zh' ? 'zh-CN' : 'en-US';
  const query = useProviderUsage();
  const date = (value: string) => new Intl.DateTimeFormat(localeTag, { dateStyle: 'medium' }).format(new Date(value));
  const dateTime = (value: string) => new Intl.DateTimeFormat(localeTag, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  const money = (cents: number) => formatUsd(cents, localeTag);

  return <section aria-labelledby="provider-usage-title" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id="provider-usage-title" className="text-base font-extrabold text-slate-900">{t('providerUsageTitle')}</h2>
        <p className="mt-1 max-w-4xl text-sm leading-5 text-slate-600">{t('providerUsageDisclosure')}</p>
        {query.data && <p className="mt-1 text-xs text-slate-400">{t('providerUsageAsOf', { date: dateTime(query.data.asOf) })}</p>}
      </div>
      <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
        {query.isFetching ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}{t('providerUsageRefresh')}
      </button>
    </div>

    {query.isLoading && !query.data && <div className="mt-4 flex min-h-20 items-center justify-center rounded-xl bg-slate-50"><Loader2 className="h-5 w-5 animate-spin text-indigo-600" aria-label={t('loading')} /></div>}
    {query.isError && <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><span>{t('providerUsageError')}</span><button type="button" onClick={() => void query.refetch()} className="min-h-10 rounded-lg border border-rose-300 bg-white px-3 font-bold">{t('retry')}</button></div>}

    {query.data && <ul className="mt-4 grid gap-3 md:grid-cols-3">
      {PROVIDERS.map((provider) => {
        const source = query.data.sources.find((item) => item.provider === provider);
        return <li key={provider} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold capitalize text-slate-900">{provider}</h3>
            <span className={`rounded-full px-2 py-1 text-[11px] font-bold ${source?.state === 'connected' ? 'bg-emerald-100 text-emerald-800' : source?.state === 'unavailable' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700'}`}>
              {t(`providerStates.${source?.state ?? 'unavailable'}`)}
            </span>
          </div>
          <p className="mt-2 break-words text-xs text-slate-500">{source ? t('providerScope', { scope: t(`providerScopes.${source.scope}`) }) : t('providerUnavailable')}</p>
          <p className="mt-2 break-words text-xl font-extrabold tabular-nums text-slate-950">
            {source?.accruedCostCents == null ? t('providerUsageUnknown') : money(source.accruedCostCents)}
          </p>
          <p className="text-xs font-medium text-slate-500">{t('providerAccruedCost')}</p>
          {source?.periodStart && source.periodEnd && <p className="mt-2 break-words text-xs text-slate-600">{t('providerPeriod', { start: date(source.periodStart), end: date(source.periodEnd) })}</p>}
          {source?.observedAt && <p className="mt-1 break-words text-xs text-slate-500">{t('providerObservedAt', { date: dateTime(source.observedAt) })}</p>}
          {source && source.items.length > 0 && <details className="mt-2 border-t border-slate-200 pt-2">
            <summary className="min-h-9 cursor-pointer py-2 text-xs font-semibold text-slate-600">{t('providerUsageBreakdown', { count: source.items.length })}</summary>
            <ul className="space-y-1">
              {source.items.map((item, index) => <li key={`${item.label}-${index}`} className="flex items-start justify-between gap-2 text-xs text-slate-600"><span className="min-w-0 break-words">{item.label}</span><span className="shrink-0 tabular-nums">{money(item.costCents)}</span></li>)}
            </ul>
          </details>}
          {source?.href && <a href={source.href} target={source.href.startsWith('/') ? undefined : '_blank'} rel={source.href.startsWith('/') ? undefined : 'noreferrer'} className="mt-2 inline-flex min-h-9 items-center gap-1 text-xs font-bold text-indigo-700 underline underline-offset-2">{t('providerConsoleLink')}<ArrowUpRight className="h-3.5 w-3.5" aria-hidden /></a>}
        </li>;
      })}
    </ul>}
  </section>;
}
