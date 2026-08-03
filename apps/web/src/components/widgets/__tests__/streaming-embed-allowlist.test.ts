import {
  normalizeEmbedUrl,
  isAllowedStreamingHost,
  STREAMING_EMBED_HOSTS,
} from '../StreamingWidget';

/**
 * INJ-006 (2026-08-02) — `normalizeEmbedUrl` used to end with
 * "Fall through — assume the URL is already an embed URL. return u;", so any
 * string in `config.embedUrl` was framed verbatim, full-bleed, on a school
 * display (with autoplay + encrypted-media granted). A CONTRIBUTOR can edit a
 * template bound to a live schedule, so "operator-supplied" is not a trust
 * boundary. Unrecognised hosts are now refused.
 */
const OPTS = { muted: true, autoplay: true };

describe('provider normalisation still works', () => {
  it('YouTube watch/short/live URLs -> embed', () => {
    expect(normalizeEmbedUrl('https://www.youtube.com/watch?v=abc123XYZ', OPTS)).toContain(
      'https://www.youtube.com/embed/abc123XYZ',
    );
    expect(normalizeEmbedUrl('https://youtu.be/abc123XYZ', OPTS)).toContain(
      'https://www.youtube.com/embed/abc123XYZ',
    );
  });
  it('YouTube channel live -> live_stream embed', () => {
    expect(normalizeEmbedUrl('https://youtube.com/@someschool/live', OPTS)).toContain(
      'https://www.youtube.com/embed/live_stream?channel=someschool',
    );
  });
  it('Twitch -> player.twitch.tv', () => {
    expect(normalizeEmbedUrl('https://twitch.tv/somechannel', OPTS)).toContain(
      'https://player.twitch.tv/?channel=somechannel',
    );
  });
  it('Vimeo -> player.vimeo.com', () => {
    expect(normalizeEmbedUrl('https://vimeo.com/123456789', OPTS)).toContain(
      'https://player.vimeo.com/video/123456789',
    );
  });
  it('an already-correct embed URL on an allowlisted host passes through', () => {
    const u = 'https://player.kick.com/somechannel';
    expect(normalizeEmbedUrl(u, OPTS)).toBe(u);
  });
});

describe('the fall-through is allowlisted, not assumed', () => {
  it('refuses an arbitrary third-party page', () => {
    expect(normalizeEmbedUrl('https://evil.example/take-over-the-screen', OPTS)).toBe('');
    expect(normalizeEmbedUrl('https://phishing-clone.test/login', OPTS)).toBe('');
  });

  it('refuses look-alike hosts that merely CONTAIN an allowlisted name', () => {
    expect(normalizeEmbedUrl('https://youtube.com.evil.net/x', OPTS)).toBe('');
    expect(normalizeEmbedUrl('https://notyoutube.com/x', OPTS)).toBe('');
    expect(normalizeEmbedUrl('https://evil.net/?u=vimeo.com', OPTS)).toBe('');
  });

  it('refuses non-https schemes and script/data URLs', () => {
    expect(normalizeEmbedUrl('javascript:alert(1)', OPTS)).toBe('');
    expect(normalizeEmbedUrl('data:text/html,<script>alert(1)</script>', OPTS)).toBe('');
    expect(normalizeEmbedUrl('http://evil.example/x', OPTS)).toBe('');
    expect(normalizeEmbedUrl('file:///etc/passwd', OPTS)).toBe('');
  });

  it('refuses garbage / relative input rather than framing it', () => {
    expect(normalizeEmbedUrl('  ', OPTS)).toBe('');
    expect(normalizeEmbedUrl('/internal/admin', OPTS)).toBe('');
    expect(normalizeEmbedUrl('not a url at all', OPTS)).toBe('');
  });

  it('accepts subdomains of allowlisted hosts on a dot boundary only', () => {
    expect(isAllowedStreamingHost('www.youtube.com')).toBe(true);
    expect(isAllowedStreamingHost('player.vimeo.com')).toBe(true);
    expect(isAllowedStreamingHost('embed.twitch.tv')).toBe(true);
    expect(isAllowedStreamingHost('youtube.com.evil.net')).toBe(false);
    expect(isAllowedStreamingHost('evilyoutube.com')).toBe(false);
    expect(isAllowedStreamingHost('evil.net')).toBe(false);
  });

  it('every allowlisted host is lowercase and bare (no scheme/path/port)', () => {
    for (const h of STREAMING_EMBED_HOSTS) {
      expect(h).toBe(h.toLowerCase());
      expect(h).not.toMatch(/[/:]/);
    }
  });
});
