/**
 * SDE-05 (2026-08-04) — no query string may reach an operational log sink.
 *
 * Both sinks recorded the FULL request URL, so any credential a caller puts in
 * a query parameter was copied verbatim into operational logging:
 *
 *   - `RequestLogInterceptor` wrote `resource: url` into the Railway stream on
 *     every mutation. Live today on the sports feed routes, which carry their
 *     token as a query parameter.
 *   - `AllExceptionsFilter` logged the full URL AND set it as a Sentry `route`
 *     tag on every 5xx — a more durable sink than stdout, with third-party
 *     retention.
 *
 * `req.path` is deliberately NOT used to fix this. Under some Nest middleware
 * mount modes it becomes relative to the mount point and drops the
 * `/api/v1/...` prefix — documented at csrf.middleware.ts:200-206 — which would
 * silently degrade the breadcrumb. Both sinks use
 * `(originalUrl || url).split('?')[0]`, the same expression that file uses.
 */

import { RequestLogInterceptor } from './request-log.interceptor';
import { of } from 'rxjs';

// A token shaped like the ones the sports feed routes actually carry.
const SECRET = 'sk_live_feedtoken_do_not_log_me_0123456789';

function runInterceptor(reqOverrides: Record<string, unknown>) {
  const logged: string[] = [];
  const interceptor = new RequestLogInterceptor();
  // The interceptor builds its own Logger; capture what it emits.
  (interceptor as any).logger = { log: (m: string) => logged.push(m) };

  const req = {
    method: 'POST',
    headers: {},
    socket: { remoteAddress: '203.0.113.9' },
    user: { id: 'user-1' },
    ...reqOverrides,
  };
  const ctx: any = {
    switchToHttp: () => ({ getRequest: () => req }),
  };
  const next: any = { handle: () => of({ ok: true }) };
  return new Promise<string[]>((resolve) => {
    interceptor.intercept(ctx, next).subscribe({
      complete: () => resolve(logged),
    });
  });
}

describe('SDE-05 — RequestLogInterceptor logs the path, never the query string', () => {
  it('strips a credential-bearing query string from the breadcrumb', async () => {
    const logged = await runInterceptor({
      originalUrl: `/api/v1/sports/feed?token=${SECRET}&gameId=abc`,
      url: `/api/v1/sports/feed?token=${SECRET}&gameId=abc`,
    });

    expect(logged).toHaveLength(1);
    const entry = JSON.parse(logged[0]);

    // THE POINT: the secret must not appear anywhere in the emitted line.
    expect(logged[0]).not.toContain(SECRET);
    expect(logged[0]).not.toContain('token=');
    expect(entry.resource).toBe('/api/v1/sports/feed');
  });

  it('keeps the full /api/v1 path — the breadcrumb is still useful', async () => {
    // Regression guard for the `req.path` trap: if someone swaps the
    // expression for req.path, a mounted router would yield '/feed' here.
    const logged = await runInterceptor({
      originalUrl: '/api/v1/screens/abc-123/pair',
      url: '/api/v1/screens/abc-123/pair',
      path: '/pair',
    });
    expect(JSON.parse(logged[0]).resource).toBe('/api/v1/screens/abc-123/pair');
  });

  it('is unchanged for a URL with no query string', async () => {
    const logged = await runInterceptor({
      originalUrl: '/api/v1/playlists',
      url: '/api/v1/playlists',
    });
    expect(JSON.parse(logged[0]).resource).toBe('/api/v1/playlists');
  });

  it('redacts the scorekeeper console token that rides in the PATH itself (Phase-2 SHARE)', async () => {
    // Console tokens live in the path, not the query, so the query-strip
    // alone never covered them — this pins the path-segment redaction.
    const mac = 'abcdef0123456789abcdef0123456789';
    const consoleToken = `11111111-2222-4333-8444-000000000001.0.1754000000.86400.${mac}`;
    const logged = await runInterceptor({
      originalUrl: `/api/v1/sports/console/${consoleToken}/score`,
      url: `/api/v1/sports/console/${consoleToken}/score`,
    });
    expect(logged).toHaveLength(1);
    expect(logged[0]).not.toContain(consoleToken);
    expect(logged[0]).not.toContain(mac);
    expect(JSON.parse(logged[0]).resource).toBe('/api/v1/sports/console/:token/score');
  });

  it('still does not log non-mutating requests at all', async () => {
    const logged = await runInterceptor({
      method: 'GET',
      originalUrl: `/api/v1/anything?token=${SECRET}`,
      url: `/api/v1/anything?token=${SECRET}`,
    });
    expect(logged).toHaveLength(0);
  });
});

describe('SDE-05 — AllExceptionsFilter redacts the query string in both of its sinks', () => {
  // Asserted against the source: the filter's Sentry tag and its error log must
  // both derive from a query-stripped path, not the raw URL. A behavioural test
  // would need the whole Sentry + Nest host stack for a one-expression change;
  // this pins the property that regressed.
  const src: string = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'common', 'all-exceptions.filter.ts'),
    'utf8',
  );

  it('computes a query-stripped routePath', () => {
    expect(src).toMatch(/String\(req\?\.originalUrl \?\? req\?\.url \?\? ''\)\.split\('\?'\)\[0\]/);
  });

  it('redacts the console token path segment before either sink sees it', () => {
    // Same rule as the interceptor: the scorekeeper console credential
    // rides in the path, so routePath must strip that segment too.
    expect(src).toMatch(/\\\/sports\\\/console\\\//);
    expect(src).toContain("'$1:token'");
  });

  it('tags Sentry with routePath, not the raw URL', () => {
    expect(src).toContain("scope.setTag('route', routePath)");
    expect(src).not.toContain("scope.setTag('route', req?.url");
  });

  it('logs routePath, not the raw URL', () => {
    expect(src).toContain('`[${req?.method} ${routePath}]');
    expect(src).not.toContain('`[${req?.method} ${req?.url}]');
  });
});
