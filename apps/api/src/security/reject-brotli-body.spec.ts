import { hasBrotliContentEncoding, rejectBrotliRequestBody } from './reject-brotli-body';

describe('reject-brotli-body (CVE-2026-111497 second layer)', () => {
  it.each([
    ['br', true],
    ['BR', true],
    [' br ', true],
    ['gzip, br', true],
    [['gzip', 'br'], true],
    ['gzip', false],
    ['deflate', false],
    ['identity', false],
    ['brotli', false],
    ['', false],
    [undefined, false],
  ])('content-encoding %p → refused=%p', (header, refused) => {
    expect(hasBrotliContentEncoding(header as string | string[] | undefined)).toBe(refused);
  });

  function run(header?: string) {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    rejectBrotliRequestBody({ headers: header === undefined ? {} : { 'content-encoding': header } } as any, res as any, next);
    return { res, next };
  }

  it('answers 415 and never reaches the parser for a br body', () => {
    const { res, next } = run('br');
    expect(res.status).toHaveBeenCalledWith(415);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNSUPPORTED_CONTENT_ENCODING' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('passes every other request straight through', () => {
    for (const header of [undefined, 'gzip', 'identity']) {
      const { res, next } = run(header);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
  });
});
