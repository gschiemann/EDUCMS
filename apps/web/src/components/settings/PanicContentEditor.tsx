"use client";

import { useState, useRef } from 'react';
import { Loader2, Trash2, Upload, Image as ImageIcon, Video, Music, AlertTriangle, ShieldCheck } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { useQueryClient } from '@tanstack/react-query';
import { usePanicContent, useAddPanicAsset, useRemovePanicAsset, type PanicKind } from '@/hooks/use-api';
import { appConfirm } from '@/components/ui/app-dialog';

const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1').replace('/api/v1', '');

type Props = {
  kind: PanicKind;
  label: string;
  /** Tailwind color name for the dot + accents (matches the existing card scheme). */
  accent: 'red' | 'amber' | 'orange' | 'slate';
};

const ACCENT_MAP = {
  red:    { dot: 'bg-red-500',    border: 'border-red-200',    bg: 'bg-red-50/40',    chip: 'text-red-700' },
  amber:  { dot: 'bg-amber-500',  border: 'border-amber-200',  bg: 'bg-amber-50/40',  chip: 'text-amber-700' },
  orange: { dot: 'bg-orange-500', border: 'border-orange-200', bg: 'bg-orange-50/40', chip: 'text-orange-700' },
  slate:  { dot: 'bg-slate-500',  border: 'border-slate-200',  bg: 'bg-slate-50',     chip: 'text-slate-700' },
};

const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Direct asset uploader for one panic content bucket. Bypasses the
 * regular /playlists surface so emergency content can never be
 * accidentally deleted from the playlists list. Operators just see
 * "drop assets here" and a list of what's currently set.
 */
export function PanicContentEditor({ kind, label, accent }: Props) {
  const a = ACCENT_MAP[accent];
  const { data, isLoading } = usePanicContent(kind);
  const addAsset = useAddPanicAsset(kind);
  const removeAsset = useRemovePanicAsset(kind);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploads, setUploads] = useState<Array<{ id: string; name: string; progress: number; phase: 'uploading' | 'error'; error?: string }>>([]);

  const items = data?.items ?? [];

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
    const token = useUIStore.getState().token;
    const genId = () => { try { return crypto.randomUUID(); } catch { return Math.random().toString(36).substring(2, 10); } };

    Array.from(files).forEach(file => {
      const id = genId();
      if (file.size > MAX_FILE_SIZE) {
        setUploads(prev => [{ id, name: file.name, progress: 0, phase: 'error', error: `Too large (${Math.round(file.size / (1024 * 1024))}MB > 50MB cap)` }, ...prev]);
        return;
      }
      setUploads(prev => [{ id, name: file.name, progress: 0, phase: 'uploading' }, ...prev]);
      const fd = new FormData();
      fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = e => {
        if (!e.lengthComputable) return;
        setUploads(prev => prev.map(u => (u.id === id ? { ...u, progress: Math.round((e.loaded * 100) / e.total) } : u)));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // Asset uploaded → bind it to this panic bucket → drop the upload row.
          try {
            const resp = JSON.parse(xhr.responseText);
            if (resp?.id) {
              addAsset.mutate({ assetId: resp.id }, {
                onSuccess: () => {
                  setUploads(prev => prev.filter(u => u.id !== id));
                  queryClient.invalidateQueries({ queryKey: ['assets'] });
                },
                onError: () => {
                  setUploads(prev => prev.map(u => (u.id === id ? { ...u, phase: 'error', error: 'Uploaded but could not bind — try again' } : u)));
                },
              });
            }
          } catch {
            setUploads(prev => prev.map(u => (u.id === id ? { ...u, phase: 'error', error: 'Server returned invalid response' } : u)));
          }
        } else {
          let msg = `Upload failed (${xhr.status})`;
          try { const r = JSON.parse(xhr.responseText); msg = r.message || msg; } catch {}
          setUploads(prev => prev.map(u => (u.id === id ? { ...u, phase: 'error', error: msg } : u)));
        }
      };
      xhr.onerror = () => {
        setUploads(prev => prev.map(u => (u.id === id ? { ...u, phase: 'error', error: 'Network error' } : u)));
      };
      xhr.open('POST', `${apiUrl}/assets/upload`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(fd);
    });
  };

  const handleRemove = async (item: typeof items[number]) => {
    const ok = await appConfirm({
      title: `Remove from ${label}?`,
      message: `Remove "${item.asset.originalName || 'this asset'}" from ${label} content? The asset itself stays in your library.`,
      tone: 'danger',
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    removeAsset.mutate(item.id);
  };

  return (
    <div className={`p-4 rounded-xl border ${a.border} ${a.bg} flex flex-col gap-3 min-h-[180px]`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${a.dot}`} />
          <h3 className="text-sm font-bold text-slate-800">{label}</h3>
        </div>
        <span className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${items.length > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
          {items.length > 0 ? <ShieldCheck className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
          {items.length > 0 ? `${items.length} asset${items.length === 1 ? '' : 's'}` : 'No content'}
        </span>
      </div>

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-lg px-3 py-4 text-center transition-colors cursor-pointer ${
          dragOver
            ? 'border-indigo-400 bg-indigo-50'
            : 'border-slate-300 bg-white/70 hover:border-indigo-300 hover:bg-white'
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
        }}
      >
        <Upload className="w-4 h-4 text-slate-400 inline mr-1.5 -mt-0.5" />
        <span className="text-xs font-bold text-slate-600">Drop files or click to upload</span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { handleFiles(e.target.files); if (fileInputRef.current) fileInputRef.current.value = ''; }}
        />
      </div>

      {/* In-flight uploads */}
      {uploads.length > 0 && (
        <div className="space-y-1">
          {uploads.map(u => (
            <div key={u.id} className="bg-white rounded-md border border-slate-200 px-2.5 py-1.5 flex items-center gap-2 text-[11px]">
              {u.phase === 'uploading' && <Loader2 className="w-3 h-3 text-indigo-500 animate-spin shrink-0" />}
              {u.phase === 'error' && <AlertTriangle className="w-3 h-3 text-rose-500 shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="font-bold text-slate-700 truncate">{u.name}</div>
                {u.phase === 'uploading' && (
                  <div className="h-1 bg-slate-100 rounded-full overflow-hidden mt-0.5">
                    <div className="h-full bg-indigo-500 transition-all" style={{ width: `${u.progress}%` }} />
                  </div>
                )}
                {u.phase === 'error' && <div className="text-[10px] text-rose-600 font-medium">{u.error}</div>}
              </div>
              {u.phase === 'error' && (
                <button
                  onClick={() => setUploads(prev => prev.filter(x => x.id !== u.id))}
                  className="text-[10px] font-bold text-slate-400 hover:text-slate-600"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Current assets */}
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-slate-400 mx-auto" />
      ) : items.length === 0 ? (
        <p className="text-[11px] text-slate-500 text-center py-2 italic">No content set. Upload one or more files above.</p>
      ) : (
        <ul className="space-y-1">
          {items.map(item => {
            const isImage = item.asset.mimeType?.startsWith('image/');
            const isVideo = item.asset.mimeType?.startsWith('video/');
            const isAudio = item.asset.mimeType?.startsWith('audio/');
            const Icon = isImage ? ImageIcon : isVideo ? Video : isAudio ? Music : ImageIcon;
            const url = item.asset.fileUrl?.startsWith('http') ? item.asset.fileUrl : `${apiBase}${item.asset.fileUrl}`;
            return (
              <li key={item.id} className="bg-white rounded-md border border-slate-200 px-2.5 py-1.5 flex items-center gap-2 group">
                <div className="w-8 h-8 rounded bg-slate-100 flex items-center justify-center overflow-hidden shrink-0">
                  {isImage ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Icon className="w-4 h-4 text-slate-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-bold text-slate-700 truncate">{item.asset.originalName || item.asset.fileUrl?.split('/').pop()}</div>
                  <div className="text-[10px] text-slate-400">{(item.durationMs / 1000).toFixed(0)}s · {item.asset.mimeType?.split('/')[0]}</div>
                </div>
                <button
                  onClick={() => handleRemove(item)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all"
                  title="Remove from this bucket"
                  aria-label={`Remove ${item.asset.originalName || 'asset'}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
