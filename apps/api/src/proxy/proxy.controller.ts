import { Controller, Get, Query, Res, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';

/**
 * Proxy controller for loading external websites in iframes.
 * Strips X-Frame-Options and CSP frame-ancestors headers so digital signage
 * screens can embed any website in a WEBPAGE widget zone.
 */
@Controller('api/v1/proxy')
export class ProxyController {

  @Get('web')
  @SkipThrottle()
  async proxyWeb(@Query('url') url: string, @Res() res: Response) {
    if (!url) {
      throw new HttpException('Missing url parameter', HttpStatus.BAD_REQUEST);
    }

    // Basic URL validation
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new HttpException('Invalid URL', HttpStatus.BAD_REQUEST);
    }

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new HttpException('Only http/https URLs allowed', HttpStatus.BAD_REQUEST);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const upstream = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!upstream.ok) {
        throw new HttpException(`Upstream returned ${upstream.status}`, HttpStatus.BAD_GATEWAY);
      }

      const contentType = upstream.headers.get('content-type') || 'text/html';

      // Only proxy HTML content
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        // For non-HTML (images, scripts, etc.), redirect directly
        res.redirect(url);
        return;
      }

      let html = await upstream.text();

      // Rewrite relative URLs to absolute so assets load correctly
      const baseUrl = upstream.url || url; // upstream.url follows redirects
      const baseOrigin = new URL(baseUrl).origin;
      const basePath = baseUrl.replace(/[^/]*$/, '');

      // Inject <base> tag so relative URLs resolve against the original domain,
      // PLUS anti-frame-busting script to prevent JS redirects that break out of iframe
      const baseTag = `<base href="${baseUrl}">`;
      const proxyBase = '/api/v1/proxy/web';
      const antiFrameBust = `<script>
(function() {
  try {
    // 1. Override top/parent so frame-busting scripts think they're the top window
    Object.defineProperty(window, 'top', { get: function() { return window.self; }, configurable: true });
    Object.defineProperty(window, 'parent', { get: function() { return window.self; }, configurable: true });
    // 2. Override frameElement to null so page thinks it's NOT in an iframe
    Object.defineProperty(window, 'frameElement', { get: function() { return null; }, configurable: true });
    // 3. Intercept location.replace and location.assign to re-route through proxy
    var proxyBase = location.origin + '${proxyBase}';
    var origReplace = location.replace.bind(location);
    var origAssign = location.assign.bind(location);
    location.replace = function(u) { origReplace(proxyBase + '?url=' + encodeURIComponent(u)); };
    location.assign = function(u) { origAssign(proxyBase + '?url=' + encodeURIComponent(u)); };
    // 4. Intercept location.href setter via descriptor if possible
    try {
      var locProto = Object.getPrototypeOf(location);
      var hrefDesc = Object.getOwnPropertyDescriptor(locProto, 'href');
      if (hrefDesc && hrefDesc.set) {
        var origSet = hrefDesc.set;
        Object.defineProperty(location, 'href', {
          get: hrefDesc.get,
          set: function(u) { origSet.call(location, proxyBase + '?url=' + encodeURIComponent(u)); },
          configurable: true
        });
      }
    } catch(e2) {}
    // 5. Patch window.open to also go through proxy
    var origOpen = window.open;
    window.open = function(u, n, f) { return origOpen.call(window, u ? proxyBase + '?url=' + encodeURIComponent(u) : u, n, f); };
  } catch(e) {}
})();
</script>`;
      const injection = antiFrameBust + baseTag;
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>${injection}`);
      } else if (html.includes('<HEAD>')) {
        html = html.replace('<HEAD>', `<HEAD>${injection}`);
      } else if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, `$&${injection}`);
      } else if (/<html[^>]*>/i.test(html)) {
        html = html.replace(/<html[^>]*>/i, `$&<head>${injection}</head>`);
      } else {
        html = injection + html;
      }

      // Set response headers — strip all iframe-blocking headers
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=300'); // 5 min cache
      // Explicitly ALLOW framing
      res.removeHeader('X-Frame-Options');
      // Don't set CSP frame-ancestors (allow all)
      res.setHeader('Access-Control-Allow-Origin', '*');

      res.send(html);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      if (err.name === 'AbortError') {
        throw new HttpException('Upstream timeout (15s)', HttpStatus.GATEWAY_TIMEOUT);
      }
      throw new HttpException(`Proxy error: ${err.message}`, HttpStatus.BAD_GATEWAY);
    }
  }
}
