'use client';

/**
 * FieldBuildsPanel — /super/field-builds (2026-10-18).
 *
 * A private field build of the Android player is offered only to a screen
 * inside a WINDOW (chosen organizations, chosen screens or every screen of
 * them, at most 24 hours) and only after a PUSH to that exact screen. This
 * page arms and cancels the window and pushes screens one at a time; it
 * replaces editing the PLAYER_APK_FIELD_* Railway variables, which still
 * apply when no window is open (and the page says so).
 *
 * SUPER_ADMIN only — denied here by default and enforced by the API
 * (apps/api/src/field-builds). No request is made for anyone else.
 *
 * What the screens show (name, reported player version, push state) comes
 * from the same Screen columns the dashboard's screens list reads; the push
 * state is read with the dashboard's own deriveTrackedPush.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, ExternalLink, FlaskConical, Loader2, Send, XCircle } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { appConfirm } from '@/components/ui/app-dialog';
import {
  useAccessibleTenants,
  useArmFieldWindow,
  useCancelFieldWindow,
  useFieldBuildCandidates,
  useFieldBuildScreens,
  useFieldBuildWindows,
  usePushFieldWindow,
  type FieldBuildCandidate,
  type FieldBuildScreen,
  type FieldBuildWindow,
  type FieldBuildWindows,
} from '@/hooks/use-api';
import { deriveTrackedPush } from '@/components/screens/trackedPush';

// ─── Pure helpers (exported for the tests) ─────────────────────────────────

/** The arm form's choices, in minutes. The server accepts 5 to 1440. */
export const DURATION_PRESETS = [30, 60, 120, 240, 480, 720, 1440] as const;
export const DEFAULT_DURATION = 240;

/** Server codes the page explains in the operator's language; anything else is generic. */
export const KNOWN_ERRORS = [
  'FIELD_BUILD_WINDOW_ACTIVE',
  'FIELD_BUILD_DURATION_INVALID',
  'FIELD_BUILD_CANDIDATE_INVALID',
  'FIELD_BUILD_CANDIDATE_UNAVAILABLE',
  'FIELD_BUILD_TENANT_NOT_FOUND',
  'FIELD_BUILD_TENANTS_REQUIRED',
  'FIELD_BUILD_TENANTS_INVALID',
  'FIELD_BUILD_SCREENS_REQUIRED',
  'FIELD_BUILD_SCREENS_INVALID',
  'FIELD_BUILD_SCREEN_NOT_IN_TENANTS',
  'FIELD_BUILD_SCREEN_REVOKED',
  'FIELD_BUILD_NOTE_TOO_LONG',
  'FIELD_BUILD_WINDOW_NOT_FOUND',
  'FIELD_BUILD_WINDOW_ENDED',
  'FIELD_BUILD_WINDOW_SUPERSEDED',
  'FIELD_BUILD_WINDOW_SETTLING',
  'FIELD_BUILD_MIRROR_MISSING',
  'FIELD_BUILD_SCREEN_OUTSIDE_WINDOW',
  'SUPPORT_ACCESS_REQUIRED',
] as const;
export type KnownError = (typeof KNOWN_ERRORS)[number];

export function errorKey(err: unknown): KnownError | 'generic' {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (KNOWN_ERRORS as readonly string[]).includes(code) ? (code as KnownError) : 'generic';
}

export function splitDuration(ms: number): { h: number; m: number; s: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  return { h: Math.floor(total / 3600), m: Math.floor((total % 3600) / 60), s: total % 60 };
}

/** Server time minus this browser's, from the windows answer (React Query's dataUpdatedAt). */
export function clockOffset(serverNowIso: string | undefined, receivedAtMs: number): number {
  const server = serverNowIso ? Date.parse(serverNowIso) : NaN;
  return Number.isFinite(server) && receivedAtMs > 0 ? server - receivedAtMs : 0;
}

/** The newest build the fleet policy allows, preferring one whose private copy is in storage. */
export function defaultCandidate(candidates: FieldBuildCandidate[]): string {
  const allowed = candidates.filter((c) => c.allowed);
  return (allowed.find((c) => c.mirror.state === 'present') ?? allowed[0])?.versionName ?? '';
}

export interface ScopedScreen {
  id: string;
  screen: FieldBuildScreen | null;
}

/** The window's screens: the named ones (in the window's order), or every listed screen of its organizations. */
export function windowScreens(w: Pick<FieldBuildWindow, 'allScreens' | 'screenIds' | 'tenants'>, screens: FieldBuildScreen[]): ScopedScreen[] {
  if (w.allScreens) {
    const tenants = new Set(w.tenants.map((t) => t.id));
    return screens.filter((s) => tenants.has(s.tenantId) && s.status !== 'REVOKED').map((s) => ({ id: s.id, screen: s }));
  }
  return w.screenIds.map((id) => ({ id, screen: screens.find((s) => s.id === id) ?? null }));
}

export type PushBlock = 'settling' | 'on-build' | 'revoked' | null;

/** Why "Push now" is unavailable for a screen right now, if it is. */
export function pushBlock(
  screen: FieldBuildScreen | null,
  w: Pick<FieldBuildWindow, 'pushReadyAt' | 'versionCode'>,
  serverNowMs: number,
): PushBlock {
  if (screen?.status === 'REVOKED') return 'revoked';
  if (serverNowMs < Date.parse(w.pushReadyAt)) return 'settling';
  if (screen && w.versionCode !== null && screen.playerVersionCode !== null && screen.playerVersionCode >= w.versionCode) {
    return 'on-build';
  }
  return null;
}

// ─── Small pieces ──────────────────────────────────────────────────────────

/** Re-render once a second while `active` and the page is visible — the countdowns. */
function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') setNow(Date.now());
    };
    const id = window.setInterval(tick, 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [active]);
  return now;
}

const CARD = 'bg-white rounded-2xl border border-slate-200 p-4 sm:p-5';
const CHIP = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap';
const TONES = {
  good: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
  warn: 'bg-amber-50 text-amber-900 ring-1 ring-amber-200',
  bad: 'bg-rose-50 text-rose-800 ring-1 ring-rose-200',
  info: 'bg-sky-50 text-sky-800 ring-1 ring-sky-200',
  muted: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200',
} as const;
const BUTTON = 'inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed';

function useDateFormat() {
  const locale = useLocale();
  return useMemo(() => {
    const f = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });
    return (iso: string | null | undefined) => (iso ? f.format(new Date(iso)) : '—');
  }, [locale]);
}

function Countdown({ ms }: { ms: number }) {
  const t = useTranslations('fieldBuilds');
  const { h, m, s } = splitDuration(ms);
  if (h > 0) return <>{t('countdown.hm', { h, m })}</>;
  if (m > 0) return <>{t('countdown.ms', { m, s })}</>;
  return <>{t('countdown.s', { s })}</>;
}

// ─── The page ──────────────────────────────────────────────────────────────

export function FieldBuildsPanel() {
  const t = useTranslations('fieldBuilds');
  const user = useAppStore((s) => s.user);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
  return <FieldBuildsConsole />;
}

function FieldBuildsConsole() {
  const t = useTranslations('fieldBuilds');
  const windows = useFieldBuildWindows(true);
  const candidates = useFieldBuildCandidates(true);
  const data = windows.data;
  const offset = clockOffset(data?.now, windows.dataUpdatedAt);
  const ticking = !!data?.active;
  const clientNow = useTicker(ticking);
  const serverNow = clientNow + offset;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <header className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FlaskConical className="w-6 h-6 text-indigo-600 shrink-0" aria-hidden /> {t('title')}
          </h1>
          <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
        </header>

        {windows.isLoading ? (
          <div className={`${CARD} flex items-center gap-2 text-sm text-slate-500`}>
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('loading')}
          </div>
        ) : windows.isError || !data ? (
          <div className={`${CARD} flex flex-wrap items-center gap-3`} role="alert">
            <span className="text-sm text-rose-700">{t('loadFailed')}</span>
            <button type="button" onClick={() => windows.refetch()} className={`${BUTTON} bg-slate-900 text-white`}>
              {t('retry')}
            </button>
          </div>
        ) : (
          <>
            <NowCard data={data} serverNow={serverNow} />
            {data.active ? (
              <WindowScreensCard window={data.active} serverNow={serverNow} />
            ) : (
              <ArmCard candidates={candidates.data?.candidates ?? []} candidatesLoading={candidates.isLoading} limits={data.limits} />
            )}
          </>
        )}

        <CandidatesCard query={candidates} />
        {data && <HistoryCard windows={data.windows} />}
      </div>
    </div>
  );
}

// ─── What is offered now ───────────────────────────────────────────────────

function NowCard({ data, serverNow }: { data: FieldBuildWindows; serverNow: number }) {
  const t = useTranslations('fieldBuilds');
  const fmt = useDateFormat();
  const cancel = useCancelFieldWindow();
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);
  const w = data.active;

  const onCancel = async () => {
    if (!w) return;
    const ok = await appConfirm({
      title: t('now.cancelTitle', { candidate: w.candidate }),
      message: t('now.cancelMessage'),
      confirmLabel: t('now.cancelConfirm'),
      cancelLabel: t('now.cancelKeep'),
      tone: 'danger',
    });
    if (!ok) return;
    setOutcome(null);
    cancel.mutate(
      { id: w.id },
      {
        onSuccess: (r) => setOutcome({ ok: true, text: t('now.cancelled', { count: r.pushesCancelled.length }) }),
        onError: () => setOutcome({ ok: false, text: t('now.cancelFailed') }),
      },
    );
  };

  return (
    <section className={CARD} aria-labelledby="fb-now">
      <h2 id="fb-now" className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {t('now.heading')}
      </h2>
      {w ? (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${CHIP} ${TONES.good}`}>{t('history.state.active')}</span>
            <p className="text-lg font-bold text-slate-900 break-all">{t('now.window', { candidate: w.candidate })}</p>
          </div>
          <p className="text-sm text-slate-700" aria-live="polite">
            {t('now.endsIn')}{' '}
            <strong className="tabular-nums">
              <Countdown ms={Date.parse(w.expiresAt) - serverNow} />
            </strong>{' '}
            <span className="text-slate-500">· {t('now.endsAt', { when: fmt(w.expiresAt) })}</span>
          </p>
          <p className="text-sm text-slate-600">
            {w.tenants.map((x) => x.name ?? x.id).join(', ')} ·{' '}
            {w.allScreens ? t('now.everyScreen') : t('now.screensCount', { count: w.screenIds.length })}
          </p>
          <p className="text-xs text-slate-500">
            {t('now.armedBy', { when: fmt(w.armedAt), who: w.armedBy.email ?? t('now.someone') })}
          </p>
          {w.note && <p className="text-sm text-slate-700 break-words">{t('now.note', { note: w.note })}</p>}
          {data.variables.live && <p className="text-xs text-slate-500">{t('now.variablesOverridden')}</p>}
          <div className="pt-1 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={cancel.isPending}
              className={`${BUTTON} bg-rose-600 text-white hover:bg-rose-700`}
            >
              <XCircle className="w-4 h-4" aria-hidden />
              {cancel.isPending ? t('now.cancelling') : t('now.cancel')}
            </button>
          </div>
        </div>
      ) : data.effective === 'variables' ? (
        <p className="mt-2 text-sm text-slate-700">
          {t('now.variables', { candidate: data.variables.candidate ?? '—', when: fmt(data.variables.expiresAt) })}
        </p>
      ) : (
        <p className="mt-2 text-sm text-slate-700">{t('now.none')}</p>
      )}
      {outcome && (
        <p role={outcome.ok ? 'status' : 'alert'} className={`mt-3 text-sm ${outcome.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
          {outcome.text}
        </p>
      )}
    </section>
  );
}

// ─── The open window's screens ─────────────────────────────────────────────

type RowOutcome = { ok: true } | { ok: false; key: KnownError | 'generic' };

function WindowScreensCard({ window: w, serverNow }: { window: FieldBuildWindow; serverNow: number }) {
  const t = useTranslations('fieldBuilds');
  const tenantIds = useMemo(() => w.tenants.map((x) => x.id), [w.tenants]);
  const screensQuery = useFieldBuildScreens(tenantIds, { enabled: true, live: true });
  const push = usePushFieldWindow();
  const [overrideWindow, setOverrideWindow] = useState(false);
  const [pushingId, setPushingId] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, RowOutcome>>({});
  const scoped = windowScreens(w, screensQuery.data?.screens ?? []);
  const unreachable = screensQuery.data?.unreachable.length ?? 0;
  const readyInMs = Date.parse(w.pushReadyAt) - serverNow;

  const onPush = (screenId: string) => {
    setPushingId(screenId);
    push.mutate(
      { id: w.id, screenIds: [screenId], overrideWindow },
      {
        onSuccess: (r) => {
          const armed = r.results.find((x) => x.screenId === screenId)?.armed;
          setOutcomes((o) => ({ ...o, [screenId]: armed ? { ok: true } : { ok: false, key: 'generic' } }));
        },
        onError: (e) => setOutcomes((o) => ({ ...o, [screenId]: { ok: false, key: errorKey(e) } })),
        onSettled: () => setPushingId(null),
      },
    );
  };

  return (
    <section className={CARD} aria-labelledby="fb-screens">
      <h2 id="fb-screens" className="text-base font-bold text-slate-900">
        {t('screens.heading')}
      </h2>
      <p className="text-sm text-slate-500 mt-1">{t('screens.oneAtATime')}</p>
      <label className="mt-3 flex items-start gap-3 min-h-11 text-sm text-slate-700">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 shrink-0"
          checked={overrideWindow}
          onChange={(e) => setOverrideWindow(e.target.checked)}
        />
        <span>
          {t('screens.overrideWindow')}
          <span className="block text-xs text-slate-500">{t('screens.overrideHint')}</span>
        </span>
      </label>
      {unreachable > 0 && <p className="mt-2 text-xs text-amber-800">{t('screens.unreachable', { count: unreachable })}</p>}
      {screensQuery.isLoading ? (
        <p className="mt-3 text-sm text-slate-500">{t('loading')}</p>
      ) : scoped.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{t('screens.empty')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {scoped.map(({ id, screen }) => {
            const block = pushBlock(screen, w, serverNow);
            const tracked = screen ? deriveTrackedPush(screen) : null;
            const outcome = outcomes[id];
            return (
              <li key={id} className="py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 break-words">{screen?.name ?? t('screens.unknown', { id: id.slice(0, 8) })}</p>
                  {screen && (
                    <p className="text-xs text-slate-500 break-words">
                      {screen.tenantName ?? screen.tenantId} · {screen.online ? t('screens.online') : t('screens.offline')} ·{' '}
                      {screen.playerVersion ? t('screens.version', { version: screen.playerVersion }) : t('screens.versionUnknown')}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className={`${CHIP} ${tracked ? (tracked.kind === 'failed' || tracked.kind === 'stalled' ? TONES.bad : tracked.kind === 'needs-tap' || tracked.kind === 'expired' ? TONES.warn : TONES.info) : TONES.muted}`}>
                      {t(`screens.state.${tracked?.kind ?? 'none'}`)}
                    </span>
                    {block === 'on-build' && <span className={`${CHIP} ${TONES.good}`}>{t('screens.onBuild')}</span>}
                  </div>
                  {outcome && (
                    <p role={outcome.ok ? 'status' : 'alert'} className={`mt-1 text-xs ${outcome.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {outcome.ok ? t('screens.pushed') : t(`errors.${outcome.key}`)}
                    </p>
                  )}
                </div>
                {screen && block !== 'revoked' && (
                  <button
                    type="button"
                    onClick={() => onPush(id)}
                    disabled={block !== null || pushingId !== null}
                    aria-label={t('screens.pushLabel', { name: screen.name })}
                    className={`${BUTTON} bg-slate-900 text-white hover:bg-slate-800 sm:shrink-0`}
                  >
                    <Send className="w-4 h-4" aria-hidden />
                    {pushingId === id
                      ? t('screens.pushing')
                      : block === 'settling'
                        ? t('screens.readyIn', { seconds: Math.max(1, Math.ceil(readyInMs / 1000)) })
                        : t('screens.push')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Arm a window ──────────────────────────────────────────────────────────

function ArmCard({
  candidates,
  candidatesLoading,
  limits,
}: {
  candidates: FieldBuildCandidate[];
  candidatesLoading: boolean;
  limits: FieldBuildWindows['limits'];
}) {
  const t = useTranslations('fieldBuilds');
  const fmt = useDateFormat();
  const tenantsQuery = useAccessibleTenants();
  const arm = useArmFieldWindow();
  const allowed = useMemo(() => candidates.filter((c) => c.allowed), [candidates]);
  const [candidate, setCandidate] = useState('');
  const [tenantIds, setTenantIds] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [mode, setMode] = useState<'some' | 'all'>('some');
  const [screenIds, setScreenIds] = useState<string[]>([]);
  const [duration, setDuration] = useState<number>(DEFAULT_DURATION);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Preselect the newest allowed build once the list arrives.
  useEffect(() => {
    if (!candidate && allowed.length) setCandidate(defaultCandidate(allowed));
  }, [allowed, candidate]);

  const reachable = useMemo(
    () => (tenantsQuery.data?.tenants ?? []).filter((x) => x.supportAccess !== null),
    [tenantsQuery.data],
  );
  const shownTenants = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? reachable.filter((x) => x.name.toLowerCase().includes(q) || x.slug.toLowerCase().includes(q)) : reachable;
  }, [reachable, filter]);
  const screensQuery = useFieldBuildScreens(tenantIds, { enabled: mode === 'some' });
  const pickable = (screensQuery.data?.screens ?? []).filter((s) => s.status !== 'REVOKED');
  // A screen stays chosen only while its organization is.
  const chosenScreens = screenIds.filter((id) => pickable.some((s) => s.id === id));
  const selectedCandidate = candidates.find((c) => c.versionName === candidate);
  const durationOk = duration >= limits.minMinutes && duration <= limits.maxMinutes;
  const valid = !!selectedCandidate && tenantIds.length > 0 && (mode === 'all' || chosenScreens.length > 0) && durationOk;

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const durationLabel = (min: number) => (min < 60 ? t('arm.minutes', { count: min }) : t('arm.hours', { count: min / 60 }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setMessage(null);
    arm.mutate(
      {
        candidate,
        tenantIds,
        screens: mode === 'all' ? 'all' : chosenScreens,
        durationMinutes: duration,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: () => setMessage({ ok: true, text: t('arm.armed') }),
        onError: (err) => setMessage({ ok: false, text: t(`errors.${errorKey(err)}`) }),
      },
    );
  };

  return (
    <section className={CARD} aria-labelledby="fb-arm">
      <h2 id="fb-arm" className="text-base font-bold text-slate-900">
        {t('arm.heading')}
      </h2>
      <form onSubmit={onSubmit} className="mt-3 space-y-4">
        <label className="block">
          <span className="text-sm font-semibold text-slate-800">{t('arm.build')}</span>
          <select
            className="mt-1 w-full min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm"
            value={candidate}
            onChange={(e) => setCandidate(e.target.value)}
            disabled={candidatesLoading || allowed.length === 0}
          >
            {allowed.length === 0 && <option value="">{t('arm.noBuilds')}</option>}
            {allowed.map((c) => (
              <option key={c.versionName} value={c.versionName}>
                {c.versionName}
                {c.mirror.state === 'present' ? '' : ` — ${t('arm.notMirrored')}`}
              </option>
            ))}
          </select>
          {selectedCandidate && selectedCandidate.mirror.state !== 'present' && (
            <span className="mt-1 block text-xs text-amber-800">{t('arm.mirrorWarning')}</span>
          )}
        </label>

        <fieldset>
          <legend className="text-sm font-semibold text-slate-800">{t('arm.organizations')}</legend>
          <p className="text-xs text-slate-500">{t('arm.organizationsHint')}</p>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('arm.filterPlaceholder')}
            aria-label={t('arm.filterPlaceholder')}
            className="mt-2 w-full min-h-10 rounded-lg border border-slate-200 px-3 text-sm"
          />
          <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-slate-100">
            {tenantsQuery.isLoading ? (
              <p className="p-3 text-sm text-slate-500">{t('loading')}</p>
            ) : shownTenants.length === 0 ? (
              <p className="p-3 text-sm text-slate-500">{t('arm.noOrganizations')}</p>
            ) : (
              shownTenants.map((x) => (
                <label key={x.id} className="flex items-center gap-3 px-3 min-h-11 text-sm text-slate-800 border-b border-slate-50 last:border-0">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0"
                    checked={tenantIds.includes(x.id)}
                    onChange={() => setTenantIds((list) => toggle(list, x.id))}
                  />
                  <span className="min-w-0 break-words">{x.name}</span>
                </label>
              ))
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-slate-800">{t('arm.screens')}</legend>
          <div className="mt-1 flex flex-col gap-1 sm:flex-row sm:gap-6">
            <label className="flex items-center gap-2 min-h-11 text-sm">
              <input type="radio" name="fb-mode" checked={mode === 'some'} onChange={() => setMode('some')} />
              {t('arm.someScreens')}
            </label>
            <label className="flex items-center gap-2 min-h-11 text-sm">
              <input type="radio" name="fb-mode" checked={mode === 'all'} onChange={() => setMode('all')} />
              {t('arm.allScreens')}
            </label>
          </div>
          {mode === 'some' && (
            <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-slate-100">
              {tenantIds.length === 0 ? (
                <p className="p-3 text-sm text-slate-500">{t('arm.chooseOrganizationsFirst')}</p>
              ) : screensQuery.isLoading ? (
                <p className="p-3 text-sm text-slate-500">{t('loading')}</p>
              ) : pickable.length === 0 ? (
                <p className="p-3 text-sm text-slate-500">{t('arm.noScreens')}</p>
              ) : (
                pickable.map((s) => (
                  <label key={s.id} className="flex items-start gap-3 px-3 py-2 min-h-11 text-sm text-slate-800 border-b border-slate-50 last:border-0">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 shrink-0"
                      checked={screenIds.includes(s.id)}
                      onChange={() => setScreenIds((list) => toggle(list, s.id))}
                    />
                    <span className="min-w-0">
                      <span className="block break-words">{s.name}</span>
                      <span className="block text-xs text-slate-500 break-words">
                        {s.tenantName ?? s.tenantId} ·{' '}
                        {s.playerVersion ? t('screens.version', { version: s.playerVersion }) : t('screens.versionUnknown')}
                      </span>
                    </span>
                  </label>
                ))
              )}
            </div>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold text-slate-800">{t('arm.duration')}</span>
            <select
              className="mt-1 w-full min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              {DURATION_PRESETS.filter((m) => m >= limits.minMinutes && m <= limits.maxMinutes).map((m) => (
                <option key={m} value={m}>
                  {durationLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-slate-800">{t('arm.note')}</span>
            <input
              type="text"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('arm.notePlaceholder')}
              className="mt-1 w-full min-h-11 rounded-lg border border-slate-200 px-3 text-sm"
            />
          </label>
        </div>

        {valid && (
          <p className="text-sm text-slate-700">
            {t('arm.summary', {
              candidate,
              screens: mode === 'all' ? t('now.everyScreen') : t('now.screensCount', { count: chosenScreens.length }),
              organizations: t('arm.organizationsCount', { count: tenantIds.length }),
              when: fmt(new Date(Date.now() + duration * 60_000).toISOString()),
            })}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!valid || arm.isPending} className={`${BUTTON} bg-indigo-600 text-white hover:bg-indigo-700`}>
            {arm.isPending ? t('arm.submitting') : t('arm.submit')}
          </button>
          {message && (
            <p role={message.ok ? 'status' : 'alert'} className={`text-sm ${message.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
              {message.text}
            </p>
          )}
        </div>
      </form>
    </section>
  );
}

// ─── Registered builds ─────────────────────────────────────────────────────

const MIRROR_TONE: Record<string, keyof typeof TONES> = {
  present: 'good',
  missing: 'bad',
  'size-mismatch': 'bad',
  unconfigured: 'warn',
  unknown: 'muted',
};

function CandidatesCard({ query }: { query: ReturnType<typeof useFieldBuildCandidates> }) {
  const t = useTranslations('fieldBuilds');
  const locale = useLocale();
  const mb = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }), [locale]);
  const list = query.data?.candidates ?? [];
  return (
    <section className={CARD} aria-labelledby="fb-candidates">
      <h2 id="fb-candidates" className="text-base font-bold text-slate-900">
        {t('candidates.heading')}
      </h2>
      {query.isLoading ? (
        <p className="mt-3 text-sm text-slate-500">{t('loading')}</p>
      ) : query.isError ? (
        <p className="mt-3 text-sm text-rose-700" role="alert">
          {t('loadFailed')}
        </p>
      ) : list.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{t('candidates.empty')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {list.map((c) => (
            <li key={c.versionName} className="py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="font-mono text-sm font-bold text-slate-900">{c.versionName}</span>
              <span className="text-xs text-slate-500">{t('candidates.size', { mb: mb.format(c.size / (1024 * 1024)) })}</span>
              <span className="font-mono text-xs text-slate-500 break-all">{t('candidates.sha', { prefix: c.sha256.slice(0, 12) })}</span>
              <a
                href={c.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-700 hover:underline min-h-8"
              >
                {t('candidates.ci')} <ExternalLink className="w-3 h-3" aria-hidden />
              </a>
              <span className={`${CHIP} ${TONES[MIRROR_TONE[c.mirror.state] ?? 'muted']}`}>
                {c.mirror.state === 'present' ? <CheckCircle2 className="w-3 h-3 mr-1" aria-hidden /> : null}
                {t(`candidates.mirror.${c.mirror.state}`)}
              </span>
              {!c.allowed && (
                <span className={`${CHIP} ${TONES.bad}`} title={c.blockedReason ?? undefined}>
                  {t('candidates.blocked')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Recent windows ────────────────────────────────────────────────────────

const STATE_TONE: Record<FieldBuildWindow['state'], keyof typeof TONES> = { active: 'good', cancelled: 'muted', expired: 'muted' };

function HistoryCard({ windows }: { windows: FieldBuildWindow[] }) {
  const t = useTranslations('fieldBuilds');
  const fmt = useDateFormat();
  return (
    <section className={CARD} aria-labelledby="fb-history">
      <h2 id="fb-history" className="text-base font-bold text-slate-900">
        {t('history.heading')}
      </h2>
      {windows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{t('history.empty')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {windows.map((w) => (
            <li key={w.id} className="py-3 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`${CHIP} ${TONES[STATE_TONE[w.state]]}`}>{t(`history.state.${w.state}`)}</span>
                <span className="font-mono text-sm font-semibold text-slate-900">{w.candidate}</span>
              </div>
              <p className="text-xs text-slate-600 break-words">
                {t('history.line', {
                  when: fmt(w.armedAt),
                  until: fmt(w.cancelledAt ?? w.expiresAt),
                  organizations: w.tenants.map((x) => x.name ?? x.id).join(', '),
                  screens: w.allScreens ? t('now.everyScreen') : t('now.screensCount', { count: w.screenIds.length }),
                })}
              </p>
              <p className="text-xs text-slate-500 break-words">
                {t('history.by', { who: w.armedBy.email ?? t('now.someone') })}
                {w.cancelledBy ? ` · ${t('history.cancelledBy', { who: w.cancelledBy.email ?? t('now.someone') })}` : ''}
                {w.note ? ` · ${w.note}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
