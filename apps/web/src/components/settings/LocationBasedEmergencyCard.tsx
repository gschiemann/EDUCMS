"use client";

import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Map as MapIcon,
  Loader2,
  ShieldCheck,
  ShieldOff,
  ArrowRight,
  Plus,
  Building2,
} from 'lucide-react';
import {
  useLocationBasedEmergencyConfig,
  useToggleLocationBasedEmergency,
  useFloorPlans,
} from '@/hooks/use-api';
import { appConfirm } from '@/components/ui/app-dialog';

/**
 * Settings card for the Sprint 8b "location-based emergency" workflow.
 *
 * When OFF (default): the panic button broadcasts the SAME content to
 * every screen — the simple workflow that lives one card up
 * (PanicContentEditor for the 6 SRP types).
 *
 * When ON: admins can upload floor plans, drag screens onto them, and
 * configure landscape + portrait emergency content per screen via the
 * floor-plan editor drawer. The manifest endpoint then prefers the
 * per-screen override, falling back to the tenant default if the screen
 * has nothing set for that emergency type.
 *
 * Toggling back to OFF is non-destructive — every per-screen row is
 * preserved on disk, but the manifest behaves as if they were null.
 *
 * RBAC: admin-only (gated by RoleGate at the call site in settings/page).
 */
export function LocationBasedEmergencyCard() {
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? '';
  const { data: cfg, isLoading: cfgLoading } = useLocationBasedEmergencyConfig();
  const { data: floorPlans, isLoading: plansLoading } = useFloorPlans();
  const toggle = useToggleLocationBasedEmergency();

  const enabled = !!cfg?.enabled;
  const planCount = floorPlans?.length ?? 0;

  const handleToggle = async (next: boolean) => {
    if (next) {
      const ok = await appConfirm({
        title: 'Enable location-based emergency?',
        message:
          'Admins can then upload floor plans, drop screens onto them, and configure landscape + portrait emergency content per screen. Until you set up overrides, every screen keeps playing the tenant default — nothing changes for the player fleet immediately.',
        confirmLabel: 'Enable',
      });
      if (!ok) return;
    } else {
      const ok = await appConfirm({
        title: 'Switch back to standard emergency?',
        message:
          'Every screen will go back to the tenant-wide panic content for each emergency type. Per-screen overrides are kept (re-enable any time to bring them back), but the manifest will ignore them while this is OFF.',
        confirmLabel: 'Switch back',
        tone: 'danger',
      });
      if (!ok) return;
    }
    toggle.mutate(next);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-100 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">
            <MapIcon className="w-4 h-4 text-rose-500" /> Location-based emergency
            <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              Advanced
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            By default, every screen plays the same panic content (configured one card above). Turn this on
            to upload floor plans, drop screens onto them, and customize emergency content
            <span className="font-semibold"> per screen</span> with independent landscape and portrait
            variants. Toggling back is non-destructive — your per-screen settings are kept.
          </p>
        </div>
        {/* Mode toggle */}
        <label
          className={`shrink-0 inline-flex items-center gap-2 cursor-pointer select-none px-3 py-2 rounded-lg border transition-colors ${
            enabled
              ? 'bg-rose-50 text-rose-700 border-rose-200'
              : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300'
          } ${toggle.isPending || cfgLoading ? 'opacity-60 pointer-events-none' : ''}`}
          title={enabled ? 'Switch back to standard emergency' : 'Enable location-based emergency'}
        >
          <input
            type="checkbox"
            checked={enabled}
            disabled={toggle.isPending || cfgLoading}
            onChange={(e) => handleToggle(e.target.checked)}
            className="sr-only"
            aria-label="Toggle location-based emergency mode"
          />
          {toggle.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : enabled ? (
            <ShieldCheck className="w-4 h-4" />
          ) : (
            <ShieldOff className="w-4 h-4" />
          )}
          <span className="text-[11px] font-bold uppercase tracking-wide">{enabled ? 'On' : 'Off'}</span>
        </label>
      </div>

      {/* Body — only render when enabled. Off-state shows a single helper line. */}
      {!enabled ? (
        <div className="px-6 py-5 text-xs text-slate-400 flex items-center gap-2">
          <span>Mode is off. Standard emergency workflow is active for every screen.</span>
        </div>
      ) : (
        <div className="p-6 space-y-4">
          {/* Floor plans summary */}
          <div>
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
              Floor plans
            </h3>
            {plansLoading ? (
              <div className="text-xs text-slate-400 flex items-center gap-2">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading…
              </div>
            ) : planCount === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/40 p-4 flex items-start gap-3">
                <Building2 className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="text-[12px] font-bold text-slate-700">No floor plans yet</div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Upload an architectural floor plan, hand-drawn sketch, or PDF for each building.
                    Multi-floor schools get one plan per floor. Then drag screens from the panel onto
                    the plan to map them to physical locations.
                  </p>
                  <Link
                    href={`/${schoolId}/floor-plans`}
                    className="inline-flex items-center gap-1.5 mt-3 text-[11px] font-bold px-3 py-1.5 rounded-md bg-rose-600 text-white hover:bg-rose-700 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Create your first floor plan
                  </Link>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {floorPlans!.slice(0, 6).map((p: any) => (
                  <Link
                    key={p.id}
                    href={`/${schoolId}/floor-plans/${p.id}`}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg bg-slate-50 hover:bg-rose-50 hover:border-rose-200 border border-transparent transition-colors group"
                  >
                    <Building2 className="w-4 h-4 text-slate-400 group-hover:text-rose-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-bold text-slate-700 truncate">{p.name}</div>
                      {(p.buildingLabel || p.floorLabel) && (
                        <div className="text-[10px] text-slate-400 truncate">
                          {[p.buildingLabel, p.floorLabel].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-rose-500 shrink-0" />
                  </Link>
                ))}
                {planCount > 6 && (
                  <div className="text-[10px] text-slate-400 italic px-3">
                    + {planCount - 6} more
                  </div>
                )}
                <div className="pt-2">
                  <Link
                    href={`/${schoolId}/floor-plans`}
                    className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-md border border-slate-200 hover:border-rose-300 hover:text-rose-700 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add another floor plan
                  </Link>
                </div>
              </div>
            )}
          </div>

          {/* How it works */}
          <div className="border-t border-slate-100 pt-4">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
              How per-screen overrides work
            </h3>
            <ol className="list-decimal list-inside text-[11px] text-slate-500 space-y-1 leading-relaxed">
              <li>Open a floor plan and drag unplaced screens onto the map.</li>
              <li>
                Click a placed pin → the drawer opens. Scroll to{' '}
                <span className="font-semibold text-slate-600">Emergency content for this screen</span>.
              </li>
              <li>
                For each of the 6 emergency types, configure the{' '}
                <span className="font-semibold">📺 Landscape</span> and{' '}
                <span className="font-semibold">📱 Portrait</span> rows independently — pick a playlist or
                upload a custom asset.
              </li>
              <li>
                Anything left on <span className="font-semibold">tenant default</span> falls back to the
                Panic Content config above.
              </li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
