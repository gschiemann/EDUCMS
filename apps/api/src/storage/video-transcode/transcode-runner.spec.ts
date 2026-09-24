/**
 * SpawnFfmpegRunner — the process boundary (2026-09-23). A fake spawn pins the
 * failure modes (a wedged ffmpeg is SIGKILLed at its budget, an abort kills it,
 * a non-zero exit is a soft failure, progress is parsed off stdout); one REAL
 * run (skipped without ffmpeg/ffprobe) proves probe + transcode + progress
 * through the actual binaries.
 */
import { EventEmitter } from 'events';
import { execFileSync } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SpawnFfmpegRunner } from './transcode-runner';
import { buildTranscodeArgs, planTranscode } from './transcode-profile';

function fakeProc() {
  const proc: any = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = undefined; // nothing to renice
  proc.kill = jest.fn(() => {
    setImmediate(() => proc.emit('close', null));
    return true;
  });
  return proc;
}

describe('SpawnFfmpegRunner.transcode (fake spawn)', () => {
  it('reports progress parsed from -progress output and resolves ok on exit 0', async () => {
    const proc = fakeProc();
    const runner = new SpawnFfmpegRunner((() => proc) as any);
    const seen: number[] = [];
    const p = runner.transcode(['x'], { timeoutMs: 5_000, onProgressSeconds: (s) => seen.push(s) });
    proc.stdout.emit('data', 'out_time_us=2000000\nprogress=continue\n');
    proc.stdout.emit('data', 'out_time_us=4500000\nprogress=end\n');
    proc.emit('close', 0);
    await expect(p).resolves.toEqual({ ok: true });
    expect(seen).toEqual([2, 4.5]);
  });

  it('a non-zero exit is a soft failure carrying the stderr tail', async () => {
    const proc = fakeProc();
    const runner = new SpawnFfmpegRunner((() => proc) as any);
    const p = runner.transcode(['x'], { timeoutMs: 5_000 });
    proc.stderr.emit('data', 'moov atom not found');
    proc.emit('close', 1);
    const r = await p;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('moov atom not found');
  });

  it('SIGKILLs a wedged ffmpeg at its budget', async () => {
    const proc = fakeProc();
    const runner = new SpawnFfmpegRunner((() => proc) as any);
    const r = await runner.transcode(['x'], { timeoutMs: 30 });
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
    expect(r).toEqual({ ok: false, reason: 'timeout after 0s' });
  });

  it('an abort kills it at once', async () => {
    const proc = fakeProc();
    const runner = new SpawnFfmpegRunner((() => proc) as any);
    const ac = new AbortController();
    const p = runner.transcode(['x'], { timeoutMs: 60_000, signal: ac.signal });
    ac.abort();
    await expect(p).resolves.toEqual({ ok: false, reason: 'aborted' });
    expect(proc.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('a missing binary is a soft failure, never a throw', async () => {
    const runner = new SpawnFfmpegRunner((() => {
      throw new Error('spawn ffmpeg ENOENT');
    }) as any);
    await expect(runner.transcode(['x'], { timeoutMs: 1000 })).resolves.toEqual({ ok: false, reason: 'spawn: spawn ffmpeg ENOENT' });
  });
});

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

describe('SpawnFfmpegRunner against the real binaries', () => {
  realIt('probes, transcodes with live progress, and the output probes as the plan', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runner-spec-'));
    try {
      const src = path.join(dir, 'src.mp4');
      execFileSync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
        '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=48000',
        '-t', '4', '-map', '0:v', '-map', '1:a',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '25M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', src,
      ]);
      const runner = new SpawnFfmpegRunner();
      expect(await runner.available()).toBe(true);
      const probe = await runner.probe(src);
      expect([probe.width, probe.height, probe.hasAudio]).toEqual([1280, 720, true]);
      const d = planTranscode(probe);
      expect(d.action).toBe('transcode');
      if (d.action !== 'transcode') return;
      const out = path.join(dir, 'out.mp4');
      const seen: number[] = [];
      const r = await runner.transcode(buildTranscodeArgs(src, out, d.plan, { sizeLimitBytes: (await fs.stat(src)).size }), {
        timeoutMs: 60_000,
        onProgressSeconds: (s) => seen.push(s),
      });
      expect(r).toEqual({ ok: true });
      expect(seen.length).toBeGreaterThan(0);
      const outProbe = await runner.probe(out);
      expect([outProbe.width, outProbe.height, outProbe.videoCodec, outProbe.hasAudio]).toEqual([1280, 720, 'h264', true]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
