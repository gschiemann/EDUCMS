import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe, validationMessage } from './zod-validation.pipe';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';

describe('ZodValidationPipe — readable errors (2026-10-11)', () => {
  const pipe = new ZodValidationPipe(z.object({ name: z.string().min(1), email: z.string().email() }));

  it('names the fields in the message instead of "Bad Request Exception"', () => {
    try {
      pipe.transform({ name: '', email: 'nope' }, { type: 'body' });
      fail('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      const body = (e as BadRequestException).getResponse() as any;
      expect(body.message).toMatch(/^Please check name: .+; email: /);
      expect(body.issues).toHaveLength(2);
    }
  });

  it('caps the sentence at three issues', () => {
    const msg = validationMessage([1, 2, 3, 4, 5].map((n) => ({ path: `f${n}`, message: 'Required' })));
    expect(msg).toBe('Please check f1: Required; f2: Required; f3: Required (and 2 more)');
  });

  it('the exception filter passes the message and the issues through on a 400', () => {
    const json = jest.fn();
    const res = { headersSent: false, status: jest.fn(() => ({ json })) };
    const host: any = {
      switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ method: 'POST', url: '/x', headers: {} }) }),
    };
    let thrown: unknown;
    try { pipe.transform({}, { type: 'body' }); } catch (e) { thrown = e; }
    new AllExceptionsFilter().catch(thrown, host);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0];
    expect(body.message).toMatch(/^Please check /);
    expect(body.message).not.toMatch(/Bad Request Exception/);
    expect(Array.isArray(body.issues)).toBe(true);
  });
});
