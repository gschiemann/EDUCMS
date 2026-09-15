"use client";

/**
 * FloorPlansView — extracted from /[schoolId]/floor-plans/page.tsx
 * on 2026-05-14 so the Screens page can render the same grid inline
 * as one of its tab views (List / Map / Floor plans).
 *
 * Operator (2026-05-14): "when you pick map it keeps you in the same
 * area but when you pick floor map it takes you to an entire new
 * screen, keep all of those the same so i can change the tab from
 * list, map, floorplan and not leave the same frame".
 *
 * Two render variants:
 *   - default (standalone): renders on /[schoolId]/floor-plans with
 *     a full page header (icon + title + description + upload button)
 *   - embedded: renders as a Screens-page tab body. No big title
 *     (the tab bar tells the operator what they're looking at);
 *     just a compact action row with the upload button + the grid.
 *
 * Drilling into a single plan still routes to /floor-plans/[id] —
 * that pin-placement editor is a focused full-screen workflow,
 * not something to cram inside the tab.
 */

import { useState, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Map, Plus, Loader2, Upload, MapPin } from 'lucide-react';
import { RoleGate } from '@/components/RoleGate';
import { useFloorPlans, useUploadFloorPlan, type FloorPlan } from '@/hooks/use-api';
import { appAlert } from '@/components/ui/app-dialog';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
// Replace + delete live in one shared component so this grid and the
// emergency-settings drawer can't drift into two different flows.
import { FloorPlanManageActions } from '@/components/floor-plans/FloorPlanManageActions';
// The Floor plans TAB is the editor itself (2026-09-14, Greg: "this screen
// should let us drag and drop the screens where they physically are and
// that's what this screen should display, not just some uploaded image").
import { EmbeddedFloorPlanView } from '@/components/floor-plans/EmbeddedFloorPlanView';

export function FloorPlansView({ embedded = false }: { embedded?: boolean } = {}) {
  const params = useParams<{ schoolId: string }>();
  const schoolId = params?.schoolId ?? '';
  const router = useRouter();
  const { data: plans, isLoading } = useFloorPlans();
  const uploadMutation = useUploadFloorPlan();
  const [showUpload, setShowUpload] = useState(false);
  // Embedded tab: which plan the inline editor shows. Follows the list — the
  // first plan by default, a freshly uploaded one immediately, the next one
  // when the current plan is deleted.
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const selectedPlan = plans?.find((p) => p.id === selectedPlanId) ?? plans?.[0] ?? null;
  useEffect(() => {
    if (plans && plans.length > 0 && !plans.some((p) => p.id === selectedPlanId)) setSelectedPlanId(plans[0].id);
  }, [plans, selectedPlanId]);

  return (
    <div className="space-y-4">
      {embedded ? (
        // Compact action row for the embedded tab variant. Skips the
        // big h1 since the screens page already has one — operator sees
        // "Screens" up top + the tab pill telling them they're on
        // "Floor plans"; a second h1 here would be visually noisy.
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-lg bg-violet-100 text-violet-700 shrink-0">
              <Map className="w-4 h-4" />
            </div>
            <p className="text-xs text-slate-500">
              Drag each screen to where it physically sits. Pins show live status, and emergency content can then target a room or wing.
            </p>
          </div>
          <RoleGate allowedRoles={['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']} fallback={null}>
            <button
              onClick={() => setShowUpload(true)}
              className="px-3.5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors shrink-0 self-start sm:self-auto"
            >
              <Plus className="w-3.5 h-3.5" /> Upload floor plan
            </button>
          </RoleGate>
        </div>
      ) : (
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
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : !plans || plans.length === 0 ? (
        <EmptyState onUpload={() => setShowUpload(true)} />
      ) : embedded ? (
        <div className="space-y-3">
          {plans.length > 1 && (
            <div role="tablist" aria-label="Floor plans" className="flex flex-wrap gap-2">
              {plans.map((p) => {
                const active = p.id === selectedPlan?.id;
                const placed = p.screens.filter((sc) => sc.floorX != null && sc.floorY != null).length;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSelectedPlanId(p.id)}
                    className={`px-3.5 py-2 rounded-full text-xs font-bold border transition-colors ${
                      active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {p.name}
                    <span className={`ml-1.5 ${active ? 'text-slate-300' : 'text-slate-400'}`}>{placed}/{p.screens.length} placed</span>
                  </button>
                );
              })}
            </div>
          )}
          {selectedPlan && (
            <EmbeddedFloorPlanView
              key={selectedPlan.id}
              planId={selectedPlan.id}
              schoolId={schoolId}
              mode="embedded"
              onPlanDeleted={() => setSelectedPlanId(null)}
            />
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              onOpen={() => router.push(`/${schoolId}/floor-plans/${p.id}`)}
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
              // In the tab the new plan opens right here; the standalone page
              // still goes to its own editor route.
              if (embedded) setSelectedPlanId(created.id);
              else router.push(`/${schoolId}/floor-plans/${created.id}`);
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

function PlanCard({ plan, onOpen }: { plan: FloorPlan; onOpen: () => void }) {
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
      {/* Replace image + delete. Same two controls, same flows, as the
          emergency-settings drawer — see FloorPlanManageActions. */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <FloorPlanManageActions plan={plan} variant="card" />
      </div>
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
  useOverlayLock(); // hide mobile tab bar so the upload modal footer clears it
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
