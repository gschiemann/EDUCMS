'use client';

/**
 * The player's own question dialog — remote-first (CLAUDE.md player rule 15).
 *
 * Replaces the dashboard's `appConfirm` / `appAlert` on the player glass
 * (2026-10-26 field find, see `remoteConfirm.ts` for the whole story). The
 * state machine decides; this component only draws it and turns keys into
 * events:
 *
 *  - It is a CHILD of the surface that opened it (the paired card), never a
 *    portal, so it cannot be drawn anywhere that surface is not. When it is
 *    unmounted while the machine still says "open", it reports
 *    `surface-closed` (deferred one task, so React StrictMode's dev-only
 *    unmount/remount does not close it).
 *  - The parked answer is drawn from STATE, not from CSS `:focus` /
 *    `:focus-visible`: a WebView that treats the opening OK as a tap would
 *    otherwise hide the highlight. DOM focus follows the state.
 *  - Arrows, Tab and OK are handled here, on window, in the capture phase,
 *    and never reach the menu underneath (no browser spatial navigation, no
 *    focus escaping behind the scrim). A HELD OK never answers: auto-repeat
 *    is swallowed, so the press that opened it cannot also confirm it.
 *  - Back is NOT handled here. The page's Back authority (the APK's
 *    `edu-show-stop-overlay` and the raw Escape / Backspace / GoBack / Back
 *    keys) sends `back` first, before its own menu toggle.
 *  - Tapping outside the card is Back.
 *
 * Inline styles only, Chromium-83 safe (NovaStar Taurus): no `inset`, two
 * physical sides plus a size (never four — CLAUDE.md #10), no flex `gap`, no
 * `backdrop-filter`, no `aspect-ratio`. Lengths scale with `--splash-k` (the
 * operator-glass factor) and shrink on a narrow LED canvas through `--led-w`.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Info, Power } from 'lucide-react';
import {
  REMOTE_DIALOG_CLOSED,
  isRemoteOkKey,
  remoteMoveForKey,
  stepRemoteDialog,
  type RemoteAnswer,
  type RemoteDialogEvent,
  type RemoteDialogKind,
  type RemoteDialogOutcome,
  type RemoteDialogState,
} from './remoteConfirm';

/**
 * The machine, held for a component: `state` to render, `stateRef` for event
 * handlers that must read it live (the page's Back authority runs in a
 * listener registered by an older render), and a stable `dispatch`.
 * `onAnswer` runs exactly once per question, on the event that closed it; it
 * is read through a ref, so it may be a new function every render.
 */
export function useRemoteDialog(onAnswer: (outcome: RemoteDialogOutcome) => void) {
  const [state, setState] = useState<RemoteDialogState>(REMOTE_DIALOG_CLOSED);
  const stateRef = useRef<RemoteDialogState>(REMOTE_DIALOG_CLOSED);
  const onAnswerRef = useRef(onAnswer);
  onAnswerRef.current = onAnswer;
  const dispatch = useCallback((event: RemoteDialogEvent) => {
    const step = stepRemoteDialog(stateRef.current, event);
    if (step.state === stateRef.current) return;
    stateRef.current = step.state;
    setState(step.state);
    if (step.outcome) onAnswerRef.current(step.outcome);
  }, []);
  return { state, stateRef, dispatch } as const;
}

export interface RemoteDialogCopy {
  title: string;
  body: string;
  /** The safe answer. The remote is parked on it when the dialog opens. */
  safeLabel: string;
  /** The destructive answer. Omit for a one-answer notice. */
  dangerLabel?: string;
  /** One line on how to drive it with a remote. */
  hint: string;
  tone: 'danger' | 'info';
}

/**
 * What each question says. English, like every other control on the Back
 * menu and the paired card (the player's operator chrome is not translated;
 * only the alert text is).
 */
export const REMOTE_DIALOG_COPY: Readonly<Record<RemoteDialogKind, RemoteDialogCopy>> = {
  unpair: {
    title: 'Unpair this screen?',
    body: 'This screen stops showing your content and needs a new pairing code from the dashboard to come back.',
    safeLabel: 'Keep paired',
    dangerLabel: 'Unpair',
    hint: 'Arrows to choose · OK to select · Back to cancel',
    tone: 'danger',
  },
  'nothing-to-play': {
    title: 'Nothing to play yet',
    body: 'No content is scheduled for this screen yet. Schedule a playlist from the dashboard, then choose Sync now.',
    safeLabel: 'OK',
    hint: 'OK or Back to close',
    tone: 'info',
  },
};

export interface RemoteDialogProps extends RemoteDialogCopy {
  /** Stable name for tests and diagnostics — `data-edu-remote-dialog`. */
  name: string;
  /** The answer the remote is parked on (from the state machine). */
  focus: RemoteAnswer;
  onEvent: (event: RemoteDialogEvent) => void;
}

/** Above the paired card's own chrome and the Back-key hint (9984); below
 *  the soft blank (9990), the connectivity toast and every emergency layer
 *  (9998 / 9999). An alert also closes it outright — this is the third line. */
export const REMOTE_DIALOG_Z_INDEX = 9987;

const K = 'var(--splash-k, 1)';
/** A length scaled for the glass it is on. */
const k = (px: number) => `calc(${px}px * ${K})`;
/** Same, but shrinks on a narrow LED canvas (a 320-wide poster). */
const fluid = (px: number, min: number, perCanvasPx: number) =>
  `calc(min(${px}px, max(${min}px, calc(var(--led-w, 1920px) * ${perCanvasPx}))) * ${K})`;

const AMBER = '#fde047'; // the player's remote-focus colour (the Back menu's outline)

function answerStyle(answer: RemoteAnswer, parked: boolean): CSSProperties {
  const danger = answer === 'danger';
  const base: CSSProperties = {
    margin: k(7),
    minWidth: `min(${k(210)}, 100%)`,
    padding: `${k(16)} ${k(30)}`,
    borderRadius: k(18),
    borderWidth: k(2),
    borderStyle: 'solid',
    fontSize: fluid(22, 15, 0.05),
    fontWeight: 800,
    lineHeight: 1.2,
    letterSpacing: '0.01em',
    cursor: 'pointer',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    // Physical properties only; transform lifts the parked answer, tvOS-style.
    transition: 'transform 140ms ease, background-color 140ms ease, color 140ms ease, box-shadow 140ms ease, border-color 140ms ease',
    WebkitTapHighlightColor: 'transparent',
  };
  if (!parked) {
    return {
      ...base,
      background: '#1e293b',
      color: danger ? '#fda4af' : '#e2e8f0',
      borderColor: danger ? '#7f1d1d' : '#334155',
      outline: 'none',
      transform: 'scale(1)',
      boxShadow: 'none',
    };
  }
  return {
    ...base,
    background: danger ? '#e11d48' : '#f8fafc',
    color: danger ? '#ffffff' : '#0f172a',
    borderColor: danger ? '#fb7185' : '#ffffff',
    // The loud part, readable from across the room: an amber ring OUTSIDE the
    // box (outline is never clipped and never moves the layout) + a lift.
    outline: `${k(4)} solid ${AMBER}`,
    outlineOffset: k(4),
    transform: 'scale(1.05)',
    boxShadow: `0 ${k(14)} ${k(36)} rgba(0, 0, 0, 0.55)`,
  };
}

export function RemoteDialog({
  name,
  title,
  body,
  safeLabel,
  dangerLabel,
  hint,
  tone,
  focus,
  onEvent,
}: RemoteDialogProps) {
  const safeRef = useRef<HTMLButtonElement | null>(null);
  const dangerRef = useRef<HTMLButtonElement | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const hasDanger = !!dangerLabel;
  const hasDangerRef = useRef(hasDanger);
  hasDangerRef.current = hasDanger;

  // Keys. Registered once per mount; reads the live props through refs.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const move = remoteMoveForKey(e.key);
      if (move) {
        e.preventDefault();
        e.stopPropagation();
        onEventRef.current({ type: 'move', direction: move });
        return;
      }
      if (e.key === 'Tab') {
        // A focus trap of two: Tab and Shift+Tab both flip between them.
        e.preventDefault();
        e.stopPropagation();
        if (hasDangerRef.current) {
          onEventRef.current({ type: 'move', direction: focusRef.current === 'safe' ? 'next' : 'prev' });
        }
        return;
      }
      if (isRemoteOkKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        // A held OK never answers — the press that opened the question
        // must not also answer it.
        if (e.repeat) return;
        onEventRef.current({ type: 'activate' });
      }
    };
    // Space activates a <button> on keyup; it was answered on keydown.
    const onKeyUp = (e: KeyboardEvent) => {
      if (isRemoteOkKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);

  // DOM focus follows the parked answer (screen readers, and nothing behind
  // the scrim keeps focus).
  useEffect(() => {
    const el = focus === 'danger' && dangerRef.current ? dangerRef.current : safeRef.current;
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  }, [focus]);

  // Never outlive the surface: an unmount while the machine still says
  // "open" is the surface going away. Deferred one task — StrictMode (dev)
  // unmounts and remounts the same instance synchronously, and the remount
  // flips `alive` back before this check runs.
  const aliveRef = useRef(false);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      setTimeout(() => {
        if (!aliveRef.current) onEventRef.current({ type: 'surface-closed' });
      }, 0);
    };
  }, []);

  const titleId = `edu-remote-dialog-${name}-title`;
  const bodyId = `edu-remote-dialog-${name}-body`;
  const accent = tone === 'danger' ? '#fb7185' : '#38bdf8';
  const Icon = tone === 'danger' ? Power : Info;

  return (
    // The scrim: covers the surface that opened the question. A tap on it is Back.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      data-edu-remote-dialog={name}
      onClick={(e) => {
        e.stopPropagation();
        onEventRef.current({ type: 'back' });
      }}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: REMOTE_DIALOG_Z_INDEX,
        background: 'rgba(2, 6, 23, 0.94)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: k(16),
        boxSizing: 'border-box',
        cursor: 'default',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <style>{`
        @keyframes edu-remote-dialog-in {
          from { opacity: 0; transform: translateY(14px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-edu-remote-dialog-card] { animation: none !important; }
          [data-edu-remote-dialog] button { transition: none !important; }
        }
      `}</style>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-edu-remote-dialog-card=""
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          width: k(640),
          maxWidth: '100%',
          maxHeight: '100%',
          boxSizing: 'border-box',
          overflow: 'hidden',
          background: '#0f172a',
          color: '#f8fafc',
          border: `${k(1)} solid #334155`,
          borderRadius: k(28),
          padding: `${k(40)} min(${k(48)}, 6%) ${k(30)}`,
          boxShadow: `0 ${k(30)} ${k(90)} rgba(0, 0, 0, 0.65)`,
          textAlign: 'center',
          animation: 'edu-remote-dialog-in 180ms ease-out',
        }}
      >
        {/* Accent rail — the tone, readable at a glance. */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: k(5),
            background: `linear-gradient(90deg, transparent 0%, ${accent} 30%, ${accent} 70%, transparent 100%)`,
          }}
        />
        <div
          aria-hidden="true"
          style={{
            width: fluid(72, 48, 0.12),
            height: fluid(72, 48, 0.12),
            margin: '0 auto',
            borderRadius: k(22),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: tone === 'danger' ? 'rgba(244, 63, 94, 0.14)' : 'rgba(56, 189, 248, 0.14)',
            border: `${k(1)} solid ${tone === 'danger' ? 'rgba(251, 113, 133, 0.35)' : 'rgba(125, 211, 252, 0.35)'}`,
          }}
        >
          <Icon style={{ width: '50%', height: '50%', color: accent }} />
        </div>
        <h2
          id={titleId}
          style={{
            margin: `${k(22)} 0 0`,
            fontSize: fluid(36, 21, 0.07),
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: '-0.01em',
            color: '#f8fafc',
          }}
        >
          {title}
        </h2>
        <p
          id={bodyId}
          style={{
            margin: `${k(14)} auto 0`,
            maxWidth: '30em',
            fontSize: fluid(21, 14, 0.045),
            fontWeight: 500,
            lineHeight: 1.45,
            color: '#cbd5e1',
          }}
        >
          {body}
        </p>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'center',
            margin: `${k(26)} ${k(-7)} 0`,
          }}
        >
          <button
            ref={safeRef}
            type="button"
            data-remote-answer="safe"
            data-remote-parked={focus === 'safe' ? 'true' : undefined}
            onFocus={() => onEventRef.current({ type: 'focus', answer: 'safe' })}
            onClick={(e) => {
              e.stopPropagation();
              onEventRef.current({ type: 'choose', answer: 'safe' });
            }}
            style={answerStyle('safe', focus === 'safe')}
          >
            {safeLabel}
          </button>
          {hasDanger ? (
            <button
              ref={dangerRef}
              type="button"
              data-remote-answer="danger"
              data-remote-parked={focus === 'danger' ? 'true' : undefined}
              onFocus={() => onEventRef.current({ type: 'focus', answer: 'danger' })}
              onClick={(e) => {
                e.stopPropagation();
                onEventRef.current({ type: 'choose', answer: 'danger' });
              }}
              style={answerStyle('danger', focus === 'danger')}
            >
              {dangerLabel}
            </button>
          ) : null}
        </div>
        <p
          style={{
            margin: `${k(22)} 0 0`,
            fontSize: fluid(15, 11, 0.034),
            fontWeight: 600,
            letterSpacing: '0.02em',
            color: '#64748b',
          }}
        >
          {hint}
        </p>
      </div>
    </div>
  );
}
