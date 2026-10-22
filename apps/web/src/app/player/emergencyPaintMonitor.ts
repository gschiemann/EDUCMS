import { useEffect, useRef } from 'react';
import { EmergencyPaintWatcher, emergencyRenderHash, type EmergencyPaintProof, type NativeEmergencyPaintState } from './emergencyPaintProof';
import { signalDisplayEmergencyHold } from './emergencyHold';
import { apkVersionFromUserAgent, hasNativeBridge, nativeCall, nativeFire, nativeHas } from './nativeBridge';

type ValueRef<T> = { current: T };
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
        try {
          const result = await latest.current.post(proof, emergencyRenderHash(proof, refs.manifestOkAt.current));
          const status = typeof result === 'number' ? result : result.status;
          const refused = typeof result === 'object' && result.emergencyPaintAccepted === false;
          if (((status >= 200 && status < 300) && !refused) || status === 400 || status === 401 || status === 403) return;
        } catch { /* bounded retry below, never block drawing */ }
        if (attempt < 2 && !stopped) {
          const timer = setTimeout(() => { retries.delete(timer); void post(attempt + 1); }, 500 * (attempt + 1));
          retries.add(timer);
        }
      };
      void post(0);
    };
    const watcher = new EmergencyPaintWatcher({
      document, documentId,
      expectedIdentity: () => refs.expectedIdentity.current,
      raiseHold: () => { signalDisplayEmergencyHold(true, true); },
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
