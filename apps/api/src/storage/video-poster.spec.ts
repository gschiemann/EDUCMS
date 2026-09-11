/**
 * video-poster.spec.ts — the frame extractor.
 *
 * WHY THE SPAWN IS FAKED. The production image hard-fails its build without
 * ffmpeg (Dockerfile), but a GitHub runner is not guaranteed to ship it — and
 * this repo has been bitten twice by a gate that passed locally only because
 * the local tree carried something CI lacks. So every assertion here runs
 * against an injected `spawnFn`; the ONE test that needs a real binary is
 * gated on `ffmpeg -version` succeeding and is skipped (not failed) otherwise.
 */
import { EventEmitter } from 'events';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildPosterArgs,
  extractVideoPosterFromBuffer,
  extractVideoPosterFromUrl,
  isPosterableVideo,
  POSTER_EXT,
  POSTER_MIME,
} from './video-poster';

/** Minimal stand-in for a ChildProcess: emits `close`, carries a stderr stream. */
function fakeProc() {
  const proc: any = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = jest.fn();
  return proc;
}

/**
 * A fake spawn that (optionally) writes real bytes to the output path ffmpeg
 * was told to use — that output path is always the LAST argv entry.
 */
function makeSpawn(opts: {
  /** Per-invocation behaviour, in call order. Last entry repeats. */
  plan: Array<{
    exitCode: number;
    writeBytes?: Buffer | null;
    stderr?: string;
  }>;
  calls?: string[][];
}) {
  let n = 0;
  return jest.fn((_cmd: string, args: string[]) => {
    const step = opts.plan[Math.min(n, opts.plan.length - 1)];
    n++;
    opts.calls?.push(args);
    const proc = fakeProc();
    const outPath = args[args.length - 1];
    setImmediate(async () => {
      if (step.writeBytes)
        await fs.writeFile(outPath, step.writeBytes).catch(() => {});
      if (step.stderr) proc.stderr.emit('data', Buffer.from(step.stderr));
      proc.emit('close', step.exitCode);
    });
    return proc;
  }) as any;
}

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46,
]);
const FAKE_VIDEO = Buffer.from('not really a video, the spawn is faked');

describe('isPosterableVideo', () => {
  it('accepts every video/* mime and nothing else', () => {
    expect(isPosterableVideo('video/mp4')).toBe(true);
    expect(isPosterableVideo('VIDEO/WEBM')).toBe(true);
    expect(isPosterableVideo('video/x-m4v')).toBe(true);
    expect(isPosterableVideo('image/png')).toBe(false);
    expect(isPosterableVideo('application/pdf')).toBe(false);
    expect(isPosterableVideo(null)).toBe(false);
    expect(isPosterableVideo(undefined)).toBe(false);
    expect(isPosterableVideo('')).toBe(false);
  });
});

describe('buildPosterArgs — the ffmpeg contract', () => {
  it('input-seeks (so an http source range-reads), grabs ONE frame, drops audio', () => {
    const args = buildPosterArgs('/tmp/in.mp4', '/tmp/out.jpg', 1);
    // -ss BEFORE -i is the input seek; getting this backwards would stream the
    // whole file for a poster.
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
    expect(args).toEqual(
      expect.arrayContaining(['-frames:v', '1', '-an', '-c:v', 'mjpeg']),
    );
    // Capital V excludes attached cover art from being "the frame".
    expect(args).toEqual(expect.arrayContaining(['-map', '0:V:0']));
    expect(args[args.length - 1]).toBe('/tmp/out.jpg');
  });

  it('never upscales — the scale filter is min(maxWidth, iw)', () => {
    const args = buildPosterArgs('/tmp/in.mp4', '/tmp/out.jpg', 1, 640);
    expect(args.join(' ')).toContain("scale='min(640,iw)':-2");
  });

  it('omits the seek entirely at 0s (a 0-length seek on a short clip is a no-op)', () => {
    expect(buildPosterArgs('/tmp/in.mp4', '/tmp/out.jpg', 0)).not.toContain(
      '-ss',
    );
  });
});

describe('extractVideoPosterFromBuffer', () => {
  it('returns the JPEG bytes ffmpeg wrote', async () => {
    const out = await extractVideoPosterFromBuffer(FAKE_VIDEO, '.mp4', {
      spawnFn: makeSpawn({ plan: [{ exitCode: 0, writeBytes: JPEG }] }),
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.mimeType).toBe(POSTER_MIME);
    expect(out.ext).toBe(POSTER_EXT);
    expect(out.bytes).toBe(JPEG.length);
    expect(out.buffer.equals(JPEG)).toBe(true);
    expect(out.seekSeconds).toBe(1);
  });

  it('retries at 0s when the 1s seek produced no frame (a sub-second clip)', async () => {
    const calls: string[][] = [];
    const out = await extractVideoPosterFromBuffer(FAKE_VIDEO, '.mp4', {
      spawnFn: makeSpawn({
        // First rung: exits 0 but writes nothing — exactly what seeking past
        // the end of a short clip does. Second rung: a real frame.
        plan: [
          { exitCode: 0, writeBytes: null },
          { exitCode: 0, writeBytes: JPEG },
        ],
        calls,
      }),
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.seekSeconds).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain('-ss');
    expect(calls[1]).not.toContain('-ss');
  });

  it('fails SOFT (never throws) when ffmpeg exits non-zero on every rung', async () => {
    const out = await extractVideoPosterFromBuffer(FAKE_VIDEO, '.mp4', {
      spawnFn: makeSpawn({
        plan: [{ exitCode: 1, stderr: 'Invalid data found' }],
      }),
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('ffmpeg exited 1');
  });

  it('fails SOFT when the ffmpeg binary is missing entirely', async () => {
    const spawnFn = jest.fn(() => {
      const proc = fakeProc();
      setImmediate(() => proc.emit('error', new Error('spawn ffmpeg ENOENT')));
      return proc;
    }) as any;
    const out = await extractVideoPosterFromBuffer(FAKE_VIDEO, '.mp4', {
      spawnFn,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('ENOENT');
  });

  it('SIGKILLs and fails SOFT on timeout — a wedged ffmpeg never wedges the caller', async () => {
    const proc = fakeProc();
    const spawnFn = jest.fn(() => proc) as any; // never emits close
    const out = await extractVideoPosterFromBuffer(FAKE_VIDEO, '.mp4', {
      spawnFn,
      timeoutMs: 15,
      seekSeconds: [1],
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('timeout');
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('rejects empty input without spawning anything', async () => {
    const spawnFn = jest.fn() as any;
    const out = await extractVideoPosterFromBuffer(Buffer.alloc(0), '.mp4', {
      spawnFn,
    });
    expect(out).toEqual({ ok: false, reason: 'empty-buffer' });
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('cleans up its temp directories (no /tmp leak per upload)', async () => {
    const before = (await fs.readdir(os.tmpdir())).filter((f) =>
      f.startsWith('edu-poster-'),
    ).length;
    await extractVideoPosterFromBuffer(FAKE_VIDEO, '.mp4', {
      spawnFn: makeSpawn({ plan: [{ exitCode: 0, writeBytes: JPEG }] }),
    });
    const after = (await fs.readdir(os.tmpdir())).filter((f) =>
      f.startsWith('edu-poster-'),
    ).length;
    expect(after).toBe(before);
  });
});

describe('extractVideoPosterFromUrl — SSRF boundary', () => {
  const TRUSTED = 'https://proj.supabase.co/storage/v1/object/public/assets/';

  it('refuses a URL outside the trusted prefix WITHOUT spawning ffmpeg', async () => {
    const spawnFn = jest.fn() as any;
    for (const bad of [
      'https://evil.example/x.mp4',
      'file:///etc/passwd',
      'http://169.254.169.254/latest/meta-data/',
      // Lookalike host — prefix matching is on the full URL, not the path.
      'https://proj.supabase.co.evil.example/storage/v1/object/public/assets/a.mp4',
    ]) {
      const out = await extractVideoPosterFromUrl(bad, TRUSTED, { spawnFn });
      expect(out).toEqual({ ok: false, reason: 'untrusted-source-url' });
    }
    expect(spawnFn).not.toHaveBeenCalled();
  });

  it('accepts a URL we built ourselves from SUPABASE_URL', async () => {
    const calls: string[][] = [];
    const url = `${TRUSTED}tenant-1/abc.mp4`;
    const out = await extractVideoPosterFromUrl(url, TRUSTED, {
      spawnFn: makeSpawn({ plan: [{ exitCode: 0, writeBytes: JPEG }], calls }),
    });
    expect(out.ok).toBe(true);
    expect(calls[0]).toContain(url);
  });

  it('refuses an empty URL / empty prefix', async () => {
    const spawnFn = jest.fn() as any;
    expect(await extractVideoPosterFromUrl('', TRUSTED, { spawnFn })).toEqual({
      ok: false,
      reason: 'no-url',
    });
    expect(
      await extractVideoPosterFromUrl(`${TRUSTED}a.mp4`, '', { spawnFn }),
    ).toEqual({
      ok: false,
      reason: 'untrusted-source-url',
    });
    expect(spawnFn).not.toHaveBeenCalled();
  });
});

// ── REAL ffmpeg, when the box has one ───────────────────────────────────────
// This is the only test that proves the argv above actually produces a JPEG.
// Skipped (never failed) where ffmpeg is absent, so it can't turn a CI runner
// without the binary red — the production image is guaranteed to have it.
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

(hasFfmpeg ? describe : describe.skip)(
  'extractVideoPoster — against a REAL ffmpeg',
  () => {
    jest.setTimeout(60_000);
    let dir: string;
    beforeAll(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-poster-fixture-'));
    });
    afterAll(async () => {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    });

    const makeVideo = (name: string, seconds: number, size = '1280x720') => {
      const out = path.join(dir, name);
      execFileSync('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc=size=${size}:rate=15:duration=${seconds}`,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        out,
      ]);
      return out;
    };

    it('produces a real JPEG from a real MP4, downscaled and never upscaled', async () => {
      const buf = await fs.readFile(makeVideo('clip.mp4', 3));
      const out = await extractVideoPosterFromBuffer(buf, '.mp4');
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      // SOI marker — it really is a JPEG, not an empty file we called one.
      expect(out.buffer[0]).toBe(0xff);
      expect(out.buffer[1]).toBe(0xd8);
      expect(out.bytes).toBeGreaterThan(1000);
      // A poster must be far smaller than the video it stands in for.
      expect(out.bytes).toBeLessThan(buf.length);
      expect(out.seekSeconds).toBe(1);
    });

    it('still gets a frame out of a clip SHORTER than the seek (the 0s rung)', async () => {
      const buf = await fs.readFile(makeVideo('tiny.mp4', 0.4, '320x240'));
      const out = await extractVideoPosterFromBuffer(buf, '.mp4');
      expect(out.ok).toBe(true);
      if (out.ok) expect(out.seekSeconds).toBe(0);
    });

    it('fails SOFT on a file that is not a video at all', async () => {
      const out = await extractVideoPosterFromBuffer(
        Buffer.from('hello, not a video'),
        '.mp4',
      );
      expect(out.ok).toBe(false);
    });
  },
);
