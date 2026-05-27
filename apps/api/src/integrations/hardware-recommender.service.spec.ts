/**
 * Smoke coverage for HardwareRecommenderService — the small lookup
 * service that backs the Concierge's per-vertical hardware suggestion.
 *
 * We don't mock anything; this service is pure (no DB, no HTTP) so the
 * tests just hit the catalog data + the vertical map.
 */
import { HardwareRecommenderService } from './hardware-recommender.service';

describe('HardwareRecommenderService', () => {
  let svc: HardwareRecommenderService;

  beforeEach(() => {
    svc = new HardwareRecommenderService();
  });

  describe('recommend()', () => {
    it('returns the Goodview EP6N for a SPORTS vertical', () => {
      const rec = svc.recommend('SPORTS');
      expect(rec).not.toBeNull();
      expect(rec?.modelId).toBe('goodview-ep6n');
      expect(rec?.name).toMatch(/EP6N/i);
      expect(rec?.requiredFor.length).toBeGreaterThan(0);
      // Sports-specific blurb mentions the load-bearing capabilities.
      expect(rec?.blurb).toMatch(/dual-serial|GPIO|broadcast/);
    });

    it('returns null for verticals with no recommendation yet (K12)', () => {
      expect(svc.recommend('K12')).toBeNull();
    });

    it('returns null for unknown verticals', () => {
      expect(svc.recommend('UNKNOWN_VERTICAL')).toBeNull();
    });

    it('returns null when vertical is null or undefined', () => {
      expect(svc.recommend(null)).toBeNull();
      expect(svc.recommend(undefined)).toBeNull();
      expect(svc.recommend('')).toBeNull();
    });

    it('exposes top-3 highlights for the recommendation', () => {
      const rec = svc.recommend('SPORTS');
      expect(rec?.topHighlights).toHaveLength(3);
      // The first highlight calls out the I/O ring that's the EP6N's
      // main differentiator — guard against the catalog being reordered
      // accidentally.
      expect(rec?.topHighlights[0]).toMatch(/RS232|Phoenix|serial/i);
    });

    it('exposes an order/spec doc link', () => {
      const rec = svc.recommend('SPORTS');
      expect(rec?.href).toMatch(/EP6N|hardware/i);
    });
  });

  describe('catalog()', () => {
    it('returns the full hardware catalog including EP6N', () => {
      const catalog = svc.catalog();
      const ids = catalog.map((c) => c.id);
      expect(ids).toContain('goodview-ep6n');
      expect(ids).toContain('goodview-ecbox3576');
      expect(ids).toContain('novastar-taurus');
      expect(ids).toContain('pi5');
      expect(ids).toContain('generic-android');
      expect(ids).toContain('web');
    });

    it('marks the EP6N as supporting the WiringPanel', () => {
      const ep6n = svc.catalog().find((c) => c.id === 'goodview-ep6n');
      expect(ep6n?.hasWiringPanel).toBe(true);
    });

    it('marks the NovaStar Taurus with the Chromium-83 flag', () => {
      const taurus = svc.catalog().find((c) => c.id === 'novastar-taurus');
      expect(taurus?.chromium83).toBe(true);
    });
  });

  describe('describe()', () => {
    it('looks up a specific model by id', () => {
      const ep6n = svc.describe('goodview-ep6n');
      expect(ep6n?.name).toMatch(/EP6N/i);
      expect(ep6n?.manufacturer).toBe('Goodview');
    });

    it('returns null for unknown models', () => {
      expect(svc.describe('xyz-unknown')).toBeNull();
    });
  });

  describe('verticalMap()', () => {
    it('exposes SPORTS → goodview-ep6n mapping', () => {
      expect(svc.verticalMap().SPORTS).toBe('goodview-ep6n');
    });
  });
});
