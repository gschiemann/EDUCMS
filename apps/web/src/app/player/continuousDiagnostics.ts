/** Bounded observations only: no playback decisions, media identifiers or timers. */
import type { VideoQualityCounters } from './videoQuality';

type Operation = 'read' | 'append' | 'prune';
interface Latency { count: number; totalMs: number; maxMs: number }
export interface ContinuousPumpSnapshot {
  aheadMs: number | null;
  minAheadMs: number | null;
  /** Engine-lifetime aggregates, including failed operations. */
  latency: Record<Operation, Latency>;
  quotaBackoffs?: number;
}
const metric = (): Latency => ({ count: 0, totalMs: 0, maxMs: 0 });
const boundedNumber = (v: number, cap = 1_000_000_000) => Math.min(cap, Math.max(0, Math.round(v)));

export class ContinuousPumpDiagnostics {
  private started = false;
  private aheadMs: number | null = null;
  private minAheadMs: number | null = null;
  private readonly latency = { read: metric(), append: metric(), prune: metric() };
  constructor(private readonly clock: () => number = () => performance.now()) {}

  start(): void { this.started = true; }
  observeAhead(seconds: number): void {
    if (!this.started || !Number.isFinite(seconds) || seconds < 0) return;
    this.aheadMs = boundedNumber(seconds * 1000);
    this.minAheadMs = Math.min(this.minAheadMs ?? this.aheadMs, this.aheadMs);
  }
  async measure<T>(operation: Operation, work: () => Promise<T>): Promise<T> {
    const at = this.clock();
    try { return await work(); }
    finally {
      const elapsed = this.clock() - at;
      if (Number.isFinite(elapsed) && elapsed >= 0) {
        const m = this.latency[operation];
        m.count = boundedNumber(m.count + 1);
        m.totalMs = boundedNumber(m.totalMs + elapsed);
        m.maxMs = Math.max(m.maxMs, boundedNumber(elapsed));
      }
    }
  }
  snapshot(): ContinuousPumpSnapshot {
    return { aheadMs: this.aheadMs, minAheadMs: this.minAheadMs,
      latency: { read: { ...this.latency.read }, append: { ...this.latency.append }, prune: { ...this.latency.prune } } };
  }
}

/** One fixed-size window. Lifetime frame counters are read, never consumed. */
export class ContinuousPlaybackDiagnostics {
  private sinceMs = 0;
  private base: VideoQualityCounters | null = null;
  private started = false;
  private waits = 0;
  private waitMs = 0;
  private openAt: number | null = null;
  private openAheadMs: number | null = null;
  private waitAheadMin: number | null = null;
  private waitAheadMax: number | null = null;
  private decodeCount = 0;
  private decodeTotalMs = 0;
  private decodeMaxMs = 0;

  reset(nowMs: number, counters: VideoQualityCounters | null): void {
    this.sinceMs = nowMs; this.base = counters; this.started = false;
    this.openAt = null; this.openAheadMs = null;
    this.clearWindow(nowMs);
  }
  playing(nowMs: number): void {
    if (!this.started) this.sinceMs = nowMs;
    this.started = true; this.closeWait(nowMs);
  }
  closeWait(nowMs: number): void {
    if (this.openAt === null) return;
    this.waitMs = boundedNumber(this.waitMs + Math.max(0, nowMs - this.openAt)); this.openAt = null; this.openAheadMs = null;
  }
  waiting(nowMs: number, aheadSeconds: number): void {
    if (!this.started || this.openAt !== null) return;
    this.waits = boundedNumber(this.waits + 1); this.openAt = nowMs; this.openAheadMs = null;
    if (Number.isFinite(aheadSeconds) && aheadSeconds >= 0) {
      const ahead = boundedNumber(aheadSeconds * 1000);
      this.openAheadMs = ahead;
      this.waitAheadMin = Math.min(this.waitAheadMin ?? ahead, ahead);
      this.waitAheadMax = Math.max(this.waitAheadMax ?? ahead, ahead);
    }
  }
  frame(processingSeconds?: number): void {
    if (!this.started || processingSeconds === undefined || !Number.isFinite(processingSeconds) || processingSeconds < 0) return;
    const ms = Math.min(60_000, processingSeconds * 1000);
    this.decodeCount = boundedNumber(this.decodeCount + 1);
    this.decodeTotalMs += ms; this.decodeMaxMs = Math.max(this.decodeMaxMs, ms);
  }
  sample(nowMs: number, counters: VideoQualityCounters | null, pump: ContinuousPumpSnapshot): string | null {
    if (!this.started || !counters) return null;
    if (!this.base || counters.totalFrames < this.base.totalFrames || counters.droppedFrames < this.base.droppedFrames) {
      this.reset(nowMs, counters); this.started = true; return null;
    }
    const elapsed = nowMs - this.sinceMs;
    const total = counters.totalFrames - this.base.totalFrames;
    if (elapsed < 60_000 || total < 150) return null;
    const dropped = Math.min(total, counters.droppedFrames - this.base.droppedFrames);
    const waited = this.waitMs + (this.openAt === null ? 0 : Math.max(0, nowMs - this.openAt));
    const badWait = this.waits >= 3 || waited >= 1000;
    let line: string | null = null;
    if (dropped / total >= 0.15 || badWait) {
      const prefix = this.waits > 0 ? '[Player] stalled playback sample ' : '[Player] failed frame budget ';
      line = prefix + JSON.stringify({ ms: boundedNumber(elapsed), f: boundedNumber(total), d: boundedNumber(dropped),
        w: this.waits, waitMs: boundedNumber(waited), aheadMs: pump.aheadMs, minAheadMs: pump.minAheadMs,
        waitAheadMs: [this.waitAheadMin, this.waitAheadMax],
        // r/a/p order; maxima are engine-lifetime, decode is this sample window.
        opMaxMs: [pump.latency.read.maxMs, pump.latency.append.maxMs, pump.latency.prune.maxMs],
        decodeMs: this.decodeCount ? [this.decodeCount, Math.round(this.decodeTotalMs / this.decodeCount * 10) / 10,
          Math.round(this.decodeMaxMs * 10) / 10] : null,
        quota: boundedNumber(pump.quotaBackoffs ?? 0) });
    }
    this.base = counters; this.clearWindow(nowMs);
    return line;
  }
  private clearWindow(nowMs: number): void {
    this.sinceMs = nowMs; this.waits = this.openAt === null ? 0 : 1;
    if (this.openAt !== null) this.openAt = nowMs;
    this.waitMs = 0; this.waitAheadMin = this.openAheadMs; this.waitAheadMax = this.openAheadMs;
    this.decodeCount = 0; this.decodeTotalMs = 0; this.decodeMaxMs = 0;
  }
}
