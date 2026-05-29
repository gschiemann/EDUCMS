"use client";

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';

/**
 * useOverlayLock — register an open overlay with the global store so the
 * mobile bottom tab bar (MobileTabBar.tsx) hides while it's up.
 *
 * THE PROBLEM IT SOLVES (2026-05-29)
 *
 *   The fixed MobileTabBar sits at z-60 across the whole viewport bottom.
 *   Every modal / bottom-sheet / drawer / full-screen picker that anchors
 *   content to the bottom of the screen (its footer Cancel / Confirm /
 *   "Choose folder" buttons) lands in the same 56-64px strip — and because
 *   DashboardLayout has transformed/blurred ancestors that create their own
 *   stacking contexts, a modal's z-[9999] does NOT reliably paint over the
 *   tab bar. The operator's very first mobile action (asset upload) had its
 *   action button clipped under the tab bar for exactly this reason.
 *
 *   Patching each modal's bottom padding one-at-a-time is brittle and was
 *   proven incomplete (the first mobile pass hand-picked a list and missed
 *   the upload flow). The robust systemic fix is the same one already used
 *   for the mobile sidebar drawer: hide the tab bar whenever an overlay is
 *   open, so exactly ONE mobile nav surface is usable at a time.
 *
 * USAGE
 *
 *   Call once near the top of any component that renders a viewport-level
 *   overlay, passing whether the overlay is currently visible:
 *
 *     function MyModal({ onClose }: Props) {
 *       useOverlayLock();              // always-mounted-when-open modal
 *       return <div className="fixed inset-0 …">…</div>;
 *     }
 *
 *   or, for a modal whose open state is internal:
 *
 *     const [open, setOpen] = useState(false);
 *     useOverlayLock(open);            // only counts while open
 *
 * WHY A COUNTER, NOT A BOOLEAN
 *
 *   Overlays stack: a FolderPicker opened from inside the upload flow, or
 *   an appConfirm() fired from within an already-open modal. A shared
 *   boolean would clear the moment the topmost overlay closed, un-hiding
 *   the tab bar underneath a still-open modal. The store keeps a reference
 *   count; the tab bar stays hidden until the LAST overlay closes.
 *
 * STRICTMODE / UNMOUNT SAFETY
 *
 *   The increment/decrement live in a single useEffect keyed on `active`,
 *   so React's mount→unmount→remount StrictMode double-invoke is balanced
 *   (each increment has a matching cleanup decrement) and the count can
 *   never leak. popOverlay() is clamped at 0 in the store as a final guard.
 *
 * @param active Whether the overlay is currently open. Defaults to true so
 *   `useOverlayLock()` with no args is correct for a component that only
 *   mounts while its overlay is visible (the common in-tree modal pattern,
 *   e.g. `{open && <Modal/>}`).
 */
export function useOverlayLock(active: boolean = true): void {
  const pushOverlay = useAppStore((s) => s.pushOverlay);
  const popOverlay = useAppStore((s) => s.popOverlay);

  useEffect(() => {
    if (!active) return;
    pushOverlay();
    return () => {
      popOverlay();
    };
  }, [active, pushOverlay, popOverlay]);
}
