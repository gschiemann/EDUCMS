/**
 * nativeBridge transport tests (AND-002).
 *
 * The thing these protect is the SEQUENCING RULE: the APK and this web
 * bundle deploy independently, so BOTH transports must stay live and the
 * module must silently pick the right one per frame. A regression here is
 * not a bug report — it is a hallway display that stops answering the
 * lockdown channel, on whichever half of the fleet updated first.
 *
 * The four field combinations, all covered below:
 *   new APK + new web -> 'channel'   new APK + old web -> (old bundle, n/a)
 *   old APK + new web -> 'legacy'    browser player    -> 'none'
 *
 * Module state (`pending`, `listenerAttached`, `seq`) is module-level, so
 * every test loads a FRESH copy via `loadBridge()`.
 */

type BridgeModule = typeof import('../nativeBridge');

/** A stand-in for the JS object `WebViewCompat.addWebMessageListener` injects. */
class FakeChannel {
  posted: string[] = [];
  private listeners: Array<(ev: { data?: unknown }) => void> = [];
  /** When true, postMessage throws — exercises the fall-through to legacy. */
  throwOnPost = false;
  /** When false, only the `onmessage` property is offered (no addEventListener). */
  constructor(private readonly supportsAddEventListener = true) {
    if (!supportsAddEventListener) {
      // Remove the method so the module takes the `onmessage` path.
      (this as { addEventListener?: unknown }).addEventListener = undefined;
    }
  }
  onmessage: ((ev: { data?: unknown }) => void) | null = null;

  postMessage(message: string): void {
    if (this.throwOnPost) throw new Error('channel is gone');
    this.posted.push(message);
  }

  addEventListener(type: string, listener: (ev: { data?: unknown }) => void): void {
    if (type === 'message') this.listeners.push(listener);
  }

  /** Simulate the APK replying. */
  deliver(payload: unknown): void {
    const ev = { data: typeof payload === 'string' ? payload : JSON.stringify(payload) };
    for (const l of this.listeners) l(ev);
    if (this.onmessage) this.onmessage(ev);
  }

  /** The `{id, method, args}` of the Nth message this channel received. */
  parsed(index = 0): { id?: string; method?: string; args?: unknown[] } {
    return JSON.parse(this.posted[index] ?? '{}');
  }
}

function loadBridge(): BridgeModule {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return jest.requireActual('../nativeBridge') as BridgeModule;
}

const w = () => window as unknown as Record<string, unknown>;

function clearGlobals() {
  delete w().EduCmsNativeChannel;
  delete w().EduCmsNative;
  delete w().__eduCmsNativeChannelMethods;
}

/** A stand-in for the legacy `addJavascriptInterface` object. */
function makeLegacy(overrides: Record<string, unknown> = {}) {
  return {
    reload: jest.fn(),
    unpair: jest.fn(),
    deviceInfo: jest.fn(() => '{"model":"legacy"}'),
    ctsSerialEnabled: jest.fn(() => true),
    ...overrides,
  };
}

beforeEach(() => {
  clearGlobals();
  jest.restoreAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  clearGlobals();
  jest.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────
describe('bridgeTransport — which surface this frame will use', () => {
  it('reports "none" in a browser player (no APK at all)', () => {
    const b = loadBridge();
    expect(b.bridgeTransport()).toBe('none');
    expect(b.hasNativeBridge()).toBe(false);
  });

  it('reports "legacy" on an old APK (only window.EduCmsNative)', () => {
    w().EduCmsNative = makeLegacy();
    const b = loadBridge();
    expect(b.bridgeTransport()).toBe('legacy');
    expect(b.hasNativeBridge()).toBe(true);
  });

  it('reports "channel" and PREFERS it when both surfaces are present', () => {
    // This is the real shipped state for one release: the APK attaches
    // addJavascriptInterface AND the origin-scoped channel.
    w().EduCmsNativeChannel = new FakeChannel();
    w().EduCmsNative = makeLegacy();
    const b = loadBridge();
    expect(b.bridgeTransport()).toBe('channel');
  });

  it('ignores a malformed channel object (no postMessage) and falls back', () => {
    w().EduCmsNativeChannel = { nope: true };
    w().EduCmsNative = makeLegacy();
    const b = loadBridge();
    expect(b.bridgeTransport()).toBe('legacy');
  });
});

// ─────────────────────────────────────────────────────────────────
describe('nativeFire — void methods, synchronous, never throws', () => {
  it('posts an id-LESS message over the channel and does NOT touch legacy', () => {
    const ch = new FakeChannel();
    const legacy = makeLegacy();
    w().EduCmsNativeChannel = ch;
    w().EduCmsNative = legacy;
    const b = loadBridge();

    expect(b.nativeFire('reload')).toBe(true);
    expect(ch.posted).toHaveLength(1);
    const msg = ch.parsed();
    expect(msg.method).toBe('reload');
    // No `id` => the APK runs the handler and skips the reply. That is
    // what keeps fire-and-forget calls from leaving a pending timer.
    expect(msg.id).toBeUndefined();
    expect(legacy.reload).not.toHaveBeenCalled();
  });

  it('passes arguments through in order', () => {
    const ch = new FakeChannel();
    w().EduCmsNativeChannel = ch;
    const b = loadBridge();

    b.nativeFire('setBootstrap', 'https://api.example', 'android-abc');
    expect(ch.parsed().args).toEqual(['https://api.example', 'android-abc']);
  });

  it('falls back to the legacy object when the channel post throws', () => {
    const ch = new FakeChannel();
    ch.throwOnPost = true;
    const legacy = makeLegacy();
    w().EduCmsNativeChannel = ch;
    w().EduCmsNative = legacy;
    const b = loadBridge();

    expect(b.nativeFire('reload')).toBe(true);
    expect(legacy.reload).toHaveBeenCalledTimes(1);
  });

  it('calls the legacy method when there is no channel', () => {
    const legacy = makeLegacy();
    w().EduCmsNative = legacy;
    const b = loadBridge();

    expect(b.nativeFire('unpair')).toBe(true);
    expect(legacy.unpair).toHaveBeenCalledTimes(1);
  });

  it('returns FALSE with no transport, so callers run their web fallback', () => {
    const b = loadBridge();
    // e.g. `if (!nativeFire('reload')) hardCacheBustingReload();`
    expect(b.nativeFire('reload')).toBe(false);
  });

  it('returns FALSE when the legacy object lacks the method', () => {
    w().EduCmsNative = { reload: jest.fn() };
    const b = loadBridge();
    expect(b.nativeFire('exitToDeviceHome')).toBe(false);
  });

  it('never throws when the legacy method itself throws', () => {
    w().EduCmsNative = makeLegacy({
      reload: jest.fn(() => { throw new Error('native blew up'); }),
    });
    const b = loadBridge();
    expect(() => b.nativeFire('reload')).not.toThrow();
    expect(b.nativeFire('reload')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('nativeCall — value-returning methods', () => {
  it('resolves with the result of the matching channel reply', async () => {
    const ch = new FakeChannel();
    w().EduCmsNativeChannel = ch;
    const b = loadBridge();

    const p = b.nativeCall<string>('deviceInfo');
    const { id, method } = ch.parsed();
    expect(method).toBe('deviceInfo');
    expect(typeof id).toBe('string');

    ch.deliver({ id, ok: true, result: '{"model":"EP6N"}' });
    await expect(p).resolves.toBe('{"model":"EP6N"}');
  });

  it('works when the channel only exposes `onmessage` (no addEventListener)', async () => {
    const ch = new FakeChannel(false);
    w().EduCmsNativeChannel = ch;
    const b = loadBridge();

    const p = b.nativeCall<boolean>('ctsSerialEnabled');
    ch.deliver({ id: ch.parsed().id, ok: true, result: true });
    await expect(p).resolves.toBe(true);
  });

  it('rejects with the native error when the reply is ok:false', async () => {
    const ch = new FakeChannel();
    w().EduCmsNativeChannel = ch;
    const b = loadBridge();

    const p = b.nativeCall('getRecentLogs');
    ch.deliver({ id: ch.parsed().id, ok: false, error: 'handler error' });
    await expect(p).rejects.toThrow('handler error');
  });

  it('keeps concurrent calls separate (replies are matched by id)', async () => {
    const ch = new FakeChannel();
    w().EduCmsNativeChannel = ch;
    const b = loadBridge();

    const a = b.nativeCall<string>('deviceInfo');
    const c = b.nativeCall<string>('checkForUpdates');
    const idA = ch.parsed(0).id;
    const idC = ch.parsed(1).id;
    expect(idA).not.toBe(idC);

    // Reply out of order — each promise must still get its own result.
    ch.deliver({ id: idC, ok: true, result: '1.0.74' });
    ch.deliver({ id: idA, ok: true, result: 'info' });
    await expect(a).resolves.toBe('info');
    await expect(c).resolves.toBe('1.0.74');
  });

  it('ignores junk and unknown-id replies without throwing', async () => {
    const ch = new FakeChannel();
    w().EduCmsNativeChannel = ch;
    const b = loadBridge();

    const p = b.nativeCall<string>('deviceInfo');
    expect(() => ch.deliver('not json at all')).not.toThrow();
    expect(() => ch.deliver({ ok: true, result: 'no id' })).not.toThrow();
    // A late reply for a call that already timed out / was never made.
    expect(() => ch.deliver({ id: 'stale-id', ok: true, result: 'x' })).not.toThrow();

    ch.deliver({ id: ch.parsed().id, ok: true, result: 'real' });
    await expect(p).resolves.toBe('real');
  });

  it('LEGACY FALLBACK: resolves with the synchronous return value', async () => {
    const legacy = makeLegacy();
    w().EduCmsNative = legacy;
    const b = loadBridge();

    await expect(b.nativeCall<string>('deviceInfo')).resolves.toBe('{"model":"legacy"}');
    expect(legacy.deviceInfo).toHaveBeenCalledTimes(1);
  });

  it('LEGACY FALLBACK: rejects when the method is missing', async () => {
    w().EduCmsNative = { reload: jest.fn() };
    const b = loadBridge();
    await expect(b.nativeCall('uploadDiagnostics')).rejects.toThrow(/unavailable/);
  });

  it('rejects when there is no bridge at all', async () => {
    const b = loadBridge();
    await expect(b.nativeCall('deviceInfo')).rejects.toThrow(/no native bridge/);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('nativeCall — timeout path', () => {
  it('rejects when the APK never replies, and does not leak the pending entry', async () => {
    jest.useFakeTimers();
    const ch = new FakeChannel();
    w().EduCmsNativeChannel = ch;
    const b = loadBridge();

    const p = b.nativeCall<string>('getRecentLogs');
    const { id } = ch.parsed();

    jest.advanceTimersByTime(15_000);
    await expect(p).rejects.toThrow(/timeout: getRecentLogs/);

    // A reply that arrives AFTER the timeout must be dropped silently —
    // the entry is already gone, so this must not throw or double-settle.
    expect(() => ch.deliver({ id, ok: true, result: 'late' })).not.toThrow();
  });

  it('does NOT reject before the timeout elapses', async () => {
    jest.useFakeTimers();
    w().EduCmsNativeChannel = new FakeChannel();
    const b = loadBridge();

    const p = b.nativeCall('deviceInfo');
    const settled = jest.fn();
    p.then(settled, settled);

    jest.advanceTimersByTime(14_000);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    // Drain so the rejection is handled and Jest doesn't warn.
    jest.advanceTimersByTime(2_000);
    await expect(p).rejects.toThrow(/timeout/);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('nativeCallOr — total variant for empty-catch call sites', () => {
  it('returns the fallback when there is no bridge', async () => {
    const b = loadBridge();
    await expect(b.nativeCallOr(false, 'ctsSerialEnabled')).resolves.toBe(false);
  });

  it('returns the fallback on timeout', async () => {
    jest.useFakeTimers();
    w().EduCmsNativeChannel = new FakeChannel();
    const b = loadBridge();

    const p = b.nativeCallOr<string>('', 'ctsSerialStatus');
    jest.advanceTimersByTime(15_000);
    await expect(p).resolves.toBe('');
  });

  it('returns the fallback when native resolves null/undefined', async () => {
    const ch = new FakeChannel();
    w().EduCmsNativeChannel = ch;
    const b = loadBridge();

    // NativeBridgeChannel.replyOk omits `result` entirely when the Kotlin
    // handler returned null, so the web side sees `undefined`.
    const p = b.nativeCallOr<string>('fallback', 'ctsSerialStatus');
    ch.deliver({ id: ch.parsed().id, ok: true });
    await expect(p).resolves.toBe('fallback');
  });

  it('passes the real value through when native answers', async () => {
    w().EduCmsNative = makeLegacy();
    const b = loadBridge();
    await expect(b.nativeCallOr(false, 'ctsSerialEnabled')).resolves.toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('nativeHas — SYNCHRONOUS capability probe', () => {
  it('uses the document-start manifest when the channel published one', () => {
    w().EduCmsNativeChannel = new FakeChannel();
    w().__eduCmsNativeChannelMethods = ['reload', 'deviceInfo'];
    const b = loadBridge();

    expect(b.nativeHas('reload')).toBe(true);
    expect(b.nativeHas('deviceInfo')).toBe(true);
    // Not in the manifest => this APK does not implement it.
    expect(b.nativeHas('ctsSerialConnect2')).toBe(false);
  });

  it('assumes the current method set when the channel exists but no manifest does', () => {
    // A WebView without DOCUMENT_START_SCRIPT support.
    w().EduCmsNativeChannel = new FakeChannel();
    const b = loadBridge();

    expect(b.nativeHas('showUrlOverlay')).toBe(true);
    expect(b.nativeHas('ctsSerialStatus')).toBe(true);
    expect(b.nativeHas('ctsSerialConnect2')).toBe(false);
  });

  it('probes the legacy object when there is no channel', () => {
    w().EduCmsNative = makeLegacy();
    const b = loadBridge();

    expect(b.nativeHas('reload')).toBe(true);
    expect(b.nativeHas('openSettingsForManager')).toBe(false);
  });

  it('is false for everything with no bridge (browser player)', () => {
    const b = loadBridge();
    expect(b.nativeHas('reload')).toBe(false);
    expect(b.nativeHas('checkForUpdates')).toBe(false);
  });

  it('never advertises a dual-port ctsSerial*2 method — no APK implements them', () => {
    // Guards the CtsBridge port-2 branch: if this ever flips to true
    // without WebAppBridge.kt gaining the methods, the second-port effect
    // starts calling into a handler that does not exist.
    w().EduCmsNativeChannel = new FakeChannel();
    const b = loadBridge();
    for (const m of ['ctsSerialEnabled2', 'ctsSerialConnect2', 'ctsSerialDisconnect2', 'ctsSerialStatus2']) {
      expect(b.nativeHas(m)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────
describe('method tables stay in sync with the APK', () => {
  it('every advertised method is in exactly one of the two lists', () => {
    const b = loadBridge();
    const all = [...b.NATIVE_VOID_METHODS, ...b.NATIVE_VALUE_METHODS];
    expect(new Set(all).size).toBe(all.length);
    // Mirrors NativeBridgeChannel.METHODS in the APK. 17 → 21 on
    // 2026-08-13 when the display-control wave added probeDisplay (recon
    // F1's web half) plus displayCapabilities / displayApply /
    // displaySetSchedule; → 22 when the emergency interlock added
    // displayEmergencyHold (it was in the Kotlin allowlist but not here,
    // which is what turned the drift guard below red). The authoritative
    // check is that guard, which reads the Kotlin allowlist off disk; this
    // count is the cheap canary that still fires in a checkout without the
    // player sources.
    expect(all).toHaveLength(22);
  });

  it('the destructive methods every call site depends on are declared', () => {
    const b = loadBridge();
    const voids = b.NATIVE_VOID_METHODS as readonly string[];
    // exitToDeviceHome is the operator's escape hatch out of lock task
    // mode (MainActivity disengages before finishAffinity) — losing it
    // would strand a pinned kiosk.
    expect(voids).toContain('exitToDeviceHome');
    expect(voids).toContain('unpair');
    expect(voids).toContain('reload');
  });

  /**
   * DRIFT GUARD. The APK's `NativeBridgeChannel.METHODS` is the allowlist
   * the native side enforces; this module's two arrays are what the web
   * side will ever ask for and what `nativeHas` answers from when a
   * WebView has no DOCUMENT_START_SCRIPT. If a method is added to one and
   * not the other it fails ASYMMETRICALLY — still works on the legacy
   * transport, silently dropped on the secure channel — which is the
   * hardest possible version of this bug to find in the field.
   *
   * Skipped (not failed) when the Kotlin source isn't on disk, so a
   * web-only checkout still runs green.
   */
  it('matches NativeBridgeChannel.METHODS in the APK', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = jest.requireActual('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = jest.requireActual('path') as typeof import('path');
    const kt = path.resolve(
      __dirname,
      '../../../../../player/app/src/main/java/com/educms/player/security/NativeBridgeChannel.kt',
    );
    if (!fs.existsSync(kt)) {
      // eslint-disable-next-line no-console
      console.warn(`[nativeBridge.test] skipping APK drift check — ${kt} not found`);
      return;
    }
    const src = fs.readFileSync(kt, 'utf8');
    const block = /private val METHODS = arrayOf\(([\s\S]*?)\n\s*\)/.exec(src);
    expect(block).not.toBeNull();
    const nativeMethods = Array.from((block as RegExpExecArray)[1].matchAll(/"([A-Za-z0-9_]+)"/g))
      .map((m) => m[1]);

    const b = loadBridge();
    const webMethods = [...b.NATIVE_VOID_METHODS, ...b.NATIVE_VALUE_METHODS] as string[];
    expect([...nativeMethods].sort()).toEqual([...webMethods].sort());
  });
});
