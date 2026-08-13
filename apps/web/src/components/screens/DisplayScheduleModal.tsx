'use client';

/**
 * DisplayScheduleModal — on/off times for one screen or one screen group.
 *
 * WHY IT IS A MODAL, not another block in the gear popover: the popover is
 * width-derived (clamped to `calc(100vw - 24px)`) and already scrolls on a
 * phone. A day-picker + two time fields + a timezone + a saved-schedule
 * list does not belong in there. The popover row that opens this closes the
 * popover FIRST — the popover dismisses on a document-level pointerdown, so
 * a nested overlay inside it would fight its own outside-click handler.
 *
 * WHAT THE OPERATOR NEEDS TO KNOW, and the UI says out loud:
 *  - the schedule runs ON THE DEVICE (AlarmManager), so a screen that loses
 *    the network still blanks at 22:00 and wakes at 07:00;
 *  - it honors the timezone set HERE, not the device's own locale — a
 *    Goodview box shipped from Shenzhen boots on the wrong clock;
 *  - crossing midnight is legal and normal (on 18:00 → off 02:00).
 *
 * Layout follows the house sheet pattern (publish sheet, playlists/page):
 * bottom-sheet on phone / centred card on desktop, sticky header + footer,
 * safe-area padding, max-h-[90dvh]. Physical longhand positioning (no
 * `inset-*`) purely as house style — this surface is dashboard-only.
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarClock, X, Loader2, Trash2, Check, Info } from 'lucide-react';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { appConfirm } from '@/components/ui/app-dialog';
import {
  useDisplaySchedules,
  useCreateDisplaySchedule,
  useUpdateDisplaySchedule,
  useDeleteDisplaySchedule,
  type DisplaySchedule,
} from '@/hooks/use-api';
import {
  DISPLAY_SCHEDULE_DAYS,
  parseDays,
  serializeDays,
  crossesMidnight,
} from './display-capabilities';

export interface DisplayScheduleTargetRef {
  kind: 'screen' | 'group';
  id: string;
  name: string;
}

/**
 * A short, deliberately US/EU-weighted zone list for the dropdown. The
 * field stays a free-text `input` with this as a `datalist`, so any IANA
 * zone remains typeable — same escape hatch as the OTA maintenance-window
 * card in settings, which is the closest existing analogue.
 */
const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Madrid',
  'Asia/Shanghai',
];

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';
  } catch {
    return 'America/Chicago';
  }
}

export function DisplayScheduleModal({
  target,
  readOnly,
  onClose,
}: {
  target: DisplayScheduleTargetRef;
  readOnly?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations();
  useOverlayLock();

  const queryTarget = useMemo(
    () => (target.kind === 'screen' ? { screenId: target.id } : { screenGroupId: target.id }),
    [target.kind, target.id],
  );
  const { data: schedules, isLoading } = useDisplaySchedules(queryTarget);
  const create = useCreateDisplaySchedule();
  const update = useUpdateDisplaySchedule();
  const remove = useDeleteDisplaySchedule();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [days, setDays] = useState<string[]>([...DISPLAY_SCHEDULE_DAYS]);
  const [onTime, setOnTime] = useState('07:00');
  const [offTime, setOffTime] = useState('22:00');
  const [timezone, setTimezone] = useState(browserZone());
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const resetForm = () => {
    setEditingId(null);
    setDays([...DISPLAY_SCHEDULE_DAYS]);
    setOnTime('07:00');
    setOffTime('22:00');
    setTimezone(browserZone());
    setIsActive(true);
    setError(null);
  };

  const loadForEdit = (s: DisplaySchedule) => {
    setEditingId(s.id);
    setDays(parseDays(s.daysOfWeek));
    setOnTime(s.onTime || '07:00');
    setOffTime(s.offTime || '22:00');
    setTimezone(s.timezone || browserZone());
    setIsActive(s.isActive !== false);
    setError(null);
  };

  const toggleDay = (d: string) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const valid =
    /^\d{2}:\d{2}$/.test(onTime) && /^\d{2}:\d{2}$/.test(offTime) && timezone.trim().length > 2;
  const saving = create.isPending || update.isPending;

  const save = async () => {
    if (!valid || readOnly) return;
    setError(null);
    const body = {
      daysOfWeek: serializeDays(days),
      onTime,
      offTime,
      timezone: timezone.trim(),
      isActive,
      ...(target.kind === 'screen' ? { screenId: target.id } : { screenGroupId: target.id }),
    };
    try {
      if (editingId) await update.mutateAsync({ id: editingId, ...body });
      else await create.mutateAsync(body);
      resetForm();
    } catch (e) {
      setError((e instanceof Error && e.message) || t('screens.display.scheduleSaveFailed'));
    }
  };

  const del = async (s: DisplaySchedule) => {
    if (readOnly) return;
    const ok = await appConfirm({
      title: t('screens.display.scheduleDeleteTitle'),
      message: t('screens.display.scheduleDeleteBody'),
      tone: 'danger',
      confirmLabel: t('screens.display.scheduleDelete'),
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(s.id);
      if (editingId === s.id) resetForm();
    } catch (e) {
      setError((e instanceof Error && e.message) || t('screens.display.scheduleSaveFailed'));
    }
  };

  const summarize = (s: DisplaySchedule) => {
    const d = s.daysOfWeek ? s.daysOfWeek.replace(/,/g, ' ') : t('screens.display.everyDay');
    return `${d} · ${t('screens.display.onAt')} ${s.onTime} → ${t('screens.display.offAt')} ${s.offTime} · ${s.timezone}`;
  };

  const list = Array.isArray(schedules) ? schedules : [];

  return (
    <div
      className="fixed top-0 right-0 bottom-0 left-0 z-[100] flex items-end md:items-center justify-center bg-slate-900/40 p-0 md:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('screens.display.scheduleTitle')}
    >
      <button className="absolute top-0 right-0 bottom-0 left-0 cursor-default" aria-label={t('screens.cancel')} onClick={onClose} />
      <div className="relative z-10 w-full md:max-w-lg bg-white rounded-t-2xl md:rounded-2xl shadow-2xl max-h-[90dvh] flex flex-col overflow-hidden">
        {/* Sticky header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-800 flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-indigo-500 shrink-0" />
              {t('screens.display.scheduleTitle')}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {target.kind === 'group'
                ? t('screens.display.scheduleForGroup', { name: target.name })
                : t('screens.display.scheduleForScreen', { name: target.name })}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t('screens.closeDialog')}
            className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex-1">
          <div className="flex items-start gap-2 mb-4 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
            <Info className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-500 leading-snug">
              {t('screens.display.scheduleExplainer')}
            </p>
          </div>

          {/* Saved schedules */}
          {isLoading ? (
            <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-4">
              <Loader2 className="w-3 h-3 animate-spin" /> {t('screens.display.loading')}
            </div>
          ) : list.length > 0 ? (
            <div className="mb-5">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                {t('screens.display.scheduleSaved')}
              </p>
              <div className="space-y-1.5">
                {list.map((s) => (
                  <div
                    key={s.id}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                      editingId === s.id
                        ? 'border-indigo-300 bg-indigo-50/50'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => loadForEdit(s)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <span className="block text-[11px] font-semibold text-slate-700 truncate">
                        {summarize(s)}
                      </span>
                      {!s.isActive && (
                        <span className="block text-[10px] font-bold text-amber-600 mt-0.5">
                          {t('screens.display.paused')}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => del(s)}
                      disabled={readOnly || remove.isPending}
                      aria-label={t('screens.display.scheduleDelete')}
                      className="p-1.5 rounded-md text-slate-300 hover:text-rose-500 hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Editor */}
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
            {editingId ? t('screens.display.scheduleEditing') : t('screens.display.scheduleNew')}
          </p>

          {/* One-tap presets — the 30-second happy path. */}
          <div className="flex flex-wrap mb-3">
            <button
              type="button"
              onClick={() => {
                setDays(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
                setOnTime('07:00');
                setOffTime('16:00');
              }}
              className="mr-2 mb-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
            >
              {t('screens.display.presetSchoolDay')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDays([...DISPLAY_SCHEDULE_DAYS]);
                setOnTime('07:00');
                setOffTime('22:00');
              }}
              className="mr-2 mb-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white text-[11px] font-semibold text-slate-600 hover:border-indigo-300 hover:text-indigo-600"
            >
              {t('screens.display.presetOvernightOff')}
            </button>
          </div>

          {/* Days — ≥40px touch targets, same rule the playlist schedule
              fields learned the hard way on a phone. */}
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
            {t('screens.display.days')}
          </p>
          <div className="flex flex-wrap mb-3">
            {DISPLAY_SCHEDULE_DAYS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                aria-pressed={days.includes(d)}
                className={`mr-1 mb-1 px-3 min-h-[40px] text-[11px] font-bold rounded-lg transition-all ${
                  days.includes(d)
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white text-slate-400 border border-slate-200 hover:border-indigo-300'
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          {/* Times */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-end mb-3">
            <label className="flex-1 min-w-0 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              {t('screens.display.turnOnAt')}
              <input
                type="time"
                value={onTime}
                onChange={(e) => setOnTime(e.target.value)}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm font-mono text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <span className="my-1 sm:my-0 sm:mx-2 sm:mb-2.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider text-center">
              {t('screens.display.until')}
            </span>
            <label className="flex-1 min-w-0 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              {t('screens.display.turnOffAt')}
              <input
                type="time"
                value={offTime}
                onChange={(e) => setOffTime(e.target.value)}
                className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm font-mono text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
          </div>
          {crossesMidnight(onTime, offTime) && (
            <p className="text-[10px] text-slate-500 -mt-2 mb-3">
              {t('screens.display.crossesMidnight')}
            </p>
          )}

          {/* Timezone */}
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">
            {t('screens.display.timezone')}
            <input
              type="text"
              list="display-schedule-timezones"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              placeholder="America/Chicago"
              className="block mt-1 w-full px-3 py-2 border border-slate-200 rounded-lg bg-white text-sm font-mono text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <datalist id="display-schedule-timezones">
              {COMMON_TIMEZONES.map((z) => (
                <option key={z} value={z} />
              ))}
            </datalist>
            <span className="block mt-1 text-[10px] font-normal normal-case tracking-normal text-slate-400 leading-snug">
              {t('screens.display.timezoneHint')}
            </span>
          </label>

          {/* Active */}
          <button
            type="button"
            role="switch"
            aria-checked={isActive}
            onClick={() => setIsActive((v) => !v)}
            className="flex items-center gap-2.5 mb-1"
          >
            <span
              className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${
                isActive ? 'bg-indigo-600' : 'bg-slate-300'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                  isActive ? 'translate-x-4' : ''
                }`}
              />
            </span>
            <span className="text-[11px] font-semibold text-slate-600">
              {isActive ? t('screens.display.active') : t('screens.display.paused')}
            </span>
          </button>

          {error && (
            <p className="mt-3 text-[11px] text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Sticky footer */}
        <div className="px-5 py-3 border-t border-slate-100 flex items-center justify-between gap-2 shrink-0 bg-slate-50/60 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded-lg"
            >
              {t('screens.display.scheduleAddAnother')}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 rounded-lg"
            >
              {t('screens.cancel')}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!valid || saving || !!readOnly}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {editingId ? t('screens.display.scheduleUpdate') : t('screens.display.scheduleSave')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
