'use client';

/**
 * /[schoolId]/settings/emergency — UNIFIED emergency configuration.
 *
 * Operator (2026-05-25):
 *   "you got some crazy shit going on with the emergency menus, this
 *    is the most critical part of our app and it needs to be perfect
 *    and easy to use… when you enable location mode it says upload
 *    floor map, then you click upload and it takes you to a
 *    completely different menu asking you to upload, then you upload
 *    and its an entirely new area to assign the content per
 *    screen…unify all of this under the first settings menu, and from
 *    the main menu setting, change the emergency menu on to the
 *    configure button and just show whether its on or off from this
 *    menu, turning it on and off should be inside the initial config
 *    page not a button that can be easily hit by accident…put the
 *    work into this one and make this so easy to use a child could
 *    configure it properly."
 *
 * UX contract:
 *   1. Operator never leaves this URL while configuring emergency.
 *      Floor-plan upload happens inline. Per-screen content config
 *      happens inline (via the EmbeddedFloorPlanView drawer). The old
 *      "click Upload → goes to /floor-plans → click upload again →
 *      goes back to assign content" multi-page bounce is gone.
 *
 *   2. The master ON/OFF toggle lives here, NOT on /settings. The
 *      settings card only shows status + a Configure link, so an
 *      operator can't accidentally toggle emergency off by missing a
 *      button on a busy settings page. Toggling on/off here is a
 *      deliberate two-step action: click a big button, confirm.
 *
 *   3. Standard vs Location-based is a clear radio choice, not a
 *      mode toggle hidden in a card header.
 *
 *   4. K12 tenants never see the master toggle (always-on contract).
 *      They land directly on the mode selector + editor.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertOctagon,
  ArrowLeft,
  ShieldCheck,
  ShieldOff,
  Loader2,
  Building2,
  MapPin,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Image as ImageIcon,
} from 'lucide-react';
import {
  useTenant,
  useFloorPlans,
  useUploadFloorPlan,
  useLocationBasedEmergencyConfig,
  useToggleLocationBasedEmergency,
} from '@/hooks/use-api';
import { PanicContentEditor } from '@/components/settings/PanicContentEditor';
import { EmbeddedFloorPlanView } from '@/components/floor-plans/EmbeddedFloorPlanView';
import { useTenantCopy } from '@/hooks/use-tenant-copy';
import { RoleGate } from '@/components/RoleGate';
import { appConfirm, appAlert } from '@/components/ui/app-dialog';

/** localStorage key — non-K12 "emergency on?" gate (existing behavior). */
function emergencyEnabledKey(tenantId: string) {
  return `emergencyEnabled:${tenantId}`;
}

export default function EmergencySettingsPage() {
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId || '';

  return (
    <RoleGate
      allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}
      fallback={
        <div className="max-w-3xl mx-auto p-8 text-center">
          <ShieldOff className="w-10 h-10 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">
            Only district + school admins can configure emergency content.
          </p>
        </div>
      }
    >
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        <header>
          <Link
            href={`/${schoolId}/settings`}
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-rose-600 mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Settings
          </Link>
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
            <AlertOctagon className="w-6 h-6 text-rose-500" />
            Emergency content
          </h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            What plays on every screen when an emergency is triggered. The six
            SRP types — Lockdown, Evacuate, Medical, Secure, Shelter, Hold.
          </p>
        </header>

        <EmergencyConfigurator />
      </div>
    </RoleGate>
  );
}

/**
 * Inner orchestrator. Decides which sub-section to render based on:
 *   - vertical (K12 → always on, no toggle)
 *   - master on/off (localStorage)
 *   - mode (standard tenant-wide vs location-based per-screen)
 */
function EmergencyConfigurator() {
  const tenantCopy = useTenantCopy();
  const { data: tenant } = useTenant();
  const tenantId = (tenant as any)?.id ?? '';
  const isK12 = tenantCopy.vertical === 'K12';

  // Master on/off — K12 forced-on; everyone else opts in.
  // Stored client-side for now (same as the prior PanicContentGate);
  // moving to a Tenant.emergencyEnabled column is a follow-up.
  const [masterEnabled, setMasterEnabled] = useState<boolean>(isK12);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!tenantId || typeof window === 'undefined') {
      setMasterEnabled(isK12);
      setHydrated(true);
      return;
    }
    try {
      const raw = window.localStorage.getItem(emergencyEnabledKey(tenantId));
      if (raw === 'true') setMasterEnabled(true);
      else if (raw === 'false') setMasterEnabled(false);
      else setMasterEnabled(isK12);
    } catch {
      setMasterEnabled(isK12);
    }
    setHydrated(true);
  }, [tenantId, isK12]);

  const persistMaster = (next: boolean) => {
    setMasterEnabled(next);
    if (!tenantId || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(emergencyEnabledKey(tenantId), next ? 'true' : 'false');
    } catch {
      /* private mode — in-memory toggle still works */
    }
  };

  const handleTurnOn = async () => {
    const ok = await appConfirm({
      title: 'Turn on emergency alerts?',
      message:
        'Operators will be able to trigger lockdown / evacuate / weather alerts that take over every screen until cleared. Make sure you upload the content you want shown for each type before relying on this in production.',
      confirmLabel: 'Turn on',
    });
    if (!ok) return;
    persistMaster(true);
  };

  const handleTurnOff = async () => {
    const ok = await appConfirm({
      title: 'Turn off emergency alerts?',
      message:
        'Operators will no longer be able to trigger emergency content from the dashboard or mobile panic page. Uploaded content stays on disk; flipping back ON restores everything.',
      confirmLabel: 'Turn off',
      tone: 'danger',
    });
    if (!ok) return;
    persistMaster(false);
  };

  if (!hydrated) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex items-center gap-3 text-sm font-semibold text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading emergency settings…
      </div>
    );
  }

  // ── State 1: master OFF (non-K12 only) ──────────────────────────
  if (!isK12 && !masterEnabled) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center">
        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
          <ShieldOff className="w-7 h-7 text-slate-400" />
        </div>
        <h2 className="text-lg font-extrabold text-slate-800">
          Emergency alerts are off
        </h2>
        <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
          No screen will display panic content even if a trigger fires. Turn
          this on to configure the six Standard Response Protocol types.
        </p>
        <button
          type="button"
          onClick={handleTurnOn}
          className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 transition-colors"
        >
          <ShieldCheck className="w-4 h-4" />
          Turn on emergency alerts
        </button>
      </div>
    );
  }

  // ── State 2+: master ON (K12 always lands here) ────────────────
  return (
    <>
      <StatusCard isK12={isK12} onTurnOff={handleTurnOff} />
      <ModeAndEditor schoolId={(useParams<{ schoolId: string }>().schoolId as string) || ''} />
    </>
  );
}

function StatusCard({ isK12, onTurnOff }: { isK12: boolean; onTurnOff: () => void }) {
  return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0">
          <ShieldCheck className="w-4 h-4 text-emerald-700" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-emerald-900">
            Emergency alerts are on
          </div>
          <p className="text-[11px] text-emerald-800/80 mt-0.5">
            Triggers will display the configured content on every screen
            {isK12 ? ' (always-on for K-12)' : ''}.
          </p>
        </div>
      </div>
      {!isK12 && (
        <button
          type="button"
          onClick={onTurnOff}
          className="shrink-0 text-[11px] font-bold text-emerald-800/80 hover:text-rose-700 px-3 py-1.5 rounded-md hover:bg-rose-50 transition-colors"
        >
          Turn off
        </button>
      )}
    </div>
  );
}

function ModeAndEditor({ schoolId }: { schoolId: string }) {
  const { data: cfg, isLoading: cfgLoading, isError: cfgError } = useLocationBasedEmergencyConfig();
  const toggle = useToggleLocationBasedEmergency();
  const locationMode = !!cfg?.enabled;

  const switchMode = async (target: 'standard' | 'location') => {
    const wantLocation = target === 'location';
    if (wantLocation === locationMode) return;
    if (!wantLocation) {
      const ok = await appConfirm({
        title: 'Switch back to standard emergency?',
        message:
          'Every screen will play the tenant-wide panic content. Per-screen overrides are kept on disk; flipping back to location mode restores them. Non-destructive.',
        confirmLabel: 'Switch back',
      });
      if (!ok) return;
    }
    toggle.mutate(wantLocation);
  };

  if (cfgLoading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex items-center gap-3 text-sm font-semibold text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading emergency mode…
      </div>
    );
  }
  if (cfgError) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-6 text-sm font-semibold text-rose-700">
        Could not load emergency mode. Refresh this page before configuring.
      </div>
    );
  }

  return (
    <>
      <ModeSelector
        currentMode={locationMode ? 'location' : 'standard'}
        onChange={switchMode}
        pending={toggle.isPending}
      />
      {locationMode ? <LocationModeEditor schoolId={schoolId} /> : <StandardModeEditor />}
    </>
  );
}

function ModeSelector({
  currentMode,
  onChange,
  pending,
}: {
  currentMode: 'standard' | 'location';
  onChange: (m: 'standard' | 'location') => void;
  pending: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
        Delivery mode
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ModeOption
          active={currentMode === 'standard'}
          disabled={pending}
          onClick={() => onChange('standard')}
          icon={<ShieldCheck className="w-4 h-4" />}
          title="Standard"
          blurb="One set of content per type, shown on every screen tenant-wide. Simplest and what most schools use."
        />
        <ModeOption
          active={currentMode === 'location'}
          disabled={pending}
          onClick={() => onChange('location')}
          icon={<MapPin className="w-4 h-4" />}
          title="Location-based"
          blurb="Different content per screen, assigned visually on a floor plan. Use when a wing or building needs its own alert."
        />
      </div>
    </div>
  );
}

function ModeOption({
  active,
  disabled,
  onClick,
  icon,
  title,
  blurb,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  blurb: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`text-left p-4 rounded-lg border-2 transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
        active
          ? 'border-rose-500 bg-rose-50/60'
          : 'border-slate-200 hover:border-rose-300 bg-white'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <div
          className={`w-7 h-7 rounded-md flex items-center justify-center shrink-0 ${
            active ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {icon}
        </div>
        <div className="text-sm font-bold text-slate-800">{title}</div>
        {active && (
          <CheckCircle2 className="w-4 h-4 text-rose-600 ml-auto" />
        )}
      </div>
      <p className="text-[11px] text-slate-500 leading-relaxed">{blurb}</p>
    </button>
  );
}

// ─── Standard mode: 6 SRP editor cards ───────────────────────────

function StandardModeEditor() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-5">
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
          Critical (life-safety)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <PanicContentEditor
            kind="lockdown"
            label="Lockdown"
            accent="red"
            hint="Threat inside the building — locks, lights, out of sight."
          />
          <PanicContentEditor
            kind="evacuate"
            label="Evacuate"
            accent="orange"
            hint="Get out and head to the rendezvous point."
          />
          <PanicContentEditor
            kind="medical"
            label="Medical"
            accent="rose"
            hint="Nurse / EMS event. Specify location."
          />
        </div>
      </div>
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
          Heightened awareness
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <PanicContentEditor
            kind="secure"
            label="Secure (Lockout)"
            accent="amber"
            hint="Threat OUTSIDE — lock perimeter, stay inside, business as usual."
          />
          <PanicContentEditor
            kind="weather"
            label="Shelter (Weather / Hazmat)"
            accent="violet"
            hint="Tornado, severe storm, hazmat, air-quality event."
          />
          <PanicContentEditor
            kind="hold"
            label="Hold"
            accent="sky"
            hint="Stay in classroom — clear hallways for medical / police passing through."
          />
        </div>
      </div>
    </div>
  );
}

// ─── Location mode: floor plan UI, INLINE ────────────────────────

function LocationModeEditor({ schoolId }: { schoolId: string }) {
  const { data: floorPlans, isLoading: plansLoading } = useFloorPlans();
  const planCount = floorPlans?.length ?? 0;
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [addPlanOpen, setAddPlanOpen] = useState(false);

  // Auto-select the first plan whenever the list changes.
  useEffect(() => {
    if (planCount === 0) {
      setActivePlanId(null);
      return;
    }
    if (!activePlanId || !floorPlans!.some((p) => p.id === activePlanId)) {
      setActivePlanId(floorPlans![0].id);
    }
  }, [floorPlans, planCount, activePlanId]);

  if (plansLoading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 flex items-center gap-3 text-sm font-semibold text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading floor plans…
      </div>
    );
  }

  // ── No plans yet → inline upload form. No nav-away. ──────────
  if (planCount === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-lg bg-rose-50 flex items-center justify-center shrink-0">
            <MapPin className="w-4 h-4 text-rose-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">
              Add your first floor plan
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              Upload an architectural plan, hand-drawn sketch, or PDF for each
              building. Drop your screens on the map, then click any pin to
              configure that screen&rsquo;s emergency content.
            </p>
          </div>
        </div>
        <InlineFloorPlanUpload
          onUploaded={() => {
            /* nothing — useFloorPlans refetches via the hook's invalidation */
          }}
        />
      </div>
    );
  }

  // ── Plans exist → tabs + embedded view ───────────────────────
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <MapPin className="w-4 h-4 text-rose-500" />
          <span className="text-sm font-bold text-slate-800">Floor plans</span>
          <span className="text-[11px] text-slate-500">
            Click a screen pin → side drawer opens with that screen&rsquo;s
            emergency content slots.
          </span>
        </div>
        <button
          type="button"
          onClick={() => setAddPlanOpen((v) => !v)}
          className="text-[11px] font-bold px-3 py-1.5 rounded-md border border-slate-200 hover:border-rose-300 hover:text-rose-700 transition-colors"
        >
          {addPlanOpen ? 'Cancel' : '+ Add plan'}
        </button>
      </div>

      {addPlanOpen && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <InlineFloorPlanUpload onUploaded={() => setAddPlanOpen(false)} />
        </div>
      )}

      {planCount > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 pb-2">
          {(floorPlans || []).map((p: any) => {
            const isActive = p.id === activePlanId;
            const sub = [p.buildingLabel, p.floorLabel].filter(Boolean).join(' · ');
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActivePlanId(p.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold rounded-md transition-colors ${
                  isActive
                    ? 'bg-rose-50 text-rose-700 border border-rose-200'
                    : 'bg-white text-slate-600 border border-slate-200 hover:border-rose-300 hover:text-rose-700'
                }`}
              >
                <Building2 className="w-3.5 h-3.5" />
                <span>{p.name}</span>
                {sub && <span className="text-[10px] font-normal opacity-70">· {sub}</span>}
              </button>
            );
          })}
        </div>
      )}

      {activePlanId && (
        <EmbeddedFloorPlanView
          key={activePlanId}
          planId={activePlanId}
          schoolId={schoolId}
          mode="embedded"
        />
      )}
    </div>
  );
}

/**
 * Inline floor-plan upload — single-step flow. Operator clicks ONE
 * "Upload floor plan" button → system file picker opens → file
 * chosen → preview + auto-named form expands inline with optional
 * building/floor labels and a Save button.
 *
 * Operator (2026-05-25): "the upload floor plan button is greyed
 * out, the text fields arent aligned with each other and their
 * seems to be another upload area at the top but lets just keep
 * one upload button and the drag and drop shit can be in there
 * once you select upload."
 *
 * Before: file picker AND form fields AND submit button were all
 * rendered at once, with submit disabled until a file landed. That
 * read as "broken page" — three boxes, none working until you found
 * the right one.
 *
 * Now: one button. Click. Pick file. Form appears. Save. Done.
 */
function InlineFloorPlanUpload({ onUploaded }: { onUploaded: () => void }) {
  const upload = useUploadFloorPlan();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [buildingLabel, setBuildingLabel] = useState('');
  const [floorLabel, setFloorLabel] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const previewUrl = file ? URL.createObjectURL(file) : null;
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFile = (f: File | null) => {
    if (!f) return;
    setFile(f);
    // Auto-fill name from the filename (without extension) — the
    // operator can override before saving. Saves a step in the
    // common case where the file is literally "MainBuilding.png".
    setName(f.name.replace(/\.[^.]+$/, ''));
    setErr(null);
  };

  const reset = () => {
    setFile(null);
    setName('');
    setBuildingLabel('');
    setFloorLabel('');
    setErr(null);
  };

  const handleSubmit = async () => {
    if (!file || !name.trim()) return;
    setErr(null);
    try {
      await upload.mutateAsync({
        file,
        name: name.trim(),
        buildingLabel: buildingLabel.trim() || undefined,
        floorLabel: floorLabel.trim() || undefined,
      });
      reset();
      onUploaded();
    } catch (e: any) {
      const msg = e?.message || 'Could not upload. Make sure the file is a PNG / JPG / WEBP under 25 MB.';
      setErr(msg);
      await appAlert({
        title: 'Upload failed',
        message: msg,
        tone: 'danger',
      });
    }
  };

  // ── State 1: no file picked → single CTA button ─────────────
  if (!file) {
    return (
      <div>
        <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold cursor-pointer transition-colors">
          <Upload className="w-4 h-4" />
          Upload floor plan
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] || null)}
          />
        </label>
        <p className="text-[11px] text-slate-500 mt-2">
          PNG / JPG / WEBP, up to 25 MB. We&rsquo;ll detect the image dimensions automatically.
        </p>
      </div>
    );
  }

  // ── State 2: file picked → preview + form + save ────────────
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 p-3 rounded-lg bg-white border border-slate-200">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Floor plan preview"
            className="w-14 h-14 rounded object-cover border border-slate-200"
          />
        ) : (
          <div className="w-14 h-14 rounded bg-slate-100 flex items-center justify-center">
            <ImageIcon className="w-5 h-5 text-slate-400" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-slate-800 truncate">{file.name}</div>
          <div className="text-[10px] text-slate-500">{Math.round(file.size / 1024)} KB</div>
        </div>
        <button
          type="button"
          onClick={reset}
          className="text-[11px] font-semibold text-slate-500 hover:text-rose-600"
        >
          Pick a different file
        </button>
      </div>

      {/* All three labels render single-line so the inputs line up
          left-to-right. The (optional) text used to push Building /
          Floor down by a line vs Name, leaving inputs visually
          unaligned (operator screenshot 2026-05-25). Now the
          placeholder is "(optional)" and the label is just the name. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <label className="text-[11px] font-bold text-slate-600 flex flex-col gap-1">
          Name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. North wing"
            maxLength={80}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal text-slate-800"
          />
        </label>
        <label className="text-[11px] font-bold text-slate-600 flex flex-col gap-1">
          Building
          <input
            value={buildingLabel}
            onChange={(e) => setBuildingLabel(e.target.value)}
            placeholder="Optional, e.g. Main"
            maxLength={40}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal text-slate-800"
          />
        </label>
        <label className="text-[11px] font-bold text-slate-600 flex flex-col gap-1">
          Floor
          <input
            value={floorLabel}
            onChange={(e) => setFloorLabel(e.target.value)}
            placeholder="Optional, e.g. 2"
            maxLength={20}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-normal text-slate-800"
          />
        </label>
      </div>

      {err && (
        <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {err}
        </div>
      )}

      <div className="flex gap-2 items-center">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!name.trim() || upload.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {upload.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
          {upload.isPending ? 'Uploading…' : 'Save floor plan'}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={upload.isPending}
          className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 disabled:opacity-50"
        >
          Cancel
        </button>
        {upload.isSuccess && !upload.isPending && (
          <span className="text-[11px] font-semibold text-emerald-700 inline-flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
