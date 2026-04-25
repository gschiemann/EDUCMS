"use client";

import { useState, useMemo, useRef, useEffect } from 'react';
import { Play, Plus, Clock, Loader2, Trash2, Save, GripVertical, Image as ImageIcon, Video, Music, Globe, File, Calendar, CalendarDays, Power, Eye, LayoutTemplate, Pencil, Monitor, Layers, ChevronRight, ChevronLeft, Tv2, Wifi, WifiOff, ArrowLeft, Smartphone, FolderOpen, Home, CheckSquare, Search, Settings, Upload, AlertCircle, Download, Usb, Check } from 'lucide-react';
import { useUIStore } from '@/store/ui-store';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent
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
} from '@/hooks/use-api';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const apiBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1').replace('/api/v1', '');

function thumbUrl(asset: any) {
  if (!asset) return null;
  if (!asset.mimeType?.startsWith('image/')) return null;
  return asset.fileUrl?.startsWith('http') ? asset.fileUrl : `${apiBase}${asset.fileUrl}`;
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
function SortableItem({ item, index, onRemove, onDurationChange, onUpdate, isSelected, onToggle }: any) {
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
      <div {...attributes} {...listeners} className="playlist-item-card flex items-center gap-3 p-3.5 cursor-grab active:cursor-grabbing">
        <GripVertical className="w-4 h-4 text-slate-300 group-hover:text-indigo-400 shrink-0" aria-hidden="true" />
        <div className="flex items-center">
          <input type="checkbox" checked={isSelected} onChange={() => onToggle(item.id)} className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 cursor-pointer" />
        </div>
        <span className="text-xs font-bold text-slate-400 w-5 text-center">{index + 1}</span>
        <div className="w-14 h-10 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
          {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : mimeIcon(item.asset?.mimeType)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-slate-700 truncate" title={name}>{name}</p>
            {isScheduled && <span title="Time Restricted"><Clock className="w-3 h-3 text-indigo-500" /></span>}
          </div>
          <p className="text-[10px] text-slate-400">{item.asset?.mimeType}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 w-24 justify-end mr-2">
          {item.asset?.mimeType?.startsWith('video/') ? (
            <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-3 py-1 rounded-md uppercase tracking-wide">Auto</span>
          ) : (
            <>
              <input
                type="number" min={1} max={300}
                value={Math.round((item.durationMs || 10000) / 1000)}
                onChange={(e) => onDurationChange(item.id, parseInt(e.target.value) || 10)}
                className="w-14 px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-md text-center font-medium outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <span className="text-[10px] text-slate-400 font-medium w-4">sec</span>
            </>
          )}
        </div>
        <button onClick={() => setShowSettings(!showSettings)} className={`p-1 transition-all ${showSettings || isScheduled ? 'text-indigo-500 hover:text-indigo-600' : 'text-slate-300 hover:text-indigo-500 opacity-0 group-hover:opacity-100'}`}>
          <Settings className="w-4 h-4" />
        </button>
        <button onClick={() => onRemove(item.id)} className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
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
function PlaylistCard({ playlist, screenMap, onOpen, onDelete, onToggleActive, togglePending, layout = 'grid' }: {
  playlist: any;
  screenMap: { screens: any[]; groups: any[]; scheduleCount: number; activeCount: number };
  onOpen: () => void;
  onDelete: () => void;
  onToggleActive: (active: boolean) => void;
  togglePending: boolean;
  layout?: 'grid' | 'list';
}) {
  const isTemplate = !!playlist.template;
  const slideCount = playlist.items?.length || 0;
  const hasScreens = screenMap.screens.length > 0 || screenMap.groups.length > 0;
  const onlineScreens = screenMap.screens.filter((s: any) => s.status === 'ONLINE');
  const hasSchedules = screenMap.scheduleCount > 0;
  // A playlist is "on" when at least one of its schedules is active.
  const isLive = screenMap.activeCount > 0;
  // First few asset thumbs for the grid-view preview strip.
  const previewItems = (playlist.items || []).slice(0, 4);

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
          {/* Left accent + name */}
          <div className={`w-1 h-9 rounded-full shrink-0 ${isTemplate ? 'bg-gradient-to-b from-violet-500 to-purple-500' : hasScreens ? 'bg-gradient-to-b from-emerald-400 to-teal-400' : 'bg-slate-200'}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-800 truncate">{playlist.name}</h3>
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${isTemplate ? 'bg-violet-100 text-violet-600' : 'bg-indigo-100 text-indigo-600'}`}>
                {isTemplate ? 'Layout' : 'Media'}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-400">
              <span>{isTemplate ? `${playlist.template.screenWidth}×${playlist.template.screenHeight}` : `${slideCount} slide${slideCount !== 1 ? 's' : ''}`}</span>
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
            disabled={togglePending}
            title={hasSchedules ? (isLive ? 'Turn playlist off — pauses all schedules' : 'Turn playlist on — activates all schedules') : 'Set a schedule first'}
            aria-label={isLive ? 'Turn off' : 'Turn on'}
            className={`relative z-10 shrink-0 inline-flex items-center h-6 w-11 rounded-full transition-colors pointer-events-auto ${isLive ? 'bg-emerald-500' : 'bg-slate-300'} ${togglePending ? 'opacity-50' : ''}`}
          >
            <span className={`inline-block w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${isLive ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            aria-label={`Delete playlist ${playlist.name}`}
            className="relative z-10 shrink-0 p-1.5 rounded-lg text-slate-200 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all pointer-events-auto"
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
                {isTemplate ? 'Layout' : 'Media'}
              </span>
              <span className="text-[10px] text-slate-400">
                {isTemplate
                  ? `${playlist.template.screenWidth}x${playlist.template.screenHeight}`
                  : `${slideCount} slide${slideCount !== 1 ? 's' : ''}`
                }
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {/* On/off toggle — always visible on the card so the
                operator doesn't have to drill in to flip state. */}
            <button
              onClick={handleToggleClick}
              disabled={togglePending}
              title={hasSchedules ? (isLive ? 'Turn playlist off — pauses all schedules' : 'Turn playlist on — activates all schedules') : 'Set a schedule first — opens editor'}
              aria-label={isLive ? 'Turn off' : 'Turn on'}
              className={`relative z-10 shrink-0 inline-flex items-center h-6 w-11 rounded-full transition-colors ${isLive ? 'bg-emerald-500' : hasSchedules ? 'bg-slate-300' : 'bg-amber-200'} ${togglePending ? 'opacity-50' : ''}`}
            >
              <span className={`inline-block w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${isLive ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              aria-label={`Delete playlist ${playlist.name}`}
              className="relative z-10 p-1.5 rounded-lg text-slate-200 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Preview strip — shows the first 4 asset thumbs so the card
            has a "what's in this playlist" cue at a glance. Hidden for
            Layout (template) playlists since they render dynamic
            widgets rather than discrete slides. */}
        {!isTemplate && previewItems.length > 0 && (
          <div className="mb-3 -mx-1">
            <div className="flex gap-1 px-1">
              {previewItems.map((pi: any, idx: number) => {
                const asset = pi.asset || {};
                const thumb = thumbUrl(asset);
                const isVideo = asset.mimeType?.startsWith('video/');
                return (
                  <div
                    key={pi.id || idx}
                    className="relative flex-1 aspect-video rounded-md bg-slate-50 border border-slate-100 overflow-hidden"
                    title={assetName(asset)}
                  >
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        {mimeIcon(asset.mimeType, 'w-3.5 h-3.5')}
                      </div>
                    )}
                    {isVideo && (
                      <Play className="absolute inset-0 m-auto w-3 h-3 text-white drop-shadow" />
                    )}
                  </div>
                );
              })}
              {slideCount > previewItems.length && (
                <div className="flex-1 aspect-video rounded-md bg-slate-100 border border-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-500">
                  +{slideCount - previewItems.length}
                </div>
              )}
            </div>
          </div>
        )}

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
        <span className="text-[10px] text-slate-400 font-medium">
          {screenMap.scheduleCount > 0
            ? `${onlineScreens.length} screen${onlineScreens.length !== 1 ? 's' : ''} online`
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
  const { data: playlists, isLoading } = usePlaylists();
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
  const [schedMode, setSchedMode] = useState<'always' | 'scheduled'>('always');

  const selectedPlaylist = playlists?.find((p: any) => p.id === selectedId);
  const playlistSchedules = (schedules || []).filter((s: any) => s.playlistId === selectedId);

  // --- Build playlist → screen mapping for dashboard cards ---
  const playlistScreenMap = useMemo(() => {
    const map: Record<string, { screens: any[]; groups: any[]; scheduleCount: number; activeCount: number }> = {};
    if (!playlists) return map;

    for (const pl of playlists) {
      const plSchedules = (schedules || []).filter((s: any) => s.playlistId === pl.id);
      const screenSet = new Map<string, any>();
      const groupSet = new Map<string, any>();

      for (const sched of plSchedules) {
        // Direct screen assignment
        if (sched.screenId && sched.screen) {
          screenSet.set(sched.screen.id, sched.screen);
        }
        // Screen group assignment — expand to individual screens
        if (sched.screenGroupId && sched.screenGroup) {
          groupSet.set(sched.screenGroup.id, {
            ...sched.screenGroup,
            screenCount: sched.screenGroup.screens?.length || 0,
          });
          // Also add individual screens from the group
          if (sched.screenGroup.screens) {
            for (const s of sched.screenGroup.screens) {
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
  }, [playlists, schedules]);

  // --- Quick stats ---
  const totalScreensOnline = (screens || []).filter((s: any) => s.status === 'ONLINE').length;
  const totalScreens = (screens || []).length;
  const activeSchedules = (schedules || []).filter((s: any) => s.isActive).length;
  const unassignedPlaylists = (playlists || []).filter((pl: any) => {
    const m = playlistScreenMap[pl.id];
    return !m || m.scheduleCount === 0;
  }).length;

  // Activation constraint so clicks on interactive children (duration
  // input, settings button, checkbox) don't accidentally start a drag.
  // With distance:8 the pointer must travel 8px before a drag kicks in —
  // any click that stays put still behaves like a click. Without this
  // the draggable-whole-row change below would hijack every input edit.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
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
      })),
    });
    setHasChanges(false);
  };

  // Unified submit for the Publish/Save modal. `activate=false` = save
  // as a draft (isActive: false server-side). The UI wires two buttons
  // to this function — "Save" (activate=false) and "Publish"
  // (activate=true) — so the operator can stage a schedule ahead of
  // time and then flip it live from the playlist card's on/off toggle.
  const submitSchedule = async (activate: boolean) => {
    if (schedTargets.length === 0) return;

    if (editingScheduleId) {
      // In edit mode we process the multiple targets by clearing the original and recreating them
      await deleteSchedule.mutateAsync(editingScheduleId);

      for (const target of schedTargets) {
        const isGroup = target.startsWith('group-');
        const targetId = target.replace(/^(group-|screen-)/, '');
        await createSchedule.mutateAsync({
          playlistId: selectedId!,
          screenGroupId: isGroup ? targetId : undefined,
          screenId: !isGroup ? targetId : undefined,
          startTime: new Date().toISOString(),
          daysOfWeek: schedMode === 'scheduled' ? schedDays.join(',') : undefined,
          timeStart: schedMode === 'scheduled' ? schedTimeStart : undefined,
          timeEnd: schedMode === 'scheduled' ? schedTimeEnd : undefined,
          priority: 0,
          mode: publishMode,
          isActive: activate,
        });
      }
      setEditingScheduleId(null);
    } else {
      if (!selectedId) return;
      for (const target of schedTargets) {
        const isGroup = target.startsWith('group-');
        const targetId = target.replace(/^(group-|screen-)/, '');
        await createSchedule.mutateAsync({
          playlistId: selectedId,
          screenGroupId: isGroup ? targetId : undefined,
          screenId: !isGroup ? targetId : undefined,
          startTime: new Date().toISOString(),
          daysOfWeek: schedMode === 'scheduled' ? schedDays.join(',') : undefined,
          timeStart: schedMode === 'scheduled' ? schedTimeStart : undefined,
          timeEnd: schedMode === 'scheduled' ? schedTimeEnd : undefined,
          priority: 0,
          mode: publishMode,
          isActive: activate,
        });
      }
    }
    setShowPublishModal(false);
    setSchedTargets([]);
    setTab('schedules');
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
                  {selectedPlaylist.template ? 'Layout' : 'Media'}
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
          <div className="flex gap-2">
            {tab === 'editor' && !selectedPlaylist.template && (
              <>
                <button onClick={() => setShowPicker(true)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> Add Media
                </button>
                {hasChanges && (
                  <button onClick={handleSave} disabled={saveItems.isPending} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1">
                    <Save className="w-3.5 h-3.5" /> {saveItems.isPending ? 'Saving...' : 'Save'}
                  </button>
                )}
              </>
            )}
            <InlineDownloadButton playlistId={selectedPlaylist.id} playlistName={selectedPlaylist.name} />
            <button onClick={() => { setEditingScheduleId(null); setSchedTargets([]); setSchedMode('always'); setShowPublishModal(true); }} className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1 shadow-sm">
              <CalendarDays className="w-3.5 h-3.5" /> Schedule to Screen
            </button>
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

        {/* Content */}
        <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden min-h-[400px]">
          <div className="p-6">
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
                  onClick={() => { window.location.href = window.location.pathname.replace('/playlists', '/templates') + '?edit=' + selectedPlaylist.template.id; }}
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
                            className="px-3 py-1 bg-emerald-50 hover:bg-emerald-600 text-emerald-600 hover:text-white text-[10px] font-bold rounded flex items-center transition-all"
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
                        className="px-3 py-1 bg-indigo-50 hover:bg-indigo-600 text-indigo-600 hover:text-white text-[10px] font-bold rounded-md transition-all duration-200"
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
                          <SortableItem key={item.id} item={item} index={i} onRemove={handleRemove} onDurationChange={handleDuration} onUpdate={handleUpdateItem} isSelected={selectedItemIds.has(item.id)} onToggle={handleToggleSelect} />
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
                  <button onClick={() => setShowPicker(true)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5">
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
                    <button onClick={() => { setEditingScheduleId(null); setSchedTargets([]); setSchedMode('always'); setShowPublishModal(true); }} className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5">
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
                                setShowPublishModal(true);
                              }}
                              className="p-1.5 rounded-lg text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                              title="Edit schedule"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => toggleSchedule.mutate(sched.id)}
                              className={`p-1.5 rounded-lg transition-colors ${sched.isActive ? 'text-emerald-600 hover:bg-emerald-100' : 'text-slate-400 hover:bg-slate-100'}`}
                              title={sched.isActive ? 'Pause schedule' : 'Resume schedule'}
                            >
                              <Power className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => deleteSchedule.mutate(sched.id)}
                              className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
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
                    className="px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg flex items-center gap-1.5 transition-colors"
                    title="Upload files into this folder without leaving the playlist"
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
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={thumb} alt="" className="w-full h-full object-cover" />
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

        {/* ─── Publish / Schedule Modal ─── */}
        {showPublishModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Publish to Screens">
            <button className="absolute inset-0 cursor-default" aria-label="Close dialog" onClick={() => setShowPublishModal(false)} />
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col p-6 relative z-10">
              <h3 className="text-lg font-bold text-slate-800 mb-1">Publish to Screens</h3>
              <p className="text-sm text-slate-500 mb-5">
                Schedule <span className="font-bold text-slate-800">{selectedPlaylist?.name}</span> to play on a screen or group.
              </p>

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

              {schedMode === 'scheduled' && (
                <div className="space-y-4 mb-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
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

              <div className="flex justify-end gap-3 mt-2">
                <button onClick={() => setShowPublishModal(false)} className="px-4 py-2.5 text-slate-500 hover:text-slate-800 text-sm font-semibold rounded-lg hover:bg-slate-50">
                  Cancel
                </button>
                {/* Save = persist schedule as DRAFT (isActive:false).
                    Operator can stage a schedule ahead of time and flip
                    it live later via the on/off toggle on the playlist
                    card. Schedule doesn't displace the currently-
                    running playlist on its target(s) until it's
                    activated. */}
                <button
                  disabled={schedTargets.length === 0 || createSchedule.isPending}
                  onClick={handleSaveDraft}
                  className="px-5 py-2.5 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-sm font-bold rounded-lg shadow-sm flex items-center gap-2"
                  title="Save this schedule as a draft — won't go live until you turn the playlist on"
                >
                  {createSchedule.isPending ? 'Saving…' : (
                    <><Save className="w-4 h-4" /> Save</>
                  )}
                </button>
                <button
                  disabled={schedTargets.length === 0 || createSchedule.isPending}
                  onClick={handlePublish}
                  className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg shadow-sm flex items-center gap-2"
                >
                  {createSchedule.isPending ? 'Publishing…' : (
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
          <button onClick={() => { setShowCreate(true); setCreateMode('choose'); setNewName(''); setSelectedTemplateId(null); }} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-sm flex items-center gap-1.5">
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
                <button onClick={handleCreate} disabled={createPlaylist.isPending || !newName.trim()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">
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
                  <button onClick={handleCreate} disabled={createPlaylist.isPending || !newName.trim()} className="px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">
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

      {/* ─── Playlist Dashboard — grid OR line layout ─── */}
      {playlists && playlists.length > 0 && (
        <div className={playlistView === 'grid'
          ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4'
          : 'space-y-2'
        }>
          {playlists.map((pl: any) => (
            <PlaylistCard
              key={pl.id}
              playlist={pl}
              screenMap={playlistScreenMap[pl.id] || { screens: [], groups: [], scheduleCount: 0, activeCount: 0 }}
              onOpen={() => handleSelect(pl)}
              onDelete={() => deletePlaylist.mutate(pl.id)}
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
                const myMap = playlistScreenMap[pl.id];
                const myScreenIds = new Set<string>(
                  (myMap?.screens || []).map((s: any) => s.id),
                );
                const myGroupIds = new Set<string>(
                  (myMap?.groups || []).map((g: any) => g.id),
                );
                const conflicts: any[] = [];
                for (const other of playlists || []) {
                  if (other.id === pl.id) continue;
                  const om = playlistScreenMap[other.id];
                  if (!om || om.activeCount === 0) continue;
                  const overlap =
                    (om.screens || []).some((s: any) => myScreenIds.has(s.id)) ||
                    (om.groups || []).some((g: any) => myGroupIds.has(g.id));
                  if (overlap) conflicts.push(other);
                }
                if (conflicts.length > 0) {
                  const names = conflicts.map((c) => c.name).join(', ');
                  const ok = window.confirm(
                    `"${names}" ${conflicts.length === 1 ? 'is' : 'are'} currently playing on the same target. Replace ${conflicts.length === 1 ? 'it' : 'them'} with "${pl.name}"?`,
                  );
                  if (!ok) return;
                  // Deactivate every conflict in parallel, then turn
                  // this one on. We don't await individual results —
                  // setPlaylistActive's optimistic update flips the
                  // UI immediately, and the server-side cascade is
                  // tolerant of out-of-order requests.
                  for (const c of conflicts) {
                    setPlaylistActive.mutate({ id: c.id, active: false });
                  }
                }
                setPlaylistActive.mutate({ id: pl.id, active: true });
              }}
              togglePending={setPlaylistActive.isPending}
              layout={playlistView}
            />
          ))}
        </div>
      )}

      {playlists && playlists.length === 0 && !showCreate && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
            <Play className="w-8 h-8 text-slate-300" />
          </div>
          <h3 className="text-base font-bold text-slate-600 mb-1">No playlists yet</h3>
          <p className="text-sm text-slate-400 mb-5 max-w-sm">Create your first playlist to start scheduling content to your screens.</p>
          <button onClick={() => { setShowCreate(true); setCreateMode('choose'); }} className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-sm flex items-center gap-1.5">
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
