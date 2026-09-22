/**
 * IntegrationDiscoveryService — Concierge primitive.
 *
 * Sits behind two endpoints (POST /integrations/discover for URL,
 * POST /integrations/describe for free-text) and returns a ranked
 * list of integration candidates the operator might want to wire up.
 *
 * Design intent: an operator pastes their existing website URL
 * (e.g. "https://www.lcsnc.org") OR describes their business in one
 * sentence ("We're a yoga studio in Brooklyn"). The classifier returns
 * a ranked list — POS / reservations / payments / streaming / calendar
 * / email / fitness / identity / SIS / social / music — each with a
 * confidence score + a plain-English blurb the Concierge UI explains.
 *
 * From CLAUDE.md's "AI Integration Concierge — vision" section:
 *   "make shit not so overwhelming for people that they don't need
 *    to get an IT guy or consultants ... make the path so automated
 *    that they don't know how they worked without VenueOS in the past"
 *
 * Reuses `safeFetch` from `apps/api/src/branding/safe-fetch.ts` for
 * SSRF defense — never re-implement URL validation here. All probes
 * are static cheerio parsing; no headless browser, no script
 * execution (consistent with the branding scraper's threat model).
 *
 * 2026-05-26 — Recreated after being wiped twice during parallel-agent
 * contention (pre-worktree-isolation). Now in worktree-isolated
 * commits with lead owning the merge per the new Agent Dispatch
 * Protocol.
 */
import { Injectable, Logger } from '@nestjs/common';
import { load as cheerioLoad } from 'cheerio';
import { safeFetch, SsrfError } from '../branding/safe-fetch';
import { POS_PROVIDERS } from '@cms/api-types';

export type IntegrationCategory =
  | 'pos'
  | 'reservations'
  | 'payments'
  | 'streaming'
  | 'music'
  | 'calendar'
  | 'email'
  | 'identity'
  | 'sis'
  | 'social'
  | 'fitness'
  | 'sports-data'
  | 'giving'
  | 'design'
  | 'analytics';

/**
 * Honest connector status — mirrors the vocabulary used by the
 * integrations-health controller (`READY | DEGRADED | NOT_CONFIGURED |
 * COMING_SOON`). The Concierge UI keys off this so a not-yet-wired
 * provider renders a distinct "Coming soon" chip instead of a dead
 * "Connect" button.
 *
 *   - `AVAILABLE`   — a real, self-serve connect path exists TODAY
 *                     (`connectHref` is non-null and routable). Connecting
 *                     it actually syncs / authorizes end-to-end.
 *   - `COMING_SOON` — the provider is recognised but NOT wired end-to-end
 *                     yet (partner program, no public CMS API, or the sync
 *                     handler hasn't shipped). `connectHref` is null and
 *                     `comingSoonReason` carries a friendly explanation.
 *
 * 2026-06-27 — added to kill the "costume" class the beta found: a
 * provider presented as connectable (DIRECT tier, or a null/dead
 * connectHref rendered as a button) that surfaces "connector in
 * development" only AFTER the operator clicks Connect. Every provider in
 * RULES is now graded honestly; zero costumes.
 */
export type ConnectorStatus = 'AVAILABLE' | 'COMING_SOON';

export interface ProviderCandidate {
  id: string;
  name: string;
  category: IntegrationCategory;
  confidence: number; // 0..1
  /** Plain-English explanation the Concierge UI shows the operator. */
  blurb: string;
  /** Why we matched — for debug + the "we found this on your site" badge. */
  matchedSignals: string[];
  /** Honest connector readiness — drives the Connect vs "Coming soon" chip. */
  status: ConnectorStatus;
  /**
   * Where the operator goes to connect this. Non-null ONLY when
   * `status === 'AVAILABLE'` (a real, routable connect surface). Always
   * null for `COMING_SOON` providers so the UI can't render a dead button.
   */
  connectHref: string | null;
  /**
   * Friendly "why it's not connectable yet" line, present ONLY when
   * `status === 'COMING_SOON'`. e.g. "Coming soon — Toast sync in
   * development (Toast Partner Program)."
   */
  comingSoonReason?: string;
  /**
   * The operator's OWN destination for this provider, when we could
   * confidently extract one from their homepage — e.g. their actual
   * "https://youtube.com/@theirchannel" link, not just "we detected
   * YouTube signals." World-class build (2026-07-01, App Library Tier 2
   * "concierge auto-fill"): this is what turns "we noticed you use
   * YouTube" (useless) into "here's your board, one tap to add"
   * (effortless) — the App Library UI pre-fills the matching app's
   * config form with this value. Populated ONLY for rule ids that have a
   * matching entry in `OWN_LINK_MATCHERS` below; every other candidate
   * carries `undefined` here exactly as before (fully additive field).
   */
  detectedValue?: string;
}

export interface DiscoveryResult {
  source: 'url' | 'description';
  inputSummary: string;
  candidates: ProviderCandidate[];
  warnings: string[];
  /**
   * The operator's own extracted links/handles, keyed by a stable id the
   * App Library's concierge-map.ts understands (youtube / vimeo / twitch /
   * instagram / facebook-page / google-slides / google-sheets / calendar /
   * news-rss). Deliberately a flat, provider-agnostic map SEPARATE from
   * `candidates` — this is populated even for providers that have no
   * matching integration RULE (e.g. we don't have a "google-slides"
   * connector rule, but the App Library absolutely wants that link).
   * Deterministic/keyless (no AI cost) — see `extractOwnLinks`.
   */
  ownLinks: Record<string, string>;
}

/**
 * Provider classification rule. Each rule contributes signals + a
 * weight; the final confidence is the sum of weights (capped at 1.0).
 * Rules are intentionally simple regex matches against the lowercased
 * page text + structured tags + link hrefs so they're fast and
 * deterministic.
 */
interface ProviderRule {
  id: string;
  name: string;
  category: IntegrationCategory;
  blurb: string;
  /**
   * Honest connector readiness. `AVAILABLE` REQUIRES a non-null,
   * routable `connectHref`. `COMING_SOON` REQUIRES `connectHref: null`
   * (enforced at build time by `buildCandidate`) + a `comingSoonReason`.
   */
  status: ConnectorStatus;
  /** Real, routable connect surface — ONLY for `AVAILABLE` providers. */
  connectHref: string | null;
  /** Friendly "not yet" line — ONLY for `COMING_SOON` providers. */
  comingSoonReason?: string;
  /**
   * Patterns checked against the haystack (lowercased combined text).
   * Each match contributes `weight` to the rule's confidence.
   */
  signals: Array<{ pattern: RegExp; weight: number; label: string }>;
}

/**
 * The set of POS provider ids that are genuinely self-serve TODAY —
 * derived from the AUTHORITATIVE `POS_PROVIDERS` catalog in
 * `@cms/api-types` (the same catalog the /settings/pos page + the
 * connector registry read). A provider is connectable iff its
 * `integrationTier === 'DIRECT'`. PARTNER (partner-program / no sync
 * handler) and CLOSED (no public CMS API) tiers are NOT connectable, so
 * the Concierge marks them COMING_SOON rather than routing the operator
 * to a Connect button that dead-ends. Keeping this derived (not
 * hard-coded) means promoting a POS provider to DIRECT in one place
 * (the catalog) flips it to AVAILABLE here automatically.
 */
const DIRECT_POS_IDS: ReadonlySet<string> = new Set(
  POS_PROVIDERS.filter((p) => p.integrationTier === 'DIRECT').map((p) => p.id),
);

/** True when a POS provider id is self-serve-connectable today. */
function posIsDirect(catalogId: string): boolean {
  return catalogId === 'toast' || DIRECT_POS_IDS.has(catalogId);
}

/**
 * Build the `{ status, connectHref, comingSoonReason }` slice for a POS
 * provider rule, derived from the authoritative catalog tier. DIRECT →
 * AVAILABLE (route to `connectPath`); anything else → COMING_SOON (null
 * href + the friendly reason). Spread into the rule literal so a single
 * tier change in @cms/api-types flips the Concierge automatically and the
 * COMING_SOON/AVAILABLE invariants can never drift out of sync by hand.
 */
function posStatus(
  catalogId: string,
  connectPath: string,
  comingSoonReason = `Coming soon — ${catalogId} sync in development. Use the Custom Webhook today to push your catalog.`,
): Pick<ProviderRule, 'status' | 'connectHref' | 'comingSoonReason'> {
  return posIsDirect(catalogId)
    ? { status: 'AVAILABLE', connectHref: connectPath }
    : { status: 'COMING_SOON', connectHref: null, comingSoonReason };
}

// Hand-curated rule list. Add new providers here as we onboard them.
// Order matters only for display when scores tie — first listed wins.
const RULES: ProviderRule[] = [
  // ─── POS — restaurants / retail ───────────────────────────────────
  // Status is DERIVED from the authoritative @cms/api-types POS catalog
  // (DIRECT → AVAILABLE → /settings/pos; PARTNER/CLOSED → COMING_SOON) so
  // promoting a provider's tier in ONE place flips it here too. The
  // discovery rule `id` differs from the catalog id for a few (lightspeed
  // → lightspeed-retail, shopify → shopify-pos); posIsDirect() keys off
  // the CATALOG id below.
  {
    id: 'square',
    name: 'Square',
    category: 'pos',
    blurb: 'Sync your Square POS catalog so menu boards auto-update when prices or items change.',
    // DIRECT in the catalog → real self-serve OAuth. `/connect/square` has
    // no page; the operator-facing place to START the connect is the POS
    // settings page (it mints the OAuth URL via /pos/oauth/square/authorize).
    ...posStatus('square', '/settings/pos'),
    signals: [
      { pattern: /\bsquare(?:up)?\.com\b/i, weight: 0.6, label: 'links to squareup.com' },
      { pattern: /\bsquare\s+(?:pos|reader|terminal|checkout)\b/i, weight: 0.4, label: 'mentions Square POS hardware' },
      { pattern: /\bpowered\s+by\s+square\b/i, weight: 0.5, label: '"Powered by Square" footer' },
    ],
  },
  {
    id: 'toast',
    name: 'Toast',
    category: 'pos',
    blurb: 'Toast restaurant POS — pull menu items, prices, and 86-list into your menu boards.',
    // Toast has a machine-client connector; access still requires Toast API credentials.
    ...posStatus('toast', '/settings/pos'),
    signals: [
      { pattern: /\btoasttab\.com\b/i, weight: 0.7, label: 'links to toasttab.com' },
      { pattern: /\b(?:order|menu)\s+(?:powered\s+by\s+)?toast\b/i, weight: 0.5, label: 'menu/order powered by Toast' },
      { pattern: /\bpos\.toasttab\.com\b/i, weight: 0.6, label: 'Toast POS subdomain' },
    ],
  },
  {
    id: 'clover',
    name: 'Clover',
    category: 'pos',
    blurb: 'Clover POS — push your live catalog to digital menu boards.',
    // DIRECT in the catalog (2026-06-02): OAuth + catalog sync ship in
    // providers/clover.ts + the connector registry. Self-serve.
    ...posStatus('clover', '/settings/pos'),
    signals: [
      { pattern: /\bclover\.com\b/i, weight: 0.6, label: 'links to clover.com' },
      { pattern: /\bclover\s+(?:pos|station|mini|flex)\b/i, weight: 0.4, label: 'Clover hardware mentioned' },
    ],
  },
  {
    id: 'lightspeed',
    name: 'Lightspeed',
    category: 'pos',
    blurb: 'Lightspeed X-Series Items API — multi-location retail / restaurant catalog sync.',
    // Catalog id is `lightspeed-retail` (DIRECT since 2026-06-02).
    ...posStatus('lightspeed-retail', '/settings/pos'),
    signals: [
      { pattern: /\blightspeedhq\.com\b/i, weight: 0.6, label: 'links to lightspeedhq.com' },
      { pattern: /\blightspeed\s+(?:retail|restaurant|pos)\b/i, weight: 0.4, label: 'Lightspeed product mentioned' },
    ],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    category: 'pos',
    blurb: 'Shopify storefront / POS — surface featured products, sale items, low-stock alerts.',
    // Catalog id is `shopify-pos` (DIRECT since 2026-06-02).
    ...posStatus('shopify-pos', '/settings/pos'),
    signals: [
      { pattern: /cdn\.shopify\.com|myshopify\.com/i, weight: 0.7, label: 'Shopify CDN or myshopify subdomain' },
      { pattern: /\bpowered\s+by\s+shopify\b/i, weight: 0.6, label: 'Shopify footer credit' },
    ],
  },

  // ─── Reservations — restaurants / hospitality (no connector yet) ───
  {
    id: 'opentable',
    name: 'OpenTable',
    category: 'reservations',
    blurb: 'Show tonight\'s wait times + available reservations on lobby boards.',
    status: 'COMING_SOON',
    connectHref: null,
    comingSoonReason: 'Coming soon — OpenTable reservation sync in development. Use a Webpage widget to embed your public booking page today.',
    signals: [
      { pattern: /\bopentable\.com\b/i, weight: 0.7, label: 'links to opentable.com' },
      { pattern: /\bbook\s+(?:a\s+)?table\b/i, weight: 0.2, label: '"book a table" CTA' },
    ],
  },
  {
    id: 'resy',
    name: 'Resy',
    category: 'reservations',
    blurb: 'Resy reservation data on host-stand screens.',
    status: 'COMING_SOON',
    connectHref: null,
    comingSoonReason: 'Coming soon — Resy reservation sync in development. Use a Webpage widget to embed your Resy page today.',
    signals: [
      { pattern: /\bresy\.com\b/i, weight: 0.7, label: 'links to resy.com' },
    ],
  },

  // ─── Streaming + broadcast ─────────────────────────────────────────
  // YouTube/Twitch are real public EMBEDS today (no per-tenant auth) —
  // added via the Webpage/Video widget in the template editor, so they're
  // AVAILABLE and route there. NFHS is a paid-subscription overlay with no
  // connector → COMING_SOON.
  {
    id: 'youtube',
    name: 'YouTube Live',
    category: 'streaming',
    blurb: 'Embed a live YouTube channel via the Webpage widget (some channels disable embedding).',
    status: 'AVAILABLE',
    connectHref: '/templates',
    signals: [
      { pattern: /\byoutube\.com\b|youtu\.be/i, weight: 0.5, label: 'YouTube links present' },
      { pattern: /\b(?:live|stream|broadcast)\b.*\byoutube\b/i, weight: 0.3, label: 'live-streaming context' },
    ],
  },
  {
    id: 'twitch',
    name: 'Twitch',
    category: 'streaming',
    blurb: 'Embed a public Twitch channel via the Webpage widget — no channel-owner consent needed.',
    status: 'AVAILABLE',
    connectHref: '/templates',
    signals: [
      { pattern: /\btwitch\.tv\b/i, weight: 0.7, label: 'Twitch link present' },
    ],
  },
  {
    id: 'nfhs',
    name: 'NFHS Network',
    category: 'streaming',
    blurb: 'High-school sports live-stream overlay for SPORTS-vertical tenants.',
    status: 'COMING_SOON',
    connectHref: null,
    comingSoonReason: 'Coming soon — NFHS Network overlay in development (requires an active NFHS subscription).',
    signals: [
      { pattern: /\bnfhsnetwork\.com\b/i, weight: 0.8, label: 'NFHS Network link' },
    ],
  },

  // ─── Music ─────────────────────────────────────────────────────────
  // SomaFM + the NPR station catalog are REAL today — free, commercial-
  // licensed streams surfaced in the Music widget's station picker (no
  // auth, no connect page). The operator adds a Music widget and picks a
  // station, so SomaFM routes to the template editor. Spotify-for-Business
  // / Apple-Music-for-Business need OAuth partnerships that aren't wired.
  {
    id: 'somafm',
    name: 'SomaFM',
    category: 'music',
    blurb: 'Free, commercial-licensed background music — add a Music widget and pick a station. No account needed.',
    // Real catalog via the Music widget; the old `/connect/somafm` route
    // never existed (dead button). Route to the template editor instead.
    status: 'AVAILABLE',
    connectHref: '/templates',
    signals: [
      { pattern: /\bsomafm\.com\b/i, weight: 0.8, label: 'SomaFM link' },
    ],
  },
  {
    id: 'spotify-business',
    name: 'Spotify for Business',
    category: 'music',
    blurb: 'Curated commercial-license music for venues (Soundtrack Your Brand).',
    status: 'COMING_SOON',
    connectHref: null,
    comingSoonReason: 'Coming soon — Spotify for Business sync in development. Use SomaFM\'s free licensed stations today.',
    signals: [
      { pattern: /\bspotify\.com|\bsoundtrackyourbrand\.com\b/i, weight: 0.5, label: 'Spotify / SYB references' },
    ],
  },
  {
    id: 'apple-music-business',
    name: 'Apple Music for Business',
    category: 'music',
    blurb: 'Commercial-license music via Apple Music for Business.',
    status: 'COMING_SOON',
    connectHref: null,
    comingSoonReason: 'Coming soon — Apple Music for Business sync in development. Use SomaFM\'s free licensed stations today.',
    signals: [
      { pattern: /\bapple\.com\/business\b|music\.apple\.com/i, weight: 0.5, label: 'Apple Music / Apple Business' },
    ],
  },

  // ─── Calendar (no connector yet) ───────────────────────────────────
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    category: 'calendar',
    blurb: 'Pull events from a public Google Calendar into your events widget.',
    status: 'COMING_SOON',
    connectHref: null,
    comingSoonReason: 'Coming soon — Google Calendar sync in development. Add events manually in the Calendar widget today.',
    signals: [
      { pattern: /\bgoogle\.com\/calendar\b|calendar\.google\.com/i, weight: 0.7, label: 'Google Calendar link' },
    ],
  },
  {
    id: 'eventbrite',
    name: 'Eventbrite',
    category: 'calendar',
    blurb: 'Upcoming Eventbrite event listings + ticket-sales status on signage.',
    status: 'COMING_SOON',
    connectHref: null,
    comingSoonReason: 'Coming soon — Eventbrite sync in development. Add events manually in the Calendar widget today.',
    signals: [
      { pattern: /\beventbrite\.com\b/i, weight: 0.7, label: 'Eventbrite link' },
    ],
  },

  // ─── Email / comms (no connector yet) ──────────────────────────────
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    category: 'email',
    blurb: 'Newsletter signup QR + subscriber-count callouts on lobby screens.',
    status: 'COMING_SOON',
    connectHref: null,
    comingSoonReason: 'Coming soon — Mailchimp sync in development. Add a QR-code widget linking to your signup page today.',
    signals: [
      { pattern: /\bmailchimp\.com\b|\.list-manage\.com/i, weight: 0.6, label: 'Mailchimp links / list-manage' },
    ],
  },
  {
    id: 'constant-contact',
    name: 'Constant Contact',
    category: 'email',
    blurb: 'Constant Contact newsletter signup QR + subscriber metrics.',
    status: 'COMING_SOON',
    connectHref: null,
    comingSoonReason: 'Coming soon — Constant Contact sync in development. Add a QR-code widget linking to your signup page today.',
    signals: [
      { pattern: /\bconstantcontact\.com\b/i, weight: 0.6, label: 'Constant Contact link' },
    ],
  },

  // ─── Identity / SSO (OIDC is wired end-to-end) ─────────────────────
  {
    id: 'google-sso',
    name: 'Google Workspace SSO',
    category: 'identity',
    blurb: 'Let staff sign into VenueOS with their Google Workspace account.',
    status: 'AVAILABLE',
    connectHref: '/settings/sso',
    signals: [
      { pattern: /workspace\.google\.com|gsuite\.google\.com|g\.co\/workspace/i, weight: 0.6, label: 'Google Workspace link' },
    ],
  },
  {
    id: 'microsoft-365',
    name: 'Microsoft 365 SSO',
    category: 'identity',
    blurb: 'Sign in with Microsoft 365 / Azure AD accounts.',
    status: 'AVAILABLE',
    connectHref: '/settings/sso',
    signals: [
      { pattern: /microsoft365\.com|office\.com|outlook\.com\/owa/i, weight: 0.6, label: 'Microsoft 365 / Office links' },
    ],
  },

  // ─── SIS — K-12 (Clever roster sync is wired end-to-end) ───────────
  {
    id: 'clever',
    name: 'Clever',
    category: 'sis',
    blurb: 'K-12 staff roster sync via Clever — nightly + on-demand (real OAuth + roster diff).',
    // REAL: CleverModule ships connect → callback → sync (user create/
    // update/disable + sync log + audit). The connect surface is the
    // dedicated Clever page, NOT the generic SSO page.
    status: 'AVAILABLE',
    connectHref: '/settings/integrations/clever',
    signals: [
      { pattern: /\bclever\.com\b|sso\.clever\.com/i, weight: 0.7, label: 'Clever link' },
      { pattern: /\.edu\b/i, weight: 0.1, label: '.edu domain' },
    ],
  },

  // ─── Social — public-facing feeds (no connector yet) ───────────────
  {
    id: 'instagram',
    name: 'Instagram',
    category: 'social',
    blurb: 'Public Instagram feed widget on lobby screens.',
    status: 'COMING_SOON',
    connectHref: null,
    comingSoonReason: 'Coming soon — Instagram feed sync in development (requires an Instagram Business account).',
    signals: [
      { pattern: /\binstagram\.com\b/i, weight: 0.5, label: 'Instagram link' },
    ],
  },

  // ─── Sports data (no connector yet) ────────────────────────────────
  // NOTE: live SCORE feeds (Daktronics RS485, water-polo path) ARE real,
  // but they're wired through the Sports console / hardware bridge, not the
  // Concierge URL/description discovery flow. MaxPreps schedule scraping has
  // no connector → COMING_SOON.
  {
    id: 'maxpreps',
    name: 'MaxPreps',
    category: 'sports-data',
    blurb: 'High-school athletic schedules + standings from MaxPreps.',
    status: 'COMING_SOON',
    connectHref: null,
    comingSoonReason: 'Coming soon — MaxPreps schedule sync in development. Build a schedule board manually today.',
    signals: [
      { pattern: /\bmaxpreps\.com\b/i, weight: 0.8, label: 'MaxPreps link' },
    ],
  },

  // ─── Fitness (no connector yet) ────────────────────────────────────
  {
    id: 'mindbody',
    name: 'MINDBODY',
    category: 'fitness',
    blurb: 'Class schedule + instructor lineup from MINDBODY for gym / yoga studios.',
    status: 'COMING_SOON',
    connectHref: null,
    comingSoonReason: 'Coming soon — MINDBODY sync in development (Partner Program). Build a class-schedule board manually today.',
    signals: [
      { pattern: /\bmindbodyonline\.com|mindbody\.io\b/i, weight: 0.7, label: 'MINDBODY link' },
    ],
  },

  // ─── Giving / donations — WORSHIP vertical (no connector yet) ──────
  // Added 2026-06-27 so houses of worship discover their giving platforms
  // as honestly COMING_SOON rather than not at all. Surfaced by the
  // church/parish keyword hints + by site signals.
  {
    id: 'tithely',
    name: 'Tithe.ly',
    category: 'giving',
    blurb: 'Show giving progress + a "Give now" QR for your Tithe.ly campaigns.',
    status: 'COMING_SOON',
    connectHref: null,
    comingSoonReason: 'Coming soon — Tithe.ly giving sync in development. Add a QR-code widget linking to your giving page today.',
    signals: [
      { pattern: /\btithe\.ly\b|tithely\.com/i, weight: 0.8, label: 'Tithe.ly link' },
    ],
  },
  {
    id: 'pushpay',
    name: 'Pushpay',
    category: 'giving',
    blurb: 'Surface Pushpay giving totals + a "Give now" QR on worship-center screens.',
    status: 'COMING_SOON',
    connectHref: null,
    comingSoonReason: 'Coming soon — Pushpay giving sync in development. Add a QR-code widget linking to your giving page today.',
    signals: [
      { pattern: /\bpushpay\.com\b/i, weight: 0.8, label: 'Pushpay link' },
    ],
  },
  {
    id: 'givingtrac',
    name: 'GivingTrac',
    category: 'giving',
    blurb: 'Show GivingTrac campaign progress + a "Give now" QR on sanctuary screens.',
    status: 'COMING_SOON',
    connectHref: null,
    comingSoonReason: 'Coming soon — GivingTrac giving sync in development. Add a QR-code widget linking to your giving page today.',
    signals: [
      { pattern: /\bgivingtrac\.com\b/i, weight: 0.8, label: 'GivingTrac link' },
    ],
  },
];

// Free-text classification — same rule list, but signals are matched
// against the operator's description string instead of scraped HTML.
// Additionally, vertical-y keywords increase per-category baseline.
const KEYWORD_CATEGORY_HINTS: Record<string, IntegrationCategory[]> = {
  restaurant: ['pos', 'reservations'],
  cafe: ['pos', 'reservations', 'music'],
  bar: ['pos', 'reservations', 'music'],
  brewery: ['pos', 'music'],
  retail: ['pos', 'social'],
  store: ['pos', 'social'],
  boutique: ['pos', 'social'],
  fashion: ['pos', 'social'],
  gym: ['fitness', 'music'],
  yoga: ['fitness', 'music'],
  studio: ['fitness'],
  fitness: ['fitness'],
  school: ['sis', 'calendar', 'identity'],
  district: ['sis', 'identity'],
  university: ['sis', 'calendar', 'identity'],
  college: ['sis', 'calendar'],
  hospital: ['identity', 'calendar'],
  clinic: ['identity'],
  hotel: ['reservations', 'music'],
  resort: ['reservations', 'music'],
  venue: ['reservations', 'streaming'],
  stadium: ['streaming', 'sports-data'],
  arena: ['streaming', 'sports-data'],
  church: ['streaming', 'calendar', 'giving'],
  parish: ['streaming', 'calendar', 'giving'],
  temple: ['streaming', 'calendar', 'giving'],
  synagogue: ['streaming', 'calendar', 'giving'],
  mosque: ['streaming', 'calendar', 'giving'],
  ministry: ['streaming', 'giving'],
  worship: ['streaming', 'giving'],
  congregation: ['streaming', 'giving'],
};

/**
 * `extractOwnLinks` matchers — App Library Tier-2 "concierge auto-fill"
 * (2026-07-01). Each entry recognizes ONE destination type in the
 * operator's own footer/nav/JSON-LD links and maps it to the stable key
 * the frontend's `concierge-map.ts` uses to open a pre-filled App Registry
 * tile. Deliberately separate from the integration `RULES` above — those
 * classify PROVIDER CATEGORIES from ambient page signals (any mention of
 * "youtube" anywhere counts); this extracts the operator's ACTUAL
 * destination URL from a real anchor/link element, which is a much
 * stronger and more specific signal (and the only thing that lets us
 * pre-fill a field rather than just say "we noticed X").
 *
 * Kept deterministic/keyless — no AI cost, no new setting — per
 * CLAUDE.md's AI economic model (never spend a Tier-1 call on something a
 * regex can do for free).
 */
interface OwnLinkMatcher {
  /** Stable key consumed by the frontend's concierge-map.ts (App Registry id space where practical). */
  key: string;
  pattern: RegExp;
}

const OWN_LINK_MATCHERS: OwnLinkMatcher[] = [
  {
    key: 'youtube',
    pattern:
      /(?:youtube\.com\/(?:@[\w-]+|channel\/[\w-]+|c\/[\w-]+|user\/[\w-]+)|youtu\.be\/[\w-]+)/i,
  },
  { key: 'vimeo', pattern: /vimeo\.com\/(?:video\/)?\d+|vimeo\.com\/[\w-]+/i },
  { key: 'twitch', pattern: /twitch\.tv\/[\w-]+/i },
  { key: 'instagram', pattern: /instagram\.com\/[\w.-]+/i },
  { key: 'facebook-page', pattern: /facebook\.com\/[\w.-]+/i },
  {
    key: 'google-slides',
    pattern: /docs\.google\.com\/presentation\/d\/[\w-]+/i,
  },
  {
    key: 'google-sheets',
    pattern: /docs\.google\.com\/spreadsheets\/d\/[\w-]+/i,
  },
  {
    key: 'calendar',
    pattern: /calendar\.google\.com\/calendar\/(?:embed|ical)[^\s"'<>]*/i,
  },
  { key: 'news-rss', pattern: /[^\s"'<>]+\.(?:xml|rss)(?:\?[^\s"'<>]*)?/i },
];

/**
 * Harvest the operator's OWN destination links from their homepage —
 * footer/nav anchors, `<link rel="alternate" type="application/rss+xml">`,
 * and JSON-LD `sameAs[]` — and map each to a stable key. Returns AT MOST
 * one URL per key (first match wins; footer/nav order is usually the
 * canonical one). Never throws: a malformed document just yields fewer
 * (or zero) links, same honest-degrade posture as the rest of the
 * discovery pass.
 */
function extractOwnLinks(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const $ = cheerioLoad(html);

    // 1) Every anchor href on the page (footer/nav are usually included in
    // a full-page fetch; we don't scope to <footer>/<nav> specifically
    // since many sites put social links in a header or a floating bar).
    const hrefs: string[] = $('a[href]')
      .map((_, el) => $(el).attr('href') || '')
      .get()
      .filter(Boolean);

    // 2) RSS/Atom feed autodiscovery — the canonical way a site advertises
    // its feed, far more reliable than guessing a /feed.xml path.
    const feedHrefs: string[] = $(
      'link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"]',
    )
      .map((_, el) => $(el).attr('href') || '')
      .get()
      .filter(Boolean);

    // 3) JSON-LD `sameAs` arrays — schema.org Organization/LocalBusiness
    // markup commonly lists official social profile URLs here, often more
    // reliable than a footer icon link (no icon-only <a> with a tracking
    // redirect to parse through).
    const sameAsHrefs: string[] = [];
    $('script[type="application/ld+json"]').each((_, el) => {
      const raw = $(el).contents().text();
      if (!raw || raw.length > 100_000) return; // guard against pathological payloads
      try {
        const parsed: unknown = JSON.parse(raw);
        const nodes: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
        for (const node of nodes) {
          const sameAs =
            node && typeof node === 'object'
              ? (node as Record<string, unknown>).sameAs
              : undefined;
          if (Array.isArray(sameAs)) {
            for (const v of sameAs) if (typeof v === 'string') sameAsHrefs.push(v);
          } else if (typeof sameAs === 'string') {
            sameAsHrefs.push(sameAs);
          }
        }
      } catch {
        // Malformed JSON-LD is common in the wild — skip this block, keep scanning others.
      }
    });

    const allCandidates = [...hrefs, ...feedHrefs, ...sameAsHrefs];
    for (const matcher of OWN_LINK_MATCHERS) {
      if (out[matcher.key]) continue; // first match wins
      const hit = allCandidates.find((href) => matcher.pattern.test(href));
      if (hit) out[matcher.key] = hit;
    }
  } catch {
    // Cheerio parse failed entirely — return whatever we have (nothing),
    // never throw. Mirrors buildHaystack's fallback posture.
  }
  return out;
}

@Injectable()
export class IntegrationDiscoveryService {
  private readonly log = new Logger(IntegrationDiscoveryService.name);

  /**
   * Discover integrations from a URL. Scrapes the homepage with
   * safeFetch (SSRF-safe), classifies, returns ranked candidates.
   *
   * Returns an empty candidate list with a warning if scraping fails
   * — failure is non-fatal because the operator can still describe
   * their business via describeFromText().
   */
  async discoverFromUrl(url: string): Promise<DiscoveryResult> {
    const warnings: string[] = [];
    let html = '';
    let inputSummary = url;

    try {
      const res = await safeFetch(url, { timeoutMs: 8_000, maxBytes: 1_500_000 });
      // safeFetch returns { body: Buffer, contentType, finalUrl, status }
      // — NOT a Response-like object. Decode the buffer ourselves.
      html = res.body.toString('utf8');
      inputSummary = `${res.finalUrl || url} (${html.length} bytes)`;
    } catch (e) {
      if (e instanceof SsrfError) {
        warnings.push(`URL rejected: ${e.message}`);
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        warnings.push(`Couldn't fetch URL: ${msg}`);
      }
      return {
        source: 'url',
        inputSummary,
        candidates: [],
        warnings,
        ownLinks: {},
      };
    }

    // Build a single lowercased haystack: visible text + script-src
    // attrs + link hrefs + meta tags. Provider rules are written to
    // match against any of these.
    const haystack = this.buildHaystack(html);

    const candidates = this.scoreRules(haystack, /* boostByCategory */ {});
    const ownLinks = extractOwnLinks(html);
    // Thread the operator's own extracted link onto any candidate whose
    // rule id matches an own-link key (e.g. the 'youtube' integration
    // RULE gets `detectedValue` = the operator's actual channel URL, not
    // just "we saw youtube.com somewhere"). Additive — candidates with no
    // matching own-link keep `detectedValue: undefined` exactly as before.
    for (const c of candidates) {
      if (ownLinks[c.id]) c.detectedValue = ownLinks[c.id];
    }
    return { source: 'url', inputSummary, candidates, warnings, ownLinks };
  }

  /**
   * Discover integrations from a free-text business description.
   * Catches operators who don't have a public URL yet.
   */
  async discoverFromDescription(text: string): Promise<DiscoveryResult> {
    const warnings: string[] = [];
    const cleaned = String(text || '').slice(0, 2_000).trim();
    if (!cleaned) {
      warnings.push('Description was empty.');
      return {
        source: 'description',
        inputSummary: '',
        candidates: [],
        warnings,
        ownLinks: {},
      };
    }

    const lower = cleaned.toLowerCase();
    // Boost categories implied by vertical keywords (e.g. "restaurant"
    // → boost pos + reservations baseline so even faint signal wins).
    const boosts: Partial<Record<IntegrationCategory, number>> = {};
    for (const [kw, cats] of Object.entries(KEYWORD_CATEGORY_HINTS)) {
      if (lower.includes(kw)) {
        for (const c of cats) {
          boosts[c] = (boosts[c] || 0) + 0.15;
        }
      }
    }

    const candidates = this.scoreRules(lower, boosts);
    return {
      source: 'description',
      inputSummary: cleaned.length > 120 ? cleaned.slice(0, 117) + '...' : cleaned,
      candidates,
      warnings,
      // Free-text descriptions have no HTML to harvest links from — no
      // own-link extraction is possible for the /describe path.
      ownLinks: {},
    };
  }

  /** Lowercased, deduped pool of every signal site we might match against. */
  private buildHaystack(html: string): string {
    try {
      const $ = cheerioLoad(html);
      // Strip <script> bodies (we don't want the JS to dominate matches)
      // but KEEP src= attributes for CDN detection.
      const scriptSrcs = $('script[src]')
        .map((_, el) => $(el).attr('src') || '')
        .get()
        .join(' ');
      const linkHrefs = $('a[href], link[href]')
        .map((_, el) => $(el).attr('href') || '')
        .get()
        .join(' ');
      const metaContents = $('meta[content]')
        .map((_, el) => $(el).attr('content') || '')
        .get()
        .join(' ');
      const textBody = $('body').text().replace(/\s+/g, ' ').slice(0, 50_000);
      return [scriptSrcs, linkHrefs, metaContents, textBody, html.slice(0, 5_000)]
        .join(' ')
        .toLowerCase();
    } catch {
      // Cheerio parse failed — fall back to raw lowercased HTML.
      return html.toLowerCase();
    }
  }

  /** Run every rule against the haystack, return ranked top candidates. */
  private scoreRules(
    haystack: string,
    boostByCategory: Partial<Record<IntegrationCategory, number>>,
  ): ProviderCandidate[] {
    const candidates: ProviderCandidate[] = [];

    for (const rule of RULES) {
      const matched: string[] = [];
      let score = 0;
      for (const s of rule.signals) {
        if (s.pattern.test(haystack)) {
          score += s.weight;
          matched.push(s.label);
        }
      }
      if (boostByCategory[rule.category]) {
        score += boostByCategory[rule.category] || 0;
      }
      if (score <= 0) continue;
      const confidence = Math.min(1, score);
      candidates.push(buildCandidate(rule, confidence, matched));
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    // Cap at 12 — anything below that is noise for the operator.
    return candidates.slice(0, 12);
  }
}

/**
 * Assemble a `ProviderCandidate` from a matched rule, ENFORCING the honesty
 * invariant so a costume can't slip through even if a rule literal is
 * mis-authored:
 *   - `AVAILABLE`   MUST carry a non-null `connectHref`; if it doesn't, we
 *                   downgrade to `COMING_SOON` (never render a dead Connect).
 *   - `COMING_SOON` NEVER carries a `connectHref` (forced null) and always
 *                   carries a `comingSoonReason` (synthesised if missing).
 * This is the single chokepoint every candidate passes through, so the API
 * response is guaranteed self-describing for the Concierge UI.
 */
function buildCandidate(
  rule: ProviderRule,
  confidence: number,
  matchedSignals: string[],
): ProviderCandidate {
  const base = {
    id: rule.id,
    name: rule.name,
    category: rule.category,
    confidence,
    blurb: rule.blurb,
    matchedSignals,
  };

  // AVAILABLE requires a real, routable connect path. Missing one is a
  // bug in the rule — fail safe to COMING_SOON rather than a dead button.
  if (rule.status === 'AVAILABLE' && rule.connectHref) {
    return { ...base, status: 'AVAILABLE', connectHref: rule.connectHref };
  }

  return {
    ...base,
    status: 'COMING_SOON',
    connectHref: null,
    comingSoonReason:
      rule.comingSoonReason || `Coming soon — ${rule.name} integration in development.`,
  };
}
