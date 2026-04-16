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

      // STRATEGY: Strip ALL JavaScript from the page.
      // Chrome prevents overriding window.top, location.href, location.replace etc.
      // (they're unforgeable browser APIs), so anti-frame-busting scripts don't work.
      // For digital signage DISPLAY purposes, JS is unnecessary — pages render their
      // content (CSS, images, layout) perfectly without it. Stripping JS also removes
      // all frame-busting, redirect, and tracking scripts.

      // 1. Remove all <script> tags and their content
      html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      // 2. Remove <meta http-equiv="refresh"> redirects
      html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
      // 3. Remove javascript: URLs in event handlers
      html = html.replace(/\s(on\w+)\s*=\s*["'][^"']*["']/gi, '');
      // 4. Remove noscript tags (show their content since we ARE stripping scripts)
      html = html.replace(/<\/?noscript[^>]*>/gi, '');

      // Inject <base> tag so relative URLs (CSS, images) resolve against the original domain
      const baseTag = `<base href="${baseUrl}">`;
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>${baseTag}`);
      } else if (html.includes('<HEAD>')) {
        html = html.replace('<HEAD>', `<HEAD>${baseTag}`);
      } else if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, `$&${baseTag}`);
      } else if (/<html[^>]*>/i.test(html)) {
        html = html.replace(/<html[^>]*>/i, `$&<head>${baseTag}</head>`);
      } else {
        html = baseTag + html;
      }

      // Set response headers — strip all iframe-blocking headers
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
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
