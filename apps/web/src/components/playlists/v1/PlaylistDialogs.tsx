"use client";

/**
 * The two dialogs the playlist workspace opens — both of them the wizard's own
 * steps, mounted here rather than rebuilt.
 *
 * Greg, 2026-09-16, pointing at the wizard twice:
 *   Screens  — "when i hit add screens it should pull up this menu for me to
 *              add more screens to my playlist"        → Step3Screens
 *   Schedule — "the schedule should not show any screen, it should show the
 *              current active schulde and if i hit edit or add schcule it
 *              pulls up this screen"                    → Step4Publish
 *
 * Before this, both buttons opened the "Publish to Screens" bottom sheet: a
 * screen picker with a window attached. That is the right shape for the FIRST
 * publish and the wrong shape for both of these questions — which is why the
 * Schedule tab kept reading as a screen list no matter how much copy moved.
 *
 * Nothing here re-implements a picker. The wizard's steps are pure
 * presentational components (parent owns all state), so they are imported and
 * driven from here — the same move that made ScheduleWindowFields shared
 * between the wizard and the publish sheet, for the same reason: two
 * hand-rolled copies of one concept is how one of them silently goes wrong.
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import { Step3Screens, Step4Publish } from '@/components/playlists/PlaylistCreateWizard';
import { useCreateSchedule, useUpdateSchedule } from '@/hooks/use-api';
import type { OpsGroupRef, OpsScheduleRef, OpsScreenRef } from './playlistOps';

const DEFAULT_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/* ── shared shell ─────────────────────────────────────────────────────
   Portaled to document.body for the reason the wizard documents: an
   ancestor with transform/filter makes `position: fixed` relative to THAT
   ancestor instead of the viewport, and the dialog lands half off-screen
   inside the dashboard shell. */
function Shell({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  if (typeof window === 'undefined') return null;

  const scrim: CSSProperties = {
    position: 'fixed',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    overflow: 'hidden',
  };
  const panel: CSSProperties = {
    position: 'relative',
    zIndex: 1,
    width: '100%',
    maxWidth: 800,
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'white',
    borderRadius: 20,
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
  };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} style={scrim}>
      {/* A REAL button for the backdrop, not a div with onClick.
          click-events-have-key-events fires on the latter, and the a11y
          baseline (43) is a ratchet that only goes down — the same fix the
          playlist preview overlay took earlier today rather than raising it. */}
      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={onClose}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, left: 0,
          background: 'transparent', border: 0, padding: 0, cursor: 'default',
        }}
      />
      <div style={panel}>
        <div className="px-6 pt-5 pb-4 flex items-start justify-between border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-slate-900">{title}</h2>
            <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg p-1.5 transition-colors shrink-0"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 min-h-0">{children}</div>
        <div className="border-t border-slate-100 bg-slate-50/40 px-6 py-3 flex items-center justify-end gap-2">
          {footer}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── window inheritance ───────────────────────────────────────────────
   A screen added to a playlist that plays "Always" must not silently
   acquire a weekday window, and one added to a playlist that plays
   Mon-Fri 8-3 must not silently start playing at 3am. So: copy the window
   only when every existing rule already agrees on one. When they disagree
   there is no single honest answer, and always-on is the one that cannot
   hide the playlist from a screen the operator just chose. */
export function inheritedWindow(schedules: OpsScheduleRef[]): {
  daysOfWeek?: string; timeStart?: string; timeEnd?: string;
} {
  if (schedules.length === 0) return {};
  const key = (s: OpsScheduleRef) =>
    `${s.daysOfWeek ?? ''}|${s.timeStart ?? ''}|${s.timeEnd ?? ''}`;
  const first = key(schedules[0]);
  if (!schedules.every((s) => key(s) === first)) return {};
  const s = schedules[0];
  if (!s.daysOfWeek && !s.timeStart && !s.timeEnd) return {};
  return {
    ...(s.daysOfWeek ? { daysOfWeek: s.daysOfWeek } : {}),
    ...(s.timeStart ? { timeStart: s.timeStart } : {}),
    ...(s.timeEnd ? { timeEnd: s.timeEnd } : {}),
  };
}

/* ── Add screens ──────────────────────────────────────────────────── */

export function AddScreensDialog({
  open,
  onClose,
  playlistId,
  screens,
  groups,
  schedules,
  alreadyScreenIds,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  playlistId: string;
  screens: OpsScreenRef[];
  groups: OpsGroupRef[];
  /** This playlist's existing rules — the window to inherit comes from these. */
  schedules: OpsScheduleRef[];
  /** Screens it already plays on; they are not offered a second time. */
  alreadyScreenIds: Set<string>;
  onDone: () => void;
}) {
  const [search, setSearch] = useState('');
  const [pickedScreens, setPickedScreens] = useState<Set<string>>(new Set());
  const [pickedGroups, setPickedGroups] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createSchedule = useCreateSchedule();

  // Screens it already plays on are removed rather than shown ticked: a
  // pre-ticked row the operator can untick implies unticking REMOVES it,
  // and nothing here removes anything.
  const addable = useMemo(
    () => screens.filter((s) => !alreadyScreenIds.has(s.id)),
    [screens, alreadyScreenIds],
  );
  const visible = useMemo(() => {
    if (!search) return addable;
    const needle = search.toLowerCase();
    return addable.filter((s) => `${s.name || ''} ${s.id}`.toLowerCase().includes(needle));
  }, [addable, search]);

  if (!open) return null;

  const count = pickedScreens.size;

  const submit = async () => {
    if (count === 0 && pickedGroups.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      const base = {
        playlistId,
        startTime: new Date().toISOString(),
        priority: 0,
        mode: 'replace' as const,
        isActive: true,
        ...inheritedWindow(schedules),
      };
      // A picked group becomes ONE group-scoped rule that keeps fanning out to
      // screens added to that group later; its members must not ALSO get a
      // per-screen rule, or the two drift apart. Same rule the wizard uses.
      const covered = new Set<string>();
      for (const g of groups) {
        if (pickedGroups.has(g.id)) (g.screens ?? []).forEach((s) => { if (s?.id) covered.add(s.id); });
      }
      const rules = [
        ...Array.from(pickedGroups).map((screenGroupId) => ({ ...base, screenGroupId })),
        ...Array.from(pickedScreens)
          .filter((id) => !covered.has(id) && !alreadyScreenIds.has(id))
          .map((screenId) => ({ ...base, screenId })),
      ];
      await Promise.all(rules.map((r) => createSchedule.mutateAsync(r as any)));
      setPickedScreens(new Set());
      setPickedGroups(new Set());
      onDone();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Those screens were not added. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Add screens"
      subtitle="Pick the screens this playlist should also play on."
      onClose={onClose}
      footer={
        <>
          {error && <p className="text-xs text-rose-600 mr-auto">{error}</p>}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || (count === 0 && pickedGroups.size === 0)}
            className="px-4 py-2 text-sm font-bold rounded-lg text-white inline-flex items-center gap-2 disabled:opacity-50"
            style={{ background: 'var(--brand-primary, #3515E8)' }}
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
            Add {count || ''} screen{count === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      {addable.length === 0 ? (
        <p className="text-sm text-slate-500 py-10 text-center">
          This playlist already plays on every screen you have.
        </p>
      ) : (
        <Step3Screens
          screens={visible}
          total={addable.length}
          groups={groups}
          search={search}
          setSearch={setSearch}
          selectedIds={pickedScreens}
          onToggle={(id: string) => {
            setPickedScreens((prev) => {
              const next = new Set(prev);
              if (next.has(id)) next.delete(id); else next.add(id);
              return next;
            });
            // Hand-editing a member downgrades the group to per-screen, so a
            // whole-group rule never ignores the operator's edit.
            setPickedGroups((prev) => {
              const next = new Set(prev);
              for (const g of groups) {
                if ((g.screens ?? []).some((s) => s?.id === id)) next.delete(g.id);
              }
              return next;
            });
          }}
          onPickGroup={(group: any) => {
            const ids: string[] = (group.screens || []).map((s: any) => s.id).filter(Boolean);
            if (!ids.length) return;
            const turningOff = ids.every((id) => pickedScreens.has(id));
            setPickedScreens((prev) => {
              const next = new Set(prev);
              ids.forEach((id) => (turningOff ? next.delete(id) : next.add(id)));
              return next;
            });
            setPickedGroups((prev) => {
              const next = new Set(prev);
              if (turningOff) next.delete(group.id); else next.add(group.id);
              return next;
            });
          }}
          onSkip={onClose}
        />
      )}
    </Shell>
  );
}

/* ── Edit / add a schedule ────────────────────────────────────────── */

export function ScheduleDialog({
  open,
  onClose,
  playlistId,
  schedule,
  applyToIds,
  targetCount,
  addTargets,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  playlistId: string;
  /** The rule being changed; null adds a new one. */
  schedule: OpsScheduleRef | null;
  /**
   * Every rule this edit applies to (2026-09-16). Greg: "it should not show
   * multiple schedules per screen, one schedule covers all screens".
   *
   * The data model is one Schedule ROW per target, so a playlist on ten screens
   * has ten rows that all say "Every day · All day". The tab now groups them
   * into one card per WINDOW, and editing that card has to write the new window
   * to every row behind it — otherwise nine screens keep the old times and the
   * one card starts lying about what it covers.
   */
  applyToIds?: string[];
  /** How many screens these rules apply to — stated, never listed. */
  targetCount: number;
  /** Targets a NEW rule applies to, taken from what the playlist already has. */
  addTargets: { screenIds: string[]; groupIds: string[] };
  onDone: () => void;
}) {
  const windowed = !!(schedule?.daysOfWeek || schedule?.timeStart);
  const [activate, setActivate] = useState(!windowed);
  const [days, setDays] = useState<string[]>(
    schedule?.daysOfWeek ? schedule.daysOfWeek.split(',') : DEFAULT_DAYS,
  );
  const [timeStart, setTimeStart] = useState(schedule?.timeStart || '08:00');
  const [timeEnd, setTimeEnd] = useState(schedule?.timeEnd || '15:00');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createSchedule = useCreateSchedule();
  const updateSchedule = useUpdateSchedule();

  if (!open) return null;

  const hasTargets = addTargets.screenIds.length > 0 || addTargets.groupIds.length > 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    // Always-on clears the window; a windowed rule writes exactly what was
    // picked. Null, not undefined, so clearing a window actually clears it.
    const win = activate
      ? { daysOfWeek: null, timeStart: null, timeEnd: null }
      : { daysOfWeek: days.join(','), timeStart, timeEnd };
    try {
      if (schedule) {
        // Every row behind this card, not just the sample it was built from.
        const ids = applyToIds && applyToIds.length > 0 ? applyToIds : [schedule.id];
        await Promise.all(ids.map((id) => updateSchedule.mutateAsync({ id, ...win } as any)));
      } else {
        const base = {
          playlistId,
          startTime: startDate ? new Date(`${startDate}T00:00:00`).toISOString() : new Date().toISOString(),
          endTime: endDate ? new Date(`${endDate}T23:59:59`).toISOString() : undefined,
          priority: 0,
          mode: 'replace' as const,
          isActive: true,
          ...(activate ? {} : { daysOfWeek: days.join(','), timeStart, timeEnd }),
        };
        const rules = [
          ...addTargets.groupIds.map((screenGroupId) => ({ ...base, screenGroupId })),
          ...addTargets.screenIds.map((screenId) => ({ ...base, screenId })),
        ];
        await Promise.all(rules.map((r) => createSchedule.mutateAsync(r as any)));
      }
      onDone();
      onClose();
    } catch (e: any) {
      setError(e?.message || 'That schedule was not saved. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title={schedule ? 'Edit schedule' : 'Add schedule'}
      subtitle="Choose the days and times this playlist plays."
      onClose={onClose}
      footer={
        <>
          {error && <p className="text-xs text-rose-600 mr-auto">{error}</p>}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || (!schedule && !hasTargets) || (!activate && days.length === 0)}
            className="px-4 py-2 text-sm font-bold rounded-lg text-white inline-flex items-center gap-2 disabled:opacity-50"
            style={{ background: 'var(--brand-primary, #3515E8)' }}
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
            Save schedule
          </button>
        </>
      }
    >
      {!schedule && !hasTargets ? (
        <p className="text-sm text-slate-500 py-10 text-center">
          This playlist is not on a screen yet. Add screens first, then set when it plays.
        </p>
      ) : (
        <>
          {!activate && days.length === 0 && (
            <p role="alert" className="mb-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Pick at least one day, or choose Activate immediately — a window with no
              days runs on no day at all.
            </p>
          )}
          <Step4Publish
            activate={activate}
            setActivate={setActivate}
            startDate={startDate}
            setStartDate={setStartDate}
            endDate={endDate}
            setEndDate={setEndDate}
            timeStart={timeStart}
            setTimeStart={setTimeStart}
            timeEnd={timeEnd}
            setTimeEnd={setTimeEnd}
            days={days}
            toggleDay={(d: string) =>
              setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
            }
            screensPicked={targetCount}
          />
        </>
      )}
    </Shell>
  );
}
