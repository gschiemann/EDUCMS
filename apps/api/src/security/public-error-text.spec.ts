/**
 * Error text returned to callers carries no internal detail:
 *   - integration discovery and stream-URL validation return an SsrfError's
 *     uniform `publicMessage`, never its `message` (which names the address);
 *   - the web proxy answers a fixed message for an upstream connection error;
 *   - /health/storage answers a status string only.
 */
jest.mock('../branding/safe-fetch', () => {
  const actual = jest.requireActual('../branding/safe-fetch');
  return { ...actual, safeFetch: jest.fn(), validatePublicUrl: jest.fn(actual.validatePublicUrl) };
});

import { HttpException } from '@nestjs/common';
import { safeFetch, validatePublicUrl, SsrfError } from '../branding/safe-fetch';
import { IntegrationDiscoveryService } from '../integrations/discovery.service';
import { StreamingService } from '../streaming/streaming.service';
import { ProxyController } from '../proxy/proxy.controller';
import { HealthController } from '../health/health.controller';

const mockedFetch = safeFetch as unknown as jest.Mock;
const mockedValidate = validatePublicUrl as unknown as jest.Mock;
const INTERNAL = '10.20.30.40';
const ssrf = () => new SsrfError(`DNS for intranet.example resolved to private range (${INTERNAL})`);

beforeEach(() => {
  mockedFetch.mockReset();
});

describe('discovery', () => {
  it('returns the public SSRF message, not the address', async () => {
    mockedFetch.mockRejectedValueOnce(ssrf());
    const out = await new IntegrationDiscoveryService().discoverFromUrl('https://intranet.example/');
    const text = out.warnings.join(' ');
    expect(text).not.toContain(INTERNAL);
    expect(text).toContain('Upstream host is not permitted');
  });
});

describe('stream URL validation', () => {
  const svc = new StreamingService({} as any);

  it('up-front validation failure returns the public message', async () => {
    mockedValidate.mockImplementationOnce(() => {
      throw ssrf();
    });
    const out = await svc.validateStreamUrl('https://intranet.example/live.m3u8');
    expect(out.reason).not.toContain(INTERNAL);
    expect(out.reason).toBe('Upstream host is not permitted');
  });

  it('HLS reachability failure returns the public message', async () => {
    mockedFetch.mockRejectedValueOnce(ssrf());
    const out = await svc.validateStreamUrl('https://cdn.example.com/live.m3u8');
    expect(out.reason).not.toContain(INTERNAL);
    expect(out.reason).toContain('Upstream host is not permitted');
  });

  it('a non-SSRF HLS failure does not echo the raw error', async () => {
    mockedFetch.mockRejectedValueOnce(new Error(`connect ECONNREFUSED ${INTERNAL}:443`));
    const out = await svc.validateStreamUrl('https://cdn.example.com/live.m3u8');
    expect(out.reason).not.toContain(INTERNAL);
    expect(out.reason).not.toContain('ECONNREFUSED');
  });
});

describe('web proxy', () => {
  function fakeRes() {
    const headers: Record<string, string> = {};
    return {
      headers,
      body: '',
      statusCode: 200,
      setHeader(k: string, v: string) {
        headers[k.toLowerCase()] = v;
      },
      removeHeader(k: string) {
        delete headers[k.toLowerCase()];
      },
      status(c: number) {
        this.statusCode = c;
        return this;
      },
      send(b: string) {
        this.body = String(b);
        return this;
      },
    };
  }

  it('an upstream connection error answers a generic message', async () => {
    mockedFetch.mockRejectedValueOnce(new Error(`connect ECONNREFUSED ${INTERNAL}:443 via internal-lb`));
    const res = fakeRes();
    await new ProxyController().proxyWeb('https://example.com/', undefined, undefined, res as never);
    expect(res.statusCode).toBe(502);
    expect(res.body).toContain('Upstream connection failed');
    expect(res.body).not.toContain(INTERNAL);
    expect(res.body).not.toContain('ECONNREFUSED');
  });
});

describe('/health/storage', () => {
  function build(probe: any) {
    const storage = { storageHealthProbe: jest.fn(async () => probe) };
    return new HealthController({} as any, {} as any, {} as any, storage as any, {} as any);
  }

  it('primary transport → { status: "ok" } and nothing else', async () => {
    const out = await build({ ok: true, transport: 'primary', upload: 'ok', read: 'ok', ms: 12 }).storageHealth();
    expect(out).toEqual({ status: 'ok' });
  });

  it('fallback transport → { status: "degraded" } with 200', async () => {
    const out = await build({ ok: true, transport: 'fallback', upload: 'ok', read: 'ok', ms: 12 }).storageHealth();
    expect(out).toEqual({ status: 'degraded' });
  });

  it('failed probe → 503 { status: "down" } without the probe detail', async () => {
    const ctl = build({
      ok: false,
      transport: 'none',
      upload: `fail: getaddrinfo ENOTFOUND project.supabase.internal ${INTERNAL}`,
      read: 'skipped',
      ms: 50,
    });
    const err = await ctl.storageHealth().catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toEqual({ status: 'down' });
  });
});
