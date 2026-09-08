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
 *   2. TWO PROCESS GROUPS, BOTH KILLED. `detached: true` makes the worker a
 *      group leader — but `@puppeteer/browsers` ALSO spawns Chromium with
 *      `detached: true`, so the browser is a group leader of its own and is
 *      NOT reached by killing the worker's group. That is not theory: the
 *      first version of this file killed only the worker's group, and the
 *      in-container proof left 11 Chromium processes (~900 MB) alive,
 *      re-parented to init, plus a profile directory they kept re-creating.
 *      So the worker reports the browser pid the moment it launches, both
 *      groups are signalled, and a `/proc` sweep keyed on this render's unique
 *      profile path catches anything that started before that message landed.
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
 *
 *   6. A MEMORY CEILING (2026-09-08). The wall clock bounded how LONG a
 *      hostile page could allocate; nothing bounded HOW MUCH. Measured in the
 *      shipped image: a page that just allocates in a loop took the container
 *      from 15 MiB to 4094 MiB — its entire limit — inside one render budget.
 *      Without the watchdog below, "an OOM costs one render" was a bet on the
 *      kernel picking a Chromium process over the API, not a property of the
 *      design.
 */
import { fork, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
 * Chromium's memory is its own, and is bounded by the wall-clock kill plus
 * `MAX_RENDER_MEMORY_BYTES` below — NOT by the response-byte or HTML caps,
 * which measure what the network delivered and what the finished snapshot
 * weighs, neither of which limits what the page allocates while running. The
 * API keeps its `NODE_OPTIONS` `--max-old-space-size=4096`; the child does
 * NOT inherit it.
 */
const WORKER_NODE_HEAP_MB = 256;

/** Bytes of child stderr retained for diagnostics on a failed render. */
const MAX_STDERR_CAPTURE = 4096;

/** Grace between SIGTERM and SIGKILL when the deadline fires. */
const SIGKILL_GRACE_MS = 1_500;

/**
 * How much CONTAINER memory one render may add before it is killed.
 *
 * Measured, not guessed (in-container proof, 2026-09-08). A page that simply
 * allocates in a loop drove the container's cgroup from 15 MiB to 4094 MiB —
 * the whole limit it was given — inside the 22 s worker budget, and would
 * have taken more if there had been more. Chromium's memory is bounded by
 * NONE of the existing caps: the declared-byte cap counts what the network
 * delivered, the HTML cap is applied to the finished snapshot, and the wall
 * clock only says how long it may keep allocating.
 *
 * Without this bound, "an OOM in the child costs one render" is not a
 * property of the design — it is a bet on the kernel's OOM killer choosing a
 * Chromium process over the API. It usually would (the renderer has by far
 * the largest RSS), but "usually" is not the claim this file exists to make.
 *
 * 1536 MiB is ~7.5x the 200 MiB a normal render actually costs (also
 * measured), and on the Railway service (8 GB limit, ~250 MB steady state) it
 * keeps a hostile render from pushing the container past ~1.8 GB.
 */
const MAX_RENDER_MEMORY_BYTES = 1536 * 1024 * 1024;

/** How often the memory watchdog samples the cgroup. */
const MEMORY_POLL_MS = 500;

/**
 * Current memory charge for THIS container, in bytes, or null where there is
 * no cgroup to read (a developer Mac, cgroup-v1 without the file).
 *
 * The cgroup is the right meter rather than a sum of per-process RSS: shared
 * pages make an RSS sum over a Chromium tree wildly over-count (a NORMAL
 * render measured 936 MiB that way and 200 MiB here), and the cgroup number
 * is the one the platform actually kills on.
 */
function cgroupMemoryBytes(): number | null {
  for (const path of [
    '/sys/fs/cgroup/memory.current',
    '/sys/fs/cgroup/memory/memory.usage_in_bytes',
  ]) {
    try {
      const value = Number(readFileSync(path, 'utf8').trim());
      if (Number.isFinite(value) && value > 0) return value;
    } catch {
      /* try the next layout */
    }
  }
  return null;
}

export interface RenderWorkerClientOptions {
  /** Overridable for tests. Defaults to the compiled worker next to this file. */
  workerScriptPath?: string;
  /** Chromium binary. Defaults to the container's. */
  executablePath?: string;
  /** Hard wall-clock ceiling before the group is killed. */
  killBudgetMs?: number;
  /**
   * How much container memory ONE render may add before it is killed.
   * Overridable for tests; `0` disables the watchdog.
   */
  maxRenderMemoryBytes?: number;
  /**
   * Seam for the watchdog's meter. Production reads the cgroup; a test needs
   * a deterministic reading, and a developer Mac has no cgroup file at all
   * (so the watchdog is simply inactive there, which is why the test must be
   * able to supply one).
   */
  memoryReader?: () => number | null;
  logger?: PipelineLogger;
}

const NOOP_LOGGER: PipelineLogger = { log: () => {}, warn: () => {}, error: () => {} };

export class RenderWorkerClient {
  private readonly workerScriptPath: string;
  private readonly executablePath: string;
  private readonly killBudgetMs: number;
  private readonly maxRenderMemoryBytes: number;
  private readonly readMemory: () => number | null;
  private readonly logger: PipelineLogger;

  /**
   * Exactly one live child at a time — see `RendererService.MAX_CONCURRENT`.
   * Tracked here as well so `onModuleDestroy` can reap it and so a caller that
   * bypassed the service's counter still cannot fan out browsers.
   */
  private active: ChildProcess | null = null;

  /**
   * Pid of the Chromium BROWSER process for the live render, as reported by
   * the worker. Its own process-group leader — see the header.
   */
  private activeBrowserPid: number | null = null;

  constructor(options: RenderWorkerClientOptions = {}) {
    this.workerScriptPath = options.workerScriptPath ?? join(__dirname, 'render-worker.js');
    this.executablePath =
      options.executablePath ??
      process.env.PUPPETEER_EXECUTABLE_PATH ??
      '/usr/bin/chromium-browser';
    this.killBudgetMs = options.killBudgetMs ?? 25_000;
    this.maxRenderMemoryBytes = options.maxRenderMemoryBytes ?? MAX_RENDER_MEMORY_BYTES;
    this.readMemory = options.memoryReader ?? cgroupMemoryBytes;
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
      const outcome = await this.forkAndRender(url, limits, profileDir);
      if (!outcome.ok) {
        // On the failure path Chromium may have been SIGKILLed rather than
        // closed. Sweep for anything still holding this render's unique
        // profile path, then let the signals land before removing the
        // directory — otherwise a survivor simply re-creates it, which is
        // exactly what the first in-container proof caught.
        this.sweepByProfileDir(profileDir);
        await new Promise<void>((r) => setTimeout(r, 250));
      }
      return outcome;
    } finally {
      // The parent owns this directory precisely because a SIGKILLed child
      // never gets to clean up.
      await rm(profileDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Last-resort reaper: SIGKILL anything whose command line still mentions
   * THIS render's profile directory.
   *
   * Targeted by a `mkdtemp` path that only this render created, so it can
   * never touch an unrelated process. Linux-only by nature (`/proc`), which is
   * the production platform; a no-op everywhere else. It exists for the race
   * where the worker is killed before its `browser` message arrives, so the
   * browser's own process group was never known.
   */
  private sweepByProfileDir(profileDir: string): void {
    let entries: string[];
    try {
      entries = readdirSync('/proc');
    } catch {
      return; // not Linux — nothing to sweep
    }
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      if (pid === process.pid) continue;
      try {
        const cmdline = readFileSync(`/proc/${entry}/cmdline`, 'utf8');
        if (!cmdline.includes(profileDir)) continue;
        this.logger.warn(`[ssr] reaping stray render process pid=${pid}`);
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          /* not a group leader */
        }
        process.kill(pid, 'SIGKILL');
      } catch {
        /* raced with exit, or not ours to signal */
      }
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
    this.activeBrowserPid = null;
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
      let memWatch: NodeJS.Timeout | undefined;
      const settle = (value: PipelineOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        clearTimeout(graceTimer);
        if (memWatch) clearInterval(memWatch);
        resolve(value);
      };

      // ── MEMORY WATCHDOG ────────────────────────────────────────────────
      // The wall clock bounds how LONG a hostile page may allocate; nothing
      // bounded HOW MUCH until this. See MAX_RENDER_MEMORY_BYTES for the
      // measurement that made it necessary. Inactive (and therefore a
      // behaviour no-op) anywhere there is no cgroup file to read.
      const memBaseline = this.maxRenderMemoryBytes > 0 ? this.readMemory() : null;
      if (memBaseline !== null) {
        memWatch = setInterval(() => {
          const now = this.readMemory();
          if (now === null) return;
          const used = now - memBaseline;
          if (used <= this.maxRenderMemoryBytes) return;
          this.logger.warn(
            `[ssr] render exceeded its ${Math.round(this.maxRenderMemoryBytes / 1048576)} MiB ` +
              `memory budget (+${Math.round(used / 1048576)} MiB) — killing pid=${pid ?? '?'}`,
          );
          this.killGroup(child, 'SIGKILL');
          settle({ ok: false, reason: 'render-memory-cap' });
        }, MEMORY_POLL_MS);
        memWatch.unref?.();
      }

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
        if (message.type === 'browser') {
          // Chromium is its OWN process-group leader (puppeteer spawns it
          // detached), so this pid is the second group the kill must reach.
          this.activeBrowserPid = message.pid;
          return;
        }
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

    // Whatever happened, neither process group survives the request.
    this.killGroup(child, 'SIGKILL');
    this.active = null;
    this.activeBrowserPid = null;

    if (!outcome.ok && stderrTail) {
      this.logger.warn(`[ssr:worker stderr] ${sanitizeLogText(stderrTail, 500)}`);
    }
    return outcome;
  }

  /**
   * Signal BOTH process groups: the worker's, and Chromium's own.
   *
   * `detached: true` made the worker a group leader, and puppeteer makes the
   * browser one too, so a single `process.kill(-workerPid)` reaches only the
   * Node shim. That was the first version of this method, and the
   * in-container proof caught it: 11 Chromium processes survived, re-parented
   * to init, holding ~900 MB and re-creating the profile directory we had just
   * deleted. Both groups, every time.
   */
  private killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
    const browserPid = this.activeBrowserPid;
    if (browserPid) this.signalGroupThenPid(browserPid, signal);
    const pid = child.pid;
    if (!pid) return;
    if (!this.signalGroupThenPid(pid, signal)) {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    }
  }

  /** Signal a process group, falling back to the bare pid. */
  private signalGroupThenPid(pid: number, signal: NodeJS.Signals): boolean {
    let delivered = false;
    try {
      process.kill(-pid, signal);
      delivered = true;
    } catch {
      /* not a group leader, or already reaped */
    }
    try {
      process.kill(pid, signal);
      delivered = true;
    } catch {
      /* already gone */
    }
    return delivered;
  }

  /** Reap any live worker — called from `RendererService.onModuleDestroy`. */
  shutdown(): void {
    if (this.active) {
      this.killGroup(this.active, 'SIGKILL');
      this.active = null;
      this.activeBrowserPid = null;
    }
  }
}
