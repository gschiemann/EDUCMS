'use client';

/**
 * ScreenSleepWakeSection — per screen: how it turns off, what wakes it, and
 * what its player last PROVED (2026-10-11). The rules live in
 * ./sleep-wake.ts (pure, tested); this only renders them.
 *
 * Copy discipline (CLAUDE.md player rule 10 — "copy states what the evidence
 * proves"): "asleep" only from Android's own report, "turned off" only when
 * the player saw it, and a black overlay is always called a black screen
 * with the backlight on — never "off".
 */

import { useLocale, useTranslations } from 'next-intl';
import { Moon } from 'lucide-react';
import {
  ALERT_RESTORE_MIN,
  NATIVE_ALERT_WATCH_MIN,
  NATIVE_POWER_ON_MIN,
  summarizeSleepWake,
  type SleepOutcome,
  type Support,
} from './sleep-wake';

/** A turn-on older than this without a confirmation is "not confirmed", not "waiting". */
const TURN_ON_CONFIRM_WINDOW_MS = 15 * 60_000;

function relative(locale: string, atMs: number, nowMs: number): string {
  const diffSec = Math.round((atMs - nowMs) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86_400), 'day');
}

const KNOWN_DECISIONS = [
  'RESTORE',
  'WAKE_COMMAND_DURING_ALERT',
  'SCHEDULE_ON_AFTER_OFF',
  'REBOOTED',
  'STILL_HELD',
  'NOTHING_INTERRUPTED',
] as const;

export function ScreenSleepWakeSection({
  screen,
  nowMs = Date.now(),
}: {
  screen: {
    playerVersion?: string | null;
    displayCapabilities?: unknown;
    nativeRuntimeReport?: unknown;
    nativeRuntimeReportAt?: string | null;
    nativePowerOnAt?: string | null;
  } | null | undefined;
  nowMs?: number;
}) {
  const t = useTranslations('screens.sleepWake');
  const locale = useLocale();
  if (!screen) return null;
  const s = summarizeSleepWake({
    playerVersion: screen.playerVersion ?? null,
    displayCapabilities: screen.displayCapabilities,
    nativeRuntimeReport: screen.nativeRuntimeReport,
    nativeRuntimeReportAt: screen.nativeRuntimeReportAt ?? null,
    nativePowerOnAt: screen.nativePowerOnAt ?? null,
    nowMs,
  });

  const ago = (atMs: number) => relative(locale, atMs, nowMs);
  const supportText = (v: Support, min: readonly number[]) =>
    v === 'yes' ? t('support.yes') : v === 'no' ? t('support.needs', { version: min.join('.') }) : t('support.unknown');
  const supportClass = (v: Support) =>
    v === 'yes' ? 'text-emerald-700' : v === 'no' ? 'text-amber-700' : 'text-slate-400';
  const outcomeText = (o: SleepOutcome) => t(`outcome.${o}`);

  const rows: Array<{ key: string; label: string; value: Support; min: readonly number[] }> = [
    { key: 'alert', label: t('row.alert'), value: s.alertWakesSleeping, min: NATIVE_ALERT_WATCH_MIN },
    { key: 'turnOn', label: t('row.turnOn'), value: s.turnOnReachesSleeping, min: NATIVE_POWER_ON_MIN },
    { key: 'backToOff', label: t('row.backToOff'), value: s.backToOffAfterAlert, min: ALERT_RESTORE_MIN },
  ];

  let turnOnLine: string | null = null;
  if (s.lastTurnOn) {
    const when = ago(s.lastTurnOn.requestedAtMs);
    if (s.lastTurnOn.acknowledged) turnOnLine = t('turnOn.confirmed', { ago: when });
    else if (nowMs - s.lastTurnOn.requestedAtMs < TURN_ON_CONFIRM_WINDOW_MS) turnOnLine = t('turnOn.waiting', { ago: when });
    else turnOnLine = t('turnOn.notConfirmed', { ago: when });
  }

  const decisionKey = s.lastRestore && (KNOWN_DECISIONS as readonly string[]).includes(s.lastRestore.decision)
    ? s.lastRestore.decision
    : 'OTHER';

  return (
    <div className="border-t border-slate-100" data-testid="sleep-wake-section">
      <div className="px-3.5 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
            <Moon className="w-3.5 h-3.5 text-slate-400" />
            {t('title')}
          </span>
          {s.androidRelease && (
            <span className="text-[10px] text-slate-500">{t('android', { release: s.androidRelease })}</span>
          )}
        </div>

        <p className="text-[10px] text-slate-600 leading-snug mt-1" data-testid="sleep-wake-mechanism">
          {t(`mech.${s.mechanism}`)}
        </p>
        <p className="text-[10px] text-slate-400 leading-snug mt-0.5">{t('blankNote')}</p>

        {s.now && (
          <p
            className={`text-[10px] font-semibold leading-snug mt-1.5 ${s.now.asleep ? 'text-slate-700' : 'text-emerald-700'}`}
            data-testid="sleep-wake-now"
          >
            {s.now.asleep
              ? s.now.sinceMs
                ? t('now.asleepSince', { since: ago(s.now.sinceMs) })
                : t('now.asleep')
              : t('now.on')}
          </p>
        )}

        <div className="mt-2 space-y-1">
          {rows.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-600">{r.label}</span>
              <span className={`text-[10px] font-semibold shrink-0 ${supportClass(r.value)}`}>
                {supportText(r.value, r.min)}
              </span>
            </div>
          ))}
        </div>

        <div className="mt-2 space-y-0.5" data-testid="sleep-wake-proof">
          {s.lastSleep && (
            <p className="text-[10px] text-slate-500 leading-snug">
              {t('proof.lastSleep', { outcome: outcomeText(s.lastSleep.outcome), ago: ago(s.lastSleep.atMs) })}
            </p>
          )}
          {s.lastRestore && (
            <p className="text-[10px] text-slate-500 leading-snug">
              {t('proof.lastRestore', {
                outcome: outcomeText(s.lastRestore.outcome),
                reason: t(`decision.${decisionKey}`),
                ago: ago(s.lastRestore.atMs),
              })}
            </p>
          )}
          {turnOnLine && <p className="text-[10px] text-slate-500 leading-snug">{turnOnLine}</p>}
          {s.noEvidence && <p className="text-[10px] text-slate-400 leading-snug">{t('noEvidence')}</p>}
        </div>
      </div>
    </div>
  );
}
