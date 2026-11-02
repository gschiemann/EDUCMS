"use client";

/**
 * Media Library DESIGN MOCK-UP (`?design=v2`, 2026-11-02) — the selection
 * actions under the "one primary action per context" rule.
 *
 *   - ONE filled action: Create playlist.
 *   - Quiet secondaries (no pill outline): Move, Download — desktop only.
 *   - Rare / destructive actions in "⋯": Delete (plus Move / Download on a
 *     phone, where the bar has room for one button and the menu).
 *   - ✕ clears.
 *
 * Two placements, same actions (owner, option B for the web app):
 *   - `AssetSelectionToolbar` — desktop. It REPLACES the filter row in place,
 *     at the same height, so the page never grows; the filters come back when
 *     the selection is cleared.
 *   - `AssetSelectionDock` — phone width. A full-width bar fixed above the
 *     mobile tab bar, thumb-reachable (iPhone Photos style).
 *
 * Production keeps `AssetBulkBar` until the owner approves this design.
 * Mobile-perf standard: no blur, no pollers; the dock animates with a
 * transform only.
 */

import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Download, FolderInput, ListPlus, Loader2, MoreHorizontal, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { AnchoredMenu } from '@/components/ui/anchored-menu';
import { useUIStore } from '@/store/ui-store';

export interface AssetSelectionActionsProps {
  count: number;
  selectAllCount?: number | null;
  selectingAll?: boolean;
  onSelectAll?: () => void;
  /** Viewer gate for Create playlist / Move. */
  disabled?: boolean;
  disabledReason?: string;
  /** Admin-only gate for Delete. */
  deleteDisabled?: boolean;
  deleteDisabledReason?: string;
  downloadPending?: boolean;
  onCreatePlaylist: () => void;
  onMoveToFolder: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onClear: () => void;
}

const QUIET =
  'min-h-11 sm:min-h-0 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const PRIMARY =
  'min-h-11 sm:min-h-0 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const ICON =
  'min-w-11 min-h-11 sm:min-w-9 sm:min-h-9 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors';
const MENU_ITEM =
  'w-full px-3 py-2 min-h-11 sm:min-h-0 text-left text-xs font-medium flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed';

function MoreMenu({ props, includeSecondaries }: { props: AssetSelectionActionsProps; includeSecondaries: boolean }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (el?.closest('[data-popover-panel]') || anchor.current?.contains(el as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const run = (fn: () => void) => () => { setOpen(false); fn(); };
  const title = props.disabled ? props.disabledReason : undefined;

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('assetsLibV2.moreActions')}
        title={t('assetsLibV2.moreActions')}
        data-testid="selection-more"
        onClick={() => setOpen((v) => !v)}
        className={ICON}
      >
        <MoreHorizontal className="w-4 h-4" aria-hidden />
      </button>
      <AnchoredMenu anchorRef={anchor} open={open} width={208}>
        <div role="menu" aria-label={t('assetsLibV2.moreActions')} className="py-1" data-testid="selection-more-menu">
          {includeSecondaries && (
            <>
              <button type="button" role="menuitem" disabled={props.disabled} title={title} onClick={run(props.onMoveToFolder)} className={`${MENU_ITEM} text-slate-700 hover:bg-slate-50`}>
                <FolderInput className="w-3.5 h-3.5 text-slate-500" aria-hidden /> {t('assetsLibV2.moveToFolder')}
              </button>
              <button type="button" role="menuitem" disabled={props.downloadPending} onClick={run(props.onDownload)} className={`${MENU_ITEM} text-slate-700 hover:bg-slate-50`}>
                <Download className="w-3.5 h-3.5 text-slate-500" aria-hidden />
                {props.count > 1 ? t('assetsLib.downloadZip') : t('assetsLib.download')}
              </button>
              <div className="my-1 border-t border-slate-100" role="separator" />
            </>
          )}
          <button
            type="button"
            role="menuitem"
            disabled={props.deleteDisabled}
            title={props.deleteDisabled ? props.deleteDisabledReason : undefined}
            onClick={run(props.onDelete)}
            className={`${MENU_ITEM} text-rose-700 hover:bg-rose-50`}
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden /> {t('assetsLib.delete')}
          </button>
        </div>
      </AnchoredMenu>
    </>
  );
}

function SelectAllLink(props: AssetSelectionActionsProps) {
  const t = useTranslations();
  if (!props.onSelectAll || props.selectAllCount == null) return null;
  return (
    <button
      type="button"
      onClick={props.onSelectAll}
      disabled={props.selectingAll}
      aria-busy={props.selectingAll}
      className="min-h-11 sm:min-h-0 px-1 text-xs font-semibold text-indigo-700 hover:text-indigo-900 hover:underline underline-offset-2 disabled:opacity-50 whitespace-nowrap"
    >
      {props.selectingAll ? t('assetsLib.selecting') : t('playlistsPage.bulkSelectAll', { count: props.selectAllCount })}
    </button>
  );
}

/** Desktop: the filter row turns into this, in place, at the same height. */
export function AssetSelectionToolbar(props: AssetSelectionActionsProps) {
  const t = useTranslations();
  const title = props.disabled ? props.disabledReason : undefined;
  return (
    <div
      role="region"
      aria-label={t('assetsLibV2.selectionActions')}
      data-testid="asset-selection-toolbar"
      className="flex items-center gap-1 h-full"
    >
      <button type="button" onClick={props.onClear} aria-label={t('assetsLibV2.clearSelection')} title={t('assetsLibV2.clearSelection')} className={ICON}>
        <X className="w-4 h-4" aria-hidden />
      </button>
      <p className="text-sm font-bold text-slate-900 mr-2" aria-live="polite">
        {t('assetsLibV2.selectedCount', { count: props.count })}
      </p>
      <SelectAllLink {...props} />
      <div className="flex-1" />
      <button type="button" onClick={props.onMoveToFolder} disabled={props.disabled} title={title} className={QUIET}>
        <FolderInput className="w-3.5 h-3.5" aria-hidden /> {t('assetsLibV2.move')}
      </button>
      <button type="button" onClick={props.onDownload} disabled={props.downloadPending} aria-busy={props.downloadPending} className={QUIET}>
        {props.downloadPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Download className="w-3.5 h-3.5" aria-hidden />}
        {props.downloadPending ? t('assetsLib.preparingZip') : t('assetsLib.download')}
      </button>
      <MoreMenu props={props} includeSecondaries={false} />
      <button type="button" onClick={props.onCreatePlaylist} disabled={props.disabled} title={title} className={`${PRIMARY} ml-2`}>
        <ListPlus className="w-3.5 h-3.5" aria-hidden /> {t('assetsLibV2.createPlaylist')}
      </button>
    </div>
  );
}

/** Phone width: full-width, thumb-reachable bar fixed above the tab bar. */
export function AssetSelectionDock(props: AssetSelectionActionsProps) {
  const t = useTranslations();
  const shown = props.count > 0;
  const setDockShown = useUIStore((s) => s.setSelectionDockShown);
  // Sit exactly on top of the mobile tab bar: its height (labels + safe
  // area) is measured, not guessed. Re-measured only on resize.
  const [tabBarH, setTabBarH] = useState<number | null>(null);
  useEffect(() => {
    if (!shown) return;
    const measure = () => {
      // The visible bottom bar's top edge, whichever mobile nav is mounted.
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
    setDockShown(shown);
    return () => setDockShown(false);
  }, [shown, setDockShown]);
  if (!shown || typeof document === 'undefined') return null;
  // Portal to <body>: an ancestor in the dashboard shell creates a containing
  // block for `position: fixed`, which lifted the bar 20px off the tab bar.
  return createPortal(
    <div
      role="region"
      aria-label={t('assetsLibV2.selectionActions')}
      data-testid="asset-selection-dock"
      style={tabBarH != null ? { bottom: tabBarH } : undefined}
      className="md:hidden fixed left-0 right-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-[59] bg-white border-t border-slate-200 shadow-[0_-6px_20px_rgba(15,23,42,0.08)] animate-in slide-in-from-bottom duration-200 will-change-transform"
    >
      <div className="flex items-center px-2 py-1.5">
        <button type="button" onClick={props.onClear} aria-label={t('assetsLibV2.clearSelection')} className={ICON}>
          <X className="w-5 h-5" aria-hidden />
        </button>
        <div className="flex-1 min-w-0 px-1">
          <p className="text-sm font-bold text-slate-900 truncate" aria-live="polite">
            {t('assetsLibV2.selectedCount', { count: props.count })}
          </p>
        </div>
        <MoreMenu props={props} includeSecondaries />
        <button
          type="button"
          onClick={props.onCreatePlaylist}
          disabled={props.disabled}
          title={props.disabled ? props.disabledReason : undefined}
          className={`${PRIMARY} ml-1`}
        >
          <ListPlus className="w-4 h-4" aria-hidden /> {t('assetsLibV2.createPlaylist')}
        </button>
      </div>
    </div>,
    document.body,
  );
}
