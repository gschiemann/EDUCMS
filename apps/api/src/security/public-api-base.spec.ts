/**
 * H-5 (launch security re-audit, 2026-10-11) — OAuth redirect URIs never take
 * their origin from the request's Host / X-Forwarded-Host in production.
 */
import { HttpException } from '@nestjs/common';
import { publicApiBase } from './public-api-base';

const req = (host: string, fwdHost?: string): any => ({
  protocol: 'https',
  headers: { host, ...(fwdHost ? { 'x-forwarded-host': fwdHost } : {}) },
});

describe('publicApiBase', () => {
  const saved = { env: process.env.NODE_ENV, base: process.env.PUBLIC_API_BASE_URL };
  afterEach(() => {
    process.env.NODE_ENV = saved.env;
    if (saved.base === undefined) delete process.env.PUBLIC_API_BASE_URL;
    else process.env.PUBLIC_API_BASE_URL = saved.base;
  });

  it('uses PUBLIC_API_BASE_URL when set, ignoring the request headers', () => {
    process.env.PUBLIC_API_BASE_URL = 'https://api.example.com/';
    expect(publicApiBase(req('evil.example', 'evil2.example'))).toBe('https://api.example.com');
  });

  it('production without it: 503, never the Host header', () => {
    delete process.env.PUBLIC_API_BASE_URL;
    process.env.NODE_ENV = 'production';
    expect(() => publicApiBase(req('evil.example'))).toThrow(HttpException);
    try {
      publicApiBase(req('evil.example'));
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(503);
      expect(JSON.stringify((e as HttpException).getResponse())).not.toContain('evil.example');
    }
  });

  it('dev keeps the header fallback (local stack needs no config)', () => {
    delete process.env.PUBLIC_API_BASE_URL;
    process.env.NODE_ENV = 'development';
    expect(publicApiBase(req('localhost:8080'))).toBe('https://localhost:8080');
  });
});
