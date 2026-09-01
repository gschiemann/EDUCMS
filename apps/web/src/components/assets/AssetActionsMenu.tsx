"use client";

/**
 * AssetActionsMenu — the per-asset overflow menu (handoff §11).
 *
 * Replaces the always-on red trash button that used to sit in the corner of
 * every tile: "destructive controls are absent from the default cards" is an
 * acceptance-checklist line (§25), and on a phone that permanent trash was
 * one mis-tap from deleting live content.
 *
 * Menu semantics per §21: a real `role="menu"`, arrow-key roving focus,
 * Escape closes and returns focus to the trigger, click-outside dismisses.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Download, Eye, FolderInput, Link as LinkIcon, ListPlus, MoreHorizontal, Trash2 } from 'lucide-react';

export interface AssetMenuAction {
  key: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Rendered at the end, visually separated, in destructive ink. */
  destructive?: boolean;
  title?: string;
}

export function buildAssetMenuActions(opts: {
  onViewDetails: () => void;
  onCreatePlaylist: () => void;
  onMoveToFolder: () => void;
  onDownload: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
  /**
   * The write gate for the CONTRIBUTOR-allowed actions — create-playlist
   * (`POST /playlists`) and move (`PUT /assets/:id/move`) both list
   * CONTRIBUTOR in their `@RequireRoles`, so RESTRICTED_VIEWER is the only
   * role they lock out.
   */
  disabled?: boolean;
  disabledReason?: string;
  /**
   * Separate gate for Delete, because `DELETE /assets/:id` is
   * `@RequireRoles(SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN)` — a
   * CONTRIBUTOR is excluded. Sharing the viewer-only flag above rendered
   * Delete enabled for CONTRIBUTORs, who then got a 403.
   */
  deleteDisabled?: boolean;
  deleteDisabledReason?: string;
}): AssetMenuAction[] {
  const gated = (fn: () => void) => fn;
  const title = opts.disabled ? opts.disabledReason : undefined;
  const deleteTitle = opts.deleteDisabled ? opts.deleteDisabledReason : undefined;
  return [
    { key: 'details', label: 'View details', icon: <Eye className="w-3.5 h-3.5" />, onSelect: gated(opts.onViewDetails) },
    {
      key: 'playlist',
      label: 'Create playlist from asset',
      icon: <ListPlus className="w-3.5 h-3.5" />,
      onSelect: gated(opts.onCreatePlaylist),
      disabled: opts.disabled,
      title,
    },
    {
      key: 'move',
      label: 'Move to folder',
      icon: <FolderInput className="w-3.5 h-3.5" />,
      onSelect: gated(opts.onMoveToFolder),
      disabled: opts.disabled,
      title,
    },
    { key: 'download', label: 'Download', icon: <Download className="w-3.5 h-3.5" />, onSelect: gated(opts.onDownload) },
    { key: 'copy', label: 'Copy asset link', icon: <LinkIcon className="w-3.5 h-3.5" />, onSelect: gated(opts.onCopyLink) },
    {
      key: 'delete',
      label: 'Delete…',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      onSelect: gated(opts.onDelete),
      disabled: opts.deleteDisabled,
      destructive: true,
      title: deleteTitle,
    },
  ];
}

export function AssetActionsMenu({
  assetName,
  actions,
  align = 'right',
  className,
}: {
  assetName: string;
  actions: AssetMenuAction[];
  align?: 'left' | 'right';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocPointer);
    return () => document.removeEventListener('mousedown', onDocPointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    first?.focus();
  }, [open]);

  const items = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') || []);

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const list = items();
    if (list.length === 0) return;
    const idx = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Home') list[0].focus();
    else if (e.key === 'End') list[list.length - 1].focus();
    else if (e.key === 'ArrowDown') list[(idx + 1 + list.length) % list.length].focus();
    else list[(idx - 1 + list.length) % list.length].focus();
  };

  const safe = actions.filter((a) => !a.destructive);
  const destructive = actions.filter((a) => a.destructive);

  const renderItem = (a: AssetMenuAction) => (
    <button
      key={a.key}
      type="button"
      role="menuitem"
      disabled={a.disabled}
      title={a.title}
      onClick={() => {
        setOpen(false);
        a.onSelect();
      }}
      className={`w-full px-3 py-2 min-h-11 sm:min-h-0 text-left text-xs font-medium flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:bg-slate-100 ${
        a.destructive ? 'text-rose-700 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-50'
      }`}
    >
      {a.icon}
      {a.label}
    </button>
  );

  return (
    <div ref={rootRef} className={`relative ${className || ''}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${assetName}`}
        title="More actions"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="w-11 h-11 sm:w-7 sm:h-7 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          aria-label={`Actions for ${assetName}`}
          onKeyDown={onMenuKeyDown}
          onClick={(e) => e.stopPropagation()}
          className={`absolute z-30 top-full mt-1 ${
            align === 'right' ? 'right-0' : 'left-0'
          } min-w-[220px] bg-white border border-slate-200 rounded-xl shadow-xl py-1`}
        >
          {safe.map(renderItem)}
          {destructive.length > 0 && <div className="my-1 h-px bg-slate-100" role="separator" />}
          {destructive.map(renderItem)}
        </div>
      )}
    </div>
  );
}
