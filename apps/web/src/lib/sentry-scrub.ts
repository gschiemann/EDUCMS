/**
 * Telemetry scrubbing shared by the web app's three Sentry configs
 * (`sentry.client.config.ts`, `sentry.server.config.ts`,
 * `sentry.edge.config.ts`). One module so the browser, Node and edge runtimes
 * cannot drift apart.
 *
 * Follows the API's approach (`apps/api/src/sentry-redaction.ts`): keep the
 * path (that is the diagnostic value), drop the query string and fragment,
 * and over-redact rather than under-redact. In addition, several public
 * routes carry a one-time credential as a PATH segment rather than a query
 * parameter; that segment is masked wherever a URL, path or transaction name
 * appears in an event.
 *
 * Dependency-free on purpose: it runs in the edge runtime and the browser.
 */

export const FILTERED = '[Filtered]';

/**
 * Route names whose NEXT path segment is a credential (invite, reset, claim,
 * setup, console and athlete links).
 */
const TOKEN_ROUTE_SEGMENTS = new Set([
  'console',
  'reset-password',
  'accept-invite',
  'claim-account',
  'setup-account',
  'athlete',
]);

/** Literal sub-routes under a token route that are not credentials. */
const NON_TOKEN_CHILDREN = new Set(['request']);

/** Query parameters that are always credentials (dropped with the query anyway). */
export const TOKEN_PARAMS = ['code', 'token'] as const;

function maskPath(path: string): string {
  const parts = path.split('/');
  for (let i = 0; i < parts.length - 1; i++) {
    if (!TOKEN_ROUTE_SEGMENTS.has(parts[i].toLowerCase())) continue;
    const next = parts[i + 1];
    if (!next) continue;
    // A parameterised route name (`/console/[token]`) carries no secret.
    if (/^\[.*\]$/.test(next)) continue;
    if (NON_TOKEN_CHILDREN.has(next.toLowerCase())) continue;
    parts[i + 1] = FILTERED;
  }
  return parts.join('/');
}

/**
 * Scrub one URL, path, or transaction name: drop `?query` and `#fragment`,
 * mask credential path segments. Accepts absolute URLs (`https://h/p?q`),
 * relative paths (`/p?q`) and route-style names (`GET /p`).
 */
export function scrubUrl(value: string): string;
export function scrubUrl(value: string | undefined): string | undefined;
export function scrubUrl(value: string | undefined): string | undefined {
  if (typeof value !== 'string' || value === '') return value;
  const cut = value.search(/[?#]/);
  const hadQuery = cut !== -1;
  let base = hadQuery ? value.slice(0, cut) : value;

  // Split an absolute URL into origin + path so the host is never masked.
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/]*)(.*)$/i.exec(base);
  if (m) {
    base = m[1] + maskPath(m[2]);
  } else {
    base = maskPath(base);
  }
  return hadQuery ? `${base}?${FILTERED}` : base;
}

/**
 * Scrub every URL-looking substring inside free text (a breadcrumb message
 * such as "Navigated to https://app/accept-invite/abc?code=1").
 */
export function scrubText(value: string): string {
  return value
    .replace(/(?:https?|wss?):\/\/[^\s"'<>()]+/gi, (u) => scrubUrl(u))
    .replace(/(^|[\s"'(])(\/[^\s"'<>()]*)/g, (_m, lead: string, p: string) => lead + scrubUrl(p));
}

const PII_KEY = /email|firstName|lastName|phone|ssn|password|secret|token|key/i;

/** Key-name redaction of a request body / breadcrumb data (unchanged rule). */
export function redactPII(data: unknown, depth = 0): unknown {
  if (!data || depth > 12) return data;
  if (Array.isArray(data)) return data.map((d) => redactPII(d, depth + 1));
  if (typeof data === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (PII_KEY.test(k)) {
        out[k] = '[redacted]';
      } else if (v && typeof v === 'object') {
        out[k] = redactPII(v, depth + 1);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return data;
}

/** Keys in breadcrumb / span data that hold a URL or a path. */
const URL_DATA_KEYS = ['url', 'from', 'to', 'http.url', 'url.full', 'http.target', 'url.path'];

function scrubUrlFields(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const k of URL_DATA_KEYS) {
    if (typeof data[k] === 'string') data[k] = scrubUrl(data[k] as string);
  }
  if ('http.query' in data) delete data['http.query'];
  if ('url.query' in data) delete data['url.query'];
}

/** Minimal structural view of the parts of a Sentry event we rewrite. */
export interface ScrubbableEvent {
  transaction?: string;
  request?: {
    url?: string;
    query_string?: unknown;
    headers?: Record<string, string>;
    data?: unknown;
  };
  breadcrumbs?: Array<{ message?: string; data?: Record<string, unknown> }>;
  spans?: Array<{ description?: string; data?: Record<string, unknown> }>;
  user?: { id?: string | number; ip_address?: string | null; [key: string]: unknown };
  contexts?: Record<string, unknown>;
}

/** Rewrite an outbound Sentry event (error or transaction) in place. */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (typeof event.transaction === 'string') {
    event.transaction = scrubUrl(event.transaction);
  }

  if (event.request) {
    event.request.url = scrubUrl(event.request.url);
    if ('query_string' in event.request) delete event.request.query_string;
    const headers = event.request.headers;
    if (headers) {
      for (const k of Object.keys(headers)) {
        const lower = k.toLowerCase();
        if (lower === 'referer' || lower === 'referrer') headers[k] = scrubUrl(headers[k]);
        if (lower === 'cookie' || lower === 'authorization') headers[k] = FILTERED;
      }
    }
    if (event.request.data) {
      event.request.data = redactPII(event.request.data);
    }
  }

  if (event.breadcrumbs) {
    for (const b of event.breadcrumbs) {
      if (typeof b.message === 'string') b.message = scrubText(b.message);
      if (b.data) {
        b.data = redactPII(b.data) as Record<string, unknown>;
        scrubUrlFields(b.data);
      }
    }
  }

  if (event.spans) {
    for (const s of event.spans) {
      if (typeof s.description === 'string') s.description = scrubText(s.description);
      scrubUrlFields(s.data);
    }
  }

  const trace = event.contexts?.trace as { data?: Record<string, unknown> } | undefined;
  if (trace?.data) scrubUrlFields(trace.data);

  if (event.user) {
    const { id, ip_address } = event.user;
    event.user = { id, ip_address };
  }
  return event;
}

/** Breadcrumbs are also scrubbed as they are recorded (before any event). */
export function scrubBreadcrumb<B extends { message?: string; data?: Record<string, unknown> }>(crumb: B): B {
  if (typeof crumb.message === 'string') crumb.message = scrubText(crumb.message);
  scrubUrlFields(crumb.data);
  return crumb;
}
