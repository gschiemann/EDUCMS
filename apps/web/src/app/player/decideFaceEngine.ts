/**
 * NATIVE-FIRST — the engine decision moves BEFORE the mount (design
 * `docs/design/NATIVE-FIRST-ONE-STORE.md` §3.1; owner D1, 2026-10-19).
 *
 * Today a solo video on a native-capable face plays one lap on the web engine
 * and the Android app's hardware engine takes over later, from its own second
 * download. Native-first decides, per face and before anything is mounted,
 * which engine shows this content:
 *
 *   native — frame 0 on the hardware engine; the web `<video>` is NEVER
 *            created (NativeSoloSlot renders no web child).
 *   wait   — native is the engine, but the file is not verified in the
 *            app's store yet: what is on glass stays (at first boot, the
 *            splash with the store's real download). Never a web lap, never
 *            streaming.
 *   web    — the web engine, exactly as today (byte for byte the 1.1.42
 *            path when the reason is `protocol` / `native-first-off`).
 *
 * Operator overlays (update prompt, soft blank, canvas editor, touch overlay)
 * are YIELDS, not engine choices: the decision stays `native` / `wait` with
 * `yieldTo` set — native steps aside while the overlay is up (the surface is
 * above the window and would cover it) and the SAME content resumes natively
 * when it closes. Soft DIM is different and decides `web`: it is a lasting
 * state (a brightness setting on a box without a backlight control), its
 * overlay must composite over the picture, and the page cannot dim a surface
 * that sits above the window — yielding would leave the screen black for as
 * long as the setting stands. That is today's behaviour (dim made native
 * ineligible), kept.
 *
 * LIFE SAFETY (§7 E2): emergency content and a raised emergency hold decide
 * `web`, first, before any other input is read — the alert is always drawn
 * by the page; the native engine never plays emergency content. (Two more
 * locks hold the same line: the server builds no descriptor for an emergency
 * manifest, and the app refuses to begin under a hold.)
 *
 * Pure: no React, no DOM, no bridge, no clock. One test per row of §3.1.
 */

export type FaceEngine = 'native' | 'wait' | 'web';

export type FaceEngineReason =
  // native
  | 'store-verified' // the store holds the verified file
  | 'own-copy' // the store is not active: the app plays its own verified copy (stream B's fallback path)
  // wait
  | 'store-pending' // the store is active but the file is not verified yet
  // web — life safety first
  | 'emergency-content'
  | 'hold-raised'
  // web — content / context the native engine never takes
  | 'preview'
  | 'sync'
  | 'not-solo'
  | 'not-muted'
  | 'not-mp4'
  | 'daypart'
  | 'soft-dim'
  // web — the switch, the descriptor, the app, the class
  | 'no-descriptor'
  | 'descriptor-mismatch'
  | 'descriptor-off'
  | 'protocol'
  | 'class-not-native'
  | 'native-first-off'
  // web — the failure policy (§3.4)
  | 'blocked'
  | 'settled';

/** Page overlays native steps aside for (yields); never an engine choice. */
export type FaceYield = 'update-prompt' | 'soft-blank' | 'canvas-editor' | 'touch-overlay';

export interface FaceEngineInput {
  /** The item the face would mount. */
  content: {
    /** One solo item after collapseCopies (no other playable item). */
    solo: boolean;
    muted: boolean;
    /** `video/mp4`. */
    mp4: boolean;
    /** The item carries a day / time window of its own. */
    daypart: boolean;
    assetId: string;
    sha256: string;
  };
  /** The server's `nativeVideo` descriptor for THIS face (null = none sent). */
  descriptor: { assetId: string; sha256: string; nativeFirst?: boolean } | null;
  /** What the app answered on `sharedVideoState` (null = no answer yet / no bridge). */
  app: {
    protocolMax: number;
    nativeSolo: boolean;
    nativeFirst: boolean;
    /** `store.mode`, or null when the reply carries no store block. */
    storeMode: 'off' | 'adopting' | 'active' | null;
    /** `store.ready` (sha256, lowercase). */
    storeReady: ReadonlySet<string>;
  } | null;
  /** A live 24 h native block for (sha, face, APK build). */
  blocked: boolean;
  /** Repeated transient ends settled this content on web (§3.4). */
  settled: boolean;
  emergencyContent: boolean;
  holdRaised: boolean;
  sync: boolean;
  preview: boolean;
  softDim: boolean;
  /** An operator overlay is up right now (a yield), or null. */
  overlay: FaceYield | null;
}

export interface FaceEngineDecision {
  engine: FaceEngine;
  reason: FaceEngineReason;
  /** Set only on a native / wait decision while an operator overlay is up. */
  yieldTo: FaceYield | null;
}

const web = (reason: FaceEngineReason): FaceEngineDecision => ({ engine: 'web', reason, yieldTo: null });

export const NATIVE_FIRST_MIN_PROTOCOL = 4;

export function decideFaceEngine(input: FaceEngineInput): FaceEngineDecision {
  // §7 E2 — life safety before anything else is even read.
  if (input.emergencyContent) return web('emergency-content');
  if (input.holdRaised) return web('hold-raised');
  if (input.preview) return web('preview');
  if (input.sync) return web('sync');
  const c = input.content;
  if (!c.mp4) return web('not-mp4');
  if (!c.solo) return web('not-solo');
  if (!c.muted) return web('not-muted');
  if (c.daypart) return web('daypart');
  const d = input.descriptor;
  if (!d) return web('no-descriptor');
  const sha = (c.sha256 || '').toLowerCase();
  if (!sha || d.assetId !== c.assetId || d.sha256.toLowerCase() !== sha) return web('descriptor-mismatch');
  // The server's explicit kill switch wins even over an app that says yes.
  if (d.nativeFirst === false) return web('descriptor-off');
  const app = input.app;
  if (!app || app.protocolMax < NATIVE_FIRST_MIN_PROTOCOL) return web('protocol');
  if (!app.nativeSolo) return web('class-not-native');
  if (!app.nativeFirst) return web('native-first-off');
  if (input.blocked) return web('blocked');
  if (input.settled) return web('settled');
  if (input.softDim) return web('soft-dim');
  const yieldTo = input.overlay;
  if (app.storeReady.has(sha)) return { engine: 'native', reason: 'store-verified', yieldTo };
  if (app.storeMode === 'active') return { engine: 'wait', reason: 'store-pending', yieldTo };
  // No active store (not integrated yet, still adopting, or switched off for
  // insufficient storage): the app plays its own verified copy, downloading it
  // first if it must — the slot keeps the glass until native's first frame.
  return { engine: 'native', reason: 'own-copy', yieldTo };
}

/** The once-per-change log line (codes and a digest prefix only — never a URL). */
export function faceEngineLine(d: FaceEngineDecision, faceIndex: number, sha256: string): string {
  return `[Player] PLAYER_NATIVE_FIRST_DECISION engine=${d.engine} reason=${d.reason}` +
    (d.yieldTo ? ` yield=${d.yieldTo}` : '') + ` face=${faceIndex} sha=${(sha256 || '').slice(0, 8).toLowerCase()}`;
}
