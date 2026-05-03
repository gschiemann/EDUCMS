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
}

/**
 * The provider catalog. Order = priority order in the UI picker.
 *
 * Mark NEW providers with the `// NEW 2026-05-DD` tag so the
 * release notes can grep them.
 */
export const STREAM_PROVIDERS: ReadonlyArray<StreamProviderDef> = [
  // ─── TIER 1 — VENUE-NATIVE (purpose-built for businesses) ───────────
  {
    id: 'atmosphere',
    name: 'Atmosphere TV',
    category: 'venue-fast',
    blurb: 'Free streaming TV built for businesses — sports, news, lifestyle.',
    iconEmoji: '📺',
    auth: 'apiKey',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'Free for venues',
    allowsAdOverlay: false, // Atmosphere serves their own ads — operator overlay is NOT allowed
    docsUrl: 'https://atmosphere.tv/business/',
    websiteUrl: 'https://atmosphere.tv',
    bestFor: ['BAR', 'RESTAURANT', 'GYM'],
  },
  {
    id: 'directv-business',
    name: 'DIRECTV STREAM for Business',
    category: 'sports-news',
    blurb: 'Venue-licensed live sports + news (NFL, ESPN, Sunday Ticket).',
    iconEmoji: '🏈',
    auth: 'license',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'Venue subscription required',
    allowsAdOverlay: true,
    docsUrl: 'https://www.business.directv.com/',
    websiteUrl: 'https://www.business.directv.com',
    requiresVenueLicense: true,
    bestFor: ['BAR', 'RESTAURANT', 'GYM'],
  },
  {
    id: 'dish-business',
    name: 'DISH Business',
    category: 'sports-news',
    blurb: 'Venue-tier cable + sports for businesses.',
    iconEmoji: '📡',
    auth: 'license',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'Venue subscription required',
    allowsAdOverlay: true,
    docsUrl: 'https://business.dish.com/',
    websiteUrl: 'https://business.dish.com',
    requiresVenueLicense: true,
    bestFor: ['BAR', 'RESTAURANT'],
  },
  {
    id: 'mood-media',
    name: 'Mood Media',
    category: 'venue-fast',
    blurb: 'Background video + curated playlists for hospitality.',
    iconEmoji: '🎬',
    auth: 'apiKey',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'Subscription based',
    allowsAdOverlay: true,
    websiteUrl: 'https://us.moodmedia.com',
    bestFor: ['BAR', 'RESTAURANT', 'RETAIL'],
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
    blurb: 'NHK World · France 24 · DW · Al Jazeera English. Free + venue-friendly.',
    iconEmoji: '🌍',
    auth: 'none',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'Free',
    allowsAdOverlay: true,
    websiteUrl: 'https://www3.nhk.or.jp/nhkworld/en/live/',
    bestFor: ['BAR', 'RESTAURANT', 'GYM', 'RETAIL', 'CORPORATE'],
  },

  // ─── TIER 3 — LIVE PLATFORMS (Twitch / YouTube / etc.) ──────────────
  {
    id: 'youtube',
    name: 'YouTube',
    category: 'live-platform',
    blurb: 'Embed any public video, channel, or live stream by URL.',
    iconEmoji: '▶️',
    auth: 'iframeOnly',
    playback: 'iframe',
    commercialUseLegal: true, // public-video embeds are fine; operator confirms creator permission for non-public content
    pricingNote: 'Free',
    allowsAdOverlay: false, // YouTube embed runs YouTube ads; overlay would obscure them
    docsUrl: 'https://developers.google.com/youtube/iframe_api_reference',
    websiteUrl: 'https://www.youtube.com',
    bestFor: ['GYM', 'BAR', 'RESTAURANT', 'RETAIL', 'CORPORATE'],
  },
  {
    id: 'twitch',
    name: 'Twitch',
    category: 'live-platform',
    blurb: 'Live streams + VODs. Embed any channel by login.',
    iconEmoji: '🎮',
    auth: 'iframeOnly',
    playback: 'iframe',
    commercialUseLegal: true, // Twitch embeds permitted; ads pre-roll come from Twitch
    pricingNote: 'Free',
    allowsAdOverlay: false,
    docsUrl: 'https://dev.twitch.tv/docs/embed/',
    websiteUrl: 'https://www.twitch.tv',
    bestFor: ['BAR', 'GYM'],
  },
  {
    id: 'vimeo-live',
    name: 'Vimeo Live',
    category: 'live-platform',
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
  },

  // ─── TIER 4 — MUSIC / RADIO ─────────────────────────────────────────
  {
    id: 'soundtrack',
    name: 'Soundtrack Your Brand',
    category: 'music',
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
  },
  {
    id: 'iheart-business',
    name: 'iHeart Radio for Business',
    category: 'music',
    blurb: 'Licensed radio + curated stations for venues.',
    iconEmoji: '📻',
    auth: 'apiKey',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: 'Subscription based',
    allowsAdOverlay: true,
    websiteUrl: 'https://business.iheart.com',
    bestFor: ['GYM', 'RESTAURANT'],
  },

  // ─── TIER 5 — CUSTOM (operator brings their own URL) ────────────────
  {
    id: 'custom-hls',
    name: 'Custom HLS / DASH URL',
    category: 'custom',
    blurb: 'Paste any HLS (.m3u8) or DASH (.mpd) playlist URL. Self-managed.',
    iconEmoji: '🔗',
    auth: 'customHls',
    playback: 'hls',
    commercialUseLegal: true, // operator certifies they own / are licensed for the content
    pricingNote: 'Bring your own',
    allowsAdOverlay: true,
    bestFor: ['CORPORATE', 'GYM', 'BAR', 'RESTAURANT', 'RETAIL'],
  },
  {
    id: 'iptv-m3u',
    name: 'IPTV M3U Playlist',
    category: 'custom',
    blurb: 'Upload a .m3u / .m3u8 playlist file (multi-channel IPTV).',
    iconEmoji: '📋',
    auth: 'customHls',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'Bring your own',
    allowsAdOverlay: true,
    bestFor: ['BAR', 'RESTAURANT'],
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
