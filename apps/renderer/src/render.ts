/**
 * One render: a fresh incognito context, the board served from memory into a
 * page that has no network, settle, freeze, shoot, measure, encode.
 *
 * Nothing here enforces the wall clock; the server races the whole thing
 * against `renderTimeoutMs` and KILLS the browser on expiry, which makes
 * every await below reject at once.
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import sharp from 'sharp';
import type { Browser, HTTPRequest, Page } from 'puppeteer-core';
import type { BlockedRequest, RenderMetrics, RenderResponse, RenderTimings } from './contract.js';
import { RENDER_CONTRACT_VERSION, RENDER_DEFAULTS } from './contract.js';
import type { FontCatalog } from './fonts/catalog.js';
import { generateGoogleFontsCss, parseGoogleFontsUrl } from './fonts/google-css.js';
import { BOARD_CSP, BOARD_URL, routeRequest, summariseUrl } from './network.js';
import { measurePage } from './page/measure.js';
import { preloadSource, type PreloadFace } from './page/preload.js';
import type { RawPageLog, RawPageMeasure } from './page/types.js';
import { assembleMetrics, type FontRequestLog, type PlatformFont } from './metrics/assemble.js';
import { clean } from './log.js';
import type { ValidRenderRequest } from './validate.js';

export class RenderFailure extends Error {
  constructor(
    readonly code: 'render_failed' | 'browser_unavailable',
    message: string,
  ) {
    super(message);
  }
}

export interface RenderDeps {
  catalog: FontCatalog;
  preloadFaces: PreloadFace[];
}

export interface RenderOutput {
  response: Omit<RenderResponse, 'timings' | 'chromium'> & { timings: Omit<RenderTimings, 'queueMs' | 'launchMs' | 'totalMs'> };
  bytes: { png: number; image: number; thumb: number };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Font files are immutable for the life of the process; read each once. */
const fontFileCache = new Map<string, Buffer>();
function readFontFile(path: string): Buffer {
  let buf = fontFileCache.get(path);
  if (!buf) {
    buf = fs.readFileSync(path);
    fontFileCache.set(path, buf);
  }
  return buf;
}

async function probePlatformFonts(page: Page, probeAttr: string, raw: RawPageMeasure, budgetMs: number): Promise<Map<number, PlatformFont[]>> {
  const out = new Map<number, PlatformFont[]>();
  if (raw.probes.length === 0) return out;
  const textIdByProbe = new Map(raw.probes.map((p) => [p.probe, p.textId]));
  const session = await page.createCDPSession();
  const work = (async () => {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument', { depth: 0 });
    const { nodeIds } = await session.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: `[${probeAttr}]` });
    for (const nodeId of nodeIds) {
      const { attributes } = await session.send('DOM.getAttributes', { nodeId });
      const at = attributes.indexOf(probeAttr);
      const textId = at === -1 ? undefined : textIdByProbe.get(Number(attributes[at + 1]));
      if (textId === undefined) continue;
      const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
      out.set(
        textId,
        fonts.map((f) => ({ family: f.familyName, custom: f.isCustomFont, glyphs: f.glyphCount })),
      );
    }
  })();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('font probe budget exceeded')), budgetMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    work.catch(() => undefined);
    await session.detach().catch(() => undefined);
  }
  return out;
}

export async function renderBoard(browser: Browser, req: ValidRenderRequest, deps: RenderDeps): Promise<RenderOutput> {
  const timings = {
    loadMs: 0,
    fontsMs: 0,
    settleMs: 0,
    screenshotMs: 0,
    measureMs: 0,
    fontProbeMs: 0,
    analyzeMs: 0,
    encodeMs: 0,
  };
  const key = `__vosr_${randomBytes(9).toString('hex')}`;
  const probeAttr = `data-vosr-probe-${randomBytes(6).toString('hex')}`;
  const vw = Math.round(req.canvasWidth * req.viewportScale);
  const vh = Math.round(req.canvasHeight * req.viewportScale);
  // Supersample only when asked for more pixels than the viewport has.
  const dpr = req.fullWidth > vw ? Math.min(2, req.fullWidth / vw) : 1;
  const warnings: string[] = [];
  const blocked: BlockedRequest[] = [];
  const pageErrors: string[] = [];
  const fontLog: FontRequestLog = { notBundled: new Map(), rejected: [], served: new Set() };

  let context;
  try {
    context = await browser.createBrowserContext({ downloadBehavior: { policy: 'deny' } });
  } catch (e) {
    throw new RenderFailure('browser_unavailable', `could not open a browser context: ${clean(e)}`);
  }

  let png: Uint8Array;
  let raw: RawPageMeasure;
  let log: RawPageLog;
  let platformFonts: Map<number, PlatformFont[]> | null = null;
  try {
    const page = await context.newPage();
    // A renderer crash rejects whatever step is running instead of hanging it.
    let onCrash: (e: Error) => void = () => undefined;
    const crashed = new Promise<never>((_, reject) => {
      onCrash = (e) => reject(new RenderFailure('render_failed', `the page crashed: ${clean(e)}`));
    });
    crashed.catch(() => undefined);
    page.once('error', (e) => onCrash(e));
    const step = <T>(p: Promise<T>): Promise<T> => Promise.race([p, crashed]);

    page.on('pageerror', (e: unknown) => {
      if (pageErrors.length < 20) pageErrors.push(clean(e, 200));
    });

    let documentServed = false;
    // Requests Chromium makes on its own behalf are blocked like any other but
    // are not the board's doing, so they stay out of blockedRequests: the
    // automatic /favicon.ico fetch, and — once measurement is over — the
    // DevTools CSS agent re-reading the document for the font probe.
    let recording = true;
    const report = (b: BlockedRequest) => {
      if (recording && b.url !== summariseUrl(`${BOARD_URL}favicon.ico`)) blocked.push(b);
    };
    const onRequest = (request: HTTPRequest) => {
      if (request.isInterceptResolutionHandled()) return;
      const url = request.url();
      let isMainFrame = false;
      try {
        isMainFrame = request.frame() === page.mainFrame();
      } catch {
        isMainFrame = false;
      }
      const decision = routeRequest(
        { url, resourceType: request.resourceType(), isNavigation: request.isNavigationRequest(), isMainFrame, documentServed },
        deps.catalog,
      );
      const settle = (p: Promise<void>) => p.catch(() => undefined);
      switch (decision.action) {
        case 'document':
          documentServed = true;
          void settle(
            request.respond({
              status: 200,
              contentType: 'text/html; charset=utf-8',
              headers: { 'content-security-policy': BOARD_CSP, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
              body: req.html,
            }),
          );
          return;
        case 'allow':
          void settle(request.continue());
          return;
        case 'google-css': {
          const parsed = parseGoogleFontsUrl(decision.url);
          const generated = parsed ? generateGoogleFontsCss(parsed, deps.catalog) : null;
          if (generated) {
            for (const f of generated.notBundled) fontLog.notBundled.set(f.toLowerCase(), decision.url);
            for (const r of generated.invalid) fontLog.rejected.push(r);
            for (const f of generated.served) fontLog.served.add(f.toLowerCase());
          }
          void settle(
            request.respond({
              status: generated?.status ?? 400,
              contentType: generated?.status === 200 ? 'text/css; charset=utf-8' : 'text/plain; charset=utf-8',
              headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
              body: generated?.status === 200 ? generated.css : 'Invalid selector',
            }),
          );
          return;
        }
        case 'font-file': {
          let body: Buffer | null = null;
          try {
            body = readFontFile(decision.path);
          } catch {
            body = null;
          }
          if (!body) {
            report({ url: summariseUrl(url), type: 'font', reason: 'font' });
            void settle(request.abort('blockedbyclient'));
            return;
          }
          void settle(
            request.respond({
              status: 200,
              contentType: 'font/woff2',
              headers: { 'access-control-allow-origin': '*', 'cache-control': 'max-age=31536000' },
              body,
            }),
          );
          return;
        }
        case 'cancel-navigation':
          // 204 cancels a navigation without committing an error page, so the
          // board stays exactly where it was.
          report({ url: summariseUrl(url), type: 'document', reason: 'navigation' });
          void settle(request.respond({ status: 204, contentType: 'text/plain', headers: {}, body: '' }));
          return;
        case 'block':
        default:
          report({ url: summariseUrl(url), type: request.resourceType(), reason: decision.action === 'block' ? decision.reason : 'network' });
          void settle(request.abort('blockedbyclient'));
      }
    };

    await step(page.setBypassServiceWorker(true));
    await step(page.setViewport({ width: vw, height: vh, deviceScaleFactor: dpr }));
    await step(page.evaluateOnNewDocument(preloadSource(key, deps.preloadFaces)));
    await step(page.setRequestInterception(true));
    page.on('request', onRequest);

    let t = Date.now();
    await step(page.goto(BOARD_URL, { waitUntil: 'load', timeout: 20_000 }));
    timings.loadMs = Date.now() - t;

    t = Date.now();
    const fontsStatus = await step(
      Promise.race([
        page.evaluate(() => document.fonts.ready.then(() => document.fonts.status)),
        sleep(3000).then(() => 'timeout'),
      ]),
    );
    if (fontsStatus === 'timeout') warnings.push('document.fonts.ready did not settle within 3 s');
    timings.fontsMs = Date.now() - t;

    t = Date.now();
    await step(sleep(req.settleMs));
    timings.settleMs = Date.now() - t;

    // Freeze, then let two real frames paint the frozen state.
    const frozenAnimations = await step(
      page.evaluate((k: string) => (window as unknown as Record<string, { freeze(): number }>)[k]?.freeze() ?? -1, key),
    );
    if (frozenAnimations === -1) warnings.push('the freeze hook was missing — the page may have replaced its own window');
    await step(
      page.evaluate(
        (k: string) =>
          new Promise<void>((resolve) => {
            const hooks = (window as unknown as Record<string, { nativeRaf?: (cb: () => void) => number } | undefined>)[k];
            const raf = hooks?.nativeRaf ?? requestAnimationFrame;
            raf.call(window, () => raf.call(window, () => resolve()));
          }),
        key,
      ),
    );

    t = Date.now();
    png = await step(page.screenshot({ type: 'png', optimizeForSpeed: true }));
    timings.screenshotMs = Date.now() - t;

    t = Date.now();
    raw = await step(page.evaluate(measurePage, { key, probeAttr, maxTexts: 1500, maxImages: 120, imageTimeoutMs: 2500 }));
    log = await step(
      page.evaluate((k: string) => {
        const hooks = (window as unknown as Record<string, { state: { csp: Array<{ uri: string; directive: string }>; popups: string[]; frozenAnimations: number } } | undefined>)[k];
        return hooks
          ? { csp: hooks.state.csp.slice(0, 200), popups: hooks.state.popups.slice(0, 50), frozenAnimations: hooks.state.frozenAnimations }
          : { csp: [], popups: [], frozenAnimations: 0 };
      }, key),
    );
    timings.measureMs = Date.now() - t;
    recording = false;

    t = Date.now();
    try {
      platformFonts = await step(probePlatformFonts(page, probeAttr, raw, 3000));
    } catch (e) {
      if (e instanceof RenderFailure) throw e;
      warnings.push(`platform-font probe skipped: ${clean(e, 120)}`);
      platformFonts = null;
    }
    timings.fontProbeMs = Date.now() - t;
  } catch (e) {
    if (e instanceof RenderFailure) throw e;
    throw new RenderFailure('render_failed', clean(e));
  } finally {
    // A context whose renderer is wedged can refuse to close; the server's
    // timeout kills the whole browser in that case.
    await Promise.race([context.close().catch(() => undefined), sleep(5000)]);
  }

  // ── Node-side: decode, analyse, encode (all off the browser) ────────────
  let t = Date.now();
  const decoded = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const metrics: RenderMetrics = assembleMetrics({
    raw,
    log,
    canvasWidth: req.canvasWidth,
    canvasHeight: req.canvasHeight,
    viewportScale: req.viewportScale,
    image: { data: decoded.data, width: decoded.info.width, height: decoded.info.height, channels: decoded.info.channels },
    dpr,
    blocked,
    fontRequests: fontLog,
    platformFonts,
    substitutes: new Map([...deps.catalog.substitutes].map(([k, v]) => [k, v.family])),
    pageErrors,
    warnings,
  });
  timings.analyzeMs = Date.now() - t;

  t = Date.now();
  const [full, thumb] = await Promise.all([
    sharp(png).resize({ width: req.fullWidth }).webp({ quality: RENDER_DEFAULTS.webpQuality }).toBuffer({ resolveWithObject: true }),
    sharp(png).resize({ width: RENDER_DEFAULTS.thumbWidth }).webp({ quality: RENDER_DEFAULTS.thumbQuality }).toBuffer({ resolveWithObject: true }),
  ]);
  timings.encodeMs = Date.now() - t;

  return {
    response: {
      contractVersion: RENDER_CONTRACT_VERSION,
      image: full.data.toString('base64'),
      imageWidth: full.info.width,
      imageHeight: full.info.height,
      thumb: thumb.data.toString('base64'),
      thumbWidth: thumb.info.width,
      thumbHeight: thumb.info.height,
      metrics,
      timings,
    },
    bytes: { png: png.byteLength, image: full.data.byteLength, thumb: thumb.data.byteLength },
  };
}
