"use client";

/**
 * FloorPlanManageActions — the ONE place a floor plan is replaced or deleted.
 *
 * 2026-08-25. The operator was standing on Settings → Emergency, which mounts
 * the floor-plan drawer inline (that page's whole UX contract is "you never
 * leave this URL while configuring emergency"), and asked how to delete or
 * change a plan. The answer was "go to Screens → Floor plans" — a different
 * page — because the drawer had `+ Add plan` and nothing else. Then:
 * "add change so i can swap images and not just delete and add".
 *
 * So both controls now live wherever a plan is shown, and they live HERE so
 * the Screens grid and the emergency drawer can never drift into two
 * different delete confirmations or two different replace flows:
 *
 *   variant="card" — two icon buttons, for the plan cards in the Screens tab.
 *   variant="bar"  — two labelled buttons, for the plan header in the drawer.
 *
 * REPLACE keeps the pins. Placements are stored as pixel coordinates in the
 * plan image's own space (Screen.floorX/floorY) and drawn as a fraction of
 * the plan box, so the API rescales every placement into the new image's
 * coordinate space rather than dropping it. When the new image is a different
 * SHAPE that fraction no longer points at the same room — we say so in the
 * confirm step and again after the swap instead of quietly moving screens.
 */

import { useEffect, useRef, useState } from 'react';
import { ImageUp, Trash2, Loader2, Upload, X } from 'lucide-react';
import { RoleGate } from '@/components/RoleGate';
import { appAlert, appConfirm } from '@/components/ui/app-dialog';
import { useOverlayLock } from '@/hooks/use-overlay-lock';
import {
  useDeleteFloorPlan,
  useReplaceFloorPlanImage,
  readImageDimensions,
  type FloorPlan,
} from '@/hooks/use-api';

const MANAGE_ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'] as const;

/** Same 1% the API uses to decide "different shape". */
const ASPECT_TOLERANCE = 0.01;

/**
 * The bits of a plan these controls need. Structural so both call sites fit:
 * the Screens grid passes a list row, the drawer passes the detail row.
 */
export type ManageableFloorPlan = Pick<FloorPlan, 'id' | 'name' | 'widthPx' | 'heightPx'> & {
  screens?: Array<{ floorX: number | null; floorY: number | null }>;
};

function pinnedCount(plan: ManageableFloorPlan): number {
  return (plan.screens || []).filter((s) => s.floorX != null && s.floorY != null).length;
}

/**
 * Delete a plan behind the standard confirmation. Owns the copy so every
 * surface asks the same question and warns about the same consequence
 * (the pins go away — that is the part the operator cares about).
 * Resolves true when the plan was actually deleted.
 */
export function useFloorPlanDelete() {
  const deleteMutation = useDeleteFloorPlan();

  const confirmAndDelete = async (plan: ManageableFloorPlan): Promise<boolean> => {
    const ok = await appConfirm({
      title: `Delete "${plan.name}"?`,
      message:
        'This removes the floor plan and detaches every screen placed on it. The screens themselves stay paired and will revert to "unplaced" status.',
      tone: 'danger',
      confirmLabel: 'Delete plan',
    });
    if (!ok) return false;
    try {
      await deleteMutation.mutateAsync(plan.id);
      return true;
    } catch (err: any) {
      await appAlert({
        title: "Couldn't delete plan",
        message: err?.message || 'Try again, or refresh if the issue persists.',
        tone: 'danger',
      });
      return false;
    }
  };

  return { confirmAndDelete, isDeleting: deleteMutation.isPending };
}

export function FloorPlanManageActions({
  plan,
  variant = 'bar',
  onDeleted,
  onReplaced,
}: {
  plan: ManageableFloorPlan;
  variant?: 'bar' | 'card';
  /** Called after the plan is gone — the host re-selects or navigates away. */
  onDeleted?: (planId: string) => void;
  onReplaced?: (planId: string) => void;
}) {
  const [replaceOpen, setReplaceOpen] = useState(false);
  const { confirmAndDelete, isDeleting } = useFloorPlanDelete();

  const handleDelete = async () => {
    const deleted = await confirmAndDelete(plan);
    if (deleted) onDeleted?.(plan.id);
  };

  const isCard = variant === 'card';

  return (
    <RoleGate allowedRoles={[...MANAGE_ROLES]} fallback={null}>
      <div className={isCard ? 'flex items-center gap-1' : 'flex items-center gap-2'}>
        <button
          type="button"
          onClick={() => setReplaceOpen(true)}
          aria-label={`Replace image for ${plan.name}`}
          title="Replace image — keeps your pins"
          className={
            isCard
              ? 'w-8 h-8 rounded-lg bg-white/80 hover:bg-violet-50 hover:text-violet-700 text-slate-500 flex items-center justify-center backdrop-blur-sm shadow-sm'
              : 'px-3 py-1.5 rounded-md border border-slate-200 hover:border-violet-300 hover:text-violet-700 text-[11px] font-bold text-slate-700 inline-flex items-center gap-1.5 transition-colors'
          }
        >
          <ImageUp className={isCard ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
          {!isCard && <span>Replace image</span>}
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          aria-label={`Delete plan ${plan.name}`}
          title="Delete plan"
          className={
            isCard
              ? 'w-8 h-8 rounded-lg bg-white/80 hover:bg-rose-50 hover:text-rose-600 text-slate-500 flex items-center justify-center backdrop-blur-sm shadow-sm'
              : 'px-3 py-1.5 rounded-md border border-slate-200 hover:border-rose-300 hover:text-rose-700 text-[11px] font-bold text-slate-700 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50'
          }
        >
          {isDeleting && !isCard ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Trash2 className={isCard ? 'w-4 h-4' : 'w-3.5 h-3.5'} />
          )}
          {!isCard && <span>Delete plan</span>}
        </button>
      </div>

      {replaceOpen && (
        <ReplaceFloorPlanImageDialog
          plan={plan}
          onClose={() => setReplaceOpen(false)}
          onReplaced={() => {
            setReplaceOpen(false);
            onReplaced?.(plan.id);
          }}
        />
      )}
    </RoleGate>
  );
}

// ─── Replace dialog ───────────────────────────────────────────────

export function ReplaceFloorPlanImageDialog({
  plan,
  onClose,
  onReplaced,
}: {
  plan: ManageableFloorPlan;
  onClose: () => void;
  onReplaced: () => void;
}) {
  useOverlayLock(); // hide the mobile tab bar so the dialog footer clears it
  const replaceMutation = useReplaceFloorPlanImage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dims, setDims] = useState<{ widthPx: number; heightPx: number } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !replaceMutation.isPending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, replaceMutation.isPending]);

  // Object URLs are revoked when the choice changes and on unmount — a
  // leaked one pins the whole image in memory for the session.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const pins = pinnedCount(plan);
  const oldAspect = plan.widthPx > 0 && plan.heightPx > 0 ? plan.widthPx / plan.heightPx : null;
  const newAspect = dims && dims.heightPx > 0 ? dims.widthPx / dims.heightPx : null;
  const shapeChanged =
    oldAspect != null && newAspect != null
      ? Math.abs(newAspect - oldAspect) / oldAspect > ASPECT_TOLERANCE
      : false;

  const onPick = async (picked: File) => {
    setErr(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(picked);
    });
    setFile(picked);
    setDims(null);
    try {
      setDims(await readImageDimensions(picked));
    } catch {
      // Dimensions drive only the shape warning — the server probes the
      // real ones anyway. Let the operator continue without them.
      setDims(null);
    }
  };

  const submit = async () => {
    if (!file || replaceMutation.isPending) return;
    setErr(null);
    try {
      const result = await replaceMutation.mutateAsync({ planId: plan.id, file });
      const summary = result?.imageReplace;
      onReplaced();
      if (summary?.aspectRatioChanged && summary.placementsKept > 0) {
        await appAlert({
          title: 'Image replaced — check your pins',
          message: `The new image is a different shape, so your ${summary.placementsKept} ${
            summary.placementsKept === 1 ? 'pin' : 'pins'
          } kept their spot on the plan but may not line up with the rooms. Drag any that look off.`,
          tone: 'warn',
        });
      }
    } catch (e: any) {
      setErr(e?.message || 'Make sure the file is a PNG / JPG / WEBP under 25 MB.');
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Replace floor plan image" className="fixed top-0 right-0 bottom-0 left-0 z-[10000] flex items-center justify-center p-4">
      {/* Backdrop. aria-hidden because Escape (wired above) is the keyboard
          route out — the click is a mouse convenience, not the only exit. */}
      <div
        aria-hidden
        className="absolute top-0 right-0 bottom-0 left-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={() => !replaceMutation.isPending && onClose()}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl ring-1 ring-slate-200 max-w-md w-full overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold text-slate-800 truncate">Replace image — {plan.name}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-7 h-7 rounded-md text-slate-500 hover:bg-slate-100 flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Swap in a new drawing for this floor. Your screen pins stay on the plan — you don&rsquo;t have to place them again.
          </p>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPick(f);
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
                onClick={() => fileRef.current?.click()}
                className="text-[11px] text-slate-500 hover:text-violet-700 underline"
              >
                Choose a different file
              </button>
            </div>
          )}

          {/* What happens to the pins. Stated before the swap, not after. */}
          <div
            className={`rounded-lg border px-3 py-2 text-[11px] leading-snug ${
              shapeChanged && pins > 0
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
          >
            {pins === 0 ? (
              <>No screens are pinned to this plan yet.</>
            ) : shapeChanged ? (
              <>
                The new image is a different shape. Your <strong className="font-bold">{pins}</strong>{' '}
                {pins === 1 ? 'pin' : 'pins'} keep their spot on the plan, but some may need repositioning.
              </>
            ) : (
              <>
                Your <strong className="font-bold">{pins}</strong> {pins === 1 ? 'pin stays' : 'pins stay'} exactly
                where {pins === 1 ? 'it is' : 'they are'}.
              </>
            )}
          </div>

          {err && (
            <p role="alert" className="text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2 leading-snug">
              {err}
            </p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/40 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={replaceMutation.isPending}
            className="px-3 py-2 rounded-lg text-xs font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!file || replaceMutation.isPending}
            className="px-4 py-2 rounded-lg text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {replaceMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {replaceMutation.isPending ? 'Replacing' : 'Replace image'}
          </button>
        </div>
      </div>
    </div>
  );
}
