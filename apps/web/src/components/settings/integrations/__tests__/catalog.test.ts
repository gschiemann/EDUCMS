/**
 * The Integrations catalog's truth contract (handoff §7.7 / §11).
 *
 * These are the rules that stop the catalog from ever lying:
 *   1. Every entry maps to a §11 state — no invented vocabulary.
 *   2. `unsupported` entries have NO primary action, ever.
 *   3. A `planned` entry gets an action only when real documentation
 *      exists; otherwise it renders inert (no fake "Coming soon" button).
 *   4. `connected` requires a live connection row that says ACTIVE.
 *      A reachable provider catalog is NOT a connection ("reachable ≠
 *      licensed" — a CI gate in this repo).
 *   5. An unreadable status source produces `unknown`, never `Available`.
 */
import {
  adNetworkEntry,
  aiKeyEntry,
  brandVoiceEntry,
  buildCatalog,
  cleverEntry,
  connectionState,
  countConnected,
  countNeedsAttention,
  matchesSearch,
  matchesStateFilter,
  posEntry,
  primaryActionFor,
  streamingEntry,
  CONSUMER_ENTERTAINMENT_ENTRY,
  type AdNetworkLike,
  type IntegrationState,
  type PosProviderLike,
  type StreamProviderLike,
} from '../catalog';
import type { SettingsStatusKind } from '../../shell/primitives';

const ALL_STATES: readonly SettingsStatusKind[] = [
  'ready',
  'connected',
  'attention',
  'degraded',
  'blocked',
  'notConfigured',
  'external',
  'planned',
  'unsupported',
  'unknown',
];

const customHls: StreamProviderLike = {
  id: 'custom-hls',
  name: 'Custom HLS Stream',
  integrationTier: 'DIRECT',
  auth: 'customHls',
  commercialUseLegal: true,
  blurb: 'Paste your own .m3u8 URL.',
};
const atmosphere: StreamProviderLike = {
  id: 'atmosphere',
  name: 'Atmosphere TV',
  integrationTier: 'CLOSED',
  commercialUseLegal: true,
  runsOnProviderDevice: true,
  tierReason: 'Plays on the provider’s own receiver.',
};
const youtube: StreamProviderLike = {
  id: 'youtube',
  name: 'YouTube Live',
  integrationTier: 'CLOSED',
  commercialUseLegal: false,
  tierReason: 'Consumer embeds are not licensed for public venue playback.',
};
const soundtrack: StreamProviderLike = {
  id: 'soundtrack',
  name: 'Soundtrack Your Brand',
  integrationTier: 'PARTNER',
  commercialUseLegal: true,
  tierReason: 'Real API, adapter not built.',
};
const iptv: StreamProviderLike = {
  id: 'iptv-m3u',
  name: 'IPTV M3U Playlist',
  integrationTier: 'CLOSED',
  commercialUseLegal: true,
  tierReason: 'We do not parse multi-channel M3U playlists.',
};

const square: PosProviderLike = { id: 'square', name: 'Square', integrationTier: 'DIRECT' };
const toast: PosProviderLike = { id: 'toast', name: 'Toast', integrationTier: 'PARTNER' };
const aloha: PosProviderLike = { id: 'aloha-ncr', name: 'Aloha / NCR', integrationTier: 'CLOSED' };

const houseOnly: AdNetworkLike = { id: 'house-only', name: 'House ads only', integrationTier: 'DIRECT' };
const hivestack: AdNetworkLike = { id: 'hivestack', name: 'Hivestack', integrationTier: 'PARTNER' };

describe('§11 state vocabulary', () => {
  it('every entry maps to a state in the §11 vocabulary', () => {
    const rows = buildCatalog({
      streamingProviders: [customHls, atmosphere, youtube, soundtrack, iptv],
      streamingConnections: [],
      streamingReachable: true,
      posProviders: [square, toast, aloha],
      posConnections: [],
      posReachable: true,
      adNetworks: [houseOnly, hivestack],
      adConnections: [],
      adsReachable: true,
      aiKey: { configured: false },
      brandVoice: null,
      brandingReachable: true,
      clever: { connected: false },
    });
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      expect(ALL_STATES).toContain(row.state);
    }
  });

  it('gives every state exactly one primary action, and none to unsupported', () => {
    for (const state of ALL_STATES) {
      const action = primaryActionFor(state as IntegrationState, 'integrations/streaming');
      expect(typeof action.kind).toBe('string');
    }
    expect(primaryActionFor('unsupported', 'integrations/streaming').kind).toBe('none');
  });

  it('gives a planned entry an action ONLY when documentation exists', () => {
    expect(primaryActionFor('planned', 'integrations/pos').kind).toBe('none');
    const withDocs = primaryActionFor('planned', 'integrations/pos', { docsUrl: 'https://docs.example' });
    expect(withDocs).toEqual({ kind: 'learnMore', href: 'https://docs.example', external: true });
  });
});

describe('streaming truth model', () => {
  it('an owned/licensed HLS feed with no connection is Not configured, not Connected', () => {
    const e = streamingEntry(customHls, undefined);
    expect(e.state).toBe('notConfigured');
    expect(e.action.kind).toBe('configure');
  });

  it('an ACTIVE connection row is the only thing that earns Connected', () => {
    const e = streamingEntry(customHls, { providerId: 'custom-hls', status: 'ACTIVE' });
    expect(e.state).toBe('connected');
    expect(e.action.kind).toBe('manage');
  });

  it('a provider that plays on its own licensed device is External device with setup instructions', () => {
    const e = streamingEntry(atmosphere, undefined);
    expect(e.state).toBe('external');
    expect(e.action.kind).toBe('instructions');
  });

  it('a consumer service without commercial rights is Unsupported with no action', () => {
    const e = streamingEntry(youtube, undefined);
    expect(e.state).toBe('unsupported');
    expect(e.action.kind).toBe('none');
    expect(e.detail).toMatch(/not licensed/i);
  });

  it('a real service with no shipped adapter is Planned, inert without docs', () => {
    const e = streamingEntry(soundtrack, undefined);
    expect(e.state).toBe('planned');
    expect(e.action.kind).toBe('none');
  });

  it('a CLOSED provider with nothing behind it is Unsupported and explains why', () => {
    const e = streamingEntry(iptv, undefined);
    expect(e.state).toBe('unsupported');
    expect(e.action.kind).toBe('none');
    expect(e.detail).toMatch(/M3U/);
  });

  it('the consumer-entertainment row is unsupported and carries no action', () => {
    expect(CONSUMER_ENTERTAINMENT_ENTRY.state).toBe('unsupported');
    expect(CONSUMER_ENTERTAINMENT_ENTRY.action.kind).toBe('none');
    expect(CONSUMER_ENTERTAINMENT_ENTRY.statusSource).toBe('catalogPolicy');
  });
});

describe('connection status mapping', () => {
  it.each([
    ['ACTIVE', 'connected'],
    ['ERROR', 'degraded'],
    ['REVOKED', 'blocked'],
    ['PENDING', 'attention'],
    ['EXPIRED', 'attention'],
    ['PAUSED', 'attention'],
    ['SOMETHING_NEW', 'unknown'],
  ])('%s → %s', (status, expected) => {
    expect(connectionState(status)).toBe(expected);
  });
});

describe('POS + monetization', () => {
  it('Square with no connection is configurable; Toast is planned; Aloha is unsupported', () => {
    expect(posEntry(square, undefined).state).toBe('notConfigured');
    expect(posEntry(toast, undefined).state).toBe('planned');
    expect(posEntry(aloha, undefined).state).toBe('unsupported');
  });

  it('carries the connection lastSyncedAt through to the row', () => {
    const e = posEntry(square, { providerId: 'square', status: 'ACTIVE', lastSyncedAt: '2026-09-01T10:00:00.000Z' });
    expect(e.lastSyncAt).toBe('2026-09-01T10:00:00.000Z');
  });

  it('a paused ad connection is Needs attention, never Connected', () => {
    const e = adNetworkEntry(houseOnly, { networkId: 'house-only', status: 'PAUSED' });
    expect(e.state).toBe('attention');
    expect(e.action.kind).toBe('resolve');
  });

  it('a partner ad network with no connector is Planned', () => {
    expect(adNetworkEntry(hivestack, undefined).state).toBe('planned');
  });
});

describe('AI, brand voice and Clever', () => {
  it('an unreadable /ai/key read is Unknown, not Available', () => {
    const e = aiKeyEntry(null);
    expect(e.state).toBe('unknown');
    expect(e.statusSource).toBe('unavailable');
    expect(e.action.kind).toBe('refresh');
  });

  it('a stored key that can no longer be decrypted is Degraded', () => {
    expect(aiKeyEntry({ configured: true, keyHealthy: false }).state).toBe('degraded');
  });

  it('a stored, readable key is Connected', () => {
    expect(aiKeyEntry({ configured: true, keyHealthy: true }).state).toBe('connected');
  });

  it('no key is Not configured even when a platform fallback exists', () => {
    // The platform Tier-1 budget must never read as the tenant's own
    // configured provider (CLAUDE.md — AI Integration Concierge tiers).
    expect(aiKeyEntry({ configured: false, platformFallbackAvailable: true }).state).toBe('notConfigured');
  });

  it('brand voice is Ready only when a non-empty value came back', () => {
    expect(brandVoiceEntry('Warm and direct', true).state).toBe('ready');
    expect(brandVoiceEntry('   ', true).state).toBe('notConfigured');
    expect(brandVoiceEntry(null, false).state).toBe('unknown');
  });

  it('an unreachable Clever status is Unknown with no Connect action', () => {
    const e = cleverEntry(null);
    expect(e.state).toBe('unknown');
    expect(e.action.kind).toBe('refresh');
  });

  it('a connected Clever district whose last sync errored is Degraded', () => {
    const e = cleverEntry({ connected: true, lastSync: { errorMessage: 'boom' } });
    expect(e.state).toBe('degraded');
  });
});

describe('unreadable connection lists never fabricate a connection', () => {
  it('drops every connection row when the connections read failed', () => {
    const rows = buildCatalog({
      streamingProviders: [customHls],
      streamingConnections: [{ providerId: 'custom-hls', status: 'ACTIVE' }],
      streamingReachable: false, // the read failed; the rows are not trustworthy
      posReachable: false,
      adsReachable: false,
      brandingReachable: false,
      aiKey: null,
      clever: null,
    });
    const hls = rows.find((r) => r.id === 'streaming:custom-hls');
    expect(hls?.state).toBe('notConfigured');
    expect(hls?.state).not.toBe('connected');
  });
});

describe('filters and counts', () => {
  const rows = buildCatalog({
    streamingProviders: [customHls, atmosphere, youtube, soundtrack],
    streamingConnections: [{ providerId: 'custom-hls', status: 'ACTIVE' }],
    streamingReachable: true,
    posProviders: [square],
    posConnections: [{ providerId: 'square', status: 'ERROR' }],
    posReachable: true,
    adsReachable: true,
    brandingReachable: true,
    aiKey: { configured: true, keyHealthy: true },
    brandVoice: 'Warm',
    clever: { connected: false },
  });

  it('counts connected and needs-attention from real states', () => {
    expect(countConnected(rows)).toBe(3); // HLS + AI key + brand voice (ready)
    expect(countNeedsAttention(rows)).toBe(1); // Square ERROR → degraded
  });

  it('maps the five §7.7 filters onto §11 states', () => {
    const external = rows.filter((r) => matchesStateFilter(r, 'external'));
    expect(external.map((r) => r.id)).toEqual(['streaming:atmosphere']);
    const planned = rows.filter((r) => matchesStateFilter(r, 'planned'));
    expect(planned.map((r) => r.id)).toEqual(['streaming:soundtrack']);
    const available = rows.filter((r) => matchesStateFilter(r, 'available'));
    expect(available.map((r) => r.id)).toContain('clever:roster');
  });

  it('searches names and keywords', () => {
    const hls = rows.find((r) => r.id === 'streaming:custom-hls')!;
    expect(matchesSearch(hls, 'hls')).toBe(true);
    expect(matchesSearch(hls, 'toast')).toBe(false);
    expect(matchesSearch(hls, '')).toBe(true);
  });
});
