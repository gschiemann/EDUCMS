/**
 * game-op-replay — WHEN a GameOpQueue (lib/game-op-queue.ts) replays: the
 * browser's 'online' event, the tab becoming visible again, and a 5 s retry
 * while ops are queued and the tab is visible.
 *
 * Extracted verbatim from hooks/use-api.ts (sports Trust wave Domain C,
 * 2026-08-06) so the operator console and the volunteer scorekeeper pad
 * (/console/<token>, K12-F16, 2026-09-27) drive their queues through ONE
 * replay controller instead of two copies of it. The queue itself (what is
 * kept, coalesced and replayed, in what order, under which command id) stays
 * in game-op-queue.ts; the sender (which endpoint an op goes to) stays with
 * each caller.
 *
 * ONE controller per KEY no matter how many components attach (the console
 * page mounts useGameControl several times): the first attach wires the
 * listeners + the queue subscription, the last detach tears them down. The
 * hooks of the most recent attach win (a remount with a new QueryClient).
 *
 * Mobile performance standard: the 5 s retry timer exists ONLY while (queue
 * non-empty AND document visible) — zero timers when the queue is empty or
 * the tab is hidden.
 */
import type { GameOpQueue, GameOpSender } from './game-op-queue';

export interface OpQueueReplayHooks {
  /** After a replay pass that sent at least one op. `remaining` = ops still
   *  queued after the pass (0 = drained). */
  onReplayed?: (result: { sent: number; remaining: number }) => void;
}

type ReplayController = {
  refs: number;
  hooks: OpQueueReplayHooks;
  timer: ReturnType<typeof setTimeout> | null;
  teardown: () => void;
};

const controllers = new Map<string, ReplayController>();

/**
 * Attach the replay triggers for `queue` under `key`. Returns a release
 * function (idempotent). Ops persisted across a reload replay right away.
 */
export function attachOpQueueReplay(
  key: string,
  queue: GameOpQueue,
  sender: GameOpSender,
  hooks: OpQueueReplayHooks = {},
): () => void {
  if (typeof window === 'undefined') return () => {};
  let ctl = controllers.get(key);
  if (!ctl) {
    const clearTimer = () => {
      const c = controllers.get(key);
      if (c && c.timer !== null) {
        clearTimeout(c.timer);
        c.timer = null;
      }
    };
    const schedule = () => {
      const c = controllers.get(key);
      if (!c || c.timer !== null) return;
      if (queue.size() === 0 || document.visibilityState !== 'visible') return;
      c.timer = setTimeout(() => {
        const cc = controllers.get(key);
        if (cc) cc.timer = null;
        void attempt();
      }, 5_000);
    };
    const attempt = async () => {
      clearTimer();
      const c = controllers.get(key);
      if (!c || queue.size() === 0) return;
      const { sent, remaining } = await queue.replay(sender);
      const after = controllers.get(key);
      if (!after) return;
      if (sent > 0) after.hooks.onReplayed?.({ sent, remaining });
      // Partial / still failing — self-chained 5 s retry.
      if (remaining > 0) schedule();
    };
    const onOnline = () => {
      void attempt();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void attempt();
      else clearTimer(); // no timers in a hidden tab
    };
    const unsubscribe = queue.subscribe(() => {
      if (queue.size() === 0) clearTimer();
      else if (!queue.getSnapshot().replaying) schedule();
    });
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    ctl = {
      refs: 0,
      hooks,
      timer: null,
      teardown: () => {
        clearTimer();
        unsubscribe();
        window.removeEventListener('online', onOnline);
        document.removeEventListener('visibilitychange', onVisibility);
      },
    };
    controllers.set(key, ctl);
    // Ops persisted across a mid-game reload replay right away.
    if (queue.size() > 0) void attempt();
  }
  ctl.refs += 1;
  ctl.hooks = hooks;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const c = controllers.get(key);
    if (!c) return;
    c.refs -= 1;
    if (c.refs <= 0) {
      c.teardown();
      controllers.delete(key);
    }
  };
}
