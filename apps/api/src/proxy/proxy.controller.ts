import { Controller, Get, Query, Res, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { safeFetch, SsrfError, FetchTooLargeError } from '../branding/safe-fetch';
import { RendererService } from './renderer.service';

/**
 * Proxy controller for loading external websites in iframes.
 * Strips X-Frame-Options and CSP frame-ancestors headers so digital signage
 * screens can embed any website in a WEBPAGE widget zone.
 *
 * Security: routes EVERY fetch through `safeFetch`, which DNS-resolves
 * the hostname and rejects any address landing in a private, loopback,
 * link-local, CGNAT, or cloud-metadata range (169.254.169.254 is the
 * obvious attacker target on Railway/AWS/GCP). Previously this
 * controller called `fetch(url)` directly, making it an unauthenticated
 * SSRF gateway into the cloud provider's internal network.
 */
@Controller('api/v1/proxy')
export class ProxyController {

  // Optional — Nest auto-resolves if RendererService is in providers,
  // but we accept it as undefined to keep the controller bootable on
  // workers/local dev where Chromium isn't available.
  constructor(private readonly renderer?: RendererService) {}

  @Get('web')
  @SkipThrottle()
  async proxyWeb(
    @Query('url') url: string,
    @Query('interactive') interactiveParam: string | undefined,
    @Res() res: Response,
  ) {
    try {
      if (!url) {
        throw new HttpException('Missing url parameter', HttpStatus.BAD_REQUEST);
      }

      // ─── INTERACTIVE MODE (v1.0.16 fix) ────────────────────────────
      // Operator (2026-04-27, on e-arc.com): "the URL now loads
      // everything correctly but the top area is a 5 card carousel of
      // content and ours only shows the first card and never advances".
      //
      // Cause: the strip-scripts pipeline below removes the carousel's
      // setInterval rotation logic. Puppeteer SSR captures one frame,
      // we strip every script that would animate it, the iframe shows
      // a frozen first card forever.
      //
      // Fix: when the WEBPAGE widget is meant to be interactive (the
      // common case — operator pushes a URL because they want a touch
      // screen showing a real, working website), skip the script strip
      // so AJAX rotators, dropdown menus, accordions, and finger taps
      // all work. SSR is bypassed too — Puppeteer's pre-render adds no
      // value when we're letting the live JS run anyway, and skipping
      // it keeps cold-load time fast.
      //
      // Strict subtractive policy still applies: we strip CSP +
      // X-Frame-Options metas (otherwise the iframe won't render at
      // all) and inject base href so relative URLs resolve. Nothing
      // else is touched. The WEBPAGE widget passes &interactive=true
      // by default in v1.0.16+. Older clients still get the legacy
      // strip-scripts behaviour.
      const interactive = interactiveParam === 'true' || interactiveParam === '1';

      // ─── SSR PRIMARY PATH ─────────────────────────────────────────
      // Try the Puppeteer renderer first. Solves AJAX-loaded content
      // (e-arc.com banner, react-rendered pages, anything with content
      // that materializes after page-load). The renderer caches by
      // URL with 10-min TTL, so a 50-kiosk fleet pulling the same
      // URL only hits Chromium ~6x/hour total.
      //
      // Falls back to the legacy safeFetch + strip-scripts path if:
      //   - SSR_ENABLED=false in env
      //   - Renderer wasn't injected (shouldn't happen in prod)
      //   - render() returns null (Chromium crash, timeout, etc.)
      //
      // Either way, the post-render pipeline (strip scripts, inject
      // CSS, set headers) runs the same. SSR is just a smarter source
      // of HTML than raw fetch.
      let html: string | null = null;
      let baseUrl: string = url;
      let contentType = 'text/html';
      let renderedBy: 'ssr' | 'fetch' = 'fetch';

      // SSR is for static-snapshot rendering. When the page is meant
      // to stay interactive (interactive=true), we WANT the original
      // scripts to run inside the iframe — pre-rendering with
      // Puppeteer adds latency and no value, since the iframe will
      // re-execute the JS anyway. Skip Chromium entirely in that mode
      // and go straight to safeFetch.
      if (this.renderer && !interactive) {
        const rendered = await this.renderer.render(url);
        if (rendered) {
          html = rendered.html;
          baseUrl = rendered.finalUrl;
          renderedBy = 'ssr';
        }
      }

      if (html === null) {
        let upstream;
        try {
          upstream = await safeFetch(url, {
            timeoutMs: 15000,
            maxBytes: 10 * 1024 * 1024, // 10 MB cap for embedded HTML pages
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            userAgent:
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          });
        } catch (e: any) {
          if (e instanceof SsrfError) {
            // Don't leak whether the target was private vs invalid —
            // uniform error for SSRF probing.
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

        contentType = upstream.contentType || 'text/html';

        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
          // 2026-04-29 — operator (Nth time): "fix the URL asset,
          // shit does not work yet after so many attempts". Old code
          // 302-redirected non-HTML responses to the upstream — which
          // caused CORS failures inside the iframe (script tries to
          // fetch JSON / image asset, gets redirected to upstream,
          // browser blocks the cross-origin response). Now we relay
          // the body through the proxy with permissive CORS so the
          // page's own carousel scripts, AJAX calls, image loads,
          // etc. all succeed.
          //
          // Cap unchanged at 10 MB; same SSRF guards apply via
          // safeFetch.
          res.setHeader('Content-Type', contentType);
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Cache-Control', 'public, max-age=300');
          res.send(upstream.body);
          return;
        }

        html = upstream.body.toString('utf8');
        baseUrl = upstream.finalUrl || url;
      }
      // After the upstream-fetch / SSR fork, `html` and `baseUrl` are
      // set. Narrow the nullable so the rest of the pipeline can use
      // string operations without per-call assertions. The header
      // lets the operator see in DevTools which path served the response.
      if (html === null) {
        // Should be unreachable — both branches above always set html.
        // Defensive throw rather than swallowing.
        throw new HttpException('Renderer produced no HTML', HttpStatus.INTERNAL_SERVER_ERROR);
      }
      res.setHeader('X-EduCms-Renderer', renderedBy);
      res.setHeader('X-EduCms-Mode', interactive ? 'interactive' : 'static');

      // Strip <script> tags. Tried lifting this once (2026-04-26 to
      // make e-arc.com banner rotators work) — the result was
      // measurably WORSE: rotators still broken (cross-origin XHR
      // CORS-blocked from inside the sandboxed iframe) AND the static
      // middle of every page broke too because pages with JS have
      // execution dependencies (errors halting layout, document.write
      // changing the DOM, etc). Net-negative trade. Reverted.
      //
      // v1.0.16: when interactive=true the operator EXPECTS the live
      // page to keep running (the URL widget is the entire screen,
      // touch-driven). Skip the strip so rotators, accordions, and
      // any finger-tap behaviours work. The historical "middle of
      // page broke" issue was on the static-only mode + sandboxed
      // iframe; interactive mode runs the iframe unsandboxed in
      // signage WebView with same-origin proxy host, so document.write
      // / jQuery init / etc. behave like a normal browser load.
      //
      // Modern signage sites that the operator curates should be
      // mostly-static — if a customer wants a JS-driven dashboard
      // embedded, the right answer is interactive=true.
      if (!interactive) {
        html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        html = html.replace(/\s(on\w+)\s*=\s*["'][^"']*["']/gi, '');
        html = html.replace(/<\/?noscript[^>]*>/gi, '');
      }
      // <meta http-equiv="refresh"> stripping is safe in BOTH modes —
      // an embedded auto-refresh would break out of the iframe by
      // navigating it to the upstream URL directly (which would then
      // 404 on the original site's X-Frame-Options).
      html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');

      // Strip <meta http-equiv="content-security-policy"> and
      // <meta http-equiv="x-frame-options">. We already strip the
      // equivalent HTTP headers; some sites enforce CSP via <meta>
      // too. Strictly subtractive — only removes a blocking tag.
      // Operator (2026-04-27): "go back to the original URL deployer
      // we had, this one still fucks up the middle section, then we
      // can fix just the top section." This is the original (script-
      // strip) proxy from 0ada976 with ONLY this one meta-CSP
      // addition kept. Everything else (HTML rewriter, CSS url()
      // rewriter, iframe-detection hooks, setAttribute hook, SRI
      // strip) was reverted — those broke the middle.
      html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?(?:content-security-policy|x-frame-options)["']?[^>]*>/gi, '');

      // Also strip any upstream color-scheme meta. We inject our own
      // "light only" tag below; if the upstream page already has its
      // own color-scheme meta later in <head>, theirs would override
      // mine because later tags win. Drop it so our injection sticks.
      html = html.replace(/<meta[^>]*name\s*=\s*["']?color-scheme["']?[^>]*>/gi, '');

      // INTERACTIVE MODE: the page's own scripts run, so they handle
      // lazy-load promotion, force-visible reveals, and any DOM
      // manipulation themselves. Skip both the lazy-attr promotion
      // and the aggressive force-visible CSS — those are crutches
      // for the script-stripped path.
      // Lazy-load + force-visible only when we DIDN'T render via SSR.
      // Operator-reported regression (2026-04-27 on e-arc.com via
      // Puppeteer SSR): "it seems to have expanded every single text
      // field on the website and launch some google review...
      // happens where it engages every single toggle."
      //
      // Cause: the force-display:revert CSS we inject below was
      // designed for the strip-scripts path (where JS-revealed
      // content stays display:none forever). With Chromium SSR,
      // the page is already in its proper post-load state — every
      // display:none INTENTIONAL hides modals, dropdowns, mobile
      // menus, accordions, hover-tooltips, click-to-expand
      // reviews, etc. Force-revealing them all = visual chaos.
      //
      // Fix: lazy-attribute promotion + force-visible CSS only
      // applies on the strip-scripts (fetch) path. SSR output
      // gets only the color-scheme + base-href injection (still
      // valuable — kiosks may inherit dark-mode from their host
      // OS, and base-href fixes relative-URL resources).
      if (renderedBy === 'fetch') {
        const lazyAttrs = [
          'data-lazy-src',
          'data-src',
          'data-lazyload',
          'data-original',
          'data-srcset',
          'data-lazy-srcset',
        ];
        for (const attr of lazyAttrs) {
          const target = attr.replace(/^data-/, '').replace('lazy-', '').replace('original', 'src').replace('lazyload', 'src');
          const realAttr = target === 'src' || target === 'srcset' ? target : 'src';
          // <img data-lazy-src="…" /> → <img src="…" />
          html = html.replace(
            new RegExp(`(<(?:img|source|video|audio|iframe)\\b[^>]*?)\\s${attr}\\s*=\\s*(["'])([^"']*)\\2`, 'gi'),
            `$1 ${realAttr}="$3"`,
          );
        }
        // Strip the now-redundant lazy-load placeholder src that some
        // plugins insert (a 1×1 transparent gif). Without removing it,
        // the placeholder paints over the real image until JS runs.
        html = html.replace(
          /(<(?:img|source)\b[^>]*?)\ssrc\s*=\s*(["'])data:image\/[^"']*\2/gi,
          '$1',
        );
      }

      // Force-render lazy sections. WPRocket marks below-the-fold
      // sections with data-wpr-lazyrender="1" and reveals them when
      // scrolled into view. With JS stripped they never render.
      // Our injected style below makes them visible immediately.

      // Force light color-scheme inside the iframe. Operator
      // (2026-04-27): "it changed the section from white background
      // with black text to a black background and white text."
      //
      // Cause: digital-signage host browser has OS dark mode set, the
      // iframe inherits the prefers-color-scheme: dark media query,
      // and the upstream site's dark-mode CSS fires. The page's own
      // JS that would normally force a chosen theme is stripped, so
      // there's nothing pinning the theme to light.
      //
      // Fix: pin color-scheme: light at the iframe document level.
      // This (a) disables the browser UA's dark-mode CSS adjustments,
      // (b) makes prefers-color-scheme: dark media queries return
      // false even when the parent OS is in dark mode. Sites that
      // are intentionally dark-themed (no media query — just dark
      // CSS as the default) are unaffected.
      // Style injection. The aggressive force-visible rules are ONLY
      // safe on the strip-scripts (fetch) path — when Chromium runs
      // the page (SSR), display:none is intentional (modals, mobile
      // menus, accordions, click-to-expand reviews) and force-
      // revealing them creates visual chaos.
      //
      // SSR path: just color-scheme normalization. Page is already
      //           in its proper post-load state.
      // Fetch path: full force-visible CSS so JS-revealed content
      //           appears even though we stripped the JS.
      const baselineCss = `:root{color-scheme:light only !important;}` +
        `html,body{background-color:#fff !important;color:#222 !important;}`;
      const aggressiveForceVisibleCss = baselineCss +
        // Lazy-render placeholders (WPRocket): force visible.
        `[data-wpr-lazyrender]{content-visibility:visible !important;display:revert !important;}` +
        // jQuery / lazysizes "lazyload" class: force visible.
        `.lazyload,.lazyloaded,.lazyloading{opacity:1 !important;display:revert !important;}` +
        // Hidden-by-JS until-rendered patterns common on Alpine.js sites.
        `[x-cloak]{display:revert !important;}` +
        // WordPress lazyload-img class some themes use to fade in.
        `img[data-lazy-loaded='0']{opacity:1 !important;}` +
        // Last resort: any element styled display:none INLINE on initial
        // load is almost certainly waiting on JS to reveal — un-hide.
        // Scoped to the body so we don't break page-level <style> blocks.
        `body [style*="display:none"]:not(noscript):not(script):not(style):not(template):not(meta):not(link){display:revert !important;}` +
        `body [style*="display: none"]:not(noscript):not(script):not(style):not(template):not(meta):not(link){display:revert !important;}` +
        `body [style*="visibility:hidden"]{visibility:visible !important;}` +
        `body [style*="visibility: hidden"]{visibility:visible !important;}`;
      const proxyForceVisibleCss = (renderedBy === 'ssr' || interactive)
        ? baselineCss
        : aggressiveForceVisibleCss;

      // 2026-04-29 — INTERACTIVE-MODE URL REWRITING + FETCH SHIM.
      // Operator (Nth attempt): "fix the URL asset, shit does not
      // work yet after so many attempts".
      //
      // Without these two, interactive mode broke every site:
      //   - <a href="/about"> click → iframe navigates to OUR proxy
      //     origin + /about → 404 / blank screen / Android system
      //     "open with…" icon (the "blank screen" bug from this
      //     morning's revert).
      //   - <script>fetch('/api/banners.json')</script> →
      //     fetches from OUR origin (because document.location is
      //     ours) → 404 → carousel fails with "error loading
      //     banner slides" (the carousel bug from this morning).
      //
      // Rewrite anchor hrefs server-side so clicks land BACK ON
      // the proxy with the new upstream URL; injects a fetch + XHR
      // shim that does the same dynamic rewriting at runtime so
      // any script-driven request also routes through the proxy.
      // Forms left alone (most carousel sites don't post forms;
      // and POST proxying needs separate code anyway).
      let interactiveShim = '';
      if (interactive) {
        // (1) Rewrite all <a href="…"> attributes. We don't touch
        // hrefs that are already proxy URLs, javascript:/mailto:/tel:
        // schemes, or anchors (#…).
        //
        // Regex uses `(?:\s|^<a\b)` approach — simpler: match href
        // whether it is the first attribute or preceded by a space.
        // The original `\shref` required a preceding space and missed
        // `<a href="..."` (href as the very first attribute), though
        // e-arc.com happened not to hit this case. Fixed defensively
        // for other sites.
        //
        // Also: strip target="_blank" from every rewritten anchor.
        // On Android WebView inside an iframe, target="_blank" tries
        // to spawn a new tab/Intent which either results in a blank
        // screen or an "open with…" system dialog — the exact symptom
        // the operator reported ("I click on any link and I get a
        // blank page"). We force target="_self" so navigation stays
        // inside the iframe. The rewrite happens in TWO steps:
        //   Step A: rewrite href → proxy URL (same as before)
        //   Step B: on any <a …> that now contains a proxy href,
        //           replace target="_blank" with target="_self".
        html = html.replace(
          /(<a\b[^>]*?(?:\s|(?<=<a))href\s*=\s*)(["'])([^"']+)\2/gi,
          (_match, prefix, q, href) => {
            const trimmed = String(href).trim();
            if (
              !trimmed ||
              trimmed.startsWith('#') ||
              trimmed.startsWith('javascript:') ||
              trimmed.startsWith('mailto:') ||
              trimmed.startsWith('tel:') ||
              trimmed.startsWith('data:') ||
              trimmed.includes('/api/v1/proxy/web')
            ) {
              return `${prefix}${q}${href}${q}`;
            }
            try {
              const absolute = new URL(trimmed, baseUrl).toString();
              const proxied =
                `/api/v1/proxy/web?url=${encodeURIComponent(absolute)}&v=2&interactive=true`;
              return `${prefix}${q}${proxied}${q}`;
            } catch {
              return `${prefix}${q}${href}${q}`;
            }
          },
        );

        // Step B: force target="_self" on EVERY <a> tag in the
        // document. Operator (2026-04-29 Nth time): "URL dont work
        // still". Curl of deployed proxy showed `target="_blank"`
        // residuals — the previous regex required href to already
        // point at /api/v1/proxy/web, but anchors with non-standard
        // quote styles (single-quoted hrefs, escaped quotes, etc.)
        // failed the href-match and skipped the target rewrite.
        //
        // Fix: drop the href-dependence. Every <a> tag in the
        // proxied HTML gets target="_self" regardless of its href
        // shape. _self is the only safe target inside an Android
        // WebView iframe — _blank tries to spawn a new window the
        // WebView can't show (root cause of "android blank page"
        // symptom). This is a defensive pass; href rewriting still
        // happens in Step A so all link clicks navigate within the
        // proxy chain.
        html = html.replace(
          /<a\b[^>]*?>/gi,
          (tag) => {
            if (/\btarget\s*=/i.test(tag)) {
              // Replace existing target value → _self (any quote style)
              return tag.replace(/(\btarget\s*=\s*)(["'])[^"']*\2/gi, '$1"_self"');
            }
            // No target attr → inject _self right after <a
            return tag.replace(/^<a\b/i, '<a target="_self"');
          },
        );

        // (2) Runtime shim:
        //   - fetch + XHR: relative/same-origin requests → proxy
        //   - window.open: same
        //   - Image.src setter: banner carousels do `new Image(); img.src='/slide.jpg'`
        //     — this intercepts the setter so the image is fetched via the proxy
        //     instead of from the iframe's origin (our proxy host), which would 404.
        //   - navigator.sendBeacon: analytics pings; safe to reroute through proxy.
        //   - <a target="_blank"> click: runtime guard forces target=_self on any
        //     anchor click so Android WebView never gets a _blank navigation request
        //     (belt-and-suspenders: the server-side rewrite above handles static HTML,
        //     this handles dynamically-inserted anchors added by the page's own JS).
        interactiveShim = `<script>(function(){try{
var PROXY='/api/v1/proxy/web';
var BASE=${JSON.stringify(baseUrl)};
function wrap(raw){
  if(!raw||typeof raw!=='string')return raw;
  if(raw.indexOf('data:')===0||raw.indexOf('blob:')===0||raw.indexOf('javascript:')===0||raw.indexOf('mailto:')===0||raw.indexOf('tel:')===0)return raw;
  if(raw.indexOf('#')===0)return raw;
  try{
    var u=new URL(raw,BASE);
    if(u.pathname.indexOf(PROXY)===0)return raw;
    return PROXY+'?url='+encodeURIComponent(u.toString())+'&v=2&interactive=true';
  }catch(_){return raw;}
}
var of=window.fetch;
window.fetch=function(input,init){
  try{
    if(typeof input==='string')input=wrap(input);
    else if(input&&input.url){input=new Request(wrap(input.url),input);}
  }catch(_){/* swallow */}
  return of.call(this,input,init);
};
var oo=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){
  try{u=wrap(u);}catch(_){/* swallow */}
  return oo.apply(this,[m,u].concat([].slice.call(arguments,2)));
};
var ow=window.open;
window.open=function(u){
  try{u=wrap(u);}catch(_){/* swallow */}
  return ow.apply(this,[u].concat([].slice.call(arguments,1)));
};
// Image.src setter: carousel preloaders (new Image(); img.src=url)
try{
  var imgDesc=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
  if(imgDesc&&imgDesc.set){
    var origImgSet=imgDesc.set;
    Object.defineProperty(HTMLImageElement.prototype,'src',{
      set:function(v){try{v=wrap(v);}catch(_){}origImgSet.call(this,v);},
      get:imgDesc.get,configurable:true
    });
  }
}catch(_){}
// sendBeacon: reroute analytics pings through proxy (keeps page happy, avoids CORS errors)
if(navigator.sendBeacon){
  var osb=navigator.sendBeacon.bind(navigator);
  navigator.sendBeacon=function(u,d){try{u=wrap(u);}catch(_){}return osb(u,d);};
}
// Runtime anchor/form guard: dynamically injected navigation is routed through
// the proxy and kept in-frame, so JS-created links cannot escape to upstream.
document.addEventListener('click',function(e){
  var el=e.target;
  while(el&&el.tagName!=='A')el=el.parentElement;
  if(el&&el.tagName==='A'){
    try{
      var raw=el.getAttribute('href')||el.href;
      var next=wrap(raw);
      if(next&&next!==raw)el.setAttribute('href',next);
    }catch(_){}
    el.target='_self';
  }
},true);
document.addEventListener('submit',function(e){
  var form=e.target;
  if(form&&form.tagName==='FORM'){
    try{
      var raw=form.getAttribute('action')||form.action||BASE;
      var next=wrap(raw);
      if(next)form.setAttribute('action',next);
    }catch(_){}
    form.target='_self';
  }
},true);
}catch(e){console.warn('proxy shim init failed',e);}})();</script>`;
      }

      const headInjection = `<base href="${baseUrl}"><meta name="color-scheme" content="light only"><style>${proxyForceVisibleCss}</style>${interactiveShim}`;
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>\n${headInjection}`);
      } else if (html.includes('<HEAD>')) {
        html = html.replace('<HEAD>', `<HEAD>\n${headInjection}`);
      } else if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, `$&${headInjection}`);
      } else if (/<html[^>]*>/i.test(html)) {
        html = html.replace(/<html[^>]*>/i, `$&<head>${headInjection}</head>`);
      } else {
        html = headInjection + html;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.removeHeader('X-Frame-Options');
      res.removeHeader('Content-Security-Policy');
      res.setHeader('Content-Security-Policy', "frame-ancestors *");
      res.setHeader('Access-Control-Allow-Origin', '*');

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
