/** Emergency delivery uses the render lane; mounting state alone proves nothing. */
export interface EmergencyPaintProof {
  identity: string;
  documentId: string;
  frames: number;
  painted: boolean;
  challenge?: string;
  /** Native window validation is required even when its state read fails. */
  nativeRequired?: boolean;
}

/** Paint and live server confirmation are independent emergency facts. */
export function emergencyRenderHash(proof: EmergencyPaintProof, manifestOkAtMs: number, nowMs = Date.now()): string {
  const identity = `em:${proof.identity}`;
  if (!proof.painted) return `pending|${identity}`;
  return manifestOkAtMs === 0 || nowMs - manifestOkAtMs > 120_000 ? `unconfirmed|${identity}` : identity;
}

/** Bounded opaque identity: alert text, URLs and customer details never leave in proof. */
export function emergencyPaintIdentity(alert: unknown): string {
  const text = JSON.stringify(alert) || '';
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function visible(el: Element, doc: Document): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const style = doc.defaultView?.getComputedStyle(node);
    if (!style || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || (style.opacity !== '' && Number(style.opacity) === 0)) return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/** Check the painted target, including occlusion and decoded media, on BOTH frame samples. */
export function visibleEmergencyRoot(doc: Document, identity?: string | null): HTMLElement | null {
  if (doc.visibilityState !== 'visible') return null;
  const roots = Array.from(doc.querySelectorAll<HTMLElement>('[data-edu-emergency-root][data-edu-emergency-identity]')).reverse();
  for (const root of roots) {
    if (identity && root.dataset.eduEmergencyIdentity !== identity) continue;
    if (!root.isConnected || !visible(root, doc)) continue;
    const rect = root.getBoundingClientRect();
    const right = Math.min(rect.right, doc.documentElement.clientWidth || doc.defaultView?.innerWidth || 0);
    const bottom = Math.min(rect.bottom, doc.documentElement.clientHeight || doc.defaultView?.innerHeight || 0);
    const left = Math.max(0, rect.left);
    const top = Math.max(0, rect.top);
    if (right <= left || bottom <= top) continue;
    const hit = doc.elementFromPoint((left + right) / 2, (top + bottom) / 2);
    if (!hit || !root.contains(hit) || hit.closest('[data-edu-emergency-root]') !== root) continue;
    // A black media container is not the alert. Require decoded pixels at
    // the sampled point; a legible built-in fallback has its own root.
    if (root.dataset.eduEmergencyRoot === 'media') {
      // Passive playlist media uses pointer-events:none. Hit-testing then
      // reaches the root itself; inspect the visible media at that point,
      // but never accept a different overlaid control that hid the alert.
      const media = hit === root
        ? Array.from(root.querySelectorAll<HTMLImageElement | HTMLVideoElement>('img,video')).find(candidate => {
            const bounds = candidate.getBoundingClientRect();
            return visible(candidate, doc) && bounds.left <= (left + right) / 2 && bounds.right >= (left + right) / 2 && bounds.top <= (top + bottom) / 2 && bounds.bottom >= (top + bottom) / 2;
          })
        : hit;
      if (media?.tagName === 'IMG') {
        const image = media as HTMLImageElement;
        if (!image.complete || image.naturalWidth <= 0) continue;
      } else if (media?.tagName === 'VIDEO') {
        const video = media as HTMLVideoElement;
        if (video.readyState < 2 || video.videoWidth <= 0 || video.error) continue;
      } else continue;
    } else if (!root.textContent?.trim()) {
      // Message media can be the entire alert; a failed image cannot prove it.
      const media = root.querySelector<HTMLImageElement>('img');
      if (!media?.complete || media.naturalWidth <= 0 || !visible(media, doc)) continue;
    }
    return root;
  }
  return null;
}

export interface EmergencyPaintWatcherOptions {
  document: Document;
  documentId: string;
  expectedIdentity: () => string | null;
  raiseHold: () => void;
  requiresNativeValidation?: () => boolean;
  readChallenge: () => Promise<string | NativeEmergencyPaintState | undefined>;
  report: (proof: EmergencyPaintProof) => void;
  /** Fresh frame receipts retry independently from deduplicated API reports. */
  nativeReport?: (proof: EmergencyPaintProof) => void;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (id: number) => void;
}

export interface NativeEmergencyPaintState {
  challenge: string;
  status?: string;
  identity?: string;
  documentId?: string;
}

/**
 * Two distinct animation frames with the SAME visible alert and native
 * challenge. Stale content, a hidden root and a previous hold cannot satisfy
 * this watcher. It never releases a hold; only the live manifest may do that.
 */
export class EmergencyPaintWatcher {
  private identity: string | null = null;
  private challenge: string | undefined;
  private proof: EmergencyPaintProof | null = null;
  private sampledAt = 0;
  private generation = 0;
  private raf = 0;
  private reading = false;
  private stopped = false;
  private frames = 0;
  private nativeAccepted = false;
  private nativeAttempts = 0;
  private nativeStartedAt = 0;
  private nativeRequired = false;
  private reportedNativeRequired = false;
  constructor(private readonly options: EmergencyPaintWatcherOptions) {}

  current(nowMs = Date.now()): EmergencyPaintProof | null {
    // Latch independently of a successful challenge read, including when the
    // bridge appears after this monitor mounted. DOM hit-testing cannot see a
    // native surface covering the WebView.
    this.nativeRequired ||= !!this.challenge || !!this.options.requiresNativeValidation?.();
    if (!this.proof || !this.identity) return null;
    const proof = this.nativeRequired ? { ...this.proof, nativeRequired: true } : this.proof;
    if (proof.painted && ((this.nativeRequired && (!this.challenge || !this.nativeAccepted)) ||
      nowMs - this.sampledAt > 1500 || !visibleEmergencyRoot(this.options.document, this.identity))) {
      return { ...proof, painted: false };
    }
    return proof;
  }

  private reportCurrent(): void {
    const proof = this.current();
    if (!proof) return;
    this.reportedNativeRequired = this.nativeRequired;
    this.options.report(proof);
  }

  scan(): void {
    if (this.stopped) return;
    const expected = this.options.expectedIdentity();
    // A polled message may cover a tenant alert. Prove only the actual top
    // emergency, under its own identity; never certify the covered alert.
    const root = visibleEmergencyRoot(this.options.document);
    const identity = root?.dataset.eduEmergencyIdentity || expected;
    if (identity !== this.identity) {
      this.generation += 1;
      this.options.cancelFrame(this.raf);
      this.raf = 0;
      this.identity = identity;
      this.challenge = undefined;
      this.proof = null;
      this.nativeAccepted = false;
      this.nativeAttempts = 0;
      this.nativeStartedAt = 0;
      if (identity) {
        // Synchronous and BEFORE any bridge round trip or paint wait.
        this.options.raiseHold();
        this.proof = { identity, documentId: this.options.documentId, frames: this.frames, painted: false };
        this.reportCurrent();
      }
    }
    if (!identity) return;
    this.current();
    if (this.nativeRequired && !this.reportedNativeRequired) this.reportCurrent();
    if (!this.reading) {
      this.reading = true;
      const generation = this.generation;
      this.options.readChallenge().then(state => {
        if (this.stopped || generation !== this.generation) return;
        const challenge = typeof state === 'string' ? state : state?.challenge;
        if (challenge !== this.challenge) {
          this.generation += 1;
          this.challenge = challenge;
          this.options.cancelFrame(this.raf);
          this.raf = 0;
          this.nativeAccepted = false;
          this.nativeAttempts = 0;
          this.nativeStartedAt = 0;
          this.proof = { identity, documentId: this.options.documentId, frames: this.frames, painted: false, ...(challenge ? { challenge } : {}) };
        }
        if (challenge && typeof state === 'object' && state.status === 'painted' &&
          challenge === this.challenge && state.identity === this.identity && state.documentId === this.options.documentId && !this.nativeAccepted) {
          this.nativeAccepted = true;
          const proof = this.current();
          if (proof?.painted) this.reportCurrent();
        }
      }).catch(() => { /* wake/bridge failures cannot block drawing */ }).finally(() => { this.reading = false; });
    }
    if (!root || this.raf) return;
    const generation = this.generation;
    this.raf = this.options.requestFrame(() => {
      if (this.stopped || generation !== this.generation || !visibleEmergencyRoot(this.options.document, identity)) { this.raf = 0; return; }
      this.frames += 1;
      this.raf = this.options.requestFrame(() => {
        this.raf = 0;
        if (this.stopped || generation !== this.generation || !visibleEmergencyRoot(this.options.document, identity)) return;
        this.frames += 1;
        const first = !this.proof?.painted;
        this.sampledAt = Date.now();
        this.proof = { identity, documentId: this.options.documentId, frames: this.frames, painted: true, ...(this.challenge ? { challenge: this.challenge } : {}) };
        if (this.challenge && !this.nativeAccepted && this.nativeAttempts < 40) {
          const now = Date.now();
          if (!this.nativeStartedAt) this.nativeStartedAt = now;
          if (now - this.nativeStartedAt <= 10_000) {
            this.nativeAttempts += 1;
            // The app needs fresh DOM samples to validate its own window.
            // Delivery stays pending until its exact acknowledgment arrives.
            this.options.nativeReport?.({ ...this.proof, nativeRequired: true });
          }
        }
        if (first) this.reportCurrent();
      });
    });
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.options.cancelFrame(this.raf);
  }
}
