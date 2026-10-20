import { useEffect, useRef } from 'react';
import { EmergencyPaintWatcher, emergencyRenderHash, type EmergencyPaintProof } from './emergencyPaintProof';
import { signalDisplayEmergencyHold } from './emergencyHold';
import { nativeCall, nativeFire, nativeHas } from './nativeBridge';

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
  post: (proof: EmergencyPaintProof, hash: string) => Promise<number>;
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
      if (!proof.painted || proof.challenge) nativeFire('heartbeatV2', JSON.stringify({ emergencyPaint: proof }));
      console.info(`[Player] emergency-${proof.painted ? 'overlay-painted' : 'raised-no-paint'} identity=${proof.identity} frames=${proof.frames}`);
      const post = async (attempt: number) => {
        const current = refs.watcher.current?.current();
        if (stopped || current?.identity !== proof.identity || current.challenge !== proof.challenge) return;
        if (!proof.painted && current.painted) return;
        try {
          const status = await latest.current.post(proof, emergencyRenderHash(proof, refs.manifestOkAt.current));
          if ((status >= 200 && status < 300) || status === 400 || status === 401 || status === 403) return;
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
      readChallenge: async () => {
        if (!nativeHas('sharedVideoState')) return undefined;
        const reply = await nativeCall<unknown>('sharedVideoState');
        const state = typeof reply === 'string' ? JSON.parse(reply) : reply;
        const challenge = (state as { emergencyProof?: { challenge?: unknown } } | null)?.emergencyProof?.challenge;
        return typeof challenge === 'string' && challenge.length <= 64 ? challenge : undefined;
      },
      report,
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
