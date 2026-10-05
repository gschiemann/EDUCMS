#!/usr/bin/env node
/**
 * Regenerate apps/api/src/storage/video-transcode/__fixtures__/screen-compat-probes.json
 * — REAL `ffprobe -print_format json -show_format -show_streams` output, cut
 * from the producer, for the screen-compatibility specs. Never hand-edit it.
 *
 *   node apps/api/scripts/gen-transcode-probe-fixtures.mjs        # from the repo root
 *
 * Every case is a tiny clip made by the local ffmpeg (libx264 / libx265 /
 * libvpx-vp9 / libsvtav1 / prores_ks / the encoders each case names) and probed
 * by the local ffprobe; the JSON keeps only the fields transcode-profile.ts
 * reads (the same trimming the older inline fixtures use), plus the command
 * that made the clip so a reviewer can re-cut it. A case whose encoder this
 * machine lacks keeps the committed entry instead of dropping it (the
 * iPhone-style h264_videotoolbox clip can only be cut on a Mac).
 *
 * The clip content is irrelevant to a probe — only the stream facts matter —
 * so the big shapes are one or two frames long.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'apps/api/src/storage/video-transcode/__fixtures__/screen-compat-probes.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-compat-probes-'));

const ffmpegVersion = execFileSync('ffmpeg', ['-version'], { encoding: 'utf8' }).split('\n')[0];
const encoders = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
const has = (enc) => new RegExp(`\\s${enc}\\s`).test(encoders);

const pat = (w, h, r) =>
  `color=c=0x404040:s=${w}x${h}:r=${r},drawbox=x=0:y=0:w=iw/6:h=ih/6:color=red:t=fill,drawbox=x=iw*5/6:y=ih*5/6:w=iw/6:h=ih/6:color=blue:t=fill`;
const V = (w, h, r) => ['-f', 'lavfi', '-i', pat(w, h, r)];
const A = (rate = 48000) => ['-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=${rate}`];
const X264 = ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-profile:v', 'high'];
const AAC = ['-c:a', 'aac', '-ac', '2'];
const FAST = ['-movflags', '+faststart'];
const HDR = (trc) =>
  `scale=out_color_matrix=bt2020nc:out_primaries=bt2020:out_transfer=${trc}:out_range=tv,format=yuv420p10le`;
const X265_HDR = (trc) => [
  '-c:v', 'libx265', '-preset', 'ultrafast', '-crf', '18', '-pix_fmt', 'yuv420p10le',
  '-color_primaries', 'bt2020', '-color_trc', trc, '-colorspace', 'bt2020nc', '-color_range', 'tv',
  '-x265-params', 'log-level=error', '-tag:v', 'hvc1',
];

/** name → { ext, needs?: [encoders], steps: [argv, …] } — the last step's `out` is the probed file. */
const CASES = {
  // ── screen-safe: every one of these must be judged clean ────────────────────
  'clean-h264-1080p30-aac': { ext: 'mp4', steps: (o) => [[...V(1920, 1080, 30), ...A(), '-t', '1', ...X264, ...AAC, ...FAST, o]] },
  'clean-h264-videotoolbox-iphone-style': {
    ext: 'mp4', needs: ['h264_videotoolbox'],
    steps: (o) => [[...V(1920, 1080, 30), ...A(), '-t', '1', '-c:v', 'h264_videotoolbox', '-b:v', '8M', '-pix_fmt', 'yuv420p', ...AAC, ...FAST, o]],
  },
  'clean-h264-cover-tmcd-subtitle': {
    ext: 'mp4',
    steps: (o) => {
      const base = path.join(tmp, 'cts-base.mp4');
      const cover = path.join(tmp, 'cover.jpg');
      const srt = path.join(tmp, 'sub.srt');
      fs.writeFileSync(srt, '1\n00:00:00,000 --> 00:00:00,900\nHello\n\n');
      return [
        ['-f', 'lavfi', '-i', 'color=c=green:s=600x600', '-frames:v', '1', cover],
        [...V(1920, 1080, 30), ...A(), '-t', '1', ...X264, ...AAC, ...FAST, base],
        ['-i', base, '-i', cover, '-i', srt, '-map', '0', '-map', '1', '-map', '2', '-c', 'copy', '-c:s', 'mov_text',
          '-disposition:v:1', 'attached_pic', '-timecode', '01:00:00:00', '-write_tmcd', '1', o],
      ];
    },
  },
  'clean-h264-no-audio': { ext: 'mp4', steps: (o) => [[...V(1920, 1080, 30), '-t', '1', ...X264, ...FAST, o]] },
  'clean-h264-mp3-44k': { ext: 'mp4', steps: (o) => [[...V(1280, 720, 30), ...A(44100), '-t', '1', ...X264, '-c:a', 'libmp3lame', '-ac', '2', ...FAST, o]] },
  'clean-h264-aac-mono-48k': { ext: 'mp4', steps: (o) => [[...V(1280, 720, 30), ...A(), '-t', '1', ...X264, '-c:a', 'aac', ...FAST, o]] },
  'clean-h264-baseline-360p': { ext: 'mp4', steps: (o) => [[...V(640, 360, 30), ...A(), '-t', '1', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-profile:v', 'baseline', ...AAC, ...FAST, o]] },
  'clean-h264-ntsc-2997': { ext: 'mp4', steps: (o) => [[...V(1280, 720, '30000/1001'), ...A(), '-t', '1', ...X264, ...AAC, ...FAST, o]] },
  'clean-h264-uhd-30': { ext: 'mp4', steps: (o) => [[...V(3840, 2160, 30), '-frames:v', '2', ...X264, ...FAST, o]] },
  'clean-h264-dci-4096x2160-30': { ext: 'mp4', steps: (o) => [[...V(4096, 2160, 30), '-frames:v', '2', ...X264, ...FAST, o]] },
  'clean-h264-portrait-1080x1920': { ext: 'mp4', steps: (o) => [[...V(1080, 1920, 30), '-frames:v', '3', ...X264, ...FAST, o]] },
  'clean-h264-ultrawide-3840x1080': { ext: 'mp4', steps: (o) => [[...V(3840, 1080, 30), '-frames:v', '3', ...X264, ...FAST, o]] },
  'clean-h264-untagged-hd-720p': {
    ext: 'mp4',
    steps: (o) => [[...V(1280, 720, 30), '-t', '1', ...X264, '-x264-params', 'colorprim=undef:transfer=undef:colormatrix=undef', ...FAST, o]],
  },
  'clean-h264-untagged-sd-576p': {
    ext: 'mp4',
    steps: (o) => [[...V(720, 576, 25), '-t', '1', ...X264, '-x264-params', 'colorprim=undef:transfer=undef:colormatrix=undef', ...FAST, o]],
  },
  'clean-h264-bt601-tagged-hd': {
    ext: 'mp4',
    steps: (o) => [[...V(1280, 720, 30), '-t', '1', ...X264, '-colorspace', 'smpte170m', '-color_primaries', 'smpte170m', '-color_trc', 'smpte170m', ...FAST, o]],
  },

  // ── not screen-safe: the issue each one names ────────────────────────────────
  'hevc-8bit-mp4': { ext: 'mp4', needs: ['libx265'], steps: (o) => [[...V(480, 270, 30), ...A(), '-t', '1', '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-x265-params', 'log-level=error', '-tag:v', 'hvc1', ...AAC, ...FAST, o]] },
  'hevc-10bit-hdr10': { ext: 'mp4', needs: ['libx265'], steps: (o) => [[...V(480, 270, 30), ...A(), '-vf', HDR('smpte2084'), '-t', '1', ...X265_HDR('smpte2084'), ...AAC, ...FAST, o]] },
  'hevc-10bit-hlg': { ext: 'mp4', needs: ['libx265'], steps: (o) => [[...V(480, 270, 30), ...A(), '-vf', HDR('arib-std-b67'), '-t', '1', ...X265_HDR('arib-std-b67'), ...AAC, ...FAST, o]] },
  'vp9-webm-opus': { ext: 'webm', needs: ['libvpx-vp9', 'libopus'], steps: (o) => [[...V(480, 270, 30), ...A(), '-t', '1', '-c:v', 'libvpx-vp9', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-ac', '2', o]] },
  'av1-mp4': { ext: 'mp4', needs: ['libsvtav1'], steps: (o) => [[...V(480, 270, 30), ...A(), '-t', '1', '-c:v', 'libsvtav1', '-preset', '12', '-crf', '40', '-pix_fmt', 'yuv420p', ...AAC, ...FAST, o]] },
  'prores-mov-pcm': { ext: 'mov', needs: ['prores_ks'], steps: (o) => [[...V(480, 270, 30), ...A(), '-t', '1', '-c:v', 'prores_ks', '-profile:v', '0', '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s16le', o]] },
  'h264-high10': { ext: 'mp4', steps: (o) => [[...V(480, 270, 30), ...A(), '-t', '1', '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high10', '-pix_fmt', 'yuv420p10le', ...AAC, ...FAST, o]] },
  'h264-422': { ext: 'mp4', steps: (o) => [[...V(480, 270, 30), ...A(), '-t', '1', '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high422', '-pix_fmt', 'yuv422p', ...AAC, ...FAST, o]] },
  'h264-444': { ext: 'mp4', steps: (o) => [[...V(480, 270, 30), ...A(), '-t', '1', '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high444', '-pix_fmt', 'yuv444p', ...AAC, ...FAST, o]] },
  'h264-fullrange-yuvj420p': { ext: 'mp4', steps: (o) => [[...V(480, 270, 30), ...A(), '-t', '1', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuvj420p', '-color_range', 'pc', ...AAC, ...FAST, o]] },
  'h264-interlaced-tff': { ext: 'mp4', steps: (o) => [[...V(480, 272, 30), ...A(), '-t', '1', '-c:v', 'libx264', '-preset', 'veryfast', '-flags', '+ilme+ildct', '-top', '1', '-pix_fmt', 'yuv420p', ...AAC, ...FAST, o]] },
  'h264-anamorphic-sar-4-3': { ext: 'mp4', steps: (o) => [[...V(480, 270, 30), ...A(), '-vf', 'scale=360:270,setsar=4/3', '-t', '1', ...X264, ...AAC, ...FAST, o]] },
  'h264-anamorphic-1440x1080-sar-4-3': { ext: 'mp4', steps: (o) => [[...V(1920, 1080, 30), '-vf', 'scale=1440:1080,setsar=4/3', '-frames:v', '3', ...X264, ...FAST, o]] },
  'h264-rotation-90': {
    ext: 'mp4',
    steps: (o) => {
      const stored = path.join(tmp, 'rot-stored.mp4');
      return [
        [...V(480, 270, 30), ...A(), '-vf', 'transpose=1', '-t', '1', ...X264, ...AAC, ...FAST, stored],
        ['-display_rotation:v:0', '90', '-i', stored, '-c', 'copy', o],
      ];
    },
  },
  'h264-60fps': { ext: 'mp4', steps: (o) => [[...V(480, 270, 60), ...A(), '-t', '1', ...X264, ...AAC, ...FAST, o]] },
  'h264-59.94fps': { ext: 'mp4', steps: (o) => [[...V(480, 270, '60000/1001'), ...A(), '-t', '1', ...X264, ...AAC, ...FAST, o]] },
  'h264-120fps': { ext: 'mp4', steps: (o) => [[...V(320, 180, 120), '-t', '1', ...X264, ...FAST, o]] },
  'h264-vfr': { ext: 'mp4', steps: (o) => [[...V(480, 270, 30), ...A(), '-vf', "select='lt(mod(n,10),7)'", '-t', '1.4', '-fps_mode', 'vfr', ...X264, ...AAC, ...FAST, o]] },
  'h264-1440p': { ext: 'mp4', steps: (o) => [[...V(2560, 1440, 30), '-frames:v', '3', ...X264, ...FAST, o]] },
  'h264-8k': { ext: 'mp4', steps: (o) => [[...V(7680, 4320, 30), '-frames:v', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '40', '-pix_fmt', 'yuv420p', ...FAST, o]] },
  'h264-1080p-level-5.1': { ext: 'mp4', steps: (o) => [[...V(1920, 1080, 30), ...A(), '-t', '1', ...X264, '-level:v', '5.1', ...AAC, ...FAST, o]] },
  'h264-quicktime-mov': { ext: 'mov', steps: (o) => [[...V(1280, 720, 30), ...A(), '-t', '1', ...X264, ...AAC, '-f', 'mov', o]] },
  'h264-matroska-mkv': { ext: 'mkv', steps: (o) => [[...V(1280, 720, 30), ...A(), '-t', '1', ...X264, ...AAC, o]] },
  'h264-ac3-audio': { ext: 'mp4', steps: (o) => [[...V(1280, 720, 30), ...A(), '-t', '1', ...X264, '-c:a', 'ac3', '-ac', '2', ...FAST, o]] },
  'h264-aac-5.1': { ext: 'mp4', steps: (o) => [[...V(1280, 720, 30), ...A(), '-t', '1', ...X264, '-c:a', 'aac', '-ac', '6', ...FAST, o]] },
  'h264-aac-96k': { ext: 'mp4', steps: (o) => [[...V(1280, 720, 30), ...A(96000), '-t', '1', ...X264, '-c:a', 'aac', '-ac', '2', ...FAST, o]] },
  'h264-opus-in-mp4': { ext: 'mp4', needs: ['libopus'], steps: (o) => [[...V(1280, 720, 30), ...A(), '-t', '1', ...X264, '-c:a', 'libopus', '-ac', '2', '-strict', '-2', ...FAST, o]] },
  'raw-h264-elementary-stream': { ext: 'h264', steps: (o) => [[...V(480, 270, 30), '-t', '1', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-f', 'h264', o]] },
};

const STREAM_KEYS = [
  'index', 'codec_name', 'codec_type', 'profile', 'width', 'height', 'sample_aspect_ratio', 'display_aspect_ratio',
  'pix_fmt', 'level', 'color_range', 'color_space', 'color_transfer', 'color_primaries', 'field_order',
  'r_frame_rate', 'avg_frame_rate', 'duration', 'bit_rate', 'sample_rate', 'channels', 'channel_layout',
];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));

/** Keep only what transcode-profile.ts#parseProbe reads (and a few fields a reviewer wants to see). */
function trim(doc) {
  return {
    streams: (doc.streams || []).map((s) => ({
      ...pick(s, STREAM_KEYS),
      disposition: { attached_pic: s.disposition?.attached_pic ?? 0 },
      ...(s.side_data_list ? { side_data_list: s.side_data_list.map((d) => pick(d, ['side_data_type', 'rotation'])) } : {}),
      ...(s.tags?.rotate !== undefined ? { tags: { rotate: s.tags.rotate } } : {}),
    })),
    format: {
      ...pick(doc.format, ['format_name', 'duration', 'size', 'bit_rate']),
      ...(doc.format?.tags?.major_brand !== undefined ? { tags: { major_brand: doc.format.tags.major_brand } } : {}),
    },
  };
}

/** The command as a human would type it — an argument with a shell-special character is quoted. */
const commandLine = (argv, out, ext) =>
  'ffmpeg ' +
  argv
    .map((a) => (a === out ? `out.${ext}` : a.startsWith(tmp) ? path.relative(tmp, a) : /[\s()'",;=:]/.test(a) && !a.startsWith('-') ? `'${a}'` : a))
    .join(' ');

const run = (argv) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg ${argv.join(' ')}\n${r.stderr.slice(0, 800)}`);
};

let previous = {};
try {
  previous = JSON.parse(fs.readFileSync(OUT, 'utf8')).cases ?? {};
} catch {
  /* first run */
}

const cases = {};
let kept = 0;
for (const [name, def] of Object.entries(CASES)) {
  const missing = (def.needs ?? []).filter((e) => !has(e));
  if (missing.length) {
    if (previous[name]) {
      cases[name] = previous[name];
      kept += 1;
      console.warn(`kept the committed ${name} (this ffmpeg has no ${missing.join(', ')})`);
    } else {
      console.warn(`SKIPPED ${name}: this ffmpeg has no ${missing.join(', ')} and there is no committed entry`);
    }
    continue;
  }
  const out = path.join(tmp, `${name}.${def.ext}`);
  const steps = def.steps(out);
  for (const argv of steps) run(argv);
  const doc = JSON.parse(
    execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', out], { encoding: 'utf8' }),
  );
  cases[name] = { ffmpeg: steps.map((argv) => commandLine(argv, out, def.ext)), probe: trim(doc) };
  console.log(`cut ${name}`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      _meta: {
        about: 'Real ffprobe output (trimmed to the fields transcode-profile.ts reads). Regenerate with apps/api/scripts/gen-transcode-probe-fixtures.mjs — never hand-edit.',
        ffmpeg: ffmpegVersion,
      },
      cases,
    },
    null,
    1,
  ) + '\n',
);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${Object.keys(cases).length} cases (${kept} kept from the committed file) → ${path.relative(ROOT, OUT)}`);
