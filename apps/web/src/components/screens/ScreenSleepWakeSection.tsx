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

/** "4 hr", "35 min", "50 sec" in the reader's language. */
function duration(locale: string, seconds: number): string {
  const [value, unit] =
    seconds >= 3600 ? [Math.round((seconds / 3600) * 10) / 10, 'hour'] :
    seconds >= 60 ? [Math.round(seconds / 60), 'minute'] :
    [seconds, 'second'];
  try {
    return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short' }).format(value);
  } catch {
    return `${value} ${unit}`;
  }
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
        {s.nativeGlass && (
          // Native-first §4.4: the app's own engine, independent of the page.
          <p className="text-[10px] text-emerald-700 leading-snug mt-0.5" data-testid="sleep-wake-native-glass">
            {t('now.nativeGlass', { ago: ago(s.nativeGlass.frameAtMs) })}
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
          {s.lastOff && (
            <p className="text-[10px] text-slate-500 leading-snug" data-testid="sleep-wake-last-off">
              {/* 1.1.42+: the player says what it PROVED about the off (player rule 10) — a timeout only when the idle
                  time reached the box's own screen-off timeout; otherwise "not ours, not a timeout". Older players
                  fall through to the attentive-timeout match and the plain idle line. */}
              {s.lastOff.cause === 'screen-timeout' && s.lastOff.idleS !== null
                ? t('proof.lastOffTimeout', {
                    ago: ago(s.lastOff.atMs),
                    idle: duration(locale, s.lastOff.idleS),
                    timeout: s.lastOff.screenOffTimeoutS !== null ? duration(locale, s.lastOff.screenOffTimeoutS) : '?',
                  })
                : s.lastOff.cause === 'display-off' && s.lastOff.idleS !== null
                  ? s.lastOff.screenOffTimeoutS !== null
                    ? t('proof.lastOffNotOurs', {
                        ago: ago(s.lastOff.atMs),
                        idle: duration(locale, s.lastOff.idleS),
                        timeout: duration(locale, s.lastOff.screenOffTimeoutS),
                      })
                    : t('proof.lastOffNotOursNoTimeout', { ago: ago(s.lastOff.atMs), idle: duration(locale, s.lastOff.idleS) })
                  : s.lastOff.matchesInactivity && s.lastOff.idleS !== null
                    ? t('proof.lastOffInactivity', { ago: ago(s.lastOff.atMs), idle: duration(locale, s.lastOff.idleS) })
                    : s.lastOff.idleS !== null
                      ? t('proof.lastOffIdle', { ago: ago(s.lastOff.atMs), idle: duration(locale, s.lastOff.idleS) })
                      : t('proof.lastOffNoInput', { ago: ago(s.lastOff.atMs) })}
            </p>
          )}
          {turnOnLine && <p className="text-[10px] text-slate-500 leading-snug">{turnOnLine}</p>}
          {s.noEvidence && <p className="text-[10px] text-slate-400 leading-snug">{t('noEvidence')}</p>}
        </div>
      </div>
    </div>
  );
}
