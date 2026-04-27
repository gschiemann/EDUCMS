"use client";

/**
 * Single floor plan editor — Sprint 8b Phase 1.
 *
 * Renders the plan image at its true pixel dimensions (scaled to fit
 * the viewport via transform: scale, like the template builder), shows
 * a panel of unplaced screens, lets the operator drag a screen onto
 * the plan to place it, and lets them drag placed screens to reposition.
 *
 * Click a placed pin to open a side panel with:
 *   - Screen status (online / offline / emergency)
 *   - "Trigger emergency on this screen only" — fires per-screen override
 *   - "Clear emergency" if an override is active
 *   - "Detach from plan" — removes the pin
 *
 * Phase 1 surface is intentionally lean. Polygon zones (FloorZone) +
 * scenario picker land in Phase 2.
 */

import { useState, useRef, useCallback, useMemo, use as usePromise, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, AlertTriangle, MapPin, X, Wifi, WifiOff, Shield, Power, Monitor, Upload, Trash2 } from 'lucide-react';
import { RoleGate } from '@/components/RoleGate';
import {
  useFloorPlan,
  usePlaceScreenOnFloor,
  useDetachScreenFromFloor,
  useScreens,
  useTriggerScreenEmergency,
  useClearScreenEmergency,
  useScreenEmergencyOverride,
  useUpdateScreenEmergencyContent,
  usePlaylists,
  type FloorPlanScreen,
} from '@/hooks/use-api';
import { appAlert, appConfirm } from '@/components/ui/app-dialog';

const PIN_RADIUS = 18; // px in plan-image coordinate space

export default function FloorPlanDetailPage() {
  return (
    <RoleGate
      allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER']}
      fallback={<div className="text-center py-24 text-sm text-slate-500">No access.</div>}
    >
      <FloorPlanDetailView />
    </RoleGate>
  );
}

function FloorPlanDetailView() {
  const params = useParams<{ schoolId: string; id: string }>();
  const id = params?.id ?? '';
  const schoolId = params?.schoolId ?? '';
  const { data: plan, isLoading } = useFloorPlan(id);
  const { data: allScreens } = useScreens();
  const placeMutation = usePlaceScreenOnFloor();
  const detachMutation = useDetachScreenFromFloor();
  const stageRef = useRef<HTMLDivElement>(null);
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(null);
  const [stageScale, setStageScale] = useState(1);

  // Compute scale so the plan fits the viewport. We work in plan-image
  // pixel coordinates internally — the same px coords that flow into
  // the API. Scaling is purely visual.
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

  // Pull tenant-wide screens that haven't been placed on THIS plan yet.
  const unplaced = useMemo(() => {
    if (!plan || !allScreens) return [];
    const placedIds = new Set(plan.screens.filter((s) => s.floorX != null && s.floorY != null).map((s) => s.id));
    const screensList: any[] = Array.isArray(allScreens) ? allScreens : (allScreens as any)?.screens || [];
    return screensList.filter((s) => !placedIds.has(s.id));
  }, [plan, allScreens]);

  // Drop target — converts viewport coords to plan-image px and saves.
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
      // Convert viewport px → plan-image px by dividing by current scale.
      const fx = ox / stageScale;
      const fy = oy / stageScale;
      try {
        await placeMutation.mutateAsync({ planId: plan.id, screenId, floorX: fx, floorY: fy });
      } catch (err: any) {
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
      <div className="text-center py-20 space-y-3">
        <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
        <h1 className="text-base font-bold text-slate-800">Floor plan not found</h1>
        <Link href={`/${schoolId}/floor-plans`} className="text-xs text-indigo-600 underline">Back to all plans</Link>
      </div>
    );
  }

  const placedScreens = plan.screens.filter((s) => s.floorX != null && s.floorY != null);

  return (
    <div className="space-y-4">
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
              <ul className="space-y-1.5">
                {unplaced.map((s: any) => (
                  <li key={s.id}>
                    <button
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('text/screen-id', s.id);
                        e.dataTransfer.effectAllowed = 'move';
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg bg-white border border-slate-200 hover:border-violet-300 hover:shadow-sm cursor-grab active:cursor-grabbing transition-all"
                    >
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${s.status === 'ONLINE' ? 'bg-emerald-500' : s.status === 'OFFLINE' ? 'bg-rose-500' : 'bg-slate-300'}`} />
                        <span className="text-xs font-semibold text-slate-700 truncate">{s.name}</span>
                      </div>
                      {s.location && <p className="text-[10px] text-slate-400 truncate mt-0.5">{s.location}</p>}
                    </button>
                  </li>
                ))}
              </ul>
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

// ─── Pin (placed screen) ──────────────────────────────────────────

function ScreenPin({
  screen,
  planWidthPx,
  planHeightPx,
  planId,
  onSelect,
  selected,
}: {
  screen: FloorPlanScreen;
  planWidthPx: number;
  planHeightPx: number;
  planId: string;
  onSelect: () => void;
  selected: boolean;
}) {
  const placeMutation = usePlaceScreenOnFloor();
  const { data: override } = useScreenEmergencyOverride(screen.id);
  // px % of the plan image so positioning stays correct under any scale
  const xPct = ((screen.floorX || 0) / planWidthPx) * 100;
  const yPct = ((screen.floorY || 0) / planHeightPx) * 100;

  const isOnline = screen.status === 'ONLINE';
  const hasOverride = !!override;

  const onDragEnd = async (e: React.DragEvent<HTMLButtonElement>) => {
    if (!e.currentTarget) return;
    const stage = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!stage) return;
    const ox = e.clientX - stage.left;
    const oy = e.clientY - stage.top;
    if (ox < 0 || oy < 0 || ox > stage.width || oy > stage.height) return;
    const fx = (ox / stage.width) * planWidthPx;
    const fy = (oy / stage.height) * planHeightPx;
    try {
      await placeMutation.mutateAsync({ planId, screenId: screen.id, floorX: fx, floorY: fy });
    } catch { /* swallow — react-query refetches on next interaction */ }
  };

  // Operator pointed out: these are SCREENS not points-of-interest.
  // Render the pin as a small monitor (rounded rectangle with a stand)
  // so the floor plan reads as "5 displays in the gym wing", not
  // "5 dropped pins". Color still encodes status; the active-emergency
  // override gets the pulsing rose treatment.
  const baseColor = hasOverride
    ? 'bg-rose-500 border-white'
    : isOnline
      ? 'bg-emerald-500 border-white'
      : 'bg-slate-400 border-white';
  return (
    <button
      type="button"
      onClick={onSelect}
      onDragEnd={onDragEnd}
      draggable
      title={`${screen.name} — ${screen.status}${hasOverride ? ' · EMERGENCY ACTIVE' : ''}`}
      aria-label={`Open ${screen.name} (${screen.status})`}
      className={`absolute -translate-x-1/2 -translate-y-1/2 group flex flex-col items-center justify-center transition-all ${
        selected ? 'scale-110' : 'hover:scale-110'
      } ${hasOverride ? 'animate-pulse' : ''}`}
      style={{
        left: `${xPct}%`,
        top: `${yPct}%`,
      }}
    >
      {/* Monitor body — rounded rect */}
      <div
        className={`rounded-md border-2 shadow-lg flex items-center justify-center ${baseColor} ${
          selected ? 'ring-4 ring-indigo-300' : ''
        }`}
        style={{
          width: PIN_RADIUS * 2.4,
          height: PIN_RADIUS * 1.6,
        }}
      >
        <Monitor className="w-3 h-3 text-white" aria-hidden />
      </div>
      {/* Monitor stand — small trapezoid below the body */}
      <div
        className={`${baseColor.replace('border-white', '')} mt-[-2px]`}
        style={{
          width: PIN_RADIUS * 0.55,
          height: 4,
          borderBottomLeftRadius: 2,
          borderBottomRightRadius: 2,
        }}
      />
      <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-900 text-white text-[9px] font-bold whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity max-w-[200px] truncate">
        {screen.name}
      </span>
    </button>
  );
}

// ─── Screen detail drawer ─────────────────────────────────────────

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
  const { data: override, isLoading: overrideLoading } = useScreenEmergencyOverride(screenId);
  const triggerMutation = useTriggerScreenEmergency();
  const clearMutation = useClearScreenEmergency();
  const detachMutation = useDetachScreenFromFloor();
  const [type, setType] = useState<string>('LOCKDOWN');
  const [scopeNote, setScopeNote] = useState('');
  const [textBlob, setTextBlob] = useState('');

  // Operator reported "you cant exit and those settings are useless".
  // Add Escape-to-close + backdrop click + bigger visible X so the
  // drawer is dismissible from any direction.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleTrigger = async () => {
    const ok = await appConfirm({
      title: `Trigger ${type} on "${screen.name}"?`,
      message: `Only this one screen will switch to the ${type} display. Other screens stay on their current content. The signed pub/sub message goes out immediately and is logged in the audit trail.`,
      tone: 'warn',
      confirmLabel: `Trigger ${type}`,
    });
    if (!ok) return;
    try {
      await triggerMutation.mutateAsync({
        screenId,
        override: {
          type,
          severity: 'HIGH',
          scopeNote: scopeNote.trim() || undefined,
          textBlob: textBlob.trim() || undefined,
        },
      });
    } catch (err: any) {
      await appAlert({
        title: "Couldn't trigger emergency",
        message: err?.message || 'Try again. If it keeps failing, check that the screen is still paired.',
        tone: 'danger',
      });
    }
  };

  const handleClear = async () => {
    try {
      await clearMutation.mutateAsync(screenId);
    } catch (err: any) {
      await appAlert({
        title: "Couldn't clear emergency",
        message: err?.message || 'Try again.',
        tone: 'danger',
      });
    }
  };

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
      {/* Backdrop — click to dismiss. The drawer was modal-like but
          unreachable when the operator's mouse drifted off the X. */}
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
          {/* Bigger, higher-contrast close button — operator reported
              the previous w-8 h-8 in slate-400 was easy to miss. */}
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
        {/* Status */}
        <section>
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Status</div>
          <div className="text-[10px] text-slate-400 mb-2 leading-snug">
            Live online/offline state from the screen&rsquo;s heartbeat. Read-only.
          </div>
          <div className={`text-xs px-2.5 py-1.5 rounded-md inline-flex items-center gap-1.5 font-bold ${
            screen.status === 'ONLINE' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${screen.status === 'ONLINE' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            {screen.status}
          </div>
          {screen.lastPingAt && (
            <p className="text-[10px] text-slate-400 mt-1">Last ping: {new Date(screen.lastPingAt).toLocaleString()}</p>
          )}
        </section>

        {/* Active override */}
        <section>
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Per-screen emergency</div>
          <div className="text-[10px] text-slate-400 mb-2 leading-snug">
            One-time <span className="font-semibold text-slate-500">manual trigger</span> for THIS screen only. Pick a type and fire — the screen swaps to that emergency content immediately. Use this for a localized incident (gym fight, hallway flood) where you don&rsquo;t want to alarm the whole building. Admins only.
          </div>
          {overrideLoading ? (
            <div className="text-[11px] text-slate-400 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Checking…</div>
          ) : override ? (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-rose-700">
                <Shield className="w-3.5 h-3.5" />
                {override.type} · {override.severity}
              </div>
              {override.scopeNote && <p className="text-[11px] text-rose-700/90">{override.scopeNote}</p>}
              {override.textBlob && <p className="text-[11px] text-rose-700/90 whitespace-pre-line">{override.textBlob}</p>}
              <p className="text-[10px] text-rose-600/70">Triggered: {new Date(override.triggeredAt).toLocaleString()}</p>
              <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']} fallback={null}>
                <button
                  onClick={handleClear}
                  disabled={clearMutation.isPending}
                  className="w-full mt-2 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  {clearMutation.isPending ? 'Clearing…' : 'All clear — resume normal content'}
                </button>
              </RoleGate>
            </div>
          ) : (
            <RoleGate
              allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}
              fallback={<p className="text-[11px] text-slate-400 italic">No active per-screen override.</p>}
            >
              <div className="rounded-xl border border-slate-200 p-3 space-y-2.5">
                <div>
                  <label htmlFor="trigger-type" className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Type</label>
                  <select
                    id="trigger-type"
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-rose-400"
                  >
                    <option value="LOCKDOWN">Lockdown</option>
                    <option value="EVACUATE">Evacuate</option>
                    <option value="HOLD">Hold</option>
                    <option value="SECURE">Secure</option>
                    <option value="WEATHER">Weather</option>
                    <option value="MEDICAL">Medical</option>
                    <option value="CUSTOM">Custom</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="trigger-note" className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Scope note (optional)</label>
                  <input
                    id="trigger-note"
                    type="text"
                    value={scopeNote}
                    onChange={(e) => setScopeNote(e.target.value)}
                    placeholder="Gym wing — hold position"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-rose-400"
                  />
                </div>
                <div>
                  <label htmlFor="trigger-text" className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Display message (optional)</label>
                  <textarea
                    id="trigger-text"
                    value={textBlob}
                    onChange={(e) => setTextBlob(e.target.value)}
                    rows={3}
                    placeholder="Specific instructions to show on this screen"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-rose-400"
                  />
                </div>
                <button
                  onClick={handleTrigger}
                  disabled={triggerMutation.isPending}
                  className="w-full px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  <Shield className="w-3.5 h-3.5" />
                  {triggerMutation.isPending ? 'Triggering…' : `Trigger ${type} on this screen`}
                </button>
              </div>
            </RoleGate>
          )}
        </section>

        {/* Per-screen emergency content config — Sprint 8b. The
            user's exact ask: "i have no way to assign the individual
            emergency assets to each screen…each one needs to be able
            to load the 6 different emergency content or have the
            option to pull it from the main category so they can do
            whatever they want." Six dropdowns, one per emergency
            type. "Use tenant default" leaves the column null and the
            manifest falls back to the tenant-wide panic*PlaylistId. */}
        {/* Admin-only — non-admins see a read-only summary, not the
            editable config. Operator's exact ask: "this needs to not
            be editable by non admins." Viewers + contributors get a
            clear "Admin only" lock chip so they understand WHY the
            controls aren't there. */}
        <RoleGate
          allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}
          fallback={
            <section className="border-t border-slate-100 pt-5">
              <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5 flex items-center gap-1.5">
                Emergency content for this screen
                <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">🔒 Admin only</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Per-screen emergency content is configured by school or district admins. If you need a change, ping an admin.
              </p>
            </section>
          }
        >
          <ScreenEmergencyContentConfig screenId={screenId} screen={screen} />
        </RoleGate>

        {/* Detach pin */}
        <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']} fallback={null}>
          <section>
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

// ─── Per-screen emergency content config ──────────────────────────

interface EmergencyTypeRow {
  short: 'lockdown' | 'evacuate' | 'hold' | 'secure' | 'weather' | 'medical';
  // Landscape variants
  playlistKey: keyof FloorPlanScreen;
  assetKey: keyof FloorPlanScreen;
  // Portrait variants
  portraitPlaylistKey: keyof FloorPlanScreen;
  portraitAssetKey: keyof FloorPlanScreen;
  label: string;
  emoji: string;
  description: string;
}

const EMERGENCY_TYPES: EmergencyTypeRow[] = [
  { short: 'lockdown', label: 'Lockdown', emoji: '🔒', description: 'Threat — secure room, lights off',
    playlistKey: 'emergencyLockdownPlaylistId', assetKey: 'emergencyLockdownAssetUrl',
    portraitPlaylistKey: 'emergencyLockdownPortraitPlaylistId', portraitAssetKey: 'emergencyLockdownPortraitAssetUrl' },
  { short: 'evacuate', label: 'Evacuate', emoji: '🚪', description: 'Fire / hazard — leave the building',
    playlistKey: 'emergencyEvacuatePlaylistId', assetKey: 'emergencyEvacuateAssetUrl',
    portraitPlaylistKey: 'emergencyEvacuatePortraitPlaylistId', portraitAssetKey: 'emergencyEvacuatePortraitAssetUrl' },
  { short: 'hold',     label: 'Hold',     emoji: '✋', description: 'Clear hallways, stay in current room',
    playlistKey: 'emergencyHoldPlaylistId', assetKey: 'emergencyHoldAssetUrl',
    portraitPlaylistKey: 'emergencyHoldPortraitPlaylistId', portraitAssetKey: 'emergencyHoldPortraitAssetUrl' },
  { short: 'secure',   label: 'Secure',   emoji: '🛡️', description: 'Outside threat — close perimeter, business as usual inside',
    playlistKey: 'emergencySecurePlaylistId', assetKey: 'emergencySecureAssetUrl',
    portraitPlaylistKey: 'emergencySecurePortraitPlaylistId', portraitAssetKey: 'emergencySecurePortraitAssetUrl' },
  { short: 'weather',  label: 'Weather',  emoji: '🌪️', description: 'Severe storm / tornado — interior safe spot',
    playlistKey: 'emergencyWeatherPlaylistId', assetKey: 'emergencyWeatherAssetUrl',
    portraitPlaylistKey: 'emergencyWeatherPortraitPlaylistId', portraitAssetKey: 'emergencyWeatherPortraitAssetUrl' },
  { short: 'medical',  label: 'Medical',  emoji: '🚑', description: 'Medical event — clear the area',
    playlistKey: 'emergencyMedicalPlaylistId', assetKey: 'emergencyMedicalAssetUrl',
    portraitPlaylistKey: 'emergencyMedicalPortraitPlaylistId', portraitAssetKey: 'emergencyMedicalPortraitAssetUrl' },
];

/**
 * Per-emergency-type row. Three states the operator can land on:
 *   1. "Use tenant default" (both playlistId AND assetUrl are null)
 *   2. Pick an existing playlist
 *   3. Upload a single custom asset (image / video / PDF)
 *
 * State (2) wins over (3) if both are set — playlist always takes
 * priority in the manifest. Setting either clears the other on save
 * so the UX never shows a confusing "both set" state.
 *
 * Saves immediately on every change (no Save button). Uploads use the
 * shared /assets/upload endpoint so the asset lands in the operator's
 * media library too — they can re-pick it later via the playlist
 * dropdown if they want to.
 */
function ScreenEmergencyContentConfig({
  screenId,
  screen,
}: {
  screenId: string;
  screen: FloorPlanScreen;
}) {
  const { data: playlists, isLoading: playlistsLoading } = usePlaylists();
  const updateMutation = useUpdateScreenEmergencyContent();
  // uploadingType is a composite key `${short}-${orient}` so each
  // sub-row's spinner is independent (uploading the landscape custom
  // asset for "lockdown" doesn't visually freeze the portrait sub-row).
  const [uploadingType, setUploadingType] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Helpers — orientation is just a key suffix. 'landscape' uses
  // base keys (lockdownPlaylistId, lockdownAssetUrl); 'portrait' uses
  // the *Portrait* keys.
  type Orient = 'landscape' | 'portrait';
  const apiKeys = (type: EmergencyTypeRow, orient: Orient) => {
    if (orient === 'landscape') {
      return { playlist: `${type.short}PlaylistId`, asset: `${type.short}AssetUrl` };
    }
    return { playlist: `${type.short}PortraitPlaylistId`, asset: `${type.short}PortraitAssetUrl` };
  };

  const onPickPlaylist = (type: EmergencyTypeRow, orient: Orient, value: string) => {
    const playlistId = value === '' ? null : value;
    const k = apiKeys(type, orient);
    // Picking a playlist clears any custom asset for the same
    // type+orientation so there's only ever one source of truth.
    updateMutation.mutate({
      screenId,
      patch: { [k.playlist]: playlistId, [k.asset]: null } as any,
    });
  };

  const onUploadCustom = async (type: EmergencyTypeRow, orient: Orient, file: File) => {
    setUploadError(null);
    setUploadingType(`${type.short}-${orient}`);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { useUIStore } = await import('@/store/ui-store');
      const { API_URL } = await import('@/lib/api-url');
      const token = useUIStore.getState().token;
      const res = await fetch(`${API_URL}/assets/upload`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const { url } = await res.json();
      const k = apiKeys(type, orient);
      updateMutation.mutate({
        screenId,
        patch: { [k.asset]: url, [k.playlist]: null } as any,
      });
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed — try a smaller file');
    } finally {
      setUploadingType(null);
    }
  };

  const onClear = (type: EmergencyTypeRow, orient: Orient) => {
    const k = apiKeys(type, orient);
    updateMutation.mutate({
      screenId,
      patch: { [k.playlist]: null, [k.asset]: null } as any,
    });
  };

  return (
    <section className="border-t border-slate-100 pt-5">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">
        Emergency content for this screen
      </div>
      <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
        For each of the 6 emergency types, decide what plays on <span className="font-semibold text-slate-600">this screen only</span> when that type fires.
        Configure <span className="font-semibold">📺 Landscape</span> and <span className="font-semibold">📱 Portrait</span> independently —
        the player picks the one that matches the screen's orientation. Within each, pick a <span className="font-semibold">playlist</span>,
        upload a <span className="font-semibold">custom asset</span>, or leave it on <span className="font-semibold">tenant default</span>.
      </p>
      <div className="space-y-2.5">
        {EMERGENCY_TYPES.map((t) => {
          const orientations: { orient: Orient; icon: string; label: string }[] = [
            { orient: 'landscape', icon: '📺', label: 'Landscape' },
            { orient: 'portrait',  icon: '📱', label: 'Portrait' },
          ];

          return (
            <div key={t.short} className="rounded-lg border border-slate-200 p-2.5 bg-slate-50/60">
              {/* Type header — emoji + label + description */}
              <div className="flex items-center gap-2 mb-2">
                <div className="shrink-0 w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-base shadow-sm" title={t.description}>
                  <span aria-hidden>{t.emoji}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold text-slate-700">{t.label}</div>
                  <div className="text-[10px] text-slate-400 truncate" title={t.description}>{t.description}</div>
                </div>
              </div>

              {/* Two sub-rows: landscape + portrait, each independently
                  configurable. Player chooses based on screen orientation. */}
              <div className="space-y-1.5">
                {orientations.map(({ orient, icon, label }) => {
                  const k = apiKeys(t, orient);
                  const playlistId = (screen[k.playlist as keyof FloorPlanScreen] as string | null | undefined) ?? '';
                  const assetUrl = (screen[k.asset as keyof FloorPlanScreen] as string | null | undefined) ?? '';
                  const hasCustomAsset = !!assetUrl;
                  const hasPlaylist = !!playlistId;
                  const usingTenantDefault = !hasCustomAsset && !hasPlaylist;
                  const filename = hasCustomAsset ? assetUrl.split('/').pop()?.split('?')[0] : '';
                  const uploadKey = `${t.short}-${orient}`;
                  const isUploadingThis = uploadingType === uploadKey;

                  return (
                    <div key={orient} className="rounded-md bg-white border border-slate-200 p-2">
                      {/* Sub-header — orientation badge + status pill */}
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs" aria-hidden>{icon}</span>
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</span>
                        <div className={`ml-auto text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                          hasPlaylist     ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' :
                          hasCustomAsset  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                                            'bg-slate-100 text-slate-500 border border-slate-200'
                        }`}>
                          {hasPlaylist ? 'Playlist' : hasCustomAsset ? 'Custom' : 'Default'}
                        </div>
                      </div>

                      {/* Custom asset state — show filename + clear */}
                      {hasCustomAsset && (
                        <div className="flex items-center gap-2 mb-1.5 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded-md">
                          <Upload className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span className="text-[10px] font-mono text-emerald-700 truncate flex-1" title={assetUrl}>{filename || 'custom asset'}</span>
                          <button
                            type="button"
                            onClick={() => onClear(t, orient)}
                            aria-label={`Clear custom ${label} ${t.label} asset`}
                            title="Clear custom asset (revert to tenant default)"
                            className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-emerald-600 hover:bg-emerald-100"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      {/* Picker row — playlist select + upload button */}
                      <div className="flex items-center gap-2">
                        <select
                          value={playlistId}
                          disabled={playlistsLoading || updateMutation.isPending}
                          onChange={(e) => onPickPlaylist(t, orient, e.target.value)}
                          className="flex-1 text-[11px] font-medium px-2 py-1.5 rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 disabled:bg-slate-50 disabled:text-slate-400"
                          aria-label={`${t.label} ${label.toLowerCase()} playlist for this screen`}
                        >
                          <option value="">{usingTenantDefault ? '↳ Use tenant default' : (hasCustomAsset ? '↳ Switch to playlist…' : '↳ Use tenant default')}</option>
                          {(playlists || []).map((p: any) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <label
                          className={`shrink-0 inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-md cursor-pointer transition-colors ${
                            isUploadingThis
                              ? 'bg-emerald-100 text-emerald-700 border border-emerald-300'
                              : 'bg-white text-slate-600 border border-slate-200 hover:border-emerald-400 hover:text-emerald-700'
                          }`}
                          title={`Upload a single ${label.toLowerCase()} image, video, or PDF for this screen + ${t.label}`}
                        >
                          {isUploadingThis ? (
                            <><Loader2 className="w-3 h-3 animate-spin" /> Uploading…</>
                          ) : (
                            <><Upload className="w-3 h-3" /> Upload</>
                          )}
                          <input
                            type="file"
                            accept="image/*,video/*,application/pdf"
                            className="hidden"
                            disabled={!!uploadingType || updateMutation.isPending}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) onUploadCustom(t, orient, f);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {updateMutation.isPending && (
        <div className="mt-2 text-[10px] text-slate-400 italic flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Saving…
        </div>
      )}
      {(updateMutation.isError || uploadError) && (
        <div className="mt-2 text-[10px] text-rose-600">{uploadError || "Couldn’t save — try again."}</div>
      )}
    </section>
  );
}
