/** Normal-media recovery only. Emergency callers never enter this module. */
import { quarantineKey } from './digestQuarantine';

export const PLAYBACK_SAFETY_MS = 6 * 60 * 60 * 1000;
const PENDING_MAX_AGE_MS = 45 * 60 * 1000;
const STORE_KEY = 'edu_normal_playback_safety_v1';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type PreparationPhase = 'download' | 'verify' | 'assemble' | 'start';
type Pending = { key: string; phase: PreparationPhase; at: number; ticket: number };
type Failure = { key: string; count: number; until: number };
type State = { safeUntil: number; pending: Pending[]; failures: Failure[] };
const phases = new Set(['download', 'verify', 'assemble', 'start']);

export class PlaybackSafety {
  private state: State = { safeUntil: 0, pending: [], failures: [] };
  private serial = 0;
  constructor(private readonly store: Store | null, now: number) {
    try {
      const raw = JSON.parse(store?.getItem(STORE_KEY) ?? 'null');
      if (raw && typeof raw === 'object') {
        if (Number.isFinite(raw.safeUntil)) this.state.safeUntil = Math.min(raw.safeUntil, now + PLAYBACK_SAFETY_MS);
        this.state.failures = Array.isArray(raw.failures) ? raw.failures.filter((f: Failure) =>
          typeof f?.key === 'string' && f.key.length <= 2048 && Number.isInteger(f.count) && f.count > 0 &&
          Number.isFinite(f.until) && f.until > now && f.until <= now + PLAYBACK_SAFETY_MS).slice(-64) : [];
        const pending = Array.isArray(raw.pending) ? raw.pending.filter((p: Pending) =>
          typeof p?.key === 'string' && p.key.length <= 2048 && phases.has(p.phase) &&
          Number.isFinite(p.at) && p.at <= now && now - p.at <= PENDING_MAX_AGE_MS).slice(-8) : [];
        // An interrupted page is evidence of an interrupted operation, not proof of OOM.
        // Count one interruption per FILE per boot, even if several phases were pending.
        for (const key of new Set<string>(pending.map((p: Pending) => p.key))) {
          const previous = this.state.failures.find(f => f.key === key);
          this.state.failures = this.state.failures.filter(f => f.key !== key);
          this.state.failures.push({ key, count: Math.min(2, (previous?.count ?? 0) + 1), until: now + PLAYBACK_SAFETY_MS });
          this.state.safeUntil = now + PLAYBACK_SAFETY_MS;
        }
      }
    } catch { /* Storage denial/corruption must never prevent the player booting. */ }
    this.save();
  }
  private key(url: string, digest?: string | null): string {
    return `${quarantineKey(url)}#${digest?.toLowerCase() ?? ''}`;
  }
  private save() {
    this.state.failures = this.state.failures.slice(-64);
    try { this.store?.setItem(STORE_KEY, JSON.stringify(this.state)); } catch { /* page memory still works */ }
  }
  conservative(now: number) { return this.state.safeUntil > now; }
  rendererFailed(now: number, until = now + PLAYBACK_SAFETY_MS) { this.state.safeUntil = Math.min(until, now + PLAYBACK_SAFETY_MS); this.save(); }
  blocked(url: string, digest: string | null | undefined, now: number): boolean {
    return this.state.failures.some(f => f.key === this.key(url, digest) && f.count >= 2 && f.until > now);
  }
  begin(url: string, digest: string | null | undefined, phase: PreparationPhase, now: number): () => void {
    const ticket = ++this.serial;
    this.state.pending = [...this.state.pending, { key: this.key(url, digest), phase, at: now, ticket }].slice(-8);
    this.save();
    return () => { this.state.pending = this.state.pending.filter(p => p.ticket !== ticket); this.save(); };
  }
  orderlyExit() { this.state.pending = []; this.save(); }
}

let singleton: PlaybackSafety | null = null;
export function playbackSafety(): PlaybackSafety {
  if (singleton) return singleton;
  let storage: Storage | null = null;
  try { storage = window.localStorage; } catch { /* hardened browser */ }
  singleton = new PlaybackSafety(storage, Date.now());
  try {
    const hint = Number(new URLSearchParams(window.location.search).get('recoveredRenderer'));
    if (Number.isSafeInteger(hint) && hint > Date.now()) singleton.rendererFailed(Date.now(), hint);
    // pagehide covers deliberate refresh/navigation and BFCache; no crash attribution.
    window.addEventListener('pagehide', () => singleton?.orderlyExit());
  } catch { /* SSR */ }
  return singleton;
}

/** A running timer or advancing media clock alone cannot prove decoded video. */
export function decodedFrameCount(video: HTMLVideoElement): number | undefined {
  try {
    const quality = video.getVideoPlaybackQuality?.();
    const count = quality ? quality.totalVideoFrames - quality.droppedVideoFrames :
      (video as HTMLVideoElement & { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount;
    return typeof count === 'number' && Number.isFinite(count) && count > 0 ? count : undefined;
  } catch { return undefined; }
}
