/**
 * video-probe.spec.ts — the ffprobe reader, probe version 2.
 *
 * WHY THE SPAWN IS FAKED. The production image hard-fails its build without
 * ffprobe (Dockerfile), but a GitHub runner is not guaranteed to ship it — and
 * this repo has been bitten by gates that passed locally only because the
 * local tree carried something CI lacks. So every assertion here runs against
 * an injected `spawnFn` that plays back real ffprobe JSON; the tests that need
 * a binary are gated on `ffprobe -version` succeeding and are skipped (not
 * failed) otherwise. The fast-start Range GET is likewise faked through the
 * injectable `fetchFn` — nothing here reaches the network.
 */
import { EventEmitter } from 'events';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import {
  buildProbeArgs,
  buildProbeFailureMeta,
  buildProbeMeta,
  describeProbe,
  FAST_START_RANGE_BYTES,
  fetchIsoBmffFastStart,
  formatDurationMs,
  hasCurrentProbe,
  hasCurrentProbeFailure,
  hasUsableDimensions,
  isIsoBmffFamily,
  mergeProbeFailure,
  mergeProbeMeta,
  needsProbe,
  parseProbeJson,
  PROBE_FAILURE_REASON_MAX,
  PROBE_VERSION,
  probeVideoFromBuffer,
  probeVideoFromUrl,
  readIsoBmffFastStart,
  type FetchLike,
  type ProbeSuccess,
} from './video-probe';

/** Minimal stand-in for a ChildProcess: stdout/stderr streams + close. */
function fakeProc() {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  return proc;
}

/** A fake spawn that prints `stdout` (in two chunks, like a real pipe) and exits. */
function makeSpawn(opts: {
  stdout?: string;
  exitCode?: number;
  stderr?: string;
  calls?: string[][];
}) {
  return jest.fn((_cmd: string, args: string[]) => {
    opts.calls?.push(args);
    const proc = fakeProc();
    setImmediate(() => {
      const out = opts.stdout ?? '';
      const mid = Math.floor(out.length / 2);
      if (out) {
        proc.stdout.emit('data', Buffer.from(out.slice(0, mid)));
        proc.stdout.emit('data', Buffer.from(out.slice(mid)));
      }
      if (opts.stderr) proc.stderr.emit('data', Buffer.from(opts.stderr));
      proc.emit('close', opts.exitCode ?? 0);
    });
    return proc;
  }) as any;
}

// ── real ffprobe 6.1 JSON, for the argv in buildProbeArgs ──────────────────
// Captured from `ffprobe -show_entries … -of json` on an H.264 High 4.1
// 1920×1080 30 fps MP4 with an AAC stereo 48 kHz track. Numbers are the real
// field types ffprobe emits: width/height/level/channels are JSON numbers;
// bit_rate/duration/sample_rate/size are decimal STRINGS.
const VIDEO_STREAM: Record<string, unknown> = {
  index: 0,
  codec_name: 'h264',
  profile: 'High',
  codec_type: 'video',
  width: 1920,
  height: 1080,
  pix_fmt: 'yuv420p',
  level: 41,
  r_frame_rate: '30/1',
  avg_frame_rate: '30/1',
  duration: '2.000000',
  bit_rate: '4523000',
  disposition: { attached_pic: 0 },
  tags: {},
};
const AUDIO_STREAM: Record<string, unknown> = {
  index: 1,
  codec_name: 'aac',
  profile: 'LC',
  codec_type: 'audio',
  sample_rate: '48000',
  channels: 2,
  r_frame_rate: '0/0',
  avg_frame_rate: '0/0',
  duration: '2.000000',
  bit_rate: '127955',
  disposition: { attached_pic: 0 },
  tags: {},
};
/** Cover art, exactly as ffprobe reports an M4A's / MP4's embedded picture. */
const COVER_ART_STREAM: Record<string, unknown> = {
  index: 2,
  codec_name: 'png',
  codec_type: 'video',
  width: 64,
  height: 64,
  pix_fmt: 'rgb24',
  level: -99,
  r_frame_rate: '90000/1',
  avg_frame_rate: '0/0',
  duration: '2.000000',
  disposition: { attached_pic: 1 },
};
const MP4_FORMAT: Record<string, unknown> = {
  format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
  duration: '2.000000',
  size: '1130750',
  bit_rate: '4523000',
};

/**
 * Build ffprobe JSON. `stream` overrides the video stream (null = none),
 * `audio` adds the audio stream with overrides (absent = no audio track),
 * `format` overrides the format section (null = none), `streams` replaces the
 * whole array for ordering tests.
 */
function ffprobeJson(
  over: {
    stream?: Record<string, unknown> | null;
    audio?: Record<string, unknown>;
    format?: Record<string, unknown> | null;
    streams?: Record<string, unknown>[];
  } = {},
) {
  const streams =
    over.streams ??
    [
      over.stream === null ? null : { ...VIDEO_STREAM, ...(over.stream ?? {}) },
      over.audio ? { ...AUDIO_STREAM, ...over.audio } : null,
    ].filter((s) => s !== null);
  return JSON.stringify({
    programs: [],
    streams,
    ...(over.format === null
      ? {}
      : { format: { ...MP4_FORMAT, ...(over.format ?? {}) } }),
  });
}

const FAKE_VIDEO = Buffer.from('not really a video, the spawn is faked');

async function probe(
  stdout: string,
  extra: Parameters<typeof makeSpawn>[0] = {},
  buffer: Buffer = FAKE_VIDEO,
  ext = '.mp4',
) {
  return probeVideoFromBuffer(buffer, ext, {
    spawnFn: makeSpawn({ stdout, ...extra }),
  });
}

/** What the landscape H.264 fixture parses to, every version-2 field. */
const LANDSCAPE_FACTS = {
  ok: true,
  width: 1920,
  height: 1080,
  displayWidth: 1920,
  displayHeight: 1080,
  durationMs: 2000,
  codec: 'h264',
  profile: 'High',
  level: 41,
  pixFmt: 'yuv420p',
  fps: 30,
  nominalFps: 30,
  variableFrameRate: false,
  bitrateKbps: 4523,
  rotation: 0,
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  // The buffer path walks FAKE_VIDEO's bytes, which are not a box sequence.
  fastStart: null,
  audio: null,
};

// ── ISO-BMFF box builders for the fast-start walker ────────────────────────
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const u64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
};
function box(
  type: string,
  payload: Buffer = Buffer.alloc(0),
  shape: 'normal' | 'largesize' | 'to-eof' = 'normal',
): Buffer {
  const t = Buffer.from(type, 'latin1');
  if (shape === 'to-eof') return Buffer.concat([u32(0), t, payload]);
  if (shape === 'largesize')
    return Buffer.concat([u32(1), t, u64(16 + payload.length), payload]);
  return Buffer.concat([u32(8 + payload.length), t, payload]);
}
const FTYP = box('ftyp', Buffer.from('isomisomiso2avc1mp41', 'latin1'));
const MOOV_FIRST = Buffer.concat([
  FTYP,
  box('moov', Buffer.alloc(40)),
  box('free', Buffer.alloc(8)),
  box('mdat', Buffer.alloc(100)),
]);
const MDAT_FIRST = Buffer.concat([
  FTYP,
  box('free', Buffer.alloc(8)),
  box('mdat', Buffer.alloc(100)),
  box('moov', Buffer.alloc(40)),
]);
/** The first bytes of every Matroska / WebM file: the EBML header id. */
const EBML_HEADER = Buffer.from([
  0x1a, 0x45, 0xdf, 0xa3, 0xa3, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01,
]);

/** A typed fake fetch that records what it was asked for. */
function fakeFetch(
  handler: (
    url: string,
    init: RequestInit | undefined,
  ) => Promise<Response> | Response,
) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fn: FetchLike = (input, init) => {
    const url: string =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : String(input.url);
    calls.push({ url, init });
    return Promise.resolve(handler(url, init));
  };
  return { fn, calls };
}
const rangeHeaderOf = (init: RequestInit | undefined): string | undefined => {
  const h = init?.headers;
  if (!h) return undefined;
  if (h instanceof Headers) return h.get('range') ?? undefined;
  if (Array.isArray(h))
    return h.find(([k]) => k.toLowerCase() === 'range')?.[1];
  return h.Range ?? h.range;
};
const bytesResponse = (bytes: Buffer, status: number) =>
  new Response(new Uint8Array(bytes), { status });

const TRUSTED = 'https://proj.supabase.co/storage/v1/object/public/assets/';

describe('buildProbeArgs — the ffprobe contract', () => {
  it('asks for EVERY stream (no -select_streams), exactly our entries, prints JSON, input last', () => {
    const args = buildProbeArgs('/tmp/in.mp4');
    expect(args.slice(0, 2)).toEqual(['-v', 'error']);
    // Version 2 needs the audio stream too, so the parser — not ffprobe —
    // picks the first real video stream (attached_pic is the cover-art flag).
    expect(args).not.toContain('-select_streams');
    const entries = args[args.indexOf('-show_entries') + 1];
    const [streamSpec] = entries.split(':');
    expect(streamSpec.startsWith('stream=')).toBe(true);
    const streamKeys = streamSpec.slice('stream='.length).split(',');
    for (const key of [
      'index',
      'codec_type',
      'codec_name',
      'profile',
      'level',
      'pix_fmt',
      'width',
      'height',
      'avg_frame_rate',
      'r_frame_rate',
      'bit_rate',
      'duration',
      'channels',
      'sample_rate',
    ])
      expect(streamKeys).toContain(key);
    expect(entries).toContain(':stream_disposition=attached_pic');
    // Both rotation encodings, and the container's own facts.
    expect(entries).toContain(':stream_side_data=rotation');
    expect(entries).toContain(':stream_tags=rotate');
    expect(entries).toContain(':format=format_name,duration,bit_rate,size');
    expect(args).toEqual(expect.arrayContaining(['-of', 'json']));
    expect(args[args.length - 1]).toBe('/tmp/in.mp4');
  });

  it('is the argv the runner actually spawns, against `ffprobe`', async () => {
    const calls: string[][] = [];
    await probe(ffprobeJson(), { calls });
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, -1)).toEqual(buildProbeArgs('x').slice(0, -1));
  });
});

describe('parsing real ffprobe JSON — the version-2 facts', () => {
  it('h264 High 4.1 yuv420p 30 fps + aac stereo 48 kHz: every fact read', async () => {
    const out = await probe(ffprobeJson({ audio: {} }));
    expect(out).toEqual({
      ...LANDSCAPE_FACTS,
      audio: { codec: 'aac', channels: 2, sampleRate: 48000 },
    });
  });

  it('hevc Main 10 3840×2160 59.94 fps', async () => {
    const out = await probe(
      ffprobeJson({
        stream: {
          codec_name: 'hevc',
          profile: 'Main 10',
          level: 153,
          pix_fmt: 'yuv420p10le',
          width: 3840,
          height: 2160,
          r_frame_rate: '60000/1001',
          avg_frame_rate: '60000/1001',
          bit_rate: '38200000',
        },
      }),
    );
    expect(out).toMatchObject({
      ok: true,
      codec: 'hevc',
      profile: 'Main 10',
      level: 153,
      pixFmt: 'yuv420p10le',
      displayWidth: 3840,
      displayHeight: 2160,
      fps: 59.94,
      nominalFps: 59.94,
      variableFrameRate: false,
      bitrateKbps: 38200,
    });
  });

  it('a stream that is cover art (attached_pic) listed FIRST is skipped — the real video wins', async () => {
    const out = await probe(
      ffprobeJson({ streams: [COVER_ART_STREAM, VIDEO_STREAM, AUDIO_STREAM] }),
    );
    expect(out).toMatchObject({
      ok: true,
      codec: 'h264',
      width: 1920,
      height: 1080,
      audio: { codec: 'aac' },
    });
  });

  it('an audio file whose only "video" is cover art is NO video stream, not a 64×64 png', async () => {
    const out = await probe(
      ffprobeJson({ streams: [AUDIO_STREAM, COVER_ART_STREAM] }),
    );
    expect(out).toEqual({ ok: false, reason: 'no-video-stream' });
  });

  it('a stream without codec_type is never "the video"', async () => {
    const out = await probe(ffprobeJson({ stream: { codec_type: undefined } }));
    expect(out).toEqual({ ok: false, reason: 'no-video-stream' });
  });

  it('no audio track → audio: null; an audio track with unknown facts → nulls inside', async () => {
    const none = await probe(ffprobeJson());
    expect(none.ok && none.audio).toBeNull();

    const sparse = await probe(
      ffprobeJson({
        audio: {
          codec_name: undefined,
          channels: undefined,
          sample_rate: 'N/A',
        },
      }),
    );
    expect(sparse.ok && sparse.audio).toEqual({
      codec: null,
      channels: null,
      sampleRate: null,
    });
  });

  describe('bitrate falls back stream → format → size ÷ duration → null', () => {
    it('the video stream bit_rate wins when present (kbit/s, rounded)', async () => {
      const out = await probe(
        ffprobeJson({
          stream: { bit_rate: '1234567' },
          format: { bit_rate: '9999999' },
        }),
      );
      expect(out.ok && out.bitrateKbps).toBe(1235);
    });
    it('else the container bit_rate', async () => {
      const out = await probe(
        ffprobeJson({
          stream: { bit_rate: undefined },
          format: { bit_rate: '277600' },
        }),
      );
      expect(out.ok && out.bitrateKbps).toBe(278);
    });
    it('else size × 8 ÷ durationMs when both are known', async () => {
      const out = await probe(
        ffprobeJson({
          stream: { bit_rate: undefined },
          format: {
            bit_rate: undefined,
            size: '1130750',
            duration: '2.000000',
          },
        }),
      );
      // 1_130_750 B × 8 / 2000 ms = 4523 kbit/s
      expect(out.ok && out.bitrateKbps).toBe(4523);
    });
    it('else null — a size with no duration is not a bitrate', async () => {
      const noSize = await probe(
        ffprobeJson({
          stream: { bit_rate: undefined },
          format: { bit_rate: undefined, size: undefined },
        }),
      );
      expect(noSize.ok && noSize.bitrateKbps).toBeNull();
      const noDuration = await probe(
        ffprobeJson({
          stream: { bit_rate: undefined, duration: undefined },
          format: { bit_rate: undefined, size: '1130750', duration: undefined },
        }),
      );
      expect(noDuration.ok && noDuration.bitrateKbps).toBeNull();
    });
  });

  describe('variable frame rate — avg vs nominal, 0.5 % tolerance', () => {
    it('29.97 avg against 30 nominal (0.1 %) is CONSTANT', async () => {
      const out = await probe(
        ffprobeJson({
          stream: { avg_frame_rate: '30000/1001', r_frame_rate: '30/1' },
        }),
      );
      expect(out).toMatchObject({
        fps: 29.97,
        nominalFps: 30,
        variableFrameRate: false,
      });
    });
    it('24 avg against 30 nominal is VARIABLE', async () => {
      const out = await probe(
        ffprobeJson({
          stream: { avg_frame_rate: '24/1', r_frame_rate: '30/1' },
        }),
      );
      expect(out).toMatchObject({
        fps: 24,
        nominalFps: 30,
        variableFrameRate: true,
      });
    });
    it('unknown on either side → null, never a guess', async () => {
      const out = await probe(
        ffprobeJson({
          stream: { avg_frame_rate: '30/1', r_frame_rate: '0/0' },
        }),
      );
      expect(out).toMatchObject({
        fps: 30,
        nominalFps: null,
        variableFrameRate: null,
      });
    });
  });

  it('level -99 (ffprobe for "unknown") → null; a missing level → null; a real one passes through', async () => {
    const unknown = await probe(ffprobeJson({ stream: { level: -99 } }));
    expect(unknown.ok && unknown.level).toBeNull();
    const missing = await probe(ffprobeJson({ stream: { level: undefined } }));
    expect(missing.ok && missing.level).toBeNull();
    const hevc = await probe(ffprobeJson({ stream: { level: 120 } }));
    expect(hevc.ok && hevc.level).toBe(120);
  });

  it('profile / pix_fmt / container: absent or literally "unknown" → null', async () => {
    const out = await probe(
      ffprobeJson({
        stream: { profile: 'unknown', pix_fmt: undefined },
        format: { format_name: undefined },
      }),
    );
    expect(out).toMatchObject({ profile: null, pixFmt: null, container: null });
    const mkv = await probe(
      ffprobeJson({ format: { format_name: 'matroska,webm' } }),
    );
    expect(mkv.ok && mkv.container).toBe('matroska,webm');
  });

  it('side_data_list rotation -90 (ffprobe ≥ 5, a portrait phone clip): axes SWAP', async () => {
    const out = await probe(
      ffprobeJson({ stream: { side_data_list: [{ rotation: -90 }] } }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rotation).toBe(270);
    // Stored 1920×1080, PLAYS 1080×1920 — the number the operator must see.
    expect([out.displayWidth, out.displayHeight]).toEqual([1080, 1920]);
    expect([out.width, out.height]).toEqual([1920, 1080]); // coded, kept for forensics
  });

  it('legacy tags.rotate "90" (older muxers): axes SWAP', async () => {
    const out = await probe(
      ffprobeJson({ stream: { tags: { rotate: '90' } } }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rotation).toBe(90);
    expect([out.displayWidth, out.displayHeight]).toEqual([1080, 1920]);
  });

  it('rotation 180: no swap, angle recorded', async () => {
    const out = await probe(
      ffprobeJson({ stream: { side_data_list: [{ rotation: 180 }] } }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.rotation).toBe(180);
    expect([out.displayWidth, out.displayHeight]).toEqual([1920, 1080]);
  });

  it('the display matrix wins over a stale legacy tag when both are present', async () => {
    const out = await probe(
      ffprobeJson({
        stream: {
          side_data_list: [{}, { rotation: 0 }],
          tags: { rotate: '90' },
        },
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.rotation).toBe(0);
  });

  it('missing width → ok:false (an audio-only or broken container is not a "0×1080 video")', async () => {
    const out = await probe(ffprobeJson({ stream: { width: undefined } }));
    expect(out).toEqual({ ok: false, reason: 'no-video-dimensions' });
  });

  it('no video stream at all → ok:false', async () => {
    const out = await probe(ffprobeJson({ stream: null }));
    expect(out).toEqual({ ok: false, reason: 'no-video-stream' });
  });

  it('non-JSON stdout → ok:false, never a throw', async () => {
    await expect(probe('ffprobe: command garbage')).resolves.toEqual({
      ok: false,
      reason: 'ffprobe-output-not-json',
    });
    await expect(probe('')).resolves.toEqual({
      ok: false,
      reason: 'ffprobe-output-not-json',
    });
    await expect(probe('[1,2,3]')).resolves.toEqual({
      ok: false,
      reason: 'ffprobe-output-not-json',
    });
  });

  it('falls back to the container duration when the stream has none (WebM/Matroska)', async () => {
    const out = await probe(
      ffprobeJson({
        stream: { duration: undefined },
        format: { duration: '75.400000', format_name: 'matroska,webm' },
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.durationMs).toBe(75_400);
  });

  it('reports null duration / fps rather than inventing them', async () => {
    const out = await probe(
      ffprobeJson({
        stream: { duration: 'N/A', avg_frame_rate: '0/0', r_frame_rate: '0/0' },
        format: { duration: undefined },
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.durationMs).toBeNull();
    expect(out.fps).toBeNull();
    expect(out.nominalFps).toBeNull();
    expect(out.variableFrameRate).toBeNull();
  });

  it('parses an NTSC frame rate ratio to 3 decimals', async () => {
    const out = await probe(
      ffprobeJson({ stream: { avg_frame_rate: '30000/1001' } }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.fps).toBe(29.97);
  });

  it('parseProbeJson is directly usable, coerces numeric strings, never throws on junk, and never claims fast start', () => {
    expect(
      parseProbeJson(
        '{"streams":[{"codec_type":"video","width":"1280","height":"720"}]}',
      ),
    ).toMatchObject({ ok: true, width: 1280, height: 720, fastStart: null });
    expect(parseProbeJson('null')).toEqual({
      ok: false,
      reason: 'ffprobe-output-not-json',
    });
    expect(
      parseProbeJson(
        '{"streams":[{"codec_type":"video","width":-1,"height":720}]}',
      ),
    ).toEqual({ ok: false, reason: 'no-video-dimensions' });
  });
});

describe('the process boundary — fails SOFT every way', () => {
  it('ffprobe exits non-zero → ok:false carrying the stderr tail', async () => {
    const out = await probe('', {
      exitCode: 1,
      stderr: 'Invalid data found when processing input',
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('ffprobe exited 1');
    if (!out.ok) expect(out.reason).toContain('Invalid data');
  });

  it('binary missing (async ENOENT) → ok:false, never throws', async () => {
    const spawnFn = jest.fn(() => {
      const proc = fakeProc();
      setImmediate(() => proc.emit('error', new Error('spawn ffprobe ENOENT')));
      return proc;
    }) as any;
    const out = await probeVideoFromBuffer(FAKE_VIDEO, '.mp4', { spawnFn });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('ENOENT');
  });

  it('binary missing (synchronous throw from spawn) → ok:false, never throws', async () => {
    const spawnFn = jest.fn(() => {
      throw new Error('spawn ffprobe ENOENT');
    }) as any;
    await expect(
      probeVideoFromBuffer(FAKE_VIDEO, '.mp4', { spawnFn }),
    ).resolves.toEqual({ ok: false, reason: 'spawn: spawn ffprobe ENOENT' });
  });

  it('SIGKILLs and fails SOFT on timeout — a wedged ffprobe never wedges the caller', async () => {
    const proc = fakeProc();
    const spawnFn = jest.fn(() => proc) as any; // never emits close
    const out = await probeVideoFromBuffer(FAKE_VIDEO, '.mp4', {
      spawnFn,
      timeoutMs: 15,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('timeout');
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('rejects an empty buffer without spawning anything', async () => {
    const spawnFn = jest.fn() as any;
    await expect(
      probeVideoFromBuffer(Buffer.alloc(0), '.mp4', { spawnFn }),
    ).resolves.toEqual({ ok: false, reason: 'empty-buffer' });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('cleans up its temp directories (no /tmp leak per upload)', async () => {
    const count = async () =>
      (await fs.readdir(os.tmpdir())).filter((f) => f.startsWith('edu-probe-'))
        .length;
    const before = await count();
    await probe(ffprobeJson());
    await probe('', { exitCode: 1 });
    expect(await count()).toBe(before);
  });
});

describe('readIsoBmffFastStart — the top-level box walker', () => {
  it('moov before mdat → true', () => {
    expect(readIsoBmffFastStart(MOOV_FIRST)).toBe(true);
  });

  it('ftyp, free, mdat, moov (ffmpeg default mux) → false', () => {
    expect(readIsoBmffFastStart(MDAT_FIRST)).toBe(false);
  });

  it('a 64-bit largesize mdat (a > 4 GB file) → false', () => {
    const bytes = Buffer.concat([
      FTYP,
      box('mdat', Buffer.alloc(32), 'largesize'),
      box('moov', Buffer.alloc(8)),
    ]);
    expect(readIsoBmffFastStart(bytes)).toBe(false);
  });

  it('a size-0 mdat (extends to EOF) → false; a size-0 moov → true', () => {
    expect(
      readIsoBmffFastStart(
        Buffer.concat([FTYP, box('mdat', Buffer.alloc(16), 'to-eof')]),
      ),
    ).toBe(false);
    expect(
      readIsoBmffFastStart(
        Buffer.concat([FTYP, box('moov', Buffer.alloc(16), 'to-eof')]),
      ),
    ).toBe(true);
  });

  it('a truncated header → null (never a guess)', () => {
    // ftyp complete, then five bytes of the next box's header.
    expect(
      readIsoBmffFastStart(Buffer.concat([FTYP, Buffer.from('\0\0\0\x10m')])),
    ).toBeNull();
    expect(readIsoBmffFastStart(Buffer.alloc(0))).toBeNull();
    // A largesize box whose 64-bit length is cut off.
    expect(
      readIsoBmffFastStart(
        Buffer.concat([FTYP, u32(1), Buffer.from('mdat'), u32(0)]),
      ),
    ).toBeNull();
  });

  it('a window that ends before either box (e.g. a huge leading free box) → null', () => {
    const freeHeaderOnly = Buffer.concat([
      u32(2 * 1024 * 1024),
      Buffer.from('free'),
    ]);
    expect(
      readIsoBmffFastStart(Buffer.concat([FTYP, freeHeaderOnly])),
    ).toBeNull();
    // A size-0 box that is not moov/mdat extends to EOF: nothing can follow.
    expect(
      readIsoBmffFastStart(
        Buffer.concat([FTYP, box('free', Buffer.alloc(4), 'to-eof')]),
      ),
    ).toBeNull();
  });

  it('non-ISO bytes (a Matroska EBML header, plain text) → null', () => {
    expect(readIsoBmffFastStart(EBML_HEADER)).toBeNull();
    expect(readIsoBmffFastStart(Buffer.from('hello, not a video'))).toBeNull();
  });

  it('an impossible box size (< 8, or a largesize < 16) → null', () => {
    expect(
      readIsoBmffFastStart(
        Buffer.concat([u32(4), Buffer.from('ftyp'), MOOV_FIRST]),
      ),
    ).toBeNull();
    expect(
      readIsoBmffFastStart(
        Buffer.concat([u32(1), Buffer.from('mdat'), u64(8), Buffer.alloc(16)]),
      ),
    ).toBeNull();
  });

  it('isIsoBmffFamily — ffprobe format_name decides; the extension only when there is none', () => {
    expect(isIsoBmffFamily('mov,mp4,m4a,3gp,3g2,mj2', null)).toBe(true);
    expect(isIsoBmffFamily('matroska,webm', '.mp4')).toBe(false);
    expect(isIsoBmffFamily(null, '.mp4')).toBe(true);
    expect(isIsoBmffFamily(null, '.MOV')).toBe(true);
    expect(isIsoBmffFamily(null, '.webm')).toBe(false);
    expect(isIsoBmffFamily(null, null)).toBe(false);
  });
});

describe('fast start on the BUFFER path — read from the bytes in hand', () => {
  it('an MP4 whose moov leads → fastStart: true', async () => {
    const out = await probe(ffprobeJson(), {}, MOOV_FIRST);
    expect(out).toMatchObject({ ok: true, fastStart: true });
  });

  it('an MP4 whose mdat leads → fastStart: false', async () => {
    const out = await probe(ffprobeJson(), {}, MDAT_FIRST);
    expect(out).toMatchObject({ ok: true, fastStart: false });
  });

  it('a non-ISO container never consults the walker → null, whatever the bytes say', async () => {
    const out = await probe(
      ffprobeJson({ format: { format_name: 'matroska,webm' } }),
      {},
      MOOV_FIRST,
      '.webm',
    );
    expect(out).toMatchObject({
      ok: true,
      container: 'matroska,webm',
      fastStart: null,
    });
  });

  it('with no container reported, the extension decides whether to look', async () => {
    const mp4 = await probe(
      ffprobeJson({ format: { format_name: undefined } }),
      {},
      MOOV_FIRST,
      '.mp4',
    );
    expect(mp4).toMatchObject({ ok: true, container: null, fastStart: true });
    const mkv = await probe(
      ffprobeJson({ format: { format_name: undefined } }),
      {},
      MOOV_FIRST,
      '.mkv',
    );
    expect(mkv).toMatchObject({ ok: true, container: null, fastStart: null });
  });
});

describe('fast start on the URL path — ONE Range GET through the injectable fetch', () => {
  const url = `${TRUSTED}tenant-1/abc.mp4`;

  it('sends exactly one GET with Range: bytes=0-262143 and walks a 206', async () => {
    const { fn, calls } = fakeFetch(() => bytesResponse(MOOV_FIRST, 206));
    const out = await probeVideoFromUrl(url, TRUSTED, {
      spawnFn: makeSpawn({ stdout: ffprobeJson() }),
      fetchFn: fn,
    });
    expect(out).toMatchObject({ ok: true, fastStart: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(url);
    expect(calls[0].init?.method).toBe('GET');
    expect(rangeHeaderOf(calls[0].init)).toBe(
      `bytes=0-${FAST_START_RANGE_BYTES - 1}`,
    );
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('a 200 (server ignored the Range) is read only up to 256 KB and the rest is CANCELLED', async () => {
    // A body far bigger than the window: mdat-first header, then endless bytes.
    const CHUNK = 64 * 1024;
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        const chunk = new Uint8Array(CHUNK);
        if (pulls === 1) chunk.set(new Uint8Array(MDAT_FIRST));
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const { fn } = fakeFetch(() => new Response(body, { status: 200 }));
    const out = await fetchIsoBmffFastStart(url, TRUSTED, { fetchFn: fn });
    expect(out).toBe(false);
    expect(cancelled).toBe(true);
    // 4 chunks fill the window; a pull or two may already be queued. Never the file.
    expect(pulls).toBeLessThanOrEqual(6);
  });

  it('any other status → null (404, 416, 5xx)', async () => {
    for (const status of [404, 416, 500]) {
      const { fn } = fakeFetch(() => bytesResponse(MOOV_FIRST, status));
      expect(
        await fetchIsoBmffFastStart(url, TRUSTED, { fetchFn: fn }),
      ).toBeNull();
    }
  });

  it('refuses a URL outside the trusted prefix WITHOUT fetching — a stored fileUrl is never fetched', async () => {
    const { fn, calls } = fakeFetch(() => bytesResponse(MOOV_FIRST, 206));
    for (const bad of [
      'https://cdn.partner.example/promo.mp4',
      'https://proj.supabase.co.evil.example/storage/v1/object/public/assets/a.mp4',
      'file:///etc/passwd',
    ]) {
      expect(
        await fetchIsoBmffFastStart(bad, TRUSTED, { fetchFn: fn }),
      ).toBeNull();
    }
    expect(await fetchIsoBmffFastStart(url, '', { fetchFn: fn })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('times out to null — both a fetch that honours its signal and one that ignores it', async () => {
    const honours = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('AbortError')),
          );
        }),
    );
    expect(
      await fetchIsoBmffFastStart(url, TRUSTED, {
        fetchFn: honours.fn,
        fastStartTimeoutMs: 20,
      }),
    ).toBeNull();

    const ignores = fakeFetch(() => new Promise<Response>(() => undefined));
    expect(
      await fetchIsoBmffFastStart(url, TRUSTED, {
        fetchFn: ignores.fn,
        fastStartTimeoutMs: 20,
      }),
    ).toBeNull();
  });

  it('a throwing fetch or a failing body read → null, and the PROBE still succeeds', async () => {
    const throws = fakeFetch(() => Promise.reject(new Error('ECONNRESET')));
    const out = await probeVideoFromUrl(url, TRUSTED, {
      spawnFn: makeSpawn({ stdout: ffprobeJson() }),
      fetchFn: throws.fn,
    });
    expect(out).toMatchObject({
      ok: true,
      displayWidth: 1920,
      fastStart: null,
    });

    const brokenBody = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('body reset');
      },
    });
    const breaks = fakeFetch(() => new Response(brokenBody, { status: 206 }));
    expect(
      await fetchIsoBmffFastStart(url, TRUSTED, { fetchFn: breaks.fn }),
    ).toBeNull();
  });

  it('is never attempted for a non-ISO container', async () => {
    const { fn, calls } = fakeFetch(() => bytesResponse(MOOV_FIRST, 206));
    const out = await probeVideoFromUrl(
      `${TRUSTED}tenant-1/abc.webm`,
      TRUSTED,
      {
        spawnFn: makeSpawn({
          stdout: ffprobeJson({ format: { format_name: 'matroska,webm' } }),
        }),
        fetchFn: fn,
      },
    );
    expect(out).toMatchObject({ ok: true, fastStart: null });
    expect(calls).toHaveLength(0);
  });
});

describe('probeVideoFromUrl — SSRF boundary', () => {
  it('refuses a URL outside the trusted prefix WITHOUT spawning ffprobe or fetching', async () => {
    const spawnFn = jest.fn() as any;
    const { fn, calls } = fakeFetch(() => bytesResponse(MOOV_FIRST, 206));
    for (const bad of [
      'https://evil.example/x.mp4',
      'file:///etc/passwd',
      'http://169.254.169.254/latest/meta-data/',
      // Lookalike host — prefix matching is on the full URL, not the path.
      'https://proj.supabase.co.evil.example/storage/v1/object/public/assets/a.mp4',
      // A stored external Asset.fileUrl (POST /assets/url) is exactly this case.
      'https://cdn.partner.example/promo.mp4',
    ]) {
      const out = await probeVideoFromUrl(bad, TRUSTED, {
        spawnFn,
        fetchFn: fn,
      });
      expect(out).toEqual({ ok: false, reason: 'untrusted-source-url' });
    }
    expect(spawnFn).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('accepts a URL we built ourselves and hands ffprobe the URL directly (no download)', async () => {
    const calls: string[][] = [];
    const url = `${TRUSTED}tenant-1/abc.mp4`;
    const { fn } = fakeFetch(() => bytesResponse(MDAT_FIRST, 206));
    const out = await probeVideoFromUrl(url, TRUSTED, {
      spawnFn: makeSpawn({ stdout: ffprobeJson(), calls }),
      fetchFn: fn,
    });
    expect(out).toMatchObject({ ok: true, fastStart: false });
    expect(calls[0][calls[0].length - 1]).toBe(url);
  });

  it('refuses an empty URL / empty prefix', async () => {
    const spawnFn = jest.fn() as any;
    expect(await probeVideoFromUrl('', TRUSTED, { spawnFn })).toEqual({
      ok: false,
      reason: 'no-url',
    });
    expect(await probeVideoFromUrl(`${TRUSTED}a.mp4`, '', { spawnFn })).toEqual(
      {
        ok: false,
        reason: 'untrusted-source-url',
      },
    );
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

describe('processingMeta mapping', () => {
  const PORTRAIT: ProbeSuccess = {
    ok: true,
    width: 1920,
    height: 1080,
    displayWidth: 1080,
    displayHeight: 1920,
    durationMs: 75_400,
    codec: 'hevc',
    profile: 'Main',
    level: 120,
    pixFmt: 'yuv420p',
    fps: 29.97,
    nominalFps: 30,
    variableFrameRate: false,
    bitrateKbps: 8210,
    rotation: 90,
    container: 'mov,mp4,m4a,3gp,3g2,mj2',
    fastStart: true,
    audio: { codec: 'aac', channels: 2, sampleRate: 44100 },
  };
  const AT = new Date('2026-09-24T12:00:00.000Z');

  it('buildProbeMeta writes DISPLAY dims as originalDimensions and the EXACT version-2 probe block', () => {
    expect(PROBE_VERSION).toBe(2);
    expect(buildProbeMeta(PORTRAIT, AT)).toEqual({
      originalDimensions: { w: 1080, h: 1920 },
      processedDimensions: null,
      durationMs: 75_400,
      probe: {
        probeVersion: 2,
        codec: 'hevc',
        profile: 'Main',
        level: 120,
        pixFmt: 'yuv420p',
        fps: 29.97,
        nominalFps: 30,
        variableFrameRate: false,
        bitrateKbps: 8210,
        rotation: 90,
        codedWidth: 1920,
        codedHeight: 1080,
        container: 'mov,mp4,m4a,3gp,3g2,mj2',
        fastStart: true,
        audio: { codec: 'aac', channels: 2, sampleRate: 44100 },
      },
      probedAt: '2026-09-24T12:00:00.000Z',
    });
  });

  it('every probe key is present even when the container said nothing (nulls, never absent keys)', () => {
    const sparse: ProbeSuccess = {
      ...PORTRAIT,
      durationMs: null,
      codec: null,
      profile: null,
      level: null,
      pixFmt: null,
      fps: null,
      nominalFps: null,
      variableFrameRate: null,
      bitrateKbps: null,
      rotation: 0,
      container: null,
      fastStart: null,
      audio: null,
    };
    const probe = buildProbeMeta(sparse, AT).probe;
    expect(Object.keys(probe).sort()).toEqual(
      [
        'audio',
        'bitrateKbps',
        'codec',
        'codedHeight',
        'codedWidth',
        'container',
        'fastStart',
        'fps',
        'level',
        'nominalFps',
        'pixFmt',
        'probeVersion',
        'profile',
        'rotation',
        'variableFrameRate',
      ].sort(),
    );
    expect(probe.audio).toBeNull();
    expect(probe.fastStart).toBeNull();
    expect(probe.probeVersion).toBe(2);
  });

  it('mergeProbeMeta preserves every key the probe does not own', () => {
    const merged = mergeProbeMeta(
      {
        originalSize: 123,
        skippedReason: 'no-gain-or-passthrough',
        originalDimensions: { w: 1, h: 1 },
      },
      PORTRAIT,
      AT,
    );
    expect(merged.originalSize).toBe(123);
    expect(merged.skippedReason).toBe('no-gain-or-passthrough');
    // …and the probe's own keys win over stale ones.
    expect(merged.originalDimensions).toEqual({ w: 1080, h: 1920 });
    expect(merged.processedDimensions).toBeNull();
  });

  it('mergeProbeMeta REPLACES a version-1 probe block outright — no stale keys under the new marker', () => {
    const merged = mergeProbeMeta(
      {
        originalDimensions: { w: 1920, h: 1080 },
        probe: {
          codec: 'h264',
          fps: 30,
          rotation: 0,
          codedWidth: 1920,
          codedHeight: 1080,
          legacyKey: 'x',
        },
      },
      PORTRAIT,
      AT,
    );
    expect(merged.probe).toEqual(buildProbeMeta(PORTRAIT, AT).probe);
    expect('legacyKey' in merged.probe).toBe(false);
  });

  it('mergeProbeMeta treats NULL / non-object meta as empty rather than throwing', () => {
    for (const existing of [null, undefined, 'garbage', 42, ['x']]) {
      const merged = mergeProbeMeta(existing, PORTRAIT, AT);
      expect(merged.originalDimensions).toEqual({ w: 1080, h: 1920 });
      expect(Object.keys(merged).sort()).toEqual(
        [
          'durationMs',
          'originalDimensions',
          'probe',
          'probedAt',
          'processedDimensions',
        ].sort(),
      );
    }
  });

  it('hasUsableDimensions — what the media library can show', () => {
    expect(hasUsableDimensions(null)).toBe(false);
    expect(hasUsableDimensions({})).toBe(false);
    expect(hasUsableDimensions({ originalSize: 5 })).toBe(false);
    expect(hasUsableDimensions({ originalDimensions: null })).toBe(false);
    expect(hasUsableDimensions({ originalDimensions: { w: 0, h: 1080 } })).toBe(
      false,
    );
    // A numeric STRING is not usable: the media library's metaDims checks
    // `typeof w === 'number'` and the backfill SQL checks jsonb_typeof — all
    // three must agree, or a row could be "done" here and "—" on screen.
    expect(
      hasUsableDimensions({ originalDimensions: { w: '1920', h: 1080 } }),
    ).toBe(false);
    expect(
      hasUsableDimensions({ originalDimensions: { w: 1920, h: 1080 } }),
    ).toBe(true);
    expect(hasUsableDimensions(buildProbeMeta(PORTRAIT))).toBe(true);
  });

  it('hasCurrentProbe — the backfill candidate test and idempotency guard: dims AND probeVersion 2', () => {
    // A version-1 row: dimensions, a probe block, no marker → still a candidate.
    const v1 = {
      originalDimensions: { w: 1920, h: 1080 },
      processedDimensions: null,
      durationMs: 2000,
      probe: {
        codec: 'h264',
        fps: 30,
        rotation: 0,
        codedWidth: 1920,
        codedHeight: 1080,
      },
      probedAt: '2026-09-24T09:00:00.000Z',
    };
    expect(hasCurrentProbe(v1)).toBe(false);
    expect(hasCurrentProbe(null)).toBe(false);
    expect(hasCurrentProbe({})).toBe(false);
    expect(hasCurrentProbe({ probe: { probeVersion: 2 } })).toBe(false); // no dims
    expect(
      hasCurrentProbe({
        originalDimensions: { w: 1920, h: 1080 },
        probe: { probeVersion: '2' },
      }),
    ).toBe(false); // a string marker is not the number the SQL twin compares
    expect(
      hasCurrentProbe({
        originalDimensions: { w: 1920, h: 1080 },
        probe: { probeVersion: 3 },
      }),
    ).toBe(false);
    expect(hasCurrentProbe(buildProbeMeta(PORTRAIT))).toBe(true);
    expect(hasCurrentProbe(mergeProbeMeta(v1, PORTRAIT))).toBe(true);
  });

  it('describeProbe — one readable line, unknown facts simply absent', () => {
    expect(describeProbe(PORTRAIT)).toBe(
      '1080×1920 · 1:15 · hevc Main L120 · 29.97 fps · 8210 kbps · moov first · aac 2ch (rotated 90°, coded 1920×1080)',
    );
    expect(
      describeProbe({
        ...PORTRAIT,
        rotation: 0,
        displayWidth: 1920,
        displayHeight: 1080,
        durationMs: null,
        profile: null,
        level: null,
        variableFrameRate: true,
        bitrateKbps: null,
        fastStart: false,
        audio: null,
      }),
    ).toBe('1920×1080 · hevc · 29.97 fps (variable) · moov last');
  });

  it('formatDurationMs — m:ss under an hour, h:mm:ss above, null when unknown', () => {
    expect(formatDurationMs(75_400)).toBe('1:15');
    expect(formatDurationMs(2_000)).toBe('0:02');
    expect(formatDurationMs(3_725_000)).toBe('1:02:05');
    expect(formatDurationMs(0)).toBeNull();
    expect(formatDurationMs(null)).toBeNull();
    expect(formatDurationMs(undefined)).toBeNull();
    expect(formatDurationMs(Number.NaN)).toBeNull();
  });

  describe('a FAILED probe stamps the row', () => {
    it('buildProbeFailureMeta — probedAt, a short single-line reason, and the version that failed', () => {
      expect(buildProbeFailureMeta('no-video-stream', AT)).toEqual({
        probedAt: '2026-09-24T12:00:00.000Z',
        probeFailed: 'no-video-stream',
        probeFailedVersion: 2,
      });
      const long = `ffprobe exited 1:  ${'x'.repeat(400)}\n  second line`;
      const stamped = buildProbeFailureMeta(long, AT).probeFailed;
      expect(stamped.length).toBe(PROBE_FAILURE_REASON_MAX);
      expect(stamped).not.toContain('\n');
      expect(stamped.startsWith('ffprobe exited 1: x')).toBe(true);
      expect(buildProbeFailureMeta('   ', AT).probeFailed).toBe('unknown');
    });

    it('mergeProbeFailure keeps every other key and never touches the dimensions', () => {
      const merged = mergeProbeFailure(
        {
          originalSize: 9_000_000,
          skippedReason: 'legacy',
          originalDimensions: { w: 1280, h: 720 },
        },
        'threw: ffprobe exploded',
        AT,
      );
      expect(merged).toEqual({
        originalSize: 9_000_000,
        skippedReason: 'legacy',
        originalDimensions: { w: 1280, h: 720 },
        probedAt: '2026-09-24T12:00:00.000Z',
        probeFailed: 'threw: ffprobe exploded',
        probeFailedVersion: 2,
      });
      for (const existing of [null, undefined, 'garbage', 42, ['x']]) {
        expect(
          Object.keys(mergeProbeFailure(existing, 'r', AT)).sort(),
        ).toEqual(['probeFailed', 'probeFailedVersion', 'probedAt'].sort());
      }
    });

    it('a SUCCESS merged over a failure stamp removes both failure keys', () => {
      const merged = mergeProbeMeta(
        { ...buildProbeFailureMeta('no-video-stream', AT), originalSize: 7 },
        PORTRAIT,
        AT,
      );
      expect('probeFailed' in merged).toBe(false);
      expect('probeFailedVersion' in merged).toBe(false);
      expect(merged.originalSize).toBe(7);
      expect(merged.probedAt).toBe('2026-09-24T12:00:00.000Z');
    });

    it('hasCurrentProbeFailure / needsProbe — a failure counts as "probe ran" once per version', () => {
      const v2fail = buildProbeFailureMeta('no-video-stream', AT);
      expect(hasCurrentProbeFailure(v2fail)).toBe(true);
      expect(needsProbe(v2fail)).toBe(false);
      // No version, or an older one: one more attempt.
      expect(
        hasCurrentProbeFailure({
          probedAt: 'x',
          probeFailed: 'no-video-stream',
        }),
      ).toBe(false);
      expect(
        needsProbe({ probedAt: 'x', probeFailed: 'no-video-stream' }),
      ).toBe(true);
      expect(
        needsProbe({ probedAt: 'x', probeFailed: 'r', probeFailedVersion: 1 }),
      ).toBe(true);
      // The version mark alone is not a failure stamp.
      expect(hasCurrentProbeFailure({ probeFailedVersion: 2 })).toBe(false);
      expect(hasCurrentProbeFailure(null)).toBe(false);
      // Facts win: a current probe never needs another.
      expect(needsProbe(buildProbeMeta(PORTRAIT))).toBe(false);
      expect(needsProbe(null)).toBe(true);
      expect(needsProbe({})).toBe(true);
    });
  });
});

// ── REAL ffprobe, when the box has one ──────────────────────────────────────
// The only tests that prove the argv above reads a real container correctly.
// Skipped (never failed) where the binaries are absent, so they can't turn a
// CI runner without them red — the production image is guaranteed to have both.
const hasTools = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** Does this ffmpeg carry the named encoder (libx265, libvpx-vp9, …)? */
const hasEncoder = (name: string): boolean => {
  if (!hasTools) return false;
  try {
    return execFileSync('ffmpeg', ['-hide_banner', '-encoders'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .split('\n')
      .some((line) => line.split(/\s+/)[2] === name);
  } catch {
    return false;
  }
};

(hasTools ? describe : describe.skip)(
  'probeVideo — against a REAL ffprobe',
  () => {
    jest.setTimeout(120_000);
    let dir: string;
    beforeAll(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-probe-fixture-'));
    });
    afterAll(async () => {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    });

    const ffmpeg = (args: string[]) =>
      execFileSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        ...args,
      ]);

    const makeVideo = (
      name: string,
      extra: string[] = [],
      size = '1280x720',
      codec = 'libx264',
      rate = '30',
    ) => {
      const out = path.join(dir, name);
      ffmpeg([
        '-f',
        'lavfi',
        '-i',
        `testsrc=size=${size}:rate=${rate}`,
        '-t',
        '2',
        '-c:v',
        codec,
        '-pix_fmt',
        'yuv420p',
        ...extra,
        out,
      ]);
      return out;
    };

    it('reads a real 1280×720 H.264 MP4: dims, ~2 s, 30 fps, High profile, container, no audio', async () => {
      const buf = await fs.readFile(makeVideo('clip.mp4'));
      const out = await probeVideoFromBuffer(buf, '.mp4');
      expect(out).toMatchObject({
        ok: true,
        width: 1280,
        height: 720,
        displayWidth: 1280,
        displayHeight: 720,
        codec: 'h264',
        profile: 'High',
        pixFmt: 'yuv420p',
        fps: 30,
        nominalFps: 30,
        variableFrameRate: false,
        rotation: 0,
        container: 'mov,mp4,m4a,3gp,3g2,mj2',
        audio: null,
      });
      if (!out.ok) return;
      expect(out.durationMs).toBeGreaterThanOrEqual(1900);
      expect(out.durationMs).toBeLessThanOrEqual(2100);
      expect(out.level).toBeGreaterThan(0);
      expect(out.bitrateKbps).toBeGreaterThan(0);
    });

    it('ffmpeg default mux (moov at the tail) → fastStart false; -movflags +faststart → true', async () => {
      const tail = await probeVideoFromBuffer(
        await fs.readFile(makeVideo('tail.mp4')),
        '.mp4',
      );
      expect(tail).toMatchObject({ ok: true, fastStart: false });
      const front = await probeVideoFromBuffer(
        await fs.readFile(makeVideo('front.mp4', ['-movflags', '+faststart'])),
        '.mp4',
      );
      expect(front).toMatchObject({ ok: true, fastStart: true });
    });

    it('a 60 fps clip reports 60 avg and 60 nominal, constant', async () => {
      const out = await probeVideoFromBuffer(
        await fs.readFile(
          makeVideo('sixty.mp4', [], '640x360', 'libx264', '60'),
        ),
        '.mp4',
      );
      expect(out).toMatchObject({
        ok: true,
        fps: 60,
        nominalFps: 60,
        variableFrameRate: false,
      });
    });

    it('an explicit -profile:v high -level 4.1 reads back as High / 41', async () => {
      const out = await probeVideoFromBuffer(
        await fs.readFile(
          makeVideo('high41.mp4', ['-profile:v', 'high', '-level', '4.1']),
        ),
        '.mp4',
      );
      expect(out).toMatchObject({ ok: true, profile: 'High', level: 41 });
    });

    it('an audio-bearing clip (sine → aac stereo 48 kHz) reports the audio facts', async () => {
      const outPath = path.join(dir, 'audio.mp4');
      ffmpeg([
        '-f',
        'lavfi',
        '-i',
        'testsrc=size=320x240:rate=30',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000',
        '-t',
        '2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-ac',
        '2',
        '-shortest',
        outPath,
      ]);
      const out = await probeVideoFromBuffer(
        await fs.readFile(outPath),
        '.mp4',
      );
      expect(out).toMatchObject({
        ok: true,
        codec: 'h264',
        displayWidth: 320,
        audio: { codec: 'aac', channels: 2, sampleRate: 48000 },
      });
    });

    it('an audio-only M4A with embedded cover art is NO video stream — never a 64×64 png "video"', async () => {
      const cover = path.join(dir, 'cover.png');
      ffmpeg([
        '-f',
        'lavfi',
        '-i',
        'color=c=red:size=64x64',
        '-frames:v',
        '1',
        cover,
      ]);
      const m4a = path.join(dir, 'cover.m4a');
      ffmpeg([
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=44100',
        '-i',
        cover,
        '-map',
        '0',
        '-map',
        '1',
        '-t',
        '1',
        '-c:a',
        'aac',
        '-c:v',
        'copy',
        '-disposition:v:0',
        'attached_pic',
        m4a,
      ]);
      const out = await probeVideoFromBuffer(await fs.readFile(m4a), '.m4a');
      expect(out).toEqual({ ok: false, reason: 'no-video-stream' });
    });

    (hasEncoder('libx265') ? it : it.skip)(
      'HEVC Main 10 (yuv420p10le) reads back as hevc / Main 10 / yuv420p10le',
      async () => {
        const out = await probeVideoFromBuffer(
          await fs.readFile(
            makeVideo(
              'hevc10.mp4',
              ['-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=none'],
              '640x360',
              'libx265',
              '30000/1001',
            ),
          ),
          '.mp4',
        );
        expect(out).toMatchObject({
          ok: true,
          codec: 'hevc',
          profile: 'Main 10',
          pixFmt: 'yuv420p10le',
          fps: 29.97,
          nominalFps: 29.97,
          variableFrameRate: false,
        });
      },
    );

    (hasEncoder('libvpx-vp9') ? it : it.skip)(
      'a WebM / VP9 clip: container matroska,webm, vp9, fastStart null (not ISO-BMFF)',
      async () => {
        const out = await probeVideoFromBuffer(
          await fs.readFile(
            makeVideo(
              'clip.webm',
              ['-deadline', 'realtime', '-cpu-used', '8'],
              '320x240',
              'libvpx-vp9',
            ),
          ),
          '.webm',
        );
        expect(out).toMatchObject({
          ok: true,
          codec: 'vp9',
          container: 'matroska,webm',
          fastStart: null,
          displayWidth: 320,
          displayHeight: 240,
        });
      },
    );

    // A rotation FLAG (display matrix in the `tkhd` atom) is what a phone
    // writes. Note what does NOT produce one on ffmpeg ≥ 5, learned the hard
    // way while writing this test: `-metadata:s:v:0 rotate=90` on the output is
    // silently dropped by the mov muxer, and `-display_rotation` on an input
    // that is being ENCODED is applied by autorotate (the frames are physically
    // transposed and no flag remains). The documented way to write the flag is
    // `-display_rotation N -noautorotate` on a stream COPY, which needs the
    // ffmpeg ≥ 6.0 option — so this case is gated on that, not on `hasTools`.
    const canFlagRotation = (() => {
      try {
        execFileSync('ffmpeg', ['-hide_banner', '-h', 'long'], {
          stdio: 'pipe',
        })
          .toString()
          .includes('-display_rotation');
        return true;
      } catch {
        return false;
      }
    })();
    const flagRotation = (name: string, source: string, degrees: number) => {
      const out = path.join(dir, name);
      ffmpeg([
        '-display_rotation',
        String(degrees),
        '-noautorotate',
        '-i',
        source,
        '-c',
        'copy',
        out,
      ]);
      return out;
    };

    (canFlagRotation ? it : it.skip)(
      'a rotation-flagged MP4 (portrait phone clip) reports DISPLAY 720×1280 with the coded 1280×720 kept',
      async () => {
        const landscape = makeVideo('landscape.mp4');
        // ffprobe 6.1 reports `-display_rotation 90` as side_data rotation 90 and
        // `-90` as -90 (→ 270); both are a quarter turn and both must swap.
        for (const [degrees, expectRotation] of [
          [90, 90],
          [-90, 270],
        ] as const) {
          const buf = await fs.readFile(
            flagRotation(`portrait${degrees}.mp4`, landscape, degrees),
          );
          const out = await probeVideoFromBuffer(buf, '.mp4');
          expect(out.ok).toBe(true);
          if (!out.ok) return;
          expect([out.width, out.height]).toEqual([1280, 720]);
          expect([out.displayWidth, out.displayHeight]).toEqual([720, 1280]);
          expect(out.rotation).toBe(expectRotation);
        }
      },
    );

    (canFlagRotation ? it : it.skip)(
      'a 180° flag keeps the axes and records the angle',
      async () => {
        const buf = await fs.readFile(
          flagRotation('flip.mp4', makeVideo('landscape2.mp4'), 180),
        );
        const out = await probeVideoFromBuffer(buf, '.mp4');
        expect(out).toMatchObject({
          ok: true,
          displayWidth: 1280,
          displayHeight: 720,
          rotation: 180,
        });
      },
    );

    it('a Matroska file with no per-stream duration falls back to the container duration', async () => {
      const buf = await fs.readFile(
        makeVideo('clip.mkv', [], '320x240', 'mpeg4'),
      );
      const out = await probeVideoFromBuffer(buf, '.mkv');
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect([out.displayWidth, out.displayHeight]).toEqual([320, 240]);
      expect(out.durationMs).toBeGreaterThanOrEqual(1900);
      expect(out.container).toBe('matroska,webm');
      expect(out.fastStart).toBeNull();
    });

    it('fails SOFT on a file that is not a video at all', async () => {
      const out = await probeVideoFromBuffer(
        Buffer.from('hello, not a video'),
        '.mp4',
      );
      expect(out.ok).toBe(false);
    });

    it('probes over HTTP straight off a URL — the presign/backfill path — and reads fast start with ONE 256 KB Range GET', async () => {
      const files: Record<string, Buffer> = {
        'tail.mp4': await fs.readFile(makeVideo('http-tail.mp4')),
        'front.mp4': await fs.readFile(
          makeVideo('http-front.mp4', ['-movflags', '+faststart']),
        ),
      };
      const ranges: string[] = [];
      // A tiny Range-aware origin, because ffprobe seeks (moov lookup) over http.
      const server = http.createServer((req, res) => {
        const file = files[path.basename(req.url || '')];
        if (!file) {
          res.writeHead(404);
          res.end();
          return;
        }
        if (req.headers.range) ranges.push(req.headers.range);
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
        if (range) {
          const start = range[1] ? Number(range[1]) : 0;
          const end = range[2]
            ? Math.min(Number(range[2]), file.length - 1)
            : file.length - 1;
          res.writeHead(206, {
            'Content-Type': 'video/mp4',
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${file.length}`,
            'Content-Length': end - start + 1,
          });
          res.end(file.subarray(start, end + 1));
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Length': file.length,
        });
        res.end(file);
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      try {
        const addr = server.address();
        const port = typeof addr === 'object' && addr ? addr.port : 0;
        const trusted = `http://127.0.0.1:${port}/assets/`;

        const tail = await probeVideoFromUrl(
          `${trusted}tenant-1/tail.mp4`,
          trusted,
        );
        expect(tail).toMatchObject({
          ok: true,
          displayWidth: 1280,
          displayHeight: 720,
          codec: 'h264',
          container: 'mov,mp4,m4a,3gp,3g2,mj2',
          fastStart: false,
        });
        const front = await probeVideoFromUrl(
          `${trusted}tenant-1/front.mp4`,
          trusted,
        );
        expect(front).toMatchObject({ ok: true, fastStart: true });
        // Our own Range GET — distinct from ffprobe's open-ended seeks.
        expect(
          ranges.filter((r) => r === `bytes=0-${FAST_START_RANGE_BYTES - 1}`),
        ).toHaveLength(2);
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });
  },
);
