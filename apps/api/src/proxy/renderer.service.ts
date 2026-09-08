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
 *   2. Every render runs in a DISPOSABLE CHILD PROCESS. No browser,
 *      page or profile is reused between renders.
 *   3. Wait strategy: networkidle2 (≤2 in-flight requests for
 *      500ms) with a 15s hard ceiling. Long-running ad analytics
 *      keep some sites perpetually "busy"; idle2 cuts through
 *      that better than idle0.
 *   4. After the page settles, `page.content()` returns the fully-
 *      hydrated HTML. The controller then strips <script> tags (so JS
 *      doesn't re-run inside the iframe) but keeps all the DOM that
 *      JS already produced.
 *   5. Failure → returns null. Caller falls back to the existing
 *      strip-scripts-only path. Render failures don't break the
 *      kiosk; worst case it shows the same content as before.
 *
 * Disable via SSR_ENABLED=false on Railway.
 *
 * ── SECURITY POSTURE (SEC-006) ───────────────────────────────────────────
 * This service is driven by `/api/v1/proxy/web`, which is PUBLIC (it is
 * loaded as an iframe `src`, so it cannot carry a bearer token) and points a
 * real browser at a caller-chosen URL from inside the production deployment.
 * Six layers hold that:
 *
 *   1. WHO MAY DRIVE IT. `render()` REQUIRES a `RenderGrant`; the only way to
 *      get one is a signed, URL-bound `cap` minted by the authenticated
 *      `POST /api/v1/proxy/render-capability` (`render-capability.ts`). An
 *      anonymous request never reaches Chromium — it falls through to
 *      `safeFetch`, which has no browser in it.
 *   2. PROCESS ISOLATION (2026-09-05, the durable half of the finding).
 *      Chromium no longer runs in this process. Every render is a fresh
 *      `fork()` of `render-worker.js` with an ALLOWLISTED environment (no
 *      `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `DEVICE_SECRET_KEY`,
 *      `SUPABASE_*`, `PROXY_RENDER_SECRET` — see `render-worker-protocol.ts`),
 *      its own process group, its own small Node heap, a throwaway profile
 *      directory and a hard wall-clock SIGKILL. A renderer-process exploit,
 *      an OOM or a hang now costs ONE render, not the process that owns
 *      emergency delivery, the Redis fan-out and the manifest hot cache.
 *   3. DNS-AWARE ADMISSION on the top URL and on EVERY sub-request, inside
 *      the child (`render-pipeline.ts`).
 *   4. CONNECTED-PEER VERIFICATION: any private peer poisons the render and
 *      nothing is returned.
 *   5. EXPOSURE BOUNDS: whole-render wall clock, a container-metered MEMORY
 *      ceiling per render (2026-09-08 — the wall clock bounded how long a
 *      hostile page could allocate, nothing bounded how much, and one
 *      measured page took a whole 4 GB cgroup inside one budget), HTML size
 *      cap, declared-byte cap, per-render request cap, process-wide
 *      renders/minute ceiling and a circuit breaker, on top of the
 *      controller's 60/min/IP throttle.
 *   6. FAIL CLOSED, ALWAYS. Any guard fault, resolution failure, timeout or
 *      unexpected worker output discards the render; the caller falls back to
 *      `safeFetch`, which is strictly more constrained.
 *
 * RESIDUAL, stated plainly: Chromium still runs `--no-sandbox` because the
 * container grants no capabilities and Docker's default seccomp profile denies
 * `CLONE_NEW*` — measured, not assumed; see `buildChromiumLaunchArgs` in
 * `render-pipeline.ts` for the probe output. Request interception still cannot
 * pin Chromium's socket, so a DNS rebind can still put a packet on an internal
 * address (layer 4 stops the answer, not the packet). Both now sit behind a
 * process boundary that holds no secrets.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { assertPublicUrl } from '../branding/safe-fetch';
import {
  DEFAULT_RENDER_LIMITS,
  type PipelineLogger,
  type PipelineOutcome,
} from './render-pipeline';
import { RenderWorkerClient } from './render-worker-client';

// Re-exported so existing importers (and the SSRF regression suite) keep a
// single place to reach the launcher seam, which now lives with the pipeline.
export type { BrowserLauncher } from './render-pipeline';

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

@Injectable()
export class RendererService implements OnModuleDestroy {
  private readonly logger = new Logger('Renderer');
  private inFlight = 0;
  private cache = new Map<string, RenderResult>();
  private workerMissingLogged = false;

  // Hard limits — tunable via env if Railway resources change.
  private readonly CACHE_TTL_MS = 10 * 60 * 1000;        // 10 min
  private readonly MAX_CACHE_ENTRIES = 200;              // prevent unbounded growth

  /**
   * ONE render child at a time.
   *
   * It used to be 3 concurrent Pages in a shared in-process browser, which
   * cost one browser. Three concurrent CHILDREN is three Chromium trees, and
   * a hostile page's job is to be the expensive one.
   *
   * THE MEASUREMENT (in-container proof, 2026-09-08) — the cap now has real
   * numbers behind it rather than caution:
   *   • Railway service `api`: 8 GB memory limit; 24 h steady state 0.25 GB
   *     max (`MEMORY_USAGE_GB`), CPU 0.06 of 8 vCPU.
   *   • A normal render adds ~196 MiB to the container.
   *   • A page that simply allocates took the container's ENTIRE 4 GB cgroup
   *     inside one 22 s budget. `MAX_RENDER_MEMORY_BYTES` in
   *     `render-worker-client.ts` now stops that at ~1.6 GiB.
   *
   * So two children would fit today (≈3.3 GiB of hostile renders + 0.25 GB of
   * API against an 8 GB limit) — but only because the API uses 0.25 GB, not
   * the 4 GB its own `--max-old-space-size` permits. Two hostile renders plus
   * an API at its permitted ceiling does NOT fit. The cap stays at 1: the
   * fan-out buys nothing (the 10-minute per-URL cache is what collapses a
   * 50-kiosk fleet onto one render), and doubling it doubles the memory an
   * anonymous caller can command. The cost of the cap is not an error: an
   * over-cap request returns null and the controller serves the `safeFetch`
   * path, which is what it does for every other render refusal.
   */
  private readonly MAX_CONCURRENT = 1;

  /**
   * Hard wall-clock ceiling for ONE render, enforced by SIGKILLing the
   * worker's process group. `goto`'s own timeout ends at load; the post-load
   * grace, `page.content()` on a pathological DOM, and a `page.close()` that
   * hangs on a wedged renderer all sit outside it. This is the number that
   * actually bounds a request's cost — and now it is a signal, not a promise
   * race that leaves a browser running behind it.
   */
  private readonly RENDER_BUDGET_MS = 25_000;

  /** Max rendered-HTML length handed back to the caller. */
  private readonly MAX_HTML_CHARS = DEFAULT_RENDER_LIMITS.maxHtmlChars;

  /**
   * Process-wide render ceiling. The controller's per-IP throttle (60/min)
   * bounds ONE client; a botnet or a big NAT is many clients pointing at one
   * renderer. This is the aggregate backstop.
   */
  private readonly MAX_RENDERS_PER_MINUTE = 120;
  private renderStamps: number[] = [];

  /**
   * Circuit breaker. Chromium failing (OOM, crash-loop, a missing binary) used
   * to mean every request paid the full timeout before falling back to
   * `safeFetch`, which is a self-inflicted latency amplifier under load. After
   * N consecutive failures the breaker opens and `render()` returns null
   * immediately — the caller's existing fallback path takes over — until the
   * cool-down elapses and one probe render is allowed through.
   */
  private readonly BREAKER_FAILURE_THRESHOLD = 5;
  private readonly BREAKER_COOLDOWN_MS = 60_000;
  private consecutiveFailures = 0;
  private breakerOpenedAt = 0;

  private readonly workerLogger: PipelineLogger = {
    log: (m) => this.logger.log(m),
    warn: (m) => this.logger.warn(m),
    error: (m) => this.logger.error(m),
  };

  private readonly worker = new RenderWorkerClient({
    killBudgetMs: this.RENDER_BUDGET_MS,
    logger: this.workerLogger,
  });

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

    // Admission check BEFORE we pay for a process. The worker re-runs it (and
    // runs it on every sub-request), so this is a cheap early exit, not the
    // control — but there is no reason to fork a browser for a URL we already
    // know resolves into our own network.
    try {
      await assertPublicUrl(url);
    } catch (e: any) {
      this.logger.warn(`[ssr] SSRF guard rejected url=${url.slice(0, 80)}: ${e?.message}`);
      this.noteFailure();
      return null;
    }

    this.inFlight += 1;
    this.logger.log(
      `[ssr] render start grant=${grant.kind} principal=${grant.principal} ` +
        `tenant=${grant.tenantId ?? '-'} url=${url.slice(0, 80)}`,
    );
    try {
      const outcome = await this.executeRender(url);
      if (outcome.ok) {
        this.consecutiveFailures = 0;
        const result: RenderResult = {
          html: outcome.html,
          finalUrl: outcome.finalUrl,
          renderedAt: Date.now(),
        };
        // Trim cache if oversized — drop oldest by renderedAt.
        if (this.cache.size >= this.MAX_CACHE_ENTRIES) {
          const oldest = [...this.cache.entries()]
            .sort((a, b) => a[1].renderedAt - b[1].renderedAt)
            [0];
          if (oldest) this.cache.delete(oldest[0]);
        }
        this.cache.set(url, result);
        return result;
      }
      // A worker that is not on disk is a DEPLOY problem, not a hostile page.
      // Say so once, loudly, then stop counting it against the breaker — the
      // breaker exists to stop paying for a sick browser, and there is no
      // browser to be sick.
      if (outcome.reason === 'worker-script-missing') {
        if (!this.workerMissingLogged) {
          this.workerMissingLogged = true;
          this.logger.error(
            '[ssr] render worker script is missing from this build — SSR is disabled and ' +
              'every /proxy/web request will serve the safeFetch fallback',
          );
        }
        return null;
      }
      this.noteFailure();
      this.logger.warn(`[ssr] render refused url=${url.slice(0, 80)}: ${outcome.reason}`);
      return null;
    } catch (e: any) {
      this.noteFailure();
      this.logger.warn(`[ssr] render failed url=${url.slice(0, 80)}: ${e?.message}`);
      return null;
    } finally {
      this.inFlight -= 1;
    }
  }

  /**
   * The seam between "decide whether to render" (this service: grant, cache,
   * breaker, budgets, concurrency) and "actually drive a browser" (a separate
   * process). Overridden in `renderer.ssrf.spec.ts` to drive the SAME shipped
   * pipeline in-process against a fake browser, because a Jest run has no
   * compiled `render-worker.js` to fork.
   */
  protected async executeRender(url: string): Promise<PipelineOutcome> {
    return this.worker.run(url, {
      ...DEFAULT_RENDER_LIMITS,
      maxHtmlChars: this.MAX_HTML_CHARS,
      workerBudgetMs: Math.max(1_000, this.RENDER_BUDGET_MS - 3_000),
    });
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

  async onModuleDestroy() {
    this.worker.shutdown();
  }
}
