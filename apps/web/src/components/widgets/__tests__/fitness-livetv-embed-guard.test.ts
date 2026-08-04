/**
 * INJ-006 twin (2026-08-03) — FitnessLiveTVWidget.
 *
 * StreamingWidget was hardened on 2026-08-02 (host allowlist + sandbox).
 * `fitness/FitnessLiveTVWidget.tsx` frames `config.streamUrl` with the SAME
 * `sandbox="allow-scripts allow-same-origin allow-presentation"` and had NO
 * allowlist at all — a raw operator string went straight into `src`,
 * full-bleed, on a surface that also renders lockdown alerts.
 *
 * `allow-same-origin` is defensible on that frame ONLY because the src is a
 * foreign host: the token restores the FRAME'S own origin, so a same-origin
 * src would hand the page our DOM and the player's localStorage device token.
 * The allowlist is what makes that guarantee — so the sandbox without it was
 * the weaker half of a pair.
 *
 * The same file also fetched hls.js from a public CDN at runtime and ran it
 * through `new Function` — unpinned third-party code (no SRI) executing on the
 * lockdown surface, plus an eval no real CSP would allow.
 */
import * as fs from 'fs';
import * as path from 'path';
import { safeEmbedSrc, isAllowedStreamingHost, STREAMING_EMBED_HOSTS } from '../streaming-hosts';

const WIDGET = path.join(__dirname, '..', 'fitness', 'FitnessLiveTVWidget.tsx');
const src = () => fs.readFileSync(WIDGET, 'utf8');

describe('safeEmbedSrc — the gate in front of both fitness iframes', () => {
  it('passes an allowlisted https provider URL through unchanged', () => {
    for (const u of [
      'https://www.youtube.com/embed/abc123',
      'https://youtube-nocookie.com/embed/abc123',
      'https://player.vimeo.com/video/123456',
      'https://player.twitch.tv/?channel=x&parent=y',
      'https://kick.com/somechannel',
    ]) {
      expect(safeEmbedSrc(u)).toBe(u);
    }
  });

  it('refuses an unknown host — this is the whole finding', () => {
    expect(safeEmbedSrc('https://evil.example/take-over-the-screen')).toBe('');
    expect(safeEmbedSrc('https://phishing-clone.test/login')).toBe('');
  });

  it('refuses lookalike hosts (dot-boundary match, not substring)', () => {
    expect(safeEmbedSrc('https://youtube.com.evil.net/x')).toBe('');
    expect(safeEmbedSrc('https://notyoutube.com/x')).toBe('');
    expect(safeEmbedSrc('https://evil.net/?u=vimeo.com')).toBe('');
  });

  it('refuses non-https and non-URL schemes', () => {
    expect(safeEmbedSrc('http://www.youtube.com/embed/x')).toBe('');
    expect(safeEmbedSrc('javascript:alert(1)')).toBe('');
    expect(safeEmbedSrc('data:text/html,<script>alert(1)</script>')).toBe('');
    expect(safeEmbedSrc('file:///etc/passwd')).toBe('');
  });

  it('refuses relative paths — the SAME-ORIGIN case allow-same-origin makes fatal', () => {
    expect(safeEmbedSrc('/player')).toBe('');
    expect(safeEmbedSrc('//evil.example/x')).toBe('');
    expect(safeEmbedSrc('not a url at all')).toBe('');
  });

  it('refuses loopback — there is deliberately no dev exemption', () => {
    expect(safeEmbedSrc('https://localhost:3000/anything')).toBe('');
    expect(safeEmbedSrc('http://127.0.0.1:3000/anything')).toBe('');
  });

  it('handles empty / nullish without throwing', () => {
    expect(safeEmbedSrc('')).toBe('');
    expect(safeEmbedSrc('   ')).toBe('');
    expect(safeEmbedSrc(undefined)).toBe('');
    expect(safeEmbedSrc(null)).toBe('');
  });

  it('every allowlisted host is self-consistent with the matcher', () => {
    for (const h of STREAMING_EMBED_HOSTS) {
      expect(isAllowedStreamingHost(h)).toBe(true);
      expect(isAllowedStreamingHost(`www.${h}`)).toBe(true);
      expect(isAllowedStreamingHost(`player.${h}`)).toBe(true);
      expect(isAllowedStreamingHost(`${h}.evil.net`)).toBe(false);
    }
  });
});

describe('FitnessLiveTVWidget wires both iframes through the gate', () => {
  it('no iframe src reads the raw operator URL any more', () => {
    const s = src();
    expect(s).not.toMatch(/src=\{c\.streamUrl\}/);
    expect(s).not.toMatch(/src=\{ytResult!\.embedUrl\}/);
  });

  it('both iframes read the gated values', () => {
    const s = src();
    expect(s).toMatch(/src=\{safeIframeUrl\}/);
    expect(s).toMatch(/src=\{safeYtEmbedUrl\}/);
    expect(s).toMatch(/safeEmbedSrc\(c\.streamUrl\)/);
    expect(s).toMatch(/safeEmbedSrc\(ytResult\?\.embedUrl\)/);
  });

  it('a refused host renders an honest placeholder instead of the page', () => {
    const s = src();
    expect(s).toMatch(/showBlockedHost/);
    expect(s).toMatch(/Unsupported streaming host/);
  });

  it('the sandbox is unchanged — the allowlist is what makes it safe', () => {
    // Dropping allow-same-origin would black out YouTube embeds (measured on
    // the StreamingWidget side); the allowlist is the correct fix, not
    // loosening or tightening the sandbox blindly.
    const s = src();
    const sandboxes = s.match(/sandbox="[^"]*"/g) || [];
    expect(sandboxes.length).toBeGreaterThanOrEqual(2);
    for (const sb of sandboxes) {
      expect(sb).toBe('sandbox="allow-scripts allow-same-origin allow-presentation"');
    }
  });
});

describe('FitnessLiveTVWidget loads the BUNDLED hls.js, not a CDN', () => {
  it('no runtime CDN fetch of a third-party player', () => {
    const s = src();
    expect(s).not.toMatch(/cdn\.jsdelivr\.net/);
    expect(s).not.toMatch(/unpkg\.com/);
    expect(s).not.toMatch(/cdnjs\.cloudflare\.com/);
  });

  it('no `new Function` eval', () => {
    expect(src()).not.toMatch(/new Function\(/);
  });

  it('uses the same bundled dynamic import StreamingWidget already used', () => {
    expect(src()).toMatch(/await import\('hls\.js'\)/);
  });

  it('hls.js is a real dependency (so the bundled import resolves)', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'package.json'), 'utf8'),
    );
    expect(pkg.dependencies['hls.js']).toBeTruthy();
  });
});
