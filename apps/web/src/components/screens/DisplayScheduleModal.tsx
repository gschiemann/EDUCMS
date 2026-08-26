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
 *  - crossing midnight is legal and normal (on 18:00 → off 02:00);
 *  - overlapping ACTIVE schedules COMBINE — the device unions its windows,
 *    so a second one can only ever extend the on-time.
 *
 * AFTER A SUCCESSFUL SAVE THE FORM STAYS ON THE ROW IT JUST WROTE.
 *
 * It used to reset — including `setIsActive(true)` — so an operator who
 * turned Active OFF and pressed Save watched the toggle spring straight back
 * to Active, read it as "the setting reverted", and had no way to tell the
 * save had worked at all. Worse than the confusion was what came next: the
 * form was now a BLANK NEW schedule wearing the old one's values, so
 * adjusting the times and pressing Save again created a SECOND, ACTIVE row
 * they believed was the paused one they had just written. (That is exactly
 * the shape of the group this fix came from: a paused 07:00→22:00 — the
 * form's own defaults — sitting beside an active 07:00→14:45.)
 *
 * So: on success we bind `editingId` to the saved row, leave every field
 * showing what was saved, and say so inline. The heading flips to "Editing
 * schedule" and the button to "Update schedule", so a further Save UPDATES
 * that row. A new blank schedule is reached only by pressing "+ Add
 * another" — one explicit click, which is where `isActive` legitimately
 * returns to its Active default.
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
  useScreens,
  type DisplaySchedule,
} from '@/hooks/use-api';
import {
  DISPLAY_SCHEDULE_DAYS,
  ALL_DAY_INDEXES,
  WEEKDAY_INDEXES,
  parseDays,
  serializeDays,
  formatDays,
  isEveryDay,
  crossesMidnight,
  summarizeScheduleOffPaths,
  scheduleWindowsOverlap,
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

  // ── WHAT "OFF" WILL ACTUALLY DO, BEFORE THE OPERATOR COMMITS ─────────
  //
  // 2026-08-25: one 07:00/14:45 window saved on a group produced four
  // different outcomes on five panels, and this editor said nothing about
  // any of it. It resolves PER PANEL — a group spans mechanisms — using the
  // server's own gate, so the line below is the same answer the manifest
  // will give, not a UI guess that can drift from it.
  //
  // `useScreens` is already mounted by the screens page this modal opens
  // from, so React Query serves it from cache: no second request, no second
  // poller.
  const { data: allScreens } = useScreens();
  const offPaths = useMemo(() => {
    const rows = (Array.isArray(allScreens) ? allScreens : []) as any[];
    const affected = rows.filter((s) =>
      target.kind === 'screen'
        ? s?.id === target.id
        : (s?.screenGroupId ?? s?.screenGroup?.id) === target.id,
    );
    return summarizeScheduleOffPaths(affected);
  }, [allScreens, target.kind, target.id]);

  const create = useCreateDisplaySchedule();
  const update = useUpdateDisplaySchedule();
  const remove = useDeleteDisplaySchedule();

  const [editingId, setEditingId] = useState<string | null>(null);
  // Wire encoding throughout: 0 = Sunday … 6 = Saturday (contract C2).
  const [days, setDays] = useState<number[]>([...ALL_DAY_INDEXES]);
  const [onTime, setOnTime] = useState('07:00');
  const [offTime, setOffTime] = useState('22:00');
  const [timezone, setTimezone] = useState(browserZone());
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * EXACTLY what the last successful save wrote, or null.
   *
   * The confirmation below renders only while the form STILL matches this
   * snapshot, so the first keystroke, day tap or toggle flip retires it. A
   * confirmation that outlived the values it names would be describing a
   * schedule that no longer exists — which is the same class of lie this
   * whole change is here to remove.
   */
  const [savedRow, setSavedRow] = useState<{
    id: string;
    days: number[];
    onTime: string;
    offTime: string;
    timezone: string;
    isActive: boolean;
  } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /**
   * Back to a genuinely NEW, blank schedule.
   *
   * `setIsActive(true)` is correct HERE and nowhere else: this runs from the
   * operator's explicit "+ Add another" (and after deleting the row being
   * edited), where an Active default is what they asked for. It must never
   * run as a side effect of saving — that is the spring-back the header
   * describes.
   */
  const resetForm = () => {
    setEditingId(null);
    setDays([...ALL_DAY_INDEXES]);
    setOnTime('07:00');
    setOffTime('22:00');
    setTimezone(browserZone());
    setIsActive(true);
    setError(null);
    setSavedRow(null);
  };

  const loadForEdit = (s: DisplaySchedule) => {
    setEditingId(s.id);
    setDays(parseDays(s.daysOfWeek));
    setOnTime(s.onTime || '07:00');
    setOffTime(s.offTime || '22:00');
    setTimezone(s.timezone || browserZone());
    setIsActive(s.isActive !== false);
    setError(null);
    setSavedRow(null);
  };

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  // `days.length > 0` is load-bearing, not belt-and-braces: the previous
  // build collapsed an empty selection to null and read null back as
  // "every day", so an operator who switched every day OFF got a screen
  // scheduled to blank every night. Zero days is now simply un-saveable —
  // which is also exactly what the API's `.min(1)` says.
  const valid =
    days.length > 0 &&
    /^\d{2}:\d{2}$/.test(onTime) &&
    /^\d{2}:\d{2}$/.test(offTime) &&
    timezone.trim().length > 2;
  const saving = create.isPending || update.isPending;

  const save = async () => {
    if (!valid || readOnly) return;
    setError(null);
    const cleanDays = serializeDays(days);
    const cleanZone = timezone.trim();
    const body = {
      daysOfWeek: cleanDays,
      onTime,
      offTime,
      timezone: cleanZone,
      isActive,
      ...(target.kind === 'screen' ? { screenId: target.id } : { screenGroupId: target.id }),
    };
    try {
      const row: unknown = editingId
        ? await update.mutateAsync({ id: editingId, ...body })
        : await create.mutateAsync(body);
      // Both endpoints return the persisted row; `editingId` covers the
      // update case if a future response shape ever drops it. With no id at
      // all we cannot bind the form to anything, so fall back to the blank
      // form rather than pretend to be editing a row we can't name.
      const id =
        (typeof row === 'object' && row !== null && typeof (row as { id?: unknown }).id === 'string'
          ? (row as { id: string }).id
          : null) ?? editingId;
      if (!id) {
        resetForm();
        return;
      }
      setEditingId(id);
      setDays(cleanDays);
      setTimezone(cleanZone);
      setSavedRow({
        id,
        days: cleanDays,
        onTime,
        offTime,
        timezone: cleanZone,
        isActive,
      });
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

  /**
   * One window in one line — days · on → off · zone.
   *
   * Takes parts rather than a row so the saved-confirmation can describe
   * what was just written with the SAME sentence the saved list uses. Two
   * phrasings for one window is how a UI ends up looking like it saved
   * something other than what it saved.
   */
  const describeWindow = (idx: number[], on: string, off: string, zone: string) => {
    // A ZERO-DAY ROW IS NOT "EVERY DAY" — it is a row the DEVICE DROPS.
    // DisplayConfig.kt refuses it outright ("schedule dropped — no valid days
    // of week"), so summarising it as "Every day" told the operator their
    // screen turns off nightly when in fact nothing is armed at all. The API's
    // `.min(1)` means this can only reach us from a raw-SQL/legacy row, which
    // is exactly the case nobody would think to re-check — so it says so, and
    // says what to do about it.
    const d =
      idx.length === 0
        ? t('screens.display.noDays')
        : isEveryDay(idx)
          ? t('screens.display.everyDay')
          : formatDays(idx);
    return `${d} · ${t('screens.display.onAt')} ${on} → ${t('screens.display.offAt')} ${off} · ${zone}`;
  };

  const summarize = (s: DisplaySchedule) =>
    // `parseDays` tolerates whatever the row actually holds. The previous
    // `s.daysOfWeek.replace(...)` assumed a string and threw a TypeError
    // *during render* on the real `Int[]`, unmounting the modal's subtree
    // and handing the operator a blank page instead of a schedule list.
    describeWindow(parseDays(s.daysOfWeek), s.onTime, s.offTime, s.timezone);

  // Memoised on the query result so the identity is stable between renders —
  // the overlap scan below is keyed on it.
  const list = useMemo(
    () => (Array.isArray(schedules) ? schedules : []),
    [schedules],
  );

  /** The form is still showing, unedited, exactly what the last save wrote. */
  const showingSavedRow =
    !!savedRow &&
    savedRow.id === editingId &&
    savedRow.onTime === onTime &&
    savedRow.offTime === offTime &&
    savedRow.timezone === timezone.trim() &&
    savedRow.isActive === isActive &&
    serializeDays(days).join(',') === savedRow.days.join(',');

  /**
   * Does what is in the form right now share a minute with a DIFFERENT
   * active schedule on this same target?
   *
   * Only asked of an ACTIVE draft, because a paused row is not armed and
   * cannot combine with anything. `editingId` is excluded — a row does not
   * overlap itself.
   *
   * Memoised because the resolver walks a week of minutes per pair: cheap
   * once, but this component re-renders on every keystroke in the timezone
   * field, and the house rule is that the phone pays for nothing it does not
   * need (CLAUDE.md, mobile performance standard).
   */
  const overlapsActive = useMemo(
    () =>
      isActive &&
      valid &&
      list.some(
        (s) =>
          s.id !== editingId &&
          s.isActive !== false &&
          scheduleWindowsOverlap(
            { daysOfWeek: days, onTime, offTime, timezone: timezone.trim() },
            {
              daysOfWeek: parseDays(s.daysOfWeek),
              onTime: s.onTime,
              offTime: s.offTime,
              timezone: s.timezone,
            },
          ),
      ),
    [isActive, valid, list, editingId, days, onTime, offTime, timezone],
  );

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

          {/* Same slate note idiom as the per-axis lines in
              ScreenDisplayControls: plain, present tense, says what the
              control does — no incident story, no dates. Rendered only when
              at least one targeted panel is on the soft path, so a fleet of
              proven panels sees nothing extra. */}
          {offPaths.soft > 0 && (
            <p className="text-[11px] text-slate-500 leading-snug -mt-2 mb-4 px-3">
              {offPaths.soft === offPaths.total
                ? t('screens.display.scheduleSoftOffAll')
                : t('screens.display.scheduleSoftOffSome', {
                    count: offPaths.soft,
                    total: offPaths.total,
                  })}
            </p>
          )}

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
                      className="flex-1 min-w-0 text-left min-h-[44px] flex flex-col justify-center"
                    >
                      <span className="block text-[11px] font-semibold text-slate-700 leading-snug">
                        {summarize(s)}
                      </span>
                      {!s.isActive && (
                        <span className="block text-[10px] font-bold text-amber-600 mt-0.5">
                          {t('screens.display.paused')}
                        </span>
                      )}
                    </button>
                    {/* ── THE DELETE THE OPERATOR COULD NOT FIND ────────
                        It was a bare `text-slate-300` trash glyph: light
                        grey on white, no label, an 18px hit area. He asked
                        how to delete a schedule while looking straight at
                        it. So it is now a LABELLED button in the house's
                        destructive palette, at the 44px touch target this
                        product's phone-first operator needs — one control,
                        not a toolbar. The row itself stays the edit
                        target, and `appConfirm` stays the only confirm.

                        Hidden rather than disabled when read-only: a
                        prominent Delete a CONTRIBUTOR can never use is the
                        "real-button costume" this repo bans (CLAUDE.md
                        §20). Their Save is disabled in the footer for the
                        same reason, and reading a schedule is all their
                        role is granted. */}
                    {!readOnly && (
                      <button
                        type="button"
                        onClick={() => del(s)}
                        disabled={remove.isPending}
                        aria-label={t('screens.display.scheduleDeleteRow', {
                          schedule: summarize(s),
                        })}
                        className="shrink-0 inline-flex items-center gap-1 min-h-[44px] px-2.5 rounded-lg border border-rose-200 bg-white text-rose-600 text-[11px] font-bold hover:bg-rose-50 hover:border-rose-300 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        {t('screens.display.scheduleDelete')}
                      </button>
                    )}
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
                setDays([...WEEKDAY_INDEXES]);
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
                setDays([...ALL_DAY_INDEXES]);
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
                key={d.index}
                type="button"
                onClick={() => toggleDay(d.index)}
                aria-pressed={days.includes(d.index)}
                className={`mr-1 mb-1 px-3 min-h-[40px] text-[11px] font-bold rounded-lg transition-all ${
                  days.includes(d.index)
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-white text-slate-400 border border-slate-200 hover:border-indigo-300'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          {days.length === 0 && (
            <p className="text-[10px] text-amber-600 font-semibold -mt-2 mb-3">
              {t('screens.display.pickADay')}
            </p>
          )}

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

          {/* ── WHAT THE SAVE ACTUALLY DID ────────────────────────────
              Directly under the toggle, because the toggle is what the
              operator is watching when they press Save, and it is the
              control that used to appear to revert. It names the days,
              times and zone that were written, and says "paused" out loud
              when they are — a save whose result you have to go hunting
              for is a save you do not trust. `role="status"` so a screen
              reader hears it too; it is inline and stays put until the
              form changes, deliberately NOT a toast. */}
          {showingSavedRow && savedRow && (
            <p
              role="status"
              className="mt-3 text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 leading-snug"
            >
              {savedRow.isActive
                ? t('screens.display.scheduleSavedActive', {
                    summary: describeWindow(
                      savedRow.days,
                      savedRow.onTime,
                      savedRow.offTime,
                      savedRow.timezone,
                    ),
                  })
                : t('screens.display.scheduleSavedPaused', {
                    summary: describeWindow(
                      savedRow.days,
                      savedRow.onTime,
                      savedRow.offTime,
                      savedRow.timezone,
                    ),
                  })}
            </p>
          )}

          {/* ── TWO ACTIVE WINDOWS DO NOT COMPETE, THEY COMBINE ───────
              The device's `desiredOnAt` is `schedules.any { covers(…) }`,
              so the screen is on whenever ANY active window says on. An
              operator adding a shorter window beside a longer one is not
              shortening anything — the earlier "turns off" never fires.
              Only rendered on a genuine minute-level collision; see
              `scheduleWindowsOverlap`. */}
          {overlapsActive && (
            <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 leading-snug">
              {t('screens.display.scheduleOverlapNote')}
            </p>
          )}

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
