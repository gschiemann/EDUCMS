"use client";

/**
 * AssetBulkBar — the contextual selection bar (handoff §13).
 *
 * The rule this enforces: "Do not add actions to the page header." Bulk
 * Create-playlist / Move / Delete used to appear as three extra header
 * buttons the moment anything was selected, which is how a five-button
 * header became an eight-button header on the operator's laptop and wrapped
 * off-screen on their phone. Selection context belongs next to the files.
 *
 * Delete is a direct button (2026-09-24). It sat alone behind a "More" menu —
 * Greg: "why hide delete under more when thats the only option...just show
 * delete". A one-item menu is a click for nothing; the confirm dialog behind
 * `onDelete` is the safety, not the menu. Mobile sticks the bar above the tab
 * bar (§19) with 44px targets.
 */

import { Download, FolderInput, ListPlus, Loader2, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function AssetBulkBar({
  count,
  selectAllCount,
  selectingAll,
  selectAllDisabled,
  onSelectAll,
  disabled,
  disabledReason,
  deleteDisabled,
  deleteDisabledReason,
  downloadPending,
  onCreatePlaylist,
  onMoveToFolder,
  onDownload,
  onDelete,
  onClear,
}: {
  count: number;
  /**
   * "Select all N" — the only place that phrase lives (2026-10-04: the
   * stand-alone toolbar button is gone; the box above the list selects what is
   * shown, this reaches every matching file, loaded or not). Null / undefined
   * when there is nothing more to offer.
   */
  selectAllCount?: number | null;
  /** The select-everything request is on its way: the link reads "Selecting…" and stands down. */
  selectingAll?: boolean;
  selectAllDisabled?: boolean;
  onSelectAll?: () => void;
  /**
   * Gate for the CONTRIBUTOR-allowed actions — `POST /playlists` and
   * `PUT /assets/:id/move` both list CONTRIBUTOR, so this is viewer-only.
   */
  disabled?: boolean;
  disabledReason?: string;
  /**
   * Separate gate for Delete: `DELETE /assets/:id` is
   * `@RequireRoles(SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN)`, so a
   * CONTRIBUTOR is excluded and must not see it enabled.
   */
  deleteDisabled?: boolean;
  deleteDisabledReason?: string;
  downloadPending?: boolean;
  onCreatePlaylist: () => void;
  onMoveToFolder: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const t = useTranslations();
  if (count <= 0) return null;
  const title = disabled ? disabledReason : undefined;
  const deleteTitle = deleteDisabled ? deleteDisabledReason : undefined;

  return (
    <div
      role="region"
      aria-label="Selection actions"
      data-testid="asset-bulk-bar"
      className="sticky top-2 z-30 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 shadow-sm"
    >
      <p className="text-xs font-bold text-indigo-900 mr-1" aria-live="polite">
        {count} {count === 1 ? 'asset' : 'assets'} selected
      </p>

      {/* The same link, wording and place as the Playlists bar. */}
      {onSelectAll && selectAllCount != null && (
        <button
          type="button"
          onClick={onSelectAll}
          disabled={selectingAll || selectAllDisabled}
          aria-busy={selectingAll}
          data-testid="bulk-select-all"
          className="min-h-11 sm:min-h-0 px-1 mr-1 text-xs font-bold underline underline-offset-2 text-indigo-700 hover:text-indigo-900 disabled:opacity-50 disabled:cursor-wait"
        >
          {selectingAll ? t('assetsLib.selecting') : t('playlistsPage.bulkSelectAll', { count: selectAllCount })}
        </button>
      )}

      <button
        type="button"
        onClick={onCreatePlaylist}
        disabled={disabled}
        title={title}
        className="min-h-11 sm:min-h-0 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <ListPlus className="w-3.5 h-3.5" /> Create playlist
      </button>
      <button
        type="button"
        onClick={onMoveToFolder}
        disabled={disabled}
        title={title}
        className="min-h-11 sm:min-h-0 px-3 py-2 rounded-lg bg-white border border-indigo-200 hover:bg-indigo-100 text-indigo-800 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <FolderInput className="w-3.5 h-3.5" /> Move to folder
      </button>
      <button
        type="button"
        onClick={onDownload}
        disabled={downloadPending}
        aria-busy={downloadPending}
        className="min-h-11 sm:min-h-0 px-3 py-2 rounded-lg bg-white border border-indigo-200 hover:bg-indigo-100 text-indigo-800 text-xs font-bold flex items-center gap-1.5"
      >
        {downloadPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Download className="w-3.5 h-3.5" aria-hidden />}
        {downloadPending ? t('assetsLib.preparingZip') : count > 1 ? t('assetsLib.downloadZip') : t('assetsLib.download')}
      </button>

      <button
        type="button"
        disabled={deleteDisabled}
        title={deleteTitle}
        onClick={onDelete}
        className="min-h-11 sm:min-h-0 px-3 py-2 rounded-lg bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 text-xs font-bold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Trash2 className="w-3.5 h-3.5" /> {t('assetsLib.delete')}
      </button>

      <button
        type="button"
        onClick={onClear}
        className="min-h-11 sm:min-h-0 ml-auto px-3 py-2 rounded-lg text-indigo-800 hover:bg-indigo-100 text-xs font-bold flex items-center gap-1.5"
      >
        <X className="w-3.5 h-3.5" /> Clear selection
      </button>
    </div>
  );
}
