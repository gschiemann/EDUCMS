"use client";

/**
 * EmbeddedFloorPlanView — reusable floor-plan editor.
 *
 * Originally lived inline in /[schoolId]/floor-plans/[id]/page.tsx as
 * `FloorPlanDetailView`. Extracted on 2026-04-27 because the operator
 * wants the floor map embedded directly inside Settings → Panic Button
 * Content (not a separate page click). One component, two mount points:
 *
 *   • /[schoolId]/floor-plans/[id]/page.tsx — full standalone page,
 *     renders this with `mode="standalone"` (shows the back-to-all
 *     header).
 *   • /[schoolId]/settings/page.tsx — when location mode is on, mounts
 *     this with `mode="embedded"` (no header) so the map slots cleanly
 *     under the toggle.
 *
 * Click a screen pin → ScreenDetailDrawer slides in from the right
 * with the upload-only emergency content config (twelve drop targets,
 * 6 types × 2 orientations). Drag unplaced screens from the side panel
 * onto the plan to position them.
 */

import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowLeft, Loader2, AlertTriangle, MapPin, X, Wifi, WifiOff, Power, Monitor } from 'lucide-react';
import { RoleGate } from '@/components/RoleGate';
import {
  useFloorPlan,
  usePlaceScreenOnFloor,
  useDetachScreenFromFloor,
  useScreens,
  type FloorPlanScreen,
} from '@/hooks/use-api';
import { ScreenEmergencyContentConfig } from '@/components/settings/ScreenEmergencyContentConfig';
import { appAlert, appConfirm } from '@/components/ui/app-dialog';

const PIN_RADIUS = 18;
const EMERGENCY_CONTENT_KEYS: Array<keyof FloorPlanScreen> = [
  'emergencyLockdownPlaylistId',
  'emergencyEvacuatePlaylistId',
  'emergencyWeatherPlaylistId',
  'emergencyHoldPlaylistId',
  'emergencySecurePlaylistId',
  'emergencyMedicalPlaylistId',
  'emergencyLockdownAssetUrl',
  'emergencyEvacuateAssetUrl',
  'emergencyWeatherAssetUrl',
  'emergencyHoldAssetUrl',
  'emergencySecureAssetUrl',
  'emergencyMedicalAssetUrl',
  'emergencyLockdownPortraitPlaylistId',
  'emergencyEvacuatePortraitPlaylistId',
  'emergencyWeatherPortraitPlaylistId',
  'emergencyHoldPortraitPlaylistId',
  'emergencySecurePortraitPlaylistId',
  'emergencyMedicalPortraitPlaylistId',
  'emergencyLockdownPortraitAssetUrl',
  'emergencyEvacuatePortraitAssetUrl',
  'emergencyWeatherPortraitAssetUrl',
  'emergencyHoldPortraitAssetUrl',
  'emergencySecurePortraitAssetUrl',
  'emergencyMedicalPortraitAssetUrl',
];

function hasConfiguredEmergencyContent(screen: FloorPlanScreen) {
  return EMERGENCY_CONTENT_KEYS.some((key) => Boolean(screen[key]));
}

interface EmbeddedFloorPlanViewProps {
  planId: string;
  schoolId: string;
  /** Standalone page shows back-link header; embedded omits it. */
  mode?: 'standalone' | 'embedded';
}

// ─── Drag state (pointer-event-based; floating preview follows cursor) ──
//
// 2026-05-25 — operator: "when i select and drag and drop the screen,
// the screen doesnt float with the cursor, it should allow me to click
// and hold down the button and the screen moves with my cursor then
// when i let go of the click it drops it right in that area."
//
// HTML5 native drag-and-drop relies on a browser-generated translucent
// ghost image that varies wildly across Chromium / WebKit / Gecko and
// never visually MOVES the source — the operator's expectation is that
// the icon itself follows the cursor. The fix is to switch to pointer
// events with a portal-rendered floating preview at fixed viewport
// coordinates, updated on every pointermove. Click-vs-drag is decided
// by a 5px movement threshold so the placed pin's tap-to-open-drawer
// behavior survives.

type DragHandle = {
  screenId: string;
  /** Where the drag began in client coords — used for threshold + cursor offset. */
  startClientX: number;
  startClientY: number;
  /** Cursor offset relative to icon center, so the icon doesn't jump on grab. */
  offsetX: number;
  offsetY: number;
  /** Snapshot of the screen so the floating preview can render without re-fetching. */
  screen: { id: string; name: string; status?: string };
  /** Fired on pointerup if the drag never crossed the threshold (i.e., it was a click). */
  onClickFallback: () => void;
};

const DRAG_THRESHOLD_PX = 5;

export function EmbeddedFloorPlanView({ planId, schoolId, mode = 'standalone' }: EmbeddedFloorPlanViewProps) {
  const { data: plan, isLoading } = useFloorPlan(planId);
  const { data: allScreens } = useScreens();
  const placeMutation = usePlaceScreenOnFloor();
  const stageRef = useRef<HTMLDivElement>(null);
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [stageScale, setStageScale] = useState(1);
  const [optimisticPositions, setOptimisticPositions] = useState<Record<string, { floorX: number; floorY: number }>>({});

  // Drag state. `dragHandle` is set once (on pointerdown) and cleared on
  // pointerup/cancel. `dragPos` updates on every pointermove with
  // current cursor coords; `active` flips true once we cross the
  // 5px threshold so the floating preview only renders for real drags.
  const [dragHandle, setDragHandle] = useState<DragHandle | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number; active: boolean; overStage: boolean }>({
    x: 0,
    y: 0,
    active: false,
    overStage: false,
  });

  useEffect(() => {
    setOptimisticPositions({});
  }, [planId]);

  useEffect(() => {
    if (!plan) return;
    const update = () => {
      const el = stageRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const sx = rect.width / plan.widthPx;
      const sy = rect.height / plan.heightPx;
      setStageScale(Math.min(sx, sy));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [plan]);

  // ── Drag pipeline ───────────────────────────────────────────
  //
  // Started by DraggableScreenCard / ScreenPin via the `startDrag`
  // callback below (passed down as props). One global pointermove +
  // pointerup pair handles preview tracking + drop resolution.
  // Re-runs only when dragHandle starts/stops, not on every move.
  const startDrag = useCallback((handle: DragHandle) => {
    setDragHandle(handle);
    setDragPos({
      x: handle.startClientX,
      y: handle.startClientY,
      active: false,
      overStage: false,
    });
  }, []);

  useEffect(() => {
    if (!dragHandle) return;

    const stageHitTest = (x: number, y: number) => {
      const stage = stageRef.current;
      if (!stage) return false;
      const r = stage.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };

    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - dragHandle.startClientX;
      const dy = e.clientY - dragHandle.startClientY;
      const beyondThreshold = Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
      setDragPos((prev) => ({
        x: e.clientX,
        y: e.clientY,
        active: prev.active || beyondThreshold,
        overStage: stageHitTest(e.clientX, e.clientY),
      }));
    };

    const finish = (e: PointerEvent | null, wasCancelled: boolean) => {
      const dx = (e?.clientX ?? dragHandle.startClientX) - dragHandle.startClientX;
      const dy = (e?.clientY ?? dragHandle.startClientY) - dragHandle.startClientY;
      const wasActive = Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;

      // Tap (not a drag) → fall back to the click handler (open drawer).
      if (!wasActive && !wasCancelled) {
        try {
          dragHandle.onClickFallback();
        } catch {
          /* ignore */
        }
        setDragHandle(null);
        setDragPos({ x: 0, y: 0, active: false, overStage: false });
        return;
      }

      // Cancelled or dropped outside stage → no placement.
      if (wasCancelled || !e || !stageHitTest(e.clientX, e.clientY) || !plan) {
        setDragHandle(null);
        setDragPos({ x: 0, y: 0, active: false, overStage: false });
        return;
      }

      // Compute floor-plan pixel coords from cursor position.
      const stage = stageRef.current;
      if (!stage) {
        setDragHandle(null);
        setDragPos({ x: 0, y: 0, active: false, overStage: false });
        return;
      }
      const rect = stage.getBoundingClientRect();
      const fx = (e.clientX - rect.left) / stageScale;
      const fy = (e.clientY - rect.top) / stageScale;
      const screenId = dragHandle.screenId;
      // Was this screen already on the plan (re-positioning) or
      // brand new to the plan? Used below to decide whether to
      // auto-open the emergency-content drawer.
      const wasAlreadyPlaced = !!plan.screens.find((s) => s.id === screenId);
      setOptimisticPositions((prev) => ({ ...prev, [screenId]: { floorX: fx, floorY: fy } }));
      placeMutation
        .mutateAsync({ planId: plan.id, screenId, floorX: fx, floorY: fy })
        .then(() => {
          // 2026-05-25 — operator: "when you drop one that should
          // engage the settings page for that screen to add the
          // emergency content, otherwise its not really clear when
          // or where you add that info." On a FRESH placement
          // (sidebar → plan), auto-open the drawer so the operator
          // immediately sees the per-screen emergency-content
          // editor. On a re-position (plan → plan) we DON'T re-open
          // the drawer — that would be annoying when nudging pins
          // to refine the floor layout.
          if (!wasAlreadyPlaced) {
            setSelectedScreenId(screenId);
          }
        })
        .catch((err: any) => {
          setOptimisticPositions((prev) => {
            const next = { ...prev };
            delete next[screenId];
            return next;
          });
          appAlert({
            title: "Couldn't place screen",
            message: err?.message || 'Try again — if it keeps failing the screen may have been deleted.',
            tone: 'danger',
          });
        });

      setDragHandle(null);
      setDragPos({ x: 0, y: 0, active: false, overStage: false });
    };

    const onUp = (e: PointerEvent) => finish(e, false);
    const onCancel = (e: PointerEvent) => finish(e, true);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
  }, [dragHandle, plan, stageScale, placeMutation]);

  const screensList = useMemo(() => {
    return Array.isArray(allScreens) ? allScreens : (allScreens as any)?.screens || [];
  }, [allScreens]);

  const placedScreens = useMemo(() => {
    if (!plan) return [];
    const byId = new Set<string>();
    const merged = plan.screens.map((screen) => {
      byId.add(screen.id);
      const optimistic = optimisticPositions[screen.id];
      const liveScreen = screensList.find((s: any) => s.id === screen.id);
      const withLiveStatus = liveScreen
        ? {
            ...screen,
            status: liveScreen.status ?? screen.status,
            lastPingAt: liveScreen.lastPingAt ?? screen.lastPingAt,
          }
        : screen;
      return optimistic ? { ...withLiveStatus, ...optimistic } : withLiveStatus;
    });

    for (const [screenId, position] of Object.entries(optimisticPositions)) {
      if (byId.has(screenId)) continue;
      const screen = screensList.find((s: any) => s.id === screenId);
      if (screen) {
        merged.push({ ...screen, ...position } as FloorPlanScreen);
      }
    }

    return merged.filter((s) => s.floorX != null && s.floorY != null);
  }, [plan, screensList, optimisticPositions]);

  useEffect(() => {
    if (!plan) return;
    setOptimisticPositions((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [screenId, position] of Object.entries(prev)) {
        const screen = plan.screens.find((s) => s.id === screenId);
        if (
          screen?.floorX != null &&
          screen?.floorY != null &&
          Math.abs(screen.floorX - position.floorX) < 0.5 &&
          Math.abs(screen.floorY - position.floorY) < 0.5
        ) {
          delete next[screenId];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [plan]);

  const unplaced = useMemo(() => {
    if (!plan || !allScreens) return [];
    const placedIds = new Set(placedScreens.map((s) => s.id));
    return screensList.filter((s: any) => !placedIds.has(s.id));
  }, [plan, allScreens, screensList, placedScreens]);

  // 2026-05-25 — old HTML5 onDrop callback removed. All drop logic now
  // lives inside the pointer-event effect above; the stage no longer
  // needs onDragOver/onDrop wiring. The mutation path (placeMutation)
  // is the same — just driven by pointerup instead of dragend.

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }
  if (!plan) {
    return (
      <div className="text-center py-12 space-y-3">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
        <h1 className="text-base font-bold text-slate-800">Floor plan not found</h1>
        {mode === 'standalone' && (
          <Link href={`/${schoolId}/floor-plans`} className="text-xs text-indigo-600 underline">Back to all plans</Link>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {mode === 'standalone' && (
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={`/${schoolId}/floor-plans`} className="text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 text-xs">
              <ArrowLeft className="w-3.5 h-3.5" /> All plans
            </Link>
            <div>
              <h1 className="text-lg font-bold text-slate-800">{plan.name}</h1>
              <p className="text-[11px] text-slate-500">
                {[plan.buildingLabel, plan.floorLabel].filter(Boolean).join(' · ') || '—'}
                {' · '}{plan.widthPx} × {plan.heightPx} px
                {' · '}{placedScreens.length} placed
              </p>
            </div>
          </div>
        </header>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        {/* Stage — the plan image with pins */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div
            ref={stageRef}
            className={`relative w-full bg-slate-100 transition-all ${
              dragPos.active && dragPos.overStage ? 'ring-4 ring-rose-300 ring-inset' : ''
            }`}
            style={{ aspectRatio: `${plan.widthPx} / ${plan.heightPx}` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={plan.imageUrl}
              alt={`${plan.name} floor plan`}
              draggable={false}
              className="absolute top-0 right-0 bottom-0 left-0 w-full h-full object-contain pointer-events-none select-none"
            />
            {placedScreens.map((s) => (
              <ScreenPin
                key={s.id}
                screen={s}
                planWidthPx={plan.widthPx}
                planHeightPx={plan.heightPx}
                startDrag={startDrag}
                onSelect={() => setSelectedScreenId(s.id)}
                selected={selectedScreenId === s.id}
                isBeingDragged={dragHandle?.screenId === s.id && dragPos.active}
              />
            ))}
          </div>
        </div>

        {/* Unplaced screens panel */}
        <aside className="space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
            Unplaced screens <span className="text-slate-300">({unplaced.length})</span>
          </div>
          <RoleGate
            allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}
            fallback={
              <p className="text-[11px] text-slate-400 italic leading-relaxed">
                Admins can drag screens here to place them. Your role is read-only on this surface.
              </p>
            }
          >
            {unplaced.length === 0 ? (
              <p className="text-[11px] text-slate-400 italic leading-relaxed">
                Every paired screen is placed on a plan. Pair more from the Screens page.
              </p>
            ) : (
              <>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Click and hold a screen, then drag it onto the plan where it physically lives. After you drop it, set the emergency content for that screen.
                </p>
                <ul className="grid grid-cols-2 gap-2">
                  {unplaced.map((s: any) => (
                    <li key={s.id}>
                      <DraggableScreenCard
                        screen={s}
                        startDrag={startDrag}
                        isBeingDragged={dragHandle?.screenId === s.id && dragPos.active}
                      />
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/* Discoverability nudge for placed pins that still have
                no emergency content. Without this, an operator who
                placed pins in an earlier session has no signal that
                clicking each one is the next step. */}
            {(() => {
              const placedWithoutContent = placedScreens.filter(
                (s) => !hasConfiguredEmergencyContent(s),
              );
              if (placedWithoutContent.length === 0) return null;
              return (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                  <strong className="font-bold">
                    {placedWithoutContent.length} placed{' '}
                    {placedWithoutContent.length === 1 ? 'screen has' : 'screens have'}
                  </strong>{' '}
                  no emergency content yet. Click each pin to set its lockdown / evacuate / weather / hold / secure / medical content.
                </div>
              );
            })()}
          </RoleGate>
        </aside>
      </div>

      {/* Floating preview — follows the cursor while drag is active.
          Rendered to <body> via portal so it escapes any overflow-hidden
          ancestor (the stage card has overflow:hidden). Pointer events
          disabled on the preview itself so it can't intercept the
          pointerup that finishes the drop. */}
      {dragHandle && dragPos.active && typeof document !== 'undefined' &&
        createPortal(
          <div
            style={{
              position: 'fixed',
              left: dragPos.x - dragHandle.offsetX,
              top: dragPos.y - dragHandle.offsetY,
              zIndex: 9999,
              pointerEvents: 'none',
              transform: 'rotate(-2deg)',
              filter: 'drop-shadow(0 8px 16px rgba(15, 23, 42, 0.25))',
            }}
            aria-hidden
          >
            <FloatingScreenPreview screen={dragHandle.screen} />
          </div>,
          document.body,
        )}

      {selectedScreenId && (
        <ScreenDetailDrawer
          screenId={selectedScreenId}
          planId={plan.id}
          screen={placedScreens.find((s) => s.id === selectedScreenId)!}
          onClose={() => setSelectedScreenId(null)}
          onDetached={() => setSelectedScreenId(null)}
        />
      )}
    </div>
  );
}

// ─── Shared chip visual (pin look) ────────────────────────────────
// One visual primitive for: sidebar tile, floating drag preview,
// placed pin. Operator: "just keep the little grey icon when i
// drag and drop and dont switch back to the big one, infact just
// do the grey icons on the right side as well but they can be a
// little bigger until you drop them." So: sidebar uses the same
// pin look, just SIZE_SIDEBAR; floating drag preview also uses it
// at SIZE_SIDEBAR so the visual continuity is total — what you
// grab is what follows the cursor is what lands on the plan
// (just shrunk to SIZE_PIN once placed).
const SIZE_SIDEBAR = { width: PIN_RADIUS * 2.8, height: PIN_RADIUS * 1.9 }; // ~50×34
const SIZE_PIN = { width: PIN_RADIUS * 1.6, height: PIN_RADIUS * 1.1 }; // ~29×20

function ScreenChipBody({
  isOnline,
  hasContent,
  selected = false,
  size,
}: {
  isOnline: boolean;
  hasContent: boolean;
  selected?: boolean;
  size: { width: number; height: number };
}) {
  // Same color logic as the placed pin: violet > emerald > slate.
  // Sidebar tiles default to whatever the screen's status reports;
  // has-content is only known for placed screens, so a sidebar tile
  // is emerald (online) or slate (offline) until the screen is
  // placed AND given emergency content (then it goes violet on the
  // plan).
  return (
    <div
      className={`relative flex items-center justify-center rounded-md shadow-lg ring-2 transition-all ${
        hasContent
          ? 'bg-violet-500 ring-violet-300'
          : isOnline
            ? 'bg-emerald-500 ring-emerald-300'
            : 'bg-slate-400 ring-slate-200'
      } ${selected ? 'ring-4 ring-offset-2 ring-violet-400' : ''}`}
      style={size}
    >
      <Monitor className="w-3.5 h-3.5 text-white" />
      {hasContent && (
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-white border border-violet-500" />
      )}
    </div>
  );
}

// ─── Unplaced screen card (sidebar — drag source) ─────────────────
//
// 2026-05-25 (afternoon revision) — operator: "just keep the little
// grey icon when i drag and drop and dont switch back to the big
// one, infact just do the grey icons on the right side as well but
// they can be a little bigger until you drop them." Sidebar tile
// is now the SAME chip visual as the placed pin (status-colored
// rectangle with a Monitor glyph), just at SIZE_SIDEBAR so it's
// grabbable. The name label sits underneath the chip on a single
// line; long names truncate.
//
// Earlier same-day changes still apply:
//   - No stand. The chip is the whole visual.
//   - Pointer-event drag (pointerdown → cursor-follow → pointerup).
//   - Source dims to 30% opacity while a drag is active so the
//     "lift" reads visually.
function DraggableScreenCard({
  screen,
  startDrag,
  isBeingDragged,
}: {
  screen: any;
  startDrag: (handle: DragHandle) => void;
  isBeingDragged: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const isOnline = screen.status === 'ONLINE';

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Lock cursor offset to the CHIP center so the floating preview
    // sits centered under the cursor regardless of where the user
    // grabbed the surrounding tile area. Feels more deliberate than
    // grabbing from a corner.
    const offsetX = SIZE_SIDEBAR.width / 2;
    const offsetY = SIZE_SIDEBAR.height / 2;
    startDrag({
      screenId: screen.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      offsetX,
      offsetY,
      screen: { id: screen.id, name: screen.name, status: screen.status },
      onClickFallback: () => { /* sidebar tiles have no click action */ },
    });
  };

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDragStart={(e) => e.preventDefault()}
      style={{ touchAction: 'none' }}
      className={`group flex flex-col items-center gap-1.5 select-none cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 rounded-lg p-2 hover:bg-slate-50 transition-opacity ${
        isBeingDragged ? 'opacity-30' : 'opacity-100'
      }`}
      title={`${screen.name}\n${screen.status}\nClick and hold, then drag onto the plan`}
      aria-label={`${screen.name} — ${screen.status} — click and hold to drag onto the plan`}
    >
      <ScreenChipBody isOnline={isOnline} hasContent={false} size={SIZE_SIDEBAR} />
      <span className="text-[10px] font-semibold text-slate-700 text-center leading-tight line-clamp-2 max-w-full">
        {screen.name}
      </span>
    </div>
  );
}

// ─── Floating preview (rendered while a drag is active) ──────────
// Renders the SAME chip visual at SIZE_SIDEBAR — what the operator
// grabbed is what's flying with the cursor is what lands on the
// plan. Rendered via a portal so it escapes any `overflow:hidden`
// ancestor (the stage card has it).
function FloatingScreenPreview({ screen }: { screen: { id: string; name: string; status?: string } }) {
  const isOnline = screen.status === 'ONLINE';
  return (
    <div className="flex flex-col items-center gap-1.5">
      <ScreenChipBody isOnline={isOnline} hasContent={false} size={SIZE_SIDEBAR} />
      <span className="text-[10px] font-semibold text-slate-700 text-center leading-tight bg-white/90 px-1.5 py-0.5 rounded shadow-sm">
        {screen.name}
      </span>
    </div>
  );
}

// ─── Pin (placed screen) ──────────────────────────────────────────

function ScreenPin({
  screen,
  planWidthPx,
  planHeightPx,
  startDrag,
  onSelect,
  selected,
  isBeingDragged,
}: {
  screen: FloorPlanScreen;
  planWidthPx: number;
  planHeightPx: number;
  startDrag: (handle: DragHandle) => void;
  onSelect: () => void;
  selected: boolean;
  isBeingDragged: boolean;
}) {
  const pinRef = useRef<HTMLButtonElement>(null);
  const xPct = ((screen.floorX || 0) / planWidthPx) * 100;
  const yPct = ((screen.floorY || 0) / planHeightPx) * 100;

  const isOnline = screen.status === 'ONLINE';
  const hasScreenContent = hasConfiguredEmergencyContent(screen);

  // 2026-05-25 — operator: stand removed (matches sidebar tile). And
  // moved from HTML5 draggable to pointer events so the icon visibly
  // follows the cursor during drag (via the parent's portal-rendered
  // floating preview). Click-vs-drag is decided by the 5px movement
  // threshold inside the parent's pointerup handler: short presses
  // call `onSelect` (open drawer), longer movements place the pin.
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = pinRef.current;
    let offsetX = 60;
    let offsetY = 38;
    if (el) {
      const r = el.getBoundingClientRect();
      offsetX = e.clientX - r.left;
      offsetY = e.clientY - r.top;
    }
    startDrag({
      screenId: screen.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      offsetX,
      offsetY,
      screen: { id: screen.id, name: screen.name, status: screen.status },
      onClickFallback: onSelect,
    });
  };

  return (
    <button
      ref={pinRef}
      type="button"
      onPointerDown={onPointerDown}
      onDragStart={(e) => e.preventDefault()}
      style={{
        left: `${xPct}%`,
        top: `${yPct}%`,
        touchAction: 'none',
      }}
      className={`absolute -translate-x-1/2 -translate-y-1/2 focus:outline-none group cursor-grab active:cursor-grabbing transition-opacity ${
        isBeingDragged ? 'opacity-30' : 'opacity-100'
      }`}
      aria-label={`${screen.name} — ${screen.status}`}
      title={`${screen.name}\n${screen.status}\n${hasScreenContent ? 'Emergency content configured\n' : ''}Drag to reposition · click to configure`}
    >
      {/* Monitor body — same chip primitive as the sidebar tile,
          just at SIZE_PIN (smaller) so placed pins don't crowd the
          plan. Centered on the drop coordinate. */}
      <div className="group-hover:scale-110 transition-transform">
        <ScreenChipBody
          isOnline={isOnline}
          hasContent={hasScreenContent}
          selected={selected}
          size={SIZE_PIN}
        />
      </div>
      <div className="absolute left-1/2 -translate-x-1/2 -bottom-5 whitespace-nowrap text-[9px] font-bold text-slate-700 bg-white/90 border border-slate-200 px-1.5 py-0.5 rounded shadow-sm opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        {screen.name}
      </div>
    </button>
  );
}

// ─── Drawer (right-side, opens when a pin is clicked) ─────────────

function ScreenDetailDrawer({
  screenId,
  planId,
  screen,
  onClose,
  onDetached,
}: {
  screenId: string;
  planId: string;
  screen: FloorPlanScreen;
  onClose: () => void;
  onDetached: () => void;
}) {
  const detachMutation = useDetachScreenFromFloor();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleDetach = async () => {
    const ok = await appConfirm({
      title: `Remove "${screen.name}" from this plan?`,
      message: 'The screen stays paired and keeps playing. It just won\'t show on this floor plan anymore.',
      tone: 'warn',
      confirmLabel: 'Remove pin',
    });
    if (!ok) return;
    try {
      await detachMutation.mutateAsync({ planId, screenId });
      onDetached();
    } catch (err: any) {
      await appAlert({
        title: "Couldn't remove pin",
        message: err?.message || 'Try again.',
        tone: 'danger',
      });
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[9999] bg-slate-900/30 backdrop-blur-[1px] animate-in fade-in duration-150"
        onClick={onClose}
        aria-hidden
      />
      <div role="dialog" aria-modal="true" className="fixed inset-y-0 right-0 z-[10000] w-full max-w-md bg-white border-l border-slate-200 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {screen.status === 'ONLINE' ? <Wifi className="w-4 h-4 text-emerald-500 shrink-0" /> : <WifiOff className="w-4 h-4 text-rose-500 shrink-0" />}
            <h2 className="text-sm font-bold text-slate-800 truncate">{screen.name}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close drawer (Esc)"
            title="Close (Esc)"
            className="ml-2 px-3 h-9 rounded-lg flex items-center gap-1.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 hover:text-slate-900 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            <span>Close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']} fallback={null}>
            <section>
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">
                Emergency content for this screen
              </div>
              <ScreenEmergencyContentConfig screenId={screenId} screen={screen} />
            </section>
          </RoleGate>

          {/* Detach pin */}
          <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']} fallback={null}>
            <section className="border-t border-slate-100 pt-5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Pin</div>
              <div className="text-[10px] text-slate-400 mb-2 leading-snug">
                Removes this screen from THIS floor plan only. The screen stays paired and keeps playing — you can drop it on a different plan or leave it unplaced.
              </div>
              <button
                onClick={handleDetach}
                disabled={detachMutation.isPending}
                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 hover:bg-slate-50 text-xs font-bold text-slate-700 inline-flex items-center justify-center gap-1.5"
              >
                <Power className="w-3.5 h-3.5" />
                Remove from this plan
              </button>
            </section>
          </RoleGate>
        </div>
      </div>
    </>
  );
}
