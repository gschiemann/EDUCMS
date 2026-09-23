/**
 * The script Chromium runs in every document of a render BEFORE the board's
 * own code (Page.addScriptToEvaluateOnNewDocument). DevTools-injected, so the
 * board's CSP does not apply to it.
 *
 * It does four things, all in service of a faithful, frozen, contained shot:
 *
 *   1. TIMER GATE. setTimeout / setInterval / requestAnimationFrame /
 *      requestIdleCallback callbacks are routed through a flag. Until the
 *      renderer freezes the page they run untouched (the fit engine's 400 /
 *      1200 / 2000 ms passes happen normally); after the freeze none run, so
 *      a carousel cannot flip between the screenshot and the measurement.
 *   2. FREEZE. Finite CSS/Web animations are FINISHED (their resting look,
 *      not a mid-fade frame); infinite ones are paused where they are.
 *   3. CONTAINMENT, belt to the network layer's braces: window.open and
 *      RTCPeerConnection are removed, and every CSP violation is recorded so
 *      a request the policy refused still shows up in blockedRequests.
 *   4. SYSTEM-FONT LOOK-ALIKES. FontFace objects named "Impact", "Arial",
 *      "Georgia"… pointing at bundled files, so the exemplar boards' system
 *      stacks draw the same on a Mac, on CI and in the Alpine image.
 *
 * All state hangs off a per-render random key that the board cannot guess.
 */
import type { FaceRule } from '../fonts/google-css.js';

export interface PreloadFace {
  family: string;
  url: string;
  style: string;
  weight: string;
  unicodeRange: string;
}

export function toPreloadFaces(faces: FaceRule[]): PreloadFace[] {
  return faces.map((f) => ({ family: f.family, url: f.url, style: f.style, weight: f.weight, unicodeRange: f.unicodeRange }));
}

export function preloadSource(key: string, faces: PreloadFace[]): string {
  return `(() => {
  'use strict';
  const KEY = ${JSON.stringify(key)};
  if (Object.prototype.hasOwnProperty.call(window, KEY)) return;
  const state = { frozen: false, csp: [], popups: [], frozenAnimations: 0 };
  const nativeSetTimeout = window.setTimeout;
  const nativeSetInterval = window.setInterval;
  const nativeRaf = window.requestAnimationFrame;
  const nativeRic = window.requestIdleCallback;
  const gate = (fn) => (typeof fn === 'function'
    ? function () { if (!state.frozen) return fn.apply(this, arguments); }
    : fn);
  window.setTimeout = function (fn, ms, ...rest) { return nativeSetTimeout.call(window, gate(fn), ms, ...rest); };
  window.setInterval = function (fn, ms, ...rest) { return nativeSetInterval.call(window, gate(fn), ms, ...rest); };
  if (nativeRaf) window.requestAnimationFrame = function (fn) { return nativeRaf.call(window, gate(fn)); };
  if (nativeRic) window.requestIdleCallback = function (fn, opts) { return nativeRic.call(window, gate(fn), opts); };

  window.addEventListener('securitypolicyviolation', (e) => {
    if (state.csp.length < 200) state.csp.push({ uri: String(e.blockedURI || ''), directive: String(e.effectiveDirective || e.violatedDirective || '') });
  }, true);

  try {
    window.open = function (url) { if (state.popups.length < 50) state.popups.push(String(url || '')); return null; };
  } catch (e) { /* non-writable in some frames */ }
  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel']) {
    try { delete window[name]; } catch (e) { /* ignore */ }
    try { if (window[name]) Object.defineProperty(window, name, { value: undefined, configurable: false, writable: false }); } catch (e) { /* ignore */ }
  }

  const FACES = ${JSON.stringify(faces)};
  try {
    if (typeof FontFace === 'function' && document.fonts) {
      for (const f of FACES) {
        const face = new FontFace(f.family, "url(" + f.url + ") format('woff2')", { style: f.style, weight: f.weight, unicodeRange: f.unicodeRange, display: 'block' });
        document.fonts.add(face);
      }
    }
  } catch (e) { /* a board with no fonts API still renders */ }

  const freeze = () => {
    state.frozen = true;
    let n = 0;
    try {
      for (const a of document.getAnimations()) {
        n += 1;
        try { a.finish(); } catch (e) { try { a.pause(); } catch (e2) { /* ignore */ } }
      }
    } catch (e) { /* no WAAPI */ }
    try { for (const m of document.querySelectorAll('video,audio')) { try { m.pause(); } catch (e) { /* ignore */ } } } catch (e) { /* ignore */ }
    try { for (const s of document.querySelectorAll('svg')) { try { if (s.pauseAnimations) s.pauseAnimations(); } catch (e) { /* ignore */ } } } catch (e) { /* ignore */ }
    state.frozenAnimations = n;
    return n;
  };

  Object.defineProperty(window, KEY, {
    value: Object.freeze({ state, freeze, nativeSetTimeout, nativeRaf }),
    enumerable: false, configurable: false, writable: false,
  });
})();`;
}
