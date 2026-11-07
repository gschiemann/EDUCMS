/**
 * stream-source — the classifier the editor chip and the screen share.
 * One case per shape the 2026-11-07 streaming audit named.
 */
import {
  detectStreamSource,
  isAppleWebKitUA,
  pickHlsEngine,
  reconnectDelayMs,
} from '../streaming/stream-source';
import { patchForStreamLink } from '../../template-builder/StreamingSourceField';

describe('detectStreamSource', () => {
  const cases: Array<[string, string, string, string]> = [
    // url, kind, verdict, engine
    ['https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', 'hls', 'supported', 'video'],
    ['https://cph-p2p-msl.akamaized.net/hls/live/2000341/test/master.m3u8', 'hls', 'supported', 'video'],
    ['https://example.com/live/master.m3u8?token=abc', 'hls', 'supported', 'video'],
    ['https://cdn.example.com/x/manifest(format=m3u8-aapl)', 'hls', 'supported', 'video'],
    ['https://example.com/stream.mpd', 'dash', 'unsupported', 'none'],
    ['https://example.com/promo.mp4', 'progressive', 'supported', 'video'],
    ['https://example.com/clip.webm', 'progressive', 'supported', 'video'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube', 'supported', 'embed'],
    ['https://vimeo.com/76979871', 'vimeo', 'supported', 'embed'],
    ['https://www.twitch.tv/venueos', 'twitch', 'supported', 'embed'],
    ['https://kick.com/somechannel', 'kick', 'supported', 'embed'],
    ['https://cam.example.com/mjpg/video.mjpg', 'mjpeg', 'supported', 'image'],
    ['https://cam.example.com/axis-cgi/mjpg/video.cgi', 'mjpeg', 'supported', 'image'],
    ['https://cam.example.com/snapshot.jpg', 'snapshot', 'supported', 'image'],
    ['rtsp://192.168.1.20:554/stream1', 'rtsp', 'needs-gateway', 'none'],
    ['rtmp://live.example.com/app/key', 'rtmp', 'needs-gateway', 'none'],
    ['srt://encoder.example.com:9000', 'srt', 'needs-gateway', 'none'],
    ['http://example.com/live.m3u8', 'hls', 'blocked', 'video'],
    ['https://192.168.1.50/live.m3u8', 'hls', 'blocked', 'video'],
    ['https://localhost/live.m3u8', 'hls', 'blocked', 'video'],
    ['https://stream.example.com/channel/5', 'unknown', 'probable', 'video'],
    ['javascript:alert(1)', 'unknown', 'blocked', 'none'],
    ['not a url', 'unknown', 'blocked', 'none'],
  ];
  it.each(cases)('%s → %s / %s / %s', (url, kind, verdict, engine) => {
    const s = detectStreamSource(url);
    expect([s.kind, s.verdict, s.engine]).toEqual([kind, verdict, engine]);
  });

  it('names the reason for a blocked link', () => {
    expect(detectStreamSource('http://example.com/a.m3u8').reason).toBe('insecure');
    expect(detectStreamSource('https://10.0.0.4/a.m3u8').reason).toBe('private-host');
    expect(detectStreamSource('rtsp://cam/stream').reason).toBe('gateway');
  });

  it('empty is empty, never a guess', () => {
    expect(detectStreamSource('  ').verdict).toBe('empty');
    expect(detectStreamSource(undefined).verdict).toBe('empty');
  });
});

describe('pickHlsEngine', () => {
  it('Safari / iOS → native', () => {
    expect(pickHlsEngine({ nativeHls: true, mse: true, appleWebKit: true })).toBe('native');
  });
  it('Android WebView that claims native HLS still gets hls.js (MSE)', () => {
    expect(pickHlsEngine({ nativeHls: true, mse: true, appleWebKit: false })).toBe('hlsjs');
  });
  it('Chromium / Taurus → hls.js', () => {
    expect(pickHlsEngine({ nativeHls: false, mse: true, appleWebKit: false })).toBe('hlsjs');
  });
  it('native only → native; nothing → none', () => {
    expect(pickHlsEngine({ nativeHls: true, mse: false, appleWebKit: false })).toBe('native');
    expect(pickHlsEngine({ nativeHls: false, mse: false, appleWebKit: false })).toBe('none');
  });
});

describe('isAppleWebKitUA', () => {
  it('classifies the real user agents', () => {
    expect(isAppleWebKitUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Safari/605.1.15')).toBe(true);
    expect(isAppleWebKitUA('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1')).toBe(true);
    expect(isAppleWebKitUA('Mozilla/5.0 (Linux; Android 11; GUQ) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/95.0.4638.74 Safari/537.36')).toBe(false);
    expect(isAppleWebKitUA('Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Safari/537.36')).toBe(false);
  });
});

describe('reconnectDelayMs', () => {
  const mid = () => 0.5; // zero jitter
  it('doubles from 1 s and caps at 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map((n) => reconnectDelayMs(n, mid))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  });
  it('jitters within ±20 %', () => {
    expect(reconnectDelayMs(3, () => 0)).toBe(6400);
    expect(reconnectDelayMs(3, () => 0.999999)).toBeLessThanOrEqual(9600);
  });
});

describe('patchForStreamLink', () => {
  it('a video link clears any saved channel and embed', () => {
    expect(patchForStreamLink('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8')).toEqual({
      streamingChannelId: undefined,
      channelTitle: undefined,
      playbackUrl: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
      embedUrl: undefined,
      playbackType: undefined,
    });
  });
  it('an embed link routes to embedUrl + iframe', () => {
    const p = patchForStreamLink('https://youtu.be/dQw4w9WgXcQ');
    expect(p.embedUrl).toBe('https://youtu.be/dQw4w9WgXcQ');
    expect(p.playbackType).toBe('iframe');
    expect(p.playbackUrl).toBeUndefined();
  });
});
