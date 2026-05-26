"use client";

import { useState, useMemo, useRef, useEffect } from 'react';
import { Play, Plus, Clock, Loader2, Trash2, Save, GripVertical, Image as ImageIcon, Video, Music, Globe, File, Calendar, CalendarDays, Power, Eye, LayoutTemplate, Pencil, Monitor, Layers, ChevronRight, ChevronLeft, Tv2, Wifi, WifiOff, ArrowLeft, Smartphone, FolderOpen, Home, CheckSquare, Search, Settings, Upload, AlertCircle, Download, Usb, Check, RefreshCw } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { PlaylistPreviewThumb, derivePlaylistContentLabel, type TemplateLookupEntry } from '@/components/playlists/PlaylistPreviewThumb';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext, closestCenter, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';

import {
  usePlaylists, useCreatePlaylist, useDeletePlaylist, useAssets,
  useReorderPlaylistItems, useScreenGroups, useCreateSchedule,
  useSchedules, useDeleteSchedule, useToggleSchedule, useUpdateSchedule, useScreens,
  useTemplates, useAssetFolders, useSetPlaylistActive,
  useUsers, useCreateSubmission,
} from '@/hooks/use-api';
import { appConfirm, appAlert } from '@/components/ui/app-dialog';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1').replace('/api/v1', '');
type PlaylistSort = 'latest' | 'oldest' | 'az' | 'za' | 'creator' | 'modified' | 'assigned';
type AssignmentFilter = 'all' | 'assigned' | 'unassigned';

function fmtPlaylistDate(value?: string | Date | null) {
  if (!value) return 'Unknown';
  return new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function creatorLabel(playlist: any) {
  return playlist?.createdBy?.email || 'Unknown creator';
}

function playlistStamp(playlist: any, field: 'createdAt' | 'updatedAt') {
  const value = playlist?.[field] || playlist?.createdAt || playlist?.updatedAt;
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function thumbUrl(asset: any) {
  if (!asset) return null;
  // 2026-05-13 — Videos get a real preview too, not just an icon.
  // Operator: "the playlists with videos are not showing the preview
  // of the video like the images one". Previously this returned null
  // for video/* so every video item rendered the generic file icon.
  // Callers must check the mime to decide between <img> and <video>;
  // see <AssetThumb> below for the canonical pattern.
  // 2026-05-19 — URL/webpage assets get a preview too. Operator: "in
  // the playlist picker you dont see the preview". The asset library
  // already used WordPress's free mshots service to render a homepage
  // screenshot for text/html assets; the playlist surfaces (picker,
  // editor, card preview) used this different thumbUrl that returned
  // null and rendered a generic globe icon. Mirror the mshots branch
  // so all three playlist surfaces show the same preview as the
  // library. First mshots hit can return a warming placeholder — see
  // the onError retry in <AssetThumb> below.
  if (asset.mimeType === 'text/html' && asset.fileUrl) {
    return `https://s.wordpress.com/mshots/v1/${encodeURIComponent(asset.fileUrl)}?w=640&h=360`;
  }
  if (
    !asset.mimeType?.startsWith('image/') &&
    !asset.mimeType?.startsWith('video/')
  ) return null;
  return asset.fileUrl?.startsWith('http') ? asset.fileUrl : `${apiBase}${asset.fileUrl}`;
}

/**
 * Renders the right inline media element for any asset's thumbnail.
 * Image → <img>. Video → <video preload="metadata"> that seeks to
 * 0.1s so the browser commits a real first frame instead of leaving
 * a black/empty video tag. Returns null for assets without a thumb.
 *
 * Use this anywhere you'd otherwise have written `{thumb && <img />}`
 * — keeps every preview surface (playlist editor, asset picker,
 * scheduled item card) consistent with the asset library.
 */
function AssetThumb({ asset, className }: { asset: any; className?: string }) {
  const url = thumbUrl(asset);
  if (!url) return null;
  if (asset?.mimeType?.startsWith('video/')) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        src={url}
        muted
        playsInline
        preload="metadata"
        className={className}
        onLoadedMetadata={(e) => {
          // Seek to a tiny offset so the browser DECODES and paints a
          // real frame. Without this, Chromium/Safari often leave a
          // black rectangle until the video is played. 0.1s is past
          // any leading I-frame oddities and short enough to feel
          // instant.
          try { (e.currentTarget as HTMLVideoElement).currentTime = 0.1; } catch { /* ignore */ }
        }}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={url}
      alt=""
      className={className}
      onError={(e) => {
        // mshots' first hit on a fresh URL can return a "warming"
        // placeholder that fails to load; the screenshot is ready
        // within ~1–3 s. Retry up to 3× with backoff before hiding.
        // For non-mshots images this is just a transient-network retry.
        const img = e.currentTarget;
        const tries = Number(img.dataset.tries || 0);
        if (tries < 3) {
          img.dataset.tries = String(tries + 1);
          setTimeout(() => {
            img.src = url + (url.includes('?') ? '&' : '?') + 'retry=' + tries;
          }, 1500 * (tries + 1));
        } else {
          img.style.display = 'none';
        }
      }}
    />
  );
}

function mimeIcon(mime: string, cls = 'w-4 h-4') {
  if (mime?.startsWith('video/')) return <Video className={`${cls} text-violet-500`} />;
  if (mime?.startsWith('audio/')) return <Music className={`${cls} text-amber-500`} />;
  if (mime === 'text/html') return <Globe className={`${cls} text-emerald-500`} />;
  if (mime?.startsWith('image/')) return <ImageIcon className={`${cls} text-sky-500`} />;
  return <File className={`${cls} text-slate-400`} />;
}

function assetName(asset: any) {
  if (!asset) return 'Unknown';
  if (asset.originalName) return asset.originalName;
  if (asset.mimeType === 'text/html') {
    try { return new URL(asset.fileUrl).hostname; } catch { return asset.fileUrl; }
  }
  return asset.fileUrl?.split('/').pop() || 'file';
}

// --- Sortable item ---
function SortableItem({ item, index, onRemove, onDurationChange, onUpdate, isSelected, onToggle, isViewer }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [showSettings, setShowSettings] = useState(false);
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined, opacity: isDragging ? 0.5 : 1 };
  const thumb = thumbUrl(item.asset);
  const name = assetName(item.asset);

  const isScheduled = !!(item.daysOfWeek || item.timeStart || item.timeEnd);

  return (
    <div ref={setNodeRef} style={style} className={`bg-white rounded-2xl border ${isSelected ? 'border-indigo-400 ring-2 ring-indigo-100 shadow-[0_4px_20px_rgba(99,102,241,0.12)]' : 'border-slate-100 group hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)]'} transition-all overflow-hidden flex flex-col`}>
      {/* Apply drag listeners to the WHOLE row so the operator can grab
          anywhere — the tiny grip-icon handle was undiscoverable (user
          reported "I can't drag the order"). The PointerSensor's
          activationConstraint:{distance:8} keeps clicks on the duration
          input, checkbox, and settings button working: they only
          trigger a drag after the pointer has moved 8px. */}
      {/* 2026-05-14 — single-row playlist item, mobile-honest.
          Operator: "now you just shifted the 10 sec and settings
          below....fit them into a single row somehow". Then:
          "i need something that shows me i can drag and drop the
          order of the playlist...if i try now it highlights the
          text and then pulls up an apple menu asking if i want to
          copy/lookup/trnslate".

          Strategy: drop visual chrome that's redundant on a small
          screen (index number — items render in order anyway;
          mime-type subtitle; the literal "sec" label — the input is
          obviously seconds in context). Keeps the actionable bits
          inline: visible drag grip (now mobile too), checkbox,
          thumbnail, name, duration input, gear, trash. Reverts to
          the rich desktop chrome at md+.

          Drag is grip-only now (vs prior "drag-anywhere on the
          row"). Why: on iOS, pressing anywhere on the row triggers
          Safari's text-selection + context-menu (copy / lookup /
          translate) BEFORE dnd-kit can promote the press into a
          drag. Confining drag to a single dedicated handle lets us
          apply `touch-action: none` + `-webkit-touch-callout: none`
          ONLY to that element — the rest of the row keeps normal
          touch behavior (tap a duration input, tap a button, etc.). */}
      <div
        {...(isViewer ? {} : attributes)}
        title={isViewer ? 'Read-only — viewer role' : undefined}
        className={`playlist-item-card flex items-center gap-1.5 md:gap-3 p-2 md:p-3.5 ${isViewer ? 'cursor-not-allowed opacity-90' : ''}`}
        style={{
          // Suppress iOS Safari's text selection + long-press
          // context menu on the row chrome. The duration <input>
          // and editable buttons inside still get default behavior
          // since these properties don't inherit through focus.
          WebkitUserSelect: 'none',
          userSelect: 'none',
          WebkitTouchCallout: 'none',
        }}
      >
        {/* Drag grip — VISIBLE ON MOBILE (was md:block-only before).
            Doubles as both the visual affordance ("this row can
            reorder") AND the drag activator. dnd-kit listeners are
            on this <button> only, not the whole row.
            touch-action:none keeps the browser from interpreting a
            press here as a scroll/zoom gesture, so the TouchSensor
            with delay:150ms can win the activation race over iOS's
            ~500ms long-press menu. */}
        <button
          type="button"
          {...(isViewer ? {} : listeners)}
          aria-label="Drag to reorder"
          disabled={isViewer}
          className={`shrink-0 -ml-0.5 md:-ml-1 px-1 py-2 md:py-1 rounded touch-none ${isViewer ? 'opacity-40 cursor-not-allowed' : 'text-slate-400 md:text-slate-300 hover:text-indigo-500 hover:bg-slate-100 cursor-grab active:cursor-grabbing active:bg-slate-200'}`}
          style={{ touchAction: 'none' }}
        >
          <GripVertical className="w-5 h-5 md:w-4 md:h-4" aria-hidden="true" />
        </button>
        <input type="checkbox" checked={isSelected} onChange={() => onToggle(item.id)} className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer shrink-0" />
        {/* Index number — desktop only; visually redundant on mobile
            where rows are obviously sequential. */}
        <span className="text-xs font-bold text-slate-400 w-5 text-center shrink-0 hidden md:inline-block">{index + 1}</span>
        <div className="w-10 h-10 md:w-14 md:h-10 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
          {thumb
            ? <AssetThumb asset={item.asset} className="w-full h-full object-cover" />
            : mimeIcon(item.asset?.mimeType)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-xs font-medium text-slate-700 truncate" title={name}>{name}</p>
            {isScheduled && <span title="Time Restricted" className="shrink-0"><Clock className="w-3 h-3 text-indigo-500" /></span>}
          </div>
          {/* Mime label is desktop-only — secondary info, eats a
              line on mobile that we can't afford. Available via
              the row's title attribute for accessibility. */}
          <p className="text-[10px] text-slate-400 truncate hidden md:block">{item.asset?.mimeType}</p>
        </div>
        {/* Duration input + side-controls. data-allow-small-input
            opts this number field out of the global 16px iOS-zoom
            floor so it can stay compact in the row — the field
            doesn't take focus often enough for the zoom-stuck UX
            issue to bite here, and the larger floor would balloon
            the row past one line. */}
        {item.asset?.mimeType?.startsWith('video/') ? (
          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 md:px-3 py-1 rounded-md uppercase tracking-wide shrink-0">Auto</span>
        ) : (
          <>
            <input
              type="number" min={1} max={300}
              value={Math.round((item.durationMs || 10000) / 1000)}
              onChange={(e) => onDurationChange(item.id, parseInt(e.target.value) || 10)}
              disabled={isViewer}
              title={isViewer ? 'Read-only — viewer role' : 'Duration in seconds'}
              data-allow-small-input
              className="w-12 md:w-14 px-1.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-md text-center font-medium outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            />
            {/* "sec" label desktop-only — input context makes it
                obvious on mobile. */}
            <span className="text-[10px] text-slate-400 font-medium hidden md:inline">sec</span>
          </>
        )}
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`p-1 transition-all shrink-0 ${showSettings || isScheduled ? 'text-indigo-500 hover:text-indigo-600' : 'text-slate-400 md:text-slate-300 hover:text-indigo-500 md:opacity-0 md:group-hover:opacity-100'}`}
          aria-label="Slide settings"
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          onClick={() => onRemove(item.id)}
          disabled={isViewer}
          title={isViewer ? 'Read-only — viewer role' : 'Remove'}
          className="p-1 text-slate-400 md:text-slate-300 hover:text-red-500 md:opacity-0 md:group-hover:opacity-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          aria-label="Remove slide"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {showSettings && (
        <div className="border-t border-slate-100 bg-slate-50/50 p-4">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Slide Scheduling</p>
          <p className="text-[10px] text-slate-400 mb-3">If scheduled is set, this slide will ONLY play during the specified limits. Otherwise it plays all day.</p>
          
          <div className="flex gap-2 mb-3">
            <button onClick={() => onUpdate(item.id, { daysOfWeek: null, timeStart: null, timeEnd: null })} className={`px-3 py-1.5 text-[10px] font-semibold rounded-lg border transition-colors ${!isScheduled ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'border-slate-200 text-slate-400 bg-white hover:bg-slate-50'}`}>Always Show</button>
            <button onClick={() => { if (!isScheduled) onUpdate(item.id, { timeStart: '08:00', timeEnd: '12:00' }); }} className={`px-3 py-1.5 text-[10px] font-semibold rounded-lg border transition-colors ${isScheduled ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-400 bg-white hover:bg-slate-50'}`}>Scheduled Block</button>
          </div>

          {isScheduled && (
            <div className="space-y-3 bg-white p-3 rounded-lg border border-slate-100">
              <div>
                <p className="text-[10px] font-bold text-slate-400 mb-1">Active Days</p>
                <div className="flex gap-1 flex-wrap">
                  {DAYS.map(d => {
                    const daysArr = item.daysOfWeek ? item.daysOfWeek.split(',') : [...DAYS];
                    const isActive = item.daysOfWeek ? daysArr.includes(d) : true;
                    return (
                      <button key={d} onClick={() => {
                         let nextArr = [...daysArr];
                         if (isActive) nextArr = nextArr.filter(x => x !== d);
                         else nextArr.push(d);
                         
                         if (nextArr.length === 0 || nextArr.length === 7) onUpdate(item.id, { daysOfWeek: null });
                         else onUpdate(item.id, { daysOfWeek: nextArr.join(',') });
                      }}
                      className={`px-2 py-1 text-[10px] font-bold rounded transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                        {d}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label htmlFor={`time-start-${item.id}`} className="text-[10px] font-bold text-slate-400 mb-0.5 block">Start Time (HH:MM)</label>
                  <input id={`time-start-${item.id}`} type="time" value={item.timeStart || ''} onChange={e => onUpdate(item.id, { timeStart: e.target.value || null })} className="w-full px-2 py-1 text-sm font-semibold border border-slate-200 rounded-md" />
                </div>
                <div className="flex-1">
                  <label htmlFor={`time-end-${item.id}`} className="text-[10px] font-bold text-slate-400 mb-0.5 block">End Time (HH:MM)</label>
                  <input id={`time-end-${item.id}`} type="time" value={item.timeEnd || ''} onChange={e => onUpdate(item.id, { timeEnd: e.target.value || null })} className="w-full px-2 py-1 text-sm font-semibold border border-slate-200 rounded-md" />
                </div>
              </div>
            </div>
          )}

          <div className="mt-4 pt-4 border-t border-slate-200/60">
            <label htmlFor={`transition-${item.id}`} className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 block">Slide Transition Effect</label>
            <select
              id={`transition-${item.id}`}
              value={item.transitionType || 'FADE'}
              onChange={(e) => onUpdate(item.id, { transitionType: e.target.value })}
              className="w-full xl:w-1/2 px-2 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
            >
              <option value="NONE">None</option>
              <option value="FADE">Fade</option>
              <option value="SLIDE_LEFT">Slide Left</option>
              <option value="SLIDE_RIGHT">Slide Right</option>
              <option value="SLIDE_UP">Slide Up</option>
              <option value="SLIDE_DOWN">Slide Down</option>
            </select>
          </div>

          {/* 2026-05-05 — per-video audio toggle. Only shown for video
              items because images and webpages don't have an audio
              track. Default behavior matches pre-fix: muted=true so
              existing playlists don't unexpectedly start blasting
              sound after the column ships. Operator flips off per
              video they want to play with sound. The Android Player
              kiosk has mediaPlaybackRequiresUserGesture=false so
              unmuted autoplay works there; web preview may show a
              paused first frame if Chrome blocks autoplay-with-sound. */}
          {item.asset?.mimeType?.startsWith('video/') && (
            <div className="mt-4 pt-4 border-t border-slate-200/60">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Audio</p>
              <button
                type="button"
                onClick={() => onUpdate(item.id, { muted: !(item.muted === false ? false : true) })}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${item.muted === false ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                title={item.muted === false ? 'Sound on — video plays with audio' : 'Muted — video plays silently'}
              >
                <span className={`inline-flex items-center justify-center w-4 h-4 rounded ${item.muted === false ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                  {item.muted === false ? '♪' : '🔇'}
                </span>
                {item.muted === false ? 'Play with sound' : 'Muted (no audio)'}
              </button>
              <p className="text-[10px] text-slate-400 mt-1.5 leading-snug">
                Default is muted so videos autoplay reliably. Turn on for clips where the audio is the point — announcements, anthems, etc. Kiosk plays normally; browser preview may need a click.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- Dashboard Playlist Card ---
// `layout` decides between the big card (grid view) and the compact row
// (list view). Grid renders per-slide thumbnails under the header so the
// operator can spot "which playlist is this again?" at a glance; list
// mode hides the thumbs to fit more rows per screen — intentionally
// matching the density of the Screens page list mode.
//
// The on/off toggle flips all the playlist's schedules at once via
// PUT /playlists/:id/active. When a playlist has zero schedules we
// deep-link into the editor (onOpen) instead — we can't guess a target
// to schedule to.
function PlaylistCard({ playlist, screenMap, onOpen, onDelete, onToggleActive, togglePending, layout = 'grid', isViewer = false, templateLookup }: {
  playlist: any;
  screenMap: { screens: any[]; groups: any[]; scheduleCount: number; activeCount: number };
  onOpen: () => void;
  onDelete: () => void;
  onToggleActive: (active: boolean) => void;
  togglePending: boolean;
  layout?: 'grid' | 'list';
  isViewer?: boolean;
  /** Map of templateId → zones + bg + dimensions, so the card can
   * render a live template thumbnail without refetching per row.
   * Built by the caller from useTemplates() data. */
  templateLookup?: Record<string, TemplateLookupEntry | undefined>;
}) {
  const isTemplate = !!playlist.template;
  const slideCount = playlist.items?.length || 0;
  const hasScreens = screenMap.screens.length > 0 || screenMap.groups.length > 0;
  const onlineScreens = screenMap.screens.filter((s: any) => s.status === 'ONLINE');
  const hasSchedules = screenMap.scheduleCount > 0;
  // A playlist is "on" when at least one of its schedules is active.
  const isLive = screenMap.activeCount > 0;
  // Content-type label — replaces the old binary "Media" vs "Layout".
  // Operator (2026-05-25): "the words on the playlist descriptions
  // that say media and layout dont make sense ... maybe just say
  // image, video, template, or mixed content for multiple media
  // types". Single source of truth in PlaylistPreviewThumb so the
  // detail header, list row, and tile card stay in sync.
  const contentLabel = derivePlaylistContentLabel(playlist);
  const assignedNames = [
    ...screenMap.screens.map((s: any) => s.name),
    ...screenMap.groups.map((g: any) => g.name),
  ].filter(Boolean);
  const assignmentSummary = assignedNames.length > 0
    ? assignedNames.slice(0, 2).join(', ') + (assignedNames.length > 2 ? ` +${assignedNames.length - 2}` : '')
    : 'Unassigned';
  const creator = creatorLabel(playlist);

  // Click handler for the toggle button. If the playlist has no
  // schedules yet, open the editor so the operator can set one up —
  // we can't flip "active" on a playlist that has nothing to flip.
  const handleToggleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasSchedules) { onOpen(); return; }
    onToggleActive(!isLive);
  };

  if (layout === 'list') {
    return (
      <div className="group relative bg-white rounded-2xl border border-slate-100 hover:border-indigo-200 hover:shadow-[0_4px_20px_rgba(99,102,241,0.06)] transition-all overflow-hidden">
        <button
          onClick={onOpen}
          aria-label={`Open playlist ${playlist.name}`}
          className="absolute inset-0 w-full h-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 z-0"
        />
        <div className="relative z-10 flex items-center gap-4 px-4 py-3 pointer-events-none">
          {/* Mini thumbnail (operator: "add mini previews when we
              switch it from tile mode to list mode...we still have
              room for small thumbnails"). Replaces the old colored
              accent bar with the actual content. Sized 56×40 so the
              row height stays compact. */}
          <PlaylistPreviewThumb
            playlist={playlist}
            templateLookup={templateLookup}
            size="list"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-800 truncate">{playlist.name}</h3>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${isTemplate ? 'bg-violet-100 text-violet-600' : 'bg-indigo-100 text-indigo-600'}`}>
                {contentLabel}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-400">
              <span>{isTemplate ? `${playlist.template.screenWidth}×${playlist.template.screenHeight}` : `${slideCount} slide${slideCount !== 1 ? 's' : ''}`}</span>
              <span className="truncate max-w-36" title={creator}>{creator}</span>
              <span>Updated {fmtPlaylistDate(playlist.updatedAt || playlist.createdAt)}</span>
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="w-3 h-3" />
                {screenMap.activeCount}/{screenMap.scheduleCount || 0}
              </span>
              {hasScreens && (
                <span className="inline-flex items-center gap-1">
                  <Monitor className="w-3 h-3" />
                  {onlineScreens.length}/{screenMap.screens.length} online
                </span>
              )}
            </div>
          </div>
          {/* Live chip */}
          <div className="shrink-0 pointer-events-auto">
            {hasSchedules ? (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${isLive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {isLive ? '● Live' : '○ Off'}
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-amber-50 text-amber-600">Unscheduled</span>
            )}
          </div>
          {/* On/off toggle */}
          <button
            onClick={handleToggleClick}
            disabled={togglePending || isViewer}
            title={isViewer ? 'Read-only — viewer role' : (hasSchedules ? (isLive ? 'Turn playlist off — pauses all schedules' : 'Turn playlist on — activates all schedules') : 'Set a schedule first')}
            aria-label={isLive ? 'Turn off' : 'Turn on'}
            className={`relative z-10 shrink-0 inline-flex items-center h-6 w-11 rounded-full transition-colors pointer-events-auto ${isLive ? 'bg-emerald-500' : 'bg-slate-300'} ${togglePending ? 'opacity-50' : ''} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <span className={`inline-block w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${isLive ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            disabled={isViewer}
            title={isViewer ? 'Read-only — viewer role' : undefined}
            aria-label={`Delete playlist ${playlist.name}`}
            className="relative z-10 shrink-0 p-1.5 rounded-lg text-slate-200 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all pointer-events-auto disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <ChevronRight className="shrink-0 w-4 h-4 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all" />
        </div>
      </div>
    );
  }

  // Grid view (default)
  return (
    <div className="group relative bg-white rounded-2xl border border-slate-100 hover:border-indigo-200 hover:shadow-[0_8px_30px_rgba(99,102,241,0.08)] transition-all duration-300 overflow-hidden">
      <button
        onClick={onOpen}
        aria-label={`Open playlist ${playlist.name}`}
        className="absolute inset-0 w-full h-full cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 z-0"
      />
      {/* Top accent bar */}
      <div className={`h-1 ${isTemplate ? 'bg-gradient-to-r from-violet-500 to-purple-500' : hasScreens ? 'bg-gradient-to-r from-emerald-400 to-teal-400' : 'bg-slate-200'}`} />

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-bold text-slate-800 truncate">{playlist.name}</h3>
              {hasSchedules && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider ${isLive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {isLive ? '● Live' : '○ Off'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                isTemplate
                  ? 'bg-violet-100 text-violet-600'
                  : 'bg-indigo-100 text-indigo-600'
              }`}>
                {contentLabel}
              </span>
              <span className="text-[10px] text-slate-400">
                {isTemplate
                  ? `${playlist.template.screenWidth}x${playlist.template.screenHeight}`
                  : `${slideCount} slide${slideCount !== 1 ? 's' : ''}`
                }
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
              <span className="truncate max-w-44" title={creator}>By {creator}</span>
              <span>Created {fmtPlaylistDate(playlist.createdAt)}</span>
              <span>Updated {fmtPlaylistDate(playlist.updatedAt || playlist.createdAt)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {/* On/off toggle — always visible on the card so the
                operator doesn't have to drill in to flip state. */}
            <button
              onClick={handleToggleClick}
              disabled={togglePending || isViewer}
              title={isViewer ? 'Read-only — viewer role' : (hasSchedules ? (isLive ? 'Turn playlist off — pauses all schedules' : 'Turn playlist on — activates all schedules') : 'Set a schedule first — opens editor')}
              aria-label={isLive ? 'Turn off' : 'Turn on'}
              className={`relative z-10 shrink-0 inline-flex items-center h-6 w-11 rounded-full transition-colors ${isLive ? 'bg-emerald-500' : hasSchedules ? 'bg-slate-300' : 'bg-amber-200'} ${togglePending ? 'opacity-50' : ''} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <span className={`inline-block w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${isLive ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              disabled={isViewer}
              title={isViewer ? 'Read-only — viewer role' : undefined}
              aria-label={`Delete playlist ${playlist.name}`}
              className="relative z-10 p-1.5 rounded-lg text-slate-200 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Hero preview thumbnail (operator 2026-05-25: "playlists
            should all have a preview, even a custom template should
            give a preview in the playlist...and if its multiple
            images, a slow scroll thru them would be really nice").
            Single component handles all variants: cross-fade
            slideshow for image playlists ≥2, first-frame for video,
            live ScaledTemplateThumbnail render for templates, 2×2
            grid for mixed content. Pauses when offscreen and on
            prefers-reduced-motion. Previously: a flat 4-thumb strip
            shown only for asset (non-template) playlists; templates
            had no preview at all. */}
        <div className="mb-3">
          <PlaylistPreviewThumb
            playlist={playlist}
            templateLookup={templateLookup}
            size="tile"
          />
        </div>

        {/* Screen Assignments — the hero section */}
        <div className="mt-1">
          {hasScreens ? (
            <div className="space-y-1.5">
              {/* Individual screens with status */}
              {screenMap.screens.map((screen: any) => (
                <div key={screen.id} className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg bg-slate-50/80">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${screen.status === 'ONLINE' ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]' : 'bg-slate-300'}`} />
                  <Monitor className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="text-[11px] font-medium text-slate-600 truncate">{screen.name}</span>
                  <span className={`text-[9px] font-bold ml-auto shrink-0 ${screen.status === 'ONLINE' ? 'text-emerald-600' : 'text-slate-400'}`}>
                    {screen.status === 'ONLINE' ? 'LIVE' : 'OFF'}
                  </span>
                </div>
              ))}
              {/* Screen groups */}
              {screenMap.groups.map((group: any) => (
                <div key={group.id} className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg bg-slate-50/80">
                  <span className="w-2 h-2 rounded-full shrink-0 bg-sky-400" />
                  <Layers className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="text-[11px] font-medium text-slate-600 truncate">{group.name}</span>
                  <span className="text-[9px] font-bold text-sky-600 ml-auto shrink-0">{group.screenCount} screen{group.screenCount !== 1 ? 's' : ''}</span>
                </div>
              ))}
              {/* Schedule summary */}
              <div className="flex items-center gap-1.5 mt-1 pt-1.5 border-t border-slate-100">
                <CalendarDays className="w-3 h-3 text-slate-400" />
                <span className="text-[10px] text-slate-400">
                  {screenMap.activeCount} active schedule{screenMap.activeCount !== 1 ? 's' : ''}
                  {screenMap.scheduleCount > screenMap.activeCount && ` (${screenMap.scheduleCount - screenMap.activeCount} paused)`}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-3 px-3 rounded-lg bg-amber-50/60 border border-amber-100/60">
              <WifiOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="text-[11px] text-amber-600 font-medium">Not assigned to any screen</span>
            </div>
          )}
        </div>
      </div>

      {/* Footer — click prompt */}
      <div className="px-5 py-2.5 border-t border-slate-50 bg-slate-50/30 flex items-center justify-between">
        <span className="text-[10px] text-slate-400 font-medium truncate" title={assignmentSummary}>
          {screenMap.scheduleCount > 0
            ? `${assignmentSummary} - ${onlineScreens.length} screen${onlineScreens.length !== 1 ? 's' : ''} online`
            : 'No schedules'
          }
        </span>
        <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-indigo-500 group-hover:translate-x-0.5 transition-all" />
      </div>
    </div>
  );
}

// --- Main page ---
export default function PlaylistsPage() {
  const { data: playlists, isLoading, isError, refetch } = usePlaylists();
  const { data: assets } = useAssets();
  const { data: folders } = useAssetFolders();
  const { data: screenGroups } = useScreenGroups();
  const { data: schedules } = useSchedules();
  const { data: screens } = useScreens();
  const { data: templates } = useTemplates();
  const createPlaylist = useCreatePlaylist();
  const deletePlaylist = useDeletePlaylist();
  const saveItems = useReorderPlaylistItems();
  const createSchedule = useCreateSchedule();
  const deleteSchedule = useDeleteSchedule();
  const toggleSchedule = useToggleSchedule();
  const updateSchedule = useUpdateSchedule();
  const setPlaylistActive = useSetPlaylistActive();

  // Grid (tile) vs list (compact row) view — persisted per-tab in
  // sessionStorage so a refresh doesn't reset the operator's choice.
  // Matches the Screens page pattern.
  const [playlistView, setPlaylistView] = useState<'grid' | 'list'>('grid');
  const [playlistSort, setPlaylistSort] = useState<PlaylistSort>('latest');
  const [playlistSearch, setPlaylistSearch] = useState('');
  const [creatorFilter, setCreatorFilter] = useState('all');
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>('all');
  const [targetFilter, setTargetFilter] = useState('all');
  useEffect(() => {
    try {
      const v = sessionStorage.getItem('edu_playlist_view');
      if (v === 'grid' || v === 'list') setPlaylistView(v);
    } catch { /* sessionStorage may be unavailable */ }
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem('edu_playlist_view', playlistView); } catch {}
  }, [playlistView]);

  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(null);
  const [editSchedTarget, setEditSchedTarget] = useState('');
  const [editSchedMode, setEditSchedMode] = useState<'always' | 'scheduled'>('always');
  const [editSchedDays, setEditSchedDays] = useState<string[]>([]);
  const [editSchedTimeStart, setEditSchedTimeStart] = useState('08:00');
  const [editSchedTimeEnd, setEditSchedTimeEnd] = useState('15:00');
  const [publishMode, setPublishMode] = useState<'append' | 'replace'>('replace');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState<'choose' | 'blank' | 'template'>('choose');
  const [showPicker, setShowPicker] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  // Submit-for-review (Sprint 1.5). CONTRIBUTOR role can submit a
  // playlist + its items for admin approval instead of publishing
  // directly. The button only shows for that role.
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitNote, setSubmitNote] = useState('');
  const [submitReviewerIds, setSubmitReviewerIds] = useState<string[]>([]);
  // 2026-05-26 P0-4 — Submit-for-Review must deliver the partner's
  // verbatim ask from CLAUDE.md: "they should be able to add assets,
  // customize templates, then CREATE AND SCHEDULE the playlist." Before
  // this fix the frontend hard-coded `scheduleIds: []` so the schedule
  // half of that sentence never happened — admin approves, playlist
  // never plays. The Submit modal now carries an optional target +
  // schedule-mode picker. If the contributor fills it in, draft
  // Schedule rows are created (isActive=false) and their ids ride
  // along in createSubmission(); the backend's approve handler
  // (submissions.controller.ts) flips them to isActive=true on
  // approval. If left empty, behavior is unchanged — admin picks
  // targets after approval.
  const [submitTargets, setSubmitTargets] = useState<string[]>([]);
  const [submitSchedMode, setSubmitSchedMode] = useState<'always' | 'scheduled'>('always');
  const [submitSchedDays, setSubmitSchedDays] = useState<string[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  const [submitSchedTimeStart, setSubmitSchedTimeStart] = useState<string>('08:00');
  const [submitSchedTimeEnd, setSubmitSchedTimeEnd] = useState<string>('17:00');
  const toggleSubmitTarget = (target: string) =>
    setSubmitTargets((prev) =>
      prev.includes(target) ? prev.filter((t) => t !== target) : [...prev, target],
    );
  const toggleSubmitDay = (day: string) =>
    setSubmitSchedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
    );
  const currentUser = useUIStore((s) => s.user);
  const isContributor = currentUser?.role === 'CONTRIBUTOR';
  const isViewer = currentUser?.role === 'RESTRICTED_VIEWER';
  const { data: tenantUsers } = useUsers();
  const tenantAdmins = (tenantUsers as any[] | undefined)?.filter((u) => u.role === 'SUPER_ADMIN' || u.role === 'DISTRICT_ADMIN' || u.role === 'SCHOOL_ADMIN') || [];
  const createSubmission = useCreateSubmission();
  const handleSubmitForReview = async () => {
    if (!selectedId) return;
    try {
      // Save unsaved items first — same race as publish: empty playlist
      // gets submitted otherwise.
      if (hasChanges) {
        await saveItems.mutateAsync({
          playlistId: selectedId,
          items: localItems.map((item, i) => ({
            assetId: item.assetId || item.asset?.id,
            durationMs: item.durationMs || 10000,
            sequenceOrder: i,
            daysOfWeek: item.daysOfWeek || null,
            timeStart: item.timeStart || null,
            timeEnd: item.timeEnd || null,
            transitionType: item.transitionType || null,
            // 2026-05-05 — only persist `muted` for video items. For
            // images/webpages the column is irrelevant; sending true
            // would still be harmless but we keep it semantic.
            muted: item.asset?.mimeType?.startsWith('video/') ? (item.muted === false ? false : true) : true,
          })),
        });
        setHasChanges(false);
      }
      const assetIds = localItems.map((it: any) => it.assetId || it.asset?.id).filter(Boolean);
      // 2026-05-26 P0-4 — Create draft Schedule rows (isActive=false)
      // for each picked target so the admin's approve flips them live
      // automatically. Empty targets = no schedule pre-staged (admin
      // chooses on approval) — preserves the old behavior. Failures
      // here surface as an error so the contributor doesn't think a
      // schedule was attached when it wasn't.
      const draftScheduleIds: string[] = [];
      if (selectedId && submitTargets.length > 0) {
        const draftScheduleParamsFor = (target: string) => {
          const isGroup = target.startsWith('group-');
          const targetId = target.replace(/^(group-|screen-)/, '');
          return {
            playlistId: selectedId,
            screenGroupId: isGroup ? targetId : undefined,
            screenId: !isGroup ? targetId : undefined,
            startTime: new Date().toISOString(),
            daysOfWeek: submitSchedMode === 'scheduled' ? submitSchedDays.join(',') : undefined,
            timeStart: submitSchedMode === 'scheduled' ? submitSchedTimeStart : undefined,
            timeEnd: submitSchedMode === 'scheduled' ? submitSchedTimeEnd : undefined,
            priority: 0,
            mode: 'ADD' as const,
            // CRITICAL: draft state. Backend's submissions.approve handler
            // (apps/api/src/submissions/submissions.controller.ts:271-273)
            // flips this to true on approval. CONTRIBUTOR can't accidentally
            // publish content live — the gate IS the admin's click.
            isActive: false,
          };
        };
        const results = await Promise.all(
          submitTargets.map((t) => createSchedule.mutateAsync(draftScheduleParamsFor(t) as any)),
        );
        for (const r of results) {
          const id = (r as any)?.id;
          if (typeof id === 'string') draftScheduleIds.push(id);
        }
      }
      await createSubmission.mutateAsync({
        note: submitNote.trim() || undefined,
        notifyUserIds: submitReviewerIds,
        assetIds: Array.from(new Set(assetIds)),
        playlistIds: [selectedId],
        scheduleIds: draftScheduleIds,
      });
      setShowSubmitModal(false);
      setSubmitNote('');
      setSubmitReviewerIds([]);
      setSubmitTargets([]);
      setSubmitSchedMode('always');
      await appAlert({
        title: 'Submitted for review',
        message: draftScheduleIds.length > 0
          ? `Sent to your reviewer with ${draftScheduleIds.length} draft schedule${draftScheduleIds.length === 1 ? '' : 's'}. The schedule${draftScheduleIds.length === 1 ? '' : 's'} will activate automatically when they approve.`
          : 'The reviewer(s) you picked will see it on their Reviews page. You’ll be notified once they approve or send it back.',
        tone: 'info',
        confirmLabel: 'Got it',
      });
    } catch (err: any) {
      await appAlert({
        title: "Couldn't submit for review",
        message: err.message || 'Something went wrong while creating the submission. Please try again.',
        tone: 'danger',
      });
    }
  };
  const [newName, setNewName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // Filter to non-system custom templates for the picker
  const customTemplates = (templates || []).filter((t: any) => !t.isSystem && t.tenantId);
  const [localItems, setLocalItems] = useState<any[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [hasChanges, setHasChanges] = useState(false);
  const [pickerFilter, setPickerFilter] = useState<'all' | 'images' | 'videos' | 'audio' | 'urls'>('all');
  const [pickerFolderId, setPickerFolderId] = useState<string | null>(null);
  const [selectedPickerAssets, setSelectedPickerAssets] = useState<Set<string>>(new Set());
  // Inline-upload from the asset picker (so users don't have to leave the
  // playlist they're building, go to /assets, upload, then come back).
  type PickerUpload = {
    id: string;
    name: string;
    progress: number;
    phase: 'uploading' | 'success' | 'error';
    error?: string;
  };
  const [pickerUploads, setPickerUploads] = useState<PickerUpload[]>([]);
  const [pickerDragOver, setPickerDragOver] = useState(false);
  const pickerFileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'editor' | 'schedules'>('editor');
  const createNameInputRef = useRef<HTMLInputElement>(null);

  // Focus the playlist name input when create form is in naming mode
  useEffect(() => {
    if (showCreate && (createMode === 'blank' || (createMode === 'template' && selectedTemplateId))) {
      createNameInputRef.current?.focus();
    }
  }, [showCreate, createMode, selectedTemplateId]);

  // Schedule form state
  const [schedTargets, setSchedTargets] = useState<string[]>([]);
  const toggleTarget = (t: string) => setSchedTargets(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  const [schedDays, setSchedDays] = useState<string[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  const [schedTimeStart, setSchedTimeStart] = useState('08:00');
  const [schedTimeEnd, setSchedTimeEnd] = useState('15:00');
  // 2026-05-14 — date-range bounds for the schedule itself (separate
  // from timeStart/timeEnd which are time-of-DAY). Operator: "we
  // should have the ability to publish on a specific date, so like
  // from this date to this date and start at this time". When set,
  // the schedule only runs on calendar days between schedStartDate
  // and schedEndDate (inclusive); when empty, falls back to current
  // behavior (starts now, never ends). Format: YYYY-MM-DD from the
  // native <input type="date"> picker.
  const [schedStartDate, setSchedStartDate] = useState<string>('');
  const [schedEndDate, setSchedEndDate] = useState<string>('');
  const [schedMode, setSchedMode] = useState<'always' | 'scheduled'>('always');
  // 2026-05-05 — schedule-level audio override picked at publish time.
  // true  = force every video on this schedule muted
  // false = force every video on this schedule unmuted
  // Sent as schedule.mutedOverride to the API; manifest resolver
  // applies this BEFORE per-item PlaylistItem.muted. Defaults true
  // (mute) to match the prior always-muted behavior — operator flips
  // off when they want sound on the targeted screens.
  const [schedMuted, setSchedMuted] = useState<boolean>(true);

  const selectedPlaylist = playlists?.find((p: any) => p.id === selectedId);
  const playlistSchedules = (schedules || []).filter((s: any) => s.playlistId === selectedId);

  // --- Build playlist → screen mapping for dashboard cards ---
  const playlistScreenMap = useMemo(() => {
    const map: Record<string, { screens: any[]; groups: any[]; scheduleCount: number; activeCount: number }> = {};
    if (!playlists) return map;
    const screenLookup = new Map((screens || []).map((s: any) => [s.id, s]));
    const groupLookup = new Map((screenGroups || []).map((g: any) => [g.id, g]));

    for (const pl of playlists) {
      const plSchedules = (schedules || []).filter((s: any) => s.playlistId === pl.id);
      const screenSet = new Map<string, any>();
      const groupSet = new Map<string, any>();

      for (const sched of plSchedules) {
        // Direct screen assignment
        if (sched.screenId) {
          const liveScreen = screenLookup.get(sched.screenId) || sched.screen;
          if (liveScreen) screenSet.set(sched.screenId, liveScreen);
        }
        // Screen group assignment — expand to individual screens
        if (sched.screenGroupId) {
          const liveGroup = groupLookup.get(sched.screenGroupId) || sched.screenGroup;
          if (!liveGroup) continue;
          groupSet.set(sched.screenGroupId, {
            ...liveGroup,
            screenCount: liveGroup.screens?.length || 0,
          });
          // Also add individual screens from the group
          if (liveGroup.screens) {
            for (const s of liveGroup.screens) {
              screenSet.set(s.id, s);
            }
          }
        }
      }

      map[pl.id] = {
        screens: Array.from(screenSet.values()),
        groups: Array.from(groupSet.values()),
        scheduleCount: plSchedules.length,
        activeCount: plSchedules.filter((s: any) => s.isActive).length,
      };
    }
    return map;
  }, [playlists, schedules, screens, screenGroups]);

  // Template → zone-rich lookup so PlaylistCard can render a live
  // ScaledTemplateThumbnail for template-based playlists without
  // refetching per row. The /templates list endpoint already returns
  // zones + bg + dimensions (see templates.controller.ts list()),
  // and useTemplates() is called once at the page level — this just
  // reshapes it into a Map for O(1) lookup by the cards.
  const templateLookup = useMemo<Record<string, TemplateLookupEntry | undefined>>(() => {
    const map: Record<string, TemplateLookupEntry | undefined> = {};
    for (const t of (templates as any[] | undefined) || []) {
      if (!t?.id) continue;
      map[t.id] = {
        zones: t.zones || [],
        screenWidth: t.screenWidth || 1920,
        screenHeight: t.screenHeight || 1080,
        bgImage: t.bgImage || null,
        bgGradient: t.bgGradient || null,
        bgColor: t.bgColor || null,
      };
    }
    return map;
  }, [templates]);

  // --- Quick stats ---
  const totalScreensOnline = (screens || []).filter((s: any) => s.status === 'ONLINE').length;
  const totalScreens = (screens || []).length;
  const activeSchedules = (schedules || []).filter((s: any) => s.isActive).length;
  const unassignedPlaylists = (playlists || []).filter((pl: any) => {
    const m = playlistScreenMap[pl.id];
    return !m || m.scheduleCount === 0;
  }).length;
  const creatorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const pl of playlists || []) {
      if (pl.createdBy?.id && pl.createdBy?.email) seen.set(pl.createdBy.id, pl.createdBy.email);
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [playlists]);
  const displayedPlaylists = useMemo(() => {
    const q = playlistSearch.trim().toLowerCase();
    const list = (playlists || []).filter((pl: any) => {
      const map = playlistScreenMap[pl.id] || { screens: [], groups: [], scheduleCount: 0, activeCount: 0 };
      const creator = creatorLabel(pl);
      const assignmentNames = [
        ...map.screens.map((s: any) => s.name),
        ...map.groups.map((g: any) => g.name),
      ].filter(Boolean);

      if (q) {
        const haystack = [pl.name, creator, ...assignmentNames].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      if (creatorFilter === 'me' && pl.createdBy?.id !== currentUser?.id) return false;
      if (creatorFilter === 'others' && (!pl.createdBy?.id || pl.createdBy.id === currentUser?.id)) return false;
      if (creatorFilter.startsWith('user:') && pl.createdBy?.id !== creatorFilter.slice(5)) return false;
      if (assignmentFilter === 'assigned' && map.scheduleCount === 0) return false;
      if (assignmentFilter === 'unassigned' && map.scheduleCount > 0) return false;
      if (targetFilter.startsWith('screen:') && !map.screens.some((s: any) => s.id === targetFilter.slice(7))) return false;
      if (targetFilter.startsWith('group:') && !map.groups.some((g: any) => g.id === targetFilter.slice(6))) return false;

      return true;
    });

    return [...list].sort((a: any, b: any) => {
      const mapA = playlistScreenMap[a.id] || { screens: [], groups: [] };
      const mapB = playlistScreenMap[b.id] || { screens: [], groups: [] };
      const assignedA = [...mapA.screens, ...mapA.groups].map((x: any) => x.name).filter(Boolean).sort()[0] || '';
      const assignedB = [...mapB.screens, ...mapB.groups].map((x: any) => x.name).filter(Boolean).sort()[0] || '';
      switch (playlistSort) {
        case 'oldest':
          return playlistStamp(a, 'createdAt') - playlistStamp(b, 'createdAt') || a.name.localeCompare(b.name);
        case 'az':
          return a.name.localeCompare(b.name);
        case 'za':
          return b.name.localeCompare(a.name);
        case 'creator':
          return creatorLabel(a).localeCompare(creatorLabel(b)) || a.name.localeCompare(b.name);
        case 'modified':
          return playlistStamp(b, 'updatedAt') - playlistStamp(a, 'updatedAt') || a.name.localeCompare(b.name);
        case 'assigned':
          return assignedA.localeCompare(assignedB) || a.name.localeCompare(b.name);
        case 'latest':
        default:
          return playlistStamp(b, 'updatedAt') - playlistStamp(a, 'updatedAt') || playlistStamp(b, 'createdAt') - playlistStamp(a, 'createdAt') || a.name.localeCompare(b.name);
      }
    });
  }, [playlists, playlistScreenMap, playlistSearch, creatorFilter, assignmentFilter, targetFilter, playlistSort, currentUser?.id]);

  // Activation constraint so clicks on interactive children (duration
  // input, settings button, checkbox) don't accidentally start a drag.
  // 2026-05-14 — split into separate Mouse + Touch sensors. Previously a
  // single PointerSensor with `distance: 8` handled both, but on iOS that
  // setup loses the race against Safari's built-in long-press handler:
  // the user holds the row, iOS fires its text-selection + copy/lookup
  // /translate context menu, and dnd-kit never gets to start the drag
  // because the user lifts their finger reacting to the unexpected menu.
  // The fix:
  //   - MouseSensor with `distance: 8` — desktop unchanged; a click that
  //     stays put still behaves like a click, drag starts after 8px of
  //     pointer movement.
  //   - TouchSensor with `delay: 150ms` — drag wins against iOS's ~500ms
  //     long-press timeout. 150ms is long enough that an accidental tap
  //     on the grip handle doesn't immediately start a drag, but short
  //     enough that the operator's intentional "press + drag" feels
  //     responsive. `tolerance: 6` allows tiny finger jitter during the
  //     150ms hold without canceling the activation.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleSelect = (pl: any) => {
    setSelectedId(pl.id);
    setLocalItems(pl.items || []);
    setHasChanges(false);
    setTab('editor');
  };

  const handleBack = () => {
    setSelectedId(null);
    setLocalItems([]);
    setHasChanges(false);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setLocalItems((items) => {
        const oi = items.findIndex((i: any) => i.id === active.id);
        const ni = items.findIndex((i: any) => i.id === over.id);
        return arrayMove(items, oi, ni);
      });
      setHasChanges(true);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    const data: { name: string; templateId?: string } = { name: newName };
    if (createMode === 'template' && selectedTemplateId) {
      data.templateId = selectedTemplateId;
    }
    const created = await createPlaylist.mutateAsync(data);
    setNewName('');
    setShowCreate(false);
    setCreateMode('choose');
    setSelectedTemplateId(null);
    handleSelect({ ...created, items: [] });
  };

  const handleAddAsset = (asset: any) => {
    const dur = asset.mimeType?.startsWith('video/') || asset.mimeType?.startsWith('audio/') ? 30000 : 10000;
    const generateId = () => {
      try { return crypto.randomUUID(); } catch { return Math.random().toString(36).substring(2, 10); }
    };
    setLocalItems(prev => [...prev, {
      id: `new-${generateId()}`,
      assetId: asset.id,
      durationMs: dur,
      sequenceOrder: prev.length,
      asset: { id: asset.id, fileUrl: asset.fileUrl, mimeType: asset.mimeType, originalName: asset.originalName },
    }]);
    setHasChanges(true);
  };

  const handleRemove = (id: string) => { setLocalItems(prev => prev.filter(i => i.id !== id)); setSelectedItemIds(prev => { const n = new Set(prev); n.delete(id); return n; }); setHasChanges(true); };
  const handleDuration = (id: string, sec: number) => { setLocalItems(prev => prev.map(i => i.id === id ? { ...i, durationMs: sec * 1000 } : i)); setHasChanges(true); };
  const handleUpdateItem = (id: string, updates: any) => { setLocalItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i)); setHasChanges(true); };
  
  const handleToggleSelect = (id: string) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = (select: boolean) => {
    if (select) setSelectedItemIds(new Set(localItems.map(i => i.id)));
    else setSelectedItemIds(new Set());
  };

  const handleSave = async () => {
    if (!selectedId) return;
    await saveItems.mutateAsync({
      playlistId: selectedId,
      items: localItems.map((item, i) => ({
        assetId: item.assetId || item.asset?.id,
        durationMs: item.durationMs || 10000,
        sequenceOrder: i,
        daysOfWeek: item.daysOfWeek || null,
        timeStart: item.timeStart || null,
        timeEnd: item.timeEnd || null,
        transitionType: item.transitionType || null,
        // 2026-05-05 — see submitForReview comment. Per-video audio
        // toggle: video gets the operator's choice, non-video stays
        // true (column harmless on images).
        muted: item.asset?.mimeType?.startsWith('video/') ? (item.muted === false ? false : true) : true,
      })),
    });
    setHasChanges(false);
  };

  // 2026-05-04 — operator: "when i edit a playlist and add a new
  // screen to it, it makes me hit publish 3 times before it
  // publishes, its like each time i hit its saving or adding
  // instead of doing it all in one button push of publish".
  //
  // Cause: the Publish button's loading state was bound to
  // `createSchedule.isPending` only — but submitSchedule does
  // saveItems FIRST, then createSchedule second. During the
  // saveItems phase (which can take several seconds on a
  // multi-asset playlist), the button STILL says "Publish" with
  // no spinner. Operator clicks again. Each click fires another
  // submitSchedule call. The click flood eventually completes
  // the whole pipeline by accident.
  //
  // Fix: a single `publishSubmitting` flag covers the ENTIRE
  // pipeline (save → schedule loop → state cleanup). Button
  // disabled + "Publishing…" text shows from first click to
  // final completion. Subsequent clicks are dropped.
  const [publishSubmitting, setPublishSubmitting] = useState(false);
  // Unified submit for the Publish/Save modal. `activate=false` = save
  // as a draft (isActive: false server-side). The UI wires two buttons
  // to this function — "Save" (activate=false) and "Publish"
  // (activate=true) — so the operator can stage a schedule ahead of
  // time and then flip it live from the playlist card's on/off toggle.
  const submitSchedule = async (activate: boolean) => {
    if (schedTargets.length === 0) return;
    if (publishSubmitting) return; // dedupe rapid clicks

    // 2026-05-05 — operator: "hitting publish is painfully slow,
    // find out why, i should hit the button and it should publish
    // and not keep me there with the wheel spinning".
    //
    // Two bottlenecks fixed in this rewrite:
    //
    // (1) The for-loop over schedTargets called createSchedule
    //     sequentially. For 2 targets that's 2 round-trips
    //     end-to-end (probably 4-8s on a cold-start Railway pod).
    //     Each createSchedule is independent (different target,
    //     different DB rows) so they can run concurrently. Promise.all
    //     cuts wall-time to ~max(roundtrip), not sum.
    //
    // (2) The modal stayed open with a spinner from the moment the
    //     operator clicked Publish until the LAST mutation resolved.
    //     UX pattern reads as "stuck", reported as "wheel spinning".
    //     Fix: close the modal IMMEDIATELY after click, advance to
    //     Schedules tab, and run the mutation pipeline in the
    //     background. The publishSubmitting flag still prevents
    //     concurrent re-clicks but the operator's screen is no
    //     longer hostage to the round-trip.
    //
    // Failure handling: if anything in the background pipeline
    // throws (saveItems hangs, createSchedule rejects), surface
    // an appAlert pointing the operator at the Schedules tab to
    // verify and retry. Partial success (1 of 2 schedules created)
    // shows up in the schedule list immediately because each
    // createSchedule's onSuccess refetches.

    // Capture inputs before we clear the modal state — the optimistic
    // close path resets schedTargets etc. for the next time the modal
    // opens, but the in-flight pipeline still needs the snapshot.
    const targets = [...schedTargets];
    const playlistId = selectedId;
    const editId = editingScheduleId;
    const itemsSnapshot = localItems.map((item, i) => ({
      assetId: item.assetId || item.asset?.id,
      durationMs: item.durationMs || 10000,
      sequenceOrder: i,
      daysOfWeek: item.daysOfWeek || null,
      timeStart: item.timeStart || null,
      timeEnd: item.timeEnd || null,
      transitionType: item.transitionType || null,
      muted: item.asset?.mimeType?.startsWith('video/')
        ? (item.muted === false ? false : true)
        : true,
    }));
    const needsSave = hasChanges;
    const scheduleParamsFor = (target: string) => {
      const isGroup = target.startsWith('group-');
      const targetId = target.replace(/^(group-|screen-)/, '');
      // 2026-05-14 — surface the operator-picked date range. If
      // schedStartDate is unset, default to "now" (current behavior).
      // If set, combine with the time-of-day start (or 00:00) so the
      // schedule activates at the exact moment requested. Same for
      // end: combined with time-of-day end (or 23:59) so the last
      // day plays through to its time window end.
      const computeStartTime = (): string => {
        if (!schedStartDate) return new Date().toISOString();
        const tod = (schedMode === 'scheduled' && schedTimeStart) || '00:00';
        return new Date(`${schedStartDate}T${tod}:00`).toISOString();
      };
      const computeEndTime = (): string | undefined => {
        if (!schedEndDate) return undefined;
        const tod = (schedMode === 'scheduled' && schedTimeEnd) || '23:59';
        return new Date(`${schedEndDate}T${tod}:59`).toISOString();
      };
      return {
        playlistId: playlistId!,
        screenGroupId: isGroup ? targetId : undefined,
        screenId: !isGroup ? targetId : undefined,
        startTime: computeStartTime(),
        endTime: computeEndTime(),
        daysOfWeek: schedMode === 'scheduled' ? schedDays.join(',') : undefined,
        timeStart: schedMode === 'scheduled' ? schedTimeStart : undefined,
        timeEnd: schedMode === 'scheduled' ? schedTimeEnd : undefined,
        priority: 0,
        mode: publishMode,
        mutedOverride: schedMuted,
        isActive: activate,
      } as const;
    };

    // OPTIMISTIC CLOSE: operator's modal disappears within the React
    // tick. publishSubmitting stays true so a second click anywhere
    // is still a no-op until the pipeline drains.
    setPublishSubmitting(true);
    setShowPublishModal(false);
    setSchedTargets([]);
    setTab('schedules');
    if (editId) setEditingScheduleId(null);

    // Run the actual work asynchronously.
    (async () => {
      try {
        // CRITICAL: persist playlist items BEFORE creating schedules.
        // Empty-playlist races put screens on the splash. If save
        // fails we abort BEFORE scheduling so we never schedule an
        // empty playlist.
        if (needsSave && playlistId) {
          try {
            await saveItems.mutateAsync({
              playlistId,
              items: itemsSnapshot,
            });
            setHasChanges(false);
          } catch (err) {
            console.error('[playlists] save-before-publish failed:', err);
            await appAlert({
              title: "Couldn't save before publishing",
              message: 'Your playlist edits failed to save, so we stopped before publishing. Reopen the editor, click Save, and try Publish again.',
              tone: 'danger',
              confirmLabel: 'Got it',
            });
            return;
          }
        }

        if (editId) {
          // Edit mode: drop the original, recreate per target. The
          // delete is awaited first because the parallel creates
          // would otherwise race with it on dedupeKey.
          await deleteSchedule.mutateAsync(editId);
          await Promise.all(
            targets.map((t) => createSchedule.mutateAsync(scheduleParamsFor(t))),
          );
        } else {
          if (!playlistId) return;
          await Promise.all(
            targets.map((t) => createSchedule.mutateAsync(scheduleParamsFor(t))),
          );
        }
      } catch (err: any) {
        console.error('[playlists] publish failed:', err);
        await appAlert({
          title: 'Publish encountered an error',
          message: err?.message || 'Some schedules may not have been created. Check the Schedules tab and republish any that are missing.',
          tone: 'danger',
        });
      } finally {
        setPublishSubmitting(false);
      }
    })();
  };

  // Back-compat alias so older call-sites keep working while we migrate.
  const handlePublish = () => submitSchedule(true);
  const handleSaveDraft = () => submitSchedule(false);

  const totalMs = localItems.reduce((a: number, i: any) => a + (i.durationMs || 0), 0);
  const totalDur = `${Math.floor(totalMs / 60000)}m ${Math.round((totalMs % 60000) / 1000)}s`;

  const pickerAssets = (assets || []).filter((a: any) => {
    if (a.folderId !== pickerFolderId) return false;
    if (pickerFilter === 'all') return true;
    if (pickerFilter === 'images') return a.mimeType?.startsWith('image/');
    if (pickerFilter === 'videos') return a.mimeType?.startsWith('video/');
    if (pickerFilter === 'audio') return a.mimeType?.startsWith('audio/');
    if (pickerFilter === 'urls') return a.mimeType === 'text/html';
    return true;
  });

  const pickerCurrentFolderChildren = (folders || []).filter((f: any) => f.parentId === pickerFolderId);
  const pickerCurrentFolder = pickerFolderId ? (folders || []).find((f: any) => f.id === pickerFolderId) : null;
  const pickerBreadcrumbs: { id: string | null; name: string }[] = [{ id: null, name: 'All Files' }];
  if (pickerCurrentFolder) {
    const trail: any[] = [];
    let f = pickerCurrentFolder;
    while (f) {
      trail.unshift(f);
      f = f.parentId ? (folders || []).find((x: any) => x.id === f.parentId) : null;
    }
    trail.forEach((t: any) => pickerBreadcrumbs.push({ id: t.id, name: t.name }));
  }

  const handleTogglePickerAsset = (assetId: string) => {
    setSelectedPickerAssets(prev => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  // Inline upload from the asset picker. Files post to the same
  // /assets/upload endpoint the /assets page uses, with the upload's
  // folderId set to whichever folder the picker is currently browsing.
  // On success we (a) invalidate the assets cache so it refetches and
  // (b) auto-select the new asset so "Add Selected" picks it up
  // without an extra click.
  const PICKER_MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB matches /assets

  const handlePickerUploadFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';
    const token = useUIStore.getState().token;
    const folderId = pickerFolderId; // capture current folder for the batch
    const genId = () => { try { return crypto.randomUUID(); } catch { return Math.random().toString(36).substring(2, 10); } };

    const newItems: PickerUpload[] = Array.from(files).map(file => ({
      id: genId(),
      name: file.name,
      progress: 0,
      phase: file.size > PICKER_MAX_FILE_SIZE ? 'error' : 'uploading',
      error: file.size > PICKER_MAX_FILE_SIZE ? `Too large (${Math.round(file.size / (1024 * 1024))}MB > 50MB cap)` : undefined,
    }));
    setPickerUploads(prev => [...newItems, ...prev]);

    Array.from(files).forEach((file, i) => {
      const item = newItems[i];
      if (item.phase === 'error') return;
      const fd = new FormData();
      fd.append('file', file);
      if (folderId) fd.append('folderId', folderId);
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = e => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded * 100) / e.total);
        setPickerUploads(prev => prev.map(u => (u.id === item.id ? { ...u, progress: pct } : u)));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setPickerUploads(prev => prev.map(u => (u.id === item.id ? { ...u, progress: 100, phase: 'success' } : u)));
          // Refetch assets and pre-select the freshly-uploaded one so
          // the user can hit "Add Selected" right away.
          try {
            const resp = JSON.parse(xhr.responseText);
            if (resp?.id) {
              setSelectedPickerAssets(prev => new Set(prev).add(resp.id));
            }
          } catch { /* server didn't return JSON, just refetch */ }
          queryClient.invalidateQueries({ queryKey: ['assets'] });
          // Sweep this row out after a short success flash.
          setTimeout(() => {
            setPickerUploads(prev => prev.filter(u => u.id !== item.id));
          }, 1500);
        } else {
          let msg = `Upload failed (${xhr.status})`;
          try { const r = JSON.parse(xhr.responseText); msg = r.message || msg; } catch {}
          setPickerUploads(prev => prev.map(u => (u.id === item.id ? { ...u, phase: 'error', error: msg } : u)));
        }
      };
      xhr.onerror = () => {
        setPickerUploads(prev => prev.map(u => (u.id === item.id ? { ...u, phase: 'error', error: 'Network error' } : u)));
      };
      xhr.open('POST', `${apiUrl}/assets/upload`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(fd);
    });
  };

  const handleSelectAllPickerAssets = () => {
    if (selectedPickerAssets.size === pickerAssets.length && pickerAssets.length > 0) {
      setSelectedPickerAssets(new Set()); // Deselect all
    } else {
      setSelectedPickerAssets(new Set(pickerAssets.map((a: any) => a.id))); // Select all
    }
  };

  const handleBulkAddPickerAssets = () => {
    if (selectedPickerAssets.size === 0) return;
    const toAdd = (assets || []).filter((a: any) => selectedPickerAssets.has(a.id));
    
    setLocalItems(prev => {
      const newItems = [...prev];
      for (const asset of toAdd) {
        const dur = asset.mimeType?.startsWith('video/') || asset.mimeType?.startsWith('audio/') ? 30000 : 10000;
        const generateId = () => { try { return crypto.randomUUID(); } catch { return Math.random().toString(36).substring(2, 10); } };
        newItems.push({
          id: `new-${generateId()}`,
          assetId: asset.id,
          durationMs: dur,
          sequenceOrder: newItems.length,
          asset: { id: asset.id, fileUrl: asset.fileUrl, mimeType: asset.mimeType, originalName: asset.originalName },
        });
      }
      return newItems;
    });
    setHasChanges(true);
    setSelectedPickerAssets(new Set());
    setShowPicker(false);
  };

  // ─── DETAIL / EDITOR VIEW ───
  if (selectedId && selectedPlaylist) {
    return (
      <div className="space-y-6">
        {/* Back + header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-3">
            <button onClick={handleBack} className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-slate-800">{selectedPlaylist.name}</h1>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                  selectedPlaylist.template ? 'bg-violet-100 text-violet-600' : 'bg-indigo-100 text-indigo-600'
                }`}>
                  {derivePlaylistContentLabel(selectedPlaylist)}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {selectedPlaylist.template
                  ? `${selectedPlaylist.template.screenWidth}x${selectedPlaylist.template.screenHeight} template`
                  : `${localItems.length} slides · ${totalDur}`
                }
                {playlistSchedules.length > 0 && ` · ${playlistSchedules.filter((s: any) => s.isActive).length} active schedule${playlistSchedules.filter((s: any) => s.isActive).length !== 1 ? 's' : ''}`}
              </p>
            </div>
          </div>
          {/* 2026-05-14 — action row was a single non-wrapping flex
              which jammed the buttons into hard-to-read wrapped text
              on phone-width viewports (operator screenshot showed
              "Add Media" wrapping mid-word). flex-wrap + justify-end
              lets the buttons reflow gracefully. Each button now has
              `whitespace-nowrap` so the labels themselves don't break
              mid-text, AND `flex-1 md:flex-initial` on the primary
              action so the Schedule/Submit button claims the full
              available row width on mobile (the operator's main
              destination button after editing). */}
          <div className="flex flex-wrap gap-2 justify-end">
            {tab === 'editor' && !selectedPlaylist.template && (
              <>
                <button
                  onClick={() => setShowPicker(true)}
                  disabled={isViewer}
                  title={isViewer ? 'Read-only — viewer role' : undefined}
                  className="px-3 py-2 md:py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Media
                </button>
                {hasChanges && (
                  <button
                    onClick={handleSave}
                    disabled={saveItems.isPending || isViewer}
                    title={isViewer ? 'Read-only — viewer role' : undefined}
                    className="px-3 py-2 md:py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1 whitespace-nowrap"
                  >
                    <Save className="w-3.5 h-3.5" /> {saveItems.isPending ? 'Saving...' : 'Save'}
                  </button>
                )}
              </>
            )}
            <InlineDownloadButton playlistId={selectedPlaylist.id} playlistName={selectedPlaylist.name} />
            {isContributor ? (
              // CONTRIBUTOR sends to admin queue instead of scheduling
              // directly. Sprint 1.5 workflow.
              <button
                onClick={() => setShowSubmitModal(true)}
                disabled={isViewer}
                title={isViewer ? 'Read-only — viewer role' : undefined}
                className="px-3 py-2 md:py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1 whitespace-nowrap shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckSquare className="w-3.5 h-3.5" /> Submit for Review
              </button>
            ) : (
              <button
                onClick={() => { setEditingScheduleId(null); setSchedTargets([]); setSchedMode('always'); setSchedMuted(true); setShowPublishModal(true); }}
                disabled={isViewer}
                title={isViewer ? 'Read-only — viewer role' : undefined}
                className="px-3 py-2 md:py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg flex items-center justify-center gap-1 whitespace-nowrap shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CalendarDays className="w-3.5 h-3.5" /> Publish
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-slate-100 rounded-xl p-1 w-fit">
          <button onClick={() => setTab('editor')} className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${tab === 'editor' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
            {selectedPlaylist.template ? 'Template' : 'Editor'}
          </button>
          <button onClick={() => setTab('schedules')} className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${tab === 'schedules' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
            Schedules {playlistSchedules.length > 0 && <span className="text-emerald-500 ml-0.5">({playlistSchedules.length})</span>}
          </button>
        </div>

        {/* Content. p-3 on mobile (operator on iPhone screenshot
            showed the 24px p-6 chewing up usable width) → p-6 on
            md+ where there's no width pressure. */}
        <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden min-h-[400px]">
          <div className="p-3 md:p-6">
            {tab === 'editor' && selectedPlaylist.template ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-16 h-16 rounded-2xl bg-violet-100 flex items-center justify-center mb-4">
                  <LayoutTemplate className="w-8 h-8 text-violet-500" />
                </div>
                <h3 className="text-base font-bold text-slate-700">{selectedPlaylist.template.name}</h3>
                <p className="text-xs text-slate-400 mt-1 mb-1">Template-based layout · {selectedPlaylist.template.screenWidth}x{selectedPlaylist.template.screenHeight}</p>
                <span className="text-[10px] font-semibold bg-violet-100 text-violet-600 px-3 py-1 rounded-full uppercase tracking-wider mb-6">
                  {selectedPlaylist.template.category}
                </span>
                <p className="text-xs text-slate-400 max-w-sm mb-6">
                  This playlist uses a multi-zone template layout with live widgets (clock, weather, announcements, etc).
                  Schedule it to your screens using the Schedules tab.
                </p>
                <button
                  onClick={() => {
                    // 2026-05-26 — was navigating to /templates?edit=<id>
                    // (the templates LIST page, which ignored the query
                    // param) instead of the actual builder route. Operator:
                    // "when i click on a playlist and open up the editor
                    // and hit edit template, it takes me to the main template
                    // page and not into the template i just clicked edit on."
                    // The builder route is /[schoolId]/templates/builder/[id].
                    const schoolSlug = window.location.pathname.split('/')[1] || '';
                    window.location.href = `/${schoolSlug}/templates/builder/${selectedPlaylist.template.id}`;
                  }}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit Template
                </button>
              </div>
            ) : tab === 'editor' ? (
              localItems.length > 0 ? (
                <div className="flex flex-col h-full">
                  {/* Bulk Actions Header */}
                  <div className="flex flex-wrap items-center justify-between mb-4 px-2 py-2 bg-slate-50/50 rounded-xl border border-slate-100/50 gap-y-2">
                    <div className="flex items-center gap-3">
                      <input 
                        type="checkbox" 
                        checked={selectedItemIds.size === localItems.length && localItems.length > 0}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer ml-1"
                      />
                      <div className="flex items-center gap-2">
                        <Layers className="w-4 h-4 text-slate-400" />
                        <span className="text-xs font-bold text-slate-600">
                          {selectedItemIds.size > 0 ? `${selectedItemIds.size} selected` : `${localItems.length} items`}
                        </span>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2">
                      {selectedItemIds.size > 0 && (
                        <div className="flex items-center gap-1 bg-white p-1 rounded-lg shadow-sm border border-slate-200/60 mr-2">
                          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mx-2">Assign Block:</span>
                          <select id="bulk-block-select" className="px-2 py-1 text-[10px] font-bold bg-slate-50 border border-slate-100 rounded outline-none w-32">
                            <option value="none">Always Show</option>
                            <option value="08:00|11:59">Breakfast (8a - 12p)</option>
                            <option value="12:00|15:00">Lunch (12p - 3p)</option>
                          </select>
                          <button
                            onClick={() => {
                              const val = (document.getElementById('bulk-block-select') as HTMLSelectElement).value;
                              let updates: any = { timeStart: null, timeEnd: null, daysOfWeek: null };
                              if (val !== 'none') {
                                const [start, end] = val.split('|');
                                updates = { timeStart: start, timeEnd: end };
                              }
                              setLocalItems(prev => prev.map(item => selectedItemIds.has(item.id) ? { ...item, ...updates } : item));
                              setHasChanges(true);
                              document.querySelectorAll('.playlist-item-card').forEach(i => {
                                i.classList.add('ring-2', 'ring-emerald-400', 'bg-emerald-50');
                                setTimeout(() => i.classList.remove('ring-2', 'ring-emerald-400', 'bg-emerald-50'), 400);
                              });
                            }}
                            disabled={isViewer}
                            title={isViewer ? 'Read-only — viewer role' : undefined}
                            className="px-3 py-1 bg-emerald-50 hover:bg-emerald-600 text-emerald-600 hover:text-white text-[10px] font-bold rounded flex items-center transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Apply
                          </button>
                        </div>
                      )}
                      <div className="flex items-center gap-2 bg-white p-1 rounded-lg shadow-sm border border-slate-200/60">
                        <div className="flex items-center pl-2 pr-1 gap-1">
                        <Clock className="w-3.5 h-3.5 text-indigo-400" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mx-1">Set All</span>
                      </div>
                      <input 
                        type="number" 
                        min="1" max="300"
                        id="bulk-time-input"
                        defaultValue="10"
                        className="w-14 px-2 py-1 text-xs bg-slate-50 border border-slate-100 rounded-md text-center font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-400 focus:bg-white transition-all" 
                      />
                      <span className="text-[10px] text-slate-400 font-semibold mr-1">sec</span>
                      <button
                        onClick={() => {
                          const el = document.getElementById('bulk-time-input') as HTMLInputElement;
                          const val = parseInt(el?.value) || 10;
                          setLocalItems(prev => prev.map(item => ({ ...item, durationMs: val * 1000 })));
                          setHasChanges(true);

                          // Optional: Little flash animation on the items to show they updated
                          const items = document.querySelectorAll('.playlist-item-card');
                          items.forEach(item => {
                            item.classList.add('ring-2', 'ring-indigo-400', 'bg-indigo-50');
                            setTimeout(() => item.classList.remove('ring-2', 'ring-indigo-400', 'bg-indigo-50'), 400);
                          });
                        }}
                        disabled={isViewer}
                        title={isViewer ? 'Read-only — viewer role' : undefined}
                        className="px-3 py-1 bg-indigo-50 hover:bg-indigo-600 text-indigo-600 hover:text-white text-[10px] font-bold rounded-md transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                </div>

                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
                    <SortableContext items={localItems.map((s: any) => s.id)} strategy={verticalListSortingStrategy}>
                      <div className="space-y-2">
                        {localItems.map((item: any, i: number) => (
                          <SortableItem key={item.id} item={item} index={i} onRemove={handleRemove} onDurationChange={handleDuration} onUpdate={handleUpdateItem} isSelected={selectedItemIds.has(item.id)} onToggle={handleToggleSelect} isViewer={isViewer} />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Play className="w-10 h-10 text-slate-200 mb-3" />
                  <p className="text-sm font-medium text-slate-400">Empty playlist</p>
                  <p className="text-xs text-slate-300 mt-1 mb-4">Click &quot;Add Media&quot; to add content from your library</p>
                  <button
                    onClick={() => setShowPicker(true)}
                    disabled={isViewer}
                    title={isViewer ? 'Read-only — viewer role' : undefined}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add Media
                  </button>
                </div>
              )
            ) : (
              <div className="space-y-4">
                {playlistSchedules.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <CalendarDays className="w-10 h-10 text-slate-200 mb-3" />
                    <p className="text-sm font-medium text-slate-400">No schedules yet</p>
                    <p className="text-xs text-slate-300 mt-1 mb-4">Publish this playlist to a screen with optional time scheduling</p>
                    <button
                      onClick={() => { setEditingScheduleId(null); setSchedTargets([]); setSchedMode('always'); setSchedMuted(true); setShowPublishModal(true); }}
                      disabled={isViewer}
                      title={isViewer ? 'Read-only — viewer role' : undefined}
                      className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add Schedule
                    </button>
                  </div>
                ) : (
                  playlistSchedules.map((sched: any) => (
                    <div key={sched.id} className={`p-5 rounded-2xl transition-all duration-300 border ${sched.isActive ? 'bg-emerald-50/50 border-emerald-100 hover:bg-emerald-50/80' : 'bg-slate-50 border-slate-100 opacity-60'}`}>
                      {/* ── Read-only Card ── */}
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`w-2 h-2 rounded-full ${sched.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                              <Monitor className="w-3.5 h-3.5 text-slate-400" />
                              <p className="text-sm font-bold text-slate-700">
                                {sched.screenGroup?.name || sched.screen?.name || 'Unknown target'}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2 text-[10px] font-semibold mt-2">
                              {sched.daysOfWeek ? (
                                <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">{sched.daysOfWeek}</span>
                              ) : (
                                <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded">Every day</span>
                              )}
                              {sched.timeStart && sched.timeEnd ? (
                                <span className="bg-sky-100 text-sky-700 px-2 py-0.5 rounded">{sched.timeStart} - {sched.timeEnd}</span>
                              ) : (
                                <span className="bg-sky-100 text-sky-700 px-2 py-0.5 rounded">All day</span>
                              )}
                              {/* 2026-05-05 — audio override pill so the
                                  operator can confirm at a glance whether
                                  this schedule plays sound. Null in DB →
                                  fall back to per-item PlaylistItem.muted
                                  (the morning fix); we surface that as
                                  "Per-video" so it's not mistaken for
                                  forced mute. */}
                              {sched.mutedOverride === false ? (
                                <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded inline-flex items-center gap-1" title="Videos play with sound on this schedule">
                                  ♪ Sound on
                                </span>
                              ) : sched.mutedOverride === true ? (
                                <span className="bg-slate-200 text-slate-600 px-2 py-0.5 rounded inline-flex items-center gap-1" title="Videos play silently on this schedule">
                                  🔇 Muted
                                </span>
                              ) : (
                                <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded" title="Audio decided per video item (default = muted)">
                                  Per-video audio
                                </span>
                              )}
                              <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
                                Since {new Date(sched.startTime).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => {
                                setEditingScheduleId(sched.id);
                                const target = sched.screenGroupId ? `group-${sched.screenGroupId}` : sched.screenId ? `screen-${sched.screenId}` : '';
                                setSchedTargets(target ? [target] : []);
                                setSchedMode(sched.daysOfWeek || sched.timeStart ? 'scheduled' : 'always');
                                setSchedDays(sched.daysOfWeek ? sched.daysOfWeek.split(',') : ['Mon','Tue','Wed','Thu','Fri']);
                                setSchedTimeStart(sched.timeStart || '08:00');
                                setSchedTimeEnd(sched.timeEnd || '15:00');
                                // 2026-05-05 — load saved audio override.
                                // Null in DB → default to true (mute) so the
                                // toggle has a defined state in the UI.
                                setSchedMuted(sched.mutedOverride === false ? false : true);
                                setShowPublishModal(true);
                              }}
                              disabled={isViewer}
                              className="p-1.5 rounded-lg text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              title={isViewer ? 'Read-only — viewer role' : 'Edit schedule'}
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => toggleSchedule.mutate(sched.id)}
                              disabled={isViewer}
                              className={`p-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${sched.isActive ? 'text-emerald-600 hover:bg-emerald-100' : 'text-slate-400 hover:bg-slate-100'}`}
                              title={isViewer ? 'Read-only — viewer role' : (sched.isActive ? 'Pause schedule' : 'Resume schedule')}
                            >
                              <Power className="w-4 h-4" />
                            </button>
                            <button
                              onClick={async () => { if (await appConfirm({ title: 'Delete schedule?', message: 'This schedule will be removed — its playlist stops running on the assigned screens at these times.', tone: 'danger', confirmLabel: 'Delete' })) deleteSchedule.mutate(sched.id); }}
                              disabled={isViewer}
                              title={isViewer ? 'Read-only — viewer role' : undefined}
                              className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* ─── Asset Picker Modal ─── */}
        {showPicker && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Choose Media">
            <button className="absolute inset-0 cursor-default" aria-label="Close dialog" onClick={() => setShowPicker(false)} />
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col relative z-10">
              
              {/* Modal Header */}
              <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-white z-10">
                <div className="flex items-center gap-3">
                  <h3 className="text-base font-bold text-slate-800">Choose Media</h3>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{selectedPickerAssets.size} selected</span>
                </div>
                <div className="flex gap-2">
                  {/* Inline upload — keeps the operator inside the playlist they're building */}
                  <input
                    ref={pickerFileInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={(e) => { handlePickerUploadFiles(e.target.files); if (pickerFileInputRef.current) pickerFileInputRef.current.value = ''; }}
                  />
                  <button
                    onClick={() => pickerFileInputRef.current?.click()}
                    disabled={isViewer}
                    className="px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title={isViewer ? 'Read-only — viewer role' : 'Upload files into this folder without leaving the playlist'}
                  >
                    <Upload className="w-3.5 h-3.5" /> Upload
                  </button>
                  <button onClick={() => setShowPicker(false)} className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={handleBulkAddPickerAssets}
                    disabled={selectedPickerAssets.size === 0}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors shadow-sm"
                  >
                    Add Selected
                  </button>
                </div>
              </div>

              {/* Filter and Breadcrumbs Bar */}
              <div className="px-5 py-3 border-b border-slate-50 bg-slate-50/80 flex flex-col sm:flex-row gap-3 justify-between items-start sm:items-center">
                <div className="flex items-center gap-1 text-[11px]">
                  {pickerBreadcrumbs.map((bc, i) => (
                    <span key={bc.id ?? 'root'} className="flex items-center gap-1">
                      {i > 0 && <ChevronRight className="w-3 h-3 text-slate-300" />}
                      <button
                        onClick={() => setPickerFolderId(bc.id)}
                        className={`px-1.5 py-1 rounded transition-colors ${
                          i === pickerBreadcrumbs.length - 1
                            ? 'font-bold text-slate-800'
                            : 'text-slate-500 hover:text-indigo-600 font-medium'
                        }`}
                      >
                        {i === 0 && <Home className="w-3 h-3 inline mr-1 -mt-0.5 text-slate-400" />}
                        {bc.name}
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2 items-center">
                  <button 
                    onClick={handleSelectAllPickerAssets}
                    className="px-2 py-1 text-[10px] font-bold text-indigo-600 hover:bg-indigo-50 rounded flex items-center gap-1 transition-colors"
                  >
                    <CheckSquare className="w-3 h-3" /> Select All
                  </button>
                  <div className="w-px h-4 bg-slate-200 mx-1"></div>
                  <div className="flex gap-1">
                    {(['all', 'images', 'videos', 'audio', 'urls'] as const).map(f => (
                      <button key={f} onClick={() => setPickerFilter(f)} className={`px-2.5 py-1 text-[10px] font-bold rounded-md ${pickerFilter === f ? 'bg-white text-slate-700 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>
                        {f.charAt(0).toUpperCase() + f.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div
                className={`flex-1 overflow-y-auto p-5 transition-colors ${pickerDragOver ? 'bg-emerald-50/60 ring-2 ring-emerald-300 ring-inset' : 'bg-slate-50/30'}`}
                onDragOver={(e) => { e.preventDefault(); if (!pickerDragOver) setPickerDragOver(true); }}
                onDragLeave={(e) => {
                  // Only clear when actually leaving the body, not just moving over a child.
                  if (e.currentTarget === e.target) setPickerDragOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setPickerDragOver(false);
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    handlePickerUploadFiles(e.dataTransfer.files);
                  }
                }}
              >
                {pickerDragOver && (
                  <div className="mb-4 px-4 py-3 rounded-lg border-2 border-dashed border-emerald-400 bg-white text-center text-xs font-bold text-emerald-700 flex items-center justify-center gap-2">
                    <Upload className="w-4 h-4" /> Drop to upload into {pickerCurrentFolder?.name || 'this folder'}
                  </div>
                )}

                {/* In-flight upload progress strip */}
                {pickerUploads.length > 0 && (
                  <div className="mb-4 space-y-1.5">
                    {pickerUploads.map(u => (
                      <div key={u.id} className="bg-white border border-slate-200 rounded-lg px-3 py-2 flex items-center gap-3 text-xs">
                        {u.phase === 'uploading' && <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin shrink-0" />}
                        {u.phase === 'success' && <CheckSquare className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                        {u.phase === 'error' && <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="font-bold text-slate-700 truncate">{u.name}</div>
                          {u.phase === 'uploading' && (
                            <div className="h-1 bg-slate-100 rounded-full overflow-hidden mt-1">
                              <div className="h-full bg-indigo-500 transition-all" style={{ width: `${u.progress}%` }} />
                            </div>
                          )}
                          {u.phase === 'error' && <div className="text-[11px] text-rose-600 font-medium">{u.error}</div>}
                          {u.phase === 'success' && <div className="text-[11px] text-emerald-600 font-medium">Uploaded — added to selection</div>}
                        </div>
                        {u.phase === 'error' && (
                          <button
                            onClick={() => setPickerUploads(prev => prev.filter(x => x.id !== u.id))}
                            className="text-[10px] font-bold text-slate-400 hover:text-slate-600 px-1.5 py-0.5"
                          >
                            DISMISS
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Folders */}
                {pickerCurrentFolderChildren.length > 0 && Array.isArray(pickerCurrentFolderChildren) && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                    {pickerCurrentFolderChildren.map((f: any) => (
                      <button
                        key={f.id}
                        onClick={() => setPickerFolderId(f.id)}
                        className="group bg-white rounded-xl border border-slate-100 hover:border-indigo-200 hover:shadow-sm transition-all text-left flex items-center gap-2.5 p-3"
                      >
                        <FolderOpen className="w-6 h-6 text-amber-400 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold text-slate-700 truncate">{f.name}</p>
                          <p className="text-[9px] font-medium text-slate-400">{f._count?.assets || 0} items</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                
                {/* Assets */}
                {pickerAssets.length === 0 ? (
                  <div className="text-center py-12 text-sm text-slate-400">No assets in this folder.</div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {pickerAssets.map((asset: any) => {
                      const thumb = thumbUrl(asset);
                      const name = assetName(asset);
                      const isSelected = selectedPickerAssets.has(asset.id);
                      
                      return (
                        <button
                          key={asset.id}
                          onClick={() => handleTogglePickerAsset(asset.id)}
                          aria-pressed={isSelected}
                          aria-label={isSelected ? `Deselect ${name}` : `Select ${name}`}
                          className={`relative rounded-xl border transition-all text-left overflow-hidden group select-none w-full ${
                            isSelected
                              ? 'border-indigo-500 shadow-[0_0_0_2px_rgba(99,102,241,0.2)]'
                              : 'border-slate-200 hover:border-indigo-300 hover:shadow-md'
                          }`}
                        >
                          <div className="aspect-video bg-slate-100 flex items-center justify-center relative overflow-hidden">
                            {thumb ? (
                              <AssetThumb asset={asset} className="w-full h-full object-cover" />
                            ) : (
                              mimeIcon(asset.mimeType, 'w-8 h-8')
                            )}
                            {/* Checkbox overlay */}
                            <div className={`absolute top-2 left-2 w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                              isSelected 
                                ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm scale-110' 
                                : 'bg-white/80 backdrop-blur-sm border-slate-300 text-transparent opacity-0 group-hover:opacity-100'
                            }`}>
                              <CheckSquare className="w-3.5 h-3.5" />
                            </div>
                          </div>
                          <div className={`p-2 transition-colors ${isSelected ? 'bg-indigo-50/50' : 'bg-white'}`}>
                            <p className={`text-[11px] font-bold truncate ${isSelected ? 'text-indigo-900' : 'text-slate-700'}`}>{name}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ─── Submit for Review Modal (CONTRIBUTOR) ─── */}
        {showSubmitModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Submit for review">
            <button className="absolute inset-0 cursor-default" aria-label="Close dialog" onClick={() => setShowSubmitModal(false)} />
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col p-6 relative z-10">
              <h3 className="text-lg font-bold text-slate-800 mb-1">Submit for Review</h3>
              <p className="text-sm text-slate-500 mb-5">
                Send this playlist to an admin for approval. You&rsquo;ll get a notification when they approve or send feedback.
              </p>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Notify reviewer(s)</label>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 mb-4">
                {tenantAdmins.length === 0 ? (
                  <div className="p-3 text-xs text-slate-400">No admins configured for this tenant.</div>
                ) : (
                  tenantAdmins.map((u: any) => {
                    const checked = submitReviewerIds.includes(u.id);
                    return (
                      <label key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer text-xs border-b border-slate-100 last:border-b-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setSubmitReviewerIds((p) => (checked ? p.filter((id) => id !== u.id) : [...p, u.id]))}
                          className="rounded text-indigo-600 focus:ring-indigo-400"
                        />
                        <span className="font-semibold text-slate-700">{u.email}</span>
                        <span className="text-[10px] text-slate-400 uppercase ml-auto">{u.role.replace('_', ' ')}</span>
                      </label>
                    );
                  })
                )}
              </div>
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Note for reviewer (optional)</label>
              <textarea
                value={submitNote}
                onChange={(e) => setSubmitNote(e.target.value)}
                placeholder="Quick context — what is this playlist for, anything to look at first…"
                rows={3}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 mb-4"
              />

              {/* 2026-05-26 P0-4 — Where + when to play (optional).
                  Mirrors the Publish modal's mental model but lighter
                  weight: just targets + always/scheduled. If picked,
                  draft Schedule rows are created with isActive=false
                  and ride along in the submission. Admin's approve
                  flips them live. Empty = admin picks on approval. */}
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                Where should it play? <span className="font-normal normal-case tracking-normal text-slate-400 lowercase">(optional — admin can pick)</span>
              </label>
              <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-200 mb-3">
                {(!screens || screens.length === 0) && (!screenGroups || screenGroups.length === 0) ? (
                  <div className="p-3 text-xs text-slate-400">No screens or groups yet.</div>
                ) : (
                  <>
                    {(screenGroups || []).map((g: any) => (
                      <label key={`group-${g.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer text-xs border-b border-slate-100 last:border-b-0">
                        <input
                          type="checkbox"
                          checked={submitTargets.includes(`group-${g.id}`)}
                          onChange={() => toggleSubmitTarget(`group-${g.id}`)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
                        />
                        <span className="font-semibold text-slate-700">{g.name}</span>
                        <span className="text-[10px] text-slate-400 uppercase ml-auto">Group</span>
                      </label>
                    ))}
                    {(screens || []).map((s: any) => (
                      <label key={`screen-${s.id}`} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer text-xs border-b border-slate-100 last:border-b-0">
                        <input
                          type="checkbox"
                          checked={submitTargets.includes(`screen-${s.id}`)}
                          onChange={() => toggleSubmitTarget(`screen-${s.id}`)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-400"
                        />
                        <span className="font-semibold text-slate-700">{s.name}</span>
                        <span className="text-[10px] text-slate-400 uppercase ml-auto">Screen</span>
                      </label>
                    ))}
                  </>
                )}
              </div>

              {submitTargets.length > 0 && (
                <>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">When?</label>
                  <div className="inline-flex rounded-md bg-slate-100 p-1 mb-3">
                    <button
                      type="button"
                      onClick={() => setSubmitSchedMode('always')}
                      className={`px-3 py-1 text-xs font-semibold rounded ${submitSchedMode === 'always' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}
                    >
                      Always
                    </button>
                    <button
                      type="button"
                      onClick={() => setSubmitSchedMode('scheduled')}
                      className={`px-3 py-1 text-xs font-semibold rounded ${submitSchedMode === 'scheduled' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}
                    >
                      Specific days / hours
                    </button>
                  </div>
                  {submitSchedMode === 'scheduled' && (
                    <div className="mb-3 space-y-2">
                      <div className="flex flex-wrap">
                        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                          <button
                            key={day}
                            type="button"
                            onClick={() => toggleSubmitDay(day)}
                            className={`mr-1 mb-1 px-2.5 py-1 text-[11px] font-semibold rounded ${
                              submitSchedDays.includes(day)
                                ? 'bg-indigo-600 text-white'
                                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                            }`}
                          >
                            {day}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center text-xs text-slate-600">
                        <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mr-2">From</span>
                        <input
                          type="time"
                          value={submitSchedTimeStart}
                          onChange={(e) => setSubmitSchedTimeStart(e.target.value)}
                          className="px-2 py-1 rounded border border-slate-200 bg-white"
                        />
                        <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mx-2">to</span>
                        <input
                          type="time"
                          value={submitSchedTimeEnd}
                          onChange={(e) => setSubmitSchedTimeEnd(e.target.value)}
                          className="px-2 py-1 rounded border border-slate-200 bg-white"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}
              <div className="mb-5" />
              <div className="flex gap-2">
                <button
                  onClick={() => setShowSubmitModal(false)}
                  className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSubmitForReview}
                  disabled={createSubmission.isPending || submitReviewerIds.length === 0 || isViewer}
                  title={isViewer ? 'Read-only — viewer role' : undefined}
                  className="flex-1 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg shadow-sm"
                >
                  {createSubmission.isPending ? 'Submitting…' : 'Submit'}
                </button>
              </div>
              {submitReviewerIds.length === 0 && tenantAdmins.length > 0 && (
                <p className="text-[10px] text-amber-600 mt-2 text-center">Pick at least one reviewer.</p>
              )}
            </div>
          </div>
        )}

        {/* ─── Publish / Schedule Modal ─── */}
        {/* 2026-05-14 — operator: "when i try to schedule to the screen
            and i open the data and time picker it make the mobile app
            cut off thw cancel/save/publish buttons....also the top bar
            is sitting over top of the text on the mobile app".
            Three coordinated fixes:
            1. z-[100] (was z-50) — above the sticky top toolbar (z-20)
               so the toolbar can't paint over the modal header.
            2. flex items-end md:items-center — bottom-sheet on mobile,
               centered modal on desktop (same pattern as other modals
               in the app for consistency).
            3. Three-row layout: sticky header / scrollable body / sticky
               footer. Body has `overflow-y-auto`, footer stays glued to
               the bottom so Cancel / Save / Publish are always visible
               regardless of how tall the body content gets (date picker
               on iOS Safari renders a system sheet that pushes the
               modal taller). Footer also has pb-[env(safe-area-inset-
               bottom)] so it sits above the iPhone home-indicator. */}
        {showPublishModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-end md:items-center justify-center md:p-4 overflow-hidden" role="dialog" aria-modal="true" aria-label="Publish to Screens">
            <button className="absolute inset-0 cursor-default" aria-label="Close dialog" onClick={() => setShowPublishModal(false)} />
            <div className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90dvh] relative z-10 pb-[env(safe-area-inset-bottom)] md:pb-0">
              {/* Drag handle hint on mobile — signals bottom-sheet */}
              <div className="md:hidden flex justify-center pt-2 pb-1" aria-hidden>
                <div className="w-10 h-1 rounded-full bg-slate-300" />
              </div>
              {/* Sticky header */}
              <div className="px-5 md:px-6 pt-4 md:pt-6 pb-3 border-b border-slate-100">
                <h3 className="text-lg font-bold text-slate-800 mb-1">Publish to Screens</h3>
                <p className="text-sm text-slate-500">
                  Schedule <span className="font-bold text-slate-800">{selectedPlaylist?.name}</span> to play on a screen or group.
                </p>
              </div>

              {/* Scrollable body */}
              <div className="flex-1 overflow-y-auto px-5 md:px-6 py-4">

              <div className="mb-4">
                <p className="block text-xs font-semibold text-slate-600 mb-1.5">Publish Targets</p>
                <div className="w-full max-h-48 overflow-y-auto px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none space-y-2">
                  {screenGroups && screenGroups.map((g: any) => (
                    <div key={`g-${g.id}`} className="flex flex-col">
                      <label className="flex items-center gap-2 px-1 py-1 hover:bg-slate-100 rounded cursor-pointer">
                        <input type="checkbox" checked={schedTargets.includes(`group-${g.id}`)} onChange={() => toggleTarget(`group-${g.id}`)} className="rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                        <span className="font-semibold text-slate-700">{g.name} (Entire Group)</span>
                      </label>
                      {g.screens && g.screens.length > 0 && (
                        <div className="ml-5 mt-1 flex flex-col gap-1 border-l-2 border-slate-200 pl-2">
                          {g.screens.map((s: any) => (
                            <label key={`s-${s.id}`} className="flex items-center gap-2 px-1 py-0.5 hover:bg-slate-100 rounded cursor-pointer">
                              <input type="checkbox" checked={schedTargets.includes(`screen-${s.id}`) || schedTargets.includes(`group-${g.id}`)} disabled={schedTargets.includes(`group-${g.id}`)} onChange={() => toggleTarget(`screen-${s.id}`)} className="rounded border-slate-300 text-sky-600 focus:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed" />
                              <span className="text-slate-600">{s.name}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {screens && screens.filter((s:any) => !s.screenGroupId).length > 0 && (
                    <div className="flex flex-col mt-2 pt-2 border-t border-slate-200">
                      <span className="px-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Ungrouped Screens</span>
                      {screens.filter((s:any) => !s.screenGroupId).map((s: any) => (
                        <label key={`s-${s.id}`} className="flex items-center gap-2 px-1 py-1 hover:bg-slate-100 rounded cursor-pointer">
                          <input type="checkbox" checked={schedTargets.includes(`screen-${s.id}`)} onChange={() => toggleTarget(`screen-${s.id}`)} className="rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                          <span className="font-semibold text-slate-700">{s.name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  {(!screenGroups || screenGroups.length === 0) && (!screens || screens.length === 0) && (
                    <p className="text-[10px] text-amber-600 p-1">No screens or groups exist. Pair a device on the Screens page first.</p>
                  )}
                </div>
              </div>

              <div className="mb-4">
                <p className="block text-xs font-semibold text-slate-600 mb-1.5">When to Play</p>
                <div className="flex bg-slate-100 rounded-lg p-0.5">
                  <button
                    onClick={() => setSchedMode('always')}
                    className={`flex-1 px-3 py-2 text-xs font-semibold rounded-md transition-colors ${schedMode === 'always' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}
                  >
                    Always (24/7)
                  </button>
                  <button
                    onClick={() => setSchedMode('scheduled')}
                    className={`flex-1 px-3 py-2 text-xs font-semibold rounded-md transition-colors ${schedMode === 'scheduled' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}
                  >
                    Scheduled
                  </button>
                </div>
              </div>

              {!editingScheduleId && (
                <div className="mb-4">
                  <p className="block text-xs font-semibold text-slate-600 mb-1.5">Conflict Resolution</p>
                  <div className="flex bg-slate-100 rounded-lg p-0.5">
                    <button
                      onClick={() => setPublishMode('replace')}
                      className={`flex-1 px-3 py-2 text-xs font-semibold rounded-md transition-colors ${publishMode === 'replace' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}
                    >
                      Replace All
                    </button>
                    <button
                      onClick={() => setPublishMode('append')}
                      className={`flex-1 px-3 py-2 text-xs font-semibold rounded-md transition-colors ${publishMode === 'append' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}
                    >
                      Append (Combine)
                    </button>
                  </div>
                  {publishMode === 'replace' ? (
                    <p className="text-[10px] text-amber-600 mt-1.5 leading-tight">Removes existing content scheduled to this hardware.</p>
                  ) : (
                    <p className="text-[10px] text-sky-600 mt-1.5 leading-tight">Will play sequentially alongside existing scheduled playlists.</p>
                  )}
                </div>
              )}

              {/* 2026-05-05 — Operator: "there needs to be a section
                  when publishing the content to the screen, put it in
                  the same menu as overwrite or append, have mute
                  playback option on or off". Schedule-level audio
                  override — wins over per-PlaylistItem.muted at
                  manifest-resolve time. Lets operator publish the
                  same playlist muted in the lobby and unmuted in the
                  cafeteria without re-editing the source playlist. */}
              <div className="mb-4">
                <p className="block text-xs font-semibold text-slate-600 mb-1.5">Mute Playback</p>
                <div className="flex bg-slate-100 rounded-lg p-0.5">
                  <button
                    type="button"
                    onClick={() => setSchedMuted(true)}
                    className={`flex-1 px-3 py-2 text-xs font-semibold rounded-md transition-colors ${schedMuted ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}
                  >
                    On (Mute videos)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSchedMuted(false)}
                    className={`flex-1 px-3 py-2 text-xs font-semibold rounded-md transition-colors ${!schedMuted ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}
                  >
                    Off (Play with sound)
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 mt-1.5 leading-tight">
                  {schedMuted
                    ? 'Every video on this schedule plays silent. Safe for hallways, classrooms during instruction, late-night signage.'
                    : 'Every video on this schedule plays with audio. Use for announcements, anthems, pep rallies. Kiosk autoplays normally; web preview may need a click.'}
                </p>
              </div>

              {schedMode === 'scheduled' && (
                <div className="space-y-4 mb-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                  {/* 2026-05-14 — date range. Empty = "starts now, no
                      end date" (legacy behavior). Operator can leave
                      both empty for an always-recurring schedule, or
                      pick a campaign window (e.g. homecoming week). */}
                  <div>
                    <p className="block text-xs font-semibold text-slate-600 mb-2">Date Range <span className="font-normal text-slate-400 italic">(optional)</span></p>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <label htmlFor="sched-date-start" className="sr-only">Start date</label>
                      <input
                        id="sched-date-start"
                        type="date"
                        value={schedStartDate}
                        onChange={e => setSchedStartDate(e.target.value)}
                        min={new Date().toISOString().slice(0, 10)}
                        className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <span className="text-xs text-slate-400 font-semibold text-center sm:px-1">to</span>
                      <label htmlFor="sched-date-end" className="sr-only">End date</label>
                      <input
                        id="sched-date-end"
                        type="date"
                        value={schedEndDate}
                        onChange={e => setSchedEndDate(e.target.value)}
                        min={schedStartDate || new Date().toISOString().slice(0, 10)}
                        className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1.5 leading-tight">
                      {!schedStartDate && !schedEndDate
                        ? 'Starts immediately and runs until you turn the playlist off.'
                        : schedStartDate && !schedEndDate
                          ? `Starts ${new Date(schedStartDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} and runs until you turn it off.`
                          : !schedStartDate && schedEndDate
                            ? `Starts immediately and stops on ${new Date(schedEndDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}.`
                            : `Active ${new Date(schedStartDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} → ${new Date(schedEndDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}.`}
                    </p>
                  </div>
                  <div>
                    <p className="block text-xs font-semibold text-slate-600 mb-2">Days of Week</p>
                    <div className="flex gap-1">
                      {DAYS.map(day => (
                        <button
                          key={day}
                          onClick={() => setSchedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day])}
                          className={`px-2.5 py-1.5 text-[10px] font-bold rounded-lg transition-all ${
                            schedDays.includes(day)
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'bg-white text-slate-400 border border-slate-200 hover:border-indigo-300'
                          }`}
                        >
                          {day}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => setSchedDays(['Mon','Tue','Wed','Thu','Fri'])} className="text-[10px] font-semibold text-indigo-600 hover:underline">Weekdays</button>
                      <button onClick={() => setSchedDays(['Sat','Sun'])} className="text-[10px] font-semibold text-indigo-600 hover:underline">Weekends</button>
                      <button onClick={() => setSchedDays([...DAYS])} className="text-[10px] font-semibold text-indigo-600 hover:underline">Every day</button>
                    </div>
                  </div>
                  <div>
                    <p className="block text-xs font-semibold text-slate-600 mb-2">Time Window</p>
                    <div className="flex items-center gap-2">
                      <label htmlFor="sched-time-start" className="sr-only">Start time</label>
                      <input
                        id="sched-time-start"
                        type="time" value={schedTimeStart} onChange={e => setSchedTimeStart(e.target.value)}
                        className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <span className="text-xs text-slate-400 font-semibold">to</span>
                      <label htmlFor="sched-time-end" className="sr-only">End time</label>
                      <input
                        id="sched-time-end"
                        type="time" value={schedTimeEnd} onChange={e => setSchedTimeEnd(e.target.value)}
                        className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                </div>
              )}

              </div>{/* /scrollable body */}

              {/* Sticky footer — always visible regardless of body
                  scroll position. Buttons stretch flex-1 on mobile so
                  thumb tap targets stay generous; revert to natural
                  width on desktop. */}
              <div className="border-t border-slate-100 bg-slate-50/40 px-5 md:px-6 py-3 flex items-center gap-2 md:gap-3">
                <button
                  onClick={() => setShowPublishModal(false)}
                  className="flex-1 md:flex-initial px-4 py-2.5 text-slate-500 hover:text-slate-800 text-sm font-semibold rounded-lg hover:bg-slate-100 active:bg-slate-200"
                >
                  Cancel
                </button>
                {/* Save = persist schedule as DRAFT (isActive:false).
                    Operator can stage a schedule ahead of time and flip
                    it live later via the on/off toggle on the playlist
                    card. Schedule doesn't displace the currently-
                    running playlist on its target(s) until it's
                    activated. */}
                <button
                  disabled={schedTargets.length === 0 || publishSubmitting || isViewer}
                  onClick={handleSaveDraft}
                  className="flex-1 md:flex-initial px-4 md:px-5 py-2.5 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 text-sm font-bold rounded-lg shadow-sm flex items-center justify-center gap-2"
                  title={isViewer ? 'Read-only — viewer role' : "Save this schedule as a draft — won't go live until you turn the playlist on"}
                >
                  {publishSubmitting ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                  ) : (
                    <><Save className="w-4 h-4" /> Save</>
                  )}
                </button>
                <button
                  disabled={schedTargets.length === 0 || publishSubmitting || isViewer}
                  onClick={handlePublish}
                  title={isViewer ? 'Read-only — viewer role' : undefined}
                  className="flex-1 md:flex-initial px-4 md:px-5 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-bold rounded-lg shadow-sm flex items-center justify-center gap-2"
                >
                  {publishSubmitting ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Publishing…</>
                  ) : (
                    <><CalendarDays className="w-4 h-4" /> Publish</>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── DASHBOARD VIEW ───
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">Playlists</h1>
          <p className="text-sm text-slate-500 mt-0.5">See what&apos;s playing on every screen at a glance.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Tile / Line view toggle — tile shows per-playlist asset
              thumbs, line mode hides them so more rows fit on screen. */}
          <div className="flex border border-slate-200 rounded-lg overflow-hidden" role="group" aria-label="Playlist view mode">
            <button
              onClick={() => setPlaylistView('grid')}
              aria-pressed={playlistView === 'grid'}
              title="Tile view — shows asset thumbnails"
              className={`px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 ${playlistView === 'grid' ? 'bg-slate-100 text-slate-800' : 'bg-white text-slate-400 hover:text-slate-600'}`}
            >
              <Layers className="w-3.5 h-3.5" />
              Tile
            </button>
            <button
              onClick={() => setPlaylistView('list')}
              aria-pressed={playlistView === 'list'}
              title="Line view — more playlists per window"
              className={`px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors flex items-center gap-1.5 border-l border-slate-200 ${playlistView === 'list' ? 'bg-slate-100 text-slate-800' : 'bg-white text-slate-400 hover:text-slate-600'}`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true"><line x1="2" y1="4" x2="14" y2="4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><line x1="2" y1="12" x2="14" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              Line
            </button>
          </div>
          <button
            onClick={() => { setShowCreate(true); setCreateMode('choose'); setNewName(''); setSelectedTemplateId(null); }}
            disabled={isViewer}
            title={isViewer ? 'Read-only — viewer role' : undefined}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" /> New Playlist
          </button>
        </div>
      </div>

      {/* Quick Stats Bar */}
      {playlists && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white rounded-2xl border border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center">
                <Play className="w-3.5 h-3.5 text-indigo-600" />
              </div>
              <span className="text-lg font-bold text-slate-800">{playlists.length}</span>
            </div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Playlists</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Wifi className="w-3.5 h-3.5 text-emerald-600" />
              </div>
              <span className="text-lg font-bold text-slate-800">{totalScreensOnline}<span className="text-sm text-slate-400 font-normal">/{totalScreens}</span></span>
            </div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Screens Online</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-sky-100 flex items-center justify-center">
                <CalendarDays className="w-3.5 h-3.5 text-sky-600" />
              </div>
              <span className="text-lg font-bold text-slate-800">{activeSchedules}</span>
            </div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Active Schedules</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <div className={`w-7 h-7 rounded-lg ${unassignedPlaylists > 0 ? 'bg-amber-100' : 'bg-emerald-100'} flex items-center justify-center`}>
                <WifiOff className={`w-3.5 h-3.5 ${unassignedPlaylists > 0 ? 'text-amber-600' : 'text-emerald-600'}`} />
              </div>
              <span className="text-lg font-bold text-slate-800">{unassignedPlaylists}</span>
            </div>
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Unassigned</p>
          </div>
        </div>
      )}

      {/* Create form — step-based */}
      {playlists && playlists.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 px-4 py-3 flex flex-col gap-3">
          <div className="flex flex-col lg:flex-row gap-3">
            <label className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" />
              <input
                value={playlistSearch}
                onChange={(e) => setPlaylistSearch(e.target.value)}
                placeholder="Search playlist, creator, or screen"
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 lg:w-[720px]">
              <select value={playlistSort} onChange={(e) => setPlaylistSort(e.target.value as PlaylistSort)} className="px-2 py-2 text-xs font-semibold border border-slate-200 rounded-lg bg-white text-slate-600 outline-none">
                <option value="latest">Latest saved</option>
                <option value="oldest">Oldest created</option>
                <option value="az">A to Z</option>
                <option value="za">Z to A</option>
                <option value="creator">Created by</option>
                <option value="modified">Last modified</option>
                <option value="assigned">Assigned screen</option>
              </select>
              <select value={creatorFilter} onChange={(e) => setCreatorFilter(e.target.value)} className="px-2 py-2 text-xs font-semibold border border-slate-200 rounded-lg bg-white text-slate-600 outline-none">
                <option value="all">All creators</option>
                <option value="me">Created by me</option>
                <option value="others">Created by others</option>
                {creatorOptions.map(([id, email]) => (
                  <option key={id} value={`user:${id}`}>{email}</option>
                ))}
              </select>
              <select value={assignmentFilter} onChange={(e) => setAssignmentFilter(e.target.value as AssignmentFilter)} className="px-2 py-2 text-xs font-semibold border border-slate-200 rounded-lg bg-white text-slate-600 outline-none">
                <option value="all">All assignments</option>
                <option value="assigned">Assigned</option>
                <option value="unassigned">Unassigned</option>
              </select>
              <select value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)} className="px-2 py-2 text-xs font-semibold border border-slate-200 rounded-lg bg-white text-slate-600 outline-none">
                <option value="all">All screens</option>
                {(screens || []).map((screen: any) => (
                  <option key={screen.id} value={`screen:${screen.id}`}>{screen.name}</option>
                ))}
                {(screenGroups || []).map((group: any) => (
                  <option key={group.id} value={`group:${group.id}`}>{group.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            <span>{displayedPlaylists.length} of {playlists.length} shown</span>
            {(playlistSearch || creatorFilter !== 'all' || assignmentFilter !== 'all' || targetFilter !== 'all' || playlistSort !== 'latest') && (
              <button
                onClick={() => { setPlaylistSearch(''); setCreatorFilter('all'); setAssignmentFilter('all'); setTargetFilter('all'); setPlaylistSort('latest'); }}
                className="text-indigo-600 hover:text-indigo-700"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          {createMode === 'choose' && (
            <div className="p-5">
              <p className="text-sm font-semibold text-slate-700 mb-3">What kind of playlist?</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button onClick={() => setCreateMode('blank')}
                  className="flex items-start gap-3 p-4 rounded-xl border-2 border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/50 transition-all text-left group">
                  <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0 group-hover:bg-indigo-200 transition-colors">
                    <Play className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-700">Media Playlist</p>
                    <p className="text-xs text-slate-400 mt-0.5">Add images, videos, and web content as slides</p>
                  </div>
                </button>
                <button onClick={() => setCreateMode('template')}
                  className="flex items-start gap-3 p-4 rounded-xl border-2 border-slate-200 hover:border-violet-400 hover:bg-violet-50/50 transition-all text-left group">
                  <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center shrink-0 group-hover:bg-violet-200 transition-colors">
                    <LayoutTemplate className="w-5 h-5 text-violet-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-700">From Template</p>
                    <p className="text-xs text-slate-400 mt-0.5">Use a saved layout with live widgets (clock, weather, etc.)</p>
                  </div>
                </button>
              </div>
              <div className="mt-3 text-right">
                <button onClick={() => setShowCreate(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-600">Cancel</button>
              </div>
            </div>
          )}

          {createMode === 'blank' && (
            <div className="p-5">
              <p className="text-sm font-semibold text-slate-700 mb-3">Name your playlist</p>
              <div className="flex gap-3">
                <input ref={createNameInputRef} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Playlist name..."
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
                <button
                  onClick={handleCreate}
                  disabled={createPlaylist.isPending || !newName.trim() || isViewer}
                  title={isViewer ? 'Read-only — viewer role' : undefined}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg"
                >
                  {createPlaylist.isPending ? 'Creating...' : 'Create'}
                </button>
                <button onClick={() => setCreateMode('choose')} className="px-3 py-2 text-slate-400 hover:text-slate-600 text-sm">Back</button>
              </div>
            </div>
          )}

          {createMode === 'template' && (
            <div className="p-5">
              <p className="text-sm font-semibold text-slate-700 mb-3">
                {selectedTemplateId ? 'Name your playlist' : 'Pick a template'}
              </p>

              {!selectedTemplateId && (
                <>
                  {customTemplates.length === 0 ? (
                    <div className="text-center py-8">
                      <LayoutTemplate className="w-10 h-10 text-slate-200 mx-auto mb-2" />
                      <p className="text-sm text-slate-400">No templates saved yet</p>
                      <p className="text-xs text-slate-300 mt-1">Create one from the Templates page first</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-64 overflow-y-auto">
                      {customTemplates.map((t: any) => (
                        <button key={t.id} onClick={() => { setSelectedTemplateId(t.id); setNewName(t.name); }}
                          className="flex items-center gap-3 p-3 rounded-xl border-2 border-slate-200 hover:border-violet-400 hover:bg-violet-50/30 transition-all text-left">
                          <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center shrink-0">
                            <Layers className="w-4 h-4 text-violet-600" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-700 truncate">{t.name}</p>
                            <p className="text-[10px] text-slate-400">{t.screenWidth}x{t.screenHeight} · {t._count?.zones || t.zones?.length || 0} zones</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 text-right">
                    <button onClick={() => setCreateMode('choose')} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-600">Back</button>
                  </div>
                </>
              )}

              {selectedTemplateId && (
                <div className="flex gap-3">
                  <input ref={createNameInputRef} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Playlist name..."
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500"
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()} />
                  <button
                    onClick={handleCreate}
                    disabled={createPlaylist.isPending || !newName.trim() || isViewer}
                    title={isViewer ? 'Read-only — viewer role' : undefined}
                    className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg"
                  >
                    {createPlaylist.isPending ? 'Creating...' : 'Create'}
                  </button>
                  <button onClick={() => { setSelectedTemplateId(null); setNewName(''); }} className="px-3 py-2 text-slate-400 hover:text-slate-600 text-sm">Back</button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {isLoading && <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>}

      {/* Load error — surface the failure instead of falling through to
          the "No playlists yet" empty state, which would make an outage
          look like a tenant with no playlists. */}
      {isError && !isLoading && !showCreate && (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-2xl border border-slate-100">
          <AlertCircle className="w-12 h-12 text-rose-500 mb-4" />
          <h3 className="text-lg font-bold text-slate-900 mb-2">Couldn&apos;t load playlists</h3>
          <p className="text-sm text-slate-500 mb-5">Check your connection and try again.</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-colors inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      )}

      {/* ─── Playlist Dashboard — grid OR line layout ─── */}
      {playlists && playlists.length > 0 && displayedPlaylists.length > 0 && (
        <div className={playlistView === 'grid'
          ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'
          : 'space-y-2'
        }>
          {displayedPlaylists.map((pl: any) => (
            <PlaylistCard
              key={pl.id}
              playlist={pl}
              screenMap={playlistScreenMap[pl.id] || { screens: [], groups: [], scheduleCount: 0, activeCount: 0 }}
              templateLookup={templateLookup}
              onOpen={() => handleSelect(pl)}
              onDelete={async () => {
                // 2026-05-13 — the old "click delete and pray" path
                // silently bounced when the server rejected (e.g.
                // protected emergency playlists return 403, or a
                // schedule constraint blocks it). Optimistic update
                // hid the card, server rejected, rollback popped it
                // back in, operator saw "delete didn't work" and had
                // no clue why. Now: confirm first, await the mutation,
                // surface any server error in an alert. The card only
                // stays gone if the API actually deleted.
                const ok = await appConfirm({
                  title: `Delete "${pl.name || 'playlist'}"?`,
                  message:
                    pl.scheduleCount && pl.scheduleCount > 0
                      ? `This playlist has ${pl.scheduleCount} scheduled screen(s). Deleting it will disable those schedules. This can't be undone.`
                      : "This can't be undone.",
                  confirmLabel: 'Delete',
                  tone: 'danger',
                });
                if (!ok) return;
                try {
                  await deletePlaylist.mutateAsync(pl.id);
                } catch (err: any) {
                  await appAlert({
                    title: "Couldn't delete playlist",
                    message:
                      err?.message ||
                      'The server rejected the delete. Refresh and try again.',
                    tone: 'danger',
                  });
                }
              }}
              onToggleActive={async (active: boolean) => {
                // Going INACTIVE — no conflict possible, just flip.
                if (!active) {
                  setPlaylistActive.mutate({ id: pl.id, active: false });
                  return;
                }
                // Going ACTIVE — find any OTHER playlist currently
                // live on a screen this playlist also targets, so we
                // can prompt the operator to replace it. Without this
                // both switches stayed green simultaneously and the
                // partner had to chase down the old toggle to flip it
                // off by hand. Reported verbatim:
                //   "i hit the one switch and if existing content is
                //   playing a get a quick warning that asks do you
                //   want to replace the existing playlist and i hit
                //   yes and my switch goes to green on the new one
                //   and off on the old one"
                // 2026-05-04 — operator: "when i turn on another playlist
                // it auto turns off the active playlist even if it for
                // different screens, it need to allow playing multiple
                // playlists just not two on the same screen".
                //
                // Take 3 (after take 1 produced false-positives and take 2
                // produced false-negatives + replaced way too much):
                //
                //   "tell me what screens its playing that will be replaced,
                //    also we are right back to where we were, it turned off
                //    the new url playlist as well for a screen that isnt
                //    included"
                //
                // The right level for this whole check is THE SCHEDULE,
                // not the playlist. Each schedule binds (playlist, screen
                // OR group). When pl turns on, every one of pl's schedules
                // becomes active. If ANOTHER schedule is currently active
                // on a screen pl is also targeting, THAT schedule needs
                // to flip off. Other schedules of the same other-playlist
                // (e.g. New URL on "The Den" while pl only targets G43+M43)
                // are NOT touched — they stay active.
                //
                // That requires per-schedule deactivation, not the
                // playlist-level PUT /playlists/:id/active false (which
                // nukes every schedule). PUT /schedules/:id/toggle does
                // the right thing — we already filtered to isActive=true,
                // so toggling flips them to inactive deterministically.
                //
                // For the dialog we collect the overlapping screen names
                // grouped per conflicting playlist so the operator sees
                // exactly which screens get displaced — no surprises.
                const groupLookup = new Map<string, any>(
                  (screenGroups || []).map((g: any) => [g.id, g]),
                );
                const screenLookup = new Map<string, any>(
                  (screens || []).map((s: any) => [s.id, s]),
                );
                const myMap = playlistScreenMap[pl.id];
                const myScreenIds = new Set<string>((myMap?.screens || []).map((s: any) => s.id));
                const liveSchedules = (schedules || []).filter((s: any) => s.isActive);
                // For each other-playlist that conflicts: which schedule
                // ids overlap pl, and which screen names should we display.
                type Conflict = { playlist: any; scheduleIds: string[]; screenNames: Set<string> };
                const conflicts: Conflict[] = [];
                for (const other of playlists || []) {
                  if (other.id === pl.id) continue;
                  const otherActive = liveSchedules.filter((s: any) => s.playlistId === other.id);
                  if (otherActive.length === 0) continue;
                  const scheduleIds: string[] = [];
                  const screenNames = new Set<string>();
                  for (const sched of otherActive) {
                    // Resolve this schedule's effective screen set.
                    const schedScreens: { id: string; name: string }[] = [];
                    if (sched.screenId) {
                      const sc = screenLookup.get(sched.screenId) || sched.screen;
                      if (sc) schedScreens.push({ id: sc.id, name: sc.name || sc.id });
                    }
                    if (sched.screenGroupId) {
                      const grp = groupLookup.get(sched.screenGroupId) || sched.screenGroup;
                      if (grp?.screens) for (const s of grp.screens) schedScreens.push({ id: s.id, name: s.name || s.id });
                    }
                    // Does any of this schedule's screens overlap pl?
                    const hits = schedScreens.filter((s) => myScreenIds.has(s.id));
                    if (hits.length === 0) continue;
                    scheduleIds.push(sched.id);
                    for (const h of hits) screenNames.add(h.name);
                  }
                  if (scheduleIds.length > 0) {
                    conflicts.push({ playlist: other, scheduleIds, screenNames });
                  }
                }
                if (conflicts.length > 0) {
                  const lines = conflicts.map((c) =>
                    `• "${c.playlist.name}" on ${Array.from(c.screenNames).join(', ')}`,
                  );
                  const message = conflicts.length === 1
                    ? `"${conflicts[0].playlist.name}" is currently playing on ${Array.from(conflicts[0].screenNames).join(', ')}. Switching "${pl.name}" on will replace it on ${conflicts[0].screenNames.size === 1 ? 'that screen' : 'those screens'} only — its other screens stay untouched.`
                    : `These playlists overlap "${pl.name}" on the listed screens:\n\n${lines.join('\n')}\n\nSwitching "${pl.name}" on will replace them on those screens only.`;
                  const ok = await appConfirm({
                    title: `Replace on ${conflicts.reduce((n, c) => n + c.screenNames.size, 0)} screen${conflicts.reduce((n, c) => n + c.screenNames.size, 0) === 1 ? '' : 's'}?`,
                    message,
                    tone: 'warn',
                    confirmLabel: 'Replace',
                  });
                  if (!ok) return;
                  // Deactivate ONLY the overlapping schedules. Other
                  // schedules belonging to the same other-playlist (on
                  // non-overlapping screens) stay active. We use
                  // PUT /schedules/:id/toggle which flips isActive — safe
                  // here because we filtered to isActive=true above.
                  for (const c of conflicts) {
                    for (const sid of c.scheduleIds) {
                      toggleSchedule.mutate(sid);
                    }
                  }
                }
                setPlaylistActive.mutate({ id: pl.id, active: true });
              }}
              togglePending={setPlaylistActive.isPending}
              layout={playlistView}
              isViewer={isViewer}
            />
          ))}
        </div>
      )}

      {playlists && playlists.length > 0 && displayedPlaylists.length === 0 && !showCreate && (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-2xl border border-slate-100">
          <Search className="w-12 h-12 text-slate-300 mb-4" />
          <h3 className="text-lg font-bold text-slate-900 mb-2">No playlists match those filters</h3>
          <p className="text-sm text-slate-500 mb-5">Clear the search or filters to get back to the full playlist library.</p>
          <button
            onClick={() => {
              setPlaylistSearch('');
              setCreatorFilter('all');
              setAssignmentFilter('all');
              setTargetFilter('all');
              setPlaylistSort('latest');
            }}
            className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition-colors"
          >
            Reset filters
          </button>
        </div>
      )}

      {playlists && playlists.length === 0 && !showCreate && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
            <Play className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-base font-bold text-slate-600 mb-1">No playlists yet</h3>
          <p className="text-sm text-slate-400 mb-5 max-w-sm">Create your first playlist to start scheduling content to your screens.</p>
          <button
            onClick={() => { setShowCreate(true); setCreateMode('choose'); }}
            disabled={isViewer}
            title={isViewer ? 'Read-only — viewer role' : undefined}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-sm flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" /> Create First Playlist
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Inline Download button — sits on every playlist header. Dropdown
 * gives the admin two verbs:
 *   • Download to Desktop — plain .zip download, user takes it
 *     wherever they want.
 *   • Download to USB — uses the File System Access API to write the
 *     extracted bundle contents straight onto the USB stick the user
 *     picks. Browser prompts for the folder, we stream file-by-file
 *     and show progress.
 *
 * No settings page needed — USB signing is auto-provisioned server-side
 * on first export if the tenant doesn't have a key yet. This was the
 * user ask: "I plug it in, click download, pick USB, you do the rest."
 *
 * Falls back to plain download if the browser doesn't support
 * showDirectoryPicker (Safari / Firefox).
 */
function InlineDownloadButton({ playlistId, playlistName }: { playlistId: string; playlistName: string }) {
  const token = useUIStore((s) => s.token);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<null | 'desktop' | 'usb'>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fsAccess = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const fetchBundle = async (): Promise<ArrayBuffer> => {
    const base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1').replace(/\/+$/, '');
    const res = await fetch(`${base}/usb-export/bundle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ playlistIds: [playlistId], includeEmergency: true, bundleLabel: playlistName }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Bundle failed (${res.status})`);
    }
    return res.arrayBuffer();
  };

  const downloadDesktop = async () => {
    setOpen(false); setBusy('desktop'); setErr(null);
    try {
      const buf = await fetchBundle();
      const blob = new Blob([buf], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `${playlistName.replace(/[^\w.-]+/g, '_')}-${stamp}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) { setErr(e?.message || 'Download failed'); }
    finally { setBusy(null); }
  };

  const downloadUsb = async () => {
    setOpen(false);
    if (!fsAccess) { await downloadDesktop(); return; }
    setBusy('usb'); setErr(null); setProgress(null);
    try {
      const dir: any = await (window as any).showDirectoryPicker({ mode: 'readwrite', id: 'edu-cms-usb', startIn: 'desktop' });
      const buf = await fetchBundle();
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(buf);
      const entries = Object.entries(zip.files).filter(([, f]: any) => !f.dir);
      let done = 0;
      for (const [path, file] of entries as Array<[string, any]>) {
        const segs = path.split('/').filter(Boolean);
        let d = dir;
        for (let i = 0; i < segs.length - 1; i++) d = await d.getDirectoryHandle(segs[i], { create: true });
        const fh = await d.getFileHandle(segs[segs.length - 1], { create: true });
        const w = await fh.createWritable();
        await w.write(await file.async('uint8array'));
        await w.close();
        done += 1;
        setProgress({ done, total: entries.length });
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') setErr(e?.message || 'USB write failed');
    } finally { setBusy(null); setTimeout(() => setProgress(null), 4000); }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => { if (!busy) setOpen((v) => !v); }}
        disabled={!!busy}
        className="px-3 py-1.5 bg-white border border-slate-200 hover:border-sky-400 hover:bg-sky-50 text-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1 shadow-sm disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        {busy === 'desktop' ? 'Building…' : busy === 'usb' ? (progress ? `Writing ${progress.done}/${progress.total}` : 'Building…') : 'Download'}
        {!busy && <ChevronRight className="w-3 h-3 opacity-50 rotate-90" />}
      </button>
      {open && (
        <div className="absolute right-0 top-9 w-64 bg-white border border-slate-200 rounded-xl shadow-xl py-1 z-50">
          <button
            type="button"
            onClick={downloadDesktop}
            className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 text-sm text-left"
          >
            <Monitor className="w-4 h-4 text-slate-500" />
            <div className="flex-1">
              <div className="text-xs font-semibold text-slate-800">Download to Desktop</div>
              <div className="text-[10px] text-slate-400">Plain .zip</div>
            </div>
          </button>
          <button
            type="button"
            onClick={downloadUsb}
            className="w-full flex items-center gap-3 px-3 py-2 hover:bg-slate-50 text-sm text-left border-t border-slate-100"
          >
            <Usb className="w-4 h-4 text-indigo-600" />
            <div className="flex-1">
              <div className="text-xs font-semibold text-slate-800">Download to USB</div>
              <div className="text-[10px] text-slate-400">
                {fsAccess ? 'Pick a USB folder, we write straight in' : '.zip fallback — extract manually'}
              </div>
            </div>
          </button>
        </div>
      )}
      {err && (
        <div className="absolute right-0 top-10 w-72 p-2 bg-red-50 border border-red-200 rounded-lg text-[11px] text-red-700 z-50 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {err}
        </div>
      )}
      {progress && !err && progress.done === progress.total && (
        <div className="absolute right-0 top-10 w-64 p-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[11px] text-emerald-800 z-50 flex items-center gap-1.5">
          <Check className="w-3.5 h-3.5" /> Wrote {progress.total} files to USB ✓
        </div>
      )}
    </div>
  );
}
