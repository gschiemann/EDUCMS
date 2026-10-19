"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceEngineDecision } from "./decideFaceEngine";
import { faceEngineLine } from "./decideFaceEngine";
import { nativeFirstEndNext, NativeTransientEnds } from "./nativeEndReasons";
import { reconcileFace, sessionHasFreshFrame, sessionMatches, type NativeFirstFacts, type NativeIntentIdentity } from "./nativeFirst";
import type { NativeFirstFace } from "./nativeFirstFace";
import { blockNativeVideo, nativeSharedVideoEvidence } from "./nativeSharedVideo";

/**
 * NATIVE-FIRST SLOT (design `docs/design/NATIVE-FIRST-ONE-STORE.md` §3.2) —
 * what a face mounts when `decideFaceEngine` says `native` or `wait`.
 *
 * It creates NO web `<video>`: the picture is the app's hardware surface,
 * composed ABOVE the window (the 1.1.41 contract), and this element is only
 * the opaque black area beneath it. Until native's first composed frame the
 * glass shows what was there (a presenting session keeps presenting until
 * its boundary; at boot the splash was the last thing painted, and nothing
 * here draws a web lap). Never streaming, never a lower-resolution stand-in.
 *
 *   native → intend (adopt / boundary / now, by the §4.3 table) and confirm
 *            by render: `onPlaying` fires on the FIRST fresh frame of THIS
 *            identity (presenting, attached, visible, age ≤ 2.5 s), which is
 *            what the render proof and the media-ready gate wait for.
 *   wait   → nothing is sent; the store is downloading (the page's splash /
 *            the previous content stays). The page re-decides when the store
 *            reports the file verified.
 *   a yield (operator overlay) → nothing is sent here; the page releases the
 *            glass for the overlay and this effect intends again when it closes.
 *
 * An END of this identity follows the closed table (nativeEndReasons.ts):
 * transient → native again; > 5 in 10 min → settle on web; not-ready → wait
 * for the store; fault → the 24 h block; refused → web. A block or a settle
 * asks the page to re-decide (`onEngineChange`), which mounts the web engine
 * on the SAME verified file — one engine for that content, never a flip back.
 *
 * Every page-side wait is bounded; nothing here polls when unmounted (the
 * face controller's 500 ms poll runs while this holds interest).
 */

/** Native has this long to show a first frame of a VERIFIED store file before the attempt counts as a (transient) end. */
export const NATIVE_FIRST_START_BUDGET_MS = 20_000;
/** …and this long while it is still fetching its OWN copy (no active store): today's caching budget. */
export const NATIVE_FIRST_OWN_COPY_BUDGET_MS = 3 * 60 * 60 * 1000;
/** A not-ready end with no store to watch is retried after this (today's native retry interval). */
export const NATIVE_FIRST_WAIT_RETRY_MS = 30_000;
/** "Native again" is never immediate: one beat so a refused restart cannot spin. */
export const NATIVE_FIRST_AGAIN_MS = 1_000;
/** A boundary switch / release lands at the presenting clip's loop end, bounded (today's hand-off wait). */
export const NATIVE_FIRST_BOUNDARY_MAX_MS = 60_000;

function localStore(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function NativeSoloSlot({
  face,
  identity,
  decision,
  faceIndex,
  classes,
  onPlaying,
  onEngineChange,
  log = (line: string) => console.warn(line),
}: {
  face: NativeFirstFace;
  identity: NativeIntentIdentity;
  decision: FaceEngineDecision;
  faceIndex: number;
  classes: string;
  /** The first fresh native frame of this identity (render proof / media ready). */
  onPlaying(): void;
  /** A block, a settle or a refusal: the page must decide this face again. */
  onEngineChange(): void;
  log?: (line: string) => void;
}) {
  const identityKey = `${identity.screenId}|${identity.revision}|${identity.sha256}|${identity.assetId}`;
  const contentKey = NativeTransientEnds.key(faceIndex, identity.sha256);
  const [attempt, setAttempt] = useState(0);
  const [stage, setStage] = useState<"waiting" | "starting" | "presenting">("waiting");
  const playing = useRef(onPlaying);
  playing.current = onPlaying;
  const engineChange = useRef(onEngineChange);
  engineChange.current = onEngineChange;
  const logRef = useRef(log);
  logRef.current = log;
  const lastDecisionLine = useRef("");

  // The decision, logged once per change (codes only).
  useEffect(() => {
    const line = faceEngineLine(decision, faceIndex, identity.sha256);
    if (line !== lastDecisionLine.current) {
      lastDecisionLine.current = line;
      logRef.current(line);
    }
  }, [decision, faceIndex, identity.sha256]);

  // Poll the app while this slot is mounted (renews the lease, §4.1).
  useEffect(() => face.hold(), [face]);

  // Intend, observe, grade the end.
  useEffect(() => {
    if (decision.engine !== "native" || decision.yieldTo) {
      setStage("waiting");
      return;
    }
    const owner = {};
    let alive = true;
    let sent = false;
    let sawOurs = false;
    let reported = false;
    let ended = false;
    let startedAt = Date.now();
    // A `failed` state that was already there when this attempt intended is
    // the PREVIOUS attempt's end — never this one's.
    let staleSession = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ownCopy = decision.reason === "own-copy";
    let budget = ownCopy ? NATIVE_FIRST_OWN_COPY_BUDGET_MS : NATIVE_FIRST_START_BUDGET_MS;
    nativeSharedVideoEvidence.select(owner);

    const send = (facts: NativeFirstFacts | null) => {
      if (!alive || sent) return;
      const action = reconcileFace(facts, { kind: "native", identity, verified: true }, false);
      if (action.kind === "adopt") sent = face.intend(action.identity, "boundary");
      else if (action.kind === "intend") sent = face.intend(action.identity, action.start);
      // A boundary switch waits for the presenting clip's loop end (the app bounds it at 60 s).
      if (sent && action.kind === "intend" && action.start === "boundary") budget += NATIVE_FIRST_BOUNDARY_MAX_MS;
      if (sent) {
        startedAt = Date.now();
        staleSession = facts?.session?.state === "failed" ? facts.session.sessionId : "";
        setStage("starting");
      }
    };
    const again = (ms: number) => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => { if (alive) setAttempt((n) => n + 1); }, ms);
    };
    const end = (reason: string | undefined) => {
      if (!alive || ended) return;
      ended = true;
      const settled = face.ends.ended(contentKey, reason, Date.now());
      const next = nativeFirstEndNext({ reason, settled });
      logRef.current(`[Player] PLAYER_NATIVE_FIRST_END reason=${reason && /^[a-z0-9-]{1,64}$/.test(reason) ? reason : "none"} next=${next}` +
        ` face=${faceIndex} sha=${identity.sha256.slice(0, 8)}${next === "block" || next === "settle" || next === "web" ? " (web fallback)" : ""}`);
      nativeSharedVideoEvidence.clear(owner);
      if (next === "block") {
        blockNativeVideo(localStore(), identity.sha256, faceIndex, Date.now());
        engineChange.current();
      } else if (next === "settle" || next === "web") {
        face.ends.settle(contentKey);
        engineChange.current();
      } else if (next === "wait") {
        // With an active store the page re-decides when the store lists the
        // file again (decideFaceEngine → wait → native); with none, retry.
        again(NATIVE_FIRST_WAIT_RETRY_MS);
      } else {
        again(NATIVE_FIRST_AGAIN_MS);
      }
    };
    const onFacts = (facts: NativeFirstFacts | null) => {
      if (!alive || ended) return;
      if (!sent) send(facts);
      if (!sent || !facts) return;
      const s = facts.session && !(facts.session.state === "failed" && facts.session.sessionId === staleSession) ? facts.session : null;
      if (s && sessionMatches(s, identity)) {
        const fresh = sessionHasFreshFrame(s);
        nativeSharedVideoEvidence.update(owner, s, fresh, Date.now());
        if (s.state === "failed") { end(s.reason); return; }
        if (fresh) {
          sawOurs = true;
          if (!reported) {
            reported = true;
            setStage("presenting");
            playing.current();
          }
          return;
        }
        if (sawOurs || Date.now() - startedAt <= budget) return;
        end(undefined);
        return;
      }
      // Our session was on the glass and is gone, and nobody here asked:
      // the app ended it (a reason, when it gave one, rides on `failed`).
      if (sawOurs) { end(s?.reason); return; }
      // Never started within its budget → a transient end (native again;
      // repeated → settle on web). Never a verdict on the file by itself.
      if (Date.now() - startedAt > budget) end(undefined);
    };
    const unsubscribe = face.subscribe(onFacts);
    if (face.facts) onFacts(face.facts);
    else void face.read();
    return () => {
      alive = false;
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
      nativeSharedVideoEvidence.clear(owner);
    };
    // The identity key carries every field of the identity; callbacks do not restart a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [face, identityKey, decision.engine, decision.reason, decision.yieldTo, attempt, contentKey, faceIndex]);

  return (
    <div
      className={classes}
      data-native-first={decision.engine === "native" ? stage : "waiting"}
      style={{ background: "#000" }}
      aria-hidden="true"
    />
  );
}
