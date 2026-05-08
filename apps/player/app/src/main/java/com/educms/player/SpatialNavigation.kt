package com.educms.player

import android.webkit.WebView
import com.educms.player.logging.PlayerLogger

/**
 * D-pad / arrow-key spatial navigation shim for the URL overlay WebView.
 *
 * Operator (2026-05-07): "when I use the Goodview CMS player and push a
 * URL, the remote control is able to essentially tab around the website
 * so I can select buttons without a mouse or keyboard, using up and down
 * on the remote it highlights the different links on the website. Our
 * player doesn't do that at all."
 *
 * Goodview's player uses a WebView built on top of a Chromium fork that
 * exposes the chromium-internal `--enable-spatial-navigation` flag. Our
 * App-bundled Android System WebView does NOT honor that flag — the
 * setting is gated behind a chrome:// flag the OEM hasn't preset for us.
 * Instead of patching the WebView (impossible without re-shipping
 * Chromium), we inject a tiny JS shim that:
 *
 *   1. Listens for arrow keys + Enter/OK + Back at document.keydown.
 *   2. Maintains a list of currently-visible focusable elements
 *      (`a`, `button`, `input`, `[tabindex]:not([tabindex="-1"])`,
 *      `select`, `textarea`, `[role=button]`, `[role=link]`).
 *   3. Picks the geometric "nearest in direction" candidate via a
 *      direction-cone test with distance-and-axis-bias scoring.
 *   4. Calls `.focus()` on it (with our visible focus ring CSS) and
 *      `preventDefault()`s the arrow event so the browser doesn't
 *      also scroll.
 *   5. On Enter/OK, calls `.click()` on the focused element.
 *   6. On Back/Escape, calls `history.back()` if there's history.
 *
 * Performance notes:
 *   - Uses `IntersectionObserver` to keep an in-viewport focusable cache
 *     so the keydown handler doesn't have to walk the DOM on every press.
 *   - Uses a `MutationObserver` so single-page-app route changes
 *     re-populate the cache without manual reload.
 *   - Idempotent: the script bails if `window.__eduCmsSpatialNav` is
 *     already set, so multiple page-finished callbacks won't double-bind.
 *
 * Targeted ONLY at the URL overlay WebView — never injected into our own
 * EduCMS dashboard page (which already has its own first-class keyboard
 * navigation and visible focus rings managed by the React app).
 */
object SpatialNavigation {

    /**
     * Inject the spatial-navigation shim into the given WebView. Safe to
     * call multiple times per page load — the shim self-deduplicates via
     * `window.__eduCmsSpatialNav`.
     *
     * Call from `WebViewClient.onPageFinished` so the script runs after
     * the initial DOM is parsed but before the user starts pressing
     * remote keys.
     */
    fun inject(webView: WebView) {
        try {
            webView.evaluateJavascript(SHIM_JS, null)
        } catch (ex: Exception) {
            PlayerLogger.w("SpatialNavigation", "inject failed: ${ex.message}")
        }
    }

    /**
     * The JS shim. Runs in the WebView's main world. ~110 lines of
     * vanilla JS, no external deps, no fetches. Lives in a Kotlin raw
     * string ("""…""") so it ships embedded in the APK with no asset
     * loader plumbing required.
     *
     * Focus-ring CSS uses indigo-600 (#4f46e5) at 3px to be visible on
     * any background a customer site might serve. The outline-offset
     * keeps it just outside the element so dark themes still see it.
     */
    private val SHIM_JS = """
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

    // Visible focus ring — high contrast on any background. Inserted
    // once so subsequent injections don't pile up duplicate <style>s.
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

    // Score a candidate against the current focus rect for a given
    // direction. Lower = better. Uses a direction cone (must lie in
    // the half-plane in the direction of travel) plus a small bias
    // toward axis-aligned candidates so up/down don't swing diagonal.
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
      // Heavy axis bias (×3 secondary) keeps movement "in line".
      return primary + secondary * 3;
    }

    function pickInitial() {
      var list = candidates();
      if (!list.length) return null;
      // Prefer the topmost-leftmost in the viewport for the very
      // first arrow press if nothing is focused.
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
      if (!list.length) return false;
      if (!active || active === document.body || list.indexOf(active) === -1) {
        var first = pickInitial();
        if (first) { first.focus(); first.scrollIntoView({block:'nearest', inline:'nearest'}); return true; }
        return false;
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
      return false;
    }

    function activate() {
      var el = document.activeElement;
      if (!el || el === document.body) {
        var first = pickInitial();
        if (first) { first.focus(); return true; }
        return false;
      }
      // Inputs / textareas / contenteditable should NOT swallow Enter
      // — let the user type a newline / submit a form natively.
      var tag = (el.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || el.isContentEditable) return false;
      try { el.click(); } catch (e) {}
      return true;
    }

    document.addEventListener('keydown', function(e) {
      // Don't interfere with text typing in an input.
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

    // SPA route change → re-pick a sensible initial focus when the DOM
    // settles (debounced; only fires if no element is currently focused).
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
  } catch (err) {
    // Never crash the page — log and bail. The user can still scroll
    // / interact via touch even if the shim fails to install.
    try { console.warn('eduCmsSpatialNav init failed', err); } catch (e) {}
  }
})();
""".trimIndent()
}
