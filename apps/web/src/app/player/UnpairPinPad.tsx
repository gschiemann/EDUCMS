'use client';

/**
 * The screen-PIN keypad for the on-screen Unpair (2026-11-09, player
 * stability gap 6). The state machine and the server decision live in
 * `unpairPin.ts` (pure, tested); this component only draws the pad and turns
 * keys into events — the same split, look and key rules as `RemoteDialog.tsx`
 * (apps/player/CLAUDE.md player rule 15):
 *
 *  - Remote: parked on "1" with the amber ring; arrows move it; OK presses the
 *    highlighted key. A HELD OK never presses (auto-repeat is swallowed).
 *  - USB keyboard: digits type, Backspace / Delete remove one, Enter submits
 *    (a typed digit parks the highlight on OK).
 *  - Back is NOT handled here: the page's Back authority (the APK's
 *    `edu-show-stop-overlay`, Escape / GoBack / Back) cancels the pad first,
 *    before its own menu toggle. A tap on the scrim is Back too.
 *  - The PIN is drawn as dots, never as digits.
 *
 * A CHILD of the paired card (never a portal), hidden in the same commit an
 * alert arrives. Inline styles, Chromium-83 safe: no `inset`, no flex `gap`,
 * never four sides in one style object, no `backdrop-filter`.
 */

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { KeyRound } from 'lucide-react';
import { isRemoteOkKey } from './remoteConfirm';
import { REMOTE_DIALOG_Z_INDEX } from './RemoteDialog';
import {
  PIN_PAD_CLOSED,
  PIN_PAD_KEYS,
  UNPAIR_PIN_MAX,
  UNPAIR_PIN_MIN,
  pinPadKeyFor,
  stepPinPad,
  type PinPadEvent,
  type PinPadState,
} from './unpairPin';

/** The machine for a component, like `useRemoteDialog`: `onSubmit` / `onCancel` run once per event that caused them. */
export function usePinPad(handlers: { onSubmit: (pin: string) => void; onCancel: () => void }) {
  const [state, setState] = useState<PinPadState>(PIN_PAD_CLOSED);
  const stateRef = useRef<PinPadState>(PIN_PAD_CLOSED);
  const handlersRef = useRef(handlers);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });
  const dispatch = useCallback((event: PinPadEvent) => {
    const step = stepPinPad(stateRef.current, event);
    if (step.state !== stateRef.current) {
      stateRef.current = step.state;
      setState(step.state);
    }
    if (step.submit !== null) handlersRef.current.onSubmit(step.submit);
    if (step.cancelled) handlersRef.current.onCancel();
  }, []);
  return { state, stateRef, dispatch } as const;
}

export interface PinPadCopy {
  title: string;
  body: string;
  hint: string;
  deleteLabel: string;
  okLabel: string;
  wrong: string;
  locked: string;
  unreachable: string;
  required: string;
  checking: string;
}

const K = 'var(--splash-k, 1)';
const k = (px: number) => `calc(${px}px * ${K})`;
const fluid = (px: number, min: number, perCanvasPx: number) =>
  `calc(min(${px}px, max(${min}px, calc(var(--led-w, 1920px) * ${perCanvasPx}))) * ${K})`;
const AMBER = '#fde047'; // the player's remote-focus colour (RemoteDialog, the Back menu)

function keyStyle(parked: boolean, accent: boolean): CSSProperties {
  return {
    width: fluid(96, 52, 0.16),
    height: fluid(64, 40, 0.11),
    margin: k(6),
    borderRadius: k(16),
    borderWidth: k(2),
    borderStyle: 'solid',
    fontSize: fluid(28, 16, 0.06),
    fontWeight: 800,
    lineHeight: 1,
    cursor: 'pointer',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
    transition: 'transform 120ms ease-out',
    WebkitTapHighlightColor: 'transparent',
    background: parked ? '#f8fafc' : accent ? '#334155' : '#1e293b',
    color: parked ? '#0f172a' : '#e2e8f0',
    borderColor: parked ? '#ffffff' : '#334155',
    outline: parked ? `${k(4)} solid ${AMBER}` : 'none',
    outlineOffset: parked ? k(3) : undefined,
    transform: parked ? 'scale(1.06)' : 'scale(1)',
  };
}

export interface UnpairPinPadProps {
  state: Extract<PinPadState, { open: true }>;
  copy: PinPadCopy;
  onEvent: (event: PinPadEvent) => void;
}

export function UnpairPinPad({ state, copy, onEvent }: UnpairPinPadProps) {
  const keyRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    const arrow =
      e.key === 'ArrowUp' || e.key === 'Up' ? 'up'
        : e.key === 'ArrowDown' || e.key === 'Down' ? 'down'
          : e.key === 'ArrowLeft' || e.key === 'Left' ? 'left'
            : e.key === 'ArrowRight' || e.key === 'Right' ? 'right' : null;
    if (arrow) {
      e.preventDefault();
      e.stopPropagation();
      onEvent({ type: 'move', direction: arrow });
      return;
    }
    const typed = pinPadKeyFor(e);
    if (typed) {
      e.preventDefault();
      e.stopPropagation();
      onEvent({ type: 'press', key: typed, typed: true });
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      onEvent({ type: 'move', direction: e.shiftKey ? 'left' : 'right' });
      return;
    }
    if (isRemoteOkKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      onEvent({ type: 'activate' });
    }
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => onKeyDown(e);
    const up = (e: KeyboardEvent) => {
      if (isRemoteOkKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
    };
  }, []);

  // DOM focus follows the highlight (screen readers; nothing behind the scrim keeps focus).
  const parkedKey = PIN_PAD_KEYS[state.row][state.col];
  useEffect(() => {
    const el = keyRefs.current[parkedKey];
    if (!el) return;
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  }, [parkedKey]);

  const message =
    state.busy ? copy.checking
      : state.message === 'wrong' ? copy.wrong
        : state.message === 'locked' ? copy.locked
          : state.message === 'unreachable' ? copy.unreachable
            : state.message === 'required' ? copy.required : '';
  const messageIsError = !state.busy && (state.message === 'wrong' || state.message === 'locked' || state.message === 'unreachable');

  const dots: string[] = [];
  for (let i = 0; i < Math.max(UNPAIR_PIN_MIN, state.digits.length); i++) dots.push(i < state.digits.length ? '●' : '○');

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      data-edu-unpair-pin=""
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onEvent({ type: 'back' });
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
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edu-unpair-pin-title"
        aria-describedby="edu-unpair-pin-body"
        style={{
          position: 'relative',
          width: k(560),
          maxWidth: '100%',
          maxHeight: '100%',
          boxSizing: 'border-box',
          overflow: 'auto',
          background: '#0f172a',
          color: '#f8fafc',
          border: `${k(1)} solid #334155`,
          borderRadius: k(28),
          padding: `${k(32)} min(${k(40)}, 6%) ${k(24)}`,
          boxShadow: `0 ${k(30)} ${k(90)} rgba(0, 0, 0, 0.65)`,
          textAlign: 'center',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: fluid(60, 40, 0.1),
            height: fluid(60, 40, 0.1),
            margin: '0 auto',
            borderRadius: k(18),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(244, 63, 94, 0.14)',
            border: `${k(1)} solid rgba(251, 113, 133, 0.35)`,
          }}
        >
          <KeyRound style={{ width: '50%', height: '50%', color: '#fb7185' }} />
        </div>
        <h2 id="edu-unpair-pin-title" style={{ margin: `${k(16)} 0 0`, fontSize: fluid(32, 20, 0.065), fontWeight: 800, lineHeight: 1.15 }}>
          {copy.title}
        </h2>
        <p id="edu-unpair-pin-body" style={{ margin: `${k(10)} auto 0`, maxWidth: '30em', fontSize: fluid(19, 13, 0.042), lineHeight: 1.4, color: '#cbd5e1' }}>
          {copy.body}
        </p>
        <div
          data-edu-unpair-pin-dots=""
          aria-label={`${state.digits.length} / ${UNPAIR_PIN_MAX}`}
          style={{ margin: `${k(18)} 0 0`, fontSize: fluid(30, 18, 0.06), letterSpacing: '0.3em', color: '#f8fafc' }}
        >
          {dots.join('')}
        </div>
        <p
          role="status"
          data-edu-unpair-pin-message={state.busy ? 'checking' : state.message}
          style={{ margin: `${k(8)} 0 0`, minHeight: '1.4em', fontSize: fluid(17, 12, 0.038), fontWeight: 700, color: messageIsError ? '#fda4af' : '#94a3b8' }}
        >
          {message}
        </p>
        <div style={{ margin: `${k(10)} 0 0` }}>
          {PIN_PAD_KEYS.map((row, r) => (
            <div key={r} style={{ display: 'flex', justifyContent: 'center' }}>
              {row.map((key, c) => {
                const parked = r === state.row && c === state.col;
                const label = key === '<' ? copy.deleteLabel : key === 'ok' ? copy.okLabel : key;
                return (
                  <button
                    key={key}
                    ref={(el) => { keyRefs.current[key] = el; }}
                    type="button"
                    data-pin-key={key}
                    data-remote-parked={parked ? 'true' : undefined}
                    aria-label={label}
                    disabled={state.busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      onEvent({ type: 'press', key });
                    }}
                    style={{ ...keyStyle(parked, key === '<' || key === 'ok'), fontSize: key.length > 1 || key === '<' ? fluid(18, 12, 0.04) : keyStyle(false, false).fontSize }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <p style={{ margin: `${k(14)} 0 0`, fontSize: fluid(14, 11, 0.032), fontWeight: 600, color: '#64748b' }}>{copy.hint}</p>
      </div>
    </div>
  );
}
