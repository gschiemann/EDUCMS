"use client";

/**
 * Media Library selection actions (2026-11-02, owner-approved redesign) —
 * "one primary action per context".
 *
 *   - ONE filled action: Create playlist.
 *   - Quiet secondaries (no pill outline): Move, Download. On a phone they sit
 *     in the "⋯" menu, because the bar has room for few buttons.
 *   - Delete stays a VISIBLE danger button on both placements (owner,
 *     2026-11-02, and Greg 2026-09-24: "just show delete"). The confirm
 *     dialog behind `onDelete` is the safety, not a menu.
 *   - ✕ clears.
 *
 * Two placements, same actions:
 *   - `AssetSelectionToolbar` — desktop. It REPLACES the filter row in place,
 *     at the same height, so the page never grows; the filters come back when
 *     the selection is cleared.
 *   - `AssetSelectionDock` — phone width. A full-width bar on top of the
 *     mobile tab bar, thumb-reachable (iPhone Photos style).
 *
 * 2026-11-02 (pill cleanup): both are now adapters over the shared
 * `ui/selection-toolbar.tsx` (SelectionToolbar / ActionDock) — same look,
 * same test ids, one implementation for every list page.
 *
 * Both carry `data-testid="asset-bulk-bar"` (only one renders at a time), the
 * contract the selection tests and e2e specs drive.
 * Mobile-perf standard: no blur, no pollers; the dock animates with a
 * transform only.
 */

import { Download, FolderInput, ListPlus, Loader2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ActionDock, SelectionToolbar, type SelectionAction, type SelectionBarProps } from '@/components/ui/selection-toolbar';

export interface AssetSelectionActionsProps {
  count: number;
  selectAllCount?: number | null;
  selectingAll?: boolean;
  selectAllDisabled?: boolean;
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

function useBarProps(props: AssetSelectionActionsProps, phone: boolean): SelectionBarProps {
  const t = useTranslations();
  const title = props.disabled ? props.disabledReason : undefined;
  const downloadLabel = props.count > 1 ? t('assetsLib.downloadZip') : t('assetsLib.download');
  const actions: SelectionAction[] = [
    {
      id: 'move', label: t('assetsLibV2.move'), ariaLabel: t('assetsLibV2.moveToFolder'),
      icon: <FolderInput className="w-3.5 h-3.5" aria-hidden />, onSelect: props.onMoveToFolder, disabled: props.disabled, title,
    },
    {
      id: 'download',
      label: props.downloadPending ? t('assetsLib.preparingZip') : downloadLabel,
      menuLabel: downloadLabel,
      icon: props.downloadPending && !phone ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Download className="w-3.5 h-3.5" aria-hidden />,
      onSelect: props.onDownload, busy: props.downloadPending, disabled: props.downloadPending,
    },
    {
      id: 'delete', variant: 'danger', label: t('assetsLib.delete'),
      icon: <Trash2 className={phone ? 'w-4 h-4' : 'w-3.5 h-3.5'} aria-hidden />, onSelect: props.onDelete,
      disabled: props.deleteDisabled, title: props.deleteDisabled ? props.deleteDisabledReason : undefined,
    },
    {
      id: 'create-playlist', variant: 'primary', label: t('assetsLibV2.createPlaylist'),
      icon: <ListPlus className={phone ? 'w-4 h-4' : 'w-3.5 h-3.5'} aria-hidden />, onSelect: props.onCreatePlaylist, disabled: props.disabled, title,
    },
  ];
  return {
    count: props.count,
    countLabel: t('assetsLibV2.selectedCount', { count: props.count }),
    onClear: props.onClear,
    ariaLabel: t('assetsLibV2.selectionActions'),
    testId: 'asset-bulk-bar',
    moreTestId: 'selection-more',
    moreMenuTestId: 'selection-more-menu',
    selectAll: props.onSelectAll && props.selectAllCount != null ? {
      label: props.selectingAll ? t('assetsLib.selecting') : t('playlistsPage.bulkSelectAll', { count: props.selectAllCount }),
      onSelect: props.onSelectAll,
      busy: props.selectingAll,
      disabled: props.selectAllDisabled,
      testId: 'bulk-select-all',
    } : null,
    actions,
  };
}

/** Desktop: the filter row turns into this, in place, at the same height. */
export function AssetSelectionToolbar(props: AssetSelectionActionsProps) {
  return <SelectionToolbar {...useBarProps(props, false)} />;
}

/** Phone width: full-width, thumb-reachable bar on top of the tab bar. */
export function AssetSelectionDock(props: AssetSelectionActionsProps) {
  return <ActionDock {...useBarProps(props, true)} />;
}
