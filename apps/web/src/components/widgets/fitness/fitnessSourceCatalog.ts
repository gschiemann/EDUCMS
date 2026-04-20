/**
 * Fitness source catalog — the canonical list of every content
 * source a gym operator can wire into their signage. This is the
 * single source of truth the App Library UI, provider-aware live-TV
 * widget, and backend stick controllers all key off.
 *
 * Honesty policy (important — users see the `status` field in UI):
 *
 *   • `READY`   — we fully support this today. Admin picks it,
 *                 pastes a URL / picks a channel, done.
 *   • `STICK`   — runs on a physical streaming stick plugged into
 *                 the TV (Roku / Fire TV / Apple TV / Chromecast).
 *                 We can launch the app + control playback via
 *                 remote-control APIs, but playback happens on the
 *                 stick, not inside our WebView. Netflix + Disney+
 *                 + HBO Max + Peacock etc. fall here because their
 *                 apps only run on licensed hardware with DRM.
 *   • `PARTNER` — B2B integration requiring a signed commercial
 *                 contract with the provider (Spotify's Soundtrack
 *                 Your Brand, Les Mills On Demand Business,
 *                 Peloton Commercial, etc.). Listed so operators
 *                 can request them; config is inert until the
 *                 contract lands.
 *   • `COMING`  — on our roadmap, surface in the picker as
 *                 "coming soon" so gyms can vote with their clicks.
 *
 * Every source declares the config fields it needs so the App
 * Library form can render the right input controls without per-
 * source UI code.
 */

export type SourceCategory = 'live-tv' | 'streaming-apps' | 'free-fast' | 'music' | 'fitness-content' | 'news-sports' | 'social';

export type SourceStatus = 'READY' | 'STICK' | 'PARTNER' | 'COMING';

export interface SourceConfigField {
  /** Field key in the `config` object the widget receives. */
  key: string;
  /** Human label shown above the input. */
  label: string;
  /** Field type — affects the form control rendered. */
  type: 'text' | 'url' | 'password' | 'select' | 'channel-picker' | 'info';
  placeholder?: string;
  helperText?: string;
  /** For `select`: the dropdown options. */
  options?: Array<{ value: string; label: string }>;
  /** For `channel-picker`: which catalog to pull from. */
  channelCatalogKey?: string;
  required?: boolean;
  /** `info` type renders as a readonly callout — used for PARTNER
   *  sources to explain the contract step. */
  infoBody?: string;
}

export interface FitnessSource {
  /** Stable string id used in Playlist configs and /api surfaces. */
  id: string;
  /** Display name (brand-correct, e.g. "Disney+" not "Disney plus"). */
  name: string;
  /** Short tagline under the tile. */
  tagline: string;
  category: SourceCategory;
  status: SourceStatus;
  /** Emoji or brand mark fallback shown when we don't have a real logo. */
  icon: string;
  /** Which widget type should render this source at runtime.
   *  A `STICK`-status source resolves to the remote-controller widget
   *  that LAUNCHES the app on the connected stick; it doesn't stream
   *  through the WebView. */
  widgetType:
    | 'FITNESS_LIVE_TV'
    | 'FITNESS_STICK_LAUNCHER'
    | 'FITNESS_MUSIC_PLAYER'
    | 'FITNESS_VIDEO_LOOP';
  /** Accent color thread — picks the neon accent the widget uses. */
  accentColor: string;
  /** Config fields the picker form renders. */
  configFields?: SourceConfigField[];
  /** Free-text notes shown in a small callout at the bottom of the
   *  configuration form. Commercial license reminders, ToS callouts,
   *  etc. */
  notes?: string;
}

/* ────────────────────────────────────────────────────────────────
 * 1. PREMIUM STREAMING APPS — stick-launch only
 *    None of these permit third-party embed/auth. We surface them as
 *    "point your stick at this app" launchers via Roku ECP / Fire TV
 *    ADB / Apple TV IP remote. Gym signs in on the stick itself.
 * ──────────────────────────────────────────────────────────────── */
const STICK_APPS: FitnessSource[] = [
  { id: 'netflix',      name: 'Netflix',      tagline: 'Launch on your streaming stick',           category: 'streaming-apps', status: 'STICK', icon: 'N', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#e50914', notes: 'Netflix forbids embedded third-party streaming. We launch Netflix on the connected Roku / Fire TV / Apple TV and schedule when it\'s on — your gym member signs in directly on the stick. Consumer Netflix subscriptions are for personal use; commercial venues should use a licensed display service.' },
  { id: 'disney-plus',  name: 'Disney+',      tagline: 'Stick-launch + scheduling',                 category: 'streaming-apps', status: 'STICK', icon: 'D+', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#0c1f72', notes: 'Disney+ has no commercial embed API. Runs on the stick; we control launch + schedule only.' },
  { id: 'hulu',         name: 'Hulu',         tagline: 'Stick-launch + scheduling',                 category: 'streaming-apps', status: 'STICK', icon: 'H', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#1ce783' },
  { id: 'max',          name: 'Max (HBO)',    tagline: 'Stick-launch + scheduling',                 category: 'streaming-apps', status: 'STICK', icon: 'M', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#002be7' },
  { id: 'peacock',      name: 'Peacock',      tagline: 'Stick-launch + scheduling',                 category: 'streaming-apps', status: 'STICK', icon: 'P', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#000000' },
  { id: 'paramount-plus', name: 'Paramount+', tagline: 'Stick-launch + scheduling',                 category: 'streaming-apps', status: 'STICK', icon: 'P+', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#0064ff' },
  { id: 'prime-video',  name: 'Prime Video',  tagline: 'Stick-launch + scheduling',                 category: 'streaming-apps', status: 'STICK', icon: 'AV', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#00a8e1' },
  { id: 'apple-tv-plus', name: 'Apple TV+',   tagline: 'Stick-launch + scheduling',                 category: 'streaming-apps', status: 'STICK', icon: 'tv', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#000000' },
  { id: 'sling',        name: 'Sling TV',     tagline: 'Stick-launch + scheduling',                 category: 'live-tv',        status: 'STICK', icon: 'S', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#ffb800' },
  { id: 'youtube-tv',   name: 'YouTube TV',   tagline: 'Stick-launch + scheduling',                 category: 'live-tv',        status: 'STICK', icon: 'YT', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#ff0000', notes: 'Consumer YouTube TV forbids commercial use. Youtube TV for Business is a separate contract; even it has no embed API. Stick-launch is the only path.' },
  { id: 'directv-stream', name: 'DirecTV Stream', tagline: 'Stick-launch + scheduling',             category: 'live-tv',        status: 'STICK', icon: 'D', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#00447c' },
  { id: 'fubo',         name: 'fuboTV',       tagline: 'Stick-launch + scheduling',                 category: 'live-tv',        status: 'STICK', icon: 'F', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#f64006' },
  { id: 'espn-plus',    name: 'ESPN+',        tagline: 'Stick-launch + scheduling',                 category: 'news-sports',    status: 'STICK', icon: 'E+', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#fb0c00' },
  { id: 'discovery-plus', name: 'discovery+', tagline: 'Stick-launch + scheduling',                 category: 'streaming-apps', status: 'STICK', icon: 'd+', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#0057ff' },
  { id: 'nfl-sunday-ticket', name: 'NFL Sunday Ticket', tagline: 'Stick-launch + scheduling',       category: 'news-sports',    status: 'STICK', icon: 'NFL', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#013369' },
  { id: 'nba-league-pass', name: 'NBA League Pass', tagline: 'Stick-launch + scheduling',           category: 'news-sports',    status: 'STICK', icon: 'NBA', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#c9082a' },
  { id: 'mlb-tv',       name: 'MLB.TV',       tagline: 'Stick-launch + scheduling',                 category: 'news-sports',    status: 'STICK', icon: 'MLB', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#041e42' },
];

/* ────────────────────────────────────────────────────────────────
 * 2. FREE AD-SUPPORTED STREAMING TV (FAST) — fully READY
 *    These services publish public HLS streams with no auth. Legal
 *    for commercial display. Just pick a channel from our curated
 *    catalog and it plays inside the WebView.
 * ──────────────────────────────────────────────────────────────── */
const FAST_APPS: FitnessSource[] = [
  {
    id: 'pluto-tv', name: 'Pluto TV', tagline: '300+ free live channels', category: 'free-fast', status: 'READY',
    icon: 'Pi', widgetType: 'FITNESS_LIVE_TV', accentColor: '#ffd000',
    configFields: [
      { key: 'channelId', label: 'Channel', type: 'channel-picker', channelCatalogKey: 'pluto', required: true },
    ],
    notes: 'Pluto TV streams are free and permitted for commercial display. 300+ channels covering news, sports, movies, reality, and music.',
  },
  {
    id: 'samsung-tv-plus', name: 'Samsung TV Plus', tagline: '200+ free channels', category: 'free-fast', status: 'READY',
    icon: 'S', widgetType: 'FITNESS_LIVE_TV', accentColor: '#1428a0',
    configFields: [
      { key: 'channelId', label: 'Channel', type: 'channel-picker', channelCatalogKey: 'samsung', required: true },
    ],
  },
  {
    id: 'xumo', name: 'Xumo Play', tagline: '160+ free channels', category: 'free-fast', status: 'READY',
    icon: 'X', widgetType: 'FITNESS_LIVE_TV', accentColor: '#3cc8c8',
    configFields: [
      { key: 'channelId', label: 'Channel', type: 'channel-picker', channelCatalogKey: 'xumo', required: true },
    ],
  },
  {
    id: 'tubi', name: 'Tubi', tagline: 'Free movies + TV', category: 'free-fast', status: 'READY',
    icon: 'T', widgetType: 'FITNESS_LIVE_TV', accentColor: '#fa382f',
    configFields: [
      { key: 'channelId', label: 'Channel', type: 'channel-picker', channelCatalogKey: 'tubi', required: true },
    ],
  },
  {
    id: 'roku-channel', name: 'The Roku Channel', tagline: 'Free live + on-demand', category: 'free-fast', status: 'READY',
    icon: 'Rc', widgetType: 'FITNESS_LIVE_TV', accentColor: '#662d91',
    configFields: [
      { key: 'channelId', label: 'Channel', type: 'channel-picker', channelCatalogKey: 'roku-free', required: true },
    ],
  },
  {
    id: 'lg-channels', name: 'LG Channels', tagline: 'Free ad-supported channels', category: 'free-fast', status: 'READY',
    icon: 'LG', widgetType: 'FITNESS_LIVE_TV', accentColor: '#a50034',
    configFields: [
      { key: 'channelId', label: 'Channel', type: 'channel-picker', channelCatalogKey: 'lg', required: true },
    ],
  },
  {
    id: 'freevee', name: 'Amazon Freevee', tagline: 'Free Amazon Freevee channels', category: 'free-fast', status: 'STICK',
    icon: 'Fv', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#00a8e1',
  },
];

/* ────────────────────────────────────────────────────────────────
 * 3. LIVE NEWS / SPORTS — direct URL (operator provides)
 * ──────────────────────────────────────────────────────────────── */
const NEWS_SPORTS: FitnessSource[] = [
  {
    id: 'youtube-live', name: 'YouTube Live', tagline: 'Paste a channel URL, we find the live stream', category: 'news-sports', status: 'READY',
    icon: 'YT', widgetType: 'FITNESS_LIVE_TV', accentColor: '#ff0000',
    configFields: [
      { key: 'youtubeChannelUrl', label: 'YouTube channel or video URL', type: 'url', required: true, placeholder: 'https://www.youtube.com/@CNN' },
    ],
    notes: 'Works with public YouTube Live streams. We resolve the currently-live video from the channel URL automatically. Does NOT work with YouTube TV (that\'s a separate service).',
  },
  {
    id: 'cnn-live',    name: 'CNN Live',      tagline: 'CNN Pressroom feed',                category: 'news-sports', status: 'READY', icon: 'CNN', widgetType: 'FITNESS_LIVE_TV', accentColor: '#cc0000',  configFields: [{ key: 'hlsUrl', label: 'Your CNN Pressroom HLS URL', type: 'url', required: true, placeholder: 'https://cnn-cnninternational.../playlist.m3u8' }], notes: 'CNN Pressroom Live is a free commercial live-TV feed available to venues who register at cnnpressroom.com. Paste the HLS URL they provide after registration.' },
  {
    id: 'espn-commercial', name: 'ESPN Commercial', tagline: 'Commercial ESPN feed (contract required)', category: 'news-sports', status: 'READY',
    icon: 'E', widgetType: 'FITNESS_LIVE_TV', accentColor: '#fb0c00',
    configFields: [
      { key: 'hlsUrl', label: 'ESPN-provided HLS URL', type: 'url', required: true },
    ],
    notes: 'Requires a ESPN Commercial or DIRECTV for Business contract that gives you an authorized HLS stream. Contact: espncommercial.com',
  },
  {
    id: 'directv-business', name: 'DIRECTV for Business', tagline: 'Commercial DIRECTV stream',  category: 'live-tv',     status: 'READY', icon: 'DB', widgetType: 'FITNESS_LIVE_TV', accentColor: '#00447c', configFields: [{ key: 'hlsUrl', label: 'DIRECTV-provided HLS URL', type: 'url', required: true }], notes: 'Requires active DIRECTV for Business contract.' },
  {
    id: 'local-news',  name: 'Local News HLS',tagline: 'Paste your local affiliate\'s live URL', category: 'news-sports', status: 'READY',
    icon: '📺', widgetType: 'FITNESS_LIVE_TV', accentColor: '#3b82f6',
    configFields: [
      { key: 'hlsUrl', label: 'Live HLS URL', type: 'url', required: true, placeholder: 'https://...playlist.m3u8' },
      { key: 'channelName', label: 'Display name', type: 'text', placeholder: 'KTLA 5 News', required: false },
    ],
    notes: 'Many local TV affiliates publish public HLS streams. Check your station\'s website or use Samsung TV Plus / Pluto TV which aggregate many.',
  },
];

/* ────────────────────────────────────────────────────────────────
 * 4. MUSIC PROVIDERS
 * ──────────────────────────────────────────────────────────────── */
const MUSIC_APPS: FitnessSource[] = [
  {
    id: 'custom-now-playing', name: 'Custom Now-Playing URL', tagline: 'Poll your own music system', category: 'music', status: 'READY',
    icon: '🎵', widgetType: 'FITNESS_MUSIC_PLAYER', accentColor: '#39ff14',
    configFields: [
      { key: 'nowPlayingEndpoint', label: 'Now-playing JSON endpoint', type: 'url', required: true, placeholder: 'https://your-gym.com/now-playing' },
      { key: 'zoneLabel', label: 'Zone label', type: 'text', placeholder: 'CARDIO FLOOR' },
    ],
    notes: 'Endpoint must return JSON like { "title": "...", "artist": "...", "albumArtUrl": "..." }. Polled every 10 seconds. Works with any music system that exposes an HTTP now-playing API (SoundMachine, custom LAN scripts, Mixcloud Pro).',
  },
  {
    id: 'soundmachine', name: 'SoundMachine', tagline: 'Commercial streaming licensed for gyms', category: 'music', status: 'READY',
    icon: 'SM', widgetType: 'FITNESS_MUSIC_PLAYER', accentColor: '#39ff14',
    configFields: [
      { key: 'nowPlayingEndpoint', label: 'SoundMachine box API URL', type: 'url', required: true, placeholder: 'http://soundmachine-box.local/nowplaying' },
      { key: 'zoneLabel', label: 'Zone label', type: 'text' },
    ],
    notes: 'SoundMachine is licensed commercial background music. If your SoundMachine box exposes a now-playing endpoint on your LAN, paste the URL here.',
  },
  {
    id: 'soundtrack-your-brand', name: 'Soundtrack Your Brand', tagline: 'Spotify\'s commercial tier', category: 'music', status: 'PARTNER',
    icon: 'SYB', widgetType: 'FITNESS_MUSIC_PLAYER', accentColor: '#1db954',
    configFields: [
      { key: 'sybInfo', label: 'Partnership required', type: 'info',
        infoBody: 'Soundtrack Your Brand (the legal commercial Spotify) requires a direct partner integration we haven\'t shipped yet. Click "Request Integration" to queue it — we\'ll email when it\'s live.' },
    ],
  },
  {
    id: 'cloud-cover-music', name: 'Cloud Cover Music', tagline: 'Licensed gym music',         category: 'music', status: 'PARTNER',
    icon: 'CC', widgetType: 'FITNESS_MUSIC_PLAYER', accentColor: '#00d4ff',
    configFields: [{ key: 'cloudcoverInfo', label: 'Partnership required', type: 'info', infoBody: 'Cloud Cover Music commercial integration is a roadmap item.' }],
  },
  {
    id: 'pandora-business', name: 'Pandora for Business',  tagline: 'B2B Pandora',                 category: 'music', status: 'PARTNER',
    icon: 'Pa', widgetType: 'FITNESS_MUSIC_PLAYER', accentColor: '#3668ff',
    configFields: [{ key: 'pandoraInfo', label: 'Partnership required', type: 'info', infoBody: 'Pandora for Business integration is a roadmap item. Consumer Pandora does not allow commercial use.' }],
  },
  {
    id: 'mood-media',    name: 'Mood Media',          tagline: 'Hospitality-grade music',      category: 'music', status: 'PARTNER',
    icon: 'MM', widgetType: 'FITNESS_MUSIC_PLAYER', accentColor: '#e81e61',
    configFields: [{ key: 'moodInfo', label: 'Partnership required', type: 'info', infoBody: 'Mood Media partner integration is a roadmap item.' }],
  },
  {
    id: 'apple-music',   name: 'Apple Music',          tagline: 'Not available commercially',  category: 'music', status: 'STICK',
    icon: 'Am', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#fa233b', notes: 'Apple Music does not offer a commercial API. Stick-launch only.',
  },
  {
    id: 'spotify-consumer', name: 'Spotify (consumer)', tagline: 'Stick-launch — not legal for commercial use on its own', category: 'music', status: 'STICK',
    icon: 'Sp', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#1db954',
    notes: 'Consumer Spotify is not licensed for commercial use. For gyms, use Soundtrack Your Brand (the legal commercial variant above). Stick-launch is provided only because some gyms have pre-existing music licenses.',
  },
];

/* ────────────────────────────────────────────────────────────────
 * 5. FITNESS CONTENT PROVIDERS — partner-dependent
 * ──────────────────────────────────────────────────────────────── */
const FITNESS_CONTENT: FitnessSource[] = [
  { id: 'les-mills',     name: 'Les Mills On Demand Business', tagline: 'Group fitness classes',       category: 'fitness-content', status: 'PARTNER', icon: 'LM', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#e20000', notes: 'Les Mills On Demand Business is available via their partner program. We will ship the integration once we have the partnership agreement.' },
  { id: 'peloton-commercial', name: 'Peloton Commercial', tagline: 'On-demand + live Peloton',     category: 'fitness-content', status: 'PARTNER', icon: 'Pe', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#000000' },
  { id: 'ifit-business', name: 'iFit Business',        tagline: 'iFit commercial content',       category: 'fitness-content', status: 'PARTNER', icon: 'iF', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#ec2027' },
  { id: 'wexer',         name: 'Wexer',                tagline: 'Virtual group fitness',          category: 'fitness-content', status: 'PARTNER', icon: 'Wx', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#0079ff' },
  { id: 'matrix-learning', name: 'Matrix Learning',    tagline: 'Equipment video tutorials',      category: 'fitness-content', status: 'PARTNER', icon: 'Mx', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#ff6600' },
  { id: 'custom-video-loop', name: 'Custom Video Loop', tagline: 'Your own equipment tutorials', category: 'fitness-content', status: 'READY',
    icon: '🎬', widgetType: 'FITNESS_VIDEO_LOOP', accentColor: '#ff2a4d',
    configFields: [
      { key: 'videoUrl', label: 'Video URL (.mp4 or HLS)', type: 'url', required: true },
      { key: 'equipmentName', label: 'Equipment name', type: 'text', placeholder: 'LEG PRESS' },
      { key: 'trainerName', label: 'Trainer credit', type: 'text' },
    ],
  },
];

/* ────────────────────────────────────────────────────────────────
 * 6. SOCIAL / COMMUNITY — public feeds
 * ──────────────────────────────────────────────────────────────── */
const SOCIAL: FitnessSource[] = [
  { id: 'instagram-feed',  name: 'Instagram Feed',  tagline: 'Embed your gym\'s public feed', category: 'social', status: 'COMING', icon: 'Ig', widgetType: 'FITNESS_LIVE_TV', accentColor: '#e1306c' },
  { id: 'tiktok-feed',     name: 'TikTok Feed',     tagline: 'Embed your TikTok videos',      category: 'social', status: 'COMING', icon: 'Tk', widgetType: 'FITNESS_LIVE_TV', accentColor: '#ff0050' },
  { id: 'facebook-live',   name: 'Facebook Live',   tagline: 'Embed public Facebook lives',    category: 'social', status: 'COMING', icon: 'FB', widgetType: 'FITNESS_LIVE_TV', accentColor: '#1877f2' },
  { id: 'twitch',          name: 'Twitch',          tagline: 'Embed any Twitch channel',       category: 'social', status: 'READY',
    icon: 'Tw', widgetType: 'FITNESS_LIVE_TV', accentColor: '#9147ff',
    configFields: [{ key: 'twitchChannel', label: 'Twitch channel name', type: 'text', required: true, placeholder: 'twitch_username' }],
  },
  { id: 'vimeo',           name: 'Vimeo',           tagline: 'Embed Vimeo videos + live',      category: 'social', status: 'READY',
    icon: 'Vi', widgetType: 'FITNESS_LIVE_TV', accentColor: '#1ab7ea',
    configFields: [{ key: 'vimeoUrl', label: 'Vimeo URL or video ID', type: 'url', required: true }],
  },
];

export const FITNESS_SOURCE_CATALOG: FitnessSource[] = [
  ...FAST_APPS,
  ...NEWS_SPORTS,
  ...STICK_APPS,
  ...MUSIC_APPS,
  ...FITNESS_CONTENT,
  ...SOCIAL,
];

/** Convenience — look up a source by id. */
export function getSourceById(id: string): FitnessSource | undefined {
  return FITNESS_SOURCE_CATALOG.find((s) => s.id === id);
}

/** Group sources by category for the picker UI. */
export function sourcesByCategory(): Record<SourceCategory, FitnessSource[]> {
  const out: Record<SourceCategory, FitnessSource[]> = {
    'free-fast': [],
    'live-tv': [],
    'streaming-apps': [],
    'news-sports': [],
    'music': [],
    'fitness-content': [],
    'social': [],
  };
  for (const s of FITNESS_SOURCE_CATALOG) out[s.category].push(s);
  return out;
}

export const CATEGORY_LABELS: Record<SourceCategory, string> = {
  'free-fast':        'Free Channels',
  'live-tv':          'Live TV',
  'streaming-apps':   'Streaming Apps',
  'news-sports':      'News & Sports',
  'music':            'Music',
  'fitness-content':  'Fitness Content',
  'social':           'Social',
};
