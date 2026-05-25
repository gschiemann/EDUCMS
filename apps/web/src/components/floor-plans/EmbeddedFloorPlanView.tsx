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

export function EmbeddedFloorPlanView({ planId, schoolId, mode = 'standalone' }: EmbeddedFloorPlanViewProps) {
  const { data: plan, isLoading } = useFloorPlan(planId);
  const { data: allScreens } = useScreens();
  const placeMutation = usePlaceScreenOnFloor();
  const stageRef = useRef<HTMLDivElement>(null);
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [stageScale, setStageScale] = useState(1);
  const [optimisticPositions, setOptimisticPositions] = useState<Record<string, { floorX: number; floorY: number }>>({});

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

  const onDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const screenId = e.dataTransfer.getData('text/screen-id');
      if (!screenId || !plan) return;
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      const fx = ox / stageScale;
      const fy = oy / stageScale;
      setOptimisticPositions((prev) => ({ ...prev, [screenId]: { floorX: fx, floorY: fy } }));
      try {
        await placeMutation.mutateAsync({ planId: plan.id, screenId, floorX: fx, floorY: fy });
      } catch (err: any) {
        setOptimisticPositions((prev) => {
          const next = { ...prev };
          delete next[screenId];
          return next;
        });
        await appAlert({
          title: "Couldn't place screen",
          message: err?.message || 'Try again — if it keeps failing the screen may have been deleted.',
          tone: 'danger',
        });
      }
    },
    [plan, stageScale, placeMutation],
  );

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
            className="relative w-full bg-slate-100"
            style={{ aspectRatio: `${plan.widthPx} / ${plan.heightPx}` }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
            onDrop={onDrop}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={plan.imageUrl}
              alt={`${plan.name} floor plan`}
              draggable={false}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
            />
            {placedScreens.map((s) => (
              <ScreenPin
                key={s.id}
                screen={s}
                planWidthPx={plan.widthPx}
                planHeightPx={plan.heightPx}
                planId={plan.id}
                onMoveOptimistic={(screenId, position) => {
                  setOptimisticPositions((prev) => ({ ...prev, [screenId]: position }));
                }}
                onMoveRejected={(screenId) => {
                  setOptimisticPositions((prev) => {
                    const next = { ...prev };
                    delete next[screenId];
                    return next;
                  });
                }}
                onSelect={() => setSelectedScreenId(s.id)}
                selected={selectedScreenId === s.id}
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
                  Drag a screen onto the plan to place it. Drag a placed screen anywhere on the plan to move it.
                </p>
                <ul className="grid grid-cols-2 gap-2">
                  {unplaced.map((s: any) => (
                    <li key={s.id}>
                      <DraggableScreenCard screen={s} />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </RoleGate>
        </aside>
      </div>

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

// ─── Unplaced screen card (sidebar — drag source) ─────────────────
//
// 2026-05-25 — was a single-row button with a status dot + name.
// Operator: "make the screens that you can drag and drop more obvious
// that this is what they are there for, make them little screen icons
// with the name." Now each unplaced item renders as a small TV-shaped
// tile (screen body + name on the face + a stand) so it's visually
// obvious that THIS THING is meant to live on the plan.
function DraggableScreenCard({ screen }: { screen: any }) {
  const statusDotClass =
    screen.status === 'ONLINE'
      ? 'bg-emerald-500'
      : screen.status === 'OFFLINE'
        ? 'bg-rose-500'
        : 'bg-slate-300';
  return (
    <div
      role="button"
      draggable
      tabIndex={0}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/screen-id', screen.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="group flex flex-col items-center select-none cursor-grab active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 rounded-lg p-1.5 hover:bg-violet-50/50 transition-colors"
      title={`${screen.name}\n${screen.status}\nDrag onto the plan to place it`}
      aria-label={`${screen.name} — ${screen.status} — drag onto the plan to place`}
    >
      {/* Monitor body — the "screen" face */}
      <div className="relative w-full aspect-[16/10] rounded-md bg-gradient-to-br from-slate-700 to-slate-900 border-2 border-slate-700 shadow-md group-hover:border-violet-400 group-hover:shadow-lg transition-all flex items-center justify-center px-2">
        <Monitor className="absolute top-1 left-1 w-2.5 h-2.5 text-slate-400/60" />
        <span
          className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${statusDotClass}`}
          aria-hidden
        />
        <span className="text-[10px] font-bold text-white text-center leading-tight line-clamp-2">
          {screen.name}
        </span>
      </div>
      {/* Stand + base — sells the "this is a TV/screen" metaphor */}
      <div className="w-1 h-1 bg-slate-500" />
      <div className="w-6 h-0.5 bg-slate-500 rounded-full" />
      {screen.location && (
        <p className="text-[9px] text-slate-500 truncate w-full text-center mt-1">
          {screen.location}
        </p>
      )}
    </div>
  );
}

// ─── Pin (placed screen) ──────────────────────────────────────────

function ScreenPin({
  screen,
  planWidthPx,
  planHeightPx,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  planId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onMoveOptimistic,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onMoveRejected,
  onSelect,
  selected,
}: {
  screen: FloorPlanScreen;
  planWidthPx: number;
  planHeightPx: number;
  planId: string;
  onMoveOptimistic: (screenId: string, position: { floorX: number; floorY: number }) => void;
  onMoveRejected: (screenId: string) => void;
  onSelect: () => void;
  selected: boolean;
}) {
  const xPct = ((screen.floorX || 0) / planWidthPx) * 100;
  const yPct = ((screen.floorY || 0) / planHeightPx) * 100;

  const isOnline = screen.status === 'ONLINE';
  const hasScreenContent = hasConfiguredEmergencyContent(screen);

  // 2026-05-25 — was draggable WITHOUT onDragStart, which means
  // dataTransfer was never populated and the stage's onDrop (the only
  // mutation path) saw empty data and bailed. Result: placed pins
  // appeared stuck after first placement. Now we set text/screen-id
  // on dragstart so the SAME stage onDrop path that handles
  // sidebar-→-plan ALSO handles plan-→-plan (placeMutation is
  // idempotent — same endpoint, just new (floorX, floorY)).
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/screen-id', screen.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onClick={onSelect}
      className="absolute -translate-x-1/2 -translate-y-full focus:outline-none group"
      style={{ left: `${xPct}%`, top: `${yPct}%` }}
      aria-label={`${screen.name} — ${screen.status}`}
      title={`${screen.name}\n${screen.status}\n${hasScreenContent ? 'Emergency content configured\n' : ''}Drag to reposition · click to configure`}
    >
      {/* Monitor body */}
      <div
        className={`relative flex items-center justify-center rounded-md shadow-lg ring-2 transition-all group-hover:scale-110 ${
          hasScreenContent
            ? 'bg-violet-500 ring-violet-300'
            : isOnline
              ? 'bg-emerald-500 ring-emerald-300'
              : 'bg-slate-400 ring-slate-200'
        } ${selected ? 'ring-4 ring-offset-2 ring-violet-400' : ''}`}
        style={{ width: PIN_RADIUS * 1.6, height: PIN_RADIUS * 1.1 }}
      >
        <Monitor className="w-3.5 h-3.5 text-white" />
        {hasScreenContent && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-white border border-violet-500" />
        )}
      </div>
      {/* Stand */}
      <div className="mx-auto w-1 h-1.5 bg-slate-500/60" />
      <div className="mx-auto w-3 h-0.5 bg-slate-500/60 rounded-full" />
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
