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
 * Destructive stays behind "More" (§13) and mobile sticks the bar above the
 * tab bar (§19) with 44px targets.
 */

import { useEffect, useRef, useState } from 'react';
import { Download, FolderInput, ListPlus, MoreHorizontal, Trash2, X } from 'lucide-react';

export function AssetBulkBar({
  count,
  disabled,
  disabledReason,
  deleteDisabled,
  deleteDisabledReason,
  onCreatePlaylist,
  onMoveToFolder,
  onDownload,
  onDelete,
  onClear,
}: {
  count: number;
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
  onCreatePlaylist: () => void;
  onMoveToFolder: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [moreOpen]);

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
        className="min-h-11 sm:min-h-0 px-3 py-2 rounded-lg bg-white border border-indigo-200 hover:bg-indigo-100 text-indigo-800 text-xs font-bold flex items-center gap-1.5"
      >
        <Download className="w-3.5 h-3.5" /> Download
      </button>

      <div ref={moreRef} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
          className="min-h-11 sm:min-h-0 px-3 py-2 rounded-lg bg-white border border-indigo-200 hover:bg-indigo-100 text-indigo-800 text-xs font-bold flex items-center gap-1.5"
        >
          <MoreHorizontal className="w-3.5 h-3.5" /> More
        </button>
        {moreOpen && (
          <div
            role="menu"
            tabIndex={-1}
            aria-label="More selection actions"
            onKeyDown={(e) => {
              if (e.key === 'Escape') setMoreOpen(false);
            }}
            className="absolute z-30 top-full mt-1 left-0 min-w-[200px] bg-white border border-slate-200 rounded-xl shadow-xl py-1"
          >
            <button
              type="button"
              role="menuitem"
              disabled={deleteDisabled}
              title={deleteTitle}
              onClick={() => {
                setMoreOpen(false);
                onDelete();
              }}
              className="w-full px-3 py-2 min-h-11 sm:min-h-0 text-left text-xs font-medium text-rose-700 hover:bg-rose-50 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete…
            </button>
          </div>
        )}
      </div>

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
