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
  Share2, Shield, ArrowRight, Square, FileText, ListVideo, Download, Upload,
  AlignLeft, AlignCenter, AlignRight, AlignStartVertical, AlignEndVertical,
  Layers, ChevronUp, ChevronDown, Lock, Unlock, GripVertical,
  ZoomIn, ZoomOut, Maximize2, RotateCcw, RotateCw, Palette, MousePointer,
  PanelLeft, Sparkles, Search, FolderOpen, ChevronRight, Wand2, MonitorPlay,
  Check, Expand, ChevronLeft, Trophy, AlertTriangle,
} from 'lucide-react';
import {
  useTemplates, useCreateTemplate, useDeleteTemplate, useCreateFromPreset,
  useDuplicateTemplate, useUpdateTemplate, useUpdateTemplateZones,
  useAssets, usePlaylists, useAssetFolders, useScreens,
  useTenantBranding, useApplyBrandToTemplates, useTemplateUsageSummary,
  useGenerateTouchTemplate, useExportTemplate, useImportTemplate,
  useGenerateTouchCandidates, useCreateFromCandidate, useRefineSignageBoard, type AiTemplateCandidate,
  useGenerateDesignerCandidates, useCreateDesigner,
  useRegenerateBoardImage,
} from '@/hooks/use-api';
// E3 (CRUSH Wave E, 2026-07-03) — shared "Put on a screen" express lane,
// extracted so the editor toolbar (BuilderShell) can reuse it verbatim.
import { usePutOnScreen } from '@/lib/put-on-screen';
import { buildSafeDesignerSrcdoc } from '@/lib/designer-safe-srcdoc';
import dynamic from 'next/dynamic';

// Bundle-split step 2 (2026-07-20): WidgetRenderer is the widget world —
// a ~3.4 MB chunk when bundled statically. Load it on demand so this
// dashboard surface's first paint doesn't parse every widget theme. Same
// pattern as ScaledTemplateThumbnail (the repo's blessed dynamic mount).
// Player + board routes intentionally keep STATIC imports (offline
// life-safety rendering must never wait on a lazy chunk).
const WidgetPreview = dynamic(
  () => import('@/components/widgets/WidgetRenderer').then((m) => ({ default: m.WidgetPreview })),
  { ssr: false, loading: () => null },
);
import { ScaledTemplateThumbnail } from '@/components/templates/ScaledTemplateThumbnail';
// Template builder program, Phase 1 (2026-09-11) — "New template" no longer
// opens a 4-field metadata modal that hard-drops the operator on a white
// canvas. It asks ONE question (name + shape) and lands on a gallery of real
// rendered presets. Loaded on demand: the flow only exists once the operator
// opens it, so it costs the gallery's first paint nothing.
const CreateTemplateFlow = dynamic(
  () => import('@/components/templates/CreateTemplateFlow').then((m) => ({ default: m.CreateTemplateFlow })),
  { ssr: false, loading: () => null },
);
import type { CreateDraft } from '@/components/templates/create-template-flow';
import { needsResize } from '@/components/templates/create-template-flow';
// Templates Gallery — Calm v1 (2026-08-31). Spec:
// scratch/design/templates-page/TEMPLATES-GALLERY-V1-DESIGN-HANDOFF.md
import { TemplateOverflowMenu, type OverflowItem } from '@/components/templates/TemplateOverflowMenu';
import { TemplateUsagePill } from '@/components/templates/TemplateUsagePill';
import {
  type TemplateUsageState,
  deriveTemplateUsage,
  templateNeedsAttention,
  canvasBadgeLabel,
  lastEditedLabel,
  usagePillLabel,
  usageReachLabel,
} from '@/components/templates/template-usage';
import { AiIntakeWizard } from '@/components/templates/AiIntakeWizard';
import { SignageConcierge } from '@/components/templates/SignageConcierge';
import {
  buildMenuContentFromChat,
  buildMenuContentFromReferences,
  referenceMenuItemCount,
} from '@/components/templates/conciergeMenuContent';
import { BriefConfirmStrip } from '@/components/templates/BriefConfirmStrip';
import {
  type AiIntakeAnswers,
  type AiIntakeRequestFields,
  DEFAULT_INTAKE_ANSWERS,
  buildIntakeRequestFields,
} from '@/components/templates/ai-intake-contract';
import {
  useExtractDesignerBrief,
  buildDesignerBriefPayload,
  designerBriefHasSignal,
  useRefineDesignerBoard,
  type DesignerBrief,
} from '@/hooks/use-ai-designer';
import { conciergeVenueName } from '@/components/templates/conciergeVenue';
import { pickConciergeDesignerAssets } from '@/lib/concierge-designer-assets';
import { useTranslations } from 'next-intl';
import type { ConciergeIntake, ConciergeReference } from '@cms/api-types';
import { useParams, useRouter } from 'next/navigation';
import { isFeatureEnabled, FLAGS } from '@/lib/feature-flags';
import { useUIStore } from '@/store/ui-store';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { getAiTemplatePrompts } from '@cms/api-types';
import { appConfirm, appAlert } from '@/components/ui/app-dialog';
import { DateField } from '@/components/ui/date-field';
import { getAiStatusSource } from '@/components/ai/AiGenerateButton';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { transformedImageUrl } from '@/lib/asset-image';

// ─────────────────────────────────────────────────────
// Constants & Helpers
// ─────────────────────────────────────────────────────

// Four main categories + Holidays. Everything else was clutter at
// launch — we can reintroduce niche ones (Classroom, Office, Library)
// later when the library is deeper. These match the physical spots a
// school actually installs a sign: main entrance, hallway wayfinding,
// lunch line, gym/athletic area, plus the seasonal holiday lobby pack.
// K12 default category tabs. For non-K12 verticals the gallery uses
// VERTICAL_TEMPLATE_CATEGORIES from packages/api-types/src/verticals.ts
// resolved via useTenantCopy().templateCategories. This const is kept
// only as the K12 fallback for any non-tenant-aware caller.
/**
 * Map an AI error (structured `code` first, message patterns as a legacy
 * fallback) to one operator-friendly line. Shared by the generate + pick
 * phases of the AI template modal (Slice 1c) so both speak the same
 * language. Mirrors the structured-code handling in AiGenerateButton.tsx.
 */
function friendlyAiError(e: any): string {
  const code = String(e?.code || '');
  const status = Number(e?.status || 0);
  const raw = (e?.message || '').toLowerCase();
  if (code === 'AI_PROVIDER_OUT_OF_CREDIT') {
    return e?.body?.message || e?.message || 'Your AI provider is out of credit. Add credits with your provider and try again.';
  }
  if (code === 'AI_CAP_REACHED' || status === 402) {
    return "This month's included AI is used up. Add your own AI key in Settings → AI provider to keep going, or wait for it to reset next month.";
  }
  if (code === 'AI_FAILURE_CAP_REACHED') {
    return 'Too many failed AI requests in the last hour. Wait an hour, or contact support if you think this is wrong.';
  }
  // 2026-09-22 — a POS-bound board: the server's own words are the actionable
  // ones ("21 items don't fit one screen — choose fewer sections.").
  if (['MENU_BINDING_INCOMPLETE', 'MENU_TOO_MANY_ITEMS', 'POS_SELECTION_EMPTY', 'POS_CONNECTION_NOT_FOUND'].includes(code)) {
    return e?.body?.message || e?.message || 'Choose fewer menu sections and try again.';
  }
  if (code === 'AI_TIMEOUT' || raw.includes('took longer than usual')) {
    return 'The AI took longer than usual on this one. Tap Generate again — it almost always works on the next try.';
  }
  if (raw.includes('not configured')) {
    return "AI isn't enabled for this site. Ask your administrator to add an API key in Settings → AI provider.";
  }
  if (raw.includes('rejected') || raw.includes('re-enter')) return e.message;
  if (status === 429 || raw.includes('hourly') || raw.includes('rate-limit')) {
    return "You've hit this hour's AI generation limit. Try again in a few minutes.";
  }
  if (raw.includes('empty response')) return e.message;
  if (raw.includes('unparseable') || raw.includes('no usable') || raw.includes('any usable options')) {
    return 'The AI returned something unusable. Try rephrasing your prompt with more concrete details.';
  }
  if (raw.includes('unreachable')) return 'Could not reach the AI service. Check your connection or retry.';
  if (status === 503 && e?.message) return e.message;
  return 'Generation failed. Try rephrasing or try again later.';
}

/**
 * The pick grid's label for one candidate (2026-09-22). An AI Designer board is
 * named for the LAYOUT it was built as — the API returns its structure id
 * ("rail-cards"), translated from the `aiBoards.structures` catalog. The old
 * fixed "Balanced / Bold / Detailed" described nothing that was requested; it
 * stays only for the engine's candidates, which have no layout id.
 */
type AiBoardsT = { (key: string): string; has(key: string): boolean };
function candidateLabel(t: AiBoardsT, c: { _structure?: string; _artDirection?: string }, i: number): string {
  if (c._structure) {
    const key = `structures.${c._structure.replace(/-([a-z])/g, (_m, ch: string) => ch.toUpperCase())}`;
    if (t.has(key)) return t(key);
  }
  if (c._artDirection) return c._artDirection;
  return ['Balanced', 'Bold', 'Detailed'][i] || `Option ${i + 1}`;
}

// Args accepted by runGenerateCandidatesCore — hoisted to module scope (2026-
// 07-01, #268 item 3) so aiPendingGenerateArgsRef (declared before the
// callback) can type against it without a forward-reference to the callback
// itself. Mirrors the shape used by both the wizard and Concierge call sites.
interface RunGenerateCandidatesCoreArgs {
  prompt: string;
  intakeFields: AiIntakeRequestFields | ConciergeIntake;
  forceDesigner?: boolean;
  designerExtras?: { palette?: string[]; venueName?: string; logoUrl?: string; heroImageUrl?: string; reference?: string; interactive?: boolean };
  /** BRIEF-ECHO CONFIRM (#268 item 3) — a client-confirmed (or chip-edited)
   *  brief to ride straight into generation, skipping a second extraction. */
  brief?: DesignerBrief | null;
}

const CATEGORY_TABS = [
  { key: '',          label: 'All' },
  { key: 'KIOSK',     label: 'Touch Kiosks' },
  { key: 'LOBBY',     label: 'Welcome' },
  { key: 'HALLWAY',   label: 'Hallway' },
  { key: 'CAFETERIA', label: 'Cafeteria' },
  { key: 'ATHLETICS', label: 'Athletics' },
  { key: 'HOLIDAYS',  label: 'Holidays' },
];

// The "Athletics" tab has no presets tagged with the literal 'ATHLETICS'
// category. The game-day boards (preset-hs-ath-gameday / -standings /
// -biggame / -broadcast) are tagged 'EVENTS', and the live scoreboards are
// the SPORTS-vertical 'scoreboard' presets. This predicate gathers the
// athletics slate so the tab resolves to real boards rather than a blank
// page. Match on id-prefix / category / name so future athletics boards
// land here without another code change.
function isAthleticsPreset(t: { id?: string; name?: string; category?: string }): boolean {
  const id = (t.id || '').toLowerCase();
  const name = (t.name || '').toLowerCase();
  const cat = (t.category || '').toUpperCase();
  if (id.startsWith('preset-hs-ath-')) return true;
  if (id.includes('scoreboard') || cat === 'SCOREBOARD' || cat === 'ATHLETICS') return true;
  return /\b(athletic|athletics|game ?day|scoreboard|big game)\b/.test(name);
}

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
// As of 2026-04-27 (commit pending) every portrait preset has a real
// 2160×3840 native widget. The denylist is empty. Future-proof: leave
// the Set in place so we can hide a preset without ripping out the
// filtering logic if we add a new letterboxed variant later.
//
// 2026-05-16 — the 8 HS District Pack presets are OFF this denylist.
// They were hidden because their HS_* widget types had no renderer
// (the *Widget components were reverted during the Vercel SSR-500
// emergency) — a preset whose widgetType has no dispatch case is the
// exact thing that blanked/crashed the gallery. They are now
// re-pointed at the single `EXTERNAL_HTML` widget (a sandboxed
// iframe of the self-contained HTML template under
// /public/templates/hs/), which always has a renderer and can't
// take down the dashboard. Denylist is intentionally kept (empty)
// so a future letterboxed variant can be hidden without re-adding
// the filter logic.
const LETTERBOXED_PORTRAIT_PRESETS: ReadonlySet<string> = new Set<string>([]);

/** The AI generator's two standard canvases (4K UHD) and what Custom accepts. */
const AI_CANVAS_4K_LANDSCAPE = { w: 3840, h: 2160 } as const;
const AI_CANVAS_4K_PORTRAIT = { w: 2160, h: 3840 } as const;
const AI_CANVAS_MIN_PX = 240;
const AI_CANVAS_MAX_PX = 8192; // the API's zod ceiling on screenWidth/Height

/**
 * Snap a fleet's most-common screen size to the generator's two standard
 * canvases when it is an ordinary 16:9 / 9:16 panel, and keep the EXACT size
 * (as a Custom canvas) when it is not — an LED poster chain, a banner, a
 * square — because those are the installs the CC-1 fix exists for (a board
 * laid out for 16:9 clips on a 960×1080 LED).
 */
export function aiCanvasForFleetSize(w: number, h: number): { canvas: { w: number; h: number }; custom: boolean } {
  const ratio = w / h;
  const near = (target: number) => Math.abs(ratio - target) < 0.02;
  if (near(16 / 9)) return { canvas: { ...AI_CANVAS_4K_LANDSCAPE }, custom: false };
  if (near(9 / 16)) return { canvas: { ...AI_CANVAS_4K_PORTRAIT }, custom: false };
  return { canvas: { w, h }, custom: true };
}

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
  // 2026-05-04 — LED-poster panel-chain presets. Hardware: Nova Star
  // TB40 driving 320×1080 LED panels daisy-chained 1-6 wide. Each
  // chain length needs a template authored at the exact aspect ratio
  // because the player renders zones as % of the actual viewport;
  // a 16:9 layout authored at 1920×1080 will distort horribly on a
  // 1-panel 320×1080 (1:3.375) install.
  { label: 'LED Poster', sub: '1 panel · 320×1080', w: 320, h: 1080 },
  { label: 'LED Poster', sub: '2 panels · 640×1080', w: 640, h: 1080 },
  { label: 'LED Poster', sub: '3 panels · 960×1080', w: 960, h: 1080 },
  { label: 'LED Poster', sub: '4 panels · 1280×1080', w: 1280, h: 1080 },
  { label: 'LED Poster', sub: '5 panels · 1600×1080', w: 1600, h: 1080 },
  { label: 'LED Poster', sub: '6 panels · 1920×1080', w: 1920, h: 1080 },
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
      { type: 'SOCIAL_FEED', label: 'Social Posts', desc: 'Your latest Instagram or Facebook Page posts', icon: Share2 },
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

// ── Calm v1 sorting + paging (§4.5, §9.1) ─────────────────────────────

export type TemplateSortMode = 'recent' | 'name' | 'most-used' | 'newest' | 'oldest';

const SORT_OPTIONS: ReadonlyArray<{ key: TemplateSortMode; label: string }> = [
  { key: 'recent', label: 'Recently edited' },
  { key: 'name', label: 'Name A–Z' },
  { key: 'most-used', label: 'Most used' },
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
];

/**
 * How many cards each section mounts before asking for more.
 *
 * This is the whole of §4.5's "do not mount every live widget tree
 * indefinitely as the catalog grows" on the client side: with ~114 presets
 * in the catalog today, an unpaged gallery mounted 114 preview subtrees on
 * first paint. Twelve is two full rows at the 4-column desktop rhythm and
 * three at three columns, so a page break never lands mid-row.
 */
const SECTION_PAGE_SIZE = 12;

/**
 * The card rhythm (§5.4, §12). One shared constant so the loading
 * skeleton grid and the real grid can never drift — §10.1 requires the
 * skeleton to MATCH the final grid, and a hand-copied class list is
 * exactly the thing that stops matching six months later.
 *
 *   <768  one column          (§12.4 mobile)
 *   768+  two                 (§12.3 tablet portrait)
 *   1024+ three               (§12.2 desktop/tablet landscape)
 *   1280+ four                (§5.4 "Desktop ≥1280px: 4 columns")
 */
const GALLERY_GRID_CLASS = 'grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3 lg:gap-6 xl:grid-cols-4';

/** §14 — honor reduced motion for the one place we scroll programmatically. */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The server's 409 TEMPLATE_IN_USE payload, as the impact dialog needs it. */
export interface TemplateUsageImpact {
  template: { id: string; name: string };
  playlists: Array<{ id: string; name: string }>;
  /** Undefined when the server didn't send it — the dialog then stays
   *  silent about reach rather than printing a zero it can't prove. */
  screensReached?: number;
  locations?: number;
  /** The server's own sentence, when it sent one. */
  message?: string;
}

/**
 * Sort a template list for the operator's chosen mode.
 *
 * `most-used` reads the playlist count already present in the list payload
 * (`_count.playlists`) rather than the usage summary, so the ordering is
 * stable whether or not the usage endpoint answered — a sort that silently
 * reshuffles when a side request fails is worse than no sort at all.
 */
export function sortTemplates<T extends {
  name: string; updatedAt?: string; createdAt?: string; _count?: { playlists?: number };
}>(list: T[], mode: TemplateSortMode): T[] {
  const time = (v?: string) => { const n = v ? Date.parse(v) : NaN; return Number.isFinite(n) ? n : 0; };
  const out = [...list];
  switch (mode) {
    case 'name':
      return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    case 'most-used':
      return out.sort((a, b) =>
        (b._count?.playlists ?? 0) - (a._count?.playlists ?? 0) || time(b.updatedAt) - time(a.updatedAt));
    case 'newest':
      return out.sort((a, b) => time(b.createdAt) - time(a.createdAt));
    case 'oldest':
      return out.sort((a, b) => time(a.createdAt) - time(b.createdAt));
    case 'recent':
    default:
      return out.sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
  }
}

/**
 * Readable fallback for a raw category key (`MEMBER_EDUCATION` →
 * `Member education`). Only used when the caller hasn't resolved the
 * tenant's own vertical-aware label — never as a substitute for it.
 */
function categoryDisplayName(key: string): string {
  const s = (key || '').replace(/_/g, ' ').trim().toLowerCase();
  if (!s) return 'Template';
  return s.charAt(0).toUpperCase() + s.slice(1);
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
  _count?: { zones: number; playlists?: number };
  createdAt: string;
  updatedAt: string;
}

// ═════════════════════════════════════════════════════
// MAIN PAGE
// ═════════════════════════════════════════════════════

export default function TemplatesPage() {
  // 2026-05-15 — render gate to defer the full gallery until after
  // client mount. Why: this page renders ScaledTemplateThumbnail
  // children that mount the full widget catalog (60+ themes, each
  // with their own clock/weather/animation state). Several of those
  // widgets call `useState(new Date())` and similar APIs that
  // produce different output on the server vs client wall clock —
  // result was React #418 (hydration mismatch) firing on every
  // tenant render, which Prod Smoke caught. Server still renders
  // a lightweight loading placeholder (SSR + first hydration both
  // see the same HTML, no mismatch); useEffect bumps `mounted` true
  // post-hydration, then the real gallery renders without any
  // hydration boundary inside it.
  //
  // Hooks below this point still run on every render (Rules of
  // Hooks) — data fetching kicks off during SSR like before, just
  // the JSX OUTPUT is deferred. Net cost is one extra render tick
  // (~16 ms on initial mount); operator never sees the placeholder
  // because hydration is already done by the time React commits.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const tAi = useTranslations('aiBoards') as unknown as AiBoardsT;

  const [activeCategory, setActiveCategory] = useState('');
  const [activeLevel, setActiveLevel] = useState('');
  // Sub-filter active only when category=HOLIDAYS. Empty key = all
  // holidays; otherwise a specific variant ('christmas', 'easter', etc.)
  // matched against the preset's defaultConfig.variant.
  const [activeHoliday, setActiveHoliday] = useState('');
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  // 2026-05-13 — top-pill canvas filter was removed per operator
  // ("add custom above each template where you have portrait and
  // landscape already, you added it in the filter section, get rid
  // of it there"). Canvas-size adaptation now lives on the per-card
  // toggle chip (Landscape | Portrait | Custom) — Custom opens
  // AdaptForLedModal for that specific template.
  const [showCreate, setShowCreate] = useState(false);
  // Phase D3 — AI generate-touch modal. Distinct from the regular
  // create flow: operator types a prompt instead of picking a preset,
  // and the response stream lands them straight in the builder with a
  // pre-built scene-aware template.
  const [showAiGenerate, setShowAiGenerate] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  // Slice 1c (2026-06-16) — 3-candidate "pick-a-winner" flow. Phases:
  //   'intake' (guided 6-question wizard / advanced one-screen view) → 'pick'.
  // (2026-06-28) — the old free-text-only 'prompt' phase is replaced by the
  // AiIntakeWizard; the wizard collects the SAME prompt plus optional directives
  // and runGenerateCandidates forwards them. aiInteractive toggles touch
  // (default) vs passive signage so the same generator serves BOTH surfaces.
  // (2026-07-01, #268 item 3 / task #277) — 'confirm' is a NEW phase that sits
  // between 'intake' and 'pick', ONLY entered by the AI Designer path (the
  // "designer branch" — aiDesignerMode / forceDesigner). It shows the
  // brief-echo confirm strip (BriefConfirmStrip) built from a cheap
  // pre-flight read of the prompt (POST generate-designer/brief) so the
  // operator gets a 2-second glance-confirm BEFORE paying for the expensive
  // 3x fan-out. It is SKIPPABLE and NEVER blocks generation (fail-open — see
  // runGenerateCandidatesCore).
  const [aiPhase, setAiPhase] = useState<'intake' | 'confirm' | 'pick'>('intake');
  // (2026-06-28) — the intake phase now DEFAULTS to a conversational Signage
  // Concierge chat; the guided 6-step wizard stays one click away as a
  // fallback ("Use the guided form instead"). 'chat' | 'wizard'.
  const [aiIntakeMode, setAiIntakeMode] = useState<'chat' | 'wizard'>('chat');
  // (2026-06-28) — the guided-intake answers (purpose/theme/palette/background/
  // widgets). Defaults are all 'auto'/empty so an operator who skips every
  // question gets TODAY's derive-from-prompt + vertical-affinity behavior.
  const [aiIntake, setAiIntake] = useState<AiIntakeAnswers>(DEFAULT_INTAKE_ANSWERS);
  const [aiCandidates, setAiCandidates] = useState<AiTemplateCandidate[]>([]);
  // 2026-09-22 (Greg: "dont default to touch kiosk") — a board is a DISPLAY
  // unless the operator says otherwise. Touch is the exception they pick.
  const [aiInteractive, setAiInteractive] = useState(false);
  // Wave 2a (2026-06-27) — "Build a set" mode: one (or many newline) prompts →
  // ONE cohesive multi-scene template that plays itself. Mutually exclusive with
  // Touch; a set is always non-touch signage.
  const [aiSetMode, setAiSetMode] = useState(false);
  // AI Designer (2026-06-29) — a top model AUTHORS a full designer-grade HTML
  // board (not a templated engine layout). Mutually exclusive with Touch/Set;
  // always non-touch. Routes generate→generate-designer and pick→create-designer.
  const [aiDesignerMode, setAiDesignerMode] = useState(false);
  // BRIEF-ECHO CONFIRM (2026-07-01, #268 item 3 / task #277) — the extracted
  // (or chip-edited) structured brief shown by the 'confirm' phase. Persisted
  // alongside the batch cache (see persistLastBatch/resumeLastBatch below) so
  // resuming a batch keeps its brief context. `aiBriefLoading` drives the
  // skeleton strip for the ~3s the pre-flight extraction call can take;
  // `aiPendingGenerateArgsRef` remembers WHAT to generate once the operator
  // confirms or skips (the confirm phase is a pure interstitial — it never
  // owns the generate call itself, so both the wizard path and the concierge
  // path share one confirm→generate handoff).
  const [aiBrief, setAiBrief] = useState<DesignerBrief | null>(null);
  const [aiBriefLoading, setAiBriefLoading] = useState(false);
  const aiPendingGenerateArgsRef = useRef<RunGenerateCandidatesCoreArgs | null>(null);
  // 2026-09-22 — the last CONCIERGE request, so the pick grid's Regenerate
  // replays it (content, siteMenuMissing, logo, photo, palette, reference,
  // venue name, purpose) through the Designer instead of re-running the guided
  // form with just the prompt — which, with the Designer toggle off, went to
  // the other generator and dropped everything the chat had gathered. Null
  // after a guided-form generation. Persisted with the batch cache, so a
  // resumed batch regenerates the same way.
  const lastConciergeArgsRef = useRef<RunGenerateCandidatesCoreArgs | null>(null);
  // CC-1 (2026-06-27) — canvas size for the AI generate request. Without this
  // every board was generated at 1920×1080 and CLIPPED on a real screen of a
  // different aspect (the live LED is 960×1080 portrait). { w, h } is forwarded
  // to BOTH generate-candidates and create-from-candidate so the engine lays
  // out for the right aspect from the first draft. Defaults to landscape Full HD
  // but is auto-prefilled from the tenant's most-common screen canvas once the
  // screens list resolves (see the prefill effect below).
  // 2026-09-22 (Greg: "so many options that its confusing in this dialog, why
  // a drop down with LED poster? just give standard portrait/landscape at 4k
  // and then a custom button if needed"). The canvas is now 4K UHD landscape
  // or portrait, or Custom — two typed numbers. The "Match a screen…"
  // dropdown and the Square preset are gone; the fleet's real size still
  // seeds the default (see the effect below), it just no longer needs a menu.
  const [aiCanvas, setAiCanvas] = useState<{ w: number; h: number }>({ w: AI_CANVAS_4K_LANDSCAPE.w, h: AI_CANVAS_4K_LANDSCAPE.h });
  const [aiCustomSize, setAiCustomSize] = useState(false);
  // What the operator has TYPED into the Custom fields — kept as text so a
  // half-typed "38" is never snapped back to the last valid value mid-keystroke.
  const [aiCustomText, setAiCustomText] = useState<{ w: string; h: string }>({ w: '', h: '' });
  const aiCanvasDefaultedRef = useRef(false);
  const [aiPicking, setAiPicking] = useState<number | null>(null);
  // Wave 3 — chat-to-edit. Which candidate's "Tweak" box is open, its text, and
  // which one is currently refining (delta-prompt in flight).
  const [aiTweakIdx, setAiTweakIdx] = useState<number | null>(null);
  const [aiTweakText, setAiTweakText] = useState('');
  const [aiRefiningIdx, setAiRefiningIdx] = useState<number | null>(null);
  // (2026-06-30) — keep ALL 3 candidates as reviewable history. Saving a
  // candidate persists it as a real template (it then shows in the gallery —
  // that IS the durable history) WITHOUT clearing the set, so the operator can
  // open each full-screen, go back to the grid, and save any/all of them.
  // `aiSavedIds` maps a candidate index → the template id created when it was
  // saved (so re-saving is a no-op and the card can show "Saved ✓"). It's reset
  // whenever a fresh set is generated (candidate indices change meaning).
  const [aiSavedIds, setAiSavedIds] = useState<Record<number, string>>({});
  // Which candidate is open FULL-SCREEN (null = none). The full-screen preview
  // never discards the set — Esc / Close returns to the grid.
  const [aiFullscreenIdx, setAiFullscreenIdx] = useState<number | null>(null);
  // (2026-06-30) — "Resume last generation": the last fan-out is cached in
  // localStorage so closing the picker doesn't force a re-generate (which costs
  // an AI call). On reopen the intake offers a one-tap restore back into the
  // pick grid. Loaded when the modal opens; written after every generation.
  // `brief` (#268 item 3, added 2026-07-01) — the confirmed brief context for
  // this batch, if any, so resuming a cached batch keeps its brief intact
  // (e.g. for a future "regenerate with the same brief" affordance) instead
  // of silently dropping it.
  const [aiLastBatch, setAiLastBatch] = useState<
    { candidates: AiTemplateCandidate[]; canvas: { w: number; h: number }; interactive: boolean; ts: number; brief?: DesignerBrief | null; replay?: RunGenerateCandidatesCoreArgs | null } | null
  >(null);
  // Esc-to-close — wired only when the modal is open so dashboard
  // keyboard shortcuts elsewhere aren't shadowed. Disabled while a
  // generation is in flight so the operator doesn't accidentally
  // abort their own request mid-flight.
  useEffect(() => {
    if (!showAiGenerate) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't let Esc abort an in-flight generate / candidate fan-out / pick.
      if (
        e.key === 'Escape' &&
        !generateTouch?.isPending &&
        !generateCandidates?.isPending &&
        aiPicking === null
      ) {
        setShowAiGenerate(false);
        resetAiModal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // generateTouch.isPending is read inside the handler — no need
    // in deps array; tearing down/setting-up on every render of a
    // pending state would defeat the listener.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAiGenerate]);
  const [autoEditHandled, setAutoEditHandled] = useState(false);
  const router = useRouter();
  const params = useParams<{ schoolId: string }>();
  const useV2Builder = isFeatureEnabled(FLAGS.TEMPLATE_BUILDER_V2);
  const userRole = useUIStore((s) => s.user?.role);
  // Create, edit, duplicate, adapt-for-LED, export, put-on-screen and design
  // import all carry CONTRIBUTOR in their `@RequireRoles`, so RESTRICTED_VIEWER
  // is the only role they lock out.
  const isViewer = userRole === 'RESTRICTED_VIEWER';
  // AI generation and deletion do NOT. `POST /templates/generate-designer/*`,
  // `generate-touch*`, `generate-signage`, `create-from-candidate`,
  // `concierge/*` and `DELETE /templates/:id` are all
  // `@RequireRoles(SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN)` — a CONTRIBUTOR
  // is neither an admin nor a viewer, so gating these on `isViewer` left them
  // live for a role the API answers with 403.
  const isAdmin =
    userRole === 'SUPER_ADMIN' || userRole === 'DISTRICT_ADMIN' || userRole === 'SCHOOL_ADMIN';
  // 2026-05-03 — vertical-aware template filtering. Categories tabs
  // shown + the K12-only school-level filter visibility both come
  // from the current tenant's vertical via useTenantCopy().
  const tenantCopy = useTenantCopy();


  const openInBuilder = useCallback((t: Template) => {
    // 2026-06-09 — read-only guard. A RESTRICTED_VIEWER must never reach
    // any editor surface (gallery Edit buttons are already disabled; this
    // also covers the inline <TemplateBuilder> path + any programmatic
    // caller). The server is the real guard — every template mutation 403s
    // for this role — this just keeps the read-only UX honest.
    if (isViewer) return;
    // 2026-05-29 (mobile P1) — the template layout builder (both the V2
    // route and the legacy <TemplateBuilder> portal) is desktop/tablet-
    // landscape only; DashboardLayout gates the V2 route behind a
    // `lg:hidden` "Larger screen required" wall at 1024px. Every create /
    // duplicate / AI-generate / import / preset path funnels through here,
    // so without a guard each one silently dumped the phone operator at
    // that blank wall. Instead: on a sub-1024px viewport DON'T navigate
    // into the builder — the new template already shows in the gallery
    // (the mutation invalidates the list), so we just surface a clear
    // handoff toast and leave the operator on the gallery. Desktop is
    // unchanged. Matches the 1024px `lg` breakpoint of the builder gate.
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      void appAlert({
        title: 'Open this on a larger screen to edit',
        message: `"${t.name}" is ready in your gallery. The layout editor needs a tablet in landscape or a desktop (at least 1024px wide) — open it there to arrange widgets.`,
        tone: 'info',
        confirmLabel: 'Got it',
      });
      return;
    }
    if (useV2Builder && !t.isSystem) {
      // Hard-nav (full load) — soft-nav into the builder route doesn't render
      // reliably; a full load does (see openTemplate note).
      window.location.href = `/${params?.schoolId ?? ''}/templates/builder/${t.id}`;
    } else {
      setEditingTemplate(t);
    }
  }, [useV2Builder, router, params?.schoolId, isViewer]);

  // Create form state now lives inside <CreateTemplateFlow /> and comes back
  // as one CreateDraft. The page used to hold six separate pieces of it
  // (name / description / category / w / h / customRes) purely so a 4-field
  // modal could render — and the shape of THAT modal was the problem.
  const [searchQuery, setSearchQuery] = useState('');
  // ── Calm v1 toolbar state (§5.3, §9) ────────────────────────────────
  // Sort applies to the tenant's OWN templates. Ready-made presets keep
  // their curated catalog order (§9.1) — an operator browsing for
  // inspiration is served by the order a designer chose, not by
  // alphabetical chance.
  const [sortMode, setSortMode] = useState<TemplateSortMode>('recent');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  // §4.5 / §5.4 — progressive rendering. The gallery must scale past 100
  // templates without mounting 100 live experiences, so each section
  // renders a page at a time and says exactly how many more there are.
  // "View all" / "Browse all" flip the section to its full library state.
  const [showAllCustom, setShowAllCustom] = useState(false);
  const [presetPages, setPresetPages] = useState(1);
  // §11.3 — the impact dialog for an in-use template. Holds the server's
  // 409 payload so the operator sees real reach, never an invented number.
  const [usageImpact, setUsageImpact] = useState<TemplateUsageImpact | null>(null);
  // §10.2 — "Browse ready-made" from the empty onboarding row scrolls to
  // the catalog rather than navigating away from the page they're on.
  const readyMadeRef = useRef<HTMLElement | null>(null);
  // 2026-05-13 — "Adapt for LED" modal state. Operator clicks the
  // resize icon on any template → modal opens with Portrait /
  // Landscape / Custom orientation picker + size inputs. On save we
  // duplicate the template at the new canvas dimensions, then open
  // the builder for drag-adjustment. The duplicate inherits all zones
  // at their %-positions; widgets self-scale to fit the new aspect.
  const [adaptTemplate, setAdaptTemplate] = useState<Template | null>(null);

  // Hide the mobile tab bar while any page-level overlay is open so its
  // footer/action row clears the bottom of the screen. Covers the Create
  // sheet (bottom-sheet on mobile), the full-screen template Preview, the
  // Adapt-for-LED sheet, and the AI-generate sheet. (The fullscreen builder
  // route already hides the tab bar at the layout level; its internal
  // modals don't need this.) Must run before the `editingTemplate` early
  // return below to satisfy the rules-of-hooks.
  useOverlayLock(showCreate || !!previewTemplate || !!adaptTemplate || showAiGenerate);

  const { data: templates, isLoading, isError, refetch: refetchTemplates } = useTemplates();
  // §4.3 — operational usage for the tenant's own templates. Resolves to
  // `undefined` (not `{}`) whenever the server can't answer, which the
  // cards read as "unknown" and render as nothing. See template-usage.ts.
  const { data: usageByTemplate } = useTemplateUsageSummary();

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
  const generateTouch = useGenerateTouchTemplate();
  const generateCandidates = useGenerateTouchCandidates();
  const createFromCandidate = useCreateFromCandidate();
  const generateDesigner = useGenerateDesignerCandidates();
  const createDesigner = useCreateDesigner();
  const refineSignage = useRefineSignageBoard();
  // Wave D1 (2026-07-02, #282) — the designer-board counterpart of
  // refineSignage above. Engine candidates (c.spec) refine via
  // refine-signage; AI-Designer candidates (c._designerHtml) refine via
  // refine-designer. Both feed the SAME "Tweak" box + translate chips in
  // the picker — see refineCandidate() below for the dispatch.
  const refineDesignerBoard = useRefineDesignerBoard();
  // #268 item 3 / task #277 — the cheap pre-flight brief extraction behind the
  // confirm strip. Fail-open by contract: any rejection is treated exactly
  // like `{ brief: null }` (see startGenerateWithConfirm).
  const extractBrief = useExtractDesignerBrief();
  // Any AI generation in flight (touch-engine OR designer) drives the spinners.
  const aiBusy = [generateCandidates, generateDesigner].some((m) => m.isPending);
  const exportTemplate = useExportTemplate();
  const importTemplate = useImportTemplate();
  // Express lane — "Put on a screen". Creates a one-item playlist FROM this
  // board/template (same path the New-Playlist "From Template" mode uses) and
  // hands off to the playlists page's existing single-tenant Publish-to-Screens
  // flow (a mobile bottom-sheet). Deliberately does NOT touch openInBuilder, so
  // it works on a phone (≤1023px) where the layout editor is gated off.
  // E3 (CRUSH Wave E, 2026-07-03) — extracted into a shared hook
  // (lib/put-on-screen.ts) so the SAME handler is reusable from the
  // in-editor toolbar (BuilderShell) without duplicating the mutation +
  // navigation logic. Behavior here is byte-identical to before extraction.
  const { putOnScreen: putOnScreenShared, puttingOnScreenId } = usePutOnScreen(params?.schoolId, isViewer);

  // CC-1 — real screens for the AI "Match a screen…" picker. Each option
  // resolves to a concrete pixel canvas: an explicit per-screen LED canvas
  // (canvasW×canvasH, e.g. 960×1080) wins, else the parsed `resolution`
  // string ("1920x1080"), else a 1920×1080 fallback. Only screens with a
  // determinable size become options.
  const { data: screensData } = useScreens();
  const aiScreenOptions = useMemo(() => {
    const list: Array<{ id: string; name: string; w: number; h: number }> = [];
    for (const s of (screensData || []) as any[]) {
      let w = 0;
      let h = 0;
      if (typeof s?.canvasW === 'number' && typeof s?.canvasH === 'number' && s.canvasW > 0 && s.canvasH > 0) {
        w = s.canvasW;
        h = s.canvasH;
      } else if (typeof s?.resolution === 'string') {
        const m = s.resolution.match(/(\d{2,5})\s*[x×]\s*(\d{2,5})/i);
        if (m) {
          w = parseInt(m[1], 10);
          h = parseInt(m[2], 10);
        }
      }
      if (w > 0 && h > 0) list.push({ id: s.id, name: s.name || 'Screen', w, h });
    }
    return list;
  }, [screensData]);

  // Prefill the AI canvas from the tenant's MOST-COMMON screen size the first
  // time the screen list resolves, so an operator whose fleet is all 960×1080
  // portrait LEDs gets a portrait board by default — no clipping, no manual
  // flip. Runs ONCE and never fights a manual change thereafter.
  useEffect(() => {
    if (aiCanvasDefaultedRef.current) return;
    if (aiScreenOptions.length === 0) return;
    aiCanvasDefaultedRef.current = true;
    const counts = new Map<string, { w: number; h: number; n: number }>();
    for (const o of aiScreenOptions) {
      const key = `${o.w}x${o.h}`;
      const cur = counts.get(key);
      if (cur) cur.n += 1;
      else counts.set(key, { w: o.w, h: o.h, n: 1 });
    }
    let best: { w: number; h: number; n: number } | null = null;
    for (const v of counts.values()) {
      if (!best || v.n > best.n) best = v;
    }
    if (best) {
      // 2026-09-22 — the fleet decides the ORIENTATION, the standard decides
      // the pixels: an all-1920×1080 fleet gets 4K landscape, not a 1080p
      // board. Only a non-16:9 fleet (LED posters, banners) keeps its exact
      // size, as a Custom canvas the operator can see and change.
      const seeded = aiCanvasForFleetSize(best.w, best.h);
      setAiCanvas(seeded.canvas);
      setAiCustomSize(seeded.custom);
      if (seeded.custom) setAiCustomText({ w: String(seeded.canvas.w), h: String(seeded.canvas.h) });
    }
  }, [aiScreenOptions]);

  // Reset the AI modal back to a clean 'intake' phase. Called on
  // open/close so a stale candidate grid never flashes on reopen.
  const resetAiModal = useCallback(() => {
    setAiPhase('intake');
    setAiIntakeMode('chat');
    setAiCandidates([]);
    setAiError(null);
    setAiPicking(null);
    setAiSavedIds({});
    setAiFullscreenIdx(null);
    setAiIntake(DEFAULT_INTAKE_ANSWERS);
    // #268 item 3 — clear any leftover brief-echo state so a stale confirm
    // strip / pending-generate args never survive to the next open.
    setAiBrief(null);
    setAiBriefLoading(false);
    aiPendingGenerateArgsRef.current = null;
  }, []);

  const closeAiModal = useCallback(() => {
    setShowAiGenerate(false);
    resetAiModal();
  }, [resetAiModal]);

  // 2026-08-24 — extracted from the hero "Generate with AI" button so the
  // honest empty-state CTA (a search/filter combo with zero matches) can
  // offer the exact same entry point instead of just describing it in
  // prose. Same AI-configured check + friendly alert either caller gets.
  // 2026-09-11 (Phase 1) — `opts` exists so the create flow's "Describe it
  // instead" door can hand the modal the canvas the operator already chose
  // and open ON the guided wizard ("What's this screen for?"), which is the
  // surface that was built, working, and unreachable from the create path.
  // Both are applied AFTER resetAiModal(), which defaults intake to chat.
  const openAiGenerate = useCallback(async (opts?: {
    intakeMode?: 'chat' | 'wizard';
    canvas?: { w: number; h: number };
  }) => {
    setAiError(null);
    const src = await getAiStatusSource();
    if (src === 'none') {
      await appAlert({
        title: 'AI isn’t enabled yet',
        message:
          'This account doesn’t have an AI provider set up. Ask your administrator to enable AI in Settings → AI, then try again.',
        tone: 'info',
      });
      return;
    }
    resetAiModal();
    if (opts?.intakeMode) setAiIntakeMode(opts.intakeMode);
    if (opts?.canvas) setAiCanvas(opts.canvas);
    setShowAiGenerate(true);
  }, [resetAiModal]);

  /**
   * The create flow's second subordinate door. Wires the EXISTING
   * AiIntakeWizard — no second generator, no duplicated intake — and
   * carries the shape answer across so the operator is never asked the
   * one question twice.
   */
  const handleDescribeInstead = useCallback(async (draft: CreateDraft) => {
    setShowCreate(false);
    await openAiGenerate({ intakeMode: 'wizard', canvas: { w: draft.width, h: draft.height } });
  }, [openAiGenerate]);

  // ── "Resume last generation" (2026-06-30) ──────────────────────────────
  // Cache the last fan-out in localStorage so closing the picker never forces a
  // paid re-generate. Keyed per school. Best-effort: any storage error (quota /
  // private mode) is swallowed — the feature degrades to "not available".
  const aiBatchKey = `vos:ai:lastbatch:${params?.schoolId ?? 'x'}`;
  const persistLastBatch = useCallback(
    // #268 item 3 — `brief` carries the confirmed brief context for this
    // batch (undefined when the confirm step wasn't taken / found no
    // signal), so a resumed batch keeps its brief instead of losing it.
    (candidates: AiTemplateCandidate[], brief?: DesignerBrief | null) => {
      try {
        if (!candidates?.length) return;
        const replay = lastConciergeArgsRef.current;
        const payload = {
          candidates,
          canvas: aiCanvas,
          interactive: aiInteractive,
          ts: Date.now(),
          brief: brief ?? null,
          replay: replay ? { ...replay, brief: undefined } : null,
        };
        const json = JSON.stringify(payload);
        if (json.length > 3_000_000) return; // don't blow the ~5MB quota
        localStorage.setItem(aiBatchKey, json);
        setAiLastBatch(payload);
      } catch { /* storage unavailable — skip silently */ }
    },
    [aiBatchKey, aiCanvas, aiInteractive],
  );
  // Load the cached batch whenever the modal opens (so the intake can offer it).
  useEffect(() => {
    if (!showAiGenerate) return;
    try {
      const raw = localStorage.getItem(aiBatchKey);
      const p = raw ? JSON.parse(raw) : null;
      setAiLastBatch(p && Array.isArray(p.candidates) && p.candidates.length ? p : null);
    } catch { setAiLastBatch(null); }
  }, [showAiGenerate, aiBatchKey]);
  // One-tap restore: drop the cached set straight into the pick grid.
  const resumeLastBatch = useCallback(() => {
    if (!aiLastBatch?.candidates?.length) return;
    if (aiLastBatch.canvas) setAiCanvas(aiLastBatch.canvas);
    setAiInteractive(!!aiLastBatch.interactive);
    setAiCandidates(aiLastBatch.candidates);
    setAiSavedIds({});
    setAiFullscreenIdx(null);
    setAiError(null);
    // #268 item 3 — restore the batch's brief context alongside its candidates.
    setAiBrief(aiLastBatch.brief ?? null);
    // …and how it was made, so Regenerate replays the same request.
    lastConciergeArgsRef.current = aiLastBatch.replay ?? null;
    setAiPhase('pick');
  }, [aiLastBatch]);

  // Phase 1 → 2: fan out 3 candidate drafts. The SHARED core — both the
  // guided-wizard path and the conversational Signage Concierge path call
  // this with their own prompt + intake-directive source. Everything else
  // (canvas, vertical, interactive, count, engine, set, error mapping,
  // setAiCandidates, setAiPhase('pick')) is identical for both. `intakeFields`
  // is spread straight into the body — the wizard passes
  // buildIntakeRequestFields(answers); the concierge passes its
  // ConciergeIntake directly (it's ALREADY the wire shape). The backend
  // schema is `.passthrough()`, so these ride through. Errors stay inline.
  const runGenerateCandidatesCore = useCallback(
    async ({
      prompt: rawPrompt,
      intakeFields,
      forceDesigner = false,
      designerExtras,
      brief,
    }: RunGenerateCandidatesCoreArgs) => {
      setAiError(null);
      const prompt = rawPrompt.trim();
      if (!prompt) {
        setAiError('Tell the AI what to build.');
        return;
      }
      try {
        // AI Designer (2026-06-29): a top model authors the WHOLE board as HTML.
        // Each board maps to a one-zone EXTERNAL_HTML candidate so the existing
        // pick-grid previews it via srcdoc; the raw html rides on _designerHtml
        // for persist (create-designer, base64).
        if (aiDesignerMode || forceDesigner) {
          // #268 item 3 — the operator-confirmed (or chip-edited) brief, if the
          // confirm strip ran. `buildDesignerBriefPayload` returns undefined for
          // a no-signal brief so the server falls back to its own inline
          // extraction exactly as if the confirm step never happened.
          const briefPayload = buildDesignerBriefPayload(brief);
          const dres = await generateDesigner.mutateAsync({
            prompt,
            screenWidth: aiCanvas.w,
            screenHeight: aiCanvas.h,
            vertical: (tenantCopy.vertical || 'venue').toLowerCase(),
            count: 3,
            // palette/content/venueName/tagline ride through (schema passthrough).
            ...(intakeFields as Record<string, any>),
            // Scraped-reference brand + business-type + logo (Concierge path) win
            // over the intake defaults — this is what makes a pasted URL produce
            // an on-brand, on-subject board (palette = real brand colors;
            // reference = the rich summary incl. "what they sell").
            ...(designerExtras
              ? {
                  ...(designerExtras.palette && designerExtras.palette.length ? { palette: designerExtras.palette } : {}),
                  ...(designerExtras.venueName ? { venueName: designerExtras.venueName } : {}),
                  ...(designerExtras.logoUrl ? { logoUrl: designerExtras.logoUrl } : {}),
                  ...(designerExtras.heroImageUrl ? { heroImageUrl: designerExtras.heroImageUrl } : {}),
                  ...(designerExtras.reference ? { reference: designerExtras.reference } : {}),
                  ...(designerExtras.interactive ? { interactive: true } : {}),
                }
              : {}),
            // Spread via Record<string,any> (matches the intakeFields/designerExtras
            // pattern above) so this doesn't require widening useGenerateDesignerCandidates'
            // mutation variable type — the backend schema `.passthrough()`es it either way.
            ...(briefPayload ? ({ brief: briefPayload } as Record<string, any>) : {}),
          });
          const boards = dres?.candidates || [];
          if (!boards.length) {
            setAiError('The AI returned no options. Try rephrasing your prompt with more concrete details.');
            return;
          }
          const mapped: AiTemplateCandidate[] = boards.map((b) => ({
            name: b.name || 'AI Designer board',
            zones: [{ name: 'board', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100, defaultConfig: { html: b.html } }],
            _designerHtml: b.html,
            // #268-1 keep-telemetry — carried through the picker (and the
            // resume-last-batch cache) so the keep can echo them to the server.
            _batchId: dres?.batchId,
            _artDirection: b.artDirection,
            _structure: b.structure,
          }));
          setAiCandidates(mapped);
          persistLastBatch(mapped, brief); // cache so closing the picker never forces a re-generate
          // Fresh set → forget which indices were saved / open full-screen.
          setAiSavedIds({});
          setAiFullscreenIdx(null);
          setAiPhase('pick');
          return;
        }
        const res = await generateCandidates.mutateAsync({
          prompt,
          // CC-1 — lay the board out for the chosen aspect so it isn't clipped on
          // a real screen of a different size (e.g. a 960×1080 portrait LED).
          screenWidth: aiCanvas.w,
          screenHeight: aiCanvas.h,
          vertical: (tenantCopy.vertical || 'venue').toLowerCase(),
          interactive: aiInteractive,
          // Pick-a-winner = 3 drafts. A SET omits count so the backend builds its
          // cohesive 4-board loop (beta-QA P1: count:3 forced sets down to 3 and
          // never reached the welcome→offer→hours→event story).
          count: aiSetMode ? undefined : 3,
          // Passive signage boards run through the signage-design art-director
          // engine (Wave 2) — grid-locked archetype + theme + signage-scale type.
          // Touch templates keep the multi-scene generator (touchActions).
          engine: !aiInteractive,
          // Wave 2a — "Build a set": ONE cohesive multi-scene template (the whole
          // venue loop) instead of 3 single-board options to pick from.
          set: aiSetMode,
          // (2026-06-28) — guided-intake directives (purpose/theme/palette/
          // background/widgets). The backend schema is `.passthrough()`, so these
          // ride through even before the backend lane consumes them.
          ...intakeFields,
        });
        const cands = res?.candidates || [];
        if (!cands.length) {
          setAiError('The AI returned no options. Try rephrasing your prompt with more concrete details.');
          return;
        }
        setAiCandidates(cands);
        persistLastBatch(cands); // cache so closing the picker never forces a re-generate
        // Fresh set → forget which indices were saved / open full-screen.
        setAiSavedIds({});
        setAiFullscreenIdx(null);
        setAiPhase('pick');
      } catch (e: any) {
        setAiError(friendlyAiError(e));
      }
    },
    [aiInteractive, aiSetMode, aiDesignerMode, aiCanvas, tenantCopy.vertical, generateCandidates, generateDesigner, persistLastBatch],
  );

  // BRIEF-ECHO CONFIRM handoff (#268 item 3 / task #277) — the shared
  // interstitial both the wizard and the Concierge route through. Designer
  // branch only: stash the generate args, fire the cheap extraction, and show
  // the confirm strip. FAIL-OPEN everywhere: extraction error or a no-signal
  // brief generates immediately, exactly as if this step didn't exist. A
  // Regenerate from the pick grid skips the interstitial (the operator
  // already vetted the brief) and reuses the batch's confirmed brief.
  const startGenerateWithConfirm = useCallback(
    (args: RunGenerateCandidatesCoreArgs) => {
      const willUseDesigner = !!args.forceDesigner || aiDesignerMode;
      if (!willUseDesigner) return runGenerateCandidatesCore(args);
      if (aiPhase === 'pick') return runGenerateCandidatesCore({ ...args, brief: aiBrief });
      aiPendingGenerateArgsRef.current = args;
      setAiError(null);
      setAiBrief(null);
      setAiBriefLoading(true);
      setAiPhase('confirm');
      extractBrief.mutate(
        {
          prompt: args.prompt,
          vertical: (tenantCopy.vertical || 'venue').toLowerCase(),
          // The scraped-reference summary (Concierge path) is the richest
          // extra signal we have — same text the designer prompt consumes.
          ...(args.designerExtras?.reference ? { content: args.designerExtras.reference } : {}),
        },
        {
          onSuccess: (res) => {
            setAiBriefLoading(false);
            if (designerBriefHasSignal(res?.brief)) {
              setAiBrief(res.brief);
              return; // wait in 'confirm' for the operator's glance
            }
            // No signal → nothing worth confirming. Generate immediately.
            aiPendingGenerateArgsRef.current = null;
            void runGenerateCandidatesCore(args);
          },
          onError: () => {
            // Fail-open: an extraction failure is invisible by design.
            setAiBriefLoading(false);
            aiPendingGenerateArgsRef.current = null;
            void runGenerateCandidatesCore(args);
          },
        },
      );
    },
    [aiDesignerMode, aiPhase, aiBrief, extractBrief, tenantCopy.vertical, runGenerateCandidatesCore],
  );

  // "Looks right — Generate": ride the confirmed (possibly chip-edited) brief
  // into the fan-out. "Skip": generate with no brief (server extracts inline).
  const confirmBriefAndGenerate = useCallback(() => {
    const args = aiPendingGenerateArgsRef.current;
    if (!args) return;
    void runGenerateCandidatesCore({ ...args, brief: aiBrief });
  }, [aiBrief, runGenerateCandidatesCore]);
  const skipBriefAndGenerate = useCallback(() => {
    const args = aiPendingGenerateArgsRef.current;
    if (!args) return;
    void runGenerateCandidatesCore({ ...args, brief: null });
  }, [runGenerateCandidatesCore]);

  // The WIZARD path: prompt = the wizard's prompt field; intake = the guided
  // answers resolved to wire fields.
  const runGenerateCandidates = useCallback(() => {
    return startGenerateWithConfirm({
      prompt: aiPrompt,
      intakeFields: buildIntakeRequestFields(aiIntake),
    });
  }, [aiPrompt, aiIntake, startGenerateWithConfirm]);
  // The guided form's Generate: a guided-form batch has no Concierge request
  // to replay.
  const runGenerateFromWizard = useCallback(() => {
    lastConciergeArgsRef.current = null;
    return runGenerateCandidates();
  }, [runGenerateCandidates]);
  // The pick grid's Regenerate: the request that made THIS batch, again.
  const regenerateBatch = useCallback(() => {
    const replay = lastConciergeArgsRef.current;
    return replay ? startGenerateWithConfirm(replay) : runGenerateCandidates();
  }, [startGenerateWithConfirm, runGenerateCandidates]);

  // The CONCIERGE path: the chat hands us a synthesized prompt (brief) + a
  // ConciergeIntake that's ALREADY the wire shape — spread it directly (do NOT
  // run it through buildIntakeRequestFields, which expects the wizard's answer
  // shape). The prompt feeds aiPrompt too so the pick-grid "Regenerate" works.
  const runGenerateFromConcierge = useCallback(
    (args: {
      prompt: string;
      intake: ConciergeIntake;
      references?: ConciergeReference[];
      userNotes?: string;
      wantsTouch?: boolean;
      /** 2026-09-22 — the POS menu picked in the Concierge's card. */
      posSelection?: { connectionId: string; sections: string[] };
    }) => {
      // The synthesized brief summarizes the chat and loses specifics. Append
      // the operator's verbatim chat turns so the designer agent honors exactly
      // what they asked for (the 2026-06-29 "it ignored my chat" report). Only
      // append when the notes add detail beyond the brief.
      const notes = (args.userNotes || '').trim();
      const prompt =
        notes && notes !== args.prompt.trim()
          ? `${args.prompt}\n\nOperator's exact words from the chat — honor every specific they mentioned (items, offers, prices, tone, layout): ${notes}`.slice(0, 4000)
          : args.prompt;
      setAiPrompt(prompt);
      // Distill the gathered references (scraped site + uploaded images) into
      // the designer brief: deduped brand palette, a logo/hero image, and the
      // rich summary text — which now carries "what they sell" (the 2026-06-29
      // Domino's fix). The conversational Concierge ALWAYS routes to the trained
      // AI-Designer agent so a pasted URL + chat yields a designer-grade,
      // on-brand, on-SUBJECT board — never the engine's generic template.
      const refs = args.references || [];
      const palette = Array.from(
        new Set(refs.flatMap((r) => (Array.isArray(r.palette) ? r.palette : [])).filter(Boolean)),
      ).slice(0, 8);
      // The brand's REAL logo (its own mark) and REAL hero/work photo — kept
      // SEPARATE so the board places the logo in the header AND uses the photo as
      // the hero (the 2026-06-30 "take color, content, logos" fix). 2026-09-23:
      // the operator's own image wins (upload > POS > site > stock), and whose it
      // is rides along so the Designer never captions a stock photo as theirs.
      const assets = pickConciergeDesignerAssets(refs);
      const logoUrl = assets.logoUrl;
      const heroImageUrl = assets.heroImageUrl;
      const reference = refs.map((r) => r.summary).filter(Boolean).join('\n\n').slice(0, 4000) || undefined;
      // THE REAL MENU (2026-09-22). A URL reference can now carry the venue's
      // actual menu, read off their own site. It rides as the designer's
      // `content` — NOT as more `reference` text — because that one field is
      // what (a) stops the server's auto-grounding from reaching into this
      // tenant's catalog for the test price book that shipped on Greg's three
      // boards, (b) grounds every price against the fact guard, and (c) past 8
      // rows switches the designer into full-board menu layout. `intakeFields`
      // is spread straight into the request body and the schema passes it
      // through, so no plumbing between here and the prompt has to change.
      // THE MENU, IN ORDER OF AUTHORITY (2026-09-22): what the operator pasted
      // into the chat, then any menu read off their website or a photo of it.
      // 2026-09-22 — an explicit POS pick REPLACES any site/pasted menu: the
      // server builds the board's item list from that POS and binds every row.
      const menuContent = args.posSelection
        ? undefined
        : [buildMenuContentFromChat(args.userNotes), buildMenuContentFromReferences(refs)]
            .filter(Boolean)
            .join('\n\n')
            .slice(0, 7_500) || undefined;
      // They pointed us at their website and no menu came off it (and they
      // have not pasted one): tell the server, so it does not quietly fill the
      // board from this account's hand-entered price book — the burger / fries /
      // shake test rows that went on every Super Taco board. A catalog synced
      // from a live POS still grounds; the server decides that.
      const siteMenuMissing =
        !args.posSelection && !menuContent && refs.some((r) => r.kind === 'url' && referenceMenuItemCount(r) === 0);
      // The business the board is FOR (2026-09-22) — never sent before, so the
      // model guessed the name and the server could not tell a taqueria's board
      // made from a school account from the school's own.
      const venueName = conciergeVenueName(refs);
      const request: RunGenerateCandidatesCoreArgs = {
        prompt,
        intakeFields: {
          ...args.intake,
          ...(menuContent ? { content: menuContent } : {}),
          ...(siteMenuMissing ? { siteMenuMissing: true } : {}),
          ...(args.posSelection ? { posSelection: args.posSelection } : {}),
          ...(assets.logoSource ? { logoSource: assets.logoSource } : {}),
          ...(assets.heroImageSource ? { heroImageSource: assets.heroImageSource } : {}),
        },
        forceDesigner: true,
        designerExtras: {
          ...(palette.length ? { palette } : {}),
          ...(logoUrl ? { logoUrl } : {}),
          ...(heroImageUrl ? { heroImageUrl } : {}),
          ...(reference ? { reference } : {}),
          // TAP TARGETS (2026-08-25) — the operator asked for touch / links /
          // buttons in their OWN words, so the designer marks real [data-action]
          // hot zones the player can dispatch. Their DESTINATIONS are never sent
          // from here: the player resolves each key against the operator's own
          // saved wiring, so this can only make a board tappable. Before this,
          // "a touch-friendly menu with our services tied to links" was silently
          // generated as a passive poster.
          ...(args.wantsTouch ? { interactive: true } : {}),
          ...(venueName ? { venueName } : {}),
        },
      };
      lastConciergeArgsRef.current = request;
      return startGenerateWithConfirm(request);
    },
    [startGenerateWithConfirm],
  );

  // ── Express lane: "Put on a screen" ──
  // The most-marketed flow ("AI board → onto a screen") was multi-step AND
  // blocked on a phone, because every persist routed through the desktop-only
  // layout builder (openInBuilder bounces ≤1023px). This bypasses the builder
  // entirely: spin up a template-backed playlist (one DB row, no item wiring —
  // a template playlist references the template), then deep-link the playlists
  // page to its existing Publish-to-Screens sheet (role-correct for SCHOOL_ADMIN
  // and mobile-friendly). Works identically on desktop and phone. This is the
  // gallery card's "Put on a screen" action — E3 (2026-07-03) reuses the exact
  // same handler (see usePutOnScreen above) from the in-editor toolbar too.
  // The AI generation flow itself no longer publishes-to-screen directly
  // (operators always tweak first, 2026-06-30).
  const putOnScreen = putOnScreenShared;

  // Phase 2 — persist ONE candidate as a real template WITHOUT discarding the
  // set (2026-06-30). The operator can save any/all of the 3; each saved board
  // shows in the gallery — that IS the durable history they asked for. Returns
  // the created Template (or null on failure). Idempotent: a candidate already
  // saved this session is NOT re-created — we return its existing template via a
  // light shape so callers can still route to it.
  //
  // NOTE: this no longer publishes-to-screen (removed per operator: they always
  // tweak before publishing). Publish lives only on the gallery "Put on a
  // screen" button, outside the generation flow.
  const saveCandidate = useCallback(async (index: number): Promise<Template | null> => {
    const candidate = aiCandidates[index];
    if (!candidate) return null;
    // Already saved this session → no-op (don't create a duplicate). We don't
    // hold the full Template object, but callers that need to navigate handle
    // the already-saved case via openInBuilder on the id-bearing minimal shape.
    const existingId = aiSavedIds[index];
    if (existingId) {
      return { id: existingId, name: candidate.name } as unknown as Template;
    }
    setAiError(null);
    setAiPicking(index);
    try {
      let created: Template | null = null;
      // AI Designer board → persist the full HTML via create-designer. base64
      // so the global input sanitizer passes it through intact (a raw html
      // field would be gutted of its <style>/<script>).
      if (candidate._designerHtml) {
        const htmlBase64 = btoa(unescape(encodeURIComponent(candidate._designerHtml)));
        const res = await createDesigner.mutateAsync({
          name: candidate.name,
          htmlBase64,
          screenWidth: aiCanvas.w,
          screenHeight: aiCanvas.h,
          // #268-1 keep-telemetry — echo the generation batch + which of the
          // 3 candidates/art directions was kept, so first-try keep rate is
          // measurable in the audit log (joins AI_DESIGNER_CANDIDATES).
          batchId: candidate._batchId,
          candidateIndex: index,
          artDirection: candidate._artDirection,
        });
        created = res?.id ? (res as unknown as Template) : null;
      } else {
        const res = await createFromCandidate.mutateAsync({
          candidate,
          // CC-1 — persist the template at the same canvas it was laid out for,
          // so the created board's screenWidth/Height match the target screen.
          screenWidth: aiCanvas.w,
          screenHeight: aiCanvas.h,
          interactive: aiInteractive,
          // Wave 2 fix (beta-QA P1): forward the art-director background so the
          // engine board persists with its theme gradient/photo. Without this the
          // board rendered FLAT on screen — the central output was silently lost.
          background: candidate.background,
        });
        created = res?.template?.id ? (res.template as unknown as Template) : null;
      }
      if (created?.id) {
        // Mark this index saved (shows "Saved ✓"); keep the set on screen.
        setAiSavedIds((prev) => ({ ...prev, [index]: created!.id }));
        return created;
      }
      setAiError('That option could not be created. Pick another or regenerate.');
      return null;
    } catch (e: any) {
      setAiError(friendlyAiError(e));
      return null;
    } finally {
      setAiPicking(null);
    }
  }, [aiCandidates, aiSavedIds, aiInteractive, aiCanvas, createFromCandidate, createDesigner]);

  // "Open in editor" — save (if not already) AND navigate to the layout builder.
  // This one DOES leave the modal (it navigates away) — expected for the
  // explicit "edit now" action.
  const openCandidateInEditor = useCallback(async (index: number) => {
    const created = await saveCandidate(index);
    if (!created?.id) return;
    closeAiModal();
    setAiPrompt('');
    openInBuilder(created);
  }, [saveCandidate, closeAiModal, openInBuilder]);

  // Wave 3 — chat-to-edit. Refine candidate `index` by a natural-language tweak
  // and REPLACE it in place. Closes the tweak box.
  //
  // Wave D1 (2026-07-02, #282) — dispatches on candidate shape so the SAME
  // Tweak box + translate chips work for BOTH candidate architectures the
  // default (Concierge → AI-Designer) flow can produce:
  //   - engine candidates (c.spec set)         → refine-signage (delta over spec)
  //   - AI-Designer boards (c._designerHtml)   → refine-designer (revise the HTML)
  // Before this fix, canTweak gated on `!!c.spec` alone, so on the app's
  // DEFAULT generation path (forceDesigner, see runGenerateCandidatesCore)
  // every candidate lacked a spec and the whole refine/translate loop
  // silently vanished from the picker.
  const refineCandidate = useCallback(async (index: number, instruction: string) => {
    const candidate = aiCandidates[index];
    const text = instruction.trim();
    if (!candidate || !text) return;
    const vertical = (tenantCopy.vertical || 'venue').toLowerCase();
    setAiError(null);
    setAiRefiningIdx(index);
    try {
      if (candidate._designerHtml) {
        const res = await refineDesignerBoard.mutateAsync({
          html: candidate._designerHtml,
          instruction: text,
          vertical,
        });
        const newHtml = res?.html;
        if (newHtml && newHtml.length > 200) {
          setAiCandidates((prev) => prev.map((c, i) => (i === index ? {
            ...c,
            _designerHtml: newHtml,
            zones: [{ ...(c.zones?.[0] || { name: 'board', widgetType: 'EXTERNAL_HTML', x: 0, y: 0, width: 100, height: 100 }), defaultConfig: { html: newHtml } }],
          } : c)));
          setAiSavedIds((prev) => {
            if (!(index in prev)) return prev;
            const next = { ...prev };
            delete next[index];
            return next;
          });
          setAiTweakIdx(null);
          setAiTweakText('');
        } else {
          setAiError("That change couldn't be applied. Try rephrasing it.");
        }
        return;
      }
      if (!candidate.spec) return;
      const res = await refineSignage.mutateAsync({
        spec: candidate.spec,
        instruction: text,
        vertical,
      });
      const refined = res?.candidates?.[0];
      if (refined) {
        setAiCandidates((prev) => prev.map((c, i) => (i === index ? refined : c)));
        // The content at this index changed → clear its "Saved" mark so the
        // refined version can be saved as a fresh template (the earlier save,
        // if any, already lives in the gallery as a separate row).
        setAiSavedIds((prev) => {
          if (!(index in prev)) return prev;
          const next = { ...prev };
          delete next[index];
          return next;
        });
        setAiTweakIdx(null);
        setAiTweakText('');
      } else {
        setAiError('That change produced nothing usable. Try rephrasing it.');
      }
    } catch (e: any) {
      setAiError(friendlyAiError(e));
    } finally {
      setAiRefiningIdx(null);
    }
  }, [aiCandidates, refineSignage, refineDesignerBoard, tenantCopy.vertical]);

  // Human label for a category key — reads the vertical-aware tab set
  // (same source the filter buttons render from) so the empty-state copy
  // matches the operator's vocabulary. Falls back to the raw key.
  const categoryLabel = (key: string): string => {
    if (!key) return 'matching';
    const cats = (tenantCopy.templateCategories && tenantCopy.templateCategories.length > 0)
      ? tenantCopy.templateCategories
      : CATEGORY_TABS;
    return cats.find((c) => c.key === key)?.label || key;
  };

  // Human label for a school-level key — same lookup pattern as
  // categoryLabel above, used by the honest empty-state message so a
  // level-only ("High School") dead end reads as clearly as a
  // category-only one.
  const levelLabel = (key: string): string =>
    SCHOOL_LEVEL_CHIPS.find((c) => c.key === key)?.label || key;

  const q = searchQuery.trim().toLowerCase();
  const filtered = (templates || []).filter((t: Template) => {
    // Hide letterboxed portrait presets — see LETTERBOXED_PORTRAIT_PRESETS
    // header. These render at 2160×3840 but their widget caps the
    // canvas at 1920×1080 so the result is a centered band with 68%
    // empty bgColor. Real portrait variants (with dedicated
    // *PortraitWidget components) ship one at a time post-launch.
    if (LETTERBOXED_PORTRAIT_PRESETS.has(t.id)) return false;
    // Touch kiosks are their own top-level surface: they appear ONLY under the
    // "Touch Kiosks" (KIOSK) tab — never under "All", another category, or a
    // school-level (HS/MS/ES) view. They're tagged schoolLevel UNIVERSAL (a
    // touch kiosk isn't grade-specific), which "always shows", so without this
    // guard they leaked into every level/category. (Operator 2026-06-06: "I
    // click the High School filter and I get all the touch — I don't want
    // that.") Every vertical's category set includes a KIOSK tab, so touch
    // stays reachable in all verticals.
    if (t.category === 'KIOSK' && activeCategory !== 'KIOSK') return false;
    // ATHLETICS tab — no preset is tagged with the literal 'ATHLETICS'
    // category; the game-day/scoreboard boards live under 'EVENTS' (the
    // 4 `preset-hs-ath-*` stadium boards) plus the SPORTS-vertical
    // scoreboard presets. Map the tab to those so clicking "Athletics"
    // shows the gameday slate instead of a blank page. (2026-06-26 fix.)
    if (activeCategory === 'ATHLETICS') {
      if (!isAthleticsPreset(t)) return false;
    } else if (activeCategory && t.category !== activeCategory) {
      return false;
    }
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
  // §9.1 — sort applies to the tenant's OWN library. Presets keep their
  // curated order, which IS the recommendation.
  const customTemplates = sortTemplates<Template>(
    filtered
      .filter((t: Template) => !t.isSystem)
      .filter((t: Template) => !t.id.endsWith('-portrait')),
    sortMode,
  );

  // §4.5 — what is actually mounted right now, versus what exists.
  const visibleCustom = showAllCustom ? customTemplates : customTemplates.slice(0, SECTION_PAGE_SIZE);
  const visiblePresets = systemTemplates.slice(0, presetPages * SECTION_PAGE_SIZE);
  const hiddenCustom = customTemplates.length - visibleCustom.length;
  const hiddenPresets = systemTemplates.length - visiblePresets.length;

  // §5.2 — the library summary line. It states only what we can prove:
  // with the usage summary in hand it reports how many templates are
  // currently in use; without it, it falls back to the honest
  // "N templates · M yours" rather than inventing reach.
  const ownedCount = (templates || []).filter(
    (t: Template) => !t.isSystem && !t.id.endsWith('-portrait') && !LETTERBOXED_PORTRAIT_PRESETS.has(t.id),
  ).length;
  const totalCount = (templates || []).filter(
    (t: Template) => !t.id.endsWith('-portrait') && !LETTERBOXED_PORTRAIT_PRESETS.has(t.id),
  ).length;
  const inUseCount = usageByTemplate
    ? Object.values(usageByTemplate).filter((u) => (u?.playlists ?? 0) > 0 || (u?.screensReached ?? 0) > 0).length
    : null;
  const summaryLine = inUseCount === null
    ? `${totalCount} template${totalCount === 1 ? '' : 's'} · ${ownedCount} ${ownedCount === 1 ? 'is yours' : 'are yours'}`
    : `${totalCount} template${totalCount === 1 ? '' : 's'} · ${inUseCount} currently in use`;

  /** The tenant's own word for a category key, for card metadata (§3). */
  const categoryChipLabel = (key: string): string => {
    const cats = (tenantCopy.templateCategories && tenantCopy.templateCategories.length > 0)
      ? tenantCopy.templateCategories
      : CATEGORY_TABS;
    return cats.find((c) => c.key === key)?.label || categoryDisplayName(key);
  };

  /** Everything the gallery needs to render one tenant-owned card. */
  const ownedCardProps = (t: Template) => ({
    usage: deriveTemplateUsage(usageByTemplate, t.id),
    needsAttention: templateNeedsAttention(t),
    categoryLabel: categoryChipLabel(t.category),
  });

  const clearAllFilters = () => {
    setActiveCategory(''); setActiveLevel(''); setActiveHoliday(''); setSearchQuery('');
  };
  const anyFilterActive = !!(activeCategory || activeLevel || activeHoliday || searchQuery.trim());

  /**
   * "Start from blank" — byte-for-byte the old Create button's request,
   * including the single full-screen EMPTY seed zone. The builder's
   * `isBlankTemplate` guidance is written for exactly this shape, so the
   * onboarding copy an operator sees on arrival stays reachable.
   */
  async function handleStartBlank(draft: CreateDraft) {
    if (!draft.name) return;
    const result = await createTemplate.mutateAsync({
      name: draft.name,
      description: draft.description || undefined,
      category: draft.category,
      orientation: draft.orientation,
      screenWidth: draft.width,
      screenHeight: draft.height,
      zones: [{ name: 'Full Screen', widgetType: 'EMPTY', x: 0, y: 0, width: 100, height: 100 }],
    });
    setShowCreate(false);
    openInBuilder(result);
  }

  /**
   * The DEFAULT door: an operator picked a real, finished-looking board
   * out of the gallery.
   *
   * The canvas they answered for wins over the canvas the preset happens
   * to be authored at — that is the point of asking shape once, up front,
   * and it is the same mechanism "Adapt for LED" and the preset
   * orientation flip already use (zones are %-based; widgets self-scale).
   *
   * The resize DEGRADES, it never fails: if that second write is refused
   * we still open the board the operator chose, at the preset's own size,
   * rather than dead-ending a create they already committed to.
   */
  async function handlePickPreset(preset: Template, draft: CreateDraft) {
    const created = await createFromPreset.mutateAsync({
      presetId: preset.id,
      name: draft.name || preset.name,
    });
    setShowCreate(false);
    if (created && needsResize(created, draft)) {
      try {
        const resized = await updateTemplate.mutateAsync({
          id: created.id,
          orientation: draft.orientation,
          screenWidth: draft.width,
          screenHeight: draft.height,
        });
        openInBuilder({ ...created, ...resized });
        return;
      } catch {
        // Fall through — the board exists and is the operator's; the only
        // thing lost is the canvas adjustment, which they can redo from
        // "Adapt to screen size".
      }
    }
    openInBuilder(created);
  }

  /**
   * §11 — deletion safety.
   *
   * TWO PATHS, and the difference between them is the whole point:
   *
   *  - UNUSED template → a plain confirmation, with wording that tells the
   *    truth. §11.1/§11.2 ask for "Move to trash … recoverable for 30
   *    days"; we do not have a Trash, a retention window or a restore
   *    (§11.4 names that gap), so we say "permanently" instead of
   *    promising a safety net that does not exist. The day the backend
   *    gains real soft-delete, this copy changes with it.
   *
   *  - IN-USE template → we never open with a destructive button. The
   *    server answers 409 TEMPLATE_IN_USE with the playlists it found, and
   *    that becomes an impact dialog whose PRIMARY action is "Review
   *    usage" (§11.3: "The safe path is Review usage, not an emphasized
   *    Delete anyway"). The old flow did the opposite — it read a cached
   *    playlist count, pre-armed a "Delete anyway" button, and let one
   *    click unlink a layout from every playlist using it.
   *
   * DEGRADATION: an older API that answers 409 with only `{message}` (no
   * playlists array) still lands in the impact dialog — with the server's
   * own sentence and no invented numbers. An API that doesn't 409 at all
   * deletes as before.
   */
  async function handleDeleteTemplate(t: Template) {
    // `DELETE /templates/:id` is admin-only; the server is the real guard,
    // this just keeps a programmatic caller from opening a confirm dialog
    // whose only outcome could be a 403.
    if (!isAdmin) return;
    const ok = await appConfirm({
      title: `Delete “${t.name}”?`,
      message:
        `This permanently removes “${t.name}”. It can’t be restored, and any screens scheduled ` +
        `with this layout fall back to the next playlist.`,
      tone: 'danger',
      confirmLabel: 'Delete template',
    });
    if (!ok) return;
    try {
      await deleteTemplate.mutateAsync({ id: t.id });
    } catch (err: any) {
      if (err?.code === 'TEMPLATE_IN_USE') {
        const body = err?.body || {};
        // The new contract nests everything under `usage`; the API shipping
        // today puts `playlists` at the top level. Read both so this branch
        // is correct whichever half of the deploy lands first.
        const playlists = Array.isArray(body?.usage?.playlists)
          ? body.usage.playlists
          : Array.isArray(body.playlists) ? body.playlists : [];
        setUsageImpact({
          template: { id: t.id, name: t.name },
          playlists,
          screensReached: typeof body?.usage?.screensReached === 'number'
            ? body.usage.screensReached
            : typeof body.screensReached === 'number' ? body.screensReached : undefined,
          locations: typeof body?.usage?.locations === 'number'
            ? body.usage.locations
            : typeof body.locations === 'number' ? body.locations : undefined,
          message: typeof body.message === 'string' ? body.message : undefined,
        });
        return;
      }
      await appAlert({
        title: 'Couldn’t delete this template',
        message: err?.message || 'Something went wrong deleting this template. Please try again.',
      });
    }
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

  /**
   * Default open-template behavior. System presets route to the
   * read-only builder URL (which auto-converts to a custom on first
   * save); custom templates open in the editable builder directly.
   * Custom-canvas adapts now route through the per-card Custom chip
   * → AdaptForLedModal, NOT through here.
   */
  function openTemplate(source: Template) {
    // Mobile handoff (see openInBuilder): system presets take a direct
    // route to the read-only V2 builder URL, which hits the same 1024px
    // desktop wall. Gate it the same way so a phone operator gets the
    // handoff toast instead of the blank "Larger screen required" page.
    if (
      source.isSystem &&
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 1023px)').matches
    ) {
      void appAlert({
        title: 'Open this on a larger screen to edit',
        message: `"${source.name}" opens in the layout editor, which needs a tablet in landscape or a desktop (at least 1024px wide). You can still browse it here on your phone.`,
        tone: 'info',
        confirmLabel: 'Got it',
      });
      return;
    }
    if (source.isSystem) {
      // Hard-nav (full load), NOT router.push. Soft-navigating into the heavy
      // code-split builder route doesn't render reliably — operator: "it
      // doesn't load the editor, but when I refresh I'm in the editor." A full
      // load is exactly what that refresh does, and what the playlists page
      // already uses to open the builder.
      window.location.href = `/${params?.schoolId}/templates/builder/${source.id}`;
    } else {
      openInBuilder(source);
    }
  }

  async function handleDuplicate(template: Template) {
    const result = await duplicateTemplate.mutateAsync({ id: template.id });
    openInBuilder(result);
  }

  // ── Cross-account export / import ──
  // Export downloads the template as a portable .educms-template.json
  // file; import reads such a file and creates a fresh template in the
  // CURRENT account. Lets an operator move a design between their own
  // accounts. The file carries only design data — no ids, no tenant.
  async function handleExport(template: Template) {
    try {
      const envelope = await exportTemplate.mutateAsync(template.id);
      const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(template.name || 'template').replace(/[^\w.-]+/g, '-')}.educms-template.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      await appAlert({ title: 'Export failed', message: err?.message || 'Could not export this template.' });
    }
  }

  async function handleImportFile(file: File) {
    let envelope: any;
    try {
      envelope = JSON.parse(await file.text());
    } catch {
      await appAlert({
        title: 'Import failed',
        message: `"${file.name}" is not valid JSON. Pick a .educms-template.json file exported from a template.`,
      });
      return;
    }
    try {
      const created = await importTemplate.mutateAsync(envelope);
      openInBuilder(created);
    } catch (err: any) {
      await appAlert({ title: 'Import failed', message: err?.message || 'Could not import that template file.' });
    }
  }

  function handleImportClick() {
    // Build the file picker on the fly — no hidden <input> / ref needed.
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void handleImportFile(file);
    };
    input.click();
  }

  if (editingTemplate) {
    return createPortal(
      <TemplateBuilder template={editingTemplate} onBack={() => setEditingTemplate(null)} onSaved={(u) => setEditingTemplate(u)} />,
      document.body
    );
  }

  // ── Gallery ──
  // Render gate (see `mounted` setup at top of function). Skips
  // the heavy widget-thumbnail tree during SSR + first hydration
  // tick so React #418 can't fire from clock/weather widget state
  // differences between server time and client time. The hooks
  // above this point already kicked off data fetching.
  if (!mounted) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-slate-400 text-sm">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading templates…
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Page header (Calm v1 §4.1, §5.2) ───────────────────────────
          The gradient hero that used to live here was a marketing panel on
          a working page: ~200px of decoration above the fold, and three
          utility actions dressed as landing-page CTAs so none of them read
          as the primary one. §18's first acceptance line is "the page
          reads as a template library, not a marketing landing page."

          What replaced it is the standard product header the rest of the
          CMS already uses (see the Assets page): title, an honest library
          summary, and a clear three-level action hierarchy on the right —
          `New template` solid, `Generate with AI` outlined, `Import
          design` quiet. */}
      <div className="flex items-start justify-between gap-4 max-md:flex-col max-md:items-stretch">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-800">Templates</h1>
          <p className="mt-0.5 text-sm text-slate-500">{summaryLine}</p>
        </div>
        {/* Mobile (§12.4): `New template` stays directly visible and takes
            the full width; the two secondary creation actions share the
            row above it. Nothing is hidden behind a menu, and nothing
            shears off a 360px viewport (the 2026-05-29 P0-3 regression). */}
        <div className="flex shrink-0 items-center gap-2 max-md:grid max-md:grid-cols-2 max-md:gap-2">
          <button
            onClick={() => router.push(`/${params?.schoolId ?? ''}/templates/imports`)}
            disabled={isViewer}
            title={isViewer ? 'Read-only — viewer role' : 'Import a PDF / Canva / Slides export as a template or playlist'}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 text-[13px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9 motion-reduce:transition-none"
          >
            <Upload className="h-4 w-4" /> Import design
          </button>
          {/* Phase D3 — AI generate. 2026-06-09: if AI isn't configured we
              tell the operator to contact their admin instead of opening a
              flow that fails several steps later (§10.6). The check lives
              in openAiGenerate so the empty-state CTA shares it verbatim. */}
          <button
            onClick={() => { void openAiGenerate(); }}
            disabled={!isAdmin}
            title={!isAdmin ? 'Only an admin can generate templates with AI' : 'Describe a template, pick from 3 AI drafts'}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border bg-white px-3.5 text-[13px] font-semibold transition-colors hover:bg-indigo-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-9 motion-reduce:transition-none"
            style={{ borderColor: 'var(--brand-primary-soft, #cfc4ff)', color: 'var(--brand-primary, #4f46e5)' }}
          >
            <Sparkles className="h-4 w-4" /> Generate with AI
          </button>
          <button
            onClick={() => setShowCreate(true)}
            disabled={isViewer}
            title={isViewer ? 'Read-only — viewer role' : undefined}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-4 text-[13px] font-bold text-white shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 max-md:col-span-2 sm:min-h-9 motion-reduce:transition-none"
            style={{ backgroundColor: 'var(--brand-primary, #4f46e5)' }}
          >
            <Plus className="h-4 w-4" /> New template
          </button>
        </div>
      </div>

      {/* Phase D3 — AI Generate Modal. Operator types a prompt; we
          POST /templates/generate-touch; if it succeeds we navigate
          straight into the V2 builder so they can iterate. Failure
          surfaces inline in the modal (rate-limit, no-AI-key, AI
          returned garbage) instead of bouncing them to a toast. */}
      {showAiGenerate && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="ai-gen-title"
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end md:items-center justify-center md:p-4"
          // Guard against drag-select-from-textarea-ends-on-backdrop
          // closing the modal: only close on a click whose target IS
          // the backdrop element itself, not a bubbled selection.
          onClick={(e) => {
            if (e.target !== e.currentTarget) return;
            if (aiBusy || aiPicking !== null) return;
            closeAiModal();
          }}
        >
          <div
            className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full max-w-3xl p-5 md:p-6 space-y-4 max-h-[90vh] overflow-y-auto pb-[env(safe-area-inset-bottom)] md:pb-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="md:hidden flex justify-center -mt-2 mb-2" aria-hidden>
              <div className="w-10 h-1 rounded-full bg-slate-300" />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-md">
                  <Sparkles className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 id="ai-gen-title" className="text-lg font-bold text-slate-800">
                    {aiPhase === 'pick'
                      ? (aiSetMode ? 'Your signage set is ready' : 'Pick your favorite')
                      : 'Generate a template with AI'}
                  </h2>
                  <p className="text-xs text-slate-500">
                    {aiPhase === 'pick'
                      ? (aiSetMode
                          ? 'A cohesive multi-board loop that plays itself — open it to fine-tune any board.'
                          : 'Three takes on your idea — tap any to preview full-screen, then save the ones you like.')
                      : aiPhase === 'confirm'
                        ? 'One quick check — confirm what I heard before I design your boards.'
                        : (aiIntakeMode === 'chat'
                          ? 'Chat with the Concierge — share a website or a photo of a look you like, and it designs it with you.'
                          : 'Answer a few quick questions — Claude drafts it for you, on-brand for your venue.')}
                  </p>
                </div>
              </div>
              <button
                onClick={() => { if (!aiBusy && aiPicking === null) closeAiModal(); }}
                disabled={aiBusy || aiPicking !== null}
                className="text-slate-400 hover:text-slate-600 disabled:opacity-40"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {aiPhase === 'intake' && aiLastBatch && aiLastBatch.candidates?.length ? (
              /* Resume the last fan-out without paying for a re-generate. */
              <button
                type="button"
                onClick={resumeLastBatch}
                className="w-full flex items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 hover:bg-violet-100 text-violet-700 text-sm font-semibold px-3 py-2.5 mb-3 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Resume your last {aiLastBatch.candidates.length} generated board{aiLastBatch.candidates.length === 1 ? '' : 's'} — no re-generate
              </button>
            ) : null}

            {aiPhase === 'pick' ? (
              /* ── PHASE 2: pick 1 of 3 AI drafts ── */
              <>
                {aiError && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2.5"
                  >
                    {aiError}
                  </div>
                )}
                <div
                  className={`grid grid-cols-1 gap-3 mx-auto ${
                    aiCandidates.length >= 3
                      ? 'sm:grid-cols-3'
                      : aiCandidates.length === 2
                        ? 'sm:grid-cols-2 sm:max-w-2xl'
                        : 'sm:max-w-xs'
                  }`}
                >
                  {aiCandidates.map((c, i) => {
                    const label = aiSetMode ? 'Your set' : candidateLabel(tAi, c, i);
                    const picking = aiPicking === i;
                    const tweakOpen = aiTweakIdx === i;
                    const refining = aiRefiningIdx === i;
                    // Wave D1 (#282) — refine works for BOTH candidate shapes:
                    // engine candidates via their spec, AI-Designer boards via
                    // their baked HTML (refine-designer). Before this fix only
                    // `!!c.spec` gated Tweak, so the app's DEFAULT generation
                    // path (forceDesigner) never showed a Tweak box at all.
                    const canTweak = !!c.spec || !!c._designerHtml;
                    const saved = !!aiSavedIds[i]; // already persisted this session
                    const busy = aiPicking !== null || aiRefiningIdx !== null;
                    // Thumbnail fidelity (beta-QA #4): a multi-scene "set" must
                    // preview its FIRST board only — otherwise every scene's
                    // zones pile onto one canvas. And honor the engine board's
                    // real background (theme gradient / photo); the old
                    // hardcoded white made light-on-dark copy invisible.
                    const isSet = !!(c.scenes && c.scenes.length > 1);
                    const firstSceneName = c.scenes?.[0]?.name;
                    const thumbZones = isSet
                      ? c.zones.filter((z) => !z.sceneRef || z.sceneRef === firstSceneName)
                      : c.zones;
                    const thumbBg = c.background || {};
                    return (
                      <div
                        key={i}
                        className="rounded-xl border-2 border-slate-200 hover:border-violet-400 transition-colors overflow-hidden flex flex-col bg-white"
                      >
                        {/* The thumbnail is a button — tap/click opens this candidate
                            FULL-SCREEN (Esc / Close returns to this grid; the set is
                            never discarded). */}
                        <button
                          type="button"
                          onClick={() => { setAiError(null); setAiFullscreenIdx(i); }}
                          title="Open full-screen preview"
                          aria-label={`Open ${c.name} full-screen`}
                          className="group relative block w-full bg-slate-100 overflow-hidden cursor-zoom-in focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-1"
                          style={{ aspectRatio: '16 / 9' }}
                        >
                          {c._designerHtml ? (
                            // AI Designer board: render the authored HTML as a srcdoc
                            // preview through the W0-02 containment wrapper (model
                            // scripts stripped + CSP; the trusted VOS-STAGE-SCALE
                            // runtime fits the fixed stage to this iframe), so each
                            // option shows its REAL design (not a placeholder).
                            // pointer-events-none so the wrapping button still
                            // receives the click.
                            <iframe
                              title={c.name}
                              srcDoc={buildSafeDesignerSrcdoc(c._designerHtml)}
                              loading="lazy"
                              sandbox="allow-scripts"
                              className="absolute top-0 right-0 bottom-0 left-0 w-full h-full"
                              style={{ border: 0, pointerEvents: 'none' }}
                            />
                          ) : (
                            <ScaledTemplateThumbnail
                              zones={thumbZones as any}
                              screenWidth={1920}
                              screenHeight={1080}
                              bgColor={thumbBg.bgColor || '#ffffff'}
                              bgGradient={thumbBg.bgGradient || null}
                              bgImage={thumbBg.bgImage || null}
                              maxHeight={160}
                              freeze
                            />
                          )}
                          <span className="absolute top-1.5 left-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-600 text-white shadow">
                            {label}
                          </span>
                          {saved && (
                            <span className="absolute top-1.5 right-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white shadow flex items-center gap-0.5">
                              <Check className="w-3 h-3" /> Saved
                            </span>
                          )}
                          {/* Expand affordance — visible on hover (desktop) and always
                              tappable; the whole tile is the hit target on mobile. */}
                          <span className="absolute bottom-1.5 right-1.5 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-slate-900/70 text-white shadow opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            <Expand className="w-3 h-3" /> Full-screen
                          </span>
                          {refining && (
                            <div className="absolute top-0 right-0 bottom-0 left-0 bg-white/70 backdrop-blur-sm flex flex-col items-center justify-center gap-1.5">
                              <Loader2 className="w-5 h-5 animate-spin text-violet-600" />
                              <span className="text-[10px] font-bold text-violet-700">Applying your change…</span>
                            </div>
                          )}
                        </button>
                        <div className="p-2.5 flex flex-col gap-2 grow">
                          <div>
                            <p className="text-xs font-bold text-slate-800 truncate" title={c.name}>{c.name}</p>
                            <p className="text-[10px] text-slate-400">
                              {c.zones.length} element{c.zones.length === 1 ? '' : 's'}
                              {c.scenes && c.scenes.length > 1 ? ` · ${c.scenes.length} scenes` : ''}
                            </p>
                          </div>
                          {/* Wave 3 — chat-to-edit: tweak this board in plain English */}
                          {canTweak && tweakOpen && (
                            <div className="flex flex-col gap-1.5">
                              <input
                                autoFocus
                                value={aiTweakText}
                                onChange={(e) => setAiTweakText(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && aiTweakText.trim()) refineCandidate(i, aiTweakText); }}
                                placeholder='e.g. "darker theme", "punchier headline", "add a stat"'
                                disabled={refining}
                                className="w-full px-2.5 py-1.5 text-[11px] rounded-lg bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-60"
                              />
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => refineCandidate(i, aiTweakText)}
                                  disabled={refining || !aiTweakText.trim()}
                                  className="flex-1 px-2 py-1.5 text-[11px] font-bold rounded-lg bg-violet-600 text-white disabled:opacity-50 flex items-center justify-center gap-1"
                                >
                                  {refining ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                                  Apply
                                </button>
                                <button
                                  onClick={() => { setAiTweakIdx(null); setAiTweakText(''); }}
                                  disabled={refining}
                                  className="px-2 py-1.5 text-[11px] font-bold rounded-lg bg-white border border-slate-200 text-slate-600 disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              </div>
                              {/* Wave 3b — one-tap auto-translate (reuses the refine pipeline) */}
                              <div className="flex flex-wrap items-center gap-1 pt-0.5">
                                <span className="text-[10px] text-slate-400 mr-0.5">🌐 Translate:</span>
                                {['Spanish', 'French', 'Chinese', 'Vietnamese', 'Korean', 'Arabic'].map((lang) => (
                                  <button
                                    key={lang}
                                    onClick={() => refineCandidate(i, `Translate ALL visible copy to ${lang}. Keep the layout, theme, structure, and any prices/times/numbers identical.`)}
                                    disabled={refining}
                                    className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 hover:bg-violet-100 hover:text-violet-700 disabled:opacity-50"
                                  >
                                    {lang}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Actions — non-destructive. Saving a board does NOT close
                              the modal or discard the other two, so the operator can
                              save any/all of the 3. Saved boards land in the gallery
                              (the durable history). "Open in editor" saves + navigates. */}
                          <div className="mt-auto flex flex-col gap-1.5">
                            {canTweak && !tweakOpen && (
                              <button
                                onClick={() => { setAiTweakIdx(i); setAiTweakText(''); setAiError(null); }}
                                disabled={busy}
                                title="Refine this board by describing a change"
                                className="w-full px-2.5 py-2 text-xs font-bold rounded-lg bg-white border border-violet-200 text-violet-700 hover:bg-violet-50 disabled:opacity-50 flex items-center justify-center gap-1"
                              >
                                <Sparkles className="w-3.5 h-3.5" /> Tweak
                              </button>
                            )}
                            <div className="flex gap-1.5">
                              <button
                                onClick={() => { void saveCandidate(i); }}
                                disabled={busy || saved}
                                title={saved ? 'Already saved to your templates' : 'Save this board to your templates (keeps the other options open)'}
                                className={`flex-1 px-3 py-2 text-xs font-bold rounded-lg shadow-sm disabled:cursor-not-allowed flex items-center justify-center gap-1.5 ${
                                  saved
                                    ? 'bg-emerald-50 border border-emerald-200 text-emerald-700 disabled:opacity-100'
                                    : 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white disabled:opacity-50'
                                }`}
                              >
                                {picking ? (
                                  <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
                                ) : saved ? (
                                  <><Check className="w-3.5 h-3.5" /> Saved</>
                                ) : (
                                  'Save'
                                )}
                              </button>
                              <button
                                onClick={() => { void openCandidateInEditor(i); }}
                                disabled={busy}
                                title="Save this board and open the layout editor (desktop)"
                                className="px-2.5 py-2 text-xs font-bold rounded-lg bg-white border border-violet-200 text-violet-700 hover:bg-violet-50 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                              >
                                <Pencil className="w-3.5 h-3.5" /> Edit
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <button
                    onClick={() => { setAiPhase('intake'); setAiError(null); }}
                    disabled={aiPicking !== null}
                    className="px-4 py-2 text-sm font-bold rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    ← Back
                  </button>
                  <button
                    onClick={regenerateBatch}
                    disabled={aiBusy || aiPicking !== null}
                    className="px-4 py-2 text-sm font-bold rounded-xl bg-white border border-violet-200 text-violet-700 hover:bg-violet-50 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {aiBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                    {aiBusy ? 'Generating…' : 'Regenerate'}
                  </button>
                </div>
              </>
            ) : aiPhase === 'confirm' ? (
              /* ── PHASE 1.5: brief-echo confirm (designer path only) ──
                 A 2-second glance-confirm of the AI's structured reading of
                 the prompt BEFORE the expensive 3× fan-out. Never a gate:
                 fail-open paths in startGenerateWithConfirm auto-generate on
                 extraction failure / no-signal, and Skip is always available. */
              <div className="flex flex-col gap-3">
                {aiError && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2.5"
                  >
                    {aiError}
                  </div>
                )}
                <BriefConfirmStrip
                  loading={aiBriefLoading}
                  brief={aiBrief}
                  onChange={setAiBrief}
                  onConfirm={confirmBriefAndGenerate}
                  onSkip={skipBriefAndGenerate}
                  generating={aiBusy}
                />
                {/* The fail-open auto-generate renders no strip (no signal) —
                    show honest progress instead of an empty modal. */}
                {!aiBriefLoading && !designerBriefHasSignal(aiBrief) && aiBusy && (
                  <div className="flex items-center justify-center gap-2 text-sm font-semibold text-slate-500 py-6">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Designing your boards…
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    aiPendingGenerateArgsRef.current = null;
                    setAiBrief(null);
                    setAiBriefLoading(false);
                    setAiError(null);
                    setAiPhase('intake');
                  }}
                  disabled={aiBusy}
                  className="self-start px-4 py-2 text-sm font-bold rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  ← Back
                </button>
              </div>
            ) : null}

            {/* ── PHASE 1: intake — ALWAYS MOUNTED, hidden while the picker or the
                confirm step is up (2026-09-22, Greg: "if i hit the back button from
                there it takes me to an empty prompt again and loses everything i
                gave it"). The Concierge keeps its transcript, references, intake
                and brief in its own state; unmounting it on every phase change
                threw all of that away, so Back from the three boards started the
                conversation over. `contents` adds no box when visible; `hidden`
                keeps the component (and its state) alive while out of sight. A
                fresh open of the dialog still starts clean — the whole modal
                unmounts on close. */}
            <div className={aiPhase === 'intake' ? 'contents' : 'hidden'} aria-hidden={aiPhase !== 'intake'}>
              {              /* ── PHASE 1: guided intake wizard + advanced view ──
                 The wizard/advanced view collect the prompt + optional
                 directives (purpose/theme/palette/background/widgets). They
                 reuse the EXISTING Touch/Display/Set toggle + canvas picker
                 (built here as nodes and passed in) so we don't rebuild them. */
              (() => {
                // Touch vs Display vs Build-a-set — same generator serves all.
                // 2026-09-22 — the Type row used to show four choices in BOTH intake
                // modes. In the CHAT (Concierge) two of them were noise: the Concierge
                // always generates with the designer engine (`forceDesigner`), so
                // "Designer (HTML)" was redundant there, and "Build a set" is only
                // honoured by the widget-zone generator the chat never calls — picking
                // it did nothing. Greg: "what is build a set or design html used for?
                // why would someone pick those?" The chat now shows Display and Touch
                // only; the guided form keeps all four because there they are real.
                const seg = (active: boolean) =>
                  `px-3 py-1.5 text-xs font-bold rounded-lg transition-colors disabled:opacity-50 ${active ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`;
                const showEngineToggles = aiIntakeMode !== 'chat';
                const typeToggle = (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-500">Type:</span>
                    <div className="inline-flex rounded-xl bg-slate-100 p-1 flex-wrap" role="group" aria-label="Board type">
                      <button
                        type="button"
                        onClick={() => { setAiInteractive(false); setAiSetMode(false); setAiDesignerMode(false); }}
                        disabled={aiBusy}
                        aria-pressed={!aiInteractive && !aiSetMode && !aiDesignerMode}
                        title="A board people look at — menus, welcome walls, promos"
                        className={seg(!aiInteractive && !aiSetMode && !aiDesignerMode)}
                      >
                        Display (no touch)
                      </button>
                      <button
                        type="button"
                        onClick={() => { setAiInteractive(true); setAiSetMode(false); setAiDesignerMode(false); }}
                        disabled={aiBusy}
                        aria-pressed={aiInteractive && !aiSetMode && !aiDesignerMode}
                        title="A kiosk people tap — wayfinding, check-in, browsable menus"
                        className={seg(aiInteractive && !aiSetMode && !aiDesignerMode)}
                      >
                        Touch (interactive)
                      </button>
                      {showEngineToggles && (
                        <>
                          <button
                            type="button"
                            onClick={() => { setAiSetMode(true); setAiInteractive(false); setAiDesignerMode(false); }}
                            disabled={aiBusy}
                            aria-pressed={aiSetMode && !aiDesignerMode}
                            title="One idea (or one per line) → a whole set of boards that plays as a loop"
                            className={seg(aiSetMode && !aiDesignerMode)}
                          >
                            ✨ Build a set
                          </button>
                          <button
                            type="button"
                            onClick={() => { setAiDesignerMode(true); setAiInteractive(false); setAiSetMode(false); }}
                            disabled={aiBusy}
                            aria-pressed={aiDesignerMode}
                            title="The designer engine authors the whole board as HTML (what the Concierge chat always uses) — pick from 3 distinct options"
                            className={seg(aiDesignerMode)}
                          >
                            ✨ Designer (HTML)
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );

                // CC-1 — canvas size. The chosen size flows into BOTH generate
                // and create-from-candidate so the board is laid out for the
                // real screen aspect (was hardcoded 1920×1080 → clipped on a
                // 960×1080 portrait LED).
                //
                // 2026-09-22 — three choices, not a menu: 4K UHD Landscape,
                // 4K UHD Portrait, or Custom (two typed numbers). The old
                // "Match a screen…" dropdown listed every screen by name and
                // size and read as noise ("why a drop down with LED poster?").
                const isLandscape4k = aiCanvas.w === AI_CANVAS_4K_LANDSCAPE.w && aiCanvas.h === AI_CANVAS_4K_LANDSCAPE.h;
                const isPortrait4k = aiCanvas.w === AI_CANVAS_4K_PORTRAIT.w && aiCanvas.h === AI_CANVAS_4K_PORTRAIT.h;
                const customActive = aiCustomSize || (!isLandscape4k && !isPortrait4k);
                const pickStandard = (c: { w: number; h: number }) => {
                  setAiCanvas({ w: c.w, h: c.h });
                  setAiCustomSize(false);
                };
                const openCustom = () => {
                  setAiCustomText({ w: String(aiCanvas.w), h: String(aiCanvas.h) });
                  setAiCustomSize(true);
                };
                const commitCustom = (axis: 'w' | 'h', raw: string) => {
                  setAiCustomText((t) => ({ ...t, [axis]: raw }));
                  const n = Math.round(Number(raw));
                  if (!Number.isFinite(n) || n < AI_CANVAS_MIN_PX || n > AI_CANVAS_MAX_PX) return; // keep typing
                  setAiCanvas((c) => ({ ...c, [axis]: n }));
                };
                const segBtn = (active: boolean) =>
                  `px-3 py-1.5 text-xs font-bold rounded-lg transition-colors disabled:opacity-50 ${
                    active ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`;
                const screenPicker = (
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="inline-flex rounded-xl bg-slate-100 p-1" role="group" aria-label="Board size">
                      <button
                        type="button"
                        onClick={() => pickStandard(AI_CANVAS_4K_LANDSCAPE)}
                        disabled={aiBusy}
                        aria-pressed={!customActive && isLandscape4k}
                        title={`4K UHD · ${AI_CANVAS_4K_LANDSCAPE.w}×${AI_CANVAS_4K_LANDSCAPE.h}`}
                        className={segBtn(!customActive && isLandscape4k)}
                      >
                        Landscape
                      </button>
                      <button
                        type="button"
                        onClick={() => pickStandard(AI_CANVAS_4K_PORTRAIT)}
                        disabled={aiBusy}
                        aria-pressed={!customActive && isPortrait4k}
                        title={`4K UHD · ${AI_CANVAS_4K_PORTRAIT.w}×${AI_CANVAS_4K_PORTRAIT.h}`}
                        className={segBtn(!customActive && isPortrait4k)}
                      >
                        Portrait
                      </button>
                      <button
                        type="button"
                        onClick={openCustom}
                        disabled={aiBusy}
                        aria-pressed={customActive}
                        title="Type the exact size of your screen"
                        className={segBtn(customActive)}
                      >
                        Custom
                      </button>
                    </div>
                    {customActive ? (
                      <span className="inline-flex items-center gap-1.5">
                        <label htmlFor="ai-canvas-w" className="sr-only">Width in pixels</label>
                        <input
                          id="ai-canvas-w"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={aiCustomText.w}
                          onChange={(e) => commitCustom('w', e.target.value)}
                          onBlur={() => setAiCustomText((t) => ({ ...t, w: String(aiCanvas.w) }))}
                          disabled={aiBusy}
                          className="w-[68px] px-2 py-1.5 text-xs font-semibold tabular-nums rounded-lg bg-slate-50 border border-slate-200 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-50"
                        />
                        <span className="text-xs text-slate-400" aria-hidden>×</span>
                        <label htmlFor="ai-canvas-h" className="sr-only">Height in pixels</label>
                        <input
                          id="ai-canvas-h"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={aiCustomText.h}
                          onChange={(e) => commitCustom('h', e.target.value)}
                          onBlur={() => setAiCustomText((t) => ({ ...t, h: String(aiCanvas.h) }))}
                          disabled={aiBusy}
                          className="w-[68px] px-2 py-1.5 text-xs font-semibold tabular-nums rounded-lg bg-slate-50 border border-slate-200 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-50"
                        />
                        <span className="text-[11px] text-slate-400">px</span>
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400 tabular-nums">4K UHD · {aiCanvas.w}×{aiCanvas.h}</span>
                    )}
                  </div>
                );

                const exampleChips = (() => {
                  const prompts = getAiTemplatePrompts(tenantCopy.vertical);
                  return aiInteractive ? prompts.kiosk : prompts.signage;
                })();

                // DEFAULT = conversational Signage Concierge; the guided form
                // is one click away. Both reuse the SAME type-toggle + screen
                // picker nodes and both hand off to the existing generator.
                if (aiIntakeMode === 'chat') {
                  return (
                    <div className="flex flex-col gap-3">
                      <SignageConcierge
                        vertical={(tenantCopy.vertical || 'venue').toLowerCase()}
                        canvas={aiCanvas}
                        interactive={aiInteractive}
                        generating={aiBusy}
                        generateError={aiError}
                        screenPicker={screenPicker}
                        typeToggle={typeToggle}
                        onGenerate={runGenerateFromConcierge}
                        posEnabled
                      />
                      <button
                        type="button"
                        onClick={() => { setAiIntakeMode('wizard'); setAiError(null); }}
                        disabled={aiBusy}
                        className="self-center text-xs font-semibold text-slate-400 hover:text-violet-600 underline-offset-2 hover:underline disabled:opacity-50"
                      >
                        Use the guided form instead
                      </button>
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col gap-3">
                    <AiIntakeWizard
                      answers={aiIntake}
                      onChange={setAiIntake}
                      promptText={aiPrompt}
                      onPromptChange={(v) => {
                        setAiPrompt(v);
                        // Clear a stale error the moment they start a new prompt.
                        if (aiError) setAiError(null);
                      }}
                      exampleChips={exampleChips}
                      screenPicker={screenPicker}
                      typeToggle={typeToggle}
                      onGenerate={runGenerateFromWizard}
                      onCancel={closeAiModal}
                      isPending={aiBusy}
                      error={aiError}
                      setMode={aiSetMode}
                    />
                    <button
                      type="button"
                      onClick={() => { setAiIntakeMode('chat'); setAiError(null); }}
                      disabled={aiBusy}
                      className="self-center text-xs font-semibold text-slate-400 hover:text-violet-600 underline-offset-2 hover:underline disabled:opacity-50"
                    >
                      ← Back to chat with the Concierge
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Full-screen candidate preview — opened from any candidate card's
          thumbnail. Sits ABOVE the AI modal (z-110) and renders the candidate
          in-place (NOT a saved template). Esc / Close / backdrop returns to the
          grid; the set is never discarded. Prev/next flips between the 3. */}
      {showAiGenerate && aiPhase === 'pick' && aiFullscreenIdx !== null && aiCandidates[aiFullscreenIdx] && (
        <CandidateFullscreenPreview
          candidate={aiCandidates[aiFullscreenIdx]}
          index={aiFullscreenIdx}
          total={aiCandidates.length}
          canvas={aiCanvas}
          saved={!!aiSavedIds[aiFullscreenIdx]}
          saving={aiPicking === aiFullscreenIdx}
          onPrev={() => setAiFullscreenIdx((cur) => {
            if (cur === null) return cur;
            return (cur - 1 + aiCandidates.length) % aiCandidates.length;
          })}
          onNext={() => setAiFullscreenIdx((cur) => {
            if (cur === null) return cur;
            return (cur + 1) % aiCandidates.length;
          })}
          onClose={() => setAiFullscreenIdx(null)}
          onSave={() => { void saveCandidate(aiFullscreenIdx); }}
          /* Wave D1 (#282) — the SAME Tweak + Translate loop the grid cards
             offer, reachable without leaving full-screen. canTweak mirrors
             the grid's gate (engine spec OR AI-Designer html). */
          canTweak={!!aiCandidates[aiFullscreenIdx].spec || !!aiCandidates[aiFullscreenIdx]._designerHtml}
          tweakOpen={aiTweakIdx === aiFullscreenIdx}
          tweakText={aiTweakText}
          onTweakTextChange={setAiTweakText}
          refining={aiRefiningIdx === aiFullscreenIdx}
          onOpenTweak={() => { setAiTweakIdx(aiFullscreenIdx); setAiTweakText(''); setAiError(null); }}
          onCancelTweak={() => { setAiTweakIdx(null); setAiTweakText(''); }}
          onApplyTweak={(text) => { void refineCandidate(aiFullscreenIdx, text); }}
        />
      )}

      {/* ── "New template" — Phase 1 of the template-builder program ────
          Was: a 4-field metadata modal whose primary button dropped the
          operator onto a white canvas holding one unexplained rectangle,
          with ~600 widget tiles behind ~28 filter chips as the only next
          move. That door produced the demo the operator called the worst
          he has ever given.

          Now: ONE question (name + shape, with exact size / category /
          description demoted behind "Advanced"), then a gallery of REAL
          rendered presets filtered to that shape and this tenant's
          vertical. Blank and AI are subordinate doors, not the default.

          `verticalKnown` — never `vertical` alone — decides whether we
          order by industry affinity. normalizeVertical() answers K12 for
          a MISSING value, and a corporate operator being shown a school
          catalogue is exactly the bug that predicate was added for. */}
      {showCreate && (
        <CreateTemplateFlow
          templates={(templates || []) as any}
          loadingTemplates={isLoading}
          verticalKnown={tenantCopy.verticalKnown}
          categories={tenantCopy.templateCategories}
          categoryLabel={categoryChipLabel}
          resolutionPresets={RESOLUTION_PRESETS}
          canUseAi={isAdmin}
          busy={createTemplate.isPending || createFromPreset.isPending}
          onClose={() => setShowCreate(false)}
          onStartBlank={(draft) => { void handleStartBlank(draft); }}
          onPickPreset={(preset, draft) => { void handlePickPreset(preset as Template, draft); }}
          onDescribeInstead={(draft) => { void handleDescribeInstead(draft); }}
        />
      )}

      {/* 2026-05-13 — "Adapt for LED" modal. Three high-level
          orientation buttons (Portrait / Landscape / Custom) match
          the operator's mental model directly. Custom expands to a
          W×H input + 1-6 panel LED shortcuts. On save we duplicate the
          source template at the new canvas dimensions and open the
          builder. Zones inherit their %-positions automatically;
          widgets self-scale to fit. */}
      {adaptTemplate && (
        <AdaptForLedModal
          source={adaptTemplate}
          portraitSibling={portraitSiblingFor(adaptTemplate)}
          onClose={() => setAdaptTemplate(null)}
          onAdapt={async ({ screenWidth, screenHeight, orientation }) => {
            // 2026-05-14 — auto-route to the portrait sibling whenever
            // the target canvas is portrait-shaped (height > width)
            // AND a portrait sibling exists. Removed the "closer
            // aspect" tie-breaker that could fall through to the
            // landscape source on extreme aspects (e.g. 320×1080,
            // operator report: "i updated the canvas but just layed
            // it out landscape anyway"). Simpler rule = predictable
            // result: portrait LED → portrait base.
            const sibling = portraitSiblingFor(adaptTemplate);
            const targetIsPortrait = screenHeight > screenWidth;
            const targetIsLandscape = screenWidth > screenHeight;
            const sourceIsPortrait = (adaptTemplate.screenHeight || 0) > (adaptTemplate.screenWidth || 0);
            let bestSource = adaptTemplate;
            if (sibling && targetIsPortrait && !sourceIsPortrait) {
              // Operator clicked Custom on the LANDSCAPE card but
              // picked a portrait canvas → switch to portrait base.
              bestSource = sibling;
            } else if (sibling && targetIsLandscape && sourceIsPortrait) {
              // Inverse: clicked on the portrait card but picked
              // landscape → keep using source (sibling here is also
              // undefined per portraitSiblingFor's `-portrait` guard
              // — but defensive in case the convention changes).
              bestSource = adaptTemplate;
            }
            const result = await duplicateTemplate.mutateAsync({
              id: bestSource.id,
              screenWidth,
              screenHeight,
              orientation,
            });
            setAdaptTemplate(null);
            openInBuilder(result);
          }}
          pending={duplicateTemplate.isPending}
        />
      )}

      {/* ── Search + filter toolbar (Calm v1 §5.3) ─────────────────────
          Desktop order: search · category chips with counts · spacer ·
          sort · grid/list. The row keeps its position when a filter turns
          on (§5.3: "do not make the toolbar jump"), and the chips scroll
          horizontally rather than wrapping into three dense rows.

          Two-tier filtering is preserved exactly as it was restored on
          2026-05-16 (commit 8872643 had wrongly dropped it): search +
          category, plus the K-12-only grade-level row and the holiday
          sub-filter — both distinct DIMENSIONS, which is why §5.3 gives
          them their own secondary row rather than crowding tier one. */}
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search templates..."
              aria-label="Search templates"
              className="min-h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-200 sm:min-h-9"
            />
          </div>

          {/* Category chips. Vertical-aware: K-12 gets Welcome / Hallway /
              Cafeteria / Athletics / Holidays; every other vertical gets
              its own set from tenantCopy.templateCategories.
              DATA-DRIVEN (2026-08-24): VERTICAL_TEMPLATE_CATEGORIES is a
              static per-vertical taxonomy that doesn't always match what's
              actually seeded — HEALTHCARE declares "Waiting room" /
              "Directory" / "Patient info" chips while every seeded
              healthcare preset carries the single literal
              category='HEALTHCARE', so those three could never return a
              result. A tenant clicking their own category chip landed on a
              gallery that LOOKED broken. Only render a chip when ≥1
              template in this tenant's actual catalog matches it (§5.3:
              "Do not render empty categories") — this kills every dead
              chip today and self-heals as the catalog changes, with no
              hand-maintained allowlist. Counts come from the FULL catalog
              (not re-derived per active level/search) so the row stays
              stable as other filters change; a combination that is
              legitimately empty still gets the honest empty state below
              instead of a disappearing chip. */}
          {(() => {
            const catsRaw = (tenantCopy.templateCategories && tenantCopy.templateCategories.length > 0)
              ? tenantCopy.templateCategories
              : CATEGORY_TABS;
            const countForCategoryKey = (key: string): number => {
              let n = 0;
              for (const t of (templates || [])) {
                if (LETTERBOXED_PORTRAIT_PRESETS.has(t.id)) continue;
                if (t.id.endsWith('-portrait')) continue; // portrait siblings never render as their own card
                if (key === 'ATHLETICS' ? isAthleticsPreset(t) : t.category === key) n++;
              }
              return n;
            };
            const cats = catsRaw
              .map((cat) => ({ ...cat, count: cat.key ? countForCategoryKey(cat.key) : totalCount }))
              .filter((cat) => !cat.key || cat.count > 0);
            return (
              <div
                // A scroll container only where chips can actually run out of
                // room (phones). On desktop the strip is a plain flex row that
                // wraps in the rare case it must: a scrolling box that stretches
                // across the toolbar's spare width rendered as a pale "block"
                // beside the sort control in Greg's Chrome (2026-09-14) — a
                // composited scroller over the page gradient, nothing in the
                // DOM paints there — and it has no job to do up here anyway.
                className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible"
                role="group"
                aria-label="Filter by category"
              >
                {cats.map((cat) => {
                  const active = activeCategory === cat.key;
                  return (
                    <button
                      key={cat.key || 'all'}
                      type="button"
                      onClick={() => {
                        setActiveCategory(cat.key);
                        // leaving the Holidays category clears its sub-filter
                        if (cat.key !== 'HOLIDAYS') setActiveHoliday('');
                        // A new filter is a new result set — start it at the
                        // top of the page rather than deep in a paged catalog.
                        setPresetPages(1);
                      }}
                      aria-pressed={active}
                      className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-500 sm:min-h-9 motion-reduce:transition-none ${
                        active
                          ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {cat.label}
                      {/* §14 — 4.5:1 minimum for normal text. slate-400
                          (#94a3b8) is 2.6:1 on white and fails; these
                          counts are real information, not decoration. */}
                      <span className={`tabular-nums text-[11px] font-bold ${active ? 'text-indigo-600' : 'text-slate-500'}`}>
                        {cat.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })()}

          <div className="flex shrink-0 items-center gap-2">
            {/* §9.1 — sort applies to YOUR templates; the ready-made
                catalog keeps its curated order (that order is the
                recommendation, and search relevance takes over while
                searching). A native <select> is deliberate: it is
                keyboard- and screen-reader-correct for free, and it is
                the control an operator on a phone already knows. */}
            <label className="sr-only" htmlFor="tpl-sort">Sort your templates</label>
            <select
              id="tpl-sort"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as TemplateSortMode)}
              className="min-h-11 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] font-semibold text-slate-600 focus:border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-200 sm:min-h-9"
            >
              {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <div className="flex items-center rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="View">
              {([
                { key: 'grid', label: 'Grid view', Icon: Grid3X3 },
                { key: 'list', label: 'List view', Icon: AlignLeft },
              ] as const).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setViewMode(key)}
                  aria-pressed={viewMode === key}
                  aria-label={label}
                  title={label}
                  className={`inline-flex h-10 w-10 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:h-8 sm:w-8 motion-reduce:transition-none ${
                    viewMode === key ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* School-level filter — Elementary / Middle / High. A distinct
            dimension from category, so §5.3 gives it its own row. Only
            meaningful for K-12 tenants; hidden for every other vertical. */}
        {(!tenantCopy.vertical || tenantCopy.vertical === 'K12') && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by school level">
            {SCHOOL_LEVEL_CHIPS.map((chip) => {
              const active = activeLevel === chip.key;
              return (
                <button
                  key={chip.key || 'all'}
                  type="button"
                  onClick={() => setActiveLevel(chip.key)}
                  aria-pressed={active}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-500 sm:min-h-8 motion-reduce:transition-none ${
                    active
                      ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                  }`}
                >
                  <span aria-hidden>{chip.emoji}</span>
                  {chip.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Holiday sub-filter — only when the Holidays category is active,
            matching the original two-tier behavior (§3). */}
        {activeCategory === 'HOLIDAYS' && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by holiday">
            {HOLIDAY_SUB_FILTERS.map((h) => {
              const active = activeHoliday === h.key;
              return (
                <button
                  key={h.key || 'all'}
                  type="button"
                  onClick={() => setActiveHoliday(h.key)}
                  aria-pressed={active}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-500 sm:min-h-8 motion-reduce:transition-none ${
                    active
                      ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                  }`}
                >
                  <span aria-hidden>{h.emoji}</span>
                  {h.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Gallery body ───────────────────────────────────────────────
          Four states, in the order the operator can actually hit them:
          loading (§10.1) · API failure (§10.4) · no filter results
          (§10.3) · the library. */}
      {isLoading ? (
        // §10.1 — card skeletons matching the final grid, so the header
        // and toolbar stay put and nothing jumps when the data lands. A
        // single centered spinner for the whole page is what §10.1
        // explicitly rules out.
        <div aria-busy="true" aria-live="polite" className="space-y-3">
          <span className="sr-only">Loading templates…</span>
          <div className="h-4 w-32 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
          <div className={GALLERY_GRID_CLASS}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="h-[168px] animate-pulse bg-slate-100 motion-reduce:animate-none" />
                <div className="space-y-2 p-3.5">
                  <div className="h-3.5 w-2/3 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-slate-100 motion-reduce:animate-none" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : isError ? (
        // §10.4 — "Do not present API failure as an empty library." The
        // difference matters: an empty library says "you have nothing",
        // which for an operator whose work IS the library is alarming and
        // false. This says the request failed and their work is safe.
        <div role="alert" className="rounded-xl border border-slate-200 bg-white p-10 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50">
            <Cloud className="h-5 w-5 text-rose-500" aria-hidden />
          </div>
          <p className="text-sm font-bold text-slate-700">Templates couldn’t be loaded</p>
          <p className="mt-1 text-xs text-slate-500">Your templates are still safe. Check your connection and try again.</p>
          <button
            type="button"
            onClick={() => { void refetchTemplates(); }}
            className="mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-bold text-white"
            style={{ backgroundColor: 'var(--brand-primary, #4f46e5)' }}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      ) : (systemTemplates.length === 0 && customTemplates.length === 0 && anyFilterActive) ? (
        // §10.3 — never let a filter (or a filter COMBINATION) render a
        // blank page. The Athletics tab used to do exactly that (2026-06-26
        // fix); 2026-08-24 extended the guard to a school-LEVEL-only dead
        // end, which used to silently vanish the whole ready-made section
        // while "Your templates" showed a misleading "none yet".
        // §10.3 also requires the recovery action to clear EVERY active
        // filter — including level and holiday, which the old "Show all
        // templates" button left stuck on.
        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100">
            <LayoutTemplate className="h-5 w-5 text-slate-300" aria-hidden />
          </div>
          {(() => {
            const searchTrim = searchQuery.trim();
            const filterBits = [
              activeLevel ? levelLabel(activeLevel) : null,
              activeCategory ? categoryLabel(activeCategory) : null,
            ].filter((s): s is string => !!s);
            return (
              <>
                <p className="text-sm font-bold text-slate-700">
                  {searchTrim
                    ? `No templates match “${searchTrim}”`
                    : `No ${filterBits.join(' ').toLowerCase() || 'matching'} templates yet`}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {searchTrim && filterBits.length > 0
                    ? `Filtered to ${filterBits.join(' · ')}. Clear your filters, try another search, or generate a new design.`
                    : 'Clear your filters, try another search, or generate a new design.'}
                </p>
              </>
            );
          })()}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={clearAllFilters}
              className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 bg-white px-3.5 text-[13px] font-semibold text-slate-600 hover:border-slate-300"
            >
              Clear search &amp; filters
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => { void openAiGenerate(); }}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3.5 text-[13px] font-bold text-white"
                style={{ backgroundColor: 'var(--brand-primary, #4f46e5)' }}
              >
                <Sparkles className="h-3.5 w-3.5" /> Generate with AI
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* ── Your templates (§5.4) ──────────────────────────────────
              First, because an operator returns to maintain existing work
              far more often than they start from scratch (§5.5). */}
          {/* Under a search or category filter with no own match the whole
              section goes — a "Your templates" heading over an onboarding
              row is what Greg saw on the Touch Kiosks filter (2026-09-14). */}
          {!(anyFilterActive && customTemplates.length === 0) && (
          <section aria-labelledby="your-templates-heading">
            <div className="mb-3 flex items-end justify-between gap-3">
              <h2 id="your-templates-heading" className="flex items-center gap-2 text-[17px] font-bold text-slate-800">
                Your templates
                {customTemplates.length > 0 && (
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-bold text-slate-500 tabular-nums">
                    {customTemplates.length}
                  </span>
                )}
              </h2>
              {hiddenCustom > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllCustom(true)}
                  className="inline-flex items-center gap-1 text-[13px] font-semibold text-indigo-600 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-500 rounded"
                >
                  View all <ChevronRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {customTemplates.length === 0 ? (
              // §10.2 — one line, no buttons. The header already carries
              // Generate with AI and New template, and the ready-made catalog
              // is right below; a second row of the same buttons here is what
              // Greg saw under a category filter (2026-09-14: "it shows
              // another row of new template and generate for no reason —
              // remove all that"). With a filter active and nothing of their
              // own matching, the section is skipped entirely (guard above).
              <p className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-4 text-sm" data-testid="own-templates-empty">
                <span className="font-bold text-slate-700">No templates of your own yet</span>
                <span className="text-slate-500"> — pick a ready-made design below, generate one with AI, or start a new template.</span>
              </p>
            ) : viewMode === 'list' ? (
              // §9.3 — list view is for management at scale. It renders the
              // same static poster/frozen thumbnail as the grid and never
              // an active widget tree.
              <TemplateListView
                templates={visibleCustom}
                categoryLabelFor={categoryChipLabel}
                usageFor={(t) => deriveTemplateUsage(usageByTemplate, t.id)}
                onPreview={(t) => setPreviewTemplate(t)}
                onPrimary={isViewer ? undefined : (t) => openTemplate(t)}
                primaryLabel={isViewer ? 'Preview' : 'Edit'}
              />
            ) : (
              <div className={GALLERY_GRID_CLASS}>
                {visibleCustom.map((t: Template) => (
                  <GalleryCard
                    key={t.id}
                    template={t}
                    portraitSibling={portraitSiblingFor(t)}
                    onEdit={() => openTemplate(t)}
                    onPutOnScreen={() => putOnScreen(t)}
                    putOnScreenBusy={puttingOnScreenId === t.id}
                    onDuplicate={() => handleDuplicate(t)}
                    onExport={() => handleExport(t)}
                    onAdaptForLED={() => setAdaptTemplate(t)}
                    // `DELETE /templates/:id` is admin-only, so a CONTRIBUTOR
                    // gets no Delete row at all — the same "absent, not
                    // disabled" shape a RESTRICTED_VIEWER already sees.
                    onDelete={isAdmin ? () => { void handleDeleteTemplate(t); } : undefined}
                    onPreview={(active) => setPreviewTemplate(active)}
                    onUseForGame={() => router.push(`/${params?.schoolId ?? ''}/sports?templateId=${encodeURIComponent(t.id)}&surface=${sportsSurfaceForCategory(t.category)}&newGame=1`)}
                    isViewerDisabled={isViewer}
                    {...ownedCardProps(t)}
                  />
                ))}
              </div>
            )}
            {hiddenCustom > 0 && (
              <div className="mt-3 flex justify-center">
                <button
                  type="button"
                  onClick={() => setShowAllCustom(true)}
                  className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-600 hover:border-slate-300"
                >
                  Show {hiddenCustom} more
                </button>
              </div>
            )}
          </section>
          )}

          {/* ── Ready-made templates (§5.5) ────────────────────────────── */}
          {systemTemplates.length > 0 && (
            <section aria-labelledby="ready-made-heading" ref={readyMadeRef}>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="ready-made-heading" className="text-[17px] font-bold text-slate-800">Ready-made templates</h2>
                  <p className="mt-0.5 text-xs text-slate-500">Start with a professionally designed layout</p>
                </div>
                {hiddenPresets > 0 && (
                  <button
                    type="button"
                    onClick={() => setPresetPages(Math.ceil(systemTemplates.length / SECTION_PAGE_SIZE))}
                    className="inline-flex shrink-0 items-center gap-1 rounded text-[13px] font-semibold text-indigo-600 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-indigo-500"
                  >
                    Browse all {systemTemplates.length} <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {viewMode === 'list' ? (
                <TemplateListView
                  templates={visiblePresets}
                  categoryLabelFor={categoryChipLabel}
                  onPreview={(t) => setPreviewTemplate(t)}
                  onPrimary={(t) => setPreviewTemplate(t)}
                  primaryLabel="Preview"
                />
              ) : (
                <div className={GALLERY_GRID_CLASS}>
                  {visiblePresets.map((t: Template) => (
                    // Preset cards open the fullscreen Preview. Only an
                    // explicit "Use this template" click inside the preview
                    // creates a custom DB row — browsing never pollutes the
                    // tenant's template list (§3, §7.2).
                    <GalleryCard
                      key={t.id}
                      template={t}
                      portraitSibling={portraitSiblingFor(t)}
                      onPreview={(active) => setPreviewTemplate(active)}
                      onAdaptForLED={isViewer ? undefined : () => setAdaptTemplate(t)}
                      onUseForGame={() => router.push(`/${params?.schoolId ?? ''}/sports?templateId=${encodeURIComponent(t.id)}&surface=${sportsSurfaceForCategory(t.category)}&newGame=1`)}
                      isViewerDisabled={isViewer}
                      categoryLabel={categoryChipLabel(t.category)}
                    />
                  ))}
                </div>
              )}
              {hiddenPresets > 0 && (
                <div className="mt-3 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setPresetPages((p) => p + 1)}
                    className="inline-flex min-h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-600 hover:border-slate-300"
                  >
                    Show {Math.min(hiddenPresets, SECTION_PAGE_SIZE)} more
                    <span className="ml-1.5 text-slate-500 tabular-nums">({hiddenPresets} left)</span>
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {/* §11.3 — the impact dialog. Never opens with a destructive button. */}
      {usageImpact && (
        <TemplateUsageImpactDialog
          impact={usageImpact}
          onClose={() => setUsageImpact(null)}
          onReviewUsage={() => {
            // "Review usage" opens the template's own full-screen preview,
            // whose action tray carries the usage summary and every safe
            // next step (§8.2). The operator lands on the thing itself
            // instead of a dead-ended warning.
            const t = (templates || []).find((x: Template) => x.id === usageImpact.template.id);
            setUsageImpact(null);
            if (t) setPreviewTemplate(t);
          }}
        />
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
          // Customize (presets) and Edit (custom templates) open the
          // source template as-is. The per-card "Custom" toggle chip
          // is the only entry point for canvas-size overrides — it
          // routes through AdaptForLedModal which duplicates at the
          // chosen W×H before opening the builder.
          // 2026-06-09 — a RESTRICTED_VIEWER is read-only, so don't render
          // Customize/Edit at all (operator: "the viewer can click customize
          // but it just returns them to the main page… better to remove the
          // button"). Hiding the action beats letting them click into a gated
          // route that bounces back. They keep the read-only preview.
          onCustomize={!isViewer && previewTemplate.isSystem ? () => {
            const t = previewTemplate;
            setPreviewTemplate(null);
            openTemplate(t);
          } : undefined}
          onEdit={!isViewer && !previewTemplate.isSystem ? () => {
            const t = previewTemplate;
            setPreviewTemplate(null);
            openTemplate(t);
          } : undefined}
          // §4.4 — the LANDSCAPE / PORTRAIT switch now lives in the
          // preview, where it isn't competing with the artwork on a
          // hundred cards at once.
          portraitSibling={portraitSiblingFor(previewTemplate)}
          // §8.2 — the secondary action and the disclosed management set.
          // A preset has no playlist / export / duplicate story; a viewer
          // gets neither. "Adapt to a screen" is offered for both.
          onPutOnScreen={!isViewer && !previewTemplate.isSystem ? () => {
            const t = previewTemplate;
            setPreviewTemplate(null);
            void putOnScreen(t);
          } : undefined}
          onDuplicate={!isViewer && !previewTemplate.isSystem ? () => {
            const t = previewTemplate;
            setPreviewTemplate(null);
            void handleDuplicate(t);
          } : undefined}
          onExport={!isViewer && !previewTemplate.isSystem ? () => { void handleExport(previewTemplate); } : undefined}
          onAdaptForLED={!isViewer ? () => {
            const t = previewTemplate;
            setPreviewTemplate(null);
            setAdaptTemplate(t);
          } : undefined}
          onUseForGame={SPORTS_GAME_CATEGORIES.has(previewTemplate.category) && !isViewer ? () => {
            const t = previewTemplate;
            setPreviewTemplate(null);
            router.push(`/${params?.schoolId ?? ''}/sports?templateId=${encodeURIComponent(t.id)}&surface=${sportsSurfaceForCategory(t.category)}&newGame=1`);
          } : undefined}
          usage={previewTemplate.isSystem ? undefined : deriveTemplateUsage(usageByTemplate, previewTemplate.id)}
        />
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════
// LIST VIEW — management at scale (Calm v1 §9.3)
// ═════════════════════════════════════════════════════

/**
 * Grid is the default because the artwork is what an operator is choosing
 * between (§9.2). List is what they want once the library is 80 rows deep
 * and the question changes from "which one looks right" to "which one is
 * stale / unused / last touched in March".
 *
 * §9.3's own binding line: "Avoid rendering active widget trees in list
 * thumbnails." The 56px thumbnail here is the same frozen/poster render
 * the grid uses, and at that size it is a colour swatch — so the row cost
 * is a cached image, not a mounted board.
 */
export function TemplateListView({
  templates, categoryLabelFor, usageFor, onPreview, onPrimary, primaryLabel,
}: {
  templates: Template[];
  categoryLabelFor: (key: string) => string;
  /** Omitted for presets, which have no playlists or screens to report. */
  usageFor?: (t: Template) => TemplateUsageState;
  onPreview: (t: Template) => void;
  /** Omitted for a restricted viewer, whose only action is Preview. */
  onPrimary?: (t: Template) => void;
  primaryLabel: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <ul className="divide-y divide-slate-100">
        {templates.map((t) => {
          const usage = usageFor?.(t);
          const reach = usage ? usageReachLabel(usage) : null;
          const pill = usage ? usagePillLabel(usage) : null;
          const edited = t.isSystem ? null : lastEditedLabel(t.updatedAt);
          return (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50/70">
              <button
                type="button"
                onClick={() => onPreview(t)}
                aria-label={`Preview of ${t.name} template`}
                className="h-10 w-[72px] shrink-0 overflow-hidden rounded-md border border-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                style={{
                  backgroundColor: t.bgColor || '#f1f5f9',
                  backgroundImage: t.bgImage ? `url(${t.bgImage})` : (t.bgGradient || undefined),
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-slate-800" title={t.name}>{t.name}</p>
                <p className="truncate text-[11px] text-slate-500">
                  {categoryLabelFor(t.category)} · {t.screenWidth}×{t.screenHeight}
                  {edited ? ` · ${edited}` : ''}
                </p>
              </div>
              <div className="hidden w-44 shrink-0 flex-col items-start gap-0.5 sm:flex">
                {pill && (
                  <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                    usage?.kind === 'live'
                      ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border border-slate-200 bg-slate-50 text-slate-500'
                  }`}>
                    {pill}
                  </span>
                )}
                {reach && <span className="text-[11px] text-slate-500">{reach}</span>}
              </div>
              <button
                type="button"
                onClick={() => (onPrimary ? onPrimary(t) : onPreview(t))}
                className="inline-flex min-h-9 shrink-0 items-center rounded-lg border px-3 text-[13px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-500"
                style={{ borderColor: 'var(--brand-primary, #4f46e5)', color: 'var(--brand-primary, #4f46e5)' }}
              >
                {onPrimary ? primaryLabel : 'Preview'}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ═════════════════════════════════════════════════════
// USAGE-IMPACT DIALOG (Calm v1 §11.3)
// ═════════════════════════════════════════════════════

/**
 * What the operator sees when they try to remove a template that other
 * things depend on.
 *
 * The single most important design decision on this page is that this
 * dialog has NO destructive button. §11.3: "The safe path is `Review
 * usage`, not an emphasized `Delete anyway`." The flow it replaced read a
 * cached playlist count off the list payload, pre-armed a red "Delete
 * anyway", and let one click unlink a layout from every playlist using it
 * — a live signage change nobody had chosen, decided by an operator who
 * had been handed a number and a red button in the same breath.
 *
 * Everything printed here comes from the server's 409. When the server
 * doesn't send a figure, this says nothing about it rather than printing
 * a zero it cannot prove.
 */
export function TemplateUsageImpactDialog({
  impact, onClose, onReviewUsage,
}: {
  impact: TemplateUsageImpact;
  onClose: () => void;
  onReviewUsage: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
    const raf = requestAnimationFrame(() => primaryRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      // §14 — modals trap focus and restore it on close.
      if (e.key === 'Tab' && dialogRef.current) {
        const nodes = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'),
        );
        if (nodes.length === 0) return;
        e.preventDefault();
        const idx = nodes.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey
          ? (idx <= 0 ? nodes.length - 1 : idx - 1)
          : (idx === nodes.length - 1 ? 0 : idx + 1);
        nodes[next].focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      if (restoreRef.current?.isConnected) restoreRef.current.focus();
    };
  }, [onClose]);

  // Only the figures the server actually sent. `playlists` is a real list,
  // so its length is a fact; screens and locations print only when present.
  const bits: string[] = [];
  if (impact.playlists.length > 0) {
    bits.push(`${impact.playlists.length} playlist${impact.playlists.length === 1 ? '' : 's'}`);
  }
  if (typeof impact.screensReached === 'number' && impact.screensReached > 0) {
    bits.push(`${impact.screensReached} screen${impact.screensReached === 1 ? '' : 's'}`);
  }
  if (typeof impact.locations === 'number' && impact.locations > 0) {
    bits.push(`${impact.locations} location${impact.locations === 1 ? '' : 's'}`);
  }

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed top-0 right-0 bottom-0 left-0 z-[110] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="tpl-impact-title"
        aria-describedby="tpl-impact-body"
        className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50">
            <AlertTriangle className="h-4.5 w-4.5 text-amber-500" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 id="tpl-impact-title" className="text-[15px] font-bold text-slate-800">
              “{impact.template.name}” is currently in use
            </h2>
            {bits.length > 0 && (
              <p className="mt-0.5 text-[13px] font-semibold text-slate-600">{bits.join(' · ')}</p>
            )}
          </div>
        </div>

        <div id="tpl-impact-body" className="mt-3 space-y-2">
          <p className="text-[13px] text-slate-600">
            Removing it could change what those screens display.
          </p>
          {impact.playlists.length > 0 && (
            <ul className="max-h-32 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-2.5">
              {impact.playlists.map((p) => (
                <li key={p.id} className="truncate text-[12px] font-medium text-slate-600">
                  {(p.name || 'Untitled').replace(/\s+/g, ' ').trim() || 'Untitled'}
                </li>
              ))}
            </ul>
          )}
          {impact.playlists.length === 0 && impact.message && (
            // Older API, or one that reported the conflict in prose only.
            <p className="text-[12px] text-slate-500">{impact.message}</p>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-600 hover:border-slate-300"
          >
            Cancel
          </button>
          <button
            ref={primaryRef}
            type="button"
            onClick={onReviewUsage}
            className="inline-flex min-h-10 items-center rounded-lg px-4 text-[13px] font-bold text-white"
            style={{ backgroundColor: 'var(--brand-primary, #4f46e5)' }}
          >
            Review usage
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ═════════════════════════════════════════════════════
// Full-screen AI-candidate preview (2026-06-30)
// ═════════════════════════════════════════════════════
//
// Renders ONE not-yet-saved AI candidate full-screen so the operator can review
// each of the 3 at full size before deciding which to save. Mirrors
// TemplatePreviewModal's chrome (floating top bar, Esc/Close, "{w}×{h} · n
// elements · Esc to close"), but takes a candidate (NOT a saved Template) so the
// set is never discarded. Esc / Close / backdrop returns to the grid; prev/next
// flips between candidates; Save persists this board without leaving.
export function CandidateFullscreenPreview({
  candidate, index, total, canvas, saved, saving, onPrev, onNext, onClose, onSave,
  canTweak, tweakOpen, tweakText, onTweakTextChange, refining, onOpenTweak, onCancelTweak, onApplyTweak,
}: {
  candidate: AiTemplateCandidate;
  index: number;
  total: number;
  canvas: { w: number; h: number };
  saved: boolean;
  saving: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onSave: () => void;
  /** Wave D1 (#282) — refine/translate loop, reachable without leaving
   *  full-screen. Optional so any other caller of this component (there is
   *  none today, but the props are additive) can omit them and simply not
   *  render the Tweak affordance. */
  canTweak?: boolean;
  tweakOpen?: boolean;
  tweakText?: string;
  onTweakTextChange?: (text: string) => void;
  refining?: boolean;
  onOpenTweak?: () => void;
  onCancelTweak?: () => void;
  onApplyTweak?: (text: string) => void;
}) {
  // Live viewport height so the engine render fills the available area (same
  // hydration-safe pattern as TemplatePreviewModal: SSR-safe default, then bump
  // to the real value post-mount).
  const [vh, setVh] = useState<number>(800);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      else if (e.key === 'ArrowLeft' && total > 1) onPrev();
      else if (e.key === 'ArrowRight' && total > 1) onNext();
    };
    const onResize = () => setVh(window.innerHeight);
    onResize();
    // Capture so our Esc closes the full-screen view FIRST (and stops it from
    // bubbling to the AI modal's own Esc handler, which would close everything).
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, [onClose, onPrev, onNext, total]);

  const sw = canvas.w || 1920;
  const sh = canvas.h || 1080;
  // Engine boards: a multi-scene "set" must preview its FIRST board only.
  const isSet = !!(candidate.scenes && candidate.scenes.length > 1);
  const firstSceneName = candidate.scenes?.[0]?.name;
  const previewZones = isSet
    ? candidate.zones.filter((z) => !z.sceneRef || z.sceneRef === firstSceneName)
    : candidate.zones;
  const bg = candidate.background || {};
  const maxH = Math.max(300, vh - 48);
  const tAi = useTranslations('aiBoards') as unknown as AiBoardsT;
  const label = candidateLabel(tAi, candidate, index);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed top-0 right-0 bottom-0 left-0 z-[110] bg-slate-950/95 flex flex-col"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Full-screen preview: ${candidate.name}`}
    >
      {/* Full-bleed stage */}
      <div
        className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center p-4 md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        {candidate._designerHtml ? (
          // AI Designer board — render the authored HTML full-screen through
          // the W0-02 containment wrapper (model scripts stripped + CSP; the
          // trusted VOS-STAGE-SCALE runtime fits the stage to this frame).
          // NOT pointer-events-none here (full-screen is interactive-allowed).
          <iframe
            title={candidate.name}
            srcDoc={buildSafeDesignerSrcdoc(candidate._designerHtml)}
            sandbox="allow-scripts"
            className="w-full h-full bg-black rounded-lg shadow-2xl"
            style={{ border: 0, maxWidth: `${(maxH * sw) / sh}px`, maxHeight: `${maxH}px`, aspectRatio: `${sw} / ${sh}` }}
          />
        ) : (
          <ScaledTemplateThumbnail
            zones={previewZones as any}
            screenWidth={sw}
            screenHeight={sh}
            bgColor={bg.bgColor || '#ffffff'}
            bgGradient={bg.bgGradient || null}
            bgImage={bg.bgImage || null}
            maxHeight={maxH}
            freeze={false}
          />
        )}
      </div>

      {/* Floating top bar — name + meta + Close */}
      <div className="absolute top-0 right-0 left-0 flex items-start justify-between px-4 py-3 bg-gradient-to-b from-slate-950/80 to-transparent pointer-events-none pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="pointer-events-auto">
          <div className="text-base font-bold text-white drop-shadow flex items-center gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-600 text-white">{label}</span>
            <span className="truncate max-w-[50vw]">{candidate.name}</span>
            {saved && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-600 text-white flex items-center gap-0.5">
                <Check className="w-3 h-3" /> Saved
              </span>
            )}
          </div>
          <div className="text-[11px] text-white/60 drop-shadow">
            {sw}×{sh} · {candidate.zones.length} element{candidate.zones.length === 1 ? '' : 's'}
            {total > 1 ? ` · ${index + 1} of ${total}` : ''} · Esc to close
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="pointer-events-auto flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-100 text-slate-900 text-sm font-bold rounded-full transition-colors shadow-lg"
          aria-label="Close preview"
        >
          <X className="w-4 h-4" /> Close
        </button>
      </div>

      {/* Prev / Next — flip between the candidates without leaving full-screen. */}
      {total > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPrev(); }}
            aria-label="Previous option"
            className="pointer-events-auto absolute left-2 md:left-4 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-white/90 hover:bg-white text-slate-900 shadow-lg active:scale-95 transition"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onNext(); }}
            aria-label="Next option"
            className="pointer-events-auto absolute right-2 md:right-4 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center rounded-full bg-white/90 hover:bg-white text-slate-900 shadow-lg active:scale-95 transition"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </>
      )}

      {/* Wave D1 (#282) — Tweak + Translate panel, floating above the bottom
          CTA pill when open. Identical instruction box + language chips as
          the grid card's "Tweak" box (refineCandidate handles both engine
          and AI-Designer candidates), just reachable without leaving
          full-screen. */}
      {canTweak && tweakOpen && (
        <div
          className="absolute right-0 bottom-20 left-0 flex items-center justify-center px-4 pointer-events-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pointer-events-auto w-full max-w-md flex flex-col gap-1.5 p-3 bg-slate-900/95 border border-white/10 rounded-2xl shadow-2xl">
            <input
              autoFocus
              value={tweakText || ''}
              onChange={(e) => onTweakTextChange?.(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (tweakText || '').trim()) onApplyTweak?.(tweakText || ''); }}
              placeholder='e.g. "darker theme", "punchier headline", "add a stat"'
              disabled={refining}
              className="w-full px-3 py-2 text-xs rounded-lg bg-white/10 border border-white/15 text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:opacity-60"
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => onApplyTweak?.(tweakText || '')}
                disabled={refining || !(tweakText || '').trim()}
                className="flex-1 px-3 py-2 text-xs font-bold rounded-lg bg-violet-600 text-white disabled:opacity-50 flex items-center justify-center gap-1"
              >
                {refining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                Apply
              </button>
              <button
                type="button"
                onClick={onCancelTweak}
                disabled={refining}
                className="px-3 py-2 text-xs font-bold rounded-lg bg-white/10 border border-white/15 text-white/80 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1 pt-0.5">
              <span className="text-[10px] text-white/40 mr-0.5">🌐 Translate:</span>
              {['Spanish', 'French', 'Chinese', 'Vietnamese', 'Korean', 'Arabic'].map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => onApplyTweak?.(`Translate ALL visible copy to ${lang}. Keep the layout, theme, structure, and any prices/times/numbers identical.`)}
                  disabled={refining}
                  className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/70 hover:bg-violet-500/40 hover:text-white disabled:opacity-50"
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Loading veil while a full-screen tweak/translate is in flight. */}
      {refining && (
        <div className="absolute top-0 right-0 bottom-0 left-0 bg-slate-950/60 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
          <span className="text-xs font-bold text-white">Applying your change…</span>
        </div>
      )}

      {/* Floating bottom CTA — Tweak + Save (non-destructive; stays full-screen). */}
      <div className="absolute right-0 bottom-0 left-0 flex items-center justify-center pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none">
        <div
          className="pointer-events-auto flex items-center gap-2 px-3 py-2 bg-slate-900/85 rounded-full shadow-2xl border border-white/10"
          onClick={(e) => e.stopPropagation()}
        >
          {canTweak && !tweakOpen && (
            <button
              type="button"
              onClick={onOpenTweak}
              disabled={saving || refining}
              title="Refine this board by describing a change"
              className="px-4 py-2.5 text-sm font-bold rounded-full bg-white/10 border border-white/15 text-white hover:bg-white/20 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Sparkles className="w-4 h-4" /> Tweak
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={saving || saved}
            className={`px-5 py-2.5 text-sm font-bold rounded-full flex items-center gap-1.5 disabled:cursor-not-allowed ${
              saved
                ? 'bg-emerald-600 text-white'
                : 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white disabled:opacity-60'
            }`}
          >
            {saving ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
            ) : saved ? (
              <><Check className="w-4 h-4" /> Saved to templates</>
            ) : (
              <><Check className="w-4 h-4" /> Save this board</>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ═════════════════════════════════════════════════════
// Fullscreen template preview modal (Calm v1 §8)
// ═════════════════════════════════════════════════════
//
// "The preview is where complexity can safely expand" (§8). Calm v1 takes
// deliberate weight OFF the card and puts it here, because this is the one
// place the operator has already said "show me this specific template" —
// so the orientation switch (§4.4), the usage summary and the affected
// playlists (§8.2), and every secondary action can appear without adding
// a single pixel of noise to a hundred-tile grid.
export function TemplatePreviewModal({
  template, portraitSibling, onClose, onCustomize, onEdit, onAdaptForLED,
  onPutOnScreen, onDuplicate, onExport, onUseForGame, usage, usagePlaylists,
}: {
  template: Template;
  /** When a portrait sibling exists, the LANDSCAPE / PORTRAIT switch lives
   *  here rather than over the card's artwork (§4.4, §7.2). */
  portraitSibling?: Template;
  onClose: () => void;
  /** Opens the "Adapt for LED" canvas-size picker, duplicates the
   *  template at the new dimensions, opens the builder. Available
   *  on both system presets and custom templates. */
  onAdaptForLED?: () => void;
  /** Opens the builder with the system preset loaded. Nothing is
   *  written to the DB here — save-as-copy in the builder does that. */
  onCustomize?: () => void;
  /** Opens an existing custom template in the builder. */
  onEdit?: () => void;
  /** §8.2 secondary — create a playlist from this board and publish it. */
  onPutOnScreen?: () => void;
  onDuplicate?: () => void;
  onExport?: () => void;
  /** Sports surfaces only (§8.3). */
  onUseForGame?: () => void;
  /** §8.2 — "Show usage summary and affected playlists/screens." Unknown
   *  usage shows nothing, exactly as on the card. */
  usage?: TemplateUsageState;
  /** Names of the playlists this template is bound to, when known. */
  usagePlaylists?: Array<{ id: string; name: string }>;
}) {
  // Live viewport size — recomputed on resize so the template scales
  // to fill the available area instead of a once-at-mount snapshot.
  //
  // 2026-05-14 — was `useState(typeof window !== 'undefined' ?
  // window.innerHeight : 800)`, which is the textbook React hydration
  // mismatch trap: server renders 800, client hydrates with the real
  // viewport height (could be anything from 568 on an iPhone SE to
  // 1440 on a 4K monitor). The mismatched HTML fires React error
  // #418 on EVERY tenant — Prod Smoke had been failing for 30+
  // commits because of this, even after the earlier dashboard
  // hydration fix (5d929d4). Same pattern, different file.
  //
  // Fix: start with the safe 800 default (matches server), then
  // bump to the real innerHeight inside the same useEffect that
  // wires the resize listener. First paint matches SSR; second
  // render (post-mount) gets the real value with no hydration
  // boundary in between.
  const [vh, setVh] = useState<number>(800);
  // §4.4 / §7.2 — which sibling is on screen. Local, so closing and
  // reopening the preview starts from the template the operator clicked.
  const [showPortrait, setShowPortrait] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const active = showPortrait && portraitSibling ? portraitSibling : template;

  useEffect(() => {
    // §14 — restore focus to whatever opened the preview (the card's own
    // preview button), so Escape doesn't strand a keyboard operator at the
    // top of the document.
    restoreRef.current = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      // §14 — modals trap focus.
      if (e.key === 'Tab' && dialogRef.current) {
        const nodes = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'),
        ).filter((n) => n.offsetParent !== null);
        if (nodes.length === 0) return;
        e.preventDefault();
        const idx = nodes.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey
          ? (idx <= 0 ? nodes.length - 1 : idx - 1)
          : (idx === nodes.length - 1 || idx < 0 ? 0 : idx + 1);
        nodes[next].focus();
      }
    };
    const onResize = () => setVh(window.innerHeight);
    onResize(); // grab the real height once mounted
    const raf = requestAnimationFrame(() => closeBtnRef.current?.focus());
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      if (restoreRef.current?.isConnected) restoreRef.current.focus();
    };
  }, [onClose]);

  const sw = active.screenWidth || 3840;
  const sh = active.screenHeight || 2160;

  // Template fills the full viewport; the top and bottom bars float as
  // semi-transparent overlays so the template renders at maximum size
  // instead of losing 150+ px to stacked toolbars.
  const maxH = Math.max(300, vh - 48);

  const reach = usage ? usageReachLabel(usage) : null;
  const statusPill = usage ? usagePillLabel(usage) : null;

  // §6.5 / §8.2 — everything that isn't the one primary and the one
  // secondary action lives behind the tray's own overflow.
  const trayMenu: OverflowItem[] = [];
  if (onDuplicate) trayMenu.push({ key: 'duplicate', label: 'Duplicate', icon: Copy, onSelect: onDuplicate });
  if (onAdaptForLED) trayMenu.push({ key: 'adapt', label: 'Adapt to screen size', icon: Settings2, onSelect: onAdaptForLED });
  if (onExport) trayMenu.push({ key: 'export', label: 'Export template', icon: Download, onSelect: onExport });

  // Portal to document.body so the modal isn't trapped inside the
  // DashboardLayout's flex container (which leaves the sidebar peeking
  // out on the left). `fixed` alone isn't enough when an ancestor uses
  // `transform`/`contain` — the fixed element gets rebased to that
  // ancestor instead of the viewport. Portal dodges it entirely.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={dialogRef}
      className="fixed top-0 right-0 bottom-0 left-0 z-[100] bg-slate-950/92 backdrop-blur-md"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview: ${active.name}`}
    >
      {/* Full-bleed stage */}
      <div
        className="absolute top-0 right-0 bottom-0 left-0 flex items-center justify-center p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <ScaledTemplateThumbnail
          zones={(active.zones || []) as any}
          screenWidth={sw}
          screenHeight={sh}
          bgImage={active.bgImage}
          bgGradient={active.bgGradient}
          bgColor={active.bgColor}
          maxHeight={maxH}
          // §8.4 — full-screen preview = a SINGLE board, so it runs fully
          // live (live clock, animations, ticker, the real board document).
          // This is the surface the frozen gallery thumbnail defers TO;
          // never freeze it.
          freeze={false}
        />
      </div>

      {/* Floating top bar — identity, canvas, orientation, close */}
      <div className="absolute top-0 right-0 left-0 flex items-start justify-between gap-3 px-4 py-2.5 bg-gradient-to-b from-slate-950/80 to-transparent pointer-events-none">
        <div className="pointer-events-auto min-w-0">
          <div className="truncate text-base font-bold text-white drop-shadow">{active.name}</div>
          <div className="text-[11px] text-white/60 drop-shadow">
            {sw}×{sh} · {canvasBadgeLabel(active)} · {(active.zones || []).length} zones
            <span className="hidden sm:inline"> · Esc to close</span>
          </div>
        </div>
        <div className="pointer-events-auto flex shrink-0 items-center gap-2">
          {/* §4.4 — the orientation switch that used to sit over the card's
              artwork. Here it costs nothing and is exactly where an
              operator deciding between the two variants is looking. */}
          {portraitSibling && (
            <div className="flex items-center overflow-hidden rounded-full bg-white/10 p-0.5 ring-1 ring-white/20" role="group" aria-label="Orientation">
              <button
                type="button"
                onClick={() => setShowPortrait(false)}
                aria-pressed={!showPortrait}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors motion-reduce:transition-none ${
                  !showPortrait ? 'bg-white text-slate-900' : 'text-white/80 hover:text-white'
                }`}
              >
                <Monitor className="h-3 w-3" /> Landscape
              </button>
              <button
                type="button"
                onClick={() => setShowPortrait(true)}
                aria-pressed={showPortrait}
                className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors motion-reduce:transition-none ${
                  showPortrait ? 'bg-white text-slate-900' : 'text-white/80 hover:text-white'
                }`}
              >
                <Smartphone className="h-3 w-3" /> Portrait
              </button>
            </div>
          )}
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-900 shadow-lg transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none"
            aria-label="Close preview"
          >
            <X className="h-4 w-4" /> Close
          </button>
        </div>
      </div>

      {/* §8.2 — usage summary, in the one place there is room to be
          specific about it. Renders nothing when usage is unknown. */}
      {(statusPill || reach || (usagePlaylists && usagePlaylists.length > 0)) && (
        <div
          className="pointer-events-auto absolute left-4 top-16 max-w-[15rem] rounded-xl bg-slate-900/80 p-3 text-white shadow-lg ring-1 ring-white/10 backdrop-blur-sm max-sm:hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider text-white/50">Where this is used</p>
          {statusPill && (
            <p className={`mt-1 text-[12px] font-bold ${usage?.kind === 'live' ? 'text-emerald-300' : 'text-white/70'}`}>
              {statusPill}
            </p>
          )}
          {reach && <p className="text-[12px] text-white/70">{reach}</p>}
          {usagePlaylists && usagePlaylists.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {usagePlaylists.slice(0, 5).map((p) => (
                <li key={p.id} className="truncate text-[11px] text-white/60">{p.name || 'Untitled'}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Floating bottom action tray (§8.2 / §8.3) */}
      {(onEdit || onCustomize || onPutOnScreen || onUseForGame || onAdaptForLED || trayMenu.length > 0) && (
        <div className="absolute bottom-4 right-0 left-0 flex items-center justify-center gap-2 px-4 pointer-events-none">
          <div
            className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-900/85 px-3 py-2 shadow-2xl backdrop-blur-md"
            onClick={(e) => e.stopPropagation()}
          >
            {/* PRIMARY — Edit for a template you own, Use this template for
                a preset. Exactly one of these is ever rendered. */}
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="rounded-full px-4 py-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                style={{ backgroundColor: 'var(--brand-primary, #4f46e5)' }}
              >
                Edit template
              </button>
            )}
            {onCustomize && (
              <button
                type="button"
                onClick={onCustomize}
                className="flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                style={{ backgroundColor: 'var(--brand-primary, #4f46e5)' }}
              >
                <Pencil className="h-3.5 w-3.5" /> Use this template
              </button>
            )}
            {/* SECONDARY */}
            {onPutOnScreen && (
              <button
                type="button"
                onClick={onPutOnScreen}
                className="flex items-center gap-1.5 rounded-full border border-white/20 px-4 py-2 text-xs font-bold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <MonitorPlay className="h-3.5 w-3.5" /> Put on a screen
              </button>
            )}
            {!onPutOnScreen && onAdaptForLED && (
              <button
                type="button"
                onClick={onAdaptForLED}
                className="flex items-center gap-1.5 rounded-full border border-white/20 px-4 py-2 text-xs font-bold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <Settings2 className="h-3.5 w-3.5" /> Adapt to a screen
              </button>
            )}
            {onUseForGame && (
              <button
                type="button"
                onClick={onUseForGame}
                className="flex items-center gap-1.5 rounded-full border border-amber-300/40 bg-amber-400/10 px-4 py-2 text-xs font-bold text-amber-200 hover:bg-amber-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                <Trophy className="h-3.5 w-3.5" /> Use for a game
              </button>
            )}
            {trayMenu.length > 0 && (
              <TemplateOverflowMenu
                items={trayMenu}
                label={`More actions for ${active.name}`}
                buttonClassName="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              />
            )}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

// ═════════════════════════════════════════════════════
// ADAPT FOR LED — duplicate to a new canvas size
// ═════════════════════════════════════════════════════

/**
 * "Pick a canvas size and adapt this template" — the operator-facing
 * answer to "we have 1-6 panel LED setups, can it auto-fit them all?"
 * (2026-05-13). Three high-level options:
 *
 *   Portrait  → tall canvas (1080×1920 default — 4K portrait/2 = 1080×1920)
 *   Landscape → wide canvas (1920×1080 default — Full HD landscape)
 *   Custom    → operator picks W×H, with 1-6 panel LED shortcuts for
 *               the Taurus / NovaStar poster chains we run today.
 *
 * On confirm, the parent calls /templates/:id/duplicate with the new
 * canvas dimensions. The duplicated template inherits every zone's
 * %-position; widgets self-scale to fit via their internal useScaleToFit.
 * Builder then opens for drag-adjustment.
 */
function AdaptForLedModal({
  source,
  portraitSibling,
  onClose,
  onAdapt,
  pending,
}: {
  source: Template;
  /** When the operator picks a portrait-aspect canvas size, we use
   *  this template's portrait sibling as the base instead of `source`
   *  so the widget layout starts from the portrait variant — much
   *  better fit than squeezing the landscape widget into a tall
   *  zone. (2026-05-14 operator ask.) */
  portraitSibling?: Template;
  onClose: () => void;
  onAdapt: (canvas: { screenWidth: number; screenHeight: number; orientation: 'LANDSCAPE' | 'PORTRAIT' }) => void | Promise<void>;
  pending: boolean;
}) {
  // Pick a sensible starting mode: if the source is portrait, default
  // the picker to portrait; otherwise landscape. Operator can flip.
  const sourceOrient: 'LANDSCAPE' | 'PORTRAIT' =
    (source.screenHeight || 1080) > (source.screenWidth || 1920) ? 'PORTRAIT' : 'LANDSCAPE';
  const [mode, setMode] = useState<'PORTRAIT' | 'LANDSCAPE' | 'CUSTOM'>(sourceOrient);
  // String state so the operator can fully CLEAR the field and type a
  // fresh value. The old `parseInt(e.target.value) || 1920` snapped the
  // field back to 1920 the instant it went empty (operator: "every time
  // I erase the default it resets to 1920"). Keep the raw string here;
  // parse to numbers (with a sane fallback while mid-edit) for the
  // preview/orientation hints, and clamp once on Adapt.
  const [customW, setCustomW] = useState(String(source.screenWidth || 1920));
  const [customH, setCustomH] = useState(String(source.screenHeight || 1080));
  const numW = parseInt(customW, 10) || 1920;
  const numH = parseInt(customH, 10) || 1080;

  // Compute the effective canvas size + which base the parent's
  // auto-router will pick. Mirrors the math in onAdapt so the UI
  // hint matches reality.
  const previewCanvas: { w: number; h: number; orientation: 'LANDSCAPE' | 'PORTRAIT' } =
    mode === 'PORTRAIT' ? { w: 1080, h: 1920, orientation: 'PORTRAIT' }
    : mode === 'LANDSCAPE' ? { w: 1920, h: 1080, orientation: 'LANDSCAPE' }
    : { w: numW, h: numH, orientation: numH > numW ? 'PORTRAIT' : 'LANDSCAPE' };
  const previewBase: Template = (() => {
    if (!portraitSibling) return source;
    const targetIsPortrait = previewCanvas.h > previewCanvas.w;
    const sourceIsPortrait = (source.screenHeight || 0) > (source.screenWidth || 0);
    if (targetIsPortrait && !sourceIsPortrait) return portraitSibling;
    return source;
  })();

  // The LED-poster shortcuts the operator uses in production. Each
  // chip prefills the custom W/H so they can hit Adapt without typing.
  const ledPanelShortcuts = [
    { panels: 1, w: 320, h: 1080 },
    { panels: 2, w: 640, h: 1080 },
    { panels: 3, w: 960, h: 1080 },
    { panels: 4, w: 1280, h: 1080 },
    { panels: 5, w: 1600, h: 1080 },
    { panels: 6, w: 1920, h: 1080 },
  ];

  const resolveCanvas = (): { screenWidth: number; screenHeight: number; orientation: 'LANDSCAPE' | 'PORTRAIT' } => {
    if (mode === 'PORTRAIT') return { screenWidth: 1080, screenHeight: 1920, orientation: 'PORTRAIT' };
    if (mode === 'LANDSCAPE') return { screenWidth: 1920, screenHeight: 1080, orientation: 'LANDSCAPE' };
    const w = Math.max(100, Math.min(15360, Math.round(numW)));
    const h = Math.max(100, Math.min(15360, Math.round(numH)));
    return {
      screenWidth: w,
      screenHeight: h,
      orientation: h > w ? 'PORTRAIT' : 'LANDSCAPE',
    };
  };

  const handleAdapt = async () => {
    await onAdapt(resolveCanvas());
  };

  const orientButtonStyle = (active: boolean): string =>
    `flex-1 py-3 rounded-xl border-2 transition-all text-left px-4 ${
      active
        ? 'bg-indigo-50 border-indigo-400 text-indigo-700'
        : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-200'
    }`;

  return (
    <div
      // 2026-05-14 — mobile: slides up as a bottom-sheet (items-end +
      // no horizontal padding so the sheet fills width). Desktop:
      // centered modal. Both modes cap at 90vh + scroll inside.
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end md:items-center justify-center md:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-2xl md:rounded-2xl shadow-2xl w-full max-w-xl p-5 md:p-6 space-y-4 md:space-y-5 max-h-[90vh] overflow-y-auto pb-[env(safe-area-inset-bottom)] md:pb-6"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle hint on mobile */}
        <div className="md:hidden flex justify-center -mt-2 mb-2" aria-hidden>
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-800">Adapt for an LED</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              We'll copy <span className="font-semibold">{source.name}</span> to a new canvas size and open the builder so you can fine-tune widget placement.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 -mr-2 -mt-1 w-10 h-10 md:w-auto md:h-auto rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 active:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2.5 block">Canvas shape</label>
          <div className="flex gap-2">
            <button onClick={() => setMode('PORTRAIT')} className={orientButtonStyle(mode === 'PORTRAIT')}>
              <div className="text-sm font-bold flex items-center gap-1.5"><Smartphone className="w-4 h-4" /> Portrait</div>
              <div className="text-[10px] opacity-70 mt-0.5">1080×1920 (tall)</div>
            </button>
            <button onClick={() => setMode('LANDSCAPE')} className={orientButtonStyle(mode === 'LANDSCAPE')}>
              <div className="text-sm font-bold flex items-center gap-1.5"><Monitor className="w-4 h-4" /> Landscape</div>
              <div className="text-[10px] opacity-70 mt-0.5">1920×1080 (wide)</div>
            </button>
            <button onClick={() => setMode('CUSTOM')} className={orientButtonStyle(mode === 'CUSTOM')}>
              <div className="text-sm font-bold flex items-center gap-1.5"><Settings2 className="w-4 h-4" /> Custom</div>
              <div className="text-[10px] opacity-70 mt-0.5">Any resolution</div>
            </button>
          </div>
        </div>

        {mode === 'CUSTOM' && (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Resolution</label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={100}
                  max={15360}
                  value={customW}
                  onChange={(e) => setCustomW(e.target.value)}
                  className="flex-1 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  aria-label="Custom canvas width in pixels"
                />
                <span className="text-slate-400 text-xs font-bold">×</span>
                <input
                  type="number"
                  min={100}
                  max={15360}
                  value={customH}
                  onChange={(e) => setCustomH(e.target.value)}
                  className="flex-1 px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  aria-label="Custom canvas height in pixels"
                />
                <span className="text-[10px] text-slate-400 w-20">{numW > numH ? 'landscape' : 'portrait'}</span>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Or pick an LED poster setup</label>
              <div className="grid grid-cols-3 gap-2">
                {ledPanelShortcuts.map((p) => {
                  const active = numW === p.w && numH === p.h;
                  return (
                    <button
                      key={p.panels}
                      onClick={() => { setCustomW(String(p.w)); setCustomH(String(p.h)); }}
                      className={`px-3 py-2 rounded-lg text-left transition-all border ${active ? 'bg-indigo-50 border-indigo-400 text-indigo-700' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-200'}`}
                    >
                      <div className="text-xs font-bold">{p.panels} panel{p.panels > 1 ? 's' : ''}</div>
                      <div className="text-[10px] opacity-60 mt-0.5">{p.w}×{p.h}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Auto-pick hint. When a portrait sibling exists AND the
            target canvas is portrait-shaped, we route through the
            portrait variant instead of the landscape source — much
            better starting layout. Surfaced here so the operator
            sees which base they're getting before they click Adapt. */}
        {previewBase.id !== source.id && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2.5 flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
            <p className="text-[11px] text-emerald-800 leading-relaxed">
              We'll start from <strong>{previewBase.name}</strong> — its portrait layout is a closer match to your {previewCanvas.w}×{previewCanvas.h} canvas than the landscape version.
            </p>
          </div>
        )}
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 flex items-start gap-2">
          <Sparkles className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-800 leading-relaxed">
            We'll keep every widget at its original visual size so nothing looks stretched. After we open the builder, drag the widgets around to lay them out for the new canvas shape.
          </p>
        </div>

        <button
          onClick={handleAdapt}
          disabled={pending}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-sm rounded-xl shadow-sm disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
        >
          {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Maximize2 className="w-4 h-4" />}
          Adapt &amp; Open Builder
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════
// GALLERY CARD — premium hover preview
// ═════════════════════════════════════════════════════

/** Sports Wave S2-3 (2026-07-02) — categories whose cards get the
 *  "Use for a game →" express lane (sports-presets.ts categories, see
 *  the audit's costume-check table: Swimming/Track lane boards + Diving
 *  Leaderboard/Judges = SCOREBOARD, Swim Relay Exchange = SCOREBOARD,
 *  Halftime Board = GAMEDAY, plus the composable Ribbon/Scorebug
 *  variants). Matches CLAUDE.md's exact naming in the task
 *  (SCOREBOARD/RIBBON/SCOREBUG/GAMEDAY). */
const SPORTS_GAME_CATEGORIES = new Set(['SCOREBOARD', 'RIBBON', 'SCOREBUG', 'GAMEDAY']);

/** Which of New Game's three layout dropdowns (sports/page.tsx) this
 *  card's category deep-links into — mirrors matchesSportsSurface in
 *  lib/template-relevance.ts (SCOREBOARD_BOARD_CATEGORIES includes
 *  GAMEDAY under the 'scoreboard' surface; RIBBON and SCOREBUG are each
 *  their own surface). Getting this wrong means the preselected
 *  template silently doesn't appear as a selected option in the modal
 *  (the query param would still say it worked, but the dropdown
 *  wouldn't reflect it) — verified against the same predicate the
 *  dropdown itself filters through, not re-derived by hand. */
function sportsSurfaceForCategory(category: string): 'scoreboard' | 'ribbon' | 'scorebug' {
  const cat = (category || '').toUpperCase();
  if (cat === 'RIBBON') return 'ribbon';
  if (cat === 'SCOREBUG') return 'scorebug';
  return 'scoreboard'; // SCOREBOARD, GAMEDAY
}

// Exported (2026-07-02, Sports Wave S2-3) so the card-action regression
// test can render the EXACT component the gallery mounts (CLAUDE.md
// rule #9) rather than a hand-rolled re-implementation that could drift.
//
// ── Calm v1 (2026-08-31) ────────────────────────────────────────────────
// The card used to carry, permanently and all at once: a Landscape /
// Portrait / Custom segmented control over the artwork, a Preview chip, a
// Branded pill, category + resolution + zone-count metadata, "Put on a
// screen", "Use for a game", Edit, and three unlabelled icon buttons
// (duplicate / export / DELETE). Nine competing affordances per tile,
// times a hundred tiles.
//
// Calm v1 §4.2 collapses that to ONE obvious primary action per card, with
// every secondary management action progressively disclosed through the
// three-dot menu (§6.5) or the full-screen preview (§8). Nothing was
// removed from the product — Put on a screen, Duplicate, Export, Adapt to
// screen size, Use for a game and delete all still exist, one keystroke
// or one click further away, which is the correct distance for an action
// an operator takes once a month on a page they scan every day.
//
// Two things that are NOT cosmetic and must survive any future edit:
//   - the destructive action keeps a TEXT LABEL (§6.5) — an unlabelled
//     trash icon sitting permanently on every card is how a layout that
//     three screens depend on gets deleted by a mis-click;
//   - `LIVE` is never claimed without server proof (see template-usage.ts).
export function GalleryCard({
  template, portraitSibling, onEdit, onPutOnScreen, putOnScreenBusy = false,
  onDuplicate, onExport, onAdaptForLED, onDelete, onPreview, onUseForGame,
  isViewerDisabled = false, usage, needsAttention = false, categoryLabel,
}: {
  template: Template;
  /** If this template has a portrait sibling preset, pass it here. The
   *  card shows a single canvas badge; the LANDSCAPE / PORTRAIT switch
   *  itself lives in the full-screen preview (§4.4) so it stops competing
   *  with the artwork. Passed through to onPreview's consumer. */
  portraitSibling?: Template;
  onEdit?: () => void;
  /** Express lane — create a playlist from this template and jump straight to
   *  the Publish-to-Screens sheet. Works on a phone (skips the layout builder).
   *  Only offered for custom templates (presets aren't playlist-ready).
   *  Calm v1: lives in the overflow menu + the preview's action tray. */
  onPutOnScreen?: () => void;
  /** True while this card's "Put on a screen" action is creating the playlist
   *  + navigating, so the card shows it's working. */
  putOnScreenBusy?: boolean;
  onDuplicate?: () => void;
  /** Export this template to a portable .educms-template.json file. */
  onExport?: () => void;
  /** "Adapt to screen size" — duplicate the template at a different canvas
   *  resolution so the operator can re-layout for a 1-6 panel LED
   *  setup (320×1080 → 1920×1080). */
  onAdaptForLED?: () => void;
  onDelete?: () => void;
  /** Called with the template to preview full-screen. */
  onPreview?: (which: Template) => void;
  /**
   * Sports Wave S2-3 (2026-07-02) — "Use for a game" express lane for
   * SCOREBOARD/RIBBON/SCOREBUG/GAMEDAY cards. Audit P1-12: every one of
   * these presets tells the operator to "Bind a game/meet" in its own
   * description, but binding only exists via New Game or the in-game
   * Layouts panel — no gallery affordance ever pointed there. Only
   * offered when the card is actually a sports surface (see
   * SPORTS_GAME_CATEGORIES below) AND the caller supplies this handler.
   * Calm v1 moves it into the overflow menu + preview tray (§6.5).
   */
  onUseForGame?: () => void;
  isViewerDisabled?: boolean;
  /** Server-proven operational usage, or `{ kind: 'unknown' }` when the
   *  summary is unavailable. Unknown renders NOTHING — never "Not in use".
   *  Presets never carry usage (they can't be scheduled directly). */
  usage?: TemplateUsageState;
  /** §10.5 — the SAVED template is broken, not merely its thumbnail. */
  needsAttention?: boolean;
  /** The tenant's OWN word for this category (§3: "categories are
   *  vertical-aware"). The page resolves it from useTenantCopy and passes
   *  it down, so a gym never reads a school's vocabulary — and the card
   *  stays free of the locale/vertical hooks. Falls back to a readable
   *  form of the raw key. */
  categoryLabel?: string;
}) {
  const zones = template.zones || [];
  const sw = template.screenWidth || 3840;
  const sh = template.screenHeight || 2160;

  // 2026-05-26 — "Branded" badge. Operator: "i dont see anything that
  // looks branded, maybe we need a little indicator on the template
  // preview that lets me know its been branded...i never seen a branded
  // template actually work". We can't be 100% sure a zone is branded
  // (the operator may have customized the brand color manually), but
  // we CAN reliably detect when the template's bgGradient was painted
  // by Apply-to-Templates: the server writes
  // `linear-gradient(135deg, ${primary} 0%, ${accent} 100%)` AND/OR
  // sets bgColor === primary. If either matches the current brand
  // palette, we surface a "Branded" pill on the card.
  // System presets never get auto-branded so they don't get the badge.
  // Shared React Query cache (60s staleTime) means every card uses
  // the same /branding/me payload — no per-card fetch.
  // §7.3 forbids stacking badges over the artwork, so Calm v1 moves this
  // one down into the metadata row where it reads as a fact, not a shout.
  const brandingQ = useTenantBranding();
  const brandPalette = (brandingQ.data?.palette as any) || null;
  const isBranded = useMemo(() => {
    if (template.isSystem) return false;
    if (!brandPalette) return false;
    const primary = (brandPalette.primary || '').toLowerCase();
    const accent = (brandPalette.accent || '').toLowerCase();
    if (!primary && !accent) return false;
    const bgC = (template.bgColor || '').toLowerCase();
    const bgG = (template.bgGradient || '').toLowerCase();
    // Match the server-generated gradient shape — same string the
    // applyBrandToTemplates handler writes.
    if (primary && accent && bgG.includes(primary) && bgG.includes(accent)) {
      return true;
    }
    if (primary && bgC === primary) return true;
    if (accent && bgC === accent) return true;
    // Also count "any zone's accentColor matches brand" as branded —
    // covers templates where the bg is intentionally white but zones
    // were re-painted.
    for (const z of zones) {
      try {
        const cfg = z?.defaultConfig ? JSON.parse(z.defaultConfig as any) : null;
        const zc = (cfg?.accentColor || '').toLowerCase();
        if (zc && (zc === primary || zc === accent)) return true;
      } catch {}
    }
    return false;
  }, [template.isSystem, template.bgColor, template.bgGradient, brandPalette, zones]);

  const fire = onPreview ? () => onPreview(template) : undefined;
  // Sports Wave S2-3 (2026-07-02) — gate the "Use for a game" express
  // lane on the card's OWN category so it only shows on real scoreboard/
  // ribbon/scorebug/gameday surfaces, never a generic signage board that
  // happens to be scheduled for the same category name.
  const isSportsGameCard = SPORTS_GAME_CATEGORIES.has(template.category);

  // §6.4 / §4.2 — exactly one primary action, and it is never a disabled
  // editing control wearing a working-button costume: a restricted viewer
  // gets Preview, which is a thing they can actually do.
  const canEdit = !!onEdit && !isViewerDisabled;
  const primary: { label: string; icon: React.ComponentType<{ className?: string }>; run: () => void } | null =
    canEdit
      ? { label: 'Edit', icon: Pencil, run: onEdit! }
      : fire
        ? { label: 'Preview', icon: Eye, run: fire }
        : null;

  // §6.5 order: Preview · Put on a screen · Duplicate · Adapt to screen
  // size · Export template · ─── · delete. Contextual sports lane sits
  // with the other "where does this go" actions.
  const menuItems: OverflowItem[] = [];
  // Preview is only worth a menu row when it isn't already the primary
  // button — otherwise the menu just repeats the button beside it.
  if (fire && primary?.label !== 'Preview') menuItems.push({ key: 'preview', label: 'Preview', icon: Eye, onSelect: fire });
  if (onPutOnScreen && !isViewerDisabled) {
    menuItems.push({
      key: 'put-on-screen',
      label: putOnScreenBusy ? 'Opening publish…' : 'Put on a screen',
      icon: MonitorPlay,
      onSelect: onPutOnScreen,
      disabled: putOnScreenBusy,
    });
  }
  if (isSportsGameCard && onUseForGame && !isViewerDisabled) {
    menuItems.push({ key: 'use-for-game', label: 'Use for a game', icon: Trophy, onSelect: onUseForGame });
  }
  if (onDuplicate && !isViewerDisabled) menuItems.push({ key: 'duplicate', label: 'Duplicate', icon: Copy, onSelect: onDuplicate });
  if (onAdaptForLED && !isViewerDisabled) {
    menuItems.push({ key: 'adapt', label: 'Adapt to screen size', icon: Settings2, onSelect: onAdaptForLED });
  }
  if (onExport && !isViewerDisabled) menuItems.push({ key: 'export', label: 'Export template', icon: Download, onSelect: onExport });
  if (onDelete && !isViewerDisabled) {
    // §11.1 asks for "Move to trash". We do NOT say that: there is no
    // Trash, no retention window and no restore behind this call (§11.4
    // names that gap explicitly). Promising recoverable deletion we can't
    // honor would be the single most expensive lie on this page, so the
    // label states what the button actually does. The confirmation copy
    // in page.tsx matches.
    menuItems.push({ key: 'delete', label: 'Delete template', icon: Trash2, onSelect: onDelete, destructive: true });
  }

  // §10.5 — a saved layout with nothing in it has no artwork to show.
  // Preserve the card's dimensions and say so plainly, rather than
  // rendering an empty rectangle that reads as a loading bug.
  const previewUnavailable = zones.length === 0;

  return (
    // NO `overflow-hidden` on this root. It is tempting — the artwork
    // needs clipping to get the card's rounded top corners — but the
    // three-dot menu is an absolutely-positioned child of this card, and
    // a clipping root CUTS THE MENU OFF at the card's bottom edge. In the
    // 2026-08-31 verification pass that hid "Export template" and "Delete
    // template" entirely: the operator could see the menu open and simply
    // could not reach half of it. The clip belongs on the preview band
    // (which is the only thing that needs it), never here.
    <div className="group flex flex-col rounded-xl border border-slate-200 bg-white transition-shadow duration-200 hover:border-slate-300 hover:shadow-md motion-reduce:transition-none">
      {/* ── Preview (§6.2) ──────────────────────────────────────────────
          A real button, not a div with a click handler: Enter and Space
          work for free, the focus ring is the browser's own, and screen
          readers announce "Preview of Club Welcome template, button".
          CSS shorthand (`background`) is FORBIDDEN inside — mixing it
          with `backgroundImage` triggers React's style-diffing warning.
          ScaledTemplateThumbnail already uses only longhand. */}
      <button
        type="button"
        onClick={fire}
        disabled={!fire}
        aria-label={fire ? `Preview of ${template.name} template` : undefined}
        className={`relative flex h-[168px] w-full items-center justify-center overflow-hidden rounded-t-xl border-b border-slate-100 bg-slate-100 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
          fire ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        {previewUnavailable ? (
          <span className="flex flex-col items-center gap-1.5 text-slate-500">
            <ImageIcon className="h-6 w-6" aria-hidden />
            <span className="text-[11px] font-semibold">Preview unavailable</span>
          </span>
        ) : (
          <ScaledTemplateThumbnail
            zones={zones as any}
            screenWidth={sw}
            screenHeight={sh}
            bgImage={template.bgImage}
            bgGradient={template.bgGradient}
            bgColor={template.bgColor}
            maxHeight={168}
            // §19 "artwork-first cards" — a comfortably-landscape board runs
            // edge to edge (the band clips the few spare pixels), and the
            // card's own border is the only frame. A portrait or extreme LED
            // canvas keeps fit-inside so its SHAPE stays legible: cropping a
            // 9:16 totem into a letterbox strip would hide exactly the thing
            // the operator is scanning for.
            fill={sw / sh >= 1.5}
            flush
            // Gallery GRID: a thumbnail is a still frame (§6.2). EXTERNAL_HTML
            // boards resolve to their static poster PNG (no document at all),
            // and zone templates render with their keyframes stopped — so a
            // hundred tiles cost a hundred images, not a hundred animations.
            freeze
          />
        )}

        {/* §7.1 — PRESET badge inside the preview, on system templates only.
            §7.3: one badge, never a stack. */}
        {template.isSystem && (
          <span className="pointer-events-none absolute top-2.5 right-2.5 rounded-md bg-white/95 px-1.5 py-0.5 text-[9px] font-bold tracking-wider text-slate-600 shadow-sm ring-1 ring-slate-900/5">
            PRESET
          </span>
        )}

        {/* §6.2 — a restrained hover treatment with a small affordance.
            Reduced motion turns the fade off rather than animating it. */}
        {fire && (
          <>
            <span className="pointer-events-none absolute top-0 right-0 bottom-0 left-0 bg-slate-900/0 transition-colors duration-200 group-hover:bg-slate-900/[0.06] motion-reduce:transition-none" aria-hidden />
            <span
              className="pointer-events-none absolute bottom-2.5 left-2.5 flex items-center gap-1 rounded-md bg-slate-900/80 px-2 py-1 text-[10px] font-bold text-white opacity-0 shadow transition-opacity duration-200 group-hover:opacity-100 motion-reduce:transition-none"
              aria-hidden="true"
            >
              <Eye className="h-3 w-3" /> Preview
            </span>
          </>
        )}
      </button>

      {/* ── Meta + the one primary action ─────────────────────────────── */}
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div className="flex items-start gap-1.5">
          <h3 className="min-w-0 flex-1 truncate text-[14px] font-bold text-slate-800" title={template.name}>
            {template.name}
          </h3>
          <TemplateOverflowMenu items={menuItems} label={`More actions for ${template.name}`} />
        </div>

        {/* §6.1 items 4-6 — usage, playlist reach, last edited. Renders
            nothing at all when the server can't prove usage.
            `needsAttention` is INDEPENDENT of usage: a layout with no
            content is broken whether or not the usage endpoint answered,
            so it must not be gated behind that request. */}
        {(usage || needsAttention) && (
          <TemplateUsagePill state={usage ?? { kind: 'unknown' }} needsAttention={needsAttention} />
        )}

        {!template.isSystem && (() => {
          const edited = lastEditedLabel(template.updatedAt);
          return edited ? <p className="text-[11px] text-slate-500">{edited}</p> : null;
        })()}

        {/* §7.1 item 4 — a preset states its category and canvas instead of
            usage, because a preset has neither playlists nor screens. */}
        {template.isSystem && (
          <p className="truncate text-[11px] text-slate-500" title={`${template.category} · ${sw}×${sh}`}>
            {categoryLabel || categoryDisplayName(template.category)} · {sw}×{sh}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="inline-flex items-center gap-1 truncate text-[11px] font-medium text-slate-500">
              <Monitor className="h-3 w-3 shrink-0 text-slate-400" aria-hidden />
              {canvasBadgeLabel(template)}
            </span>
            {isBranded && (
              <span
                className="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-emerald-700"
                title="This template uses your brand kit colors"
              >
                Branded
              </span>
            )}
          </span>
          <div className="ml-auto flex items-center gap-1">
          {onDelete && !isViewerDisabled && (
            // 2026-09-14 (Greg): "let me delete the templates without having
            // to click edit — a trash can somewhere on each". The menu row
            // stays; this is the shortcut, on the same confirm + usage-impact
            // path. Owned cards only: presets and viewers never get onDelete.
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              aria-label={`Delete ${template.name}`}
              title="Delete template"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-rose-500 motion-reduce:transition-none"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          )}
          {primary && (
            <button
              type="button"
              onClick={primary.run}
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3.5 py-1.5 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-500 motion-reduce:transition-none"
              style={{
                borderColor: 'var(--brand-primary, #4f46e5)',
                color: 'var(--brand-primary, #4f46e5)',
              }}
            >
              <primary.icon className="h-3.5 w-3.5" />
              {primary.label}
            </button>
          )}
          </div>
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
  // IMAGERY wave (2026-06-28) — the one-tap "Make it an AI photo" upgrade.
  const regenerateImage = useRegenerateBoardImage();
  const [aiPhotoError, setAiPhotoError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Swap the board background for a freshly AI-generated, on-brand photo. Uses
  // the board name/description as the photo subject. On AI_IMAGE_UNAVAILABLE
  // (Anthropic / no image provider) we surface the friendly add-a-key message;
  // the board keeps its current background.
  async function makeAiPhoto() {
    setAiPhotoError(null);
    const subject = (tName || tDesc || 'a clean, modern background photo for this signage board').trim();
    try {
      const res = await regenerateImage.mutateAsync({
        id: template.id,
        prompt: `A photorealistic, text-free background photo for a digital signage board: ${subject}. Cinematic lighting, an unbusy area for the headline, no words or logos.`.slice(0, 1000),
      });
      if (res?.bgImage) {
        setBgImage(res.bgImage);
        setBgGradient('');
        setIsDirty(true);
        setSaveStatus('idle');
      }
    } catch (e: any) {
      const code = e?.code || e?.data?.code;
      setAiPhotoError(
        code === 'AI_IMAGE_UNAVAILABLE'
          ? 'AI photos need an OpenAI or Google key — add one in Settings → AI provider.'
          : (e?.message || 'Could not generate a photo. Try again.'),
      );
    }
  }

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
                  {/* IMAGERY wave (2026-06-28) — one-tap "Make it an AI photo". */}
                  <button
                    onClick={makeAiPhoto}
                    disabled={regenerateImage.isPending}
                    title="Generate an on-brand AI photo for this board's background"
                    className="mt-2 w-full py-2 text-[11px] font-bold rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white shadow-sm disabled:opacity-60 flex items-center justify-center gap-1.5"
                  >
                    {regenerateImage.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    {regenerateImage.isPending ? 'Generating photo…' : 'Make it an AI photo'}
                  </button>
                  {aiPhotoError && (
                    <p className="text-[9px] text-red-500 mt-1 leading-snug">{aiPhotoError}</p>
                  )}
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

  // MOBILE BUG #215 (2026-07-01) — hide the mobile bottom tab bar while this
  // full-screen asset browser is open. The modal is already z-[9999] (above
  // the tab bar's z-[60]) but per use-overlay-lock.ts a raw z-index isn't
  // reliably sufficient on iOS Safari once the dashboard's ancestor stacking
  // contexts are in play — this is belt-and-suspenders + consistency with
  // every other overlay in the app.
  useOverlayLock(showModal);

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
                // 2026-05-30 — EGRESS FIX: 40px preview tile → use 80px transform
                <img src={transformedImageUrl(assetUrl(a), { width: 80, quality: 60 })} alt={a.originalName} className="w-10 h-10 object-cover rounded-md bg-slate-100" />
              ) : isVideo(a) ? (
                // 2026-05-30 — EGRESS FIX: preload="none" for tiny 40px preview tiles
                <video src={assetUrl(a)} className="w-10 h-10 object-cover rounded-md bg-slate-100" muted preload="none" />
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

      {/* Full-screen asset browser modal. top/right/bottom/left longhand
          (not inset-0) + safe-area padding so the footer's Use Selected /
          Done button clears the notch / home indicator on a phone
          (mobile bug #215, 2026-07-01). */}
      {showModal && createPortal(
        <div
          className="fixed top-0 right-0 bottom-0 left-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          style={{
            paddingTop: 'max(16px, env(safe-area-inset-top, 0px))',
            paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))',
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowModal(false); }}>
          <div className="bg-white dark:bg-slate-900 w-full max-w-5xl h-[85vh] max-h-full rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col overflow-hidden">
            
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
                            // 2026-05-30 — EGRESS FIX: 320px transform for grid tiles
                            <img src={transformedImageUrl(assetUrl(a), { width: 320, quality: 60 })} alt={a.originalName} className="w-full h-full object-cover" loading="lazy" />
                          ) : isVideo(a) ? (
                            // 2026-05-30 — EGRESS FIX: preload="none", hover-load
                            <video src={assetUrl(a)} className="w-full h-full object-cover" muted preload="none"
                              onMouseEnter={(e) => { const v = e.target as HTMLVideoElement; if (v.readyState === 0) { v.preload = 'metadata'; v.load(); } v.play().catch(() => {}); }}
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
                            // 2026-05-30 — EGRESS FIX: 96px transform for list-view 48px tiles
                            <img src={transformedImageUrl(assetUrl(a), { width: 96, quality: 60 })} alt={a.originalName} className="w-full h-full object-cover" loading="lazy" />
                          ) : isVideo(a) ? (
                            // 2026-05-30 — EGRESS FIX: preload="none" for list-view tiles
                            <video src={assetUrl(a)} className="w-full h-full object-cover" muted preload="none" />
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
        <div className="fixed top-0 right-0 bottom-0 left-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm p-8"
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
  // Which date control the COUNTDOWN branch draws. Coarse pointer (phone /
  // tablet) keeps the NATIVE input — the OS wheel is the right control there.
  // Read once, lazily; declared here, above every early return, so the hook
  // order is fixed whatever widget type this zone is.
  const [coarsePointer] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches,
  );

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
        {coarsePointer ? (
          <input id="tmpl-countdown-date" type="date" aria-label="Target date" value={config.targetDate || ''} onChange={e => setConfig({ targetDate: e.target.value })} className={inputClass + " min-h-[44px]"} />
        ) : (
          <DateField id="tmpl-countdown-date" value={config.targetDate || ''} onChange={v => setConfig({ targetDate: v })} ariaLabel="Target date" placeholder="Target date" />
        )}
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
    // 2026-09-12 — this used to be a lone "Social media embed URL" box
    // writing `config.embedUrl`, which NOTHING has ever read. Instagram and
    // Facebook posts need an OAuth connection the API holds (chosen once in
    // Apps → Instagram / Facebook Page); what belongs here is how it LOOKS.
    return (
      <div className="space-y-3 pt-2 border-t border-slate-100">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Social Posts</label>
        <select
          value={config.layout === 'single' ? 'single' : 'grid'}
          onChange={e => setConfig({ layout: e.target.value })}
          className={inputClass}
        >
          <option value="grid">Grid of posts</option>
          <option value="single">One at a time (rotating)</option>
        </select>
        <input
          type="number" min={1} max={12}
          value={config.maxItems || 6}
          onChange={e => setConfig({ maxItems: Math.max(1, Math.min(12, parseInt(e.target.value) || 6)) })}
          className={inputClass}
        />
        <span className="text-[10px] text-slate-400">How many posts to show (1–12)</span>
        {!config.connectionId && (
          <p className="text-[10px] text-slate-500 leading-snug">
            No account connected yet — add this from the Apps tab to connect Instagram or a Facebook Page.
          </p>
        )}
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
function ApplyBrandButton({ disabled, className }: { disabled: boolean; className?: string }) {
  const branding = useTenantBranding();
  const apply = useApplyBrandToTemplates();
  const tenantCopy = useTenantCopy();
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
        title={!hasBrand ? 'Configure your brand kit first (Brand tab in any template builder)' : disabled ? 'Read-only — viewer role' : `Re-skin every template with your ${tenantCopy.orgSingular.toLowerCase()} brand`}
        className={`px-4 py-3 bg-gradient-to-r from-pink-500 to-violet-500 text-white font-bold text-sm rounded-xl shadow-lg hover:shadow-xl hover:scale-105 max-md:hover:scale-100 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${className ?? ''}`}
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
              Re-skins every <strong>custom</strong> template you own with your {tenantCopy.orgSingular.toLowerCase()}&apos;s brand colors, fonts, and ink color. System presets are left alone.
            </p>

            {/* Brand palette preview */}
            {branding.data?.palette && (
              <div className="flex items-center gap-1.5">
                {(['primary', 'primaryHover', 'accent', 'ink', 'surface', 'surfaceAlt'] as const).map((k) => {
                  const v = branding.data?.palette?.[k];
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
