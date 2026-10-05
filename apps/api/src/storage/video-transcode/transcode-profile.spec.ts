/**
 * The signage transcode profile — pure policy, plus REAL-ffmpeg round trips
 * that are SKIPPED (never failed) on a runner without the ffmpeg this profile
 * needs, same contract as storage/video-poster.spec.ts.
 *
 * Every probe fixture is CUT FROM THE PRODUCER — real
 * `ffprobe -print_format json -show_format -show_streams` output, never
 * hand-written:
 *   • CAMERA_4K / PHONE_ROT / OUT_2160 below — clips generated on 2026-09-23:
 *       CAMERA_4K   a 30 s 3840×2160/30 H.264 at 80.8 Mbps + AAC (303 MB, "camera");
 *       PHONE_ROT   a 4 s 1920×1080/60 H.264 carrying a 90° display matrix;
 *       OUT_2160    this profile's own output for CAMERA_4K (62 MB).
 *   • __fixtures__/screen-compat-probes.json — 43 clips cut on 2026-10-04 by
 *     apps/api/scripts/gen-transcode-probe-fixtures.mjs (each entry carries the
 *     ffmpeg command that made it): the screen-safe files a customer really
 *     uploads (ffmpeg, an iPhone-style hardware encoder, cover art + timecode +
 *     subtitle tracks, 4K, DCI 4K, portrait, ultra-wide …) and one clip per
 *     reason `screenCompatibilityIssues` can give.
 */
import { execFileSync, spawnSync } from 'child_process';
import { promises as fs, readFileSync, statSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  assumedSourceMatrix,
  buildTranscodeArgs,
  maxLevelFor,
  MAX_LONG_EDGE,
  parsePixelAspect,
  parseProbe,
  parseRate,
  plan1080Rendition,
  planTranscode,
  progressPercent,
  progressSecondsFrom,
  RUNG_1080,
  RUNG_2160,
  rungFor,
  screenCompatibilityIssues,
  targetFps,
  transcodeTimeoutMs,
  TRANSCODE_TIMEOUT_MAX_MS,
  TRANSCODE_TIMEOUT_MIN_MS,
  verifyTranscodeOutput,
  type ProbeResult,
  type ScreenCompatibilityIssue,
  type TranscodePlan,
} from './transcode-profile';

const CAMERA_4K = {
  streams: [
    {
      index: 0,
      codec_name: 'h264',
      codec_type: 'video',
      width: 3840,
      height: 2160,
      pix_fmt: 'yuv420p',
      r_frame_rate: '30/1',
      avg_frame_rate: '30/1',
      duration: '30.000000',
      bit_rate: '80557799',
      disposition: { attached_pic: 0 },
    },
    {
      index: 1,
      codec_name: 'aac',
      codec_type: 'audio',
      r_frame_rate: '0/0',
      avg_frame_rate: '0/0',
      duration: '30.000000',
      bit_rate: '239964',
      disposition: { attached_pic: 0 },
    },
  ],
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '30.000000',
    size: '303019560',
    bit_rate: '80805216',
  },
};
const PHONE_ROT = {
  streams: [
    {
      index: 0,
      codec_name: 'h264',
      codec_type: 'video',
      width: 1920,
      height: 1080,
      pix_fmt: 'yuv420p',
      r_frame_rate: '60/1',
      avg_frame_rate: '60/1',
      duration: '4.000000',
      bit_rate: '21686220',
      side_data_list: [{ side_data_type: 'Display Matrix', rotation: 90 }],
      disposition: { attached_pic: 0 },
    },
  ],
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '4.000000',
    size: '10845046',
    bit_rate: '21690092',
  },
};
const OUT_2160 = {
  streams: [
    {
      index: 0,
      codec_name: 'h264',
      codec_type: 'video',
      width: 3840,
      height: 2160,
      pix_fmt: 'yuv420p',
      r_frame_rate: '30/1',
      avg_frame_rate: '30/1',
      duration: '30.000000',
      bit_rate: '16410642',
      disposition: { attached_pic: 0 },
    },
    {
      index: 1,
      codec_name: 'aac',
      codec_type: 'audio',
      r_frame_rate: '0/0',
      avg_frame_rate: '0/0',
      duration: '30.016000',
      bit_rate: '127957',
      disposition: { attached_pic: 0 },
    },
  ],
  format: {
    format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
    duration: '30.016000',
    size: '62053263',
    bit_rate: '16538716',
  },
};

const FIXTURES = JSON.parse(
  readFileSync(
    path.join(__dirname, '__fixtures__', 'screen-compat-probes.json'),
    'utf8',
  ),
) as { cases: Record<string, { ffmpeg: string[]; probe: unknown }> };
/** A real ffprobe document from __fixtures__/screen-compat-probes.json, parsed. */
const fx = (name: string): ProbeResult => {
  const c = FIXTURES.cases[name];
  if (!c) throw new Error(`no fixture named ${name}`);
  return parseProbe(c.probe);
};

/** A CLEAN, screen-safe 1080p30 H.264 / AAC-stereo-48k MP4 with overrides, for policy tables. */
const probe = (over: Partial<ProbeResult> = {}): ProbeResult => {
  const width = over.width ?? 1920;
  const height = over.height ?? 1080;
  return {
    hasVideo: true,
    width,
    height,
    rotation: 0,
    durationS: 60,
    videoCodec: 'h264',
    pixFmt: 'yuv420p',
    fps: 30,
    bitRate: 20_000_000,
    hasAudio: true,
    audioCodec: 'aac',
    formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
    videoProfile: 'High',
    videoLevel: 40,
    fieldOrder: 'progressive',
    pixelAspect: 1,
    colorSpace: 'bt709',
    colorTransfer: 'bt709',
    colorPrimaries: 'bt709',
    colorRange: 'tv',
    storedWidth: width,
    storedHeight: height,
    audioChannels: 2,
    audioSampleRate: 48_000,
    variableFrameRate: false,
    majorBrand: 'isom',
    ...over,
  };
};

describe('parseProbe (real ffprobe output)', () => {
  it('reads a 4K camera file', () => {
    const p = parseProbe(CAMERA_4K);
    expect(p).toMatchObject({
      hasVideo: true,
      width: 3840,
      height: 2160,
      rotation: 0,
      durationS: 30,
      videoCodec: 'h264',
      pixFmt: 'yuv420p',
      fps: 30,
      bitRate: 80805216,
      hasAudio: true,
      audioCodec: 'aac',
    });
  });

  it('applies a 90° display matrix: a phone video stored 1920×1080 PLAYS 1080×1920', () => {
    const p = parseProbe(PHONE_ROT);
    expect(p.rotation).toBe(90);
    expect([p.width, p.height]).toEqual([1080, 1920]);
    expect([p.storedWidth, p.storedHeight]).toEqual([1920, 1080]);
    expect(p.hasAudio).toBe(false);
  });

  it('ignores attached cover art and never throws on garbage', () => {
    const withArt = {
      streams: [
        {
          codec_type: 'video',
          codec_name: 'png',
          width: 600,
          height: 600,
          disposition: { attached_pic: 1 },
        },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
      format: {},
    };
    expect(parseProbe(withArt).hasVideo).toBe(false);
    for (const bad of [null, undefined, 42, 'x', { streams: 'nope' }]) {
      expect(() => parseProbe(bad)).not.toThrow();
      expect(parseProbe(bad).hasVideo).toBe(false);
    }
  });

  it('reads the screen-compatibility facts from real ffprobe output', () => {
    expect(fx('clean-h264-1080p30-aac')).toMatchObject({
      videoCodec: 'h264',
      videoProfile: 'High',
      videoLevel: 40,
      fieldOrder: 'progressive',
      pixelAspect: 1,
      variableFrameRate: false,
      audioChannels: 2,
      audioSampleRate: 48000,
      majorBrand: 'isom',
      colorSpace: null, // an untagged file says nothing — and is read as null, not as BT.709
      colorTransfer: null,
    });
    expect(fx('hevc-10bit-hdr10')).toMatchObject({
      pixFmt: 'yuv420p10le',
      colorSpace: 'bt2020nc',
      colorTransfer: 'smpte2084',
      colorPrimaries: 'bt2020',
    });
    expect(fx('hevc-10bit-hlg').colorTransfer).toBe('arib-std-b67');
    expect(fx('h264-interlaced-tff').fieldOrder).toBe('tt');
    expect(fx('h264-quicktime-mov').majorBrand).toBe('qt');
    expect(fx('h264-vfr')).toMatchObject({ variableFrameRate: true });
    expect(fx('h264-fullrange-yuvj420p')).toMatchObject({
      pixFmt: 'yuvj420p',
      colorRange: 'pc',
    });
    expect(fx('clean-h264-bt601-tagged-hd').colorSpace).toBe('smpte170m');
  });

  it('turns a 360×270 stream with pixel aspect 4:3 into the 480×270 picture it shows', () => {
    const p = fx('h264-anamorphic-sar-4-3');
    expect([p.width, p.height]).toEqual([480, 270]);
    expect([p.storedWidth, p.storedHeight]).toEqual([360, 270]);
    expect(p.pixelAspect).toBeCloseTo(4 / 3, 5);
  });

  it('turns a real 1440×1080 HD stream with pixel aspect 4:3 into the 1920×1080 picture it shows', () => {
    const p = fx('h264-anamorphic-1440x1080-sar-4-3');
    expect([p.width, p.height]).toEqual([1920, 1080]);
    expect([p.storedWidth, p.storedHeight]).toEqual([1440, 1080]);
    expect(p.pixelAspect).toBeCloseTo(4 / 3, 5);
  });

  it('a 270×480 stream with a 90° display rotation shows 480×270 (and says what is stored)', () => {
    const p = fx('h264-rotation-90');
    expect(Math.abs(p.rotation)).toBe(90);
    expect([p.width, p.height]).toEqual([480, 270]);
    expect([p.storedWidth, p.storedHeight]).toEqual([270, 480]);
  });

  it('picks the REAL video when cover art, a timecode track and a subtitle track ride along', () => {
    const p = fx('clean-h264-cover-tmcd-subtitle');
    expect(p).toMatchObject({
      hasVideo: true,
      videoCodec: 'h264',
      width: 1920,
      height: 1080,
      hasAudio: true,
      audioCodec: 'aac',
    });
    // The cover really is a second video stream in the document — the parser is what skips it.
    const doc = FIXTURES.cases['clean-h264-cover-tmcd-subtitle'].probe as {
      streams: Array<{
        codec_name: string;
        disposition: { attached_pic: number };
      }>;
    };
    expect(
      doc.streams.some(
        (st) => st.codec_name === 'mjpeg' && st.disposition.attached_pic === 1,
      ),
    ).toBe(true);
  });

  it('parsePixelAspect / parseRate: ratios, "unknown" spellings and garbage', () => {
    expect(parsePixelAspect('4:3')).toBeCloseTo(1.3333, 3);
    expect(parsePixelAspect('1:1')).toBe(1);
    expect(parsePixelAspect('1000:1001')).toBe(1); // within half a percent: square
    for (const unknown of ['0:1', 'N/A', '', undefined, null, 7, '4/3'])
      expect(parsePixelAspect(unknown)).toBe(1);
    expect(parseRate('30000/1001')).toBeCloseTo(29.97, 2);
    expect(parseRate('0/0')).toBeNull();
    expect(parseRate('30/0')).toBeNull();
  });
});

// ── screenCompatibilityIssues: one real clip per reason, and a lot of clean ones ──
const CLEAN_CLIPS = [
  'clean-h264-1080p30-aac',
  'clean-h264-videotoolbox-iphone-style',
  'clean-h264-cover-tmcd-subtitle',
  'clean-h264-no-audio',
  'clean-h264-mp3-44k',
  'clean-h264-aac-mono-48k',
  'clean-h264-baseline-360p',
  'clean-h264-ntsc-2997',
  'clean-h264-uhd-30',
  'clean-h264-dci-4096x2160-30',
  'clean-h264-portrait-1080x1920',
  'clean-h264-ultrawide-3840x1080',
  'clean-h264-untagged-hd-720p',
  'clean-h264-untagged-sd-576p',
  'clean-h264-bt601-tagged-hd',
];

describe('screenCompatibilityIssues — real ffprobe output', () => {
  it.each(CLEAN_CLIPS)('%s is screen-safe: no issue at all', (name) => {
    expect(screenCompatibilityIssues(fx(name))).toEqual([]);
  });

  it.each<[string, ScreenCompatibilityIssue[]]>([
    ['hevc-8bit-mp4', ['codec']],
    ['hevc-10bit-hdr10', ['codec', 'pixel-format', 'hdr']],
    ['hevc-10bit-hlg', ['codec', 'pixel-format', 'hdr']],
    ['vp9-webm-opus', ['codec', 'container', 'audio-codec']],
    ['av1-mp4', ['codec']],
    ['prores-mov-pcm', ['codec', 'pixel-format', 'container', 'audio-codec']],
    ['h264-high10', ['pixel-format']],
    ['h264-422', ['pixel-format']],
    ['h264-444', ['pixel-format']],
    ['h264-fullrange-yuvj420p', ['colour-range']],
    ['h264-interlaced-tff', ['interlaced']],
    ['h264-anamorphic-sar-4-3', ['pixel-aspect']],
    ['h264-anamorphic-1440x1080-sar-4-3', ['pixel-aspect']],
    ['h264-rotation-90', ['rotation']],
    ['h264-60fps', ['frame-rate']],
    ['h264-59.94fps', ['frame-rate']],
    ['h264-120fps', ['frame-rate']],
    ['h264-vfr', ['variable-frame-rate']],
    ['h264-1440p', ['oversize']],
    ['h264-8k', ['level', 'oversize']],
    ['h264-1080p-level-5.1', ['level']],
    ['h264-quicktime-mov', ['container']],
    ['h264-matroska-mkv', ['container']],
    ['h264-ac3-audio', ['audio-codec']],
    ['h264-aac-5.1', ['audio-channels']],
    ['h264-aac-96k', ['audio-sample-rate']],
    ['h264-opus-in-mp4', ['audio-codec']],
  ])('%s → %j', (name, issues) => {
    expect(screenCompatibilityIssues(fx(name))).toEqual(issues);
  });

  it('a raw elementary stream has no container, no duration — and says so', () => {
    expect(screenCompatibilityIssues(fx('raw-h264-elementary-stream'))).toEqual(
      expect.arrayContaining(['container', 'duration-unknown']),
    );
  });

  it('every issue the function can name has a real clip above that names it (nothing untested)', () => {
    const named = new Set<string>();
    for (const name of Object.keys(FIXTURES.cases))
      for (const i of screenCompatibilityIssues(fx(name))) named.add(i);
    expect([...named].sort()).toEqual(
      [
        'audio-channels',
        'audio-codec',
        'audio-sample-rate',
        'codec',
        'colour-range',
        'container',
        'duration-unknown',
        'frame-rate',
        'hdr',
        'interlaced',
        'level',
        'oversize',
        'pixel-aspect',
        'pixel-format',
        'rotation',
        'variable-frame-rate',
      ].sort(),
    );
  });

  describe('single-fact controls (everything else clean, one fact changed)', () => {
    const base = fx('clean-h264-1080p30-aac');
    const only = (over: Partial<ProbeResult>) =>
      screenCompatibilityIssues({ ...base, ...over });

    it('a file with NO audio is never flagged for audio', () => {
      const silent = fx('clean-h264-no-audio');
      expect(silent.hasAudio).toBe(false);
      expect(screenCompatibilityIssues(silent)).toEqual([]);
      // …even if the leftover audio fields were garbage
      expect(
        only({
          hasAudio: false,
          audioCodec: 'ac3',
          audioChannels: 6,
          audioSampleRate: 96_000,
        }),
      ).toEqual([]);
    });

    it('MP3 and AAC (mono or stereo, 44.1 / 48 kHz) are fine', () => {
      expect(only({ audioCodec: 'mp3', audioSampleRate: 44_100 })).toEqual([]);
      expect(only({ audioChannels: 1 })).toEqual([]);
    });

    it('the H.264 level is judged for H.264 only: HEVC / AV1 / VP9 numbers never raise `level`', () => {
      expect(screenCompatibilityIssues(fx('hevc-8bit-mp4'))).not.toContain(
        'level',
      ); // hevc level 63
      expect(screenCompatibilityIssues(fx('av1-mp4'))).not.toContain('level');
      expect(only({ videoCodec: 'hevc', videoLevel: 153 })).toEqual(['codec']);
      expect(only({ videoLevel: -99 })).toEqual([]); // ffprobe's "unknown"
      expect(only({ videoLevel: null })).toEqual([]);
    });

    it('4.2 is fine at 1080p, 5.1 is not — and 5.1 is fine at 4K', () => {
      expect(only({ videoLevel: 42 })).toEqual([]);
      expect(only({ videoLevel: 50 })).toEqual(['level']);
      expect(only({ videoLevel: 51 })).toEqual(['level']);
      const uhd = {
        width: 3840,
        height: 2160,
        storedWidth: 3840,
        storedHeight: 2160,
      };
      expect(only({ ...uhd, videoLevel: 51 })).toEqual([]);
      expect(only({ ...uhd, videoLevel: 52 })).toEqual(['level']);
    });

    it('a full-range TAG on yuv420p (HEVC / VP9 / AV1 style) is the same fault as yuvj420p', () => {
      expect(only({ colorRange: 'pc' })).toEqual(['colour-range']);
      expect(only({ colorRange: 'tv' })).toEqual([]);
    });

    it('BT.2020 primaries or a PQ / HLG transfer alone make it HDR', () => {
      expect(only({ colorPrimaries: 'bt2020' })).toEqual(['hdr']);
      expect(only({ colorTransfer: 'smpte2084' })).toEqual(['hdr']);
      expect(only({ colorTransfer: 'arib-std-b67' })).toEqual(['hdr']);
    });

    it('only the four field orders are interlaced; progressive / unknown / null are not', () => {
      for (const fieldOrder of ['tt', 'bb', 'tb', 'bt'])
        expect(only({ fieldOrder })).toEqual(['interlaced']);
      for (const fieldOrder of ['progressive', 'unknown', null])
        expect(only({ fieldOrder })).toEqual([]);
    });

    it('30 / 29.97 are fine, 30.5 still is, 31 is not', () => {
      expect(only({ fps: 29.97 })).toEqual([]);
      expect(only({ fps: 30.4 })).toEqual([]);
      expect(only({ fps: 31 })).toEqual(['frame-rate']);
    });

    it('a rotation of 180 or -90 counts, 0 / 360 does not', () => {
      expect(only({ rotation: 180 })).toEqual(['rotation']);
      expect(only({ rotation: -90 })).toEqual(['rotation']);
      expect(only({ rotation: 360 })).toEqual([]);
      expect(only({ rotation: 0 })).toEqual([]);
    });

    it('an unknown duration is its own issue, on a file that is otherwise clean', () => {
      expect(only({ durationS: null })).toEqual(['duration-unknown']);
    });

    it('a source that is not a video (no stream / no size) is not judged here', () => {
      expect(screenCompatibilityIssues(probe({ hasVideo: false }))).toEqual([]);
      expect(
        screenCompatibilityIssues(probe({ width: null, height: null })),
      ).toEqual([]);
    });

    it('a 3840×2160 source with a long edge past 4096 or a short edge past 2160 is oversize; 4096×2160 is not', () => {
      const shape = (w: number, h: number) => ({
        width: w,
        height: h,
        storedWidth: w,
        storedHeight: h,
        videoLevel: 40,
      });
      expect(only(shape(4096, 2160))).toEqual([]);
      expect(only(shape(4097, 2160))).toEqual(['oversize']);
      expect(only(shape(3840, 2161))).toEqual(['oversize']);
      expect(only(shape(2560, 1440))).toEqual(['oversize']);
      expect(only(shape(1920, 1081))).toEqual(['oversize']);
    });
  });
});

describe('maxLevelFor — the level a picture may declare', () => {
  it.each<[number, number, number]>([
    [640, 360, 42],
    [1280, 720, 42],
    [1920, 1080, 42],
    [1080, 1920, 42],
    [1920, 1088, 42],
    [2560, 1080, 51],
    [3840, 1080, 51],
    [3840, 2160, 51], // 32,400 macroblocks × 30 fps = 972,000 ≤ 983,040 (level 5.1)
    [2160, 3840, 51],
    // DCI 4K: 34,560 macroblocks × 30 fps = 1,036,800 > 983,040 — x264 writes
    // level 5.2 for it (clean-h264-dci-4096x2160-30). The first cut said 5.1,
    // so a perfectly normal DCI-4K file was "converted" and its output flagged again.
    [4096, 2160, 52],
    [4096, 2304, 52],
  ])('%i×%i → %i', (w, h, level) => {
    expect(maxLevelFor(w, h)).toBe(level);
  });

  it('never below the level x264 itself wrote for the real UHD and DCI clips', () => {
    const uhd = fx('clean-h264-uhd-30');
    const dci = fx('clean-h264-dci-4096x2160-30');
    expect(uhd.videoLevel).toBe(51);
    expect(dci.videoLevel).toBe(52);
    expect(maxLevelFor(uhd.width!, uhd.height!)).toBeGreaterThanOrEqual(
      uhd.videoLevel!,
    );
    expect(maxLevelFor(dci.width!, dci.height!)).toBeGreaterThanOrEqual(
      dci.videoLevel!,
    );
  });
});

describe('assumedSourceMatrix — what to read an UNTAGGED picture as', () => {
  it('an untagged HD file is BT.709 (real clips: 720p and 1080p)', () => {
    expect(assumedSourceMatrix(fx('clean-h264-untagged-hd-720p'))).toBe(
      'bt709',
    );
    expect(assumedSourceMatrix(fx('clean-h264-1080p30-aac'))).toBe('bt709');
    expect(assumedSourceMatrix(fx('h264-1440p'))).toBe('bt709');
  });

  it('an untagged SD file is left to swscale (BT.601) — real 720×576', () => {
    expect(
      assumedSourceMatrix(fx('clean-h264-untagged-sd-576p')),
    ).toBeUndefined();
    expect(assumedSourceMatrix(fx('h264-60fps'))).toBeUndefined(); // 480×270
  });

  it('a TAGGED matrix is never overridden — 601 on an HD picture stays 601', () => {
    expect(
      assumedSourceMatrix(fx('clean-h264-bt601-tagged-hd')),
    ).toBeUndefined();
    for (const colorSpace of ['bt709', 'smpte170m', 'bt470bg', 'bt2020nc'])
      expect(assumedSourceMatrix(probe({ colorSpace }))).toBeUndefined();
  });

  it('"unknown" / "unspecified" / empty are untagged', () => {
    for (const colorSpace of ['unknown', 'unspecified', 'reserved', '', null])
      expect(assumedSourceMatrix(probe({ colorSpace }))).toBe('bt709');
  });

  it('HDR / BT.2020 without a matrix is left alone (the real HDR10 and HLG clips are tagged)', () => {
    expect(assumedSourceMatrix(fx('hevc-10bit-hdr10'))).toBeUndefined();
    expect(
      assumedSourceMatrix(
        probe({ colorSpace: null, colorPrimaries: 'bt2020' }),
      ),
    ).toBeUndefined();
    expect(
      assumedSourceMatrix(
        probe({ colorSpace: null, colorTransfer: 'arib-std-b67' }),
      ),
    ).toBeUndefined();
  });

  it("HD is mpv's test — width ≥ 1280 or height > 576 — on the STORED frame", () => {
    const untagged = (w: number, h: number, over: Partial<ProbeResult> = {}) =>
      assumedSourceMatrix(
        probe({
          colorSpace: null,
          width: w,
          height: h,
          storedWidth: w,
          storedHeight: h,
          ...over,
        }),
      );
    expect(untagged(1280, 544)).toBe('bt709');
    expect(untagged(1024, 576)).toBeUndefined();
    expect(untagged(720, 577)).toBe('bt709');
    expect(untagged(720, 576)).toBeUndefined();
    // A rotated SD file shows 576×720 but is stored 720×576: still SD.
    expect(
      untagged(576, 720, { storedWidth: 720, storedHeight: 576, rotation: 90 }),
    ).toBeUndefined();
    // An anamorphic SD file shows 1048×576 (pixel aspect 16:11) but is stored 720×576: still SD.
    expect(
      untagged(1048, 576, {
        storedWidth: 720,
        storedHeight: 576,
        pixelAspect: 16 / 11,
      }),
    ).toBeUndefined();
  });
});

describe('targetFps — the output frame rate', () => {
  const at = (fps: number | null, extra: Partial<ProbeResult> = {}) =>
    targetFps(probe({ fps, ...extra }), 30);

  it.each<[number, number]>([
    [60, 30],
    [59.94, 29.97],
    [50, 25],
    [48, 24],
    [47.952, 23.976],
  ])(
    '%s fps is HALVED → %s (every second frame dropped, no judder)',
    (fps, want) => {
      expect(at(fps)).toBe(want);
    },
  );

  it.each<number>([30.6, 31, 35, 40, 45, 46, 72, 90, 100, 120, 240])(
    '%s fps goes to the 30 fps cap — NOT halved (the first cut turned 35 fps into 17.5 fps)',
    (fps) => {
      expect(at(fps)).toBe(30);
    },
  );

  it.each<number | null>([30, 29.97, 25, 24, 23.976, 15, 30.4, null])(
    '%s fps is kept (null = leave it as it is)',
    (fps) => {
      expect(at(fps)).toBeNull();
    },
  );

  it('a variable-rate source becomes constant at its own average, never above the cap', () => {
    expect(at(23.077, { variableFrameRate: true })).toBe(23.077);
    expect(at(29.5, { variableFrameRate: true })).toBe(29.5);
    expect(at(0.5, { variableFrameRate: true })).toBe(30); // a slideshow: a normal rate, not 0.5
    expect(at(45, { variableFrameRate: true })).toBe(30); // fast AND variable: the cap wins
    expect(targetFps(fx('h264-vfr'), 30)).toBe(23.077); // the real clip
  });

  it('the real clips', () => {
    expect(targetFps(fx('h264-60fps'), 30)).toBe(30);
    expect(targetFps(fx('h264-59.94fps'), 30)).toBe(29.97);
    expect(targetFps(fx('h264-120fps'), 30)).toBe(30);
    expect(targetFps(fx('clean-h264-ntsc-2997'), 30)).toBeNull();
  });
});

describe('planTranscode — the resolution rung is chosen from the SHORT side', () => {
  it.each<
    [
      string,
      Partial<ProbeResult>,
      {
        rung: string;
        w: number;
        h: number;
        fps: number | null;
        required: boolean;
        issues: ScreenCompatibilityIssue[];
      },
    ]
  >([
    [
      '4K camera (screen-safe H.264, far over the bitrate ceiling) → 2160p, size-only',
      { width: 3840, height: 2160, bitRate: 80e6 },
      {
        rung: '2160p',
        w: 3840,
        h: 2160,
        fps: null,
        required: false,
        issues: [],
      },
    ],
    [
      '8K → 2160p (a cap on the picture is a REQUIRED conversion)',
      { width: 7680, height: 4320, bitRate: 200e6, videoLevel: 60 },
      {
        rung: '2160p',
        w: 3840,
        h: 2160,
        fps: null,
        required: true,
        issues: ['level', 'oversize'],
      },
    ],
    [
      '4K60 → 2160p30 (H.264 2160p60 is beyond many signage SoCs)',
      { width: 3840, height: 2160, fps: 60, bitRate: 80e6, videoLevel: 52 },
      {
        rung: '2160p',
        w: 3840,
        h: 2160,
        fps: 30,
        required: true,
        issues: ['level', 'frame-rate'],
      },
    ],
    [
      'portrait 4K → 2160 short side, orientation kept',
      { width: 2160, height: 3840, bitRate: 80e6 },
      {
        rung: '2160p',
        w: 2160,
        h: 3840,
        fps: null,
        required: false,
        issues: [],
      },
    ],
    [
      '1440p → 1080p (required: bigger than its rung)',
      { width: 2560, height: 1440, bitRate: 30e6 },
      {
        rung: '1080p',
        w: 1920,
        h: 1080,
        fps: null,
        required: true,
        issues: ['oversize'],
      },
    ],
    [
      '1080p at 20 Mbps → re-encoded at 1080p, size-only',
      { width: 1920, height: 1080, bitRate: 20e6 },
      {
        rung: '1080p',
        w: 1920,
        h: 1080,
        fps: null,
        required: false,
        issues: [],
      },
    ],
    [
      '720p is never upscaled',
      { width: 1280, height: 720, bitRate: 20e6 },
      {
        rung: '1080p',
        w: 1280,
        h: 720,
        fps: null,
        required: false,
        issues: [],
      },
    ],
    [
      'odd dimensions are made even',
      { width: 1279, height: 719, bitRate: 20e6 },
      {
        rung: '1080p',
        w: 1278,
        h: 718,
        fps: null,
        required: false,
        issues: [],
      },
    ],
    [
      '240 fps slow-mo → 30 (the ceiling on BOTH rungs now; it was 60 at 1080)',
      { width: 1920, height: 1080, fps: 240, bitRate: 40e6 },
      {
        rung: '1080p',
        w: 1920,
        h: 1080,
        fps: 30,
        required: true,
        issues: ['frame-rate'],
      },
    ],
    [
      '35 fps → 30, not 17.5',
      { width: 1920, height: 1080, fps: 35, bitRate: 40e6 },
      {
        rung: '1080p',
        w: 1920,
        h: 1080,
        fps: 30,
        required: true,
        issues: ['frame-rate'],
      },
    ],
  ])('%s', (_name, over, want) => {
    const d = planTranscode(probe(over));
    expect(d.action).toBe('transcode');
    if (d.action !== 'transcode') return;
    expect(d.plan.rung.label).toBe(want.rung);
    expect([d.plan.width, d.plan.height]).toEqual([want.w, want.h]);
    expect(d.plan.fps).toBe(want.fps);
    expect(d.required).toBe(want.required);
    expect(d.issues).toEqual(want.issues);
  });

  it('the real rotated phone clip plans a PORTRAIT 1080×1920 output, and must be converted (rotation + 60 fps)', () => {
    const d = planTranscode(parseProbe(PHONE_ROT));
    expect(d.action).toBe('transcode');
    if (d.action !== 'transcode') return;
    expect([d.plan.width, d.plan.height]).toEqual([1080, 1920]);
    expect(d.required).toBe(true);
    expect(d.issues).toEqual(['rotation', 'frame-rate']);
    expect(d.plan.fps).toBe(30);
  });

  it('skips a source that already IS the profile (no CPU burnt for nothing)', () => {
    expect(planTranscode(probe({ bitRate: 5_000_000 }))).toEqual({
      action: 'skip',
      reason: 'already-optimal',
    });
  });

  it.each(CLEAN_CLIPS)(
    'a real screen-safe upload is already-optimal: %s',
    (name) => {
      expect(planTranscode(fx(name))).toEqual({
        action: 'skip',
        reason: 'already-optimal',
      });
    },
  );

  it("screen-safe but heavier than the rung's bitrate ceiling → an OPTIONAL transcode (swapped only when smaller)", () => {
    const d = planTranscode(probe({ bitRate: 9_000_000 })); // ceiling 8 Mbps × 1.1 = 8.8
    expect(d).toMatchObject({
      action: 'transcode',
      required: false,
      issues: [],
    });
    expect(planTranscode(probe({ bitRate: 8_800_000 }))).toMatchObject({
      action: 'skip',
    });
    // an unknown bitrate cannot prove "within the ceiling": still optional, never required
    expect(planTranscode(probe({ bitRate: null }))).toMatchObject({
      action: 'transcode',
      required: false,
    });
  });

  it.each<[string, Partial<ProbeResult>, ScreenCompatibilityIssue[]]>([
    [
      'a WebM/VP9 source',
      {
        videoCodec: 'vp9',
        formatName: 'matroska,webm',
        bitRate: 3e6,
        audioCodec: 'opus',
      },
      ['codec', 'container', 'audio-codec'],
    ],
    ['HEVC in MP4', { videoCodec: 'hevc', bitRate: 3e6 }, ['codec']],
    ['10-bit H.264', { pixFmt: 'yuv420p10le', bitRate: 3e6 }, ['pixel-format']],
    ['PCM audio', { audioCodec: 'pcm_s16le', bitRate: 3e6 }, ['audio-codec']],
  ])(
    'does NOT call %s already-optimal — it is REQUIRED, however small it is',
    (_name, over, issues) => {
      const d = planTranscode(probe(over));
      expect(d).toMatchObject({ action: 'transcode', required: true, issues });
    },
  );

  it('refuses sources with no video or no dimensions', () => {
    expect(planTranscode(probe({ hasVideo: false }))).toEqual({
      action: 'skip',
      reason: 'no-video-stream',
    });
    expect(planTranscode(probe({ width: null }))).toEqual({
      action: 'skip',
      reason: 'unknown-dimensions',
    });
  });

  it('real clips: the plan names the right conversion', () => {
    const plan = (name: string) => {
      const d = planTranscode(fx(name));
      if (d.action !== 'transcode') throw new Error(`${name}: ${d.reason}`);
      return d;
    };
    expect(plan('hevc-8bit-mp4')).toMatchObject({
      required: true,
      issues: ['codec'],
    });
    expect(plan('hevc-10bit-hdr10').issues).toEqual([
      'codec',
      'pixel-format',
      'hdr',
    ]);
    expect(plan('h264-interlaced-tff').plan.deinterlace).toBe(true);
    expect(plan('h264-60fps').plan.fps).toBe(30);
    expect(plan('h264-59.94fps').plan.fps).toBe(29.97);
    expect(plan('h264-vfr').plan.fps).toBe(23.077);
    expect(plan('h264-anamorphic-sar-4-3').plan).toMatchObject({
      width: 480,
      height: 270,
    });
    // The picture it SHOWS (1920×1080, square pixels) is what the plan names — never the stored 1440×1080.
    expect(plan('h264-anamorphic-1440x1080-sar-4-3').plan).toMatchObject({
      width: 1920,
      height: 1080,
    });
    expect(plan('h264-rotation-90').plan).toMatchObject({
      width: 480,
      height: 270,
    });
    expect(plan('h264-1440p').plan).toMatchObject({
      width: 1920,
      height: 1080,
    });
    expect(plan('h264-8k').plan).toMatchObject({ width: 3840, height: 2160 });
    // Not interlaced → never deinterlaced; and a plain file carries no frame-rate change.
    expect(plan('hevc-8bit-mp4').plan.deinterlace).toBe(false);
    expect(plan('hevc-8bit-mp4').plan.fps).toBeNull();
  });

  it('carries the untagged-HD matrix hint into the plan (and not for a tagged or SD source)', () => {
    const hint = (name: string) => {
      const d = planTranscode(fx(name));
      return d.action === 'transcode' ? d.plan.sourceMatrix : 'skipped';
    };
    expect(hint('h264-1440p')).toBe('bt709'); // untagged HD
    expect(hint('h264-60fps')).toBeUndefined(); // untagged SD (480×270)
    expect(hint('hevc-10bit-hdr10')).toBeUndefined(); // tagged
  });
});

describe('planTranscode — shapes (portrait, ultra-wide, DCI, strips)', () => {
  const shape = (w: number, h: number, over: Partial<ProbeResult> = {}) => {
    const d = planTranscode(
      probe({
        width: w,
        height: h,
        bitRate: 50e6,
        videoCodec: 'hevc',
        videoLevel: 153,
        ...over,
      }),
    );
    if (d.action !== 'transcode') throw new Error(`${w}×${h}: ${d.reason}`);
    return d;
  };
  const dims = (w: number, h: number) => {
    const d = shape(w, h);
    return [d.plan.width, d.plan.height, d.plan.rung.label];
  };

  it.each<[string, number, number, number, number, string]>([
    ['portrait FHD', 1080, 1920, 1080, 1920, '1080p'],
    ['portrait 4K', 2160, 3840, 2160, 3840, '2160p'],
    ['portrait 1440p', 1440, 2560, 1080, 1920, '1080p'],
    [
      'ultra-wide 3840×1080 (32:9 FHD strip) is not touched',
      3840,
      1080,
      3840,
      1080,
      '1080p',
    ],
    ['DCI 4K 4096×2160 is not touched', 4096, 2160, 4096, 2160, '2160p'],
    [
      'a 16384×256 strip is cut to the 4096 decoder edge, proportionally',
      16384,
      256,
      4096,
      64,
      '1080p',
    ],
    ['a 256×16384 tower likewise', 256, 16384, 64, 4096, '1080p'],
    [
      '7680×1080 (two FHD side by side) → 4096×576',
      7680,
      1080,
      4096,
      576,
      '1080p',
    ],
    ['8K 7680×4320 → UHD', 7680, 4320, 3840, 2160, '2160p'],
    ['DCI 8K 8192×4320 → DCI 4K', 8192, 4320, 4096, 2160, '2160p'],
    [
      '5K 5120×2880 is bounded by the short side, not the long one',
      5120,
      2880,
      3840,
      2160,
      '2160p',
    ],
    // The ultra-wide trap: short side 2160 says "2160 rung", but the 4096 edge cap
    // leaves 4096×1728 — a picture that is no longer 2160-class and, planned on the
    // 2160 rung, read as `oversize` and would be converted again forever.
    [
      '21:9 4K 5120×2160 is a 1080-rung picture once capped → 2560×1080',
      5120,
      2160,
      2560,
      1080,
      '1080p',
    ],
    ['7680×2160 (32:9 UHD) → 3840×1080', 7680, 2160, 3840, 1080, '1080p'],
    ['2:1 4320×2160 → 2160×1080', 4320, 2160, 2160, 1080, '1080p'],
    ['4096×2304 → UHD', 4096, 2304, 3840, 2160, '2160p'],
    [
      'a square 2160×2160 stays on the 2160 rung',
      2160,
      2160,
      2160,
      2160,
      '2160p',
    ],
    [
      'a square 2161×2161 is pinned to 2160, not 2158',
      2161,
      2161,
      2160,
      2160,
      '2160p',
    ],
    [
      '1921×1081 is pinned to 1080 on its short side',
      1921,
      1081,
      1918,
      1080,
      '1080p',
    ],
    ['a sliver 100×100 is only made even', 101, 99, 100, 98, '1080p'],
  ])('%s', (_name, w, h, ow, oh, rung) => {
    expect(dims(w, h)).toEqual([ow, oh, rung]);
  });

  it('PROPERTY SWEEP: for every shape the planner can see, the plan is even, never upscaled, within the rung and the 4096 edge — and the OUTPUT is itself screen-safe', () => {
    // H.264 Annex A, Table A-1: [level_idc, MaxMBPS, MaxFS].
    const LEVELS: Array<[number, number, number]> = [
      [10, 1485, 99],
      [11, 3000, 396],
      [12, 6000, 396],
      [13, 11880, 396],
      [20, 11880, 396],
      [21, 19800, 792],
      [22, 20250, 1620],
      [30, 40500, 1620],
      [31, 108000, 3600],
      [32, 216000, 5120],
      [40, 245760, 8192],
      [41, 245760, 8192],
      [42, 522240, 8704],
      [50, 589824, 22080],
      [51, 983040, 36864],
      [52, 2073600, 36864],
    ];
    const levelNeeded = (w: number, h: number, fps: number) => {
      const mbs = Math.ceil(w / 16) * Math.ceil(h / 16);
      const hit = LEVELS.find(([, mbps, fs]) => mbs <= fs && mbs * fps <= mbps);
      return hit ? hit[0] : 99;
    };
    const sizes = [
      16, 64, 100, 128, 240, 320, 360, 480, 540, 576, 640, 720, 800, 854, 960,
      1000, 1024, 1079, 1080, 1081, 1200, 1280, 1366, 1440, 1536, 1600, 1680,
      1728, 1792, 1919, 1920, 1921, 2000, 2048, 2159, 2160, 2161, 2304, 2400,
      2560, 2880, 3000, 3200, 3440, 3456, 3839, 3840, 3841, 4000, 4095, 4096,
      4097, 4200, 4320, 4608, 5119, 5120, 5121, 5760, 6000, 7680, 8192, 10240,
      16384,
    ];
    const violations: string[] = [];
    let shapes = 0;
    for (const w of sizes) {
      for (const h of sizes) {
        if (w * h > 8192 * 8192) continue;
        shapes += 1;
        const src = probe({
          width: w,
          height: h,
          bitRate: 50e6,
          videoCodec: 'hevc',
          videoLevel: 153,
        });
        const d = planTranscode(src);
        if (d.action !== 'transcode') {
          violations.push(`${w}×${h}: ${d.reason}`);
          continue;
        }
        const p = d.plan;
        const bad: string[] = [];
        if (p.width % 2 || p.height % 2) bad.push('odd');
        if (p.width > w || p.height > h) bad.push('upscaled');
        if (Math.max(p.width, p.height) > MAX_LONG_EDGE)
          bad.push('long edge past 4096');
        if (rungFor(p.width, p.height) !== p.rung)
          bad.push(
            `planned on ${p.rung.label} but reads as ${rungFor(p.width, p.height).label}`,
          );
        if (Math.min(p.width, p.height) > p.rung.shortSide)
          bad.push('short side past the rung');
        // the picture keeps its shape (two pixels of even-rounding, never more)
        if (Math.abs(p.width * h - p.height * w) > 2 * Math.max(w, h))
          bad.push('aspect ratio changed');
        // The OUTPUT, as the encoder will write it, must itself be screen-safe.
        const out = probe({
          width: p.width,
          height: p.height,
          videoLevel: levelNeeded(p.width, p.height, 30),
          bitRate: p.rung.maxrateBps,
          colorPrimaries: 'bt709',
          colorTransfer: 'bt709',
          colorSpace: 'bt709',
        });
        const issues = screenCompatibilityIssues(out);
        if (issues.length)
          bad.push(`its own output is flagged: ${issues.join('+')}`);
        if (bad.length)
          violations.push(
            `${w}×${h} → ${p.width}×${p.height}: ${bad.join(', ')}`,
          );
      }
    }
    expect(shapes).toBeGreaterThan(3500);
    expect(violations).toEqual([]);
  });
});

describe('plan1080Rendition — the decoder-sized copy', () => {
  it('is null for anything that already fits 1920×1080 (either orientation)', () => {
    expect(plan1080Rendition(probe({ width: 1920, height: 1080 }))).toBeNull();
    expect(plan1080Rendition(probe({ width: 1080, height: 1920 }))).toBeNull();
    expect(plan1080Rendition(probe({ width: 1280, height: 720 }))).toBeNull();
    expect(plan1080Rendition(probe({ hasVideo: false }))).toBeNull();
  });

  it.each<[number, number, number, number]>([
    [3840, 2160, 1920, 1080],
    [2160, 3840, 1080, 1920],
    [4096, 2160, 1920, 1012],
    [2560, 1440, 1920, 1080],
    [3840, 1080, 1920, 540],
  ])('%i×%i → %i×%i', (w, h, ow, oh) => {
    const p = plan1080Rendition(probe({ width: w, height: h }));
    expect(p).toMatchObject({ width: ow, height: oh, hasAudio: true });
    expect(p!.rung).toBe(RUNG_1080);
  });

  it('carries the 30 fps cap, and the untagged-HD matrix hint', () => {
    expect(
      plan1080Rendition(probe({ width: 3840, height: 2160, fps: 60 }))!.fps,
    ).toBe(30);
    expect(
      plan1080Rendition(probe({ width: 3840, height: 2160, fps: 35 }))!.fps,
    ).toBe(30);
    expect(
      plan1080Rendition(probe({ width: 3840, height: 2160 }))!.fps,
    ).toBeNull();
    expect(
      plan1080Rendition(probe({ width: 3840, height: 2160, colorSpace: null }))!
        .sourceMatrix,
    ).toBe('bt709');
    expect(
      plan1080Rendition(probe({ width: 3840, height: 2160 }))!.sourceMatrix,
    ).toBeUndefined();
  });
});

describe('buildTranscodeArgs — the ffmpeg contract', () => {
  const plan: TranscodePlan = {
    rung: RUNG_2160,
    width: 3840,
    height: 2160,
    fps: 30,
    hasAudio: true,
  };
  const argv = (p: TranscodePlan, sizeLimitBytes = 303019560) =>
    buildTranscodeArgs('/tmp/in.mp4', '/tmp/out.mp4', p, { sizeLimitBytes });
  const args = argv(plan);
  const after = (flag: string, a: string[] = args) => a[a.indexOf(flag) + 1];
  const SCALE_OUT =
    'out_color_matrix=bt709:out_primaries=bt709:out_transfer=bt709:out_range=tv';

  it('H.264 High, CRF 21, capped bitrate, +faststart, 4:2:0', () => {
    expect(after('-c:v')).toBe('libx264');
    expect(after('-profile:v')).toBe('high');
    expect(after('-crf')).toBe('21');
    expect(after('-maxrate')).toBe('16000000');
    expect(after('-bufsize')).toBe('32000000');
    expect(after('-movflags')).toBe('+faststart');
  });

  describe('the -vf chain — the ORDER is the contract', () => {
    it('plain: ONE colour-managed scale, square pixels, 8-bit 4:2:0', () => {
      expect(after('-vf', argv({ ...plan, fps: null }))).toBe(
        `scale=3840:2160:flags=lanczos:${SCALE_OUT},setsar=1,format=yuv420p`,
      );
    });

    it('frame-rate capped: fps comes after the scale and before the pixel format', () => {
      expect(after('-vf')).toBe(
        `scale=3840:2160:flags=lanczos:${SCALE_OUT},setsar=1,fps=30,format=yuv420p`,
      );
      expect(after('-vf', argv({ ...plan, fps: 29.97 }))).toContain(
        ',fps=29.97,',
      );
    });

    it('interlaced: deinterlace FIRST, before anything scales the fields together', () => {
      expect(
        after('-vf', argv({ ...plan, fps: null, deinterlace: true })),
      ).toBe(
        `bwdif=mode=send_frame:parity=auto:deint=all,scale=3840:2160:flags=lanczos:${SCALE_OUT},setsar=1,format=yuv420p`,
      );
      const full = after('-vf', argv({ ...plan, deinterlace: true }));
      const order = [
        'bwdif=',
        'scale=',
        'setsar=1',
        'fps=',
        'format=yuv420p',
      ].map((f) => full.indexOf(f));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('untagged HD: the source is DECLARED BT.709 on the scale (never for a tagged source)', () => {
      expect(
        after('-vf', argv({ ...plan, fps: null, sourceMatrix: 'bt709' })),
      ).toBe(
        `scale=3840:2160:flags=lanczos:in_color_matrix=bt709:${SCALE_OUT},setsar=1,format=yuv420p`,
      );
      expect(after('-vf', argv({ ...plan, fps: null }))).not.toContain(
        'in_color_matrix',
      );
    });

    it('silent output, 1080 rung', () => {
      const silent = argv({
        ...plan,
        hasAudio: false,
        fps: null,
        rung: RUNG_1080,
        width: 1920,
        height: 1080,
      });
      expect(after('-vf', silent)).toBe(
        `scale=1920:1080:flags=lanczos:${SCALE_OUT},setsar=1,format=yuv420p`,
      );
    });
  });

  it('the file SAYS what it is: BT.709, limited range, on every colour tag', () => {
    expect(after('-color_primaries')).toBe('bt709');
    expect(after('-color_trc')).toBe('bt709');
    expect(after('-colorspace')).toBe('bt709');
    expect(after('-color_range')).toBe('tv');
  });

  it('bounds the output at the given size (-fs) and caps threads', () => {
    expect(after('-fs')).toBe('303019560');
    expect(after('-fs', argv(plan, 1_234_567_890.7))).toBe('1234567890');
    expect(after('-fs', argv(plan, 0))).toBe('1'); // never 0 = "no limit"
    expect(args.filter((a) => a === '-threads')).toHaveLength(2);
    expect(after('-threads')).toBe('2');
  });

  it('drops metadata (phone GPS) and every stream but the first real video and first audio', () => {
    expect(after('-map_metadata')).toBe('-1');
    expect(args).toContain('-sn');
    expect(args).toContain('-dn');
    // capital V = real video only (an attached cover picture is not it); `?` = fine without audio
    expect(args.slice(args.indexOf('-map'), args.indexOf('-map') + 4)).toEqual([
      '-map',
      '0:V:0',
      '-map',
      '0:a:0?',
    ]);
  });

  it('audio: AAC 128k STEREO at 48 kHz when there is audio, none when there is not', () => {
    expect(after('-c:a')).toBe('aac');
    expect(after('-b:a')).toBe('128k');
    expect(after('-ac')).toBe('2');
    expect(after('-ar')).toBe('48000');
    const silent = argv({ ...plan, hasAudio: false });
    expect(silent).toContain('-an');
    expect(silent).not.toContain('-c:a');
    expect(silent).not.toContain('-ar');
  });

  it('the level is passed only when asked (the 1080p copy asks for 4.1)', () => {
    expect(args).not.toContain('-level:v');
    const withLevel = buildTranscodeArgs('i', 'o', plan, {
      sizeLimitBytes: 1,
      level: '4.1',
    });
    expect(withLevel[withLevel.indexOf('-level:v') + 1]).toBe('4.1');
  });

  it('input and output are the last-resort positional args, input after -i', () => {
    expect(after('-i')).toBe('/tmp/in.mp4');
    expect(args[args.length - 1]).toBe('/tmp/out.mp4');
  });
});

describe('transcodeTimeoutMs', () => {
  it('scales with duration inside a floor and a ceiling', () => {
    expect(transcodeTimeoutMs(10)).toBe(TRANSCODE_TIMEOUT_MIN_MS);
    expect(transcodeTimeoutMs(300)).toBe(300 * 8 * 1000); // a 5-minute clip gets 40 minutes
    expect(transcodeTimeoutMs(10 * 3600)).toBe(TRANSCODE_TIMEOUT_MAX_MS);
    expect(transcodeTimeoutMs(null)).toBe(60 * 60_000);
  });

  it('a REQUIRED conversion gets the longer allowance (a phone 4K60 HDR clip is three times the work), same floor and ceiling', () => {
    // a 5-minute clip: 40 minutes when it is only being shrunk, 100 when a screen depends on it
    expect(transcodeTimeoutMs(300, { required: false })).toBe(300 * 8 * 1000);
    expect(transcodeTimeoutMs(300, { required: true })).toBe(300 * 20 * 1000);
    expect(transcodeTimeoutMs(10, { required: true })).toBe(TRANSCODE_TIMEOUT_MIN_MS);
    expect(transcodeTimeoutMs(10 * 3600, { required: true })).toBe(TRANSCODE_TIMEOUT_MAX_MS);
    expect(transcodeTimeoutMs(null, { required: true })).toBe(60 * 60_000);
  });
});

describe('verifyTranscodeOutput — "smaller" is not enough, it must be the WHOLE video', () => {
  const source = parseProbe(CAMERA_4K);
  const plan: TranscodePlan = {
    rung: RUNG_2160,
    width: 3840,
    height: 2160,
    fps: null,
    hasAudio: true,
  };

  it('accepts the real 2160p output of the real camera file', () => {
    expect(verifyTranscodeOutput(source, parseProbe(OUT_2160), plan)).toEqual({
      ok: true,
    });
  });

  it('NEGATIVE CONTROL: rejects a truncated encode (what -fs or a kill produces) even though it is smaller', () => {
    const truncated = {
      ...OUT_2160,
      format: { ...OUT_2160.format, duration: '11.200000' },
    };
    const v = verifyTranscodeOutput(source, parseProbe(truncated), plan);
    expect(v.ok).toBe(false);
    if (!v.ok)
      expect(v.reason).toMatch(/^output-duration-11\.20s-vs-source-30\.00s$/);
  });

  it('rejects lost audio, wrong dimensions, a non-H.264 or 10-bit output, and an unknown duration', () => {
    const out = parseProbe(OUT_2160);
    expect(
      verifyTranscodeOutput(source, { ...out, hasAudio: false }, plan),
    ).toEqual({ ok: false, reason: 'output-lost-audio' });
    expect(
      verifyTranscodeOutput(source, { ...out, width: 1920, height: 1080 }, plan)
        .ok,
    ).toBe(false);
    expect(
      verifyTranscodeOutput(source, { ...out, videoCodec: 'hevc' }, plan).ok,
    ).toBe(false);
    expect(
      verifyTranscodeOutput(source, { ...out, pixFmt: 'yuv420p10le' }, plan).ok,
    ).toBe(false);
    expect(
      verifyTranscodeOutput(source, { ...out, durationS: null }, plan).ok,
    ).toBe(false);
  });

  describe('what the screen-compatibility rule adds: an output that is still not screen-safe is refused', () => {
    const out = parseProbe(OUT_2160);
    const verdict = (over: Partial<ProbeResult>, p: TranscodePlan = plan) =>
      verifyTranscodeOutput(source, { ...out, ...over }, p);

    it('a rotation tag left on the output', () => {
      expect(verdict({ rotation: 90 })).toEqual({
        ok: false,
        reason: 'output-rotation-90',
      });
      expect(verdict({ rotation: -90 })).toEqual({
        ok: false,
        reason: 'output-rotation--90',
      });
      expect(verdict({ rotation: 0 }).ok).toBe(true);
      expect(verdict({ rotation: 360 }).ok).toBe(true);
    });

    it('non-square pixels', () => {
      expect(verdict({ pixelAspect: 4 / 3 })).toEqual({
        ok: false,
        reason: 'output-pixel-aspect',
      });
      expect(verdict({ pixelAspect: 1 }).ok).toBe(true);
    });

    it('more than 30 fps (the 30.5 slack covers a 30.0x timebase)', () => {
      expect(verdict({ fps: 60 })).toEqual({
        ok: false,
        reason: 'output-fps-60.00',
      });
      expect(verdict({ fps: 31 })).toEqual({
        ok: false,
        reason: 'output-fps-31.00',
      });
      expect(verdict({ fps: 30.4 }).ok).toBe(true);
      expect(verdict({ fps: 29.97 }).ok).toBe(true);
      expect(verdict({ fps: null }).ok).toBe(true);
      // the 1080p copy and every plan share the cap
      expect(verdict({ fps: 45 }, { ...plan, rung: RUNG_1080 }).ok).toBe(false);
    });

    it('an HDR transfer (PQ / HLG / BT.2020) — the colours would be wrong on an SDR path', () => {
      expect(verdict({ colorTransfer: 'smpte2084' })).toEqual({
        ok: false,
        reason: 'output-transfer-smpte2084',
      });
      expect(verdict({ colorTransfer: 'arib-std-b67' })).toEqual({
        ok: false,
        reason: 'output-transfer-arib-std-b67',
      });
      expect(verdict({ colorTransfer: 'bt2020-10' }).ok).toBe(false);
      expect(verdict({ colorTransfer: 'bt709' }).ok).toBe(true);
      expect(verdict({ colorTransfer: null }).ok).toBe(true);
    });

    it('a variable-rate plan is verified against the cap, not against the source rate', () => {
      const vfrPlan = { ...plan, fps: 23.077 };
      expect(verdict({ fps: 23.08 }, vfrPlan).ok).toBe(true);
    });

    // The last check is the whole definition, on the real output: whatever the
    // named checks above do not cover must still stop `screen.ready: true`.
    it('anything else the screen-safe rule names — measured on the output, not assumed from the plan', () => {
      // an H.264 level above what a 3840×2160 frame may declare
      expect(verdict({ videoLevel: 52 })).toEqual({
        ok: false,
        reason: 'output-not-screen-safe-level',
      });
      expect(verdict({ videoLevel: 51 }).ok).toBe(true);
      // a QuickTime brand on a file that will be served as video/mp4
      expect(verdict({ majorBrand: 'qt' })).toEqual({
        ok: false,
        reason: 'output-not-screen-safe-container',
      });
      // full-range levels, surround audio, an audio rate players resample badly
      expect(verdict({ colorRange: 'pc' })).toEqual({
        ok: false,
        reason: 'output-not-screen-safe-colour-range',
      });
      expect(verdict({ audioChannels: 6 })).toEqual({
        ok: false,
        reason: 'output-not-screen-safe-audio-channels',
      });
      expect(verdict({ audioCodec: 'ac3', audioSampleRate: 96_000 })).toEqual({
        ok: false,
        reason: 'output-not-screen-safe-audio-codec+audio-sample-rate',
      });
      // interlaced fields, uneven frame spacing
      expect(verdict({ fieldOrder: 'tt' }).ok).toBe(false);
      expect(verdict({ variableFrameRate: true }).ok).toBe(false);
      // the named checks still answer first, with their precise reason
      expect(verdict({ rotation: 90, majorBrand: 'qt' })).toEqual({
        ok: false,
        reason: 'output-rotation-90',
      });
    });
  });
});

describe('ffmpeg -progress parsing', () => {
  it('reads out_time_us (and the misnamed out_time_ms, also microseconds)', () => {
    expect(
      progressSecondsFrom(
        'frame=10\nout_time_us=12500000\nprogress=continue\n',
      ),
    ).toBe(12.5);
    expect(progressSecondsFrom('out_time_ms=3000000\n')).toBe(3);
    expect(progressSecondsFrom('out_time=00:01:02.500000\n')).toBe(62.5);
    expect(progressSecondsFrom('frame=1\nfps=0.0\n')).toBeNull();
  });
  it('percent is clamped 0–99 (100 is only written on completion)', () => {
    expect(progressPercent(15, 30)).toBe(50);
    expect(progressPercent(31, 30)).toBe(99);
    expect(progressPercent(5, null)).toBeNull();
  });
});

// ── REAL ffmpeg round trips (skipped, with a logged reason, when the box cannot run them) ──
const ffmpegText = (args: string[]): string => {
  try {
    return execFileSync('ffmpeg', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 1 << 24,
    });
  } catch {
    return '';
  }
};
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-hide_banner', '-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const ENCODERS = hasFfmpeg ? ffmpegText(['-hide_banner', '-encoders']) : '';
const FILTERS = hasFfmpeg ? ffmpegText(['-hide_banner', '-filters']) : '';
const SCALE_HELP = hasFfmpeg
  ? ffmpegText(['-hide_banner', '-h', 'filter=scale'])
  : '';
/** `ffmpeg version 8.1.1` → 8. A git build ("N-12345-g…") has no major: it is judged by its options alone. */
const FFMPEG_MAJOR = (() => {
  const m = /ffmpeg version n?(\d+)\./i.exec(
    hasFfmpeg ? ffmpegText(['-hide_banner', '-version']) : '',
  );
  return m ? Number(m[1]) : null;
})();
const hasEncoder = (e: string) => new RegExp(`\\s${e}\\s`).test(ENCODERS);
const hasFilter = (f: string) => new RegExp(`\\s${f}\\s`).test(FILTERS);
/** ffmpeg ≥ 8: `scale` names its output transfer / primaries — the colour chain buildTranscodeArgs relies on (the Dockerfile asserts the option too). */
const hasColourChain =
  /out_transfer/.test(SCALE_HELP) &&
  /out_primaries/.test(SCALE_HELP) &&
  (FFMPEG_MAJOR === null || FFMPEG_MAJOR >= 8);
if (hasFfmpeg && !hasColourChain)
  console.warn(
    `[transcode-profile.spec] real-ffmpeg round trips SKIPPED: this ffmpeg (${FFMPEG_MAJOR ?? 'unknown version'}) is older than 8 or its scale filter has no out_transfer / out_primaries option — the production image asserts the option at build time.`,
  );
const realIt = hasFfmpeg && hasColourChain ? it : it.skip;

describe('real ffmpeg round trip', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'transcode-profile-spec-'));
  });
  afterAll(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  });

  const probeFile = (file: string) =>
    parseProbe(
      JSON.parse(
        execFileSync(
          'ffprobe',
          [
            '-v',
            'error',
            '-print_format',
            'json',
            '-show_format',
            '-show_streams',
            file,
          ],
          { encoding: 'utf8' },
        ),
      ),
    );

  realIt(
    'a noisy 1440p60 clip becomes a smaller, complete 30 fps 1080p file; a -fs-truncated one is refused',
    () => {
      const src = path.join(dir, 'src.mp4');
      execFileSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=2560x1440:rate=60,noise=alls=10:allf=t',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000',
        '-t',
        '3',
        '-map',
        '0:v',
        '-map',
        '1:a',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-b:v',
        '40M',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        src,
      ]);
      const srcBytes = statSync(src).size;
      const inProbe = probeFile(src);
      const d = planTranscode(inProbe);
      expect(d.action).toBe('transcode');
      if (d.action !== 'transcode') return;
      expect([d.plan.width, d.plan.height, d.plan.rung.label]).toEqual([
        1920,
        1080,
        '1080p',
      ]);
      expect(d.required).toBe(true); // 1440p is bigger than its rung, 60 fps is above the cap
      expect(d.issues).toEqual(['frame-rate', 'oversize']);
      expect(d.plan.fps).toBe(30);

      const out = path.join(dir, 'out.mp4');
      const run = spawnSync(
        'ffmpeg',
        buildTranscodeArgs(src, out, d.plan, { sizeLimitBytes: srcBytes }),
        { encoding: 'utf8' },
      );
      expect(run.status).toBe(0);
      expect(progressSecondsFrom(run.stdout)).not.toBeNull();
      const outBytes = statSync(out).size;
      expect(outBytes).toBeLessThan(srcBytes);
      const outProbe = probeFile(out);
      expect(verifyTranscodeOutput(inProbe, outProbe, d.plan)).toEqual({
        ok: true,
      });
      expect(outProbe.fps).toBeCloseTo(30, 1);
      expect(screenCompatibilityIssues(outProbe)).toEqual([]);

      // NEGATIVE CONTROL: bound the output at 1/10 of what it needs — ffmpeg stops
      // early and exits 0 with a short file. It is smaller; it must still be refused.
      const cut = path.join(dir, 'cut.mp4');
      const cutRun = spawnSync(
        'ffmpeg',
        buildTranscodeArgs(src, cut, d.plan, {
          sizeLimitBytes: Math.floor(outBytes / 10),
        }),
        { encoding: 'utf8' },
      );
      expect(cutRun.status).toBe(0);
      // Measured 2026-09-23 on the 4K sample: `-fs 6000000` exits 0 with a VALID
      // 3.16 s file for a 30 s source. Only the duration check stands between
      // that and a screen — and the pipeline refuses any output that reached its
      // bound (a source with no duration has nothing to compare against).
      expect(statSync(cut).size).toBeGreaterThanOrEqual(
        Math.floor(outBytes / 10),
      );
      const verdict = verifyTranscodeOutput(inProbe, probeFile(cut), d.plan);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toMatch(/^output-duration-/);
    },
    120_000,
  );

  // ── one source per kind of file the beta test threw at us ────────────────────
  //
  // Each source is ~1 s of the same pattern — a RED box in the display top-left
  // and a BLUE box in the display bottom-right on a dark-grey field — made by
  // ffmpeg in the awkward format under test. The REAL buildTranscodeArgs output
  // runs through ffmpeg, then the OUTPUT is probed (H.264, 4:2:0, square pixels,
  // upright, ≤ 30 fps, BT.709, the planned size, the same duration) and ONE frame
  // is decoded: red top-left and blue bottom-right prove the picture is upright,
  // unmirrored, and that its colours survived the conversion.
  const pattern = (w: number, h: number, rate: number | string) =>
    `color=c=0x404040:s=${w}x${h}:r=${rate},drawbox=x=0:y=0:w=iw/6:h=ih/6:color=red:t=fill,drawbox=x=iw*5/6:y=ih*5/6:w=iw/6:h=ih/6:color=blue:t=fill`;
  const video = (w: number, h: number, rate: number | string = 30) => [
    '-f',
    'lavfi',
    '-i',
    pattern(w, h, rate),
  ];
  const sine = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000'];
  /** The SDR pattern re-encoded as a real HDR signal: PQ or HLG, BT.2020, 10-bit. */
  const hdrFilter = (trc: string) =>
    `scale=out_color_matrix=bt2020nc:out_primaries=bt2020:out_transfer=${trc}:out_range=tv,format=yuv420p10le`;
  const x265 = (extra: string[] = []) => [
    '-c:v',
    'libx265',
    '-preset',
    'ultrafast',
    '-crf',
    '18',
    '-x265-params',
    'log-level=error',
    '-tag:v',
    'hvc1',
    ...extra,
  ];
  const x264 = (extra: string[] = []) => [
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    ...extra,
  ];
  const aac = ['-c:a', 'aac', '-ac', '2'];

  interface RoundTrip {
    name: string;
    ext: string;
    needs?: string[];
    needsFilters?: string[];
    /** The reasons the plan must name for this source. */
    issues: ScreenCompatibilityIssue[];
    /** ffmpeg argument lists, run in order; `out` is the file to probe. */
    make: (out: string) => string[][];
    /** The picture the plan must produce (display size). */
    size: [number, number];
    /** Output fps the plan must produce (null = the source's own). */
    fps?: number | null;
    /** A source whose colours are exact on the way through (untagged HD, SDR) must come back TIGHT, not just "red". */
    tight?: boolean;
    /** false = the source has no audio track (the output must have none either). Default true. */
    audio?: boolean;
  }
  const ROUND_TRIPS: RoundTrip[] = [
    {
      name: 'HEVC 10-bit HDR10 (PQ, BT.2020) → SDR BT.709 with the colours restored',
      ext: 'mp4',
      needs: ['libx265'],
      issues: ['codec', 'pixel-format', 'hdr'],
      size: [480, 270],
      make: (o) => [
        [
          ...video(480, 270),
          ...sine,
          '-vf',
          hdrFilter('smpte2084'),
          '-t',
          '1',
          ...x265([
            '-pix_fmt',
            'yuv420p10le',
            '-color_primaries',
            'bt2020',
            '-color_trc',
            'smpte2084',
            '-colorspace',
            'bt2020nc',
            '-color_range',
            'tv',
          ]),
          ...aac,
          o,
        ],
      ],
    },
    {
      name: 'HEVC 10-bit HLG → SDR BT.709 with the colours restored',
      ext: 'mp4',
      needs: ['libx265'],
      issues: ['codec', 'pixel-format', 'hdr'],
      size: [480, 270],
      make: (o) => [
        [
          ...video(480, 270),
          ...sine,
          '-vf',
          hdrFilter('arib-std-b67'),
          '-t',
          '1',
          ...x265([
            '-pix_fmt',
            'yuv420p10le',
            '-color_primaries',
            'bt2020',
            '-color_trc',
            'arib-std-b67',
            '-colorspace',
            'bt2020nc',
            '-color_range',
            'tv',
          ]),
          ...aac,
          o,
        ],
      ],
    },
    {
      name: 'VP9 + Opus in WebM → H.264 + AAC in MP4',
      ext: 'webm',
      needs: ['libvpx-vp9', 'libopus'],
      issues: ['codec', 'container', 'audio-codec'],
      size: [480, 270],
      make: (o) => [
        [
          ...video(480, 270),
          ...sine,
          '-t',
          '1',
          '-c:v',
          'libvpx-vp9',
          '-b:v',
          '1M',
          '-deadline',
          'realtime',
          '-cpu-used',
          '8',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'libopus',
          '-ac',
          '2',
          o,
        ],
      ],
    },
    {
      name: 'AV1 in MP4 → H.264',
      ext: 'mp4',
      needs: ['libsvtav1'],
      issues: ['codec'],
      size: [480, 270],
      make: (o) => [
        [
          ...video(480, 270),
          ...sine,
          '-t',
          '1',
          '-c:v',
          'libsvtav1',
          '-preset',
          '12',
          '-crf',
          '40',
          '-pix_fmt',
          'yuv420p',
          ...aac,
          o,
        ],
      ],
    },
    {
      name: 'ProRes 4:2:2 10-bit + PCM in a QuickTime .mov → H.264 + AAC in MP4',
      ext: 'mov',
      needs: ['prores_ks'],
      issues: ['codec', 'pixel-format', 'container', 'audio-codec'],
      size: [480, 270],
      make: (o) => [
        [
          ...video(480, 270),
          ...sine,
          '-t',
          '1',
          '-c:v',
          'prores_ks',
          '-profile:v',
          '0',
          '-pix_fmt',
          'yuv422p10le',
          '-c:a',
          'pcm_s16le',
          o,
        ],
      ],
    },
    {
      name: 'interlaced (top field first) H.264 → progressive',
      ext: 'mp4',
      needsFilters: ['bwdif'],
      issues: ['interlaced'],
      size: [480, 272],
      make: (o) => [
        [
          ...video(480, 272),
          ...sine,
          '-t',
          '1',
          ...x264(['-flags', '+ilme+ildct', '-top', '1']),
          ...aac,
          o,
        ],
      ],
    },
    {
      name: 'anamorphic 360×270 with pixel aspect 4:3 → square pixels, 480×270',
      ext: 'mp4',
      issues: ['pixel-aspect'],
      size: [480, 270],
      make: (o) => [
        [
          ...video(480, 270),
          ...sine,
          '-vf',
          'scale=360:270,setsar=4/3',
          '-t',
          '1',
          ...x264(),
          ...aac,
          o,
        ],
      ],
    },
    {
      name: 'a 90° rotation tag (stored 270×480, shown 480×270) → upright, no tag',
      ext: 'mp4',
      issues: ['rotation'],
      size: [480, 270],
      make: (o) => {
        const stored = o + '.stored.mp4';
        return [
          [
            ...video(480, 270),
            ...sine,
            '-vf',
            'transpose=1',
            '-t',
            '1',
            ...x264(),
            ...aac,
            stored,
          ],
          ['-display_rotation:v:0', '90', '-i', stored, '-c', 'copy', o],
        ];
      },
    },
    {
      name: '60 fps → 30 fps (every second frame)',
      ext: 'mp4',
      issues: ['frame-rate'],
      size: [480, 270],
      fps: 30,
      make: (o) => [
        [...video(480, 270, 60), ...sine, '-t', '1', ...x264(), ...aac, o],
      ],
    },
    {
      name: 'H.264 4:4:4 → 4:2:0',
      ext: 'mp4',
      issues: ['pixel-format'],
      size: [480, 270],
      make: (o) => [
        [
          ...video(480, 270),
          ...sine,
          '-t',
          '1',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-profile:v',
          'high444',
          '-pix_fmt',
          'yuv444p',
          ...aac,
          o,
        ],
      ],
    },
    {
      name: 'full-range (yuvj420p) → limited-range',
      ext: 'mp4',
      issues: ['colour-range'],
      size: [480, 270],
      make: (o) => [
        [
          ...video(480, 270),
          ...sine,
          '-t',
          '1',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-pix_fmt',
          'yuvj420p',
          '-color_range',
          'pc',
          ...aac,
          o,
        ],
      ],
    },
    {
      name: 'variable frame rate → constant',
      ext: 'mp4',
      issues: ['variable-frame-rate'],
      size: [480, 270],
      fps: 23.077,
      make: (o) => [
        [
          ...video(480, 270),
          ...sine,
          '-vf',
          "select='lt(mod(n,10),7)'",
          '-t',
          '1.4',
          '-fps_mode',
          'vfr',
          ...x264(),
          ...aac,
          o,
        ],
      ],
    },
    {
      // The regression the first cut shipped: swscale reads an UNTAGGED frame as
      // BT.601, so a BT.709 file with no tags came out with its red at 228.
      name: 'untagged HD (BT.709 pixels, no colour tags) at 60 fps → the SAME colours, tagged',
      ext: 'mp4',
      issues: ['frame-rate'],
      size: [1280, 720],
      fps: 30,
      tight: true,
      make: (o) => [
        [
          ...video(1280, 720, 60),
          ...sine,
          '-vf',
          'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
          '-t',
          '1',
          '-c:v',
          'libx264',
          '-preset',
          'ultrafast',
          '-x264-params',
          'colorprim=undef:transfer=undef:colormatrix=undef',
          ...aac,
          o,
        ],
      ],
    },
    {
      // 4096×2160 at 30 fps needs level 5.2; a cap of 5.1 flagged this profile's own output.
      name: 'DCI 4K HEVC 4096×2160 → H.264 level 5.2 that is itself screen-safe',
      ext: 'mp4',
      needs: ['libx265'],
      issues: ['codec'],
      size: [4096, 2160],
      audio: false,
      make: (o) => [
        [
          ...video(4096, 2160),
          '-frames:v',
          '2',
          ...x265(['-pix_fmt', 'yuv420p']),
          o,
        ],
      ],
    },
    {
      // Short side 2160 + long side 5120: the 4096 edge cap would leave 4096×1728, which reads as oversize.
      name: 'ultra-wide 5120×2160 → 2560×1080 (a 1080-rung picture), not a 4096×1728 that is "oversize"',
      ext: 'mp4',
      issues: ['level', 'oversize'],
      size: [2560, 1080],
      audio: false,
      make: (o) => [
        [
          ...video(5120, 2160),
          '-frames:v',
          '2',
          ...x264(['-level:v', '6.0']),
          o,
        ],
      ],
    },
    // ── the single-fact conversions: the container, the audio, the level, the chroma ──
    {
      name: 'QuickTime .mov (H.264 + AAC) → MP4',
      ext: 'mov',
      issues: ['container'],
      size: [480, 270],
      make: (o) => [
        [
          ...video(480, 270),
          ...sine,
          '-t',
          '1',
          ...x264(),
          ...aac,
          '-f',
          'mov',
          o,
        ],
      ],
    },
    {
      name: 'Matroska .mkv (H.264 + AAC) → MP4',
      ext: 'mkv',
      issues: ['container'],
      size: [480, 270],
      make: (o) => [
        [...video(480, 270), ...sine, '-t', '1', ...x264(), ...aac, o],
      ],
    },
    {
      name: 'AC-3 audio → AAC',
      ext: 'mp4',
      issues: ['audio-codec'],
      size: [480, 270],
      make: (o) => [
        [
          ...video(480, 270),
          ...sine,
          '-t',
          '1',
          ...x264(),
          '-c:a',
          'ac3',
          '-ac',
          '2',
          o,
        ],
      ],
    },
    {
      name: '5.1 AAC → stereo AAC',
      ext: 'mp4',
      issues: ['audio-channels'],
      size: [480, 270],
      make: (o) => [
        [
          ...video(480, 270),
          ...sine,
          '-t',
          '1',
          ...x264(),
          '-c:a',
          'aac',
          '-ac',
          '6',
          o,
        ],
      ],
    },
    {
      name: '96 kHz AAC → 48 kHz AAC',
      ext: 'mp4',
      issues: ['audio-sample-rate'],
      size: [480, 270],
      make: (o) => [
        [
          ...video(480, 270),
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=96000',
          '-t',
          '1',
          ...x264(),
          '-c:a',
          'aac',
          '-ac',
          '2',
          o,
        ],
      ],
    },
    {
      name: 'Opus audio in an MP4 → AAC',
      ext: 'mp4',
      needs: ['libopus'],
      issues: ['audio-codec'],
      size: [480, 270],
      make: (o) => [
        [
          ...video(480, 270),
          ...sine,
          '-t',
          '1',
          ...x264(),
          '-c:a',
          'libopus',
          '-ac',
          '2',
          '-strict',
          '-2',
          o,
        ],
      ],
    },
    {
      name: 'H.264 declaring level 5.1 at 1080p → a level a 1080p decoder takes',
      ext: 'mp4',
      issues: ['level'],
      size: [1920, 1080],
      make: (o) => [
        [
          ...video(1920, 1080),
          ...sine,
          '-t',
          '1',
          ...x264(['-level:v', '5.1']),
          ...aac,
          o,
        ],
      ],
    },
    {
      name: 'H.264 4:2:2 → 4:2:0',
      ext: 'mp4',
      issues: ['pixel-format'],
      size: [480, 270],
      make: (o) => [
        [
          ...video(480, 270),
          ...sine,
          '-t',
          '1',
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-profile:v',
          'high422',
          '-pix_fmt',
          'yuv422p',
          ...aac,
          o,
        ],
      ],
    },
  ];

  /** Decode the first frame at 60×60 and read the top-left and bottom-right cells. */
  const cells = (file: string) => {
    const r = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        file,
        '-frames:v',
        '1',
        '-vf',
        'scale=60:60',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        '-',
      ],
      { maxBuffer: 1 << 22 },
    );
    expect(r.status).toBe(0);
    const px = (x: number, y: number) => [
      r.stdout[(y * 60 + x) * 3],
      r.stdout[(y * 60 + x) * 3 + 1],
      r.stdout[(y * 60 + x) * 3 + 2],
    ];
    return { topLeft: px(4, 4), bottomRight: px(55, 55) };
  };

  for (const c of ROUND_TRIPS) {
    const missing = [
      ...(c.needs ?? [])
        .filter((e) => !hasEncoder(e))
        .map((e) => `encoder ${e}`),
      ...(c.needsFilters ?? [])
        .filter((f) => !hasFilter(f))
        .map((f) => `filter ${f}`),
    ];
    if (hasFfmpeg && hasColourChain && missing.length)
      console.warn(
        `[transcode-profile.spec] round trip SKIPPED — "${c.name}": this ffmpeg has no ${missing.join(', ')}`,
      );
    const run = missing.length ? it.skip : realIt;
    run(
      c.name,
      () => {
        const src = path.join(
          dir,
          `rt-${c.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.${c.ext}`,
        );
        for (const step of c.make(src)) {
          const made = spawnSync(
            'ffmpeg',
            ['-hide_banner', '-loglevel', 'error', '-y', ...step],
            { encoding: 'utf8', timeout: 50_000 },
          );
          if (made.status !== 0) throw new Error(`source: ${made.stderr}`);
        }
        const inProbe = probeFile(src);
        const decision = planTranscode(inProbe);
        expect(decision.action).toBe('transcode');
        if (decision.action !== 'transcode') return;
        expect(decision.required).toBe(true);
        expect(decision.issues).toEqual(c.issues);
        expect([decision.plan.width, decision.plan.height]).toEqual(c.size);
        if (c.fps !== undefined) expect(decision.plan.fps).toBe(c.fps);

        const out = path.join(
          dir,
          'out-' + path.basename(src, path.extname(src)) + '.mp4',
        );
        const r = spawnSync(
          'ffmpeg',
          buildTranscodeArgs(src, out, decision.plan, {
            sizeLimitBytes: 500_000_000,
          }),
          { encoding: 'utf8', timeout: 50_000 },
        );
        if (r.status !== 0) throw new Error(`transcode: ${r.stderr}`);
        const outProbe = probeFile(out);

        // The output is what the plan promised, and it is the WHOLE video.
        expect(verifyTranscodeOutput(inProbe, outProbe, decision.plan)).toEqual(
          { ok: true },
        );
        expect(outProbe).toMatchObject({
          videoCodec: 'h264',
          pixFmt: 'yuv420p',
          pixelAspect: 1,
          rotation: 0,
          width: c.size[0],
          height: c.size[1],
          colorTransfer: 'bt709',
          colorPrimaries: 'bt709',
          colorSpace: 'bt709',
          colorRange: 'tv',
        });
        if (c.audio === false) {
          expect(outProbe.hasAudio).toBe(false);
        } else {
          expect(outProbe).toMatchObject({
            hasAudio: true,
            audioCodec: 'aac',
            audioChannels: 2,
            audioSampleRate: 48000,
          });
        }
        expect(outProbe.fps!).toBeLessThanOrEqual(30.5);
        if (c.fps) expect(outProbe.fps!).toBeCloseTo(c.fps, 1);
        expect(Math.abs(outProbe.durationS! - inProbe.durationS!)).toBeLessThan(
          0.3,
        );
        // …and it is screen-safe: a converted file is never converted again.
        expect(screenCompatibilityIssues(outProbe)).toEqual([]);
        expect(planTranscode({ ...outProbe, bitRate: 1_000_000 })).toEqual({
          action: 'skip',
          reason: 'already-optimal',
        });

        // The picture: upright, unmirrored, colours intact.
        const { topLeft, bottomRight } = cells(out);
        const [tlR, tlG, tlB] = topLeft;
        const [brR, brG, brB] = bottomRight;
        expect({
          red: tlR > 150 && tlG < 100 && tlB < 100,
          blue: brB > 150 && brR < 100 && brG < 100,
        }).toEqual({ red: true, blue: true });
        if (c.tight) {
          expect(tlR).toBeGreaterThanOrEqual(244);
          expect(Math.max(tlG, tlB)).toBeLessThanOrEqual(12);
          expect(brB).toBeGreaterThanOrEqual(244);
          expect(Math.max(brR, brG)).toBeLessThanOrEqual(12);
        }
      },
      60_000,
    );
  }

  realIt(
    'cover art, a timecode track and a subtitle track are dropped: the output is one video + one audio stream',
    () => {
      const cover = path.join(dir, 'cover.jpg');
      const srt = path.join(dir, 'sub.srt');
      spawnSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=green:s=300x300',
        '-frames:v',
        '1',
        cover,
      ]);
      execFileSync('node', [
        '-e',
        `require('fs').writeFileSync(${JSON.stringify(srt)}, '1\\n00:00:00,000 --> 00:00:00,900\\nHello\\n\\n')`,
      ]);
      const base = path.join(dir, 'cts-base.mp4');
      const src = path.join(dir, 'cts-src.mp4');
      // A 60 fps file (so a conversion is required) that also carries all three extras.
      execFileSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        ...video(480, 270, 60),
        ...sine,
        '-t',
        '1',
        ...x264(),
        ...aac,
        base,
      ]);
      execFileSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        base,
        '-i',
        cover,
        '-i',
        srt,
        '-map',
        '0',
        '-map',
        '1',
        '-map',
        '2',
        '-c',
        'copy',
        '-c:s',
        'mov_text',
        '-disposition:v:1',
        'attached_pic',
        '-timecode',
        '01:00:00:00',
        '-write_tmcd',
        '1',
        src,
      ]);
      const types = (f: string) =>
        (
          JSON.parse(
            execFileSync(
              'ffprobe',
              ['-v', 'error', '-print_format', 'json', '-show_streams', f],
              { encoding: 'utf8' },
            ),
          ) as { streams: Array<{ codec_type: string }> }
        ).streams.map((st) => st.codec_type);
      expect(types(src).sort()).toEqual(
        expect.arrayContaining(['audio', 'data', 'subtitle', 'video', 'video']),
      );

      const inProbe = probeFile(src);
      const d = planTranscode(inProbe);
      expect(d).toMatchObject({
        action: 'transcode',
        required: true,
        issues: ['frame-rate'],
      });
      if (d.action !== 'transcode') return;
      const out = path.join(dir, 'cts-out.mp4');
      const r = spawnSync(
        'ffmpeg',
        buildTranscodeArgs(src, out, d.plan, { sizeLimitBytes: 500_000_000 }),
        { encoding: 'utf8' },
      );
      expect(r.stderr).toBe('');
      expect(types(out)).toEqual(['video', 'audio']);
      expect(verifyTranscodeOutput(inProbe, probeFile(out), d.plan)).toEqual({
        ok: true,
      });
    },
    60_000,
  );
});

/**
 * 2026-10-05 — MOV, AVI, MKV, WMV, MPG, 3GP and MPEG-TS uploads are accepted and
 * converted. Probing the real refused-extension corpus found two that today's
 * planner would have kept as uploaded (`already-optimal`): a 3GP of H.264 + AAC
 * (brand `3gp6` — ffprobe names the whole ISO family "mov,mp4,…") and MP4 bytes
 * saved as `.mov` (brand `isom`). Both would have stayed `.3gp` / `.mov` assets.
 * A file must be an MP4 by BRAND and by NAME before it is left alone.
 */
describe('a video ends as an MP4 — by its brand and by its name (more containers, 2026-10-05)', () => {
  const clean = fx('clean-h264-1080p30-aac');

  it('NEGATIVE CONTROL: the clean MP4 is screen-safe and already-optimal by bytes and by name', () => {
    expect(screenCompatibilityIssues(clean)).toEqual([]);
    expect(screenCompatibilityIssues(clean, { mimeType: 'video/mp4', extension: '.mp4' })).toEqual([]);
    expect(screenCompatibilityIssues(clean, { mimeType: 'video/x-m4v', extension: '.M4V' })).toEqual([]);
    expect(screenCompatibilityIssues(clean, {})).toEqual([]);
    expect(planTranscode(clean, { mimeType: 'video/mp4', extension: '.mp4' })).toEqual({
      action: 'skip',
      reason: 'already-optimal',
    });
  });

  it.each(['3gp4', '3gp5', '3gp6', '3ge6', '3g2a', 'qt', 'mj2s', 'mjp2'])(
    'major brand %j is not an MP4: a container issue, so the conversion is REQUIRED',
    (brand) => {
      const p = { ...clean, majorBrand: brand };
      expect(screenCompatibilityIssues(p)).toEqual(['container']);
      const d = planTranscode(p);
      expect(d.action === 'transcode' && d.required).toBe(true);
    },
  );

  it.each(['isom', 'iso5', 'mp41', 'mp42', 'avc1', 'm4v', 'dash'])('major brand %j is an MP4', (brand) => {
    expect(screenCompatibilityIssues({ ...clean, majorBrand: brand })).toEqual([]);
  });

  it.each<[string, string]>([
    ['video/quicktime', '.mov'],
    ['video/quicktime', '.MOV'],
    ['video/mp4', '.mov'], // MP4 type, QuickTime name
    ['video/3gpp', '.3gp'],
    ['video/x-msvideo', '.avi'],
    ['video/x-matroska', '.mkv'],
    ['video/x-ms-wmv', '.wmv'],
    ['video/mpeg', '.mpg'],
    ['video/mp2t', '.ts'],
    ['video/mp2t', '.m2ts'],
    ['video/webm', '.webm'],
  ])('MP4 bytes in a file called %s %s are converted — required, never already-optimal', (mimeType, extension) => {
    expect(screenCompatibilityIssues(clean, { mimeType, extension })).toEqual(['container']);
    const d = planTranscode(clean, { mimeType, extension });
    expect(d.action).toBe('transcode');
    if (d.action === 'transcode') {
      expect(d.required).toBe(true);
      expect(d.issues).toEqual(['container']);
      // The plan itself is the ordinary one: same size, no frame-rate change.
      expect([d.plan.width, d.plan.height, d.plan.fps]).toEqual([1920, 1080, null]);
    }
  });

  it("the output check judges the OUTPUT by its bytes — it is always written as .mp4, so the source's name never follows it", () => {
    const plan = planTranscode(clean, { mimeType: 'video/quicktime', extension: '.mov' });
    if (plan.action !== 'transcode') throw new Error('expected a transcode');
    expect(verifyTranscodeOutput(clean, clean, plan.plan)).toEqual({ ok: true });
    expect(verifyTranscodeOutput(clean, { ...clean, majorBrand: '3gp6' }, plan.plan)).toEqual({
      ok: false,
      reason: 'output-not-screen-safe-container',
    });
  });
});
