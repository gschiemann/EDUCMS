"use client";

import { reportNativeFallback } from "./NativeDualVideo";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { nativeCall, nativeFire, nativeHas } from "./nativeBridge";
import {
  blockNativeVideo,
  NATIVE_VIDEO_RETRY_MS,
  nativeSharedVideoEvidence,
  nativeVideoFallbackLine,
  type NativeSharedVideoState,
} from "./nativeSharedVideo";
import {
  NativeZoneController,
  nativeZoneNext,
  zoneStateAsSharedState,
  type NativeVideoItem,
  type NativeVideoItemsDescriptor,
  type NativeZoneState,
  type Rect,
  type ZoneLayout,
} from "./nativeZones";

/**
 * NativeZoneVideo — one protocol-3 SLOT (a mixed-playlist video item or a
 * template VIDEO zone) that may be decoded natively on a surface ABOVE the
 * WebView (1.1.41, one compositing contract — nativeZones.ts has the why).
 *
 * The children are the web element (the `<video>` the page renders today).
 * They stay mounted — the web keeps playing — until native has the first
 * frame of the same verified file rendered and HELD on its parked surface AND
 * this slot is on glass. Then `play` goes out: native moves the surface onto
 * the rect (above the page, covering the web element) and releases the clip;
 * only once native reports the slot on its rect (`revealed`) do the children
 * unmount, hidden under the native picture. Nothing black is ever painted in
 * between, and the WebView stays opaque — there is no hole to open.
 *
 *  • `prerollOnly` (playlist items): native is prepared while the slide is
 *    the hidden next-up; if the slide reaches the glass before native holds
 *    its first frame, the web plays this showing and native is not switched
 *    in mid-clip (that would restart the picture). Next showing retries.
 *  • template zones: the hand-off waits for the web loop's boundary (bounded
 *    by HANDOFF_BOUNDARY_WAIT_MS) so the picture does not jump.
 *  • when the slide leaves the glass the session stops at once: a native
 *    surface above the window would hide the next slide, so transitions out
 *    of a native slot are hard cuts (the owner's accepted limitation), and
 *    native→native is handed over by the next slot's held first frame
 *    (`superseded`).
 *
 * Fallback: any native end remounts the web element; a transient end retries
 * (30 s, bounded attempts) and a native fault blocks the file on this face
 * for 24 h — the protocol-2 pattern (NativeDualVideo.tsx).
 */

export const HANDOFF_BOUNDARY_WAIT_MS = 60_000;
const MEASURE_EVERY_MS = 1000;

/** Live slot states for telemetry (`zones` on the native report). Document-local. */
export const nativeZoneTelemetry = new Map<string, NativeZoneState>();

export function nativeZoneTelemetryRows(): NonNullable<NativeSharedVideoState["zones"]> {
  const rows: NonNullable<NativeSharedVideoState["zones"]> = [];
  for (const s of nativeZoneTelemetry.values()) {
    if (rows.length >= 8) break;
    rows.push({
      slot: s.slot,
      state: s.state,
      ...(s.held ? { held: true } : {}),
      ...(s.ended ? { ended: true } : {}),
      ...(s.reason ? { reason: s.reason } : {}),
      ...(s.codecName ? { codecName: s.codecName } : {}),
      ...(s.output ? { uniqueFrames: s.output.uniqueFrames, width: s.output.width, height: s.output.height } : {}),
      ...(s.drops !== undefined ? { drops: s.drops } : {}),
      ...(s.loops !== undefined ? { loops: s.loops } : {}),
      ...(s.elapsedMs !== undefined ? { elapsedMs: s.elapsedMs } : {}),
    });
  }
  return rows;
}

function localStore(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export type NativeZoneStage = "browser" | "presenting";

export function NativeZoneVideo({
  descriptor,
  item,
  active,
  prerollOnly,
  measure,
  onHole,
  onLinger,
  onPlaying,
  onEnded,
  evidence,
  className,
  style,
  attempt,
  onAttempt,
  children,
}: {
  descriptor: NativeVideoItemsDescriptor;
  item: NativeVideoItem;
  /** On glass right now (the active slide; a template zone is always on glass). */
  active: boolean;
  /** Prepare while hidden; never switch in once the web is already playing this showing. */
  prerollOnly: boolean;
  /** The viewport rect the APK positions its surface at (null = not measurable yet). */
  measure: (el: HTMLElement | null) => ZoneLayout | null;
  /** Kept for the page's backdrop machinery; a native slot sits above the window, so no hole is ever opened (1.1.41). */
  localRect?: () => Rect | null;
  onHole: (slot: string, open: boolean, rect: Rect | null) => void;
  /** Kept for compatibility; a native slot never lingers above the next slide (1.1.41). */
  onLinger?: (slot: string, lingering: boolean) => void;
  onPlaying: () => void;
  onEnded?: () => void;
  /** Feed the document's render-proof evidence from this slot's frames. */
  evidence: boolean;
  className?: string;
  style?: CSSProperties;
  /** Retry attempt for this identity (owned by the page so a remount keeps it). */
  attempt: number;
  onAttempt: (slot: string, n: number) => void;
  children: ReactNode;
}) {
  const slot = item.slot;
  const identity = `${descriptor.revision}|${slot}|${item.asset.sha256}|${attempt}`;
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<NativeZoneController | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const cb = useRef({ onHole, onLinger, onPlaying, onEnded, onAttempt, measure });
  cb.current = { onHole, onLinger, onPlaying, onEnded, onAttempt, measure };
  const [phase, setPhase] = useState<{ identity: string; stage: NativeZoneStage }>({ identity: "", stage: "browser" });
  const stage: NativeZoneStage = phase.identity === identity ? phase.stage : "browser";
  // Per-identity mutable facts shared by the effects below.
  const run = useRef<{
    identity: string;
    held: boolean;
    played: boolean;
    skipped: boolean;
    playingReported: boolean;
    owner: object;
    boundaryTimer: ReturnType<typeof setTimeout> | null;
    boundaryCleanup: (() => void) | null;
    /** Hand off now (or at the web loop's boundary); set once the attempt runs. */
    handoff: (() => void) | null;
    /** End a played session cleanly (the slide left, or native superseded it): no web remount. */
    finish: (() => void) | null;
    done: boolean;
  } | null>(null);

  // One native attempt per identity.
  useEffect(() => {
    const owner = {};
    const r: NonNullable<typeof run.current> = { identity, held: false, played: false, skipped: false, playingReported: false, owner, boundaryTimer: null, boundaryCleanup: null, handoff: null, finish: null, done: false };
    run.current = r;
    let alive = true;
    let c: NativeZoneController | null = null;
    let measureTimer: ReturnType<typeof setInterval> | null = null;
    let startTimer: ReturnType<typeof setTimeout> | null = null;
    let lastLayout: ZoneLayout | null = null;

    // No hole is ever open under the above-window contract; closing is a no-op that keeps the page's state empty.
    const closeHole = () => cb.current.onHole(slot, false, null);
    const fallback = (reason?: string) => {
      if (!alive) return;
      nativeSharedVideoEvidence.clear(owner);
      nativeZoneTelemetry.delete(slot);
      if (r.boundaryCleanup) { r.boundaryCleanup(); r.boundaryCleanup = null; }
      if (r.boundaryTimer !== null) { clearTimeout(r.boundaryTimer); r.boundaryTimer = null; }
      closeHole();
      cb.current.onLinger?.(slot, false);
      // The web element remounts and plays the same verified file.
      setPhase({ identity, stage: "browser" });
      if (r.skipped) return; // this showing deliberately stayed web; a new mount retries
      const next = nativeZoneNext(reason, attempt, r.played);
      reportNativeFallback(nativeVideoFallbackLine({ reason, next, attempt, protocol: 3, faceIndex: descriptor.faceIndex, sha256: item.asset.sha256, stage: "zone" }));
      if (next === "block") blockNativeVideo(localStore(), item.asset.sha256, descriptor.faceIndex, Date.now());
      else if (next === "retry")
        startTimer = setTimeout(() => {
          if (alive) cb.current.onAttempt(slot, attempt + 1);
        }, NATIVE_VIDEO_RETRY_MS);
    };

    const play = () => {
      if (!alive || r.played || !r.held) return;
      r.played = true;
      if (evidence) nativeSharedVideoEvidence.select(owner);
      // Native moves its surface onto the rect, above the still-mounted web
      // element; `revealed` below unmounts the children once it is there.
      c?.play();
    };

    /** Hand off at the web loop's boundary when the web is mid-clip (template zones), else now. */
    const handoffWhenSeamless = () => {
      if (!alive || r.played) return;
      const video = container.current?.querySelector("video");
      const midClip = !!video && !video.paused && video.readyState >= 2 && video.currentTime > 0.25 && !video.ended;
      if (!midClip || prerollOnly) { play(); return; }
      let last = video.currentTime;
      const onTime = () => {
        if (!alive) return;
        const t = video.currentTime;
        if (t < last - 0.25 || video.ended) { cleanup(); play(); }
        last = t;
      };
      const cleanup = () => {
        video.removeEventListener("timeupdate", onTime);
        video.removeEventListener("ended", onTime);
        if (r.boundaryTimer !== null) { clearTimeout(r.boundaryTimer); r.boundaryTimer = null; }
        r.boundaryCleanup = null;
      };
      r.boundaryCleanup = cleanup;
      video.addEventListener("timeupdate", onTime);
      video.addEventListener("ended", onTime);
      r.boundaryTimer = setTimeout(() => { cleanup(); play(); }, HANDOFF_BOUNDARY_WAIT_MS);
    };
    r.handoff = handoffWhenSeamless;
    r.finish = () => {
      if (!alive || r.done) return;
      r.done = true;
      nativeSharedVideoEvidence.clear(owner);
      nativeZoneTelemetry.delete(slot);
      closeHole();
      c?.stop();
      // Inactive by now (the page unmounts a finished slide), so no web element remounts.
      setPhase({ identity, stage: "browser" });
      cb.current.onLinger?.(slot, false);
    };

    const start = () => {
      if (!alive || c) return;
      const layout = cb.current.measure(container.current);
      if (!layout) return; // not laid out yet; the measure tick retries
      lastLayout = layout;
      c = new NativeZoneController(
        descriptor,
        item,
        layout,
        { has: nativeHas, fire: nativeFire, state: () => nativeCall("sharedVideoState") },
        {
          ready: () => {
            if (!alive || !c) return;
            // A playlist slide already on glass with the web playing: this
            // showing stays web. The file is verified on disk for next time.
            if (prerollOnly && activeRef.current) { r.skipped = true; c.stop(); fallback("skipped"); return; }
            c.commit();
          },
          held: () => {
            if (!alive) return;
            r.held = true;
            if (activeRef.current) handoffWhenSeamless();
          },
          revealed: () => {
            if (!alive || !r.played || r.done) return;
            // The native picture is on the rect, above the page: the web element may go.
            setPhase({ identity, stage: "presenting" });
          },
          update: (state, fresh) => {
            if (!alive) return;
            nativeZoneTelemetry.set(slot, state);
            if (r.played) nativeSharedVideoEvidence.update(owner, zoneStateAsSharedState(state, descriptor.faceIndex), fresh, Date.now());
            if (fresh && r.played && !r.playingReported) {
              r.playingReported = true;
              cb.current.onPlaying();
            }
          },
          ended: () => {
            if (alive && r.played) cb.current.onEnded?.();
          },
          fallback,
          superseded: () => {
            if (!alive) return;
            // The next native slot took the glass: finish now if this slide has
            // left; if we were still the active slide, the web takes over.
            if (!activeRef.current) r.finish?.(); else fallback("superseded");
          },
        },
      );
      controller.current = c;
      c.start();
    };

    start();
    measureTimer = setInterval(() => {
      if (!alive) return;
      if (!c) { start(); return; }
      const layout = cb.current.measure(container.current);
      if (layout && (!lastLayout || JSON.stringify(layout) !== JSON.stringify(lastLayout))) {
        lastLayout = layout;
        c.layout(layout);
      }
    }, MEASURE_EVERY_MS);

    return () => {
      alive = false;
      if (measureTimer !== null) clearInterval(measureTimer);
      if (startTimer !== null) clearTimeout(startTimer);
      if (r.boundaryTimer !== null) clearTimeout(r.boundaryTimer);
      if (r.boundaryCleanup) r.boundaryCleanup();
      c?.stop();
      if (controller.current === c) controller.current = null;
      nativeSharedVideoEvidence.clear(owner);
      nativeZoneTelemetry.delete(slot);
      cb.current.onHole(slot, false, null);
      cb.current.onLinger?.(slot, false);
      if (run.current === r) run.current = null;
    };
    // Identity covers every safety-relevant field; callbacks never restart playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  // The slot reached the glass (or left it).
  useEffect(() => {
    const r = run.current;
    if (!r || r.identity !== identity) return;
    if (active) {
      // Pre-rolled and waiting for the glass: hand off now.
      if (r.held && !r.played) r.handoff?.();
      return;
    }
    // A native surface above the window would hide the next slide: stop at once (a hard cut).
    if (r.played && !r.done) r.finish?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, identity]);

  return (
    <div ref={container} className={className} style={style} data-native-zone={stage} data-native-slot={slot}>
      {stage === "browser" ? children : null}
    </div>
  );
}
