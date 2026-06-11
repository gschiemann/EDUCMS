'use client';

/**
 * AssetPicker — the shared "choose content" modal.
 *
 * One place to either pick a file already in the Assets library
 * (browsable by folder) or upload a new one. Wired into every spot
 * where an operator sets an image / video: cue takeover content,
 * sponsor logos, player photos, team logos, the scoreboard spotlight.
 *
 * Upload here and the file lands in the Assets library (in the folder
 * the operator has selected), so it's instantly available everywhere
 * else too — which is the whole point: load all your content once,
 * organize it into folders, then select it wherever you need it.
 *
 * Uploads use the same presign → signed-PUT → complete-upload flow the
 * /assets page uses. `onPick` receives the asset's stored `fileUrl`
 * (the same value a direct upload would yield) so callers store it
 * exactly as before.
 */

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { X, Upload, Loader2, ImageIcon, FolderOpen } from 'lucide-react';
import { useAssets, useAssetFolders } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api-client';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { transformedImageUrl } from '@/lib/asset-image';

export type AssetKind = 'image' | 'video' | 'all';

/** Relative asset paths → absolute for <img>/<video> display. Absolute
 *  (Supabase / data) URLs pass through untouched. */
function resolveAssetUrl(url: string): string {
  if (!url) return '';
  if (/^(https?:|data:)/i.test(url)) return url;
  const base =
    typeof window !== 'undefined' && process.env.NEXT_PUBLIC_API_URL
      ? process.env.NEXT_PUBLIC_API_URL.replace('/api/v1', '')
      : 'http://localhost:8080';
  return `${base}${url}`;
}

function matchesKind(mime: string | undefined, kind: AssetKind): boolean {
  const m = (mime || '').toLowerCase();
  if (kind === 'image') return m.startsWith('image/');
  if (kind === 'video') return m.startsWith('video/');
  return m.startsWith('image/') || m.startsWith('video/');
}

export function AssetPicker({
  kind = 'image',
  title,
  onPick,
  onClose,
}: {
  kind?: AssetKind;
  title?: string;
  /** Receives the asset's stored fileUrl. */
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  // Hide the mobile tab bar while this picker is up (footer Upload/select).
  useOverlayLock();
  const { data: assets, isLoading } = useAssets();
  const { data: folders } = useAssetFolders();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [folderId, setFolderId] = useState<string>('all');
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');

  const folderList: Array<{ id: string; name: string }> = Array.isArray(folders) ? folders : [];
  const all: Array<Record<string, unknown>> = Array.isArray(assets) ? assets : [];
  const list = all.filter((a) => {
    if (!matchesKind(a.mimeType as string, kind)) return false;
    if (folderId === 'all') return true;
    if (folderId === 'none') return !a.folderId;
    return a.folderId === folderId;
  });

  const accept =
    kind === 'image'
      ? 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif'
      : kind === 'video'
        ? 'video/mp4,video/webm'
        : 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif,video/mp4,video/webm';

  const upload = async (file: File) => {
    setErr('');
    const lname = (file.name || '').toLowerCase();
    if (lname.endsWith('.mov') || (file.type || '').toLowerCase() === 'video/quicktime') {
      setErr("QuickTime .mov isn't supported — export as MP4 and re-upload.");
      return;
    }
    setUploading(true);
    try {
      const contentType = file.type || 'application/octet-stream';
      // Upload straight into the folder the operator is browsing.
      const targetFolder = folderId === 'all' || folderId === 'none' ? null : folderId;
      const pre = await apiFetch<{
        uploadUrl?: string;
        signedUrl?: string;
        storagePath: string;
        fileUrl: string;
        mimeType?: string;
        maxFileSize?: number;
      }>('/assets/presign', {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          contentType,
          size: file.size,
          folderId: targetFolder,
        }),
      });
      if (pre.maxFileSize && file.size > pre.maxFileSize) {
        throw new Error(
          `File too big (${Math.round(file.size / 1024 / 1024)}MB). Max ${Math.round(
            pre.maxFileSize / 1024 / 1024,
          )}MB.`,
        );
      }
      const target = pre.uploadUrl || pre.signedUrl;
      if (!target) throw new Error('Server did not return an upload URL.');
      const put = await fetch(target, {
        method: 'PUT',
        headers: {
          'content-type': pre.mimeType || contentType,
          // SUPABASE EGRESS FIX (2026-05-23): see /assets/page.tsx for
          // the full reasoning. Without this, Supabase signed-URL
          // uploads default to `cache-control: no-cache` which forces
          // every player/browser to re-download on every fetch.
          //
          // 2026-06-09 Fable audit — this is INTENTIONALLY the full
          // `public, …, immutable` string and NOT the bare `max-age=N`
          // the SERVER uses (supabase-storage.service.ts:226). They differ
          // because they hit different Supabase APIs: this browser path is
          // a direct signed-URL PUT, which preserves the full string on the
          // wire; the server path is a storage-js POST, which DROPS the full
          // string (the 2026-05-30 regression — DB said immutable, wire said
          // no-cache) and only honors bare `max-age=N`. Keep the full form
          // here — `immutable` is strictly better (no revalidation 304 on a
          // player reload, which matters across a screen fleet). Do NOT
          // "unify" to bare without first moving the server to a signed-URL
          // PUT, or you weaken fleet caching.
          'cache-control': 'public, max-age=31536000, immutable',
        },
        body: file,
      });
      if (!put.ok) throw new Error(`Storage upload failed (${put.status}).`);
      const done = await apiFetch<{ fileUrl: string }>('/assets/complete-upload', {
        method: 'POST',
        body: JSON.stringify({
          storagePath: pre.storagePath,
          filename: file.name,
          contentType: pre.mimeType || contentType,
          size: file.size,
          folderId: targetFolder,
        }),
      });
      await qc.invalidateQueries({ queryKey: ['assets'] });
      const url = done.fileUrl || pre.fileUrl;
      if (!url) throw new Error('Upload completed but no file URL came back.');
      onPick(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl ring-1 ring-slate-200 w-full max-w-2xl max-h-[82vh] flex flex-col overflow-hidden">
        {/* header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-800">{title || 'Choose content'}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* toolbar — folder filter + upload */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50/60">
          <FolderOpen className="h-4 w-4 text-slate-400 shrink-0" />
          <select
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
            className="text-xs font-medium border border-slate-200 rounded-lg px-2 py-1.5 bg-white cursor-pointer outline-none focus:ring-2 focus:ring-indigo-400"
            aria-label="Filter by folder"
          >
            <option value="all">All folders</option>
            <option value="none">Unfiled</option>
            {folderList.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <div className="flex-1" />
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-60 cursor-pointer"
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Upload new
          </button>
        </div>

        {err && (
          <div className="mx-4 mt-3 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
            {err}
          </div>
        )}

        {/* grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="py-14 text-center text-xs text-slate-400">Loading library…</div>
          ) : list.length === 0 ? (
            <div className="py-14 text-center">
              <ImageIcon className="h-7 w-7 text-slate-300 mx-auto mb-2" />
              <p className="text-xs text-slate-400">
                Nothing here yet — use <strong className="font-semibold">Upload new</strong>{' '}
                above, or add files in the Assets section.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {list.map((a) => {
                const url = String(a.fileUrl || '');
                const abs = resolveAssetUrl(url);
                const isVideo = String(a.mimeType || '').toLowerCase().startsWith('video/');
                const name = String(a.originalName || url.split('/').pop() || 'file');
                return (
                  <button
                    key={String(a.id)}
                    type="button"
                    onClick={() => onPick(url)}
                    title={name}
                    className="group relative aspect-square rounded-lg overflow-hidden border border-slate-200 bg-slate-100 hover:border-indigo-400 hover:ring-2 hover:ring-indigo-200 cursor-pointer transition-all"
                  >
                    {isVideo ? (
                      // 2026-05-30 — EGRESS FIX: preload="none" so picker
                      // grid tiles don't auto-download video bytes.
                      <video src={abs} muted preload="none" className="w-full h-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        // 2026-05-30 — EGRESS FIX: use Supabase 320 px transform
                        // for image picker tiles to avoid full-res fetches.
                        src={transformedImageUrl(abs, { width: 320, quality: 60 })}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                        }}
                      />
                    )}
                    <span className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-gradient-to-t from-black/70 to-transparent text-[9px] text-white truncate text-left">
                      {name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
