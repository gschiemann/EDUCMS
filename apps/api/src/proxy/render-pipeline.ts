/**
 * SEC-006 — the actual Chromium render, extracted from `RendererService` so it
 * can run in a DISPOSABLE CHILD PROCESS (`render-worker.ts`) instead of inside
 * the NestJS API process that owns emergency delivery.
 *
 * Nothing was weakened in the move. Every guard the 2026-09-04 wave added is
 * here, byte for byte:
 *
 *   • DNS-aware admission on the top URL AND on every sub-request, with a
 *     per-host verdict cache (TTL-bounded) and a bounded, fail-closed resolver.
 *   • Connected-peer verification — `remoteAddress()` on every response; one
 *     private peer POISONS the render and nothing is returned.
 *   • Exposure bounds: request cap, declared-byte cap, HTML size cap,
 *     navigation timeout, whole-job budget.
 *   • Final-URL re-validation after redirects.
 *
 * What the move ADDS is the thing the code comment used to call a known gap:
 * the browser is no longer in the API's address space, so a Chromium renderer
 * exploit lands in a process that holds no secrets, no DB handle, no Redis
 * connection and no WebSocket gateway — and whose death is one failed render.
 *
 * This module imports ONLY `puppeteer-core` types, `safe-fetch` (node builtins
 * only) and the protocol. It must never grow a Nest, Prisma or Redis import:
 * that is what keeps the child's module graph free of the API's connections.
 */
import type { Browser, Page, PuppeteerLaunchOptions } from 'puppeteer-core';
import { assertPublicUrl, validatePublicUrl, isPrivateIp, SsrfError } from '../branding/safe-fetch';
import type { RenderJobLimits } from './render-worker-protocol';

/**
 * The one thing the pipeline needs out of puppeteer-core.
 *
 * A narrow interface (rather than the module) so the guards can be exercised
 * against a fake browser in `renderer.ssrf.spec.ts`. `await import()` under
 * `module: nodenext` emits a REAL dynamic import, which `jest.mock` cannot
 * intercept without `--experimental-vm-modules` — hence a seam, not a mock.
 */
export interface BrowserLauncher {
  launch(options: PuppeteerLaunchOptions): Promise<Browser>;
}

export interface PipelineLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export type PipelineOutcome =
  | { ok: true; html: string; finalUrl: string; requests: number; elapsedMs: number }
  | { ok: false; reason: string };

export interface RenderPipelineInput {
  launcher: BrowserLauncher;
  url: string;
  executablePath: string;
  /** Throwaway Chromium profile directory, owned by the parent process. */
  userDataDir?: string;
  limits: RenderJobLimits;
  logger: PipelineLogger;
  /**
   * Called the instant the browser process exists, with its pid.
   *
   * The worker uses this to tell the parent which process group to kill.
   * `@puppeteer/browsers` spawns Chromium with `detached: true` on non-Windows,
   * so the browser is its OWN group leader and is NOT reached by killing the
   * worker's group — proved by running the kill path against a real browser in
   * the shipped image, which left 11 Chromium processes alive.
   */
  onBrowserLaunched?: (pid: number) => void;
}

/** Default bounds. The service passes these through to the worker verbatim. */
export const DEFAULT_RENDER_LIMITS: RenderJobLimits = {
  navigationTimeoutMs: 15_000,
  postLoadGraceMs: 2_000,
  /**
   * The child's own ceiling. Deliberately BELOW the parent's 25s SIGKILL so a
   * wedged render normally reports a reason and exits, and the kill is the
   * backstop rather than the mechanism.
   */
  workerBudgetMs: 22_000,
  maxHtmlChars: 8 * 1024 * 1024,
  maxResponseBytes: 24 * 1024 * 1024,
  maxRequestsPerRender: 300,
  hostVerdictTtlMs: 10_000,
  dnsVerdictTimeoutMs: 4_000,
};

/**
 * Chromium flags for a render that runs in its OWN process.
 *
 * ── WHY `--no-sandbox` IS STILL HERE, WITH EVIDENCE (2026-09-05) ──────────
 * Measured inside the shipped runtime image (`edu-cms` runner stage,
 * `node:20-alpine`, `USER node`, Chromium 149).
 *
 * RE-MEASURED 2026-09-08 on the Node-22 base image (`node:22-alpine`,
 * Alpine 3.24.1, Chromium 152, `USER node`, linux/arm64 under Docker
 * Desktop): probes A, B and C below reproduce IDENTICALLY — same exit codes,
 * same FATAL strings, same CapEff/Seccomp, and the SUID helper is still
 * present. The base-image bump therefore changes nothing about this verdict.
 * The `seccomp=unconfined` control was NOT re-confirmed on that host (it
 * failed there on an unrelated missing dbus socket, not on namespaces), so
 * treat that one line as still resting on the 2026-09-05 Linux measurement.
 *
 * Original measurement:
 *
 *   CapEff: 0000000000000000        (no capabilities at all)
 *   Seccomp: 2, Seccomp_filters: 1  (Docker's default profile, active)
 *   /usr/lib/chromium/chrome-sandbox  -rwsr-xr-x root root   (SUID helper IS
 *                                     present — the previous comment in
 *                                     renderer.service.ts said it was not)
 *
 *   chromium --headless=new (SUID sandbox)   → FATAL "Failed to move to new
 *       namespace: PID namespaces supported, Network namespace supported, but
 *       failed: errno = Operation not permitted"           exit 134
 *   chromium --disable-setuid-sandbox        → FATAL "No usable sandbox!"
 *       (unprivileged user namespaces denied)               exit 134
 *   chromium --no-sandbox                    → renders                exit 0
 *
 * Re-running the identical probe with `--security-opt seccomp=unconfined`
 * makes BOTH sandbox modes succeed (exit 0). So the blocker is not Alpine and
 * not the missing SUID helper: it is the container's seccomp profile denying
 * `clone`/`unshare` with `CLONE_NEW*`, which needs a runtime flag Railway does
 * not expose per service. Until that changes, `--no-sandbox` stays — and the
 * process boundary this file exists to create is what carries the isolation.
 *
 * ── WHAT DID CHANGE ──────────────────────────────────────────────────────
 * `--single-process` and `--no-zygote` are GONE. They existed to shave memory
 * inside the API process, and they did it by collapsing Chromium's renderer —
 * the component that parses the hostile HTML — into the same process as the
 * browser's network and IPC layer. With Chromium now alone in a disposable
 * child, that trade is pure loss: multi-process is measurably fine here
 * (probe C above, exit 0) and restores a real boundary between the HTML parser
 * and everything else.
 */
export function buildChromiumLaunchArgs(userDataDir?: string): string[] {
  const args = [
    // See the block comment above: proven unavoidable in this container, and
    // no longer the only thing standing between a renderer exploit and the
    // emergency bus.
    '--no-sandbox',
    '--disable-setuid-sandbox',
    // Docker's default /dev/shm is 64 MB; Chromium falls over without this.
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--disable-gpu',
    // Nothing in a signage snapshot needs extensions, the component updater,
    // crash upload, or Chromium's own background network traffic.
    '--disable-extensions',
    '--disable-component-update',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-breakpad',
    '--no-default-browser-check',
    '--mute-audio',
    // NOTE: `--ignore-certificate-errors` was REMOVED (SEC-006, 2026-09-04).
    // It made this browser accept any certificate — including one presented
    // by whatever a rebound/hijacked name resolved to — which is the opposite
    // of what a TOCTOU-sensitive fetcher wants. `safeFetch` (the fallback)
    // uses default verification, so no site the product could otherwise serve
    // is lost.
    '--enable-features=NetworkService,NetworkServiceInProcess',
  ];
  // A fresh profile per render, destroyed by the parent afterwards: no cookie,
  // cache entry, localStorage row or service worker survives one hostile page
  // into the next render.
  if (userDataDir) args.push(`--user-data-dir=${userDataDir}`);
  return args;
}

/** Race `work` against a hard deadline, without holding the event loop open. */
async function withDeadline<T>(work: Promise<T>, ms: number, reason: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(reason)), ms);
        if (typeof timer.unref === 'function') timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Render one URL and return the hydrated HTML, or a refusal reason.
 *
 * Never throws for a render problem — a refusal is a value, because the caller
 * (ultimately `/api/v1/proxy/web`) must DEGRADE to `safeFetch`, never fail.
 */
export async function runRenderPipeline(input: RenderPipelineInput): Promise<PipelineOutcome> {
  const { launcher, url, executablePath, userDataDir, limits, logger, onBrowserLaunched } = input;

  // SSRF guard on the top URL, before a browser exists. `/proxy/web` takes a
  // caller-supplied URL and this drives a real browser at it — without this,
  // `?url=http://169.254.169.254/latest/meta-data/` would read cloud metadata
  // from inside the container and return the body.
  try {
    await assertPublicUrl(url);
  } catch (e: any) {
    logger.warn(`[ssr] SSRF guard rejected url=${url.slice(0, 80)}: ${e?.message}`);
    return { ok: false, reason: 'ssrf-guard-rejected-url' };
  }

  let browser: Browser | null = null;
  let page: Page | null = null;
  const start = Date.now();
  try {
    browser = await launcher.launch({
      headless: true,
      executablePath,
      args: buildChromiumLaunchArgs(userDataDir),
    });
  } catch (e: any) {
    logger.error(`[ssr] browser launch failed: ${e?.message}`);
    return { ok: false, reason: 'browser-launch-failed' };
  }

  // Report the browser pid BEFORE the first navigation, so the parent can
  // reach it even if this process is killed a moment later. `process()` is a
  // no-op on the fake launcher the guard suite uses.
  try {
    const browserPid = browser.process?.()?.pid;
    if (typeof browserPid === 'number' && onBrowserLaunched) onBrowserLaunched(browserPid);
  } catch {
    /* a launcher without a real child process */
  }

  // ── A DEAD BROWSER MUST NOT COST THE WHOLE BUDGET (2026-09-08) ─────────
  // Found by the in-container proof: SIGKILLing Chromium mid-render did NOT
  // reject `page.goto`'s `networkidle2` wait. The render sat there until the
  // worker's 22 s budget expired, and because the service allows exactly ONE
  // render child, every other `/proxy/web` request degraded to `safeFetch`
  // for those 22 seconds. Nothing unsafe — but a crashed browser should cost
  // one render immediately, not a budget.
  //
  // So the browser's own `disconnected` event races every await below. The
  // flag makes the DELIBERATE close in `finally` a non-event; only an
  // unexpected disconnect (crash, OOM-kill, our parent's SIGKILL landing on
  // the browser group) settles the race.
  let closingOnPurpose = false;
  let signalDisconnect: ((e: Error) => void) | null = null;
  const disconnected = new Promise<never>((_, reject) => {
    signalDisconnect = reject;
  });
  // Nothing awaits it on the happy path, and an un-awaited rejected promise
  // would take the worker down through `unhandledRejection`.
  disconnected.catch(() => {
    /* observed at each race site */
  });
  const raceDisconnect = <T>(work: Promise<T>): Promise<T> =>
    Promise.race([work, disconnected]);
  try {
    // Guarded: the guard-suite's fake launcher returns a minimal object.
    (browser as unknown as { on?: (e: string, f: () => void) => void }).on?.(
      'disconnected',
      () => {
        if (closingOnPurpose) return;
        signalDisconnect?.(new Error('browser-disconnected'));
      },
    );
  } catch {
    /* a launcher without an event emitter */
  }

  try {
    page = await browser.newPage();
    await page.setUserAgent(
      // Some sites block headless-Chrome outright. We do not need to beat
      // aggressive bot detection for school marketing sites, but the spoof
      // helps, and it names us so a site owner can identify the traffic.
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 EduCmsRenderer/1.0',
    );
    await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);

    // SSRF-01 (2026-08-04) — per-render DNS verdict cache, given a TTL by
    // SEC-006 and applied to EVERY request rather than navigations only.
    //
    // Caching per HOST makes the added cost one lookup per distinct host per
    // TTL for the whole render, not one per request — which is what made the
    // original "too slow for sub-resources" argument moot. Stores the PROMISE
    // so N concurrent requests to one host await a single in-flight lookup.
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
      if (cached && now - cached.at < limits.hostVerdictTtlMs) return cached.verdict;
      // Bounded: a resolver that hangs must not hold a paused request open for
      // the whole budget, and a resolution we cannot complete is a REFUSAL,
      // never a pass (fail closed).
      const verdict = withDeadline(
        assertPublicUrl(rawUrl),
        limits.dnsVerdictTimeoutMs,
        'dns verdict timed out',
      ).catch((e: unknown) => {
        throw e instanceof SsrfError ? e : new SsrfError(`DNS verdict unavailable for ${host}`);
      });
      // Swallow here so an early rejection cannot surface as an unhandled
      // rejection; every consumer still awaits and handles it below.
      verdict.catch(() => {
        /* handled at the await site */
      });
      hostVerdicts.set(host, { at: now, verdict });
      return verdict;
    };

    // A render is POISONED the moment we learn it touched something it must
    // not have. A poisoned render returns NOTHING: whatever HTML exists may
    // embed data read off an internal service, so the only safe move is to
    // discard it all and let the caller's `safeFetch` fallback answer.
    let poisoned: string | null = null;
    const poison = (reason: string) => {
      if (!poisoned) {
        poisoned = reason;
        logger.error(`[ssr] render poisoned url=${url.slice(0, 80)}: ${reason}`);
      }
    };

    let requestsSeen = 0;
    let declaredBytes = 0;

    page.on('request', async (req) => {
      const t = req.resourceType();
      if (t === 'media' || t === 'websocket' || t === 'eventsource') {
        req.abort().catch(() => {
          /* request already gone */
        });
        return;
      }
      // Subrequest amplification cap. A hostile page can emit thousands of
      // requests through our container; past this ceiling the render is
      // poisoned and every further request is refused.
      requestsSeen += 1;
      if (requestsSeen > limits.maxRequestsPerRender) {
        poison(`request cap exceeded (${requestsSeen})`);
        req.abort().catch(() => {
          /* request already gone */
        });
        return;
      }

      // ── THE SUBRESOURCE HOLE (closed 2026-09-04) ──────────────────────
      // This guard used to run the DNS-resolving `assertPublicUrl` on
      // NAVIGATIONS ONLY. `validatePublicUrl` alone only inspects an IP
      // LITERAL, so `internal.attacker.example` with an A record on 10.0.0.5 /
      // 127.0.0.1 / 169.254.169.254 passed it and Chromium CONNECTED — as an
      // <img>, <script>, fetch() or form target. And "a sub-resource does not
      // become the document" is not the whole threat: a script on the
      // attacker's page can read or merely time an internal response and
      // exfiltrate it, and the DOM it wrote IS returned to the caller.
      try {
        validatePublicUrl(req.url());
        await assertHostIsPublic(req.url());
      } catch (e) {
        if (e instanceof SsrfError) {
          logger.warn(`[ssr] blocked sub-request ${req.url().slice(0, 80)}: ${e.message}`);
          req.abort().catch(() => {
            /* request already gone */
          });
          return;
        }
        // Fail CLOSED. Both guards throw only SsrfError, so anything else is a
        // fault in the guard itself — aborting one request is strictly safer
        // than letting an unvetted request proceed.
        logger.warn(`[ssr] guard fault on ${req.url().slice(0, 80)} — aborting`);
        req.abort().catch(() => {
          /* request already gone */
        });
        return;
      }
      req.continue().catch(() => {
        /* request already gone */
      });
    });

    // ── CONNECTED-PEER VERIFICATION (anti-rebinding) ───────────────────
    // Every check above resolves DNS in THIS process; Chromium resolves again
    // in its own network service when it opens the socket. Two lookups, so a
    // low-TTL record can answer public for ours and private for Chromium's —
    // and request interception cannot pin the socket the way `safeFetch` pins
    // its `lookup`. What we CAN do is verify the address Chromium actually
    // connected to. One private peer poisons the render, so a rebind cannot
    // become a read primitive even though the packet was sent.
    page.on('response', (res) => {
      try {
        const peer = res.remoteAddress?.();
        const ip = peer && typeof peer.ip === 'string' ? peer.ip : '';
        const bare = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
        if (bare && isPrivateIp(bare)) {
          poison(`connected to private peer ${bare} for ${res.url().slice(0, 80)}`);
        }
        const len = Number(res.headers()['content-length']);
        if (Number.isFinite(len) && len > 0) {
          declaredBytes += len;
          if (declaredBytes > limits.maxResponseBytes) {
            poison(`declared response bytes exceeded (${declaredBytes})`);
          }
        }
      } catch {
        /* a response object can be gone by the time we inspect it */
      }
    });

    // networkidle2 = ≤2 in-flight requests for 500ms. Beats networkidle0
    // because many sites have long-running analytics pings.
    await raceDisconnect(
      page.goto(url, { waitUntil: 'networkidle2', timeout: limits.navigationTimeoutMs }),
    );

    // Grace period after networkidle for anything scheduled with
    // setTimeout(0) post-load. Most AJAX banner injections land inside it.
    await raceDisconnect(new Promise<void>((r) => setTimeout(r, limits.postLoadGraceMs)));

    if (poisoned) {
      logger.warn(`[ssr] discarding poisoned render url=${url.slice(0, 80)}: ${poisoned}`);
      return { ok: false, reason: 'poisoned' };
    }

    const html = await raceDisconnect(page.content());
    const finalUrl = page.url();

    // `goto` follows redirects and in-page navigations; the URL validated on
    // the way in is not necessarily the one that produced this DOM.
    try {
      await assertHostIsPublic(finalUrl);
    } catch (e: any) {
      logger.warn(
        `[ssr] final URL failed the SSRF guard (${finalUrl.slice(0, 80)}): ${e?.message}`,
      );
      return { ok: false, reason: 'final-url-rejected' };
    }

    if (html.length > limits.maxHtmlChars) {
      logger.warn(
        `[ssr] rendered HTML ${html.length}B over cap ${limits.maxHtmlChars}B url=${url.slice(0, 80)}`,
      );
      return { ok: false, reason: 'html-over-cap' };
    }

    // A peer/size verdict can land during `page.content()` — re-check.
    if (poisoned) {
      logger.warn(`[ssr] discarding poisoned render url=${url.slice(0, 80)}: ${poisoned}`);
      return { ok: false, reason: 'poisoned' };
    }

    const elapsedMs = Date.now() - start;
    logger.log(
      `[ssr] rendered url=${url.slice(0, 80)} in ${elapsedMs}ms ` +
        `bytes=${html.length} requests=${requestsSeen} finalUrl=${finalUrl.slice(0, 80)}`,
    );
    return { ok: true, html, finalUrl, requests: requestsSeen, elapsedMs };
  } catch (e: any) {
    if (e?.message === 'browser-disconnected') {
      logger.warn(`[ssr] browser died mid-render url=${url.slice(0, 80)}`);
      return { ok: false, reason: 'browser-crashed' };
    }
    logger.warn(`[ssr] page error url=${url.slice(0, 80)}: ${e?.message}`);
    return { ok: false, reason: 'page-error' };
  } finally {
    closingOnPurpose = true;
    if (page) {
      try {
        await page.close();
      } catch {
        /* tolerated */
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* tolerated */
      }
    }
  }
}
