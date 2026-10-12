/**
 * streaming-url-parse — ONE reader for the YouTube and Vimeo links operators
 * actually paste, shared by the App Library (add-time, `url-transforms.ts`)
 * and the player (render-time, `StreamingWidget.normalizeEmbedUrl`).
 *
 * 2026-10-12 (owner: "is that all people do for vimeo?"). Both sides used to
 * carry their own one-line regex — `vimeo\.com\/(?:video\/)?(\d+)` — and
 * between them they dropped most real-world links:
 *
 *   - an UNLISTED Vimeo link carries a privacy hash (`vimeo.com/123/abcdef`,
 *     `player.vimeo.com/video/123?h=abcdef`). The regex kept the id and threw
 *     the hash away, so the player asked Vimeo for a private video without its
 *     key and got "Sorry, this video does not exist";
 *   - `vimeo.com/channels/staffpicks/123`, `/groups/x/videos/123`,
 *     `/showcase/123`, `/event/123` never matched at all;
 *   - a YouTube `playlist?list=` link fell through to the allowlist and was
 *     framed as YouTube's own playlist PAGE, which refuses to be framed;
 *   - a single YouTube video ended on YouTube's "more videos" wall.
 *
 * Pure, DOM-free and host-checked on the PARSED url (never a substring), so
 * `https://evil.net/?u=vimeo.com` is not a Vimeo link.
 */

export type YoutubeRef =
  | { kind: 'video'; id: string; list?: string; start?: number }
  | { kind: 'playlist'; list: string }
  /** `youtube.com/channel/UC…/live` — embeddable by channel id. */
  | { kind: 'channel-live'; channelId: string }
  /** `youtube.com/@handle/live` — YouTube's live embed needs the channel ID,
   *  which a handle is not. Recognised so the form can say so. */
  | { kind: 'handle-live'; handle: string };

export type VimeoRef =
  | { kind: 'video'; id: string; hash?: string }
  | { kind: 'showcase'; id: string }
  | { kind: 'event'; id: string };

const YT_ID = /^[\w-]{6,}$/;
const YT_LIST = /^[\w-]{10,}$/;
const YT_CHANNEL = /^UC[\w-]{10,}$/;
const DIGITS = /^\d+$/;
const VIMEO_HASH = /^[0-9a-zA-Z]{6,}$/;

function toUrl(input: string): URL | null {
  const raw = (input || '').trim();
  if (!raw) return null;
  // Operators paste "youtu.be/xyz" and "vimeo.com/123" without a scheme.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : raw.startsWith('//') ? `https:${raw}` : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u;
  } catch {
    return null;
  }
}

function hostIs(u: URL, base: string): boolean {
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  return h === base || h.endsWith(`.${base}`);
}

function parseStart(v: string | null): number | undefined {
  if (!v) return undefined;
  // `t=90`, `t=90s`, `t=1m30s`, `start=90`
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (!m) return undefined;
  const s = Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
  return s > 0 ? s : undefined;
}

/** Every YouTube link shape the Share button, the address bar and the embed
 *  dialog produce. Null for anything that is not a YouTube link. */
export function parseYoutubeUrl(input: string): YoutubeRef | null {
  const u = toUrl(input);
  if (!u) return null;
  const isShort = hostIs(u, 'youtu.be');
  if (!isShort && !hostIs(u, 'youtube.com') && !hostIs(u, 'youtube-nocookie.com')) return null;
  const seg = u.pathname.split('/').filter(Boolean);
  const list = u.searchParams.get('list') || undefined;
  const start = parseStart(u.searchParams.get('t') || u.searchParams.get('start'));
  const video = (id: string | undefined): YoutubeRef | null =>
    id && YT_ID.test(id)
      ? { kind: 'video', id, ...(list && YT_LIST.test(list) ? { list } : {}), ...(start ? { start } : {}) }
      : null;

  if (isShort) return video(seg[0]);

  const [first, second, third] = seg;
  if (!first) return null;
  if (first === 'watch') return video(u.searchParams.get('v') || undefined) ?? (list && YT_LIST.test(list) ? { kind: 'playlist', list } : null);
  if (first === 'playlist') return list && YT_LIST.test(list) ? { kind: 'playlist', list } : null;
  if (first === 'embed') {
    if (second === 'videoseries') return list && YT_LIST.test(list) ? { kind: 'playlist', list } : null;
    if (second === 'live_stream') {
      const ch = u.searchParams.get('channel') || '';
      return YT_CHANNEL.test(ch) ? { kind: 'channel-live', channelId: ch } : null;
    }
    return video(second);
  }
  if (first === 'shorts' || first === 'live' || first === 'v' || first === 'e') return video(second);
  if (first === 'channel' && second && third === 'live') {
    return YT_CHANNEL.test(second) ? { kind: 'channel-live', channelId: second } : null;
  }
  if (first.startsWith('@') && second === 'live') {
    const handle = first.slice(1);
    return /^[\w.-]+$/.test(handle) ? { kind: 'handle-live', handle } : null;
  }
  if ((first === 'c' || first === 'user') && second && third === 'live') {
    return /^[\w.-]+$/.test(second) ? { kind: 'handle-live', handle: second } : null;
  }
  return null;
}

/** Every Vimeo link shape: plain, unlisted (with its privacy hash), the
 *  player URL, channels, groups, showcases (albums) and live events. */
export function parseVimeoUrl(input: string): VimeoRef | null {
  const u = toUrl(input);
  if (!u || !hostIs(u, 'vimeo.com')) return null;
  const seg = u.pathname.split('/').filter(Boolean);
  const queryHash = u.searchParams.get('h') || undefined;
  const video = (id: string | undefined, hash?: string): VimeoRef | null => {
    if (!id || !DIGITS.test(id)) return null;
    const h = hash && VIMEO_HASH.test(hash) ? hash : queryHash && VIMEO_HASH.test(queryHash) ? queryHash : undefined;
    return { kind: 'video', id, ...(h ? { hash: h } : {}) };
  };

  // player.vimeo.com/video/123?h=abc
  if (u.hostname.toLowerCase().startsWith('player.')) {
    return seg[0] === 'video' ? video(seg[1]) : null;
  }
  const [first, second, third, fourth] = seg;
  if (!first) return null;
  // vimeo.com/123  ·  vimeo.com/123/abcdef (unlisted)
  if (DIGITS.test(first)) return video(first, second);
  // vimeo.com/video/123
  if (first === 'video') return video(second, third);
  // vimeo.com/channels/<name>/123
  if (first === 'channels' && second) return video(third, fourth);
  // vimeo.com/groups/<name>/videos/123
  if (first === 'groups' && second && third === 'videos') return video(fourth);
  // vimeo.com/manage/videos/123(/abcdef)
  if (first === 'manage' && second === 'videos') return video(third, fourth);
  // vimeo.com/showcase/123 · /album/123 · /showcase/123/video/456
  if ((first === 'showcase' || first === 'album') && second && DIGITS.test(second)) {
    if (third === 'video') return video(fourth);
    return { kind: 'showcase', id: second };
  }
  // vimeo.com/event/123 (live events)
  if (first === 'event' && second && DIGITS.test(second)) return { kind: 'event', id: second };
  return null;
}

/** The link we STORE in a zone for a parsed YouTube ref — readable, and
 *  re-parseable by `parseYoutubeUrl` (that round trip is unit-tested). */
export function youtubeCanonicalUrl(ref: YoutubeRef): string {
  switch (ref.kind) {
    case 'video': {
      const p = new URLSearchParams({ v: ref.id });
      if (ref.list) p.set('list', ref.list);
      if (ref.start) p.set('t', String(ref.start));
      return `https://www.youtube.com/watch?${p.toString()}`;
    }
    case 'playlist':
      return `https://www.youtube.com/playlist?list=${ref.list}`;
    case 'channel-live':
      return `https://www.youtube.com/channel/${ref.channelId}/live`;
    case 'handle-live':
      return `https://www.youtube.com/@${ref.handle}/live`;
  }
}

export function vimeoCanonicalUrl(ref: VimeoRef): string {
  switch (ref.kind) {
    case 'video':
      return ref.hash ? `https://vimeo.com/${ref.id}/${ref.hash}` : `https://vimeo.com/${ref.id}`;
    case 'showcase':
      return `https://vimeo.com/showcase/${ref.id}`;
    case 'event':
      return `https://vimeo.com/event/${ref.id}`;
  }
}

export interface EmbedOpts {
  muted: boolean;
  autoplay: boolean;
}

/** The iframe src a screen plays. A single video LOOPS (signage never wants
 *  YouTube's end-of-video wall); a playlist plays through and starts over. */
export function youtubeEmbedSrc(ref: YoutubeRef, opts: EmbedOpts): string {
  const common = {
    autoplay: opts.autoplay ? '1' : '0',
    mute: opts.muted ? '1' : '0',
    controls: '0',
    modestbranding: '1',
    rel: '0',
    playsinline: '1',
  };
  switch (ref.kind) {
    case 'video': {
      const p = new URLSearchParams(common);
      p.set('loop', '1');
      // YouTube only loops a single video when it is also its own playlist.
      if (ref.list) p.set('list', ref.list);
      else p.set('playlist', ref.id);
      if (ref.start) p.set('start', String(ref.start));
      return `https://www.youtube.com/embed/${ref.id}?${p.toString()}`;
    }
    case 'playlist': {
      const p = new URLSearchParams(common);
      p.set('list', ref.list);
      p.set('loop', '1');
      return `https://www.youtube.com/embed/videoseries?${p.toString()}`;
    }
    case 'channel-live':
      return `https://www.youtube.com/embed/live_stream?channel=${ref.channelId}&autoplay=${common.autoplay}&mute=${common.mute}`;
    case 'handle-live':
      // Kept for boards saved before the form refused handles; YouTube needs
      // a channel id here, so this may show YouTube's own error.
      return `https://www.youtube.com/embed/live_stream?channel=${ref.handle}&autoplay=${common.autoplay}&mute=${common.mute}`;
  }
}

export function vimeoEmbedSrc(ref: VimeoRef, opts: EmbedOpts): string {
  const p = new URLSearchParams();
  if (ref.kind === 'video' && ref.hash) p.set('h', ref.hash);
  p.set('autoplay', opts.autoplay ? '1' : '0');
  p.set('muted', opts.muted ? '1' : '0');
  if (ref.kind !== 'event') p.set('loop', '1');
  p.set('autopause', '0');
  p.set('controls', '0');
  switch (ref.kind) {
    case 'video':
      return `https://player.vimeo.com/video/${ref.id}?${p.toString()}`;
    case 'showcase':
      return `https://vimeo.com/showcase/${ref.id}/embed?${p.toString()}`;
    case 'event':
      return `https://vimeo.com/event/${ref.id}/embed?${p.toString()}`;
  }
}
