/**
 * IntegrationDiscoveryService — honesty / "zero costume" invariants.
 *
 * The beta found POS/SIS/PMS/score-feed/giving connectors presented as
 * connectable (dead-button `connectHref: null` rendered as a button, or a
 * misleading DIRECT tier) that only surfaced "connector in development"
 * AFTER the operator clicked Connect. These tests lock in the contract that
 * kills that class:
 *
 *   - Every candidate carries an explicit `status` (AVAILABLE | COMING_SOON).
 *   - AVAILABLE ⇒ a non-null, app-relative `connectHref` (a real surface).
 *   - COMING_SOON ⇒ `connectHref === null` + a friendly `comingSoonReason`.
 *   - POS provider readiness mirrors the authoritative @cms/api-types catalog
 *     tier (DIRECT ⇒ AVAILABLE; PARTNER/CLOSED ⇒ COMING_SOON).
 *   - Genuinely-wired providers (Square/Clever/SSO) stay AVAILABLE.
 *   - WORSHIP giving (Tithe.ly / Pushpay) is at least discoverable.
 */
import { IntegrationDiscoveryService } from './discovery.service';
import { POS_PROVIDERS, getPosProvider } from '@cms/api-types';

describe('IntegrationDiscoveryService — zero-costume invariants', () => {
  const svc = new IntegrationDiscoveryService();

  // A description that lights up every category we ship rules for, so a
  // single discovery call returns the whole provider set to assert over.
  const everythingDescription =
    'We are a restaurant, bar, retail store, gym, yoga studio, school district, ' +
    'university, hotel, stadium, church temple ministry. We use Square, Toast, ' +
    'Clover, Lightspeed, Shopify, OpenTable, Resy, YouTube, Twitch, NFHS Network, ' +
    'Spotify, Apple Music, SomaFM, Google Calendar, Eventbrite, Mailchimp, ' +
    'Constant Contact, Google Workspace, Microsoft 365, Clever, Instagram, ' +
    'MaxPreps, Mindbody, Tithe.ly, Pushpay.';

  async function allCandidates() {
    const res = await svc.discoverFromDescription(everythingDescription);
    return res.candidates;
  }

  it('every candidate carries an explicit AVAILABLE | COMING_SOON status', async () => {
    const candidates = await allCandidates();
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(['AVAILABLE', 'COMING_SOON']).toContain(c.status);
    }
  });

  it('AVAILABLE ⇒ non-null app-relative connectHref (no dead buttons)', async () => {
    const candidates = await allCandidates();
    const available = candidates.filter((c) => c.status === 'AVAILABLE');
    expect(available.length).toBeGreaterThan(0);
    for (const c of available) {
      expect(c.connectHref).toBeTruthy();
      expect(c.connectHref).toMatch(/^\//); // app-relative route
    }
  });

  it('COMING_SOON ⇒ null connectHref + a friendly comingSoonReason', async () => {
    const candidates = await allCandidates();
    const soon = candidates.filter((c) => c.status === 'COMING_SOON');
    expect(soon.length).toBeGreaterThan(0);
    for (const c of soon) {
      expect(c.connectHref).toBeNull();
      expect(typeof c.comingSoonReason).toBe('string');
      expect((c.comingSoonReason || '').length).toBeGreaterThan(8);
    }
  });

  it('NEVER returns a costume (status:AVAILABLE with no connectHref)', async () => {
    const candidates = await allCandidates();
    const costumes = candidates.filter(
      (c) => c.status === 'AVAILABLE' && !c.connectHref,
    );
    expect(costumes).toEqual([]);
  });

  it('POS provider readiness matches the authoritative catalog tier', async () => {
    // Run a POS-only description so the top-12 cap can't evict a POS row.
    const res = await svc.discoverFromDescription(
      'restaurant using Square, Toast, Clover, Lightspeed and Shopify',
    );
    const byId = new Map(res.candidates.map((c) => [c.id, c]));

    // discovery id → authoritative catalog id (a few differ).
    const map: Record<string, string> = {
      square: 'square',
      toast: 'toast',
      clover: 'clover',
      lightspeed: 'lightspeed-retail',
      shopify: 'shopify-pos',
    };
    for (const [discoveryId, catalogId] of Object.entries(map)) {
      const cand = byId.get(discoveryId);
      expect(cand).toBeDefined();
      const tier = getPosProvider(catalogId)?.integrationTier;
      const expected = tier === 'DIRECT' ? 'AVAILABLE' : 'COMING_SOON';
      expect(cand!.status).toBe(expected);
      if (expected === 'AVAILABLE') {
        expect(cand!.connectHref).toBe('/settings/pos');
      }
    }
  });

  it('keeps genuinely-wired providers AVAILABLE with the right surface', async () => {
    const res = await svc.discoverFromDescription(
      'k-12 school district using Clever, Google Workspace and Microsoft 365; also Square POS',
    );
    const byId = new Map(res.candidates.map((c) => [c.id, c]));

    const square = byId.get('square');
    expect(square?.status).toBe('AVAILABLE');
    expect(square?.connectHref).toBe('/settings/pos');

    const clever = byId.get('clever');
    expect(clever?.status).toBe('AVAILABLE');
    // Clever has a dedicated connect page — NOT the generic SSO page.
    expect(clever?.connectHref).toBe('/settings/integrations/clever');

    const google = byId.get('google-sso');
    expect(google?.status).toBe('AVAILABLE');
    expect(google?.connectHref).toBe('/settings/sso');
  });

  it('makes WORSHIP giving (Tithe.ly / Pushpay) discoverable as COMING_SOON', async () => {
    const res = await svc.discoverFromDescription(
      'We are a church / parish ministry that uses Tithe.ly and Pushpay for giving.',
    );
    const byId = new Map(res.candidates.map((c) => [c.id, c]));

    for (const id of ['tithely', 'pushpay']) {
      const cand = byId.get(id);
      expect(cand).toBeDefined();
      expect(cand!.category).toBe('giving');
      expect(cand!.status).toBe('COMING_SOON');
      expect(cand!.connectHref).toBeNull();
    }
  });

  it('catalog sanity: at least one DIRECT POS provider exists (Square)', () => {
    expect(POS_PROVIDERS.some((p) => p.id === 'square' && p.integrationTier === 'DIRECT')).toBe(true);
  });
});
