/**
 * youtube-live.controller.ts
 *
 * Server-side YouTube Live stream resolver.
 *
 * GET /api/v1/fitness/youtube-live/resolve?url=<encoded>
 *
 * Accepts a YouTube channel URL (e.g. https://www.youtube.com/@CNN),
 * channel-id URL (https://youtube.com/channel/UC...), or a direct video
 * watch URL. Fetches the page HTML server-side, extracts the currently-live
 * video ID from the ytInitialData blob using multiple regex strategies
 * (the same approach used by yt-dlp and public stream-indexers), and
 * returns an embeddable URL.
 *
 * No YouTube Data API key required. The ytInitialData blob is embedded
 * in the public HTML of every YouTube channel page.
 *
 * Caching: results are cached in-memory for 5 minutes to reduce hammering
 * YouTube's servers when multiple screens show the same channel.
 *
 * Robustness: four independent regex strategies are attempted in order.
 * If YouTube changes its HTML format and some strategies break, the others
 * act as fallbacks. If all four fail the route returns 404 so the widget
 * can show a clear error state.
 *
 * IMPORTANT: This endpoint must only be called from the widget in live
 * mode — never from the gallery thumbnail path. The NestJS ThrottlerGuard
 * (globally registered at 100 req/min) applies here too.
 */

import { Controller, Get, Query, HttpException, HttpStatus, Logger } from '@nestjs/common';
import * as https from 'https';
import * as http from 'http';

// ─── In-memory cache ──────────────────────────────────────────────────────────

interface CacheEntry {
  result: YoutubeResolveResult;
  expiresAt: number;
}

// Keyed by normalized input URL
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ─── Response DTO ─────────────────────────────────────────────────────────────

interface YoutubeResolveResult {
  embedUrl: string;
  title?: string;
  channelName?: string;
  videoId: string;
}

// ─── Controller ──────────────────────────────────────────────────────────────

@Controller('api/v1/fitness/youtube-live')
export class YoutubeLiveController {
  private readonly logger = new Logger(YoutubeLiveController.name);

  @Get('resolve')
  async resolve(@Query('url') rawUrl: string): Promise<YoutubeResolveResult> {
    if (!rawUrl) {
      throw new HttpException('url query param is required', HttpStatus.BAD_REQUEST);
    }

    // ── Normalise the URL ──────────────────────────────────────────────────
    const normalised = this.normaliseYoutubeUrl(rawUrl);
    if (!normalised) {
      throw new HttpException('Invalid YouTube URL', HttpStatus.BAD_REQUEST);
    }

    // ── Cache check ────────────────────────────────────────────────────────
    const cached = cache.get(normalised);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug(`Cache hit for ${normalised}`);
      return cached.result;
    }

    // ── Fetch + extract ────────────────────────────────────────────────────
    let html: string;
    try {
      html = await this.fetchHtml(normalised);
    } catch (err) {
      this.logger.warn(`Failed to fetch YouTube page: ${String(err)}`);
      throw new HttpException('Could not fetch YouTube page', HttpStatus.BAD_GATEWAY);
    }

    const extracted = this.extractLiveVideoId(html, normalised);
    if (!extracted) {
      this.logger.debug(`No live stream found at ${normalised}`);
      throw new HttpException('No active live stream found on this channel', HttpStatus.NOT_FOUND);
    }

    const result: YoutubeResolveResult = {
      videoId: extracted.videoId,
      embedUrl: `https://www.youtube.com/embed/${extracted.videoId}?autoplay=1&mute=1`,
      title: extracted.title,
      channelName: extracted.channelName,
    };

    // ── Populate cache ─────────────────────────────────────────────────────
    cache.set(normalised, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    // Evict entries older than 30 min to prevent unbounded map growth
    if (cache.size > 500) {
      for (const [key, entry] of cache.entries()) {
        if (entry.expiresAt < Date.now() - CACHE_TTL_MS * 5) cache.delete(key);
      }
    }

    return result;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Normalise the user-provided URL into a canonical fetchable URL.
   * Handles:
   *   - https://www.youtube.com/@CNN  → https://www.youtube.com/@CNN/live
   *   - https://youtube.com/channel/UC...  → https://www.youtube.com/channel/UC.../live
   *   - https://www.youtube.com/c/ChannelName  → .../live
   *   - https://www.youtube.com/watch?v=xxx  → used as-is (direct video)
   *   - https://youtu.be/xxx  → expanded to watch URL
   * Returns null if not a recognisable YouTube URL.
   */
  private normaliseYoutubeUrl(raw: string): string | null {
    try {
      const u = new URL(raw.trim());
      const host = u.hostname.replace(/^www\./, '');

      if (host !== 'youtube.com' && host !== 'youtu.be') return null;

      // youtu.be shortlink → watch URL (probably a single video, not a channel)
      if (host === 'youtu.be') {
        const vid = u.pathname.slice(1);
        if (!vid) return null;
        return `https://www.youtube.com/watch?v=${vid}`;
      }

      // Direct watch URL — keep as-is (may be a live video link)
      if (u.pathname.startsWith('/watch')) {
        return `https://www.youtube.com${u.pathname}${u.search}`;
      }

      // Channel variants — append /live to land on the live-tab page
      const base = `https://www.youtube.com${u.pathname}`.replace(/\/+$/, '');
      if (
        u.pathname.startsWith('/@') ||
        u.pathname.startsWith('/channel/') ||
        u.pathname.startsWith('/c/') ||
        u.pathname.startsWith('/user/')
      ) {
        // Strip any existing /live suffix before re-adding so we don't double it
        const stripped = base.replace(/\/live$/, '');
        return `${stripped}/live`;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch HTML from a URL, following up to 3 redirects.
   * Sets a realistic browser UA so YouTube doesn't return a captcha page.
   * Times out after 10 seconds.
   */
  private fetchHtml(url: string, redirectsLeft = 3): Promise<string> {
    return new Promise((resolve, reject) => {
      if (redirectsLeft < 0) { reject(new Error('Too many redirects')); return; }

      const parsed = new URL(url);
      const lib = parsed.protocol === 'https:' ? https : http;

      const req = lib.get(
        url,
        {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
              '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        },
        (res) => {
          // Follow redirects (YouTube /live sometimes 301s to a video)
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            const next = new URL(res.headers.location, url).toString();
            res.resume(); // drain to free the socket
            this.fetchHtml(next, redirectsLeft - 1).then(resolve, reject);
            return;
          }

          if (res.statusCode !== 200) {
            res.resume();
            reject(new Error(`HTTP ${res.statusCode ?? 'unknown'}`));
            return;
          }

          const chunks: Buffer[] = [];
          let totalBytes = 0;
          const MAX_BYTES = 4 * 1024 * 1024; // 4 MB cap — ytInitialData is in <head>

          res.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes > MAX_BYTES) {
              // We've seen enough — ytInitialData is always in the first 1-2 MB
              req.destroy();
              resolve(Buffer.concat(chunks).toString('utf-8'));
            } else {
              chunks.push(chunk);
            }
          });

          res.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf-8'));
          });

          res.on('error', reject);
        },
      );

      req.setTimeout(10_000, () => {
        req.destroy(new Error('Request timed out'));
      });

      req.on('error', reject);
    });
  }

  /**
   * Extract the currently-live video ID from a YouTube page's HTML.
   *
   * YouTube embeds a large JSON blob (ytInitialData) in every page. We
   * run four independent strategies against it (and against the raw HTML)
   * to find either:
   *   (a) A live broadcast video ID surfaced as the canonical watch URL, or
   *   (b) A "videoId" inside a liveBroadcast/isLiveNow context.
   *
   * Four strategies — the first to succeed wins:
   *
   *   S1. videoDetails.isLiveContent = true (used on /watch pages for live videos).
   *       The ytInitialData on a /watch?v=<id> page for a live stream has
   *       playerOverlays showing "LIVE" and videoDetails.isLiveNow = true.
   *       We capture the videoId from the surrounding context.
   *
   *   S2. "isLive":true adjacent to a "videoId" key in the JSON blob.
   *       Covers the channel /live redirect page which embeds the live video
   *       as a featured item with explicit isLive flag.
   *
   *   S3. Canonical URL meta-tag containing /watch?v=<id> (used on channel
   *       /live pages that redirect server-side to the live video).
   *
   *   S4. og:video meta-tag URL containing a video ID. Last resort — YouTube
   *       sometimes populates this even when the JSON is obfuscated.
   *
   * Returns { videoId, title?, channelName? } or null if no live stream found.
   */
  private extractLiveVideoId(
    html: string,
    sourceUrl: string,
  ): { videoId: string; title?: string; channelName?: string } | null {

    // ── S1: videoDetails.isLiveNow on /watch pages ────────────────────────
    // Pattern: "isLive":true followed somewhere by a "videoId":"<id>" in the
    // same object, OR the reverse order. We scan a window around "isLive":true.
    {
      const s1match = html.match(/"isLiveNow"\s*:\s*true/);
      if (s1match) {
        // Extract the surrounding 2000 chars to find videoId
        const idx = html.indexOf(s1match[0]);
        const window = html.slice(Math.max(0, idx - 1000), idx + 1000);
        const vidMatch = window.match(/"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/);
        if (vidMatch) {
          const title = this.extractTitle(html);
          const channelName = this.extractChannelName(html);
          this.logger.debug(`S1 matched videoId ${vidMatch[1]} at ${sourceUrl}`);
          return { videoId: vidMatch[1], title, channelName };
        }
      }
    }

    // ── S2: "isLive":true (broader, used on channel /live pages) ──────────
    // YouTube channel /live pages embed the live video inside
    // featuredVideoRenderer or liveBroadcastDetails with "isLive":true.
    {
      // Collect all occurrences of "isLive":true and check neighbours
      const s2re = /"isLive"\s*:\s*true/g;
      let s2m: RegExpExecArray | null;
      while ((s2m = s2re.exec(html)) !== null) {
        const idx = s2m.index;
        const window = html.slice(Math.max(0, idx - 500), idx + 500);
        const vidMatch = window.match(/"videoId"\s*:\s*"([A-Za-z0-9_-]{11})"/);
        if (vidMatch) {
          const title = this.extractTitle(html);
          const channelName = this.extractChannelName(html);
          this.logger.debug(`S2 matched videoId ${vidMatch[1]} at ${sourceUrl}`);
          return { videoId: vidMatch[1], title, channelName };
        }
      }
    }

    // ── S3: Canonical <link> or <meta> containing the live video URL ────────
    // When YouTube's server-side renders the /live page it sometimes sets
    // the canonical URL directly to the live video's watch page.
    {
      const s3 = html.match(
        /<link[^>]+rel=["']canonical["'][^>]+href=["']https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})["']/,
      ) || html.match(
        /["']https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})["'][^>]*rel=["']canonical["']/,
      );
      if (s3) {
        const videoId = s3[1];
        // Verify this is actually live by checking the page has some live signal
        const hasLiveSignal = html.includes('"isLive":true') ||
          html.includes('"isLiveNow":true') ||
          html.includes('"liveBroadcastDetails"') ||
          html.includes('"LIVE"');
        if (hasLiveSignal) {
          const title = this.extractTitle(html);
          const channelName = this.extractChannelName(html);
          this.logger.debug(`S3 matched videoId ${videoId} at ${sourceUrl}`);
          return { videoId, title, channelName };
        }
      }
    }

    // ── S4: og:video meta tag ──────────────────────────────────────────────
    // YouTube populates og:video:url with the embed URL for live videos.
    {
      const s4 = html.match(
        /<meta[^>]+property=["']og:video(?::url)?["'][^>]+content=["'][^"']*(?:embed|watch[?%].*v[=%])([A-Za-z0-9_-]{11})[^"']*["']/,
      ) || html.match(
        /<meta[^>]+content=["'][^"']*(?:embed|watch[?%].*v[=%])([A-Za-z0-9_-]{11})[^"']*["'][^>]+property=["']og:video(?::url)?["']/,
      );
      if (s4) {
        const videoId = s4[1];
        this.logger.debug(`S4 matched videoId ${videoId} at ${sourceUrl}`);
        const title = this.extractTitle(html);
        const channelName = this.extractChannelName(html);
        return { videoId, title, channelName };
      }
    }

    return null;
  }

  /** Extract the page title from an og:title meta or <title> tag. */
  private extractTitle(html: string): string | undefined {
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,200})["']/);
    if (og) return this.decodeHtmlEntities(og[1]);
    const title = html.match(/<title[^>]*>([^<]{1,200})<\/title>/);
    if (title) return this.decodeHtmlEntities(title[1].replace(/ - YouTube$/, ''));
    return undefined;
  }

  /** Extract the channel name from ytInitialData or og:site_name fallback. */
  private extractChannelName(html: string): string | undefined {
    // ytInitialData has "channelName":"<name>" in metadata
    const ch = html.match(/"channelName"\s*:\s*"([^"]{1,120})"/);
    if (ch) return this.decodeHtmlEntities(ch[1]);
    // Fallback: author meta
    const author = html.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']{1,120})["']/);
    if (author) return this.decodeHtmlEntities(author[1]);
    return undefined;
  }

  /** Minimal HTML entity decode for title/channelName text fields. */
  private decodeHtmlEntities(str: string): string {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\\u0026/g, '&') // JSON-escaped in ytInitialData
      .replace(/\\u003c/g, '<')
      .replace(/\\u003e/g, '>');
  }
}
