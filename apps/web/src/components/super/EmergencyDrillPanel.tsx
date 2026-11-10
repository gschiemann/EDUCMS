'use client';

/**
 * EmergencyDrillPanel — /super/emergency-drill (2026-11-10).
 *
 * The owner's rule: no test alert reaches a screen unless the owner approved
 * THAT test, and never on a timer. The automated drill therefore has no
 * schedule; it runs one pass when — and only when — it is approved here, now
 * or at a time the owner picks in the next 24 hours. Cancel takes the
 * permission back and stops a running pass before its next screen.
 *
 * SUPER_ADMIN only — denied here by default and enforced by the API
 * (apps/api/src/emergency/drill/synthetic-drill-approval.controller.ts). No
 * request is made for anyone else. No polling: the page reads once, after
 * each action, and when the owner presses Refresh.
 */
import { useState, useSyncExternalStore } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { appConfirm } from '@/components/ui/app-dialog';
import { useApproveEmergencyDrill, useEmergencyDrillStatus, useRevokeEmergencyDrill } from '@/hooks/use-api';

/** Server codes the page explains in the owner's language; anything else is generic. */
export const DRILL_KNOWN_ERRORS = [
  'DRILL_NOT_ARMED',
  'DRILL_APPROVAL_TIME',
  'DRILL_APPROVER',
  'DRILL_NO_BENCH_SCREENS',
  'DRILL_ALREADY_APPROVED',
  'DRILL_APPROVALS_UNREADABLE',
] as const;
export type DrillKnownError = (typeof DRILL_KNOWN_ERRORS)[number];

export function drillErrorKey(e: unknown): DrillKnownError | 'generic' {
  const code = (e as { code?: unknown } | null)?.code;
  return (DRILL_KNOWN_ERRORS as readonly string[]).includes(String(code)) ? (code as DrillKnownError) : 'generic';
}

/** A `datetime-local` value (the owner's own clock) → ISO, or null when empty / not a time. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

const subscribeNever = () => () => undefined;

export function EmergencyDrillPanel() {
  const t = useTranslations('emergencyDrill');
  const user = useAppStore((s) => s.user);
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" aria-hidden />
        <span className="sr-only">{t('loading')}</span>
      </div>
    );
  }
  if (user?.role !== 'SUPER_ADMIN') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center max-w-sm">
          <AlertCircle className="w-10 h-10 text-rose-500 mx-auto mb-3" aria-hidden />
          <h1 className="text-lg font-bold text-slate-900">{t('ownerOnlyTitle')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('ownerOnlyBody')}</p>
        </div>
      </div>
    );
  }
  return <EmergencyDrillConsole />;
}

type Outcome = { ok: boolean; text: string } | null;

function EmergencyDrillConsole() {
  const t = useTranslations('emergencyDrill');
  const locale = useLocale();
  const status = useEmergencyDrillStatus(true);
  const approve = useApproveEmergencyDrill();
  const revoke = useRevokeEmergencyDrill();
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  const [outcome, setOutcome] = useState<Outcome>(null);

  const data = status.data;
  const eligible = (data?.screens ?? []).filter((s) => s.eligible);
  const excluded = (data?.screens ?? []).filter((s) => !s.eligible);
  const open = data?.approvals ?? [];
  const busy = approve.isPending || revoke.isPending;
  const time = (ms: number) => new Date(ms).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });

  const onApprove = async () => {
    setOutcome(null);
    const iso = when === 'later' ? localInputToIso(at) : null;
    if (when === 'later' && !iso) {
      setOutcome({ ok: false, text: t('errors.DRILL_APPROVAL_TIME') });
      return;
    }
    const whenText = iso ? time(Date.parse(iso)) : t('whenNowShort');
    const yes = await appConfirm({
      title: t('confirmTitle'),
      message: t('confirmBody', { count: eligible.length, when: whenText }),
      confirmLabel: t('confirmYes'),
      tone: 'danger',
    });
    if (!yes) return;
    approve.mutate(iso ? { runAt: iso } : {}, {
      onSuccess: (r) => setOutcome({ ok: true, text: t('approved', { when: time(r.runAtMs), count: r.screenCount }) }),
      onError: (e) => setOutcome({ ok: false, text: t(`errors.${drillErrorKey(e)}`) }),
    });
  };

  const onRevoke = () => {
    setOutcome(null);
    revoke.mutate(undefined, {
      onSuccess: (r) => setOutcome({ ok: true, text: r.revoked > 0 ? t('revoked') : t('nothingToRevoke') }),
      onError: (e) => setOutcome({ ok: false, text: t(`errors.${drillErrorKey(e)}`) }),
    });
  };

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
          <p className="text-sm text-slate-600 mt-1">{t('subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => void status.refetch()}
          disabled={status.isFetching}
          className="ml-4 shrink-0 inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${status.isFetching ? 'animate-spin' : ''}`} aria-hidden />
          {t('refresh')}
        </button>
      </div>

      <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 flex items-start">
        <ShieldCheck className="w-5 h-5 mr-2 shrink-0" aria-hidden />
        <span>{t('rule')}</span>
      </p>

      {status.isLoading && (
        <p className="mt-6 text-sm text-slate-500 flex items-center">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />
          {t('loading')}
        </p>
      )}
      {status.isError && (
        <p role="alert" className="mt-6 text-sm text-rose-700">
          {t('loadFailed')}
        </p>
      )}

      {data && (
        <>
          <section className="mt-6 bg-white rounded-2xl border border-slate-200 p-5">
            <h2 className="text-base font-bold text-slate-900">{t('nowTitle')}</h2>
            {!data.armed ? (
              <p className="mt-2 text-sm text-slate-700">{t('notArmed')}</p>
            ) : open.length === 0 ? (
              <p className="mt-2 text-sm text-slate-700">{t('noneApproved')}</p>
            ) : (
              <ul className="mt-2">
                {open.map((a) => (
                  <li key={a.approvalId} className="text-sm text-slate-800 flex items-start py-1">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 mr-2 shrink-0 text-amber-600" aria-hidden />
                    <span>
                      {a.state === 'running'
                        ? t('running', { until: time(a.expiresAtMs), count: a.screenCount })
                        : t('waiting', { when: time(a.runAtMs), count: a.screenCount })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {open.length > 0 && (
              <button
                type="button"
                onClick={onRevoke}
                disabled={busy}
                className="mt-4 inline-flex items-center rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                <XCircle className="w-4 h-4 mr-2" aria-hidden />
                {t('cancel')}
              </button>
            )}
            {open.length > 0 && <p className="mt-2 text-xs text-slate-500">{t('cancelHint')}</p>}
          </section>

          {data.armed && open.length === 0 && (
            <section className="mt-6 bg-white rounded-2xl border border-slate-200 p-5">
              <h2 className="text-base font-bold text-slate-900">{t('approveTitle')}</h2>
              <p className="mt-1 text-sm text-slate-600">{t('approveBody', { count: eligible.length })}</p>
              <fieldset className="mt-4">
                <legend className="sr-only">{t('whenLegend')}</legend>
                <label className="flex items-center text-sm text-slate-800 py-1">
                  <input type="radio" name="drill-when" className="mr-2" checked={when === 'now'} onChange={() => setWhen('now')} />
                  {t('whenNow')}
                </label>
                <label className="flex items-center text-sm text-slate-800 py-1">
                  <input type="radio" name="drill-when" className="mr-2" checked={when === 'later'} onChange={() => setWhen('later')} />
                  {t('whenLater')}
                </label>
                {when === 'later' && (
                  <input
                    type="datetime-local"
                    aria-label={t('whenLaterLabel')}
                    value={at}
                    onChange={(e) => setAt(e.target.value)}
                    className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
                  />
                )}
              </fieldset>
              <button
                type="button"
                onClick={() => void onApprove()}
                disabled={busy || eligible.length === 0}
                className="mt-4 inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {approve.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" aria-hidden />}
                {t('approve')}
              </button>
            </section>
          )}

          {outcome && (
            <p role={outcome.ok ? 'status' : 'alert'} className={`mt-4 text-sm ${outcome.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
              {outcome.text}
            </p>
          )}

          <section className="mt-6 bg-white rounded-2xl border border-slate-200 p-5">
            <h2 className="text-base font-bold text-slate-900">{t('screensTitle', { count: eligible.length })}</h2>
            <p className="mt-1 text-sm text-slate-600">{t('screensBody')}</p>
            <ul className="mt-3 flex flex-wrap">
              {eligible.map((s) => (
                <li key={s.id} className="mr-2 mb-2 rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-800">
                  {s.name}
                </li>
              ))}
            </ul>
            {excluded.length > 0 && (
              <p role="alert" className="mt-2 text-sm text-rose-700">
                {t('excluded', { names: excluded.map((s) => s.name).join(', ') })}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
