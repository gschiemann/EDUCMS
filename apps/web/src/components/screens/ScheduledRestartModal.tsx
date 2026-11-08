'use client';

/**
 * ScheduledRestartModal — the opt-in nightly / weekly restart for one screen
 * group (2026-11-08, manager deep-dive item #7). Opened from the group ⋮ menu
 * on /[schoolId]/screens, beside "On/off schedule", and built in the same
 * house sheet pattern as DisplayScheduleModal (bottom sheet on a phone,
 * centred card on desktop, sticky header and footer).
 *
 * WHAT IT SAYS OUT LOUD, because the copy claims only what the evidence
 * proves:
 *  - when a restart may run (10 PM–5 AM in each screen's own zone, inside its
 *    off window, never during an alert, an update or a synced moment);
 *  - per screen, whether it CAN restart. On today's fleet none can (the
 *    player has no device-owner rights, by design), and the sheet says so
 *    instead of pretending the setting does something;
 *  - per screen, the last result — including "Didn't come back after its
 *    scheduled restart".
 *
 * The rules and the worker live server-side
 * (apps/api/src/scheduled-reboot/). This sheet only edits the policy.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, ChevronDown, Info, Loader2, RotateCcw, X } from 'lucide-react';

import { Segmented } from '@/components/ui/segmented';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';
import { TimeField } from '@/components/ui/time-field';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import {
  isAllowedRestartTime,
  useClearGroupScheduledRestart,
  useGroupScheduledRestart,
  useSetGroupScheduledRestart,
  type RestartRun,
  type RestartScreen,
} from '@/hooks/use-scheduled-restarts';

export interface ScheduledRestartTarget {
  id: string;
  name: string;
}

type Mode = 'OFF' | 'DAILY' | 'WEEKLY';

const REASONS = new Set([
  'cannot-restart',
  'no-time-zone',
  'not-off-hours',
  'outside-off-window',
  'panel-off',
  'sync-live',
  'restarted-on-its-own',
  'offline',
  'emergency',
  'ota-in-flight',
  'class-busy',
  'tenant-cap',
]);

/** Sunday-first, as the API stores it (0 = Sunday). */
function weekdayNames(locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
  // 2026-11-08 is a Sunday.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(Date.UTC(2026, 10, 8 + i, 12))));
}

function formatClock(locale: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2026, 0, 1, h, m)),
  );
}

function formatInstant(locale: string, iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(d);
}

/** One line for a screen's last run, and its tone. Exported for the tests. */
export function describeRun(
  run: RestartRun | null,
  t: (key: string, values?: Record<string, string>) => string,
  locale: string,
): { text: string; tone: StatusTone } {
  if (!run) return { text: t('lastNone'), tone: 'neutral' };
  const reason = run.reason && REASONS.has(run.reason) ? t(`reason.${run.reason}`) : t('reason.other');
  const at = formatInstant(locale, run.returnedAt);
  switch (run.status) {
    case 'BACK':
      return run.restartProven
        ? { text: t('lastBackProven', { time: at }), tone: 'success' }
        : { text: t('lastBack', { time: at }), tone: 'success' };
    case 'NOT_BACK':
      return { text: t('lastNotBack'), tone: 'danger' };
    case 'LATE':
      return { text: t('lastLate', { time: at }), tone: 'warning' };
    case 'NO_RESTART':
      return { text: t('lastNoRestart'), tone: 'warning' };
    case 'SENT':
    case 'SENDING':
      return { text: t('lastRestarting'), tone: 'info' };
    case 'WAITING':
      return { text: t('lastWaiting', { reason }), tone: 'info' };
    case 'REFUSED':
      return { text: t('lastRefused'), tone: 'warning' };
    case 'UNDELIVERED':
      return { text: t('lastUndelivered'), tone: 'warning' };
    case 'SKIPPED':
    default:
      return { text: t('lastSkipped', { reason }), tone: 'neutral' };
  }
}

export function ScheduledRestartModal({
  target,
  readOnly,
  onClose,
}: {
  target: ScheduledRestartTarget;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('scheduledRestart');
  const locale = useLocale();
  useOverlayLock(true);
  const q = useGroupScheduledRestart(target.id);
  const setPolicy = useSetGroupScheduledRestart(target.id);
  const clearPolicy = useClearGroupScheduledRestart(target.id);

  const [mode, setMode] = useState<Mode>('OFF');
  const [day, setDay] = useState(0);
  const [time, setTime] = useState('03:00');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [coarsePointer] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches,
  );

  // Seed the form once from the stored policy.
  const policy = q.data?.policy ?? null;
  const policyKey = q.data ? `${policy?.id ?? 'none'}` : null;
  useEffect(() => {
    if (!policyKey || loadedFor === policyKey) return;
    setLoadedFor(policyKey);
    if (policy && policy.isActive) {
      setMode(policy.cadence);
      setDay(policy.dayOfWeek ?? 0);
      setTime(policy.time);
    } else {
      setMode('OFF');
    }
  }, [policyKey, loadedFor, policy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const days = useMemo(() => weekdayNames(locale), [locale]);
  const disabled = q.data?.disabled === true;
  const screens: RestartScreen[] = q.data?.screens ?? [];
  const cannot = screens.filter((s) => !s.canRestart).length;
  const timeOk = isAllowedRestartTime(time);
  const saving = setPolicy.isPending || clearPolicy.isPending;
  const canSave = !readOnly && !disabled && !saving && (mode === 'OFF' || timeOk);

  const summary =
    mode === 'WEEKLY'
      ? t('summaryWeekly', { day: days[day] ?? '', time: formatClock(locale, time) })
      : t('summaryDaily', { time: formatClock(locale, time) });

  const save = async () => {
    setError(null);
    setSaved(null);
    try {
      if (mode === 'OFF') {
        await clearPolicy.mutateAsync();
        setSaved(t('savedOff'));
      } else {
        await setPolicy.mutateAsync({
          cadence: mode,
          dayOfWeek: mode === 'WEEKLY' ? day : null,
          time,
          isActive: true,
        });
        setSaved(t('saved', { summary }));
      }
    } catch (e) {
      setError((e instanceof Error && e.message) || t('saveFailed'));
    }
  };

  const tr = (key: string, values?: Record<string, string>) => t(key as any, values as any);

  return (
    <div
      className="fixed top-0 right-0 bottom-0 left-0 z-[100] flex items-end md:items-center justify-center bg-slate-900/40 p-0 md:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
      data-testid="scheduled-restart-modal"
    >
      <button className="absolute top-0 right-0 bottom-0 left-0 cursor-default" aria-label={t('close')} onClick={onClose} />
      <div className="relative z-10 w-full md:max-w-lg bg-white rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-indigo-500 shrink-0" aria-hidden="true" />
              {t('title')}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{t('forGroup', { name: target.name })}</p>
          </div>
          <button
            onClick={onClose}
            aria-label={t('close')}
            className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          <div className="flex items-start gap-2 mb-4 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
            <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-[11px] text-slate-500 leading-snug">{t('explainer')}</p>
          </div>

          {disabled && (
            <p
              className="mb-4 text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 leading-snug"
              data-testid="scheduled-restart-disabled"
            >
              {t('disabled')}
            </p>
          )}

          {q.isLoading ? (
            <div className="flex items-center gap-2 text-xs text-slate-500 py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              {t('loading')}
            </div>
          ) : q.isError ? (
            <p className="text-[11px] text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{t('loadFailed')}</p>
          ) : (
            <>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">{t('repeat')}</p>
              <Segmented<Mode>
                value={mode}
                onChange={(v) => {
                  setMode(v);
                  setSaved(null);
                }}
                ariaLabel={t('repeat')}
                fullWidthOnMobile
                testId="scheduled-restart-mode"
                options={[
                  { value: 'OFF', label: t('modeOff') },
                  { value: 'DAILY', label: t('modeDaily') },
                  { value: 'WEEKLY', label: t('modeWeekly') },
                ] as const}
              />

              {mode !== 'OFF' && (
                <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-end">
                  {mode === 'WEEKLY' && (
                    <div className="flex-1 min-w-0 sm:mr-3 mb-3 sm:mb-0">
                      <label htmlFor="scheduled-restart-day" className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        {t('day')}
                      </label>
                      <div className="relative mt-1">
                        <select
                          id="scheduled-restart-day"
                          value={day}
                          disabled={readOnly || disabled}
                          onChange={(e) => {
                            setDay(Number(e.target.value));
                            setSaved(null);
                          }}
                          className="block w-full h-[46px] pl-3 pr-9 border border-slate-200 rounded-lg bg-white text-sm text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 appearance-none disabled:text-slate-400"
                        >
                          {days.map((name, i) => (
                            <option key={i} value={i}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
                      </div>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <label htmlFor="scheduled-restart-time" className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      {t('time')}
                    </label>
                    {coarsePointer ? (
                      <input
                        id="scheduled-restart-time"
                        type="time"
                        value={time}
                        disabled={readOnly || disabled}
                        onChange={(e) => {
                          setTime(e.target.value);
                          setSaved(null);
                        }}
                        className="block mt-1 w-full min-h-[44px] px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm font-mono text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    ) : (
                      <TimeField
                        id="scheduled-restart-time"
                        value={time}
                        disabled={readOnly || disabled}
                        onChange={(v) => {
                          setTime(v);
                          setSaved(null);
                        }}
                        ariaLabel={t('time')}
                        className="mt-1"
                      />
                    )}
                  </div>
                </div>
              )}
              {mode !== 'OFF' && (
                <p className={`mt-1.5 text-[11px] leading-snug ${timeOk ? 'text-slate-500' : 'text-amber-700 font-semibold'}`}>
                  {timeOk ? t('timeHint') : t('timeOutside')}
                </p>
              )}

              {screens.length > 0 && cannot > 0 && (
                <p
                  className="mt-4 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 leading-snug"
                  data-testid="scheduled-restart-cannot"
                >
                  {cannot === screens.length ? t('noneCanRestart') : t('someCannot', { count: String(cannot), total: String(screens.length) })}
                </p>
              )}

              <p className="mt-5 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                {t('screensHeading', { count: String(screens.length) })}
              </p>
              {screens.length === 0 ? (
                <p className="text-[11px] text-slate-500">{t('noScreens')}</p>
              ) : (
                <ul className="divide-y divide-slate-100 border border-slate-100 rounded-xl" data-testid="scheduled-restart-screens">
                  {screens.map((s) => {
                    const last = describeRun(s.lastRun, tr, locale);
                    return (
                      <li key={s.id} className="px-3 py-2.5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-1.5 sm:gap-3" data-testid={`scheduled-restart-screen-${s.id}`}>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold text-slate-800 truncate">{s.name}</p>
                          <p className="text-[11px] text-slate-500">
                            {s.canRestart ? t('canRestart') : t('cannotRestart')}
                            {s.hardwareClass ? ` · ${s.hardwareClass}` : ''}
                            {s.restartedRecently ? ` · ${t('restartedRecently')}` : ''}
                          </p>
                        </div>
                        <StatusPill tone={last.tone} className="self-start">
                          {last.text}
                        </StatusPill>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}

          {saved && (
            <p role="status" className="mt-3 text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 leading-snug">
              {saved}
            </p>
          )}
          {error && (
            <p className="mt-3 text-[11px] text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-end gap-2 shrink-0 bg-slate-50/60 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 rounded-lg">
            {t('cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            data-testid="scheduled-restart-save"
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg flex items-center gap-1.5"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
