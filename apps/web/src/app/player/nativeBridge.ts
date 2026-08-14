/**
 * The one place the web player talks to the Android APK.
 *
 * ============================================================
 * WHY THIS MODULE EXISTS (AND-002, 2026-08-01 security remediation)
 * ============================================================
 *
 * The APK used to expose its ~17 native methods via
 * `WebView.addJavascriptInterface(bridge, "EduCmsNative")`. That injects
 * `window.EduCmsNative` into **every frame the WebView loads** — so the
 * operator-authored HTML boards and third-party iframes the player
 * mounts could call `unpair()`, `exitToDeviceHome()`, `setBootstrap()`
 * (the OTA trust anchor) and `uploadDiagnostics()` (ships the device log
 * off-box) just as easily as the player page could.
 *
 * The APK now ALSO exposes an origin-scoped channel
 * (`window.EduCmsNativeChannel`, via `WebViewCompat.addWebMessageListener`)
 * that the WebView only materialises in a MAIN FRAME whose origin is
 * exactly the compile-time player origin. This module prefers that
 * channel and falls back to the legacy object.
 *
 * ============================================================
 * ⚠️ BOTH TRANSPORTS ARE LIVE — DO NOT "SIMPLIFY" THIS AWAY
 * ============================================================
 *
 * The APK (GitHub Releases + OTA) and this web bundle (Vercel) deploy
 * INDEPENDENTLY, and the player's service worker can serve a cached web
 * bundle for a long time. So at any moment the field contains:
 *
 *   - new APK + new web  → channel   (the goal)
 *   - new APK + old web  → legacy    (old bundle only knows EduCmsNative)
 *   - old APK + new web  → legacy    (this module's fallback)
 *   - browser player     → none      (no APK at all)
 *
 * Every one of those must keep working. Removing the legacy fallback
 * here, or `addJavascriptInterface` on the native side, is a fleet-wide
 * outage until the removal criteria in the Kotlin
 * `NativeBridgeChannel` header are ALL met.
 *
 * ============================================================
 * SYNC → ASYNC
 * ============================================================
 *
 * `addJavascriptInterface` methods returned values SYNCHRONOUSLY.
 * `addWebMessageListener` is message-passing only, so the eight
 * value-returning methods are Promise-based here (`nativeCall`). The
 * nine fire-and-forget ones stay synchronous (`nativeFire`).
 *
 * Capability checks (`nativeHas`) stay SYNCHRONOUS on purpose — several
 * call sites decide what to RENDER based on them, and awaiting a round
 * trip would flash the wrong UI. The APK publishes its method list at
 * document start as `window.__eduCmsNativeChannelMethods`.
 */

/** Methods that return a value — use `nativeCall` (Promise). */
export const NATIVE_VALUE_METHODS = [
  'deviceInfo',
  'checkForUpdates',
  'getRecentLogs',
  'uploadDiagnostics',
  'ctsSerialEnabled',
  'ctsSerialConnect',
  'ctsSerialDisconnect',
  'ctsSerialStatus',
  // ── Display control (2026-08-13 wave) ──────────────────────────────
  // The web half of the registration the player wave explicitly handed
  // over: all four already exist in the APK's `NativeBridgeChannel.METHODS`
  // and in its dispatch `when`, but were missing HERE, which left the drift
  // guard in nativeBridge.test.ts red and made `nativeHas()` answer FALSE
  // for them on any channel-transport WebView with no document-start
  // manifest — i.e. the capability probe and every display mutator looked
  // unavailable on exactly the devices the secure channel was built for.
  //
  // `probeDisplay` is the older half of the same bug (recon F1): it had a
  // dispatch arm but no METHODS entry, so it only ever worked over the
  // legacy `window.EduCmsNative` object. The player wave fixed the native
  // side; this is its web counterpart.
  //
  // ⚠️ `displayApply` and `displaySetSchedule` are channel-ONLY by design —
  // their `@JavascriptInterface` twins refuse the legacy every-frame
  // transport (`{ok:false,code:'insecure-transport'}`) whenever the
  // origin-scoped channel is live, because that legacy surface reaches
  // operator-authored board HTML and the worst case there is a hostile
  // board blanking a wall-mounted screen.
  'probeDisplay',
  'displayCapabilities',
  // One-tap device-admin enrolment. Returns a JSON status string; it is what
  // makes DeviceAdminBlankProvider reachable (lockNow() needs an ACTIVE admin,
  // which is NOT device owner — no factory reset, no adb, one operator tap).
  // Must stay in lockstep with NativeBridgeChannel.METHODS; the drift guard
  // asserts sorted equality across the two.
  'displayEnrollAdmin',
  'displayApply',
  'displaySetSchedule',
] as const;

/** Methods with no return value — use `nativeFire` (sync, void). */
export const NATIVE_VOID_METHODS = [
  'exitToDeviceHome',
  'unpair',
  'reload',
  'heartbeat',
  'setOrientation',
  'setBootstrap',
  'showUrlOverlay',
  'hideUrlOverlay',
  'openSettingsForManager',
  // ⚠️ LIFE SAFETY — the display-control EMERGENCY INTERLOCK (2026-08-13).
  // See ./emergencyHold.ts. The Kotlin allowlist
  // (`NativeBridgeChannel.METHODS`, commit 3e9f7cd1) carries it, so this
  // entry is what keeps the two sides in sync: the drift guard in
  // `nativeBridge.test.ts` reads that Kotlin array off disk and asserts
  // sorted equality against these two arrays, and it was RED without this
  // line (`web-jest` is a blocking Deploy Reliability job). The functional
  // half matters too — `nativeHas('displayEmergencyHold')` answers from
  // KNOWN_METHODS on a channel WebView with no document-start manifest, and
  // was answering FALSE for a method the APK does implement.
  'displayEmergencyHold',
] as const;

/**
 * Every method the CURRENT APK implements. Used as the capability answer
 * when the channel is present but the method manifest isn't (a WebView
 * without DOCUMENT_START_SCRIPT support) — if the channel exists at all,
 * the APK is new enough to have the full set.
 */
const KNOWN_METHODS: readonly string[] = [
  ...NATIVE_VOID_METHODS,
  ...NATIVE_VALUE_METHODS,
];

/** How long to wait for a native reply before giving up. */
const CALL_TIMEOUT_MS = 15_000;

export type BridgeTransport = 'channel' | 'legacy' | 'none';

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

interface NativeChannel {
  postMessage: (message: string) => void;
  addEventListener?: (type: string, listener: (ev: { data?: unknown }) => void) => void;
  onmessage?: ((ev: { data?: unknown }) => void) | null;
}

const pending = new Map<string, Pending>();
let listenerAttached = false;
let seq = 0;

function win(): any | null {
  return typeof window === 'undefined' ? null : (window as any);
}

/**
 * The origin-scoped channel object, if the APK injected one into THIS
 * frame. Absent in the browser player, on an old APK, and — by design —
 * inside every sandboxed board iframe.
 */
function getChannel(): NativeChannel | null {
  const w = win();
  if (!w) return null;
  // Name must match NativeBridgeChannel.JS_OBJECT_NAME in the APK.
  const ch = w.EduCmsNativeChannel;
  if (!ch || typeof ch.postMessage !== 'function') return null;
  return ch as NativeChannel;
}

/** The legacy `addJavascriptInterface` object. See the header. */
function getLegacy(): any | null {
  const w = win();
  if (!w) return null;
  return w.EduCmsNative ?? null;
}

/**
 * Which transport this frame will actually use. Exposed so diagnostics
 * (and, eventually, fleet telemetry) can answer "is any screen still on
 * the legacy bridge?" — that is removal criterion #3 for deleting
 * `addJavascriptInterface`.
 *
 * ⚠️ NOT YET REPORTED TO THE SERVER. Wiring this into the render-proof /
 * heartbeat payload is a prerequisite for that removal; until then the
 * only fleet-wide signal is `deviceInfo().secureBridge` from the APK.
 */
export function bridgeTransport(): BridgeTransport {
  if (getChannel()) return 'channel';
  if (getLegacy()) return 'legacy';
  return 'none';
}

/** True when this frame can reach the APK at all (either transport). */
export function hasNativeBridge(): boolean {
  return bridgeTransport() !== 'none';
}

/**
 * Synchronous capability check — the replacement for the old
 * `typeof bridge.someMethod === 'function'` idiom.
 */
export function nativeHas(method: string): boolean {
  const w = win();
  if (!w) return false;
  if (getChannel()) {
    const manifest = w.__eduCmsNativeChannelMethods;
    if (Array.isArray(manifest)) return manifest.indexOf(method) !== -1;
    // Channel present but no document-start manifest — assume the
    // current method set (see KNOWN_METHODS).
    return KNOWN_METHODS.indexOf(method) !== -1;
  }
  const legacy = getLegacy();
  if (legacy) {
    try {
      return typeof legacy[method] === 'function';
    } catch {
      return false;
    }
  }
  return false;
}

function attachListener(ch: NativeChannel): void {
  if (listenerAttached) return;
  const onMessage = (ev: { data?: unknown }) => {
    let payload: any;
    try {
      const raw = ev?.data;
      if (typeof raw !== 'string' || !raw) return;
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    const id = payload?.id;
    if (typeof id !== 'string') return;
    const entry = pending.get(id);
    if (!entry) return; // late reply after a timeout
    pending.delete(id);
    clearTimeout(entry.timer);
    if (payload.ok) entry.resolve(payload.result);
    else entry.reject(new Error(String(payload.error ?? 'native bridge error')));
  };
  try {
    if (typeof ch.addEventListener === 'function') {
      ch.addEventListener('message', onMessage);
    } else {
      ch.onmessage = onMessage;
    }
    listenerAttached = true;
  } catch (err) {
    console.warn('[nativeBridge] could not attach channel listener', err);
  }
}

/**
 * Fire a native method that returns nothing. Synchronous and total — it
 * never throws. Returns false when no transport could take it, so call
 * sites can run their browser fallback (e.g. `window.location.reload()`).
 */
export function nativeFire(method: string, ...args: unknown[]): boolean {
  const ch = getChannel();
  if (ch) {
    try {
      // No `id` → the APK does not send a reply.
      ch.postMessage(JSON.stringify({ method, args }));
      return true;
    } catch (err) {
      console.warn(`[nativeBridge] channel post failed for ${method}`, err);
      // fall through to legacy
    }
  }
  const legacy = getLegacy();
  if (legacy) {
    try {
      if (typeof legacy[method] === 'function') {
        legacy[method](...args);
        return true;
      }
    } catch (err) {
      console.warn(`[nativeBridge] legacy call failed for ${method}`, err);
    }
  }
  return false;
}

/** What a transport could tell us about a fire-and-forget call. */
export interface NativeFireOutcome {
  /** Which transport took (or refused) the call. */
  transport: BridgeTransport;
  /** True when SOME transport accepted the call for delivery. */
  delivered: boolean;
  /**
   * The synchronous return value — ONLY ever populated on the `legacy`
   * transport, whose `@JavascriptInterface` methods return in-band. The
   * channel is message-passing, so a call posted without an `id` gets no
   * reply and this stays `undefined` there.
   */
  result?: unknown;
}

/**
 * `nativeFire`, but it hands back what the transport could observe.
 *
 * ⚠️ WHY THIS EXISTS (2026-08-13, emergency-interlock release bug).
 * Several display-control entry points RETURN a refusal instead of
 * throwing — `DisplayControlApi` answers `{ok:false,code:'insecure-transport'}`
 * for a risk-direction action that arrived on the untrusted every-frame
 * bridge. `nativeFire` reports only "a transport took it", which is TRUE for
 * a refusal, so a caller that latched on `nativeFire`'s boolean recorded a
 * refused call as applied and never retried it. That is exactly how an
 * emergency hold could be RAISED but never RELEASED on a Chromium-83/87
 * NovaStar Taurus (where the origin-scoped channel cannot attach), pinning
 * the panel lit forever and killing all display control on that screen.
 *
 * Still total: it never throws, for the same reason `nativeFire` doesn't.
 */
export function nativeFireChecked(method: string, ...args: unknown[]): NativeFireOutcome {
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage(JSON.stringify({ method, args }));
      return { transport: 'channel', delivered: true };
    } catch (err) {
      console.warn(`[nativeBridge] channel post failed for ${method}`, err);
      // fall through to legacy, same as nativeFire
    }
  }
  const legacy = getLegacy();
  if (legacy) {
    try {
      if (typeof legacy[method] === 'function') {
        const result = legacy[method](...args);
        return { transport: 'legacy', delivered: true, result };
      }
      // Method absent on this APK — the native feature does not exist here.
      return { transport: 'legacy', delivered: false };
    } catch (err) {
      console.warn(`[nativeBridge] legacy call failed for ${method}`, err);
      return { transport: 'legacy', delivered: false };
    }
  }
  return { transport: 'none', delivered: false };
}

/**
 * Call a native method that returns a value.
 *
 * REJECTS when there is no bridge, the method is missing, native threw,
 * or the reply didn't arrive within {@link CALL_TIMEOUT_MS}, so a call
 * site keeps the same try/catch shape the synchronous version had. Use
 * {@link nativeCallOr} when the only handling was an empty catch.
 */
export function nativeCall<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  const ch = getChannel();
  if (ch) {
    attachListener(ch);
    return new Promise<T>((resolve, reject) => {
      seq += 1;
      const id = `${Date.now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`native bridge timeout: ${method}`));
      }, CALL_TIMEOUT_MS);
      pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      try {
        ch.postMessage(JSON.stringify({ id, method, args }));
      } catch (err) {
        pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  const legacy = getLegacy();
  if (legacy) {
    try {
      if (typeof legacy[method] !== 'function') {
        return Promise.reject(new Error(`native bridge method unavailable: ${method}`));
      }
      // Legacy @JavascriptInterface methods return synchronously.
      return Promise.resolve(legacy[method](...args) as T);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }
  return Promise.reject(new Error('no native bridge in this frame'));
}

/**
 * Convenience: `nativeCall` that resolves to `fallback` instead of
 * rejecting. For the many call sites whose only error handling was an
 * empty `catch {}`.
 */
export async function nativeCallOr<T>(fallback: T, method: string, ...args: unknown[]): Promise<T> {
  try {
    const v = await nativeCall<T>(method, ...args);
    return (v === undefined || v === null) ? fallback : v;
  } catch {
    return fallback;
  }
}
