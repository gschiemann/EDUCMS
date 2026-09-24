"use client";

import { useRef, useEffect, useState, useCallback } from 'react';
import { uploadAssetDirect } from '@/lib/direct-upload';
import { useDroppable } from '@dnd-kit/core';
import { useBuilderStore } from './useBuilderStore';
import { useTemplate } from '@/hooks/use-api';
import { TEMPLATE_DEFAULT_BG } from '@cms/api-types';
import { appAlert } from '@/components/ui/app-dialog';
import { BuilderZone } from './BuilderZone';
import { SelectionChrome } from './SelectionChrome';
import { canvasFrameStyle } from './canvas-frame-style';
import { healPatternCss } from '@/lib/pattern-css';
import { snapMove, snapResize } from './snap-engine';
import type { ResizeHandle, SnapLine, Zone } from './types';

interface Rect { x: number; y: number; width: number; height: number }

/** A3 — bounding box of a set of zones, in template-percentage space. */
export function boundingBoxOf(zones: Zone[]): Rect {
  const left = Math.min(...zones.map((z) => z.x));
  const top = Math.min(...zones.map((z) => z.y));
  const right = Math.max(...zones.map((z) => z.x + z.width));
  const bottom = Math.max(...zones.map((z) => z.y + z.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * A3 — pure scaling math for group resize. Given a zone's rect AT DRAG
 * START (`orig`), the group's bounding box AT DRAG START (`origBox`), and
 * the group's NEW bounding box after the handle moved (`newBox`), returns
 * the zone's new x/y/w/h scaled proportionally relative to origBox's
 * origin. Extracted as a pure, exported function so the group-resize
 * gesture's core math is unit-testable without mounting the full
 * dnd-kit + React-Query BuilderCanvas tree.
 */
export function scaleZoneInBox(orig: Rect, origBox: Rect, newBox: Rect): Rect {
  const scaleX = origBox.width > 0 ? newBox.width / origBox.width : 1;
  const scaleY = origBox.height > 0 ? newBox.height / origBox.height : 1;
  return {
    x: newBox.x + (orig.x - origBox.x) * scaleX,
    y: newBox.y + (orig.y - origBox.y) * scaleY,
    width: orig.width * scaleX,
    height: orig.height * scaleY,
  };
}

/**
 * BONUS (Wave A) — canvas-level file drop. Uploads each dropped image
 * through the SAME direct-to-storage client BuilderZone's per-zone drop
 * uses (src/lib/direct-upload.ts), then places one IMAGE zone per file centered on
 * the drop point (staggered +3%/+3% per extra file so a multi-drop
 * doesn't stack invisibly). Exported for the file-drop regression spec.
 * Returns the new zone ids (empty on upload failure — the operator gets
 * the same "couldn't upload" dialog as the zone-drop path).
 */
export async function placeDroppedImageFiles(
  files: File[],
  dropAt?: { x: number; y: number },
): Promise<string[]> {
  const newIds: string[] = [];
  for (let i = 0; i < files.length; i++) {
    try {
      // 2026-09-23 — direct to storage; the created asset's `fileUrl` (the old
      // multipart response had no `url`, so zones got an undefined source).
      const { fileUrl: url } = await uploadAssetDirect(files[i]);
      const st = useBuilderStore.getState();
      const at = dropAt
        ? { x: Math.min(100, dropAt.x + i * 3), y: Math.min(100, dropAt.y + i * 3) }
        : undefined;
      const id = st.addZone('IMAGE', at);
      st.updateZone(id, { defaultConfig: { assetUrl: url } });
      newIds.push(id);
    } catch (err) {
      console.error('Canvas drop upload failed:', err);
      await appAlert({
        title: "Couldn't upload that image",
        message: 'The upload failed. Check your connection or try a smaller file (under 50 MB) and try again.',
        tone: 'danger',
      });
      break;
    }
  }
  return newIds;
}

/**
 * Fallback room to leave for the floating bottom bar, used only until it
 * has been measured (and if it is ever missing). The real value comes
 * from the bar itself — see useBottomBarClearance — because a constant
 * here silently goes stale the first time someone adds a control to the
 * bar, and the failure mode is the toolbar disappearing under a tall
 * canvas, which is exactly the bug this exists to fix.
 */
export const BOTTOM_BAR_CLEARANCE = 84;

/**
 * Measure the floating bottom bar and report how much vertical room the
 * canvas must leave free: the bar's own height plus twice the gap it
 * floats above the bottom edge (once for the gap itself, once so the
 * canvas is not flush against it).
 */
function useBottomBarClearance(previewMode: boolean): number {
  const [clearance, setClearance] = useState(BOTTOM_BAR_CLEARANCE);
  useEffect(() => {
    if (previewMode) return;
    const el = document.querySelector('[data-builder-bottom-bar]') as HTMLElement | null;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (!r.height) return;
      const parent = el.offsetParent as HTMLElement | null;
      const gap = parent ? parent.getBoundingClientRect().bottom - r.bottom : 12;
      setClearance(Math.ceil(r.height + Math.max(0, gap) * 2));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [previewMode]);
  return previewMode ? 0 : clearance;
}

/**
 * A7 — human-readable label for a snap guide line. Canvas anchors get
 * names (Center / Edge / Thirds), element matches get semantics
 * (Center match / Equal spacing / Grid), and plain element-edge snaps
 * get REAL PIXELS — the stored percent-of-canvas converted through the
 * template's own screenWidth/screenHeight (what Canva shows instead of
 * a meaningless raw percentage). Exported for the A7 regression spec.
 */
export function guideLabelFor(line: SnapLine, screenWidth: number, screenHeight: number): string {
  const isCenterCanvas = line.kind === 'canvas' && Math.abs(line.position - 50) < 0.05;
  const isEdgeCanvas = line.kind === 'canvas' && (line.position < 0.05 || line.position > 99.95);
  if (isCenterCanvas) return 'Center';
  if (isEdgeCanvas) return 'Edge';
  if (line.kind === 'canvas') return 'Thirds';
  if (line.kind === 'center') return 'Center match';
  if (line.kind === 'equal-gap') return 'Equal spacing';
  if (line.kind === 'grid') return 'Grid';
  const dimPx = line.orientation === 'v' ? screenWidth : screenHeight;
  return `${Math.round((line.position / 100) * (dimPx || 0))}px`;
}

/**
 * A5 — resize modifiers. Returns the constrained rect when a modifier
 * constraint applies, or null when none does (caller falls through to
 * the plain per-edge resize + snap path, byte-for-byte the pre-A5
 * behavior).
 *
 * Rules (muscle memory shared with Canva/Figma/PowerPoint):
 *  - CORNER handles on IMAGE/LOGO/VIDEO zones keep the zone's aspect
 *    ratio by DEFAULT; holding shift releases the lock.
 *  - Corner handles on every other widget type: shift = lock aspect.
 *  - Alt mirrors the delta around the zone center (both opposite edges
 *    move symmetrically; the center stays put) — any handle, any type.
 *  - While a constraint is active, edge snapping is skipped (the
 *    constraint owns the geometry); the caller clears the guide lines.
 */
const ASPECT_DEFAULT_TYPES = new Set(['IMAGE', 'LOGO', 'VIDEO']);

export function resizeWithModifiers(
  orig: Rect,
  widgetType: string,
  handle: ResizeHandle,
  dx: number,
  dy: number,
  mods: { shiftKey: boolean; altKey: boolean },
): Rect | null {
  const isCorner = handle.length === 2;
  const aspectByDefault = isCorner && ASPECT_DEFAULT_TYPES.has(widgetType);
  const aspectLock = isCorner && (aspectByDefault ? !mods.shiftKey : mods.shiftKey);
  const fromCenter = mods.altKey;
  if (!aspectLock && !fromCenter) return null;

  // Alt doubles the effective delta — the opposite edge mirrors it.
  const f = fromCenter ? 2 : 1;
  let rawW = orig.width;
  let rawH = orig.height;
  if (handle.includes('e')) rawW = orig.width + dx * f;
  if (handle.includes('w')) rawW = orig.width - dx * f;
  if (handle.includes('s')) rawH = orig.height + dy * f;
  if (handle.includes('n')) rawH = orig.height - dy * f;

  let nw = Math.max(3, rawW);
  let nh = Math.max(3, rawH);
  if (aspectLock) {
    // Dominant pointer axis drives the scale; the other follows the
    // original ratio. Floored so neither dimension collapses below the
    // 3% minimum while keeping the ratio intact.
    const scaleW = rawW / orig.width;
    const scaleH = rawH / orig.height;
    let scale = Math.abs(scaleW - 1) >= Math.abs(scaleH - 1) ? scaleW : scaleH;
    scale = Math.max(scale, 3 / orig.width, 3 / orig.height);
    nw = orig.width * scale;
    nh = orig.height * scale;
  }

  let nx: number;
  let ny: number;
  if (fromCenter) {
    nx = orig.x + orig.width / 2 - nw / 2;
    ny = orig.y + orig.height / 2 - nh / 2;
  } else {
    nx = handle.includes('w') ? orig.x + orig.width - nw : orig.x;
    ny = handle.includes('n') ? orig.y + orig.height - nh : orig.y;
  }
  return { x: nx, y: ny, width: nw, height: nh };
}

/**
 * A4 — alt/option-drag duplicate. Duplicates every zone in `sourceIds`
 * (via the store's existing duplicateZone), resets each copy back to its
 * source's exact x/y (duplicateZone offsets +2/+2 for the Cmd-D case,
 * but an alt-drag copy must start 1:1 under the cursor so the drag
 * doesn't visibly jump), and selects the copies. The whole thing runs
 * inside ONE beginTransaction so the gesture is a single undo step —
 * the caller (onZonePointerDown) starts the move drag on the copies and
 * pointerup's endTransaction() closes it. Exported so the gesture's
 * store mutation is unit-testable without mounting the dnd-kit tree.
 * Returns the new copies' ids in the same order as sourceIds (skipping
 * any id that couldn't be duplicated).
 */
export function altDragDuplicate(sourceIds: string[]): string[] {
  const store = useBuilderStore.getState();
  const sources = sourceIds
    .map((id) => store.zones.find((z) => z.id === id))
    .filter((z): z is Zone => !!z && !z.locked);
  if (sources.length === 0) return [];
  store.beginTransaction();
  const newIds: string[] = [];
  const origPos: Record<string, { x: number; y: number }> = {};
  for (const src of sources) {
    const nid = useBuilderStore.getState().duplicateZone(src.id);
    if (nid) {
      newIds.push(nid);
      origPos[nid] = { x: src.x, y: src.y };
    }
  }
  useBuilderStore.getState().updateZones(newIds, (z) => origPos[z.id] ?? {});
  useBuilderStore.getState().select(newIds);
  return newIds;
}

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
  /**
   * "This template is still blank" — 2026-09-11.
   *
   * The builder's ONLY onboarding copy was gated on `zones.length === 0`, which
   * NEVER fired for the user it was written for: creating a template seeds one
   * full-screen `EMPTY` zone (templates/page.tsx), so a brand-new template has
   * `zones.length === 1`. A first-time operator got a white canvas, one
   * unexplained rectangle, and no guidance whatsoever — that is a real demo the
   * operator lost.
   *
   * Blank means "nothing has been placed yet": no zones at all, or exactly the
   * untouched placeholder the create path seeds.
   */
  const isBlankTemplate =
    zones.length === 0 ||
    (zones.length === 1 && (zones[0] as any)?.widgetType === 'EMPTY');
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
  // A2 — close the drag's transaction on pointerup so a subsequent,
  // unrelated commit=true call (e.g. typing in a Properties field right
  // after a drag) doesn't get silently coalesced into the drag's already-
  // closed history entry.
  const endTransaction = useBuilderStore((s) => s.endTransaction);
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
    // A3 — group resize. `box` is the selection's bounding rect at drag
    // start; `origs` holds every selected zone's own rect at drag start
    // so each one can be scaled proportionally relative to `box`'s
    // origin as the handle moves.
    | { mode: 'group-resize'; handle: ResizeHandle; startX: number; startY: number; box: Rect; origs: Record<string, Zone> }
    | null
  >(null);
  const [marqueeState, setMarqueeState] = useState<{ startX: number; startY: number; currX: number; currY: number } | null>(null);
  const [activeSnapLines, setActiveSnapLines] = useState<SnapLine[]>([]);
  const [hoverFromDrag, setHoverFromDrag] = useState(false);

  // Belt + suspenders for the Width / Height NumField crash:
  // when the operator clears Height and starts typing a new value,
  // the buffered string may briefly be empty (handled in NumField)
  // OR a small intermediate digit (e.g. "1" before "1920"). Either
  // path, `screenHeight: 0` would yield aspectRatio = Infinity and
  // some browsers crash the tab when CSS aspect-ratio churns
  // through Infinity / NaN. Guard here so the canvas always lays
  // out something sane while the operator is mid-edit.
  const bottomBarClearance = useBottomBarClearance(previewMode);

  const aspectRatio = meta.screenHeight > 0 && Number.isFinite(meta.screenWidth) && Number.isFinite(meta.screenHeight)
    ? meta.screenWidth / meta.screenHeight
    : 16 / 9;

  const onZonePointerDown = useCallback((e: React.PointerEvent, zoneId: string) => {
    e.preventDefault();
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const alreadySelected = selectedIds.includes(zoneId);

    // A4 — alt/option-drag peels off a COPY and drags it, leaving the
    // original(s) in place — the fastest repetition gesture in every
    // design tool (menu rows, sponsor logos, stat tiles). If the pressed
    // zone is part of the current multi-selection, the whole selection
    // duplicates and drags together; otherwise just the pressed zone.
    // altDragDuplicate opens the transaction (single undo step for
    // duplicate + drag combined); pointerup's endTransaction closes it.
    if (e.altKey && !additive) {
      const sourceIds = alreadySelected && selectedIds.length > 0 ? selectedIds : [zoneId];
      const newIds = altDragDuplicate(sourceIds);
      if (newIds.length > 0) {
        const stateZones = useBuilderStore.getState().zones;
        const origs: Record<string, Zone> = {};
        for (const id of newIds) {
          const z = stateZones.find((zz) => zz.id === id);
          if (z) origs[id] = { ...z };
        }
        // The drag's primary zone is the COPY of the zone the operator
        // actually pressed; fall back to the first copy.
        const pressedIdx = sourceIds.indexOf(zoneId);
        const primaryId = (pressedIdx >= 0 && newIds[pressedIdx]) || newIds[0];
        setDragState({ mode: 'move', zoneId: primaryId, startX: e.clientX, startY: e.clientY, origs });
        return;
      }
      // Nothing duplicable (all locked) — fall through to normal move.
    }

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
    // A3 — single-zone handles come from SelectionChrome, which BuilderCanvas
    // only mounts for a single selection, so this path stays single-zone
    // resize exactly as before. Previously this ALSO collapsed a multi-selection down
    // to one zone the instant a handle was touched; now the group case
    // is handled entirely by onGroupResizePointerDown below, so this
    // callback no longer needs to (and doesn't) reset selection when
    // it's already a single-zone selection.
    if (!selectedIds.includes(zoneId) || selectedIds.length !== 1) select([zoneId]);
    const orig = zones.find(z => z.id === zoneId);
    if (!orig) return;
    beginTransaction();
    setDragState({ mode: 'resize', zoneId, handle, startX: e.clientX, startY: e.clientY, orig: { ...orig } });
  }, [zones, selectedIds, select, beginTransaction]);

  // A3 — group resize. Fired from the ONE shared bounding-box handle
  // set BuilderCanvas renders when selectedIds.length > 1 (see the
  // groupBox render block below). Captures every selected zone's rect
  // at drag start plus the box itself so pointermove can scale each
  // zone proportionally relative to the box's anchor corner/edge.
  const onGroupResizePointerDown = useCallback((e: React.PointerEvent, handle: ResizeHandle) => {
    e.preventDefault();
    e.stopPropagation();
    const selected = zones.filter((z) => selectedIds.includes(z.id) && !z.locked);
    if (selected.length < 2) return;
    const box = boundingBoxOf(selected);
    const origs: Record<string, Zone> = {};
    for (const z of selected) origs[z.id] = { ...z };
    beginTransaction();
    setDragState({ mode: 'group-resize', handle, startX: e.clientX, startY: e.clientY, box, origs });
  }, [zones, selectedIds, beginTransaction]);

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
      } else if (dragState.mode === 'resize') {
        const o = dragState.orig;
        const h = dragState.handle;
        // A5 — modifier-constrained resize (aspect-lock / from-center).
        // When a constraint is active it owns the geometry: no edge
        // snapping, no guide lines (matching how Canva relaxes snap
        // under modifier keys). Returns null when no modifier applies.
        const constrained = resizeWithModifiers(
          { x: o.x, y: o.y, width: o.width, height: o.height },
          o.widgetType,
          h,
          dx,
          dy,
          { shiftKey: e.shiftKey, altKey: e.altKey },
        );
        if (constrained) {
          setActiveSnapLines([]);
          updateZone(dragState.zoneId, constrained);
          return;
        }
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
      } else {
        // A3 — group resize. Compute the new bounding-box rect using
        // the SAME per-handle edge math as single-zone resize (dragged
        // edge moves, opposite edge stays anchored), snap that box's
        // moving edge against sibling zones just like single resize
        // does, then scale every selected zone's rect proportionally
        // relative to the ORIGINAL box's origin — the classic
        // "one corner-handle scales the whole group" gesture.
        const b = dragState.box;
        const h = dragState.handle;
        let nx = b.x, ny = b.y, nw = b.width, nh = b.height;
        if (h.includes('e')) nw = Math.max(3, b.width + dx);
        if (h.includes('s')) nh = Math.max(3, b.height + dy);
        if (h.includes('w')) { const s = Math.min(dx, b.width - 3); nx = b.x + s; nw = b.width - s; }
        if (h.includes('n')) { const s = Math.min(dy, b.height - 3); ny = b.y + s; nh = b.height - s; }
        const ids = Object.keys(dragState.origs);
        const others = zones.filter(z => !ids.includes(z.id));
        const snapped = snapResize({ x: nx, y: ny, width: nw, height: nh }, others, h, {
          gridSize,
          snapEnabled,
          snapGrid: showGrid,
        });
        setActiveSnapLines(showGuides ? snapped.lines : []);
        const newBox: Rect = { x: snapped.x, y: snapped.y, width: snapped.width, height: snapped.height };
        updateZones(ids, (z) => {
          const orig = dragState.origs[z.id];
          return scaleZoneInBox(orig, b, newBox);
        });
      }
    };
    const onUp = () => {
      setDragState(null);
      setActiveSnapLines([]);
      endTransaction();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragState, zones, gridSize, snapEnabled, showGrid, showGuides, updateZone, updateZones, endTransaction]);

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

  // BONUS (Wave A) — while the builder is mounted, a stray file drop
  // must NEVER navigate the tab to the file (which unmounts the whole
  // builder mid-edit — the browser's default for an unhandled drop).
  // Window-level safety net: preventDefault dragover/drop for file
  // drags everywhere EXCEPT native file inputs (whose built-in
  // drop-to-pick behavior we keep). Zones that accept drops already
  // stopPropagation/preventDefault their own handling before this
  // bubble-phase listener runs.
  useEffect(() => {
    const isFileDrag = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onWindowDragOver = (e: DragEvent) => {
      if (isFileDrag(e)) e.preventDefault();
    };
    const onWindowDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('input[type="file"]')) return;
      e.preventDefault();
    };
    window.addEventListener('dragover', onWindowDragOver);
    window.addEventListener('drop', onWindowDrop);
    return () => {
      window.removeEventListener('dragover', onWindowDragOver);
      window.removeEventListener('drop', onWindowDrop);
    };
  }, []);

  // BONUS (Wave A) — dropping image file(s) on the canvas (missing any
  // image zone) uploads them and places one IMAGE zone per file at the
  // cursor, instead of doing nothing (or worse — navigating away).
  const [droppingFiles, setDroppingFiles] = useState(false);
  const onCanvasDrop = useCallback((e: React.DragEvent) => {
    setHoverFromDrag(false);
    if (previewMode) return;
    const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = canvasRef.current?.getBoundingClientRect();
    const dropAt = rect && rect.width > 0 && rect.height > 0
      ? { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 }
      : undefined;
    setDroppingFiles(true);
    void placeDroppedImageFiles(files, dropAt).finally(() => setDroppingFiles(false));
  }, [previewMode]);

  const background = meta.bgImage
    ? { backgroundImage: meta.bgImage.trim().startsWith('url(') ? meta.bgImage : `url(${meta.bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : meta.bgGradient
      ? { background: healPatternCss(meta.bgGradient) as string }
      // The fallback is the LAST resort, not the design default: since
      // 2026-09-15 the API writes an explicit colour on any row that would
      // state no background, so a saved template answers this itself. Kept
      // (and sourced from the shared constant) for a row written before
      // that, and because an unsaved draft has no row at all. The player
      // deliberately falls back to BLACK — see `template-background.ts`
      // for why both are right and why the row must not leave it open.
      : { background: meta.bgColor || TEMPLATE_DEFAULT_BG };

  const gridStep = gridSize;
  const gridBg = showGrid && !previewMode ? {
    backgroundImage: `
      linear-gradient(to right, rgba(100,116,139,0.08) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(100,116,139,0.08) 1px, transparent 1px)
    `,
    backgroundSize: `${gridStep}% ${gridStep}%`,
  } : {};

  return (
    // 2026-05-12 — reduced outer padding p-8 → p-4 so the canvas
    // fills more of the available area. Combined with the parent-
    // relative canvas-size fix below, builder ≈ preview at default
    // zoom for most viewports.
    // The bottom bar is a floating pill (`absolute bottom-3`) layered OVER
    // this area, and the canvas box below is `maxHeight: 100%` of it. A
    // 16:9 design is shorter than the area, so it never reaches the bar
    // and the overlap was invisible for years. A TALL design — 960x1080,
    // or any portrait — fills the height and runs underneath it, hiding
    // the toolbar the operator needs. Reserve the bar's footprint here so
    // the canvas is laid out in the space that is actually free.
    // Preview mode hides the bar, so it gets the height back.
    <div
      className="flex-1 overflow-auto bg-slate-200 p-4 flex items-center justify-center min-h-0"
      style={{ paddingBottom: bottomBarClearance || undefined }}>
      <div
        className="shadow-2xl rounded-lg relative"
        style={{
          // 2026-05-12 — operator: "the template builder should already
          // be a representation of the final product... when i hit TV
          // preview the canvas is massive and nothing looks right." The
          // old `min(90vw, ${AR}*70vh)` math sized the canvas against
          // the VIEWPORT, ignoring the ~300px panel sidebar + 56px top
          // toolbar that eat horizontal/vertical space. Result: builder
          // canvas was ~30% smaller than the preview stage on the same
          // window, so hitting Preview felt like a sudden upscale.
          //
          // New math sizes against the PARENT (the .flex-1 canvas-area
          // wrapper) so the canvas fills whatever room the editor
          // chrome leaves behind. Same WYSIWYG promise the preview
          // modal uses, just with sidebar-aware bounds. `zoom` becomes
          // a deviation FROM that fit baseline (0.5 = half, 2 = double).
          //
          // 2026-05-14 — Operator hit this with a 320×1080 (aspect
          // 0.296) duplicate via Custom: setting `width: 100%` forced
          // the box to parent width, then aspect-ratio computed a
          // height that overflowed the parent, and the editor showed
          // a landscape-shaped canvas instead of a tall narrow strip.
          // Fix: when the design is portrait (aspect < 1), drive
          // sizing off HEIGHT — `height: 100%` + aspect-ratio yields
          // the right narrow strip. Landscape designs keep
          // width-driven sizing as before.
          // Sizing lives in canvas-frame-style.ts (unit-tested): fit clamps at
          // zoom ≤ 1, real overflow + scroll above it — "Zoom in" used to be a no-op.
          ...canvasFrameStyle(aspectRatio, zoom),
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
          onDrop={onCanvasDrop}
          role="application"
          aria-label="Template canvas"
        >
          {showGrid && !previewMode && (
            <div className="absolute inset-0 pointer-events-none" style={gridBg} aria-hidden />
          )}

          {/* BONUS (Wave A) — feedback chip while a canvas-dropped file
              uploads, so the operator isn't left wondering whether the
              drop registered. */}
          {droppingFiles && !previewMode && (
            <div
              aria-hidden
              className="absolute top-3 right-3 z-50 px-3 py-1.5 rounded-full bg-indigo-600 text-white text-[10px] font-bold tracking-wider uppercase shadow-lg animate-pulse pointer-events-none"
            >
              Uploading image…
            </div>
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
          {isBlankTemplate && !previewMode && !hoverFromDrag && !meta.bgColor && !meta.bgGradient && !meta.bgImage && (
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
                  <p className="text-sm font-bold text-slate-800">Pick a widget to start</p>
                  <p className="text-xs text-slate-500 mt-1">Click one in the <strong className="text-indigo-600">Widgets</strong> tab on the left — or drag it onto the canvas â€” Clock, Weather, Text, Image, Web page, and more.</p>
                </div>
              </div>
            </div>
          )}
          {/* Compact follow-up nudge â€” once the operator has painted
              a bg they're decorating, but if zones is still empty
              they may want a hint to add widgets. Small corner chip
              that doesn't obscure the canvas bg. */}
          {isBlankTemplate && !previewMode && !hoverFromDrag && (meta.bgColor || meta.bgGradient || meta.bgImage) && (
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

          {/* Single selection: ring + resize handles as a top-layer overlay, so
              the selected zone keeps its own stacking order (see SelectionChrome —
              selecting a full-screen background must not hide the widgets on it). */}
          {!previewMode && selectedIds.length === 1 && (() => {
            const z = zones.find((zz) => zz.id === selectedIds[0]);
            return z ? <SelectionChrome zone={z} onResizePointerDown={onResizePointerDown} /> : null;
          })()}

          {/* A3 — group resize. One shared bounding box with corner
              handles when 2+ zones are selected, matching Canva's
              multi-select affordance. Dragging any handle scales every
              selected zone's x/y/w/h proportionally (see
              onGroupResizePointerDown + the group-resize pointermove
              branch above). Uses the LIVE (post-drag) zone rects each
              render so the box tracks the group during a drag/move too. */}
          {!previewMode && selectedIds.length > 1 && (() => {
            const selectedZones = zones.filter((z) => selectedIds.includes(z.id));
            if (selectedZones.length < 2) return null;
            const box = boundingBoxOf(selectedZones);
            const GROUP_HANDLES: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
            const HANDLE_POS: Record<ResizeHandle, React.CSSProperties> = {
              nw: { top: -6, left: -6, cursor: 'nwse-resize' },
              n:  { top: -6, left: '50%', marginLeft: -6, cursor: 'ns-resize' },
              ne: { top: -6, right: -6, cursor: 'nesw-resize' },
              e:  { top: '50%', right: -6, marginTop: -6, cursor: 'ew-resize' },
              se: { bottom: -6, right: -6, cursor: 'nwse-resize' },
              s:  { bottom: -6, left: '50%', marginLeft: -6, cursor: 'ns-resize' },
              sw: { bottom: -6, left: -6, cursor: 'nesw-resize' },
              w:  { top: '50%', left: -6, marginTop: -6, cursor: 'ew-resize' },
            };
            return (
              <div
                aria-hidden
                className="absolute pointer-events-none"
                style={{
                  left: `${box.x}%`,
                  top: `${box.y}%`,
                  width: `${box.width}%`,
                  height: `${box.height}%`,
                  zIndex: 1001,
                  outline: '2px dashed #6366f1',
                  outlineOffset: 2,
                }}
              >
                {GROUP_HANDLES.map((h) => (
                  <button
                    key={h}
                    type="button"
                    aria-label={`Resize group ${h}`}
                    className="absolute w-3 h-3 rounded-sm bg-white border-2 border-indigo-500 shadow-sm hover:scale-125 transition-transform pointer-events-auto"
                    style={HANDLE_POS[h]}
                    onPointerDown={(e) => onGroupResizePointerDown(e, h)}
                  />
                ))}
              </div>
            );
          })()}

          {showGuides && activeSnapLines.map((line, i) => {
            const label = guideLabelFor(line, meta.screenWidth, meta.screenHeight);
            const lineColor = line.kind === 'equal-gap' ? '#ec4899' : line.kind === 'canvas' ? '#a855f7' : line.kind === 'grid' ? '#0ea5e9' : '#ec4899';
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
