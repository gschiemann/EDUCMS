/**
 * Settings Command Center — the Integrations catalog registry (§7.7).
 *
 * ONE truthful catalog. Every row in it is derived here, in pure
 * functions, from a NAMED status source that is a real API response
 * field — never from a client-side guess, never from a provider id.
 *
 * The rules this file exists to enforce (handoff §11 + CLAUDE.md
 * "reachable ≠ licensed", which is a CI gate):
 *
 *   • A row is `connected` ONLY when a status endpoint returned a row
 *     saying so. No connection row → the state is `notConfigured`,
 *     `planned`, `external`, `unsupported` or `unknown`.
 *   • When the status endpoint could not be read, the state is
 *     `unknown` — never an optimistic default.
 *   • `unsupported` rows carry an explanation and NO primary action.
 *   • `planned` rows get at most a "Learn more" link, and only when the
 *     provider definition actually carries documentation.
 *   • Exactly one primary action per row, derived from the state.
 *
 * Provider-level truth flags come from the API catalogs, which already
 * encode the product truth:
 *   streaming: integrationTier, runsOnProviderDevice, commercialUseLegal
 *   pos:       integrationTier, salesLedOnly
 *   ads:       integrationTier, salesLedOnly (k12Forbidden is filtered
 *              server-side before the list is returned)
 */
import type { SettingsStatusKind } from '../shell/primitives';

export type IntegrationFamily = 'ai' | 'clever' | 'streaming' | 'pos' | 'monetization';

/** §11 vocabulary — reused verbatim; the catalog invents no states. */
export type IntegrationState = SettingsStatusKind;

/**
 * Where the state came from. Rendered next to every row so no status is
 * unattributed — an operator can always see which endpoint said it.
 */
export type IntegrationStatusSource =
  | 'streamingConnections'
  | 'posConnections'
  | 'adsConnections'
  | 'aiKey'
  | 'brandingMe'
  | 'cleverStatus'
  | 'catalogPolicy'
  | 'unavailable';

export type IntegrationActionKind =
  | 'manage'
  | 'resolve'
  | 'diagnose'
  | 'configure'
  | 'instructions'
  | 'learnMore'
  | 'refresh'
  | 'none';

export interface IntegrationAction {
  kind: IntegrationActionKind;
  /** Route segment under `/[schoolId]/settings/`, or an absolute URL when `external`. */
  href?: string;
  external?: boolean;
}

export interface IntegrationCatalogEntry {
  id: string;
  name: string;
  family: IntegrationFamily;
  /** Route segment under `/[schoolId]/settings/` that manages this row. */
  route: string;
  statusSource: IntegrationStatusSource;
  state: IntegrationState;
  /** Plain-English line: what this connection enables, or why it cannot connect. */
  detail?: string;
  /** ISO timestamp when the status source carries one. */
  lastSyncAt?: string;
  action: IntegrationAction;
  searchTerms: readonly string[];
}

export const INTEGRATION_FAMILIES: readonly IntegrationFamily[] = [
  'ai',
  'clever',
  'streaming',
  'pos',
  'monetization',
];

export const FAMILY_ROUTES: Record<IntegrationFamily, string> = {
  ai: 'integrations/ai',
  clever: 'integrations/clever',
  streaming: 'integrations/streaming',
  pos: 'integrations/pos',
  monetization: 'integrations/monetization',
};

/** The five state filters in §7.7, mapped onto the §11 vocabulary. */
export type IntegrationStateFilter = 'connected' | 'attention' | 'available' | 'external' | 'planned';

export const STATE_FILTER_MEMBERS: Record<IntegrationStateFilter, readonly IntegrationState[]> = {
  connected: ['connected', 'ready'],
  attention: ['attention', 'degraded', 'blocked', 'unknown'],
  available: ['notConfigured'],
  external: ['external'],
  planned: ['planned'],
};

/**
 * Exactly one primary action per state (§7.7). `unsupported` and a
 * `planned` row with no documentation get NO interactive control —
 * that is the "no fake Coming soon button" rule from §11.
 */
export function primaryActionFor(
  state: IntegrationState,
  route: string,
  opts: { docsUrl?: string } = {},
): IntegrationAction {
  switch (state) {
    case 'connected':
    case 'ready':
      return { kind: 'manage', href: route };
    case 'attention':
      return { kind: 'resolve', href: route };
    case 'degraded':
    case 'blocked':
      return { kind: 'diagnose', href: route };
    case 'notConfigured':
      return { kind: 'configure', href: route };
    case 'external':
      return { kind: 'instructions', href: route };
    case 'planned':
      return opts.docsUrl ? { kind: 'learnMore', href: opts.docsUrl, external: true } : { kind: 'none' };
    case 'unknown':
      return { kind: 'refresh' };
    case 'unsupported':
    default:
      return { kind: 'none' };
  }
}

/* ─────────────────────────── inputs ─────────────────────────── */

export interface ConnectionRowLike {
  providerId?: string;
  networkId?: string;
  status: string;
  statusReason?: string | null;
  lastSyncedAt?: string | null;
}

export interface StreamProviderLike {
  id: string;
  name: string;
  integrationTier: 'DIRECT' | 'PARTNER' | 'BRIDGE' | 'CLOSED';
  blurb?: string;
  auth?: string;
  commercialUseLegal?: boolean;
  requiresVenueLicense?: boolean;
  runsOnProviderDevice?: boolean;
  tierReason?: string;
  docsUrl?: string;
}

export interface PosProviderLike {
  id: string;
  name: string;
  integrationTier: 'DIRECT' | 'PARTNER' | 'CLOSED';
  blurb?: string;
  tierReason?: string;
  salesLedOnly?: boolean;
  docsUrl?: string;
}

export interface AdNetworkLike {
  id: string;
  name: string;
  integrationTier: 'DIRECT' | 'PARTNER' | 'CLOSED';
  blurb?: string;
  tierReason?: string;
  salesLedOnly?: boolean;
  docsUrl?: string;
}

export interface AiKeyStatusLike {
  configured: boolean;
  provider?: string | null;
  model?: string | null;
  keyHealthy?: boolean | null;
  platformFallbackAvailable?: boolean;
  setAt?: string | null;
}

export interface CleverStatusLike {
  connected: boolean;
  districtId?: string | null;
  connectedAt?: string | null;
  lastSync?: { syncStartedAt?: string | null; syncCompletedAt?: string | null; errorMessage?: string | null } | null;
}

/**
 * A live connection row → §11 state.
 *
 * The three connection tables (stream / POS / ad) share one status enum
 * shape, so the mapping lives once. ACTIVE is the ONLY state that earns
 * green; everything else is an honest amber/red/neutral.
 */
export function connectionState(status: string): IntegrationState {
  switch (status) {
    case 'ACTIVE':
      return 'connected';
    case 'ERROR':
      return 'degraded';
    case 'REVOKED':
      return 'blocked';
    case 'PENDING':
    case 'EXPIRED':
    case 'PAUSED':
      return 'attention';
    default:
      // A status the client does not recognise is not a status.
      return 'unknown';
  }
}

/* ───────────────────────── streaming ───────────────────────── */

/**
 * Streaming provider → §11 state.
 *
 * Order matters and is deliberate: a real connection row always wins,
 * because it is the only evidence of an actual connection. Otherwise the
 * provider definition decides, using the flags the API already ships.
 */
export function streamingEntry(
  p: StreamProviderLike,
  connection: ConnectionRowLike | undefined,
): IntegrationCatalogEntry {
  const route = FAMILY_ROUTES.streaming;
  let state: IntegrationState;
  let detail: string | undefined;

  if (connection) {
    state = connectionState(connection.status);
    detail = connection.statusReason || p.blurb;
  } else if (p.runsOnProviderDevice) {
    // Declared FACT on the provider: playback happens on the provider's
    // own licensed receiver. VenueOS has no input-switch capability, so
    // this is never presented as connectable.
    state = 'external';
    detail = p.tierReason || p.blurb;
  } else if (p.commercialUseLegal === false) {
    // Technically embeddable is not commercially licensed. Intentionally
    // unavailable → `unsupported`, explanation, no connect action.
    state = 'unsupported';
    detail = p.tierReason || p.blurb;
  } else if (p.integrationTier === 'DIRECT') {
    state = 'notConfigured';
    detail = p.blurb;
  } else if (p.integrationTier === 'PARTNER') {
    // Real business service, real API, no finished adapter here.
    state = 'planned';
    detail = p.tierReason || p.blurb;
  } else {
    // CLOSED / BRIDGE with no provider device: nothing in the codebase
    // can complete it (e.g. no M3U parser exists).
    state = 'unsupported';
    detail = p.tierReason || p.blurb;
  }

  return {
    id: `streaming:${p.id}`,
    name: p.name,
    family: 'streaming',
    route,
    statusSource: 'streamingConnections',
    state,
    detail,
    action: primaryActionFor(state, route, { docsUrl: p.docsUrl }),
    searchTerms: [p.name, p.id, 'streaming', 'video', 'channel'],
  };
}

/* ─────────────────────────── POS ─────────────────────────── */

export function posEntry(
  p: PosProviderLike,
  connection: ConnectionRowLike | undefined,
): IntegrationCatalogEntry {
  const route = FAMILY_ROUTES.pos;
  let state: IntegrationState;
  let detail: string | undefined;

  if (connection) {
    state = connectionState(connection.status);
    detail = connection.statusReason || p.blurb;
  } else if (p.integrationTier === 'DIRECT') {
    state = 'notConfigured';
    detail = p.blurb;
  } else if (p.integrationTier === 'PARTNER') {
    // No sync handler exists yet — the connect modal already says so.
    state = 'planned';
    detail = p.tierReason || p.blurb;
  } else {
    state = 'unsupported';
    detail = p.tierReason || p.blurb;
  }

  return {
    id: `pos:${p.id}`,
    name: p.name,
    family: 'pos',
    route,
    statusSource: 'posConnections',
    state,
    detail,
    lastSyncAt: connection?.lastSyncedAt ?? undefined,
    action: primaryActionFor(state, route, { docsUrl: p.docsUrl }),
    searchTerms: [p.name, p.id, 'pos', 'menu', 'catalog', 'prices'],
  };
}

/* ────────────────────── monetization ────────────────────── */

export function adNetworkEntry(
  n: AdNetworkLike,
  connection: ConnectionRowLike | undefined,
): IntegrationCatalogEntry {
  const route = FAMILY_ROUTES.monetization;
  let state: IntegrationState;
  let detail: string | undefined;

  if (connection) {
    state = connectionState(connection.status);
    detail = connection.statusReason || n.blurb;
  } else if (n.integrationTier === 'DIRECT') {
    state = 'notConfigured';
    detail = n.blurb;
  } else if (n.integrationTier === 'PARTNER') {
    state = 'planned';
    detail = n.tierReason || n.blurb;
  } else {
    state = 'unsupported';
    detail = n.tierReason || n.blurb;
  }

  return {
    id: `ads:${n.id}`,
    name: n.name,
    family: 'monetization',
    route,
    statusSource: 'adsConnections',
    state,
    detail,
    action: primaryActionFor(state, route, { docsUrl: n.docsUrl }),
    searchTerms: [n.name, n.id, 'ads', 'monetization', 'sponsors', 'revenue'],
  };
}

/* ──────────────────────────── AI ──────────────────────────── */

/**
 * `GET /ai/key` proves exactly one thing: a tenant key is stored and can
 * still be decrypted (`keyHealthy` flips false after a secret rotation).
 * The detail line says that, rather than implying the provider has
 * accepted the key on a live call.
 */
export function aiKeyEntry(status: AiKeyStatusLike | null | undefined): IntegrationCatalogEntry {
  const route = FAMILY_ROUTES.ai;
  let state: IntegrationState;
  let statusSource: IntegrationStatusSource = 'aiKey';
  let detail: string | undefined;

  if (!status) {
    state = 'unknown';
    statusSource = 'unavailable';
    detail = undefined;
  } else if (status.configured && status.keyHealthy === false) {
    state = 'degraded';
  } else if (status.configured) {
    state = 'connected';
  } else {
    state = 'notConfigured';
  }

  return {
    id: 'ai:key',
    name: 'AI provider key',
    family: 'ai',
    route,
    statusSource,
    state,
    detail,
    lastSyncAt: status?.setAt ?? undefined,
    action: primaryActionFor(state, route),
    searchTerms: ['ai key', 'byok', 'anthropic', 'openai', 'google', 'gemini', 'claude', 'model'],
  };
}

/** Brand voice is a free-text field on `GET /branding/me`; set or not set. */
export function brandVoiceEntry(brandVoice: string | null | undefined, reachable: boolean): IntegrationCatalogEntry {
  const route = FAMILY_ROUTES.ai;
  const state: IntegrationState = !reachable ? 'unknown' : brandVoice && brandVoice.trim() ? 'ready' : 'notConfigured';
  return {
    id: 'ai:brandVoice',
    name: 'Brand voice',
    family: 'ai',
    route,
    statusSource: reachable ? 'brandingMe' : 'unavailable',
    state,
    action: primaryActionFor(state, route),
    searchTerms: ['brand voice', 'tone', 'writing style', 'ai'],
  };
}

/* ───────────────────────── Clever ───────────────────────── */

export function cleverEntry(status: CleverStatusLike | null | undefined): IntegrationCatalogEntry {
  const route = FAMILY_ROUTES.clever;
  let state: IntegrationState;
  if (!status) {
    // The roster-sync status endpoint did not answer. §11 `unknown` —
    // an unreachable endpoint is never rendered as "available to connect".
    state = 'unknown';
  } else if (status.connected && status.lastSync?.errorMessage) {
    state = 'degraded';
  } else if (status.connected) {
    state = 'connected';
  } else {
    state = 'notConfigured';
  }
  return {
    id: 'clever:roster',
    name: 'Clever roster sync',
    family: 'clever',
    route,
    statusSource: status ? 'cleverStatus' : 'unavailable',
    state,
    lastSyncAt: status?.lastSync?.syncCompletedAt ?? status?.lastSync?.syncStartedAt ?? undefined,
    action: primaryActionFor(state, route),
    searchTerms: ['clever', 'roster', 'sis', 'students', 'staff', 'district'],
  };
}

/* ───────────────────── static policy rows ───────────────────── */

/**
 * Consumer entertainment services. There is no provider row for these in
 * the API catalog because there is nothing to connect: no consumer
 * subscription grants public-performance rights, so the product refuses
 * to present them as connectable. `catalog.policy` is the status source —
 * a stated product policy, not a reading of a live endpoint.
 */
export const CONSUMER_ENTERTAINMENT_ENTRY: IntegrationCatalogEntry = {
  id: 'streaming:consumer-entertainment',
  name: 'Hulu · Netflix · Disney+ · Max',
  family: 'streaming',
  route: FAMILY_ROUTES.streaming,
  statusSource: 'catalogPolicy',
  state: 'unsupported',
  action: { kind: 'none' },
  searchTerms: ['hulu', 'netflix', 'disney', 'max', 'consumer', 'entertainment'],
};

/* ─────────────────────────── build ─────────────────────────── */

export interface CatalogInputs {
  streamingProviders?: readonly StreamProviderLike[];
  streamingConnections?: readonly ConnectionRowLike[];
  streamingReachable: boolean;
  posProviders?: readonly PosProviderLike[];
  posConnections?: readonly ConnectionRowLike[];
  posReachable: boolean;
  adNetworks?: readonly AdNetworkLike[];
  adConnections?: readonly ConnectionRowLike[];
  adsReachable: boolean;
  aiKey?: AiKeyStatusLike | null;
  brandVoice?: string | null;
  brandingReachable: boolean;
  clever?: CleverStatusLike | null;
}

function firstConnection(
  rows: readonly ConnectionRowLike[] | undefined,
  key: 'providerId' | 'networkId',
  id: string,
): ConnectionRowLike | undefined {
  if (!rows) return undefined;
  // An ACTIVE row beats a stale PENDING/ERROR row for the same provider.
  const matches = rows.filter((r) => r[key] === id);
  return matches.find((r) => r.status === 'ACTIVE') ?? matches[0];
}

/**
 * Build the whole catalog. Pure: same inputs → same rows, in a stable
 * order (AI, Clever, streaming, POS, monetization; providers in the order
 * the API returned them, which is the API's own priority order).
 */
export function buildCatalog(input: CatalogInputs): IntegrationCatalogEntry[] {
  const rows: IntegrationCatalogEntry[] = [];

  rows.push(aiKeyEntry(input.aiKey));
  rows.push(brandVoiceEntry(input.brandVoice, input.brandingReachable));
  rows.push(cleverEntry(input.clever));

  for (const p of input.streamingProviders ?? []) {
    rows.push(
      streamingEntry(
        p,
        input.streamingReachable ? firstConnection(input.streamingConnections, 'providerId', p.id) : undefined,
      ),
    );
  }
  rows.push(CONSUMER_ENTERTAINMENT_ENTRY);

  for (const p of input.posProviders ?? []) {
    rows.push(
      posEntry(p, input.posReachable ? firstConnection(input.posConnections, 'providerId', p.id) : undefined),
    );
  }

  for (const n of input.adNetworks ?? []) {
    rows.push(
      adNetworkEntry(n, input.adsReachable ? firstConnection(input.adConnections, 'networkId', n.id) : undefined),
    );
  }

  return rows;
}

/** Rows whose §11 state means an operator has something to fix right now. */
export const NEEDS_ATTENTION_STATES: readonly IntegrationState[] = ['attention', 'degraded', 'blocked'];

export function countConnected(rows: readonly IntegrationCatalogEntry[]): number {
  return rows.filter((r) => r.state === 'connected' || r.state === 'ready').length;
}

export function countNeedsAttention(rows: readonly IntegrationCatalogEntry[]): number {
  return rows.filter((r) => NEEDS_ATTENTION_STATES.includes(r.state)).length;
}

export function matchesStateFilter(entry: IntegrationCatalogEntry, filter: IntegrationStateFilter): boolean {
  return STATE_FILTER_MEMBERS[filter].includes(entry.state);
}

export function matchesSearch(entry: IntegrationCatalogEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (entry.name.toLowerCase().includes(q)) return true;
  if (entry.detail?.toLowerCase().includes(q)) return true;
  return entry.searchTerms.some((term) => term.toLowerCase().includes(q));
}
