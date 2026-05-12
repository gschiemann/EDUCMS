"use client";

import { useRef, useEffect, useState, useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useBuilderStore } from './useBuilderStore';
import { useTemplate } from '@/hooks/use-api';
import { BuilderZone } from './BuilderZone';
import { snapMove, snapResize } from './snap-engine';
import type { ResizeHandle, SnapLine, Zone } from './types';

/**
 * 2026-05-04 — Build a `<style>` block that scopes the per-template
 * brand kit's CSS custom properties (`--brand-primary`, fonts, etc.)
 * to the canvas root. Widgets that reference `var(--brand-*)` then
 * read FROM THIS TEMPLATE'S brand kit, not the global tenant theme.
 *
 * Why scope rather than write to :root? Because the dashboard chrome
 * already paints the global tenant brand on :root via
 * BrandStyleInjector. Writing per-template vars to :root would bleed
 * into the chrome (sidebar, toolbar) — totally wrong. Scoping to
 * `[data-template-canvas]` means only widgets inside the canvas
 * pick up the per-template overrides.
 */
function buildCanvasBrandVarsCss(brandKit: any): string | null {
  if (!brandKit || typeof brandKit !== 'object') return null;
  const palette = (brandKit.palette || {}) as Record<string, string | undefined>;
  const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
  const FONT_RE = /^[a-zA-Z0-9 \-_,'"]{1,80}$/;
  const decls: string[] = [];
  const safeColor = (key: string, val?: string) => {
    if (val && HEX_RE.test(val)) decls.push(`${key}: ${val}`);
  };
  safeColor('--brand-primary', palette.primary);
  safeColor('--brand-primary-hover', palette.primaryHover);
  safeColor('--brand-primary-active', palette.primaryActive);
  safeColor('--brand-primary-soft', palette.primarySoft);
  safeColor('--brand-primary-ink', palette.primaryInk);
  safeColor('--brand-accent', palette.accent);
  safeColor('--brand-accent-hover', palette.accentHover);
  safeColor('--brand-accent-soft', palette.accentSoft);
  safeColor('--brand-accent-ink', palette.accentInk);
  safeColor('--brand-ink', palette.ink);
  safeColor('--brand-ink-muted', palette.inkMuted);
  safeColor('--brand-surface', palette.surface);
  safeColor('--brand-surface-alt', palette.surfaceAlt);
  safeColor('--brand-border', palette.border);
  if (typeof brandKit.fontHeading === 'string' && FONT_RE.test(brandKit.fontHeading)) {
    decls.push(`--brand-font-heading: "${brandKit.fontHeading}", ui-sans-serif, system-ui, sans-serif`);
  }
  if (typeof brandKit.fontBody === 'string' && FONT_RE.test(brandKit.fontBody)) {
    decls.push(`--brand-font-body: "${brandKit.fontBody}", ui-sans-serif, system-ui, sans-serif`);
  }
  if (decls.length === 0) return null;
  return `[data-template-canvas="true"] { ${decls.join('; ')} }`;
}

type BellPeriod = { label: string; start: string; end?: string };
type CalendarEvent = { title: string; date: string; color?: string };

const DEFAULT_BELL_PERIODS: BellPeriod[] = [
  { label: 'Period 1', start: '8:00', end: '8:50' },
  { label: 'Period 2', start: '8:55', end: '9:45' },
  { label: 'Period 3', start: '9:50', end: '10:40' },
  { label: 'Lunch', start: '10:45', end: '11:15' },
  { label: 'Period 4', start: '11:20', end: '12:10' },
  { label: 'Period 5', start: '12:15', end: '1:05' },
  { label: 'Period 6', start: '1:10', end: '2:00' },
];

const DEFAULT_MENU_LINES = [
  'Monday: Pizza, Garden Salad, Fruit Cup',
  'Tuesday: Chicken Tacos, Spanish Rice',
  'Wednesday: Pasta Bar, Garlic Bread',
  'Thursday: Grilled Chicken, Mashed Potatoes',
  'Friday: Burgers, Fries, Coleslaw',
];

const DEFAULT_EVENTS: CalendarEvent[] = [
  { title: 'Spring Assembly', date: 'Today, 10:00 AM', color: '#6366f1' },
  { title: 'PTA Meeting', date: 'Tomorrow, 6:30 PM', color: '#f59e0b' },
  { title: 'Science Fair', date: 'This Week', color: '#22c55e' },
  { title: 'Staff Development Day', date: 'Next Week', color: '#ec4899' },
  { title: 'Spring Break Begins', date: 'Soon', color: '#0ea5e9' },
];
const DEFAULT_STATS = [
  { value: '97%', label: 'ATTENDANCE' },
  { value: '4.2', label: 'AVG GPA' },
  { value: '84', label: 'CLUBS' },
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

function normalizeBellSchedule(value: unknown): BellPeriod[] {
  if (Array.isArray(value)) {
    return value.map((p, idx) => ({
      label: String((p as any)?.label || `Period ${idx + 1}`),
      start: String((p as any)?.start || ''),
      end: (p as any)?.end ? String((p as any).end) : undefined,
    }));
  }
  if (typeof value === 'string' && value.trim()) {
    return value.split('\n').filter(Boolean).map(parseBellLine);
  }
  return DEFAULT_BELL_PERIODS.map((p) => ({ ...p }));
}

function normalizeMenuLines(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return value.split('\n').filter(Boolean);
  return DEFAULT_MENU_LINES.slice();
}

function normalizeEvents(value: unknown): CalendarEvent[] {
  if (Array.isArray(value) && value.length) {
    return value.map((ev, idx) => ({
      title: String((ev as any)?.title || 'Event'),
      date: String((ev as any)?.date || ''),
      color: (ev as any)?.color || DEFAULT_EVENTS[idx % DEFAULT_EVENTS.length]?.color,
    }));
  }
  return DEFAULT_EVENTS.map((ev) => ({ ...ev }));
}

function normalizeArrayObjects(value: unknown, defaults: Array<Record<string, string>>) {
  if (Array.isArray(value) && value.length) {
    return value.map((item, idx) => ({ ...defaults[idx % defaults.length], ...(item as any) }));
  }
  return defaults.map((item) => ({ ...item }));
}

function normalizeStringArray(value: unknown, defaults: string[]) {
  if (Array.isArray(value) && value.length) return value.map((item) => String(item));
  return defaults.slice();
}

function mergeInlineConfigPatch(widgetType: string, current: Record<string, unknown>, patch: Record<string, any>) {
  const next: Record<string, any> = { ...current };

  for (const [key, value] of Object.entries(patch)) {
    const scheduleMatch = widgetType === 'BELL_SCHEDULE'
      ? key.match(/^schedule\.(\d+)\.(label|start|end)$/)
      : null;
    if (scheduleMatch) {
      const idx = Number(scheduleMatch[1]);
      const field = scheduleMatch[2] as keyof BellPeriod;
      const schedule = normalizeBellSchedule(next.schedule);
      schedule[idx] = { ...(schedule[idx] || { label: `Period ${idx + 1}`, start: '' }), [field]: String(value) };
      next.schedule = schedule;
      continue;
    }

    const eventMatch = widgetType === 'CALENDAR'
      ? key.match(/^events\.(\d+)\.(title|date)$/)
      : null;
    if (eventMatch) {
      const idx = Number(eventMatch[1]);
      const field = eventMatch[2] as keyof CalendarEvent;
      const events = normalizeEvents(next.events);
      events[idx] = { ...(events[idx] || { title: 'Event', date: '' }), [field]: String(value) };
      next.events = events;
      continue;
    }

    const menuMatch = widgetType === 'LUNCH_MENU'
      ? key.match(/^menu\.(\d+)\.(day|items)$/)
      : null;
    if (menuMatch) {
      const idx = Number(menuMatch[1]);
      const field = menuMatch[2];
      const lines = normalizeMenuLines(next.menu);
      const [day = '', ...rest] = (lines[idx] || '').split(':');
      const items = rest.join(':').trim();
      lines[idx] = field === 'day'
        ? `${String(value)}${items ? `: ${items}` : ''}`
        : `${day.trim() || 'Day'}: ${String(value)}`;
      next.menu = lines.join('\n');
      continue;
    }

    if (widgetType === 'TICKER' && key === 'text') {
      const text = String(value);
      next.text = text;
      next.messages = text.split(/\n|\u2022/).map((part) => part.trim()).filter(Boolean);
      continue;
    }

    const statMatch = widgetType === 'STATS' ? key.match(/^stats\.(\d+)\.(value|label)$/) : null;
    if (statMatch) {
      const idx = Number(statMatch[1]);
      const field = statMatch[2];
      const stats = normalizeArrayObjects(next.stats, DEFAULT_STATS);
      stats[idx] = { ...(stats[idx] || DEFAULT_STATS[idx % DEFAULT_STATS.length]), [field]: String(value) };
      next.stats = stats;
      continue;
    }

    const periodMatch = widgetType === 'SCHEDULE_GRID' ? key.match(/^periods\.(\d+)\.(num|name|time)$/) : null;
    if (periodMatch) {
      const idx = Number(periodMatch[1]);
      const field = periodMatch[2];
      const periods = normalizeArrayObjects(next.periods, DEFAULT_PERIODS);
      periods[idx] = { ...(periods[idx] || DEFAULT_PERIODS[idx % DEFAULT_PERIODS.length]), [field]: String(value) };
      next.periods = periods;
      continue;
    }

    const birthdayMatch = widgetType === 'BIRTHDAYS' ? key.match(/^birthdays\.(\d+)$/) : null;
    if (birthdayMatch) {
      const idx = Number(birthdayMatch[1]);
      const birthdays = normalizeStringArray(next.birthdays, DEFAULT_BIRTHDAYS);
      birthdays[idx] = String(value);
      next.birthdays = birthdays;
      continue;
    }

    const studentMatch = widgetType === 'HONOR_ROLL' ? key.match(/^students\.(\d+)\.(name|reason)$/) : null;
    if (studentMatch) {
      const idx = Number(studentMatch[1]);
      const field = studentMatch[2];
      const students = normalizeArrayObjects(next.students, DEFAULT_STUDENTS);
      students[idx] = { ...(students[idx] || DEFAULT_STUDENTS[idx % DEFAULT_STUDENTS.length]), [field]: String(value) };
      next.students = students;
      continue;
    }

    if (widgetType === 'ATTENDANCE' && (key === 'presentPct' || key === 'totalStudents')) {
      const parsed = key === 'presentPct'
        ? Number.parseFloat(String(value).replace('%', ''))
        : Number.parseInt(String(value).replace(/[^\d]/g, ''), 10);
      next[key] = Number.isFinite(parsed) ? parsed : next[key];
      continue;
    }

    next[key] = value;
  }

  return next;
}

export function BuilderCanvas() {
  // dnd-kit drop target. BuilderShell.handleDragEnd checks
  // `over.id === 'builder-canvas'` to know whether to add a zone, but
  // before this fix the canvas wasn't registered as a droppable at all
  // â€” so palette / variant drags resolved to `over === null` and the
  // dropped widget never landed on the canvas. Operator could drag a
  // widget tile across the canvas surface and nothing would place.
  // Critical bug for the headline template-builder feature.
  const { setNodeRef: setDroppableRef } = useDroppable({ id: 'builder-canvas' });
  // Atomic selectors â€” BuilderCanvas paints every frame of every drag,
  // so subscribing to the whole store was forcing re-renders on every
  // unrelated state tick (e.g. isDirty flag flipping). Per-key lets
  // Zustand skip the render entirely when nothing this component cares
  // about changed.
  const allZones = useBuilderStore((s) => s.zones);
  const activeSceneId = useBuilderStore((s) => s.activeSceneId);
  // Phase D2.5 — only render zones belonging to the active scene plus
  // "shared" zones (sceneId == null). The store still holds every zone
  // across every scene; this is purely the editor's viewport filter so
  // hit-tests, multi-select, marquee, etc. all match what's visible.
  // When activeSceneId is itself null (operator clicked the "Shared"
  // pseudo-scene at the bottom of the panel) we render ONLY shared
  // zones — that's how the operator audits "always-on" content.
  const zones = (() => {
    if (activeSceneId === null) {
      return allZones.filter((z) => !z.sceneId);
    }
    return allZones.filter((z) => !z.sceneId || z.sceneId === activeSceneId);
  })();
  const meta = useBuilderStore((s) => s.meta);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const zoom = useBuilderStore((s) => s.zoom);
  const gridSize = useBuilderStore((s) => s.gridSize);
  const showGrid = useBuilderStore((s) => s.showGrid);
  const snapEnabled = useBuilderStore((s) => s.snapEnabled);
  const showGuides = useBuilderStore((s) => s.showGuides);
  const previewMode = useBuilderStore((s) => s.previewMode);
  const select = useBuilderStore((s) => s.select);
  const updateZone = useBuilderStore((s) => s.updateZone);
  const updateZones = useBuilderStore((s) => s.updateZones);
  const beginTransaction = useBuilderStore((s) => s.beginTransaction);
  // 2026-05-04 — per-template brand kit. Read here so the canvas can
  // inject `--brand-*` CSS vars that override the global tenant theme
  // FOR THIS TEMPLATE ONLY. Widgets read these vars and re-paint
  // automatically when the operator adopts a brand kit.
  const templateId = useBuilderStore((s) => s.templateId);
  const { data: template } = useTemplate(templateId);
  const brandKit = (template as any)?.brandKit ?? null;
  const brandVarsCss = buildCanvasBrandVarsCss(brandKit);

  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<
    | { mode: 'move'; zoneId: string; startX: number; startY: number; origs: Record<string, Zone> }
    | { mode: 'resize'; zoneId: string; handle: ResizeHandle; startX: number; startY: number; orig: Zone }
    | null
  >(null);
  const [marqueeState, setMarqueeState] = useState<{ startX: number; startY: number; currX: number; currY: number } | null>(null);
  const [activeSnapLines, setActiveSnapLines] = useState<SnapLine[]>([]);
  const [hoverFromDrag, setHoverFromDrag] = useState(false);

  const aspectRatio = meta.screenWidth / meta.screenHeight;

  const onZonePointerDown = useCallback((e: React.PointerEvent, zoneId: string) => {
    e.preventDefault();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const alreadySelected = selectedIds.includes(zoneId);
    if (!alreadySelected && !additive) {
      select([zoneId]);
    } else if (additive) {
      select([zoneId], true);
    }
    beginTransaction();
    const selectionForDrag = alreadySelected ? selectedIds : additive ? Array.from(new Set([...selectedIds, zoneId])) : [zoneId];
    const origs: Record<string, Zone> = {};
    for (const id of selectionForDrag) {
      const z = zones.find(zz => zz.id === id);
      if (z && !z.locked) origs[id] = { ...z };
    }
    setDragState({ mode: 'move', zoneId, startX: e.clientX, startY: e.clientY, origs });
  }, [zones, selectedIds, select, beginTransaction]);

  const onResizePointerDown = useCallback((e: React.PointerEvent, zoneId: string, handle: ResizeHandle) => {
    e.preventDefault();
    e.stopPropagation();
    select([zoneId]);
    const orig = zones.find(z => z.id === zoneId);
    if (!orig) return;
    beginTransaction();
    setDragState({ mode: 'resize', zoneId, handle, startX: e.clientX, startY: e.clientY, orig: { ...orig } });
  }, [zones, select, beginTransaction]);

  const onZoneSelect = useCallback((e: React.MouseEvent, zoneId: string) => {
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    select([zoneId], additive);
  }, [select]);

  useEffect(() => {
    if (!dragState) return;
    const onMove = (e: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dx = (e.clientX - dragState.startX) / rect.width * 100;
      const dy = (e.clientY - dragState.startY) / rect.height * 100;

      if (dragState.mode === 'move') {
        const ids = Object.keys(dragState.origs);
        const primary = dragState.origs[dragState.zoneId];
        if (!primary) return;
        const proposed = {
          x: primary.x + dx,
          y: primary.y + dy,
          width: primary.width,
          height: primary.height,
        };
        const others = zones.filter(z => !ids.includes(z.id));
        const snapped = snapMove(proposed, others, {
          gridSize,
          snapEnabled,
          snapGrid: showGrid,
        });
        const actualDx = snapped.x - primary.x;
        const actualDy = snapped.y - primary.y;
        setActiveSnapLines(showGuides ? snapped.lines : []);
        updateZones(ids, (z) => {
          const orig = dragState.origs[z.id];
          return { x: orig.x + actualDx, y: orig.y + actualDy };
        });
      } else {
        const o = dragState.orig;
        const h = dragState.handle;
        let nx = o.x, ny = o.y, nw = o.width, nh = o.height;
        if (h.includes('e')) nw = Math.max(3, o.width + dx);
        if (h.includes('s')) nh = Math.max(3, o.height + dy);
        if (h.includes('w')) { const s = Math.min(dx, o.width - 3); nx = o.x + s; nw = o.width - s; }
        if (h.includes('n')) { const s = Math.min(dy, o.height - 3); ny = o.y + s; nh = o.height - s; }
        const others = zones.filter(z => z.id !== dragState.zoneId);
        const snapped = snapResize({ x: nx, y: ny, width: nw, height: nh }, others, h, {
          gridSize,
          snapEnabled,
          snapGrid: showGrid,
        });
        setActiveSnapLines(showGuides ? snapped.lines : []);
        updateZone(dragState.zoneId, snapped);
      }
    };
    const onUp = () => {
      setDragState(null);
      setActiveSnapLines([]);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragState, zones, gridSize, snapEnabled, showGrid, showGuides, updateZone, updateZones]);

  // Marquee selection
  const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    if (previewMode) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = (e.clientX - rect.left) / rect.width * 100;
    const sy = (e.clientY - rect.top) / rect.height * 100;
    if (!(e.shiftKey || e.metaKey || e.ctrlKey)) {
      select(null);
    }
    setMarqueeState({ startX: sx, startY: sy, currX: sx, currY: sy });
  }, [select, previewMode]);

  useEffect(() => {
    if (!marqueeState) return;
    const onMove = (e: PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width * 100));
      const cy = Math.max(0, Math.min(100, (e.clientY - rect.top) / rect.height * 100));
      setMarqueeState(m => m ? { ...m, currX: cx, currY: cy } : null);
    };
    const onUp = () => {
      if (!marqueeState) return;
      const x1 = Math.min(marqueeState.startX, marqueeState.currX);
      const y1 = Math.min(marqueeState.startY, marqueeState.currY);
      const x2 = Math.max(marqueeState.startX, marqueeState.currX);
      const y2 = Math.max(marqueeState.startY, marqueeState.currY);
      const width = x2 - x1, height = y2 - y1;
      if (width > 0.5 && height > 0.5) {
        const hit = zones.filter(z =>
          z.x < x2 && z.x + z.width > x1 && z.y < y2 && z.y + z.height > y1,
        ).map(z => z.id);
        select(hit);
      }
      setMarqueeState(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [marqueeState, zones, select]);

  const background = meta.bgImage
    ? { backgroundImage: meta.bgImage.trim().startsWith('url(') ? meta.bgImage : `url(${meta.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : meta.bgGradient
      ? { background: meta.bgGradient }
      : { background: meta.bgColor || '#ffffff' };

  const gridStep = gridSize;
  const gridBg = showGrid && !previewMode ? {
    backgroundImage: `
      linear-gradient(to right, rgba(100,116,139,0.08) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(100,116,139,0.08) 1px, transparent 1px)
    `,
    backgroundSize: `${gridStep}% ${gridStep}%`,
  } : {};

  return (
    <div className="flex-1 overflow-auto bg-slate-200 p-8 flex items-center justify-center min-h-0">
      <div
        className="shadow-2xl rounded-lg relative"
        style={{
          width: `min(${90 * zoom}vw, ${aspectRatio * 70 * zoom}vh)`,
          aspectRatio: `${aspectRatio}`,
          maxWidth: '100%',
        }}
      >
        {/* Per-template brand CSS vars. Widgets that use
            `var(--brand-primary)` etc. inside the canvas read FROM
            the per-template brand kit, not the global tenant theme.
            Scoped to `[data-template-canvas]` so dashboard chrome
            (sidebar, toolbar) keeps its tenant-global vars. Null
            brandKit → no <style> rendered → widgets fall back to
            the document-level :root vars from BrandStyleInjector. */}
        {brandVarsCss && <style>{brandVarsCss}</style>}
        <div
          // Compose refs: BuilderCanvas needs the DOM node for its own
          // pointer-drag math (canvasRef), and dnd-kit needs it as the
          // drop-target node (setDroppableRef). Both run on every drop.
          ref={(node) => {
            canvasRef.current = node;
            setDroppableRef(node);
          }}
          className="absolute inset-0 rounded-lg overflow-hidden"
          style={{ ...background }}
          data-template-canvas="true"
          onPointerDown={onCanvasPointerDown}
          onDragEnter={() => setHoverFromDrag(true)}
          onDragLeave={() => setHoverFromDrag(false)}
          onDrop={() => setHoverFromDrag(false)}
          role="application"
          aria-label="Template canvas"
        >
          {showGrid && !previewMode && (
            <div className="absolute inset-0 pointer-events-none" style={gridBg} aria-hidden />
          )}

          {/* Empty-canvas onboarding (C7 from Canva parity sweep). When
              the operator opens a fresh custom template, an arrow points
              left at the Widgets tab + a copy line nudges them to drag.
              Auto-hides as soon as the first zone lands. Hidden in
              previewMode so demo screenshots stay clean. Also hidden
              during drag-over to unblock drop target.
              2026-04-28 fix â€” operator: 'no fucking background get
              apploed to the canvas. it stays white that the entire
              issue.' Cause: this card was bg-white/85 and covered
              ~70% of the canvas surface, so the gradient WAS being
              applied to the canvas div underneath but the white card
              was hiding it. Two changes:
                a) Hide the card when the operator has set a background
                   â€” they've clearly moved past 'drag a widget here'
                   and we shouldn't fight them with a white tooltip.
                b) Drop the card to a small chip pinned to the top
                   so the canvas bg is fully visible. */}
          {zones.length === 0 && !previewMode && !hoverFromDrag && !meta.bgColor && !meta.bgGradient && !meta.bgImage && (
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none flex items-center justify-center"
            >
              <div className="flex items-center gap-4 px-8 py-6 rounded-2xl bg-white/85 backdrop-blur-sm shadow-lg border border-indigo-200/60 max-w-md">
                <svg viewBox="0 0 64 64" className="w-12 h-12 shrink-0 text-indigo-500" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M48 32 H10" />
                  <path d="M22 18 L8 32 L22 46" />
                </svg>
                <div>
                  <p className="text-sm font-bold text-slate-800">Drag a widget onto the canvas to start</p>
                  <p className="text-xs text-slate-500 mt-1">Pick from the <strong className="text-indigo-600">Widgets</strong> tab on the left â€” Clock, Weather, Text, Image, Web page, and more.</p>
                </div>
              </div>
            </div>
          )}
          {/* Compact follow-up nudge â€” once the operator has painted
              a bg they're decorating, but if zones is still empty
              they may want a hint to add widgets. Small corner chip
              that doesn't obscure the canvas bg. */}
          {zones.length === 0 && !previewMode && !hoverFromDrag && (meta.bgColor || meta.bgGradient || meta.bgImage) && (
            <div
              aria-hidden
              className="absolute top-3 left-3 pointer-events-none px-3 py-1.5 rounded-full bg-white/80 backdrop-blur-sm shadow-md border border-indigo-200/60 text-[10px] font-bold text-indigo-700 tracking-wider uppercase"
            >
              Now add a widget â†’
            </div>
          )}

          {zones.map(zone => (
            <BuilderZone
              key={zone.id}
              zone={zone}
              selected={selectedIds.includes(zone.id)}
              previewMode={previewMode}
              onPointerDown={onZonePointerDown}
              onResizePointerDown={onResizePointerDown}
              onSelect={onZoneSelect}
              // Inline-edit hook: when a widget's EditableText commits a
              // change, patch the zone's defaultConfig. `true` marks the
              // update dirty/undoable. Without this, double-clicking a
              // text node did nothing â€” the whole EditableText chain
              // short-circuits to read-only when onConfigChange is
              // undefined.
              onConfigChange={(zoneId, patch) => {
                const z = zones.find(z => z.id === zoneId);
                if (!z) return;
                updateZone(zoneId, {
                  defaultConfig: mergeInlineConfigPatch(z.widgetType, (z.defaultConfig || {}) as Record<string, unknown>, patch),
                }, true);
              }}
            />
          ))}

          {showGuides && activeSnapLines.map((line, i) => {
            // Human-readable label for the snap line â€” operators
            // shouldn't have to guess what the pink line means. Center
            // canvas snap â†’ "Center". Edge canvas â†’ "Edge". Element
            // snaps â†’ the position percent rounded to 1 decimal.
            // (Canva shows pixel offsets between elements; we'd need
            // both end positions to compute that, so percent-of-canvas
            // is a clean v1 â€” matches the way every editor field is
            // already in percent units.)
            const isCenterCanvas = line.kind === 'canvas' && Math.abs(line.position - 50) < 0.05;
            const isEdgeCanvas   = line.kind === 'canvas' && (line.position < 0.05 || line.position > 99.95);
            const isCenterElem   = line.kind === 'center';
            const label = isCenterCanvas
              ? 'Center'
              : isEdgeCanvas
                ? 'Edge'
                : isCenterElem
                  ? 'Center match'
                  : `${line.position.toFixed(1)}%`;
            const lineColor = line.kind === 'canvas' ? '#a855f7' : '#ec4899';
            return (
              <div
                key={i}
                aria-hidden
                className="absolute pointer-events-none"
                style={
                  line.orientation === 'v'
                    ? { left: `${line.position}%`, top: 0, bottom: 0, width: 1, background: lineColor, boxShadow: '0 0 4px rgba(168,85,247,0.6)' }
                    : { top: `${line.position}%`, left: 0, right: 0, height: 1, background: lineColor, boxShadow: '0 0 4px rgba(168,85,247,0.6)' }
                }
              >
                <span
                  style={{
                    position: 'absolute',
                    background: lineColor,
                    color: '#fff',
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 4,
                    whiteSpace: 'nowrap',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    ...(line.orientation === 'v'
                      ? { top: '50%', left: 4, transform: 'translateY(-50%)' }
                      : { left: '50%', top: 4, transform: 'translateX(-50%)' }
                    ),
                  }}
                >
                  {label}
                </span>
              </div>
            );
          })}

          {marqueeState && (
            <div
              aria-hidden
              className="absolute border-2 border-indigo-500 bg-indigo-500/10 pointer-events-none"
              style={{
                left: `${Math.min(marqueeState.startX, marqueeState.currX)}%`,
                top: `${Math.min(marqueeState.startY, marqueeState.currY)}%`,
                width: `${Math.abs(marqueeState.currX - marqueeState.startX)}%`,
                height: `${Math.abs(marqueeState.currY - marqueeState.startY)}%`,
              }}
            />
          )}

          {/* Zone-context controls moved to the unified BuilderBottomBar
              in BuilderShell.tsx (operator request 2026-04-27 â€” one bar
              at the bottom, no floating bar over the canvas). */}
        </div>
      </div>
    </div>
  );
}
