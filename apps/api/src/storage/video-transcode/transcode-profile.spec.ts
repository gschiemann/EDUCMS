/**
 * The signage transcode profile — pure policy, plus ONE real-ffmpeg round trip
 * that is SKIPPED (never failed) on a runner without ffmpeg, same contract as
 * storage/video-poster.spec.ts.
 *
 * The three probe fixtures below are CUT FROM THE PRODUCER: real
 * `ffprobe -print_format json -show_format -show_streams` output (trimmed to
 * the fields the parser reads) of clips generated on 2026-09-23 —
 *   CAMERA_4K   a 30 s 3840×2160/30 H.264 at 80.8 Mbps + AAC (303 MB, "camera");
 *   PHONE_ROT   a 4 s 1920×1080/60 H.264 carrying a 90° display matrix;
 *   OUT_2160    this profile's own output for CAMERA_4K (62 MB).
 */
import { execFileSync, spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildTranscodeArgs,
  parseProbe,
  planTranscode,
  progressPercent,
  progressSecondsFrom,
  RUNG_1080,
  RUNG_2160,
  transcodeTimeoutMs,
  TRANSCODE_TIMEOUT_MAX_MS,
  TRANSCODE_TIMEOUT_MIN_MS,
  verifyTranscodeOutput,
  type ProbeResult,
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

/** A probe with overrides, for policy tables. */
const probe = (over: Partial<ProbeResult> = {}): ProbeResult => ({
  hasVideo: true,
  width: 1920,
  height: 1080,
  rotation: 0,
  durationS: 60,
  videoCodec: 'h264',
  pixFmt: 'yuv420p',
  fps: 30,
  bitRate: 20_000_000,
  hasAudio: true,
  audioCodec: 'aac',
  formatName: 'mov,mp4,m4a,3gp,3g2,mj2',
  ...over,
});

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
});

describe('planTranscode — the resolution rung is chosen from the SHORT side', () => {
  it.each<
    [
      string,
      Partial<ProbeResult>,
      { rung: string; w: number; h: number; fps: number | null },
    ]
  >([
    [
      '4K camera → 2160p (never downscaled below its rung)',
      { width: 3840, height: 2160, bitRate: 80e6 },
      { rung: '2160p', w: 3840, h: 2160, fps: null },
    ],
    [
      '8K → 2160p',
      { width: 7680, height: 4320, bitRate: 200e6 },
      { rung: '2160p', w: 3840, h: 2160, fps: null },
    ],
    [
      '4K60 → 2160p30 (H.264 2160p60 is beyond many signage SoCs)',
      { width: 3840, height: 2160, fps: 60, bitRate: 80e6 },
      { rung: '2160p', w: 3840, h: 2160, fps: 30 },
    ],
    [
      'portrait 4K → 2160 short side, orientation kept',
      { width: 2160, height: 3840, bitRate: 80e6 },
      { rung: '2160p', w: 2160, h: 3840, fps: null },
    ],
    [
      '1440p → 1080p',
      { width: 2560, height: 1440, bitRate: 30e6 },
      { rung: '1080p', w: 1920, h: 1080, fps: null },
    ],
    [
      '1080p at 20 Mbps → re-encoded at 1080p',
      { width: 1920, height: 1080, bitRate: 20e6 },
      { rung: '1080p', w: 1920, h: 1080, fps: null },
    ],
    [
      '720p is never upscaled',
      { width: 1280, height: 720, bitRate: 20e6 },
      { rung: '1080p', w: 1280, h: 720, fps: null },
    ],
    [
      'odd dimensions are made even',
      { width: 1279, height: 719, bitRate: 20e6 },
      { rung: '1080p', w: 1278, h: 718, fps: null },
    ],
    [
      '240 fps slow-mo → 60',
      { width: 1920, height: 1080, fps: 240, bitRate: 40e6 },
      { rung: '1080p', w: 1920, h: 1080, fps: 60 },
    ],
  ])('%s', (_name, over, want) => {
    const d = planTranscode(probe(over));
    expect(d.action).toBe('transcode');
    if (d.action !== 'transcode') return;
    expect(d.plan.rung.label).toBe(want.rung);
    expect([d.plan.width, d.plan.height]).toEqual([want.w, want.h]);
    expect(d.plan.fps).toBe(want.fps);
  });

  it('the real rotated phone clip plans a PORTRAIT 1080×1920 output', () => {
    const d = planTranscode(parseProbe(PHONE_ROT));
    expect(d.action).toBe('transcode');
    if (d.action === 'transcode')
      expect([d.plan.width, d.plan.height]).toEqual([1080, 1920]);
  });

  it('skips a source that already IS the profile (no CPU burnt for nothing)', () => {
    expect(planTranscode(probe({ bitRate: 5_000_000 }))).toEqual({
      action: 'skip',
      reason: 'already-optimal',
    });
  });

  it.each<[string, Partial<ProbeResult>]>([
    [
      'a WebM/VP9 source',
      { videoCodec: 'vp9', formatName: 'matroska,webm', bitRate: 3e6 },
    ],
    ['HEVC in MP4', { videoCodec: 'hevc', bitRate: 3e6 }],
    ['10-bit H.264', { pixFmt: 'yuv420p10le', bitRate: 3e6 }],
    ['PCM audio', { audioCodec: 'pcm_s16le', bitRate: 3e6 }],
    ['an unknown bitrate', { bitRate: null }],
  ])('does NOT call %s already-optimal', (_name, over) => {
    expect(planTranscode(probe(over)).action).toBe('transcode');
  });

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
});

describe('buildTranscodeArgs — the ffmpeg contract', () => {
  const plan: TranscodePlan = {
    rung: RUNG_2160,
    width: 3840,
    height: 2160,
    fps: 30,
    hasAudio: true,
  };
  const args = buildTranscodeArgs('/tmp/in.mp4', '/tmp/out.mp4', plan, {
    sizeLimitBytes: 303019560,
  });
  const after = (flag: string) => args[args.indexOf(flag) + 1];

  it('H.264 High, CRF 21, capped bitrate, +faststart, 4:2:0', () => {
    expect(after('-c:v')).toBe('libx264');
    expect(after('-profile:v')).toBe('high');
    expect(after('-crf')).toBe('21');
    expect(after('-maxrate')).toBe('16000000');
    expect(after('-bufsize')).toBe('32000000');
    expect(after('-movflags')).toBe('+faststart');
    expect(after('-vf')).toBe(
      'scale=3840:2160:flags=lanczos,fps=30,format=yuv420p',
    );
  });

  it('bounds the output at the SOURCE size (-fs) and caps threads', () => {
    expect(after('-fs')).toBe('303019560');
    expect(args.filter((a) => a === '-threads')).toHaveLength(2);
    expect(after('-threads')).toBe('2');
  });

  it('drops metadata (phone GPS) and extra streams; AAC 128k stereo when there is audio', () => {
    expect(after('-map_metadata')).toBe('-1');
    expect(args).toContain('-sn');
    expect(args).toContain('-dn');
    expect(after('-c:a')).toBe('aac');
    expect(after('-b:a')).toBe('128k');
    const silent = buildTranscodeArgs(
      'i',
      'o',
      {
        ...plan,
        hasAudio: false,
        fps: null,
        rung: RUNG_1080,
        width: 1920,
        height: 1080,
      },
      { sizeLimitBytes: 1 },
    );
    expect(silent).toContain('-an');
    expect(silent).not.toContain('-c:a');
    expect(silent[silent.indexOf('-vf') + 1]).toBe(
      'scale=1920:1080:flags=lanczos,format=yuv420p',
    );
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

// ── One REAL round trip (skipped when the box has no ffmpeg/ffprobe) ────────
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-hide_banner', '-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const realIt = hasFfmpeg ? it : it.skip;

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
    'a noisy 1440p60 clip becomes a smaller, complete 1080p file; a -fs-truncated one is refused',
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
      const srcBytes = (require('fs') as typeof import('fs')).statSync(
        src,
      ).size;
      const inProbe = probeFile(src);
      const d = planTranscode(inProbe);
      expect(d.action).toBe('transcode');
      if (d.action !== 'transcode') return;
      expect([d.plan.width, d.plan.height, d.plan.rung.label]).toEqual([
        1920,
        1080,
        '1080p',
      ]);

      const out = path.join(dir, 'out.mp4');
      const run = spawnSync(
        'ffmpeg',
        buildTranscodeArgs(src, out, d.plan, { sizeLimitBytes: srcBytes }),
        { encoding: 'utf8' },
      );
      expect(run.status).toBe(0);
      expect(progressSecondsFrom(run.stdout)).not.toBeNull();
      const outBytes = (require('fs') as typeof import('fs')).statSync(
        out,
      ).size;
      expect(outBytes).toBeLessThan(srcBytes);
      expect(verifyTranscodeOutput(inProbe, probeFile(out), d.plan)).toEqual({
        ok: true,
      });

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
      // that and a screen.
      const verdict = verifyTranscodeOutput(inProbe, probeFile(cut), d.plan);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) expect(verdict.reason).toMatch(/^output-duration-/);
    },
    120_000,
  );
});
