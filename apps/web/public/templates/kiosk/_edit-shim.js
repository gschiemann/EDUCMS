/* ═══════════════════════════════════════════════════════════════════════════
   VenueOS · KIOSK EDIT-SHIM  (inlined LAST, after kiosk-core.js + app.js)
   Makes a JS-rendered kiosk editable by the EXTERNAL_HTML editor, like the
   static signage boards:
     • reads brand/text/textStyles/img overrides from base64url URL params
       AND from the parent via postMessage 'educms-overrides'
     • RE-APPLIES them after every screen render (wraps Kiosk._render) +
       sheet open — the stock shim is one-shot and would miss screen swaps
     • edit mode (builder): outlines [data-field]/[data-img] on hover and
       posts 'educms-field-click' so the panel jumps to that field; announces
       'educms-ready' so the panel can (re)arm after a remount
   Brand var names already match the kiosk theme (--bg/--surface/--text/
   --accent/--font-display/--font-body) so recolor/fonts "just work".
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  // ── Gallery FREEZE mode ──────────────────────────────────────────────
  // When the kiosk URL carries `freeze=1` (the templates GALLERY GRID appends
  // it — the preview modal / builder / player never do), render ONE correct
  // frame then go idle: clear every timer + rAF the kiosk armed and inject an
  // animation/transition-killing <style>. Near-zero ongoing CPU per off-screen
  // iframe. Strict NO-OP unless freeze=1; undone if edit mode opens.
  //
  // NOTE on load order: this shim is inlined LAST (after kiosk-core.js + app.js),
  // so the kiosk's startup timers ALREADY exist before our wrappers install.
  // We therefore (a) wrap the timer globals to catch any timer armed AFTER us
  // (e.g. inside Kiosk._render re-renders), AND (b) brute-force clear the whole
  // integer-ID range at freeze time to catch the early ones. Clearing an unknown
  // / already-fired id is a spec no-op, and in a frozen thumbnail stopping every
  // timer is exactly the goal.
  var FROZEN = (function () { try { return new URLSearchParams(location.search).get('freeze') === '1'; } catch (e) { return false; } })();
  var _frzStyle = null;
  function unfreeze() { if (_frzStyle) { try { if (_frzStyle.parentNode) _frzStyle.parentNode.removeChild(_frzStyle); } catch (e) {} _frzStyle = null; } }
  (function () {
    if (!FROZEN) return;
    var ivs = [], tos = [], rafs = [];
    var _si = window.setInterval, _st = window.setTimeout, _raf = window.requestAnimationFrame;
    window.setInterval = function () { var id = _si.apply(window, arguments); try { ivs.push(id); } catch (e) {} return id; };
    window.setTimeout = function () { var id = _st.apply(window, arguments); try { tos.push(id); } catch (e) {} return id; };
    if (_raf) window.requestAnimationFrame = function (cb) { var id = _raf.call(window, cb); try { rafs.push(id); } catch (e) {} return id; };
    function freezeNow() {
      // restore the real timer fns first so nothing re-arms via our wrappers
      window.setInterval = _si; window.setTimeout = _st; if (_raf) window.requestAnimationFrame = _raf;
      try { for (var i = 0; i < ivs.length; i++) clearInterval(ivs[i]); } catch (e) {}
      try { for (var j = 0; j < tos.length; j++) clearTimeout(tos[j]); } catch (e) {}
      try { if (_raf) for (var k = 0; k < rafs.length; k++) cancelAnimationFrame(rafs[k]); } catch (e) {}
      // brute-force sweep the integer-id range for the pre-shim kiosk timers
      try {
        var hi = _st(function () {}, 0);
        if (typeof hi === 'number' && hi > 0) { var lo = hi > 100000 ? hi - 100000 : 0; for (var z = hi; z > lo; z--) { clearTimeout(z); clearInterval(z); } }
      } catch (e) {}
      if (!_frzStyle) {
        try {
          _frzStyle = document.createElement('style');
          _frzStyle.setAttribute('data-educms-freeze', '1');
          _frzStyle.appendChild(document.createTextNode('*{animation:none!important;transition:none!important;}'));
          (document.head || document.documentElement).appendChild(_frzStyle);
        } catch (e) {}
      }
    }
    // Settle window: let the kiosk's first render + auto-fit finish before we
    // freeze. Scheduled via the REAL setTimeout so it isn't recorded/cleared.
    _st(freezeNow, 1400);
    window.__educmsFreezeNow = freezeNow;
  }());

  var BRAND_MAP = {
    background: ['--bg', '--brand-bg'], surface: ['--surface', '--surface-2', '--brand-paper'],
    text: ['--text', '--brand-ink'], muted: ['--text-dim', '--text-mute'],
    primary: ['--accent', '--brand-primary'], accent: ['--accent', '--accent-2', '--brand-accent'],
    fontDisplay: ['--font-display'], fontBody: ['--font-body']
  };
  var state = { brand: {}, text: {}, styles: {}, img: {}, actions: {} };
  var editMode = false;

  function b64json(s) {
    try {
      s = String(s).replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      return JSON.parse(decodeURIComponent(escape(atob(s)))) || {};
    } catch (e) { return {}; }
  }
  function readParams() {
    var q = new URLSearchParams(location.search);
    return { brand: b64json(q.get('brand')), text: b64json(q.get('text')), styles: b64json(q.get('textStyles')), img: b64json(q.get('img')), actions: b64json(q.get('actions')), repeat: b64json(q.get('repeat')) };
  }
  function applyBrand(b) {
    if (!b) return; var r = document.documentElement.style;
    Object.keys(BRAND_MAP).forEach(function (k) { if (b[k]) BRAND_MAP[k].forEach(function (v) { r.setProperty(v, b[k]); }); });
  }
  // Decode HTML entities in an override value before it's written via
  // textContent. The server-side sanitizer (sanitization.pipe.ts) HTML-encodes
  // every request-body string for XSS defense — correct for innerHTML sinks,
  // but these overrides are applied with textContent (which never parses HTML),
  // so the encoding double-applies and a value typed "Mix & Match" would show
  // the literal "Mix &amp; Match". Decoding here is XSS-SAFE: a DETACHED
  // <textarea> parses its innerHTML as RCDATA (text only — "<img onerror>" stays
  // literal, no element/script is ever created), and the decoded string is then
  // assigned via textContent, which also never executes HTML. Net: the operator
  // sees exactly what they typed, with zero injection surface.
  var _veDecoder = null;
  function decodeEntities(s) {
    if (typeof s !== 'string' || s.indexOf('&') === -1) return s; // fast path
    try {
      if (!_veDecoder) _veDecoder = document.createElement('textarea');
      _veDecoder.innerHTML = s;
      return _veDecoder.value;
    } catch (e) { return s; }
  }
  function applyText(text, styles) {
    var keys = {}; Object.keys(text || {}).forEach(function (k) { keys[k] = 1; }); Object.keys(styles || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var nodes = document.querySelectorAll('[data-field="' + k.replace(/"/g, '\\"') + '"]');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (text && typeof text[k] === 'string') {
          var val = decodeEntities(text[k]);
          if (el.children.length === 0) { el.textContent = val; }
          else { var tn = null; for (var j = 0; j < el.childNodes.length; j++) { if (el.childNodes[j].nodeType === 3) { tn = el.childNodes[j]; break; } } if (tn) tn.textContent = val; else el.insertBefore(document.createTextNode(val), el.firstChild); }
        }
        var s = styles && styles[k];
        if (s) { if (s.color) el.style.color = s.color; if (s.fontSize != null) el.style.fontSize = (typeof s.fontSize === 'number' ? s.fontSize + 'px' : s.fontSize); if (s.fontWeight != null) el.style.fontWeight = String(s.fontWeight); if (s.fontStyle) el.style.fontStyle = s.fontStyle; if (s.fontFamily) el.style.fontFamily = s.fontFamily; if (s.textAlign) el.style.textAlign = s.textAlign; if (s.textDecoration) el.style.textDecoration = s.textDecoration; if (s.backgroundColor) el.style.backgroundColor = s.backgroundColor; if (s.lineHeight != null) el.style.lineHeight = String(s.lineHeight); }
      }
    });
  }
  function applyImages(img) {
    if (!img) return;
    Object.keys(img).forEach(function (k) {
      var v = img[k]; if (typeof v !== 'string' || !v) return;
      var esc = k.replace(/"/g, '\\"');
      // apply to EVERY match (visible render node + hidden manifest node), not
      // just the first — querySelector would hit the manifest div and miss the card.
      var els = document.querySelectorAll('[data-img="' + esc + '"],[data-slot="' + esc + '"]');
      var safe = v.replace(/[\s]/g, '%20').replace(/["'()]/g, '');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.tagName === 'IMG') { el.setAttribute('src', safe); } else { el.style.setProperty('--src', "url('" + safe + "')"); el.style.backgroundImage = "url('" + safe + "')"; el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center'; if (el.classList) el.classList.add('has-media'); }
        el.setAttribute('data-has-image', 'true');
      }
    });
  }

  // ── repeating groups ────────────────────────────────────────────────
  // A screen that ships `tile.0.label` … `tile.2.label` already declares a
  // list; the operator should be able to make it four and have the rows
  // share the space. Same contract as the packaged-board shim
  // (EDUCMS-SHIM-V11): the group is INFERRED from the indexed keys, so no
  // kiosk screen needs new markup, and at the authored count nothing about
  // the render changes at all.
  function rpGroups() {
    var map = {}, all = document.querySelectorAll('[data-field],[data-style]');
    for (var i = 0; i < all.length; i++) {
      var el = all[i], k = el.getAttribute('data-field') || el.getAttribute('data-style') || '';
      var m = /^([A-Za-z][\w-]*)\.(\d+)\./.exec(k);
      if (!m) continue;
      var g = m[1], n = +m[2];
      map[g] = map[g] || {}; (map[g][n] = map[g][n] || []).push(el);
    }
    var out = [];
    Object.keys(map).forEach(function (g) {
      var idxs = Object.keys(map[g]).map(Number).sort(function (a, b) { return a - b; });
      if (idxs.length < 2) return;
      for (var c = 1; c < idxs.length; c++) if (idxs[c] !== idxs[c - 1] + 1) return;
      var items = [];
      for (var j = 0; j < idxs.length; j++) {
        var els = map[g][idxs[j]], best = els[0], par = els[0].parentElement;
        while (par && par !== document.body) {
          var all2 = true; for (var q = 0; q < els.length; q++) if (!par.contains(els[q])) { all2 = false; break; }
          if (!all2) break;
          var clean = true;
          for (var r = 0; r < idxs.length && clean; r++) {
            if (idxs[r] === idxs[j]) continue;
            var o = map[g][idxs[r]];
            for (var t = 0; t < o.length; t++) if (par.contains(o[t])) { clean = false; break; }
          }
          if (!clean) break;
          best = par; par = par.parentElement;
        }
        items.push(best);
      }
      var parent = items[0].parentElement; if (!parent) return;
      for (var j2 = 1; j2 < items.length; j2++) if (items[j2].parentElement !== parent) return;
      out.push({ group: g, items: items, parent: parent, base: idxs[0] });
    });
    return out;
  }
  function rpRenumber(root, group, from, to) {
    var A = ['data-field', 'data-style', 'data-img', 'data-slot', 'data-action'],
        N = [root].concat([].slice.call(root.querySelectorAll('*')));
    for (var i = 0; i < N.length; i++) for (var j = 0; j < A.length; j++) {
      var v = N[i].getAttribute && N[i].getAttribute(A[j]); if (!v) continue;
      var pre = group + '.' + from + '.';
      if (v.indexOf(pre) === 0) N[i].setAttribute(A[j], group + '.' + to + '.' + v.slice(pre.length));
    }
  }
  var rpStyled = false;
  function rpStyle() {
    if (rpStyled) return; rpStyled = true;
    var st = document.createElement('style');
    st.textContent = '[data-educms-repeat]{display:flex;flex-direction:column;gap:var(--educms-repeat-gap,18px);height:100%;align-content:stretch}'
      + '[data-educms-repeat]>[data-educms-repeat-item]{flex:1 1 0;min-height:0;margin-bottom:0;overflow:hidden}';
    document.head.appendChild(st);
  }
  function applyRepeat(counts) {
    if (!counts || typeof counts !== 'object') return;
    var G = rpGroups();
    for (var i = 0; i < G.length; i++) {
      var g = G[i], want = counts[g.group];
      if (typeof want !== 'number' || !isFinite(want)) continue;
      var mx = parseInt(g.parent.getAttribute('data-repeat-max') || '', 10); if (!isFinite(mx)) mx = 12;
      want = Math.max(1, Math.min(mx, Math.round(want)));
      var have = g.items.length;
      if (want === have) {
        g.parent.removeAttribute('data-educms-repeat');
        for (var z = 0; z < g.items.length; z++) g.items[z].removeAttribute('data-educms-repeat-item');
        continue;
      }
      if (want < have) { for (var d = have - 1; d >= want; d--) if (g.items[d].parentNode) g.items[d].parentNode.removeChild(g.items[d]); }
      else { var tpl = g.items[have - 1]; for (var a = have; a < want; a++) { var cl = tpl.cloneNode(true); rpRenumber(cl, g.group, g.base + have - 1, g.base + a); g.parent.appendChild(cl); } }
      rpStyle();
      g.parent.setAttribute('data-educms-repeat', '');
      var kids = g.parent.children;
      for (var y = 0; y < kids.length; y++) kids[y].setAttribute('data-educms-repeat-item', '');
    }
  }

  function applyAll() { applyBrand(state.brand); applyRepeat(state.repeat); applyText(state.text, state.styles); applyImages(state.img); if (editMode) armEdit(); }

  // ── edit mode (builder) ──────────────────────────────────────────────
  function armEdit() {
    document.querySelectorAll('[data-field],[data-img],[data-action]').forEach(function (el) {
      if (el.__veArmed) return;
      if (el.closest && el.closest('#venueos-fields')) return; // hidden manifest — not a click target
      el.__veArmed = true;
      el.style.cursor = 'pointer';
      var isAct = el.hasAttribute('data-action');
      el.addEventListener('mouseenter', function () { el.style.outline = '2px dashed ' + (isAct ? '#f59e0b' : '#06b6d4'); el.style.outlineOffset = '2px'; });
      el.addEventListener('mouseleave', function () { el.style.outline = ''; });
      el.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var key = el.getAttribute('data-action') || el.getAttribute('data-field') || el.getAttribute('data-img') || '';
        var kind = el.hasAttribute('data-action') ? 'action' : (el.hasAttribute('data-img') ? 'img' : 'text');
        try { parent.postMessage({ type: 'educms-field-click', key: key, kind: kind }, '*'); } catch (_) {}
      }, true);
    });
  }

  // ── player mode: a tap on a WIRED [data-action] button posts the
  // operator-configured platform action up to the player (which runs it
  // through the security-gated dispatchTouchAction). Delegated on document
  // so it survives every screen swap without re-arming. Never fires in
  // edit mode (there the click configures the action instead). The kiosk's
  // own handler still runs — we don't preventDefault — so a "Send order"
  // button can show its confirmation screen AND fire the POS webhook.
  function onActionTap(e) {
    if (editMode) return;
    var t = e.target; var el = t && t.closest ? t.closest('[data-action]') : null;
    if (!el || (el.closest && el.closest('#venueos-fields'))) return;
    var key = el.getAttribute('data-action'); if (!key) return;
    var action = state.actions && state.actions[key];
    if (action && typeof action === 'object' && action.type) {
      try { parent.postMessage({ type: 'educms-action', key: key, action: action }, '*'); } catch (_) {}
    }
  }

  function init() {
    var p = readParams(); state.brand = p.brand; state.text = p.text; state.styles = p.styles; state.img = p.img; state.actions = p.actions || {}; state.repeat = p.repeat || {};
    document.addEventListener('click', onActionTap, true);
    // Wrap the engine render so overrides survive every screen swap.
    function hook() {
      if (!window.Kiosk || window.Kiosk.__veHooked) return false;
      window.Kiosk.__veHooked = true;
      var origRender = window.Kiosk._render;
      window.Kiosk._render = function () { var r = origRender.apply(this, arguments); setTimeout(applyAll, 0); return r; };
      var origSheet = window.Kiosk.sheet;
      if (origSheet) window.Kiosk.sheet = function () { var r = origSheet.apply(this, arguments); setTimeout(applyAll, 0); return r; };
      return true;
    }
    if (!hook()) { var tries = 0, iv = setInterval(function () { if (hook() || ++tries > 40) clearInterval(iv); }, 25); }
    applyAll();
    try { parent.postMessage({ type: 'educms-ready' }, '*'); } catch (_) {}
    addEventListener('message', function (e) {
      var d = e.data; if (!d || typeof d !== 'object') return;
      if (d.type === 'educms-overrides') { if (d.brand) state.brand = d.brand; if (d.text) state.text = d.text; if (d.textStyles) state.styles = d.textStyles; if (d.img) state.img = d.img; if (d.actions) state.actions = d.actions; if (d.repeat) state.repeat = d.repeat; applyAll(); }
      else if (d.type === 'educms-edit-mode') { editMode = !!d.on; if (editMode) { unfreeze(); armEdit(); } }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
