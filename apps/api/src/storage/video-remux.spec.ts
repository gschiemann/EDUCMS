/**
 * video-remux.spec.ts — the lossless fast-start re-mux.
 *
 * WHY MOST OF THE SPAWN IS FAKED. Same reason as video-poster.spec.ts: the
 * production image ships ffmpeg (the Dockerfile hard-fails without it) but a
 * CI runner is not guaranteed to. Every contract here runs against an
 * injected `spawn`; the block that needs the real binaries is gated on
 * `ffmpeg -version` + `ffprobe -version` and is SKIPPED, never failed,
 * without them.
 */
import { execFileSync } from 'child_process';
import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isMintedUploadPath } from '../assets/upload-path';
import {
  buildProbeMeta,
  mergeProbeMeta,
  needsProbe,
  probeVideoFromBuffer,
  readIsoBmffFastStart,
  type ProbeSuccess,
  type SpawnLike,
} from './video-probe';
import {
  alreadyFastStart,
  buildRemuxArgs,
  buildRemuxMeta,
  MAX_REMUX_BYTES,
  mergeRemuxMeta,
  needsFastStartRemux,
  probedReplacedOriginal,
  remuxFastStart,
  remuxParityProblem,
  remuxStoragePath,
  remuxTimeoutMs,
  REMUX_MAX_TIMEOUT_MS,
  retainedOriginalPath,
} from './video-remux';

// ── fixtures ────────────────────────────────────────────────────────────────

/** One ISO-BMFF box: 4-byte big-endian size + 4-char type + payload. */
function box(type: string, payload: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, payload]);
}
const FTYP = box('ftyp', Buffer.from('isom\0\0\u0002\0isomiso2mp41', 'latin1'));
const SAMPLES = Buffer.alloc(256, 7);
/** Index in front — what a good re-mux writes. */
const FAST = Buffer.concat([
  FTYP,
  box('moov', Buffer.alloc(32)),
  box('mdat', SAMPLES),
]);
/** Index at the tail — ffmpeg's default mux, the file being fixed. */
const TAIL = Buffer.concat([
  FTYP,
  box('mdat', SAMPLES),
  box('moov', Buffer.alloc(32)),
]);

const PROBE: ProbeSuccess = {
  ok: true,
  width: 1920,
  height: 1080,
  displayWidth: 1920,
  displayHeight: 1080,
  durationMs: 75_400,
  codec: 'h264',
  profile: 'High',
  level: 41,
  pixFmt: 'yuv420p',
  fps: 29.97,
  nominalFps: 30,
  variableFrameRate: false,
  bitrateKbps: 4523,
  rotation: 0,
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  fastStart: false,
  audio: { codec: 'aac', channels: 2, sampleRate: 48000 },
};
/** The same media, index in front. */
const REMUXED: ProbeSuccess = { ...PROBE, fastStart: true };

/** Minimal stand-in for a ChildProcess: a stderr stream, kill(), close / error. */
class FakeProc extends EventEmitter {
  readonly stderr = new EventEmitter();
  readonly kill = jest.fn(() => true);
}

interface FakeRun {
  /** Bytes the fake "ffmpeg" writes to its output path (the last argv entry). */
  write?: Buffer;
  exitCode?: number;
  stderr?: string;
  /** Emit 'error' instead of 'close' — what a missing binary does. */
  error?: Error;
  /** Never exit — the timeout's job. */
  hang?: boolean;
}

function fakeSpawn(run: FakeRun) {
  const procs: FakeProc[] = [];
  const fn = jest.fn((_cmd: string, args: string[]) => {
    const proc = new FakeProc();
    procs.push(proc);
    if (!run.hang) {
      setImmediate(() => {
        void (async () => {
          if (run.write) await fs.writeFile(args[args.length - 1], run.write);
          if (run.stderr) proc.stderr.emit('data', Buffer.from(run.stderr));
          if (run.error) proc.emit('error', run.error);
          else proc.emit('close', run.exitCode ?? 0);
        })();
      });
    }
    return proc;
  });
  return { spawn: fn as unknown as SpawnLike, fn, procs };
}

/** The `-i` argument of an argv. */
const inputOf = (args: string[]): string => args[args.indexOf('-i') + 1];

// ── the decision ────────────────────────────────────────────────────────────

describe('needsFastStartRemux', () => {
  it('is true only for an MP4 / MOV-family file whose index was READ to be at the end', () => {
    expect(needsFastStartRemux(PROBE)).toBe(true);
    expect(needsFastStartRemux({ container: 'mp4', fastStart: false })).toBe(
      true,
    );
    // The stored ProbeFacts carry the same two facts.
    expect(needsFastStartRemux(buildProbeMeta(PROBE).probe)).toBe(true);
  });

  it('never for a fast-start file, an unread box order, another container, or no facts', () => {
    expect(needsFastStartRemux(REMUXED)).toBe(false);
    expect(needsFastStartRemux({ ...PROBE, fastStart: null })).toBe(false);
    expect(
      needsFastStartRemux({ container: 'matroska,webm', fastStart: false }),
    ).toBe(false);
    expect(needsFastStartRemux({ container: null, fastStart: false })).toBe(
      false,
    );
    expect(needsFastStartRemux(null)).toBe(false);
    expect(needsFastStartRemux(undefined)).toBe(false);
  });
});

describe('buildRemuxArgs — the ffmpeg contract', () => {
  it('stream-copies every video, audio and subtitle stream into an MP4 with its index in front', () => {
    const args = buildRemuxArgs('/tmp/in.mp4', '/tmp/out.mp4');
    const line = args.join(' ');
    expect(line).toContain('-map 0:V -map 0:a? -map 0:s?');
    expect(line).toContain('-c copy');
    expect(line).toContain('-movflags +faststart');
    expect(line).toContain('-f mp4');
    expect(args).toContain('-nostdin');
    expect(inputOf(args)).toBe('/tmp/in.mp4');
    expect(args[args.length - 1]).toBe('/tmp/out.mp4');
    // A re-MUX, never a re-encode.
    expect(args).not.toContain('-c:v');
    expect(args).not.toContain('-crf');
  });
});

describe('remuxTimeoutMs', () => {
  const MB = 1024 * 1024;
  it('is 30 s plus 1 s per started 10 MB', () => {
    expect(remuxTimeoutMs(0)).toBe(30_000);
    expect(remuxTimeoutMs(1)).toBe(31_000);
    expect(remuxTimeoutMs(10 * MB)).toBe(31_000);
    expect(remuxTimeoutMs(10 * MB + 1)).toBe(32_000);
    expect(remuxTimeoutMs(257 * MB)).toBe(56_000);
    expect(remuxTimeoutMs(500 * MB)).toBe(80_000);
    expect(remuxTimeoutMs(MAX_REMUX_BYTES)).toBe(235_000);
  });

  it('never exceeds 10 minutes', () => {
    expect(remuxTimeoutMs(10 * 1024 * MB)).toBe(REMUX_MAX_TIMEOUT_MS);
    expect(REMUX_MAX_TIMEOUT_MS).toBe(600_000);
  });
});

// ── the re-mux, against a fake ffmpeg ───────────────────────────────────────

describe('remuxFastStart — against a fake ffmpeg', () => {
  it('hands back the re-muxed bytes when they read fast-start', async () => {
    const { spawn, fn } = fakeSpawn({ write: FAST });
    const out = await remuxFastStart({ buffer: TAIL, ext: '.mp4' }, { spawn });
    expect(out).toEqual({
      ok: true,
      buffer: FAST,
      bytesBefore: TAIL.length,
      bytesAfter: FAST.length,
    });
    expect(fn).toHaveBeenCalledTimes(1);
    const [cmd, args] = fn.mock.calls[0];
    expect(cmd).toBe('ffmpeg');
    expect(path.basename(inputOf(args))).toBe('in.mp4');
    expect(args).toEqual(buildRemuxArgs(inputOf(args), args[args.length - 1]));
  });

  it('runs the binary it is told to, and uses the extension only as a safe temp-file hint', async () => {
    const { spawn, fn } = fakeSpawn({ write: FAST });
    await remuxFastStart(
      { buffer: TAIL, ext: '.M4V' },
      { spawn, ffmpegPath: '/opt/ffmpeg/bin/ffmpeg' },
    );
    await remuxFastStart({ buffer: TAIL, ext: '../../etc/passwd' }, { spawn });
    expect(fn.mock.calls[0][0]).toBe('/opt/ffmpeg/bin/ffmpeg');
    expect(path.basename(inputOf(fn.mock.calls[0][1]))).toBe('in.m4v');
    expect(path.basename(inputOf(fn.mock.calls[1][1]))).toBe('in.mp4');
  });

  it('gives ffmpeg a kill budget scaled to the input size by default', async () => {
    const timers = jest.spyOn(global, 'setTimeout');
    try {
      await remuxFastStart(
        { buffer: TAIL },
        { spawn: fakeSpawn({ write: FAST }).spawn },
      );
      expect(timers.mock.calls.map((c) => c[1])).toContain(
        remuxTimeoutMs(TAIL.length),
      );
    } finally {
      timers.mockRestore();
    }
  });

  it('SIGKILLs a wedged ffmpeg at the budget and fails SOFT', async () => {
    const { spawn, procs } = fakeSpawn({ hang: true });
    const out = await remuxFastStart(
      { buffer: TAIL },
      { spawn, timeoutMs: 20 },
    );
    expect(out).toEqual({ ok: false, reason: 'timeout after 20ms' });
    expect(procs).toHaveLength(1);
    expect(procs[0].kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('fails SOFT when ffmpeg exits non-zero, carrying its last error line', async () => {
    const { spawn } = fakeSpawn({
      exitCode: 1,
      stderr: 'moov atom not found\n',
    });
    await expect(remuxFastStart({ buffer: TAIL }, { spawn })).resolves.toEqual({
      ok: false,
      reason: 'ffmpeg exited 1: moov atom not found',
    });
  });

  it('fails SOFT when the binary is missing — as an error event or a synchronous throw', async () => {
    const missing = fakeSpawn({ error: new Error('spawn ffmpeg ENOENT') });
    await expect(
      remuxFastStart({ buffer: TAIL }, { spawn: missing.spawn }),
    ).resolves.toEqual({ ok: false, reason: 'spawn: spawn ffmpeg ENOENT' });

    const throwing = jest.fn(() => {
      throw new Error('EACCES');
    }) as unknown as SpawnLike;
    await expect(
      remuxFastStart({ buffer: TAIL }, { spawn: throwing }),
    ).resolves.toEqual({ ok: false, reason: 'spawn: EACCES' });
  });

  it('refuses an input over the ceiling WITHOUT spawning — 2 GiB by default', async () => {
    expect(MAX_REMUX_BYTES).toBe(2 * 1024 * 1024 * 1024);
    const { spawn, fn } = fakeSpawn({ write: FAST });
    const out = await remuxFastStart(
      { buffer: Buffer.alloc(17) },
      { spawn, maxBytes: 16 },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/^too-large: 17 bytes/);
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses empty input without spawning', async () => {
    const { spawn, fn } = fakeSpawn({ write: FAST });
    await expect(
      remuxFastStart({ buffer: Buffer.alloc(0) }, { spawn }),
    ).resolves.toEqual({ ok: false, reason: 'empty-buffer' });
    expect(fn).not.toHaveBeenCalled();
  });

  it('NEVER hands back bytes that do not read fast-start', async () => {
    const cases: Array<[Buffer, string]> = [
      [TAIL, 'mdat before moov'],
      [Buffer.from('not a box structure at all'), 'no readable box order'],
    ];
    for (const [written, reads] of cases) {
      const { spawn } = fakeSpawn({ write: written });
      await expect(
        remuxFastStart({ buffer: TAIL }, { spawn }),
      ).resolves.toEqual({
        ok: false,
        reason: `output-not-fast-start: the re-muxed file reads ${reads}`,
      });
    }
  });

  it('fails SOFT when ffmpeg exits 0 but wrote nothing, or wrote an empty file', async () => {
    const none = await remuxFastStart(
      { buffer: TAIL },
      { spawn: fakeSpawn({}).spawn },
    );
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.reason).toMatch(/^no-output: /);

    await expect(
      remuxFastStart(
        { buffer: TAIL },
        { spawn: fakeSpawn({ write: Buffer.alloc(0) }).spawn },
      ),
    ).resolves.toEqual({ ok: false, reason: 'empty-output' });
  });

  it('cleans up its temp directory on success AND on failure', async () => {
    const count = async () =>
      (await fs.readdir(os.tmpdir())).filter((f) => f.startsWith('edu-remux-'))
        .length;
    const before = await count();
    await remuxFastStart(
      { buffer: TAIL },
      { spawn: fakeSpawn({ write: FAST }).spawn },
    );
    await remuxFastStart(
      { buffer: TAIL },
      { spawn: fakeSpawn({ exitCode: 1 }).spawn },
    );
    expect(await count()).toBe(before);
  });
});

// ── is it the same media? ───────────────────────────────────────────────────

describe('remuxParityProblem', () => {
  it('passes the same media with its index in front', () => {
    expect(remuxParityProblem(PROBE, REMUXED)).toBeNull();
  });

  it('passes a duration that moved within 1 % / 250 ms (edit-list rounding)', () => {
    expect(
      remuxParityProblem(PROBE, { ...REMUXED, durationMs: 75_400 + 700 }),
    ).toBeNull();
  });

  it('fails a file that does not probe, or does not read fast-start', () => {
    expect(
      remuxParityProblem(PROBE, { ok: false, reason: 'moov atom not found' }),
    ).toBe('the re-muxed file does not probe (moov atom not found)');
    expect(remuxParityProblem(PROBE, { ...REMUXED, fastStart: false })).toBe(
      'the re-muxed file does not read fast-start',
    );
    expect(remuxParityProblem(PROBE, { ...REMUXED, fastStart: null })).toBe(
      'the re-muxed file does not read fast-start',
    );
  });

  it('names every fact a stream copy cannot change', () => {
    const problem = remuxParityProblem(PROBE, {
      ...REMUXED,
      codec: 'hevc',
      width: 1280,
      height: 720,
      rotation: 90,
      audio: null,
      durationMs: 30_000,
    });
    expect(problem).toContain('codec h264 → hevc');
    expect(problem).toContain('size 1920×1080 → 1280×720');
    expect(problem).toContain('rotation 0° → 90°');
    expect(problem).toContain('audio aac/2ch → none');
    expect(problem).toContain('duration 75400 → 30000 ms');
  });

  it('a lost duration fails; an original with no duration is not compared', () => {
    expect(remuxParityProblem(PROBE, { ...REMUXED, durationMs: null })).toBe(
      'the re-muxed file is not the same media: duration 75400 → null ms',
    );
    expect(
      remuxParityProblem(
        { ...PROBE, durationMs: null },
        { ...REMUXED, durationMs: 1 },
      ),
    ).toBeNull();
  });
});

// ── where the copy lives, and what the row records ──────────────────────────

describe('remuxStoragePath', () => {
  it('sits beside the original, same folder, as <basename>-faststart-<token>.mp4', () => {
    expect(remuxStoragePath('t1/abc.mp4', 'deadbeef')).toBe(
      't1/abc-faststart-deadbeef.mp4',
    );
    expect(remuxStoragePath('t1/uploads/Clip.M4V', 'deadbeef')).toBe(
      't1/uploads/Clip-faststart-deadbeef.mp4',
    );
    expect(remuxStoragePath('abc.mp4', 'deadbeef')).toBe(
      'abc-faststart-deadbeef.mp4',
    );
  });

  it('takes a fresh token per attempt, so a losing replica can only ever delete its own copy', () => {
    const a = remuxStoragePath('t1/abc.mp4');
    const b = remuxStoragePath('t1/abc.mp4');
    expect(a).toMatch(/^t1\/abc-faststart-[0-9a-f]{8}\.mp4$/);
    expect(b).not.toBe(a);
  });

  it('never stacks suffixes on a file that was already a copy', () => {
    expect(remuxStoragePath('t1/abc-faststart-deadbeef.mp4', 'cafef00d')).toBe(
      't1/abc-faststart-cafef00d.mp4',
    );
  });

  it('can never be claimed by POST /assets/complete-upload (not a minted upload path)', () => {
    const original = 't1/f81d4fae-7dec-11d0-a765-00a0c91e6bf6.mp4';
    expect(isMintedUploadPath(original, 't1')).toBe(true);
    expect(isMintedUploadPath(remuxStoragePath(original), 't1')).toBe(false);
  });
});

describe('processingMeta — the remux record', () => {
  const AT = new Date('2026-09-24T12:00:00.000Z');
  const RECORD = buildRemuxMeta(
    { previousStoragePath: 't1/abc.mp4', bytesBefore: 1000, bytesAfter: 998 },
    AT,
  );

  it('buildRemuxMeta is exactly { at, reason, previousStoragePath, bytesBefore, bytesAfter }', () => {
    expect(RECORD).toEqual({
      at: '2026-09-24T12:00:00.000Z',
      reason: 'fast-start',
      previousStoragePath: 't1/abc.mp4',
      bytesBefore: 1000,
      bytesAfter: 998,
    });
  });

  it("mergeRemuxMeta: the NEW file's probe over the row, every other key kept, stale failure cleared, record added", () => {
    const existing = {
      ...mergeProbeMeta({ originalSize: 9_000_000 }, PROBE, AT),
      probeFailed: 'stale',
      probeFailedVersion: 2,
    };
    const merged = mergeRemuxMeta(existing, REMUXED, RECORD, AT);
    expect(merged.originalSize).toBe(9_000_000);
    expect(merged.originalDimensions).toEqual({ w: 1920, h: 1080 });
    expect(merged.probe.fastStart).toBe(true);
    expect(merged.remux).toEqual(RECORD);
    expect(merged).not.toHaveProperty('probeFailed');
    expect(merged).not.toHaveProperty('probeFailedVersion');
    // The auto-heal cron's predicate (needsProbe is its in-process twin)
    // never selects the swapped row again, and no later pass re-muxes it.
    expect(needsProbe(merged)).toBe(false);
    expect(alreadyFastStart(merged)).toBe(true);
  });

  it('alreadyFastStart: a remux record, or a stored probe that reads fast-start', () => {
    expect(alreadyFastStart({ remux: RECORD })).toBe(true);
    expect(alreadyFastStart({ probe: { fastStart: true } })).toBe(true);
    expect(alreadyFastStart({ probe: { fastStart: false } })).toBe(false);
    expect(alreadyFastStart({ probe: { fastStart: null } })).toBe(false);
    expect(alreadyFastStart(null)).toBe(false);
    expect(alreadyFastStart('garbage')).toBe(false);
  });

  it("retainedOriginalPath: only the shape the swap writes, under the row's own tenant folder", () => {
    const meta = (p: unknown) => ({ remux: { previousStoragePath: p } });
    expect(retainedOriginalPath(meta('t1/abc.mp4'), 't1')).toBe('t1/abc.mp4');
    expect(retainedOriginalPath(meta('t2/abc.mp4'), 't1')).toBeNull();
    expect(retainedOriginalPath(meta('t10/abc.mp4'), 't1')).toBeNull();
    expect(retainedOriginalPath(meta('t1/../t2/abc.mp4'), 't1')).toBeNull();
    expect(retainedOriginalPath(meta('t1/'), 't1')).toBeNull();
    expect(retainedOriginalPath(meta(42), 't1')).toBeNull();
    expect(retainedOriginalPath({}, 't1')).toBeNull();
    expect(retainedOriginalPath(null, 't1')).toBeNull();
    expect(retainedOriginalPath(meta('t1/abc.mp4'), '')).toBeNull();
  });

  it('probedReplacedOriginal: a probe of the original never speaks for a row that moved onto its copy', () => {
    const moved = { remux: RECORD };
    // The upload's own bytes, or the recorded original's path: the original.
    expect(probedReplacedOriginal(moved, null)).toBe(true);
    expect(probedReplacedOriginal(moved, undefined)).toBe(true);
    expect(probedReplacedOriginal(moved, 't1/abc.mp4')).toBe(true);
    // The copy itself (what the cron and "Check this file" read after the swap).
    expect(probedReplacedOriginal(moved, 't1/abc-faststart-1a2b3c4d.mp4')).toBe(
      false,
    );
    // A row that was never re-muxed: every probe describes its file.
    expect(probedReplacedOriginal({ probe: { fastStart: false } }, null)).toBe(
      false,
    );
    expect(probedReplacedOriginal(null, 't1/abc.mp4')).toBe(false);
  });
});

// ── REAL ffmpeg, when the box has one ───────────────────────────────────────
// The only tests that prove the argv above re-muxes a real file losslessly.
// Skipped (never failed) where the binaries are absent, so they cannot turn a
// CI runner without them red — the production image is guaranteed both.
const hasTools = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

/** Does this ffmpeg carry the named encoder? libx264 is optional in some builds. */
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

/** `-display_rotation` (ffmpeg ≥ 6.0) is how a rotation FLAG is written onto a stream copy. */
const canFlagRotation = (() => {
  if (!hasTools) return false;
  try {
    return execFileSync('ffmpeg', ['-hide_banner', '-h', 'long'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .includes('-display_rotation');
  } catch {
    return false;
  }
})();

(hasTools ? describe : describe.skip)(
  'remuxFastStart — against a REAL ffmpeg',
  () => {
    jest.setTimeout(120_000);
    const videoCodec = hasEncoder('libx264') ? 'libx264' : 'mpeg4';
    let dir = '';
    beforeAll(async () => {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-fixture-remux-'));
    });
    afterAll(async () => {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    });

    const ffmpeg = (args: string[]): Buffer =>
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args]);

    /** A 1 s clip with audio, muxed the ffmpeg default way: index at the TAIL. */
    const makeTailVideo = (name: string, size = '64x64'): string => {
      const out = path.join(dir, name);
      ffmpeg([
        '-y',
        '-f',
        'lavfi',
        '-i',
        `testsrc=duration=1:size=${size}:rate=10`,
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=1000:duration=1',
        '-c:v',
        videoCodec,
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        out,
      ]);
      return out;
    };

    /** Per-packet MD5 + timestamps of every stream — identical ⇔ nothing was re-encoded. */
    const packetHashes = async (
      bytes: Buffer,
      name: string,
    ): Promise<string> => {
      const p = path.join(dir, name);
      await fs.writeFile(p, bytes);
      return ffmpeg(['-i', p, '-map', '0', '-c', 'copy', '-f', 'framemd5', '-'])
        .toString()
        .split('\n')
        .filter((line) => !line.startsWith('#'))
        .join('\n');
    };

    it("moves a real moov-last MP4's index to the front — same packets, same size, same facts", async () => {
      const before = await fs.readFile(makeTailVideo('tail.mp4'));
      expect(readIsoBmffFastStart(before)).toBe(false);

      const out = await remuxFastStart({ buffer: before, ext: '.mp4' });
      expect(out.ok).toBe(true);
      if (!out.ok) return;
      expect(readIsoBmffFastStart(out.buffer)).toBe(true);
      expect(out.bytesBefore).toBe(before.length);
      expect(Math.abs(out.bytesAfter - out.bytesBefore)).toBeLessThanOrEqual(
        out.bytesBefore * 0.1,
      );

      const probeBefore = await probeVideoFromBuffer(before, '.mp4');
      const probeAfter = await probeVideoFromBuffer(out.buffer, '.mp4');
      expect(probeBefore).toMatchObject({ ok: true, fastStart: false });
      expect(probeAfter).toMatchObject({
        ok: true,
        fastStart: true,
        width: 64,
        height: 64,
        audio: { codec: 'aac' },
      });
      if (!probeBefore.ok || !probeAfter.ok) return;
      expect(probeAfter.codec).toBe(probeBefore.codec);
      expect(remuxParityProblem(probeBefore, probeAfter)).toBeNull();
      // Lossless: every audio and video packet carried over bit for bit.
      expect(await packetHashes(out.buffer, 'after.mp4')).toBe(
        await packetHashes(before, 'before.mp4'),
      );
    });

    (canFlagRotation ? it : it.skip)(
      "keeps a portrait clip's rotation flag — the display matrix rides the stream copy",
      async () => {
        const rotated = path.join(dir, 'portrait.mp4');
        ffmpeg([
          '-y',
          '-display_rotation',
          '90',
          '-noautorotate',
          '-i',
          makeTailVideo('landscape.mp4', '96x64'),
          '-c',
          'copy',
          rotated,
        ]);
        const before = await fs.readFile(rotated);
        expect(readIsoBmffFastStart(before)).toBe(false);
        const out = await remuxFastStart({ buffer: before, ext: '.mp4' });
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        const probeAfter = await probeVideoFromBuffer(out.buffer, '.mp4');
        expect(probeAfter).toMatchObject({
          ok: true,
          fastStart: true,
          rotation: 90,
          width: 96,
          height: 64,
          displayWidth: 64,
          displayHeight: 96,
        });
      },
    );

    it('fails SOFT on bytes that are not a video at all', async () => {
      const out = await remuxFastStart({
        buffer: Buffer.from('hello, not a video'),
        ext: '.mp4',
      });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toMatch(/^ffmpeg exited /);
    });
  },
);
