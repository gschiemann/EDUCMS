"use client";

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import {
  Plus, Layers, Settings2, Keyboard, Undo2, Redo2, ZoomIn, ZoomOut, Grid3x3, Magnet, Ruler,
  Palette, Image as ImageIcon, X, Paintbrush,
  Copy, Lock, Unlock, ChevronUp, ChevronDown, Trash2,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Bold, Italic, Underline, Strikethrough, Eye, EyeOff,
  RefreshCw, Maximize2, Clock, Thermometer, Gauge, Calendar, Globe, MousePointer,
  Layers3, Sparkles, AppWindow,
  // Wave C (2026-07-02) — draft-recovery bar, save-conflict bar. The
  // History panel itself reuses RefreshCw (already imported above) for
  // its restore-in-progress spinner; its trigger icon lives in
  // BuilderToolbar.tsx (owns the Save/SaveStatusChip cluster).
  AlertTriangle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AssetLibraryModal, measureZoneFontSize } from './PropertiesPanel';
import { DndContext, DragOverlay, DragEndEvent, pointerWithin } from '@dnd-kit/core';
import { getZoneColor } from './constants';
import { useBuilderStore } from './useBuilderStore';
// Wave B / editor-crush B6a (2026-07-02) — smart drop sizes for palette
// drags (shared with VariantPicker.handlePick's click-add path).
import { resolveDropSize } from './drop-sizes';
import { BuilderToolbar } from './BuilderToolbar';
import { BuilderCanvas } from './BuilderCanvas';
import { CanvasContextMenu } from './CanvasContextMenu';
// WidgetPalette.tsx deleted 2026-05-12 — was imported but never rendered.
// The widgets-panel tab renders VariantPicker (see line where panel ===
// 'widgets' below). Three rounds of touch-widget edits landed in the
// dead file before the operator's screenshot caught it. Do not
// resurrect WidgetPalette without first verifying it's actually
// mounted somewhere.
import { VariantPicker } from './VariantPicker';
// App Library (Phase 1, 2026-06-30) — curated "Apps" tab. Each app is a
// thin config-form wrapper that produces a standard zone config for a
// widgetType WidgetRenderer already renders (STREAMING/WEBPAGE/WEATHER/
// RSS_FEED/CALENDAR/CLOCK/COUNTDOWN/TOUCH_POINT-qr) — see
// docs/research/2026-06-30-app-library/00-SYNTHESIS.md.
import { AppLibraryPanel } from '../apps/AppLibraryPanel';
import { LayersPanel } from './LayersPanel';
import { ScenesPanel } from './ScenesPanel';
import { PropertiesPanel, CanvasBackdropSection } from './PropertiesPanel';
import { BrandKitPanel } from './BrandKitPanel';
import { SuggestionsPanel } from './SuggestionsPanel';
import { BackgroundPanel } from './BackgroundPanel';
import { TemplatePreviewModal } from './TemplatePreviewModal';
import { useUpdateTemplate, useUpdateTemplateZones, useCreateTemplate, useDeleteTemplate, useTemplateVersions, useRestoreTemplateVersion } from '@/hooks/use-api';
import { apiFetch } from '@/lib/api-client';
import { appConfirm, appPrompt } from '@/components/ui/app-dialog';
// Wave C / editor-crush C1+C2 (2026-07-02) — local draft autosave +
// recovery, and the shared timestamp-parsing helper for the staleness
// conflict bar. See autosave-draft.ts for the full contract.
import { readDraft, clearDraft, isDraftNewer, createAutosaveScheduler, formatDraftAge, type BuilderDraft } from './autosave-draft';
// E3 (CRUSH Wave E, 2026-07-03) — "Put on a screen" express lane, shared
// with the gallery's GalleryCard action (see lib/put-on-screen.ts).
import { usePutOnScreen } from '@/lib/put-on-screen';
import {
  isHolidayStyleToggleActive,
  mergeHolidayTextStyleMaps,
  updateHolidayStyleToggle,
} from '@/components/widgets/holiday-style-contract';
import type { Template, Zone } from './types';

interface Props {
  template: Template;
  onBack: () => void;
  onSaved: (t: Template) => void;
}

type PanelKey = 'widgets' | 'apps' | 'background' | 'layers' | 'scenes' | 'properties' | 'brand' | 'review';
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
  const meta = useBuilderStore((s) => s.meta);
  const zones = useBuilderStore((s) => s.zones);
  const updateZones = useBuilderStore((s) => s.updateZones);
  const removeSelected = useBuilderStore((s) => s.removeSelected);
  const duplicateZone = useBuilderStore((s) => s.duplicateZone);
  const select = useBuilderStore((s) => s.select);
  const undo = useBuilderStore((s) => s.undo);
  const redo = useBuilderStore((s) => s.redo);
  const markClean = useBuilderStore((s) => s.markClean);
  const addZone = useBuilderStore((s) => s.addZone);
  // C2 — setServerUpdatedAt is called (post-save / post-reload-theirs);
  // the value itself is always read fresh via getState() inside
  // handleSave to avoid a stale closure, so it's not subscribed here.
  const setServerUpdatedAt = useBuilderStore((s) => s.setServerUpdatedAt);
  const [panel, setPanel] = useState<PanelKey>('widgets');
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string>();
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [clipboard, setClipboard] = useState<Zone[] | null>(null);
  const [activeDragType, setActiveDragType] = useState<string | null>(null);
  // C1 — a local draft found on open that's newer than the server's
  // last save. null = nothing to offer / already dismissed this session.
  const [recoverableDraft, setRecoverableDraft] = useState<BuilderDraft | null>(null);
  // C2 — set when a Save 409s (someone else saved since we loaded).
  // Carries the server's current updatedAt so "Overwrite" can retry
  // without the guard, and "Reload theirs" can show what changed.
  // C2 sweep follow-up (2026-07-03) — Restore hits the SAME 409 and reuses
  // this exact banner (per CLAUDE.md: don't build a second conflict UI).
  // `restoreVersionId` distinguishes which flow raised the conflict so
  // "Overwrite" retries the RIGHT operation (Save vs. this specific Restore).
  const [saveConflict, setSaveConflict] = useState<{ serverUpdatedAt: string; restoreVersionId?: string } | null>(null);
  // C3 — version-history panel open/closed. The list query itself is
  // gated on this (enabled: historyOpen) so opening the builder never
  // fires a versions request the operator didn't ask for.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);

  const router = useRouter();
  const routeParams = useParams<{ schoolId: string }>();

  const updateTemplate = useUpdateTemplate();
  const updateZonesApi = useUpdateTemplateZones();
  const createTemplate = useCreateTemplate();
  const deleteTemplate = useDeleteTemplate();
  // C3 — version history. isSystem templates never save, so they never
  // have versions; skip the request entirely for them.
  const versionsQuery = useTemplateVersions(template.id, { enabled: historyOpen && !template.isSystem });
  const restoreVersion = useRestoreTemplateVersion();
  // E3 (CRUSH Wave E, 2026-07-03) — the same express-lane hook the gallery
  // uses (see lib/put-on-screen.ts). `disabled` is always false here:
  // system templates already hide the CTA in BuilderToolbar (isSystem
  // gate), and there's no separate viewer-role check in the builder route
  // — a RESTRICTED_VIEWER never reaches BuilderShell at all (openInBuilder
  // / the V2 route both bounce viewers before mount).
  const { putOnScreen, puttingOnScreenId } = usePutOnScreen(routeParams?.schoolId);

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
        touchAction: (z as any).touchAction ?? null,
        // Phase D2.5 — thread sceneId into the builder store. Pre-D2
        // zones have null and render in every scene (legacy/shared).
        sceneId: (z as any).sceneId ?? null,
      })),
      meta: {
        name: template.name,
        description: template.description || '',
        screenWidth: template.screenWidth,
        screenHeight: template.screenHeight,
        bgColor: template.bgColor || '',
        bgGradient: template.bgGradient || '',
        bgImage: template.bgImage || '',
        // Phase 1 field-mapping: dataSource persisted in template defaultConfig
        // (no schema migration required — stored in existing JSONB column).
        dataSource: ((template as any).dataSource || 'NONE') as 'NONE' | 'CTS' | 'POS' | 'CUSTOM',
        // Phase 3 — generic "Custom data" feed config, threaded the same way
        // as dataSource (additive, no migration; the API cast allows extras).
        dataUrl: (template as any).dataUrl || '',
        dataFormat: (((template as any).dataFormat as 'json' | 'csv') || 'json'),
      },
      // Phase D — thread the touch toggle + idle timer through init so
      // AI-generated templates (which ship isTouchEnabled=true) open
      // in the builder with the toggle ON. Functional audit caught
      // the omission: previously these were dropped on init, the
      // toolbar toggle was purely local, and saving never persisted
      // the value either (see handleSave below for the matching fix).
      isTouchEnabled: !!(template as any).isTouchEnabled,
      idleResetMs: (template as any).idleResetMs ?? undefined,
      scenes: template.scenes ?? [],
      // Wave C (2026-07-02) — thread the server's updatedAt through so
      // the draft-recovery restore bar (isDraftNewer) and the Save
      // staleness guard (handleSave sends this back as
      // expectedUpdatedAt) both have a baseline the moment the builder
      // opens, not just after the first save in THIS session.
      updatedAt: template.updatedAt ?? null,
    });
    // Bug hunt (2026-07-03) — this effect used to depend on the WHOLE
    // `template` object ([template, init]). Every Save bumps the row's
    // updatedAt, so the invalidation-driven refetch that follows a save
    // resolves to a NEW `template` object reference a few hundred ms
    // later — which re-ran this effect and unconditionally reset
    // zones/meta/isDirty/past/future via init(), silently discarding
    // whatever the operator typed in that window AND wiping undo/redo.
    // No restore bar caught it because the (correct) draft-recovery
    // effect below is already keyed on `template.id`, not `template`;
    // this was the one init effect still keyed on object identity.
    // Keying on `template.id` mirrors that sibling effect: init() only
    // (re)runs on first mount or when the operator actually switches to
    // a different template, never on a same-id refetch. External-change
    // detection is NOT lost by this — it never lived here. The server
    // independently re-validates staleness on every Save via
    // `expectedUpdatedAt: state.serverUpdatedAt` (see handleSave above),
    // which is populated once at init and again after every successful
    // save/reload-theirs (setServerUpdatedAt) — a concurrent edit from
    // another device is still caught at Save time regardless of whether
    // this effect re-fires on a same-id refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id, init]);

  // C1 — on open, check for a local draft that's NEWER than the server's
  // last known save. Runs once per template.id (not on every `template`
  // object identity change, which can happen from React Query refetches
  // that don't actually change which template is open) so re-fetching
  // the same template mid-session doesn't re-pop a bar the operator
  // already dismissed. Skipped for system presets — those never Save
  // in place, so "restore your edits" would dangle with no Save target.
  useEffect(() => {
    if (template.isSystem) return;
    const draft = readDraft(template.id);
    if (isDraftNewer(draft, template.updatedAt ?? null)) {
      setRecoverableDraft(draft);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id]);

  // C1 — the autosave scheduler: a debounced (~3s idle) + max-interval
  // (~30s under continuous activity) local-only mirror of the dirty
  // builder state. Subscribes to the SAME store the canvas/undo stack
  // reads but only ever calls `.getState()` — never a store action —
  // so it structurally cannot push a history entry or touch
  // activeTransaction (see autosave-draft.ts header + the c1 spec's
  // "NEVER touches store history/transactions" suite). Recreated only
  // when the open template changes; disposed on unmount/template swap
  // so no stale timer outlives the builder session.
  useEffect(() => {
    if (template.isSystem) return; // nothing to autosave into — system presets have no Save target
    const scheduler = createAutosaveScheduler((): BuilderDraft => {
      const s = useBuilderStore.getState();
      return {
        templateId: s.templateId,
        savedAt: Date.now(),
        zones: s.zones,
        meta: s.meta,
        isTouchEnabled: s.isTouchEnabled,
        idleResetMs: s.idleResetMs,
      };
    });
    // Fire on every store change, but only actually schedule a write
    // when there are real unsaved edits (isDirty) — a clean template
    // sitting open shouldn't churn localStorage on selection/zoom/pan
    // changes, none of which touch isDirty.
    const unsub = useBuilderStore.subscribe((state, prev) => {
      if (state.isDirty && (state.zones !== prev.zones || state.meta !== prev.meta || state.isTouchEnabled !== prev.isTouchEnabled || state.idleResetMs !== prev.idleResetMs)) {
        scheduler.notifyChange();
      }
    });
    return () => {
      unsub();
      scheduler.dispose();
    };
  }, [template.id, template.isSystem]);

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
      if (state.selectedIds.length === 0 || nowKey === prevKey) return;
      // Phase 2 (2026-09-11) — THE EMPTY-PANEL CHAIN, link 2 of 4.
      //
      // Creating a template seeds ONE full-screen zone of widgetType `EMPTY`,
      // and the bottom bar auto-selects a sole zone on load. That selection
      // used to land here and flip a BRAND-NEW template onto Properties — a
      // panel whose entire job is editing a widget that does not exist yet —
      // while the widgets panel behind it locked its filter to `EMPTY`, for
      // which zero variants are registered. Net effect for a first-time
      // operator: the builder opened on a properties form for nothing, and
      // clicking WIDGETS showed an empty grid. That cost a customer demo.
      //
      // An untouched placeholder is not a widget, so it does not get the
      // widget editor. A blank template opens on WIDGETS and STAYS there —
      // empty canvas → content picker, which is what Canva does. Selecting a
      // REAL widget still jumps to Properties exactly as before.
      const sel = state.selectedIds;
      const onlyPlaceholder =
        sel.length === 1 && state.zones.find((z) => z.id === sel[0])?.widgetType === 'EMPTY';
      if (onlyPlaceholder) return;
      setPanel('properties');
    });
  }, []);

  const handleSave = useCallback(async (opts?: { overwrite?: boolean }) => {
    setSaveStatus('saving');
    setSaveError(undefined);
    setSaveConflict(null);
    try {
      const state = useBuilderStore.getState();
      const orientation = state.meta.screenHeight > state.meta.screenWidth ? 'PORTRAIT' : 'LANDSCAPE';
      // C2 — the guard the client sends back. "Overwrite" (the explicit
      // choice on the conflict bar) omits it entirely so the retry
      // behaves exactly like a pre-C2 client: a deliberate, informed
      // blind write, not a silent one.
      const expectedUpdatedAt = opts?.overwrite ? undefined : (state.serverUpdatedAt ?? undefined);
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
        // Phase D — persist the touch toggle + idle-reset. Without
        // these, toggling touch mode in the builder was purely local;
        // refresh restored the DB value and the operator's change
        // was silently discarded (Functional audit #2).
        isTouchEnabled: state.isTouchEnabled,
        idleResetMs: state.idleResetMs,
        // Phase 1 field-mapping — persist the template-level data source.
        // Stored in the template's top-level dataSource column (additive,
        // no migration; the API cast already allows extra fields via (as any)).
        dataSource: state.meta.dataSource || 'NONE',
        // Phase 3 — persist the generic Custom-data feed config alongside it
        // (same additive path; only meaningful when dataSource === 'CUSTOM').
        dataUrl: state.meta.dataUrl || null,
        dataFormat: state.meta.dataFormat || 'json',
        expectedUpdatedAt,
      } as any);
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
          // Phase D1 + D2.5 — persist the touch action + scene
          // assignment along with the zone geometry. Without these
          // fields in the PUT body the API atomic-replace silently
          // wiped them on every save — a regression that pre-shipped
          // the multi-scene model.
          touchAction: z.touchAction ?? null,
          sceneId: z.sceneId ?? null,
        })),
        // C2 FIX (2026-07-03) — do NOT re-send the staleness guard here. The
        // metadata PUT above already (a) ran assertNotStale against the SAME
        // expectedUpdatedAt and (b) bumped the row's @updatedAt to a newer
        // value; re-sending the pre-save timestamp would make the server's
        // now-newer updatedAt always exceed it, self-409ing EVERY save on this
        // (destructive delete-all-and-recreate) zones write. The guard only
        // needs to fire ONCE, at the first PUT — a genuine concurrent edit is
        // caught there BEFORE this write ever runs, so nothing is unprotected.
        expectedUpdatedAt: undefined,
      });
      markClean();
      setSaveStatus('saved');
      setLastSavedAt(Date.now());
      // C1 — the server now has this state; the local safety net for
      // it is stale the instant Save succeeds. Clearing here (not just
      // on unmount) means a crash 1ms later has nothing wrong to
      // "recover" back into.
      clearDraft(template.id);
      // C2 — this save's result is the new baseline for the NEXT
      // save's guard (and for isDraftNewer, if a fresh draft starts
      // accumulating right after).
      if (result && typeof (result as any).updatedAt === 'string') {
        setServerUpdatedAt((result as any).updatedAt);
      }
      onSaved(result);
      setTimeout(() => setSaveStatus((s) => (s === 'saved' ? 'idle' : s)), 2500);
    } catch (err: any) {
      // C2 — a 409 from either PUT means someone else saved since we
      // loaded/last-saved. Surface the conflict bar instead of the
      // generic error chip so the operator gets an actionable choice
      // (Reload theirs / Overwrite) rather than a bare "save failed."
      if (err?.status === 409 && err?.code === 'TEMPLATE_STALE') {
        const serverUpdatedAt = err?.body?.serverUpdatedAt;
        setSaveStatus('idle');
        setSaveConflict({ serverUpdatedAt: typeof serverUpdatedAt === 'string' ? serverUpdatedAt : new Date().toISOString() });
        return;
      }
      setSaveStatus('error');
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [template.id, updateTemplate, updateZonesApi, markClean, onSaved, setServerUpdatedAt]);

  // E3 (CRUSH Wave E, 2026-07-03) — "Put on a screen" from inside the
  // editor. The template ALWAYS has a real server id by the time
  // BuilderShell mounts (both openInBuilder and the V2 builder route only
  // ever hand it an already-created Template — see templates/page.tsx
  // openInBuilder / builder/[id]/page.tsx), so the only gate needed is
  // "does the server copy reflect what's on screen": if there are unsaved
  // edits, run the exact same handleSave the Save button uses FIRST, then
  // publish whatever the server now has. handleSave never throws (it
  // catches internally and drives saveStatus/saveConflict), so success is
  // read back via isDirty — save either cleared it (markClean) or it
  // didn't (409 conflict / network error), in which case publishing a
  // stale server copy would be wrong and we bail with the same conflict
  // bar already on screen.
  const handlePutOnScreen = useCallback(async () => {
    if (useBuilderStore.getState().isDirty) {
      await handleSave();
      if (useBuilderStore.getState().isDirty) return; // save didn't land — conflict/error banner is already showing
    }
    await putOnScreen({ id: template.id, name: useBuilderStore.getState().meta.name || template.name });
  }, [handleSave, putOnScreen, template.id, template.name]);

  // C1 — the operator's response to the draft-recovery bar.
  const handleRestoreDraft = useCallback(() => {
    if (!recoverableDraft) return;
    // A deliberate, one-time, user-initiated state replacement — not
    // something autosave itself does. Mirrors what init() already sets
    // on a fresh load, so the canvas/undo model comes up exactly as if
    // the operator had made these edits themselves just now: history
    // is reset (there's nothing to "undo back to" a moment ago that
    // predates the crash) and isDirty is true (the restored state
    // still needs an explicit Save to reach the server — restoring
    // does not silently persist anything, same "explicit Save is the
    // live step" principle the whole feature is built around).
    useBuilderStore.setState({
      zones: recoverableDraft.zones.map((z) => ({ ...(z as Zone) })),
      meta: { ...useBuilderStore.getState().meta, ...recoverableDraft.meta },
      isTouchEnabled: recoverableDraft.isTouchEnabled ?? useBuilderStore.getState().isTouchEnabled,
      idleResetMs: recoverableDraft.idleResetMs ?? useBuilderStore.getState().idleResetMs,
      past: [],
      future: [],
      isDirty: true,
    });
    setRecoverableDraft(null);
  }, [recoverableDraft]);

  const handleDiscardDraft = useCallback(() => {
    clearDraft(template.id);
    setRecoverableDraft(null);
  }, [template.id]);

  // C2 — "Reload theirs": pull the current server row and re-init the
  // store on it, discarding the operator's local edits (they explicitly
  // chose this over Overwrite). Uses a raw GET rather than useTemplate's
  // query object so this file doesn't need to thread a refetch callback
  // through — same apiFetch this file already imports for save-as's
  // scene bookkeeping.
  const handleReloadTheirs = useCallback(async () => {
    try {
      const fresh = await apiFetch<Template>(`/templates/${template.id}`);
      init({
        id: fresh.id,
        isSystem: !!fresh.isSystem,
        zones: (fresh.zones || []).map((z) => ({ ...z, locked: false })),
        meta: {
          name: fresh.name,
          description: fresh.description || '',
          screenWidth: fresh.screenWidth,
          screenHeight: fresh.screenHeight,
          bgColor: fresh.bgColor || '',
          bgGradient: fresh.bgGradient || '',
          bgImage: fresh.bgImage || '',
        },
        isTouchEnabled: !!(fresh as any).isTouchEnabled,
        idleResetMs: (fresh as any).idleResetMs ?? undefined,
        scenes: fresh.scenes ?? [],
        updatedAt: fresh.updatedAt ?? null,
      });
      clearDraft(template.id); // their version supersedes any local draft too
      setSaveConflict(null);
    } catch (err) {
      // Reload failing (network blip) shouldn't lose the conflict
      // banner — the operator can retry Reload or fall back to
      // Overwrite. Surface it the same way a save error would.
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }, [template.id, init]);

  // C3 — restore one of the last 5 saved versions. The server snapshots
  // the CURRENT state first (never destructive — see the controller's
  // restoreVersion doc comment) and returns the fully-updated template
  // in the same shape as GET/PUT, so re-init() is exactly the same
  // "adopt server state" pattern handleReloadTheirs already uses.
  //
  // C2 sweep follow-up (2026-07-03) — restore does the SAME destructive
  // delete-all-zones-and-recreate + metadata overwrite handleSave's two
  // PUTs do, so it gets the SAME staleness guard: send back the
  // `serverUpdatedAt` this session last loaded/saved (identical source
  // handleSave reads at the top of its try block), and on a 409 reuse
  // the exact save-conflict banner (`saveConflict` state + its Reload
  // theirs / Overwrite buttons) rather than inventing a second UI.
  // `saveConflict.restoreVersionId` records which version was in flight so
  // handleOverwrite (below) knows to retry THIS restore, not a plain Save.
  const handleRestoreVersion = useCallback(async (versionId: string, opts?: { overwrite?: boolean }) => {
    setRestoringVersionId(versionId);
    setSaveConflict(null);
    try {
      const state = useBuilderStore.getState();
      const expectedUpdatedAt = opts?.overwrite ? undefined : (state.serverUpdatedAt ?? undefined);
      const restored = await restoreVersion.mutateAsync({ id: template.id, versionId, expectedUpdatedAt });
      const fresh = restored as unknown as Template;
      init({
        id: fresh.id,
        isSystem: !!fresh.isSystem,
        zones: (fresh.zones || []).map((z) => ({ ...z, locked: false })),
        meta: {
          name: fresh.name,
          description: fresh.description || '',
          screenWidth: fresh.screenWidth,
          screenHeight: fresh.screenHeight,
          bgColor: fresh.bgColor || '',
          bgGradient: fresh.bgGradient || '',
          bgImage: fresh.bgImage || '',
        },
        isTouchEnabled: !!(fresh as any).isTouchEnabled,
        idleResetMs: (fresh as any).idleResetMs ?? undefined,
        scenes: fresh.scenes ?? [],
        updatedAt: fresh.updatedAt ?? null,
      });
      // The restore itself IS a save server-side (it wrote a fresh
      // updatedAt) — clear any local draft so a stale autosave copy
      // doesn't later look "newer" than the row and pop a bogus
      // restore-draft bar.
      clearDraft(template.id);
      setHistoryOpen(false);
      onSaved(fresh);
    } catch (err: any) {
      // Same 409 handling as handleSave: surface the shared conflict bar
      // (Reload theirs / Overwrite) instead of a bare error chip. The
      // history panel stays open underneath it so the operator can still
      // see/retry other versions after resolving the conflict.
      if (err?.status === 409 && err?.code === 'TEMPLATE_STALE') {
        const serverUpdatedAt = err?.body?.serverUpdatedAt;
        setSaveConflict({
          serverUpdatedAt: typeof serverUpdatedAt === 'string' ? serverUpdatedAt : new Date().toISOString(),
          restoreVersionId: versionId,
        });
        return;
      }
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoringVersionId(null);
    }
  }, [template.id, init, restoreVersion, onSaved]);

  // C2 — "Overwrite": the operator has seen the conflict and explicitly
  // chooses to blind-write their version anyway. Retries handleSave
  // with the guard skipped (matches an older pre-C2 client exactly).
  //
  // C2 sweep follow-up (2026-07-03) — the SAME banner now also fires from
  // Restore (see handleRestoreVersion above), so Overwrite must retry
  // WHICHEVER operation raised the conflict: `saveConflict.restoreVersionId`
  // is only set when a Restore 409'd, so branch on its presence rather than
  // always assuming Save.
  const handleOverwrite = useCallback(() => {
    const restoreVersionId = saveConflict?.restoreVersionId;
    setSaveConflict(null);
    if (restoreVersionId) {
      void handleRestoreVersion(restoreVersionId, { overwrite: true });
    } else {
      void handleSave({ overwrite: true });
    }
  }, [handleSave, saveConflict, handleRestoreVersion]);

  const handleSaveAs = useCallback(async (autoName?: string) => {
    const state = useBuilderStore.getState();
    const defaultName = `${state.meta.name || 'Untitled template'} copy`;
    // `autoName` skips the prompt — used by the one-click "Save to my
    // templates" fork on starter/system templates.
    const name = autoName ?? await appPrompt({
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
      // Save-as creates a fresh template via POST /templates which
      // does NOT accept sceneId (scenes don't exist yet for the new
      // row). We create the bare template + zones, then if the source
      // had scenes, recreate them on the new template and re-point
      // the zones via PUT /:id/zones. Without this, duplicating a
      // multi-scene template lost ALL scene assignments + touch
      // actions (Functional audit #1).
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
          isTouchEnabled: state.isTouchEnabled,
          idleResetMs: state.idleResetMs,
        } as any);
      }
      // Recreate scenes on the new template (if the source had any
      // beyond the auto-created default) and persist zone-level
      // touchAction + sceneId via the zones PUT (which DOES accept
      // both, unlike POST /templates).
      if (newId) {
        const sceneNameToNewId = new Map<string, string>();
        // The POST handler creates a "Main" default scene implicitly;
        // we map the source's default scene name to that. For any
        // additional source scenes, POST /scenes to create them.
        const srcScenes = state.scenes.slice();
        const srcDefault = srcScenes.find((s) => s.isDefault) || srcScenes[0];
        if (srcDefault) sceneNameToNewId.set(srcDefault.id, '__will-resolve-after__');
        // Fetch the new template's auto-created default scene id.
        try {
          const newScenes: any[] = await apiFetch<any[]>(`/templates/${newId}/scenes`);
          const newDefault = (newScenes || []).find((s) => s.isDefault) || newScenes?.[0];
          if (srcDefault && newDefault) sceneNameToNewId.set(srcDefault.id, newDefault.id);
          // Create extras + capture their new ids.
          for (const s of srcScenes) {
            if (sceneNameToNewId.has(s.id)) continue;
            const made = await apiFetch<any>(`/templates/${newId}/scenes`, {
              method: 'POST',
              body: JSON.stringify({ name: s.name }),
            });
            if (made?.id) sceneNameToNewId.set(s.id, made.id);
          }
        } catch {
          // Scenes are best-effort on save-as; if anything breaks,
          // the new template still has its auto-created default
          // and every zone falls back to "shared." Operator sees
          // the copy and can iterate.
        }
        // Re-issue zones with the resolved sceneId + touchAction
        // payload that POST /templates couldn't accept.
        await updateZonesApi.mutateAsync({
          id: newId,
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
            touchAction: z.touchAction ?? null,
            // 2026-06-09 — THE real "editor save failed" bug (RBAC was already
            // fixed; this is a separate frontend leak). srcDefault is seeded
            // with the '__will-resolve-after__' sentinel before the new
            // template's scenes are fetched; if that resolution doesn't
            // complete (new template had no scene to map, or the scenes
            // fetch threw — it's in a best-effort try/catch), the sentinel
            // would leak into this PUT and the zones endpoint 400s with
            // "Zones reference scene ids that don't belong to this template".
            // Guard it: an unresolved/sentinel scene falls back to null
            // ("shared"), never a bogus id.
            sceneId: (() => {
              if (!z.sceneId) return null;
              const mapped = sceneNameToNewId.get(z.sceneId);
              return mapped && mapped !== '__will-resolve-after__' ? mapped : null;
            })(),
          })),
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
  }, [createTemplate, updateTemplate, updateZonesApi, router, routeParams]);

  // Starter/system templates can't be overwritten — editing them forks the
  // operator's OWN editable copy (carrying every in-progress edit from the
  // store), auto-named so it's one click, then the builder reopens on the
  // copy where Save works. This is the fix for "I edited a template and
  // couldn't update anything": system templates have no plain Save, so the
  // path to keep changes must be obvious + frictionless.
  const handleCustomize = useCallback(() => {
    const base = useBuilderStore.getState().meta.name || 'My template';
    void handleSaveAs(base);
  }, [handleSaveAs]);

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

  // Paste the zone clipboard onto the canvas (+3/+3 offset, one undo
  // step). Shared by the ⌘V keyboard shortcut AND the A6 right-click
  // context menu so both surfaces use the exact same clipboard + logic.
  const pasteClipboard = useCallback(() => {
    if (!clipboard || clipboard.length === 0) return;
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
    // A2 — this is a one-shot action (not an ongoing drag), so close
    // the transaction immediately. Leaving activeTransaction open
    // would swallow the NEXT unrelated commit (e.g. typing in a
    // field right after a paste) into this paste's history entry.
    state.endTransaction();
    select(newIds);
  }, [clipboard, select]);

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
        pasteClipboard();
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
        state.endTransaction();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedIds, clipboard, undo, redo, select, removeSelected, duplicateZone, updateZones, handleSave, handleSaveAs, showShortcuts, pasteClipboard]);

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
    // Phase 1 App Library (2026-06-30) — curated integrations (YouTube,
    // Slides, Weather, Calendar, QR, etc). Separate tab from Widgets so the
    // two mental models ("build a layout piece" vs "connect a real-world
    // service") don't get muddled in one flat list of 400+ tiles.
    { key: 'apps', label: 'Apps', icon: AppWindow },
    { key: 'background', label: 'Background', icon: Paintbrush },
    { key: 'layers', label: 'Layers', icon: Layers },
    // Phase D2.5 — Scenes panel slots between Layers and Properties so
    // the operator's mental model is "layers within this scene → drill
    // out to scenes → drill into a specific zone."
    { key: 'scenes', label: 'Scenes', icon: Layers3 },
    { key: 'properties', label: 'Properties', icon: Settings2 },
    { key: 'brand', label: 'Brand', icon: Palette },
    // Flagship Slice 1a — deterministic "Review" checks (off-screen, tap
    // targets, hairline elements) with one-tap, undoable fixes.
    { key: 'review', label: 'Review', icon: Sparkles },
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
      // Wave B / editor-crush B6a (2026-07-02): thread the smart drop size
      // so dragged tiles land at their natural footprint (LOGO small,
      // TICKER full-width strip, divider line wide-short) instead of the
      // generic 40×30 box. resolveDropSize returns undefined for unmapped
      // types — addZone's existing default sizing still applies there.
      // Phase 2 (2026-09-11) — a drop onto a board that is still nothing but
      // the seeded full-screen `EMPTY` placeholder FILLS that placeholder
      // instead of laying a 40×30 box on top of it. Dropping "on top" left
      // the unexplained rectangle behind the new widget forever, which is
      // exactly the first-run confusion this phase exists to remove. Scoped
      // hard to the blank case: with any real content on the canvas, a drag
      // still adds, unchanged.
      const st = useBuilderStore.getState();
      const blankPlaceholder =
        st.zones.length === 1 && st.zones[0].widgetType === 'EMPTY' ? st.zones[0] : null;
      if (blankPlaceholder) {
        st.setZoneWidget(blankPlaceholder.id, type, variantId, variantConfig);
        return;
      }

      const id = addZone(type, dropAt, resolveDropSize(type, variantId));
      // If dragged from the variant picker (no swap target), also seed
      // the variant + its defaultConfig on the new zone.
      if (isVariantTile && variantId) {
        useBuilderStore.getState().updateZone(id, {
          defaultConfig: { ...variantConfig, variant: variantId },
        });
      }
    }
  };


  // Clicking an editable element on a packaged board posts
  // `educms-field-click` from inside the (sandboxed) iframe. The handler
  // that acts on it lives in PropertiesPanel — which is only mounted
  // while the PROPERTIES tab is open. So an operator sitting on Widgets,
  // Apps or Brand could click straight at the thing they wanted to change
  // and nothing whatsoever would happen; the affordance existed one tab
  // away from where they were looking. Switch to Properties and replay the
  // message once that panel has mounted.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; __replayed?: boolean } | null;
      if (!d || typeof d !== 'object') return;
      if (d.type !== 'educms-field-click' || d.__replayed) return;
      if (panel === 'properties') return; // already mounted; it handles its own
      setPanel('properties');
      window.setTimeout(() => {
        try { window.postMessage({ ...d, __replayed: true }, '*'); } catch { /* ignore */ }
      }, 60);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [panel]);


  return (
    <DndContext onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="fixed inset-0 bg-slate-50 z-[999] flex flex-col font-sans text-slate-800 selection:bg-indigo-500/30">
      <BuilderToolbar
        onBack={handleBack}
        onSave={handleSave}
        onSaveAs={() => handleSaveAs()}
        onCustomize={handleCustomize}
        onDiscard={template.isSystem ? undefined : handleDiscard}
        onPreview={() => setPreviewOpen(true)}
        saveStatus={saveStatus}
        saveError={saveError}
        lastSavedAt={lastSavedAt}
        onOpenHistory={() => setHistoryOpen(true)}
        onPutOnScreen={handlePutOnScreen}
        puttingOnScreenBusy={puttingOnScreenId === template.id}
      />

      {/* C1 — draft-recovery bar. One bar, two buttons, no new settings
          (Greg's law). Only shown when a local draft is strictly newer
          than the server's last save — see the effect above that sets
          recoverableDraft on open via isDraftNewer(). */}
      {recoverableDraft && (
        <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-indigo-50 border-b border-indigo-200">
          <RefreshCw className="w-4 h-4 shrink-0 text-indigo-500" aria-hidden />
          <p className="text-xs font-medium text-indigo-900 flex-1 min-w-0">
            You have unsaved changes from {formatDraftAge(recoverableDraft.savedAt)} — this browser tab closed or crashed before you hit Save.
          </p>
          <button
            type="button"
            onClick={handleDiscardDraft}
            className="shrink-0 px-3 py-1.5 bg-white border border-indigo-200 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={handleRestoreDraft}
            className="shrink-0 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            Restore
          </button>
        </div>
      )}

      {/* C2 — save-conflict bar. Shown when a Save 409s because the row
          moved since we loaded/last-saved it. Same one-bar-two-buttons
          shape as the draft-recovery bar; rose tint marks it as the
          more urgent of the two (an actual write was just blocked).
          C2 sweep follow-up (2026-07-03) — Restore 409s reuse this exact
          bar (see handleRestoreVersion); only the verb in the copy
          changes based on which operation was blocked. */}
      {saveConflict && (
        <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-rose-50 border-b border-rose-200">
          <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500" aria-hidden />
          <p className="text-xs font-medium text-rose-900 flex-1 min-w-0">
            Someone saved this template {formatDraftAge(Date.parse(saveConflict.serverUpdatedAt))} — your {saveConflict.restoreVersionId ? 'Restore' : 'Save'} was blocked so you don&apos;t overwrite their work.
          </p>
          <button
            type="button"
            onClick={handleReloadTheirs}
            className="shrink-0 px-3 py-1.5 bg-white border border-rose-200 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-rose-400"
          >
            Reload theirs
          </button>
          <button
            type="button"
            onClick={handleOverwrite}
            className="shrink-0 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-rose-400"
          >
            Overwrite
          </button>
        </div>
      )}

      {/* C3 — version history panel. A simple anchored dropdown (not a
          full modal) so it reads as a lightweight peek, matching the
          "History" affordance's weight — not a destructive workflow.
          Lists the 5 most recent saves with relative times + Restore;
          restoring re-inits the store from the server's response
          (same pattern as C2's "Reload theirs"). */}
      {historyOpen && (
        <>
          <div
            className="fixed inset-0 z-[1000]"
            onClick={() => setHistoryOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-label="Version history"
            className="absolute right-4 top-16 z-[1001] w-80 max-h-[70vh] overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl"
          >
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">Version history</h3>
              <button
                type="button"
                onClick={() => setHistoryOpen(false)}
                aria-label="Close version history"
                className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                <X className="w-3.5 h-3.5" aria-hidden />
              </button>
            </div>
            <div className="p-2">
              {versionsQuery.isLoading && (
                <p className="text-xs text-slate-400 px-2 py-3 text-center">Loading&hellip;</p>
              )}
              {versionsQuery.isError && (
                <p className="text-xs text-rose-500 px-2 py-3 text-center">Couldn&apos;t load version history.</p>
              )}
              {!versionsQuery.isLoading && !versionsQuery.isError && (versionsQuery.data?.length ?? 0) === 0 && (
                <p className="text-xs text-slate-400 px-2 py-3 text-center">
                  No saved versions yet — history starts building after your next Save.
                </p>
              )}
              {versionsQuery.data?.map((v) => (
                <div
                  key={v.id}
                  className="flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-slate-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-slate-700" title={new Date(v.createdAt).toLocaleString()}>
                      {formatDraftAge(Date.parse(v.createdAt))}
                    </div>
                    {v.byUser?.email && (
                      <div className="text-[10px] text-slate-400 truncate">{v.byUser.email}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRestoreVersion(v.id)}
                    disabled={restoringVersionId !== null}
                    className="shrink-0 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[11px] font-bold rounded-lg transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-indigo-400 flex items-center gap-1"
                  >
                    {restoringVersionId === v.id
                      ? <RefreshCw className="w-3 h-3 animate-spin" aria-hidden />
                      : null}
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Starter-template explainer. System presets can't be overwritten;
          editing forks the operator's own copy. Without this banner the
          operator edits, sees no Save button, and thinks "I can't update
          anything" (Domino's pilot, 2026-05-31).
          NOTE: this is explanatory ONLY — the actual CTA is the single
          "Save to my templates" button in the toolbar above. The banner used
          to ALSO render its own button, which produced TWO identical save
          buttons for any system preset (both calling handleCustomize). Dropped
          the duplicate; the text now points at the toolbar button. */}
      {template.isSystem && (
        <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-amber-50 border-b border-amber-200">
          <Sparkles className="w-4 h-4 shrink-0 text-amber-500" aria-hidden />
          <p className="text-xs font-medium text-amber-900 flex-1 min-w-0">
            This is a <strong>starter template</strong>. Edit anything you like — then click{' '}
            <strong>Save to my templates</strong> in the top bar to keep your changes as your own editable copy.
          </p>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden relative">
        {/* Abstract background blobs for premium feel — desktop-only.
            2026-07-01 mobile-perf fix: these decorative blur-[…] blobs sat
            un-gated on the always-mounted builder shell, which the phone
            pays for on every repaint (CLAUDE.md Mobile performance
            standard rule #3). `hidden md:block` removes the GPU cost on
            phones with zero visual change on desktop. */}
        <div className="hidden md:block absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
          <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-indigo-200/20 blur-[120px]" />
          <div className="absolute top-[60%] -right-[10%] w-[40%] h-[60%] rounded-full bg-sky-200/20 blur-[100px]" />
        </div>

        {/* 2026-05-29 — operator: "i was talking about this tool bar as well,
            it doesnt even work and we have our widget picker to get all this
            stuff." Removed the far-left ADD rail (Text/Image/Video/Webpage/QR/
            Shape) — it duplicated the WIDGETS picker, which adds every one of
            those. One add path now: the WIDGETS tab. */}
        {!previewMode && (
          // 2026-07-01 mobile-perf + mobile-width fix (App Library
          // world-class build): the fixed w-[420px] overflowed a ~380px
          // iPhone viewport (Greg runs the whole product from an iPhone —
          // CLAUDE.md mobile-perf preamble), and the always-mounted
          // `backdrop-blur-2xl` re-samples everything behind it on every
          // repaint — a real mobile-perf-guard-class violation (rule #3).
          // `w-full max-w-[92vw] md:w-[420px]` keeps the desktop layout
          // pixel-identical while letting the panel fit a phone; the blur
          // is now breakpoint-gated with a solid fallback bg on mobile.
          <aside className="w-full max-w-[92vw] md:w-[420px] bg-white/95 md:bg-white/70 backdrop-blur-none md:backdrop-blur-2xl border-r border-slate-200/50 flex flex-col shrink-0 shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-10" aria-label="Builder tools">
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
                    // a11y wave (2026-08-24) — the inactive-tab
                    // text-slate-400 measured 2.58:1 against this bar's
                    // near-white backdrop via axe-core; text-slate-500
                    // clears WCAG AA's 4.5:1 floor.
                    className={`flex-1 py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-wider flex flex-col items-center gap-1.5 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-400 ${
                      active ? 'text-indigo-600 bg-white shadow-sm ring-1 ring-slate-200/50' : 'text-slate-500 hover:text-slate-600 hover:bg-slate-50/50'
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
              {panel === 'apps' && <AppLibraryPanel />}
              {panel === 'background' && <BackgroundPanel />}
              {panel === 'layers' && <LayersPanel />}
              {panel === 'scenes' && <ScenesPanel />}
              {panel === 'properties' && <PropertiesPanel />}
              {panel === 'brand' && <BrandKitPanel />}
              {panel === 'review' && <SuggestionsPanel />}
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
          {/* 2026-05-29 — operator: "i see 4 fucking tool bars ... i want the
              main edit area on the left and the bottom floating tool bar,
              not the extra picker or the small floating one. merge that shit."
              Removed the TopContextToolbar (top "Apply to" scope picker) AND
              the BottomToolbarConnected quick-action pill. Both duplicated
              controls that already live in the left Properties panel + this
              ONE persistent BuilderBottomBar (font / size / color + layer /
              duplicate / delete + zoom / grid / undo). Two surfaces now:
              left panel + this bottom bar. */}
          <BuilderCanvas />
          {!previewMode && <BuilderBottomBar />}
          {/* A6 — right-click context menu on zones + canvas. Shares the
              shell's ⌘C/⌘V clipboard so both surfaces stay in sync. */}
          {!previewMode && (
            <CanvasContextMenu
              clipboard={clipboard}
              onCopy={(z) => setClipboard(z)}
              onPaste={pasteClipboard}
            />
          )}
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

      {/* Fullscreen template preview — operator: "we need a preview
          button to see the template before we post it". Renders the
          template at native resolution (e.g. 1920×1080) scaled to fit
          the viewport, with widgets running in live=true mode so
          videos play and carousels rotate. */}
      <TemplatePreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        zones={zones as any}
        screenWidth={meta.screenWidth}
        screenHeight={meta.screenHeight}
        bgColor={meta.bgColor || undefined}
        bgGradient={meta.bgGradient || undefined}
        bgImage={meta.bgImage || undefined}
        templateName={meta.name}
      />
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
  const select         = useBuilderStore((s) => s.select);

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

  // 2026-06-01 — operator: "none of the fields are editable." Every
  // EXTERNAL_HTML signage / menu board is a single full-bleed "Scene" zone,
  // and the builder opens on the template-level Properties view — so the
  // per-zone editor ("Edit text", photo swaps, Brand, Live POS) was hidden
  // until the operator happened to click the zone. Auto-select the sole zone
  // ONCE on load so that editor is visible immediately. The ref guards it so
  // deselecting (clicking empty canvas) still works without snapping back.
  const didAutoSelectSoleZone = useRef(false);
  useEffect(() => {
    if (didAutoSelectSoleZone.current) return;
    if (zones.length === 1 && selectedIds.length === 0) {
      didAutoSelectSoleZone.current = true;
      select(zones[0].id);
    }
  }, [zones, selectedIds, select]);

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
  // Sport scoreboard elements (team name / score / clock / segment / stat)
  // read zone-level cfg.fontSize / color / fontWeight / align, so the bottom
  // bar's font + color controls DO apply to them — operator: "i select the
  // team name, try to edit font size + color from the bottom tool bar but it
  // doesnt do anything." They're whole-zone widgets (not [data-field]
  // hotspots), so they use the zone-wide style block, not the per-field one.
  const isSportEl = wt === 'SCOREBOARD' || wt === 'SCORE_HOME' || wt === 'SCORE_AWAY'
    || wt === 'GAME_CLOCK' || wt === 'GAME_SEGMENT' || wt === 'GAME_STAT';

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

  // 2026-05-29 — Scoreboard elements (the composed sb-* board) aren't
  // `[data-field]` hotspots, so selecting one on the canvas never lit up
  // its matching Properties field. Operator: "i want the hot spot AND the
  // tool bar on the left where i edit the text to get highlighted." When a
  // scoreboard element is selected, fire the SAME `template-edit-field`
  // event a hotspot click fires → PropertiesPanel scrolls to + ring-
  // highlights (is-active-section) the field for that element's primary copy.
  useEffect(() => {
    if (!selectedZone) return;
    const v = String((selectedZone.defaultConfig as Record<string, any> | undefined)?.variant || '');
    const dc = (selectedZone.defaultConfig || {}) as Record<string, any>;
    const primary =
      v.startsWith('sb-team-name') || v.startsWith('sb-team-abbr') ? 'teamName'
      : v.startsWith('sb-team-logo') ? 'logoUrl'
      : v === 'sb-sponsor' ? 'imageUrl'
      : v === 'scoreboard-main' ? 'homeName'
      : (v.startsWith('sb-') && dc.label !== undefined) ? 'label'
      : null;
    if (!primary) return;
    // Let the panel render the field first (the handler also retries),
    // then point it at the primary field for this element.
    const t = setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('template-edit-field', {
          detail: { zoneId: selectedZone.id, fieldKey: primary, sectionKey: primary },
        }),
      );
    }, 60);
    return () => clearTimeout(t);
  }, [selectedZone?.id]);

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
  const supportsPerFieldStyles = !!selectedZone && !isImage && !isTextStyle && !isSportEl;
  const isPerFieldText = supportsPerFieldStyles && !!activeFieldName;
  const canonicalFieldStyles = (cfg._styles && typeof cfg._styles === 'object' ? cfg._styles : {}) as Record<string, any>;
  // HOLIDAY briefly shipped a private `__styles` map. Read it into the
  // toolbar so existing saved templates show their real values, then migrate
  // the full merged map atomically on the first edit/reset below.
  const fieldStyles = wt === 'HOLIDAY'
    ? mergeHolidayTextStyleMaps(cfg.__styles, canonicalFieldStyles) as Record<string, any>
    : canonicalFieldStyles;
  const curFieldStyle = (activeFieldName && fieldStyles[activeFieldName]) || {};
  const fieldBoldOn = isHolidayStyleToggleActive(curFieldStyle, 'bold');
  const fieldItalicOn = isHolidayStyleToggleActive(curFieldStyle, 'italic');
  const fieldUnderlineOn = isHolidayStyleToggleActive(curFieldStyle, 'underline');
  const fieldStrikethroughOn = isHolidayStyleToggleActive(curFieldStyle, 'strikethrough');
  const fieldHiddenOn = isHolidayStyleToggleActive(curFieldStyle, 'hidden');
  const setFieldStyleProp = (prop: string, value: number | string | boolean | undefined) => {
    if (!selectedZone || !activeFieldName) return;
    const current = { ...(fieldStyles[activeFieldName] || {}) };
    const toggleProps = ['bold', 'italic', 'underline', 'strikethrough', 'hidden'] as const;
    const isToggle = (toggleProps as readonly string[]).includes(prop);
    const existing = isToggle
      ? updateHolidayStyleToggle(
          current,
          prop as (typeof toggleProps)[number],
          value === true,
        ) as Record<string, any>
      : current;
    if (!isToggle && (value === undefined || value === '' || value === false || (typeof value === 'number' && !Number.isFinite(value)))) {
      delete existing[prop];
    } else if (!isToggle) {
      existing[prop] = value;
    }
    const nextStyles = { ...fieldStyles };
    if (Object.keys(existing).length === 0) {
      delete nextStyles[activeFieldName];
    } else {
      nextStyles[activeFieldName] = existing;
    }
    setCfg(wt === 'HOLIDAY'
      ? { _styles: nextStyles, __styles: {} }
      : { _styles: nextStyles });
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
    // data-builder-bottom-bar: BuilderCanvas measures this element to
    // reserve exactly the room it occupies. Keep the attribute if the
    // bar is restyled — without it the canvas falls back to a constant.
    <div data-builder-bottom-bar className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 bg-white border border-slate-200 rounded-2xl shadow-lg flex items-center gap-1 px-2 py-1.5">

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
                () => setFieldStyleProp('bold', !fieldBoldOn),
                <Bold className="w-3.5 h-3.5" />,
                false,
                fieldBoldOn,
              )}
              {smallBtn(
                'Italic (Ctrl/⌘+I)',
                () => setFieldStyleProp('italic', !fieldItalicOn),
                <Italic className="w-3.5 h-3.5" />,
                false,
                fieldItalicOn,
              )}
              {smallBtn(
                'Underline (Ctrl/⌘+U)',
                () => setFieldStyleProp('underline', !fieldUnderlineOn),
                <Underline className="w-3.5 h-3.5" />,
                false,
                fieldUnderlineOn,
              )}
              {smallBtn(
                'Strikethrough',
                () => setFieldStyleProp('strikethrough', !fieldStrikethroughOn),
                <Strikethrough className="w-3.5 h-3.5" />,
                false,
                fieldStrikethroughOn,
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

              <label className="relative w-8 h-8 rounded-md flex items-center justify-center cursor-pointer hover:bg-slate-100" title="Text background color" aria-label="Text background color">
                <Paintbrush className="w-3.5 h-3.5 text-slate-600" />
                <span
                  className="absolute bottom-1 left-1.5 right-1.5 h-1 rounded-sm border border-slate-300"
                  style={{ background: curFieldStyle.backgroundColor || 'transparent' }}
                />
                <input
                  type="color"
                  value={/^#[0-9a-f]{6}$/i.test(curFieldStyle.backgroundColor || '') ? curFieldStyle.backgroundColor : '#ffffff'}
                  onChange={(e) => setFieldStyleProp('backgroundColor', e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </label>
              {curFieldStyle.backgroundColor && smallBtn(
                'Clear text background',
                () => setFieldStyleProp('backgroundColor', undefined),
                <span className="text-[10px] font-bold">BG×</span>,
              )}

              {smallBtn(
                fieldHiddenOn ? 'Show field' : 'Hide field',
                () => setFieldStyleProp('hidden', !fieldHiddenOn),
                fieldHiddenOn ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />,
                false,
                fieldHiddenOn,
              )}

              {/* Brand-color presets — resolve to the per-template brand kit
                  (BuilderCanvas scopes --brand-primary / --brand-accent to
                  [data-template-canvas]). Stored as the literal CSS var string
                  so a brand recolor live-updates every field that picked it.
                  Satisfies the Editability Standard's "Brand primary / accent"
                  requirement on every color field. */}
              {smallBtn(
                'Brand primary color',
                () => setFieldStyleProp('color', 'var(--brand-primary)'),
                <span
                  className="w-3.5 h-3.5 rounded-full border border-slate-300"
                  style={{ background: 'var(--brand-primary, #4f46e5)' }}
                />,
                false,
                curFieldStyle.color === 'var(--brand-primary)',
              )}
              {smallBtn(
                'Brand accent color',
                () => setFieldStyleProp('color', 'var(--brand-accent)'),
                <span
                  className="w-3.5 h-3.5 rounded-full border border-slate-300"
                  style={{ background: 'var(--brand-accent, #ec4899)' }}
                />,
                false,
                curFieldStyle.color === 'var(--brand-accent)',
              )}

              <div className="w-px h-5 bg-slate-200 mx-0.5" />

              {/* Text alignment — cycles left → center → right → justify.
                  Writes _styles[field].textAlign, applied by BuilderZone. */}
              {smallBtn(
                `Align: ${curFieldStyle.textAlign || 'left'} (click to cycle)`,
                () => {
                  const cur = curFieldStyle.textAlign || 'left';
                  const next = cur === 'left' ? 'center' : cur === 'center' ? 'right' : cur === 'right' ? 'justify' : 'left';
                  setFieldStyleProp('textAlign', next === 'left' ? undefined : next);
                },
                curFieldStyle.textAlign === 'center'
                  ? <AlignCenter className="w-3.5 h-3.5" />
                  : curFieldStyle.textAlign === 'right'
                    ? <AlignRight className="w-3.5 h-3.5" />
                    : curFieldStyle.textAlign === 'justify'
                      ? <AlignJustify className="w-3.5 h-3.5" />
                      : <AlignLeft className="w-3.5 h-3.5" />,
                false,
                !!curFieldStyle.textAlign,
              )}

              {/* Line-height — steps 1.0 → 2.0 in 0.1 increments. */}
              <div className="flex items-center ml-0.5" title="Line height">
                {smallBtn('Tighter line height', () => {
                  const cur = typeof curFieldStyle.lineHeight === 'number' ? curFieldStyle.lineHeight : 1.4;
                  const next = Math.round(Math.max(1, cur - 0.1) * 10) / 10;
                  setFieldStyleProp('lineHeight', next === 1.4 ? undefined : next);
                }, <span className="text-base leading-none font-semibold">−</span>)}
                <span className="h-8 w-8 px-1 text-[10px] flex items-center justify-center rounded-md bg-white border border-slate-200 tabular-nums" aria-label="Line height value">
                  {typeof curFieldStyle.lineHeight === 'number' ? curFieldStyle.lineHeight.toFixed(1) : '1.4'}
                </span>
                {smallBtn('Looser line height', () => {
                  const cur = typeof curFieldStyle.lineHeight === 'number' ? curFieldStyle.lineHeight : 1.4;
                  const next = Math.round(Math.min(2, cur + 0.1) * 10) / 10;
                  setFieldStyleProp('lineHeight', next === 1.4 ? undefined : next);
                }, <span className="text-base leading-none font-semibold">+</span>)}
              </div>

              {Object.keys(curFieldStyle).length > 0 && smallBtn(
                'Reset field overrides',
                () => {
                  if (!activeFieldName) return;
                  const next = { ...fieldStyles };
                  delete next[activeFieldName];
                  setCfg(wt === 'HOLIDAY'
                    ? { _styles: next, __styles: {} }
                    : { _styles: next });
                },
                <span className="text-[10px] font-bold">↺</span>,
                true,
              )}

              <div className="w-px h-5 bg-slate-300 mx-1" />
            </>
          )}

          {/* Selected widget but no field activated yet — hint */}
          {supportsPerFieldStyles && !activeFieldName && (
            <span className="px-3 text-[11px] italic text-slate-500 select-none whitespace-nowrap">
              Click any text on the canvas to edit its style
            </span>
          )}

          {/* TEXT / RICH_TEXT / TICKER + sport elements ─── font, size, B/I/U/S, color, align */}
          {(isTextStyle || isSportEl) && (
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
                `Align: ${cfg.textAlign || cfg.align || 'left'} (click to cycle)`,
                () => {
                  const cur = cfg.textAlign || cfg.align || 'left';
                  const next = cur === 'left' ? 'center' : cur === 'center' ? 'right' : 'left';
                  // Write both keys: text widgets read textAlign, sport elements read align.
                  setCfg({ textAlign: next, align: next });
                },
                (cfg.textAlign || cfg.align) === 'center'
                  ? <AlignCenter className="w-3.5 h-3.5" />
                  : (cfg.textAlign || cfg.align) === 'right'
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
                    {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control */}
                    <label htmlFor="bs-target-date-popover" className="block text-[10px] font-semibold text-slate-500 mb-1">Target date</label>
                    <input
                      id="bs-target-date-popover"
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
                    {/* a11y wave (2026-08-24) — jsx-a11y/label-has-associated-control */}
                    <label htmlFor="bs-page-url-popover" className="block text-[10px] font-semibold text-slate-500 mb-1">Page URL</label>
                    <input
                      id="bs-page-url-popover"
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
          {/* Backdrop — mouse-only convenience; the labeled Close button
              below is the keyboard/AT-accessible path. a11y wave
              (2026-08-24), same pattern as app-dialog.tsx's backdrop. */}
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
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
