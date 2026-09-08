/**
 * SEC-006 — THE IN-CONTAINER PROOF of the render process boundary.
 *
 * Runs INSIDE the shipped runtime image, against the image's OWN compiled
 * `apps/api/dist/proxy/render-worker-client.js` and the image's OWN Chromium.
 * A Mac-only Jest run proves the parent's logic; it proves nothing about
 * Alpine, musl, `USER node`, the container's seccomp profile, or whether the
 * browser starts at all. This file is the part that does.
 *
 * It is driven by `run.sh`, which stands up a second container serving
 * 198.51.99.10:80 — a subnet chosen because it is OUTSIDE every range
 * `isPrivateIp` rejects, so the shipped SSRF guard admits the render without
 * being weakened for the test and without needing internet.
 *
 * WHAT EACH PROOF ESTABLISHES
 *
 *   P1  Chromium launches in the forked child and runs the page's JavaScript.
 *       The origin's visible DOM is written by a <script>; a snapshot
 *       containing the marker cannot have come from a plain fetch.
 *
 *   P2  The child's environment is an ALLOWLIST — asserted from the KERNEL
 *       (`/proc/<pid>/environ`) for EVERY process in the render tree, the Node
 *       worker and every Chromium process alike. The parent container is
 *       started with every named secret set to a unique canary VALUE, so the
 *       assertion is "the canary appears nowhere", which also catches a leak
 *       under a different name.
 *
 *   P3  A crash, a SIGKILL and a hang each cost ONE render. After each, the
 *       parent is still alive AND still able to render — proved by rendering
 *       again and getting the marker back.
 *
 *   P4  No process and no profile directory survives any of it.
 *
 *   P5  Peak container memory during one render, measured from the cgroup, so
 *       the "one child at a time" cap is a number and not an opinion.
 *
 * Exit code 0 only if every proof passes. Prints a JSON block for the report.
 */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);

const DIST = '/app/apps/api/dist/proxy';
const { RenderWorkerClient } = require(`${DIST}/render-worker-client.js`);
const { DEFAULT_RENDER_LIMITS } = require(`${DIST}/render-pipeline.js`);
const { WORKER_ENV_ALLOWLIST } = require(`${DIST}/render-worker-protocol.js`);

/**
 * Everything the child is allowed to have BEYOND the shipped allowlist.
 *
 * `render-worker-client.ts` adds the first group explicitly (the throwaway
 * profile, pointed at by every "where do I keep state" variable Chromium
 * consults); `child_process.fork` adds the NODE_CHANNEL_* pair for the IPC
 * socket. Anything outside the union fails the proof — which is the point: a
 * future edit that widens the child's environment has to come here and say so.
 */
const EXPECTED_EXTRA = [
  'VENUEOS_RENDER_WORKER',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'NODE_CHANNEL_FD',
  'NODE_CHANNEL_SERIALIZATION_MODE',
];

const ORIGIN = process.env.SEC006_ORIGIN || 'http://198.51.99.10';
const MARKER = 'SEC006-JS-EXECUTED-IN-CHILD';
const CANARY = 'SEC006-LEAK-CANARY';
/** The temp-dir prefix `RenderWorkerClient` mkdtemps for every render. */
const RENDER_TAG = 'venueos-render-';

/** Every secret the audit named. The container is started with all of them. */
const SECRET_KEYS = [
  'DEVICE_SECRET_KEY',
  'DEVICE_JWT_SECRET',
  'JWT_SECRET',
  'SESSION_SECRET',
  'DATABASE_URL',
  'DIRECT_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_ANON_KEY',
  'REDIS_URL',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PRICE_MONTHLY',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'RESEND_API_KEY',
  'ANTHROPIC_API_KEY',
  'PEXELS_API_KEY',
  'GOOGLE_MAPS_API_KEY',
  'PROXY_RENDER_SECRET',
  'SPORTS_BEACON_SECRET',
  'GATEWAY_SHARED_SECRET',
  // Not a secret, but it must not be inherited: Railway sets it to
  // `--max-old-space-size=4096` for the API, and the hostile-page process must
  // not get a 4 GB heap. It cannot carry a canary (Node parses the value), so
  // it is checked by NAME only.
  'NODE_OPTIONS',
];

/** The subset whose VALUE carries a canary — everything but NODE_OPTIONS. */
const CANARY_KEYS = SECRET_KEYS.filter((k) => k !== 'NODE_OPTIONS');

const results = [];
let failed = false;

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failed = true;
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ` — ${detail}` : ''}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const logger = {
  log: (m) => console.log(`   . ${m}`),
  warn: (m) => console.log(`   ! ${m}`),
  error: (m) => console.log(`   x ${m}`),
};

/** Everything the kernel currently knows about this render's process tree. */
function scanRenderProcs() {
  const found = [];
  let entries;
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
      continue; // exited between readdir and read
    }
    try {
      environ = readFileSync(`/proc/${e}/environ`, 'utf8');
    } catch {
      /* unreadable is still reportable */
    }
    if (!cmdline.includes(RENDER_TAG) && !environ.includes(RENDER_TAG)) continue;
    let comm = '';
    let rssBytes = 0;
    try {
      comm = readFileSync(`/proc/${e}/comm`, 'utf8').trim();
    } catch {
      /* raced */
    }
    try {
      const statm = readFileSync(`/proc/${e}/statm`, 'utf8').split(/\s+/);
      rssBytes = Number(statm[1] || 0) * 4096;
    } catch {
      /* raced */
    }
    found.push({
      pid,
      comm,
      rssBytes,
      /** Raw, for substring matching — Chromium rewrites its own argv. */
      cmdlineRaw: cmdline,
      environRaw: environ,
      argv: cmdline.split('\0').filter(Boolean),
      envEntries: environ.split('\0').filter(Boolean),
    });
  }
  return found;
}

/** cgroup-v2 current memory charge for the whole container, in bytes. */
function cgroupMemoryBytes() {
  for (const p of ['/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory/memory.usage_in_bytes']) {
    try {
      return Number(readFileSync(p, 'utf8').trim());
    } catch {
      /* try the next layout */
    }
  }
  return 0;
}

function leftoverProfileDirs() {
  try {
    return readdirSync(tmpdir()).filter((d) => d.startsWith(RENDER_TAG));
  } catch {
    return [];
  }
}

function newClient(overrides = {}) {
  return new RenderWorkerClient({ logger, killBudgetMs: 30_000, ...overrides });
}

const LIMITS = { ...DEFAULT_RENDER_LIMITS };

/** One clean render; returns the outcome. */
async function renderOnce(client, path = '/', limits = LIMITS) {
  return client.run(`${ORIGIN}${path}`, limits);
}

/** True for a Chromium process that is parsing HTML (the hostile-bytes one). */
const isRendererProc = (p) => p.cmdlineRaw.includes('--type=renderer');
const isChromium = (p) => /chrom/i.test(p.comm) || /chrom/i.test(p.argv[0] || '');

/**
 * Drive a render that will not finish, and hand back the process tree once the
 * browser is genuinely UP — not merely spawning.
 *
 * The first version waited only for "a process named chromium exists", which
 * fires during `launch()`; killing there produced `browser-launch-failed`, a
 * weaker thing than the claim ("a crash MID-RENDER costs one render"). Waiting
 * for a `--type=renderer` process means the page is actually being parsed.
 */
async function startStalledRender(client, limits, path = '/lag', settleMs = 2_500) {
  const pending = client.run(`${ORIGIN}${path}`, limits);
  let tree = [];
  const until = Date.now() + 25_000;
  while (Date.now() < until) {
    tree = scanRenderProcs();
    if (tree.some(isRendererProc)) break;
    await wait(150);
  }
  // A renderer appears for the initial `about:blank` page too, while
  // `launch()` is still resolving — killing there yields
  // `browser-launch-failed`, which is not the claim. Settle first, so the
  // browser is fully up and `page.goto` is genuinely in flight.
  await wait(settleMs);
  return { pending, tree: scanRenderProcs() };
}

async function waitForNoStrays(timeoutMs = 15_000) {
  const until = Date.now() + timeoutMs;
  let last = scanRenderProcs();
  while (Date.now() < until) {
    last = scanRenderProcs();
    if (last.length === 0) return last;
    await wait(200);
  }
  return last;
}

async function main() {
  console.log('=== SEC-006 in-container render-isolation proof ===');
  console.log(
    `node=${process.version} uid=${process.getuid?.()} ` +
      `chromium=${process.env.PUPPETEER_EXECUTABLE_PATH} origin=${ORIGIN}`,
  );

  // ── Precondition: the parent really is holding the secrets ────────────
  // Without this the absence proof below would be vacuous.
  const presentSecrets = CANARY_KEYS.filter((k) => (process.env[k] || '').includes(CANARY));
  const missing = CANARY_KEYS.filter((k) => !(process.env[k] || '').includes(CANARY));
  record(
    'P0  the parent process holds every named secret (otherwise P2 proves nothing)',
    presentSecrets.length === CANARY_KEYS.length && !!process.env.NODE_OPTIONS,
    `${presentSecrets.length}/${CANARY_KEYS.length} canaries present` +
      `${missing.length ? ` — MISSING: ${missing.join(',')}` : ''}` +
      `; NODE_OPTIONS=${process.env.NODE_OPTIONS || '(unset)'}`,
  );

  record(
    'P0b the compiled worker is in the image',
    existsSync(`${DIST}/render-worker.js`),
    `${DIST}/render-worker.js`,
  );

  // ── P1 + P2 + P5: one real render, watched from the kernel ────────────
  const client = newClient();
  const baselineMem = cgroupMemoryBytes();
  let peakMem = baselineMem;
  let treeSamples = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const t = scanRenderProcs();
      if (t.length) treeSamples.push(t);
      const m = cgroupMemoryBytes();
      if (m > peakMem) peakMem = m;
      await wait(100);
    }
  })();

  const t0 = Date.now();
  const outcome = await renderOnce(client, '/');
  const renderMs = Date.now() - t0;
  sampling = false;
  await sampler;

  record(
    'P1  Chromium launched in the forked child and executed the page JS',
    outcome.ok === true && typeof outcome.html === 'string' && outcome.html.includes(MARKER),
    outcome.ok
      ? `${outcome.html.length}B of hydrated HTML in ${renderMs}ms, marker present`
      : `render refused: ${outcome.reason}`,
  );

  const widest = treeSamples.reduce((a, b) => (b.length > a.length ? b : a), []);
  const chromiumProcs = widest.filter(isChromium);
  record(
    'P1b the render tree really was a browser, in its own processes',
    chromiumProcs.length >= 1,
    `${widest.length} processes in the render tree at its widest ` +
      `(${chromiumProcs.length} Chromium: ${[...new Set(chromiumProcs.map((p) => p.comm))].join(', ')})`,
  );

  // Multi-process is the point of dropping --single-process: the HTML parser
  // should not share an address space with the browser's network/IPC layer.
  // Chromium REWRITES its own argv (and, in doing so, clobbers the environ
  // area) to set a process title, so the type flag has to be matched as a
  // substring of the raw cmdline, not as an argv element.
  const rendererProcs = chromiumProcs.filter(isRendererProc);
  record(
    'P1c the HTML parser runs in its OWN Chromium renderer process (no --single-process)',
    rendererProcs.length >= 1 && !widest.some((p) => p.cmdlineRaw.includes('--single-process')),
    `${rendererProcs.length} --type=renderer process(es) (pids ${rendererProcs.map((p) => p.pid).join(',')}); ` +
      `--single-process absent from all ${chromiumProcs.length} Chromium command lines`,
  );

  // ── P2: the environment allowlist, straight out of /proc ──────────────
  //
  // Two assertions, because they are different strengths of claim.
  //
  // P2 is a raw BYTE scan of every process's environ and cmdline for the
  // canary. It cannot be fooled by a leak under a different variable name, and
  // it covers processes whose environ Chromium has overwritten with its own
  // process title (which is why the scan is on the raw blob, not on parsed
  // KEY=VALUE pairs).
  //
  // P2b is the strict one, and it is applied to the two processes whose
  // environ is authoritative and un-clobbered: the Node worker (what the API
  // forked) and the Chromium BROWSER process (what the worker spawned, and
  // what every renderer inherits from). Their key sets must be a SUBSET of the
  // shipped allowlist plus the documented additions — so a future edit that
  // widens the child's environment fails here by name.
  const leaks = [];
  for (const proc of widest) {
    if (proc.environRaw.includes(CANARY)) {
      const entry = proc.envEntries.find((e) => e.includes(CANARY)) || '(clobbered environ)';
      leaks.push(`${proc.pid}/${proc.comm} env:${entry.slice(0, 60)}`);
    }
    if (proc.cmdlineRaw.includes(CANARY)) leaks.push(`${proc.pid}/${proc.comm} argv`);
  }
  record(
    'P2  the canary appears in NO process of the render tree (raw /proc byte scan)',
    widest.length > 0 && leaks.length === 0,
    widest.length === 0
      ? 'NO render processes were sampled — the proof observed nothing'
      : `${widest.length} processes examined (environ + cmdline), 0 canaries`,
  );

  const cleanKeys = (proc) =>
    proc.envEntries
      .filter((e) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(e))
      .map((e) => e.slice(0, e.indexOf('=')));
  const workerProc = widest.find(
    (p) => p.comm === 'node' && p.argv.some((a) => a.endsWith('render-worker.js')),
  );
  const browserProc = widest.find((p) => p.cmdlineRaw.includes('--user-data-dir='));
  const allowed = new Set([...WORKER_ENV_ALLOWLIST, ...EXPECTED_EXTRA]);
  const authoritative = [
    ['node render worker', workerProc],
    ['chromium browser process', browserProc],
  ].filter(([, p]) => !!p);
  const extras = [];
  for (const [label, p] of authoritative) {
    for (const k of cleanKeys(p)) if (!allowed.has(k)) extras.push(`${label}:${k}`);
  }
  record(
    'P2b the child environment is a strict SUBSET of the shipped allowlist',
    authoritative.length === 2 && extras.length === 0,
    authoritative.length < 2
      ? `only found: ${authoritative.map(([l]) => l).join(', ') || 'neither process'}`
      : `worker keys = [${cleanKeys(workerProc).sort().join(',')}]; ` +
        `browser keys = [${cleanKeys(browserProc).sort().join(',')}]` +
        `${extras.length ? ` — UNEXPECTED: ${extras.join(',')}` : ''}`,
  );

  const allEnvKeysSeen = new Set();
  for (const proc of widest) for (const k of cleanKeys(proc)) allEnvKeysSeen.add(k);
  const forbiddenByName = SECRET_KEYS.filter((k) => allEnvKeysSeen.has(k));
  record(
    'P2c none of the named variables is present by NAME anywhere in the tree',
    forbiddenByName.length === 0,
    forbiddenByName.length
      ? `present: ${forbiddenByName.join(',')}`
      : `none of the ${SECRET_KEYS.length} names present`,
  );

  record(
    'P5  peak container memory during one render (informs the concurrency cap)',
    true,
    `baseline ${(baselineMem / 1048576).toFixed(0)} MiB → peak ${(peakMem / 1048576).toFixed(0)} MiB ` +
      `(delta ${((peakMem - baselineMem) / 1048576).toFixed(0)} MiB); ` +
      `render-tree RSS at widest ${(widest.reduce((s, p) => s + p.rssBytes, 0) / 1048576).toFixed(0)} MiB`,
  );

  let strays = await waitForNoStrays(10_000);
  record(
    'P4  a SUCCESSFUL render leaves no process behind',
    strays.length === 0,
    strays.length ? `survivors: ${strays.map((p) => `${p.pid}/${p.comm}`).join(' ')}` : 'none',
  );

  // ── P3a: SIGKILL the browser mid-render (the renderer-crash shape) ────
  {
    const c = newClient({ killBudgetMs: 30_000 });
    const { pending, tree } = await startStalledRender(c, { ...LIMITS, workerBudgetMs: 27_000 });
    const browser = tree.find((p) => p.cmdlineRaw.includes('--user-data-dir='));
    const renderers = tree.filter(isRendererProc);
    let killed = 0;
    const killedAt = Date.now();
    for (const p of tree.filter(isChromium)) {
      try {
        process.kill(p.pid, 'SIGKILL');
        killed += 1;
      } catch {
        /* already gone */
      }
    }
    const res = await pending;
    const settleMs = Date.now() - killedAt;
    record(
      'P3a SIGKILLing Chromium MID-RENDER is a refusal, not an exception',
      res.ok === false && renderers.length >= 1,
      `page was being parsed in ${renderers.length} renderer process(es); killed ${killed} Chromium ` +
        `process(es) (browser pid ${browser?.pid ?? '?'}) → ${res.ok ? 'ok' : res.reason} after ${settleMs}ms`,
    );
    // The 2026-09-08 fix: a dead browser must not hold the single render slot
    // for the whole worker budget. `browser-crashed` is the disconnect race
    // settling; anything else means the render waited out a timeout instead.
    record(
      'P3a-1b …and it refuses PROMPTLY, not at the worker budget',
      !res.ok && res.reason === 'browser-crashed' && settleMs < 5_000,
      `reason=${res.ok ? 'ok' : res.reason} in ${settleMs}ms (worker budget was 27000ms)`,
    );
    strays = await waitForNoStrays(15_000);
    record(
      'P3a-2 nothing survives the kill',
      strays.length === 0,
      strays.length ? `survivors: ${strays.map((p) => `${p.pid}/${p.comm}`).join(' ')}` : 'none',
    );
    const after = await renderOnce(newClient(), '/');
    record(
      'P3a-3 the parent still renders afterwards',
      after.ok === true && after.html.includes(MARKER),
      after.ok ? 'marker present on the next render' : `next render refused: ${after.reason}`,
    );
  }

  // ── P3b: SIGKILL the Node worker itself (the OOM-kill shape) ──────────
  {
    const c = newClient({ killBudgetMs: 30_000 });
    const { pending, tree } = await startStalledRender(c, { ...LIMITS, workerBudgetMs: 27_000 });
    const worker = tree.find(
      (p) => p.comm === 'node' && p.argv.some((a) => a.endsWith('render-worker.js')),
    );
    let ok = false;
    if (worker) {
      try {
        process.kill(worker.pid, 'SIGKILL');
        ok = true;
      } catch {
        /* raced */
      }
    }
    const res = await pending;
    record(
      'P3b SIGKILLing the Node worker (what an OOM killer does) is a refusal',
      ok && res.ok === false,
      worker ? `worker pid ${worker.pid} → ${res.ok ? 'ok' : res.reason}` : 'worker process not found',
    );
    strays = await waitForNoStrays(15_000);
    record(
      'P3b-2 the orphaned Chromium tree is reaped, not left to init',
      strays.length === 0,
      strays.length ? `survivors: ${strays.map((p) => `${p.pid}/${p.comm}`).join(' ')}` : 'none',
    );
    const after = await renderOnce(newClient(), '/');
    record(
      'P3b-3 the parent still renders afterwards',
      after.ok === true && after.html.includes(MARKER),
      after.ok ? 'marker present on the next render' : `next render refused: ${after.reason}`,
    );
  }

  // ── P3c: a hang hits the wall-clock SIGKILL ───────────────────────────
  {
    const c = newClient({ killBudgetMs: 8_000 });
    const t = Date.now();
    const res = await c.run(`${ORIGIN}/slow`, { ...LIMITS, workerBudgetMs: 60_000 });
    const elapsed = Date.now() - t;
    record(
      'P3c a hung render is killed by the parent wall clock',
      res.ok === false && elapsed < 20_000,
      `refused after ${elapsed}ms: ${res.ok ? 'ok' : res.reason}`,
    );
    strays = await waitForNoStrays(15_000);
    record(
      'P3c-2 the hung browser tree is gone',
      strays.length === 0,
      strays.length ? `survivors: ${strays.map((p) => `${p.pid}/${p.comm}`).join(' ')}` : 'none',
    );
    const after = await renderOnce(newClient(), '/');
    record(
      'P3c-3 the parent still renders afterwards',
      after.ok === true && after.html.includes(MARKER),
      after.ok ? 'marker present on the next render' : `next render refused: ${after.reason}`,
    );
  }

  // ── P3d: a memory-hog page ────────────────────────────────────────────
  {
    const memBefore = cgroupMemoryBytes();
    const c = newClient({ killBudgetMs: 25_000 });
    // A long post-load grace so the page really does allocate for a while —
    // otherwise `networkidle2` fires at once and the snapshot is taken before
    // the hog has done anything, which is not a test of anything.
    let hogPeak = memBefore;
    let sample = true;
    const s = (async () => {
      while (sample) {
        const m = cgroupMemoryBytes();
        if (m > hogPeak) hogPeak = m;
        await wait(100);
      }
    })();
    const res = await c.run(`${ORIGIN}/hog`, {
      ...LIMITS,
      postLoadGraceMs: 10_000,
      workerBudgetMs: 20_000,
    });
    sample = false;
    await s;
    record(
      'P3d a page that allocates without bound costs one render, not the process',
      true, // survival is the claim; both outcomes are acceptable
      `${res.ok ? 'render completed' : `refused: ${res.reason}`}; ` +
        `container memory ${(memBefore / 1048576).toFixed(0)} → ${(hogPeak / 1048576).toFixed(0)} MiB`,
    );
    strays = await waitForNoStrays(20_000);
    record(
      'P3d-2 nothing survives the memory hog',
      strays.length === 0,
      strays.length ? `survivors: ${strays.map((p) => `${p.pid}/${p.comm}`).join(' ')}` : 'none',
    );
    const after = await renderOnce(newClient(), '/');
    record(
      'P3d-3 the parent still renders afterwards',
      after.ok === true && after.html.includes(MARKER),
      after.ok ? 'marker present on the next render' : `next render refused: ${after.reason}`,
    );
  }

  // ── P6: what does the WORST render actually cost? ─────────────────────
  //
  // The number the concurrency cap has to be judged against. Not a hostile
  // page snapshotted in 3 seconds — a hostile page allocating as fast as it
  // can, for the whole PRODUCTION budget, with a hanging sub-resource so
  // `networkidle2` never lets the render finish early.
  {
    const before = cgroupMemoryBytes();
    let peak = before;
    let sample = true;
    const s = (async () => {
      while (sample) {
        const m = cgroupMemoryBytes();
        if (m > peak) peak = m;
        await wait(100);
      }
    })();
    const c = newClient({ killBudgetMs: 25_000 });
    const t = Date.now();
    // Exactly the production limits (`RendererService.executeRender`).
    const res = await c.run(`${ORIGIN}/hogload`, {
      ...DEFAULT_RENDER_LIMITS,
      workerBudgetMs: 22_000,
    });
    const elapsed = Date.now() - t;
    sample = false;
    await s;
    record(
      'P6  the WORST-CASE render cost, measured at production limits',
      true,
      `hostile page allocating for the whole budget: container ${(before / 1048576).toFixed(0)} → ` +
        `${(peak / 1048576).toFixed(0)} MiB (delta ${((peak - before) / 1048576).toFixed(0)} MiB) ` +
        `in ${elapsed}ms; outcome=${res.ok ? 'rendered' : res.reason}`,
    );
    strays = await waitForNoStrays(20_000);
    record(
      'P6b nothing survives the worst-case render either',
      strays.length === 0,
      strays.length ? `survivors: ${strays.map((p) => `${p.pid}/${p.comm}`).join(' ')}` : 'none',
    );
    const after = await renderOnce(newClient(), '/');
    record(
      'P6c the parent still renders afterwards',
      after.ok === true && after.html.includes(MARKER),
      after.ok ? 'marker present on the next render' : `next render refused: ${after.reason}`,
    );
  }

  // ── P4b: no profile directory survives any of it ──────────────────────
  const dirs = leftoverProfileDirs();
  record(
    'P4b no throwaway Chromium profile directory survives',
    dirs.length === 0,
    dirs.length ? `left behind: ${dirs.join(', ')}` : `${tmpdir()} is clean`,
  );

  console.log('\n=== JSON ===');
  console.log(
    JSON.stringify(
      {
        node: process.version,
        uid: process.getuid?.(),
        chromium: process.env.PUPPETEER_EXECUTABLE_PATH,
        baselineMemMiB: Math.round(baselineMem / 1048576),
        peakMemMiB: Math.round(peakMem / 1048576),
        renderMs,
        childEnvKeys: [...allEnvKeysSeen].sort(),
        results,
      },
      null,
      2,
    ),
  );

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} proofs passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('proof harness crashed:', e);
  process.exit(2);
});
