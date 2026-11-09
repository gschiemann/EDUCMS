import { REQUEST_ID_HEADER, requestIdMiddleware, resolveRequestId, RequestWithId } from './request-id.middleware';

function run(header?: unknown) {
  const req: any = { headers: header === undefined ? {} : { [REQUEST_ID_HEADER]: header } };
  const res: any = { setHeader: jest.fn() };
  const next = jest.fn();
  requestIdMiddleware(req, res, next);
  return { req: req as RequestWithId, res, next };
}

describe('requestIdMiddleware', () => {
  it('accepts a valid inbound id, sets it on req and echoes it', () => {
    const { req, res, next } = run('client-req_1234.abc');
    expect(req.requestId).toBe('client-req_1234.abc');
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'client-req_1234.abc');
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('generates a UUID v4 when none is sent', () => {
    const { req, res } = run();
    expect(req.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.requestId);
  });

  it.each([
    ['too short', 'abc'],
    ['too long', 'a'.repeat(129)],
    ['illegal characters', 'bad id with spaces'],
    ['log-injection attempt', 'abcdefgh\nINJECTED'],
    ['empty', ''],
  ])('replaces an invalid inbound id (%s)', (_n, bad) => {
    const { req, res } = run(bad);
    expect(req.requestId).not.toBe(bad);
    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.requestId);
  });

  it('accepts the 8 and 128 character boundaries', () => {
    expect(resolveRequestId('a'.repeat(8))).toBe('a'.repeat(8));
    expect(resolveRequestId('a'.repeat(128))).toBe('a'.repeat(128));
  });

  it('takes the first of a repeated header', () => {
    expect(resolveRequestId(['first-id-123', 'second-id-456'])).toBe('first-id-123');
  });
});
