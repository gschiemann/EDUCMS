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
    return { brand: b64json(q.get('brand')), text: b64json(q.get('text')), styles: b64json(q.get('textStyles')), img: b64json(q.get('img')), actions: b64json(q.get('actions')) };
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
  function applyAll() { applyBrand(state.brand); applyText(state.text, state.styles); applyImages(state.img); if (editMode) armEdit(); }

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
    var p = readParams(); state.brand = p.brand; state.text = p.text; state.styles = p.styles; state.img = p.img; state.actions = p.actions || {};
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
      if (d.type === 'educms-overrides') { if (d.brand) state.brand = d.brand; if (d.text) state.text = d.text; if (d.textStyles) state.styles = d.textStyles; if (d.img) state.img = d.img; if (d.actions) state.actions = d.actions; applyAll(); }
      else if (d.type === 'educms-edit-mode') { editMode = !!d.on; if (editMode) armEdit(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
