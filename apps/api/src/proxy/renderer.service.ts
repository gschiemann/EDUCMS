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
 *
 * ── SECURITY POSTURE (SEC-006, 2026-09-04) ───────────────────────────────
 * This service is driven by `/api/v1/proxy/web`, which is PUBLIC and
 * UNAUTHENTICATED (it is loaded as an iframe `src`, so it cannot carry a
 * bearer token). It points a real browser at an arbitrary caller-chosen URL
 * from inside the production container. Four layers hold that:
 *
 *   1. DNS-AWARE ADMISSION on the top URL and on EVERY request the page makes
 *      — sub-resources included. Before 2026-09-04 sub-resources got only the
 *      synchronous IP-literal check, so a hostname resolving to 10.x /
 *      127.0.0.1 / 169.254.169.254 connected as an <img>/<script>/fetch even
 *      though NAVIGATING there was blocked. That was the hole.
 *   2. CONNECTED-PEER VERIFICATION. Our resolution and Chromium's are two
 *      separate lookups, so a low-TTL rebind can split them. Every response's
 *      `remoteAddress()` is checked; one private peer poisons the render and
 *      NOTHING is returned to the caller.
 *   3. EXPOSURE BOUNDS: whole-render wall-clock budget, HTML size cap,
 *      declared-response-bytes cap, per-render request cap, process-wide
 *      renders/minute ceiling, and a circuit breaker — on top of the
 *      controller's 60/min/IP throttle and the 3-way concurrency cap.
 *   4. FAIL CLOSED, ALWAYS: any guard fault, resolution failure or timeout
 *      aborts the request; any poisoning discards the render. The caller
 *      falls back to `safeFetch`, which is strictly more constrained.
 *
 * WHAT THIS DOES NOT DO. Request interception cannot pin the SOCKET the way
 * `safeFetch` pins its `lookup`, so packets can still be SENT to a rebound
 * address (layer 2 stops the answer coming back, not the packet going out),
 * and Chromium still runs `--no-sandbox --single-process` in this image. The
 * complete fix is an isolated worker with a deny-by-default egress policy;
 * the requirements are written up in
 * docs/research/2026-09-04-security-remediation/SEC-006-007-renderer-beacons.md.
 *
 * ── LAYER 5: WHO MAY DRIVE IT (SEC-006 re-audit, 2026-09-04) ──────────────
 * Because that residual cannot be closed inside this process, the independent
 * re-audit's pass condition was to stop letting ANYONE drive it: "the
 * unauthenticated arbitrary-page route is disabled / strictly capability-gated
 * for launch." So `render()` now REQUIRES a `RenderGrant` — there is no
 * signature that renders without stating who authorised it. `ProxyController`
 * builds one only from a signed, URL-bound `cap` minted by the authenticated
 * `POST /api/v1/proxy/render-capability` (see `render-capability.ts`). An
 * anonymous request never reaches Chromium at all: it falls through to
 * `safeFetch`, which is strictly more constrained and has no browser in it.
 * The exposure bounds above all still apply ON TOP of the grant — an
 * authenticated principal is not a trusted one.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Browser, Page, PuppeteerLaunchOptions } from 'puppeteer-core';
import { assertPublicUrl, validatePublicUrl, isPrivateIp, SsrfError } from '../branding/safe-fetch';

interface RenderResult {
  html: string;
  finalUrl: string;
  renderedAt: number;
}

/**
 * SEC-006 — proof that a render was authorised, and by whom.
 *
 * A required argument rather than an optional one on purpose: making it
 * optional would leave "forgot to pass it" indistinguishable from "nobody
 * authorised this", which is the shape of every auth regression this codebase
 * has already paid for. `kind` records how the authorisation was obtained so
 * the log line names it.
 */
export interface RenderGrant {
  /**
   * `capability` — a signed, URL-bound capability minted by the authenticated
   * `POST /api/v1/proxy/render-capability`. This is the normal path.
   * `env-override` — the `PROXY_SSR_ALLOW_ANONYMOUS=1` escape hatch, which
   * restores the pre-SEC-006 open behaviour for an operator who knowingly
   * accepts it. Never the default.
   */
  kind: 'capability' | 'env-override';
  /** Tenant the render is attributable to, when the grant carries one. */
  tenantId: string | null;
  /** Human-readable principal, for the render log line. */
  principal: string;
}

/**
 * SEC-006 (2026-09-04) — bound how long a single DNS verdict may be trusted
 * inside one render. The verdict cache exists so a page with 80 images on one
 * CDN costs ONE lookup, not 80; a TTL keeps that from becoming "resolve once
 * at second 0, trust for the whole 20-second render", which is the window a
 * low-TTL rebind record aims at. 10s is long enough that a normal page still
 * pays one lookup per host and short enough that a rebind has to land inside
 * a narrow slice — and the connected-peer check below catches it even then.
 */
const HOST_VERDICT_TTL_MS = 10_000;

/** Cap on how long a single DNS resolution may block a paused request. */
const DNS_VERDICT_TIMEOUT_MS = 4_000;

/**
 * The one thing `RendererService` needs out of puppeteer-core.
 *
 * Declared as a narrow interface, and loaded through the overridable
 * `loadPuppeteer()` seam below, so the SSRF/exposure guards can be exercised
 * against a fake browser in `renderer.ssrf.spec.ts`. `await import()` under
 * `module: nodenext` emits a REAL dynamic import, which `jest.mock` cannot
 * intercept without `--experimental-vm-modules` — hence the seam rather than a
 * module mock.
 */
export interface BrowserLauncher {
  launch(options: PuppeteerLaunchOptions): Promise<Browser>;
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

  // ── SEC-006 exposure bounds ──────────────────────────────────────────
  // The endpoint that drives this is UNAUTHENTICATED (`/api/v1/proxy/web` is
  // an iframe `src`, so it cannot carry a bearer token — see the controller).
  // Everything below therefore has to hold without an identity to charge.

  /**
   * Hard wall-clock ceiling for ONE render, covering every await in
   * `renderOnce` — not just `page.goto`. `goto`'s own timeout ends at load;
   * the post-load grace, `page.content()` on a pathological DOM, and a
   * `page.close()` that hangs on a wedged renderer all sit outside it. This
   * is the number that actually bounds a request's cost.
   */
  private readonly RENDER_BUDGET_MS = 25_000;

  /** Max rendered-HTML bytes handed back to the caller. */
  private readonly MAX_HTML_BYTES = 8 * 1024 * 1024;

  /**
   * Max declared response bytes across ONE render. Best-effort (only counts
   * responses that declare `content-length`), but it stops the obvious
   * "point the renderer at a 4 GB file so the container swaps" shape.
   */
  private readonly MAX_RESPONSE_BYTES = 24 * 1024 * 1024;

  /** Max intercepted requests per render — bounds subrequest amplification. */
  private readonly MAX_REQUESTS_PER_RENDER = 300;

  /**
   * Process-wide render ceiling. The controller's per-IP throttle (60/min)
   * bounds ONE client; a botnet or a big NAT is many clients pointing at one
   * Chromium. This is the aggregate backstop.
   */
  private readonly MAX_RENDERS_PER_MINUTE = 120;
  private renderStamps: number[] = [];

  /**
   * Circuit breaker. Chromium failing (OOM, crash-loop, a wedged zygote) used
   * to mean every request paid the full 15s timeout before falling back to
   * `safeFetch`, which is a self-inflicted latency amplifier under load. After
   * N consecutive failures the breaker opens and `render()` returns null
   * immediately — the caller's existing fallback path takes over — until the
   * cool-down elapses and one probe render is allowed through.
   */
  private readonly BREAKER_FAILURE_THRESHOLD = 5;
  private readonly BREAKER_COOLDOWN_MS = 60_000;
  private consecutiveFailures = 0;
  private breakerOpenedAt = 0;

  /**
   * Render the URL through Chromium and return fully-hydrated HTML.
   * Returns null if SSR is disabled or rendering fails — caller
   * should fall back to the legacy strip-scripts path.
   *
   * Cache hit responses are instant. Misses can take 2-15s.
   */
  async render(url: string, grant: RenderGrant): Promise<RenderResult | null> {
    // SEC-006 — belt to the type system's braces. TypeScript already makes
    // `render(url)` a compile error, but this service is reachable from a
    // JavaScript build output and from tests, and "the renderer ran with no
    // grant" must be impossible, not merely un-typeable.
    if (!grant || (grant.kind !== 'capability' && grant.kind !== 'env-override')) {
      this.logger.warn(`[ssr] refused: no render grant for url=${url.slice(0, 80)}`);
      return null;
    }
    if (process.env.SSR_ENABLED === 'false') {
      return null;
    }
    // Check cache first — 50 kiosks all viewing the same URL share
    // a single render. Stale cache (>TTL) gets re-rendered.
    //
    // SEC-006: the grant check above deliberately precedes this. A cache hit
    // is not a render, but serving SSR output to a caller who could not have
    // obtained a grant would leave the gate half-open and impossible to state
    // plainly ("anonymous callers never receive SSR output" is the claim, and
    // it has to be true of the cache too).
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.renderedAt < this.CACHE_TTL_MS) {
      this.logger.log(`[ssr] cache-hit url=${url.slice(0, 80)}`);
      return cached;
    }
    if (this.inFlight >= this.MAX_CONCURRENT) {
      this.logger.warn(`[ssr] max concurrency hit (${this.inFlight}); skipping url=${url.slice(0, 80)}`);
      return null;
    }
    // SEC-006 — circuit breaker. While open, skip Chromium entirely and let
    // the caller's `safeFetch` fallback serve, instead of paying the full
    // render budget per request against a browser we already know is sick.
    if (this.breakerIsOpen()) {
      this.logger.warn(`[ssr] circuit breaker open; skipping url=${url.slice(0, 80)}`);
      return null;
    }
    // SEC-006 — process-wide render ceiling (the per-IP throttle only bounds
    // one client).
    if (!this.consumeGlobalRenderBudget()) {
      this.logger.warn(`[ssr] global render budget exhausted; skipping url=${url.slice(0, 80)}`);
      return null;
    }
    this.inFlight += 1;
    this.logger.log(
      `[ssr] render start grant=${grant.kind} principal=${grant.principal} ` +
        `tenant=${grant.tenantId ?? '-'} url=${url.slice(0, 80)}`,
    );
    try {
      const result = await this.withDeadline(
        this.renderOnce(url),
        this.RENDER_BUDGET_MS,
        'render budget exceeded',
      );
      if (result) {
        this.consecutiveFailures = 0;
        // Trim cache if oversized — drop oldest by renderedAt.
        if (this.cache.size >= this.MAX_CACHE_ENTRIES) {
          const oldest = [...this.cache.entries()]
            .sort((a, b) => a[1].renderedAt - b[1].renderedAt)
            [0];
          if (oldest) this.cache.delete(oldest[0]);
        }
        this.cache.set(url, result);
      } else {
        this.noteFailure();
      }
      return result;
    } catch (e: any) {
      this.noteFailure();
      this.logger.warn(`[ssr] render failed url=${url.slice(0, 80)}: ${e?.message}`);
      return null;
    } finally {
      this.inFlight -= 1;
    }
  }

  /** True while the breaker is tripped and still inside its cool-down. */
  private breakerIsOpen(): boolean {
    if (this.consecutiveFailures < this.BREAKER_FAILURE_THRESHOLD) return false;
    if (Date.now() - this.breakerOpenedAt >= this.BREAKER_COOLDOWN_MS) {
      // Cool-down elapsed — let ONE probe through. It either succeeds (which
      // resets the counter) or fails (which re-arms the cool-down).
      this.consecutiveFailures = this.BREAKER_FAILURE_THRESHOLD - 1;
      return false;
    }
    return true;
  }

  private noteFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.BREAKER_FAILURE_THRESHOLD) {
      this.breakerOpenedAt = Date.now();
    }
  }

  /** Sliding one-minute ceiling on renders started by this process. */
  private consumeGlobalRenderBudget(): boolean {
    const now = Date.now();
    this.renderStamps = this.renderStamps.filter((t) => t > now - 60_000);
    if (this.renderStamps.length >= this.MAX_RENDERS_PER_MINUTE) return false;
    this.renderStamps.push(now);
    return true;
  }

  /**
   * Race `work` against a hard deadline. Used so the render budget covers the
   * WHOLE of `renderOnce`, including awaits `page.goto`'s own timeout does not
   * reach (post-load grace, `page.content()`, `page.close()`).
   */
  private async withDeadline<T>(work: Promise<T>, ms: number, reason: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(reason)), ms);
          // Never hold the event loop open for a deadline alone.
          if (typeof timer.unref === 'function') timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async renderOnce(url: string): Promise<RenderResult | null> {
    // SSRF guard. `/proxy/web` takes an operator-supplied URL and this
    // method drives a real headless browser at it — without this check
    // `?url=http://169.254.169.254/latest/meta-data/...` would let the
    // Railway container fetch its own cloud-metadata / internal
    // services and return the body in the rendered HTML. Resolve the
    // hostname and reject any private/loopback/link-local address
    // BEFORE launching the browser. (`safeFetch` does this for the
    // legacy fallback path; the renderer must do it too — they are two
    // independent entry points for the same user input.)
    try {
      await assertPublicUrl(url);
    } catch (e: any) {
      this.logger.warn(`[ssr] SSRF guard rejected url=${url.slice(0, 80)}: ${e?.message}`);
      return null;
    }

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

      // SSRF-01 (2026-08-04) — per-render DNS verdict cache.
      // SEC-006 (2026-09-04) — now applied to EVERY request, not navigations
      // only, and given a TTL. See `guardRequestUrl` below.
      //
      // Caching the verdict per HOST makes the added cost one lookup per
      // distinct host per TTL for the whole render, not one per request —
      // which was the original reason the DNS check was skipped for
      // sub-resources.
      //
      // Stores the PROMISE, so N concurrent requests to the same host await a
      // single in-flight lookup rather than starting N of them.
      const hostVerdicts = new Map<string, { at: number; verdict: Promise<unknown> }>();
      const assertHostIsPublic = (rawUrl: string): Promise<unknown> => {
        let host: string;
        try {
          host = new URL(rawUrl).host;
        } catch {
          return Promise.reject(new SsrfError('Invalid URL'));
        }
        const now = Date.now();
        const cached = hostVerdicts.get(host);
        if (cached && now - cached.at < HOST_VERDICT_TTL_MS) return cached.verdict;
        // Bounded: a resolver that hangs must not hold a paused request open
        // for the whole render budget, and a resolution we cannot complete is
        // a REFUSAL, never a pass (fail closed).
        const verdict = this.withDeadline(
          assertPublicUrl(rawUrl),
          DNS_VERDICT_TIMEOUT_MS,
          'dns verdict timed out',
        ).catch((e: unknown) => {
          throw e instanceof SsrfError
            ? e
            : new SsrfError(`DNS verdict unavailable for ${host}`);
        });
        // Swallow here so an early rejection cannot surface as an unhandled
        // rejection; every consumer still awaits and handles it below.
        verdict.catch(() => { /* handled at the await site */ });
        hostVerdicts.set(host, { at: now, verdict });
        return verdict;
      };

      // SEC-006 — a render is POISONED the moment we learn it touched
      // something it must not have (a private connected peer, an oversized
      // body, a request flood). A poisoned render returns NOTHING to the
      // caller: whatever HTML exists may embed data read off an internal
      // service, so the only safe move is to discard the whole render and let
      // the controller's `safeFetch` fallback answer.
      let poisoned: string | null = null;
      const poison = (reason: string) => {
        if (!poisoned) {
          poisoned = reason;
          this.logger.error(`[ssr] render poisoned url=${url.slice(0, 80)}: ${reason}`);
        }
      };

      let requestsSeen = 0;
      let declaredBytes = 0;

      page.on('request', async (req) => {
        const t = req.resourceType();
        if (t === 'media' || t === 'websocket' || t === 'eventsource') {
          req.abort().catch(() => { /* request already gone */ });
          return;
        }
        // SEC-006 — subrequest amplification cap. A hostile page can emit
        // thousands of requests through our container; past this ceiling the
        // render is poisoned and every further request is refused.
        requestsSeen += 1;
        if (requestsSeen > this.MAX_REQUESTS_PER_RENDER) {
          poison(`request cap exceeded (${requestsSeen})`);
          req.abort().catch(() => { /* request already gone */ });
          return;
        }

        // ── SEC-006: THE SUBRESOURCE HOLE ────────────────────────────────
        // This guard used to run the DNS-resolving `assertPublicUrl` on
        // NAVIGATIONS ONLY, on the theory that a sub-resource "does not become
        // the returned document" and so the cheap synchronous check was
        // enough. That theory is wrong twice over:
        //
        //   1. `validatePublicUrl` only inspects an IP LITERAL. A HOSTNAME is
        //      not an IP literal, so `internal.attacker.example` with an A
        //      record on 10.0.0.5 / 127.0.0.1 / 169.254.169.254 passed it. The
        //      browser then CONNECTED — as an <img>, <script>, fetch() or form
        //      target — from inside the production container, on a public
        //      unauthenticated endpoint.
        //   2. "It does not become the document" is not the whole threat. A
        //      script on the attacker's own page can read a same-origin-ish
        //      internal response, or simply time it / observe whether it
        //      loaded, and exfiltrate that back to the attacker — blind SSRF
        //      and an internal port/host scanner. And the page it renders IS
        //      returned to the caller, so anything JS wrote into the DOM from
        //      an internal fetch comes out with it.
        //
        // So the DNS-resolving check now runs on EVERY request. The per-host
        // TTL cache keeps the cost at one lookup per distinct host per 10s,
        // which is what made the "too slow for sub-resources" argument moot.
        try {
          validatePublicUrl(req.url());
          await assertHostIsPublic(req.url());
        } catch (e) {
          if (e instanceof SsrfError) {
            this.logger.warn(`[ssr] blocked sub-request ${req.url().slice(0, 80)}: ${e.message}`);
            req.abort().catch(() => { /* request already gone */ });
            return;
          }
          // Fail CLOSED. Both guards throw only SsrfError, so anything else is
          // an unexpected fault in the guard itself — aborting one request is
          // strictly safer than letting an unvetted request proceed.
          this.logger.warn(`[ssr] guard fault on ${req.url().slice(0, 80)} — aborting`);
          req.abort().catch(() => { /* request already gone */ });
          return;
        }
        req.continue().catch(() => { /* request already gone */ });
      });

      // ── SEC-006: CONNECTED-PEER VERIFICATION (anti-rebinding) ──────────
      // Every check above resolves DNS *in this process*; Chromium resolves
      // again, in its own network service, when it actually opens the socket.
      // Those are two different lookups, so a low-TTL record can answer public
      // for ours and private for Chromium's — classic DNS rebinding, and
      // request interception cannot pin the socket the way `safeFetch` does
      // with its `lookup` option (there is no equivalent hook; see the
      // service header for the isolated-worker/egress-firewall follow-up).
      //
      // What we CAN do is verify the address Chromium ACTUALLY connected to.
      // `HTTPResponse.remoteAddress()` reports the peer per response. If any
      // peer in the render is private/loopback/link-local/metadata, the render
      // is poisoned and no HTML is returned — so a rebind still cannot turn
      // into a read primitive, even though the packet was sent.
      page.on('response', (res) => {
        try {
          const peer = res.remoteAddress?.();
          const ip = peer && typeof peer.ip === 'string' ? peer.ip : '';
          // Strip a bracketed-IPv6 form if Chromium reports one.
          const bare = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
          if (bare && isPrivateIp(bare)) {
            poison(`connected to private peer ${bare} for ${res.url().slice(0, 80)}`);
          }
          const len = Number(res.headers()['content-length']);
          if (Number.isFinite(len) && len > 0) {
            declaredBytes += len;
            if (declaredBytes > this.MAX_RESPONSE_BYTES) {
              poison(`declared response bytes exceeded (${declaredBytes})`);
            }
          }
        } catch {
          /* a response object can be gone by the time we inspect it */
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

      if (poisoned) {
        this.logger.warn(`[ssr] discarding poisoned render url=${url.slice(0, 80)}: ${poisoned}`);
        return null;
      }

      const html = await page.content();
      const finalUrl = page.url();

      // SEC-006 — re-check the document we are about to hand back. `goto`
      // follows redirects and in-page navigations; the URL we validated on the
      // way in is not necessarily the one that produced this DOM.
      try {
        await assertHostIsPublic(finalUrl);
      } catch (e: any) {
        this.logger.warn(
          `[ssr] final URL failed the SSRF guard (${finalUrl.slice(0, 80)}): ${e?.message}`,
        );
        return null;
      }

      if (html.length > this.MAX_HTML_BYTES) {
        this.logger.warn(
          `[ssr] rendered HTML ${html.length}B over cap ${this.MAX_HTML_BYTES}B url=${url.slice(0, 80)}`,
        );
        return null;
      }

      // A peer/size verdict can land during `page.content()` — re-check.
      if (poisoned) {
        this.logger.warn(`[ssr] discarding poisoned render url=${url.slice(0, 80)}: ${poisoned}`);
        return null;
      }

      const elapsed = Date.now() - start;
      this.logger.log(
        `[ssr] rendered url=${url.slice(0, 80)} in ${elapsed}ms ` +
        `bytes=${html.length} requests=${requestsSeen} finalUrl=${finalUrl.slice(0, 80)}`,
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

  /**
   * Load puppeteer-core lazily. Overridable so the SSRF guards can be tested
   * against a fake browser — see `BrowserLauncher` above for why a module mock
   * is not an option here. Production behaviour is unchanged: still a lazy
   * dynamic import inside the existing try/catch, so a container without
   * Chromium still boots and simply renders nothing.
   */
  protected async loadPuppeteer(): Promise<BrowserLauncher> {
    const puppeteer = await import('puppeteer-core');
    return puppeteer.default;
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
      const puppeteer = await this.loadPuppeteer();
      const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser';
      this.logger.log(`[ssr] launching browser executablePath=${executablePath}`);
      this.browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: [
          // ── PRIVILEGE (SEC-006, 2026-09-04) ───────────────────────────
          // `--no-sandbox` + `--disable-setuid-sandbox` + `--single-process`
          // STAY, and that is a known, recorded gap — not an oversight.
          // The deployed image (`Dockerfile`, runner stage) is
          // `node:20-alpine` running as `USER node`, installing Alpine's
          // `chromium` package. Alpine ships no SUID `chrome-sandbox` helper,
          // and Railway's container runtime does not grant the unprivileged
          // user the `CLONE_NEWUSER` capability the namespace sandbox needs,
          // so dropping these flags makes Chromium refuse to launch and takes
          // the SSR path down fleet-wide. Fixing it properly means changing
          // the image + the deploy (out of this change's ownership) — see
          // docs/research/2026-09-04-security-remediation/
          // SEC-006-007-renderer-beacons.md, "Isolated-worker follow-up",
          // for exactly what that requires.
          '--no-sandbox',
          '--disable-setuid-sandbox',
          // Reduce memory footprint inside container.
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
          // NOTE: `--ignore-certificate-errors` was REMOVED here (SEC-006).
          // It made this browser accept any certificate — including one
          // presented by whatever a rebound/hijacked name resolved to — on a
          // PUBLIC, unauthenticated endpoint, which is the opposite of what a
          // TOCTOU-sensitive fetcher wants. It also granted the renderer a
          // capability the fallback path never had: `safeFetch` uses
          // `node:https` with default verification, so a site with a broken
          // chain ALREADY fails the fallback. Removing the flag therefore
          // costs no reachable site that the product could otherwise serve.
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
