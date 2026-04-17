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
  init(payload: { id: string; isSystem: boolean; zones: Zone[]; meta: BuilderState['meta'] }): void;
  markClean(): void;
  addZone(widgetType: string): string;
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

  init: ({ id, isSystem, zones, meta }) => set({
    templateId: id,
    isSystem,
    zones: zones.map(z => ({ ...z })),
    meta,
    selectedIds: [],
    past: [],
    future: [],
    isDirty: false,
  }),

  markClean: () => set({ isDirty: false }),

  addZone: (widgetType) => {
    const id = crypto.randomUUID();
    const zones = get().zones;
    const past = [...get().past, snapshot(get())].slice(-HISTORY_LIMIT);
    const next: Zone = clampZone({
      id,
      name: `${widgetLabel(widgetType)} ${zones.length + 1}`,
      widgetType,
      x: 10,
      y: 10,
      width: 40,
      height: 30,
      zIndex: zones.reduce((m, z) => Math.max(m, z.zIndex), 0) + 1,
      sortOrder: zones.length,
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
