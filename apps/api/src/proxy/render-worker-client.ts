/**
 * SEC-006 (durable half, 2026-09-05) — the PARENT side of the render boundary.
 *
 * Forks one disposable `render-worker.js` per render, hands it exactly one
 * job over IPC, and guarantees that whatever happens on the other side —
 * success, refusal, hang, crash, OOM, a Chromium renderer exploit — costs this
 * process nothing more than a `null` return.
 *
 * The five things that make that guarantee real:
 *
 *   1. ALLOWLISTED ENVIRONMENT. `buildWorkerEnv` starts from an empty object.
 *      `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `SESSION_SECRET`,
 *      `DEVICE_SECRET_KEY`, `DEVICE_JWT_SECRET`, `SUPABASE_*`,
 *      `PROXY_RENDER_SECRET` and every provider key are absent by
 *      construction, not by subtraction. `NODE_OPTIONS` is dropped too —
 *      Railway sets it to `--max-old-space-size=4096` and the browser process
 *      must not inherit a 4 GB heap.
 *
 *   2. ITS OWN PROCESS GROUP. `detached: true` makes the child a group leader,
 *      so the kill below is `process.kill(-pid)` — the whole Chromium tree,
 *      not just the Node shim. Killing only the shim is how you get orphaned
 *      `chromium` processes eating a Railway box until the next deploy.
 *
 *   3. A HARD WALL-CLOCK SIGKILL. Not a timeout that "asks" — SIGTERM then
 *      SIGKILL to the group. The child has its own, shorter budget so the
 *      normal path is a reported reason; this is the backstop for a child too
 *      wedged to report anything.
 *
 *   4. A THROWAWAY PROFILE DIRECTORY, created and destroyed HERE. A SIGKILLed
 *      child cannot clean up after itself, so the surviving process owns the
 *      lifecycle. No cookie, cache entry or service worker crosses renders.
 *
 *   5. OUTPUT IS UNTRUSTED INPUT. The child ran the hostile page, so its
 *      "result" is validated exactly like a request body: schema, size cap,
 *      and a re-check that the final URL is still a public http(s) URL.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePublicUrl } from '../branding/safe-fetch';
import {
  RENDER_PROTOCOL_VERSION,
  RENDER_WORKER_ENV_FLAG,
  buildWorkerEnv,
  parseWorkerMessage,
  sanitizeLogText,
  type RenderJobLimits,
  type RenderJobMessage,
} from './render-worker-protocol';
import type { PipelineLogger, PipelineOutcome } from './render-pipeline';

/**
 * Heap ceiling for the worker's NODE half, in MB.
 *
 * Small on purpose: the Node side only marshals a job and an HTML string.
 * Chromium's memory is its own and is bounded by the response-byte cap, the
 * HTML cap and the wall-clock kill. The API keeps its `NODE_OPTIONS`
 * `--max-old-space-size=4096`; the child does NOT inherit it.
 */
const WORKER_NODE_HEAP_MB = 256;

/** Bytes of child stderr retained for diagnostics on a failed render. */
const MAX_STDERR_CAPTURE = 4096;

/** Grace between SIGTERM and SIGKILL when the deadline fires. */
const SIGKILL_GRACE_MS = 1_500;

export interface RenderWorkerClientOptions {
  /** Overridable for tests. Defaults to the compiled worker next to this file. */
  workerScriptPath?: string;
  /** Chromium binary. Defaults to the container's. */
  executablePath?: string;
  /** Hard wall-clock ceiling before the group is killed. */
  killBudgetMs?: number;
  logger?: PipelineLogger;
}

const NOOP_LOGGER: PipelineLogger = { log: () => {}, warn: () => {}, error: () => {} };

export class RenderWorkerClient {
  private readonly workerScriptPath: string;
  private readonly executablePath: string;
  private readonly killBudgetMs: number;
  private readonly logger: PipelineLogger;

  /**
   * Exactly one live child at a time — see `RendererService.MAX_CONCURRENT`.
   * Tracked here as well so `onModuleDestroy` can reap it and so a caller that
   * bypassed the service's counter still cannot fan out browsers.
   */
  private active: ChildProcess | null = null;

  constructor(options: RenderWorkerClientOptions = {}) {
    this.workerScriptPath = options.workerScriptPath ?? join(__dirname, 'render-worker.js');
    this.executablePath =
      options.executablePath ??
      process.env.PUPPETEER_EXECUTABLE_PATH ??
      '/usr/bin/chromium-browser';
    this.killBudgetMs = options.killBudgetMs ?? 25_000;
    this.logger = options.logger ?? NOOP_LOGGER;
  }

  /** True when a compiled worker exists to fork. */
  isAvailable(): boolean {
    return existsSync(this.workerScriptPath);
  }

  /**
   * Render one URL in a fresh child process.
   *
   * Never throws and never leaves a process behind. A refusal is a value, so
   * `/api/v1/proxy/web` can DEGRADE to `safeFetch` rather than fail.
   */
  async run(url: string, limits: RenderJobLimits): Promise<PipelineOutcome> {
    if (this.active) return { ok: false, reason: 'worker-busy' };
    if (!this.isAvailable()) {
      this.logger.warn(
        `[ssr] render worker not found at ${this.workerScriptPath} — falling back to fetch`,
      );
      return { ok: false, reason: 'worker-script-missing' };
    }

    let profileDir: string;
    try {
      profileDir = await mkdtemp(join(tmpdir(), 'venueos-render-'));
    } catch (e: any) {
      this.logger.warn(`[ssr] could not create render profile dir: ${e?.message}`);
      return { ok: false, reason: 'profile-dir-failed' };
    }

    try {
      return await this.forkAndRender(url, limits, profileDir);
    } finally {
      // The parent owns this directory precisely because a SIGKILLed child
      // never gets to clean up.
      await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async forkAndRender(
    url: string,
    limits: RenderJobLimits,
    profileDir: string,
  ): Promise<PipelineOutcome> {
    const job: RenderJobMessage = {
      v: RENDER_PROTOCOL_VERSION,
      type: 'render',
      url,
      executablePath: this.executablePath,
      userDataDir: profileDir,
      limits,
    };

    const env = buildWorkerEnv(process.env, {
      [RENDER_WORKER_ENV_FLAG]: '1',
      // Point every "where do I keep my state" variable Chromium consults at
      // the throwaway profile, so nothing lands in the container's real HOME.
      HOME: profileDir,
      TMPDIR: profileDir,
      XDG_CONFIG_HOME: join(profileDir, 'config'),
      XDG_CACHE_HOME: join(profileDir, 'cache'),
      XDG_DATA_HOME: join(profileDir, 'data'),
      PUPPETEER_EXECUTABLE_PATH: this.executablePath,
      PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: 'true',
    });

    let child: ChildProcess;
    try {
      child = fork(this.workerScriptPath, [], {
        env,
        // `execArgv: []` drops the parent's flags (--inspect, and anything a
        // future NODE_OPTIONS would have added) and replaces them with the
        // worker's own small heap.
        execArgv: [`--max-old-space-size=${WORKER_NODE_HEAP_MB}`],
        // Own process group → the kill below reaches Chromium's children.
        detached: true,
        // No stdin at all; stdout/stderr piped so Chromium's noise never
        // interleaves into the API's log stream unfiltered.
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        // JSON, not structured clone: the only thing crossing this boundary is
        // plain data, and a narrower deserializer is the right one here.
        serialization: 'json',
        // The renderer must never outlive the API process.
        killSignal: 'SIGKILL',
      });
    } catch (e: any) {
      this.logger.error(`[ssr] failed to fork render worker: ${e?.message}`);
      return { ok: false, reason: 'worker-fork-failed' };
    }

    this.active = child;
    const pid = child.pid;
    let stderrTail = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderrTail.length < MAX_STDERR_CAPTURE) {
        stderrTail += chunk.toString('utf8').slice(0, MAX_STDERR_CAPTURE - stderrTail.length);
      }
    });
    // Chromium writes plenty to stdout in some failure modes; drain it so the
    // pipe can never fill and block the child.
    child.stdout?.resume();

    const outcome = await new Promise<PipelineOutcome>((resolve) => {
      let settled = false;
      const settle = (value: PipelineOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        clearTimeout(graceTimer);
        resolve(value);
      };

      let graceTimer: NodeJS.Timeout | undefined;
      const deadline = setTimeout(() => {
        this.logger.warn(
          `[ssr] render worker exceeded ${this.killBudgetMs}ms — killing pid=${pid ?? '?'}`,
        );
        this.killGroup(child, 'SIGTERM');
        graceTimer = setTimeout(() => this.killGroup(child, 'SIGKILL'), SIGKILL_GRACE_MS);
        graceTimer.unref?.();
        settle({ ok: false, reason: 'worker-deadline-exceeded' });
      }, this.killBudgetMs);
      deadline.unref?.();

      child.on('message', (raw: unknown) => {
        const message = parseWorkerMessage(raw, limits.maxHtmlChars);
        if (!message) {
          this.logger.warn('[ssr] render worker sent an unrecognised message — discarding');
          return;
        }
        if (message.type === 'ready') return;
        if (message.type === 'log') {
          const line = `[ssr:worker] ${message.message}`;
          if (message.level === 'error') this.logger.error(line);
          else if (message.level === 'warn') this.logger.warn(line);
          else this.logger.log(line);
          return;
        }
        if (!message.ok) {
          settle({ ok: false, reason: message.reason || 'worker-refused' });
          return;
        }
        // The child ran the hostile page. Re-validate its output here.
        try {
          const parsed = validatePublicUrl(message.finalUrl);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            settle({ ok: false, reason: 'worker-final-url-scheme' });
            return;
          }
        } catch {
          settle({ ok: false, reason: 'worker-final-url-rejected' });
          return;
        }
        settle({
          ok: true,
          html: message.html,
          finalUrl: message.finalUrl,
          requests: message.requests,
          elapsedMs: message.elapsedMs,
        });
      });

      child.on('error', (e: Error) => {
        this.logger.warn(`[ssr] render worker error: ${sanitizeLogText(e?.message)}`);
        settle({ ok: false, reason: 'worker-error' });
      });

      child.on('exit', (code, signal) => {
        // Reaching here un-settled means the child died without answering —
        // crash, OOM-kill, or our own SIGKILL landing first.
        settle({
          ok: false,
          reason: `worker-exit code=${code ?? '-'} signal=${signal ?? '-'}`,
        });
      });

      try {
        child.send(job, (err) => {
          if (err) {
            this.logger.warn(`[ssr] could not send render job: ${sanitizeLogText(err.message)}`);
            settle({ ok: false, reason: 'worker-send-failed' });
          }
        });
      } catch (e: any) {
        settle({ ok: false, reason: 'worker-send-threw' });
        this.logger.warn(`[ssr] send threw: ${sanitizeLogText(e?.message)}`);
      }
    });

    // Whatever happened, this process group does not survive the request.
    this.killGroup(child, 'SIGKILL');
    this.active = null;

    if (!outcome.ok && stderrTail) {
      this.logger.warn(`[ssr:worker stderr] ${sanitizeLogText(stderrTail, 500)}`);
    }
    return outcome;
  }

  /**
   * Signal the child's whole PROCESS GROUP.
   *
   * `detached: true` made the child a group leader, so the negative pid
   * reaches Chromium's browser/renderer/GPU children too. Killing only
   * `child.pid` leaves those orphaned, re-parented to init, and holding
   * memory — the exact leak a per-render process is supposed to prevent.
   */
  private killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
    const pid = child.pid;
    if (!pid) return;
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      /* no group (platform or already reaped) — fall through to the child */
    }
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }

  /** Reap any live worker — called from `RendererService.onModuleDestroy`. */
  shutdown(): void {
    if (this.active) {
      this.killGroup(this.active, 'SIGKILL');
      this.active = null;
    }
  }
}
