/**
 * transcode-runner.ts — the only place the transcode pipeline touches a
 * process: `ffprobe` and `ffmpeg`, spawned with a hard kill timer, an abort
 * signal, and the LOWEST scheduling priority (2026-09-23).
 *
 * Why the priority matters: this runs inside the API container — the process
 * that delivers lockdown alerts. The encode is capped at two threads
 * (transcode-profile.ts TRANSCODE_THREADS) AND reniced to 19, so under CPU
 * pressure the kernel always runs the API first and the transcode only gets
 * what is left over. A slower transcode is the correct trade.
 *
 * Injectable (`SpawnLike`) so the pipeline and worker specs run without a
 * binary; the one real-ffmpeg test lives in transcode-profile.spec.ts.
 */
import { spawn as nodeSpawn, execFile } from 'child_process';
import * as os from 'os';
import {
  buildProbeArgs,
  parseProbe,
  progressSecondsFrom,
  type ProbeResult,
} from './transcode-profile';

export type SpawnLike = typeof nodeSpawn;

export type RunResult = { ok: true } | { ok: false; reason: string };

export interface FfmpegRunner {
  /** Both binaries present and runnable. */
  available(): Promise<boolean>;
  /** Probe a LOCAL file. Rejects only on a probe that could not run or parse. */
  probe(file: string, timeoutMs?: number): Promise<ProbeResult>;
  /** Run ffmpeg with `args`; never rejects. */
  transcode(
    args: string[],
    opts: {
      timeoutMs: number;
      signal?: AbortSignal;
      onProgressSeconds?: (s: number) => void;
    },
  ): Promise<RunResult>;
}

/** Lowest priority for a child process; best-effort (never fatal). */
function deprioritise(pid: number | undefined): void {
  if (!pid) return;
  try {
    os.setPriority(pid, 19);
  } catch {
    /* unsupported / not permitted — the thread cap still bounds it */
  }
}

export class SpawnFfmpegRunner implements FfmpegRunner {
  constructor(private readonly spawnFn: SpawnLike = nodeSpawn) {}

  available(): Promise<boolean> {
    const check = (bin: string) =>
      new Promise<boolean>((resolve) => {
        execFile(
          bin,
          ['-hide_banner', '-version'],
          { timeout: 10_000 },
          (err) => resolve(!err),
        );
      });
    return Promise.all([check('ffmpeg'), check('ffprobe')]).then(
      ([a, b]) => a && b,
    );
  }

  probe(file: string, timeoutMs = 60_000): Promise<ProbeResult> {
    return new Promise((resolve, reject) => {
      let proc: ReturnType<SpawnLike>;
      try {
        proc = this.spawnFn('ffprobe', buildProbeArgs(file), {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e: any) {
        reject(new Error(`ffprobe spawn: ${e?.message ?? e}`));
        return;
      }
      deprioritise(proc.pid);
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* gone */
        }
        reject(new Error(`ffprobe timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      proc.stdout?.on('data', (d: Buffer | string) => {
        out += d.toString();
        if (out.length > 2 * 1024 * 1024) out = out.slice(0, 2 * 1024 * 1024); // a probe is kilobytes
      });
      proc.stderr?.on('data', (d: Buffer | string) => {
        err += d.toString();
        if (err.length > 4096) err = err.slice(-4096);
      });
      proc.on('error', (e: any) => {
        clearTimeout(timer);
        reject(new Error(`ffprobe: ${e?.message ?? e}`));
      });
      proc.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`ffprobe exited ${code}: ${err.slice(-300)}`));
          return;
        }
        try {
          resolve(parseProbe(JSON.parse(out)));
        } catch (e: any) {
          reject(new Error(`ffprobe output unreadable: ${e?.message ?? e}`));
        }
      });
    });
  }

  transcode(
    args: string[],
    opts: {
      timeoutMs: number;
      signal?: AbortSignal;
      onProgressSeconds?: (s: number) => void;
    },
  ): Promise<RunResult> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (r: RunResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        resolve(r);
      };
      if (opts.signal?.aborted) {
        resolve({ ok: false, reason: 'aborted' });
        return;
      }
      let proc: ReturnType<SpawnLike>;
      try {
        proc = this.spawnFn('ffmpeg', args, {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch (e: any) {
        resolve({ ok: false, reason: `spawn: ${e?.message ?? e}` });
        return;
      }
      deprioritise(proc.pid);
      const kill = () => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* gone */
        }
      };
      const timer = setTimeout(() => {
        kill();
        finish({
          ok: false,
          reason: `timeout after ${Math.round(opts.timeoutMs / 1000)}s`,
        });
      }, opts.timeoutMs);
      const onAbort = () => {
        kill();
        finish({ ok: false, reason: 'aborted' });
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      let stderr = '';
      proc.stdout?.on('data', (d: Buffer | string) => {
        const s = progressSecondsFrom(d.toString());
        if (s !== null) opts.onProgressSeconds?.(s);
      });
      proc.stderr?.on('data', (d: Buffer | string) => {
        stderr += d.toString();
        if (stderr.length > 4096) stderr = stderr.slice(-4096);
      });
      proc.on('error', (e: any) =>
        finish({ ok: false, reason: `spawn: ${e?.message ?? e}` }),
      );
      proc.on('close', (code: number | null) => {
        if (code === 0) finish({ ok: true });
        else
          finish({
            ok: false,
            reason: `ffmpeg exited ${code}: ${stderr.slice(-300)}`,
          });
      });
    });
  }
}
