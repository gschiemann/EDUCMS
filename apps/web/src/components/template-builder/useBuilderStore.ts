import { create } from 'zustand';
import type { Zone, HistoryEntry, TemplateScene } from './types';
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
    /** Field-mapping data source. 'NONE' = static/no feed;
     *  'CTS' = Colorado Time Systems live score & clock feed (Phase 1, sports);
     *  'POS' = connected point-of-sale live menu / prices (Phase 2, menu boards);
     *  'CUSTOM' = generic REST/JSON or Google-Sheet-CSV feed (Phase 3, generic
     *  widgets like TICKER). Persisted as part of the template meta so the
     *  player knows which live feed to subscribe to. Stored in
     *  template.defaultConfig.dataSource via the existing meta save path. */
    dataSource?: 'NONE' | 'CTS' | 'POS' | 'CUSTOM';
    /** Phase 3 — the external feed URL for dataSource === 'CUSTOM'. The
     *  widget hook (useCustomData) posts this to the SSRF-gated
     *  /data-source/fetch proxy; never fetched directly from the browser. */
    dataUrl?: string;
    /** Phase 3 — how to parse the custom feed: REST/JSON or Google-Sheet CSV. */
    dataFormat?: 'json' | 'csv';
  };
  // Sprint 4 — touch-mode settings. Not part of HistoryEntry (toggle-only UX).
  isTouchEnabled: boolean;
  idleResetMs: number;
  // Phase D2.5 (2026-05-12) — multi-scene state. `scenes` mirrors the
  // server's TemplateScene rows; `activeSceneId` tracks which scene the
  // operator is currently editing. Zones with `sceneId === activeSceneId`
  // (or `sceneId == null` for shared zones) render on the canvas. Scene
  // CRUD goes through the API and refreshes this list; we DON'T put it
  // in History (undo) because scenes are a higher-order entity than the
  // canvas zones / meta you're snapshotting per action.
  scenes: TemplateScene[];
  activeSceneId: string | null;
  selectedIds: string[];
  /** Per-field text editing — set when operator focuses a sub-text on
   *  an HS widget (or any widget whose config carries a `__styles` map).
   *  Drives the BuilderBottomBar's per-field format toolbar. Cleared
   *  when selection changes or panel input blurs. 2026-05-08. */
  activeFieldName: string | null;
  gridSize: number;
  snapEnabled: boolean;
  showGrid: boolean;
  showGuides: boolean;
  zoom: number;
  previewMode: boolean;
  past: HistoryEntry[];
  future: HistoryEntry[];
  isDirty: boolean;
  /**
   * A2 (Wave A — "Crush Canva", 2026-07-02) — undo keystroke coalescing.
   * `true` for the duration of an open transaction (from beginTransaction()
   * to endTransaction()/cancelTransaction()). While open, any commit=true
   * call to updateZone/updateZones/setMeta is treated as "ensure a
   * snapshot exists for this session" rather than "push a new snapshot" —
   * beginTransaction already pushed the ONE snapshot the whole session
   * (e.g. a continuous typing burst in a Properties field) undoes to.
   * Mirrors the pattern the canvas drag already uses (beginTransaction
   * once at pointerdown, then commit=false updates for the rest of the
   * drag) so a field's whole edit — not each keystroke — is one Cmd-Z.
   */
  activeTransaction: boolean;

  // actions
  init(payload: { id: string; isSystem: boolean; zones: Zone[]; meta: BuilderState['meta']; isTouchEnabled?: boolean; idleResetMs?: number; scenes?: TemplateScene[] }): void;
  setTouchEnabled(v: boolean): void;
  setIdleResetMs(n: number): void;
  /** Phase D2.8 — add a TOUCH_POINT hotspot. Unlike addZone (which
   *  creates a content-bearing zone), this is a small, transparent
   *  tap target the operator drops on TOP of existing content. Starts
   *  at 15% × 15% so it doesn't blanket the canvas. The operator
   *  positions it over whatever they want tappable, then sets a
   *  Tap Action in the Properties panel. */
  addTouchPoint(dropAt?: { x: number; y: number }): string;
  /** Phase D2.5 — refresh scenes from server (called after CRUD ops). */
  setScenes(scenes: TemplateScene[]): void;
  /** Phase D2.5 — switch which scene the canvas shows + edits. Optimistic
   *  client-only state; doesn't dirty the template. */
  setActiveSceneId(sceneId: string | null): void;
  /** Phase D2.5 — assign one or more zones to a scene (or null = shared
   *  across every scene). Persists via the same updateZone path so the
   *  next zone-save flush picks it up. */
  assignZonesToScene(zoneIds: string[], sceneId: string | null, commit?: boolean): void;
  markClean(): void;
  /**
   * `size` (percent-of-canvas w/h) — App Library smart-placement (world-class
   * build, 2026-07-01). Lets a caller (AppConfigForm) override the generic
   * 40x30 default with a widgetType-appropriate size (video fills 16:9,
   * QR drops as a small corner square, etc.) without touching the
   * palette/touch-tile paths, which keep their existing sizing untouched.
   */
  addZone(widgetType: string, dropAt?: { x: number; y: number }, size?: { w: number; h: number }): string;
  /**
   * Quick Layouts: replace all existing zones with N pre-positioned
   * zones (rects in 0-100 percentage space). Each zone defaults to
   * `defaultWidgetType` (IMAGE if not specified). The operator then
   * swaps widget type per-zone via the Properties panel or by
   * dropping a different widget into the zone.
   */
  applyLayout(rects: Array<{ x: number; y: number; width: number; height: number }>, defaultWidgetType?: string): void;
  duplicateZone(id: string): string | null;
  removeSelected(): void;
  updateZone(id: string, patch: Partial<Zone>, commit?: boolean): void;
  updateZones(ids: string[], patcher: (z: Zone) => Partial<Zone>, commit?: boolean): void;
  setMeta(patch: Partial<BuilderState['meta']>): void;
  select(ids: string[] | string | null, additive?: boolean): void;
  setActiveFieldName(name: string | null): void;
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
  /** A2 — close an open transaction (e.g. field blur). No-op on history;
   *  just clears the `activeTransaction` flag so the NEXT commit=true
   *  call (a new edit session) pushes its own fresh snapshot again. */
  endTransaction(): void;
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
    dataSource: 'NONE' as const,
  },
  isTouchEnabled: false,
  idleResetMs: 60000,
  scenes: [],
  activeSceneId: null,
  selectedIds: [],
  activeFieldName: null,
  gridSize: DEFAULT_GRID_SIZE,
  snapEnabled: true,
  showGrid: true,
  showGuides: true,
  zoom: 1,
  previewMode: false,
  past: [],
  future: [],
  isDirty: false,
  activeTransaction: false,

  init: ({ id, isSystem, zones, meta, isTouchEnabled, idleResetMs, scenes }) => {
    // Pick the default scene (or first by sort order) so the canvas
    // mounts on a known-good slice. Falls back to null (= show ALL
    // zones, legacy behavior) when the template has no scenes — which
    // shouldn't happen post-migration but is safer than blanking the
    // canvas if the include() ever changes server-side.
    const sceneList = scenes ?? [];
    const defaultScene = sceneList.find((s) => s.isDefault) || sceneList[0] || null;
    set({
      templateId: id,
      isSystem,
      zones: zones.map(z => ({ ...z })),
      meta,
      isTouchEnabled: isTouchEnabled ?? false,
      idleResetMs: idleResetMs ?? 60000,
      scenes: sceneList,
      activeSceneId: defaultScene?.id ?? null,
      selectedIds: [],
      activeFieldName: null,
      past: [],
      future: [],
      isDirty: false,
      activeTransaction: false,
    });
  },

  setTouchEnabled: (v) => set({ isTouchEnabled: v, isDirty: true }),
  setIdleResetMs: (n) => set({ idleResetMs: Math.max(5000, Math.min(600000, n)), isDirty: true }),

  // Phase D2.8 (2026-05-12) — operator: "i dont like how the initial
  // touch point is the full screen and you need to shrink it down...
  // just have an option to add touch point and keep adding smaller
  // squares i can resize across the entire teamplate."
  //
  // addTouchPoint creates an overlay-style hotspot — a small (15%×15%
  // default), transparent, named tap target the operator drops on
  // top of existing content. It's a zone like any other, but the
  // widget renders invisibly at runtime (player shows nothing; only
  // the tap is consumed). The builder paints a distinctive dashed
  // outline so the operator can see and reposition it.
  addTouchPoint: (dropAt) => {
    const id = crypto.randomUUID();
    const past = [...get().past, snapshot(get())].slice(-HISTORY_LIMIT);
    const zones = get().zones;
    // Smaller default than addZone's 40×30. Touch points are meant
    // to overlay specific UI, not blanket-cover content.
    const w = 15;
    const h = 15;
    let x: number, y: number;
    if (dropAt) {
      x = Math.max(0, Math.min(100 - w, dropAt.x - w / 2));
      y = Math.max(0, Math.min(100 - h, dropAt.y - h / 2));
    } else {
      // Stagger so the 2nd / 3rd / 4th touch point doesn't stack on
      // top of the previous one. Walk in a 5%-offset diagonal until
      // we'd run off canvas, then reset to (10, 10).
      const tpCount = zones.filter((z) => z.widgetType === 'TOUCH_POINT').length;
      const offset = (tpCount * 5) % 60;
      x = 10 + offset;
      y = 10 + offset;
      if (x + w > 100 || y + h > 100) { x = 10; y = 10; }
    }
    const activeSceneId = get().activeSceneId;
    const next: Zone = clampZone({
      id,
      name: `Touch point ${zones.filter((z) => z.widgetType === 'TOUCH_POINT').length + 1}`,
      widgetType: 'TOUCH_POINT',
      x, y, width: w, height: h,
      zIndex: zones.reduce((m, z) => Math.max(m, z.zIndex), 0) + 1,
      sortOrder: zones.length,
      defaultConfig: {},
      sceneId: activeSceneId,
    });
    set({
      zones: [...zones, next],
      past,
      future: [],
      selectedIds: [id],
      // Auto-enable touch mode the first time the operator drops a
      // touch point — if they're adding a hotspot, the template is
      // by definition touch-interactive. Saves a step.
      isTouchEnabled: true,
      isDirty: true,
    });
    return id;
  },

  setScenes: (scenes) => {
    // Preserve the currently-active scene if it still exists; otherwise
    // fall back to the default or first scene so we never strand the
    // canvas on a deleted scene id.
    const prev = get().activeSceneId;
    const stillThere = prev && scenes.find((s) => s.id === prev);
    const fallback = scenes.find((s) => s.isDefault) || scenes[0] || null;
    set({
      scenes,
      activeSceneId: stillThere ? prev : (fallback?.id ?? null),
    });
  },

  setActiveSceneId: (sceneId) => {
    // Drop selection when switching scenes — selecting a zone that's
    // not visible on the current scene is a UX dead-end.
    set({ activeSceneId: sceneId, selectedIds: [], activeFieldName: null });
  },

  assignZonesToScene: (zoneIds, sceneId, commit = true) => {
    const prev = get();
    if (zoneIds.length === 0) return;
    const ids = new Set(zoneIds);
    const zones = prev.zones.map((z) => (ids.has(z.id) ? { ...z, sceneId: sceneId ?? null } : z));
    const base: Partial<BuilderState> = { zones, isDirty: true, future: [] };
    if (commit) base.past = [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT);
    set(base as BuilderState);
  },

  markClean: () => set({ isDirty: false }),

  addZone: (widgetType, dropAt, size) => {
    const id = crypto.randomUUID();
    const zones = get().zones;
    const past = [...get().past, snapshot(get())].slice(-HISTORY_LIMIT);
    // App Library smart-placement (world-class build, 2026-07-01) — a
    // generic 40x30 box for every widget was wrong for both a full-bleed
    // video and a tiny QR code alike. `size` is opt-in and ONLY ever passed
    // by the App Library's AppConfigForm (keyed off the app's `defaultSize`,
    // with its own widgetType-keyed fallback for apps that didn't specify
    // one — see AppConfigForm.tsx). The plain Widgets palette / touch-tile
    // click-to-add path (VariantPicker, BuilderShell drag/drop) NEVER passes
    // `size`, so their existing 40x30 / 15x15 sizing is completely
    // unaffected — this parameter is additive, not a behavior change to the
    // pre-existing paths.
    const w = size?.w ?? 40;
    const h = size?.h ?? 30;
    // Center the new zone on the drop point if one was provided
    // (caller resolves the drop x/y in template-percentage space).
    // Without this, every drop landed at the fixed default 10,10 so
    // every new zone stacked on top of the previous one — partner
    // reported it ditto: "i drag and drop to certain places on the
    // canvas but it drops it right on top of the other one."
    //
    // 2026-04-29: When no dropAt (click from the palette sidebar),
    // stagger each new zone by 5% from the previous zone so click-
    // added widgets land visibly offset rather than all stacking at
    // (10, 10). Wraps back to (10, 10) when we'd hit the canvas edge.
    let x: number, y: number;
    if (dropAt) {
      x = Math.max(0, Math.min(100 - w, dropAt.x - w / 2));
      y = Math.max(0, Math.min(100 - h, dropAt.y - h / 2));
    } else {
      // 2026-05-03 — operator: "one widget overwrites the next 6 widgets
      // in the same category." Each new zone now goes to the right of
      // the previous one (no overlap), wrapping to a new row when it
      // would exceed the canvas width, and resetting to (10,10) when
      // it would exceed canvas height. This way clicking 6 widget
      // tiles in a row produces 6 visually distinct zones laid out in
      // a sensible reading order — not a stack of cascading rectangles
      // pretending to be six separate widgets but mostly hidden.
      const gap = 2; // 2% gap between zones so borders don't touch
      const last = zones.length > 0 ? zones[zones.length - 1] : null;
      if (!last) {
        x = 10;
        y = 10;
      } else {
        const tryX = last.x + last.width + gap;
        if (tryX + w <= 100) {
          // Same row, just to the right of the previous zone
          x = tryX;
          y = last.y;
        } else {
          // Wrap to next row at left edge, below the previous zone
          x = 10;
          y = last.y + last.height + gap;
          if (y + h > 100) {
            // Canvas full — reset to top-left, accept overlap with row 1
            y = 10;
          }
        }
      }
    }
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
        case 'COUNTDOWN':         return { label: 'Countdown', targetDate: '' };
        case 'STAFF_SPOTLIGHT':   return { staffName: 'Staff Name', role: 'Role' };
        case 'QUOTE':             return { quote: 'Click to edit quote', author: 'Author' };
        // Phase D2.9 — Touch palette tiles. Each canonicalizes to
        // widgetType='TOUCH_POINT' (see below) with the variant in
        // defaultConfig. Variant drives the visual the renderer
        // paints; the tap-target behavior is identical across all.
        case 'TOUCH_HOTSPOT':     return { variant: 'hotspot' };
        case 'TOUCH_TAP_PROMPT':  return { variant: 'tap-prompt', label: 'Tap to continue' };
        case 'TOUCH_CIRCLE':      return { variant: 'circle' };
        case 'TOUCH_SQUARE':      return { variant: 'square', label: 'Tap' };
        case 'TOUCH_ARROW_RIGHT': return { variant: 'arrow-right' };
        case 'TOUCH_ARROW_LEFT':  return { variant: 'arrow-left' };
        case 'TOUCH_ARROW_UP':    return { variant: 'arrow-up' };
        case 'TOUCH_ARROW_DOWN':  return { variant: 'arrow-down' };
        // Phase D2.10 — kiosk nav button vocabulary. Each carries a
        // default label so the variant renders meaningfully even
        // before the operator edits it; labels are inline-editable
        // via the contentEditable hotspot pattern.
        case 'TOUCH_HOME':        return { variant: 'home' };
        case 'TOUCH_BACK':        return { variant: 'back', label: 'Back' };
        case 'TOUCH_NEXT':        return { variant: 'next', label: 'Next' };
        case 'TOUCH_CLOSE':       return { variant: 'close' };
        case 'TOUCH_MENU':        return { variant: 'menu' };
        case 'TOUCH_HELP':        return { variant: 'help' };
        case 'TOUCH_PLAY':        return { variant: 'play' };
        // Phase D2.11 — comm + engagement + utility touch widgets.
        // qrText is the placeholder URL the operator overrides in
        // Properties → it's also passed into the QR generator at
        // runtime once a QR library is wired up (v1 ships a visual
        // placeholder so the operator can position + size first).
        case 'TOUCH_QR':          return { variant: 'qr', qrText: 'https://example.com' };
        case 'TOUCH_INFO':        return { variant: 'info' };
        case 'TOUCH_PHONE':       return { variant: 'phone' };
        case 'TOUCH_EMAIL':       return { variant: 'email' };
        case 'TOUCH_SHARE':       return { variant: 'share' };
        case 'TOUCH_HEART':       return { variant: 'heart' };
        case 'TOUCH_STAR':        return { variant: 'star' };
        case 'TOUCH_SEARCH':      return { variant: 'search' };
        case 'TOUCH_VOLUME':      return { variant: 'volume' };
        case 'TOUCH_PRINT':       return { variant: 'print' };
        // Sprint 11h decorations — the palette ships eight tiles but
        // they all spawn `widgetType='DECORATION'` rows; the variant
        // is what differentiates them. Defaults are sane so a fresh
        // drop renders the right animation immediately.
        case 'DECORATION_CONFETTI':       return { variant: 'confetti', speed: 1, count: 60 };
        case 'DECORATION_RAINBOW_RIBBON': return { variant: 'rainbow-ribbon', speed: 1 };
        case 'DECORATION_BALLOONS':       return { variant: 'balloons', speed: 1, count: 8 };
        case 'DECORATION_CLOUDS':         return { variant: 'clouds', speed: 1 };
        case 'DECORATION_SPARKLES':       return { variant: 'sparkles', speed: 1, count: 24 };
        case 'DECORATION_TICKER':         return { variant: 'ticker', speed: 1, text: 'Welcome · Have a wonderful day · Stay curious' };
        case 'DECORATION_NEON_BUZZ':      return { variant: 'neon-buzz', text: 'OPEN', glowColor: '#f0abfc' };
        case 'DECORATION_PULSE_GLOW':     return { variant: 'pulse-glow', speed: 1, glowColor: '#fbbf24' };
        // Image/video/logo intentionally have NO config seeded — the
        // BuilderZone now renders an "Empty" placeholder badge over
        // every zone whose widget produces no visible output, so the
        // operator can SEE where they dropped it and click through.
        default:                  return {};
      }
    };

    // Sprint 11h — decorations all collapse to widgetType='DECORATION'
    // with their variant in defaultConfig. The palette tile keeps a
    // distinct DECORATION_* type so it can carry its own label / icon
    // / desc; once it lands as a zone, the type folds into the canonical
    // DECORATION dispatch in WidgetRenderer.
    // Phase D2.9 — touch palette tiles (TOUCH_HOTSPOT, TOUCH_ARROW_*,
    // TOUCH_CIRCLE, etc.) all canonicalize to widgetType='TOUCH_POINT'
    // with their variant carried in defaultConfig. The seedDefault
    // switch above already sets the variant key.
    const isTouchTile = widgetType.startsWith('TOUCH_');
    const canonicalWidgetType = isTouchTile
      ? 'TOUCH_POINT'
      : (widgetType.startsWith('DECORATION_') ? 'DECORATION' : widgetType);
    // Phase D2.5 — new zones inherit the currently-active scene so the
    // operator's mental model holds: "I clicked Add while editing
    // Scene B, the new widget belongs to Scene B." Shared zones (those
    // that render in every scene) are an explicit operator choice via
    // the properties panel.
    const activeSceneId = get().activeSceneId;

    // Phase D2.9 — touch tiles drop SMALLER than regular content zones
    // (15% × 15% vs the 40% × 30% default) so the operator doesn't
    // have to shrink them every time. Most touch widgets sit on top
    // of other content as tap hotspots; making them blanket-cover the
    // canvas by default was the "i dont like how the inital touch
    // point is the full screen and you need to shrink it down" issue.
    const touchSize = isTouchTile ? { w: 15, h: 15 } : null;
    const finalW = touchSize?.w ?? w;
    const finalH = touchSize?.h ?? h;
    // Recenter if we shrank — the original drop point should still be
    // the visual center of the smaller zone.
    if (touchSize && dropAt) {
      x = Math.max(0, Math.min(100 - finalW, dropAt.x - finalW / 2));
      y = Math.max(0, Math.min(100 - finalH, dropAt.y - finalH / 2));
    }

    const next: Zone = clampZone({
      id,
      name: `${widgetLabel(widgetType)} ${zones.length + 1}`,
      widgetType: canonicalWidgetType,
      x,
      y,
      width: finalW,
      height: finalH,
      zIndex: zones.reduce((m, z) => Math.max(m, z.zIndex), 0) + 1,
      sortOrder: zones.length,
      defaultConfig: seedDefault(widgetType),
      sceneId: activeSceneId,
    });
    set({
      zones: [...zones, next],
      past,
      future: [],
      selectedIds: [id],
      isDirty: true,
      // Phase D2.9 — dropping ANY touch tile auto-enables the
      // template's touch mode. The big "Make this template
      // interactive" CTA in Properties becomes superfluous once
      // widgets carry the intent themselves.
      ...(isTouchTile && !get().isTouchEnabled ? { isTouchEnabled: true } : {}),
    });
    return id;
  },

  // 2026-05-09 — Quick Layouts. Operator: "i need to add multiple
  // items to the same screen, add images, video, url, splits the
  // screen into multiple areas." The builder already supports
  // multi-zone (drop N widgets, position each) but doing 4 quadrants
  // by hand is fiddly. This action wipes existing zones and lays
  // out N zones at preset positions. Each zone defaults to IMAGE
  // (operator can swap widget type via Properties panel or by
  // dragging a different widget into the zone). Mirrors the "split
  // screen" wizard pattern in Yodeck / Rise Vision / OptiSigns.
  //
  // rects are in template-percentage space (0-100, top-left origin).
  applyLayout: (rects, defaultWidgetType = 'IMAGE') => {
    const past = [...get().past, snapshot(get())].slice(-HISTORY_LIMIT);
    const next: Zone[] = rects.map((r, i) => clampZone({
      id: crypto.randomUUID(),
      name: `Zone ${i + 1}`,
      widgetType: defaultWidgetType,
      x: r.x, y: r.y, width: r.width, height: r.height,
      zIndex: i + 1,
      sortOrder: i,
      defaultConfig: {},
    }));
    set({ zones: next, past, future: [], selectedIds: next.length ? [next[0].id] : [], isDirty: true });
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
    // A2 — a commit=true call inside an already-open transaction (e.g. a
    // continuous typing burst — the field called beginTransaction() once
    // on focus) does NOT push a second snapshot; the transaction's
    // opening snapshot already covers the whole session. Only a
    // commit=true call OUTSIDE any open transaction pushes its own
    // one-off snapshot (unchanged behavior for every existing caller
    // that doesn't wrap itself in begin/endTransaction).
    if (commit && !prev.activeTransaction) base.past = [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT);
    set(base as BuilderState);
  },

  updateZones: (ids, patcher, commit = false) => {
    const prev = get();
    const idSet = new Set(ids);
    const zones = prev.zones.map(z => idSet.has(z.id) ? clampZone({ ...z, ...patcher(z) }) : z);
    const base: Partial<BuilderState> = { zones, isDirty: true, future: [] };
    if (commit && !prev.activeTransaction) base.past = [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT);
    set(base as BuilderState);
  },

  setMeta: (patch) => {
    const prev = get();
    const meta = { ...prev.meta, ...patch };
    const base: Partial<BuilderState> = { meta, isDirty: true, future: [] };
    // A2 — same coalescing as updateZone/updateZones. setMeta previously
    // snapshotted on EVERY call, which is what made typing a template
    // Name/Description or dragging a background gradient/color input
    // evict the 50-deep history one character at a time.
    if (!prev.activeTransaction) base.past = [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT);
    set(base as BuilderState);
  },

  select: (ids, additive = false) => {
    if (ids === null) {
      // Clear field focus too — bottom bar's per-field toolbar should
      // disappear when nothing is selected.
      set({ selectedIds: [], activeFieldName: null });
      return;
    }
    const arr = Array.isArray(ids) ? ids : [ids];
    if (additive) {
      const curr = new Set(get().selectedIds);
      arr.forEach(id => curr.has(id) ? curr.delete(id) : curr.add(id));
      set({ selectedIds: Array.from(curr) });
    } else {
      // Switching zones invalidates the focused field — different
      // widget, different fields.
      const prev = get().selectedIds;
      const sameSelection = prev.length === arr.length && prev.every((id) => arr.includes(id));
      set({
        selectedIds: arr,
        activeFieldName: sameSelection ? get().activeFieldName : null,
      });
    }
  },

  setActiveFieldName: (name) => set({ activeFieldName: name }),

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
    // A2 — guard against a nested/re-entrant beginTransaction (e.g. a
    // field re-focusing while `activeTransaction` is already true) from
    // pushing a SECOND opening snapshot. The first begin already opened
    // the session; a redundant call is a no-op history-wise.
    if (prev.activeTransaction) return;
    set({
      past: [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT),
      future: [],
      activeTransaction: true,
    });
  },

  endTransaction: () => {
    set({ activeTransaction: false });
  },

  cancelTransaction: () => {
    const prev = get();
    const top = prev.past[prev.past.length - 1];
    if (!top) {
      set({ activeTransaction: false });
      return;
    }
    set({
      zones: top.zones.map(z => ({ ...z })),
      meta: { ...top.meta },
      past: prev.past.slice(0, -1),
      activeTransaction: false,
    });
  },
}));
