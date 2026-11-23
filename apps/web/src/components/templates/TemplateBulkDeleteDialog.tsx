'use client';

/**
 * One confirmation for deleting several templates (owner, 2026-11-23).
 *
 * Before: the bulk delete never forced, skipped every in-use template with a
 * toast that blamed "in use" for any failure, and "Select all" reached only
 * the first page. Now one dialog lists every in-use template with where it is
 * used and a checkbox per row, CHECKED by default — deleting what was selected
 * is the default, keeping one is an untick. Emergency-protected templates are
 * listed as kept with no checkbox (the server refuses them even with force;
 * no client path asks it to). One button deletes the rest.
 *
 * The owner asked for a popup per in-use template; a row per template, all
 * pre-checked, in one dialog is that same choice made in one click.
 *
 * Planning, partitioning and tallying live in `template-bulk-delete.ts`.
 * `ConnectedTemplateBulkDeleteDialog` (below) is what
 * `app/[schoolId]/templates/page.tsx` mounts for the gallery's bulk Delete.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { AlertTriangle, Loader2, ShieldAlert } from 'lucide-react';
import {
  buildDeletePlan, classifyTargets, declineUsageChanged, defaultChecked, emptyTally,
  needsUsageRead, readUsages, runDeletePlan, summarise, tallyRound,
  type BulkDeleteRow, type BulkDeleteSummary, type BulkDeleteTarget, type BulkDeleteTally,
} from './template-bulk-delete';

interface Round { targets: BulkDeleteTarget[]; followUp: boolean }

export function TemplateBulkDeleteDialog({
  targets, loadUsage, deleteOne, onDone, onCancel,
}: {
  targets: BulkDeleteTarget[];
  /** `GET /templates/:id/usage` — resolves with the raw answer. */
  loadUsage: (id: string) => Promise<unknown>;
  /** `DELETE /templates/:id[?force=true]` — rejects with the API error (code/message). */
  deleteOne: (id: string, force: boolean) => Promise<unknown>;
  /** Something was attempted; the summary is what actually happened. */
  onDone: (summary: BulkDeleteSummary) => void;
  /** Cancelled before anything was deleted. */
  onCancel: () => void;
}) {
  const t = useTranslations('templateBulkDelete');
  const tDel = useTranslations('templateDelete');
  const unknownMessage = t('usageUnknown');

  const [round, setRound] = useState<Round>(() => ({ targets, followUp: false }));
  // A selection with nothing to check is ready at first paint — no spinner flash.
  const [rows, setRows] = useState<BulkDeleteRow[] | null>(() =>
    targets.some(needsUsageRead) ? null : classifyTargets(targets, new Map(), unknownMessage));
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const tallyRef = useRef<BulkDeleteTally>(emptyTally());
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Fresh usage for just the templates that may be in use, bounded and parallel.
  useEffect(() => {
    if (!round.targets.some(needsUsageRead)) return;
    let live = true;
    // `rows` is already null here: the initial state, or reset by confirm() with the new round.
    void readUsages(round.targets, loadUsage, unknownMessage).then((reads) => {
      if (!live || !mountedRef.current) return;
      const next = classifyTargets(round.targets, reads, unknownMessage);
      setRows(next);
      setChecked(defaultChecked(next));
    });
    return () => { live = false; };
    // `loadUsage` / the message are stable for the dialog's life; a new round re-reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  const deleting = progress !== null;
  const checking = rows === null;
  const plan = rows ? buildDeletePlan(rows, checked) : null;
  const deletable = plan?.ops.length ?? 0;
  // Kept rows (emergency, unreadable) first, so what will NOT be deleted is
  // never below the scroll fold; then the in-use rows, in gallery order.
  const inUseRows = [
    ...(rows?.filter((r) => r.kind === 'emergency' || r.kind === 'unknown') ?? []),
    ...(rows?.filter((r) => r.kind === 'in-use') ?? []),
  ];
  const inUseCount = rows?.filter((r) => r.kind === 'in-use').length ?? 0;

  function cancel() {
    if (deleting) return;
    if (round.followUp) {
      // The first round already deleted things: report it, and keep these by choice.
      onDone(summarise(declineUsageChanged(tallyRef.current)));
      return;
    }
    onCancel();
  }

  async function confirm() {
    if (!rows || !plan || deleting || plan.ops.length === 0) return;
    setProgress({ done: 0, total: plan.ops.length });
    const results = await runDeletePlan(plan.ops, deleteOne, {
      fallbackMessage: tDel('deleteFailed'),
      onProgress: (done, total) => { if (mountedRef.current) setProgress({ done, total }); },
    });
    tallyRef.current = tallyRound(tallyRef.current, plan, results);
    const changed = tallyRef.current.usageChanged;
    if (changed.length > 0 && mountedRef.current) {
      // Usage changed after the read: never forced silently. One follow-up
      // confirmation, same rows, for just those.
      setProgress(null);
      setRows(null);
      setChecked(new Set());
      setRound({ targets: changed.map((c) => ({ id: c.id, name: c.name })), followUp: true });
      return;
    }
    onDone(summarise(tallyRef.current));
  }

  const toggle = (id: string) => setChecked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Focus: parked on the primary action once there is one; Cancel otherwise.
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const cancelFnRef = useRef(cancel);
  useEffect(() => { cancelFnRef.current = cancel; });
  const canConfirm = !checking && !deleting && deletable > 0;
  useEffect(() => {
    if (deleting) return;
    const raf = requestAnimationFrame(() => {
      (canConfirm ? primaryRef.current : cancelRef.current)?.focus();
    });
    return () => cancelAnimationFrame(raf);
    // Re-park only when the dialog's phase changes, not on every checkbox tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checking, round]);
  useEffect(() => {
    restoreRef.current = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); cancelFnRef.current(); return; }
      if (e.key === 'Tab' && dialogRef.current) {
        const nodes = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ));
        if (nodes.length === 0) return;
        e.preventDefault();
        const idx = nodes.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (idx <= 0 ? nodes.length - 1 : idx - 1) : (idx === nodes.length - 1 ? 0 : idx + 1);
        nodes[next].focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (restoreRef.current?.isConnected) restoreRef.current.focus();
    };
  }, []);

  const usageLine = (r: BulkDeleteRow): string => {
    if (r.kind !== 'in-use') return '';
    const bits: string[] = [];
    if (r.usage.total > 0) bits.push(tDel('playlistCount', { count: r.usage.total }));
    if (typeof r.usage.screensReached === 'number' && r.usage.screensReached > 0) {
      bits.push(tDel('screenCount', { count: r.usage.screensReached }));
    }
    return bits.join(' · ');
  };
  const clean = (name: string) => (name || '').replace(/\s+/g, ' ').trim() || t('untitled');

  const total = round.targets.length;
  let confirmLabel: string;
  if (deleting) confirmLabel = t('progress', { done: progress!.done, total: progress!.total });
  else if (checking) confirmLabel = t('checkingShort');
  else if (deletable === 0) confirmLabel = t('nothingToDelete');
  else confirmLabel = t('confirm', { count: deletable });

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="presentation"
      className="fixed top-0 right-0 bottom-0 left-0 z-[110] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4"
      onClick={(e) => { if (e.target === e.currentTarget) cancel(); }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="tpl-bulk-delete-title"
        aria-describedby="tpl-bulk-delete-body"
        aria-busy={checking || deleting}
        data-testid="templates-bulk-delete-dialog"
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50">
            <AlertTriangle className="h-4.5 w-4.5 text-amber-500" aria-hidden />
          </div>
          <h2 id="tpl-bulk-delete-title" className="min-w-0 pt-1.5 text-[15px] font-bold text-slate-800">
            {round.followUp ? t('followUpTitle', { count: total }) : t('title', { count: total })}
          </h2>
        </div>

        <div id="tpl-bulk-delete-body" className="mt-3 flex min-h-0 flex-col">
          {checking ? (
            <p className="flex items-center gap-2 text-[13px] text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              {t('checking')}
            </p>
          ) : (
            <>
              {round.followUp && <p className="text-[13px] text-slate-600">{t('followUpBody')}</p>}
              {inUseCount > 0 && (
                <p className="text-[13px] text-slate-600">{t('inUseIntro', { count: inUseCount })}</p>
              )}
              {inUseRows.length > 0 && (
                <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto rounded-lg bg-slate-50 p-1.5" data-testid="templates-bulk-delete-rows">
                  {inUseRows.map((r) => (
                    <li key={r.id} data-testid={`templates-bulk-delete-row-${r.id}`} data-kind={r.kind}>
                      {r.kind === 'in-use' ? (
                        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-white focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-500">
                          <input
                            type="checkbox"
                            checked={checked.has(r.id)}
                            onChange={() => toggle(r.id)}
                            disabled={deleting}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-rose-600"
                          />
                          <span className="min-w-0 break-words text-[13px] font-semibold text-slate-700">
                            {clean(r.name)}
                            <span className="block text-[12px] font-normal text-slate-500">{usageLine(r) || t('inUse')}</span>
                          </span>
                        </label>
                      ) : (
                        <div className="flex min-h-11 items-start gap-3 px-2 py-2">
                          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden />
                          <span className="min-w-0">
                            <span className="block break-words text-[13px] font-semibold text-slate-700">{clean(r.name)}</span>
                            <span className="block text-[12px] font-medium text-rose-700">
                              {r.kind === 'emergency' ? t('keptEmergency') : t('keptUnknown')}
                            </span>
                          </span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[13px] text-slate-600">{tDel('permanent')}</p>
            </>
          )}
        </div>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={cancel}
            disabled={deleting}
            className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-600 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {tDel('cancel')}
          </button>
          <button
            ref={primaryRef}
            type="button"
            onClick={() => { void confirm(); }}
            disabled={!canConfirm}
            data-testid="templates-bulk-delete-confirm"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-rose-600 px-4 text-[13px] font-bold text-white tabular-nums hover:bg-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {deleting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The dialog wired to the API. It reads the query client only while mounted
 * (the gallery renders it only once Delete is pressed), and calls the API
 * directly rather than through the per-item mutation, so thirty deletes cost
 * one list refetch at the end instead of thirty: each success drops its card
 * from the cached list as it lands.
 */
export function ConnectedTemplateBulkDeleteDialog({
  targets, onDone, onCancel,
}: {
  targets: BulkDeleteTarget[];
  onDone: (summary: BulkDeleteSummary) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const loadUsage = useCallback(
    (id: string) => apiFetch(`/templates/${encodeURIComponent(id)}/usage`),
    [],
  );
  const deleteOne = useCallback(async (id: string, force: boolean) => {
    await apiFetch(`/templates/${encodeURIComponent(id)}${force ? '?force=true' : ''}`, { method: 'DELETE' });
    qc.setQueriesData({ queryKey: ['templates'] }, (val: unknown) =>
      Array.isArray(val) ? val.filter((x: { id?: string } | null) => x?.id !== id) : val);
  }, [qc]);
  const done = useCallback((summary: BulkDeleteSummary) => {
    void qc.invalidateQueries({ queryKey: ['templates'] });
    onDone(summary);
  }, [qc, onDone]);
  return (
    <TemplateBulkDeleteDialog targets={targets} loadUsage={loadUsage} deleteOne={deleteOne} onDone={done} onCancel={onCancel} />
  );
}
