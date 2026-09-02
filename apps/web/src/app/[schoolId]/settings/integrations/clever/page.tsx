"use client";

/**
 * /[schoolId]/settings/integrations/clever — Clever roster sync.
 *
 * 2026-09-02 — migrated into the Settings Command Center shell (§7.7).
 * Two truth fixes came with the migration, both verified against the
 * running API rather than assumed:
 *
 *  1. Every call used to be `apiFetch('/api/v1/integrations/clever/...')`,
 *     but `API_URL` already ends in `/api/v1` and no Nest global prefix
 *     exists — so every request went to `/api/v1/api/v1/...`. Paths are
 *     now relative to the API root like the rest of the app.
 *  2. When the status read fails the page used to fall through to its
 *     "not connected" branch and render a Connect button. That is a §11
 *     violation: an unreadable status is `Unknown`, and we do not offer
 *     an action we cannot complete. It now says so and offers Retry.
 *     (This is live today: `CleverModule` is not imported by any Nest
 *     module, so the routes are not mounted and the status endpoint
 *     404s. See the report to the lead.)
 */
import { useCallback, useEffect, useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { RefreshCw, Users } from 'lucide-react';
import { RoleGate } from '@/components/RoleGate';
import { apiFetch } from '@/lib/api-client';
import { SettingsPageFrame } from '@/components/settings/shell/SettingsPageFrame';
import {
  ContextAction,
  ContextModule,
  EditorHead,
  EditorSection,
  EditorSkeleton,
  PermissionDenied,
  StatusPill,
} from '@/components/settings/shell/primitives';

interface CleverStatus {
  connected: boolean;
  districtId: string | null;
  connectedAt: string | null;
  lastSync: {
    id: string;
    syncStartedAt: string;
    syncCompletedAt: string | null;
    usersAdded: number;
    usersUpdated: number;
    usersDisabled: number;
    errorMessage: string | null;
  } | null;
}

interface CleverPreview {
  toAdd: number;
  toUpdate: number;
  toDisable: number;
}

export default function CleverIntegrationPage() {
  const t = useTranslations();
  return (
    <RoleGate
      allowedRoles={['DISTRICT_ADMIN', 'SUPER_ADMIN']}
      fallback={
        <SettingsPageFrame
          section="integrations"
          subtitle={t('settings.cc.integrations.families.clever')}
          title={t('settings.cc.integrations.pages.clever.title')}
          description={t('settings.cc.integrations.pages.clever.description')}
        >
          <PermissionDenied sectionLabel={t('settings.clever.title')} />
        </SettingsPageFrame>
      }
    >
      <CleverIntegrationInner />
    </RoleGate>
  );
}

function CleverIntegrationInner() {
  const t = useTranslations();
  const params = useParams();
  const schoolId = params?.schoolId as string;
  const [status, setStatus] = useState<CleverStatus | null>(null);
  const [preview, setPreview] = useState<CleverPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** false = the status endpoint did not answer, so no state is claimed. */
  const [reachable, setReachable] = useState(true);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try {
      const s = await apiFetch<CleverStatus>('/integrations/clever/status');
      setStatus(s);
      setReachable(true);
      setError(null);
    } catch (e) {
      setStatus(null);
      setReachable(false);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleConnect = async () => {
    try {
      const { url } = await apiFetch<{ url: string }>('/integrations/clever/connect');
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDisconnect = async () => {
    try {
      await apiFetch('/integrations/clever/disconnect', { method: 'POST' });
      await refreshStatus();
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePreview = async () => {
    try {
      setPreview(null);
      const p = await apiFetch<CleverPreview>('/integrations/clever/preview');
      setPreview(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await apiFetch('/integrations/clever/sync', { method: 'POST' });
      await refreshStatus();
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const state = !reachable ? 'unknown' : status?.connected ? 'connected' : 'notConfigured';
  const lastSyncLabel = status?.lastSync
    ? new Date(status.lastSync.syncCompletedAt ?? status.lastSync.syncStartedAt).toLocaleString()
    : null;

  const searchItems = useMemo(() => ([{ label: t('settings.clever.title'), keywords: ['clever', 'roster', 'sis'] }] as const), []); // eslint-disable-line react-hooks/exhaustive-deps

  // MUST be memoized: <SettingsPageFrame> lists `context` / `searchItems`
  // in its registration effect's dependency array, so an inline node or a
  // fresh array re-registers on every render and the shell's setState
  // re-renders us - an unbounded loop ("Maximum update depth exceeded").
  const context = useMemo(
    () => (
    <>
      <ContextModule label={t('settings.cc.integrations.providerRail.statusLabel')}>
        <StatusPill kind={state} />
        {!reachable && (
          <p className="mt-2">{t('settings.cc.integrations.providerRail.notReachable')}</p>
        )}
      </ContextModule>
      <ContextModule label={t('settings.cc.integrations.providerRail.lastSyncLabel')}>
        {lastSyncLabel ?? t('settings.cc.integrations.providerRail.noSync')}
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
    [schoolId, state, reachable, lastSyncLabel],
  );

  return (
    <SettingsPageFrame
      section="integrations"
      subtitle={t('settings.cc.integrations.families.clever')}
      title={t('settings.cc.integrations.pages.clever.title')}
      description={t('settings.cc.integrations.pages.clever.description')}
      context={context}
      searchItems={searchItems}
    >
      <EditorHead icon={Users} title={t('settings.clever.title')} description={t('settings.clever.subtitle')} />

      {error && (
        <div role="alert" className="mb-5 rounded-[11px] border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-900">
          {error}
        </div>
      )}

      {loading ? (
        <EditorSkeleton groups={2} />
      ) : (
        <>
          <EditorSection id="clever-connection" title={t('settings.clever.connectionHeading')}>
            {!reachable ? (
              <div className="space-y-3 text-[13px] text-slate-600">
                <StatusPill kind="unknown" />
                <p>{t('settings.cc.integrations.stateHelp.unknown')}</p>
                <button
                  type="button"
                  onClick={() => void refreshStatus()}
                  className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-[9px] border border-slate-300 text-[13px] font-medium hover:bg-slate-50"
                >
                  <RefreshCw className="w-3.5 h-3.5" aria-hidden />
                  {t('settings.cc.integrations.actions.refresh')}
                </button>
              </div>
            ) : status?.connected ? (
              <div className="space-y-3 text-[13px]">
                <div>
                  {t.rich('settings.clever.connectedTo', {
                    districtId: status.districtId ?? '',
                    code: (chunks) => <code>{chunks}</code>,
                  })}
                  {status.connectedAt && (
                    <> {t('settings.clever.since', { date: new Date(status.connectedAt).toLocaleString() })}</>
                  )}
                  .
                </div>
                <button
                  type="button"
                  onClick={handleDisconnect}
                  className="min-h-[36px] rounded-[9px] border border-slate-300 px-3 text-[13px] font-medium hover:bg-slate-50"
                >
                  {t('settings.common.disconnect')}
                </button>
              </div>
            ) : (
              <div className="space-y-3 text-[13px]">
                <div>{t('settings.clever.notConnected')}</div>
                <button
                  type="button"
                  onClick={handleConnect}
                  className="min-h-[36px] rounded-[9px] bg-indigo-600 px-3 text-[13px] font-medium text-white hover:bg-indigo-700"
                >
                  {t('settings.clever.connectButton')}
                </button>
              </div>
            )}
          </EditorSection>

          {reachable && status?.connected && (
            <EditorSection id="clever-sync" title={t('settings.clever.rosterSyncHeading')}>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={syncing}
                  className="min-h-[36px] rounded-[9px] border border-slate-300 px-3 text-[13px] font-medium hover:bg-slate-50 disabled:opacity-50"
                >
                  {t('settings.clever.previewChanges')}
                </button>
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={syncing}
                  className="min-h-[36px] rounded-[9px] bg-emerald-600 px-3 text-[13px] font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {syncing ? t('settings.clever.syncing') : t('settings.clever.syncNow')}
                </button>
              </div>

              {preview && (
                <div className="mt-3 rounded-[11px] border border-slate-200 bg-slate-50 p-3 text-[13px]">
                  <div className="font-medium mb-1">{t('settings.clever.previewHeading')}</div>
                  <ul className="space-y-0.5">
                    <li>{t('settings.clever.usersToAdd', { count: preview.toAdd })}</li>
                    <li>{t('settings.clever.usersToUpdate', { count: preview.toUpdate })}</li>
                    <li>{t('settings.clever.usersNoLonger', { count: preview.toDisable })}</li>
                  </ul>
                </div>
              )}

              <div className="mt-4 text-[13px]">
                <div className="font-medium">{t('settings.clever.lastSyncHeading')}</div>
                {status.lastSync ? (
                  <div className="mt-1 text-slate-700">
                    {t('settings.clever.started', { date: new Date(status.lastSync.syncStartedAt).toLocaleString() })}{' '}
                    {status.lastSync.syncCompletedAt ? (
                      <>
                        {t('settings.clever.syncResult', {
                          added: status.lastSync.usersAdded,
                          updated: status.lastSync.usersUpdated,
                          flagged: status.lastSync.usersDisabled,
                        })}
                      </>
                    ) : (
                      <span className="text-amber-700">{t('settings.clever.inProgress')}</span>
                    )}
                    {status.lastSync.errorMessage && (
                      <div className="mt-1 text-red-700">
                        {t('settings.clever.errorPrefix', { message: status.lastSync.errorMessage })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="mt-1 text-slate-500">{t('settings.clever.noSyncs')}</div>
                )}
              </div>
            </EditorSection>
          )}
        </>
      )}
    </SettingsPageFrame>
  );
}
