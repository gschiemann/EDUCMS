/**
 * One render at a time, a short line behind it, and a hard "no" after that.
 *
 * Chromium is the expensive, memory-hungry part of this service and a board
 * render is CPU-bound for seconds, so concurrency would only make every render
 * slower and the memory ceiling harder to hold. The API calls this from a job
 * worker that can wait; a caller that finds the line full gets 429 and retries
 * later instead of piling requests into a queue nobody bounded.
 */

export interface Ticket {
  /** Resolves when this ticket holds the render slot. */
  ready: Promise<void>;
  /** Give the slot back (idempotent). Also cancels a ticket still waiting. */
  release(): void;
  /** True while waiting in line. */
  readonly waiting: boolean;
}

interface Entry {
  grant: () => void;
  granted: boolean;
  cancelled: boolean;
}

export class RenderGate {
  private active = false;
  private readonly line: Entry[] = [];

  constructor(private readonly maxWaiting: number) {}

  stats(): { active: number; waiting: number; max: number } {
    return { active: this.active ? 1 : 0, waiting: this.line.length, max: this.maxWaiting };
  }

  /** A ticket, or null when the line is full (→ 429). */
  enter(): Ticket | null {
    if (!this.active && this.line.length === 0) {
      this.active = true;
      return this.ticket(Promise.resolve(), { grant: () => undefined, granted: true, cancelled: false });
    }
    if (this.line.length >= this.maxWaiting) return null;
    const entry: Entry = { grant: () => undefined, granted: false, cancelled: false };
    const ready = new Promise<void>((resolve) => {
      entry.grant = resolve;
    });
    this.line.push(entry);
    return this.ticket(ready, entry);
  }

  private ticket(ready: Promise<void>, entry: Entry): Ticket {
    let released = false;
    return {
      ready,
      get waiting() {
        return !entry.granted && !released;
      },
      release: () => {
        if (released) return;
        released = true;
        if (!entry.granted) {
          // Still in line: leave it. The slot was never ours to hand on.
          entry.cancelled = true;
          const i = this.line.indexOf(entry);
          if (i !== -1) this.line.splice(i, 1);
          return;
        }
        this.next();
      },
    };
  }

  private next(): void {
    this.active = false;
    while (this.line.length > 0) {
      const entry = this.line.shift() as Entry;
      if (entry.cancelled) continue;
      this.active = true;
      // Marked synchronously, before the promise settles, so a release that
      // races the grant (a client hanging up this very tick) hands the slot on
      // instead of leaking it.
      entry.granted = true;
      entry.grant();
      return;
    }
  }
}
