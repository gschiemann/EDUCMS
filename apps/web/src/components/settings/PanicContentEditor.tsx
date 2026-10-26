"use client";

import { useState, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, Trash2, Upload, Image as ImageIcon, Video, Music, AlertTriangle, ShieldCheck, Monitor, Smartphone } from 'lucide-react';
import { emergencyWordingKind, standardEmergencyWording, type EmergencyWordingLocale } from '@cms/api-types';
import { useUIStore } from '@/store/ui-store';
import { useQueryClient } from '@tanstack/react-query';
import { usePanicContent, useAddPanicAsset, useRemovePanicAsset, type PanicKind, type PanicMode, type PanicOrientation } from '@/hooks/use-api';
import { appConfirm } from '@/components/ui/app-dialog';
import { ALERT_CONTENT_ACCEPT, uploadProblemFor, useUploadProblemText } from '@/lib/upload-accept';

const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1').replace('/api/v1', '');

type Props = {
  kind: PanicKind;
  label: string;
  /** Tailwind color name for the dot + accents (matches the existing card scheme). */
  accent: 'red' | 'amber' | 'orange' | 'slate' | 'sky' | 'violet' | 'rose';
  /** Optional one-line description shown under the title. */
  hint?: string;
  /**
   * 2026-10-10 — which bucket this card edits: the LIVE content (default,
   * every existing caller) or the DRILL content for the same type.
   */
  mode?: PanicMode;
};

// 2026-10-12 (owner: "each card has a different background — messy"): every
// card is the SAME neutral surface; the type keeps only its small dot.
const ACCENT_DOT = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  slate: 'bg-slate-500',
  sky: 'bg-sky-500',
  violet: 'bg-violet-500',
  rose: 'bg-rose-500',
};

const MAX_FILE_SIZE = 500 * 1024 * 1024; // matches the /assets video cap (raised 2026-09-23)

/**
 * One alert type's content (2026-10-26: translated, and READY by default).
 *
 * Every alert type now has its STANDARD WORDING (owner-approved; @cms/api-types
 * emergency-wording.ts): with no picture or video of its own, a live alert
 * shows that wording on the red board, so the card says "Standard message"
 * and previews exactly what the screens show — in English, the language of
 * the board, with the meaning underneath for a Spanish or Chinese reader.
 * Adding your own picture or video is optional and replaces the standard
 * board for that type and orientation.
 *
 * Direct asset uploader for one panic content bucket. Bypasses the
 * regular /playlists surface so emergency content can never be
 * accidentally deleted from the playlists list. Operators just see
 * "drop assets here" and a list of what's currently set.
 *
 * Orientation split: each bucket now stores TWO playlists — a landscape
 * variant and a portrait variant. The toggle at the top of the card
 * flips between them; each variant has its own asset list + drop zone.
 * At emergency trigger time the manifest controller picks whichever
 * variant matches each individual screen's resolution, and falls back
 * to the other if only one is configured. Admin only has to configure
 * what they actually have; zero friction when there's only one
 * orientation in play.
 */
export function PanicContentEditor({ kind, label, accent, hint, mode = 'live' }: Props) {
  const t = useTranslations('panicContent');
  const locale = useLocale() as EmergencyWordingLocale;
  const dot = ACCENT_DOT[accent];
  const [orientation, setOrientation] = useState<PanicOrientation>('landscape');
  // Read BOTH variants so the toggle labels can show a count for each
  // side. The inactive variant still hits the API once but that's a
  // tiny cached list lookup — worth it so the operator sees at a
  // glance whether portrait is empty vs has content. The active one
  // drives the drop zone + item list below.
  const landscapeQ = usePanicContent(kind, 'landscape', mode);
  const portraitQ  = usePanicContent(kind, 'portrait', mode);
  const data = orientation === 'portrait' ? portraitQ.data : landscapeQ.data;
  const isLoading = orientation === 'portrait' ? portraitQ.isLoading : landscapeQ.isLoading;
  const addAsset = useAddPanicAsset(kind, orientation, mode);
  const removeAsset = useRemovePanicAsset(kind, orientation, mode);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const problemText = useUploadProblemText();
  const [uploads, setUploads] = useState<Array<{ id: string; name: string; progress: number; phase: 'uploading' | 'error'; error?: string }>>([]);

  const items = data?.items ?? [];
  const landscapeCount = landscapeQ.data?.items?.length ?? 0;
  const portraitCount  = portraitQ.data?.items?.length ?? 0;

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
    const token = useUIStore.getState().token;
    const genId = () => { try { return crypto.randomUUID(); } catch { return Math.random().toString(36).substring(2, 10); } };

    Array.from(files).forEach(file => {
      const id = genId();
      // 2026-10-05 — the shared upload-formats rule for THIS endpoint
      // (/assets/upload): alert content goes straight into a protected playlist
      // that is never converted, so a MOV / AVI / … is sent to the Media Library
      // with plain words; a HEIC photo is fine (converted before it is stored).
      const problem = uploadProblemFor(file, { path: 'multipart' });
      if (problem) {
        setUploads(prev => [{ id, name: file.name, progress: 0, phase: 'error', error: problemText(problem, file) }, ...prev]);
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        setUploads(prev => [{ id, name: file.name, progress: 0, phase: 'error', error: t('tooLarge', { size: Math.round(file.size / (1024 * 1024)) }) }, ...prev]);
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
                  setUploads(prev => prev.map(u => (u.id === id ? { ...u, phase: 'error', error: t('bindFailed') } : u)));
                },
              });
            }
          } catch {
            setUploads(prev => prev.map(u => (u.id === id ? { ...u, phase: 'error', error: t('badResponse') } : u)));
          }
        } else {
          let msg = t('uploadFailed', { status: xhr.status });
          try { const r = JSON.parse(xhr.responseText); msg = r.message || msg; } catch {}
          setUploads(prev => prev.map(u => (u.id === id ? { ...u, phase: 'error', error: msg } : u)));
        }
      };
      xhr.onerror = () => {
        setUploads(prev => prev.map(u => (u.id === id ? { ...u, phase: 'error', error: t('networkError') } : u)));
      };
      xhr.open('POST', `${apiUrl}/assets/upload`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(fd);
    });
  };

  const handleRemove = async (item: typeof items[number]) => {
    const ok = await appConfirm({
      title: t('removeTitle', { label }),
      message: t('removeMessage', { name: item.asset.originalName || t('thisFile'), label }),
      tone: 'danger',
      confirmLabel: t('remove'),
    });
    if (!ok) return;
    removeAsset.mutate(item.id);
  };

  // Overall-status pill. Own content in EITHER orientation counts; with none,
  // a live alert shows the type's standard message (ready, not a gap), and a
  // drill falls back to the live content — still marked DRILL.
  const anyConfigured = landscapeCount > 0 || portraitCount > 0;
  const wordingKind = emergencyWordingKind(kind);
  const showStandard = mode === 'live' && !anyConfigured && !!wordingKind;
  const boardWords = wordingKind ? standardEmergencyWording(wordingKind, 'en') : null;
  const localWords = wordingKind && locale !== 'en' ? standardEmergencyWording(wordingKind, locale) : null;

  return (
    <div data-alert-content-card={kind} data-alert-content-mode={mode} className="min-w-0 p-3 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-colors flex flex-col gap-2">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span aria-hidden className={`w-2.5 h-2.5 shrink-0 rounded-full ${dot}`} />
            <h3 className="text-sm font-bold text-slate-800">{label}</h3>
          </div>
          <span
            data-testid={`alert-status-${kind}`}
            className={`text-[10px] font-bold uppercase tracking-wider shrink-0 flex items-center gap-1 ${anyConfigured || showStandard ? 'text-emerald-600' : 'text-slate-500'}`}
          >
            <ShieldCheck className="w-3 h-3" aria-hidden />
            {anyConfigured
              ? t('ownCount', { landscape: landscapeCount, portrait: portraitCount })
              : mode === 'drill'
                ? t('usesLive')
                : t('standardMessage')}
          </span>
        </div>
        {hint && <p className="text-[11px] text-slate-500 mt-0.5 ml-[18px]">{hint}</p>}
      </div>

      {/* The standard board, exactly as a live alert of this type shows it
          when there is no picture or video of its own. */}
      {showStandard && boardWords && (
        <figure className="m-0" data-testid={`standard-wording-${kind}`}>
          <div className="rounded-lg bg-[#dc2626] text-white text-center px-3 py-3 aspect-[16/7] flex flex-col items-center justify-center" aria-label={t('previewLabel', { label })}>
            <div className="text-[13px] font-black tracking-wide leading-tight">{boardWords.headline}</div>
            {boardWords.lines.map((line) => (
              <div key={line} className="text-[11px] font-semibold leading-snug mt-0.5">{line}</div>
            ))}
          </div>
          <figcaption className="mt-1 text-[11px] leading-[15px] text-slate-500">
            {t('standardCaption')}
            {localWords && (
              <span className="block mt-0.5 text-slate-600" lang={locale}>
                {t('meaning')}: {localWords.headline} — {localWords.lines.join(' ')}
              </span>
            )}
          </figcaption>
        </figure>
      )}

      {/* Orientation toggle — which variant the drop zone + list below
          is showing. Each screen auto-picks the matching variant at
          emergency trigger time (and falls back to the other if
          only one is configured), so this toggle is just an authoring
          switch; operators don't choose "which one to send." */}
      <div className="grid grid-cols-2 w-full min-w-0 bg-white border border-slate-200 rounded-lg p-0.5 text-[10px]" role="tablist" aria-label={t('orientationLabel', { label })}>
        <button
          type="button"
          role="tab"
          aria-selected={orientation === 'landscape'}
          onClick={() => setOrientation('landscape')}
          className={`min-w-0 px-1.5 py-1 rounded-md flex items-center justify-center gap-1 font-bold transition-colors ${
            orientation === 'landscape'
              ? 'bg-slate-800 text-white'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Monitor className="w-3 h-3 shrink-0" /><span className="min-w-0 truncate">{t('landscape')}</span>
          <span className={`shrink-0 px-1 rounded ${landscapeCount > 0 ? (orientation === 'landscape' ? 'bg-white/20' : 'bg-emerald-100 text-emerald-700') : 'bg-slate-100 text-slate-400'}`}>{landscapeCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={orientation === 'portrait'}
          onClick={() => setOrientation('portrait')}
          className={`min-w-0 px-1.5 py-1 rounded-md flex items-center justify-center gap-1 font-bold transition-colors ${
            orientation === 'portrait'
              ? 'bg-slate-800 text-white'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Smartphone className="w-3 h-3 shrink-0" /><span className="min-w-0 truncate">{t('portrait')}</span>
          <span className={`shrink-0 px-1 rounded ${portraitCount > 0 ? (orientation === 'portrait' ? 'bg-white/20' : 'bg-emerald-100 text-emerald-700') : 'bg-slate-100 text-slate-400'}`}>{portraitCount}</span>
        </button>
      </div>

      {/* Drop zone — slim row, no "big drag-drop area" (2026-05-25
          operator: "no need for that big ass drag and drop area").
          Same drop target, same click target, half the vertical space. */}
      {/* A real button now (2026-10-26): reachable by keyboard and by a
          screen reader, still a drop target for a dragged file. */}
      <button
        type="button"
        className={`w-full min-h-[40px] border border-dashed rounded-md px-2.5 py-1.5 transition-colors cursor-pointer flex items-center gap-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${
          dragOver
            ? 'border-slate-500 bg-slate-50'
            : 'border-slate-300 bg-slate-50/60 hover:border-slate-400 hover:bg-slate-50'
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
        <Upload className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden />
        <span className="text-[11px] font-bold text-slate-600 truncate">{t('addOwn')}</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ALERT_CONTENT_ACCEPT}
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => { handleFiles(e.target.files); if (fileInputRef.current) fileInputRef.current.value = ''; }}
      />

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
                  className="text-[10px] font-bold text-slate-400 hover:text-slate-600 px-1"
                  aria-label={t('dismiss')}
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
        <p className="text-[11px] text-slate-400 text-center py-0.5">{mode === 'drill' ? t('emptyDrill') : t('emptyLive')}</p>
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
                {/* Always visible: a hover-only control cannot be reached on a phone. */}
                <button
                  onClick={() => handleRemove(item)}
                  className="p-2 -m-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                  title={t('removeHint')}
                  aria-label={t('removeAria', { name: item.asset.originalName || t('thisFile') })}
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
