/**
 * SEC-006 (durable half, 2026-09-05) — THE DISPOSABLE CHROMIUM WORKER.
 *
 * This file is the entire process that touches a hostile page. It is forked by
 * `render-worker-client.ts`, renders exactly ONE url, posts the result back
 * over IPC and exits. Nothing is reused between renders: not the browser, not
 * the profile directory, not the process.
 *
 * WHAT IT DELIBERATELY DOES NOT HAVE
 *   • No NestJS module graph. Its only imports are `puppeteer-core` (lazily),
 *     `safe-fetch` (node builtins only) and the protocol/pipeline files.
 *     So there is no Prisma client, no ioredis connection, no WebSocket
 *     gateway and no express session store in this address space.
 *   • No secrets. The parent forks it with an ALLOWLISTED environment
 *     (`buildWorkerEnv`), and as a second line of defence this file scrubs its
 *     own `process.env` down to that same allowlist before doing anything
 *     else — so a future regression in the parent cannot quietly leak
 *     `DATABASE_URL` into the process running a hostile page.
 *   • No stdin, and no way to be told to do anything except "render this url".
 *     `parseRenderJob` rejects every other message shape.
 *
 * WHY IT MATTERS: before this file existed, Chromium ran `--no-sandbox
 * --disable-setuid-sandbox --single-process` INSIDE the NestJS process that
 * publishes lockdown alerts. A renderer-process exploit landed in the
 * emergency bus. Now it lands here, where the worst case is one failed render
 * and a `null` that the controller already knows how to degrade from.
 */
import { rm } from 'node:fs/promises';
import {
  RENDER_PROTOCOL_VERSION,
  RENDER_WORKER_ENV_FLAG,
  WORKER_ENV_ALLOWLIST,
  parseRenderJob,
  sanitizeLogText,
  type RenderJobMessage,
  type WorkerLogLevel,
  type WorkerMessage,
} from './render-worker-protocol';
import {
  runRenderPipeline,
  type BrowserLauncher,
  type PipelineLogger,
} from './render-pipeline';

/** How long the worker waits for its one job before giving up and exiting. */
const JOB_HANDSHAKE_TIMEOUT_MS = 15_000;

function send(message: WorkerMessage): void {
  try {
    process.send?.(message);
  } catch {
    /* parent went away; nothing useful left to do */
  }
}

function makeLogger(): PipelineLogger {
  const emit = (level: WorkerLogLevel) => (message: string) =>
    send({ v: RENDER_PROTOCOL_VERSION, type: 'log', level, message: sanitizeLogText(message) });
  return { log: emit('log'), warn: emit('warn'), error: emit('error') };
}

/**
 * Second line of defence on the environment.
 *
 * The parent already builds an allowlist, but a process that runs attacker-
 * chosen JavaScript should not depend on one place getting that right. Anything
 * outside the allowlist (plus the worker's own flag) is deleted here, before
 * puppeteer is even loaded.
 */
export function scrubEnvironment(env: NodeJS.ProcessEnv = process.env): string[] {
  const allowed = new Set<string>([...WORKER_ENV_ALLOWLIST, RENDER_WORKER_ENV_FLAG]);
  const removed: string[] = [];
  for (const key of Object.keys(env)) {
    if (!allowed.has(key)) {
      removed.push(key);
      delete env[key];
    }
  }
  return removed;
}

async function loadPuppeteer(): Promise<BrowserLauncher> {
  const puppeteer = await import('puppeteer-core');
  return puppeteer.default;
}

async function runJob(job: RenderJobMessage): Promise<void> {
  const logger = makeLogger();
  let outcome: WorkerMessage;
  try {
    const launcher = await loadPuppeteer();
    const result = await runRenderPipeline({
      launcher,
      url: job.url,
      executablePath: job.executablePath,
      userDataDir: job.userDataDir,
      limits: job.limits,
      logger,
    });
    outcome = result.ok
      ? {
          v: RENDER_PROTOCOL_VERSION,
          type: 'result',
          ok: true,
          html: result.html,
          finalUrl: result.finalUrl,
          requests: result.requests,
          elapsedMs: result.elapsedMs,
        }
      : { v: RENDER_PROTOCOL_VERSION, type: 'result', ok: false, reason: result.reason };
  } catch (e: any) {
    outcome = {
      v: RENDER_PROTOCOL_VERSION,
      type: 'result',
      ok: false,
      reason: sanitizeLogText(`worker-exception: ${e?.message ?? e}`),
    };
  }
  send(outcome);
  // Best-effort profile cleanup. The PARENT owns this directory and removes it
  // too, precisely because a SIGKILLed child never reaches this line.
  try {
    await rm(job.userDataDir, { recursive: true, force: true });
  } catch {
    /* parent cleans up */
  }
  // Give the IPC write a tick to flush, then leave. Chromium is already closed
  // by the pipeline's `finally`; exiting also reaps anything it left behind.
  setTimeout(() => process.exit(0), 50).unref?.();
  try {
    process.disconnect?.();
  } catch {
    /* already disconnected */
  }
}

export function startWorker(): void {
  scrubEnvironment();

  // A worker that never receives its job must not linger holding a process
  // slot. The parent's kill covers this too; this is the child's own answer.
  const handshake = setTimeout(() => {
    send({
      v: RENDER_PROTOCOL_VERSION,
      type: 'result',
      ok: false,
      reason: 'no-job-received',
    });
    process.exit(0);
  }, JOB_HANDSHAKE_TIMEOUT_MS);
  handshake.unref?.();

  let started = false;
  process.on('message', (raw: unknown) => {
    if (started) return; // exactly one render per process, by construction
    const job = parseRenderJob(raw);
    if (!job) {
      send({
        v: RENDER_PROTOCOL_VERSION,
        type: 'result',
        ok: false,
        reason: 'invalid-job-message',
      });
      process.exit(0);
      return;
    }
    started = true;
    clearTimeout(handshake);

    // The child's OWN budget, under the parent's SIGKILL deadline, so a wedge
    // normally reports a reason instead of dying anonymously.
    const budget = setTimeout(() => {
      send({
        v: RENDER_PROTOCOL_VERSION,
        type: 'result',
        ok: false,
        reason: 'worker-budget-exceeded',
      });
      process.exit(0);
    }, job.limits.workerBudgetMs);
    budget.unref?.();

    void runJob(job).finally(() => clearTimeout(budget));
  });

  // Anything unexpected in a process that just ran hostile JavaScript is a
  // refusal, never a partial result.
  const bail = (kind: string) => (err: unknown) => {
    send({
      v: RENDER_PROTOCOL_VERSION,
      type: 'result',
      ok: false,
      reason: sanitizeLogText(`${kind}: ${(err as any)?.message ?? err}`),
    });
    process.exit(1);
  };
  process.on('uncaughtException', bail('uncaught-exception'));
  process.on('unhandledRejection', bail('unhandled-rejection'));

  send({ v: RENDER_PROTOCOL_VERSION, type: 'ready' });
}

// Only start when the parent actually forked us as a worker. Importing this
// module (a test, a bundler, a stray require) must never launch a browser.
if (process.env[RENDER_WORKER_ENV_FLAG] === '1' && typeof process.send === 'function') {
  startWorker();
}
