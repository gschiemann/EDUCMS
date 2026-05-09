/* _style-bridge.js — per-element style + hotspot bridge for holiday templates.
 *
 * Loaded once per holiday HTML via <script src="_style-bridge.js"></script>.
 * Mirrors the HS widget useTextStyleOverrides hook on the iframe side: every
 * [data-field] element accepts inline overrides for fontSize / color /
 * fontWeight, applied via postMessage from the parent editor.
 *
 * ALSO renders the hotspot affordance — the dotted-indigo outline + dashed
 * hover state that BuilderZone applies to [data-field] in non-iframe widgets.
 * Because iframe + parent are different documents, the parent's CSS can't
 * reach inside; we inject the equivalent CSS here, gated on `data-hotspots-on`
 * on the iframe's <html> element. HolidayWidget toggles that attribute via
 * postMessage based on the zone's selected state in the builder store.
 *
 * Why a shared file: 18 HTMLs × 1 inline copy each would be a maintenance
 * trap. Living here means a future tweak (e.g. add letterSpacing or change
 * the hotspot color) is one file change, not 18.
 *
 * Protocol (parent → iframe):
 *   { type: 'template-apply-styles',
 *     styles: { '<field>': { fontSize?: number, color?: string, fontWeight?: number } } }
 *   { type: 'template-set-hotspots', enabled: boolean }
 *
 * Behaviour:
 *   - For each [data-field] element, look up styles[el.dataset.field].
 *   - If a style prop is set: apply as inline style (px for fontSize, raw
 *     for color, stringified number for fontWeight).
 *   - If absent / empty: clear the inline style so the element falls back
 *     to its CSS class default.
 *   - Hotspots: when enabled, [data-field] elements show a dotted indigo
 *     outline + cursor:pointer. Hovering bumps to dashed outline + light
 *     tint. Identical UX to BuilderZone's non-iframe widgets so operators
 *     don't have to learn a different "what's editable" cue per template.
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

  // ── Hotspot CSS injection ───────────────────────────────────────
  // Mirrors the rules BuilderZone emits for non-iframe widgets:
  //   - 1px dotted indigo when selected (any [data-field] not in edit mode)
  //   - 2px dashed indigo + light tint on hover
  // Gated on html[data-hotspots-on="1"] so production rendering stays clean.
  // We inject once on first load; toggling the attribute is what shows/hides.
  function injectHotspotStyles() {
    if (document.getElementById('__edu-hotspot-style')) return;
    var s = document.createElement('style');
    s.id = '__edu-hotspot-style';
    s.textContent = [
      'html[data-hotspots-on="1"] [data-field] {',
      '  cursor: pointer;',
      '  transition: outline 0.12s, background 0.12s, border-radius 0.12s;',
      '}',
      'html[data-hotspots-on="1"] [data-field]:not([contenteditable="true"]) {',
      '  outline: 1px dotted rgba(99, 102, 241, 0.55);',
      '  outline-offset: 2px;',
      '  border-radius: 3px;',
      '}',
      'html[data-hotspots-on="1"] [data-field]:not([contenteditable="true"]):hover {',
      '  outline: 2px dashed #6366f1;',
      '  outline-offset: 2px;',
      '  background: rgba(99, 102, 241, 0.08);',
      '  border-radius: 3px;',
      '}',
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  function setHotspots(enabled) {
    injectHotspotStyles();
    var html = document.documentElement;
    if (enabled) {
      html.setAttribute('data-hotspots-on', '1');
    } else {
      html.removeAttribute('data-hotspots-on');
    }
  }

  // Listen for parent updates.
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'template-apply-styles') {
      applyAll(d.styles || {});
    } else if (d.type === 'template-set-hotspots') {
      setHotspots(!!d.enabled);
    }
  });

  // Re-apply on load for the race where parent posts styles before
  // DOMContentLoaded — first apply happens once nodes are mounted.
  // Hotspot styles are injected on first message; nothing to pre-mount.
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    applyAll(lastStyles);
    injectHotspotStyles();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      applyAll(lastStyles);
      injectHotspotStyles();
    });
  }
  window.addEventListener('load', function () {
    applyAll(lastStyles);
    injectHotspotStyles();
  });
})();
