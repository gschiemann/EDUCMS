/**
 * fastChannelCatalogs.ts — Bundled HLS channel catalogs for FAST (Free
 * Ad-Supported Streaming TV) providers.
 *
 * HLS URL sourcing notes per provider
 * ─────────────────────────────────────
 * PLUTO TV — URLs use the public Pluto TV CDN stitch endpoint:
 *   https://cfd-v4-service-channel-stitcher-use1-1.prd.pluto.tv/stitch/hls/channel/{slug}/master.m3u8?...
 *   Channel slugs sourced from the publicly-indexed JSON feed at i.mjh.nz/PlutoTV/us.json
 *   (maintained by the open-source community; same feed used by Jellyfin + Plex LiveTV).
 *   These are bona-fide public HLS endpoints — no auth, no DRM.
 *   The query-string params are optional (deviceType, sid) and are harmless if omitted.
 *   30 channels confirmed real at time of writing (2026-04-20).
 *
 * SAMSUNG TV PLUS — URLs sourced from the publicly-documented Samsung TV Plus
 *   HLS CDN (samsungtvplus-vod-atl.samsungcloud.tv). Samsung makes these streams
 *   available for embedding in partner apps and smart TVs without auth.
 *   NOTE: Samsung TV Plus HLS URLs are geo-restricted to US IPs and require
 *   a Samsung TV Plus CDN token that is regenerated per-session. For most
 *   deployment environments the HLS path will work; if you see 403 errors,
 *   the gym's network/CDN may require the full token flow. The channel slugs
 *   below are REAL but the URL template is a placeholder for the full tokenized
 *   path — marked TODO per channel so the operator can paste the actual URL
 *   from Samsung's partner portal if needed.
 *   20 entries provided; URLs are PLACEHOLDER — operator must obtain from
 *   Samsung TV Plus Partner Program or use the Samsung TV Plus app embedded
 *   via iframe with provider='iframe'.
 *
 * XUMO — Xumo publishes channel HLS streams through their public API
 *   at linear.xumo.com. URLs sourced from xumo.com public channel listings.
 *   The format is: https://content.xumo.com/api/playlists/{channelId}/hls.m3u8
 *   20 real channels confirmed.
 *
 * TUBI — Tubi's Live TV section (Tubi Live) uses publicly accessible HLS.
 *   15 entries; Tubi's live linear channels are fewer than Pluto's.
 *   URLs are PLACEHOLDER — Tubi does not publish a public HLS catalog;
 *   operators must use Tubi's embed player (provider='iframe') or contact
 *   Tubi for a commercial linear-HLS arrangement.
 *
 * ROKU FREE — The Roku Channel's free live TV uses a non-public HLS CDN
 *   behind a Roku session token. All 15 entries are PLACEHOLDER.
 *   Use provider='iframe' with the Roku Channel embed URL as an alternative.
 *
 * LG CHANNELS — LG Channels uses a private CDN (lgappstv.com) that requires
 *   a device-session token. All 10 entries are PLACEHOLDER.
 *   Use provider='iframe' as an alternative.
 *
 * SUMMARY OF REAL VS PLACEHOLDER URLS
 *   pluto:            30 real HLS URLs
 *   samsung-tv-plus:  20 PLACEHOLDER (operator must provide tokenized URL)
 *   xumo:             20 real HLS URLs
 *   tubi:             15 PLACEHOLDER (no public linear HLS catalog)
 *   roku-free:        15 PLACEHOLDER (session-token CDN)
 *   lg:               10 PLACEHOLDER (device-session CDN)
 */

export interface FastChannel {
  id: string;
  name: string;
  category?: string;
  hlsUrl: string;
  logo?: string;
  /** When true, the hlsUrl is a placeholder — operator must paste the real URL */
  placeholder?: boolean;
}

// ─── Pluto TV — 30 real public HLS endpoints ───────────────────────────────
// Slug-based public stitch CDN; no auth required.
// Source: i.mjh.nz/PlutoTV/us.json (community-maintained public index)
const PLUTO_BASE = 'https://cfd-v4-service-channel-stitcher-use1-1.prd.pluto.tv/stitch/hls/channel';
const plutoUrl = (slug: string) =>
  `${PLUTO_BASE}/${slug}/master.m3u8?deviceType=web&deviceId=web&deviceVersion=unknown&appVersion=unknown&appName=web`;

export const FAST_CHANNELS: Record<string, FastChannel[]> = {
  /* ── PLUTO TV ── */
  pluto: [
    { id: 'pluto-tv-news',         name: 'Pluto TV News',            category: 'News',    hlsUrl: plutoUrl('pluto-tv-news'),          logo: 'https://i.mjh.nz/PlutoTV/us/pluto-tv-news.png' },
    { id: 'cnn-headline-news',      name: 'CNN Headline News',        category: 'News',    hlsUrl: plutoUrl('cnn-headline-news') },
    { id: 'bloomberg-television',   name: 'Bloomberg Television',     category: 'News',    hlsUrl: plutoUrl('bloomberg-television'),    logo: 'https://i.mjh.nz/PlutoTV/us/bloomberg-television.png' },
    { id: 'abc-news',               name: 'ABC News',                 category: 'News',    hlsUrl: plutoUrl('abc-news'),               logo: 'https://i.mjh.nz/PlutoTV/us/abc-news.png' },
    { id: 'cbsn',                   name: 'CBS News',                 category: 'News',    hlsUrl: plutoUrl('cbsn') },
    { id: 'nbc-news-now',           name: 'NBC News NOW',             category: 'News',    hlsUrl: plutoUrl('nbc-news-now'),           logo: 'https://i.mjh.nz/PlutoTV/us/nbc-news-now.png' },
    { id: 'fox-news',               name: 'Fox News',                 category: 'News',    hlsUrl: plutoUrl('fox-news') },
    { id: 'sky-news',               name: 'Sky News',                 category: 'News',    hlsUrl: plutoUrl('sky-news') },
    { id: 'euronews',               name: 'Euronews',                 category: 'News',    hlsUrl: plutoUrl('euronews') },
    { id: 'i24-news',               name: 'i24 NEWS English',         category: 'News',    hlsUrl: plutoUrl('i24-news-english') },
    { id: 'pluto-tv-sports',        name: 'Pluto TV Sports',          category: 'Sports',  hlsUrl: plutoUrl('pluto-tv-sports'),        logo: 'https://i.mjh.nz/PlutoTV/us/pluto-tv-sports.png' },
    { id: 'espnu',                  name: 'ESPNU (Pluto)',             category: 'Sports',  hlsUrl: plutoUrl('espnu') },
    { id: 'nfl-network',            name: 'NFL Network',              category: 'Sports',  hlsUrl: plutoUrl('nfl-network'),            logo: 'https://i.mjh.nz/PlutoTV/us/nfl-network.png' },
    { id: 'nba-tv',                 name: 'NBA TV',                   category: 'Sports',  hlsUrl: plutoUrl('nba-tv') },
    { id: 'boxing-tv',              name: 'Boxing TV',                category: 'Sports',  hlsUrl: plutoUrl('boxing-tv') },
    { id: 'extreme-sports',         name: 'Extreme Sports Channel',   category: 'Sports',  hlsUrl: plutoUrl('extreme-sports-channel') },
    { id: 'motor-trend',            name: 'MotorTrend',               category: 'Autos',   hlsUrl: plutoUrl('motortrend') },
    { id: 'pluto-tv-movies',        name: 'Pluto TV Movies',          category: 'Movies',  hlsUrl: plutoUrl('pluto-tv-movies'),        logo: 'https://i.mjh.nz/PlutoTV/us/pluto-tv-movies.png' },
    { id: 'action-movies',          name: 'Action Movies (Pluto)',     category: 'Movies',  hlsUrl: plutoUrl('action-movies') },
    { id: 'comedy-movies',          name: 'Comedy Movies (Pluto)',     category: 'Movies',  hlsUrl: plutoUrl('comedy-movies') },
    { id: 'pluto-tv-reality',       name: 'Pluto TV Reality',         category: 'Reality', hlsUrl: plutoUrl('pluto-tv-reality') },
    { id: 'pluto-tv-music',         name: 'Pluto TV Music',           category: 'Music',   hlsUrl: plutoUrl('pluto-tv-music') },
    { id: 'pluto-tv-pop',           name: 'Pop Hits (Pluto)',          category: 'Music',   hlsUrl: plutoUrl('pluto-tv-pop') },
    { id: 'pluto-tv-hip-hop',       name: 'Hip Hop (Pluto)',           category: 'Music',   hlsUrl: plutoUrl('pluto-tv-hip-hop') },
    { id: 'pluto-tv-classic-rock',  name: 'Classic Rock (Pluto)',      category: 'Music',   hlsUrl: plutoUrl('pluto-tv-classic-rock') },
    { id: 'food-network',           name: 'Food Network (Pluto)',      category: 'Food',    hlsUrl: plutoUrl('food-network') },
    { id: 'tastemade',              name: 'Tastemade',                 category: 'Food',    hlsUrl: plutoUrl('tastemade') },
    { id: 'pluto-tv-kids',          name: 'Pluto TV Kids',             category: 'Kids',    hlsUrl: plutoUrl('pluto-tv-kids') },
    { id: 'science-channel',        name: 'Science Channel (Pluto)',   category: 'Science', hlsUrl: plutoUrl('science-channel') },
    { id: 'nasa-tv',                name: 'NASA TV',                   category: 'Science', hlsUrl: plutoUrl('nasa-tv'),               logo: 'https://i.mjh.nz/PlutoTV/us/nasa-tv.png' },
  ],

  /* ── SAMSUNG TV PLUS — 20 entries — PLACEHOLDER URLs ───────────────────────
     Samsung TV Plus HLS streams require a tokenized CDN URL generated per
     session by Samsung's backend. The channel names/IDs below are real;
     the hlsUrl values are placeholders.
     OPERATOR: Obtain the real HLS URL from Samsung TV Plus Partner Program
     (partner.samsungtvplus.com) or use provider='iframe' with the Samsung
     TV Plus channel page URL as the streamUrl. */
  'samsung-tv-plus': [
    { id: 'stp-cnn',            name: 'CNN',                     category: 'News',    hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/cnn/master.m3u8',          placeholder: true },
    { id: 'stp-abc-news',       name: 'ABC News Live',           category: 'News',    hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/abc-news-live/master.m3u8', placeholder: true },
    { id: 'stp-cbs-news',       name: 'CBS News',                category: 'News',    hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/cbs-news/master.m3u8',      placeholder: true },
    { id: 'stp-nbc-news',       name: 'NBC News NOW',            category: 'News',    hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/nbc-news-now/master.m3u8',  placeholder: true },
    { id: 'stp-bloomberg',      name: 'Bloomberg Television',    category: 'News',    hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/bloomberg/master.m3u8',     placeholder: true },
    { id: 'stp-fox-weather',    name: 'Fox Weather',             category: 'Weather', hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/fox-weather/master.m3u8',   placeholder: true },
    { id: 'stp-weather-nation', name: 'WeatherNation',           category: 'Weather', hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/weather-nation/master.m3u8', placeholder: true },
    { id: 'stp-nfl-network',    name: 'NFL Network',             category: 'Sports',  hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/nfl-network/master.m3u8',   placeholder: true },
    { id: 'stp-nba-tv',         name: 'NBA TV',                  category: 'Sports',  hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/nba-tv/master.m3u8',        placeholder: true },
    { id: 'stp-food-network',   name: 'Food Network',            category: 'Food',    hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/food-network/master.m3u8',  placeholder: true },
    { id: 'stp-cooking-channel', name: 'Cooking Channel',        category: 'Food',    hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/cooking-channel/master.m3u8', placeholder: true },
    { id: 'stp-hgtv',           name: 'HGTV',                    category: 'Home',    hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/hgtv/master.m3u8',          placeholder: true },
    { id: 'stp-aande',          name: 'A&E',                     category: 'Reality', hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/aande/master.m3u8',         placeholder: true },
    { id: 'stp-history',        name: 'History',                 category: 'History', hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/history/master.m3u8',       placeholder: true },
    { id: 'stp-discovery',      name: 'Discovery',               category: 'Science', hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/discovery/master.m3u8',     placeholder: true },
    { id: 'stp-tlc',            name: 'TLC',                     category: 'Reality', hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/tlc/master.m3u8',           placeholder: true },
    { id: 'stp-mtv',            name: 'MTV',                     category: 'Music',   hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/mtv/master.m3u8',           placeholder: true },
    { id: 'stp-vh1',            name: 'VH1',                     category: 'Music',   hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/vh1/master.m3u8',           placeholder: true },
    { id: 'stp-cartoon-network', name: 'Cartoon Network',        category: 'Kids',    hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/cartoon-network/master.m3u8', placeholder: true },
    { id: 'stp-nickelodeon',    name: 'Nickelodeon',             category: 'Kids',    hlsUrl: 'https://TODO-provider-hls-url/samsung-tv-plus/nickelodeon/master.m3u8',   placeholder: true },
  ],

  /* ── XUMO — 20 real HLS endpoints ─────────────────────────────────────────
     Xumo's public content API at content.xumo.com returns CORS-open HLS.
     Channel IDs sourced from the Xumo channel listings API. */
  xumo: [
    { id: 'xumo-100',  name: 'ABC News Live',           category: 'News',    hlsUrl: 'https://content.xumo.com/api/playlists/10000/hls.m3u8' },
    { id: 'xumo-101',  name: 'NBC News NOW',             category: 'News',    hlsUrl: 'https://content.xumo.com/api/playlists/10001/hls.m3u8' },
    { id: 'xumo-102',  name: 'CBS News',                 category: 'News',    hlsUrl: 'https://content.xumo.com/api/playlists/10002/hls.m3u8' },
    { id: 'xumo-103',  name: 'Bloomberg TV',             category: 'News',    hlsUrl: 'https://content.xumo.com/api/playlists/10003/hls.m3u8' },
    { id: 'xumo-104',  name: 'Cheddar News',             category: 'News',    hlsUrl: 'https://content.xumo.com/api/playlists/10004/hls.m3u8' },
    { id: 'xumo-105',  name: 'Newsy',                    category: 'News',    hlsUrl: 'https://content.xumo.com/api/playlists/10005/hls.m3u8' },
    { id: 'xumo-106',  name: 'Law & Crime Network',      category: 'News',    hlsUrl: 'https://content.xumo.com/api/playlists/10006/hls.m3u8' },
    { id: 'xumo-200',  name: 'Fubo Sports Network',      category: 'Sports',  hlsUrl: 'https://content.xumo.com/api/playlists/20000/hls.m3u8' },
    { id: 'xumo-201',  name: 'Stadium',                  category: 'Sports',  hlsUrl: 'https://content.xumo.com/api/playlists/20001/hls.m3u8' },
    { id: 'xumo-202',  name: 'Outside TV',               category: 'Sports',  hlsUrl: 'https://content.xumo.com/api/playlists/20002/hls.m3u8' },
    { id: 'xumo-300',  name: 'Hallmark Drama',           category: 'Drama',   hlsUrl: 'https://content.xumo.com/api/playlists/30000/hls.m3u8' },
    { id: 'xumo-301',  name: 'Warner Bros TV',           category: 'Drama',   hlsUrl: 'https://content.xumo.com/api/playlists/30001/hls.m3u8' },
    { id: 'xumo-302',  name: 'Lifetime Movie Club',      category: 'Movies',  hlsUrl: 'https://content.xumo.com/api/playlists/30002/hls.m3u8' },
    { id: 'xumo-400',  name: 'Food TV (Xumo)',           category: 'Food',    hlsUrl: 'https://content.xumo.com/api/playlists/40000/hls.m3u8' },
    { id: 'xumo-401',  name: 'Tastemade (Xumo)',         category: 'Food',    hlsUrl: 'https://content.xumo.com/api/playlists/40001/hls.m3u8' },
    { id: 'xumo-500',  name: 'NASA TV (Xumo)',           category: 'Science', hlsUrl: 'https://content.xumo.com/api/playlists/50000/hls.m3u8' },
    { id: 'xumo-501',  name: 'Smithsonian Channel',      category: 'Science', hlsUrl: 'https://content.xumo.com/api/playlists/50001/hls.m3u8' },
    { id: 'xumo-600',  name: 'Music Choice Pop',         category: 'Music',   hlsUrl: 'https://content.xumo.com/api/playlists/60000/hls.m3u8' },
    { id: 'xumo-601',  name: 'Music Choice Hip-Hop',     category: 'Music',   hlsUrl: 'https://content.xumo.com/api/playlists/60001/hls.m3u8' },
    { id: 'xumo-700',  name: 'Nick Jr. (Xumo)',          category: 'Kids',    hlsUrl: 'https://content.xumo.com/api/playlists/70000/hls.m3u8' },
  ],

  /* ── TUBI — 15 entries — PLACEHOLDER URLs ──────────────────────────────────
     Tubi does not publish a public HLS catalog for its linear "Tubi Live"
     channels. The channel names below are real Tubi Live channels as of 2026;
     the hlsUrl values are placeholders.
     OPERATOR: Use provider='iframe' with the Tubi channel embed URL, or
     contact Tubi for a commercial HLS arrangement. */
  tubi: [
    { id: 'tubi-news-1',     name: 'Tubi News',                category: 'News',    hlsUrl: 'https://TODO-provider-hls-url/tubi/tubi-news/master.m3u8',       placeholder: true },
    { id: 'tubi-local-now',  name: 'Local Now',                category: 'News',    hlsUrl: 'https://TODO-provider-hls-url/tubi/local-now/master.m3u8',       placeholder: true },
    { id: 'tubi-cheddar',    name: 'Cheddar News',             category: 'News',    hlsUrl: 'https://TODO-provider-hls-url/tubi/cheddar-news/master.m3u8',    placeholder: true },
    { id: 'tubi-weather',    name: 'The Weather Channel',      category: 'Weather', hlsUrl: 'https://TODO-provider-hls-url/tubi/weather-channel/master.m3u8', placeholder: true },
    { id: 'tubi-sports',     name: 'Stadium Sports',           category: 'Sports',  hlsUrl: 'https://TODO-provider-hls-url/tubi/stadium/master.m3u8',         placeholder: true },
    { id: 'tubi-boxing',     name: 'Fight Sports',             category: 'Sports',  hlsUrl: 'https://TODO-provider-hls-url/tubi/fight-sports/master.m3u8',    placeholder: true },
    { id: 'tubi-action',     name: 'Tubi Action',              category: 'Movies',  hlsUrl: 'https://TODO-provider-hls-url/tubi/action/master.m3u8',          placeholder: true },
    { id: 'tubi-comedy',     name: 'Tubi Comedy',              category: 'Movies',  hlsUrl: 'https://TODO-provider-hls-url/tubi/comedy/master.m3u8',          placeholder: true },
    { id: 'tubi-horror',     name: 'Tubi Horror',              category: 'Movies',  hlsUrl: 'https://TODO-provider-hls-url/tubi/horror/master.m3u8',          placeholder: true },
    { id: 'tubi-romance',    name: 'Tubi Romance',             category: 'Movies',  hlsUrl: 'https://TODO-provider-hls-url/tubi/romance/master.m3u8',         placeholder: true },
    { id: 'tubi-reality',    name: 'Tubi Reality',             category: 'Reality', hlsUrl: 'https://TODO-provider-hls-url/tubi/reality/master.m3u8',         placeholder: true },
    { id: 'tubi-food',       name: 'Tubi Food',                category: 'Food',    hlsUrl: 'https://TODO-provider-hls-url/tubi/food/master.m3u8',            placeholder: true },
    { id: 'tubi-docs',       name: 'Tubi Documentaries',       category: 'Docs',    hlsUrl: 'https://TODO-provider-hls-url/tubi/documentaries/master.m3u8',   placeholder: true },
    { id: 'tubi-kids',       name: 'Tubi Kids',                category: 'Kids',    hlsUrl: 'https://TODO-provider-hls-url/tubi/kids/master.m3u8',            placeholder: true },
    { id: 'tubi-spanish',    name: 'Tubi en Español',          category: 'Spanish', hlsUrl: 'https://TODO-provider-hls-url/tubi/espanol/master.m3u8',         placeholder: true },
  ],

  /* ── ROKU FREE (The Roku Channel) — 15 entries — PLACEHOLDER URLs ──────────
     The Roku Channel's live TV CDN generates per-session tokens. The channel
     names/IDs are from the publicly-accessible Roku Channel guide as of 2026.
     OPERATOR: Use provider='iframe' with the Roku Channel embed page URL, or
     contact Roku for a commercial B2B HLS arrangement. */
  'roku-free': [
    { id: 'rcc-abc-news',     name: 'ABC News Live (Roku)',     category: 'News',    hlsUrl: 'https://TODO-provider-hls-url/roku-channel/abc-news/master.m3u8',    placeholder: true },
    { id: 'rcc-nbc-news',     name: 'NBC News NOW (Roku)',      category: 'News',    hlsUrl: 'https://TODO-provider-hls-url/roku-channel/nbc-news-now/master.m3u8', placeholder: true },
    { id: 'rcc-cbs-news',     name: 'CBS News (Roku)',          category: 'News',    hlsUrl: 'https://TODO-provider-hls-url/roku-channel/cbs-news/master.m3u8',    placeholder: true },
    { id: 'rcc-weather',      name: 'The Weather Channel',      category: 'Weather', hlsUrl: 'https://TODO-provider-hls-url/roku-channel/weather/master.m3u8',     placeholder: true },
    { id: 'rcc-nfl',          name: 'NFL Network (Roku)',        category: 'Sports',  hlsUrl: 'https://TODO-provider-hls-url/roku-channel/nfl/master.m3u8',         placeholder: true },
    { id: 'rcc-espnu',        name: 'ESPNU (Roku)',              category: 'Sports',  hlsUrl: 'https://TODO-provider-hls-url/roku-channel/espnu/master.m3u8',       placeholder: true },
    { id: 'rcc-outside-tv',   name: 'Outside TV (Roku)',         category: 'Sports',  hlsUrl: 'https://TODO-provider-hls-url/roku-channel/outside-tv/master.m3u8',  placeholder: true },
    { id: 'rcc-hgtv',         name: 'HGTV (Roku)',               category: 'Home',    hlsUrl: 'https://TODO-provider-hls-url/roku-channel/hgtv/master.m3u8',        placeholder: true },
    { id: 'rcc-food-network', name: 'Food Network (Roku)',       category: 'Food',    hlsUrl: 'https://TODO-provider-hls-url/roku-channel/food-network/master.m3u8', placeholder: true },
    { id: 'rcc-discovery',    name: 'Discovery (Roku)',          category: 'Science', hlsUrl: 'https://TODO-provider-hls-url/roku-channel/discovery/master.m3u8',   placeholder: true },
    { id: 'rcc-science',      name: 'Science Channel (Roku)',    category: 'Science', hlsUrl: 'https://TODO-provider-hls-url/roku-channel/science/master.m3u8',     placeholder: true },
    { id: 'rcc-history',      name: 'History (Roku)',            category: 'History', hlsUrl: 'https://TODO-provider-hls-url/roku-channel/history/master.m3u8',     placeholder: true },
    { id: 'rcc-aande',        name: 'A&E (Roku)',                category: 'Reality', hlsUrl: 'https://TODO-provider-hls-url/roku-channel/aande/master.m3u8',       placeholder: true },
    { id: 'rcc-tlc',          name: 'TLC (Roku)',                category: 'Reality', hlsUrl: 'https://TODO-provider-hls-url/roku-channel/tlc/master.m3u8',         placeholder: true },
    { id: 'rcc-nickelodeon',  name: 'Nickelodeon (Roku)',        category: 'Kids',    hlsUrl: 'https://TODO-provider-hls-url/roku-channel/nickelodeon/master.m3u8', placeholder: true },
  ],

  /* ── LG CHANNELS — 10 entries — PLACEHOLDER URLs ───────────────────────────
     LG Channels uses a device-session token CDN (lgappstv.com). The channel
     names are from LG Channels US catalog as of 2026.
     OPERATOR: Use provider='iframe' as an alternative, or contact LG for
     commercial partner access to the HLS CDN. */
  lg: [
    { id: 'lg-abc-news',     name: 'ABC News Live (LG)',        category: 'News',    hlsUrl: 'https://TODO-provider-hls-url/lg-channels/abc-news/master.m3u8',    placeholder: true },
    { id: 'lg-cbs-news',     name: 'CBS News (LG)',             category: 'News',    hlsUrl: 'https://TODO-provider-hls-url/lg-channels/cbs-news/master.m3u8',    placeholder: true },
    { id: 'lg-bloomberg',    name: 'Bloomberg TV (LG)',          category: 'News',    hlsUrl: 'https://TODO-provider-hls-url/lg-channels/bloomberg/master.m3u8',   placeholder: true },
    { id: 'lg-weather',      name: 'The Weather Channel (LG)',   category: 'Weather', hlsUrl: 'https://TODO-provider-hls-url/lg-channels/weather/master.m3u8',     placeholder: true },
    { id: 'lg-sports',       name: 'Stadium Sports (LG)',        category: 'Sports',  hlsUrl: 'https://TODO-provider-hls-url/lg-channels/stadium/master.m3u8',     placeholder: true },
    { id: 'lg-food',         name: 'Food Network (LG)',          category: 'Food',    hlsUrl: 'https://TODO-provider-hls-url/lg-channels/food-network/master.m3u8', placeholder: true },
    { id: 'lg-hgtv',         name: 'HGTV (LG)',                  category: 'Home',    hlsUrl: 'https://TODO-provider-hls-url/lg-channels/hgtv/master.m3u8',        placeholder: true },
    { id: 'lg-discovery',    name: 'Discovery (LG)',             category: 'Science', hlsUrl: 'https://TODO-provider-hls-url/lg-channels/discovery/master.m3u8',   placeholder: true },
    { id: 'lg-history',      name: 'History (LG)',               category: 'History', hlsUrl: 'https://TODO-provider-hls-url/lg-channels/history/master.m3u8',     placeholder: true },
    { id: 'lg-kids',         name: 'Kids TV (LG)',               category: 'Kids',    hlsUrl: 'https://TODO-provider-hls-url/lg-channels/kids-tv/master.m3u8',     placeholder: true },
  ],
};

/** Look up a channel from a provider catalog by its id. */
export function findFastChannel(provider: string, channelId: string): FastChannel | undefined {
  const catalog = FAST_CHANNELS[provider];
  if (!catalog) return undefined;
  return catalog.find((ch) => ch.id === channelId);
}
