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
 * Uploads use the same direct-to-storage client the /assets page uses
 * (src/lib/direct-upload.ts: presign → resumable TUS / signed PUT →
 * complete-upload, up to 2 GB for video, with live progress). `onPick`
 * receives the asset's stored `fileUrl` so callers store it exactly as before.
 */

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { X, Upload, Loader2, ImageIcon, FolderOpen, Music } from 'lucide-react';
import { useAssets, useAssetFolders } from '@/hooks/use-api';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { uploadAssetDirect } from '@/lib/direct-upload';
import { useUploadErrorText, useUploadTooLargeText } from '@/lib/use-upload-error-text';
import { transformedImageUrl } from '@/lib/asset-image';

export type AssetKind = 'image' | 'video' | 'audio' | 'all';

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
  if (kind === 'audio') return m.startsWith('audio/');
  return m.startsWith('image/') || m.startsWith('video/') || m.startsWith('audio/');
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
  // Escape closes the picker — the visible Close button (below) is the
  // other keyboard-accessible dismiss path. a11y wave 2026-08-25.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const { data: assets, isLoading } = useAssets();
  const { data: folders } = useAssetFolders();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [folderId, setFolderId] = useState<string>('all');
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [err, setErr] = useState('');
  const tu = useTranslations('directUpload');
  const uploadErrorText = useUploadErrorText();
  const tooLargeText = useUploadTooLargeText();

  const folderList: Array<{ id: string; name: string }> = Array.isArray(folders) ? folders : [];
  const all: Array<Record<string, unknown>> = Array.isArray(assets) ? assets : [];
  const list = all.filter((a) => {
    if (!matchesKind(a.mimeType as string, kind)) return false;
    if (folderId === 'all') return true;
    if (folderId === 'none') return !a.folderId;
    return a.folderId === folderId;
  });

  // SVG is intentionally absent from the accept list — the server can't
  // sanitize a direct browser→Supabase upload before it lands in storage,
  // so a raw SVG would be a stored-XSS vector. Dropping it from `accept`
  // means the native file picker doesn't even offer SVGs; the `upload()`
  // pre-check below catches a drag-drop / "all files" pick and surfaces a
  // specific, honest message instead of a generic 415 "Upload failed".
  // (Mirrors getUnsupportedReason() in /assets/page.tsx + the server's
  // assertUploadIntent() in assets.controller.ts.)
  const accept =
    kind === 'image'
      ? 'image/png,image/jpeg,image/webp,image/gif,image/avif'
      : kind === 'video'
        ? 'video/mp4,video/webm'
        : kind === 'audio'
          ? 'audio/mpeg,audio/wav,audio/ogg,audio/mp4'
          : 'image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg,audio/mp4';

  const upload = async (file: File) => {
    setErr('');
    const lname = (file.name || '').toLowerCase();
    if (lname.endsWith('.mov') || (file.type || '').toLowerCase() === 'video/quicktime') {
      setErr("QuickTime .mov isn't supported — export as MP4 and re-upload.");
      return;
    }
    if (lname.endsWith('.svg') || (file.type || '').toLowerCase() === 'image/svg+xml') {
      // Specific over silent: tell the operator exactly what to do instead
      // of letting the presign call 415 and surface a raw "Upload failed".
      setErr("SVG logos aren't supported yet — export as PNG (SVG support is coming soon).");
      return;
    }
    const tooBig = tooLargeText(file);
    if (tooBig) {
      setErr(tooBig);
      return;
    }
    setUploading(true);
    setUploadPct(0);
    try {
      // Upload straight into the folder the operator is browsing.
      const targetFolder = folderId === 'all' || folderId === 'none' ? null : folderId;
      const done = await uploadAssetDirect(file, {
        folderId: targetFolder,
        onProgress: (p) => setUploadPct(Math.round(p.fraction * 100)),
      });
      await qc.invalidateQueries({ queryKey: ['assets'] });
      if (!done.fileUrl) throw new Error('Upload completed but no file URL came back.');
      onPick(done.fileUrl);
    } catch (e) {
      setErr(uploadErrorText(e, file));
    } finally {
      setUploading(false);
      setUploadPct(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div
      // top/right/bottom/left longhand (NOT inset-0) — this picker can mount on
      // the player-adjacent template builder; keep it Taurus-safe. The modal is
      // z-[10001] so it paints OVER the TopToolbar (z-20) and the mobile tab bar
      // (hidden via useOverlayLock above) — its Close + Upload toolbar are
      // always reachable on a phone. Safe-area padding keeps the modal clear of
      // the notch / home indicator on short viewports (mobile bug, 2026-06-27).
      className="fixed top-0 right-0 bottom-0 left-0 z-[10001] flex items-center justify-center p-4"
      style={{
        paddingTop: 'max(16px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))',
      }}
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop — mouse-only "click outside to close" convenience.
          Escape (handled above) and the visible Close button below are the
          real keyboard/AT-accessible dismissal paths; making this div
          itself focusable would insert an invisible full-viewport tab
          stop ahead of the picker's own controls. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="absolute top-0 right-0 bottom-0 left-0 bg-slate-900/50" onClick={onClose} />
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
            className="text-xs font-medium border border-slate-200 rounded-lg px-2 py-1.5 bg-white cursor-pointer outline-none focus:ring-2 focus:ring-indigo-400 min-w-0 max-w-[40vw] sm:max-w-none truncate"
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-60 cursor-pointer shrink-0"
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            {uploading && uploadPct !== null ? tu('uploadingPct', { pct: uploadPct }) : 'Upload new'}
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
                const mt = String(a.mimeType || '').toLowerCase();
                const isVideo = mt.startsWith('video/');
                const isAudio = mt.startsWith('audio/');
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
                    ) : isAudio ? (
                      <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-violet-100 to-indigo-100">
                        <Music className="h-7 w-7 text-indigo-400" />
                      </div>
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
