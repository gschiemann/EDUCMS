"use client";

import { useId, useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { MediaSourcePicker } from './MediaSourcePicker';
import WALL_CLOCK_FIELDS from '@/lib/wall-clock-fields.json';
import { AlignLeft, AlignCenter, AlignRight, AlignStartVertical, AlignEndVertical, AlignVerticalJustifyCenter, ChevronDown, ChevronRight, X as XIcon, Tv, ExternalLink, RefreshCw, GripVertical, Hand, Globe, Play, Layers, ShieldAlert, Volume2, Webhook, Bell, Sparkles, Link2, Unlink, Eye, EyeOff, RotateCcw} from 'lucide-react';
import type { TouchActionConfig } from './types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS as DndCSS } from '@dnd-kit/utilities';
import { useBuilderStore } from './useBuilderStore';
import { widgetLabel } from './constants';
import { transformedImageUrl } from '@/lib/asset-image';
import { ALL_V2_WIDGETS } from '@/components/widgets/v2/registry';
// 2026-05-26 — exported map of CTS celebration cue id → human label.
// Used by the SCOREBOARD case below to render the cue-deck reference
// in the orchestrator's Properties editor.
import { CTS_CUE_LABELS as CTS_CUE_LABELS_LOCAL } from '@/components/widgets/sports/CtsRibbonWidgets';
import {
  ctsFieldsByGroup,
  ctsFieldLabel,
  defaultCtsField,
  ctsFieldEligible,
  deriveCtsField,
} from '@/components/widgets/sports/cts-fields';
import { useAssets, usePlaylists, useTemplates, useTemplateBackdrops, useGames } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api-client';
import { filterRelevantTemplates } from '@/lib/template-relevance';
import { useCustomData } from '@/lib/data/use-custom-data';
import { ColorPickerField } from '@/components/ui/color-picker';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import { THEMED_WIDGET_FIELDS } from './themed-widget-defaults';
import { AiGenerateButton } from '@/components/ai/AiGenerateButton';
import { InlineRewriteChips } from '@/components/ai/InlineRewriteChips';
import { ChatToEditBox } from '@/components/ai/ChatToEditBox';
// Wave B / editor-crush B1/B6b (2026-07-02) — "Stock photos" tab + "Generate
// with AI" inside the asset picker (both were previously stranded: the
// Pexels service had zero operator-facing picker, and AI image-gen only
// mounted on /assets — see docs/research/2026-07-01-launch-sprint/
// 05-EDITOR-CRUSH-LENSES.md elements-assets P0/P2).
import { StockPhotoSearch } from '@/components/assets/StockPhotoSearch';
import { AiImageGenerateButton } from '@/components/ai/AiImageGenerateButton';
// Wave B / editor-crush B2/B5 (2026-07-02) — SHAPE + ICON element editors.
import { SHAPE_KINDS } from '@/components/widgets/ShapeWidget';
import { searchIconNames, isValidIconName } from '@/components/widgets/IconWidget';
import { DynamicIcon } from 'lucide-react/dynamic';
// 2026-05-03 — Time formatting helpers. The BellScheduleEditor uses
// the native `<input type="time">` picker (so the operator gets the
// browser's familiar AM/PM toggle and HH:MM typing). We read existing
// stored values through `to24Hour()` so legacy "8:30 AM" data still
// loads into the picker, and write back the picker's HH:MM value as-is.
// Widget renderers convert to 12-hour at display time via
// `formatTime12()` (lib/format-time.ts) so the canvas always speaks
// 12-hour regardless of how the data was stored.
import { to24Hour } from '@/lib/format-time';

// MS pack DEFAULTS registry. Every MS widget exports its `DEFAULTS`
// keyed by dot-notation field paths (e.g. `school.eye`, `agenda.0.t`).
// The generic MS_* case in the switch below auto-generates one
// editable form field per key, so all 16 MS templates (8 landscape +
// 8 portrait) have a working editor without a 16-case-deep wall of
// hand-written switch boilerplate.
import { DEFAULTS as MS_ARCADE_DEFAULTS } from '@/components/widgets/ms/MsArcadeWidget';
import { DEFAULTS as MS_ATLAS_DEFAULTS } from '@/components/widgets/ms/MsAtlasWidget';
import { DEFAULTS as MS_FIELDNOTES_DEFAULTS } from '@/components/widgets/ms/MsFieldnotesWidget';
import { DEFAULTS as MS_GREENHOUSE_DEFAULTS } from '@/components/widgets/ms/MsGreenhouseWidget';
import { DEFAULTS as MS_HOMEROOM_DEFAULTS } from '@/components/widgets/ms/MsHomeroomWidget';
import { DEFAULTS as MS_PAPER_DEFAULTS } from '@/components/widgets/ms/MsPaperWidget';
import { DEFAULTS as MS_PLAYLIST_DEFAULTS } from '@/components/widgets/ms/MsPlaylistWidget';
import { DEFAULTS as MS_STUDIO_DEFAULTS } from '@/components/widgets/ms/MsStudioWidget';
import { DEFAULTS as MS_ARCADE_PORTRAIT_DEFAULTS } from '@/components/widgets/ms/MsArcadePortraitWidget';
import { DEFAULTS as MS_ATLAS_PORTRAIT_DEFAULTS } from '@/components/widgets/ms/MsAtlasPortraitWidget';
import { DEFAULTS as MS_FIELDNOTES_PORTRAIT_DEFAULTS } from '@/components/widgets/ms/MsFieldnotesPortraitWidget';
import { DEFAULTS as MS_GREENHOUSE_PORTRAIT_DEFAULTS } from '@/components/widgets/ms/MsGreenhousePortraitWidget';
import { DEFAULTS as MS_HOMEROOM_PORTRAIT_DEFAULTS } from '@/components/widgets/ms/MsHomeroomPortraitWidget';
import { DEFAULTS as MS_PAPER_PORTRAIT_DEFAULTS } from '@/components/widgets/ms/MsPaperPortraitWidget';
import { DEFAULTS as MS_PLAYLIST_PORTRAIT_DEFAULTS } from '@/components/widgets/ms/MsPlaylistPortraitWidget';
import { DEFAULTS as MS_STUDIO_PORTRAIT_DEFAULTS } from '@/components/widgets/ms/MsStudioPortraitWidget';
// Themed fitness scene DEFAULTS — same auto-form pattern as MS pack.
// 14 themed scenes ported from scratch/design/fitness/01-15.html (one
// drop-zone per template). The auto-form generator at the default-case
// in `fields` reads these dot-keyed records and emits one editable
// field per key, grouped by dot-prefix. Adding a new fitness scene =
// new file + new import + new MS_DEFAULTS_BY_TYPE entry below.
import { DEFAULTS as FITNESS_STADIUM_DEFAULTS } from '@/components/widgets/fitness/FitnessStadiumWidget';
import { DEFAULTS as FITNESS_IRON_DEFAULTS } from '@/components/widgets/fitness/FitnessIronWidget';
import { DEFAULTS as FITNESS_MARQUEE_DEFAULTS } from '@/components/widgets/fitness/FitnessMarqueeWidget';
import { DEFAULTS as FITNESS_CHANNEL_GUIDE_DEFAULTS } from '@/components/widgets/fitness/FitnessChannelGuideWidget';
import { DEFAULTS as FITNESS_DISCOTHEQUE_DEFAULTS } from '@/components/widgets/fitness/FitnessDiscothequeWidget';
import { DEFAULTS as FITNESS_LOCKER_DEFAULTS } from '@/components/widgets/fitness/FitnessLockerWidget';
import { DEFAULTS as FITNESS_SPLASH_DEFAULTS } from '@/components/widgets/fitness/FitnessSplashWidget';
import { DEFAULTS as FITNESS_TELEMETRY_DEFAULTS } from '@/components/widgets/fitness/FitnessTelemetryWidget';
import { DEFAULTS as FITNESS_CRAG_DEFAULTS } from '@/components/widgets/fitness/FitnessCragWidget';
import { DEFAULTS as FITNESS_CORNERMAN_DEFAULTS } from '@/components/widgets/fitness/FitnessCornermanWidget';
import { DEFAULTS as FITNESS_RECESS_DEFAULTS } from '@/components/widgets/fitness/FitnessRecessWidget';
import { DEFAULTS as FITNESS_REFORMER_DEFAULTS } from '@/components/widgets/fitness/FitnessReformerWidget';
import { DEFAULTS as FITNESS_TRAILHEAD_DEFAULTS } from '@/components/widgets/fitness/FitnessTrailheadWidget';
import { DEFAULTS as FITNESS_VAULT_DEFAULTS } from '@/components/widgets/fitness/FitnessVaultWidget';
import { DEFAULTS as FITNESS_LOBBY_DEFAULTS } from '@/components/widgets/fitness/FitnessLobbyWidget';
// 2026-05-07 — HS portrait DEFAULTS for the auto-form generator.
// Demo audit (docs/research/HS_TEMPLATES_AUDIT_2026_05_07.md) found
// that all 8 HS portrait widgets had NO PropertiesPanel coverage —
// operator selecting a portrait HS template saw an empty editor
// because PropertiesPanel.tsx fell through every case to return
// null. Fix: import each portrait's DEFAULTS and key them off the
// HS_*_PORTRAIT widget type so the existing default-case
// auto-form generator catches them. Mirrors MS pattern exactly.
// Landscape variants ship hand-written cases below (HS_VARSITY,
// HS_BROADCAST, etc.) and don't need this map entry — but adding
// them for completeness so duplicate clones land cleanly.
import { DEFAULTS as HS_VARSITY_PORTRAIT_DEFAULTS } from '@/components/widgets/hs/HsVarsityPortraitWidget';
import { DEFAULTS as HS_BROADCAST_PORTRAIT_DEFAULTS } from '@/components/widgets/hs/HsBroadcastPortraitWidget';
import { DEFAULTS as HS_YEARBOOK_PORTRAIT_DEFAULTS } from '@/components/widgets/hs/HsYearbookPortraitWidget';
import { DEFAULTS as HS_TERMINAL_PORTRAIT_DEFAULTS } from '@/components/widgets/hs/HsTerminalPortraitWidget';
import { DEFAULTS as HS_TRANSIT_PORTRAIT_DEFAULTS } from '@/components/widgets/hs/HsTransitPortraitWidget';
import { DEFAULTS as HS_GALLERY_PORTRAIT_DEFAULTS } from '@/components/widgets/hs/HsGalleryPortraitWidget';
import { DEFAULTS as HS_BLUEPRINT_PORTRAIT_DEFAULTS } from '@/components/widgets/hs/HsBlueprintPortraitWidget';
import { DEFAULTS as HS_ZINE_PORTRAIT_DEFAULTS } from '@/components/widgets/hs/HsZinePortraitWidget';
// 2026-05-07 — Landscape DEFAULTS imports for placeholder text in
// hand-written HS_* cases. Operator pointed out the side-panel
// inputs are blank when no value is saved yet, so users can't tell
// which field corresponds to which canvas region. Showing the
// default value as a grey HTML placeholder fixes that — user sees
// "WHS" / "MORNING ASSEMBLY · DAILY BRIEF" / "8:57 PM" greyed out
// and just types to override. Starting with HS_BLUEPRINT only;
// other 7 landscape widgets follow in sibling commits.
import { DEFAULTS as HS_BLUEPRINT_DEFAULTS } from '@/components/widgets/hs/HsBlueprintWidget';
import { DEFAULTS as HS_VARSITY_DEFAULTS } from '@/components/widgets/hs/HsVarsityWidget';
import { DEFAULTS as HS_BROADCAST_DEFAULTS } from '@/components/widgets/hs/HsBroadcastWidget';
import { DEFAULTS as HS_YEARBOOK_DEFAULTS } from '@/components/widgets/hs/HsYearbookWidget';
import { DEFAULTS as HS_TERMINAL_DEFAULTS } from '@/components/widgets/hs/HsTerminalWidget';
import { DEFAULTS as HS_TRANSIT_DEFAULTS } from '@/components/widgets/hs/HsTransitWidget';
import { DEFAULTS as HS_GALLERY_DEFAULTS } from '@/components/widgets/hs/HsGalleryWidget';
import { DEFAULTS as HS_ZINE_DEFAULTS } from '@/components/widgets/hs/HsZineWidget';
// 2026-05-07 — US timezone options for the clock-timezone SelectField.
// Replaces the plain text 'Time' / 'Date' inputs in HS landscape
// editors so operators get a dropdown instead of a free-text field.
import { US_TIMEZONE_OPTIONS } from '@/components/widgets/hs/useHsLiveClock';
import { SIGNAGE_TEMPLATES, SELECTABLE_SIGNAGE_TEMPLATES } from '@/components/widgets/signage-templates';
// 2026-05-07 — Holiday lobby pack static field schema. Each variant +
// grade combo (18 total) has a hand-extracted [data-field] schema so
// PropertiesPanel can render editable TextFields synchronously when an
// operator selects a HOLIDAY zone — no race with the iframe-bridge
// holiday:ready postMessage. Iframe schema event still fires (kept for
// click-to-scroll behavior) but is no longer load-bearing for
// rendering. See feat(holiday) commit for extraction.
import {
  holidayFieldSchemaFor,
  getHolidayLiveFields,
  type HolidayVariant,
  type HolidayGradeLevel,
} from '@/components/widgets/HolidayWidget';
import { mergeHolidayTextStyleMaps } from '@/components/widgets/holiday-style-contract';

// v2 widget pack — lookup by the kebab variant id stored in
// `cfg.variant` (e.g. 'cel-football-touchdown', 'scoreboard-hs').
// The generic v2 editor in ContentFields' default case reads the
// matched widget's `defaults` to build a content + style form, so
// celebration / scoreboard / industry widgets are fully editable.
const V2_BY_VARIANT_ID: Record<string, { defaults?: Record<string, unknown> }> =
  Object.fromEntries(
    ALL_V2_WIDGETS.map((w) => [w.type.toLowerCase().replace(/_/g, '-'), w]),
  );

// Curated font choices for the v2 brand-style editor. Every stack here
// renders without loading an external font (system-safe), so picking
// one never leaves the operator with a silent fallback.
const V2_FONT_OPTIONS: [string, string][] = [
  ['', 'Theme default'],
  ["'Inter', system-ui, sans-serif", 'Inter'],
  ['system-ui, sans-serif', 'System sans'],
  ["Georgia, 'Times New Roman', serif", 'Georgia (serif)'],
  ["'Arial Black', Arial, sans-serif", 'Arial Black (heavy)'],
  ["Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif", 'Impact (condensed)'],
  ["'Trebuchet MS', Verdana, sans-serif", 'Trebuchet'],
  ['Tahoma, Geneva, Verdana, sans-serif', 'Tahoma'],
  ["'Courier New', monospace", 'Monospace'],
];

// Font-weight choices for the v2 brand-style editor. Values are the
// numeric weights resolveStyle() feeds straight into `font-weight`.
const V2_WEIGHT_OPTIONS: [string, string][] = [
  ['', 'Theme default'],
  ['300', 'Light'],
  ['400', 'Regular'],
  ['500', 'Medium'],
  ['600', 'Semibold'],
  ['700', 'Bold'],
  ['800', 'Extrabold'],
  ['900', 'Black'],
];

// Gradient washes for the v2 background editor. Plain CSS gradient
// strings — frameStyle() drops them straight into `background-image`
// when no bgImage is set. Pre-baked so a non-technical operator picks
// a look instead of hand-writing CSS.
const V2_GRADIENT_OPTIONS: [string, string][] = [
  ['', 'None'],
  ['linear-gradient(135deg, #1e3a8a, #312e81)', 'Midnight blue'],
  ['linear-gradient(135deg, #7f1d1d, #450a0a)', 'Deep crimson'],
  ['linear-gradient(135deg, #064e3b, #022c22)', 'Forest green'],
  ['linear-gradient(135deg, #4c1d95, #1e1b4b)', 'Royal purple'],
  ['linear-gradient(135deg, #0f172a, #1e293b)', 'Slate night'],
  ['linear-gradient(135deg, #b45309, #7c2d12)', 'Amber heat'],
  ['radial-gradient(circle at 50% 0%, #475569, #0f172a)', 'Spotlight'],
];

/**
 * v2 widget pack — the "Style" section (colors + type + background).
 *
 * 2026-08-03 (§19 launch blocker) — this used to live INLINE in the
 * ContentFields `default:` case, which meant it only ever rendered for
 * v2 widgets whose canonical widget type has NO hand-built switch case
 * (celebrations, charts, healthcare, corporate, …). The 70 v2 variants
 * that map onto a canonical type WITH a hand-built case — CLOCK,
 * ANNOUNCEMENT, CALENDAR, STAFF_SPOTLIGHT, COUNTDOWN, LOGO, WEATHER,
 * BELL_SCHEDULE, TEXT, TICKER, IMAGE, RICH_TEXT, LUNCH_MENU — `break`
 * out of the switch long before `default:`, so they reached the panel
 * with CONTENT fields only. The operator could retype the words and
 * change nothing else: no font, no size, no color, no background. That
 * is an F against the §19 editability standard.
 *
 * Hoisting it into this helper lets ContentFields append the section
 * AFTER the switch for EVERY zone whose `cfg.variant` resolves to a v2
 * widget, hand-built case or not. Every v2 widget funnels `config.style`
 * through `resolveStyle()` + `frameStyle()` (verified: all 8 packs call
 * both), so these controls take effect live on the canvas AND on the
 * player.
 */
function buildV2StyleFields(
  cfg: Record<string, any>,
  setField: (patch: Record<string, any>) => void,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const SHv2 = (k: string, label: string) => (
    <div
      key={`shv2-${k}`}
      className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200"
    >
      {label}
    </div>
  );
  const st: Record<string, unknown> =
    cfg.style && typeof cfg.style === 'object' ? cfg.style : {};
  // Patch the style object. An empty value DELETES the key so the
  // widget falls back to its designed default instead of being
  // pinned to '' (which would paint a blank background / no font).
  const setStyle = (patch: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...st };
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v == null) delete next[k];
      else next[k] = v;
    }
    setField({ style: next });
  };
  out.push(SHv2('style', 'Colors — match your brand'));
  out.push(
    <ColorPickerField
      key="v2-bg"
      label="Background color"
      value={String(st.bgColor || '')}
      onChange={(v) => setStyle({ bgColor: v })}
    />,
  );
  out.push(
    <ColorPickerField
      key="v2-text"
      label="Text color"
      value={String(st.textColor || '')}
      onChange={(v) => setStyle({ textColor: v })}
    />,
  );
  out.push(
    <ColorPickerField
      key="v2-accent"
      label="Accent color"
      value={String(st.accentColor || '')}
      onChange={(v) => setStyle({ accentColor: v })}
    />,
  );
  // Highlight / glow — celebration widgets paint the neon glow on
  // their hero text + numbers with this; without the control the
  // most prominent part of a celebration can't be rebranded.
  out.push(
    <ColorPickerField
      key="v2-highlight"
      label="Highlight / glow"
      value={String(st.highlightColor || '')}
      onChange={(v) => setStyle({ highlightColor: v })}
    />,
  );
  out.push(
    <ColorPickerField
      key="v2-accent2"
      label="Secondary accent"
      value={String(st.accentColor2 || '')}
      onChange={(v) => setStyle({ accentColor2: v })}
    />,
  );
  out.push(SHv2('typography', 'Type'));
  out.push(
    <SelectField
      key="v2-font"
      label="Font"
      value={String(st.fontFamily || '')}
      options={V2_FONT_OPTIONS}
      onChange={(v) => setStyle({ fontFamily: v })}
    />,
  );
  out.push(
    <SelectField
      key="v2-weight"
      label="Font weight"
      value={st.fontWeight != null ? String(st.fontWeight) : ''}
      options={V2_WEIGHT_OPTIONS}
      onChange={(v) => setStyle({ fontWeight: v === '' ? '' : Number(v) })}
    />,
  );
  // Text alignment — `frameStyle()` writes `textAlign` onto the widget
  // frame, so every v2 widget honors it. §19 requires alignment.
  out.push(
    <SelectField
      key="v2-align"
      label="Text alignment"
      value={String(st.textAlign || '')}
      options={[
        ['', 'Theme default'],
        ['left', 'Left'],
        ['center', 'Center'],
        ['right', 'Right'],
        ['justify', 'Justify'],
      ]}
      onChange={(v) => setStyle({ textAlign: v })}
    />,
  );
  // Background — swap the whole backdrop for an uploaded image or
  // a one-click gradient wash. frameStyle() prefers bgImage over
  // bgGradient over the solid bgColor above.
  out.push(SHv2('v2bg', 'Background'));
  out.push(
    <AssetPickerField
      key="v2-bgimage"
      label="Background image"
      kind="image"
      value={String(st.bgImage || '')}
      onChange={(v) => setStyle({ bgImage: v })}
    />,
  );
  out.push(
    <SelectField
      key="v2-bggradient"
      label="Gradient wash"
      value={String(st.bgGradient || '')}
      options={V2_GRADIENT_OPTIONS}
      onChange={(v) => setStyle({ bgGradient: v })}
    />,
  );
  return out;
}

const MS_DEFAULTS_BY_TYPE: Record<string, Record<string, string>> = {
  MS_ARCADE: MS_ARCADE_DEFAULTS as any,
  MS_ATLAS: MS_ATLAS_DEFAULTS as any,
  MS_FIELDNOTES: MS_FIELDNOTES_DEFAULTS as any,
  MS_GREENHOUSE: MS_GREENHOUSE_DEFAULTS as any,
  MS_HOMEROOM: MS_HOMEROOM_DEFAULTS as any,
  MS_PAPER: MS_PAPER_DEFAULTS as any,
  MS_PLAYLIST: MS_PLAYLIST_DEFAULTS as any,
  MS_STUDIO: MS_STUDIO_DEFAULTS as any,
  MS_ARCADE_PORTRAIT: MS_ARCADE_PORTRAIT_DEFAULTS as any,
  MS_ATLAS_PORTRAIT: MS_ATLAS_PORTRAIT_DEFAULTS as any,
  MS_FIELDNOTES_PORTRAIT: MS_FIELDNOTES_PORTRAIT_DEFAULTS as any,
  MS_GREENHOUSE_PORTRAIT: MS_GREENHOUSE_PORTRAIT_DEFAULTS as any,
  MS_HOMEROOM_PORTRAIT: MS_HOMEROOM_PORTRAIT_DEFAULTS as any,
  MS_PAPER_PORTRAIT: MS_PAPER_PORTRAIT_DEFAULTS as any,
  MS_PLAYLIST_PORTRAIT: MS_PLAYLIST_PORTRAIT_DEFAULTS as any,
  MS_STUDIO_PORTRAIT: MS_STUDIO_PORTRAIT_DEFAULTS as any,
  // Fitness 4K themed scenes — same dot-keyed auto-form generator
  // handles the editor for these. All 15 mockups from
  // scratch/design/fitness/ ship here as drop-in widgets.
  FITNESS_STADIUM:        FITNESS_STADIUM_DEFAULTS as any,
  FITNESS_IRON:           FITNESS_IRON_DEFAULTS as any,
  FITNESS_MARQUEE:        FITNESS_MARQUEE_DEFAULTS as any,
  FITNESS_CHANNEL_GUIDE:  FITNESS_CHANNEL_GUIDE_DEFAULTS as any,
  FITNESS_DISCOTHEQUE:    FITNESS_DISCOTHEQUE_DEFAULTS as any,
  FITNESS_LOCKER:         FITNESS_LOCKER_DEFAULTS as any,
  FITNESS_SPLASH:         FITNESS_SPLASH_DEFAULTS as any,
  FITNESS_TELEMETRY:      FITNESS_TELEMETRY_DEFAULTS as any,
  FITNESS_CRAG:           FITNESS_CRAG_DEFAULTS as any,
  FITNESS_CORNERMAN:      FITNESS_CORNERMAN_DEFAULTS as any,
  FITNESS_RECESS:         FITNESS_RECESS_DEFAULTS as any,
  FITNESS_REFORMER:       FITNESS_REFORMER_DEFAULTS as any,
  FITNESS_TRAILHEAD:      FITNESS_TRAILHEAD_DEFAULTS as any,
  FITNESS_VAULT:          FITNESS_VAULT_DEFAULTS as any,
  FITNESS_LOBBY:          FITNESS_LOBBY_DEFAULTS as any,
  // 2026-05-07 — HS portrait pack. Each portrait widget renders
  // through the existing dot-keyed auto-form generator at the
  // default-case (~line 2860). No HS_*_PORTRAIT case exists below,
  // so this map is the ONLY way the operator gets a sidebar editor
  // for these 8 widgets. Without these entries, selecting an HS
  // portrait template shows an empty right panel — the bug the
  // pre-demo audit flagged as the #1 most-visible regression.
  HS_VARSITY_PORTRAIT:    HS_VARSITY_PORTRAIT_DEFAULTS as any,
  HS_BROADCAST_PORTRAIT:  HS_BROADCAST_PORTRAIT_DEFAULTS as any,
  HS_YEARBOOK_PORTRAIT:   HS_YEARBOOK_PORTRAIT_DEFAULTS as any,
  HS_TERMINAL_PORTRAIT:   HS_TERMINAL_PORTRAIT_DEFAULTS as any,
  HS_TRANSIT_PORTRAIT:    HS_TRANSIT_PORTRAIT_DEFAULTS as any,
  HS_GALLERY_PORTRAIT:    HS_GALLERY_PORTRAIT_DEFAULTS as any,
  HS_BLUEPRINT_PORTRAIT:  HS_BLUEPRINT_PORTRAIT_DEFAULTS as any,
  HS_ZINE_PORTRAIT:       HS_ZINE_PORTRAIT_DEFAULTS as any,
};

type BellPeriod = { label: string; start: string; end?: string };

const DEFAULT_BELL_PERIODS: BellPeriod[] = [
  { label: 'Period 1', start: '8:00', end: '8:50' },
  { label: 'Period 2', start: '8:55', end: '9:45' },
  { label: 'Period 3', start: '9:50', end: '10:40' },
  { label: 'Lunch', start: '10:45', end: '11:15' },
  { label: 'Period 4', start: '11:20', end: '12:10' },
  { label: 'Period 5', start: '12:15', end: '1:05' },
  { label: 'Period 6', start: '1:10', end: '2:00' },
];

function parseBellLine(line: string): BellPeriod {
  const [labelPart, restPart = ''] = line.split(':');
  const [start = '', end = ''] = restPart.split('-').map((part) => part.trim());
  return {
    label: labelPart?.trim() || 'Period',
    start,
    end: end || undefined,
  };
}

function bellScheduleForEditor(value: unknown): BellPeriod[] {
  if (Array.isArray(value) && value.length) {
    // 2026-05-03 — accept BOTH the legacy schedule shape
    // ({ label, start, end }) AND the v2 periods shape
    // ({ num, label, startTime, endTime, room }). Without this branch,
    // a zone whose only data lives under cfg.periods (v2-shaped)
    // loaded into the editor with empty time inputs.
    return value.map((p, idx) => {
      const obj = (p && typeof p === 'object') ? (p as any) : {};
      return {
        label: String(obj.label || `Period ${idx + 1}`),
        start: String(obj.start ?? obj.startTime ?? ''),
        end: (obj.end ?? obj.endTime) ? String(obj.end ?? obj.endTime) : undefined,
      };
    });
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split('\n').filter(Boolean).map(parseBellLine);
  }
  return DEFAULT_BELL_PERIODS.map((p) => ({ ...p }));
}

function tickerTextForEditor(cfg: any): string {
  if (Array.isArray(cfg.messages) && cfg.messages.length) return cfg.messages.join('\n');
  return typeof cfg.text === 'string' ? cfg.text : '';
}

// Field-key → human-readable label. The MS-pack widgets use developer-
// style dotted keys like `agenda.0.t` and `clock.time` because the
// templates are auto-generated from HTML mockups; without a friendly
// label the form reads like an API spec ("Agenda 0 T" / "Clock Time")
// which is nonsense to a teacher. The map below covers every term that
// shows up in the MS-pack DEFAULTS — "Period 1 · Subject" instead of
// "Agenda 0 T", "Day of Week" instead of "Day Dow", "Bell Schedule"
// instead of "Bell V". Add to this map when new templates land.
const LEAF_LABELS: Record<string, string> = {
  // Time / date
  t: 'Subject', r: 'Room', xp: 'Reward / XP', p: 'Period', c: 'Class',
  v: 'Value', k: 'Label', av: 'Avatar', x: 'Extra',
  time: 'Time', date: 'Date', day: 'Day', dow: 'Day of Week',
  letter: 'Cycle Day Letter', label: 'Label', sub: 'Subtitle',
  // Common content fields
  name: 'Name', title: 'Title', headline: 'Headline', subtitle: 'Subtitle',
  message: 'Message', body: 'Message', tag: 'Tag', tagline: 'Tagline',
  num: 'Number', emoji: 'Emoji', icon: 'Icon', image: 'Image',
  // Weather
  temp: 'Temperature', cond: 'Condition', sky: 'Sky', high: 'High',
  low: 'Low', desc: 'Description',
  // Logos / branding
  logo: 'Logo', team: 'Team', house: 'House', year: 'Year',
  // Counts / stats
  pct: 'Percent', value: 'Value', volume: 'Volume',
  // Misc widget-specific
  hi: 'High', who: 'Who', note: 'Note', meta: 'Meta',
  art: 'Cover Art', album: 'Album', artist: 'Artist',
  next: 'Up Next', prev: 'Previous', stop: 'Stop', station: 'Station',
  m: 'Time', st: 'Status', rt: 'Route',
  big: 'Headline', top: 'Top', flag: 'Flag',
  greeting: 'Greeting', school: 'School',
};

const SECTION_LABELS: Record<string, string> = {
  brand: 'Brand & Identity',
  school: 'School Identity',
  greeting: 'Greeting',
  hero: 'Hero',
  agenda: 'Today\'s Schedule',
  bell: 'Bell Schedule',
  cycle: 'Cycle Day',
  clock: 'Time & Date',
  weather: 'Weather',
  weather2: 'Weather (secondary)',
  countdown: 'Countdown',
  birthday: 'Birthdays',
  birthdays: 'Birthdays',
  shoutouts: 'Shout-outs',
  shoutout: 'Shout-out',
  leaderboard: 'Leaderboard',
  loot: 'Side Quests',
  newsbar: 'News Bar',
  ticker: 'Ticker',
  announcement: 'Announcement',
  meta: 'Header Meta',
  banner: 'Banner',
  routes: 'Transit Routes',
  lines: 'Transit Lines',
  device: 'Display Device',
  cover: 'Cover',
  queue: 'Up-Next Queue',
  charts: 'Top Charts',
  stats: 'Stats',
  alert: 'Alert',
  lunch: 'Lunch',
  buses: 'Buses',
  clubs: 'Clubs',
  edition: 'Edition',
  day: 'Day',
  date: 'Date',
  profile: 'Profile',
  segment: 'Segment',
  segments: 'Segments',
  studio: 'Studio',
  fieldnotes: 'Field Notes',
  greenhouse: 'Greenhouse',
  homeroom: 'Homeroom',
  paper: 'Paper',
  playlist: 'Playlist',
  arcade: 'Arcade',
  atlas: 'Atlas',
  general: 'General',
  _root: 'General',
  // CYCLE-5 editor-section-labels fix — fitness scenes (15 widgets) were
  // exposing dot-prefixes like `lf`, `mq`, `header`, `tutorial`, etc. as
  // raw uppercase tokens (LF / Mq) in the auto-form's section headers.
  // Added the most-common prefixes from FitnessIron / FitnessReformer /
  // FitnessLockerWidget / FitnessMarquee / FitnessChannelGuide /
  // FitnessTelemetry / FitnessLobby / etc. Easy to extend when new
  // fitness scenes ship. (Duplicates of existing entries above — hero,
  // next, routes, stats, ticker, banner — intentionally omitted.)
  head: 'Header',
  header: 'Header',
  body: 'Body',
  foot: 'Footer',
  lf: 'Live feed',
  mq: 'Marquee',
  marquee: 'Marquee',
  tutorial: 'Tutorial',
  timer: 'Timer',
  deadlift: 'Deadlift',
  reformers: 'Reformers',
  scorebug: 'Scorebug',
  roster: 'Roster',
  zones: 'Zones',
  lanes: 'Lanes',
  flow: 'Flow',
  promo: 'Promo',
  log: 'Activity log',
  rec: 'Recommendations',
  feature: 'Feature',
  greet: 'Greeting',
  service: 'Service',
  tv: 'TV channel',
  live: 'Live',
  nowplaying: 'Now playing',
  play: 'Playback',
  ch: 'Channel',
  leader: 'Leaderboard',
  lb: 'Leaderboard',
  ksched: 'Class schedule',
  sched: 'Schedule',
  round: 'Round',
  weigh: 'Weigh-in',
  vs: 'Versus',
  meet: 'Meet',
  event: 'Event',
  setter: 'Setter',
  sign: 'Sign',
  slot: 'Slot',
  strap: 'Strap',
  strip: 'Strip',
  rules: 'Rules',
  runs: 'Runs',
  reset: 'Reset',
  exit: 'Exit',
  valet: 'Valet',
  cond: 'Conditions',
  cta: 'Call to action',
  found: 'Lost & Found',
  instr: 'Instructions',
  news: 'News',
  ath: 'Athlete',
  left: 'Left',
  right: 'Right',
  top: 'Top',
  in: 'Indoors',
  screen: 'Screen',
  mod: 'Module',
};

/**
 * ── Is this packaged-board `data-field` really a PHOTO SLOT? ──────────
 *
 * Operator, 2026-08-25: *"when i select the image background of this
 * template it takes me to a free text field and not a new background
 * picker option."* They were on the fitness Soundfloor board, section
 * PROGRAM, field "Program · Image" — an empty single-line input where a
 * photo belongs. Every `[data-field]` a board declares renders as text,
 * because only `data-imgslot`/`data-img`/`data-slot` reach the image lane.
 *
 * TWO SIGNALS, AND THEY MUST AGREE — key tokens ALONE are catastrophic
 * here. A sweep of all 273 packaged boards found 178 `data-field` keys
 * carrying an image-ish token; 110 of them are `hero.eyebrow` /
 * `hero.deck` / `hero.lede` … where "hero" names the SECTION, not a
 * photo, and 27 are `theme.bg` holding a hex colour. Firing on the key
 * would have turned a third of the copy on every board into a photo
 * picker.
 *
 * So:
 *   1. THE LEAF decides, not the whole key. `hero.photo_url` → leaf
 *      `photo_url` ✓; `hero.eyebrow` → leaf `eyebrow` ✗. That one rule
 *      kills the entire `hero.*` false-positive class.
 *   2. THE VALUE has to agree. Empty (a photo slot the board paints in
 *      CSS) or an actual image reference — a URL, a path, an image file
 *      extension, a `data:image/…` URI. Anything with whitespace is
 *      prose and stays a text box, which is what keeps `program.posterUrl`
 *      ("MOBILITY / 042" — a caption wearing a URL-shaped key) and
 *      `foot.cover` ("None tonight") editable as words.
 *
 * Against the shipped boards this fires on exactly 6 fields — the two
 * `program.image` photo panels and the four `*.photo_url` bindings on the
 * hospitality flagship — and on zero text fields.
 *
 * VIDEO IS DELIBERATELY NOT HANDLED. The same sweep found ZERO video-ish
 * orphan `data-field`s, so a `kind="video"` branch would be a costume: no
 * board would exercise it, and dropping a video URL into a text node
 * paints the URL on the glass. Real `<video>` sources already declare
 * `data-videoslot` and get a proper picker.
 */
const IMAGEISH_LEAF_TOKENS = new Set([
  'image', 'images', 'img', 'photo', 'photos', 'picture', 'pic',
  'bg', 'background', 'logo', 'poster', 'hero',
  'thumb', 'thumbnail', 'avatar', 'headshot', 'artwork',
]);
const IMAGE_FILE_RE = /\.(jpe?g|png|webp|avif|gif|svg)(\?|#|$)/i;

/** Split a leaf into words: `photo_url` / `posterUrl` / `bg-image` → tokens. */
function leafTokens(leaf: string): string[] {
  return leaf
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/**
 * True when the field's CURRENT value reads as an image reference — or is
 * empty, which is how a board declares "the photo goes here" (the slot is
 * painted from CSS). A value containing whitespace is prose, full stop.
 */
function valueLooksLikeImage(value: string): boolean {
  const v = (value || '').trim();
  if (!v) return true;                       // empty slot — nothing to lose
  if (/^data:image\//i.test(v)) return true;
  if (/\s/.test(v)) return false;            // prose can never be a URL
  if (IMAGE_FILE_RE.test(v)) return true;
  return /^(https?:\/\/|\/)/i.test(v);       // absolute URL or site-root path
}

/**
 * Should this `data-field` render an asset picker instead of a text box?
 * BOTH signals must agree — see the note above for why either alone is a
 * regression.
 */
function isImageishField(key: string, currentValue: string): boolean {
  const parts = key.split('.');
  const leaf = parts[parts.length - 1] || '';
  if (!leafTokens(leaf).some((t) => IMAGEISH_LEAF_TOKENS.has(t))) return false;
  return valueLooksLikeImage(currentValue);
}

function prettyFieldLabel(key: string): string {
  // Detect numbered list patterns like `agenda.0.t` → "Period 1 · Subject"
  // so teachers see human language instead of array indexes.
  const parts = key.split('.');
  if (parts.length >= 2) {
    // Find the first numeric segment — that's the list index
    const numIdx = parts.findIndex((p) => /^\d+$/.test(p));
    if (numIdx >= 0) {
      const groupKey = parts.slice(0, numIdx).join('.');
      const groupLabel = SECTION_LABELS[parts[0]] || prettyTitle(parts[0]);
      const itemNumber = parseInt(parts[numIdx], 10) + 1;
      const leafKey = parts.slice(numIdx + 1).join('.');
      const leafLabel = LEAF_LABELS[leafKey] || (leafKey ? prettyTitle(leafKey) : '');
      const itemNoun = guessItemNoun(parts[0]);
      return leafLabel
        ? `${itemNoun} ${itemNumber} · ${leafLabel}`
        : `${itemNoun} ${itemNumber}`;
    }
  }
  // Fall through to leaf-or-segment lookup. e.g. "weather.temp" → "Weather · Temperature"
  const leaf = parts[parts.length - 1];
  const sectionLabel = parts.length > 1 ? (SECTION_LABELS[parts[0]] || prettyTitle(parts[0])) : '';
  const leafLabel = LEAF_LABELS[leaf] || prettyTitle(leaf);
  return sectionLabel ? `${sectionLabel} · ${leafLabel}` : leafLabel;
}

function prettySectionLabel(prefix: string): string {
  if (!prefix) return 'General';
  return SECTION_LABELS[prefix] || prettyTitle(prefix);
}

function prettyTitle(s: string): string {
  if (!s) return '';
  if (s.length <= 2) return s.toUpperCase();
  // camelCase / snake_case → Title Case
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function guessItemNoun(prefix: string): string {
  const map: Record<string, string> = {
    agenda: 'Period',
    bell: 'Period',
    cycle: 'Block',
    leaderboard: 'Rank',
    loot: 'Side Quest',
    routes: 'Route',
    lines: 'Line',
    queue: 'Track',
    charts: 'Chart',
    shoutouts: 'Shout-out',
    birthdays: 'Birthday',
    buses: 'Bus',
    clubs: 'Club',
    segments: 'Segment',
    stats: 'Stat',
    alerts: 'Alert',
    schedule: 'Period',
  };
  return map[prefix] || `${prettyTitle(prefix)}`;
}

export function PropertiesPanel() {
  // Atomic selectors — the old `const { zones, selectedIds, updateZone,
  // meta } = useBuilderStore()` subscribed this component (1000+ lines,
  // 60+ form fields) to the ENTIRE store. Every keystroke in any input
  // called updateZone, which mutated zones, which re-rendered the whole
  // panel + BuilderCanvas + LayersPanel. Typing felt laggy. With atomic
  // selectors Zustand only re-renders when the specific slice changes.
  // Action refs (updateZone) are stable (created once in create()) so
  // they never trigger re-renders.
  const zones = useBuilderStore((s) => s.zones);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const updateZone = useBuilderStore((s) => s.updateZone);
  const meta = useBuilderStore((s) => s.meta);
  const nameId = useId();

  // 2026-05-15 — operator: "we dont have a way to resize template
  // content based on pixels, you just have other measurements".
  // Zone width/height are STORED as % of canvas (so they scale with
  // resolution at playback time — non-negotiable). But the operator
  // wants to TYPE pixel values. UI-only toggle: when 'px', fields
  // show derived px values; onChange converts back to %. Stored
  // model is unchanged, render-at-playback math is unchanged.
  const [posUnit, setPosUnit] = useState<'%' | 'px'>('%');

  // Hotspot listener — when the AnimatedWelcomeWidget dispatches an
  // 'aw-edit-section' CustomEvent (user clicked a region in the
  // preview), scroll the matching section header to the top of its
  // scroll container + pulse pink. Retries up to 1.5s because the
  // zone selection re-renders the panel with new fields and the
  // target won't exist immediately.
  //
  // Walks up to find the actual scrollable ancestor (overflow auto/scroll
  // with vertical overflow) instead of relying on scrollIntoView, which
  // sometimes hits the wrong container in nested transformed layouts.
  useEffect(() => {
    const findScrollParent = (node: HTMLElement | null): HTMLElement | null => {
      let cur = node?.parentElement;
      while (cur) {
        const cs = window.getComputedStyle(cur);
        const oy = cs.overflowY;
        if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight) return cur;
        cur = cur.parentElement;
      }
      return document.scrollingElement as HTMLElement | null;
    };
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { section?: string } | undefined;
      const key = detail?.section;
      if (!key) return;
      let attempts = 0;
      const tryScroll = () => {
        const el = document.getElementById(`aw-section-${key}`);
        if (el) {
          const scroller = findScrollParent(el);
          if (scroller) {
            const elRect = el.getBoundingClientRect();
            const scRect = scroller.getBoundingClientRect();
            // Position the section ~16px below the scroller's top edge
            scroller.scrollTo({
              top: scroller.scrollTop + (elRect.top - scRect.top) - 16,
              behavior: 'smooth',
            });
          } else {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          el.classList.add('aw-section-flash');
          setTimeout(() => el.classList.remove('aw-section-flash'), 1400);
          return;
        }
        if (++attempts < 30) setTimeout(tryScroll, 50); // ≤1.5s total
      };
      tryScroll();
    };
    window.addEventListener('aw-edit-section', handler);

    // GENERIC handler for every widget — when BuilderZone fires
    // 'template-edit-field' (operator clicked any [data-field] hotspot
    // on the canvas), find the matching section in this panel and
    // scroll to it. Sections opt in by carrying
    // `data-field-section="<key>"` on a wrapper div.
    //
    // Falls back gracefully: if no section matches the field, no scroll
    // happens — the inline edit on the canvas still works. This means
    // adding new widgets doesn't require panel refactoring up-front.
    const fieldHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { fieldKey?: string; sectionKey?: string } | undefined;
      const candidates = [detail?.fieldKey, detail?.sectionKey].filter(Boolean) as string[];
      if (candidates.length === 0) return;
      let attempts = 0;
      const tryScroll = () => {
        let el: HTMLElement | null = null;
        for (const key of candidates) {
          el = document.querySelector(`[data-field-section="${CSS.escape(key)}"]`) as HTMLElement | null;
          if (el) break;
        }
        if (el) {
          const scroller = findScrollParent(el);
          if (scroller) {
            const elRect = el.getBoundingClientRect();
            const scRect = scroller.getBoundingClientRect();
            scroller.scrollTo({
              top: scroller.scrollTop + (elRect.top - scRect.top) - 16,
              behavior: 'smooth',
            });
          } else {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
          // PERSISTENT selection state (was a 1.4s flash). Clear any
          // previously-selected section first so only one is "current"
          // at a time, then mark this one. Operator gets a sticky
          // visual confirmation of which panel field corresponds to
          // their clicked hotspot — Canva's pattern.
          document.querySelectorAll('[data-field-section].is-active-section').forEach((n) => {
            n.classList.remove('is-active-section');
          });
          el.classList.add('is-active-section');
          // Brief flash on top of the persistent state — feels like a
          // "snap to" animation when the panel locks onto the new section.
          el.classList.add('aw-section-flash');
          setTimeout(() => el?.classList.remove('aw-section-flash'), 1400);
          return;
        }
        if (++attempts < 30) setTimeout(tryScroll, 50);
      };
      tryScroll();
    };
    window.addEventListener('template-edit-field', fieldHandler);

    return () => {
      window.removeEventListener('aw-edit-section', handler);
      window.removeEventListener('template-edit-field', fieldHandler);
    };
  }, []);

  const xId = useId();
  const yId = useId();
  const wId = useId();
  const hId = useId();
  const configId = useId();

  if (selectedIds.length === 0) {
    return <TemplateProperties />;
  }

  if (selectedIds.length > 1) {
    return (
      <div className="p-5 text-xs text-slate-500 space-y-4">
        <div className="px-3 py-2 bg-indigo-50/50 text-indigo-700 rounded-lg font-semibold flex items-center gap-2">
           <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
           {selectedIds.length} zones selected
        </div>
        <p className="leading-relaxed opacity-90">Use the alignment buttons below to distribute the selection. Arrow keys nudge everything together (hold <kbd className="px-1 py-0.5 bg-slate-100 rounded text-[10px]">Shift</kbd> for 10&times; steps).</p>
        <MultiZoneChatEdit />
        <MultiAlignButtons />
      </div>
    );
  }

  const zone = zones.find(z => z.id === selectedIds[0]);
  if (!zone) return null;

  const canvasAspect = meta.screenWidth / meta.screenHeight;
  const pixelW = Math.round(zone.width / 100 * meta.screenWidth);
  const pixelH = Math.round(zone.height / 100 * meta.screenHeight);

  function set(patch: Parameters<typeof updateZone>[1]) {
    updateZone(zone!.id, patch, true);
  }

  const configString = zone.defaultConfig ? JSON.stringify(zone.defaultConfig, null, 2) : '';

  return (
    <div className="p-5 space-y-6 text-xs" data-properties-panel="true">
      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Zone</h3>

        <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-500">Type</span>
            <span className="px-2 py-1 bg-white rounded-md shadow-sm border border-slate-100 text-[10px] font-bold text-indigo-600">{widgetLabel(zone.widgetType)}</span>
          </div>

          {/* 2026-05-09 — operator: "what is the layer name for?" Renamed
              to "Name" with explainer so it's obvious it's a label for
              the Layers panel, not anything functional. */}
          <div>
            <label htmlFor={nameId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">
              Name
              <span className="ml-1.5 font-normal text-slate-500">— layer label (rename in the Layers tab)</span>
            </label>
            {/* 2026-05-29 — operator: the layer Name should NOT be editable
                here. It's not content (editing it got confused with the
                team-name field). Read-only display; renaming lives in the
                Layers tab. */}
            <div
              id={nameId}
              className="w-full px-3 py-2 rounded-lg bg-slate-50 border border-slate-200/60 text-xs font-medium text-slate-600 select-none"
            >
              {zone.name}
            </div>
          </div>

          {/* 2026-05-09 — operator: "whats the widget theme for, it does
              nothing". Removed the Widget Theme dropdown — it duplicated
              the Widget Library tile picker (which is visual + previews
              the theme live). The dropdown set defaultConfig.theme blind
              and looked broken on widget types that don't honor a theme
              (VIDEO, IMAGE, WEBPAGE). One way to swap themes now: open
              the Widgets tab and pick a tile. */}
        </div>
      </section>

      <ContentFields zone={zone} updateZone={updateZone} />

      {/* Phase D2.5 — Scene assignment. Lets the operator move this
          zone to a different scene, or mark it "shared" (visible on
          every scene). Only rendered when the template has 2+ scenes;
          single-scene templates don't need the affordance. */}
      <ZoneSceneAssignment zone={zone} updateZone={updateZone} />

      {/* Phase D1 — Tap action editor. Only renders when the template
          has interactivity enabled (Template.isTouchEnabled). Sets
          zone.touchAction which the player runtime honors at tap-time
          via the action dispatcher. Backward-compatible with legacy
          `navigate / show / url` shapes. */}
      <TapActionEditor zone={zone} updateZone={updateZone} />

      {/* Geometry — collapsed by default. Operator can drag-resize on
          the canvas for 99% of cases; this section is for the rare
          "I need this exactly 50% wide" case + the Align buttons.
          Operator: "why do we need the geometry section?" → hidden
          unless they explicitly expand it. */}
      <CollapsibleSection title="Position & size (advanced)" defaultOpen={false}>
        <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm space-y-4">
          <div className="flex justify-end">
            <div className="inline-flex bg-slate-100 rounded-md p-0.5" role="tablist" aria-label="Position & size unit">
              <button
                type="button"
                role="tab"
                aria-selected={posUnit === '%'}
                onClick={() => setPosUnit('%')}
                className={`px-2.5 py-1 text-[10px] font-bold rounded transition-colors ${posUnit === '%' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                %
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={posUnit === 'px'}
                onClick={() => setPosUnit('px')}
                className={`px-2.5 py-1 text-[10px] font-bold rounded transition-colors ${posUnit === 'px' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
              >
                px
              </button>
            </div>
          </div>

          {posUnit === '%' ? (
            <div className="grid grid-cols-2 gap-3">
              <NumField id={xId} label="X (%)" value={zone.x} onChange={(v) => set({ x: v })} min={0} max={100} />
              <NumField id={yId} label="Y (%)" value={zone.y} onChange={(v) => set({ y: v })} min={0} max={100} />
              <NumField id={wId} label="Width (%)" value={zone.width} onChange={(v) => set({ width: v })} min={3} max={100} />
              <NumField id={hId} label="Height (%)" value={zone.height} onChange={(v) => set({ height: v })} min={3} max={100} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <NumField
                id={xId}
                label="X (px)"
                value={Math.round((zone.x / 100) * meta.screenWidth)}
                onChange={(v) => set({ x: meta.screenWidth > 0 ? (v / meta.screenWidth) * 100 : zone.x })}
                min={0}
                max={meta.screenWidth}
              />
              <NumField
                id={yId}
                label="Y (px)"
                value={Math.round((zone.y / 100) * meta.screenHeight)}
                onChange={(v) => set({ y: meta.screenHeight > 0 ? (v / meta.screenHeight) * 100 : zone.y })}
                min={0}
                max={meta.screenHeight}
              />
              <NumField
                id={wId}
                label="Width (px)"
                value={Math.round((zone.width / 100) * meta.screenWidth)}
                onChange={(v) => set({ width: meta.screenWidth > 0 ? (v / meta.screenWidth) * 100 : zone.width })}
                min={Math.max(1, Math.round((3 / 100) * meta.screenWidth))}
                max={meta.screenWidth}
              />
              <NumField
                id={hId}
                label="Height (px)"
                value={Math.round((zone.height / 100) * meta.screenHeight)}
                onChange={(v) => set({ height: meta.screenHeight > 0 ? (v / meta.screenHeight) * 100 : zone.height })}
                min={Math.max(1, Math.round((3 / 100) * meta.screenHeight))}
                max={meta.screenHeight}
              />
            </div>
          )}

          <div className="text-[10px] text-slate-500 font-medium text-center bg-white py-1.5 rounded-md border border-slate-100/50">
            {posUnit === '%'
              ? <>Rendered: ~{pixelW}&times;{pixelH}px at {meta.screenWidth}&times;{meta.screenHeight}</>
              : <>{(zone.width).toFixed(1)}% &times; {(zone.height).toFixed(1)}% of {meta.screenWidth}&times;{meta.screenHeight} canvas</>}
          </div>

          <div className="pt-2 border-t border-slate-200/50 flex justify-center gap-1">
            <IconBtn label="Align left" onClick={() => set({ x: 0 })}><AlignLeft className="w-4 h-4" aria-hidden /></IconBtn>
            <IconBtn label="Center horz" onClick={() => set({ x: (100 - zone.width) / 2 })}><AlignCenter className="w-4 h-4" aria-hidden /></IconBtn>
            <IconBtn label="Align right" onClick={() => set({ x: 100 - zone.width })}><AlignRight className="w-4 h-4" aria-hidden /></IconBtn>
            <div className="w-px h-6 bg-slate-200/60 mx-1.5 self-center" />
            <IconBtn label="Align top" onClick={() => set({ y: 0 })}><AlignStartVertical className="w-4 h-4" aria-hidden /></IconBtn>
            <IconBtn label="Center vert" onClick={() => set({ y: (100 - zone.height) / 2 })}><AlignVerticalJustifyCenter className="w-4 h-4" aria-hidden /></IconBtn>
            <IconBtn label="Align bottom" onClick={() => set({ y: 100 - zone.height })}><AlignEndVertical className="w-4 h-4" aria-hidden /></IconBtn>
          </div>

          <div className="flex gap-2">
            <button type="button"
              onClick={() => set({ x: 0, y: 0, width: 100, height: 100 })}
              className="flex-1 px-2 py-2 text-[10px] rounded-lg bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 font-semibold text-slate-600 transition-all shadow-sm active:scale-95"
            >
              Fill Canvas
            </button>
            <button type="button"
              onClick={() => set({ x: (100 - zone.height * canvasAspect) / 2, y: 0, width: zone.height * canvasAspect, height: 100 })}
              className="flex-1 px-2 py-2 text-[10px] rounded-lg bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 font-semibold text-slate-600 transition-all shadow-sm active:scale-95"
            >
              Fit Height
            </button>
          </div>

          {/* 2026-05-28 (§19) — Rotation + Opacity. Required by the
              editability standard ("rotation, z-index, opacity") and
              previously available ONLY on DECORATION. Stored under
              defaultConfig._zoneRotation / _zoneOpacity (underscore-keyed
              = zone-chrome, kept distinct from widget content config and
              from DECORATION's own cfg.opacity). Both BuilderZone AND the
              player apply these to the zone wrapper as
              `transform: rotate(Ndeg)` + `opacity:N` — Chromium-83-safe
              (transform/opacity predate the Taurus's Chrome 83 by years),
              no `inset`. Verified end-to-end in both renderers. */}
          <div className="pt-2 border-t border-slate-200/50 grid grid-cols-2 gap-3">
            <NumField
              id={`${xId}-rot`}
              label="Rotation (°)"
              value={typeof (zone.defaultConfig as Record<string, unknown> | null | undefined)?._zoneRotation === 'number' ? (zone.defaultConfig as Record<string, number>)._zoneRotation : 0}
              onChange={(v) => {
                const next = ((Number(v) % 360) + 360) % 360; // normalize 0–359
                set({ defaultConfig: { ...(zone.defaultConfig || {}), _zoneRotation: next } });
              }}
              min={0}
              max={359}
              step={1}
            />
            <NumField
              id={`${xId}-opa`}
              label="Opacity (0–1)"
              value={typeof (zone.defaultConfig as Record<string, unknown> | null | undefined)?._zoneOpacity === 'number' ? (zone.defaultConfig as Record<string, number>)._zoneOpacity : 1}
              onChange={(v) => {
                const next = Math.max(0, Math.min(1, Number(v)));
                set({ defaultConfig: { ...(zone.defaultConfig || {}), _zoneOpacity: next } });
              }}
              min={0}
              max={1}
              step={0.05}
            />
          </div>
        </div>
      </CollapsibleSection>

      <AdvancedJson zone={zone} configString={configString} configId={configId} updateZone={updateZone} />
    </div>
  );
}

/**
 * Phase 2 — menu/drink widget types that GENUINELY read a live POS feed
 * (config.posSync → usePosMenuItems). The "Driven by: POS" picker only
 * appears on templates containing one of these, and the per-element POS
 * mapping card only renders for these — so the picker is never a costume
 * on a widget that can't actually sync. (RESTAURANT_MENU_BOARD has synced
 * since the menu-management work; BAR_TAP_LIST + BAR_COCKTAIL_MENU were
 * wired to the same shared hook in this phase.) Extend this set as more
 * boards gain live POS sync.
 */
const POS_LIVE_TYPES = new Set<string>([
  'RESTAURANT_MENU_BOARD',
  'BAR_TAP_LIST',
  'BAR_COCKTAIL_MENU',
  // 2026-05-30 — wired to the same shared usePosMenuItems hook: the
  // specials callout (drives its featured item from posItems[0]) and the
  // combo carousel (maps each POS item → a combo card).
  'RESTAURANT_SPECIALS_CALLOUT',
  'RESTAURANT_COMBO_CAROUSEL',
]);

/**
 * An EXTERNAL_HTML signage board that reads the live POS menu feed — the
 * QSR / menus-pos / bar packs (e.g. the Domino's pizza board). These aren't a
 * fixed widget TYPE (every packaged signage template is EXTERNAL_HTML), so we
 * detect them by an already-set posSync / dataSource flag OR a menu-board url.
 * This lets the SAME top-level "Driven by: POS" picker + auto-map that drives
 * the native RESTAURANT_* widgets also drive the packaged HTML menu boards —
 * no separate per-field wiring (operator 2026-06-01: "use the same UI we
 * built, stop reinventing the wheel").
 */
function isPosCapableZone(z: { widgetType: string; defaultConfig?: Record<string, unknown> | null }): boolean {
  if (POS_LIVE_TYPES.has(z.widgetType)) return true;
  if (z.widgetType === 'EXTERNAL_HTML') {
    const cfg = (z.defaultConfig || {}) as Record<string, unknown>;
    const url = typeof cfg.url === 'string' ? cfg.url : '';
    return cfg.posSync === true || cfg.dataSource === 'POS' || /\/signage\/(qsr|menus-pos|bar)\//.test(url);
  }
  return false;
}

/**
 * Phase 3 — generic widget types that can render rows from an external
 * REST/JSON or Google-Sheet-CSV feed (config.customSync → useCustomData).
 * The "Driven by: Custom data" picker only appears on templates that
 * contain one of these, and the per-element Custom-data mapping card only
 * renders for these — so the picker is never a costume on a widget that
 * can't consume external rows. v1 ships the TICKER widget as the live
 * consumer (it renders a feed column as scrolling items). Extend this set
 * as more generic widgets gain external-row rendering.
 */
const DATA_CONSUMER_TYPES = new Set<string>([
  'TICKER',
]);

function TemplateProperties() {
  // Atomic selectors — see PropertiesPanel above.
  const meta = useBuilderStore((s) => s.meta);
  const setMeta = useBuilderStore((s) => s.setMeta);
  // A2 — same undo keystroke coalescing as TextField/TextAreaField:
  // Name/Description are raw inputs (not the shared component, because
  // they need htmlFor ids), so wire begin/end here directly.
  const beginTransaction = useBuilderStore((s) => s.beginTransaction);
  const endTransaction = useBuilderStore((s) => s.endTransaction);
  const isTouchEnabled = useBuilderStore((s) => s.isTouchEnabled);
  const setTouchEnabled = useBuilderStore((s) => s.setTouchEnabled);
  const zones = useBuilderStore((s) => s.zones);
  const updateZones = useBuilderStore((s) => s.updateZones);
  const nameId = useId();
  const descId = useId();
  const widthId = useId();
  const heightId = useId();
  const posDrivenId = useId();
  const customDrivenId = useId();
  const customUrlId = useId();
  const customFormatId = useId();
  const dataSource = meta.dataSource ?? 'NONE';
  const dataUrl = meta.dataUrl ?? '';
  const dataFormat = meta.dataFormat ?? 'json';
  // The "Driven by" live-data picker (CTS) only belongs on templates that
  // actually contain scoreboard / sport elements — a restaurant or signage
  // template should NOT show a sports CTS picker (operator: "did you add it
  // to all templates or just certain ones?"). Gate on the template content.
  // (Phase 2 adds a POS option, gated on menu elements.)
  const hasSportElements = zones.some((z) => /^(SCOREBOARD|SCORE_|GAME_)/.test(z.widgetType));
  // Phase 2: menu/drink templates get a POS picker instead (gated on the
  // presence of a board that genuinely reads a live POS feed).
  const hasMenuElements = zones.some(isPosCapableZone);
  // POS is "connected" when the template picker says POS OR any POS-capable
  // board already has live sync on. The packaged menu boards ship
  // posSync:true, so the panel reads CONNECTED out of the box instead of
  // depending on meta.dataSource (which a preset may never set).
  const posConnected = dataSource === 'POS'
    || zones.some((z) => isPosCapableZone(z) && !!((z.defaultConfig as Record<string, unknown> | null)?.posSync));
  // Phase 3: generic templates (e.g. a TICKER) get a "Custom data" picker —
  // gated on a widget that can actually render external REST/CSV rows.
  const hasDataConsumers = zones.some((z) => DATA_CONSUMER_TYPES.has(z.widgetType));

  return (
    <div className="p-5 space-y-6 text-xs">
      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Template Info</h3>
        <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm space-y-3">
          <div>
            <label htmlFor={nameId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">Name</label>
            <input
              id={nameId}
              type="text"
              value={meta.name}
              onFocus={beginTransaction}
              onBlur={endTransaction}
              onChange={(e) => setMeta({ name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm inset-shadow-sm"
            />
          </div>
          <div>
            <label htmlFor={descId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">Description</label>
            <textarea
              id={descId}
              rows={2}
              value={meta.description}
              onFocus={beginTransaction}
              onBlur={endTransaction}
              onChange={(e) => setMeta({ description: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm inset-shadow-sm resize-y"
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Canvas Resolution</h3>
        <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm">
          <div className="grid grid-cols-2 gap-3">
            <NumField id={widthId} label="Width (px)" value={meta.screenWidth} onChange={(v) => setMeta({ screenWidth: Math.round(v) })} min={200} max={10000} step={10} />
            <NumField id={heightId} label="Height (px)" value={meta.screenHeight} onChange={(v) => setMeta({ screenHeight: Math.round(v) })} min={200} max={10000} step={10} />
          </div>
        </div>
      </section>

      <CanvasBackdropSection
        bgColor={meta.bgColor || ''}
        bgGradient={meta.bgGradient || ''}
        bgImage={meta.bgImage || ''}
        onChange={(patch) => setMeta(patch)}
      />

      {/* 2026-05-12 (Phase D2.9) — touch mode auto-enables the
          moment the operator drops ANY widget from the Touch palette,
          so the big "Make this template interactive" CTA is now
          mostly redundant. Kept as a small status row + manual
          override (rare: operator wants to disable for testing). */}
      <section className="space-y-2">
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Interactive (touch) mode</h3>
        {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control
            ("A form label must have accessible text"): the checkbox IS
            correctly wrapped, but the visible text sits 2 levels deep
            (label > span.flex-1 > span.block) — past this rule's default
            depth of 2 (see node_modules/eslint-plugin-jsx-a11y/lib/rules/
            label-has-associated-control.js). aria-label on the label
            itself is checked directly, independent of nesting depth. */}
        <label
          aria-label={isTouchEnabled ? 'Touch mode: ON' : 'Touch mode: OFF'}
          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${isTouchEnabled ? 'bg-violet-50/50 border-violet-200' : 'bg-slate-50/50 border-slate-100 hover:border-slate-200'}`}>
          <input
            type="checkbox"
            checked={isTouchEnabled}
            onChange={(e) => setTouchEnabled(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-slate-300 text-violet-600 focus:ring-2 focus:ring-violet-400 shrink-0"
          />
          <span className="flex-1 min-w-0">
            <span className={`block text-[11px] font-bold ${isTouchEnabled ? 'text-violet-800' : 'text-slate-600'}`}>
              {isTouchEnabled ? 'Touch mode: ON' : 'Touch mode: OFF'}
            </span>
            <span className="block text-[10px] text-slate-500 leading-snug">
              Auto-enables when you drop any widget from the <strong>Touch</strong> palette.
            </span>
          </span>
        </label>
      </section>

      {/* ── Phase 1: Field-mapping — template-level "Driven by" picker ──
          Operator model (2026-05-29): "pick the MAIN integration for the
          entire template — default to standard mapping fields — user can
          update per-element if they want a different field."
          Scope: Sports + CTS only. POS/generic (Phase 2/3) not shown here.
          The value lives in meta.dataSource (persisted via BuilderShell
          handleSave → template API). No new DB columns needed — stored as
          part of the existing template payload via (as any) cast. */}
      {hasSportElements && (
      <section className="space-y-2">
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Live data</h3>
        <div style={{
          borderRadius: 10,
          border: '1px solid',
          borderColor: dataSource === 'CTS' ? '#166534' : '#e2e8f0',
          background: dataSource === 'CTS' ? '#052e16' : '#f8fafc',
          padding: '10px 12px',
        }}>
          {/* Status dot + label row */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <span style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: dataSource === 'CTS' ? '#22c55e' : '#94a3b8',
              marginRight: 8,
              flexShrink: 0,
            }} />
            <span style={{
              fontSize: 11,
              fontWeight: 700,
              color: dataSource === 'CTS' ? '#86efac' : '#64748b',
              letterSpacing: 1,
            }}>
              {dataSource === 'CTS' ? 'CTS — LIVE SCORE & CLOCK FEED' : 'NOT CONNECTED'}
            </span>
          </div>

          {/* The picker: "Driven by: [  ]" */}
          <div style={{ marginBottom: dataSource === 'CTS' ? 10 : 0 }}>
            {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control */}
            <label htmlFor="pp-datasource-picker" style={{
              display: 'block',
              fontSize: 10,
              fontWeight: 600,
              color: dataSource === 'CTS' ? '#86efac' : '#64748b',
              marginBottom: 4,
            }}>
              Driven by
            </label>
            <select
              id="pp-datasource-picker"
              value={dataSource}
              onChange={(e) => setMeta({ dataSource: e.target.value as 'NONE' | 'CTS' | 'POS' | 'CUSTOM' })}
              style={{
                width: '100%',
                padding: '6px 8px',
                borderRadius: 6,
                border: '1px solid',
                borderColor: dataSource === 'CTS' ? '#166534' : '#cbd5e1',
                background: dataSource === 'CTS' ? '#14532d' : '#ffffff',
                color: dataSource === 'CTS' ? '#bbf7d0' : '#334155',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                appearance: 'auto',
              }}
            >
              <option value="NONE">Not connected</option>
              <option value="CTS">CTS — live score &amp; clock feed</option>
            </select>
          </div>

          {/* CTS-active: describe what is auto-mapped */}
          {dataSource === 'CTS' && (
            <div style={{
              fontSize: 10,
              color: '#86efac',
              lineHeight: 1.6,
              borderTop: '1px solid #166534',
              paddingTop: 8,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4, color: '#4ade80' }}>Auto-mapped defaults:</div>
              <div>Score elements → home / away score</div>
              <div>Clock element → game clock</div>
              <div>Period element → segment (Q1–Q4, etc.)</div>
              <div>Shot clock → shot clock timer</div>
              <div>Fouls → team foul count</div>
              <div style={{ marginTop: 6, color: '#6ee7b7', fontStyle: 'italic' }}>
                Click any scoreboard element to review or override its mapping.
              </div>
            </div>
          )}
        </div>
      </section>
      )}

      {/* ── Phase 2: Field-mapping — POS "Driven by" picker ──
          Same operator model as Phase 1 (CTS), pointed at the connected
          point-of-sale instead. Only shown on templates with a board that
          GENUINELY reads a live POS feed (POS_LIVE_TYPES). Picking POS
          auto-flips posSync on every such board (the "standard mapping we
          think is correct"); the operator overrides per-board below. */}
      {hasMenuElements && !hasSportElements && (
      <section className="space-y-2">
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Live data</h3>
        <div style={{
          borderRadius: 10,
          border: '1px solid',
          borderColor: posConnected ? '#b45309' : '#e2e8f0',
          background: posConnected ? '#431407' : '#f8fafc',
          padding: '10px 12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: posConnected ? '#f59e0b' : '#94a3b8',
              marginRight: 8, flexShrink: 0,
            }} />
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: posConnected ? '#fcd34d' : '#64748b',
              letterSpacing: 1,
            }}>
              {posConnected ? 'POS — LIVE MENU & PRICES' : 'NOT CONNECTED'}
            </span>
          </div>

          <div style={{ marginBottom: posConnected ? 10 : 0 }}>
            <label htmlFor={posDrivenId} style={{
              display: 'block', fontSize: 10, fontWeight: 600,
              color: posConnected ? '#fcd34d' : '#64748b', marginBottom: 4,
            }}>
              Driven by
            </label>
            <select
              id={posDrivenId}
              value={posConnected ? 'POS' : 'NONE'}
              onChange={(e) => {
                const next = e.target.value === 'POS' ? 'POS' : 'NONE';
                setMeta({ dataSource: next });
                // Auto-map: flip live sync on every POS-capable menu board so
                // the boards immediately read the connected POS. NONE → off.
                // Covers BOTH the native RESTAURANT_* widgets AND the packaged
                // EXTERNAL_HTML menu boards (Domino's etc.) via isPosCapableZone.
                const menuIds = zones.filter(isPosCapableZone).map((z) => z.id);
                if (menuIds.length > 0) {
                  updateZones(
                    menuIds,
                    (z) => ({ defaultConfig: { ...(z.defaultConfig || {}), posSync: next === 'POS' } }),
                    true,
                  );
                }
              }}
              style={{
                width: '100%', padding: '6px 8px', borderRadius: 6,
                border: '1px solid',
                borderColor: posConnected ? '#b45309' : '#cbd5e1',
                background: posConnected ? '#7c2d12' : '#ffffff',
                color: posConnected ? '#fde68a' : '#334155',
                fontSize: 11, fontWeight: 600, cursor: 'pointer', appearance: 'auto',
              }}
            >
              <option value="NONE">Not connected</option>
              <option value="POS">POS — live menu &amp; prices</option>
            </select>
          </div>

          {posConnected && (
            <div style={{
              fontSize: 10, color: '#fcd34d', lineHeight: 1.6,
              borderTop: '1px solid #b45309', paddingTop: 8,
            }}>
              <div style={{ fontWeight: 700, marginBottom: 4, color: '#fbbf24' }}>Auto-mapped defaults:</div>
              <div>Menu &amp; drink boards → live items from your POS</div>
              <div>Item name / price / description / photo → POS fields</div>
              <div>Prices &amp; sold-out items update automatically</div>
              <div style={{ marginTop: 6, color: '#fde68a', fontStyle: 'italic' }}>
                Click any menu board to set its category or override the mapping.
              </div>
            </div>
          )}
        </div>
      </section>
      )}

      {/* ── Phase 3: Field-mapping — "Custom data" (REST/JSON + Google Sheet CSV) ──
          Same operator model as Phase 1 (CTS) + Phase 2 (POS), pointed at a
          generic feed the operator pastes a URL for. Indigo to distinguish
          from CTS (green) + POS (amber). Only shown on templates that contain
          a widget which can actually render external rows (DATA_CONSUMER_TYPES
          — TICKER in v1). Picking "Custom data" + a URL flips customSync on
          every such widget so they immediately read the feed; the operator
          picks which column each one shows below.
          The URL never leaves the browser to a third party directly — the
          widget hook posts it to our SSRF-gated /data-source/fetch proxy. */}
      {hasDataConsumers && !hasSportElements && !hasMenuElements && (
      <section className="space-y-2">
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Live data</h3>
        <div style={{
          borderRadius: 10,
          border: '1px solid',
          borderColor: dataSource === 'CUSTOM' ? '#4338ca' : '#e2e8f0',
          background: dataSource === 'CUSTOM' ? '#1e1b4b' : '#f8fafc',
          padding: '10px 12px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: dataSource === 'CUSTOM' ? '#818cf8' : '#94a3b8',
              marginRight: 8, flexShrink: 0,
            }} />
            <span style={{
              fontSize: 11, fontWeight: 700,
              color: dataSource === 'CUSTOM' ? '#c7d2fe' : '#64748b',
              letterSpacing: 1,
            }}>
              {dataSource === 'CUSTOM' ? 'CUSTOM DATA — LIVE FEED' : 'NOT CONNECTED'}
            </span>
          </div>

          <div style={{ marginBottom: dataSource === 'CUSTOM' ? 10 : 0 }}>
            <label htmlFor={customDrivenId} style={{
              display: 'block', fontSize: 10, fontWeight: 600,
              color: dataSource === 'CUSTOM' ? '#c7d2fe' : '#64748b', marginBottom: 4,
            }}>
              Driven by
            </label>
            <select
              id={customDrivenId}
              value={dataSource === 'CUSTOM' ? 'CUSTOM' : 'NONE'}
              onChange={(e) => {
                const next = e.target.value === 'CUSTOM' ? 'CUSTOM' : 'NONE';
                setMeta({ dataSource: next });
                // Auto-map: flip live sync on every data-consumer widget so
                // they immediately read the custom feed, AND stamp the feed
                // URL + format onto each zone's config. The zone config is
                // what travels to the PLAYER (template meta does not), so the
                // widget must be self-contained — same reason POS lives on
                // the zone (config.posSync), just with a URL too. NONE → off.
                const ids = zones.filter((z) => DATA_CONSUMER_TYPES.has(z.widgetType)).map((z) => z.id);
                if (ids.length > 0) {
                  updateZones(
                    ids,
                    (z) => ({ defaultConfig: {
                      ...(z.defaultConfig || {}),
                      customSync: next === 'CUSTOM',
                      ...(next === 'CUSTOM' ? { customUrl: dataUrl, customFormat: dataFormat } : {}),
                    } }),
                    true,
                  );
                }
              }}
              style={{
                width: '100%', padding: '6px 8px', borderRadius: 6,
                border: '1px solid',
                borderColor: dataSource === 'CUSTOM' ? '#4338ca' : '#cbd5e1',
                background: dataSource === 'CUSTOM' ? '#312e81' : '#ffffff',
                color: dataSource === 'CUSTOM' ? '#e0e7ff' : '#334155',
                fontSize: 11, fontWeight: 600, cursor: 'pointer', appearance: 'auto',
              }}
            >
              <option value="NONE">Not connected</option>
              <option value="CUSTOM">Custom data — REST / Google Sheet</option>
            </select>
          </div>

          {dataSource === 'CUSTOM' && (
            <>
              <div style={{ marginBottom: 10 }}>
                <label htmlFor={customUrlId} style={{
                  display: 'block', fontSize: 10, fontWeight: 600, color: '#c7d2fe', marginBottom: 4,
                }}>
                  Feed URL
                </label>
                <input
                  id={customUrlId}
                  type="url"
                  value={dataUrl}
                  placeholder="https://example.com/feed.json"
                  onChange={(e) => {
                    const url = e.target.value;
                    setMeta({ dataUrl: url });
                    // Keep every consumer zone's stamped URL in sync so the
                    // player render stays self-contained (see picker above).
                    const ids = zones.filter((z) => DATA_CONSUMER_TYPES.has(z.widgetType)).map((z) => z.id);
                    if (ids.length > 0) {
                      updateZones(
                        ids,
                        (z) => ({ defaultConfig: { ...(z.defaultConfig || {}), customUrl: url } }),
                        false,
                      );
                    }
                  }}
                  style={{
                    width: '100%', padding: '6px 8px', boxSizing: 'border-box', borderRadius: 6,
                    border: '1px solid #4338ca', background: '#312e81', color: '#e0e7ff',
                    fontSize: 11, fontWeight: 500,
                  }}
                />
                <span style={{ fontSize: 9, color: '#a5b4fc', display: 'block', marginTop: 3 }}>
                  A public REST/JSON endpoint or a Google Sheet &quot;Publish to web&quot; CSV link.
                </span>
              </div>

              <div style={{ marginBottom: 10 }}>
                <label htmlFor={customFormatId} style={{
                  display: 'block', fontSize: 10, fontWeight: 600, color: '#c7d2fe', marginBottom: 4,
                }}>
                  Format
                </label>
                <select
                  id={customFormatId}
                  value={dataFormat}
                  onChange={(e) => {
                    const fmt = e.target.value === 'csv' ? 'csv' : 'json';
                    setMeta({ dataFormat: fmt });
                    const ids = zones.filter((z) => DATA_CONSUMER_TYPES.has(z.widgetType)).map((z) => z.id);
                    if (ids.length > 0) {
                      updateZones(
                        ids,
                        (z) => ({ defaultConfig: { ...(z.defaultConfig || {}), customFormat: fmt } }),
                        false,
                      );
                    }
                  }}
                  style={{
                    width: '100%', padding: '6px 8px', borderRadius: 6,
                    border: '1px solid #4338ca', background: '#312e81', color: '#e0e7ff',
                    fontSize: 11, fontWeight: 600, cursor: 'pointer', appearance: 'auto',
                  }}
                >
                  <option value="json">JSON (REST API)</option>
                  <option value="csv">CSV (Google Sheet)</option>
                </select>
              </div>

              <div style={{
                fontSize: 10, color: '#c7d2fe', lineHeight: 1.6,
                borderTop: '1px solid #4338ca', paddingTop: 8,
              }}>
                <div style={{ fontWeight: 700, marginBottom: 4, color: '#a5b4fc' }}>Auto-mapped defaults:</div>
                <div>Ticker &amp; list widgets → rows from your feed</div>
                <div>First text column shown unless you pick another</div>
                <div>Refreshes automatically every minute</div>
                <div style={{ marginTop: 6, color: '#a5b4fc', fontStyle: 'italic' }}>
                  Click a ticker to choose which column it shows.
                </div>
              </div>
            </>
          )}
        </div>
      </section>
      )}
    </div>
  );
}

/**
 * CollapsibleSection — disclosure wrapper used to hide advanced-only
 * config behind a click. The Geometry section uses this so operators
 * who never touch x/y/w/h numbers (most of them — drag-resize on canvas
 * handles it) don't see the noise.
 *
 * 2026-05-09 — operator: "why do we need the geometry section?".
 * Answer: power users still want it for "exactly 50% wide" cases and
 * the Align buttons. Compromise: hidden by default, one click to open.
 */
function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1 hover:text-slate-600 transition-colors"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="w-3 h-3" aria-hidden /> : <ChevronRight className="w-3 h-3" aria-hidden />}
        {title}
      </button>
      {open && children}
    </section>
  );
}

function NumField({ id, label, value, onChange, min, max, step = 1 }: {
  id: string; label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
}) {
  // 2026-05-15 — buffered string state so we don't clamp / propagate
  // mid-typing values. Operator reported "typing custom template
  // size crashes the window": clearing the Width field momentarily
  // yields "", parseFloat("") = NaN (guarded), but the next two
  // keystrokes can be "1" and "9" before "1920" lands. Each lands
  // as a real value below `min` (200), forcing the canvas to render
  // at 1px / 9px width while the operator is still typing. Some
  // browsers crash the tab when aspectRatio churns through extreme
  // values that way; even when they don't, the canvas flickers.
  //
  // Fix: keep a local string while the field is focused, and only
  // propagate after blur OR after the user explicitly commits with
  // Enter. On commit we clamp to [min, max] so the canvas never
  // sees an out-of-range value.
  const [draft, setDraft] = useState<string | null>(null);
  const displayed = draft !== null
    ? draft
    : (Number.isFinite(value) ? String(Math.round(value * 100) / 100) : '0');
  const commit = (raw: string) => {
    setDraft(null);
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) return; // keep existing value
    let clamped = parsed;
    if (typeof min === 'number') clamped = Math.max(min, clamped);
    if (typeof max === 'number') clamped = Math.min(max, clamped);
    if (clamped !== value) onChange(clamped);
  };
  // 2026-05-29 — operator: "the up arrows for font size are tiny and barely
  // clickable." The native <input type=number> spinner is ~10px and unusable.
  // Replaced with explicit big −/+ buttons (full-height, 40px wide) flanking
  // the input; the native spinner is hidden via appearance:none.
  const bump = (delta: number) => {
    const base = Number.isFinite(value) ? value : (min ?? 0);
    commit(String(base + delta));
  };
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <div className="flex items-stretch gap-1.5">
        <button
          type="button"
          aria-label={`Decrease ${label}`}
          onClick={() => bump(-step)}
          className="shrink-0 w-10 rounded-lg border border-slate-200/60 bg-white text-slate-600 hover:bg-slate-50 active:bg-slate-200 shadow-sm flex items-center justify-center text-xl font-bold leading-none select-none transition-colors"
        >
          −
        </button>
        <input
          id={id}
          type="number"
          value={displayed}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit((e.target as HTMLInputElement).value);
              (e.target as HTMLInputElement).blur();
            }
          }}
          min={min}
          max={max}
          step={step}
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-[11px] font-mono text-slate-700 text-center focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          type="button"
          aria-label={`Increase ${label}`}
          onClick={() => bump(step)}
          className="shrink-0 w-10 rounded-lg border border-slate-200/60 bg-white text-slate-600 hover:bg-slate-50 active:bg-slate-200 shadow-sm flex items-center justify-center text-xl font-bold leading-none select-none transition-colors"
        >
          +
        </button>
      </div>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="p-2 rounded-lg hover:bg-white text-slate-500 hover:text-indigo-600 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all duration-200 active:scale-90"
    >
      {children}
    </button>
  );
}

// Phase D1 — Tap action editor (touch builder v1).
// Renders inside the zone properties panel only when the parent
// template has `isTouchEnabled = true`. Picks a touch action from
// the 8 v1 primitives + one legacy "url" alias and stores it on
// zone.touchAction. The player runtime (apps/web/src/app/player/
// page.tsx) honors the dispatched action at tap-time.
//
// UX: one-shot dropdown to pick the action TYPE, then a single
// contextual input slot whose label + placeholder change to match.
// Webflow-style "When tap on this zone, do Y" reads top-to-bottom.
// Picker kinds the target field can render. Each maps to a smart
// picker UI instead of a free-text input — addresses the UX agent's
// UX-CRITICAL findings #1 + #2 + #4 (operators don't have UUIDs).
type TargetPicker = 'text' | 'url' | 'scene' | 'template' | 'asset-video' | 'asset-media';

// Smart target picker — renders the right input for the action type:
//   - 'url'         → text input with live `✓ Valid URL` validation
//   - 'scene'       → dropdown of scenes on the CURRENT template
//   - 'template'    → dropdown of templates in the CURRENT tenant
//                     (excluding this one — can't goto-template itself)
//   - 'asset-video' → dropdown of video assets in the asset library
//   - 'asset-media' → dropdown of images + videos in the asset library
//   - 'text'        → plain text input (fallback)
//
// All pickers fall through to a text input when the data source is
// loading or empty, so operators can still hand-type UUIDs in a pinch.
function TapActionTargetPicker({
  kind,
  value,
  onChange,
  placeholder,
}: {
  kind: TargetPicker;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  // Pull data from existing hooks. Each only fires its query when the
  // picker actually needs it — `enabled` keys keep idle pickers from
  // wasting network round trips.
  const scenes = useBuilderStore((s) => (s as any).scenes as Array<{ id: string; name: string }> | undefined) || [];
  const { data: templates } = useTemplates();
  const { data: assets } = useAssets();
  const currentTemplateId = useBuilderStore((s) => s.templateId);
  // "Go to template" only ever fires from a tap on a touch-enabled
  // template — so the sensible default is to offer OTHER touch templates,
  // not the entire catalog of passive display boards (2026-07-01 fix).
  const currentIsTouchEnabled = useBuilderStore((s) => s.isTouchEnabled);
  const [showAllTemplates, setShowAllTemplates] = useState(false);

  if (kind === 'scene') {
    if (!scenes.length) {
      return (
        <>
          <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 mb-1.5">
            No scenes yet — add one in the Scenes panel, then pick it here.
          </div>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="or paste a scene ID…"
            className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </>
      );
    }
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        <option value="">— Pick a scene —</option>
        {scenes.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    );
  }

  if (kind === 'template') {
    const allCustom = (Array.isArray(templates) ? templates : []).filter(
      (t: any) => t.id !== currentTemplateId && !t.isSystem,
    );
    // 2026-07-01 — operator: "the drop down list of templates to choose
    // from is stupid and includes our touch menu's...we should only show
    // options that really work for the sport and for the screen we are
    // selecting it for." A tap action lives inside a touch-enabled
    // template, so "Go to template" should default to OTHER touch
    // templates (a display board isn't a sensible tap destination), not
    // every custom template in the tenant. "Show all" is the escape
    // hatch — nothing is permanently hidden.
    // TODO(lead): confirm the desired default when the CURRENT template is
    // NOT touch-enabled (goto-template action defined before Touch mode is
    // turned on) — today `wantsTouch: false` in that branch, which excludes
    // kiosk templates too. If operators sometimes build a tap action first
    // and flip Touch mode after, this branch may need `wantsTouch: undefined`.
    const list = showAllTemplates
      ? allCustom
      : filterRelevantTemplates(allCustom, { wantsTouch: currentIsTouchEnabled });
    return (
      <>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="">— Pick a template —</option>
          {list.map((t: any) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        {!showAllTemplates && list.length < allCustom.length && (
          <button
            type="button"
            onClick={() => setShowAllTemplates(true)}
            className="mt-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-700 underline underline-offset-2"
          >
            Show all templates ({allCustom.length})
          </button>
        )}
      </>
    );
  }

  if (kind === 'asset-video' || kind === 'asset-media') {
    const list = (Array.isArray(assets) ? assets : []).filter((a: any) => {
      const m = (a.mimeType || '').toLowerCase();
      if (kind === 'asset-video') return m.startsWith('video/');
      return m.startsWith('video/') || m.startsWith('image/');
    });
    return (
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        <option value="">— Pick an asset —</option>
        {list.map((a: any) => (
          <option key={a.id} value={a.id}>
            {(a.originalName || a.fileName || a.id)} {a.mimeType ? `· ${a.mimeType.split('/')[0]}` : ''}
          </option>
        ))}
      </select>
    );
  }

  // 'url' or 'text' → text input with live validation for URLs.
  const trimmed = value.trim();
  const looksLikeUrl = kind === 'url' && trimmed.length > 0;
  let urlState: 'valid' | 'invalid' | null = null;
  if (looksLikeUrl) {
    try {
      const u = new URL(trimmed);
      urlState = u.protocol === 'http:' || u.protocol === 'https:' ? 'valid' : 'invalid';
    } catch {
      urlState = 'invalid';
    }
  }
  return (
    <>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 rounded-lg bg-white border text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
          urlState === 'invalid'
            ? 'border-rose-300 focus:ring-rose-200'
            : urlState === 'valid'
              ? 'border-emerald-300 focus:ring-emerald-200'
              : 'border-slate-200'
        }`}
      />
      {urlState === 'valid' && (
        <p className="text-[10px] text-emerald-700 mt-1">✓ Valid URL</p>
      )}
      {urlState === 'invalid' && (
        <p className="text-[10px] text-rose-700 mt-1">Not a valid http:// or https:// URL</p>
      )}
    </>
  );
}

const ACTION_DEFS: Array<{
  type: TouchActionConfig['type'];
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint: string;
  example?: string;
  targetLabel?: string;
  targetPlaceholder?: string;
  needsTarget: boolean;
  picker: TargetPicker;
}> = [
  { type: 'open-url',         label: 'Open URL',           icon: Globe,        hint: 'Load a webpage in an overlay (or new tab).',                 example: 'e.g. tap a "Library Hours" button to show the library website',
    targetLabel: 'URL',          targetPlaceholder: 'https://example.com',         needsTarget: true,  picker: 'url' },
  { type: 'play-video',       label: 'Play video',         icon: Play,         hint: 'Play an asset, auto-return when it ends.',                   example: 'e.g. tap a poster to play a 30-second tour video',
    targetLabel: 'Video asset',  targetPlaceholder: 'Pick a video…',               needsTarget: true,  picker: 'asset-video' },
  { type: 'goto-scene',       label: 'Go to scene',        icon: Layers,       hint: 'Switch to another scene IN this template (no network call).',example: 'e.g. tap "Check In" to show the visitor sign-in scene',
    targetLabel: 'Scene',        targetPlaceholder: 'Pick a scene…',               needsTarget: true,  picker: 'scene' },
  { type: 'goto-template',    label: 'Go to template',     icon: Layers,       hint: 'Switch to another template entirely.',                       example: 'e.g. tap a building tile to show that building’s directory',
    targetLabel: 'Template',     targetPlaceholder: 'Pick a template…',            needsTarget: true,  picker: 'template' },
  { type: 'show-overlay',     label: 'Show overlay',       icon: ShieldAlert,  hint: 'Modal image/video; tap-outside dismisses.',                  example: 'e.g. tap a thumbnail to enlarge a poster or video clip',
    targetLabel: 'Asset',        targetPlaceholder: 'Pick an image or video…',     needsTarget: true,  picker: 'asset-media' },
  { type: 'reset-idle',       label: 'Reset idle timer',   icon: RefreshCw,    hint: '"Stay on this page" — restarts the auto-return countdown.', example: 'e.g. a "Need more time?" button on a long-form info page',
    needsTarget: false,  picker: 'text' },
  { type: 'sound-toggle',     label: 'Toggle sound',       icon: Volume2,      hint: 'Mute / unmute audio for the current scene.',                 example: 'e.g. an accessibility "🔊 Sound on" / "🔇 Mute" toggle',
    needsTarget: false,  picker: 'text' },
  { type: 'webhook',          label: 'Call webhook',       icon: Webhook,      hint: 'POST to an external URL (POS, booking, etc.).',              example: 'e.g. tap "Order coffee" → POSTs to Square POS',
    targetLabel: 'Webhook URL',  targetPlaceholder: 'https://api.example.com/hook',needsTarget: true,  picker: 'url' },
  { type: 'request-help',     label: 'Request help',       icon: Bell,         hint: 'Sends an in-app notification to admins.',                    example: 'e.g. a "Need a tour guide?" button at the front desk',
    targetLabel: 'Title (optional)', targetPlaceholder: 'Visitor at front desk',   needsTarget: false, picker: 'text' },
];

// Phase D2.5 — Move a zone between scenes (or mark it shared so it
// renders on every scene). Rendered whenever the template has at least
// one real scene — single-scene templates still want a "Shared" toggle
// so the operator can pin a logo / corner UI to "every future scene"
// without first creating a throwaway second scene (Functional audit #6).
function ZoneSceneAssignment({
  zone,
  updateZone,
}: {
  zone: { id: string; sceneId?: string | null };
  updateZone: (id: string, patch: any, commit?: boolean) => void;
}) {
  const scenes = useBuilderStore((s) => s.scenes);
  if (!scenes || scenes.length < 1) return null;
  const value = zone.sceneId ?? '__shared__';
  return (
    <section className="space-y-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Scene</div>
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          updateZone(zone.id, { sceneId: v === '__shared__' ? null : v }, true);
        }}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
      >
        <option value="__shared__">Shared (every scene)</option>
        {scenes.map((s) => (
          <option key={s.id} value={s.id}>{s.name}{s.isDefault ? ' · default' : ''}</option>
        ))}
      </select>
      <p className="text-[10px] text-slate-400">
        Move this widget between scenes, or mark it Shared to keep it visible everywhere.
      </p>
    </section>
  );
}

function TapActionEditor({
  zone,
  updateZone,
}: {
  zone: { id: string; touchAction?: TouchActionConfig | null };
  updateZone: (id: string, patch: any, commit?: boolean) => void;
}) {
  const isTouchEnabled = useBuilderStore((s) => s.isTouchEnabled);
  const setTouchEnabled = useBuilderStore((s) => s.setTouchEnabled);
  // 2026-05-28 — associate the "Do this" label with its <select> so
  // screen readers announce the control AND so it's addressable by
  // accessible name. Previously the label was visually adjacent but
  // not programmatically linked (no htmlFor/id), failing WCAG 1.3.1
  // + 4.1.2 on the single most important control in the touch maker.
  const actionTypeId = useId();

  // Gate: this editor only makes sense for touch-enabled templates.
  // We DON'T hide it entirely though — when isTouchEnabled is off,
  // we render a single CTA that flips the flag, so first-time
  // operators discover the feature instead of needing to find the
  // template-level toggle.
  if (!isTouchEnabled) {
    return (
      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1 flex items-center gap-1.5">
          <Hand className="w-3 h-3" /> Tap action
        </h3>
        <button
          type="button"
          onClick={() => setTouchEnabled(true)}
          className="w-full bg-gradient-to-br from-indigo-50 to-violet-50 rounded-xl p-4 border border-indigo-100 hover:from-indigo-100 hover:to-violet-100 transition-all text-left group"
        >
          <div className="text-[11px] font-bold text-indigo-700 mb-1 flex items-center gap-1.5">
            <Sparkles className="w-3 h-3" /> Make this template interactive
          </div>
          <div className="text-[10px] text-indigo-700/70 leading-relaxed">
            Turn on touch mode to let visitors tap zones — open a URL, play a video, request help, jump to another scene.
          </div>
        </button>
      </section>
    );
  }

  const action: TouchActionConfig | null = (zone.touchAction as TouchActionConfig | null) ?? null;
  const def = action ? ACTION_DEFS.find((d) => d.type === action.type) : null;

  const setAction = (next: TouchActionConfig | null) => {
    updateZone(zone.id, { touchAction: next }, true);
  };

  const onTypeChange = (newType: TouchActionConfig['type']) => {
    const newDef = ACTION_DEFS.find((d) => d.type === newType)!;
    // Carry the old target over only when both types use it.
    const prevTarget = (action as any)?.target || '';
    const next: TouchActionConfig = newDef.needsTarget
      ? ({ type: newType, target: prevTarget } as TouchActionConfig)
      : ({ type: newType } as TouchActionConfig);
    setAction(next);
  };

  return (
    <section className="space-y-3">
      <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1 flex items-center gap-1.5">
        <Hand className="w-3 h-3" /> Tap action
        {action && (
          <span className="ml-1 inline-flex items-center gap-1 text-[9px] font-bold text-emerald-600 normal-case tracking-normal">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            ON
          </span>
        )}
      </h3>
      <div className="bg-indigo-50/40 rounded-xl p-3 border border-indigo-100 space-y-3">
        <div className="text-[11px] text-slate-700 leading-snug">
          When a visitor taps this zone…
        </div>
        <div>
          <label htmlFor={actionTypeId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">
            Do this
          </label>
          <select
            id={actionTypeId}
            aria-label="Tap action — do this when a visitor taps this zone"
            value={action?.type ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) setAction(null);
              else onTypeChange(v as TouchActionConfig['type']);
            }}
            className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <option value="">— No action (display only) —</option>
            {ACTION_DEFS.map((d) => (
              <option key={d.type} value={d.type}>{d.label}</option>
            ))}
          </select>
          {def && (
            <p className="text-[10px] text-slate-500 mt-1.5 leading-snug">{def.hint}</p>
          )}
          {def?.example && (
            <p className="text-[10px] text-slate-400 mt-1 italic leading-snug">{def.example}</p>
          )}
        </div>

        {def?.needsTarget && (
          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">
              {def.targetLabel ?? 'Target'}
            </label>
            {/* Phase D2 — smart pickers for goto-scene / goto-template /
                asset actions. UX review found the v1 free-text UUID
                input was unshippable. Each picker maps to a known
                dropdown source: scenes on the current template,
                templates in the tenant, assets in the asset library. */}
            <TapActionTargetPicker
              kind={def.picker}
              value={(action as any)?.target ?? ''}
              onChange={(v) => setAction({ ...(action as any), target: v } as TouchActionConfig)}
              placeholder={def.targetPlaceholder}
            />
          </div>
        )}

        {/* Per-action extras. Each variant gets its own light editor
            here so we don't proliferate top-level fields the operator
            has to scroll past. */}
        {action?.type === 'open-url' && (
          <label className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={!!(action as any).openInNewTab}
              onChange={(e) => setAction({ ...(action as any), openInNewTab: e.target.checked })}
              className="w-3.5 h-3.5 accent-indigo-500"
            />
            Open in a new browser tab instead of an overlay
          </label>
        )}
        {action?.type === 'play-video' && (
          <label className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={(action as any).returnOnEnd !== false}
              onChange={(e) => setAction({ ...(action as any), returnOnEnd: e.target.checked })}
              className="w-3.5 h-3.5 accent-indigo-500"
            />
            Return to this scene when the video ends
          </label>
        )}
        {action?.type === 'goto-template' && (
          <div>
            {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control.
                action.type gates make these branches mutually exclusive, so a
                static id can't collide with another instance in the DOM. */}
            <label htmlFor="pp-action-transition" className="block text-[10px] font-semibold text-slate-500 mb-1.5">Transition</label>
            <select
              id="pp-action-transition"
              value={(action as any).transition ?? 'cut'}
              onChange={(e) => setAction({ ...(action as any), transition: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="cut">Cut (instant)</option>
              <option value="fade">Fade (smooth)</option>
            </select>
          </div>
        )}
        {action?.type === 'webhook' && (
          <div>
            <label htmlFor="pp-action-webhook-method" className="block text-[10px] font-semibold text-slate-500 mb-1.5">Method</label>
            <select
              id="pp-action-webhook-method"
              value={(action as any).method ?? 'POST'}
              onChange={(e) => setAction({ ...(action as any), method: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="POST">POST (with payload)</option>
              <option value="GET">GET</option>
            </select>
          </div>
        )}
        {action?.type === 'request-help' && (
          <div>
            <label htmlFor="pp-action-request-help-body" className="block text-[10px] font-semibold text-slate-500 mb-1.5">Notification body</label>
            <input
              id="pp-action-request-help-body"
              type="text"
              value={(action as any).body ?? ''}
              onChange={(e) => setAction({ ...(action as any), body: e.target.value })}
              placeholder="What admins should see — e.g. 'Visitor needs assistance at lobby kiosk'"
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        )}
      </div>
    </section>
  );
}

// Slice 2a-multi — chat-to-edit across the WHOLE selection ("make them all
// smaller and use our brand color"). Applies the validated multi-zone diff
// as ONE updateZones transaction → a single undo step for the sentence.
function MultiZoneChatEdit() {
  const zones = useBuilderStore((s) => s.zones);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const updateZones = useBuilderStore((s) => s.updateZones);
  const selected = zones.filter((z) => selectedIds.includes(z.id));
  if (selected.length < 2) return null;
  return (
    <ChatToEditBox
      zones={selected as any}
      onApply={(diff) => {
        const byId = new Map(diff.map((d) => [d.zoneId, d.patch]));
        updateZones(selectedIds, (z: any) => {
          const p = byId.get(z.id);
          if (!p) return {};
          const { defaultConfig: cfgPatch, ...zoneKeys } = p;
          const merged: Record<string, any> = { ...zoneKeys };
          if (cfgPatch) merged.defaultConfig = { ...(z.defaultConfig || {}), ...cfgPatch };
          return merged;
        }, true);
      }}
    />
  );
}

/**
 * A8 — distribute the selection evenly along one axis: the outermost
 * zones stay anchored and the gaps between neighbors equalize (the
 * classic Canva "Space evenly" / tidy-up). Pure + exported for the A8
 * regression spec. Returns a zoneId → new-position map for the axis.
 */
export function distributeEvenly(
  selected: Array<{ id: string; x: number; y: number; width: number; height: number }>,
  axis: 'h' | 'v',
): Record<string, number> {
  const result: Record<string, number> = {};
  if (selected.length < 3) return result;
  const pos = (z: { x: number; y: number }) => (axis === 'h' ? z.x : z.y);
  const size = (z: { width: number; height: number }) => (axis === 'h' ? z.width : z.height);
  const sorted = [...selected].sort((a, b) => pos(a) - pos(b));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const span = (pos(last) + size(last)) - pos(first);
  const sumSizes = sorted.reduce((m, z) => m + size(z), 0);
  const gap = (span - sumSizes) / (sorted.length - 1);
  let cursor = pos(first);
  for (const z of sorted) {
    result[z.id] = cursor;
    cursor += size(z) + gap;
  }
  return result;
}

function MultiAlignButtons() {
  const zones = useBuilderStore((s) => s.zones);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const updateZones = useBuilderStore((s) => s.updateZones);
  const selected = zones.filter(z => selectedIds.includes(z.id));
  if (selected.length < 2) return null;

  const leftMost = Math.min(...selected.map(z => z.x));
  const rightMost = Math.max(...selected.map(z => z.x + z.width));
  const topMost = Math.min(...selected.map(z => z.y));
  const bottomMost = Math.max(...selected.map(z => z.y + z.height));

  const btnClass = "flex-1 px-2 py-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 hover:border-slate-300 hover:text-indigo-600 text-[10px] font-bold text-slate-600 transition-all shadow-sm active:scale-95";

  // A8 — evenly spacing sponsor logos / menu rows / stat tiles needs 3+
  // zones (with 2 there's nothing to distribute — align handles that).
  const canDistribute = selected.length >= 3;
  const runDistribute = (axis: 'h' | 'v') => {
    const map = distributeEvenly(selected, axis);
    const key = axis === 'h' ? 'x' : 'y';
    updateZones(selectedIds, (z) => (map[z.id] !== undefined ? { [key]: map[z.id] } : {}), true);
  };

  return (
    <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm space-y-2">
      <div className="flex gap-2">
        <button type="button" onClick={() => updateZones(selectedIds, () => ({ x: leftMost }), true)} className={btnClass}>Left</button>
        <button type="button" onClick={() => updateZones(selectedIds, (z) => ({ x: (leftMost + rightMost) / 2 - z.width / 2 }), true)} className={btnClass}>Center X</button>
        <button type="button" onClick={() => updateZones(selectedIds, (z) => ({ x: rightMost - z.width }), true)} className={btnClass}>Right</button>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={() => updateZones(selectedIds, () => ({ y: topMost }), true)} className={btnClass}>Top</button>
        <button type="button" onClick={() => updateZones(selectedIds, (z) => ({ y: (topMost + bottomMost) / 2 - z.height / 2 }), true)} className={btnClass}>Center Y</button>
        <button type="button" onClick={() => updateZones(selectedIds, (z) => ({ y: bottomMost - z.height }), true)} className={btnClass}>Bottom</button>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!canDistribute}
          title={canDistribute ? 'Equalize horizontal gaps between the selected zones' : 'Select 3 or more zones to distribute'}
          onClick={() => runDistribute('h')}
          className={`${btnClass} disabled:opacity-40 disabled:pointer-events-none`}
        >
          Distribute H
        </button>
        <button
          type="button"
          disabled={!canDistribute}
          title={canDistribute ? 'Equalize vertical gaps between the selected zones' : 'Select 3 or more zones to distribute'}
          onClick={() => runDistribute('v')}
          className={`${btnClass} disabled:opacity-40 disabled:pointer-events-none`}
        >
          Distribute V
        </button>
      </div>
    </div>
  );
}

/**
 * Phase 3 — column picker for the per-element Custom-data card. Reads the
 * template's feed URL + format from the builder store and does ONE fetch
 * (via the shared useCustomData hook) to detect the available columns, so
 * the operator picks "which field shows" from a real dropdown instead of
 * typing a column name blind. Falls back to a free-text input until the
 * first fetch resolves (or if the feed can't be read) so the operator is
 * never blocked. The fetch flows through the same SSRF-gated proxy the
 * widget uses — no direct browser call to the operator's URL.
 */
function CustomColumnPicker({
  zoneId,
  value,
  enabled,
  url,
  format,
  onChange,
}: {
  zoneId: string;
  value: string;
  enabled: boolean;
  url: string;
  format: 'json' | 'csv';
  onChange: (col: string) => void;
}) {
  const selectId = `custom-col-${zoneId}`;
  // Read the URL/format from the zone config (the persisted, player-bound
  // source of truth) so the column dropdown works even on a reloaded
  // template where the session-only template meta has reset to NONE.
  const feedUrl = (url || '').trim();
  // Only fetch when the widget is actually live AND we have a URL.
  const rows = useCustomData(enabled && feedUrl.length > 0, feedUrl, format);
  const columns: string[] = rows && rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div>
      <label htmlFor={selectId} style={{ display: 'block', fontSize: 10, fontWeight: 600, color: '#c7d2fe', marginBottom: 4 }}>
        Show column
      </label>
      {columns.length > 0 ? (
        <select
          id={selectId}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: '100%', padding: '6px 8px', borderRadius: 6,
            border: '1px solid #4338ca', background: '#312e81', color: '#e0e7ff',
            fontSize: 11, fontWeight: 600, cursor: 'pointer', appearance: 'auto',
          }}
        >
          <option value="">First text column (auto)</option>
          {columns.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      ) : (
        <input
          id={selectId}
          type="text"
          value={value || ''}
          placeholder="First text column (auto)"
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: '100%', padding: '6px 8px', boxSizing: 'border-box', borderRadius: 6,
            border: '1px solid #4338ca', background: '#312e81', color: '#e0e7ff',
            fontSize: 11, fontWeight: 500,
          }}
        />
      )}
      <span style={{ fontSize: 9, color: '#a5b4fc', display: 'block', marginTop: 3 }}>
        {columns.length > 0
          ? 'Pick which feed column to scroll, or leave on auto.'
          : 'Save the feed URL above, then reopen to pick a column. Auto uses the first text column.'}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// CTS field picker — "Reads from CTS field" dropdown.
// ─────────────────────────────────────────────────────────
// Operator (2026-05-30): "i want the drop down to be picking what CTS
// is giving us in the API so there is no question we are mapping the
// correct thing." This REPLACES the old generic "Home team / Away team"
// `cfg.team` side selector + free-text `cfg.statKey` input. The options
// are the REAL CTS feed fields from the canonical catalog
// (cts-fields.ts), grouped into optgroups, each labelled with its human
// name AND its literal key ("Home Score · homeScore") so the mapping is
// unambiguous. The selected real key is stored in `cfg.ctsField`; the
// widget reads exactly that field via resolveCtsField().
function CtsFieldPicker({
  variantOrType,
  cfg,
  setField,
}: {
  variantOrType: string;
  cfg: Record<string, any>;
  setField: (patch: Record<string, any>) => void;
}) {
  // The effective bound field: explicit cfg.ctsField, else derived from
  // legacy cfg.team / cfg.statKey, else the element's correct default.
  const bound =
    deriveCtsField(variantOrType, cfg) ?? (defaultCtsField(variantOrType) as string | undefined) ?? '';
  // a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control.
  const id = useId();
  return (
    <div style={{ marginTop: 4 }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: 10, fontWeight: 600, color: '#86efac', marginBottom: 4 }}>
        Reads from CTS field
      </label>
      <select
        id={id}
        value={bound}
        onChange={(e) => setField({ ctsField: e.target.value })}
        style={{
          width: '100%', padding: '6px 8px', borderRadius: 6,
          border: '1px solid #166534', background: '#14532d',
          color: '#bbf7d0', fontSize: 11, fontWeight: 600,
          cursor: 'pointer', appearance: 'auto',
        }}
      >
        {ctsFieldsByGroup().map((grp) => (
          <optgroup key={grp.group} label={grp.group}>
            {grp.fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label} · {f.key}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <span style={{ fontSize: 9, color: '#6ee7b7', display: 'block', marginTop: 3 }}>
        This element renders the live <strong>{ctsFieldLabel(bound) || bound}</strong> value coming
        off the CTS console.
      </span>
    </div>
  );
}

/** The full green "LIVE DATA — CTS FEED" card wrapping a CtsFieldPicker —
 *  used by the standalone SCORE_HOME / GAME_CLOCK / GAME_SEGMENT /
 *  GAME_STAT cases (which aren't sb-* variants). */
function CtsLiveCard({
  variantOrType,
  cfg,
  setField,
}: {
  variantOrType: string;
  cfg: Record<string, any>;
  setField: (patch: Record<string, any>) => void;
}) {
  return (
    <div style={{
      marginBottom: 12, padding: '10px 12px', borderRadius: 8,
      background: '#052e16', border: '1px solid #166534',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{
          display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
          background: '#22c55e', marginRight: 8, flexShrink: 0,
        }} />
        <span style={{ fontSize: 10, fontWeight: 700, color: '#4ade80', letterSpacing: 1 }}>
          LIVE DATA — CTS FEED
        </span>
      </div>
      <CtsFieldPicker variantOrType={variantOrType} cfg={cfg} setField={setField} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Content fields — friendly inputs based on widget type
// ─────────────────────────────────────────────────────────
// Exported for RTL tests (2026-05-28 §19 editability proof). ContentFields is
// the real per-widget field switch + the universal text-style block, driven by
// a `zone` + `updateZone(id, patch, commit)` — exactly what PropertiesPanel
// passes it. Tests mount it directly to prove the LOGO font/color controls and
// the converted list/schedule editors fire through to a config write.
export function ContentFields({ zone, updateZone }: { zone: any; updateZone: any }) {
  const cfg = zone.defaultConfig || {};
  const setField = (patch: Record<string, any>) => {
    updateZone(zone.id, { defaultConfig: { ...cfg, ...patch } }, true);
  };
  // Phase 1 field-mapping: read template-level data source so the SCOREBOARD
  // isSportEl branch can render the LIVE DATA mapping chip vs the plain
  // "not connected" note. Atomic selector — won't re-render ContentFields
  // on unrelated meta changes (name / bg / resolution).
  const templateDataSource = useBuilderStore((s) => s.meta.dataSource ?? 'NONE');
  const setTemplateMeta = useBuilderStore((s) => s.setMeta);
  // Canvas dims for the inline-rewrite "Fit to zone" chip (Slice 1d) — the
  // rewrite endpoint needs the zone's rendered px box to target a length.
  const canvasW = useBuilderStore((s) => s.meta.screenWidth);
  const canvasH = useBuilderStore((s) => s.meta.screenHeight);
  const zonePx = {
    w: Math.round(((Number(zone.width) || 0) / 100) * (canvasW || 1920)),
    h: Math.round(((Number(zone.height) || 0) / 100) * (canvasH || 1080)),
  };

  // Shape-based themes bake their own palette + typography and ignore
  // generic style knobs like text color, font size, and background.
  // Hide those knobs for those themes so the panel never lies to the
  // user about controls that do nothing.
  const SHAPE_THEMES = new Set([
    // Elementary
    'rainbow-ribbon', 'bulletin-board', 'field-day', 'storybook', 'scrapbook', 'track-day',
    // Middle school
    'locker-hallway', 'spirit-rally', 'stem-lab', 'morning-news', 'art-studio', 'scorebug',
    // High school
    'varsity-athletic', 'senior-countdown', 'news-studio-pro', 'campus-quad', 'achievement-hall', 'jumbotron-pro',
  ]);
  const isShapeTheme = SHAPE_THEMES.has(cfg.theme);

  // Build a list of editable fields based on widget type
  const fields: React.ReactNode[] = [];

  // ── Phase 2: per-element POS mapping card (menu / drink boards) ──
  // Mirrors the Phase-1 CTS card for scoreboard elements, pointed at the
  // connected POS. Only boards that GENUINELY read a live POS feed
  // (POS_LIVE_TYPES) get it, so the card never claims "live" on a widget
  // that can't sync. The live chip reflects the board's REAL state
  // (config.posSync — exactly what the widget reads) so it never lies.
  if (POS_LIVE_TYPES.has(zone.widgetType)) {
    const posLive = !!cfg.posSync;
    if (templateDataSource === 'POS') {
      fields.push(
        <div key="pos-mapping" style={{
          marginBottom: 12, padding: '10px 12px', borderRadius: 8,
          background: '#431407', border: '1px solid #b45309',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: posLive ? '#f59e0b' : '#94a3b8', marginRight: 8, flexShrink: 0,
            }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: '#fbbf24', letterSpacing: 1 }}>
              {posLive ? 'LIVE DATA — POS FEED' : 'POS — THIS BOARD IS STATIC'}
            </span>
          </div>
          <div style={{
            display: 'inline-block', padding: '3px 8px', borderRadius: 4,
            background: '#7c2d12', color: '#fde68a', fontSize: 10, fontWeight: 600, marginBottom: 10,
          }}>
            Maps to POS · item name, price, description &amp; photo
          </div>
          <div style={{ marginBottom: 10 }}>
            {/* Real POS-category dropdown (GET /pos/categories) — the SAME
                picker the content fields use, so the operator selects an
                actual synced category ("Burgers (12)") instead of typing one
                that may not match what the POS calls it. No more guessing. */}
            <PosCategoryPickerField
              tone="amber"
              label="Reads from category"
              value={cfg.posCategory || ''}
              onChange={(v) => setField({ posCategory: v || undefined })}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', fontSize: 10, fontWeight: 600, color: '#fcd34d', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={posLive}
              onChange={(e) => setField({ posSync: e.target.checked })}
              style={{ marginRight: 6 }}
            />
            Live from POS (uncheck to use the static items below)
          </label>
        </div>,
      );
    } else {
      fields.push(
        <div key="pos-not-connected" style={{
          marginBottom: 12, padding: '8px 12px', borderRadius: 8,
          background: '#f8fafc', border: '1px solid #e2e8f0',
          display: 'flex', alignItems: 'center',
        }}>
          <span style={{ flex: 1, fontSize: 10, color: '#64748b' }}>
            Not connected to your POS — items below are static.
          </span>
          <button
            type="button"
            onClick={() => { setTemplateMeta({ dataSource: 'POS' }); setField({ posSync: true }); }}
            style={{
              marginLeft: 8, padding: '4px 8px', borderRadius: 5,
              border: '1px solid #f59e0b', background: '#fff7ed', color: '#b45309',
              fontSize: 10, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            Connect POS
          </button>
        </div>,
      );
    }
  }

  // ── Phase 3: per-element Custom-data mapping card (TICKER / list) ──
  // Mirrors the Phase-2 POS card, pointed at the generic REST/CSV feed.
  // Only widgets that GENUINELY render external rows (DATA_CONSUMER_TYPES)
  // get it. The live chip reflects the widget's REAL state (config.customSync,
  // exactly what the widget reads) so it never lies. Indigo to match the
  // template-level Custom-data picker.
  if (DATA_CONSUMER_TYPES.has(zone.widgetType)) {
    const customLive = !!cfg.customSync;
    if (templateDataSource === 'CUSTOM') {
      fields.push(
        <div key="custom-mapping" style={{
          marginBottom: 12, padding: '10px 12px', borderRadius: 8,
          background: '#1e1b4b', border: '1px solid #4338ca',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: customLive ? '#818cf8' : '#94a3b8', marginRight: 8, flexShrink: 0,
            }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: '#a5b4fc', letterSpacing: 1 }}>
              {customLive ? 'LIVE DATA — CUSTOM FEED' : 'CUSTOM — THIS WIDGET IS STATIC'}
            </span>
          </div>
          <div style={{
            display: 'inline-block', padding: '3px 8px', borderRadius: 4,
            background: '#312e81', color: '#e0e7ff', fontSize: 10, fontWeight: 600, marginBottom: 10,
          }}>
            Maps to your feed · one column per ticker item
          </div>
          <div style={{ marginBottom: 10 }}>
            <CustomColumnPicker
              zoneId={zone.id}
              value={cfg.customColumn || ''}
              enabled={customLive}
              url={cfg.customUrl || ''}
              format={cfg.customFormat === 'csv' ? 'csv' : 'json'}
              onChange={(col) => setField({ customColumn: col })}
            />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', fontSize: 10, fontWeight: 600, color: '#c7d2fe', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={customLive}
              onChange={(e) => setField({ customSync: e.target.checked })}
              style={{ marginRight: 6 }}
            />
            Live from feed (uncheck to use the static messages below)
          </label>
        </div>,
      );
    } else {
      fields.push(
        <div key="custom-not-connected" style={{
          marginBottom: 12, padding: '8px 12px', borderRadius: 8,
          background: '#f8fafc', border: '1px solid #e2e8f0',
          display: 'flex', alignItems: 'center',
        }}>
          <span style={{ flex: 1, fontSize: 10, color: '#64748b' }}>
            Not connected to a feed — messages below are static.
          </span>
          <button
            type="button"
            onClick={() => { setTemplateMeta({ dataSource: 'CUSTOM' }); setField({ customSync: true }); }}
            style={{
              marginLeft: 8, padding: '4px 8px', borderRadius: 5,
              border: '1px solid #6366f1', background: '#eef2ff', color: '#4338ca',
              fontSize: 10, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            Connect feed
          </button>
        </div>,
      );
    }
  }

  switch (zone.widgetType) {
    // 2026-05-16 — EXTERNAL_HTML rebrand editor. The signage / HS
    // templates are self-contained HTML; cfg.brand is a flat map of
    // semantic style controls the EXTERNAL_HTML widget passes into
    // the iframe (?brand=) where the per-template shim applies them
    // to the template's CSS custom properties. Any swatch left unset
    // falls through to the template's own default. Fonts are limited
    // to web-safe stacks — the templates load no external fonts.
    case 'EXTERNAL_HTML': {
      const brand: Record<string, string> =
        (cfg.brand && typeof cfg.brand === 'object') ? cfg.brand : {};
      const setBrand = (patch: Record<string, string>) =>
        setField({ brand: { ...brand, ...patch } });
      const SH = (key: string, label: string) => (
        <div
          key={`sh-${key}`}
          className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200"
        >
          {label}
        </div>
      );
      const FONT_STACKS: Array<{ label: string; value: string }> = [
        { label: 'Template default', value: '' },
        { label: 'Georgia (serif)', value: 'Georgia, "Times New Roman", serif' },
        { label: 'Times (serif)', value: '"Times New Roman", Times, serif' },
        { label: 'Didot (elegant serif)', value: 'Didot, Georgia, "Times New Roman", serif' },
        { label: 'System sans', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif' },
        { label: 'Helvetica (sans)', value: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
        { label: 'Verdana (sans)', value: 'Verdana, Geneva, sans-serif' },
        { label: 'Arial Narrow (condensed)', value: '"Arial Narrow", "Helvetica Neue Condensed", sans-serif' },
        { label: 'Impact (heavy condensed)', value: 'Impact, "Arial Narrow", sans-serif' },
        { label: 'Courier (mono)', value: '"Courier New", Courier, monospace' },
      ];
      const fontField = (k: string, label: string) => (
        <div key={`font-${k}`} className="space-y-1">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</label>
          <select
            value={brand[k] || ''}
            onChange={(e) => setBrand({ [k]: e.target.value })}
            className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          >
            {FONT_STACKS.map((f) => (
              <option key={f.label} value={f.value}>{f.label}</option>
            ))}
          </select>
        </div>
      );
      // Media source — the gym media boards (fitness/gym-media-*). The
      // operator connects the board's program video and business music
      // right here rather than being sent to Settings → Streaming: the
      // board they are looking at says SOURCE NOT CONFIGURED, and the
      // fix has to be reachable from where they are standing.
      {
        const mediaUrl = typeof cfg.url === 'string' ? cfg.url : '';
        if (/\/templates\/fitness\/gym-media-/.test(mediaUrl)) {
          fields.push(SH('ext-media', 'Media source'));
          fields.push(<MediaSourcePicker key="ext-media-picker" cfg={cfg} setField={setField} />);
        }
      }

      // Top-level POS picker — only for menu boards (qsr / menus-pos / bar URL,
      // or a board already POS-driven). Operator: "where is the top level POS
      // picker? I should be able to pick which POS system I am using." It was
      // only on the template-level (no-selection) Properties view, which the
      // auto-select-the-sole-zone behavior hides — so surface it here too.
      {
        const posUrl = typeof cfg.url === 'string' ? cfg.url : '';
        if (/\/signage\/(qsr|menus-pos|bar)\//.test(posUrl) || cfg.posSync === true || cfg.dataSource === 'POS') {
          fields.push(SH('ext-pos', 'Live menu'));
          fields.push(<PosDriverPicker key="ext-pos-picker" cfg={cfg} setField={setField} />);
        }
      }

      // Template picker — which signage template this EXTERNAL_HTML zone
      // shows. Sets cfg.url. 2026-06-01 — operator: "why pick an industry
      // drop down?" When a template is ALREADY chosen (the common case — they
      // dropped a specific board like the Domino's pizza menu), don't lead the
      // panel with a big "pick an industry template" select. Collapse it into
      // a one-line "Template: <name> · Change" disclosure so editing (text /
      // images / brand, below) is the first thing they see. An UNset zone
      // still shows the picker open.
      {
        const currentTpl = SIGNAGE_TEMPLATES.find((t) => t.url === cfg.url);
        const picker = (
          // a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control.
          // Both labels below ("Switch template" / "Pick a template") are
          // mutually exclusive (if/else on cfg.url) and pair to this one id.
          <select
            id="pp-ext-template-picker"
            value={cfg.url || ''}
            onChange={(e) => setField({ url: e.target.value })}
            className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          >
            <option value="">— pick a template —</option>
            {/* Offer only NON-quarantined boards (audit W0-08). `currentTpl`
                above still resolves a legacy quarantined board's name for the
                collapsed "Template: …" summary, but a quarantined URL is never
                a selectable NEW choice here. */}
            {Array.from(new Set(SELECTABLE_SIGNAGE_TEMPLATES.map((t) => t.group))).map((group) => (
              <optgroup key={group} label={group}>
                {SELECTABLE_SIGNAGE_TEMPLATES.filter((t) => t.group === group).map((t) => (
                  <option key={t.id} value={t.url}>{t.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        );
        if (cfg.url) {
          fields.push(
            <details key="ext-url" className="rounded-md border border-slate-200 bg-white">
              <summary className="flex items-center justify-between gap-2 px-3 py-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden text-sm">
                <span className="truncate">
                  <span className="text-slate-400">Template:&nbsp;</span>
                  <span className="font-medium text-slate-700">{currentTpl?.name || 'Custom template'}</span>
                </span>
                <span className="shrink-0 text-[11px] font-semibold text-indigo-600">Change</span>
              </summary>
              <div className="px-3 pb-3 pt-1 space-y-1">
                <label htmlFor="pp-ext-template-picker" className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Switch template</label>
                {picker}
              </div>
            </details>,
          );
        } else {
          fields.push(SH('ext-template', 'Template'));
          fields.push(
            <div key="ext-url" className="space-y-1">
              <label htmlFor="pp-ext-template-picker" className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Pick a template</label>
              {picker}
            </div>,
          );
        }
      }

      // 2026-05-25 — Editable text fields. Until now, dropping a
      // restaurant / QSR / signage template gave the operator color +
      // font overrides but ZERO text editing — they couldn't change a
      // single menu item, headline, or price. The 80 packaged templates
      // already mark every editable text node with `data-field=…`; we
      // fetch the active HTML, walk those elements, and surface one
      // editable input per data-field. The widget then sends the
      // overrides through the iframe URL (`?text=…`) where the V2
      // brand shim applies them at first paint, on both the editor
      // preview AND every player at runtime.
      // url boards fetch their HTML; AI Designer boards carry it inline in
      // cfg.html (srcdoc). Either way the editor walks the data-field hooks.
      if (cfg.url || cfg.html) {
        fields.push(SH('ext-text', 'Edit text'));
        fields.push(
          <ExternalHtmlTextEditor
            key="ext-text-editor"
            cfg={cfg}
            setField={setField}
          />,
        );
      }

      fields.push(SH('brand-colors', 'Brand colors'));
      fields.push(
        <div key="brand-note" className="text-[11px] text-slate-500 px-1 leading-relaxed">
          Recolor this template to match any customer. Leave a swatch
          unset to keep the template&apos;s own default.
        </div>,
      );
      fields.push(<ColorPickerField key="b-bg" label="Background" value={brand.background || ''} onChange={(v) => setBrand({ background: v })} />);
      fields.push(<ColorPickerField key="b-surface" label="Cards / panels" value={brand.surface || ''} onChange={(v) => setBrand({ surface: v })} />);
      fields.push(<ColorPickerField key="b-text" label="Text" value={brand.text || ''} onChange={(v) => setBrand({ text: v })} />);
      fields.push(<ColorPickerField key="b-primary" label="Primary / signature" value={brand.primary || ''} onChange={(v) => setBrand({ primary: v })} />);
      fields.push(<ColorPickerField key="b-secondary" label="Secondary" value={brand.secondary || ''} onChange={(v) => setBrand({ secondary: v })} />);
      fields.push(<ColorPickerField key="b-accent" label="Accent / highlight" value={brand.accent || ''} onChange={(v) => setBrand({ accent: v })} />);
      fields.push(<ColorPickerField key="b-accent2" label="Supporting accent" value={brand.accent2 || ''} onChange={(v) => setBrand({ accent2: v })} />);
      fields.push(<ColorPickerField key="b-positive" label="Positive / fresh" value={brand.positive || ''} onChange={(v) => setBrand({ positive: v })} />);
      fields.push(<ColorPickerField key="b-negative" label="Warning / allergen" value={brand.negative || ''} onChange={(v) => setBrand({ negative: v })} />);
      fields.push(SH('brand-fonts', 'Fonts'));
      fields.push(fontField('fontDisplay', 'Headlines'));
      fields.push(fontField('fontBody', 'Body text'));
      fields.push(fontField('fontCondensed', 'Condensed / numbers'));
      break;
    }
    case 'TEXT':
    case 'RICH_TEXT':
      // 2026-05-04 — surface the AI sparkle directly on TEXT widgets.
      // Operator: "you added AI templates i thought but i dont see that
      // anywhere". The button was wired for ANNOUNCEMENT / TICKER /
      // QUOTE, but TEXT is what operators drag most often. The intent
      // for headline-style copy is "announcement" — Claude's system
      // prompt covers short, scannable, punchy lines which is what TEXT
      // widgets need anyway.
      fields.push(
        <div key="ai-text" className="rounded-lg bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-violet-200 px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-700 font-medium">Need copy? Let Claude write 3 options.</span>
          <AiGenerateButton
            intent="announcement"
            defaultContext={cfg.content || cfg.title || ''}
            onPick={(text) => setField({ content: text, title: text })}
            buttonClassName="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 px-2.5 py-1 rounded shadow-sm transition-all"
            buttonLabel="✨ Generate"
          />
        </div>
      );
      // Slice 1d — one-tap rewrite of the EXISTING text (Rewrite / Shorten /
      // Fit to zone). Self-hides when the field is empty / locked / no AI key.
      fields.push(
        <InlineRewriteChips
          key="ai-text-rewrite"
          text={(cfg.content as string) || (cfg.title as string) || ''}
          widgetType={zone.widgetType}
          fieldKey="content"
          fontSize={Number(cfg.fontSize) || 48}
          zonePx={zonePx}
          locked={!!zone.locked}
          onPick={(text) => setField({ content: text, title: text })}
        />,
      );
      // 2026-05-03 — v2 HEADLINE_* variants (NeonMarquee, PaperPress,
      // CrayonBanner, SlabHero, BriefMemo) live under the TEXT widget
      // type and read `c.title` instead of `c.content`. Mirror BOTH so
      // the same text shows on legacy + v2 renderers without retyping.
      fields.push(<TextAreaField key="content" label="Text" value={cfg.content || cfg.title || ''} placeholder="Your headline…" onChange={(v) => setField({ content: v, title: v })} rows={3} />);
      // Banner themes often use a subtitle too. Expose it for shape
      // themes where the widget renders both lines. v2 Headlines also
      // read `subtitle`, so this field doubles as the v2 dek.
      if (isShapeTheme || cfg.variant) {
        fields.push(<TextField key="subtitle" label="Subtitle (optional)" value={cfg.subtitle || ''} placeholder="Today is going to be amazing" onChange={(v) => setField({ subtitle: v })} />);
      }
      // v2 HEADLINE_* extras — only surface when a variant is selected
      // so vanilla TEXT widgets keep their lean editor.
      if (cfg.variant && String(cfg.variant).startsWith('headline-')) {
        fields.push(<TextField key="eyebrow" label="Eyebrow (optional)" value={cfg.eyebrow || ''} placeholder="BREAKING" onChange={(v) => setField({ eyebrow: v })} />);
        fields.push(<TextField key="byline" label="Byline (optional)" value={cfg.byline || ''} placeholder="Editorial Staff" onChange={(v) => setField({ byline: v })} />);
        fields.push(<TextField key="date" label="Date (optional)" value={cfg.date || ''} placeholder="May 3, 2026" onChange={(v) => setField({ date: v })} />);
      }
      if (!isShapeTheme) {
        fields.push(<SelectField key="alignment" label="Alignment" value={cfg.alignment || 'center'} options={[['left','Left'],['center','Center'],['right','Right']]} onChange={(v) => setField({ alignment: v })} />);
        // Font family picker — Google Fonts catalog (curated to the
        // top design-tool fonts so the dropdown isn't 1000 entries).
        // Inherits from the template theme by default; override sets
        // a one-off CSS font-family on this zone.
        fields.push(<FontFamilyField key="fontFamily" label="Font" value={cfg.fontFamily || ''} onChange={(v) => setField({ fontFamily: v })} />);
        // Font size — Canva-style hybrid: −/+ stepper buttons for
        // common bumps, numeric input for precision, dropdown for
        // common preset sizes. Px units across the board.
        // The measure callback reads the actual rendered px from the
        // DOM so the +/− stepper anchors on what's visible (theme
        // default, zone-wide override, or per-field override) instead
        // of falling back to a hardcoded 48 and shrinking large text.
        fields.push(
          <FontSizeField
            key="fontSize"
            label="Font size"
            value={cfg.fontSize ?? null}
            onChange={(v) => setField({ fontSize: v })}
            getMeasuredSize={() => measureZoneFontSize(zone.id)}
          />,
        );
        // Inline format toggles — Canva's universal text bar pattern
        // (B / I / U / S). Each is opt-in; off-state is the default
        // semibold no-decoration look. Inspected from Canva's
        // perform-editing-operations format_text op shape.
        fields.push(
          <FormatToggles
            key="format"
            bold={cfg.bold === true}
            italic={cfg.italic === true}
            underline={cfg.underline === true}
            strikethrough={cfg.strikethrough === true}
            onChange={(patch) => setField(patch)}
          />
        );
        // Line-height slider — Canva range 0.5x to 2.5x. Default 1.4
        // (prior hardcoded value) so existing templates don't shift.
        fields.push(
          <LineHeightField
            key="lineHeight"
            value={typeof cfg.lineHeight === 'number' ? cfg.lineHeight : 1.4}
            onChange={(v) => setField({ lineHeight: v })}
          />
        );
        fields.push(<ColorField key="color" label="Text color" value={cfg.color || '#1e293b'} onChange={(v) => setField({ color: v })} />);
        fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || 'transparent'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
      }
      if (zone.widgetType === 'RICH_TEXT') {
        fields.push(<TextAreaField key="html" label="HTML (advanced)" value={cfg.html || ''} placeholder="<p>Custom HTML…</p>" onChange={(v) => setField({ html: v })} rows={4} />);
      }
      break;
    case 'ANNOUNCEMENT':
      // AI-assist for the announcement copy. Operator types a phrase
      // ("spring break next week") → Claude returns 3 polished options.
      fields.push(
        <div key="ai-announcement" className="rounded-lg bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-violet-200 px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-700 font-medium">Need copy? Let Claude write 3 options.</span>
          <AiGenerateButton
            intent="announcement"
            defaultContext={cfg.title || cfg.message || ''}
            onPick={(text) => {
              // Default behavior: drop into `message`. If the operator picked
              // something short we also seed `title` for Schools that use the
              // legacy two-line shape.
              const isShort = text.length < 60;
              setField(isShort ? { title: text, message: '' } : { message: text, body: undefined });
            }}
            buttonClassName="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-violet-600 hover:bg-violet-700 px-2.5 py-1 rounded shadow-sm"
            buttonLabel="Generate"
          />
        </div>
      );
      fields.push(<TextField key="title" label="Title" value={cfg.title || ''} placeholder="Big news…" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextAreaField key="message" label="Message" value={cfg.message || cfg.body || ''} placeholder="Details…" onChange={(v) => setField({ message: v, body: undefined })} rows={3} />);
      // Slice 1d — one-tap rewrite of the announcement message.
      fields.push(
        <InlineRewriteChips
          key="ai-announcement-rewrite"
          text={(cfg.message as string) || (cfg.body as string) || (cfg.title as string) || ''}
          widgetType={zone.widgetType}
          fieldKey="message"
          fontSize={Number(cfg.fontSize) || 48}
          zonePx={zonePx}
          locked={!!zone.locked}
          onPick={(text) => setField({ message: text, body: undefined })}
        />,
      );
      if (!isShapeTheme) {
        // 2026-05-03 — v2 ANN_* widgets (NeonAlert, BulletinPin, RainbowBubble,
        // GlassToast, OpsDispatch) read `c.label` for the badge eyebrow.
        // Legacy widget reads `cfg.badgeLabel`. Mirror BOTH on every write
        // so picking a v2 announcement variant doesn't show "ALERT" /
        // "REMINDER" / "Update" placeholders forever.
        fields.push(<TextField key="badge" label="Badge label" value={cfg.badgeLabel || cfg.label || ''} placeholder="📣 Today's Announcement" onChange={(v) => setField({ badgeLabel: v, label: v })} />);
        // `c.icon` (emoji or short string) — used by every v2 variant
        // for the leading glyph. Empty string falls back to the
        // theme's default emoji (⚠ / 📌 / 🌟 / ✓ / ●).
        fields.push(<TextField key="icon" label="Icon (emoji or short text)" value={cfg.icon || ''} placeholder="⚠" onChange={(v) => setField({ icon: v })} />);
        // `c.cta` — call-to-action footer text (e.g. "More info at the
        // front desk", "Tap to RSVP"). Renders as the bottom row across
        // all v2 variants. Optional; legacy widgets ignore.
        fields.push(<TextField key="cta" label="Call-to-action (optional)" value={cfg.cta || ''} placeholder="More info at the front desk" onChange={(v) => setField({ cta: v })} />);
        fields.push(<SelectField key="priority" label="Priority" value={cfg.priority || 'normal'} options={[['low','Low'],['normal','Normal'],['high','High'],['urgent','Urgent']]} onChange={(v) => setField({ priority: v })} />);
      }
      break;
    case 'STAFF_SPOTLIGHT':
      // 2026-05-03 — write BOTH `staffName` (legacy widget reads this)
      // AND `name` (v2 StaffWidgets read this) so picking a v2
      // staff variant doesn't show a blank name on the canvas.
      fields.push(<TextField key="staffName" label="Name" value={cfg.staffName || cfg.name || ''} placeholder="Mrs. Johnson" onChange={(v) => setField({ staffName: v, name: v })} />);
      fields.push(<TextField key="role" label="Role" value={cfg.role || ''} placeholder="Teacher of the Week" onChange={(v) => setField({ role: v })} />);
      fields.push(<TextAreaField key="bio" label="Bio" value={cfg.bio || ''} placeholder="One-liner about them…" onChange={(v) => setField({ bio: v })} rows={3} />);
      fields.push(<AssetPickerField key="photoUrl" label="Photo" value={cfg.photoUrl || ''} kind="image" onChange={(v) => setField({ photoUrl: v })} />);
      break;
    case 'COUNTDOWN': {
      const mode = (cfg.mode as 'date' | 'recurring') || 'date';
      fields.push(
        <SelectField
          key="mode"
          label="Countdown type"
          value={mode}
          options={[['date', 'Single date (e.g. Field Trip)'], ['recurring', 'Recurring schedule (e.g. Lunch periods)']]}
          onChange={(v) => setField({ mode: v })}
        />
      );
      if (mode === 'date') {
        fields.push(<TextField key="label" label="Label" value={cfg.label || ''} placeholder="Field Trip in" onChange={(v) => setField({ label: v })} />);
        // 2026-05-04 — Date + Time picker (was just date earlier).
        // Operator: "if we are going to give hour countdowns we
        // should be able to set date and time for the countdown".
        //
        // Two side-by-side native pickers writing to a single
        // cfg.targetDate string in ISO shape "YYYY-MM-DDTHH:MM:00".
        // Time defaults to 00:00 (midnight) when blank. Splitting
        // into two inputs (vs one datetime-local) keeps the date
        // field tappable on mobile without forcing a time picker
        // every time, and lets us label them clearly as "Date" /
        // "Time (optional)" with a per-field help line.
        const isoTarget = cfg.targetDate || '';
        const datePart = (() => {
          const m = isoTarget.match(/^(\d{4}-\d{2}-\d{2})/);
          return m ? m[1] : '';
        })();
        const timePart = (() => {
          const m = isoTarget.match(/T(\d{2}:\d{2})/);
          return m ? m[1] : '';
        })();
        const setTarget = (date: string, time: string) => {
          if (!date) {
            setField({ targetDate: '' });
            return;
          }
          // Default time to 00:00 when blank — countdown widgets
          // already handle "YYYY-MM-DD" alone, but we save the full
          // ISO so consumers that always parse as UTC don't drift.
          const t = time || '00:00';
          setField({ targetDate: `${date}T${t}:00` });
        };
        fields.push(
          <div key="targetDate" className="space-y-1">
            {/* a11y wave (2026-08-24) — this heading describes TWO controls
                (date + time) at once, which a single <label for> can't
                validly target (jsx-a11y/label-has-associated-control) — a
                <label> here was never semantically correct regardless of
                the lint rule. It's a group caption; each input below
                carries its own precise aria-label instead (axe-core:
                "Form elements must have labels"). */}
            <div className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Target date &amp; time
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <input
                  type="date"
                  aria-label="Target date"
                  value={datePart}
                  onChange={(e) => setTarget(e.target.value, timePart)}
                  className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                />
                <div className="text-[10px] text-slate-500 mt-1 leading-tight">Date</div>
              </div>
              <div>
                <input
                  type="time"
                  aria-label="Target time (optional, defaults to midnight)"
                  value={timePart}
                  onChange={(e) => setTarget(datePart, e.target.value)}
                  disabled={!datePart}
                  className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none disabled:bg-slate-50 disabled:text-slate-400"
                />
                <div className="text-[10px] text-slate-500 mt-1 leading-tight">Time (optional, defaults to midnight)</div>
              </div>
            </div>
            <div className="text-[10px] text-slate-500 leading-relaxed pt-0.5">
              Times are stored as wall-clock (no timezone offset) so the countdown ends when the SCREEN&apos;s local clock hits this date/time. If you set &quot;May 12, 3pm&quot; the screen counts down to 3pm in its own timezone ({(() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'detected from browser'; } catch { return 'detected from browser'; } })()}). Single-number countdowns show calendar days (May 4 → May 12 = 8); multi-unit countdowns (DAYS HRS MIN SEC) show precise time remaining.
            </div>
          </div>,
        );
        // 2026-05-03 — v2 widgets (CountdownNeonDigits, GlassRing, OpsTimer)
        // read `c.eyebrow` for the small line above the headline. Without
        // this field the legacy editor only writes `label`, leaving the
        // eyebrow stuck on its default ("COUNTDOWN").
        fields.push(<TextField key="eyebrow" label="Eyebrow text (optional)" value={cfg.eyebrow || ''} placeholder="COUNTDOWN" onChange={(v) => setField({ eyebrow: v })} />);
        // v2 widgets also accept `c.staticDays` as a fallback when the
        // target date is empty/in-the-past, so the canvas preview shows
        // a sensible number instead of 0/0/0/0 in templates the editor
        // hasn't filled yet. Optional integer.
        fields.push(<TextField key="staticDays" label="Fallback days (preview only)" value={cfg.staticDays != null ? String(cfg.staticDays) : ''} placeholder="12" onChange={(v) => setField({ staticDays: v.trim() === '' ? undefined : parseInt(v) || undefined })} />);
      } else {
        fields.push(<TextField key="prefix" label="Prefix (optional)" value={cfg.prefix || ''} placeholder="Next lunch in" onChange={(v) => setField({ prefix: v })} />);
        fields.push(
          <PeriodsEditor
            key="periods"
            value={(cfg.periods || []) as Array<{ label: string; daysOfWeek: number[]; startTime: string }>}
            onChange={(periods) => setField({ periods })}
          />
        );
      }
      break;
    }
    case 'CLOCK':
      // 2026-05-03 — v2 CLOCK_* widgets (NeonPulse, RecessBlocks,
      // LockerFlip, GlassMinimal, OpsTerminal) read camelCase keys:
      //   c.timeZone (capital Z) — NOT c.timezone
      //   c.format24 (boolean)   — NOT c.format === '24h'
      // Mirror BOTH on every write so legacy + v2 variants render the
      // same selection. Legacy widgets ignore the v2-shaped extras.
      fields.push(<SelectField key="format" label="Format" value={cfg.format || (cfg.format24 ? '24h' : '12h')} options={[['12h','12-hour'],['24h','24-hour']]} onChange={(v) => setField({ format: v, format24: v === '24h' })} />);
      // 2026-08-21 — was a free-text IANA input ("America/Chicago" by hand);
      // operator standard is now "pick the time zone and done".
      fields.push(<SettingSelect key="timezone" label="Time zone" value={cfg.timezone || cfg.timeZone || ''} options={BOARD_TIMEZONES} onChange={(v) => setField({ timezone: v, timeZone: v })} />);
      if (!isShapeTheme) {
        // showSeconds / showDays / bgColor are ignored by shape
        // themes (clock face is baked into the SVG).
        fields.push(<ToggleField key="showSeconds" label="Show seconds" value={!!cfg.showSeconds} onChange={(v) => setField({ showSeconds: v })} />);
        fields.push(<ToggleField key="showDays" label="Show day & date" value={cfg.showDays !== false} onChange={(v) => setField({ showDays: v })} />);
        // Date display style — operator: "i want the date as just the
        // day name, not the full long date". `dateFormat` writes into
        // the ClockWidget renderer (and the v2 themed clocks fall
        // through to it via the shared theme renderer registry).
        // 'long' = Monday, May 25, 2026  (legacy default)
        // 'short' = Mon, May 25
        // 'weekday' = Monday
        // 'numeric' = 5/25/2026
        // 'iso' = 2026-05-25
        fields.push(<SelectField key="dateFormat" label="Date format" value={cfg.dateFormat || 'long'} options={[['long','Monday, May 25, 2026'],['short','Mon, May 25'],['weekday','Monday'],['numeric','5/25/2026'],['iso','2026-05-25']]} onChange={(v) => setField({ dateFormat: v })} />);
        // Optional eyebrow text — v2 widgets show this above the time
        // when set ("HOMEROOM IN", "BELL @", etc.). Legacy widgets ignore.
        fields.push(<TextField key="label" label="Eyebrow (optional)" value={cfg.label || ''} placeholder="" onChange={(v) => setField({ label: v })} />);
        fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || 'transparent'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
      }
      break;
    case 'WEATHER': {
      const weatherUnits = ['metric', 'celsius', 'c'].includes(String(cfg.units || '').toLowerCase()) ? 'metric' : 'imperial';
      // 2026-05-04 — operator: "i should be able to type a location
      // or zipcode or it should know where i am automatically and
      // set it but its a bunch of free text fields i can type."
      //
      // The renderer ALREADY fetches live data via fetchWeather()
      // (Open-Meteo / Zippopotam, no API key, no cost). The editor
      // was presenting tempF/high/low/condition/icon as if they
      // were required inputs — they're optional manual overrides,
      // shown front-and-center which made the operator think they
      // had to type fake data.
      //
      // New layout:
      //   - Smart location input (zip OR city OR "Use my location")
      //   - Units toggle (°F / °C)
      //   - Live status: "Fetching from Open-Meteo / OK"
      //   - Manual overrides collapsed under "Advanced (override
      //     live data)" — only opens if operator wants to fake it
      fields.push(
        <SmartLocationField
          key="location"
          value={cfg.location || cfg.zipCode || ''}
          onChange={(v) => setField({ location: v, zipCode: undefined })}
        />,
      );
      fields.push(<SelectField key="units" label="Units" value={weatherUnits} options={[['imperial','°F'],['metric','°C']]} onChange={(v) => setField({ units: v })} />);
      fields.push(
        <WeatherOverrideAdvanced
          key="overrides"
          cfg={cfg}
          weatherUnits={weatherUnits}
          setField={setField}
        />,
      );
      break;
    }
    case 'TICKER': {
      const tickerText = tickerTextForEditor(cfg);
      const msgs = tickerText.split('\n');
      const label = `Messages (one per line) — ${msgs.filter(Boolean).length} saved`;
      // AI-assist appends a fresh ticker line. Operator picks → we
      // append to whatever they already have so a Welcome / Hours /
      // Wifi / Promo line stack builds up naturally.
      fields.push(
        <div key="ai-ticker" className="rounded-lg bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-violet-200 px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-700 font-medium">Need a ticker line? Claude drafts 3.</span>
          <AiGenerateButton
            intent="ticker"
            onPick={(text) => {
              const existing = tickerText.trim();
              const next = existing ? `${existing}\n${text}` : text;
              setField({ text: next, messages: next.split('\n') });
            }}
            buttonClassName="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-violet-600 hover:bg-violet-700 px-2.5 py-1 rounded shadow-sm"
            buttonLabel="+ Generate"
          />
        </div>
      );
      // Preserve blank lines while the user is actively typing (the
      // user needs an empty line to exist briefly when pressing Enter
      // before typing the next message). Filter happens only on save,
      // not on every keystroke. We keep trailing empty as-is too;
      // saving an all-empty doesn't hurt anything.
      fields.push(<TextAreaField key="messages" label={label} value={tickerText} placeholder="Welcome back!" onChange={(v) => setField({ text: v, messages: v.split('\n') })} rows={6} />);
      fields.push(<SelectField key="speed" label="Speed" value={cfg.speed || 'medium'} options={[['slow','Slow'],['medium','Medium'],['fast','Fast']]} onChange={(v) => setField({ speed: v })} />);
      fields.push(<ToggleField key="scrollEnabled" label="Animate scroll" value={cfg.scrollEnabled !== false} onChange={(v) => setField({ scrollEnabled: v })} />);
      // 2026-05-02 — operator: "Ticker: text size + ticker dimensions
      // not adjustable" + "Toolbar font/size/color controls for ticker
      // missing." The renderer (WidgetRenderer.TickerWidget) hard-codes
      // `style={{ fontSize: '0.85em', color: '#fbbf24' }}` on the
      // visible span, but BuilderZone injects `!important` rules
      // scoped to `[data-zone-id]` for cfg.fontFamily / fontSize /
      // color, which override the inline style. Wiring the panel
      // controls to those cfg keys gives the operator real control
      // without rewriting the widget. (Ticker height = zone height,
      // which is already adjustable via the canvas resize handles.)
      fields.push(<FontFamilyField key="fontFamily" label="Font" value={cfg.fontFamily || ''} onChange={(v) => setField({ fontFamily: v })} />);
      fields.push(
        <FontSizeField
          key="fontSize"
          label="Font size"
          value={cfg.fontSize ?? null}
          onChange={(v) => setField({ fontSize: v })}
          getMeasuredSize={() => measureZoneFontSize(zone.id)}
        />,
      );
      fields.push(<ColorField key="color" label="Text color" value={cfg.color || '#fbbf24'} onChange={(v) => setField({ color: v })} />);
      // 2026-05-04 — operator: "i tried a ticker and no way tpo change
      // the background on a ticker". v2 ticker renderers read
      // config.style.bgColor; resolveTickerStyle() in TickerWidgets.tsx
      // feeds top-level cfg.bgColor into that path so the picker below
      // works against any of the 5 ticker variants. Empty string clears
      // the override and falls through to brand surface (if branded) /
      // widget default.
      fields.push(<ColorField key="bgColor" label="Background color" value={cfg.bgColor || ''} onChange={(v) => setField({ bgColor: v })} />);
      // 2026-05-03 — v2 TICKER_* variants (NeonLed, PaperPress, CrayonTrain,
      // GlassFlow, OpsFeed) read `c.stamp` for the eyebrow/category badge
      // ("LIVE", "EXTRA", "FEED") and `c.separator` for what divides
      // messages on screen. Both optional; legacy widgets ignore.
      fields.push(<TextField key="stamp" label="Eyebrow stamp (optional)" value={cfg.stamp || ''} placeholder="LIVE" onChange={(v) => setField({ stamp: v })} />);
      fields.push(<TextField key="separator" label="Message separator" value={cfg.separator || ''} placeholder="•" onChange={(v) => setField({ separator: v })} />);
      break;
    }
    case 'CALENDAR':
      fields.push(<TextField key="title" label="Title" value={cfg.title || ''} placeholder="Upcoming Events" onChange={(v) => setField({ title: v })} />);
      // 2026-05-28 (§19) — was a pipe-delimited `date | title | time |
      // location | tag` textarea. cfg.events is stored as an array of
      // { date, title, time?, location?, tag?, color? }. The base
      // CalendarWidget renders date/title/color; the v2 themed calendars
      // (CalendarNeonGrid, CalendarPaperAgenda, …) also render
      // time/location/tag. ListItemsEditor gives a per-event card with all
      // those fields PLUS a per-event color (the pipe editor had none) and
      // accepts a legacy array OR JSON string, so back-compat is automatic.
      fields.push(<ListItemsEditor key="events" label="Events" itemNoun="event" help="Each row is one event. Date + title are the essentials; time, location, and tag show on themed calendars." value={cfg.events} onChange={(v) => setField({ events: v })} newItem={{ date: '', title: '', time: '', location: '', tag: '', color: '' }} fields={[
        { key: 'date', label: 'Date', type: 'text', placeholder: 'TUE 04' },
        { key: 'title', label: 'Title', type: 'text', placeholder: 'Spring Concert' },
        { key: 'time', label: 'Time', type: 'text', placeholder: '7:00 PM' },
        { key: 'location', label: 'Location', type: 'text', placeholder: 'Auditorium' },
        { key: 'tag', label: 'Tag', type: 'text', placeholder: 'ARTS' },
        { key: 'color', label: 'Dot color', type: 'color' },
      ]} />);
      fields.push(<TextField key="maxEvents" label="Max events to show" value={String(cfg.maxEvents || 4)} placeholder="4" onChange={(v) => setField({ maxEvents: parseInt(v) || 4 })} />);
      fields.push(<TextField key="feedUrl" label="iCal/feed URL (optional)" value={cfg.feedUrl || ''} placeholder="https://…/calendar.ics" onChange={(v) => setField({ feedUrl: v })} />);
      break;
    case 'LUNCH_MENU':
      fields.push(<TextField key="title" label="Title" value={cfg.title || ''} placeholder="Lunch Menu" onChange={(v) => setField({ title: v })} />);
      // 2026-05-04 — operator: "menus should keep the day of the week
      // and allow we to easily update them and add emojis or images,
      // anything that makes sense like the ones from our preset
      // templates". The Animated Cafeteria preset already has a rich
      // per-day editor (WeekMenuEditor — Mon/Tue/Wed/Thu/Fri tabs +
      // emoji picker + dish name + allergens + price). Reuse it
      // here and translate the CafeWeek shape into the v2
      // LunchMenu's `days` shape on every write so:
      //   • Operator gets the same friendly editor
      //   • Existing templates that wrote `weekMenu` keep working
      //   • v2 widgets that read `days` see the full week's content
      // Plain "Menu" textarea kept below the rich editor as a power-
      // user fallback / quick-paste path.
      fields.push(
        <WeekMenuEditor
          key="weekMenu"
          value={cfg.weekMenu}
          onChange={(weekMenu) => {
            // Translate CafeWeek (mon..fri arrays of {emoji,name,meta,price})
            // into the v2 LunchMenu `days` shape ({ day, entree, sides[],
            // dessert }). First item per day = entree; remaining items =
            // sides. Emoji prefixed onto each name so v2 widgets that
            // don't have a dedicated emoji slot still surface it visually.
            const DAY_CODES: Array<[keyof typeof weekMenu, string]> = [
              ['monday', 'MON'], ['tuesday', 'TUE'], ['wednesday', 'WED'],
              ['thursday', 'THU'], ['friday', 'FRI'],
            ];
            const days = DAY_CODES
              .filter(([k]) => (weekMenu[k] || []).length > 0)
              .map(([k, code]) => {
                const items = weekMenu[k] || [];
                const labelOf = (it: { emoji?: string; name?: string; meta?: string }) => {
                  const e = (it.emoji || '').trim();
                  const n = (it.name || '').trim();
                  return e && !/^https?:\/\/|^data:/i.test(e) ? `${e} ${n}` : n;
                };
                const entree = labelOf(items[0]);
                const sides = items.slice(1, -1).map(labelOf).filter(Boolean);
                const last = items.length >= 3 ? labelOf(items[items.length - 1]) : '';
                const dessert = items.length >= 3 ? last : '';
                const finalSides = items.length >= 3
                  ? sides
                  : items.slice(1).map(labelOf).filter(Boolean);
                return { day: code, entree, sides: finalSides, dessert };
              });
            setField({ weekMenu, days });
          }}
        />,
      );
      fields.push(<TextAreaField key="menu" label='Power-user / paste shortcut — one item per line, OR "Day: items"' value={cfg.menu || ''} placeholder={'pizza\nsalad\napple slices\ncookie\n\n— or for the full week —\n\nMonday: Pizza, Salad, Apple\nTuesday: Tacos, Beans, Churro'} onChange={(v) => {
        // 2026-05-04 — operator: "updated menu info and nothing shows
        // on the menu". Pre-fix: parser ONLY accepted lines with a
        // colon ("Day: items"). Operator typed "pizza\nsalad" with
        // no day prefix, parser returned empty days array, v2 widget
        // fell through to the hardcoded "Cheese Pizza / Garden Salad
        // / Apple Slices / Cookie" placeholder.
        //
        // Fix: TWO accepted formats. If ANY line has a "Day:" prefix
        // we parse the per-day shape (preserves the existing weekly
        // menu workflow). Otherwise treat ALL lines as TODAY's menu
        // — first non-empty line becomes the entree, rest become
        // sides (last one auto-promotes to dessert if there are 3+
        // items, matching the v2 widget's expected shape).
        const DAY_MAP: Record<string, string> = {
          monday: 'MON', tuesday: 'TUE', wednesday: 'WED', thursday: 'THU', friday: 'FRI',
          mon: 'MON', tue: 'TUE', wed: 'WED', thu: 'THU', fri: 'FRI',
        };
        const lines = v.split('\n').map((s) => s.trim()).filter(Boolean);
        const hasDayPrefix = lines.some((line) => {
          const i = line.indexOf(':');
          if (i === -1) return false;
          const dayRaw = line.slice(0, i).trim().toLowerCase();
          return !!DAY_MAP[dayRaw];
        });
        let days: Array<{ day: string; entree: string; sides: string[]; dessert: string }> = [];
        if (hasDayPrefix) {
          days = lines.map((line) => {
            const colonIdx = line.indexOf(':');
            if (colonIdx === -1) return null;
            const dayRaw = line.slice(0, colonIdx).trim().toLowerCase();
            const itemsRaw = line.slice(colonIdx + 1).trim();
            const items = itemsRaw.split(',').map((s) => s.trim()).filter(Boolean);
            if (!items.length) return null;
            return {
              day: DAY_MAP[dayRaw] || dayRaw.slice(0, 3).toUpperCase(),
              entree: items[0],
              sides: items.slice(1),
              dessert: '',
            };
          }).filter((d): d is NonNullable<typeof d> => d !== null);
        } else if (lines.length > 0) {
          // Plain item list → today's menu only. Pick TODAY's day code
          // so v2 widgets that look up "today's day" find a match.
          const TODAY_DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date().getDay()];
          const entree = lines[0];
          const rest = lines.slice(1);
          // If 3+ items, promote the LAST one to dessert (e.g.
          // "pizza / salad / apples / cookie" reads as entree=pizza,
          // sides=[salad, apples], dessert=cookie). Better than a
          // 4-item sides array for widgets that have a dedicated
          // dessert slot.
          const dessert = rest.length >= 3 ? rest[rest.length - 1] : '';
          const sides = dessert ? rest.slice(0, -1) : rest;
          days = [{ day: TODAY_DOW, entree, sides, dessert }];
        }
        setField({ menu: v, meals: undefined, days });
      }} rows={8} />);
      // 2026-05-02 — operator: "Lunch menu: can't edit font size
      // per-widget — properties panel doesn't expose a font-size
      // control for this widget type, OR exposes one that doesn't
      // bind to the renderer's actual style read." Same wiring path
      // as TICKER above: BuilderZone injects `!important` rules for
      // cfg.fontFamily / fontSize / color, which override the
      // hard-coded inline styles inside LunchMenuWidget. Renderer
      // doesn't need to change. Cfg writes from this panel land in
      // the same chain the toolbar's text-style controls would write
      // to, so the two stay in sync.
      if (!isShapeTheme) {
        fields.push(<FontFamilyField key="fontFamily" label="Font" value={cfg.fontFamily || ''} onChange={(v) => setField({ fontFamily: v })} />);
        fields.push(
          <FontSizeField
            key="fontSize"
            label="Font size"
            value={cfg.fontSize ?? null}
            onChange={(v) => setField({ fontSize: v })}
            getMeasuredSize={() => measureZoneFontSize(zone.id)}
          />,
        );
        fields.push(<ColorField key="color" label="Text color (overrides theme)" value={cfg.color || ''} onChange={(v) => setField({ color: v })} allowTransparent />);
        // 2026-06-28 — operator: the menu forced its K-12 cafeteria green on
        // every board (clashed on a navy/red board). Setting EITHER of these
        // flips the widget into theme-match mode: header=accent, body=background,
        // rows recolored for contrast. Lets an operator brand the menu (and bring
        // an older AI board — saved before art-director passed the palette — on
        // brand). Unset → the green default stays (back-compat for school presets).
        fields.push(<ColorField key="accentColor" label="Header color (overrides theme)" value={cfg.accentColor || ''} onChange={(v) => setField({ accentColor: v })} allowTransparent />);
        fields.push(<ColorField key="bgColor" label="Background color (overrides theme)" value={cfg.bgColor || ''} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
      }
      break;
    case 'QUOTE':
      fields.push(<TextAreaField key="quote" label="Quote" value={cfg.quote || ''} placeholder="Believe you can..." onChange={(v) => setField({ quote: v })} rows={3} />);
      fields.push(<TextField key="author" label="Author" value={cfg.author || ''} placeholder="Theodore Roosevelt" onChange={(v) => setField({ author: v })} />);
      break;
    case 'STATS':
      // 2026-05-28 (§19) — was a pipe-delimited `value | label` textarea.
      // StatsWidget reads cfg.stats as { value, label }[] (max 5 cards).
      // ListItemsEditor accepts a parsed array OR a legacy JSON string, so
      // back-compat is automatic; onChange always emits a real array.
      fields.push(<ListItemsEditor key="stats" label="Stats" itemNoun="stat" help="Each card is one big number with a label underneath. Up to 5 show." value={cfg.stats} onChange={(v) => setField({ stats: v })} newItem={{ value: '', label: '' }} fields={[
        { key: 'value', label: 'Big number', type: 'text', placeholder: '97%' },
        { key: 'label', label: 'Label', type: 'text', placeholder: 'Attendance' },
      ]} />);
      break;
    case 'MENU_ITEM':
      fields.push(<TextField key="itemName" label="Item name" value={cfg.itemName || ''} placeholder="Today's Special" onChange={(v) => setField({ itemName: v })} />);
      fields.push(<TextAreaField key="description" label="Description" value={cfg.description || ''} placeholder="Fresh, seasonal, made from scratch." onChange={(v) => setField({ description: v })} rows={3} />);
      fields.push(<TextField key="price" label="Price" value={cfg.price || ''} placeholder="$4.50" onChange={(v) => setField({ price: v })} />);
      fields.push(<TextField key="allergens" label="Allergens (comma separated)" value={Array.isArray(cfg.allergens) ? cfg.allergens.join(', ') : ''} placeholder="V, GF" onChange={(v) => setField({ allergens: v.split(',').map(s => s.trim()).filter(Boolean) })} />);
      break;
    case 'SCOREBOARD': {
      // 2026-05-19 — the composable scoreboard ELEMENT widgets +
      // Main/Ribbon/Scorebug composites all register under the SCOREBOARD
      // canonical type with a `variant`. They bind to LIVE game state, so
      // they don't take literal score/team text — instead the operator
      // edits which side, which stat, the label, and the full style set
      // (every aspect editable, per the operator's mandate). Detect a
      // sports variant and render the right editor; the legacy generic
      // ScoreboardWidget (no variant) keeps its old literal fields.
      const sbVariant = String(cfg.variant || '');
      const isSportEl = sbVariant.startsWith('sb-')
        || sbVariant === 'scoreboard-main' || sbVariant === 'ribbon-main' || sbVariant === 'scorebug-main';
      if (isSportEl) {
        // ── Main board — full hand-typed control (works without a bound
        // game; a live Game still wins over these at render time). 2026-05-29:
        // operator "make sure its editable" — type names/scores/colors here.
        if (sbVariant === 'scoreboard-main') {
          // Sports Wave S2-2 (2026-07-02) — "Bind to game" picker, above
          // the hand-typed fields since binding is the primary path; the
          // hand-typed overrides below still win at render time even
          // when a game is bound (MainScoreboardWidget's `pick()`).
          fields.push(<GameBindField key="gameId" value={cfg.gameId || ''} onChange={(v) => setField({ gameId: v })} />);
          fields.push(<TextField key="bannerText" label="Banner text" value={cfg.bannerText ?? ''} placeholder="GAME NIGHT" onChange={(v) => setField({ bannerText: v })} />);
          fields.push(
            <div key="homeName" data-field-section="homeName">
              <TextField label="Home team" value={cfg.homeName ?? ''} placeholder="EAGLES (blank = live game)" onChange={(v) => setField({ homeName: v })} />
            </div>,
          );
          fields.push(<TextField key="awayName" label="Away team" value={cfg.awayName ?? ''} placeholder="TIGERS (blank = live game)" onChange={(v) => setField({ awayName: v })} />);
          fields.push(<NumField key="homeScore" id="sb-homeScore" label="Home score" value={typeof cfg.homeScore === 'number' ? cfg.homeScore : 0} onChange={(v) => setField({ homeScore: v })} min={0} max={999} step={1} />);
          fields.push(<NumField key="awayScore" id="sb-awayScore" label="Away score" value={typeof cfg.awayScore === 'number' ? cfg.awayScore : 0} onChange={(v) => setField({ awayScore: v })} min={0} max={999} step={1} />);
          fields.push(<ColorField key="homeColor" label="Home color" value={cfg.homeColor || '#1e3a8a'} onChange={(v) => setField({ homeColor: v })} />);
          fields.push(<ColorField key="awayColor" label="Away color" value={cfg.awayColor || '#b91c1c'} onChange={(v) => setField({ awayColor: v })} />);
          fields.push(<ColorField key="sbAccent" label="Accent (gold trim)" value={cfg.accentColor || '#fbbf24'} onChange={(v) => setField({ accentColor: v })} />);
          fields.push(<TextField key="period" label="Period" value={cfg.period ?? ''} placeholder="auto from game (e.g. QUARTER 3)" onChange={(v) => setField({ period: v })} />);
          fields.push(<TextField key="clock" label="Clock" value={cfg.clock ?? ''} placeholder="auto from game (e.g. 7:42)" onChange={(v) => setField({ clock: v })} />);
          fields.push(<AssetPickerField key="homeLogoUrl" label="Home logo" value={cfg.homeLogoUrl || ''} kind="image" onChange={(v) => setField({ homeLogoUrl: v })} />);
          fields.push(<AssetPickerField key="awayLogoUrl" label="Away logo" value={cfg.awayLogoUrl || ''} kind="image" onChange={(v) => setField({ awayLogoUrl: v })} />);
          break;
        }
        // Sports Wave S2-2 (2026-07-02) — RibbonScoreboardWidget /
        // ScorebugWidget (RibbonScorebugWidgets.tsx) don't have a
        // dedicated field editor at all yet (a separate, pre-existing
        // gap from scoreboard-main's — not built here); the ONE thing
        // they need for S2 is the same "Bind to game" picker every other
        // useGameState()-driven sports widget gets, so an operator can
        // point a ribbon/scorebug zone at a specific game the same way.
        if (sbVariant === 'ribbon-main' || sbVariant === 'scorebug-main') {
          fields.push(<GameBindField key="gameId" value={cfg.gameId || ''} onChange={(v) => setField({ gameId: v })} />);
          break;
        }
        // ── Phase 1: LIVE DATA mapping section ──
        // Operator model (2026-05-29): "pick the MAIN integration → default
        // mappings auto-applied → user can override per-element."
        // Placed ABOVE content fields. When CTS is active: green chip describing
        // which CTS field this element reads + "Reads from feed" side picker
        // (replaces the old bare "Team side" dropdown — same cfg.team key,
        // relabeled so it reads as a mapping, not a mystery control).
        // When NONE: subtle "static" note + one-click "Connect CTS" button.
        {
          const CTS_VARIANT_MAP: Record<string, string> = {
            'sb-team-name-home': 'Home team name',
            'sb-team-name-away': 'Away team name',
            'sb-team-abbr-home': 'Home team abbreviation',
            'sb-team-abbr-away': 'Away team abbreviation',
            'sb-team-logo-home': 'Home team logo',
            'sb-team-logo-away': 'Away team logo',
            'sb-team-record-home': 'Home team record (W-L)',
            'sb-team-record-away': 'Away team record (W-L)',
            'sb-status': 'Game status (LIVE / FINAL / HALFTIME)',
            'sb-timeouts-home': 'Home timeouts remaining',
            'sb-timeouts-away': 'Away timeouts remaining',
            'sb-possession-arrow': 'Alternating-possession arrow',
            'sb-possession-ball-home': 'Possession ball — home side',
            'sb-possession-ball-away': 'Possession ball — away side',
            'sb-play-clock': 'Play clock (40/25s)',
            'sb-shot-clock': 'Shot clock timer',
            'sb-added-time': 'Added / stoppage time',
            'sb-bonus-home': 'Home BONUS / DOUBLE-BONUS lamp',
            'sb-bonus-away': 'Away BONUS / DOUBLE-BONUS lamp',
            'sb-fouls-home': 'Home team fouls',
            'sb-fouls-away': 'Away team fouls',
            'sb-down-distance': 'Down & distance (football)',
            'sb-ball-on': 'Ball-on / yard line',
            'sb-flag': 'Penalty flag indicator',
            'sb-count': 'Balls-strikes count',
            'sb-bases': 'Base-runner diamond',
            'sb-inning-half': 'Inning + top/bottom',
            'sb-pitch-count-home': 'Home pitcher pitch count',
            'sb-pitch-count-away': 'Away pitcher pitch count',
            'sb-pitch-speed': 'Pitch speed (MPH)',
            'sb-penalty-home': 'Home penalty box timers',
            'sb-penalty-away': 'Away penalty box timers',
            'sb-power-play': 'Power play / penalty-kill badge',
            'sb-set-scores': 'Per-set scores',
            'sb-serve': 'Serve indicator',
            'sb-riding-time': 'Wrestling riding-time clock',
            'sb-weight-class': 'Weight class',
            'sb-team-score-home': 'Running dual-meet score — home',
            'sb-team-score-away': 'Running dual-meet score — away',
            'sb-sponsor': 'Sponsor slot (manual)',
          };
          const ctsLabel: string | null = CTS_VARIANT_MAP[sbVariant] ?? (sbVariant.startsWith('sb-') ? 'Sport stat (auto-detected)' : null);
          // Is this element a single-CTS-field reader? Score/clock/period/
          // team/timeouts/shot-clock/penalties get the real-field picker.
          // Sponsor slots, possession arrows, etc. (no single field) don't.
          const showCtsPicker = ctsFieldEligible(sbVariant);
          const hasTeam = cfg.team !== undefined;

          if (templateDataSource === 'CTS' && showCtsPicker) {
            // Render the green "LIVE DATA — CTS FEED" mapping card. The
            // picker options are the REAL CTS feed fields (cts-fields.ts),
            // not a generic Home/Away side selector — so the dropdown label
            // IS the field coming off the console. (Operator, 2026-05-30.)
            fields.push(
              <div key="live-data-mapping" style={{
                marginBottom: 12, padding: '10px 12px', borderRadius: 8,
                background: '#052e16', border: '1px solid #166534',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{
                    display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                    background: '#22c55e', marginRight: 8, flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#4ade80', letterSpacing: 1 }}>
                    LIVE DATA — CTS FEED
                  </span>
                </div>
                <CtsFieldPicker variantOrType={sbVariant} cfg={cfg} setField={setField} />
              </div>,
            );
          } else if (templateDataSource === 'CTS') {
            // CTS is on, but THIS element is not something the CTS console
            // transmits (down/distance, fouls, possession, cards, sets,
            // riding time, …). Be honest — it stays operator-set. Don't
            // claim a feed binding the console can't fulfill.
            fields.push(
              <div key="cts-manual-note" style={{
                marginBottom: 12, padding: '8px 12px', borderRadius: 8,
                background: '#f8fafc', border: '1px solid #e2e8f0',
              }}>
                <span style={{ fontSize: 10, color: '#64748b' }}>
                  {ctsLabel ? <>This element (<strong>{ctsLabel}</strong>) isn&apos;t sent by the CTS
                  console — set it manually below.</> : 'This element is set manually — the CTS console does not transmit it.'}
                </span>
              </div>,
            );
            // Manual side picker for the operator-set fallback.
            if (hasTeam) {
              fields.push(<SelectField key="team" label="Team side" value={String(cfg.team || 'home')} options={[['home', 'Home'], ['away', 'Away']]} onChange={(v) => setField({ team: v })} />);
            }
          } else {
            // NONE path — subtle "static value" note + one-click Connect CTS.
            fields.push(
              <div key="live-data-not-connected" style={{
                marginBottom: 12, padding: '8px 12px', borderRadius: 8,
                background: '#f8fafc', border: '1px solid #e2e8f0',
                display: 'flex', alignItems: 'center',
              }}>
                <span style={{ flex: 1, fontSize: 10, color: '#64748b' }}>
                  Not connected to a live feed — value below is static.
                </span>
                <button
                  type="button"
                  onClick={() => setTemplateMeta({ dataSource: 'CTS' })}
                  style={{
                    marginLeft: 8, padding: '4px 8px', borderRadius: 5,
                    border: '1px solid #22c55e', background: '#f0fdf4',
                    color: '#15803d', fontSize: 10, fontWeight: 700,
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  Connect CTS
                </button>
              </div>,
            );
            // NONE path: bare "Team side" picker for the static fallback —
            // only for elements that are NOT single-CTS-field readers
            // (the field-picker elements derive their side from the chosen
            // field when CTS is on).
            if (hasTeam && !showCtsPicker) {
              fields.push(<SelectField key="team" label="Team side" value={String(cfg.team || 'home')} options={[['home', 'Home'], ['away', 'Away']]} onChange={(v) => setField({ team: v })} />);
            }
          }
        }
        // Editable copy fields (label / placeholder / statKey).
        // statKey: only show outside CTS — inside CTS the field is bound via
        // the real-field picker above (cfg.ctsField).
        if (cfg.label !== undefined) {
          fields.push(
            <div key="label" data-field-section="label">
              <TextField label="Label" value={cfg.label || ''} placeholder="Label" onChange={(v) => setField({ label: v })} />
            </div>,
          );
        }
        if (cfg.placeholder !== undefined) {
          fields.push(<TextField key="placeholder" label="Sample / fallback text" value={cfg.placeholder || ''} placeholder="—" onChange={(v) => setField({ placeholder: v })} />);
        }
        if (cfg.statKey !== undefined && templateDataSource !== 'CTS') {
          fields.push(<TextField key="statKey" label="Stat key (advanced)" value={cfg.statKey || ''} placeholder="down" onChange={(v) => setField({ statKey: v })} />);
        }
        if (sbVariant === 'sb-sponsor') {
          fields.push(
            <div key="imageUrl" data-field-section="imageUrl">
              <AssetPickerField label="Sponsor image" value={cfg.imageUrl || ''} kind="image" onChange={(v) => setField({ imageUrl: v })} />
            </div>,
          );
        }
        // Team-logo elements: paste a logo URL to brand the board before
        // a game is bound (overrides the live game logo).
        if (sbVariant.startsWith('sb-team-logo')) {
          fields.push(
            <div key="logoUrl" data-field-section="logoUrl">
              <AssetPickerField label="Team logo" value={cfg.logoUrl || ''} kind="image" onChange={(v) => setField({ logoUrl: v })} />
            </div>,
          );
        }
        // Team name / abbreviation — operator-typed override. 2026-05-29:
        // TeamNameWidget rendered a hardcoded EAGLES/TIGERS sample with NO
        // editable field (clicking it showed nothing to type, and edits did
        // nothing). This writes cfg.teamName, which TeamNameWidget +
        // TeamAbbrWidget now read (override > live game name > sample).
        if (sbVariant.startsWith('sb-team-name') || sbVariant.startsWith('sb-team-abbr')) {
          // data-field-section lets the canvas click light THIS field up
          // (is-active-section ring + scroll-to) when the operator clicks the
          // team-name element — the Canva "click text → its field highlights" link.
          fields.push(
            <div key="teamName" data-field-section="teamName">
              <TextField label="Team name" value={cfg.teamName ?? ''} placeholder={String(cfg.team) === 'away' ? 'TIGERS (or bind a game)' : 'EAGLES (or bind a game)'} onChange={(v) => setField({ teamName: v })} />
            </div>,
          );
        }
        // Full style set — every aspect editable.
        fields.push(<ColorField key="color" label="Text color" value={cfg.color || '#ffffff'} onChange={(v) => setField({ color: v })} />);
        fields.push(<ColorField key="accentColor" label="Accent color" value={cfg.accentColor || '#fbbf24'} onChange={(v) => setField({ accentColor: v })} />);
        fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || 'transparent'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
        // Seed the unset value from the MEASURED rendered px (not a flat 48)
        // so the first +/- grows/shrinks from the size it's actually showing —
        // no collapse when an auto-fit element gets its first explicit size
        // (operator: "when I hit the plus it should increase the size").
        fields.push(<NumField key="fontSize" id="sb-fontSize" label="Font size (px)" value={typeof cfg.fontSize === 'number' ? cfg.fontSize : (measureZoneFontSize(zone.id) ?? 48)} onChange={(v) => setField({ fontSize: v })} min={8} max={480} step={2} />);
        fields.push(<SelectField key="fontWeight" label="Font weight" value={String(cfg.fontWeight ?? 800)} options={[['400', 'Regular'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extra-bold'], ['900', 'Black']]} onChange={(v) => setField({ fontWeight: parseInt(v) })} />);
        fields.push(<SelectField key="align" label="Align" value={String(cfg.align || 'center')} options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} onChange={(v) => setField({ align: v })} />);
        break;
      }
      // ── CTS RIBBON WIDGETS — Colorado Time Systems live feed + ops controls
      // Operator (2026-05-26): "this Properties panel just shows generic
      // Status / Period / Home team fields — that's not what the CTS
      // ribbon needs". Detect every CTS variant and render a real editor
      // for each. The 12 variants come from CtsRibbonWidgets.tsx.
      if (sbVariant.startsWith('scoreboard-cts-')) {
        // ── Helper: small explanatory banner so the operator knows what feeds the zone
        const ctsBanner = (text: string, accent: 'live' | 'config' | 'auto' = 'live') => {
          const color = accent === 'live' ? '#22c55e' : accent === 'config' ? '#fbbf24' : '#a855f7';
          const label = accent === 'live' ? 'Live from CTS' : accent === 'config' ? 'You configure this' : 'Auto-fires';
          return (
            <div key="cts-banner" style={{
              marginBottom: 12, padding: '10px 12px', borderRadius: 8,
              background: '#0f172a', color: '#e2e8f0', fontSize: 12, lineHeight: 1.5,
              border: `1px solid ${color}66`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color, marginRight: 8 }} />
                <strong style={{ color, letterSpacing: 1, fontSize: 11 }}>{label.toUpperCase()}</strong>
              </div>
              <div>{text}</div>
            </div>
          );
        };
        // ── Helper: simple test-trigger button used by the orchestrator
        const ctsTestButton = (label: string, team: 'home' | 'away' | 'horn', cueId?: string) => (
          <button
            key={`test-${team}-${cueId || ''}`}
            type="button"
            onClick={() => {
              if (typeof window === 'undefined') return;
              try {
                window.dispatchEvent(new CustomEvent('edu:cts-celebration-preview', { detail: { team, cueId } }));
              } catch { /* ignore */ }
            }}
            style={{
              marginTop: 6, marginRight: 6, padding: '6px 12px',
              background: '#2563eb', color: 'white', border: 'none',
              borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}
          >
            ▶ Test: {label}
          </button>
        );
        // ── Per-variant fields
        switch (sbVariant) {
          case 'scoreboard-cts-clock':
            fields.push(ctsBanner('The CTS console drives this clock over the USB-RS232 bridge. Below you customize how it looks; the live clock value comes from the console itself.'));
            fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || '#0f172a'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
            fields.push(<ColorField key="accentColor" label="Clock color" value={cfg.accentColor || '#f59e0b'} onChange={(v) => setField({ accentColor: v })} />);
            break;
          case 'scoreboard-cts-period':
            fields.push(ctsBanner('Q1–Q4 / OT readout from the CTS console.'));
            fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || '#0f172a'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
            fields.push(<ColorField key="accentColor" label="Period text color" value={cfg.accentColor || '#cbd5e1'} onChange={(v) => setField({ accentColor: v })} />);
            break;
          case 'scoreboard-cts-ribbon':
            fields.push(ctsBanner('All-in-one CTS scoreboard zone — clock, score, period, exclusion. Set the team abbreviations + colors below; the live values come from the CTS console.'));
            fields.push(<TextField key="homeAbbrev" label="Home abbreviation (1–3 chars)" value={cfg.homeAbbrev || 'H'} placeholder="EAG" onChange={(v) => setField({ homeAbbrev: v })} />);
            fields.push(<TextField key="awayAbbrev" label="Away abbreviation (1–3 chars)" value={cfg.awayAbbrev || 'A'} placeholder="COU" onChange={(v) => setField({ awayAbbrev: v })} />);
            fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || '#0f172a'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
            fields.push(<ColorField key="accentColor" label="Clock color" value={cfg.accentColor || '#f59e0b'} onChange={(v) => setField({ accentColor: v })} />);
            break;
          case 'scoreboard-cts-score':
            fields.push(ctsBanner('Live combined score from the CTS console. Set team abbreviations + colors below.'));
            fields.push(<TextField key="homeAbbrev" label="Home abbreviation" value={cfg.homeAbbrev || 'H'} placeholder="EAG" onChange={(v) => setField({ homeAbbrev: v })} />);
            fields.push(<TextField key="awayAbbrev" label="Away abbreviation" value={cfg.awayAbbrev || 'A'} placeholder="COU" onChange={(v) => setField({ awayAbbrev: v })} />);
            fields.push(<ColorField key="homeColor" label="Home abbreviation color" value={cfg.homeColor || '#93c5fd'} onChange={(v) => setField({ homeColor: v })} />);
            fields.push(<ColorField key="awayColor" label="Away abbreviation color" value={cfg.awayColor || '#fca5a5'} onChange={(v) => setField({ awayColor: v })} />);
            fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || '#0f172a'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
            break;
          case 'scoreboard-cts-score-home':
            fields.push(ctsBanner('Home team score only — live from the CTS console.'));
            fields.push(<TextField key="homeAbbrev" label="Label" value={cfg.homeAbbrev || 'HOME'} placeholder="EAGLES" onChange={(v) => setField({ homeAbbrev: v })} />);
            fields.push(<ColorField key="homeColor" label="Label color" value={cfg.homeColor || '#93c5fd'} onChange={(v) => setField({ homeColor: v })} />);
            fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || '#0f172a'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
            break;
          case 'scoreboard-cts-score-away':
            fields.push(ctsBanner('Away team score only — live from the CTS console.'));
            fields.push(<TextField key="awayAbbrev" label="Label" value={cfg.awayAbbrev || 'AWAY'} placeholder="COUGARS" onChange={(v) => setField({ awayAbbrev: v })} />);
            fields.push(<ColorField key="awayColor" label="Label color" value={cfg.awayColor || '#fca5a5'} onChange={(v) => setField({ awayColor: v })} />);
            fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || '#0f172a'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
            break;
          case 'scoreboard-cts-exclusion':
            fields.push(ctsBanner('Water-polo exclusion (20-second penalty) — live from the CTS console. Auto-shows the first active exclusion across both teams; switch to one-sided in the picker below.'));
            fields.push(<SelectField key="team" label="Which team's exclusions" value={String(cfg.team || 'auto')} options={[['auto', 'Auto (first active across both)'], ['home', 'Home only'], ['away', 'Away only']]} onChange={(v) => setField({ team: v })} />);
            fields.push(<TextField key="homeAbbrev" label="Home abbreviation" value={cfg.homeAbbrev || 'H'} placeholder="EAG" onChange={(v) => setField({ homeAbbrev: v })} />);
            fields.push(<TextField key="awayAbbrev" label="Away abbreviation" value={cfg.awayAbbrev || 'A'} placeholder="COU" onChange={(v) => setField({ awayAbbrev: v })} />);
            fields.push(<ColorField key="homeColor" label="Home accent" value={cfg.homeColor || '#facc15'} onChange={(v) => setField({ homeColor: v })} />);
            fields.push(<ColorField key="awayColor" label="Away accent" value={cfg.awayColor || '#fb923c'} onChange={(v) => setField({ awayColor: v })} />);
            fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || '#1a0b1c'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
            break;
          case 'scoreboard-cts-shot-clock':
            fields.push(ctsBanner('Shot clock (30-second possession) from the CTS console. Flashes red at ≤5s; shows "—" when parked.'));
            fields.push(<SelectField key="team" label="Which team's shot clock" value={String(cfg.team || 'either')} options={[['either', 'Either side'], ['home', 'Home only'], ['away', 'Away only']]} onChange={(v) => setField({ team: v })} />);
            fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || '#0f172a'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
            fields.push(<ColorField key="accentColor" label="Number color" value={cfg.accentColor || '#facc15'} onChange={(v) => setField({ accentColor: v })} />);
            break;
          case 'scoreboard-cts-horn-flash':
            fields.push(ctsBanner('Whole-zone red flash whenever the CTS horn fires. Use as a small visual cue for refs/crowd.'));
            fields.push(<ColorField key="bgColor" label="Idle background" value={cfg.bgColor || '#1e1b1b'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
            break;

          case 'scoreboard-cts-sponsor': {
            const dataSource = String(cfg.dataSource || 'manual');
            const isAuto = dataSource === 'auto';
            fields.push(ctsBanner(
              isAuto
                ? 'Auto-pulls sponsors from your tenant Sponsor table (managed at Sports → Sponsors). They rotate during the game, expanded by `weight` so a Title sponsor shows more often than a Community one.'
                : 'Manual mode — type sponsor slots below (image URL or text + sponsor name + dwell time per slot). To pull from your live sponsor table instead, switch the data source to Auto.',
              isAuto ? 'auto' : 'config',
            ));
            fields.push(<SelectField key="dataSource" label="Data source" value={dataSource} options={[['manual', 'Manual — type slots below'], ['auto', 'Auto — pull from Sponsor table']]} onChange={(v) => setField({ dataSource: v })} />);
            if (isAuto) {
              fields.push(<TextField key="gameId" label="Game ID (optional)" value={cfg.gameId || ''} placeholder="auto-detected from /ribbon/:id URL" onChange={(v) => setField({ gameId: v })} />);
              fields.push(<TextField key="autoTierFilter" label="Tier filter (optional, e.g. Title / Gold / Community)" value={cfg.autoTierFilter || ''} placeholder="all tiers" onChange={(v) => setField({ autoTierFilter: v })} />);
            } else {
              const slotsText = Array.isArray(cfg.slots)
                ? cfg.slots.map((s: any) => `${s.imageUrl || ''} | ${s.text || ''} | ${s.durationMs ?? 6000}`).join('\n')
                : '';
              fields.push(<TextAreaField key="slots" label="Sponsor slots (image URL | text | duration ms — one per line)" value={slotsText} placeholder="https://cdn.example.com/pool-supply.png | POOL SUPPLY CO | 6000&#10; | YOUR SPONSOR HERE | 4500" onChange={(v) => {
                const parsed = v.split('\n').filter(Boolean).map((line) => {
                  const [imageUrl = '', text = '', durRaw = ''] = line.split('|').map((s) => s.trim());
                  const durationMs = parseInt(durRaw, 10);
                  return {
                    ...(imageUrl ? { imageUrl } : {}),
                    ...(text ? { text } : {}),
                    ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs } : {}),
                  };
                }).filter((s) => s.imageUrl || s.text);
                setField({ slots: parsed });
              }} rows={6} />);
            }
            fields.push(<TextField key="zoneLabel" label="Zone header label (optional)" value={cfg.zoneLabel || ''} placeholder="OUR SPONSORS" onChange={(v) => setField({ zoneLabel: v })} />);
            fields.push(<NumField key="defaultDurationMs" id="cts-sponsor-dur" label="Default slot duration (ms)" value={typeof cfg.defaultDurationMs === 'number' ? cfg.defaultDurationMs : 6000} onChange={(v) => setField({ defaultDurationMs: v })} min={1500} max={60000} step={500} />);
            fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || '#1e293b'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
            break;
          }

          case 'scoreboard-cts-announcement': {
            const dataSource = String(cfg.dataSource || 'manual');
            const isAuto = dataSource === 'auto';
            fields.push(ctsBanner(
              isAuto
                ? 'Auto-introductions from the game roster. Add players at Sports → <Game> → Roster panel; this widget auto-rolls "NOW IN · #7 J. RIVERA" through every starter on both teams. Templates below let you tailor the copy.'
                : 'Manual mode — type announcement lines below (text + dwell time). To auto-generate intros from your roster instead, switch the data source to Auto.',
              isAuto ? 'auto' : 'config',
            ));
            fields.push(<SelectField key="dataSource" label="Data source" value={dataSource} options={[['manual', 'Manual — type entries below'], ['auto', 'Auto — generate from roster']]} onChange={(v) => setField({ dataSource: v })} />);
            if (isAuto) {
              fields.push(<TextField key="gameId" label="Game ID (optional)" value={cfg.gameId || ''} placeholder="auto-detected from /ribbon/:id URL" onChange={(v) => setField({ gameId: v })} />);
              const tpls = cfg.autoTemplates || {};
              fields.push(<TextField key="tplHomeLineup" label='Home lineup template (tokens: {team} {numbers})' value={tpls.homeLineup ?? 'HOME LINEUP — {team} · {numbers}'} placeholder="HOME LINEUP — {team} · {numbers}" onChange={(v) => setField({ autoTemplates: { ...tpls, homeLineup: v } })} />);
              fields.push(<TextField key="tplAwayLineup" label='Away lineup template' value={tpls.awayLineup ?? 'AWAY LINEUP — {team} · {numbers}'} placeholder="AWAY LINEUP — {team} · {numbers}" onChange={(v) => setField({ autoTemplates: { ...tpls, awayLineup: v } })} />);
              fields.push(<TextField key="tplPerPlayer" label='Per-player template (tokens: {abbrev} {number} {name} {nameLast} {position} {team})' value={tpls.perPlayer ?? 'NOW IN · #{number} {name}'} placeholder="NOW IN · #{number} {name}" onChange={(v) => setField({ autoTemplates: { ...tpls, perPlayer: v } })} />);
              fields.push(<TextField key="tplCloser" label='Closing cheer template' value={tpls.closer ?? "LET'S GO {team}!"} placeholder="LET'S GO {team}!" onChange={(v) => setField({ autoTemplates: { ...tpls, closer: v } })} />);
              fields.push(<NumField key="autoDurationMs" id="cts-ann-auto-dur" label="Per-template dwell (ms)" value={typeof cfg.autoDurationMs === 'number' ? cfg.autoDurationMs : 4000} onChange={(v) => setField({ autoDurationMs: v })} min={1500} max={20000} step={500} />);
            } else {
              const entriesText = Array.isArray(cfg.entries)
                ? cfg.entries.map((e: any) => `${e.text || ''} | ${e.durationMs ?? 5000}`).join('\n')
                : '';
              fields.push(<TextAreaField key="entries" label="Announcements (text | duration ms — one per line)" value={entriesText} placeholder="STARTING LINEUP — #1, 7, 11, 12 | 6000&#10;PLAYER OF THE WEEK — #7 J. RIVERA | 5000&#10;NEXT MATCH — FRI 7PM | 5000" onChange={(v) => {
                const parsed = v.split('\n').filter(Boolean).map((line) => {
                  const [text = '', durRaw = ''] = line.split('|').map((s) => s.trim());
                  const durationMs = parseInt(durRaw, 10);
                  return {
                    text,
                    ...(Number.isFinite(durationMs) && durationMs > 0 ? { durationMs } : {}),
                  };
                }).filter((e) => e.text);
                setField({ entries: parsed });
              }} rows={6} />);
            }
            fields.push(<TextField key="zoneLabel" label="Zone header label (optional)" value={cfg.zoneLabel || ''} placeholder="ANNOUNCEMENTS" onChange={(v) => setField({ zoneLabel: v })} />);
            fields.push(<NumField key="defaultDurationMs" id="cts-ann-dur" label="Default dwell time (ms)" value={typeof cfg.defaultDurationMs === 'number' ? cfg.defaultDurationMs : 5000} onChange={(v) => setField({ defaultDurationMs: v })} min={1500} max={60000} step={500} />);
            fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || '#0c1322'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
            fields.push(<ColorField key="accentColor" label="Header accent color" value={cfg.accentColor || '#fbbf24'} onChange={(v) => setField({ accentColor: v })} />);
            break;
          }

          case 'scoreboard-cts-celebration':
            fields.push(ctsBanner('Simple text-pulse celebration. For full cinematic celebrations, use the "Celebration Orchestrator" tile instead.', 'auto'));
            fields.push(<TextField key="text" label="Active text (on goal/horn)" value={cfg.text || 'GOAL!'} placeholder="GOAL!" onChange={(v) => setField({ text: v })} />);
            fields.push(<TextField key="idleText" label="Idle text (between events)" value={cfg.idleText || 'GO TEAM'} placeholder="GO TEAM" onChange={(v) => setField({ idleText: v })} />);
            fields.push(<NumField key="activeMs" id="cts-cel-active" label="Active duration (ms)" value={typeof cfg.activeMs === 'number' ? cfg.activeMs : 6000} onChange={(v) => setField({ activeMs: v })} min={1000} max={30000} step={500} />);
            fields.push(<SelectField key="hornAlsoTriggers" label="Trigger on horn too?" value={cfg.hornAlsoTriggers === false ? 'false' : 'true'} options={[['true', 'Yes (recommended)'], ['false', 'No — score-delta only']]} onChange={(v) => setField({ hornAlsoTriggers: v === 'true' })} />);
            fields.push(<ColorField key="homeColor" label="Home team color" value={cfg.homeColor || '#3b82f6'} onChange={(v) => setField({ homeColor: v })} />);
            fields.push(<ColorField key="awayColor" label="Away team color" value={cfg.awayColor || '#ef4444'} onChange={(v) => setField({ awayColor: v })} />);
            fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || '#0a0a14'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
            // Test buttons fire the orchestrator preview event; the simple
            // CtsCelebrationWidget also listens, so both fire together if
            // both are mounted on the same canvas.
            fields.push(
              <div key="cts-test-buttons" style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap' }}>
                {ctsTestButton('Home goal', 'home')}
                {ctsTestButton('Away goal', 'away')}
                {ctsTestButton('Horn', 'horn')}
              </div>,
            );
            break;

          case 'scoreboard-cts-celebration-orchestrator': {
            fields.push(ctsBanner('Full-coverage overlay that fires CINEMATIC celebrations from your library when the CTS bridge reports a goal / horn / period change. Decks below = which celebrations rotate for each event. Test buttons preview without a real bridge.', 'auto'));
            fields.push(<TextField key="homeTeamName" label="Home team name (shown in cue copy)" value={cfg.homeTeamName || ''} placeholder="EAGLES" onChange={(v) => setField({ homeTeamName: v })} />);
            fields.push(<TextField key="awayTeamName" label="Away team name (shown in cue copy)" value={cfg.awayTeamName || ''} placeholder="COUGARS" onChange={(v) => setField({ awayTeamName: v })} />);
            fields.push(<ColorField key="homeColor" label="Home celebration color" value={cfg.homeColor || '#3b82f6'} onChange={(v) => setField({ homeColor: v })} />);
            fields.push(<ColorField key="awayColor" label="Away celebration color" value={cfg.awayColor || '#ef4444'} onChange={(v) => setField({ awayColor: v })} />);
            fields.push(<NumField key="durationMs" id="cts-orch-dur" label="Scene duration (ms)" value={typeof cfg.durationMs === 'number' ? cfg.durationMs : 6000} onChange={(v) => setField({ durationMs: v })} min={2000} max={30000} step={500} />);
            // Per-event cue decks. Each is a textarea of cue IDs, one per line.
            const cuesObj = (cfg.cues && typeof cfg.cues === 'object') ? cfg.cues : {};
            const decks: Array<{ key: 'homeGoal' | 'awayGoal' | 'periodEnd' | 'horn'; label: string; testTeam: 'home' | 'away' | 'horn'; testLabel: string; defaults: string[] }> = [
              { key: 'homeGoal', label: 'On home goal — cue rotation', testTeam: 'home', testLabel: 'Home goal', defaults: ['CEL_SOCCER_GOAL', 'CEL_HOCKEY_GOAL', 'CEL_LX_GOAL'] },
              { key: 'awayGoal', label: 'On away goal — cue rotation', testTeam: 'away', testLabel: 'Away goal', defaults: ['CEL_HOCKEY_GOAL', 'CEL_SOCCER_GOAL'] },
              { key: 'periodEnd', label: 'On period change — cue rotation', testTeam: 'horn', testLabel: 'Period end', defaults: ['CEL_FOOTBALL_TOUCHDOWN', 'CEL_BASKETBALL_BUZZER'] },
              { key: 'horn', label: 'On horn rising edge — cue rotation', testTeam: 'horn', testLabel: 'Horn', defaults: ['CEL_FOOTBALL_TOUCHDOWN'] },
            ];
            for (const d of decks) {
              const list = Array.isArray((cuesObj as any)[d.key]) ? (cuesObj as any)[d.key] as string[] : d.defaults;
              const text = list.join('\n');
              fields.push(<TextAreaField key={`cues-${d.key}`} label={d.label} value={text} placeholder={d.defaults.join('\n')} rows={3} onChange={(v) => {
                const newList = v.split('\n').map((s) => s.trim()).filter(Boolean);
                setField({ cues: { ...cuesObj, [d.key]: newList } });
              }} />);
              fields.push(
                <div key={`cues-${d.key}-test`} style={{ marginTop: -4, marginBottom: 8 }}>
                  {ctsTestButton(d.testLabel, d.testTeam)}
                </div>,
              );
            }
            // Cue ID reference — show every available cue so operators
            // know what they can type into the deck textareas.
            const cueLabelsMap = CTS_CUE_LABELS_LOCAL as unknown as Record<string, string>;
            const allCues = Object.keys(cueLabelsMap);
            fields.push(
              <details key="cue-ref" style={{ marginTop: 12, padding: 8, background: '#0f172a', borderRadius: 6, color: '#cbd5e1' }}>
                <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Available cue IDs ({allCues.length})</summary>
                <ul style={{ margin: '8px 0 0 0', padding: '0 0 0 16px', fontSize: 11, lineHeight: 1.5 }}>
                  {allCues.map((id) => (
                    <li key={id}><code style={{ background: '#1e293b', padding: '1px 5px', borderRadius: 3 }}>{id}</code> — {cueLabelsMap[id]}</li>
                  ))}
                </ul>
              </details>,
            );
            break;
          }

          default:
            // Unknown CTS variant — show the legacy fields as a fallback.
            fields.push(ctsBanner('Unknown CTS variant. Fields below are generic.', 'config'));
            break;
        }
        break;
      }
      // Legacy generic scoreboard widget — literal fields.
      fields.push(<TextField key="status" label="Status" value={cfg.status || ''} placeholder="Tonight" onChange={(v) => setField({ status: v })} />);
      fields.push(<TextField key="period" label="Period / time" value={cfg.period || ''} placeholder="1ST · 8:42" onChange={(v) => setField({ period: v })} />);
      fields.push(<TextField key="homeName" label="Home team" value={cfg.homeName || ''} placeholder="Eagles" onChange={(v) => setField({ homeName: v })} />);
      fields.push(<TextField key="awayName" label="Away team" value={cfg.awayName || ''} placeholder="Cougars" onChange={(v) => setField({ awayName: v })} />);
      fields.push(<TextField key="homeScore" label="Home score" value={String(cfg.homeScore ?? '')} placeholder="0" onChange={(v) => setField({ homeScore: parseInt(v) || 0 })} />);
      fields.push(<TextField key="awayScore" label="Away score" value={String(cfg.awayScore ?? '')} placeholder="0" onChange={(v) => setField({ awayScore: parseInt(v) || 0 })} />);
      break;
    }
    case 'SCHEDULE_GRID':
      fields.push(<TextField key="title" label="Title" value={cfg.title || ''} placeholder="Today's Schedule" onChange={(v) => setField({ title: v })} />);
      // 2026-05-28 (§19) — was a pipe-delimited `num | name | time` textarea.
      // ScheduleGridWidget reads cfg.periods as { num, name, time }[] (max 8).
      // ScheduleRowsField renders time + name (+ optional room) per row and
      // auto-renumbers `num` to a stable 1..N, which is exactly the widget's
      // period-badge contract. A legacy `{num,name,time}[]` array loads
      // straight in (Array.isArray passthrough); `room` is preserved if
      // present and ignored by the widget. The pipe `num` is dropped in
      // favor of the row position so reorder keeps the badges tidy.
      fields.push(<ScheduleRowsField key="periods" label="Periods" value={Array.isArray(cfg.periods) ? cfg.periods : []} onChange={(v) => setField({ periods: v })} />);
      break;
    case 'ATTENDANCE':
      fields.push(<TextField key="title" label="Title" value={cfg.title || ''} placeholder="Attendance Today" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="presentPct" label="Present percentage" value={String(cfg.presentPct ?? '')} placeholder="97" onChange={(v) => setField({ presentPct: parseFloat(v) || 0 })} />);
      fields.push(<TextField key="totalStudents" label="Total students" value={String(cfg.totalStudents ?? '')} placeholder="624" onChange={(v) => setField({ totalStudents: parseInt(v) || 0 })} />);
      break;
    case 'BIRTHDAYS':
      fields.push(<TextField key="title" label="Title" value={cfg.title || ''} placeholder="Happy Birthday!" onChange={(v) => setField({ title: v })} />);
      // 2026-05-28 (§19) — was a one-name-per-line textarea. BirthdaysWidget
      // (and the rainbow-animated variant) read cfg.birthdays as string[]
      // (max 5 show). StringListEditor gives each name its own input with
      // add / remove / reorder and accepts a legacy array OR JSON string.
      fields.push(<StringListEditor key="birthdays" label="Names" itemNoun="name" placeholder="Morgan P." help="Each name shows on its own line. Up to 5 display." value={cfg.birthdays} onChange={(v) => setField({ birthdays: v })} />);
      break;
    case 'HONOR_ROLL':
      fields.push(<TextField key="title" label="Title" value={cfg.title || ''} placeholder="Honor Roll" onChange={(v) => setField({ title: v })} />);
      // 2026-05-28 (§19) — was a pipe-delimited `name | reason` textarea.
      // HonorRollWidget reads cfg.students as { name, reason }[] (max 5).
      // ListItemsEditor accepts a parsed array OR a legacy JSON string.
      fields.push(<ListItemsEditor key="students" label="Students" itemNoun="student" help="Each row is one honoree — their name and the reason. Up to 5 show." value={cfg.students} onChange={(v) => setField({ students: v })} newItem={{ name: '', reason: '' }} fields={[
        { key: 'name', label: 'Name', type: 'text', placeholder: 'Jordan Lee' },
        { key: 'reason', label: 'Reason', type: 'text', placeholder: 'Perfect attendance' },
      ]} />);
      break;
    case 'LOGO':
      fields.push(<TextField key="initials" label="Initials" value={cfg.initials || ''} placeholder="SE" onChange={(v) => setField({ initials: v })} />);
      fields.push(<TextField key="schoolName" label="School name (optional)" value={cfg.schoolName || ''} placeholder="Sunnyside Elementary" onChange={(v) => setField({ schoolName: v })} />);
      // 2026-05-03 — v2 LOGO_* variants read `c.logoUrl` not `assetUrl`.
      // Mirror BOTH so legacy + v2 see the same picked image. Renderer
      // priority: image first, then mascot/emoji fallback.
      fields.push(<AssetPickerField key="assetUrl" label="Logo image (optional)" value={cfg.assetUrl || cfg.logoUrl || ''} kind="image" onChange={(v) => setField({ assetUrl: v, logoUrl: v })} />);
      // v2 extras — tagline, established year, mascot emoji. Optional;
      // legacy widget ignores them silently.
      fields.push(<TextField key="tagline" label="Tagline (optional)" value={cfg.tagline || ''} placeholder="Home of the Eagles" onChange={(v) => setField({ tagline: v })} />);
      fields.push(<TextField key="established" label="Established (optional)" value={cfg.established || ''} placeholder="EST. 1924" onChange={(v) => setField({ established: v })} />);
      fields.push(<TextField key="mascot" label="Mascot emoji (optional)" value={cfg.mascot || ''} placeholder="🦅" onChange={(v) => setField({ mascot: v })} />);
      break;
    case 'PHOTO_NEON':
    case 'PHOTO_PAPER':
    case 'PHOTO_CRAYON':
    case 'PHOTO_GLASS':
    case 'PHOTO_OPS': {
      // 2026-05-04 — operator: "under the imaghes tab, i picked an image
      // and nothing loaded, the second one has a spot for two images
      // but can only select one and nothing loads".
      // These v2 PHOTO_* widgets read `config.photos: { url, caption }[]`
      // (1, 3, 4, 5, or 6 slots depending on variant). The editor
      // previously fell through to the default case which doesn't write
      // to photos at all, so picking an image silently no-op'd.
      fields.push(<TextField key="title" label="Title" value={cfg.title || ''} placeholder="Our Memories!" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="rotateMs" label="Rotate every (ms — only used by Neon Glitch single-frame)" value={String(cfg.rotateMs || 4000)} placeholder="4000" onChange={(v) => setField({ rotateMs: parseInt(v) || 4000 })} />);
      fields.push(
        <PhotosArrayField
          key="photos"
          value={(cfg.photos || []) as Array<{ url?: string; caption?: string }>}
          onChange={(photos) => setField({ photos })}
        />,
      );
      break;
    }
    case 'IMAGE_CAROUSEL': {
      // 2026-05-09 — operator: "rotate ... not be in milliseconds"
      // + "i should be able to control the transitions for everything".
      // Switched the rotation field to seconds (more human-friendly,
      // 5s default), and added a transition picker. We persist BOTH
      // ms shapes (intervalMs + rotateMs) for backward compat with
      // every legacy/themed carousel that already reads them.
      const currentMs = cfg.intervalMs || cfg.rotateMs || (cfg.intervalSec ? cfg.intervalSec * 1000 : 5000);
      const currentSec = Math.max(1, Math.round(currentMs / 1000));
      fields.push(<TextField key="title" label="Caption" value={cfg.title || ''} placeholder="Photo Gallery" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="intervalSec" label="Show each photo for (seconds)" value={String(currentSec)} placeholder="5" onChange={(v) => { const s = Math.max(1, parseInt(v) || 5); const ms = s * 1000; setField({ intervalSec: s, intervalMs: ms, rotateMs: ms }); }} />);
      fields.push(<SelectField key="transition" label="Transition between photos" value={cfg.transition || 'fade'} options={[['fade','Fade'],['slide-left','Slide left'],['slide-right','Slide right'],['slide-up','Slide up'],['zoom','Zoom in'],['cut','Cut (no animation)']]} onChange={(v) => setField({ transition: v })} />);
      fields.push(<SelectField key="fitMode" label="Image fit" value={cfg.fitMode || 'cover'} options={[['cover','Fill (crop)'],['contain','Fit (no crop)']]} onChange={(v) => setField({ fitMode: v })} />);
      // v2 PHOTO_* widgets read `c.photos: { url, caption }[]` — mirror
      // the asset url list into the structured shape so v2 carousel
      // variants render the same images plus an empty caption (which
      // legacy carousel variants never showed anyway).
      fields.push(<AssetListPickerField key="urls" label="Photos" value={(cfg.urls || cfg.assetUrls || []) as string[]} kind="image" onChange={(v) => setField({ urls: v, assetUrls: undefined, photos: v.map((url) => ({ url, caption: '' })) })} />);
      break;
    }
    case 'IMAGE':
      fields.push(<AssetPickerField key="assetUrl" label="Image" value={cfg.assetUrl || cfg.imageUrl || ''} kind="image" onChange={(v) => setField({ assetUrl: v, imageUrl: undefined })} />);
      fields.push(<SelectField key="fitMode" label="Fit" value={cfg.fitMode || 'cover'} options={[['cover','Fill (crop)'],['contain','Fit (no crop)']]} onChange={(v) => setField({ fitMode: v })} />);
      // Opacity + corner radius (moved here from the removed floating pill —
      // ImageWidget reads cfg.opacity + cfg.borderRadius).
      fields.push(<NumField key="opacity" id="img-opacity" label="Opacity (0–1)" value={typeof cfg.opacity === 'number' ? cfg.opacity : 1} onChange={(v) => setField({ opacity: v })} min={0} max={1} step={0.05} />);
      fields.push(<NumField key="borderRadius" id="img-radius" label="Corner radius (px)" value={typeof cfg.borderRadius === 'number' ? cfg.borderRadius : 0} onChange={(v) => setField({ borderRadius: v })} min={0} max={120} step={1} />);
      fields.push(<TextField key="assetName" label="Alt text (for screen readers)" value={cfg.assetName || ''} placeholder="School logo" onChange={(v) => setField({ assetName: v })} />);
      break;
    case 'VIDEO':
      fields.push(<AssetPickerField key="assetUrl" label="Video" value={cfg.assetUrl || cfg.url || ''} kind="video" onChange={(v) => setField({ assetUrl: v, url: undefined })} />);
      fields.push(<SelectField key="fitMode" label="Fit" value={cfg.fitMode || 'cover'} options={[['cover','Fill screen (crop)'],['contain','Fit (letterbox)']]} onChange={(v) => setField({ fitMode: v })} />);
      fields.push(<NumField key="opacity" id="vid-opacity" label="Opacity (0–1)" value={typeof cfg.opacity === 'number' ? cfg.opacity : 1} onChange={(v) => setField({ opacity: v })} min={0} max={1} step={0.05} />);
      fields.push(<NumField key="borderRadius" id="vid-radius" label="Corner radius (px)" value={typeof cfg.borderRadius === 'number' ? cfg.borderRadius : 0} onChange={(v) => setField({ borderRadius: v })} min={0} max={120} step={1} />);
      fields.push(<ToggleField key="autoplay" label="Autoplay" value={cfg.autoplay !== false} onChange={(v) => setField({ autoplay: v })} />);
      fields.push(<ToggleField key="loop" label="Loop" value={cfg.loop !== false} onChange={(v) => setField({ loop: v })} />);
      fields.push(<ToggleField key="muted" label="Muted" value={cfg.muted !== false} onChange={(v) => setField({ muted: v })} />);
      break;
    case 'VIDEO_CAROUSEL':
      // 2026-05-09 — operator: "rotate should only be for pictures
      // not videos ... those should auto rotate". Reworked: the
      // carousel advances when a clip ENDS (onEnded), not on a fixed
      // timer. No rotate-every-N-seconds field — videos play through
      // and naturally advance. Added a transition picker per
      // operator's "control the transitions for everything". The
      // single-clip "loop" toggle is gone too — looping a single
      // video would never let it end → carousel would never rotate.
      // Multi-clip is the carousel's whole purpose; loop the WHOLE
      // PLAYLIST (last clip → first clip) is the only meaningful
      // loop and it's on by default.
      fields.push(<TextField key="title" label="Caption (editor only)" value={cfg.title || ''} placeholder="Promo Reel" onChange={(v) => setField({ title: v })} />);
      fields.push(<SelectField key="transition" label="Transition between clips" value={cfg.transition || 'fade'} options={[['fade','Fade'],['slide-left','Slide left'],['slide-right','Slide right'],['slide-up','Slide up'],['cut','Cut (no animation)']]} onChange={(v) => setField({ transition: v })} />);
      fields.push(<SelectField key="fitMode" label="Video fit" value={cfg.fitMode || 'contain'} options={[['contain','Fit (no crop)'],['cover','Fill (crop)']]} onChange={(v) => setField({ fitMode: v })} />);
      fields.push(<AssetListPickerField key="urls" label="Videos" value={(cfg.assetUrls || cfg.urls || []) as string[]} kind="video" onChange={(v) => setField({ assetUrls: v, urls: v })} />);
      fields.push(<ToggleField key="muted" label="Muted (required for autoplay)" value={cfg.muted !== false} onChange={(v) => setField({ muted: v })} />);
      break;
    case 'WEBPAGE':
      fields.push(<TextField key="url" label="Web page URL" value={cfg.url || cfg.embedUrl || ''} placeholder="https://example.com" onChange={(v) => setField({ url: v, embedUrl: undefined })} />);
      fields.push(<TextField key="refreshIntervalMs" label="Auto-refresh every (ms, 0 = never)" value={String(cfg.refreshIntervalMs ?? 0)} placeholder="0" onChange={(v) => setField({ refreshIntervalMs: parseInt(v) || 0 })} />);
      break;

    case 'TOUCH_POINT': {
      // Phase D2.12 (2026-05-12) — operator: "these icons arent
      // editable... we are getting close but these need to be
      // completely editable and customizable to be usable."
      //
      // The widget itself reads config.color, config.bgColor,
      // config.label, and config.qrText (qr variant only). Every
      // variant supports color overrides; only the labeled +
      // qr variants get text inputs.
      let normalizedVariant = String(cfg.variant || 'hotspot').toLowerCase();
      if (normalizedVariant.startsWith('touch-')) normalizedVariant = normalizedVariant.slice('touch-'.length);

      // Hotspot is invisible — no color/label knobs make sense.
      if (normalizedVariant === 'hotspot' || normalizedVariant === '') {
        fields.push(
          <div key="hotspot-help" className="text-[11px] text-slate-500 bg-slate-50/80 border border-slate-100 rounded-lg px-3 py-2 leading-snug">
            <strong>Transparent hotspot.</strong> Renders invisible at runtime — the dashed outline you see in the editor is just for positioning. Wire its Tap Action below.
          </div>
        );
        break;
      }

      const labeledVariants = new Set(['tap-prompt', 'square', 'back', 'next', 'print']);
      if (labeledVariants.has(normalizedVariant)) {
        const defaultLabel = normalizedVariant === 'tap-prompt' ? 'Tap to continue'
          : normalizedVariant === 'back' ? 'Back'
          : normalizedVariant === 'next' ? 'Next'
          : normalizedVariant === 'print' ? 'Print'
          : 'Tap';
        fields.push(
          <TextField
            key="label"
            label="Button label"
            value={cfg.label ?? ''}
            placeholder={defaultLabel}
            onChange={(v) => setField({ label: v })}
          />
        );
      }

      if (normalizedVariant === 'qr') {
        fields.push(
          <TextField
            key="qrText"
            label="QR encodes this URL / text"
            value={cfg.qrText ?? ''}
            placeholder="https://example.com or any text"
            onChange={(v) => setField({ qrText: v })}
          />
        );
        fields.push(
          <p key="qr-help" className="text-[10px] text-slate-500 -mt-1 leading-snug">
            The visible QR code regenerates as you type. Phone cameras scan it directly — no Tap Action needed (but you can still add one if you want a fallback for visitors who can't scan).
          </p>
        );
      }

      // Color customization. allowTransparent on the bgColor picker
      // surfaces a "Clear" button that sets bgColor to 'transparent';
      // the renderer treats that as "ghost mode" — no disc/pill fill,
      // no shadow, just the icon glyph floating at the chosen color.
      // Operator: "once you set a device to a color i see no way to
      // go back to transparency." This is the way back.
      //
      // The icon color picker also allows transparent but 'transparent'
      // on color means "inherit the default" (an actually-invisible
      // icon is useless; treat it as a reset signal instead).
      fields.push(
        <ColorPickerField
          key="color"
          label="Icon color"
          value={cfg.color || ''}
          onChange={(v) => setField({ color: v || undefined })}
          allowTransparent
        />
      );
      fields.push(
        <ColorPickerField
          key="bgColor"
          label="Button background (optional)"
          value={cfg.bgColor === 'transparent' ? '' : (cfg.bgColor || '')}
          onChange={(v) => setField({ bgColor: v ? v : 'transparent' })}
          allowTransparent
        />
      );
      fields.push(
        <p key="reset-tip" className="text-[10px] text-slate-400 -mt-1 leading-snug">
          Touch widgets render <strong>icon-only</strong> by default — the zone stays transparent.
          <br />
          <strong>Add a button background</strong> by picking a color above; an inscribed circular disc paints behind the icon.
          <br />
          <strong>Clear icon color</strong> to fall back to the tenant brand color.
        </p>
      );
      break;
    }
    case 'BELL_SCHEDULE':
      fields.push(<TextField key="title" label="Title" value={cfg.title || ''} placeholder="Bell Schedule" onChange={(v) => setField({ title: v })} />);
      fields.push(
        <BellScheduleEditor
          key="schedule"
          value={bellScheduleForEditor(cfg.schedule || (cfg.periods as any))}
          onChange={(schedule) => setField({
            // Legacy widget shape — old BellScheduleWidget +
            // GymPEBellSchedule + MSHallBellSchedule all read
            // config.schedule with {label, start, end}.
            schedule,
            // 2026-05-03 — v2 BellSchedule widgets
            // (BellNeonPit, BellPaperProgram, BellCrayonDayplan,
            // BellGlassTimetable, BellOpsDispatch) read
            // config.periods with shape
            //   {num, label, room, startTime, endTime}
            // Mirror the editor's schedule into that shape so
            // edits show up on the canvas regardless of which
            // bell variant the user picked. Operator (2026-05-03):
            // "i tried to update a bell schedule and I change the
            // time in the left tool bar but nothing changes on the
            // canvas".
            periods: schedule.map((p, i) => ({
              num: String(i + 1),
              label: p.label,
              startTime: p.start,
              endTime: p.end,
            })),
          })}
        />
      );
      break;
    case 'PLAYLIST':
      fields.push(<PlaylistPickerField key="playlistId" label="Playlist" value={cfg.playlistId || ''} onChange={(v) => setField({ playlistId: v })} />);
      break;
    case 'RSS_FEED':
      fields.push(<TextField key="url" label="RSS feed URL" value={cfg.url || ''} placeholder="https://example.com/rss.xml" onChange={(v) => setField({ url: v })} />);
      fields.push(<TextField key="maxItems" label="Max items" value={String(cfg.maxItems || 5)} placeholder="5" onChange={(v) => setField({ maxItems: parseInt(v) || 5 })} />);
      break;
    case 'SOCIAL_FEED':
      fields.push(<TextField key="url" label="Profile / feed URL" value={cfg.url || ''} placeholder="https://twitter.com/sunnyside_elem" onChange={(v) => setField({ url: v })} />);
      fields.push(<TextField key="maxItems" label="Max posts to show" value={String(cfg.maxItems || 5)} placeholder="5" onChange={(v) => setField({ maxItems: parseInt(v) || 5 })} />);
      break;
    // Sprint 11h pre-launch — Holiday lobby pack picker. Operator can
    // swap the holiday + grade level on a placed HOLIDAY zone without
    // creating a new template. Iframe re-mounts on variant change so
    // the new HTML loads cleanly.
    case 'HOLIDAY': {
      const holidayOptions: Array<[string, string]> = [
        ['halloween',    '🎃 Halloween'],
        ['thanksgiving', '🦃 Thanksgiving'],
        ['christmas',    '🎄 Christmas'],
        ['valentines',   "💝 Valentine's Day"],
        ['stpatricks',   "☘️ St. Patrick's"],
        ['easter',       '🐰 Easter'],
      ];
      const gradeOptions: Array<[string, string]> = [
        ['es', 'Elementary'],
        ['ms', 'Middle School'],
        ['hs', 'High School'],
      ];
      const holidayStyles = mergeHolidayTextStyleMaps(cfg.__styles, cfg._styles);
      fields.push(
        <SelectField
          key="variant"
          label="Holiday"
          value={cfg.variant || 'christmas'}
          options={holidayOptions}
          onChange={(v) => setField({ variant: v })}
        />,
      );
      fields.push(
        <SelectField
          key="gradeLevel"
          label="Grade level"
          value={cfg.gradeLevel || 'es'}
          options={gradeOptions}
          onChange={(v) => setField({ gradeLevel: v })}
        />,
      );
      // HolidayPanelExtras pulls the field schema from the static
      // HOLIDAY_FIELD_SCHEMA map exported by HolidayWidget — synchronous
      // render so operators see editable fields the moment they click
      // the zone (no race with iframe-bridge holiday:ready postMessage,
      // which had been dropping the schema for newly-mounted panels and
      // showing "Loading editable fields…" forever — user reported as
      // "this has no hot spot at all" on HS Thanksgiving 2026-05-07).
      // setField writes to cfg.fields[key] which HolidayWidget then
      // posts to the iframe — the iframe's bridge updates textContent.
      fields.push(
        <HolidayPanelExtras
          key="holiday-extras"
          variant={(cfg.variant || 'christmas') as HolidayVariant}
          gradeLevel={(cfg.gradeLevel || 'es') as HolidayGradeLevel}
          values={(cfg.fields || {}) as Record<string, string>}
          onFieldChange={(key, value) => {
            const next = { ...(cfg.fields || {}), [key]: value };
            setField({ fields: next });
          }}
          styles={holidayStyles as FieldStyleMap}
          // StyleableField now targets the app-wide `_styles` transport.
          // Clearing the legacy map here makes a future direct caller migrate
          // atomically instead of letting an old value reappear underneath.
          onStylesChange={(s) => setField({ _styles: s, __styles: {} })}
        />,
      );
      break;
    }
    // Sprint 11h decorations — variant picker + per-variant tuning.
    case 'DECORATION': {
      const variantOptions: Array<[string, string]> = [
        ['confetti', 'Confetti'],
        ['rainbow-ribbon', 'Rainbow Ribbon'],
        ['balloons', 'Balloons'],
        ['clouds', 'Clouds'],
        ['sparkles', 'Sparkles'],
        ['ticker', 'Marquee Ticker'],
        ['neon-buzz', 'Neon Buzz'],
        ['pulse-glow', 'Pulse Glow'],
      ];
      // Normalize `decoration-<key>` registry ids (Wave B B3 palette tiles
      // write the namespaced id into cfg.variant) back to the bare key so
      // the Style select + per-variant conditionals below keep matching.
      const v = String(cfg.variant || 'confetti').replace(/^decoration-/, '');
      fields.push(
        <SelectField
          key="variant"
          label="Style"
          value={v}
          options={variantOptions}
          onChange={(val) => setField({ variant: val })}
        />,
      );
      // Speed slider — universal across variants. 0.5 = lazy, 2 = brisk.
      fields.push(
        <NumField
          key="speed"
          id="dec-speed"
          label="Speed (×)"
          value={typeof cfg.speed === 'number' ? cfg.speed : 1}
          onChange={(val) => setField({ speed: val })}
          min={0.25}
          max={4}
          step={0.25}
        />,
      );
      // Particle-count slider for variants that have particles.
      if (v === 'confetti' || v === 'balloons' || v === 'sparkles') {
        const max = v === 'confetti' ? 80 : v === 'sparkles' ? 40 : 12;
        const fallback = v === 'confetti' ? 60 : v === 'sparkles' ? 24 : 8;
        fields.push(
          <NumField
            key="count"
            id="dec-count"
            label="Particle count"
            value={typeof cfg.count === 'number' ? cfg.count : fallback}
            onChange={(val) => setField({ count: val })}
            min={3}
            max={max}
            step={1}
          />,
        );
      }
      // Text content for the variants that show text.
      if (v === 'ticker' || v === 'neon-buzz') {
        fields.push(
          <TextField
            key="text"
            label="Text"
            value={cfg.text || ''}
            placeholder={v === 'ticker' ? 'Welcome · Have a wonderful day · Stay curious' : 'OPEN'}
            onChange={(val) => setField({ text: val })}
          />,
        );
      }
      // Glow color for variants that have a glow.
      if (v === 'neon-buzz' || v === 'pulse-glow') {
        fields.push(
          <ColorField
            key="glowColor"
            label="Glow color"
            value={cfg.glowColor || (v === 'neon-buzz' ? '#f0abfc' : '#fbbf24')}
            onChange={(val) => setField({ glowColor: val })}
          />,
        );
      }
      // Opacity — universal.
      fields.push(
        <NumField
          key="opacity"
          id="dec-opacity"
          label="Opacity (0–1)"
          value={typeof cfg.opacity === 'number' ? cfg.opacity : 1}
          onChange={(val) => setField({ opacity: val })}
          min={0}
          max={1}
          step={0.05}
        />,
      );
      break;
    }
    // Wave B / editor-crush B2 (2026-07-02) — static SHAPE elements.
    // Fill/border ColorFields ride ColorPickerField, so the "Brand
    // primary"/"Brand accent" presets (var(--brand-primary) etc.) come
    // for free — §19 brand-palette honoring.
    case 'SHAPE': {
      const shapeOptions: Array<[string, string]> = SHAPE_KINDS.map((s) => [s.key, s.label] as [string, string]);
      const shape = cfg.shape || 'rectangle';
      fields.push(
        <SelectField
          key="shape"
          label="Shape"
          value={shape}
          options={shapeOptions}
          onChange={(val) => setField({ shape: val })}
        />,
      );
      fields.push(
        <ColorField
          key="fill"
          label={shape === 'line' || shape === 'arrow' ? 'Line color' : 'Fill color'}
          value={cfg.fill || ''}
          onChange={(val) => setField({ fill: val })}
        />,
      );
      // Border only makes sense on filled shapes; for line/arrow the
      // stroke IS the shape (borderWidth doubles as line thickness).
      if (shape === 'line' || shape === 'arrow') {
        fields.push(
          <NumField
            key="borderWidth"
            id="shape-thickness"
            label="Line thickness (px)"
            value={typeof cfg.borderWidth === 'number' ? cfg.borderWidth : 4}
            onChange={(val) => setField({ borderWidth: val })}
            min={1}
            max={24}
            step={1}
          />,
        );
      } else {
        fields.push(
          <ColorField
            key="borderColor"
            label="Border color (empty = no border)"
            value={cfg.borderColor || ''}
            onChange={(val) => setField({ borderColor: val })}
            allowTransparent
          />,
        );
        fields.push(
          <NumField
            key="borderWidth"
            id="shape-border-width"
            label="Border width (px)"
            value={typeof cfg.borderWidth === 'number' ? cfg.borderWidth : 0}
            onChange={(val) => setField({ borderWidth: val })}
            min={0}
            max={24}
            step={1}
          />,
        );
      }
      if (shape === 'rectangle') {
        fields.push(
          <NumField
            key="radius"
            id="shape-radius"
            label="Corner radius (px)"
            value={typeof cfg.radius === 'number' ? cfg.radius : 12}
            onChange={(val) => setField({ radius: val })}
            min={0}
            max={100}
            step={1}
          />,
        );
      }
      fields.push(
        <NumField
          key="opacity"
          id="shape-opacity"
          label="Opacity (0–1)"
          value={typeof cfg.opacity === 'number' ? cfg.opacity : 1}
          onChange={(val) => setField({ opacity: val })}
          min={0}
          max={1}
          step={0.05}
        />,
      );
      break;
    }
    // Wave B / editor-crush B5 (2026-07-02) — lucide icon element with a
    // searchable picker (~1500 names, lazy-loaded per icon).
    case 'ICON': {
      fields.push(
        <IconPickerField
          key="icon"
          value={cfg.icon || ''}
          onChange={(val) => setField({ icon: val })}
        />,
      );
      fields.push(
        <ColorField
          key="color"
          label="Icon color"
          value={cfg.color || ''}
          onChange={(val) => setField({ color: val })}
        />,
      );
      fields.push(
        <NumField
          key="strokeWidth"
          id="icon-stroke-width"
          label="Stroke width"
          value={typeof cfg.strokeWidth === 'number' ? cfg.strokeWidth : 2}
          onChange={(val) => setField({ strokeWidth: val })}
          min={0.5}
          max={4}
          step={0.25}
        />,
      );
      fields.push(
        <NumField
          key="opacity"
          id="icon-opacity"
          label="Opacity (0–1)"
          value={typeof cfg.opacity === 'number' ? cfg.opacity : 1}
          onChange={(val) => setField({ opacity: val })}
          min={0}
          max={1}
          step={0.05}
        />,
      );
      break;
    }
    case 'ANIMATED_WELCOME_MS':
    case 'ANIMATED_WELCOME_MS_PORTRAIT':
    case 'ANIMATED_WELCOME_HS':
    case 'ANIMATED_WELCOME_HS_PORTRAIT':
    case 'ANIMATED_WELCOME': {
      // All ANIMATED_WELCOME variants share the same config shape —
      // Elementary / Middle / High School, landscape AND portrait — so
      // the editor + hotspot section IDs are reused verbatim. The widget
      // component picks the theme + orientation; the fields are identical.
      // (Portrait widgets are layout-only ports — same config keys.)
      // Section headings double as scroll-into-view targets so when the
      // user clicks a hotspot in the rendered preview, the panel jumps
      // to the matching section. Each header carries an id like
      // 'aw-section-weather' that the AnimatedWelcomeWidget's hotspot
      // dispatches against. data-aw-section also enables the brief
      // pink-ring highlight pulse on activation.
      const SH = (key: string, label: string) => (
        <div
          key={`sh-${key}`}
          id={`aw-section-${key}`}
          data-aw-section={key}
          className="aw-section-header pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200 scroll-mt-24 transition-shadow"
        >
          {label}
        </div>
      );
      fields.push(SH('header', 'Header'));
      fields.push(<AssetPickerField key="logoUrl" label="Logo (upload your school crest)" value={cfg.logoUrl || ''} kind="image" onChange={(v) => setField({ logoUrl: v })} />);
      fields.push(<TextField key="title" label="Big title" value={cfg.title || ''} placeholder="Welcome, Friends!" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="subtitle" label="Subtitle" value={cfg.subtitle || ''} placeholder="today is going to be amazing ✨" onChange={(v) => setField({ subtitle: v })} />);
      // Clock timezone — defaults to player's local timezone if blank.
      fields.push(
        <div key="clockTimeZone" className="space-y-1">
          {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control +
              axe-core "Select element must have an accessible name". Static
              id is safe: this exact block is duplicated per widget type in
              this file's per-widget-type field builder, but each widget
              type's fields render mutually exclusively. */}
          <label htmlFor="pp-clock-timezone" className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Clock timezone (blank = use player's local time)</label>
          <select
            id="pp-clock-timezone"
            value={cfg.clockTimeZone || ''}
            onChange={(e) => setField({ clockTimeZone: e.target.value })}
            className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          >
            <option value="">Use player's local time (default)</option>
            <option value="America/New_York">Eastern (New York)</option>
            <option value="America/Chicago">Central (Chicago)</option>
            <option value="America/Denver">Mountain (Denver)</option>
            <option value="America/Phoenix">Arizona (no DST)</option>
            <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
            <option value="America/Anchorage">Alaska</option>
            <option value="Pacific/Honolulu">Hawaii</option>
            <option value="UTC">UTC</option>
          </select>
        </div>
      );

      fields.push(SH('weather', 'Weather — auto-detected from the player'));
      fields.push(<TextField key="weatherLocation" label="ZIP code override (leave blank to auto-detect)" value={cfg.weatherLocation || ''} placeholder="auto-detect" onChange={(v) => setField({ weatherLocation: v })} />);
      fields.push(<SelectField key="weatherUnits" label="Units" value={cfg.weatherUnits || 'imperial'} options={[['imperial','°F'],['metric','°C']]} onChange={(v) => setField({ weatherUnits: v })} />);

      fields.push(SH('announcement', 'Big announcement (center cloud)'));
      fields.push(<TextField key="announcementLabel" label="Small label" value={cfg.announcementLabel || ''} placeholder="Big News" onChange={(v) => setField({ announcementLabel: v })} />);
      fields.push(<TextAreaField key="announcementMessage" label="Message" value={cfg.announcementMessage || ''} placeholder="Book Fair starts Monday!" onChange={(v) => setField({ announcementMessage: v })} />);

      fields.push(SH('countdown', 'Countdown — auto-counts down to a date'));
      fields.push(<TextField key="countdownLabel" label="Label (e.g. Spring Break in, Winter Break in, Graduation in)" value={cfg.countdownLabel || ''} placeholder="Field Trip in" onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(
        <div key="countdownDate" className="space-y-1">
          {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control.
              Static id safe: duplicated per widget type, mutually exclusive
              rendering (see the clock-timezone block above). */}
          <label htmlFor="pp-countdown-date" className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Target date</label>
          <input
            id="pp-countdown-date"
            type="date"
            value={cfg.countdownDate || ''}
            onChange={(e) => setField({ countdownDate: e.target.value })}
            className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>
      );

      fields.push(SH('teacher', 'Teacher of the Week (polaroid)'));
      fields.push(<TextField key="teacherRole" label="Caption above (the washi tape)" value={cfg.teacherRole || ''} placeholder="Teacher of the Week" onChange={(v) => setField({ teacherRole: v })} />);
      fields.push(<TextField key="teacherName" label="Name" value={cfg.teacherName || ''} placeholder="Mrs. Johnson" onChange={(v) => setField({ teacherName: v })} />);
      fields.push(<AssetPickerField key="teacherPhotoUrl" label="Upload photo (recommended)" value={cfg.teacherPhotoUrl || ''} kind="image" onChange={(v) => setField({ teacherPhotoUrl: v })} />);
      fields.push(
        <div key="teacherGender" className="space-y-1">
          {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control.
              This heads a row of toggle <button>s, not a native form
              control a <label> can associate with — a group caption, same
              fix as the "Target date & time" heading above. */}
          <div className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Or pick an icon (used when no photo uploaded)</div>
          <div className="flex gap-2">
            {([
              { value: 'female', label: '👩‍🏫', name: 'She / Her' },
              { value: 'male',   label: '👨‍🏫', name: 'He / Him' },
            ] as const).map((opt) => {
              const selected = (cfg.teacherGender || 'female') === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setField({ teacherGender: opt.value })}
                  className={`flex-1 px-3 py-3 rounded-md border-2 transition flex flex-col items-center gap-1 ${selected ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 hover:border-slate-300 bg-white'}`}
                >
                  <span className="text-3xl leading-none">{opt.label}</span>
                  <span className="text-[11px] text-slate-600">{opt.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      );

      fields.push(SH('birthdays', 'Birthdays (balloon cluster)'));
      // Normalize to one-name-per-line for display so it's obvious how
      // to add another (just hit Enter). Save as a clean array.
      fields.push(
        <TextAreaField
          key="birthdayNames"
          label="Names — hit Enter to add another"
          value={(() => {
            const v = cfg.birthdayNames;
            if (Array.isArray(v)) return v.join('\n');
            if (typeof v === 'string') return v.split(/[\n,·]+/).map(s => s.trim()).filter(Boolean).join('\n');
            return '';
          })()}
          placeholder={'Maya\nEli\nSofia'}
          rows={5}
          onChange={(v) => setField({ birthdayNames: v.split(/[\n,·]+/).map((s: string) => s.trim()).filter(Boolean) })}
        />
      );

      fields.push(SH('ticker', 'Bottom ticker'));
      fields.push(<TextField key="tickerStamp" label="Pink label" value={cfg.tickerStamp || ''} placeholder="SCHOOL NEWS" onChange={(v) => setField({ tickerStamp: v })} />);
      fields.push(<TextAreaField key="tickerMessages" label="Scrolling messages (one per line)" value={Array.isArray(cfg.tickerMessages) ? cfg.tickerMessages.join('\n') : (cfg.tickerMessages || '')} placeholder="Welcome back, Stars!" rows={4} onChange={(v) => setField({ tickerMessages: v.split(/\n+/).filter(Boolean) })} />);
      fields.push(<TickerSpeedField key="tickerSpeed" value={cfg.tickerSpeed} onChange={(v) => setField({ tickerSpeed: v })} />);
      break;
    }
    case 'ANIMATED_CAFETERIA_PORTRAIT':
    case 'ANIMATED_CAFETERIA': {
      // Cafeteria template editor. Same hotspot scroll-into-view
      // contract as ANIMATED_WELCOME (aw-section-* ids + flash on
      // activation) but with cafeteria-specific sections: Special,
      // Menu (5 day tabs, unlimited items per day), Chef, etc.
      // Portrait shares the identical config shape — layout-only port.
      const SH = (key: string, label: string) => (
        <div
          key={`sh-${key}`}
          id={`aw-section-${key}`}
          data-aw-section={key}
          className="aw-section-header pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200 scroll-mt-24 transition-shadow"
        >
          {label}
        </div>
      );

      fields.push(SH('header', 'Header'));
      fields.push(<TextField key="title" label="Big title" value={cfg.title || ''} placeholder="LUNCH IS ON" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="subtitle" label="Subtitle" value={cfg.subtitle || ''} placeholder="~ freshly rolled every day ~" onChange={(v) => setField({ subtitle: v })} />);
      fields.push(
        <div key="clockTimeZone" className="space-y-1">
          {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control +
              axe-core "Select element must have an accessible name". Static
              id is safe: this exact block is duplicated per widget type in
              this file's per-widget-type field builder, but each widget
              type's fields render mutually exclusively. */}
          <label htmlFor="pp-clock-timezone" className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Clock timezone (blank = use player's local time)</label>
          <select
            id="pp-clock-timezone"
            value={cfg.clockTimeZone || ''}
            onChange={(e) => setField({ clockTimeZone: e.target.value })}
            className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          >
            <option value="">Use player's local time (default)</option>
            <option value="America/New_York">Eastern (New York)</option>
            <option value="America/Chicago">Central (Chicago)</option>
            <option value="America/Denver">Mountain (Denver)</option>
            <option value="America/Phoenix">Arizona (no DST)</option>
            <option value="America/Los_Angeles">Pacific (Los Angeles)</option>
            <option value="America/Anchorage">Alaska</option>
            <option value="Pacific/Honolulu">Hawaii</option>
            <option value="UTC">UTC</option>
          </select>
        </div>
      );

      fields.push(SH('special', "Today's Special"));
      fields.push(<TextField key="specialEmoji" label="Food emoji (🍕 🌮 🍔 🥪 🥗 🍝 🍗 🌯 🥨)" value={cfg.specialEmoji || ''} placeholder="🍕" onChange={(v) => setField({ specialEmoji: v })} />);
      fields.push(<TextField key="specialLabel" label="Small label" value={cfg.specialLabel || ''} placeholder="Pickup Special" onChange={(v) => setField({ specialLabel: v })} />);
      fields.push(<TextField key="specialName" label="Dish name" value={cfg.specialName || ''} placeholder="Cheesy Pepperoni" onChange={(v) => setField({ specialName: v })} />);

      fields.push(SH('menu', 'Weekly Menu'));
      fields.push(<WeekMenuEditor key="weekMenu" value={cfg.weekMenu} onChange={(weekMenu) => setField({ weekMenu })} />);

      fields.push(SH('countdown', 'Countdown'));
      fields.push(<TextField key="countdownEmoji" label="Event icon (🍕 🌮 🌶 🎂 🍗 etc)" value={cfg.countdownEmoji || ''} placeholder="🌮" onChange={(v) => setField({ countdownEmoji: v })} />);
      fields.push(<TextField key="countdownLabel" label="Label (e.g. Taco Tuesday in, Pizza Day in)" value={cfg.countdownLabel || ''} placeholder="Taco Tuesday in" onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(
        <div key="countdownDate" className="space-y-1">
          {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control.
              Static id safe: duplicated per widget type, mutually exclusive
              rendering (see the clock-timezone block above). */}
          <label htmlFor="pp-countdown-date" className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Target date</label>
          <input
            id="pp-countdown-date"
            type="date"
            value={cfg.countdownDate || ''}
            onChange={(e) => setField({ countdownDate: e.target.value })}
            className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
          />
        </div>
      );

      fields.push(SH('chef', 'Lunch Chef'));
      fields.push(<TextField key="chefName" label="Chef name" value={cfg.chefName || ''} placeholder="Ms. Rodriguez" onChange={(v) => setField({ chefName: v })} />);
      fields.push(<TextField key="chefRole" label="Caption under name" value={cfg.chefRole || ''} placeholder="lunch hero of the week" onChange={(v) => setField({ chefRole: v })} />);
      fields.push(<AssetPickerField key="chefPhotoUrl" label="Upload photo (optional)" value={cfg.chefPhotoUrl || ''} kind="image" onChange={(v) => setField({ chefPhotoUrl: v })} />);
      fields.push(<TextField key="chefEmoji" label="…or pick an emoji (👩‍🍳 👨‍🍳 🧑‍🍳 🍳)" value={cfg.chefEmoji || ''} placeholder="👩‍🍳" onChange={(v) => setField({ chefEmoji: v })} />);

      fields.push(SH('birthdays', 'Birthdays'));
      fields.push(
        <TextAreaField
          key="birthdayNames"
          label="Names — hit Enter to add another"
          value={(() => {
            const v = cfg.birthdayNames;
            if (Array.isArray(v)) return v.join('\n');
            if (typeof v === 'string') return v.split(/[\n,·]+/).map(s => s.trim()).filter(Boolean).join('\n');
            return '';
          })()}
          placeholder={'Alex\nJordan\nSam'}
          rows={5}
          onChange={(v) => setField({ birthdayNames: v.split(/[\n,·]+/).map((s: string) => s.trim()).filter(Boolean) })}
        />
      );

      fields.push(SH('ticker', 'Bottom ticker'));
      fields.push(<TextField key="tickerStamp" label="Stamp text" value={cfg.tickerStamp || ''} placeholder="Café News" onChange={(v) => setField({ tickerStamp: v })} />);
      fields.push(<TextAreaField key="tickerMessages" label="Scrolling messages (one per line)" value={Array.isArray(cfg.tickerMessages) ? cfg.tickerMessages.join('\n') : (cfg.tickerMessages || '')} placeholder="Taco Tuesday tomorrow! $3.50 tacos all day" rows={4} onChange={(v) => setField({ tickerMessages: v.split(/\n+/).filter(Boolean) })} />);
      fields.push(<TickerSpeedField key="tickerSpeed" value={cfg.tickerSpeed} onChange={(v) => setField({ tickerSpeed: v })} />);
      break;
    }
    case 'HS_VARSITY': {
      // Athletic lobby — Claude-designed high-school template. Every
      // widget on the canvas has its own editor row so the operator
      // can personalize for their school.
      // 2026-05-07 — placeholders sourced from DEFAULTS (single source
      // of truth — keeps form hint text in sync with the rendered
      // canvas if defaults ever change).
      const D = HS_VARSITY_DEFAULTS;
      const SH = (key: string, label: string) => (
        <div
          key={`sh-${key}`}
          className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200"
        >
          {label}
        </div>
      );
      fields.push(SH('school', 'School identity'));
      fields.push(<StyleableField key="schoolInitials" fieldName="schoolInitials" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Seal initials (3 letters)" value={cfg.schoolInitials || ''} placeholder={D.schoolInitials} onChange={(v) => setField({ schoolInitials: v })} />);
      fields.push(<StyleableField key="schoolEst" fieldName="schoolEst" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Seal year" value={cfg.schoolEst || ''} placeholder={D.schoolEst} onChange={(v) => setField({ schoolEst: v })} />);
      fields.push(<StyleableField key="schoolName" fieldName="schoolName" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="School name (all caps)" value={cfg.schoolName || ''} placeholder={D.schoolName} onChange={(v) => setField({ schoolName: v })} />);
      fields.push(<StyleableField key="department" fieldName="department" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Department label" value={cfg.department || ''} placeholder={D.department} onChange={(v) => setField({ department: v })} />);

      fields.push(SH('greeting', 'Jersey chest greeting'));
      fields.push(<StyleableField key="greetingEyebrow" fieldName="greetingEyebrow" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Eyebrow" value={cfg.greetingEyebrow || ''} placeholder={D.greetingEyebrow} onChange={(v) => setField({ greetingEyebrow: v })} />);
      fields.push(<StyleableField key="greetingHeadline" fieldName="greetingHeadline" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Big headline" value={cfg.greetingHeadline || ''} placeholder={D.greetingHeadline} onChange={(v) => setField({ greetingHeadline: v })} />);
      fields.push(<StyleableField key="greetingSubtitle" fieldName="greetingSubtitle" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Subtitle" value={cfg.greetingSubtitle || ''} placeholder={D.greetingSubtitle} onChange={(v) => setField({ greetingSubtitle: v })} />);

      fields.push(SH('scoreboard', 'Game of the week'));
      fields.push(<StyleableField key="scoreboardTag" fieldName="scoreboardTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Label" value={cfg.scoreboardTag || ''} placeholder={D.scoreboardTag} onChange={(v) => setField({ scoreboardTag: v })} />);
      fields.push(<StyleableField key="scoreboardSport" fieldName="scoreboardSport" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Sport / division" value={cfg.scoreboardSport || ''} placeholder={D.scoreboardSport} onChange={(v) => setField({ scoreboardSport: v })} />);
      fields.push(<StyleableField key="homeTeam" fieldName="homeTeam" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Home team" value={cfg.homeTeam || ''} placeholder={D.homeTeam} onChange={(v) => setField({ homeTeam: v })} />);
      fields.push(<StyleableField key="homeAbbr" fieldName="homeAbbr" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Home crest (3 letters)" value={cfg.homeAbbr || ''} placeholder={D.homeAbbr} onChange={(v) => setField({ homeAbbr: v })} />);
      fields.push(<StyleableField key="awayTeam" fieldName="awayTeam" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Away team" value={cfg.awayTeam || ''} placeholder={D.awayTeam} onChange={(v) => setField({ awayTeam: v })} />);
      fields.push(<StyleableField key="awayAbbr" fieldName="awayAbbr" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Away crest (3 letters)" value={cfg.awayAbbr || ''} placeholder={D.awayAbbr} onChange={(v) => setField({ awayAbbr: v })} />);
      fields.push(<StyleableField key="scoreboardTime" fieldName="scoreboardTime" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="When" value={cfg.scoreboardTime || ''} placeholder={D.scoreboardTime} onChange={(v) => setField({ scoreboardTime: v })} />);
      fields.push(<StyleableField key="scoreboardWhere" fieldName="scoreboardWhere" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Where" value={cfg.scoreboardWhere || ''} placeholder={D.scoreboardWhere} onChange={(v) => setField({ scoreboardWhere: v })} />);

      fields.push(SH('stats', 'Stat row (clock / weather / record / attendance)'));
      fields.push(<SelectField key="clockTimezone" label="Clock timezone" value={cfg.clockTimezone || ''} options={US_TIMEZONE_OPTIONS as unknown as Array<[string, string]>} onChange={(v) => setField({ clockTimezone: v })} />);
      fields.push(<StyleableField key="clockTime" fieldName="clockTime" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Clock time (manual override)" value={cfg.clockTime || ''} placeholder={D.clockTime} onChange={(v) => setField({ clockTime: v })} />);
      fields.push(<StyleableField key="clockCaption" fieldName="clockCaption" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Clock caption (manual override)" value={cfg.clockCaption || ''} placeholder={D.clockCaption} onChange={(v) => setField({ clockCaption: v })} />);
      // 2026-05-07 — live weather (Open-Meteo). Manual overrides below.
      fields.push(<SmartLocationField key="weatherLocation" value={cfg.weatherLocation || ''} onChange={(v) => setField({ weatherLocation: v })} />);
      fields.push(<SelectField key="weatherUnits" label="Units" value={cfg.weatherUnits || 'imperial'} options={[['imperial','°F'],['metric','°C']]} onChange={(v) => setField({ weatherUnits: v })} />);
      fields.push(<StyleableField key="weatherTemp" fieldName="weatherTemp" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Weather temp (manual override)" value={cfg.weatherTemp || ''} placeholder={D.weatherTemp} onChange={(v) => setField({ weatherTemp: v })} />);
      fields.push(<StyleableField key="weatherCondition" fieldName="weatherCondition" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Weather condition (manual override)" value={cfg.weatherCondition || ''} placeholder={D.weatherCondition} onChange={(v) => setField({ weatherCondition: v })} />);
      fields.push(<StyleableField key="recordValue" fieldName="recordValue" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Season record" value={cfg.recordValue || ''} placeholder={D.recordValue} onChange={(v) => setField({ recordValue: v })} />);
      fields.push(<StyleableField key="recordCaption" fieldName="recordCaption" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Record caption" value={cfg.recordCaption || ''} placeholder={D.recordCaption} onChange={(v) => setField({ recordCaption: v })} />);
      fields.push(<StyleableField key="attendanceValue" fieldName="attendanceValue" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Attendance" value={cfg.attendanceValue || ''} placeholder={D.attendanceValue} onChange={(v) => setField({ attendanceValue: v })} />);
      fields.push(<StyleableField key="attendanceCaption" fieldName="attendanceCaption" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Attendance caption" value={cfg.attendanceCaption || ''} placeholder={D.attendanceCaption} onChange={(v) => setField({ attendanceCaption: v })} />);

      fields.push(SH('teacher', 'Coach / Teacher of the week'));
      fields.push(<StyleableField key="teacherLabel" fieldName="teacherLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Label" value={cfg.teacherLabel || ''} placeholder={D.teacherLabel} onChange={(v) => setField({ teacherLabel: v })} />);
      fields.push(<StyleableField key="teacherName" fieldName="teacherName" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Name" value={cfg.teacherName || ''} placeholder={D.teacherName} onChange={(v) => setField({ teacherName: v })} />);
      fields.push(<StyleableField key="teacherGrade" fieldName="teacherGrade" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Role / subject" value={cfg.teacherGrade || ''} placeholder={D.teacherGrade} onChange={(v) => setField({ teacherGrade: v })} />);
      fields.push(<StyleableAreaField key="teacherQuote" fieldName="teacherQuote" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Quote" value={cfg.teacherQuote || ''} placeholder={D.teacherQuote} rows={3} onChange={(v) => setField({ teacherQuote: v })} />);
      fields.push(<StyleableField key="teacherNumber" fieldName="teacherNumber" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Jersey number" value={String(cfg.teacherNumber ?? '')} placeholder={String(D.teacherNumber)} onChange={(v) => setField({ teacherNumber: v })} />);

      fields.push(SH('announcement', 'Top announcement'));
      fields.push(<StyleableField key="announcementTag" fieldName="announcementTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Tag" value={cfg.announcementTag || ''} placeholder={D.announcementTag} onChange={(v) => setField({ announcementTag: v })} />);
      fields.push(<StyleableField key="announcementHeadline" fieldName="announcementHeadline" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Headline" value={cfg.announcementHeadline || ''} placeholder={D.announcementHeadline} onChange={(v) => setField({ announcementHeadline: v })} />);
      fields.push(<StyleableAreaField key="announcementBody" fieldName="announcementBody" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Body" value={cfg.announcementBody || ''} placeholder={D.announcementBody} rows={3} onChange={(v) => setField({ announcementBody: v })} />);
      fields.push(<StyleableField key="announcementDate" fieldName="announcementDate" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="When" value={cfg.announcementDate || ''} placeholder={D.announcementDate} onChange={(v) => setField({ announcementDate: v })} />);

      fields.push(SH('countdown', 'Countdown card'));
      fields.push(<StyleableField key="countdownValue" fieldName="countdownValue" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Days number" value={String(cfg.countdownValue ?? '')} placeholder={String(D.countdownValue)} onChange={(v) => setField({ countdownValue: v })} />);
      fields.push(<StyleableField key="countdownLabel" fieldName="countdownLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Label" value={cfg.countdownLabel || ''} placeholder={D.countdownLabel} onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(<StyleableField key="countdownSub" fieldName="countdownSub" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Subtext" value={cfg.countdownSub || ''} placeholder={D.countdownSub} onChange={(v) => setField({ countdownSub: v })} />);

      fields.push(SH('events', 'Bottom schedule strip'));
      for (const n of [1, 2, 3]) {
        const k = `event${n}` as 'event1' | 'event2' | 'event3';
        fields.push(<StyleableField key={`${k}Mark`} fieldName={`${k}Mark`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`Event ${n} · Day`} value={cfg[`${k}Mark`] || ''} placeholder={D[`${k}Mark`]} onChange={(v) => setField({ [`${k}Mark`]: v })} />);
        fields.push(<StyleableField key={`${k}When`} fieldName={`${k}When`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`Event ${n} · When/where`} value={cfg[`${k}When`] || ''} placeholder={D[`${k}When`]} onChange={(v) => setField({ [`${k}When`]: v })} />);
        fields.push(<StyleableField key={`${k}Name`} fieldName={`${k}Name`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`Event ${n} · Title`} value={cfg[`${k}Name`] || ''} placeholder={D[`${k}Name`]} onChange={(v) => setField({ [`${k}Name`]: v })} />);
      }

      fields.push(SH('ticker', 'PA-system ticker'));
      fields.push(<StyleableField key="tickerTag" fieldName="tickerTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Stamp text" value={cfg.tickerTag || ''} placeholder={D.tickerTag} onChange={(v) => setField({ tickerTag: v })} />);
      fields.push(<StyleableAreaField key="tickerMessage" fieldName="tickerMessage" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Scrolling message" value={cfg.tickerMessage || ''} placeholder={D.tickerMessage} rows={3} onChange={(v) => setField({ tickerMessage: v })} />);
      break;
    }
    case 'HS_BROADCAST': {
      // Campus news-desk lobby — every data-widget in the HTML mockup
      // gets a matching editor section.
      // 2026-05-07 — placeholders sourced from DEFAULTS.
      const D = HS_BROADCAST_DEFAULTS;
      const SH = (key: string, label: string) => (
        <div key={`sh-${key}`} className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200">{label}</div>
      );
      fields.push(SH('school', 'School brandmark'));
      fields.push(<StyleableField key="schoolChip" fieldName="schoolChip" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Chip letters" value={cfg.schoolChip || ''} placeholder={D.schoolChip} onChange={(v) => setField({ schoolChip: v })} />);
      fields.push(<StyleableField key="schoolName" fieldName="schoolName" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="School name" value={cfg.schoolName || ''} placeholder={D.schoolName} onChange={(v) => setField({ schoolName: v })} />);
      fields.push(<StyleableField key="schoolSub" fieldName="schoolSub" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Network sub" value={cfg.schoolSub || ''} placeholder={D.schoolSub} onChange={(v) => setField({ schoolSub: v })} />);

      fields.push(SH('status', 'ON AIR indicator'));
      fields.push(<StyleableField key="statusLabel" fieldName="statusLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Status label" value={cfg.statusLabel || ''} placeholder={D.statusLabel} onChange={(v) => setField({ statusLabel: v })} />);

      fields.push(SH('greeting', 'Top-story greeting'));
      fields.push(<StyleableField key="greetingEyebrow" fieldName="greetingEyebrow" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Eyebrow" value={cfg.greetingEyebrow || ''} placeholder={D.greetingEyebrow} onChange={(v) => setField({ greetingEyebrow: v })} />);
      fields.push(<StyleableField key="greetingHeadline" fieldName="greetingHeadline" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Big headline" value={cfg.greetingHeadline || ''} placeholder={D.greetingHeadline} onChange={(v) => setField({ greetingHeadline: v })} />);
      fields.push(<StyleableAreaField key="greetingSubtitle" fieldName="greetingSubtitle" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Subtitle" value={cfg.greetingSubtitle || ''} placeholder={D.greetingSubtitle} rows={2} onChange={(v) => setField({ greetingSubtitle: v })} />);

      fields.push(SH('clock', 'Clock panel — live data'));
      fields.push(<SelectField key="clockTimezone" label="Timezone" value={cfg.clockTimezone || ''} options={US_TIMEZONE_OPTIONS as unknown as Array<[string, string]>} onChange={(v) => setField({ clockTimezone: v })} />);
      fields.push(<StyleableField key="clockTime" fieldName="clockTime" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Time (manual override)" value={cfg.clockTime || ''} placeholder={D.clockTime} onChange={(v) => setField({ clockTime: v })} />);
      fields.push(<StyleableField key="clockCaption" fieldName="clockCaption" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Caption (manual override)" value={cfg.clockCaption || ''} placeholder={D.clockCaption} onChange={(v) => setField({ clockCaption: v })} />);

      fields.push(SH('weather', 'Forecast panel — live data'));
      fields.push(<SmartLocationField key="weatherLocation" value={cfg.weatherLocation || ''} onChange={(v) => setField({ weatherLocation: v })} />);
      fields.push(<SelectField key="weatherUnits" label="Units" value={cfg.weatherUnits || 'imperial'} options={[['imperial','°F'],['metric','°C']]} onChange={(v) => setField({ weatherUnits: v })} />);
      fields.push(<StyleableField key="weatherTemp" fieldName="weatherTemp" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Temperature (manual override)" value={cfg.weatherTemp || ''} placeholder={D.weatherTemp} onChange={(v) => setField({ weatherTemp: v })} />);
      fields.push(<StyleableField key="weatherCondition" fieldName="weatherCondition" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Condition (manual override)" value={cfg.weatherCondition || ''} placeholder={D.weatherCondition} onChange={(v) => setField({ weatherCondition: v })} />);

      fields.push(SH('teacher', 'Featured guest / Teacher of the week'));
      fields.push(<StyleableField key="teacherPortraitTag" fieldName="teacherPortraitTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Portrait caption" value={cfg.teacherPortraitTag || ''} placeholder={D.teacherPortraitTag} onChange={(v) => setField({ teacherPortraitTag: v })} />);
      fields.push(<StyleableField key="teacherLabel" fieldName="teacherLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Label" value={cfg.teacherLabel || ''} placeholder={D.teacherLabel} onChange={(v) => setField({ teacherLabel: v })} />);
      fields.push(<StyleableField key="teacherName" fieldName="teacherName" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Name" value={cfg.teacherName || ''} placeholder={D.teacherName} onChange={(v) => setField({ teacherName: v })} />);
      fields.push(<StyleableField key="teacherGrade" fieldName="teacherGrade" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Role / subject" value={cfg.teacherGrade || ''} placeholder={D.teacherGrade} onChange={(v) => setField({ teacherGrade: v })} />);
      fields.push(<StyleableAreaField key="teacherQuote" fieldName="teacherQuote" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Quote" value={cfg.teacherQuote || ''} placeholder={D.teacherQuote} rows={3} onChange={(v) => setField({ teacherQuote: v })} />);

      fields.push(SH('announcement', 'Breaking story card'));
      fields.push(<StyleableField key="announcementTitle" fieldName="announcementTitle" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Tag" value={cfg.announcementTitle || ''} placeholder={D.announcementTitle} onChange={(v) => setField({ announcementTitle: v })} />);
      fields.push(<StyleableField key="announcementHeadline" fieldName="announcementHeadline" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Headline" value={cfg.announcementHeadline || ''} placeholder={D.announcementHeadline} onChange={(v) => setField({ announcementHeadline: v })} />);
      fields.push(<StyleableAreaField key="announcementBody" fieldName="announcementBody" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Body" value={cfg.announcementBody || ''} placeholder={D.announcementBody} rows={3} onChange={(v) => setField({ announcementBody: v })} />);
      fields.push(<StyleableField key="announcementDate" fieldName="announcementDate" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="When · where" value={cfg.announcementDate || ''} placeholder={D.announcementDate} onChange={(v) => setField({ announcementDate: v })} />);

      fields.push(SH('events', 'Schedule grid (3 events)'));
      for (const n of [1, 2, 3]) {
        const k = `event${n}` as 'event1' | 'event2' | 'event3';
        fields.push(<StyleableField key={`${k}When`} fieldName={`${k}When`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`Event ${n} · When`} value={cfg[`${k}When`] || ''} placeholder={D[`${k}When`]} onChange={(v) => setField({ [`${k}When`]: v })} />);
        fields.push(<StyleableField key={`${k}Name`} fieldName={`${k}Name`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`Event ${n} · Title`} value={cfg[`${k}Name`] || ''} placeholder={D[`${k}Name`]} onChange={(v) => setField({ [`${k}Name`]: v })} />);
      }

      fields.push(SH('countdown', 'Countdown'));
      fields.push(<StyleableField key="countdownLabel" fieldName="countdownLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Label" value={cfg.countdownLabel || ''} placeholder={D.countdownLabel} onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(<StyleableField key="countdownValue" fieldName="countdownValue" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Number" value={String(cfg.countdownValue ?? '')} placeholder={String(D.countdownValue)} onChange={(v) => setField({ countdownValue: v })} />);
      fields.push(<StyleableField key="countdownUnit" fieldName="countdownUnit" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Unit" value={cfg.countdownUnit || ''} placeholder={D.countdownUnit} onChange={(v) => setField({ countdownUnit: v })} />);

      fields.push(SH('ticker', 'Bottom crawl'));
      fields.push(<StyleableField key="tickerTag" fieldName="tickerTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Stamp" value={cfg.tickerTag || ''} placeholder={D.tickerTag} onChange={(v) => setField({ tickerTag: v })} />);
      fields.push(<StyleableAreaField key="tickerMessage" fieldName="tickerMessage" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Scrolling message" value={cfg.tickerMessage || ''} placeholder={D.tickerMessage} rows={3} onChange={(v) => setField({ tickerMessage: v })} />);
      break;
    }
    case 'HS_YEARBOOK': {
      // 2026-05-07 — placeholders sourced from DEFAULTS.
      const D = HS_YEARBOOK_DEFAULTS;
      const SH = (key: string, label: string) => (
        <div key={`sh-${key}`} className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200">{label}</div>
      );
      fields.push(SH('school', 'Masthead'));
      fields.push(<StyleableField key="schoolName" fieldName="schoolName" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Publication name" value={cfg.schoolName || ''} placeholder={D.schoolName} onChange={(v) => setField({ schoolName: v })} />);
      fields.push(<StyleableField key="schoolIssue" fieldName="schoolIssue" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Issue line" value={cfg.schoolIssue || ''} placeholder={D.schoolIssue} onChange={(v) => setField({ schoolIssue: v })} />);

      fields.push(SH('clock', 'Folio clock (top right) — live data'));
      fields.push(<SelectField key="clockTimezone" label="Timezone" value={cfg.clockTimezone || ''} options={US_TIMEZONE_OPTIONS as unknown as Array<[string, string]>} onChange={(v) => setField({ clockTimezone: v })} />);
      fields.push(<StyleableField key="clockTime" fieldName="clockTime" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Time (manual override)" value={cfg.clockTime || ''} placeholder={D.clockTime} onChange={(v) => setField({ clockTime: v })} />);
      fields.push(<StyleableField key="clockCaption" fieldName="clockCaption" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Caption (manual override)" value={cfg.clockCaption || ''} placeholder={D.clockCaption} onChange={(v) => setField({ clockCaption: v })} />);

      fields.push(SH('greeting', 'Hero lede'));
      fields.push(<StyleableField key="greetingEyebrow" fieldName="greetingEyebrow" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Eyebrow" value={cfg.greetingEyebrow || ''} placeholder={D.greetingEyebrow} onChange={(v) => setField({ greetingEyebrow: v })} />);
      fields.push(<StyleableField key="greetingHeadline" fieldName="greetingHeadline" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Big headline" value={cfg.greetingHeadline || ''} placeholder={D.greetingHeadline} onChange={(v) => setField({ greetingHeadline: v })} />);
      fields.push(<StyleableAreaField key="greetingSubtitle" fieldName="greetingSubtitle" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Italic lede" value={cfg.greetingSubtitle || ''} placeholder={D.greetingSubtitle} rows={3} onChange={(v) => setField({ greetingSubtitle: v })} />);

      fields.push(SH('announcement', "Editor's note card"));
      fields.push(<StyleableField key="announcementTag" fieldName="announcementTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Kicker" value={cfg.announcementTag || ''} placeholder={D.announcementTag} onChange={(v) => setField({ announcementTag: v })} />);
      fields.push(<StyleableField key="announcementHeadline" fieldName="announcementHeadline" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Headline" value={cfg.announcementHeadline || ''} placeholder={D.announcementHeadline} onChange={(v) => setField({ announcementHeadline: v })} />);
      fields.push(<StyleableAreaField key="announcementBody" fieldName="announcementBody" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Body" value={cfg.announcementBody || ''} placeholder={D.announcementBody} rows={3} onChange={(v) => setField({ announcementBody: v })} />);
      fields.push(<StyleableField key="announcementDate" fieldName="announcementDate" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Deadline line" value={cfg.announcementDate || ''} placeholder={D.announcementDate} onChange={(v) => setField({ announcementDate: v })} />);

      fields.push(SH('weather', 'TODAY card — live data'));
      fields.push(<SmartLocationField key="weatherLocation" value={cfg.weatherLocation || ''} onChange={(v) => setField({ weatherLocation: v })} />);
      fields.push(<SelectField key="weatherUnits" label="Units" value={cfg.weatherUnits || 'imperial'} options={[['imperial','°F'],['metric','°C']]} onChange={(v) => setField({ weatherUnits: v })} />);
      fields.push(<StyleableField key="weatherTemp" fieldName="weatherTemp" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Temp (manual override)" value={cfg.weatherTemp || ''} placeholder={D.weatherTemp} onChange={(v) => setField({ weatherTemp: v })} />);
      fields.push(<StyleableField key="weatherCondition" fieldName="weatherCondition" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Condition (manual override)" value={cfg.weatherCondition || ''} placeholder={D.weatherCondition} onChange={(v) => setField({ weatherCondition: v })} />);

      fields.push(SH('countdown', 'Graduation countdown'));
      fields.push(<StyleableField key="countdownLabel" fieldName="countdownLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Label" value={cfg.countdownLabel || ''} placeholder={D.countdownLabel} onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(<StyleableField key="countdownValue" fieldName="countdownValue" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Number" value={String(cfg.countdownValue ?? '')} placeholder={String(D.countdownValue)} onChange={(v) => setField({ countdownValue: v })} />);
      fields.push(<StyleableField key="countdownUnit" fieldName="countdownUnit" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Unit / sub" value={cfg.countdownUnit || ''} placeholder={D.countdownUnit} onChange={(v) => setField({ countdownUnit: v })} />);

      fields.push(SH('feature', 'Feature photo block'));
      fields.push(<StyleableField key="featurePhotoTag" fieldName="featurePhotoTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Photo slug" value={cfg.featurePhotoTag || ''} placeholder={D.featurePhotoTag} onChange={(v) => setField({ featurePhotoTag: v })} />);
      fields.push(<StyleableField key="featureNum" fieldName="featureNum" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Story number" value={cfg.featureNum || ''} placeholder={D.featureNum} onChange={(v) => setField({ featureNum: v })} />);
      fields.push(<StyleableField key="featureTitle" fieldName="featureTitle" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Story title" value={cfg.featureTitle || ''} placeholder={D.featureTitle} onChange={(v) => setField({ featureTitle: v })} />);
      fields.push(<StyleableAreaField key="featureBody" fieldName="featureBody" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Story body" value={cfg.featureBody || ''} placeholder={D.featureBody} rows={3} onChange={(v) => setField({ featureBody: v })} />);

      fields.push(SH('teacher', 'Featured portrait'));
      fields.push(<StyleableField key="teacherPhotoTag" fieldName="teacherPhotoTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Portrait slug" value={cfg.teacherPhotoTag || ''} placeholder={D.teacherPhotoTag} onChange={(v) => setField({ teacherPhotoTag: v })} />);
      fields.push(<StyleableField key="teacherLabel" fieldName="teacherLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Kicker" value={cfg.teacherLabel || ''} placeholder={D.teacherLabel} onChange={(v) => setField({ teacherLabel: v })} />);
      fields.push(<StyleableField key="teacherName" fieldName="teacherName" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Name" value={cfg.teacherName || ''} placeholder={D.teacherName} onChange={(v) => setField({ teacherName: v })} />);
      fields.push(<StyleableField key="teacherGrade" fieldName="teacherGrade" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Role / subject" value={cfg.teacherGrade || ''} placeholder={D.teacherGrade} onChange={(v) => setField({ teacherGrade: v })} />);
      fields.push(<StyleableAreaField key="teacherQuote" fieldName="teacherQuote" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Pull quote" value={cfg.teacherQuote || ''} placeholder={D.teacherQuote} rows={3} onChange={(v) => setField({ teacherQuote: v })} />);
      fields.push(<StyleableField key="teacherByline" fieldName="teacherByline" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Byline" value={cfg.teacherByline || ''} placeholder={D.teacherByline} onChange={(v) => setField({ teacherByline: v })} />);
      fields.push(<StyleableField key="folioPage" fieldName="folioPage" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Folio page number" value={cfg.folioPage || ''} placeholder={D.folioPage} onChange={(v) => setField({ folioPage: v })} />);

      fields.push(SH('events', 'Calendar footer (3 events)'));
      fields.push(<StyleableField key="schoolSection" fieldName="schoolSection" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Section name" value={cfg.schoolSection || ''} placeholder={D.schoolSection} onChange={(v) => setField({ schoolSection: v })} />);
      for (const n of [1, 2, 3]) {
        const k = `event${n}` as 'event1' | 'event2' | 'event3';
        fields.push(<StyleableField key={`${k}When`} fieldName={`${k}When`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`Event ${n} · When`} value={cfg[`${k}When`] || ''} placeholder={D[`${k}When`]} onChange={(v) => setField({ [`${k}When`]: v })} />);
        fields.push(<StyleableField key={`${k}Name`} fieldName={`${k}Name`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`Event ${n} · Title`} value={cfg[`${k}Name`] || ''} placeholder={D[`${k}Name`]} onChange={(v) => setField({ [`${k}Name`]: v })} />);
      }

      fields.push(SH('ticker', 'Wire ticker'));
      fields.push(<StyleableField key="tickerTag" fieldName="tickerTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Stamp" value={cfg.tickerTag || ''} placeholder={D.tickerTag} onChange={(v) => setField({ tickerTag: v })} />);
      fields.push(<StyleableAreaField key="tickerMessage" fieldName="tickerMessage" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Scrolling message" value={cfg.tickerMessage || ''} placeholder={D.tickerMessage} rows={3} onChange={(v) => setField({ tickerMessage: v })} />);
      break;
    }
    case 'HS_TERMINAL': {
      // 2026-05-07 — placeholders sourced from DEFAULTS.
      const D = HS_TERMINAL_DEFAULTS;
      const SH = (key: string, label: string) => (
        <div key={`sh-${key}`} className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200">{label}</div>
      );
      fields.push(SH('school', 'Shell top bar'));
      fields.push(<StyleableField key="schoolHost" fieldName="schoolHost" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Host" value={cfg.schoolHost || ''} placeholder={D.schoolHost} onChange={(v) => setField({ schoolHost: v })} />);
      fields.push(<StyleableField key="schoolPath" fieldName="schoolPath" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Path" value={cfg.schoolPath || ''} placeholder={D.schoolPath} onChange={(v) => setField({ schoolPath: v })} />);
      fields.push(<StyleableField key="schoolSession" fieldName="schoolSession" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Session line" value={cfg.schoolSession || ''} placeholder={D.schoolSession} onChange={(v) => setField({ schoolSession: v })} />);
      fields.push(<SelectField key="clockTimezone" label="Clock timezone" value={cfg.clockTimezone || ''} options={US_TIMEZONE_OPTIONS as unknown as Array<[string, string]>} onChange={(v) => setField({ clockTimezone: v })} />);
      fields.push(<StyleableField key="clockTime" fieldName="clockTime" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Topbar clock (manual override)" value={cfg.clockTime || ''} placeholder={D.clockTime} onChange={(v) => setField({ clockTime: v })} />);
      // Live weather — feeds both the topbar pair and the [weatherd] stat box.
      fields.push(<SmartLocationField key="weatherLocation" value={cfg.weatherLocation || ''} onChange={(v) => setField({ weatherLocation: v })} />);
      fields.push(<SelectField key="weatherUnits" label="Units" value={cfg.weatherUnits || 'imperial'} options={[['imperial','°F'],['metric','°C']]} onChange={(v) => setField({ weatherUnits: v })} />);
      fields.push(<StyleableField key="weatherTemp" fieldName="weatherTemp" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Topbar temp (manual override)" value={cfg.weatherTemp || ''} placeholder={D.weatherTemp} onChange={(v) => setField({ weatherTemp: v })} />);
      fields.push(<StyleableField key="weatherCondition" fieldName="weatherCondition" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Topbar condition (manual override)" value={cfg.weatherCondition || ''} placeholder={D.weatherCondition} onChange={(v) => setField({ weatherCondition: v })} />);

      fields.push(SH('greeting', 'Shell prompt / greeting'));
      fields.push(<StyleableField key="greetingCmd" fieldName="greetingCmd" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Command" value={cfg.greetingCmd || ''} placeholder={D.greetingCmd} onChange={(v) => setField({ greetingCmd: v })} />);
      fields.push(<StyleableField key="greetingArg" fieldName="greetingArg" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Args" value={cfg.greetingArg || ''} placeholder={D.greetingArg} onChange={(v) => setField({ greetingArg: v })} />);
      fields.push(<StyleableField key="greetingHeadline" fieldName="greetingHeadline" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Banner headline" value={cfg.greetingHeadline || ''} placeholder={D.greetingHeadline} onChange={(v) => setField({ greetingHeadline: v })} />);
      fields.push(<StyleableAreaField key="greetingSubtitle" fieldName="greetingSubtitle" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Subtitle (// comment)" value={cfg.greetingSubtitle || ''} placeholder={D.greetingSubtitle} rows={2} onChange={(v) => setField({ greetingSubtitle: v })} />);

      fields.push(SH('stats', 'Stat boxes (clock / weatherd / attendance / lunch)'));
      fields.push(<StyleableField key="clockbigVal" fieldName="clockbigVal" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Clock value" value={cfg.clockbigVal || ''} placeholder={D.clockbigVal} onChange={(v) => setField({ clockbigVal: v })} />);
      fields.push(<StyleableField key="clockbigCap" fieldName="clockbigCap" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Clock caption" value={cfg.clockbigCap || ''} placeholder={D.clockbigCap} onChange={(v) => setField({ clockbigCap: v })} />);
      fields.push(<StyleableField key="weatherdVal" fieldName="weatherdVal" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Weather value" value={cfg.weatherdVal || ''} placeholder={D.weatherdVal} onChange={(v) => setField({ weatherdVal: v })} />);
      fields.push(<StyleableField key="weatherdCap" fieldName="weatherdCap" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Weather caption" value={cfg.weatherdCap || ''} placeholder={D.weatherdCap} onChange={(v) => setField({ weatherdCap: v })} />);
      fields.push(<StyleableField key="attendanceVal" fieldName="attendanceVal" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Attendance value" value={cfg.attendanceVal || ''} placeholder={D.attendanceVal} onChange={(v) => setField({ attendanceVal: v })} />);
      fields.push(<StyleableField key="attendanceCap" fieldName="attendanceCap" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Attendance caption" value={cfg.attendanceCap || ''} placeholder={D.attendanceCap} onChange={(v) => setField({ attendanceCap: v })} />);
      fields.push(<StyleableField key="lunchVal" fieldName="lunchVal" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Lunch value" value={cfg.lunchVal || ''} placeholder={D.lunchVal} onChange={(v) => setField({ lunchVal: v })} />);
      fields.push(<StyleableField key="lunchCap" fieldName="lunchCap" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Lunch caption" value={cfg.lunchCap || ''} placeholder={D.lunchCap} onChange={(v) => setField({ lunchCap: v })} />);

      fields.push(SH('teacher', 'whoami --featured teacher card'));
      fields.push(<StyleableField key="teacherCmd" fieldName="teacherCmd" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Command" value={cfg.teacherCmd || ''} placeholder={D.teacherCmd} onChange={(v) => setField({ teacherCmd: v })} />);
      fields.push(<StyleableField key="teacherName" fieldName="teacherName" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Name" value={cfg.teacherName || ''} placeholder={D.teacherName} onChange={(v) => setField({ teacherName: v })} />);
      fields.push(<StyleableField key="teacherRole" fieldName="teacherRole" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Role" value={cfg.teacherRole || ''} placeholder={D.teacherRole} onChange={(v) => setField({ teacherRole: v })} />);
      fields.push(<StyleableField key="teacherRoom" fieldName="teacherRoom" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Room" value={cfg.teacherRoom || ''} placeholder={D.teacherRoom} onChange={(v) => setField({ teacherRoom: v })} />);
      fields.push(<StyleableField key="teacherYears" fieldName="teacherYears" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Years" value={cfg.teacherYears || ''} placeholder={D.teacherYears} onChange={(v) => setField({ teacherYears: v })} />);
      fields.push(<StyleableField key="teacherGroups" fieldName="teacherGroups" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Groups" value={cfg.teacherGroups || ''} placeholder={D.teacherGroups} onChange={(v) => setField({ teacherGroups: v })} />);
      fields.push(<StyleableAreaField key="teacherQuote" fieldName="teacherQuote" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Quote" value={cfg.teacherQuote || ''} placeholder={D.teacherQuote} rows={3} onChange={(v) => setField({ teacherQuote: v })} />);

      fields.push(SH('announcement', '[ ! priority ] WARN box'));
      fields.push(<StyleableField key="announcementTag" fieldName="announcementTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Tag" value={cfg.announcementTag || ''} placeholder={D.announcementTag} onChange={(v) => setField({ announcementTag: v })} />);
      fields.push(<StyleableField key="announcementHeadline" fieldName="announcementHeadline" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Headline" value={cfg.announcementHeadline || ''} placeholder={D.announcementHeadline} onChange={(v) => setField({ announcementHeadline: v })} />);
      fields.push(<StyleableAreaField key="announcementBody" fieldName="announcementBody" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Body" value={cfg.announcementBody || ''} placeholder={D.announcementBody} rows={3} onChange={(v) => setField({ announcementBody: v })} />);
      fields.push(<StyleableField key="announcementDate" fieldName="announcementDate" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="When/where" value={cfg.announcementDate || ''} placeholder={D.announcementDate} onChange={(v) => setField({ announcementDate: v })} />);

      fields.push(SH('countdown', '[ countdown ] box'));
      fields.push(<StyleableField key="countdownValue" fieldName="countdownValue" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Number" value={String(cfg.countdownValue ?? '')} placeholder={String(D.countdownValue)} onChange={(v) => setField({ countdownValue: v })} />);
      fields.push(<StyleableField key="countdownLabel" fieldName="countdownLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Label" value={cfg.countdownLabel || ''} placeholder={D.countdownLabel} onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(<StyleableField key="countdownSub" fieldName="countdownSub" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Sub" value={cfg.countdownSub || ''} placeholder={D.countdownSub} onChange={(v) => setField({ countdownSub: v })} />);

      fields.push(SH('events', 'cron -l /var/school/events (3 rows)'));
      for (const n of [1, 2, 3]) {
        const k = `event${n}` as 'event1' | 'event2' | 'event3';
        fields.push(<StyleableField key={`${k}When`} fieldName={`${k}When`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`Event ${n} · when`} value={cfg[`${k}When`] || ''} placeholder={D[`${k}When`]} onChange={(v) => setField({ [`${k}When`]: v })} />);
        fields.push(<StyleableField key={`${k}Where`} fieldName={`${k}Where`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`Event ${n} · where`} value={cfg[`${k}Where`] || ''} placeholder={D[`${k}Where`]} onChange={(v) => setField({ [`${k}Where`]: v })} />);
        fields.push(<StyleableField key={`${k}Name`} fieldName={`${k}Name`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`Event ${n} · what`} value={cfg[`${k}Name`] || ''} placeholder={D[`${k}Name`]} onChange={(v) => setField({ [`${k}Name`]: v })} />);
        fields.push(<StyleableField key={`${k}Who`} fieldName={`${k}Who`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`Event ${n} · who`} value={cfg[`${k}Who`] || ''} placeholder={D[`${k}Who`]} onChange={(v) => setField({ [`${k}Who`]: v })} />);
      }

      fields.push(SH('ticker', '/var/log/syslog ticker'));
      fields.push(<StyleableField key="tickerTag" fieldName="tickerTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Tag" value={cfg.tickerTag || ''} placeholder={D.tickerTag} onChange={(v) => setField({ tickerTag: v })} />);
      fields.push(<StyleableAreaField key="tickerMessage" fieldName="tickerMessage" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Syslog messages" value={cfg.tickerMessage || ''} placeholder={D.tickerMessage} rows={3} onChange={(v) => setField({ tickerMessage: v })} />);
      break;
    }
    case 'HS_TRANSIT': {
      // 2026-05-07 — placeholders sourced from DEFAULTS.
      const D = HS_TRANSIT_DEFAULTS;
      const SH = (key: string, label: string) => (
        <div key={`sh-${key}`} className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200">{label}</div>
      );
      fields.push(SH('school', 'Station mast'));
      fields.push(<StyleableField key="schoolCode" fieldName="schoolCode" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Code chip" value={cfg.schoolCode || ''} placeholder={D.schoolCode} onChange={(v) => setField({ schoolCode: v })} />);
      fields.push(<StyleableField key="brandStation" fieldName="brandStation" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Station name" value={cfg.brandStation || ''} placeholder={D.brandStation} onChange={(v) => setField({ brandStation: v })} />);
      fields.push(<StyleableField key="brandMeta" fieldName="brandMeta" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Meta line" value={cfg.brandMeta || ''} placeholder={D.brandMeta} onChange={(v) => setField({ brandMeta: v })} />);
      fields.push(<SelectField key="clockTimezone" label="Clock timezone" value={cfg.clockTimezone || ''} options={US_TIMEZONE_OPTIONS as unknown as Array<[string, string]>} onChange={(v) => setField({ clockTimezone: v })} />);
      fields.push(<StyleableField key="clockTime" fieldName="clockTime" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Clock time (manual override)" value={cfg.clockTime || ''} placeholder={D.clockTime} onChange={(v) => setField({ clockTime: v })} />);
      fields.push(<StyleableField key="clockDate" fieldName="clockDate" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Date (manual override)" value={cfg.clockDate || ''} placeholder={D.clockDate} onChange={(v) => setField({ clockDate: v })} />);
      fields.push(<StyleableField key="clockTz" fieldName="clockTz" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Display label (e.g. LOCAL · UTC-05:00)" value={cfg.clockTz || ''} placeholder={D.clockTz} onChange={(v) => setField({ clockTz: v })} />);

      fields.push(SH('greeting', 'Now boarding hero'));
      fields.push(<StyleableField key="greetingGate" fieldName="greetingGate" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Room / gate" value={cfg.greetingGate || ''} placeholder={D.greetingGate} onChange={(v) => setField({ greetingGate: v })} />);
      fields.push(<StyleableField key="greetingEyebrow" fieldName="greetingEyebrow" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Eyebrow" value={cfg.greetingEyebrow || ''} placeholder={D.greetingEyebrow} onChange={(v) => setField({ greetingEyebrow: v })} />);
      fields.push(<StyleableField key="greetingHeadline" fieldName="greetingHeadline" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Headline" value={cfg.greetingHeadline || ''} placeholder={D.greetingHeadline} onChange={(v) => setField({ greetingHeadline: v })} />);
      fields.push(<StyleableAreaField key="greetingSubtitle" fieldName="greetingSubtitle" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Subtitle" value={cfg.greetingSubtitle || ''} placeholder={D.greetingSubtitle} rows={2} onChange={(v) => setField({ greetingSubtitle: v })} />);
      // Live weather (Open-Meteo). Manual overrides below.
      fields.push(<SmartLocationField key="weatherLocation" value={cfg.weatherLocation || ''} onChange={(v) => setField({ weatherLocation: v })} />);
      fields.push(<SelectField key="weatherUnits" label="Units" value={cfg.weatherUnits || 'imperial'} options={[['imperial','°F'],['metric','°C']]} onChange={(v) => setField({ weatherUnits: v })} />);
      fields.push(<StyleableField key="weatherTemp" fieldName="weatherTemp" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Outside temp (manual override)" value={cfg.weatherTemp || ''} placeholder={D.weatherTemp} onChange={(v) => setField({ weatherTemp: v })} />);
      fields.push(<StyleableField key="weatherCondition" fieldName="weatherCondition" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Conditions (manual override)" value={cfg.weatherCondition || ''} placeholder={D.weatherCondition} onChange={(v) => setField({ weatherCondition: v })} />);
      fields.push(<StyleableField key="weatherStatus" fieldName="weatherStatus" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Status badge" value={cfg.weatherStatus || ''} placeholder={D.weatherStatus} onChange={(v) => setField({ weatherStatus: v })} />);

      fields.push(SH('departures', 'Departure rows (5 classes)'));
      for (const n of [0, 1, 2, 3, 4]) {
        const k = `dep${n}` as 'dep0' | 'dep1' | 'dep2' | 'dep3' | 'dep4';
        fields.push(<StyleableField key={`${k}Time`} fieldName={`${k}Time`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Time`} value={cfg[`${k}Time`] || ''} placeholder={D[`${k}Time`]} onChange={(v) => setField({ [`${k}Time`]: v })} />);
        fields.push(<StyleableField key={`${k}Code`} fieldName={`${k}Code`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Course code`} value={cfg[`${k}Code`] || ''} placeholder={D[`${k}Code`]} onChange={(v) => setField({ [`${k}Code`]: v })} />);
        fields.push(<StyleableField key={`${k}Dest`} fieldName={`${k}Dest`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Subject`} value={cfg[`${k}Dest`] || ''} placeholder={D[`${k}Dest`]} onChange={(v) => setField({ [`${k}Dest`]: v })} />);
        fields.push(<StyleableField key={`${k}Note`} fieldName={`${k}Note`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Note`} value={cfg[`${k}Note`] || ''} placeholder={D[`${k}Note`]} onChange={(v) => setField({ [`${k}Note`]: v })} />);
        fields.push(<StyleableField key={`${k}Room`} fieldName={`${k}Room`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Room/gate`} value={cfg[`${k}Room`] || ''} placeholder={D[`${k}Room`]} onChange={(v) => setField({ [`${k}Room`]: v })} />);
        fields.push(<StyleableField key={`${k}Teacher`} fieldName={`${k}Teacher`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Teacher`} value={cfg[`${k}Teacher`] || ''} placeholder={D[`${k}Teacher`]} onChange={(v) => setField({ [`${k}Teacher`]: v })} />);
        fields.push(<StyleableField key={`${k}Status`} fieldName={`${k}Status`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Status (BOARDING/ON TIME/DELAY/OPEN/SCHED)`} value={cfg[`${k}Status`] || ''} placeholder={D[`${k}Status`]} onChange={(v) => setField({ [`${k}Status`]: v })} />);
      }

      fields.push(SH('teacher', 'Flight crew spotlight'));
      fields.push(<StyleableField key="teacherLabel" fieldName="teacherLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Label" value={cfg.teacherLabel || ''} placeholder={D.teacherLabel} onChange={(v) => setField({ teacherLabel: v })} />);
      fields.push(<StyleableField key="teacherName" fieldName="teacherName" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Name" value={cfg.teacherName || ''} placeholder={D.teacherName} onChange={(v) => setField({ teacherName: v })} />);
      fields.push(<StyleableField key="teacherMeta" fieldName="teacherMeta" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Meta" value={cfg.teacherMeta || ''} placeholder={D.teacherMeta} onChange={(v) => setField({ teacherMeta: v })} />);
      fields.push(<StyleableAreaField key="teacherQuote" fieldName="teacherQuote" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Quote" value={cfg.teacherQuote || ''} placeholder={D.teacherQuote} rows={3} onChange={(v) => setField({ teacherQuote: v })} />);
      fields.push(<StyleableField key="teacherNum" fieldName="teacherNum" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Portrait big number" value={cfg.teacherNum || ''} placeholder={D.teacherNum} onChange={(v) => setField({ teacherNum: v })} />);

      fields.push(SH('announcement', 'Advisory panel'));
      fields.push(<StyleableField key="announcementTag" fieldName="announcementTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Tag" value={cfg.announcementTag || ''} placeholder={D.announcementTag} onChange={(v) => setField({ announcementTag: v })} />);
      fields.push(<StyleableField key="announcementHeadline" fieldName="announcementHeadline" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Headline" value={cfg.announcementHeadline || ''} placeholder={D.announcementHeadline} onChange={(v) => setField({ announcementHeadline: v })} />);
      fields.push(<StyleableAreaField key="announcementBody" fieldName="announcementBody" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Body" value={cfg.announcementBody || ''} placeholder={D.announcementBody} rows={3} onChange={(v) => setField({ announcementBody: v })} />);
      fields.push(<StyleableField key="announcementDate" fieldName="announcementDate" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="When" value={cfg.announcementDate || ''} placeholder={D.announcementDate} onChange={(v) => setField({ announcementDate: v })} />);

      fields.push(SH('countdown', 'Next-leg countdown'));
      fields.push(<StyleableField key="countdownLabel" fieldName="countdownLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Label" value={cfg.countdownLabel || ''} placeholder={D.countdownLabel} onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(<StyleableField key="countdownValue" fieldName="countdownValue" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Value" value={String(cfg.countdownValue ?? '')} placeholder={String(D.countdownValue)} onChange={(v) => setField({ countdownValue: v })} />);
      fields.push(<StyleableField key="countdownSub" fieldName="countdownSub" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Sub" value={cfg.countdownSub || ''} placeholder={D.countdownSub} onChange={(v) => setField({ countdownSub: v })} />);

      fields.push(SH('ticker', 'PA ticker'));
      fields.push(<StyleableField key="tickerTag" fieldName="tickerTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Tag" value={cfg.tickerTag || ''} placeholder={D.tickerTag} onChange={(v) => setField({ tickerTag: v })} />);
      fields.push(<StyleableAreaField key="tickerMessage" fieldName="tickerMessage" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Scrolling message" value={cfg.tickerMessage || ''} placeholder={D.tickerMessage} rows={3} onChange={(v) => setField({ tickerMessage: v })} />);
      break;
    }
    case 'HS_GALLERY': {
      // 2026-05-07 — placeholders sourced from DEFAULTS.
      const D = HS_GALLERY_DEFAULTS;
      const SH = (key: string, label: string) => (
        <div key={`sh-${key}`} className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200">{label}</div>
      );
      fields.push(SH('school', 'Masthead'));
      fields.push(<StyleableField key="schoolName" fieldName="schoolName" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Publication name" value={cfg.schoolName || ''} placeholder={D.schoolName} onChange={(v) => setField({ schoolName: v })} />);
      fields.push(<SelectField key="clockTimezone" label="Clock timezone" value={cfg.clockTimezone || ''} options={US_TIMEZONE_OPTIONS as unknown as Array<[string, string]>} onChange={(v) => setField({ clockTimezone: v })} />);
      fields.push(<StyleableField key="clockDate" fieldName="clockDate" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Date nav (manual override)" value={cfg.clockDate || ''} placeholder={D.clockDate} onChange={(v) => setField({ clockDate: v })} />);
      fields.push(<StyleableField key="clockTime" fieldName="clockTime" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Time nav (manual override)" value={cfg.clockTime || ''} placeholder={D.clockTime} onChange={(v) => setField({ clockTime: v })} />);
      // Live weather — Gallery renders a single "Clear, 46°" string.
      fields.push(<SmartLocationField key="weatherLocation" value={cfg.weatherLocation || ''} onChange={(v) => setField({ weatherLocation: v })} />);
      fields.push(<SelectField key="weatherUnits" label="Units" value={cfg.weatherUnits || 'imperial'} options={[['imperial','°F'],['metric','°C']]} onChange={(v) => setField({ weatherUnits: v })} />);
      fields.push(<StyleableField key="weatherCondition" fieldName="weatherCondition" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Weather nav (manual override)" value={cfg.weatherCondition || ''} placeholder={D.weatherCondition} onChange={(v) => setField({ weatherCondition: v })} />);

      fields.push(SH('greeting', 'Plaque (italic accent word)'));
      fields.push(<StyleableField key="greetingEyebrow" fieldName="greetingEyebrow" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Exhibition number" value={cfg.greetingEyebrow || ''} placeholder={D.greetingEyebrow} onChange={(v) => setField({ greetingEyebrow: v })} />);
      fields.push(<StyleableField key="greetingHeadline1" fieldName="greetingHeadline1" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Headline pt1" value={cfg.greetingHeadline1 || ''} placeholder={D.greetingHeadline1} onChange={(v) => setField({ greetingHeadline1: v })} />);
      fields.push(<StyleableField key="greetingHeadline2" fieldName="greetingHeadline2" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Headline pt2 (italic/accent)" value={cfg.greetingHeadline2 || ''} placeholder={D.greetingHeadline2} onChange={(v) => setField({ greetingHeadline2: v })} />);
      fields.push(<StyleableField key="greetingHeadline3" fieldName="greetingHeadline3" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Headline pt3" value={cfg.greetingHeadline3 || ''} placeholder={D.greetingHeadline3} onChange={(v) => setField({ greetingHeadline3: v })} />);
      fields.push(<StyleableAreaField key="greetingSubtitle" fieldName="greetingSubtitle" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Subtitle" value={cfg.greetingSubtitle || ''} placeholder={D.greetingSubtitle} rows={3} onChange={(v) => setField({ greetingSubtitle: v })} />);

      fields.push(SH('events', 'Acquisitions (3 Roman-numeral cards)'));
      for (const n of [0, 1, 2]) {
        const k = `event${n}` as 'event0' | 'event1' | 'event2';
        fields.push(<StyleableField key={`${k}Num`} fieldName={`${k}Num`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Roman numeral`} value={cfg[`${k}Num`] || ''} placeholder={D[`${k}Num`]} onChange={(v) => setField({ [`${k}Num`]: v })} />);
        fields.push(<StyleableField key={`${k}Name`} fieldName={`${k}Name`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Title`} value={cfg[`${k}Name`] || ''} placeholder={D[`${k}Name`]} onChange={(v) => setField({ [`${k}Name`]: v })} />);
        fields.push(<StyleableField key={`${k}Meta`} fieldName={`${k}Meta`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Meta`} value={cfg[`${k}Meta`] || ''} placeholder={D[`${k}Meta`]} onChange={(v) => setField({ [`${k}Meta`]: v })} />);
        fields.push(<StyleableField key={`${k}Time`} fieldName={`${k}Time`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Time`} value={cfg[`${k}Time`] || ''} placeholder={D[`${k}Time`]} onChange={(v) => setField({ [`${k}Time`]: v })} />);
        fields.push(<StyleableField key={`${k}Day`} fieldName={`${k}Day`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Day`} value={cfg[`${k}Day`] || ''} placeholder={D[`${k}Day`]} onChange={(v) => setField({ [`${k}Day`]: v })} />);
      }

      fields.push(SH('wall', 'Wall-label stat row'));
      fields.push(<StyleableField key="clockbigVal" fieldName="clockbigVal" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Clock value" value={cfg.clockbigVal || ''} placeholder={D.clockbigVal} onChange={(v) => setField({ clockbigVal: v })} />);
      fields.push(<StyleableField key="clockbigCap" fieldName="clockbigCap" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Clock caption" value={cfg.clockbigCap || ''} placeholder={D.clockbigCap} onChange={(v) => setField({ clockbigCap: v })} />);
      fields.push(<StyleableField key="weatherbigVal" fieldName="weatherbigVal" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Weather value" value={cfg.weatherbigVal || ''} placeholder={D.weatherbigVal} onChange={(v) => setField({ weatherbigVal: v })} />);
      fields.push(<StyleableField key="weatherbigCap" fieldName="weatherbigCap" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Weather caption" value={cfg.weatherbigCap || ''} placeholder={D.weatherbigCap} onChange={(v) => setField({ weatherbigCap: v })} />);
      fields.push(<StyleableField key="attendanceVal" fieldName="attendanceVal" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Attendance" value={cfg.attendanceVal || ''} placeholder={D.attendanceVal} onChange={(v) => setField({ attendanceVal: v })} />);
      fields.push(<StyleableField key="attendanceCap" fieldName="attendanceCap" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Attendance caption" value={cfg.attendanceCap || ''} placeholder={D.attendanceCap} onChange={(v) => setField({ attendanceCap: v })} />);
      fields.push(<StyleableField key="countdownLabel" fieldName="countdownLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Countdown label" value={cfg.countdownLabel || ''} placeholder={D.countdownLabel} onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(<StyleableField key="countdownValue" fieldName="countdownValue" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Countdown value" value={String(cfg.countdownValue ?? '')} placeholder={String(D.countdownValue)} onChange={(v) => setField({ countdownValue: v })} />);
      fields.push(<StyleableField key="countdownSub" fieldName="countdownSub" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Countdown sub" value={cfg.countdownSub || ''} placeholder={D.countdownSub} onChange={(v) => setField({ countdownSub: v })} />);

      fields.push(SH('teacher', 'Artist statement / teacher feature'));
      fields.push(<StyleableField key="teacherTag" fieldName="teacherTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Plate tag" value={cfg.teacherTag || ''} placeholder={D.teacherTag} onChange={(v) => setField({ teacherTag: v })} />);
      fields.push(<StyleableField key="teacherLabel" fieldName="teacherLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Label" value={cfg.teacherLabel || ''} placeholder={D.teacherLabel} onChange={(v) => setField({ teacherLabel: v })} />);
      fields.push(<StyleableField key="teacherName" fieldName="teacherName" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Name" value={cfg.teacherName || ''} placeholder={D.teacherName} onChange={(v) => setField({ teacherName: v })} />);
      fields.push(<StyleableField key="teacherMeta" fieldName="teacherMeta" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Meta" value={cfg.teacherMeta || ''} placeholder={D.teacherMeta} onChange={(v) => setField({ teacherMeta: v })} />);
      fields.push(<StyleableAreaField key="teacherQuote" fieldName="teacherQuote" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Statement" value={cfg.teacherQuote || ''} placeholder={D.teacherQuote} rows={3} onChange={(v) => setField({ teacherQuote: v })} />);
      fields.push(<StyleableField key="teacherByline" fieldName="teacherByline" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Byline" value={cfg.teacherByline || ''} placeholder={D.teacherByline} onChange={(v) => setField({ teacherByline: v })} />);

      fields.push(SH('announcement', "Curator's Note advisory"));
      fields.push(<StyleableField key="announcementTag" fieldName="announcementTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Tag" value={cfg.announcementTag || ''} placeholder={D.announcementTag} onChange={(v) => setField({ announcementTag: v })} />);
      fields.push(<StyleableField key="announcementHeadline" fieldName="announcementHeadline" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Headline" value={cfg.announcementHeadline || ''} placeholder={D.announcementHeadline} onChange={(v) => setField({ announcementHeadline: v })} />);
      fields.push(<StyleableAreaField key="announcementBody" fieldName="announcementBody" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Body" value={cfg.announcementBody || ''} placeholder={D.announcementBody} rows={3} onChange={(v) => setField({ announcementBody: v })} />);
      fields.push(<StyleableField key="announcementDate" fieldName="announcementDate" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="When" value={cfg.announcementDate || ''} placeholder={D.announcementDate} onChange={(v) => setField({ announcementDate: v })} />);

      fields.push(SH('brand', 'Gallery hours footer'));
      fields.push(<StyleableField key="brandHours" fieldName="brandHours" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Hours title" value={cfg.brandHours || ''} placeholder={D.brandHours} onChange={(v) => setField({ brandHours: v })} />);
      fields.push(<StyleableField key="brandSpan" fieldName="brandSpan" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Hours span" value={cfg.brandSpan || ''} placeholder={D.brandSpan} onChange={(v) => setField({ brandSpan: v })} />);
      fields.push(<StyleableField key="brandClosed" fieldName="brandClosed" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Closed line" value={cfg.brandClosed || ''} placeholder={D.brandClosed} onChange={(v) => setField({ brandClosed: v })} />);
      fields.push(<StyleableField key="brandCoda" fieldName="brandCoda" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Italic coda" value={cfg.brandCoda || ''} placeholder={D.brandCoda} onChange={(v) => setField({ brandCoda: v })} />);

      fields.push(SH('ticker', "Docent's Note ticker"));
      fields.push(<StyleableField key="tickerTag" fieldName="tickerTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Tag" value={cfg.tickerTag || ''} placeholder={D.tickerTag} onChange={(v) => setField({ tickerTag: v })} />);
      fields.push(<StyleableAreaField key="tickerMessage" fieldName="tickerMessage" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Italic crawl" value={cfg.tickerMessage || ''} placeholder={D.tickerMessage} rows={3} onChange={(v) => setField({ tickerMessage: v })} />);
      break;
    }
    case 'HS_BLUEPRINT': {
      // 2026-05-07 — wire DEFAULTS as placeholder text on every input
      // so the user can SEE what each field corresponds to instead of
      // staring at empty boxes. HTML `placeholder` shows in light grey
      // and disappears once the user types — they just overwrite the
      // hint without having to delete a stub value first.
      const D = HS_BLUEPRINT_DEFAULTS;
      const SH = (key: string, label: string) => (
        <div key={`sh-${key}`} className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200">{label}</div>
      );
      fields.push(SH('titleblock', 'Title block header'));
      fields.push(<StyleableField key="schoolCode" fieldName="schoolCode" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Code" value={cfg.schoolCode || ''} placeholder={D.schoolCode} onChange={(v) => setField({ schoolCode: v })} />);
      fields.push(<StyleableField key="schoolName" fieldName="schoolName" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="School sub" value={cfg.schoolName || ''} placeholder={D.schoolName} onChange={(v) => setField({ schoolName: v })} />);
      fields.push(<StyleableField key="brandLabel1" fieldName="brandLabel1" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Project label" value={cfg.brandLabel1 || ''} placeholder={D.brandLabel1} onChange={(v) => setField({ brandLabel1: v })} />);
      fields.push(<StyleableField key="brandProject" fieldName="brandProject" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Project value" value={cfg.brandProject || ''} placeholder={D.brandProject} onChange={(v) => setField({ brandProject: v })} />);
      fields.push(<StyleableField key="clockLabel" fieldName="clockLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Date/time label" value={cfg.clockLabel || ''} placeholder={D.clockLabel} onChange={(v) => setField({ clockLabel: v })} />);
      fields.push(<SelectField key="clockTimezone" label="Clock timezone" value={cfg.clockTimezone || ''} options={US_TIMEZONE_OPTIONS as unknown as Array<[string, string]>} onChange={(v) => setField({ clockTimezone: v })} />);
      fields.push(<StyleableField key="clockDate" fieldName="clockDate" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Date (manual override)" value={cfg.clockDate || ''} placeholder={D.clockDate} onChange={(v) => setField({ clockDate: v })} />);
      fields.push(<StyleableField key="clockTime" fieldName="clockTime" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Time (manual override)" value={cfg.clockTime || ''} placeholder={D.clockTime} onChange={(v) => setField({ clockTime: v })} />);
      fields.push(<StyleableField key="brandSheet" fieldName="brandSheet" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Sheet" value={cfg.brandSheet || ''} placeholder={D.brandSheet} onChange={(v) => setField({ brandSheet: v })} />);
      fields.push(<StyleableField key="brandRev" fieldName="brandRev" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Rev" value={cfg.brandRev || ''} placeholder={D.brandRev} onChange={(v) => setField({ brandRev: v })} />);

      fields.push(SH('greeting', 'Hero sheet A-01'));
      fields.push(<StyleableField key="greetingDimTop" fieldName="greetingDimTop" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Top dimension" value={cfg.greetingDimTop || ''} placeholder={D.greetingDimTop} onChange={(v) => setField({ greetingDimTop: v })} />);
      fields.push(<StyleableField key="greetingDimLeft" fieldName="greetingDimLeft" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Left dimension" value={cfg.greetingDimLeft || ''} placeholder={D.greetingDimLeft} onChange={(v) => setField({ greetingDimLeft: v })} />);
      fields.push(<StyleableField key="greetingEyebrow" fieldName="greetingEyebrow" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Eyebrow" value={cfg.greetingEyebrow || ''} placeholder={D.greetingEyebrow} onChange={(v) => setField({ greetingEyebrow: v })} />);
      fields.push(<StyleableField key="greetingHeadline" fieldName="greetingHeadline" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Headline" value={cfg.greetingHeadline || ''} placeholder={D.greetingHeadline} onChange={(v) => setField({ greetingHeadline: v })} />);
      fields.push(<StyleableAreaField key="greetingSubtitle" fieldName="greetingSubtitle" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Subtitle" value={cfg.greetingSubtitle || ''} placeholder={D.greetingSubtitle} rows={3} onChange={(v) => setField({ greetingSubtitle: v })} />);

      fields.push(SH('data', 'Data panels (A-01.1 through .4)'));
      fields.push(<StyleableField key="clockbigLabel" fieldName="clockbigLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Clock label" value={cfg.clockbigLabel || ''} placeholder={D.clockbigLabel} onChange={(v) => setField({ clockbigLabel: v })} />);
      fields.push(<StyleableField key="clockbigVal" fieldName="clockbigVal" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Clock value" value={cfg.clockbigVal || ''} placeholder={D.clockbigVal} onChange={(v) => setField({ clockbigVal: v })} />);
      fields.push(<StyleableField key="clockbigCap" fieldName="clockbigCap" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Clock caption" value={cfg.clockbigCap || ''} placeholder={D.clockbigCap} onChange={(v) => setField({ clockbigCap: v })} />);
      // 2026-05-07 — live weather. Operator picks location (zip/auto)
      // and units; renderer fetches from Open-Meteo every 15 min.
      // Manual overrides below win if operator types into them.
      fields.push(<SmartLocationField key="weatherLocation" value={cfg.weatherLocation || ''} onChange={(v) => setField({ weatherLocation: v })} />);
      fields.push(<SelectField key="weatherUnits" label="Units" value={cfg.weatherUnits || 'imperial'} options={[['imperial','°F'],['metric','°C']]} onChange={(v) => setField({ weatherUnits: v })} />);
      fields.push(<StyleableField key="weatherTemp" fieldName="weatherTemp" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Weather temp (manual override)" value={cfg.weatherTemp || ''} placeholder={D.weatherTemp} onChange={(v) => setField({ weatherTemp: v })} />);
      fields.push(<StyleableField key="weatherCondition" fieldName="weatherCondition" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Weather condition (manual override)" value={cfg.weatherCondition || ''} placeholder={D.weatherCondition} onChange={(v) => setField({ weatherCondition: v })} />);
      fields.push(<StyleableField key="attendanceValue" fieldName="attendanceValue" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Attendance" value={cfg.attendanceValue || ''} placeholder={D.attendanceValue} onChange={(v) => setField({ attendanceValue: v })} />);
      fields.push(<StyleableField key="attendanceCap" fieldName="attendanceCap" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Attendance caption" value={cfg.attendanceCap || ''} placeholder={D.attendanceCap} onChange={(v) => setField({ attendanceCap: v })} />);
      fields.push(<StyleableField key="countdownLabel" fieldName="countdownLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Countdown label" value={cfg.countdownLabel || ''} placeholder={D.countdownLabel} onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(<StyleableField key="countdownValue" fieldName="countdownValue" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Countdown value" value={String(cfg.countdownValue ?? '')} placeholder={String(D.countdownValue)} onChange={(v) => setField({ countdownValue: v })} />);
      fields.push(<StyleableField key="countdownSub" fieldName="countdownSub" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Countdown sub" value={cfg.countdownSub || ''} placeholder={D.countdownSub} onChange={(v) => setField({ countdownSub: v })} />);

      fields.push(SH('schedule', 'Sheet A-02 schedule (3 events)'));
      for (const n of [0, 1, 2]) {
        const k = `event${n}` as 'event0' | 'event1' | 'event2';
        fields.push(<StyleableField key={`${k}Time`} fieldName={`${k}Time`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Time`} value={cfg[`${k}Time`] || ''} placeholder={D[`${k}Time`]} onChange={(v) => setField({ [`${k}Time`]: v })} />);
        fields.push(<StyleableField key={`${k}Code`} fieldName={`${k}Code`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Course`} value={cfg[`${k}Code`] || ''} placeholder={D[`${k}Code`]} onChange={(v) => setField({ [`${k}Code`]: v })} />);
        fields.push(<StyleableField key={`${k}Name`} fieldName={`${k}Name`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Section`} value={cfg[`${k}Name`] || ''} placeholder={D[`${k}Name`]} onChange={(v) => setField({ [`${k}Name`]: v })} />);
        fields.push(<StyleableField key={`${k}Room`} fieldName={`${k}Room`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Room`} value={cfg[`${k}Room`] || ''} placeholder={D[`${k}Room`]} onChange={(v) => setField({ [`${k}Room`]: v })} />);
        fields.push(<StyleableField key={`${k}Who`} fieldName={`${k}Who`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Instructor`} value={cfg[`${k}Who`] || ''} placeholder={D[`${k}Who`]} onChange={(v) => setField({ [`${k}Who`]: v })} />);
      }

      fields.push(SH('teacher', 'Sheet A-03 faculty profile'));
      fields.push(<StyleableField key="teacherNum" fieldName="teacherNum" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Number" value={cfg.teacherNum || ''} placeholder={D.teacherNum} onChange={(v) => setField({ teacherNum: v })} />);
      fields.push(<StyleableField key="teacherLabel" fieldName="teacherLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Label" value={cfg.teacherLabel || ''} placeholder={D.teacherLabel} onChange={(v) => setField({ teacherLabel: v })} />);
      fields.push(<StyleableField key="teacherName" fieldName="teacherName" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Name" value={cfg.teacherName || ''} placeholder={D.teacherName} onChange={(v) => setField({ teacherName: v })} />);
      fields.push(<StyleableField key="teacherMeta" fieldName="teacherMeta" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Meta" value={cfg.teacherMeta || ''} placeholder={D.teacherMeta} onChange={(v) => setField({ teacherMeta: v })} />);
      fields.push(<StyleableAreaField key="teacherQuote" fieldName="teacherQuote" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Quote" value={cfg.teacherQuote || ''} placeholder={D.teacherQuote} rows={3} onChange={(v) => setField({ teacherQuote: v })} />);

      fields.push(SH('announcement', 'Sheet A-04 advisory'));
      fields.push(<StyleableField key="announcementTag" fieldName="announcementTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Tag" value={cfg.announcementTag || ''} placeholder={D.announcementTag} onChange={(v) => setField({ announcementTag: v })} />);
      fields.push(<StyleableField key="announcementHeadline" fieldName="announcementHeadline" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Headline" value={cfg.announcementHeadline || ''} placeholder={D.announcementHeadline} onChange={(v) => setField({ announcementHeadline: v })} />);
      fields.push(<StyleableAreaField key="announcementBody" fieldName="announcementBody" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Body" value={cfg.announcementBody || ''} placeholder={D.announcementBody} rows={3} onChange={(v) => setField({ announcementBody: v })} />);
      fields.push(<StyleableField key="announcementDate" fieldName="announcementDate" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="When" value={cfg.announcementDate || ''} placeholder={D.announcementDate} onChange={(v) => setField({ announcementDate: v })} />);

      fields.push(SH('ticker', 'Revision log ticker'));
      fields.push(<StyleableField key="tickerTag" fieldName="tickerTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Tag" value={cfg.tickerTag || ''} placeholder={D.tickerTag} onChange={(v) => setField({ tickerTag: v })} />);
      fields.push(<StyleableAreaField key="tickerMessage" fieldName="tickerMessage" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="RFI log messages" value={cfg.tickerMessage || ''} placeholder={D.tickerMessage} rows={3} onChange={(v) => setField({ tickerMessage: v })} />);
      break;
    }
    case 'HS_ZINE': {
      // 2026-05-07 — placeholders sourced from DEFAULTS.
      const D = HS_ZINE_DEFAULTS;
      const SH = (key: string, label: string) => (
        <div key={`sh-${key}`} className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200">{label}</div>
      );
      fields.push(SH('school', 'Masthead'));
      fields.push(<StyleableField key="schoolName" fieldName="schoolName" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Big title" value={cfg.schoolName || ''} placeholder={D.schoolName} onChange={(v) => setField({ schoolName: v })} />);
      fields.push(<StyleableField key="schoolSub" fieldName="schoolSub" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Sub line" value={cfg.schoolSub || ''} placeholder={D.schoolSub} onChange={(v) => setField({ schoolSub: v })} />);
      fields.push(<StyleableField key="brandStamp1" fieldName="brandStamp1" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Stamp 1 (red)" value={cfg.brandStamp1 || ''} placeholder={D.brandStamp1} onChange={(v) => setField({ brandStamp1: v })} />);
      fields.push(<StyleableField key="brandStamp2" fieldName="brandStamp2" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Stamp 2 (ink)" value={cfg.brandStamp2 || ''} placeholder={D.brandStamp2} onChange={(v) => setField({ brandStamp2: v })} />);
      fields.push(<StyleableField key="brandStamp3" fieldName="brandStamp3" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Stamp 3 (cyan)" value={cfg.brandStamp3 || ''} placeholder={D.brandStamp3} onChange={(v) => setField({ brandStamp3: v })} />);

      fields.push(SH('greeting', 'Hero sheet'));
      fields.push(<StyleableField key="greetingEyebrow" fieldName="greetingEyebrow" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Eyebrow" value={cfg.greetingEyebrow || ''} placeholder={D.greetingEyebrow} onChange={(v) => setField({ greetingEyebrow: v })} />);
      fields.push(<StyleableField key="greetingHeadline1" fieldName="greetingHeadline1" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Headline pt1" value={cfg.greetingHeadline1 || ''} placeholder={D.greetingHeadline1} onChange={(v) => setField({ greetingHeadline1: v })} />);
      fields.push(<StyleableField key="greetingHeadline2" fieldName="greetingHeadline2" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Headline pt2 (yellow highlight)" value={cfg.greetingHeadline2 || ''} placeholder={D.greetingHeadline2} onChange={(v) => setField({ greetingHeadline2: v })} />);
      fields.push(<StyleableField key="greetingHeadline3" fieldName="greetingHeadline3" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Headline pt3" value={cfg.greetingHeadline3 || ''} placeholder={D.greetingHeadline3} onChange={(v) => setField({ greetingHeadline3: v })} />);
      fields.push(<StyleableAreaField key="greetingSubtitle" fieldName="greetingSubtitle" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Subtitle" value={cfg.greetingSubtitle || ''} placeholder={D.greetingSubtitle} rows={3} onChange={(v) => setField({ greetingSubtitle: v })} />);

      fields.push(SH('teacher', 'Teacher poster'));
      fields.push(<StyleableField key="teacherCaption" fieldName="teacherCaption" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Big name caption" value={cfg.teacherCaption || ''} placeholder={D.teacherCaption} onChange={(v) => setField({ teacherCaption: v })} />);
      fields.push(<StyleableField key="teacherSub" fieldName="teacherSub" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Sub caption" value={cfg.teacherSub || ''} placeholder={D.teacherSub} onChange={(v) => setField({ teacherSub: v })} />);

      fields.push(SH('stats', 'Side stats'));
      fields.push(<StyleableField key="attendanceValue" fieldName="attendanceValue" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Attendance value" value={cfg.attendanceValue || ''} placeholder={D.attendanceValue} onChange={(v) => setField({ attendanceValue: v })} />);
      fields.push(<StyleableField key="attendanceCap" fieldName="attendanceCap" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Attendance caption" value={cfg.attendanceCap || ''} placeholder={D.attendanceCap} onChange={(v) => setField({ attendanceCap: v })} />);
      fields.push(<StyleableField key="countdownLabel" fieldName="countdownLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Countdown label" value={cfg.countdownLabel || ''} placeholder={D.countdownLabel} onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(<StyleableField key="countdownValue" fieldName="countdownValue" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Countdown value" value={String(cfg.countdownValue ?? '')} placeholder={String(D.countdownValue)} onChange={(v) => setField({ countdownValue: v })} />);
      fields.push(<StyleableField key="countdownSub" fieldName="countdownSub" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Countdown sub" value={cfg.countdownSub || ''} placeholder={D.countdownSub} onChange={(v) => setField({ countdownSub: v })} />);

      fields.push(SH('events', 'Polaroid events (3)'));
      for (const n of [0, 1, 2]) {
        const k = `event${n}` as 'event0' | 'event1' | 'event2';
        fields.push(<StyleableField key={`${k}When`} fieldName={`${k}When`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · When`} value={cfg[`${k}When`] || ''} placeholder={D[`${k}When`]} onChange={(v) => setField({ [`${k}When`]: v })} />);
        fields.push(<StyleableField key={`${k}Name`} fieldName={`${k}Name`} styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label={`#${n + 1} · Title`} value={cfg[`${k}Name`] || ''} placeholder={D[`${k}Name`]} onChange={(v) => setField({ [`${k}Name`]: v })} />);
      }
      fields.push(<StyleableField key="countdownBigValue" fieldName="countdownBigValue" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Big red countdown value" value={String(cfg.countdownBigValue ?? '')} placeholder={String(D.countdownBigValue)} onChange={(v) => setField({ countdownBigValue: v })} />);
      fields.push(<StyleableField key="countdownBigLabel" fieldName="countdownBigLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Big red countdown label" value={cfg.countdownBigLabel || ''} placeholder={D.countdownBigLabel} onChange={(v) => setField({ countdownBigLabel: v })} />);

      fields.push(SH('announcement', 'Ransom-letter announcement'));
      fields.push(<StyleableField key="announcementTag" fieldName="announcementTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Tag" value={cfg.announcementTag || ''} placeholder={D.announcementTag} onChange={(v) => setField({ announcementTag: v })} />);
      fields.push(<StyleableField key="announcementHeadline" fieldName="announcementHeadline" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Headline" value={cfg.announcementHeadline || ''} placeholder={D.announcementHeadline} onChange={(v) => setField({ announcementHeadline: v })} />);
      fields.push(<StyleableAreaField key="announcementBody" fieldName="announcementBody" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Body" value={cfg.announcementBody || ''} placeholder={D.announcementBody} rows={3} onChange={(v) => setField({ announcementBody: v })} />);
      fields.push(<StyleableField key="announcementDate" fieldName="announcementDate" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="When" value={cfg.announcementDate || ''} placeholder={D.announcementDate} onChange={(v) => setField({ announcementDate: v })} />);

      fields.push(SH('clock', 'Floating clock — live data'));
      fields.push(<StyleableField key="clockLabel" fieldName="clockLabel" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Label" value={cfg.clockLabel || ''} placeholder={D.clockLabel} onChange={(v) => setField({ clockLabel: v })} />);
      fields.push(<SelectField key="clockTimezone" label="Timezone" value={cfg.clockTimezone || ''} options={US_TIMEZONE_OPTIONS as unknown as Array<[string, string]>} onChange={(v) => setField({ clockTimezone: v })} />);
      fields.push(<StyleableField key="clockTime" fieldName="clockTime" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Time (manual override)" value={cfg.clockTime || ''} placeholder={D.clockTime} onChange={(v) => setField({ clockTime: v })} />);
      // Live weather — Zine renders the full 'tue · apr 21 · 46° · clear' lowercase string.
      fields.push(<SmartLocationField key="weatherLocation" value={cfg.weatherLocation || ''} onChange={(v) => setField({ weatherLocation: v })} />);
      fields.push(<SelectField key="weatherUnits" label="Units" value={cfg.weatherUnits || 'imperial'} options={[['imperial','°F'],['metric','°C']]} onChange={(v) => setField({ weatherUnits: v })} />);
      fields.push(<StyleableField key="weatherCondition" fieldName="weatherCondition" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Date/weather line (manual override)" value={cfg.weatherCondition || ''} placeholder={D.weatherCondition} onChange={(v) => setField({ weatherCondition: v })} />);

      fields.push(SH('ticker', 'xeroxwire ticker'));
      fields.push(<StyleableField key="tickerTag" fieldName="tickerTag" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Tag" value={cfg.tickerTag || ''} placeholder={D.tickerTag} onChange={(v) => setField({ tickerTag: v })} />);
      fields.push(<StyleableAreaField key="tickerMessage" fieldName="tickerMessage" styles={cfg.__styles} onStylesChange={(s) => setField({ __styles: s })} label="Typewriter crawl" value={cfg.tickerMessage || ''} placeholder={D.tickerMessage} rows={3} onChange={(v) => setField({ tickerMessage: v })} />);
      break;
    }
    // ─── Sprint 8c follow-up — STREAMING widget editor ─────────────
    // Bridges the Settings → Streaming connections into the canvas.
    // Operator picks a channel they've already added in settings;
    // we copy the channel's playback fields into the widget config so
    // the StreamingWidget renders without further setup. Without this
    // editor case, the widget had no UI to pick a channel and operators
    // were stuck pasting raw HLS URLs into JSON.
    case 'STREAMING': {
      fields.push(
        <StreamingChannelPickerField
          key="streamingChannelId"
          value={cfg.streamingChannelId || ''}
          onPick={(channel) => setField({
            streamingChannelId: channel.id,
            playbackUrl: channel.playbackUrl,
            playbackType: channel.playbackType || 'hls',
            embedUrl: channel.playbackType === 'iframe' ? channel.playbackUrl : undefined,
            channelTitle: channel.title,
            allowAdOverlay: channel.allowAdOverlay,
          })}
          onClear={() => setField({
            streamingChannelId: undefined,
            playbackUrl: undefined,
            playbackType: undefined,
            embedUrl: undefined,
            channelTitle: undefined,
          })}
        />,
      );
      fields.push(<ToggleField key="muted" label="Muted (venue default)" value={cfg.muted !== false} onChange={(v) => setField({ muted: v })} />);
      fields.push(<SelectField key="fitMode" label="Fit mode" value={cfg.fitMode || 'cover'} options={[['cover','Fill (crop)'],['contain','Fit (no crop)']]} onChange={(v) => setField({ fitMode: v })} />);
      fields.push(<ToggleField key="allowAdOverlay" label="Allow ad overlay" value={cfg.allowAdOverlay !== false} onChange={(v) => setField({ allowAdOverlay: v })} />);
      break;
    }
    // FITNESS_LIVE_TV uses its own catalog-driven config but ALSO accepts
    // a connected channel. Same picker; we map channel into the widget's
    // legacy `streamUrl` + `streamType` fields so existing fitness
    // templates keep working.
    case 'FITNESS_LIVE_TV': {
      fields.push(
        <StreamingChannelPickerField
          key="streamingChannelId"
          value={cfg.streamingChannelId || ''}
          onPick={(channel) => setField({
            streamingChannelId: channel.id,
            streamUrl: channel.playbackUrl,
            streamType: channel.playbackType === 'iframe' ? 'iframe' : 'hls',
            channelName: channel.title,
            channelLogoUrl: channel.thumbnailUrl,
          })}
          onClear={() => setField({
            streamingChannelId: undefined,
            streamUrl: undefined,
            streamType: 'demo',
            channelName: undefined,
          })}
        />,
      );
      fields.push(<TextField key="channelName" label="Channel name (override)" value={cfg.channelName || ''} placeholder="ESPN" onChange={(v) => setField({ channelName: v })} />);
      fields.push(<ToggleField key="muted" label="Muted" value={cfg.muted !== false} onChange={(v) => setField({ muted: v })} />);
      break;
    }
    // ─── Gym widget editors — same workflow as the K-12 widgets above.
    // Operator (2026-05-03): "make sure they are editable just like the
    // k-12 units, exact same workflow for everything." Each widget gets
    // an explicit `case` here so the operator sees a real form (title /
    // accent / rotation / etc.) instead of falling through to the
    // generic auto-form that doesn't know about color pickers, asset
    // pickers, or array editors.
    // 2026-05-26 monetize-audit FAIL #4 — HOUSE_AD_BANNER was registered
    // in variants-register.ts + rendered in WidgetRenderer but had NO
    // PropertiesPanel case, so the operator could drop the tile and saw
    // an empty side panel — no way to add slots, pick rotation, or set
    // sponsor label. Same operator complaint shape as
    // "this has no hot spot at all" — the panel ships a real form now.
    case 'HOUSE_AD_BANNER': {
      fields.push(<TextField key="zoneLabel" label="Zone label (optional)" value={cfg.zoneLabel || ''} placeholder="OUR SPONSORS" onChange={(v) => setField({ zoneLabel: v })} />);
      fields.push(<TextField key="intervalMs" label="Rotate every (ms)" value={String(cfg.intervalMs ?? 8000)} placeholder="8000" onChange={(v) => setField({ intervalMs: parseInt(v) || 8000 })} />);
      fields.push(<SelectField key="placement" label="Placement style" value={cfg.placement || 'banner'} options={[['banner','Banner (contain)'],['square','Square (contain)'],['fullbleed','Full-bleed (cover, no pip indicator)']]} onChange={(v) => setField({ placement: v })} />);
      fields.push(<ToggleField key="showSponsorLabel" label='Show "Sponsored · {name}" disclosure' value={cfg.showSponsorLabel !== false} onChange={(v) => setField({ showSponsorLabel: v })} />);
      fields.push(<ListItemsEditor key="slots" label="Sponsor slots" itemNoun="slot" help="Each slot is one sponsor creative in the rotation." value={cfg.slots} onChange={(v) => setField({ slots: v })} newItem={{ assetUrl: '', assetMime: '', sponsorName: '', ctaText: '', clickThroughUrl: '' }} fields={[
        { key: 'assetUrl', label: 'Image / video', type: 'image' },
        { key: 'sponsorName', label: 'Sponsor name', type: 'text', placeholder: "Joe's Pizza" },
        { key: 'ctaText', label: 'Call-to-action text', type: 'text', placeholder: 'Order online' },
        { key: 'clickThroughUrl', label: 'Click-through URL', type: 'text', placeholder: 'https://example.com' },
        { key: 'assetMime', label: 'Asset MIME (e.g. video/mp4 — auto if blank)', type: 'text', placeholder: 'image/png' },
      ]} />);
      break;
    }
    // 2026-05-26 monetize-audit FAIL #4 + #10/#11 — MusicPlayerWidget
    // ships six sources (somafm / npr / nts / custom-stream / apple-
    // business / spotify-business) plus pauseDuringEmergency +
    // businessHours, but had no PropertiesPanel case at all. Operator
    // dropped the tile and saw nothing editable. Now exposes every
    // documented knob.
    case 'MUSIC_PLAYER': {
      fields.push(
        <SelectField
          key="source"
          label="Music source"
          value={cfg.source || 'somafm'}
          options={[
            ['somafm', 'SomaFM (free, 21 stations)'],
            ['npr', 'NPR Live — local station by lat/lng'],
            ['nts', 'NTS Radio (free, 2 channels)'],
            ['custom-stream', 'Custom stream URL (Icecast / Shoutcast / m3u8)'],
            ['apple-business', 'Apple Music for Business (coming soon)'],
            ['spotify-business', 'Spotify for Business (coming soon)'],
          ]}
          onChange={(v) => setField({ source: v })}
        />,
      );
      if ((cfg.source || 'somafm') === 'somafm') {
        // 21 SomaFM stations matching the SOMAFM_DIRECT_URLS map in
        // MusicPlayerWidget.tsx — keep this list in sync if more land.
        fields.push(
          <SelectField
            key="somafmStationId"
            label="SomaFM station"
            value={cfg.somafmStationId || 'groovesalad'}
            options={[
              ['groovesalad', 'Groove Salad — chilled ambient electronica'],
              ['dronezone', 'Drone Zone — atmospheric textures'],
              ['secretagent', 'Secret Agent — spy/crime jazz'],
              ['lush', 'Lush — sensuous female-vocal electronic'],
              ['bagel', 'BAGeL Radio — indie rock'],
              ['defcon', 'DEF CON Radio — music for hackers'],
              ['spacestation', 'Space Station Soma — tribal downtempo'],
              ['beatblender', 'Beat Blender — late-night downtempo'],
              ['indie', 'Indie Pop Rocks!'],
              ['cliqhop', 'cliqhop idm'],
              ['poptron', 'PopTron — electropop'],
              ['thetrip', 'The Trip — progressive house'],
              ['fluid', 'Fluid — liquid drum & bass'],
              ['folkfwd', 'Folk Forward — indie folk'],
              ['illstreet', 'Illinois Street Lounge — cocktail jazz'],
              ['brfm', 'Black Rock FM — Burning Man'],
              ['digitalis', 'Digitalis — lo-fi electroacoustica'],
              ['metal', 'Metal Detector — stoner/doom'],
              ['7soul', 'Seven Inch Soul — 45rpm vinyl'],
              ['seventies', 'Left Coast 70s'],
              ['u80s', 'Underground 80s'],
            ]}
            onChange={(v) => setField({ somafmStationId: v })}
          />,
        );
      }
      if (cfg.source === 'nts') {
        fields.push(
          <SelectField
            key="ntsChannel"
            label="NTS channel"
            value={cfg.ntsChannel || '1'}
            options={[['1', 'NTS 1'], ['2', 'NTS 2']]}
            onChange={(v) => setField({ ntsChannel: v })}
          />,
        );
      }
      if (cfg.source === 'npr') {
        fields.push(<TextField key="nprStationCallSign" label="NPR station call sign (e.g. KQED, WBEZ)" value={cfg.nprStationCallSign || ''} placeholder="KQED" onChange={(v) => setField({ nprStationCallSign: v })} />);
        fields.push(<TextField key="customStreamUrl" label="NPR direct stream URL (set by the lat/lng finder)" value={cfg.customStreamUrl || ''} placeholder="https://streams.kqed.org/kqedradio" onChange={(v) => setField({ customStreamUrl: v })} />);
      }
      if (cfg.source === 'custom-stream') {
        fields.push(<TextField key="customStreamUrl" label="Custom stream URL (Icecast / Shoutcast / .m3u8)" value={cfg.customStreamUrl || ''} placeholder="https://example.com/stream.m3u8" onChange={(v) => setField({ customStreamUrl: v })} />);
      }
      fields.push(<TextField key="zoneLabel" label="Zone label (optional)" value={cfg.zoneLabel || ''} placeholder="NOW PLAYING" onChange={(v) => setField({ zoneLabel: v })} />);
      fields.push(<TextField key="defaultVolume" label="Default volume (0-100)" value={String(cfg.defaultVolume ?? 70)} placeholder="70" onChange={(v) => {
        const n = parseInt(v) || 0;
        setField({ defaultVolume: Math.max(0, Math.min(100, n)) });
      }} />);
      fields.push(<ToggleField key="autoResume" label="Auto-resume on player reload" value={cfg.autoResume !== false} onChange={(v) => setField({ autoResume: v })} />);
      fields.push(<ToggleField key="pauseDuringEmergency" label="Silence during emergency (recommended)" value={cfg.pauseDuringEmergency !== false} onChange={(v) => setField({ pauseDuringEmergency: v })} />);
      // Business-hours editor — structured start/end time + day-of-week
      // toggles (no raw JSON; §19 P3). Blank = plays 24/7. Overnight
      // windows (e.g. 22:00 → 02:00) and per-day selection are both
      // expressible; the renderer (MusicPlayerWidget.isWithinBusinessHours)
      // treats an empty daysOfWeek as "every day".
      fields.push(<BusinessHoursField key="businessHours" value={cfg.businessHours} onChange={(v) => setField({ businessHours: v })} />);
      break;
    }
    // 2026-05-26 audit fix — sports composite widgets (SCORE_HOME,
    // SCORE_AWAY, GAME_CLOCK, GAME_SEGMENT, GAME_STAT) had NO panel
    // case. They register without a `variant` so the default-branch
    // V2 generic editor never fires. Operator got only the Universal
    // Text Style strip — couldn't edit the placeholder fallback text,
    // the team side, the live-stat key binding, or the font size.
    // Mirror the SCOREBOARD-variant pattern so each standalone sport
    // widget exposes the same controls.
    case 'SCORE_HOME':
    case 'SCORE_AWAY': {
      const team = zone.widgetType === 'SCORE_HOME' ? 'home' : 'away';
      if (templateDataSource === 'CTS') fields.push(<CtsLiveCard key="cts" variantOrType={zone.widgetType} cfg={cfg} setField={setField} />);
      fields.push(<TextField key="placeholder" label={`Sample / fallback ${team} score`} value={cfg.placeholder || ''} placeholder="24" onChange={(v) => setField({ placeholder: v })} />);
      fields.push(<ColorField key="color" label="Text color" value={cfg.color || '#ffffff'} onChange={(v) => setField({ color: v })} />);
      fields.push(<ColorField key="accentColor" label="Accent color (glow / underline)" value={cfg.accentColor || ''} onChange={(v) => setField({ accentColor: v })} allowTransparent />);
      fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || 'transparent'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
      fields.push(<NumField key="fontSize" id={`${team}-fontSize`} label="Font size (px)" value={typeof cfg.fontSize === 'number' ? cfg.fontSize : 128} onChange={(v) => setField({ fontSize: v })} min={16} max={480} step={2} />);
      fields.push(<SelectField key="fontWeight" label="Font weight" value={String(cfg.fontWeight ?? 900)} options={[['400','Regular'],['600','Semibold'],['700','Bold'],['800','Extra-bold'],['900','Black']]} onChange={(v) => setField({ fontWeight: parseInt(v) })} />);
      fields.push(<SelectField key="align" label="Align" value={String(cfg.align || 'center')} options={[['left','Left'],['center','Center'],['right','Right']]} onChange={(v) => setField({ align: v })} />);
      break;
    }
    case 'GAME_CLOCK': {
      if (templateDataSource === 'CTS') fields.push(<CtsLiveCard key="cts" variantOrType={zone.widgetType} cfg={cfg} setField={setField} />);
      fields.push(<TextField key="placeholder" label="Sample / fallback clock (no live game)" value={cfg.placeholder || ''} placeholder="07:42" onChange={(v) => setField({ placeholder: v })} />);
      fields.push(<ColorField key="color" label="Text color" value={cfg.color || '#ffffff'} onChange={(v) => setField({ color: v })} />);
      fields.push(<ColorField key="accentColor" label="Accent color (low-time flash)" value={cfg.accentColor || ''} onChange={(v) => setField({ accentColor: v })} allowTransparent />);
      fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || 'transparent'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
      fields.push(<NumField key="fontSize" id="gc-fontSize" label="Font size (px)" value={typeof cfg.fontSize === 'number' ? cfg.fontSize : 96} onChange={(v) => setField({ fontSize: v })} min={16} max={480} step={2} />);
      fields.push(<SelectField key="fontWeight" label="Font weight" value={String(cfg.fontWeight ?? 800)} options={[['400','Regular'],['600','Semibold'],['700','Bold'],['800','Extra-bold'],['900','Black']]} onChange={(v) => setField({ fontWeight: parseInt(v) })} />);
      fields.push(<SelectField key="align" label="Align" value={String(cfg.align || 'center')} options={[['left','Left'],['center','Center'],['right','Right']]} onChange={(v) => setField({ align: v })} />);
      break;
    }
    case 'GAME_SEGMENT': {
      if (templateDataSource === 'CTS') fields.push(<CtsLiveCard key="cts" variantOrType={zone.widgetType} cfg={cfg} setField={setField} />);
      fields.push(<TextField key="placeholder" label="Sample / fallback period" value={cfg.placeholder || ''} placeholder="Q3" onChange={(v) => setField({ placeholder: v })} />);
      fields.push(<TextField key="label" label="Label prefix (optional)" value={cfg.label || ''} placeholder="Period" onChange={(v) => setField({ label: v })} />);
      fields.push(<ColorField key="color" label="Text color" value={cfg.color || '#ffffff'} onChange={(v) => setField({ color: v })} />);
      fields.push(<ColorField key="accentColor" label="Accent color" value={cfg.accentColor || ''} onChange={(v) => setField({ accentColor: v })} allowTransparent />);
      fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || 'transparent'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
      fields.push(<NumField key="fontSize" id="gs-fontSize" label="Font size (px)" value={typeof cfg.fontSize === 'number' ? cfg.fontSize : 64} onChange={(v) => setField({ fontSize: v })} min={12} max={320} step={2} />);
      fields.push(<SelectField key="fontWeight" label="Font weight" value={String(cfg.fontWeight ?? 700)} options={[['400','Regular'],['600','Semibold'],['700','Bold'],['800','Extra-bold'],['900','Black']]} onChange={(v) => setField({ fontWeight: parseInt(v) })} />);
      fields.push(<SelectField key="align" label="Align" value={String(cfg.align || 'center')} options={[['left','Left'],['center','Center'],['right','Right']]} onChange={(v) => setField({ align: v })} />);
      break;
    }
    case 'GAME_STAT': {
      fields.push(<TextField key="label" label="Label" value={cfg.label || ''} placeholder="Down" onChange={(v) => setField({ label: v })} />);
      fields.push(<TextField key="placeholder" label="Sample / fallback value" value={cfg.placeholder || ''} placeholder="2" onChange={(v) => setField({ placeholder: v })} />);
      if (templateDataSource === 'CTS') {
        // CTS on → bind to a REAL CTS feed field via the catalog picker
        // (cfg.ctsField). The old free-list of sport keys (sets/serve/
        // fouls/…) named values CTS doesn't transmit — gone for the live
        // case so the operator can only pick what the console actually
        // gives us.
        fields.push(<CtsLiveCard key="cts" variantOrType={zone.widgetType} cfg={cfg} setField={setField} />);
      } else {
        // Manual / non-CTS bind — operator types the Game.stats key
        // directly (these are operator-input stats, not CTS-driven).
        fields.push(<SelectField key="statKey" label="Stat key (manual bind)" value={cfg.statKey || ''} options={[
          ['','— pick a stat —'],
          ['down','down (football)'],
          ['distance','distance (football)'],
          ['ballOn','ball on (football)'],
          ['balls','balls (baseball/softball)'],
          ['strikes','strikes (baseball/softball)'],
          ['outs','outs (baseball/softball)'],
          ['homeSets','home sets (volleyball/tennis)'],
          ['awaySets','away sets (volleyball/tennis)'],
          ['serving','serving (volleyball/tennis)'],
          ['homeFouls','home team fouls (basketball)'],
          ['awayFouls','away team fouls (basketball)'],
          ['possession','possession (basketball/football)'],
          ['homeTimeouts','timeouts — home'],
          ['awayTimeouts','timeouts — away'],
        ]} onChange={(v) => setField({ statKey: v })} />);
      }
      fields.push(<ColorField key="color" label="Text color" value={cfg.color || '#ffffff'} onChange={(v) => setField({ color: v })} />);
      fields.push(<ColorField key="accentColor" label="Accent color" value={cfg.accentColor || ''} onChange={(v) => setField({ accentColor: v })} allowTransparent />);
      fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || 'transparent'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
      fields.push(<NumField key="fontSize" id="gst-fontSize" label="Font size (px)" value={typeof cfg.fontSize === 'number' ? cfg.fontSize : 56} onChange={(v) => setField({ fontSize: v })} min={12} max={320} step={2} />);
      fields.push(<SelectField key="fontWeight" label="Font weight" value={String(cfg.fontWeight ?? 700)} options={[['400','Regular'],['600','Semibold'],['700','Bold'],['800','Extra-bold'],['900','Black']]} onChange={(v) => setField({ fontWeight: parseInt(v) })} />);
      fields.push(<SelectField key="align" label="Align" value={String(cfg.align || 'center')} options={[['left','Left'],['center','Center'],['right','Right']]} onChange={(v) => setField({ align: v })} />);
      break;
    }
    // 2026-07-01 — swim/dive sport split flagship widgets (operator:
    // "lanes and shit that we need to show where each swimmer is" +
    // "[diving] wouldn't that be totally different? SEPARATE it"). Both
    // read Game.stats.results (the same MeetResult contract the console's
    // "Meet results" grid writes — see MeetResultsSection); the fields
    // here only control presentation (header text, order, colors), not a
    // separate data source.
    case 'SWIM_LANE_GRID': {
      // Sports Wave S2-2 (2026-07-02) — "Bind to game" picker. Wraps this
      // zone in its own <GameStateProvider> (WidgetRenderer.tsx) whenever
      // there's no ambient one already, independent of whichever screen
      // this template ends up scheduled to.
      fields.push(<GameBindField key="gameId" value={cfg.gameId || ''} onChange={(v) => setField({ gameId: v })} />);
      fields.push(<TextField key="headerText" label="Header text (blank = auto from the live event)" value={cfg.headerText || ''} placeholder="EVENT 12 — BOYS 100 FREESTYLE — HEAT 3 OF 4" onChange={(v) => setField({ headerText: v })} />);
      fields.push(<TextField key="eventFilter" label="Pin to event (exact name; blank = auto-pick current heat)" value={cfg.eventFilter || ''} placeholder="" onChange={(v) => setField({ eventFilter: v })} />);
      fields.push(<SelectField key="orderMode" label="Row order" value={String(cfg.orderMode || 'lane')} options={[['lane','Lane order (the grid spectators read)'],['place','Results order (sorted by finish place)']]} onChange={(v) => setField({ orderMode: v })} />);
      fields.push(<NumField key="laneCount" id="slg-laneCount" label="Number of lanes" value={typeof cfg.laneCount === 'number' ? cfg.laneCount : 8} onChange={(v) => setField({ laneCount: v })} min={1} max={12} step={1} />);
      fields.push(<ColorField key="headerColor" label="Header text color" value={cfg.headerColor || '#fbbf24'} onChange={(v) => setField({ headerColor: v })} />);
      fields.push(<ColorField key="textColor" label="Swimmer name color" value={cfg.textColor || '#ffffff'} onChange={(v) => setField({ textColor: v })} />);
      fields.push(<ColorField key="laneColColor" label="Lane number chip color" value={cfg.laneColColor || '#1e3a8a'} onChange={(v) => setField({ laneColColor: v })} />);
      fields.push(<ColorField key="homeColor" label="Home team color bar" value={cfg.homeColor || '#1e3a8a'} onChange={(v) => setField({ homeColor: v })} />);
      fields.push(<ColorField key="awayColor" label="Away team color bar" value={cfg.awayColor || '#b91c1c'} onChange={(v) => setField({ awayColor: v })} />);
      fields.push(<ColorField key="panelColor" label="Row / panel background" value={cfg.panelColor || '#0c1830'} onChange={(v) => setField({ panelColor: v })} allowTransparent />);
      fields.push(<ColorField key="bgColor" label="Scene background" value={cfg.bgColor || '#050b16'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
      break;
    }
    case 'DIVE_LEADERBOARD': {
      fields.push(<GameBindField key="gameId" value={cfg.gameId || ''} onChange={(v) => setField({ gameId: v })} />);
      fields.push(<TextField key="headerText" label="Header text (blank = auto from the live event)" value={cfg.headerText || ''} placeholder="GIRLS 1M SPRINGBOARD — FINAL" onChange={(v) => setField({ headerText: v })} />);
      fields.push(<TextField key="eventFilter" label="Pin to event (exact name; blank = auto-pick current round)" value={cfg.eventFilter || ''} placeholder="" onChange={(v) => setField({ eventFilter: v })} />);
      fields.push(<NumField key="divesInList" id="dl-divesInList" label="Dives in the list (0 = hide the count)" value={typeof cfg.divesInList === 'number' ? cfg.divesInList : 6} onChange={(v) => setField({ divesInList: v })} min={0} max={20} step={1} />);
      fields.push(<ColorField key="headerColor" label="Header text color" value={cfg.headerColor || '#fbbf24'} onChange={(v) => setField({ headerColor: v })} />);
      fields.push(<ColorField key="textColor" label="Diver name color" value={cfg.textColor || '#ffffff'} onChange={(v) => setField({ textColor: v })} />);
      fields.push(<ColorField key="accentColor" label="Accent color (header border, leader highlight)" value={cfg.accentColor || '#a78bfa'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<ColorField key="homeColor" label="Home team color bar" value={cfg.homeColor || '#1e3a8a'} onChange={(v) => setField({ homeColor: v })} />);
      fields.push(<ColorField key="awayColor" label="Away team color bar" value={cfg.awayColor || '#b91c1c'} onChange={(v) => setField({ awayColor: v })} />);
      fields.push(<ColorField key="panelColor" label="Row / panel background" value={cfg.panelColor || '#160f28'} onChange={(v) => setField({ panelColor: v })} allowTransparent />);
      fields.push(<ColorField key="bgColor" label="Scene background" value={cfg.bgColor || '#0a0714'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
      break;
    }
    // 2026-07-01 DEPTH PASS (docs/research/2026-06-30-swim-dive-
    // scoreboards/00-REPORT.md parts A3/A4/A8/B4/B5). Relay legs and
    // split rows are operator-typed (ListItemsEditor) — there is no
    // per-leg/per-length array field on MeetResult/ResultEntry and
    // CLAUDE.md forbids a Prisma migration for a JSON-riding stat, so
    // these follow the same "display-as-typed free-form" rule the rest
    // of this file's `mark` field already uses.
    case 'SWIM_RELAY_EXCHANGE': {
      fields.push(<GameBindField key="gameId" value={cfg.gameId || ''} onChange={(v) => setField({ gameId: v })} />);
      fields.push(<TextField key="headerText" label="Header text (blank = auto from the live event)" value={cfg.headerText || ''} placeholder="EVENT 20 — BOYS 200 MEDLEY RELAY" onChange={(v) => setField({ headerText: v })} />);
      fields.push(<TextField key="eventFilter" label="Pin to event (exact name; blank = auto-pick current heat)" value={cfg.eventFilter || ''} placeholder="" onChange={(v) => setField({ eventFilter: v })} />);
      fields.push(<TextField key="teamName" label="Relay team / school name" value={cfg.teamName || ''} placeholder="HOME RELAY A" onChange={(v) => setField({ teamName: v })} />);
      fields.push(<NumField key="laneNumber" id="sre-laneNumber" label="Lane number" value={typeof cfg.laneNumber === 'number' ? cfg.laneNumber : 3} onChange={(v) => setField({ laneNumber: v })} min={1} max={12} step={1} />);
      fields.push(<ListItemsEditor key="legs" label="Relay legs (exactly 4)" itemNoun="leg" help="Each row is one relay leg. Exchange time with a leading “-” (e.g. -0.04) auto-flags an illegal takeoff / DQ." value={cfg.legs} onChange={(v) => setField({ legs: v })} newItem={{ legName: '', swimmer: '', split: '', cumulative: '', exchange: '' }} fields={[
        { key: 'legName', label: 'Leg name', type: 'text', placeholder: 'Leg 1 — Back' },
        { key: 'swimmer', label: 'Swimmer', type: 'text', placeholder: 'D. Okafor' },
        { key: 'split', label: 'Split (this leg)', type: 'text', placeholder: '27.80' },
        { key: 'cumulative', label: 'Cumulative time', type: 'text', placeholder: '27.80' },
        { key: 'exchange', label: 'Exchange / takeoff time', type: 'text', placeholder: '0.18 (or -0.04 for a DQ)' },
      ]} />);
      fields.push(<ColorField key="headerColor" label="Header text color" value={cfg.headerColor || '#fbbf24'} onChange={(v) => setField({ headerColor: v })} />);
      fields.push(<ColorField key="textColor" label="Swimmer name color" value={cfg.textColor || '#ffffff'} onChange={(v) => setField({ textColor: v })} />);
      fields.push(<ColorField key="laneColColor" label="Lane number chip color" value={cfg.laneColColor || '#1e3a8a'} onChange={(v) => setField({ laneColColor: v })} />);
      fields.push(<ColorField key="homeColor" label="Leg label color (odd rows)" value={cfg.homeColor || '#1e3a8a'} onChange={(v) => setField({ homeColor: v })} />);
      fields.push(<ColorField key="awayColor" label="Leg label color (even rows)" value={cfg.awayColor || '#b91c1c'} onChange={(v) => setField({ awayColor: v })} />);
      fields.push(<ColorField key="panelColor" label="Row / panel background" value={cfg.panelColor || '#0c1830'} onChange={(v) => setField({ panelColor: v })} allowTransparent />);
      fields.push(<ColorField key="bgColor" label="Scene background" value={cfg.bgColor || '#050b16'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
      break;
    }
    case 'SWIM_SPLITS_PANEL': {
      fields.push(<GameBindField key="gameId" value={cfg.gameId || ''} onChange={(v) => setField({ gameId: v })} />);
      fields.push(<TextField key="headerText" label="Header text (blank = auto from the live event)" value={cfg.headerText || ''} placeholder="EVENT 12 — BOYS 100 FREESTYLE" onChange={(v) => setField({ headerText: v })} />);
      fields.push(<TextField key="eventFilter" label="Pin to event (exact name; blank = auto-pick current heat)" value={cfg.eventFilter || ''} placeholder="" onChange={(v) => setField({ eventFilter: v })} />);
      fields.push(<TextField key="swimmerName" label="Swimmer name" value={cfg.swimmerName || ''} placeholder="D. Okafor" onChange={(v) => setField({ swimmerName: v })} />);
      fields.push(<NumField key="laneNumber" id="ssp-laneNumber" label="Lane number (0 = hide)" value={typeof cfg.laneNumber === 'number' ? cfg.laneNumber : 3} onChange={(v) => setField({ laneNumber: v })} min={0} max={12} step={1} />);
      fields.push(<ToggleField key="showPaceDelta" label="Show vs.-pace delta column" value={cfg.showPaceDelta !== false} onChange={(v) => setField({ showPaceDelta: v })} />);
      fields.push(<ListItemsEditor key="splits" label="Length splits" itemNoun="length" help="Each row is one length/turn. Pace delta: a leading “-” means ahead of pace (green), “+” means behind (red)." value={cfg.splits} onChange={(v) => setField({ splits: v })} newItem={{ length: '', split: '', cumulative: '', paceDelta: '' }} fields={[
        { key: 'length', label: 'Length #', type: 'number', placeholder: '1' },
        { key: 'split', label: 'Split (this length)', type: 'text', placeholder: '25.40' },
        { key: 'cumulative', label: 'Cumulative time', type: 'text', placeholder: '25.40' },
        { key: 'paceDelta', label: 'Pace delta (optional)', type: 'text', placeholder: '-0.12' },
      ]} />);
      fields.push(<ColorField key="headerColor" label="Header text color" value={cfg.headerColor || '#fbbf24'} onChange={(v) => setField({ headerColor: v })} />);
      fields.push(<ColorField key="textColor" label="Text color" value={cfg.textColor || '#ffffff'} onChange={(v) => setField({ textColor: v })} />);
      fields.push(<ColorField key="accentColor" label="Accent color (length chips, header border)" value={cfg.accentColor || '#38bdf8'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<ColorField key="panelColor" label="Row / panel background" value={cfg.panelColor || '#0c1830'} onChange={(v) => setField({ panelColor: v })} allowTransparent />);
      fields.push(<ColorField key="bgColor" label="Scene background" value={cfg.bgColor || '#050b16'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
      break;
    }
    case 'SWIM_RECORD_LINE': {
      fields.push(<TextField key="recordType" label="Record type" value={cfg.recordType || ''} placeholder="POOL RECORD / WR / AR / NR / MEET" onChange={(v) => setField({ recordType: v })} />);
      fields.push(<TextField key="recordTime" label="Record time" value={cfg.recordTime || ''} placeholder="48.42" onChange={(v) => setField({ recordTime: v })} />);
      fields.push(<TextField key="recordHolder" label="Record holder (name, year)" value={cfg.recordHolder || ''} placeholder="D. Okafor, 2024" onChange={(v) => setField({ recordHolder: v })} />);
      fields.push(<TextField key="liveTime" label="Live/finish time (blank = hide)" value={cfg.liveTime || ''} placeholder="48.20" onChange={(v) => setField({ liveTime: v })} />);
      fields.push(<TextField key="liveDelta" label="Live pace delta (leading “-” = ahead, “+” = behind)" value={cfg.liveDelta || ''} placeholder="-0.22" onChange={(v) => setField({ liveDelta: v })} />);
      fields.push(<ToggleField key="recordBroken" label="Flash “RECORD!” (record just broken)" value={!!cfg.recordBroken} onChange={(v) => setField({ recordBroken: v })} />);
      fields.push(<ColorField key="accentColor" label="Accent color (reference state)" value={cfg.accentColor || '#fbbf24'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<ColorField key="recordBrokenColor" label="Record-broken flash color" value={cfg.recordBrokenColor || '#22c55e'} onChange={(v) => setField({ recordBrokenColor: v })} />);
      fields.push(<ColorField key="textColor" label="Text color" value={cfg.textColor || '#ffffff'} onChange={(v) => setField({ textColor: v })} />);
      fields.push(<ColorField key="panelColor" label="Bar background" value={cfg.panelColor || '#0c1830'} onChange={(v) => setField({ panelColor: v })} allowTransparent />);
      fields.push(<ColorField key="bgColor" label="Scene background (usually transparent to sit over another board)" value={cfg.bgColor || 'transparent'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
      break;
    }
    case 'DIVE_JUDGES_PANEL': {
      fields.push(<GameBindField key="gameId" value={cfg.gameId || ''} onChange={(v) => setField({ gameId: v })} />);
      fields.push(<TextField key="diverName" label="Diver name (override — live surfaces read the console's current dive)" value={cfg.diverName || ''} placeholder="A. Washington" onChange={(v) => setField({ diverName: v })} />);
      fields.push(<TextField key="diveCode" label="Dive code (override)" value={cfg.diveCode || ''} placeholder="305C" onChange={(v) => setField({ diveCode: v })} />);
      fields.push(<TextField key="diveGroup" label="Dive group / description" value={cfg.diveGroup || ''} placeholder="Reverse 1½ Somersault Tuck" onChange={(v) => setField({ diveGroup: v })} />);
      fields.push(<NumField key="dd" id="djp-dd" label="Degree of Difficulty (DD)" value={typeof cfg.dd === 'number' ? cfg.dd : 2.7} onChange={(v) => setField({ dd: v })} min={1.2} max={4.1} step={0.1} />);
      fields.push(<ListItemsEditor key="judgeScores" label="Judge scores (3, 5, or 7 rows — drop-high/low applies automatically)" itemNoun="judge" help="0-10 in half-point steps. 5 judges drop 1 high + 1 low; 7 judges drop 2 + 2; 3 judges keep all." value={(cfg.judgeScores || []).map((s: number) => ({ score: s }))} onChange={(v) => setField({ judgeScores: v.map((r) => Number(r.score) || 0) })} newItem={{ score: 7 }} fields={[
        { key: 'score', label: 'Score (0-10)', type: 'number', placeholder: '7.5' },
      ]} />);
      fields.push(<ColorField key="headerColor" label="Header text color" value={cfg.headerColor || '#fbbf24'} onChange={(v) => setField({ headerColor: v })} />);
      fields.push(<ColorField key="textColor" label="Score text color" value={cfg.textColor || '#ffffff'} onChange={(v) => setField({ textColor: v })} />);
      fields.push(<ColorField key="accentColor" label="Accent color (kept-score border, dive score)" value={cfg.accentColor || '#a78bfa'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<ColorField key="droppedColor" label="Dropped-score border color" value={cfg.droppedColor || '#4b3f66'} onChange={(v) => setField({ droppedColor: v })} />);
      fields.push(<ColorField key="panelColor" label="Panel background" value={cfg.panelColor || '#160f28'} onChange={(v) => setField({ panelColor: v })} allowTransparent />);
      fields.push(<ColorField key="bgColor" label="Scene background" value={cfg.bgColor || '#0a0714'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
      break;
    }
    // S6 #288 (2026-07-03) — Stadium Lane flagship broadcast board. Greg
    // picked all 3 stadium designs 2026-07-03; v1 "Broadcast", v2
    // "Dual-Meet Duel", and v3 "Record Chase" all ship today
    // (StadiumMeetBoardWidget.tsx header has the full live-data mapping
    // for each). Reads the SAME stats.results contract as SWIM_LANE_GRID
    // above — these fields only control presentation + the footer/record
    // slots (record fields double as v1's footer AND v3's record-chase
    // card — same config keys, same "config-or-omit" rule) that have no
    // home anywhere in the data model.
    case 'STADIUM_MEET_BOARD': {
      fields.push(<GameBindField key="gameId" value={cfg.gameId || ''} onChange={(v) => setField({ gameId: v })} />);
      fields.push(<SelectField key="boardStyle" label="Design" value={String(cfg.boardStyle || 'broadcast')} options={[['broadcast', 'v1 — Broadcast (live)'], ['duel', 'v2 — Dual-Meet Duel (live)'], ['chase', 'v3 — Record Chase (live)']]} onChange={(v) => setField({ boardStyle: v })} />);
      fields.push(<TextField key="headerText" label="Header text (blank = auto from the live event)" value={cfg.headerText || ''} placeholder="GIRLS 100M FREESTYLE — EVENT 12 — FINALS" onChange={(v) => setField({ headerText: v })} />);
      fields.push(<TextField key="eventFilter" label="Pin to event (exact name; blank = auto-pick current heat)" value={cfg.eventFilter || ''} placeholder="" onChange={(v) => setField({ eventFilter: v })} />);
      fields.push(<TextField key="heatLabel" label="Heat pill (e.g. “3/4”; blank = hide)" value={cfg.heatLabel ?? ''} placeholder="3/4" onChange={(v) => setField({ heatLabel: v })} />);
      fields.push(<TextField key="timeLabel" label="Time pill (e.g. “7:42 PM”; blank = hide)" value={cfg.timeLabel ?? ''} placeholder="7:42 PM" onChange={(v) => setField({ timeLabel: v })} />);
      fields.push(<NumField key="laneCount" id="smb-laneCount" label="Number of lanes" value={typeof cfg.laneCount === 'number' ? cfg.laneCount : 8} onChange={(v) => setField({ laneCount: v })} min={1} max={12} step={1} />);
      fields.push(<ListItemsEditor key="dqReasons" label="DQ reasons (by lane number)" itemNoun="DQ reason" help="Shown as “DQ — <reason>” next to that lane's time. Blank reason renders just “DQ”." value={Object.entries((cfg.dqReasons || {}) as Record<string, string>).map(([lane, reason]) => ({ lane, reason }))} onChange={(v) => setField({ dqReasons: Object.fromEntries(v.filter((r) => r.lane).map((r) => [String(r.lane), String(r.reason || '')])) })} newItem={{ lane: '', reason: '' }} fields={[
        { key: 'lane', label: 'Lane #', type: 'number', placeholder: '7' },
        { key: 'reason', label: 'Reason', type: 'text', placeholder: 'False start' },
      ]} />);
      // Pool-record footer — NO field exists anywhere in the data model
      // for this (config-or-omit: all 4 blank cleanly omits the record
      // half of the footer bar, never a fabricated sample on a real board).
      fields.push(<TextField key="recordLabel" label="Record label (e.g. “POOL RECORD”; blank omits the record chase)" value={cfg.recordLabel || ''} placeholder="POOL RECORD" onChange={(v) => setField({ recordLabel: v })} />);
      fields.push(<TextField key="recordValue" label="Record time" value={cfg.recordValue || ''} placeholder="50.84" onChange={(v) => setField({ recordValue: v })} />);
      fields.push(<TextField key="recordHolder" label="Record holder + year" value={cfg.recordHolder || ''} placeholder="A. Washington 2024" onChange={(v) => setField({ recordHolder: v })} />);
      fields.push(<TextField key="recordDelta" label="Off-the-pace note (optional)" value={cfg.recordDelta || ''} placeholder="1.06 off the pace" onChange={(v) => setField({ recordDelta: v })} />);
      // Sponsor slot — same "no field in the data model" rule; both blank
      // omits the sponsor half of the footer bar.
      fields.push(<TextField key="sponsorLabel" label="Sponsor eyebrow (e.g. “PRESENTED BY”; blank omits the sponsor slot)" value={cfg.sponsorLabel || ''} placeholder="PRESENTED BY" onChange={(v) => setField({ sponsorLabel: v })} />);
      fields.push(<TextField key="sponsorName" label="Sponsor name" value={cfg.sponsorName || ''} placeholder="River Dental" onChange={(v) => setField({ sponsorName: v })} />);
      fields.push(<ColorField key="bgColor" label="Scene background" value={cfg.bgColor || '#060a14'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
      break;
    }
    case 'FITNESS_AD_BANNER': {
      // Rotating gym promo creative. Each creative is { headline, sub,
      // ctaText, ctaUrl?, durationMs? }; we render a small array editor.
      fields.push(<SettingNumber key="rotationMs" label="Rotate every (seconds)" value={String((cfg.rotationMs || 8000) / 1000)} min={2} max={300} onChange={(v) => setField({ rotationMs: Math.round((parseFloat(v) || 8.0) * 1000) })} />);
      fields.push(<ColorPickerField key="accentColor" label="Accent color (AD chip + progress)" value={cfg.accentColor || '#fbbf24'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<ToggleField key="showAdBadge" label='Show "AD" disclosure chip' value={cfg.showAdBadge !== false} onChange={(v) => setField({ showAdBadge: v })} />);
      fields.push(<ToggleField key="enableImpressionLogging" label="Log impressions to /ads/impressions" value={cfg.enableImpressionLogging !== false} onChange={(v) => setField({ enableImpressionLogging: v })} />);
      {/* Each creative carries a stable `id` used as the widget's React
          key (FitnessAdBannerWidget keys its slide map on cre.id), so we
          mint a fresh id per added row via makeNewItem — a static newItem
          would clone the same id into every creative. Field shapes match
          FitnessAdCreative (imageUrl / videoUrl / advertiser / headline). */}
      fields.push(<ListItemsEditor key="creatives" label="Creatives" itemNoun="creative" help="Each creative is one ad in the rotation. Upload an image or paste a video URL." value={cfg.creatives} onChange={(v) => setField({ creatives: v })} makeNewItem={() => ({ id: `cr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, imageUrl: '', videoUrl: '', advertiser: '', headline: '' })} fields={[
        { key: 'imageUrl', label: 'Image', type: 'image' },
        { key: 'videoUrl', label: 'Video URL (takes precedence over image)', type: 'text', placeholder: 'https://example.com/spot.mp4' },
        { key: 'advertiser', label: 'Advertiser name', type: 'text', placeholder: 'Your Brand' },
        { key: 'headline', label: 'Headline (shown when no image/video)', type: 'text', placeholder: 'New Member Special · 50% off' },
      ]} />);
      break;
    }
    case 'FITNESS_APP_LIBRARY': {
      // Live "STREAMING LIBRARY" hub — pulls connected channels from
      // /streaming/channels at render time and overrides catalog tiles
      // with green ON-AIR pills. Editor controls the visual chrome.
      fields.push(<TextField key="title" label="Header title" value={cfg.title || ''} placeholder="STREAMING LIBRARY" onChange={(v) => setField({ title: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Header accent color" value={cfg.accentColor || '#00d4ff'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<SelectField key="stickStatus" label="Stick connection pill" value={cfg.stickStatus || 'unknown'} options={[['online','Online'],['offline','Offline'],['unknown','Unknown']]} onChange={(v) => setField({ stickStatus: v })} />);
      fields.push(<TextField key="stickCount" label="Sticks online (display only)" value={String(cfg.stickCount ?? 0)} placeholder="1" onChange={(v) => setField({ stickCount: parseInt(v) || 0 })} />);
      break;
    }
    case 'FITNESS_CLASS_SCHEDULE': {
      // Today's classes table. classes[] = { time, name, instructor, room?, durationMin?, status? }
      fields.push(<TextField key="title" label="Header title" value={cfg.title || ''} placeholder="TODAY'S CLASSES" onChange={(v) => setField({ title: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Accent color" value={cfg.accentColor || '#00d4ff'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<TextField key="maxRows" label="Max rows shown" value={String(cfg.maxRows || 6)} placeholder="6" onChange={(v) => setField({ maxRows: parseInt(v) || 6 })} />);
      fields.push(<ToggleField key="highlightNextClass" label="Highlight next upcoming class" value={cfg.highlightNextClass !== false} onChange={(v) => setField({ highlightNextClass: v })} />);
      fields.push(<ToggleField key="showPastClasses" label="Show past classes (dimmed)" value={!!cfg.showPastClasses} onChange={(v) => setField({ showPastClasses: v })} />);
      fields.push(<ListItemsEditor key="classes" label="Classes" itemNoun="class" help="Each row is one class on today's schedule." value={cfg.classes} onChange={(v) => setField({ classes: v })} newItem={{ time: '', name: '', instructor: '', studio: '', intensity: '', durationMin: '' }} fields={[
        { key: 'time', label: 'Time', type: 'text', placeholder: '7:00 AM' },
        { key: 'name', label: 'Class name', type: 'text', placeholder: 'Power Yoga' },
        { key: 'instructor', label: 'Instructor', type: 'text', placeholder: 'Jordan' },
        { key: 'studio', label: 'Studio / room', type: 'text', placeholder: 'Studio A' },
        { key: 'intensity', label: 'Intensity', type: 'select', options: [['', '—'], ['easy', 'Easy'], ['moderate', 'Moderate'], ['hard', 'Hard']] },
        { key: 'durationMin', label: 'Duration (min)', type: 'number', placeholder: '45' },
      ]} />);
      break;
    }
    case 'FITNESS_MOTIVATIONAL_QUOTE': {
      // Rotating quote card. quotes[] = { text, author? }
      // AI-assist appends 3 fresh quotes onto whatever is already there
      // — operator picks one, modal closes, JSON updates. Tone-aware.
      fields.push(
        <div key="ai-quote" className="rounded-lg bg-gradient-to-br from-violet-50 to-fuchsia-50 border border-violet-200 px-3 py-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-slate-700 font-medium">Need fresh quotes? Claude writes 3 options.</span>
          <AiGenerateButton
            intent="quote"
            onPick={(text) => {
              const existing = Array.isArray(cfg.quotes) ? cfg.quotes : [];
              setField({ quotes: [...existing, { text }] });
            }}
            buttonClassName="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-violet-600 hover:bg-violet-700 px-2.5 py-1 rounded shadow-sm"
            buttonLabel="+ Generate"
          />
        </div>
      );
      fields.push(<SettingNumber key="rotationMs" label="Rotate every (seconds)" value={String((cfg.rotationMs || 12000) / 1000)} min={2} max={300} onChange={(v) => setField({ rotationMs: Math.round((parseFloat(v) || 12.0) * 1000) })} />);
      fields.push(<ColorPickerField key="accentColor" label="Accent color" value={cfg.accentColor || '#39ff14'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<ToggleField key="showAuthor" label="Show author name" value={cfg.showAuthor !== false} onChange={(v) => setField({ showAuthor: v })} />);
      fields.push(<SelectField key="transitionStyle" label="Transition" value={cfg.transitionStyle || 'crossfade'} options={[['crossfade','Crossfade'],['typewriter','Typewriter'],['slide','Slide']]} onChange={(v) => setField({ transitionStyle: v })} />);
      fields.push(<SelectField key="align" label="Text alignment" value={cfg.align || 'center'} options={[['center','Center'],['left','Left']]} onChange={(v) => setField({ align: v })} />);
      fields.push(<SelectField key="bgStyle" label="Background style" value={cfg.bgStyle || 'gradient'} options={[['solid','Solid color'],['gradient','Gradient'],['photo-overlay','Photo with overlay']]} onChange={(v) => setField({ bgStyle: v })} />);
      fields.push(<ListItemsEditor key="quotes" label="Quotes" itemNoun="quote" help="Each row is one quote in the rotation. The AI button above appends here too." value={cfg.quotes} onChange={(v) => setField({ quotes: v })} newItem={{ text: '', author: '' }} fields={[
        { key: 'text', label: 'Quote', type: 'textarea', placeholder: 'The only bad workout is the one that didn’t happen.' },
        { key: 'author', label: 'Author', type: 'text', placeholder: 'Unknown' },
      ]} />);
      break;
    }
    case 'FITNESS_MUSIC_PLAYER': {
      // Now-playing card. Either static (operator types track + artist)
      // or dynamic (provider polls a now-playing endpoint).
      fields.push(<SelectField key="provider" label="Music provider" value={cfg.provider || 'demo'} options={[['demo','Demo (placeholder)'],['spotify','Spotify Connect'],['apple_music','Apple Music'],['pandora_business','Pandora for Business'],['soundmachine','SoundMachine'],['custom','Custom endpoint']]} onChange={(v) => setField({ provider: v })} />);
      fields.push(<TextField key="zoneLabel" label="Zone label (e.g. CARDIO FLOOR)" value={cfg.zoneLabel || ''} placeholder="CARDIO FLOOR" onChange={(v) => setField({ zoneLabel: v })} />);
      fields.push(<TextField key="trackTitle" label="Track title (override)" value={cfg.trackTitle || ''} placeholder="Titanium" onChange={(v) => setField({ trackTitle: v })} />);
      fields.push(<TextField key="artist" label="Artist (override)" value={cfg.artist || ''} placeholder="David Guetta ft. Sia" onChange={(v) => setField({ artist: v })} />);
      fields.push(<TextField key="album" label="Album" value={cfg.album || ''} placeholder="Nothing but the Beat" onChange={(v) => setField({ album: v })} />);
      fields.push(<AssetPickerField key="albumArtUrl" label="Album art" value={cfg.albumArtUrl || ''} kind="image" onChange={(v) => setField({ albumArtUrl: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Accent color" value={cfg.accentColor || '#39ff14'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<TextField key="durationSeconds" label="Track duration (seconds, for progress bar)" value={String(cfg.durationSeconds || 240)} placeholder="240" onChange={(v) => setField({ durationSeconds: parseInt(v) || 240 })} />);
      fields.push(<TextField key="nowPlayingEndpoint" label="Now-playing API URL (optional, for live data)" value={cfg.nowPlayingEndpoint || ''} placeholder="https://api.example.com/now-playing" onChange={(v) => setField({ nowPlayingEndpoint: v })} />);
      break;
    }
    case 'FITNESS_STICK_LAUNCHER': {
      // Hardware-companion launcher. Operator picks a target streaming
      // service (catalog id from fitnessSourceCatalog) + the registered
      // stick id; the kiosk-side player controls the stick over LAN.
      fields.push(<TextField key="sourceId" label="Streaming service id (e.g. netflix, hulu, peacock)" value={cfg.sourceId || ''} placeholder="netflix" onChange={(v) => setField({ sourceId: v })} />);
      fields.push(<TextField key="stickName" label="Stick display name" value={cfg.stickName || ''} placeholder="Lobby TV Roku" onChange={(v) => setField({ stickName: v })} />);
      fields.push(<SelectField key="stickType" label="Hardware type" value={cfg.stickType || 'roku'} options={[['roku','Roku'],['fire-tv','Fire TV'],['apple-tv','Apple TV'],['chromecast','Chromecast'],['android-tv','Android TV']]} onChange={(v) => setField({ stickType: v })} />);
      fields.push(<TextField key="stickIp" label="Stick LAN IP (for diagnostics)" value={cfg.stickIp || ''} placeholder="10.0.0.42" onChange={(v) => setField({ stickIp: v })} />);
      fields.push(<TextField key="stickId" label="Stick registry id (optional)" value={cfg.stickId || ''} placeholder="stick_12345" onChange={(v) => setField({ stickId: v })} />);
      fields.push(<SelectField key="displayState" label="Force display state" value={cfg.displayState || ''} options={[['','(Auto from live status)'],['launching','Launching…'],['ready','Ready'],['offline','Offline']]} onChange={(v) => setField({ displayState: v || undefined })} />);
      fields.push(<ToggleField key="showTechDetails" label="Show IP / hardware badge" value={cfg.showTechDetails !== false} onChange={(v) => setField({ showTechDetails: v })} />);
      break;
    }
    case 'FITNESS_TRAINING_VIDEO': {
      // Equipment tutorial loop. Plays muted + looped.
      fields.push(<AssetPickerField key="videoUrl" label="Tutorial video (.mp4)" value={cfg.videoUrl || ''} kind="video" onChange={(v) => setField({ videoUrl: v })} />);
      fields.push(<AssetPickerField key="posterUrl" label="Poster image (shown before play)" value={cfg.posterUrl || ''} kind="image" onChange={(v) => setField({ posterUrl: v })} />);
      fields.push(<TextField key="equipmentName" label="Equipment name" value={cfg.equipmentName || ''} placeholder="LEG PRESS" onChange={(v) => setField({ equipmentName: v })} />);
      fields.push(<TextField key="equipmentCategory" label="Category chip" value={cfg.equipmentCategory || ''} placeholder="STRENGTH" onChange={(v) => setField({ equipmentCategory: v })} />);
      fields.push(<TextField key="trainerName" label="Trainer credit" value={cfg.trainerName || ''} placeholder="Coach Maya" onChange={(v) => setField({ trainerName: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Accent color" value={cfg.accentColor || '#39ff14'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<ToggleField key="showControls" label="Show video controls (play/pause/seek)" value={!!cfg.showControls} onChange={(v) => setField({ showControls: v })} />);
      fields.push(<TextAreaField key="safetyTipsText" label="Safety tips (one per line)" value={Array.isArray(cfg.safetyTips) ? cfg.safetyTips.join('\n') : (cfg.safetyTipsText || '')} rows={4} onChange={(v) => setField({ safetyTips: v.split('\n').filter((line: string) => line.trim()), safetyTipsText: v })} />);
      break;
    }
    case 'FITNESS_WORKOUT_TIMER': {
      // editor-BUG-001 fix: HIIT / Tabata / interval timer was rendered
      // + had presets but fell through to JSON-only Advanced. Surface the
      // full FitnessWorkoutTimerConfig as a real form so the operator
      // can pick a preset (Tabata = 20/10x8, HIIT = 40/20x8, EMOM, AMRAP,
      // custom), tweak the work/rest seconds, set rounds, accent colors,
      // and class metadata.
      fields.push(<TextField key="classTitle" label="Class title" value={cfg.classTitle || ''} placeholder="HIIT BURN" onChange={(v) => setField({ classTitle: v })} />);
      fields.push(<TextField key="trainerName" label="Trainer name (optional)" value={cfg.trainerName || ''} placeholder="Coach Maya" onChange={(v) => setField({ trainerName: v })} />);
      fields.push(<SelectField key="mode" label="Interval preset" value={cfg.mode || 'hiit'} options={[['tabata','Tabata (20/10 × 8)'],['hiit','HIIT (40/20 × 8)'],['emom','EMOM (60s rounds)'],['amrap','AMRAP (work-only)'],['custom','Custom']]} onChange={(v) => {
        // Apply preset defaults so flipping mode sets sensible work/rest/rounds.
        if (v === 'tabata') setField({ mode: v, workSeconds: 20, restSeconds: 10, totalRounds: 8 });
        else if (v === 'hiit') setField({ mode: v, workSeconds: 40, restSeconds: 20, totalRounds: 8 });
        else if (v === 'emom') setField({ mode: v, workSeconds: 60, restSeconds: 0, totalRounds: 10 });
        else if (v === 'amrap') setField({ mode: v, workSeconds: 600, restSeconds: 0, totalRounds: 1 });
        else setField({ mode: v });
      }} />);
      fields.push(<TextField key="workSeconds" label="Work (seconds)" value={String(cfg.workSeconds ?? 40)} placeholder="40" onChange={(v) => setField({ workSeconds: parseInt(v) || 40 })} />);
      fields.push(<TextField key="restSeconds" label="Rest (seconds)" value={String(cfg.restSeconds ?? 20)} placeholder="20" onChange={(v) => setField({ restSeconds: parseInt(v) || 20 })} />);
      fields.push(<TextField key="totalRounds" label="Total rounds" value={String(cfg.totalRounds ?? 8)} placeholder="8" onChange={(v) => setField({ totalRounds: parseInt(v) || 8 })} />);
      fields.push(<TextField key="currentRound" label="Starting round (1-indexed)" value={String(cfg.currentRound ?? 1)} placeholder="1" onChange={(v) => setField({ currentRound: parseInt(v) || 1 })} />);
      fields.push(<ColorPickerField key="workColor" label="Work-phase color" value={cfg.workColor || '#ff2a4d'} onChange={(v) => setField({ workColor: v })} />);
      fields.push(<ColorPickerField key="restColor" label="Rest-phase color" value={cfg.restColor || '#39ff14'} onChange={(v) => setField({ restColor: v })} />);
      fields.push(<ToggleField key="autoStart" label="Auto-start when widget mounts (live mode)" value={!!cfg.autoStart} onChange={(v) => setField({ autoStart: v })} />);
      fields.push(<ToggleField key="audioCues" label="Audio cues on phase transitions" value={cfg.audioCues !== false} onChange={(v) => setField({ audioCues: v })} />);
      break;
    }
    // ─── Sprint 8d follow-up — POS-driven menu boards ──────────────
    // The four widgets that read PosMenuItem live data: restaurant
    // menu board, bar tap list, bar cocktail menu, retail product grid.
    // All take an optional categoryId — empty means "show every item
    // across every category." When a category is picked, the widget
    // filters PosMenuItem by category at render time.
    case 'RESTAURANT_MENU_BOARD': {
      // Widget reads `posSync` + `posCategory` (see MenuBoardWidget.tsx
      // line 110). When posSync is on it ignores config.items and pulls
      // live PosMenuItem rows from /api/v1/pos/items?category=X. When
      // posSync is OFF the operator MUST be able to edit items[] — this
      // is the operator's primary complaint about restaurant templates:
      // "you can't edit a single word." The items[] JSON editor below
      // surfaces the array shape MenuBoardWidget actually reads
      // (name / desc / price / dietary / emoji).
      fields.push(<TextField key="title" label="Board title" value={cfg.title || ''} placeholder="Menu" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="subtitle" label="Subtitle" value={cfg.subtitle || ''} placeholder="made fresh daily" onChange={(v) => setField({ subtitle: v })} />);
      fields.push(<ToggleField key="posSync" label="Pull live items from connected POS" value={!!cfg.posSync} onChange={(v) => setField({ posSync: v })} />);
      if (cfg.posSync) {
        fields.push(<PosCategoryPickerField key="posCategory" label="Category (optional — leave blank for all)" value={cfg.posCategory || ''} onChange={(v) => setField({ posCategory: v || undefined })} />);
        fields.push(<TextField key="maxItems" label="Max items to show" value={String(cfg.maxItems || 12)} placeholder="12" onChange={(v) => setField({ maxItems: parseInt(v) || 12 })} />);
      } else {
        // Manual editor: each menu item as a separate row. Operators
        // shouldn't need to hand-edit JSON to update a price.
        fields.push(<ColorPickerField key="accentColor" label="Accent color" value={cfg.accentColor || '#e8b94a'} onChange={(v) => setField({ accentColor: v })} />);
        fields.push(<ListItemsEditor key="items" label="Menu items" itemNoun="item" help="Each row is one dish. Edit the name, price, and description right here — no code." value={cfg.items} onChange={(v) => setField({ items: v })} newItem={{ name: 'New item', price: '$0.00', desc: '', emoji: '', dietary: '' }} fields={[
          { key: 'name', label: 'Name', type: 'text', placeholder: 'Classic Burger' },
          { key: 'price', label: 'Price', type: 'price', placeholder: '$8.50' },
          { key: 'desc', label: 'Description', type: 'textarea', placeholder: 'Aged cheddar, house sauce, brioche bun' },
          { key: 'emoji', label: 'Photo / emoji', type: 'image' },
          { key: 'dietary', label: 'Dietary tags', type: 'text', placeholder: 'GF, V' },
        ]} />);
      }
      fields.push(<TextField key="columns" label="Columns (1–5)" value={String(cfg.columns || 3)} placeholder="3" onChange={(v) => setField({ columns: parseInt(v) || 3 })} />);
      fields.push(<SelectField key="theme" label="Color theme" value={cfg.theme || 'cream'} options={[['cream','Cream'],['charcoal','Charcoal'],['red','Red']]} onChange={(v) => setField({ theme: v })} />);
      break;
    }
    case 'BAR_TAP_LIST': {
      // 2026-05-03 BUG FIX (cycle 4 editor-BUG-extend-bar) — minimal
      // case had no editor for taps[]/subtitle/accentColor; with
      // posSync OFF the operator literally could not edit the menu.
      // Added subtitle, accentColor, taps[] JSON editor (safe-parse
      // pattern from cycle-2 editor-BUG-003). Field shapes confirmed
      // against TapListConfig in apps/web/src/components/widgets/bar/
      // TapListWidget.tsx.
      fields.push(<TextField key="title" label="Tap list title" value={cfg.title || ''} placeholder="On Tap" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="subtitle" label="Subtitle" value={cfg.subtitle || ''} placeholder="16 LOCAL CRAFT" onChange={(v) => setField({ subtitle: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Accent color (neon edge / handle ring)" value={cfg.accentColor || '#f59e0b'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<ToggleField key="posSync" label="Pull live taps from connected POS" value={!!cfg.posSync} onChange={(v) => setField({ posSync: v })} />);
      if (cfg.posSync) {
        fields.push(<PosCategoryPickerField key="posCategory" label="Tap category (optional)" value={cfg.posCategory || ''} onChange={(v) => setField({ posCategory: v || undefined })} />);
      }
      fields.push(<TextField key="columns" label="Columns (1-3)" value={String(cfg.columns || 2)} placeholder="2" onChange={(v) => setField({ columns: parseInt(v) || 2 })} />);
      if (!cfg.posSync) {
        fields.push(<ListItemsEditor key="taps" label="Taps" itemNoun="tap" help="Each row is one beer on tap." value={cfg.taps} onChange={(v) => setField({ taps: v })} newItem={{ name: 'New Pour', brewery: '', style: '', abv: '', ibu: '', price: '$7', color: '#f59e0b', isNew: false }} fields={[
          { key: 'name', label: 'Beer name', type: 'text', placeholder: 'Hazy IPA' },
          { key: 'brewery', label: 'Brewery', type: 'text', placeholder: 'Local Craft Co.' },
          { key: 'style', label: 'Style', type: 'text', placeholder: 'New England IPA' },
          { key: 'abv', label: 'ABV', type: 'text', placeholder: '6.8%' },
          { key: 'ibu', label: 'IBU', type: 'text', placeholder: '45' },
          { key: 'price', label: 'Price', type: 'price', placeholder: '$7' },
          { key: 'color', label: 'Handle color', type: 'color' },
          { key: 'isNew', label: 'Show "NEW" badge', type: 'toggle' },
        ]} />);
      }
      break;
    }
    case 'BAR_COCKTAIL_MENU': {
      // 2026-05-03 BUG FIX (cycle 4 editor-BUG-extend-bar) — same as
      // BAR_TAP_LIST: with posSync OFF the operator had no UI for
      // cocktails[]. Added subtitle, footer, columns, cocktails[] JSON
      // editor. Field shapes confirmed against CocktailMenuConfig in
      // apps/web/src/components/widgets/bar/CocktailMenuWidget.tsx.
      fields.push(<TextField key="title" label="Cocktail menu title" value={cfg.title || ''} placeholder="Signature Cocktails" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="subtitle" label="Subtitle" value={cfg.subtitle || ''} placeholder="House & Classics" onChange={(v) => setField({ subtitle: v })} />);
      fields.push(<TextField key="footer" label="Footer flourish" value={cfg.footer || ''} placeholder="Ask your bartender." onChange={(v) => setField({ footer: v })} />);
      fields.push(<ToggleField key="posSync" label="Pull live cocktails from connected POS" value={!!cfg.posSync} onChange={(v) => setField({ posSync: v })} />);
      if (cfg.posSync) {
        fields.push(<PosCategoryPickerField key="posCategory" label="Cocktail category (optional)" value={cfg.posCategory || ''} onChange={(v) => setField({ posCategory: v || undefined })} />);
      }
      fields.push(<TextField key="columns" label="Columns (1-2)" value={String(cfg.columns || 2)} placeholder="2" onChange={(v) => setField({ columns: parseInt(v) || 2 })} />);
      if (!cfg.posSync) {
        fields.push(<ListItemsEditor key="cocktails" label="Cocktails" itemNoun="cocktail" help="Each row is one cocktail." value={cfg.cocktails} onChange={(v) => setField({ cocktails: v })} newItem={{ name: 'New Cocktail', ingredients: '', note: '', price: '$12', garnish: '', featured: false }} fields={[
          { key: 'name', label: 'Name', type: 'text', placeholder: 'Old Fashioned' },
          { key: 'ingredients', label: 'Ingredients', type: 'textarea', placeholder: 'Bourbon, bitters, sugar, orange' },
          { key: 'note', label: 'Note', type: 'text', placeholder: 'House favorite' },
          { key: 'price', label: 'Price', type: 'price', placeholder: '$12' },
          { key: 'garnish', label: 'Garnish', type: 'text', placeholder: 'Orange peel' },
          { key: 'featured', label: 'Feature this cocktail', type: 'toggle' },
        ]} />);
      }
      break;
    }
    case 'RETAIL_PRODUCT_GRID': {
      // 2026-05-25 audit — gap fix: previously only title/posSync/
      // columns/showSaleBadges were exposed. The widget actually
      // reads heading/subheading/products[]/bgColor/inkColor/accentColor.
      // Without these the manual-mode operator can't edit the grid.
      fields.push(<TextField key="heading" label="Heading" value={cfg.heading || cfg.title || ''} placeholder="New Arrivals" onChange={(v) => setField({ heading: v, title: v })} />);
      fields.push(<TextField key="subheading" label="Subheading / tagline" value={cfg.subheading || ''} placeholder="Spring drop · while supplies last" onChange={(v) => setField({ subheading: v })} />);
      fields.push(<ToggleField key="posSync" label="Pull live products from connected POS" value={!!cfg.posSync} onChange={(v) => setField({ posSync: v })} />);
      if (cfg.posSync) {
        fields.push(<PosCategoryPickerField key="posCategory" label="Department / category (optional)" value={cfg.posCategory || ''} onChange={(v) => setField({ posCategory: v || undefined })} />);
      } else {
        fields.push(<ListItemsEditor key="products" label="Products" itemNoun="product" help="Each row is one product. Set the price, sale price, and photo right here." value={cfg.products} onChange={(v) => setField({ products: v })} newItem={{ name: 'New Product', price: '$0', salePrice: '', imageUrl: '', emoji: '', swatchColor: '', badge: '', category: '' }} fields={[
          { key: 'name', label: 'Product name', type: 'text', placeholder: 'Wool Runner' },
          { key: 'price', label: 'Price', type: 'price', placeholder: '$98' },
          { key: 'salePrice', label: 'Sale price (optional)', type: 'price', placeholder: '$69' },
          { key: 'imageUrl', label: 'Product photo', type: 'image' },
          { key: 'swatchColor', label: 'Swatch color', type: 'color' },
          { key: 'badge', label: 'Badge', type: 'text', placeholder: 'NEW / BESTSELLER' },
          { key: 'category', label: 'Category', type: 'text', placeholder: 'Footwear' },
        ]} />);
      }
      fields.push(<TextField key="columns" label="Columns" value={String(cfg.columns || 4)} placeholder="4" onChange={(v) => setField({ columns: parseInt(v) || 4 })} />);
      fields.push(<ToggleField key="showSaleBadges" label="Show sale badges" value={cfg.showSaleBadges !== false} onChange={(v) => setField({ showSaleBadges: v })} />);
      fields.push(<ColorPickerField key="bgColor" label="Background color" value={cfg.bgColor || '#faf6f1'} onChange={(v) => setField({ bgColor: v })} />);
      fields.push(<ColorPickerField key="inkColor" label="Headline + body ink" value={cfg.inkColor || '#1a1411'} onChange={(v) => setField({ inkColor: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Sale badge + price accent" value={cfg.accentColor || '#9a2d2d'} onChange={(v) => setField({ accentColor: v })} />);
      break;
    }
    // editor-BUG-004 fix (cycle 3) — explicit cases for the 6 RETAIL
    // widgets that fell through to JSON-only Advanced after editor-BUG-002.
    // Same pattern as the RESTAURANT_/BAR_ cases — TextField / SelectField /
    // ToggleField / ColorPickerField / AssetPickerField, plus TextAreaField
    // with safe JSON parse for array editors (slides / hours / departments).
    case 'RETAIL_LOOKBOOK_CAROUSEL': {
      fields.push(<SettingNumber key="rotationMs" label="Rotate every (seconds)" value={String((cfg.rotationMs ?? 6000) / 1000)} min={2} max={300} onChange={(v) => setField({ rotationMs: Math.round((parseFloat(v) || 6.0) * 1000) })} />);
      fields.push(<TextField key="fadeMs" label="Crossfade duration (ms)" value={String(cfg.fadeMs ?? 800)} placeholder="800" onChange={(v) => setField({ fadeMs: parseInt(v) || 800 })} />);
      fields.push(<ColorPickerField key="inkColor" label="Caption ink color" value={cfg.inkColor || '#ffffff'} onChange={(v) => setField({ inkColor: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Eyebrow + price accent" value={cfg.accentColor || '#e8c87a'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<ListItemsEditor key="slides" label="Slides" itemNoun="slide" help="Each slide is one editorial frame in the carousel." value={cfg.slides} onChange={(v) => setField({ slides: v })} newItem={{ eyebrow: '', headline: '', subhead: '', price: '', imageUrl: '', swatchColor: '', emoji: '' }} fields={[
        { key: 'eyebrow', label: 'Eyebrow', type: 'text', placeholder: 'SS26 · NEW IN' },
        { key: 'headline', label: 'Headline', type: 'text', placeholder: 'The Linen Edit' },
        { key: 'subhead', label: 'Subhead', type: 'text', placeholder: 'Effortless silhouettes for warmer days.' },
        { key: 'price', label: 'Price', type: 'price', placeholder: 'from $98' },
        { key: 'imageUrl', label: 'Hero image', type: 'image' },
        { key: 'swatchColor', label: 'Swatch color (fallback)', type: 'color' },
        { key: 'emoji', label: 'Emoji (fallback)', type: 'text', placeholder: '👗' },
      ]} />);
      break;
    }
    case 'RETAIL_STOREFRONT_HOURS': {
      fields.push(<TextField key="eyebrow" label="Eyebrow line" value={cfg.eyebrow || ''} placeholder="EST. 1998 · MAIN STREET" onChange={(v) => setField({ eyebrow: v })} />);
      fields.push(<TextField key="headline" label="Headline / store name" value={cfg.headline || ''} placeholder="Welcome." onChange={(v) => setField({ headline: v })} />);
      fields.push(<TextField key="subhead" label="Subhead" value={cfg.subhead || ''} placeholder="Step inside · A new season is here." onChange={(v) => setField({ subhead: v })} />);
      fields.push(<SelectField key="statusOverride" label="Open / closed pill" value={cfg.statusOverride || 'auto'} options={[['auto','Auto-detect from hours'],['open','Force OPEN NOW'],['closed','Force CLOSED']]} onChange={(v) => setField({ statusOverride: v })} />);
      fields.push(<ColorPickerField key="bgColor" label="Background color" value={cfg.bgColor || '#faf6f1'} onChange={(v) => setField({ bgColor: v })} />);
      fields.push(<ColorPickerField key="inkColor" label="Body ink color" value={cfg.inkColor || '#1a1411'} onChange={(v) => setField({ inkColor: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Headline + open pill accent" value={cfg.accentColor || '#9a2d2d'} onChange={(v) => setField({ accentColor: v })} />);
      // G4 (§19) — replaced the openHoursJson TextArea with a 7-row
      // day → hours editor. The widget's shape is
      // `Partial<Record<'sun'|…|'sat', string>>` where each value is a
      // single free-form string ('10am – 9pm' / 'Closed') — NOT an
      // {open,close} pair (verified against RetailStorefrontHoursWidget.tsx
      // `openHours?: Partial<Record<DayKey, string>>`). DayHoursField
      // accepts a legacy JSON string too, so presets that still carry the
      // old string blob keep working.
      fields.push(<DayHoursField key="openHours" label="Open hours" value={cfg.openHours} onChange={(v) => setField({ openHours: v })} />);
      break;
    }
    case 'RETAIL_PRICE_CALLOUT': {
      fields.push(<TextField key="eyebrow" label="Eyebrow above headline" value={cfg.eyebrow || ''} placeholder="FEATURED · END-CAP DEAL" onChange={(v) => setField({ eyebrow: v })} />);
      fields.push(<TextField key="headline" label="Headline / product name" value={cfg.headline || ''} placeholder="Cashmere Crewneck" onChange={(v) => setField({ headline: v })} />);
      fields.push(<TextField key="subhead" label="Subhead" value={cfg.subhead || ''} placeholder="A wardrobe staple, retailored." onChange={(v) => setField({ subhead: v })} />);
      fields.push(<TextField key="salePrice" label="Sale price (big)" value={cfg.salePrice || ''} placeholder="$49" onChange={(v) => setField({ salePrice: v })} />);
      fields.push(<TextField key="originalPrice" label="Original price (struck)" value={cfg.originalPrice || ''} placeholder="$79" onChange={(v) => setField({ originalPrice: v })} />);
      fields.push(<TextField key="discountLabel" label="Discount label override (auto if blank)" value={cfg.discountLabel || ''} placeholder="SAVE 38%" onChange={(v) => setField({ discountLabel: v })} />);
      fields.push(<AssetPickerField key="imageUrl" label="Product image" value={cfg.imageUrl || ''} kind="image" onChange={(v) => setField({ imageUrl: v })} />);
      fields.push(<TextField key="emoji" label="Emoji fallback when no image" value={cfg.emoji || ''} placeholder="coat" onChange={(v) => setField({ emoji: v })} />);
      fields.push(<ColorPickerField key="swatchColor" label="Emoji panel swatch color" value={cfg.swatchColor || '#dccfb8'} onChange={(v) => setField({ swatchColor: v })} />);
      fields.push(<ColorPickerField key="bgColor" label="Background color" value={cfg.bgColor || '#faf6f1'} onChange={(v) => setField({ bgColor: v })} />);
      fields.push(<ColorPickerField key="inkColor" label="Body ink color" value={cfg.inkColor || '#1a1411'} onChange={(v) => setField({ inkColor: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Price + starburst accent" value={cfg.accentColor || '#9a2d2d'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<StringListEditor key="sellingPoints" label="Selling points" itemNoun="point" maxItems={3} placeholder="Hand-finished in Italy" help="Up to 3 short bullets shown beside the price." value={cfg.sellingPoints} onChange={(v) => setField({ sellingPoints: v })} />);
      break;
    }
    case 'RETAIL_SALE_COUNTDOWN': {
      fields.push(<TextField key="eyebrow" label="Eyebrow above countdown" value={cfg.eyebrow || ''} placeholder="SALE ENDS IN" onChange={(v) => setField({ eyebrow: v })} />);
      fields.push(<TextField key="headline" label="Headline" value={cfg.headline || ''} placeholder="Spring Sale · 30% Off Sitewide" onChange={(v) => setField({ headline: v })} />);
      fields.push(<TextField key="endsAt" label="Sale ends at (ISO 8601 timestamp)" value={cfg.endsAt || ''} placeholder="2026-05-15T23:59:00-05:00" onChange={(v) => setField({ endsAt: v })} />);
      fields.push(<TextField key="finishedMessage" label="Message when timer expires" value={cfg.finishedMessage || ''} placeholder="Sale now live · Step inside" onChange={(v) => setField({ finishedMessage: v })} />);
      fields.push(<TextField key="fineprint" label="Fine print line (under digits)" value={cfg.fineprint || ''} placeholder="Online and in-store · while supplies last" onChange={(v) => setField({ fineprint: v })} />);
      fields.push(<ColorPickerField key="bgColor" label="Background color" value={cfg.bgColor || '#1a1411'} onChange={(v) => setField({ bgColor: v })} />);
      fields.push(<ColorPickerField key="inkColor" label="Body ink color" value={cfg.inkColor || '#faf6f1'} onChange={(v) => setField({ inkColor: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Digit / eyebrow accent" value={cfg.accentColor || '#c9a66b'} onChange={(v) => setField({ accentColor: v })} />);
      break;
    }
    case 'RETAIL_LOYALTY_QR': {
      fields.push(<TextField key="eyebrow" label="Eyebrow line" value={cfg.eyebrow || ''} placeholder="MEMBERS CLUB" onChange={(v) => setField({ eyebrow: v })} />);
      fields.push(<TextField key="headline" label="Headline" value={cfg.headline || ''} placeholder="Earn rewards every visit." onChange={(v) => setField({ headline: v })} />);
      fields.push(<TextField key="subhead" label="Subhead" value={cfg.subhead || ''} placeholder="Free to join · Members-only events · Birthday gift" onChange={(v) => setField({ subhead: v })} />);
      fields.push(<TextField key="ctaText" label="CTA above QR" value={cfg.ctaText || ''} placeholder="Scan to join" onChange={(v) => setField({ ctaText: v })} />);
      fields.push(<TextField key="qrFootnote" label="Footnote below QR" value={cfg.qrFootnote || ''} placeholder="or visit yourstore.com/rewards" onChange={(v) => setField({ qrFootnote: v })} />);
      fields.push(<AssetPickerField key="qrImageUrl" label="QR image (operator-generated, optional)" value={cfg.qrImageUrl || ''} kind="image" onChange={(v) => setField({ qrImageUrl: v })} />);
      fields.push(<ColorPickerField key="bgColor" label="Background color" value={cfg.bgColor || '#faf6f1'} onChange={(v) => setField({ bgColor: v })} />);
      fields.push(<ColorPickerField key="inkColor" label="Body ink color" value={cfg.inkColor || '#1a1411'} onChange={(v) => setField({ inkColor: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Eyebrow + perks accent" value={cfg.accentColor || '#9a2d2d'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<StringListEditor key="perks" label="Perks" itemNoun="perk" maxItems={3} placeholder="Free to join" help="Up to 3 short loyalty perks." value={cfg.perks} onChange={(v) => setField({ perks: v })} />);
      break;
    }
    case 'RETAIL_WAYFINDING_MAP': {
      fields.push(<TextField key="heading" label="Heading" value={cfg.heading || ''} placeholder="Store Directory" onChange={(v) => setField({ heading: v })} />);
      fields.push(<TextField key="subheading" label="Subheading" value={cfg.subheading || ''} placeholder="Find your aisle" onChange={(v) => setField({ subheading: v })} />);
      fields.push(<ColorPickerField key="bgColor" label="Background color" value={cfg.bgColor || '#faf6f1'} onChange={(v) => setField({ bgColor: v })} />);
      fields.push(<ColorPickerField key="inkColor" label="Outline + label ink" value={cfg.inkColor || '#1a1411'} onChange={(v) => setField({ inkColor: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Highlight + pin accent" value={cfg.accentColor || '#9a2d2d'} onChange={(v) => setField({ accentColor: v })} />);
      // G4 (§19) — replaced the youAreHereJson TextArea with two number
      // inputs + a "show the marker" toggle. Widget shape is
      // `{ x: number; y: number } | null` (verified against
      // RetailWayfindingMapWidget.tsx); null hides the marker. Accepts a
      // legacy JSON string for back-compat.
      fields.push(<YouAreHereField key="youAreHere" label="“You are here” marker" value={cfg.youAreHere} onChange={(v) => setField({ youAreHere: v })} />);
      fields.push(<ListItemsEditor key="departments" label="Departments" itemNoun="department" help="Each tile is a department on the map. x / y / width / height are 0–100 percentages of the map area." value={cfg.departments} onChange={(v) => setField({ departments: v })} newItem={{ name: '', x: 6, y: 12, width: 38, height: 30, color: '#e8dcc8', emoji: '', highlight: false }} fields={[
        { key: 'name', label: 'Name', type: 'text', placeholder: 'Womens' },
        { key: 'emoji', label: 'Emoji', type: 'text', placeholder: '👗' },
        { key: 'color', label: 'Tile color', type: 'color' },
        { key: 'x', label: 'X (0–100)', type: 'number' },
        { key: 'y', label: 'Y (0–100)', type: 'number' },
        { key: 'width', label: 'Width (0–100)', type: 'number' },
        { key: 'height', label: 'Height (0–100)', type: 'number' },
        { key: 'highlight', label: 'Highlight this tile (pulses + pin)', type: 'toggle' },
      ]} />);
      break;
    }
    // editor-BUG-002 fix — explicit cases for the 9 highest-priority
    // restaurant/bar widgets that previously fell through to JSON-only
    // Advanced. Surfaces title / theme / accent / array editors backed
    // by the Config interfaces in each Widget.tsx. Same pattern as the
    // FITNESS_* cases above (TextField / ToggleField / SelectField /
    // ColorPickerField / TextAreaField with safe JSON parse).
    case 'RESTAURANT_COMBO_CAROUSEL': {
      fields.push(<TextField key="title" label="Section title" value={cfg.title || ''} placeholder="COMBOS · BUILT TO SHARE" onChange={(v) => setField({ title: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Mustard accent color" value={cfg.accentColor || '#e8b94a'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<SettingNumber key="rotationMs" label="Rotate every (seconds)" value={String((cfg.rotationMs || 7000) / 1000)} min={2} max={300} onChange={(v) => setField({ rotationMs: Math.round((parseFloat(v) || 7.0) * 1000) })} />);
      fields.push(<ListItemsEditor key="combos" label="Combos" itemNoun="combo" help="Each combo is one slide in the carousel." value={cfg.combos} onChange={(v) => setField({ combos: v })} newItem={{ name: '', includes: [], price: '', imageUrl: '', emoji: '', badge: '', tileBg: '' }} fields={[
        { key: 'name', label: 'Combo name', type: 'text', placeholder: 'Big Burger Combo' },
        { key: 'price', label: 'Price', type: 'price', placeholder: '$9.99' },
        { key: 'includes', label: 'Includes', type: 'stringList', placeholder: '1/3 lb cheeseburger' },
        { key: 'imageUrl', label: 'Photo', type: 'image' },
        { key: 'emoji', label: 'Emoji (fallback)', type: 'text', placeholder: '🍔' },
        { key: 'badge', label: 'Badge', type: 'text', placeholder: 'TODAY ONLY' },
        { key: 'tileBg', label: 'Tile color', type: 'color' },
      ]} />);
      break;
    }
    case 'RESTAURANT_SPECIALS_CALLOUT': {
      fields.push(<TextField key="headline" label="Top headline" value={cfg.headline || ''} placeholder="TODAY ONLY" onChange={(v) => setField({ headline: v })} />);
      fields.push(<TextField key="subhead" label="Subhead" value={cfg.subhead || ''} placeholder="while supplies last" onChange={(v) => setField({ subhead: v })} />);
      fields.push(<TextField key="itemName" label="Item name" value={cfg.itemName || ''} placeholder="Smash Burger Combo" onChange={(v) => setField({ itemName: v })} />);
      fields.push(<TextField key="itemDesc" label="Item description" value={cfg.itemDesc || ''} placeholder="1/3 lb smash, fries & 22oz drink" onChange={(v) => setField({ itemDesc: v })} />);
      fields.push(<TextField key="price" label="Sale price" value={cfg.price || ''} placeholder="$5.99" onChange={(v) => setField({ price: v })} />);
      fields.push(<TextField key="originalPrice" label="Strike-through price (optional)" value={cfg.originalPrice || ''} placeholder="$8.99" onChange={(v) => setField({ originalPrice: v })} />);
      fields.push(<TextField key="emoji" label="Emoji" value={cfg.emoji || ''} placeholder="hamburger" onChange={(v) => setField({ emoji: v })} />);
      fields.push(<SelectField key="theme" label="Background theme" value={cfg.theme || 'red'} options={[['red','Red'],['charcoal','Charcoal'],['mustard','Mustard']]} onChange={(v) => setField({ theme: v })} />);
      // Schema also surfaces tag/accentColor on legacy presets — keep them editable.
      fields.push(<TextField key="tag" label="Tag (legacy alias for headline)" value={cfg.tag || ''} placeholder="TODAY ONLY" onChange={(v) => setField({ tag: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Accent color (legacy)" value={cfg.accentColor || '#e8b94a'} onChange={(v) => setField({ accentColor: v })} />);
      break;
    }
    case 'RESTAURANT_LOYALTY_TICKER': {
      fields.push(<TextField key="programName" label="Program name (eyebrow chip)" value={cfg.programName || ''} placeholder="REWARDS" onChange={(v) => setField({ programName: v })} />);
      fields.push(<SettingNumber key="rotationMs" label="Rotate every (seconds)" value={String((cfg.rotationMs || 5500) / 1000)} min={2} max={300} onChange={(v) => setField({ rotationMs: Math.round((parseFloat(v) || 5.5) * 1000) })} />);
      fields.push(<ColorPickerField key="accentColor" label="Mustard accent color" value={cfg.accentColor || '#e8b94a'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<SelectField key="theme" label="Background theme" value={cfg.theme || 'charcoal'} options={[['cream','Cream'],['charcoal','Charcoal'],['red','Red']]} onChange={(v) => setField({ theme: v })} />);
      fields.push(<TextField key="qrUrl" label="QR sign-up URL (optional)" value={cfg.qrUrl || ''} placeholder="https://example.com/join" onChange={(v) => setField({ qrUrl: v })} />);
      fields.push(<TextField key="qrCaption" label="QR caption" value={cfg.qrCaption || ''} placeholder="Scan to join" onChange={(v) => setField({ qrCaption: v })} />);
      // messages can be array OR newline-delimited string — widget normalizes.
      fields.push(<TextAreaField key="messagesText" label="Loyalty messages (one per line)" value={Array.isArray(cfg.messages) ? cfg.messages.join('\n') : (typeof cfg.messages === 'string' ? cfg.messages : '')} rows={5} onChange={(v) => setField({ messages: v.split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean) })} />);
      break;
    }
    case 'RESTAURANT_WAIT_TIME': {
      fields.push(<TextField key="title" label="Title" value={cfg.title || ''} placeholder="WAIT TIME" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="estimateMins" label="Estimated wait (mins)" value={String(cfg.estimateMins ?? 12)} placeholder="12" onChange={(v) => setField({ estimateMins: parseInt(v) || 0 })} />);
      fields.push(<TextField key="partiesAhead" label="Parties ahead" value={String(cfg.partiesAhead ?? 3)} placeholder="3" onChange={(v) => setField({ partiesAhead: parseInt(v) || 0 })} />);
      fields.push(<TextField key="venueName" label="Venue name (in SMS hint)" value={cfg.venueName || ''} placeholder="The Boardwalk" onChange={(v) => setField({ venueName: v })} />);
      fields.push(<TextField key="smsNumber" label="SMS short-code" value={cfg.smsNumber || ''} placeholder="55512" onChange={(v) => setField({ smsNumber: v })} />);
      fields.push(<TextField key="smsKeyword" label="SMS keyword" value={cfg.smsKeyword || ''} placeholder="QUEUE" onChange={(v) => setField({ smsKeyword: v })} />);
      fields.push(<SelectField key="statusOverride" label="Force status (else auto from mins)" value={cfg.statusOverride || ''} options={[['','Auto-detect'],['open','Walk right in (green)'],['short','Short wait (amber)'],['busy','Busy (red)']]} onChange={(v) => setField({ statusOverride: v || undefined })} />);
      break;
    }
    case 'RESTAURANT_ALLERGY_LEGEND': {
      fields.push(<TextField key="title" label="Title above legend" value={cfg.title || ''} placeholder="DIETARY GUIDE" onChange={(v) => setField({ title: v })} />);
      fields.push(<SelectField key="layout" label="Layout" value={cfg.layout || 'horizontal'} options={[['horizontal','Horizontal strip'],['grid','2-column grid card']]} onChange={(v) => setField({ layout: v })} />);
      fields.push(<SelectField key="theme" label="Background theme" value={cfg.theme || 'cream'} options={[['cream','Cream'],['charcoal','Charcoal']]} onChange={(v) => setField({ theme: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Accent color (codes)" value={cfg.accentColor || '#7a1f1f'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<ListItemsEditor key="entries" label="Legend entries" itemNoun="entry" help="Leave empty to use the built-in defaults (Vegan, GF, etc.). Each row is one dietary code." value={cfg.entries} onChange={(v) => setField({ entries: v })} newItem={{ code: '', label: '', emoji: '' }} fields={[
        { key: 'code', label: 'Code', type: 'text', placeholder: 'GF' },
        { key: 'label', label: 'Label', type: 'text', placeholder: 'Gluten-free' },
        { key: 'emoji', label: 'Icon emoji', type: 'text', placeholder: '🌾' },
      ]} />);
      break;
    }
    case 'BAR_HAPPY_HOUR_COUNTDOWN': {
      fields.push(<TextField key="title" label="Headline" value={cfg.title || ''} placeholder="HAPPY HOUR" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="subtitle" label="Subtitle" value={cfg.subtitle || ''} placeholder="Tap drinks · House wine · Apps" onChange={(v) => setField({ subtitle: v })} />);
      fields.push(<TextField key="startsAt" label="Start time (e.g. 4:00 PM, 16:00, 4pm)" value={cfg.startsAt || ''} placeholder="4:00 PM" onChange={(v) => setField({ startsAt: v })} />);
      fields.push(<TextField key="endsAt" label="End time (e.g. 7:00 PM, 19:00, 7pm)" value={cfg.endsAt || ''} placeholder="7:00 PM" onChange={(v) => setField({ endsAt: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Accent neon color" value={cfg.accentColor || '#ec4899'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<TextField key="postEndedMs" label="Show 'ended' state for (ms)" value={String(cfg.postEndedMs || 1800000)} placeholder="1800000" onChange={(v) => setField({ postEndedMs: parseInt(v) || 1800000 })} />);
      fields.push(<ListItemsEditor key="drinks" label="Featured drinks" itemNoun="drink" help="Each row is one happy-hour drink with its regular vs. happy-hour price." value={cfg.drinks} onChange={(v) => setField({ drinks: v })} newItem={{ name: '', regularPrice: '', happyPrice: '', emoji: '' }} fields={[
        { key: 'name', label: 'Drink', type: 'text', placeholder: 'Drafts' },
        { key: 'regularPrice', label: 'Regular price', type: 'price', placeholder: '$8' },
        { key: 'happyPrice', label: 'Happy-hour price', type: 'price', placeholder: '$5' },
        { key: 'emoji', label: 'Emoji', type: 'text', placeholder: '🍺' },
      ]} />);
      break;
    }
    case 'BAR_GAME_DAY_SCHEDULE': {
      fields.push(<TextField key="title" label="Headline" value={cfg.title || ''} placeholder="GAME DAY" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="subtitle" label="Subtitle" value={cfg.subtitle || ''} placeholder="TODAY'S MATCHUPS" onChange={(v) => setField({ subtitle: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="LIVE chip / accent color" value={cfg.accentColor || '#ef4444'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<TextField key="maxRows" label="Max games shown" value={String(cfg.maxRows || 6)} placeholder="6" onChange={(v) => setField({ maxRows: parseInt(v) || 6 })} />);
      fields.push(<ListItemsEditor key="games" label="Games" itemNoun="game" help="Each row is one matchup. Status auto-detects from the time when left on Auto." value={cfg.games} onChange={(v) => setField({ games: v })} newItem={{ league: '', away: '', home: '', time: '', channel: '', status: '', emoji: '' }} fields={[
        { key: 'league', label: 'League', type: 'text', placeholder: 'NFL' },
        { key: 'away', label: 'Away team', type: 'text', placeholder: 'Cowboys' },
        { key: 'home', label: 'Home team', type: 'text', placeholder: 'Eagles' },
        { key: 'time', label: 'Time', type: 'text', placeholder: '1:00 PM' },
        { key: 'channel', label: 'Channel', type: 'text', placeholder: 'FOX' },
        { key: 'status', label: 'Status', type: 'select', options: [['', 'Auto-detect'], ['UPCOMING', 'Upcoming'], ['LIVE', 'Live'], ['FINAL', 'Final']] },
        { key: 'emoji', label: 'Emoji', type: 'text', placeholder: '🏈' },
      ]} />);
      break;
    }
    case 'BAR_EVENT_TONIGHT': {
      fields.push(<TextField key="eyebrow" label="Eyebrow label" value={cfg.eyebrow || ''} placeholder="TONIGHT" onChange={(v) => setField({ eyebrow: v })} />);
      fields.push(<TextField key="artist" label="Artist / band / DJ" value={cfg.artist || ''} placeholder="THE WALKMEN" onChange={(v) => setField({ artist: v })} />);
      fields.push(<TextField key="subtitle" label="Subtitle / opener / genre" value={cfg.subtitle || ''} placeholder="with special guest" onChange={(v) => setField({ subtitle: v })} />);
      fields.push(<TextField key="doorsAt" label="Doors at (e.g. 8:00 PM, 20:00)" value={cfg.doorsAt || ''} placeholder="8:00 PM" onChange={(v) => setField({ doorsAt: v })} />);
      fields.push(<TextField key="showAt" label="Show start (e.g. 9:00 PM, 21:00)" value={cfg.showAt || ''} placeholder="9:00 PM" onChange={(v) => setField({ showAt: v })} />);
      fields.push(<TextField key="cover" label="Cover charge label" value={cfg.cover || ''} placeholder="$10 cover" onChange={(v) => setField({ cover: v })} />);
      fields.push(<TextField key="footer" label="Footer rule line" value={cfg.footer || ''} placeholder="21+ · Cash bar · No RSVP" onChange={(v) => setField({ footer: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Primary neon (magenta)" value={cfg.accentColor || '#d946ef'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<ColorPickerField key="accent2" label="Secondary neon (cyan)" value={cfg.accent2 || '#22d3ee'} onChange={(v) => setField({ accent2: v })} />);
      break;
    }
    case 'BAR_TRIVIA_SCOREBOARD': {
      fields.push(<TextField key="title" label="Headline" value={cfg.title || ''} placeholder="TRIVIA NIGHT" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="subtitle" label="Subtitle" value={cfg.subtitle || ''} placeholder="LIVE LEADERBOARD" onChange={(v) => setField({ subtitle: v })} />);
      fields.push(<TextField key="roundNumber" label="Current round" value={String(cfg.roundNumber ?? 1)} placeholder="1" onChange={(v) => setField({ roundNumber: parseInt(v) || 1 })} />);
      fields.push(<TextField key="totalRounds" label="Total rounds" value={String(cfg.totalRounds ?? 6)} placeholder="6" onChange={(v) => setField({ totalRounds: parseInt(v) || 6 })} />);
      fields.push(<TextField key="questionNumber" label="Current question (within round)" value={String(cfg.questionNumber ?? 1)} placeholder="1" onChange={(v) => setField({ questionNumber: parseInt(v) || 1 })} />);
      fields.push(<TextField key="totalQuestions" label="Questions per round" value={String(cfg.totalQuestions ?? 10)} placeholder="10" onChange={(v) => setField({ totalQuestions: parseInt(v) || 10 })} />);
      fields.push(<TextField key="questionDeadline" label="Question deadline (ISO timestamp, optional)" value={cfg.questionDeadline || ''} placeholder="2026-05-03T20:30:00Z" onChange={(v) => setField({ questionDeadline: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Accent color (neon green)" value={cfg.accentColor || '#22c55e'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<TextField key="maxRows" label="Visible rows" value={String(cfg.maxRows || 5)} placeholder="5" onChange={(v) => setField({ maxRows: parseInt(v) || 5 })} />);
      fields.push(<ListItemsEditor key="teams" label="Teams" itemNoun="team" help="Each row is one team. Teams auto-sort by score; delta drives the ▲ / ▼ arrow." value={cfg.teams} onChange={(v) => setField({ teams: v })} newItem={{ name: '', score: 0, emoji: '', delta: 0 }} fields={[
        { key: 'name', label: 'Team name', type: 'text', placeholder: 'Quizzly Bears' },
        { key: 'score', label: 'Score', type: 'number', placeholder: '47' },
        { key: 'emoji', label: 'Emoji', type: 'text', placeholder: '🐻' },
        { key: 'delta', label: 'Change since last round', type: 'number', placeholder: '6' },
      ]} />);
      break;
    }
    // ── 2026-05-28 (§19) — formerly-orphan widgets ────────────────────────
    // These 7 rendered types had NO PropertiesPanel case, so clicking one
    // hit the terminal `return null` → blank panel ("JSON-only Advanced"),
    // the exact §19 failure. Each now has a real case exposing the config
    // its renderer actually reads (verified against WidgetRenderer.tsx /
    // AnimatedBackgroundWidget.tsx — not invented fields). Text-bearing ones
    // also pick up the universal Font + Text-color + B/I/U/S block below
    // (none are in MEDIA_ONLY) + the universal Position & size section. The
    // types are conservative additions; nothing is deleted.
    case 'TOUCH_BUTTON': {
      const ICONS: [string, string][] = [['', 'None'], ['arrow-right', 'Arrow'], ['chevron-right', 'Chevron'], ['bell', 'Bell'], ['globe', 'Globe'], ['map-pin', 'Map pin'], ['star', 'Star'], ['heart', 'Heart'], ['shield', 'Shield'], ['clock', 'Clock'], ['eye', 'Eye'], ['play', 'Play'], ['image', 'Image'], ['sparkles', 'Sparkles']];
      fields.push(<TextField key="label" label="Button label" value={cfg.label || ''} placeholder="Tap" onChange={(v) => setField({ label: v })} />);
      fields.push(<SelectField key="icon" label="Icon" value={String(cfg.icon || '')} options={ICONS} onChange={(v) => setField({ icon: v })} />);
      fields.push(<ColorField key="bgColor" label="Button color" value={cfg.bgColor || '#4f46e5'} onChange={(v) => setField({ bgColor: v })} />);
      fields.push(<ColorField key="color" label="Label color" value={cfg.color || '#ffffff'} onChange={(v) => setField({ color: v })} />);
      fields.push(<NumField key="radius" id="tb-radius" label="Corner radius (px)" value={typeof cfg.radius === 'number' ? cfg.radius : 18} onChange={(v) => setField({ radius: v })} min={0} max={120} step={1} />);
      fields.push(<p key="tb-hint" className="text-[10px] text-slate-400 px-0.5">Set what this button does in the Tap action section below (enable touch on the template first).</p>);
      break;
    }
    case 'TOUCH_MENU': {
      fields.push(<SelectField key="orientation" label="Layout" value={cfg.orientation === 'horizontal' ? 'horizontal' : 'vertical'} options={[['vertical', 'Vertical (stacked)'], ['horizontal', 'Horizontal (row)']]} onChange={(v) => setField({ orientation: v })} />);
      fields.push(<NumField key="gap" id="tm-gap" label="Gap between buttons (px)" value={typeof cfg.gap === 'number' ? cfg.gap : 12} onChange={(v) => setField({ gap: v })} min={0} max={80} step={2} />);
      fields.push(<ListItemsEditor key="buttons" label="Menu buttons" itemNoun="button" help="Each row is one button in the menu. Colors are per-button; leave blank for the default dark style." value={cfg.buttons} onChange={(v) => setField({ buttons: v })} newItem={{ label: '', icon: '', bgColor: '', color: '' }} fields={[
        { key: 'label', label: 'Label', type: 'text', placeholder: 'Directory' },
        { key: 'icon', label: 'Icon', type: 'select', options: [['', 'None'], ['arrow-right', 'Arrow'], ['chevron-right', 'Chevron'], ['bell', 'Bell'], ['globe', 'Globe'], ['map-pin', 'Map pin'], ['star', 'Star'], ['heart', 'Heart'], ['shield', 'Shield'], ['clock', 'Clock'], ['eye', 'Eye'], ['play', 'Play'], ['image', 'Image'], ['sparkles', 'Sparkles']] },
        { key: 'bgColor', label: 'Button color', type: 'color' },
        { key: 'color', label: 'Label color', type: 'color' },
      ]} />);
      break;
    }
    case 'ON_SCREEN_KEYBOARD': {
      fields.push(<SelectField key="mode" label="Keyboard type" value={cfg.mode === 'numeric' ? 'numeric' : 'qwerty'} options={[['qwerty', 'QWERTY (full)'], ['numeric', 'Numeric (0–9)']]} onChange={(v) => setField({ mode: v })} />);
      fields.push(<TextField key="placeholder" label="Placeholder text" value={cfg.placeholder || ''} placeholder="Type here…" onChange={(v) => setField({ placeholder: v })} />);
      break;
    }
    case 'ROOM_FINDER': {
      fields.push(<TextField key="title" label="Title" value={cfg.title || ''} placeholder="Find a room" onChange={(v) => setField({ title: v })} />);
      fields.push(<ListItemsEditor key="rooms" label="Rooms" itemNoun="room" help="Each row is one searchable room. Location is the line shown beside the name." value={cfg.rooms} onChange={(v) => setField({ rooms: v })} newItem={{ name: '', location: '', mapZoneId: '' }} fields={[
        { key: 'name', label: 'Room / teacher', type: 'text', placeholder: 'Room 204 — Ms. Chen' },
        { key: 'location', label: 'Location', type: 'text', placeholder: '2nd floor, B wing' },
        { key: 'mapZoneId', label: 'Map zone id (optional)', type: 'text', placeholder: 'zone id to reveal on select' },
      ]} />);
      break;
    }
    case 'WAYFINDING_MAP': {
      fields.push(<AssetPickerField key="mapImageUrl" label="Map image" kind="image" value={cfg.mapImageUrl || ''} onChange={(v) => setField({ mapImageUrl: v })} />);
      fields.push(<TextField key="alt" label="Map alt text (for screen readers)" value={cfg.alt || ''} placeholder="Wayfinding map" onChange={(v) => setField({ alt: v })} />);
      fields.push(<ListItemsEditor key="hotspots" label="Hotspots" itemNoun="hotspot" help="Each pin sits at an x / y position (0–100% of the map). Optional map zone id reveals a zone when tapped." value={cfg.hotspots} onChange={(v) => setField({ hotspots: v })} newItem={{ label: '', x: 50, y: 50, roomId: '' }} fields={[
        { key: 'label', label: 'Label', type: 'text', placeholder: 'Main office' },
        { key: 'x', label: 'X (0–100%)', type: 'number', placeholder: '50' },
        { key: 'y', label: 'Y (0–100%)', type: 'number', placeholder: '50' },
        { key: 'roomId', label: 'Map zone id (optional)', type: 'text' },
      ]} />);
      break;
    }
    case 'QUICK_POLL': {
      fields.push(<TextField key="question" label="Question" value={cfg.question || ''} placeholder="Quick poll" onChange={(v) => setField({ question: v })} />);
      fields.push(<ListItemsEditor key="options" label="Answer options" itemNoun="option" help="Each row is one tappable answer. Starting votes are optional (defaults to 0)." value={cfg.options} onChange={(v) => setField({ options: v })} newItem={{ label: '', votes: 0 }} fields={[
        { key: 'label', label: 'Answer', type: 'text', placeholder: 'Pizza' },
        { key: 'votes', label: 'Starting votes', type: 'number', placeholder: '0' },
      ]} />);
      break;
    }
    case 'ANIMATED_BACKGROUND': {
      // Pure decoration — renders a rainbow ribbon + confetti, no foreground
      // text/color of its own. Expose ONLY its real knobs (variant +
      // confetti density); fabricated text/color fields would be a costume
      // since the widget ignores them.
      fields.push(<SelectField key="variant" label="Background style" value={String(cfg.variant || 'rainbow')} options={[['rainbow', 'Rainbow ribbon + confetti']]} onChange={(v) => setField({ variant: v })} />);
      fields.push(<NumField key="confettiCount" id="abw-confetti" label="Confetti density" value={typeof cfg.confettiCount === 'number' ? cfg.confettiCount : 80} onChange={(v) => setField({ confettiCount: v })} min={0} max={300} step={10} />);
      break;
    }
    default: {
      // ── v2 widget pack — generic content + brand-style editor ──
      // Celebration / scoreboard / healthcare / corporate / hospitality
      // / worship / chart widgets register as variants under canonical
      // types with no hand-built case. Without this they'd show an
      // EMPTY panel — "not editable". We read the widget's registry
      // `defaults` for its content fields and add a full Style section
      // (background color / image / gradient, text + accent + highlight
      // colors, font family + weight) so the operator can recolor,
      // refont, and re-background the widget to their team's brand.
      // Every v2 widget routes config.style through resolveStyle(), so
      // these controls take effect live.
      const v2w = cfg.variant ? V2_BY_VARIANT_ID[String(cfg.variant)] : undefined;
      if (v2w) {
        const SHv2 = (k: string, label: string) => (
          <div
            key={`shv2-${k}`}
            className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200"
          >
            {label}
          </div>
        );
        const defs = (v2w.defaults || {}) as Record<string, unknown>;
        const contentKeys = Object.keys(defs).filter(
          (k) => k !== 'variant' && k !== 'style' && k !== 'tier',
        );
        // 2026-05-29 — operator: "upload logos when needed or images." An
        // image/logo/photo content field used to render as a plain URL
        // TextField (paste-only). Detect image-ish keys so they render an
        // AssetPickerField instead (upload from desktop + pick from Assets +
        // URL paste). Excludes emoji / video / color keys, which are NOT
        // images. Applies to single (string) and multi (array) image fields.
        // Suffix-anchored so only true image fields match — "logoUrl",
        // "heroImage", "productPhoto", "mascot", "photos" (array) → yes;
        // "imageCaption", "photoCredit", "logoText" → no (end in text words).
        const isImageKey = (k: string) =>
          /(^|[a-z])(logo|image|img|photo|picture|avatar|headshot|mascot|crest|poster|thumbnail|backdrop|artwork)(url|uri|src|s)?$/i.test(k) &&
          !/emoji|video|color/i.test(k);
        if (contentKeys.length > 0) {
          fields.push(SHv2('content', 'Content'));
          for (const key of contentKeys) {
            const dv = defs[key];
            const cur = cfg[key];
            if (Array.isArray(dv) && isImageKey(key)) {
              // Multi-image field (gallery / logos / product photos) → upload
              // + reorder + pick-from-Assets, not a comma-separated URL string.
              const arr = Array.isArray(cur) ? (cur as unknown[]) : (dv as unknown[]);
              fields.push(
                <AssetListPickerField
                  key={key}
                  label={prettyFieldLabel(key)}
                  kind="image"
                  value={arr.map((s) => String(s))}
                  onChange={(v) => setField({ [key]: v })}
                />,
              );
            } else if (Array.isArray(dv)) {
              const val = Array.isArray(cur)
                ? cur.join(', ')
                : (dv as unknown[]).join(', ');
              fields.push(
                <TextField
                  key={key}
                  label={prettyFieldLabel(key)}
                  value={val}
                  onChange={(v) =>
                    setField({
                      [key]: v.split(',').map((s) => s.trim()).filter(Boolean),
                    })
                  }
                />,
              );
            } else if (typeof dv === 'boolean') {
              fields.push(
                <ToggleField
                  key={key}
                  label={prettyFieldLabel(key)}
                  value={cur != null ? !!cur : (dv as boolean)}
                  onChange={(v) => setField({ [key]: v })}
                />,
              );
            } else if (typeof dv === 'number') {
              fields.push(
                <TextField
                  key={key}
                  label={prettyFieldLabel(key)}
                  value={cur != null ? String(cur) : String(dv)}
                  onChange={(v) =>
                    setField({ [key]: v.trim() === '' ? 0 : Number(v) })
                  }
                />,
              );
            } else if (isImageKey(key)) {
              // Single image/logo content field → upload from desktop, pick
              // from Assets, or paste a URL (operator's "upload logos" ask).
              fields.push(
                <AssetPickerField
                  key={key}
                  label={prettyFieldLabel(key)}
                  kind="image"
                  value={cur != null ? String(cur) : String(dv ?? '')}
                  onChange={(v) => setField({ [key]: v })}
                />,
              );
            } else {
              fields.push(
                <TextField
                  key={key}
                  label={prettyFieldLabel(key)}
                  value={cur != null ? String(cur) : String(dv ?? '')}
                  placeholder={String(dv ?? '')}
                  onChange={(v) => setField({ [key]: v })}
                />,
              );
            }
          }
        }
        if ('tier' in defs) {
          fields.push(SHv2('tier', 'Scoreboard tier'));
          fields.push(
            <SelectField
              key="v2-tier"
              label="Tier"
              value={String(cfg.tier ?? defs.tier ?? 'hs')}
              options={[
                ['hs', 'High School'],
                ['college', 'College'],
                ['pro', 'Professional'],
              ]}
              onChange={(v) => setField({ tier: v })}
            />,
          );
        }
        // Brand style (colors / type / background) is NO LONGER pushed
        // here — 2026-08-03 it moved to `buildV2StyleFields()`, appended
        // AFTER the switch so it also reaches the 70 v2 variants whose
        // canonical widget type has a hand-built case and never falls
        // through to this `default:` branch. See the helper's header.
        break;
      }

      // Generic MS pack handler — all 16 MS widget types (8 landscape +
      // 8 portrait) share this same auto-form generator. Each widget
      // exports its DEFAULTS object keyed by dot-notation field paths.
      // We render one editable field per key, grouped into sections by
      // the dot-prefix. Saves writing 16 hand-built switch cases (each
      // 80-100 fields long — over 1000 lines of boilerplate).
      const msDefaults = MS_DEFAULTS_BY_TYPE[zone.widgetType];
      if (msDefaults) {
        const SH = (key: string, label: string) => (
          <div
            key={`sh-${key}`}
            className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200"
          >
            {label}
          </div>
        );
        // Group keys by their top-level dot-prefix so the form has
        // logical sections matching the widget's regions (school /
        // agenda / clubs / ticker / etc.).
        const groups = new Map<string, string[]>();
        for (const k of Object.keys(msDefaults)) {
          const prefix = k.includes('.') ? k.split('.')[0] : '_root';
          const list = groups.get(prefix) ?? [];
          list.push(k);
          groups.set(prefix, list);
        }
        // 2026-05-08 — HS portrait widgets get per-field text styling:
        // StyleableField forwards focus to BuilderBottomBar's format
        // controls (font / size / B-I-U-S / color / brand / align /
        // line-height), which BuilderZone applies via cfg._styles.
        // MS / Fitness widgets stick with plain TextField for now —
        // they don't have the runtime useTextStyleOverrides hook on
        // their widget side, so per-field styling would lie about
        // what works.
        const isHsWidget = typeof zone.widgetType === 'string' && zone.widgetType.startsWith('HS_');
        const styleSetter = (s: FieldStyleMap) => setField({ __styles: s });
        // 2026-05-29 — image/logo/photo keys in MS + Fitness widget DEFAULTS
        // must render an UPLOAD picker, not a URL TextField (operator: "upload
        // logos when needed or images"). Same suffix-anchored match as the v2
        // path. Without this, the logoUrl / gymLogoUrl / photoUrl keys the
        // MS + Fitness agents added would show as plain text boxes.
        const isImageKey = (k: string) => {
          const leaf = k.includes('.') ? k.split('.').pop()! : k;
          return /(^|[a-z])(logo|image|img|photo|picture|avatar|headshot|mascot|crest|poster|thumbnail|backdrop|artwork)(url|uri|src|s)?$/i.test(leaf) &&
            !/emoji|video|color/i.test(leaf);
        };
        for (const [prefix, keys] of groups) {
          fields.push(SH(prefix, prettySectionLabel(prefix === '_root' ? 'general' : prefix)));
          for (const key of keys) {
            const defaultValue = msDefaults[key] || '';
            const currentValue = (cfg[key] ?? '') as string;
            // Image/logo/photo key → upload picker (desktop + Assets + URL).
            if (isImageKey(key)) {
              fields.push(
                <AssetPickerField
                  key={key}
                  label={prettyFieldLabel(key)}
                  kind="image"
                  value={currentValue}
                  onChange={(v) => setField({ [key]: v })}
                />,
              );
              continue;
            }
            // Multi-line if the default has a newline OR is long. Most
            // ticker / lede fields trip this, which is what we want —
            // they need the bigger box for editing.
            const looksLong = defaultValue.length > 80 || /\n/.test(defaultValue);
            if (looksLong) {
              fields.push(
                isHsWidget ? (
                  <StyleableAreaField
                    key={key}
                    fieldName={key}
                    styles={cfg.__styles}
                    onStylesChange={styleSetter}
                    label={prettyFieldLabel(key)}
                    value={currentValue}
                    placeholder={defaultValue}
                    rows={3}
                    onChange={(v) => setField({ [key]: v })}
                  />
                ) : (
                  <TextAreaField
                    key={key}
                    label={prettyFieldLabel(key)}
                    value={currentValue}
                    placeholder={defaultValue}
                    rows={3}
                    onChange={(v) => setField({ [key]: v })}
                  />
                ),
              );
            } else {
              fields.push(
                isHsWidget ? (
                  <StyleableField
                    key={key}
                    fieldName={key}
                    styles={cfg.__styles}
                    onStylesChange={styleSetter}
                    label={prettyFieldLabel(key)}
                    value={currentValue}
                    placeholder={defaultValue}
                    onChange={(v) => setField({ [key]: v })}
                  />
                ) : (
                  <TextField
                    key={key}
                    label={prettyFieldLabel(key)}
                    value={currentValue}
                    placeholder={defaultValue}
                    onChange={(v) => setField({ [key]: v })}
                  />
                ),
              );
            }
          }
        }
        break;
      }
      // Sprint 11h pre-launch — themed widget auto-form for the 17
      // Animated/Bulletin/Scrapbook/Storybook widgets that previously
      // fell through to JSON-only editing. Reads from
      // THEMED_WIDGET_FIELDS (single source of truth for editable
      // hotspots per widget type) and renders a Text/TextArea per
      // entry. Each `key` matches the `data-field` attribute on the
      // widget's rendered text, so canvas click-to-edit jumps to the
      // matching field via the same scroll-into-view flow the MS pack
      // already uses.
      const themed = THEMED_WIDGET_FIELDS[zone.widgetType];
      if (themed) {
        for (const f of themed) {
          // 2026-05-28 (P0-3 §19): the THEMED auto-form used to render
          // Text/TextArea ONLY, so the primary content of these widgets — the
          // schedule rows, the bell periods, the lunch menu, the food photo —
          // was unreachable. Dispatch on `f.kind` so each list/image field
          // gets the matching array / asset-picker editor (reusing the same
          // controls LUNCH_MENU / BELL_SCHEDULE / IMAGE already ship).
          switch (f.kind) {
            case 'array-schedule': {
              // Class-row schedule: {num,time,name,room}[] under f.key
              // (cfg.rows on Bulletin/Scrapbook/Storybook Hallway,
              //  cfg.periods on AnimatedHallwaySchedule).
              fields.push(
                <ScheduleRowsField
                  key={f.key}
                  label={f.label}
                  value={Array.isArray(cfg[f.key]) ? cfg[f.key] : []}
                  onChange={(rows) => setField({ [f.key]: rows })}
                />,
              );
              break;
            }
            case 'array-bell': {
              // Bell periods: {num,label,startTime,endTime,room}[] — identical
              // shape BELL_SCHEDULE produces. Reuse its editor + write path.
              // BellScheduleEditor only edits label + start/end, so preserve
              // any per-index `room` the preset set (AnimatedBellSchedule
              // renders it) instead of dropping it on every edit.
              const existingPeriods = Array.isArray(cfg.periods) ? cfg.periods : [];
              fields.push(
                <BellScheduleEditor
                  key={f.key}
                  value={bellScheduleForEditor(cfg.periods)}
                  onChange={(schedule) => setField({
                    periods: schedule.map((p, i) => ({
                      num: String(i + 1),
                      label: p.label,
                      startTime: p.start,
                      endTime: p.end,
                      ...(existingPeriods[i]?.room ? { room: existingPeriods[i].room } : {}),
                    })),
                  })}
                />,
              );
              break;
            }
            case 'array-menu': {
              // Lunch menu: cfg.weekMenu (CafeWeek of {emoji,name,meta,price}).
              // Mirror the first non-empty day into cfg.menuItems so the
              // builder preview + any weekend render still shows content
              // (the cafeteria widgets fall back to menuItems when weekMenu
              // has nothing for the current weekday).
              fields.push(
                <WeekMenuEditor
                  key={f.key}
                  value={cfg.weekMenu}
                  onChange={(weekMenu) => {
                    const firstDay =
                      weekMenu.monday?.length ? weekMenu.monday :
                      weekMenu.tuesday?.length ? weekMenu.tuesday :
                      weekMenu.wednesday?.length ? weekMenu.wednesday :
                      weekMenu.thursday?.length ? weekMenu.thursday :
                      weekMenu.friday?.length ? weekMenu.friday : [];
                    setField({ weekMenu, menuItems: firstDay });
                  }}
                />,
              );
              break;
            }
            case 'array-cards': {
              // Scrapbook cafeteria menu cards: {title,desc}[] under cfg.cards.
              fields.push(
                <MenuCardsField
                  key={f.key}
                  label={f.label}
                  value={Array.isArray(cfg.cards) ? cfg.cards : []}
                  onChange={(cards) => setField({ cards })}
                />,
              );
              break;
            }
            case 'image': {
              // Food photo — cfg.photoEmoji / cfg.heroEmoji accept a URL the
              // widget renders via <img> (or an emoji string fallback).
              fields.push(
                <AssetPickerField
                  key={f.key}
                  label={f.label}
                  kind="image"
                  value={(cfg[f.key] ?? '') as string}
                  onChange={(v) => setField({ [f.key]: v })}
                />,
              );
              break;
            }
            default: {
              const currentValue = (cfg[f.key] ?? '') as string;
              if (f.multiline || f.kind === 'multiline') {
                fields.push(
                  <TextAreaField
                    key={f.key}
                    label={f.label}
                    value={currentValue}
                    placeholder={f.default}
                    rows={3}
                    onChange={(v) => setField({ [f.key]: v })}
                  />,
                );
              } else {
                fields.push(
                  <TextField
                    key={f.key}
                    label={f.label}
                    value={currentValue}
                    placeholder={f.default}
                    onChange={(v) => setField({ [f.key]: v })}
                  />,
                );
              }
            }
          }
        }
        break;
      }
      // Unknown widget — fall through to JSON-only editing in Advanced
      return null;
    }
  }

  // ── v2 widget pack — Style section for EVERY v2 variant ───────────
  // 2026-08-03 (§19 launch blocker). Appended AFTER the switch, so a
  // zone whose canonical widget type has a hand-built case (CLOCK,
  // ANNOUNCEMENT, CALENDAR, STAFF_SPOTLIGHT, COUNTDOWN, LOGO, WEATHER,
  // BELL_SCHEDULE, TEXT, TICKER, IMAGE, RICH_TEXT, LUNCH_MENU) gets the
  // colors / type / background controls too — those 70 variants used to
  // `break` out of the switch before `default:` ever ran and reached the
  // operator with content fields ONLY ("you can change the words and
  // nothing else"). The hand-built case still owns CONTENT; this owns
  // STYLE, so the two compose instead of competing.
  const isV2Variant = !!(cfg.variant && V2_BY_VARIANT_ID[String(cfg.variant)]);
  if (isV2Variant) {
    fields.push(...buildV2StyleFields(cfg, setField));
  }

  // ── Universal "make it your brand" text-style section ─────────────
  // Every text-bearing widget gets Font + Text color + B/I/U/S — even
  // the themed / MS / fitness widgets whose auto-form previously
  // exposed CONTENT fields only. These write the zone-wide
  // cfg.fontFamily / cfg.color / cfg.bold keys, which BuilderZone AND
  // the player both inject as [data-zone-id]-scoped CSS — so the
  // override renders identically in the editor and on the live screen.
  // Skipped when: the widget already has a Font control (rich text —
  // already fully styleable), it is a v2 widget (its own Style
  // section covers this), or it is a pure-media widget with no text.
  {
    // 2026-05-28 (§19) — LOGO removed from MEDIA_ONLY. LOGO_* variants render
    // schoolName / tagline / initials as TEXT, but the wordmark had zero
    // font/color control (the audit graded it B for exactly this). It is NOT
    // pure-media: the image picker lives in the LOGO case itself and is
    // untouched by this block, while the universal Font + Text-color + B/I/U/S
    // controls flow through BuilderZone's + the player's
    // `[data-widget-content] *:not(svg)` injection (verified identical in both),
    // so a tenant can brand the wordmark. The <img> logo ignores color/font.
    // 2026-05-28 (§19 / G2) — Font-SIZE added. The render path already injects
    // cfg.fontSize: BuilderZone.buildRules() emits `font-size: Npx !important`
    // scoped to `[data-zone-id] [data-widget-content] *:not(svg)` (BuilderZone
    // line ~617) and the player mirrors it byte-for-byte (player/page.tsx line
    // ~5267). NO control wrote cfg.fontSize for any auto-form widget, so every
    // MS / Fitness / themed full-screen widget failed the §19 "font size"
    // criterion despite the plumbing existing. Adding it here lifts all of them
    // at once. Like the font/color above, the override is zone-wide and uniform
    // (the injection hits every text span); operators who need per-field size
    // hierarchy use the per-field StyleableField bottom-bar on HS widgets. For
    // the auto-forms this is the difference between "can set the size" (B) and
    // "can't touch it" (the audit's complaint) — a real, verifiable win.
    // 2026-05-28 (§19) — ANIMATED_BACKGROUND added: it's a textless decorative
    // rainbow layer, so a font/color block would be a costume (the widget reads
    // neither). Its real knobs (variant, confetti) live in its own case above.
    // 2026-08-03 (§19 launch blocker) — the blanket `!isV2Widget` skip is
    // GONE. Its premise ("its own Style section covers this") was false for
    // the 70 v2 variants whose canonical type has a hand-built case: they
    // never reached the `default:` branch that used to own the v2 Style
    // section, so BOTH escape hatches were shut and the widget was
    // completely un-styleable. The v2 Style section now runs for every v2
    // variant (see `buildV2StyleFields` above), so here we only need to add
    // what `config.style` genuinely has no equivalent for: Font SIZE and
    // B/I/U/S. Both ride the zone-wide `[data-widget-content] *:not(svg)`
    // !important injection (BuilderZone.buildRules + the player's identical
    // mirror), which works on ANY renderer — including a v2 widget that
    // hard-codes its own sizes. Font-family and Text-color are deliberately
    // NOT repeated for v2: `config.style.fontFamily` / `.textColor` flow
    // through resolveStyle()+frameStyle() natively and two competing "Font"
    // pickers in one panel is exactly the confusion this section exists to
    // prevent.
    const MEDIA_ONLY = new Set(['IMAGE', 'IMAGE_CAROUSEL', 'VIDEO', 'VIDEO_CAROUSEL', 'EXTERNAL_HTML', 'ANIMATED_BACKGROUND']);
    const isV2Widget = isV2Variant;
    const alreadyStyleable = fields.some((f: any) => f && f.key === 'fontFamily');
    if (!alreadyStyleable && !MEDIA_ONLY.has(zone.widgetType)) {
      fields.push(
        <div key="_uts-hdr" className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200">
          Text style — make it your brand
        </div>,
      );
      if (!isV2Widget) {
        fields.push(<FontFamilyField key="_uts-font" label="Font" value={cfg.fontFamily || ''} onChange={(v) => setField({ fontFamily: v })} />);
      }
      fields.push(
        <FontSizeField
          key="_uts-size"
          label="Font size"
          value={typeof cfg.fontSize === 'number' && Number.isFinite(cfg.fontSize) ? cfg.fontSize : null}
          onChange={(v) => setField({ fontSize: v })}
          getMeasuredSize={() => measureZoneFontSize(zone.id)}
        />,
      );
      if (!isV2Widget) {
        fields.push(<ColorField key="_uts-color" label="Text color" value={cfg.color || ''} onChange={(v) => setField({ color: v })} allowTransparent />);
      }
      fields.push(
        <FormatToggles
          key="_uts-format"
          bold={cfg.bold === true}
          italic={cfg.italic === true}
          underline={cfg.underline === true}
          strikethrough={cfg.strikethrough === true}
          onChange={(patch) => setField(patch)}
        />,
      );
    }
  }

  return (
    <section className="space-y-3">
      {/* Element header — names WHAT you're editing (operator 2026-05-29:
          "it should have a header that says home score or something"). Shows
          the element's layer name + a type badge so it's unmistakable which
          element the fields below belong to. */}
      <div className="flex items-center gap-2 pl-1 pb-2 mb-1 border-b border-slate-100">
        <span className="text-sm font-bold text-slate-800 truncate" title={zone.name}>{zone.name ? (/^[A-Z0-9_]+$/.test(zone.name) ? prettyTitle(zone.name) : zone.name) : widgetLabel(zone.widgetType)}</span>
        <span className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded text-[9px] font-bold uppercase tracking-wide shrink-0">{widgetLabel(zone.widgetType)}</span>
      </div>
      {/* Slice 2a — chat-to-edit. Self-hides when locked or no AI key. The
          chosen diff commits through updateZone (one undo step). */}
      <ChatToEditBox
        zones={[zone as any]}
        onApply={(diff) => {
          const e = diff.find((d) => d.zoneId === zone.id);
          if (!e) return;
          const { defaultConfig: cfgPatch, ...zoneKeys } = e.patch;
          const merged: Record<string, any> = { ...zoneKeys };
          if (cfgPatch) merged.defaultConfig = { ...(zone.defaultConfig || {}), ...cfgPatch };
          updateZone(zone.id, merged, true);
        }}
      />
      <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Content</h3>
      <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm space-y-3">
        {fields.map((field, i) => {
          // Wrap each field with `data-field-section` so the canvas
          // hotspot click handler in BuilderZone can scroll the right
          // section into view + flash it. The React element's `key`
          // matches the widget's `data-field` attribute (we use the
          // same naming convention everywhere — content / message /
          // staffName / brand.date / etc).
          const sectionKey = (field as any)?.key;
          return (
            <div
              key={sectionKey ?? i}
              data-field-section={sectionKey ?? undefined}
              style={{ scrollMarginTop: 16 }}
            >
              {field}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────
// Per-field text-style overrides (font-size + color + weight)
// ─────────────────────────────────────────────────────────
//
// Every HS widget renders text into elements that carry a `data-field`
// attribute. The widget's CSS classes set the default look; an
// optional `__styles` map on the widget config can override fontSize,
// color, and fontWeight per data-field. The hook
// `useTextStyleOverrides` (apps/web/src/components/widgets/hs/) walks
// the stage's DOM and applies inline styles on top of the class
// defaults at runtime.
//
// On the editor side, focusing a StyleableField input (or clicking the
// matching text on the canvas) sets the builder store's activeFieldName,
// which lights up the per-field format controls in BuilderShell's
// persistent BuilderBottomBar (font / size / B-I-U-S / color / brand-color
// presets / alignment / line-height). Those write `cfg._styles[fieldKey]`,
// which BuilderZone injects as scoped CSS at render time. Clearing a value
// deletes the matching override key so the CSS class default returns. All
// call sites use the StyleableField component below; both single-line and
// multi-line variants exist.

// Schema parity with `apps/web/src/components/widgets/hs/useTextStyleOverrides.ts#TextStyleOverride`.
// `hidden` rides the same `_styles`/`textStyles` transport across packaged
// boards, React-zone fields, and sandboxed holiday iframes. BuilderZone and
// the holiday style bridge both apply it to the targeted field only.
type FieldStyleProp =
  | 'fontSize'
  | 'color'
  | 'fontWeight'
  | 'fontStyle'
  | 'textDecoration'
  | 'fontFamily'
  | 'lineHeight'
  | 'textAlign'
  | 'backgroundColor'
  | 'hidden'
  | 'visibility'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough';
type FieldStyle = {
  fontSize?: number;
  color?: string;
  fontWeight?: number;
  fontStyle?: 'italic' | 'normal';
  textDecoration?: 'underline' | 'line-through' | 'underline line-through' | 'none';
  fontFamily?: string;
  lineHeight?: number;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  backgroundColor?: string;
  visibility?: 'visible' | 'hidden';
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  /** `true` hides the targeted field (`display:none`); false/absent shows it. */
  hidden?: boolean;
};
type FieldStyleMap = Record<string, FieldStyle>;

function readFieldStyle(styles: FieldStyleMap | undefined, fieldName: string): FieldStyle {
  return (styles && styles[fieldName]) || {};
}

/** Pure-function update: returns a NEW __styles map with one prop on
 *  one field changed — or removed when value is undefined / blank. */
function updateFieldStyleMap(
  styles: FieldStyleMap | undefined,
  fieldName: string,
  prop: FieldStyleProp,
  value: number | string | boolean | undefined,
): FieldStyleMap {
  const existing = styles || {};
  const current = { ...(existing[fieldName] || {}) };
  if (value === undefined || value === '' || value === false || (typeof value === 'number' && !Number.isFinite(value))) {
    delete current[prop];
  } else {
    (current as any)[prop] = value;
  }
  const isEmpty = Object.keys(current).length === 0;
  const next = { ...existing };
  if (isEmpty) {
    delete next[fieldName];
  } else {
    next[fieldName] = current;
  }
  return next;
}

// NOTE (2026-06-26): the former in-panel `StyleDisclosure` rich editor was
// removed. It had ZERO JSX call sites and duplicated the per-field styling
// that BuilderShell's persistent BuilderBottomBar already provides on field
// focus (writing cfg._styles, applied by BuilderZone). Two competing editors
// targeting two different style maps (__styles vs _styles) was the bug. The
// bottom bar now carries every dimension — font / size / B-I-U-S / color /
// brand-color presets / alignment / line-height — see BuilderBottomBar.

/** Single-line TextField that lights up the BuilderBottomBar's per-field
 *  format toolbar on focus. The actual font / size / B-I-U-S / color
 *  controls live in the bottom bar (BuilderShell.tsx#BuilderBottomBar)
 *  so the property panel stays clean and the formatting UX is the same
 *  pattern operators already know from the TEXT widget.
 *
 *  `styles` / `onStylesChange` are still threaded through (the bottom
 *  bar reads them via the selected zone's defaultConfig), and the
 *  per-field active marker is the indigo ring you see when this field
 *  is the live target. */
function StyleableField({
  label,
  value,
  placeholder,
  onChange,
  fieldName,
  styles,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  fieldName: string;
  // styles + onStylesChange stay on the call-site signature so we don't
  // have to touch all 200+ call sites — but the actual rendering of
  // formatting controls happens in BuilderBottomBar (not here). The
  // panel input is just an input + focus tracker.
  styles?: FieldStyleMap | undefined;
  onStylesChange?: (next: FieldStyleMap) => void;
}) {
  const setActiveFieldName = useBuilderStore((s) => s.setActiveFieldName);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const activeFieldName = useBuilderStore((s) => s.activeFieldName);
  const isActive = activeFieldName === fieldName;
  // Read overrides from BOTH legacy `__styles` (for backwards-compat
  // with templates saved during the brief two-system overlap) and the
  // canonical `_styles` map that BuilderZone's CSS injection actually
  // applies. Either path being set surfaces the indigo dot.
  const hasOverride = !!(styles && styles[fieldName] && Object.keys(styles[fieldName]).length > 0);
  // Notify both sources of truth on focus:
  //  1. Builder store — drives BuilderBottomBar's per-field controls.
  //  2. `template-edit-field` CustomEvent — drives TopContextToolbar's
  //     "Editing: X" badge AND any other listeners (e.g. PropertiesPanel
  //     scroll-to-section). This is the same event BuilderZone fires
  //     when operator clicks `[data-field]` on the canvas, so panel
  //     focus and canvas click are interchangeable activation gestures.
  const handleFocus = () => {
    setActiveFieldName(fieldName);
    const zoneId = selectedIds[0];
    if (zoneId && typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('template-edit-field', {
          detail: { zoneId, fieldKey: fieldName },
        }));
      } catch { /* CustomEvent unsupported in older runtimes */ }
    }
  };
  return (
    // 2026-06-01 — single highlight only: the inner input already shows a
    // focus ring, so the wrapper must NOT add a second ring-2 (operator:
    // "double purple outline … just highlight the field i am editing"). The
    // active state is still tracked (drives the bottom-bar styling controls +
    // the override dot) — it just no longer paints a redundant outer ring.
    <div className="relative rounded-lg transition-all">
      {hasOverride && !isActive && (
        <span
          className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-indigo-500 z-10"
          title="This field has custom text styling"
        />
      )}
      <TextField
        label={label}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        onFocus={handleFocus}
      />
    </div>
  );
}

/** Multi-line TextAreaField — same focus-driven model as StyleableField. */
function StyleableAreaField({
  label,
  value,
  placeholder,
  onChange,
  rows,
  fieldName,
  styles,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  rows?: number;
  fieldName: string;
  styles?: FieldStyleMap | undefined;
  onStylesChange?: (next: FieldStyleMap) => void;
}) {
  const setActiveFieldName = useBuilderStore((s) => s.setActiveFieldName);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const activeFieldName = useBuilderStore((s) => s.activeFieldName);
  const isActive = activeFieldName === fieldName;
  const hasOverride = !!(styles && styles[fieldName] && Object.keys(styles[fieldName]).length > 0);
  const handleFocus = () => {
    setActiveFieldName(fieldName);
    const zoneId = selectedIds[0];
    if (zoneId && typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('template-edit-field', {
          detail: { zoneId, fieldKey: fieldName },
        }));
      } catch { /* swallow */ }
    }
  };
  return (
    // 2026-06-01 — single highlight only (see StyleableField): no wrapper ring;
    // the inner textarea's own focus ring is the one highlight.
    <div className="relative rounded-lg transition-all">
      {hasOverride && !isActive && (
        <span
          className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-indigo-500 z-10"
          title="This field has custom text styling"
        />
      )}
      <TextAreaField
        label={label}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        rows={rows}
        onFocus={handleFocus}
      />
    </div>
  );
}

/**
 * PosDriverPicker — the top-level "which POS system drives this menu board"
 * picker (operator 2026-06-01: "I should be able to pick which POS system I am
 * using and then it gets applied to the correct fields automatically but I can
 * still edit them"). Shown at the TOP of the EXTERNAL_HTML editor for menu
 * boards. Picking a system flips the board to live POS (config.posSync) and
 * records the intended provider (config.posProvider). The actual catalog comes
 * from whatever POS the tenant connected in Settings → POS — the live feed
 * (usePosMenuItems) name-matches it onto the board's items, and any field stays
 * editable below as an override. CLOSED-tier providers are hidden. Defensive:
 * falls back to the known provider list if the /pos/providers call hasn't
 * resolved, so the picker is never empty.
 */
interface PosProviderLite { id: string; name: string; integrationTier: 'DIRECT' | 'PARTNER' | 'CLOSED'; iconEmoji?: string }
interface PosConnectionLite { providerId: string; status: string }
// 2026-06-06 — this fallback only renders when GET /pos/providers hasn't
// resolved, so it MUST mirror the canonical registry (POS_PROVIDERS in
// packages/api-types/src/pos.ts), minus CLOSED-tier rows the picker hides.
// The previous list had drifted: Clover was re-tiered DIRECT, and Lightspeed
// / Shopify use the ids `lightspeed-retail` / `shopify-pos` — so on an API
// blip the picker showed the wrong tier badges + ids that don't match a
// connection. Kept in sync by hand; if you add a provider in api-types,
// add it here too (or this fallback lies).
const POS_FALLBACK: PosProviderLite[] = [
  { id: 'square', name: 'Square', integrationTier: 'DIRECT', iconEmoji: '◾' },
  { id: 'toast', name: 'Toast', integrationTier: 'PARTNER', iconEmoji: '🍞' },
  { id: 'clover', name: 'Clover', integrationTier: 'DIRECT', iconEmoji: '🍀' },
  { id: 'lightspeed-retail', name: 'Lightspeed Retail', integrationTier: 'DIRECT', iconEmoji: '⚡' },
  { id: 'shopify-pos', name: 'Shopify POS', integrationTier: 'DIRECT', iconEmoji: '🛍' },
  { id: 'stripe-terminal', name: 'Stripe Terminal', integrationTier: 'PARTNER', iconEmoji: '💳' },
  { id: 'mindbody', name: 'Mindbody', integrationTier: 'PARTNER', iconEmoji: '🧘' },
  { id: 'custom-webhook', name: 'Custom Webhook', integrationTier: 'DIRECT', iconEmoji: '🔗' },
];
function PosDriverPicker({ cfg, setField }: { cfg: Record<string, unknown>; setField: (patch: Record<string, unknown>) => void }) {
  // a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control.
  const posPickerId = useId();
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId || '';
  const providersQ = useQuery<PosProviderLite[]>({ queryKey: ['pos-providers'], queryFn: () => apiFetch<PosProviderLite[]>('/pos/providers'), staleTime: 300_000, retry: false });
  const connsQ = useQuery<PosConnectionLite[]>({ queryKey: ['pos-connections'], queryFn: () => apiFetch<PosConnectionLite[]>('/pos/connections'), staleTime: 60_000, retry: false });

  const list = ((providersQ.data && providersQ.data.length ? providersQ.data : POS_FALLBACK)).filter((p) => p.integrationTier !== 'CLOSED');
  const connectedIds = new Set((connsQ.data || []).filter((c) => c.status === 'ACTIVE').map((c) => c.providerId));
  const posOn = cfg?.posSync === true || cfg?.dataSource === 'POS';
  const selected = posOn ? (typeof cfg?.posProvider === 'string' ? (cfg.posProvider as string) : '__any') : '';
  const chosen = list.find((p) => p.id === selected);
  const chosenConnected = chosen ? connectedIds.has(chosen.id) : connectedIds.size > 0;

  const onPick = (val: string) => {
    if (!val) { setField({ posSync: false, posProvider: undefined, dataSource: 'NONE' }); return; }
    setField({ posSync: true, posProvider: val === '__any' ? undefined : val, dataSource: 'POS' });
  };

  return (
    <div style={{ borderRadius: 10, border: '1px solid', borderColor: posOn ? '#b45309' : '#e2e8f0', background: posOn ? '#431407' : '#f8fafc', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: posOn ? (chosenConnected ? '#22c55e' : '#f59e0b') : '#94a3b8', marginRight: 8, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: posOn ? '#fcd34d' : '#64748b' }}>
          {posOn ? (chosenConnected ? 'LIVE FROM YOUR POS' : 'POS SELECTED — NOT CONNECTED YET') : 'STATIC MENU (NO POS)'}
        </span>
      </div>
      {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control */}
      <label htmlFor={posPickerId} className="block text-[10px] font-semibold uppercase tracking-wider" style={{ color: posOn ? '#fcd34d' : '#64748b', marginBottom: 4 }}>
        Driven by your POS
      </label>
      <select
        id={posPickerId}
        value={selected}
        onChange={(e) => onPick(e.target.value)}
        style={{ width: '100%', padding: '6px 8px', borderRadius: 6, border: '1px solid', borderColor: posOn ? '#b45309' : '#cbd5e1', background: posOn ? '#7c2d12' : '#ffffff', color: posOn ? '#fde68a' : '#334155', fontSize: 11, fontWeight: 600, cursor: 'pointer', appearance: 'auto' }}
      >
        <option value="">Static menu — type prices yourself</option>
        <option value="__any">POS — any connected system</option>
        {list.map((p) => (
          <option key={p.id} value={p.id}>{(p.iconEmoji ? `${p.iconEmoji} ` : '') + p.name}{connectedIds.has(p.id) ? ' ✓ connected' : ''}</option>
        ))}
      </select>
      {posOn && (
        <div className="text-[10px] mt-2 leading-relaxed" style={{ color: posOn ? '#fde68a' : '#64748b' }}>
          Item names, prices, descriptions &amp; photos auto-fill from your POS (matched by item name). Edit any field below to override.
          {!chosenConnected && (
            <>
              {' '}<a href={`/${schoolId}/settings/pos`} className="underline font-semibold">Connect {chosen ? chosen.name : 'your POS'} →</a>
            </>
          )}
        </div>
      )}
      <a href={`/${schoolId}/settings/pos`} className="text-[10px] underline mt-1 inline-block" style={{ color: posOn ? '#fbbf24' : '#6366f1' }}>
        Manage POS connections
      </a>
    </div>
  );
}

/**
 * ExternalHtmlTextEditor — make every data-field in a signage template
 * editable from the panel.
 *
 * The 80 signage / HS templates are self-contained HTML rendered in a
 * sandboxed iframe (no allow-same-origin), so we cannot reach into
 * them from React. Instead we fetch the template HTML (same-origin
 * static file in /public/templates), parse it with DOMParser, walk
 * every `[data-field]` to discover its key + default text, and render
 * an editable field per one. The operator's edits write to
 * cfg.textOverrides[fieldKey] — the ExternalHtmlWidget then encodes
 * that map into the `?text=` URL param, and the V2 brand shim inside
 * the iframe applies the overrides at first paint (both in the editor
 * preview and on every player at runtime).
 *
 * Style overrides flow through the same path: the StyleableField
 * wrapper threads `cfg._styles` (the shared schema HS widgets already
 * use; the editor's bottom-bar reads + writes this map). The widget's
 * URL-encoder picks up `_styles` and sends it as `?textStyles=`, so a
 * font-size or color change applied via the bottom bar is visible on
 * the iframe immediately AND propagates to every screen.
 *
 * Why fetch + parse instead of postMessage-bridge: the bridge approach
 * has a race condition (panel mounts before iframe → first message
 * lost). Static fetch + parse is deterministic — every data-field
 * shows up in the panel within ~50ms of the operator selecting the
 * EXTERNAL_HTML zone, regardless of iframe load order.
 */
// Button-wiring catalog — the operator-facing "When tapped…" choices. Each
// maps to a primitive the player's dispatchTouchAction already executes (with
// its http-only / no-private-IP / no-javascript: security gates). 'open-url'
// doubles as Phone (tel:) + Email (mailto:) since the dispatcher navigates
// those schemes directly.
const KIOSK_ACTION_TYPES: Array<{ value: string; label: string; targetPlaceholder?: string }> = [
  { value: '', label: '— Not wired (button does its normal thing) —' },
  { value: 'open-url', label: 'Open a web page / phone / email', targetPlaceholder: 'https://…  (or tel:+15551234567, mailto:hi@co.com)' },
  { value: 'webhook', label: 'Send a webhook (POS / CRM / Zapier)', targetPlaceholder: 'https://hooks.example.com/…' },
  { value: 'request-help', label: 'Notify staff (request help)', targetPlaceholder: 'Message title (optional)' },
  { value: 'play-video', label: 'Play a video', targetPlaceholder: 'Asset ID' },
  { value: 'show-overlay', label: 'Show an image / asset overlay', targetPlaceholder: 'Asset ID' },
  { value: 'goto-template', label: 'Switch to another template', targetPlaceholder: 'Template ID' },
  { value: 'reset-idle', label: 'Stay on screen (reset idle timer)' },
  { value: 'sound-toggle', label: 'Toggle sound on / off' },
];

function KioskActionRow({
  label,
  fieldKey,
  current,
  onChange,
  onFocus,
}: {
  label: string;
  fieldKey: string;
  current: { type: string; target?: string };
  onChange: (type: string, target: string) => void;
  onFocus?: () => void;
}) {
  const [target, setTarget] = useState(current.target || '');
  useEffect(() => { setTarget(current.target || ''); }, [current.target]);
  const meta = KIOSK_ACTION_TYPES.find((t) => t.value === current.type);
  const needsTarget = !!current.type && current.type !== 'reset-idle' && current.type !== 'sound-toggle';
  return (
    <div className="space-y-1" data-edit-action={fieldKey} onFocusCapture={onFocus}>
      <label className="block text-[10px] font-semibold text-slate-600">{label}</label>
      <select
        className="w-full text-[12px] rounded-md border border-slate-300 bg-white px-2 py-1.5"
        value={current.type}
        onChange={(e) => onChange(e.target.value, target)}
      >
        {KIOSK_ACTION_TYPES.map((t) => (
          <option key={t.value || 'none'} value={t.value}>{t.label}</option>
        ))}
      </select>
      {needsTarget && (
        <input
          type="text"
          className="w-full text-[12px] rounded-md border border-slate-300 bg-white px-2 py-1.5"
          placeholder={meta?.targetPlaceholder || ''}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          onBlur={() => onChange(current.type, target)}
        />
      )}
    </div>
  );
}

function ExternalHtmlTextEditor({
  cfg,
  setField,
}: {
  cfg: any;
  setField: (patch: Record<string, any>) => void;
}) {
  const url = typeof cfg?.url === 'string' ? cfg.url.trim() : '';
  // AI Designer boards carry their HTML INLINE (cfg.html, srcdoc) — no url to
  // fetch. Discover fields from that string directly; static boards fetch url.
  const inlineHtml = typeof cfg?.html === 'string' ? cfg.html.trim() : '';
  // discoveredFields: ordered list of {key, defaultText, sectionKey}
  // null = still loading, [] = no fields (or fetch failed gracefully).
  const [discoveredFields, setDiscoveredFields] = useState<
    Array<{ key: string; defaultText: string; sectionKey: string; isShortish: boolean }> | null
  >(null);
  // G3 (§19) — discoveredImages: ordered list of swappable image slots.
  // Mirrors the text discovery but for images. Each entry is keyed by the
  // template's `data-img` attr (preferred / forward-compat) OR the existing
  // `data-widget="image-slot"` convention's `data-slot` value (38 such slots
  // ship across 17 templates today — verified in public/templates). null =
  // loading, [] = none.
  const [discoveredImages, setDiscoveredImages] = useState<
    Array<{ key: string; label: string; aspect: string }> | null
  >(null);
  // Video slots use a dedicated override map so the asset picker can enforce
  // video MIME types instead of pretending a clip is an image URL. Posters
  // remain image slots via data-posterslot and are edited independently.
  const [discoveredVideos, setDiscoveredVideos] = useState<
    Array<{ key: string; label: string; aspect: string }> | null
  >(null);
  // Button wiring (operator: "wire our touch content manager to each button").
  // discoveredActions: leaf buttons marked [data-action] that can fire a
  // PLATFORM touch-action (open-url, webhook, request-help, …). The shim posts
  // educms-action on tap in the player; the player runs it via dispatchTouchAction.
  const [discoveredActions, setDiscoveredActions] = useState<
    Array<{ key: string; label: string }> | null
  >(null);

  useEffect(() => {
    if (!url && !inlineHtml) {
      setDiscoveredFields([]);
      setDiscoveredImages([]); setDiscoveredVideos([]); setDiscoveredActions([]);
      return;
    }
    let cancelled = false;
    setDiscoveredFields(null);
    setDiscoveredImages(null); setDiscoveredVideos(null); setDiscoveredActions(null);
    // Inline (AI Designer) → parse cfg.html directly; url board → fetch it.
    const htmlSource: Promise<string> = inlineHtml
      ? Promise.resolve(inlineHtml)
      : fetch(url, { credentials: 'omit' }).then((res) => (res.ok ? res.text() : ''));
    htmlSource
      .then((html) => {
        if (cancelled) return;
        if (!html) {
          setDiscoveredFields([]);
          setDiscoveredImages([]); setDiscoveredVideos([]); setDiscoveredActions([]);
          return;
        }
        try {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const seen = new Set<string>();
          const out: Array<{ key: string; defaultText: string; sectionKey: string; isShortish: boolean }> = [];
          const nodes = doc.querySelectorAll('[data-field]');
          nodes.forEach((el) => {
            const key = (el as HTMLElement).getAttribute('data-field');
            if (!key || seen.has(key)) return;
            seen.add(key);
            // Use the FIRST text node only — many fields wrap nested
            // child elements (e.g. <small>) we don't want to flatten
            // into the editable text. Falls back to textContent for
            // simple leaf elements.
            let defaultText = '';
            for (let i = 0; i < el.childNodes.length; i++) {
              const c = el.childNodes[i];
              if (c.nodeType === 3) {
                defaultText = (c.textContent || '').trim();
                if (defaultText) break;
              }
            }
            if (!defaultText) defaultText = (el.textContent || '').trim();
            const dotIdx = key.indexOf('.');
            const sectionKey = dotIdx > 0 ? key.slice(0, dotIdx) : key;
            const isShortish = defaultText.length < 60;
            out.push({ key, defaultText, sectionKey, isShortish });
          });
          setDiscoveredFields(out);

          // G3 — image-slot discovery. The shipped templates mark a
          // replaceable photo with `data-widget="image-slot"` + a unique
          // `data-slot="<key>"`; we ALSO honor a literal `data-img="<key>"`
          // (forward-compat). Key precedence: data-img → data-slot. The
          // shim (inject-shim-v2.cjs) applies the override to the element
          // with the matching key, so editor key === render key === shim key.
          const imgSeen = new Set<string>();
          const imgOut: Array<{ key: string; label: string; aspect: string }> = [];
          // Flagship templates mark a photo slot with `data-imgslot="<key>"`
          // and hold its URL in that element's own `data-img` attr (the
          // template paints it). So data-imgslot wins as the KEY; for the older
          // convention, data-slot / data-img IS the key. (V4 shim applies by
          // the same precedence.)
          const imgNodes = doc.querySelectorAll('[data-imgslot],[data-posterslot],[data-img],[data-widget="image-slot"]');
          imgNodes.forEach((el) => {
            const e = el as HTMLElement;
            const key = e.getAttribute('data-imgslot') || e.getAttribute('data-posterslot') || e.getAttribute('data-slot') || e.getAttribute('data-img') || '';
            if (!key || imgSeen.has(key)) return;
            imgSeen.add(key);
            // Friendly label: the slot's caption text (e.g. "Group portrait"),
            // else the key humanized.
            const lblNode = e.querySelector('.lbl, .label, figcaption');
            const label = (lblNode?.textContent || '').trim() || prettyFieldLabel(key);
            const aspect = e.getAttribute('data-aspect') || '';
            imgOut.push({ key, label, aspect });
          });
          setDiscoveredImages(imgOut);

          // First-class replaceable video sources. A template marks the
          // playable <video> (or its <source>) with data-videoslot. The poster
          // is intentionally a separate data-posterslot image hook so schools
          // can replace either asset without coupling the two.
          const videoSeen = new Set<string>();
          const videoOut: Array<{ key: string; label: string; aspect: string }> = [];
          doc.querySelectorAll('[data-videoslot]').forEach((el) => {
            const e = el as HTMLElement;
            const key = e.getAttribute('data-videoslot') || '';
            if (!key || videoSeen.has(key)) return;
            videoSeen.add(key);
            const lblNode = e.querySelector('.lbl, .label, figcaption');
            const label = (lblNode?.textContent || '').trim() || prettyFieldLabel(key);
            const aspect = e.getAttribute('data-aspect') || '';
            videoOut.push({ key, label, aspect });
          });
          setDiscoveredVideos(videoOut);

          // Button wiring — discover [data-action] leaf buttons. Static parse,
          // same as text/images. The button's own text is the friendly label.
          const actSeen = new Set<string>();
          const actOut: Array<{ key: string; label: string }> = [];
          doc.querySelectorAll('[data-action]').forEach((el) => {
            const e = el as HTMLElement;
            const key = e.getAttribute('data-action') || '';
            if (!key || actSeen.has(key) || e.closest('#venueos-fields')) return;
            actSeen.add(key);
            const label = (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) || prettyFieldLabel(key);
            actOut.push({ key, label });
          });
          setDiscoveredActions(actOut);
        } catch {
          setDiscoveredFields([]);
          setDiscoveredImages([]); setDiscoveredVideos([]); setDiscoveredActions([]);
        }
      })
      .catch(() => {
        if (!cancelled) { setDiscoveredFields([]); setDiscoveredImages([]); setDiscoveredVideos([]); setDiscoveredActions([]); }
      });
    return () => { cancelled = true; };
  }, [url, inlineHtml]);

  // 2026-06-01 — board → panel "hot zones" (the operator's actual ask:
  // "click a section and have it jump to the editable area"). The board
  // lives in a sandboxed null-origin iframe, so clicks can't bubble to
  // React — instead the in-board shim posts {type:'educms-field-click',
  // key, kind} out when an editable element is clicked, and we scroll +
  // focus the matching field row here. We also flip the iframe into edit
  // mode (enables its hover hot-zones + click reporting) the moment this
  // editor mounts, and re-arm it whenever the iframe announces it
  // (re)loaded via {type:'educms-ready'} — covering the remount-on-edit
  // race. Edit mode is NEVER sent on the player, so a live sign stays
  // non-interactive.
  //
  // MUST stay ABOVE the early-returns below (loading / no-fields guards):
  // a hook placed after a conditional return runs a different number of
  // times across renders → "Rendered more hooks than during the previous
  // render" → the whole builder route crashes the moment field discovery
  // completes. (Regression fixed 2026-06-01 after the Domino's board
  // crash on Customize.)
  useEffect(() => {
    const base = url.split('?')[0];
    const sendEditMode = () => {
      try {
        document.querySelectorAll('iframe[title="Signage template"],iframe[title="AI-designed signage board"]').forEach((f) => {
          const fr = f as HTMLIFrameElement;
          try {
            if (base && fr.src && !fr.src.includes(base)) return;
            fr.contentWindow?.postMessage({ type: 'educms-edit-mode', on: true }, '*');
          } catch { /* detached — ignore */ }
        });
      } catch { /* no-op */ }
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; key?: string; kind?: string } | null;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'educms-ready') {
        try { (e.source as Window | null)?.postMessage({ type: 'educms-edit-mode', on: true }, '*'); } catch { /* ignore */ }
        return;
      }
      if (d.type === 'educms-field-click' && typeof d.key === 'string') {
        const safeKey = d.key.replace(/"/g, '');
        // kind:'media' is a value that can only come from a connected
        // source — a now-playing track, a provider, an audio zone. There
        // is no text row to jump to, and inventing one is the bug. Send
        // the operator to the integration picker instead: the fix has to
        // be reachable from the thing that is wrong.
        // The board reports `kind` from the attribute it found, and an
        // element marked BOTH `data-field` and `data-imgslot` reports
        // 'text' — but that photo is edited in the Images block, so its
        // text row does not exist. Try every lane for the key rather than
        // dropping the click on the floor (the "I clicked the photo and
        // nothing happened" half of the 2026-08-25 report).
        const lanes = d.kind === 'media'
          ? ['[data-edit-media]']
          : d.kind === 'action'
          ? [`[data-edit-action="${safeKey}"]`]
          : d.kind === 'video'
          ? [`[data-edit-video="${safeKey}"]`, `[data-edit-img="${safeKey}"]`, `[data-edit-field="${safeKey}"]`]
          : d.kind === 'img'
          ? [`[data-edit-img="${safeKey}"]`, `[data-edit-video="${safeKey}"]`, `[data-edit-field="${safeKey}"]`]
          : [`[data-edit-field="${safeKey}"]`, `[data-edit-img="${safeKey}"]`, `[data-edit-video="${safeKey}"]`];
        let row: HTMLElement | null = null;
        for (const sel of lanes) {
          try { row = document.querySelector(sel); } catch { row = null; }
          if (row) break;
        }
        if (!row) return;
        row.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const input = row.querySelector('input,textarea,select,button') as HTMLElement | null;
        if (input) { try { input.focus({ preventScroll: true }); } catch { input.focus(); } }
        const el = row;
        const prev = el.style.outline;
        el.style.outline = '2px solid #06b6d4';
        el.style.outlineOffset = '2px';
        el.style.borderRadius = '8px';
        window.setTimeout(() => { el.style.outline = prev; el.style.outlineOffset = ''; }, 1500);
      }
    };
    window.addEventListener('message', onMsg);
    sendEditMode();
    const t1 = window.setTimeout(sendEditMode, 400);
    const t2 = window.setTimeout(sendEditMode, 1200);
    return () => { window.removeEventListener('message', onMsg); window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [url]);

  // Pull current overrides + styles map. textOverrides is the canonical
  // per-key string map (what the V2 shim applies); _styles is the
  // canonical per-key inline-style map (HS schema, also applied by the
  // V2 shim via the textStyles URL param).
  const textOverrides: Record<string, string> =
    (cfg?.textOverrides && typeof cfg.textOverrides === 'object') ? cfg.textOverrides : {};
  const styles: FieldStyleMap =
    (cfg?._styles && typeof cfg._styles === 'object') ? (cfg._styles as FieldStyleMap) : {};
  // G3 — imageOverrides: per-slot URL map the V2 shim applies as
  // background-image / src on the matching [data-img]/[data-slot] element.
  const imageOverrides: Record<string, string> =
    (cfg?.imageOverrides && typeof cfg.imageOverrides === 'object') ? cfg.imageOverrides : {};
  const videoOverrides: Record<string, string> =
    (cfg?.videoOverrides && typeof cfg.videoOverrides === 'object') ? cfg.videoOverrides : {};

  // AI Designer boards have no url (inline srcdoc) — only show the "pick a
  // template" placeholder when there's NEITHER a url NOR inline html. Without
  // the inlineHtml escape, designer boards short-circuit here and the
  // discovered fields below never render (the 2026-06-29 "0 editable rows" bug).
  if (!url && !inlineHtml) {
    return (
      <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-500">
        Pick a template above to expose its editable text.
      </div>
    );
  }
  if (discoveredFields === null || discoveredImages === null || discoveredVideos === null || discoveredActions === null) {
    return (
      <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-500">
        Scanning template…
      </div>
    );
  }
  if (discoveredFields.length === 0 && discoveredImages.length === 0 && discoveredVideos.length === 0 && discoveredActions.length === 0) {
    return (
      <div className="px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800">
        This template has no editable text, image, or video hooks yet. Recolor / restyle via the controls below; we&apos;ll add inline editing to this template in a future update.
      </div>
    );
  }

  // ── Repeating groups (2026-08-25) ────────────────────────────────
  // Operator: "if i want to add a 4th event i should be able to and the
  // cards resize… they need to just work no matter what the user is
  // trying to do."
  //
  // A board that ships `event.0.name` … `event.2.name` already declares
  // a list; nothing extra has to be marked up. Count the contiguous
  // indices per prefix and that is the authored length. The shim grows
  // or shrinks the real DOM (see EDUCMS-SHIM-V11) and distributes the
  // height across however many rows there are.
  const repeatGroups: Array<{ group: string; authored: number; leaves: string[] }> = [];
  {
    const byGroup: Record<string, { idx: Set<number>; leaves: Set<string> }> = {};
    for (const f of discoveredFields) {
      const m = /^([A-Za-z][\w-]*)\.(\d+)\.(.+)$/.exec(f.key);
      if (!m) continue;
      const g = (byGroup[m[1]] ||= { idx: new Set(), leaves: new Set() });
      g.idx.add(Number(m[2]));
      g.leaves.add(m[3]);
    }
    for (const [group, g] of Object.entries(byGroup)) {
      const idx = [...g.idx].sort((a, b) => a - b);
      if (idx.length < 2) continue;
      // Contiguous only — a gap means these are not one list.
      if (idx.some((n, i) => i > 0 && n !== idx[i - 1] + 1)) continue;
      repeatGroups.push({ group, authored: idx.length, leaves: [...g.leaves] });
    }
  }
  const repeatCounts: Record<string, number> =
    (cfg?.repeatCounts && typeof cfg.repeatCounts === 'object') ? cfg.repeatCounts as Record<string, number> : {};

  // A row the operator just added has no fields in the board HTML — it is
  // cloned at render time — so synthesize its keys here. Without this you
  // can add a 4th event and have nothing to type into it.
  const fieldsWithAddedRows = (() => {
    const extra: typeof discoveredFields = [];
    for (const rg of repeatGroups) {
      const want = repeatCounts[rg.group];
      if (typeof want !== 'number' || want <= rg.authored) continue;
      const base = discoveredFields.find((f) => f.key.startsWith(`${rg.group}.`));
      const firstIdx = base ? Number(/^[^.]+\.(\d+)\./.exec(base.key)?.[1] ?? 0) : 0;
      for (let n = rg.authored; n < want; n += 1) {
        for (const leaf of rg.leaves) {
          const key = `${rg.group}.${firstIdx + n}.${leaf}`;
          if (discoveredFields.some((f) => f.key === key)) continue;
          extra.push({ key, defaultText: '', sectionKey: rg.group, isShortish: true });
        }
      }
    }
    return extra.length ? [...discoveredFields, ...extra] : discoveredFields;
  })();

  // A photo slot is edited ONCE, in the Images block above.
  //
  // 14 boards mark the same element with BOTH `data-field="hero.photo_url"`
  // AND `data-widget="image-slot"`, so the operator got a real picker under
  // Images *and* a bare text box for the same photo further down — two
  // controls for one thing, one of which does nothing useful. The slot
  // lanes own those keys; the text lane skips them.
  const mediaSlotKeys = new Set<string>([
    ...discoveredImages.map((i) => i.key),
    ...discoveredVideos.map((v) => v.key),
  ]);

  // Group by sectionKey so a 70-field template (QSR drive-thru) shows
  // sections instead of a 70-row flat list.
  const sections: Record<string, typeof discoveredFields> = {};
  for (const f of fieldsWithAddedRows) {
    if (mediaSlotKeys.has(f.key)) continue;
    if (!sections[f.sectionKey]) sections[f.sectionKey] = [];
    sections[f.sectionKey].push(f);
  }
  // ── Board settings (2026-08-21) — operator: "the time and date on these
  // templates has way too many fields and the time zone is free text…"
  // The boards' hidden config spans (clock / carousel / video / media /
  // motion) are real data-fields, so they rendered as a wall of cryptic
  // free-text inputs. They are CONFIGURATION, not copy: pull the exact keys
  // out of the generic sections and render curated controls (dropdowns,
  // checkboxes, numbers) below. Everything still writes the same
  // textOverrides transport the boards already read — no new protocol.
  // Unknown keys under those prefixes (e.g. a visible `video.status` label)
  // stay in the generic list untouched.
  const cfgDefaults: Record<string, string> = {};
  for (const sec of Object.keys(sections)) {
    const kept: typeof discoveredFields = [];
    for (const f of sections[sec]) {
      if (BOARD_CONFIG_KEYS.has(f.key)) cfgDefaults[f.key] = f.defaultText;
      else kept.push(f);
    }
    if (kept.length) sections[sec] = kept;
    else delete sections[sec];
  }
  const sectionOrder = Object.keys(sections);
  const hasCfg = (k: string) => k in cfgDefaults;

  const setOverride = (key: string, value: string, defaultText: string) => {
    const next = { ...textOverrides };
    // AN EMPTY FIELD IS A VALUE, NOT A RESET.
    //
    // This used to delete the override when the input went empty, on the
    // theory that clearing a field is how you ask for the template's own
    // copy back. In practice it made a field impossible to retype: the
    // input renders `textOverrides[key] ?? defaultText`, so the instant
    // you deleted the LAST character the override vanished and the
    // original copy sprang back into both the input and the board. You
    // could never get to an empty box to type your own name into.
    // (Reported on the worship welcome board: deleting the church name
    // one letter at a time, then watching the old name reappear.)
    //
    // Empty now means empty. Typing the template's own text back still
    // clears the override — that genuinely IS the uncustomized state, and
    // it keeps the config free of no-op entries — and the Reset control
    // on each row restores the original copy for anyone who wants it.
    if (value === defaultText) {
      delete next[key];
    } else {
      next[key] = value;
    }
    setField({ textOverrides: Object.keys(next).length ? next : undefined });
  };
  /** Put a field back to the copy the template ships with. */
  const resetOverride = (key: string) => {
    const next = { ...textOverrides };
    delete next[key];
    setField({ textOverrides: Object.keys(next).length ? next : undefined });
  };
  // Board-settings writes. One PATCH → one setField commit: the naive
  // "call setOverride twice" would build both `next` maps from the SAME
  // stale textOverrides prop inside a single event handler, and the second
  // write would silently drop the first (the time-style control writes
  // clock.mode AND clock.hour12 together). Values equal to the board's own
  // default are removed, so untouched settings never bloat the config.
  const setCfgMany = (patch: Record<string, string>) => {
    const next = { ...textOverrides };
    for (const [k, v] of Object.entries(patch)) {
      const dflt = cfgDefaults[k] ?? '';
      if (!v || v === dflt) delete next[k];
      else next[k] = v;
    }
    setField({ textOverrides: Object.keys(next).length ? next : undefined });
  };
  const cfgVal = (k: string, fb = ''): string => (textOverrides[k] ?? cfgDefaults[k] ?? fb);
  const cfgOn = (k: string, fb = 'yes'): boolean => !BOARD_OFFISH.test(cfgVal(k, fb) || fb);
  const clockStyle: 'live12' | 'live24' | 'fixed' =
    /^(manual|static)$/i.test(cfgVal('clock.mode', 'live')) ? 'fixed'
      : BOARD_OFFISH.test(cfgVal('clock.hour12', 'yes')) ? 'live24' : 'live12';
  const setStylesMap = (s: FieldStyleMap) => {
    setField({ _styles: Object.keys(s).length ? s : undefined });
  };
  // E6 — hide/show a field on the rendered board (CRUSH Wave E, 2026-07-03).
  // THE BUG: clearing a field's text via setOverride deletes its
  // textOverrides entry, so the BOARD'S OWN DEFAULT COPY resurfaces — an
  // operator had no way to actually blank an element. FIX: toggle
  // `styles[key].hidden` in the SAME `_styles` override map the color/
  // font-size controls already write. The packaged-board shim
  // (inject-shim-v2.cjs EDUCMS-SHIM-V7) reads that key and sets
  // `display:none` (or clears it back to the template's own CSS) — no new
  // transport, no new postMessage type, reversible with one more click.
  const toggleFieldHidden = (key: string) => {
    const current = styles[key] || {};
    const next: FieldStyleMap = { ...styles };
    if (current.hidden) {
      // Un-hide: drop the whole per-field entry if hidden was the only
      // override set, else just clear the hidden flag.
      const { hidden: _drop, ...rest } = current;
      if (Object.keys(rest).length) next[key] = rest;
      else delete next[key];
    } else {
      next[key] = { ...current, hidden: true };
    }
    setStylesMap(next);
  };
  // G3 — set / clear a per-slot image override. Empty value removes the
  // key so the template's own placeholder shows through again.
  const setImageOverride = (key: string, value: string) => {
    const next = { ...imageOverrides };
    if (!value || !value.trim()) delete next[key];
    else next[key] = value.trim();
    setField({ imageOverrides: Object.keys(next).length ? next : undefined });
  };
  const setVideoOverride = (key: string, value: string) => {
    const next = { ...videoOverrides };
    if (!value || !value.trim()) delete next[key];
    else next[key] = value.trim();
    setField({ videoOverrides: Object.keys(next).length ? next : undefined });
  };

  // Button wiring — per-[data-action] platform action map. Stored as
  // actionOverrides[key] = { type, target? }; WidgetRenderer encodes it as
  // ?actions=, the shim posts educms-action on tap, the player runs it via
  // dispatchTouchAction. Empty type clears the wiring (button reverts to its
  // own kiosk behavior). 'open-url' with a tel:/mailto: target = phone/email.
  const actionOverrides: Record<string, { type: string; target?: string }> =
    (cfg?.actionOverrides && typeof cfg.actionOverrides === 'object') ? cfg.actionOverrides : {};
  const setActionOverride = (key: string, type: string, target: string) => {
    const next = { ...actionOverrides };
    if (!type) {
      delete next[key];
    } else {
      const needsTarget = !['reset-idle', 'sound-toggle'].includes(type);
      next[key] = needsTarget && target.trim() ? { type, target: target.trim() } : { type };
    }
    setField({ actionOverrides: Object.keys(next).length ? next : undefined });
  };

  // ── 2026-05-29 — BYO field-binding to a live POS item ──────────────
  // A BYO / signage template's text field can be BOUND to a specific
  // catalog item so it auto-fills the live (per-location) value:
  // a price field → `{{pos.item:<externalId>.price}}`, a name →
  // `.name`, an availability flag → `.available`. The binding is stored
  // in cfg.posItemBindings[fieldKey] for the picker UI, AND mirrored as
  // the token string in textOverrides[fieldKey] so it rides the EXISTING
  // `?text=` transport to the server + player unchanged — the server
  // resolves the token per the screen's location at render time.
  // POS "connected" for THIS board — the per-field bind control is an
  // OVERRIDE that only appears once the top-level "Driven by: POS" toggle is on
  // (cfg.posSync). Mirrors the CTS model (auto-map first; override only if the
  // name-match is wrong) instead of cluttering every field with a bind control
  // even when no POS is connected (operator: "stop reinventing the wheel").
  const posSyncOn = (cfg as Record<string, unknown> | null)?.posSync === true
    || (cfg as Record<string, unknown> | null)?.dataSource === 'POS';
  const posBindings: Record<string, { externalId: string; field: 'price' | 'name' | 'available' }> =
    (cfg?.posItemBindings && typeof cfg.posItemBindings === 'object') ? cfg.posItemBindings : {};
  const setPosBinding = (
    key: string,
    binding: { externalId: string; field: 'price' | 'name' | 'available' } | null,
  ) => {
    const nextBindings = { ...posBindings };
    const nextOverrides = { ...textOverrides };
    if (!binding) {
      // Unbind: drop the binding AND the token from textOverrides so the
      // field reverts to the template default (or a manual override the
      // operator types next).
      delete nextBindings[key];
      if (typeof nextOverrides[key] === 'string' && nextOverrides[key].startsWith('{{pos.item:')) {
        delete nextOverrides[key];
      }
    } else {
      nextBindings[key] = binding;
      // The token the server/player shim resolves per-location.
      nextOverrides[key] = `{{pos.item:${binding.externalId}.${binding.field}}}`;
    }
    setField({
      posItemBindings: Object.keys(nextBindings).length ? nextBindings : undefined,
      textOverrides: Object.keys(nextOverrides).length ? nextOverrides : undefined,
    });
  };

  // 2026-06-01 — click-to-locate ("hot zones"). Operator: "there are no hot
  // zones on the template so it doesnt move to the area i click to edit."
  // When a field/image row gets focus, postMessage the field key into the
  // template iframe (matched by src) where the shim's highlightField()
  // scrolls to + flashes that exact element. Sandboxed allow-scripts frames
  // still receive postMessage (null origin), so this works in the editor
  // preview AND on any player. No-op for templates whose shim predates the
  // educms-highlight handler — safe to call unconditionally.
  const pingHighlight = (key: string) => {
    if (!key) return;
    const base = url.split('?')[0];
    try {
      document.querySelectorAll('iframe[title="Signage template"]').forEach((f) => {
        const fr = f as HTMLIFrameElement;
        try {
          if (base && fr.src && !fr.src.includes(base)) return;
          fr.contentWindow?.postMessage({ type: 'educms-highlight', key }, '*');
        } catch { /* detached / cross-origin — ignore */ }
      });
    } catch { /* no-op */ }
  };

  return (
    <div className="space-y-3">
      {discoveredVideos.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white/70 p-3 space-y-2">
          <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200 pb-1">
            Videos
          </div>
          {discoveredVideos.map((vid) => (
            <div
              key={`video:${vid.key}`}
              data-edit-video={vid.key}
              onFocusCapture={() => pingHighlight(vid.key)}
              onClickCapture={() => pingHighlight(vid.key)}
            >
              <AssetPickerField
                label={vid.aspect ? `${vid.label} (${vid.aspect})` : vid.label}
                kind="video"
                value={videoOverrides[vid.key] || ''}
                onChange={(v) => setVideoOverride(vid.key, v)}
              />
            </div>
          ))}
        </div>
      )}
      {/* G3 — image slots. Rendered first so a hero photo is the operator's
          top edit. AssetPickerField supports both the asset library AND a
          pasted URL (its built-in URL input), satisfying the §19 "asset
          picker OR URL paste" requirement. */}
      {discoveredImages.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white/70 p-3 space-y-2">
          <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200 pb-1">
            Images
          </div>
          {discoveredImages.map((img) => {
            // A QR slot (key contains "qr", e.g. scan.qr / product.qr) gets the
            // paste-a-URL → auto-generate control, plus the normal picker as a
            // manual fallback (upload your own QR image).
            const isQr = /(^|[.\-_])qr([.\-_]|$)|qrcode/i.test(img.key);
            return (
              <div
                key={`img:${img.key}`}
                data-edit-img={img.key}
                onFocusCapture={() => pingHighlight(img.key)}
                onClickCapture={() => pingHighlight(img.key)}
                className="space-y-2"
              >
                {isQr && (
                  <QrUrlField
                    label={`${img.label} — from a link`}
                    value={imageOverrides[img.key] || ''}
                    onChange={(v) => setImageOverride(img.key, v)}
                  />
                )}
                <AssetPickerField
                  label={isQr ? 'Or pick a QR image' : img.aspect ? `${img.label} (${img.aspect})` : img.label}
                  kind="image"
                  value={imageOverrides[img.key] || ''}
                  onChange={(v) => setImageOverride(img.key, v)}
                />
              </div>
            );
          })}
        </div>
      )}
      {hasCfg('clock.timeZone') && (
        <div className="rounded-xl border border-slate-200 bg-white/70 p-3 space-y-2" data-edit-field="clock.time">
          <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200 pb-1">
            Clock
          </div>
          <SettingSelect
            label="Time zone"
            value={cfgVal('clock.timeZone', '')}
            options={BOARD_TIMEZONES}
            onChange={(v) => setCfgMany({ 'clock.timeZone': v })}
          />
          <SettingSelect
            label="Time style"
            value={clockStyle}
            options={[
              ['live12', '2:30 PM — live, 12-hour'],
              ['live24', '14:30 — live, 24-hour'],
              ['fixed', 'Fixed text — always show what I type'],
            ]}
            onChange={(v) =>
              v === 'fixed'
                ? setCfgMany({ 'clock.mode': 'manual' })
                : setCfgMany({ 'clock.mode': 'live', 'clock.hour12': v === 'live24' ? 'no' : 'yes' })
            }
          />
          {clockStyle === 'fixed' && (
            <TextField
              label="Clock text"
              value={cfgVal('clock.time')}
              placeholder="7:58 PM"
              onChange={(v) => setCfgMany({ 'clock.time': v })}
            />
          )}
        </div>
      )}
      {hasCfg('carousel.intervalSeconds') && (
        <div className="rounded-xl border border-slate-200 bg-white/70 p-3 space-y-2">
          <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200 pb-1">
            Slideshow
          </div>
          <SettingCheck label="Rotate slides automatically" checked={cfgOn('carousel.autoplay')} onChange={(on) => setCfgMany({ 'carousel.autoplay': on ? 'yes' : 'no' })} />
          <SettingNumber label="Seconds per slide" value={cfgVal('carousel.intervalSeconds', '6')} min={3} max={30} onChange={(v) => setCfgMany({ 'carousel.intervalSeconds': v })} />
          <SettingSelect label="Start on slide" value={cfgVal('carousel.initialIndex', '1')} options={[['1', 'Slide 1'], ['2', 'Slide 2'], ['3', 'Slide 3']]} onChange={(v) => setCfgMany({ 'carousel.initialIndex': v })} />
          <SettingCheck label="Show the slide buttons" checked={cfgOn('carousel.showProgress')} onChange={(on) => setCfgMany({ 'carousel.showProgress': on ? 'yes' : 'no' })} />
          {hasCfg('media.fit') && (
            <>
              <SettingSelect label="Photo crop" value={cfgVal('media.fit', 'cover')} options={[['cover', 'Fill the frame (crops edges)'], ['contain', 'Show the whole photo (may letterbox)']]} onChange={(v) => setCfgMany({ 'media.fit': v })} />
              <div className="grid grid-cols-2 gap-2">
                <SettingSelect label="Focus — horizontal" value={cfgVal('media.positionX', '50%')} options={[['0%', 'Left'], ['50%', 'Center'], ['100%', 'Right']]} onChange={(v) => setCfgMany({ 'media.positionX': v })} />
                <SettingSelect label="Focus — vertical" value={cfgVal('media.positionY', '50%')} options={[['0%', 'Top'], ['50%', 'Center'], ['100%', 'Bottom']]} onChange={(v) => setCfgMany({ 'media.positionY': v })} />
              </div>
            </>
          )}
        </div>
      )}
      {hasCfg('video.playbackRate') && (
        <div className="rounded-xl border border-slate-200 bg-white/70 p-3 space-y-2">
          <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200 pb-1">
            Video playback
          </div>
          <SettingCheck label="Play automatically" checked={cfgOn('video.autoplay')} onChange={(on) => setCfgMany({ 'video.autoplay': on ? 'yes' : 'no' })} />
          <SettingCheck label="Loop" checked={cfgOn('video.loop')} onChange={(on) => setCfgMany({ 'video.loop': on ? 'yes' : 'no' })} />
          <SettingCheck label="Muted (screens require this for autoplay)" checked={cfgOn('video.muted')} onChange={(on) => setCfgMany({ 'video.muted': on ? 'yes' : 'no' })} />
          <SettingSelect label="Speed" value={cfgVal('video.playbackRate', '1')} options={[['0.5', '0.5× — half speed'], ['0.75', '0.75×'], ['1', 'Normal'], ['1.25', '1.25×'], ['1.5', '1.5×'], ['2', '2× — double speed']]} onChange={(v) => setCfgMany({ 'video.playbackRate': v })} />
          <SettingNumber label="Start at (seconds in)" value={cfgVal('video.startSeconds', '0')} min={0} max={600} onChange={(v) => setCfgMany({ 'video.startSeconds': v })} />
          <SettingSelect label="Video crop" value={cfgVal('video.fit', 'cover')} options={[['cover', 'Fill the frame (crops edges)'], ['contain', 'Show the whole video (may letterbox)']]} onChange={(v) => setCfgMany({ 'video.fit': v })} />
          <div className="grid grid-cols-2 gap-2">
            <SettingSelect label="Focus — horizontal" value={cfgVal('video.positionX', '50%')} options={[['0%', 'Left'], ['50%', 'Center'], ['100%', 'Right']]} onChange={(v) => setCfgMany({ 'video.positionX': v })} />
            <SettingSelect label="Focus — vertical" value={cfgVal('video.positionY', '50%')} options={[['0%', 'Top'], ['50%', 'Center'], ['100%', 'Bottom']]} onChange={(v) => setCfgMany({ 'video.positionY': v })} />
          </div>
        </div>
      )}
      {sectionOrder.map((sec) => (
        <div key={sec} className="rounded-xl border border-slate-200 bg-white/70 p-3 space-y-2">
          <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200 pb-1">
            {prettySectionLabel(sec)}
          </div>
          {/* A repeating list gets a count control right above its rows. */}
          {repeatGroups.filter((rg) => rg.group === sec).map((rg) => (
            <RepeatCountField
              key={`repeat-${rg.group}`}
              group={rg.group}
              authored={rg.authored}
              value={repeatCounts[rg.group] ?? rg.authored}
              onChange={(n) => {
                const next = { ...repeatCounts };
                if (n === rg.authored) delete next[rg.group];
                else next[rg.group] = n;
                setField({ repeatCounts: Object.keys(next).length ? next : undefined });
              }}
            />
          ))}
          {sections[sec].map((f) => {
            const label = prettyFieldLabel(f.key);
            const binding = posBindings[f.key];
            // BOUND fields render a live-binding chip instead of an
            // editable input — the value comes from the connected POS
            // item per location, so a free-text box would be misleading.
            if (binding) {
              return (
                <PosItemBindField
                  key={f.key}
                  label={label}
                  binding={binding}
                  onBind={(b) => setPosBinding(f.key, b)}
                />
              );
            }
            const current = textOverrides[f.key] ?? f.defaultText;
            // A photo the board declared as a plain `data-field` gets the
            // real picker — upload, pick from the library, or paste a URL —
            // writing the SAME textOverrides[key] the board already reads.
            // (See isImageishField: leaf token AND value must agree, so
            // "Program · Image" becomes a picker while `theme.bg` = "#0a0806"
            // and `hero.eyebrow` stay the text boxes they are.)
            if (isImageishField(f.key, current)) {
              return (
                <div
                  key={f.key}
                  data-edit-field={f.key}
                  onFocusCapture={() => pingHighlight(f.key)}
                  onClickCapture={() => pingHighlight(f.key)}
                >
                  <AssetPickerField
                    label={label}
                    kind="image"
                    value={current}
                    onChange={(v) => setOverride(f.key, v, f.defaultText)}
                  />
                </div>
              );
            }
            // E6 — is this field hidden on the board right now?
            const isHidden = !!styles[f.key]?.hidden;
            // Long text → textarea; short → single-line input. Heuristic
            // is just len < 60 in the source default; works well across
            // titles (short), descriptions (medium), and copy blocks
            // (long, multi-line).
            return (
              <div
                key={f.key}
                className={`space-y-1 rounded-lg ${isHidden ? 'opacity-50' : ''}`}
                data-edit-field={f.key}
                onFocusCapture={() => pingHighlight(f.key)}
              >
                {/* E6 — hide/show toggle, own row above the field so it never
                    overlaps the label or input. One click sets
                    `_styles[key].hidden` (applied by the packaged-board shim
                    as display:none); a second click clears it and the
                    element reappears. Dims the whole row (opacity-50 above)
                    so a hidden field reads as hidden in the panel too, not
                    just on the board. */}
                <div className="flex items-center justify-end gap-1 -mb-1">
                  {/* Restores the template's own copy. This is the affordance
                      that used to be "clear the input", which cost the
                      operator the ability to empty a field at all. */}
                  {f.key in textOverrides && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); resetOverride(f.key); }}
                      className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
                      title={`Put back the template's text: "${f.defaultText.slice(0, 60)}"`}
                      aria-label={`Reset ${label} to the template text`}
                    >
                      <RotateCcw className="w-3 h-3" /> Reset
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleFieldHidden(f.key); }}
                    className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-md transition-colors ${
                      isHidden
                        ? 'text-amber-700 bg-amber-100 hover:bg-amber-200'
                        : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                    }`}
                    title={isHidden ? 'Hidden on the board — click to show' : 'Hide this element on the board'}
                    aria-label={isHidden ? `Show ${label}` : `Hide ${label}`}
                    aria-pressed={isHidden}
                  >
                    {isHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                    {isHidden ? 'Hidden' : ''}
                  </button>
                </div>
                {f.isShortish ? (
                  <StyleableField
                    fieldName={f.key}
                    styles={styles}
                    onStylesChange={setStylesMap}
                    label={label}
                    value={current}
                    placeholder={f.defaultText}
                    onChange={(v) => setOverride(f.key, v, f.defaultText)}
                  />
                ) : (
                  <StyleableAreaField
                    fieldName={f.key}
                    styles={styles}
                    onStylesChange={setStylesMap}
                    label={label}
                    value={current}
                    placeholder={f.defaultText}
                    rows={3}
                    onChange={(v) => setOverride(f.key, v, f.defaultText)}
                  />
                )}
                {isHidden && (
                  <div className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1">
                    Hidden on the board — text edits above still save, they just won&apos;t show until you click the eye to restore it.
                  </div>
                )}
                {/* BYO binding OVERRIDE — bind this field to a specific live
                    POS item when the auto name-match is wrong. Only on short
                    fields (price/name/availability) AND only once POS is
                    connected at the top level, so it reads as an override of
                    the auto-map, not a primary action. */}
                {f.isShortish && posSyncOn && (
                  <PosItemBindField
                    label={label}
                    binding={undefined}
                    onBind={(b) => setPosBinding(f.key, b)}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
      {/* Button wiring — "When tapped…" pickers for [data-action] leaf buttons.
          Rendered last so the operator edits content first, then wires buttons. */}
      {discoveredActions.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3 space-y-2">
          <div className="text-[10px] font-bold text-amber-600 uppercase tracking-widest border-b border-amber-200 pb-1">
            When tapped…
          </div>
          <div className="text-[10px] text-amber-700/80 -mt-1">
            Wire a button to a real action (open a page, fire a POS webhook, notify staff). Leave “Not wired” to keep its normal behavior.
          </div>
          {discoveredActions.map((a) => (
            <KioskActionRow
              key={`act:${a.key}`}
              fieldKey={a.key}
              label={a.label}
              current={actionOverrides[a.key] || { type: '', target: '' }}
              onChange={(type, target) => setActionOverride(a.key, type, target)}
              onFocus={() => pingHighlight(a.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}


/**
 * RepeatCountField — how many rows a repeating list shows.
 *
 * The board ships an authored count (three events, four menu rows). The
 * operator can go up or down from there and the board redistributes its
 * space; at the authored count nothing about the render changes at all,
 * which is what makes this safe to expose on every board that has an
 * indexed group.
 *
 * MAX is a real cap, not a suggestion: past some point the rows are too
 * small to read at viewing distance, and a board that silently accepts
 * "20" and renders unreadable slivers is worse than one that says no.
 */
const REPEAT_MAX = 12;

function RepeatCountField({ group, authored, value, onChange }: {
  group: string;
  authored: number;
  value: number;
  onChange: (n: number) => void;
}) {
  const noun = prettySectionLabel(group).toLowerCase();
  const set = (n: number) => onChange(Math.max(1, Math.min(REPEAT_MAX, n)));
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-slate-700">How many {noun}s</div>
        <div className="text-[10px] text-slate-500">
          {value === authored ? `${authored} — as designed` : `${value} · they resize to fit (max ${REPEAT_MAX})`}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button" aria-label={`Remove one ${noun}`}
          disabled={value <= 1}
          onClick={() => set(value - 1)}
          className="w-7 h-7 rounded-md border border-slate-300 bg-white text-slate-600 font-bold disabled:opacity-40 hover:border-indigo-400"
        >−</button>
        <span className="w-6 text-center text-xs font-bold text-slate-800 tabular-nums">{value}</span>
        <button
          type="button" aria-label={`Add one ${noun}`}
          disabled={value >= REPEAT_MAX}
          onClick={() => set(value + 1)}
          className="w-7 h-7 rounded-md border border-slate-300 bg-white text-slate-600 font-bold disabled:opacity-40 hover:border-indigo-400"
        >+</button>
      </div>
    </div>
  );
}

/**
 * QrUrlField — for a QR image slot on an EXTERNAL_HTML board. Operator pastes
 * their website link; we generate a QR **client-side** with the `qrcode` pkg
 * (dynamic-import, keeps it out of the initial bundle) and store the resulting
 * PNG data-URL as the slot's image override. Baked as a data-URL, so the QR
 * displays offline on the player — no server/network at scan-display time.
 * (Greg 2026-07-24: "you should be able to dump in your website link and it
 * updates the QR code.")
 */
function QrUrlField({ label, value, onChange }: { label: string; value: string; onChange: (dataUrl: string) => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gen = (raw: string) => {
    setUrl(raw);
    setErr('');
    if (timer.current) clearTimeout(timer.current);
    const clean = raw.trim();
    if (!clean) { onChange(''); return; }
    timer.current = setTimeout(() => {
      setBusy(true);
      import('qrcode')
        .then((m) => ((m as any).default || m).toDataURL(clean, { width: 512, margin: 1, errorCorrectionLevel: 'M' }))
        .then((dataUrl: string) => onChange(dataUrl))
        .catch(() => setErr('Could not generate a QR for that link.'))
        .finally(() => setBusy(false));
    }, 400);
  };
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="QR preview" className="w-14 h-14 rounded border border-slate-200 bg-white shrink-0 object-contain p-1" />
        ) : (
          <div className="w-14 h-14 rounded border border-dashed border-slate-300 shrink-0 grid place-items-center text-[9px] font-semibold text-slate-400">QR</div>
        )}
        <input
          type="url"
          inputMode="url"
          value={url}
          placeholder="https://yourstore.com/shop"
          onChange={(e) => gen(e.target.value)}
          className="flex-1 min-w-0 rounded border border-slate-200 px-2 py-1.5 text-sm focus:border-indigo-400 focus:outline-none"
        />
      </div>
      <p className="text-[10px] text-slate-500 mt-1 leading-snug">
        {busy ? 'Generating QR…' : err ? <span className="text-rose-500">{err}</span> : 'Paste your link — the QR code regenerates automatically. It bakes into the board, so it scans even offline.'}
      </p>
    </div>
  );
}

// ── Board-settings primitives (2026-08-21) ─────────────────────────────────
// The exact hidden-config keys the packaged boards read (elem-lunch clock
// spans; ms-lunch carousel/media; morning-news video). Only these keys are
// lifted out of the generic free-text list — any OTHER key under the same
// prefixes is real board copy and stays editable as text.
const BOARD_CONFIG_KEYS = new Set([
  'clock.mode', 'clock.timeZone', 'clock.locale', 'clock.hour12',
  // Every key that holds a CURRENT time or date. Only `clock.time` was here,
  // so the 76 boards that name their wall clock `clock.hhmm` showed a
  // free-text box with a stale authored value ("10:42 PM") even while the
  // board itself ticked correctly on screen. Shared with the shim so the two
  // halves cannot drift apart again — see the file's own comment for why
  // service.time / next.time / feat.time are deliberately NOT in it.
  ...WALL_CLOCK_FIELDS.time, ...WALL_CLOCK_FIELDS.date,
  'carousel.autoplay', 'carousel.intervalSeconds', 'carousel.initialIndex', 'carousel.showProgress',
  'media.fit', 'media.positionX', 'media.positionY',
  'video.autoplay', 'video.loop', 'video.muted', 'video.playbackRate', 'video.startSeconds',
  'video.fit', 'video.positionX', 'video.positionY',
  'motion.reduced', // honored automatically from the OS setting — never an operator knob
]);
// Same falsy vocabulary the boards' inline engines parse.
const BOARD_OFFISH = /^(no|false|off|0)$/i;
/** Curated zones — "pick the time zone and done". '' = the screen's own local
 *  time (the default every board ships with). An already-saved zone outside
 *  this list still shows (appended as "Custom: …") so nothing is clobbered. */
const BOARD_TIMEZONES: Array<[string, string]> = [
  ['', "Screen's local time"],
  ['America/New_York', 'Eastern — New York'],
  ['America/Chicago', 'Central — Chicago'],
  ['America/Denver', 'Mountain — Denver'],
  ['America/Phoenix', 'Arizona — no DST'],
  ['America/Los_Angeles', 'Pacific — Los Angeles'],
  ['America/Anchorage', 'Alaska'],
  ['Pacific/Honolulu', 'Hawaii'],
  ['America/Toronto', 'Toronto'],
  ['America/Mexico_City', 'Mexico City'],
  ['Europe/London', 'London'],
  ['Europe/Paris', 'Paris'],
  ['Europe/Berlin', 'Berlin'],
  ['Asia/Tokyo', 'Tokyo'],
  ['Australia/Sydney', 'Sydney'],
];

function SettingSelect({ label, value, options, onChange }: {
  label: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void;
}) {
  const known = options.some(([v]) => v === value);
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 cursor-pointer"
      >
        {options.map(([v, text]) => (
          <option key={v || '(default)'} value={v}>{text}</option>
        ))}
        {!known && value !== '' && <option value={value}>{`Custom: ${value}`}</option>}
      </select>
    </div>
  );
}

function SettingCheck({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer select-none">
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-slate-300 accent-indigo-600"
      />
      {label}
    </label>
  );
}

function SettingNumber({ label, value, min, max, onChange }: {
  label: string; value: string; min: number; max: number; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (!Number.isFinite(n)) { onChange(''); return; }
          onChange(String(Math.min(max, Math.max(min, n))));
        }}
        className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700"
      />
    </div>
  );
}

function TextField({ label, value, placeholder, onChange, onFocus }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void; onFocus?: () => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  // A2 — undo keystroke coalescing. Every TextField's onChange ultimately
  // calls a caller-supplied setField/setMeta that commits with
  // commit=true on EVERY keystroke; the store's activeTransaction guard
  // (see useBuilderStore.ts) turns those into a no-op re-commit as long
  // as a transaction is open, so wrapping focus/blur here — once, in the
  // shared component — coalesces all 285 TextField/TextAreaField call
  // sites into "one undo step per edit session" with zero call-site
  // changes. beginTransaction() is idempotent (no-ops if already open),
  // so nested/rapid focus doesn't push extra snapshots.
  const beginTransaction = useBuilderStore((s) => s.beginTransaction);
  const endTransaction = useBuilderStore((s) => s.endTransaction);
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <input
        type="text"
        value={local}
        placeholder={placeholder}
        onFocus={() => { beginTransaction(); onFocus?.(); }}
        onBlur={endTransaction}
        onChange={(e) => { setLocal(e.target.value); onChange(e.target.value); }}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm" />
    </div>
  );
}

function TextAreaField({ label, value, placeholder, onChange, rows = 3, onFocus }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void; rows?: number; onFocus?: () => void }) {
  // Controlled textarea — local state mirrors the incoming value so we
  // can honor external updates (undo/redo, zone switch, preset load)
  // while saving on every keystroke. Previous `defaultValue` +
  // `onBlur`-only was eating keystrokes when users clicked away via
  // keyboard shortcuts or window lost focus before blur fired, which
  // is exactly why "add a 4th line" appeared to do nothing.
  const [local, setLocal] = useState(value);
  // Sync when the prop changes (e.g. user selected a different zone).
  useEffect(() => { setLocal(value); }, [value]);
  // A2 — same coalescing as TextField above.
  const beginTransaction = useBuilderStore((s) => s.beginTransaction);
  const endTransaction = useBuilderStore((s) => s.endTransaction);
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <textarea
        value={local}
        placeholder={placeholder}
        rows={rows}
        onFocus={() => { beginTransaction(); onFocus?.(); }}
        onBlur={endTransaction}
        onChange={(e) => { setLocal(e.target.value); onChange(e.target.value); }}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm resize-y"
      />
    </div>
  );
}

/**
 * HolidayPanelExtras — renders the editable text fields for a HOLIDAY
 * widget. Schema is the static map exported by HolidayWidget
 * (HOLIDAY_FIELD_SCHEMA), keyed by `${gradeLevel}-${variant}`.
 *
 * Why static and not iframe-bridge-driven: the iframe-bridge approach
 * had a race — when the iframe loaded BEFORE the panel mounted (the
 * common case the moment an operator clicks a HOLIDAY zone for the
 * first time), the holiday:ready postMessage already fired and the
 * panel's listener missed it, leaving "Loading editable fields…"
 * stuck forever. The user reported this as "this has no hot spot at
 * all" on the HS Thanksgiving template (2026-05-07).
 *
 * Sections are grouped by the dotted-key prefix (e.g. all keys
 * starting with `headline.` form the "Headline" section). Each
 * section carries `data-field-section="<sectionKey>"` AND each
 * TextField wrapper carries `data-field-section="<fullKey>"` so the
 * generic template-edit-field listener up top of this file can scroll
 * to whichever the bridge reports the operator clicked in the iframe.
 *
 * The iframe bridge still fires holiday:fieldClicked → translated to
 * template-edit-field by HolidayWidget — but it's no longer
 * load-bearing for rendering. Click-to-scroll-to-panel-section
 * continues to work via that path.
 */
function HolidayPanelExtras({
  variant,
  gradeLevel,
  values,
  onFieldChange,
  styles,
  onStylesChange,
}: {
  variant: HolidayVariant;
  gradeLevel: HolidayGradeLevel;
  values: Record<string, string>;
  onFieldChange: (key: string, value: string) => void;
  /** Per-data-field style overrides (font size + color + weight),
   *  mirrored into the iframe by HolidayWidget on every commit. Same
   *  shape FieldStyleMap that the HS landscape cases use. */
  styles?: FieldStyleMap;
  onStylesChange: (next: FieldStyleMap) => void;
}) {
  // Prefer the board's LIVE fields (single source of truth) over the
  // drift-prone static HOLIDAY_FIELD_SCHEMA. Read the cache
  // synchronously on mount to beat the iframe race, then re-read on
  // every holiday:fields-loaded so a board that finishes loading after
  // the panel mounted swaps its real fields in. Static schema is the
  // fallback for the first paint before any board has reported. This is
  // the fix for "none of the new templates have hot zones" — the
  // rebuilt clean boards use new [data-field] keys (masthead.* /
  // headline.* / countdown.* / c0-2.*) that the hand-maintained static
  // map no longer matched, so panel sections + click-to-edit targets
  // were stale.
  const [liveSchema, setLiveSchema] = useState<ReturnType<typeof getHolidayLiveFields>>(
    () => getHolidayLiveFields(variant, gradeLevel),
  );
  useEffect(() => {
    const refresh = () => setLiveSchema(getHolidayLiveFields(variant, gradeLevel));
    refresh(); // sync re-read on variant / grade change
    window.addEventListener('holiday:fields-loaded', refresh);
    return () => window.removeEventListener('holiday:fields-loaded', refresh);
  }, [variant, gradeLevel]);

  // theme.* is the hidden brand-token block at the END of every board —
  // edited via the brand palette, never as raw hex/font text fields, so
  // strip it (the static schema never listed those keys either). The
  // inline annotation collapses the live/static union to one shape so
  // the grouping code below stays cleanly typed.
  const sourceSchema: { key: string; defaultText: string; multiline: boolean }[] =
    (liveSchema && liveSchema.length > 0)
      ? liveSchema
      : holidayFieldSchemaFor(variant, gradeLevel);
  const schema = sourceSchema.filter((f) => !f.key.startsWith('theme.'));

  if (schema.length === 0) {
    return (
      <div className="text-[10px] text-slate-400 italic px-1">
        This holiday template has no editable text fields. Pick a different holiday or grade level above.
      </div>
    );
  }

  // Pretty-format keys: 'headline.kicker' → 'Headline › Kicker'.
  // 'sked.0.d' → 'Sked › 0 › D'.
  const labelFor = (key: string) => {
    if (!key.includes('.')) return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
    const parts = key.split('.');
    return parts
      .map((p) => p.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()))
      .join(' › ');
  };

  // Pretty-format section header: 'headline' → 'Headline'.
  const sectionLabelFor = (sectionKey: string) =>
    sectionKey.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

  // Group fields by their first-segment prefix so the panel reads as
  // "Masthead", "Headline", "Drive", etc. — same SH(...) pattern the
  // ANIMATED_WELCOME case uses up above.
  type Group = { sectionKey: string; fields: typeof schema };
  const groups: Group[] = [];
  const groupIndex: Record<string, number> = {};
  for (const f of schema) {
    const sectionKey = f.key.includes('.') ? f.key.split('.')[0] : '_root';
    if (groupIndex[sectionKey] === undefined) {
      groupIndex[sectionKey] = groups.length;
      groups.push({ sectionKey, fields: [] });
    }
    groups[groupIndex[sectionKey]].fields.push(f);
  }

  return (
    <>
      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1 pt-2">
        Editable text <span className="font-normal lowercase">({schema.length})</span>
      </div>
      {groups.map((group) => (
        <div
          key={group.sectionKey}
          // data-field-section here so a click on any hotspot whose
          // dotted key starts with this section scrolls the whole
          // group into view (template-edit-field handler tries
          // sectionKey first, then fieldKey).
          data-field-section={group.sectionKey}
          className="space-y-2 pt-2 border-t border-slate-100 first:border-t-0"
        >
          {group.sectionKey !== '_root' && (
            <div className="text-[10px] font-bold text-indigo-500 uppercase tracking-widest px-1">
              {sectionLabelFor(group.sectionKey)}
            </div>
          )}
          {group.fields.map((f) => {
            const current = values[f.key] ?? '';
            // 2026-05-08 — swap plain TextField/TextAreaField for the
            // Styleable* wrappers so each field is stylable via the
            // BuilderBottomBar per-field controls (font / size / B-I-U-S /
            // color / brand / align / line-height), same as the HS widgets.
            // Operator's style values are forwarded by HolidayWidget into
            // the iframe via postMessage and applied by _style-bridge.js as
            // inline styles on the matching [data-field] element. fieldName
            // is the data-field key (the dotted-string the bridge looks up).
            return (
              // Wrapping div carries data-field-section="<fullKey>"
              // so the generic template-edit-field listener can scroll
              // straight to this exact field (more precise than
              // section-only). The handler tries fieldKey first, then
              // sectionKey, so both work.
              <div key={f.key} data-field-section={f.key}>
                {f.multiline ? (
                  <StyleableAreaField
                    label={labelFor(f.key)}
                    value={current}
                    placeholder={f.defaultText}
                    onChange={(v) => onFieldChange(f.key, v)}
                    fieldName={f.key}
                    styles={styles}
                    onStylesChange={onStylesChange}
                  />
                ) : (
                  <StyleableField
                    label={labelFor(f.key)}
                    value={current}
                    placeholder={f.defaultText}
                    onChange={(v) => onFieldChange(f.key, v)}
                    fieldName={f.key}
                    styles={styles}
                    onStylesChange={onStylesChange}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: [string,string][]; onChange: (v: string) => void }) {
  // a11y wave (2026-08-24) — axe-core: "Select element must have an
  // accessible name" (critical). The label text was visible but never
  // programmatically associated with the <select> (no htmlFor/id pairing,
  // no aria-label) — every widget field that renders through this shared
  // component was affected. useId() matches this file's existing
  // convention (see `nameId` above).
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm cursor-pointer">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}

/**
 * GameBindField — "Bind to game" picker (Sports Wave S2-2, 2026-07-02).
 * ONE dropdown (Greg's law — no new settings sprawl): LIVE games first
 * (🔴 dot in the label — native <option> elements can't carry real
 * color, so a text glyph is the only cross-browser way to flag it),
 * then upcoming/other games, with an explicit "Unbound (sample in
 * builder)" first option that clears config.gameId. Setting a value
 * makes WidgetRenderer's WidgetPreview wrap this zone in its own
 * <GameStateProvider gameId> (see GameStateContext.tsx / WidgetRenderer.tsx)
 * — independent of whatever ambient provider (or lack of one) the
 * screen this template ends up scheduled to would otherwise supply.
 *
 * Self-fetches via useGames() (mounted here, NOT in ContentFields) —
 * matching the file's existing convention for every other React-Query-
 * backed field (useTemplates()/useAssets() live in their OWN leaf
 * components, e.g. line ~1601/~9017 below, never at ContentFields' top
 * level). Several editability-wave test suites mount ContentFields
 * directly with no QueryClientProvider for widget types that never
 * reach a sports case — an unconditional hook at the top of
 * ContentFields would break every one of them.
 */
function GameBindField({
  value,
  onChange,
}: {
  value: string;
  onChange: (gameId: string) => void;
}) {
  const { data: gamesRaw } = useGames();
  const list: any[] = Array.isArray(gamesRaw) ? gamesRaw : [];
  const STATUS_RANK: Record<string, number> = { LIVE: 0, HALFTIME: 0, PRE_GAME: 1, SCHEDULED: 2, FINAL: 3 };
  const sorted = [...list].sort((a, b) => {
    const ra = STATUS_RANK[a.status] ?? 2;
    const rb = STATUS_RANK[b.status] ?? 2;
    if (ra !== rb) return ra - rb;
    // Newest-first within the same status bucket.
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
  const optionLabel = (g: any): string => {
    const isLive = g.status === 'LIVE' || g.status === 'HALFTIME';
    const prefix = isLive ? '🔴 LIVE — ' : g.status === 'FINAL' ? 'Final — ' : '';
    return `${prefix}${g.homeTeam || 'Home'} vs ${g.awayTeam || 'Away'}`;
  };
  return (
    <div>
      <label htmlFor="sports-gameId" className="block text-[10px] font-semibold text-slate-500 mb-1.5">Bind to game</label>
      <select
        id="sports-gameId"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm cursor-pointer"
      >
        <option value="">Unbound (sample in builder)</option>
        {sorted.map((g) => (
          <option key={g.id} value={g.id}>{optionLabel(g)}</option>
        ))}
      </select>
      <p className="mt-1 text-[10px] text-slate-400">
        {value
          ? 'On a real screen, this zone reads THIS game — never the sample, never whatever game the screen might otherwise show.'
          : 'Unbound zones show a sample in the builder and a "bind a game" prompt on a real screen (never invented scores).'}
      </p>
    </div>
  );
}

// Curated font catalog — Google Fonts that look good on signage
// (display weights, real character set). Showing 1000 fonts is hostile
// to teachers; this is the same shortlist Canva uses for its starter
// kit plus a few classroom-friendly faces. The browser handles the
// font-load via Google Fonts CDN — no per-font import needed because
// every page already imports the full Google Fonts CSS.
const FONT_OPTIONS: { family: string; sample: string }[] = [
  { family: '',                         sample: 'Theme default' },
  { family: 'Inter, sans-serif',        sample: 'Inter — Modern' },
  { family: 'Fredoka, sans-serif',      sample: 'Fredoka — Friendly' },
  { family: 'Poppins, sans-serif',      sample: 'Poppins — Clean' },
  { family: 'Montserrat, sans-serif',   sample: 'Montserrat — Bold' },
  { family: 'Bebas Neue, sans-serif',   sample: 'Bebas Neue — Display' },
  { family: 'Anton, sans-serif',        sample: 'Anton — Headline' },
  { family: 'Oswald, sans-serif',       sample: 'Oswald — Athletic' },
  { family: 'Caveat, cursive',          sample: 'Caveat — Handwritten' },
  { family: 'Permanent Marker, cursive',sample: 'Marker — Casual' },
  { family: 'Indie Flower, cursive',    sample: 'Indie — Doodle' },
  { family: 'Pacifico, cursive',        sample: 'Pacifico — Script' },
  { family: 'Fraunces, serif',          sample: 'Fraunces — Editorial' },
  { family: 'EB Garamond, serif',       sample: 'EB Garamond — Classic' },
  { family: 'Playfair Display, serif',  sample: 'Playfair — Elegant' },
  { family: 'VT323, monospace',         sample: 'VT323 — Retro Terminal' },
  { family: 'Press Start 2P, monospace',sample: 'Press Start 2P — Pixel' },
];

/**
 * CanvasBackdropSection — full canvas-background editor.
 *
 * Three knobs (solid color / CSS gradient / image) plus a curated
 * swatch library (TemplateBackdropPicker) and an upload-from-computer
 * button for the image. Re-used from:
 *   - Right rail "Properties" tab (when no zone is selected)
 *   - Bottom bar "Backdrop" button modal (anytime)
 *
 * Why a separate section: operators kept asking "where do I change
 * the background?" The Properties tab is gated on "no zone selected"
 * so it was always a click-deselect-click ordeal. Lifting this into
 * a re-usable section means we can also surface it from a discoverable
 * bottom-bar button.
 */
export function CanvasBackdropSection({
  bgColor,
  bgGradient,
  bgImage,
  onChange,
  variant = 'panel',
}: {
  bgColor: string;
  bgGradient: string;
  bgImage: string;
  onChange: (patch: { bgColor?: string; bgGradient?: string; bgImage?: string }) => void;
  /** 'panel' = embedded in right rail. 'modal' = wider, used in popup. */
  variant?: 'panel' | 'modal';
}) {
  const bgGradientId = useId();
  const bgImageId = useId();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  /**
   * Upload a file from the operator's computer. Same endpoint as
   * BuilderZone's drop-target — POST /assets/upload with bearer token,
   * returns the asset URL. Asset goes into the operator's media library
   * so the same image is reusable on other templates.
   */
  const handleFile = async (file: File) => {
    setUploadError(null);
    if (!file.type.startsWith('image/')) {
      setUploadError('Please pick an image file (JPG, PNG, GIF, or WEBP).');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // Lazy-load the auth + URL helpers so this section can be tree-
      // shaken when a future build splits the panel from the modal.
      const { useUIStore } = await import('@/store/ui-store');
      const { API_URL } = await import('@/lib/api-url');
      const token = useUIStore.getState().token;
      const res = await fetch(`${API_URL}/assets/upload`, {
        method: 'POST',
        body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const { url } = await res.json();
      // Setting bgImage clears bgColor/bgGradient — they all stack with
      // image winning, but the operator picked image so be explicit.
      onChange({ bgImage: url, bgColor: '', bgGradient: '' });
    } catch (err: any) {
      setUploadError(err?.message || 'Could not upload image. Try a smaller file.');
    } finally {
      setUploading(false);
    }
  };

  const wrapClass = variant === 'modal'
    ? 'space-y-4 text-xs'
    : 'space-y-3';

  return (
    <section className={variant === 'panel' ? 'space-y-3' : ''}>
      {variant === 'panel' && (
        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1">Backdrop</h3>
      )}
      <div className={`${variant === 'modal' ? '' : 'bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm'} ${wrapClass}`}>
        {/* Solid color — themed picker (was OS-native before). Picking
            a color here clears any previously-set gradient/image so
            the swatch shown matches what's actually on the canvas. */}
        <ColorPickerField
          label="Solid color"
          value={bgColor || '#ffffff'}
          onChange={(v) => onChange({ bgColor: v, bgGradient: '', bgImage: '' })}
          allowTransparent
        />

        {/* Gradient — power-user CSS field. Most operators will pick
            from the swatch grid below instead of typing this by hand. */}
        <div>
          <label htmlFor={bgGradientId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">CSS gradient (advanced)</label>
          <input
            id={bgGradientId}
            type="text"
            value={bgGradient}
            onChange={(e) => onChange({ bgGradient: e.target.value })}
            placeholder="linear-gradient(180deg, #fce7f3, #ffe4e6)"
            className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm"
          />
        </div>

        {/* Image — URL paste OR upload from computer. */}
        <div>
          <label htmlFor={bgImageId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">Image background</label>
          <div className="flex gap-2">
            <input
              id={bgImageId}
              type="text"
              inputMode="url"
              spellCheck={false}
              value={bgImage}
              onChange={(e) => onChange({ bgImage: e.target.value })}
              placeholder="Paste an image URL"
              className="flex-1 px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm"
            />
            <input
              id={fileInputId}
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                if (fileInputRef.current) fileInputRef.current.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-bold whitespace-nowrap disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
            {bgImage && (
              <button
                type="button"
                onClick={() => onChange({ bgImage: '' })}
                className="px-2 py-2 rounded-lg text-[10px] font-bold text-slate-500 bg-white border border-slate-200 hover:bg-slate-50"
              >
                Clear
              </button>
            )}
          </div>
          {uploadError && (
            <div className="mt-1 text-[10px] text-rose-600">{uploadError}</div>
          )}
          {bgImage && (
            <div className="mt-2 w-full h-20 rounded border border-slate-200/60 bg-slate-100" style={{ backgroundImage: `url(${bgImage.startsWith('url(') ? bgImage.slice(4, -1) : bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }} aria-label="Image preview" />
          )}
        </div>

        {/* Swatch grid — pulls from every existing template (system +
            tenant) and dedupes. The library answer to "do we have some
            backgrounds to pick from" — yes, every distinct backdrop in
            the catalog is one click away. */}
        <TemplateBackdropPicker
          current={{ bgColor, bgGradient, bgImage }}
          onPick={(bg) => onChange({
            bgColor: bg.bgColor || '',
            bgGradient: bg.bgGradient || '',
            bgImage: bg.bgImage || '',
          })}
          variant={variant}
        />
      </div>
    </section>
  );
}

/**
 * TemplateBackdropPicker — renders a swatch grid where every entry is
 * the bgColor/bgGradient/bgImage of an existing template (system +
 * tenant). One click adopts that backdrop on the current template.
 *
 * Deduplicated by bg signature so a portrait + landscape pair don't
 * show as two separate swatches. Grouped into Gradients / Solid colors
 * / Images so operators can scan by category.
 */
export function TemplateBackdropPicker({
  current,
  onPick,
  variant = 'panel',
}: {
  current: { bgColor?: string; bgGradient?: string; bgImage?: string };
  onPick: (bg: { bgColor?: string; bgGradient?: string; bgImage?: string }) => void;
  variant?: 'panel' | 'modal';
}) {
  const { data: templates } = useTemplateBackdrops();
  const groups = (() => {
    const seen = new Set<string>();
    const gradients: { name: string; bgColor?: string; bgGradient?: string; bgImage?: string }[] = [];
    const solids: typeof gradients = [];
    const images: typeof gradients = [];
    for (const t of (templates as any[] | undefined) || []) {
      const sig = `${t.bgColor || ''}|${t.bgGradient || ''}|${t.bgImage || ''}`;
      if (seen.has(sig) || sig === '||') continue;
      seen.add(sig);
      const entry = { name: t.name || '(untitled)', bgColor: t.bgColor, bgGradient: t.bgGradient, bgImage: t.bgImage };
      if (entry.bgImage) images.push(entry);
      else if (entry.bgGradient) gradients.push(entry);
      else if (entry.bgColor) solids.push(entry);
    }
    return { gradients, solids, images };
  })();

  const isCurrent = (s: { bgColor?: string; bgGradient?: string; bgImage?: string }) =>
    (s.bgColor || '') === (current.bgColor || '') &&
    (s.bgGradient || '') === (current.bgGradient || '') &&
    (s.bgImage || '') === (current.bgImage || '');

  const total = groups.gradients.length + groups.solids.length + groups.images.length;
  if (total === 0) return null;

  const cols = variant === 'modal' ? 'grid-cols-8' : 'grid-cols-6';
  const maxH = variant === 'modal' ? 'max-h-72' : 'max-h-48';

  const renderGroup = (label: string, entries: typeof groups.gradients) => {
    if (entries.length === 0) return null;
    return (
      <div className="space-y-1.5">
        <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide pl-1">
          {label} <span className="text-slate-300 font-normal">({entries.length})</span>
        </div>
        <div className={`grid ${cols} gap-1.5`}>
          {entries.map((s, i) => {
            const bg = s.bgImage
              ? `url(${s.bgImage.startsWith('url(') ? s.bgImage.slice(4, -1) : s.bgImage}) center/cover`
              : s.bgGradient || s.bgColor || '#ffffff';
            return (
              <button
                key={`${label}-${i}`}
                type="button"
                onClick={() => onPick(s)}
                title={s.name}
                aria-label={`Use backdrop from ${s.name}`}
                aria-pressed={isCurrent(s)}
                className={`group relative aspect-square rounded-md transition-all hover:scale-105 hover:z-10 ${isCurrent(s) ? 'ring-2 ring-indigo-500 ring-offset-1' : 'border border-slate-200/60'}`}
                style={{ background: bg }}
              >
                {/* Hover label — name overlay so operators recognize
                    "oh that's the Sunny Meadow gradient." */}
                <span className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-[8px] font-semibold text-white bg-black/60 rounded-b-md opacity-0 group-hover:opacity-100 transition-opacity truncate text-center">
                  {s.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Section heading for the swatch grid — not a form label
          (the swatches are buttons, not inputs). */}
      <div className="block text-[10px] font-semibold text-slate-500 mb-1.5">
        Pick from the library <span className="text-slate-400 font-normal">({total} backdrops)</span>
      </div>
      <div className={`space-y-3 ${maxH} overflow-y-auto p-2 rounded-lg bg-white border border-slate-200/60`}>
        {renderGroup('Gradients', groups.gradients)}
        {renderGroup('Solid colors', groups.solids)}
        {renderGroup('Images', groups.images)}
      </div>
      <p className="mt-1 text-[10px] text-slate-400">Every distinct backdrop from the template catalog. Click to apply — operator-typed values above stay as overrides.</p>
    </div>
  );
}

/**
 * Measure the actual rendered font-size of a zone (or a specific
 * data-field hotspot inside a zone) on the canvas. Used by FontSizeField
 * to anchor the stepper on the visible size instead of a hardcoded 48.
 *
 * Returns null if the zone isn't on screen yet (template still loading,
 * preview mode hides the canvas, etc). The caller falls back to its
 * hardcoded default in that case.
 *
 * Note: getComputedStyle returns CSS px which is invariant under the
 * canvas's transform: scale wrapper, so what we read IS the design-px
 * size — exactly what the operator should be stepping from.
 */
export function measureZoneFontSize(zoneId: string, fieldKey?: string | null): number | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const zoneSel = `[data-zone-id="${CSS.escape(zoneId)}"]`;
  const root = document.querySelector(zoneSel) as HTMLElement | null;
  if (!root) return null;
  let target: HTMLElement | null = null;
  if (fieldKey) {
    target = root.querySelector(`[data-field="${CSS.escape(fieldKey)}"]`) as HTMLElement | null;
  }
  if (!target) {
    // No specific hotspot — find the largest text-bearing descendant so
    // we measure the headline rather than a tiny caption that happens
    // to come first in DOM order. Falls back to the zone root itself
    // when nothing inside has explicit text.
    const candidates = Array.from(root.querySelectorAll('*')) as HTMLElement[];
    let bestSize = 0;
    for (const el of candidates) {
      const txt = (el.textContent || '').trim();
      if (!txt) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (Number.isFinite(fs) && fs > bestSize) {
        bestSize = fs;
        target = el;
      }
    }
    if (!target) target = root;
  }
  const fs = parseFloat(getComputedStyle(target).fontSize);
  return Number.isFinite(fs) ? fs : null;
}

export function FontFamilyField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  // a11y wave (2026-08-24) — same missing-accessible-name gap as
  // SelectField above: the label was never associated with the <select>.
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontFamily: value || 'inherit' }}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm cursor-pointer"
      >
        {FONT_OPTIONS.map((f) => (
          <option key={f.family || 'theme'} value={f.family} style={{ fontFamily: f.family || 'inherit' }}>
            {f.sample}
          </option>
        ))}
      </select>
    </div>
  );
}

// Common signage sizes. Includes the small print teachers occasionally
// want as well as the chunky display sizes that look right on a 4K wall
// screen viewed from across a hallway.
const FONT_SIZE_PRESETS = [12, 14, 16, 18, 20, 24, 32, 40, 48, 56, 64, 72, 96, 128, 160, 200];

/**
 * FontSizeField — number stepper with preset dropdown.
 *
 * Important: when there's no explicit override (`value === null`) the
 * stepper used to fall back to a hardcoded 48 as the base, so clicking
 * "+" on a theme-styled 144px headline shrank it to 50. Operator
 * reported:
 *   "i selected large text and then hit the larger size and it made
 *    it tiny, its not defaulting the size to whatever the current
 *    font size is"
 *
 * Fix: consumer can pass `getMeasuredSize` that queries the actual
 * rendered font-size from the DOM. The stepper uses that as the base,
 * and the input shows the measured value as a placeholder (greyed) so
 * the operator sees what they're stepping FROM. Clicking "+" on a 144
 * px headline now goes to 146 px, not 50.
 */
export function FontSizeField({ label, value, onChange, getMeasuredSize }: { label: string; value: number | null; onChange: (v: number | undefined) => void; getMeasuredSize?: () => number | null }) {
  const current = typeof value === 'number' && Number.isFinite(value) ? value : null;
  const [measured, setMeasured] = useState<number | null>(null);

  // Re-measure whenever the override goes from set→unset, when the
  // measure function reference itself changes (zone/field switch in
  // the consumer), or when the override value is cleared. We defer to
  // rAF so any pending DOM mutations from a just-applied style change
  // settle before we read computed font-size.
  useEffect(() => {
    if (!getMeasuredSize) { setMeasured(null); return; }
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      if (cancelled) return;
      const m = getMeasuredSize();
      setMeasured(typeof m === 'number' && Number.isFinite(m) ? Math.round(m) : null);
    });
    return () => { cancelled = true; cancelAnimationFrame(id); };
  }, [getMeasuredSize, current]);

  // Stepper base — explicit override > DOM-measured > 48 fallback.
  // Without the DOM-measured tier, "+ on theme-styled 144px text"
  // shrank to 50px, the bug the operator reported.
  const base = current ?? measured ?? 48;
  const display = current ?? '';
  const bump = (delta: number) => {
    onChange(Math.max(8, Math.min(400, base + delta)));
  };
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          onClick={() => bump(-2)}
          aria-label="Decrease font size"
          className="px-3 rounded-lg bg-white border border-slate-200/60 text-xs font-bold text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition-colors shadow-sm"
        >
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={8}
          max={400}
          value={display}
          // Show the actual rendered size as the placeholder when no
          // explicit override exists — gives the operator a visible
          // anchor for what they're stepping from.
          placeholder={measured ? `${measured}` : 'auto'}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange(Number.isFinite(n) ? n : undefined);
          }}
          aria-label={label}
          className="w-16 px-2 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-semibold text-center focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm"
        />
        <button
          type="button"
          onClick={() => bump(2)}
          aria-label="Increase font size"
          className="px-3 rounded-lg bg-white border border-slate-200/60 text-xs font-bold text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition-colors shadow-sm"
        >
          +
        </button>
        <select
          value={current ?? ''}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10);
            onChange(Number.isFinite(n) ? n : undefined);
          }}
          className="flex-1 px-2 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm cursor-pointer"
          aria-label={`${label} preset`}
        >
          <option value="">Preset…</option>
          {FONT_SIZE_PRESETS.map((s) => (
            <option key={s} value={s}>{s}px</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Advanced — collapsible JSON Overrides (closed by default)
// ─────────────────────────────────────────────────────────
function AdvancedJson({ zone, configString, configId, updateZone }: { zone: any; configString: string; configId: string; updateZone: any }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-2">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 pl-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest hover:text-slate-600">
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Advanced (JSON)
      </button>
      {open && (
        <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm">
          <p className="text-[10px] text-slate-400 mb-1.5">For power users — edit the raw config JSON. Most fields are available in the Content section above.</p>
          <textarea
            id={configId}
            rows={5}
            defaultValue={configString}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (!raw) { updateZone(zone.id, { defaultConfig: null }, true); return; }
              try {
                const parsed = JSON.parse(raw);
                updateZone(zone.id, { defaultConfig: parsed }, true);
              } catch { /* swallow */ }
            }}
            className="w-full px-3 py-2.5 rounded-lg bg-white border border-slate-200/60 text-[11px] font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm resize-y"
            placeholder='{ "fontSize": 48 }'
          />
        </div>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────
// Recurring periods editor (for COUNTDOWN "lunch" mode)
// ─────────────────────────────────────────────────────────
type Period = { label: string; daysOfWeek: number[]; startTime: string };
const DOW = [
  { n: 1, l: 'M' }, { n: 2, l: 'T' }, { n: 3, l: 'W' },
  { n: 4, l: 'Th' }, { n: 5, l: 'F' }, { n: 6, l: 'Sa' }, { n: 0, l: 'Su' },
];

function PeriodsEditor({ value, onChange }: { value: Period[]; onChange: (next: Period[]) => void }) {
  const periods = value.length ? value : [];

  const update = (idx: number, patch: Partial<Period>) => {
    const next = periods.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const add = () => {
    onChange([...periods, { label: `Lunch ${periods.length + 1}`, daysOfWeek: [1, 2, 3, 4, 5], startTime: '11:30' }]);
  };
  const remove = (idx: number) => {
    onChange(periods.filter((_, i) => i !== idx));
  };
  const toggleDay = (idx: number, dow: number) => {
    const cur = periods[idx].daysOfWeek;
    const next = cur.includes(dow) ? cur.filter(d => d !== dow) : [...cur, dow].sort((a, b) => a - b);
    update(idx, { daysOfWeek: next });
  };

  return (
    <div>
      {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control:
          heads a dynamic list of period rows, not one control. */}
      <div className="block text-[10px] font-semibold text-slate-500 mb-1.5">Lunch periods</div>
      <div className="space-y-2">
        {periods.length === 0 && (
          <p className="text-[11px] text-slate-400 italic px-1">No periods yet — add your first below.</p>
        )}
        {periods.map((p, idx) => (
          <div key={idx} className="bg-white border border-slate-200 rounded-lg p-2.5 space-y-1.5 shadow-sm">
            <div className="grid grid-cols-[minmax(0,1fr)_5.75rem_1.75rem] items-center gap-1.5">
              <input
                type="text"
                value={p.label}
                onChange={(e) => update(idx, { label: e.target.value })}
                placeholder="6th Grade Lunch"
                className="min-w-0 w-full px-2 py-1 text-xs font-semibold rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <input
                type="time"
                value={p.startTime}
                onChange={(e) => update(idx, { startTime: e.target.value })}
                className="min-w-0 w-full px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button
                type="button"
                onClick={() => remove(idx)}
                aria-label="Remove period"
                className="w-7 h-7 rounded border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 flex items-center justify-center text-xs"
              >
                ×
              </button>
            </div>
            <div className="flex gap-1">
              {DOW.map(({ n, l }) => {
                const active = p.daysOfWeek.includes(n);
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => toggleDay(idx, n)}
                    className={`flex-1 py-1 text-[10px] font-bold rounded transition-colors ${
                      active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                    }`}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="w-full py-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-dashed border-indigo-200"
        >
          + Add period
        </button>
      </div>
      <p className="mt-2 text-[10px] text-slate-400 leading-relaxed">
        The widget shows the time until the <strong>next upcoming period</strong>. Skips weekends if no day selected.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Business-hours editor (MUSIC_PLAYER) — structured start/end +
// day-of-week toggles. Replaces the old raw-JSON textarea (§19 P3).
// Blank/undefined = plays 24/7. Empty daysOfWeek = every day (matches
// MusicPlayerWidget.isWithinBusinessHours). daysOfWeek uses 0=Sun..6=Sat,
// the same numbering as the shared DOW constant above.
// ─────────────────────────────────────────────────────────
type BusinessHours = { start: string; end: string; daysOfWeek?: number[] };

function BusinessHoursField({
  value,
  onChange,
}: {
  value: BusinessHours | null | undefined;
  onChange: (v: BusinessHours | undefined) => void;
}) {
  const bh = value || null;
  // a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control.
  const openId = useId();
  const closeId = useId();

  const toggleDay = (dow: number) => {
    const cur = bh?.daysOfWeek || [];
    const next = cur.includes(dow) ? cur.filter((d) => d !== dow) : [...cur, dow].sort((a, b) => a - b);
    onChange({ start: bh?.start || '08:00', end: bh?.end || '22:00', daysOfWeek: next });
  };

  return (
    <div>
      {/* Group heading — toggles between an "add" button and the open/close
          fields below, so it isn't associated with one single control. */}
      <div className="block text-[10px] font-semibold text-slate-500 mb-1.5">Business hours</div>
      {!bh ? (
        <div className="bg-white border border-slate-200 rounded-lg p-2.5 shadow-sm">
          <p className="text-[11px] text-slate-500 mb-2">
            Plays <strong>24/7</strong>. Set a window to silence the player outside open hours.
          </p>
          <button
            type="button"
            onClick={() => onChange({ start: '08:00', end: '22:00' })}
            className="w-full py-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-dashed border-indigo-200"
          >
            + Set business hours
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg p-2.5 space-y-2 shadow-sm">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor={openId} className="block text-[10px] text-slate-400 mb-0.5">Open</label>
              <input
                id={openId}
                type="time"
                value={bh.start || '08:00'}
                onChange={(e) => onChange({ ...bh, start: e.target.value })}
                className="w-full px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label htmlFor={closeId} className="block text-[10px] text-slate-400 mb-0.5">Close</label>
              <input
                id={closeId}
                type="time"
                value={bh.end || '22:00'}
                onChange={(e) => onChange({ ...bh, end: e.target.value })}
                className="w-full px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>
          <div className="flex gap-1">
            {DOW.map(({ n, l }) => {
              const active = (bh.daysOfWeek || []).includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => toggleDay(n)}
                  aria-pressed={active}
                  className={`flex-1 py-1 text-[10px] font-bold rounded transition-colors ${
                    active ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {l}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-slate-400 leading-tight">
              {(bh.daysOfWeek || []).length === 0
                ? 'Plays every day in this window.'
                : 'Plays only on the selected days.'}
              {(() => {
                const [sh, sm] = (bh.start || '00:00').split(':').map(Number);
                const [eh, em] = (bh.end || '23:59').split(':').map(Number);
                return sh * 60 + sm > eh * 60 + em ? ' Overnight window (wraps midnight).' : '';
              })()}
            </p>
            <button
              type="button"
              onClick={() => onChange(undefined)}
              className="shrink-0 px-2 py-1 text-[10px] font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded"
            >
              Clear (24/7)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Toggle / Color / Asset / Playlist / BellSchedule field types
// ─────────────────────────────────────────────────────────
function ToggleField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 cursor-pointer">
      <span className="text-[10px] font-semibold text-slate-500">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative w-9 h-5 rounded-full transition-colors ${value ? 'bg-indigo-600' : 'bg-slate-200'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${value ? 'translate-x-4' : ''}`} />
      </button>
    </label>
  );
}

/** Inline B / I / U / S format toggles. Mirrors Canva's universal
 *  text-formatting bar — bold / italic / underline / strikethrough.
 *  Operator pushes any combination; widget render in WidgetRenderer
 *  reads the four boolean fields independently. */
export function FormatToggles({
  bold, italic, underline, strikethrough, onChange,
}: {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  onChange: (patch: Record<string, boolean>) => void;
}) {
  const btn = (
    on: boolean,
    label: string,
    glyph: React.ReactNode,
    style: React.CSSProperties,
    handler: () => void,
  ) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={handler}
      className={`flex-1 h-9 rounded-lg text-xs transition-colors border shadow-sm ${
        on
          ? 'bg-indigo-600 border-indigo-600 text-white'
          : 'bg-white border-slate-200/60 text-slate-700 hover:bg-slate-50'
      }`}
      style={style}
    >
      {glyph}
    </button>
  );
  return (
    <div>
      {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control:
          heads 4 toggle <button>s (each carries its own aria-label), not
          one control. */}
      <div className="block text-[10px] font-semibold text-slate-500 mb-1.5">Format</div>
      <div className="flex gap-1">
        {btn(bold,          'Bold (Ctrl/⌘ + B)',                'B', { fontWeight: 800 },                              () => onChange({ bold: !bold }))}
        {btn(italic,        'Italic (Ctrl/⌘ + I)',              'I', { fontStyle: 'italic', fontWeight: 600 },         () => onChange({ italic: !italic }))}
        {btn(underline,     'Underline (Ctrl/⌘ + U)',           'U', { textDecoration: 'underline', fontWeight: 600 }, () => onChange({ underline: !underline }))}
        {btn(strikethrough, 'Strikethrough (Ctrl/⌘ + Shift + X)','S', { textDecoration: 'line-through', fontWeight: 600 }, () => onChange({ strikethrough: !strikethrough }))}
      </div>
    </div>
  );
}

/** Line-height slider. Canva range: 0.5x to 2.5x. Step 0.05 gives
 *  fine control without overwhelming the UI. */
function LineHeightField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  // a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control.
  const id = useId();
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label htmlFor={id} className="text-[10px] font-semibold text-slate-500">Line height</label>
        <span className="text-[10px] font-mono text-slate-500">{value.toFixed(2)}×</span>
      </div>
      <input
        id={id}
        type="range"
        min={0.5}
        max={2.5}
        step={0.05}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label="Line height multiplier"
        className="w-full accent-indigo-600"
      />
    </div>
  );
}

/**
 * ColorField — thin wrapper around the app-themed ColorPickerField so
 * we don't fall back to the OS-native <input type="color"> picker
 * (Windows shows an unsynced bar+gradient that confuses operators).
 * Same call signature as before — every existing import keeps working.
 */
export function ColorField({ label, value, onChange, allowTransparent }: { label: string; value: string; onChange: (v: string) => void; allowTransparent?: boolean }) {
  return (
    <ColorPickerField
      label={label}
      value={value}
      onChange={onChange}
      allowTransparent={allowTransparent}
    />
  );
}

// CYCLE-5 asset-picker-uncontrolled fix — small controlled-but-deferred
// wrapper. Mirrors `value` from props into local state so external picker
// updates flow back into the input (the bug), but defers parent onChange
// to onBlur / Enter so per-keystroke typing doesn't thrash the widget
// config. Empty deps + value-sync effect handles the picker case.
function ControlledUrlInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <input
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        if (e.target.value !== value) onChange(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
      placeholder="https://… or pick from library"
      className="w-full px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
    />
  );
}

// Wave B / editor-crush B5 (2026-07-02) — searchable lucide icon picker for
// the ICON widget. Type-to-filter across ~1500 icon names; the grid renders
// the real icons (DynamicIcon lazy-loads each glyph's module, so showing 48
// results costs 48 tiny chunks, not the whole set). Results capped so the
// panel stays snappy on a phone.
function IconPickerField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [query, setQuery] = useState('');
  const results = searchIconNames(query, 48);
  const current = isValidIconName(value) ? value : undefined;
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">
        Icon{current ? <span className="ml-1.5 font-mono text-slate-400">— {current}</span> : null}
      </label>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search icons (star, trophy, pizza…)"
        className="w-full px-2 py-1.5 mb-1.5 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        aria-label="Search icons"
      />
      <div className="grid grid-cols-6 gap-1 max-h-44 overflow-y-auto rounded border border-slate-100 bg-slate-50/50 p-1.5">
        {results.length === 0 ? (
          <p className="col-span-6 text-[10px] text-slate-400 italic py-3 text-center">No icons match.</p>
        ) : (
          results.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onChange(name)}
              title={name}
              aria-pressed={name === current}
              className={`aspect-square rounded flex items-center justify-center transition-colors ${
                name === current
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-400 hover:text-indigo-600'
              }`}
            >
              <DynamicIcon name={name} className="w-4 h-4" fallback={() => null} />
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// Single-asset picker — opens an inline modal of uploaded assets
function AssetPickerField({ label, value, onChange, kind }: { label: string; value: string; onChange: (v: string) => void; kind: 'image' | 'video' }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        {value ? (
          <div className="relative w-14 h-14 rounded border border-slate-200 overflow-hidden bg-slate-100 shrink-0">
            {kind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              // 2026-05-30 — EGRESS FIX: 56px preview → 112px transform
              <img src={transformedImageUrl(resolveAssetUrl(value), { width: 112, quality: 60 })} alt="" className="w-full h-full object-cover" />
            ) : (
              // 2026-05-30 — EGRESS FIX: preload="none" for 56px video preview
              <video src={resolveAssetUrl(value)} className="w-full h-full object-cover" muted preload="none" />
            )}
            <button
              type="button"
              onClick={() => onChange('')}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center hover:bg-rose-600"
              aria-label="Clear"
            >×</button>
          </div>
        ) : (
          <div className="w-14 h-14 rounded border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-[10px] text-slate-600 shrink-0">
            None
          </div>
        )}
        <div className="flex-1 flex flex-col gap-1.5">
          {/* CYCLE-5 asset-picker-uncontrolled fix — was uncontrolled
              (defaultValue), so when "Browse library" picked a new URL
              the input didn't refresh, only the thumbnail did. Now
              controlled (value + onChange), with a local commit-on-blur
              shadow so per-keystroke onChange doesn't thrash the parent
              widget config. */}
          <ControlledUrlInput value={value} onChange={onChange} />
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="px-2 py-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded border border-indigo-100"
            >
              Browse library
            </button>
            {/* Clear — reverts the widget to its default illustrated
                placeholder. Teachers kept getting stuck with a photo
                they couldn't remove; the tiny × corner badge wasn't
                discoverable enough, so this is the explicit escape. */}
            {value && (
              <button
                type="button"
                onClick={() => onChange('')}
                className="px-2 py-1 text-[10px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded border border-rose-100"
              >
                Remove photo
              </button>
            )}
          </div>
        </div>
      </div>
      {open && (
        <AssetLibraryModal kind={kind} onPick={(url) => { onChange(url); setOpen(false); }} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}

// Multi-asset list — used by IMAGE_CAROUSEL and VIDEO_CAROUSEL.
// 2026-05-09 — operator: "for the carousel, i should be able to select
// multiple videos or images at once". Modal now opens in multi-pick
// mode; selecting N tiles + "Add N selected" appends them all in one
// call instead of one-at-a-time picks.
// 2026-05-09 (later) — operator: "the tiny little up arrows are too
// hard to see and use, let me drag and drop the content in different
// orders". Replaced ↑ buttons with full dnd-kit sortable rows. Each
// row has a visible grip handle on the left; the row body and the
// remove button stay clickable. Dnd uses PointerSensor with a 4px
// activation distance so a normal click doesn't accidentally start a
// drag.
function AssetListPickerField({ label, value, onChange, kind }: { label: string; value: string[]; onChange: (v: string[]) => void; kind: 'image' | 'video' }) {
  const [open, setOpen] = useState(false);
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));
  const noun = kind === 'image' ? 'photo' : 'video';
  const nounPlural = kind === 'image' ? 'photos' : 'videos';

  // Use idx-based ids — duplicate URLs in the playlist would otherwise
  // collide with each other (dnd-kit requires unique ids). We append
  // the url so the same idx position with a different file remounts.
  const items = value.map((url, idx) => ({ id: `${idx}:${url}`, url, idx }));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex(it => it.id === active.id);
    const newIdx = items.findIndex(it => it.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    onChange(arrayMove(value, oldIdx, newIdx));
  };

  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">
        {label}
        {value.length > 1 && (
          <span className="ml-1.5 font-normal text-slate-400">— drag to reorder</span>
        )}
      </label>
      <div className="space-y-1.5">
        {value.length === 0 && <p className="text-[11px] text-slate-400 italic">No {nounPlural} yet — add some below.</p>}
        {value.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map(it => it.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1.5">
                {items.map((it) => (
                  <SortableAssetRow
                    key={it.id}
                    id={it.id}
                    url={it.url}
                    kind={kind}
                    onRemove={() => remove(it.idx)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full py-1.5 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded border border-dashed border-indigo-200"
        >
          + Add {nounPlural} from library
        </button>
      </div>
      {open && (
        <AssetLibraryModal
          kind={kind}
          multi
          onPick={(url) => { onChange([...value, url]); setOpen(false); }}
          onPickMulti={(urls) => { onChange([...value, ...urls]); setOpen(false); }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function SortableAssetRow({
  id,
  url,
  kind,
  onRemove,
}: {
  id: string;
  url: string;
  kind: 'image' | 'video';
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: DndCSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : 'auto',
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 p-1.5 bg-white border border-slate-200 rounded shadow-sm">
      {/* Drag handle — only this element starts the drag, so clicking the
          remove button or the row body doesn't accidentally pick it up. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-700 p-1 -ml-1 touch-none"
      >
        <GripVertical className="w-4 h-4" aria-hidden />
      </button>
      {kind === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element
        // 2026-05-30 — EGRESS FIX: 40px thumbnail → 80px transform
        <img src={transformedImageUrl(resolveAssetUrl(url), { width: 80, quality: 60 })} alt="" className="w-10 h-10 object-cover rounded shrink-0 bg-slate-100" />
      ) : (
        // 2026-05-30 — EGRESS FIX: preload="none" for 40px video thumbnail
        <video src={resolveAssetUrl(url)} className="w-10 h-10 object-cover rounded shrink-0 bg-slate-100" muted preload="none" />
      )}
      <span className="flex-1 text-[10px] text-slate-500 truncate font-mono">{url.split('/').pop()}</span>
      <button type="button" onClick={onRemove} className="text-[12px] text-rose-500 hover:text-rose-700 px-1.5" aria-label="Remove">×</button>
    </div>
  );
}

/**
 * PhotosArrayField — list editor for `config.photos: { url, caption }[]`.
 *
 * Used by every v2 PHOTO_* widget (NeonGlitch, PolaroidPin,
 * CrayonScrapbook, GlassMosaic, OpsContactSheet). Each entry is a
 * thumbnail + caption text + remove button + reorder controls.
 * Picking an image opens the same shared AssetLibraryModal as the
 * single AssetPickerField.
 *
 * 2026-05-04 — operator: "i picked an iage and nothing loaded, the
 * second one has a spot for two images but can only select one".
 * Pre-fix the editor only had the single-image AssetPickerField for
 * IMAGE/HERO_IMAGE which writes config.assetUrl. v2 PHOTO widgets
 * read config.photos[i].url so the assetUrl write was dead-code.
 */
function PhotosArrayField({ value, onChange }: { value: Array<{ url?: string; caption?: string }>; onChange: (v: Array<{ url?: string; caption?: string }>) => void }) {
  const [pickerOpen, setPickerOpen] = useState<number | null>(null);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const moveUp = (i: number) => {
    if (i === 0) return;
    const next = value.slice();
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    onChange(next);
  };
  const setCaption = (i: number, caption: string) => {
    const next = value.slice();
    next[i] = { ...(next[i] || {}), caption };
    onChange(next);
  };
  const setUrl = (i: number, url: string) => {
    const next = value.slice();
    next[i] = { ...(next[i] || {}), url };
    onChange(next);
  };
  return (
    <div>
      {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control:
          heads a dynamic photo list, not one control. */}
      <div className="block text-[10px] font-semibold text-slate-500 mb-1.5">Photos</div>
      <div className="space-y-2">
        {value.length === 0 && (
          <p className="text-[11px] text-slate-400 italic">No photos yet — click + below to add. Each photo can have an optional caption (e.g. &ldquo;Recess!&rdquo; / &ldquo;Reading Buddies&rdquo;).</p>
        )}
        {value.map((photo, idx) => (
          <div key={idx} className="flex items-center gap-2 p-1.5 bg-white border border-slate-200 rounded">
            <button
              type="button"
              onClick={() => setPickerOpen(idx)}
              className="w-12 h-12 rounded shrink-0 bg-slate-100 border border-slate-200 hover:border-indigo-400 hover:ring-2 hover:ring-indigo-200 overflow-hidden flex items-center justify-center transition-all"
              aria-label={photo.url ? 'Replace image' : 'Pick image'}
            >
              {photo.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                // 2026-05-30 — EGRESS FIX: 48px photo thumb → 96px transform
                <img src={transformedImageUrl(resolveAssetUrl(photo.url), { width: 96, quality: 60 })} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[18px] text-slate-400">+</span>
              )}
            </button>
            <input
              type="text"
              value={photo.caption || ''}
              onChange={(e) => setCaption(idx, e.target.value)}
              placeholder={`Caption ${idx + 1}`}
              className="flex-1 px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button type="button" onClick={() => moveUp(idx)} disabled={idx === 0} className="text-[10px] text-slate-400 hover:text-indigo-600 disabled:opacity-30 px-1" aria-label="Move up">↑</button>
            <button type="button" onClick={() => remove(idx)} className="text-[10px] text-rose-500 hover:text-rose-700 px-1" aria-label="Remove">×</button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setPickerOpen(value.length)}
          className="w-full py-1.5 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded border border-dashed border-indigo-200"
        >
          + Add photo from library
        </button>
      </div>
      {pickerOpen !== null && (
        <AssetLibraryModal
          kind="image"
          onPick={(url) => {
            const idx = pickerOpen;
            if (idx >= value.length) {
              onChange([...value, { url, caption: '' }]);
            } else {
              setUrl(idx, url);
            }
            setPickerOpen(null);
          }}
          onClose={() => setPickerOpen(null)}
        />
      )}
    </div>
  );
}

export function AssetLibraryModal({
  kind,
  onPick,
  onClose,
  multi = false,
  onPickMulti,
}: {
  kind: 'image' | 'video';
  onPick: (url: string) => void;
  onClose: () => void;
  /** When true, library tiles become checkboxes instead of single-pick.
   *  Operator selects N, hits "Add N selected", and the parent receives
   *  the array via onPickMulti. Falls back to onPick(first) if onPickMulti
   *  is not supplied so existing single-pick callers don't break. */
  multi?: boolean;
  onPickMulti?: (urls: string[]) => void;
}) {
  // MOBILE BUG #215 (2026-07-01) — this modal never called useOverlayLock(),
  // so the fixed MobileTabBar (z-[60]) and TopToolbar (sticky z-20) could
  // paint over its own Upload/Cancel toolbar on a phone even though the
  // modal itself is z-[10001]. Sibling picker AssetPicker.tsx already had
  // this fix (2026-06-27); this modal — the one PropertiesPanel + AddSidebar
  // actually mount — was missed. See use-overlay-lock.ts for why a body-level
  // z-index alone isn't sufficient (transformed/blurred DashboardLayout
  // ancestors create their own stacking contexts).
  useOverlayLock();
  const { data: assets, isLoading } = useAssets();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Wave B / editor-crush B1 (2026-07-02) — "Your library" vs "Stock photos"
  // tab. Image-only; video kind never shows the tab bar so stays 'library'.
  const [libraryTab, setLibraryTab] = useState<'library' | 'stock'>('library');
  // 2026-05-09 — operator: "for the carousel, i should be able to select
  // multiple videos or images at once". In multi mode tiles toggle into
  // a Set of picked URLs; the footer button confirms the batch.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // 2026-05-04 — operator: "none of the photo or images tabs upload
  // anything" + "dont make me only pick from assets i should be able
  // to browse and upload a photo from my PC without adding it as an
  // asset". The library modal previously was list-only ("Upload
  // from Assets first"), forcing operators to leave the editor.
  // Now: an Upload button at the top fires the same presign →
  // signed-PUT → complete-upload flow the /assets page uses, then
  // invalidates the assets query AND auto-picks the new file in
  // one motion. Asset still ends up in the library (operator's ask:
  // they don't want to MANAGE it as an asset, but the system needs
  // SOME storage backing — the library being shared is the cheap
  // way to deliver "upload anywhere, available everywhere").
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const filtered = (assets || []).filter((a: any) => {
    const mt = (a.mimeType || '').toLowerCase();
    return kind === 'image' ? mt.startsWith('image/') : mt.startsWith('video/');
  });
  // 2026-05-13 — Dropped video/quicktime. .mov files break on Android
  // signage players and aren't reliable in Edge/Safari. The library-side
  // /assets/presign endpoint also rejects them; keeping them out of the
  // template-builder media picker prevents an operator from trying to
  // upload a .mov here, watching it fail at the API, then being confused
  // about why their template's video zone is empty.
  const acceptAttr = kind === 'image'
    ? 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif'
    : 'video/mp4,video/webm';

  const handleUpload = async (file: File) => {
    setUploadError(null);
    // Fail fast on formats we already know won't play back. Mirrors the
    // server's REJECTED_EXTENSIONS / REJECTED_MIMES gate in
    // assets.controller.ts and the assets-page client-side check —
    // operator gets the actionable "export as MP4" message in <100ms
    // instead of after a 30-second upload that ends in a server reject.
    const lowerName = (file.name || '').toLowerCase();
    const lowerType = (file.type || '').toLowerCase();
    if (lowerName.endsWith('.mov') || lowerType === 'video/quicktime') {
      setUploadError("QuickTime .mov isn't supported (Android players and Edge refuse it). Export as MP4: QuickTime Player → File → Export As → 1080p, then upload the .mp4.");
      return;
    }
    if (lowerName.endsWith('.avi') || lowerType === 'video/x-msvideo') {
      setUploadError("AVI files aren't supported by browsers. Convert to MP4 (H.264) and re-upload.");
      return;
    }
    setUploading(true);
    try {
      const contentType = file.type || (kind === 'image' ? 'image/jpeg' : 'video/mp4');
      // Step 1: get a presigned upload URL.
      const presigned = await apiFetch<{
        uploadUrl?: string;
        signedUrl?: string;
        token?: string;
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
          folderId: null,
        }),
      });

      if (presigned.maxFileSize && file.size > presigned.maxFileSize) {
        throw new Error(`File too big (${Math.round(file.size / 1024 / 1024)}MB). Max ${Math.round(presigned.maxFileSize / 1024 / 1024)}MB.`);
      }

      // Step 2: PUT bytes directly to Supabase storage. Match the
      // working /assets page flow: prefer uploadUrl, fall back to
      // signedUrl. Supabase signed URLs only accept PUT (POST returns
      // a "headers must have required" error from the storage edge
      // handler — a Supabase quirk we hit on every MP4 upload after
      // the d29e6c5 direct-storage switch).
      const targetUrl = presigned.uploadUrl || presigned.signedUrl;
      if (!targetUrl) {
        throw new Error('Server did not return a signed upload URL. Ask your admin to check Supabase Storage config.');
      }
      const putRes = await fetch(targetUrl, {
        method: 'PUT',
        headers: {
          'content-type': presigned.mimeType || contentType,
          // SUPABASE EGRESS FIX (2026-05-23): see /assets/page.tsx for
          // the full reasoning. Without this, Supabase signed-URL
          // uploads default to `cache-control: no-cache` which forces
          // every player/browser to re-download on every fetch.
          'cache-control': 'public, max-age=31536000, immutable',
        },
        body: file,
      });
      if (!putRes.ok) {
        // Pull a useful error out of Supabase's response body if it
        // gave us one; surface the generic status code otherwise.
        let detail = '';
        try {
          const txt = await putRes.text();
          if (txt) detail = ` — ${txt.slice(0, 200)}`;
        } catch { /* ignore */ }
        throw new Error(`Storage upload failed (${putRes.status})${detail}`);
      }

      // Step 3: register the asset in our DB.
      const completed = await apiFetch<{ id?: string; fileUrl: string }>('/assets/complete-upload', {
        method: 'POST',
        body: JSON.stringify({
          storagePath: presigned.storagePath,
          filename: file.name,
          contentType: presigned.mimeType || contentType,
          size: file.size,
          folderId: null,
        }),
      });

      // Refresh the list so the new asset appears. In single-pick mode
      // we auto-confirm (operator's flow: "click Upload → file dialog
      // → done, widget shows their photo"). In multi mode we just add
      // the new URL to the selected set so the operator can keep
      // picking more before hitting "Add N selected".
      await queryClient.invalidateQueries({ queryKey: ['assets'] });
      const finalUrl = completed.fileUrl || presigned.fileUrl;
      if (!finalUrl) throw new Error('Upload completed but server did not return a file URL.');
      if (multi) {
        setPicked((prev) => new Set(prev).add(finalUrl));
      } else {
        onPick(finalUrl);
      }
    } catch (e: any) {
      // Console too — Vercel/Sentry won't capture these errors otherwise.
      // eslint-disable-next-line no-console
      console.error('[asset-upload] failed', e);
      setUploadError(e?.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleUpload(file);
    }
    // Reset so picking the same file twice still fires onChange.
    e.target.value = '';
  };

  return (
    <div
      // top/right/bottom/left longhand (NOT inset-0) — matches AssetPicker.tsx
      // and the CLAUDE.md #10 convention. z-[10001] paints over the mobile
      // TopToolbar (z-20) and MobileTabBar (z-[60] — hidden via useOverlayLock
      // above anyway). Safe-area padding keeps the modal clear of the notch /
      // home indicator on short viewports.
      className="fixed top-0 right-0 bottom-0 left-0 z-[10001] flex items-center justify-center p-4"
      style={{
        paddingTop: 'max(16px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))',
      }}
      role="dialog"
      aria-modal="true"
    >
      {/* a11y wave (2026-08-24) — jsx-a11y/click-events-have-key-events +
          no-static-element-interactions. This is a modal backdrop: a
          mouse-only "click outside to close" convenience layered on top of
          the real, fully keyboard/AT-accessible dismissal path — the
          labeled <button aria-label="Close"> a few lines below. Giving the
          backdrop role="button"+tabIndex+onKeyDown would insert an
          invisible full-viewport tab stop ahead of the actual dialog
          content, which is worse for keyboard users than leaving it
          non-interactive to assistive tech. Same pattern as
          AppDialogHost's backdrop in app-dialog.tsx. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className="absolute top-0 right-0 bottom-0 left-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl ring-1 ring-slate-200 max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-800">
            {multi
              ? (kind === 'image' ? 'Pick photos' : 'Pick videos')
              : (kind === 'image' ? 'Pick an image' : 'Pick a video')}
            {multi && picked.size > 0 && (
              <span className="ml-2 text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                {picked.size} selected
              </span>
            )}
          </h2>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100">
            <XIcon className="w-4 h-4" aria-hidden />
          </button>
        </div>

        {/* Wave B / editor-crush B1 (2026-07-02) — "Stock photos" tab next to
            "Your library". Image-only (Pexels has no video search); video
            pickers never render the tab bar so nothing changes for them.
            AiImageGenerateButton (B6b) rides the same tab bar — mounted only
            when the tenant has an image-capable AI provider configured. */}
        {kind === 'image' && (
          <div className="flex gap-1 px-4 pt-3 border-b border-slate-100" role="tablist" aria-label="Image source">
            <TabButton label="Your library" active={libraryTab === 'library'} onClick={() => setLibraryTab('library')} />
            <TabButton label="Stock photos" active={libraryTab === 'stock'} onClick={() => setLibraryTab('stock')} />
          </div>
        )}

        {libraryTab === 'stock' && kind === 'image' ? (
          <div className="flex-1 overflow-y-auto p-3">
            <StockPhotoSearch onPick={(url) => { onPick(url); }} />
            <div className="mt-3 pt-3 border-t border-slate-100">
              <AiImageGenerateButton onGenerated={(asset) => onPick(asset.fileUrl)} />
            </div>
          </div>
        ) : (
        <>
        {/* Upload section — operator's primary path now. Hidden file
            input + a big visible button + drag-drop helper text. */}
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptAttr}
            onChange={onFilePicked}
            className="hidden"
            aria-label={`Upload a ${kind} from your computer`}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full py-3 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-sm font-bold inline-flex items-center justify-center gap-2 hover:from-indigo-700 hover:to-violet-700 disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
          >
            {uploading ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="8" r="6" strokeOpacity="0.25" /><path d="M14 8a6 6 0 0 0-6-6" /></svg>
                Uploading…
              </>
            ) : (
              <>📤 Upload {kind === 'image' ? 'image' : 'video'} from your computer</>
            )}
          </button>
          {uploadError && (
            <div className="mt-2 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1.5">
              {uploadError}
            </div>
          )}
          <div className="mt-2 text-[10px] text-slate-500">
            Or pick from {kind === 'image' ? 'images' : 'videos'} you&apos;ve already added below.
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="text-center text-xs text-slate-400 py-12">Loading library…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-xs text-slate-400 py-12">
              Library is empty — upload a {kind === 'image' ? 'photo' : 'video'} above to get started.
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {filtered.map((a: any) => {
                const url = a.fileUrl || a.url;
                const isPicked = picked.has(url);
                const handleClick = () => {
                  if (multi) {
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (next.has(url)) next.delete(url);
                      else next.add(url);
                      return next;
                    });
                  } else {
                    onPick(url);
                  }
                };
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={handleClick}
                    aria-pressed={multi ? isPicked : undefined}
                    className={`group relative aspect-square rounded-lg overflow-hidden bg-slate-100 border transition-all ${isPicked ? 'border-indigo-500 ring-2 ring-indigo-400' : 'border-slate-200 hover:border-indigo-400 hover:ring-2 hover:ring-indigo-200'}`}
                  >
                    {kind === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      // 2026-05-30 — EGRESS FIX: asset picker grid tiles → 320px transform
                      <img src={transformedImageUrl(resolveAssetUrl(url), { width: 320, quality: 60 })} alt={a.originalName || ''} className="w-full h-full object-cover" />
                    ) : (
                      // 2026-05-30 — EGRESS FIX: preload="none" for video picker tiles
                      <video src={resolveAssetUrl(url)} className="w-full h-full object-cover" muted preload="none" />
                    )}
                    {multi && (
                      <div className={`absolute top-1.5 left-1.5 w-5 h-5 rounded-md border-2 flex items-center justify-center text-[12px] font-bold ${isPicked ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white/80 border-white text-transparent'}`}>
                        ✓
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent text-white text-[9px] font-bold px-1.5 py-1 truncate">
                      {a.originalName || url}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {multi && (
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-[11px] text-slate-500 hover:text-slate-700 px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (picked.size === 0) return;
                const arr = Array.from(picked);
                if (onPickMulti) onPickMulti(arr);
                else onPick(arr[0]);
              }}
              disabled={picked.size === 0}
              className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add {picked.size > 0 ? picked.size : ''} {kind === 'image' ? 'photo' : 'video'}{picked.size === 1 ? '' : 's'}
            </button>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-3 py-1.5 text-[11px] font-bold rounded-t-lg border-b-2 transition-colors ${
        active
          ? 'text-indigo-600 border-indigo-600 bg-indigo-50/50'
          : 'text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );
}

function resolveAssetUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) return url;
  const base = (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_API_URL)
    ? process.env.NEXT_PUBLIC_API_URL.replace('/api/v1', '')
    : 'http://localhost:8080';
  return `${base}${url}`;
}

function PlaylistPickerField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { data: playlists, isLoading } = usePlaylists();
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm cursor-pointer"
      >
        <option value="">— Pick a playlist —</option>
        {(playlists || []).map((p: any) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      {isLoading && <p className="text-[10px] text-slate-400 mt-1">Loading playlists…</p>}
      {!isLoading && (!playlists || playlists.length === 0) && (
        <p className="text-[10px] text-slate-400 mt-1">No playlists yet — create one in <strong>Playlists</strong>.</p>
      )}
    </div>
  );
}

// ─── Streaming channel picker ──────────────────────────────────────────
//
// Sprint 8c follow-up (2026-05-03). When the operator drops a STREAMING
// or FITNESS_LIVE_TV widget on the canvas, they need to pick from
// channels they've connected via Settings → Streaming. Without this
// picker the widget needed JSON-edited config to play anything — the
// integration was wired through the API but invisible in the editor.
//
// Picking a channel populates ALL the playback fields the widget needs:
//   • playbackUrl (HLS m3u8)  OR  embedUrl (iframe)
//   • playbackType (hls / dash / iframe)
//   • channelTitle (display text in the widget bug)
//   • allowAdOverlay (channel-level flag from the catalog)
//   • streamingChannelId (so we can re-resolve later)
//
// "Refresh" re-fetches /streaming/channels/:id so a channel that had its
// signed playback URL rotated server-side updates without the operator
// re-picking. No-op if the channel was deleted (clears the fields and
// surfaces a "channel disconnected" warning).
interface StreamingChannelDto {
  id: string;
  connectionId: string;
  providerId: string;
  externalId: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  category?: string;
  playbackUrl?: string;
  playbackType?: string;
  allowAdOverlay: boolean;
  status: string;
}

function StreamingChannelPickerField({
  value,
  onPick,
  onClear,
}: {
  value: string;
  onPick: (channel: StreamingChannelDto) => void;
  onClear: () => void;
}) {
  // Cycle-2 BUG-005 fix (2026-05-03) — relative href resolved to
  // /[schoolId]/templates/[id]/edit/settings/streaming (404). Resolve
  // the schoolId from the dynamic route segment so the link points at
  // /[schoolId]/settings/streaming regardless of where the picker is
  // rendered.
  const params = useParams<{ schoolId?: string | string[] }>();
  const schoolId = Array.isArray(params?.schoolId) ? params.schoolId[0] : params?.schoolId;
  // CYCLE-5 streaming-picker-no-catch fix — surface query errors instead
  // of leaving the picker spinning forever on 401 / 5xx / transient
  // network drops. `isError` from useQuery toggles the error message
  // below; `isLoading` only fires while the request is in flight.
  const { data: channels, isLoading, isError } = useQuery<StreamingChannelDto[]>({
    queryKey: ['streaming-channels-picker'],
    queryFn: () => apiFetch<StreamingChannelDto[]>('/streaming/channels'),
    staleTime: 30_000,
  });
  const picked = (channels || []).find((c) => c.id === value);
  // a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control.
  const id = useId();

  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
        <Tv className="w-3 h-3" /> Streaming channel
      </label>
      <select
        id={id}
        value={value || ''}
        onChange={(e) => {
          const id = e.target.value;
          if (!id) { onClear(); return; }
          const ch = (channels || []).find((c) => c.id === id);
          if (ch) onPick(ch);
        }}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm cursor-pointer"
      >
        <option value="">— Pick a channel —</option>
        {(channels || []).map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}{c.category ? ` · ${c.category}` : ''}
          </option>
        ))}
      </select>
      {isLoading && <p className="text-[10px] text-slate-400 mt-1">Loading channels…</p>}
      {!isLoading && isError && (
        <p className="text-[10px] text-rose-600 mt-1">
          Couldn't load channels — try refresh.
        </p>
      )}
      {!isLoading && !isError && (!channels || channels.length === 0) && (
        <p className="text-[10px] text-slate-400 mt-1">
          No channels picked yet — connect a provider + pick channels in{' '}
          <a href={schoolId ? `/${schoolId}/settings/streaming` : '/settings/streaming'} className="underline text-indigo-600 inline-flex items-center gap-0.5">
            Settings → Streaming <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </p>
      )}
      {picked && (
        <div className="mt-2 px-2 py-1.5 rounded bg-slate-50 border border-slate-200/60 text-[10px] text-slate-600 flex items-center gap-1.5">
          <span className="font-bold">{picked.providerId}</span>
          <span className="text-slate-400">·</span>
          <span>{picked.playbackType || 'hls'}</span>
          {picked.allowAdOverlay && <span className="ml-auto text-emerald-600 font-bold">Ad overlay OK</span>}
        </div>
      )}
    </div>
  );
}

// ─── POS category picker ──────────────────────────────────────────────
//
// Sprint 8d follow-up (2026-05-03). Menu-board widgets (RESTAURANT_MENU_BOARD,
// BAR_TAP_LIST, BAR_COCKTAIL_MENU, RETAIL_PRODUCT_GRID) need to pull
// from the live PosMenuItem catalog the operator synced from Square /
// Toast / Clover / etc. The picker fetches /pos/categories so the
// operator can scope a board to e.g. "Burgers" or "On Tap" instead of
// dumping every item from every category onto one screen.
//
// Falls back gracefully when no POS is connected — admin sees
// "Connect a POS first" with link to settings/pos.
interface PosCategoryDto {
  id: string;
  name: string;
  itemCount: number;
}

// Shape of one row from GET /pos/items (subset we need for the per-item
// binding picker). Mirrors PosMenuItem in @cms/api-types.
interface PosMenuItemDto {
  id: string;
  externalId: string;
  name: string;
  priceCents: number;
  category?: string;
}

function PosCategoryPickerField({
  label,
  value,
  onChange,
  tone = 'light',
}: {
  label: string;
  value: string;
  onChange: (categoryId: string) => void;
  /** 'amber' = themed for the dark "Driven by POS" mapping card; 'light'
   *  (default) = the standard slate content-field panel. */
  tone?: 'light' | 'amber';
}) {
  const amber = tone === 'amber';
  // Cycle-2 BUG-005 fix (2026-05-03) — see StreamingChannelPickerField
  // above. Resolve schoolId from the dynamic route so the link to
  // settings/pos lands at /[schoolId]/settings/pos.
  const params = useParams<{ schoolId?: string | string[] }>();
  const schoolId = Array.isArray(params?.schoolId) ? params.schoolId[0] : params?.schoolId;
  // CYCLE-5 pos-picker-error-swallow fix — the previous .catch(() => [])
  // hid every transient 5xx behind an empty result, making operators
  // think no POS was connected when really the categories endpoint was
  // briefly down. Surface isError separately so the empty-list path
  // genuinely means "no POS connected" and the fetch-failed path shows
  // a different message.
  const { data: categories, isLoading, isError } = useQuery<PosCategoryDto[]>({
    queryKey: ['pos-categories-picker'],
    queryFn: () => apiFetch<PosCategoryDto[]>('/pos/categories'),
    staleTime: 60_000,
  });

  return (
    <div>
      <label className={amber ? 'block text-[10px] font-semibold text-[#fcd34d] mb-1.5' : 'block text-[10px] font-semibold text-slate-500 mb-1.5'}>{label}</label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className={amber
          ? 'w-full px-3 py-2 rounded-lg bg-[#7c2d12] border border-[#b45309] text-[#fde68a] text-xs font-medium focus:outline-none focus:ring-2 focus:ring-amber-400 transition-all cursor-pointer'
          : 'w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm cursor-pointer'}
      >
        <option value="">— All categories —</option>
        {(categories || []).map((cat) => (
          <option key={cat.id} value={cat.id}>
            {cat.name} ({cat.itemCount})
          </option>
        ))}
      </select>
      {isLoading && <p className={amber ? 'text-[10px] text-[#fdba74] mt-1' : 'text-[10px] text-slate-400 mt-1'}>Loading POS catalog…</p>}
      {!isLoading && isError && (
        <p className="text-[10px] text-rose-600 mt-1">
          Couldn't load POS categories — try refresh.
        </p>
      )}
      {!isLoading && !isError && (!categories || categories.length === 0) && (
        <p className={amber ? 'text-[10px] text-[#fdba74] mt-1' : 'text-[10px] text-slate-400 mt-1'}>
          No POS connected yet —{' '}
          <a href={schoolId ? `/${schoolId}/settings/pos` : '/settings/pos'} className="underline text-indigo-600 inline-flex items-center gap-0.5">
            connect Square / Toast / Clover <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// PosItemBindField — bind ONE template text field to a live POS item.
//
// 2026-05-29 — BYO field-binding (docs/research/2026-05-29-menu-mgmt-
// scale §"Tier 3"). The per-CATEGORY posSync above fills a whole menu
// board. This binds a SINGLE field on a customer's OWN designed
// (EXTERNAL_HTML) template to a specific catalog item's live value, so
// e.g. their hand-built hero "$8.99" tracks the real Square price per
// location. The binding is stored as cfg.posItemBindings[fieldKey] and
// mirrored as a `{{pos.item:<externalId>.<field>}}` token in
// textOverrides (which already rides the `?text=` transport) — the
// server resolves it per the screen's location at render.
//
// Two states:
//   • bound → a chip showing the item + which value, with an unbind.
//   • unbound → a collapsed "Bind to a menu item" link that expands to
//     an item picker + value selector (price / name / availability).
function PosItemBindField({
  label,
  binding,
  onBind,
}: {
  label: string;
  binding: { externalId: string; field: 'price' | 'name' | 'available' } | undefined;
  onBind: (b: { externalId: string; field: 'price' | 'name' | 'available' } | null) => void;
}) {
  const params = useParams<{ schoolId?: string | string[] }>();
  const schoolId = Array.isArray(params?.schoolId) ? params.schoolId[0] : params?.schoolId;
  const [open, setOpen] = useState(false);

  // Only fetch the catalog once the operator opens the picker (or a
  // binding already exists, so we can resolve the item's name to show).
  const enabled = open || !!binding;
  const { data: items, isLoading, isError } = useQuery<PosMenuItemDto[]>({
    queryKey: ['pos-items-bind-picker'],
    queryFn: () => apiFetch<PosMenuItemDto[]>('/pos/items'),
    staleTime: 60_000,
    enabled,
  });

  const FIELD_LABEL: Record<'price' | 'name' | 'available', string> = {
    price: 'Price',
    name: 'Name',
    available: 'In-stock flag',
  };

  if (binding) {
    const item = (items || []).find((i) => i.externalId === binding.externalId);
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 flex items-center gap-1">
            <Link2 className="w-3 h-3" /> {label}
          </div>
          <div className="text-[11px] text-emerald-800 truncate">
            live {FIELD_LABEL[binding.field].toLowerCase()} from{' '}
            <span className="font-semibold">{item?.name || binding.externalId}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onBind(null)}
          title="Unbind — go back to manual text"
          aria-label="Unbind from POS item"
          className="inline-flex items-center justify-center w-6 h-6 rounded text-emerald-600 hover:text-rose-600 hover:bg-white transition-colors shrink-0"
        >
          <Unlink className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 hover:text-indigo-700"
      >
        <Link2 className="w-3 h-3" /> Bind to a live menu item
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 p-2.5 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Bind {label}</span>
        <button type="button" onClick={() => setOpen(false)} className="text-indigo-400 hover:text-indigo-600" aria-label="Cancel binding">
          <XIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      {isLoading ? (
        <p className="text-[10px] text-slate-400">Loading menu items…</p>
      ) : isError ? (
        <p className="text-[10px] text-rose-600">Couldn&rsquo;t load items — try refresh.</p>
      ) : !items || items.length === 0 ? (
        <p className="text-[10px] text-slate-500">
          No POS connected yet —{' '}
          <a href={schoolId ? `/${schoolId}/settings/pos` : '/settings/pos'} className="underline text-indigo-600 inline-flex items-center gap-0.5">
            connect a POS <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </p>
      ) : (
        <PosItemBindControls items={items} fieldLabels={FIELD_LABEL} onConfirm={(b) => { onBind(b); setOpen(false); }} />
      )}
    </div>
  );
}

function PosItemBindControls({
  items,
  fieldLabels,
  onConfirm,
}: {
  items: PosMenuItemDto[];
  fieldLabels: Record<'price' | 'name' | 'available', string>;
  onConfirm: (b: { externalId: string; field: 'price' | 'name' | 'available' }) => void;
}) {
  const [externalId, setExternalId] = useState('');
  const [field, setField] = useState<'price' | 'name' | 'available'>('price');
  return (
    <div className="space-y-2">
      <select
        value={externalId}
        onChange={(e) => setExternalId(e.target.value)}
        className="w-full px-2.5 py-2 rounded-md bg-white border border-slate-200 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 cursor-pointer"
      >
        <option value="">— pick a menu item —</option>
        {items.map((i) => (
          <option key={i.externalId} value={i.externalId}>
            {i.name} (${(i.priceCents / 100).toFixed(2)})
          </option>
        ))}
      </select>
      <div className="flex items-center gap-1.5">
        {(['price', 'name', 'available'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setField(f)}
            className={[
              'flex-1 px-2 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wide transition-colors',
              field === f ? 'bg-indigo-600 text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-indigo-300',
            ].join(' ')}
          >
            {fieldLabels[f]}
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={!externalId}
        onClick={() => externalId && onConfirm({ externalId, field })}
        className="w-full px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold transition-colors"
      >
        Bind this field
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// SmartLocationField — single input for the WEATHER widget that
// accepts a 5-digit US zip, a city name, OR "lat,lng" coordinates.
// Includes a "Use my current location" button that calls the
// browser's geolocation API and writes "lat,lng" into the config.
// fetchWeather() in WidgetRenderer.tsx detects all three formats
// and resolves to lat/lng + name automatically.
//
// 2026-05-04 — operator: "i should be able to type a location or
// zipcode or it should know where i am automatically and set it
// but its a bunch of free text fields".
function SmartLocationField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  // a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control.
  const locationFieldId = useId();
  const [draft, setDraft] = useState(value);
  const [geolocating, setGeolocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  useEffect(() => { setDraft(value); }, [value]);

  const useCurrentLocation = () => {
    setGeoError(null);
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError("Your browser doesn't support geolocation.");
      return;
    }
    setGeolocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude.toFixed(4);
        const lng = pos.coords.longitude.toFixed(4);
        const next = `${lat},${lng}`;
        setDraft(next);
        onChange(next);
        setGeolocating(false);
      },
      (err) => {
        setGeolocating(false);
        if (err.code === err.PERMISSION_DENIED) {
          setGeoError('Location permission denied. Type a zip or city name instead.');
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setGeoError("Couldn't determine your location. Try typing a zip or city.");
        } else {
          setGeoError('Location lookup failed. Try typing a zip or city.');
        }
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600_000 },
    );
  };

  return (
    <div className="space-y-1.5">
      {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control */}
      <label htmlFor={locationFieldId} className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Location
      </label>
      <div className="flex gap-2">
        <input
          id={locationFieldId}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft !== value) onChange(draft); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }}
          placeholder="44024 or Cleveland, OH"
          className="flex-1 px-3 py-2 rounded-md border border-slate-300 bg-white text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
        />
        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={geolocating}
          title="Use this device's current location (browser geolocation)"
          className="flex-shrink-0 px-3 py-2 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100 disabled:opacity-60 inline-flex items-center gap-1"
        >
          {geolocating ? (
            <>
              <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="8" cy="8" r="6" strokeOpacity="0.25" /><path d="M14 8a6 6 0 0 0-6-6" /></svg>
              Locating…
            </>
          ) : (
            <>📍 Use my location</>
          )}
        </button>
      </div>
      <div className="text-[10px] text-slate-500 leading-relaxed">
        Type a US zip (e.g. <span className="font-mono">44024</span>), a city name (e.g. <span className="font-mono">Cleveland, OH</span>), or click <strong>Use my location</strong>. Live weather pulls from Open-Meteo (free, no key) and refreshes every 15 minutes on each screen.
      </div>
      {geoError && (
        <div className="text-[10px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-2 py-1">
          {geoError}
        </div>
      )}
    </div>
  );
}

// WeatherOverrideAdvanced — collapsible section containing the
// manual override fields (tempF / high / low / condition / icon).
// Empty by default — operator never has to touch these. Opens to
// reveal the inputs only if they want to fake a weather state for
// a static demo / signage drill.
function WeatherOverrideAdvanced({ cfg, weatherUnits, setField }: { cfg: any; weatherUnits: 'imperial' | 'metric'; setField: (patch: Record<string, any>) => void }) {
  const hasOverride = (cfg.tempF != null && cfg.tempF !== '') ||
    (cfg.high != null && cfg.high !== '') ||
    (cfg.low != null && cfg.low !== '') ||
    !!cfg.condition || !!cfg.staticDesc || !!cfg.staticIcon;
  const [open, setOpen] = useState(hasOverride);

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-100/60"
      >
        <span className="text-[11px] font-semibold text-slate-700">
          Advanced — override live data {hasOverride && <span className="text-amber-600 font-bold">(active)</span>}
        </span>
        <span className="text-[10px] text-slate-400">{open ? '▾ Hide' : '▸ Show'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 border-t border-slate-200">
          <div className="text-[10px] text-slate-500 leading-relaxed pt-2">
            Leave these BLANK to use real-time weather from the location above. Filling any field forces that value to display instead of the live feed — useful for demos or signage drills.
          </div>
          <TextField label={`Override current temp (${weatherUnits === 'metric' ? '°C' : '°F'})`} value={cfg.tempF != null ? String(cfg.tempF) : ''} placeholder="(blank = live)" onChange={(v) => { if (!v) { setField({ tempF: undefined, staticTemp: undefined }); return; } const n = parseInt(v); if (Number.isFinite(n)) setField({ tempF: n, staticTemp: n }); }} />
          <TextField label="Override high" value={cfg.high != null ? String(cfg.high) : ''} placeholder="(blank = live)" onChange={(v) => { if (!v) { setField({ high: undefined }); return; } const n = parseInt(v); if (Number.isFinite(n)) setField({ high: n }); }} />
          <TextField label="Override low" value={cfg.low != null ? String(cfg.low) : ''} placeholder="(blank = live)" onChange={(v) => { if (!v) { setField({ low: undefined }); return; } const n = parseInt(v); if (Number.isFinite(n)) setField({ low: n }); }} />
          <TextField label="Override condition" value={cfg.condition || cfg.staticDesc || ''} placeholder="(blank = live)" onChange={(v) => setField({ condition: v || undefined, staticDesc: v || undefined })} />
          <TextField label="Override icon (emoji)" value={cfg.staticIcon || ''} placeholder="☀️ (blank = live)" onChange={(v) => setField({ staticIcon: v || undefined })} />
        </div>
      )}
    </div>
  );
}

// TickerSpeedField — shared across every animated widget that has
// a bottom ticker (3 welcomes + cafeteria). Stores 'slow' | 'normal'
// | 'fast' in config.tickerSpeed. The widget multiplies its own
// base animation duration by 1.8 (slow) or 0.6 (fast); 'normal' is
// the originally-approved speed. Keep the 3-option UX simple — this
// is an admin-facing knob, not a video editor.
// ─────────────────────────────────────────────────────────
function TickerSpeedField({ value, onChange }: { value: 'slow' | 'normal' | 'fast' | number | undefined; onChange: (v: 'slow' | 'normal' | 'fast') => void }) {
  const active = (typeof value === 'string' && (value === 'slow' || value === 'fast')) ? value : 'normal';
  return (
    <div className="space-y-1">
      {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control:
          heads 3 toggle <button>s, not one control. */}
      <div className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Scroll speed
      </div>
      <div className="flex gap-1">
        {(['slow', 'normal', 'fast'] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-bold tracking-wider uppercase transition ${
              active === opt
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {opt === 'slow' ? '🐢 Slow' : opt === 'fast' ? '⚡ Fast' : 'Normal'}
          </button>
        ))}
      </div>
      <div className="text-[10px] text-slate-400 italic pl-1">
        {active === 'slow' ? 'Easier to read — good for cafeteria + hallway screens.' : active === 'fast' ? 'Quick cycles — good for dashboards with lots of items.' : 'Default comfortable reading pace.'}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Weekly cafeteria menu editor — 5 day tabs, unlimited items per day.
// Data shape: { monday: [{emoji,name,meta,price}], tuesday: [...], ... }
// The rendered cafeteria widget picks today's day via new Date().getDay()
// and shows that day's menu automatically.
// ─────────────────────────────────────────────────────────
type CafeItem = { emoji?: string; name?: string; meta?: string; price?: string };
type CafeWeek = Record<'monday'|'tuesday'|'wednesday'|'thursday'|'friday', CafeItem[]>;
const CAFE_DAYS: Array<{ key: keyof CafeWeek; label: string }> = [
  { key: 'monday',    label: 'MON' },
  { key: 'tuesday',   label: 'TUE' },
  { key: 'wednesday', label: 'WED' },
  { key: 'thursday',  label: 'THU' },
  { key: 'friday',    label: 'FRI' },
];

// Standard lunch-item emoji picker — one-click replacement for typing
// in an emoji by hand. Grouped by rough category so admins scan fast.
// Keep this list flat + readable; we can grow it by user request.
const LUNCH_EMOJI_GROUPS: Array<{ label: string; items: string[] }> = [
  { label: 'Mains',    items: ['🍕','🍔','🌮','🌯','🥪','🥙','🌭','🍝','🍜','🍣','🍱','🍗','🍖','🥘','🍲','🍛','🍳','🥚','🍞','🥖','🥐'] },
  { label: 'Sides',    items: ['🍟','🥗','🥙','🥣','🍚','🍜','🌽','🥔','🥦','🥕','🥒','🍅','🌶️','🌰','🧅','🫘','🥜','🫑'] },
  { label: 'Fruit',    items: ['🍎','🍏','🍌','🍓','🍇','🍉','🍊','🍋','🍑','🍒','🥝','🍍','🥭','🫐','🍈','🫒'] },
  { label: 'Drinks',   items: ['🥛','🧃','🧋','☕','🍵','🥤','💧'] },
  { label: 'Desserts', items: ['🍪','🧁','🎂','🍰','🍩','🍦','🍨','🍫','🍬','🍭','🥧','🍮','🍯'] },
];

// Small popover emoji+upload picker for a single item's emoji slot.
// Renders a button showing the current emoji (or a plate icon if unset)
// that toggles a 2-tab pop: pick from common lunch emojis, or upload an
// image. The cafeteria widget renders an <img> when the "emoji" field is
// a URL (starts with http or /), otherwise renders it as text — so both
// paths just write to the same `emoji` string on the item.
function LunchEmojiPicker({ value, onChange }: { value: string | undefined; onChange: (v: string) => void }) {
  // a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control.
  const emojiInputId = useId();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'emoji' | 'upload'>('emoji');
  const pickerRef = useRef<HTMLDivElement | null>(null);
  // Close on outside click so admins can click into the name field
  // without the picker sitting there eating focus.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const current = value || '';
  const isUrl = /^(https?:|\/)/i.test(current);

  return (
    <div className="relative" ref={pickerRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-14 h-10 px-2 rounded border border-slate-200 bg-white text-center text-lg hover:border-indigo-300 hover:bg-indigo-50 transition flex items-center justify-center overflow-hidden"
        aria-label={isUrl ? 'Change uploaded image' : 'Pick food emoji or upload image'}
        title="Pick emoji / upload"
      >
        {isUrl
          // 2026-05-30 — EGRESS FIX: 56px food icon preview → 112px transform
          ? <img src={transformedImageUrl(current, { width: 112, quality: 60 })} alt="" className="w-full h-full object-contain" />
          : <span>{current || '🍽️'}</span>}
      </button>
      {open && (
        <div
          className="absolute z-50 mt-1 left-0 w-[320px] bg-white border border-slate-200 rounded-xl shadow-xl p-2"
          role="dialog"
          aria-label="Food emoji / image picker"
        >
          <div className="flex gap-1 mb-2 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setTab('emoji')}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-md transition ${
                tab === 'emoji' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              😀 Emoji
            </button>
            <button
              type="button"
              onClick={() => setTab('upload')}
              className={`flex-1 py-1.5 text-[11px] font-bold rounded-md transition ${
                tab === 'upload' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-800'
              }`}
            >
              🖼️ Upload image
            </button>
          </div>

          {tab === 'emoji' && (
            <div className="max-h-[320px] overflow-y-auto pr-1">
              {LUNCH_EMOJI_GROUPS.map((group) => (
                <div key={group.label} className="mb-3">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1 mb-1.5">
                    {group.label}
                  </div>
                  <div className="grid grid-cols-7 gap-1">
                    {group.items.map((e) => (
                      <button
                        key={e}
                        type="button"
                        onClick={() => { onChange(e); setOpen(false); }}
                        className={`text-2xl p-1 rounded-md transition ${
                          current === e ? 'bg-indigo-100 ring-2 ring-indigo-400' : 'hover:bg-slate-100'
                        }`}
                        aria-label={`Pick ${e}`}
                        title={e}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="border-t border-slate-100 pt-2 mt-1">
                <label htmlFor={emojiInputId} className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Or type any emoji / text</label>
                <input
                  id={emojiInputId}
                  type="text"
                  defaultValue={isUrl ? '' : current}
                  placeholder="🍱 or any emoji"
                  onBlur={(e) => onChange(e.target.value)}
                  className="w-full px-2 py-1.5 rounded border border-slate-200 text-sm text-center"
                />
              </div>
            </div>
          )}

          {tab === 'upload' && (
            <div className="space-y-2 p-1">
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Upload a PNG, JPG, or SVG. Keep it square — it'll render at ~80px in the widget. Emojis still work; uploading replaces the emoji for this item only.
              </p>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  // Read as data URL so the preview updates instantly. In
                  // the production editor flow this would hand off to the
                  // existing AssetPickerField / presigned-upload endpoint;
                  // kept inline here so it works without an extra round-trip.
                  const reader = new FileReader();
                  reader.onload = () => {
                    const result = reader.result;
                    if (typeof result === 'string') {
                      onChange(result);
                      setOpen(false);
                    }
                  };
                  reader.readAsDataURL(file);
                }}
                className="w-full text-xs"
              />
              {isUrl && (
                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                  {/* 2026-05-30 — EGRESS FIX: 40px food icon current → 80px transform */}
                  <img src={transformedImageUrl(current, { width: 80, quality: 60 })} alt="" className="w-10 h-10 object-contain rounded border border-slate-200" />
                  <button
                    type="button"
                    onClick={() => { onChange('🍽️'); setOpen(false); }}
                    className="text-[11px] text-rose-600 hover:text-rose-700 font-semibold"
                  >
                    Remove image · back to emoji
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WeekMenuEditor({ value, onChange }: { value: Partial<CafeWeek> | undefined; onChange: (next: CafeWeek) => void }) {
  const [activeDay, setActiveDay] = useState<keyof CafeWeek>('monday');
  // Normalize to a full 5-day structure so we never fight undefineds.
  const week: CafeWeek = {
    monday:    value?.monday    || [],
    tuesday:   value?.tuesday   || [],
    wednesday: value?.wednesday || [],
    thursday:  value?.thursday  || [],
    friday:    value?.friday    || [],
  };
  const items = week[activeDay];

  const update = (idx: number, patch: Partial<CafeItem>) => {
    const next = { ...week, [activeDay]: week[activeDay].map((it, i) => i === idx ? { ...it, ...patch } : it) };
    onChange(next);
  };
  const add = () => {
    const next = { ...week, [activeDay]: [...week[activeDay], { emoji: '🍽️', name: '', meta: '', price: '' }] };
    onChange(next);
  };
  const remove = (idx: number) => {
    const next = { ...week, [activeDay]: week[activeDay].filter((_, i) => i !== idx) };
    onChange(next);
  };
  const copyMondayToWeek = () => {
    onChange({
      monday:    week.monday,
      tuesday:   week.monday.map(it => ({ ...it })),
      wednesday: week.monday.map(it => ({ ...it })),
      thursday:  week.monday.map(it => ({ ...it })),
      friday:    week.monday.map(it => ({ ...it })),
    });
  };

  return (
    <div className="space-y-2">
      {/* Day tabs */}
      <div className="flex gap-1">
        {CAFE_DAYS.map((d) => (
          <button
            key={d.key}
            type="button"
            onClick={() => setActiveDay(d.key)}
            className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-bold tracking-wider transition ${
              activeDay === d.key
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {d.label}
            <span className={`ml-1 text-[9px] opacity-70`}>({week[d.key].length})</span>
          </button>
        ))}
      </div>

      {items.length === 0 && (
        <div className="text-[11px] text-slate-400 italic px-1 py-3 text-center border border-dashed border-slate-200 rounded-md">
          No items yet. Click + Add below to start the {activeDay} menu.
        </div>
      )}

      {items.map((it, idx) => (
        <div key={idx} className="bg-white border border-slate-200 rounded-lg p-2 space-y-1.5 shadow-sm">
          <div className="flex items-start gap-1.5">
            {/* Emoji picker: click to open a 2-tab popover (common lunch
                emojis grouped by category, or upload an image) — no more
                typing emoji by hand. The `emoji` field accepts a string
                OR a URL / data URL; the widget renders img if URL. */}
            <LunchEmojiPicker
              value={it.emoji}
              onChange={(emoji) => update(idx, { emoji })}
            />
            <input
              type="text"
              value={it.name || ''}
              placeholder="Dish name"
              onChange={(e) => update(idx, { name: e.target.value })}
              className="flex-1 px-2 py-1.5 rounded border border-slate-200 text-xs font-semibold"
              aria-label="Dish name"
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              className="px-2 py-1.5 rounded text-rose-500 hover:bg-rose-50 text-sm"
              aria-label={`Remove ${it.name || 'item'}`}
              title="Remove"
            >
              ×
            </button>
          </div>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={it.meta || ''}
              placeholder="🌾 🧀 or veg · gf"
              onChange={(e) => update(idx, { meta: e.target.value })}
              className="flex-1 px-2 py-1.5 rounded border border-slate-200 text-[11px]"
              aria-label="Allergens or dietary tag"
            />
            <input
              type="text"
              value={it.price || ''}
              placeholder="$3.25"
              onChange={(e) => update(idx, { price: e.target.value })}
              className="w-20 px-2 py-1.5 rounded border border-slate-200 text-[11px] text-right font-semibold"
              aria-label="Price"
            />
          </div>
        </div>
      ))}

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={add}
          className="flex-1 px-2 py-1.5 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold transition"
        >
          + Add item
        </button>
        {activeDay === 'monday' && week.monday.length > 0 && (
          <button
            type="button"
            onClick={copyMondayToWeek}
            className="px-2 py-1.5 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-700 text-[11px] font-semibold transition"
            title="Copy Monday's items to Tuesday through Friday"
          >
            Copy Mon → all week
          </button>
        )}
      </div>
    </div>
  );
}

function BellScheduleEditor({ value, onChange }: { value: Array<{ label: string; start: string; end?: string }>; onChange: (next: Array<{ label: string; start: string; end?: string }>) => void }) {
  // 2026-05-03 — operator complaint: "you dumped the AM/PM selection
  // and the picker is gone now." Reverted from the loose-text input
  // back to the native `<input type="time">` so the browser provides
  // the picker UI + AM/PM toggle for free. Existing values stored as
  // "8:30 AM" still load into the picker via `to24Hour()`, which
  // converts to the HH:MM 24-hour format the input requires. We store
  // the picker's raw HH:MM output (e.g. "08:30" / "13:30") — every
  // bell-schedule widget renderer pipes display through formatTime12
  // so the canvas always shows "8:30am" / "1:30pm" regardless of the
  // stored format.
  const periods = value.length ? value : [];
  const update = (idx: number, patch: Partial<{ label: string; start: string; end?: string }>) => {
    const next = periods.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const add = () => onChange([...periods, { label: `Period ${periods.length + 1}`, start: '08:00', end: '08:50' }]);
  const remove = (idx: number) => onChange(periods.filter((_, i) => i !== idx));

  return (
    <div>
      {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control:
          heads a dynamic period list, not one control. */}
      <div className="block text-[10px] font-semibold text-slate-500 mb-1.5">Bell schedule</div>
      <p className="text-[10px] text-slate-400 mb-2 px-0.5">Click a time field to open the picker. Times always display as 12-hour on the canvas.</p>
      <div className="space-y-2">
        {periods.length === 0 && <p className="text-[11px] text-slate-400 italic px-1">No periods yet — add your first below.</p>}
        {periods.map((p, idx) => (
          // 2026-05-03 — operator: bell schedule editor was truncating
          // the picker's AM/PM ("08:50 A", "12:10 PI"). Native
          // `<input type="time">` needs ~110-130px to fit HH:MM + clock
          // glyph + AM/PM in Chromium; the prior 92px column ate the
          // suffix. Switched from a single 5-column grid to a 2-row
          // layout per period: label + remove on row 1 (full width),
          // time pickers + arrow on row 2 (each picker gets 1fr =
          // ~150px on the 420px panel, plenty for AM/PM).
          <div key={idx} className="bg-white border border-slate-200 rounded-lg p-2 space-y-1.5 shadow-sm">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={p.label}
                onChange={(e) => update(idx, { label: e.target.value })}
                placeholder={`Period ${idx + 1}`}
                aria-label={`Period ${idx + 1} label`}
                className="flex-1 min-w-0 px-2 py-1 text-xs font-semibold rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button
                type="button"
                onClick={() => remove(idx)}
                aria-label="Remove period"
                className="w-7 h-7 shrink-0 rounded border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 flex items-center justify-center text-xs"
              >×</button>
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
              <input
                type="time"
                value={to24Hour(p.start)}
                onChange={(e) => update(idx, { start: e.target.value })}
                aria-label={`Period ${idx + 1} start time`}
                className="min-w-0 w-full px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <span className="text-[10px] text-slate-400 px-1">→</span>
              <input
                type="time"
                value={to24Hour(p.end)}
                onChange={(e) => update(idx, { end: e.target.value || undefined })}
                aria-label={`Period ${idx + 1} end time`}
                className="min-w-0 w-full px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="w-full py-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-dashed border-indigo-200"
        >
          + Add period
        </button>
      </div>
    </div>
  );
}

// 2026-05-28 (P0-3 §19) — class-row schedule editor for the themed Hallway /
// AnimatedHallwaySchedule widgets. Their primary content is an array of
// {num,time,name,room} rows the widget renders verbatim (e.g.
// "8:15 — 9:00 · Math · Mrs. Chen · RM 14"). The THEMED auto-form previously
// rendered only Text/TextArea, so an operator could rename "Today's Schedule"
// but could not edit a single period. `time` is a free-text display string
// (the widgets print it directly, so "8:15 — 9:00" or "1st block" both work);
// `num` auto-renumbers on add/remove/reorder.
type ScheduleRow = { num?: string | number; time?: string; name?: string; room?: string; highlight?: boolean };
// Exported for RTL tests — SCHEDULE_GRID + the themed Hallway widgets use this.
export function ScheduleRowsField({ label, value, onChange }: { label: string; value: ScheduleRow[]; onChange: (v: ScheduleRow[]) => void }) {
  const rows = Array.isArray(value) ? value : [];
  // Keep `num` a stable 1..N sequence so the widget's period badges stay tidy
  // regardless of how the operator reorders/removes rows.
  const renumber = (next: ScheduleRow[]) => next.map((r, i) => ({ ...r, num: i + 1 }));
  const update = (idx: number, patch: Partial<ScheduleRow>) => {
    const next = rows.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(renumber(next));
  };
  const add = () => onChange(renumber([...rows, { time: '', name: '', room: '' }]));
  const remove = (idx: number) => onChange(renumber(rows.filter((_, i) => i !== idx)));
  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const next = rows.slice();
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(renumber(next));
  };
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <p className="text-[10px] text-slate-400 mb-2 px-0.5">Each row is one period — a time (e.g. &ldquo;8:15 — 9:00&rdquo;), the class/activity, and the room.</p>
      <div className="space-y-2">
        {rows.length === 0 && <p className="text-[11px] text-slate-400 italic px-1">No periods yet — add your first below.</p>}
        {rows.map((r, idx) => (
          <div key={idx} className="bg-white border border-slate-200 rounded-lg p-2 space-y-1.5 shadow-sm">
            <div className="flex items-center gap-1.5">
              <span className="w-5 h-5 shrink-0 rounded-full bg-indigo-50 text-indigo-500 text-[10px] font-bold flex items-center justify-center">{idx + 1}</span>
              <input
                type="text"
                value={r.time || ''}
                onChange={(e) => update(idx, { time: e.target.value })}
                placeholder="8:15 — 9:00"
                aria-label={`Period ${idx + 1} time`}
                className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button type="button" onClick={() => moveUp(idx)} disabled={idx === 0} aria-label="Move up" className="w-6 h-6 shrink-0 rounded border border-slate-200 text-slate-400 hover:text-indigo-600 disabled:opacity-30 flex items-center justify-center text-[11px]">↑</button>
              <button type="button" onClick={() => remove(idx)} aria-label="Remove period" className="w-6 h-6 shrink-0 rounded border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 flex items-center justify-center text-xs">×</button>
            </div>
            <div className="grid grid-cols-[1fr_auto] items-center gap-1.5">
              <input
                type="text"
                value={r.name || ''}
                onChange={(e) => update(idx, { name: e.target.value })}
                placeholder="Math · Mrs. Chen"
                aria-label={`Period ${idx + 1} class`}
                className="min-w-0 w-full px-2 py-1 text-xs font-semibold rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <input
                type="text"
                value={r.room || ''}
                onChange={(e) => update(idx, { room: e.target.value })}
                placeholder="RM 14"
                aria-label={`Period ${idx + 1} room`}
                className="w-20 px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="w-full py-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-dashed border-indigo-200"
        >
          + Add period
        </button>
      </div>
    </div>
  );
}

// ─── DayHoursField (2026-05-28, §19 / G4) ───────────────────────────────────
// 7-row day → hours editor for RETAIL_STOREFRONT_HOURS. The widget's shape is
// `openHours?: Partial<Record<'sun'|'mon'|…|'sat', string>>` — one free-form
// string per day ('10am – 9pm' / 'Closed'), NOT an {open,close} pair (verified
// against RetailStorefrontHoursWidget.tsx). One labeled input per day; emits a
// plain object. Back-compat: a legacy JSON string value is parsed on read so
// presets that still carry the old stringified blob keep rendering.
const DAY_HOURS_KEYS: Array<[string, string]> = [
  ['sun', 'Sunday'],
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
];
function DayHoursField({ label, value, onChange }: { label: string; value: unknown; onChange: (v: Record<string, string>) => void }) {
  // Normalize: accept a parsed object OR a legacy JSON string OR null.
  let hours: Record<string, string> = {};
  if (value && typeof value === 'object') {
    hours = value as Record<string, string>;
  } else if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') hours = parsed as Record<string, string>;
    } catch {
      /* leave empty — malformed legacy string */
    }
  }
  const setDay = (key: string, v: string) => {
    const next = { ...hours };
    if (v) next[key] = v;
    else delete next[key];
    onChange(next);
  };
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <div className="space-y-1.5">
        {DAY_HOURS_KEYS.map(([key, dayLabel]) => (
          <div key={key} className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-500 w-16 shrink-0">{dayLabel}</span>
            <input
              type="text"
              value={typeof hours[key] === 'string' ? hours[key] : ''}
              placeholder="10am – 9pm or Closed"
              onChange={(e) => setDay(key, e.target.value)}
              aria-label={`${dayLabel} hours`}
              className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm"
            />
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-400 mt-1.5 px-0.5">Leave a day blank to omit it from the plate.</p>
    </div>
  );
}

// ─── YouAreHereField (2026-05-28, §19 / G4) ─────────────────────────────────
// Two number inputs (x / y, 0–100) + a "show the marker" toggle for
// RETAIL_WAYFINDING_MAP. Widget shape is `{ x: number; y: number } | null`
// (verified against RetailWayfindingMapWidget.tsx); null hides the marker.
// Back-compat: a legacy JSON string ('{"x":50,"y":92}' / 'null') is parsed on
// read so old presets keep working.
function YouAreHereField({ label, value, onChange }: { label: string; value: unknown; onChange: (v: { x: number; y: number } | null) => void }) {
  // Normalize. `null` (or string 'null') = hidden. Object / legacy JSON
  // string = shown at {x,y}. Anything else defaults to the visible center-ish.
  let pos: { x: number; y: number } | null = { x: 50, y: 92 };
  if (value === null) {
    pos = null;
  } else if (value && typeof value === 'object') {
    const o = value as { x?: unknown; y?: unknown };
    pos = { x: typeof o.x === 'number' ? o.x : 50, y: typeof o.y === 'number' ? o.y : 92 };
  } else if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (parsed === null) pos = null;
      else if (parsed && typeof parsed === 'object') pos = { x: typeof parsed.x === 'number' ? parsed.x : 50, y: typeof parsed.y === 'number' ? parsed.y : 92 };
    } catch {
      /* keep default */
    }
  }
  const shown = pos !== null;
  const cur = pos ?? { x: 50, y: 92 };
  const setCoord = (axis: 'x' | 'y', raw: string) => {
    const n = raw === '' ? 0 : Number(raw);
    onChange({ ...cur, [axis]: Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : cur[axis] });
  };
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <label className="flex items-center gap-2 text-[11px] text-slate-600 mb-2">
        <input
          type="checkbox"
          checked={shown}
          onChange={(e) => onChange(e.target.checked ? cur : null)}
          aria-label="Show the “you are here” marker"
        />
        Show the marker on the map
      </label>
      {shown && (
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <span className="block text-[10px] text-slate-400 mb-0.5">X (0–100)</span>
            <input
              type="number"
              min={0}
              max={100}
              value={cur.x}
              onChange={(e) => setCoord('x', e.target.value)}
              aria-label="Marker X position (0–100)"
              className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200/60 text-xs font-semibold text-center focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm"
            />
          </div>
          <div className="flex-1">
            <span className="block text-[10px] text-slate-400 mb-0.5">Y (0–100)</span>
            <input
              type="number"
              min={0}
              max={100}
              value={cur.y}
              onChange={(e) => setCoord('y', e.target.value)}
              aria-label="Marker Y position (0–100)"
              className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200/60 text-xs font-semibold text-center focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// 2026-05-28 (P0-3 §19) — menu-card editor for ScrapbookCafeteria, whose
// primary content is cfg.cards ({title,desc,badges?,accent?,rot?,tape?}[]).
// We expose just title + desc (the operator-facing essentials); the optional
// styling props (accent / rot / tape / badges) are preserved on edit and a
// rotating accent/tape palette is assigned to NEW cards so they keep the
// scrapbook look without the operator touching CSS.
type MenuCard = { title?: string; desc?: string; badges?: { label?: string; kind?: string }[]; accent?: string; rot?: string; tape?: string };
const SCRAPBOOK_CARD_ACCENTS: Array<{ accent: string; rot: string; tape: string }> = [
  { accent: '#f472b6', rot: '-1.5deg', tape: '#fcd34d' },
  { accent: '#86efac', rot: '1.2deg',  tape: '#86efac' },
  { accent: '#fcd34d', rot: '-1deg',   tape: '#93c5fd' },
  { accent: '#93c5fd', rot: '1.4deg',  tape: '#f472b6' },
];
function MenuCardsField({ label, value, onChange }: { label: string; value: MenuCard[]; onChange: (v: MenuCard[]) => void }) {
  const cards = Array.isArray(value) ? value : [];
  const update = (idx: number, patch: Partial<MenuCard>) => {
    const next = cards.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const add = () => {
    const style = SCRAPBOOK_CARD_ACCENTS[cards.length % SCRAPBOOK_CARD_ACCENTS.length];
    onChange([...cards, { title: '', desc: '', ...style }]);
  };
  const remove = (idx: number) => onChange(cards.filter((_, i) => i !== idx));
  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const next = cards.slice();
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next);
  };
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <p className="text-[10px] text-slate-400 mb-2 px-0.5">Each card is one dish — a name and a short description.</p>
      <div className="space-y-2">
        {cards.length === 0 && <p className="text-[11px] text-slate-400 italic px-1">No cards yet — add your first below.</p>}
        {cards.map((card, idx) => (
          <div key={idx} className="bg-white border border-slate-200 rounded-lg p-2 space-y-1.5 shadow-sm">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={card.title || ''}
                onChange={(e) => update(idx, { title: e.target.value })}
                placeholder="Chef Salad"
                aria-label={`Card ${idx + 1} name`}
                className="flex-1 min-w-0 px-2 py-1 text-xs font-semibold rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button type="button" onClick={() => moveUp(idx)} disabled={idx === 0} aria-label="Move up" className="w-6 h-6 shrink-0 rounded border border-slate-200 text-slate-400 hover:text-indigo-600 disabled:opacity-30 flex items-center justify-center text-[11px]">↑</button>
              <button type="button" onClick={() => remove(idx)} aria-label="Remove card" className="w-6 h-6 shrink-0 rounded border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 flex items-center justify-center text-xs">×</button>
            </div>
            <input
              type="text"
              value={card.desc || ''}
              onChange={(e) => update(idx, { desc: e.target.value })}
              placeholder="Romaine, grilled chicken, tomatoes, cheese, ranch."
              aria-label={`Card ${idx + 1} description`}
              className="w-full px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="w-full py-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-dashed border-indigo-200"
        >
          + Add card
        </button>
      </div>
    </div>
  );
}

// ─── ListItemsEditor (2026-05-28, audit "make templates editable") ──────────
// THE fix for the operator complaint: "I have menus for restaurants, but how
// the fuck do I even update the pricing?" Every list-based widget (menu items,
// taps, cocktails, products, combos, class schedules, team lists, …) used to be
// edited via a raw JSON textarea — `JSON array of { name, price, ... }`. No
// operator hand-edits JSON to change a price. This schema-driven component
// replaces all of those: each item is a card with real inputs (text / price /
// description / image picker / color / number / toggle / select), plus add,
// remove, and reorder. One component, driven by a per-widget field schema.
//
// `value` may arrive as a parsed array OR a JSON string (legacy configs store
// some lists stringified) — we normalize defensively so the editor never blanks
// out on a string. onChange always emits a real array.
export type ListItemFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'price'
  | 'image'
  | 'color'
  | 'toggle'
  | 'select'
  // A sub-array of plain strings inside one item (e.g. a combo's
  // `includes` bullets). Edited as a newline-delimited textarea and
  // stored back as `string[]` so the widget's `.map()` keeps working.
  | 'stringList';

export interface ListItemFieldSpec {
  key: string;
  label: string;
  type?: ListItemFieldType; // default 'text'
  placeholder?: string;
  options?: [string, string][]; // for 'select'
}

export function ListItemsEditor({
  label,
  help,
  value,
  onChange,
  fields,
  newItem,
  makeNewItem,
  itemNoun = 'item',
}: {
  label: string;
  help?: string;
  value: unknown;
  onChange: (v: Record<string, unknown>[]) => void;
  fields: ListItemFieldSpec[];
  newItem?: Record<string, unknown>;
  /**
   * Factory for a fresh blank item. Use this (instead of `newItem`) when
   * each row needs a UNIQUE value — e.g. a stable `id` used as the
   * widget's React `key`. Static `newItem` would clone the same id into
   * every added row, producing duplicate-key warnings + render glitches.
   */
  makeNewItem?: () => Record<string, unknown>;
  itemNoun?: string;
}) {
  // Normalize: accept a parsed array OR a JSON string OR null/undefined.
  let items: Record<string, unknown>[] = [];
  if (Array.isArray(value)) {
    items = value as Record<string, unknown>[];
  } else if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) items = parsed as Record<string, unknown>[];
    } catch {
      /* leave empty — malformed legacy string */
    }
  }

  const update = (idx: number, patch: Record<string, unknown>) => {
    const next = items.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const add = () => {
    const blank: Record<string, unknown> = makeNewItem
      ? { ...makeNewItem() }
      : newItem
        ? { ...newItem }
        : {};
    for (const f of fields) {
      if (!(f.key in blank)) blank[f.key] = f.type === 'toggle' ? false : f.type === 'stringList' ? [] : '';
    }
    onChange([...items, blank]);
  };
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };

  const primaryKey = fields[0]?.key;

  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      {help && <p className="text-[10px] text-slate-400 mb-2 px-0.5">{help}</p>}
      <div className="space-y-2">
        {items.length === 0 && (
          <p className="text-[11px] text-slate-400 italic px-1">No {itemNoun}s yet — add your first below.</p>
        )}
        {items.map((item, idx) => (
          <div key={idx} className="bg-white border border-slate-200 rounded-lg p-2 space-y-1.5 shadow-sm">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-slate-400 shrink-0 w-4 text-center">{idx + 1}</span>
              <span className="flex-1 min-w-0 truncate text-[11px] font-semibold text-slate-600">
                {String(item[primaryKey] || '') || `Untitled ${itemNoun}`}
              </span>
              <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label={`Move ${itemNoun} ${idx + 1} up`} className="w-6 h-6 shrink-0 rounded border border-slate-200 text-slate-400 hover:text-indigo-600 disabled:opacity-30 flex items-center justify-center text-[11px]">↑</button>
              <button type="button" onClick={() => move(idx, 1)} disabled={idx === items.length - 1} aria-label={`Move ${itemNoun} ${idx + 1} down`} className="w-6 h-6 shrink-0 rounded border border-slate-200 text-slate-400 hover:text-indigo-600 disabled:opacity-30 flex items-center justify-center text-[11px]">↓</button>
              <button type="button" onClick={() => remove(idx)} aria-label={`Remove ${itemNoun} ${idx + 1}`} className="w-6 h-6 shrink-0 rounded border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 flex items-center justify-center text-xs">×</button>
            </div>
            <div className="space-y-1.5 pl-5">
              {fields.map((f) => {
                const t = f.type || 'text';
                const raw = item[f.key];
                if (t === 'toggle') {
                  return (
                    <label key={f.key} className="flex items-center gap-2 text-[11px] text-slate-600">
                      <input type="checkbox" checked={!!raw} onChange={(e) => update(idx, { [f.key]: e.target.checked })} aria-label={`${itemNoun} ${idx + 1} ${f.label}`} />
                      {f.label}
                    </label>
                  );
                }
                if (t === 'image') {
                  return (
                    <AssetPickerField key={f.key} label={f.label} kind="image" value={typeof raw === 'string' ? raw : ''} onChange={(v) => update(idx, { [f.key]: v })} />
                  );
                }
                if (t === 'color') {
                  return (
                    <ColorPickerField key={f.key} label={f.label} value={typeof raw === 'string' ? raw : '#000000'} onChange={(v: string) => update(idx, { [f.key]: v })} />
                  );
                }
                if (t === 'select' && f.options) {
                  return (
                    <SelectField key={f.key} label={f.label} value={typeof raw === 'string' ? raw : (f.options[0]?.[0] ?? '')} options={f.options} onChange={(v) => update(idx, { [f.key]: v })} />
                  );
                }
                if (t === 'textarea') {
                  return (
                    <textarea
                      key={f.key}
                      value={typeof raw === 'string' ? raw : ''}
                      onChange={(e) => update(idx, { [f.key]: e.target.value })}
                      placeholder={f.placeholder || f.label}
                      aria-label={`${itemNoun} ${idx + 1} ${f.label}`}
                      rows={2}
                      className="w-full px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                  );
                }
                if (t === 'stringList') {
                  // Sub-array of plain strings: one per line in the
                  // textarea, stored back as string[]. Blank lines are
                  // dropped so the widget never renders an empty bullet.
                  const arr = Array.isArray(raw) ? (raw as unknown[]).map((s) => String(s)) : [];
                  return (
                    <label key={f.key} className="block">
                      <span className="block text-[10px] text-slate-400 mb-0.5">{f.label} (one per line)</span>
                      <textarea
                        value={arr.join('\n')}
                        onChange={(e) =>
                          update(idx, {
                            [f.key]: e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
                          })
                        }
                        placeholder={f.placeholder || f.label}
                        aria-label={`${itemNoun} ${idx + 1} ${f.label}`}
                        rows={3}
                        className="w-full px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                    </label>
                  );
                }
                // text | number | price
                return (
                  <input
                    key={f.key}
                    type={t === 'number' ? 'number' : 'text'}
                    inputMode={t === 'price' ? 'decimal' : undefined}
                    value={raw === undefined || raw === null ? '' : String(raw)}
                    onChange={(e) =>
                      update(idx, {
                        [f.key]: t === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value,
                      })
                    }
                    placeholder={f.placeholder || f.label}
                    aria-label={`${itemNoun} ${idx + 1} ${f.label}`}
                    className="w-full px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                );
              })}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          className="w-full py-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-dashed border-indigo-200"
        >
          + Add {itemNoun}
        </button>
      </div>
    </div>
  );
}

// ─── StringListEditor ───────────────────────────────────────────────────────
// Sibling of ListItemsEditor for the handful of widget configs whose list is
// a plain `string[]` (not an array of objects) — e.g. RETAIL_LOYALTY_QR.perks
// and RETAIL_PRICE_CALLOUT.sellingPoints. Each string gets its own input with
// add / remove / reorder, so the operator never hand-edits a JSON array of
// quoted strings. onChange always emits a real `string[]`; `value` is
// normalized from an array OR a legacy JSON string.
export function StringListEditor({
  label,
  help,
  value,
  onChange,
  placeholder,
  itemNoun = 'line',
  maxItems,
}: {
  label: string;
  help?: string;
  value: unknown;
  onChange: (v: string[]) => void;
  placeholder?: string;
  itemNoun?: string;
  maxItems?: number;
}) {
  let items: string[] = [];
  if (Array.isArray(value)) {
    items = (value as unknown[]).map((s) => String(s));
  } else if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) items = parsed.map((s) => String(s));
    } catch {
      /* leave empty — malformed legacy string */
    }
  }

  const update = (idx: number, v: string) => {
    const next = items.slice();
    next[idx] = v;
    onChange(next);
  };
  const add = () => onChange([...items, '']);
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const move = (idx: number, dir: -1 | 1) => {
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    const next = items.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };

  const atCap = typeof maxItems === 'number' && items.length >= maxItems;

  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      {help && <p className="text-[10px] text-slate-400 mb-2 px-0.5">{help}</p>}
      <div className="space-y-2">
        {items.length === 0 && (
          <p className="text-[11px] text-slate-400 italic px-1">No {itemNoun}s yet — add your first below.</p>
        )}
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-slate-400 shrink-0 w-4 text-center">{idx + 1}</span>
            <input
              type="text"
              value={item}
              onChange={(e) => update(idx, e.target.value)}
              placeholder={placeholder || `${itemNoun} ${idx + 1}`}
              aria-label={`${itemNoun} ${idx + 1}`}
              className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} aria-label={`Move ${itemNoun} ${idx + 1} up`} className="w-6 h-6 shrink-0 rounded border border-slate-200 text-slate-400 hover:text-indigo-600 disabled:opacity-30 flex items-center justify-center text-[11px]">↑</button>
            <button type="button" onClick={() => move(idx, 1)} disabled={idx === items.length - 1} aria-label={`Move ${itemNoun} ${idx + 1} down`} className="w-6 h-6 shrink-0 rounded border border-slate-200 text-slate-400 hover:text-indigo-600 disabled:opacity-30 flex items-center justify-center text-[11px]">↓</button>
            <button type="button" onClick={() => remove(idx)} aria-label={`Remove ${itemNoun} ${idx + 1}`} className="w-6 h-6 shrink-0 rounded border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 flex items-center justify-center text-xs">×</button>
          </div>
        ))}
        <button
          type="button"
          onClick={add}
          disabled={atCap}
          className="w-full py-2 text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-dashed border-indigo-200 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {atCap ? `Max ${maxItems} ${itemNoun}s` : `+ Add ${itemNoun}`}
        </button>
      </div>
    </div>
  );
}
