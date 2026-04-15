"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  LayoutTemplate, Plus, Loader2, Trash2, Copy, ArrowLeft, Save,
  Grid3X3, Pencil, X, Monitor, Smartphone, Settings2, Eye,
  Play, Image as ImageIcon, Globe, Type, Bell, Clock, Cloud,
  Timer, CalendarDays, Megaphone, UtensilsCrossed, Users, Rss,
  Share2, Shield, ArrowRight, Square, FileText, ListVideo,
  AlignLeft, AlignCenter, AlignRight, AlignStartVertical, AlignEndVertical,
  Layers, ChevronUp, ChevronDown, Lock, Unlock, GripVertical,
  ZoomIn, ZoomOut, Maximize2, RotateCcw, Palette, MousePointer,
  PanelLeft, Sparkles, Search, FolderOpen, ChevronRight,
} from 'lucide-react';
import {
  useTemplates, useCreateTemplate, useDeleteTemplate, useCreateFromPreset,
  useDuplicateTemplate, useUpdateTemplate, useUpdateTemplateZones,
  useAssets, usePlaylists, useCreatePlaylist,
} from '@/hooks/use-api';
import { WidgetPreview } from '@/components/widgets/WidgetRenderer';

// ─────────────────────────────────────────────────────
// Constants & Helpers
// ─────────────────────────────────────────────────────

const CATEGORY_TABS = [
  { key: '', label: 'All' },
  { key: 'LOBBY', label: 'Lobby' },
  { key: 'HALLWAY', label: 'Hallway' },
  { key: 'CAFETERIA', label: 'Cafeteria' },
  { key: 'CLASSROOM', label: 'Classroom' },
  { key: 'OFFICE', label: 'Office' },
  { key: 'GYM', label: 'Gym' },
  { key: 'LIBRARY', label: 'Library' },
  { key: 'CUSTOM', label: 'Custom' },
];

const RESOLUTION_PRESETS = [
  { label: 'Full HD', sub: 'Landscape', w: 1920, h: 1080 },
  { label: 'Full HD', sub: 'Portrait', w: 1080, h: 1920 },
  { label: '4K', sub: 'Landscape', w: 3840, h: 2160 },
  { label: '4K', sub: 'Portrait', w: 2160, h: 3840 },
  { label: '720p', sub: 'Landscape', w: 1280, h: 720 },
  { label: 'Ultra-Wide', sub: '21:9', w: 2560, h: 1080 },
  { label: 'LED Banner', sub: '5:1', w: 2500, h: 500 },
  { label: 'LED Tall', sub: '1:3', w: 480, h: 1440 },
  { label: 'Square', sub: '1:1', w: 1080, h: 1080 },
];

const WIDGET_GROUPS = [
  {
    label: 'Media',
    types: [
      { type: 'VIDEO', label: 'Video Player', desc: 'Play a video file or stream', icon: Play },
      { type: 'IMAGE', label: 'Single Image', desc: 'Display a photo or graphic', icon: ImageIcon },
      { type: 'IMAGE_CAROUSEL', label: 'Photo Slideshow', desc: 'Rotate through photos automatically', icon: ImageIcon },
      { type: 'PLAYLIST', label: 'Content Playlist', desc: 'Play mixed content from a playlist', icon: ListVideo },
    ],
  },
  {
    label: 'Web & Text',
    types: [
      { type: 'WEBPAGE', label: 'Website', desc: 'Embed any website or web app', icon: Globe },
      { type: 'TEXT', label: 'Text Block', desc: 'Simple text with custom styling', icon: Type },
      { type: 'RICH_TEXT', label: 'Rich Text', desc: 'Formatted text with headings & links', icon: FileText },
      { type: 'RSS_FEED', label: 'News Feed', desc: 'Headlines from any RSS source', icon: Rss },
      { type: 'SOCIAL_FEED', label: 'Social Media', desc: 'Posts from social accounts', icon: Share2 },
    ],
  },
  {
    label: 'Education',
    types: [
      { type: 'ANNOUNCEMENT', label: 'Announcement', desc: 'Eye-catching important message', icon: Megaphone },
      { type: 'BELL_SCHEDULE', label: 'Bell Schedule', desc: 'Class periods with highlights', icon: Bell },
      { type: 'LUNCH_MENU', label: 'Lunch Menu', desc: "Today's cafeteria menu", icon: UtensilsCrossed },
      { type: 'CALENDAR', label: 'Calendar', desc: 'Upcoming events from a feed', icon: CalendarDays },
      { type: 'COUNTDOWN', label: 'Countdown', desc: 'Count down to a special event', icon: Timer },
      { type: 'STAFF_SPOTLIGHT', label: 'Spotlight', desc: 'Feature a teacher or staff', icon: Users },
    ],
  },
  {
    label: 'Utility',
    types: [
      { type: 'CLOCK', label: 'Clock', desc: 'Current time display', icon: Clock },
      { type: 'WEATHER', label: 'Weather', desc: 'Local weather & forecast', icon: Cloud },
      { type: 'LOGO', label: 'School Logo', desc: 'Display your logo', icon: Shield },
      { type: 'TICKER', label: 'Scrolling Ticker', desc: 'Scrolling text banner', icon: ArrowRight },
      { type: 'EMPTY', label: 'Placeholder', desc: 'Reserve a zone for later', icon: Square },
    ],
  },
];

const WIDGET_ICONS: Record<string, any> = {};
const WIDGET_LABELS: Record<string, string> = {};
WIDGET_GROUPS.forEach(g => g.types.forEach(t => { WIDGET_ICONS[t.type] = t.icon; WIDGET_LABELS[t.type] = t.label; }));

const ZONE_COLORS: Record<string, { bg: string; border: string; text: string; accent: string }> = {
  VIDEO:           { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#8b5cf6' },
  IMAGE:           { bg: '#f0f9ff', border: '#93c5fd', text: '#1d4ed8', accent: '#3b82f6' },
  IMAGE_CAROUSEL:  { bg: '#f0f9ff', border: '#93c5fd', text: '#1d4ed8', accent: '#3b82f6' },
  PLAYLIST:        { bg: '#f5f3ff', border: '#c4b5fd', text: '#6d28d9', accent: '#8b5cf6' },
  WEBPAGE:         { bg: '#ecfdf5', border: '#6ee7b7', text: '#047857', accent: '#10b981' },
  TEXT:            { bg: '#f8fafc', border: '#cbd5e1', text: '#334155', accent: '#64748b' },
  RICH_TEXT:       { bg: '#f8fafc', border: '#cbd5e1', text: '#334155', accent: '#64748b' },
  RSS_FEED:        { bg: '#fff7ed', border: '#fdba74', text: '#c2410c', accent: '#f97316' },
  SOCIAL_FEED:     { bg: '#fdf2f8', border: '#f9a8d4', text: '#be185d', accent: '#ec4899' },
  ANNOUNCEMENT:    { bg: '#fffbeb', border: '#fcd34d', text: '#a16207', accent: '#f59e0b' },
  BELL_SCHEDULE:   { bg: '#eef2ff', border: '#a5b4fc', text: '#4338ca', accent: '#6366f1' },
  LUNCH_MENU:      { bg: '#f0fdf4', border: '#86efac', text: '#15803d', accent: '#22c55e' },
  CALENDAR:        { bg: '#eff6ff', border: '#93c5fd', text: '#1e40af', accent: '#3b82f6' },
  COUNTDOWN:       { bg: '#fff1f2', border: '#fda4af', text: '#be123c', accent: '#f43f5e' },
  STAFF_SPOTLIGHT: { bg: '#f0fdfa', border: '#5eead4', text: '#0f766e', accent: '#14b8a6' },
  CLOCK:           { bg: '#f9fafb', border: '#d1d5db', text: '#374151', accent: '#6b7280' },
  WEATHER:         { bg: '#ecfeff', border: '#67e8f9', text: '#0e7490', accent: '#06b6d4' },
  LOGO:            { bg: '#eef2ff', border: '#a5b4fc', text: '#4338ca', accent: '#6366f1' },
  TICKER:          { bg: '#fffbeb', border: '#fcd34d', text: '#a16207', accent: '#f59e0b' },
  EMPTY:           { bg: '#f8fafc', border: '#e2e8f0', text: '#94a3b8', accent: '#cbd5e1' },
};

function getZoneColor(type: string) {
  return ZONE_COLORS[type] || ZONE_COLORS.EMPTY;
}

function formatRes(w: number, h: number) {
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b);
  const d = gcd(w, h);
  return `${w}×${h} (${w/d}:${h/d})`;
}

// ─────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────

interface Zone {
  id?: string;
  name: string;
  widgetType: string;
  x: number; y: number;
  width: number; height: number;
  zIndex?: number;
  sortOrder?: number;
  defaultConfig?: any;
}

interface Template {
  id: string;
  name: string;
  description?: string;
  category: string;
  orientation: string;
  screenWidth: number;
  screenHeight: number;
  isSystem: boolean;
  status: string;
  bgColor?: string | null;
  bgImage?: string | null;
  bgGradient?: string | null;
  zones: Zone[];
  _count?: { zones: number };
  createdAt: string;
  updatedAt: string;
}

// ═════════════════════════════════════════════════════
// MAIN PAGE
// ═════════════════════════════════════════════════════

export default function TemplatesPage() {
  const [activeCategory, setActiveCategory] = useState('');
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('CUSTOM');
  const [newW, setNewW] = useState(1920);
  const [newH, setNewH] = useState(1080);
  const [customRes, setCustomRes] = useState(false);

  const { data: templates, isLoading } = useTemplates();
  const createTemplate = useCreateTemplate();
  const createFromPreset = useCreateFromPreset();
  const duplicateTemplate = useDuplicateTemplate();
  const deleteTemplate = useDeleteTemplate();

  const filtered = templates?.filter((t: Template) => !activeCategory || t.category === activeCategory) || [];
  const systemTemplates = filtered.filter((t: Template) => t.isSystem);
  const customTemplates = filtered.filter((t: Template) => !t.isSystem);

  async function handleCreate() {
    if (!newName.trim()) return;
    const result = await createTemplate.mutateAsync({
      name: newName.trim(), description: newDesc.trim() || undefined,
      category: newCategory, orientation: newH > newW ? 'PORTRAIT' : 'LANDSCAPE',
      screenWidth: newW, screenHeight: newH,
      zones: [{ name: 'Full Screen', widgetType: 'EMPTY', x: 0, y: 0, width: 100, height: 100 }],
    });
    setShowCreate(false); setNewName(''); setNewDesc('');
    setNewW(1920); setNewH(1080); setCustomRes(false);
    setEditingTemplate(result);
  }

  async function handleUsePreset(preset: Template) {
    const result = await createFromPreset.mutateAsync({ presetId: preset.id, name: preset.name });
    setEditingTemplate(result);
  }

  async function handleDuplicate(template: Template) {
    const result = await duplicateTemplate.mutateAsync({ id: template.id });
    setEditingTemplate(result);
  }

  if (editingTemplate) {
    return createPortal(
      <TemplateBuilder template={editingTemplate} onBack={() => setEditingTemplate(null)} onSaved={(u) => setEditingTemplate(u)} />,
      document.body
    );
  }

  // ── Gallery ──
  return (
    <div className="space-y-8">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-purple-700 p-8 text-white">
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23fff\' fill-opacity=\'1\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/svg%3E")' }} />
        <div className="relative flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-3">
              <LayoutTemplate className="w-8 h-8 opacity-80" />
              Screen Templates
            </h1>
            <p className="text-indigo-100 mt-1.5 text-sm max-w-lg">
              Design beautiful screen layouts for every space in your school. Pick a ready-made template or build your own from scratch.
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-5 py-3 bg-white text-indigo-700 font-bold text-sm rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center gap-2"
          >
            <Plus className="w-5 h-5" /> New Template
          </button>
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl p-6 space-y-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">Create New Template</h2>
              <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-3">
              <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Template name..." autoFocus
                className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent placeholder:text-slate-400"
                onKeyDown={e => e.key === 'Enter' && handleCreate()} />
              <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Description (optional)..."
                className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent placeholder:text-slate-400" />
              <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                {CATEGORY_TABS.filter(c => c.key).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5 block">Screen Size</label>
              <div className="grid grid-cols-3 gap-2">
                {RESOLUTION_PRESETS.map(p => {
                  const active = !customRes && p.w === newW && p.h === newH;
                  return (
                    <button key={p.label+p.sub} onClick={() => { setNewW(p.w); setNewH(p.h); setCustomRes(false); }}
                      className={`px-3 py-2.5 rounded-lg text-left transition-all border-2 ${active ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-200'}`}>
                      <div className="text-xs font-bold">{p.label}</div>
                      <div className="text-[10px] opacity-60 mt-0.5">{p.sub} · {p.w}×{p.h}</div>
                    </button>
                  );
                })}
                <button onClick={() => setCustomRes(true)}
                  className={`px-3 py-2.5 rounded-lg text-left transition-all border-2 ${customRes ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-200'}`}>
                  <div className="text-xs font-bold flex items-center gap-1"><Settings2 className="w-3 h-3" /> Custom</div>
                  <div className="text-[10px] opacity-60 mt-0.5">Any resolution</div>
                </button>
              </div>
              {customRes && (
                <div className="flex items-center gap-3 mt-3">
                  <input type="number" min={100} max={15360} value={newW} onChange={e => setNewW(parseInt(e.target.value) || 1920)}
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  <span className="text-slate-400 text-xs font-bold">×</span>
                  <input type="number" min={100} max={15360} value={newH} onChange={e => setNewH(parseInt(e.target.value) || 1080)}
                    className="flex-1 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                  <span className="text-[10px] text-slate-400 w-20">{formatRes(newW, newH)}</span>
                </div>
              )}
            </div>

            <button onClick={handleCreate} disabled={!newName.trim() || createTemplate.isPending}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
              {createTemplate.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Create & Open Editor
            </button>
          </div>
        </div>
      )}

      {/* Category Tabs */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {CATEGORY_TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveCategory(tab.key)}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${activeCategory === tab.key ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-indigo-500" /></div>
      ) : (
        <>
          {systemTemplates.length > 0 && (
            <section>
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5" /> Ready-Made Templates
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {systemTemplates.map((t: Template) => (
                  <GalleryCard key={t.id} template={t} onUse={() => handleUsePreset(t)} />
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
              <FolderOpen className="w-3.5 h-3.5" /> Your Templates
              {customTemplates.length > 0 && <span className="bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">{customTemplates.length}</span>}
            </h2>
            {customTemplates.length === 0 ? (
              <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-16 text-center">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <LayoutTemplate className="w-8 h-8 text-slate-300" />
                </div>
                <p className="text-sm font-semibold text-slate-500">No custom templates yet</p>
                <p className="text-xs text-slate-400 mt-1">Use a preset above or create one from scratch</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {customTemplates.map((t: Template) => (
                  <GalleryCard key={t.id} template={t} onEdit={() => setEditingTemplate(t)} onDuplicate={() => handleDuplicate(t)} onDelete={() => { if (confirm('Delete this template?')) deleteTemplate.mutateAsync(t.id); }} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════
// GALLERY CARD — premium hover preview
// ═════════════════════════════════════════════════════

function GalleryCard({ template, onUse, onEdit, onDuplicate, onDelete }: {
  template: Template;
  onUse?: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}) {
  const zones = template.zones || [];
  const sw = template.screenWidth || 1920;
  const sh = template.screenHeight || 1080;

  return (
    <div className="group bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:border-indigo-200 transition-all duration-300 overflow-hidden">
      {/* Preview Canvas */}
      <div className="relative bg-gradient-to-br from-slate-50 to-slate-100 p-5" style={{ minHeight: 180 }}>
        <div className="relative mx-auto rounded-lg overflow-hidden border border-slate-200 bg-white shadow-sm" style={{ aspectRatio: `${sw}/${sh}`, maxWidth: '100%', maxHeight: 150 }}>
          {zones.map((zone, i) => {
            const c = getZoneColor(zone.widgetType);
            const Icon = WIDGET_ICONS[zone.widgetType] || Square;
            return (
              <div key={i} className="absolute flex flex-col items-center justify-center text-center overflow-hidden transition-all"
                style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.width}%`, height: `${zone.height}%`, zIndex: zone.zIndex || 0, backgroundColor: c.bg, borderWidth: 1, borderColor: c.border, borderStyle: 'solid' }}>
                <Icon className="w-3 h-3 mb-0.5" style={{ color: c.accent, opacity: 0.7 }} />
                <span className="text-[7px] font-bold leading-tight px-0.5 truncate max-w-full" style={{ color: c.text, opacity: 0.6 }}>
                  {WIDGET_LABELS[zone.widgetType] || zone.widgetType}
                </span>
              </div>
            );
          })}
        </div>

        {template.isSystem && (
          <div className="absolute top-3 right-3 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-[9px] font-bold px-2.5 py-1 rounded-full shadow-sm">
            PRESET
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors rounded-t-2xl" />
      </div>

      {/* Info */}
      <div className="p-4 pt-3">
        <h3 className="text-sm font-bold text-slate-800 truncate">{template.name}</h3>
        {template.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">{template.description}</p>}
        <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
          <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md text-[10px] font-bold">{template.category}</span>
          <span className="text-[10px] text-slate-400 font-mono">{sw}×{sh}</span>
          <span className="text-[10px] text-slate-400">{zones.length} zone{zones.length !== 1 ? 's' : ''}</span>
        </div>

        <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
          {onUse && (
            <button onClick={onUse} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-sm">
              <Plus className="w-3.5 h-3.5" /> Use This
            </button>
          )}
          {onEdit && (
            <button onClick={onEdit} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-sm">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
          {onDuplicate && (
            <button onClick={onDuplicate} className="py-2 px-3 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Duplicate">
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} className="py-2 px-3 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Delete">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════
// TEMPLATE BUILDER — Canva-style editor
// ═════════════════════════════════════════════════════

function TemplateBuilder({ template, onBack, onSaved }: {
  template: Template;
  onBack: () => void;
  onSaved: (t: Template) => void;
}) {
  const [zones, setZones] = useState<Zone[]>(template.zones || []);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [tName, setTName] = useState(template.name);
  const [tDesc, setTDesc] = useState(template.description || '');
  const [sW, setSW] = useState(template.screenWidth || 1920);
  const [sH, setSH] = useState(template.screenHeight || 1080);
  const [leftPanel, setLeftPanel] = useState<'widgets' | 'zones' | 'config' | null>('zones');
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [searchWidget, setSearchWidget] = useState('');
  const [bgColor, setBgColor] = useState(template.bgColor || '');
  const [bgGradient, setBgGradient] = useState(template.bgGradient || '');
  const [bgImage, setBgImage] = useState(template.bgImage || '');

  const updateTemplate = useUpdateTemplate();
  const updateZonesApi = useUpdateTemplateZones();
  const canvasRef = useRef<HTMLDivElement>(null);

  const [dragState, setDragState] = useState<{
    type: 'move' | 'resize'; zoneIdx: number;
    startX: number; startY: number; origZone: Zone; handle?: string;
  } | null>(null);

  const selected = selectedIdx !== null ? zones[selectedIdx] : null;

  function updateZone(idx: number, updates: Partial<Zone>) {
    setZones(prev => prev.map((z, i) => i === idx ? { ...z, ...updates } : z));
    setIsDirty(true); setSaveStatus('idle');
  }

  function addZone(widgetType: string) {
    const label = WIDGET_LABELS[widgetType] || widgetType;
    const newZone: Zone = { name: `${label} ${zones.length + 1}`, widgetType, x: 5, y: 5, width: 40, height: 30, zIndex: 0, sortOrder: zones.length };
    setZones(prev => [...prev, newZone]);
    setSelectedIdx(zones.length);
    setLeftPanel('config');
    setIsDirty(true); setSaveStatus('idle');
  }

  function removeZone(idx: number) {
    setZones(prev => prev.filter((_, i) => i !== idx));
    setSelectedIdx(null); setLeftPanel('zones');
    setIsDirty(true); setSaveStatus('idle');
  }

  function moveZoneLayer(idx: number, dir: 'up' | 'down') {
    setZones(prev => {
      const z = [...prev];
      const curr = z[idx].zIndex || 0;
      z[idx] = { ...z[idx], zIndex: dir === 'up' ? curr + 1 : Math.max(0, curr - 1) };
      return z;
    });
    setIsDirty(true); setSaveStatus('idle');
  }

  async function handleSave() {
    setSaveStatus('saving');
    const orientation = sH > sW ? 'PORTRAIT' : 'LANDSCAPE';
    try {
      await updateTemplate.mutateAsync({
        id: template.id, name: tName, description: tDesc, orientation, screenWidth: sW, screenHeight: sH,
        bgColor: bgColor || null, bgGradient: bgGradient || null, bgImage: bgImage || null,
      });
      const result = await updateZonesApi.mutateAsync({
        id: template.id,
        zones: zones.map((z, i) => ({
          name: z.name, widgetType: z.widgetType,
          x: Math.round(z.x * 100) / 100, y: Math.round(z.y * 100) / 100,
          width: Math.round(z.width * 100) / 100, height: Math.round(z.height * 100) / 100,
          zIndex: z.zIndex || 0, sortOrder: i, defaultConfig: z.defaultConfig,
        })),
      });
      setIsDirty(false); setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
      onSaved(result);
    } catch { setSaveStatus('idle'); }
  }

  // ── Drag handlers ──
  const handleMouseDown = useCallback((e: React.MouseEvent, zoneIdx: number, type: 'move' | 'resize', handle?: string) => {
    e.preventDefault(); e.stopPropagation();
    setSelectedIdx(zoneIdx); setLeftPanel('config');
    setDragState({ type, zoneIdx, startX: e.clientX, startY: e.clientY, origZone: { ...zones[zoneIdx] }, handle });
  }, [zones]);

  useEffect(() => {
    if (!dragState) return;
    const onMove = (e: MouseEvent) => {
      const canvas = canvasRef.current; if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dx = (e.clientX - dragState.startX) / rect.width * 100;
      const dy = (e.clientY - dragState.startY) / rect.height * 100;
      const o = dragState.origZone;
      if (dragState.type === 'move') {
        updateZone(dragState.zoneIdx, { x: Math.max(0, Math.min(100 - o.width, o.x + dx)), y: Math.max(0, Math.min(100 - o.height, o.y + dy)) });
      } else {
        const h = dragState.handle || 'se';
        let nx = o.x, ny = o.y, nw = o.width, nh = o.height;
        if (h.includes('e')) nw = Math.max(3, Math.min(100 - o.x, o.width + dx));
        if (h.includes('s')) nh = Math.max(3, Math.min(100 - o.y, o.height + dy));
        if (h.includes('w')) { const s = Math.min(dx, o.width - 3); nx = Math.max(0, o.x + s); nw = o.width - (nx - o.x); }
        if (h.includes('n')) { const s = Math.min(dy, o.height - 3); ny = Math.max(0, o.y + s); nh = o.height - (ny - o.y); }
        updateZone(dragState.zoneIdx, { x: nx, y: ny, width: nw, height: nh });
      }
    };
    const onUp = () => setDragState(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [dragState]);

  // Filtered widgets for search
  const filteredWidgets = WIDGET_GROUPS.map(g => ({
    ...g,
    types: g.types.filter(t => !searchWidget || t.label.toLowerCase().includes(searchWidget.toLowerCase()) || t.desc.toLowerCase().includes(searchWidget.toLowerCase())),
  })).filter(g => g.types.length > 0);

  return (
    <div className="fixed inset-0 bg-slate-100 z-[999] flex flex-col">
      {/* ── Top Toolbar ── */}
      <div className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="h-6 w-px bg-slate-200" />
          <div>
            <input value={tName} onChange={e => { setTName(e.target.value); setIsDirty(true); setSaveStatus('idle'); }}
              className="text-sm font-bold text-slate-800 bg-transparent outline-none w-64 hover:bg-slate-50 px-2 py-1 rounded-md -ml-2 transition-colors" placeholder="Template name..." />
          </div>
        </div>

        {/* Center: Context toolbar */}
        <div className="flex items-center gap-1">
          {selected && (
            <>
              <span className="text-[10px] font-bold text-slate-400 uppercase mr-2">Zone:</span>
              <button onClick={() => { const z = selected; updateZone(selectedIdx!, { x: 0, width: 100 }); }} className="p-1.5 hover:bg-slate-100 rounded text-slate-500" title="Align Left">
                <AlignLeft className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { updateZone(selectedIdx!, { x: (100 - selected.width) / 2 }); }} className="p-1.5 hover:bg-slate-100 rounded text-slate-500" title="Center H">
                <AlignCenter className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { updateZone(selectedIdx!, { y: (100 - selected.height) / 2 }); }} className="p-1.5 hover:bg-slate-100 rounded text-slate-500" title="Center V">
                <AlignStartVertical className="w-3.5 h-3.5" />
              </button>
              <div className="h-4 w-px bg-slate-200 mx-1" />
              <button onClick={() => moveZoneLayer(selectedIdx!, 'up')} className="p-1.5 hover:bg-slate-100 rounded text-slate-500" title="Bring Forward">
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => moveZoneLayer(selectedIdx!, 'down')} className="p-1.5 hover:bg-slate-100 rounded text-slate-500" title="Send Back">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <div className="h-4 w-px bg-slate-200 mx-1" />
              <button onClick={() => removeZone(selectedIdx!)} className="p-1.5 hover:bg-rose-50 rounded text-rose-500" title="Delete Zone">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>

        {/* Right: Save & Resolution */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-slate-400 bg-slate-50 px-2 py-1 rounded">{sW}×{sH}</span>
          {saveStatus === 'saved' && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">Saved!</span>}
          {isDirty && saveStatus === 'idle' && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded">Unsaved</span>}
          <button onClick={handleSave} disabled={saveStatus === 'saving'}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-50">
            {saveStatus === 'saving' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Panel ── */}
        <div className="w-72 bg-white border-r border-slate-200 flex flex-col shrink-0 shadow-sm">
          {/* Panel tabs */}
          <div className="flex border-b border-slate-100">
            {([
              { key: 'widgets' as const, label: 'Widgets', icon: Plus },
              { key: 'zones' as const, label: 'Layers', icon: Layers },
              { key: 'config' as const, label: 'Properties', icon: Settings2 },
            ]).map(tab => (
              <button key={tab.key} onClick={() => setLeftPanel(leftPanel === tab.key ? null : tab.key)}
                className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wider flex flex-col items-center gap-1 transition-colors ${leftPanel === tab.key ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' : 'text-slate-400 hover:text-slate-600'}`}>
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-y-auto">
            {leftPanel === 'widgets' && (
              <div className="p-3 space-y-4">
                {/* Search */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={searchWidget} onChange={e => setSearchWidget(e.target.value)} placeholder="Search widgets..."
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-400" />
                </div>

                {filteredWidgets.map(group => (
                  <div key={group.label}>
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">{group.label}</h4>
                    <div className="space-y-1">
                      {group.types.map(t => {
                        const c = getZoneColor(t.type);
                        return (
                          <button key={t.type} onClick={() => addZone(t.type)}
                            className="w-full flex items-center gap-3 p-2.5 rounded-xl text-left transition-all hover:shadow-md hover:scale-[1.02] border"
                            style={{ backgroundColor: c.bg, borderColor: c.border }}>
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: c.accent + '20' }}>
                              <t.icon className="w-4 h-4" style={{ color: c.accent }} />
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-bold truncate" style={{ color: c.text }}>{t.label}</div>
                              <div className="text-[10px] opacity-60 truncate" style={{ color: c.text }}>{t.desc}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {leftPanel === 'zones' && (
              <div className="p-3 space-y-1">
                {zones.length === 0 && (
                  <div className="text-center py-8">
                    <Layers className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                    <p className="text-xs text-slate-400">No zones yet</p>
                    <button onClick={() => setLeftPanel('widgets')} className="text-xs text-indigo-600 font-bold mt-1 hover:underline">Add a widget</button>
                  </div>
                )}
                {[...zones].reverse().map((z, ri) => {
                  const idx = zones.length - 1 - ri;
                  const c = getZoneColor(z.widgetType);
                  const Icon = WIDGET_ICONS[z.widgetType] || Square;
                  const isSelected = selectedIdx === idx;
                  return (
                    <button key={idx} onClick={() => { setSelectedIdx(idx); setLeftPanel('config'); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all ${isSelected ? 'bg-indigo-50 ring-1 ring-indigo-300' : 'hover:bg-slate-50'}`}>
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: c.bg, borderWidth: 1, borderColor: c.border }}>
                        <Icon className="w-3.5 h-3.5" style={{ color: c.accent }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-slate-700 truncate">{z.name}</div>
                        <div className="text-[10px] text-slate-400">{WIDGET_LABELS[z.widgetType]} · z{z.zIndex || 0}</div>
                      </div>
                      <ChevronRight className="w-3 h-3 text-slate-300 shrink-0" />
                    </button>
                  );
                })}
              </div>
            )}

            {leftPanel === 'config' && selected && selectedIdx !== null && (
              <div className="p-3 space-y-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Zone Name</label>
                  <input value={selected.name} onChange={e => updateZone(selectedIdx, { name: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Widget Type</label>
                  <select value={selected.widgetType} onChange={e => updateZone(selectedIdx, { widgetType: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
                    {WIDGET_GROUPS.map(g => (
                      <optgroup key={g.label} label={g.label}>
                        {g.types.map(t => <option key={t.type} value={t.type}>{t.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Position & Size</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['x', 'y', 'width', 'height'] as const).map(prop => (
                      <div key={prop} className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[9px] font-bold text-slate-400 uppercase">
                          {prop === 'width' ? 'W' : prop === 'height' ? 'H' : prop.toUpperCase()}
                        </span>
                        <input type="number" min={0} max={100} step={0.5}
                          value={Math.round(selected[prop] * 100) / 100}
                          onChange={e => updateZone(selectedIdx, { [prop]: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
                          className="w-full pl-8 pr-2 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">Layer (z-index)</label>
                  <input type="number" min={0} max={100} value={selected.zIndex || 0}
                    onChange={e => updateZone(selectedIdx, { zIndex: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">Quick Layout</label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { label: 'Full', x: 0, y: 0, width: 100, height: 100 },
                      { label: 'Left ½', x: 0, y: 0, width: 50, height: 100 },
                      { label: 'Right ½', x: 50, y: 0, width: 50, height: 100 },
                      { label: 'Top ½', x: 0, y: 0, width: 100, height: 50 },
                      { label: 'Bottom ½', x: 0, y: 50, width: 100, height: 50 },
                      { label: 'Top Bar', x: 0, y: 0, width: 100, height: 15 },
                      { label: 'Btm Bar', x: 0, y: 85, width: 100, height: 15 },
                      { label: 'Quarter', x: 0, y: 0, width: 50, height: 50 },
                      { label: 'Sidebar', x: 70, y: 0, width: 30, height: 100 },
                    ].map(p => (
                      <button key={p.label} onClick={() => updateZone(selectedIdx, { x: p.x, y: p.y, width: p.width, height: p.height })}
                        className="py-1.5 text-[10px] font-bold rounded-lg border border-slate-200 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 transition-colors">
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Widget-specific config */}
                <WidgetConfig zone={selected} idx={selectedIdx} updateZone={updateZone} />
              </div>
            )}

            {leftPanel === 'config' && !selected && (
              <div className="p-3 text-center py-12">
                <MousePointer className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-xs font-medium text-slate-400">Select a zone on the canvas</p>
                <p className="text-[10px] text-slate-300 mt-1">Click any zone to edit its properties</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Canvas Area ── */}
        <div className="flex-1 flex items-center justify-center bg-slate-100 p-8 overflow-auto">
          <div
            ref={canvasRef}
            className="relative rounded-xl shadow-2xl overflow-hidden select-none ring-1 ring-slate-200"
            style={{
              width: '100%', maxWidth: 900, aspectRatio: `${sW}/${sH}`,
              backgroundColor: bgColor || '#ffffff',
              ...(bgGradient ? { background: bgGradient } : {}),
              ...(bgImage ? { backgroundImage: `url(${bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
            }}
            onClick={() => { setSelectedIdx(null); }}
          >
            {/* Subtle grid overlay (dimmer when background is set) */}
            <div className={`absolute inset-0 pointer-events-none ${bgColor || bgGradient || bgImage ? 'opacity-10' : 'opacity-30'}`} style={{
              backgroundImage: 'linear-gradient(to right, #e2e8f0 1px, transparent 1px), linear-gradient(to bottom, #e2e8f0 1px, transparent 1px)',
              backgroundSize: '5% 5%',
            }} />

            {zones.map((zone, idx) => {
              const c = getZoneColor(zone.widgetType);
              const Icon = WIDGET_ICONS[zone.widgetType] || Square;
              const isSelected = selectedIdx === idx;

              return (
                <div key={idx}
                  className={`absolute transition-shadow cursor-move ${isSelected ? 'shadow-xl' : 'hover:shadow-md'}`}
                  style={{
                    left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.width}%`, height: `${zone.height}%`,
                    zIndex: (zone.zIndex || 0) + (isSelected ? 100 : 0),
                    backgroundColor: c.bg, borderWidth: 2, borderColor: isSelected ? c.accent : c.border, borderStyle: 'solid',
                    borderRadius: 8,
                    boxShadow: isSelected ? `0 0 0 2px ${c.accent}40` : undefined,
                  }}
                  onClick={e => { e.stopPropagation(); setSelectedIdx(idx); setLeftPanel('config'); }}
                  onMouseDown={e => handleMouseDown(e, idx, 'move')}
                >
                  {/* Live widget preview */}
                  <div className="absolute inset-0 overflow-hidden rounded-[6px] pointer-events-none">
                    <WidgetPreview
                      widgetType={zone.widgetType}
                      config={zone.defaultConfig}
                      width={zone.width}
                      height={zone.height}
                    />
                  </div>
                  {/* Floating label badge */}
                  <div className="absolute bottom-1 left-1 pointer-events-none flex items-center gap-1 bg-black/50 backdrop-blur-sm rounded px-1.5 py-0.5 max-w-[90%]">
                    <Icon className="w-3 h-3 flex-shrink-0 text-white/80" />
                    <span className="text-[9px] font-semibold text-white/90 truncate">{zone.name}</span>
                  </div>

                  {/* Resize handles */}
                  {isSelected && (
                    <>
                      {(['nw','ne','sw','se','n','s','e','w'] as const).map(handle => (
                        <div key={handle}
                          className={`absolute w-3 h-3 rounded-full shadow-md z-50 ${
                            handle === 'nw' ? 'top-[-6px] left-[-6px] cursor-nw-resize' :
                            handle === 'ne' ? 'top-[-6px] right-[-6px] cursor-ne-resize' :
                            handle === 'sw' ? 'bottom-[-6px] left-[-6px] cursor-sw-resize' :
                            handle === 'se' ? 'bottom-[-6px] right-[-6px] cursor-se-resize' :
                            handle === 'n'  ? 'top-[-6px] left-1/2 -translate-x-1/2 cursor-n-resize' :
                            handle === 's'  ? 'bottom-[-6px] left-1/2 -translate-x-1/2 cursor-s-resize' :
                            handle === 'e'  ? 'top-1/2 right-[-6px] -translate-y-1/2 cursor-e-resize' :
                                              'top-1/2 left-[-6px] -translate-y-1/2 cursor-w-resize'
                          }`}
                          style={{ backgroundColor: c.accent, border: '2px solid white' }}
                          onMouseDown={e => handleMouseDown(e, idx, 'resize', handle)}
                        />
                      ))}
                    </>
                  )}
                </div>
              );
            })}

            {zones.length === 0 && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-300">
                <Grid3X3 className="w-12 h-12 mb-3 opacity-40" />
                <p className="text-sm font-semibold">Empty Canvas</p>
                <p className="text-xs mt-1 opacity-60">Add a widget from the left panel to get started</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════
// WIDGET CONFIG — per-widget-type settings
// ═════════════════════════════════════════════════════

function AssetPicker({ mimeFilter, selectedIds, onSelect, onRemove, multiple = false }: {
  mimeFilter: 'image' | 'video' | 'all';
  selectedIds: string[];
  onSelect: (asset: any) => void;
  onRemove: (id: string) => void;
  multiple?: boolean;
}) {
  const { data: assets, isLoading } = useAssets();
  const [showBrowser, setShowBrowser] = useState(false);
  const [searchAsset, setSearchAsset] = useState('');

  const filtered = (assets || []).filter((a: any) => {
    if (a.status !== 'APPROVED' && a.status !== 'PENDING_APPROVAL') return false;
    if (mimeFilter === 'image') return a.mimeType?.startsWith('image/');
    if (mimeFilter === 'video') return a.mimeType?.startsWith('video/');
    return true;
  }).filter((a: any) => !searchAsset || (a.originalName || a.fileUrl || '').toLowerCase().includes(searchAsset.toLowerCase()));

  const selectedAssets = (assets || []).filter((a: any) => selectedIds.includes(a.id));
  const isImage = (a: any) => a.mimeType?.startsWith('image/');

  return (
    <div className="space-y-2">
      {/* Selected assets preview */}
      {selectedAssets.length > 0 && (
        <div className="space-y-1.5">
          {selectedAssets.map((a: any) => (
            <div key={a.id} className="flex items-center gap-2 bg-white rounded-lg border border-slate-200 p-1.5">
              {isImage(a) ? (
                <img src={a.fileUrl} alt={a.originalName} className="w-10 h-10 object-cover rounded-md bg-slate-100" />
              ) : (
                <div className="w-10 h-10 bg-slate-100 rounded-md flex items-center justify-center">
                  <Play className="w-4 h-4 text-slate-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-slate-700 truncate">{a.originalName || 'Untitled'}</p>
                <p className="text-[9px] text-slate-400">{a.mimeType}</p>
              </div>
              <button onClick={() => onRemove(a.id)} className="p-1 text-slate-300 hover:text-rose-500 shrink-0"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      {/* Browse button */}
      <button onClick={() => setShowBrowser(!showBrowser)}
        className="w-full py-2.5 px-3 rounded-lg border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 text-xs font-bold text-slate-500 hover:text-indigo-600 transition-all flex items-center justify-center gap-2">
        <ImageIcon className="w-3.5 h-3.5" />
        {selectedAssets.length > 0 ? (multiple ? 'Add More Assets' : 'Change Asset') : 'Browse Assets'}
      </button>

      {/* Asset browser dropdown */}
      {showBrowser && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-lg overflow-hidden">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={searchAsset} onChange={e => setSearchAsset(e.target.value)} placeholder="Search assets..."
                className="w-full pl-7 pr-2 py-1.5 rounded-md bg-slate-50 border border-slate-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-300 placeholder:text-slate-400" />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto p-1.5">
            {isLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-4">
                <ImageIcon className="w-6 h-6 text-slate-200 mx-auto mb-1" />
                <p className="text-[10px] text-slate-400 font-medium">No {mimeFilter !== 'all' ? mimeFilter : ''} assets found</p>
                <p className="text-[9px] text-slate-300 mt-0.5">Upload assets from the Assets page first</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {filtered.map((a: any) => {
                  const isSelected = selectedIds.includes(a.id);
                  return (
                    <button key={a.id} onClick={() => { onSelect(a); if (!multiple) setShowBrowser(false); }}
                      className={`relative group rounded-lg overflow-hidden border-2 transition-all ${isSelected ? 'border-indigo-500 ring-1 ring-indigo-300' : 'border-transparent hover:border-indigo-200'}`}>
                      {isImage(a) ? (
                        <img src={a.fileUrl} alt={a.originalName} className="w-full aspect-square object-cover bg-slate-100" />
                      ) : (
                        <div className="w-full aspect-square bg-slate-100 flex flex-col items-center justify-center gap-0.5">
                          <Play className="w-4 h-4 text-slate-400" />
                          <span className="text-[8px] text-slate-400 truncate max-w-full px-1">{(a.originalName || '').split('.').pop()}</span>
                        </div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-black/60 px-1 py-0.5">
                        <p className="text-[8px] text-white truncate">{a.originalName || 'Untitled'}</p>
                      </div>
                      {isSelected && (
                        <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-indigo-600 rounded-full flex items-center justify-center">
                          <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WidgetConfig({ zone, idx, updateZone }: { zone: Zone; idx: number; updateZone: (i: number, u: Partial<Zone>) => void }) {
  const config = zone.defaultConfig || {};
  const setConfig = (updates: Record<string, any>) => {
    updateZone(idx, { defaultConfig: { ...config, ...updates } });
  };

  const inputClass = "w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 placeholder:text-slate-400";

  if (zone.widgetType === 'WEBPAGE') {
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Website URL</label>
        <input value={config.url || ''} onChange={e => setConfig({ url: e.target.value })} placeholder="https://example.com" className={inputClass} />
      </div>
    );
  }
  if (zone.widgetType === 'TEXT') {
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Text Content</label>
        <textarea value={config.content || ''} onChange={e => setConfig({ content: e.target.value })} placeholder="Enter your text..." rows={3}
          className={inputClass + " resize-none"} />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">Font Size</label>
            <input type="number" min={10} max={120} value={config.fontSize || 24} onChange={e => setConfig({ fontSize: parseInt(e.target.value) || 24 })} className={inputClass} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">Align</label>
            <select value={config.alignment || 'center'} onChange={e => setConfig({ alignment: e.target.value })} className={inputClass}>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">Text Color</label>
            <input type="color" value={config.color || '#000000'} onChange={e => setConfig({ color: e.target.value })} className="w-full h-9 rounded-lg border border-slate-200 cursor-pointer" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">Background</label>
            <input type="color" value={config.bgColor || '#ffffff'} onChange={e => setConfig({ bgColor: e.target.value })} className="w-full h-9 rounded-lg border border-slate-200 cursor-pointer" />
          </div>
        </div>
      </div>
    );
  }
  if (zone.widgetType === 'ANNOUNCEMENT') {
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Announcement</label>
        <textarea value={config.message || ''} onChange={e => setConfig({ message: e.target.value })} placeholder="Enter announcement text..." rows={3}
          className={inputClass + " resize-none"} />
        <div>
          <label className="text-[10px] font-bold text-slate-400 block mb-1">Priority</label>
          <select value={config.priority || 'normal'} onChange={e => setConfig({ priority: e.target.value })} className={inputClass}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>
      </div>
    );
  }
  if (zone.widgetType === 'CLOCK') {
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Clock Settings</label>
        <select value={config.format || '12h'} onChange={e => setConfig({ format: e.target.value })} className={inputClass}>
          <option value="12h">12-hour (3:30 PM)</option>
          <option value="24h">24-hour (15:30)</option>
        </select>
        <div>
          <label className="text-[10px] font-bold text-slate-400 block mb-1">Timezone</label>
          <select value={config.timezone || ''} onChange={e => setConfig({ timezone: e.target.value || undefined })} className={inputClass}>
            <option value="">Auto (device local)</option>
            <option value="America/New_York">Eastern (ET)</option>
            <option value="America/Chicago">Central (CT)</option>
            <option value="America/Denver">Mountain (MT)</option>
            <option value="America/Los_Angeles">Pacific (PT)</option>
            <option value="America/Anchorage">Alaska (AKT)</option>
            <option value="Pacific/Honolulu">Hawaii (HT)</option>
            <option value="America/Phoenix">Arizona (no DST)</option>
            <option value="Europe/London">London (GMT/BST)</option>
            <option value="Europe/Paris">Central Europe (CET)</option>
            <option value="Asia/Tokyo">Tokyo (JST)</option>
            <option value="Asia/Shanghai">China (CST)</option>
            <option value="Australia/Sydney">Sydney (AEST)</option>
          </select>
          <p className="text-[9px] text-slate-400 mt-1">Leave on Auto to use the screen's local time</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">Text Color</label>
            <input type="color" value={config.color || '#000000'} onChange={e => setConfig({ color: e.target.value })} className="w-full h-9 rounded-lg border border-slate-200 cursor-pointer" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 block mb-1">Background</label>
            <input type="color" value={config.bgColor || '#ffffff'} onChange={e => setConfig({ bgColor: e.target.value })} className="w-full h-9 rounded-lg border border-slate-200 cursor-pointer" />
          </div>
        </div>
      </div>
    );
  }
  if (zone.widgetType === 'COUNTDOWN') {
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Countdown</label>
        <input value={config.label || ''} onChange={e => setConfig({ label: e.target.value })} placeholder="e.g. Days until Winter Break" className={inputClass} />
        <input type="date" value={config.targetDate || ''} onChange={e => setConfig({ targetDate: e.target.value })} className={inputClass} />
      </div>
    );
  }
  if (zone.widgetType === 'TICKER') {
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Ticker Messages</label>
        <textarea value={(config.messages || []).join('\n')} onChange={e => setConfig({ messages: e.target.value.split('\n').filter(Boolean) })}
          placeholder="One message per line..." rows={4} className={inputClass + " resize-none"} />
        <div>
          <label className="text-[10px] font-bold text-slate-400 block mb-1">Speed</label>
          <select value={config.speed || 'medium'} onChange={e => setConfig({ speed: e.target.value })} className={inputClass}>
            <option value="slow">Slow</option>
            <option value="medium">Medium</option>
            <option value="fast">Fast</option>
          </select>
        </div>
      </div>
    );
  }
  if (zone.widgetType === 'IMAGE' || zone.widgetType === 'LOGO') {
    const selectedIds = config.assetId ? [config.assetId] : [];
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
          {zone.widgetType === 'LOGO' ? 'Logo Image' : 'Image Content'}
        </label>
        <AssetPicker mimeFilter="image" selectedIds={selectedIds}
          onSelect={(a) => setConfig({ assetId: a.id, assetUrl: a.fileUrl, assetName: a.originalName })}
          onRemove={() => setConfig({ assetId: null, assetUrl: null, assetName: null })} />
        <select value={config.fitMode || 'cover'} onChange={e => setConfig({ fitMode: e.target.value })} className={inputClass}>
          <option value="cover">Cover (fill zone)</option>
          <option value="contain">Contain (fit inside)</option>
          <option value="stretch">Stretch to fill</option>
        </select>
      </div>
    );
  }
  if (zone.widgetType === 'IMAGE_CAROUSEL') {
    const selectedIds = config.assetIds || [];
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Slideshow Images</label>
        <AssetPicker mimeFilter="image" selectedIds={selectedIds} multiple
          onSelect={(a) => {
            const current = config.assetIds || [];
            if (!current.includes(a.id)) {
              const urls = config.assetUrls || [];
              setConfig({ assetIds: [...current, a.id], assetUrls: [...urls, a.fileUrl] });
            }
          }}
          onRemove={(id) => {
            const current = config.assetIds || [];
            const urls = config.assetUrls || [];
            const idx2 = current.indexOf(id);
            setConfig({ assetIds: current.filter((_: string, i: number) => i !== idx2), assetUrls: urls.filter((_: string, i: number) => i !== idx2) });
          }} />
        <select value={config.fitMode || 'cover'} onChange={e => setConfig({ fitMode: e.target.value })} className={inputClass}>
          <option value="cover">Cover (fill zone)</option>
          <option value="contain">Contain (fit inside)</option>
          <option value="stretch">Stretch to fill</option>
        </select>
        <div>
          <label className="text-[10px] font-bold text-slate-400 block mb-1">Slide Duration (ms)</label>
          <input type="number" min={1000} max={60000} step={1000} value={config.intervalMs || 5000}
            onChange={e => setConfig({ intervalMs: parseInt(e.target.value) || 5000 })} className={inputClass} />
        </div>
        <select value={config.transitionEffect || 'fade'} onChange={e => setConfig({ transitionEffect: e.target.value })} className={inputClass}>
          <option value="fade">Fade</option>
          <option value="slide">Slide</option>
          <option value="none">None</option>
        </select>
      </div>
    );
  }
  if (zone.widgetType === 'VIDEO') {
    const selectedIds = config.assetId ? [config.assetId] : [];
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Video Content</label>
        <AssetPicker mimeFilter="video" selectedIds={selectedIds}
          onSelect={(a) => setConfig({ assetId: a.id, assetUrl: a.fileUrl, assetName: a.originalName })}
          onRemove={() => setConfig({ assetId: null, assetUrl: null, assetName: null })} />
        <select value={config.fitMode || 'contain'} onChange={e => setConfig({ fitMode: e.target.value })} className={inputClass}>
          <option value="cover">Cover</option>
          <option value="contain">Contain</option>
        </select>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={config.autoplay !== false} onChange={e => setConfig({ autoplay: e.target.checked })} className="rounded" /> Autoplay
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={config.loop !== false} onChange={e => setConfig({ loop: e.target.checked })} className="rounded" /> Loop
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={config.muted !== false} onChange={e => setConfig({ muted: e.target.checked })} className="rounded" /> Muted
          </label>
        </div>
      </div>
    );
  }
  if (zone.widgetType === 'PLAYLIST') {
    return <PlaylistPicker config={config} setConfig={setConfig} inputClass={inputClass} />;
  }
  if (zone.widgetType === 'WEATHER') {
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Weather Settings</label>
        <div>
          <input value={config.location || ''} onChange={e => setConfig({ location: e.target.value })} placeholder="e.g. Springfield, IL" className={inputClass} />
          <p className="text-[9px] text-slate-400 mt-1">City name — pulls live weather automatically</p>
        </div>
        <select value={config.units || 'fahrenheit'} onChange={e => setConfig({ units: e.target.value })} className={inputClass}>
          <option value="fahrenheit">Fahrenheit (°F)</option>
          <option value="celsius">Celsius (°C)</option>
        </select>
        <div className="bg-emerald-50 rounded-lg p-2 flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <span className="text-[10px]">✓</span>
          </div>
          <span className="text-[10px] text-emerald-700 font-medium">Live data — updates every 15 min via Open-Meteo</span>
        </div>
      </div>
    );
  }
  if (zone.widgetType === 'CALENDAR') {
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Calendar Feed</label>
        <input value={config.feedUrl || ''} onChange={e => setConfig({ feedUrl: e.target.value })} placeholder="iCal/Google Calendar URL" className={inputClass} />
        <input type="number" min={1} max={20} value={config.maxEvents || 5} onChange={e => setConfig({ maxEvents: parseInt(e.target.value) || 5 })}
          className={inputClass} />
        <span className="text-[10px] text-slate-400">Max events to show</span>
      </div>
    );
  }
  if (zone.widgetType === 'BELL_SCHEDULE') {
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Bell Schedule</label>
        <textarea value={config.schedule || ''} onChange={e => setConfig({ schedule: e.target.value })}
          placeholder={"Period 1: 8:00 - 8:50\nPeriod 2: 8:55 - 9:45\n..."} rows={6} className={inputClass + " resize-none font-mono text-xs"} />
      </div>
    );
  }
  if (zone.widgetType === 'LUNCH_MENU') {
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Lunch Menu</label>
        <textarea value={config.menu || ''} onChange={e => setConfig({ menu: e.target.value })}
          placeholder={"Monday: Pizza, Salad\nTuesday: Tacos, Rice\n..."} rows={5} className={inputClass + " resize-none"} />
      </div>
    );
  }
  if (zone.widgetType === 'STAFF_SPOTLIGHT') {
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Staff Spotlight</label>
        <input value={config.staffName || ''} onChange={e => setConfig({ staffName: e.target.value })} placeholder="Staff member name" className={inputClass} />
        <input value={config.role || ''} onChange={e => setConfig({ role: e.target.value })} placeholder="Role / Title" className={inputClass} />
        <textarea value={config.bio || ''} onChange={e => setConfig({ bio: e.target.value })} placeholder="Short bio or fun fact..." rows={3}
          className={inputClass + " resize-none"} />
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Photo</label>
        <AssetPicker mimeFilter="image" selectedIds={config.photoAssetId ? [config.photoAssetId] : []}
          onSelect={(a) => setConfig({ photoAssetId: a.id, photoUrl: a.fileUrl })}
          onRemove={() => setConfig({ photoAssetId: null, photoUrl: null })} />
      </div>
    );
  }
  if (zone.widgetType === 'RSS_FEED') {
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">RSS Feed</label>
        <input value={config.feedUrl || ''} onChange={e => setConfig({ feedUrl: e.target.value })} placeholder="https://example.com/rss" className={inputClass} />
        <input type="number" min={1} max={20} value={config.maxItems || 5} onChange={e => setConfig({ maxItems: parseInt(e.target.value) || 5 })}
          className={inputClass} />
        <span className="text-[10px] text-slate-400">Max headlines to show</span>
      </div>
    );
  }
  if (zone.widgetType === 'SOCIAL_FEED') {
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Social Feed</label>
        <input value={config.embedUrl || ''} onChange={e => setConfig({ embedUrl: e.target.value })} placeholder="Social media embed URL" className={inputClass} />
      </div>
    );
  }
  if (zone.widgetType === 'RICH_TEXT') {
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Rich Text Content</label>
        <textarea value={config.content || ''} onChange={e => setConfig({ content: e.target.value })}
          placeholder="Enter formatted text... (supports basic HTML)" rows={5} className={inputClass + " resize-none"} />
      </div>
    );
  }

  return (
    <div className="pt-2 border-t border-slate-100">
      <p className="text-[10px] text-slate-400 italic">No additional settings for this widget type.</p>
    </div>
  );
}

function PlaylistPicker({ config, setConfig, inputClass }: { config: any; setConfig: (u: Record<string, any>) => void; inputClass: string }) {
  const { data: playlists, isLoading } = usePlaylists();
  return (
    <div className="space-y-3 pt-2 border-t border-slate-100">
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Playlist</label>
      {isLoading ? (
        <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 animate-spin text-slate-400" /></div>
      ) : (
        <select value={config.playlistId || ''} onChange={e => setConfig({ playlistId: e.target.value || null })} className={inputClass}>
          <option value="">Select a playlist...</option>
          {(playlists || []).map((p: any) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}
      {(playlists || []).length === 0 && !isLoading && (
        <p className="text-[10px] text-slate-400 italic">No playlists created yet. Create one from the Playlists page.</p>
      )}
    </div>
  );
}
