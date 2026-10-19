"use client";

import { useEffect, useRef, useState } from "react";
import type { FaceEngineDecision } from "./decideFaceEngine";
import { faceEngineLine } from "./decideFaceEngine";
import { nativeFirstEndNext, NativeTransientEnds } from "./nativeEndReasons";
import { reconcileFace, sessionHasFreshFrame, sessionMatches, type NativeFirstFacts, type NativeIntentIdentity } from "./nativeFirst";
import type { NativeFirstFace } from "./nativeFirstFace";
import { blockNativeVideo, nativeSharedVideoEvidence } from "./nativeSharedVideo";
import { displayEmergencyHoldRaised } from "./emergencyHold";

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
/**
 * Transient ends caused by the APP's own window (its operator UI, the
 * Activity's lifecycle). The app never restarts content on its own (stream
 * B's D5), so the page asks again — but only once the app's window answer
 * (`availability.ready`, the 1.1.35 contract) says the window is free again,
 * when the reply carries it: asking into a Back menu would only be refused,
 * counted, and settle a healthy content on web behind a long menu.
 */
export const APP_YIELDS: ReadonlySet<string> = new Set(["operator-ui", "activity-paused", "lifecycle-not-ready", "page-stopped"]);

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
  holdRaised = displayEmergencyHoldRaised,
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
  /** Whether the page last asked the device to HOLD (emergencyHold.ts) — never intend under it. */
  holdRaised?: () => boolean;
  log?: (line: string) => void;
}) {
  const identityKey = `${identity.screenId}|${identity.revision}|${identity.sha256}|${identity.assetId}`;
  const contentKey = NativeTransientEnds.key(faceIndex, identity.sha256);
  const [stage, setStage] = useState<"waiting" | "starting" | "presenting">("waiting");
  const holdRaisedRef = useRef(holdRaised);
  holdRaisedRef.current = holdRaised;
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
    // A block / settle / refusal handed the face back to the page.
    let stopped = false;
    let sent = false;
    let reported = false;
    let phase: "starting" | "presenting" | "awaiting" = "starting";
    let startedAt = Date.now();
    let awaitSince = 0;
    let awaitReason: string | undefined;
    let awaitNext: "native" | "wait" = "native";
    // A `failed` state that was already there when this attempt intended, or
    // that was already graded, is never graded (again) — nor a refusal.
    let staleSession = "";
    let lastEnded = "";
    let staleRejection = "";
    const ownCopy = decision.reason === "own-copy";
    let budget = ownCopy ? NATIVE_FIRST_OWN_COPY_BUDGET_MS : NATIVE_FIRST_START_BUDGET_MS;
    nativeSharedVideoEvidence.select(owner);

    const send = (facts: NativeFirstFacts | null) => {
      if (!alive || sent || stopped) return;
      // Never ask the app for a picture while the page holds an alert (§7).
      if (holdRaisedRef.current()) return;
      const action = reconcileFace(facts, { kind: "native", identity, verified: true }, false);
      let boundary = false;
      if (action.kind === "adopt") sent = face.intend(action.identity, "boundary");
      else if (action.kind === "intend") { sent = face.intend(action.identity, action.start); boundary = action.start === "boundary"; }
      if (sent) {
        startedAt = Date.now();
        // A boundary switch waits for the presenting clip's loop end (the app bounds it at 60 s).
        budget = (ownCopy ? NATIVE_FIRST_OWN_COPY_BUDGET_MS : NATIVE_FIRST_START_BUDGET_MS) + (boundary ? NATIVE_FIRST_BOUNDARY_MAX_MS : 0);
        staleSession = facts?.session?.state === "failed" ? facts.session.sessionId : "";
        staleRejection = facts?.intentRejected?.key ?? "";
        phase = "starting";
        setStage("starting");
      }
    };
    const end = (reason: string | undefined, sessionId: string) => {
      if (!alive || stopped) return;
      if (sessionId) lastEnded = sessionId;
      const settled = face.ends.ended(contentKey, reason, Date.now());
      const next = nativeFirstEndNext({ reason, settled });
      logRef.current(`[Player] PLAYER_NATIVE_FIRST_END reason=${reason && /^[a-z0-9-]{1,64}$/.test(reason) ? reason : "none"} next=${next}` +
        ` face=${faceIndex} sha=${identity.sha256.slice(0, 8)}${next === "block" || next === "settle" || next === "web" ? " (web fallback)" : ""}`);
      nativeSharedVideoEvidence.clear(owner);
      if (next === "block") {
        stopped = true;
        blockNativeVideo(localStore(), identity.sha256, faceIndex, Date.now());
        engineChange.current();
      } else if (next === "settle" || next === "web") {
        stopped = true;
        face.ends.settle(contentKey);
        engineChange.current();
      } else {
        // native again / wait: watch, and ask again only when it is time (resume).
        phase = "awaiting";
        awaitSince = Date.now();
        awaitReason = reason;
        awaitNext = next === "wait" ? "wait" : "native";
        setStage("starting");
      }
    };
    // Native again, at the next start. The app never restarts content on its
    // own (stream B's D5), so the page asks — never while it holds an alert
    // (a suspended-by-hold intent is restored here, once the hold is down),
    // not while the app's own UI / lifecycle still holds its window, and a
    // not-ready end only once the store lists the file again (or, with no
    // store, after 30 s).
    const resume = (facts: NativeFirstFacts) => {
      if (holdRaisedRef.current()) return;
      if (awaitReason && APP_YIELDS.has(awaitReason) && facts.availability && !facts.availability.ready) return;
      const elapsed = Date.now() - awaitSince;
      if (awaitNext === "wait") {
        const store = facts.store?.mode === "active" ? facts.store : null;
        if (store ? store.ready.indexOf(identity.sha256) === -1 : elapsed < NATIVE_FIRST_WAIT_RETRY_MS) return;
      } else if (elapsed < NATIVE_FIRST_AGAIN_MS) return;
      sent = false;
      nativeSharedVideoEvidence.select(owner);
      send(facts);
    };
    const onFacts = (facts: NativeFirstFacts | null) => {
      if (!alive || stopped) return;
      if (!sent && phase !== "awaiting") send(facts);
      if (!facts) return;
      const raw = facts.session;
      const s = raw && !(raw.state === "failed" && (raw.sessionId === staleSession || raw.sessionId === lastEnded)) ? raw : null;
      const ours = !!s && sessionMatches(s, identity);
      if (ours && s!.state === "presenting" && sessionHasFreshFrame(s)) {
        // On the glass — first start, an adopted session, or one the app restored after an alert / the operator UI.
        nativeSharedVideoEvidence.update(owner, s!, true, Date.now());
        if (phase !== "presenting") {
          phase = "presenting";
          setStage("presenting");
          if (!reported) { reported = true; playing.current(); }
        }
        return;
      }
      // The APP settled this content on web (its own tracker, `intent.settled`):
      // the same verdict as the page's — web until the content changes or a reload.
      const it = facts.intent;
      if (it && it.settled && it.sha256 === identity.sha256 && it.revision === identity.revision) {
        stopped = true;
        face.ends.settle(contentKey);
        logRef.current(`[Player] PLAYER_NATIVE_FIRST_END reason=settled-by-app next=settle face=${faceIndex} sha=${identity.sha256.slice(0, 8)} (web fallback)`);
        nativeSharedVideoEvidence.clear(owner);
        engineChange.current();
        return;
      }
      if (phase === "awaiting") { resume(facts); return; }
      if (!sent) return;
      // The app REFUSED this intent (stream B's `intentRejected`): graded by
      // the closed table like any end — except a lease the app calls retired,
      // which gets a fresh lease and is asked again (bounded).
      const rej = facts.intentRejected;
      if (rej && rej.key !== staleRejection && (!rej.sha256 || rej.sha256 === identity.sha256)) {
        staleRejection = rej.key;
        if (rej.reason === "lease-retired" && face.renewLease()) { sent = false; return; }
        end(rej.reason, "");
        return;
      }
      if (ours) {
        nativeSharedVideoEvidence.update(owner, s!, false, Date.now());
        if (s!.state === "failed") { end(s!.reason, s!.sessionId); return; }
        // Still ours with a momentarily stale frame: the app grades a real
        // stall itself (`output-stalled`, 8 s). Before the first frame, the budget.
        if (phase === "presenting" || Date.now() - startedAt <= budget) return;
        end(undefined, "");
        return;
      }
      // Our session was on the glass and is gone, and nobody here asked.
      if (phase === "presenting") { end(s?.reason, s?.sessionId ?? ""); return; }
      // Never started within its budget → a transient end (native again;
      // repeated → settle on web). Never a verdict on the file by itself.
      if (Date.now() - startedAt > budget) end(undefined, "");
    };
    const unsubscribe = face.subscribe(onFacts);
    if (face.facts) onFacts(face.facts);
    else void face.read();
    return () => {
      alive = false;
      unsubscribe();
      nativeSharedVideoEvidence.clear(owner);
    };
    // The identity key carries every field of the identity; callbacks do not restart a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [face, identityKey, decision.engine, decision.reason, decision.yieldTo, contentKey, faceIndex]);

  return (
    <div
      className={classes}
      data-native-first={decision.engine === "native" ? stage : "waiting"}
      style={{ background: "#000" }}
      aria-hidden="true"
    />
  );
}
