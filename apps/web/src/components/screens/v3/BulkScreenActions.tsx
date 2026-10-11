"use client";

/**
 * Bulk screen actions (2026-10-11) — the bar and the confirm / results sheet.
 *
 * Greg: "If I want to manually push a resync, an update of the player, allow
 * me to do a select-all and push — by group at least. Doing one at a time is
 * not good when every screen needs it."
 *
 * THE BAR appears once anything is selected: the count, "Select all N" (only
 * when N is more than what is selected — the app's one select-all pattern,
 * components/common/SelectionCheckbox.tsx), Clear, and the actions.
 *
 * THE SHEET never fires on the first tap. It asks the SERVER for the plan
 * (`dryRun: true` — which screens get it, which are skipped and why, which
 * will show an Install prompt), shows it, sends only on Confirm, and then
 * names every screen's outcome: sent / skipped with the reason / did not go
 * with the reason. Never a silent partial failure.
 *
 * Dashboard surface (not player/widget): CSS gap is fine. No backdrop-blur and
 * no timers (mobile performance standard) — the sheet is two requests, both
 * started by a tap.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Power, PowerOff, RefreshCw, Download, X, XCircle, MinusCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useBulkScreenAction, type BulkScreenResponse } from '@/hooks/use-api';
import { groupResults, reasonKey, requestFor, type BulkKind } from './bulkSelection';

const BRAND = { background: 'var(--brand-primary, #4f46e5)' } as const;
const BTN = 'min-h-11 sm:min-h-0 sm:h-9 px-3.5 rounded-xl text-[12.5px] font-bold inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed';
const BTN_QUIET = `${BTN} bg-white text-slate-700 border border-slate-200 hover:bg-slate-50`;

export interface BulkActionBarProps {
  selectedCount: number;
  /** Screens the current filter + search shows — what "Select all N" selects. */
  visibleCount: number;
  onSelectAll: () => void;
  onClear: () => void;
  onAction: (kind: BulkKind) => void;
  disabled?: boolean;
}

export function BulkActionBar({ selectedCount, visibleCount, onSelectAll, onClear, onAction, disabled }: BulkActionBarProps) {
  const t = useTranslations();
  return (
    <div
      role="region"
      aria-label={t('screens.bulk.barLabel')}
      data-testid="screens-bulk-bar"
      className="sticky top-0 z-20 bg-white rounded-2xl border border-slate-200 shadow-sm px-3 py-2 flex flex-wrap items-center gap-2"
    >
      <span className="text-[13px] font-bold text-slate-800 tabular-nums" aria-live="polite" data-testid="screens-bulk-count">
        {t('screens.bulk.selectedCount', { count: selectedCount })}
      </span>
      {visibleCount > selectedCount && (
        <button type="button" onClick={onSelectAll} className="min-h-11 sm:min-h-0 text-[13px] font-semibold underline underline-offset-2 px-1" style={{ color: 'var(--brand-primary, #4f46e5)' }}>
          {t('screens.bulk.selectAllCount', { count: visibleCount })}
        </button>
      )}
      <button type="button" onClick={onClear} className="min-h-11 sm:min-h-0 text-[13px] font-semibold text-slate-500 hover:underline px-1">
        {t('screens.bulk.clear')}
      </button>
      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:ml-auto">
        <button type="button" disabled={disabled} onClick={() => onAction('resync')} className={`${BTN} text-white`} style={BRAND} data-testid="screens-bulk-resync">
          <RefreshCw className="w-4 h-4" aria-hidden /> {t('screens.bulk.resync')}
        </button>
        <button type="button" disabled={disabled} onClick={() => onAction('update')} className={BTN_QUIET} data-testid="screens-bulk-update">
          <Download className="w-4 h-4" aria-hidden /> {t('screens.bulk.update')}
        </button>
        <button type="button" disabled={disabled} onClick={() => onAction('power-on')} className={BTN_QUIET} data-testid="screens-bulk-power-on">
          <Power className="w-4 h-4" aria-hidden /> {t('screens.bulk.powerOn')}
        </button>
        <button type="button" disabled={disabled} onClick={() => onAction('power-off')} className={BTN_QUIET} data-testid="screens-bulk-power-off">
          <PowerOff className="w-4 h-4" aria-hidden /> {t('screens.bulk.powerOff')}
        </button>
        {/* A native select: the right control on an iPhone, and no popover to manage. */}
        <select
          aria-label={t('screens.bulk.autoUpdate')}
          disabled={disabled}
          value=""
          data-testid="screens-bulk-auto"
          onChange={(e) => {
            const v = e.target.value as BulkKind;
            e.currentTarget.value = '';
            if (v) onAction(v);
          }}
          className={`${BTN_QUIET} pr-2`}
        >
          <option value="">{t('screens.bulk.autoUpdate')}…</option>
          <option value="auto-on">{t('screens.bulk.autoOn')}</option>
          <option value="auto-off">{t('screens.bulk.autoOff')}</option>
          <option value="auto-inherit">{t('screens.bulk.autoInherit')}</option>
        </select>
      </div>
    </div>
  );
}

const TITLE_KEY: Record<BulkKind, string> = {
  resync: 'titleResync', update: 'titleUpdate', 'power-on': 'titlePowerOn', 'power-off': 'titlePowerOff',
  'auto-on': 'titleAuto', 'auto-off': 'titleAuto', 'auto-inherit': 'titleAuto',
};
const CONFIRM_KEY: Record<BulkKind, string> = {
  resync: 'confirmResync', update: 'confirmUpdate', 'power-on': 'confirmPowerOn', 'power-off': 'confirmPowerOff',
  'auto-on': 'confirmAuto', 'auto-off': 'confirmAuto', 'auto-inherit': 'confirmAuto',
};

type Phase =
  | { k: 'planning' }
  | { k: 'plan-error'; message: string }
  | { k: 'confirm'; plan: BulkScreenResponse }
  | { k: 'sending'; plan: BulkScreenResponse }
  | { k: 'send-error'; plan: BulkScreenResponse; message: string }
  | { k: 'done'; result: BulkScreenResponse };

export interface BulkActionSheetProps {
  kind: BulkKind;
  screenIds: string[];
  onClose: () => void;
  /** Run the same action again on just these ids (the ones that did not go). */
  onRetry: (screenIds: string[]) => void;
  /** After a real send — the page refetches. */
  onSent?: (result: BulkScreenResponse) => void;
}

export function BulkActionSheet({ kind, screenIds, onClose, onRetry, onSent }: BulkActionSheetProps) {
  const t = useTranslations();
  const bulk = useBulkScreenAction();
  const [phase, setPhase] = useState<Phase>({ k: 'planning' });
  const panelRef = useRef<HTMLDivElement>(null);
  const request = useMemo(() => requestFor(kind, screenIds), [kind, screenIds]);
  const sending = phase.k === 'sending';

  // Ask the server for the plan once per sheet.
  const mutateRef = useRef(bulk.mutateAsync);
  useEffect(() => { mutateRef.current = bulk.mutateAsync; });
  useEffect(() => {
    // One plan per sheet: the page keys the sheet per run, so `request` never
    // changes under a mounted sheet and the initial phase is already 'planning'.
    let live = true;
    mutateRef.current({ ...request, dryRun: true })
      .then((plan) => { if (live) setPhase({ k: 'confirm', plan }); })
      .catch((e: unknown) => { if (live) setPhase({ k: 'plan-error', message: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [request]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, sending]);

  const send = async () => {
    if (phase.k !== 'confirm' && phase.k !== 'send-error') return;
    const plan = phase.plan;
    setPhase({ k: 'sending', plan });
    try {
      const result = await bulk.mutateAsync({ ...request, dryRun: false });
      setPhase({ k: 'done', result });
      onSent?.(result);
    } catch (e) {
      setPhase({ k: 'send-error', plan, message: e instanceof Error ? e.message : String(e) });
    }
  };

  const reasonText = (reason?: string, message?: string) => {
    const key = reasonKey(reason);
    return key ? t(key) : message ?? t('screens.bulk.reason.error');
  };
  const what = () => {
    switch (kind) {
      case 'resync': return t('screens.bulk.whatResync');
      case 'update': {
        const v = phase.k === 'confirm' || phase.k === 'sending' || phase.k === 'send-error' ? phase.plan.latestPlayerVersion : null;
        return v ? t('screens.bulk.whatUpdate', { version: v }) : t('screens.bulk.whatUpdateUnknown');
      }
      case 'power-on': return t('screens.bulk.whatPowerOn');
      case 'power-off': return t('screens.bulk.whatPowerOff');
      case 'auto-on': return t('screens.bulk.whatAutoOn');
      case 'auto-off': return t('screens.bulk.whatAutoOff');
      case 'auto-inherit': return t('screens.bulk.whatAutoInherit');
    }
  };
  const danger = kind === 'power-off';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="screens-bulk-title"
      data-testid="screens-bulk-sheet"
      className="fixed top-0 right-0 bottom-0 left-0 z-50 bg-black/50 flex items-end sm:items-center justify-center sm:p-4"
    >
      <button type="button" aria-label={t('screens.bulk.close')} tabIndex={-1} onClick={() => { if (!sending) onClose(); }} className="absolute top-0 right-0 bottom-0 left-0 cursor-default" />
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative w-full sm:max-w-lg max-h-[85vh] overflow-y-auto bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 outline-none"
        style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-start gap-3">
          <h2 id="screens-bulk-title" className="flex-1 text-[16px] font-bold text-slate-900">
            {phase.k === 'done' ? t('screens.bulk.resultTitle') : t(`screens.bulk.${TITLE_KEY[kind]}`, { count: screenIds.length })}
          </h2>
          <button type="button" onClick={onClose} disabled={sending} aria-label={t('screens.bulk.close')} className="w-11 h-11 -m-2 flex items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-40">
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>

        {phase.k === 'planning' && (
          <p role="status" className="mt-4 text-sm text-slate-500 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('screens.bulk.checking', { count: screenIds.length })}
          </p>
        )}

        {phase.k === 'plan-error' && (
          <>
            <p role="alert" className="mt-4 text-sm font-semibold text-rose-600">{t('screens.bulk.planError', { message: phase.message })}</p>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={onClose} className={BTN_QUIET}>{t('screens.bulk.close')}</button>
            </div>
          </>
        )}

        {(phase.k === 'confirm' || phase.k === 'sending' || phase.k === 'send-error') && (() => {
          const g = groupResults(phase.plan.results);
          const willSend = g.sent.length;
          return (
            <>
              <p className="mt-2 text-sm text-slate-600">{what()}</p>
              <ul className="mt-4 space-y-2 text-[13px]" data-testid="screens-bulk-plan">
                <li className="flex items-start gap-2 font-semibold text-slate-800">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" aria-hidden />
                  {t('screens.bulk.willSend', { count: willSend })}
                </li>
                {g.skippedByReason.map(({ reason, count }) => (
                  <li key={reason} className="flex items-start gap-2 text-slate-600">
                    <MinusCircle className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" aria-hidden />
                    {t('screens.bulk.willSkip', { count, reason: reasonText(reason) })}
                  </li>
                ))}
                {kind === 'update' && g.installPrompts > 0 && (
                  <li className="flex items-start gap-2 text-amber-700">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
                    {t('screens.bulk.installPrompt', { count: g.installPrompts })}
                  </li>
                )}
              </ul>
              {willSend === 0 && <p className="mt-3 text-sm font-semibold text-slate-500">{t('screens.bulk.nothingToSend')}</p>}
              {phase.k === 'send-error' && (
                <p role="alert" className="mt-3 text-sm font-semibold text-rose-600">{t('screens.bulk.sendError', { message: phase.message })}</p>
              )}
              <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <button type="button" onClick={onClose} disabled={sending} className={`${BTN_QUIET} justify-center`}>{t('screens.bulk.cancel')}</button>
                <button
                  type="button"
                  onClick={() => { void send(); }}
                  disabled={sending || willSend === 0}
                  data-testid="screens-bulk-confirm"
                  className={`${BTN} justify-center text-white ${danger ? 'bg-rose-600 hover:bg-rose-700' : ''}`}
                  style={danger ? undefined : BRAND}
                >
                  {sending ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('screens.bulk.sending')}</> : t(`screens.bulk.${CONFIRM_KEY[kind]}`, { count: willSend })}
                </button>
              </div>
            </>
          );
        })()}

        {phase.k === 'done' && (() => {
          const g = groupResults(phase.result.results);
          const notSent = g.failed.map((r) => r.screenId);
          return (
            <div data-testid="screens-bulk-results">
              <p role="status" className="mt-2 text-sm font-semibold text-slate-700" data-testid="screens-bulk-summary">
                {t('screens.bulk.resultSummary', { sent: g.sent.length, skipped: g.skipped.length, failed: g.failed.length })}
              </p>
              <ResultSection testId="failed" tone="bad" heading={t('screens.bulk.failedHeading', { count: g.failed.length })} rows={g.failed} reasonText={reasonText} unnamed={t('screens.bulk.unnamed')} />
              <ResultSection testId="skipped" tone="muted" heading={t('screens.bulk.skippedHeading', { count: g.skipped.length })} rows={g.skipped} reasonText={reasonText} unnamed={t('screens.bulk.unnamed')} />
              <ResultSection testId="sent" tone="ok" heading={t('screens.bulk.sentHeading', { count: g.sent.length })} rows={g.sent} reasonText={reasonText} unnamed={t('screens.bulk.unnamed')}
                badge={kind === 'update' ? t('screens.bulk.installPromptBadge') : undefined} />
              <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                {notSent.length > 0 && (
                  <button type="button" onClick={() => onRetry(notSent)} className={`${BTN_QUIET} justify-center`} data-testid="screens-bulk-retry">
                    {t('screens.bulk.retryFailed', { count: notSent.length })}
                  </button>
                )}
                <button type="button" onClick={onClose} className={`${BTN} justify-center text-white`} style={BRAND}>{t('screens.bulk.close')}</button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function ResultSection({
  heading, rows, tone, reasonText, unnamed, badge, testId,
}: {
  heading: string;
  rows: Array<{ screenId: string; name: string | null; reason?: string; message?: string; installPrompt?: boolean }>;
  tone: 'ok' | 'bad' | 'muted';
  reasonText: (reason?: string, message?: string) => string;
  unnamed: string;
  badge?: string;
  testId: string;
}) {
  if (rows.length === 0) return null;
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'bad' ? XCircle : MinusCircle;
  const color = tone === 'ok' ? 'text-emerald-600' : tone === 'bad' ? 'text-rose-600' : 'text-slate-400';
  return (
    <section className="mt-4" data-testid={`screens-bulk-${testId}`}>
      <h3 className={`text-[12px] font-bold uppercase tracking-wider ${tone === 'bad' ? 'text-rose-600' : 'text-slate-500'}`}>{heading}</h3>
      <ul className="mt-1.5 divide-y divide-slate-100 border border-slate-100 rounded-xl">
        {rows.map((r) => (
          <li key={r.screenId} className="px-3 py-2 flex items-start gap-2 text-[13px]">
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-slate-800 truncate">{r.name || unnamed}</span>
              {tone !== 'ok' && <span className="block text-[12px] text-slate-500">{reasonText(r.reason, r.message)}</span>}
            </span>
            {badge && r.installPrompt && (
              <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">{badge}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
