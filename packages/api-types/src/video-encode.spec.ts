/**
 * The kiosk-safe grade is a product promise ("we warn you before it stutters
 * on the wall"), so every threshold is pinned here, and so is the rule that
 * an unknown fact never counts against a file.
 */
import {
  gradeVideoEncode,
  gradeVideoProcessingMeta,
  videoCodecLabel,
  videoEncodeFactsFromProcessingMeta,
  type VideoEncodeFacts,
} from './video-encode';

const safe = (over: Partial<VideoEncodeFacts> = {}): VideoEncodeFacts => ({
  codec: 'h264',
  profile: 'High',
  level: 41,
  pixFmt: 'yuv420p',
  width: 1920,
  height: 1080,
  fps: 29.97,
  variableFrameRate: false,
  bitrateKbps: 5_200,
  fastStart: true,
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  audio: { codec: 'aac', channels: 2, sampleRate: 48_000 },
  ...over,
});

const codes = (facts: VideoEncodeFacts) => gradeVideoEncode(facts).reasons.map((r) => `${r.severity}:${r.code}`);

describe('gradeVideoEncode — the kiosk-safe target', () => {
  it('a textbook signage export is green with no reasons', () => {
    expect(gradeVideoEncode(safe())).toEqual({ grade: 'green', reasons: [] });
  });

  it('portrait 1080 × 1920 is inside the target', () => {
    expect(gradeVideoEncode(safe({ width: 1080, height: 1920 })).grade).toBe('green');
  });

  it('nothing probed → unknown, never green', () => {
    expect(gradeVideoEncode(null)).toEqual({ grade: 'unknown', reasons: [] });
    expect(gradeVideoEncode(undefined).grade).toBe('unknown');
  });

  it('HEVC / VP9 / AV1 are red with the human codec name', () => {
    const v = gradeVideoEncode(safe({ codec: 'hevc' }));
    expect(v.grade).toBe('red');
    expect(v.reasons[0]).toEqual({ code: 'codec', severity: 'red', detail: { codec: 'H.265 / HEVC' } });
    expect(codes(safe({ codec: 'vp9' }))).toEqual(['red:codec']);
    expect(codes(safe({ codec: 'av1' }))).toEqual(['red:codec']);
  });

  it('10-bit or 4:2:2 colour is red', () => {
    expect(codes(safe({ pixFmt: 'yuv420p10le' }))).toEqual(['red:bit-depth']);
    expect(codes(safe({ pixFmt: 'yuv422p' }))).toEqual(['red:bit-depth']);
    expect(codes(safe({ pixFmt: 'yuvj420p' }))).toEqual([]);
  });

  it('above 1080p is red in either orientation', () => {
    expect(codes(safe({ width: 3840, height: 2160 }))).toEqual(['red:resolution']);
    expect(codes(safe({ width: 2160, height: 3840 }))).toEqual(['red:resolution']);
    expect(codes(safe({ width: 2560, height: 1080 }))).toEqual(['red:resolution']);
  });

  it('above 30 fps is red; 29.97 and 30 are not', () => {
    expect(codes(safe({ fps: 59.94 }))).toEqual(['red:frame-rate']);
    expect(gradeVideoEncode(safe({ fps: 59.94 })).reasons[0].detail).toEqual({ fps: 59.9 });
    expect(codes(safe({ fps: 30 }))).toEqual([]);
    expect(codes(safe({ fps: 25 }))).toEqual([]);
  });

  it('an H.264 level above 4.1 is amber only when size and rate do not already explain it', () => {
    expect(codes(safe({ level: 42 }))).toEqual(['amber:level']);
    expect(gradeVideoEncode(safe({ level: 42 })).reasons[0].detail).toEqual({ level: '4.2' });
    // 4K at level 5.1: the resolution reason says it all.
    expect(codes(safe({ level: 51, width: 3840, height: 2160 }))).toEqual(['red:resolution']);
    // Not H.264 → the codec reason says it all.
    expect(codes(safe({ codec: 'hevc', level: 153 }))).toEqual(['red:codec']);
  });

  it('bitrate: over 12 Mbps is amber, 25 Mbps and up is red', () => {
    expect(codes(safe({ bitrateKbps: 12_000 }))).toEqual([]);
    expect(codes(safe({ bitrateKbps: 18_500 }))).toEqual(['amber:bitrate']);
    expect(gradeVideoEncode(safe({ bitrateKbps: 18_500 })).reasons[0].detail).toEqual({ mbps: 18.5 });
    expect(codes(safe({ bitrateKbps: 27_000 }))).toEqual(['red:bitrate']);
  });

  it('the index at the end of the file, a variable frame rate and odd audio are amber', () => {
    expect(codes(safe({ fastStart: false }))).toEqual(['amber:fast-start']);
    expect(codes(safe({ fastStart: null }))).toEqual([]);
    expect(codes(safe({ variableFrameRate: true }))).toEqual(['amber:variable-frame-rate']);
    expect(codes(safe({ audio: { codec: 'mp3', channels: 2, sampleRate: 48_000 } }))).toEqual(['amber:audio']);
    expect(codes(safe({ audio: { codec: 'aac', channels: 6, sampleRate: 48_000 } }))).toEqual(['amber:audio']);
    expect(codes(safe({ audio: { codec: 'aac', channels: 2, sampleRate: 96_000 } }))).toEqual(['amber:audio']);
    expect(codes(safe({ audio: null }))).toEqual([]);
  });

  it('a non-MP4 container is amber', () => {
    expect(codes(safe({ container: 'matroska,webm' }))).toEqual(['amber:container']);
    expect(gradeVideoEncode(safe({ container: 'matroska,webm' })).reasons[0].detail).toEqual({ container: 'MATROSKA' });
    expect(codes(safe({ container: null }))).toEqual([]);
  });

  it('red reasons come first, and one red makes the grade red', () => {
    const v = gradeVideoEncode(safe({ codec: 'hevc', width: 3840, height: 2160, fps: 60, fastStart: false }));
    expect(v.grade).toBe('red');
    expect(v.reasons.map((r) => r.code)).toEqual(['codec', 'resolution', 'frame-rate', 'fast-start']);
  });

  it('a Canva 4K export — H.264, 3840 × 2160, 30 fps, index at the end — reads red for the size and amber for the start', () => {
    const v = gradeVideoEncode(safe({ width: 3840, height: 2160, fastStart: false, bitrateKbps: 5_200 }));
    expect(v.grade).toBe('red');
    expect(v.reasons.map((r) => r.code)).toEqual(['resolution', 'fast-start']);
  });

  it('an unknown fact never counts against the file (the dimensions-only first probe)', () => {
    const partial: VideoEncodeFacts = {
      codec: 'h264', profile: null, level: null, pixFmt: null, width: 1920, height: 1080, fps: 30,
      variableFrameRate: null, bitrateKbps: null, fastStart: null, container: null, audio: null,
    };
    expect(gradeVideoEncode(partial)).toEqual({ grade: 'green', reasons: [] });
  });
});

describe('videoEncodeFactsFromProcessingMeta — the API shape', () => {
  it('reads the full (version 2) probe', () => {
    const facts = videoEncodeFactsFromProcessingMeta({
      originalDimensions: { w: 1080, h: 1920 },
      durationMs: 75_000,
      probe: {
        probeVersion: 2, codec: 'h264', profile: 'High', level: 41, pixFmt: 'yuv420p', fps: 30,
        nominalFps: 30, variableFrameRate: false, bitrateKbps: 5200, rotation: 90, codedWidth: 1920,
        codedHeight: 1080, container: 'mov,mp4,m4a,3gp,3g2,mj2', fastStart: true,
        audio: { codec: 'aac', channels: 2, sampleRate: 48000 },
      },
    });
    expect(facts).toEqual(safe({ width: 1080, height: 1920, fps: 30 }));
    expect(gradeVideoProcessingMeta({ originalDimensions: { w: 1080, h: 1920 }, probe: { codec: 'h264', fps: 30 } }).grade).toBe('green');
  });

  it('reads the dimensions-only (version 1) probe with the rest null', () => {
    const facts = videoEncodeFactsFromProcessingMeta({
      originalDimensions: { w: 3840, h: 2160 },
      probe: { codec: 'hevc', fps: 59.94, rotation: 0, codedWidth: 3840, codedHeight: 2160 },
    });
    expect(facts).toMatchObject({ codec: 'hevc', width: 3840, height: 2160, fps: 59.94, pixFmt: null, fastStart: null, audio: null });
    expect(gradeVideoEncode(facts).reasons.map((r) => r.code)).toEqual(['codec', 'resolution', 'frame-rate']);
  });

  it('an image row (sharp metadata, no probe) and an unprobed row are not video facts', () => {
    expect(videoEncodeFactsFromProcessingMeta(null)).toBeNull();
    expect(videoEncodeFactsFromProcessingMeta({ originalSize: 12, processedSize: 8 })).toBeNull();
    // Dimensions without a probe block do NOT grade (2026-09-24): a size alone
    // knows nothing about the codec, and "plays smoothly" must never be said
    // from one. The probe writes size and facts together, so a real video row
    // never has one without the other.
    expect(gradeVideoProcessingMeta({ originalDimensions: { w: 3840, h: 2160 } }).grade).toBe('unknown');
    expect(gradeVideoProcessingMeta('garbage').grade).toBe('unknown');
  });
});

describe('videoCodecLabel', () => {
  it('names the codecs people see in export dialogs', () => {
    expect(videoCodecLabel('h264')).toBe('H.264');
    expect(videoCodecLabel('HEVC')).toBe('H.265 / HEVC');
    expect(videoCodecLabel('prores')).toBe('ProRes');
    expect(videoCodecLabel('xyz')).toBe('XYZ');
    expect(videoCodecLabel(null)).toBe('unknown codec');
  });
});

describe('videoEncodeFactsFromProcessingMeta — dimensions alone never grade', () => {
  it('returns null for a row that carries a size but no probe block', () => {
    expect(videoEncodeFactsFromProcessingMeta({ originalDimensions: { w: 1920, h: 1080 } })).toBeNull();
    expect(gradeVideoProcessingMeta({ originalDimensions: { w: 1920, h: 1080 }, probedAt: '2026-09-24T00:00:00Z', probeFailed: 'ffprobe: moov atom not found' }).grade).toBe('unknown');
  });
});
