/**
 * Streaming integrations — provider catalog and shared types.
 * ────────────────────────────────────────────────────────────
 *
 * Sprint 8c (2026-05-03) — multi-tenant streaming framework. Gym /
 * bar / restaurant operators connect a streaming provider, enter
 * their auth, pick channels, and our digital-signage player streams
 * that content alongside ad rotations.
 *
 * This file is the SINGLE SOURCE OF TRUTH for which providers we
 * support, what auth they need, and what kind of playback they emit.
 * Both the API (server-side credential validation) and the web app
 * (provider picker UI, connection wizard) read from this catalog.
 *
 * Adding a new provider = one entry below + one server-side handler
 * in `apps/api/src/streaming/providers/<id>.ts` + (optionally) a
 * widget renderer if their playback type needs custom logic.
 *
 * LICENSING DISCIPLINE — every provider declares
 * `commercialUseLegal: boolean`. If false, we BLOCK the connection
 * wizard from completing for non-test tenants. Consumer streaming
 * services (Netflix / Hulu / Disney+) are explicitly NOT in this
 * catalog because their TOS forbid commercial display. Operators who
 * want sports/movies in a venue must use a venue-licensed product
 * (Atmosphere TV, DIRECTV STREAM for Business, etc.).
 */

/** Authentication strategy required to connect this provider. */
export type StreamAuthKind =
  | 'none'        // free public streams (Pluto, Tubi, public HLS URLs)
  | 'apiKey'      // simple API key + optional account/org id
  | 'oauth2'      // standard OAuth 2 with refresh tokens
  | 'license'     // venue license number + region (DIRECTV, DISH)
  | 'customHls'   // operator pastes their own HLS / DASH URL (one per channel)
  | 'iframeOnly'; // pure iframe embed, no auth (YouTube public videos)

/**
 * 2026-05-03 — operator audit: be honest about which providers actually
 * have a working public integration vs. which are essentially closed
 * platforms ("they have an app, not an API"). Atmosphere TV is the
 * canonical example: they sell their own Fire Stick / Apple TV
 * hardware + a B2B sales-only partnership, but no public Publisher
 * API a third-party CMS can embed.
 *
 * Tier semantics drive UI:
 *   - DIRECT  → green "Connect" button visible to operators today.
 *               Real public API or open embed. Self-serve possible.
 *   - PARTNER → amber "Apply for partnership" link. Real API exists
 *               but requires a vendor-side application + approval
 *               (Toast, MINDBODY, the DOOH SSPs).
 *   - CLOSED  → grey info-only tile. No public API path; the operator
 *               can't connect this from our CMS even with our help.
 *               We list them so customers KNOW we know about them and
 *               can route to a sales-led discussion if they ask.
 */
export type StreamIntegrationTier = 'DIRECT' | 'PARTNER' | 'CLOSED';

/** Playback technology — drives which renderer the streaming widget uses. */
export type StreamPlaybackKind =
  | 'hls'      // <video> with hls.js polyfill — most common for FAST + IPTV
  | 'dash'     // <video> with shaka-player
  | 'iframe'   // YouTube / Twitch / Vimeo embed
  | 'rtmp'     // flash-era RTMP — limited browser support, server-only
  | 'rtsp';    // requires a transcoding gateway

/** Rough product category for the picker UI tabs. */
export type StreamCategory =
  | 'venue-fast'      // Atmosphere, business-grade FAST channels
  | 'free-fast'       // Pluto, Tubi, Plex, Crackle — free ad-supported
  | 'live-platform'   // Twitch, YouTube Live, Kick — UGC live
  | 'music'           // Soundtrack, iHeart for Business, Spotify
  | 'sports-news'     // venue-licensed sports / news (DIRECTV, ESPN biz)
  | 'custom';         // operator brings their own URL (HLS, RTMP, IPTV M3U)

export interface StreamProviderDef {
  /** Stable kebab-case id stored in DB / URLs. */
  id: string;
  name: string;
  category: StreamCategory;
  /** Real-world integration tier. Drives UI affordances. */
  integrationTier: StreamIntegrationTier;
  /** ≤ 80 char marketing line shown in the connection wizard tile. */
  blurb: string;
  /** Logo URL or short emoji. */
  iconUrl?: string;
  iconEmoji?: string;
  /** Primary auth strategy. */
  auth: StreamAuthKind;
  /** Primary playback type for channels from this provider. */
  playback: StreamPlaybackKind;
  /** Is commercial / venue use of this provider explicitly allowed by TOS? */
  commercialUseLegal: boolean;
  /** Tier note for operators (e.g. "Free for venues" / "$5/mo per location"). */
  pricingNote?: string;
  /** Whether the operator can overlay ads on this provider's content. */
  allowsAdOverlay: boolean;
  /** Developer / operator docs URL — shown in the wizard for setup help. */
  docsUrl?: string;
  /** Public website. */
  websiteUrl?: string;
  /** Verticals this provider is most relevant to. Empty = all. */
  bestFor?: ReadonlyArray<'GYM' | 'BAR' | 'RESTAURANT' | 'RETAIL' | 'CORPORATE' | 'K12'>;
  /** Compliance flag — if true, our wizard surfaces a "you may need a venue
   *  license from this provider before content can play" warning before
   *  saving the credentials. Defaults to false. */
  requiresVenueLicense?: boolean;
  /** Plain-English explanation of why this provider is in its tier.
   *  Shown in the UI tooltip / docs link. */
  tierReason?: string;
}

/**
 * The provider catalog. Order = priority order in the UI picker.
 *
 * Mark NEW providers with the `// NEW 2026-05-DD` tag so the
 * release notes can grep them.
 */
export const STREAM_PROVIDERS: ReadonlyArray<StreamProviderDef> = [
  // ─── TIER 1 — VENUE-NATIVE (purpose-built for businesses) ───────────
  // 2026-05-03 — operator audit: every provider in this section is
  // CLOSED. We list them so operators see we know they exist, but
  // there's no public API to embed their content from a third-party
  // CMS. They sell their own player apps + appliances. UI shows
  // these as info-only with a "contact sales" link rather than a
  // working "Connect" button.
  {
    id: 'atmosphere',
    name: 'Atmosphere TV',
    category: 'venue-fast',
    integrationTier: 'CLOSED',
    blurb: 'Free FAST channels for venues. Closed app — no public API.',
    iconEmoji: '📺',
    auth: 'apiKey',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'Free for venues — via their own app',
    allowsAdOverlay: false,
    docsUrl: 'https://atmosphere.tv/business/',
    websiteUrl: 'https://atmosphere.tv',
    bestFor: ['BAR', 'RESTAURANT', 'GYM'],
    tierReason: 'Atmosphere distributes through their own Fire TV / Apple TV app and has no public Publisher API. Customers run Atmosphere on their own dedicated screen, alongside (not inside) our CMS.',
  },
  {
    id: 'directv-business',
    name: 'DIRECTV for Business',
    category: 'sports-news',
    integrationTier: 'CLOSED',
    blurb: 'Venue cable + sports. Hardware receivers — no software embed.',
    iconEmoji: '🏈',
    auth: 'license',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'Venue subscription, hardware-only',
    allowsAdOverlay: false,
    docsUrl: 'https://www.business.directv.com/',
    websiteUrl: 'https://www.business.directv.com',
    requiresVenueLicense: true,
    bestFor: ['BAR', 'RESTAURANT', 'GYM'],
    tierReason: 'DIRECTV for Business is a satellite/IP receiver product. No developer API to stream their channels into a third-party CMS.',
  },
  {
    id: 'dish-business',
    name: 'DISH Business',
    category: 'sports-news',
    integrationTier: 'CLOSED',
    blurb: 'Venue cable receivers — no software embed path.',
    iconEmoji: '📡',
    auth: 'license',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'Venue subscription, hardware-only',
    allowsAdOverlay: false,
    docsUrl: 'https://business.dish.com/',
    websiteUrl: 'https://business.dish.com',
    requiresVenueLicense: true,
    bestFor: ['BAR', 'RESTAURANT'],
    tierReason: 'Same as DIRECTV — receiver hardware, not a software API. Customers run DISH on a dedicated TV.',
  },
  {
    id: 'mood-media',
    name: 'Mood Media',
    category: 'venue-fast',
    integrationTier: 'CLOSED',
    blurb: 'Background music/video for hospitality. Proprietary players only.',
    iconEmoji: '🎬',
    auth: 'apiKey',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'Subscription via Mood',
    allowsAdOverlay: false,
    websiteUrl: 'https://us.moodmedia.com',
    bestFor: ['BAR', 'RESTAURANT', 'RETAIL'],
    tierReason: 'Mood Media uses proprietary playback hardware and contracts. No public API; customer would buy directly from Mood.',
  },

  // ─── TIER 2 — FREE FAST ─────────────────────────────────────────────
  // Pluto / Tubi / Plex were considered here but their consumer TOS
  // explicitly forbids commercial display. Unofficial m3u8 endpoints
  // exist on the web but using them is litigation bait. Removed from
  // the catalog. DistroTV had a venue-program rumor but no public
  // self-serve API as of 2026-05; it's a partner-only conversation.

  // ─── TIER 2.5 — PUBLIC BROADCASTERS (explicitly venue-friendly) ─────
  // Major public-broadcasting orgs explicitly invite free public + venue
  // rebroadcast of their international live streams. Bundled as a single
  // catalog entry with a curated channel list shipped server-side so
  // operators don't have to hunt down URLs. Ad-overlay-friendly because
  // the broadcasters don't run pre-rolls.
  {
    id: 'public-broadcasters',
    name: 'Public Broadcasters',
    category: 'free-fast',
    integrationTier: 'DIRECT',
    blurb: 'NHK World · France 24 · DW · Al Jazeera · Bloomberg · Sky · CBS. Free, no auth.',
    iconEmoji: '🌍',
    auth: 'none',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: 'Free',
    allowsAdOverlay: true,
    websiteUrl: 'https://www3.nhk.or.jp/nhkworld/en/live/',
    bestFor: ['BAR', 'RESTAURANT', 'GYM', 'RETAIL', 'CORPORATE'],
    tierReason: 'These broadcasters explicitly invite free public + venue rebroadcast of their international live streams. We embed their public YouTube live channels — zero auth, works today, fully self-serve.',
  },

  // ─── TIER 3 — LIVE PLATFORMS (Twitch / YouTube / etc.) ──────────────
  {
    id: 'youtube',
    name: 'YouTube',
    category: 'live-platform',
    integrationTier: 'DIRECT',
    blurb: 'Embed any public video, channel, or live stream by URL.',
    iconEmoji: '▶️',
    auth: 'iframeOnly',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: 'Free',
    allowsAdOverlay: false,
    docsUrl: 'https://developers.google.com/youtube/iframe_api_reference',
    websiteUrl: 'https://www.youtube.com',
    bestFor: ['GYM', 'BAR', 'RESTAURANT', 'RETAIL', 'CORPORATE'],
    tierReason: 'Public YouTube IFrame Player API. No partner approval needed for public-video embeds; works today.',
  },
  {
    id: 'twitch',
    name: 'Twitch',
    category: 'live-platform',
    integrationTier: 'DIRECT',
    blurb: 'Live streams + VODs. Embed any channel by login.',
    iconEmoji: '🎮',
    auth: 'iframeOnly',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: 'Free',
    allowsAdOverlay: false,
    docsUrl: 'https://dev.twitch.tv/docs/embed/',
    websiteUrl: 'https://www.twitch.tv',
    bestFor: ['BAR', 'GYM'],
    tierReason: 'Public Twitch Embed JS SDK + iframe. Free dev account; embeds work on any host.',
  },
  {
    id: 'vimeo-live',
    name: 'Vimeo Live',
    category: 'live-platform',
    integrationTier: 'DIRECT',
    blurb: 'Branded live stream embeds for venues + events.',
    iconEmoji: '🎥',
    auth: 'oauth2',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: 'Vimeo Premium / OTT plan',
    allowsAdOverlay: true,
    docsUrl: 'https://developer.vimeo.com/',
    websiteUrl: 'https://vimeo.com/live',
    bestFor: ['CORPORATE', 'RESTAURANT', 'RETAIL'],
    tierReason: 'Vimeo Player SDK + REST API are publicly documented. Operator pays Vimeo directly for OTT plan; we embed.',
  },

  // ─── TIER 4 — MUSIC / RADIO ─────────────────────────────────────────
  {
    id: 'soundtrack',
    name: 'Soundtrack Your Brand',
    category: 'music',
    integrationTier: 'DIRECT',
    blurb: 'Licensed background music for businesses (Spotify-backed).',
    iconEmoji: '🎵',
    auth: 'oauth2',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: '~$35/mo per location',
    allowsAdOverlay: true,
    docsUrl: 'https://developer.soundtrackyourbrand.com/',
    websiteUrl: 'https://www.soundtrackyourbrand.com',
    bestFor: ['BAR', 'RESTAURANT', 'RETAIL', 'GYM'],
    tierReason: 'Public GraphQL API + OAuth at developer.soundtrackyourbrand.com. Self-serve.',
  },
  {
    id: 'iheart-business',
    name: 'iHeart for Business',
    category: 'music',
    integrationTier: 'CLOSED',
    blurb: 'Licensed radio for venues (operated by Stingray). No public API.',
    iconEmoji: '📻',
    auth: 'apiKey',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: 'Stingray subscription, hardware-only',
    allowsAdOverlay: false,
    websiteUrl: 'https://business.iheart.com',
    bestFor: ['GYM', 'RESTAURANT'],
    tierReason: 'iHeart for Business is operated by Stingray Business Music as a hardware/contracted service. No public developer API for third-party CMS embed.',
  },

  // ─── TIER 5 — CUSTOM (operator brings their own URL) ────────────────
  {
    id: 'custom-hls',
    name: 'Custom HLS / DASH URL',
    category: 'custom',
    integrationTier: 'DIRECT',
    blurb: 'Paste any HLS (.m3u8) or DASH (.mpd) playlist URL. Self-managed.',
    iconEmoji: '🔗',
    auth: 'customHls',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'Bring your own',
    allowsAdOverlay: true,
    bestFor: ['CORPORATE', 'GYM', 'BAR', 'RESTAURANT', 'RETAIL'],
    tierReason: 'Operator certifies they own or are licensed for the content. We just play the URL via hls.js / shaka. Most powerful path — works with any legal HLS / DASH source.',
  },
  {
    id: 'iptv-m3u',
    name: 'IPTV M3U Playlist',
    category: 'custom',
    integrationTier: 'DIRECT',
    blurb: 'Upload a .m3u / .m3u8 playlist file (multi-channel IPTV).',
    iconEmoji: '📋',
    auth: 'customHls',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'Bring your own',
    allowsAdOverlay: true,
    bestFor: ['BAR', 'RESTAURANT'],
    tierReason: 'Operator uploads their licensed M3U feed (e.g. cable provider, in-house IPTV). We parse + render channels.',
  },
];

/** Lookup helper. Returns undefined for unknown ids. */
export function getStreamProvider(id: string): StreamProviderDef | undefined {
  return STREAM_PROVIDERS.find((p) => p.id === id);
}

/** All provider ids — used for Zod enum validation at the API. */
export const STREAM_PROVIDER_IDS = STREAM_PROVIDERS.map((p) => p.id) as readonly string[];

// ─── DTO shapes for API endpoints ──────────────────────────────────────

/** What the provider catalog endpoint returns to the web app. Hides
 *  internal flags that aren't user-visible. */
export interface StreamProviderListItem {
  id: string;
  name: string;
  category: StreamCategory;
  integrationTier: StreamIntegrationTier;
  blurb: string;
  iconUrl?: string;
  iconEmoji?: string;
  auth: StreamAuthKind;
  playback: StreamPlaybackKind;
  commercialUseLegal: boolean;
  allowsAdOverlay: boolean;
  pricingNote?: string;
  docsUrl?: string;
  websiteUrl?: string;
  bestFor?: ReadonlyArray<string>;
  requiresVenueLicense?: boolean;
  tierReason?: string;
}

export interface StreamConnectionDto {
  id: string;
  providerId: string;
  providerName: string;
  displayName?: string;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'ERROR';
  statusReason?: string;
  lastVerifiedAt?: string;
  expiresAt?: string;
  channelCount: number;
  createdAt: string;
}

export interface StreamChannelDto {
  id: string;
  connectionId: string;
  providerId: string;
  externalId: string;
  kind: 'LIVE' | 'VOD' | 'PLAYLIST' | 'RADIO';
  title: string;
  description?: string;
  thumbnailUrl?: string;
  category?: string;
  playbackUrl?: string;
  playbackType?: StreamPlaybackKind;
  allowAdOverlay: boolean;
  status: 'ACTIVE' | 'DISABLED' | 'REMOVED_BY_PROVIDER';
}

export interface StreamAdSlotDto {
  id: string;
  name: string;
  assetId: string;
  channelId?: string;
  screenGroupId?: string;
  config: {
    dayparts?: Array<{ daysOfWeek: number[]; start: string; end: string }>;
    placement?: 'lower-third' | 'side-rail' | 'full-bleed';
    intervalMs?: number;
    durationMs?: number;
    startDate?: string;
    endDate?: string;
    weight?: number;
  };
  isActive: boolean;
}
