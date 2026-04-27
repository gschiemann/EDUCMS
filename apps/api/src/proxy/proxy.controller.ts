import { Controller, Get, Query, Res, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { safeFetch, SsrfError, FetchTooLargeError } from '../branding/safe-fetch';

/**
 * Proxy controller for loading external websites in iframes.
 *
 * Two modes on the same endpoint, switched on the upstream Content-Type:
 *
 * 1. HTML responses
 *    - Strip X-Frame-Options + CSP frame-ancestors (so the iframe is
 *      allowed to render us at all).
 *    - Strip frame-busting `<meta refresh>` and inline `on*=` handlers.
 *    - Inject a `<base href>` so relative URLs in the page resolve
 *      against the upstream origin (image src, link href, etc).
 *    - Inject a tiny prelude `<script>` at the very top of `<head>`
 *      that monkey-patches `window.fetch` and `XMLHttpRequest.open`.
 *      Every fetch the page's own scripts make gets rewritten so it
 *      flows back through THIS proxy — same-origin to the iframe,
 *      CORS-clean. That's what unblocks JS-driven banner rotators,
 *      sliders, and any other content the page builds at runtime.
 *
 * 2. Non-HTML responses (images, CSS, fonts, JSON, JS files…)
 *    - Stream the body back unchanged with the original Content-Type
 *      and an Access-Control-Allow-Origin: * header. This is what
 *      lets the rewritten fetch/XHR calls actually receive data.
 *      Without this branch, only the initial HTML loaded — every
 *      subsequent fetch from a script 502'd out.
 *
 * Security: every upstream fetch goes through `safeFetch`, which
 * DNS-resolves the hostname and rejects any address landing in a
 * private / loopback / link-local / CGNAT / cloud-metadata range
 * (e.g. 169.254.169.254 on Railway/AWS/GCP). NEVER call `fetch()`
 * directly here — every URL the user (or their page's scripts) sends
 * us could be an SSRF probe.
 */
@Controller('api/v1/proxy')
export class ProxyController {

  @Get('web')
  @SkipThrottle()
  async proxyWeb(@Query('url') url: string, @Res() res: Response) {
    try {
      if (!url) {
        throw new HttpException('Missing url parameter', HttpStatus.BAD_REQUEST);
      }

      let upstream;
      try {
        upstream = await safeFetch(url, {
          timeoutMs: 15000,
          // Bumped to 25MB — pages with hero videos / large hero images
          // would 413 at the old 10MB cap. Still bounded.
          maxBytes: 25 * 1024 * 1024,
          accept: '*/*',
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        });
      } catch (e: any) {
        if (e instanceof SsrfError) {
          throw new HttpException(`Upstream blocked: ${e.message}`, HttpStatus.BAD_REQUEST);
        }
        if (e instanceof FetchTooLargeError) {
          throw new HttpException(`Upstream response too large`, HttpStatus.PAYLOAD_TOO_LARGE);
        }
        throw new HttpException(`Upstream connection failed: ${e.message}`, HttpStatus.BAD_GATEWAY);
      }

      if (upstream.status < 200 || upstream.status >= 300) {
        throw new HttpException(`Upstream returned HTTP ${upstream.status}`, HttpStatus.BAD_GATEWAY);
      }

      const contentType = upstream.contentType || 'text/html';
      const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml');

      // Headers shared between HTML and pass-through paths.
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.removeHeader('X-Frame-Options');
      res.removeHeader('Content-Security-Policy');
      res.setHeader('Content-Security-Policy', "frame-ancestors *");
      res.setHeader('Access-Control-Allow-Origin', '*');
      // Common fetch needs these headers for CORS preflights to pass.
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,Accept');

      if (!isHtml) {
        // Pass-through for images / CSS / JS / fonts / JSON / video
        // segments. The rewritten fetch in the iframe routes here.
        res.setHeader('Content-Type', contentType);
        res.send(upstream.body);
        return;
      }

      // HTML branch
      let html = upstream.body.toString('utf8');
      const baseUrl = upstream.finalUrl || url;

      // Frame-busting + auto-refresh + inline handlers — these can't be
      // safely rewritten, just stripped.
      html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
      html = html.replace(/\s(on\w+)\s*=\s*["'][^"']*["']/gi, '');
      html = html.replace(/<\/?noscript[^>]*>/gi, '');

      // Strip <meta http-equiv="content-security-policy"> and
      // <meta http-equiv="x-frame-options">. We already strip the
      // equivalent HTTP headers, but a LOT of real sites (Wix, hardened
      // WordPress, Shopify storefronts) enforce CSP via <meta> too —
      // browsers obey both identically. Without this strip the iframe
      // partially loads, then every external script/font/image is
      // refused with "violates Content Security Policy directive" in
      // the console and the page looks broken to the user.
      html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?(?:content-security-policy|x-frame-options)["']?[^>]*>/gi, '');

      // Strip Subresource Integrity attributes from <script> and <link>.
      // Once upstream rebuilds with a new bundle hash, every cached page
      // that references the old hash silently fails to load the script
      // (the browser refuses with no DOM error event). Rendering a stale
      // version of a page that was perfect yesterday is a common "broken
      // webpage" failure mode. We trust the upstream we just fetched —
      // SRI buys nothing for a server-side proxy.
      html = html.replace(/(<(?:script|link)\b[^>]*?)\sintegrity\s*=\s*(["'])[^"']*\2/gi, '$1');
      html = html.replace(/(<(?:script|link)\b[^>]*?)\scrossorigin\s*=\s*(["'])[^"']*\2/gi, '$1');
      html = html.replace(/(<(?:script|link)\b[^>]*?)\scrossorigin(?=[\s>])/gi, '$1');

      // Build the rewriter script. Three jobs:
      //   1. Override window.fetch + XMLHttpRequest.open so EVERY
      //      non-data: URL the page's scripts request gets routed
      //      through OUR proxy — same-origin to the iframe, CORS-clean.
      //      The previous "only upstream" heuristic missed cross-origin
      //      CDN fetches (Google Fonts, jsDelivr, etc.) which then
      //      hit CORS preflight failures and silently broke the page.
      //   2. Override window.open / location.assign / location.replace
      //      that target the parent — best-effort frame-busting block
      //      (location is technically unforgeable, but most real-world
      //      busters use these wrappers).
      //   3. Hooks for setAttribute('src'/'href') so dynamically-injected
      //      scripts and stylesheets also flow through the proxy.
      const proxyOrigin = ''; // same-origin to the iframe — empty string keeps fetches relative
      const proxyPath = '/api/v1/proxy/web';
      const upstreamOrigin = new URL(baseUrl).origin;

      const rewriter = `
<script>
(function(){
  try {
    var PROXY = ${JSON.stringify(proxyOrigin + proxyPath)};
    var UPSTREAM = ${JSON.stringify(upstreamOrigin)};
    // Proxy ANY non-data: URL. Cross-origin CDN scripts/fonts/JSON
    // would otherwise hit CORS preflight and silently break.
    function shouldProxy(u){
      if (!u || typeof u !== 'string') return false;
      if (u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('javascript:')) return false;
      if (u.startsWith('about:') || u.startsWith('mailto:') || u.startsWith('tel:')) return false;
      // Already proxied — don't double-wrap (idempotent if double-rewrites slip through)
      if (u.indexOf(PROXY + '?url=') !== -1) return false;
      // Pure in-page hash like "#section" — never proxy, would break scroll-to anchors
      if (u.startsWith('#')) return false;
      return true;
    }
    function toAbsolute(u){
      try { return new URL(u, UPSTREAM).toString(); } catch(e){ return u; }
    }
    function via(u){
      return PROXY + '?url=' + encodeURIComponent(toAbsolute(u)) + '&v=2';
    }
    var realFetch = window.fetch;
    window.fetch = function(input, init){
      try {
        var u = typeof input === 'string' ? input : (input && input.url) || '';
        if (shouldProxy(u)) {
          if (typeof input === 'string') return realFetch(via(u), init);
          return realFetch(new Request(via(u), input), init);
        }
      } catch(e) {}
      return realFetch.call(this, input, init);
    };
    var realOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url){
      try {
        if (typeof url === 'string' && shouldProxy(url)) {
          arguments[1] = via(url);
        }
      } catch(e){}
      return realOpen.apply(this, arguments);
    };
    // Hook setAttribute on Element so dynamically-created <script>,
    // <link>, <img>, <iframe>, <source> get their src/href routed
    // through the proxy. Many SPA frameworks inject these at runtime.
    try {
      var realSetAttr = Element.prototype.setAttribute;
      Element.prototype.setAttribute = function(name, value){
        try {
          if ((name === 'src' || name === 'href') && typeof value === 'string' && shouldProxy(value)) {
            return realSetAttr.call(this, name, via(value));
          }
        } catch(e){}
        return realSetAttr.call(this, name, value);
      };
    } catch(e){}
    // Anti-frame-busting (best-effort — location is unforgeable so we
    // wrap the wrappers most busters reach for).
    var realWindowOpen = window.open;
    window.open = function(){ return null; };
    try {
      var locProto = Object.getPrototypeOf(window.location);
      var realAssign  = locProto.assign;
      var realReplace = locProto.replace;
      locProto.assign  = function(u){ if (shouldProxy(u)) return realAssign.call(window.location, via(u)); };
      locProto.replace = function(u){ if (shouldProxy(u)) return realReplace.call(window.location, via(u)); };
    } catch(e){}
  } catch(err) { /* prelude swallowed — page can still render */ }
})();
</script>`;

      // Rewrite static HTML attribute URLs at the proxy level. The
      // runtime fetch/XHR rewriter above only catches calls made BY
      // page scripts; <script src="...">, <link rel="stylesheet">,
      // <img src="...">, etc. that the browser parses out of the
      // initial HTML need to be rewritten BEFORE they hit the network.
      // Critical for ES modules: <script type="module"> is fetched
      // with CORS-required mode, so a cross-origin module load fails
      // unless we proxy it. Same for fonts loaded via <link rel="preload">.
      //
      // We rewrite tags whose src/href flows through the network
      // (script, link, img, iframe, source, video, audio, frame).
      // We deliberately DO NOT rewrite <a href> — anchors should let
      // the browser handle clicks; the prelude's location.assign hook
      // catches any JS-driven nav.
      const NET_TAGS = '(?:script|link|img|iframe|frame|source|video|audio|track|embed)';
      const rewriteAttr = (attr: string) =>
        new RegExp(`(<${NET_TAGS}\\b[^>]*?\\s${attr}\\s*=\\s*)(["'])([^"']+)\\2`, 'gi');
      const proxyVia = (u: string) => {
        try {
          const abs = new URL(u, baseUrl).toString();
          if (
            abs.startsWith('data:') ||
            abs.startsWith('blob:') ||
            abs.startsWith('javascript:') ||
            abs.startsWith('about:') ||
            abs.startsWith('mailto:') ||
            abs.startsWith('tel:') ||
            abs.startsWith('#')
          ) {
            return null;
          }
          return `${proxyOrigin}${proxyPath}?url=${encodeURIComponent(abs)}&v=2`;
        } catch {
          return null;
        }
      };
      for (const attr of ['src', 'href']) {
        html = html.replace(rewriteAttr(attr), (match, prefix, quote, url) => {
          const via = proxyVia(url);
          if (!via) return match;
          return `${prefix}${quote}${via}${quote}`;
        });
      }
      // Also rewrite srcset (responsive images): "url1 1x, url2 2x".
      html = html.replace(
        new RegExp(`(<${NET_TAGS}\\b[^>]*?\\ssrcset\\s*=\\s*)(["'])([^"']+)\\2`, 'gi'),
        (match, prefix, quote, srcset) => {
          const rewritten = srcset
            .split(',')
            .map((part: string) => {
              const trimmed = part.trim();
              const sp = trimmed.indexOf(' ');
              const u = sp === -1 ? trimmed : trimmed.slice(0, sp);
              const desc = sp === -1 ? '' : trimmed.slice(sp);
              const via = proxyVia(u);
              return via ? `${via}${desc}` : trimmed;
            })
            .join(', ');
          return `${prefix}${quote}${rewritten}${quote}`;
        },
      );

      // Keep <base href> as the safety net. Static src/href are now
      // rewritten through the proxy at the HTML level above, so the
      // <base> only affects URLs we MISSED — CSS `url(...)` refs
      // inside stylesheets, runtime-built URLs that escape the
      // setAttribute hook, srcset descriptors, etc. Without it those
      // missed-URLs would resolve against the iframe origin (our API)
      // and 404.
      const baseTag = `<base href="${baseUrl.replace(/"/g, '&quot;')}">`;
      const head = rewriter + baseTag;
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>\n${head}`);
      } else if (html.includes('<HEAD>')) {
        html = html.replace('<HEAD>', `<HEAD>\n${head}`);
      } else if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, `$&${head}`);
      } else if (/<html[^>]*>/i.test(html)) {
        html = html.replace(/<html[^>]*>/i, `$&<head>${head}</head>`);
      } else {
        html = head + html;
      }

      res.setHeader('Content-Type', contentType);
      res.send(html);
    } catch (err: any) {
      // When catching errors, manually clear the headers Helmet injected earlier in the pipeline.
      // If we allowed NestJS to throw and digest this exception natively, Helmet's initial
      // `X-Frame-Options: SAMEORIGIN` block would lock the iframe, causing Chrome to display
      // a highly confusing "api-XXXX.up.railway.app refused to connect" modal to users!
      res.setHeader('Content-Type', 'text/html');
      res.removeHeader('X-Frame-Options');
      res.removeHeader('Content-Security-Policy');
      res.setHeader('Content-Security-Policy', "frame-ancestors *");
      res.setHeader('Access-Control-Allow-Origin', '*');

      let message = 'An unknown proxy error occurred';
      let status = HttpStatus.BAD_GATEWAY;

      if (err instanceof HttpException) {
        message = err.message;
        status = err.getStatus();
      } else if (err.message) {
        message = err.message;
      }

      res.status(status).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; }
            .box { text-align: center; padding: 30px; background: #1e293b; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5); border: 1px solid #334155; }
            h3 { color: #f87171; margin-top: 0; margin-bottom: 12px; }
            p { margin: 0; color: #94a3b8; font-size: 14px; max-width: 300px; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="box">
            <h3>Website Connection Failed</h3>
            <p>${message}</p>
          </div>
        </body>
        </html>
      `);
    }
  }
}
