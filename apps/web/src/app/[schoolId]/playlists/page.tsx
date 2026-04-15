"use client";

import { useState } from 'react';
import { Play, Plus, Clock, Loader2, Trash2, Save, GripVertical, Image as ImageIcon, Video, Music, Globe, File, Calendar, CalendarDays, Power, Eye, LayoutTemplate, Pencil, Monitor, Layers, ChevronRight } from 'lucide-react';
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
  useSchedules, useDeleteSchedule, useToggleSchedule, useScreens,
  useTemplates,
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
function SortableItem({ item, index, onRemove, onDurationChange }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 50 : undefined, opacity: isDragging ? 0.5 : 1 };
  const thumb = thumbUrl(item.asset);
  const name = assetName(item.asset);

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-3 p-3.5 bg-white rounded-2xl border border-slate-100 group hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-all">
      <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 text-slate-300 hover:text-slate-500">
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="text-xs font-bold text-slate-400 w-5 text-center">{index + 1}</span>
      <div className="w-14 h-10 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center overflow-hidden shrink-0">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        ) : (
          mimeIcon(item.asset?.mimeType)
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-slate-700 truncate">{name}</p>
        <p className="text-[10px] text-slate-400">{item.asset?.mimeType}</p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <input
          type="number" min={1} max={300}
          value={Math.round((item.durationMs || 10000) / 1000)}
          onChange={(e) => onDurationChange(item.id, parseInt(e.target.value) || 10)}
          className="w-14 px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded-md text-center font-medium"
        />
        <span className="text-[10px] text-slate-400 font-medium">sec</span>
      </div>
      <button onClick={() => onRemove(item.id)} className="p-1 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

// --- Main page ---
export default function PlaylistsPage() {
  const { data: playlists, isLoading } = usePlaylists();
  const { data: assets } = useAssets();
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
  const [hasChanges, setHasChanges] = useState(false);
  const [pickerFilter, setPickerFilter] = useState<'all' | 'images' | 'videos' | 'audio' | 'urls'>('all');
  const [tab, setTab] = useState<'editor' | 'schedules'>('editor');

  // Schedule form state
  const [schedTarget, setSchedTarget] = useState('');
  const [schedDays, setSchedDays] = useState<string[]>(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  const [schedTimeStart, setSchedTimeStart] = useState('08:00');
  const [schedTimeEnd, setSchedTimeEnd] = useState('15:00');
  const [schedMode, setSchedMode] = useState<'always' | 'scheduled'>('always');

  const selectedPlaylist = playlists?.find((p: any) => p.id === selectedId);
  const playlistSchedules = (schedules || []).filter((s: any) => s.playlistId === selectedId);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleSelect = (pl: any) => {
    setSelectedId(pl.id);
    setLocalItems(pl.items || []);
    setHasChanges(false);
    setTab('editor');
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

  const handleRemove = (id: string) => { setLocalItems(prev => prev.filter(i => i.id !== id)); setHasChanges(true); };
  const handleDuration = (id: string, sec: number) => { setLocalItems(prev => prev.map(i => i.id === id ? { ...i, durationMs: sec * 1000 } : i)); setHasChanges(true); };

  const handleSave = async () => {
    if (!selectedId) return;
    await saveItems.mutateAsync({
      playlistId: selectedId,
      items: localItems.map((item, i) => ({
        assetId: item.assetId || item.asset?.id,
        durationMs: item.durationMs || 10000,
        sequenceOrder: i,
      })),
    });
    setHasChanges(false);
  };

  const handlePublish = async () => {
    if (!selectedId || !schedTarget) return;

    const isGroup = schedTarget.startsWith('group-');
    const targetId = schedTarget.replace(/^(group-|screen-)/, '');

    await createSchedule.mutateAsync({
      playlistId: selectedId,
      screenGroupId: isGroup ? targetId : undefined,
      screenId: !isGroup ? targetId : undefined,
      startTime: new Date().toISOString(),
      daysOfWeek: schedMode === 'scheduled' ? schedDays.join(',') : undefined,
      timeStart: schedMode === 'scheduled' ? schedTimeStart : undefined,
      timeEnd: schedMode === 'scheduled' ? schedTimeEnd : undefined,
      priority: 0,
    });
    setShowPublishModal(false);
    setSchedTarget('');
    setTab('schedules');
  };

  const totalMs = localItems.reduce((a: number, i: any) => a + (i.durationMs || 0), 0);
  const totalDur = `${Math.floor(totalMs / 60000)}m ${Math.round((totalMs % 60000) / 1000)}s`;

  const pickerAssets = (assets || []).filter((a: any) => {
    if (pickerFilter === 'all') return true;
    if (pickerFilter === 'images') return a.mimeType?.startsWith('image/');
    if (pickerFilter === 'videos') return a.mimeType?.startsWith('video/');
    if (pickerFilter === 'audio') return a.mimeType?.startsWith('audio/');
    if (pickerFilter === 'urls') return a.mimeType === 'text/html';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">Playlists</h1>
          <p className="text-sm text-slate-500 mt-0.5">Create playlists, add media, schedule to screens.</p>
        </div>
        <button onClick={() => { setShowCreate(true); setCreateMode('choose'); setNewName(''); setSelectedTemplateId(null); }} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg shadow-sm flex items-center gap-1.5">
          <Plus className="w-4 h-4" /> New Playlist
        </button>
      </div>

      {/* Create form — step-based */}
      {showCreate && (
        <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden">
          {/* Step 1: Choose type */}
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

          {/* Step 2a: Blank playlist — just name */}
          {createMode === 'blank' && (
            <div className="p-5">
              <p className="text-sm font-semibold text-slate-700 mb-3">Name your playlist</p>
              <div className="flex gap-3">
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Playlist name..."
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()} autoFocus />
                <button onClick={handleCreate} disabled={createPlaylist.isPending || !newName.trim()} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">
                  {createPlaylist.isPending ? 'Creating...' : 'Create'}
                </button>
                <button onClick={() => setCreateMode('choose')} className="px-3 py-2 text-slate-400 hover:text-slate-600 text-sm">Back</button>
              </div>
            </div>
          )}

          {/* Step 2b: Pick a template */}
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
                            <p className="text-[10px] text-slate-400">{t.screenWidth}×{t.screenHeight} · {t._count?.zones || t.zones?.length || 0} zones</p>
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
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Playlist name..."
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-violet-500"
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()} autoFocus />
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

      {playlists && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Playlist sidebar */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{playlists.length} Playlists</p>
            {playlists.map((pl: any) => (
              <button
                key={pl.id}
                onClick={() => handleSelect(pl)}
                className={`w-full text-left px-5 py-4 rounded-3xl transition-all duration-300 flex justify-between items-center ${
                  selectedId === pl.id
                    ? 'bg-indigo-50/80 text-indigo-700 shadow-[0_4px_20px_rgba(99,102,241,0.08)] scale-[1.02]'
                    : 'bg-white hover:bg-slate-50/80 text-slate-700 shadow-sm border border-transparent hover:border-slate-100'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold truncate">{pl.name}</p>
                    {pl.template && (
                      <span className="shrink-0 text-[8px] font-bold bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded uppercase tracking-wider">Layout</span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {pl.template
                      ? <span className="text-violet-500">{pl.template.screenWidth}×{pl.template.screenHeight} template</span>
                      : <>{pl.items?.length || 0} slides</>
                    }
                    {pl._count?.schedules > 0 && <span className="text-emerald-500 ml-1">• {pl._count.schedules} scheduled</span>}
                  </p>
                </div>
                <div onClick={(e) => { e.stopPropagation(); deletePlaylist.mutate(pl.id); }} className="text-slate-300 hover:text-red-500 p-1 cursor-pointer">
                  <Trash2 className="w-3.5 h-3.5" />
                </div>
              </button>
            ))}
            {playlists.length === 0 && <p className="text-center py-8 text-xs text-slate-400">No playlists yet.</p>}
          </div>

          {/* Timeline editor */}
          <div className="lg:col-span-3 bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden flex flex-col min-h-[500px]">
            {selectedPlaylist ? (
              <>
                {/* Toolbar */}
                <div className="px-6 py-4 border-b border-slate-50 flex justify-between items-center bg-slate-50/30">
                  <div className="flex items-center gap-3">
                    <h2 className="text-sm font-bold text-slate-700">{selectedPlaylist.name}</h2>
                    <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{localItems.length} slides • {totalDur}</span>
                  </div>
                  <div className="flex gap-2">
                    {/* Tabs */}
                    <div className="flex bg-slate-100 rounded-lg p-0.5 mr-2">
                      <button onClick={() => setTab('editor')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${tab === 'editor' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                        Editor
                      </button>
                      <button onClick={() => setTab('schedules')} className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors ${tab === 'schedules' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}>
                        Schedules {playlistSchedules.length > 0 && <span className="text-emerald-500 ml-0.5">({playlistSchedules.length})</span>}
                      </button>
                    </div>
                    {tab === 'editor' && selectedPlaylist.template && (
                      <button onClick={() => setShowPublishModal(true)} className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1 shadow-sm">
                        <CalendarDays className="w-3.5 h-3.5" /> Schedule to Screens
                      </button>
                    )}
                    {tab === 'editor' && !selectedPlaylist.template && (
                      <>
                        <button onClick={() => setShowPicker(true)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1">
                          <Plus className="w-3.5 h-3.5" /> Add Media
                        </button>
                        {hasChanges ? (
                          <button onClick={handleSave} disabled={saveItems.isPending} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg flex items-center gap-1">
                            <Save className="w-3.5 h-3.5" /> {saveItems.isPending ? 'Saving...' : 'Save'}
                          </button>
                        ) : localItems.length > 0 ? (
                          <button onClick={() => setShowPublishModal(true)} className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1 shadow-sm">
                            <CalendarDays className="w-3.5 h-3.5" /> Publish
                          </button>
                        ) : null}
                      </>
                    )}
                    {tab === 'schedules' && (
                      <button onClick={() => setShowPublishModal(true)} className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1 shadow-sm">
                        <Plus className="w-3.5 h-3.5" /> Add Schedule
                      </button>
                    )}
                  </div>
                </div>

                {/* Content based on tab */}
                <div className="flex-1 p-5 overflow-y-auto">
                  {tab === 'editor' && selectedPlaylist.template ? (
                    /* ─── Template Layout Info ─── */
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                      <div className="w-16 h-16 rounded-2xl bg-violet-100 flex items-center justify-center mb-4">
                        <LayoutTemplate className="w-8 h-8 text-violet-500" />
                      </div>
                      <h3 className="text-base font-bold text-slate-700">{selectedPlaylist.template.name}</h3>
                      <p className="text-xs text-slate-400 mt-1 mb-1">Template-based layout • {selectedPlaylist.template.screenWidth}×{selectedPlaylist.template.screenHeight}</p>
                      <span className="text-[10px] font-semibold bg-violet-100 text-violet-600 px-3 py-1 rounded-full uppercase tracking-wider mb-6">
                        {selectedPlaylist.template.category}
                      </span>
                      <p className="text-xs text-slate-400 max-w-sm mb-6">
                        This playlist uses a multi-zone template layout with live widgets (clock, weather, announcements, etc).
                        Schedule it to your screens using the Schedules tab.
                      </p>
                      <button
                        onClick={() => { window.location.href = window.location.pathname.replace('/playlists', '/templates'); }}
                        className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit Template
                      </button>
                    </div>
                  ) : tab === 'editor' ? (
                    /* ─── Editor Tab ─── */
                    localItems.length > 0 ? (
                      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd} modifiers={[restrictToVerticalAxis]}>
                        <SortableContext items={localItems.map((s: any) => s.id)} strategy={verticalListSortingStrategy}>
                          <div className="space-y-2">
                            {localItems.map((item: any, i: number) => (
                              <SortableItem key={item.id} item={item} index={i} onRemove={handleRemove} onDurationChange={handleDuration} />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
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
                    /* ─── Schedules Tab ─── */
                    <div className="space-y-4">
                      {playlistSchedules.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                          <CalendarDays className="w-10 h-10 text-slate-200 mb-3" />
                          <p className="text-sm font-medium text-slate-400">No schedules yet</p>
                          <p className="text-xs text-slate-300 mt-1 mb-4">Publish this playlist to a screen group with optional time scheduling</p>
                          <button onClick={() => setShowPublishModal(true)} className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5">
                            <Plus className="w-3.5 h-3.5" /> Add Schedule
                          </button>
                        </div>
                      ) : (
                        playlistSchedules.map((sched: any) => (
                          <div key={sched.id} className={`p-5 rounded-3xl transition-all duration-300 border-transparent shadow-sm ${sched.isActive ? 'bg-emerald-50/50 hover:bg-emerald-50/80' : 'bg-slate-50 opacity-60'}`}>
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={`w-2 h-2 rounded-full ${sched.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`} />
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
                                    <span className="bg-sky-100 text-sky-700 px-2 py-0.5 rounded">{sched.timeStart} – {sched.timeEnd}</span>
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
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center p-12 text-center">
                <div>
                  <Play className="w-12 h-12 text-slate-200 mx-auto mb-3" />
                  <h3 className="text-sm font-semibold text-slate-500">Select a playlist</h3>
                  <p className="text-xs text-slate-400 mt-1">Choose from the left to edit its timeline</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── Asset Picker Modal ─── */}
      {showPicker && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowPicker(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[75vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center">
              <h3 className="text-base font-bold text-slate-800">Add Media to Playlist</h3>
              <button onClick={() => setShowPicker(false)} className="text-slate-400 hover:text-slate-600 text-lg">✕</button>
            </div>
            <div className="px-5 py-3 border-b border-slate-50 flex gap-1 bg-slate-50/50">
              {(['all', 'images', 'videos', 'audio', 'urls'] as const).map(f => (
                <button key={f} onClick={() => setPickerFilter(f)} className={`px-3 py-1 text-xs font-semibold rounded-md ${pickerFilter === f ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {pickerAssets.length === 0 ? (
                <div className="text-center py-12 text-sm text-slate-400">No assets found. Upload media on the Assets page first.</div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  {pickerAssets.map((asset: any) => {
                    const thumb = thumbUrl(asset);
                    const name = assetName(asset);
                    return (
                      <button
                        key={asset.id}
                        onClick={() => handleAddAsset(asset)}
                        className="rounded-xl border border-slate-200 overflow-hidden hover:border-indigo-300 hover:shadow-md transition-all text-left group"
                      >
                        <div className="aspect-video bg-slate-50 flex items-center justify-center overflow-hidden relative">
                          {thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={thumb} alt="" className="w-full h-full object-cover" />
                          ) : (
                            mimeIcon(asset.mimeType, 'w-6 h-6')
                          )}
                          <div className="absolute inset-0 bg-indigo-600/0 group-hover:bg-indigo-600/10 transition-colors flex items-center justify-center">
                            <Plus className="w-6 h-6 text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </div>
                        </div>
                        <div className="p-2">
                          <p className="text-[11px] font-medium text-slate-600 truncate">{name}</p>
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
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowPublishModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-1">Publish to Screens</h3>
            <p className="text-sm text-slate-500 mb-5">
              Schedule <span className="font-bold text-slate-800">{selectedPlaylist?.name}</span> to play on a screen group.
            </p>

            {/* Screen group selector */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Publish Target</label>
              <select
                value={schedTarget}
                onChange={e => setSchedTarget(e.target.value)}
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-sky-500"
              >
                <option value="">-- Choose a group or screen --</option>
                {screenGroups && screenGroups.length > 0 && (
                  <optgroup label="Screen Groups (Publish to all)">
                    {screenGroups.map((g: any) => (
                      <option key={`g-${g.id}`} value={`group-${g.id}`}>{g.name} ({g.screens?.length || 0} screens)</option>
                    ))}
                  </optgroup>
                )}
                {screens && screens.filter((s:any) => !s.screenGroupId).length > 0 && (
                  <optgroup label="Ungrouped Screens">
                    {screens.filter((s:any) => !s.screenGroupId).map((s: any) => (
                      <option key={`s-${s.id}`} value={`screen-${s.id}`}>{s.name}</option>
                    ))}
                  </optgroup>
                )}
                {screenGroups?.map((g: any) => g.screens && g.screens.length > 0 ? (
                  <optgroup key={`opt-${g.id}`} label={`Screens inside: ${g.name}`}>
                    {g.screens.map((s: any) => (
                      <option key={`s-${s.id}`} value={`screen-${s.id}`}>{s.name}</option>
                    ))}
                  </optgroup>
                ) : null)}
              </select>
              {(!screenGroups || screenGroups.length === 0) && (!screens || screens.length === 0) && (
                <p className="text-[10px] text-amber-600 mt-1">No screens or groups exist. Pair a device on the Screens page first.</p>
              )}
            </div>

            {/* Schedule mode */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">When to Play</label>
              <div className="flex bg-slate-100 rounded-lg p-0.5">
                <button
                  onClick={() => setSchedMode('always')}
                  className={`flex-1 px-3 py-2 text-xs font-semibold rounded-md transition-colors ${schedMode === 'always' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}
                >
                  🔁 Always (24/7)
                </button>
                <button
                  onClick={() => setSchedMode('scheduled')}
                  className={`flex-1 px-3 py-2 text-xs font-semibold rounded-md transition-colors ${schedMode === 'scheduled' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'}`}
                >
                  📅 Scheduled
                </button>
              </div>
            </div>

            {/* Scheduled options */}
            {schedMode === 'scheduled' && (
              <div className="space-y-4 mb-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                {/* Days of week */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-2">Days of Week</label>
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
                {/* Time range */}
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-2">Time Window</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="time" value={schedTimeStart} onChange={e => setSchedTimeStart(e.target.value)}
                      className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-slate-400 font-semibold">to</span>
                    <input
                      type="time" value={schedTimeEnd} onChange={e => setSchedTimeEnd(e.target.value)}
                      className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3 mt-2">
              <button onClick={() => setShowPublishModal(false)} className="px-4 py-2.5 text-slate-500 hover:text-slate-800 text-sm font-semibold rounded-lg hover:bg-slate-50">
                Cancel
              </button>
              <button
                disabled={!schedTarget || createSchedule.isPending}
                onClick={handlePublish}
                className="px-5 py-2.5 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg shadow-sm flex items-center gap-2"
              >
                {createSchedule.isPending ? 'Publishing...' : (
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
