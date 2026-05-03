/**
 * Streaming presets — curated channel catalogs shipped with the
 * `public-broadcasters` provider. These are explicitly venue-friendly
 * live streams that operators can drop on a screen with zero auth and
 * zero licensing cost.
 *
 * Sources verified (2026-05-03):
 *   • NHK World — explicitly invites free public + venue rebroadcast
 *     of their international English channel.
 *   • France 24 — same; live streams in EN/FR/AR/ES freely embeddable.
 *   • Deutsche Welle (DW) — same.
 *   • Al Jazeera English — same.
 *
 * URLs below are the YouTube-live embed targets, which:
 *   • Avoid the parent CORS issues of the broadcasters' own m3u8 endpoints.
 *   • Auto-fail-over when a broadcaster rotates their YouTube live id
 *     (we serve the channel handle, YouTube resolves to current live).
 *   • Mute by default per venue policy; operator can unmute on the
 *     player.
 *
 * If a broadcaster's YouTube live changes, update the handle here.
 * Refreshing the in-memory list is a one-line change + redeploy; no
 * DB migration. Per-tenant overrides live in StreamChannel rows.
 */

export interface PresetChannel {
  /** Stable id stored on StreamChannel.externalId. */
  id: string;
  title: string;
  description?: string;
  category: 'NEWS' | 'SPORTS' | 'MUSIC' | 'LIFESTYLE' | 'CULTURE';
  language: string;                     // 'en' / 'es' / 'fr' / etc.
  /** YouTube channel handle for live_stream embed. */
  youtubeHandle?: string;
  /** Direct HLS URL (when broadcaster offers an embeddable .m3u8). */
  hlsUrl?: string;
  /** Square or 16:9 thumbnail. */
  thumbnailUrl?: string;
  /** Whether the channel allows operator ad overlays per their TOS. */
  allowAdOverlay: boolean;
}

export const PUBLIC_BROADCASTER_CHANNELS: ReadonlyArray<PresetChannel> = [
  {
    id: 'nhk-world',
    title: 'NHK World — English',
    description: 'Japan public broadcaster. 24/7 English news + culture.',
    category: 'NEWS',
    language: 'en',
    youtubeHandle: 'NHKWORLD',
    allowAdOverlay: true,
  },
  {
    id: 'france-24-en',
    title: 'France 24 — English',
    description: 'French international news in English. Live 24/7.',
    category: 'NEWS',
    language: 'en',
    youtubeHandle: 'FRANCE24English',
    allowAdOverlay: true,
  },
  {
    id: 'france-24-fr',
    title: 'France 24 — Français',
    description: 'Actualité internationale en direct.',
    category: 'NEWS',
    language: 'fr',
    youtubeHandle: 'FRANCE24',
    allowAdOverlay: true,
  },
  {
    id: 'france-24-es',
    title: 'France 24 — Español',
    description: 'Noticias internacionales en directo.',
    category: 'NEWS',
    language: 'es',
    youtubeHandle: 'France24_es',
    allowAdOverlay: true,
  },
  {
    id: 'dw-english',
    title: 'DW News — English',
    description: 'Deutsche Welle. German public broadcaster, English live.',
    category: 'NEWS',
    language: 'en',
    youtubeHandle: 'dwnews',
    allowAdOverlay: true,
  },
  {
    id: 'al-jazeera-en',
    title: 'Al Jazeera English',
    description: 'Doha-based international news in English. Live 24/7.',
    category: 'NEWS',
    language: 'en',
    youtubeHandle: 'aljazeeraenglish',
    allowAdOverlay: true,
  },
  {
    id: 'bloomberg-tv',
    title: 'Bloomberg Television',
    description: 'Business + markets, live. Free public stream.',
    category: 'NEWS',
    language: 'en',
    youtubeHandle: 'markets',
    allowAdOverlay: true,
  },
  {
    id: 'sky-news-en',
    title: 'Sky News',
    description: 'UK 24/7 news live.',
    category: 'NEWS',
    language: 'en',
    youtubeHandle: 'skynews',
    allowAdOverlay: true,
  },
  {
    id: 'cbsn',
    title: 'CBS News 24/7',
    description: 'US national news, free public live stream.',
    category: 'NEWS',
    language: 'en',
    youtubeHandle: 'cbsnews',
    allowAdOverlay: true,
  },
];

/** Build the YouTube live_stream iframe URL for a preset handle. */
export function presetEmbedUrl(channel: PresetChannel, opts: { muted: boolean; autoplay: boolean }): string {
  if (channel.hlsUrl) return channel.hlsUrl; // direct HLS wins
  if (channel.youtubeHandle) {
    return `https://www.youtube.com/embed/live_stream?channel=${channel.youtubeHandle}&autoplay=${opts.autoplay ? 1 : 0}&mute=${opts.muted ? 1 : 0}&controls=0`;
  }
  return '';
}
