"use client";

/**
 * Floor plans list — Sprint 8b Phase 1.
 *
 * Operator lands here from the sidebar, sees every floor plan in
 * their tenant, can upload a new PNG/JPG of a building floor, and
 * clicks into a single plan to drop screen pins on it.
 *
 * Phase 1 surface:
 *   - Upload button (auto-detects image dimensions client-side)
 *   - Grid of plans with thumbnail + name + screen-count badge
 *   - "Edit pins" CTA → /[schoolId]/floor-plans/[id]
 *   - Delete (themed confirm)
 *
 * Phase 2+: zone polygon drawer, scenario picker, geo overlay.
 */

import { useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Map, Plus, Loader2, Upload, Trash2, MapPin } from 'lucide-react';
import { RoleGate } from '@/components/RoleGate';
import { useFloorPlans, useUploadFloorPlan, useDeleteFloorPlan, type FloorPlan } from '@/hooks/use-api';
import { appConfirm, appAlert } from '@/components/ui/app-dialog';

export default function FloorPlansPage() {
  return (
    <RoleGate
      allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN', 'CONTRIBUTOR', 'RESTRICTED_VIEWER']}
      fallback={<div className="text-center py-24 text-sm text-slate-500">You don&rsquo;t have permission to view floor plans.</div>}
    >
      <FloorPlansView />
    </RoleGate>
  );
}

function FloorPlansView() {
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? '';
  const router = useRouter();
  const { data: plans, isLoading } = useFloorPlans();
  const uploadMutation = useUploadFloorPlan();
  const deleteMutation = useDeleteFloorPlan();
  const [showUpload, setShowUpload] = useState(false);

  const handleDelete = async (plan: FloorPlan) => {
    const ok = await appConfirm({
      title: `Delete "${plan.name}"?`,
      message: `This removes the floor plan and detaches every screen placed on it. The screens themselves stay paired and will revert to "unplaced" status.`,
      tone: 'danger',
      confirmLabel: 'Delete plan',
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(plan.id);
    } catch (err: any) {
      await appAlert({
        title: "Couldn't delete plan",
        message: err?.message || 'Try again, or refresh if the issue persists.',
        tone: 'danger',
      });
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-violet-100 text-violet-700">
            <Map className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Floor plans</h1>
            <p className="text-xs text-slate-500">Drop screen pins on building floors so you can trigger emergency content per room or wing.</p>
          </div>
        </div>
        <RoleGate
          allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']}
          fallback={null}
        >
          <button
            onClick={() => setShowUpload(true)}
            className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold flex items-center gap-2 shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" /> Upload floor plan
          </button>
        </RoleGate>
      </header>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : !plans || plans.length === 0 ? (
        <EmptyState onUpload={() => setShowUpload(true)} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              onOpen={() => router.push(`/${schoolId}/floor-plans/${p.id}`)}
              onDelete={() => handleDelete(p)}
            />
          ))}
        </div>
      )}

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          onUpload={async (input) => {
            try {
              const created = await uploadMutation.mutateAsync(input);
              setShowUpload(false);
              router.push(`/${schoolId}/floor-plans/${created.id}`);
            } catch (err: any) {
              await appAlert({
                title: "Couldn't upload plan",
                message: err?.message || 'Make sure the file is a PNG / JPG / WEBP under 25 MB.',
                tone: 'danger',
              });
            }
          }}
          uploading={uploadMutation.isPending}
        />
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-16 px-6 text-center">
      <div className="inline-flex w-12 h-12 rounded-2xl bg-violet-100 text-violet-600 items-center justify-center mb-3">
        <Map className="w-6 h-6" />
      </div>
      <h2 className="text-base font-bold text-slate-800 mb-1">No floor plans yet</h2>
      <p className="text-xs text-slate-500 mb-5 max-w-md mx-auto leading-relaxed">
        Upload a PNG, JPG, or WEBP of your building&rsquo;s floor plan. Once it&rsquo;s here you can drop a pin on each paired screen so the emergency dashboard knows where every display physically lives.
      </p>
      <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']} fallback={null}>
        <button
          onClick={onUpload}
          className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold inline-flex items-center gap-2 shadow-sm"
        >
          <Upload className="w-4 h-4" /> Upload your first floor plan
        </button>
      </RoleGate>
    </div>
  );
}

// ─── Plan card ────────────────────────────────────────────────────

function PlanCard({ plan, onOpen, onDelete }: { plan: FloorPlan; onOpen: () => void; onDelete: () => void }) {
  const placedCount = plan.screens.filter((s) => s.floorX != null && s.floorY != null).length;
  return (
    <div className="group relative rounded-2xl bg-white border border-slate-200 overflow-hidden shadow-sm hover:shadow-lg hover:border-violet-300 transition-all">
      <button
        onClick={onOpen}
        className="block w-full text-left"
        aria-label={`Open ${plan.name}`}
      >
        <div className="aspect-[16/10] bg-slate-100 overflow-hidden border-b border-slate-200">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={plan.imageUrl}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
        <div className="p-4">
          <h3 className="text-sm font-bold text-slate-800 truncate">{plan.name}</h3>
          <p className="text-[11px] text-slate-500 truncate">
            {[plan.buildingLabel, plan.floorLabel].filter(Boolean).join(' · ') || '—'}
          </p>
          <div className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold text-violet-700 bg-violet-50 border border-violet-100 rounded-full px-2 py-0.5">
            <MapPin className="w-3 h-3" /> {placedCount} placed
            {plan.screens.length - placedCount > 0 && (
              <span className="text-slate-400 font-normal">· {plan.screens.length - placedCount} unplaced</span>
            )}
          </div>
        </div>
      </button>
      <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']} fallback={null}>
        <button
          onClick={onDelete}
          aria-label="Delete plan"
          className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-white/80 hover:bg-rose-50 hover:text-rose-600 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm shadow-sm"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </RoleGate>
    </div>
  );
}

// ─── Upload modal ─────────────────────────────────────────────────

function UploadModal({
  onClose,
  onUpload,
  uploading,
}: {
  onClose: () => void;
  onUpload: (input: { file: File; name: string; buildingLabel?: string; floorLabel?: string }) => Promise<void>;
  uploading: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [buildingLabel, setBuildingLabel] = useState('');
  const [floorLabel, setFloorLabel] = useState('');
  const previewUrl = file ? URL.createObjectURL(file) : null;

  const submit = async () => {
    if (!file || !name.trim()) return;
    await onUpload({ file, name: name.trim(), buildingLabel: buildingLabel.trim() || undefined, floorLabel: floorLabel.trim() || undefined });
  };

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl ring-1 ring-slate-200 max-w-md w-full overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100">
          <h2 className="text-sm font-bold text-slate-800">Upload floor plan</h2>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <div className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Plan image</div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setFile(f);
                  if (!name) setName(f.name.replace(/\.[a-z]+$/i, ''));
                }
              }}
            />
            {!file ? (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="w-full h-32 rounded-xl border-2 border-dashed border-slate-200 hover:border-violet-300 hover:bg-violet-50/40 flex flex-col items-center justify-center gap-1 text-xs text-slate-500 transition-colors"
              >
                <Upload className="w-5 h-5 text-slate-400" />
                <span>Click to choose a PNG / JPG / WEBP</span>
                <span className="text-[10px] text-slate-400">Up to 25 MB</span>
              </button>
            ) : (
              <div className="space-y-2">
                <div className="rounded-xl border border-slate-200 overflow-hidden bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl!} alt="" className="w-full h-40 object-contain bg-white" />
                </div>
                <button
                  type="button"
                  onClick={() => { setFile(null); }}
                  className="text-[11px] text-slate-500 hover:text-rose-600 underline"
                >
                  Choose a different file
                </button>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="fp-name" className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Name</label>
            <input
              id="fp-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lincoln HS — Floor 1"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="fp-building" className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Building (optional)</label>
              <input
                id="fp-building"
                type="text"
                value={buildingLabel}
                onChange={(e) => setBuildingLabel(e.target.value)}
                placeholder="Main"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>
            <div>
              <label htmlFor="fp-floor" className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">Floor (optional)</label>
              <input
                id="fp-floor"
                type="text"
                value={floorLabel}
                onChange={(e) => setFloorLabel(e.target.value)}
                placeholder="1"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/40 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50">Cancel</button>
          <button
            onClick={submit}
            disabled={!file || !name.trim() || uploading}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {uploading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {uploading ? 'Uploading' : 'Upload'}
          </button>
        </div>
      </div>
    </div>
  );
}
