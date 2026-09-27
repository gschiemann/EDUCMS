/**
 * game-op-replay — the ONE replay controller the operator console and the
 * volunteer pad share (K12-F16): per key, triggered by 'online', the tab
 * coming back and a 5 s retry that only exists while ops are queued AND the
 * tab is visible.
 */
import { GameOpQueue, type GameOpStorage } from '../game-op-queue';
import { attachOpQueueReplay } from '../game-op-replay';

function memoryStorage(): GameOpStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  jest.useFakeTimers();
  setVisibility('visible');
});
afterEach(() => {
  jest.useRealTimers();
});

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('attachOpQueueReplay', () => {
  it('replays on "online", reports what it sent, and stops the timer once drained', async () => {
    const q = new GameOpQueue('replay-a', memoryStorage());
    const sent: string[] = [];
    const replayed: Array<{ sent: number; remaining: number }> = [];
    const release = attachOpQueueReplay('replay-a', q, async (op) => void sent.push(op.opId), {
      onReplayed: (r) => replayed.push(r),
    });
    q.enqueue('score', { team: 'home', delta: 2 }, { commandId: 'cmd-a-00000001' });
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(sent).toEqual(['cmd-a-00000001']);
    expect(replayed).toEqual([{ sent: 1, remaining: 0 }]);
    expect(q.size()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    release();
  });

  it('a failing sender keeps the op and retries every 5 s — only while the tab is visible', async () => {
    const q = new GameOpQueue('replay-b', memoryStorage());
    let fail = true;
    const sender = jest.fn(async () => {
      if (fail) throw new TypeError('Failed to fetch');
    });
    const release = attachOpQueueReplay('replay-b', q, sender);
    q.enqueue('clock', { action: 'start' }, { commandId: 'cmd-b-00000001' });
    expect(jest.getTimerCount()).toBe(1); // armed by the queue subscription
    setVisibility('hidden');
    expect(jest.getTimerCount()).toBe(0); // mobile perf: no timer in a hidden tab
    setVisibility('visible'); // coming back replays at once…
    await flush();
    expect(sender).toHaveBeenCalledTimes(1);
    expect(q.size()).toBe(1);
    expect(jest.getTimerCount()).toBe(1); // …and re-arms the retry
    fail = false;
    jest.advanceTimersByTime(5_000);
    await flush();
    expect(sender).toHaveBeenCalledTimes(2);
    expect(q.size()).toBe(0);
    release();
  });

  it('two keys are two independent controllers (the pad never drives the console queue)', async () => {
    const consoleQ = new GameOpQueue('game-9', memoryStorage());
    const padQ = new GameOpQueue('pad:game-9:00000000', memoryStorage());
    const consoleSent: string[] = [];
    const padSent: string[] = [];
    const r1 = attachOpQueueReplay('game-9', consoleQ, async (op) => void consoleSent.push(op.opId));
    const r2 = attachOpQueueReplay('pad:game-9:00000000', padQ, async (op) => void padSent.push(op.opId));
    consoleQ.enqueue('score', { delta: 1 }, { commandId: 'cmd-console-001' });
    padQ.enqueue('score', { delta: 3 }, { commandId: 'cmd-pad-00000001' });
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(consoleSent).toEqual(['cmd-console-001']);
    expect(padSent).toEqual(['cmd-pad-00000001']);
    r1();
    r2();
  });

  it('one controller per key however many attach; the last release tears it down', async () => {
    const q = new GameOpQueue('replay-c', memoryStorage());
    const sender = jest.fn(async () => undefined);
    const r1 = attachOpQueueReplay('replay-c', q, sender);
    const r2 = attachOpQueueReplay('replay-c', q, sender);
    q.enqueue('score', { delta: 1 }, { commandId: 'cmd-c-00000001' });
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(sender).toHaveBeenCalledTimes(1); // not once per attach
    r1();
    r1(); // idempotent
    q.enqueue('score', { delta: 1 }, { commandId: 'cmd-c-00000002' });
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(sender).toHaveBeenCalledTimes(2); // r2 still holds the controller
    r2();
    q.enqueue('score', { delta: 1 }, { commandId: 'cmd-c-00000003' });
    window.dispatchEvent(new Event('online'));
    await flush();
    expect(sender).toHaveBeenCalledTimes(2); // torn down
    expect(jest.getTimerCount()).toBe(0);
  });
});
