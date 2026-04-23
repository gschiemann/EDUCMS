import { Controller, Get, Query, Res, HttpException, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { safeFetch, SsrfError, FetchTooLargeError } from '../branding/safe-fetch';

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

      const contentType = upstream.contentType || 'text/html';

      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
        res.redirect(url);
        return;
      }

      let html = upstream.body.toString('utf8');

      const baseUrl = upstream.finalUrl || url;

      html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
      html = html.replace(/<meta[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
      html = html.replace(/\s(on\w+)\s*=\s*["'][^"']*["']/gi, '');
      html = html.replace(/<\/?noscript[^>]*>/gi, '');

      const baseTag = `<base href="${baseUrl}">`;
      if (html.includes('<head>')) {
        html = html.replace('<head>', `<head>\n${baseTag}`);
      } else if (html.includes('<HEAD>')) {
        html = html.replace('<HEAD>', `<HEAD>\n${baseTag}`);
      } else if (/<head[^>]*>/i.test(html)) {
        html = html.replace(/<head[^>]*>/i, `$&${baseTag}`);
      } else if (/<html[^>]*>/i.test(html)) {
        html = html.replace(/<html[^>]*>/i, `$&<head>${baseTag}</head>`);
      } else {
        html = baseTag + html;
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
