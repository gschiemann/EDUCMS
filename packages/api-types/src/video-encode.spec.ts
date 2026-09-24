/**
 * The kiosk-safe grade is a product promise ("we warn you before it stutters
 * on the wall"), so every threshold is pinned here, and so is the rule that
 * an unknown fact never counts against a file.
 */
import {
  DEFAULT_ENCODE_TARGET,
  encodeTargetFromResolutions,
  gradeVideoEncode,
  gradeVideoProcessingMeta,
  kioskSafeExportSummary,
  videoCodecLabel,
  videoEncodeFactsFromProcessingMeta,
  type VideoEncodeFacts,
  type VideoEncodeTarget,
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

describe('gradeVideoEncode — the target', () => {
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

  it('larger than the biggest screen is red in either orientation — and the target is the FLEET, not a fixed 1080p', () => {
    // Default target (no fleet read): 1920 × 1080.
    expect(codes(safe({ width: 3840, height: 2160 }))).toEqual(['red:resolution']);
    expect(codes(safe({ width: 2160, height: 3840 }))).toEqual(['red:resolution']);
    expect(codes(safe({ width: 2560, height: 1080 }))).toEqual(['red:resolution']);
    expect(gradeVideoEncode(safe({ width: 3840, height: 2160 })).reasons[0].detail).toEqual({
      width: 3840, height: 2160, panelWidth: 1920, panelHeight: 1080,
    });
    // A 4K fleet WANTS 4K files.
    const fourK: VideoEncodeTarget = { panelWidth: 3840, panelHeight: 2160, panelKnown: true };
    expect(gradeVideoEncode(safe({ width: 3840, height: 2160 }), fourK)).toEqual({ grade: 'green', reasons: [] });
    expect(gradeVideoEncode(safe({ width: 2160, height: 3840 }), fourK).grade).toBe('green');
    expect(gradeVideoEncode(safe({ width: 4096, height: 2160 }), fourK).reasons.map((r) => r.code)).toEqual(['resolution']);
  });

  it('a file that uses half the panel or less gets an INFO note on a known fleet — never a warning, never on an unknown one', () => {
    const fourK: VideoEncodeTarget = { panelWidth: 3840, panelHeight: 2160, panelKnown: true };
    const v = gradeVideoEncode(safe({ width: 1280, height: 720 }), fourK);
    expect(v.grade).toBe('green');
    expect(v.reasons).toEqual([
      { code: 'soft', severity: 'info', detail: { width: 1280, height: 720, panelWidth: 3840, panelHeight: 2160 } },
    ]);
    // 1080p on 4K is exactly half the long edge: still a note.
    expect(gradeVideoEncode(safe(), fourK).reasons.map((r) => r.code)).toEqual(['soft']);
    // 2560 × 1440 on 4K: more than half — nothing to say.
    expect(gradeVideoEncode(safe({ width: 2560, height: 1440 }), fourK).reasons).toEqual([]);
    // Unknown fleet: no screen to be soft on.
    expect(gradeVideoEncode(safe({ width: 1280, height: 720 })).reasons).toEqual([]);
  });

  it('above 30 fps is amber; 61 fps and up is red; 29.97 and 30 are fine', () => {
    expect(codes(safe({ fps: 59.94 }))).toEqual(['amber:frame-rate']);
    expect(gradeVideoEncode(safe({ fps: 59.94 })).reasons[0].detail).toEqual({ fps: 59.9 });
    expect(codes(safe({ fps: 120 }))).toEqual(['red:frame-rate']);
    expect(codes(safe({ fps: 30 }))).toEqual([]);
    expect(codes(safe({ fps: 25 }))).toEqual([]);
  });

  it('an H.264 level above 5.1 is amber; 4K30 at 5.1 is normal', () => {
    expect(codes(safe({ level: 52 }))).toEqual(['amber:level']);
    expect(gradeVideoEncode(safe({ level: 52 })).reasons[0].detail).toEqual({ level: '5.2' });
    expect(codes(safe({ level: 42 }))).toEqual([]);
    const fourK: VideoEncodeTarget = { panelWidth: 3840, panelHeight: 2160, panelKnown: true };
    expect(gradeVideoEncode(safe({ level: 51, width: 3840, height: 2160 }), fourK).reasons).toEqual([]);
    // Not H.264 → the codec reason says it all.
    expect(codes(safe({ codec: 'hevc', level: 153 }))).toEqual(['red:codec']);
  });

  it('bitrate is judged against what the file shows: 3× a high-quality encode is amber, 6× is red', () => {
    // 1080p @ 29.97: reference ≈ 6.2 Mbps → amber above ≈ 18.6, red at ≈ 37.3.
    expect(codes(safe({ bitrateKbps: 12_000 }))).toEqual([]);
    expect(codes(safe({ bitrateKbps: 18_500 }))).toEqual([]);
    expect(codes(safe({ bitrateKbps: 20_000 }))).toEqual(['amber:bitrate']);
    expect(gradeVideoEncode(safe({ bitrateKbps: 20_000 })).reasons[0].detail).toEqual({ mbps: 20, width: 1920, height: 1080, fps: 30 });
    expect(codes(safe({ bitrateKbps: 40_000 }))).toEqual(['red:bitrate']);
    // 4K @ 30 on a 4K fleet: 45 Mbps is a normal 4K bitrate.
    const fourK: VideoEncodeTarget = { panelWidth: 3840, panelHeight: 2160, panelKnown: true };
    expect(gradeVideoEncode(safe({ width: 3840, height: 2160, fps: 30, bitrateKbps: 45_000 }), fourK).reasons).toEqual([]);
    expect(gradeVideoEncode(safe({ width: 3840, height: 2160, fps: 30, bitrateKbps: 80_000 }), fourK).reasons.map((r) => r.code)).toEqual(['bitrate']);
    // 720p @ 30: the 48.8 MB / 71 s clip (≈ 5.5 Mbps) is under 3× its 2.8 Mbps reference.
    expect(codes(safe({ width: 1280, height: 720, fps: 30, bitrateKbps: 5_500 }))).toEqual([]);
    // Size unknown → absolute ceilings.
    expect(codes(safe({ width: null, height: null, bitrateKbps: 25_000 }))).toEqual(['amber:bitrate']);
    expect(codes(safe({ width: null, height: null, bitrateKbps: 120_000 }))).toEqual(['red:bitrate']);
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

  it('red reasons come first, then amber, then info — and one red makes the grade red', () => {
    const v = gradeVideoEncode(safe({ codec: 'hevc', width: 3840, height: 2160, fps: 60, fastStart: false }));
    expect(v.grade).toBe('red');
    expect(v.reasons.map((r) => `${r.severity}:${r.code}`)).toEqual([
      'red:codec', 'red:resolution', 'amber:frame-rate', 'amber:fast-start',
    ]);
    const fourK: VideoEncodeTarget = { panelWidth: 3840, panelHeight: 2160, panelKnown: true };
    const soft = gradeVideoEncode(safe({ width: 1280, height: 720, fastStart: false }), fourK);
    expect(soft.grade).toBe('amber');
    expect(soft.reasons.map((r) => `${r.severity}:${r.code}`)).toEqual(['amber:fast-start', 'info:soft']);
  });

  it('the 720p clip that stuttered on a 4K wall: H.264, 1280 × 720, index at the end — amber for the start, a note about the size', () => {
    const fourK: VideoEncodeTarget = { panelWidth: 3840, panelHeight: 2160, panelKnown: true };
    const v = gradeVideoEncode(safe({ width: 1280, height: 720, fps: 30, level: 31, fastStart: false, bitrateKbps: 5_500 }), fourK);
    expect(v.grade).toBe('amber');
    expect(v.reasons.map((r) => r.code)).toEqual(['fast-start', 'soft']);
  });

  it('a 4K export on a 4K fleet with the index at the end is amber for the start alone', () => {
    const fourK: VideoEncodeTarget = { panelWidth: 3840, panelHeight: 2160, panelKnown: true };
    const v = gradeVideoEncode(safe({ width: 3840, height: 2160, level: 51, fastStart: false, bitrateKbps: 30_000 }), fourK);
    expect(v.grade).toBe('amber');
    expect(v.reasons.map((r) => r.code)).toEqual(['fast-start']);
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

describe('encodeTargetFromResolutions — the fleet decides the size target', () => {
  it('takes the biggest panel, landscape-normalised, from whatever the screens report', () => {
    expect(encodeTargetFromResolutions(['1920x1080', '3840×2160', '1080x1920'])).toEqual({
      panelWidth: 3840, panelHeight: 2160, panelKnown: true,
    });
    expect(encodeTargetFromResolutions(['1080x1920'])).toEqual({ panelWidth: 1920, panelHeight: 1080, panelKnown: true });
    expect(encodeTargetFromResolutions(['2560 x 1440', null, undefined, 'garbage'])).toEqual({
      panelWidth: 2560, panelHeight: 1440, panelKnown: true,
    });
  });

  it('is the default, panel unknown, when no screen reports a size', () => {
    expect(encodeTargetFromResolutions([])).toBe(DEFAULT_ENCODE_TARGET);
    expect(encodeTargetFromResolutions([null, 'unknown'])).toBe(DEFAULT_ENCODE_TARGET);
    expect(DEFAULT_ENCODE_TARGET).toEqual({ panelWidth: 1920, panelHeight: 1080, panelKnown: false });
  });

  it('the export summary names the fleet size', () => {
    expect(kioskSafeExportSummary({ panelWidth: 3840, panelHeight: 2160, panelKnown: true })).toBe(
      'MP4 · H.264 · 3840 × 2160 (or 2160 × 3840 portrait) · 30 fps · 8-bit colour · fast start · AAC stereo',
    );
    expect(kioskSafeExportSummary()).toContain('1920 × 1080');
  });
});
