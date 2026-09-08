/**
 * SEC-006 — a DEAD BROWSER ends the render immediately.
 *
 * Found by the in-container proof (2026-09-08), not by reasoning: SIGKILLing
 * Chromium mid-render did NOT reject `page.goto`'s `networkidle2` wait. The
 * render sat there until the worker's whole budget expired. Nothing unsafe —
 * the parent's wall-clock kill and the child's own budget both still fired,
 * and the request degraded to `safeFetch` exactly as designed — but because
 * `RendererService.MAX_CONCURRENT` is 1, a crashed browser held the only
 * render slot for ~22 seconds, so every other `/proxy/web` request in that
 * window degraded too.
 *
 * The fix races the browser's own `disconnected` event against every await.
 * These tests pin BOTH halves of it: the crash settles fast, and a NORMAL
 * close (which also emits `disconnected`) does not turn a good render into a
 * failure.
 *
 * The URL is an IP literal on purpose — `assertPublicUrl` skips DNS for a
 * literal, so this suite needs no resolver mock.
 */
import type { Browser } from 'puppeteer-core';
import { DEFAULT_RENDER_LIMITS, runRenderPipeline, type BrowserLauncher } from './render-pipeline';

const PUBLIC_URL = 'http://93.184.216.34/';
const silent = { log: () => {}, warn: () => {}, error: () => {} };

/** A page whose `goto` never settles, standing in for a wedged navigation. */
function neverSettlingPage() {
  return {
    setUserAgent: async () => undefined,
    setViewport: async () => undefined,
    setRequestInterception: async () => undefined,
    on: () => undefined,
    goto: () => new Promise<never>(() => {}),
    content: async () => '<html></html>',
    url: () => PUBLIC_URL,
    close: async () => undefined,
  };
}

function fakeBrowser(page: unknown) {
  const listeners = new Map<string, () => void>();
  return {
    browser: {
      newPage: async () => page,
      close: async () => undefined,
      process: () => null,
      on: (event: string, fn: () => void) => {
        listeners.set(event, fn);
      },
    } as unknown as Browser,
    emit: (event: string) => listeners.get(event)?.(),
  };
}

describe('runRenderPipeline — the browser dying is a prompt refusal', () => {
  it('refuses with browser-crashed the moment Chromium disconnects mid-navigation', async () => {
    const { browser, emit } = fakeBrowser(neverSettlingPage());
    const launcher: BrowserLauncher = { launch: async () => browser };

    const started = Date.now();
    const outcome = runRenderPipeline({
      launcher,
      url: PUBLIC_URL,
      executablePath: '/usr/bin/chromium-browser',
      limits: DEFAULT_RENDER_LIMITS,
      logger: silent,
    });
    // Let the pipeline reach its `goto` await, then kill the browser.
    await new Promise((r) => setTimeout(r, 25));
    emit('disconnected');

    const result = await outcome;
    expect(result).toEqual({ ok: false, reason: 'browser-crashed' });
    // The point of the fix: it does NOT wait out the 15s navigation timeout
    // or the 22s worker budget. The bound is deliberately loose (a loaded CI
    // runner is not a stopwatch) — it only has to exclude those two.
    expect(Date.now() - started).toBeLessThan(8_000);
  }, 10_000);

  it('does NOT turn a successful render into a failure when we close on purpose', async () => {
    // `browser.close()` in the pipeline's `finally` also emits `disconnected`.
    // If that counted, every good render would come back as a crash.
    const page = {
      setUserAgent: async () => undefined,
      setViewport: async () => undefined,
      setRequestInterception: async () => undefined,
      on: () => undefined,
      goto: async () => undefined,
      content: async () => '<html><body>hydrated</body></html>',
      url: () => PUBLIC_URL,
      close: async () => undefined,
    };
    const holder: { emit?: (e: string) => void } = {};
    const listeners = new Map<string, () => void>();
    const browser = {
      newPage: async () => page,
      close: async () => {
        listeners.get('disconnected')?.();
      },
      process: () => null,
      on: (event: string, fn: () => void) => {
        listeners.set(event, fn);
      },
    } as unknown as Browser;
    holder.emit = (e) => listeners.get(e)?.();
    const launcher: BrowserLauncher = { launch: async () => browser };

    const result = await runRenderPipeline({
      launcher,
      url: PUBLIC_URL,
      executablePath: '/usr/bin/chromium-browser',
      limits: { ...DEFAULT_RENDER_LIMITS, postLoadGraceMs: 1 },
      logger: silent,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html).toContain('hydrated');
  }, 10_000);

  it('survives a launcher whose browser has no event emitter at all', async () => {
    // The SSRF guard suite drives the pipeline with a minimal fake. A missing
    // `on` must not become a render failure.
    const page = {
      setUserAgent: async () => undefined,
      setViewport: async () => undefined,
      setRequestInterception: async () => undefined,
      on: () => undefined,
      goto: async () => undefined,
      content: async () => '<html><body>ok</body></html>',
      url: () => PUBLIC_URL,
      close: async () => undefined,
    };
    const launcher: BrowserLauncher = {
      launch: async () =>
        ({ newPage: async () => page, close: async () => undefined }) as unknown as Browser,
    };

    const result = await runRenderPipeline({
      launcher,
      url: PUBLIC_URL,
      executablePath: '/usr/bin/chromium-browser',
      limits: { ...DEFAULT_RENDER_LIMITS, postLoadGraceMs: 1 },
      logger: silent,
    });

    expect(result.ok).toBe(true);
  }, 10_000);
});
