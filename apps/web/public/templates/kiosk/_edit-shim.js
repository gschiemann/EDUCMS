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
  var state = { brand: {}, text: {}, styles: {}, img: {} };
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
    return { brand: b64json(q.get('brand')), text: b64json(q.get('text')), styles: b64json(q.get('textStyles')), img: b64json(q.get('img')) };
  }
  function applyBrand(b) {
    if (!b) return; var r = document.documentElement.style;
    Object.keys(BRAND_MAP).forEach(function (k) { if (b[k]) BRAND_MAP[k].forEach(function (v) { r.setProperty(v, b[k]); }); });
  }
  function applyText(text, styles) {
    var keys = {}; Object.keys(text || {}).forEach(function (k) { keys[k] = 1; }); Object.keys(styles || {}).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var nodes = document.querySelectorAll('[data-field="' + k.replace(/"/g, '\\"') + '"]');
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (text && typeof text[k] === 'string') {
          if (el.children.length === 0) { el.textContent = text[k]; }
          else { var tn = null; for (var j = 0; j < el.childNodes.length; j++) { if (el.childNodes[j].nodeType === 3) { tn = el.childNodes[j]; break; } } if (tn) tn.textContent = text[k]; else el.insertBefore(document.createTextNode(text[k]), el.firstChild); }
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
    document.querySelectorAll('[data-field],[data-img]').forEach(function (el) {
      if (el.__veArmed) return;
      if (el.closest && el.closest('#venueos-fields')) return; // hidden manifest — not a click target
      el.__veArmed = true;
      el.style.cursor = 'pointer';
      el.addEventListener('mouseenter', function () { el.style.outline = '2px dashed #06b6d4'; el.style.outlineOffset = '2px'; });
      el.addEventListener('mouseleave', function () { el.style.outline = ''; });
      el.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var key = el.getAttribute('data-field') || el.getAttribute('data-img') || '';
        var kind = el.hasAttribute('data-img') ? 'img' : 'text';
        try { parent.postMessage({ type: 'educms-field-click', key: key, kind: kind }, '*'); } catch (_) {}
      }, true);
    });
  }

  function init() {
    var p = readParams(); state.brand = p.brand; state.text = p.text; state.styles = p.styles; state.img = p.img;
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
      if (d.type === 'educms-overrides') { if (d.brand) state.brand = d.brand; if (d.text) state.text = d.text; if (d.textStyles) state.styles = d.textStyles; if (d.img) state.img = d.img; applyAll(); }
      else if (d.type === 'educms-edit-mode') { editMode = !!d.on; if (editMode) armEdit(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
