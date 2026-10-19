"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { nativeCall, nativeFire, nativeHas } from "./nativeBridge";
import {
  blockNativeVideo,
  NATIVE_VIDEO_MAX_ATTEMPTS,
  NATIVE_VIDEO_RETRY_MS,
  nativeSharedVideoEvidence,
  nativeVideoEndGrade,
  nativeVideoFallbackLine,
  SharedVideoController,
  sharedVideoIdentity,
  type AnyNativeVideoDescriptor,
} from "./nativeSharedVideo";
import { DEFAULT_PLAYLIST_MEDIA_FIT, mediaFitClass, mediaFitStyle, type MediaFit } from "./mediaFit";
import { NativeVideoResumeWaiter, probeNativeVideoAvailability, queryNativeVideoAvailability } from "./nativeVideoReadiness";

/**
 * What a native end means for the NEXT attempt (protocol 2 only; protocol 1
 * keeps its one-attempt-per-identity rule unchanged), by the failure-grading
 * table (`nativeVideoEndGrade`, 1.1.43 phase 0):
 *  • a transient end (paused, emergency, content changed, page lease…), a
 *    NOT-READY end (network, storage, authorization, manifest — an offline
 *    boot) or no reason at all → try native again in 30 s, at most 20 times
 *    per identity; never a verdict on the file;
 *  • a verdict about this box or layout (cannot compose) → web for this
 *    document, no retry, no block;
 *  • a native fault of this file on this box (codec failed/stalled, no
 *    hardware decoder, digest mismatch…) → web for this file for 24 h.
 * Pure, exported for the test.
 */
export function nativeVideoNext(
  protocol: 1 | 2,
  reason: string | undefined,
  attempt: number,
  /** Native already took the glass (the browser player was handed off). */
  wasOnGlass = false,
  hasAvailability = false,
): "retry" | "block" | "stay" | "wait" {
  if (protocol !== 2) return "stay";
  // A verified native readiness edge is a lifecycle recovery, not a periodic
  // decoder retry. Older APKs retain their existing policy.
  if (hasAvailability && (reason === "activity-paused" || reason === "page-stopped")) return "wait";
  const grade = nativeVideoEndGrade(reason);
  if (grade === "fault") return "block";
  if (grade === "box") return "stay";
  // Owner rule 2026-10-12: content must never flip web → native → web → native.
  // A retry is invisible only while the browser is still the picture; once
  // native has been on the glass and ended, this content stays on the browser
  // player until it changes or the page reloads (a fault still blocks).
  if (wasOnGlass) return "stay";
  return attempt + 1 < NATIVE_VIDEO_MAX_ATTEMPTS ? "retry" : "stay";
}

/** Longest wait for the web clip's loop point before handing over anyway. */
export const NATIVE_HANDOFF_BOUNDARY_WAIT_MS = 60_000;

/**
 * A native fallback line, plus ONE diagnostics upload (≤ every 10 min). The APK
 * only ships its log on playback trouble, so a screen that falls back to a
 * smooth web player never sent the reason (VisionCore, 2026-10-12).
 */
let lastNativeLogUpload = 0;
export function reportNativeFallback(line: string): void {
  console.warn(line);
  const now = Date.now();
  if (now - lastNativeLogUpload < 10 * 60_000 || !nativeHas("uploadDiagnostics")) return;
  lastNativeLogUpload = now;
  // Let the WebView persist the console line first.
  setTimeout(() => { void nativeCall("uploadDiagnostics").catch(() => undefined); }, 3_000);
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
  const commitGate = useRef<(() => void) | null>(null);
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
    // How far this attempt got, for the fallback log line only.
    let seen: "preparing" | "ready" | "presenting" = "preparing";
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let waitingForBoundary = false;
    let boundaryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelBoundary: (() => void) | null = null;
    let resumeWaiter: NativeVideoResumeWaiter | null = null;
    let availabilitySupported = false;
    let preparedEpoch = -1;
    let ended = false;
    let gateTimer: ReturnType<typeof setTimeout> | null = null;
    let unknownHandoffReads = 0;
    const readAvailability = () => nativeCall("sharedVideoState");
    const visible = () => document.visibilityState === "visible";
    const waitForReady = (after: number, ready: (epoch: number) => void) => {
      resumeWaiter?.stop();
      resumeWaiter = new NativeVideoResumeWaiter(readAvailability, visible, after, a => {
        if (alive) ready(a.epoch);
      });
      resumeWaiter.start();
    };
    // While native is ready and taking over, the browser's one-stream engine
    // must not attach (it waits for the same loop point and would leave this
    // hand-off no playing frame to hold — continuousLoop.ts). An attribute in
    // place on our own node, never a detached one (CLAUDE.md cross-browser 6).
    const markHandoff = (on: boolean) => {
      try {
        if (on) container.current?.setAttribute("data-native-handoff", "pending");
        else container.current?.removeAttribute("data-native-handoff");
      } catch { /* a flag only */ }
    };
    const fallback = (reason?: string) => {
      if (!alive || ended) return;
      ended = true;
      markHandoff(false);
      if (gateTimer !== null) { clearTimeout(gateTimer); gateTimer = null; }
      cancelBoundary?.();
      c.stop();
      nativeSharedVideoEvidence.clear(owner);
      setPhase({ identity, stage: "browser" });
      const next = nativeVideoNext(descriptor.version === 2 ? 2 : 1, reason, attemptN,
        seen === "ready" || seen === "presenting", availabilitySupported);
      reportNativeFallback(nativeVideoFallbackLine({ reason, next, attempt: attemptN, protocol: descriptor.version === 2 ? 2 : 1, faceIndex: descriptor.faceIndex, sha256: descriptor.asset.sha256, stage: seen }));
      if (next === "block") blockNativeVideo(localStore(), descriptor.asset.sha256, descriptor.faceIndex, Date.now());
      else if (next === "wait") waitForReady(preparedEpoch, () => setAttempt({ base: baseIdentity, n: attemptN + 1 }));
      else if (next === "retry") retryTimer = setTimeout(() => {
        if (alive) setAttempt({ base: baseIdentity, n: attemptN + 1 });
      }, NATIVE_VIDEO_RETRY_MS);
    };
    const canHandoff = async (): Promise<"ready" | "defer" | "ended"> => {
      if (!availabilitySupported) return alive && !ended ? "ready" : "ended";
      const a = await queryNativeVideoAvailability(readAvailability);
      if (!alive || ended) return "ended";
      if (!a) {
        // Keep the SAME prepared attempt during a brief bridge timeout. No
        // fictitious lifecycle edge, and no new decoder is allocated.
        if (++unknownHandoffReads <= 3) return "defer";
        fallback();
        return "ended";
      }
      unknownHandoffReads = 0;
      if (!a.ready || a.epoch !== preparedEpoch) {
        fallback("page-stopped");
        return "ended";
      }
      return visible() ? "ready" : "defer";
    };
    const handOver = async () => {
      const gate = await canHandoff();
      if (gate === "defer") { gateTimer = setTimeout(() => { void handOver(); }, 500); return; }
      if (gate !== "ready") return;
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
      seen = "ready";
      setPhase({ identity, stage: "handoff" });
    };
    const c = new SharedVideoController(
      descriptor,
      {
        has: nativeHas,
        fire: nativeFire,
        state: () => nativeCall("sharedVideoState"),
      },
      {
        ready: () => {
          if (!alive || waitingForBoundary) return;
          markHandoff(true);
          // Hand over at the web clip's own loop point: native starts from frame
          // 0, so switching mid-clip showed as a jump back to the start (owner,
          // VisionCore 2026-10-12). Bounded; the controller keeps polling, so
          // native's lease stays alive while we wait.
          const playingNow = container.current
            ? Array.from(container.current.querySelectorAll("video")).find((v) => !v.paused && v.readyState >= 2)
            : undefined;
          if (playingNow && playingNow.currentTime > 0.25 && !playingNow.ended) {
            waitingForBoundary = true;
            let last = playingNow.currentTime;
            cancelBoundary = () => {
              playingNow.removeEventListener("educms-loop-boundary", go);
              playingNow.removeEventListener("timeupdate", onTime);
              playingNow.removeEventListener("ended", go);
              if (boundaryTimer !== null) { clearTimeout(boundaryTimer); boundaryTimer = null; }
              cancelBoundary = null;
            };
            const go = () => { cancelBoundary?.(); void handOver(); };
            const onTime = () => {
              const t = playingNow.currentTime;
              if (t < last - 0.25) go();
              last = t;
            };
            playingNow.addEventListener("educms-loop-boundary", go);
            playingNow.addEventListener("timeupdate", onTime);
            playingNow.addEventListener("ended", go);
            boundaryTimer = setTimeout(go, NATIVE_HANDOFF_BOUNDARY_WAIT_MS);
            return;
          }
          void handOver();
        },
        update: (state, fresh) => {
          if (!alive || ended) return;
          nativeSharedVideoEvidence.update(owner, state, fresh, Date.now());
          if (fresh && !playingReported) {
            playingReported = true;
            seen = "presenting";
            playing.current();
          }
          if (fresh)
            setPhase((p) =>
              p.identity === identity && p.stage !== "presenting"
                ? { identity, stage: "presenting" }
                : p,
            );
        },
        fallback,
      },
    );
    controller.current = c;
    // Queryable readiness also handles a resume that preceded our failed-state
    // poll. A newer APK waits for native UI; an older APK starts as before.
    const discover = async () => {
      if (descriptor.version !== 2) { c.start(); return; }
      const p = await probeNativeVideoAvailability(readAvailability);
      if (!alive) return;
      if (p.kind === "unknown") { gateTimer = setTimeout(() => { void discover(); }, 500); return; }
      availabilitySupported = p.kind === "supported";
      if (p.kind === "supported") waitForReady(-1, epoch => { preparedEpoch = epoch; c.start(); });
      else c.start();
    };
    void discover();
    const commitWhenReady = () => { void canHandoff().then(gate => {
      if (gate === "ready") c.commit();
      else if (gate === "defer") gateTimer = setTimeout(commitWhenReady, 500);
    }); };
    commitGate.current = commitWhenReady;
    // A failed attempt is not retried on re-renders/manifest polls with the same identity.
    return () => {
      alive = false;
      markHandoff(false);
      if (retryTimer !== null) clearTimeout(retryTimer);
      if (gateTimer !== null) clearTimeout(gateTimer);
      if (boundaryTimer !== null) clearTimeout(boundaryTimer);
      cancelBoundary?.();
      resumeWaiter?.stop();
      c.stop();
      nativeSharedVideoEvidence.clear(owner);
      if (controller.current === c) controller.current = null;
      if (commitGate.current === commitWhenReady) commitGate.current = null;
    };
    // Identity includes every safety-relevant descriptor field; callbacks do not restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  useEffect(() => {
    // This effect runs after the browser subtree has unmounted. Native starts its decoder only
    // after this page has surrendered its own; its first output remains behind our hold.
    if (stage === "handoff") commitGate.current?.();
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
