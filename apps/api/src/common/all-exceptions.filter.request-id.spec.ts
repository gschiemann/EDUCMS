/** A request id (set by request-id.middleware) rides in every error body, next to the Sentry traceId. */
import { HttpException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown, req: Record<string, unknown>) {
  const json = jest.fn();
  const res: any = { headersSent: false, status: jest.fn(() => ({ json })) };
  const host: any = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
  new AllExceptionsFilter().catch(exception, host);
  return json.mock.calls[0][0];
}

describe('AllExceptionsFilter — requestId', () => {
  it('carries the request id in a 4xx body', () => {
    const body = run(new HttpException('nope', 404), { method: 'GET', url: '/x', requestId: 'req-abcdef12' });
    expect(body.requestId).toBe('req-abcdef12');
    expect(body.code).toBe('NOT_FOUND');
  });

  it('carries the request id in a 5xx body', () => {
    const body = run(new Error('boom'), { method: 'GET', url: '/x', requestId: 'req-abcdef12' });
    expect(body.requestId).toBe('req-abcdef12');
    expect(body.code).toBe('INTERNAL_ERROR');
  });

  it('adds no requestId field when the request has none', () => {
    const body = run(new HttpException('nope', 404), { method: 'GET', url: '/x' });
    expect('requestId' in body).toBe(false);
  });
});
