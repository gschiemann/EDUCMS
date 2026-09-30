import { decodedFrameCount } from './playbackSafety';

export interface PlaylistVideoSource {
  id: string;
  src: string;
  muted: boolean;
}
export interface HandoffEnv {
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}
type Deck = HTMLVideoElement;
type Slot = { source: PlaylistVideoSource | null; started: boolean; cancelFrame?: () => void };
export interface HandoffCallbacks {
  present(video: Deck, source: PlaylistVideoSource, previous: Deck | null): void;
  ended(id: string): void;
  error(id: string): void;
  fallback(reason: string): void;
}
const same = (a: PlaylistVideoSource | null, b: PlaylistVideoSource | null) =>
  !!a && !!b && a.id === b.id && a.src === b.src;

/** Normal, free-running video playlists only. Two persistent surfaces; a new
 * file never replaces the picture until it has produced a decoded frame.
 * No canvas copies, opacity fades, playlist clock, or emergency decisions. */
export class PlaylistVideoHandoff {
  private slots: [Slot, Slot] = [{ source: null, started: false }, { source: null, started: false }];
  private shown: number | null = null;
  private target: number | null = null;
  private desired: PlaylistVideoSource | null = null;
  private next: PlaylistVideoSource | null = null;
  private generation = 0;
  private disposed = false;
  private single = false;
  private pendingSince: number | null = null;
  private warming = false;
  private leadMs = 450;
  private endedId: string | null = null;
  private failedId: string | null = null;
  private listeners: Array<() => void> = [];

  constructor(private decks: [Deck, Deck], private env: HandoffEnv, private cb: HandoffCallbacks) {
    decks.forEach((v, i) => {
      v.muted = true;
      v.loop = false;
      v.style.opacity = '1';
      v.style.transition = 'none';
      v.style.zIndex = '0';
      const ended = () => {
        const source = this.slots[i].source;
        if (this.disposed || !v.ended || i !== this.target || !source || this.endedId === source.id) return;
        this.endedId = source.id;
        this.cb.ended(source.id);
      };
      const error = () => {
        if (this.disposed || !v.error) return;
        if (i === this.target) this.failCurrent();
        else if (this.slots[i].source) this.fallback('standby-error');
      };
      v.addEventListener('ended', ended);
      v.addEventListener('error', error);
      this.listeners.push(() => { v.removeEventListener('ended', ended); v.removeEventListener('error', error); });
    });
  }

  get activeVideo(): Deck | null { return this.target === null ? null : this.decks[this.target]; }
  get hasPicture(): boolean { return this.pendingSince === null && this.shown === this.target; }
  get source(): PlaylistVideoSource | null { return this.desired; }

  update(active: PlaylistVideoSource, next: PlaylistVideoSource | null) {
    if (this.disposed) return;
    this.next = next;
    if (same(active, this.desired)) {
      this.desired = active;
      if (this.shown === this.target && this.shown !== null) {
        this.decks[this.shown].muted = active.muted;
        this.prepareNext();
      }
      return;
    }
    this.generation++;
    this.slots.forEach(s => { s.cancelFrame?.(); s.cancelFrame = undefined; });
    this.warming = false;
    this.desired = active;
    this.endedId = null;
    this.failedId = null;
    const matched = this.slots.findIndex(s => same(s.source, active));
    const index = this.single ? (this.shown ?? 0) : matched >= 0 ? matched : this.shown === 0 ? 1 : 0;
    this.target = index;
    this.assign(index, active);
    const v = this.decks[index];
    // A parked/decoding standby is already at the start. Seeking it again
    // would throw away the prepared frame and restart the decoder.
    if (!this.slots[index].started) {
      try { v.currentTime = 0; } catch { /* metadata may not have arrived */ }
    }
    v.muted = true; // restore requested audio only after this deck takes glass
    this.pendingSince = this.env.now();
    const gen = this.generation;
    this.slots[index].cancelFrame = this.frame(v, () => {
      if (this.disposed || gen !== this.generation || index !== this.target) return;
      const previous = this.shown === null ? null : this.decks[this.shown];
      if (previous && previous !== v) { previous.pause(); previous.muted = true; previous.style.zIndex = '0'; }
      v.style.zIndex = '1';
      v.muted = active.muted;
      this.shown = index;
      this.pendingSince = null;
      this.cb.present(v, active, previous);
      this.prepareNext();
    });
    this.slots[index].started = true;
    this.play(v, () => this.failCurrent());
  }

  /** Cheap cadence; decoding overlaps only near the outgoing video's end. */
  tick() {
    if (this.disposed || this.target === null) return;
    if (this.pendingSince !== null) {
      if (this.env.now() - this.pendingSince > 8_000) this.failCurrent();
      return;
    }
    if (this.single || this.warming || !this.next || this.shown !== this.target) return;
    const active = this.decks[this.target];
    const standbyIndex = 1 - this.target;
    const standby = this.decks[standbyIndex];
    if (!this.slots[standbyIndex].source || this.slots[standbyIndex].started) return;
    if (!Number.isFinite(active.duration) || active.duration <= 0 || active.paused || active.ended) return;
    if ((active.duration - active.currentTime) * 1000 > this.leadMs) return;
    this.warming = true;
    this.slots[standbyIndex].started = true;
    standby.muted = true;
    const gen = this.generation;
    const start = this.env.now();
    this.slots[standbyIndex].cancelFrame = this.frame(standby, () => {
      if (this.disposed || gen !== this.generation || this.target === standbyIndex) return;
      standby.pause(); // park the opening frame; no hidden audio or playback
      this.warming = false;
      this.leadMs = Math.min(1200, Math.max(300, this.env.now() - start + 200));
    }, () => this.fallback('standby-timeout'));
    this.play(standby, () => this.fallback('standby-play-rejected'));
  }

  private prepareNext() {
    if (this.target === null || this.pendingSince !== null) return;
    const i = 1 - this.target;
    if (this.single || !this.next || same(this.next, this.desired)) this.release(i);
    else this.assign(i, this.next);
  }

  private assign(i: number, source: PlaylistVideoSource) {
    if (same(this.slots[i].source, source)) { this.slots[i].source = source; return; }
    this.release(i);
    const v = this.decks[i];
    this.slots[i].source = source;
    v.dataset.playlistItem = source.id;
    // Match the existing iPhone .mov MIME-coercion path.
    if (/\.mov(\?|$)/i.test(source.src)) {
      const child = v.ownerDocument.createElement('source');
      child.src = source.src;
      child.type = 'video/mp4';
      v.appendChild(child);
    } else v.src = source.src;
    v.load();
  }

  private release(i: number) {
    const v = this.decks[i];
    this.slots[i].cancelFrame?.();
    this.slots[i] = { source: null, started: false };
    v.pause();
    v.muted = true;
    v.style.zIndex = '0';
    delete v.dataset.playlistItem;
    v.removeAttribute('src');
    while (v.firstChild) v.removeChild(v.firstChild);
    v.load(); // release hardware decoder and network before assigning a file
  }

  private play(v: Deck, failed: () => void) {
    const gen = this.generation;
    try { const p = v.play(); p?.catch(() => { if (!this.disposed && gen === this.generation) failed(); }); }
    catch { failed(); }
  }

  /** rVFC is a compositor frame, unlike play()/playing or buffered bytes.
   * Older engines use decoded-frame counters plus actual clock progress. */
  private frame(v: Deck, ready: () => void, expired?: () => void): () => void {
    let cancelled = false;
    let id: number | undefined;
    let poll: number | undefined;
    let deadline: number | undefined;
    const cancel = () => {
      cancelled = true;
      if (id !== undefined) v.cancelVideoFrameCallback?.(id);
      if (poll !== undefined) this.env.clearTimeout(poll);
      if (deadline !== undefined) this.env.clearTimeout(deadline);
    };
    const done = () => { if (cancelled) return; cancel(); ready(); };
    if (typeof v.requestVideoFrameCallback === 'function') id = v.requestVideoFrameCallback(done);
    else {
      const before = decodedFrameCount(v);
      const time = v.currentTime;
      const sample = () => {
        if (cancelled) return;
        const frames = decodedFrameCount(v);
        if (!v.seeking && v.readyState >= 2 && v.videoWidth > 0 &&
          (frames !== undefined && before !== undefined ? frames > before : v.currentTime > time + 0.001)) done();
        else poll = this.env.setTimeout(sample, 30);
      };
      poll = this.env.setTimeout(sample, 30);
    }
    if (expired) deadline = this.env.setTimeout(() => { if (!cancelled) { cancel(); expired(); } }, 3_000);
    return cancel;
  }

  failCurrent() {
    if (this.disposed || !this.desired || this.failedId === this.desired.id) return;
    this.failedId = this.desired.id;
    this.generation++;
    this.slots.forEach(s => s.cancelFrame?.());
    this.pendingSince = null;
    if (this.target !== null) { this.decks[this.target].pause(); this.decks[this.target].muted = true; }
    this.cb.error(this.desired.id);
  }

  private fallback(reason: string) {
    if (this.single || this.disposed) return;
    this.single = true;
    this.warming = false;
    if (this.target !== null && this.shown === this.target) this.release(1 - this.target);
    this.cb.fallback(reason);
  }

  destroy() {
    this.disposed = true;
    this.generation++;
    this.listeners.forEach(stop => stop());
    this.release(0);
    this.release(1);
  }
}
