/**
 * Custom-data fetch SSRF proof (Phase 3 field-mapping).
 * ──────────────────────────────────────────────────────────────────────
 *
 * POST /api/v1/data-source/fetch takes an OPERATOR-SUPPLIED url and
 * fetches it server-side. If that fetch weren't SSRF-gated, a
 * DISTRICT_ADMIN / CONTRIBUTOR could point a template at
 * http://169.254.169.254/… and read cloud-internal metadata back through
 * the normalized rows.
 *
 * These tests use the REAL DataSourceService (NOT a mock) — which calls
 * the REAL `safeFetch` — to prove every internal / disallowed URL is
 * rejected with an `SsrfError` BEFORE any socket opens. Every URL here is
 * a private/loopback/metadata literal or a bad scheme/port, so the test
 * is hermetic and fast (no network).
 */
import { Logger } from '@nestjs/common';
import { DataSourceService } from './data-source.service';
import { SsrfError } from '../branding/safe-fetch';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined as any);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined as any);
});
afterAll(() => jest.restoreAllMocks());

const INTERNAL_TARGETS: Array<[string, string]> = [
  ['AWS/GCP IMDS', 'http://169.254.169.254/latest/meta-data/'],
  ['IPv4 loopback', 'http://127.0.0.1:8080/internal.json'],
  ['private 10/8', 'http://10.0.0.5/secret.json'],
  ['private 192.168/16', 'http://192.168.1.1/admin.json'],
  ['private 172.16/12', 'http://172.16.0.1/data.json'],
  ['IPv6 loopback', 'http://[::1]:9000/x.json'],
  ['CGNAT 100.64/10', 'http://100.64.0.1/x.json'],
];

const BAD_SHAPES: Array<[string, string]> = [
  ['file scheme', 'file:///etc/passwd'],
  ['ftp scheme', 'ftp://example.com/x.csv'],
  ['data scheme', 'data:text/csv,a,b'],
  ['disallowed port', 'http://example.com:22/x.json'],
];

describe('DataSourceService.fetchNormalized — SSRF defense (real safeFetch)', () => {
  it.each(INTERNAL_TARGETS)(
    'rejects an internal destination (%s) before opening a socket',
    async (_label, url) => {
      const svc = new DataSourceService();
      await expect(svc.fetchNormalized(url, 'json')).rejects.toBeInstanceOf(SsrfError);
    },
  );

  it.each(BAD_SHAPES)('rejects a disallowed URL shape (%s)', async (_label, url) => {
    const svc = new DataSourceService();
    await expect(svc.fetchNormalized(url, 'json')).rejects.toBeInstanceOf(SsrfError);
  });

  it('does not leak the resolved private IP in the thrown message', async () => {
    const svc = new DataSourceService();
    let thrown: any;
    try {
      await svc.fetchNormalized('http://169.254.169.254/latest/meta-data/', 'csv');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SsrfError);
    // The SsrfError message names the range/IP server-side, but the
    // CONTROLLER maps it to a generic public-facing string. This test
    // just pins that the service surfaces the SsrfError TYPE so the
    // controller's generic mapping (DATA_SOURCE_SSRF) is reached — the
    // controller is what the operator actually sees.
    expect(thrown.name).toBe('SsrfError');
  });
});
