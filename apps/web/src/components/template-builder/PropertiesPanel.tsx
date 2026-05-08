"use client";

import { useId, useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { AlignLeft, AlignCenter, AlignRight, AlignStartVertical, AlignEndVertical, AlignVerticalJustifyCenter, ChevronDown, ChevronRight, X as XIcon, Tv, ExternalLink, RefreshCw } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBuilderStore } from './useBuilderStore';
import { widgetLabel } from './constants';
import { useAssets, usePlaylists, useTemplates, useTemplateBackdrops } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api-client';
import { ColorPickerField } from '@/components/ui/color-picker';
import { THEMED_WIDGET_FIELDS } from './themed-widget-defaults';
import { AiGenerateButton } from '@/components/ai/AiGenerateButton';
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
// 2026-05-07 — Holiday lobby pack static field schema. Each variant +
// grade combo (18 total) has a hand-extracted [data-field] schema so
// PropertiesPanel can render editable TextFields synchronously when an
// operator selects a HOLIDAY zone — no race with the iframe-bridge
// holiday:ready postMessage. Iframe schema event still fires (kept for
// click-to-scroll behavior) but is no longer load-bearing for
// rendering. See feat(holiday) commit for extraction.
import {
  holidayFieldSchemaFor,
  type HolidayVariant,
  type HolidayGradeLevel,
} from '@/components/widgets/HolidayWidget';

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
// 2026-05-03 — extended event shape mirrors v2 CalendarWidgets reads:
// { date, time, title, location, tag }. Legacy reads {date,title,color}.
// We persist BOTH so legacy + v2 variants render the same data.
type CalendarEvent = { title: string; date: string; color?: string; time?: string; location?: string; tag?: string };

const DEFAULT_BELL_PERIODS: BellPeriod[] = [
  { label: 'Period 1', start: '8:00', end: '8:50' },
  { label: 'Period 2', start: '8:55', end: '9:45' },
  { label: 'Period 3', start: '9:50', end: '10:40' },
  { label: 'Lunch', start: '10:45', end: '11:15' },
  { label: 'Period 4', start: '11:20', end: '12:10' },
  { label: 'Period 5', start: '12:15', end: '1:05' },
  { label: 'Period 6', start: '1:10', end: '2:00' },
];

const DEFAULT_EVENTS: CalendarEvent[] = [
  { title: 'Spring Assembly', date: 'Today, 10:00 AM', color: '#6366f1' },
  { title: 'PTA Meeting', date: 'Tomorrow, 6:30 PM', color: '#f59e0b' },
  { title: 'Science Fair', date: 'This Week', color: '#22c55e' },
  { title: 'Staff Development Day', date: 'Next Week', color: '#ec4899' },
  { title: 'Spring Break Begins', date: 'Soon', color: '#0ea5e9' },
];
const DEFAULT_STATS = [
  { value: '97%', label: 'Attendance' },
  { value: '4.2', label: 'Avg GPA' },
  { value: '84', label: 'Clubs' },
];
const DEFAULT_PERIODS = [
  { num: '1', name: 'Homeroom', time: '8:00 - 8:15' },
  { num: '2', name: 'English', time: '8:20 - 9:15' },
  { num: '3', name: 'Math', time: '9:20 - 10:15' },
  { num: '4', name: 'Science', time: '10:20 - 11:15' },
  { num: '5', name: 'Lunch', time: '11:20 - 12:00' },
  { num: '6', name: 'History', time: '12:05 - 1:00' },
  { num: '7', name: 'PE', time: '1:05 - 2:00' },
  { num: '8', name: 'Art', time: '2:05 - 3:00' },
];
const DEFAULT_BIRTHDAYS = ['Morgan P.', 'Samir K.', 'Ava L.'];
const DEFAULT_STUDENTS = [
  { name: 'Jordan Lee', reason: 'Perfect attendance + top math score' },
  { name: 'Maria Santos', reason: 'Kindness award' },
  { name: 'Tyler Chen', reason: 'Band district selection' },
  { name: 'Ava Patel', reason: 'Essay contest' },
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

function eventsForEditor(value: unknown): CalendarEvent[] {
  if (Array.isArray(value) && value.length) {
    return value.map((e, idx) => ({
      title: String((e as any)?.title || 'Event'),
      date: String((e as any)?.date || ''),
      color: (e as any)?.color || DEFAULT_EVENTS[idx % DEFAULT_EVENTS.length]?.color,
      time: (e as any)?.time ? String((e as any).time) : undefined,
      location: (e as any)?.location ? String((e as any).location) : undefined,
      tag: (e as any)?.tag ? String((e as any).tag) : undefined,
    }));
  }
  return DEFAULT_EVENTS.map((e) => ({ ...e }));
}

function tickerTextForEditor(cfg: any): string {
  if (Array.isArray(cfg.messages) && cfg.messages.length) return cfg.messages.join('\n');
  return typeof cfg.text === 'string' ? cfg.text : '';
}

function arrayForEditor<T>(value: unknown, defaults: T[]): T[] {
  return Array.isArray(value) && value.length ? value as T[] : defaults;
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
    <div className="p-5 space-y-6 text-xs">
      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-400/80 uppercase tracking-widest pl-1">Zone</h3>
        
        <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-slate-500">Type</span>
            <span className="px-2 py-1 bg-white rounded-md shadow-sm border border-slate-100 text-[10px] font-bold text-indigo-600">{widgetLabel(zone.widgetType)}</span>
          </div>
          
          <div>
            <label htmlFor={nameId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">Layer Name</label>
            <input
              id={nameId}
              type="text"
              value={zone.name}
              onChange={(e) => updateZone(zone.id, { name: e.target.value }, false)}
              onBlur={(e) => updateZone(zone.id, { name: e.target.value }, true)}
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm inset-shadow-sm"
            />
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Widget Theme</label>
            <select
              value={(zone.defaultConfig?.theme as string) || 'default'}
              onChange={(e) => {
                const val = e.target.value;
                const newConfig = { ...(zone.defaultConfig || {}) };
                if (val === 'default') delete newConfig.theme;
                else newConfig.theme = val;
                updateZone(zone.id, { defaultConfig: newConfig }, true);
              }}
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm inset-shadow-sm cursor-pointer"
            >
              <option value="default">Default / Base</option>
              <option value="seamless">Seamless (No Background)</option>
              <optgroup label="Elementary">
                <option value="rainbow-ribbon">🌈 Rainbow Ribbon</option>
                <option value="bulletin-board">📌 Bulletin Board</option>
                <option value="field-day">🏆 Field Day</option>
                <option value="storybook">📖 Storybook</option>
                <option value="scrapbook">📎 Scrapbook</option>
                <option value="track-day">🏃 Track Day</option>
              </optgroup>
              <optgroup label="Middle School">
                <option value="locker-hallway">🔐 Locker Hallway</option>
                <option value="spirit-rally">📣 Spirit Rally</option>
                <option value="stem-lab">🔬 STEM Lab</option>
                <option value="morning-news">📺 Morning News</option>
                <option value="art-studio">🎨 Art Studio</option>
                <option value="scorebug">📊 Scorebug Dashboard</option>
              </optgroup>
              <optgroup label="High School">
                <option value="varsity-athletic">🥇 Varsity Athletic</option>
                <option value="senior-countdown">🎓 Senior Countdown</option>
                <option value="news-studio-pro">🎬 News Studio Pro</option>
                <option value="campus-quad">🏛️ Campus Quad</option>
                <option value="achievement-hall">🏅 Achievement Hall</option>
                <option value="jumbotron-pro">🏟️ Jumbotron Pro</option>
              </optgroup>
              <optgroup label="Legacy">
                <option value="sunny-meadow">☀️ Sunny Meadow</option>
                <option value="back-to-school">🍎 Back to School</option>
                <option value="diner-chalkboard">🍽️ Diner Chalkboard</option>
                <option value="middle-school-hall">🏫 Middle School Hallway</option>
                <option value="bus-loop">🚌 Bus Loop</option>
                <option value="high-school-athletics">🏆 Athletics Jumbotron</option>
                <option value="library-quiet">📚 Library Quiet Zone</option>
                <option value="sunshine-academy">🌞 Sunshine Academy</option>
                <option value="final-chance">✨ Final Chance</option>
                <option value="principals-office">🎓 Principal's Office</option>
                <option value="office-dashboard">📊 Office Dashboard</option>
                <option value="gym-pe">💪 Gym / PE</option>
                <option value="music-arts">🎵 Music & Arts</option>
                <option value="stem-science">🔬 STEM & Science</option>
              </optgroup>
            </select>
            <p className="mt-1 text-[10px] text-slate-400">Tip: use the <strong>Widgets</strong> tab to swap themes visually with thumbnails.</p>
          </div>
        </div>
      </section>

      <ContentFields zone={zone} updateZone={updateZone} />

      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-400/80 uppercase tracking-widest pl-1">Geometry</h3>
        
        <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <NumField id={xId} label="X (%)" value={zone.x} onChange={(v) => set({ x: v })} min={0} max={100} />
            <NumField id={yId} label="Y (%)" value={zone.y} onChange={(v) => set({ y: v })} min={0} max={100} />
            <NumField id={wId} label="Width (%)" value={zone.width} onChange={(v) => set({ width: v })} min={3} max={100} />
            <NumField id={hId} label="Height (%)" value={zone.height} onChange={(v) => set({ height: v })} min={3} max={100} />
          </div>
          
          <div className="text-[10px] text-slate-400/80 font-medium text-center bg-white py-1.5 rounded-md border border-slate-100/50">
            Rendered: ~{pixelW}&times;{pixelH}px at {meta.screenWidth}&times;{meta.screenHeight}
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
        </div>
      </section>

      <AdvancedJson zone={zone} configString={configString} configId={configId} updateZone={updateZone} />
    </div>
  );
}

function TemplateProperties() {
  // Atomic selectors — see PropertiesPanel above.
  const meta = useBuilderStore((s) => s.meta);
  const setMeta = useBuilderStore((s) => s.setMeta);
  const nameId = useId();
  const descId = useId();
  const widthId = useId();
  const heightId = useId();

  return (
    <div className="p-5 space-y-6 text-xs">
      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-400/80 uppercase tracking-widest pl-1">Template Info</h3>
        <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm space-y-3">
          <div>
            <label htmlFor={nameId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">Name</label>
            <input
              id={nameId}
              type="text"
              value={meta.name}
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
              onChange={(e) => setMeta({ description: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm inset-shadow-sm resize-y"
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-400/80 uppercase tracking-widest pl-1">Canvas Resolution</h3>
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
    </div>
  );
}

function NumField({ id, label, value, onChange, min, max, step = 1 }: {
  id: string; label: string; value: number; onChange: (v: number) => void;
  min?: number; max?: number; step?: number;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <input
        id={id}
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        min={min}
        max={max}
        step={step}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-[11px] font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm inset-shadow-sm"
      />
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
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Content fields — friendly inputs based on widget type
// ─────────────────────────────────────────────────────────
function ContentFields({ zone, updateZone }: { zone: any; updateZone: any }) {
  const cfg = zone.defaultConfig || {};
  const setField = (patch: Record<string, any>) => {
    updateZone(zone.id, { defaultConfig: { ...cfg, ...patch } }, true);
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

  switch (zone.widgetType) {
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
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Target date &amp; time
            </label>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <input
                  type="date"
                  value={datePart}
                  onChange={(e) => setTarget(e.target.value, timePart)}
                  className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                />
                <div className="text-[10px] text-slate-400 mt-1 leading-tight">Date</div>
              </div>
              <div>
                <input
                  type="time"
                  value={timePart}
                  onChange={(e) => setTarget(datePart, e.target.value)}
                  disabled={!datePart}
                  className="w-full px-3 py-2 rounded-md border border-slate-300 bg-white text-sm font-mono focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none disabled:bg-slate-50 disabled:text-slate-400"
                />
                <div className="text-[10px] text-slate-400 mt-1 leading-tight">Time (optional, defaults to midnight)</div>
              </div>
            </div>
            <div className="text-[10px] text-slate-400 leading-relaxed pt-0.5">
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
      fields.push(<TextField key="timezone" label="Timezone (optional)" value={cfg.timezone || cfg.timeZone || ''} placeholder="America/Chicago" onChange={(v) => setField({ timezone: v, timeZone: v })} />);
      if (!isShapeTheme) {
        // showSeconds / showDays / bgColor are ignored by shape
        // themes (clock face is baked into the SVG).
        fields.push(<ToggleField key="showSeconds" label="Show seconds" value={!!cfg.showSeconds} onChange={(v) => setField({ showSeconds: v })} />);
        fields.push(<ToggleField key="showDays" label="Show day & date" value={cfg.showDays !== false} onChange={(v) => setField({ showDays: v })} />);
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
      // 2026-05-03 — extended pipe format: `date | title | time | location | tag`.
      // First two fields are required; trailing fields are optional but
      // populate v2 widgets (CalendarNeonGrid, CalendarPaperAgenda, etc.)
      // which render time/location/tag columns. Legacy widgets ignore
      // the extras silently. Empty trailing slots are accepted.
      fields.push(<TextAreaField key="events" label="Events (date | title | time | location | tag — one per line)" value={eventsForEditor(cfg.events).map((e: any) => [e.date || '', e.title || '', e.time || '', e.location || '', e.tag || ''].filter((_, i, arr) => i < 2 || arr.slice(i).some(Boolean)).join(' | ')).join('\n')} placeholder="TUE 04 | Spring Concert | 7:00 PM | Auditorium | ARTS&#10;WED 05 | Robotics Meet | 3:30 PM | STEM Lab | CLUB" onChange={(v) => setField({ events: v.split('\n').filter(Boolean).map(line => {
        const parts = line.split('|').map(s => s.trim());
        const [date = '', title = '', time = '', location = '', tag = ''] = parts;
        const ev: any = { date, title };
        if (time) ev.time = time;
        if (location) ev.location = location;
        if (tag) ev.tag = tag;
        return ev;
      }) })} rows={5} />);
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
      }
      break;
    case 'QUOTE':
      fields.push(<TextAreaField key="quote" label="Quote" value={cfg.quote || ''} placeholder="Believe you can..." onChange={(v) => setField({ quote: v })} rows={3} />);
      fields.push(<TextField key="author" label="Author" value={cfg.author || ''} placeholder="Theodore Roosevelt" onChange={(v) => setField({ author: v })} />);
      break;
    case 'STATS':
      fields.push(<TextAreaField key="stats" label="Stats (value | label — one per line)" value={arrayForEditor(cfg.stats, DEFAULT_STATS).map((s: any) => `${s.value || ''} | ${s.label || ''}`).join('\n')} placeholder="97% | Attendance&#10;4.2 | Avg GPA" onChange={(v) => setField({ stats: v.split('\n').filter(Boolean).map(line => { const [value, label] = line.split('|').map(s => s.trim()); return { value, label }; }) })} rows={5} />);
      break;
    case 'MENU_ITEM':
      fields.push(<TextField key="itemName" label="Item name" value={cfg.itemName || ''} placeholder="Today's Special" onChange={(v) => setField({ itemName: v })} />);
      fields.push(<TextAreaField key="description" label="Description" value={cfg.description || ''} placeholder="Fresh, seasonal, made from scratch." onChange={(v) => setField({ description: v })} rows={3} />);
      fields.push(<TextField key="price" label="Price" value={cfg.price || ''} placeholder="$4.50" onChange={(v) => setField({ price: v })} />);
      fields.push(<TextField key="allergens" label="Allergens (comma separated)" value={Array.isArray(cfg.allergens) ? cfg.allergens.join(', ') : ''} placeholder="V, GF" onChange={(v) => setField({ allergens: v.split(',').map(s => s.trim()).filter(Boolean) })} />);
      break;
    case 'SCOREBOARD':
      fields.push(<TextField key="status" label="Status" value={cfg.status || ''} placeholder="Tonight" onChange={(v) => setField({ status: v })} />);
      fields.push(<TextField key="period" label="Period / time" value={cfg.period || ''} placeholder="1ST · 8:42" onChange={(v) => setField({ period: v })} />);
      fields.push(<TextField key="homeName" label="Home team" value={cfg.homeName || ''} placeholder="Eagles" onChange={(v) => setField({ homeName: v })} />);
      fields.push(<TextField key="awayName" label="Away team" value={cfg.awayName || ''} placeholder="Cougars" onChange={(v) => setField({ awayName: v })} />);
      fields.push(<TextField key="homeScore" label="Home score" value={String(cfg.homeScore ?? '')} placeholder="0" onChange={(v) => setField({ homeScore: parseInt(v) || 0 })} />);
      fields.push(<TextField key="awayScore" label="Away score" value={String(cfg.awayScore ?? '')} placeholder="0" onChange={(v) => setField({ awayScore: parseInt(v) || 0 })} />);
      break;
    case 'SCHEDULE_GRID':
      fields.push(<TextField key="title" label="Title" value={cfg.title || ''} placeholder="Today's Schedule" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextAreaField key="periods" label="Periods (num | name | time — one per line)" value={arrayForEditor(cfg.periods, DEFAULT_PERIODS).map((p: any) => `${p.num || ''} | ${p.name || ''} | ${p.time || ''}`).join('\n')} placeholder="1 | Homeroom | 8:00 - 8:15" onChange={(v) => setField({ periods: v.split('\n').filter(Boolean).map(line => { const [num, name, time] = line.split('|').map(s => s.trim()); return { num, name, time }; }) })} rows={8} />);
      break;
    case 'ATTENDANCE':
      fields.push(<TextField key="title" label="Title" value={cfg.title || ''} placeholder="Attendance Today" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="presentPct" label="Present percentage" value={String(cfg.presentPct ?? '')} placeholder="97" onChange={(v) => setField({ presentPct: parseFloat(v) || 0 })} />);
      fields.push(<TextField key="totalStudents" label="Total students" value={String(cfg.totalStudents ?? '')} placeholder="624" onChange={(v) => setField({ totalStudents: parseInt(v) || 0 })} />);
      break;
    case 'BIRTHDAYS':
      fields.push(<TextField key="title" label="Title" value={cfg.title || ''} placeholder="Happy Birthday!" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextAreaField key="birthdays" label="Names (one per line)" value={arrayForEditor(cfg.birthdays, DEFAULT_BIRTHDAYS).join('\n')} placeholder="Morgan P.&#10;Samir K." onChange={(v) => setField({ birthdays: v.split('\n').filter(Boolean) })} rows={5} />);
      break;
    case 'HONOR_ROLL':
      fields.push(<TextField key="title" label="Title" value={cfg.title || ''} placeholder="Honor Roll" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextAreaField key="students" label="Students (name | reason — one per line)" value={arrayForEditor(cfg.students, DEFAULT_STUDENTS).map((s: any) => `${s.name || ''} | ${s.reason || ''}`).join('\n')} placeholder="Jordan Lee | Perfect attendance" onChange={(v) => setField({ students: v.split('\n').filter(Boolean).map(line => { const [name, reason] = line.split('|').map(s => s.trim()); return { name, reason }; }) })} rows={5} />);
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
    case 'IMAGE_CAROUSEL':
      fields.push(<TextField key="title" label="Caption" value={cfg.title || ''} placeholder="Photo Gallery" onChange={(v) => setField({ title: v })} />);
      // 2026-05-03 — v2 PHOTO_* variants read `c.rotateMs` not `intervalMs`.
      // Mirror BOTH so legacy + v2 see the same rotation cadence.
      fields.push(<TextField key="intervalMs" label="Rotate every (ms)" value={String(cfg.intervalMs || cfg.rotateMs || 5000)} placeholder="5000" onChange={(v) => { const n = parseInt(v) || 5000; setField({ intervalMs: n, rotateMs: n }); }} />);
      fields.push(<SelectField key="fitMode" label="Image fit" value={cfg.fitMode || 'cover'} options={[['cover','Fill (crop)'],['contain','Fit (no crop)']]} onChange={(v) => setField({ fitMode: v })} />);
      // v2 PHOTO_* widgets read `c.photos: { url, caption }[]` — mirror
      // the asset url list into the structured shape so v2 carousel
      // variants render the same images plus an empty caption (which
      // legacy carousel variants never showed anyway).
      fields.push(<AssetListPickerField key="urls" label="Photos" value={(cfg.urls || cfg.assetUrls || []) as string[]} kind="image" onChange={(v) => setField({ urls: v, assetUrls: undefined, photos: v.map((url) => ({ url, caption: '' })) })} />);
      break;
    case 'IMAGE':
      fields.push(<AssetPickerField key="assetUrl" label="Image" value={cfg.assetUrl || cfg.imageUrl || ''} kind="image" onChange={(v) => setField({ assetUrl: v, imageUrl: undefined })} />);
      fields.push(<SelectField key="fitMode" label="Fit" value={cfg.fitMode || 'cover'} options={[['cover','Fill (crop)'],['contain','Fit (no crop)']]} onChange={(v) => setField({ fitMode: v })} />);
      fields.push(<TextField key="assetName" label="Alt text (for screen readers)" value={cfg.assetName || ''} placeholder="School logo" onChange={(v) => setField({ assetName: v })} />);
      break;
    case 'VIDEO':
      fields.push(<AssetPickerField key="assetUrl" label="Video" value={cfg.assetUrl || cfg.url || ''} kind="video" onChange={(v) => setField({ assetUrl: v, url: undefined })} />);
      fields.push(<ToggleField key="autoplay" label="Autoplay" value={cfg.autoplay !== false} onChange={(v) => setField({ autoplay: v })} />);
      fields.push(<ToggleField key="loop" label="Loop" value={cfg.loop !== false} onChange={(v) => setField({ loop: v })} />);
      fields.push(<ToggleField key="muted" label="Muted" value={cfg.muted !== false} onChange={(v) => setField({ muted: v })} />);
      break;
    case 'WEBPAGE':
      fields.push(<TextField key="url" label="Web page URL" value={cfg.url || cfg.embedUrl || ''} placeholder="https://example.com" onChange={(v) => setField({ url: v, embedUrl: undefined })} />);
      fields.push(<TextField key="refreshIntervalMs" label="Auto-refresh every (ms, 0 = never)" value={String(cfg.refreshIntervalMs ?? 0)} placeholder="0" onChange={(v) => setField({ refreshIntervalMs: parseInt(v) || 0 })} />);
      break;
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
          styles={cfg.__styles as FieldStyleMap | undefined}
          onStylesChange={(s) => setField({ __styles: s })}
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
      const v = cfg.variant || 'confetti';
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
    case 'ANIMATED_WELCOME_MS':
    case 'ANIMATED_WELCOME_HS':
    case 'ANIMATED_WELCOME': {
      // All 3 ANIMATED_WELCOME variants share the same config shape —
      // Elementary / Middle / High School — so the editor + hotspot
      // section IDs can be reused verbatim. The widget component
      // picks the theme; the fields are identical.
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
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Clock timezone (blank = use player's local time)</label>
          <select
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
      fields.push(<TextField key="weatherUnits" label="Units (imperial / metric)" value={cfg.weatherUnits || 'imperial'} placeholder="imperial" onChange={(v) => setField({ weatherUnits: (v.trim().toLowerCase() === 'metric' ? 'metric' : 'imperial') })} />);

      fields.push(SH('announcement', 'Big announcement (center cloud)'));
      fields.push(<TextField key="announcementLabel" label="Small label" value={cfg.announcementLabel || ''} placeholder="Big News" onChange={(v) => setField({ announcementLabel: v })} />);
      fields.push(<TextAreaField key="announcementMessage" label="Message" value={cfg.announcementMessage || ''} placeholder="Book Fair starts Monday!" onChange={(v) => setField({ announcementMessage: v })} />);

      fields.push(SH('countdown', 'Countdown — auto-counts down to a date'));
      fields.push(<TextField key="countdownLabel" label="Label (e.g. Spring Break in, Winter Break in, Graduation in)" value={cfg.countdownLabel || ''} placeholder="Field Trip in" onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(
        <div key="countdownDate" className="space-y-1">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Target date</label>
          <input
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
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Or pick an icon (used when no photo uploaded)</label>
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
    case 'ANIMATED_CAFETERIA': {
      // Cafeteria template editor. Same hotspot scroll-into-view
      // contract as ANIMATED_WELCOME (aw-section-* ids + flash on
      // activation) but with cafeteria-specific sections: Special,
      // Menu (5 day tabs, unlimited items per day), Chef, etc.
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
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Clock timezone (blank = use player's local time)</label>
          <select
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
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Target date</label>
          <input
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
    case 'FITNESS_AD_BANNER': {
      // Rotating gym promo creative. Each creative is { headline, sub,
      // ctaText, ctaUrl?, durationMs? }; we render a small array editor.
      fields.push(<TextField key="rotationMs" label="Rotate every (ms)" value={String(cfg.rotationMs || 8000)} placeholder="8000" onChange={(v) => setField({ rotationMs: parseInt(v) || 8000 })} />);
      fields.push(<ColorPickerField key="accentColor" label="Accent color (AD chip + progress)" value={cfg.accentColor || '#fbbf24'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<ToggleField key="showAdBadge" label='Show "AD" disclosure chip' value={cfg.showAdBadge !== false} onChange={(v) => setField({ showAdBadge: v })} />);
      fields.push(<ToggleField key="enableImpressionLogging" label="Log impressions to /ads/impressions" value={cfg.enableImpressionLogging !== false} onChange={(v) => setField({ enableImpressionLogging: v })} />);
      fields.push(<TextAreaField key="creativesJson" label="Creatives (JSON array of { headline, sub, ctaText, ctaUrl })" value={typeof cfg.creatives === 'string' ? cfg.creatives : JSON.stringify(cfg.creatives || [], null, 2)} rows={6} onChange={(v) => {
        // editor-BUG-003 fix: only commit on successful parse. Mid-typing
        // strings used to leak into cfg.creatives and crash the renderer
        // when it tried to .map() the raw string. Keep the previous valid
        // value while the user is editing — the textarea retains the
        // in-progress text via its own local state.
        try { setField({ creatives: JSON.parse(v) }); } catch { /* keep previous value; user is mid-typing */ }
      }} />);
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
      fields.push(<TextAreaField key="classesJson" label="Classes (JSON array of { time, name, instructor, room })" value={typeof cfg.classes === 'string' ? cfg.classes : JSON.stringify(cfg.classes || [], null, 2)} rows={8} onChange={(v) => {
        // editor-BUG-003 fix: don't leak partial keystrokes into cfg.classes.
        try { setField({ classes: JSON.parse(v) }); } catch { /* keep previous value; user is mid-typing */ }
      }} />);
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
      fields.push(<TextField key="rotationMs" label="Rotate every (ms)" value={String(cfg.rotationMs || 12000)} placeholder="12000" onChange={(v) => setField({ rotationMs: parseInt(v) || 12000 })} />);
      fields.push(<ColorPickerField key="accentColor" label="Accent color" value={cfg.accentColor || '#39ff14'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<ToggleField key="showAuthor" label="Show author name" value={cfg.showAuthor !== false} onChange={(v) => setField({ showAuthor: v })} />);
      fields.push(<SelectField key="transitionStyle" label="Transition" value={cfg.transitionStyle || 'crossfade'} options={[['crossfade','Crossfade'],['typewriter','Typewriter'],['slide','Slide']]} onChange={(v) => setField({ transitionStyle: v })} />);
      fields.push(<SelectField key="align" label="Text alignment" value={cfg.align || 'center'} options={[['center','Center'],['left','Left']]} onChange={(v) => setField({ align: v })} />);
      fields.push(<SelectField key="bgStyle" label="Background style" value={cfg.bgStyle || 'gradient'} options={[['solid','Solid color'],['gradient','Gradient'],['photo-overlay','Photo with overlay']]} onChange={(v) => setField({ bgStyle: v })} />);
      fields.push(<TextAreaField key="quotesJson" label="Quotes (JSON array of { text, author })" value={typeof cfg.quotes === 'string' ? cfg.quotes : JSON.stringify(cfg.quotes || [], null, 2)} rows={6} onChange={(v) => {
        // editor-BUG-003 fix: don't leak partial keystrokes into cfg.quotes.
        try { setField({ quotes: JSON.parse(v) }); } catch { /* keep previous value; user is mid-typing */ }
      }} />);
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
      // live PosMenuItem rows from /api/v1/pos/items?category=X.
      fields.push(<TextField key="title" label="Board title" value={cfg.title || ''} placeholder="Menu" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="subtitle" label="Subtitle" value={cfg.subtitle || ''} placeholder="made fresh daily" onChange={(v) => setField({ subtitle: v })} />);
      fields.push(<ToggleField key="posSync" label="Pull live items from connected POS" value={!!cfg.posSync} onChange={(v) => setField({ posSync: v })} />);
      if (cfg.posSync) {
        fields.push(<PosCategoryPickerField key="posCategory" label="Category (optional — leave blank for all)" value={cfg.posCategory || ''} onChange={(v) => setField({ posCategory: v || undefined })} />);
        fields.push(<TextField key="maxItems" label="Max items to show" value={String(cfg.maxItems || 12)} placeholder="12" onChange={(v) => setField({ maxItems: parseInt(v) || 12 })} />);
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
        fields.push(<TextAreaField key="tapsJson" label="Taps (JSON array of { name, brewery, style, abv, ibu, price, color, isNew })" value={typeof cfg.taps === 'string' ? cfg.taps : JSON.stringify(cfg.taps || [], null, 2)} rows={10} onChange={(v) => {
          try { setField({ taps: JSON.parse(v) }); } catch { /* keep previous valid value */ }
        }} />);
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
        fields.push(<TextAreaField key="cocktailsJson" label="Cocktails (JSON array of { name, ingredients, note, price, garnish, featured })" value={typeof cfg.cocktails === 'string' ? cfg.cocktails : JSON.stringify(cfg.cocktails || [], null, 2)} rows={10} onChange={(v) => {
          try { setField({ cocktails: JSON.parse(v) }); } catch { /* keep previous valid value */ }
        }} />);
      }
      break;
    }
    case 'RETAIL_PRODUCT_GRID': {
      fields.push(<TextField key="title" label="Grid title" value={cfg.title || ''} placeholder="New Arrivals" onChange={(v) => setField({ title: v })} />);
      fields.push(<ToggleField key="posSync" label="Pull live products from connected POS" value={!!cfg.posSync} onChange={(v) => setField({ posSync: v })} />);
      if (cfg.posSync) {
        fields.push(<PosCategoryPickerField key="posCategory" label="Department / category (optional)" value={cfg.posCategory || ''} onChange={(v) => setField({ posCategory: v || undefined })} />);
      }
      fields.push(<TextField key="columns" label="Columns" value={String(cfg.columns || 4)} placeholder="4" onChange={(v) => setField({ columns: parseInt(v) || 4 })} />);
      fields.push(<ToggleField key="showSaleBadges" label="Show sale badges" value={cfg.showSaleBadges !== false} onChange={(v) => setField({ showSaleBadges: v })} />);
      break;
    }
    // editor-BUG-004 fix (cycle 3) — explicit cases for the 6 RETAIL
    // widgets that fell through to JSON-only Advanced after editor-BUG-002.
    // Same pattern as the RESTAURANT_/BAR_ cases — TextField / SelectField /
    // ToggleField / ColorPickerField / AssetPickerField, plus TextAreaField
    // with safe JSON parse for array editors (slides / hours / departments).
    case 'RETAIL_LOOKBOOK_CAROUSEL': {
      fields.push(<TextField key="rotationMs" label="Rotate every (ms)" value={String(cfg.rotationMs ?? 6000)} placeholder="6000" onChange={(v) => setField({ rotationMs: parseInt(v) || 6000 })} />);
      fields.push(<TextField key="fadeMs" label="Crossfade duration (ms)" value={String(cfg.fadeMs ?? 800)} placeholder="800" onChange={(v) => setField({ fadeMs: parseInt(v) || 800 })} />);
      fields.push(<ColorPickerField key="inkColor" label="Caption ink color" value={cfg.inkColor || '#ffffff'} onChange={(v) => setField({ inkColor: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Eyebrow + price accent" value={cfg.accentColor || '#e8c87a'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<TextAreaField key="slidesJson" label="Slides (JSON array of { eyebrow, headline, subhead, price, imageUrl, swatchColor, emoji })" value={typeof cfg.slides === 'string' ? cfg.slides : JSON.stringify(cfg.slides || [], null, 2)} rows={8} onChange={(v) => {
        try { setField({ slides: JSON.parse(v) }); } catch { /* keep previous valid value */ }
      }} />);
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
      fields.push(<TextAreaField key="openHoursJson" label="Open hours (JSON object — keys: sun mon tue wed thu fri sat; values: free-form like '10am – 9pm' or 'Closed')" value={typeof cfg.openHours === 'string' ? cfg.openHours : JSON.stringify(cfg.openHours || {}, null, 2)} rows={9} onChange={(v) => {
        try { setField({ openHours: JSON.parse(v) }); } catch { /* keep previous valid value */ }
      }} />);
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
      fields.push(<TextAreaField key="sellingPointsJson" label="Selling points (JSON array of strings, max 3)" value={typeof cfg.sellingPoints === 'string' ? cfg.sellingPoints : JSON.stringify(cfg.sellingPoints || [], null, 2)} rows={5} onChange={(v) => {
        try { setField({ sellingPoints: JSON.parse(v) }); } catch { /* keep previous valid value */ }
      }} />);
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
      fields.push(<TextAreaField key="perksJson" label="Perks (JSON array of strings, max 3)" value={typeof cfg.perks === 'string' ? cfg.perks : JSON.stringify(cfg.perks || [], null, 2)} rows={5} onChange={(v) => {
        try { setField({ perks: JSON.parse(v) }); } catch { /* keep previous valid value */ }
      }} />);
      break;
    }
    case 'RETAIL_WAYFINDING_MAP': {
      fields.push(<TextField key="heading" label="Heading" value={cfg.heading || ''} placeholder="Store Directory" onChange={(v) => setField({ heading: v })} />);
      fields.push(<TextField key="subheading" label="Subheading" value={cfg.subheading || ''} placeholder="Find your aisle" onChange={(v) => setField({ subheading: v })} />);
      fields.push(<ColorPickerField key="bgColor" label="Background color" value={cfg.bgColor || '#faf6f1'} onChange={(v) => setField({ bgColor: v })} />);
      fields.push(<ColorPickerField key="inkColor" label="Outline + label ink" value={cfg.inkColor || '#1a1411'} onChange={(v) => setField({ inkColor: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Highlight + pin accent" value={cfg.accentColor || '#9a2d2d'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<TextAreaField key="youAreHereJson" label="You are here position (JSON { x, y } 0-100, or null to hide)" value={cfg.youAreHere === null ? 'null' : (typeof cfg.youAreHere === 'string' ? cfg.youAreHere : JSON.stringify(cfg.youAreHere || { x: 50, y: 92 }, null, 2))} rows={4} onChange={(v) => {
        try { setField({ youAreHere: JSON.parse(v) }); } catch { /* keep previous valid value */ }
      }} />);
      fields.push(<TextAreaField key="departmentsJson" label="Departments (JSON array of { name, x, y, width, height, color, emoji, highlight })" value={typeof cfg.departments === 'string' ? cfg.departments : JSON.stringify(cfg.departments || [], null, 2)} rows={10} onChange={(v) => {
        try { setField({ departments: JSON.parse(v) }); } catch { /* keep previous valid value */ }
      }} />);
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
      fields.push(<TextField key="rotationMs" label="Rotate every (ms)" value={String(cfg.rotationMs || 7000)} placeholder="7000" onChange={(v) => setField({ rotationMs: parseInt(v) || 7000 })} />);
      fields.push(<TextAreaField key="combosJson" label="Combos (JSON array of { name, includes, price, emoji, badge })" value={typeof cfg.combos === 'string' ? cfg.combos : JSON.stringify(cfg.combos || [], null, 2)} rows={8} onChange={(v) => {
        try { setField({ combos: JSON.parse(v) }); } catch { /* keep previous value; user is mid-typing */ }
      }} />);
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
      fields.push(<TextField key="rotationMs" label="Rotate every (ms)" value={String(cfg.rotationMs || 5500)} placeholder="5500" onChange={(v) => setField({ rotationMs: parseInt(v) || 5500 })} />);
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
      fields.push(<TextAreaField key="entriesJson" label="Custom entries (JSON array of { code, label, emoji }) — leave blank for defaults" value={typeof cfg.entries === 'string' ? cfg.entries : JSON.stringify(cfg.entries || [], null, 2)} rows={6} onChange={(v) => {
        try { setField({ entries: JSON.parse(v) }); } catch { /* keep previous value; user is mid-typing */ }
      }} />);
      break;
    }
    case 'BAR_HAPPY_HOUR_COUNTDOWN': {
      fields.push(<TextField key="title" label="Headline" value={cfg.title || ''} placeholder="HAPPY HOUR" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="subtitle" label="Subtitle" value={cfg.subtitle || ''} placeholder="Tap drinks · House wine · Apps" onChange={(v) => setField({ subtitle: v })} />);
      fields.push(<TextField key="startsAt" label="Start time (e.g. 4:00 PM, 16:00, 4pm)" value={cfg.startsAt || ''} placeholder="4:00 PM" onChange={(v) => setField({ startsAt: v })} />);
      fields.push(<TextField key="endsAt" label="End time (e.g. 7:00 PM, 19:00, 7pm)" value={cfg.endsAt || ''} placeholder="7:00 PM" onChange={(v) => setField({ endsAt: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="Accent neon color" value={cfg.accentColor || '#ec4899'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<TextField key="postEndedMs" label="Show 'ended' state for (ms)" value={String(cfg.postEndedMs || 1800000)} placeholder="1800000" onChange={(v) => setField({ postEndedMs: parseInt(v) || 1800000 })} />);
      fields.push(<TextAreaField key="drinksJson" label="Featured drinks (JSON array of { name, regularPrice, happyPrice, emoji })" value={typeof cfg.drinks === 'string' ? cfg.drinks : JSON.stringify(cfg.drinks || [], null, 2)} rows={6} onChange={(v) => {
        try { setField({ drinks: JSON.parse(v) }); } catch { /* keep previous value; user is mid-typing */ }
      }} />);
      break;
    }
    case 'BAR_GAME_DAY_SCHEDULE': {
      fields.push(<TextField key="title" label="Headline" value={cfg.title || ''} placeholder="GAME DAY" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="subtitle" label="Subtitle" value={cfg.subtitle || ''} placeholder="TODAY'S MATCHUPS" onChange={(v) => setField({ subtitle: v })} />);
      fields.push(<ColorPickerField key="accentColor" label="LIVE chip / accent color" value={cfg.accentColor || '#ef4444'} onChange={(v) => setField({ accentColor: v })} />);
      fields.push(<TextField key="maxRows" label="Max games shown" value={String(cfg.maxRows || 6)} placeholder="6" onChange={(v) => setField({ maxRows: parseInt(v) || 6 })} />);
      fields.push(<TextAreaField key="gamesJson" label="Games (JSON array of { league, away, home, time, channel, status, emoji })" value={typeof cfg.games === 'string' ? cfg.games : JSON.stringify(cfg.games || [], null, 2)} rows={8} onChange={(v) => {
        try { setField({ games: JSON.parse(v) }); } catch { /* keep previous value; user is mid-typing */ }
      }} />);
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
      fields.push(<TextAreaField key="teamsJson" label="Teams (JSON array of { name, score, emoji, delta })" value={typeof cfg.teams === 'string' ? cfg.teams : JSON.stringify(cfg.teams || [], null, 2)} rows={8} onChange={(v) => {
        try { setField({ teams: JSON.parse(v) }); } catch { /* keep previous value; user is mid-typing */ }
      }} />);
      break;
    }
    default: {
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
        // 2026-05-08 — HS portrait widgets get the per-field style
        // disclosure (font-size + color) wired in via StyleableField.
        // MS / Fitness widgets stick with plain TextField for now —
        // they don't have the runtime useTextStyleOverrides hook on
        // their widget side, so showing the disclosure would lie about
        // what works.
        const isHsWidget = typeof zone.widgetType === 'string' && zone.widgetType.startsWith('HS_');
        const styleSetter = (s: FieldStyleMap) => setField({ __styles: s });
        for (const [prefix, keys] of groups) {
          fields.push(SH(prefix, prettySectionLabel(prefix === '_root' ? 'general' : prefix)));
          for (const key of keys) {
            const defaultValue = msDefaults[key] || '';
            const currentValue = (cfg[key] ?? '') as string;
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
          const currentValue = (cfg[f.key] ?? '') as string;
          if (f.multiline) {
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
        break;
      }
      // Unknown widget — fall through to JSON-only editing in Advanced
      return null;
    }
  }

  return (
    <section className="space-y-3">
      <h3 className="text-[10px] font-bold text-slate-400/80 uppercase tracking-widest pl-1">Content</h3>
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
// On the editor side, each text field grows a small "Style" disclosure
// directly under the input — operator clicks it to reveal the size /
// color / weight controls. Empty / cleared inputs delete the matching
// override key so the CSS class default returns. Wrapping all sites is
// done via the StyleableField component below; both single-line and
// multi-line variants exist.

// Schema parity with `apps/web/src/components/widgets/hs/useTextStyleOverrides.ts#TextStyleOverride`.
type FieldStyleProp =
  | 'fontSize'
  | 'color'
  | 'fontWeight'
  | 'fontStyle'
  | 'textDecoration'
  | 'fontFamily'
  | 'lineHeight'
  | 'backgroundColor';
type FieldStyle = {
  fontSize?: number;
  color?: string;
  fontWeight?: number;
  fontStyle?: 'italic' | 'normal';
  textDecoration?: 'underline' | 'line-through' | 'underline line-through' | 'none';
  fontFamily?: string;
  lineHeight?: number;
  backgroundColor?: string;
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
  value: number | string | undefined,
): FieldStyleMap {
  const existing = styles || {};
  const current = { ...(existing[fieldName] || {}) };
  if (value === undefined || value === '' || (typeof value === 'number' && !Number.isFinite(value))) {
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

/** Per-field text formatting toolbar — same component set the custom
 *  TEXT widget uses (FontFamilyField + FontSizeField + FormatToggles +
 *  LineHeightField + ColorField). Every dimension is scoped to ONE
 *  data-field on an HS widget via the `__styles` map; an empty value
 *  removes the override and lets the CSS class default surface again.
 *
 *  Always visible — no disclosure. Operator complained the previous
 *  hidden <details> made them think the feature didn't exist. */
function StyleDisclosure({
  fieldName,
  styles,
  onStylesChange,
}: {
  fieldName: string;
  styles: FieldStyleMap | undefined;
  onStylesChange: (next: FieldStyleMap) => void;
}) {
  const cur = readFieldStyle(styles, fieldName);
  const hasAny = Object.keys(cur).length > 0;
  const setProp = (prop: FieldStyleProp, value: number | string | undefined) => {
    onStylesChange(updateFieldStyleMap(styles, fieldName, prop, value));
  };
  // Resolve the current state of B/I/U/S from the style override.
  const isBold = (cur.fontWeight ?? 0) >= 700;
  const isItalic = cur.fontStyle === 'italic';
  const td = cur.textDecoration || '';
  const isUnderline = td.includes('underline');
  const isStrike = td.includes('line-through');
  // Recompute the textDecoration string when a toggle flips.
  const updateDecoration = (nextU: boolean, nextS: boolean) => {
    const parts: string[] = [];
    if (nextU) parts.push('underline');
    if (nextS) parts.push('line-through');
    setProp('textDecoration', parts.length ? (parts.join(' ') as any) : undefined);
  };
  return (
    <div className="mt-1.5 mb-1.5 rounded-lg border border-slate-200/60 bg-slate-50/60 p-2 space-y-2">
      <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400 flex items-center justify-between">
        <span>Text style</span>
        {hasAny && (
          <button
            type="button"
            onClick={() => {
              const next = { ...(styles || {}) };
              delete next[fieldName];
              onStylesChange(next);
            }}
            className="text-[9px] font-bold text-indigo-500 hover:text-rose-500 transition-colors px-1 py-0.5 rounded hover:bg-rose-50"
            title="Reset all overrides on this field"
          >
            ↺ Reset
          </button>
        )}
      </div>
      <FontFamilyField
        label="Font"
        value={cur.fontFamily || ''}
        onChange={(v) => setProp('fontFamily', v || undefined)}
      />
      <FontSizeField
        label="Size"
        value={cur.fontSize ?? null}
        onChange={(v) => setProp('fontSize', v)}
        getMeasuredSize={() => {
          if (typeof document === 'undefined') return null;
          // Find the rendered text element in the preview by its
          // data-field attribute. Excludes the property panel itself.
          const els = document.querySelectorAll<HTMLElement>(`[data-field="${fieldName}"]`);
          for (const el of Array.from(els)) {
            if (el.closest('[data-properties-panel]')) continue;
            const fs = parseFloat(getComputedStyle(el).fontSize);
            if (Number.isFinite(fs)) return fs;
          }
          return null;
        }}
      />
      <FormatToggles
        bold={isBold}
        italic={isItalic}
        underline={isUnderline}
        strikethrough={isStrike}
        onChange={(patch) => {
          if ('bold' in patch) setProp('fontWeight', patch.bold ? 800 : undefined);
          if ('italic' in patch) setProp('fontStyle', patch.italic ? 'italic' : undefined);
          if ('underline' in patch) updateDecoration(!!patch.underline, isStrike);
          if ('strikethrough' in patch) updateDecoration(isUnderline, !!patch.strikethrough);
        }}
      />
      <LineHeightField
        value={typeof cur.lineHeight === 'number' ? cur.lineHeight : 1.4}
        onChange={(v) => setProp('lineHeight', v)}
      />
      <ColorField
        label="Text color"
        value={cur.color || ''}
        onChange={(v) => setProp('color', v || undefined)}
      />
      <ColorField
        label="Highlight"
        value={cur.backgroundColor || 'transparent'}
        onChange={(v) => setProp('backgroundColor', v && v !== 'transparent' ? v : undefined)}
        allowTransparent
      />
    </div>
  );
}

/** Single-line TextField + Style disclosure. */
function StyleableField({
  label,
  value,
  placeholder,
  onChange,
  fieldName,
  styles,
  onStylesChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  fieldName: string;
  styles: FieldStyleMap | undefined;
  onStylesChange: (next: FieldStyleMap) => void;
}) {
  return (
    <div>
      <TextField label={label} value={value} placeholder={placeholder} onChange={onChange} />
      <StyleDisclosure fieldName={fieldName} styles={styles} onStylesChange={onStylesChange} />
    </div>
  );
}

/** Multi-line TextAreaField + Style disclosure. */
function StyleableAreaField({
  label,
  value,
  placeholder,
  onChange,
  rows,
  fieldName,
  styles,
  onStylesChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  rows?: number;
  fieldName: string;
  styles: FieldStyleMap | undefined;
  onStylesChange: (next: FieldStyleMap) => void;
}) {
  return (
    <div>
      <TextAreaField label={label} value={value} placeholder={placeholder} onChange={onChange} rows={rows} />
      <StyleDisclosure fieldName={fieldName} styles={styles} onStylesChange={onStylesChange} />
    </div>
  );
}

function TextField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <input
        type="text"
        value={local}
        placeholder={placeholder}
        onChange={(e) => { setLocal(e.target.value); onChange(e.target.value); }}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm" />
    </div>
  );
}

function TextAreaField({ label, value, placeholder, onChange, rows = 3 }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void; rows?: number }) {
  // Controlled textarea — local state mirrors the incoming value so we
  // can honor external updates (undo/redo, zone switch, preset load)
  // while saving on every keystroke. Previous `defaultValue` +
  // `onBlur`-only was eating keystrokes when users clicked away via
  // keyboard shortcuts or window lost focus before blur fired, which
  // is exactly why "add a 4th line" appeared to do nothing.
  const [local, setLocal] = useState(value);
  // Sync when the prop changes (e.g. user selected a different zone).
  useEffect(() => { setLocal(value); }, [value]);
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <textarea
        value={local}
        placeholder={placeholder}
        rows={rows}
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
  const schema = holidayFieldSchemaFor(variant, gradeLevel);

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
      <div className="text-[10px] font-bold text-slate-400/80 uppercase tracking-widest pl-1 pt-2">
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
            // Styleable* wrappers so each field gets a 🎨 Style
            // disclosure (font-size + color) just like the HS widgets.
            // Operator's typed style values are forwarded by
            // HolidayWidget into the iframe via postMessage and applied
            // by _style-bridge.js as inline styles on the matching
            // [data-field] element. fieldName is the data-field key
            // (the same dotted-string the iframe-side bridge looks up).
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
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm cursor-pointer">
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
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
        <h3 className="text-[10px] font-bold text-slate-400/80 uppercase tracking-widest pl-1">Backdrop</h3>
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
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <select
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
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 pl-1 text-[10px] font-bold text-slate-400/80 uppercase tracking-widest hover:text-slate-600">
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
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Lunch periods</label>
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
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Format</label>
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
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-[10px] font-semibold text-slate-500">Line height</label>
        <span className="text-[10px] font-mono text-slate-500">{value.toFixed(2)}×</span>
      </div>
      <input
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
              <img src={resolveAssetUrl(value)} alt="" className="w-full h-full object-cover" />
            ) : (
              <video src={resolveAssetUrl(value)} className="w-full h-full object-cover" muted />
            )}
            <button
              type="button"
              onClick={() => onChange('')}
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center hover:bg-rose-600"
              aria-label="Clear"
            >×</button>
          </div>
        ) : (
          <div className="w-14 h-14 rounded border-2 border-dashed border-slate-200 bg-slate-50 flex items-center justify-center text-[10px] text-slate-400 shrink-0">
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

// Multi-asset list — used by IMAGE_CAROUSEL
function AssetListPickerField({ label, value, onChange, kind }: { label: string; value: string[]; onChange: (v: string[]) => void; kind: 'image' | 'video' }) {
  const [open, setOpen] = useState(false);
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));
  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const next = value.slice();
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    onChange(next);
  };
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <div className="space-y-1.5">
        {value.length === 0 && <p className="text-[11px] text-slate-400 italic">No photos yet — add some below.</p>}
        {value.map((url, idx) => (
          <div key={idx} className="flex items-center gap-2 p-1.5 bg-white border border-slate-200 rounded">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resolveAssetUrl(url)} alt="" className="w-10 h-10 object-cover rounded shrink-0 bg-slate-100" />
            <span className="flex-1 text-[10px] text-slate-500 truncate font-mono">{url.split('/').pop()}</span>
            <button type="button" onClick={() => moveUp(idx)} disabled={idx === 0} className="text-[10px] text-slate-400 hover:text-indigo-600 disabled:opacity-30" aria-label="Move up">↑</button>
            <button type="button" onClick={() => remove(idx)} className="text-[10px] text-rose-500 hover:text-rose-700" aria-label="Remove">×</button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full py-1.5 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded border border-dashed border-indigo-200"
        >
          + Add photo from library
        </button>
      </div>
      {open && (
        <AssetLibraryModal kind={kind} onPick={(url) => { onChange([...value, url]); setOpen(false); }} onClose={() => setOpen(false)} />
      )}
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
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Photos</label>
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
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={resolveAssetUrl(photo.url)} alt="" className="w-full h-full object-cover" />
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

export function AssetLibraryModal({ kind, onPick, onClose }: { kind: 'image' | 'video'; onPick: (url: string) => void; onClose: () => void }) {
  const { data: assets, isLoading } = useAssets();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
  const acceptAttr = kind === 'image'
    ? 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif'
    : 'video/mp4,video/webm,video/quicktime';

  const handleUpload = async (file: File) => {
    setUploadError(null);
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
        headers: { 'content-type': presigned.mimeType || contentType },
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

      // Refresh the list so the new asset appears, then auto-pick
      // it so the operator's flow is "click Upload → file dialog →
      // pick a JPG → ✓ done, modal closes, widget shows their
      // photo." No second click required.
      await queryClient.invalidateQueries({ queryKey: ['assets'] });
      const finalUrl = completed.fileUrl || presigned.fileUrl;
      if (finalUrl) onPick(finalUrl);
      else throw new Error('Upload completed but server did not return a file URL.');
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
    <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl ring-1 ring-slate-200 max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-800">Pick {kind === 'image' ? 'an image' : 'a video'}</h2>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100">
            <XIcon className="w-4 h-4" aria-hidden />
          </button>
        </div>

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
              {filtered.map((a: any) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onPick(a.fileUrl || a.url)}
                  className="group relative aspect-square rounded-lg overflow-hidden bg-slate-100 border border-slate-200 hover:border-indigo-400 hover:ring-2 hover:ring-indigo-200 transition-all"
                >
                  {kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={resolveAssetUrl(a.fileUrl || a.url)} alt={a.originalName || ''} className="w-full h-full object-cover" />
                  ) : (
                    <video src={resolveAssetUrl(a.fileUrl || a.url)} className="w-full h-full object-cover" muted />
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent text-white text-[9px] font-bold px-1.5 py-1 truncate">
                    {a.originalName || a.fileUrl}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
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

  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5 flex items-center gap-1">
        <Tv className="w-3 h-3" /> Streaming channel
      </label>
      <select
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

function PosCategoryPickerField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (categoryId: string) => void;
}) {
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
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm cursor-pointer"
      >
        <option value="">— All categories —</option>
        {(categories || []).map((cat) => (
          <option key={cat.id} value={cat.id}>
            {cat.name} ({cat.itemCount})
          </option>
        ))}
      </select>
      {isLoading && <p className="text-[10px] text-slate-400 mt-1">Loading POS catalog…</p>}
      {!isLoading && isError && (
        <p className="text-[10px] text-rose-600 mt-1">
          Couldn't load POS categories — try refresh.
        </p>
      )}
      {!isLoading && !isError && (!categories || categories.length === 0) && (
        <p className="text-[10px] text-slate-400 mt-1">
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
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Location
      </label>
      <div className="flex gap-2">
        <input
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
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Scroll speed
      </label>
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
          ? <img src={current} alt="" className="w-full h-full object-contain" />
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
                <label className="block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Or type any emoji / text</label>
                <input
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
                  <img src={current} alt="" className="w-10 h-10 object-contain rounded border border-slate-200" />
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
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Bell schedule</label>
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
