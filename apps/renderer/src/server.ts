/**
 * The HTTP surface: `GET /health` and `POST /render`, on node:http, nothing
 * else. Private network only — see README.md.
 *
 *   413  body over the cap (checked on Content-Length AND while streaming)
 *   415  not application/json
 *   400  not JSON / not a valid render request
 *   429  one render running and the line behind it full (Retry-After: 5)
 *   504  the render ran past its wall clock (Chromium is killed and restarted)
 *   503  Chromium unavailable, or the memory watchdog killed it mid-render
 *   500  the page crashed / anything else
 */
import http from 'node:http';
import {
  RENDER_CONTRACT_VERSION,
  RENDER_ERROR_STATUS,
  type HealthResponse,
  type RenderErrorCode,
  type RenderResponse,
} from './contract.js';
import type { RendererConfig } from './config.js';
import type { BrowserManager } from './browser.js';
import { RenderGate } from './queue.js';
import { renderBoard, RenderFailure, type RenderDeps } from './render.js';
import { validateRenderRequest } from './validate.js';
import { clean, type Logger } from './log.js';
import { cgroupMemoryUsage } from './memory.js';

export interface ServerOptions {
  config: RendererConfig;
  browsers: BrowserManager;
  deps: RenderDeps;
  logger: Logger;
  /** Kill Chromium when the container's memory charge passes this (null = no watchdog). */
  memoryLimitBytes: number | null;
  /** Override the memory meter (tests). */
  readMemory?: () => number | null;
}

export interface RendererServer {
  server: http.Server;
  gate: RenderGate;
  /** Stop taking work, let the render in flight finish (≤ graceMs), close Chromium. */
  shutdown(graceMs?: number): Promise<void>;
}

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function sendJson(res: http.ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  const payload = JSON.stringify(body);
  res.writeHead(status, { ...JSON_HEADERS, 'content-length': Buffer.byteLength(payload), ...extra });
  res.end(payload);
}

function sendError(res: http.ServerResponse, code: RenderErrorCode, message: string, extra: Record<string, string> = {}): void {
  sendJson(res, RENDER_ERROR_STATUS[code], { contractVersion: RENDER_CONTRACT_VERSION, error: code, message }, extra);
}

class BodyTooLarge extends Error {}

/** Past the cap, how much more we will drain (and for how long) so the client can read its 413. */
const DRAIN_MAX_BYTES = 32 * 1024 * 1024;
const DRAIN_MAX_MS = 10_000;

/**
 * Read the body. Past `max` bytes nothing more is kept: the rest is drained
 * and discarded — bounded in bytes and in time — and only then is the caller
 * told it is too large. Answering 413 while the client is still mid-upload
 * gets the connection reset under it (EPIPE) before it ever reads the answer;
 * a client that keeps streaming past the drain bound is simply cut off.
 */
function readBody(req: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    let done = false;
    let drainTimer: NodeJS.Timeout | undefined;
    const finish = (err: Error | null, value?: Buffer) => {
      if (done) return;
      done = true;
      if (drainTimer) clearTimeout(drainTimer);
      if (err) reject(err);
      else resolve(value as Buffer);
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (!over && size > max) {
        over = true;
        chunks.length = 0;
        drainTimer = setTimeout(() => {
          req.destroy();
          finish(new BodyTooLarge());
        }, DRAIN_MAX_MS);
        drainTimer.unref();
      }
      if (over) {
        if (size > max + DRAIN_MAX_BYTES) {
          req.destroy();
          finish(new BodyTooLarge());
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(over ? new BodyTooLarge() : null, Buffer.concat(chunks)));
    req.on('error', (e) => finish(e));
  });
}

export function createRendererServer(opts: ServerOptions): RendererServer {
  const { config, browsers, deps, logger } = opts;
  const gate = new RenderGate(config.queueMax);
  const readMemory = opts.readMemory ?? cgroupMemoryUsage;
  const started = Date.now();
  let rendersServed = 0;
  let shuttingDown = false;
  let current: Promise<unknown> | null = null;
  let memoryKillDuringRender = false;
  let renderInFlight = false;

  // ── memory watchdog ──────────────────────────────────────────────────────
  let watchdog: NodeJS.Timeout | null = null;
  if (opts.memoryLimitBytes !== null) {
    const limit = opts.memoryLimitBytes;
    watchdog = setInterval(() => {
      const used = readMemory();
      if (used === null || used <= limit) return;
      if (renderInFlight) memoryKillDuringRender = true;
      if (browsers.kill('memory-limit')) {
        logger.warn('memory watchdog: over limit — chromium killed', {
          usedMb: Math.round(used / 1048576),
          limitMb: Math.round(limit / 1048576),
          duringRender: renderInFlight,
        });
      }
    }, 500);
    watchdog.unref();
  }

  const health = (res: http.ServerResponse) => {
    const used = readMemory();
    const ok = browsers.healthy && !shuttingDown;
    const body: HealthResponse = {
      status: ok ? 'ok' : 'error',
      chromium: browsers.chromium,
      contractVersion: RENDER_CONTRACT_VERSION,
      uptimeS: Math.round((Date.now() - started) / 1000),
      rendersServed,
      queue: gate.stats(),
      memoryMb: used === null ? Math.round(process.memoryUsage().rss / 1048576) : Math.round(used / 1048576),
    };
    if (!ok) body.error = shuttingDown ? 'shutting down' : (browsers.lastLaunchError ?? 'chromium has not started yet');
    sendJson(res, ok ? 200 : 503, body);
  };

  const render = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const t0 = Date.now();
    if (shuttingDown) return sendError(res, 'shutting_down', 'the renderer is shutting down');
    const type = String(req.headers['content-type'] ?? '').toLowerCase();
    if (!type.startsWith('application/json')) {
      return sendError(res, 'unsupported_media_type', 'send the render request as application/json');
    }
    const declared = Number(req.headers['content-length']);
    const tooLarge = () =>
      sendError(res, 'payload_too_large', `the body is larger than ${config.maxBodyBytes} bytes`, { connection: 'close' });
    if (Number.isFinite(declared) && declared > config.maxBodyBytes) {
      // Refused on the header alone — nothing is read. Closing the connection
      // after the answer is what stops the client sending the rest.
      tooLarge();
      res.on('finish', () => req.destroy());
      return;
    }

    let body: Buffer;
    try {
      body = await readBody(req, config.maxBodyBytes);
    } catch (e) {
      if (e instanceof BodyTooLarge) return tooLarge();
      return sendError(res, 'invalid_request', 'could not read the request body');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      return sendError(res, 'invalid_json', 'the body is not valid JSON');
    }
    const valid = validateRenderRequest(parsed, config.maxBodyBytes);
    if (!valid.ok) return sendError(res, 'invalid_request', valid.message);

    const ticket = gate.enter();
    if (!ticket) {
      return sendError(res, 'queue_full', 'a render is running and the queue is full — retry shortly', { 'retry-after': '5' });
    }
    let clientGone = false;
    res.on('close', () => {
      if (!res.writableFinished) {
        clientGone = true;
        if (ticket.waiting) ticket.release();
      }
    });
    await ticket.ready;
    if (clientGone) {
      ticket.release();
      return;
    }
    if (shuttingDown) {
      ticket.release();
      return sendError(res, 'shutting_down', 'the renderer is shutting down');
    }
    const queueMs = Date.now() - t0;

    let launchMs = 0;
    let timer: NodeJS.Timeout | undefined;
    renderInFlight = true;
    memoryKillDuringRender = false;
    const job = (async () => {
      const acquired = await browsers.acquire().catch((e: unknown) => {
        throw new RenderFailure('browser_unavailable', `Chromium could not start: ${clean(e)}`);
      });
      launchMs = acquired.launchMs;
      return renderBoard(acquired.browser, valid.value, deps);
    })();
    current = job.catch(() => undefined);
    try {
      const out = await Promise.race([
        job,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('render-timeout')), config.renderTimeoutMs);
        }),
      ]);
      rendersServed += 1;
      const totalMs = Date.now() - t0;
      const response: RenderResponse = {
        ...out.response,
        timings: { queueMs, launchMs, ...out.response.timings, totalMs },
        chromium: browsers.chromium ?? 'unknown',
      };
      logger.info('render ok', {
        canvas: `${valid.value.canvasWidth}x${valid.value.canvasHeight}`,
        htmlKb: Math.round(valid.value.html.length / 1024),
        ms: totalMs,
        timings: response.timings,
        bytes: out.bytes,
        texts: response.metrics.text.elements,
        blocked: response.metrics.blockedRequestCount,
      });
      sendJson(res, 200, response);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message === 'render-timeout') {
        // Whatever is wedged — a hung script, a stuck CDP call — goes with
        // the browser. The next render gets a fresh one.
        browsers.kill('render-timeout');
        logger.warn('render timeout', { ms: Date.now() - t0 });
        sendError(res, 'render_timeout', `the render did not finish within ${config.renderTimeoutMs} ms`);
      } else if (memoryKillDuringRender) {
        sendError(res, 'memory_limit', 'the render exceeded the memory budget and Chromium was restarted');
      } else if (e instanceof RenderFailure) {
        logger.warn('render failed', { code: e.code, error: clean(e.message) });
        sendError(res, e.code, e.message);
      } else {
        logger.error('render failed', { error: clean(message) });
        sendError(res, 'render_failed', clean(message));
      }
    } finally {
      if (timer) clearTimeout(timer);
      // Hold the slot until the job has really stopped (a kill makes that
      // immediate), so "one render at a time" stays true under timeouts.
      await Promise.race([job.catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
      renderInFlight = false;
      current = null;
      ticket.release();
      await browsers.noteRender().catch(() => undefined);
    }
  };

  const server = http.createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    if (url === '/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 'method_not_allowed', 'use GET', { allow: 'GET, HEAD' });
      return health(res);
    }
    if (url === '/render') {
      if (req.method !== 'POST') return sendError(res, 'method_not_allowed', 'use POST', { allow: 'POST' });
      render(req, res).catch((e: unknown) => {
        logger.error('unhandled render error', { error: clean(e) });
        if (!res.headersSent) sendError(res, 'render_failed', 'internal error');
      });
      return;
    }
    sendError(res, 'not_found', 'not found');
  });
  // Bounded everywhere a slow client could hold a socket open.
  server.headersTimeout = 10_000;
  server.requestTimeout = config.renderTimeoutMs + 30_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 50;

  return {
    server,
    gate,
    async shutdown(graceMs = 10_000) {
      shuttingDown = true;
      if (watchdog) clearInterval(watchdog);
      server.close();
      if (current) await Promise.race([current, new Promise((r) => setTimeout(r, graceMs).unref())]);
      await browsers.close('shutdown');
      server.closeAllConnections();
    },
  };
}
