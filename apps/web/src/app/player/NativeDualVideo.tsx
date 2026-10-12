"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { nativeCall, nativeFire, nativeHas } from "./nativeBridge";
import {
  blockNativeVideo,
  NATIVE_VIDEO_MAX_ATTEMPTS,
  NATIVE_VIDEO_RETRY_MS,
  NATIVE_VIDEO_TRANSIENT_REASONS,
  nativeSharedVideoEvidence,
  SharedVideoController,
  sharedVideoIdentity,
  type AnyNativeVideoDescriptor,
} from "./nativeSharedVideo";
import { DEFAULT_PLAYLIST_MEDIA_FIT, mediaFitClass, mediaFitStyle, type MediaFit } from "./mediaFit";

/**
 * What a native end means for the NEXT attempt (protocol 2 only; protocol 1
 * keeps its one-attempt-per-identity rule unchanged):
 *  • a transient end (paused, emergency, content changed, page lease…) or no
 *    reason at all → try native again in 30 s, at most 20 times per identity;
 *  • a native fault of this file on this box (codec failed/stalled, no
 *    hardware decoder, digest mismatch…) → web for this file for 24 h.
 * Pure, exported for the test.
 */
export function nativeVideoNext(
  protocol: 1 | 2,
  reason: string | undefined,
  attempt: number,
): "retry" | "block" | "stay" {
  if (protocol !== 2) return "stay";
  if (!reason || NATIVE_VIDEO_TRANSIENT_REASONS.has(reason))
    return attempt + 1 < NATIVE_VIDEO_MAX_ATTEMPTS ? "retry" : "stay";
  return "block";
}

function localStore(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Keeps the existing player alive until native is ready; never leaves a hidden DOM decoder. */
export function NativeDualVideo({
  descriptor,
  children,
  classes,
  onPlaying,
  fit = DEFAULT_PLAYLIST_MEDIA_FIT,
}: {
  descriptor: AnyNativeVideoDescriptor | null;
  children: ReactNode;
  classes: string;
  onPlaying(): void;
  /** The hold frame is drawn at the video's own size, so it takes the slide's fit (mediaFit.ts). */
  fit?: MediaFit;
}) {
  const baseIdentity = descriptor ? sharedVideoIdentity(descriptor) : "";
  // A protocol-2 retry is a NEW attempt identity, so the effect below re-runs.
  const [attempt, setAttempt] = useState<{ base: string; n: number }>({ base: "", n: 0 });
  const attemptN = attempt.base === baseIdentity ? attempt.n : 0;
  const identity = baseIdentity ? `${baseIdentity}#${attemptN}` : "";
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const playing = useRef(onPlaying);
  playing.current = onPlaying;
  const controller = useRef<SharedVideoController | null>(null);
  const [phase, setPhase] = useState<{
    identity: string;
    stage: "browser" | "handoff" | "presenting";
  }>({ identity: "", stage: "browser" });
  const stage = phase.identity === identity ? phase.stage : "browser";

  useEffect(() => {
    if (!descriptor) return;
    const owner = {};
    let alive = true;
    let playingReported = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const c = new SharedVideoController(
      descriptor,
      {
        has: nativeHas,
        fire: nativeFire,
        state: () => nativeCall("sharedVideoState"),
      },
      {
        ready: () => {
          if (!alive) return;
          const videos = container.current?.querySelectorAll("video");
          const current = videos
            ? Array.from(videos).find((v) => !v.paused && v.readyState >= 2)
            : undefined;
          // Retain the last frame locally. No export/readback, even for cross-origin sources.
          if (current && canvas.current) {
            try {
              canvas.current.width = current.videoWidth;
              canvas.current.height = current.videoHeight;
              canvas.current.getContext("2d")?.drawImage(current, 0, 0);
            } catch {
              /* The opaque hold remains if this WebView cannot draw the frame. */
            }
          }
          // Release every deck/MSE decoder BEFORE React removes its subtree and BEFORE commit.
          videos?.forEach((v) => {
            try {
              v.pause();
              v.removeAttribute("src");
              v.querySelectorAll("source").forEach((s) =>
                s.removeAttribute("src"),
              );
              v.load();
            } catch {
              /* unmount cleanup follows */
            }
          });
          nativeSharedVideoEvidence.select(owner);
          setPhase({ identity, stage: "handoff" });
        },
        update: (state, fresh) => {
          if (!alive) return;
          nativeSharedVideoEvidence.update(owner, state, fresh, Date.now());
          if (fresh && !playingReported) {
            playingReported = true;
            playing.current();
          }
          if (fresh)
            setPhase((p) =>
              p.identity === identity && p.stage !== "presenting"
                ? { identity, stage: "presenting" }
                : p,
            );
        },
        fallback: (reason) => {
          if (!alive) return;
          nativeSharedVideoEvidence.clear(owner);
          // The browser subtree remounts and plays the same verified file.
          setPhase({ identity, stage: "browser" });
          const next = nativeVideoNext(descriptor.version === 2 ? 2 : 1, reason, attemptN);
          if (next === "block")
            blockNativeVideo(localStore(), descriptor.asset.sha256, descriptor.faceIndex, Date.now());
          else if (next === "retry")
            retryTimer = setTimeout(() => {
              if (alive) setAttempt({ base: baseIdentity, n: attemptN + 1 });
            }, NATIVE_VIDEO_RETRY_MS);
        },
      },
    );
    controller.current = c;
    c.start();
    // A failed attempt is not retried on re-renders/manifest polls with the same identity.
    return () => {
      alive = false;
      if (retryTimer !== null) clearTimeout(retryTimer);
      c.stop();
      nativeSharedVideoEvidence.clear(owner);
      if (controller.current === c) controller.current = null;
    };
    // Identity includes every safety-relevant descriptor field; callbacks do not restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  useEffect(() => {
    // This effect runs after the browser subtree has unmounted. Native starts its decoder only
    // after this page has surrendered its own; its first output remains behind our hold.
    if (stage === "handoff") controller.current?.commit();
  }, [stage, identity]);

  return (
    <div ref={container} className={classes} data-native-shared-video={stage}>
      {stage === "browser" ? children : null}
      <canvas
        ref={canvas}
        className={`absolute top-0 left-0 w-full h-full ${mediaFitClass(fit)}`}
        style={{
          ...mediaFitStyle(fit),
          display: stage === "handoff" ? "block" : "none",
          background: "#000",
        }}
        aria-hidden="true"
      />
      {stage !== "browser" ? (
        <style>{`
      html, body, .player-root-wrapper, [data-edu-player-root="media"] { background: transparent !important; }
    `}</style>
      ) : null}
    </div>
  );
}
