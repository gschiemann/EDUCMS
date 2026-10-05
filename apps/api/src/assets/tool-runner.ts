/**
 * tool-runner.ts — how the upload path runs a media tool as a child process,
 * and how many it runs at once (2026-10-05).
 *
 * Shared by the upload content check (ffprobe / ffmpeg, upload-content-check.
 * service.ts) and the HEIC converter (heif-dec, heif-convert.ts): ONE limiter for
 * both, because the process that runs them also delivers lockdown alerts — a
 * busy box makes the next file wait inside its budget, it never forks another
 * child. Moved here from upload-content-check.service.ts (which re-exports both)
 * so the converter can use them without importing the service.
 */
import { spawn as nodeSpawn } from 'child_process';
import type { ToolRun } from './upload-content-verdict';

const MAX_STDOUT_BYTES = 256 * 1024;
const MAX_STDERR_BYTES = 16 * 1024;

/** Run a tool with a SIGKILL at `timeoutMs`. Resolves on every path; output is capped. */
export function runTool(
  spawnFn: typeof nodeSpawn,
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<ToolRun> {
  return new Promise((resolve) => {
    if (!(timeoutMs > 0)) {
      resolve({
        exitCode: null,
        stdout: '',
        stderr: '',
        spawnError: null,
        timedOut: true,
      });
      return;
    }
    let settled = false;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const finish = (r: Omit<ToolRun, 'stdout' | 'stderr' | 'timedOut'>) => {
      if (settled) return;
      settled = true;
      resolve({ ...r, stdout, stderr, timedOut });
    };
    let proc: ReturnType<typeof nodeSpawn>;
    try {
      proc = spawnFn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      finish({ exitCode: null, spawnError: errorText(err) });
      return;
    }
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish({ exitCode: null, spawnError: null });
    }, timeoutMs);
    proc.stdout?.on('data', (d: Buffer | string) => {
      if (stdout.length < MAX_STDOUT_BYTES) stdout += d.toString();
    });
    proc.stderr?.on('data', (d: Buffer | string) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += d.toString();
    });
    proc.on('error', (err: Error) => {
      clearTimeout(timer);
      finish({ exitCode: null, spawnError: errorText(err) });
    });
    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      finish({ exitCode: code, spawnError: null });
    });
  });
}

/**
 * A small process-wide limiter for the upload path's children (ffprobe, ffmpeg,
 * heif-dec). `acquire` resolves a release function, or null when no slot frees
 * up before the deadline — which a caller treats as "could not run", never as a
 * verdict on the file.
 */
export class CheckSlots {
  private active = 0;
  private readonly waiting: Array<{
    grant: (release: (() => void) | null) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(readonly max: number) {}

  get inUse(): number {
    return this.active;
  }

  acquire(deadlineMs: number): Promise<(() => void) | null> {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve(this.releaser());
    }
    const wait = deadlineMs - Date.now();
    if (wait <= 0) return Promise.resolve(null);
    return new Promise((resolve) => {
      const entry = {
        grant: resolve,
        timer: setTimeout(() => {
          const i = this.waiting.indexOf(entry);
          if (i >= 0) this.waiting.splice(i, 1);
          resolve(null);
        }, wait),
      };
      this.waiting.push(entry);
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      while (this.active < this.max && this.waiting.length > 0) {
        const next = this.waiting.shift()!;
        clearTimeout(next.timer);
        this.active += 1;
        next.grant(this.releaser());
      }
    };
  }
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A positive integer from the environment, else the default. */
export function intEnv(name: string, def: number): number {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}
