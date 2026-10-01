"use client";

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import { useOverlayLock } from '@/hooks/use-overlay-lock';

type Summary = { name: string; assetIds: string[]; folders: number };

export function FolderDeleteDialog({ folder, onCancel, onConfirm }: {
  folder: { id: string; name: string };
  onCancel: () => void;
  onConfirm: (assetIds: string[] | null) => void;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState(false);
  const [contents, setContents] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const close = useRef(onCancel);
  useEffect(() => { close.current = onCancel; }, [onCancel]);
  useOverlayLock(true);
  useEffect(() => {
    let live = true;
    const opener = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    apiFetch<Summary>(`/assets/folders/${encodeURIComponent(folder.id)}/deletion-summary`)
      .then(value => { if (live) setSummary(value); })
      .catch(() => { if (live) setError(true); });
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled])') || []);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keyboard);
    return () => { live = false; document.removeEventListener('keydown', keyboard); if (opener?.isConnected) opener.focus(); };
  }, [folder.id]);
  return <div className="fixed top-0 right-0 bottom-0 left-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4">
    <div ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby="folder-delete-title" aria-describedby="folder-delete-description" className="w-full max-w-lg rounded-2xl border border-rose-200 bg-white p-6 shadow-xl">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-1 h-5 w-5 shrink-0 text-rose-600" aria-hidden />
        <h2 id="folder-delete-title" className="min-w-0 flex-1 text-lg font-bold text-slate-900">Delete “{folder.name}”?</h2>
        <button onClick={onCancel} aria-label="Close" className="p-1 text-slate-400"><X className="h-5 w-5" /></button>
      </div>
      <p id="folder-delete-description" className="mt-4 text-sm text-slate-600">Choose what happens to the files. Deleted files cannot be restored.</p>
      <label htmlFor="folder-delete-contents" aria-label="Also delete all files and subfolders" className="mt-4 flex items-start gap-3 rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
        <input id="folder-delete-contents" type="checkbox" checked={contents} onChange={event => setContents(event.target.checked)} disabled={!summary} className="mt-1 h-4 w-4 shrink-0" />
        <span><span className="block font-semibold">Also delete all files and subfolders</span>
          <span className="mt-1 block text-xs text-slate-500">{summary ? `${summary.assetIds.length} files · ${Math.max(0, summary.folders - 1)} ${summary.folders === 2 ? "subfolder" : "subfolders"}` : error ? 'Could not check the contents. Close and try again to delete files.' : 'Checking folder contents…'}</span>
        </span>
      </label>
      <p className="mt-3 text-sm text-slate-600">{contents ? 'Files used in playlists are removed from those playlists. Empty playlists stop playing. Protected emergency files are kept, along with their folder.' : 'Files are kept in All files. Subfolders move up one level.'}</p>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button ref={cancel} onClick={onCancel} className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-700">Cancel</button>
        <button onClick={() => onConfirm(contents ? summary!.assetIds : null)} disabled={contents && !summary} className="rounded-xl bg-rose-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{contents ? 'Delete folder and contents' : 'Delete folder, keep files'}</button>
      </div>
    </div>
  </div>;
}
