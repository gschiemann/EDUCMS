"use client";

import { useAppStore } from '@/lib/store';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { allClearEmergency } from '@/actions/trigger-emergency';
import { useOverlayLock } from '@/hooks/use-overlay-lock';

export function EmergencyOverlay() {
  // P0-10 (mobile-UX audit 2026-05-29) — LIFE-SAFETY. The fixed
  // MobileTabBar (z-60) rendered tappable OVER this overlay (z-50 inside a
  // relative dashboard container), so a user could navigate AWAY from the
  // all-clear screen mid-incident. Registering the overlay with the global
  // overlay lock bumps `overlayOpenCount`, which makes MobileTabBar.isHidden
  // true and unmounts the tab bar entirely while the emergency overlay is up
  // — so the all-clear control owns the screen. (Paired with the z-[60] bump
  // on the overlay root below as defense-in-depth.) This touches ONLY
  // overlay layering — no trigger / broadcast / all-clear / audit logic.
  useOverlayLock();
  const setEmergencyActive = useAppStore((state) => state.setEmergencyActive);
  const user = useAppStore((state) => state.user);
  const token = useAppStore((state) => state.token);
  // 2026-05-23 audit P2 #3 — pass the active overrideId back to the
  // all-clear so the AuditLog can pair trigger+clear events. The
  // EmergencyTriggerModal puts the overrideId into the store on
  // successful broadcast; previously this component minted a
  // synthetic `clear_<uuid>` every time and the chain was broken.
  const activeOverrideId = useAppStore((state) => state.activeEmergencyOverrideId);
  const [confirmKey, setConfirmKey] = useState('');
  const [isPending, startTransition] = useTransition();

  // A11y audit 2026-05-12 — the takeover overlay was a bare <div> that
  // never told assistive tech "this is a blocking dialog" and let Tab
  // wander into the disabled main content underneath. role="alertdialog"
  // + focus-on-mount + focus-trap fixes both. We deliberately do NOT
  // bind Esc here: an emergency overlay must be dismissed via the
  // explicit "type CLEAR" gate, not a stray keystroke.
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Focus the "type CLEAR" field on mount so an SR/keyboard operator
    // lands directly on the interactive element. Sighted operators
    // can still click the rest of the overlay.
    inputRef.current?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const root = overlayRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'input, button, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, []);

  const handleAllClear = () => {
    if (confirmKey === 'CLEAR') {
      startTransition(async () => {
        try {
          await allClearEmergency({
            schoolId: user?.tenantId || 'global',
            token: token || undefined,
            // 2026-05-23 audit P2 #3 — forward the active overrideId
            // so this all-clear pairs with the original trigger event
            // in the AuditLog. Falls through to the action's
            // `clear_<uuid>` mint if undefined (concurrent-clear case).
            overrideId: activeOverrideId || undefined,
          });
          setEmergencyActive(false);
        } catch (e) {
          console.error("Failed to clear emergency", e);
          // Retry later or handle error UI
        }
      });
    }
  };

  return (
    <div
      ref={overlayRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="emergency-overlay-title"
      aria-describedby="emergency-overlay-desc"
      // A11y audit (2026-05-25): mirror the player overlay's
      // role="alert" + aria-live="assertive" pattern (see
      // apps/web/src/components/player/EmergencyOverlay.tsx). The
      // dashboard overlay already declared alertdialog which is great
      // for modal semantics but does NOT itself trigger an SR
      // announcement when the overlay mounts. Adding role="alert" on
      // a nested wrapper + aria-live="assertive" + aria-atomic ensures
      // the SR speaks the title+desc the moment the overlay appears
      // (which is exactly the life-safety moment we need it to).
      // z-[60] (was z-50): defense-in-depth alongside useOverlayLock() above
      // so the overlay is never painted under the fixed MobileTabBar (z-[60])
      // even on a frame before the tab bar unmounts. Life-safety: the
      // all-clear control must always own the screen during an active
      // emergency (mobile-UX audit P0-10, 2026-05-29).
      // 2026-06-27 (LANE 1 life-safety) — added `overflow-y-auto` so the
      // all-clear control is ALWAYS reachable. The overlay centers its content
      // with `items-center`; on a short viewport (a phone in landscape, a
      // small browser window) the stacked content — icon + title + desc + the
      // tall "type CLEAR" card — exceeded the viewport and, with no scroll, the
      // input + Terminate button were pushed off-screen, leaving the operator
      // unable to clear the emergency. `overflow-y-auto` lets it scroll; the
      // `my-auto` on the inner block keeps it centered when it DOES fit.
      // (Dashboard surface, not a Taurus player — inset-0 / blur are fine here.)
      className="absolute inset-0 z-[60] flex items-center justify-center p-6 overflow-y-auto bg-red-950/90 backdrop-blur-3xl border-8 border-red-500 transition-all duration-300"
    >
      {/* Inner alert region — announces the title + description on mount.
          The outer alertdialog handles focus + modal semantics; this
          inner role="alert" handles the live announcement. Per WAI-ARIA
          authoring practices, alertdialog is for confirmation prompts
          and does not imply aria-live="assertive". */}
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="sr-only"
      >
        Emergency active. All screens are currently locked and displaying the
        emergency override broadcast. Normal scheduling is suspended. To restore
        normal screen scheduling, type CLEAR and authorize the all-clear signal.
      </div>
      {/* Flashing global indicator — clamped by the
          @media (prefers-reduced-motion: reduce) rule in globals.css
          so users with vestibular / photosensitive sensitivity
          don't see sustained pulsing red. The static border + the
          word "EMERGENCY ACTIVE" + the unmissable contrast still
          convey severity without motion. */}
      <div className="absolute inset-x-0 top-0 h-2 bg-red-500 animate-pulse" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 h-2 bg-red-500 animate-pulse" aria-hidden />
      
      <div className="max-w-2xl w-full my-auto flex flex-col items-center justify-center text-center space-y-8 animate-in zoom-in-95 duration-500">
        <div className="w-32 h-32 rounded-full bg-red-500/20 flex items-center justify-center animate-pulse">
          <AlertTriangle className="w-16 h-16 text-red-500" />
        </div>

        <div className="space-y-4">
          <h1 id="emergency-overlay-title" className="text-5xl font-black tracking-tighter text-white">EMERGENCY ACTIVE</h1>
          <p id="emergency-overlay-desc" className="text-xl text-red-200 mt-2 font-medium">
            All screens are currently locked and displaying the emergency override broadcast. Normal scheduling is suspended.
          </p>
        </div>

        <div className="w-full max-w-md bg-black/40 backdrop-blur-md rounded-xl p-8 border border-red-500/30 mt-8 space-y-6">
          <div>
            <label htmlFor="all-clear-input" className="block text-sm font-bold uppercase tracking-wider text-red-400 mb-2">
              All-Clear Authorization
            </label>
            <p className="text-sm text-red-200 mb-4 opacity-80">
              To restore normal screen scheduling, type <strong>CLEAR</strong> and authorize the all-clear signal.
            </p>
            <input
              ref={inputRef}
              id="all-clear-input"
              type="text"
              value={confirmKey}
              onChange={(e) => setConfirmKey(e.target.value.toUpperCase())}
              placeholder="Type CLEAR"
              className="w-full px-4 py-3 bg-black/50 border border-red-500/30 rounded-lg text-white font-mono text-center tracking-[0.5em] focus:ring-2 focus:ring-red-500 outline-none uppercase"
            />
          </div>

          <button
            onClick={handleAllClear}
            disabled={confirmKey !== 'CLEAR' || isPending}
            className="w-full py-4 px-6 bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:hover:bg-red-600 text-white font-bold rounded-lg shadow-xl hover:shadow-red-500/20 transition-all flex justify-center items-center gap-2"
          >
            {isPending ? (
              <span className="flex items-center gap-2 animate-pulse">
                <ShieldCheck className="w-5 h-5" /> Submitting...
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5" /> Terminate Emergency (All Clear)
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
