/**
 * Server-side renderer for the player's URL widget.
 *
 * Built 2026-04-27 because the existing strip-scripts proxy can't
 * handle modern AJAX-loaded pages (e-arc.com top banner is fetched
 * via JS post-load; with scripts stripped, the banner div stays
 * empty). Yodeck's solution is to bundle Chromium INSIDE the kiosk
 * APK (~80MB). Ours is to render server-side with a real browser,
 * snapshot the DOM, and serve the static result. Tradeoffs:
 *
 *   Their way                    Our way
 *   ─────────────                ────────────
 *   80MB per kiosk APK           150MB on Railway (one-time)
 *   Per-kiosk security patches   We patch one Chromium
 *   APK rebuild for engine bump  Container rebuild on Railway
 *   Runs on every device         Caches across kiosks
 *
 * Behavior:
 *   1. Cache-first: keyed by URL, 10-min TTL. A 50-kiosk fleet
 *      pulling the same URL hits Chromium ~6x/hour, not 50x/min.
 *   2. Single shared browser process; per-render Page is created
 *      + closed each time. Browser is recycled every N renders
 *      to bound memory leaks.
 *   3. Wait strategy: networkidle2 (≤2 in-flight requests for
 *      500ms) with a 15s hard ceiling. Long-running ad analytics
 *      keep some sites perpetually "busy"; idle2 cuts through
 *      that better than idle0.
 *   4. After page is settled, page.content() returns the fully-
 *      hydrated HTML. We then strip <script> tags (so JS doesn't
 *      re-run inside the iframe) but keep all the DOM that JS
 *      already produced.
 *   5. Failure → returns null. Caller falls back to the existing
 *      strip-scripts-only path. Render failures don't break the
 *      kiosk; worst case it shows the same content as before.
 *
 * Concurrency: Puppeteer's browser handles multiple Pages cheaply.
 * We cap concurrent renders to avoid OOM on Railway's small dynos.
 *
 * Disable via SSR_ENABLED=false on Railway.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Browser, Page } from 'puppeteer-core';

interface RenderResult {
  html: string;
  finalUrl: string;
  renderedAt: number;
}

@Injectable()
export class RendererService implements OnModuleDestroy {
  private readonly logger = new Logger('Renderer');
  private browser: Browser | null = null;
  private browserStartedAt = 0;
  private renderCount = 0;
  private inFlight = 0;
  private cache = new Map<string, RenderResult>();

  // Hard limits — tunable via env if Railway resources change.
  private readonly CACHE_TTL_MS = 10 * 60 * 1000;        // 10 min
  private readonly RENDER_TIMEOUT_MS = 15_000;           // 15s per render
  private readonly MAX_CONCURRENT = 3;                   // simultaneous renders
  private readonly BROWSER_RECYCLE_AFTER = 50;           // rotate browser after N
  private readonly BROWSER_RECYCLE_AGE_MS = 30 * 60_000; // or every 30 min
  private readonly MAX_CACHE_ENTRIES = 200;              // prevent unbounded growth

  /**
   * Render the URL through Chromium and return fully-hydrated HTML.
   * Returns null if SSR is disabled or rendering fails — caller
   * should fall back to the legacy strip-scripts path.
   *
   * Cache hit responses are instant. Misses can take 2-15s.
   */
  async render(url: string): Promise<RenderResult | null> {
    if (process.env.SSR_ENABLED === 'false') {
      return null;
    }
    // Check cache first — 50 kiosks all viewing the same URL share
    // a single render. Stale cache (>TTL) gets re-rendered.
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.renderedAt < this.CACHE_TTL_MS) {
      this.logger.log(`[ssr] cache-hit url=${url.slice(0, 80)}`);
      return cached;
    }
    if (this.inFlight >= this.MAX_CONCURRENT) {
      this.logger.warn(`[ssr] max concurrency hit (${this.inFlight}); skipping url=${url.slice(0, 80)}`);
      return null;
    }
    this.inFlight += 1;
    try {
      const result = await this.renderOnce(url);
      if (result) {
        // Trim cache if oversized — drop oldest by renderedAt.
        if (this.cache.size >= this.MAX_CACHE_ENTRIES) {
          const oldest = [...this.cache.entries()]
            .sort((a, b) => a[1].renderedAt - b[1].renderedAt)
            [0];
          if (oldest) this.cache.delete(oldest[0]);
        }
        this.cache.set(url, result);
      }
      return result;
    } catch (e: any) {
      this.logger.warn(`[ssr] render failed url=${url.slice(0, 80)}: ${e?.message}`);
      return null;
    } finally {
      this.inFlight -= 1;
    }
  }

  private async renderOnce(url: string): Promise<RenderResult | null> {
    const browser = await this.getBrowser();
    if (!browser) return null;

    const start = Date.now();
    let page: Page | null = null;
    try {
      page = await browser.newPage();
      await page.setUserAgent(
        // Pretend to be a recent desktop Chrome. Some sites block
        // headless-Chrome; we don't need to bypass aggressive bot
        // detection for school marketing sites but the spoof helps.
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 EduCmsRenderer/1.0',
      );
      await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

      // Block heavy resource types that don't affect visible content.
      // Skipping fonts / media saves ~30% on render time for typical
      // marketing sites and avoids hangs on broken video CDNs. We
      // KEEP CSS and images (they ARE visible content).
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const t = req.resourceType();
        if (t === 'media' || t === 'websocket' || t === 'eventsource') {
          req.abort().catch(() => { /* request already gone */ });
        } else {
          req.continue().catch(() => { /* request already gone */ });
        }
      });

      // networkidle2 = ≤2 in-flight requests for 500ms. Beats
      // networkidle0 because many sites have long-running analytics
      // pings that prevent true zero-idle.
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: this.RENDER_TIMEOUT_MS,
      });

      // Belt-and-suspenders 2s grace period after networkidle for
      // anything that schedules with setTimeout(0) post-load. Most
      // AJAX banner injections finish within this window.
      await new Promise<void>((r) => setTimeout(r, 2_000));

      const html = await page.content();
      const finalUrl = page.url();
      const elapsed = Date.now() - start;
      this.logger.log(
        `[ssr] rendered url=${url.slice(0, 80)} in ${elapsed}ms ` +
        `bytes=${html.length} finalUrl=${finalUrl.slice(0, 80)}`,
      );
      return { html, finalUrl, renderedAt: Date.now() };
    } catch (e: any) {
      this.logger.warn(`[ssr] page error url=${url.slice(0, 80)}: ${e?.message}`);
      return null;
    } finally {
      if (page) {
        try { await page.close(); } catch { /* tolerated */ }
      }
    }
  }

  private async getBrowser(): Promise<Browser | null> {
    // Recycle the browser periodically to bound memory leaks.
    const age = Date.now() - this.browserStartedAt;
    const stale = this.browser && (
      this.renderCount >= this.BROWSER_RECYCLE_AFTER ||
      age >= this.BROWSER_RECYCLE_AGE_MS
    );
    if (stale && this.browser) {
      this.logger.log(`[ssr] recycling browser (renders=${this.renderCount} age=${Math.round(age / 1000)}s)`);
      try { await this.browser.close(); } catch { /* tolerated */ }
      this.browser = null;
    }
    if (this.browser) {
      this.renderCount += 1;
      return this.browser;
    }
    try {
      const puppeteer = await import('puppeteer-core');
      const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
      this.logger.log(`[ssr] launching browser executablePath=${executablePath}`);
      this.browser = await puppeteer.default.launch({
        headless: true,
        executablePath,
        args: [
          // Required to run as non-root in containers without
          // proper user namespace setup. Alpine images don't
          // ship with what Chromium's sandbox needs.
          '--no-sandbox',
          '--disable-setuid-sandbox',
          // Reduce memory footprint inside container.
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
          // Don't trip on broken cert chains for school sites with
          // odd CDN configs (we're rendering for visual capture, not
          // a security boundary; the iframe sandbox is downstream).
          '--ignore-certificate-errors',
          // Modern UA hint defaults that some sites check.
          '--enable-features=NetworkService,NetworkServiceInProcess',
        ],
      });
      this.browserStartedAt = Date.now();
      this.renderCount = 1;
      this.logger.log('[ssr] browser launched');
      return this.browser;
    } catch (e: any) {
      this.logger.error(`[ssr] browser launch failed: ${e?.message}`);
      this.browser = null;
      return null;
    }
  }

  async onModuleDestroy() {
    if (this.browser) {
      try { await this.browser.close(); } catch { /* tolerated */ }
      this.browser = null;
    }
  }
}
