/**
 * The one long-lived Chromium this process drives.
 *
 * A browser launch costs ~0.5–1 s, so it is kept warm and every render gets a
 * FRESH incognito context instead (no cookie, cache entry, storage row or
 * service worker survives from one board into the next). It is restarted:
 *   • after a crash / disconnect (lazily, by the next render);
 *   • every `recycleAfter` renders (slow leaks never accumulate);
 *   • when the memory watchdog trips, and after a render timeout — both KILL
 *     the process group outright rather than asking it to close.
 */
import fs from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer-core';
import { networkLockdownArgs } from './network.js';
import { clean, type Logger } from './log.js';

/** Where a Chromium usually lives when nobody said. */
export const DEFAULT_CHROMIUM_PATHS = [
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

export function resolveExecutablePath(configured: string | null): string | null {
  if (configured) return configured;
  return DEFAULT_CHROMIUM_PATHS.find((p) => fs.existsSync(p)) ?? null;
}

/**
 * Chromium flags. `--no-sandbox` is required in the container for the reason
 * apps/api/src/proxy/render-pipeline.ts measured and documents: the runtime's
 * seccomp profile denies the namespaces Chromium's sandbox needs (FATAL either
 * way without it). The isolation this service relies on is the SERVICE
 * boundary — its own container, no secrets, no network, bounded memory.
 */
export function chromiumArgs(): string[] {
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--mute-audio',
    '--hide-scrollbars',
    // Identical glyph rasterisation across hosts (Linux hinting otherwise
    // differs by fontconfig setup).
    '--font-render-hinting=none',
    // A page that allocates JS without bound dies alone, fast, instead of
    // growing until the container watchdog has to kill the whole browser.
    '--js-flags=--max-old-space-size=512',
    ...networkLockdownArgs(),
  ];
}

export interface BrowserManagerOptions {
  executablePath: string | null;
  recycleAfter: number;
  protocolTimeoutMs: number;
  logger: Logger;
}

export class BrowserManager {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private rendersSinceLaunch = 0;
  chromium: string | null = null;
  lastLaunchError: string | null = null;

  constructor(private readonly opts: BrowserManagerOptions) {}

  get executablePath(): string | null {
    return resolveExecutablePath(this.opts.executablePath);
  }

  /** A connected browser, launching one if needed. */
  async acquire(): Promise<{ browser: Browser; launchMs: number }> {
    if (this.browser && this.browser.connected) return { browser: this.browser, launchMs: 0 };
    const t0 = Date.now();
    const browser = await this.launch();
    return { browser, launchMs: Date.now() - t0 };
  }

  private launch(): Promise<Browser> {
    if (this.launching) return this.launching;
    const executablePath = this.executablePath;
    this.launching = (async () => {
      if (!executablePath) {
        throw new Error('no Chromium found — set PUPPETEER_EXECUTABLE_PATH (or CHROME_PATH)');
      }
      const browser = await puppeteer.launch({
        executablePath,
        headless: true,
        // No DevTools port: the protocol runs over a pipe, so nothing else on
        // the machine can attach to this browser.
        pipe: true,
        args: chromiumArgs(),
        // Puppeteer adds --disable-popup-blocking by default; keep Chromium's
        // popup blocker ON so a script's window.open() never opens a target.
        ignoreDefaultArgs: ['--disable-popup-blocking'],
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        protocolTimeout: this.opts.protocolTimeoutMs,
        defaultViewport: null,
        downloadBehavior: { policy: 'deny' },
      });
      browser.on('disconnected', () => {
        if (this.browser === browser) this.browser = null;
      });
      // Any target the page did not create through us (a popup that got past
      // the blocker) is closed on sight.
      browser.on('targetcreated', (target) => {
        if (target.type() !== 'page') return;
        const opener = target.opener();
        if (opener) {
          target
            .page()
            .then((p) => p?.close())
            .catch(() => undefined);
        }
      });
      this.chromium = await browser.version();
      this.browser = browser;
      this.rendersSinceLaunch = 0;
      this.lastLaunchError = null;
      this.opts.logger.info('chromium launched', { chromium: this.chromium, executablePath });
      return browser;
    })()
      .catch((e: unknown) => {
        this.lastLaunchError = clean(e);
        this.opts.logger.error('chromium launch failed', { error: this.lastLaunchError, executablePath });
        throw e;
      })
      .finally(() => {
        this.launching = null;
      });
    return this.launching;
  }

  /** Count a finished render; recycle the browser once it has done enough. */
  async noteRender(): Promise<void> {
    this.rendersSinceLaunch += 1;
    if (this.rendersSinceLaunch >= this.opts.recycleAfter) await this.close('recycle');
  }

  /** Graceful close (5 s), then a kill. */
  async close(reason: string): Promise<void> {
    const browser = this.browser;
    this.browser = null;
    if (!browser) return;
    this.opts.logger.info('chromium closing', { reason });
    const closed = browser.close().then(
      () => true,
      () => false,
    );
    const timedOut = new Promise<boolean>((r) => setTimeout(() => r(false), 5000).unref());
    if (!(await Promise.race([closed, timedOut]))) this.killProcess(browser);
  }

  /** Immediate SIGKILL of the whole Chromium process group. */
  kill(reason: string): void {
    const browser = this.browser;
    this.browser = null;
    if (!browser) return;
    this.opts.logger.warn('chromium killed', { reason });
    this.killProcess(browser);
  }

  private killProcess(browser: Browser): void {
    const proc = browser.process();
    const pid = proc?.pid;
    if (pid) {
      // Puppeteer spawns Chromium detached, so it leads its own process group
      // (render-worker-client.ts learned this the hard way): kill the group.
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* not a group leader, or gone */
      }
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* gone */
      }
    }
    browser.disconnect().catch(() => undefined);
  }

  get healthy(): boolean {
    return this.chromium !== null && this.lastLaunchError === null;
  }
}
