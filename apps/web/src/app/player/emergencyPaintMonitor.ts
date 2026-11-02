import { useEffect, useRef } from 'react';
import { EmergencyPaintWatcher, emergencyRenderHash, type EmergencyPaintProof, type NativeEmergencyPaintState } from './emergencyPaintProof';
import { reassertDisplayEmergencyHold } from './emergencyHold';
import { apkVersionFromUserAgent, hasNativeBridge, nativeCall, nativeFire, nativeHas } from './nativeBridge';

type ValueRef<T> = { current: T };
/** Delays before each re-post of a refused / failed paint proof (~62 s in all). */
export const PAINT_POST_RETRY_MS = [500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const;
export interface EmergencyPaintMonitorRefs {
  watcher: ValueRef<EmergencyPaintWatcher | null>;
  expectedIdentity: ValueRef<string | null>;
  screenId: ValueRef<string | null>;
  manifestOkAt: ValueRef<number>;
}
interface EmergencyPaintMonitorOptions {
  disabled: () => boolean;
  /** The caller bounds the entire authenticated request, including its body. */
  post: (proof: EmergencyPaintProof, hash: string) => Promise<number | { status: number; emergencyPaintAccepted?: boolean }>;
}

/** Mount ABOVE the player error boundary: its cached fallback also needs proof. */
export function useEmergencyPaintMonitor(refs: EmergencyPaintMonitorRefs, options: EmergencyPaintMonitorOptions): void {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    if (latest.current.disabled()) return;
    const documentId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    let stopped = false;
    const retries = new Set<ReturnType<typeof setTimeout>>();
    const report = (proof: EmergencyPaintProof) => {
      if (!proof.painted) nativeFire('heartbeatV2', JSON.stringify({ emergencyPaint: proof }));
      console.info(`[Player] emergency-${proof.painted ? 'overlay-painted' : 'raised-no-paint'} identity=${proof.identity} frames=${proof.frames}`);
      const post = async (attempt: number) => {
        const current = refs.watcher.current?.current();
        if (stopped || current?.identity !== proof.identity || current.challenge !== proof.challenge || current.nativeRequired !== proof.nativeRequired) return;
        if (!proof.painted && current.painted) return;
        // A painted post is re-sent with the LIVE proof: the APK's verdict
        // (`nativeAccepted`) may have arrived since the first attempt.
        const live = proof.painted && current.painted ? current : proof;
        try {
          const result = await latest.current.post(live, emergencyRenderHash(live, refs.manifestOkAt.current));
          const status = typeof result === 'number' ? result : result.status;
          const refused = typeof result === 'object' && result.emergencyPaintAccepted === false;
          if (((status >= 200 && status < 300) && !refused) || status === 400 || status === 401 || status === 403) return;
        } catch { /* bounded retry below, never block drawing */ }
        // 2026-11-02: a REFUSED painted post is the API waiting for the APK's
        // verdict, which rides a heartbeat on a 5-minute floor. Three tries in
        // 1.5 s lost that race on every screen of a drill; keep offering the
        // same proof for about a minute, backing off, while it stays current.
        const delay = PAINT_POST_RETRY_MS[attempt];
        if (delay !== undefined && !stopped) {
          const timer = setTimeout(() => { retries.delete(timer); void post(attempt + 1); }, delay);
          retries.add(timer);
        }
      };
      void post(0);
    };
    const watcher = new EmergencyPaintWatcher({
      document, documentId,
      expectedIdentity: () => refs.expectedIdentity.current,
      raiseHold: () => { reassertDisplayEmergencyHold(); },
      requiresNativeValidation: () => hasNativeBridge() || apkVersionFromUserAgent(navigator.userAgent) !== null,
      readChallenge: async () => {
        if (!nativeHas('sharedVideoState')) return undefined;
        const reply = await nativeCall<unknown>('sharedVideoState');
        const state = typeof reply === 'string' ? JSON.parse(reply) : reply;
        const proof = (state as { emergencyProof?: NativeEmergencyPaintState } | null)?.emergencyProof;
        return typeof proof?.challenge === 'string' && proof.challenge.length <= 64 ? proof : undefined;
      },
      report,
      nativeReport: proof => { nativeFire('heartbeatV2', JSON.stringify({ emergencyPaint: proof })); },
      requestFrame: callback => requestAnimationFrame(callback), cancelFrame: id => cancelAnimationFrame(id),
    });
    refs.watcher.current = watcher;
    watcher.scan();
    const timer = setInterval(() => watcher.scan(), 250);
    return () => {
      stopped = true;
      clearInterval(timer);
      retries.forEach(clearTimeout);
      watcher.stop();
      if (refs.watcher.current === watcher) refs.watcher.current = null;
    };
  }, [refs]);
}
