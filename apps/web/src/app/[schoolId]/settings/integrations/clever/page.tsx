"use client";

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RoleGate } from '@/components/RoleGate';
import { apiFetch } from '@/lib/api-client';

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
        <div className="p-8">
          <h1 className="text-xl font-semibold">{t('settings.clever.title')}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {t('settings.clever.adminOnly')}
          </p>
        </div>
      }
    >
      <CleverIntegrationInner />
    </RoleGate>
  );
}

function CleverIntegrationInner() {
  const t = useTranslations();
  const [status, setStatus] = useState<CleverStatus | null>(null);
  const [preview, setPreview] = useState<CleverPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await apiFetch<CleverStatus>('/api/v1/integrations/clever/status');
      setStatus(s);
    } catch (e) {
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
      const { url } = await apiFetch<{ url: string }>('/api/v1/integrations/clever/connect');
      window.location.href = url;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDisconnect = async () => {
    try {
      await apiFetch('/api/v1/integrations/clever/disconnect', { method: 'POST' });
      await refreshStatus();
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePreview = async () => {
    try {
      setPreview(null);
      const p = await apiFetch<CleverPreview>('/api/v1/integrations/clever/preview');
      setPreview(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      await apiFetch('/api/v1/integrations/clever/sync', { method: 'POST' });
      await refreshStatus();
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return <div className="p-8 text-sm text-slate-500">{t('settings.clever.loadingStatus')}</div>;

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('settings.clever.title')}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {t('settings.clever.subtitle')}
        </p>
      </header>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="font-medium">{t('settings.clever.connectionHeading')}</h2>
        {status?.connected ? (
          <div className="mt-2 space-y-2 text-sm">
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
              onClick={handleDisconnect}
              className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
            >
              {t('settings.common.disconnect')}
            </button>
          </div>
        ) : (
          <div className="mt-2 space-y-2 text-sm">
            <div>{t('settings.clever.notConnected')}</div>
            <button
              onClick={handleConnect}
              className="rounded bg-indigo-600 px-3 py-1 text-sm text-white hover:bg-indigo-700"
            >
              {t('settings.clever.connectButton')}
            </button>
          </div>
        )}
      </section>

      {status?.connected && (
        <section className="rounded border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="font-medium">{t('settings.clever.rosterSyncHeading')}</h2>

          <div className="flex gap-2">
            <button
              onClick={handlePreview}
              disabled={syncing}
              className="rounded border border-slate-300 px-3 py-1 text-sm hover:bg-slate-50"
            >
              {t('settings.clever.previewChanges')}
            </button>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="rounded bg-emerald-600 px-3 py-1 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {syncing ? t('settings.clever.syncing') : t('settings.clever.syncNow')}
            </button>
          </div>

          {preview && (
            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="font-medium mb-1">{t('settings.clever.previewHeading')}</div>
              <ul className="space-y-0.5">
                <li>{t('settings.clever.usersToAdd', { count: preview.toAdd })}</li>
                <li>{t('settings.clever.usersToUpdate', { count: preview.toUpdate })}</li>
                <li>{t('settings.clever.usersNoLonger', { count: preview.toDisable })}</li>
              </ul>
            </div>
          )}

          <div className="text-sm">
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
                  <div className="mt-1 text-red-700">{t('settings.clever.errorPrefix', { message: status.lastSync.errorMessage })}</div>
                )}
              </div>
            ) : (
              <div className="mt-1 text-slate-500">{t('settings.clever.noSyncs')}</div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
