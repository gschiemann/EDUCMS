'use client';

/**
 * Settings → Support access — the customer's control panel (2026-10-11).
 *
 *   • an open request from VenueOS: approve (optionally for a SHORTER time)
 *     or deny, with a note;
 *   • the active grant: who, why, until when, which locations; "End now";
 *   • "Give VenueOS support access" (no request needed): duration, optional
 *     note, whole organisation or specific locations;
 *   • history: every grant, request, approval, denial, revocation, expiry.
 *
 * Only the organisation's admins (`canDecide` from the API) see the actions;
 * everyone else sees the state. The API enforces the same rule.
 */
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Loader2, ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { appConfirm } from '@/components/ui/app-dialog';
import { useDecideSupport, useEndSupport, useInviteSupport, useMySupportAccess } from '@/hooks/use-support-access';
import {
  DURATION_PRESETS,
  MAX_REASON,
  approvableDurations,
  formatWhen,
  grantTone,
  type SupportAccessLocation,
  type SupportGrant,
} from '@/lib/support-access';

const CARD = 'rounded-2xl border border-slate-200 bg-white p-4 sm:p-5';
const BTN = 'inline-flex items-center justify-center gap-2 min-h-10 px-4 rounded-lg text-sm font-semibold disabled:opacity-50';
const PRIMARY = `${BTN} bg-slate-900 text-white`;
const SECONDARY = `${BTN} border border-slate-300 text-slate-800 bg-white`;
const DANGER = `${BTN} bg-rose-600 text-white`;
const INPUT = 'w-full min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900';
const LABEL = 'block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1';

const errMessage = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function SupportAccessSettings() {
  const t = useTranslations('supportAccess');
  const { data, isLoading, isError } = useMySupportAccess();
  if (isLoading) return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('loading')}</div>;
  if (isError || !data) return <p role="alert" className="text-sm text-rose-700">{t('loadFailed')}</p>;
  const canDecide = !!data.canDecide;
  const pending = Array.isArray(data.pending) ? data.pending : [];
  const history = Array.isArray(data.history) ? data.history : [];
  const locations = Array.isArray(data.locations) ? data.locations : [];
  return (
    <div className="space-y-4">
      {pending.map((g) => (
        <PendingRequest key={g.id} grant={g} canDecide={canDecide} locations={locations} />
      ))}
      {data.active ? (
        <ActiveGrant grant={data.active} canDecide={canDecide} locations={locations} />
      ) : (
        <section className={CARD} aria-labelledby="sa-none">
          <h3 id="sa-none" className="font-semibold text-slate-900 inline-flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-emerald-600" aria-hidden /> {t('noneTitle')}</h3>
          <p className="text-sm text-slate-600 mt-1">{t('noneBody')}</p>
        </section>
      )}
      {canDecide && !data.active && <InviteForm locations={locations} />}
      <History rows={history} locations={locations} />
    </div>
  );
}

function scopeLabel(g: SupportGrant, locations: SupportAccessLocation[], whole: string): string {
  if (!g.scopeTenantIds.length) return whole;
  return g.scopeTenantIds.map((id) => locations.find((l) => l.id === id)?.name ?? id).join(', ');
}

function PendingRequest({ grant, canDecide, locations }: { grant: SupportGrant; canDecide: boolean; locations: SupportAccessLocation[] }) {
  const t = useTranslations('supportAccess');
  const locale = useLocale();
  const decide = useDecideSupport();
  const options = approvableDurations(grant.requestedDurationMinutes);
  const [minutes, setMinutes] = useState<number>(grant.requestedDurationMinutes ?? options[0]?.minutes ?? 60);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = async (approve: boolean) => {
    setError(null);
    try {
      await decide.mutateAsync({ grantId: grant.id, approve, durationMinutes: approve ? minutes : undefined, note: note.trim() || undefined });
    } catch (e) {
      setError(errMessage(e, t('genericError')));
    }
  };
  return (
    <section className={`${CARD} border-indigo-300 bg-indigo-50/40`} aria-labelledby={`sa-req-${grant.id}`} data-testid="support-access-pending">
      <h3 id={`sa-req-${grant.id}`} className="font-semibold text-slate-900">{t('pendingTitle', { by: grant.requestedByEmail ?? 'VenueOS' })}</h3>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="text-slate-500">{t('reason')}</dt><dd className="text-slate-900 break-words">{grant.reason}</dd></div>
        <div><dt className="text-slate-500">{t('requestedFor')}</dt><dd className="text-slate-900">{durationLabel(t, grant.requestedDurationMinutes)}</dd></div>
        <div><dt className="text-slate-500">{t('scope')}</dt><dd className="text-slate-900">{scopeLabel(grant, locations, t('wholeOrg'))}</dd></div>
        <div><dt className="text-slate-500">{t('askedOn')}</dt><dd className="text-slate-900">{formatWhen(grant.createdAt, locale)}</dd></div>
      </dl>
      <p className="text-xs text-slate-600 mt-2">{t('pendingExplain')}</p>
      {canDecide ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label>
            <span className={LABEL}>{t('approveFor')}</span>
            <select className={INPUT} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {options.map((o) => (
                <option key={o.minutes} value={o.minutes}>{o.key === 'asRequested' ? t('asRequested', { duration: durationLabel(t, o.minutes) }) : durationLabel(t, o.minutes)}</option>
              ))}
            </select>
          </label>
          <label>
            <span className={LABEL}>{t('noteOptional')}</span>
            <input className={INPUT} value={note} maxLength={MAX_REASON} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <button type="button" className={PRIMARY} disabled={decide.isPending} onClick={() => run(true)}>
              {decide.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Check className="w-4 h-4" aria-hidden />} {t('approve')}
            </button>
            <button type="button" className={SECONDARY} disabled={decide.isPending} onClick={() => run(false)}>
              <X className="w-4 h-4" aria-hidden /> {t('deny')}
            </button>
          </div>
          {error && <p role="alert" className="sm:col-span-2 text-sm text-rose-700">{error}</p>}
        </div>
      ) : (
        <p className="mt-2 text-sm text-slate-600">{t('adminsDecide')}</p>
      )}
    </section>
  );
}

function ActiveGrant({ grant, canDecide, locations }: { grant: SupportGrant; canDecide: boolean; locations: SupportAccessLocation[] }) {
  const t = useTranslations('supportAccess');
  const locale = useLocale();
  const end = useEndSupport();
  const [error, setError] = useState<string | null>(null);
  const breakGlass = grant.kind === 'BREAK_GLASS';
  const endNow = async () => {
    setError(null);
    if (!(await appConfirm({ title: t('banner.endConfirmTitle'), message: t('banner.endConfirmBody'), confirmLabel: t('banner.endNow') }))) return;
    try {
      await end.mutateAsync({ grantId: grant.id });
    } catch (e) {
      setError(errMessage(e, t('genericError')));
    }
  };
  return (
    <section className={`${CARD} ${breakGlass ? 'border-rose-300 bg-rose-50/40' : 'border-amber-300 bg-amber-50/40'}`} aria-labelledby="sa-active" data-testid="support-access-active">
      <h3 id="sa-active" className="font-semibold text-slate-900 inline-flex items-center gap-2">
        {breakGlass ? <ShieldAlert className="w-4 h-4 text-rose-600" aria-hidden /> : <ShieldCheck className="w-4 h-4 text-amber-600" aria-hidden />}
        {breakGlass ? t('activeBreakGlassTitle') : t('activeTitle')}
      </h3>
      <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div><dt className="text-slate-500">{t('until')}</dt><dd className="text-slate-900 font-semibold">{formatWhen(grant.expiresAt, locale)}</dd></div>
        <div><dt className="text-slate-500">{t('scope')}</dt><dd className="text-slate-900">{scopeLabel(grant, locations, t('wholeOrg'))}</dd></div>
        <div><dt className="text-slate-500">{t('how')}</dt><dd className="text-slate-900">{t(`kind.${grant.kind}`)}{grant.decidedByEmail ? ` · ${grant.decidedByEmail}` : ''}</dd></div>
        {(grant.reason || grant.note) && <div><dt className="text-slate-500">{grant.reason ? t('reason') : t('note')}</dt><dd className="text-slate-900 break-words">{grant.reason ?? grant.note}</dd></div>}
      </dl>
      <p className="text-xs text-slate-600 mt-2">{t('activeExplain')}</p>
      {canDecide && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={DANGER} disabled={end.isPending} onClick={endNow}>
            {end.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <X className="w-4 h-4" aria-hidden />} {t('banner.endNow')}
          </button>
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        </div>
      )}
    </section>
  );
}

function InviteForm({ locations }: { locations: SupportAccessLocation[] }) {
  const t = useTranslations('supportAccess');
  const invite = useInviteSupport();
  const [minutes, setMinutes] = useState<number>(DURATION_PRESETS[0].minutes);
  const [note, setNote] = useState('');
  const [whole, setWhole] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!whole && picked.length === 0) return setError(t('pickLocation'));
    try {
      await invite.mutateAsync({ durationMinutes: minutes, note: note.trim() || undefined, scopeTenantIds: whole ? [] : picked });
      setNote('');
    } catch (err) {
      setError(errMessage(err, t('genericError')));
    }
  };
  return (
    <form onSubmit={submit} className={CARD} aria-labelledby="sa-invite" data-testid="support-access-invite">
      <h3 id="sa-invite" className="font-semibold text-slate-900">{t('inviteTitle')}</h3>
      <p className="text-sm text-slate-600 mt-1">{t('inviteBody')}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label>
          <span className={LABEL}>{t('duration')}</span>
          <select className={INPUT} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} data-testid="invite-duration">
            {DURATION_PRESETS.map((p) => <option key={p.minutes} value={p.minutes}>{t(`durations.${p.key}`)}</option>)}
          </select>
        </label>
        <label>
          <span className={LABEL}>{t('noteOptional')}</span>
          <input className={INPUT} value={note} maxLength={MAX_REASON} onChange={(e) => setNote(e.target.value)} placeholder={t('notePlaceholder')} />
        </label>
        {locations.length > 0 && (
          <fieldset className="sm:col-span-2">
            <legend className={LABEL}>{t('scope')}</legend>
            <label className="flex items-center gap-2 text-sm min-h-8"><input type="radio" checked={whole} onChange={() => setWhole(true)} /> {t('wholeOrg')}</label>
            <label className="flex items-center gap-2 text-sm min-h-8"><input type="radio" checked={!whole} onChange={() => setWhole(false)} /> {t('specificLocations')}</label>
            {!whole && (
              <div className="mt-1 ml-6 grid gap-1 sm:grid-cols-2">
                {locations.map((l) => (
                  <label key={l.id} className="flex items-center gap-2 text-sm min-h-8">
                    <input type="checkbox" checked={picked.includes(l.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, l.id] : p.filter((x) => x !== l.id)))} /> {l.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="submit" className={PRIMARY} disabled={invite.isPending}>
          {invite.isPending ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <ShieldCheck className="w-4 h-4" aria-hidden />} {t('inviteSubmit')}
        </button>
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      </div>
    </form>
  );
}

function History({ rows, locations }: { rows: SupportGrant[]; locations: SupportAccessLocation[] }) {
  const t = useTranslations('supportAccess');
  const locale = useLocale();
  return (
    <section className={CARD} aria-labelledby="sa-history">
      <h3 id="sa-history" className="font-semibold text-slate-900">{t('historyTitle')}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 mt-1">{t('historyEmpty')}</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 text-sm">
          {rows.map((g) => {
            const tone = grantTone(g);
            return (
              <li key={g.id} className="py-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold mr-2 ${tone === 'active' ? 'bg-amber-100 text-amber-900' : tone === 'pending' ? 'bg-indigo-100 text-indigo-900' : 'bg-slate-100 text-slate-700'}`}>{t(`status.${g.status}`)}</span>
                  <span className="text-slate-900">{t(`kind.${g.kind}`)}</span>
                  <span className="text-slate-500"> · {scopeLabel(g, locations, t('wholeOrg'))}</span>
                  {(g.reason || g.note) && <div className="text-slate-600 break-words">{g.reason ?? g.note}</div>}
                </div>
                <div className="text-xs text-slate-500 text-right">
                  <div>{formatWhen(g.createdAt, locale)}{g.requestedByEmail ? ` · ${g.requestedByEmail}` : ''}</div>
                  {g.expiresAt && <div>{t('until')} {formatWhen(g.expiresAt, locale)}</div>}
                  {g.revokedAt && <div>{t('status.REVOKED')} {formatWhen(g.revokedAt, locale)}{g.revokedByEmail ? ` · ${g.revokedByEmail}` : ''}</div>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function durationLabel(t: (k: string, v?: Record<string, string | number>) => string, minutes: number | null | undefined): string {
  if (!minutes) return '—';
  const preset = DURATION_PRESETS.find((p) => p.minutes === minutes);
  if (preset) return t(`durations.${preset.key}`);
  if (minutes % 1440 === 0) return t('durations.days', { count: minutes / 1440 });
  if (minutes % 60 === 0) return t('durations.hours', { count: minutes / 60 });
  return t('durations.minutes', { count: minutes });
}
