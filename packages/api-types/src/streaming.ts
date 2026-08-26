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
  | 'none'        // no provider credentials; rights verification still applies
  | 'apiKey'      // simple API key + optional account/org id
  | 'oauth2'      // standard OAuth 2 with refresh tokens
  | 'license'     // venue license number + region (DIRECTV, DISH)
  | 'customHls'   // operator pastes their own HLS / DASH URL (one per channel)
  | 'iframeOnly'; // pure iframe embed, no auth (YouTube public videos)

/**
 * 2026-05-03 — integration-tier reality. Be honest about each
 * provider's path so operators don't see "Connect" buttons that
 * lead nowhere.
 *
 *   DIRECT          — Real public API or open embed. Self-serve today.
 *                     Green badge.
 *
 *   PARTNER         — Real public API but vendor requires publisher
 *                     contract / application before activating
 *                     (Toast, Hivestack, etc.). Amber badge.
 *
 *   BRIDGE          — Legacy tier retained for saved records. New provider
 *                     rows must not claim HDMI capture/re-streaming unless a
 *                     provider contract explicitly authorizes it.
 *
 *   CLOSED          — No public API and no clean bridge workflow.
 *                     Customer runs the service entirely outside our
 *                     CMS (e.g. on a separate screen). Listed so
 *                     customers know we know about them. Grey badge.
 *                     Also used for a capability WE have not built yet
 *                     where listing it still helps operators find the
 *                     working alternative (see `iptv-m3u`, retiered from
 *                     DIRECT by the 2026-08-03 integration census).
 */
export type StreamIntegrationTier = 'DIRECT' | 'PARTNER' | 'BRIDGE' | 'CLOSED';

/** Playback technology — drives which renderer the streaming widget uses. */
export type StreamPlaybackKind =
  | 'hls'      // <video> with hls.js polyfill — most common for FAST + IPTV
  | 'dash'     // .mpd — NOT supported (no DASH player bundled); widget shows "use HLS" message
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
  /**
   * The provider SHIPS ITS OWN PLAYER — a receiver, a set-top box, a managed
   * appliance — and the venue's licence covers playback ON THAT DEVICE.
   *
   * This is a FACT ABOUT THE PROVIDER, declared here rather than inferred in
   * the UI from a provider id or a tier (the inference is how a board ends up
   * claiming a feed it does not have). It says nothing about what VenueOS can
   * do: as of 2026-08-25 there is NO input-switch capability anywhere in the
   * product — `DISPLAY_ACTIONS` carries no input verb, a vendor recipe carries
   * only brightness/blank/wake steps, `hardPowerOff: 'serial-candidate'` is
   * probe-only with no provider behind it, and `Screen.config.hdmiInSource` is
   * marked "reserved (NOT wired yet)". So a provider marked here is presented
   * as COMING SOON, never as connectable, until that capability actually
   * exists. When it does, this flag is what tells the UI which providers the
   * switch is FOR.
   */
  runsOnProviderDevice?: boolean;
  /** For BRIDGE-tier providers: ordered list of hardware/software the
   *  customer needs to bridge the provider's signal into our CMS. */
  bridgeSteps?: ReadonlyArray<{ step: string; detail?: string; productExamples?: ReadonlyArray<string> }>;
}

/**
 * The provider catalog. Order = priority order in the UI picker.
 *
 * Mark NEW providers with the `// NEW 2026-05-DD` tag so the
 * release notes can grep them.
 */
export const STREAM_PROVIDERS: ReadonlyArray<StreamProviderDef> = [
  // ─── VENUE-LICENSED EXTERNAL PLAYERS ────────────────────────────────
  // These are valid business services, but VenueOS has no completed,
  // sanctioned device/input adapter for them today. Do not treat HDMI
  // capture and re-encoding as an assumed integration or distribution right.
  {
    id: 'atmosphere',
    name: 'Atmosphere TV',
    category: 'venue-fast',
    integrationTier: 'CLOSED',
    blurb: 'Licensed business TV on an Atmosphere device; VenueOS control not built yet.',
    iconEmoji: '📺',
    auth: 'none',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: '$49.99 activation; $0/mo when usage requirement is met',
    allowsAdOverlay: false,
    docsUrl: 'https://help.atmosphere.tv/how-much-does-atmosphere-cost',
    websiteUrl: 'https://atmosphere.tv',
    bestFor: ['BAR', 'RESTAURANT', 'GYM'],
    runsOnProviderDevice: true,
    tierReason: 'Atmosphere is licensed for businesses and uses its own managed player. VenueOS has no public Atmosphere playback API, device heartbeat, input switcher, or acknowledgement path yet.',
  },
  {
    id: 'directv-business',
    name: 'DIRECTV for Business',
    category: 'sports-news',
    integrationTier: 'CLOSED',
    blurb: 'Licensed business TV on a DIRECTV receiver; VenueOS control not built yet.',
    iconEmoji: '🏈',
    auth: 'license',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: 'Commercial subscription required',
    allowsAdOverlay: false,
    docsUrl: 'https://www.directv.com/forbusiness/',
    websiteUrl: 'https://www.directv.com/forbusiness/',
    requiresVenueLicense: true,
    bestFor: ['BAR', 'RESTAURANT', 'GYM'],
    runsOnProviderDevice: true,
    tierReason: 'DIRECTV offers a business-only service for health and fitness centers. Playback stays on the approved receiver/app. VenueOS needs a sanctioned external-input controller and health acknowledgement before this can be connected.',
  },
  {
    id: 'dish-business',
    name: 'DISH Business',
    category: 'sports-news',
    integrationTier: 'CLOSED',
    blurb: 'Licensed DISH Business receiver; VenueOS control not built yet.',
    iconEmoji: '📡',
    auth: 'license',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: 'Commercial subscription required',
    allowsAdOverlay: false,
    docsUrl: 'https://business.dish.com/',
    websiteUrl: 'https://business.dish.com',
    requiresVenueLicense: true,
    bestFor: ['BAR', 'RESTAURANT'],
    runsOnProviderDevice: true,
    tierReason: 'Playback stays on the commercial DISH receiver/SMARTBOX. The VenueOS external-input controller and device heartbeat are not implemented.',
  },
  {
    id: 'mood-media',
    name: 'Mood Media',
    category: 'venue-fast',
    integrationTier: 'CLOSED',
    blurb: 'Provider-managed commercial player; public VenueOS API not available.',
    iconEmoji: '🎬',
    auth: 'none',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: 'Commercial subscription required',
    allowsAdOverlay: false,
    websiteUrl: 'https://us.moodmedia.com',
    bestFor: ['BAR', 'RESTAURANT', 'RETAIL'],
    runsOnProviderDevice: true,
    tierReason: 'Mood Harmony provides its own player, portal and monitoring. No sanctioned public playback API is implemented in VenueOS; do not capture or scrape the service.',
  },

  // ─── TIER 2 — FREE FAST ─────────────────────────────────────────────
  // Pluto / Tubi / Plex were considered here but their consumer TOS
  // explicitly forbids commercial display. Unofficial m3u8 endpoints
  // exist on the web but using them is litigation bait. Removed from
  // the catalog. DistroTV had a venue-program rumor but no public
  // self-serve API as of 2026-05; it's a partner-only conversation.

  // ─── PUBLIC BROADCASTERS ────────────────────────────────────────────
  // The prior implementation embedded broadcaster YouTube channels and
  // treated availability as permission. YouTube's terms prohibit public
  // screening; every channel needs a direct supported feed plus written
  // commercial rights before this catalog can return.
  {
    id: 'public-broadcasters',
    name: 'Public Broadcasters',
    category: 'free-fast',
    integrationTier: 'CLOSED',
    blurb: 'Direct broadcaster distribution rights and supported feeds required.',
    iconEmoji: '🌍',
    auth: 'none',
    playback: 'iframe',
    commercialUseLegal: false,
    pricingNote: 'Not available as a bundled VenueOS catalog',
    allowsAdOverlay: false,
    websiteUrl: 'https://www3.nhk.or.jp/nhkworld/en/live/',
    bestFor: ['BAR', 'RESTAURANT', 'GYM', 'RETAIL', 'CORPORATE'],
    tierReason: 'The old presets used YouTube embeds and unverified public-performance claims. VenueOS will not expose them until each broadcaster supplies a direct commercial distribution path.',
  },

  // ─── TIER 3 — LIVE PLATFORMS (Twitch / YouTube / etc.) ──────────────
  {
    id: 'youtube',
    name: 'YouTube',
    category: 'live-platform',
    integrationTier: 'CLOSED',
    blurb: 'Consumer YouTube public screening is not permitted in a gym.',
    iconEmoji: '▶️',
    auth: 'iframeOnly',
    playback: 'iframe',
    commercialUseLegal: false,
    pricingNote: 'Blocked for public commercial playback',
    allowsAdOverlay: false,
    docsUrl: 'https://developers.google.com/youtube/iframe_api_reference',
    websiteUrl: 'https://www.youtube.com',
    bestFor: ['GYM', 'BAR', 'RESTAURANT', 'RETAIL', 'CORPORATE'],
    tierReason: 'The IFrame API is technically embeddable, but YouTube terms prohibit public screening and streaming music from the service. Written provider/content rights are required for any exception.',
  },
  {
    id: 'twitch',
    name: 'Twitch',
    category: 'live-platform',
    integrationTier: 'CLOSED',
    blurb: 'Public embed is not a commercial gym programming license.',
    iconEmoji: '🎮',
    auth: 'iframeOnly',
    playback: 'iframe',
    commercialUseLegal: false,
    pricingNote: 'Blocked without written commercial rights',
    allowsAdOverlay: false,
    docsUrl: 'https://dev.twitch.tv/docs/embed/',
    websiteUrl: 'https://www.twitch.tv',
    bestFor: ['BAR', 'GYM'],
    tierReason: 'Technical embed support does not establish public-performance rights. VenueOS does not enable Twitch as general gym programming.',
  },
  {
    id: 'vimeo-live',
    name: 'Vimeo Live',
    category: 'live-platform',
    // PARTNER, not DIRECT: the OAuth connect flow is NOT built yet
    // (the connect modal dead-ends at "OAuth not implemented — contact
    // sales"). Marking it DIRECT showed a green "Self-serve" badge that
    // promised a working connect we don't have. The working path TODAY is
    // to paste a Vimeo URL via "Custom HLS / IPTV" (iframe-embedded), so
    // this tile is honestly Partnership/assisted until the OAuth ships.
    integrationTier: 'PARTNER',
    blurb: 'Host customer-owned/licensed video; direct VenueOS adapter not built yet.',
    iconEmoji: '🎥',
    auth: 'oauth2',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: 'Vimeo Premium / OTT plan',
    allowsAdOverlay: true,
    docsUrl: 'https://developer.vimeo.com/',
    websiteUrl: 'https://vimeo.com/live',
    bestFor: ['CORPORATE', 'RESTAURANT', 'RETAIL', 'GYM'],
    tierReason: 'Vimeo supports embeds, domain privacy and OAuth for customer-owned/licensed video. VenueOS must ship the provider adapter and preserve content-rights metadata before calling it connected.',
  },

  // ─── TIER 4 — MUSIC / RADIO ─────────────────────────────────────────
  {
    id: 'soundtrack',
    name: 'Soundtrack',
    category: 'music',
    // PARTNER, not DIRECT: Soundtrack documents a public GraphQL API, but
    // VenueOS has not shipped the server adapter, account/zone binding,
    // freshness logic, or provider acknowledgement tests. API access is for
    // metadata/control around Soundtrack's licensed player, not raw audio.
    integrationTier: 'PARTNER',
    blurb: 'Licensed business audio with documented control, metadata and monitoring API.',
    iconEmoji: '🎵',
    auth: 'apiKey',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: '~$35/mo per location',
    allowsAdOverlay: true,
    docsUrl: 'https://api.soundtrack.io/v2/docs',
    websiteUrl: 'https://www.soundtrack.io',
    bestFor: ['BAR', 'RESTAURANT', 'RETAIL', 'GYM'],
    tierReason: 'The GraphQL API can provide now-playing, staff control and monitoring over a Soundtrack player. It does not expose a raw audio stream. VenueOS must keep tokens server-side and verify a licensed sound zone.',
  },
  {
    id: 'rockbot',
    name: 'Rockbot',
    category: 'music',
    integrationTier: 'PARTNER',
    blurb: 'Gym-focused licensed music with approval-gated control and metadata API.',
    iconEmoji: '🎚️',
    auth: 'oauth2',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: 'Commercial subscription + API approval',
    allowsAdOverlay: false,
    docsUrl: 'https://developer.rockbot.com/start.html',
    websiteUrl: 'https://rockbot.com',
    bestFor: ['GYM', 'RETAIL', 'RESTAURANT'],
    tierReason: 'Rockbot documents OAuth client credentials for zones, now playing, queues, controls and messaging. Audio stays on the Rockbot player; instructor-led classes require separate rights.',
  },
  {
    id: 'soundmachine',
    name: 'SoundMachine',
    category: 'music',
    integrationTier: 'PARTNER',
    blurb: 'Commercial background music with an approval-gated playback API.',
    iconEmoji: '🎵',
    auth: 'apiKey',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: 'Commercial subscription + developer approval',
    allowsAdOverlay: false,
    docsUrl: 'https://developer.sound-machine.com/',
    websiteUrl: 'https://sound-machine.com',
    bestFor: ['GYM', 'RETAIL', 'RESTAURANT'],
    tierReason: 'SoundMachine supplies approved third-party developers with app credentials. VenueOS has not yet shipped the server adapter or licensed player contract.',
  },
  {
    id: 'iheart-business',
    name: 'iHeart for Business',
    category: 'music',
    integrationTier: 'CLOSED',
    blurb: 'Provider-managed commercial player; public VenueOS API not available.',
    iconEmoji: '📻',
    auth: 'none',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: 'Commercial subscription required',
    allowsAdOverlay: false,
    websiteUrl: 'https://business.iheart.com',
    bestFor: ['GYM', 'RESTAURANT'],
    runsOnProviderDevice: true,
    tierReason: 'Playback stays inside the Stingray/iHeart business player. VenueOS has no sanctioned control API and must not capture or restream its audio.',
  },

  // ─── TIER 5 — CUSTOM (operator brings their own URL) ────────────────
  {
    id: 'custom-hls',
    name: 'Custom HLS URL',
    category: 'custom',
    integrationTier: 'DIRECT',
    blurb: 'Paste any HLS (.m3u8) playlist URL. Self-managed.',
    iconEmoji: '🔗',
    auth: 'customHls',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'Bring your own',
    allowsAdOverlay: true,
    bestFor: ['CORPORATE', 'GYM', 'BAR', 'RESTAURANT', 'RETAIL'],
    tierReason: 'Operator certifies they own or are licensed for the content. We just play the URL via hls.js. Most powerful path — works with any legal HLS source. (MPEG-DASH .mpd is not supported — most providers also offer HLS.)',
  },
  {
    id: 'iptv-m3u',
    name: 'IPTV M3U Playlist',
    category: 'custom',
    // Census C-2 (2026-08-03): was DIRECT — "self-serve today, green badge" —
    // with tierReason "We parse + render channels". No M3U parser exists
    // anywhere in the repo (two independent searches for EXTINF / EXTM3U /
    // parseM3U returned zero) and there is no upload path, so DIRECT was a
    // promise the product could not keep: the tile rendered a Connect button
    // that leads nowhere, which is the exact thing this tier system was
    // introduced to prevent. CLOSED is the honest tier — grey badge, no
    // Connect button — and the tierReason points at what DOES work today.
    integrationTier: 'CLOSED',
    blurb: 'Multi-channel .m3u playlist upload — not supported yet.',
    iconEmoji: '📋',
    auth: 'customHls',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'Bring your own',
    allowsAdOverlay: true,
    bestFor: ['BAR', 'RESTAURANT'],
    tierReason: 'We do not parse multi-channel M3U playlists and there is no playlist-upload path. A SINGLE live stream works today: use "Custom HLS Stream" and paste the channel\'s .m3u8 URL directly.',
  },
];

/** Lookup helper. Returns undefined for unknown ids. */
export function getStreamProvider(id: string): StreamProviderDef | undefined {
  return STREAM_PROVIDERS.find((p) => p.id === id);
}

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
  // Cycle-2 BUG-006 fix (2026-05-03) — controller's listProviders()
  // already passes through `bridgeSteps`; the DTO interface dropped
  // it, so the web app fell back to `any` for the BRIDGE-tier setup
  // wizard. Mirrors the source-of-truth shape on StreamProviderDef.
  bridgeSteps?: ReadonlyArray<{
    step: string;
    detail?: string;
    productExamples?: ReadonlyArray<string>;
  }>;
}

/**
 * What a connected source can actually DO for a media board. Derived
 * server-side from the provider definition so the editor never has to
 * infer capability from a provider id — the inference is exactly how a
 * board ends up claiming a live feed it does not have.
 *
 *   RENDERS  — VenueOS itself plays the media (a customer-owned or
 *              explicitly licensed MP4/HLS). We are the player, so the
 *              screen can honestly say LIVE once it is playing.
 *   EXTERNAL — playback happens on the provider's own licensed device or
 *              app. We may show status; we never claim native playback.
 *   PENDING_ADAPTER — a real business service with a real API that we
 *              have not finished building an adapter for. It can be
 *              recorded, but it cannot drive the screen yet.
 */
export type StreamMediaRole = 'RENDERS' | 'EXTERNAL' | 'PENDING_ADAPTER';

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
  /** Provider tier, so the editor can label the source honestly. */
  integrationTier?: StreamIntegrationTier;
  /** What this connection can do for a media board. See StreamMediaRole. */
  mediaRole?: StreamMediaRole;
  /** True when this source carries audio for the venue rather than video. */
  isMusic?: boolean;
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
