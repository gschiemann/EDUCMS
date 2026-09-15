/**
 * SEC-006 (durable half, 2026-09-05) — the wire between the API process and
 * the disposable Chromium worker.
 *
 * Everything in this file is deliberately dependency-free (no Nest, no
 * puppeteer, no Prisma): it is loaded by BOTH sides of the boundary, and the
 * child must not drag the API's module graph — and therefore the API's
 * connections — into the process that points a browser at a hostile page.
 *
 * Two rules shape the whole file:
 *
 *   1. EVERY message is validated on receipt, in both directions. The child
 *      is the process that touched hostile bytes; its "result" is untrusted
 *      input to the API, exactly like a request body. The parent's job is a
 *      privileged one, so the child validates too — a message that did not
 *      come from our own fork is not a render order.
 *   2. The child's ENVIRONMENT is an ALLOWLIST, never `process.env` minus a
 *      few names. A denylist is one deploy away from being wrong: the day
 *      someone adds `OPENAI_API_KEY` to the API service, a denylist silently
 *      hands it to the browser process. `buildWorkerEnv` starts from nothing
 *      and copies in the handful of names Chromium and Node actually need.
 */

/** Bumped only if the message shapes change incompatibly. */
export const RENDER_PROTOCOL_VERSION = 1 as const;

/**
 * Env var the parent sets on the fork so `render-worker.ts` knows it was
 * started as a worker. Importing the module (a test, a bundler probe) must
 * never start a browser.
 */
export const RENDER_WORKER_ENV_FLAG = 'VENUEOS_RENDER_WORKER';

/** Bounds the child enforces on itself. The parent enforces its own on top. */
export interface RenderJobLimits {
  /** `page.goto` timeout. */
  navigationTimeoutMs: number;
  /** Quiet period after load for setTimeout(0)-scheduled DOM work. */
  postLoadGraceMs: number;
  /** Whole-job ceiling INSIDE the child, deliberately under the parent's. */
  workerBudgetMs: number;
  /** Max rendered-HTML length handed back (UTF-16 units, matching `.length`). */
  maxHtmlChars: number;
  /** Max declared response bytes across the render. */
  maxResponseBytes: number;
  /** Max intercepted requests per render. */
  maxRequestsPerRender: number;
  /** How long one DNS verdict may be reused inside a render. */
  hostVerdictTtlMs: number;
  /** Cap on a single DNS resolution. */
  dnsVerdictTimeoutMs: number;
}

export interface RenderJobMessage {
  v: typeof RENDER_PROTOCOL_VERSION;
  type: 'render';
  /** Absolute http(s) URL to render. Re-validated by the child. */
  url: string;
  /** Chromium binary. */
  executablePath: string;
  /**
   * Throwaway profile directory, created and destroyed by the PARENT. Parent-
   * owned on purpose: a SIGKILLed child cannot clean up after itself, and a
   * leaked profile dir per hostile render is a slow disk leak.
   */
  userDataDir: string;
  limits: RenderJobLimits;
}

/**
 * Bounds the child enforces on a PDF rasterization. Every one of these is a
 * number the child re-checks itself — see `pdf-raster-pipeline.ts` for what
 * each is worth and why the default is what it is.
 */
export interface RasterizeJobLimits {
  /** Source pages rastered before the job truncates and says so. */
  maxPages: number;
  /** Decoded pixels one page may occupy (width × height). */
  maxPagePixels: number;
  /** Ceiling on the pdf.js viewport scale, independent of `maxPagePixels`. */
  maxScale: number;
  /** Refuse an input file larger than this without opening it. */
  maxPdfBytes: number;
  /** Sum of every encoded image handed back (full page + thumbnail). */
  maxTotalOutputBytes: number;
  /** Long edge of the full-size render, before the pixel/scale clamps. */
  targetLongEdgePx: number;
  /** Long edge of the per-page thumbnail. */
  thumbLongEdgePx: number;
  /** WebP quality, 1-100. */
  webpQuality: number;
  /** Whole-job ceiling INSIDE the child, deliberately under the parent's. */
  workerBudgetMs: number;
  /** Ceiling on ONE page: pdf.js paint plus the canvas read-back. */
  pageRenderTimeoutMs: number;
}

/**
 * Rasterize N pages of a PDF into images — SEC-006's worker, second job kind.
 *
 * `kind` is not redundant with `type`: `type` says which supervisor owns the
 * job, `kind` says what is being rastered. A future `'pptx-pages'` would reuse
 * every bound and every guard here, and `parseRenderJob` would still reject an
 * unknown one rather than guess.
 *
 * THE BYTES ARE NOT IN THIS MESSAGE, DELIBERATELY. Uploads reach 50 MB; an IPC
 * round trip would hold that twice over (JSON-encoded in the parent, decoded in
 * the child) for no benefit. The parent writes the upload to a random name in a
 * directory only it created and passes the PATH — the same ownership rule
 * `userDataDir` already follows.
 */
export interface RasterizeJobMessage {
  v: typeof RENDER_PROTOCOL_VERSION;
  type: 'rasterize';
  kind: 'pdf-pages';
  /**
   * Absolute path to the PDF the parent wrote. The child unlinks it as soon as
   * it has read the bytes, so a tenant's document is on disk for the read and
   * not for the render.
   */
  pdfPath: string;
  /**
   * Directory holding `pdfPath`. The child removes it on its way out, but that
   * runs after the result is posted and so races the parent's kill; the PARENT
   * removes it unconditionally, which is what makes the cleanup a guarantee.
   */
  scratchDir: string;
  /** Chromium binary. */
  executablePath: string;
  /** Throwaway Chromium profile, same lifecycle as the render job's. */
  userDataDir: string;
  limits: RasterizeJobLimits;
}

/** Every job shape the worker will accept. Nothing else is a job. */
export type WorkerJobMessage = RenderJobMessage | RasterizeJobMessage;

/** One rastered page as it crosses the IPC boundary. */
export interface RasterizedPageMessage {
  /** 1-based page number in the SOURCE document, never the output index. */
  sourcePageNumber: number;
  widthPx: number;
  heightPx: number;
  /** Full-size WebP, base64. `serialization: 'json'` cannot carry a Buffer. */
  webpBase64: string;
  /** Thumbnail WebP, base64. */
  thumbWebpBase64: string;
}

export type WorkerLogLevel = 'log' | 'warn' | 'error';

export type WorkerMessage =
  | { v: typeof RENDER_PROTOCOL_VERSION; type: 'ready' }
  /**
   * The pid of the Chromium BROWSER process, reported the instant it launches.
   *
   * Not a nicety — a correctness fix found by running the kill path against a
   * real browser inside the shipped image (2026-09-05). `@puppeteer/browsers`
   * spawns Chromium with `detached: true` on every non-Windows platform, which
   * makes it its OWN process-group leader. So killing the worker's group left
   * the entire browser tree alive (11 processes, ~900 MB) re-parented to init.
   * The parent needs this pid to kill the browser's group too.
   */
  | { v: typeof RENDER_PROTOCOL_VERSION; type: 'browser'; pid: number }
  | { v: typeof RENDER_PROTOCOL_VERSION; type: 'log'; level: WorkerLogLevel; message: string }
  | {
      v: typeof RENDER_PROTOCOL_VERSION;
      type: 'result';
      ok: true;
      html: string;
      finalUrl: string;
      requests: number;
      elapsedMs: number;
    }
  | { v: typeof RENDER_PROTOCOL_VERSION; type: 'result'; ok: false; reason: string }
  /**
   * A rasterize job's answer. A SEPARATE type from `result` so a client that
   * asked for a URL render can never be handed images, and vice versa.
   *
   * `truncated` is a first-class field rather than a warning the caller has to
   * grep for: "we rastered 40 of your 60 pages" is the single most important
   * thing an import can tell an operator, and the current importer's habit of
   * silently dropping pages is exactly what this job kind exists to end.
   */
  | {
      v: typeof RENDER_PROTOCOL_VERSION;
      type: 'raster-result';
      ok: true;
      /** Pages in the SOURCE document, whether or not we rastered them all. */
      sourcePageCount: number;
      pages: RasterizedPageMessage[];
      warnings: string[];
      truncated: boolean;
      elapsedMs: number;
    }
  | { v: typeof RENDER_PROTOCOL_VERSION; type: 'raster-result'; ok: false; reason: string };

/**
 * The ONLY environment variables the render child inherits.
 *
 * Nothing here is a credential, an endpoint, or a signing key. In particular
 * `DATABASE_URL`, `DIRECT_URL`, `REDIS_URL`, `JWT_SECRET`, `SESSION_SECRET`,
 * `DEVICE_SECRET_KEY`, `DEVICE_JWT_SECRET`, `SUPABASE_*`, `PROXY_RENDER_SECRET`
 * and every provider API key are absent BY CONSTRUCTION — see the allowlist
 * test in `render-worker-protocol.spec.ts`, which asserts it against a fake
 * environment holding all of them.
 *
 * `NODE_OPTIONS` is pointedly NOT here. Railway sets it to
 * `--max-old-space-size=4096` for the API; inheriting it would hand the
 * hostile-page process a 4 GB heap. The child's heap comes from `execArgv`.
 */
export const WORKER_ENV_ALLOWLIST: readonly string[] = [
  // Node + Chromium need to find binaries and libraries.
  'PATH',
  'LD_LIBRARY_PATH',
  // Chromium refuses to start without a writable HOME-ish place.
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  // Text rendering / date formatting only.
  'LANG',
  'LC_ALL',
  'LANGUAGE',
  'TZ',
  // Where the browser binary is, and "don't try to download one".
  'PUPPETEER_EXECUTABLE_PATH',
  'PUPPETEER_SKIP_CHROMIUM_DOWNLOAD',
  'PUPPETEER_SKIP_DOWNLOAD',
  // The SUID sandbox helper's path, for the day the container can use it.
  'CHROME_DEVEL_SANDBOX',
  // Alpine/musl CA bundle discovery for the Node half's DNS/TLS.
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
];

/**
 * Build the child's environment from an allowlist plus explicit additions.
 *
 * Returns a plain object with no prototype pollution surface and no undefined
 * values (`child_process` stringifies whatever it is given).
 */
export function buildWorkerEnv(
  parentEnv: NodeJS.ProcessEnv,
  extra: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = Object.create(null);
  for (const key of WORKER_ENV_ALLOWLIST) {
    const value = parentEnv[key];
    if (typeof value === 'string' && value.length > 0) env[key] = value;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}

/**
 * Flatten an untrusted string for a log line.
 *
 * The child logs URLs and error messages that a hostile page influenced.
 * Control characters (a newline in particular) let that content forge log
 * records; a length cap keeps one page from filling the log budget.
 */
export function sanitizeLogText(raw: unknown, max = 300): string {
  const s = typeof raw === 'string' ? raw : String(raw ?? '');
  let out = '';
  for (const ch of s.slice(0, max)) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return out;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** An absolute-looking path the child will open. Kept deliberately narrow. */
function isUsablePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096;
}

/**
 * Validate a job the CHILD received. Returns null for anything unexpected.
 *
 * The union is discriminated on `type`, and the switch has no default arm that
 * guesses: a message whose `type` is not one we ship — or whose `kind` is not
 * one this `type` knows — is not a job, and the worker answers
 * `invalid-job-message` and exits.
 */
export function parseRenderJob(raw: unknown): WorkerJobMessage | null {
  if (!isPlainRecord(raw)) return null;
  if (raw.v !== RENDER_PROTOCOL_VERSION) return null;
  if (raw.type === 'render') return parseUrlRenderJob(raw);
  if (raw.type === 'rasterize') return parseRasterizeJob(raw);
  return null;
}

function parseUrlRenderJob(raw: Record<string, unknown>): RenderJobMessage | null {
  if (typeof raw.url !== 'string' || raw.url.length === 0 || raw.url.length > 4096) return null;
  if (typeof raw.executablePath !== 'string' || raw.executablePath.length === 0) return null;
  if (typeof raw.userDataDir !== 'string' || raw.userDataDir.length === 0) return null;
  if (!isPlainRecord(raw.limits)) return null;
  const l = raw.limits;
  const keys: (keyof RenderJobLimits)[] = [
    'navigationTimeoutMs',
    'postLoadGraceMs',
    'workerBudgetMs',
    'maxHtmlChars',
    'maxResponseBytes',
    'maxRequestsPerRender',
    'hostVerdictTtlMs',
    'dnsVerdictTimeoutMs',
  ];
  for (const key of keys) {
    if (!isFiniteNumber(l[key]) || (l[key] as number) <= 0) return null;
  }
  return {
    v: RENDER_PROTOCOL_VERSION,
    type: 'render',
    url: raw.url,
    executablePath: raw.executablePath,
    userDataDir: raw.userDataDir,
    limits: {
      navigationTimeoutMs: l.navigationTimeoutMs as number,
      postLoadGraceMs: l.postLoadGraceMs as number,
      workerBudgetMs: l.workerBudgetMs as number,
      maxHtmlChars: l.maxHtmlChars as number,
      maxResponseBytes: l.maxResponseBytes as number,
      maxRequestsPerRender: l.maxRequestsPerRender as number,
      hostVerdictTtlMs: l.hostVerdictTtlMs as number,
      dnsVerdictTimeoutMs: l.dnsVerdictTimeoutMs as number,
    },
  };
}

function parseRasterizeJob(raw: Record<string, unknown>): RasterizeJobMessage | null {
  if (raw.kind !== 'pdf-pages') return null;
  if (!isUsablePath(raw.pdfPath)) return null;
  if (!isUsablePath(raw.scratchDir)) return null;
  if (!isUsablePath(raw.executablePath)) return null;
  if (!isUsablePath(raw.userDataDir)) return null;
  // The file the child opens has to be inside the directory it is told to
  // destroy, or cleanup and blast radius stop matching each other.
  if (!raw.pdfPath.startsWith(raw.scratchDir)) return null;
  if (!isPlainRecord(raw.limits)) return null;
  const l = raw.limits;
  const keys: (keyof RasterizeJobLimits)[] = [
    'maxPages',
    'maxPagePixels',
    'maxScale',
    'maxPdfBytes',
    'maxTotalOutputBytes',
    'targetLongEdgePx',
    'thumbLongEdgePx',
    'webpQuality',
    'workerBudgetMs',
    'pageRenderTimeoutMs',
  ];
  for (const key of keys) {
    if (!isFiniteNumber(l[key]) || (l[key] as number) <= 0) return null;
  }
  // sharp rejects anything outside 1-100, and a job that cannot encode is a
  // job that wasted a browser launch to find out.
  if ((l.webpQuality as number) > 100) return null;
  return {
    v: RENDER_PROTOCOL_VERSION,
    type: 'rasterize',
    kind: 'pdf-pages',
    pdfPath: raw.pdfPath,
    scratchDir: raw.scratchDir,
    executablePath: raw.executablePath,
    userDataDir: raw.userDataDir,
    limits: {
      maxPages: l.maxPages as number,
      maxPagePixels: l.maxPagePixels as number,
      maxScale: l.maxScale as number,
      maxPdfBytes: l.maxPdfBytes as number,
      maxTotalOutputBytes: l.maxTotalOutputBytes as number,
      targetLongEdgePx: l.targetLongEdgePx as number,
      thumbLongEdgePx: l.thumbLongEdgePx as number,
      webpQuality: l.webpQuality as number,
      workerBudgetMs: l.workerBudgetMs as number,
      pageRenderTimeoutMs: l.pageRenderTimeoutMs as number,
    },
  };
}

/**
 * Caps the PARENT re-applies to a raster result.
 *
 * Passed per call rather than read from the job so that a client which never
 * asked for images cannot be handed any: omit this and a `raster-result` is
 * refused outright, the same way an unknown `type` is.
 */
export interface RasterResultCaps {
  maxPages: number;
  maxTotalOutputBytes: number;
}

/**
 * Validate a message the PARENT received from the child.
 *
 * `maxHtmlChars` is applied here as well as in the child: the child ran the
 * hostile page, so "the child said the HTML is fine" is not a size check. The
 * same reasoning applies to `rasterCaps` — the child decoded attacker-supplied
 * bytes, so its page count and its image sizes are claims, not measurements.
 */
export function parseWorkerMessage(
  raw: unknown,
  maxHtmlChars: number,
  rasterCaps?: RasterResultCaps,
): WorkerMessage | null {
  if (!isPlainRecord(raw)) return null;
  if (raw.v !== RENDER_PROTOCOL_VERSION) return null;
  if (raw.type === 'ready') return { v: RENDER_PROTOCOL_VERSION, type: 'ready' };
  if (raw.type === 'browser') {
    // A pid is a signal target. Anything that is not a plausible pid is
    // discarded rather than passed to `process.kill`.
    if (!isFiniteNumber(raw.pid) || raw.pid <= 1 || !Number.isInteger(raw.pid)) return null;
    return { v: RENDER_PROTOCOL_VERSION, type: 'browser', pid: raw.pid };
  }
  if (raw.type === 'log') {
    const level: WorkerLogLevel =
      raw.level === 'error' ? 'error' : raw.level === 'warn' ? 'warn' : 'log';
    return {
      v: RENDER_PROTOCOL_VERSION,
      type: 'log',
      level,
      message: sanitizeLogText(raw.message),
    };
  }
  if (raw.type === 'raster-result') {
    return rasterCaps ? parseRasterResult(raw, rasterCaps) : null;
  }
  if (raw.type !== 'result') return null;
  if (raw.ok === false) {
    return {
      v: RENDER_PROTOCOL_VERSION,
      type: 'result',
      ok: false,
      reason: sanitizeLogText(raw.reason),
    };
  }
  if (raw.ok !== true) return null;
  if (typeof raw.html !== 'string') return null;
  if (raw.html.length > maxHtmlChars) return null;
  if (typeof raw.finalUrl !== 'string' || raw.finalUrl.length === 0 || raw.finalUrl.length > 4096) {
    return null;
  }
  return {
    v: RENDER_PROTOCOL_VERSION,
    type: 'result',
    ok: true,
    html: raw.html,
    finalUrl: raw.finalUrl,
    requests: isFiniteNumber(raw.requests) ? raw.requests : 0,
    elapsedMs: isFiniteNumber(raw.elapsedMs) ? raw.elapsedMs : 0,
  };
}

/** Decoded size of a base64 payload, without allocating the buffer. */
function base64Bytes(value: string): number {
  let padding = 0;
  if (value.endsWith('==')) padding = 2;
  else if (value.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

/** Base64 only — anything else is not an image this parent will forward. */
const BASE64_ONLY = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Validate a raster result. Every bound the child enforced is re-enforced.
 *
 * The child is the process that decoded an attacker-supplied PDF, so its
 * answer is untrusted input in exactly the way `render`'s HTML is: a page
 * count over the cap, a payload over the byte budget, or anything that is not
 * base64, discards the result WHOLE rather than trimming it. Truncation is the
 * CHILD's decision and it is announced in `truncated`; a parser that quietly
 * dropped pages here would put the parent in the business of losing an
 * operator's slides without telling them, which is the exact bug this job kind
 * exists to end.
 */
function parseRasterResult(
  raw: Record<string, unknown>,
  caps: RasterResultCaps,
): WorkerMessage | null {
  if (raw.ok === false) {
    return {
      v: RENDER_PROTOCOL_VERSION,
      type: 'raster-result',
      ok: false,
      reason: sanitizeLogText(raw.reason),
    };
  }
  if (raw.ok !== true) return null;
  if (!Array.isArray(raw.pages)) return null;
  if (raw.pages.length > caps.maxPages) return null;
  if (!isFiniteNumber(raw.sourcePageCount) || raw.sourcePageCount < 0) return null;

  const pages: RasterizedPageMessage[] = [];
  let totalBytes = 0;
  for (const entry of raw.pages) {
    if (!isPlainRecord(entry)) return null;
    const { sourcePageNumber, widthPx, heightPx, webpBase64, thumbWebpBase64 } = entry;
    if (!isFiniteNumber(sourcePageNumber) || sourcePageNumber < 1) return null;
    if (!isFiniteNumber(widthPx) || widthPx < 1) return null;
    if (!isFiniteNumber(heightPx) || heightPx < 1) return null;
    if (typeof webpBase64 !== 'string' || !BASE64_ONLY.test(webpBase64)) return null;
    if (typeof thumbWebpBase64 !== 'string' || !BASE64_ONLY.test(thumbWebpBase64)) return null;
    totalBytes += base64Bytes(webpBase64) + base64Bytes(thumbWebpBase64);
    if (totalBytes > caps.maxTotalOutputBytes) return null;
    pages.push({
      sourcePageNumber: Math.floor(sourcePageNumber),
      widthPx: Math.floor(widthPx),
      heightPx: Math.floor(heightPx),
      webpBase64,
      thumbWebpBase64,
    });
  }

  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.slice(0, 32).map((w) => sanitizeLogText(w))
    : [];
  return {
    v: RENDER_PROTOCOL_VERSION,
    type: 'raster-result',
    ok: true,
    sourcePageCount: Math.floor(raw.sourcePageCount),
    pages,
    warnings,
    truncated: raw.truncated === true,
    elapsedMs: isFiniteNumber(raw.elapsedMs) ? raw.elapsedMs : 0,
  };
}
