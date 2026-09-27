'use client';

/**
 * useSportsLink — the freshness / recovery contract (lib/sports-freshness.ts,
 * K12-F40) wired into a live game surface.
 *
 *   const link = useSportsLink({ holdClocks: true });
 *   startBoardPoll({ …, onStatus: (s) => { if (s.online) link.markGood(); } })
 *   {link.state.phase === 'stale' && <ConnectionLostPill … />}
 *
 * It ticks once a second (only while mounted), follows the tab's visibility
 * when asked (surfaces that stop polling in the background), and — with
 * `holdClocks` — HOLDS the page's server clock while the link is stale, so
 * every clock the surface projects stops where it stood rather than running
 * on unconfirmed data, and releases it on the next good read.
 *
 * `state.phase` changes re-render; a plain good read on a live link does not.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { initialLink, linkReducer, type LinkEvent, type LinkState } from '@/lib/sports-freshness';
import { serverClock } from '@/lib/server-clock';

export interface SportsLink {
  state: LinkState;
  /** A good read landed (a 200 or a 304, or a successful command response). */
  markGood: () => void;
  /** The person confirmed the fresh picture after a loss (confirming surfaces). */
  confirm: () => void;
}

export function useSportsLink(
  opts: { holdClocks?: boolean; trackVisibility?: boolean; confirmAfterLoss?: boolean } = {},
): SportsLink {
  const { holdClocks = false, trackVisibility = false, confirmAfterLoss = false } = opts;
  const [state, setState] = useState<LinkState>(() => initialLink(Date.now(), { confirmAfterLoss }));
  // The reducer's truth (lastGoodAt moves every poll without a re-render).
  const ref = useRef<LinkState>(state);

  const dispatch = useCallback((e: LinkEvent) => {
    const prev = ref.current;
    const next = linkReducer(prev, e);
    if (next === prev) return;
    ref.current = next;
    // Re-render on phase changes only — lastGoodAt moves every poll.
    if (next.phase !== prev.phase || next.hadLoss !== prev.hadLoss) setState(next);
  }, []);

  // Mobile perf standard: a surface that follows visibility runs NO timer
  // while its tab is hidden (a display surface keeps ticking — it is on glass).
  const [visible, setVisible] = useState(
    () => !trackVisibility || typeof document === 'undefined' || document.visibilityState === 'visible',
  );
  useEffect(() => {
    if (!visible) return;
    const t = setInterval(() => {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      dispatch({ type: 'tick', at: Date.now(), browserOffline: offline });
    }, 1000);
    return () => clearInterval(t);
  }, [dispatch, visible]);

  useEffect(() => {
    if (!trackVisibility || typeof document === 'undefined') return;
    const onVisibility = () => {
      const isVisible = document.visibilityState === 'visible';
      dispatch({ type: isVisible ? 'visible' : 'hidden', at: Date.now() });
      setVisible(isVisible);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [trackVisibility, dispatch]);

  useEffect(() => {
    if (!holdClocks) return;
    if (state.phase === 'stale') serverClock.hold();
    else serverClock.release();
  }, [holdClocks, state.phase]);
  useEffect(() => () => {
    if (holdClocks) serverClock.release();
  }, [holdClocks]);

  const markGood = useCallback(() => dispatch({ type: 'good', at: Date.now() }), [dispatch]);
  const confirm = useCallback(() => dispatch({ type: 'confirm', at: Date.now() }), [dispatch]);
  return { state, markGood, confirm };
}

/**
 * For a surface that reads the game through a React Query cache (the
 * operator console): a good read is a SERVER response, and every one
 * carries a fresh `serverTime`. An optimistic tap writes the cache too —
 * and moves `dataUpdatedAt` — but it spreads the old game, so it carries the
 * OLD `serverTime` and never counts: a tap made offline cannot make the
 * console look live. A command response without `serverTime` counts as
 * nothing either (the next poll brings one back).
 */
export function useMarkGoodOnServerRead(markGood: () => void, serverTime: unknown): void {
  useEffect(() => {
    if (typeof serverTime === 'number' && isFinite(serverTime)) markGood();
  }, [serverTime, markGood]);
}

/**
 * K12-F40 — commit-to-visible, measured where it matters: when a surface
 * first shows a game revision, how long ago (on the server clock) was it
 * committed? Kept on `window.__sportsLink[surface]` for field diagnostics
 * (the same idea as `__eduSyncState`): `{ revision, lagMs, shownAt }`, plus
 * the worst lag seen and how many revisions were skipped between polls.
 */
export function noteRevisionShown(
  surface: string,
  payload: { revision?: unknown; updatedAt?: unknown },
): void {
  if (typeof window === 'undefined') return;
  const revision = typeof payload.revision === 'number' ? payload.revision : null;
  const committed = typeof payload.updatedAt === 'string' ? Date.parse(payload.updatedAt) : NaN;
  // The UNHELD clock: the first payload after an outage lands while the
  // display clock is still held, and that is exactly the lag worth knowing.
  const lagMs = isFinite(committed) ? Math.max(0, Math.round(serverClock.unheldNow() - committed)) : null;
  const w = window as unknown as { __sportsLink?: Record<string, Record<string, unknown>> };
  const all = (w.__sportsLink = w.__sportsLink || {});
  const prev = all[surface] || {};
  const prevRevision = typeof prev.revision === 'number' ? prev.revision : null;
  all[surface] = {
    revision,
    lagMs,
    shownAt: Date.now(),
    worstLagMs: Math.max(Number(prev.worstLagMs) || 0, lagMs ?? 0),
    skipped:
      (Number(prev.skipped) || 0) +
      (revision !== null && prevRevision !== null && revision > prevRevision + 1 ? revision - prevRevision - 1 : 0),
  };
}
