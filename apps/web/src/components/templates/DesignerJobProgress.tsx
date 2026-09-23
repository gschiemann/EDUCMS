'use client';

/**
 * The AI Designer's generating state, now that a generation is a background JOB (2026-09-23).
 *
 * A batch used to be one synchronous request with a spinner and nothing else. It now runs on the
 * server as a job the page polls, and the pipeline reports where it is — drawing, checking the
 * details, then (with the renderer on) previewing, looking at and fixing each option. This row
 * says that in operator words ("Drawing 3 boards…", "Looking at option 2…", "Fixing option 2…")
 * and carries the one way out while a job runs: Cancel. The dialog cannot be closed mid-job, the
 * same as it could not be closed mid-request.
 *
 * `DesignerBoundBadge` is the pick grid's "Bound to Toast · 9 items" when a batch came back bound
 * to a POS menu.
 *
 * No timers, no polling and no blur here — the job hook owns polling (visible-tab only), this only
 * renders what it last heard (mobile-perf standard).
 */
import { Link2, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { DesignerJob } from '@/hooks/use-api';
import { designerJobStageMessage } from '@/lib/designer-jobs';

export interface DesignerJobProgressProps {
  /** The job as last polled. Null/undefined before its first answer — reads "Getting started…". */
  job: Pick<DesignerJob, 'status' | 'progress'> | null | undefined;
  /** Absent while the job has no id yet (its start request is still in flight). */
  onCancel?: () => void;
  cancelling?: boolean;
}

export function DesignerJobProgress({ job, onCancel, cancelling = false }: DesignerJobProgressProps) {
  const t = useTranslations('aiBoards');
  return (
    <div
      data-testid="designer-job-progress"
      className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-2"
    >
      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-600 motion-reduce:animate-none" aria-hidden />
      {/* Only the stage line is live — the button's own label must not be announced as progress. */}
      <p role="status" aria-live="polite" className="min-w-0 flex-1 text-sm font-semibold text-violet-800">
        {designerJobStageMessage(t, job)}
      </p>
      <button
        type="button"
        onClick={onCancel}
        disabled={!onCancel || cancelling}
        className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-violet-200 bg-white px-3 text-xs font-bold text-violet-700 transition-colors hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:opacity-50 sm:min-h-9 motion-reduce:transition-none"
      >
        {cancelling ? t('job.cancelling') : t('job.cancel')}
      </button>
    </div>
  );
}

export interface DesignerBoundBadgeProps {
  boundTo: { providerName: string; itemCount: number };
}

export function DesignerBoundBadge({ boundTo }: DesignerBoundBadgeProps) {
  const t = useTranslations('aiBoards');
  return (
    <span
      data-testid="designer-bound-badge"
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700"
    >
      <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {t('boundTo', { provider: boundTo.providerName, count: boundTo.itemCount })}
    </span>
  );
}
