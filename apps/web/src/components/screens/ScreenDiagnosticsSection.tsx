"use client";

/**
 * ScreenDiagnosticsSection — "Diagnostics" in the screen drawer's Actions tab
 * (2026-11-08, Manager waves, wave 2: inventory #4, #5, #6, #11).
 *
 *   • Storage — free/total disk, the player's storage quota, and the
 *     pre-degradation warning "Storage almost full: new content may not
 *     download" (the API grades it; SCREEN_STORAGE_WARNINGS_DISABLED hides it).
 *   • Run self-test — the verdict card: pass / warn / fail per check, grouped
 *     Device · Network · Player, with a plain-language next step on every
 *     warning and failure.
 *   • Get recent logs — organisation admins only (the API enforces it too):
 *     a redacted bundle of the Player's and the Manager's log, downloadable
 *     through a 5-minute signed link, kept for the retention window.
 *
 * Copy claims only what the evidence proves (Player Reliability rule 10):
 * these are the screen's own reports, never a view of the glass. Admins only
 * (others see nothing). Fetched when the Actions tab is open; polls only
 * while a request is running (use-screen-diagnostics.ts). Dashboard surface:
 * CSS gap is fine (not Taurus code).
 */

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Stethoscope, FileText, HardDrive } from 'lucide-react';
import { RoleGate } from '@/components/RoleGate';
import { Button } from '@/components/ui/button';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import {
  fetchLogsUrl,
  useRequestDiagnostics,
  useScreenDiagnostics,
  type DiagCheck,
  type DiagCheckStatus,
  type DiagRequestView,
  type DiagStorage,
  type DiagnosticsView,
} from '@/hooks/use-screen-diagnostics';

const ADMIN_ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'];
const GROUPS = ['device', 'network', 'player'] as const;
const LOG_MINUTES = [5, 15, 30, 60];

type T = (key: string, values?: Record<string, string | number>) => string;

export function formatBytes(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export const STATUS_TONE: Record<DiagCheckStatus, StatusTone> = { pass: 'success', warn: 'warning', fail: 'danger', unknown: 'neutral' };
const VERDICT_TONE: Record<'pass' | 'warn' | 'fail', StatusTone> = { pass: 'success', warn: 'warning', fail: 'danger' };

/** The detail line for one check, from its numbers and codes only. Exported for the card's tests. */
export function checkDetail(c: DiagCheck, t: T): string | null {
  const v = c.values;
  const n = (k: string) => (typeof v[k] === 'number' ? (v[k] as number) : null);
  const s = (k: string) => (typeof v[k] === 'string' ? (v[k] as string) : null);
  switch (c.id) {
    case 'storage':
      if (v.writeFailed) return t('detail.storageWriteFailed');
      return n('freeBytes') !== null ? t('detail.storage', { free: formatBytes(n('freeBytes')), total: formatBytes(n('totalBytes')) }) : null;
    case 'clock':
      return n('skewSec') !== null ? t('detail.clock', { sec: Math.abs(n('skewSec')!) }) : null;
    case 'certs':
      if (s('error')) return t('detail.certsError', { error: s('error')! });
      return n('leafDaysLeft') !== null ? t('detail.certs', { days: n('leafDaysLeft')! }) : null;
    case 'network':
      if (v.captivePortal) return t('detail.networkCaptive');
      if (v.offline) return t('detail.networkOffline');
      return s('transport') ? t('detail.network', { transport: t(`transport.${s('transport')}`) }) : null;
    case 'link':
      if (s('transport') === 'wifi') return n('rssi') !== null ? t('detail.linkWifi', { rssi: n('rssi')! }) : t('transport.wifi');
      return s('transport') ? t(`transport.${s('transport')}`) : null;
    case 'dns':
      if (s('error')) return t('detail.dnsError', { error: s('error')! });
      return n('ms') !== null ? t('detail.dns', { ms: n('ms')! }) : null;
    case 'api':
      if (s('error')) return t('detail.apiError', { error: s('error')! });
      return n('ms') !== null ? t('detail.api', { ms: n('ms')! }) : null;
    case 'address':
      if (s('ipKind') === 'none' || s('ipKind') === 'link-local') return t('detail.addressNone');
      if (!s('ip')) return null;
      return s('gateway') ? t('detail.address', { ip: s('ip')!, gateway: s('gateway')! }) : t('detail.addressNoGateway', { ip: s('ip')! });
    case 'webview': {
      if (n('major') === null) return null;
      const base = t('detail.webview', { major: n('major')! });
      return v.legacyLayer || v.legacyPolyfills ? `${base} · ${t('detail.legacyOn')}` : base;
    }
    case 'heartbeat':
      if (v.never) return t('detail.heartbeatNever');
      return n('ageSec') !== null ? t('detail.heartbeat', { sec: n('ageSec')! }) : null;
    case 'manifest':
      if (v.pageSilent) return t('detail.manifestSilent');
      return n('ageSec') !== null ? t('detail.manifest', { sec: n('ageSec')! }) : null;
    case 'origin':
      return n('percent') !== null ? t('detail.origin', { percent: n('percent')!, quota: formatBytes(n('quota')) }) : null;
    case 'emergency':
      if (c.status === 'fail') return t('detail.emergencyUnreadable');
      return n('entries') !== null ? t('detail.emergency', { count: n('entries')! }) : null;
    default:
      return null;
  }
}

function at(iso: string | null | undefined, locale: string): string {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; }
}

export function StorageBlock({ storage, t }: { storage: DiagStorage | null; t: T }) {
  if (!storage || (!storage.native && !storage.page)) {
    return <p className="mt-1 text-[12px] font-semibold text-slate-500" data-testid="diag-storage-none">{t('storageNone')}</p>;
  }
  const origin = storage.page?.origin;
  return (
    <div className="mt-1" data-testid="diag-storage">
      {storage.warning && (
        <div
          role="status"
          data-testid="diag-storage-warning"
          data-warning={storage.warning}
          className={`mb-2 rounded-lg border px-3 py-2 text-[12.5px] font-bold leading-snug ${storage.warning === 'critical' ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}
        >
          {storage.warning === 'critical' ? t('storageCritical') : t('storageAlmostFull')}
        </div>
      )}
      {storage.native && (
        <p className="text-[12.5px] font-semibold text-slate-700">
          {t('storageLine', { free: formatBytes(storage.native.freeBytes), total: formatBytes(storage.native.totalBytes) })}
        </p>
      )}
      {origin && (
        <p className="text-[12px] font-semibold text-slate-500">
          {t('storageOrigin', { percent: Math.round((origin.usage / origin.quota) * 100), quota: formatBytes(origin.quota) })}
        </p>
      )}
    </div>
  );
}

/** The verdict card. Exported for its tests and the screenshots. */
export function VerdictCard({ run, t, locale }: { run: DiagRequestView; t: T; locale: string }) {
  if (run.status === 'pending' || run.status === 'running') {
    return (
      <p className="mt-2 flex items-center gap-2 text-[12.5px] font-semibold text-slate-600" role="status" data-testid="diag-selftest-running">
        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
        {run.status === 'pending' ? t('waiting') : t('running')}
      </p>
    );
  }
  if (run.status === 'expired' || run.status === 'failed') {
    return <p className="mt-2 text-[12.5px] font-semibold text-amber-800" role="status" data-testid="diag-selftest-expired">{t('expired')}</p>;
  }
  const verdict = run.verdict ?? 'warn';
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-white" data-testid="diag-verdict" data-verdict={verdict}>
      <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-slate-100">
        <StatusPill tone={VERDICT_TONE[verdict]} data-testid="diag-verdict-pill">{t(`verdict.${verdict}`)}</StatusPill>
        <span className="text-[10.5px] font-semibold text-slate-400 tabular-nums">{t('lastRun', { time: at(run.completedAt ?? run.createdAt, locale) })}</span>
      </div>
      {GROUPS.map((g) => {
        const rows = run.checks.filter((c) => c.group === g);
        if (!rows.length) return null;
        return (
          <div key={g} className="px-3.5 py-2">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{t(`group.${g}`)}</p>
            <ul className="mt-1 flex flex-col">
              {rows.map((c) => {
                const detail = checkDetail(c, t);
                const needsStep = c.status === 'warn' || c.status === 'fail';
                return (
                  <li key={c.id} className="py-1.5 border-b border-slate-50 last:border-b-0" data-testid={`diag-check-${c.id}`} data-status={c.status}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12.5px] font-bold text-slate-800">{t(`check.${c.id}`)}</span>
                      <StatusPill tone={STATUS_TONE[c.status]}>{t(`status.${c.status}`)}</StatusPill>
                    </div>
                    {detail && <p className="text-[11.5px] font-semibold text-slate-500 leading-snug">{detail}</p>}
                    {needsStep && (
                      <p className={`mt-0.5 text-[11.5px] font-semibold leading-snug ${c.status === 'fail' ? 'text-rose-700' : 'text-amber-800'}`} data-testid={`diag-next-${c.id}`}>
                        {t(`next.${c.id}`)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <p className="px-3.5 pb-2.5 text-[10.5px] font-semibold text-slate-400 leading-snug">{t('note')}</p>
    </div>
  );
}

export function LogRow({ run, t, locale, retentionDays, onDownload, downloading }: {
  run: DiagRequestView; t: T; locale: string; retentionDays: number; onDownload: () => void; downloading: boolean;
}) {
  const line = run.status === 'complete' && run.logAvailable ? t('logReady', { minutes: run.minutes ?? 15, size: formatBytes(run.logBytes) })
    : run.status === 'complete' && run.logPurged ? t('logPurged', { days: retentionDays })
      : run.status === 'pending' ? t('logPending')
        : run.status === 'running' ? t('logRunning')
          : run.status === 'failed' ? t('logFailed', { reason: run.failureReason ?? '—' })
            : t('logExpired');
  return (
    <li className="flex items-center justify-between gap-2 py-1.5" data-testid="diag-log-row" data-status={run.status}>
      <span className="min-w-0">
        <span className="block text-[10.5px] font-semibold text-slate-400 tabular-nums">{at(run.createdAt, locale)}</span>
        <span className="block text-[12px] font-semibold text-slate-700">{line}</span>
      </span>
      {run.status === 'complete' && run.logAvailable && (
        <Button variant="outline" size="sm" onClick={onDownload} disabled={downloading} data-testid="diag-log-download">
          {downloading ? <Loader2 className="animate-spin" aria-hidden /> : <FileText aria-hidden />}
          {t('download')}
        </Button>
      )}
    </li>
  );
}

function DiagnosticsCard({ screenId, canControl }: { screenId: string; canControl: boolean }) {
  const t = useTranslations('screens.diagnostics') as unknown as T;
  const locale = useLocale();
  const q = useScreenDiagnostics(screenId, true);
  const req = useRequestDiagnostics(screenId);
  const [minutes, setMinutes] = useState(15);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const v: DiagnosticsView | undefined = q.data;

  const run = (kind: 'SELF_TEST' | 'LOGS') => {
    setError(null);
    req.mutate(kind === 'LOGS' ? { kind, minutes } : { kind }, {
      onError: (e: any) => setError(e?.code === 'DIAGNOSTICS_IN_PROGRESS' ? t('inProgress') : t('failedRequest', { message: e?.message ?? '' })),
    });
  };
  const download = async (id: string) => {
    setDownloading(id);
    setError(null);
    try {
      const { url } = await fetchLogsUrl(screenId, id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setError(t('downloadFailed'));
    } finally {
      setDownloading(null);
    }
  };
  const busy = !!v && ((v.selfTest && (v.selfTest.status === 'pending' || v.selfTest.status === 'running')) || v.logs.some((l) => l.status === 'pending' || l.status === 'running'));

  return (
    <section data-testid="screen-diagnostics">
      <div className="mb-2">
        <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-400">{t('title')}</h3>
        <p className="text-[11px] font-semibold text-slate-400 mt-0.5">{t('hint')}</p>
      </div>
      {q.isError ? (
        <p className="text-[12px] font-semibold text-amber-700" role="status">{t('loadFailed')}</p>
      ) : !v ? (
        <Loader2 className="w-4 h-4 text-slate-300 animate-spin" aria-label={t('loading')} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-slate-200 p-3.5">
            <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400"><HardDrive className="w-3.5 h-3.5" aria-hidden />{t('storageTitle')}</p>
            <StorageBlock storage={v.storage} t={t} />
          </div>

          <div className="rounded-xl border border-slate-200 p-3.5">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400"><Stethoscope className="w-3.5 h-3.5" aria-hidden />{t('selfTestTitle')}</p>
              <Button size="sm" onClick={() => run('SELF_TEST')} disabled={!canControl || !v.enabled || !!busy || req.isPending} data-testid="diag-run-selftest">
                {req.isPending && req.variables?.kind === 'SELF_TEST' ? <Loader2 className="animate-spin" aria-hidden /> : <Stethoscope aria-hidden />}
                {t('runSelfTest')}
              </Button>
            </div>
            {!v.enabled && <p className="mt-2 text-[12px] font-semibold text-slate-500">{t('disabled')}</p>}
            {v.selfTest ? <VerdictCard run={v.selfTest} t={t} locale={locale} /> : (
              <p className="mt-2 text-[12px] font-semibold text-slate-500">{t('selfTestNone')}</p>
            )}
          </div>

          {v.canRequestLogs && (
            <div className="rounded-xl border border-slate-200 p-3.5" data-testid="diag-logs">
              <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400"><FileText className="w-3.5 h-3.5" aria-hidden />{t('logsTitle')}</p>
              <p className="mt-0.5 text-[11px] font-semibold text-slate-400 leading-snug">{t('logsHint', { days: v.retentionDays })}</p>
              <div className="mt-2 flex items-center gap-2">
                <label htmlFor={`diag-minutes-${screenId}`} className="text-[11px] font-bold text-slate-500">{t('minutesLabel')}</label>
                <select
                  id={`diag-minutes-${screenId}`}
                  value={minutes}
                  onChange={(e) => setMinutes(Number(e.target.value))}
                  disabled={!canControl || !!busy}
                  className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[12.5px] font-semibold text-slate-800 bg-white outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60"
                >
                  {LOG_MINUTES.map((m) => <option key={m} value={m}>{t('minutes', { count: m })}</option>)}
                </select>
                <Button variant="outline" size="sm" onClick={() => run('LOGS')} disabled={!canControl || !v.enabled || !!busy || req.isPending} data-testid="diag-get-logs">
                  <FileText aria-hidden />
                  {t('getLogs')}
                </Button>
              </div>
              {v.logs.length > 0 && (
                <ul className="mt-2 divide-y divide-slate-100">
                  {v.logs.map((l) => (
                    <LogRow key={l.id} run={l} t={t} locale={locale} retentionDays={v.retentionDays} onDownload={() => download(l.id)} downloading={downloading === l.id} />
                  ))}
                </ul>
              )}
            </div>
          )}
          {error && <p className="text-[12px] font-semibold text-rose-700" role="alert" data-testid="diag-error">{error}</p>}
        </div>
      )}
    </section>
  );
}

export function ScreenDiagnosticsSection({ screenId, enabled, canControl }: { screenId: string; enabled: boolean; canControl: boolean }) {
  if (!enabled) return null;
  return (
    <RoleGate allowedRoles={ADMIN_ROLES} fallback={null}>
      <DiagnosticsCard screenId={screenId} canControl={canControl} />
    </RoleGate>
  );
}
