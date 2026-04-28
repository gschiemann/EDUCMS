"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Plus, Layers, Settings2, Keyboard, Undo2, Redo2, ZoomIn, ZoomOut, Grid3x3, Magnet, Ruler, Palette, Image as ImageIcon, X, Paintbrush } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
      if (state.selectedIds.length > 0 && prev.selectedIds.length === 0) {
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
    }
    onBack();
  }, [isDirty, onBack, template.isSystem]);

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
    try {
      await deleteTemplate.mutateAsync(template.id);
    } catch (err) {
      console.error('discard failed', err);
    }
    onBack();
  }, [template.id, template.name, template.isSystem, deleteTemplate, onBack]);

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
    // Auto-save runs every 15s of idle time, so this only fires if the
    // operator made a change and refreshed within 15s. To keep the
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

      // SWAP path — partner reported: drag a Wood Wall Clock variant
      // while their existing Clock 2 zone is selected, expected the
      // Clock 2 zone to take the new variant's styling. Old behavior
      // ALWAYS added a new zone. Now: if the user is dragging a
      // variant-tile AND has a single selected zone of the matching
      // widget type, treat the drop as a SWAP (mirrors the click-to-
      // swap behavior in VariantPicker.handlePick).
      const store = useBuilderStore.getState();
      const sel = store.selectedIds;
      if (isVariantTile && variantId && sel.length === 1) {
        const target = store.zones.find((z) => z.id === sel[0]);
        if (target && target.widgetType === type) {
          store.updateZone(target.id, {
            defaultConfig: { ...(target.defaultConfig || {}), ...variantConfig, variant: variantId },
            widgetType: type,
          });
          return;
        }
      }

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
            scroll behaviour intact. */}
        <div className="flex flex-col flex-1 min-w-0">
          <TopContextToolbar />
          <BuilderCanvas />
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

      {/* Bottom bar — unified zoom + undo + view toggles. Canva-style
          spatial memory ("those buttons live down there"). Replaces
          the keyboard-only access to history + grid + snap state.
          Hidden in previewMode so demo screenshots are clean. */}
      {!previewMode && <BuilderBottomBar />}

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

/** Unified bottom bar — zoom, undo/redo, view toggles. Sits fixed
 *  at the bottom of the viewport so operators always know where to
 *  find these controls (spatial memory match with Canva / Figma). */
function BuilderBottomBar() {
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
  const [backdropOpen, setBackdropOpen] = useState(false);

  // Close on Escape — standard modal UX
  useEffect(() => {
    if (!backdropOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setBackdropOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [backdropOpen]);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;
  const zoomPct = Math.round(zoom * 100);

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

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-30 bg-white border border-slate-200 rounded-2xl shadow-lg flex items-center gap-1 px-2 py-1.5">
      {/* Undo / Redo */}
      {groupBtn(false, 'Undo (Ctrl/⌘+Z)',       undo, <Undo2 className="w-4 h-4" />, !canUndo)}
      {groupBtn(false, 'Redo (Ctrl/⌘+Y)',       redo, <Redo2 className="w-4 h-4" />, !canRedo)}
      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* Zoom — preset levels rather than ±10% linear. Stops at the
          design-tool standard set (25/50/75/100/125/150/200/300%) so
          operators land on familiar values. The level button is a
          combobox showing the current %; click cycles through presets,
          right-click / shift-click would open a dropdown (TODO). */}
      {(() => {
        const PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
        const currIdx = (() => {
          // Closest preset
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
      {groupBtn(showGrid,    'Show grid',         () => setShowGrid(!showGrid),     <Grid3x3 className="w-4 h-4" />)}
      {groupBtn(snapEnabled, 'Snap to elements',  () => setSnap(!snapEnabled),      <Magnet className="w-4 h-4" />)}
      {groupBtn(showGuides,  'Show alignment guides', () => setGuides(!showGuides), <Ruler className="w-4 h-4" />)}
      <div className="w-px h-5 bg-slate-200 mx-1" />

      {/* Canvas backdrop — discoverable from the bottom bar so the
          operator doesn't have to deselect the current zone and dig
          through the Properties tab. Opens a modal with the same
          CanvasBackdropSection used in the right rail. */}
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
    </div>
  );
}

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ['Ctrl / \u2318 + S', 'Save template (auto-saves after 15s idle)'],
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
