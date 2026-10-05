"use client";

/**
 * The live alerts on /panic, each with its OWN all-clear (alert targeting,
 * 2026-10-05).
 *
 * Several alerts can be live at once now (all screens, one group, one
 * screen), so "the" all-clear no longer exists: the operator picks the alert
 * and holds to end exactly that one. The hold is the same 3-second
 * press-and-hold the trigger uses (CLAUDE.md safeguard #5) — the page's own
 * idiom for "this changes what every person in the building is told", and
 * the one gesture a pocket cannot perform by accident. Keyboard Space/Enter
 * hold works the same way (WCAG 2.1.1), exactly like the trigger buttons.
 *
 * A bottom sheet, so the trigger grid behind it keeps its size and position.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CheckCircle2, Loader2, ShieldAlert, X } from 'lucide-react';
import type { ActiveAlert } from '@/lib/emergency-target';

const HOLD_TO_END_MS = 3000;

export interface PanicActiveAlertsSheetProps {
  alerts: ActiveAlert[];
  labelOf: (alert: ActiveAlert) => string;
  keyOf: (alert: ActiveAlert) => string;
  /** Send the all-clear for one alert. Resolves with the server's verdict. */
  onEnd: (alert: ActiveAlert) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
  announce: (text: string) => void;
}

export function PanicActiveAlertsSheet({ alerts, labelOf, keyOf, onEnd, onClose, announce }: PanicActiveAlertsSheetProps) {
  const t = useTranslations();
  const [selectedKey, setSelectedKey] = useState<string | null>(alerts.length === 1 ? keyOf(alerts[0]) : null);
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // The list can change under the sheet (another device cleared one). A
  // selection that vanished is dropped; a single remaining alert is THE one.
  const selected =
    alerts.find((a) => keyOf(a) === selectedKey) ?? (alerts.length === 1 ? alerts[0] : null);

  const clearTimers = () => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    if (progressTimer.current) { clearInterval(progressTimer.current); progressTimer.current = null; }
  };
  const stopHold = () => {
    clearTimers();
    setHolding(false);
    setProgress(0);
  };

  const send = async (alert: ActiveAlert) => {
    stopHold();
    setSending(true);
    setError('');
    announce(t('emergency.target.ending'));
    const result = await onEnd(alert);
    setSending(false);
    if (!result.ok) {
      const msg = result.error || t('emergency.panic.errGeneric');
      setError(msg);
      announce(t('emergency.target.endFailed', { error: msg }));
      return;
    }
    announce(t('emergency.target.ended', { label: labelOf(alert) }));
    setSelectedKey(null);
  };

  // Same 3-second press-and-hold as the trigger buttons on /panic.
  const startHold = () => {
    if (!selected || sending) return;
    const alert = selected;
    setError('');
    setHolding(true);
    setProgress(0);
    const started = performance.now();
    progressTimer.current = setInterval(() => {
      setProgress(Math.min(((performance.now() - started) / HOLD_TO_END_MS) * 100, 100));
    }, 50);
    holdTimer.current = setTimeout(() => void send(alert), HOLD_TO_END_MS);
  };

  // Focus the sheet on open; Escape closes it unless an all-clear is in
  // flight; timers never outlive the sheet.
  const sendingRef = useRef(sending);
  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);
  useEffect(() => {
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !sendingRef.current) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed top-0 right-0 bottom-0 left-0 z-[110] flex items-end justify-center bg-black/60">
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="panic-alerts-title"
        tabIndex={-1}
        data-testid="panic-alerts-sheet"
        className="w-full max-w-lg rounded-t-3xl border-t border-white/10 px-5 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-white outline-none max-h-[85dvh] overflow-y-auto"
        style={{ background: 'linear-gradient(180deg, #16203b 0%, #0b1124 100%)' }}
      >
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 id="panic-alerts-title" className="text-lg font-black tracking-tight">
            {alerts.length > 1 ? t('emergency.target.activeTitle') : t('emergency.target.endTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            aria-label={t('emergency.target.cancel')}
            className="inline-flex items-center justify-center w-11 h-11 rounded-xl text-white/75 hover:bg-white/10 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>

        {alerts.length === 0 ? (
          <p className="flex items-center gap-2 text-emerald-300 font-semibold py-4">
            <CheckCircle2 className="w-5 h-5" aria-hidden /> {t('emergency.panic.allClearTitle')}
          </p>
        ) : (
          <ul className="space-y-2 mb-4">
            {alerts.map((a) => {
              const on = selected !== null && keyOf(selected) === keyOf(a);
              return (
                <li key={keyOf(a)}>
                  <button
                    type="button"
                    onClick={() => { if (!sending) { stopHold(); setSelectedKey(keyOf(a)); setError(''); } }}
                    aria-pressed={on}
                    data-testid={`panic-alert-${keyOf(a)}`}
                    className="w-full min-h-[56px] px-4 py-2 rounded-xl border flex items-center gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                    style={{
                      background: on ? 'rgba(239,68,68,0.18)' : 'rgba(255,255,255,0.03)',
                      borderColor: on ? 'rgba(248,113,113,0.85)' : 'rgba(255,255,255,0.10)',
                    }}
                  >
                    <ShieldAlert className="w-5 h-5 shrink-0 text-red-300" aria-hidden />
                    <span className="flex-1 min-w-0 text-sm font-semibold">{labelOf(a)}</span>
                    {alerts.length > 1 && (
                      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-white/70">
                        {t('emergency.target.endAlert')}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {selected && (
          <div className="space-y-3">
            <p className="text-sm text-white/70">{t('emergency.target.endBody')}</p>
            {error && (
              <p role="alert" className="text-sm font-semibold text-red-100 rounded-xl border border-red-400/60 bg-red-900/50 p-3">
                {t('emergency.target.endFailed', { error })}
              </p>
            )}
            <button
              type="button"
              data-testid="panic-hold-to-end"
              aria-label={t('emergency.target.holdToEndAria', { label: labelOf(selected) })}
              disabled={sending}
              onPointerDown={(e) => {
                e.preventDefault();
                try { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* old WebView */ }
                startHold();
              }}
              onPointerUp={stopHold}
              onPointerCancel={stopHold}
              onBlur={stopHold}
              onKeyDown={(e) => {
                if (e.key !== ' ' && e.key !== 'Enter') return;
                if (e.repeat) return;
                e.preventDefault();
                startHold();
              }}
              onKeyUp={(e) => {
                if (e.key !== ' ' && e.key !== 'Enter') return;
                e.preventDefault();
                stopHold();
              }}
              onContextMenu={(e) => e.preventDefault()}
              className="relative w-full min-h-[64px] rounded-2xl overflow-hidden font-black uppercase tracking-wider text-sm text-white disabled:opacity-70 outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              style={{
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'none',
                background: 'linear-gradient(180deg, rgba(16,185,129,0.22) 0%, rgba(4,120,87,0.30) 100%)',
                border: '1px solid rgba(52,211,153,0.65)',
              }}
            >
              <span
                className="absolute top-0 bottom-0 left-0 bg-emerald-500/80 transition-[width] duration-75"
                style={{ width: `${holding ? progress : 0}%` }}
                aria-hidden
              />
              <span className="relative flex items-center justify-center gap-2">
                {sending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> {t('emergency.target.ending')}</>
                ) : (
                  t('emergency.target.holdToEnd')
                )}
              </span>
            </button>
            <p className="text-center text-xs text-white/55">{t('emergency.target.holdToEndHint')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
