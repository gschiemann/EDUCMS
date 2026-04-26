"use client";

import { useId, useState, useEffect, useRef } from 'react';
import { AlignLeft, AlignCenter, AlignRight, AlignStartVertical, AlignEndVertical, AlignVerticalJustifyCenter, ChevronDown, ChevronRight, X as XIcon } from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';
import { widgetLabel } from './constants';
import { useAssets, usePlaylists, useTemplates } from '@/hooks/use-api';

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
};

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
  const bgColorId = useId();
  const bgGradientId = useId();
  const bgImageId = useId();

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

      <section className="space-y-3">
        <h3 className="text-[10px] font-bold text-slate-400/80 uppercase tracking-widest pl-1">Backdrop</h3>
        <div className="bg-slate-50/50 rounded-xl p-3 border border-slate-100 shadow-sm space-y-3">
          <div>
            <label htmlFor={bgColorId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">Solid Color</label>
            <div className="flex gap-2 items-center">
              <div className="relative w-9 h-9 rounded-lg shadow-sm border border-slate-200/60 overflow-hidden shrink-0">
                <input
                  id={bgColorId}
                  type="color"
                  value={meta.bgColor || '#ffffff'}
                  onChange={(e) => setMeta({ bgColor: e.target.value })}
                  className="absolute -inset-2 w-16 h-16 cursor-pointer"
                />
              </div>
              <input
                type="text"
                aria-label="Background color hex"
                value={meta.bgColor}
                onChange={(e) => setMeta({ bgColor: e.target.value })}
                placeholder="#ffffff"
                className="flex-1 px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-mono uppercase focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm inset-shadow-sm"
              />
            </div>
          </div>
          <div>
            <label htmlFor={bgGradientId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">CSS Gradient</label>
            <input
              id={bgGradientId}
              type="text"
              value={meta.bgGradient}
              onChange={(e) => setMeta({ bgGradient: e.target.value })}
              placeholder="linear-gradient(...)"
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm inset-shadow-sm"
            />
          </div>
          <div>
            <label htmlFor={bgImageId} className="block text-[10px] font-semibold text-slate-500 mb-1.5">Image URL</label>
            <input
              id={bgImageId}
              type="url"
              value={meta.bgImage}
              onChange={(e) => setMeta({ bgImage: e.target.value })}
              placeholder="https://..."
              className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200/60 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all shadow-sm inset-shadow-sm"
            />
          </div>
          <TemplateBackdropPicker
            current={{ bgColor: meta.bgColor, bgGradient: meta.bgGradient, bgImage: meta.bgImage }}
            onPick={(bg) => setMeta({
              bgColor: bg.bgColor || '',
              bgGradient: bg.bgGradient || '',
              bgImage: bg.bgImage || '',
            })}
          />
        </div>
      </section>
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
      fields.push(<TextAreaField key="content" label="Text" value={cfg.content || ''} placeholder="Your headline…" onChange={(v) => setField({ content: v })} rows={3} />);
      // Banner themes often use a subtitle too. Expose it for shape
      // themes where the widget renders both lines.
      if (isShapeTheme) {
        fields.push(<TextField key="subtitle" label="Subtitle (optional)" value={cfg.subtitle || ''} placeholder="Today is going to be amazing" onChange={(v) => setField({ subtitle: v })} />);
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
        fields.push(<FontSizeField key="fontSize" label="Font size" value={cfg.fontSize ?? null} onChange={(v) => setField({ fontSize: v })} />);
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
      fields.push(<TextField key="title" label="Title" value={cfg.title || ''} placeholder="Big news…" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextAreaField key="message" label="Message" value={cfg.message || cfg.body || ''} placeholder="Details…" onChange={(v) => setField({ message: v, body: undefined })} rows={3} />);
      if (!isShapeTheme) {
        fields.push(<TextField key="badge" label="Badge label" value={cfg.badgeLabel || ''} placeholder="📣 Today's Announcement" onChange={(v) => setField({ badgeLabel: v })} />);
        fields.push(<SelectField key="priority" label="Priority" value={cfg.priority || 'normal'} options={[['low','Low'],['normal','Normal'],['high','High'],['critical','Critical']]} onChange={(v) => setField({ priority: v })} />);
      }
      break;
    case 'STAFF_SPOTLIGHT':
      fields.push(<TextField key="staffName" label="Name" value={cfg.staffName || ''} placeholder="Mrs. Johnson" onChange={(v) => setField({ staffName: v })} />);
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
        fields.push(<TextField key="targetDate" label="Target date (YYYY-MM-DD or full ISO)" value={cfg.targetDate || ''} placeholder="2026-05-15" onChange={(v) => setField({ targetDate: v })} />);
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
      fields.push(<SelectField key="format" label="Format" value={cfg.format || '12h'} options={[['12h','12-hour'],['24h','24-hour']]} onChange={(v) => setField({ format: v })} />);
      fields.push(<TextField key="timezone" label="Timezone (optional)" value={cfg.timezone || ''} placeholder="America/Chicago" onChange={(v) => setField({ timezone: v })} />);
      if (!isShapeTheme) {
        // showSeconds / showDays / bgColor are ignored by shape
        // themes (clock face is baked into the SVG).
        fields.push(<ToggleField key="showSeconds" label="Show seconds" value={!!cfg.showSeconds} onChange={(v) => setField({ showSeconds: v })} />);
        fields.push(<ToggleField key="showDays" label="Show day & date" value={cfg.showDays !== false} onChange={(v) => setField({ showDays: v })} />);
        fields.push(<ColorField key="bgColor" label="Background" value={cfg.bgColor || 'transparent'} onChange={(v) => setField({ bgColor: v })} allowTransparent />);
      }
      break;
    case 'WEATHER':
      fields.push(<TextField key="location" label="Location" value={cfg.location || ''} placeholder="Springfield" onChange={(v) => setField({ location: v })} />);
      fields.push(<SelectField key="units" label="Units" value={cfg.units || 'imperial'} options={[['imperial','°F'],['metric','°C']]} onChange={(v) => setField({ units: v })} />);
      fields.push(<TextField key="tempF" label={`Current temp (${cfg.units === 'metric' ? '°C' : '°F'})`} value={String(cfg.tempF ?? '')} placeholder="72" onChange={(v) => setField({ tempF: parseInt(v) || 0 })} />);
      fields.push(<TextField key="high" label="High" value={String(cfg.high ?? '')} placeholder="78" onChange={(v) => setField({ high: parseInt(v) || 0 })} />);
      fields.push(<TextField key="low" label="Low" value={String(cfg.low ?? '')} placeholder="64" onChange={(v) => setField({ low: parseInt(v) || 0 })} />);
      fields.push(<TextField key="condition" label="Condition" value={cfg.condition || ''} placeholder="Sunny" onChange={(v) => setField({ condition: v })} />);
      break;
    case 'TICKER': {
      const msgs = Array.isArray(cfg.messages) ? cfg.messages : [];
      const label = `Messages (one per line) — ${msgs.length} saved`;
      // Preserve blank lines while the user is actively typing (the
      // user needs an empty line to exist briefly when pressing Enter
      // before typing the next message). Filter happens only on save,
      // not on every keystroke. We keep trailing empty as-is too;
      // saving an all-empty doesn't hurt anything.
      fields.push(<TextAreaField key="messages" label={label} value={msgs.join('\n')} placeholder="Welcome back!" onChange={(v) => setField({ messages: v.split('\n') })} rows={6} />);
      fields.push(<SelectField key="speed" label="Speed" value={cfg.speed || 'medium'} options={[['slow','Slow'],['medium','Medium'],['fast','Fast']]} onChange={(v) => setField({ speed: v })} />);
      fields.push(<ToggleField key="scrollEnabled" label="Animate scroll" value={cfg.scrollEnabled !== false} onChange={(v) => setField({ scrollEnabled: v })} />);
      break;
    }
    case 'CALENDAR':
      fields.push(<TextAreaField key="events" label="Events (date | title — one per line)" value={(cfg.events || []).map((e: any) => `${e.date || ''} | ${e.title || ''}`).join('\n')} placeholder="Today | Spring Concert&#10;Tomorrow | PTA Meeting" onChange={(v) => setField({ events: v.split('\n').filter(Boolean).map(line => { const [date, title] = line.split('|').map(s => s.trim()); return { date, title }; }) })} rows={5} />);
      fields.push(<TextField key="maxEvents" label="Max events to show" value={String(cfg.maxEvents || 4)} placeholder="4" onChange={(v) => setField({ maxEvents: parseInt(v) || 4 })} />);
      break;
    case 'LUNCH_MENU':
      fields.push(<TextAreaField key="menu" label="Menu (Day: items — one per line)" value={cfg.menu || ''} placeholder="Monday: Pizza, Salad" onChange={(v) => setField({ menu: v, meals: undefined })} rows={6} />);
      break;
    case 'LOGO':
      fields.push(<TextField key="initials" label="Initials" value={cfg.initials || ''} placeholder="SE" onChange={(v) => setField({ initials: v })} />);
      fields.push(<TextField key="schoolName" label="School name (optional)" value={cfg.schoolName || ''} placeholder="Sunnyside Elementary" onChange={(v) => setField({ schoolName: v })} />);
      fields.push(<AssetPickerField key="assetUrl" label="Logo image (optional)" value={cfg.assetUrl || ''} kind="image" onChange={(v) => setField({ assetUrl: v })} />);
      break;
    case 'IMAGE_CAROUSEL':
      fields.push(<TextField key="title" label="Caption" value={cfg.title || ''} placeholder="Photo Gallery" onChange={(v) => setField({ title: v })} />);
      fields.push(<TextField key="intervalMs" label="Rotate every (ms)" value={String(cfg.intervalMs || 5000)} placeholder="5000" onChange={(v) => setField({ intervalMs: parseInt(v) || 5000 })} />);
      fields.push(<SelectField key="fitMode" label="Image fit" value={cfg.fitMode || 'cover'} options={[['cover','Fill (crop)'],['contain','Fit (no crop)']]} onChange={(v) => setField({ fitMode: v })} />);
      fields.push(<AssetListPickerField key="urls" label="Photos" value={(cfg.urls || cfg.assetUrls || []) as string[]} kind="image" onChange={(v) => setField({ urls: v, assetUrls: undefined })} />);
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
      fields.push(
        <BellScheduleEditor
          key="schedule"
          value={(cfg.schedule || []) as Array<{ label: string; start: string; end?: string }>}
          onChange={(schedule) => setField({ schedule })}
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
      // can personalize for their school (satisfies the
      // "can't pick a widget you can't edit" rule from the customer-
      // readiness audit).
      const SH = (key: string, label: string) => (
        <div
          key={`sh-${key}`}
          className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200"
        >
          {label}
        </div>
      );
      fields.push(SH('school', 'School identity'));
      fields.push(<TextField key="schoolInitials" label="Seal initials (3 letters)" value={cfg.schoolInitials || ''} placeholder="WHS" onChange={(v) => setField({ schoolInitials: v })} />);
      fields.push(<TextField key="schoolEst" label="Seal year" value={cfg.schoolEst || ''} placeholder="EST. 1956" onChange={(v) => setField({ schoolEst: v })} />);
      fields.push(<TextField key="schoolName" label="School name (all caps)" value={cfg.schoolName || ''} placeholder="WESTRIDGE WILDCATS" onChange={(v) => setField({ schoolName: v })} />);
      fields.push(<TextField key="department" label="Department label" value={cfg.department || ''} placeholder="ATHLETIC DEPARTMENT" onChange={(v) => setField({ department: v })} />);

      fields.push(SH('greeting', 'Jersey chest greeting'));
      fields.push(<TextField key="greetingEyebrow" label="Eyebrow" value={cfg.greetingEyebrow || ''} placeholder="GOOD MORNING, WILDCATS" onChange={(v) => setField({ greetingEyebrow: v })} />);
      fields.push(<TextField key="greetingHeadline" label="Big headline" value={cfg.greetingHeadline || ''} placeholder="GAME DAY." onChange={(v) => setField({ greetingHeadline: v })} />);
      fields.push(<TextField key="greetingSubtitle" label="Subtitle" value={cfg.greetingSubtitle || ''} placeholder="Pack the gym tonight." onChange={(v) => setField({ greetingSubtitle: v })} />);

      fields.push(SH('scoreboard', 'Game of the week'));
      fields.push(<TextField key="scoreboardTag" label="Label" value={cfg.scoreboardTag || ''} placeholder="GAME OF THE WEEK" onChange={(v) => setField({ scoreboardTag: v })} />);
      fields.push(<TextField key="scoreboardSport" label="Sport / division" value={cfg.scoreboardSport || ''} placeholder="BASKETBALL · VARSITY" onChange={(v) => setField({ scoreboardSport: v })} />);
      fields.push(<TextField key="homeTeam" label="Home team" value={cfg.homeTeam || ''} placeholder="WILDCATS" onChange={(v) => setField({ homeTeam: v })} />);
      fields.push(<TextField key="homeAbbr" label="Home crest (3 letters)" value={cfg.homeAbbr || ''} placeholder="WHS" onChange={(v) => setField({ homeAbbr: v })} />);
      fields.push(<TextField key="awayTeam" label="Away team" value={cfg.awayTeam || ''} placeholder="TIGERS" onChange={(v) => setField({ awayTeam: v })} />);
      fields.push(<TextField key="awayAbbr" label="Away crest (3 letters)" value={cfg.awayAbbr || ''} placeholder="CEN" onChange={(v) => setField({ awayAbbr: v })} />);
      fields.push(<TextField key="scoreboardTime" label="When" value={cfg.scoreboardTime || ''} placeholder="TONIGHT · 7:00 PM" onChange={(v) => setField({ scoreboardTime: v })} />);
      fields.push(<TextField key="scoreboardWhere" label="Where" value={cfg.scoreboardWhere || ''} placeholder="HOME · GYM A" onChange={(v) => setField({ scoreboardWhere: v })} />);

      fields.push(SH('stats', 'Stat row (clock / weather / record / attendance)'));
      fields.push(<TextField key="clockTime" label="Clock time" value={cfg.clockTime || ''} placeholder="7:53" onChange={(v) => setField({ clockTime: v })} />);
      fields.push(<TextField key="clockCaption" label="Clock caption" value={cfg.clockCaption || ''} placeholder="Tuesday · 1st period @ 8:05" onChange={(v) => setField({ clockCaption: v })} />);
      fields.push(<TextField key="weatherTemp" label="Weather temp" value={cfg.weatherTemp || ''} placeholder="46°" onChange={(v) => setField({ weatherTemp: v })} />);
      fields.push(<TextField key="weatherCondition" label="Weather condition" value={cfg.weatherCondition || ''} placeholder="Clear skies · hi 62°" onChange={(v) => setField({ weatherCondition: v })} />);
      fields.push(<TextField key="recordValue" label="Season record" value={cfg.recordValue || ''} placeholder="14–2" onChange={(v) => setField({ recordValue: v })} />);
      fields.push(<TextField key="recordCaption" label="Record caption" value={cfg.recordCaption || ''} placeholder="League leaders · 8-game streak" onChange={(v) => setField({ recordCaption: v })} />);
      fields.push(<TextField key="attendanceValue" label="Attendance" value={cfg.attendanceValue || ''} placeholder="1,217" onChange={(v) => setField({ attendanceValue: v })} />);
      fields.push(<TextField key="attendanceCaption" label="Attendance caption" value={cfg.attendanceCaption || ''} placeholder="Enrolled · 98.2% present" onChange={(v) => setField({ attendanceCaption: v })} />);

      fields.push(SH('teacher', 'Coach / Teacher of the week'));
      fields.push(<TextField key="teacherLabel" label="Label" value={cfg.teacherLabel || ''} placeholder="COACH OF THE WEEK" onChange={(v) => setField({ teacherLabel: v })} />);
      fields.push(<TextField key="teacherName" label="Name" value={cfg.teacherName || ''} placeholder="COACH RIVERA" onChange={(v) => setField({ teacherName: v })} />);
      fields.push(<TextField key="teacherGrade" label="Role / subject" value={cfg.teacherGrade || ''} placeholder="HEAD COACH · AP U.S. HISTORY" onChange={(v) => setField({ teacherGrade: v })} />);
      fields.push(<TextAreaField key="teacherQuote" label="Quote" value={cfg.teacherQuote || ''} placeholder='"Be ready today."' rows={3} onChange={(v) => setField({ teacherQuote: v })} />);
      fields.push(<TextField key="teacherNumber" label="Jersey number" value={String(cfg.teacherNumber ?? '')} placeholder="14" onChange={(v) => setField({ teacherNumber: v })} />);

      fields.push(SH('announcement', 'Top announcement'));
      fields.push(<TextField key="announcementTag" label="Tag" value={cfg.announcementTag || ''} placeholder="★ HEADS UP" onChange={(v) => setField({ announcementTag: v })} />);
      fields.push(<TextField key="announcementHeadline" label="Headline" value={cfg.announcementHeadline || ''} placeholder="PEP RALLY — 7TH PERIOD" onChange={(v) => setField({ announcementHeadline: v })} />);
      fields.push(<TextAreaField key="announcementBody" label="Body" value={cfg.announcementBody || ''} rows={3} onChange={(v) => setField({ announcementBody: v })} />);
      fields.push(<TextField key="announcementDate" label="When" value={cfg.announcementDate || ''} placeholder="TODAY · 2:15 PM" onChange={(v) => setField({ announcementDate: v })} />);

      fields.push(SH('countdown', 'Countdown card'));
      fields.push(<TextField key="countdownValue" label="Days number" value={String(cfg.countdownValue ?? '')} placeholder="03" onChange={(v) => setField({ countdownValue: v })} />);
      fields.push(<TextField key="countdownLabel" label="Label" value={cfg.countdownLabel || ''} placeholder="DAYS TO HOMECOMING" onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(<TextField key="countdownSub" label="Subtext" value={cfg.countdownSub || ''} placeholder="TICKETS AT THE STUDENT STORE" onChange={(v) => setField({ countdownSub: v })} />);

      fields.push(SH('events', 'Bottom schedule strip'));
      for (const n of [1, 2, 3]) {
        const k = `event${n}` as 'event1' | 'event2' | 'event3';
        fields.push(<TextField key={`${k}Mark`} label={`Event ${n} · Day`} value={cfg[`${k}Mark`] || ''} placeholder="MON" onChange={(v) => setField({ [`${k}Mark`]: v })} />);
        fields.push(<TextField key={`${k}When`} label={`Event ${n} · When/where`} value={cfg[`${k}When`] || ''} placeholder="7:00 PM · FIELD" onChange={(v) => setField({ [`${k}When`]: v })} />);
        fields.push(<TextField key={`${k}Name`} label={`Event ${n} · Title`} value={cfg[`${k}Name`] || ''} placeholder="Boys Soccer vs. Central" onChange={(v) => setField({ [`${k}Name`]: v })} />);
      }

      fields.push(SH('ticker', 'PA-system ticker'));
      fields.push(<TextField key="tickerTag" label="Stamp text" value={cfg.tickerTag || ''} placeholder="PA SYSTEM" onChange={(v) => setField({ tickerTag: v })} />);
      fields.push(<TextAreaField key="tickerMessage" label="Scrolling message" value={cfg.tickerMessage || ''} placeholder="BUS 14 RUNNING 10 MIN LATE  ●  MATHLETES IN ROOM 102  ●" rows={3} onChange={(v) => setField({ tickerMessage: v })} />);
      break;
    }
    case 'HS_BROADCAST': {
      // Campus news-desk lobby — every data-widget in the HTML mockup
      // gets a matching editor section.
      const SH = (key: string, label: string) => (
        <div key={`sh-${key}`} className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200">{label}</div>
      );
      fields.push(SH('school', 'School brandmark'));
      fields.push(<TextField key="schoolChip" label="Chip letters" value={cfg.schoolChip || ''} placeholder="WHS" onChange={(v) => setField({ schoolChip: v })} />);
      fields.push(<TextField key="schoolName" label="School name" value={cfg.schoolName || ''} placeholder="WESTRIDGE HIGH" onChange={(v) => setField({ schoolName: v })} />);
      fields.push(<TextField key="schoolSub" label="Network sub" value={cfg.schoolSub || ''} placeholder="CAMPUS NEWS NETWORK" onChange={(v) => setField({ schoolSub: v })} />);

      fields.push(SH('status', 'ON AIR indicator'));
      fields.push(<TextField key="statusLabel" label="Status label" value={cfg.statusLabel || ''} placeholder="ON AIR · MORNING REPORT" onChange={(v) => setField({ statusLabel: v })} />);

      fields.push(SH('greeting', 'Top-story greeting'));
      fields.push(<TextField key="greetingEyebrow" label="Eyebrow" value={cfg.greetingEyebrow || ''} placeholder="TOP STORY · TUESDAY" onChange={(v) => setField({ greetingEyebrow: v })} />);
      fields.push(<TextField key="greetingHeadline" label="Big headline" value={cfg.greetingHeadline || ''} placeholder="GOOD MORNING, WESTRIDGE." onChange={(v) => setField({ greetingHeadline: v })} />);
      fields.push(<TextAreaField key="greetingSubtitle" label="Subtitle" value={cfg.greetingSubtitle || ''} rows={2} onChange={(v) => setField({ greetingSubtitle: v })} />);

      fields.push(SH('clock', 'Clock panel'));
      fields.push(<TextField key="clockTime" label="Time" value={cfg.clockTime || ''} placeholder="7:53" onChange={(v) => setField({ clockTime: v })} />);
      fields.push(<TextField key="clockCaption" label="Caption" value={cfg.clockCaption || ''} placeholder="Tuesday, April 21 · AM Broadcast" onChange={(v) => setField({ clockCaption: v })} />);

      fields.push(SH('weather', 'Forecast panel'));
      fields.push(<TextField key="weatherTemp" label="Temperature" value={cfg.weatherTemp || ''} placeholder="46°" onChange={(v) => setField({ weatherTemp: v })} />);
      fields.push(<TextField key="weatherCondition" label="Condition" value={cfg.weatherCondition || ''} placeholder="☀ CLEAR · HI 62°" onChange={(v) => setField({ weatherCondition: v })} />);

      fields.push(SH('teacher', 'Featured guest / Teacher of the week'));
      fields.push(<TextField key="teacherPortraitTag" label="Portrait caption" value={cfg.teacherPortraitTag || ''} placeholder="[ portrait ]" onChange={(v) => setField({ teacherPortraitTag: v })} />);
      fields.push(<TextField key="teacherLabel" label="Label" value={cfg.teacherLabel || ''} placeholder="FEATURED GUEST · TEACHER OF THE WEEK" onChange={(v) => setField({ teacherLabel: v })} />);
      fields.push(<TextField key="teacherName" label="Name" value={cfg.teacherName || ''} placeholder="MS. KOWALSKI" onChange={(v) => setField({ teacherName: v })} />);
      fields.push(<TextField key="teacherGrade" label="Role / subject" value={cfg.teacherGrade || ''} placeholder="AP PHYSICS · ROOM 214" onChange={(v) => setField({ teacherGrade: v })} />);
      fields.push(<TextAreaField key="teacherQuote" label="Quote" value={cfg.teacherQuote || ''} rows={3} onChange={(v) => setField({ teacherQuote: v })} />);

      fields.push(SH('announcement', 'Breaking story card'));
      fields.push(<TextField key="announcementTitle" label="Tag" value={cfg.announcementTitle || ''} placeholder="★ BREAKING · TODAY" onChange={(v) => setField({ announcementTitle: v })} />);
      fields.push(<TextField key="announcementHeadline" label="Headline" value={cfg.announcementHeadline || ''} placeholder="COLLEGE FAIR IN THE GYM" onChange={(v) => setField({ announcementHeadline: v })} />);
      fields.push(<TextAreaField key="announcementBody" label="Body" value={cfg.announcementBody || ''} rows={3} onChange={(v) => setField({ announcementBody: v })} />);
      fields.push(<TextField key="announcementDate" label="When · where" value={cfg.announcementDate || ''} placeholder="04.21 · 10:15 AM – 1:00 PM · MAIN GYM" onChange={(v) => setField({ announcementDate: v })} />);

      fields.push(SH('events', 'Schedule grid (3 events)'));
      for (const n of [1, 2, 3]) {
        const k = `event${n}` as 'event1' | 'event2' | 'event3';
        fields.push(<TextField key={`${k}When`} label={`Event ${n} · When`} value={cfg[`${k}When`] || ''} placeholder="MON · 3:30 PM" onChange={(v) => setField({ [`${k}When`]: v })} />);
        fields.push(<TextField key={`${k}Name`} label={`Event ${n} · Title`} value={cfg[`${k}Name`] || ''} placeholder="Varsity Soccer vs. Central" onChange={(v) => setField({ [`${k}Name`]: v })} />);
      }

      fields.push(SH('countdown', 'Countdown'));
      fields.push(<TextField key="countdownLabel" label="Label" value={cfg.countdownLabel || ''} placeholder="DAYS TO PROM" onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(<TextField key="countdownValue" label="Number" value={String(cfg.countdownValue ?? '')} placeholder="24" onChange={(v) => setField({ countdownValue: v })} />);
      fields.push(<TextField key="countdownUnit" label="Unit" value={cfg.countdownUnit || ''} placeholder="DAYS · SAVE THE DATE" onChange={(v) => setField({ countdownUnit: v })} />);

      fields.push(SH('ticker', 'Bottom crawl'));
      fields.push(<TextField key="tickerTag" label="Stamp" value={cfg.tickerTag || ''} placeholder="LATEST" onChange={(v) => setField({ tickerTag: v })} />);
      fields.push(<TextAreaField key="tickerMessage" label="Scrolling message" value={cfg.tickerMessage || ''} rows={3} onChange={(v) => setField({ tickerMessage: v })} />);
      break;
    }
    case 'HS_YEARBOOK': {
      const SH = (key: string, label: string) => (
        <div key={`sh-${key}`} className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200">{label}</div>
      );
      fields.push(SH('school', 'Masthead'));
      fields.push(<TextField key="schoolName" label="Publication name" value={cfg.schoolName || ''} placeholder="The Westridge Review" onChange={(v) => setField({ schoolName: v })} />);
      fields.push(<TextField key="schoolIssue" label="Issue line" value={cfg.schoolIssue || ''} placeholder="VOL. LXIX · NO. 142 · APRIL 2026" onChange={(v) => setField({ schoolIssue: v })} />);

      fields.push(SH('clock', 'Folio clock (top right)'));
      fields.push(<TextField key="clockTime" label="Time" value={cfg.clockTime || ''} placeholder="7:53 a.m." onChange={(v) => setField({ clockTime: v })} />);
      fields.push(<TextField key="clockCaption" label="Caption" value={cfg.clockCaption || ''} placeholder="Tuesday · April 21 · 46° clear" onChange={(v) => setField({ clockCaption: v })} />);

      fields.push(SH('greeting', 'Hero lede'));
      fields.push(<TextField key="greetingEyebrow" label="Eyebrow" value={cfg.greetingEyebrow || ''} placeholder="MORNING EDITION · FEATURE" onChange={(v) => setField({ greetingEyebrow: v })} />);
      fields.push(<TextField key="greetingHeadline" label="Big headline" value={cfg.greetingHeadline || ''} placeholder="Today, we begin again." onChange={(v) => setField({ greetingHeadline: v })} />);
      fields.push(<TextAreaField key="greetingSubtitle" label="Italic lede" value={cfg.greetingSubtitle || ''} rows={3} onChange={(v) => setField({ greetingSubtitle: v })} />);

      fields.push(SH('announcement', "Editor's note card"));
      fields.push(<TextField key="announcementTag" label="Kicker" value={cfg.announcementTag || ''} placeholder="EDITOR'S NOTE" onChange={(v) => setField({ announcementTag: v })} />);
      fields.push(<TextField key="announcementHeadline" label="Headline" value={cfg.announcementHeadline || ''} onChange={(v) => setField({ announcementHeadline: v })} />);
      fields.push(<TextAreaField key="announcementBody" label="Body" value={cfg.announcementBody || ''} rows={3} onChange={(v) => setField({ announcementBody: v })} />);
      fields.push(<TextField key="announcementDate" label="Deadline line" value={cfg.announcementDate || ''} onChange={(v) => setField({ announcementDate: v })} />);

      fields.push(SH('weather', 'TODAY card'));
      fields.push(<TextField key="weatherTemp" label="Temp" value={cfg.weatherTemp || ''} placeholder="46°" onChange={(v) => setField({ weatherTemp: v })} />);
      fields.push(<TextField key="weatherCondition" label="Condition" value={cfg.weatherCondition || ''} onChange={(v) => setField({ weatherCondition: v })} />);

      fields.push(SH('countdown', 'Graduation countdown'));
      fields.push(<TextField key="countdownLabel" label="Label" value={cfg.countdownLabel || ''} placeholder="DAYS TO GRADUATION" onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(<TextField key="countdownValue" label="Number" value={String(cfg.countdownValue ?? '')} placeholder="41" onChange={(v) => setField({ countdownValue: v })} />);
      fields.push(<TextField key="countdownUnit" label="Unit / sub" value={cfg.countdownUnit || ''} onChange={(v) => setField({ countdownUnit: v })} />);

      fields.push(SH('feature', 'Feature photo block'));
      fields.push(<TextField key="featurePhotoTag" label="Photo slug" value={cfg.featurePhotoTag || ''} placeholder="[ photo · auditorium ]" onChange={(v) => setField({ featurePhotoTag: v })} />);
      fields.push(<TextField key="featureNum" label="Story number" value={cfg.featureNum || ''} placeholder="01" onChange={(v) => setField({ featureNum: v })} />);
      fields.push(<TextField key="featureTitle" label="Story title" value={cfg.featureTitle || ''} onChange={(v) => setField({ featureTitle: v })} />);
      fields.push(<TextAreaField key="featureBody" label="Story body" value={cfg.featureBody || ''} rows={3} onChange={(v) => setField({ featureBody: v })} />);

      fields.push(SH('teacher', 'Featured portrait'));
      fields.push(<TextField key="teacherPhotoTag" label="Portrait slug" value={cfg.teacherPhotoTag || ''} placeholder="[ portrait · J. Kowalski ]" onChange={(v) => setField({ teacherPhotoTag: v })} />);
      fields.push(<TextField key="teacherLabel" label="Kicker" value={cfg.teacherLabel || ''} placeholder="FEATURED · TEACHER OF THE WEEK" onChange={(v) => setField({ teacherLabel: v })} />);
      fields.push(<TextField key="teacherName" label="Name" value={cfg.teacherName || ''} placeholder="Ms. Kowalski" onChange={(v) => setField({ teacherName: v })} />);
      fields.push(<TextField key="teacherGrade" label="Role / subject" value={cfg.teacherGrade || ''} onChange={(v) => setField({ teacherGrade: v })} />);
      fields.push(<TextAreaField key="teacherQuote" label="Pull quote" value={cfg.teacherQuote || ''} rows={3} onChange={(v) => setField({ teacherQuote: v })} />);
      fields.push(<TextField key="teacherByline" label="Byline" value={cfg.teacherByline || ''} placeholder="PROFILE BY THE EDITORIAL STAFF · P. 12" onChange={(v) => setField({ teacherByline: v })} />);
      fields.push(<TextField key="folioPage" label="Folio page number" value={cfg.folioPage || ''} placeholder="— p. 01 —" onChange={(v) => setField({ folioPage: v })} />);

      fields.push(SH('events', 'Calendar footer (3 events)'));
      fields.push(<TextField key="schoolSection" label="Section name" value={cfg.schoolSection || ''} placeholder="CALENDAR · SECTION B" onChange={(v) => setField({ schoolSection: v })} />);
      for (const n of [1, 2, 3]) {
        const k = `event${n}` as 'event1' | 'event2' | 'event3';
        fields.push(<TextField key={`${k}When`} label={`Event ${n} · When`} value={cfg[`${k}When`] || ''} onChange={(v) => setField({ [`${k}When`]: v })} />);
        fields.push(<TextField key={`${k}Name`} label={`Event ${n} · Title`} value={cfg[`${k}Name`] || ''} onChange={(v) => setField({ [`${k}Name`]: v })} />);
      }

      fields.push(SH('ticker', 'Wire ticker'));
      fields.push(<TextField key="tickerTag" label="Stamp" value={cfg.tickerTag || ''} placeholder="WIRE · LATE" onChange={(v) => setField({ tickerTag: v })} />);
      fields.push(<TextAreaField key="tickerMessage" label="Scrolling message" value={cfg.tickerMessage || ''} rows={3} onChange={(v) => setField({ tickerMessage: v })} />);
      break;
    }
    case 'HS_TERMINAL': {
      const SH = (key: string, label: string) => (
        <div key={`sh-${key}`} className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200">{label}</div>
      );
      fields.push(SH('school', 'Shell top bar'));
      fields.push(<TextField key="schoolHost" label="Host" value={cfg.schoolHost || ''} placeholder="westridge-hs" onChange={(v) => setField({ schoolHost: v })} />);
      fields.push(<TextField key="schoolPath" label="Path" value={cfg.schoolPath || ''} placeholder="~/lobby/morning" onChange={(v) => setField({ schoolPath: v })} />);
      fields.push(<TextField key="schoolSession" label="Session line" value={cfg.schoolSession || ''} placeholder="session #2 · term spring-26" onChange={(v) => setField({ schoolSession: v })} />);
      fields.push(<TextField key="clockTime" label="Topbar clock" value={cfg.clockTime || ''} placeholder="07:53:21" onChange={(v) => setField({ clockTime: v })} />);
      fields.push(<TextField key="weatherTemp" label="Topbar temp" value={cfg.weatherTemp || ''} placeholder="46°F" onChange={(v) => setField({ weatherTemp: v })} />);
      fields.push(<TextField key="weatherCondition" label="Topbar condition" value={cfg.weatherCondition || ''} placeholder="clear" onChange={(v) => setField({ weatherCondition: v })} />);

      fields.push(SH('greeting', 'Shell prompt / greeting'));
      fields.push(<TextField key="greetingCmd" label="Command" value={cfg.greetingCmd || ''} placeholder="./say-morning" onChange={(v) => setField({ greetingCmd: v })} />);
      fields.push(<TextField key="greetingArg" label="Args" value={cfg.greetingArg || ''} placeholder="--to=everyone --loud" onChange={(v) => setField({ greetingArg: v })} />);
      fields.push(<TextField key="greetingHeadline" label="Banner headline" value={cfg.greetingHeadline || ''} placeholder="HELLO, WESTRIDGE." onChange={(v) => setField({ greetingHeadline: v })} />);
      fields.push(<TextAreaField key="greetingSubtitle" label="Subtitle (// comment)" value={cfg.greetingSubtitle || ''} rows={2} onChange={(v) => setField({ greetingSubtitle: v })} />);

      fields.push(SH('stats', 'Stat boxes (clock / weatherd / attendance / lunch)'));
      fields.push(<TextField key="clockbigVal" label="Clock value" value={cfg.clockbigVal || ''} onChange={(v) => setField({ clockbigVal: v })} />);
      fields.push(<TextField key="clockbigCap" label="Clock caption" value={cfg.clockbigCap || ''} onChange={(v) => setField({ clockbigCap: v })} />);
      fields.push(<TextField key="weatherdVal" label="Weather value" value={cfg.weatherdVal || ''} onChange={(v) => setField({ weatherdVal: v })} />);
      fields.push(<TextField key="weatherdCap" label="Weather caption" value={cfg.weatherdCap || ''} onChange={(v) => setField({ weatherdCap: v })} />);
      fields.push(<TextField key="attendanceVal" label="Attendance value" value={cfg.attendanceVal || ''} onChange={(v) => setField({ attendanceVal: v })} />);
      fields.push(<TextField key="attendanceCap" label="Attendance caption" value={cfg.attendanceCap || ''} onChange={(v) => setField({ attendanceCap: v })} />);
      fields.push(<TextField key="lunchVal" label="Lunch value" value={cfg.lunchVal || ''} onChange={(v) => setField({ lunchVal: v })} />);
      fields.push(<TextField key="lunchCap" label="Lunch caption" value={cfg.lunchCap || ''} onChange={(v) => setField({ lunchCap: v })} />);

      fields.push(SH('teacher', 'whoami --featured teacher card'));
      fields.push(<TextField key="teacherCmd" label="Command" value={cfg.teacherCmd || ''} placeholder="whoami --featured" onChange={(v) => setField({ teacherCmd: v })} />);
      fields.push(<TextField key="teacherName" label="Name" value={cfg.teacherName || ''} placeholder="ms.kowalski" onChange={(v) => setField({ teacherName: v })} />);
      fields.push(<TextField key="teacherRole" label="Role" value={cfg.teacherRole || ''} onChange={(v) => setField({ teacherRole: v })} />);
      fields.push(<TextField key="teacherRoom" label="Room" value={cfg.teacherRoom || ''} onChange={(v) => setField({ teacherRoom: v })} />);
      fields.push(<TextField key="teacherYears" label="Years" value={cfg.teacherYears || ''} onChange={(v) => setField({ teacherYears: v })} />);
      fields.push(<TextField key="teacherGroups" label="Groups" value={cfg.teacherGroups || ''} onChange={(v) => setField({ teacherGroups: v })} />);
      fields.push(<TextAreaField key="teacherQuote" label="Quote" value={cfg.teacherQuote || ''} rows={3} onChange={(v) => setField({ teacherQuote: v })} />);

      fields.push(SH('announcement', '[ ! priority ] WARN box'));
      fields.push(<TextField key="announcementTag" label="Tag" value={cfg.announcementTag || ''} onChange={(v) => setField({ announcementTag: v })} />);
      fields.push(<TextField key="announcementHeadline" label="Headline" value={cfg.announcementHeadline || ''} onChange={(v) => setField({ announcementHeadline: v })} />);
      fields.push(<TextAreaField key="announcementBody" label="Body" value={cfg.announcementBody || ''} rows={3} onChange={(v) => setField({ announcementBody: v })} />);
      fields.push(<TextField key="announcementDate" label="When/where" value={cfg.announcementDate || ''} onChange={(v) => setField({ announcementDate: v })} />);

      fields.push(SH('countdown', '[ countdown ] box'));
      fields.push(<TextField key="countdownValue" label="Number" value={String(cfg.countdownValue ?? '')} onChange={(v) => setField({ countdownValue: v })} />);
      fields.push(<TextField key="countdownLabel" label="Label" value={cfg.countdownLabel || ''} onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(<TextField key="countdownSub" label="Sub" value={cfg.countdownSub || ''} onChange={(v) => setField({ countdownSub: v })} />);

      fields.push(SH('events', 'cron -l /var/school/events (3 rows)'));
      for (const n of [1, 2, 3]) {
        const k = `event${n}` as 'event1' | 'event2' | 'event3';
        fields.push(<TextField key={`${k}When`} label={`Event ${n} · when`} value={cfg[`${k}When`] || ''} onChange={(v) => setField({ [`${k}When`]: v })} />);
        fields.push(<TextField key={`${k}Where`} label={`Event ${n} · where`} value={cfg[`${k}Where`] || ''} onChange={(v) => setField({ [`${k}Where`]: v })} />);
        fields.push(<TextField key={`${k}Name`} label={`Event ${n} · what`} value={cfg[`${k}Name`] || ''} onChange={(v) => setField({ [`${k}Name`]: v })} />);
        fields.push(<TextField key={`${k}Who`} label={`Event ${n} · who`} value={cfg[`${k}Who`] || ''} onChange={(v) => setField({ [`${k}Who`]: v })} />);
      }

      fields.push(SH('ticker', '/var/log/syslog ticker'));
      fields.push(<TextField key="tickerTag" label="Tag" value={cfg.tickerTag || ''} placeholder="/var/log/syslog" onChange={(v) => setField({ tickerTag: v })} />);
      fields.push(<TextAreaField key="tickerMessage" label="Syslog messages" value={cfg.tickerMessage || ''} rows={3} onChange={(v) => setField({ tickerMessage: v })} />);
      break;
    }
    case 'HS_TRANSIT': {
      const SH = (key: string, label: string) => (
        <div key={`sh-${key}`} className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200">{label}</div>
      );
      fields.push(SH('school', 'Station mast'));
      fields.push(<TextField key="schoolCode" label="Code chip" value={cfg.schoolCode || ''} placeholder="WHS" onChange={(v) => setField({ schoolCode: v })} />);
      fields.push(<TextField key="brandStation" label="Station name" value={cfg.brandStation || ''} placeholder="WESTRIDGE HIGH · MAIN TERMINAL" onChange={(v) => setField({ brandStation: v })} />);
      fields.push(<TextField key="brandMeta" label="Meta line" value={cfg.brandMeta || ''} onChange={(v) => setField({ brandMeta: v })} />);
      fields.push(<TextField key="clockTime" label="Clock time" value={cfg.clockTime || ''} onChange={(v) => setField({ clockTime: v })} />);
      fields.push(<TextField key="clockDate" label="Date" value={cfg.clockDate || ''} onChange={(v) => setField({ clockDate: v })} />);
      fields.push(<TextField key="clockTz" label="Timezone" value={cfg.clockTz || ''} onChange={(v) => setField({ clockTz: v })} />);

      fields.push(SH('greeting', 'Now boarding hero'));
      fields.push(<TextField key="greetingGate" label="Room / gate" value={cfg.greetingGate || ''} placeholder="1A" onChange={(v) => setField({ greetingGate: v })} />);
      fields.push(<TextField key="greetingEyebrow" label="Eyebrow" value={cfg.greetingEyebrow || ''} onChange={(v) => setField({ greetingEyebrow: v })} />);
      fields.push(<TextField key="greetingHeadline" label="Headline" value={cfg.greetingHeadline || ''} onChange={(v) => setField({ greetingHeadline: v })} />);
      fields.push(<TextAreaField key="greetingSubtitle" label="Subtitle" value={cfg.greetingSubtitle || ''} rows={2} onChange={(v) => setField({ greetingSubtitle: v })} />);
      fields.push(<TextField key="weatherTemp" label="Outside temp" value={cfg.weatherTemp || ''} onChange={(v) => setField({ weatherTemp: v })} />);
      fields.push(<TextField key="weatherCondition" label="Conditions" value={cfg.weatherCondition || ''} onChange={(v) => setField({ weatherCondition: v })} />);
      fields.push(<TextField key="weatherStatus" label="Status badge" value={cfg.weatherStatus || ''} placeholder="ON TIME" onChange={(v) => setField({ weatherStatus: v })} />);

      fields.push(SH('departures', 'Departure rows (5 classes)'));
      for (const n of [0, 1, 2, 3, 4]) {
        const k = `dep${n}` as 'dep0' | 'dep1' | 'dep2' | 'dep3' | 'dep4';
        fields.push(<TextField key={`${k}Time`} label={`#${n + 1} · Time`} value={cfg[`${k}Time`] || ''} onChange={(v) => setField({ [`${k}Time`]: v })} />);
        fields.push(<TextField key={`${k}Code`} label={`#${n + 1} · Course code`} value={cfg[`${k}Code`] || ''} onChange={(v) => setField({ [`${k}Code`]: v })} />);
        fields.push(<TextField key={`${k}Dest`} label={`#${n + 1} · Subject`} value={cfg[`${k}Dest`] || ''} onChange={(v) => setField({ [`${k}Dest`]: v })} />);
        fields.push(<TextField key={`${k}Note`} label={`#${n + 1} · Note`} value={cfg[`${k}Note`] || ''} onChange={(v) => setField({ [`${k}Note`]: v })} />);
        fields.push(<TextField key={`${k}Room`} label={`#${n + 1} · Room/gate`} value={cfg[`${k}Room`] || ''} onChange={(v) => setField({ [`${k}Room`]: v })} />);
        fields.push(<TextField key={`${k}Teacher`} label={`#${n + 1} · Teacher`} value={cfg[`${k}Teacher`] || ''} onChange={(v) => setField({ [`${k}Teacher`]: v })} />);
        fields.push(<TextField key={`${k}Status`} label={`#${n + 1} · Status (BOARDING/ON TIME/DELAY/OPEN/SCHED)`} value={cfg[`${k}Status`] || ''} onChange={(v) => setField({ [`${k}Status`]: v })} />);
      }

      fields.push(SH('teacher', 'Flight crew spotlight'));
      fields.push(<TextField key="teacherLabel" label="Label" value={cfg.teacherLabel || ''} onChange={(v) => setField({ teacherLabel: v })} />);
      fields.push(<TextField key="teacherName" label="Name" value={cfg.teacherName || ''} onChange={(v) => setField({ teacherName: v })} />);
      fields.push(<TextField key="teacherMeta" label="Meta" value={cfg.teacherMeta || ''} onChange={(v) => setField({ teacherMeta: v })} />);
      fields.push(<TextAreaField key="teacherQuote" label="Quote" value={cfg.teacherQuote || ''} rows={3} onChange={(v) => setField({ teacherQuote: v })} />);
      fields.push(<TextField key="teacherNum" label="Portrait big number" value={cfg.teacherNum || ''} onChange={(v) => setField({ teacherNum: v })} />);

      fields.push(SH('announcement', 'Advisory panel'));
      fields.push(<TextField key="announcementTag" label="Tag" value={cfg.announcementTag || ''} onChange={(v) => setField({ announcementTag: v })} />);
      fields.push(<TextField key="announcementHeadline" label="Headline" value={cfg.announcementHeadline || ''} onChange={(v) => setField({ announcementHeadline: v })} />);
      fields.push(<TextAreaField key="announcementBody" label="Body" value={cfg.announcementBody || ''} rows={3} onChange={(v) => setField({ announcementBody: v })} />);
      fields.push(<TextField key="announcementDate" label="When" value={cfg.announcementDate || ''} onChange={(v) => setField({ announcementDate: v })} />);

      fields.push(SH('countdown', 'Next-leg countdown'));
      fields.push(<TextField key="countdownLabel" label="Label" value={cfg.countdownLabel || ''} onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(<TextField key="countdownValue" label="Value" value={String(cfg.countdownValue ?? '')} onChange={(v) => setField({ countdownValue: v })} />);
      fields.push(<TextField key="countdownSub" label="Sub" value={cfg.countdownSub || ''} onChange={(v) => setField({ countdownSub: v })} />);

      fields.push(SH('ticker', 'PA ticker'));
      fields.push(<TextField key="tickerTag" label="Tag" value={cfg.tickerTag || ''} placeholder="PA · ALL TERMINALS" onChange={(v) => setField({ tickerTag: v })} />);
      fields.push(<TextAreaField key="tickerMessage" label="Scrolling message" value={cfg.tickerMessage || ''} rows={3} onChange={(v) => setField({ tickerMessage: v })} />);
      break;
    }
    case 'HS_GALLERY': {
      const SH = (key: string, label: string) => (
        <div key={`sh-${key}`} className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200">{label}</div>
      );
      fields.push(SH('school', 'Masthead'));
      fields.push(<TextField key="schoolName" label="Publication name" value={cfg.schoolName || ''} onChange={(v) => setField({ schoolName: v })} />);
      fields.push(<TextField key="clockDate" label="Date (nav)" value={cfg.clockDate || ''} onChange={(v) => setField({ clockDate: v })} />);
      fields.push(<TextField key="clockTime" label="Time (nav)" value={cfg.clockTime || ''} onChange={(v) => setField({ clockTime: v })} />);
      fields.push(<TextField key="weatherCondition" label="Weather (nav)" value={cfg.weatherCondition || ''} onChange={(v) => setField({ weatherCondition: v })} />);

      fields.push(SH('greeting', 'Plaque (italic accent word)'));
      fields.push(<TextField key="greetingEyebrow" label="Exhibition number" value={cfg.greetingEyebrow || ''} onChange={(v) => setField({ greetingEyebrow: v })} />);
      fields.push(<TextField key="greetingHeadline1" label="Headline pt1" value={cfg.greetingHeadline1 || ''} placeholder="Today," onChange={(v) => setField({ greetingHeadline1: v })} />);
      fields.push(<TextField key="greetingHeadline2" label="Headline pt2 (italic/accent)" value={cfg.greetingHeadline2 || ''} placeholder="as ever," onChange={(v) => setField({ greetingHeadline2: v })} />);
      fields.push(<TextField key="greetingHeadline3" label="Headline pt3" value={cfg.greetingHeadline3 || ''} placeholder="begins here." onChange={(v) => setField({ greetingHeadline3: v })} />);
      fields.push(<TextAreaField key="greetingSubtitle" label="Subtitle" value={cfg.greetingSubtitle || ''} rows={3} onChange={(v) => setField({ greetingSubtitle: v })} />);

      fields.push(SH('events', 'Acquisitions (3 Roman-numeral cards)'));
      for (const n of [0, 1, 2]) {
        const k = `event${n}` as 'event0' | 'event1' | 'event2';
        fields.push(<TextField key={`${k}Num`} label={`#${n + 1} · Roman numeral`} value={cfg[`${k}Num`] || ''} onChange={(v) => setField({ [`${k}Num`]: v })} />);
        fields.push(<TextField key={`${k}Name`} label={`#${n + 1} · Title`} value={cfg[`${k}Name`] || ''} onChange={(v) => setField({ [`${k}Name`]: v })} />);
        fields.push(<TextField key={`${k}Meta`} label={`#${n + 1} · Meta`} value={cfg[`${k}Meta`] || ''} onChange={(v) => setField({ [`${k}Meta`]: v })} />);
        fields.push(<TextField key={`${k}Time`} label={`#${n + 1} · Time`} value={cfg[`${k}Time`] || ''} onChange={(v) => setField({ [`${k}Time`]: v })} />);
        fields.push(<TextField key={`${k}Day`} label={`#${n + 1} · Day`} value={cfg[`${k}Day`] || ''} onChange={(v) => setField({ [`${k}Day`]: v })} />);
      }

      fields.push(SH('wall', 'Wall-label stat row'));
      fields.push(<TextField key="clockbigVal" label="Clock value" value={cfg.clockbigVal || ''} onChange={(v) => setField({ clockbigVal: v })} />);
      fields.push(<TextField key="clockbigCap" label="Clock caption" value={cfg.clockbigCap || ''} onChange={(v) => setField({ clockbigCap: v })} />);
      fields.push(<TextField key="weatherbigVal" label="Weather value" value={cfg.weatherbigVal || ''} onChange={(v) => setField({ weatherbigVal: v })} />);
      fields.push(<TextField key="weatherbigCap" label="Weather caption" value={cfg.weatherbigCap || ''} onChange={(v) => setField({ weatherbigCap: v })} />);
      fields.push(<TextField key="attendanceVal" label="Attendance" value={cfg.attendanceVal || ''} onChange={(v) => setField({ attendanceVal: v })} />);
      fields.push(<TextField key="attendanceCap" label="Attendance caption" value={cfg.attendanceCap || ''} onChange={(v) => setField({ attendanceCap: v })} />);
      fields.push(<TextField key="countdownLabel" label="Countdown label" value={cfg.countdownLabel || ''} onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(<TextField key="countdownValue" label="Countdown value" value={String(cfg.countdownValue ?? '')} onChange={(v) => setField({ countdownValue: v })} />);
      fields.push(<TextField key="countdownSub" label="Countdown sub" value={cfg.countdownSub || ''} onChange={(v) => setField({ countdownSub: v })} />);

      fields.push(SH('teacher', 'Artist statement / teacher feature'));
      fields.push(<TextField key="teacherTag" label="Plate tag" value={cfg.teacherTag || ''} onChange={(v) => setField({ teacherTag: v })} />);
      fields.push(<TextField key="teacherLabel" label="Label" value={cfg.teacherLabel || ''} onChange={(v) => setField({ teacherLabel: v })} />);
      fields.push(<TextField key="teacherName" label="Name" value={cfg.teacherName || ''} onChange={(v) => setField({ teacherName: v })} />);
      fields.push(<TextField key="teacherMeta" label="Meta" value={cfg.teacherMeta || ''} onChange={(v) => setField({ teacherMeta: v })} />);
      fields.push(<TextAreaField key="teacherQuote" label="Statement" value={cfg.teacherQuote || ''} rows={3} onChange={(v) => setField({ teacherQuote: v })} />);
      fields.push(<TextField key="teacherByline" label="Byline" value={cfg.teacherByline || ''} onChange={(v) => setField({ teacherByline: v })} />);

      fields.push(SH('announcement', "Curator's Note advisory"));
      fields.push(<TextField key="announcementTag" label="Tag" value={cfg.announcementTag || ''} onChange={(v) => setField({ announcementTag: v })} />);
      fields.push(<TextField key="announcementHeadline" label="Headline" value={cfg.announcementHeadline || ''} onChange={(v) => setField({ announcementHeadline: v })} />);
      fields.push(<TextAreaField key="announcementBody" label="Body" value={cfg.announcementBody || ''} rows={3} onChange={(v) => setField({ announcementBody: v })} />);
      fields.push(<TextField key="announcementDate" label="When" value={cfg.announcementDate || ''} onChange={(v) => setField({ announcementDate: v })} />);

      fields.push(SH('brand', 'Gallery hours footer'));
      fields.push(<TextField key="brandHours" label="Hours title" value={cfg.brandHours || ''} placeholder="Galleries Open" onChange={(v) => setField({ brandHours: v })} />);
      fields.push(<TextField key="brandSpan" label="Hours span" value={cfg.brandSpan || ''} onChange={(v) => setField({ brandSpan: v })} />);
      fields.push(<TextField key="brandClosed" label="Closed line" value={cfg.brandClosed || ''} onChange={(v) => setField({ brandClosed: v })} />);
      fields.push(<TextField key="brandCoda" label="Italic coda" value={cfg.brandCoda || ''} onChange={(v) => setField({ brandCoda: v })} />);

      fields.push(SH('ticker', "Docent's Note ticker"));
      fields.push(<TextField key="tickerTag" label="Tag" value={cfg.tickerTag || ''} placeholder="Docent's Note" onChange={(v) => setField({ tickerTag: v })} />);
      fields.push(<TextAreaField key="tickerMessage" label="Italic crawl" value={cfg.tickerMessage || ''} rows={3} onChange={(v) => setField({ tickerMessage: v })} />);
      break;
    }
    case 'HS_BLUEPRINT': {
      const SH = (key: string, label: string) => (
        <div key={`sh-${key}`} className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200">{label}</div>
      );
      fields.push(SH('titleblock', 'Title block header'));
      fields.push(<TextField key="schoolCode" label="Code" value={cfg.schoolCode || ''} placeholder="WHS" onChange={(v) => setField({ schoolCode: v })} />);
      fields.push(<TextField key="schoolName" label="School sub" value={cfg.schoolName || ''} onChange={(v) => setField({ schoolName: v })} />);
      fields.push(<TextField key="brandLabel1" label="Project label" value={cfg.brandLabel1 || ''} onChange={(v) => setField({ brandLabel1: v })} />);
      fields.push(<TextField key="brandProject" label="Project value" value={cfg.brandProject || ''} onChange={(v) => setField({ brandProject: v })} />);
      fields.push(<TextField key="clockLabel" label="Date/time label" value={cfg.clockLabel || ''} onChange={(v) => setField({ clockLabel: v })} />);
      fields.push(<TextField key="clockDate" label="Date" value={cfg.clockDate || ''} onChange={(v) => setField({ clockDate: v })} />);
      fields.push(<TextField key="clockTime" label="Time" value={cfg.clockTime || ''} onChange={(v) => setField({ clockTime: v })} />);
      fields.push(<TextField key="brandSheet" label="Sheet" value={cfg.brandSheet || ''} placeholder="A-01" onChange={(v) => setField({ brandSheet: v })} />);
      fields.push(<TextField key="brandRev" label="Rev" value={cfg.brandRev || ''} placeholder="142" onChange={(v) => setField({ brandRev: v })} />);

      fields.push(SH('greeting', 'Hero sheet A-01'));
      fields.push(<TextField key="greetingDimTop" label="Top dimension" value={cfg.greetingDimTop || ''} onChange={(v) => setField({ greetingDimTop: v })} />);
      fields.push(<TextField key="greetingDimLeft" label="Left dimension" value={cfg.greetingDimLeft || ''} onChange={(v) => setField({ greetingDimLeft: v })} />);
      fields.push(<TextField key="greetingEyebrow" label="Eyebrow" value={cfg.greetingEyebrow || ''} onChange={(v) => setField({ greetingEyebrow: v })} />);
      fields.push(<TextField key="greetingHeadline" label="Headline" value={cfg.greetingHeadline || ''} onChange={(v) => setField({ greetingHeadline: v })} />);
      fields.push(<TextAreaField key="greetingSubtitle" label="Subtitle" value={cfg.greetingSubtitle || ''} rows={3} onChange={(v) => setField({ greetingSubtitle: v })} />);

      fields.push(SH('data', 'Data panels (A-01.1 through .4)'));
      fields.push(<TextField key="clockbigLabel" label="Clock label" value={cfg.clockbigLabel || ''} onChange={(v) => setField({ clockbigLabel: v })} />);
      fields.push(<TextField key="clockbigVal" label="Clock value" value={cfg.clockbigVal || ''} onChange={(v) => setField({ clockbigVal: v })} />);
      fields.push(<TextField key="clockbigCap" label="Clock caption" value={cfg.clockbigCap || ''} onChange={(v) => setField({ clockbigCap: v })} />);
      fields.push(<TextField key="weatherTemp" label="Weather temp" value={cfg.weatherTemp || ''} onChange={(v) => setField({ weatherTemp: v })} />);
      fields.push(<TextField key="weatherCondition" label="Weather condition" value={cfg.weatherCondition || ''} onChange={(v) => setField({ weatherCondition: v })} />);
      fields.push(<TextField key="attendanceValue" label="Attendance" value={cfg.attendanceValue || ''} onChange={(v) => setField({ attendanceValue: v })} />);
      fields.push(<TextField key="attendanceCap" label="Attendance caption" value={cfg.attendanceCap || ''} onChange={(v) => setField({ attendanceCap: v })} />);
      fields.push(<TextField key="countdownLabel" label="Countdown label" value={cfg.countdownLabel || ''} onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(<TextField key="countdownValue" label="Countdown value" value={String(cfg.countdownValue ?? '')} onChange={(v) => setField({ countdownValue: v })} />);
      fields.push(<TextField key="countdownSub" label="Countdown sub" value={cfg.countdownSub || ''} onChange={(v) => setField({ countdownSub: v })} />);

      fields.push(SH('schedule', 'Sheet A-02 schedule (3 events)'));
      for (const n of [0, 1, 2]) {
        const k = `event${n}` as 'event0' | 'event1' | 'event2';
        fields.push(<TextField key={`${k}Time`} label={`#${n + 1} · Time`} value={cfg[`${k}Time`] || ''} onChange={(v) => setField({ [`${k}Time`]: v })} />);
        fields.push(<TextField key={`${k}Code`} label={`#${n + 1} · Course`} value={cfg[`${k}Code`] || ''} onChange={(v) => setField({ [`${k}Code`]: v })} />);
        fields.push(<TextField key={`${k}Name`} label={`#${n + 1} · Section`} value={cfg[`${k}Name`] || ''} onChange={(v) => setField({ [`${k}Name`]: v })} />);
        fields.push(<TextField key={`${k}Room`} label={`#${n + 1} · Room`} value={cfg[`${k}Room`] || ''} onChange={(v) => setField({ [`${k}Room`]: v })} />);
        fields.push(<TextField key={`${k}Who`} label={`#${n + 1} · Instructor`} value={cfg[`${k}Who`] || ''} onChange={(v) => setField({ [`${k}Who`]: v })} />);
      }

      fields.push(SH('teacher', 'Sheet A-03 faculty profile'));
      fields.push(<TextField key="teacherNum" label="Number" value={cfg.teacherNum || ''} onChange={(v) => setField({ teacherNum: v })} />);
      fields.push(<TextField key="teacherLabel" label="Label" value={cfg.teacherLabel || ''} onChange={(v) => setField({ teacherLabel: v })} />);
      fields.push(<TextField key="teacherName" label="Name" value={cfg.teacherName || ''} onChange={(v) => setField({ teacherName: v })} />);
      fields.push(<TextField key="teacherMeta" label="Meta" value={cfg.teacherMeta || ''} onChange={(v) => setField({ teacherMeta: v })} />);
      fields.push(<TextAreaField key="teacherQuote" label="Quote" value={cfg.teacherQuote || ''} rows={3} onChange={(v) => setField({ teacherQuote: v })} />);

      fields.push(SH('announcement', 'Sheet A-04 advisory'));
      fields.push(<TextField key="announcementTag" label="Tag" value={cfg.announcementTag || ''} onChange={(v) => setField({ announcementTag: v })} />);
      fields.push(<TextField key="announcementHeadline" label="Headline" value={cfg.announcementHeadline || ''} onChange={(v) => setField({ announcementHeadline: v })} />);
      fields.push(<TextAreaField key="announcementBody" label="Body" value={cfg.announcementBody || ''} rows={3} onChange={(v) => setField({ announcementBody: v })} />);
      fields.push(<TextField key="announcementDate" label="When" value={cfg.announcementDate || ''} onChange={(v) => setField({ announcementDate: v })} />);

      fields.push(SH('ticker', 'Revision log ticker'));
      fields.push(<TextField key="tickerTag" label="Tag" value={cfg.tickerTag || ''} placeholder="REVISION LOG" onChange={(v) => setField({ tickerTag: v })} />);
      fields.push(<TextAreaField key="tickerMessage" label="RFI log messages" value={cfg.tickerMessage || ''} rows={3} onChange={(v) => setField({ tickerMessage: v })} />);
      break;
    }
    case 'HS_ZINE': {
      const SH = (key: string, label: string) => (
        <div key={`sh-${key}`} className="pt-3 pb-1 px-1 text-[10px] font-bold text-indigo-500 uppercase tracking-widest border-b border-slate-200">{label}</div>
      );
      fields.push(SH('school', 'Masthead'));
      fields.push(<TextField key="schoolName" label="Big title" value={cfg.schoolName || ''} placeholder="WESTRIDGE!" onChange={(v) => setField({ schoolName: v })} />);
      fields.push(<TextField key="schoolSub" label="Sub line" value={cfg.schoolSub || ''} onChange={(v) => setField({ schoolSub: v })} />);
      fields.push(<TextField key="brandStamp1" label="Stamp 1 (red)" value={cfg.brandStamp1 || ''} onChange={(v) => setField({ brandStamp1: v })} />);
      fields.push(<TextField key="brandStamp2" label="Stamp 2 (ink)" value={cfg.brandStamp2 || ''} onChange={(v) => setField({ brandStamp2: v })} />);
      fields.push(<TextField key="brandStamp3" label="Stamp 3 (cyan)" value={cfg.brandStamp3 || ''} onChange={(v) => setField({ brandStamp3: v })} />);

      fields.push(SH('greeting', 'Hero sheet'));
      fields.push(<TextField key="greetingEyebrow" label="Eyebrow" value={cfg.greetingEyebrow || ''} onChange={(v) => setField({ greetingEyebrow: v })} />);
      fields.push(<TextField key="greetingHeadline1" label="Headline pt1" value={cfg.greetingHeadline1 || ''} placeholder="BE" onChange={(v) => setField({ greetingHeadline1: v })} />);
      fields.push(<TextField key="greetingHeadline2" label="Headline pt2 (yellow highlight)" value={cfg.greetingHeadline2 || ''} placeholder="LOUD" onChange={(v) => setField({ greetingHeadline2: v })} />);
      fields.push(<TextField key="greetingHeadline3" label="Headline pt3" value={cfg.greetingHeadline3 || ''} placeholder="TODAY." onChange={(v) => setField({ greetingHeadline3: v })} />);
      fields.push(<TextAreaField key="greetingSubtitle" label="Subtitle" value={cfg.greetingSubtitle || ''} rows={3} onChange={(v) => setField({ greetingSubtitle: v })} />);

      fields.push(SH('teacher', 'Teacher poster'));
      fields.push(<TextField key="teacherCaption" label="Big name caption" value={cfg.teacherCaption || ''} onChange={(v) => setField({ teacherCaption: v })} />);
      fields.push(<TextField key="teacherSub" label="Sub caption" value={cfg.teacherSub || ''} onChange={(v) => setField({ teacherSub: v })} />);

      fields.push(SH('stats', 'Side stats'));
      fields.push(<TextField key="attendanceValue" label="Attendance value" value={cfg.attendanceValue || ''} onChange={(v) => setField({ attendanceValue: v })} />);
      fields.push(<TextField key="attendanceCap" label="Attendance caption" value={cfg.attendanceCap || ''} onChange={(v) => setField({ attendanceCap: v })} />);
      fields.push(<TextField key="countdownLabel" label="Countdown label" value={cfg.countdownLabel || ''} onChange={(v) => setField({ countdownLabel: v })} />);
      fields.push(<TextField key="countdownValue" label="Countdown value" value={String(cfg.countdownValue ?? '')} onChange={(v) => setField({ countdownValue: v })} />);
      fields.push(<TextField key="countdownSub" label="Countdown sub" value={cfg.countdownSub || ''} onChange={(v) => setField({ countdownSub: v })} />);

      fields.push(SH('events', 'Polaroid events (3)'));
      for (const n of [0, 1, 2]) {
        const k = `event${n}` as 'event0' | 'event1' | 'event2';
        fields.push(<TextField key={`${k}When`} label={`#${n + 1} · When`} value={cfg[`${k}When`] || ''} onChange={(v) => setField({ [`${k}When`]: v })} />);
        fields.push(<TextField key={`${k}Name`} label={`#${n + 1} · Title`} value={cfg[`${k}Name`] || ''} onChange={(v) => setField({ [`${k}Name`]: v })} />);
      }
      fields.push(<TextField key="countdownBigValue" label="Big red countdown value" value={String(cfg.countdownBigValue ?? '')} onChange={(v) => setField({ countdownBigValue: v })} />);
      fields.push(<TextField key="countdownBigLabel" label="Big red countdown label" value={cfg.countdownBigLabel || ''} onChange={(v) => setField({ countdownBigLabel: v })} />);

      fields.push(SH('announcement', 'Ransom-letter announcement'));
      fields.push(<TextField key="announcementTag" label="Tag" value={cfg.announcementTag || ''} onChange={(v) => setField({ announcementTag: v })} />);
      fields.push(<TextField key="announcementHeadline" label="Headline" value={cfg.announcementHeadline || ''} onChange={(v) => setField({ announcementHeadline: v })} />);
      fields.push(<TextAreaField key="announcementBody" label="Body" value={cfg.announcementBody || ''} rows={3} onChange={(v) => setField({ announcementBody: v })} />);
      fields.push(<TextField key="announcementDate" label="When" value={cfg.announcementDate || ''} onChange={(v) => setField({ announcementDate: v })} />);

      fields.push(SH('clock', 'Floating clock'));
      fields.push(<TextField key="clockLabel" label="Label" value={cfg.clockLabel || ''} onChange={(v) => setField({ clockLabel: v })} />);
      fields.push(<TextField key="clockTime" label="Time" value={cfg.clockTime || ''} onChange={(v) => setField({ clockTime: v })} />);
      fields.push(<TextField key="weatherCondition" label="Date/weather line" value={cfg.weatherCondition || ''} onChange={(v) => setField({ weatherCondition: v })} />);

      fields.push(SH('ticker', 'xeroxwire ticker'));
      fields.push(<TextField key="tickerTag" label="Tag" value={cfg.tickerTag || ''} placeholder="xeroxwire" onChange={(v) => setField({ tickerTag: v })} />);
      fields.push(<TextAreaField key="tickerMessage" label="Typewriter crawl" value={cfg.tickerMessage || ''} rows={3} onChange={(v) => setField({ tickerMessage: v })} />);
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
                <TextAreaField
                  key={key}
                  label={prettyFieldLabel(key)}
                  value={currentValue}
                  placeholder={defaultValue}
                  rows={3}
                  onChange={(v) => setField({ [key]: v })}
                />,
              );
            } else {
              fields.push(
                <TextField
                  key={key}
                  label={prettyFieldLabel(key)}
                  value={currentValue}
                  placeholder={defaultValue}
                  onChange={(v) => setField({ [key]: v })}
                />,
              );
            }
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

function TextField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <input type="text" defaultValue={value} placeholder={placeholder}
        onBlur={(e) => onChange(e.target.value)}
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
 * TemplateBackdropPicker — renders a swatch grid where every entry is
 * the bgColor/bgGradient/bgImage of an existing system preset. One
 * click adopts that backdrop on the current custom template. Saves the
 * operator from typing "linear-gradient(180deg,#fce7f3 0%,#ffe4e6 …)"
 * by hand or hunting through 60+ templates for the gradient they
 * remember liking.
 *
 * Deduplicated by bg signature so a portrait + landscape pair don't
 * show as two separate swatches.
 */
function TemplateBackdropPicker({
  current,
  onPick,
}: {
  current: { bgColor?: string; bgGradient?: string; bgImage?: string };
  onPick: (bg: { bgColor?: string; bgGradient?: string; bgImage?: string }) => void;
}) {
  const { data: templates } = useTemplates();
  const swatches = (() => {
    const seen = new Set<string>();
    const out: { name: string; bgColor?: string; bgGradient?: string; bgImage?: string }[] = [];
    for (const t of (templates as any[] | undefined) || []) {
      const sig = `${t.bgColor || ''}|${t.bgGradient || ''}|${t.bgImage || ''}`;
      if (seen.has(sig) || sig === '||') continue;
      seen.add(sig);
      out.push({ name: t.name || '(untitled)', bgColor: t.bgColor, bgGradient: t.bgGradient, bgImage: t.bgImage });
      if (out.length >= 60) break;
    }
    return out;
  })();
  const isCurrent = (s: typeof swatches[number]) =>
    (s.bgColor || '') === (current.bgColor || '') &&
    (s.bgGradient || '') === (current.bgGradient || '') &&
    (s.bgImage || '') === (current.bgImage || '');

  if (swatches.length === 0) return null;

  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">Browse template backgrounds</label>
      <div className="grid grid-cols-6 gap-1.5 max-h-48 overflow-y-auto p-1 rounded-lg bg-white border border-slate-200/60">
        {swatches.map((s, i) => {
          const bg = s.bgImage
            ? `url(${s.bgImage.startsWith('url(') ? s.bgImage.slice(4, -1) : s.bgImage}) center/cover`
            : s.bgGradient || s.bgColor || '#ffffff';
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPick(s)}
              title={s.name}
              aria-label={`Use backdrop from ${s.name}`}
              className={`aspect-square rounded transition-all hover:scale-105 ${isCurrent(s) ? 'ring-2 ring-indigo-500 ring-offset-1' : 'border border-slate-200/60'}`}
              style={{ background: bg }}
            />
          );
        })}
      </div>
      <p className="mt-1 text-[10px] text-slate-400">Click any swatch to adopt that template's background. Operator-typed values above stay as overrides.</p>
    </div>
  );
}

function FontFamilyField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
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

function FontSizeField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | undefined) => void }) {
  const current = typeof value === 'number' && Number.isFinite(value) ? value : null;
  const display = current ?? '';
  const bump = (delta: number) => {
    const base = current ?? 48;
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
          placeholder="auto"
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
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                defaultValue={p.label}
                onBlur={(e) => update(idx, { label: e.target.value })}
                placeholder="6th Grade Lunch"
                className="flex-1 px-2 py-1 text-xs font-semibold rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <input
                type="time"
                defaultValue={p.startTime}
                onBlur={(e) => update(idx, { startTime: e.target.value })}
                className="px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
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
function FormatToggles({
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
        {btn(bold,          'Bold',          'B', { fontWeight: 800 },                                                     () => onChange({ bold: !bold }))}
        {btn(italic,        'Italic',        'I', { fontStyle: 'italic', fontWeight: 600 },                                () => onChange({ italic: !italic }))}
        {btn(underline,     'Underline',     'U', { textDecoration: 'underline', fontWeight: 600 },                        () => onChange({ underline: !underline }))}
        {btn(strikethrough, 'Strikethrough', 'S', { textDecoration: 'line-through', fontWeight: 600 },                     () => onChange({ strikethrough: !strikethrough }))}
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

function ColorField({ label, value, onChange, allowTransparent }: { label: string; value: string; onChange: (v: string) => void; allowTransparent?: boolean }) {
  const isTransparent = value === 'transparent' || !value;
  return (
    <div>
      <label className="block text-[10px] font-semibold text-slate-500 mb-1.5">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={isTransparent ? '#ffffff' : value}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-8 rounded border border-slate-200 cursor-pointer bg-white"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={allowTransparent ? 'transparent or #hex' : '#hex'}
          className="flex-1 px-2 py-1 text-xs font-mono rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        {allowTransparent && (
          <button
            type="button"
            onClick={() => onChange('transparent')}
            className="text-[10px] font-bold text-slate-500 hover:text-indigo-600 px-2 py-1 rounded border border-slate-200 hover:border-indigo-300"
          >
            Clear
          </button>
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
          <input
            type="text"
            defaultValue={value}
            onBlur={(e) => onChange(e.target.value)}
            placeholder="https://… or pick from library"
            className="w-full px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
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

function AssetLibraryModal({ kind, onPick, onClose }: { kind: 'image' | 'video'; onPick: (url: string) => void; onClose: () => void }) {
  const { data: assets, isLoading } = useAssets();
  const filtered = (assets || []).filter((a: any) => {
    const mt = (a.mimeType || '').toLowerCase();
    return kind === 'image' ? mt.startsWith('image/') : mt.startsWith('video/');
  });
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
        <div className="flex-1 overflow-y-auto p-3">
          {isLoading ? (
            <div className="text-center text-xs text-slate-400 py-12">Loading library…</div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-xs text-slate-400 py-12">
              No {kind === 'image' ? 'images' : 'videos'} in your library yet. Upload from <strong>Assets</strong> first.
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

// ─────────────────────────────────────────────────────────
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
      <div className="space-y-2">
        {periods.length === 0 && <p className="text-[11px] text-slate-400 italic px-1">No periods yet — add your first below.</p>}
        {periods.map((p, idx) => (
          <div key={idx} className="bg-white border border-slate-200 rounded-lg p-2 flex items-center gap-1.5 shadow-sm">
            <input
              type="text"
              defaultValue={p.label}
              onBlur={(e) => update(idx, { label: e.target.value })}
              placeholder="Period 1"
              className="flex-1 px-2 py-1 text-xs font-semibold rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <input
              type="time"
              defaultValue={p.start}
              onBlur={(e) => update(idx, { start: e.target.value })}
              className="px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <span className="text-[10px] text-slate-400">→</span>
            <input
              type="time"
              defaultValue={p.end || ''}
              onBlur={(e) => update(idx, { end: e.target.value || undefined })}
              className="px-2 py-1 text-xs rounded border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              aria-label="Remove period"
              className="w-7 h-7 rounded border border-slate-200 text-slate-400 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 flex items-center justify-center text-xs"
            >×</button>
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
