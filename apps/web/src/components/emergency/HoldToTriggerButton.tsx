"use client";

/**
 * The 3-second hold-to-trigger button (CLAUDE.md "Emergency System → Key
 * Safeguards #5").
 *
 * This is the Broadcast page's hold control, lifted out unchanged in behaviour
 * so the Custom message card (2026-10-26) sends with EXACTLY the gesture the
 * operator already knows — on a phone, a laptop and a keyboard alike:
 *
 *   • press and hold (touch or mouse) for 3 seconds; letting go early cancels;
 *   • Space / Enter held on the focused button does the same (WCAG 2.1.1) — key
 *     repeat is squelched so holding the key does not restart the timer ~30×/s;
 *   • pointer capture pins the gesture to this button, so a finger drifting off
 *     the edge does not cancel a deliberate hold (the 2026-05-23 /panic audit);
 *   • the surface decides WHAT is announced: every start / cancel / completion
 *     goes through the callbacks, and the page's `useEmergencyAnnouncer` live
 *     region (+ opt-in speech) speaks it — same aria-live announcements as the
 *     Broadcast console had.
 *
 * It owns nothing about what is being sent. `onComplete` fires ONCE after a
 * full hold; the caller sets `busy` while the request is in flight.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Send } from 'lucide-react';

/** The hold the product requires. Do not shorten (BUG-001, 2026-05-03). */
export const HOLD_TO_TRIGGER_MS = 3000;

export interface HoldToTriggerButtonProps {
  /** Resting label — "Hold 3 seconds to send". */
  label: string;
  /** Label while the hold is in progress. */
  holdingLabel: (pct: number) => string;
  /** The control's spoken name — states the 3-second hold for a screen reader. */
  ariaLabel: string;
  /** Label while the request is in flight. */
  busyLabel: string;
  /**
   * May a hold START? Return false (after telling the operator why) to refuse
   * — e.g. an empty message. Called when the press begins, never mid-hold.
   */
  canStart?: () => boolean;
  /** The hold began (announce it). */
  onHoldStart?: () => void;
  /** The hold was let go early (announce it). */
  onHoldCancel?: () => void;
  /** A full hold completed. */
  onComplete: () => void;
  /** A request is in flight: the control shows `busyLabel` and ignores presses. */
  busy?: boolean;
  disabled?: boolean;
  /** Colour family: Info is amber, Critical is red. */
  tone?: 'info' | 'critical';
  holdMs?: number;
  testId?: string;
}

const TONES = {
  info: { accent: '#f59e0b', dark: '#b45309', rgb: '245,158,11' },
  critical: { accent: '#ef4444', dark: '#b91c1c', rgb: '239,68,68' },
} as const;

export function HoldToTriggerButton({
  label,
  holdingLabel,
  ariaLabel,
  busyLabel,
  canStart,
  onHoldStart,
  onHoldCancel,
  onComplete,
  busy = false,
  disabled = false,
  tone = 'critical',
  holdMs = HOLD_TO_TRIGGER_MS,
  testId,
}: HoldToTriggerButtonProps) {
  const [holding, setHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // The latest callbacks, so a long hold never completes into a stale closure.
  const completeRef = useRef(onComplete);
  const cancelRef = useRef(onHoldCancel);
  useEffect(() => {
    completeRef.current = onComplete;
    cancelRef.current = onHoldCancel;
  });

  const clearTimers = useCallback(() => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    if (progressTimer.current) { clearInterval(progressTimer.current); progressTimer.current = null; }
  }, []);
  // Leaving the page mid-hold must never send.
  useEffect(() => clearTimers, [clearTimers]);

  const cancel = useCallback(() => {
    const wasHolding = holdTimer.current !== null;
    clearTimers();
    setHolding(false);
    setProgress(0);
    if (wasHolding) cancelRef.current?.();
  }, [clearTimers]);

  const start = useCallback(() => {
    if (busy || disabled || holdTimer.current) return;
    if (canStart && !canStart()) return;
    setHolding(true);
    setProgress(0);
    onHoldStart?.();
    const began = performance.now();
    progressTimer.current = setInterval(() => {
      setProgress(Math.min(((performance.now() - began) / holdMs) * 100, 100));
    }, 50);
    holdTimer.current = setTimeout(() => {
      clearTimers();
      setHolding(false);
      setProgress(0);
      completeRef.current();
    }, holdMs);
  }, [busy, disabled, canStart, onHoldStart, holdMs, clearTimers]);

  const palette = TONES[tone];
  const pct = Math.floor(progress);

  return (
    <button
      type="button"
      data-testid={testId}
      data-holding={holding ? 'true' : undefined}
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
      disabled={disabled}
      onPointerDown={(e) => {
        e.preventDefault();
        // Pin the gesture to THIS button: finger drift must not cancel a
        // deliberate 3-second hold. Older WebViews may not implement capture;
        // pointerup / pointercancel still end the hold cleanly.
        try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* no capture here */ }
        start();
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onBlur={cancel}
      onKeyDown={(e) => {
        if (e.key !== ' ' && e.key !== 'Enter') return;
        if (e.repeat) return;
        e.preventDefault();
        start();
      }}
      onKeyUp={(e) => {
        if (e.key !== ' ' && e.key !== 'Enter') return;
        e.preventDefault();
        cancel();
      }}
      onContextMenu={(e) => e.preventDefault()}
      className="relative w-full min-h-[64px] rounded-2xl overflow-hidden select-none text-white font-black uppercase tracking-[0.14em] text-[13px] outline-none transition-transform duration-150 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-45"
      style={{
        WebkitTapHighlightColor: 'transparent',
        WebkitTouchCallout: 'none',
        touchAction: 'none',
        background: 'linear-gradient(180deg, rgba(24,31,52,0.96) 0%, rgba(12,17,30,0.98) 100%)',
        border: `1px solid rgba(${palette.rgb},${holding ? 0.95 : 0.5})`,
        boxShadow: holding
          ? `0 0 34px rgba(${palette.rgb},0.45), inset 0 1px 0 rgba(255,255,255,0.06)`
          : `0 0 0 1px rgba(${palette.rgb},0.12), 0 10px 26px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      {/* The fill: grows left to right over the 3 seconds. */}
      <span
        aria-hidden
        className="absolute top-0 bottom-0 left-0"
        style={{
          width: `${progress}%`,
          background: `linear-gradient(90deg, ${palette.dark} 0%, ${palette.accent} 100%)`,
          opacity: holding ? 0.9 : 0,
          transition: holding ? 'none' : 'opacity 150ms ease',
        }}
      />
      <span className="relative flex items-center justify-center px-4">
        {busy ? (
          <Loader2 className="w-5 h-5 mr-2.5 animate-spin" aria-hidden />
        ) : (
          <Send className="w-5 h-5 mr-2.5" aria-hidden style={{ color: holding ? '#fff' : palette.accent }} />
        )}
        <span>{busy ? busyLabel : holding ? holdingLabel(pct) : label}</span>
      </span>
    </button>
  );
}
