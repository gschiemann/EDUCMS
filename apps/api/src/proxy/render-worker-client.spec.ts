/**
 * SEC-006 (durable half) — the PROCESS BOUNDARY, proved with real forks.
 *
 * `renderer.ssrf.spec.ts` proves the guards. This file proves the thing the
 * audit actually asked for: that a crash, hang or OOM on the browser side is a
 * failed render and nothing more, and that the process holding the browser
 * holds no secrets.
 *
 * Every test here forks a REAL child process (a tiny stub written to a temp
 * dir, so no Chromium is needed and the suite stays fast). The assertions are:
 *
 *   • the API process survives every failure mode and keeps working afterwards
 *   • a killed worker's whole PROCESS GROUP dies, grandchildren included —
 *     that is the difference between "Chromium is gone" and "Chromium is now
 *     an orphan eating the Railway box until the next deploy"
 *   • the child's environment holds no secret, observed FROM INSIDE the child
 *   • output from the child is validated, not trusted
 */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RenderWorkerClient } from './render-worker-client';
import { DEFAULT_RENDER_LIMITS } from './render-pipeline';
import { RENDER_PROTOCOL_VERSION } from './render-worker-protocol';

const V = RENDER_PROTOCOL_VERSION;

let stubDir: string;
const stub = (name: string, body: string): string => {
  const file = join(stubDir, `${name}.js`);
  writeFileSync(file, body, 'utf8');
  return file;
};

/** Collects the lines the client logs, so tests can read what the child said. */
function recordingLogger() {
  const lines: string[] = [];
  return {
    lines,
    logger: {
      log: (m: string) => lines.push(m),
      warn: (m: string) => lines.push(m),
      error: (m: string) => lines.push(m),
    },
  };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** True while the OS still knows about `pid` (a zombie counts as alive). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code !== 'ESRCH';
  }
}

async function waitForDeath(pid: number, timeoutMs = 8_000): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (!pidAlive(pid)) return true;
    await wait(50);
  }
  return !pidAlive(pid);
}

beforeAll(() => {
  stubDir = mkdtempSync(join(tmpdir(), 'venueos-worker-stubs-'));
});

afterAll(() => {
  rmSync(stubDir, { recursive: true, force: true });
});

describe('RenderWorkerClient — the API process survives the browser process', () => {
  it('returns the rendered HTML on the happy path', async () => {
    const script = stub(
      'ok',
      `process.on('message', () => {
         process.send({ v: ${V}, type: 'result', ok: true,
           html: '<html><body>hydrated</body></html>',
           finalUrl: 'https://good.example/', requests: 3, elapsedMs: 12 });
         setTimeout(() => process.exit(0), 10);
       });
       process.send({ v: ${V}, type: 'ready' });`,
    );
    const client = new RenderWorkerClient({ workerScriptPath: script, killBudgetMs: 5_000 });

    const outcome = await client.run('https://good.example/', DEFAULT_RENDER_LIMITS);

    expect(outcome).toMatchObject({ ok: true, finalUrl: 'https://good.example/' });
    if (outcome.ok) expect(outcome.html).toContain('hydrated');
  }, 20_000);

  it('KILLS a hung worker AND its grandchildren, and the API keeps rendering', async () => {
    // The stub spawns a long-running grandchild (standing in for Chromium's
    // browser/renderer/GPU processes) and then never answers. If the client
    // signalled only `child.pid`, the grandchild would be re-parented and
    // survive — the leak a per-render process is supposed to prevent.
    const script = stub(
      'hang',
      `const { spawn } = require('node:child_process');
       process.on('message', () => {
         const grandchild = spawn('sleep', ['120'], { stdio: 'ignore' });
         process.send({ v: ${V}, type: 'log', level: 'log',
           message: 'PIDS self=' + process.pid + ' grandchild=' + grandchild.pid });
         setInterval(() => {}, 1000);   // never answer, never exit
       });
       process.send({ v: ${V}, type: 'ready' });`,
    );
    const { lines, logger } = recordingLogger();
    const client = new RenderWorkerClient({
      workerScriptPath: script,
      killBudgetMs: 1_200,
      logger,
    });

    const started = Date.now();
    const outcome = await client.run('https://good.example/', DEFAULT_RENDER_LIMITS);
    const elapsed = Date.now() - started;

    // ONE failed render — never a throw, never an API restart.
    expect(outcome).toMatchObject({ ok: false });
    expect((outcome as { reason: string }).reason).toContain('worker-deadline-exceeded');
    // The deadline is a wall clock, not a hope.
    expect(elapsed).toBeLessThan(6_000);

    const pidLine = lines.find((l) => l.includes('PIDS self='));
    expect(pidLine).toBeDefined();
    const [, selfPid, grandPid] = /self=(\d+) grandchild=(\d+)/.exec(pidLine!)!;

    expect(await waitForDeath(Number(selfPid))).toBe(true);
    expect(await waitForDeath(Number(grandPid))).toBe(true);

    // …and THIS process is unharmed: no exit code set, and the very next
    // render still works.
    expect(process.exitCode).toBeUndefined();
    const okScript = stub(
      'ok2',
      `process.on('message', () => {
         process.send({ v: ${V}, type: 'result', ok: true, html: 'alive',
           finalUrl: 'https://good.example/' });
         setTimeout(() => process.exit(0), 10);
       });`,
    );
    const after = new RenderWorkerClient({ workerScriptPath: okScript, killBudgetMs: 5_000 });
    expect(await after.run('https://good.example/', DEFAULT_RENDER_LIMITS)).toMatchObject({
      ok: true,
    });
  }, 40_000);

  it('KILLS the browser process group too — puppeteer spawns Chromium detached', async () => {
    // THE REGRESSION THIS FILE EXISTS FOR. `@puppeteer/browsers` spawns
    // Chromium with `detached: true`, making it its OWN process-group leader.
    // The first version of the client killed only the worker's group; the
    // in-container proof then found 11 Chromium processes alive, re-parented
    // to init, holding ~900 MB. This stub reproduces that shape exactly: a
    // grandchild in its own group, whose pid is reported over the protocol's
    // `browser` message.
    const script = stub(
      'detachedbrowser',
      `const { spawn } = require('node:child_process');
       process.on('message', () => {
         const browser = spawn('sleep', ['120'], { stdio: 'ignore', detached: true });
         browser.unref();
         process.send({ v: ${V}, type: 'browser', pid: browser.pid });
         process.send({ v: ${V}, type: 'log', level: 'log',
           message: 'PIDS self=' + process.pid + ' browser=' + browser.pid });
         setInterval(() => {}, 1000);   // never answer
       });`,
    );
    const { lines, logger } = recordingLogger();
    const client = new RenderWorkerClient({
      workerScriptPath: script,
      killBudgetMs: 1_200,
      logger,
    });

    const outcome = await client.run('https://good.example/', DEFAULT_RENDER_LIMITS);
    expect(outcome.ok).toBe(false);

    const pidLine = lines.find((l) => l.includes('PIDS self='));
    expect(pidLine).toBeDefined();
    const [, selfPid, browserPid] = /self=(\d+) browser=(\d+)/.exec(pidLine!)!;

    expect(await waitForDeath(Number(selfPid))).toBe(true);
    // The one that used to survive.
    expect(await waitForDeath(Number(browserPid))).toBe(true);
  }, 40_000);

  it('ignores an implausible browser pid rather than signalling it', async () => {
    // A pid is a signal target, so the protocol validator refuses anything
    // that is not a plain positive integer above 1 — pid 1 is init.
    const script = stub(
      'badpid',
      `process.on('message', () => {
         process.send({ v: ${V}, type: 'browser', pid: 1 });
         process.send({ v: ${V}, type: 'browser', pid: -1 });
         process.send({ v: ${V}, type: 'browser', pid: 'all' });
         process.send({ v: ${V}, type: 'result', ok: true, html: 'fine',
           finalUrl: 'https://good.example/' });
         setTimeout(() => process.exit(0), 10);
       });`,
    );
    const { lines, logger } = recordingLogger();
    const client = new RenderWorkerClient({
      workerScriptPath: script,
      killBudgetMs: 5_000,
      logger,
    });

    expect(await client.run('https://good.example/', DEFAULT_RENDER_LIMITS)).toMatchObject({
      ok: true,
    });
    // Three unrecognised messages, three discards, no signal sent anywhere.
    expect(lines.filter((l) => l.includes('unrecognised'))).toHaveLength(3);
    expect(process.exitCode).toBeUndefined();
  }, 20_000);

  it('degrades when the worker crashes mid-render', async () => {
    const script = stub(
      'crash',
      `process.on('message', () => { process.exit(3); });
       process.send({ v: ${V}, type: 'ready' });`,
    );
    const client = new RenderWorkerClient({ workerScriptPath: script, killBudgetMs: 5_000 });

    const outcome = await client.run('https://good.example/', DEFAULT_RENDER_LIMITS);

    expect(outcome.ok).toBe(false);
    expect((outcome as { reason: string }).reason).toContain('worker-exit');
    expect(process.exitCode).toBeUndefined();
  }, 20_000);

  it('degrades when the worker is killed by a signal (the OOM shape)', async () => {
    const script = stub(
      'selfkill',
      `process.on('message', () => { process.kill(process.pid, 'SIGKILL'); });
       process.send({ v: ${V}, type: 'ready' });`,
    );
    const client = new RenderWorkerClient({ workerScriptPath: script, killBudgetMs: 5_000 });

    const outcome = await client.run('https://good.example/', DEFAULT_RENDER_LIMITS);

    expect(outcome.ok).toBe(false);
    expect((outcome as { reason: string }).reason).toMatch(/signal=SIGKILL|worker-exit/);
  }, 20_000);

  it('carries NO secret into the child — observed from inside the child', async () => {
    // The strongest form of the allowlist claim: the child reports the
    // environment it ACTUALLY has, and we assert against that.
    const script = stub(
      'envdump',
      `process.on('message', () => {
         process.send({ v: ${V}, type: 'result', ok: true,
           html: JSON.stringify(process.env),
           finalUrl: 'https://good.example/' });
         setTimeout(() => process.exit(0), 10);
       });`,
    );
    // Every variable the SEC-006 review named, each with a UNIQUE canary value
    // so the check below can also catch a leak under a DIFFERENT name.
    const secrets = {
      DEVICE_SECRET_KEY: 'CANARY-DEVICE-SECRET-KEY',
      DEVICE_JWT_SECRET: 'CANARY-DEVICE-JWT-SECRET',
      JWT_SECRET: 'CANARY-JWT-SECRET',
      SESSION_SECRET: 'CANARY-SESSION-SECRET',
      DATABASE_URL: 'postgresql://CANARY-DB-USER:CANARY-DB-PW@db.example:5432/postgres',
      DIRECT_URL: 'postgresql://CANARY-DIRECT-USER:CANARY-DIRECT-PW@db.example:5432/postgres',
      SUPABASE_URL: 'https://CANARY-SUPABASE.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'CANARY-SUPABASE-SERVICE-ROLE',
      SUPABASE_ANON_KEY: 'CANARY-SUPABASE-ANON',
      REDIS_URL: 'redis://:CANARY-REDIS@redis.example:6379',
      STRIPE_SECRET_KEY: 'sk_live_CANARY-STRIPE',
      STRIPE_WEBHOOK_SECRET: 'whsec_CANARY-STRIPE-WEBHOOK',
      STRIPE_PRICE_MONTHLY: 'price_CANARY-STRIPE-PRICE',
      GH_TOKEN: 'ghp_CANARY-GH-TOKEN',
      GITHUB_TOKEN: 'ghs_CANARY-GITHUB-TOKEN',
      RESEND_API_KEY: 're_CANARY-RESEND',
      ANTHROPIC_API_KEY: 'sk-ant-CANARY-ANTHROPIC',
      PROXY_RENDER_SECRET: 'CANARY-PROXY-RENDER-SECRET',
      SPORTS_BEACON_SECRET: 'CANARY-SPORTS-BEACON',
      GATEWAY_SHARED_SECRET: 'CANARY-GATEWAY-SHARED',
      // Not a secret, but Railway sets it to `--max-old-space-size=4096` on
      // the API and the hostile-page process must not inherit a 4 GB heap.
      NODE_OPTIONS: '--max-old-space-size=4096',
    };
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(secrets)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      const client = new RenderWorkerClient({ workerScriptPath: script, killBudgetMs: 5_000 });
      const outcome = await client.run('https://good.example/', DEFAULT_RENDER_LIMITS);

      expect(outcome.ok).toBe(true);
      const childEnv: Record<string, string> = JSON.parse((outcome as { html: string }).html);
      const childEnvKeys = Object.keys(childEnv);
      // (a) not by NAME…
      for (const key of Object.keys(secrets)) {
        expect(childEnvKeys).not.toContain(key);
      }
      // (b) …and not by VALUE either, which also catches a leak smuggled
      // under some other variable name.
      const serialised = JSON.stringify(childEnv);
      for (const value of Object.values(secrets)) {
        if (value.includes('CANARY')) expect(serialised).not.toContain(value);
      }
      expect(serialised).not.toContain('CANARY');
      // What it DOES have is only plumbing.
      expect(childEnvKeys).toContain('VENUEOS_RENDER_WORKER');
      expect(childEnvKeys).toContain('HOME');
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }, 20_000);

  it('gives the child a fresh, disposable profile directory that does not survive', async () => {
    const script = stub(
      'profile',
      `process.on('message', (job) => {
         require('node:fs').writeFileSync(job.userDataDir + '/cookie.txt', 'tracked');
         process.send({ v: ${V}, type: 'result', ok: true, html: job.userDataDir,
           finalUrl: 'https://good.example/' });
         setTimeout(() => process.exit(0), 10);
       });`,
    );
    const client = new RenderWorkerClient({ workerScriptPath: script, killBudgetMs: 5_000 });

    const outcome = await client.run('https://good.example/', DEFAULT_RENDER_LIMITS);
    expect(outcome.ok).toBe(true);
    const profileDir = (outcome as { html: string }).html;
    expect(profileDir).toContain('venueos-render-');
    // The PARENT owns the lifecycle, because a SIGKILLed child cannot clean up.
    expect(require('node:fs').existsSync(profileDir)).toBe(false);
  }, 20_000);

  it('REFUSES a result whose finalUrl points back into our own network', async () => {
    const script = stub(
      'badurl',
      `process.on('message', () => {
         process.send({ v: ${V}, type: 'result', ok: true, html: 'INTERNAL',
           finalUrl: 'http://127.0.0.1:6379/' });
         setTimeout(() => process.exit(0), 10);
       });`,
    );
    const client = new RenderWorkerClient({ workerScriptPath: script, killBudgetMs: 5_000 });

    const outcome = await client.run('https://good.example/', DEFAULT_RENDER_LIMITS);

    expect(outcome).toMatchObject({ ok: false, reason: 'worker-final-url-rejected' });
  }, 20_000);

  it('DISCARDS an oversized or malformed message rather than trusting the child', async () => {
    const script = stub(
      'garbage',
      `process.on('message', () => {
         process.send({ hello: 'world' });                       // no schema
         process.send({ v: ${V}, type: 'shell', cmd: 'whoami' }); // unknown type
         process.send({ v: ${V}, type: 'result', ok: true,
           html: 'x'.repeat(64), finalUrl: 'https://good.example/' });
         setTimeout(() => process.exit(0), 20);
       });`,
    );
    const client = new RenderWorkerClient({ workerScriptPath: script, killBudgetMs: 5_000 });

    // maxHtmlChars of 8 makes the only well-formed message oversized too, so
    // NOTHING the child sent is accepted and the run ends on its exit.
    const outcome = await client.run('https://good.example/', {
      ...DEFAULT_RENDER_LIMITS,
      maxHtmlChars: 8,
    });

    expect(outcome.ok).toBe(false);
  }, 20_000);

  it('refuses to fan out — one live worker at a time', async () => {
    const script = stub(
      'slow',
      `process.on('message', () => {
         setTimeout(() => {
           process.send({ v: ${V}, type: 'result', ok: true, html: 'done',
             finalUrl: 'https://good.example/' });
           setTimeout(() => process.exit(0), 10);
         }, 400);
       });`,
    );
    const client = new RenderWorkerClient({ workerScriptPath: script, killBudgetMs: 5_000 });

    const first = client.run('https://good.example/a', DEFAULT_RENDER_LIMITS);
    // Give the fork a moment to register as active.
    await wait(120);
    const second = await client.run('https://good.example/b', DEFAULT_RENDER_LIMITS);

    expect(second).toMatchObject({ ok: false, reason: 'worker-busy' });
    expect(await first).toMatchObject({ ok: true });
  }, 20_000);

  it('degrades cleanly when the compiled worker is not in the build', async () => {
    const client = new RenderWorkerClient({
      workerScriptPath: join(stubDir, 'does-not-exist.js'),
    });

    expect(client.isAvailable()).toBe(false);
    expect(await client.run('https://good.example/', DEFAULT_RENDER_LIMITS)).toMatchObject({
      ok: false,
      reason: 'worker-script-missing',
    });
  }, 20_000);

  it('shutdown() reaps a live worker', async () => {
    const script = stub(
      'forever',
      `process.on('message', () => { setInterval(() => {}, 1000); });
       process.send({ v: ${V}, type: 'ready' });`,
    );
    const { lines, logger } = recordingLogger();
    const client = new RenderWorkerClient({
      workerScriptPath: script,
      killBudgetMs: 30_000,
      logger,
    });

    const running = client.run('https://good.example/', DEFAULT_RENDER_LIMITS);
    await wait(300);
    client.shutdown();

    expect((await running).ok).toBe(false);
    expect(lines.join(' ')).not.toContain('unrecognised');
  }, 20_000);
});
