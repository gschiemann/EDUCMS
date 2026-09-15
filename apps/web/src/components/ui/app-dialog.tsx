"use client";

/**
 * App-themed Confirm / Alert / Prompt dialogs.
 *
 * Replaces native window.confirm/alert/prompt with a styled, accessible
 * modal. Use the imperative helpers from anywhere in the app:
 *
 *   import { appConfirm, appAlert, appPrompt } from '@/components/ui/app-dialog';
 *
 *   if (await appConfirm({ title: 'Delete?', message: '...', danger: true })) {
 *     // do it
 *   }
 *
 * <AppDialogHost /> must be mounted exactly once at the app root.
 */

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useOverlayLock } from '@/hooks/use-overlay-lock';

type DialogTone = 'default' | 'danger' | 'warn' | 'info';

interface BaseRequest {
  id: number;
  title?: string;
  message: string;
  tone?: DialogTone;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ConfirmRequest extends BaseRequest {
  kind: 'confirm';
  resolve: (ok: boolean) => void;
}
interface AlertRequest extends BaseRequest {
  kind: 'alert';
  resolve: (ok: true) => void;
}
interface PromptRequest extends BaseRequest {
  kind: 'prompt';
  defaultValue?: string;
  placeholder?: string;
  resolve: (value: string | null) => void;
}

type DialogRequest = ConfirmRequest | AlertRequest | PromptRequest;

// ─── Singleton subscriber registry ───────────────────────────────────
type Listener = (req: DialogRequest | null) => void;
let queue: DialogRequest[] = [];
const listeners = new Set<Listener>();
let nextId = 1;

function notify() {
  const top = queue[0] || null;
  listeners.forEach(l => l(top));
}

function push(req: Omit<DialogRequest, 'id'>): DialogRequest {
  const full = { ...req, id: nextId++ } as DialogRequest;
  queue.push(full);
  notify();
  return full;
}

function dismiss(id: number) {
  queue = queue.filter(r => r.id !== id);
  notify();
}

// ─── Imperative API ──────────────────────────────────────────────────

export function appConfirm(opts: {
  title?: string;
  message: string;
  tone?: DialogTone;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<boolean> {
  return new Promise(resolve => {
    push({
      kind: 'confirm',
      title: opts.title,
      message: opts.message,
      tone: opts.tone || 'default',
      confirmLabel: opts.confirmLabel,
      cancelLabel: opts.cancelLabel,
      resolve,
    } as Omit<ConfirmRequest, 'id'>);
  });
}

export function appAlert(opts: {
  title?: string;
  message: string;
  tone?: DialogTone;
  confirmLabel?: string;
}): Promise<true> {
  return new Promise(resolve => {
    push({
      kind: 'alert',
      title: opts.title,
      message: opts.message,
      tone: opts.tone || 'info',
      confirmLabel: opts.confirmLabel,
      resolve,
    } as Omit<AlertRequest, 'id'>);
  });
}

export function appPrompt(opts: {
  title?: string;
  message: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<string | null> {
  return new Promise(resolve => {
    push({
      kind: 'prompt',
      title: opts.title,
      message: opts.message,
      defaultValue: opts.defaultValue,
      placeholder: opts.placeholder,
      confirmLabel: opts.confirmLabel,
      cancelLabel: opts.cancelLabel,
      resolve,
    } as Omit<PromptRequest, 'id'>);
  });
}

// ─── Host component ──────────────────────────────────────────────────

/** Footer button base: one size for Cancel and Confirm (see the footer note). */
const DIALOG_BTN =
  'w-full min-w-[7.5rem] px-4 py-3 md:py-2 rounded-lg text-sm font-bold text-center transition-colors outline-none focus:ring-2 focus:ring-offset-2 [&:focus:not(:focus-visible)]:ring-0 [&:focus:not(:focus-visible)]:ring-offset-0';

const TONE_STYLES: Record<DialogTone, { ring: string; icon: any; iconColor: string; confirmBtn: string }> = {
  default: { ring: 'ring-indigo-200',  icon: Info,          iconColor: 'text-indigo-500',  confirmBtn: 'bg-indigo-600 hover:bg-indigo-700' },
  danger:  { ring: 'ring-rose-200',    icon: AlertCircle,   iconColor: 'text-rose-500',    confirmBtn: 'bg-rose-600 hover:bg-rose-700' },
  warn:    { ring: 'ring-amber-200',   icon: AlertTriangle, iconColor: 'text-amber-500',   confirmBtn: 'bg-amber-600 hover:bg-amber-700' },
  info:    { ring: 'ring-sky-200',     icon: Info,          iconColor: 'text-sky-500',     confirmBtn: 'bg-sky-600 hover:bg-sky-700' },
};

// Focusable-element query used by the Tab trap below. Mirrors the standard
// "inert modal" selector set (buttons, links, form controls, explicit
// tabindex) minus anything explicitly removed from the tab order.
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null, // skip hidden elements
  );
}

export function AppDialogHost() {
  const [current, setCurrent] = useState<DialogRequest | null>(null);
  const [promptValue, setPromptValue] = useState('');
  // Hide the mobile tab bar while a confirm/alert/prompt is up so its
  // bottom-anchored (mobile: full-width, thumb-reach) footer buttons clear
  // the tab bar. AppDialogHost is always mounted, so gate on `current`.
  useOverlayLock(!!current);
  // 2026-05-13 — refs for the confirm row buttons so TV-remote arrow
  // keys can move focus between Cancel and Confirm. Operator hit this:
  // "the remote control works on the standard splash screen but when
  // i select unpair and the window pops up to cancel or unpair, the
  // remote doesnt move around and highlight ones of the buttons."
  // Android-TV / kiosk remote D-pad sends arrow-key events, not Tab,
  // so the browser's default Tab traversal never gets a chance.
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  // Container ref for the Tab focus trap (a11y wave, 2026-08-24) — scopes
  // the "what's focusable right now" query to just this dialog's DOM.
  const dialogRef = useRef<HTMLDivElement>(null);
  // The element that had focus immediately before this dialog (or the
  // first dialog in a queued chain) opened. Restored on close so keyboard
  // users land back where they were instead of at document.body.
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const l: Listener = (req) => {
      setCurrent(req);
      if (req?.kind === 'prompt') setPromptValue(req.defaultValue || '');
    };
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  useEffect(() => {
    if (!current) {
      // Queue fully drained — return focus to whatever invoked the
      // (first) dialog in the chain. Guard .isConnected in case the
      // invoking element was removed from the DOM while the dialog was
      // open (e.g. the row it lived in got deleted).
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus();
      }
      previousFocusRef.current = null;
      return;
    }
    // Capture the pre-dialog focus target ONCE per queued sequence. If a
    // second dialog is already queued behind this one, `current` jumps
    // straight from request A to request B without ever passing through
    // null (see `notify()`/`dismiss()` above) — don't clobber the
    // ORIGINAL invoker with the just-closed dialog's own Confirm button.
    if (!previousFocusRef.current) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
    }
    // Set initial focus on the confirm (or sole alert) button. Doing
    // this in an effect rather than autoFocus so we own the focus
    // lifecycle — the arrow-key handler below moves it between
    // Cancel and Confirm, and autoFocus would race the first paint.
    // requestAnimationFrame defers until after layout so the ref is
    // populated and the button is actually visible.
    //
    // EXCEPTION (a11y, Media Library v1 handoff §21): a DESTRUCTIVE
    // confirmation parks on Cancel instead. A keyboard/D-pad operator who
    // hits Enter on reflex should not have deleted live signage; every
    // other tone keeps the fast path on Confirm.
    const initial =
      current.kind === 'confirm' && current.tone === 'danger'
        ? cancelBtnRef.current || confirmBtnRef.current
        : confirmBtnRef.current;
    requestAnimationFrame(() => { (initial || confirmBtnRef.current)?.focus(); });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (current.kind === 'confirm') (current as ConfirmRequest).resolve(false);
        else if (current.kind === 'prompt') (current as PromptRequest).resolve(null);
        else (current as AlertRequest).resolve(true);
        dismiss(current.id);
        return;
      }
      if (e.key === 'Enter' && current.kind !== 'prompt') {
        // Enter activates whatever button currently has focus. Falls
        // back to confirm if focus isn't on a tracked button (e.g.
        // first-render Enter before the user has navigated).
        const focused = document.activeElement;
        if (focused === cancelBtnRef.current) {
          if (current.kind === 'confirm') (current as ConfirmRequest).resolve(false);
          else (current as AlertRequest).resolve(true);
        } else {
          if (current.kind === 'confirm') (current as ConfirmRequest).resolve(true);
          else (current as AlertRequest).resolve(true);
        }
        dismiss(current.id);
        return;
      }
      // Universal Tab focus trap (a11y wave, 2026-08-24/25) — wraps Tab/
      // Shift+Tab within the dialog's own real focusable elements
      // (close-X, [prompt's text input], Cancel, Confirm) for EVERY
      // dialog kind, confirm included. Runs before the D-pad handler below
      // so Tab always gets proper first<->last wraparound.
      //
      // 2026-08-25 — this used to be alert/prompt-only ('confirm' handled
      // Tab itself, below, as part of its 2-way arrow-key toggle). That
      // meant a confirm dialog's close-X — a real, visible, focusable
      // <button> — was never reachable by Tab: the old confirm-branch
      // toggled ONLY between Cancel and Confirm, so a keyboard user could
      // never Tab to close-X (mouse click was the only way in). Browser-
      // tested via app-dialog.focustrap.test.tsx, which caught it: Tab
      // from Confirm (last) landed back on Cancel instead of wrapping to
      // close-X (first). Hoisting the trap to run for every kind fixes
      // that; the D-pad arrow-key toggle below is UNCHANGED (still
      // confirm-only, still Cancel<->Confirm) so the TV-remote UX this
      // file's other comments describe keeps working exactly as before.
      if (e.key === 'Tab') {
        if (!dialogRef.current) return;
        const focusable = getFocusable(dialogRef.current);
        if (focusable.length === 0) return;
        e.preventDefault();
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement as HTMLElement | null;
        const idx = active ? focusable.indexOf(active) : -1;
        if (e.shiftKey) {
          (idx <= 0 ? last : focusable[idx - 1]).focus();
        } else {
          (idx === -1 || idx === focusable.length - 1 ? first : focusable[idx + 1]).focus();
        }
        return;
      }
      if (current.kind !== 'confirm') return; // arrow-key D-pad is confirm-only
      // D-pad arrow navigation between the two confirm-row buttons.
      // Operator (2026-05-13): "unpair and the remote isnt working on
      // that section still". TV remotes / Android signage boxes emit
      // arrow-key codes for "next/previous" D-pad presses. Tab is handled
      // by the universal trap above (2026-08-25) — this stays arrow-
      // keys-only so it never fights that trap.
      const isNext = e.key === 'ArrowRight' || e.key === 'ArrowDown';
      const isPrev = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
      if (!isNext && !isPrev) return;
      e.preventDefault();
      e.stopPropagation();
      const focused = document.activeElement;
      // Toggle between the two buttons. If focus is somewhere else
      // (e.g. document.body after a touchend), land on Confirm so the
      // hero default is what the operator sees.
      if (isNext) {
        if (focused === cancelBtnRef.current) confirmBtnRef.current?.focus();
        else cancelBtnRef.current?.focus();
      } else {
        if (focused === confirmBtnRef.current) cancelBtnRef.current?.focus();
        else confirmBtnRef.current?.focus();
      }
    };
    // Capture phase so we run BEFORE any other player-level keydown
    // listener (the playback overlay's Escape→show-stop handler uses
    // capture too — if we don't, the dialog Escape fires twice and
    // re-opens the stop overlay underneath our just-closed dialog).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [current]);

  if (!current) return null;

  const tone = TONE_STYLES[current.tone || 'default'];
  const Icon = tone.icon;

  const close = (result: any) => {
    (current as any).resolve(result);
    dismiss(current.id);
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-dialog-title"
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 animate-in fade-in duration-150"
    >
      {/* Backdrop — mouse-only "click outside to close" convenience.
          Escape (handled above, all 3 kinds) and the visible Close-X
          (confirm/prompt kinds) are the real keyboard/AT-accessible
          dismissal paths; making this div itself focusable would insert
          an invisible full-viewport tab stop ahead of the dialog's own
          controls. a11y wave (2026-08-24). */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={() => current.kind !== 'alert' && close(current.kind === 'prompt' ? null : false)}
      />

      {/* Modal card. 2026-05-14 — mobile sizing: pb-safe so iOS home
          indicator doesn't crowd the footer buttons. The card itself
          stays max-w-md, the parent's p-4 already gives screen-edge
          margin. */}
      <div className={`relative bg-white rounded-2xl shadow-2xl ring-1 ${tone.ring} max-w-md w-full overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-2 duration-200 pb-[env(safe-area-inset-bottom)]`}>
        {/* Close x — bigger tap target on mobile (44×44 iOS guideline) */}
        {current.kind !== 'alert' && (
          <button
            onClick={() => close(current.kind === 'prompt' ? null : false)}
            aria-label="Cancel"
            className="absolute top-2 right-2 md:top-3 md:right-3 w-11 h-11 md:w-8 md:h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            <X className="w-5 h-5 md:w-4 md:h-4" aria-hidden />
          </button>
        )}

        {/* Body */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-start gap-4">
            <div className={`shrink-0 w-10 h-10 rounded-xl bg-${(current.tone || 'default') === 'default' ? 'indigo' : current.tone}-50 flex items-center justify-center`}>
              <Icon className={`w-5 h-5 ${tone.iconColor}`} aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              {current.title && (
                <h2 id="app-dialog-title" className="text-base font-bold text-slate-900 mb-1.5">
                  {current.title}
                </h2>
              )}
              <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{current.message}</p>
              {current.kind === 'prompt' && (
                <input
                  type="text"
                  autoFocus
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); close(promptValue); }
                  }}
                  placeholder={(current as PromptRequest).placeholder}
                  className="mt-3 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
                />
              )}
            </div>
          </div>
        </div>

        {/* Footer actions. Refs wired so the keydown handler above can
            move focus between Cancel and Confirm on D-pad arrow keys.
            Focus styles deliberately LOUD: a 4-px indigo ring + an
            extra outline so the highlighted button is obvious from
            across a room — operator on a TV install reported the
            previous 2-px ring was invisible at distance. */}
        {/* Footer actions. Mobile: stacked (reversed column, thumb-reach).
            Desktop: an inline grid whose columns all take the widest
            button's width, so Cancel and Confirm are always the SAME size
            (2026-09-14, Greg: "make cancel and delete not so huge and the
            same size" — the old focus:scale-105 + ring-4 made whichever
            button held focus a different size from its neighbour).

            Focus highlight: `focus:ring-2` is the base, and
            `[&:focus:not(:focus-visible)]:ring-0` removes it for MOUSE-driven
            focus (including the programmatic parking on open after a click).
            Keyboard / D-pad focus keeps it. Engines without :focus-visible
            (Chromium < 86 — the oldest Taurus units the player layout
            serves) drop that `:not()` rule entirely and keep the plain focus
            ring, so the 2026-05-13 remote-highlight contract still holds. */}
        <div className="px-4 md:px-6 pb-5 pt-2 bg-slate-50/40">
          <div className="flex flex-col-reverse gap-2 md:grid md:grid-flow-col md:auto-cols-fr md:w-max md:ml-auto">
          {current.kind !== 'alert' && (
            <button
              ref={cancelBtnRef}
              type="button"
              tabIndex={0}
              onClick={() => close(current.kind === 'prompt' ? null : false)}
              className={`${DIALOG_BTN} text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 active:bg-slate-100 focus:ring-indigo-500`}
            >
              {current.cancelLabel || 'Cancel'}
            </button>
          )}
          <button
            ref={confirmBtnRef}
            type="button"
            tabIndex={0}
            onClick={() => close(current.kind === 'prompt' ? promptValue : true)}
            className={`${DIALOG_BTN} text-white focus:ring-indigo-300 ${tone.confirmBtn}`}
          >
            {current.confirmLabel || (current.kind === 'alert' ? 'OK' : current.kind === 'prompt' ? 'Submit' : 'Confirm')}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}
