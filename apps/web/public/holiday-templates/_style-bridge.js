/* _style-bridge.js — per-element style + hotspot bridge for holiday templates.
 *
 * Loaded once per holiday HTML via <script src="_style-bridge.js"></script>.
 * Mirrors the HS widget useTextStyleOverrides hook on the iframe side: every
 * [data-field] element accepts the complete BuilderBottomBar text-style
 * contract, applied via postMessage from the parent editor.
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
 *     styles: { '<field>': {
 *       fontFamily?, fontSize?, color?, fontWeight?, bold?, fontStyle?,
 *       italic?, textDecoration?, underline?, strikethrough?, textAlign?,
 *       lineHeight?, backgroundColor?, visibility?, hidden?
 *     } } }
 *   { type: 'template-set-hotspots', enabled: boolean }
 *
 * Behaviour:
 *   - For each [data-field] element, look up styles[el.dataset.field].
 *   - If a style prop is set: apply as inline style (px for fontSize, raw
 *     for color, stringified number for fontWeight).
 *   - If absent / empty: restore the element's authored inline value (or an
 *     empty value when the board originally relied on its CSS class).
 *   - Hotspots: when enabled, [data-field] elements show a dotted indigo
 *     outline + cursor:pointer. Hovering bumps to dashed outline + light
 *     tint. Identical UX to BuilderZone's non-iframe widgets so operators
 *     don't have to learn a different "what's editable" cue per template.
 *
 * The script also keeps the last-applied map and re-walks fields after text
 * or child mutations. That matters for living date/time/weather widgets and
 * for editor text changes: their DOM updates must not erase an operator's
 * explicit typography. Re-applies on iframe `load` for the case where the
 * parent posts styles before DOMContentLoaded fires.
 */
(function () {
  var lastStyles = {};
  var lastBrandVars = {};
  // Clearing an override must restore the board's authored inline value, not
  // blindly erase it. WeakMap is supported by every browser in our matrix
  // (including Safari 12); the expando fallback keeps the bridge defensive in
  // older kiosk WebViews without serialising anything into HTML attributes.
  var originalStyles = typeof WeakMap === 'function' ? new WeakMap() : null;
  var bridgeStyleSnapshots = typeof WeakMap === 'function' ? new WeakMap() : null;
  var ORIGINAL_KEY = '__eduHolidayOriginalStyles';
  var SNAPSHOT_KEY = '__eduHolidayBridgeStyleSnapshot';
  var LIVE_FALLBACK_KEY = '__eduHolidayLiveFallback';
  var mutationApplyQueued = false;
  var liveApplyQueued = false;
  var liveTextOverrides = {};
  var liveTextFallbacks = {};
  var pendingLiveResumes = {};
  var TRACKED_STYLE_PROPS = [
    'fontFamily', 'fontSize', 'color', 'fontWeight', 'fontStyle',
    'textDecoration', 'textAlign', 'lineHeight', 'backgroundColor',
    'visibility', 'display',
  ];
  var BRAND_VAR_NAMES = ['--brand-primary', '--brand-accent'];
  var GOOGLE_FONT_FAMILIES = {
    'Inter': 1,
    'Roboto': 1,
    'Open Sans': 1,
    'Lato': 1,
    'Montserrat': 1,
    'Poppins': 1,
    'Oswald': 1,
    'Raleway': 1,
    'Nunito': 1,
    'Source Sans Pro': 1,
    'Playfair Display': 1,
    'Merriweather': 1,
    'Bebas Neue': 1,
    'Caveat': 1,
    'Pacifico': 1,
  };

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function captureTrackedStyles(el) {
    var s = el.style;
    var captured = {};
    TRACKED_STYLE_PROPS.forEach(function (prop) {
      captured[prop] = s[prop] || '';
    });
    return captured;
  }

  function originalsFor(el) {
    var existing = originalStyles ? originalStyles.get(el) : el[ORIGINAL_KEY];
    if (existing) return existing;
    var captured = captureTrackedStyles(el);
    if (originalStyles) originalStyles.set(el, captured);
    else {
      try { el[ORIGINAL_KEY] = captured; } catch (e) {
        // Some old WebViews expose non-extensible host nodes. Coercing the
        // expected error keeps this ES5-safe while making the intentional
        // swallow explicit to static analysis.
        String(e);
      }
    }
    return captured;
  }

  function bridgeSnapshotFor(el) {
    return bridgeStyleSnapshots ? bridgeStyleSnapshots.get(el) : el[SNAPSHOT_KEY];
  }

  function rememberBridgeSnapshot(el, snapshot) {
    var value = snapshot || captureTrackedStyles(el);
    if (bridgeStyleSnapshots) bridgeStyleSnapshots.set(el, value);
    else {
      try { el[SNAPSHOT_KEY] = value; } catch (e) { String(e); }
    }
  }

  function setStyleValue(el, prop, value) {
    var next = value || '';
    if (el.style[prop] !== next) el.style[prop] = next;
  }

  function hasFiniteNumber(value) {
    return value !== '' && value != null && isFinite(Number(value));
  }

  function stringValue(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  }

  function restore(el, prop, originals) {
    setStyleValue(el, prop, originals[prop] || '');
  }

  function firstFontFamily(value) {
    if (!value) return '';
    return value.split(',')[0].replace(/^\s*["']|["']\s*$/g, '').trim();
  }

  function ensureGoogleFont(fontFamily) {
    var family = firstFontFamily(fontFamily);
    if (!GOOGLE_FONT_FAMILIES[family]) return;
    var id = '__edu-holiday-font-' + family.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (document.getElementById(id)) return;
    var link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.setAttribute('data-edu-holiday-font', family);
    link.href = 'https://fonts.googleapis.com/css2?family=' +
      encodeURIComponent(family).replace(/%20/g, '+') + '&display=swap';
    (document.head || document.documentElement).appendChild(link);
  }

  function applyOne(el, override) {
    var base = originalsFor(el);
    var o = override && typeof override === 'object' ? override : {};
    var value;

    value = stringValue(o.fontFamily);
    if (value) {
      ensureGoogleFont(value);
      setStyleValue(el, 'fontFamily', value);
    }
    else restore(el, 'fontFamily', base);

    if (hasFiniteNumber(o.fontSize) && Number(o.fontSize) > 0) {
      setStyleValue(el, 'fontSize', Number(o.fontSize) + 'px');
    } else restore(el, 'fontSize', base);

    value = stringValue(o.color);
    if (value) setStyleValue(el, 'color', value);
    else restore(el, 'color', base);

    // Explicit numeric weight wins; BuilderBottomBar's canonical `bold`
    // alias maps to the same 800 weight BuilderZone uses.
    if (hasFiniteNumber(o.fontWeight) && Number(o.fontWeight) > 0) {
      setStyleValue(el, 'fontWeight', String(Number(o.fontWeight)));
    } else if (o.bold === true) {
      setStyleValue(el, 'fontWeight', '800');
    } else restore(el, 'fontWeight', base);

    value = stringValue(o.fontStyle);
    if (value === 'italic' || value === 'normal') setStyleValue(el, 'fontStyle', value);
    else if (o.italic === true) setStyleValue(el, 'fontStyle', 'italic');
    else restore(el, 'fontStyle', base);

    value = stringValue(o.textDecoration);
    if (value) {
      setStyleValue(el, 'textDecoration', value);
    } else if (o.underline === true || o.strikethrough === true) {
      var decorations = [];
      if (o.underline === true) decorations.push('underline');
      if (o.strikethrough === true) decorations.push('line-through');
      setStyleValue(el, 'textDecoration', decorations.join(' '));
    } else restore(el, 'textDecoration', base);

    value = stringValue(o.textAlign);
    if (value === 'left' || value === 'center' || value === 'right' || value === 'justify') {
      setStyleValue(el, 'textAlign', value);
    } else restore(el, 'textAlign', base);

    if (hasFiniteNumber(o.lineHeight) && Number(o.lineHeight) > 0) {
      setStyleValue(el, 'lineHeight', String(Number(o.lineHeight)));
    } else restore(el, 'lineHeight', base);

    value = stringValue(o.backgroundColor);
    if (value) setStyleValue(el, 'backgroundColor', value);
    else restore(el, 'backgroundColor', base);

    value = stringValue(o.visibility);
    if (value === 'visible' || value === 'hidden') setStyleValue(el, 'visibility', value);
    else restore(el, 'visibility', base);

    if (o.hidden === true) setStyleValue(el, 'display', 'none');
    else restore(el, 'display', base);

    rememberBridgeSnapshot(el);
  }

  function applyAll(styles, restoreMissing) {
    if (styles && typeof styles === 'object') {
      lastStyles = styles;
    }
    // A jsdom/webview teardown can disconnect the document between a queued
    // living-field mutation and this callback. In a real page this is also a
    // harmless guard during iframe navigation.
    if (!window.document || !window.document.querySelectorAll) return;
    var nodes = window.document.querySelectorAll('[data-field]');
    nodes.forEach(function (el) {
      var key = el.getAttribute('data-field');
      if (!key) return;
      if (hasOwn(lastStyles, key) || restoreMissing) {
        applyOne(el, lastStyles[key]);
      }
    });
  }

  function applyBrandVars(vars) {
    if (vars && typeof vars === 'object') lastBrandVars = vars;
    var root = document.documentElement;
    BRAND_VAR_NAMES.forEach(function (name) {
      var value = stringValue(lastBrandVars[name]);
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    });
  }

  function fieldElementForNode(node) {
    var doc = window.document;
    if (!doc) return null;
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (el && el !== doc.body) {
      if (el.getAttribute && el.getAttribute('data-field')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function captureRuntimeStyleMutation(el) {
    if (!el || !el.getAttribute('data-field')) return false;
    var current = captureTrackedStyles(el);
    var previous = bridgeSnapshotFor(el);
    if (!previous) {
      rememberBridgeSnapshot(el, current);
      return false;
    }
    var base = originalsFor(el);
    var changed = false;
    TRACKED_STYLE_PROPS.forEach(function (prop) {
      if (current[prop] !== previous[prop]) {
        base[prop] = current[prop];
        changed = true;
      }
    });
    if (changed) rememberBridgeSnapshot(el, current);
    var key = el.getAttribute('data-field');
    return changed && hasOwn(lastStyles, key);
  }

  function liveNodesForKey(key) {
    var safe = String(key).replace(/"/g, '\\"');
    return document.querySelectorAll('[data-field="' + safe + '"][data-live]');
  }

  function snapshotLiveFields() {
    document.querySelectorAll('[data-field][data-live]').forEach(function (el) {
      var key = el.getAttribute('data-field');
      if (key && !hasOwn(liveTextFallbacks, key)) {
        liveTextFallbacks[key] = el.textContent || '';
        try { el[LIVE_FALLBACK_KEY] = liveTextFallbacks[key]; } catch (e) { String(e); }
      }
    });
  }

  function setLiveTextOverride(key, value) {
    var nodes = liveNodesForKey(key);
    if (!nodes.length) return;
    if (value === '') {
      delete liveTextOverrides[key];
      var fallback = hasOwn(liveTextFallbacks, key)
        ? liveTextFallbacks[key]
        : (typeof nodes[0][LIVE_FALLBACK_KEY] === 'string' ? nodes[0][LIVE_FALLBACK_KEY] : '');
      pendingLiveResumes[key] = fallback;
      nodes.forEach(function (el) {
        el.removeAttribute('data-pin');
        if (el.textContent !== fallback) el.textContent = fallback;
      });
      // WebKit may run MutationObserver microtasks between two listeners for
      // the same MessageEvent. The legacy inline listener writes the empty
      // editor value too, so a Promise is not late enough to protect the live
      // fallback. Hold the resume value through the whole task and restore it
      // from a timer after every listener + mutation microtask has completed.
      window.setTimeout(function () {
        if (hasOwn(liveTextOverrides, key)) {
          delete pendingLiveResumes[key];
          return;
        }
        var resumeValue = hasOwn(pendingLiveResumes, key)
          ? pendingLiveResumes[key]
          : fallback;
        delete pendingLiveResumes[key];
        liveNodesForKey(key).forEach(function (el) {
          el.removeAttribute('data-pin');
          if (el.textContent !== resumeValue) el.textContent = resumeValue;
        });
      }, 0);
      return;
    }
    delete pendingLiveResumes[key];
    liveTextOverrides[key] = value;
    nodes.forEach(function (el) {
      el.setAttribute('data-pin', '1');
      if (el.textContent !== value) el.textContent = value;
    });
  }

  function captureLiveMutation(el) {
    if (!el || !el.hasAttribute('data-live')) return false;
    var key = el.getAttribute('data-field');
    if (!key) return false;
    var current = el.textContent || '';
    if (hasOwn(pendingLiveResumes, key)) {
      // Ignore the legacy bridge's transient empty write during clear. If the
      // board itself produces a newer non-empty clock/weather value in this
      // same task, prefer that as the value to resume from.
      if (current && current !== pendingLiveResumes[key]) {
        pendingLiveResumes[key] = current;
        liveTextFallbacks[key] = current;
        try { el[LIVE_FALLBACK_KEY] = current; } catch (e) { String(e); }
      }
      return false;
    }
    if (hasOwn(liveTextOverrides, key)) {
      if (current !== liveTextOverrides[key]) {
        liveTextFallbacks[key] = current;
        try { el[LIVE_FALLBACK_KEY] = current; } catch (e) { String(e); }
        return true;
      }
      return false;
    }
    liveTextFallbacks[key] = current;
    try { el[LIVE_FALLBACK_KEY] = current; } catch (e) { String(e); }
    return false;
  }

  function reapplyLiveOverrides() {
    Object.keys(liveTextOverrides).forEach(function (key) {
      liveNodesForKey(key).forEach(function (el) {
        var value = liveTextOverrides[key];
        if (el.textContent !== value) el.textContent = value;
      });
    });
  }

  function queueMutationApply() {
    if (mutationApplyQueued) return;
    mutationApplyQueued = true;
    var scheduled = typeof window.Promise === 'function'
      ? window.Promise.resolve()
      : { then: function (callback) { window.setTimeout(callback, 0); } };
    scheduled.then(function () {
      mutationApplyQueued = false;
      applyAll(null, false);
    });
  }

  function queueLiveApply() {
    if (liveApplyQueued) return;
    liveApplyQueued = true;
    var scheduled = typeof window.Promise === 'function'
      ? window.Promise.resolve()
      : { then: function (callback) { window.setTimeout(callback, 0); } };
    scheduled.then(function () {
      liveApplyQueued = false;
      reapplyLiveOverrides();
    });
  }

  function observeLivingFields() {
    if (!window.MutationObserver || !document.body || document.body.__eduHolidayStyleObserver) return;
    snapshotLiveFields();
    var observer = new MutationObserver(function (records) {
      var stylesChanged = false;
      var liveChanged = false;
      records.forEach(function (record) {
        var el = fieldElementForNode(record.target);
        if (record.type === 'attributes') {
          if (captureRuntimeStyleMutation(el)) stylesChanged = true;
        } else if (captureLiveMutation(el)) {
          liveChanged = true;
        }
      });
      if (stylesChanged) queueMutationApply();
      if (liveChanged) queueLiveApply();
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['style'],
    });
    try { document.body.__eduHolidayStyleObserver = observer; } catch (e) { String(e); }
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

  // The bridge script is loaded at the end of every board, after all authored
  // fields exist. Capture live text immediately, before the inline holiday
  // bridge can service a queued saved-value message during DOMContentLoaded.
  snapshotLiveFields();

  // Listen for parent updates.
  window.addEventListener('message', function (e) {
    // `null`/empty is allowed for direct local-file review and jsdom protocol
    // tests. Hosted boards only accept their exact same-origin parent.
    if (e.origin && e.origin !== 'null' && e.origin !== window.location.origin) return;
    var d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'template-apply-styles') {
      applyAll(d.styles || {}, true);
    } else if (d.type === 'template-apply-brand-vars') {
      applyBrandVars(d.vars || {});
    } else if (d.type === 'holiday:setField' && typeof d.key === 'string') {
      setLiveTextOverride(d.key, String(d.value == null ? '' : d.value));
    } else if (d.type === 'template-set-hotspots') {
      setHotspots(!!d.enabled);
    }
  }, true);

  // Re-apply on load for the race where parent posts styles before
  // DOMContentLoaded — first apply happens once nodes are mounted.
  // Hotspot styles are injected on first message; nothing to pre-mount.
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    applyAll(lastStyles, true);
    applyBrandVars(lastBrandVars);
    injectHotspotStyles();
    observeLivingFields();
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      applyAll(lastStyles, true);
      applyBrandVars(lastBrandVars);
      injectHotspotStyles();
      observeLivingFields();
    });
  }
  window.addEventListener('load', function () {
    applyAll(lastStyles, true);
    applyBrandVars(lastBrandVars);
    injectHotspotStyles();
    observeLivingFields();
  });
})();
