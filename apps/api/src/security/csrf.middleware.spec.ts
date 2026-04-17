import { ForbiddenException } from '@nestjs/common';
import { CsrfMiddleware, CSRF_COOKIE_NAME, isCsrfExempt, mintCsrfToken } from './csrf.middleware';

type MockReq = {
  method: string;
  path: string;
  cookies?: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
};

type MockRes = {
  cookie: jest.Mock;
};

function makeReq(overrides: Partial<MockReq> = {}): MockReq {
  return {
    method: 'POST',
    path: '/api/v1/playlists',
    cookies: {},
    headers: {},
    ip: '127.0.0.1',
    ...overrides,
  };
}

function makeRes(): MockRes {
  return { cookie: jest.fn() };
}

describe('isCsrfExempt', () => {
  it('exempts safe methods', () => {
    expect(isCsrfExempt('GET', '/api/v1/playlists')).toBe(true);
    expect(isCsrfExempt('HEAD', '/api/v1/playlists')).toBe(true);
    expect(isCsrfExempt('OPTIONS', '/api/v1/playlists')).toBe(true);
  });

  it('exempts login, health, and the csrf mint endpoint', () => {
    expect(isCsrfExempt('POST', '/api/v1/auth/login')).toBe(true);
    expect(isCsrfExempt('POST', '/api/v1/health')).toBe(true);
    expect(isCsrfExempt('POST', '/api/v1/health/ready')).toBe(true);
    expect(isCsrfExempt('GET', '/api/v1/security/csrf')).toBe(true);
  });

  it('does not exempt other mutations', () => {
    expect(isCsrfExempt('POST', '/api/v1/emergency/trigger')).toBe(false);
    expect(isCsrfExempt('PUT', '/api/v1/playlists/1')).toBe(false);
    expect(isCsrfExempt('DELETE', '/api/v1/playlists/1')).toBe(false);
  });
});

describe('CsrfMiddleware', () => {
  const originalEnforce = process.env.CSRF_ENFORCE;

  afterEach(() => {
    process.env.CSRF_ENFORCE = originalEnforce;
  });

  it('issues a cookie when no token is present', () => {
    process.env.CSRF_ENFORCE = 'false';
    const mw = new CsrfMiddleware();
    const req = makeReq({ method: 'GET', path: '/api/v1/playlists' });
    const res = makeRes();
    const next = jest.fn();

    mw.use(req as any, res as any, next);

    expect(res.cookie).toHaveBeenCalledWith(
      CSRF_COOKIE_NAME,
      expect.any(String),
      expect.objectContaining({ path: '/', httpOnly: false }),
    );
    expect(next).toHaveBeenCalled();
  });

  it('passes safe methods without validating', () => {
    process.env.CSRF_ENFORCE = 'true';
    const mw = new CsrfMiddleware();
    const req = makeReq({ method: 'GET', cookies: { [CSRF_COOKIE_NAME]: 'existing' } });
    const res = makeRes();
    const next = jest.fn();

    mw.use(req as any, res as any, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('blocks mutation with missing header when enforcing', () => {
    process.env.CSRF_ENFORCE = 'true';
    const mw = new CsrfMiddleware();
    const token = 'abc';
    const req = makeReq({ cookies: { [CSRF_COOKIE_NAME]: token }, headers: {} });
    const res = makeRes();

    expect(() => mw.use(req as any, res as any, jest.fn())).toThrow(ForbiddenException);
  });

  it('blocks mutation with mismatched header when enforcing', () => {
    process.env.CSRF_ENFORCE = 'true';
    const mw = new CsrfMiddleware();
    const req = makeReq({
      cookies: { [CSRF_COOKIE_NAME]: 'aaa' },
      headers: { 'x-csrf-token': 'bbb' },
    });
    expect(() => mw.use(req as any, makeRes() as any, jest.fn())).toThrow(ForbiddenException);
  });

  it('allows mutation when cookie matches header', () => {
    process.env.CSRF_ENFORCE = 'true';
    const mw = new CsrfMiddleware();
    const token = mintCsrfToken();
    const req = makeReq({
      cookies: { [CSRF_COOKIE_NAME]: token },
      headers: { 'x-csrf-token': token },
    });
    const next = jest.fn();

    mw.use(req as any, makeRes() as any, next);
    expect(next).toHaveBeenCalled();
  });

  it('does not block when CSRF_ENFORCE is off (warn mode)', () => {
    process.env.CSRF_ENFORCE = 'false';
    const mw = new CsrfMiddleware();
    const req = makeReq({ cookies: { [CSRF_COOKIE_NAME]: 'aaa' }, headers: {} });
    const next = jest.fn();

    mw.use(req as any, makeRes() as any, next);
    expect(next).toHaveBeenCalled();
  });
});
