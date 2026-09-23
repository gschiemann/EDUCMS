/**
 * The Concierge knows the venue's POS — controller surface (2026-09-22).
 *
 *   GET  concierge/pos-context   — keyed on the session tenant only.
 *   POST concierge/reference/url — now also says which POS the site links to
 *                                  (`detectedPos`), from the REAL
 *                                  IntegrationDiscoveryService run over a real
 *                                  restaurant homepage's Toast links (fixture:
 *                                  __fixtures__/restaurant-home-toast-links.html).
 *
 * safeFetch is the only thing stubbed: it hands the discovery service the page,
 * exactly as it would have come off the network.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { HttpException } from '@nestjs/common';

jest.mock('../branding/safe-fetch', () => {
  const actual = jest.requireActual('../branding/safe-fetch');
  return { ...actual, safeFetch: jest.fn() };
});
import { safeFetch } from '../branding/safe-fetch';
import { TemplatesController } from './templates.controller';
import { IntegrationDiscoveryService } from '../integrations/discovery.service';

const safeFetchMock = safeFetch as unknown as jest.Mock;
const TOAST_HOME = readFileSync(join(__dirname, '__fixtures__', 'restaurant-home-toast-links.html'), 'utf8');
const PLAIN_HOME = '<!doctype html><html><head><title>Joe Coffee</title></head><body><h1>Joe Coffee</h1><a href="/menu">Menu</a></body></html>';

const BRANDING_PREVIEW = {
  displayName: 'Example Taqueria',
  description: 'Fresh Mexican food, made to order',
  palette: { primary: '#c8102e', accent: '#ffc72c' },
  logos: [{ url: 'https://taqueria.example/logo.png' }],
};

function page(html: string) {
  return { body: Buffer.from(html, 'utf8'), contentType: 'text/html', finalUrl: 'https://taqueria.example/', status: 200 };
}

function makeController(over: { scrape?: () => Promise<any>; discovery?: any; pos?: any } = {}) {
  const controller = Object.create(TemplatesController.prototype) as TemplatesController;
  (controller as any).brandingScraper = { scrape: jest.fn(over.scrape ?? (async () => BRANDING_PREVIEW)) };
  (controller as any).ai = { extractSiteMenu: jest.fn(async () => null) };
  (controller as any).discovery = over.discovery === undefined ? new IntegrationDiscoveryService() : over.discovery;
  (controller as any).pos = over.pos;
  (controller as any).auditLogger = { warn: jest.fn() };
  return controller;
}

const req = { user: { tenantId: 'tenant-home', id: 'user-1', role: 'SCHOOL_ADMIN' } } as any;

beforeEach(() => safeFetchMock.mockReset());

describe('POST concierge/reference/url — detectedPos', () => {
  it('a site that links to Toast\'s ordering app comes back with detectedPos: Toast', async () => {
    safeFetchMock.mockResolvedValue(page(TOAST_HOME));
    const ref: any = await makeController().conciergeReferenceUrl(req, { url: 'taqueria.example' } as any);
    expect(ref.detectedPos).toEqual([{ providerId: 'toast', name: 'Toast', confidence: 0.7 }]);
    // Branding is untouched by any of this.
    expect(ref.kind).toBe('url');
    expect(ref.palette).toContain('#c8102e');
    // The discovery read went to the normalized URL, through the SSRF-safe fetch.
    expect(safeFetchMock).toHaveBeenCalledWith('https://taqueria.example', expect.any(Object));
  });

  it('a site with no POS link says nothing about a POS (byte-identical reference shape)', async () => {
    safeFetchMock.mockResolvedValue(page(PLAIN_HOME));
    const ref: any = await makeController().conciergeReferenceUrl(req, { url: 'joecoffee.example' } as any);
    expect(ref).not.toHaveProperty('detectedPos');
  });

  it('a passing mention ("we take Square readers") is not a POS link', async () => {
    safeFetchMock.mockResolvedValue(page('<html><body><p>We accept Square reader payments.</p></body></html>'));
    const ref: any = await makeController().conciergeReferenceUrl(req, { url: 'joecoffee.example' } as any);
    expect(ref).not.toHaveProperty('detectedPos');
  });

  it('a discovery failure never fails the paste', async () => {
    const ref: any = await makeController({ discovery: { discoverFromUrl: jest.fn(async () => { throw new Error('boom'); }) } })
      .conciergeReferenceUrl(req, { url: 'taqueria.example' } as any);
    expect(ref.kind).toBe('url');
    expect(ref).not.toHaveProperty('detectedPos');
  });

  it('a failed scrape is still the friendly 422, with the detection settled (no unhandled rejection)', async () => {
    safeFetchMock.mockResolvedValue(page(TOAST_HOME));
    const controller = makeController({ scrape: async () => { throw new Error('bot wall'); } });
    await expect(controller.conciergeReferenceUrl(req, { url: 'taqueria.example' } as any)).rejects.toBeInstanceOf(HttpException);
  });
});

describe('GET concierge/pos-context', () => {
  it('reads the SESSION tenant\'s POS context — never an id from the request', async () => {
    const pos = { conciergePosContext: jest.fn(async (t: string) => ({ connections: [], connectable: [], for: t })) };
    const out: any = await makeController({ pos }).conciergePosContext(req);
    expect(pos.conciergePosContext).toHaveBeenCalledWith('tenant-home');
    expect(out.for).toBe('tenant-home');
  });

  it('without the POS module it still answers: nothing connected, every self-serve POS connectable', async () => {
    const out: any = await makeController({ pos: undefined }).conciergePosContext(req);
    expect(out.connections).toEqual([]);
    expect(out.connectable.map((p: any) => p.providerId)).toEqual(['square', 'toast', 'clover', 'lightspeed-retail', 'shopify-pos']);
  });
});
