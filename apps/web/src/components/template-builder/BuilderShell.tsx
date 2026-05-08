"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Plus, Layers, Settings2, Keyboard, Undo2, Redo2, ZoomIn, ZoomOut, Grid3x3, Magnet, Ruler,
  Palette, Image as ImageIcon, X, Paintbrush,
  Copy, Lock, Unlock, ChevronUp, ChevronDown, Trash2,
  AlignLeft, AlignCenter, AlignRight,
  Bold, Italic, Underline, Strikethrough,
  RefreshCw, Maximize2, Clock, Thermometer, Gauge, Calendar, Globe, MousePointer,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AssetLibraryModal, measureZoneFontSize } from './PropertiesPanel';
import { DndContext, DragOverlay, DragEndEvent, pointerWithin } from '@dnd-kit/core';
import { getZoneColor } from './constants';
import { useBuilderStore } from './useBuilderStore';
import { BuilderToolbar } from './BuilderToolbar';
import { BuilderCanvas } from './BuilderCanvas';
import { WidgetPalette } from './WidgetPalette';
import { VariantPicker } from './VariantPicker';
import { LayersPanel } from './LayersPanel';
import { PropertiesPanel, CanvasBackdropSection } from './PropertiesPanel';
import { BrandKitPanel } from './BrandKitPanel';
import { BackgroundPanel } from './BackgroundPanel';
import { TopContextToolbar } from './TopContextToolbar';
import { useUpdateTemplate, useUpdateTemplateZones, useCreateTemplate, useDeleteTemplate } from '@/hooks/use-api';
import { appConfirm, appPrompt } from '@/components/ui/app-dialog';
import type { Template, Zone } from './types';

interface Props {
  template: Template;
  onBack: () => void;
  onSaved: (t: Template) => void;
}

type PanelKey = 'widgets' | 'background' | 'layers' | 'properties' | 'brand';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const AUTO_SAVE_IDLE_MS = 15_000;

export function BuilderShell({ template, onBack, onSaved }: Props) {
  // Atomic selectors (per-key) — destructuring subscribes the whole
  // BuilderShell to the entire store, so every zone tweak in the
  // canvas re-renders this 500+ line shell. Zustand action refs are
  // stable; state slices tracked individually only re-render when
  // the specific slice actually changes.
  const init = useBuilderStore((s) => s.init);
  const selectedIds = useBuilderStore((s) => s.selectedIds);
  const isDirty = useBuilderStore((s) => s.isDirty);
  const previewMode = useBuilderStore((s) => s.previewMode);
  const updateZones = useBuilderStore((s) => s.updateZones);
  const removeSelected = useBuilderStore((s) => s.removeSelected);
  const duplicateZone = useBuilderStore((s) => s.duplicateZone);
  const select = useBuilderStore((s) => s.select);
  const undo = useBuilderStore((s) => s.undo);
  const redo = useBuilderStore((s) => s.redo);
  const markClean = useBuilderStore((s) => s.markClean);
  const addZone = useBuilderStore((s) => s.addZone);
  const [panel, setPanel] = useState<PanelKey>('widgets');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string>();
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [clipboard, setClipboard] = useState<Zone[] | null>(null);
  const [activeDragType, setActiveDragType] = useState<string | null>(null);

  const router = useRouter();
  const routeParams = useParams<{ schoolId: string }>();

  const updateTemplate = useUpdateTemplate();
  const updateZonesApi = useUpdateTemplateZones();
  const createTemplate = useCreateTemplate();
  const deleteTemplate = useDeleteTemplate();

  useEffect(() => {
    init({
      id: template.id,
      isSystem: !!template.isSystem,
      zones: (template.zones || []).map(z => ({
        id: z.id || crypto.randomUUID(),
        name: z.name,
        widgetType: z.widgetType,
        x: z.x,
        y: z.y,
        width: z.width,
        height: z.height,
        zIndex: z.zIndex ?? 0,
        sortOrder: z.sortOrder ?? 0,
        defaultConfig: z.defaultConfig,
        locked: false,
      })),
      meta: {
        name: template.name,
        description: template.description || '',
        screenWidth: template.screenWidth,
        screenHeight: template.screenHeight,
        bgColor: template.bgColor || '',
        bgGradient: template.bgGradient || '',
        bgImage: template.bgImage || '',
      },
    });
  }, [template, init]);

  useEffect(() => {
    return useBuilderStore.subscribe((state, prev) => {
      // 2026-05-03 — operator: "When I select a widget on the canvas it
      // should take me to Properties on the left toolbar automatically."
      // Old condition only fired on 0 → N transitions, so clicking a
      // *different* zone (N → N) didn't reopen the properties panel
      // when the operator was on Widgets / Layers / Brand. Now: any
      // change in the selected-zone identity that lands on a non-empty
      // selection switches to Properties. Compare by joined id-list so
      // toggling between two zones still triggers the switch.
      const nowKey = state.selectedIds.join(',');
      const prevKey = prev.selectedIds.join(',');
      if (state.selectedIds.length > 0 && nowKey !== prevKey) {
        setPanel('properties');
      }
    });
  }, []);

  const handleSave = useCallback(async () => {
    setSaveStatus('saving');
    setSaveError(undefined);
    try {
      const state = useBuilderStore.getState();
      const orientation = state.meta.screenHeight > state.meta.screenWidth ? 'PORTRAIT' : 'LANDSCAPE';
      await updateTemplate.mutateAsync({
        id: template.id,
        name: state.meta.name,
        description: state.meta.description || undefined,
        orientation,
        screenWidth: state.meta.screenWidth,
        screenHeight: state.meta.screenHeight,
        bgColor: state.meta.bgColor || null,
        bgGradient: state.meta.bgGradient || null,
        bgImage: state.meta.bgImage || null,
      });
      const result = await updateZonesApi.mutateAsync({
        id: template.id,
        zones: state.zones.map((z, i) => ({
          name: z.name,
          widgetType: z.widgetType,
          x: Math.round(z.x * 100) / 100,
          y: Math.round(z.y * 100) / 100,
          width: Math.round(z.width * 100) / 100,
          height: Math.round(z.height * 100) / 100,
          zIndex: z.zIndex,
          sortOrder: i,
          defaultConfig: z.defaultConfig,
        })),
      });
      markClean();
      setSaveStatus('saved');
      setLastSavedAt(Date.now());
      onSaved(result);
      setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 2500);
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [template.id, updateTemplate, updateZonesApi, markClean, onSaved]);

  const handleSaveAs = useCallback(async () => {
    const state = useBuilderStore.getState();
    const defaultName = `${state.meta.name || 'Untitled template'} copy`;
    const name = await appPrompt({
      title: 'Save as copy',
      message: 'What should we call this copy?',
      defaultValue: defaultName,
      confirmLabel: 'Create copy',
    });
    if (!name || !name.trim()) return;

    setSaveStatus('saving');
    setSaveError(undefined);
    try {
      const orientation = state.meta.screenHeight > state.meta.screenWidth ? 'PORTRAIT' : 'LANDSCAPE';
      const created = await createTemplate.mutateAsync({
        name: name.trim(),
        description: state.meta.description || undefined,
        orientation,
        screenWidth: state.meta.screenWidth,
        screenHeight: state.meta.screenHeight,
        zones: state.zones.map((z, i) => ({
          name: z.name,
          widgetType: z.widgetType,
          x: Math.round(z.x * 100) / 100,
          y: Math.round(z.y * 100) / 100,
          width: Math.round(z.width * 100) / 100,
          height: Math.round(z.height * 100) / 100,
          zIndex: z.zIndex,
          sortOrder: i,
          defaultConfig: z.defaultConfig,
        })),
      });
      const newId = (created as { id?: string })?.id;
      if (newId && (state.meta.bgColor || state.meta.bgGradient || state.meta.bgImage)) {
        await updateTemplate.mutateAsync({
          id: newId,
          bgColor: state.meta.bgColor || null,
          bgGradient: state.meta.bgGradient || null,
          bgImage: state.meta.bgImage || null,
        });
      }
      setSaveStatus('saved');
      setLastSavedAt(Date.now());
      setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 2500);

      const schoolId = routeParams?.schoolId;
      if (newId && schoolId) {
        router.push(`/${schoolId}/templates/builder/${newId}`);
      }
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [createTemplate, updateTemplate, router, routeParams]);

  const handleSaveRef = useRef(handleSave);
  const saveStatusRef = useRef(saveStatus);
  useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);
  useEffect(() => { saveStatusRef.current = saveStatus; }, [saveStatus]);

  // Auto-save was making changes "stick" without an explicit Save action — confusing
  // because the user expects nothing to persist until they click Save. Disabled.
  // (Keeping the constant + scaffolding in case we add a per-template opt-in later.)

  const handleBack = useCallback(async () => {
    // System presets open in draft mode — nothing is persisted to the
    // preset itself, so "unsaved changes" is misleading (there's
    // nothing to save, only Save-as-copy). Skip the prompt for system
    // presets so Back exits silently. For custom templates, the prompt
    // still protects real in-progress edits.
    if (template.isSystem) { onBack(); return; }
    if (isDirty) {
      const ok = await appConfirm({
        title: 'Unsaved changes',
        message: 'You have unsaved changes. Leave without saving?',
        tone: 'warn',
        confirmLabel: 'Leave',
        cancelLabel: 'Keep editing',
      });
      if (!ok) return;
      // Operator (2026-04-28): "still getting windows pop ups, ours
      // pops first and then windows pops a second time on the same
      // exit." Cause: the native browser `beforeunload` handler
      // below fires unconditionally on isDirty, so Chrome shows its
      // own ugly "Leave site?" dialog AFTER our appConfirm. Mark the
      // store clean before navigating so beforeunload's guard turns
      // off — the user already explicitly confirmed they want to
      // leave via our themed dialog.
      markClean();
    }
    onBack();
  }, [isDirty, onBack, template.isSystem, markClean]);

  const handleDiscard = useCallback(async () => {
    if (template.isSystem) { onBack(); return; } // system presets aren't deletable
    const ok = await appConfirm({
      title: 'Discard this template?',
      message: `"${template.name}" will be permanently deleted. This can't be undone.`,
      tone: 'danger',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    // Same fix as handleBack — mark clean BEFORE navigating so
    // Chrome's native beforeunload doesn't pop a second "Leave site?"
    // dialog on top of our themed Discard confirm.
    markClean();
    try {
      await deleteTemplate.mutateAsync(template.id);
    } catch (err) {
      console.error('discard failed', err);
    }
    onBack();
  }, [template.id, template.name, template.isSystem, deleteTemplate, onBack, markClean]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName) || t?.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (e.shiftKey) handleSaveAs();
        else handleSave();
        return;
      }

      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (inInput) return;
        e.preventDefault();
        undo();
        return;
      }

      if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        if (inInput) return;
        e.preventDefault();
        redo();
        return;
      }

      if (inInput) return;

      // `?` (existing) AND Cmd/Ctrl+/ (Canva-standard) both toggle
      // the shortcuts modal. Cmd+/ is the discoverable form because
      // operators expect it from every modern design tool.
      if ((e.key === '?' && !mod) || (mod && e.key === '/')) {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }

      if (e.key === 'Escape') {
        if (showShortcuts) { setShowShortcuts(false); return; }
        select(null);
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        e.preventDefault();
        removeSelected();
        return;
      }

      if (mod && e.key.toLowerCase() === 'd' && selectedIds.length > 0) {
        e.preventDefault();
        selectedIds.forEach(id => duplicateZone(id));
        return;
      }

      if (mod && e.key.toLowerCase() === 'c' && selectedIds.length > 0) {
        e.preventDefault();
        const state = useBuilderStore.getState();
        setClipboard(state.zones.filter(z => selectedIds.includes(z.id)).map(z => ({ ...z })));
        return;
      }

      if (mod && e.key.toLowerCase() === 'v' && clipboard && clipboard.length > 0) {
        e.preventDefault();
        const newIds: string[] = [];
        const state = useBuilderStore.getState();
        state.beginTransaction();
        for (const src of clipboard) {
          const nid = crypto.randomUUID();
          newIds.push(nid);
          useBuilderStore.setState((s) => ({
            zones: [...s.zones, {
              ...src,
              id: nid,
              name: `${src.name} copy`,
              x: Math.min(95, src.x + 3),
              y: Math.min(95, src.y + 3),
              zIndex: s.zones.reduce((m, z) => Math.max(m, z.zIndex), 0) + 1,
              sortOrder: s.zones.length,
              locked: false,
            }],
            isDirty: true,
          }));
        }
        select(newIds);
        return;
      }

      if (selectedIds.length > 0 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : (e.altKey ? 0.1 : 1);
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const state = useBuilderStore.getState();
        state.beginTransaction();
        updateZones(selectedIds, (z) => ({ x: z.x + dx, y: z.y + dy }));
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedIds, clipboard, undo, redo, select, removeSelected, duplicateZone, updateZones, handleSave, handleSaveAs, showShortcuts]);

  useEffect(() => {
    // beforeunload is the LAST line of defence against losing unsaved
    // edits when the operator hits ⌘R / F5 / closes the tab. Browsers
    // intentionally hardcode the dialog message ("Leave site? Changes
    // you made may not be saved") for security — we cannot replace it
    // with our themed AppDialog. Every OTHER confirm/alert in the app
    // uses appConfirm/appAlert; this one's the documented exception.
    //
    // Auto-save is disabled, so this prompt protects any explicit-save
    // work when the operator refreshes or closes the tab. To keep the
    // surface area tight we ALSO skip when previewMode is on (no edits
    // are happening) and when isSystem (system presets aren't editable
    // — anything they typed is in a draft copy that opens elsewhere).
    if (template.isSystem || previewMode) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty, template.isSystem, previewMode]);

  const panels: Array<{ key: PanelKey; label: string; icon: LucideIcon }> = [
    { key: 'widgets', label: 'Widgets', icon: Plus },
    { key: 'background', label: 'Background', icon: Paintbrush },
    { key: 'layers', label: 'Layers', icon: Layers },
    { key: 'properties', label: 'Properties', icon: Settings2 },
    { key: 'brand', label: 'Brand', icon: Palette },
  ];

  const handleDragStart = (event: any) => {
    const { active } = event;
    if (active.data.current?.type === 'widget-palette-item' || active.data.current?.type === 'variant-tile') {
      setActiveDragType(active.data.current.widgetType);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { over, active } = event;
    setActiveDragType(null);
    if (over && over.id === 'builder-canvas') {
      const type = active.data.current?.widgetType;
      if (!type) return;

      const isVariantTile = active.data.current?.type === 'variant-tile';
      const variantId = active.data.current?.variantId as string | undefined;
      const variantConfig = (active.data.current?.defaultConfig || {}) as Record<string, any>;

      // 2026-05-03 — operator: "one widget overwrites the next 6 widgets
      // in the same category." The previous code ran a SWAP path here:
      // when a single zone was selected and a variant-tile was dragged,
      // the selected zone's variant got REPLACED — regardless of where
      // the drop landed on the canvas. Result: clicking through six
      // bell-schedule variants in a row overwrote the same zone six
      // times instead of creating six separate zones, because addZone
      // auto-selects the most recent zone (so EVERY follow-up tile
      // qualified as a "swap target").
      //
      // The original "drag X onto Y → Y takes X's style" partner
      // request never actually checked whether the drop fell inside Y.
      // The Properties panel's "Widget Theme" dropdown is the right
      // surface for swapping a zone's look. Both DRAG and CLICK from
      // the picker are now pure ADD gestures so the behavior is
      // predictable: tap a tile, get a new zone. Period.

      // ADD path — resolve the drop point to template-percentage space
      // (0-100) so the new zone CENTERS on the cursor instead of
      // stacking at the default 10,10. dnd-kit gives us the active
      // rect (where the dragged ghost ended) + the over rect (the
      // canvas's bounding box). Center of the active rect, expressed
      // as a percentage of the canvas, is the drop coordinate.
      let dropAt: { x: number; y: number } | undefined;
      const rect: any = (event as any).active?.rect?.current?.translated || (event as any).active?.rect?.current?.initial;
      const overRect: any = (event as any).over?.rect;
      if (rect && overRect && overRect.width > 0 && overRect.height > 0) {
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        dropAt = {
          x: ((cx - overRect.left) / overRect.width) * 100,
          y: ((cy - overRect.top) / overRect.height) * 100,
        };
      }
      const id = addZone(type, dropAt);
      // If dragged from the variant picker (no swap target), also seed
      // the variant + its defaultConfig on the new zone.
      if (isVariantTile && variantId) {
        useBuilderStore.getState().updateZone(id, {
          defaultConfig: { ...variantConfig, variant: variantId },
        });
      }
    }
  };

  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="fixed inset-0 bg-slate-50 z-[999] flex flex-col font-sans text-slate-800 selection:bg-indigo-500/30">
      <BuilderToolbar
        onBack={handleBack}
        onSave={handleSave}
        onSaveAs={handleSaveAs}
        onDiscard={template.isSystem ? undefined : handleDiscard}
        saveStatus={saveStatus}
        saveError={saveError}
        lastSavedAt={lastSavedAt}
      />

      <div className="flex flex-1 overflow-hidden relative">
        {/* Abstract background blobs for premium feel */}
        <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-indigo-200/20 blur-[120px]" />
          <div className="absolute top-[60%] -right-[10%] w-[40%] h-[60%] rounded-full bg-sky-200/20 blur-[100px]" />
        </div>

        {!previewMode && (
          <aside className="w-[420px] bg-white/70 backdrop-blur-2xl border-r border-slate-200/50 flex flex-col shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-10" aria-label="Builder tools">
            <div className="flex p-2 gap-1 border-b border-slate-200/50 bg-white/40" role="tablist" aria-label="Panel">
              {panels.map(tab => {
                const Icon = tab.icon;
                const active = panel === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setPanel(tab.key)}
                    className={`flex-1 py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-wider flex flex-col items-center gap-1.5 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                      active ? 'text-indigo-600 bg-white shadow-sm ring-1 ring-slate-200/50' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50/50'
                    }`}
                  >
                    <Icon className="w-4 h-4" aria-hidden />
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <div className="flex-1 overflow-y-auto" role="tabpanel">
              {panel === 'widgets' && <VariantPicker />}
              {panel === 'background' && <BackgroundPanel />}
              {panel === 'layers' && <LayersPanel />}
              {panel === 'properties' && <PropertiesPanel />}
              {panel === 'brand' && <BrandKitPanel />}
            </div>
            <div className="border-t border-slate-100 p-2">
              <button
                type="button"
                onClick={() => setShowShortcuts(true)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[10px] font-semibold text-slate-500 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <Keyboard className="w-3 h-3" aria-hidden />
                Keyboard shortcuts (press <kbd className="px-1 rounded bg-slate-100 font-mono text-[10px]">?</kbd>)
              </button>
            </div>
          </aside>
        )}

        {/* Canvas column: contextual toolbar on top + canvas underneath.
            Wrapping in a flex column keeps the canvas's existing
            scroll behaviour intact.
            2026-04-29 — `relative` so BuilderBottomBar can position
            itself absolute-centered within THIS column (not the
            entire viewport). Operator: "can you center the tool bar
            on the canvas an not on the entire page?" */}
        <div className="flex flex-col flex-1 min-w-0 relative">
          <TopContextToolbar />
          <BuilderCanvas />
          {!previewMode && <BuilderBottomBar />}
        </div>
      </div>

      <DragOverlay dropAnimation={{ duration: 250, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
        {activeDragType ? (
           <div className="w-48 h-32 rounded-xl border-2 border-indigo-500 bg-indigo-50/90 backdrop-blur-md shadow-2xl flex items-center justify-center rotate-3 scale-105">
             <div className="text-indigo-600 font-bold uppercase tracking-widest text-xs flex items-center gap-2">
                <Plus className="w-4 h-4" /> Drop to Add
             </div>
           </div>
        ) : null}
      </DragOverlay>

      {/* Bottom bar moved INSIDE the canvas column above (line ~542)
          so it centers over the canvas instead of the viewport.
          Operator (2026-04-29): "center the tool bar on the canvas
          an not on the entire page". */}

      {/* Discoverable "?" floating button in bottom-right of viewport.
          Without this the only way to find the shortcut sheet was to
          guess `?` or Cmd+/ — Canva surfaces a similar pill in the
          same corner. Hidden in previewMode so demo screenshots stay
          clean. */}
      {!previewMode && (
        <button
          type="button"
          onClick={() => setShowShortcuts(true)}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?  or  Ctrl/⌘ + /)"
          className="fixed bottom-4 right-4 z-40 w-10 h-10 rounded-full bg-white text-slate-600 hover:text-indigo-600 shadow-lg border border-slate-200 hover:border-indigo-300 transition-colors flex items-center justify-center font-bold text-sm"
        >
          ?
        </button>
      )}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
    </DndContext>
  );
}

// Curated font list for the bottom bar's compact font <select>.
const BOTTOM_BAR_FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins',
  'Oswald', 'Raleway', 'Nunito', 'Source Sans Pro', 'Playfair Display',
  'Merriweather', 'Bebas Neue', 'Caveat', 'Pacifico',
  'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New',
];

/** Unified bottom bar — zone-context controls (left) + zoom / undo /
 *  view toggles (right). Replaces FloatingZoneActions + the old
 *  canvas-controls bar. Operator request 2026-04-27. */
function BuilderBottomBar() {
  // ── Canvas controls ──────────────────────────────────────────────
  const zoom         = useBuilderStore((s) => s.zoom);
  const setZoom      = useBuilderStore((s) => s.setZoom);
  const past         = useBuilderStore((s) => s.past);
  const future       = useBuilderStore((s) => s.future);
  const undo         = useBuilderStore((s) => s.undo);
  const redo         = useBuilderStore((s) => s.redo);
  const showGrid     = useBuilderStore((s) => s.showGrid);
  const setShowGrid  = useBuilderStore((s) => s.setShowGrid);
  const snapEnabled  = useBuilderStore((s) => s.snapEnabled);
  const setSnap      = useBuilderStore((s) => s.setSnapEnabled);
  const showGuides   = useBuilderStore((s) => s.showGuides);
  const setGuides    = useBuilderStore((s) => s.setShowGuides);
  const meta         = useBuilderStore((s) => s.meta);
  const setMeta      = useBuilderStore((s) => s.setMeta);

  // ── Zone-context controls ────────────────────────────────────────
  const zones          = useBuilderStore((s) => s.zones);
  const selectedIds    = useBuilderStore((s) => s.selectedIds);
  const updateZone     = useBuilderStore((s) => s.updateZone);
  const duplicateZone  = useBuilderStore((s) => s.duplicateZone);
  const removeSelected = useBuilderStore((s) => s.removeSelected);
  const toggleLock     = useBuilderStore((s) => s.toggleLock);
  const moveLayer      = useBuilderStore((s) => s.moveLayer);

  const [backdropOpen, setBackdropOpen] = useState(false);
  const [urlOpen,      setUrlOpen]      = useState(false);
  const [dateOpen,     setDateOpen]     = useState(false);
  const [assetOpen,    setAssetOpen]    = useState(false);

  // Close all popovers on Escape
  useEffect(() => {
    if (!backdropOpen && !urlOpen && !dateOpen && !assetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setBackdropOpen(false); setUrlOpen(false);
        setDateOpen(false); setAssetOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [backdropOpen, urlOpen, dateOpen, assetOpen]);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;
  const zoomPct = Math.round(zoom * 100);

  // Single-selected zone — zone-context section only shown for single-select
  const selectedZone = selectedIds.length === 1
    ? zones.find((z) => z.id === selectedIds[0]) ?? null
    : null;

  const cfg = (selectedZone?.defaultConfig || {}) as Record<string, any>;
  const setCfg = (patch: Record<string, any>) => {
    if (!selectedZone) return;
    updateZone(selectedZone.id, { defaultConfig: { ...cfg, ...patch } }, true);
  };

  const wt         = selectedZone?.widgetType ?? '';
  const isText      = wt === 'TEXT' || wt === 'RICH_TEXT';
  const isImage     = wt === 'IMAGE' || wt === 'IMAGE_CAROUSEL' || wt === 'LOGO';
  const isClock     = wt === 'CLOCK';
  const isWeather   = wt === 'WEATHER';
  const isTicker    = wt === 'TICKER';
  const isCountdown = wt === 'COUNTDOWN';
  const isWebpage   = wt === 'WEBPAGE';
  // 2026-05-02 — operator: "Toolbar font/size/color controls for
  // welcome message + ticker missing." TICKER takes the standard text-
  // style block cleanly because BuilderZone injects a `!important`
  // CSS rule scoped by `[data-zone-id]` for cfg.fontFamily / fontSize /
  // color (apps/web/src/components/template-builder/BuilderZone.tsx
  // ~line 430). The injection is a no-op for TEXT/RICH_TEXT (those
  // widgets read cfg directly), so wiring TICKER through the same UI
  // costs nothing extra.
  //
  // ANIMATED_WELCOME deliberately stays out — the widget has carefully
  // tuned per-element typography (title/subtitle/ticker/birthdays each
  // pick their own size). A blanket font-size override would collapse
  // the visual hierarchy. PropertiesPanel already exposes per-field
  // controls for those widgets.
  const isTextStyle = isText || isTicker;

  // 2026-05-08 — per-field text styling for HS widgets and any other
  // widget that supports the existing `cfg._styles[fieldKey]` schema
  // (the same one TopContextToolbar already writes to). The bottom bar
  // surfaces the same font / size / B-I-U-S / color controls and writes
  // to that single shared map; BuilderZone's CSS injection picks up
  // the changes and emits scoped `!important` rules.
  //
  // The active field is tracked two ways, kept in sync via the
  // `template-edit-field` CustomEvent that BuilderZone dispatches on
  // every canvas click of a `[data-field]`. On the panel side, the
  // `StyleableField` wrapper dispatches the same event on focus so
  // that focusing a panel input is equivalent to clicking the canvas
  // text — both light up the bottom bar.
  const storeActiveFieldName = useBuilderStore((s) => s.activeFieldName);
  const setActiveFieldName = useBuilderStore((s) => s.setActiveFieldName);

  // Listen to BuilderZone's canvas-click event so clicking text on the
  // canvas (the gold-standard Canva pattern) also flips the bottom-bar
  // target — not just panel-input focus.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { zoneId?: string; fieldKey?: string } | undefined;
      if (!detail?.fieldKey) return;
      if (selectedZone && detail.zoneId === selectedZone.id) {
        setActiveFieldName(detail.fieldKey);
      }
    };
    window.addEventListener('template-edit-field', handler);
    return () => window.removeEventListener('template-edit-field', handler);
  }, [selectedZone?.id, setActiveFieldName]);

  const activeFieldName = storeActiveFieldName;
  // Per-field UX is offered for any selected widget that already
  // supports the `_styles` schema OR is an HS template (consumes the
  // same schema once we strip the legacy __styles path). Mirrors the
  // TopContextToolbar's "any non-image" behavior.
  // TEXT / RICH_TEXT / TICKER widgets keep their existing widget-level
  // toolbar (operator's mental model: those widgets' fontSize / color
  // are top-level cfg props, not per-field overrides). Every OTHER
  // text-bearing widget (HS templates, MS templates, themed widgets,
  // animated widgets, etc.) gets the per-field path.
  const supportsPerFieldStyles = !!selectedZone && !isImage && !isTextStyle;
  const isPerFieldText = supportsPerFieldStyles && !!activeFieldName;
  const fieldStyles = (cfg._styles && typeof cfg._styles === 'object' ? cfg._styles : {}) as Record<string, any>;
  const curFieldStyle = (activeFieldName && fieldStyles[activeFieldName]) || {};
  const setFieldStyleProp = (prop: string, value: number | string | boolean | undefined) => {
    if (!selectedZone || !activeFieldName) return;
    const existing = { ...(fieldStyles[activeFieldName] || {}) };
    if (value === undefined || value === '' || value === false || (typeof value === 'number' && !Number.isFinite(value))) {
      delete existing[prop];
    } else {
      existing[prop] = value;
    }
    const nextStyles = { ...fieldStyles };
    if (Object.keys(existing).length === 0) {
      delete nextStyles[activeFieldName];
    } else {
      nextStyles[activeFieldName] = existing;
    }
    setCfg({ _styles: nextStyles });
  };
  // Read the rendered px on the focused field so the size stepper
  // anchors on the design value (280, 180, etc.) instead of falling
  // back to the global 16.
  const measureFieldFontSize = (): number | null => {
    if (!activeFieldName || typeof document === 'undefined') return null;
    const els = document.querySelectorAll<HTMLElement>(`[data-field="${activeFieldName}"]`);
    for (const el of Array.from(els)) {
      if (el.closest('[data-properties-panel]')) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (Number.isFinite(fs)) return Math.round(fs);
    }
    return null;
  };

  const measured = selectedZone ? measureZoneFontSize(selectedZone.id, null) : null;
  const sizeDisplay = cfg.fontSize ?? measured ?? '';
  // Per-field path: the size override (or the measured rendered size).
  const fieldMeasured = measureFieldFontSize();
  const fieldSizeDisplay =
    typeof curFieldStyle.fontSize === 'number' ? curFieldStyle.fontSize : (fieldMeasured ?? '');

  // ── Small btn (32px) for zone-context controls ───────────────────
  const smallBtn = (label: string, onClick: () => void, icon: React.ReactNode, danger = false, active = false) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
        danger
          ? 'text-slate-500 hover:bg-rose-50 hover:text-rose-600'
          : active
            ? 'bg-indigo-100 text-indigo-700'
            : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {icon}
    </button>
  );

  // ── Larger btn (36px) for canvas controls ────────────────────────
  const groupBtn = (on: boolean, label: string, onClick: () => void, icon: React.ReactNode, disabled = false) => (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on || undefined}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
        disabled
          ? 'text-slate-300 cursor-not-allowed'
          : on
            ? 'bg-indigo-600 text-white shadow-sm'
            : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {icon}
    </button>
  );

  // Generic zone-action cluster (Dup / Forward / Back / Lock / Delete)
  const zoneActions = selectedZone ? (
    <>
      {smallBtn('Duplicate (Ctrl/⌘+D)', () => duplicateZone(selectedZone.id), <Copy className="w-3.5 h-3.5" />)}
      {smallBtn('Bring forward', () => moveLayer(selectedZone.id, 'up'), <ChevronUp className="w-3.5 h-3.5" />)}
      {smallBtn('Send back', () => moveLayer(selectedZone.id, 'down'), <ChevronDown className="w-3.5 h-3.5" />)}
      {smallBtn(
        selectedZone.locked ? 'Unlock' : 'Lock',
        () => toggleLock(selectedZone.id),
        selectedZone.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />,
      )}
      <div className="w-px h-5 bg-slate-200 mx-0.5" />
      {smallBtn('Delete (Del)', () => removeSelected(), <Trash2 className="w-3.5 h-3.5" />, true)}
    </>
  ) : null;

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 bg-white border border-slate-200 rounded-2xl shadow-lg flex items-center gap-1 px-2 py-1.5">

      {/* ══ LEFT: zone-context section ══════════════════════════════ */}
      {selectedZone ? (
        <>
          {/* Per-field text styling — works on any non-image widget that
              supports the existing `cfg._styles[fieldKey]` schema (HS
              templates + the older themed widgets that wire data-field
              hotspots). Operator clicks the text on the canvas (or
              focuses its panel input); BuilderZone's CSS injection
              applies the resulting rules. */}
          {isPerFieldText && (
            <>
              <span className="px-2 text-[10px] font-semibold uppercase tracking-widest text-indigo-500 max-w-[140px] truncate" title={`Editing field: ${activeFieldName}`}>
                {activeFieldName}
              </span>

              <select
                aria-label="Font family"
                title="Font family"
                value={curFieldStyle.fontFamily || ''}
                onChange={(e) => setFieldStyleProp('fontFamily', e.target.value || undefined)}
                style={{ fontFamily: curFieldStyle.fontFamily || 'inherit' }}
                className="h-8 px-2 text-xs rounded-md bg-white border border-slate-200 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer min-w-[110px]"
              >
                <option value="">Default</option>
                {BOTTOM_BAR_FONTS.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                ))}
              </select>

              <div className="flex items-center ml-0.5">
                {smallBtn('Decrease size', () => {
                  const cur = (typeof curFieldStyle.fontSize === 'number' ? curFieldStyle.fontSize : fieldMeasured) || 16;
                  setFieldStyleProp('fontSize', Math.max(8, cur - 2));
                }, <span className="text-base leading-none font-semibold">−</span>)}
                <input
                  type="number"
                  aria-label="Font size"
                  title="Font size in pixels"
                  value={fieldSizeDisplay}
                  placeholder={fieldMeasured ? String(fieldMeasured) : ''}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setFieldStyleProp('fontSize', Number.isFinite(v) && v > 0 ? v : undefined);
                  }}
                  className="h-8 w-12 px-1 text-xs text-center rounded-md bg-white border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                {smallBtn('Increase size', () => {
                  const cur = (typeof curFieldStyle.fontSize === 'number' ? curFieldStyle.fontSize : fieldMeasured) || 16;
                  setFieldStyleProp('fontSize', cur + 2);
                }, <span className="text-base leading-none font-semibold">+</span>)}
              </div>

              <div className="w-px h-5 bg-slate-200 mx-0.5" />

              {smallBtn(
                'Bold (Ctrl/⌘+B)',
                () => setFieldStyleProp('bold', curFieldStyle.bold !== true),
                <Bold className="w-3.5 h-3.5" />,
                false,
                curFieldStyle.bold === true,
              )}
              {smallBtn(
                'Italic (Ctrl/⌘+I)',
                () => setFieldStyleProp('italic', curFieldStyle.italic !== true),
                <Italic className="w-3.5 h-3.5" />,
                false,
                curFieldStyle.italic === true,
              )}
              {smallBtn(
                'Underline (Ctrl/⌘+U)',
                () => setFieldStyleProp('underline', curFieldStyle.underline !== true),
                <Underline className="w-3.5 h-3.5" />,
                false,
                curFieldStyle.underline === true,
              )}
              {smallBtn(
                'Strikethrough',
                () => setFieldStyleProp('strikethrough', curFieldStyle.strikethrough !== true),
                <Strikethrough className="w-3.5 h-3.5" />,
                false,
                curFieldStyle.strikethrough === true,
              )}

              <div className="w-px h-5 bg-slate-200 mx-0.5" />

              <label className="relative w-8 h-8 rounded-md flex items-center justify-center cursor-pointer hover:bg-slate-100" title="Text color" aria-label="Text color">
                <Palette className="w-3.5 h-3.5 text-slate-600" />
                <span
                  className="absolute bottom-1 left-1.5 right-1.5 h-1 rounded-sm border border-slate-300"
                  style={{ background: curFieldStyle.color || '#1e293b' }}
                />
                <input
                  type="color"
                  value={curFieldStyle.color || '#1e293b'}
                  onChange={(e) => setFieldStyleProp('color', e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </label>

              {Object.keys(curFieldStyle).length > 0 && smallBtn(
                'Reset field overrides',
                () => {
                  if (!activeFieldName) return;
                  const next = { ...fieldStyles };
                  delete next[activeFieldName];
                  setCfg({ _styles: next });
                },
                <span className="text-[10px] font-bold">↺</span>,
                true,
              )}

              <div className="w-px h-5 bg-slate-300 mx-1" />
            </>
          )}

          {/* Selected widget but no field activated yet — hint */}
          {supportsPerFieldStyles && !activeFieldName && (
            <span className="px-3 text-[11px] italic text-slate-400 select-none whitespace-nowrap">
              Click any text on the canvas to edit its style
            </span>
          )}

          {/* TEXT / RICH_TEXT / TICKER ─── font, size, B/I/U/S, color, align */}
          {isTextStyle && (
            <>
              <select
                aria-label="Font family"
                title="Font family"
                value={cfg.fontFamily || ''}
                onChange={(e) => setCfg({ fontFamily: e.target.value })}
                style={{ fontFamily: cfg.fontFamily || 'inherit' }}
                className="h-8 px-2 text-xs rounded-md bg-white border border-slate-200 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-400 cursor-pointer min-w-[110px]"
              >
                <option value="">Theme font</option>
                {BOTTOM_BAR_FONTS.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
                ))}
              </select>

              <div className="flex items-center ml-0.5">
                {smallBtn('Decrease size', () => {
                  const cur = (typeof cfg.fontSize === 'number' ? cfg.fontSize : measured) || 16;
                  setCfg({ fontSize: Math.max(8, cur - 2) });
                }, <span className="text-base leading-none font-semibold">−</span>)}
                <input
                  type="number"
                  aria-label="Font size"
                  title="Font size in pixels"
                  value={sizeDisplay}
                  placeholder={measured ? String(measured) : ''}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    setCfg({ fontSize: Number.isFinite(v) && v > 0 ? v : undefined });
                  }}
                  className="h-8 w-12 px-1 text-xs text-center rounded-md bg-white border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                {smallBtn('Increase size', () => {
                  const cur = (typeof cfg.fontSize === 'number' ? cfg.fontSize : measured) || 16;
                  setCfg({ fontSize: cur + 2 });
                }, <span className="text-base leading-none font-semibold">+</span>)}
              </div>

              <div className="w-px h-5 bg-slate-200 mx-0.5" />

              {smallBtn('Bold (Ctrl/⌘+B)', () => setCfg({ bold: cfg.bold !== true }), <Bold className="w-3.5 h-3.5" />, false, cfg.bold === true)}
              {smallBtn('Italic (Ctrl/⌘+I)', () => setCfg({ italic: cfg.italic !== true }), <Italic className="w-3.5 h-3.5" />, false, cfg.italic === true)}
              {smallBtn('Underline (Ctrl/⌘+U)', () => setCfg({ underline: cfg.underline !== true }), <Underline className="w-3.5 h-3.5" />, false, cfg.underline === true)}
              {smallBtn('Strikethrough', () => setCfg({ strikethrough: cfg.strikethrough !== true }), <Strikethrough className="w-3.5 h-3.5" />, false, cfg.strikethrough === true)}

              <div className="w-px h-5 bg-slate-200 mx-0.5" />

              <label className="relative w-8 h-8 rounded-md flex items-center justify-center cursor-pointer hover:bg-slate-100" title="Text color" aria-label="Text color">
                <Palette className="w-3.5 h-3.5 text-slate-600" />
                <span
                  className="absolute bottom-1 left-1.5 right-1.5 h-1 rounded-sm border border-slate-300"
                  style={{ background: cfg.color || '#1e293b' }}
                />
                <input
                  type="color"
                  value={cfg.color || '#1e293b'}
                  onChange={(e) => setCfg({ color: e.target.value })}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </label>

              {smallBtn(
                `Align: ${cfg.textAlign || 'left'} (click to cycle)`,
                () => {
                  const cur = cfg.textAlign || 'left';
                  const next = cur === 'left' ? 'center' : cur === 'center' ? 'right' : 'left';
                  setCfg({ textAlign: next });
                },
                cfg.textAlign === 'center'
                  ? <AlignCenter className="w-3.5 h-3.5" />
                  : cfg.textAlign === 'right'
                    ? <AlignRight className="w-3.5 h-3.5" />
                    : <AlignLeft className="w-3.5 h-3.5" />,
              )}

              <div className="w-px h-5 bg-slate-200 mx-0.5" />
            </>
          )}

          {/* IMAGE / IMAGE_CAROUSEL / LOGO */}
          {isImage && (
            <>
              <div className="relative">
                <button
                  type="button"
                  aria-label="Replace image"
                  title="Replace image"
                  onClick={(e) => { e.stopPropagation(); setAssetOpen((v) => !v); setUrlOpen(false); setDateOpen(false); }}
                  className="w-8 h-8 rounded-md flex items-center justify-center transition-colors text-slate-600 hover:bg-slate-100"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
              {smallBtn(
                `Fit: ${cfg.objectFit || cfg.fit || 'cover'} (click to cycle)`,
                () => {
                  const cur = cfg.objectFit || cfg.fit || 'cover';
                  const next = cur === 'cover' ? 'contain' : cur === 'contain' ? 'fill' : 'cover';
                  setCfg({ objectFit: next, fit: next });
                },
                <Maximize2 className="w-3.5 h-3.5" />,
              )}
              <div className="w-px h-5 bg-slate-200 mx-0.5" />
            </>
          )}

          {/* CLOCK */}
          {isClock && (
            <>
              {smallBtn(
                `Format: ${cfg.format || '12h'} (click to toggle)`,
                () => setCfg({ format: cfg.format === '24h' ? '12h' : '24h' }),
                <span className="flex items-center gap-0.5">
                  <Clock className="w-3 h-3" />
                  <span className="text-[9px] font-bold">{cfg.format === '24h' ? '24h' : '12h'}</span>
                </span>,
              )}
              <div className="w-px h-5 bg-slate-200 mx-0.5" />
            </>
          )}

          {/* WEATHER */}
          {isWeather && (
            <>
              {smallBtn(
                `Units: ${cfg.units || 'F'} (click to toggle)`,
                () => setCfg({ units: cfg.units === 'C' ? 'F' : 'C' }),
                <span className="flex items-center gap-0.5">
                  <Thermometer className="w-3 h-3" />
                  <span className="text-[9px] font-bold">{cfg.units === 'C' ? 'C' : 'F'}</span>
                </span>,
              )}
              <div className="w-px h-5 bg-slate-200 mx-0.5" />
            </>
          )}

          {/* TICKER */}
          {isTicker && (
            <>
              {smallBtn(
                `Speed: ${typeof cfg.speed === 'string' ? cfg.speed : 'normal'} (click to cycle)`,
                () => {
                  const cur = (typeof cfg.speed === 'string' ? cfg.speed : 'normal') as string;
                  const next = cur === 'slow' ? 'normal' : cur === 'normal' ? 'fast' : 'slow';
                  setCfg({ speed: next });
                },
                <span className="flex items-center gap-0.5">
                  <Gauge className="w-3 h-3" />
                  <span className="text-[9px] font-bold capitalize">{typeof cfg.speed === 'string' ? cfg.speed : 'N'}</span>
                </span>,
              )}
              <div className="w-px h-5 bg-slate-200 mx-0.5" />
            </>
          )}

          {/* COUNTDOWN */}
          {isCountdown && (
            <>
              <div className="relative">
                <button
                  type="button"
                  aria-label="Set target date"
                  title="Set target date"
                  onClick={(e) => { e.stopPropagation(); setDateOpen((v) => !v); setUrlOpen(false); setAssetOpen(false); }}
                  className="w-8 h-8 rounded-md flex items-center justify-center transition-colors text-slate-600 hover:bg-slate-100"
                >
                  <Calendar className="w-3.5 h-3.5" />
                </button>
                {dateOpen && (
                  <div className="absolute z-40 bottom-full mb-2 left-1/2 -translate-x-1/2 bg-white border border-slate-200 rounded-lg shadow-xl p-2 w-44">
                    <label className="block text-[10px] font-semibold text-slate-500 mb-1">Target date</label>
                    <input
                      type="date"
                      defaultValue={cfg.targetDate || ''}
                      onChange={(e) => setCfg({ targetDate: e.target.value })}
                      className="w-full h-7 px-2 text-xs rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  </div>
                )}
              </div>
              <div className="w-px h-5 bg-slate-200 mx-0.5" />
            </>
          )}

          {/* WEBPAGE */}
          {isWebpage && (
            <>
              <div className="relative">
                <button
                  type="button"
                  aria-label="Edit URL"
                  title="Edit URL"
                  onClick={(e) => { e.stopPropagation(); setUrlOpen((v) => !v); setDateOpen(false); setAssetOpen(false); }}
                  className="w-8 h-8 rounded-md flex items-center justify-center transition-colors text-slate-600 hover:bg-slate-100"
                >
                  <Globe className="w-3.5 h-3.5" />
                </button>
                {urlOpen && (
                  <div className="absolute z-40 bottom-full mb-2 left-1/2 -translate-x-1/2 bg-white border border-slate-200 rounded-lg shadow-xl p-2 w-56">
                    <label className="block text-[10px] font-semibold text-slate-500 mb-1">Page URL</label>
                    <input
                      type="url"
                      defaultValue={cfg.url || ''}
                      placeholder="https://…"
                      onBlur={(e) => setCfg({ url: e.target.value })}
                      className="w-full h-7 px-2 text-xs rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    />
                  </div>
                )}
              </div>
              {smallBtn(
                cfg.staticMode ? 'Interactive: off (click to toggle)' : 'Interactive: on (click to toggle)',
                () => setCfg({ staticMode: !cfg.staticMode }),
                <MousePointer className="w-3.5 h-3.5" />,
                false,
                !cfg.staticMode,
              )}
              <div className="w-px h-5 bg-slate-200 mx-0.5" />
            </>
          )}

          {/* Generic zone actions — always when a zone is selected */}
          {zoneActions}

          {/* Divider between zone-context and canvas-controls sections */}
          <div className="w-px h-5 bg-slate-300 mx-1.5" />
        </>
      ) : (
        /* No zone selected — static placeholder so the bar width is stable */
        <span className="text-xs text-slate-400 italic px-3 select-none whitespace-nowrap">Select a widget</span>
      )}

      {/* ══ RIGHT: canvas controls ══════════════════════════════════ */}

      {/* Undo / Redo */}
      {groupBtn(false, 'Undo (Ctrl/⌘+Z)', undo, <Undo2 className="w-4 h-4" />, !canUndo)}
      {groupBtn(false, 'Redo (Ctrl/⌘+Y)', redo, <Redo2 className="w-4 h-4" />, !canRedo)}
      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* Zoom — preset levels */}
      {(() => {
        const PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
        const currIdx = (() => {
          let best = 0;
          let bestDiff = Math.abs(PRESETS[0] - zoom);
          for (let i = 1; i < PRESETS.length; i++) {
            const d = Math.abs(PRESETS[i] - zoom);
            if (d < bestDiff) { best = i; bestDiff = d; }
          }
          return best;
        })();
        const stepDown = () => setZoom(PRESETS[Math.max(0, currIdx - 1)]);
        const stepUp   = () => setZoom(PRESETS[Math.min(PRESETS.length - 1, currIdx + 1)]);
        return (
          <>
            {groupBtn(false, 'Zoom out (preset)', stepDown, <ZoomOut className="w-4 h-4" />, currIdx === 0)}
            <button
              type="button"
              aria-label="Reset zoom to 100%"
              title="Click to reset to 100%"
              onClick={() => setZoom(1)}
              className="px-2 h-9 rounded-lg text-xs font-mono font-semibold text-slate-700 hover:bg-slate-100 min-w-[52px]"
            >
              {zoomPct}%
            </button>
            {groupBtn(false, 'Zoom in (preset)', stepUp, <ZoomIn className="w-4 h-4" />, currIdx === PRESETS.length - 1)}
          </>
        );
      })()}
      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* View toggles */}
      {groupBtn(showGrid,    'Show grid',             () => setShowGrid(!showGrid),   <Grid3x3 className="w-4 h-4" />)}
      {groupBtn(snapEnabled, 'Snap to elements',      () => setSnap(!snapEnabled),    <Magnet className="w-4 h-4" />)}
      {groupBtn(showGuides,  'Show alignment guides', () => setGuides(!showGuides),   <Ruler className="w-4 h-4" />)}
      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* Canvas backdrop */}
      {groupBtn(backdropOpen, 'Canvas backdrop', () => setBackdropOpen(true), <ImageIcon className="w-4 h-4" />)}

      {backdropOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Canvas backdrop picker"
          className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-150"
            onClick={() => setBackdropOpen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl ring-1 ring-slate-200 max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col animate-in zoom-in-95 slide-in-from-bottom-2 duration-200">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <h2 className="text-sm font-bold text-slate-800">Canvas backdrop</h2>
              <button
                onClick={() => setBackdropOpen(false)}
                aria-label="Close"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <CanvasBackdropSection
                bgColor={meta.bgColor || ''}
                bgGradient={meta.bgGradient || ''}
                bgImage={meta.bgImage || ''}
                onChange={(patch) => setMeta(patch)}
                variant="modal"
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/40">
              <button
                onClick={() => setBackdropOpen(false)}
                className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Asset picker modal — outside bar stacking context */}
      {assetOpen && selectedZone && (
        <AssetLibraryModal
          kind="image"
          onPick={(url) => {
            setCfg({ assetUrl: url, imageUrl: undefined });
            setAssetOpen(false);
          }}
          onClose={() => setAssetOpen(false)}
        />
      )}
    </div>
  );
}

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ['Ctrl / \u2318 + S', 'Save template'],
    ['Ctrl / \u2318 + Shift + S', 'Save as copy'],
    ['Ctrl / \u2318 + Z', 'Undo'],
    ['Ctrl / \u2318 + Y  (or Shift+Z)', 'Redo'],
    ['Ctrl / \u2318 + D', 'Duplicate selected'],
    ['Ctrl / \u2318 + C / V', 'Copy / paste zones'],
    ['Ctrl / \u2318 + B / I / U', 'Bold / italic / underline (text widget)'],
    ['Ctrl / \u2318 + Shift + X', 'Strikethrough (text widget)'],
    ['Delete / Backspace', 'Remove selected'],
    ['Arrow keys', 'Nudge 1% (Shift = 10%, Alt = 0.1%)'],
    ['Shift-click / Ctrl-click zone', 'Multi-select'],
    ['Drag empty canvas', 'Marquee select'],
    ['Escape', 'Deselect'],
    ['?  or  Ctrl / ⌘ + /', 'Toggle this dialog'],
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[1000] flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close shortcuts dialog"
        className="absolute inset-0 w-full h-full cursor-default"
        onClick={onClose}
      />
      <div
        role="document"
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-lg font-bold text-slate-800">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-sm"
            aria-label="Close shortcuts"
          >
            Close
          </button>
        </div>
        <dl className="space-y-1 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
              <dt><kbd className="px-2 py-1 rounded bg-slate-100 font-mono text-[11px] text-slate-700">{k}</kbd></dt>
              <dd className="text-slate-600">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
