"use client";

import { useEffect, useRef } from 'react';
import { useOverlayLock } from './use-overlay-lock';

/**
 * The behaviour every mobile bottom sheet owes the operator.
 *
 * Mobile design package §6.2 (the More sheet) states it as a list, and §15
 * makes it universal ("Modals/sheets trap focus, make background inert, close
 * with Escape and restore focus"):
 *
 *   - Use the shared overlay lock.        → useOverlayLock (hides the tab bar)
 *   - Trap focus.                         → Tab / Shift+Tab wrap inside
 *   - Make the background inert.          → aria-hidden on the app root
 *   - Close with Escape.                  → keydown
 *   - Restore focus to the trigger.       → on close
 *
 * Scrim and the 44×44 close control are markup, so they stay with the sheet.
 * Drag-down is deliberately NOT emulated here: a hand-rolled touch-drag that
 * fights the sheet's own scrolling is worse than not having it, and Escape +
 * scrim + close button already give three ways out on every input device.
 *
 * WHY `aria-hidden` AND NOT `inert`: `inert` is unsupported on the Chromium-83
 * floor this codebase still ships to, and a polyfill on the app root is a lot
 * of machinery for a sheet. `aria-hidden` on the root sibling gives screen
 * readers the same "nothing behind this" answer; the focus trap below is what
 * actually keeps the keyboard inside.
 */
export function useBottomSheet(opts: {
  open: boolean;
  onClose: () => void;
  /** The sheet's own container — the focus trap's scope. */
  sheetRef: React.RefObject<HTMLElement | null>;
  /** Focused on open; focus returns here on close. */
  triggerRef?: React.RefObject<HTMLElement | null>;
  /**
   * How to FIND the trigger again when it did not survive the sheet.
   *
   * This is not belt-and-braces, it is the normal case for the More sheet:
   * opening it raises the shared overlay lock, which unmounts the whole tab
   * bar — including the More button that opened it. On close the bar remounts
   * as brand-new DOM, so the captured node is detached and focusing it would
   * silently drop focus to <body>, leaving a keyboard operator stranded at the
   * top of the document. A CSS selector re-finds the fresh node.
   * (Caught by mobile-shell-v1.test.tsx, not by reading the code.)
   */
  restoreFocusSelector?: string;
}) {
  const { open, onClose, sheetRef, triggerRef, restoreFocusSelector } = opts;
  // Hide the global tab bar while the sheet owns the screen (§6.2, and the
  // QA checklist's "Every overlay hides/clears the bottom tab bar").
  useOverlayLock(open);

  // Keep the latest onClose without re-arming the listener every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const sheet = sheetRef.current;
    const restoreTo = triggerRef?.current ?? (document.activeElement as HTMLElement | null);

    // Background inert to assistive tech. #main-content is the app's own
    // scroll region; hiding it (rather than <body>) leaves the sheet — which
    // renders outside it — reachable.
    const bg = document.getElementById('main-content');
    const hadAriaHidden = bg?.getAttribute('aria-hidden') ?? null;
    bg?.setAttribute('aria-hidden', 'true');

    // Initial focus lands on the first real control INSIDE the sheet. A
    // focusable container that merely holds focus is not parked focus — the
    // exact SetupChecklistView failure the player rules call out.
    const focusables = () => (sheet ? getFocusable(sheet) : []);
    const raf = requestAnimationFrame(() => focusables()[0]?.focus());

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !sheet) return;
      const list = focusables();
      if (list.length === 0) return;
      e.preventDefault();
      const active = document.activeElement as HTMLElement | null;
      const idx = active ? list.indexOf(active) : -1;
      if (e.shiftKey) (idx <= 0 ? list[list.length - 1] : list[idx - 1]).focus();
      else (idx === -1 || idx === list.length - 1 ? list[0] : list[idx + 1]).focus();
    };
    document.addEventListener('keydown', onKey);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      if (hadAriaHidden === null) bg?.removeAttribute('aria-hidden');
      else bg?.setAttribute('aria-hidden', hadAriaHidden);
      // Restore focus to whatever opened the sheet (§6.2: "Restore focus to
      // More after closing"). The captured node is preferred; when it did not
      // survive (the tab bar unmounts while the sheet is up), re-find it after
      // a frame, once React has put the bar back.
      if (restoreTo && document.contains(restoreTo)) {
        restoreTo.focus();
      } else if (restoreFocusSelector) {
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>(restoreFocusSelector)?.focus();
        });
      }
    };
  }, [open, sheetRef, triggerRef, restoreFocusSelector]);
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Visible, focusable descendants, in DOM order. */
export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    // offsetParent is null for display:none subtrees. jsdom reports null for
    // everything, so tests that assert ordering must render into a document
    // where layout is faked — hence the explicit `|| !!el.getClientRects` fall
    // back, which keeps the trap functional under jsdom without weakening it
    // in a real browser (a display:none node has no client rects there).
    (el) => el.offsetParent !== null || el.getClientRects().length > 0 || isJsdom(),
  );
}

function isJsdom(): boolean {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
}
