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

export type WorkerLogLevel = 'log' | 'warn' | 'error';

export type WorkerMessage =
  | { v: typeof RENDER_PROTOCOL_VERSION; type: 'ready' }
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
  | { v: typeof RENDER_PROTOCOL_VERSION; type: 'result'; ok: false; reason: string };

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

/** Validate a job the CHILD received. Returns null for anything unexpected. */
export function parseRenderJob(raw: unknown): RenderJobMessage | null {
  if (!isPlainRecord(raw)) return null;
  if (raw.v !== RENDER_PROTOCOL_VERSION || raw.type !== 'render') return null;
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

/**
 * Validate a message the PARENT received from the child.
 *
 * `maxHtmlChars` is applied here as well as in the child: the child ran the
 * hostile page, so "the child said the HTML is fine" is not a size check.
 */
export function parseWorkerMessage(raw: unknown, maxHtmlChars: number): WorkerMessage | null {
  if (!isPlainRecord(raw)) return null;
  if (raw.v !== RENDER_PROTOCOL_VERSION) return null;
  if (raw.type === 'ready') return { v: RENDER_PROTOCOL_VERSION, type: 'ready' };
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
