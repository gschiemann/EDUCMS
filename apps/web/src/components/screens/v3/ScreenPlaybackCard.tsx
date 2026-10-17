"use client";

/**
 * ScreenPlaybackCard — "does this screen play video smoothly?" (2026-10-11,
 * video guarantee step 4; docs/research/2026-10-11-launch-readiness/02-video-guarantee.md).
 *
 * Read-only. One line for the screen (plays smoothly / hitches / stutters /
 * not checked yet), what it can play and where that answer comes from
 * (measured here → measured on the same model → the browser's own claim →
 * typical for the model), and the files it actually played, newest first.
 * The data is minutes of the player's own dropped-frame counts per file
 * (`screen_file_playback`), not one sample — and copy states only that
 * (Player Reliability rule 10): we never see the glass.
 *
 * 2026-10-12 (owner decision A): when the screen proved it visibly stutters
 * on a file and was moved to that file's 1080p copy, the card says so in
 * plain words and offers ONE action to admins — "Try full quality again"
 * (the API enforces the role; the button is hidden for others). Fetched once
 * when the Overview is open — never polled (mobile-perf standard). Dashboard
 * surface, so CSS gap is fine.
 *
 * 2026-10-17 (demotion sample guard): minutes the player recorded but that
 * never counted — just after a page load, an engine change, a hand-off or an
 * update, or played by the backup player while the built-in video engine
 * should — are listed under their file with the latest reason, so a verdict
 * built from fewer minutes than the screen played is never a mystery.
 */

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  useClearPlaybackDemotion,
  useScreenPlaybackCapability,
  type ScreenPlaybackCapabilityResponse,
  type ScreenPlaybackDemotion,
  type ScreenPlaybackFile,
} from '@/hooks/use-api';
import { RoleGate } from '@/components/RoleGate';

const ADMIN_ROLES = ['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN'];

type Tone = 'good' | 'warn' | 'bad' | 'neutral';
const TONE: Record<Tone, { wrap: string; ink: string; chip: string }> = {
  good: { wrap: 'border-emerald-200 bg-emerald-50/60', ink: 'text-emerald-800', chip: 'bg-emerald-100 text-emerald-800' },
  warn: { wrap: 'border-amber-200 bg-amber-50/70', ink: 'text-amber-800', chip: 'bg-amber-100 text-amber-800' },
  bad: { wrap: 'border-rose-200 bg-rose-50/70', ink: 'text-rose-800', chip: 'bg-rose-100 text-rose-800' },
  neutral: { wrap: 'border-slate-200 bg-slate-50', ink: 'text-slate-600', chip: 'bg-slate-100 text-slate-600' },
};

const SUMMARY: Record<ScreenPlaybackCapabilityResponse['summary'], { key: string; tone: Tone }> = {
  smooth: { key: 'summarySmooth', tone: 'good' },
  hitches: { key: 'summaryHitches', tone: 'warn' },
  stutters: { key: 'summaryStutters', tone: 'bad' },
  unknown: { key: 'summaryUnknown', tone: 'neutral' },
};

const FILE_VERDICT: Record<ScreenPlaybackFile['verdict'], { key: string; tone: Tone }> = {
  smooth: { key: 'fileSmooth', tone: 'good' },
  hitching: { key: 'fileHitching', tone: 'warn' },
  stuttering: { key: 'fileStuttering', tone: 'bad' },
  insufficient: { key: 'fileInsufficient', tone: 'neutral' },
};

const EVIDENCE: Record<ScreenPlaybackCapabilityResponse['capability']['evidence'], string> = {
  'measured-screen': 'evidenceMeasuredScreen',
  'measured-class': 'evidenceMeasuredClass',
  declared: 'evidenceDeclared',
  'class-default': 'evidenceClassDefault',
  unknown: 'evidenceUnknown',
};

/** Settled minutes behind a file's verdict (~one sample per minute of play). */
export function measuredMinutes(f: Pick<ScreenPlaybackFile, 'settledSamples'>): number {
  return Math.max(0, Math.round(f.settledSamples));
}

/**
 * Why the latest left-out minute was not counted (2026-10-17, the demotion
 * sample guard): the player's own warm-up minutes are recorded and shown here,
 * never graded. Null when nothing was ever left out (or an older API).
 */
const EXCLUDED_REASON: Record<NonNullable<ScreenPlaybackFile['excludedReason']>, string> = {
  'page-load': 'excludedPageLoad',
  'engine-change': 'excludedEngineChange',
  handoff: 'excludedHandoff',
  'player-update': 'excludedPlayerUpdate',
  'fallback-engine': 'excludedFallbackEngine',
};

export function excludedReasonKey(f: Pick<ScreenPlaybackFile, 'excludedSamples' | 'excludedReason'>): string | null {
  if (!(typeof f.excludedSamples === 'number' && f.excludedSamples > 0)) return null;
  return (f.excludedReason && EXCLUDED_REASON[f.excludedReason]) || 'excludedGeneric';
}

/** The capability line's message key, or null when there is nothing worth saying. */
export function capabilityKey(cap: ScreenPlaybackCapabilityResponse['capability']): 'cap2160' | 'cap1080' | 'capNone' | null {
  if (cap.maxShortEdge === 2160) return 'cap2160';
  if (cap.maxShortEdge === 1080) return 'cap1080';
  return cap.evidence === 'unknown' ? null : 'capNone';
}

/** One demotion: what happened, in plain words, and the one way back. */
function DemotionNotice({ screenId, demotion }: { screenId: string; demotion: ScreenPlaybackDemotion }) {
  const t = useTranslations('screens.playback');
  const locale = useLocale();
  const clear = useClearPlaybackDemotion(screenId);
  const [outcome, setOutcome] = useState<'done' | 'failed' | null>(null);
  let since = '';
  try {
    since = new Date(demotion.since).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  } catch {
    since = '';
  }
  return (
    <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50/70 px-2.5 py-2" data-testid="screen-playback-demotion" data-demotion-id={demotion.id}>
      <p className="text-[12px] font-bold leading-snug text-sky-900">{t('demotedTitle')}</p>
      <p className="mt-0.5 text-[10.5px] font-semibold leading-snug text-sky-800 break-words">
        {t('demotedBody', { file: demotion.name ?? t('demotedUnknownFile') })}
      </p>
      {since && <p className="mt-0.5 text-[10.5px] font-semibold leading-snug text-sky-700/80">{t('demotedSince', { date: since })}</p>}
      {outcome === 'done' ? (
        <p className="mt-1.5 text-[10.5px] font-semibold leading-snug text-emerald-800" role="status">{t('tryFullQualityDone')}</p>
      ) : (
        <RoleGate allowedRoles={ADMIN_ROLES} fallback={null}>
          <button
            type="button"
            className="mt-1.5 inline-flex min-h-[32px] items-center rounded-md border border-sky-300 bg-white px-2.5 text-[11px] font-bold text-sky-900 hover:bg-sky-100 disabled:opacity-60"
            disabled={clear.isPending}
            data-testid="screen-playback-try-full-quality"
            onClick={() => {
              setOutcome(null);
              clear.mutate(demotion.id, {
                onSuccess: () => setOutcome('done'),
                onError: () => setOutcome('failed'),
              });
            }}
          >
            {clear.isPending ? t('tryingFullQuality') : t('tryFullQuality')}
          </button>
        </RoleGate>
      )}
      {outcome === 'failed' && (
        <p className="mt-1 text-[10.5px] font-semibold leading-snug text-rose-700" role="alert">{t('tryFullQualityFailed')}</p>
      )}
    </div>
  );
}

export function ScreenPlaybackCard({ screenId, enabled }: { screenId: string; enabled: boolean }) {
  const t = useTranslations('screens.playback');
  const q = useScreenPlaybackCapability(screenId, enabled);
  if (!enabled) return null;
  if (q.isError) {
    return (
      <div className="rounded-xl border border-slate-200 p-3.5" data-testid="screen-playback-card" data-state="error">
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{t('title')}</p>
        <p className="mt-1 text-[11px] font-semibold text-slate-500">{t('loadFailed')}</p>
      </div>
    );
  }
  const data = q.data;
  if (!data) return null;
  const cap = data.capability;
  const summary = SUMMARY[data.summary];
  const capKey = capabilityKey(cap);
  const evidenceText = t(EVIDENCE[cap.evidence], { count: cap.classScreens });
  const concurrency =
    cap.maxUnitConcurrentVideos === null
      ? null
      : cap.maxUnitConcurrentVideos <= 1
        ? t('concurrencyOne')
        : t('concurrencyMany', { count: cap.maxUnitConcurrentVideos });

  return (
    <div className="rounded-xl border border-slate-200 p-3.5" data-testid="screen-playback-card" data-summary={data.summary}>
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{t('title')}</p>
      <div className={`mt-2 rounded-lg border px-2.5 py-2 ${TONE[summary.tone].wrap}`}>
        <p className={`text-[12px] font-bold leading-snug ${TONE[summary.tone].ink}`} data-testid="screen-playback-summary">
          {t(summary.key)}
        </p>
        {data.summary === 'unknown' && (
          <p className="mt-0.5 text-[10.5px] font-semibold text-slate-500 leading-snug">{t('unknownHint')}</p>
        )}
        {(capKey || concurrency) && (
          <p className="mt-0.5 text-[10.5px] font-semibold text-slate-600 leading-snug break-words">
            {[capKey ? t(capKey) : null, concurrency].filter(Boolean).join(' · ')}
            {capKey && <span className="text-slate-400"> — {evidenceText}</span>}
          </p>
        )}
        {cap.stale && <p className="mt-0.5 text-[10.5px] font-semibold text-slate-500 leading-snug">{t('stale')}</p>}
      </div>
      {(data.demotions ?? []).map((d) => (
        <DemotionNotice key={d.id} screenId={screenId} demotion={d} />
      ))}
      {data.files.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1.5" data-testid="screen-playback-files">
          {data.files.map((f) => {
            const v = FILE_VERDICT[f.verdict];
            const detail =
              f.verdict === 'insufficient' || f.droppedPct === null
                ? t('fileChecking', { count: f.samples })
                : t('fileDetail', { pct: f.droppedPct, minutes: measuredMinutes(f) });
            const extras = [
              f.copy === '1080p' ? t('copy1080') : null,
              f.width && f.height ? `${f.width} × ${f.height}` : null,
              f.unitConcurrentMax >= 2 ? t('bothSides') : null,
            ].filter(Boolean);
            const excludedKey = excludedReasonKey(f);
            return (
              <li key={f.sha256} className="flex items-start gap-2 min-w-0" data-playback-verdict={f.verdict}>
                <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold ${TONE[v.tone].chip}`}>{t(v.key)}</span>
                <span className="min-w-0">
                  <span className="block text-[11.5px] font-semibold text-slate-700 leading-snug break-all">{f.name}</span>
                  <span className="block text-[10.5px] font-semibold text-slate-500 leading-snug">
                    {[detail, ...extras].join(' · ')}
                  </span>
                  {excludedKey && (
                    <span className="block text-[10.5px] font-semibold text-slate-400 leading-snug" data-testid="screen-playback-excluded"
                      data-excluded-reason={f.excludedReason ?? ''}>
                      {t('excludedDetail', { count: f.excludedSamples ?? 0, reason: t(excludedKey) })}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[10.5px] font-semibold text-slate-400 leading-snug">{t('note')}</p>
    </div>
  );
}
