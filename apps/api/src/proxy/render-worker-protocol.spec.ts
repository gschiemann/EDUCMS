/**
 * SEC-006 (durable half) — the render worker's wire contract.
 *
 * The headline assertion is the environment allowlist. The whole point of
 * moving Chromium into a child process is that the process running a hostile
 * page holds nothing worth stealing, and "holds nothing" has to be a property
 * you can TEST, not a comment. So the first test builds the worker env from a
 * fake `process.env` that contains every secret this deployment actually has,
 * and asserts none of them survive.
 */
import {
  RENDER_PROTOCOL_VERSION,
  WORKER_ENV_ALLOWLIST,
  buildWorkerEnv,
  parseRenderJob,
  parseWorkerMessage,
  sanitizeLogText,
  type RenderJobLimits,
} from './render-worker-protocol';
import { scrubEnvironment } from './render-worker';
import { DEFAULT_RENDER_LIMITS } from './render-pipeline';

/** Every secret / connection string the API service is configured with. */
const SECRET_ENV: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgresql://user:pw@db.example:5432/postgres',
  DIRECT_URL: 'postgresql://user:pw@db.example:5432/postgres',
  REDIS_URL: 'redis://:pw@redis.example:6379',
  JWT_SECRET: 'a'.repeat(64),
  SESSION_SECRET: 'b'.repeat(64),
  DEVICE_SECRET_KEY: 'c'.repeat(64),
  DEVICE_JWT_SECRET: 'd'.repeat(64),
  SUPABASE_URL: 'https://xyz.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.service-role',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiJ9.anon',
  // The API shells out to `gh` for the player-OTA release catalogue, so a
  // GitHub token is genuinely present in this process's environment.
  GH_TOKEN: 'ghp_secret-token',
  GITHUB_TOKEN: 'ghs_secret-token',
  STRIPE_PRICE_MONTHLY: 'price_secret',
  PROXY_RENDER_SECRET: 'e'.repeat(64),
  GATEWAY_SHARED_SECRET: 'f'.repeat(64),
  SPORTS_BEACON_SECRET: 'g'.repeat(64),
  ANTHROPIC_API_KEY: 'sk-ant-api03-secret',
  STRIPE_SECRET_KEY: 'sk_live_secret',
  STRIPE_WEBHOOK_SECRET: 'whsec_secret',
  RESEND_API_KEY: 're_secret',
  PEXELS_API_KEY: 'pexels-secret',
  GOOGLE_MAPS_API_KEY: 'AIza-secret',
  // Railway sets this on the API. A 4 GB heap is the last thing the process
  // running a hostile page should inherit.
  NODE_OPTIONS: '--max-old-space-size=4096',
};

const BENIGN_ENV: NodeJS.ProcessEnv = {
  PATH: '/usr/local/bin:/usr/bin:/bin',
  HOME: '/home/node',
  LANG: 'C.UTF-8',
  TZ: 'UTC',
  PUPPETEER_EXECUTABLE_PATH: '/usr/bin/chromium-browser',
};

describe('render worker environment — allowlist, not denylist', () => {
  it('carries NO secret, connection string or NODE_OPTIONS into the child', () => {
    const env = buildWorkerEnv({ ...BENIGN_ENV, ...SECRET_ENV });

    for (const key of Object.keys(SECRET_ENV)) {
      expect(env).not.toHaveProperty(key);
    }
    // And nothing leaked by VALUE either (a renamed variable would still be a
    // leak; this catches a future allowlist entry that happens to hold one).
    const serialised = JSON.stringify(env);
    for (const value of Object.values(SECRET_ENV)) {
      expect(serialised).not.toContain(value as string);
    }
  });

  it('carries exactly the allowlisted names that were present, and nothing else', () => {
    const env = buildWorkerEnv({ ...BENIGN_ENV, ...SECRET_ENV });
    expect(Object.keys(env).sort()).toEqual(Object.keys(BENIGN_ENV).sort());
    for (const key of Object.keys(env)) {
      expect(WORKER_ENV_ALLOWLIST).toContain(key);
    }
  });

  it('never lets an explicit addition be undefined or inherited implicitly', () => {
    const env = buildWorkerEnv(SECRET_ENV, { VENUEOS_RENDER_WORKER: '1' });
    expect(env.VENUEOS_RENDER_WORKER).toBe('1');
    expect(Object.keys(env)).toEqual(['VENUEOS_RENDER_WORKER']);
  });

  it('holds no allowlist entry that names a credential', () => {
    // A cheap ratchet: if someone adds SUPABASE_SERVICE_ROLE_KEY or
    // DATABASE_URL to the allowlist "just for one thing", this fails.
    for (const key of WORKER_ENV_ALLOWLIST) {
      expect(key).not.toMatch(/SECRET|TOKEN|PASSWORD|_KEY$|API_KEY|DATABASE|REDIS|SUPABASE|JWT/i);
    }
  });

  it('the child scrubs its own environment down to the same allowlist', () => {
    // Second line of defence: even if a future parent regression forks with a
    // fat environment, the worker deletes anything unexpected before it loads
    // puppeteer.
    const env: NodeJS.ProcessEnv = { ...BENIGN_ENV, ...SECRET_ENV, VENUEOS_RENDER_WORKER: '1' };
    const removed = scrubEnvironment(env);

    expect(removed).toEqual(expect.arrayContaining(Object.keys(SECRET_ENV)));
    for (const key of Object.keys(SECRET_ENV)) expect(env[key]).toBeUndefined();
    expect(env.PATH).toBe(BENIGN_ENV.PATH);
    expect(env.VENUEOS_RENDER_WORKER).toBe('1');
  });
});

describe('sanitizeLogText', () => {
  it('flattens control characters so a hostile page cannot forge log lines', () => {
    const forged = 'ok\n[Nest] ERROR fake line\r\ttab';
    expect(sanitizeLogText(forged)).toBe('ok [Nest] ERROR fake line  tab');
  });

  it('caps length', () => {
    expect(sanitizeLogText('x'.repeat(1000))).toHaveLength(300);
  });

  it('never throws on a non-string', () => {
    expect(sanitizeLogText(undefined)).toBe('');
    expect(sanitizeLogText({ toString: () => 'obj' })).toBe('obj');
  });
});

describe('parseRenderJob — the child refuses anything that is not a render order', () => {
  const job = {
    v: RENDER_PROTOCOL_VERSION,
    type: 'render',
    url: 'https://example.com/',
    executablePath: '/usr/bin/chromium-browser',
    userDataDir: '/tmp/profile',
    limits: DEFAULT_RENDER_LIMITS,
  };

  it('accepts a well-formed job', () => {
    expect(parseRenderJob(job)).toMatchObject({ url: 'https://example.com/' });
  });

  it.each([
    ['null', null],
    ['a string', 'render'],
    ['an array', [job]],
    ['a wrong version', { ...job, v: 2 }],
    ['a wrong type', { ...job, type: 'exec' }],
    ['no url', { ...job, url: '' }],
    ['an absurd url', { ...job, url: 'x'.repeat(5000) }],
    ['no executable', { ...job, executablePath: '' }],
    ['no profile dir', { ...job, userDataDir: '' }],
    ['no limits', { ...job, limits: undefined }],
    ['a negative limit', { ...job, limits: { ...DEFAULT_RENDER_LIMITS, maxHtmlChars: -1 } }],
    ['a NaN limit', { ...job, limits: { ...DEFAULT_RENDER_LIMITS, workerBudgetMs: NaN } }],
    ['a missing limit', { ...job, limits: { navigationTimeoutMs: 1 } as RenderJobLimits }],
  ])('refuses %s', (_label, candidate) => {
    expect(parseRenderJob(candidate)).toBeNull();
  });
});

describe('parseWorkerMessage — the child ran the hostile page, so its output is untrusted input', () => {
  const cap = 1024;

  it('accepts a well-formed result', () => {
    const parsed = parseWorkerMessage(
      {
        v: RENDER_PROTOCOL_VERSION,
        type: 'result',
        ok: true,
        html: '<html></html>',
        finalUrl: 'https://example.com/',
        requests: 4,
        elapsedMs: 120,
      },
      cap,
    );
    expect(parsed).toMatchObject({ type: 'result', ok: true, requests: 4 });
  });

  it('REJECTS a result whose HTML exceeds the cap the parent set', () => {
    const parsed = parseWorkerMessage(
      {
        v: RENDER_PROTOCOL_VERSION,
        type: 'result',
        ok: true,
        html: 'x'.repeat(cap + 1),
        finalUrl: 'https://example.com/',
      },
      cap,
    );
    expect(parsed).toBeNull();
  });

  it.each([
    ['a non-object', 42],
    ['a wrong version', { v: 9, type: 'result', ok: true, html: '', finalUrl: 'https://a.example/' }],
    ['an unknown type', { v: RENDER_PROTOCOL_VERSION, type: 'shell', cmd: 'rm -rf /' }],
    ['ok that is neither true nor false', { v: RENDER_PROTOCOL_VERSION, type: 'result', ok: 'yes' }],
    ['html that is not a string', { v: RENDER_PROTOCOL_VERSION, type: 'result', ok: true, html: { }, finalUrl: 'https://a.example/' }],
    ['no finalUrl', { v: RENDER_PROTOCOL_VERSION, type: 'result', ok: true, html: '' }],
  ])('refuses %s', (_label, candidate) => {
    expect(parseWorkerMessage(candidate, cap)).toBeNull();
  });

  it('sanitizes a refusal reason and a log line', () => {
    const refusal = parseWorkerMessage(
      { v: RENDER_PROTOCOL_VERSION, type: 'result', ok: false, reason: 'bad\nthing' },
      cap,
    );
    expect(refusal).toEqual({ v: RENDER_PROTOCOL_VERSION, type: 'result', ok: false, reason: 'bad thing' });

    const log = parseWorkerMessage(
      { v: RENDER_PROTOCOL_VERSION, type: 'log', level: 'warn', message: 'a\r\nb' },
      cap,
    );
    expect(log).toEqual({ v: RENDER_PROTOCOL_VERSION, type: 'log', level: 'warn', message: 'a  b' });
  });
});
