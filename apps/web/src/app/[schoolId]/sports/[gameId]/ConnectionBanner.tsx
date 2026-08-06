'use client';

/**
 * ConnectionBanner — sports Trust wave Domain C (2026-08-06). The slim
 * truth strip at the top of the game console: the scorekeeper's tablet
 * must never silently disagree with the board. Reads the per-game
 * offline op queue (lib/game-op-queue.ts — fed by useGameControl's
 * failed-write classification) and renders one of four states:
 *
 *   OFFLINE  — network-failed taps are queued; they WILL sync.
 *   SYNCING  — reconnected, replay in flight.
 *   SYNCED   — queue drained; ask the operator to eyeball the board
 *              (covers the accepted "response lost in transit"
 *              double-count risk — see useGameControl's tradeoff note).
 *              Auto-dismisses after ~6s (one-shot timeout, not a poller).
 *   REJECTED — the server 4xx-rejected a write; dismissible.
 *
 * Rendered IN FLOW at the top of the console column (same pattern as
 * GoLiveBar: a block in the page flex column, so it pushes the console
 * down and can never overlap the RunCommandBar controls). Solid
 * backgrounds only — this is always-mounted mobile chrome, no
 * backdrop-blur (mobile perf standard). The outer aria-live region stays
 * mounted even when empty so screen readers announce state changes.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { getGameOpQueue, type GameOpQueueSnapshot } from '@/lib/game-op-queue';

/** Live view of the game's offline op queue (shared instance with
 *  useGameControl — same registry, same snapshot). */
export function useGameOpQueue(gameId: string): GameOpQueueSnapshot {
  const q = getGameOpQueue(gameId);
  const subscribe = useCallback((onChange: () => void) => q.subscribe(onChange), [q]);
  const getSnapshot = useCallback(() => q.getSnapshot(), [q]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// navigator.onLine === false is the one reliable signal (true can lie —
// connected to a dead AP — which is why the queue, not this flag, drives
// the queued-changes states).
function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}
const readOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
const readOnlineServer = () => true;

type BannerState = 'offline' | 'syncing' | 'synced' | 'rejected';

export function ConnectionBanner({ gameId }: { gameId: string }) {
  const snap = useGameOpQueue(gameId);
  const online = useSyncExternalStore(subscribeOnline, readOnline, readOnlineServer);
  // Which drain's SYNCED strip has timed out (auto-dismiss ~6s).
  const [dismissedDrainAt, setDismissedDrainAt] = useState<number | null>(null);

  const queued = snap.ops.length;

  useEffect(() => {
    if (snap.lastDrainAt === null || queued > 0) return;
    const drainAt = snap.lastDrainAt;
    const t = setTimeout(() => setDismissedDrainAt(drainAt), 6_000);
    return () => clearTimeout(t);
  }, [snap.lastDrainAt, queued]);

  let state: BannerState | null = null;
  if (queued > 0) state = snap.replaying ? 'syncing' : 'offline';
  else if (!online) state = 'offline';
  else if (snap.lastRejectionAt !== null) state = 'rejected';
  else if (snap.lastDrainAt !== null && dismissedDrainAt !== snap.lastDrainAt) state = 'synced';

  // The live region stays mounted (zero-height when idle) so aria-live
  // announcements fire on state ENTRY, not only on later changes.
  return (
    <div aria-live="polite" role="status">
      {state === 'offline' && (
        <Strip className="bg-amber-400 text-slate-900">
          {queued > 0
            ? `Working offline — ${queued} ${queued === 1 ? 'change' : 'changes'} queued, will sync when connection returns`
            : 'Working offline — changes will be queued and synced when connection returns'}
        </Strip>
      )}
      {state === 'syncing' && (
        <Strip className="bg-sky-600 text-white">
          Reconnected — syncing {queued} queued {queued === 1 ? 'change' : 'changes'}…
        </Strip>
      )}
      {state === 'synced' && (
        <Strip className="bg-emerald-600 text-white">
          All changes synced — verify the score matches the board
        </Strip>
      )}
      {state === 'rejected' && (
        <Strip className="bg-red-600 text-white">
          <span className="flex-1">
            The server rejected the last change — the board may not match. Pull to refresh.
          </span>
          <button
            type="button"
            onClick={() => getGameOpQueue(gameId).clearRejection()}
            aria-label="Dismiss"
            className="shrink-0 rounded px-2 py-0.5 text-xs font-black uppercase tracking-wide bg-red-800 hover:bg-red-900 text-white"
          >
            Dismiss
          </button>
        </Strip>
      )}
    </div>
  );
}

function Strip({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-3 px-4 py-1.5 text-[13px] font-bold ${className}`}>
      {children}
    </div>
  );
}
