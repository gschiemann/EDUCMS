/**
 * _media-runtime.js — gym media board runtime.
 *
 * Owns the one thing on these boards an operator must never be able to
 * type: what the screen claims about its own media source.
 *
 * WHY THIS FILE OWNS THE BADGE
 * A signage board that says LIVE · CONNECTED when nothing is connected is
 * not a cosmetic bug. The gym is the party performing publicly; a screen
 * that asserts a verified licensed feed while playing nothing (or while
 * playing something unlicensed) is the club's liability, printed 8 feet
 * tall. So the status/rights/music labels are runtime-owned: the editor
 * shim applies operator text to `[data-field]` elements, and none of the
 * truth labels are `[data-field]`. Two of them were, in the review
 * mockups (`source.connectionState`, `music.connectionState`); the port
 * strips those attributes.
 *
 * DEFAULT IS UNCONFIGURED, NOT FRESH
 * The review mockups defaulted to `fresh` so the composition could be
 * judged. On a real screen that default is the "configured = live" lie
 * in its purest form — a board that has never been connected to anything
 * would open claiming a verified live feed. A board with no state from
 * the parent renders SOURCE NOT CONFIGURED.
 *
 * The single exception is the gallery/preview surface, which the host
 * marks with `freeze=1`. There the board renders DEMO PREVIEW with the
 * badge locked, which is what the operator is actually looking at: a
 * preview, not a screen.
 *
 * STATE COMES FROM THE PARENT, NOT FROM THE URL
 * `?state=` is honored ONLY under `freeze=1` (so the design QA harness
 * and the gallery can still exercise every composition). On a live
 * screen the state arrives by postMessage from the host —
 * `{type:'educms-overrides', media:{…}}` — which is the same transport
 * the menu boards' live POS prices ride. The host derives it from the
 * signed manifest; this file never talks to a provider, holds a
 * credential, or decides whether rights are valid.
 *
 * MOTION IS EVIDENCE
 * The equalizer bars on the Soundfloor board animate only while the
 * music adapter reports PLAYING. Animation that runs regardless is a
 * claim that music is playing — the mockups' bars danced during a demo
 * with no provider attached. Same rule for the program progress bar.
 */
(function () {
  'use strict';

  /* The label contract. Only ALLOW+FRESH+acknowledged may say LIVE or
   * CONNECTED; every other row is a different, specific truth.
   *
   * `detail` is rendered inside the designer's fixed-size fallback panel,
   * which is composed for roughly 30 characters on one line. Longer copy
   * wraps out of the panel and lands on the hero text behind it — caught
   * on the portrait PulseCast board, whose panel is the tightest. Keep
   * every `detail` short; `gym-media-boards.cjs` measures it in all seven
   * states and fails on the overlap. */
  var STATES = {
    unconfigured: {
      label: 'SOURCE NOT CONFIGURED',
      detail: 'No media source selected',
      rights: 'NO SOURCE SELECTED',
      music: 'NO MUSIC SOURCE',
      look: 'offline',
      showsProtectedContent: false
    },
    fresh: {
      label: 'LIVE · CONNECTED',
      detail: 'Provider acknowledged play',
      rights: 'COMMERCIAL RIGHTS VERIFIED',
      music: 'MUSIC CONNECTED',
      look: 'fresh',
      showsProtectedContent: true
    },
    stale: {
      label: 'SIGNAL DELAYED',
      detail: 'Holding last confirmed frame',
      rights: 'RIGHTS VERIFIED · FEED STALE',
      music: 'MUSIC DATA STALE',
      look: 'stale',
      showsProtectedContent: true
    },
    offline: {
      label: 'SOURCE OFFLINE',
      detail: 'Fallback playlist is active',
      rights: 'SOURCE UNAVAILABLE',
      music: 'MUSIC STATUS OFFLINE',
      look: 'offline',
      showsProtectedContent: false
    },
    external: {
      label: 'EXTERNAL LICENSED DEVICE',
      detail: 'Playing on licensed receiver',
      rights: 'BUSINESS ACCOUNT VERIFIED',
      music: 'PROVIDER-MANAGED AUDIO',
      look: 'external',
      showsProtectedContent: false
    },
    denied: {
      label: 'PLAYBACK NOT AUTHORIZED',
      detail: 'Rights not verified',
      rights: 'RIGHTS NOT VERIFIED',
      music: 'MUSIC NOT AUTHORIZED',
      look: 'offline',
      showsProtectedContent: false
    },
    pending: {
      /* A real business service, connected, with an unfinished adapter on
       * our side. Neither "offline" (their service is fine) nor "external"
       * (no licensed receiver is involved) nor "not configured" (the
       * operator did configure it). Says what is actually true. */
      label: 'SOURCE ADAPTER PENDING',
      detail: 'VenueOS adapter not finished',
      rights: 'NOT VERIFIED BY VENUEOS',
      music: 'MUSIC ADAPTER PENDING',
      look: 'offline',
      showsProtectedContent: false
    },
    demo: {
      label: 'DEMO PREVIEW',
      detail: 'Preview only · not a live source',
      rights: 'DEMO · NOT FOR AIR',
      music: 'DEMO · NOT PLAYING',
      look: 'demo',
      showsProtectedContent: false
    }
  };

  /* `unconfigured` and `denied` are states the designer did not compose a
   * treatment for. Rather than invent one, each borrows the designer's own
   * `offline` treatment (see `look`) and changes only the words. */
  var LOOKS = ['fresh', 'stale', 'offline', 'external', 'demo'];

  var params = new URLSearchParams(window.location.search);
  var isPreviewSurface = params.get('freeze') === '1';

  var current = null;
  var live = {};

  function each(selector, fn) {
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i += 1) fn(nodes[i]);
  }

  function setText(selector, value) {
    if (value == null) return;
    each(selector, function (n) { n.textContent = value; });
  }

  /* Operator copy for a [data-field], applied ONLY where the runtime has
   * no authoritative value — the same "live wins, operator shows through"
   * rule the menu boards use for POS prices. */
  function setField(key, value) {
    if (value == null || value === '') return;
    each('[data-field="' + key + '"]', function (n) { n.textContent = value; });
  }

  function applyState(name) {
    var state = STATES[name] ? name : 'unconfigured';
    var copy = STATES[state];
    current = state;

    var root = document.documentElement;
    root.setAttribute('data-source-state', copy.look);
    root.setAttribute('data-media-state', state);

    /* v3 keys its treatment off a class on the stage instead of an
     * attribute on <html>. Drive both; each board reads the one it owns. */
    var stage = document.getElementById('stage') || document.querySelector('.stage');
    if (stage && stage.classList) {
      for (var i = 0; i < LOOKS.length; i += 1) stage.classList.remove('state-' + LOOKS[i]);
      stage.classList.add('state-' + copy.look);
      if (stage.dataset) stage.dataset.sourceState = copy.look;
    }

    setText('[data-source-status]', copy.label);
    setText('[data-source-detail]', copy.detail);
    setText('[data-rights-status]', copy.rights);

    /* Music is usually a DIFFERENT provider than the program video — a
     * club can have a verified video feed and an unbuilt music adapter at
     * the same moment. When the host reports a music state of its own,
     * the music label follows that; otherwise it follows the program. */
    var musicState = (live.music && STATES[live.music.state]) ? live.music.state : state;
    setText('[data-music-status]', STATES[musicState].music);

    /* Motion is a claim. Bars move only while the provider says PLAYING. */
    var playing = state === 'fresh' && live.music && live.music.playbackState === 'PLAYING';
    root.setAttribute('data-music-playing', playing ? 'true' : 'false');
  }

  /* ── Source-owned values ────────────────────────────────────────────
   * `[data-mediafield]` elements are NOT editable copy. Each one asserts
   * a fact about a live external system — what track is playing, which
   * provider, which audio zone, how much of the program is left, whether
   * the audio is muted, whether the content is licensed. The editor shim
   * cannot write them; this file is the only thing that fills them.
   *
   * With nothing bound they show a placeholder, not the composed demo
   * copy. That copy exists so the design could be judged; on a real
   * screen it is an invented readout, which is worse than an empty one
   * because it looks like data.
   *
   * The preview surface is the exception: there the badge is locked to
   * DEMO PREVIEW, so leaving the authored content is honest and lets an
   * operator see what the board looks like populated. */
  var UNBOUND = '—';

  function fillSourceOwned() {
    /* On the preview surface the authored demo copy stays put. */
    if (isPreviewSurface) return;

    var p = live.program || {};
    var m = live.music || {};
    var bound = {
      'music.trackTitle': m.trackTitle,
      'music.artist': m.artist,
      'music.provider': m.providerLabel,
      'music.zoneName': m.zoneLabel,
      'music.playbackMode': m.playbackModeLabel,
      'music.rights': m.rightsLabel,
      'source.providerName': p.providerLabel,
      'program.provider': p.providerLabel,
      'program.source': p.sourceLabel,
      'program.elapsed': p.elapsedLabel,
      'program.remaining': p.remainingLabel,
      'program.duration': p.durationLabel,
      'program.progressPercent': p.progressLabel,
      'program.chapter': p.chapterLabel,
      'program.startedAtLabel': p.startedAtLabel,
      'program.audioState': p.audioPolicyLabel,
      'program.audioPolicy': p.audioPolicyLabel,
      'program.captionState': p.captionLabel
    };

    each('[data-mediafield]', function (n) {
      var key = n.getAttribute('data-mediafield');

      /* The progress bar carries its value as GEOMETRY, not text — it is
       * an empty div whose width is the readout. Writing a placeholder
       * string into it puts characters inside the bar. (It shipped as a
       * `data-field`, so an operator could type into the progress bar.) */
      if (key === 'program.progressPercent') {
        var pct = (live.program || {}).progressPercent;
        n.style.width = (typeof pct === 'number' && isFinite(pct))
          ? Math.max(0, Math.min(100, pct)) + '%'
          : '0%';
        return;
      }

      var value = bound[key];
      /* Placeholders keep the SHAPE of the value they stand in for.
       * A bare em-dash where "10:22 remaining" was collapses the row and
       * shoves its neighbours into the next block — these are fixed
       * compositions, not flow layouts. */
      var fallback = UNBOUND;
      if (/\.(elapsed|remaining|duration|startedAtLabel)$/.test(key)) fallback = '--:--';
      n.textContent = (value == null || value === '') ? fallback : String(value);
    });
  }

  /* Values the operator authored that a provider can know better —
   * the class title, its category, the coach. Live wins where the
   * provider knows it; the operator's copy shows through otherwise.
   * (The same rule the menu boards use for POS prices.) */
  function applyLiveContent() {
    var p = live.program || {};
    setField('program.title', p.title);
    setField('program.category', p.category);
    setField('program.eyebrow', p.category);
    setField('program.summary', p.summary);
    setField('program.coach', p.coach);
    setField('program.level', p.level);

    var next = p.next || [];
    for (var i = 0; i < 6; i += 1) {
      var entry = next[i];
      if (!entry) continue;
      setField('schedule.' + i + '.time', entry.time);
      setField('schedule.' + i + '.title', entry.title);
      setField('schedule.' + i + '.source', entry.sourceLabel);
    }

    fillSourceOwned();
  }

  /* ── Clock ──────────────────────────────────────────────────────────
   * Timezone is the club's, not the browser's — a screen in a Denver gym
   * driven from a New York laptop shows Denver time. */
  var timeFmt = null;
  var dateFmt = null;
  var timeZone = null;

  function buildFormatters(tz, hour12) {
    var opts = { hour: 'numeric', minute: '2-digit' };
    if (hour12 === true || hour12 === false) opts.hour12 = hour12;
    try {
      if (tz) { opts.timeZone = tz; }
      timeFmt = new Intl.DateTimeFormat([], opts);
      var d = { weekday: 'short', month: 'short', day: 'numeric' };
      if (tz) d.timeZone = tz;
      dateFmt = new Intl.DateTimeFormat([], d);
      timeZone = tz || null;
    } catch (e) {
      /* An invalid IANA name must not stop the clock. */
      timeFmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
      dateFmt = new Intl.DateTimeFormat([], { weekday: 'short', month: 'short', day: 'numeric' });
      timeZone = null;
    }
  }

  function renderClock() {
    if (!timeFmt) return;
    var now = new Date();
    setText('[data-live-time]', timeFmt.format(now));
    setText('[data-live-date]', dateFmt.format(now));
    if (timeZone) setText('[data-live-timezone]', timeZone.replace(/_/g, ' '));
    each('[data-field="clock.localTime"]', function (n) { n.textContent = timeFmt.format(now); });
  }

  function applyClock() {
    var c = live.clock || {};
    buildFormatters(c.timeZone, c.hour12);
    renderClock();
  }

  /* ── Host transport ────────────────────────────────────────────────
   * Same message the shim and the live-menu feed already use. A message
   * with no `media` key is somebody else's (brand/text/img) — ignore it,
   * but re-assert the labels afterwards so an operator text override can
   * never repaint over a truth label. */
  function onMessage(event) {
    var data = event && event.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== 'educms-overrides') return;
    if (!data.media) {
      window.setTimeout(function () { applyState(current); }, 0);
      return;
    }
    live = data.media || {};
    applyClock();
    applyLiveContent();
    applyState(live.state);
  }

  function boot() {
    /* On the preview surface the QA harness and the gallery may select a
     * composition to render. On a live screen this is ignored entirely. */
    var requested = isPreviewSurface ? (params.get('state') || 'demo') : null;
    applyClock();
    fillSourceOwned();
    applyState(requested || (isPreviewSurface ? 'demo' : 'unconfigured'));
    window.setInterval(renderClock, 15000);
    window.addEventListener('message', onMessage, false);
    /* Tell the host we are ready to receive state (it may have resolved
     * the manifest before this frame finished loading). */
    try {
      if (window.parent) window.parent.postMessage({ type: 'educms-media-ready' }, '*');
    } catch (e) { /* detached frame */ }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
}());
