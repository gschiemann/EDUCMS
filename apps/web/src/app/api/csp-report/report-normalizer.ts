/**
 * Pure parsing + redaction for CSP violation reports — SEC-010 (2026-09-04).
 *
 * Split out of `route.ts` so it can be unit-tested without pulling
 * `next/server` into jsdom. Everything here is a pure function over
 * attacker-controlled JSON: no I/O, no globals except `Date.now` in the
 * throttle, which takes its clock as state rather than reading it implicitly.
 *
 * The redaction rules are not incidental. A violation report carries
 * `blocked-uri` and `document-uri` as FULL URLs, and the legacy SSE transport
 * still accepts a device JWT as `?token=` — so a report about that request
 * would copy a fleet credential into the platform log. Same class of bug as
 * SEC-011, one layer out.
 */

/** Longest any single logged field may be. */
export const MAX_FIELD_CHARS = 300;
/** Distinct violations logged per window before the rest are dropped. */
export const MAX_UNIQUE_PER_WINDOW = 40;
/** Total reports logged per window across all violations. */
export const MAX_LOGS_PER_WINDOW = 120;
export const WINDOW_MS = 10 * 60 * 1000;

/**
 * Keep the origin + path, drop everything after it.
 *
 * A `blocked-uri` of `https://api.example/realtime/sse?token=<device JWT>`
 * must never reach a log line. The path is the whole diagnostic value; the
 * query never is.
 */
export function safeUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return '';
  const cut = value.search(/[?#]/);
  const base = cut === -1 ? value : `${value.slice(0, cut)}?[redacted]`;
  return base.slice(0, MAX_FIELD_CHARS);
}

export function safeText(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Strip control characters so a report cannot forge extra log lines.
  // Written with \u escapes ON PURPOSE: a literal control byte inside a regex
  // literal is the exact shape that killed the holiday bridge in WebKit
  // (2026-05-09) — V8 tolerated it, WebKit threw `Unterminated regular
  // expression literal` and took the whole script with it.
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, MAX_FIELD_CHARS);
}

export interface NormalizedReport {
  directive: string;
  blocked: string;
  document: string;
  disposition: string;
  sample: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Two wire formats reach this endpoint and both must be understood:
 *
 *   `application/csp-report`   → `{ "csp-report": { "violated-directive": … } }`
 *      Safari/WebKit and Chromium 83 (the Taurus floor) send only this.
 *   `application/reports+json` → `[ { "type": "csp-violation", "body": { … } } ]`
 *      The Reporting API form, hyphens swapped for camelCase keys.
 *
 * Reading both is what makes the signal cross-browser rather than
 * Chromium-only — the same rule as every other surface in this repo. A
 * Chromium-only collector would have told us nothing about Safari operators
 * or about the Android-9 panels, which are precisely the surfaces where a
 * wrong policy costs the most.
 */
export function normalizeCspReport(payload: unknown): NormalizedReport[] {
  const out: NormalizedReport[] = [];

  if (isRecord(payload) && isRecord(payload['csp-report'])) {
    const report = payload['csp-report'];
    out.push({
      directive: safeText(report['effective-directive'] ?? report['violated-directive']),
      blocked: safeUrl(report['blocked-uri']),
      document: safeUrl(report['document-uri']),
      disposition: safeText(report['disposition']) || 'report',
      sample: safeText(report['script-sample']),
    });
    return out;
  }

  if (Array.isArray(payload)) {
    for (const entry of payload.slice(0, 20)) {
      if (!isRecord(entry)) continue;
      if (entry['type'] !== 'csp-violation') continue;
      const body = entry['body'];
      if (!isRecord(body)) continue;
      out.push({
        directive: safeText(body['effectiveDirective'] ?? body['violatedDirective']),
        blocked: safeUrl(body['blockedURL'] ?? body['blockedURI']),
        document: safeUrl(body['documentURL'] ?? entry['url']),
        disposition: safeText(body['disposition']) || 'report',
        sample: safeText(body['sample']),
      });
    }
  }

  return out;
}

/**
 * The surface a violation came from, derived from the document path only.
 * `/player` is the life-safety route; everything else is the dashboard. This
 * is what lets the operator tell "the policy would break a kiosk" apart from
 * "the policy would break an admin page" at a glance.
 */
export function surfaceOf(documentUrl: string): string {
  if (!documentUrl) return 'unknown';
  const path = documentUrl.replace(/^[a-z]+:\/\/[^/]+/i, '');
  if (path.startsWith('/player')) return 'player';
  if (
    path.startsWith('/templates/') ||
    path.startsWith('/holiday-templates/') ||
    path.startsWith('/celebrations/') ||
    path.startsWith('/demo/')
  ) {
    return 'board';
  }
  return 'dashboard';
}

/** One log line, already redacted, ready for the platform log. */
export function formatReportLine(report: NormalizedReport): string {
  const surface = surfaceOf(report.document);
  return (
    `[csp] ${report.disposition} surface=${surface} directive=${report.directive} ` +
    `blocked=${report.blocked || '(inline)'} doc=${report.document}` +
    (report.sample ? ` sample=${report.sample}` : '')
  );
}

/** The dedup key: one line per (directive, blocked resource, surface). */
export function reportKey(report: NormalizedReport): string {
  return `${report.directive}|${report.blocked}|${surfaceOf(report.document)}`;
}

/**
 * Per-instance throttle for an endpoint anybody on the internet can POST to.
 *
 * Serverless means each Vercel lambda holds its own counters, so the real
 * ceiling is (instances × cap) — still bounded, and far below what an
 * unthrottled sink would emit. Deliberately in-memory: a Redis round-trip per
 * violation report would cost more than the log line it prevents.
 *
 * A class so the tests can drive the clock instead of sleeping.
 */
export class ReportThrottle {
  private windowStartedAt = 0;
  private loggedThisWindow = 0;
  private seen = new Set<string>();

  shouldLog(key: string, now: number = Date.now()): boolean {
    if (now - this.windowStartedAt > WINDOW_MS) {
      this.windowStartedAt = now;
      this.loggedThisWindow = 0;
      this.seen = new Set<string>();
    }
    if (this.seen.has(key)) return false;
    if (this.loggedThisWindow >= MAX_LOGS_PER_WINDOW) return false;
    if (this.seen.size >= MAX_UNIQUE_PER_WINDOW) return false;
    this.seen.add(key);
    this.loggedThisWindow += 1;
    return true;
  }
}
