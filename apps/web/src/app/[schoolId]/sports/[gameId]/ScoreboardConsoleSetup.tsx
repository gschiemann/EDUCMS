'use client';

/**
 * K12-F32 — Set up game → Scoreboard console. Replaces the "CTS scoreboard
 * console" pill whose only instruction was to open a kiosk at
 * `?cts=1&game=<id>&feedToken=<token>` — a write credential in a URL.
 *
 * The happy path (under 30 s once the box is paired): pick the console model
 * (only models that decode THIS game's sport are offered — a sport with none
 * says so), pick the screen wired to the console, Connect. The box learns the
 * binding from its manifest and starts reading; the card shows what the
 * console sends; the operator compares it with the scoreboard and confirms.
 * Nothing from the console reaches a screen before that. After it, the card
 * reports live / stale on the same freshness window every board uses, with
 * the box's own word about its serial port.
 *
 * Polling: useScoreboardConsole polls only while a console is bound and this
 * card is mounted (the Setup view), visible tab only.
 */
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  useBindScoreboardConsole,
  useConfirmScoreboardConsole,
  useScoreboardConsole,
  useUnbindScoreboardConsole,
  type ScoreboardConsoleView,
} from '@/hooks/use-api';
import { serverClock } from '@/lib/server-clock';
import { scoreboardConsoleState } from '@/lib/scoreboard-console-state';

function clockText(ms: number | null): string {
  if (ms === null) return '—';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function errorCode(err: unknown): string | null {
  const e = err as { code?: unknown; body?: { code?: unknown }; data?: { code?: unknown } } | null;
  const c = e?.code ?? e?.body?.code ?? e?.data?.code;
  return typeof c === 'string' ? c : null;
}

export function ScoreboardConsoleSetup({
  gameId,
  stats,
}: {
  gameId: string;
  stats: Record<string, unknown>;
}) {
  const t = useTranslations('sportsConsoleSetup');
  const { data } = useScoreboardConsole(gameId);
  const bind = useBindScoreboardConsole(gameId);
  const confirm = useConfirmScoreboardConsole(gameId);
  const unbind = useUnbindScoreboardConsole(gameId);
  const [model, setModel] = useState('');
  const [screenId, setScreenId] = useState('');
  const bound = !!data?.binding;

  // Ages are judged on the SERVER clock (K12-F40); 1 Hz only while bound.
  const [now, setNow] = useState(() => serverClock.unheldNow());
  useEffect(() => {
    if (!bound) return;
    const id = setInterval(() => setNow(serverClock.unheldNow()), 1000);
    return () => clearInterval(id);
  }, [bound]);

  const state = scoreboardConsoleState(data, stats, now);
  if (state.kind === 'loading' || !data) return null;

  const ago = (ms: number) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? t('ageSeconds', { seconds: s }) : t('ageMinutes', { minutes: Math.floor(s / 60) });
  };
  const duration = (ms: number) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? t('durationSeconds', { seconds: s }) : t('durationMinutes', { minutes: Math.floor(s / 60) });
  };
  const errorText = (err: unknown) => {
    switch (errorCode(err)) {
      case 'CONSOLE_SPORT_UNSUPPORTED':
        return t('errorSportUnsupported', { sport: data.sportName });
      case 'SCOREBOARD_CONSOLE_GAME_FINAL':
        return t('errorFinal');
      case 'SCOREBOARD_CONSOLE_NO_PREVIEW':
        return t('errorNoPreview');
      default:
        return t('errorGeneric');
    }
  };
  const linkLabel = (s: NonNullable<ScoreboardConsoleView['link']>['status']) =>
    ({
      connected: t('linkConnected'),
      connecting: t('linkConnecting'),
      disconnected: t('linkDisconnected'),
      idle: t('linkIdle'),
      error: t('linkError'),
    })[s];

  const offered = data.models.filter((m) => m.supported);
  const b = data.binding;

  return (
    <div data-testid="scoreboard-console-setup">
      <p className="mb-2 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
        {t('title')}
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-amber-800">
          {t('experimental')}
        </span>
      </p>
      <p className="mb-2 text-xs text-slate-400">{t('intro')}</p>

      {state.kind === 'unsupported' && (
        <p className="text-xs text-slate-500" data-testid="scoreboard-console-unsupported">
          {t('unsupported', { sport: state.sportName })}
        </p>
      )}

      {state.kind === 'final' && <p className="text-xs text-slate-500">{t('final')}</p>}

      {state.kind === 'unbound' && (
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-slate-600">
            {t('modelLabel')}
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              data-testid="scoreboard-console-model"
              className="mt-1 block min-h-[36px] w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
            >
              <option value="">{t('modelPlaceholder')}</option>
              {offered.map((m) => (
                <option key={m.id} value={m.id}>
                  {t('modelReadsOnly', { model: m.label, sports: m.supportedSportNames.join(', ') })}
                </option>
              ))}
            </select>
          </label>
          {data.screens.length === 0 ? (
            <p className="text-xs text-slate-500">{t('noScreens')}</p>
          ) : (
            <label className="block text-xs font-semibold text-slate-600">
              {t('screenLabel')}
              <select
                value={screenId}
                onChange={(e) => setScreenId(e.target.value)}
                data-testid="scoreboard-console-screen"
                className="mt-1 block min-h-[36px] w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
              >
                <option value="">{t('screenPlaceholder')}</option>
                {data.screens.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.otherGame
                      ? t('screenOtherGame', { name: s.name, game: s.otherGame.label })
                      : s.online
                        ? s.name
                        : t('screenOffline', { name: s.name })}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            disabled={!model || !screenId || bind.isPending}
            onClick={() => bind.mutate({ screenId, consoleProfile: model })}
            data-testid="scoreboard-console-connect"
            className="min-h-[36px] rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
          >
            {bind.isPending ? t('connecting') : t('connect')}
          </button>
          {bind.isError && (
            <p role="alert" className="text-xs text-rose-600">
              {errorText(bind.error)}
            </p>
          )}
        </div>
      )}

      {b && state.kind !== 'unbound' && state.kind !== 'unsupported' && state.kind !== 'final' && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5" data-testid="scoreboard-console-status">
          <p className="text-xs font-semibold text-slate-700">
            {t('boundLine', { screen: b.screenName, model: b.modelLabel ?? '—' })}
          </p>
          <p className="text-xs text-slate-600" data-testid="scoreboard-console-state" data-state={state.kind}>
            {state.kind === 'model-mismatch' &&
              t('modelMismatch', {
                screen: state.screenName,
                sports: state.supportedSportNames.join(', '),
                sport: state.sportName,
              })}
            {state.kind === 'box-offline' && t('boxOffline', { screen: state.screenName })}
            {state.kind === 'waiting-box' && t('waitingBox', { screen: state.screenName })}
            {state.kind === 'port-closed' &&
              (state.needsClick
                ? t('portClosedClick', { screen: state.screenName })
                : t('portClosed', { screen: state.screenName }))}
            {state.kind === 'no-frames' && t('noFrames', { bytes: state.bytes })}
            {state.kind === 'preview' && t('previewHelp')}
            {state.kind === 'live' && t('live', { age: ago(state.ageMs) })}
            {state.kind === 'live-stale' &&
              (state.ageMs === null ? t('staleNever') : t('stale', { duration: duration(state.ageMs) }))}
          </p>
          {state.kind === 'live-stale' && state.linkStatus && (
            <p className="text-xs text-slate-500">
              {t('staleLink', { screen: state.screenName, status: linkLabel(state.linkStatus) })}
            </p>
          )}
          {state.kind === 'preview' && (
            <div data-testid="scoreboard-console-preview">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{t('previewTitle')}</p>
              <dl className="mt-1 grid grid-cols-4 gap-2 text-center">
                {[
                  [t('previewClock'), clockText(state.preview.clockMs)],
                  [t('previewPeriod'), state.preview.segment ?? '—'],
                  [t('previewHome'), state.preview.homeScore ?? '—'],
                  [t('previewAway'), state.preview.awayScore ?? '—'],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg bg-white px-1 py-1.5 ring-1 ring-slate-200">
                    <dt className="text-[10px] font-semibold uppercase text-slate-400">{label}</dt>
                    <dd className="text-lg font-black tabular-nums text-slate-900">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-1 text-[11px] text-slate-400">{t('previewAge', { age: ago(state.ageMs) })}</p>
              <button
                type="button"
                disabled={confirm.isPending}
                onClick={() => confirm.mutate()}
                data-testid="scoreboard-console-confirm"
                className="mt-2 min-h-[36px] rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
              >
                {confirm.isPending ? t('confirming') : t('confirm')}
              </button>
              {confirm.isError && (
                <p role="alert" className="mt-1 text-xs text-rose-600">
                  {errorText(confirm.error)}
                </p>
              )}
            </div>
          )}
          <button
            type="button"
            disabled={unbind.isPending}
            onClick={() => unbind.mutate()}
            data-testid="scoreboard-console-disconnect"
            className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-40"
          >
            {t('disconnect')}
          </button>
          {unbind.isError && (
            <p role="alert" className="text-xs text-rose-600">
              {errorText(unbind.error)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
