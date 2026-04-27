/**
 * Holiday template iframe bridge.
 *
 * Auto-injected into every apps/web/public/holiday-templates/*.html via
 * the bridge-injection sed pass below. Three jobs:
 *
 *   1. Auto-scale the 3840x2160 (or 2160x3840) stage to whatever
 *      viewport the iframe currently has.
 *   2. On load, scan every [data-field] element, send the parent a
 *      schema {key, defaultText, multiline} so the PropertiesPanel
 *      can build form fields without a hand-maintained registry.
 *   3. Click handler on every [data-field] element posts
 *      {type:'holiday:fieldClicked', key} to the parent — the parent's
 *      HolidayWidget bridges that to the canvas's existing
 *      template-edit-field event so click-to-edit jumps to the right
 *      field in the panel.
 *   4. Listens for {type:'holiday:setField', key, value} from the
 *      parent — applies value to ALL [data-field="key"] elements'
 *      textContent.
 *
 * Strict: only same-origin postMessages are honored (the parent and
 * iframe are both served from the EDU CMS domain). The bridge does
 * NOT execute eval-style payloads — only textContent updates.
 *
 * Single source of truth for this script: scripts/holiday-bridge.js.
 * The minified version below is also embedded inline in every
 * holiday HTML via the inject-holiday-bridge.sh pass.
 */
(function () {
  'use strict';

  // ── 1. Auto-scale ────────────────────────────────────────────
  function applyScale() {
    var stageW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--stage-w'), 10) || 3840;
    var stageH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--stage-h'), 10) || 2160;
    var sc = Math.min(window.innerWidth / stageW, window.innerHeight / stageH);
    document.documentElement.style.setProperty('--stage-scale', sc);
  }
  applyScale();
  window.addEventListener('resize', applyScale);

  // ── 2. Field discovery + parent handshake ────────────────────
  function reportSchema() {
    var nodes = document.querySelectorAll('[data-field]');
    var seen = Object.create(null);
    var fields = [];
    nodes.forEach(function (n) {
      var k = n.getAttribute('data-field');
      if (!k || seen[k]) return;
      seen[k] = 1;
      var txt = (n.textContent || '').trim();
      // Field is multiline if it has a newline, OR is over 80 chars,
      // OR the element is a <p>/<div class*=feast>/<div class*=memo>.
      var multiline = /\n/.test(txt) || txt.length > 80 ||
        n.tagName === 'P';
      fields.push({ key: k, defaultText: txt, multiline: multiline });
    });
    try {
      window.parent.postMessage({ type: 'holiday:ready', fields: fields }, '*');
    } catch (e) {
      // parent.postMessage can throw on cross-origin; iframe is
      // same-origin so this should never fire — but defensively
      // swallow if it does.
    }
  }
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    reportSchema();
  } else {
    document.addEventListener('DOMContentLoaded', reportSchema);
  }

  // ── 3. Click → tell parent which field was clicked ───────────
  document.addEventListener('click', function (ev) {
    var el = ev.target;
    while (el && el !== document.body) {
      if (el.nodeType === 1 && el.hasAttribute && el.hasAttribute('data-field')) {
        try {
          window.parent.postMessage({
            type: 'holiday:fieldClicked',
            key: el.getAttribute('data-field'),
          }, '*');
        } catch (e) { /* swallow */ }
        return;
      }
      el = el.parentNode;
    }
  });

  // ── 4. Listen for field updates from parent ──────────────────
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'holiday:setField') {
      var key = String(d.key || '');
      if (!key) return;
      var nodes = document.querySelectorAll('[data-field="' + key.replace(/"/g, '\\"') + '"]');
      var val = String(d.value == null ? '' : d.value);
      nodes.forEach(function (n) {
        n.textContent = val;
      });
    }
  });
})();
