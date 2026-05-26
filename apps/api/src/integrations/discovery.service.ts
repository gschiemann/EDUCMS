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
  | 'design'
  | 'analytics';

export interface ProviderCandidate {
  id: string;
  name: string;
  category: IntegrationCategory;
  confidence: number; // 0..1
  /** Plain-English explanation the Concierge UI shows the operator. */
  blurb: string;
  /** Why we matched — for debug + the "we found this on your site" badge. */
  matchedSignals: string[];
  /** Where the operator goes to connect this. null = "Coming soon". */
  connectHref: string | null;
}

export interface DiscoveryResult {
  source: 'url' | 'description';
  inputSummary: string;
  candidates: ProviderCandidate[];
  warnings: string[];
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
  connectHref: string | null;
  /**
   * Patterns checked against the haystack (lowercased combined text).
   * Each match contributes `weight` to the rule's confidence.
   */
  signals: Array<{ pattern: RegExp; weight: number; label: string }>;
}

// Hand-curated rule list. Add new providers here as we onboard them.
// Order matters only for display when scores tie — first listed wins.
const RULES: ProviderRule[] = [
  // POS — restaurants / retail
  {
    id: 'square',
    name: 'Square',
    category: 'pos',
    blurb: 'Sync your Square POS catalog so menu boards auto-update when prices or items change.',
    connectHref: '/connect/square',
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
    blurb: 'Toast restaurant POS — pull menu items, prices, and 86-list into your menu boards in real time.',
    connectHref: null, // partnership pending
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
    connectHref: null,
    signals: [
      { pattern: /\bclover\.com\b/i, weight: 0.6, label: 'links to clover.com' },
      { pattern: /\bclover\s+(?:pos|station|mini|flex)\b/i, weight: 0.4, label: 'Clover hardware mentioned' },
    ],
  },
  {
    id: 'lightspeed',
    name: 'Lightspeed',
    category: 'pos',
    blurb: 'Lightspeed retail / restaurant POS catalog sync.',
    connectHref: null,
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
    connectHref: null,
    signals: [
      { pattern: /cdn\.shopify\.com|myshopify\.com/i, weight: 0.7, label: 'Shopify CDN or myshopify subdomain' },
      { pattern: /\bpowered\s+by\s+shopify\b/i, weight: 0.6, label: 'Shopify footer credit' },
    ],
  },

  // Reservations — restaurants / hospitality
  {
    id: 'opentable',
    name: 'OpenTable',
    category: 'reservations',
    blurb: 'Show tonight\'s wait times + available reservations on lobby boards.',
    connectHref: null,
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
    connectHref: null,
    signals: [
      { pattern: /\bresy\.com\b/i, weight: 0.7, label: 'links to resy.com' },
    ],
  },

  // Streaming + broadcast
  {
    id: 'youtube',
    name: 'YouTube Live',
    category: 'streaming',
    blurb: 'Live YouTube channel embed (note: many channels disable embedding — Concierge pre-validates).',
    connectHref: null,
    signals: [
      { pattern: /\byoutube\.com\b|youtu\.be/i, weight: 0.5, label: 'YouTube links present' },
      { pattern: /\b(?:live|stream|broadcast)\b.*\byoutube\b/i, weight: 0.3, label: 'live-streaming context' },
    ],
  },
  {
    id: 'twitch',
    name: 'Twitch',
    category: 'streaming',
    blurb: 'Public Twitch channel embed — works without channel-owner consent.',
    connectHref: null,
    signals: [
      { pattern: /\btwitch\.tv\b/i, weight: 0.7, label: 'Twitch link present' },
    ],
  },
  {
    id: 'nfhs',
    name: 'NFHS Network',
    category: 'streaming',
    blurb: 'High-school sports live-stream overlay — only for SPORTS-vertical tenants with active subscriptions.',
    connectHref: null,
    signals: [
      { pattern: /\bnfhsnetwork\.com\b/i, weight: 0.8, label: 'NFHS Network link' },
    ],
  },

  // Music
  {
    id: 'spotify-business',
    name: 'Spotify for Business',
    category: 'music',
    blurb: 'Curated commercial-license music for venues. Requires Soundtrack Your Brand subscription.',
    connectHref: null,
    signals: [
      { pattern: /\bspotify\.com|\bsoundtrackyourbrand\.com\b/i, weight: 0.5, label: 'Spotify / SYB references' },
    ],
  },
  {
    id: 'apple-music-business',
    name: 'Apple Music for Business',
    category: 'music',
    blurb: 'Commercial-license music via Apple Music for Business. Coming soon — partnership in flight.',
    connectHref: null,
    signals: [
      { pattern: /\bapple\.com\/business\b|music\.apple\.com/i, weight: 0.5, label: 'Apple Music / Apple Business' },
    ],
  },
  {
    id: 'somafm',
    name: 'SomaFM',
    category: 'music',
    blurb: 'Free, commercial-licensed background music — 21 stations including ambient, jazz, indie.',
    connectHref: '/connect/somafm',
    signals: [
      { pattern: /\bsomafm\.com\b/i, weight: 0.8, label: 'SomaFM link' },
    ],
  },

  // Calendar
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    category: 'calendar',
    blurb: 'Pull events from a public Google Calendar into your events widget.',
    connectHref: null,
    signals: [
      { pattern: /\bgoogle\.com\/calendar\b|calendar\.google\.com/i, weight: 0.7, label: 'Google Calendar link' },
    ],
  },
  {
    id: 'eventbrite',
    name: 'Eventbrite',
    category: 'calendar',
    blurb: 'Upcoming Eventbrite event listings + ticket-sales status on signage.',
    connectHref: null,
    signals: [
      { pattern: /\beventbrite\.com\b/i, weight: 0.7, label: 'Eventbrite link' },
    ],
  },

  // Email / comms
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    category: 'email',
    blurb: 'Push Mailchimp newsletter signups via a QR-code widget; sync subscriber count to lobby screens.',
    connectHref: null,
    signals: [
      { pattern: /\bmailchimp\.com\b|\.list-manage\.com/i, weight: 0.6, label: 'Mailchimp links / list-manage' },
    ],
  },
  {
    id: 'constant-contact',
    name: 'Constant Contact',
    category: 'email',
    blurb: 'Constant Contact newsletter signup QR + subscriber metrics.',
    connectHref: null,
    signals: [
      { pattern: /\bconstantcontact\.com\b/i, weight: 0.6, label: 'Constant Contact link' },
    ],
  },

  // Identity / SSO
  {
    id: 'google-sso',
    name: 'Google Workspace SSO',
    category: 'identity',
    blurb: 'Let staff sign into VenueOS with their Google Workspace account.',
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
    connectHref: '/settings/sso',
    signals: [
      { pattern: /microsoft365\.com|office\.com|outlook\.com\/owa/i, weight: 0.6, label: 'Microsoft 365 / Office links' },
    ],
  },

  // SIS — K-12
  {
    id: 'clever',
    name: 'Clever',
    category: 'sis',
    blurb: 'K-12 staff roster + class schedule sync via Clever (already wired in CleverModule).',
    connectHref: '/settings/sso?provider=clever',
    signals: [
      { pattern: /\bclever\.com\b|sso\.clever\.com/i, weight: 0.7, label: 'Clever link' },
      { pattern: /\.edu\b/i, weight: 0.1, label: '.edu domain' },
    ],
  },

  // Social — public-facing feeds
  {
    id: 'instagram',
    name: 'Instagram',
    category: 'social',
    blurb: 'Public Instagram feed widget on lobby screens (requires Instagram Business account).',
    connectHref: null,
    signals: [
      { pattern: /\binstagram\.com\b/i, weight: 0.5, label: 'Instagram link' },
    ],
  },

  // Sports data
  {
    id: 'maxpreps',
    name: 'MaxPreps',
    category: 'sports-data',
    blurb: 'High-school athletic schedules + standings from MaxPreps.',
    connectHref: null,
    signals: [
      { pattern: /\bmaxpreps\.com\b/i, weight: 0.8, label: 'MaxPreps link' },
    ],
  },

  // Fitness
  {
    id: 'mindbody',
    name: 'Mindbody',
    category: 'fitness',
    blurb: 'Class schedule + instructor lineup from Mindbody for gym / yoga studios.',
    connectHref: null,
    signals: [
      { pattern: /\bmindbodyonline\.com|mindbody\.io\b/i, weight: 0.7, label: 'Mindbody link' },
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
  church: ['streaming', 'calendar'],
  parish: ['streaming', 'calendar'],
};

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
      return { source: 'url', inputSummary, candidates: [], warnings };
    }

    // Build a single lowercased haystack: visible text + script-src
    // attrs + link hrefs + meta tags. Provider rules are written to
    // match against any of these.
    const haystack = this.buildHaystack(html);

    const candidates = this.scoreRules(haystack, /* boostByCategory */ {});
    return { source: 'url', inputSummary, candidates, warnings };
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
      return { source: 'description', inputSummary: '', candidates: [], warnings };
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
      candidates.push({
        id: rule.id,
        name: rule.name,
        category: rule.category,
        confidence,
        blurb: rule.blurb,
        matchedSignals: matched,
        connectHref: rule.connectHref,
      });
    }

    candidates.sort((a, b) => b.confidence - a.confidence);
    // Cap at 12 — anything below that is noise for the operator.
    return candidates.slice(0, 12);
  }
}
