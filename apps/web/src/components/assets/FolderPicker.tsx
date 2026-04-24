"use client";

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Folder, FolderOpen, Home, Search, FolderPlus, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface FolderPickerFolder {
  id: string;
  name: string;
  parentId: string | null;
}

interface Props {
  folders: FolderPickerFolder[];
  initialSelectedId?: string | null;
  /** Which folders (by id) to DISABLE — e.g. you can't move a folder into itself or a descendant. */
  disabledIds?: string[];
  /** Shown at the top of the modal — e.g. "Upload 3 files to…" or "Move selection to…". */
  title: string;
  /** Called with the chosen folder id (null = root / All Files). */
  onConfirm: (folderId: string | null) => void;
  onClose: () => void;
  /**
   * Inline folder creation. When provided, the picker shows a "+ New folder"
   * affordance that creates the folder as a child of whatever is currently
   * selected (or at root if nothing is selected), then auto-selects the
   * new folder so the user can confirm their upload/move without a
   * separate trip to the sidebar. Returns the created folder or null on
   * failure.
   */
  onCreateFolder?: (name: string, parentId: string | null) => Promise<{ id: string } | null>;
  /** Optional hint shown under the header — e.g. "3 files ready to upload". */
  subtitle?: string;
}

/**
 * Searchable folder picker. Replaces the old flat dropdown that
 * stopped being usable past ~20 folders — an operator with 100+
 * folders had to scroll a massive list every time.
 *
 * - Fuzzy substring search across folder names AND their full path
 *   (so "High School > Lobby > Hallway" still matches 'lobby').
 * - Tree rendering with indentation + expand/collapse so the
 *   hierarchy is obvious.
 * - Keyboard: Esc closes, Enter confirms current selection.
 * - 'All Files (root)' is always the first option so pinning an
 *   upload to root is one click.
 *
 * Used by:
 *   - Asset upload flow (choose destination before file picker fires)
 *   - Bulk move selection (replaces the flat dropdown in the toolbar)
 *   - Move single asset (detail panel)
 */
export function FolderPicker({
  folders,
  initialSelectedId = null,
  disabledIds = [],
  title,
  onConfirm,
  onClose,
  onCreateFolder,
  subtitle,
}: Props) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Auto-expand the path to the initial selection so the user sees
    // where they are when the modal opens.
    const s = new Set<string>();
    if (initialSelectedId) {
      let cursor: string | null = initialSelectedId;
      const byId = new Map(folders.map(f => [f.id, f] as const));
      while (cursor) {
        s.add(cursor);
        const f = byId.get(cursor);
        cursor = f?.parentId ?? null;
      }
    }
    return s;
  });

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Build an id→folder map and a full-path string for search matching.
  const { byId, pathById, rootIds } = useMemo(() => {
    const byId = new Map<string, FolderPickerFolder>();
    for (const f of folders) byId.set(f.id, f);
    const pathById = new Map<string, string>();
    const rootIds: string[] = [];
    for (const f of folders) {
      const segments: string[] = [f.name];
      let cursor: string | null = f.parentId;
      // Bound the walk at 20 levels — tree is tenant-created so
      // cycles shouldn't exist, but guard anyway.
      let steps = 0;
      while (cursor && steps < 20) {
        const parent = byId.get(cursor);
        if (!parent) break;
        segments.unshift(parent.name);
        cursor = parent.parentId;
        steps += 1;
      }
      pathById.set(f.id, segments.join(' > '));
      if (f.parentId === null) rootIds.push(f.id);
    }
    return { byId, pathById, rootIds };
  }, [folders]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null; // no filter
    const hits = new Set<string>();
    for (const f of folders) {
      const path = pathById.get(f.id) || f.name;
      if (path.toLowerCase().includes(q)) hits.add(f.id);
    }
    // When filtering, also mark ancestors so the tree preserves
    // hierarchy context.
    const withAncestors = new Set(hits);
    for (const id of hits) {
      let cursor: string | null = byId.get(id)?.parentId ?? null;
      while (cursor) {
        withAncestors.add(cursor);
        cursor = byId.get(cursor)?.parentId ?? null;
      }
    }
    return withAncestors;
  }, [query, folders, byId, pathById]);

  // Auto-expand everything when searching so matches are visible.
  const effectiveExpanded = useMemo(() => {
    if (!matches) return expanded;
    const s = new Set(expanded);
    for (const id of matches) s.add(id);
    return s;
  }, [expanded, matches]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };

  const renderRow = (id: string, depth: number) => {
    const f = byId.get(id);
    if (!f) return null;
    if (matches && !matches.has(id)) return null;
    const children = folders
      .filter((c) => c.parentId === id)
      .sort((a, b) => a.name.localeCompare(b.name));
    const isExpanded = effectiveExpanded.has(id);
    const isSelected = selectedId === id;
    const isDisabled = disabledIds.includes(id);
    const hasChildren = children.length > 0;
    return (
      <div key={id}>
        <div
          role="button"
          tabIndex={isDisabled ? -1 : 0}
          aria-disabled={isDisabled}
          onClick={() => {
            if (isDisabled) return;
            setSelectedId(id);
            if (hasChildren) toggleExpand(id);
          }}
          onKeyDown={(e) => {
            if (isDisabled) return;
            if (e.key === 'Enter') { e.preventDefault(); onConfirm(id); }
            if (e.key === ' ')      { e.preventDefault(); setSelectedId(id); if (hasChildren) toggleExpand(id); }
            if (e.key === 'ArrowRight' && hasChildren && !isExpanded) { e.preventDefault(); toggleExpand(id); }
            if (e.key === 'ArrowLeft'  && hasChildren &&  isExpanded) { e.preventDefault(); toggleExpand(id); }
          }}
          onDoubleClick={() => {
            if (!isDisabled) onConfirm(id);
          }}
          className={cn(
            'flex items-center gap-2 py-1.5 pr-2 rounded-lg cursor-pointer transition-colors',
            isDisabled && 'opacity-40 cursor-not-allowed',
            !isDisabled && isSelected && 'bg-indigo-100 text-indigo-900',
            !isDisabled && !isSelected && 'hover:bg-slate-100',
          )}
          style={{ paddingLeft: `${12 + depth * 18}px` }}
        >
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleExpand(id); }}
              className="text-slate-500 hover:text-slate-800 text-xs w-4 h-4 flex items-center justify-center rounded hover:bg-slate-200"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
              tabIndex={-1}
            >
              {isExpanded ? '▾' : '▸'}
            </button>
          ) : <div className="w-4" />}
          {isExpanded && hasChildren ? (
            <FolderOpen className="w-4 h-4 text-indigo-500 shrink-0" />
          ) : (
            <Folder className="w-4 h-4 text-indigo-500 shrink-0" />
          )}
          <span className="text-sm truncate flex-1">{f.name}</span>
          {isDisabled && <span className="text-[10px] text-slate-400">can’t select</span>}
        </div>
        {isExpanded && children.map((c) => renderRow(c.id, depth + 1))}
      </div>
    );
  };

  const rootsSorted = useMemo(
    () => rootIds
      .map((id) => byId.get(id))
      .filter((f): f is FolderPickerFolder => !!f)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [rootIds, byId],
  );

  return (
    <div className="fixed inset-0 z-[9999] p-4">
      {/* Click-away dismiss as a real <button> so jsx-a11y is happy +
          screen readers skip it. Esc closes via the top-level keyDown
          listener installed in useEffect. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm cursor-default"
        tabIndex={-1}
      />
      <div className="relative h-full w-full flex items-center justify-center pointer-events-none">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="pointer-events-auto bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 flex flex-col max-h-[85vh]"
        >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-slate-800 truncate">{title}</h2>
            {subtitle && <p className="text-[11px] text-slate-500 mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded shrink-0" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 border-b border-slate-100 space-y-2">
          <div className="flex gap-2 items-center">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-slate-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${folders.length} folder${folders.length === 1 ? '' : 's'}…`}
                className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            {onCreateFolder && !creating && (
              <button
                type="button"
                onClick={() => { setCreating(true); setNewFolderName(''); setCreateError(null); }}
                className="shrink-0 px-2.5 py-2 bg-white border border-slate-200 hover:border-indigo-300 text-slate-700 text-[11px] font-bold rounded-lg flex items-center gap-1.5 transition-colors"
                title="Create a new folder as a child of the selected folder"
              >
                <FolderPlus className="w-3.5 h-3.5 text-indigo-500" />
                New folder
              </button>
            )}
          </div>
          {creating && onCreateFolder && (
            // Inline folder creation. Parent = currently selected folder
            // (null = root). This lets the operator create + land in a
            // fresh folder without bouncing out to the sidebar. Enter
            // saves, Escape cancels.
            <div className="flex flex-col gap-1 rounded-lg border border-indigo-200 bg-indigo-50/40 p-2">
              <div className="flex gap-2 items-center">
                <FolderPlus className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={(e) => { setNewFolderName(e.target.value); if (createError) setCreateError(null); }}
                  placeholder={`New folder in ${selectedId ? (pathById.get(selectedId) || byId.get(selectedId)?.name || '?') : 'All Files'}`}
                  className="flex-1 px-2 py-1 bg-white border border-slate-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const name = newFolderName.trim();
                      if (!name || isSaving) return;
                      setIsSaving(true);
                      setCreateError(null);
                      try {
                        const created = await onCreateFolder(name, selectedId);
                        if (created?.id) {
                          setSelectedId(created.id);
                          setCreating(false);
                          setNewFolderName('');
                          // Expand the parent so the new folder is visible
                          // in the tree once the parent refreshes.
                          setExpanded((prev) => {
                            const s = new Set(prev);
                            if (selectedId) s.add(selectedId);
                            s.add(created.id);
                            return s;
                          });
                        } else {
                          setCreateError('Could not create folder.');
                        }
                      } catch (err: any) {
                        setCreateError(err?.message || 'Could not create folder.');
                      } finally {
                        setIsSaving(false);
                      }
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setCreating(false);
                      setNewFolderName('');
                      setCreateError(null);
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={!newFolderName.trim() || isSaving}
                  onClick={async () => {
                    const name = newFolderName.trim();
                    if (!name || isSaving) return;
                    setIsSaving(true);
                    setCreateError(null);
                    try {
                      const created = await onCreateFolder(name, selectedId);
                      if (created?.id) {
                        setSelectedId(created.id);
                        setCreating(false);
                        setNewFolderName('');
                        setExpanded((prev) => {
                          const s = new Set(prev);
                          if (selectedId) s.add(selectedId);
                          s.add(created.id);
                          return s;
                        });
                      } else {
                        setCreateError('Could not create folder.');
                      }
                    } catch (err: any) {
                      setCreateError(err?.message || 'Could not create folder.');
                    } finally {
                      setIsSaving(false);
                    }
                  }}
                  className="shrink-0 px-2 py-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[11px] font-bold rounded flex items-center gap-1"
                  aria-label="Create folder"
                >
                  <Check className="w-3 h-3" />
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => { setCreating(false); setNewFolderName(''); setCreateError(null); }}
                  className="shrink-0 p-1 text-slate-400 hover:text-slate-700"
                  aria-label="Cancel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {createError && <p className="text-[10px] text-red-600 ml-6">{createError}</p>}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {/* Root option — always visible, always first */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => setSelectedId(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); onConfirm(null); }
              if (e.key === ' ')     { e.preventDefault(); setSelectedId(null); }
            }}
            onDoubleClick={() => onConfirm(null)}
            className={cn(
              'flex items-center gap-2 py-1.5 px-3 rounded-lg cursor-pointer',
              selectedId === null
                ? 'bg-indigo-100 text-indigo-900'
                : 'hover:bg-slate-100',
            )}
          >
            <div className="w-4" />
            <Home className="w-4 h-4 text-slate-600 shrink-0" />
            <span className="text-sm font-medium flex-1">All Files (root)</span>
          </div>

          {rootsSorted.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-400">
              No folders yet. Close and create one in the sidebar.
            </div>
          ) : (
            rootsSorted.map((f) => renderRow(f.id, 0))
          )}

          {query && !rootsSorted.some((f) => renderRow(f.id, 0)) && matches && matches.size === 0 && (
            <div className="p-4 text-center text-xs text-slate-400">
              No folders match “{query}”.
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">
            {selectedId === null
              ? 'Selected: All Files (root)'
              : `Selected: ${pathById.get(selectedId) || byId.get(selectedId)?.name || '?'}`}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(selectedId)}
              className="px-4 py-1.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg"
            >
              Choose folder
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
