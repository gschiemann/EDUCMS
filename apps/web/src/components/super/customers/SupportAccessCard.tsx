'use client';

/**
 * Customer console → "Support access" (2026-10-11): VenueOS's side of the
 * customer-approved access model.
 *
 *   • what we have right now: internal organisation (always open), an active
 *     grant (until when, which locations), a request waiting on the customer,
 *     or nothing — and nothing means the switcher and every tenant-data
 *     route answer 403 until the customer says yes;
 *   • ask: reason, duration (1 h / 24 h / 7 d), whole organisation or specific
 *     locations;
 *   • end our own access early / withdraw a request;
 *   • BREAK-GLASS — a separate, explicit action behind its own confirmation:
 *     mandatory reason, at most one hour, the customer's admins are emailed
 *     the moment it opens and it shows on their banner.
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Loader2, ShieldAlert, ShieldCheck, Siren, X } from 'lucide-react';
import { appConfirm, appPrompt } from '@/components/ui/app-dialog';
import { useBreakGlass, useEndOurSupportAccess, useOrgSupportAccess, useRequestSupportAccess } from '@/hooks/use-support-access';
import { DURATION_PRESETS, MAX_REASON, formatWhen, grantTone, type SupportAccessLocation, type SupportGrant } from '@/lib/support-access';
import { durationLabel } from '@/components/support-access/SupportAccessSettings';

const CARD = 'bg-white rounded-2xl border border-slate-200 p-4 sm:p-5';
const BTN = 'inline-flex items-center justify-center gap-2 min-h-10 px-4 rounded-lg text-sm font-semibold disabled:opacity-50';
const INPUT = 'w-full min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900';
const LABEL = 'block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1';
const errMessage = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function SupportAccessCard({ orgId, orgName }: { orgId: string; orgName: string }) {
  const t = useTranslations('customerConsole.support');
  const ts = useTranslations('supportAccess');
  const locale = useLocale();
  const { data, isLoading, isError } = useOrgSupportAccess(orgId);
  const request = useRequestSupportAccess(orgId);
  const end = useEndOurSupportAccess(orgId);
  const breakGlass = useBreakGlass(orgId);
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState<number>(DURATION_PRESETS[0].minutes);
  const [whole, setWhole] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  if (isLoading) return <section className={CARD}><Loader2 className="w-5 h-5 animate-spin text-slate-400" aria-hidden /></section>;
  if (isError || !data) return <section className={CARD}><p role="alert" className="text-sm text-rose-700">{t('loadFailed')}</p></section>;

  // A malformed answer (an old API, a proxy page) must not crash the customer page.
  const active = data.active ?? null;
  const pendingRows = Array.isArray(data.pending) ? data.pending : [];
  const historyRows = Array.isArray(data.history) ? data.history : [];
  const locations = Array.isArray(data.locations) ? data.locations : [];
  const pending = pendingRows[0] ?? null;
  const scope = (g: SupportGrant) => (g.scopeTenantIds?.length ? g.scopeTenantIds.map((id) => locations.find((l) => l.id === id)?.name ?? id).join(', ') : ts('wholeOrg'));

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) return setError(t('reasonRequired'));
    if (!whole && picked.length === 0) return setError(ts('pickLocation'));
    try {
      await request.mutateAsync({ reason: reason.trim(), durationMinutes: minutes, scopeTenantIds: whole ? [] : picked });
      setReason('');
    } catch (err) {
      setError(errMessage(err, t('genericError')));
    }
  };
  const endOurs = async (g: SupportGrant) => {
    setError(null);
    const isRequest = g.status === 'REQUESTED';
    if (!(await appConfirm({ title: isRequest ? t('withdrawTitle') : t('endTitle'), message: isRequest ? t('withdrawBody') : t('endBody', { name: orgName }), confirmLabel: isRequest ? t('withdraw') : t('endNow') }))) return;
    try {
      await end.mutateAsync({ grantId: g.id });
    } catch (err) {
      setError(errMessage(err, t('genericError')));
    }
  };
  const openBreakGlass = async () => {
    setError(null);
    const reasonText = await appPrompt({ title: t('breakGlassTitle', { name: orgName }), message: t('breakGlassBody'), placeholder: t('breakGlassReason'), confirmLabel: t('breakGlassConfirm') });
    if (!reasonText || !reasonText.trim()) return;
    try {
      await breakGlass.mutateAsync({ reason: reasonText.trim() });
    } catch (err) {
      setError(errMessage(err, t('genericError')));
    }
  };

  return (
    <section className={CARD} aria-labelledby="sa-card" data-testid="console-support-access">
      <h2 id="sa-card" className="font-semibold text-slate-900 inline-flex items-center gap-2"><ShieldCheck className="w-4 h-4" aria-hidden /> {t('title')}</h2>
      <p className="text-sm text-slate-600 mt-1">{t('explain')}</p>

      {data.internal ? (
        <p className="mt-3 text-sm rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-2">{t('internal')}</p>
      ) : active ? (
        <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${active.kind === 'BREAK_GLASS' ? 'bg-rose-50 border-rose-200 text-rose-900' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
          <div className="font-semibold inline-flex items-center gap-2">
            {active.kind === 'BREAK_GLASS' ? <ShieldAlert className="w-4 h-4" aria-hidden /> : <ShieldCheck className="w-4 h-4" aria-hidden />}
            {active.kind === 'BREAK_GLASS' ? t('activeBreakGlass', { until: formatWhen(active.expiresAt, locale) }) : t('active', { until: formatWhen(active.expiresAt, locale) })}
          </div>
          <div className="mt-1">{ts('scope')}: {scope(active)} · {ts(`kind.${active.kind}`)}{active.decidedByEmail ? ` · ${active.decidedByEmail}` : ''}</div>
          <button type="button" className={`${BTN} mt-2 border border-current/40 bg-white/70`} disabled={end.isPending} onClick={() => endOurs(active)}>
            <X className="w-4 h-4" aria-hidden /> {t('endNow')}
          </button>
        </div>
      ) : pending ? (
        <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900">
          <div className="font-semibold">{t('pending', { on: formatWhen(pending.createdAt, locale) })}</div>
          <div className="mt-1">{ts('reason')}: {pending.reason} · {durationLabel(ts, pending.requestedDurationMinutes)} · {scope(pending)}</div>
          <button type="button" className={`${BTN} mt-2 border border-current/40 bg-white/70`} disabled={end.isPending} onClick={() => endOurs(pending)}>
            <X className="w-4 h-4" aria-hidden /> {t('withdraw')}
          </button>
        </div>
      ) : (
        <>
          <p className="mt-3 text-sm rounded-lg bg-slate-50 border border-slate-200 text-slate-800 px-3 py-2">{t('none')}</p>
          <form onSubmit={ask} className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="console-support-request">
            <label className="sm:col-span-2">
              <span className={LABEL}>{t('reason')}</span>
              <input className={INPUT} value={reason} maxLength={MAX_REASON} onChange={(e) => setReason(e.target.value)} placeholder={t('reasonPlaceholder')} />
            </label>
            <label>
              <span className={LABEL}>{ts('duration')}</span>
              <select className={INPUT} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {DURATION_PRESETS.map((p) => <option key={p.minutes} value={p.minutes}>{ts(`durations.${p.key}`)}</option>)}
              </select>
            </label>
            {locations.length > 0 && (
              <fieldset>
                <legend className={LABEL}>{ts('scope')}</legend>
                <label className="flex items-center gap-2 text-sm min-h-8"><input type="radio" checked={whole} onChange={() => setWhole(true)} /> {ts('wholeOrg')}</label>
                <label className="flex items-center gap-2 text-sm min-h-8"><input type="radio" checked={!whole} onChange={() => setWhole(false)} /> {ts('specificLocations')}</label>
                {!whole && (
                  <div className="mt-1 ml-6 grid gap-1">
                    {locations.map((l: SupportAccessLocation) => (
                      <label key={l.id} className="flex items-center gap-2 text-sm min-h-8">
                        <input type="checkbox" checked={picked.includes(l.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, l.id] : p.filter((x) => x !== l.id)))} /> {l.name}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
            )}
            <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
              <button type="submit" className={`${BTN} bg-slate-900 text-white`} disabled={request.isPending}>
                {request.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <ShieldCheck className="w-4 h-4" aria-hidden />} {t('ask')}
              </button>
            </div>
          </form>
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-500">{t('breakGlassExplain')}</p>
            <button type="button" className={`${BTN} mt-2 border border-rose-300 text-rose-700 bg-white`} disabled={breakGlass.isPending} onClick={openBreakGlass} data-testid="console-break-glass">
              <Siren className="w-4 h-4" aria-hidden /> {t('breakGlass')}
            </button>
          </div>
        </>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-rose-700">{error}</p>}

      {historyRows.length > 0 && (
        <details className="mt-4">
          <summary className="text-sm font-semibold text-slate-700 cursor-pointer min-h-8 inline-flex items-center">{t('history', { count: historyRows.length })}</summary>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {historyRows.map((g) => {
              const tone = grantTone(g);
              return (
                <li key={g.id} className="py-2 flex flex-wrap justify-between gap-x-4 gap-y-1">
                  <span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold mr-2 ${tone === 'active' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>{ts(`status.${g.status}`)}</span>
                    {ts(`kind.${g.kind}`)} · {scope(g)}{g.reason ? ` · ${g.reason}` : ''}
                  </span>
                  <span className="text-xs text-slate-500">{formatWhen(g.createdAt, locale)}{g.expiresAt ? ` → ${formatWhen(g.expiresAt, locale)}` : ''}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </section>
  );
}
