/** Additive .35 primary-window contract; absent on older APKs. */
export interface NativeVideoAvailability {
  version: 1;
  foreground: boolean;
  interactive: boolean;
  focused: boolean;
  focusRequired: boolean;
  uiClear: boolean;
  ready: boolean;
  epoch: number;
}

export function readNativeVideoAvailability(raw: unknown): NativeVideoAvailability | null {
  try {
    const root = typeof raw === "string" && raw.length <= 16384 ? JSON.parse(raw) : raw;
    const a = root?.availability;
    if (root?.version !== 1 || root?.protocol !== 2 || a?.version !== 1 ||
      ![a.foreground, a.interactive, a.focused, a.focusRequired, a.uiClear, a.ready].every(v => typeof v === "boolean") ||
      !Number.isSafeInteger(a.epoch) || a.epoch < 0 ||
      a.ready !== (a.foreground && a.interactive && (!a.focusRequired || a.focused) && a.uiClear)) return null;
    return a;
  } catch { return null; }
}

export type NativeVideoAvailabilityProbe =
  | { kind: "supported"; availability: NativeVideoAvailability }
  | { kind: "legacy" }
  | { kind: "unknown" };

export function classifyNativeVideoAvailability(raw: unknown): NativeVideoAvailabilityProbe {
  const availability = readNativeVideoAvailability(raw);
  if (availability) return { kind: "supported", availability };
  try {
    const root = typeof raw === "string" && raw.length <= 16384 ? JSON.parse(raw) : raw;
    // Only a valid old reply proves absence. A transport failure or malformed
    // new contract never silently disables .35 recovery.
    if (root?.version === 1 && root?.protocol === 2 &&
      ["idle", "preparing", "ready", "presenting", "failed"].includes(root.state) &&
      !Object.prototype.hasOwnProperty.call(root, "availability")) return { kind: "legacy" };
  } catch { /* unknown */ }
  return { kind: "unknown" };
}

export async function probeNativeVideoAvailability(read: () => Promise<unknown>): Promise<NativeVideoAvailabilityProbe> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(read).then(classifyNativeVideoAvailability).catch(() => ({ kind: "unknown" } as const)),
      new Promise<NativeVideoAvailabilityProbe>(resolve => { timeout = setTimeout(() => resolve({ kind: "unknown" }), 2000); }),
    ]);
  } finally { if (timeout !== undefined) clearTimeout(timeout); }
}

export async function queryNativeVideoAvailability(read: () => Promise<unknown>): Promise<NativeVideoAvailability | null> {
  const p = await probeNativeVideoAvailability(read);
  return p.kind === "supported" ? p.availability : null;
}

/** Poll readiness, never a decoder. A ticket fires once, after a new ready epoch. */
export class NativeVideoResumeWaiter {
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private read: () => Promise<unknown>,
    private visible: () => boolean,
    private afterEpoch: number,
    private ready: (availability: NativeVideoAvailability) => void,
  ) {}
  start(): void { void this.poll(); }
  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
  }
  private async poll(): Promise<void> {
    if (this.stopped) return;
    const a = await queryNativeVideoAvailability(this.read);
    if (this.stopped) return;
    if (a?.ready && a.epoch > this.afterEpoch && this.visible()) {
      this.stop();
      this.ready(a);
      return;
    }
    this.timer = setTimeout(() => { void this.poll(); }, 500);
  }
}
