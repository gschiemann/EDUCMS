/**
 * video-probe.spec.ts — the ffprobe reader.
 *
 * WHY THE SPAWN IS FAKED. The production image hard-fails its build without
 * ffprobe (Dockerfile), but a GitHub runner is not guaranteed to ship it — and
 * this repo has been bitten by gates that passed locally only because the
 * local tree carried something CI lacks. So every assertion here runs against
 * an injected `spawnFn` that plays back real ffprobe JSON; the tests that need
 * a binary are gated on `ffprobe -version` succeeding and are skipped (not
 * failed) otherwise.
 */
import { EventEmitter } from 'events';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import {
  buildProbeArgs,
  buildProbeMeta,
  formatDurationMs,
  hasUsableDimensions,
  mergeProbeMeta,
  parseProbeJson,
  probeVideoFromBuffer,
  probeVideoFromUrl,
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

/** Real ffprobe 6.1 output shape for `-of json` with our -show_entries. */
function ffprobeJson(over: {
  stream?: Record<string, unknown> | null;
  format?: Record<string, unknown>;
}) {
  const stream =
    over.stream === null
      ? undefined
      : {
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          avg_frame_rate: '30/1',
          duration: '2.000000',
          ...(over.stream ?? {}),
        };
  return JSON.stringify({
    ...(stream ? { streams: [stream] } : { streams: [] }),
    format: { duration: '2.000000', ...(over.format ?? {}) },
  });
}

const FAKE_VIDEO = Buffer.from('not really a video, the spawn is faked');

async function probe(
  stdout: string,
  extra: Parameters<typeof makeSpawn>[0] = {},
) {
  return probeVideoFromBuffer(FAKE_VIDEO, '.mp4', {
    spawnFn: makeSpawn({ stdout, ...extra }),
  });
}

describe('buildProbeArgs — the ffprobe contract', () => {
  it('selects the first REAL video stream, asks for exactly our entries, prints JSON, input last', () => {
    const args = buildProbeArgs('/tmp/in.mp4');
    expect(args.slice(0, 2)).toEqual(['-v', 'error']);
    // Capital V: attached cover art must never be "the video".
    expect(args).toEqual(expect.arrayContaining(['-select_streams', 'V:0']));
    const entries = args[args.indexOf('-show_entries') + 1];
    for (const key of ['width', 'height', 'codec_name', 'avg_frame_rate'])
      expect(entries).toContain(key);
    // Both rotation encodings, and the container duration fallback.
    expect(entries).toContain('stream_side_data=rotation');
    expect(entries).toContain('stream_tags=rotate');
    expect(entries).toContain('format=duration');
    expect(args).toEqual(expect.arrayContaining(['-of', 'json']));
    expect(args[args.length - 1]).toBe('/tmp/in.mp4');
  });

  it('is the argv the runner actually spawns, against `ffprobe`', async () => {
    const calls: string[][] = [];
    await probe(ffprobeJson({}), { calls });
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, -1)).toEqual(buildProbeArgs('x').slice(0, -1));
  });
});

describe('parsing real ffprobe JSON', () => {
  it('landscape clip, no rotation: coded == display, duration/fps/codec read', async () => {
    const out = await probe(ffprobeJson({}));
    expect(out).toEqual({
      ok: true,
      width: 1920,
      height: 1080,
      displayWidth: 1920,
      displayHeight: 1080,
      durationMs: 2000,
      codec: 'h264',
      fps: 30,
      rotation: 0,
    });
  });

  it('side_data_list rotation -90 (ffprobe ≥ 5, a portrait phone clip): axes SWAP', async () => {
    const out = await probe(
      ffprobeJson({
        stream: {
          side_data_list: [{ rotation: -90 }],
        },
      }),
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
        format: { duration: '75.400000' },
      }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.durationMs).toBe(75_400);
  });

  it('reports null duration / fps rather than inventing them', async () => {
    const out = await probe(
      ffprobeJson({
        stream: { duration: 'N/A', avg_frame_rate: '0/0' },
        format: { duration: undefined },
      }),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.durationMs).toBeNull();
    expect(out.fps).toBeNull();
  });

  it('parses an NTSC frame rate ratio to 3 decimals', async () => {
    const out = await probe(
      ffprobeJson({ stream: { avg_frame_rate: '30000/1001' } }),
    );
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.fps).toBe(29.97);
  });

  it('parseProbeJson is directly usable and never throws on junk', () => {
    expect(
      parseProbeJson('{"streams":[{"width":"1280","height":"720"}]}'),
    ).toMatchObject({
      ok: true,
      width: 1280,
      height: 720,
    });
    expect(parseProbeJson('null')).toEqual({
      ok: false,
      reason: 'ffprobe-output-not-json',
    });
    expect(parseProbeJson('{"streams":[{"width":-1,"height":720}]}')).toEqual({
      ok: false,
      reason: 'no-video-dimensions',
    });
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
    await probe(ffprobeJson({}));
    await probe('', { exitCode: 1 });
    expect(await count()).toBe(before);
  });
});

describe('probeVideoFromUrl — SSRF boundary', () => {
  const TRUSTED = 'https://proj.supabase.co/storage/v1/object/public/assets/';

  it('refuses a URL outside the trusted prefix WITHOUT spawning ffprobe', async () => {
    const spawnFn = jest.fn() as any;
    for (const bad of [
      'https://evil.example/x.mp4',
      'file:///etc/passwd',
      'http://169.254.169.254/latest/meta-data/',
      // Lookalike host — prefix matching is on the full URL, not the path.
      'https://proj.supabase.co.evil.example/storage/v1/object/public/assets/a.mp4',
      // A stored external Asset.fileUrl (POST /assets/url) is exactly this case.
      'https://cdn.partner.example/promo.mp4',
    ]) {
      const out = await probeVideoFromUrl(bad, TRUSTED, { spawnFn });
      expect(out).toEqual({ ok: false, reason: 'untrusted-source-url' });
    }
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('accepts a URL we built ourselves and hands ffprobe the URL directly (no download)', async () => {
    const calls: string[][] = [];
    const url = `${TRUSTED}tenant-1/abc.mp4`;
    const out = await probeVideoFromUrl(url, TRUSTED, {
      spawnFn: makeSpawn({ stdout: ffprobeJson({}), calls }),
    });
    expect(out.ok).toBe(true);
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
    fps: 29.97,
    rotation: 90,
  };
  const AT = new Date('2026-09-24T12:00:00.000Z');

  it('buildProbeMeta writes DISPLAY dims as originalDimensions and keeps the coded size under probe', () => {
    expect(buildProbeMeta(PORTRAIT, AT)).toEqual({
      originalDimensions: { w: 1080, h: 1920 },
      processedDimensions: null,
      durationMs: 75_400,
      probe: {
        codec: 'hevc',
        fps: 29.97,
        rotation: 90,
        codedWidth: 1920,
        codedHeight: 1080,
      },
      probedAt: '2026-09-24T12:00:00.000Z',
    });
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

  it('hasUsableDimensions — the candidate test and the idempotency guard', () => {
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

  it('formatDurationMs — m:ss under an hour, h:mm:ss above, null when unknown', () => {
    expect(formatDurationMs(75_400)).toBe('1:15');
    expect(formatDurationMs(2_000)).toBe('0:02');
    expect(formatDurationMs(3_725_000)).toBe('1:02:05');
    expect(formatDurationMs(0)).toBeNull();
    expect(formatDurationMs(null)).toBeNull();
    expect(formatDurationMs(undefined)).toBeNull();
    expect(formatDurationMs(Number.NaN)).toBeNull();
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

(hasTools ? describe : describe.skip)(
  'probeVideo — against a REAL ffprobe',
  () => {
    jest.setTimeout(60_000);
    let dir: string;
    beforeAll(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-probe-fixture-'));
    });
    afterAll(async () => {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    });

    const makeVideo = (
      name: string,
      extra: string[] = [],
      size = '1280x720',
      codec = 'libx264',
    ) => {
      const out = path.join(dir, name);
      execFileSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc=size=${size}:rate=30`,
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

    it('reads a real 1280×720 H.264 MP4: dims, ~2 s, 30 fps, no rotation', async () => {
      const buf = await fs.readFile(makeVideo('clip.mp4'));
      const out = await probeVideoFromBuffer(buf, '.mp4');
      expect(out).toMatchObject({
        ok: true,
        width: 1280,
        height: 720,
        displayWidth: 1280,
        displayHeight: 720,
        codec: 'h264',
        fps: 30,
        rotation: 0,
      });
      if (out.ok) expect(out.durationMs).toBeGreaterThanOrEqual(1900);
      if (out.ok) expect(out.durationMs).toBeLessThanOrEqual(2100);
    });

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
      execFileSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
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
    });

    it('fails SOFT on a file that is not a video at all', async () => {
      const out = await probeVideoFromBuffer(
        Buffer.from('hello, not a video'),
        '.mp4',
      );
      expect(out.ok).toBe(false);
    });

    it('probes over HTTP straight off a URL — the presign/backfill path — without a download', async () => {
      const file = await fs.readFile(makeVideo('http.mp4'));
      // A tiny Range-aware origin, because ffprobe seeks (moov lookup) over http.
      const server = http.createServer((req, res) => {
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
        const out = await probeVideoFromUrl(
          `${trusted}tenant-1/http.mp4`,
          trusted,
        );
        expect(out).toMatchObject({
          ok: true,
          displayWidth: 1280,
          displayHeight: 720,
          codec: 'h264',
        });
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    });
  },
);
