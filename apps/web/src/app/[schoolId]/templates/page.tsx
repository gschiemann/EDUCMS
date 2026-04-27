// TODO(a11y): Sprint 2 — fix label-has-associated-control (add htmlFor/id pairs to all
// widget config inputs), click-events-have-key-events, and no-static-element-interactions
// violations throughout this file. The widget editor panel has many unlabelled config fields.
/* eslint-disable jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions, jsx-a11y/label-has-associated-control, jsx-a11y/no-autofocus */
"use client";

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import '@/components/widgets/variants-register'; // Boot-time registration for custom themes
import {
  LayoutTemplate, Plus, Loader2, Trash2, Copy, ArrowLeft, Save,
  Grid3X3, Pencil, X, Monitor, Smartphone, Settings2, Eye,
  Play, Image as ImageIcon, Globe, Type, Bell, Clock, Cloud,
  Timer, CalendarDays, Megaphone, UtensilsCrossed, Users, Rss,
  Share2, Shield, ArrowRight, Square, FileText, ListVideo,
  AlignLeft, AlignCenter, AlignRight, AlignStartVertical, AlignEndVertical,
  Layers, ChevronUp, ChevronDown, Lock, Unlock, GripVertical,
  ZoomIn, ZoomOut, Maximize2, RotateCcw, RotateCw, Palette, MousePointer,
  PanelLeft, Sparkles, Search, FolderOpen, ChevronRight,
} from 'lucide-react';
import {
  useTemplates, useCreateTemplate, useDeleteTemplate, useCreateFromPreset,
  useDuplicateTemplate, useUpdateTemplate, useUpdateTemplateZones,
  useAssets, usePlaylists, useAssetFolders,
  useTenantBranding, useApplyBrandToTemplates,
} from '@/hooks/use-api';
import { WidgetPreview } from '@/components/widgets/WidgetRenderer';
import { ScaledTemplateThumbnail } from '@/components/templates/ScaledTemplateThumbnail';
import { useParams, useRouter } from 'next/navigation';
import { isFeatureEnabled, FLAGS } from '@/lib/feature-flags';
import { useUIStore } from '@/store/ui-store';
import { appConfirm, appAlert } from '@/components/ui/app-dialog';

// ─────────────────────────────────────────────────────
// Constants & Helpers
// ─────────────────────────────────────────────────────

// Four main categories + Holidays. Everything else was clutter at
// launch — we can reintroduce niche ones (Classroom, Office, Library)
// later when the library is deeper. These match the physical spots a
// school actually installs a sign: main entrance, hallway wayfinding,
// lunch line, gym/athletic area, plus the seasonal holiday lobby pack.
const CATEGORY_TABS = [
  { key: '',          label: 'All' },
  { key: 'LOBBY',     label: 'Welcome' },
  { key: 'HALLWAY',   label: 'Hallway' },
  { key: 'CAFETERIA', label: 'Cafeteria' },
  { key: 'ATHLETICS', label: 'Athletics' },
  { key: 'HOLIDAYS',  label: 'Holidays' },
];

// Holiday sub-filter — shown only when the Holidays category tab is
// active. Each entry maps to the `variant` value baked into the
// preset's `defaultConfig` (see system-presets.ts holiday block).
const HOLIDAY_SUB_FILTERS: Array<{ key: string; label: string; emoji: string }> = [
  { key: '',             label: 'All holidays',     emoji: '✨' },
  { key: 'halloween',    label: 'Halloween',        emoji: '🎃' },
  { key: 'thanksgiving', label: 'Thanksgiving',     emoji: '🦃' },
  { key: 'christmas',    label: 'Christmas',        emoji: '🎄' },
  { key: 'valentines',   label: "Valentine's Day",  emoji: '💝' },
  { key: 'stpatricks',   label: "St. Patrick's",    emoji: '☘️' },
  { key: 'easter',       label: 'Easter',           emoji: '🐰' },
];

// School-level filter chips. UNIVERSAL templates always show (no level
// restriction), so the filter only hides templates explicitly tagged
// for a different level. Empty key = show everything.
const SCHOOL_LEVEL_CHIPS = [
  { key: '', label: 'All ages', emoji: '🏫' },
  { key: 'ELEMENTARY', label: 'Elementary School', emoji: '🎨' },
  { key: 'MIDDLE', label: 'Middle School', emoji: '📚' },
  { key: 'HIGH', label: 'High School', emoji: '🎓' },
];

/**
 * Portrait presets whose widget hardcodes a 1920×1080 stage. At
 * 2160×3840 they letterbox into a centered 2160×1215 band — about
 * 68% of the screen ends up empty bgColor. Until each gets a dedicated
 * `*PortraitWidget.tsx` companion the preset reads as "broken portrait"
 * to customers, so we hide them from the catalog. Removing an id from
 * this list re-surfaces it once the corresponding portrait widget
 * exists.
 *
 * The 9 portraits NOT in this list (MS pack 8 + Rainbow Animated lobby)
 * fill the screen properly and remain visible.
 *
 * Tracked separately from `system-presets.ts` so re-shipping a portrait
 * variant doesn't require a schema field — just delete the id here.
 */
const LETTERBOXED_PORTRAIT_PRESETS: ReadonlySet<string> = new Set([
  'preset-achievement-showcase-portrait',
  // 'preset-bell-schedule-portrait', — REAL portrait shipped 2026-04-27
  //   (uses ANIMATED_BELL_SCHEDULE_PORTRAIT widget)
  'preset-bulletin-cafeteria-portrait',
  'preset-bulletin-hallway-portrait',
  'preset-bus-board-portrait',
  'preset-cafeteria-animated-elementary-portrait',
  'preset-cafeteria-animated-high-portrait',
  'preset-cafeteria-animated-middle-portrait',
  'preset-cafeteria-chalkboard-portrait',
  'preset-cafeteria-foodtruck-portrait',
  // 'preset-hallway-schedule-portrait', — REAL portrait shipped 2026-04-27
  //   (uses ANIMATED_HALLWAY_SCHEDULE_PORTRAIT widget, vertical re-flow)
  'preset-hs-blueprint-portrait',
  'preset-hs-broadcast-portrait',
  'preset-hs-gallery-portrait',
  'preset-hs-terminal-portrait',
  'preset-hs-transit-portrait',
  'preset-hs-varsity-portrait',
  'preset-hs-yearbook-portrait',
  'preset-hs-zine-portrait',
  'preset-lobby-animated-high-portrait',
  'preset-lobby-animated-middle-portrait',
  'preset-main-entrance-portrait',
  'preset-morning-news-portrait',
  'preset-scrapbook-cafeteria-portrait',
  'preset-scrapbook-hallway-portrait',
  'preset-storybook-cafeteria-portrait',
  'preset-storybook-hallway-portrait',
]);

const RESOLUTION_PRESETS = [
  { label: '4K UHD', sub: 'Landscape', w: 3840, h: 2160 },
  { label: '4K UHD', sub: 'Portrait', w: 2160, h: 3840 },
  { label: 'Full HD', sub: 'Landscape', w: 1920, h: 1080 },
  { label: 'Full HD', sub: 'Portrait', w: 1080, h: 1920 },
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

/**
 * Build the background style for a template preview using ONLY longhand
 * CSS properties. Mixing `background` (shorthand) with `backgroundImage`
 * triggers React's style-diffing warnings on every re-render.
 *
 * Priority: explicit bgImage URL > bgGradient (also goes in
 * background-image since CSS gradients are valid background-image values)
 * > solid bgColor.
 */
function previewBgStyle(t: { screenWidth?: number; screenHeight?: number; bgImage?: string | null; bgGradient?: string | null; bgColor?: string | null }): React.CSSProperties {
  const sw = t.screenWidth || 3840;
  const sh = t.screenHeight || 2160;
  const style: React.CSSProperties = {
    aspectRatio: `${sw}/${sh}`,
    width: '100%',
    height: '100%',
    backgroundColor: t.bgColor || '#ffffff',
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };
  if (t.bgImage) {
    style.backgroundImage = t.bgImage.trim().startsWith('url(') ? t.bgImage : `url(${t.bgImage})`;
  } else if (t.bgGradient) {
    // CSS gradients are valid background-image values, so this stays in
    // the longhand slot — no shorthand collision.
    style.backgroundImage = t.bgGradient;
  }
  return style;
}

/** Defensive wrapper so one broken widget can't blank-out an entire
 *  GalleryCard preview. Returns the requested children, or a tiny inline
 *  "broken zone" placeholder if the children throw on render. */
class ZoneRenderBoundary extends React.Component<{ children: React.ReactNode }, { broke: boolean }> {
  state = { broke: false };
  static getDerivedStateFromError() { return { broke: true }; }
  render() {
    if (this.state.broke) {
      return <div className="w-full h-full bg-rose-50 border border-rose-200" aria-hidden />;
    }
    return this.props.children;
  }
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
  schoolLevel?: string;
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
  const [activeLevel, setActiveLevel] = useState('');
  // Sub-filter active only when category=HOLIDAYS. Empty key = all
  // holidays; otherwise a specific variant ('christmas', 'easter', etc.)
  // matched against the preset's defaultConfig.variant.
  const [activeHoliday, setActiveHoliday] = useState('');
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [autoEditHandled, setAutoEditHandled] = useState(false);
  const router = useRouter();
  const params = useParams<{ schoolId: string }>();
  const useV2Builder = isFeatureEnabled(FLAGS.TEMPLATE_BUILDER_V2);
  const userRole = useUIStore((s) => s.user?.role);
  const isViewer = userRole === 'RESTRICTED_VIEWER';

  const openInBuilder = useCallback((t: Template) => {
    if (useV2Builder && !t.isSystem) {
      router.push(`/${params?.schoolId ?? ''}/templates/builder/${t.id}`);
    } else {
      setEditingTemplate(t);
    }
  }, [useV2Builder, router, params?.schoolId]);

  // Create form state
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCategory, setNewCategory] = useState('CUSTOM');
  const [newW, setNewW] = useState(3840);
  const [newH, setNewH] = useState(2160);
  const [customRes, setCustomRes] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const { data: templates, isLoading } = useTemplates();

  // Auto-open editor if ?edit=<templateId> is in the URL (e.g. from playlist page)
  useEffect(() => {
    if (autoEditHandled || !templates || isLoading) return;
    const params = new URLSearchParams(window.location.search);
    const editId = params.get('edit');
    if (editId) {
      const target = templates.find((t: Template) => t.id === editId);
      if (target) {
        openInBuilder(target);
        // Clean up the URL param without triggering navigation
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
    setAutoEditHandled(true);
  }, [templates, isLoading, autoEditHandled]);
  const createTemplate = useCreateTemplate();
  const createFromPreset = useCreateFromPreset();
  const updateTemplate = useUpdateTemplate();
  const duplicateTemplate = useDuplicateTemplate();
  const deleteTemplate = useDeleteTemplate();

  const q = searchQuery.trim().toLowerCase();
  const filtered = (templates || []).filter((t: Template) => {
    // Hide letterboxed portrait presets — see LETTERBOXED_PORTRAIT_PRESETS
    // header. These render at 2160×3840 but their widget caps the
    // canvas at 1920×1080 so the result is a centered band with 68%
    // empty bgColor. Real portrait variants (with dedicated
    // *PortraitWidget components) ship one at a time post-launch.
    if (LETTERBOXED_PORTRAIT_PRESETS.has(t.id)) return false;
    if (activeCategory && t.category !== activeCategory) return false;
    if (activeLevel) {
      // UNIVERSAL (or missing) is always shown — it's grade-agnostic.
      const lvl = (t.schoolLevel || 'UNIVERSAL').toUpperCase();
      if (lvl !== 'UNIVERSAL' && lvl !== activeLevel) return false;
    }
    // Holiday sub-filter — only meaningful when category=HOLIDAYS.
    // Reads the preset's first zone's defaultConfig.variant, which
    // is where the preset registry stores the holiday key (christmas,
    // easter, halloween, etc.). If no variant match, hide.
    if (activeCategory === 'HOLIDAYS' && activeHoliday) {
      const firstZone = (t as any).zones?.[0];
      const variant = firstZone?.defaultConfig?.variant;
      if (variant !== activeHoliday) return false;
    }
    if (!q) return true;
    return (
      t.name.toLowerCase().includes(q) ||
      (t.description || '').toLowerCase().includes(q) ||
      (t.category || '').toLowerCase().includes(q)
    );
  });

  // Pair landscape presets with their portrait siblings by id convention:
  //   preset-X (landscape)  ←→  preset-X-portrait (portrait)
  // Portrait variants are HIDDEN from the gallery list; they surface
  // only via the orientation toggle on their landscape sibling card.
  // This keeps the gallery uncluttered (one card per template, not
  // one per orientation) while letting operators preview either
  // orientation right from the same tile.
  const allById = new Map<string, Template>();
  for (const t of (templates || [])) allById.set(t.id, t);
  const portraitSiblingFor = (t: Template): Template | undefined => {
    if (t.id.endsWith('-portrait')) return undefined;
    const siblingId = `${t.id}-portrait`;
    // Hide the Portrait toggle when the sibling is a known letterboxed
    // preset — without this, clicking "Portrait" on the landscape card
    // showed a tiny landscape scene squeezed into the top of a portrait
    // frame with massive empty bg space below. Operator (correctly)
    // called this out on the catalog page; the denylist now applies
    // BOTH to standalone tiles (filter pass above) AND to the in-card
    // Landscape↔Portrait toggle.
    if (LETTERBOXED_PORTRAIT_PRESETS.has(siblingId)) return undefined;
    return allById.get(siblingId);
  };

  const systemTemplates = filtered
    .filter((t: Template) => t.isSystem)
    .filter((t: Template) => !t.id.endsWith('-portrait'));
  const customTemplates = filtered
    .filter((t: Template) => !t.isSystem)
    .filter((t: Template) => !t.id.endsWith('-portrait'));

  async function handleCreate() {
    if (!newName.trim()) return;
    const result = await createTemplate.mutateAsync({
      name: newName.trim(), description: newDesc.trim() || undefined,
      category: newCategory, orientation: newH > newW ? 'PORTRAIT' : 'LANDSCAPE',
      screenWidth: newW, screenHeight: newH,
      zones: [{ name: 'Full Screen', widgetType: 'EMPTY', x: 0, y: 0, width: 100, height: 100 }],
    });
    setShowCreate(false); setNewName(''); setNewDesc('');
    setNewW(3840); setNewH(2160); setCustomRes(false);
    openInBuilder(result);
  }

  async function handleUsePreset(preset: Template, flipOrientation?: boolean) {
    const result = await createFromPreset.mutateAsync({ presetId: preset.id, name: preset.name });
    if (flipOrientation && result) {
      // Flip the dimensions after creation
      const flipped = await updateTemplate.mutateAsync({
        id: result.id,
        orientation: result.screenHeight > result.screenWidth ? 'LANDSCAPE' : 'PORTRAIT',
        screenWidth: result.screenHeight,
        screenHeight: result.screenWidth,
      });
      openInBuilder({ ...result, ...flipped });
    } else {
      openInBuilder(result);
    }
  }

  async function handleDuplicate(template: Template) {
    const result = await duplicateTemplate.mutateAsync({ id: template.id });
    openInBuilder(result);
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
          <div className="flex items-center gap-2">
            <ApplyBrandButton disabled={isViewer} />
            <button
              onClick={() => setShowCreate(true)}
              disabled={isViewer}
              title={isViewer ? 'Read-only — viewer role' : undefined}
              className="px-5 py-3 bg-white text-indigo-700 font-bold text-sm rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-5 h-5" /> New Template
            </button>
          </div>
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

      {/* Two-tier filter bar.
          Primary = grade level (Elementary / Middle / High) — most
          teachers know their grade before anything else. Secondary
          (LOBBY / HALLWAY / CAFETERIA / …) only appears AFTER a level
          is chosen, keeping the top of the page clean and matching
          the mental model of "pick your school, then pick the spot". */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex gap-1.5 items-center">
            {SCHOOL_LEVEL_CHIPS.map(chip => (
              <button
                key={chip.key}
                type="button"
                onClick={() => setActiveLevel(chip.key)}
                aria-pressed={activeLevel === chip.key}
                className={`px-4 py-2 rounded-full text-sm font-bold border transition-all ${
                  activeLevel === chip.key
                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                }`}
              >
                <span className="mr-1.5" aria-hidden>{chip.emoji}</span>
                {chip.label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates..."
              aria-label="Search templates"
              className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
            />
          </div>
        </div>
        {/* Room/category sub-filter. Only renders once a grade level
            is active — keeps the page calm for first-time visitors. */}
        {activeLevel && (
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit flex-wrap">
            {CATEGORY_TABS.map(tab => (
              <button key={tab.key} onClick={() => {
                setActiveCategory(tab.key);
                // Reset the holiday sub-filter when switching away
                // from HOLIDAYS so it doesn't silently filter the
                // next category to nothing.
                if (tab.key !== 'HOLIDAYS') setActiveHoliday('');
              }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeCategory === tab.key ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {tab.label}
              </button>
            ))}
          </div>
        )}
        {/* Holiday-specific sub-filter — only when category=HOLIDAYS.
            Pill-shaped chips with emoji + holiday name. Operators pick
            the holiday that matches the season; "All holidays" shows
            every variant for the current grade level. */}
        {activeLevel && activeCategory === 'HOLIDAYS' && (
          <div className="flex gap-1.5 flex-wrap">
            {HOLIDAY_SUB_FILTERS.map(h => (
              <button
                key={h.key}
                type="button"
                onClick={() => setActiveHoliday(h.key)}
                aria-pressed={activeHoliday === h.key}
                className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all inline-flex items-center gap-1.5 ${
                  activeHoliday === h.key
                    ? 'bg-rose-500 text-white border-rose-500 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-rose-300 hover:text-rose-600'
                }`}
              >
                <span aria-hidden>{h.emoji}</span>
                {h.label}
              </button>
            ))}
          </div>
        )}
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
                  // Preset cards open the fullscreen Preview. Only an
                  // explicit "Use this template" click inside the preview
                  // creates a custom DB row — browsing doesn't pollute
                  // the tenant's template list.
                  <GalleryCard
                    key={t.id}
                    template={t}
                    portraitSibling={portraitSiblingFor(t)}
                    onPreview={(active) => setPreviewTemplate(active)}
                  />
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
                  <GalleryCard
                    key={t.id}
                    template={t}
                    portraitSibling={portraitSiblingFor(t)}
                    onEdit={() => openInBuilder(t)}
                    onDuplicate={() => handleDuplicate(t)}
                    onDelete={async () => {
                      const ok = await appConfirm({
                        title: 'Delete this template?',
                        message: `This permanently removes "${t.name}". Any screens scheduled with this layout fall back to the next playlist.`,
                        tone: 'danger',
                        confirmLabel: 'Delete template',
                      });
                      if (ok) deleteTemplate.mutateAsync(t.id);
                    }}
                    onPreview={(active) => setPreviewTemplate(active)}
                    isViewerDisabled={isViewer}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Fullscreen template preview. "Customize" routes straight to
          the builder with the preset loaded — nothing is written to
          the DB until the user hits Save-as-copy in the builder. This
          replaces the old flow that silently created a custom row the
          moment you clicked a preset. */}
      {previewTemplate && (
        <TemplatePreviewModal
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
          onCustomize={previewTemplate.isSystem ? () => {
            const t = previewTemplate;
            setPreviewTemplate(null);
            router.push(`/${params?.schoolId}/templates/builder/${t.id}`);
          } : undefined}
          onEdit={!previewTemplate.isSystem ? () => {
            const t = previewTemplate;
            setPreviewTemplate(null);
            openInBuilder(t);
          } : undefined}
        />
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════
// Fullscreen template preview modal
// ═════════════════════════════════════════════════════
function TemplatePreviewModal({
  template, onClose, onCustomize, onEdit,
}: {
  template: Template;
  onClose: () => void;
  /** Opens the builder with the system preset loaded. Nothing is
   *  written to the DB here — save-as-copy in the builder does that. */
  onCustomize?: () => void;
  /** Opens an existing custom template in the builder. */
  onEdit?: () => void;
}) {
  // Live viewport size — recomputed on resize so the template scales
  // to fill the available area instead of a once-at-mount snapshot.
  const [vh, setVh] = useState<number>(typeof window !== 'undefined' ? window.innerHeight : 800);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [onClose]);

  const sw = template.screenWidth || 3840;
  const sh = template.screenHeight || 2160;
  const isLandscape = sw >= sh;

  // Template fills the full viewport; the top and bottom bars float as
  // semi-transparent overlays so the template renders at maximum size
  // instead of losing 150+ px to stacked toolbars.
  const maxH = Math.max(300, vh - 48);

  // Portal to document.body so the modal isn't trapped inside the
  // DashboardLayout's flex container (which leaves the sidebar peeking
  // out on the left). `fixed` alone isn't enough when an ancestor uses
  // `transform`/`contain` — the fixed element gets rebased to that
  // ancestor instead of the viewport. Portal dodges it entirely.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-slate-950/92 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${template.name}`}
    >
      {/* Full-bleed stage */}
      <div
        className="absolute inset-0 flex items-center justify-center p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <ScaledTemplateThumbnail
          zones={(template.zones || []) as any}
          screenWidth={sw}
          screenHeight={sh}
          bgImage={template.bgImage}
          bgGradient={template.bgGradient}
          bgColor={template.bgColor}
          maxHeight={maxH}
        />
      </div>

      {/* Floating top bar — title + huge visible close */}
      <div
        className="absolute top-0 inset-x-0 flex items-center justify-between px-4 py-2.5 bg-gradient-to-b from-slate-950/80 to-transparent pointer-events-none"
      >
        <div className="pointer-events-auto">
          <div className="text-base font-bold text-white drop-shadow">{template.name}</div>
          <div className="text-[11px] text-white/60 drop-shadow">{sw}×{sh} · {(template.zones || []).length} zones · Esc to close</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="pointer-events-auto flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-100 text-slate-900 text-sm font-bold rounded-full transition-colors shadow-lg"
          aria-label="Close preview"
        >
          <X className="w-4 h-4" /> Close
        </button>
      </div>

      {/* Floating bottom CTA bar */}
      {(onEdit || onCustomize) && (
        <div
          className="absolute bottom-4 inset-x-0 flex items-center justify-center gap-2 pointer-events-none"
        >
          <div
            className="pointer-events-auto flex items-center gap-2 px-3 py-2 bg-slate-900/85 backdrop-blur-md rounded-full shadow-2xl border border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-full"
              >
                Edit this template
              </button>
            )}
            {onCustomize && (
              <button
                type="button"
                onClick={onCustomize}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-full flex items-center gap-1.5"
              >
                <Pencil className="w-3.5 h-3.5" /> Customize
              </button>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

// ═════════════════════════════════════════════════════
// GALLERY CARD — premium hover preview
// ═════════════════════════════════════════════════════

function GalleryCard({ template, portraitSibling, onUse, onUsePortrait, onEdit, onDuplicate, onDelete, onPreview, isViewerDisabled = false }: {
  template: Template;
  /** If this template has a portrait sibling preset, pass it here; the
   *  card shows a Landscape | Portrait toggle and renders the active
   *  variant in both the thumbnail and the preview modal. */
  portraitSibling?: Template;
  onUse?: () => void;
  onUsePortrait?: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  /** Called with the currently-active orientation's template (landscape
   *  by default, portrait sibling when toggled). */
  onPreview?: (which: Template) => void;
  isViewerDisabled?: boolean;
}) {
  // Local toggle — persists for the lifetime of the gallery render.
  // Defaults to landscape (the natural orientation of the preset row).
  const [showPortrait, setShowPortrait] = useState(false);
  const active = showPortrait && portraitSibling ? portraitSibling : template;

  const zones = active.zones || [];
  const sw = active.screenWidth || 3840;
  const sh = active.screenHeight || 2160;
  const isLandscape = sw >= sh;

  const fire = onPreview ? () => onPreview(active) : undefined;

  return (
    <div className="group bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:border-indigo-200 transition-all duration-300 overflow-hidden">
      {/* Preview Canvas. CSS shorthand (`background`) is FORBIDDEN here —
          mixing it with `backgroundImage` triggers React's style-diffing
          warning ("removing/updating a style property during rerender
          when a conflicting property is set"). We use ONLY longhand
          properties (`backgroundImage`, `backgroundColor`) which React
          tracks independently. CSS gradients are valid `background-image`
          values, so a `bgGradient` from the DB lives in the same slot
          as a `bgImage`. */}
      {/* Whole preview area is now a click target for the fullscreen
          modal — partner asked to be able to click anywhere on the
          thumbnail, not hunt for the small "Preview" chip. The chip
          stays visible on hover as an affordance + keyboard target,
          but the entire surface dispatches the same onPreview. */}
      <div
        className={`relative bg-gradient-to-br from-slate-50 to-slate-100 p-4 flex items-center justify-center ${fire ? 'cursor-pointer' : ''}`}
        style={{ height: 200 }}
        onClick={fire}
        onKeyDown={(e) => {
          if (!fire) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fire();
          }
        }}
        role={fire ? 'button' : undefined}
        tabIndex={fire ? 0 : undefined}
        aria-label={fire ? `Preview ${active.name}` : undefined}
      >
        {/*
          Proper thumbnail rendering: render the template at its NATURAL
          resolution (e.g. 1920×1080) into a scaled-down container. The
          CSS transform:scale shrinks widgets' fonts, icons, and layout
          proportionally — previously they rendered at full pixel size
          inside a 150px box and got clipped / looked squished.
        */}
        <ScaledTemplateThumbnail
          zones={zones as any}
          screenWidth={sw}
          screenHeight={sh}
          bgImage={template.bgImage}
          bgGradient={template.bgGradient}
          bgColor={template.bgColor}
          maxHeight={168}
        />

        {template.isSystem && (
          <div className="absolute top-3 right-3 bg-gradient-to-r from-indigo-500 to-violet-500 text-white text-[9px] font-bold px-2.5 py-1 rounded-full shadow-sm pointer-events-none">
            PRESET
          </div>
        )}

        {/* Orientation toggle — only renders when a portrait sibling
            exists for this preset. Lets the operator preview either
            orientation right from the gallery tile without leaving
            the page. Click stops propagation so it doesn't fire the
            outer onPreview. */}
        {portraitSibling && (
          <div
            className="absolute top-3 left-3 inline-flex items-center bg-white/95 border border-slate-200 rounded-full overflow-hidden shadow-sm"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="group"
            aria-label="Orientation"
          >
            <button
              type="button"
              onClick={() => setShowPortrait(false)}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] font-semibold transition ${
                !showPortrait ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
              aria-pressed={!showPortrait}
              title="Landscape"
            >
              <Monitor className="w-3 h-3" />
              Landscape
            </button>
            <button
              type="button"
              onClick={() => setShowPortrait(true)}
              className={`flex items-center gap-1 px-2 py-1 text-[10px] font-semibold transition ${
                showPortrait ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
              aria-pressed={showPortrait}
              title="Portrait"
            >
              <Smartphone className="w-3 h-3" />
              Portrait
            </button>
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors rounded-t-2xl pointer-events-none" />

        {/* Visible "Preview" affordance on hover. Doesn't actually need
            to handle the click anymore — the whole tile does — but
            the chip is what tells the operator the thumbnail is
            interactive, and it acts as a keyboard-focus target on its
            own (Enter on the parent also works via onKeyDown above). */}
        {onPreview && (
          <span
            className="absolute bottom-3 left-3 px-2.5 py-1 bg-slate-900/80 text-white text-[10px] font-bold rounded-full flex items-center gap-1 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity shadow-lg pointer-events-none"
            aria-hidden="true"
          >
            <Eye className="w-3 h-3" /> Preview
          </span>
        )}
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
            <div className="flex-1 flex gap-1">
              <button onClick={onUse} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-sm">
                <Monitor className="w-3.5 h-3.5" /> {isLandscape ? 'Landscape' : 'Portrait'}
              </button>
              {onUsePortrait && (
                <button onClick={onUsePortrait}
                  className="py-2 px-3 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                  title={isLandscape ? 'Create as Portrait' : 'Create as Landscape'}>
                  <Smartphone className="w-3.5 h-3.5" /> {isLandscape ? 'Portrait' : 'Landscape'}
                </button>
              )}
            </div>
          )}
          {onEdit && (
            <button onClick={onEdit} disabled={isViewerDisabled} title={isViewerDisabled ? 'Read-only — viewer role' : undefined} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          )}
          {onDuplicate && (
            <button onClick={onDuplicate} disabled={isViewerDisabled} title={isViewerDisabled ? 'Read-only — viewer role' : 'Duplicate'} className="py-2 px-3 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <Copy className="w-3.5 h-3.5" />
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} disabled={isViewerDisabled} title={isViewerDisabled ? 'Read-only — viewer role' : 'Delete'} className="py-2 px-3 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
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
  const [sW, setSW] = useState(template.screenWidth || 3840);
  const [sH, setSH] = useState(template.screenHeight || 2160);
  const [leftPanel, setLeftPanel] = useState<'widgets' | 'zones' | 'config' | null>('zones');
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [searchWidget, setSearchWidget] = useState('');
  const [bgColor, setBgColor] = useState(template.bgColor || '');
  const [bgGradient, setBgGradient] = useState(template.bgGradient || '');
  const [bgImage, setBgImage] = useState(template.bgImage || '');
  const [showSaveModal, setShowSaveModal] = useState(false);

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

  async function executeSave() {
    setShowSaveModal(false);
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
          <button
            onClick={() => { setSW(sH); setSH(sW); setIsDirty(true); setSaveStatus('idle'); }}
            className="p-1.5 hover:bg-indigo-50 rounded text-slate-400 hover:text-indigo-600 transition-colors"
            title={`Flip to ${sH > sW ? 'Landscape' : 'Portrait'} (${sH}×${sW})`}
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
          <span className="text-[10px] font-bold text-slate-400 bg-slate-50 px-2 py-1 rounded">{sH > sW ? 'Portrait' : 'Landscape'}</span>
          {saveStatus === 'saved' && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">Saved!</span>}
          {isDirty && saveStatus === 'idle' && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded">Unsaved</span>}
          <button onClick={() => setShowSaveModal(true)} disabled={saveStatus === 'saving'}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-50">
            {saveStatus === 'saving' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      </div>

      {showSaveModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[1000] flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-200" onClick={() => setShowSaveModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">Save Template</h2>
              <button onClick={() => setShowSaveModal(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Template Name</label>
                <input value={tName} onChange={e => setTName(e.target.value)} placeholder="Enter a descriptive name..." autoFocus
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent placeholder:text-slate-400"
                  onKeyDown={e => e.key === 'Enter' && executeSave()} />
              </div>
              <button onClick={executeSave} disabled={!tName.trim()}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                <Save className="w-4 h-4" /> Save Template
              </button>
            </div>
          </div>
        </div>
      )}

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
              <div className="p-3 space-y-4">
                <div className="flex items-center gap-2 mb-1">
                  <Palette className="w-4 h-4 text-slate-400" />
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Canvas Background</span>
                </div>

                {/* Background color */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Solid Color</label>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={bgColor || '#ffffff'}
                      onChange={e => { setBgColor(e.target.value); setBgGradient(''); setIsDirty(true); setSaveStatus('idle'); }}
                      className="w-10 h-8 rounded border border-slate-200 cursor-pointer" />
                    <input value={bgColor || ''} placeholder="#ffffff"
                      onChange={e => { setBgColor(e.target.value); setBgGradient(''); setIsDirty(true); setSaveStatus('idle'); }}
                      className="flex-1 px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    {bgColor && <button onClick={() => { setBgColor(''); setIsDirty(true); setSaveStatus('idle'); }}
                      className="p-1 text-slate-300 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>}
                  </div>
                </div>

                {/* Gradient presets */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Gradient</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      { label: 'Dusk', css: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
                      { label: 'Ocean', css: 'linear-gradient(135deg, #0093E9 0%, #80D0C7 100%)' },
                      { label: 'Sunset', css: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' },
                      { label: 'Forest', css: 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)' },
                      { label: 'Night', css: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' },
                      { label: 'Warm', css: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)' },
                      { label: 'Navy', css: 'linear-gradient(135deg, #141E30 0%, #243B55 100%)' },
                      { label: 'Sky', css: 'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)' },
                    ].map(g => (
                      <button key={g.label} onClick={() => { setBgGradient(g.css); setBgColor(''); setIsDirty(true); setSaveStatus('idle'); }}
                        className={`h-8 rounded-lg border-2 transition-all ${bgGradient === g.css ? 'border-indigo-500 shadow-sm' : 'border-slate-200 hover:border-slate-300'}`}
                        style={{ background: g.css }} title={g.label} />
                    ))}
                  </div>
                  {bgGradient && (
                    <div className="mt-1.5 flex items-center gap-1">
                      <span className="text-[9px] text-slate-400 flex-1 truncate font-mono">{bgGradient.slice(0, 40)}...</span>
                      <button onClick={() => { setBgGradient(''); setIsDirty(true); setSaveStatus('idle'); }}
                        className="p-0.5 text-slate-300 hover:text-red-400"><X className="w-3 h-3" /></button>
                    </div>
                  )}
                </div>

                {/* Background image URL */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Image URL</label>
                  <div className="flex gap-2 items-center">
                    <input value={bgImage || ''} placeholder="https://..."
                      onChange={e => { setBgImage(e.target.value); setIsDirty(true); setSaveStatus('idle'); }}
                      className="flex-1 px-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                    {bgImage && <button onClick={() => { setBgImage(''); setIsDirty(true); setSaveStatus('idle'); }}
                      className="p-1 text-slate-300 hover:text-red-400"><X className="w-3.5 h-3.5" /></button>}
                  </div>
                  <p className="text-[9px] text-slate-300 mt-1">Fills canvas behind all zones (cover fit)</p>
                </div>

                {/* Reset */}
                {(bgColor || bgGradient || bgImage) && (
                  <button onClick={() => { setBgColor(''); setBgGradient(''); setBgImage(''); setIsDirty(true); setSaveStatus('idle'); }}
                    className="w-full py-2 text-[10px] font-bold text-slate-400 hover:text-red-500 border border-dashed border-slate-200 hover:border-red-200 rounded-lg transition-colors">
                    Reset to White
                  </button>
                )}

                <div className="border-t border-slate-100 pt-3 mt-2">
                  <div className="flex items-center gap-2">
                    <MousePointer className="w-4 h-4 text-slate-200" />
                    <p className="text-[10px] text-slate-300">Click a zone to edit its properties</p>
                  </div>
                </div>
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
              ...(bgImage ? { backgroundImage: bgImage.trim().startsWith('url(') ? bgImage : `url(${bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
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
  const { data: folders } = useAssetFolders();
  const [showModal, setShowModal] = useState(false);
  const [searchAsset, setSearchAsset] = useState('');
  const [previewAsset, setPreviewAsset] = useState<any>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  
  // Folder state
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

  const apiBase = process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') || 'http://localhost:8080';
  const assetUrl = (a: any) => a.fileUrl?.startsWith('http') ? a.fileUrl : `${apiBase}${a.fileUrl}`;

  // Filter assets by current folder and mime type/search
  const filtered = (assets || []).filter((a: any) => {
    if (a.status !== 'PUBLISHED' && a.status !== 'PENDING_APPROVAL') return false;
    if (a.folderId !== currentFolderId) return false;
    if (mimeFilter === 'image') return a.mimeType?.startsWith('image/');
    if (mimeFilter === 'video') return a.mimeType?.startsWith('video/');
    return true;
  }).filter((a: any) => !searchAsset || (a.originalName || a.fileUrl || '').toLowerCase().includes(searchAsset.toLowerCase()));

  const selectedAssets = (assets || []).filter((a: any) => selectedIds.includes(a.id));
  const isImage = (a: any) => a.mimeType?.startsWith('image/');
  const isVideo = (a: any) => a.mimeType?.startsWith('video/');

  const formatSize = (bytes: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  // Folders logic
  const currentFolderChildren = (folders || []).filter((f: any) => f.parentId === currentFolderId);
  const currentFolder = currentFolderId ? (folders || []).find((f: any) => f.id === currentFolderId) : null;
  const breadcrumbs: { id: string | null; name: string }[] = [{ id: null, name: 'All Files' }];
  if (currentFolder) {
    const trail: any[] = [];
    let f = currentFolder;
    while (f) {
      trail.unshift(f);
      f = f.parentId ? (folders || []).find((x: any) => x.id === f.parentId) : null;
    }
    trail.forEach((t: any) => breadcrumbs.push({ id: t.id, name: t.name }));
  }

  // Quick toggle selection without closing (for multiple mode)
  const handleToggleSelect = (a: any, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const isSelected = selectedIds.includes(a.id);
    if (isSelected) {
      onRemove(a.id);
    } else {
      onSelect(a);
      if (!multiple) setShowModal(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Selected assets preview */}
      {selectedAssets.length > 0 && (
        <div className="space-y-1.5">
          {selectedAssets.map((a: any) => (
            <div key={a.id} className="flex items-center gap-2 bg-white rounded-lg border border-slate-200 p-1.5 shadow-sm">
              {isImage(a) ? (
                <img src={assetUrl(a)} alt={a.originalName} className="w-10 h-10 object-cover rounded-md bg-slate-100" />
              ) : isVideo(a) ? (
                <video src={assetUrl(a)} className="w-10 h-10 object-cover rounded-md bg-slate-100" muted preload="metadata" />
              ) : (
                <div className="w-10 h-10 bg-slate-100 rounded-md flex items-center justify-center">
                  <Play className="w-4 h-4 text-slate-400" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-slate-700 truncate">{a.originalName || 'Untitled'}</p>
                <p className="text-[9px] font-medium text-slate-400 truncate">{a.mimeType}</p>
              </div>
              <button onClick={() => onRemove(a.id)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors shrink-0"><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}

      {/* Browse button */}
      <button onClick={() => setShowModal(true)}
        className="w-full py-2.5 px-3 rounded-lg border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/50 text-xs font-bold text-slate-500 hover:text-indigo-600 transition-all flex items-center justify-center gap-2 shadow-sm">
        <ImageIcon className="w-3.5 h-3.5" />
        {selectedAssets.length > 0 ? (multiple ? 'Add More Assets' : 'Change Asset') : 'Browse Assets'}
      </button>

      {/* Full-screen asset browser modal */}
      {showModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="bg-white dark:bg-slate-900 w-full max-w-5xl h-[85vh] rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden">
            
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center">
                  <ImageIcon className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">Asset Library</h2>
                  <p className="text-xs text-slate-500">{filtered.length} {mimeFilter !== 'all' ? mimeFilter : ''} asset{filtered.length !== 1 ? 's' : ''} available</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center bg-slate-200 dark:bg-slate-700 rounded-lg p-0.5">
                  <button onClick={() => setViewMode('grid')}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${viewMode === 'grid' ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    <Grid3X3 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setViewMode('list')}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${viewMode === 'list' ? 'bg-white dark:bg-slate-600 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                    <AlignLeft className="w-3.5 h-3.5" />
                  </button>
                </div>
                <button onClick={() => setShowModal(false)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Search and Navigation Bar */}
            <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 shrink-0 bg-white">
              <div className="flex items-center justify-between gap-4">
                
                {/* Breadcrumbs */}
                <div className="flex items-center gap-1 text-xs overflow-x-auto whitespace-nowrap hide-scrollbar">
                  {breadcrumbs.map((bc, i) => (
                    <span key={bc.id ?? 'root'} className="flex items-center gap-1">
                      {i > 0 && <ChevronRight className="w-3 h-3 text-slate-300" />}
                      <button
                        onClick={() => setCurrentFolderId(bc.id)}
                        className={`px-2 py-1.5 rounded-md transition-colors font-semibold ${
                          i === breadcrumbs.length - 1
                            ? 'text-slate-800 bg-slate-100'
                            : 'text-slate-500 hover:text-indigo-600 hover:bg-indigo-50'
                        }`}
                      >
                        {i === 0 && <span className="inline-flex mr-1 align-sub"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></span>}
                        {bc.name}
                      </button>
                    </span>
                  ))}
                </div>

                {/* Search */}
                <div className="relative max-w-sm w-full">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={searchAsset} onChange={e => setSearchAsset(e.target.value)} placeholder="Search in folder..."
                    autoFocus
                    className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent placeholder:text-slate-400 transition-all font-medium" />
                </div>
              </div>
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
              
              {/* Folder Grid */}
              {currentFolderChildren.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 pl-1">Folders</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {currentFolderChildren.map((f: any) => (
                      <button
                        key={f.id}
                        onDoubleClick={() => setCurrentFolderId(f.id)}
                        onClick={() => setCurrentFolderId(f.id)}
                        className="bg-white rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all p-3 text-left flex items-center gap-3 group"
                      >
                        <FolderOpen className="w-8 h-8 text-amber-400 group-hover:scale-105 transition-transform" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-700 group-hover:text-indigo-700 truncate">{f.name}</p>
                          <p className="text-[10px] font-medium text-slate-400">{f._count?.assets || 0} files</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Asset Grid */}
              <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3 pl-1">Files</h3>
              {isLoading ? (
                <div className="flex flex-col items-center justify-center p-12 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
                  <p className="text-sm text-slate-400 font-medium">Loading assets...</p>
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 gap-3 bg-white border border-dashed border-slate-200 rounded-2xl">
                  <div className="w-16 h-16 rounded-2xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center">
                    <ImageIcon className="w-8 h-8 text-slate-300" />
                  </div>
                  <p className="text-sm font-semibold text-slate-400">No {mimeFilter !== 'all' ? mimeFilter : ''} assets found</p>
                </div>
              ) : viewMode === 'grid' ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {filtered.map((a: any) => {
                    const selected = selectedIds.includes(a.id);
                    return (
                      <div key={a.id}
                        onClick={() => handleToggleSelect(a)}
                        onContextMenu={(e) => { e.preventDefault(); setPreviewAsset(a); }}
                        className={`group relative rounded-2xl overflow-hidden bg-white hover:-translate-y-1 transition-all cursor-pointer border-2 ${
                          selected ? 'border-indigo-500 shadow-[0_8px_30px_rgb(99,102,241,0.2)]' : 'border-transparent shadow-sm hover:shadow-lg'
                        }`}>
                        
                        {/* Interactive Checkbox for Multi-Select */}
                        {multiple && (
                          <button
                            onClick={(e) => handleToggleSelect(a, e)}
                            className={`absolute top-2.5 left-2.5 z-20 w-6 h-6 rounded-md flex items-center justify-center transition-all shadow-sm ${
                              selected ? 'bg-indigo-500 border border-indigo-500 opacity-100 scale-100' : 'bg-white/90 border border-slate-300 opacity-0 scale-90 group-hover:opacity-100 group-hover:scale-100 backdrop-blur-sm hover:bg-indigo-50 hover:border-indigo-300'
                            }`}
                          >
                            {selected && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                          </button>
                        )}

                        <div className="aspect-square bg-slate-100 dark:bg-slate-800 relative border-b border-slate-100">
                          {isImage(a) ? (
                            <img src={assetUrl(a)} alt={a.originalName} className="w-full h-full object-cover" loading="lazy" />
                          ) : isVideo(a) ? (
                            <video src={assetUrl(a)} className="w-full h-full object-cover" muted preload="metadata"
                              onMouseEnter={(e) => (e.target as HTMLVideoElement).play().catch(() => {})}
                              onMouseLeave={(e) => { const v = e.target as HTMLVideoElement; v.pause(); v.currentTime = 0; }} />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center gap-1">
                              <Play className="w-8 h-8 text-slate-400" />
                            </div>
                          )}
                          {/* Hover overlay viewing */}
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
                          {/* Video badge */}
                          {isVideo(a) && (
                            <div className="absolute top-2.5 right-2.5 px-1.5 py-0.5 bg-black/60 backdrop-blur-sm rounded text-[9px] font-bold text-white flex items-center gap-1 z-10">
                              <Play className="w-2.5 h-2.5" /> Video
                            </div>
                          )}
                          {/* Selected check ring fallback if no multiple */}
                          {!multiple && selected && (
                             <div className="absolute top-2.5 right-2.5 w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center shadow-lg border-2 border-white z-10">
                               <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                             </div>
                          )}
                        </div>
                        <div className="px-3 py-2.5 bg-white dark:bg-slate-800">
                          <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{a.originalName || 'Untitled'}</p>
                          <p className="text-[10px] font-medium text-slate-400 mt-0.5">{formatSize(a.fileSize)}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2 bg-white rounded-2xl border border-slate-200 p-2 shadow-sm">
                  {filtered.map((a: any) => {
                    const selected = selectedIds.includes(a.id);
                    return (
                      <button key={a.id}
                        onClick={() => handleToggleSelect(a)}
                        className={`w-full flex items-center gap-4 p-2 rounded-xl transition-all hover:shadow-sm text-left border-2 ${
                          selected ? 'bg-indigo-50 border-indigo-200 dark:bg-indigo-500/10' : 'bg-transparent border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-slate-100'
                        }`}>
                        <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0 border border-slate-200">
                          {isImage(a) ? (
                            <img src={assetUrl(a)} alt={a.originalName} className="w-full h-full object-cover" loading="lazy" />
                          ) : isVideo(a) ? (
                            <video src={assetUrl(a)} className="w-full h-full object-cover" muted preload="metadata" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center"><Play className="w-5 h-5 text-slate-400" /></div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{a.originalName || 'Untitled'}</p>
                          <p className="text-[11px] font-medium text-slate-400 mt-0.5">{a.mimeType} {a.fileSize ? `· ${formatSize(a.fileSize)}` : ''}</p>
                        </div>
                        
                        {/* Checkbox for List View */}
                        {multiple ? (
                           <div className={`w-5 h-5 rounded border-2 flex items-center justify-center mr-2 transition-all ${
                             selected ? 'bg-indigo-500 border-indigo-500' : 'bg-white border-slate-300'
                           }`}>
                             {selected && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                           </div>
                        ) : selected && (
                           <div className="w-5 h-5 bg-indigo-600 rounded-full flex items-center justify-center shrink-0 mr-2 border-2 border-white shadow-sm">
                             <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                           </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-white flex items-center justify-between shrink-0 shadow-[0_-4px_6px_-1px_rgb(0,0,0,0.02)]">
              <p className="text-xs font-bold text-slate-500 bg-slate-100 px-3 py-1.5 rounded-lg">
                {selectedIds.length > 0 ? `${selectedIds.length} file${selectedIds.length === 1 ? '' : 's'} selected` : 'Select content'} {multiple ? '· Checkboxes enabled' : ''}
              </p>
              <button onClick={() => setShowModal(false)}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold rounded-xl shadow-md shadow-indigo-600/20 hover:shadow-lg hover:shadow-indigo-600/30 transition-all hover:-translate-y-0.5 active:translate-y-0">
                {selectedIds.length > 0 ? 'Use Selected' : 'Done'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Preview overlay */}
      {previewAsset && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-8"
          onClick={() => setPreviewAsset(null)}>
          <div className="max-w-3xl max-h-[80vh] rounded-2xl overflow-hidden shadow-2xl relative" onClick={e => e.stopPropagation()}>
            {isImage(previewAsset) ? (
              <img src={assetUrl(previewAsset)} alt={previewAsset.originalName} className="max-w-full max-h-[75vh] object-contain bg-black/50" />
            ) : isVideo(previewAsset) ? (
              <video src={assetUrl(previewAsset)} controls autoPlay muted className="max-w-full max-h-[75vh] bg-black/50" />
            ) : null}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent pt-8 pb-3 px-4">
              <p className="text-sm font-bold text-white drop-shadow-md">{previewAsset.originalName}</p>
              <p className="text-[10px] font-medium text-white/70 drop-shadow-md">{previewAsset.mimeType} {previewAsset.fileSize ? `· ${formatSize(previewAsset.fileSize)}` : ''}</p>
            </div>
            <button onClick={() => setPreviewAsset(null)} className="absolute top-3 right-3 p-1.5 bg-black/50 hover:bg-black/80 rounded-full text-white backdrop-blur-md transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>,
        document.body
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
        <input value={config.url || ''} onChange={e => setConfig({ url: e.target.value })} onBlur={e => {
          const v = e.target.value.trim();
          if (v && !v.startsWith('http://') && !v.startsWith('https://') && !v.startsWith('//')) {
            setConfig({ url: `https://${v}` });
          }
        }} placeholder="e.g. example.com" className={inputClass} />
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
          <label className="text-[10px] font-bold text-slate-400 block mb-1">Slide Duration (seconds)</label>
          <input type="number" min={1} max={60} step={1} value={Math.round((config.intervalMs || 5000) / 1000)}
            onChange={e => setConfig({ intervalMs: (parseInt(e.target.value) || 5) * 1000 })} className={inputClass} />
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

/**
 * "Apply our brand to every template" — the K-12 differentiator that
 * Canva can't ship because Canva designs are siloed. We re-skin every
 * template the operator owns in one transaction. Two modes: fill-blanks
 * (safe, only sets unset keys) and override (bold, replaces existing
 * brand colors/fonts). Demo punchline: "60 templates rebranded in 30
 * seconds."
 */
function ApplyBrandButton({ disabled }: { disabled: boolean }) {
  const branding = useTenantBranding();
  const apply = useApplyBrandToTemplates();
  const [open, setOpen] = useState(false);
  const [override, setOverride] = useState(false);

  const hasBrand = !!branding.data && (branding.data.palette || branding.data.fontHeading || branding.data.fontBody);

  const onApply = async () => {
    try {
      const result = await apply.mutateAsync({ mode: override ? 'override' : 'fill-blanks' });
      setOpen(false);
      // Confirmation dialog matching the rest of the app — tells the
      // operator exactly how many templates were touched and how many
      // zones inside them.
      await appAlert({
        title: 'Brand applied',
        message: result.message,
        tone: 'info',
      });
    } catch (err: any) {
      await appAlert({
        title: "Couldn't apply brand",
        message: err.message || 'Something went wrong while re-skinning templates. Please try again.',
        tone: 'danger',
      });
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={disabled || !hasBrand}
        title={!hasBrand ? 'Configure your brand kit first (Brand tab in any template builder)' : disabled ? 'Read-only — viewer role' : 'Re-skin every template with your school brand'}
        className="px-4 py-3 bg-gradient-to-r from-pink-500 to-violet-500 text-white font-bold text-sm rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Sparkles className="w-5 h-5" /> Brand all templates
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-violet-500" />
                Apply your brand
              </h2>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Re-skins every <strong>custom</strong> template you own with your school&apos;s brand colors, fonts, and ink color. System presets are left alone.
            </p>

            {/* Brand palette preview */}
            {branding.data?.palette && (
              <div className="flex items-center gap-1.5">
                {(['primary', 'primaryHover', 'accent', 'ink', 'surface', 'surfaceAlt'] as const).map((k) => {
                  const v = branding.data.palette[k];
                  if (!v) return null;
                  return (
                    <div key={k} className="w-7 h-7 rounded shadow-sm border border-slate-200" style={{ background: v }} title={`${k}: ${v}`} />
                  );
                })}
                {branding.data.fontHeading && (
                  <span className="ml-2 text-xs text-slate-700 font-bold" style={{ fontFamily: branding.data.fontHeading }}>
                    {branding.data.fontHeading.split(',')[0].replace(/['"]/g, '')}
                  </span>
                )}
              </div>
            )}

            <label className="flex items-start gap-2 p-3 bg-slate-50 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
                className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-400"
              />
              <span className="text-xs text-slate-700">
                <strong>Replace existing brand colors and fonts.</strong>
                <span className="block text-slate-500 mt-0.5">
                  Off (default): only fills in templates that don&apos;t have a color/font set. On: forces the brand on every template, overwriting prior choices.
                </span>
              </span>
            </label>

            {override && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
                <strong>⚠️ Theme-specific fonts will be replaced.</strong>
                <span className="block text-amber-800 mt-0.5">
                  Templates like <strong>HS Terminal</strong> (VT323 CRT) and <strong>MS Arcade</strong> (Press Start 2P pixel) use thematic fonts as part of their design. Override mode will swap them for your brand font. To preserve a theme&apos;s look, leave the font field empty in your Brand Kit.
                </span>
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={onApply}
                disabled={apply.isPending}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-pink-500 to-violet-500 hover:from-pink-600 hover:to-violet-600 disabled:opacity-50 text-white text-sm font-bold rounded-lg shadow-sm flex items-center justify-center gap-1.5"
              >
                {apply.isPending ? 'Applying…' : <>Apply now <Sparkles className="w-4 h-4" /></>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
