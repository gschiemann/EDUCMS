"use client";

/**
 * ScenesPanel — Phase D2.5 (2026-05-12).
 *
 * Sidebar panel for the multi-scene model. Lets the operator:
 *   - See every scene in the current template, ordered by sortOrder
 *   - Click a scene to switch which one the canvas is editing
 *   - Star (mark default) — sets which scene the player boots on
 *   - Rename inline
 *   - Add a new scene
 *   - Delete a scene (blocked on default; you must reassign first)
 *
 * Scenes live as their own DB rows (TemplateScene) — every CRUD action
 * hits the API and the parent useTemplate() query gets invalidated.
 * The builder store mirrors the latest scenes via setScenes() so the
 * goto-scene picker and canvas filter stay in sync.
 *
 * NOTE: this panel intentionally does NOT manage zone-to-scene
 * assignment (that lives in PropertiesPanel where the selected zone
 * already has context). It only manages the scene list itself.
 */

import { useEffect, useState } from 'react';
import { Plus, Star, Trash2, Pencil, Check, X, Loader2, Layers3 } from 'lucide-react';
import { useBuilderStore } from './useBuilderStore';
import {
  useTemplateScenes,
  useCreateScene,
  useUpdateScene,
  useDeleteScene,
} from '@/hooks/use-api';
import { appConfirm } from '@/components/ui/app-dialog';

export function ScenesPanel() {
  const templateId = useBuilderStore((s) => s.templateId);
  const scenes = useBuilderStore((s) => s.scenes);
  const activeSceneId = useBuilderStore((s) => s.activeSceneId);
  const setScenes = useBuilderStore((s) => s.setScenes);
  const setActiveSceneId = useBuilderStore((s) => s.setActiveSceneId);
  const zones = useBuilderStore((s) => s.zones);

  const { data: serverScenes, isFetching } = useTemplateScenes(templateId);
  const createScene = useCreateScene(templateId);
  const updateScene = useUpdateScene(templateId);
  const deleteScene = useDeleteScene(templateId);

  // Keep the store in sync with server. Whenever React Query hands us
  // a new list, mirror it into the builder store so other components
  // (PropertiesPanel goto-scene picker, canvas filter) see the change.
  useEffect(() => {
    if (Array.isArray(serverScenes)) setScenes(serverScenes);
  }, [serverScenes, setScenes]);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const beginRename = (sceneId: string, currentName: string) => {
    setRenamingId(sceneId);
    setRenameValue(currentName);
    setError(null);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const name = renameValue.trim();
    if (!name) {
      setError('Scene name cannot be empty.');
      return;
    }
    try {
      await updateScene.mutateAsync({ sceneId: renamingId, patch: { name } });
      setRenamingId(null);
      setRenameValue('');
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Rename failed.');
    }
  };

  const onAdd = async () => {
    setError(null);
    try {
      const next = await createScene.mutateAsync({ name: `Scene ${(scenes?.length || 0) + 1}` });
      // Switch the canvas to the new scene so the operator can start
      // building immediately — same UX pattern as "Add slide" in Slides.
      if (next?.id) setActiveSceneId(next.id);
    } catch (e: any) {
      setError(e?.message || 'Could not create scene.');
    }
  };

  const onSetDefault = async (sceneId: string) => {
    setError(null);
    try {
      await updateScene.mutateAsync({ sceneId, patch: { isDefault: true } });
    } catch (e: any) {
      setError(e?.message || 'Could not set default.');
    }
  };

  const onDelete = async (sceneId: string, name: string) => {
    // Player + builder both protect the default scene at the API; bail
    // early on the client so the operator gets a friendly nudge rather
    // than a 400.
    const scene = scenes.find((s) => s.id === sceneId);
    if (scene?.isDefault) {
      setError('Cannot delete the default scene. Pick a different default first.');
      return;
    }
    const zonesOnScene = zones.filter((z) => z.sceneId === sceneId).length;
    const detail = zonesOnScene > 0
      ? `This scene has ${zonesOnScene} widget${zonesOnScene === 1 ? '' : 's'}. Deleting the scene reassigns them to "shared" (visible on every scene).`
      : 'This scene is empty.';
    const ok = await appConfirm({
      title: `Delete "${name}"?`,
      message: detail,
      tone: 'danger',
      confirmLabel: 'Delete scene',
    });
    if (!ok) return;
    try {
      await deleteScene.mutateAsync(sceneId);
    } catch (e: any) {
      setError(e?.message || 'Could not delete scene.');
    }
  };

  // Counts so the operator can spot scenes that accidentally have zero
  // widgets (and so "shared" stands out as a real entity).
  const zoneCountFor = (sceneId: string | null) =>
    zones.filter((z) => (z.sceneId ?? null) === sceneId).length;

  const sharedCount = zoneCountFor(null);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 text-slate-600">
          <Layers3 className="w-4 h-4 text-indigo-500" />
          <span className="text-xs font-bold uppercase tracking-wider">Scenes</span>
          {isFetching && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={createScene.isPending}
          className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {createScene.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          New
        </button>
      </div>

      <p className="text-[11px] text-slate-500 leading-snug">
        Scenes split one template into multiple screens. Use the "Go to scene" touch action to navigate between them. Widgets you place while a scene is selected belong to that scene.
      </p>

      {error && (
        <div className="text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-2.5 py-1.5">
          {error}
        </div>
      )}

      <div className="space-y-1.5">
        {scenes.map((scene) => {
          const isActive = scene.id === activeSceneId;
          const isRenaming = renamingId === scene.id;
          const count = zoneCountFor(scene.id);
          return (
            <div
              key={scene.id}
              className={`group rounded-lg border px-2.5 py-2 transition-colors ${
                isActive
                  ? 'border-indigo-300 bg-indigo-50/70'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onSetDefault(scene.id)}
                  className={`shrink-0 ${scene.isDefault ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}`}
                  title={scene.isDefault ? 'Default scene (loads first)' : 'Set as default scene'}
                  disabled={updateScene.isPending}
                >
                  <Star className={`w-3.5 h-3.5 ${scene.isDefault ? 'fill-amber-400' : ''}`} />
                </button>
                {isRenaming ? (
                  <>
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') { setRenamingId(null); setError(null); }
                      }}
                      maxLength={80}
                      className="flex-1 min-w-0 px-2 py-1 text-xs rounded border border-indigo-300 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <button
                      type="button"
                      onClick={commitRename}
                      disabled={updateScene.isPending}
                      className="shrink-0 p-1 rounded text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                      aria-label="Save name"
                    >
                      {updateScene.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setRenamingId(null); setError(null); }}
                      className="shrink-0 p-1 rounded text-slate-400 hover:bg-slate-100"
                      aria-label="Cancel rename"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setActiveSceneId(scene.id)}
                      className="flex-1 min-w-0 text-left flex items-center gap-2"
                    >
                      <span className={`truncate text-xs font-bold ${isActive ? 'text-indigo-700' : 'text-slate-700'}`}>
                        {scene.name}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono shrink-0">
                        {count} {count === 1 ? 'zone' : 'zones'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => beginRename(scene.id, scene.name)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                      aria-label="Rename scene"
                      title="Rename"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(scene.id, scene.name)}
                      disabled={scene.isDefault || deleteScene.isPending}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed"
                      aria-label="Delete scene"
                      title={scene.isDefault ? 'Default scene — pick a new default first' : 'Delete'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}

        {/* "Shared" pseudo-scene — represents zones with sceneId === null
            that render on every scene (corner logos, persistent UI, etc).
            Clicking it filters the canvas to show ONLY shared zones so
            the operator can audit what's "always visible." */}
        <button
          type="button"
          onClick={() => setActiveSceneId(null)}
          className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors flex items-center gap-2 ${
            activeSceneId === null
              ? 'border-slate-400 bg-slate-100'
              : 'border-dashed border-slate-200 bg-slate-50 hover:bg-slate-100'
          }`}
        >
          <Layers3 className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-xs font-bold text-slate-600">Shared</span>
          <span className="text-[10px] text-slate-400 font-mono">
            {sharedCount} {sharedCount === 1 ? 'zone' : 'zones'}
          </span>
          <span className="ml-auto text-[10px] text-slate-400">on every scene</span>
        </button>
      </div>
    </div>
  );
}
