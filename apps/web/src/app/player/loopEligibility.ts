/**
 * loopEligibility — which repeat a solo video gets: the browser's native `loop`
 * or the two-deck hand-off (`loopDecks.ts`). Pure, so every condition has a test.
 *
 * `twodeck` is used ONLY when it was asked for (the manifest's
 * `playback.loopMode`, or a `?loop=` override for a bench) AND every condition
 * below holds. Anything that is not a plain, muted, single-video repeat on a
 * browser that can time frames stays on the native loop — the audit's caution
 * that a second element cannot carry sound, cannot follow a shared clock, and
 * must never sit between an alert and the glass.
 */
export type LoopBackend = 'native' | 'twodeck';

export interface LoopEligibilityInput {
  /** `manifest.playback.loopMode` — absent on an older API. */
  loopMode: string | null | undefined;
  /** `?loop=twodeck|native` on the player URL, for a bench test. */
  urlOverride: string | null | undefined;
  /** Exactly one distinct playable item. */
  isSolo: boolean;
  /** The item plays without sound (two elements cannot hand audio over gaplessly). */
  muted: boolean;
  /** Frame-locked sync owns the clock (a second free-running element would fight it). */
  syncActive: boolean;
  /** Emergency content never takes an experimental path. */
  isEmergency: boolean;
  /** `.mov` sources render through `<source>` children — out of scope. */
  isMov: boolean;
  /** `requestVideoFrameCallback` exists (Chromium 83+, feature-detected). */
  hasRvfc: boolean;
  /** The device gave up on two-deck recently (`loopGuard`). */
  blocked: boolean;
  /** The dashboard's "open in browser" preview. */
  isPreview: boolean;
}

export interface LoopChoice {
  backend: LoopBackend;
  /** Why not two-deck (or `requested`), for diagnostics and the report. */
  reason: string;
}

function asMode(v: string | null | undefined): LoopBackend | null {
  return v === 'twodeck' || v === 'native' ? v : null;
}

export function pickLoopBackend(i: LoopEligibilityInput): LoopChoice {
  const requested = asMode(i.urlOverride) ?? asMode(i.loopMode) ?? 'native';
  if (requested !== 'twodeck') return { backend: 'native', reason: 'not-requested' };
  if (i.isPreview) return { backend: 'native', reason: 'preview' };
  if (i.isEmergency) return { backend: 'native', reason: 'emergency' };
  if (!i.isSolo) return { backend: 'native', reason: 'not-solo' };
  if (!i.muted) return { backend: 'native', reason: 'has-audio' };
  if (i.syncActive) return { backend: 'native', reason: 'sync-active' };
  if (i.isMov) return { backend: 'native', reason: 'mov-source' };
  if (!i.hasRvfc) return { backend: 'native', reason: 'no-rvfc' };
  if (i.blocked) return { backend: 'native', reason: 'blocked' };
  return { backend: 'twodeck', reason: 'requested' };
}
