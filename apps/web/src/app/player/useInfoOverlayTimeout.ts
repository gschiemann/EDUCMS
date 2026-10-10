'use client';

import { useEffect } from 'react';

export const INFO_OVERLAY_IDLE_MS = 30_000;

/** Operator information is transient chrome over public content. Media events,
 * heartbeats and held remote keys cannot keep it visible indefinitely.
 * An explicitly opened editor owns its own lifecycle and is never dismissed.
 */
export function useInfoOverlayTimeout(
  open: boolean,
  close: () => void,
  editorOpen: boolean,
): void {
  useEffect(() => {
    if (!open || editorOpen) return;
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(close, INFO_OVERLAY_IDLE_MS);
    };
    const activity = (event: Event) => {
      if (event instanceof KeyboardEvent && event.repeat) return;
      if (!(event.target instanceof Element) ||
          !event.target.closest('[data-edu-player-info-panel]')) return;
      arm();
    };
    const events = ['pointerdown', 'touchstart', 'keydown', 'wheel', 'scroll'];
    // Dialog focus is established when it opens so remote OK can dismiss it.
    document.querySelector<HTMLButtonElement>('[data-edu-return-to-content]')?.focus();
    arm();
    for (const event of events) window.addEventListener(event, activity, true);
    return () => {
      clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, activity, true);
    };
  }, [open, close, editorOpen]);
}
