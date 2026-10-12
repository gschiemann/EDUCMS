'use client';

/**
 * The fix, inside the selected-location card (2026-10-12).
 *
 * Owner: "the goal is an actionable alert takes you to fix the issue". An
 * alert row (or a pin) selects a place; this block sits at the TOP of that
 * place's card and names each screen with a problem, what we actually know
 * about it (player rule 10 — only what the evidence proves), and the action
 * that fixes it, right there:
 *
 *   update not confirmed → "Send update now" — the SAME per-screen command the
 *     inbox's Resync and the Screens drawer send (POST /screens/:id/refresh-web,
 *     admins only, audited server-side as REFRESH_WEB). It reaches a screen
 *     with a dead push channel too (dual-path).
 *   no picture confirmed → the same command, plus "Open screen".
 *   offline → "Troubleshoot" — the Screens page drawer for that screen, which
 *     owns the offline troubleshooting path. A reload cannot reach it.
 *   emergency gap → "Add alert content" (settings → emergency).
 *
 * Shared by the organisation map and the standard account's Screens map.
 */
import { forwardRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Loader2, MonitorX, RefreshCw, ShieldAlert, Wrench } from 'lucide-react';
import { RoleGate } from '@/components/RoleGate';
import { useRefreshWeb } from '@/hooks/use-api';
import type { MapAlertScreen } from './mapAlerts';

/** The roles `POST /screens/:id/refresh-web` accepts. */
const REFRESH_ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'];

function useAgo() {
  const t = useTranslations('dashboard.liveSummary');
  return (at: number | string | null | undefined, now: number): string | null => {
    const ms = typeof at === 'string' ? Date.parse(at) : at ?? null;
    if (ms == null || !Number.isFinite(ms)) return null;
    const min = Math.floor((now - ms) / 60_000);
    if (min < 0) return null;
    if (min < 60) return t('minutes', { count: Math.max(1, min) });
    const hr = Math.floor(min / 60);
    if (hr < 24) return t('hours', { count: hr });
    return t('days', { count: Math.floor(hr / 24) });
  };
}

/** Sends the reload command to each screen, then says exactly what happened. */
function SendUpdateButton({ screens }: { screens: MapAlertScreen[] }) {
  const t = useTranslations('fleetMap.fix');
  const refreshWeb = useRefreshWeb();
  const qc = useQueryClient();
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'sending' }
    | { kind: 'done'; sent: number; failed: string[] }
  >({ kind: 'idle' });

  const send = async () => {
    setState({ kind: 'sending' });
    let sent = 0;
    const failed: string[] = [];
    for (const s of screens) {
      try {
        await refreshWeb.mutateAsync({ screenId: s.id });
        sent += 1;
      } catch {
        failed.push(s.name);
      }
    }
    setState({ kind: 'done', sent, failed });
    // Re-read the fleet so a screen that took the update reads "syncing"
    // now, instead of on the next 30 s poll.
    qc.invalidateQueries({ queryKey: ['screens'] });
  };

  return (
    <div>
      <button
        type="button"
        onClick={send}
        disabled={state.kind === 'sending' || (state.kind === 'done' && state.failed.length === 0)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold text-white disabled:opacity-70"
        style={{ background: state.kind === 'done' && state.failed.length === 0 ? '#059669' : 'var(--brand-primary, #4f46e5)' }}
        data-testid="map-fix-send-update"
      >
        {state.kind === 'sending'
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
          : <RefreshCw className="w-3.5 h-3.5" aria-hidden />}
        {state.kind === 'sending'
          ? t('sending')
          : state.kind === 'done' && state.failed.length === 0
            ? t('sent', { count: state.sent })
            : t('sendUpdate', { count: screens.length })}
      </button>
      <p className="mt-1 text-[11px] font-semibold text-slate-500" role="status" aria-live="polite">
        {state.kind === 'done' && state.failed.length === 0 && t('sentHint')}
        {state.kind === 'done' && state.failed.length > 0 && (
          <span className="text-rose-600">{t('sendFailed', { count: state.failed.length, names: state.failed.join(', ') })}</span>
        )}
      </p>
    </div>
  );
}

export const MapPlaceFix = forwardRef<HTMLDivElement, {
  screens: MapAlertScreen[];
  emergencyGap: boolean;
  onOpenScreen: (screenId: string) => void;
  onFixEmergency?: () => void;
  now: number;
}>(function MapPlaceFix({ screens, emergencyGap, onOpenScreen, onFixEmergency, now }, ref) {
  const t = useTranslations('fleetMap.fix');
  const ago = useAgo();
  const behind = screens.filter((s) => s.grade.state === 'behind');
  const dark = screens.filter((s) => s.grade.state === 'no-picture');
  const offline = screens.filter((s) => s.grade.state === 'offline');
  const syncing = screens.filter((s) => s.grade.state === 'syncing');
  if (!emergencyGap && behind.length + dark.length + offline.length + syncing.length === 0) return null;

  const openBtn = (s: MapAlertScreen, label: string) => (
    <button
      type="button"
      onClick={() => onOpenScreen(s.id)}
      className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-700 hover:bg-slate-50"
    >
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="px-4 py-3 border-t border-slate-100 bg-amber-50/60 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
      role="region"
      aria-label={t('aria')}
      data-testid="map-place-fix"
    >
      <h5 className="text-[12px] font-black text-slate-900 flex items-center gap-1.5">
        <Wrench className="w-3.5 h-3.5" aria-hidden /> {t('title')}
      </h5>

      {emergencyGap && (
        <div className="mt-2">
          <p className="text-[12px] font-bold text-rose-700 flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden /> {t('emergencyGap')}
          </p>
          {onFixEmergency && (
            <RoleGate allowedRoles={REFRESH_ROLES} fallback={<p className="text-[11px] font-semibold text-slate-500">{t('askAdmin')}</p>}>
              <button
                type="button"
                onClick={onFixEmergency}
                className="mt-1.5 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold text-white"
                style={{ background: 'var(--brand-primary, #4f46e5)' }}
              >
                {t('addAlertContent')}
              </button>
            </RoleGate>
          )}
        </div>
      )}

      {offline.length > 0 && (
        <div className="mt-2">
          <p className="text-[12px] font-bold text-rose-700 flex items-center gap-1.5">
            <MonitorX className="w-3.5 h-3.5 shrink-0" aria-hidden /> {t('offlineTitle', { count: offline.length })}
          </p>
          <ul className="mt-1 space-y-1">
            {offline.map((s) => {
              const when = ago(s.lastPingAt, now);
              return (
                <li key={s.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11.5px] font-bold text-slate-800 truncate">{s.name}</span>
                    <span className="block text-[10.5px] font-semibold text-slate-500">
                      {when ? t('lastAnswered', { ago: when }) : t('notAnswering')}
                    </span>
                  </span>
                  {openBtn(s, t('troubleshoot'))}
                </li>
              );
            })}
          </ul>
          <p className="mt-1 text-[10.5px] font-semibold text-slate-500">{t('offlineHint')}</p>
        </div>
      )}

      {(behind.length > 0 || dark.length > 0) && (
        <div className="mt-2">
          {behind.length > 0 && (
            <>
              <p className="text-[12px] font-bold text-amber-700 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden /> {t('behindTitle', { count: behind.length })}
              </p>
              <ul className="mt-1 space-y-1">
                {behind.map((s) => {
                  const sent = ago(s.grade.pushSentAtMs, now);
                  const pic = ago(s.lastRenderedAt, now);
                  return (
                    <li key={s.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11.5px] font-bold text-slate-800 truncate">{s.name}</span>
                        <span className="block text-[10.5px] font-semibold text-slate-500">
                          {sent ? t('updateSent', { ago: sent }) : t('updateSentUndated')}
                          {pic && <> · {t('lastPicture', { ago: pic })}</>}
                        </span>
                      </span>
                      {openBtn(s, t('openScreen'))}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {dark.length > 0 && (
            <>
              <p className="mt-1.5 text-[12px] font-bold text-rose-700 flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden /> {t('darkTitle', { count: dark.length })}
              </p>
              <ul className="mt-1 space-y-1">
                {dark.map((s) => {
                  const pic = ago(s.lastRenderedAt, now);
                  return (
                    <li key={s.id} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11.5px] font-bold text-slate-800 truncate">{s.name}</span>
                        <span className="block text-[10.5px] font-semibold text-slate-500">
                          {pic ? t('lastPicture', { ago: pic }) : t('noPictureYet')}
                        </span>
                      </span>
                      {openBtn(s, t('openScreen'))}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <div className="mt-2">
            <RoleGate allowedRoles={REFRESH_ROLES} fallback={<p className="text-[11px] font-semibold text-slate-500">{t('askAdmin')}</p>}>
              <SendUpdateButton screens={[...behind, ...dark]} />
            </RoleGate>
          </div>
        </div>
      )}

      {syncing.length > 0 && (
        <p className="mt-2 text-[11px] font-semibold text-slate-500">{t('syncing', { count: syncing.length })}</p>
      )}
    </div>
  );
});
