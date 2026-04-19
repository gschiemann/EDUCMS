"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Plus, Layers, Settings2, Keyboard } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DndContext, DragOverlay, DragEndEvent, pointerWithin } from '@dnd-kit/core';
import { getZoneColor } from './constants';
import { useBuilderStore } from './useBuilderStore';
import { BuilderToolbar } from './BuilderToolbar';
import { BuilderCanvas } from './BuilderCanvas';
import { WidgetPalette } from './WidgetPalette';
import { VariantPicker } from './VariantPicker';
import { LayersPanel } from './LayersPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { useUpdateTemplate, useUpdateTemplateZones, useCreateTemplate, useDeleteTemplate } from '@/hooks/use-api';
import { appConfirm, appPrompt } from '@/components/ui/app-dialog';
import type { Template, Zone } from './types';

interface Props {
  template: Template;
  onBack: () => void;
  onSaved: (t: Template) => void;
}

type PanelKey = 'widgets' | 'layers' | 'properties';
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

      if (e.key === '?' && !mod) {
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
    const warn = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const panels: Array<{ key: PanelKey; label: string; icon: LucideIcon }> = [
    { key: 'widgets', label: 'Widgets', icon: Plus },
    { key: 'layers', label: 'Layers', icon: Layers },
    { key: 'properties', label: 'Properties', icon: Settings2 },
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
      const id = addZone(type);
      // If dragged from the variant picker, also seed the variant + its defaultConfig
      if (active.data.current?.type === 'variant-tile') {
        const variantId = active.data.current.variantId as string | undefined;
        const variantConfig = (active.data.current.defaultConfig || {}) as Record<string, any>;
        if (variantId) {
          useBuilderStore.getState().updateZone(id, {
            defaultConfig: { ...variantConfig, variant: variantId },
          });
        }
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
              {panel === 'layers' && <LayersPanel />}
              {panel === 'properties' && <PropertiesPanel />}
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

        <BuilderCanvas />
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

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
    </DndContext>
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
    ['Delete / Backspace', 'Remove selected'],
    ['Arrow keys', 'Nudge 1% (Shift = 10%, Alt = 0.1%)'],
    ['Shift-click / Ctrl-click zone', 'Multi-select'],
    ['Drag empty canvas', 'Marquee select'],
    ['Escape', 'Deselect'],
    ['?', 'Toggle this dialog'],
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
