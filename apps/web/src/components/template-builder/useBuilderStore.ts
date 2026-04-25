import { create } from 'zustand';
import type { Zone, HistoryEntry } from './types';
import { DEFAULT_GRID_SIZE, MIN_ZONE_SIZE, widgetLabel } from './constants';

const HISTORY_LIMIT = 50;

interface BuilderState {
  templateId: string;
  isSystem: boolean;
  zones: Zone[];
  meta: {
    name: string;
    description: string;
    screenWidth: number;
    screenHeight: number;
    bgColor: string;
    bgGradient: string;
    bgImage: string;
  };
  // Sprint 4 — touch-mode settings. Not part of HistoryEntry (toggle-only UX).
  isTouchEnabled: boolean;
  idleResetMs: number;
  selectedIds: string[];
  gridSize: number;
  snapEnabled: boolean;
  showGrid: boolean;
  showGuides: boolean;
  zoom: number;
  previewMode: boolean;
  past: HistoryEntry[];
  future: HistoryEntry[];
  isDirty: boolean;

  // actions
  init(payload: { id: string; isSystem: boolean; zones: Zone[]; meta: BuilderState['meta']; isTouchEnabled?: boolean; idleResetMs?: number }): void;
  setTouchEnabled(v: boolean): void;
  setIdleResetMs(n: number): void;
  markClean(): void;
  addZone(widgetType: string, dropAt?: { x: number; y: number }): string;
  duplicateZone(id: string): string | null;
  removeSelected(): void;
  updateZone(id: string, patch: Partial<Zone>, commit?: boolean): void;
  updateZones(ids: string[], patcher: (z: Zone) => Partial<Zone>, commit?: boolean): void;
  setMeta(patch: Partial<BuilderState['meta']>): void;
  select(ids: string[] | string | null, additive?: boolean): void;
  toggleLock(id: string): void;
  moveLayer(id: string, dir: 'up' | 'down' | 'top' | 'bottom'): void;
  flipCanvas(): void;
  setZoom(z: number): void;
  setGridSize(n: number): void;
  setSnapEnabled(v: boolean): void;
  setShowGrid(v: boolean): void;
  setShowGuides(v: boolean): void;
  setPreviewMode(v: boolean): void;
  undo(): void;
  redo(): void;
  beginTransaction(): void;
  cancelTransaction(): void;
}

function snapshot(state: Pick<BuilderState, 'zones' | 'meta'>): HistoryEntry {
  return {
    zones: state.zones.map(z => ({ ...z })),
    meta: { ...state.meta },
  };
}

function clampZone(z: Zone): Zone {
  const width = Math.max(MIN_ZONE_SIZE, Math.min(100, z.width));
  const height = Math.max(MIN_ZONE_SIZE, Math.min(100, z.height));
  const x = Math.max(0, Math.min(100 - width, z.x));
  const y = Math.max(0, Math.min(100 - height, z.y));
  return { ...z, x, y, width, height };
}

export const useBuilderStore = create<BuilderState>((set, get) => ({
  templateId: '',
  isSystem: false,
  zones: [],
  meta: {
    name: '',
    description: '',
    screenWidth: 3840,
    screenHeight: 2160,
    bgColor: '',
    bgGradient: '',
    bgImage: '',
  },
  isTouchEnabled: false,
  idleResetMs: 60000,
  selectedIds: [],
  gridSize: DEFAULT_GRID_SIZE,
  snapEnabled: true,
  showGrid: true,
  showGuides: true,
  zoom: 1,
  previewMode: false,
  past: [],
  future: [],
  isDirty: false,

  init: ({ id, isSystem, zones, meta, isTouchEnabled, idleResetMs }) => set({
    templateId: id,
    isSystem,
    zones: zones.map(z => ({ ...z })),
    meta,
    isTouchEnabled: isTouchEnabled ?? false,
    idleResetMs: idleResetMs ?? 60000,
    selectedIds: [],
    past: [],
    future: [],
    isDirty: false,
  }),

  setTouchEnabled: (v) => set({ isTouchEnabled: v, isDirty: true }),
  setIdleResetMs: (n) => set({ idleResetMs: Math.max(5000, Math.min(600000, n)), isDirty: true }),

  markClean: () => set({ isDirty: false }),

  addZone: (widgetType, dropAt) => {
    const id = crypto.randomUUID();
    const zones = get().zones;
    const past = [...get().past, snapshot(get())].slice(-HISTORY_LIMIT);
    const w = 40;
    const h = 30;
    // Center the new zone on the drop point if one was provided
    // (caller resolves the drop x/y in template-percentage space).
    // Without this, every drop landed at the fixed default 10,10 so
    // every new zone stacked on top of the previous one — partner
    // reported it ditto: "i drag and drop to certain places on the
    // canvas but it drops it right on top of the other one."
    const x = dropAt ? Math.max(0, Math.min(100 - w, dropAt.x - w / 2)) : 10;
    const y = dropAt ? Math.max(0, Math.min(100 - h, dropAt.y - h / 2)) : 10;
    // Seed a sensible defaultConfig per widget type so freshly
    // dropped zones render visibly instead of as a transparent box
    // — partner reported "when i drag and drop it doesnt keep any
    // of the UI, its just a transparent box." Most widget renderers
    // gracefully fall back when their config is empty (e.g. CLOCK
    // shows the live time), but TEXT/RICH_TEXT/WEBPAGE/etc. need a
    // placeholder string so the operator sees SOMETHING and knows
    // where to click to edit.
    // Seeds use the SAME config keys the widgets actually read from
    // WidgetRenderer.tsx. Earlier version seeded e.g. `text` for TEXT
    // but TextWidget reads `config.content`, so the seed had no
    // effect and the widget rendered the bare "Your text here"
    // fallback (or nothing for image/video/logo widgets which have
    // no fallback at all). Audited every key against WidgetRenderer.
    const seedDefault = (type: string): Record<string, any> => {
      switch (type) {
        case 'TEXT':
        case 'RICH_TEXT':         return { content: 'Click to edit text' };
        case 'ANNOUNCEMENT':      return { message: 'Click to edit announcement' };
        case 'WEBPAGE':           return { url: 'https://example.com' };
        case 'TICKER':            return { messages: ['Click to edit ticker messages'] };
        case 'COUNTDOWN':         return { title: 'Countdown', targetDate: '' };
        case 'STAFF_SPOTLIGHT':   return { name: 'Staff Name', role: 'Role' };
        case 'QUOTE':             return { text: 'A quote', author: 'Author' };
        // Image/video/logo intentionally have NO config seeded — the
        // BuilderZone now renders an "Empty" placeholder badge over
        // every zone whose widget produces no visible output, so the
        // operator can SEE where they dropped it and click through.
        default:                  return {};
      }
    };
    const next: Zone = clampZone({
      id,
      name: `${widgetLabel(widgetType)} ${zones.length + 1}`,
      widgetType,
      x,
      y,
      width: w,
      height: h,
      zIndex: zones.reduce((m, z) => Math.max(m, z.zIndex), 0) + 1,
      sortOrder: zones.length,
      defaultConfig: seedDefault(widgetType),
    });
    set({ zones: [...zones, next], past, future: [], selectedIds: [id], isDirty: true });
    return id;
  },

  duplicateZone: (id) => {
    const original = get().zones.find(z => z.id === id);
    if (!original) return null;
    const newId = crypto.randomUUID();
    const past = [...get().past, snapshot(get())].slice(-HISTORY_LIMIT);
    const dup: Zone = clampZone({
      ...original,
      id: newId,
      name: `${original.name} copy`,
      x: original.x + 2,
      y: original.y + 2,
      zIndex: original.zIndex + 1,
      sortOrder: get().zones.length,
    });
    set({ zones: [...get().zones, dup], past, future: [], selectedIds: [newId], isDirty: true });
    return newId;
  },

  removeSelected: () => {
    const { selectedIds, zones } = get();
    if (selectedIds.length === 0) return;
    const filtered = zones.filter(z => !selectedIds.includes(z.id));
    if (filtered.length === zones.length) return;
    const past = [...get().past, snapshot(get())].slice(-HISTORY_LIMIT);
    set({ zones: filtered, past, future: [], selectedIds: [], isDirty: true });
  },

  updateZone: (id, patch, commit = false) => {
    const prev = get();
    const zones = prev.zones.map(z => z.id === id ? clampZone({ ...z, ...patch }) : z);
    const base: Partial<BuilderState> = { zones, isDirty: true, future: [] };
    if (commit) base.past = [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT);
    set(base as BuilderState);
  },

  updateZones: (ids, patcher, commit = false) => {
    const prev = get();
    const idSet = new Set(ids);
    const zones = prev.zones.map(z => idSet.has(z.id) ? clampZone({ ...z, ...patcher(z) }) : z);
    const base: Partial<BuilderState> = { zones, isDirty: true, future: [] };
    if (commit) base.past = [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT);
    set(base as BuilderState);
  },

  setMeta: (patch) => {
    const prev = get();
    const meta = { ...prev.meta, ...patch };
    const past = [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT);
    set({ meta, past, future: [], isDirty: true });
  },

  select: (ids, additive = false) => {
    if (ids === null) {
      set({ selectedIds: [] });
      return;
    }
    const arr = Array.isArray(ids) ? ids : [ids];
    if (additive) {
      const curr = new Set(get().selectedIds);
      arr.forEach(id => curr.has(id) ? curr.delete(id) : curr.add(id));
      set({ selectedIds: Array.from(curr) });
    } else {
      set({ selectedIds: arr });
    }
  },

  toggleLock: (id) => {
    const prev = get();
    const past = [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT);
    set({
      zones: prev.zones.map(z => z.id === id ? { ...z, locked: !z.locked } : z),
      past,
      future: [],
      isDirty: true,
    });
  },

  moveLayer: (id, dir) => {
    const prev = get();
    const zones = [...prev.zones];
    const idx = zones.findIndex(z => z.id === id);
    if (idx === -1) return;
    const past = [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT);
    const max = zones.reduce((m, z) => Math.max(m, z.zIndex), 0);
    const min = zones.reduce((m, z) => Math.min(m, z.zIndex), 0);
    const curr = zones[idx].zIndex;
    let nextZ = curr;
    if (dir === 'up') nextZ = curr + 1;
    else if (dir === 'down') nextZ = Math.max(0, curr - 1);
    else if (dir === 'top') nextZ = max + 1;
    else if (dir === 'bottom') nextZ = Math.max(0, min - 1);
    zones[idx] = { ...zones[idx], zIndex: nextZ };
    set({ zones, past, future: [], isDirty: true });
  },

  flipCanvas: () => {
    const prev = get();
    const past = [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT);
    set({
      meta: { ...prev.meta, screenWidth: prev.meta.screenHeight, screenHeight: prev.meta.screenWidth },
      past,
      future: [],
      isDirty: true,
    });
  },

  setZoom: (z) => set({ zoom: Math.max(0.25, Math.min(3, z)) }),
  setGridSize: (n) => set({ gridSize: Math.max(1, Math.min(25, n)) }),
  setSnapEnabled: (v) => set({ snapEnabled: v }),
  setShowGrid: (v) => set({ showGrid: v }),
  setShowGuides: (v) => set({ showGuides: v }),
  setPreviewMode: (v) => set({ previewMode: v, selectedIds: v ? [] : get().selectedIds }),

  undo: () => {
    const prev = get();
    const top = prev.past[prev.past.length - 1];
    if (!top) return;
    set({
      zones: top.zones.map(z => ({ ...z })),
      meta: { ...top.meta },
      past: prev.past.slice(0, -1),
      future: [snapshot(prev), ...prev.future].slice(0, HISTORY_LIMIT),
      isDirty: true,
    });
  },

  redo: () => {
    const prev = get();
    const top = prev.future[0];
    if (!top) return;
    set({
      zones: top.zones.map(z => ({ ...z })),
      meta: { ...top.meta },
      past: [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT),
      future: prev.future.slice(1),
      isDirty: true,
    });
  },

  beginTransaction: () => {
    const prev = get();
    set({ past: [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT), future: [] });
  },

  cancelTransaction: () => {
    const prev = get();
    const top = prev.past[prev.past.length - 1];
    if (!top) return;
    set({
      zones: top.zones.map(z => ({ ...z })),
      meta: { ...top.meta },
      past: prev.past.slice(0, -1),
    });
  },
}));
