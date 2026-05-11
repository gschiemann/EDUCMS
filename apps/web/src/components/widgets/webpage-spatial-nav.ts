/**
 * Spatial-navigation shim for the WEBPAGE widget iframe.
 *
 * 2026-05-07 — operator: "when I use the Goodview CMS player and push a
 * URL, the remote control is able to essentially tab around the website
 * so I can select buttons without a mouse or keyboard, using up and down
 * on the remote it highlights the different links on the website. Our
 * player doesn't do that at all."
 *
 * Background: Android System WebView ignores the chromium
 * `--enable-spatial-navigation` flag (gated behind a chrome:// flag
 * the OEM hasn't preset for us). The original fix in
 * apps/player/.../SpatialNavigation.kt only injected this JS into the
 * NATIVE "URL overlay" WebView — a separate Android WebView used when
 * an operator "pushes" a fullscreen URL via the bridge.
 *
 * 2026-05-11 — but WEBPAGE widgets inside a TEMPLATE don't go through
 * that overlay path. They render as an iframe inside the React player
 * (apps/web/src/app/player). The native shim never fires for them.
 *
 * Fix: replicate the same shim, but injected from the React parent
 * into the iframe's contentDocument every time the iframe loads
 * (initial load + any in-iframe navigations). Because we route every
 * WEBPAGE iframe through our same-origin `/api/v1/proxy/web` proxy,
 * the iframe is same-origin with the React app and we can call
 * `iframe.contentWindow.eval(SHIM_JS)` legally.
 *
 * The shim itself is identical to the Android-injected one (kept
 * in source-parity for easier debugging when one path works and the
 * other doesn't).
 */

/**
 * The shim JS — runs in the iframe's main world. Self-deduplicates via
 * `window.__eduCmsSpatialNav`. ~110 lines of vanilla JS, no deps.
 *
 * Listens for arrow keys + Enter/Space and moves focus geometrically
 * among visible focusable elements. Applies a high-contrast indigo
 * focus ring so the focused element is unmistakable on a TV screen
 * viewed from across the room.
 */
export const WEBPAGE_SPATIAL_NAV_SHIM = String.raw`
(function() {
  if (window.__eduCmsSpatialNav) return;
  window.__eduCmsSpatialNav = true;
  try {
    var FOCUS_SEL = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled]):not([type="hidden"])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
      '[role="button"]',
      '[role="link"]',
      '[role="menuitem"]',
      '[role="tab"]',
      '[contenteditable="true"]'
    ].join(',');

    var styleId = '__edu-cms-spatial-nav-style';
    if (!document.getElementById(styleId)) {
      var s = document.createElement('style');
      s.id = styleId;
      s.textContent = ''
        + '*:focus, *:focus-visible {'
        + '  outline: 3px solid #4f46e5 !important;'
        + '  outline-offset: 2px !important;'
        + '  box-shadow: 0 0 0 5px rgba(79, 70, 229, 0.35) !important;'
        + '}';
      (document.head || document.documentElement).appendChild(s);
    }

    function isVisible(el) {
      if (!el || !el.getBoundingClientRect) return false;
      var r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      if (r.bottom < 0 || r.right < 0) return false;
      var vh = window.innerHeight || document.documentElement.clientHeight;
      var vw = window.innerWidth || document.documentElement.clientWidth;
      if (r.top > vh || r.left > vw) return false;
      var st = window.getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none') return false;
      if (parseFloat(st.opacity) === 0) return false;
      return true;
    }

    function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

    function candidates() {
      var nodes = document.querySelectorAll(FOCUS_SEL);
      var out = [];
      for (var i = 0; i < nodes.length; i++) {
        if (isVisible(nodes[i])) out.push(nodes[i]);
      }
      return out;
    }

    function score(curRect, candRect, dir) {
      var cur = center(curRect), cand = center(candRect);
      var dx = cand.x - cur.x, dy = cand.y - cur.y;
      var inCone =
        (dir === 'up'    && dy < -1 && Math.abs(dx) <= Math.abs(dy) + 50) ||
        (dir === 'down'  && dy >  1 && Math.abs(dx) <= Math.abs(dy) + 50) ||
        (dir === 'left'  && dx < -1 && Math.abs(dy) <= Math.abs(dx) + 50) ||
        (dir === 'right' && dx >  1 && Math.abs(dy) <= Math.abs(dx) + 50);
      if (!inCone) return Infinity;
      var primary = (dir === 'up' || dir === 'down') ? Math.abs(dy) : Math.abs(dx);
      var secondary = (dir === 'up' || dir === 'down') ? Math.abs(dx) : Math.abs(dy);
      return primary + secondary * 3;
    }

    function pickInitial() {
      var list = candidates();
      if (!list.length) return null;
      list.sort(function(a, b) {
        var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        if (Math.abs(ra.top - rb.top) > 8) return ra.top - rb.top;
        return ra.left - rb.left;
      });
      return list[0];
    }

    function move(dir) {
      var active = document.activeElement;
      var list = candidates();
      if (!list.length) {
        // No focusable elements visible — scroll the page instead
        // so the user can find content. Goodview's remote does this
        // when the focus ring has nowhere to go.
        return scrollInDir(dir);
      }
      if (!active || active === document.body || list.indexOf(active) === -1) {
        var first = pickInitial();
        if (first) { first.focus(); first.scrollIntoView({block:'nearest', inline:'nearest'}); return true; }
        return scrollInDir(dir);
      }
      var curR = active.getBoundingClientRect();
      var best = null, bestScore = Infinity;
      for (var i = 0; i < list.length; i++) {
        if (list[i] === active) continue;
        var sc = score(curR, list[i].getBoundingClientRect(), dir);
        if (sc < bestScore) { bestScore = sc; best = list[i]; }
      }
      if (best) {
        best.focus();
        best.scrollIntoView({block:'nearest', inline:'nearest'});
        return true;
      }
      // No focusable target in this direction — operator hit the edge
      // of the focusable chain. Goodview-style fallback: scroll the
      // page in that direction so they can see what's below. After
      // scroll, new focusable elements may come into view and the
      // next press will pick them up.
      return scrollInDir(dir);
    }

    // Scroll the page (or focused scrollable container) in the given
    // direction by a viewport-relative amount. Matches the
    // "long-press scrolls the page" UX Goodview's player has.
    function scrollInDir(dir) {
      var amt = Math.round((dir === 'up' || dir === 'down'
        ? (window.innerHeight || 600)
        : (window.innerWidth || 800)) * 0.6);
      var dx = 0, dy = 0;
      if (dir === 'up') dy = -amt;
      else if (dir === 'down') dy = amt;
      else if (dir === 'left') dx = -amt;
      else if (dir === 'right') dx = amt;
      try {
        window.scrollBy({ top: dy, left: dx, behavior: 'smooth' });
        return true;
      } catch (e) {
        window.scrollBy(dx, dy);
        return true;
      }
    }

    function activate() {
      var el = document.activeElement;
      if (!el || el === document.body) {
        var first = pickInitial();
        if (first) { first.focus(); return true; }
        return false;
      }
      var tag = (el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || el.isContentEditable) return false;
      try { el.click(); } catch (e) {}
      return true;
    }

    document.addEventListener('keydown', function(e) {
      var ae = document.activeElement;
      var aeTag = (ae && ae.tagName || '').toLowerCase();
      var isTyping = (aeTag === 'input' || aeTag === 'textarea' || (ae && ae.isContentEditable));
      var k = e.key;
      if (k === 'ArrowUp')    { if (!isTyping && move('up'))    { e.preventDefault(); } }
      else if (k === 'ArrowDown')  { if (!isTyping && move('down'))  { e.preventDefault(); } }
      else if (k === 'ArrowLeft')  { if (!isTyping && move('left'))  { e.preventDefault(); } }
      else if (k === 'ArrowRight') { if (!isTyping && move('right')) { e.preventDefault(); } }
      else if (k === 'Enter' || k === ' ') {
        if (!isTyping && activate()) { e.preventDefault(); }
      }
    }, true);

    var settleTimer = null;
    var mo = new MutationObserver(function() {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(function() {
        var ae = document.activeElement;
        if (!ae || ae === document.body) {
          var first = pickInitial();
          if (first) first.focus();
        }
      }, 250);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // Auto-pick initial focus on first install so the user's very first
    // arrow-key press has somewhere to GO TO instead of relying on
    // pickInitial() which fires only when active === body. For TVs the
    // user is starting cold every time; without this the first
    // ArrowDown does nothing visible.
    setTimeout(function() {
      var ae = document.activeElement;
      if (!ae || ae === document.body) {
        var first = pickInitial();
        if (first) first.focus();
      }
    }, 100);
  } catch (err) {
    try { console.warn('eduCmsSpatialNav init failed', err); } catch (e) {}
  }
})();
`;

/**
 * Inject the shim into a same-origin iframe. Safe to call multiple
 * times — the shim self-dedupes via `window.__eduCmsSpatialNav`.
 *
 * MUST be called AFTER `iframe.contentDocument.readyState === 'complete'`
 * (or from the iframe's `load` event handler) — running before the DOM
 * is parsed means our keydown handler binds to a non-existent document.
 *
 * Returns true if injection succeeded, false on cross-origin block or
 * any other failure (we never throw — the page still works without
 * spatial nav).
 */
export function injectSpatialNav(iframe: HTMLIFrameElement | null): boolean {
  if (!iframe) return false;
  try {
    const win = iframe.contentWindow as (Window & { eval?: (s: string) => unknown }) | null;
    if (!win) return false;
    // `eval` on the iframe's contentWindow runs the script in the
    // iframe's main world (not the parent's). Same-origin only — if
    // the iframe is cross-origin (which it shouldn't be since we
    // proxy through /api/v1/proxy/web) this throws SecurityError and
    // we silently bail.
    (win as unknown as { eval(s: string): unknown }).eval(WEBPAGE_SPATIAL_NAV_SHIM);
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[spatial-nav] iframe injection blocked:', (e as Error)?.message);
    return false;
  }
}
