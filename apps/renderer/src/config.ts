/**
 * config.ts — the ONLY environment the renderer reads.
 *
 * No secrets, no endpoints, no credentials: PORT plus tuning knobs, each with
 * a safe default, each validated. A knob that does not parse falls back to its
 * default (logged) rather than crashing the boot — a typo in a Railway variable
 * must never take the service down, and none of these can widen what a render
 * is allowed to reach.
 */
import { RENDER_LIMITS } from './contract.js';

export interface RendererConfig {
  port: number;
  host: string;
  maxBodyBytes: number;
  renderTimeoutMs: number;
  queueMax: number;
  /** Restart Chromium after this many renders (leak hygiene). */
  recycleAfter: number;
  /**
   * Kill + restart Chromium when the container's memory charge passes this.
   * null = derive from the cgroup limit (85 %), or no watchdog where there is
   * no cgroup (a developer Mac).
   */
  memoryLimitBytes: number | null;
  /** Chromium binary. */
  executablePath: string | null;
}

export interface ConfigWarning {
  name: string;
  value: string;
  reason: string;
}

function readInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
  warnings: ConfigWarning[],
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    warnings.push({ name, value: raw, reason: `expected an integer in [${min}, ${max}] — using ${fallback}` });
    return fallback;
  }
  return value;
}

function firstNonBlank(...values: Array<string | undefined>): string | null {
  for (const v of values) if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): { config: RendererConfig; warnings: ConfigWarning[] } {
  const warnings: ConfigWarning[] = [];
  const memMb = readInt(env, 'RENDERER_MEMORY_LIMIT_MB', 0, 0, 1024 * 1024, warnings);
  const config: RendererConfig = {
    port: readInt(env, 'PORT', 8080, 1, 65535, warnings),
    // `::` is dual-stack on Linux: Railway's private network is IPv6, and its
    // healthcheck may arrive over IPv4.
    host: firstNonBlank(env.RENDERER_HOST) ?? '::',
    maxBodyBytes: readInt(env, 'RENDERER_MAX_BODY_BYTES', RENDER_LIMITS.maxBodyBytes, 1024, 64 * 1024 * 1024, warnings),
    renderTimeoutMs: readInt(env, 'RENDERER_TIMEOUT_MS', RENDER_LIMITS.renderTimeoutMs, 1000, 300_000, warnings),
    queueMax: readInt(env, 'RENDERER_QUEUE_MAX', RENDER_LIMITS.queueMax, 0, 64, warnings),
    recycleAfter: readInt(env, 'RENDERER_RECYCLE_AFTER', 50, 1, 100_000, warnings),
    memoryLimitBytes: memMb > 0 ? memMb * 1024 * 1024 : null,
    // A BLANK variable is unset, not a path — `??` would accept "" and the
    // launch would fail with a message that points nowhere near the cause
    // (the same trap render-worker-client.ts documents).
    executablePath: firstNonBlank(env.PUPPETEER_EXECUTABLE_PATH, env.CHROME_PATH),
  };
  return { config, warnings };
}
