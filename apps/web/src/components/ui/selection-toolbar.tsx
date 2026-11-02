'use client';

/**
 * SelectionToolbar + ActionDock — what a multi-select turns the page into
 * (pill audit 2026-11-02, rule 6; generalised from the Media Library's
 * AssetSelectionToolbar / AssetSelectionDock, PR #237, which are now thin
 * adapters over this file).
 *
 *   - `SelectionToolbar` — desktop. It REPLACES the page toolbar in place, at
 *     the same height, so the page never grows; the filters come back when
 *     the selection is cleared. ✕ · "N selected" · "Select all N" · actions.
 *   - `ActionDock` — phone width. A full-width bar sitting exactly on top of
 *     the mobile tab bar (measured, not guessed), thumb-reachable. Quiet
 *     actions fold into "⋯"; the danger action stays visible (icon-only) and
 *     the primary stays a filled button.
 *
 * One action list feeds both. Order on screen: quiet … · danger · primary.
 * A danger action (Delete) is NEVER put in "⋯" (owner rule, 2026-11-02).
 * Mobile-perf standard: no blur, no pollers; the dock animates a transform.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useUIStore } from '@/store/ui-store';
import { OverflowMenu, OVERFLOW_ICON_BUTTON } from './overflow-menu';

export interface SelectionAction {
  id: string;
  /** Visible text on the desktop button. */
  label: string;
  /** Accessible name when it differs from `label` (e.g. "Move" → "Move to folder"). */
  ariaLabel?: string;
  /** Text in the phone's "⋯" menu (default `ariaLabel ?? label`). */
  menuLabel?: string;
  icon?: ReactNode;
  onSelect: () => void;
  variant?: 'quiet' | 'danger' | 'primary';
  disabled?: boolean;
  title?: string;
  busy?: boolean;
  /** Desktop too: put this quiet action in "⋯" instead of the bar. */
  overflow?: boolean;
  testId?: string;
}

export interface SelectAllOffer {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  busy?: boolean;
  testId?: string;
}

export interface SelectionBarProps {
  count: number;
  /** "3 selected" — defaults to `ui.selectedCount`. */
  countLabel?: string;
  onClear: () => void;
  selectAll?: SelectAllOffer | null;
  actions: SelectionAction[];
  ariaLabel?: string;
  testId?: string;
  moreTestId?: string;
  moreMenuTestId?: string;
  /** Extra controls placed before the actions (e.g. a native <select>). */
  extra?: ReactNode;
}

export const SELECTION_QUIET =
  'min-h-11 sm:min-h-0 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
export const SELECTION_DANGER =
  'min-h-11 sm:min-h-0 px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white text-xs font-bold text-rose-700 hover:bg-rose-50 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
export const SELECTION_PRIMARY =
  'min-h-11 sm:min-h-0 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap';

function SelectAllLink({ offer }: { offer?: SelectAllOffer | null }) {
  if (!offer) return null;
  return (
    <button
      type="button"
      onClick={offer.onSelect}
      disabled={offer.busy || offer.disabled}
      aria-busy={offer.busy}
      data-testid={offer.testId}
      className="min-h-11 sm:min-h-0 px-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900 hover:underline underline-offset-2 disabled:opacity-50 whitespace-nowrap"
    >
      {offer.label}
    </button>
  );
}

function ActionButton({ a, iconOnly }: { a: SelectionAction; iconOnly?: boolean }) {
  const cls = a.variant === 'danger' ? SELECTION_DANGER : a.variant === 'primary' ? SELECTION_PRIMARY : SELECTION_QUIET;
  return (
    <button
      type="button"
      onClick={a.onSelect}
      disabled={a.disabled}
      aria-busy={a.busy || undefined}
      title={a.title ?? (iconOnly ? a.ariaLabel ?? a.label : undefined)}
      aria-label={iconOnly ? a.ariaLabel ?? a.label : a.ariaLabel}
      data-testid={a.testId}
      className={`${cls} ${iconOnly ? 'min-w-11' : ''}`}
    >
      {a.icon}
      {!iconOnly && a.label}
    </button>
  );
}

function split(actions: SelectionAction[]) {
  return {
    quiet: actions.filter((a) => (a.variant ?? 'quiet') === 'quiet'),
    danger: actions.filter((a) => a.variant === 'danger'),
    primary: actions.filter((a) => a.variant === 'primary'),
  };
}

const toMenu = (a: SelectionAction) => ({
  id: a.id, label: a.menuLabel ?? a.ariaLabel ?? a.label, icon: a.icon, onSelect: a.onSelect, disabled: a.disabled || a.busy, title: a.title,
});

/** Desktop: the page toolbar turns into this, in place, at the same height. */
export function SelectionToolbar(props: SelectionBarProps) {
  const t = useTranslations();
  const { quiet, danger, primary } = split(props.actions);
  const inBar = quiet.filter((a) => !a.overflow);
  const inMore = quiet.filter((a) => a.overflow);
  return (
    <div
      role="region"
      aria-label={props.ariaLabel ?? t('ui.selectionActions')}
      data-testid={props.testId}
      data-placement="toolbar"
      className="flex items-center gap-1 h-full min-w-0"
    >
      <button type="button" onClick={props.onClear} aria-label={t('ui.clearSelection')} title={t('ui.clearSelection')} className={OVERFLOW_ICON_BUTTON}>
        <X className="w-4 h-4" aria-hidden />
      </button>
      <p className="text-sm font-bold text-slate-900 mr-2 whitespace-nowrap" aria-live="polite">
        {props.countLabel ?? t('ui.selectedCount', { count: props.count })}
      </p>
      <SelectAllLink offer={props.selectAll} />
      <div className="flex-1" />
      {props.extra}
      {inBar.map((a) => <ActionButton key={a.id} a={a} />)}
      {inMore.length > 0 && <OverflowMenu items={inMore.map(toMenu)} testId={props.moreTestId} menuTestId={props.moreMenuTestId} />}
      {danger.map((a) => <div key={a.id} className="ml-1"><ActionButton a={a} /></div>)}
      {primary.map((a) => <div key={a.id} className="ml-2"><ActionButton a={a} /></div>)}
    </div>
  );
}

/** Phone width: full-width, thumb-reachable bar on top of the tab bar. */
export function ActionDock(props: SelectionBarProps) {
  const t = useTranslations();
  const shown = props.count > 0;
  const setDockShown = useUIStore((s) => s.setSelectionDockShown);
  const { quiet, danger, primary } = split(props.actions);
  // Sit exactly on top of the mobile tab bar: its top edge is measured, not
  // guessed. Re-measured only on resize.
  const [tabBarH, setTabBarH] = useState<number | null>(null);
  useEffect(() => {
    if (!shown) return;
    const measure = () => {
      let top = window.innerHeight;
      document.querySelectorAll('nav[aria-label="Primary"]').forEach((nav) => {
        const r = nav.getBoundingClientRect();
        if (r.height > 0 && r.bottom >= window.innerHeight - 1) top = Math.min(top, r.top);
      });
      setTabBarH(Math.max(0, Math.round(window.innerHeight - top)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [shown]);
  // The bug-report FAB floats where the primary button sits — it yields.
  useEffect(() => {
    setDockShown?.(shown);
    return () => setDockShown?.(false);
  }, [shown, setDockShown]);
  if (!shown || typeof document === 'undefined') return null;
  // Portal to <body>: an ancestor in the dashboard shell creates a containing
  // block for `position: fixed`, which lifted the bar 20px off the tab bar.
  return createPortal(
    <div
      role="region"
      aria-label={props.ariaLabel ?? t('ui.selectionActions')}
      data-testid={props.testId}
      data-placement="dock"
      style={tabBarH != null ? { bottom: tabBarH } : undefined}
      className="md:hidden fixed left-0 right-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-[59] bg-white border-t border-slate-200 shadow-[0_-6px_20px_rgba(15,23,42,0.08)] animate-in slide-in-from-bottom duration-200 will-change-transform"
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button type="button" onClick={props.onClear} aria-label={t('ui.clearSelection')} className={OVERFLOW_ICON_BUTTON}>
          <X className="w-5 h-5" aria-hidden />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 truncate leading-tight" aria-live="polite">
            {props.countLabel ?? t('ui.selectedCount', { count: props.count })}
          </p>
          {props.selectAll && <div className="-ml-1 -my-2"><SelectAllLink offer={props.selectAll} /></div>}
        </div>
        {quiet.length > 0 && <OverflowMenu items={quiet.map(toMenu)} testId={props.moreTestId} menuTestId={props.moreMenuTestId} />}
        {danger.map((a) => <ActionButton key={a.id} a={a} iconOnly />)}
        {primary.map((a) => <div key={a.id} className="ml-1"><ActionButton a={a} /></div>)}
      </div>
    </div>,
    document.body,
  );
}
