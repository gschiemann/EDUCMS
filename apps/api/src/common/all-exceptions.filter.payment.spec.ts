/**
 * 2026-10-12 — a 402 (the AI plan / AI limit refusals) carries the named facts the dashboard words
 * it from; nothing else rides through, and no other status gains a field.
 */
import { HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const res: any = { headersSent: false, status: jest.fn(() => ({ json })) };
  const host: any = { switchToHttp: () => ({ getRequest: () => ({ method: 'POST', url: '/x' }), getResponse: () => res }) };
  new AllExceptionsFilter().catch(exception, host);
  return { status: res.status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

describe('AllExceptionsFilter — 402 facts', () => {
  it('passes the named primitive facts of a 402, and only those', () => {
    const { status, body } = run(
      new HttpException(
        {
          code: 'AI_CAP_REACHED',
          message: 'used up',
          unit: 'images',
          plan: 'trial',
          resetAt: null,
          cap: 10,
          used: 10,
          stripeCustomerId: 'cus_secret',
          nested: { unit: 'x' },
        },
        HttpStatus.PAYMENT_REQUIRED,
      ),
    );
    expect(status).toBe(402);
    expect(body).toEqual({ error: true, code: 'AI_CAP_REACHED', message: 'used up', unit: 'images', plan: 'trial', resetAt: null, cap: 10, used: 10 });
  });

  it('the AI plan refusal carries the add-on price and the own-key flag', () => {
    const { body } = run(
      new HttpException({ code: 'AI_PLAN_REQUIRED', message: 'add AI', aiAddonMonthlyCents: 500, byokAvailable: true }, 402),
    );
    expect(body).toMatchObject({ code: 'AI_PLAN_REQUIRED', aiAddonMonthlyCents: 500, byokAvailable: true });
  });

  it('any other status keeps the plain envelope', () => {
    const { body } = run(new HttpException({ code: 'X', message: 'm', unit: 'images', plan: 'ai' }, 409));
    expect(body).toEqual({ error: true, code: 'X', message: 'm' });
  });
});
