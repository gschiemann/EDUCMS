/**
 * Which providers can REALLY be connected from VenueOS today — one answer
 * for the Connections catalog, the point-of-sale page and the live-video page
 * (Settings simplification Phase 1, 2026-10-26; owner: "show ONLY providers
 * that actually connect").
 *
 * The provider lists the API returns are a market map: they also carry
 * services VenueOS cannot connect (a provider's own licensed box, no
 * commercial licence, a partner adapter that has not shipped). Those rows
 * used to sit beside the real ones with "Adapter pending", "Info only" or
 * "connector in development" — choices that are not choices. A provider is
 * listed only when this says yes, or when the organization already has a
 * connection to it (an existing connection is never hidden).
 */

export interface ConnectableStreamProvider {
  id: string;
  integrationTier: 'DIRECT' | 'PARTNER' | 'BRIDGE' | 'CLOSED';
  commercialUseLegal?: boolean;
  runsOnProviderDevice?: boolean;
}

export interface ConnectablePosProvider {
  id: string;
  integrationTier: 'DIRECT' | 'PARTNER' | 'CLOSED';
}

/**
 * Point of sale: every DIRECT provider (Square, Clover, Lightspeed, Shopify,
 * a custom feed) plus Toast, whose API-credential connector discovers the
 * stores, imports the published menu and keeps it synced (the catalog used
 * to hide it as "planned" because the provider list calls it PARTNER).
 */
export function posProviderConnectable(p: ConnectablePosProvider): boolean {
  return p.integrationTier === 'DIRECT' || p.id === 'toast';
}

/** Live video: a stream VenueOS itself can play and is licensed to show. */
export function streamProviderConnectable(p: ConnectableStreamProvider): boolean {
  return p.integrationTier === 'DIRECT' && !p.runsOnProviderDevice && p.commercialUseLegal !== false;
}
