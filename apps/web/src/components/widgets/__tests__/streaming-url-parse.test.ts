/**
 * streaming-url-parse — the YouTube/Vimeo links operators really paste
 * (owner, 2026-10-12: "is that all people do for vimeo?").
 *
 * Every shape is checked THREE ways: the parser reads it, the App Library's
 * canonical form re-parses to the same thing (what we store is what the
 * screen reads), and the screen's `normalizeEmbedUrl` turns it into a real
 * player URL that keeps what matters (an unlisted video's hash, a playlist).
 */
import {
  parseVimeoUrl,
  parseYoutubeUrl,
  vimeoCanonicalUrl,
  youtubeCanonicalUrl,
} from '../streaming-url-parse';
import { normalizeEmbedUrl } from '../StreamingWidget';
import { getApp } from '@/components/apps/app-registry';
import { buildApp } from '@/components/apps/build-app';

const OPTS = { muted: true, autoplay: true };

describe('Vimeo — every link shape', () => {
  const cases: Array<[string, ReturnType<typeof parseVimeoUrl>, string]> = [
    ['https://vimeo.com/123456789', { kind: 'video', id: '123456789' }, 'https://player.vimeo.com/video/123456789?'],
    ['vimeo.com/123456789', { kind: 'video', id: '123456789' }, 'https://player.vimeo.com/video/123456789?'],
    // Unlisted: the hash is the key to the video.
    ['https://vimeo.com/123456789/abcdef1234', { kind: 'video', id: '123456789', hash: 'abcdef1234' }, 'https://player.vimeo.com/video/123456789?h=abcdef1234'],
    ['https://player.vimeo.com/video/123456789?h=abcdef1234&badge=0', { kind: 'video', id: '123456789', hash: 'abcdef1234' }, 'https://player.vimeo.com/video/123456789?h=abcdef1234'],
    ['https://vimeo.com/123456789?share=copy', { kind: 'video', id: '123456789' }, 'https://player.vimeo.com/video/123456789?'],
    ['https://vimeo.com/channels/staffpicks/123456789', { kind: 'video', id: '123456789' }, 'https://player.vimeo.com/video/123456789?'],
    ['https://vimeo.com/groups/shortfilms/videos/123456789', { kind: 'video', id: '123456789' }, 'https://player.vimeo.com/video/123456789?'],
    ['https://vimeo.com/manage/videos/123456789/abcdef1234', { kind: 'video', id: '123456789', hash: 'abcdef1234' }, 'https://player.vimeo.com/video/123456789?h=abcdef1234'],
    ['https://vimeo.com/showcase/9876543', { kind: 'showcase', id: '9876543' }, 'https://vimeo.com/showcase/9876543/embed?'],
    ['https://vimeo.com/album/9876543', { kind: 'showcase', id: '9876543' }, 'https://vimeo.com/showcase/9876543/embed?'],
    ['https://vimeo.com/showcase/9876543/video/123456789', { kind: 'video', id: '123456789' }, 'https://player.vimeo.com/video/123456789?'],
    ['https://vimeo.com/event/4455667', { kind: 'event', id: '4455667' }, 'https://vimeo.com/event/4455667/embed?'],
  ];
  it.each(cases)('%s', (input, ref, embedPrefix) => {
    expect(parseVimeoUrl(input)).toEqual(ref);
    // Stored form round-trips.
    expect(parseVimeoUrl(vimeoCanonicalUrl(ref!))).toEqual(ref);
    // The screen's player URL.
    const embed = normalizeEmbedUrl(vimeoCanonicalUrl(ref!), OPTS);
    expect(embed.startsWith(embedPrefix)).toBe(true);
    expect(embed).toContain('muted=1');
  });

  it('refuses what is not a Vimeo video', () => {
    for (const bad of ['https://vimeo.com/', 'https://vimeo.com/features', 'https://evil.net/?u=vimeo.com/123', 'https://vimeo.com.evil.net/123', 'not a link']) {
      expect(parseVimeoUrl(bad)).toBeNull();
    }
  });
});

describe('YouTube — every link shape', () => {
  const ID = 'dQw4w9WgXcQ';
  const LIST = 'PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG';
  const cases: Array<[string, ReturnType<typeof parseYoutubeUrl>, string]> = [
    [`https://www.youtube.com/watch?v=${ID}`, { kind: 'video', id: ID }, `https://www.youtube.com/embed/${ID}?`],
    [`https://youtu.be/${ID}?si=abc`, { kind: 'video', id: ID }, `https://www.youtube.com/embed/${ID}?`],
    [`youtu.be/${ID}`, { kind: 'video', id: ID }, `https://www.youtube.com/embed/${ID}?`],
    [`https://m.youtube.com/watch?v=${ID}&t=90s`, { kind: 'video', id: ID, start: 90 }, `https://www.youtube.com/embed/${ID}?`],
    [`https://www.youtube.com/shorts/${ID}`, { kind: 'video', id: ID }, `https://www.youtube.com/embed/${ID}?`],
    [`https://www.youtube.com/live/${ID}?feature=share`, { kind: 'video', id: ID }, `https://www.youtube.com/embed/${ID}?`],
    [`https://www.youtube.com/embed/${ID}`, { kind: 'video', id: ID }, `https://www.youtube.com/embed/${ID}?`],
    [`https://www.youtube.com/playlist?list=${LIST}`, { kind: 'playlist', list: LIST }, 'https://www.youtube.com/embed/videoseries?'],
    [`https://www.youtube.com/watch?v=${ID}&list=${LIST}`, { kind: 'video', id: ID, list: LIST }, `https://www.youtube.com/embed/${ID}?`],
    ['https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv/live', { kind: 'channel-live', channelId: 'UCabcdefghijklmnopqrstuv' }, 'https://www.youtube.com/embed/live_stream?channel=UCabcdefghijklmnopqrstuv'],
  ];
  it.each(cases)('%s', (input, ref, embedPrefix) => {
    expect(parseYoutubeUrl(input)).toEqual(ref);
    expect(parseYoutubeUrl(youtubeCanonicalUrl(ref!))).toEqual(ref);
    expect(normalizeEmbedUrl(youtubeCanonicalUrl(ref!), OPTS).startsWith(embedPrefix)).toBe(true);
  });

  it('a single video loops on a screen; a playlist keeps its list', () => {
    expect(normalizeEmbedUrl(`https://youtu.be/${ID}`, OPTS)).toContain(`loop=1&playlist=${ID}`);
    expect(normalizeEmbedUrl(`https://www.youtube.com/playlist?list=${LIST}`, OPTS)).toContain(`list=${LIST}`);
  });

  it('recognises an @handle/live link only so the form can explain it', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/@someschool/live')).toEqual({ kind: 'handle-live', handle: 'someschool' });
  });

  it('refuses what is not a YouTube video', () => {
    for (const bad of ['https://www.youtube.com/', 'https://www.youtube.com/@someschool', 'https://youtube.com.evil.net/watch?v=dQw4w9WgXcQ', 'https://evil.net/watch?v=dQw4w9WgXcQ']) {
      expect(parseYoutubeUrl(bad)).toBeNull();
    }
  });
});

describe('the Vimeo and YouTube APPS accept the real-world forms', () => {
  const vimeo = getApp('vimeo')!;
  const youtube = getApp('youtube')!;
  it.each([
    'https://vimeo.com/123456789',
    'https://vimeo.com/123456789/abcdef1234',
    'https://player.vimeo.com/video/123456789?h=abcdef1234',
    'https://vimeo.com/channels/staffpicks/123456789',
    'https://vimeo.com/showcase/9876543',
    'https://vimeo.com/event/4455667',
  ])('Vimeo: %s', (url) => {
    const out = buildApp(vimeo, { url, muted: 'true' });
    expect(out.ok).toBe(true);
  });

  it('Vimeo keeps the unlisted hash all the way to the zone', () => {
    const out = buildApp(vimeo, { url: 'https://player.vimeo.com/video/123456789?h=abcdef1234', muted: 'true' });
    expect(out.ok && out.defaultConfig.embedUrl).toBe('https://vimeo.com/123456789/abcdef1234');
  });

  it.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
    'https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
  ])('YouTube: %s', (url) => {
    expect(buildApp(youtube, { url, muted: 'true' }).ok).toBe(true);
  });

  it('YouTube @handle/live is refused WITH a translated reason, not a dead zone', () => {
    const out = buildApp(youtube, { url: 'https://www.youtube.com/@someschool/live', muted: 'true' });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reasonKey).toBe('youtubeHandleLive');
  });

  it('a bare channel page is refused', () => {
    expect(buildApp(youtube, { url: 'https://www.youtube.com/@someschool', muted: 'true' }).ok).toBe(false);
  });
});
