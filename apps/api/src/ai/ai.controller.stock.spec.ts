/**
 * AiController — Wave B / editor-crush B1 (2026-07-02) stock-photo endpoints.
 *
 * GET  /api/v1/ai/stock-search — thin authenticated proxy over
 *   AiService.searchStockPhotos (itself a thin wrapper over
 *   StockImageService.searchMany). Mocks AiService directly (matches the
 *   existing direct-instantiation controller-spec pattern, e.g.
 *   audit.controller.spec.ts) rather than bootstrapping a full Nest
 *   TestingModule — this is a request/response shape + wiring test, the
 *   graceful-degradation contract itself is already pinned in
 *   stock-image.service.spec.ts.
 * POST /api/v1/ai/stock-rehost — re-hosts an operator-picked Pexels URL via
 *   AiService.rehostStockPhoto.
 */

import { AiController } from './ai.controller';

function makeController(aiOverrides: Record<string, any> = {}) {
  const ai: any = {
    searchStockPhotos: jest.fn().mockResolvedValue([]),
    isStockConfigured: jest.fn().mockReturnValue(true),
    rehostStockPhoto: jest.fn().mockResolvedValue(undefined),
    ...aiOverrides,
  };
  const controller = new AiController(ai);
  return { controller, ai };
}

const req = (overrides: any = {}) => ({ user: { tenantId: 't1', id: 'u1', role: 'SCHOOL_ADMIN' }, ...overrides });

describe('AiController.stockSearch (GET /ai/stock-search)', () => {
  it('forwards the query + orientation to AiService.searchStockPhotos', async () => {
    const { controller, ai } = makeController();
    await controller.stockSearch('sunset over stadium', 'portrait');
    expect(ai.searchStockPhotos).toHaveBeenCalledWith({
      query: 'sunset over stadium',
      orientation: 'portrait',
      limit: 12,
    });
  });

  it('defaults orientation to landscape for anything other than "portrait"', async () => {
    const { controller, ai } = makeController();
    await controller.stockSearch('campus quad', undefined);
    expect(ai.searchStockPhotos).toHaveBeenCalledWith({
      query: 'campus quad',
      orientation: 'landscape',
      limit: 12,
    });
  });

  it('returns { results, configured } shaped for the picker grid', async () => {
    const photos = [{ url: 'https://images.pexels.com/photos/1/a.jpg', photographer: 'Jane' }];
    const { controller } = makeController({ searchStockPhotos: jest.fn().mockResolvedValue(photos) });
    const res = await controller.stockSearch('craft beer bar', 'landscape');
    expect(res).toEqual({ results: photos, configured: true });
  });

  it('reports configured:false when no Pexels key is set (FE hides the tab)', async () => {
    const { controller } = makeController({ isStockConfigured: jest.fn().mockReturnValue(false) });
    const res = await controller.stockSearch('anything', undefined);
    expect(res.configured).toBe(false);
    expect(res.results).toEqual([]);
  });

  it('caps the forwarded query at 200 chars (API-boundary bound)', async () => {
    const { controller, ai } = makeController();
    const longQuery = 'x'.repeat(500);
    await controller.stockSearch(longQuery, undefined);
    expect(ai.searchStockPhotos.mock.calls[0][0].query).toHaveLength(200);
  });

  it('treats a missing q as an empty string, not undefined (never throws)', async () => {
    const { controller, ai } = makeController();
    await controller.stockSearch(undefined, undefined);
    expect(ai.searchStockPhotos).toHaveBeenCalledWith({ query: '', orientation: 'landscape', limit: 12 });
  });
});

describe('AiController.stockRehost (POST /ai/stock-rehost)', () => {
  it('passes the caller tenantId + body url into AiService.rehostStockPhoto', async () => {
    const { controller, ai } = makeController({
      rehostStockPhoto: jest.fn().mockResolvedValue('https://supabase.example/ai-stock/t1/abc123.jpg'),
    });
    const res = await controller.stockRehost(req(), { url: 'https://images.pexels.com/photos/1/a.jpg' });
    expect(ai.rehostStockPhoto).toHaveBeenCalledWith('t1', 'https://images.pexels.com/photos/1/a.jpg');
    expect(res).toEqual({ url: 'https://supabase.example/ai-stock/t1/abc123.jpg' });
  });

  it('returns { url: undefined } on a rehost failure — never throws (best-effort contract)', async () => {
    const { controller } = makeController({ rehostStockPhoto: jest.fn().mockResolvedValue(undefined) });
    const res = await controller.stockRehost(req(), { url: 'https://images.pexels.com/photos/1/a.jpg' });
    expect(res).toEqual({ url: undefined });
  });
});
