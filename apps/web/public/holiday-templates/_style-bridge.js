/* _style-bridge.js — per-element style override bridge for holiday templates.
 *
 * Loaded once per holiday HTML via <script src="_style-bridge.js"></script>.
 * Mirrors the HS widget useTextStyleOverrides hook on the iframe side: every
 * [data-field] element accepts inline overrides for fontSize / color /
 * fontWeight, applied via postMessage from the parent editor.
 *
 * Why a shared file: 18 HTMLs × 1 inline copy each would be a maintenance
 * trap. Living here means a future tweak (e.g. add letterSpacing) is one
 * file change, not 18.
 *
 * Protocol (parent → iframe):
 *   { type: 'template-apply-styles',
 *     styles: { '<field>': { fontSize?: number, color?: string, fontWeight?: number } } }
 *
 * Behaviour:
 *   - For each [data-field] element, look up styles[el.dataset.field].
 *   - If a style prop is set: apply as inline style (px for fontSize, raw
 *     for color, stringified number for fontWeight).
 *   - If absent / empty: clear the inline style so the element falls back
 *     to its CSS class default.
 *
 * The script also stashes the last-applied map on window so re-walks
 * triggered by DOM mutations (text edits via 'holiday:setField' don't
 * touch styles, but conditional rerenders could) keep the operator's
 * customisations sticky. Re-applies on iframe `load` for the case where
 * the parent posts styles before DOMContentLoaded fires.
 */
(function () {
  var lastStyles = {};

  function applyOne(el, override) {
    // fontSize ── px when set, blank to fall back to CSS class.
    if (override && override.fontSize != null && isFinite(override.fontSize)) {
      el.style.fontSize = override.fontSize + 'px';
    } else if (el.style.fontSize) {
      el.style.fontSize = '';
    }
    // color ── hex/rgb when set, blank to fall back.
    if (override && override.color) {
      el.style.color = override.color;
    } else if (el.style.color) {
      el.style.color = '';
    }
    // fontWeight ── 100..900 when set, blank to fall back.
    if (override && override.fontWeight != null && isFinite(override.fontWeight)) {
      el.style.fontWeight = String(override.fontWeight);
    } else if (el.style.fontWeight) {
      el.style.fontWeight = '';
    }
  }

  function applyAll(styles) {
    if (styles && typeof styles === 'object') {
      lastStyles = styles;
    }
    var nodes = document.querySelectorAll('[data-field]');
    nodes.forEach(function (el) {
      var key = el.getAttribute('data-field');
      if (!key) return;
      applyOne(el, lastStyles[key]);
    });
  }

  // Listen for parent updates.
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'template-apply-styles') {
      applyAll(d.styles || {});
    }
  });

  // Re-apply on load for the race where parent posts styles before
  // DOMContentLoaded — first apply happens once nodes are mounted.
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    applyAll(lastStyles);
  } else {
    document.addEventListener('DOMContentLoaded', function () { applyAll(lastStyles); });
  }
  window.addEventListener('load', function () { applyAll(lastStyles); });
})();
