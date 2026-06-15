/* VenueOS celebration sound — synthesized stadium SFX via the Web Audio API.
 *
 * There are NO audio files in the bundle: the stadium air-horn and the impact
 * "boom" under a scoring cue are generated live from oscillators + a noise
 * burst. That makes them CC0 by construction (nothing to license), zero extra
 * bytes to ship, and fully offline-safe on a Taurus / Android-WebView kiosk.
 *
 * Autoplay note: a sandboxed celebration iframe only gets to make sound if the
 * embedding <iframe> carries allow="autoplay" AND the browser's autoplay policy
 * permits it. Player kiosks run Chromium with autoplay enabled, so cues are
 * audible there. In a normal desktop tab the AudioContext starts suspended
 * until the first user gesture — so an operator's silent preview is expected,
 * not a bug. resume() is attempted on every call so the first post-gesture cue
 * is heard. Web Audio needs only allow-scripts (no same-origin), so this works
 * inside the null-origin celebration sandbox.
 * Chromium-83 / WebKit safe (webkitAudioContext fallback, no modern-only API). */
(function () {
  'use strict';
  var AC = null, MASTER = null;

  function ctx() {
    if (!AC) {
      var C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try {
        AC = new C();
        MASTER = AC.createGain();
        MASTER.gain.value = 0.9;
        MASTER.connect(AC.destination);
      } catch (e) { AC = null; }
    }
    if (AC && AC.state === 'suspended') { try { AC.resume(); } catch (e) {} }
    return AC;
  }

  function now() { var a = ctx(); return a ? a.currentTime : 0; }

  // Stadium air-horn: stacked detuned sawtooths (root + fifth + two octaves)
  // through a lowpass, with a fast attack, a sustained body, and a quick
  // release — the classic two-tone klaxon a school PA / scoreboard fires.
  function horn(when, opt) {
    var a = ctx(); if (!a) return; opt = opt || {};
    var t = (when != null ? when : a.currentTime);
    var dur = opt.dur || 1.0, base = opt.freq || 233; // ~Bb3
    var peak = opt.gain || 0.7;
    var out = a.createGain(); out.connect(MASTER);
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(peak, t + 0.04);
    out.gain.setValueAtTime(peak, Math.max(t + 0.05, t + dur - 0.14));
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    var lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 0.6; lp.connect(out);
    var freqs = [base, base * 1.5, base * 2.01, base * 2.99];
    freqs.forEach(function (f, i) {
      var o = a.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      var g = a.createGain(); g.gain.value = (i === 0 ? 0.5 : 0.45 / (i + 1));
      o.connect(g); g.connect(lp);
      o.start(t); o.stop(t + dur + 0.03);
    });
  }

  // Impact boom: a sub-bass pitch drop + a short filtered noise crack — the
  // "hit" the eye expects under a dunk / goal / home-run burst.
  function boom(when, opt) {
    var a = ctx(); if (!a) return; opt = opt || {};
    var t = (when != null ? when : a.currentTime);
    var o = a.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.35);
    var g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opt.gain || 0.8, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g); g.connect(MASTER); o.start(t); o.stop(t + 0.55);
    var len = Math.floor(a.sampleRate * 0.18);
    var buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    var n = a.createBufferSource(); n.buffer = buf;
    var hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    var ng = a.createGain(); ng.gain.value = 0.25;
    n.connect(hp); hp.connect(ng); ng.connect(MASTER); n.start(t);
  }

  window.CELSOUND = { ctx: ctx, now: now, horn: horn, boom: boom };
})();
