"use client";

/**
 * usePages — one set of page actions for every page surface: the page strip
 * under the canvas, the Pages tab, and Properties' "When tapped → Go to page
 * → + New page…". Pages are `TemplateScene` rows (see pages.ts); every write
 * is the existing scenes API, and the server list is mirrored into the
 * builder store so the canvas filter and the go-to-page pickers agree.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useBuilderStore } from './useBuilderStore';
import { useTemplateScenes, useCreateScene, useUpdateScene, useDeleteScene } from '@/hooks/use-api';
import { appConfirm } from '@/components/ui/app-dialog';
import { nextPageName, reorderPages, sortPages, zonesOnPage } from './pages';

export function usePages() {
  const t = useTranslations('builderPages');
  const templateId = useBuilderStore((s) => s.templateId);
  const scenes = useBuilderStore((s) => s.scenes);
  const activeSceneId = useBuilderStore((s) => s.activeSceneId);
  const setScenes = useBuilderStore((s) => s.setScenes);
  const setActiveSceneId = useBuilderStore((s) => s.setActiveSceneId);

  const { data: serverScenes, isFetching } = useTemplateScenes(templateId);
  const createScene = useCreateScene(templateId);
  const updateScene = useUpdateScene(templateId);
  const deleteScene = useDeleteScene(templateId);
  const [error, setError] = useState<string | null>(null);

  // Mirror the server list into the store (canvas filter, pickers).
  useEffect(() => {
    if (Array.isArray(serverScenes)) setScenes(serverScenes);
  }, [serverScenes, setScenes]);

  const pages = useMemo(() => sortPages(scenes || []), [scenes]);

  /** Create a page. `open` (default) switches the canvas to it — "Add page"
   *  in Slides / Canva. Returns the new page id, or null. */
  const addPage = useCallback(async (opts?: { open?: boolean }): Promise<string | null> => {
    setError(null);
    if (!templateId) { setError(t('saveFirst')); return null; }
    try {
      const current = useBuilderStore.getState().scenes || [];
      const made = await createScene.mutateAsync({ name: nextPageName(current, (n) => t('pageN', { n })) });
      if (made?.id) {
        // Show it at once — the refetch will confirm it.
        const now = useBuilderStore.getState().scenes || [];
        if (!now.some((s) => s.id === made.id)) setScenes([...now, made]);
        if (opts?.open !== false) setActiveSceneId(made.id);
        return made.id;
      }
      return null;
    } catch {
      setError(t('errCreate'));
      return null;
    }
  }, [templateId, createScene, setScenes, setActiveSceneId, t]);

  const renamePage = useCallback(async (sceneId: string, name: string): Promise<boolean> => {
    const clean = name.trim();
    if (!clean) { setError(t('emptyName')); return false; }
    setError(null);
    try {
      await updateScene.mutateAsync({ sceneId, patch: { name: clean } });
      return true;
    } catch {
      setError(t('errRename'));
      return false;
    }
  }, [updateScene, t]);

  const movePage = useCallback(async (sceneId: string, dir: -1 | 1) => {
    setError(null);
    const writes = reorderPages(useBuilderStore.getState().scenes || [], sceneId, dir);
    if (!writes.length) return;
    // Optimistic: the strip reorders under the operator's finger.
    const byId = new Map(writes.map((w) => [w.sceneId, w.sortOrder]));
    setScenes((useBuilderStore.getState().scenes || []).map((s) => (byId.has(s.id) ? { ...s, sortOrder: byId.get(s.id)! } : s)));
    try {
      for (const w of writes) await updateScene.mutateAsync({ sceneId: w.sceneId, patch: { sortOrder: w.sortOrder } });
    } catch {
      setError(t('errMove'));
    }
  }, [updateScene, setScenes, t]);

  const makeStartPage = useCallback(async (sceneId: string) => {
    setError(null);
    try {
      await updateScene.mutateAsync({ sceneId, patch: { isDefault: true } });
    } catch {
      setError(t('errStart'));
    }
  }, [updateScene, t]);

  const deletePage = useCallback(async (sceneId: string) => {
    setError(null);
    const st = useBuilderStore.getState();
    const page = (st.scenes || []).find((s) => s.id === sceneId);
    if (!page) return;
    if (page.isDefault) { setError(t('cantDeleteStart')); return; }
    const count = zonesOnPage(st.zones, sceneId).length;
    const ok = await appConfirm({
      title: t('deleteTitle', { name: page.name }),
      message: count > 0 ? t('deleteMoves', { count }) : t('deleteEmpty'),
      tone: 'danger',
      confirmLabel: t('delete'),
    });
    if (!ok) return;
    try {
      await deleteScene.mutateAsync(sceneId);
    } catch {
      setError(t('errDelete'));
    }
  }, [deleteScene, t]);

  return {
    templateId,
    pages,
    activeSceneId,
    setActiveSceneId,
    isFetching,
    busy: createScene.isPending || updateScene.isPending || deleteScene.isPending,
    adding: createScene.isPending,
    error,
    clearError: () => setError(null),
    addPage,
    renamePage,
    movePage,
    makeStartPage,
    deletePage,
  };
}
