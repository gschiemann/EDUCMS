"use client";

/**
 * "Choose screens" — where an emergency alert goes (2026-10-05).
 *
 * Shared by the /panic page (phones, the primary surface), the dashboard
 * trigger modal and — since 2026-10-26 — the Custom message card. All are
 * always-dark life-safety surfaces, so this is too.
 *
 * One target per ALERT: All screens (the default, first row), ONE group, or
 * ONE screen. An operator who needs a second target sends a second alert.
 *
 * ONE exception, opt-in (2026-10-26, `multiScreens`): a custom message may be
 * aimed at SEVERAL specific screens — the owner, on site: "broadcast should
 * let me pick displays if i want as well and not have to hit them all." In
 * that mode a screen row TOGGLES instead of closing the sheet, a sticky
 * footer says "Selected: N screens", and Done commits the list. Everything
 * else — the sheet, the rows, the search, the "All screens" and group
 * choices, the loading / error / empty states — is the very same component.
 * Without the prop it is byte-for-byte the single-choice picker /panic and
 * the trigger modal have always used.
 *
 * Phone-first: a full-screen sheet with 56 px rows, a search field at 16 px
 * (iOS zooms anything smaller on focus), the keyboard NOT opened on arrival
 * (a sheet that throws a keyboard over the list is the wrong first frame
 * during an incident), and every state the lists can be in stated in words —
 * including "couldn't load", which never blocks All screens. Every control is
 * a real <button> with a visible focus ring, so a D-pad / keyboard reaches it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Loader2, MonitorSmartphone, Search, Users, X } from 'lucide-react';
import {
  filterTargets,
  groupDisplayName,
  groupTarget,
  isAllScreens,
  screenTarget,
  screensTarget,
  targetChipLabel,
  targetScreenIds,
  type EmergencyTarget,
  type EmergencyTargets,
} from '@/lib/emergency-target';

export interface EmergencyTargetPickerProps {
  open: boolean;
  /** The groups and screens; null while loading or after a failure. */
  targets: EmergencyTargets | null;
  status: 'loading' | 'ready' | 'error';
  selected: EmergencyTarget;
  /** The default target, with its screen count when known. */
  allScreens: EmergencyTarget;
  onSelect: (target: EmergencyTarget) => void;
  onClose: () => void;
  onRetry: () => void;
  /**
   * Choose SEVERAL specific screens (a custom message). Opt-in — see the
   * header. `onSelect` then receives `screensTarget([...])` for any list of
   * one or more screens, and the usual group / All-screens targets otherwise.
   */
  multiScreens?: boolean;
}

export function EmergencyTargetPicker({
  open,
  targets,
  status,
  selected,
  allScreens,
  onSelect,
  onClose,
  onRetry,
  multiScreens = false,
}: EmergencyTargetPickerProps) {
  const t = useTranslations();
  const [query, setQuery] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  // The screens ticked so far (multi mode only), in the order they were ticked.
  const [draftIds, setDraftIds] = useState<string[]>([]);

  /** Close with a fresh search for next time. */
  const close = () => {
    setQuery('');
    onClose();
  };
  // The latest `close` for the Escape listener below, which subscribes once
  // per opening rather than on every render.
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  // Focus the sheet (not the input — see the header) so a screen reader lands
  // in it; Escape closes it.
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Each opening starts from what is currently chosen (multi mode).
  useEffect(() => {
    if (open && multiScreens) setDraftIds(targetScreenIds(selected));
    // `selected` is read once per opening on purpose: ticking rows must not be
    // overwritten by the parent re-rendering with the same committed choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, multiScreens]);

  const { groups, screens } = useMemo(() => filterTargets(targets, query), [targets, query]);
  // A district admin sees several schools — say which one each row is in.
  const multiTenant = useMemo(() => {
    const ids = new Set<string>();
    for (const s of targets?.screens ?? []) ids.add(s.tenantId);
    for (const g of targets?.groups ?? []) ids.add(g.tenantId);
    return ids.size > 1;
  }, [targets]);

  if (!open) return null;

  const isSelected = (scopeType: string, scopeId: string) =>
    selected.scopeType === scopeType && selected.scopeId === scopeId;
  const pick = (target: EmergencyTarget) => {
    onSelect(target);
    close();
  };
  const draft = new Set(draftIds);
  const toggleScreen = (id: string) =>
    setDraftIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const selectAllShown = () =>
    setDraftIds((prev) => [...prev, ...screens.map((s) => s.id).filter((id) => !prev.includes(id))]);
  const commitScreens = () => {
    const byId = new Map((targets?.screens ?? []).map((s) => [s.id, s]));
    const chosen = draftIds.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
    if (chosen.length === 0) return;
    pick(screensTarget(chosen));
  };
  const searching = query.trim().length > 0;
  const nothingMatches = status === 'ready' && searching && groups.length === 0 && screens.length === 0;
  const nothingAtAll =
    status === 'ready' && !searching && (targets?.groups.length ?? 0) === 0 && (targets?.screens.length ?? 0) === 0;
  const allShownPicked = screens.length > 0 && screens.every((s) => draft.has(s.id));

  const rowCls =
    'w-full min-h-[56px] px-4 py-2.5 flex items-center gap-3 text-left rounded-xl border transition-colors ' +
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60';
  const rowStyle = (on: boolean) => ({
    background: on ? 'rgba(239,68,68,0.16)' : 'rgba(255,255,255,0.03)',
    borderColor: on ? 'rgba(248,113,113,0.85)' : 'rgba(255,255,255,0.10)',
  });

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="emergency-target-picker-title"
      tabIndex={-1}
      data-testid="emergency-target-picker"
      data-multi={multiScreens ? 'true' : undefined}
      className="fixed top-0 right-0 bottom-0 left-0 z-[120] flex flex-col text-white outline-none"
      style={{ background: 'linear-gradient(180deg, #121a30 0%, #0b1020 100%)' }}
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3 border-b border-white/10">
        <h2 id="emergency-target-picker-title" className="text-lg font-bold tracking-tight">
          {t('emergency.target.pickerTitle')}
        </h2>
        <button
          type="button"
          onClick={close}
          aria-label={t('emergency.target.pickerClose')}
          className="inline-flex items-center justify-center w-11 h-11 rounded-xl text-white/80 hover:text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <X className="w-5 h-5" aria-hidden />
        </button>
      </div>

      <div className="px-4 pt-3 pb-2">
        <label className="relative block">
          <span className="sr-only">{t('emergency.target.searchAria')}</span>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/50 pointer-events-none" aria-hidden />
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('emergency.target.searchPlaceholder')}
            className="w-full h-12 pl-9 pr-3 rounded-xl bg-slate-950/60 border border-white/15 text-[16px] text-white placeholder-white/45 outline-none focus:ring-2 focus:ring-red-500/70"
          />
        </label>
        {multiScreens && status === 'ready' && (targets?.screens.length ?? 0) > 0 && (
          <p className="mt-2 text-xs text-white/60" data-testid="target-multi-hint">
            {t('emergency.target.multiHint')}
          </p>
        )}
      </div>

      <div
        className={`flex-1 overflow-y-auto overscroll-contain px-4 space-y-5 ${
          multiScreens ? 'pb-4' : 'pb-[max(1.25rem,env(safe-area-inset-bottom))]'
        }`}
      >
        {/* The default, always first, always available — even when the lists fail. */}
        <button
          type="button"
          onClick={() => pick(allScreens)}
          aria-pressed={isAllScreens(selected)}
          data-testid="target-option-all"
          className={rowCls}
          style={rowStyle(isAllScreens(selected))}
        >
          <MonitorSmartphone className="w-5 h-5 shrink-0 text-white/75" aria-hidden />
          <span className="flex-1 min-w-0 font-semibold">{targetChipLabel(t, allScreens)}</span>
          {isAllScreens(selected) && <Check className="w-5 h-5 shrink-0 text-red-300" aria-hidden />}
        </button>

        {status === 'loading' && (
          <p className="flex items-center gap-2 text-sm text-white/65" role="status">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('emergency.target.loading')}
          </p>
        )}

        {status === 'error' && (
          <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-100" role="alert">
            <p>{t('emergency.target.loadFailed')}</p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 min-h-[44px] px-4 rounded-lg bg-white/10 hover:bg-white/15 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              {t('emergency.target.retry')}
            </button>
          </div>
        )}

        {nothingMatches && (
          <p className="text-sm text-white/65">{t('emergency.target.noMatches', { query: query.trim() })}</p>
        )}
        {nothingAtAll && <p className="text-sm text-white/65">{t('emergency.target.noTargets')}</p>}

        {status === 'ready' && groups.length > 0 && (
          <section aria-labelledby="emergency-target-groups">
            <h3 id="emergency-target-groups" className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/55 mb-2">
              {t('emergency.target.groups')}
            </h3>
            <ul className="space-y-2">
              {groups.map((g) => {
                const on = isSelected('group', g.id);
                return (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => pick(groupTarget(g))}
                      aria-pressed={on}
                      data-testid={`target-option-group-${g.id}`}
                      className={rowCls}
                      style={rowStyle(on)}
                    >
                      <Users className="w-5 h-5 shrink-0 text-white/70" aria-hidden />
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold truncate">{groupDisplayName(t, g.name)}</span>
                        <span className="block text-xs text-white/60 truncate">
                          {t('emergency.target.screenCount', { count: g.screenCount })}
                          {multiTenant && g.tenantName ? ` · ${g.tenantName}` : ''}
                        </span>
                      </span>
                      {on && <Check className="w-5 h-5 shrink-0 text-red-300" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {status === 'ready' && screens.length > 0 && (
          <section aria-labelledby="emergency-target-screens">
            <div className="flex items-center justify-between mb-2">
              <h3 id="emergency-target-screens" className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/55">
                {t('emergency.target.screens')}
              </h3>
              {multiScreens && screens.length > 1 && (
                <button
                  type="button"
                  onClick={allShownPicked ? () => setDraftIds((prev) => prev.filter((id) => !screens.some((s) => s.id === id))) : selectAllShown}
                  data-testid="target-multi-select-all"
                  className="min-h-[44px] px-3 -mr-3 rounded-lg text-xs font-bold text-white/85 hover:text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  {allShownPicked
                    ? t('emergency.target.unselectShown', { count: screens.length })
                    : t('emergency.target.selectShown', { count: screens.length })}
                </button>
              )}
            </div>
            <ul className="space-y-2">
              {screens.map((s) => {
                const on = multiScreens ? draft.has(s.id) : isSelected('device', s.id);
                const where = [s.location, s.groupName ? groupDisplayName(t, s.groupName) : null, multiTenant ? s.tenantName : null]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => (multiScreens ? toggleScreen(s.id) : pick(screenTarget(s)))}
                      aria-pressed={on}
                      data-testid={`target-option-screen-${s.id}`}
                      className={rowCls}
                      style={rowStyle(on)}
                    >
                      <span
                        className="w-2.5 h-2.5 shrink-0 rounded-full"
                        style={{ background: s.online ? '#34d399' : 'rgba(255,255,255,0.35)' }}
                        aria-hidden
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block font-semibold truncate">{s.name}</span>
                        <span className="block text-xs text-white/60 truncate">
                          {s.online ? t('emergency.target.online') : t('emergency.target.offline')}
                          {s.displayScreenCount > 1 ? ` · ${t('emergency.target.screenCount', { count: s.displayScreenCount })}` : ''}
                          {where ? ` · ${where}` : ''}
                        </span>
                      </span>
                      {multiScreens ? (
                        // A real checkbox look: a ticked or empty square, so "tap to add" reads at a glance.
                        <span
                          aria-hidden
                          className="w-6 h-6 shrink-0 rounded-md border flex items-center justify-center"
                          style={{
                            background: on ? '#ef4444' : 'transparent',
                            borderColor: on ? '#fca5a5' : 'rgba(255,255,255,0.35)',
                          }}
                        >
                          {on && <Check className="w-4 h-4 text-white" aria-hidden />}
                        </span>
                      ) : (
                        on && <Check className="w-5 h-5 shrink-0 text-red-300" aria-hidden />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {multiScreens && (
        <div
          data-testid="target-multi-footer"
          className="border-t border-white/10 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] flex items-center"
          style={{ background: 'rgba(8,12,24,0.92)' }}
        >
          <p
            className="flex-1 min-w-0 text-sm font-semibold"
            role="status"
            aria-live="polite"
            data-testid="target-multi-count"
          >
            {t('emergency.target.selectedCount', { count: draftIds.length })}
          </p>
          {draftIds.length > 0 && (
            <button
              type="button"
              onClick={() => setDraftIds([])}
              data-testid="target-multi-clear"
              className="min-h-[48px] px-4 mr-2 rounded-xl text-sm font-semibold text-white/80 hover:text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              {t('emergency.target.clearSelection')}
            </button>
          )}
          <button
            type="button"
            onClick={commitScreens}
            disabled={draftIds.length === 0}
            data-testid="target-multi-done"
            className="min-h-[48px] px-6 rounded-xl text-sm font-bold text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            style={{ background: 'linear-gradient(160deg, #ef4444 0%, #b91c1c 100%)' }}
          >
            {t('emergency.target.done')}
          </button>
        </div>
      )}
    </div>
  );
}
