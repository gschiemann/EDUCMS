"use client";

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
 * template VIDEO zone) that may be decoded natively BELOW the WebView
 * (design: docs/research/2026-10-12-native-video/02-protocol-3.md).
 *
 * The children are the web element (the `<video>` the page renders today).
 * They stay mounted — the web keeps playing — until native has the first
 * frame of the same verified file rendered and HELD on its surface AND this
 * slot is on glass. Only then, in ONE React commit, the children unmount, the
 * owner opens the hole (`onHole`), and `play` is sent: the frame where the
 * web pixels vanish is the frame the held native picture shows through.
 * Nothing black is ever painted in between.
 *
 *  • `prerollOnly` (playlist items): native is prepared while the slide is
 *    the hidden next-up; if the slide reaches the glass before native holds
 *    its first frame, the web plays this showing and native is not switched
 *    in mid-clip (that would restart the picture). Next showing retries.
 *  • template zones: the hand-off waits for the web loop's boundary (bounded
 *    by HANDOFF_BOUNDARY_WAIT_MS) so the picture does not jump.
 *  • when the slide leaves the glass the native frame LINGERS for
 *    HANDOFF_OVERLAP_MS behind the next slide's fade (`onLinger` asks the
 *    page to keep this element mounted), then the hole closes and the
 *    session stops.
 *
 * Fallback: any native end remounts the web element; a transient end retries
 * (30 s, bounded attempts) and a native fault blocks the file on this face
 * for 24 h — the protocol-2 pattern (NativeDualVideo.tsx).
 */

export const HANDOFF_OVERLAP_MS = 1200;
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
  localRect,
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
  /** The hole in the owner's backdrop, in the backdrop's own px (null = whole backdrop). */
  localRect?: () => Rect | null;
  onHole: (slot: string, open: boolean, rect: Rect | null) => void;
  /** Keep me mounted while my last native frame lingers behind the next slide. */
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
  const cb = useRef({ onHole, onLinger, onPlaying, onEnded, onAttempt, measure, localRect });
  cb.current = { onHole, onLinger, onPlaying, onEnded, onAttempt, measure, localRect };
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
    lingerTimer: ReturnType<typeof setTimeout> | null;
    boundaryTimer: ReturnType<typeof setTimeout> | null;
    boundaryCleanup: (() => void) | null;
    /** Hand off now (or at the web loop's boundary); set once the attempt runs. */
    handoff: (() => void) | null;
    /** End a played session cleanly (linger over, or native superseded it): no web remount. */
    finish: (() => void) | null;
    done: boolean;
  } | null>(null);

  // One native attempt per identity.
  useEffect(() => {
    const owner = {};
    const r: NonNullable<typeof run.current> = { identity, held: false, played: false, skipped: false, playingReported: false, owner, lingerTimer: null, boundaryTimer: null, boundaryCleanup: null, handoff: null, finish: null, done: false };
    run.current = r;
    let alive = true;
    let c: NativeZoneController | null = null;
    let measureTimer: ReturnType<typeof setInterval> | null = null;
    let startTimer: ReturnType<typeof setTimeout> | null = null;
    let lastLayout: ZoneLayout | null = null;
    let lastLocal: Rect | null = null;

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
      console.warn(nativeVideoFallbackLine({ reason, next, attempt, protocol: 3, faceIndex: descriptor.faceIndex, sha256: item.asset.sha256, stage: "zone" }));
      if (next === "block") blockNativeVideo(localStore(), item.asset.sha256, descriptor.faceIndex, Date.now());
      else if (next === "retry")
        startTimer = setTimeout(() => {
          if (alive) cb.current.onAttempt(slot, attempt + 1);
        }, NATIVE_VIDEO_RETRY_MS);
    };

    const openAndPlay = () => {
      if (!alive || r.played || !r.held) return;
      r.played = true;
      if (evidence) nativeSharedVideoEvidence.select(owner);
      cb.current.onHole(slot, true, cb.current.localRect ? cb.current.localRect() : null);
      // The children unmount in this commit; the effect below sends `play` after it.
      setPhase({ identity, stage: "presenting" });
    };

    /** Hand off at the web loop's boundary when the web is mid-clip (template zones), else now. */
    const handoffWhenSeamless = () => {
      if (!alive || r.played) return;
      const video = container.current?.querySelector("video");
      const midClip = !!video && !video.paused && video.readyState >= 2 && video.currentTime > 0.25 && !video.ended;
      if (!midClip || prerollOnly) { openAndPlay(); return; }
      let last = video.currentTime;
      const onTime = () => {
        if (!alive) return;
        const t = video.currentTime;
        if (t < last - 0.25 || video.ended) { cleanup(); openAndPlay(); }
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
      r.boundaryTimer = setTimeout(() => { cleanup(); openAndPlay(); }, HANDOFF_BOUNDARY_WAIT_MS);
    };
    r.handoff = handoffWhenSeamless;
    r.finish = () => {
      if (!alive || r.done) return;
      r.done = true;
      if (r.lingerTimer !== null) { clearTimeout(r.lingerTimer); r.lingerTimer = null; }
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
      lastLocal = cb.current.localRect ? cb.current.localRect() : null;
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
            // The next native slot took the glass: finish now if we were
            // lingering; if we were still the active slide, the web takes over.
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
      if (r.played && cb.current.localRect) {
        const local = cb.current.localRect();
        if (JSON.stringify(local) !== JSON.stringify(lastLocal)) {
          lastLocal = local;
          cb.current.onHole(slot, true, local);
        }
      }
    }, MEASURE_EVERY_MS);

    return () => {
      alive = false;
      if (measureTimer !== null) clearInterval(measureTimer);
      if (startTimer !== null) clearTimeout(startTimer);
      if (r.lingerTimer !== null) clearTimeout(r.lingerTimer);
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
      if (r.lingerTimer !== null) { clearTimeout(r.lingerTimer); r.lingerTimer = null; cb.current.onLinger?.(slot, false); }
      // Pre-rolled and waiting for the glass: open now.
      if (r.held && !r.played) r.handoff?.();
      return;
    }
    if (r.played && r.lingerTimer === null && !r.done) {
      // Keep the last native frame behind the next slide's fade, then let go.
      cb.current.onLinger?.(slot, true);
      r.lingerTimer = setTimeout(() => { r.lingerTimer = null; r.finish?.(); }, HANDOFF_OVERLAP_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, identity]);

  // After the commit that removed the web element: release the held frame.
  useEffect(() => {
    if (stage === "presenting") controller.current?.play();
  }, [stage, identity]);

  return (
    <div ref={container} className={className} style={style} data-native-zone={stage} data-native-slot={slot}>
      {stage === "browser" ? children : null}
    </div>
  );
}
