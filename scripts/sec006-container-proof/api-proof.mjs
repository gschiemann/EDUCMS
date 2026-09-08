/**
 * SEC-006 — THE CLAIM THAT MATTERS, against the REAL API process.
 *
 * `proof.mjs` proves the boundary around `RenderWorkerClient`. This file
 * proves the consequence: that killing a render out from under the LIVE
 * NestJS API — the process that owns emergency delivery, the Redis fan-out
 * and the manifest hot cache — costs that ONE request and nothing else.
 *
 * It boots the image's own `apps/api/dist/main.js` as a child, waits for
 * `/api/v1/health`, and then, for each failure shape:
 *
 *   1. starts a real `GET /api/v1/proxy/web` render,
 *   2. SIGKILLs the Chromium tree (or the Node worker) mid-flight,
 *   3. asserts the HTTP response still arrives with content — 200 and
 *      `X-EduCms-Renderer: fetch`, the documented DEGRADE — and
 *   4. asserts the API is the SAME pid, still alive, and `/health` still
 *      answers 200.
 *
 * `PROXY_SSR_ALLOW_ANONYMOUS=1` is set only so the harness can reach the
 * renderer without minting a capability; the gate itself is covered by
 * `proxy.controller.render-gate.spec.ts`.
 *
 * Exit 0 only if every assertion holds.
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const ORIGIN = process.env.SEC006_ORIGIN || 'http://198.51.99.10';
const API = 'http://127.0.0.1:8080';
const MARKER = 'SEC006-JS-EXECUTED-IN-CHILD';
const RAW = 'SEC006-RAW-DOCUMENT';
const RENDER_TAG = 'venueos-render-';

const results = [];
let failed = false;
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed = true;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function scanRenderProcs() {
  const found = [];
  let entries = [];
  try {
    entries = readdirSync('/proc');
  } catch {
    return found;
  }
  for (const e of entries) {
    if (!/^\d+$/.test(e)) continue;
    const pid = Number(e);
    if (pid === process.pid) continue;
    let cmdline = '';
    let environ = '';
    try {
      cmdline = readFileSync(`/proc/${e}/cmdline`, 'utf8');
    } catch {
      continue;
    }
    try {
      environ = readFileSync(`/proc/${e}/environ`, 'utf8');
    } catch {
      /* fine */
    }
    if (!cmdline.includes(RENDER_TAG) && !environ.includes(RENDER_TAG)) continue;
    let comm = '';
    try {
      comm = readFileSync(`/proc/${e}/comm`, 'utf8').trim();
    } catch {
      /* raced */
    }
    found.push({ pid, comm, cmdlineRaw: cmdline, argv: cmdline.split('\0').filter(Boolean) });
  }
  return found;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code !== 'ESRCH';
  }
}

async function get(path, timeoutMs = 60_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}${path}`, { signal: ac.signal });
    const body = await res.text();
    return { status: res.status, renderer: res.headers.get('x-educms-renderer'), body };
  } catch (e) {
    return { status: 0, renderer: null, body: '', error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

let seq = 0;
const bust = () => `?nocache=${Date.now()}-${seq++}`;
const proxyUrl = (path) =>
  `/api/v1/proxy/web?url=${encodeURIComponent(`${ORIGIN}${path}${bust()}`)}`;

/**
 * Wait until the page is genuinely BEING PARSED — a `--type=renderer` process
 * exists — not merely until a process named chromium has appeared.
 *
 * Killing on the weaker condition lands during `launch()` and produces
 * `browser-launch-failed`, which is a different (and easier) thing than the
 * claim being tested: a crash MID-RENDER costs one render.
 */
async function waitForRenderer(timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  let tree = [];
  while (Date.now() < until) {
    tree = scanRenderProcs();
    if (tree.some((p) => p.cmdlineRaw.includes('--type=renderer'))) return tree;
    await wait(150);
  }
  return tree;
}

async function main() {
  console.log('=== SEC-006 — the LIVE API survives a killed render ===');

  const api = spawn(process.execPath, ['/app/apps/api/dist/main.js'], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const apiPid = api.pid;
  let apiLog = '';
  const keep = (b) => {
    apiLog += b.toString('utf8');
    if (apiLog.length > 200_000) apiLog = apiLog.slice(-100_000);
  };
  api.stdout.on('data', keep);
  api.stderr.on('data', keep);
  let apiExited = null;
  api.on('exit', (code, signal) => {
    apiExited = `code=${code} signal=${signal}`;
  });

  // ── boot ───────────────────────────────────────────────────────────────
  let booted = false;
  const bootUntil = Date.now() + 120_000;
  while (Date.now() < bootUntil && apiExited === null) {
    const h = await get('/api/v1/health', 5_000);
    if (h.status === 200) {
      booted = true;
      break;
    }
    await wait(1_000);
  }
  record(
    'A0  the shipped API boots in this image and /health answers 200',
    booted,
    booted ? `pid ${apiPid}` : `api ${apiExited ?? 'never answered'}; last log:\n${apiLog.slice(-2500)}`,
  );
  if (!booted) {
    api.kill('SIGKILL');
    process.exit(1);
  }

  // ── A1 — the public endpoint really drives the out-of-process browser ──
  {
    const r = await get(proxyUrl('/'), 60_000);
    record(
      'A1  GET /api/v1/proxy/web renders through the forked Chromium child',
      r.status === 200 && r.renderer === 'ssr' && r.body.includes(MARKER),
      `status=${r.status} X-EduCms-Renderer=${r.renderer} marker=${r.body.includes(MARKER)}`,
    );
  }

  // ── A2 — SIGKILL Chromium mid-render ───────────────────────────────────
  {
    const pending = get(proxyUrl('/lag'), 90_000);
    const tree = await waitForRenderer();
    const chrom = tree.filter((p) => /chrom/i.test(p.comm));
    for (const p of chrom) {
      try {
        process.kill(p.pid, 'SIGKILL');
      } catch {
        /* raced */
      }
    }
    const r = await pending;
    record(
      'A2  Chromium SIGKILLed mid-render → that ONE request DEGRADES, with content',
      chrom.length > 0 && r.status === 200 && r.renderer === 'fetch' && r.body.includes(RAW),
      `killed ${chrom.length} Chromium proc(s); status=${r.status} ` +
        `renderer=${r.renderer} raw-document=${r.body.includes(RAW)}`,
    );
    record(
      'A2b the API process is the same pid and still alive',
      apiExited === null && alive(apiPid),
      apiExited === null ? `pid ${apiPid} alive` : `API EXITED: ${apiExited}`,
    );
    const h = await get('/api/v1/health', 10_000);
    record('A2c /health still answers 200', h.status === 200, `status=${h.status}`);
  }

  // ── A3 — SIGKILL the Node render worker (the OOM-killer shape) ─────────
  {
    const pending = get(proxyUrl('/lag'), 90_000);
    const tree = await waitForRenderer();
    const worker = tree.find(
      (p) => p.comm === 'node' && p.argv.some((a) => a.endsWith('render-worker.js')),
    );
    if (worker) {
      try {
        process.kill(worker.pid, 'SIGKILL');
      } catch {
        /* raced */
      }
    }
    const r = await pending;
    record(
      'A3  the render worker OOM-killed → that ONE request DEGRADES, with content',
      !!worker && r.status === 200 && r.renderer === 'fetch' && r.body.includes(RAW),
      `worker pid=${worker?.pid ?? 'not found'}; status=${r.status} renderer=${r.renderer}`,
    );
    record(
      'A3b the API process is the same pid and still alive',
      apiExited === null && alive(apiPid),
      apiExited === null ? `pid ${apiPid} alive` : `API EXITED: ${apiExited}`,
    );
    const h = await get('/api/v1/health', 10_000);
    record('A3c /health still answers 200', h.status === 200, `status=${h.status}`);
  }

  // ── A4 — the renderer still works after both kills ─────────────────────
  {
    // Let any wall-clock kill settle, then prove the API did not merely
    // survive but is still capable of a full browser render.
    await wait(2_000);
    const r = await get(proxyUrl('/'), 90_000);
    record(
      'A4  the API still performs a full Chromium render after the kills',
      r.status === 200 && r.renderer === 'ssr' && r.body.includes(MARKER),
      `status=${r.status} renderer=${r.renderer} marker=${r.body.includes(MARKER)}`,
    );
  }

  // ── A5 — nothing survives, in the live API's own container ─────────────
  {
    const until = Date.now() + 15_000;
    let strays = scanRenderProcs();
    while (Date.now() < until && strays.length) {
      await wait(250);
      strays = scanRenderProcs();
    }
    record(
      'A5  no orphaned render process is left in the API container',
      strays.length === 0,
      strays.length ? strays.map((p) => `${p.pid}/${p.comm}`).join(' ') : 'none',
    );
  }

  const ssrLines = apiLog
    .split('\n')
    .filter((l) => l.includes('[ssr]') || l.includes('[ssr:worker'))
    .slice(-25);
  console.log('\n--- API [ssr] log tail ---');
  console.log(ssrLines.join('\n'));

  api.kill('SIGKILL');
  console.log('\n=== JSON ===');
  console.log(JSON.stringify({ apiPid, results }, null, 2));
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} assertions passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('api proof crashed:', e);
  process.exit(2);
});
