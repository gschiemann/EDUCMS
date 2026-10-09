'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { nativeCall, nativeFire, nativeHas } from './nativeBridge';
import { nativeSharedVideoEvidence, SharedVideoController, sharedVideoIdentity,
  type NativeSharedVideoDescriptor } from './nativeSharedVideo';

/** Keeps the existing player alive until both faces prepare; never leaves a hidden DOM decoder. */
export function NativeSharedVideo({ descriptor, children, classes }: {
  descriptor: NativeSharedVideoDescriptor | null; children: ReactNode; classes: string;
}) {
  const identity = descriptor ? sharedVideoIdentity(descriptor) : '';
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const controller = useRef<SharedVideoController | null>(null);
  const [phase, setPhase] = useState<{ identity: string; stage: 'browser' | 'handoff' | 'presenting' }>({ identity: '', stage: 'browser' });
  const stage = phase.identity === identity ? phase.stage : 'browser';

  useEffect(() => {
    if (!descriptor) return;
    const owner = {};
    let alive = true;
    const c = new SharedVideoController(descriptor, {
      has: nativeHas,
      fire: nativeFire,
      state: () => nativeCall('sharedVideoState'),
    }, {
      ready: () => {
        if (!alive) return;
        const videos = container.current?.querySelectorAll('video');
        const current = videos ? Array.from(videos).find(v => !v.paused && v.readyState >= 2) : undefined;
        // Retain the last frame locally. No export/readback, even for cross-origin sources.
        if (current && canvas.current) {
          try {
            canvas.current.width = current.videoWidth; canvas.current.height = current.videoHeight;
            canvas.current.getContext('2d')?.drawImage(current, 0, 0);
          } catch { /* The opaque hold remains if this WebView cannot draw the frame. */ }
        }
        // Release every deck/MSE decoder BEFORE React removes its subtree and BEFORE commit.
        videos?.forEach(v => { try { v.pause(); v.removeAttribute('src'); v.querySelectorAll('source').forEach(s => s.removeAttribute('src')); v.load(); } catch { /* unmount cleanup follows */ } });
        nativeSharedVideoEvidence.select(owner);
        setPhase({ identity, stage: 'handoff' });
      },
      update: (state, fresh) => {
        if (!alive) return;
        nativeSharedVideoEvidence.update(owner, state, fresh, Date.now());
        if (fresh) setPhase(p => p.identity === identity && p.stage !== 'presenting' ? {identity, stage:'presenting'} : p);
      },
      fallback: () => {
        if (!alive) return;
        nativeSharedVideoEvidence.clear(owner);
        setPhase({ identity, stage: 'browser' });
      },
    });
    controller.current = c;
    c.start();
    // A failed attempt is not retried on re-renders/manifest polls with the same identity.
    return () => { alive = false; c.stop(); nativeSharedVideoEvidence.clear(owner); if (controller.current === c) controller.current = null; };
    // Identity includes every safety-relevant descriptor field; callbacks do not restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  useEffect(() => {
    // This effect runs after the browser subtree has unmounted. Native starts the direct output decoders only
    // when BOTH pages have surrendered and committed; its first output remains behind our hold.
    if (stage === 'handoff') controller.current?.commit();
  }, [stage, identity]);

  return <div ref={container} className={classes} data-native-shared-video={stage}>
    {stage === 'browser' ? children : null}
    <canvas ref={canvas} className="absolute top-0 left-0 w-full h-full object-fill"
      style={{ display: stage === 'handoff' ? 'block' : 'none', background: '#000' }} aria-hidden="true" />
    {stage !== 'browser' ? <style>{`
      html, body, .player-root-wrapper, [data-edu-player-root="media"] { background: transparent !important; }
    `}</style> : null}
  </div>;
}
