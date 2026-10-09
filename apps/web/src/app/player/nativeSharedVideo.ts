/** Optional, explicitly scoped renderer. Identity goes to native; URLs and tokens never do. */
export interface NativeSharedVideoDescriptor {
  version: 1;
  screenId: string; tenantId: string; primaryScreenId: string; peerScreenId: string;
  faceIndex: number; revision: string;
  asset: { id: string; url: string; sha256: string; size: number; width: number; height: number; fps: number };
  transform: { orientation: 'PORTRAIT' | 'LANDSCAPE' | 'AUTO'; rotation: 0 | 90 | 180 | 270; fit: 'fill' };
}

export interface NativeSharedVideoState {
  version: 1;
  state: 'idle' | 'preparing' | 'ready' | 'presenting' | 'failed';
  sessionId: string; revision: string; sha256: string; faceIndex: number;
  reason?: string;
  output?: {
    attached: boolean; visible: boolean; viewUpdates: number; uniqueFrames: number;
    sourcePtsUs: number; width: number; height: number; lastUpdateElapsedMs: number;
    hardwareAccelerated: boolean;
  };
  codecName?: string; elapsedMs?: number; stalls?: number; loops?: number;
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 128): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function readNativeSharedVideoDescriptor(value: unknown): NativeSharedVideoDescriptor | null {
  if (!record(value) || value.version !== 1 || !uuid(value.screenId) || !uuid(value.tenantId) ||
    !uuid(value.primaryScreenId) || !uuid(value.peerScreenId) || value.screenId === value.peerScreenId ||
    !count(value.faceIndex) || value.faceIndex > 1 || !text(value.revision) ||
    (value.faceIndex === 0 ? value.screenId !== value.primaryScreenId : value.peerScreenId !== value.primaryScreenId)) return null;
  const a = value.asset, t = value.transform;
  if (!record(a) || !uuid(a.id) || !text(a.url, 4096) || !/^[a-f0-9]{64}$/i.test(String(a.sha256)) ||
    !count(a.size) || a.size === 0 || a.size > 512 * 1024 * 1024 || !count(a.width) || a.width < 16 || a.width > 4096 || !count(a.height) || a.height < 16 || a.height > 4096 || !positive(a.fps) || a.fps > 30 ||
    !record(t) || !['PORTRAIT', 'LANDSCAPE', 'AUTO'].includes(String(t.orientation)) ||
    ![0, 90, 180, 270].includes(Number(t.rotation)) || t.fit !== 'fill') return null;
  try { const u = new URL(a.url); if (u.protocol !== 'https:' || u.hostname !== 'bhdaxzfalaycfopvcopm.supabase.co' || u.username || u.password || u.hash || (u.port && u.port !== '443') || !/^\/storage\/v1\/object\/(public|sign)\/assets\//.test(u.pathname) || /[%\\]/.test(u.pathname)) return null; } catch { return null; }
  return { version: 1, screenId: value.screenId, tenantId: value.tenantId,
    primaryScreenId: value.primaryScreenId, peerScreenId: value.peerScreenId, faceIndex: value.faceIndex,
    revision: value.revision, asset: { id: a.id, url: a.url, sha256: String(a.sha256).toLowerCase(),
      size: a.size, width: a.width, height: a.height, fps: a.fps },
    transform: { orientation: t.orientation as NativeSharedVideoDescriptor['transform']['orientation'],
      rotation: t.rotation as NativeSharedVideoDescriptor['transform']['rotation'], fit: 'fill' } };
}

/** Copy only bounded native facts; a bridge response cannot inject arbitrary fields into telemetry. */
export function readNativeSharedVideoState(raw: unknown): NativeSharedVideoState | null {
  let v: unknown = raw;
  try { if (typeof raw === 'string') { if (raw.length > 4096) return null; v = JSON.parse(raw); } } catch { return null; }
  if (!record(v) || v.version !== 1 || !['idle','preparing','ready','presenting','failed'].includes(String(v.state))) return null;
  if (v.state === 'idle') return { version: 1, state: 'idle', sessionId: '', revision: '', sha256: '', faceIndex: 0 };
  if (!uuid(v.sessionId) || !text(v.revision) || !/^[a-f0-9]{64}$/i.test(String(v.sha256)) ||
    !count(v.faceIndex) || v.faceIndex > 1) return null;
  const s: NativeSharedVideoState = { version: 1, state: v.state as NativeSharedVideoState['state'],
    sessionId: v.sessionId, revision: v.revision, sha256: String(v.sha256).toLowerCase(), faceIndex: v.faceIndex };
  // Diagnostic reasons are codes, not native exception text/URLs/credentials.
  if (typeof v.reason === 'string' && /^[a-z0-9-]{1,64}$/i.test(v.reason)) s.reason = v.reason;
  const o = v.output;
  if (record(o) && typeof o.attached === 'boolean' && typeof o.visible === 'boolean' &&
    typeof o.hardwareAccelerated === 'boolean' &&
    ['viewUpdates','uniqueFrames','sourcePtsUs','width','height','lastUpdateElapsedMs'].every(k => count(o[k]))) {
    s.output = { attached: o.attached, visible: o.visible, hardwareAccelerated: o.hardwareAccelerated,
      viewUpdates: o.viewUpdates as number, uniqueFrames: o.uniqueFrames as number, sourcePtsUs: o.sourcePtsUs as number,
      width: o.width as number, height: o.height as number, lastUpdateElapsedMs: o.lastUpdateElapsedMs as number };
  }
  if (typeof v.codecName === 'string' && /^[a-z0-9_.-]{1,128}$/i.test(v.codecName)) s.codecName = v.codecName;
  for (const k of ['elapsedMs','stalls','loops'] as const) if (count(v[k])) s[k] = v[k];
  return s;
}

export function sharedVideoEligible(d: NativeSharedVideoDescriptor | null, context: {
  screenId: string | null; tenantId: string | null; assetId: string; sha256: string;
  solo: boolean; muted: boolean; active: boolean; emergency: boolean; sync: boolean; preview: boolean;
}): d is NativeSharedVideoDescriptor {
  return !!d && d.screenId === context.screenId && d.tenantId === context.tenantId &&
    d.asset.id === context.assetId && d.asset.sha256 === context.sha256.toLowerCase() &&
    context.solo && context.muted && context.active && !context.emergency && !context.sync && !context.preview;
}

export function sharedVideoIdentity(d: NativeSharedVideoDescriptor): string {
  return JSON.stringify([d.screenId,d.tenantId,d.revision,d.asset.id,d.asset.sha256,d.faceIndex,d.transform]);
}

export interface SharedVideoBridge {
  has(method: string): boolean;
  fire(method: string, arg: string): boolean;
  state(): Promise<unknown>;
}
export const SHARED_VIDEO_METHODS = ['sharedVideoPrepare','sharedVideoCommit','sharedVideoStop','sharedVideoState'] as const;

/** One attempt per mounted identity. Polls are single-flight and also renew native's face lease. */
export class SharedVideoController {
  private cancelled = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private session = '';
  private committed = false;
  private ready = false;
  private startedAt: number;
  private commitAt = 0;
  private lastFrames = 0;
  private lastAdvance = 0;
  constructor(private descriptor: NativeSharedVideoDescriptor, private bridge: SharedVideoBridge,
    private callbacks: { ready(): void; update(state: NativeSharedVideoState, fresh: boolean): void; fallback(): void },
    private now: () => number = () => performance.now()) { this.startedAt = now(); }

  start(): void {
    if (!SHARED_VIDEO_METHODS.every(m => this.bridge.has(m))) { this.fail(); return; }
    const d = this.descriptor;
    if (!this.bridge.fire('sharedVideoPrepare', JSON.stringify({version:1,screenId:d.screenId,revision:d.revision,sha256:d.asset.sha256}))) {
      this.fail(); return;
    }
    void this.poll();
  }
  commit(): void {
    if (this.cancelled || !this.ready || this.committed || !this.session) return;
    this.committed = true; this.commitAt = this.now();
    if (!this.bridge.fire('sharedVideoCommit', this.session)) this.fail();
  }
  stop(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    if (this.timer !== null) clearTimeout(this.timer);
    if (this.session) this.bridge.fire('sharedVideoStop', this.session);
  }
  private fail(): void { if (this.cancelled) return; this.stop(); this.callbacks.fallback(); }
  private async poll(): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // Keep bounded even when a channel reply never arrives. A late reply is used ONLY to stop its old session.
    const response = Promise.resolve().then(() => this.bridge.state()).then(raw => {
      const s = readNativeSharedVideoState(raw);
      if (this.cancelled && s && this.matches(s) && this.session && s.sessionId === this.session) this.bridge.fire('sharedVideoStop', s.sessionId);
      return s;
    });
    let s: NativeSharedVideoState | null;
    try { s = await Promise.race([response, new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 2000); })]); }
    catch { s = null; }
    if (timeout !== undefined) clearTimeout(timeout);
    if (this.cancelled) return;
    if (!s || (s.state !== 'idle' && !this.matches(s))) { this.fail(); return; }
    if (this.committed && s.sessionId !== this.session) { this.fail(); return; }
    if (s.sessionId) this.session = s.sessionId;
    if (s.state === 'failed') { this.callbacks.update(s, false); this.fail(); return; }
    const now = this.now();
    if (s.state === 'ready' && !this.ready) { this.ready = true; this.callbacks.ready(); }
    if (s.state === 'presenting') {
      if (!this.committed) { this.fail(); return; }
      const o = s.output;
      if (o && o.attached && o.visible && o.uniqueFrames > this.lastFrames && o.viewUpdates > 0) {
        this.lastFrames = o.uniqueFrames; this.lastAdvance = now;
      }
    }
    const fresh = s.state === 'presenting' && !!s.output?.attached && !!s.output?.visible &&
      this.lastFrames > 0 && now - this.lastAdvance <= 2500;
    this.callbacks.update(s, fresh);
    if ((!this.committed && now - this.startedAt > 330000) ||
      (this.committed && !fresh && now - (this.lastAdvance || this.commitAt) > 5000)) { this.fail(); return; }
    this.timer = setTimeout(() => { void this.poll(); }, 500);
  }
  private matches(s: NativeSharedVideoState): boolean {
    return s.revision === this.descriptor.revision && s.sha256 === this.descriptor.asset.sha256 && s.faceIndex === this.descriptor.faceIndex;
  }
}

/** Document-local evidence, never borrowed from another face or from browser rAF. */
export class SharedVideoEvidence {
  private owner: object | null = null;
  private selected = false;
  private state: NativeSharedVideoState | null = null;
  private receivedAt = 0;
  private advancedAt = 0;
  private frames = 0;
  private reportedSession = '';
  private reportedFrames = 0;
  select(owner: object): void { this.owner = owner; this.selected = true; this.state = null; this.frames = 0; this.advancedAt = 0; }
  update(owner: object, state: NativeSharedVideoState, fresh: boolean, now: number): void {
    if (owner !== this.owner) return;
    this.state = state; this.receivedAt = now;
    if (fresh && (state.output?.uniqueFrames ?? 0) > this.frames) {
      this.frames = state.output!.uniqueFrames; this.advancedAt = now;
    }
  }
  clear(owner: object): void { if (owner === this.owner) { this.owner = null; this.selected = false; this.state = null; } }
  isSelected(): boolean { return this.selected; }
  canProve(now: number): boolean {
    const s = this.state;
    return !!s && s.state === 'presenting' && !!s.output?.attached && !!s.output?.visible && this.frames > 0 &&
      now - this.advancedAt <= 2500 && now - this.receivedAt <= 2500 &&
      (s.sessionId !== this.reportedSession || this.frames > this.reportedFrames);
  }
  commitProof(): void { this.reportedSession = this.state?.sessionId ?? ''; this.reportedFrames = this.frames; }
  telemetry(): NativeSharedVideoState | null { return this.state?.sessionId ? this.state : null; }
}
export const nativeSharedVideoEvidence = new SharedVideoEvidence();
