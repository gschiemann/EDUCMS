/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
import { FILTERED, scrubBreadcrumb, scrubEvent, scrubText, scrubUrl } from '../sentry-scrub';

describe('scrubUrl', () => {
  it.each([
    ['https://app.example/console/abc123', `https://app.example/console/${FILTERED}`],
    ['/reset-password/tok-1', `/reset-password/${FILTERED}`],
    ['/accept-invite/tok-2/', `/accept-invite/${FILTERED}/`],
    ['/claim-account/tok-3', `/claim-account/${FILTERED}`],
    ['/setup-account/tok-4', `/setup-account/${FILTERED}`],
    ['/athlete/tok-5', `/athlete/${FILTERED}`],
    ['GET /athlete/tok-5', `GET /athlete/${FILTERED}`],
    ['/auth/callback?code=xyz&state=1', `/auth/callback?${FILTERED}`],
    ['https://app.example/x?token=abc#frag', `https://app.example/x?${FILTERED}`],
    ['/a#token=abc', `/a?${FILTERED}`],
    ['https://app.example/accept-invite/tok?code=1', `https://app.example/accept-invite/${FILTERED}?${FILTERED}`],
  ])('%s → %s', (input, expected) => {
    expect(scrubUrl(input)).toBe(expected);
  });

  it.each([
    ['/console/[token]'],
    ['/reset-password/request'],
    ['/peak-west/dashboard'],
    ['https://console.example/dashboard'],
  ])('leaves %s alone', (input) => {
    expect(scrubUrl(input)).toBe(input);
  });

  it('passes undefined and empty through', () => {
    expect(scrubUrl(undefined)).toBeUndefined();
    expect(scrubUrl('')).toBe('');
  });
});

describe('scrubText', () => {
  it('scrubs URLs and paths embedded in prose', () => {
    const out = scrubText('Navigated to https://app.example/accept-invite/SECRET?code=C1 from /console/SECRET2');
    expect(out).not.toContain('SECRET');
    expect(out).not.toContain('C1');
  });
});

describe('scrubEvent', () => {
  it('scrubs request url, query string, referer, breadcrumbs, spans and transaction', () => {
    const event = {
      transaction: '/claim-account/SECRET_T',
      request: {
        url: 'https://app.example/setup-account/SECRET_U?token=SECRET_Q',
        query_string: 'token=SECRET_Q',
        headers: { Referer: 'https://app.example/console/SECRET_R?x=1', Cookie: 'sid=SECRET_C' },
        data: { password: 'SECRET_P', name: 'ok' },
      },
      breadcrumbs: [
        { category: 'navigation', data: { from: '/athlete/SECRET_F', to: '/reset-password/SECRET_TO?code=SECRET_CODE' } },
        { category: 'fetch', data: { url: 'https://api.example/v1/x?token=SECRET_FETCH', method: 'GET' } },
        { message: 'GET https://api.example/y?code=SECRET_MSG' },
      ],
      spans: [{ description: 'GET https://api.example/z?token=SECRET_SPAN', data: { 'http.url': 'https://api.example/z?token=SECRET_SPAN2', 'http.query': '?token=SECRET_SPAN3' } }],
      contexts: { trace: { trace_id: 'a'.repeat(32), data: { 'url.full': 'https://app.example/console/SECRET_TRACE' } } },
      user: { id: 'u1', email: 'SECRET_EMAIL@example.com', ip_address: '1.2.3.4' },
    };
    const out = scrubEvent(event);
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/SECRET/);
    expect(out.request.query_string).toBeUndefined();
    expect(out.request.url).toBe(`https://app.example/setup-account/${FILTERED}?${FILTERED}`);
    expect(out.transaction).toBe(`/claim-account/${FILTERED}`);
    expect(out.user).toEqual({ id: 'u1', ip_address: '1.2.3.4' });
    expect((out.contexts.trace as { trace_id: string }).trace_id).toBe('a'.repeat(32));
    expect((out.request.data as { name: string }).name).toBe('ok');
  });

  it('scrubBreadcrumb scrubs at record time', () => {
    const crumb = scrubBreadcrumb({ data: { to: '/console/SECRET', url: '/x?token=SECRET' } });
    expect(JSON.stringify(crumb)).not.toMatch(/SECRET/);
  });
});

describe('every web Sentry config uses the shared scrubber', () => {
  // The configs call Sentry.init at import; read them as text instead.
  it.each(['sentry.server.config.ts', 'sentry.edge.config.ts'])('%s', (file) => {
    const src = fs.readFileSync(path.join(__dirname, '../../..', file), 'utf8');
    expect(src).toMatch(/from '\.\/src\/lib\/sentry-scrub'/);
    expect(src).toMatch(/beforeSend: \(event\) => scrubEvent\(event\)/);
    expect(src).toMatch(/beforeSendTransaction: \(event\) => scrubEvent\(event\)/);
    expect(src).toMatch(/beforeBreadcrumb: \(crumb\) => scrubBreadcrumb\(crumb\)/);
  });

  // The browser init is in src/instrumentation-client.ts; its options (and
  // the hooks, exercised in sentry-client-options.test.ts) are here.
  it('src/lib/sentry-client-options.ts (browser)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'sentry-client-options.ts'), 'utf8');
    expect(src).toMatch(/from '\.\/sentry-scrub'/);
    expect(src).toMatch(/beforeSendTransaction: \(event\) => scrubEvent\(event\)/);
    expect(src).toMatch(/beforeBreadcrumb: \(crumb\) => scrubBreadcrumb\(crumb\)/);
  });

  it('no legacy sentry.client.config.ts (the Turbopack build never loads it)', () => {
    for (const name of ['sentry.client.config.ts', 'sentry.client.config.js']) {
      expect(fs.existsSync(path.join(__dirname, '../../..', name))).toBe(false);
    }
  });
});
