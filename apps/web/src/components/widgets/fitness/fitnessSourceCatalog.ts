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
 *   • `EXTERNAL`— commercial provider playback stays on its licensed
 *                 receiver/player. VenueOS may show verified status or
 *                 switch an input only after the device controller ships.
 *   • `PARTNER` — B2B integration requiring a signed commercial
 *                 contract with the provider (Spotify's Soundtrack
 *                 Your Brand, Les Mills On Demand Business,
 *                 Peloton Commercial, etc.). Listed so operators
 *                 can request them; config is inert until the
 *                 contract lands.
 *   • `COMING`  — technically planned, but not connectable today.
 *   • `BLOCKED` — consumer terms or missing commercial rights make the
 *                 source unavailable for public gym playback.
 *   • `STICK`   — legacy saved value. Do not use for new catalog rows;
 *                 the current stick relay has no persistent registry,
 *                 acknowledgement, or player-side command handler.
 *
 * Every source declares the config fields it needs so the App
 * Library form can render the right input controls without per-
 * source UI code.
 */

export type SourceCategory = 'live-tv' | 'streaming-apps' | 'free-fast' | 'music' | 'fitness-content' | 'news-sports' | 'social';

export type SourceStatus = 'READY' | 'STICK' | 'EXTERNAL' | 'PARTNER' | 'COMING' | 'BLOCKED';

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
    | 'FITNESS_VIDEO_LOOP'
    | 'FITNESS_TRAINING_VIDEO';
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
 * 1. CONSUMER STREAMING APPS — blocked for commercial gym playback
 *    A streaming-stick deep link does not turn a residential subscription
 *    into a public-performance license. These rows are informational only.
 * ──────────────────────────────────────────────────────────────── */
const STICK_APPS: FitnessSource[] = [
  { id: 'netflix', name: 'Netflix', tagline: 'Consumer plan not licensed for gyms', category: 'streaming-apps', status: 'BLOCKED', icon: 'N', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#e50914', notes: 'Unavailable for public commercial playback. Use a venue-licensed programming provider.' },
  { id: 'disney-plus', name: 'Disney+', tagline: 'Consumer plan not licensed for gyms', category: 'streaming-apps', status: 'BLOCKED', icon: 'D+', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#0c1f72' },
  { id: 'hulu', name: 'Hulu', tagline: 'Consumer plan not licensed for gyms', category: 'streaming-apps', status: 'BLOCKED', icon: 'H', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#1ce783' },
  { id: 'max', name: 'Max', tagline: 'Consumer plan not licensed for gyms', category: 'streaming-apps', status: 'BLOCKED', icon: 'M', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#002be7' },
  { id: 'peacock', name: 'Peacock', tagline: 'Use EverPass/commercial service instead', category: 'streaming-apps', status: 'BLOCKED', icon: 'P', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#111111' },
  { id: 'paramount-plus', name: 'Paramount+', tagline: 'Consumer plan not licensed for gyms', category: 'streaming-apps', status: 'BLOCKED', icon: 'P+', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#0064ff' },
  { id: 'prime-video', name: 'Prime Video', tagline: 'Use an authorized commercial sports route', category: 'streaming-apps', status: 'BLOCKED', icon: 'AV', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#00a8e1' },
  { id: 'apple-tv-plus', name: 'Apple TV+', tagline: 'Consumer plan not licensed for gyms', category: 'streaming-apps', status: 'BLOCKED', icon: 'tv', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#111111' },
  { id: 'sling', name: 'Sling TV', tagline: 'Residential service is not a gym license', category: 'live-tv', status: 'BLOCKED', icon: 'S', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#ffb800' },
  { id: 'youtube-tv', name: 'YouTube TV', tagline: 'Residential service is not a gym license', category: 'live-tv', status: 'BLOCKED', icon: 'YT', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#ff0000' },
  { id: 'directv-stream', name: 'DIRECTV Stream (consumer)', tagline: 'Use DIRECTV for Business', category: 'live-tv', status: 'BLOCKED', icon: 'D', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#00447c' },
  { id: 'fubo', name: 'Fubo (consumer)', tagline: 'Consumer plan not licensed for gyms', category: 'live-tv', status: 'BLOCKED', icon: 'F', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#f64006' },
  { id: 'espn-plus', name: 'ESPN+ (consumer)', tagline: 'Use ESPN+ for Business via EverPass', category: 'news-sports', status: 'BLOCKED', icon: 'E+', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#fb0c00' },
  { id: 'discovery-plus', name: 'discovery+', tagline: 'Consumer plan not licensed for gyms', category: 'streaming-apps', status: 'BLOCKED', icon: 'd+', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#0057ff' },
  { id: 'nfl-sunday-ticket', name: 'NFL Sunday Ticket (consumer)', tagline: 'Use an authorized commercial distributor', category: 'news-sports', status: 'BLOCKED', icon: 'NFL', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#013369' },
  { id: 'nba-league-pass', name: 'NBA League Pass (consumer)', tagline: 'Use an authorized commercial distributor', category: 'news-sports', status: 'BLOCKED', icon: 'NBA', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#c9082a' },
  { id: 'mlb-tv', name: 'MLB.TV (consumer)', tagline: 'Use an authorized commercial distributor', category: 'news-sports', status: 'BLOCKED', icon: 'MLB', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#041e42' },
];

/* ────────────────────────────────────────────────────────────────
 * 2. CONSUMER FAST SERVICES — not a free commercial-content catalog
 *    Public or reverse-engineered stream URLs do not grant gym display
 *    rights. Provider-backed business distribution requires a contract.
 * ──────────────────────────────────────────────────────────────── */
const FAST_APPS: FitnessSource[] = [
  {
    id: 'pluto-tv', name: 'Pluto TV', tagline: 'Consumer service · commercial playback blocked', category: 'free-fast', status: 'BLOCKED',
    icon: 'Pi', widgetType: 'FITNESS_LIVE_TV', accentColor: '#ffd000',
    configFields: [
      { key: 'plutoInfo', label: 'Not available for gym playback', type: 'info', infoBody: 'Pluto consumer streams are not a VenueOS commercial programming source. Use Atmosphere TV, Loop TV, DIRECTV for Business, or another provider licensed for public venues.' },
    ],
    notes: 'Blocked by default. A public URL does not grant commercial public-performance rights.',
  },
  {
    id: 'samsung-tv-plus', name: 'Samsung TV Plus', tagline: 'Commercial HLS access required', category: 'free-fast', status: 'PARTNER',
    icon: 'S', widgetType: 'FITNESS_LIVE_TV', accentColor: '#1428a0',
    configFields: [
      { key: 'samsungInfo', label: 'Partner HLS URL required', type: 'info',
        infoBody: 'Samsung TV Plus requires a written distribution agreement and supported provider playback path. Do not paste scraped or session URLs.' },
    ],
  },
  {
    id: 'xumo', name: 'Xumo Play', tagline: 'Consumer service · commercial playback blocked', category: 'free-fast', status: 'BLOCKED',
    icon: 'X', widgetType: 'FITNESS_LIVE_TV', accentColor: '#3cc8c8',
    configFields: [
      { key: 'xumoInfo', label: 'Not available for gym playback', type: 'info', infoBody: 'Xumo Play terms prohibit public or commercial performance. VenueOS does not ship or derive Xumo HLS URLs.' },
    ],
  },
  {
    id: 'tubi', name: 'Tubi', tagline: 'Commercial HLS access required', category: 'free-fast', status: 'PARTNER',
    icon: 'T', widgetType: 'FITNESS_LIVE_TV', accentColor: '#fa382f',
    configFields: [
      { key: 'tubiInfo', label: 'Partner HLS URL required', type: 'info',
        infoBody: 'Tubi consumer playback is not a commercial gym source. A direct written distribution agreement is required before any integration can be enabled.' },
    ],
  },
  {
    id: 'roku-channel', name: 'The Roku Channel', tagline: 'Commercial HLS access required', category: 'free-fast', status: 'PARTNER',
    icon: 'Rc', widgetType: 'FITNESS_LIVE_TV', accentColor: '#662d91',
    configFields: [
      { key: 'rokuInfo', label: 'Partner HLS URL required', type: 'info',
        infoBody: 'The Roku Channel is not a commercial gym source by default. A direct written distribution agreement is required before any integration can be enabled.' },
    ],
  },
  {
    id: 'lg-channels', name: 'LG Channels', tagline: 'Commercial HLS access required', category: 'free-fast', status: 'PARTNER',
    icon: 'LG', widgetType: 'FITNESS_LIVE_TV', accentColor: '#a50034',
    configFields: [
      { key: 'lgInfo', label: 'Partner HLS URL required', type: 'info',
        infoBody: 'LG Channels uses a device-session token CDN — no public catalog to ship. Contact LG for commercial partner access, or paste an authorized HLS URL via a direct-HLS source.' },
    ],
  },
  {
    id: 'freevee', name: 'Amazon Freevee', tagline: 'Consumer service · commercial playback blocked', category: 'free-fast', status: 'BLOCKED',
    icon: 'Fv', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#00a8e1',
  },
];

/* ────────────────────────────────────────────────────────────────
 * 3. LIVE NEWS / SPORTS — rights-verified sources only
 * ──────────────────────────────────────────────────────────────── */
const NEWS_SPORTS: FitnessSource[] = [
  {
    id: 'youtube-live', name: 'YouTube Live', tagline: 'Public screening is blocked by default', category: 'news-sports', status: 'BLOCKED',
    icon: 'YT', widgetType: 'FITNESS_LIVE_TV', accentColor: '#ff0000',
    // No configFields on purpose. This source used to ask the operator to
    // paste a channel URL, which the API then scraped for the live video id.
    // Collecting a URL for a source that can never lawfully play reads as
    // "fill this in and it will work". A BLOCKED source explains itself and
    // collects nothing.
    notes: 'YouTube terms prohibit public screening and music streaming from the consumer service. Do not use this as general gym programming.',
  },
  {
    id: 'cnn-live', name: 'CNN Live', tagline: 'Commercial distribution agreement required', category: 'news-sports', status: 'PARTNER', icon: 'CNN', widgetType: 'FITNESS_LIVE_TV', accentColor: '#cc0000', configFields: [{ key: 'cnnInfo', label: 'Provider agreement required', type: 'info', infoBody: 'VenueOS enables this only after CNN or an authorized commercial distributor supplies a supported feed and written venue rights.' }], notes: 'No free VenueOS commercial HLS feed is assumed.' },
  {
    id: 'espn-commercial', name: 'ESPN+ for Business', tagline: 'Licensed external service via EverPass', category: 'news-sports', status: 'EXTERNAL',
    icon: 'E', widgetType: 'FITNESS_LIVE_TV', accentColor: '#fb0c00',
    configFields: [
      { key: 'espnInfo', label: 'External licensed playback', type: 'info', infoBody: 'Playback remains inside the approved EverPass/provider app or device. VenueOS may control the input and show verified status after an external-device adapter is installed.' },
    ],
    notes: 'Do not ingest or restream a consumer ESPN+ session.',
  },
  {
    id: 'directv-business', name: 'DIRECTV for Business', tagline: 'Licensed provider device/input', category: 'live-tv', status: 'EXTERNAL', icon: 'DB', widgetType: 'FITNESS_LIVE_TV', accentColor: '#00447c', configFields: [{ key: 'directvInfo', label: 'External licensed playback', type: 'info', infoBody: 'Use the DIRECTV for Business receiver or supported streaming device. VenueOS does not request a raw HLS URL or re-encode the signal.' }], notes: 'Requires an active DIRECTV for Business account; residential DIRECTV is not permitted.' },
  {
    id: 'local-news', name: 'Authorized Live HLS', tagline: 'Customer-owned or explicitly licensed feed', category: 'news-sports', status: 'COMING',
    icon: '📺', widgetType: 'FITNESS_LIVE_TV', accentColor: '#3b82f6',
    configFields: [
      { key: 'hlsUrl', label: 'Live HLS URL', type: 'url', required: true, placeholder: 'https://...playlist.m3u8' },
      { key: 'channelName', label: 'Display name', type: 'text', placeholder: 'KTLA 5 News', required: false },
    ],
    notes: 'This becomes READY only after the editor is wired to the server-owned streaming channel record and the rights attestation is stored. A public URL alone is insufficient.',
  },
];

/* ────────────────────────────────────────────────────────────────
 * 4. MUSIC PROVIDERS
 * ──────────────────────────────────────────────────────────────── */
const MUSIC_APPS: FitnessSource[] = [
  {
    id: 'custom-now-playing', name: 'Custom Now-Playing URL', tagline: 'Metadata only · server proxy required', category: 'music', status: 'COMING',
    icon: '🎵', widgetType: 'FITNESS_MUSIC_PLAYER', accentColor: '#39ff14',
    configFields: [
      { key: 'nowPlayingEndpoint', label: 'Now-playing JSON endpoint', type: 'url', required: true, placeholder: 'https://your-gym.com/now-playing' },
      { key: 'zoneLabel', label: 'Zone label', type: 'text', placeholder: 'CARDIO FLOOR' },
    ],
    notes: 'Metadata only; it does not carry audio. Production needs a tenant-scoped server adapter with authentication, SSRF protection, freshness and explicit disconnected state.',
  },
  {
    id: 'soundmachine', name: 'SoundMachine', tagline: 'Approved commercial playback API partnership', category: 'music', status: 'PARTNER',
    icon: 'SM', widgetType: 'FITNESS_MUSIC_PLAYER', accentColor: '#39ff14',
    configFields: [
      { key: 'soundmachineInfo', label: 'Developer approval required', type: 'info', infoBody: 'SoundMachine offers an official commercial Playback Services API. VenueOS needs approved app credentials and a server-side adapter before this can be connected.' },
    ],
    notes: 'Never ask for a guessed LAN endpoint. Audio and metadata must use SoundMachine\'s approved API/player contract.',
  },
  {
    id: 'soundtrack-your-brand', name: 'Soundtrack', tagline: 'Licensed business audio · control + metadata API', category: 'music', status: 'PARTNER',
    icon: 'SYB', widgetType: 'FITNESS_MUSIC_PLAYER', accentColor: '#1db954',
    configFields: [
      { key: 'sybInfo', label: 'Partnership required', type: 'info',
        infoBody: 'Soundtrack provides a documented GraphQL API for display, staff control and monitoring. VenueOS must keep the token server-side and bind a verified sound zone. The public API does not return a raw audio stream.' },
    ],
  },
  {
    id: 'rockbot', name: 'Rockbot', tagline: 'Gym-focused control + now-playing API', category: 'music', status: 'PARTNER',
    icon: 'RB', widgetType: 'FITNESS_MUSIC_PLAYER', accentColor: '#6c55ff',
    configFields: [{ key: 'rockbotInfo', label: 'Provider approval required', type: 'info', infoBody: 'Rockbot offers an approval-gated OAuth client-credentials API for zones, playback control, now playing, queues and messaging. Audio remains on the Rockbot player.' }],
    notes: 'Strong first gym adapter. Group/instructor-led classes require separate rights verification.',
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
    id: 'apple-music', name: 'Apple Music', tagline: 'Personal service · commercial use blocked', category: 'music', status: 'BLOCKED',
    icon: 'Am', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#fa233b', notes: 'MusicKit does not grant public-performance rights. Do not launch or play it in a gym.',
  },
  {
    id: 'spotify-consumer', name: 'Spotify (consumer)', tagline: 'Personal service · commercial use blocked', category: 'music', status: 'BLOCKED',
    icon: 'Sp', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#1db954',
    notes: 'Spotify explicitly prohibits public business playback. A separate blanket license does not turn the consumer stream into an approved source. Use Soundtrack or another commercial provider.',
  },
];

/* ────────────────────────────────────────────────────────────────
 * 5. FITNESS CONTENT PROVIDERS — partner-dependent
 * ──────────────────────────────────────────────────────────────── */
const FITNESS_CONTENT: FitnessSource[] = [
  { id: 'fitness-on-demand', name: 'Fitness On Demand', tagline: 'Commercial fitness library + documented API', category: 'fitness-content', status: 'PARTNER', icon: 'FOD', widgetType: 'FITNESS_TRAINING_VIDEO', accentColor: '#635bff', notes: 'Contract API supports licensed content, enrollment, usage, live streaming and geofencing. Enable only with provider-issued credentials and rights scope.' },
  { id: 'les-mills', name: 'LES MILLS Virtual', tagline: 'Club-licensed virtual classes', category: 'fitness-content', status: 'PARTNER', icon: 'LM', widgetType: 'FITNESS_TRAINING_VIDEO', accentColor: '#e20000', notes: 'Requires a club partner agreement and provider-issued player/API credentials. A consumer LES MILLS+ account is not sufficient.' },
  { id: 'peloton-commercial', name: 'Peloton Commercial', tagline: 'On-demand + live Peloton',     category: 'fitness-content', status: 'PARTNER', icon: 'Pe', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#000000' },
  { id: 'ifit-business', name: 'iFit Business',        tagline: 'iFit commercial content',       category: 'fitness-content', status: 'PARTNER', icon: 'iF', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#ec2027' },
  { id: 'wexer', name: 'Wexer', tagline: 'Contract API + virtual player', category: 'fitness-content', status: 'PARTNER', icon: 'Wx', widgetType: 'FITNESS_TRAINING_VIDEO', accentColor: '#0079ff' },
  { id: 'matrix-learning', name: 'Matrix Learning',    tagline: 'Equipment video tutorials',      category: 'fitness-content', status: 'PARTNER', icon: 'Mx', widgetType: 'FITNESS_STICK_LAUNCHER', accentColor: '#ff6600' },
  { id: 'custom-video-loop', name: 'Owned Video Loop', tagline: 'Upload your licensed MP4 tutorial', category: 'fitness-content', status: 'READY',
    icon: '🎬', widgetType: 'FITNESS_TRAINING_VIDEO', accentColor: '#ff2a4d',
    configFields: [
      { key: 'videoUrl', label: 'Video URL (.mp4)', type: 'url', required: true },
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
  { id: 'twitch', name: 'Twitch', tagline: 'Public embed is not a gym programming license', category: 'social', status: 'BLOCKED',
    icon: 'Tw', widgetType: 'FITNESS_LIVE_TV', accentColor: '#9147ff',
    // Explains itself; collects nothing. Asking for a channel name on a
    // BLOCKED source promises a working screen once the field is filled in.
    configFields: [
      { key: 'twitchInfo', label: 'Not available for gym playback', type: 'info',
        infoBody: 'Twitch embeds are technically supported, but embeddability is not a public-performance license. VenueOS enables Twitch only with written commercial rights for the specific channel.' },
    ],
    notes: 'Blocked by default. A working embed is not a commercial gym programming license.',
  },
  { id: 'vimeo', name: 'Vimeo', tagline: 'Host customer-owned or licensed video', category: 'social', status: 'PARTNER',
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
