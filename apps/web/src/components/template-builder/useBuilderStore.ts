import { create } from 'zustand';
import type { Zone, HistoryEntry, TemplateScene } from './types';
import { DEFAULT_GRID_SIZE, MIN_ZONE_SIZE, widgetLabel } from './constants';

const HISTORY_LIMIT = 50;

/**
 * Sensible starting config per widget type, so a freshly-placed zone renders
 * something visible instead of a transparent box.
 *
 * MODULE SCOPE, not a closure inside `addZone` (2026-09-11): the widgets panel
 * can now FILL an empty placeholder or REPLACE a zone's widget in place, and
 * both of those paths need the exact same seeds `addZone` uses. A second copy
 * of this switch is how a placeholder ends up filled with a TEXT widget that
 * has no `content` and renders blank.
 *
 * Seeds use the SAME config keys the widgets actually read in
 * WidgetRenderer.tsx — see the audit note that produced them.
 */
export function seedDefaultConfig(type: string): Record<string, any> {
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
}

/**
 * Palette tiles carry their own SCREAMING_SNAKE type (TOUCH_QR,
 * DECORATION_CONFETTI) but collapse to ONE canvas widget type with the
 * specific visual in `defaultConfig.variant`. Shared by `addZone` and
 * `setZoneWidget` so a filled placeholder canonicalises identically to a
 * dropped one.
 */
export function canonicalWidgetType(type: string): string {
  if (type.startsWith('TOUCH_')) return 'TOUCH_POINT';
  if (type.startsWith('DECORATION_')) return 'DECORATION';
  return type;
}

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
  /**
   * Bumped by every DELIBERATE "I want to work on this widget" gesture —
   * a canvas/layers click, or a picker tile that fills or replaces a zone.
   *
   * WHY A COUNTER AND NOT `selectedIds` (2026-09-11). BuilderShell flips the
   * left rail to Properties by diffing `selectedIds.join(',')`. A brand-new
   * template seeds ONE full-screen `EMPTY` placeholder which the bottom bar
   * auto-selects, so filling it with the operator's first widget keeps the
   * SAME zone id — the diff saw no change, the rail stayed on the widget
   * catalogue, and the widget the operator had just added had no visible
   * editor anywhere. Re-clicking it on the canvas didn't help either, for
   * the same reason. Operator, on the first widget of a customer demo:
   * "added the first widget and i cant edit anything on it."
   *
   * Identity is the wrong signal for intent: the same zone can be selected
   * twice in a row and mean it both times. Never part of a history snapshot.
   */
  selectionEpoch: number;
  /**
   * Where the current selection came from. 'canvas' (default) opens the
   * inspector; 'panel' (a Layers row, a Review "locate") keeps the operator in
   * the panel they are using — Codex T01, 2026-09-13.
   */
  selectionSource: 'canvas' | 'panel';
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
   * Monotonic edit revision: bumped by EVERY change that dirties the template
   * (the store's `set` wrapper does it). A save captures it at start and marks
   * the template clean only if it is unchanged when the save completes, so an
   * edit made while a save was in flight can never be silently declared saved
   * (Codex T10, 2026-09-13).
   */
  editRev: number;
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
  /**
   * Wave C (2026-07-02) — the `updatedAt` the client currently believes
   * the server has for this template. Set on init() from the loaded
   * template, refreshed after every successful save. Two consumers:
   *   - C1 draft recovery: a localStorage draft is only worth offering
   *     to restore when it's NEWER than this (autosave-draft.ts
   *     isDraftNewer) — never a pure read, this field is just data.
   *   - C2 staleness guard: BuilderShell's handleSave sends this back
   *     to the server as `expectedUpdatedAt`; a 409 means someone else
   *     saved since we loaded/last-saved.
   * Pure metadata — never part of HistoryEntry, never touched by undo.
   */
  serverUpdatedAt: string | null;

  // actions
  init(payload: { id: string; isSystem: boolean; zones: Zone[]; meta: BuilderState['meta']; isTouchEnabled?: boolean; idleResetMs?: number; scenes?: TemplateScene[]; updatedAt?: string | null }): void;
  setTouchEnabled(v: boolean): void;
  setIdleResetMs(n: number): void;
  /** Wave C — record the server's current updatedAt (post-save, or after
   *  a staleness-conflict "Reload theirs"). Pure metadata write: no
   *  history push, no isDirty change. */
  setServerUpdatedAt(updatedAt: string | null): void;
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
  /** Clear the dirty flag — only if `rev` (from editRev at save start) is still current. */
  markClean(rev?: number): void;
  /**
   * `size` (percent-of-canvas w/h) — App Library smart-placement (world-class
   * build, 2026-07-01). Lets a caller (AppConfigForm) override the generic
   * 40x30 default with a widgetType-appropriate size (video fills 16:9,
   * QR drops as a small corner square, etc.) without touching the
   * palette/touch-tile paths, which keep their existing sizing untouched.
   */
  addZone(widgetType: string, dropAt?: { x: number; y: number }, size?: { w: number; h: number }): string;
  /**
   * Put a widget INTO an existing zone, keeping its position and size.
   *
   * Phase 2 (2026-09-11) — the widgets panel's ADD/REPLACE split. Two callers:
   *   - FILL: the operator clicks a widget while the untouched full-screen
   *     `EMPTY` placeholder a new template seeds is selected. Adding a 40x30
   *     box instead would leave that unexplained rectangle sitting behind the
   *     new widget forever, which is what a first-time operator actually saw.
   *   - REPLACE: the operator explicitly chose "Replace <zone>" in the panel.
   *     Never reachable by a plain click on a tile — a silent destructive swap
   *     is the behaviour this phase removed.
   *
   * Pushes one history entry, so Cmd/Ctrl+Z restores the previous widget.
   */
  setZoneWidget(id: string, widgetType: string, variantId?: string, variantConfig?: Record<string, any>): void;
  /**
   * Quick Layouts: replace the zones on the slice the operator is editing
   * with N pre-positioned zones (rects in 0-100 percentage space). Each zone
   * defaults to `defaultWidgetType` (IMAGE if not specified). The operator
   * then swaps widget type per-zone via the Properties panel or by dropping
   * a different widget into the zone.
   *
   * M0-6 — "the slice", not "every zone in the template": on a multi-scene
   * kiosk this replaces only the active scene's zones and the new ones join
   * that scene. See `layoutReplacementTargets`. On a one-scene (or
   * pre-scenes) template it still replaces everything, exactly as before.
   */
  applyLayout(rects: Array<{ x: number; y: number; width: number; height: number }>, defaultWidgetType?: string): void;
  duplicateZone(id: string): string | null;
  removeSelected(): void;
  updateZone(id: string, patch: Partial<Zone>, commit?: boolean): void;
  updateZones(ids: string[], patcher: (z: Zone) => Partial<Zone>, commit?: boolean): void;
  setMeta(patch: Partial<BuilderState['meta']>): void;
  select(ids: string[] | string | null, additive?: boolean, opts?: { source?: 'canvas' | 'panel' }): void;
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

function snapshot(state: Pick<BuilderState, 'zones' | 'meta' | 'isTouchEnabled' | 'idleResetMs'>): HistoryEntry {
  return {
    zones: state.zones.map(z => ({ ...z })),
    meta: { ...state.meta },
    // C4 — captured alongside zones/meta so a snapshot fully describes
    // "what the operator would Save right now," touch settings included.
    isTouchEnabled: state.isTouchEnabled,
    idleResetMs: state.idleResetMs,
  };
}

/**
 * M0-6 (2026-09-12) — which zones a "Quick layout" is allowed to delete.
 *
 * A Quick Layout lays out ONE canvas. On a multi-scene touch kiosk the
 * canvas is the SCENE the operator is looking at, not the whole template:
 * the store holds every scene's zones at once (BuilderCanvas filters them
 * down for display), so a blanket `set({ zones: next })` silently deleted
 * every other scene's content. That is the same collapse class as the
 * server-side restore bug this ships with.
 *
 * The predicate is the one `ScenesPanel.zoneCountFor` already uses —
 * `(z.sceneId ?? null) === activeSceneId` — which means:
 *   - a real scene is active → only that scene's own zones are replaced;
 *     other scenes and deliberately-shared zones (sceneId null) survive;
 *   - the "Shared" pseudo-scene is active (activeSceneId null) → only the
 *     shared zones are replaced, per-scene content survives.
 *
 * `sceneCount <= 1` keeps the pre-M0-6 behaviour verbatim (replace
 * everything): with no second scene there is nothing to protect, and a
 * legacy template can hold a mix of null and default-scene zones that the
 * predicate would otherwise strand on the canvas.
 *
 * Exported so the confirm dialog can count exactly what it is about to
 * destroy instead of claiming a number that is no longer true.
 */
export function layoutReplacementTargets(
  zones: readonly Zone[],
  sceneCount: number,
  activeSceneId: string | null,
): Zone[] {
  if (sceneCount <= 1) return [...zones];
  return zones.filter((z) => (z.sceneId ?? null) === activeSceneId);
}

/**
 * M0-7 (2026-09-12) — the geometry keys a LOCKED zone refuses.
 *
 * "Lock" means the zone cannot be MOVED, RESIZED or DELETED. It does NOT
 * mean the zone is frozen against every edit: the operator can still select
 * it to read its properties, retype its content, apply a brand kit, and —
 * crucially — UNLOCK it. So the filter below is surgical: it strips exactly
 * these four keys out of a bulk patch, and lets everything else (including
 * `locked` itself, which is what an unlock writes) straight through.
 */
const LOCKED_ZONE_FROZEN_KEYS = ['x', 'y', 'width', 'height'] as const;

/**
 * Apply a bulk patch to ONE zone, honouring its lock.
 *
 * Returns the SAME object identity when a locked zone's patch is entirely
 * geometry — not a re-clamped clone. That matters: `clampZone` would happily
 * "fix" a locked zone that sits slightly out of bounds, so re-clamping a zone
 * the operator asked us not to touch would be its own silent mutation.
 */
function applyBulkPatch(z: Zone, patch: Partial<Zone>): Zone {
  if (!z.locked) return clampZone({ ...z, ...patch });
  const rest: Partial<Zone> = { ...patch };
  for (const k of LOCKED_ZONE_FROZEN_KEYS) delete rest[k];
  if (Object.keys(rest).length === 0) return z;
  return clampZone({ ...z, ...rest });
}

function clampZone(z: Zone): Zone {
  const width = Math.max(MIN_ZONE_SIZE, Math.min(100, z.width));
  const height = Math.max(MIN_ZONE_SIZE, Math.min(100, z.height));
  const x = Math.max(0, Math.min(100 - width, z.x));
  const y = Math.max(0, Math.min(100 - height, z.y));
  return { ...z, x, y, width, height };
}

export const useBuilderStore = create<BuilderState>((rawSet, get) => {
  // Every patch that dirties the template also advances editRev (see the
  // interface). Wrapping `set` here means no mutation site can forget it.
  const set: typeof rawSet = ((partial: Parameters<typeof rawSet>[0], replace?: boolean) => {
    const next = (typeof partial === 'function' ? partial(get()) : partial) as Partial<BuilderState>;
    if (next && typeof next === 'object' && next.isDirty === true) {
      (rawSet as (p: Partial<BuilderState>, r?: boolean) => void)({ ...next, editRev: (get().editRev ?? 0) + 1 }, replace);
    } else {
      (rawSet as (p: Partial<BuilderState>, r?: boolean) => void)(next, replace);
    }
  }) as typeof rawSet;
  return ({
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
  selectionEpoch: 0,
  selectionSource: 'canvas',
  editRev: 0,
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
  serverUpdatedAt: null,

  init: ({ id, isSystem, zones, meta, isTouchEnabled, idleResetMs, scenes, updatedAt }) => {
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
      serverUpdatedAt: updatedAt ?? null,
    });
  },

  // C4 (Wave C, 2026-07-02) — "undo silently skips whole classes of
  // edits: touch mode, idle-reset" (05-EDITOR-CRUSH-LENSES.md). Both
  // actions previously wrote isDirty with NO history push at all, so
  // Cmd-Z right after flipping touch mode reverted an unrelated earlier
  // zone/meta edit instead of the toggle itself. Now they snapshot
  // BEFORE the change (same "commit the prior state" pattern as every
  // other mutator), respecting an open transaction exactly like
  // updateZone/setMeta — if a caller ever wraps a burst of idle-reset
  // changes in begin/endTransaction (e.g. a future slider control),
  // the whole burst still collapses to one undo step instead of one
  // snapshot per tick.
  setTouchEnabled: (v) => {
    const prev = get();
    if (prev.isTouchEnabled === v) return; // no-op guard: don't spend a history slot on a redundant call
    const base: Partial<BuilderState> = { isTouchEnabled: v, isDirty: true, future: [] };
    if (!prev.activeTransaction) base.past = [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT);
    set(base as BuilderState);
  },
  setIdleResetMs: (n) => {
    const prev = get();
    const clamped = Math.max(5000, Math.min(600000, n));
    if (prev.idleResetMs === clamped) return;
    const base: Partial<BuilderState> = { idleResetMs: clamped, isDirty: true, future: [] };
    if (!prev.activeTransaction) base.past = [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT);
    set(base as BuilderState);
  },

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

  setZoneWidget: (id, widgetType, variantId, variantConfig) => {
    const prev = get();
    const zone = prev.zones.find((z) => z.id === id);
    if (!zone) return;
    const canonical = canonicalWidgetType(widgetType);
    const isTouchTile = widgetType.startsWith('TOUCH_');
    // The zone's NAME is the operator's if they renamed it; auto-generated
    // names ("Clock 3", and the seeded placeholder) must follow the widget or
    // the layers panel ends up labelling a photo "Clock 3" forever.
    const autoName = `${widgetLabel(zone.widgetType)} `;
    const looksAuto =
      zone.widgetType === 'EMPTY' ||
      !zone.name ||
      new RegExp(`^${autoName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\d+$`).test(zone.name);
    const index = prev.zones.findIndex((z) => z.id === id) + 1;
    const zones = prev.zones.map((z) =>
      z.id === id
        ? clampZone({
            ...z,
            widgetType: canonical,
            name: looksAuto ? `${widgetLabel(canonical)} ${index}` : z.name,
            // The SAME seeds addZone uses, then the variant's own config, then
            // the variant id last so it can never be shadowed.
            defaultConfig: {
              ...seedDefaultConfig(widgetType),
              ...(variantConfig || {}),
              ...(variantId ? { variant: variantId } : {}),
            },
          })
        : z,
    );
    set({
      zones,
      past: [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT),
      future: [],
      isDirty: true,
      selectedIds: [id],
      // Filling the seeded placeholder keeps the SAME zone id, so without
      // this the left rail never opened the editor for the operator's very
      // first widget. See selectionEpoch.
      selectionEpoch: prev.selectionEpoch + 1,
      activeFieldName: null,
      ...(isTouchTile && !prev.isTouchEnabled ? { isTouchEnabled: true } : {}),
    });
  },

  setScenes: (scenes) => {
    const state = get();
    const prev = state.activeSceneId;
    const stillThere = prev && scenes.find((s) => s.id === prev);
    const fallback = scenes.find((s) => s.isDefault) || scenes[0] || null;
    // Codex T04 (2026-09-13): `null` is the operator's EXPLICIT "Shared" view —
    // a refetch must not bounce them to the default scene. Only a selected
    // scene that no longer exists falls back.
    const activeSceneId = prev === null ? null : stillThere ? prev : (fallback?.id ?? null);
    // A deleted scene's zones: the API re-homes SAVED ones to the default scene;
    // do the same for the local copies (including unsaved ones) so nothing is
    // sent with a dead sceneId or vanishes from every view. Reconciliation, not
    // an edit: no history entry; dirty only if something actually moved.
    const known = new Set(scenes.map((s) => s.id));
    let moved = 0;
    const zones = state.zones.map((z) => {
      if (z.sceneId && !known.has(z.sceneId)) { moved += 1; return { ...z, sceneId: fallback?.id ?? null }; }
      return z;
    });
    set(moved > 0 ? { scenes, activeSceneId, zones, isDirty: true } : { scenes, activeSceneId });
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

  markClean: (rev) => {
    if (rev !== undefined && get().editRev !== rev) return; // edits landed after that save started
    set({ isDirty: false });
  },

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
    const canonical = canonicalWidgetType(widgetType);
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
      widgetType: canonical,
      x,
      y,
      width: finalW,
      height: finalH,
      zIndex: zones.reduce((m, z) => Math.max(m, z.zIndex), 0) + 1,
      sortOrder: zones.length,
      defaultConfig: seedDefaultConfig(widgetType),
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
  // by hand is fiddly. This action clears the zones on the slice being
  // edited and lays out N zones at preset positions. Each zone defaults to IMAGE
  // (operator can swap widget type via Properties panel or by
  // dragging a different widget into the zone). Mirrors the "split
  // screen" wizard pattern in Yodeck / Rise Vision / OptiSigns.
  //
  // rects are in template-percentage space (0-100, top-left origin).
  //
  // M0-6 (2026-09-12) — scene-aware. Before this, applyLayout wiped
  // `zones` wholesale and created replacements with NO sceneId, so on a
  // multi-scene touch kiosk one Quick Layout deleted every other scene's
  // content AND left the new zones shared-across-every-scene. Both halves
  // are fixed by `layoutReplacementTargets` (see its doc comment): only
  // the slice the operator is editing is replaced, and the new zones join
  // that slice — exactly like `addZone` already does.
  applyLayout: (rects, defaultWidgetType = 'IMAGE') => {
    const prev = get();
    const past = [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT);
    const activeSceneId = prev.activeSceneId;
    const doomed = new Set(
      layoutReplacementTargets(prev.zones, prev.scenes.length, activeSceneId).map((z) => z.id),
    );
    const kept = prev.zones.filter((z) => !doomed.has(z.id));
    // Stack the new zones ABOVE whatever survived rather than restarting at
    // 1 — a kept SHARED zone (a logo) renders on the active scene alongside
    // them, so colliding zIndex/sortOrder would make the stacking order
    // ambiguous. With nothing kept (the single-scene path) this is exactly
    // the old `i + 1` / `i`.
    const baseZ = kept.reduce((m, z) => Math.max(m, z.zIndex), 0);
    const baseOrder = kept.length;
    const next: Zone[] = rects.map((r, i) => clampZone({
      id: crypto.randomUUID(),
      name: `Zone ${i + 1}`,
      widgetType: defaultWidgetType,
      x: r.x, y: r.y, width: r.width, height: r.height,
      zIndex: baseZ + i + 1,
      sortOrder: baseOrder + i,
      defaultConfig: {},
      sceneId: activeSceneId,
    }));
    set({ zones: [...kept, ...next], past, future: [], selectedIds: next.length ? [next[0].id] : [], isDirty: true });
  },

  duplicateZone: (id) => {
    const prev = get();
    const original = prev.zones.find(z => z.id === id);
    if (!original) return null;
    const newId = crypto.randomUUID();
    // A4 — respect an open transaction: alt-drag-duplicate wraps N
    // duplicateZone calls (one per selected zone) in a single
    // beginTransaction so the whole gesture is ONE undo step. Outside a
    // transaction (Cmd-D, bottom-bar button, context menu) each call
    // pushes its own snapshot exactly as before.
    const past = prev.activeTransaction
      ? prev.past
      : [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT);
    const dup: Zone = clampZone({
      ...original,
      id: newId,
      name: `${original.name} copy`,
      x: original.x + 2,
      y: original.y + 2,
      zIndex: original.zIndex + 1,
      sortOrder: get().zones.length,
      // M0-7 (2026-09-12) — the COPY always lands unlocked, even when its
      // source was locked. `...original` used to carry the flag through, which
      // was harmless while the lock enforced nothing; now it would hand the
      // operator a brand-new zone at +2/+2 that refuses to move. Matches what
      // pasteClipboard already does for ⌘V, so ⌘D and ⌘V agree.
      locked: false,
    });
    set({ zones: [...get().zones, dup], past, future: [], selectedIds: [newId], isDirty: true });
    return newId;
  },

  // M0-7 (2026-09-12) — a LOCKED zone is not deletable.
  //
  // This is the choke point every delete affordance funnels through (Del /
  // Backspace, the right-click menu, the layers-panel trash, the bottom
  // bar), so the filter lives HERE rather than at four call sites — the
  // reported bug was "marquee-select-all, press Delete, the locked zone
  // goes with everything else", and a per-call-site fix leaves the next
  // delete path someone adds unprotected.
  removeSelected: () => {
    const { selectedIds, zones } = get();
    if (selectedIds.length === 0) return;
    const selected = new Set(selectedIds);
    const doomed = new Set(zones.filter(z => selected.has(z.id) && !z.locked).map(z => z.id));
    const filtered = zones.filter(z => !doomed.has(z.id));
    // Nothing actually removed (empty selection of survivors, or every
    // selected zone is locked) — no history entry, no isDirty, no selection
    // change. A Delete that deletes nothing must not cost an undo step.
    if (filtered.length === zones.length) return;
    const past = [...get().past, snapshot(get())].slice(-HISTORY_LIMIT);
    set({
      zones: filtered,
      past,
      future: [],
      // Keep the locked survivors selected so the operator can SEE what
      // refused to go (and reach the Unlock control on it). With nothing
      // locked this is `[]` — byte-identical to the previous behaviour.
      selectedIds: selectedIds.filter(id => !doomed.has(id)),
      isDirty: true,
    });
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

  // M0-7 (2026-09-12) — a LOCKED zone is not movable or resizable.
  //
  // Every BULK geometry gesture routes through here: multi-selection drag
  // and group resize (BuilderCanvas), arrow-key nudge (BuilderShell), the
  // multi-select Align row and Distribute H/V (PropertiesPanel). Each one
  // hands us a patch of x/y/width/height, and applyBulkPatch drops exactly
  // those keys for a locked zone while letting CONTENT bulk ops through
  // untouched — brand-apply, paste-style, chat-to-edit and the POS /
  // custom-data auto-map all patch `defaultConfig`, and a lock is not a
  // reason to leave one widget off-brand.
  updateZones: (ids, patcher, commit = false) => {
    const prev = get();
    const idSet = new Set(ids);
    const zones = prev.zones.map(z => idSet.has(z.id) ? applyBulkPatch(z, patcher(z)) : z);
    // M0-7 — a bulk edit that changed NOTHING (every targeted zone was
    // locked and the patch was pure geometry) must not dirty the template,
    // burn a history slot, or clear the redo stack. applyBulkPatch returns
    // the same object identity in exactly that case; every real edit goes
    // through clampZone and therefore yields a fresh object, so this can
    // only ever short-circuit a true no-op.
    if (zones.every((z, i) => z === prev.zones[i])) return;
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

  select: (ids, additive = false, opts) => {
    const selectionSource = opts?.source ?? 'canvas';
    if (ids === null) {
      set({ selectedIds: [], activeFieldName: null, selectionSource });
      return;
    }
    const arr = Array.isArray(ids) ? ids : [ids];
    if (additive) {
      const curr = new Set(get().selectedIds);
      arr.forEach(id => curr.has(id) ? curr.delete(id) : curr.add(id));
      set({ selectedIds: Array.from(curr), selectionEpoch: get().selectionEpoch + 1, selectionSource });
    } else {
      // A re-click on the already-selected zone bumps the epoch so the editor
      // re-opens (see selectionEpoch); the active field survives it.
      const prev = get().selectedIds;
      const sameSelection = prev.length === arr.length && prev.every((id) => arr.includes(id));
      set({
        selectedIds: arr,
        selectionEpoch: get().selectionEpoch + 1,
        selectionSource,
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
    const idx = prev.zones.findIndex(z => z.id === id);
    if (idx === -1) return;
    // 2026-09-13 (Codex T03) — "Bring forward" used to be zIndex + 1: bringing a
    // zone at 1 forward past one at 2 produced TWO zones at 2, and which one the
    // browser painted on top then depended on DOM order. Reorder against the
    // actual neighbouring stack entry instead, then normalise every zIndex to
    // its stacking position so ties can never come back. Stacking order =
    // zIndex ascending, array order as the stable tie-breaker.
    const order = prev.zones.map((z, i) => ({ z, i })).sort((a, b) => (a.z.zIndex - b.z.zIndex) || (a.i - b.i));
    const pos = order.findIndex(o => o.z.id === id);
    let target = pos;
    if (dir === 'up') target = Math.min(order.length - 1, pos + 1);
    else if (dir === 'down') target = Math.max(0, pos - 1);
    else if (dir === 'top') target = order.length - 1;
    else if (dir === 'bottom') target = 0;
    if (target === pos) return; // already there: no history entry, nothing dirtied
    const [moved] = order.splice(pos, 1);
    order.splice(target, 0, moved);
    const rank = new Map(order.map((o, r) => [o.z.id, r]));
    const past = [...prev.past, snapshot(prev)].slice(-HISTORY_LIMIT);
    const zones = prev.zones.map(z => (z.zIndex === rank.get(z.id) ? z : { ...z, zIndex: rank.get(z.id) as number }));
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
      // C4 — restore the touch scalars from the snapshot. `??` falls
      // back to the CURRENT value (not a hardcoded default) so a
      // snapshot taken before this field existed is a true no-op for
      // these two keys rather than silently resetting them.
      isTouchEnabled: top.isTouchEnabled ?? prev.isTouchEnabled,
      idleResetMs: top.idleResetMs ?? prev.idleResetMs,
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
      isTouchEnabled: top.isTouchEnabled ?? prev.isTouchEnabled,
      idleResetMs: top.idleResetMs ?? prev.idleResetMs,
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
      isTouchEnabled: top.isTouchEnabled ?? prev.isTouchEnabled,
      idleResetMs: top.idleResetMs ?? prev.idleResetMs,
      past: prev.past.slice(0, -1),
      activeTransaction: false,
    });
  },

  setServerUpdatedAt: (updatedAt) => set({ serverUpdatedAt: updatedAt }),
});
});
