"use client";

/**
 * /[schoolId]/settings/integrations — the Integrations catalog (§7.7).
 *
 * One truthful catalog of everything this deploy can (and cannot)
 * connect. Every row's state comes from `catalog.ts`, which derives it
 * from a named API field; this file only renders. The four rules that
 * must never be broken here:
 *
 *   1. Exactly one primary action per row, derived from the §11 state.
 *   2. `Unsupported` rows and adapter-pending `Planned` rows without
 *      documentation render NO interactive control — an inert "no action"
 *      note instead. (§11: no `Coming soon` controls that look clickable.)
 *   3. Every row shows which status source produced its state.
 *   4. An unreadable status source produces `Unknown`, never `Available`.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plug, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SettingsPageFrame } from '@/components/settings/shell/SettingsPageFrame';
import { useSettingsShell, type SettingsSearchItem } from '@/components/settings/shell/SettingsShellContext';
import {
  ContextAction,
  ContextModule,
  EditorHead,
  EditorSkeleton,
  StatusPill,
} from '@/components/settings/shell/primitives';
import {
  FAMILY_ROUTES,
  INTEGRATION_FAMILIES,
  countConnected,
  countNeedsAttention,
  matchesSearch,
  matchesStateFilter,
  type IntegrationCatalogEntry,
  type IntegrationFamily,
  type IntegrationStateFilter,
} from '@/components/settings/integrations/catalog';
import { useIntegrationsCatalog } from '@/components/settings/integrations/useIntegrationsCatalog';

const STATE_FILTERS: readonly IntegrationStateFilter[] = [
  'connected',
  'attention',
  'available',
  'external',
  'planned',
];

export default function SettingsIntegrationsPage() {
  const t = useTranslations();
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? '';
  const { setSectionStatus } = useSettingsShell();
  const { entries, loading, degradedSources, refetchAll } = useIntegrationsCatalog();

  const [query, setQuery] = useState('');
  const [family, setFamily] = useState<IntegrationFamily | 'all'>('all');
  const [stateFilter, setStateFilter] = useState<IntegrationStateFilter | 'all'>('all');

  const connectedCount = countConnected(entries);
  const attentionCount = countNeedsAttention(entries);

  // §7.7 index status: a connected provider that needs attention or is
  // degraded is the only thing worth a dot on the Settings index.
  useEffect(() => {
    setSectionStatus('integrations', attentionCount > 0 ? 'attention' : null);
  }, [attentionCount, setSectionStatus]);
  useEffect(() => () => setSectionStatus('integrations', null), [setSectionStatus]);

  const visible = useMemo(
    () =>
      entries.filter(
        (e) =>
          (family === 'all' || e.family === family) &&
          (stateFilter === 'all' || matchesStateFilter(e, stateFilter)) &&
          matchesSearch(e, query),
      ),
    [entries, family, stateFilter, query],
  );

  const grouped = useMemo(
    () =>
      INTEGRATION_FAMILIES.map((f) => ({ family: f, rows: visible.filter((e) => e.family === f) })).filter(
        (g) => g.rows.length > 0,
      ),
    [visible],
  );

  const searchItems = useMemo<readonly SettingsSearchItem[]>(
    () =>
      entries.map((e) => ({
        label: e.name,
        keywords: e.searchTerms,
        href: `/${schoolId}/settings/${e.route}`,
      })),
    [entries, schoolId],
  );

  // MUST be memoized: <SettingsPageFrame> lists `context` / `searchItems`
  // in its registration effect's dependency array, so an inline node or a
  // fresh array re-registers on every render and the shell's setState
  // re-renders us — an unbounded loop ("Maximum update depth exceeded").
  const context = useMemo(
    () => (
    <>
      <ContextModule
        label={t('settings.cc.integrations.railStatusLabel')}
        title={t('settings.cc.integrations.railConnected', { count: connectedCount })}
      >
        {t('settings.cc.integrations.railAttention', { count: attentionCount })}
      </ContextModule>
      <ContextModule label={t('settings.cc.integrations.railFamiliesLabel')}>
        <ul className="space-y-1">
          {INTEGRATION_FAMILIES.map((f) => (
            <li key={f}>{t(`settings.cc.integrations.families.${f}`)}</li>
          ))}
        </ul>
      </ContextModule>
      <ContextModule
        label={t('settings.cc.integrations.railImportsLabel')}
        title={t('settings.cc.integrations.railImportsTitle')}
      >
        {t('settings.cc.integrations.railImportsHint')}
        <ContextAction href={`/${schoolId}/templates/imports`}>
          {t('settings.cc.integrations.railImportsAction')}
        </ContextAction>
      </ContextModule>
      <ContextModule label={t('settings.cc.integrations.railAuditLabel')}>
        <ContextAction href={`/${schoolId}/audit`}>{t('settings.cc.integrations.railAuditAction')}</ContextAction>
      </ContextModule>
    </>
    ),
    // `t` is intentionally NOT a dependency: useTranslations() returns a
    // fresh function identity on every render, which would defeat the
    // memo and re-register the page in a loop. Copy is static per locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [schoolId, connectedCount, attentionCount],
  );

  return (
    <SettingsPageFrame
      section="integrations"
      title={t('settings.shell.sections.integrations.label')}
      description={t('settings.shell.sections.integrations.description')}
      context={context}
      searchItems={searchItems}
    >
      <EditorHead
        icon={Plug}
        title={t('settings.cc.integrations.editorTitle')}
        description={t('settings.cc.integrations.editorDescription')}
      />

      {degradedSources && (
        <div role="status" className="mb-4 rounded-[11px] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">
          {t('settings.cc.integrations.degradedNotice')}
        </div>
      )}

      <div className="mb-4">
        <label htmlFor="cc-integrations-search" className="block text-[12px] font-medium text-slate-600 mb-1.5">
          {t('settings.cc.integrations.searchLabel')}
        </label>
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
          <input
            id="cc-integrations-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('settings.cc.integrations.searchPlaceholder')}
            className="w-full min-h-[42px] pl-9 pr-3 rounded-[10px] border border-slate-200 bg-white text-[13px] text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2" role="group" aria-label={t('settings.cc.integrations.familyFilterLabel')}>
        <FilterChip active={family === 'all'} onClick={() => setFamily('all')}>
          {t('settings.cc.integrations.filterAll')}
        </FilterChip>
        {INTEGRATION_FAMILIES.map((f) => (
          <FilterChip key={f} active={family === f} onClick={() => setFamily(f)}>
            {t(`settings.cc.integrations.families.${f}`)}
          </FilterChip>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-5" role="group" aria-label={t('settings.cc.integrations.stateFilterLabel')}>
        <FilterChip active={stateFilter === 'all'} onClick={() => setStateFilter('all')}>
          {t('settings.cc.integrations.filterAll')}
        </FilterChip>
        {STATE_FILTERS.map((s) => (
          <FilterChip key={s} active={stateFilter === s} onClick={() => setStateFilter(s)}>
            {t(`settings.cc.integrations.states.${s}`)}
          </FilterChip>
        ))}
      </div>

      {loading && entries.length === 0 ? (
        <EditorSkeleton groups={3} />
      ) : grouped.length === 0 ? (
        <div className="rounded-[11px] border border-slate-200 bg-slate-50 px-5 py-6 text-center">
          <strong className="block text-[14px] font-medium text-slate-900">
            {t('settings.cc.integrations.noResults')}
          </strong>
          <p className="mt-1.5 text-[13px] text-slate-500">{t('settings.cc.integrations.noResultsHint')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.family} aria-labelledby={`cc-int-${group.family}`}>
              <h3
                id={`cc-int-${group.family}`}
                className="text-[13px] font-medium text-slate-900 mb-2"
              >
                {t(`settings.cc.integrations.families.${group.family}`)}
              </h3>
              <ul className="space-y-2">
                {group.rows.map((entry) => (
                  <li key={entry.id}>
                    <CatalogRow entry={entry} schoolId={schoolId} onRefresh={refetchAll} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </SettingsPageFrame>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center min-h-[32px] px-2.5 rounded-full border text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
        active ? 'border-transparent text-slate-900' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
      )}
      style={active ? { background: 'var(--brand-primary-soft)' } : undefined}
    >
      {children}
    </button>
  );
}

function CatalogRow({
  entry,
  schoolId,
  onRefresh,
}: {
  entry: IntegrationCatalogEntry;
  schoolId: string;
  onRefresh: () => void;
}) {
  const t = useTranslations();
  const detail = entry.detail ?? t(`settings.cc.integrations.stateHelp.${entry.state}`);
  const actionCls =
    'shrink-0 inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-[9px] border text-[12px] font-medium hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1';
  const actionStyle = {
    color: 'var(--brand-primary)',
    borderColor: 'color-mix(in srgb, var(--brand-primary) 35%, white)',
  } as const;

  let action: React.ReactNode = null;
  if (entry.action.kind === 'refresh') {
    action = (
      <button type="button" onClick={onRefresh} className={actionCls} style={actionStyle}>
        <RefreshCw className="w-3.5 h-3.5" aria-hidden />
        {t('settings.cc.integrations.actions.refresh')}
      </button>
    );
  } else if (entry.action.kind === 'none') {
    action = (
      <span className="shrink-0 text-[12px] text-slate-400">{t('settings.cc.integrations.actions.none')}</span>
    );
  } else if (entry.action.external && entry.action.href) {
    action = (
      <a
        href={entry.action.href}
        target="_blank"
        rel="noopener noreferrer"
        className={actionCls}
        style={actionStyle}
      >
        {t('settings.cc.integrations.actions.learnMore')}
        <ExternalLink className="w-3.5 h-3.5" aria-hidden />
      </a>
    );
  } else if (entry.action.href) {
    action = (
      <Link href={`/${schoolId}/settings/${entry.action.href}`} className={actionCls} style={actionStyle}>
        {t(`settings.cc.integrations.actions.${entry.action.kind}`)}
      </Link>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-[11px] border border-slate-200 bg-white px-3.5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <strong className="text-[13px] font-medium text-slate-900">{entry.name}</strong>
          <StatusPill kind={entry.state} />
        </div>
        {detail && <p className="mt-1 text-[12px] leading-[17px] text-slate-500">{detail}</p>}
        <p className="mt-1 text-[11px] text-slate-400">
          {t('settings.cc.integrations.sourceLabel')}:{' '}
          {t(`settings.cc.integrations.sources.${entry.statusSource}`)}
          {entry.lastSyncAt && (
            <> · {t('settings.cc.integrations.lastSync', { date: new Date(entry.lastSyncAt).toLocaleString() })}</>
          )}
        </p>
      </div>
      {action}
    </div>
  );
}
