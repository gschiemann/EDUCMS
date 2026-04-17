"use client";

import { useEffect, useState, useCallback } from 'react';
import { Plus, Layers, Settings2, Keyboard } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';
import { BuilderToolbar } from './BuilderToolbar';
import { BuilderCanvas } from './BuilderCanvas';
import { WidgetPalette } from './WidgetPalette';
import { LayersPanel } from './LayersPanel';
import { PropertiesPanel } from './PropertiesPanel';
import { useUpdateTemplate, useUpdateTemplateZones } from '@/hooks/use-api';
import type { Template, Zone } from './types';

interface Props {
  template: Template;
  onBack: () => void;
  onSaved: (t: Template) => void;
}

type PanelKey = 'widgets' | 'layers' | 'properties';

export function BuilderShell({ template, onBack, onSaved }: Props) {
  const {
    init, selectedIds, isDirty, previewMode,
    updateZones, removeSelected, duplicateZone, select,
    undo, redo, markClean,
  } = useBuilderStore();
  const [panel, setPanel] = useState<PanelKey>('widgets');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string>();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [clipboard, setClipboard] = useState<Zone[] | null>(null);

  const updateTemplate = useUpdateTemplate();
  const updateZonesApi = useUpdateTemplateZones();

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
      onSaved(result);
      setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 2500);
    } catch (err) {
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [template.id, updateTemplate, updateZonesApi, markClean, onSaved]);

  const handleBack = useCallback(() => {
    if (isDirty) {
      if (!window.confirm('You have unsaved changes. Leave without saving?')) return;
    }
    onBack();
  }, [isDirty, onBack]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName) || t?.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
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
  }, [selectedIds, clipboard, undo, redo, select, removeSelected, duplicateZone, updateZones, handleSave, showShortcuts]);

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

  return (
    <div className="fixed inset-0 bg-slate-100 z-[999] flex flex-col">
      <BuilderToolbar onBack={handleBack} onSave={handleSave} saveStatus={saveStatus} saveError={saveError} />

      <div className="flex flex-1 overflow-hidden">
        {!previewMode && (
          <aside className="w-72 bg-white border-r border-slate-200 flex flex-col shrink-0 shadow-sm" aria-label="Builder tools">
            <div className="flex border-b border-slate-100" role="tablist" aria-label="Panel">
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
                    className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-wider flex flex-col items-center gap-1 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-400 ${
                      active ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50' : 'text-slate-400 hover:text-slate-600'
                    }`}
                  >
                    <Icon className="w-4 h-4" aria-hidden />
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <div className="flex-1 overflow-y-auto" role="tabpanel">
              {panel === 'widgets' && <WidgetPalette />}
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

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}

function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ['Ctrl / \u2318 + S', 'Save template'],
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
