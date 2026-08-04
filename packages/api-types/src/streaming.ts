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
 *   BRIDGE          — Provider has no third-party CMS API, BUT the
 *                     customer can subscribe directly + run the
 *                     provider's signal through HDMI capture → HLS
 *                     encoder → our Custom HLS connector. We supply
 *                     the templates + setup guide. Blue badge.
 *                     Examples: DIRECTV, DISH, Atmosphere TV.
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
  // ─── TIER 1 — VENUE-NATIVE via HARDWARE BRIDGE ─────────────────────
  // 2026-05-03 — operator follow-up: customer brings their own
  // subscription, we provide the integration. None of these have a
  // public CMS API, but they ALL have HDMI output (or run on a Fire
  // TV / Apple TV that has HDMI). Pro-AV integrators bridge them
  // into a CMS via a USB capture card → ffmpeg encoder → local HLS
  // server, then our Custom HLS connector renders the captured
  // stream as a normal channel inside our CMS.
  {
    id: 'atmosphere',
    name: 'Atmosphere TV',
    category: 'venue-fast',
    integrationTier: 'BRIDGE',
    blurb: 'Customer brings Atmosphere subscription; we render via HDMI capture bridge.',
    iconEmoji: '📺',
    auth: 'customHls',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'Free Atmosphere subscription + ~$200 capture card',
    allowsAdOverlay: false,
    docsUrl: 'https://atmosphere.tv/business/',
    websiteUrl: 'https://atmosphere.tv',
    bestFor: ['BAR', 'RESTAURANT', 'GYM'],
    tierReason: 'Atmosphere has no public CMS API but their app runs on Fire TV / Apple TV with HDMI output. Customer captures that HDMI, encodes to HLS, and we play it inside our CMS like any custom HLS channel.',
    bridgeSteps: [
      { step: 'Customer signs up for free Atmosphere venue account at atmosphere.tv/business', productExamples: ['Atmosphere TV (free)'] },
      { step: 'Install Atmosphere app on a streaming device (Fire TV Stick 4K is cheapest, ~$50)', productExamples: ['Amazon Fire TV Stick 4K', 'Apple TV 4K'] },
      { step: 'Connect that device\'s HDMI output to a USB HDMI capture card', productExamples: ['Magewell USB Capture HDMI 4K Plus (~$400)', 'AVerMedia Live Gamer ULTRA (~$200)', 'Elgato HD60 X (~$180)'] },
      { step: 'Plug the capture card into a small Linux PC / mini-PC running OBS Studio or ffmpeg → HLS', productExamples: ['Beelink Mini S12 (~$170)', 'Intel NUC (~$300)', 'Raspberry Pi 5 + capture HAT'] },
      { step: 'Configure ffmpeg to push HLS to a local web server (we provide a one-click Docker image)', productExamples: ['venueos/hls-bridge Docker image (free)'] },
      { step: 'In our CMS, connect "Custom HLS" with the local HLS URL — done. Templates render Atmosphere as a channel.', productExamples: [] },
    ],
  },
  {
    id: 'directv-business',
    name: 'DIRECTV for Business',
    category: 'sports-news',
    integrationTier: 'BRIDGE',
    blurb: 'Customer brings DIRECTV subscription; HDMI capture bridges into our CMS.',
    iconEmoji: '🏈',
    auth: 'customHls',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'DIRECTV venue subscription + ~$200 capture card',
    allowsAdOverlay: false,
    docsUrl: 'https://www.business.directv.com/',
    websiteUrl: 'https://www.business.directv.com',
    requiresVenueLicense: true,
    bestFor: ['BAR', 'RESTAURANT', 'GYM'],
    tierReason: 'DIRECTV for Business is a hardware receiver (satellite or IP). Same bridge pattern as Atmosphere — capture the receiver\'s HDMI output, encode to HLS, render through our Custom HLS connector. Common pro-AV setup for sports bars.',
    bridgeSteps: [
      { step: 'Customer subscribes to DIRECTV for Business with their existing venue license', productExamples: ['DIRECTV STREAM for Business', 'DIRECTV Satellite for Business'] },
      { step: 'Connect DIRECTV receiver\'s HDMI output to a capture card', productExamples: ['Magewell USB Capture HDMI 4K Plus', 'Datavideo CAP-2 (rack-mount)'] },
      { step: 'Run capture card → mini-PC → ffmpeg → local HLS server', productExamples: ['Our venueos/hls-bridge Docker image', 'OBS Studio with HLS output plugin'] },
      { step: 'Connect "Custom HLS" in our CMS to the local HLS URL', productExamples: [] },
      { step: 'Templates can now render DIRECTV inside our streaming widget alongside ad overlays + tap list + happy hour countdown', productExamples: [] },
    ],
  },
  {
    id: 'dish-business',
    name: 'DISH Business',
    category: 'sports-news',
    integrationTier: 'BRIDGE',
    blurb: 'Customer brings DISH subscription; HDMI capture bridges into our CMS.',
    iconEmoji: '📡',
    auth: 'customHls',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'DISH venue subscription + ~$200 capture card',
    allowsAdOverlay: false,
    docsUrl: 'https://business.dish.com/',
    websiteUrl: 'https://business.dish.com',
    requiresVenueLicense: true,
    bestFor: ['BAR', 'RESTAURANT'],
    tierReason: 'Same bridge pattern as DIRECTV. DISH Smartbox commercial receivers have HDMI output; capture + encode + render via Custom HLS.',
    bridgeSteps: [
      { step: 'Customer subscribes to DISH Business or DISH Outdoor', productExamples: ['DISH Smartbox Premium', 'DISH Outdoor'] },
      { step: 'Connect Smartbox HDMI to a capture card → mini-PC → ffmpeg HLS encoder', productExamples: ['Magewell USB Capture HDMI', 'Elgato HD60 X'] },
      { step: 'Connect "Custom HLS" in our CMS to the local HLS URL', productExamples: [] },
    ],
  },
  {
    id: 'mood-media',
    name: 'Mood Media',
    category: 'venue-fast',
    integrationTier: 'BRIDGE',
    blurb: 'Customer brings Mood subscription; capture audio + visual via Mood Player HDMI.',
    iconEmoji: '🎬',
    auth: 'customHls',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'Mood subscription + capture card',
    allowsAdOverlay: false,
    websiteUrl: 'https://us.moodmedia.com',
    bestFor: ['BAR', 'RESTAURANT', 'RETAIL'],
    tierReason: 'Mood Media supplies their own player hardware which has HDMI / line-out. Same bridge pattern works.',
    bridgeSteps: [
      { step: 'Customer keeps their existing Mood Media contract + player', productExamples: ['Mood ProFusion iO', 'Mood ProFusion iV'] },
      { step: 'Capture player HDMI output → encode to HLS', productExamples: ['Magewell USB Capture HDMI'] },
      { step: 'Connect "Custom HLS" in our CMS to the local HLS URL', productExamples: [] },
    ],
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
    // PARTNER, not DIRECT: the OAuth connect flow is NOT built yet
    // (the connect modal dead-ends at "OAuth not implemented — contact
    // sales"). Marking it DIRECT showed a green "Self-serve" badge that
    // promised a working connect we don't have. The working path TODAY is
    // to paste a Vimeo URL via "Custom HLS / IPTV" (iframe-embedded), so
    // this tile is honestly Partnership/assisted until the OAuth ships.
    integrationTier: 'PARTNER',
    blurb: 'Branded live stream embeds for venues + events. OAuth connect coming soon — for now, paste a Vimeo URL via "My own video stream".',
    iconEmoji: '🎥',
    auth: 'oauth2',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: 'Vimeo Premium / OTT plan',
    allowsAdOverlay: true,
    docsUrl: 'https://developer.vimeo.com/',
    websiteUrl: 'https://vimeo.com/live',
    bestFor: ['CORPORATE', 'RESTAURANT', 'RETAIL'],
    tierReason: 'Direct Vimeo OAuth connect is not built yet (contact sales). Working path today: paste any Vimeo video/live URL into the Custom HLS source — we embed it via Vimeo\'s iframe player.',
  },

  // ─── TIER 4 — MUSIC / RADIO ─────────────────────────────────────────
  {
    id: 'soundtrack',
    name: 'Soundtrack Your Brand',
    category: 'music',
    // PARTNER, not DIRECT: the OAuth connect flow is NOT built yet.
    // `auth: 'oauth2'` means createConnection() in the streaming service
    // rejects every connect attempt with HTTP 400 ("OAuth flow not yet
    // implemented — contact sales"), so a DIRECT tier showed a green
    // "Self-serve" badge + a Connect button that dead-ends at a 400.
    // Same fix already applied to the sibling oauth2 provider `vimeo-live`
    // above. Marked PARTNER (amber "Partnership" badge, "coming soon —
    // contact sales" modal) until the Soundtrack OAuth flow ships, so the
    // tile honestly reflects that it is NOT connectable yet.
    integrationTier: 'PARTNER',
    blurb: 'Licensed background music for businesses (Spotify-backed). OAuth connect coming soon — contact sales to activate.',
    iconEmoji: '🎵',
    auth: 'oauth2',
    playback: 'iframe',
    commercialUseLegal: true,
    pricingNote: '~$35/mo per location',
    allowsAdOverlay: true,
    docsUrl: 'https://developer.soundtrackyourbrand.com/',
    websiteUrl: 'https://www.soundtrackyourbrand.com',
    bestFor: ['BAR', 'RESTAURANT', 'RETAIL', 'GYM'],
    tierReason: 'Soundtrack has a public GraphQL API + OAuth, but our direct OAuth connect is not built yet (contact sales to activate). The connect flow would otherwise dead-end at a 400.',
  },
  {
    id: 'iheart-business',
    name: 'iHeart for Business',
    category: 'music',
    integrationTier: 'BRIDGE',
    blurb: 'Customer brings Stingray subscription; capture line-out audio.',
    iconEmoji: '📻',
    auth: 'customHls',
    playback: 'hls',
    commercialUseLegal: true,
    pricingNote: 'Stingray subscription + audio capture',
    allowsAdOverlay: false,
    websiteUrl: 'https://business.iheart.com',
    bestFor: ['GYM', 'RESTAURANT'],
    tierReason: 'iHeart for Business runs through Stingray hardware players. Capture the player\'s line-out / digital-out into a local HLS audio stream and we render it as a channel.',
    bridgeSteps: [
      { step: 'Customer keeps existing Stingray Business Music contract + player', productExamples: ['Stingray Business Music player'] },
      { step: 'Capture line-out / digital audio output to a USB audio interface', productExamples: ['Behringer U-Phoria UM2 (~$30)', 'Focusrite Scarlett 2i2'] },
      { step: 'Encode to audio-only HLS via ffmpeg', productExamples: ['Our venueos/hls-bridge Docker image with audio-only flag'] },
      { step: 'Connect "Custom HLS" in our CMS to the local audio HLS URL', productExamples: [] },
    ],
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
